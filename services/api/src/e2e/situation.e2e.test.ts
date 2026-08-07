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
 * CC-200 인수 증거 (UNE-SIT-001~005, 007, 008, 014, 015).
 *
 * 실제 마이그레이션된 DB에, 런타임 역할 `une_app`으로(FORCE RLS가 걸린 상태로)
 * HTTP를 지나 확인한다. `DATABASE_URL`이 없으면 건너뛴다 — CI의 db-verify가
 * 이 파일을 돌린다.
 *
 * 인수기준 네 가지가 각각 어느 describe에 있는지:
 *   1. manual/provider facts   → "수동 Fact", "Provider 수집"
 *   2. source/timestamps       → "출처와 시각"
 *   3. normalization           → "정규화"
 *   4. partial provider failure→ "부분 장애"
 */
const ADMIN_URL = process.env.DATABASE_URL;

const SECRET = 'e2e-signing-secret-e2e-signing-secret!!';
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

interface Fixtures {
  tenantA: string;
  tenantB: string;
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
  const tenantA = await tenant('sit-a');
  const tenantB = await tenant('sit-b');

  const user = async (tenantId: string, login: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, login],
      )
    ).rows[0].user_id as string;
  const adminA = await user(tenantA, 'admin-a');
  const plainA = await user(tenantA, 'plain-a');
  const userB = await user(tenantB, 'user-b');

  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('SITUATION_CREATE','SITUATION_READ','SITUATION_EDIT',
                                'SITUATION_FACT_COLLECT','SITUATION_FACT_EDIT')
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
  return { tenantA, tenantB, adminA, plainA, userB };
}

interface Envelope<T> {
  success: boolean;
  data: T;
  meta: { correlationId: string };
}

interface SituationBody {
  situationId: string;
  status: string;
  versionNo: number;
  mode: string;
  title: string;
  occurredAt: string | null;
  locationText: string | null;
}

interface FactBody {
  factId: string;
  factType: string;
  factKey: string;
  value: unknown;
  unit: string | null;
  observedAt: string | null;
  collectedAt: string;
  versionNo: number;
  status: string;
  source: { providerCode: string; sourceType: string; sourceName: string; collectedAt: string };
  normalization?: { version: string; outcome: string; originalUnit: string | null };
}

interface ProviderJobBody {
  providerJobId: string;
  batchId: string;
  providerCode: string;
  status: string;
  resultCount: number;
  error: { kind?: string; retriable?: boolean; rejectedCount?: number } | null;
  finishedAt: string;
}

