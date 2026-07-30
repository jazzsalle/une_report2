import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_URL,
  APPEND_ONLY_TABLES,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
} from './db-helpers';

const RLS_TABLES = [
  'tenant',
  'organization',
  'app_user',
  'role',
  'plan',
  'generation_job',
  'document',
  'file_object',
  'situation',
  'knowledge_document',
  'sop',
  'execution_event',
  'outbox_message',
  'provider_config',
  'audit_log',
  'retention_policy',
  'notification',
];

describe.skipIf(!ADMIN_URL)('empty-database migration (CC-004)', () => {
  let db: { name: string; url: string };

  beforeAll(async () => {
    db = await createTestDb('cc004_empty');
    await migrate(db.url);
  }, 120_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('applies all 11 baseline migrations', async () => {
    const applied = await withClient(db.url, (c) =>
      c.query('SELECT name FROM pgmigrations ORDER BY id'),
    );
    expect(applied.rows).toHaveLength(11);
    expect(applied.rows[0].name).toBe('0001_extensions_and_common');
    expect(applied.rows[10].name).toBe('0011_force_rls_and_app_role_grants');
  });

  it('creates the 57-table design baseline', async () => {
    const tables = await withClient(db.url, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
           AND table_name <> 'pgmigrations'`,
      ),
    );
    expect(tables.rows[0].n).toBe(57);
  });

  it('enables and forces RLS on all tenant-isolated tables', async () => {
    const flags = await withClient(db.url, (c) =>
      c.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
         WHERE relname = ANY($1) AND relkind = 'r'`,
        [RLS_TABLES],
      ),
    );
    expect(flags.rows).toHaveLength(RLS_TABLES.length);
    for (const row of flags.rows) {
      expect(row.relrowsecurity, `${row.relname} RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} RLS forced`).toBe(true);
    }
  });

  it('provides une_app as a non-superuser, non-bypassrls role', async () => {
    const role = await withClient(db.url, (c) =>
      c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'une_app'`),
    );
    expect(role.rows).toHaveLength(1);
    expect(role.rows[0].rolsuper).toBe(false);
    expect(role.rows[0].rolbypassrls).toBe(false);
  });

  it('denies une_app UPDATE/DELETE on append-only and immutable tables', async () => {
    const privs = await withClient(db.url, (c) =>
      c.query(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'une_app'
           AND table_name = ANY($1)
           AND privilege_type IN ('UPDATE', 'DELETE')`,
        [APPEND_ONLY_TABLES],
      ),
    );
    expect(privs.rows).toHaveLength(0);
  });

  it('gives une_app zero privileges on the migration-history table', async () => {
    const privs = await withClient(db.url, (c) =>
      c.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'une_app' AND table_name = 'pgmigrations'`,
      ),
    );
    expect(privs.rows).toHaveLength(0);
  });

  it('enforces the outbox idempotency unique key (idempotency_key, channel)', async () => {
    const idx = await withClient(db.url, (c) =>
      c.query(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'outbox_message' AND indexname = 'uk_outbox_idem'`,
      ),
    );
    expect(idx.rows).toHaveLength(1);
    expect(idx.rows[0].indexdef).toContain('UNIQUE');
  });
});

describe.skipIf(!ADMIN_URL)('upgrade migration on fixture data (CC-004)', () => {
  let db: { name: string; url: string };

  beforeAll(async () => {
    db = await createTestDb('cc004_upgrade');
  }, 120_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('upgrades a populated 0010-level database to 0011 without data loss', async () => {
    await migrate(db.url, 10);
    const fixture = await withClient(db.url, (c) => insertFixture(c, 'upg'));

    await migrate(db.url); // remaining: 0011

    const rows = await withClient(db.url, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM tenant) AS tenants,
                (SELECT count(*)::int FROM situation) AS situations,
                (SELECT count(*)::int FROM dispatch) AS dispatches,
                (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'tenant') AS forced`,
      ),
    );
    expect(rows.rows[0]).toEqual({ tenants: 1, situations: 1, dispatches: 1, forced: true });

    const applied = await withClient(db.url, (c) =>
      c.query('SELECT count(*)::int AS n FROM pgmigrations'),
    );
    expect(applied.rows[0].n).toBe(11);
    expect(fixture.tenantId).toBeTruthy();
  }, 120_000);
});
