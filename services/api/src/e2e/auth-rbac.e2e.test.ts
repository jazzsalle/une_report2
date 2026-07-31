import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.factory';
import { buildMockExternalToken } from '../auth/mock-sso';
import { signAccessToken } from '../auth/tokens';
import type { ApiConfig } from '../config/api-config';

/**
 * HTTP-level acceptance evidence for CC-100 against a real migrated database.
 * The app pool connects with the admin URL but downgrades every transaction
 * with SET LOCAL ROLE une_app (runtimeRole), so FORCE RLS applies exactly as
 * it does for the production une_app login. Skipped without DATABASE_URL.
 */
const ADMIN_URL = process.env.DATABASE_URL;

const SECRET = 'e2e-signing-secret-e2e-signing-secret!!';
// vitest runs with the package dir as cwd (pnpm -r / --filter both do).
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

interface Fixtures {
  tenantA: string;
  tenantB: string;
  tenantSuspended: string;
  orgRootA: string;
  orgChildA: string;
  adminA: string;
  plainA: string;
  userB: string;
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function insertFixtures(c: Client): Promise<Fixtures> {
  const tenant = async (code: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1, $1, 'ACTIVE')
         RETURNING tenant_id`,
        [code],
      )
    ).rows[0].tenant_id as string;
  const tenantA = await tenant('e2e-a');
  const tenantB = await tenant('e2e-b');
  const tenantSuspended = (
    await c.query(
      `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ('e2e-s', 'e2e-s', 'SUSPENDED')
       RETURNING tenant_id`,
    )
  ).rows[0].tenant_id as string;

  const org = async (tenantId: string, code: string, parent: string | null): Promise<string> =>
    (
      await c.query(
        `INSERT INTO organization (tenant_id, parent_id, org_code, org_name, org_path, status)
         VALUES ($1, $2, $3, $3, $4, 'ACTIVE') RETURNING organization_id`,
        [tenantId, parent, code, parent ? `/root/${code}` : '/root'],
      )
    ).rows[0].organization_id as string;
  const orgRootA = await org(tenantA, 'root-a', null);
  const orgChildA = await org(tenantA, 'child-a', orgRootA);
  await org(tenantB, 'root-b', null);

  const user = async (tenantId: string, login: string, orgId: string | null): Promise<string> =>
    (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, organization_id, status)
         VALUES ($1, $2, $2, $3, 'ACTIVE') RETURNING user_id`,
        [tenantId, login, orgId],
      )
    ).rows[0].user_id as string;
  const adminA = await user(tenantA, 'admin-a', orgRootA);
  const plainA = await user(tenantA, 'plain-a', orgChildA);
  const userB = await user(tenantB, 'user-b', null);
  await user(tenantSuspended, 'user-s', null);

  // 0012 seeds the global system roles; grant a permission set to
  // INSTITUTION_ADMIN and bind admin-a / user-b to it. plain-a keeps no roles.
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('ORG_READ','USER_READ','RBAC_READ')
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
  );
  await c.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     SELECT u.user_id, r.role_id, u.user_id
     FROM app_user u, role r
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
       AND u.user_id = ANY($1::uuid[])`,
    [[adminA, userB]],
  );
  return { tenantA, tenantB, tenantSuspended, orgRootA, orgChildA, adminA, plainA, userB };
}

describe.skipIf(!ADMIN_URL)('CC-100 auth/tenant/RBAC e2e', () => {
  let dbName: string;
  let app: INestApplication;
  let base: string;
  let dbUrl: string;
  let fx: Fixtures;

  const exchange = async (tenantId: string, loginId: string): Promise<Response> =>
    fetch(`${base}/api/v1/auth/sso/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': `corr_${loginId}` },
      body: JSON.stringify({ externalToken: buildMockExternalToken({ tenantId, loginId }) }),
    });

  const login = async (
    tenantId: string,
    loginId: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    userContext: { tenantId: string; permissions: string[] };
  }> => {
    const res = await exchange(tenantId, loginId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: never };
    expect(body.success).toBe(true);
    return body.data;
  };

  const get = async (path: string, token: string): Promise<Response> =>
    fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    if (!existsSync(MIGRATIONS_DIR)) {
      throw new Error(`migrations dir not found at ${MIGRATIONS_DIR}; run from services/api`);
    }
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc100_e2e_${randomUUID().slice(0, 8)}`;
    // Concurrent CREATE DATABASE calls (root pnpm -r test runs packages in
    // parallel) can collide on the template1 lock; retry briefly.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await withClient(ADMIN_URL as string, (c) => c.query(`CREATE DATABASE ${dbName}`));
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    adminUrl.pathname = `/${dbName}`;
    dbUrl = adminUrl.toString();
    await runner({
      databaseUrl: dbUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: 'pgmigrations',
      ignorePattern: '\\..*|README\\.md',
      direction: 'up',
      logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
    });
    fx = await withClient(dbUrl, insertFixtures);

    const config: ApiConfig = {
      port: 0,
      authMode: 'mock',
      jwtSecret: SECRET,
      accessTtlSec: 900,
      refreshTtlSec: 3600,
      databaseUrl: dbUrl,
      runtimeRole: 'une_app',
    };
    app = await createApp(config);
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  it('issues envelope-wrapped tokens for a valid mock identity and audits LOGIN', async () => {
    const data = await login(fx.tenantA, 'admin-a');
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toMatch(/^urs\./);
    expect(data.userContext.tenantId).toBe(fx.tenantA);
    expect(data.userContext.permissions).toContain('ORG_READ');

    const audit = await withClient(dbUrl, (c) =>
      c.query(`SELECT actor_id FROM audit_log WHERE tenant_id = $1 AND action = 'LOGIN'`, [
        fx.tenantA,
      ]),
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('rejects a forged tenant claim in the mock token (cross-tenant login) and audits the failure', async () => {
    // admin-a exists in tenant A only; asserting tenant B must fail closed.
    const res = await exchange(fx.tenantB, 'admin-a');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('AUTH-1003');

    const audit = await withClient(dbUrl, (c) =>
      c.query(`SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'LOGIN_FAILED'`, [
        fx.tenantB,
      ]),
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('rejects a nonexistent tenant without failing on the audit path', async () => {
    const res = await exchange(randomUUID(), 'admin-a');
    expect(res.status).toBe(401);
  });

  it('rejects tokens signed with a foreign key and tampered tenant claims', async () => {
    const forged = signAccessToken(
      'attacker-secret-attacker-secret-!!!!',
      { userId: fx.adminA, tenantId: fx.tenantA, sessionId: randomUUID() },
      900,
    );
    const res = await get('/api/v1/auth/me', forged);
    expect(res.status).toBe(401);

    const { accessToken } = await login(fx.tenantA, 'admin-a');
    const [h, p, s] = accessToken.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as { tid: string };
    payload.tid = fx.tenantB;
    const tampered = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.');
    const crossed = await get('/api/v1/organizations/tree', tampered);
    expect(crossed.status).toBe(401);
  });

  it('filters organization data by the JWT tenant even in mock mode', async () => {
    const a = await login(fx.tenantA, 'admin-a');
    const b = await login(fx.tenantB, 'user-b');

    const treeA = await get('/api/v1/organizations/tree', a.accessToken);
    expect(treeA.status).toBe(200);
    const bodyA = (await treeA.json()) as { data: { orgCode: string; children: unknown[] }[] };
    expect(bodyA.data.map((n) => n.orgCode)).toEqual(['root-a']);
    expect(bodyA.data[0].children).toHaveLength(1);

    const treeB = await get('/api/v1/organizations/tree', b.accessToken);
    const bodyB = (await treeB.json()) as { data: { orgCode: string }[] };
    expect(bodyB.data.map((n) => n.orgCode)).toEqual(['root-b']);
  });

  it('rejects a client-picked foreign tenantId query param', async () => {
    const a = await login(fx.tenantA, 'admin-a');
    const res = await get(`/api/v1/organizations/tree?tenantId=${fx.tenantB}`, a.accessToken);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ORG-2001');
  });

  it('scopes user search to the JWT tenant and masks PII columns', async () => {
    const a = await login(fx.tenantA, 'admin-a');
    const res = await get('/api/v1/users?size=50', a.accessToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: Record<string, unknown>[]; totalElements: number };
    };
    const logins = body.data.items.map((u) => u.loginId);
    expect(logins).toContain('admin-a');
    expect(logins).not.toContain('user-b');
    expect(body.data.items[0]).not.toHaveProperty('emailEnc');
    expect(body.data.items[0]).not.toHaveProperty('email_enc');
  });

  it('denies a permission the user lacks with 403 and audits ACCESS_DENIED', async () => {
    const plain = await login(fx.tenantA, 'plain-a');
    const res = await get('/api/v1/organizations/tree', plain.accessToken);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('COM-0403');

    const audit = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'ACCESS_DENIED' AND actor_id = $2`,
        [fx.tenantA, fx.plainA],
      ),
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('serves global system roles through /roles (global rows readable at runtime)', async () => {
    const a = await login(fx.tenantA, 'admin-a');
    const res = await get('/api/v1/roles', a.accessToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { roleCode: string; tenantId: string | null }[] };
    const codes = body.data.map((r) => r.roleCode);
    expect(codes).toContain('SYSTEM_ADMIN');
    expect(codes).toContain('INSTITUTION_ADMIN');
    expect(body.data.every((r) => r.tenantId === null || r.tenantId === fx.tenantA)).toBe(true);
  });

  it('rotates refresh tokens, rejects forged-tenant refresh, and revokes on logout', async () => {
    const a = await login(fx.tenantA, 'admin-a');

    const refreshed = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: a.refreshToken }),
    });
    expect(refreshed.status).toBe(200);
    const next = ((await refreshed.json()) as { data: { refreshToken: string } }).data;
    expect(next.refreshToken).not.toBe(a.refreshToken);

    // The rotated-out (old) token must be dead.
    const replayed = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: a.refreshToken }),
    });
    expect(replayed.status).toBe(401);

    // Same random part, forged tenant segment: parent join must reject it.
    const forgedTenant = next.refreshToken.replace(fx.tenantA, fx.tenantB);
    const forged = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: forgedTenant }),
    });
    expect(forged.status).toBe(401);

    const fresh = await login(fx.tenantA, 'admin-a');
    const out = await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${fresh.accessToken}` },
    });
    expect(out.status).toBe(200);
    const afterLogout = await fetch(`${base}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: fresh.refreshToken }),
    });
    expect(afterLogout.status).toBe(401);

    const audit = await withClient(dbUrl, (c) =>
      c.query(`SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'LOGOUT'`, [fx.tenantA]),
    );
    expect(audit.rowCount).toBeGreaterThan(0);

    const second = await fetch(`${base}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${fresh.accessToken}` },
    });
    expect(second.status).toBe(409);
  });

  it('rejects login into a SUSPENDED tenant', async () => {
    const res = await exchange(fx.tenantSuspended, 'user-s');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH-1003');
  });

  it('survives an over-width X-Correlation-Id: login succeeds and the audit row is written', async () => {
    // audit_log.correlation_id is varchar(80); the middleware must replace a
    // 100-char client value instead of letting the audit INSERT abort login.
    const res = await fetch(`${base}/api/v1/auth/sso/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'c'.repeat(100) },
      body: JSON.stringify({
        externalToken: buildMockExternalToken({ tenantId: fx.tenantA, loginId: 'plain-a' }),
      }),
    });
    expect(res.status).toBe(200);
    const audit = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT correlation_id FROM audit_log
         WHERE tenant_id = $1 AND action = 'LOGIN' AND actor_id = $2`,
        [fx.tenantA, fx.plainA],
      ),
    );
    expect(audit.rowCount).toBeGreaterThan(0);
    expect((audit.rows[0].correlation_id as string).length).toBeLessThanOrEqual(80);
  });

  it('lets exactly one of two concurrent refresh calls win (rotation conflict)', async () => {
    const session = await login(fx.tenantA, 'admin-a');
    const attempt = (): Promise<number> =>
      fetch(`${base}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }).then((r) => r.status);
    const statuses = (await Promise.all([attempt(), attempt()])).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it('answers 503 AUTH-1004 when AUTH_MODE is not mock', async () => {
    const disabled = await createApp({
      port: 0,
      authMode: 'disabled',
      jwtSecret: '',
      accessTtlSec: 900,
      refreshTtlSec: 3600,
      databaseUrl: dbUrl,
      runtimeRole: 'une_app',
    });
    await disabled.listen(0);
    try {
      const url = (await disabled.getUrl()).replace('[::1]', '127.0.0.1');
      const res = await fetch(`${url}/api/v1/auth/sso/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          externalToken: buildMockExternalToken({ tenantId: fx.tenantA, loginId: 'admin-a' }),
        }),
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('AUTH-1004');
    } finally {
      await disabled.close();
    }
  });

  it('keeps /health public and unprefixed', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });
});
