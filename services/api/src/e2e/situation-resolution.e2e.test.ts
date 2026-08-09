import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.factory';
import { buildMockExternalToken } from '../auth/mock-sso';
import { e2eApiConfig } from './test-config';

/**
 * CC-210 인수 증거 (UNE-SIT-009~013).
 *
 * 인수기준 네 가지가 각각 어느 describe에 있는지:
 *   1. unresolved conflict block → "확정 차단"
 *   2. immutable snapshot        → "불변"
 *   3. hash/version              → "해시와 버전"
 *   4. change comparison         → "Diff"
 */
const ADMIN_URL = process.env.DATABASE_URL;
const SECRET = 'e2e-signing-secret-e2e-signing-secret!!';
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

interface Fixtures {
  tenantA: string;
  tenantB: string;
  adminA: string;
  readerA: string;
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
  const tenantA = await tenant('res-a');
  const tenantB = await tenant('res-b');

  const user = async (tenantId: string, login: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, login],
      )
    ).rows[0].user_id as string;
  const adminA = await user(tenantA, 'admin-a');
  const readerA = await user(tenantA, 'reader-a');
  const userB = await user(tenantB, 'user-b');

  // 확정 권한(SITUATION_CONFIRM)을 가진 역할과 갖지 않은 역할을 나눈다 —
  // SIT-011/012의 권한 경계를 실제로 밟아야 하기 때문이다.
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('SITUATION_CREATE','SITUATION_READ','SITUATION_EDIT',
                                'SITUATION_FACT_COLLECT','SITUATION_FACT_EDIT','SITUATION_CONFIRM')
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

  // readerA에는 **확정만 없는** 역할을 준다.
  //
  // 처음에는 아무 역할도 주지 않았는데, 그러면 "SITUATION_CONFIRM이 없으면
  // 403" 테스트가 엔드포인트가 SITUATION_READ만 요구해도 통과한다 — 권한
  // 경계를 격리하지 못한다(QA 리뷰 G-4).
  const reviewer = await c.query(
    `INSERT INTO role (tenant_id, role_code, role_name, scope_type)
     VALUES ($1, 'CC210_REVIEWER', '검토자(확정 제외)', 'TENANT')
     RETURNING role_id`,
    [tenantA],
  );
  const reviewerRoleId = reviewer.rows[0].role_id as string;
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT $1, p.permission_id FROM permission p
     WHERE p.permission_code IN ('SITUATION_READ','SITUATION_EDIT',
                                 'SITUATION_FACT_COLLECT','SITUATION_FACT_EDIT')`,
    [reviewerRoleId],
  );
  await c.query(`INSERT INTO user_role (user_id, role_id, granted_by) VALUES ($1, $2, $1)`, [
    readerA,
    reviewerRoleId,
  ]);

  return { tenantA, tenantB, adminA, readerA, userB };
}

interface Envelope<T> {
  success: boolean;
  data: T;
  meta: { correlationId: string };
}

interface FactBody {
  factId: string;
  factKey: string;
  value: unknown;
  unit: string | null;
  versionNo: number;
  status: string;
  originalFactId: string | null;
  derivedReason: string | null;
}

interface ConflictBody {
  conflictId: string;
  groupKey: string | null;
  factKey: string;
  conflictType: string;
  status: string;
  candidateFactIds: string[];
}

interface SnapshotBody {
  snapshotId: string;
  versionNo: number;
  contentHash: string;
  supersedesSnapshotId: string | null;
  effectiveAt: string;
  facts: { factId: string; factKey: string; value: unknown; status: string }[];
}

const EFFECTIVE = '2026-08-08T09:00:00+09:00';

describe.skipIf(!ADMIN_URL)('CC-210 duplicate / conflict / snapshot e2e', () => {
  let dbName: string;
  let app: INestApplication;
  let base: string;
  let dbUrl: string;
  let fx: Fixtures;
  let tokenA: string;
  let tokenB: string;
  let tokenReader: string;

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

  const createSituation = async (): Promise<string> => {
    const res = await call('POST', '/api/v1/situations', tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { mode: 'LIVE', title: 'CC-210 상황', hazardType: '태풍/호우' },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Envelope<{ situationId: string }>).data.situationId;
  };

  /** 같은 표준 Key에 서로 다른 값을 넣어 VALUE 충돌을 만든다. */
  const addFact = async (situationId: string, body: Record<string, unknown>): Promise<FactBody> => {
    const res = await call('POST', `/api/v1/situations/${situationId}/facts`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Envelope<FactBody>).data;
  };

  const deduplicate = async (
    situationId: string,
    body: Record<string, unknown> = {},
  ): Promise<{
    groups: unknown[];
    conflicts: ConflictBody[];
    conflictsOpened: number;
    conflictsObsoleted: number;
  }> => {
    const res = await call('POST', `/api/v1/situations/${situationId}/facts/deduplicate`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body,
    });
    expect(res.status).toBe(200);
    return (
      (await res.json()) as Envelope<{
        groups: unknown[];
        conflicts: ConflictBody[];
        conflictsOpened: number;
        conflictsObsoleted: number;
      }>
    ).data;
  };

  /** `expectedSnapshotId`는 계약이 required로 둔다 — 첫 확정은 null이고
   * 재확정은 직전 판을 명시해야 한다(ADR-34 D17). */
  const confirm = async (
    situationId: string,
    factIds: string[],
    overrides: Record<string, unknown> = {},
  ): Promise<Response> =>
    call('POST', `/api/v1/situations/${situationId}/snapshots`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { factIds, effectiveAt: EFFECTIVE, expectedSnapshotId: null, ...overrides },
    });

  beforeAll(async () => {
    if (!existsSync(MIGRATIONS_DIR)) {
      throw new Error(`migrations dir not found at ${MIGRATIONS_DIR}`);
    }
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc210_e2e_${randomUUID().slice(0, 8)}`;
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

    app = await createApp(e2eApiConfig({ databaseUrl: dbUrl, jwtSecret: SECRET }));
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    tokenA = await login(fx.tenantA, 'admin-a');
    tokenB = await login(fx.tenantB, 'user-b');
    tokenReader = await login(fx.tenantA, 'reader-a');
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  // ── UNE-SIT-009 / 010 ────────────────────────────────────────────────────

  describe('중복군과 충돌 탐지 (UNE-SIT-009 / 010)', () => {
    it('같은 Key의 다른 값이 그룹으로 묶이고 VALUE 충돌이 열린다', async () => {
      const situationId = await createSituation();
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 27,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });

      const result = await deduplicate(situationId);
      expect(result.groups).toHaveLength(1);
      expect(result.conflictsOpened).toBe(1);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].conflictType).toBe('VALUE');
      expect(result.conflicts[0].status).toBe('OPEN');
      expect(result.conflicts[0].candidateFactIds).toHaveLength(2);

      const list = await call('GET', `/api/v1/situations/${situationId}/conflicts`, tokenA);
      expect(list.status).toBe(200);
      const body = (await list.json()) as Envelope<ConflictBody[]>;
      expect(body.data).toHaveLength(1);
    });

    it('값도 시각도 같으면 중복이지 충돌이 아니다', async () => {
      const situationId = await createSituation();
      for (let i = 0; i < 2; i += 1) {
        await addFact(situationId, {
          factType: 'WEATHER_OBSERVATION',
          factKey: 'humidity',
          value: 60,
          unit: '%',
          observedAt: EFFECTIVE,
        });
      }
      const result = await deduplicate(situationId);
      expect(result.groups).toHaveLength(1);
      expect(result.conflictsOpened).toBe(0);
    });

    it('재계산이 이미 해소한 결정을 되살리지 않는다', async () => {
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 27,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const first = await deduplicate(situationId);
      const conflictId = first.conflicts[0].conflictId;

      const resolved = await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${conflictId}/resolve`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { selectedFactId: a.factId, reason: '기상청 값 채택' },
        },
      );
      expect(resolved.status).toBe(200);

      // 다시 계산해도 OPEN 충돌은 생기지 않는다. 부분 유니크는 OPEN에만
      // 걸리므로 이것을 막는 것은 "같은 후보 집합의 선행 충돌" 검사다 —
      // 없으면 사용자가 해소한 판단이 재계산 한 번으로 되살아난다.
      const again = await deduplicate(situationId);
      expect(again.conflictsOpened).toBe(0);
      expect(again.conflicts).toHaveLength(0);
    });

    it('후보 집합이 달라지면 새 충돌을 연다 (새 값이 도착했으므로 다시 판단해야 한다)', async () => {
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 27,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const first = await deduplicate(situationId);
      await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${first.conflicts[0].conflictId}/resolve`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { selectedFactId: a.factId, reason: '채택' },
        },
      );

      // 세 번째 값이 도착한다 — 후보 집합이 달라졌다.
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 30,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const again = await deduplicate(situationId);
      expect(again.conflictsOpened).toBe(1);
    });

    it('전략과 창을 바꾸면 다시 계산된다 (이전 그룹은 대체된다)', async () => {
      const situationId = await createSituation();
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: '2026-08-08T00:00:00+09:00',
      });
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: '2026-08-08T09:00:00+09:00',
      });

      // 60분 창에서는 다른 그룹이라 묶이지 않는다.
      expect((await deduplicate(situationId)).groups).toHaveLength(0);
      // KEY_ONLY는 시각을 무시하므로 묶인다.
      const byKey = await deduplicate(situationId, { strategy: 'KEY_ONLY' });
      expect(byKey.groups).toHaveLength(1);

      const stored = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM fact_duplicate_group WHERE situation_id = $1`, [
          situationId,
        ]),
      );
      expect(stored.rows[0].n).toBe(1);
    });
  });

  // ── UNE-SIT-011 ──────────────────────────────────────────────────────────

  describe('충돌 확정 (UNE-SIT-011)', () => {
    const openConflict = async (): Promise<{
      situationId: string;
      conflictId: string;
      a: FactBody;
      b: FactBody;
    }> => {
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const b = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 27,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const result = await deduplicate(situationId);
      return { situationId, conflictId: result.conflicts[0].conflictId, a, b };
    };

    it('선택이 기록되고 충돌이 RESOLVED가 되며 원천은 그대로 남는다', async () => {
      const { situationId, conflictId, a, b } = await openConflict();
      const res = await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${conflictId}/resolve`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { selectedFactId: a.factId, reason: '기상청 관측 채택' },
        },
      );
      expect(res.status).toBe(200);
      const resolution = (
        (await res.json()) as Envelope<{ selectedFactId: string; reason: string; factKey: string }>
      ).data;
      expect(resolution.selectedFactId).toBe(a.factId);
      expect(resolution.factKey).toBe('temperature');

      const rows = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT (SELECT status FROM fact_conflict WHERE conflict_id = $1) AS conflict_status,
                  (SELECT status FROM situation_fact WHERE fact_id = $2) AS a_status,
                  (SELECT status FROM situation_fact WHERE fact_id = $3) AS b_status`,
          [conflictId, a.factId, b.factId],
        ),
      );
      expect(rows.rows[0].conflict_status).toBe('RESOLVED');
      // 선택되지 않은 후보를 REJECTED로 내리지 않는다 — 설계 06 A-01이
      // 복수 Fact 병존을 허용하고, 확정에 무엇을 넣을지는 SIT-012가 정한다.
      expect(rows.rows[0].a_status).toBe('CANDIDATE');
      expect(rows.rows[0].b_status).toBe('CANDIDATE');

      const audit = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT before_json, after_json FROM audit_log
           WHERE action = 'FACT_SELECTED' AND resource_id = $1`,
          [conflictId],
        ),
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].before_json.status).toBe('OPEN');
      expect(audit.rows[0].after_json.selectedFactId).toBe(a.factId);
      expect(audit.rows[0].after_json.reason).toBe('기상청 관측 채택');
    });

    it('이미 해소된 충돌은 다시 정할 수 없다 (409, 설계 06 E-02)', async () => {
      const { situationId, conflictId, a } = await openConflict();
      const body = { selectedFactId: a.factId, reason: '채택' };
      const first = await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${conflictId}/resolve`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body },
      );
      expect(first.status).toBe(200);
      const second = await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${conflictId}/resolve`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body },
      );
      expect(second.status).toBe(409);
      const err = (await second.json()) as { error: { code: string } };
      expect(err.error.code).toBe('FACT-409-002');
    });

    it('후보가 아닌 Fact는 선택할 수 없다 (422)', async () => {
      const { situationId, conflictId } = await openConflict();
      const outsider = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '외부',
      });
      const res = await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${conflictId}/resolve`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { selectedFactId: outsider.factId, reason: '엉뚱한 선택' },
        },
      );
      expect(res.status).toBe(422);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe('FACT-422-002');
    });

    it('사유 없이 선택할 수 없다', async () => {
      const { situationId, conflictId, a } = await openConflict();
      const res = await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${conflictId}/resolve`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body: { selectedFactId: a.factId } },
      );
      expect(res.status).toBe(400);
    });

    it('SITUATION_CONFIRM 권한이 없으면 403이다', async () => {
      const { situationId, conflictId, a } = await openConflict();
      const res = await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${conflictId}/resolve`,
        tokenReader,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { selectedFactId: a.factId, reason: '권한 없음' },
        },
      );
      expect(res.status).toBe(403);
    });

    it('다른 기관은 충돌을 보지도 정하지도 못한다', async () => {
      const { situationId, conflictId, a } = await openConflict();
      expect(
        (await call('GET', `/api/v1/situations/${situationId}/conflicts`, tokenB)).status,
      ).toBe(404);
      const res = await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${conflictId}/resolve`,
        tokenB,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { selectedFactId: a.factId, reason: '침입' },
        },
      );
      expect(res.status).toBe(404);
    });
  });

  // ── 인수기준 1 ───────────────────────────────────────────────────────────

  describe('확정 차단 (인수기준 1: unresolved conflict block)', () => {
    it('미해결 충돌이 있으면 확정할 수 없다 (412 SIT-412-003)', async () => {
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 27,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const result = await deduplicate(situationId);
      expect(result.conflictsOpened).toBe(1);

      const blocked = await confirm(situationId, [a.factId]);
      expect(blocked.status).toBe(412);
      const err = (await blocked.json()) as {
        error: { code: string; violations: { field: string }[] };
      };
      expect(err.error.code).toBe('SIT-412-003');
      expect(err.error.violations.map((v) => v.field)).toContain('UNRESOLVED_CONFLICT');

      // 아무 Snapshot도 만들어지지 않았다.
      const stored = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM situation_snapshot WHERE situation_id = $1`, [
          situationId,
        ]),
      );
      expect(stored.rows[0].n).toBe(0);

      // 해소하면 열린다.
      const conflictId = result.conflicts[0].conflictId;
      await call(
        'POST',
        `/api/v1/situations/${situationId}/conflicts/${conflictId}/resolve`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { selectedFactId: a.factId, reason: '채택' },
        },
      );
      const ok = await confirm(situationId, [a.factId]);
      expect(ok.status).toBe(201);
    });

    it('같은 표준 Key를 두 번 확정할 수 없다', async () => {
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const b = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      // 값도 시각도 같아 충돌은 아니지만 둘 다 확정할 수는 없다.
      const res = await confirm(situationId, [a.factId, b.factId]);
      expect(res.status).toBe(412);
      const err = (await res.json()) as { error: { violations: { field: string }[] } };
      expect(err.error.violations.map((v) => v.field)).toContain('DUPLICATE_FACT_KEY');
    });

    it('다른 상황의 Fact나 후보 아닌 Fact는 확정할 수 없다', async () => {
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      expect((await confirm(situationId, [randomUUID()])).status).toBe(412);

      await withClient(dbUrl, (c) =>
        c.query(`UPDATE situation_fact SET status = 'REJECTED' WHERE fact_id = $1`, [a.factId]),
      );
      expect((await confirm(situationId, [a.factId])).status).toBe(412);
    });

    it('SITUATION_CONFIRM 권한이 없으면 403이다', async () => {
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      const res = await call('POST', `/api/v1/situations/${situationId}/snapshots`, tokenReader, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { factIds: [a.factId], effectiveAt: EFFECTIVE, expectedSnapshotId: null },
      });
      expect(res.status).toBe(403);
    });

    it('계약에 없는 conflictResolutionIds를 조용히 무시하지 않는다', async () => {
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      const res = await confirm(situationId, [a.factId], { conflictResolutionIds: [randomUUID()] });
      expect(res.status).toBe(400);
    });
  });

  describe('멱등·재계산 종결 (QA 리뷰 G-2 / 아키텍처 리뷰 M-3)', () => {
    it('같은 멱등키로 확정을 두 번 눌러도 판이 하나만 생긴다', async () => {
      const situationId = await createSituation();
      const fact = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      const key = `key_${randomUUID()}`;
      const body = { factIds: [fact.factId], effectiveAt: EFFECTIVE, expectedSnapshotId: null };
      const first = await call('POST', `/api/v1/situations/${situationId}/snapshots`, tokenA, {
        idempotencyKey: key,
        body,
      });
      const second = await call('POST', `/api/v1/situations/${situationId}/snapshots`, tokenA, {
        idempotencyKey: key,
        body,
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const a = ((await first.json()) as Envelope<SnapshotBody>).data;
      const b = ((await second.json()) as Envelope<SnapshotBody>).data;
      // "재확정은 새 snapshotId"와 정면으로 부딪히는 자리다 — 더블클릭이
      // v1+v2를 만들면 안 된다(QA 리뷰 G-2).
      expect(b.snapshotId).toBe(a.snapshotId);

      const rows = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM situation_snapshot WHERE situation_id = $1`, [
          situationId,
        ]),
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it('멱등키 없이 확정할 수 없다', async () => {
      const situationId = await createSituation();
      const fact = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      const res = await call('POST', `/api/v1/situations/${situationId}/snapshots`, tokenA, {
        body: { factIds: [fact.factId], effectiveAt: EFFECTIVE, expectedSnapshotId: null },
      });
      expect(res.status).toBe(400);
    });

    it('보정으로 값이 같아지면 재계산이 충돌을 닫고 확정이 열린다', async () => {
      // 이것이 없으면 존재하지 않는 충돌이 확정을 **영구 차단**한다(M-3).
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const b = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 27,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      expect((await deduplicate(situationId)).conflictsOpened).toBe(1);

      const patched = await call(
        'PATCH',
        `/api/v1/situations/${situationId}/facts/${b.factId}`,
        tokenA,
        { ifMatch: `"${b.versionNo}"`, body: { value: 25, reason: '재확인 결과 동일' } },
      );
      expect(patched.status).toBe(200);
      const derived = ((await patched.json()) as Envelope<FactBody>).data;
      // 파생 계보가 응답에 드러난다(리뷰 m-6).
      expect(derived.originalFactId).toBe(b.factId);
      expect(derived.derivedReason).toBe('재확인 결과 동일');
      // 새 자원의 위치를 알려 준다 — **강한 버전 ETag는 세우지 않는다**(리뷰 m-5).
      // 응답 본문이 이 URL의 자원이 아니므로, 그 값으로 다시 PATCH하면 412다.
      // (Express가 붙이는 약한 ETag는 우리 것이 아니다.)
      expect(patched.headers.get('content-location')).toContain(derived.factId);
      expect(patched.headers.get('etag') ?? '').not.toMatch(/^"\d+"$/);

      const again = await deduplicate(situationId);
      expect(again.conflictsObsoleted).toBe(1);
      expect(again.conflicts).toHaveLength(0);

      const ok = await confirm(situationId, [a.factId]);
      expect(ok.status).toBe(201);

      const closed = await call(
        'GET',
        `/api/v1/situations/${situationId}/conflicts?status=OBSOLETE`,
        tokenA,
      );
      const body = (await closed.json()) as Envelope<ConflictBody[]>;
      expect(body.data).toHaveLength(1);
    });

    it('같은 Key의 서로 다른 시간창이 각각 충돌을 연다', async () => {
      // 충돌의 단위가 fact_key 하나였을 때는 두 번째가 유니크에 걸려 조용히
      // 사라졌고, 첫 충돌만 해소하면 확정이 통과했다(아키텍처 리뷰 B-1).
      const situationId = await createSituation();
      const windows: [string, number[]][] = [
        ['2026-08-08T00:00:00+09:00', [25, 27]],
        ['2026-08-08T09:00:00+09:00', [30, 31]],
      ];
      for (const [observedAt, values] of windows) {
        for (const value of values) {
          await addFact(situationId, {
            factType: 'WEATHER_OBSERVATION',
            factKey: 'temperature',
            value,
            unit: 'degC',
            observedAt,
          });
        }
      }
      const result = await deduplicate(situationId);
      expect(result.groups).toHaveLength(2);
      expect(result.conflictsOpened).toBe(2);
      expect(result.conflicts).toHaveLength(2);
      expect(new Set(result.conflicts.map((c) => c.groupKey)).size).toBe(2);
    });

    it('범주가 다르면 같은 자리로 묶이지 않는다', async () => {
      const situationId = await createSituation();
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      await addFact(situationId, {
        factType: 'USER_ASSERTED',
        factKey: 'value',
        value: '체감상 더움',
        observedAt: EFFECTIVE,
      });
      const result = await deduplicate(situationId);
      expect(result.groups).toEqual([]);
      expect(result.conflictsOpened).toBe(0);
    });

    it('중복군 계산이 감사에 남는다', async () => {
      const situationId = await createSituation();
      await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      await deduplicate(situationId);
      const audit = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT after_json FROM audit_log
           WHERE action = 'FACT_GROUPED' AND resource_id = $1`,
          [situationId],
        ),
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].after_json.strategy).toBe('KEY_TIME_WINDOW');
    });

    it('상세가 미해결 충돌 수를 실제로 센다 (CONFLICT_OPEN 파생)', async () => {
      // 하드코딩 0이면 설계 06 §7.1의 CONFLICT_OPEN이 도달 불가능한 상태가
      // 된다(아키텍처 리뷰 M-4).
      const situationId = await createSituation();
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 27,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      await deduplicate(situationId);
      const res = await call('GET', `/api/v1/situations/${situationId}`, tokenA);
      const body = (await res.json()) as Envelope<{
        openConflictCount: number;
        contextState: string;
      }>;
      expect(body.data.openConflictCount).toBe(1);
      expect(body.data.contextState).toBe('CONFLICT_OPEN');
    });

    it('잘못된 UUID는 400이다', async () => {
      for (const path of [
        '/api/v1/situations/not-a-uuid/conflicts',
        '/api/v1/situations/not-a-uuid/snapshots',
      ]) {
        const res = await call('GET', path, tokenA);
        expect(res.status, path).toBe(400);
      }
    });
  });

  describe('확정 기준 가드 (ADR-34 D17 — 설계 06 US-SIT-008 E-01)', () => {
    it('두 사람이 같은 화면을 보고 각각 확정하면 뒤가 409다', async () => {
      // 이것이 없으면 **둘 다 성공**한다. 뒤에 누른 사람은 앞사람의 확정을
      // 보지 못한 채 기준 상황을 바꾸고, 앞사람은 자기 확정이 여전히 기준이라고
      // 믿는다. 행 잠금은 순서만 정할 뿐 이 사실을 알려주지 않는다.
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      const b = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'humidity',
        value: 60,
        unit: '%',
        observedAt: EFFECTIVE,
      });

      // 두 사람 모두 "아직 확정된 판이 없다"를 보고 있다.
      const first = await confirm(situationId, [a.factId]);
      expect(first.status).toBe(201);

      const second = await confirm(situationId, [b.factId]);
      expect(second.status).toBe(409);
      const err = (await second.json()) as {
        error: { code: string; userAction: string };
      };
      expect(err.error.code).toBe('SIT-409-004');
      // 무엇을 봐야 하는지 알려 준다.
      const v1 = ((await first.json()) as Envelope<SnapshotBody>).data;
      expect(err.error.userAction).toContain(v1.snapshotId);

      // 판은 하나만 남았다.
      const rows = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM situation_snapshot WHERE situation_id = $1`, [
          situationId,
        ]),
      );
      expect(rows.rows[0].n).toBe(1);

      // 최신 판을 보고 다시 확정하면 통과한다.
      const retry = await confirm(situationId, [b.factId], {
        expectedSnapshotId: v1.snapshotId,
      });
      expect(retry.status).toBe(201);
    });

    it('진짜 동시에 눌러도 하나만 성공한다 (행 잠금 + 가드)', async () => {
      // 위 테스트는 순차 호출이라 "가드가 낡은 값을 알아본다"까지만 증명한다.
      // 여기서는 두 요청이 실제로 겹치게 보낸다 — 상황 행 `FOR UPDATE`가
      // 순서를 정하고, 뒤진 쪽이 잠금에서 풀려나 **다시 읽은** 값으로
      // 가드에 걸려야 한다. 잠금 전에 읽었다면 둘 다 통과했을 것이다.
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      const b = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'humidity',
        value: 60,
        unit: '%',
        observedAt: EFFECTIVE,
      });

      // 서로 다른 멱등키다 — 재생이 아니라 진짜 두 요청이다.
      const [r1, r2] = await Promise.all([
        confirm(situationId, [a.factId]),
        confirm(situationId, [b.factId]),
      ]);

      const codes = [r1.status, r2.status].sort();
      expect(codes).toEqual([201, 409]);

      const loser = r1.status === 409 ? r1 : r2;
      const err = (await loser.json()) as { error: { code: string } };
      expect(err.error.code).toBe('SIT-409-004');

      const rows = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM situation_snapshot WHERE situation_id = $1`, [
          situationId,
        ]),
      );
      expect(rows.rows[0].n).toBe(1);
    });

    it('expectedSnapshotId가 UUID가 아니면 400이다', async () => {
      const situationId = await createSituation();
      const fact = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      const res = await confirm(situationId, [fact.factId], {
        expectedSnapshotId: 'not-a-uuid',
      });
      expect(res.status).toBe(400);
      const err = (await res.json()) as { error: { violations: { field: string }[] } };
      expect(err.error.violations.map((v) => v.field)).toContain('expectedSnapshotId');
    });

    it('첫 확정에 남의 snapshotId를 대면 409다', async () => {
      const situationId = await createSituation();
      const fact = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      const res = await confirm(situationId, [fact.factId], {
        expectedSnapshotId: randomUUID(),
      });
      expect(res.status).toBe(409);
    });

    it('expectedSnapshotId를 생략하면 400이다 (가드를 우회할 수 없다)', async () => {
      const situationId = await createSituation();
      const fact = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      const res = await call('POST', `/api/v1/situations/${situationId}/snapshots`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { factIds: [fact.factId], effectiveAt: EFFECTIVE },
      });
      expect(res.status).toBe(400);
      const err = (await res.json()) as { error: { violations: { field: string }[] } };
      expect(err.error.violations.map((v) => v.field)).toContain('expectedSnapshotId');
    });
  });

  // ── 인수기준 2·3 ─────────────────────────────────────────────────────────

  describe('불변과 해시·버전 (인수기준 2·3)', () => {
    const confirmedSituation = async (): Promise<{
      situationId: string;
      fact: FactBody;
      snapshot: SnapshotBody;
    }> => {
      const situationId = await createSituation();
      const fact = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const res = await confirm(situationId, [fact.factId]);
      expect(res.status).toBe(201);
      return { situationId, fact, snapshot: ((await res.json()) as Envelope<SnapshotBody>).data };
    };

    it('확정이 v1을 만들고 사실 사본·해시를 담으며 상황을 CONTEXT_CONFIRMED로 올린다', async () => {
      const { situationId, fact, snapshot } = await confirmedSituation();
      expect(snapshot.versionNo).toBe(1);
      expect(snapshot.supersedesSnapshotId).toBeNull();
      expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(snapshot.facts).toHaveLength(1);
      expect(snapshot.facts[0].factId).toBe(fact.factId);
      expect(snapshot.facts[0].status).toBe('CONFIRMED');

      const detail = await call('GET', `/api/v1/situations/${situationId}`, tokenA);
      const body = (await detail.json()) as Envelope<{
        status: string;
        currentSnapshotId: string;
        contextState: string;
      }>;
      expect(body.data.status).toBe('CONTEXT_CONFIRMED');
      expect(body.data.currentSnapshotId).toBe(snapshot.snapshotId);
      expect(body.data.contextState).toBe('USER_CONFIRMED');

      // 설계 06 US-SIT-008 감사 이벤트(QA 리뷰 F-6).
      const audit = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT after_json FROM audit_log
           WHERE action = 'SNAPSHOT_CONFIRMED' AND resource_id = $1`,
          [snapshot.snapshotId],
        ),
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].after_json.versionNo).toBe(1);
      expect(audit.rows[0].after_json.contentHash).toBe(snapshot.contentHash);
      expect(audit.rows[0].after_json.factCount).toBe(1);
    });

    it('확정 후 변경 0건 — une_app은 Snapshot을 고치거나 지울 수 없다', async () => {
      const { snapshot } = await confirmedSituation();
      await expect(
        withClient(dbUrl, async (c) => {
          await c.query('SET ROLE une_app');
          await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [fx.tenantA]);
          await c.query(`UPDATE situation_snapshot SET content_hash = $1 WHERE snapshot_id = $2`, [
            'f'.repeat(64),
            snapshot.snapshotId,
          ]);
        }),
      ).rejects.toThrow(/permission denied/i);

      await expect(
        withClient(dbUrl, async (c) => {
          await c.query('SET ROLE une_app');
          await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [fx.tenantA]);
          await c.query(`DELETE FROM situation_snapshot WHERE snapshot_id = $1`, [
            snapshot.snapshotId,
          ]);
        }),
      ).rejects.toThrow(/permission denied/i);
    });

    it('확정 후 원천을 보정해도 Snapshot의 사본은 움직이지 않는다 (설계 06 A-02)', async () => {
      const { situationId, snapshot } = await confirmedSituation();
      // 확정된 Fact는 후보가 아니므로 보정 자체가 막힌다 — 그것이 첫 방어다.
      const list = await call('GET', `/api/v1/situations/${situationId}/snapshots`, tokenA);
      const body = (await list.json()) as Envelope<{ items: SnapshotBody[] }>;
      expect(body.data.items[0].facts[0].value).toBe(25);
      expect(body.data.items[0].contentHash).toBe(snapshot.contentHash);
    });

    it('재확정은 새 snapshotId·v+1이고 이전을 가리키며 기존은 보존된다', async () => {
      const situationId = await createSituation();
      const first = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const v1 = (
        (await (await confirm(situationId, [first.factId])).json()) as Envelope<SnapshotBody>
      ).data;

      const second = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'rainfall_1h',
        value: 12,
        unit: 'mm',
        observedAt: EFFECTIVE,
      });
      const v2 = (
        (await (
          await confirm(situationId, [second.factId], { expectedSnapshotId: v1.snapshotId })
        ).json()) as Envelope<SnapshotBody>
      ).data;

      expect(v2.snapshotId).not.toBe(v1.snapshotId);
      expect(v2.versionNo).toBe(2);
      expect(v2.supersedesSnapshotId).toBe(v1.snapshotId);

      const rows = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM situation_snapshot WHERE situation_id = $1`, [
          situationId,
        ]),
      );
      expect(rows.rows[0].n).toBe(2);
    });

    it('같은 사실·같은 기준시각이면 같은 해시다 (확정자·시각은 해시에 없다)', async () => {
      const a = await confirmedSituation();
      const b = await confirmedSituation();
      // 다른 상황이므로 factId가 달라 해시는 다르다 — 근거가 해시에 들어간다는
      // 사실을 확인한다.
      expect(a.snapshot.contentHash).not.toBe(b.snapshot.contentHash);
      expect(a.snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('확정된 Fact는 CONFIRMED가 되어 후보 목록에서 빠진다', async () => {
      const { situationId, fact } = await confirmedSituation();
      const res = await call(
        'GET',
        `/api/v1/situations/${situationId}/facts?status=CANDIDATE`,
        tokenA,
      );
      const body = (await res.json()) as Envelope<{ items: FactBody[] }>;
      expect(body.data.items.map((f) => f.factId)).not.toContain(fact.factId);
    });
  });

  // ── 인수기준 4 ───────────────────────────────────────────────────────────

  describe('Diff (인수기준 4: change comparison)', () => {
    it('두 판의 추가·삭제·변경·유지를 센다', async () => {
      const situationId = await createSituation();
      const temp25 = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const humidity = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'humidity',
        value: 60,
        unit: '%',
        observedAt: EFFECTIVE,
      });
      const v1 = (
        (await (
          await confirm(situationId, [temp25.factId, humidity.factId])
        ).json()) as Envelope<SnapshotBody>
      ).data;

      const temp27 = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 27,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const rainfall = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'rainfall_1h',
        value: 12,
        unit: 'mm',
        observedAt: EFFECTIVE,
      });
      // **바뀌지 않은 사실(humidity)을 다시 담는다.** 담지 않으면 사용자가
      // 지운 적 없는 사실이 REMOVED로 보고되고, 현재 기준 Snapshot에서도
      // 사라진다(아키텍처 리뷰 M-2). 이미 CONFIRMED인 Fact를 다시 담을 수
      // 있어야 그것이 가능하다.
      const v2 = await confirm(situationId, [temp27.factId, humidity.factId, rainfall.factId], {
        expectedSnapshotId: v1.snapshotId,
      });
      expect(v2.status).toBe(201);

      const res = await call(
        'GET',
        `/api/v1/situations/${situationId}/snapshots?compareTo=${v1.snapshotId}`,
        tokenA,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<{
        items: SnapshotBody[];
        diff: {
          fromSnapshotId: string;
          added: number;
          removed: number;
          changed: number;
          unchanged: number;
          entries: { factKey: string; kind: string }[];
        };
      }>;
      expect(body.data.items).toHaveLength(2);
      expect(body.data.diff.fromSnapshotId).toBe(v1.snapshotId);
      expect({
        added: body.data.diff.added,
        removed: body.data.diff.removed,
        changed: body.data.diff.changed,
        unchanged: body.data.diff.unchanged,
      }).toEqual({ added: 1, removed: 0, changed: 1, unchanged: 1 });
      const byKey = Object.fromEntries(body.data.diff.entries.map((e) => [e.factKey, e.kind]));
      expect(byKey).toEqual({
        humidity: 'UNCHANGED',
        rainfall_1h: 'ADDED',
        temperature: 'CHANGED',
      });
    });

    it('의도적으로 뺀 사실만 REMOVED가 된다', async () => {
      const situationId = await createSituation();
      const a = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 25,
        unit: 'degC',
        observedAt: EFFECTIVE,
      });
      const b = await addFact(situationId, {
        factType: 'WEATHER_OBSERVATION',
        factKey: 'humidity',
        value: 60,
        unit: '%',
        observedAt: EFFECTIVE,
      });
      const v1 = (
        (await (await confirm(situationId, [a.factId, b.factId])).json()) as Envelope<SnapshotBody>
      ).data;
      // 두 번째 판에서 humidity를 빼는 것은 사용자의 선택이다.
      await confirm(situationId, [a.factId], { expectedSnapshotId: v1.snapshotId });

      const res = await call(
        'GET',
        `/api/v1/situations/${situationId}/snapshots?compareTo=${v1.snapshotId}`,
        tokenA,
      );
      const body = (await res.json()) as Envelope<{
        diff: { removed: number; entries: { factKey: string; kind: string }[] };
      }>;
      expect(body.data.diff.removed).toBe(1);
      expect(body.data.diff.entries.find((e) => e.factKey === 'humidity')?.kind).toBe('REMOVED');
    });

    it('compareTo가 없으면 목록만 준다', async () => {
      const situationId = await createSituation();
      const fact = await addFact(situationId, {
        factType: 'FIELD_REPORT',
        factKey: 'reporter',
        value: '가',
      });
      await confirm(situationId, [fact.factId]);
      const res = await call('GET', `/api/v1/situations/${situationId}/snapshots`, tokenA);
      const body = (await res.json()) as Envelope<{ items: SnapshotBody[]; diff: unknown }>;
      expect(body.data.items).toHaveLength(1);
      expect(body.data.diff).toBeNull();
    });

    it('없는 Snapshot과 비교하면 404다', async () => {
      const situationId = await createSituation();
      const res = await call(
        'GET',
        `/api/v1/situations/${situationId}/snapshots?compareTo=${randomUUID()}`,
        tokenA,
      );
      expect(res.status).toBe(404);
    });

    it('다른 기관은 Snapshot을 볼 수 없다', async () => {
      const situationId = await createSituation();
      const res = await call('GET', `/api/v1/situations/${situationId}/snapshots`, tokenB);
      expect(res.status).toBe(404);
    });
  });
});
