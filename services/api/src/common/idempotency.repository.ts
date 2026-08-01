import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/** api_idempotency access (ADR-23 D1). Claims run in their own short
 * transaction, separate from the handler's transaction; see the decision
 * table in ADR-23 for the claim/replay/mismatch semantics. */

export const IDEMPOTENCY_STALE_MS = 5 * 60 * 1000;

export interface IdempotencyRequest {
  tenantId: string;
  endpoint: string;
  key: string;
  requestHash: string;
  correlationId: string;
  createdBy: string;
}

export type ClaimResult =
  | { state: 'CLAIMED' }
  | { state: 'REPLAY'; status: number; body: unknown }
  | { state: 'MISMATCH' }
  | { state: 'IN_FLIGHT' };

@Injectable()
export class IdempotencyRepository {
  async claim(client: PoolClient, req: IdempotencyRequest, retried = false): Promise<ClaimResult> {
    const inserted = await client.query(
      `INSERT INTO api_idempotency
         (tenant_id, endpoint, idempotency_key, request_hash, correlation_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, endpoint, idempotency_key) DO NOTHING
       RETURNING idempotency_id`,
      [req.tenantId, req.endpoint, req.key, req.requestHash, req.correlationId, req.createdBy],
    );
    if (inserted.rows.length > 0) return { state: 'CLAIMED' };

    // Lost the insert: resolve against the existing record. FOR UPDATE makes
    // a concurrent claimer wait for this transaction, so exactly one caller
    // decides per key at a time.
    const existing = await client.query(
      `SELECT state, request_hash, response_status, response_body, claimed_at, created_by
       FROM api_idempotency
       WHERE tenant_id = $1 AND endpoint = $2 AND idempotency_key = $3
       FOR UPDATE`,
      [req.tenantId, req.endpoint, req.key],
    );
    const row = existing.rows[0];
    if (!row) {
      // Row vanished (ops cleanup between statements); one fresh attempt,
      // then give up as an in-flight conflict rather than recursing forever.
      if (retried) return { state: 'IN_FLIGHT' };
      return this.claim(client, req, true);
    }
    // Another principal's claim is never replayed to this caller, even with
    // an identical body — same-tenant users must not read each other's
    // responses through key collisions.
    if ((row.created_by as string) !== req.createdBy) return { state: 'MISMATCH' };
    if ((row.request_hash as string) !== req.requestHash) return { state: 'MISMATCH' };
    if (row.state === 'COMPLETED') {
      return {
        state: 'REPLAY',
        status: row.response_status as number,
        body: row.response_body,
      };
    }
    const claimedAt = (row.claimed_at as Date).getTime();
    if (row.state === 'IN_PROGRESS' && Date.now() - claimedAt < IDEMPOTENCY_STALE_MS) {
      return { state: 'IN_FLIGHT' };
    }
    // FAILED, or IN_PROGRESS gone stale (process died before recording):
    // take the claim over so the retry can run.
    await client.query(
      `UPDATE api_idempotency
       SET state = 'IN_PROGRESS', claimed_at = now(), correlation_id = $4,
           response_status = NULL, response_body = NULL, completed_at = NULL
       WHERE tenant_id = $1 AND endpoint = $2 AND idempotency_key = $3`,
      [req.tenantId, req.endpoint, req.key, req.correlationId],
    );
    return { state: 'CLAIMED' };
  }

  /** Records a success response for replay; only 2xx results are stored (ADR-23 D1). */
  async recordSuccess(
    client: PoolClient,
    req: IdempotencyRequest,
    status: number,
    body: unknown,
  ): Promise<void> {
    await client.query(
      `UPDATE api_idempotency
       SET state = 'COMPLETED', response_status = $4, response_body = $5, completed_at = now()
       WHERE tenant_id = $1 AND endpoint = $2 AND idempotency_key = $3
         AND state = 'IN_PROGRESS'`,
      [req.tenantId, req.endpoint, req.key, status, JSON.stringify(body)],
    );
  }

  /** Marks a handler failure so the next retry re-claims immediately;
   * the error response itself is never stored (transient failures must not
   * stick to the key). */
  async recordFailure(client: PoolClient, req: IdempotencyRequest): Promise<void> {
    await client.query(
      `UPDATE api_idempotency
       SET state = 'FAILED'
       WHERE tenant_id = $1 AND endpoint = $2 AND idempotency_key = $3
         AND state = 'IN_PROGRESS'`,
      [req.tenantId, req.endpoint, req.key],
    );
  }
}
