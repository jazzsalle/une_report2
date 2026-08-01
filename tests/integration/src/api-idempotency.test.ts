import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_URL,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
  type Fixture,
} from './db-helpers';

/** CC-110 / migration 0014: api_idempotency replay store, single plan draft,
 * plan.start_mode — constraints, RLS isolation, and runtime grants. */

async function asAppRole(c: Client, tenantId: string): Promise<void> {
  await c.query('BEGIN');
  await c.query('SET LOCAL ROLE une_app');
  await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
}

describe.skipIf(!ADMIN_URL)('api_idempotency and plan hardening (CC-110)', () => {
  let db: { name: string; url: string };
  let fxA: Fixture;
  let fxB: Fixture;

  beforeAll(async () => {
    db = await createTestDb('cc110_idem');
    await migrate(db.url);
    await withClient(db.url, async (c) => {
      fxA = await insertFixture(c, 'cc110-a');
      fxB = await insertFixture(c, 'cc110-b');
    });
  }, 120_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('enforces one replay record per (tenant, endpoint, key)', async () => {
    await withClient(db.url, async (c) => {
      const insert = (hash: string): Promise<unknown> =>
        c.query(
          `INSERT INTO api_idempotency
             (tenant_id, endpoint, idempotency_key, request_hash, correlation_id, created_by)
           VALUES ($1, 'POST /api/v1/plans', 'dup-key', $2, 'corr_x', $3)`,
          [fxA.tenantId, hash, fxA.userId],
        );
      await insert('a'.repeat(64));
      await expect(insert('b'.repeat(64))).rejects.toThrow(/uk_api_idempotency_key/);
      // The same key under another tenant is a different scope.
      await c.query(
        `INSERT INTO api_idempotency
           (tenant_id, endpoint, idempotency_key, request_hash, correlation_id, created_by)
         VALUES ($1, 'POST /api/v1/plans', 'dup-key', $2, 'corr_x', $3)`,
        [fxB.tenantId, 'c'.repeat(64), fxB.userId],
      );
    });
  });

  it('checks the state/completion invariants', async () => {
    await withClient(db.url, async (c) => {
      await expect(
        c.query(
          `INSERT INTO api_idempotency
             (tenant_id, endpoint, idempotency_key, request_hash, correlation_id, created_by, state)
           VALUES ($1, 'POST /x', 'bad-state', $2, 'corr_x', $3, 'DONE')`,
          [fxA.tenantId, 'd'.repeat(64), fxA.userId],
        ),
      ).rejects.toThrow(/ck_api_idempotency_state/);
      // COMPLETED requires response_status + completed_at together.
      await expect(
        c.query(
          `INSERT INTO api_idempotency
             (tenant_id, endpoint, idempotency_key, request_hash, correlation_id, created_by, state)
           VALUES ($1, 'POST /x', 'bad-complete', $2, 'corr_x', $3, 'COMPLETED')`,
          [fxA.tenantId, 'e'.repeat(64), fxA.userId],
        ),
      ).rejects.toThrow(/ck_api_idempotency_completed/);
    });
  });

  it('isolates replay records by tenant under FORCE RLS and denies runtime DELETE', async () => {
    await withClient(db.url, async (c) => {
      await asAppRole(c, fxB.tenantId);
      const visible = await c.query(
        `SELECT tenant_id FROM api_idempotency WHERE idempotency_key = 'dup-key'`,
      );
      expect(visible.rows).toHaveLength(1);
      expect(visible.rows[0].tenant_id).toBe(fxB.tenantId);
      // Cross-tenant insert must fail the policy WITH CHECK.
      await expect(
        c.query(
          `INSERT INTO api_idempotency
             (tenant_id, endpoint, idempotency_key, request_hash, correlation_id, created_by)
           VALUES ($1, 'POST /x', 'cross-tenant', $2, 'corr_x', $3)`,
          [fxA.tenantId, 'f'.repeat(64), fxA.userId],
        ),
      ).rejects.toThrow();
      await c.query('ROLLBACK');
    });
    await withClient(db.url, async (c) => {
      await asAppRole(c, fxA.tenantId);
      await expect(c.query(`DELETE FROM api_idempotency`)).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
    });
  });

  it('allows only one context draft per plan (uk_plan_context_draft_plan)', async () => {
    await withClient(db.url, async (c) => {
      const plan = await c.query(
        `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
         VALUES ($1, 'draft-unique', '폭염', '대비', 'DRAFT', $2) RETURNING plan_id`,
        [fxA.tenantId, fxA.userId],
      );
      const planId = plan.rows[0].plan_id as string;
      const insertDraft = (): Promise<unknown> =>
        c.query(
          `INSERT INTO plan_context_draft (plan_id, context_json, schema_version, updated_by)
           VALUES ($1, '{}', '1.0', $2)`,
          [planId, fxA.userId],
        );
      await insertDraft();
      await expect(insertDraft()).rejects.toThrow(/uk_plan_context_draft_plan/);
    });
  });

  it('defaults and constrains plan.start_mode (ADR-23 D3)', async () => {
    await withClient(db.url, async (c) => {
      const plan = await c.query(
        `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
         VALUES ($1, 'start-mode-default', '지진', '예방', 'DRAFT', $2) RETURNING start_mode`,
        [fxA.tenantId, fxA.userId],
      );
      expect(plan.rows[0].start_mode).toBe('BLANK');
      await expect(
        c.query(
          `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, start_mode, owner_id)
           VALUES ($1, 'bad-mode', '지진', '예방', 'DRAFT', 'MAGIC', $2)`,
          [fxA.tenantId, fxA.userId],
        ),
      ).rejects.toThrow(/ck_plan_start_mode/);
    });
  });
});
