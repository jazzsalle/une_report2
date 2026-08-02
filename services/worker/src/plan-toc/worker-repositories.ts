import type { PoolClient } from 'pg';
import type { FlatTocNode, JobEventType } from '@une/domain';

/** Worker-side raw-SQL repositories. Deliberately small duplicates of the
 * services/api repositories (ADR-25 D12: extraction is triggered by CC-130);
 * tenant-scoped queries keep explicit predicates on top of RLS. Since 0016
 * (CC-125, ADR-26 D9) job_event and toc_* are covered by EXISTS-parent
 * FORCE RLS, so these helpers only work inside a tenant-scoped transaction;
 * the explicit joins and the rule that WRITE helpers (appendJobEvent,
 * insertTocVersion/Nodes, nextTocVersionNo) take only ids from a
 * tenant-verified FOR UPDATE row remain as defense in depth (review
 * minor 8). */

export interface ClaimedJob {
  jobId: string;
  tenantId: string;
  aggregateId: string;
  requestJson: unknown;
  correlationId: string;
  attemptNo: number;
}

export interface WorkerJobRow {
  jobId: string;
  status: string;
  aggregateId: string;
  requestJson: unknown;
  correlationId: string;
  attemptNo: number;
}

/** Dispatch scope (no tenant): claim QUEUED work plus crashed RUNNING leases.
 * The worker policy's WITH CHECK restricts writes here to QUEUED/RUNNING, so
 * terminal states physically cannot be written from this scope. */
export async function claimTocJobs(
  client: PoolClient,
  batchSize: number,
  leaseTimeoutMs: number,
): Promise<ClaimedJob[]> {
  const result = await client.query(
    `UPDATE generation_job g
     SET status = 'RUNNING', started_at = now(), attempt_no = g.attempt_no + 1
     WHERE g.job_id IN (
       SELECT job_id FROM generation_job
       WHERE job_type = 'TOC'
         AND (
           status = 'QUEUED'
           OR (status = 'RUNNING' AND started_at < now() - ($2::bigint * interval '1 millisecond'))
         )
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING g.job_id, g.tenant_id, g.aggregate_id, g.request_json, g.correlation_id, g.attempt_no`,
    [batchSize, leaseTimeoutMs],
  );
  return result.rows.map((row) => ({
    jobId: row.job_id as string,
    tenantId: row.tenant_id as string,
    aggregateId: row.aggregate_id as string,
    requestJson: row.request_json,
    correlationId: row.correlation_id as string,
    attemptNo: row.attempt_no as number,
  }));
}

/** Dispatch scope: CANCEL_REQUESTED jobs whose execution never ran (QUEUED
 * cancel race) or whose worker crashed (stale lease). The in-flight worker's
 * own checkpoint handles the live case; this sweep only reads ids — the
 * terminal write happens in the tenant transaction after a FOR UPDATE
 * re-check. */