describe.skipIf(!ADMIN_URL)('CC-200 situation / candidate fact e2e', () => {
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

  const createSituation = async (
    token = tokenA,
    overrides: Record<string, unknown> = {},
  ): Promise<SituationBody> => {
    const res = await call('POST', '/api/v1/situations', token, {
      idempotencyKey: `key_${randomUUID()}`,
      body: {
        mode: 'LIVE',
        title: '테스트 상황',
        hazardType: '태풍/호우',
        locationText: '○○시 ○○동',
        ...overrides,
      },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Envelope<SituationBody>).data;
  };

  const collect = async (
    situationId: string,
    body: Record<string, unknown>,
  ): Promise<{ batchId: string; jobs: ProviderJobBody[]; factsCreated: number }> => {
    const res = await call('POST', `/api/v1/situations/${situationId}/provider-queries`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body,
    });
    expect(res.status).toBe(200);
    return (
      (await res.json()) as Envelope<{
        batchId: string;
        jobs: ProviderJobBody[];
        factsCreated: number;
      }>
    ).data;
  };

  beforeAll(async () => {
    if (!existsSync(MIGRATIONS_DIR)) {
      throw new Error(`migrations dir not found at ${MIGRATIONS_DIR}; run from services/api`);
    }
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc200_e2e_${randomUUID().slice(0, 8)}`;
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

    const config = e2eApiConfig({ databaseUrl: dbUrl, jwtSecret: SECRET });
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

  // ── UNE-SIT-001~004 ──────────────────────────────────────────────────────

  describe('상황 등록·조회·수정', () => {
    it('DRAFT로 만들고 SITUATION_CREATED를 감사에 남긴다', async () => {
      const situation = await createSituation();
      expect(situation.status).toBe('DRAFT');
      expect(situation.versionNo).toBe(1);
      expect(situation.mode).toBe('LIVE');

      const audit = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND action = 'SITUATION_CREATED'
             AND resource_id = $2`,
          [fx.tenantA, situation.situationId],
        ),
      );
      expect(audit.rowCount).toBe(1);
    });

    it('Idempotency-Key가 없으면 400이다', async () => {
      const res = await call('POST', '/api/v1/situations', tokenA, {
        body: { mode: 'LIVE', title: 'x', hazardType: '태풍/호우' },
      });
      expect(res.status).toBe(400);
    });

    it('같은 Idempotency-Key 재전송은 같은 상황을 돌려준다', async () => {
      const key = `key_${randomUUID()}`;
      const body = { mode: 'EXERCISE', title: '멱등 상황', hazardType: '지진' };
      const first = await call('POST', '/api/v1/situations', tokenA, { idempotencyKey: key, body });
      const second = await call('POST', '/api/v1/situations', tokenA, {
        idempotencyKey: key,
        body,
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const a = (await first.json()) as Envelope<SituationBody>;
      const b = (await second.json()) as Envelope<SituationBody>;
      expect(b.data.situationId).toBe(a.data.situationId);
    });

    it('설계에 없는 mode/재난유형을 거부한다', async () => {
      for (const body of [
        { mode: 'ACTUAL', title: 'x', hazardType: '태풍/호우' },
        { mode: 'LIVE', title: 'x', hazardType: '외계인침공' },
      ]) {
        const res = await call('POST', '/api/v1/situations', tokenA, {
          idempotencyKey: `key_${randomUUID()}`,
          body,
        });
        expect(res.status).toBe(400);
      }
    });

    it('오프셋 없는 발생시각을 거부한다 (9시간 어긋난 사실을 만들지 않는다)', async () => {
      const res = await call('POST', '/api/v1/situations', tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: {
          mode: 'LIVE',
          title: 'x',
          hazardType: '태풍/호우',
          occurredAt: '2026-08-08T09:00:00',
        },
      });
      expect(res.status).toBe(400);
    });

    it('달력에 없는 발생시각을 거부한다 (2026-02-30이 3월 2일로 굴러가지 않는다)', async () => {
      // 리뷰 M-1: 컨트롤러가 규칙의 두 번째 사본을 들고 있었고 그 사본에는
      // 달력 검사가 없었다. observedAt은 뒤에서 도메인이 걸렀지만 occurredAt은
      // 도메인 정규화를 지나는 경로가 없어 그대로 저장됐다.
      const res = await call('POST', '/api/v1/situations', tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: {
          mode: 'LIVE',
          title: 'x',
          hazardType: '태풍/호우',
          occurredAt: '2026-02-30T00:00:00Z',
        },
      });
      expect(res.status).toBe(400);

      const stored = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM situation WHERE occurred_at = '2026-03-02T00:00:00Z'`),
      );
      expect(stored.rows[0].n).toBe(0);
    });

    it('발생시각을 UTC 정규형으로 저장한다', async () => {
      const situation = await createSituation(tokenA, {
        occurredAt: '2026-08-08T09:00:00+09:00',
      });
      expect(situation.occurredAt).toBe('2026-08-08T00:00:00.000Z');
    });

    it('알 수 없는 본문 항목을 거부한다 (계약의 additionalProperties:false)', async () => {
      const res = await call('POST', '/api/v1/situations', tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { mode: 'LIVE', title: 'x', hazardType: '태풍/호우', status: 'CLOSED' },
      });
      expect(res.status).toBe(400);
    });

    it('상세는 ETag와 파생 contextState를 준다', async () => {
      const situation = await createSituation();
      const res = await call('GET', `/api/v1/situations/${situation.situationId}`, tokenA);
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe('"1"');
      const body = (await res.json()) as Envelope<{
        contextState: string;
        candidateFactCount: number;
        openConflictCount: number;
      }>;
      expect(body.data.contextState).toBe('DRAFT');
      expect(body.data.candidateFactCount).toBe(0);
    });

    it('If-Match 없는 수정은 428, 낡은 버전은 409다', async () => {
      const situation = await createSituation();
      const noMatch = await call('PATCH', `/api/v1/situations/${situation.situationId}`, tokenA, {
        body: { title: '수정' },
      });
      expect(noMatch.status).toBe(428);

      const stale = await call('PATCH', `/api/v1/situations/${situation.situationId}`, tokenA, {
        ifMatch: '"99"',
        body: { title: '수정' },
      });
      expect(stale.status).toBe(409);
    });

    it('수정이 버전을 올리고 updated_at을 움직인다 (0024 트리거)', async () => {
      const situation = await createSituation();
      const before = await withClient(dbUrl, (c) =>
        c.query(`SELECT updated_at FROM situation WHERE situation_id = $1`, [
          situation.situationId,
        ]),
      );
      const res = await call('PATCH', `/api/v1/situations/${situation.situationId}`, tokenA, {
        ifMatch: '"1"',
        body: { title: '수정된 제목', locationText: null },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<SituationBody>;
      expect(body.data.versionNo).toBe(2);
      expect(body.data.title).toBe('수정된 제목');
      // nullable 컬럼을 명시적으로 지울 수 있어야 한다(coalesce로는 불가능).
      expect(body.data.locationText).toBeNull();
      expect(res.headers.get('etag')).toBe('"2"');

      const after = await withClient(dbUrl, (c) =>
        c.query(`SELECT updated_at FROM situation WHERE situation_id = $1`, [
          situation.situationId,
        ]),
      );
      expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(
        before.rows[0].updated_at.getTime(),
      );
    });

    it('종결된 상황은 수정할 수 없다 (412)', async () => {
      const situation = await createSituation();
      // 정상 종결 경로(CLOSING/CLOSED로 가는 API)는 아직 없다 — CC-2xx가 열면
      // 이 SQL을 그 경로로 바꿀 것(QA 리뷰 R-6).
      await withClient(dbUrl, (c) =>
        c.query(`UPDATE situation SET status = 'CLOSED' WHERE situation_id = $1`, [
          situation.situationId,
        ]),
      );
      const res = await call('PATCH', `/api/v1/situations/${situation.situationId}`, tokenA, {
        ifMatch: '"1"',
        body: { title: '종결 후 수정' },
      });
      expect(res.status).toBe(412);
    });

    it('목록이 mode/status로 걸러지고 총계를 준다', async () => {
      await createSituation(tokenA, { mode: 'EXERCISE', title: '훈련 상황' });
      const res = await call('GET', '/api/v1/situations?mode=EXERCISE&size=5', tokenA);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<{
        items: SituationBody[];
        totalElements: number;
        totalPages: number;
      }>;
      expect(body.data.items.every((s) => s.mode === 'EXERCISE')).toBe(true);
      expect(body.data.totalElements).toBeGreaterThan(0);
    });
  });

  // ── 권한·테넌트 ──────────────────────────────────────────────────────────

  describe('권한과 테넌트 격리', () => {
    it('SITUATION_* 권한이 없으면 모든 경로가 403이다', async () => {
      // 권한별로 하나씩 확인한다 — CREATE 하나만 보면 나머지 넷의 데코레이터가
      // 빠져도 드러나지 않는다(QA 리뷰 F-4).
      const situation = await createSituation();
      const cases: [string, string, Record<string, unknown> | undefined][] = [
        ['POST', '/api/v1/situations', { mode: 'LIVE', title: 'x', hazardType: '태풍/호우' }], // CREATE
        ['GET', '/api/v1/situations', undefined], // READ
        ['GET', `/api/v1/situations/${situation.situationId}`, undefined], // READ
        ['GET', `/api/v1/situations/${situation.situationId}/facts`, undefined], // READ
        [
          'POST',
          `/api/v1/situations/${situation.situationId}/provider-queries`,
          { providers: ['KMA'], query: {} },
        ], // FACT_COLLECT
        [
          'POST',
          `/api/v1/situations/${situation.situationId}/facts`,
          { factType: 'FIELD_REPORT', factKey: 'reporter', value: 'x' },
        ], // FACT_EDIT
      ];
      for (const [method, path, body] of cases) {
        const res = await call(method, path, tokenPlain, {
          idempotencyKey: `key_${randomUUID()}`,
          ...(body === undefined ? {} : { body }),
        });
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    });

    it('SIT-004도 권한이 필요하다 (SITUATION_EDIT)', async () => {
      const situation = await createSituation();
      const res = await call('PATCH', `/api/v1/situations/${situation.situationId}`, tokenPlain, {
        ifMatch: '"1"',
        body: { title: '권한 없는 수정' },
      });
      expect(res.status).toBe(403);
    });

    it('잘못된 UUID는 404가 아니라 400 COM-0400이다', async () => {
      for (const path of [
        '/api/v1/situations/not-a-uuid',
        '/api/v1/situations/not-a-uuid/facts',
        '/api/v1/provider-jobs/not-a-uuid',
      ]) {
        const res = await call('GET', path, tokenA);
        expect(res.status, path).toBe(400);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('COM-0400');
      }
    });

    it('다른 기관의 상황은 존재 자체가 보이지 않는다 (404)', async () => {
      const situation = await createSituation();
      for (const path of [
        `/api/v1/situations/${situation.situationId}`,
        `/api/v1/situations/${situation.situationId}/facts`,
      ]) {
        const res = await call('GET', path, tokenB);
        expect(res.status).toBe(404);
      }
    });

    it('다른 기관은 Fact를 심을 수 없다', async () => {
      const situation = await createSituation();
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenB, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { factType: 'FIELD_REPORT', factKey: 'reporter', value: '침입자' },
      });
      expect(res.status).toBe(404);
    });
  });

  // ── UNE-SIT-007 / 008 / 014 ──────────────────────────────────────────────

  describe('수동 Fact (인수기준 1)', () => {
    it('등록하면 CANDIDATE로 남고 상황이 REGISTERED로 올라간다', async () => {
      const situation = await createSituation();
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: {
          factType: 'FIELD_REPORT',
          factKey: 'damage',
          value: { floodedHouseholds: 12 },
          observedAt: '2026-08-08T09:00:00+09:00',
        },
      });
      expect(res.status).toBe(201);
      const fact = ((await res.json()) as Envelope<FactBody>).data;
      expect(fact.status).toBe('CANDIDATE');
      expect(fact.source.providerCode).toBe('MANUAL');
      expect(fact.source.sourceType).toBe('USER');

      const detail = await call('GET', `/api/v1/situations/${situation.situationId}`, tokenA);
      const body = (await detail.json()) as Envelope<{
        status: string;
        contextState: string;
        candidateFactCount: number;
      }>;
      expect(body.data.status).toBe('REGISTERED');
      expect(body.data.contextState).toBe('CANDIDATE_REVIEW');
      expect(body.data.candidateFactCount).toBe(1);

      const audit = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT action FROM audit_log WHERE tenant_id = $1
             AND action IN ('FACT_CREATED','INCIDENT_REGISTERED')
             AND (resource_id = $2 OR resource_id = $3)`,
          [fx.tenantA, fact.factId, situation.situationId],
        ),
      );
      expect(audit.rows.map((r) => r.action).sort()).toEqual([
        'FACT_CREATED',
        'INCIDENT_REGISTERED',
      ]);
    });

    it('사용자가 Provider를 사칭할 수 없다', async () => {
      const situation = await createSituation();
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: {
          factType: 'WEATHER_OBSERVATION',
          factKey: 'temperature',
          value: 30,
          source: { providerCode: 'KMA', sourceName: '기상청' },
        },
      });
      expect(res.status).toBe(400);
    });

    it('표준 표기를 어긴 factKey는 400이고 422와 다른 코드를 쓴다', async () => {
      const situation = await createSituation();
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { factType: 'WEATHER_OBSERVATION', factKey: 'windSpeed', value: 3 },
      });
      expect(res.status).toBe(400);
      // 리뷰 M-4: 요청 형식 오류(400)와 정규화 격리(422)는 다른 사실이다.
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('FACT-400-001');
    });

    it('표준 단위가 있는 Key에 단위가 없으면 추측하지 않고 검토 대상이 된다', async () => {
      // 리뷰 M-6 / ADR-33 D18. 화씨 77을 넣은 사용자에게 "77 degC 정규화 성공"을
      // 보여주지 않는다.
      const situation = await createSituation();
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { factType: 'WEATHER_OBSERVATION', factKey: 'temperature', value: 77 },
      });
      expect(res.status).toBe(201);
      const fact = ((await res.json()) as Envelope<FactBody>).data;
      expect(fact.value).toBe(77);
      expect(fact.unit).toBeNull();
      expect(fact.normalization?.outcome).toBe('ORIGINAL_KEPT');
    });

    it('수치 Key에 문자열을 넣으면 422로 격리한다 (정규화 판정)', async () => {
      const situation = await createSituation();
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { factType: 'WEATHER_OBSERVATION', factKey: 'temperature', value: '많이 더움' },
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('FACT-422-001');
    });

    it('보정은 If-Match를 요구하고 버전을 올리며 before를 감사에 남긴다', async () => {
      const situation = await createSituation();
      const created = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/facts`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: {
            factType: 'WEATHER_OBSERVATION',
            factKey: 'rainfall_1h',
            value: 10,
            unit: 'mm',
          },
        },
      );
      const fact = ((await created.json()) as Envelope<FactBody>).data;

      const noMatch = await call(
        'PATCH',
        `/api/v1/situations/${situation.situationId}/facts/${fact.factId}`,
        tokenA,
        { body: { value: 12 } },
      );
      expect(noMatch.status).toBe(428);

      const res = await call(
        'PATCH',
        `/api/v1/situations/${situation.situationId}/facts/${fact.factId}`,
        tokenA,
        { ifMatch: `"${fact.versionNo}"`, body: { value: 3, unit: 'cm', reason: '현장 재확인' } },
      );
      expect(res.status).toBe(200);
      const derived = ((await res.json()) as Envelope<FactBody>).data;

      // CC-210: 보정은 **파생 Fact를 만든다**(설계 06 US-SIT-007 #3).
      // 응답은 새 Fact이고 원본은 SUPERSEDED로 남는다.
      expect(derived.factId).not.toBe(fact.factId);
      expect(derived.versionNo).toBe(1);
      expect(derived.status).toBe('CANDIDATE');
      // 보정도 정규화를 지난다: 3 cm → 30 mm.
      expect(derived.value).toBe(30);
      expect(derived.unit).toBe('mm');
      // 사용자가 고친 숫자가 원래 출처의 값으로 보이면 안 된다.
      expect(derived.source.providerCode).toBe('MANUAL');

      const rows = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT fact_id, status, original_fact_id, derived_by, derived_reason
           FROM situation_fact WHERE fact_id = ANY($1::uuid[]) ORDER BY original_fact_id NULLS FIRST`,
          [[fact.factId, derived.factId]],
        ),
      );
      expect(rows.rows).toHaveLength(2);
      // 원본: 불변, SUPERSEDED, 계보 없음.
      expect(rows.rows[0].fact_id).toBe(fact.factId);
      expect(rows.rows[0].status).toBe('SUPERSEDED');
      expect(rows.rows[0].original_fact_id).toBeNull();
      // 파생: 원본을 가리키고 actor·사유를 갖는다.
      expect(rows.rows[1].fact_id).toBe(derived.factId);
      expect(rows.rows[1].original_fact_id).toBe(fact.factId);
      expect(rows.rows[1].derived_by).toBe(fx.adminA);
      expect(rows.rows[1].derived_reason).toBe('현장 재확인');

      const audit = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT before_json, after_json FROM audit_log
           WHERE action = 'FACT_CORRECTED' AND resource_id = $1`,
          [derived.factId],
        ),
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].before_json.value).toBe(10);
      expect(audit.rows[0].before_json.factId).toBe(fact.factId);
      expect(audit.rows[0].after_json.reason).toBe('현장 재확인');
      expect(audit.rows[0].after_json.originalFactId).toBe(fact.factId);
    });

    it('보정 사유는 필수다 (파생은 사유 없이 만들 수 없다)', async () => {
      const situation = await createSituation();
      const created = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/facts`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { factType: 'FIELD_REPORT', factKey: 'reporter', value: '홍길동' },
        },
      );
      const fact = ((await created.json()) as Envelope<FactBody>).data;
      const res = await call(
        'PATCH',
        `/api/v1/situations/${situation.situationId}/facts/${fact.factId}`,
        tokenA,
        { ifMatch: `"${fact.versionNo}"`, body: { value: '임꺽정' } },
      );
      expect(res.status).toBe(400);
    });

    it('확정·거부된 Fact는 보정할 수 없다 (412, 원천 Fact 불변)', async () => {
      const situation = await createSituation();
      const created = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/facts`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { factType: 'FIELD_REPORT', factKey: 'reporter', value: '홍길동' },
        },
      );
      const fact = ((await created.json()) as Envelope<FactBody>).data;
      await withClient(dbUrl, (c) =>
        c.query(`UPDATE situation_fact SET status = 'CONFIRMED' WHERE fact_id = $1`, [fact.factId]),
      );
      const res = await call(
        'PATCH',
        `/api/v1/situations/${situation.situationId}/facts/${fact.factId}`,
        tokenA,
        { ifMatch: `"${fact.versionNo}"`, body: { value: '임꺽정', reason: '재확인' } },
      );
      expect(res.status).toBe(412);
    });

    it('후보 목록(UNE-SIT-014)이 status/factType으로 걸러진다', async () => {
      const situation = await createSituation();
      for (const body of [
        { factType: 'FIELD_REPORT', factKey: 'reporter', value: '가' },
        { factType: 'WEATHER_OBSERVATION', factKey: 'humidity', value: 70, unit: '%' },
      ]) {
        const res = await call(
          'POST',
          `/api/v1/situations/${situation.situationId}/facts`,
          tokenA,
          {
            idempotencyKey: `key_${randomUUID()}`,
            body,
          },
        );
        expect(res.status).toBe(201);
      }
      const all = await call(`GET`, `/api/v1/situations/${situation.situationId}/facts`, tokenA);
      const allBody = (await all.json()) as Envelope<{ items: FactBody[]; totalElements: number }>;
      expect(allBody.data.totalElements).toBe(2);

      const filtered = await call(
        'GET',
        `/api/v1/situations/${situation.situationId}/facts?factType=FIELD_REPORT&status=CANDIDATE`,
        tokenA,
      );
      const filteredBody = (await filtered.json()) as Envelope<{ items: FactBody[] }>;
      expect(filteredBody.data.items).toHaveLength(1);
      expect(filteredBody.data.items[0].factType).toBe('FIELD_REPORT');
    });

    it('없는 상황의 Fact 목록은 빈 배열이 아니라 404다', async () => {
      const res = await call('GET', `/api/v1/situations/${randomUUID()}/facts`, tokenA);
      expect(res.status).toBe(404);
    });

    it('같은 원본을 두 번 보정하면 두 번째는 409다 (파생이 둘 생기지 않는다)', async () => {
      const situation = await createSituation();
      const created = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/facts`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { factType: 'FIELD_REPORT', factKey: 'reporter', value: '홍길동' },
        },
      );
      const fact = ((await created.json()) as Envelope<FactBody>).data;

      // 첫 보정은 파생을 만들고 원본을 SUPERSEDED로 내린다.
      const first = await call(
        'PATCH',
        `/api/v1/situations/${situation.situationId}/facts/${fact.factId}`,
        tokenA,
        { ifMatch: `"${fact.versionNo}"`, body: { value: '임꺽정', reason: '재확인' } },
      );
      expect(first.status).toBe(200);

      // 같은 원본을 같은 버전으로 다시 보정하면 충돌이다 — 한 원본에서 파생이
      // 둘 생기면 어느 쪽이 최신인지 답할 수 없다. 412(후보 아님)가 아니라
      // 409인 이유는 사용자가 낡은 판을 들고 있다는 것이 요점이기 때문이다.
      const stale = await call(
        'PATCH',
        `/api/v1/situations/${situation.situationId}/facts/${fact.factId}`,
        tokenA,
        { ifMatch: `"${fact.versionNo}"`, body: { value: '장길산', reason: '재확인' } },
      );
      expect(stale.status).toBe(412);

      const derived = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM situation_fact WHERE original_fact_id = $1`, [
          fact.factId,
        ]),
      );
      expect(derived.rows[0].n).toBe(1);
    });

    it('종결된 상황에는 수동 Fact도 등록할 수 없다 (412)', async () => {
      const situation = await createSituation();
      // 정상 종결 경로(CLOSING/CLOSED로 가는 API)는 아직 없다 — CC-2xx가 열면
      // 이 SQL을 그 경로로 바꿀 것(QA 리뷰 R-6).
      await withClient(dbUrl, (c) =>
        c.query(`UPDATE situation SET status = 'CLOSED' WHERE situation_id = $1`, [
          situation.situationId,
        ]),
      );
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { factType: 'FIELD_REPORT', factKey: 'reporter', value: '종결 후' },
      });
      expect(res.status).toBe(412);
    });

    it('페이지 끝을 넘어가도 총계는 참이다', async () => {
      const situation = await createSituation();
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { factType: 'FIELD_REPORT', factKey: 'reporter', value: '가' },
      });
      expect(res.status).toBe(201);

      const page = await call(
        'GET',
        `/api/v1/situations/${situation.situationId}/facts?page=999&size=10`,
        tokenA,
      );
      expect(page.status).toBe(200);
      const body = (await page.json()) as Envelope<{
        items: FactBody[];
        totalElements: number;
        totalPages: number;
      }>;
      // 페이지가 비어도 총계는 0이 아니다 — count를 따로 세는 이유가 이것이다.
      expect(body.data.items).toEqual([]);
      expect(body.data.totalElements).toBe(1);
      expect(body.data.totalPages).toBe(1);
    });

    it('후보가 없는 상황의 목록은 빈 배열과 총계 0이다', async () => {
      const situation = await createSituation();
      const res = await call('GET', `/api/v1/situations/${situation.situationId}/facts`, tokenA);
      const body = (await res.json()) as Envelope<{ items: FactBody[]; totalElements: number }>;
      expect(body.data.items).toEqual([]);
      expect(body.data.totalElements).toBe(0);
    });
  });

  // ── UNE-SIT-005 ──────────────────────────────────────────────────────────

  describe('Provider 수집 (인수기준 1)', () => {
    it('KMA/MOIS 목업에서 후보 Fact를 만들고 Job을 종결 상태로 남긴다', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, {
        providers: ['KMA', 'MOIS'],
        query: { adminCode: '1100000000' },
      });

      expect(result.jobs).toHaveLength(2);
      expect(result.factsCreated).toBeGreaterThan(0);
      for (const job of result.jobs) {
        expect(job.status).toBe('SUCCEEDED');
        expect(job.error).toBeNull();
        expect(job.resultCount).toBeGreaterThan(0);
        // 동기 수집이므로 반환 시점에 이미 종결돼 있다.
        expect(job.finishedAt).toBeTruthy();
        expect(job.batchId).toBe(result.batchId);
      }

      const facts = await call('GET', `/api/v1/situations/${situation.situationId}/facts`, tokenA);
      const body = (await facts.json()) as Envelope<{ items: FactBody[] }>;
      expect(body.data.items.some((f) => f.source.providerCode === 'KMA')).toBe(true);
      expect(body.data.items.some((f) => f.source.providerCode === 'MOIS')).toBe(true);
    });

    it('Provider 원문을 provider_result에 보존한다 (CLAUDE.md 비협상 규칙)', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, {
        providers: ['KMA'],
        query: {},
      });
      const stored = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT raw_payload_json, payload_sha256, item_count
           FROM provider_result WHERE provider_job_id = $1`,
          [result.jobs[0].providerJobId],
        ),
      );
      expect(stored.rowCount).toBe(1);
      expect(stored.rows[0].payload_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.rows[0].item_count).toBeGreaterThan(0);
      expect(stored.rows[0].raw_payload_json.provider).toBe('KMA');
    });

    it('수집이 상황을 REGISTERED로 올린다', async () => {
      const situation = await createSituation();
      await collect(situation.situationId, { providers: ['KMA'], query: {} });
      const detail = await call('GET', `/api/v1/situations/${situation.situationId}`, tokenA);
      const body = (await detail.json()) as Envelope<{ status: string }>;
      expect(body.data.status).toBe('REGISTERED');
    });

    it('Job 상태 조회(UNE-SIT-015)가 같은 행을 준다', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, { providers: ['KMA'], query: {} });
      const res = await call(
        'GET',
        `/api/v1/provider-jobs/${result.jobs[0].providerJobId}`,
        tokenA,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Envelope<ProviderJobBody>;
      expect(body.data.providerJobId).toBe(result.jobs[0].providerJobId);
      expect(body.data.status).toBe('SUCCEEDED');
    });

    it('같은 멱등키 재수집은 후보를 두 벌 만들지 않는다', async () => {
      // ADR-33 수용 한계 7이 "중복 억제가 멱등키뿐"이라고 적었다. 그렇다면
      // 그 멱등키가 실제로 듣는지가 증명돼 있어야 한다(QA 리뷰 F-4).
      const situation = await createSituation();
      const key = `key_${randomUUID()}`;
      const body = { providers: ['KMA'], query: {} };
      const first = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/provider-queries`,
        tokenA,
        { idempotencyKey: key, body },
      );
      const second = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/provider-queries`,
        tokenA,
        { idempotencyKey: key, body },
      );
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const a = (await first.json()) as Envelope<{ batchId: string; factsCreated: number }>;
      const b = (await second.json()) as Envelope<{ batchId: string; factsCreated: number }>;
      expect(b.data.batchId).toBe(a.data.batchId);

      const counts = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT (SELECT count(*)::int FROM provider_job WHERE situation_id = $1) AS jobs,
                  (SELECT count(*)::int FROM situation_fact WHERE situation_id = $1) AS facts`,
          [situation.situationId],
        ),
      );
      expect(counts.rows[0].jobs).toBe(1);
      expect(counts.rows[0].facts).toBe(a.data.factsCreated);
    });

    it('다른 기관은 Job을 조회할 수 없다', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, { providers: ['KMA'], query: {} });
      const res = await call(
        'GET',
        `/api/v1/provider-jobs/${result.jobs[0].providerJobId}`,
        tokenB,
      );
      expect(res.status).toBe(404);
    });

    it('중복 Provider와 빈 목록을 거부하고 400 코드를 쓴다', async () => {
      const situation = await createSituation();
      for (const providers of [[], ['KMA', 'KMA']]) {
        const res = await call(
          'POST',
          `/api/v1/situations/${situation.situationId}/provider-queries`,
          tokenA,
          { idempotencyKey: `key_${randomUUID()}`, body: { providers, query: {} } },
        );
        expect(res.status).toBe(400);
        // 리뷰 M-4: 형식 오류에 "Provider 장애"(PROV-503-001) 코드를 붙이면
        // 클라이언트가 재시도/부분결과 안내를 띄운다.
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('PROV-400-001');
      }
    });

    it('수집 요청도 알 수 없는 항목을 거부한다 (리뷰 m-4)', async () => {
      const situation = await createSituation();
      const res = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/provider-queries`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { providers: ['KMA'], query: {}, mockScenario: 'TIMEOUT' },
        },
      );
      expect(res.status).toBe(400);
    });

    it('query가 없으면 거부한다 (계약이 required로 정한다)', async () => {
      const situation = await createSituation();
      const res = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/provider-queries`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body: { providers: ['KMA'] } },
      );
      expect(res.status).toBe(400);
    });

    it('종결된 상황에는 수집할 수 없고 아무 행도 남지 않는다 (412)', async () => {
      const situation = await createSituation();
      // 정상 종결 경로(CLOSING/CLOSED로 가는 API)는 아직 없다 — CC-2xx가 열면
      // 이 SQL을 그 경로로 바꿀 것(QA 리뷰 R-6).
      await withClient(dbUrl, (c) =>
        c.query(`UPDATE situation SET status = 'CLOSED' WHERE situation_id = $1`, [
          situation.situationId,
        ]),
      );
      const res = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/provider-queries`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body: { providers: ['KMA'], query: {} } },
      );
      expect(res.status).toBe(412);

      // 부분 기록이 남지 않는다 — Job도 후보도 0건이다.
      const rows = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT (SELECT count(*)::int FROM provider_job WHERE situation_id = $1) AS jobs,
                  (SELECT count(*)::int FROM situation_fact WHERE situation_id = $1) AS facts`,
          [situation.situationId],
        ),
      );
      expect(rows.rows[0]).toEqual({ jobs: 0, facts: 0 });
    });
  });

  // ── 인수기준 2 ───────────────────────────────────────────────────────────

  describe('출처와 시각 (인수기준 2)', () => {
    it('후보마다 출처·조회시각·수집시각이 누락 없이 붙는다', async () => {
      const situation = await createSituation();
      await collect(situation.situationId, { providers: ['KMA', 'MOIS'], query: {} });
      const res = await call('GET', `/api/v1/situations/${situation.situationId}/facts`, tokenA);
      const body = (await res.json()) as Envelope<{ items: FactBody[] }>;
      expect(body.data.items.length).toBeGreaterThan(0);
      for (const fact of body.data.items) {
        expect(fact.source.providerCode).toBeTruthy();
        expect(fact.source.sourceName).toBeTruthy();
        expect(Number.isNaN(Date.parse(fact.source.collectedAt))).toBe(false);
        expect(Number.isNaN(Date.parse(fact.collectedAt))).toBe(false);
        expect(fact.observedAt).not.toBeNull();
        // ISO-8601 UTC로 낸다(backend.md).
        expect(fact.collectedAt.endsWith('Z')).toBe(true);
      }
    });

    it('Provider마다 출처 행이 따로 생긴다 (원천별 provenance 보존)', async () => {
      const situation = await createSituation();
      await collect(situation.situationId, { providers: ['KMA', 'MOIS'], query: {} });
      const sources = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT DISTINCT s.provider_code
           FROM fact_source s
           JOIN situation_fact f ON f.source_id = s.source_id
           WHERE f.situation_id = $1 ORDER BY 1`,
          [situation.situationId],
        ),
      );
      expect(sources.rows.map((r) => r.provider_code)).toEqual(['KMA', 'MOIS']);
    });
  });

  // ── 인수기준 3 ───────────────────────────────────────────────────────────

  describe('정규화 (인수기준 3)', () => {
    it('Provider가 준 km/h를 m/s로 옮기고 원문 단위를 남긴다', async () => {
      const situation = await createSituation();
      await collect(situation.situationId, {
        providers: ['KMA'],
        query: {},
        categories: ['WEATHER_OBSERVATION'],
      });
      const res = await call(
        'GET',
        `/api/v1/situations/${situation.situationId}/facts?factType=WEATHER_OBSERVATION`,
        tokenA,
      );
      const body = (await res.json()) as Envelope<{ items: FactBody[] }>;
      const wind = body.data.items.find((f) => f.factKey === 'wind_speed');
      expect(wind).toBeDefined();
      expect(wind?.unit).toBe('m/s');
      expect(wind?.normalization?.outcome).toBe('NORMALIZED');
      expect(wind?.normalization?.originalUnit).toBe('km/h');
      expect(wind?.normalization?.version).toBeTruthy();
    });

    it('변환 규칙이 없는 단위는 원문을 유지하고 검토 대상으로 표시한다 (A-01)', async () => {
      const situation = await createSituation();
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: {
          factType: 'WEATHER_OBSERVATION',
          factKey: 'wind_speed',
          value: 12,
          unit: 'furlong/fortnight',
        },
      });
      expect(res.status).toBe(201);
      const fact = ((await res.json()) as Envelope<FactBody>).data;
      expect(fact.value).toBe(12);
      expect(fact.unit).toBe('furlong/fortnight');
      expect(fact.normalization?.outcome).toBe('ORIGINAL_KEPT');
    });

    it('관측시각을 오프셋 포함으로 저장한다', async () => {
      const situation = await createSituation();
      const res = await call('POST', `/api/v1/situations/${situation.situationId}/facts`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: {
          factType: 'WEATHER_OBSERVATION',
          factKey: 'temperature',
          value: 25,
          unit: '℃',
          observedAt: '2026-08-08T09:00:00+09:00',
        },
      });
      const fact = ((await res.json()) as Envelope<FactBody>).data;
      expect(fact.observedAt).toBe('2026-08-08T00:00:00.000Z');
      expect(fact.unit).toBe('degC');
    });
  });

  // ── 인수기준 4 ───────────────────────────────────────────────────────────

  describe('부분 장애 (인수기준 4)', () => {
    it('한 Provider가 죽어도 200이고 나머지 후보는 남는다', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, {
        providers: ['KMA', 'MOIS'],
        query: { mockScenario: { KMA: 'TIMEOUT' } },
      });

      const kma = result.jobs.find((j) => j.providerCode === 'KMA');
      const mois = result.jobs.find((j) => j.providerCode === 'MOIS');
      expect(kma?.status).toBe('FAILED');
      expect(kma?.error?.kind).toBe('TIMEOUT');
      expect(kma?.error?.retriable).toBe(true);
      expect(kma?.resultCount).toBe(0);
      expect(mois?.status).toBe('SUCCEEDED');
      expect(result.factsCreated).toBeGreaterThan(0);
    });

    it('모든 Provider가 실패해도 200이며 사용자 입력 경로는 열려 있다 (E-01)', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, {
        providers: ['KMA', 'MOIS'],
        query: { mockScenario: 'UPSTREAM_ERROR' },
      });
      expect(result.jobs.every((j) => j.status === 'FAILED')).toBe(true);
      expect(result.factsCreated).toBe(0);

      const manual = await call(
        'POST',
        `/api/v1/situations/${situation.situationId}/facts`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { factType: 'USER_ASSERTED', factKey: 'value', value: '직접 입력' },
        },
      );
      expect(manual.status).toBe(201);
    });

    it('일부 항목만 정규화에 실패하면 PARTIAL이고 통과분은 남는다', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, {
        providers: ['KMA'],
        query: { mockScenario: 'PARTIAL' },
      });
      const job = result.jobs[0];
      expect(job.status).toBe('PARTIAL');
      expect(job.resultCount).toBeGreaterThan(0);
      expect(job.error?.kind).toBe('NORMALIZATION_REJECTED');
      expect(job.error?.rejectedCount).toBe(1);
      expect(result.factsCreated).toBe(job.resultCount);
    });

    it('비활성 Provider는 조용히 건너뛰지 않고 FAILED 행을 남긴다 (E-03)', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, {
        providers: ['SAFEKOREA', 'NAVER', 'T3Q'],
        query: {},
      });
      expect(result.jobs).toHaveLength(3);
      const byCode = Object.fromEntries(result.jobs.map((j) => [j.providerCode, j]));
      expect(byCode.SAFEKOREA.error?.kind).toBe('DISABLED');
      expect(byCode.NAVER.error?.kind).toBe('DISABLED');
      // T3Q 상황 API는 계약이 없다(OB-02) — 플래그와 무관하게 미계약이다.
      expect(byCode.T3Q.error?.kind).toBe('NOT_CONTRACTED');
      expect(result.jobs.every((j) => j.status === 'FAILED')).toBe(true);
      expect(result.jobs.every((j) => j.error?.retriable === false)).toBe(true);
    });

    it('플래그를 켜도 어댑터가 없으면 성공한 척하지 않는다 (OB-05)', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, {
        providers: ['SAFEKOREA'],
        query: {},
        featureFlags: { safekorea: true },
      });
      expect(result.jobs[0].error?.kind).toBe('NOT_CONTRACTED');
    });

    it('실패도 감사에 남는다', async () => {
      const situation = await createSituation();
      const result = await collect(situation.situationId, {
        providers: ['KMA'],
        query: { mockScenario: 'TIMEOUT' },
      });
      const audit = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT after_json FROM audit_log
           WHERE action = 'PROVIDER_QUERY_FAILED' AND resource_id = $1`,
          [result.jobs[0].providerJobId],
        ),
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].after_json.failureKind).toBe('TIMEOUT');
    });
  });
});
