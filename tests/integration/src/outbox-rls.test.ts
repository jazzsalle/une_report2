import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_URL,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
  type Fixture,
} from './db-helpers';

const EVENT_HASH = 'a'.repeat(64);

/**
 * Runs fn as the runtime role: SET ROLE une_app downgrades the superuser
 * connection (RLS applies to the current role), SET app.tenant_id feeds
 * une_current_tenant_id(). Both are session-scoped to this client.
 */
async function asAppRole<T>(
  url: string,
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query('SET ROLE une_app');
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return fn(c);
  });
}

describe.skipIf(!ADMIN_URL)('outbox transaction atomicity and RLS (CC-004)', () => {
  let db: { name: string; url: string };
  let fx: Fixture;
  let otherTenantFx: Fixture;

  beforeAll(async () => {
    db = await createTestDb('cc004_outbox');
    await migrate(db.url);
    fx = await withClient(db.url, (c) => insertFixture(c, 'ta'));
    otherTenantFx = await withClient(db.url, (c) => insertFixture(c, 'tb'));
  }, 120_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('commits dispatch state change + execution event + outbox insert atomically', async () => {
    await asAppRole(db.url, fx.tenantId, async (c) => {
      await c.query('BEGIN');
      await c.query(`UPDATE dispatch SET status = 'SENT' WHERE dispatch_id = $1`, [fx.dispatchId]);
      await c.query(
        `INSERT INTO execution_event
           (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
            payload_json, correlation_id, event_hash, actor_id)
         VALUES ($1, $2, 'DISPATCH', $3, 'DISPATCH_SENT', '{}', $4, $5, $6)`,
        [fx.tenantId, fx.situationId, fx.dispatchId, randomUUID(), EVENT_HASH, fx.userId],
      );
      await c.query(
        `INSERT INTO outbox_message
           (tenant_id, aggregate_type, aggregate_id, event_type, payload_json,
            channel, status, idempotency_key)
         VALUES ($1, 'DISPATCH', $2, 'DISPATCH_SENT', '{}', 'SYSTEM', 'PENDING', $3)`,
        [fx.tenantId, fx.dispatchId, randomUUID()],
      );
      await c.query('COMMIT');
    });

    const state = await withClient(db.url, (c) =>
      c.query(
        `SELECT (SELECT status FROM dispatch WHERE dispatch_id = $1) AS dispatch_status,
                (SELECT count(*)::int FROM execution_event WHERE aggregate_id = $1) AS events,
                (SELECT count(*)::int FROM outbox_message WHERE aggregate_id = $1) AS outbox`,
        [fx.dispatchId],
      ),
    );
    expect(state.rows[0]).toEqual({ dispatch_status: 'SENT', events: 1, outbox: 1 });
  });

  it('rolls back all three writes when the outbox insert fails', async () => {
    // Snapshot current state so this test does not depend on which tests ran
    // before it; rollback must restore exactly this state.
    const before = await withClient(db.url, (c) =>
      c.query(
        `SELECT (SELECT status FROM dispatch WHERE dispatch_id = $1) AS dispatch_status,
                (SELECT count(*)::int FROM execution_event WHERE aggregate_id = $1) AS events,
                (SELECT count(*)::int FROM outbox_message WHERE aggregate_id = $1) AS outbox`,
        [fx.dispatchId],
      ),
    );

    await asAppRole(db.url, fx.tenantId, async (c) => {
      await c.query('BEGIN');
      await c.query(`UPDATE dispatch SET status = 'FAILED' WHERE dispatch_id = $1`, [
        fx.dispatchId,
      ]);
      await c.query(
        `INSERT INTO execution_event
           (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
            payload_json, correlation_id, event_hash)
         VALUES ($1, $2, 'DISPATCH', $3, 'DISPATCH_FAILED', '{}', $4, $5)`,
        [fx.tenantId, fx.situationId, fx.dispatchId, randomUUID(), EVENT_HASH],
      );
      await expect(
        c.query(
          `INSERT INTO outbox_message
             (tenant_id, aggregate_type, aggregate_id, event_type, payload_json,
              channel, status, idempotency_key)
           VALUES ($1, 'DISPATCH', $2, 'DISPATCH_FAILED', '{}', 'SYSTEM', 'PENDING', NULL)`,
          [fx.tenantId, fx.dispatchId],
        ),
      ).rejects.toThrow(/null value|not-null/);
      await c.query('ROLLBACK');
    });

    const after = await withClient(db.url, (c) =>
      c.query(
        `SELECT (SELECT status FROM dispatch WHERE dispatch_id = $1) AS dispatch_status,
                (SELECT count(*)::int FROM execution_event WHERE aggregate_id = $1) AS events,
                (SELECT count(*)::int FROM outbox_message WHERE aggregate_id = $1) AS outbox`,
        [fx.dispatchId],
      ),
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.rows[0].dispatch_status).not.toBe('FAILED');
  });

  it('rejects a duplicate (idempotency_key, channel) outbox insert', async () => {
    const key = randomUUID();
    const insertOnce = (c: Client) =>
      c.query(
        `INSERT INTO outbox_message
           (tenant_id, aggregate_type, aggregate_id, event_type, payload_json,
            channel, status, idempotency_key)
         VALUES ($1, 'DISPATCH', $2, 'DUP_TEST', '{}', 'SYSTEM', 'PENDING', $3)`,
        [fx.tenantId, randomUUID(), key],
      );
    await asAppRole(db.url, fx.tenantId, async (c) => {
      await insertOnce(c);
      await expect(insertOnce(c)).rejects.toThrow(/duplicate key.*uk_outbox_idem/);
    });
  });

  it('blocks une_app UPDATE on the append-only execution_event table', async () => {
    await asAppRole(db.url, fx.tenantId, async (c) => {
      await expect(c.query(`UPDATE execution_event SET event_type = 'TAMPERED'`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it('isolates tenants: une_app sees only its own tenant rows', async () => {
    const visible = await asAppRole(db.url, fx.tenantId, (c) =>
      c.query('SELECT tenant_id FROM situation'),
    );
    expect(visible.rows).toHaveLength(1);
    expect(visible.rows[0].tenant_id).toBe(fx.tenantId);
  });

  it('returns no rows when app.tenant_id is not set', async () => {
    const visible = await asAppRole(db.url, null, (c) =>
      c.query('SELECT count(*)::int AS n FROM situation'),
    );
    expect(visible.rows[0].n).toBe(0);
  });

  it('rejects writes for a different tenant (WITH CHECK)', async () => {
    await asAppRole(db.url, fx.tenantId, async (c) => {
      await expect(
        c.query(
          `INSERT INTO outbox_message
             (tenant_id, aggregate_type, aggregate_id, event_type, payload_json,
              channel, status, idempotency_key)
           VALUES ($1, 'DISPATCH', $2, 'X', '{}', 'SYSTEM', 'PENDING', $3)`,
          [otherTenantFx.tenantId, randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('lets une_app read global rows (tenant_id IS NULL) but not create them', async () => {
    // Global system row is provisioned via the admin path only.
    await withClient(db.url, (c) =>
      c.query(
        `INSERT INTO role (tenant_id, role_code, role_name, scope_type, is_system)
         VALUES (NULL, 'SYS_ADMIN', 'System Admin', 'SYSTEM', true)`,
      ),
    );

    await asAppRole(db.url, fx.tenantId, async (c) => {
      const visible = await c.query(`SELECT role_code FROM role WHERE tenant_id IS NULL`);
      expect(visible.rows.map((r) => r.role_code)).toContain('SYS_ADMIN');

      await expect(
        c.query(
          `INSERT INTO role (tenant_id, role_code, role_name, scope_type)
           VALUES (NULL, 'EVIL_GLOBAL', 'x', 'SYSTEM')`,
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('rejects an outbox insert without tenant_id (removed random default)', async () => {
    await asAppRole(db.url, fx.tenantId, async (c) => {
      await expect(
        c.query(
          `INSERT INTO outbox_message
             (aggregate_type, aggregate_id, event_type, payload_json,
              channel, status, idempotency_key)
           VALUES ('DISPATCH', $1, 'X', '{}', 'SYSTEM', 'PENDING', $2)`,
          [randomUUID(), randomUUID()],
        ),
        // NULL tenant_id trips the RLS WITH CHECK before NOT NULL; either
        // error proves the old silent random-default insert is impossible.
      ).rejects.toThrow(/null value in column "tenant_id"|row-level security/);
    });
  });
});