export async function sweepCancelRequested(
  client: PoolClient,
  batchSize: number,
  leaseTimeoutMs: number,
): Promise<Array<{ jobId: string; tenantId: string; aggregateId: string; correlationId: string }>> {
  const result = await client.query(
    `SELECT job_id, tenant_id, aggregate_id, correlation_id
     FROM generation_job
     WHERE job_type = 'TOC' AND status = 'CANCEL_REQUESTED'
       AND (started_at IS NULL OR started_at < now() - ($2::bigint * interval '1 millisecond'))
     ORDER BY created_at
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [batchSize, leaseTimeoutMs],
  );
  return result.rows.map((row) => ({
    jobId: row.job_id as string,
    tenantId: row.tenant_id as string,
    aggregateId: row.aggregate_id as string,
    correlationId: row.correlation_id as string,
  }));
}

export async function findJobForUpdate(
  client: PoolClient,
  tenantId: string,
  jobId: string,
): Promise<WorkerJobRow | null> {
  const result = await client.query(
    `SELECT job_id, status, aggregate_id, request_json, correlation_id, attempt_no
     FROM generation_job WHERE job_id = $1 AND tenant_id = $2 FOR UPDATE`,
    [jobId, tenantId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    jobId: row.job_id as string,
    status: row.status as string,
    aggregateId: row.aggregate_id as string,
    requestJson: row.request_json,
    correlationId: row.correlation_id as string,
    attemptNo: row.attempt_no as number,
  };
}

export async function setJobStatus(
  client: PoolClient,
  tenantId: string,
  jobId: string,
  update: {
    status: string;
    progressPct?: number;
    errorJson?: Record<string, unknown> | null;
    finished?: boolean;
  },
): Promise<void> {
  await client.query(
    `UPDATE generation_job
     SET status = $3,
         progress_pct = coalesce($4, progress_pct),
         error_json = $5,
         finished_at = CASE WHEN $6 THEN now() ELSE finished_at END
     WHERE job_id = $1 AND tenant_id = $2`,
    [
      jobId,
      tenantId,
      update.status,
      update.progressPct ?? null,
      update.errorJson === undefined ? null : JSON.stringify(update.errorJson),
      update.finished ?? false,
    ],
  );
}

/** Caller must hold the parent job FOR UPDATE (sequence_no serialization). */
export async function appendJobEvent(
  client: PoolClient,
  jobId: string,
  eventType: JobEventType,
  payload: Record<string, unknown>,
): Promise<number> {
  const result = await client.query(
    `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
     VALUES ($1, (SELECT coalesce(max(sequence_no), 0) + 1 FROM job_event WHERE job_id = $1), $2, $3)
     RETURNING sequence_no`,
    [jobId, eventType, JSON.stringify(payload)],
  );
  return Number(result.rows[0].sequence_no);
}

export interface SnapshotRow {
  contextSnapshotId: string;
  planId: string;
  contextJson: unknown;
  contentHash: string;
}

export async function findSnapshot(
  client: PoolClient,
  tenantId: string,
  planId: string,
  snapshotId: string,
): Promise<SnapshotRow | null> {
  const result = await client.query(
    `SELECT s.context_snapshot_id, s.plan_id, s.context_json, s.content_hash
     FROM plan_context_snapshot s
     JOIN plan p ON p.plan_id = s.plan_id AND p.tenant_id = $2
     WHERE s.context_snapshot_id = $1 AND s.plan_id = $3`,
    [snapshotId, tenantId, planId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    contextSnapshotId: row.context_snapshot_id as string,
    planId: row.plan_id as string,
    contextJson: row.context_json,
    contentHash: row.content_hash as string,
  };
}

export interface PlanRowLite {
  planId: string;
  status: string;
  versionNo: number;
  currentTocVersionId: string | null;
}

export async function findPlanForUpdate(
  client: PoolClient,
  tenantId: string,
  planId: string,
): Promise<PlanRowLite | null> {
  const result = await client.query(
    `SELECT plan_id, status, version_no, current_toc_version_id
     FROM plan WHERE plan_id = $1 AND tenant_id = $2 FOR UPDATE`,
    [planId, tenantId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    planId: row.plan_id as string,
    status: row.status as string,
    versionNo: row.version_no as number,
    currentTocVersionId: (row.current_toc_version_id as string | null) ?? null,
  };
}

export async function updatePlanAfterToc(
  client: PoolClient,
  tenantId: string,
  planId: string,
  update: { status: string; currentTocVersionId?: string },
): Promise<void> {
  await client.query(
    `UPDATE plan
     SET status = $3,
         current_toc_version_id = coalesce($4, current_toc_version_id),
         version_no = version_no + 1
     WHERE plan_id = $1 AND tenant_id = $2`,
    [planId, tenantId, update.status, update.currentTocVersionId ?? null],
  );
}

export async function nextTocVersionNo(client: PoolClient, planId: string): Promise<number> {
  const result = await client.query(
    `SELECT coalesce(max(version_no), 0) + 1 AS next FROM toc_version WHERE plan_id = $1`,
    [planId],
  );
  return Number(result.rows[0].next);
}

export async function insertTocVersion(
  client: PoolClient,
  input: {
    planId: string;
    versionNo: number;
    baseSnapshotId: string;
    contentHash: string;
    createdBy: string;
  },
): Promise<string> {
  const result = await client.query(
    `INSERT INTO toc_version
       (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
     VALUES ($1, $2, 'AI', $3, 'DRAFT', $4, $5)
     RETURNING toc_version_id`,
    [input.planId, input.versionNo, input.baseSnapshotId, input.contentHash, input.createdBy],
  );
  return result.rows[0].toc_version_id as string;
}

/** flatten order guarantees parents precede children. */
export async function insertTocNodes(
  client: PoolClient,
  tocVersionId: string,
  rows: readonly FlatTocNode[],
): Promise<void> {
  const idsByKey = new Map<string, string>();
  for (const row of rows) {
    const parentId = row.parentKey ? (idsByKey.get(row.parentKey) ?? null) : null;
    const result = await client.query(
      `INSERT INTO toc_node
         (toc_version_id, parent_node_id, node_key, title, level, sort_order, generation_policy)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING toc_node_id`,
      [
        tocVersionId,
        parentId,
        row.nodeKey,
        row.title,
        row.level,
        row.sortOrder,
        JSON.stringify(row.generationPolicy),
      ],
    );
    idsByKey.set(row.nodeKey, result.rows[0].toc_node_id as string);
  }
}

export async function insertAudit(
  client: PoolClient,
  entry: {
    tenantId: string;
    /** null = system actor (worker without a requesting user in scope). */
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId: string;
    correlationId: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (tenant_id, actor_id, action, resource_type, resource_id, correlation_id, after_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.tenantId,
      entry.actorId,
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.correlationId,
      entry.detail ? JSON.stringify(entry.detail) : null,
    ],
  );
}
