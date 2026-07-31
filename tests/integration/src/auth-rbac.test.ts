import { createHash } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_URL, createTestDb, dropTestDb, migrate, withClient } from './db-helpers';

/**
 * DB-level evidence for CC-100 / migration 0012 (ADR-22): the RBAC catalog,
 * runtime read-only global rows, role_permission privileges, and the
 * parent-aggregate join that compensates for child tables without tenant_id.
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

interface IamFixture {
  tenantId: string;
  userId: string;
  sessionId: string;
}

async function insertIamFixture(c: Client, code: string): Promise<IamFixture> {
  const tenant = await c.query(
    `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1, $1, 'ACTIVE')
     RETURNING tenant_id`,
    [code],
  );
  const tenantId = tenant.rows[0].tenant_id as string;
  const user = await c.query(
    `INSERT INTO app_user (tenant_id, login_id, display_name, status)
     VALUES ($1, $2, 'CC-100 fixture', 'ACTIVE') RETURNING user_id`,
    [tenantId, `cc100-${code}`],
  );
  const userId = user.rows[0].user_id as string;
  const hash = createHash('sha256').update(`cc100-${code}`).digest('hex');
  const session = await c.query(
    `INSERT INTO user_session (user_id, refresh_hash, expires_at)
     VALUES ($1, $2, now() + interval '1 hour') RETURNING session_id`,
    [userId, hash],
  );
  return { tenantId, userId, sessionId: session.rows[0].session_id as string };
}

describe.skipIf(!ADMIN_URL)('CC-100 RBAC catalog and tenant scoping (0012)', () => {
  let db: { name: string; url: string };
  let fxA: IamFixture;
  let fxB: IamFixture;

  beforeAll(async () => {
    db = await createTestDb('cc100_rbac');
    await migrate(db.url);
    fxA = await withClient(db.url, (c) => insertIamFixture(c, 'ra'));
    fxB = await withClient(db.url, (c) => insertIamFixture(c, 'rb'));
  }, 120_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('seeds the full permission catalog (54 contract x-permission codes)', async () => {
    const count = await withClient(db.url, (c) =>
      c.query(`SELECT count(*)::int AS n FROM permission`),
    );
    expect(count.rows[0].n).toBe(54);
  });

  it('seeds the 15 global system roles from the screen/permission design', async () => {
    const roles = await withClient(db.url, (c) =>
      c.query(`SELECT count(*)::int AS n FROM role WHERE tenant_id IS NULL AND is_system`),
    );
    expect(roles.rows[0].n).toBe(15);
  });

  it('is idempotent: re-inserting a system role hits the partial unique index', async () => {
    await withClient(db.url, async (c) => {
      const dup = await c.query(
        `INSERT INTO role (tenant_id, role_code, role_name, scope_type, is_system)
         VALUES (NULL, 'SYSTEM_ADMIN', 'dup', 'SYSTEM', true)
         ON CONFLICT (role_code) WHERE tenant_id IS NULL DO NOTHING
         RETURNING role_id`,
      );
      expect(dup.rowCount).toBe(0);
    });
  });

  it('lets une_app read global role rows but not update them (runtime read-only)', async () => {
    await asAppRole(db.url, fxA.tenantId, async (c) => {
      const visible = await c.query(`SELECT count(*)::int AS n FROM role WHERE tenant_id IS NULL`);
      expect(visible.rows[0].n).toBe(15);
      // FORCE RLS WITH CHECK only accepts rows of the current tenant, so an
      // UPDATE keeping tenant_id NULL is rejected by the policy.
      await expect(
        c.query(`UPDATE role SET role_name = 'hijacked' WHERE role_code = 'SYSTEM_ADMIN'`),
      ).rejects.toThrow(/row-level security|policy/i);
    });
  });

  it('denies une_app writes on the RBAC catalogs (provisioning-only)', async () => {
    // 0012 (role_permission) + 0013 (permission): SELECT is the only runtime
    // privilege on both global catalogs.
    for (const table of ['role_permission', 'permission']) {
      const grants = await withClient(db.url, (c) =>
        c.query(
          `SELECT privilege_type FROM information_schema.role_table_grants
           WHERE grantee = 'une_app' AND table_name = $1`,
          [table],
        ),
      );
      expect(grants.rows.map((r) => r.privilege_type as string).sort(), table).toEqual(['SELECT']);
    }
  });

  it('indexes user_session.refresh_hash uniquely (0013)', async () => {
    const idx = await withClient(db.url, (c) =>
      c.query(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'user_session' AND indexname = 'uk_user_session_refresh_hash'`,
      ),
    );
    expect(idx.rows).toHaveLength(1);
    expect(idx.rows[0].indexdef).toContain('UNIQUE');
  });

  it('enforces tenant scoping on user_session only through the app_user parent join', async () => {
    await asAppRole(db.url, fxA.tenantId, async (c) => {
      // user_session has no tenant_id and no RLS: the compensating control
      // (ADR-21) is the parent join every repository must use. The join hides
      // the other tenant's session...
      const joined = await c.query(
        `SELECT s.session_id
         FROM user_session s
         JOIN app_user u ON u.user_id = s.user_id AND u.tenant_id = $1`,
        [fxA.tenantId],
      );
      expect(joined.rows.map((r) => r.session_id)).toEqual([fxA.sessionId]);
      expect(joined.rows.map((r) => r.session_id)).not.toContain(fxB.sessionId);
      // ...while a bare select would not — this documents why the service
      // layer must never query child tables without the parent aggregate.
      const bare = await c.query(`SELECT count(*)::int AS n FROM user_session`);
      expect(bare.rows[0].n).toBe(2);
    });
  });

  it('resolves permissions only through tenant-scoped joins with validity windows', async () => {
    await withClient(db.url, async (c) => {
      await c.query(
        `INSERT INTO role_permission (role_id, permission_id)
         SELECT r.role_id, p.permission_id FROM role r, permission p
         WHERE r.role_code = 'AUDITOR' AND r.tenant_id IS NULL
           AND p.permission_code = 'AUDIT_READ'
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
      );
      await c.query(
        `INSERT INTO user_role (user_id, role_id, granted_by, valid_to)
         SELECT $1, r.role_id, $1, NULL FROM role r
         WHERE r.role_code = 'AUDITOR' AND r.tenant_id IS NULL`,
        [fxA.userId],
      );
      // Expired binding for tenant B's user must not grant anything.
      await c.query(
        `INSERT INTO user_role (user_id, role_id, granted_by, valid_to)
         SELECT $1, r.role_id, $1, now() - interval '1 day' FROM role r
         WHERE r.role_code = 'AUDITOR' AND r.tenant_id IS NULL`,
        [fxB.userId],
      );
    });

    const query = `
      SELECT DISTINCT p.permission_code
      FROM user_role ur
      JOIN app_user u ON u.user_id = ur.user_id AND u.tenant_id = $2
      JOIN role r ON r.role_id = ur.role_id AND (r.tenant_id = $2 OR r.tenant_id IS NULL)
      JOIN role_permission rp ON rp.role_id = r.role_id
      JOIN permission p ON p.permission_id = rp.permission_id
      WHERE ur.user_id = $1
        AND (ur.valid_from IS NULL OR ur.valid_from <= now())
        AND (ur.valid_to IS NULL OR ur.valid_to > now())`;

    await asAppRole(db.url, fxA.tenantId, async (c) => {
      const mine = await c.query(query, [fxA.userId, fxA.tenantId]);
      expect(mine.rows.map((r) => r.permission_code)).toEqual(['AUDIT_READ']);
    });
    await asAppRole(db.url, fxB.tenantId, async (c) => {
      const expired = await c.query(query, [fxB.userId, fxB.tenantId]);
      expect(expired.rowCount).toBe(0);
    });
  });
});
