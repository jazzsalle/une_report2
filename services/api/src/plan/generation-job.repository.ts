import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/** generation_job reads/writes for the API plane (UNE-PLAN-009 ~ 013).
 * Every query runs inside DatabaseService.withTenant and still carries an
 * explicit tenant predicate (ADR-21 compensating control); the API never
 * scans across tenants — that is the worker's dispatch scope (0015 §7). */

export interface JobRow {
  jobId: string;
  tenantId: string;
  jobType: string;
  aggregateType: string;
  aggregateId: string;
  providerCode: string;
  requestJson: unknown;
  status: string;
  progressPct: number;
  idempotencyKey: string;
  correlationId: string;
  errorJson: Record<string, unknown> | null;
  attemptNo: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobInsert {
  tenantId: string;
  jobType: string;
  aggregateType: string;
  aggregateId: string;
  providerCode: string;
  requestJson: unknown;
  idempotencyKey: string;
  correlationId: string;
}

export interface JobStatusPatch {
  status: string;
  /** undefined keeps the column, null clears it (retry clears the failure). */
  errorJson?: Record<string, unknown> | null;
  progressPct?: number;
  /** undefined keeps the column, null clears it (a requeued job has no end). */
  finishedAt?: Date | null;
  /** User-driven retry resets the automatic-retry budget (ADR-25 D9). */
  attemptNo?: number;
}

/** Non-terminal states: a TOC job in any of these occupies the plan
 * (UNE-PLAN-009 409 PLAN-409-002). */
const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'];

const JOB_COLUMNS = `job_id, tenant_id, job_type, aggregate_type, aggregate_id, provider_code,
         request_json, status, progress_pct, idempotency_key, correlation_id, error_json,
         attempt_no, started_at, finished_at, created_at, updated_at`;

const JOB_SELECT = `SELECT ${JOB_COLUMNS} FROM generation_job`;

function toJobRow(row: Record<string, unknown>): JobRow {
  return {
    jobId: row.job_id as string,
    tenantId: row.tenant_id as string,
    jobType: row.job_type as string,
    aggregateType: row.aggregate_type as string,
    aggregateId: row.aggregate_id as string,
    providerCode: row.provider_code as string,
    requestJson: row.request_json,
    status: row.status as string,
    // numeric(5,2) arrives as a string from node-postgres.
    progressPct: Number(row.progress_pct),
    idempotencyKey: row.idempotency_key as string,
    correlationId: row.correlation_id as string,
    errorJson: (row.error_json as Record<string, unknown> | null) ?? null,
    attemptNo: Number(row.attempt_no),
    startedAt: (row.started_at as Date | null) ?? null,
    finishedAt: (row.finished_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

@Injectable()
export class GenerationJobRepository {
  /** Always inserts QUEUED/0% — the API only ever enqueues; RUNNING and the
   * terminal states belong to the worker (0015 §7 WITH CHECK).
   * A uk_job_idempotency (tenant_id, idempotency_key) collision is raised as a
   * plain 23505 pg error: the caller wraps this in a SAVEPOINT and falls back
   * to findJobByIdempotencyKey (second idempotency net behind api_idempotency,
   * whose claim row can be stale/taken over — ADR-23 D1). */
  async insertJob(client: PoolClient, input: JobInsert): Promise<JobRow> {
    const result = await client.query(
      `INSERT INTO generation_job
         (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
          status, progress_pct, idempotency_key, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', 0, $7, $8)
       RETURNING ${JOB_COLUMNS}`,
      [
        input.tenantId,
        input.jobType,
        input.aggregateType,
        input.aggregateId,
        input.providerCode,
        JSON.stringify(input.requestJson),
        input.idempotencyKey,
        input.correlationId,
      ],
    );
    return toJobRow(result.rows[0]);
  }

  async findJobByIdempotencyKey(
    client: PoolClient,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<JobRow | null> {
    const result = await client.query(
      `${JOB_SELECT}
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, idempotencyKey],
    );
    return result.rows[0] ? toJobRow(result.rows[0]) : null;
  }

  async findJob(
    client: PoolClient,
    tenantId: string,
    jobId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<JobRow | null> {
    const result = await client.query(
      `${JOB_SELECT}
       WHERE job_id = $1 AND tenant_id = $2${options.forUpdate ? '\n       FOR UPDATE' : ''}`,
      [jobId, tenantId],
    );
    return result.rows[0] ? toJobRow(result.rows[0]) : null;
  }

  /** At most one non-terminal generation job per plan — job-type-agnostic
   * since CC-130 (ADR-27 D9): a TOC job regenerating the outline while a
   * CONTENT job writes under its node keys would orphan anchors. The caller
   * holds the plan row FOR UPDATE, which serializes concurrent requests. */
  async findActivePlanJob(
    client: PoolClient,
    tenantId: string,
    planId: string,
  ): Promise<JobRow | null> {
    const result = await client.query(
      `${JOB_SELECT}
       WHERE tenant_id = $1
         AND aggregate_type = 'PLAN'
         AND aggregate_id = $2
         AND status = ANY($3::text[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, planId, ACTIVE_JOB_STATUSES],
    );
    return result.rows[0] ? toJobRow(result.rows[0]) : null;
  }

  /**
   * 상황당 활성 SOP 생성 Job은 하나다 (CC-240).
   *
   * `findActivePlanJob`을 재사용하지 않는 이유: 저쪽은 잡 유형을 가리지 않는데,
   * 상황에는 SOP 말고도 다른 유형의 잡이 붙을 수 있다(정황 수집 등). SOP 두
   * 개가 동시에 끝나면 같은 근거에서 나온 버전이 둘 생겨 "그 상황의 절차"가
   * 무엇인지 말할 수 없게 된다 — 막아야 하는 것은 그 경우뿐이다.
   */
  async findActiveSopJob(
    client: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<JobRow | null> {
    const result = await client.query(
      `${JOB_SELECT}
       WHERE tenant_id = $1
         AND job_type = 'SOP'
         AND aggregate_type = 'SITUATION'
         AND aggregate_id = $2
         AND status = ANY($3::text[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, situationId, ACTIVE_JOB_STATUSES],
    );
    return result.rows[0] ? toJobRow(result.rows[0]) : null;
  }

  /** Records a status decided by the domain (canTransitionJob is evaluated by
   * the service, which holds the row FOR UPDATE). */
  async updateJobStatus(
    client: PoolClient,
    tenantId: string,
    jobId: string,
    patch: JobStatusPatch,
  ): Promise<JobRow | null> {
    const params: unknown[] = [jobId, tenantId, patch.status];
    const sets = ['status = $3'];
    if (patch.errorJson !== undefined) {
      params.push(patch.errorJson === null ? null : JSON.stringify(patch.errorJson));
      sets.push(`error_json = $${params.length}`);
    }
    if (patch.progressPct !== undefined) {
      params.push(patch.progressPct);
      sets.push(`progress_pct = $${params.length}`);
    }
    if (patch.attemptNo !== undefined) {
      params.push(patch.attemptNo);
      sets.push(`attempt_no = $${params.length}`);
    }
    if (patch.finishedAt !== undefined) {
      params.push(patch.finishedAt);
      sets.push(`finished_at = $${params.length}`);
    }
    const result = await client.query(
      `UPDATE generation_job
       SET ${sets.join(', ')}
       WHERE job_id = $1 AND tenant_id = $2
       RETURNING ${JOB_COLUMNS}`,
      params,
    );
    return result.rows[0] ? toJobRow(result.rows[0]) : null;
  }
}
