import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PUBLIC_JOB_EVENT_TYPES, type JobEventType } from '@une/domain';

/** job_event is append-only (0015 §5 revokes UPDATE/DELETE from une_app) and
 * carries no tenant_id: every read joins generation_job and filters on
 * g.tenant_id (ADR-21 compensating control for child tables RLS does not
 * cover). */

export interface JobEventRow {
  sequenceNo: number;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/** Passed as a text[] parameter rather than inlined so the public vocabulary
 * has exactly one definition (@une/domain), shared with the worker. */
const PUBLIC_EVENT_TYPES: string[] = [...PUBLIC_JOB_EVENT_TYPES];

@Injectable()
export class JobEventRepository {
  /**
   * Appends the next sequence_no for the job. The inline sub-select is safe
   * because every caller holds the parent generation_job row FOR UPDATE, which
   * serializes appends per job; uk_job_event_seq (0015) is the backstop that
   * turns any violation of that rule into an error instead of an ambiguous
   * SSE resume point.
   */
  async append(
    client: PoolClient,
    jobId: string,
    eventType: JobEventType,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const result = await client.query(
      `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
       VALUES (
         $1,
         (SELECT coalesce(max(sequence_no), 0) + 1 FROM job_event WHERE job_id = $1),
         $2,
         $3
       )
       RETURNING sequence_no`,
      [jobId, eventType, JSON.stringify(payload)],
    );
    return Number(result.rows[0].sequence_no);
  }

  /** UNE-PLAN-011 stream page: public vocabulary only — provider traces
   * (provider.requested/responded/failed) must never reach a client. */
  async listPublicSince(
    client: PoolClient,
    tenantId: string,
    jobId: string,
    afterSequenceNo: number,
  ): Promise<JobEventRow[]> {
    const result = await client.query(
      `SELECT e.sequence_no, e.event_type, e.payload_json, e.created_at
       FROM job_event e
       JOIN generation_job g ON g.job_id = e.job_id AND g.tenant_id = $2
       WHERE e.job_id = $1
         AND e.sequence_no > $3
         AND e.event_type = ANY($4::text[])
       ORDER BY e.sequence_no`,
      [jobId, tenantId, afterSequenceNo, PUBLIC_EVENT_TYPES],
    );
    return result.rows.map((row) => ({
      sequenceNo: Number(row.sequence_no),
      eventType: row.event_type as string,
      payload: (row.payload_json as Record<string, unknown>) ?? {},
      createdAt: row.created_at as Date,
    }));
  }

  /** UNE-PLAN-010 projects GenerationJobResource.result from the terminal
   * job.completed event (generation_job has no result column). */
  async findCompletedResult(
    client: PoolClient,
    tenantId: string,
    jobId: string,
  ): Promise<Record<string, unknown> | null> {
    const result = await client.query(
      `SELECT e.payload_json
       FROM job_event e
       JOIN generation_job g ON g.job_id = e.job_id AND g.tenant_id = $2
       WHERE e.job_id = $1 AND e.event_type = 'job.completed'
       ORDER BY e.sequence_no DESC
       LIMIT 1`,
      [jobId, tenantId],
    );
    return result.rows[0]
      ? ((result.rows[0].payload_json as Record<string, unknown>) ?? null)
      : null;
  }
}
