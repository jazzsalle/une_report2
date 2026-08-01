import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/** Plan aggregate reads/writes. Every query runs inside
 * DatabaseService.withTenant and still carries explicit tenant predicates;
 * plan_context_draft / plan_context_snapshot have no tenant_id and are always
 * reached through the plan aggregate (ADR-21 compensating control). */

export interface PlanRow {
  planId: string;
  tenantId: string;
  title: string;
  hazardType: string;
  managementPhase: string;
  status: string;
  startMode: string;
  documentId: string | null;
  currentContextSnapshotId: string | null;
  currentTocVersionId: string | null;
  ownerId: string;
  versionNo: number;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContextDraftRow {
  contextDraftId: string;
  planId: string;
  contextJson: unknown;
  schemaVersion: string;
  updatedBy: string;
  updatedAt: Date;
}

export interface SnapshotRow {
  contextSnapshotId: string;
  planId: string;
  versionNo: number;
  contextJson: unknown;
  contentHash: string;
  supersedesId: string | null;
  confirmedBy: string;
  confirmedAt: Date;
}

export interface PlanSearchQuery {
  keyword?: string;
  status?: string;
  hazardType?: string;
  inTrash: boolean;
  /** 1-based (contract PlanPageResponse). */
  page: number;
  size: number;
}

export interface PlanCreateInput {
  title: string;
  hazardType: string;
  managementPhase: string;
  startMode: string;
  ownerId: string;
}

export interface PlanMetaPatch {
  title?: string;
  hazardType?: string;
  managementPhase?: string;
}

const PLAN_SELECT = `
  SELECT plan_id, tenant_id, title, hazard_type, management_phase, status, start_mode,
         document_id, current_context_snapshot_id, current_toc_version_id,
         owner_id, version_no, deleted_at, created_at, updated_at
  FROM plan`;

function toPlanRow(row: Record<string, unknown>): PlanRow {
  return {
    planId: row.plan_id as string,
    tenantId: row.tenant_id as string,
    title: row.title as string,
    hazardType: row.hazard_type as string,
    managementPhase: row.management_phase as string,
    status: row.status as string,
    startMode: row.start_mode as string,
    documentId: (row.document_id as string | null) ?? null,
    currentContextSnapshotId: (row.current_context_snapshot_id as string | null) ?? null,
    currentTocVersionId: (row.current_toc_version_id as string | null) ?? null,
    ownerId: row.owner_id as string,
    versionNo: row.version_no as number,
    deletedAt: (row.deleted_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toSnapshotRow(row: Record<string, unknown>): SnapshotRow {
  return {
    contextSnapshotId: row.context_snapshot_id as string,
    planId: row.plan_id as string,
    versionNo: row.version_no as number,
    contextJson: row.context_json,
    contentHash: row.content_hash as string,
    supersedesId: (row.supersedes_id as string | null) ?? null,
    confirmedBy: row.confirmed_by as string,
    confirmedAt: row.confirmed_at as Date,
  };
}

/** Escapes LIKE metacharacters so a keyword is always a literal match. */
function likePattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
}

@Injectable()
export class PlanRepository {
  async insertPlan(client: PoolClient, tenantId: string, input: PlanCreateInput): Promise<PlanRow> {
    const result = await client.query(
      `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, start_mode, owner_id)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6)
       RETURNING plan_id, tenant_id, title, hazard_type, management_phase, status, start_mode,
                 document_id, current_context_snapshot_id, current_toc_version_id,
                 owner_id, version_no, deleted_at, created_at, updated_at`,
      [
        tenantId,
        input.title,
        input.hazardType,
        input.managementPhase,
        input.startMode,
        input.ownerId,
      ],
    );
    return toPlanRow(result.rows[0]);
  }

  async findPlan(
    client: PoolClient,
    tenantId: string,
    planId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<PlanRow | null> {
    const result = await client.query(
      `${PLAN_SELECT}
       WHERE plan_id = $1 AND tenant_id = $2${options.forUpdate ? '\n       FOR UPDATE' : ''}`,
      [planId, tenantId],
    );
    return result.rows[0] ? toPlanRow(result.rows[0]) : null;
  }

  async searchPlans(
    client: PoolClient,
    tenantId: string,
    query: PlanSearchQuery,
  ): Promise<{ items: PlanRow[]; totalElements: number }> {
    // count(*) OVER () returns nothing when the page is past the end, which
    // must still report the true total (review 필수-3) — hence two queries.
    const filterParams = [
      tenantId,
      !query.inTrash,
      query.keyword ? likePattern(query.keyword) : null,
      query.status ?? null,
      query.hazardType ?? null,
    ];
    const filterSql = `
       WHERE tenant_id = $1
         AND (deleted_at IS NULL) = $2
         AND ($3::text IS NULL OR title ILIKE $3)
         AND ($4::text IS NULL OR status = $4)
         AND ($5::text IS NULL OR hazard_type = $5)`;
    const count = await client.query(
      `SELECT count(*)::int AS total FROM plan${filterSql}`,
      filterParams,
    );
    const result = await client.query(
      `${PLAN_SELECT}${filterSql}
       ORDER BY updated_at DESC, plan_id
       LIMIT $6 OFFSET $7`,
      [...filterParams, query.size, (query.page - 1) * query.size],
    );
    return {
      items: result.rows.map(toPlanRow),
      totalElements: Number(count.rows[0].total),
    };
  }

  /** Optimistic concurrency: the caller's If-Match version is in the WHERE;
   * rowCount 0 means conflict/gone and the caller re-reads to distinguish. */
  async updatePlanMeta(
    client: PoolClient,
    tenantId: string,
    planId: string,
    expectedVersion: number,
    patch: PlanMetaPatch,
  ): Promise<PlanRow | null> {
    const result = await client.query(
      `UPDATE plan
       SET title = coalesce($4, title),
           hazard_type = coalesce($5, hazard_type),
           management_phase = coalesce($6, management_phase),
           version_no = version_no + 1
       WHERE plan_id = $1 AND tenant_id = $2 AND version_no = $3 AND deleted_at IS NULL
       RETURNING plan_id, tenant_id, title, hazard_type, management_phase, status, start_mode,
                 document_id, current_context_snapshot_id, current_toc_version_id,
                 owner_id, version_no, deleted_at, created_at, updated_at`,
      [
        planId,
        tenantId,
        expectedVersion,
        patch.title ?? null,
        patch.hazardType ?? null,
        patch.managementPhase ?? null,
      ],
    );
    return result.rows[0] ? toPlanRow(result.rows[0]) : null;
  }

  /** Trash move is idempotent: an already-deleted plan is left untouched. */
  async softDeletePlan(client: PoolClient, tenantId: string, planId: string): Promise<boolean> {
    const result = await client.query(
      `UPDATE plan
       SET deleted_at = now(), version_no = version_no + 1
       WHERE plan_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [planId, tenantId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** Single working draft per plan (uk_plan_context_draft_plan, ADR-23 D2). */
  async upsertDraft(
    client: PoolClient,
    planId: string,
    contextJson: unknown,
    schemaVersion: string,
    updatedBy: string,
  ): Promise<ContextDraftRow> {
    const result = await client.query(
      `INSERT INTO plan_context_draft (plan_id, context_json, schema_version, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (plan_id) DO UPDATE
         SET context_json = excluded.context_json,
             schema_version = excluded.schema_version,
             updated_by = excluded.updated_by
       RETURNING context_draft_id, plan_id, context_json, schema_version, updated_by, updated_at`,
      [planId, JSON.stringify(contextJson), schemaVersion, updatedBy],
    );
    const row = result.rows[0];
    return {
      contextDraftId: row.context_draft_id as string,
      planId: row.plan_id as string,
      contextJson: row.context_json,
      schemaVersion: row.schema_version as string,
      updatedBy: row.updated_by as string,
      updatedAt: row.updated_at as Date,
    };
  }

  async listSnapshots(
    client: PoolClient,
    tenantId: string,
    planId: string,
  ): Promise<SnapshotRow[]> {
    const result = await client.query(
      `SELECT s.context_snapshot_id, s.plan_id, s.version_no, s.context_json,
              s.content_hash, s.supersedes_id, s.confirmed_by, s.confirmed_at
       FROM plan_context_snapshot s
       JOIN plan p ON p.plan_id = s.plan_id AND p.tenant_id = $2
       WHERE s.plan_id = $1
       ORDER BY s.version_no DESC`,
      [planId, tenantId],
    );
    return result.rows.map(toSnapshotRow);
  }

  async findSnapshot(
    client: PoolClient,
    tenantId: string,
    snapshotId: string,
  ): Promise<SnapshotRow | null> {
    const result = await client.query(
      `SELECT s.context_snapshot_id, s.plan_id, s.version_no, s.context_json,
              s.content_hash, s.supersedes_id, s.confirmed_by, s.confirmed_at
       FROM plan_context_snapshot s
       JOIN plan p ON p.plan_id = s.plan_id AND p.tenant_id = $2
       WHERE s.context_snapshot_id = $1`,
      [snapshotId, tenantId],
    );
    return result.rows[0] ? toSnapshotRow(result.rows[0]) : null;
  }

  /** Caller must hold the plan row FOR UPDATE (version_no serialization). */
  async insertSnapshot(
    client: PoolClient,
    planId: string,
    versionNo: number,
    contextJson: unknown,
    contentHash: string,
    supersedesId: string | null,
    confirmedBy: string,
  ): Promise<SnapshotRow> {
    const result = await client.query(
      `INSERT INTO plan_context_snapshot
         (plan_id, version_no, context_json, content_hash, supersedes_id, confirmed_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING context_snapshot_id, plan_id, version_no, context_json,
                 content_hash, supersedes_id, confirmed_by, confirmed_at`,
      [planId, versionNo, JSON.stringify(contextJson), contentHash, supersedesId, confirmedBy],
    );
    return toSnapshotRow(result.rows[0]);
  }

  async nextSnapshotVersion(client: PoolClient, planId: string): Promise<number> {
    const result = await client.query(
      `SELECT coalesce(max(version_no), 0) + 1 AS next FROM plan_context_snapshot WHERE plan_id = $1`,
      [planId],
    );
    return Number(result.rows[0].next);
  }

  /** Same-transaction plan pointer/status update on snapshot confirm.
   * The status transition is decided by the domain (plan-status.ts,
   * ADR-23 D4); this method only records the decided value. */
  async setCurrentSnapshot(
    client: PoolClient,
    tenantId: string,
    planId: string,
    snapshotId: string,
    nextStatus: string,
  ): Promise<PlanRow> {
    const result = await client.query(
      `UPDATE plan
       SET current_context_snapshot_id = $3,
           status = $4,
           version_no = version_no + 1
       WHERE plan_id = $1 AND tenant_id = $2
       RETURNING plan_id, tenant_id, title, hazard_type, management_phase, status, start_mode,
                 document_id, current_context_snapshot_id, current_toc_version_id,
                 owner_id, version_no, deleted_at, created_at, updated_at`,
      [planId, tenantId, snapshotId, nextStatus],
    );
    return toPlanRow(result.rows[0]);
  }
}
