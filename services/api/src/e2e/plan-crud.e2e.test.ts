import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.factory';
import { buildMockExternalToken } from '../auth/mock-sso';
import { IdempotencyRepository, type IdempotencyRequest } from '../common/idempotency.repository';
import type { ApiConfig } from '../config/api-config';

/**
 * HTTP-level acceptance evidence for CC-110 (UNE-PLAN-001~008) against a real
 * migrated database, runtime role une_app (FORCE RLS applies). Skipped
 * without DATABASE_URL — the CI db-verify job runs it.
 */
const ADMIN_URL = process.env.DATABASE_URL;

const SECRET = 'e2e-signing-secret-e2e-signing-secret!!';
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

interface Fixtures {
  tenantA: string;
  tenantB: string;
  adminA: string;
  editorA: string;
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
  const tenantA = await tenant('plan-a');
  const tenantB = await tenant('plan-b');

  const user = async (tenantId: string, login: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, login],
      )
    ).rows[0].user_id as string;
  const adminA = await user(tenantA, 'admin-a');
  const editorA = await user(tenantA, 'editor-a');
  const plainA = await user(tenantA, 'plain-a');
  const userB = await user(tenantB, 'user-b');

  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('PLAN_CREATE','PLAN_READ','PLAN_EDIT','PLAN_DELETE')
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
  );
  await c.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     SELECT u.user_id, r.role_id, u.user_id
     FROM app_user u, role r
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
       AND u.user_id = ANY($1::uuid[])`,
    [[adminA, editorA, userB]],
  );
  return { tenantA, tenantB, adminA, editorA, plainA, userB };
}

const validContext = {
  subject: '폭염 대비 안전관리 계획',
  backgroundInfo: {
    disasterType: '폭염',
    controlPhase: '대비',
    location: '본청 관할',
    startTime: null,
    endTime: null,
    reportTime: null,
  },
  purposeOfDocument: {
    goalOfBusiness: '폭염 피해 최소화',
    role: '재난안전 담당자',
    targetAudiences: ['중앙정부', '지자체'],
  },
};

describe.skipIf(!ADMIN_URL)('CC-110 plan/context-snapshot e2e', () => {
  let dbName: string;
  let app: INestApplication;
  let base: string;
  let dbUrl: string;
  let fx: Fixtures;
  let tokenA: string;
  let tokenB: string;
  let tokenPlain: string;

  const login = async (tenantId: string, loginId: string): Promise<string> => {
    const res = await fetch(`${base}/api/v1/auth/sso/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ externalToken: buildMockExternalToken({ tenantId, loginId }) }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
  };

  const call = async (
    method: string,
    path: string,
    token: string,
    options: { body?: unknown; idempotencyKey?: string; ifMatch?: string } = {},
  ): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
        ...(options.ifMatch ? { 'if-match': options.ifMatch } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  const createPlan = async (
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ planId: string; versionNo: number }> => {
    const res = await call('POST', '/api/v1/plans', token, {
      idempotencyKey: `key_${randomUUID()}`,
      body: {
        title: '테스트 계획서',
        startMode: 'BLANK',
        hazardType: '폭염',
        managementPhase: '대비',
        ...overrides,
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { planId: string; versionNo: number } };
    return body.data;
  };

  beforeAll(async () => {
    if (!existsSync(MIGRATIONS_DIR)) {
      throw new Error(`migrations dir not found at ${MIGRATIONS_DIR}; run from services/api`);
    }
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc110_e2e_${randomUUID().slice(0, 8)}`;
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
    tokenA = await login(fx.tenantA, 'admin-a');
    tokenB = await login(fx.tenantB, 'user-b');
    tokenPlain = await login(fx.tenantA, 'plain-a');
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  it('creates a DRAFT plan with the required Idempotency-Key and audits PLAN_CREATED', async () => {
    const res = await call('POST', '/api/v1/plans', tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: {
        title: '생성 계획서',
        startMode: 'BLANK',
        hazardType: '지진',
        managementPhase: '예방',
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: Record<string, unknown>;
      meta: { correlationId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('DRAFT');
    expect(body.data.startMode).toBe('BLANK');
    expect(body.data.versionNo).toBe(1);
    expect(body.data.ownerId).toBe(fx.adminA);

    const audit = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'PLAN_CREATED' AND resource_id = $2`,
        [fx.tenantA, body.data.planId],
      ),
    );
    expect(audit.rowCount).toBe(1);
  });

  it('rejects create without Idempotency-Key (400) and with a malformed key', async () => {
    const missing = await call('POST', '/api/v1/plans', tokenA, {
      body: { title: 'x', startMode: 'BLANK', hazardType: '폭염', managementPhase: '대비' },
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('COM-0400');

    const malformed = await call('POST', '/api/v1/plans', tokenA, {
      idempotencyKey: 'bad key with spaces',
      body: { title: 'x', startMode: 'BLANK', hazardType: '폭염', managementPhase: '대비' },
    });
    expect(malformed.status).toBe(400);
  });

  it('replays the same key+payload (same plan, no duplicate) and 409s a different payload', async () => {
    const key = `key_${randomUUID()}`;
    const payload = {
      title: '멱등 계획서',
      startMode: 'BLANK',
      hazardType: '산불',
      managementPhase: '예방',
    };
    const first = await call('POST', '/api/v1/plans', tokenA, {
      idempotencyKey: key,
      body: payload,
    });
    expect(first.status).toBe(201);
    const created = ((await first.json()) as { data: { planId: string } }).data;

    const replay = await call('POST', '/api/v1/plans', tokenA, {
      idempotencyKey: key,
      body: payload,
    });
    expect(replay.status).toBe(201);
    expect(((await replay.json()) as { data: { planId: string } }).data.planId).toBe(
      created.planId,
    );

    const count = await withClient(dbUrl, (c) =>
      c.query(`SELECT count(*) AS n FROM plan WHERE title = '멱등 계획서'`),
    );
    expect(Number(count.rows[0].n)).toBe(1);

    const mismatch = await call('POST', '/api/v1/plans', tokenA, {
      idempotencyKey: key,
      body: { ...payload, title: '다른 내용' },
    });
    expect(mismatch.status).toBe(409);
    expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe('COM-0409');
  });

  it('validates the create payload (PLAN-4001, templateFileId deferred to CC-140)', async () => {
    const res = await call('POST', '/api/v1/plans', tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { title: '', startMode: 'NOPE', hazardType: '눈사태', templateFileId: randomUUID() },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; violations: { field: string }[] };
    };
    expect(body.error.code).toBe('PLAN-4001');
    const fields = body.error.violations.map((v) => v.field);
    expect(fields).toEqual(
      expect.arrayContaining([
        'title',
        'startMode',
        'hazardType',
        'managementPhase',
        'templateFileId',
      ]),
    );
  });

  it('scopes list/detail to the JWT tenant (cross-tenant read is 404)', async () => {
    const mine = await createPlan(tokenA, { title: '격리 검증' });

    const listB = await call('GET', '/api/v1/plans?keyword=격리', tokenB);
    expect(listB.status).toBe(200);
    expect(((await listB.json()) as { data: { totalElements: number } }).data.totalElements).toBe(
      0,
    );

    const crossDetail = await call('GET', `/api/v1/plans/${mine.planId}`, tokenB);
    expect(crossDetail.status).toBe(404);
    expect(((await crossDetail.json()) as { error: { code: string } }).error.code).toBe(
      'PLAN-4003',
    );
  });

  it('lists with filters and 1-based pagination', async () => {
    await createPlan(tokenA, { title: '목록-폭염', hazardType: '폭염' });
    await createPlan(tokenA, { title: '목록-지진', hazardType: '지진', managementPhase: '예방' });

    const res = await call(
      'GET',
      '/api/v1/plans?keyword=목록-&hazardType=지진&page=1&size=10',
      tokenA,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { items: { title: string }[]; page: number; totalElements: number; totalPages: number };
    };
    expect(body.data.page).toBe(1);
    expect(body.data.totalElements).toBe(1);
    expect(body.data.items.map((p) => p.title)).toEqual(['목록-지진']);

    const badQuery = await call('GET', '/api/v1/plans?status=BOGUS&size=0', tokenA);
    expect(badQuery.status).toBe(400);
    expect(((await badQuery.json()) as { error: { code: string } }).error.code).toBe('PLAN-4002');
  });

  it('serves detail with an ETag and enforces If-Match on PATCH (428/409/200)', async () => {
    const plan = await createPlan(tokenA, { title: '동시성 검증' });

    const detail = await call('GET', `/api/v1/plans/${plan.planId}`, tokenA);
    expect(detail.status).toBe(200);
    expect(detail.headers.get('etag')).toBe('"1"');

    const noHeader = await call('PATCH', `/api/v1/plans/${plan.planId}`, tokenA, {
      body: { title: '수정' },
    });
    expect(noHeader.status).toBe(428);
    expect(((await noHeader.json()) as { error: { code: string } }).error.code).toBe('COM-0428');

    const stale = await call('PATCH', `/api/v1/plans/${plan.planId}`, tokenA, {
      ifMatch: '"99"',
      body: { title: '수정' },
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('PLAN-409-001');

    const okRes = await call('PATCH', `/api/v1/plans/${plan.planId}`, tokenA, {
      ifMatch: '"1"',
      body: { title: '수정 완료', hazardType: '산불' },
    });
    expect(okRes.status).toBe(200);
    const updated = (await okRes.json()) as { data: { versionNo: number; title: string } };
    expect(updated.data.versionNo).toBe(2);
    expect(updated.data.title).toBe('수정 완료');
    expect(okRes.headers.get('etag')).toBe('"2"');

    const badField = await call('PATCH', `/api/v1/plans/${plan.planId}`, tokenA, {
      ifMatch: '"2"',
      body: { status: 'FINAL' },
    });
    expect(badField.status).toBe(400);
  });

  it('lets exactly one of two concurrent PATCHes win on the same version', async () => {
    const plan = await createPlan(tokenA, { title: '동시 수정' });
    const attempt = (title: string): Promise<number> =>
      call('PATCH', `/api/v1/plans/${plan.planId}`, tokenA, {
        ifMatch: '"1"',
        body: { title },
      }).then((r) => r.status);
    const statuses = (await Promise.all([attempt('갱신-1'), attempt('갱신-2')])).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('moves a plan to trash (204, idempotent), blocks edits there, and audits PLAN_DELETED', async () => {
    const plan = await createPlan(tokenA, { title: '휴지통 검증' });

    const del = await call('DELETE', `/api/v1/plans/${plan.planId}`, tokenA, {
      body: { reason: '테스트 정리' },
    });
    expect(del.status).toBe(204);

    const again = await call('DELETE', `/api/v1/plans/${plan.planId}`, tokenA);
    expect(again.status).toBe(204);

    const active = await call('GET', '/api/v1/plans?keyword=휴지통 검증', tokenA);
    expect(((await active.json()) as { data: { totalElements: number } }).data.totalElements).toBe(
      0,
    );
    const trash = await call('GET', '/api/v1/plans?keyword=휴지통 검증&inTrash=true', tokenA);
    expect(((await trash.json()) as { data: { totalElements: number } }).data.totalElements).toBe(
      1,
    );

    const patchTrashed = await call('PATCH', `/api/v1/plans/${plan.planId}`, tokenA, {
      ifMatch: '"2"',
      body: { title: '금지' },
    });
    expect(patchTrashed.status).toBe(412);
    expect(((await patchTrashed.json()) as { error: { code: string } }).error.code).toBe(
      'PLAN-412-002',
    );

    const audit = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'PLAN_DELETED' AND resource_id = $2`,
        [fx.tenantA, plan.planId],
      ),
    );
    expect(audit.rowCount).toBe(1);
  });

  it('denies plan APIs without the permission (403 COM-0403)', async () => {
    const res = await call('POST', '/api/v1/plans', tokenPlain, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { title: 'x', startMode: 'BLANK', hazardType: '폭염', managementPhase: '대비' },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('COM-0403');
  });

  it('saves a partial context draft, rejects type/enum violations, and upserts a single row', async () => {
    const plan = await createPlan(tokenA, { title: 'draft 검증' });

    const partial = await call('POST', `/api/v1/plans/${plan.planId}/context-drafts`, tokenA, {
      body: { context: { subject: '작성 중' } },
    });
    expect(partial.status).toBe(200);
    const draft1 = ((await partial.json()) as { data: { contextDraftId: string } }).data;

    const invalid = await call('POST', `/api/v1/plans/${plan.planId}/context-drafts`, tokenA, {
      body: { context: { subject: '작성 중', backgroundInfo: { disasterType: '눈사태' } } },
    });
    expect(invalid.status).toBe(422);
    const invalidBody = (await invalid.json()) as {
      error: { code: string; violations: { field: string }[] };
    };
    expect(invalidBody.error.code).toBe('PLAN-422-001');
    expect(invalidBody.error.violations.length).toBeGreaterThan(0);

    const second = await call('POST', `/api/v1/plans/${plan.planId}/context-drafts`, tokenA, {
      body: { context: validContext },
    });
    expect(second.status).toBe(200);
    const draft2 = ((await second.json()) as { data: { contextDraftId: string } }).data;
    expect(draft2.contextDraftId).toBe(draft1.contextDraftId);

    const rows = await withClient(dbUrl, (c) =>
      c.query(`SELECT count(*) AS n FROM plan_context_draft WHERE plan_id = $1`, [plan.planId]),
    );
    expect(Number(rows.rows[0].n)).toBe(1);
  });

  it('confirms an immutable snapshot: strict validation, hash/version, dedupe, supersedes', async () => {
    const plan = await createPlan(tokenA, { title: 'snapshot 검증' });

    const invalid = await call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { subject: '필수 누락' },
    });
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe('PLAN-422-001');

    const first = await call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: validContext,
    });
    expect(first.status).toBe(201);
    const snap1 = (
      (await first.json()) as {
        data: { contextSnapshotId: string; versionNo: number; contentHash: string };
      }
    ).data;
    expect(snap1.versionNo).toBe(1);
    expect(snap1.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const detail = await call('GET', `/api/v1/plans/${plan.planId}`, tokenA);
    const detailBody = (
      (await detail.json()) as {
        data: { status: string; currentContextSnapshotId: string };
      }
    ).data;
    expect(detailBody.status).toBe('CONTEXT_READY');
    expect(detailBody.currentContextSnapshotId).toBe(snap1.contextSnapshotId);

    // Same content, new key: dedupe returns the existing snapshot (no v2).
    const dedupe = await call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { ...validContext },
    });
    expect(dedupe.status).toBe(201);
    expect(
      ((await dedupe.json()) as { data: { contextSnapshotId: string } }).data.contextSnapshotId,
    ).toBe(snap1.contextSnapshotId);

    const changed = await call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { ...validContext, subject: '개정된 계획' },
    });
    expect(changed.status).toBe(201);
    const snap2 = ((await changed.json()) as { data: { versionNo: number; supersedesId: string } })
      .data;
    expect(snap2.versionNo).toBe(2);
    expect(snap2.supersedesId).toBe(snap1.contextSnapshotId);

    const list = await call('GET', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA);
    expect(list.status).toBe(200);
    const items = ((await list.json()) as { data: { items: { versionNo: number }[] } }).data.items;
    expect(items.map((s) => s.versionNo)).toEqual([2, 1]);

    const audit = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT 1 FROM audit_log
         WHERE tenant_id = $1 AND action = 'CONTEXT_SNAPSHOT_CREATED' AND resource_id = $2`,
        [fx.tenantA, plan.planId],
      ),
    );
    expect(audit.rowCount).toBe(2);
  });

  it('rejects context work on a trashed plan with 412', async () => {
    const plan = await createPlan(tokenA, { title: '휴지통 snapshot' });
    await call('DELETE', `/api/v1/plans/${plan.planId}`, tokenA);

    const draft = await call('POST', `/api/v1/plans/${plan.planId}/context-drafts`, tokenA, {
      body: { context: { subject: 'x' } },
    });
    expect(draft.status).toBe(412);

    const snapshot = await call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: validContext,
    });
    expect(snapshot.status).toBe(412);
    expect(((await snapshot.json()) as { error: { code: string } }).error.code).toBe(
      'PLAN-412-002',
    );
  });

  it('keeps snapshots immutable at the DB layer for the runtime role', async () => {
    const plan = await createPlan(tokenA, { title: '불변성 검증' });
    const res = await call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: validContext,
    });
    const snap = ((await res.json()) as { data: { contextSnapshotId: string } }).data;

    // une_app must be denied UPDATE/DELETE on plan_context_snapshot (0011).
    await withClient(dbUrl, async (c) => {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE une_app');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [fx.tenantA]);
      await expect(
        c.query(
          `UPDATE plan_context_snapshot SET content_hash = repeat('0', 64) WHERE context_snapshot_id = $1`,
          [snap.contextSnapshotId],
        ),
      ).rejects.toThrow(/permission denied/);
      await c.query('ROLLBACK');
    });
  });

  it('scopes the replay claim to the concrete path: same key+body on another plan creates, never replays (B1)', async () => {
    const p1 = await createPlan(tokenA, { title: 'B1 검증 1' });
    const p2 = await createPlan(tokenA, { title: 'B1 검증 2' });
    const key = `key_${randomUUID()}`;

    const r1 = await call('POST', `/api/v1/plans/${p1.planId}/context-snapshots`, tokenA, {
      idempotencyKey: key,
      body: validContext,
    });
    expect(r1.status).toBe(201);
    const r2 = await call('POST', `/api/v1/plans/${p2.planId}/context-snapshots`, tokenA, {
      idempotencyKey: key,
      body: validContext,
    });
    expect(r2.status).toBe(201);
    expect(((await r2.json()) as { data: { planId: string } }).data.planId).toBe(p2.planId);

    const counts = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT plan_id, count(*)::int AS n FROM plan_context_snapshot
         WHERE plan_id = ANY($1::uuid[]) GROUP BY plan_id`,
        [[p1.planId, p2.planId]],
      ),
    );
    expect(counts.rows).toHaveLength(2);
    expect(counts.rows.every((row) => row.n === 1)).toBe(true);
  });

  it('never replays another user’s claim: same tenant, same key+body, different principal → 409', async () => {
    const tokenEditor = await login(fx.tenantA, 'editor-a');
    const plan = await createPlan(tokenA, { title: '주체 격리' });
    const key = `key_${randomUUID()}`;

    const first = await call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
      idempotencyKey: key,
      body: validContext,
    });
    expect(first.status).toBe(201);

    const other = await call(
      'POST',
      `/api/v1/plans/${plan.planId}/context-snapshots`,
      tokenEditor,
      {
        idempotencyKey: key,
        body: validContext,
      },
    );
    expect(other.status).toBe(409);
    expect(((await other.json()) as { error: { code: string } }).error.code).toBe('COM-0409');
  });

  it('hides another tenant’s plan from every mutation path (404)', async () => {
    const mine = await createPlan(tokenA, { title: '교차 테넌트 변이' });
    const paths: [string, string, Record<string, unknown>][] = [
      ['PATCH', `/api/v1/plans/${mine.planId}`, { ifMatch: '"1"', body: { title: 'x' } }],
      ['DELETE', `/api/v1/plans/${mine.planId}`, {}],
      [
        'POST',
        `/api/v1/plans/${mine.planId}/context-drafts`,
        { body: { context: { subject: 'x' } } },
      ],
      [
        'POST',
        `/api/v1/plans/${mine.planId}/context-snapshots`,
        { idempotencyKey: `key_${randomUUID()}`, body: validContext },
      ],
      ['GET', `/api/v1/plans/${mine.planId}/context-snapshots`, {}],
    ];
    for (const [method, path, options] of paths) {
      const res = await call(method, path, tokenB, options);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('blocks trash/context work on approval-locked plans (403 PLAN-403-001 / 412 PLAN-412-002)', async () => {
    const plan = await createPlan(tokenA, { title: '승인 잠금' });
    await withClient(dbUrl, (c) =>
      c.query(`UPDATE plan SET status = 'APPROVED' WHERE plan_id = $1`, [plan.planId]),
    );

    const del = await call('DELETE', `/api/v1/plans/${plan.planId}`, tokenA);
    expect(del.status).toBe(403);
    expect(((await del.json()) as { error: { code: string } }).error.code).toBe('PLAN-403-001');

    const snapshot = await call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: validContext,
    });
    expect(snapshot.status).toBe(412);
    expect(((await snapshot.json()) as { error: { code: string } }).error.code).toBe(
      'PLAN-412-002',
    );

    const draft = await call('POST', `/api/v1/plans/${plan.planId}/context-drafts`, tokenA, {
      body: { context: { subject: 'x' } },
    });
    expect(draft.status).toBe(412);
  });

  it('serializes concurrent snapshot confirms into distinct versions', async () => {
    const plan = await createPlan(tokenA, { title: '동시 확정' });
    const confirm = (subject: string): Promise<number> =>
      call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { ...validContext, subject },
      }).then((r) => r.status);
    const statuses = await Promise.all([confirm('동시 확정 A'), confirm('동시 확정 B')]);
    expect(statuses).toEqual([201, 201]);

    const versions = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT version_no FROM plan_context_snapshot WHERE plan_id = $1 ORDER BY version_no`,
        [plan.planId],
      ),
    );
    expect(versions.rows.map((row) => row.version_no)).toEqual([1, 2]);
  });

  it('reports the true total on a page past the end (필수-3)', async () => {
    await createPlan(tokenA, { title: '페이지경계-1', hazardType: '황사' });
    await createPlan(tokenA, { title: '페이지경계-2', hazardType: '황사' });

    const past = await call('GET', '/api/v1/plans?hazardType=황사&page=9&size=20', tokenA);
    expect(past.status).toBe(200);
    const body = (
      (await past.json()) as {
        data: { items: unknown[]; totalElements: number; totalPages: number };
      }
    ).data;
    expect(body.items).toHaveLength(0);
    expect(body.totalElements).toBe(2);
    expect(body.totalPages).toBe(1);
  });

  it('returns the plan’s new ETag on snapshot confirm (immediate PATCH must not 409)', async () => {
    const plan = await createPlan(tokenA, { title: '확정 후 수정' });
    const confirmed = await call('POST', `/api/v1/plans/${plan.planId}/context-snapshots`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: validContext,
    });
    expect(confirmed.status).toBe(201);
    const etag = confirmed.headers.get('etag');
    expect(etag).toBe('"2"');

    const patched = await call('PATCH', `/api/v1/plans/${plan.planId}`, tokenA, {
      ifMatch: etag as string,
      body: { title: '확정 후 수정 완료' },
    });
    expect(patched.status).toBe(200);
  });

  it('resolves the claim decision table on real SQL: replay / FAILED retake / stale retake (ADR-23 D1)', async () => {
    const repo = new IdempotencyRepository();
    const idem = (overrides: Partial<IdempotencyRequest> = {}): IdempotencyRequest => ({
      tenantId: fx.tenantA,
      endpoint: 'POST /api/v1/plans/claim-table-test',
      key: 'claim-table-key',
      requestHash: 'a'.repeat(64),
      correlationId: 'corr_claim',
      createdBy: fx.adminA,
      ...overrides,
    });
    const inTx = async <T>(fn: (c: Client) => Promise<T>): Promise<T> =>
      withClient(dbUrl, async (c) => {
        await c.query('BEGIN');
        try {
          const result = await fn(c);
          await c.query('COMMIT');
          return result;
        } catch (err) {
          await c.query('ROLLBACK').catch(() => {});
          throw err;
        }
      });
    const asPoolClient = (c: Client): Parameters<IdempotencyRepository['claim']>[0] =>
      c as unknown as Parameters<IdempotencyRepository['claim']>[0];

    // 1. Fresh claim, then a fresh IN_PROGRESS is an in-flight conflict.
    expect((await inTx((c) => repo.claim(asPoolClient(c), idem()))).state).toBe('CLAIMED');
    expect((await inTx((c) => repo.claim(asPoolClient(c), idem()))).state).toBe('IN_FLIGHT');

    // 2. FAILED is retaken immediately.
    await inTx((c) => repo.recordFailure(asPoolClient(c), idem()));
    expect((await inTx((c) => repo.claim(asPoolClient(c), idem()))).state).toBe('CLAIMED');

    // 3. A stale IN_PROGRESS (claimed_at past the window) is retaken.
    await inTx((c) =>
      c.query(
        `UPDATE api_idempotency SET claimed_at = now() - interval '10 minutes'
         WHERE idempotency_key = 'claim-table-key'`,
      ),
    );
    expect((await inTx((c) => repo.claim(asPoolClient(c), idem()))).state).toBe('CLAIMED');

    // 4. COMPLETED with the same hash replays the stored response; a
    //    different hash or another principal is a mismatch.
    await inTx((c) =>
      repo.recordSuccess(asPoolClient(c), idem(), 201, { success: true, data: { ok: 1 } }),
    );
    const replay = await inTx((c) => repo.claim(asPoolClient(c), idem()));
    expect(replay).toMatchObject({ state: 'REPLAY', status: 201 });
    expect(
      (await inTx((c) => repo.claim(asPoolClient(c), idem({ requestHash: 'b'.repeat(64) })))).state,
    ).toBe('MISMATCH');
    expect(
      (await inTx((c) => repo.claim(asPoolClient(c), idem({ createdBy: fx.editorA })))).state,
    ).toBe('MISMATCH');
  });

  it('audits before_json for PLAN_UPDATED (title/hazard history is recoverable)', async () => {
    const plan = await createPlan(tokenA, { title: '이력 검증', hazardType: '산불' });
    await call('PATCH', `/api/v1/plans/${plan.planId}`, tokenA, {
      ifMatch: '"1"',
      body: { title: '이력 검증 개정' },
    });
    const audit = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT before_json FROM audit_log
         WHERE tenant_id = $1 AND action = 'PLAN_UPDATED' AND resource_id = $2`,
        [fx.tenantA, plan.planId],
      ),
    );
    expect(audit.rowCount).toBe(1);
    const before = audit.rows[0].before_json as { title: string; hazardType: string };
    expect(before.title).toBe('이력 검증');
    expect(before.hazardType).toBe('산불');
  });
});
