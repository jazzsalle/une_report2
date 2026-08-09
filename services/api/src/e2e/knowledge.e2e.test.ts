import { createHash, randomUUID } from 'node:crypto';
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
 * CC-220 인수 증거 — UNE-KNOW-001/002/003 (설계 06 US-SIT-009·US-SIT-010).
 *
 * 워커 쪽 파이프라인은 `services/worker/src/knowledge`의 e2e가 덮는다. 여기서
 * 증명하는 것은 **HTTP 경계**다: 권한, 멱등, 202, 파일 검사 거부, 중복 선택,
 * 보존범위 거부, 재시도 차단.
 *
 * 이 파일이 없어서 놓쳤던 결함이 실제로 있었다 — UNI 처리 실패의 재시도가
 * 두 축 중 하나만 되돌려 재업로드가 성공해도 문서가 영원히 ERROR에 고정됐다.
 * 재시도 e2e 하나가 그것을 잡았을 것이다(QA 검토 F4·F6).
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

interface Envelope<T> {
  success: boolean;
  data: T;
}

interface KnowledgeBody {
  knowledgeDocumentId: string;
  status: string;
  uniStatus: string | null;
  retentionScope: string;
  evidenceEligible: boolean;
  searchable: boolean;
  attemptCount: number;
  providerDocumentId: string | null;
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
  const tenantA = await tenant('know-a');
  const tenantB = await tenant('know-b');

  const user = async (tenantId: string, login: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, login],
      )
    ).rows[0].user_id as string;
  const adminA = await user(tenantA, 'know-admin-a');
  const readerA = await user(tenantA, 'know-reader-a');
  const userB = await user(tenantB, 'know-user-b');

  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('SITUATION_CREATE','SITUATION_READ',
                                'KNOWLEDGE_UPLOAD','KNOWLEDGE_READ')
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

  // 업로드만 없는 역할. 아무 역할도 주지 않으면 "KNOWLEDGE_UPLOAD가 없으면
  // 403"이 엔드포인트가 READ만 요구해도 통과한다 — 권한 축이 격리되지 않는다.
  const reviewer = await c.query(
    `INSERT INTO role (tenant_id, role_code, role_name, scope_type)
     VALUES ($1, 'CC220_READER', '자료 조회자(업로드 제외)', 'TENANT')
     RETURNING role_id`,
    [tenantA],
  );
  const reviewerRoleId = reviewer.rows[0].role_id as string;
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT $1, p.permission_id FROM permission p
     WHERE p.permission_code IN ('SITUATION_READ','KNOWLEDGE_READ')`,
    [reviewerRoleId],
  );
  await c.query(`INSERT INTO user_role (user_id, role_id, granted_by) VALUES ($1, $2, $1)`, [
    readerA,
    reviewerRoleId,
  ]);

  return { tenantA, tenantB, adminA, readerA, userB };
}

describe.skipIf(!ADMIN_URL)('CC-220 지식문서 e2e (UNE-KNOW-001~003)', () => {
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
    options: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  const createSituation = async (): Promise<string> => {
    const res = await call('POST', '/api/v1/situations', tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { mode: 'LIVE', title: 'CC-220 상황', hazardType: '태풍/호우' },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as Envelope<{ situationId: string }>).data.situationId;
  };

  /** 업로드 검증까지 끝난 파일을 직접 넣는다 — CC-220의 대상은 그 이후다. */
  const makeFile = async (
    tenantId: string,
    userId: string,
    opts: { scan?: string; upload?: string; mime?: string; size?: number; seed?: string } = {},
  ): Promise<{ fileId: string; sha: string }> => {
    const seed = opts.seed ?? randomUUID();
    const sha = createHash('sha256').update(seed).digest('hex');
    const fileId = await withClient(
      dbUrl,
      async (c) =>
        (
          await c.query(
            `INSERT INTO file_object
             (tenant_id, original_name, mime_type, size_bytes, sha256, storage_key,
              scan_status, upload_state, verified_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar,
                   CASE WHEN $8::varchar = 'VERIFIED' THEN now() ELSE NULL END, $9)
           RETURNING file_id`,
            [
              tenantId,
              'manual.pdf',
              opts.mime ?? 'application/pdf',
              opts.size ?? 1024,
              sha,
              `tenants/${tenantId}/k/${randomUUID()}.bin`,
              opts.scan ?? 'CLEAN',
              opts.upload ?? 'VERIFIED',
              userId,
            ],
          )
        ).rows[0].file_id as string,
    );
    return { fileId, sha };
  };

  const register = async (
    situationId: string,
    fileId: string,
    token = tokenA,
    extra: Record<string, unknown> = {},
  ): Promise<Response> =>
    call('POST', `/api/v1/situations/${situationId}/knowledge-documents`, token, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { fileId, documentType: 'MANUAL', ...extra },
    });

  beforeAll(async () => {
    if (!existsSync(MIGRATIONS_DIR)) throw new Error(`migrations dir not found`);
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc220_e2e_${randomUUID().slice(0, 8)}`;
    await withClient(ADMIN_URL as string, (c) => c.query(`CREATE DATABASE ${dbName}`));
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
    tokenA = await login(fx.tenantA, 'know-admin-a');
    tokenB = await login(fx.tenantB, 'know-user-b');
    tokenReader = await login(fx.tenantA, 'know-reader-a');
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  describe('등록 (UNE-KNOW-001)', () => {
    it('202로 접수하고 UNI 전송 잡을 같은 트랜잭션에 만든다', async () => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA);
      const res = await register(situationId, fileId);

      // 201이 아니라 202다 — 끝난 것은 접수이고 UNI 처리는 시작도 안 했다.
      expect(res.status).toBe(202);
      const doc = ((await res.json()) as Envelope<KnowledgeBody>).data;
      expect(doc.status).toBe('PENDING_UPLOAD');
      expect(doc.uniStatus).toBeNull();
      expect(doc.retentionScope).toBe('THIS_INCIDENT');
      expect(doc.evidenceEligible).toBe(false);
      expect(doc.attemptCount).toBe(1);

      const rows = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT j.status, j.provider_code, j.request_json, j.finished_at
             FROM provider_job j
             JOIN knowledge_document k ON k.provider_job_id = j.provider_job_id
            WHERE k.knowledge_document_id = $1`,
          [doc.knowledgeDocumentId],
        ),
      );
      expect(rows.rowCount).toBe(1);
      expect(rows.rows[0].status).toBe('QUEUED');
      expect(rows.rows[0].provider_code).toBe('UNI');
      expect(rows.rows[0].finished_at).toBeNull();
      expect(rows.rows[0].request_json).toMatchObject({ operation: 'uploadDocument', fileId });

      // 감사가 같은 트랜잭션에 남는다.
      const audit = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'DOCUMENT_UPLOAD_REQUESTED'`),
      );
      expect(audit.rows[0].n).toBeGreaterThan(0);
    });

    it('KNOWLEDGE_UPLOAD가 없으면 403이다', async () => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA);
      const res = await register(situationId, fileId, tokenReader);
      expect(res.status).toBe(403);
    });

    it('멱등키가 없으면 400, 같은 키는 재생한다', async () => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA);

      const noKey = await call(
        'POST',
        `/api/v1/situations/${situationId}/knowledge-documents`,
        tokenA,
        { body: { fileId, documentType: 'MANUAL' } },
      );
      expect(noKey.status).toBe(400);

      const key = `key_${randomUUID()}`;
      const first = await call(
        'POST',
        `/api/v1/situations/${situationId}/knowledge-documents`,
        tokenA,
        { idempotencyKey: key, body: { fileId, documentType: 'MANUAL' } },
      );
      expect(first.status).toBe(202);
      const second = await call(
        'POST',
        `/api/v1/situations/${situationId}/knowledge-documents`,
        tokenA,
        { idempotencyKey: key, body: { fileId, documentType: 'MANUAL' } },
      );
      expect(second.status).toBe(202);

      const a = ((await first.json()) as Envelope<KnowledgeBody>).data;
      const b = ((await second.json()) as Envelope<KnowledgeBody>).data;
      expect(b.knowledgeDocumentId).toBe(a.knowledgeDocumentId);

      // 재생이므로 문서도 잡도 하나뿐이다.
      const n = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM knowledge_document WHERE file_id = $1`, [fileId]),
      );
      expect(n.rows[0].n).toBe(1);
    });

    it('검사 결과가 없는 파일은 422다 (OB-15 — 하지 않은 검사를 통과로 적지 않는다)', async () => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA, { scan: 'PENDING' });
      const res = await register(situationId, fileId);
      expect(res.status).toBe(422);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe('KNOW-422-001');

      // 거부도 감사에 남는다 (US-SIT-009 E-01 UPLOAD_REJECTED).
      const audit = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'DOCUMENT_UPLOAD_REJECTED'`),
      );
      expect(audit.rows[0].n).toBeGreaterThan(0);
    });

    it('업로드 검증 전 파일과 감염 파일도 거부한다', async () => {
      const situationId = await createSituation();
      const unverified = await makeFile(fx.tenantA, fx.adminA, { upload: 'PENDING' });
      expect((await register(situationId, unverified.fileId)).status).toBe(422);
      const infected = await makeFile(fx.tenantA, fx.adminA, { scan: 'INFECTED' });
      expect((await register(situationId, infected.fileId)).status).toBe(422);
    });

    it('허용되지 않은 형식은 422다', async () => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA, { mime: 'application/zip' });
      expect((await register(situationId, fileId)).status).toBe(422);
    });

    it('기관 KB 보존범위는 등록으로 지정할 수 없다 (자동승격 금지)', async () => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA);
      const res = await register(situationId, fileId, tokenA, { retentionScope: 'ORG_KB' });
      expect(res.status).toBe(422);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe('KNOW-422-002');
    });

    it('같은 내용이 이미 있으면 409로 선택을 되돌리고 force면 통과한다 (A-01)', async () => {
      const situationId = await createSituation();
      const seed = randomUUID();
      const first = await makeFile(fx.tenantA, fx.adminA, { seed });
      const okRes = await register(situationId, first.fileId);
      expect(okRes.status).toBe(202);
      const existing = ((await okRes.json()) as Envelope<KnowledgeBody>).data;

      const dupFile = await makeFile(fx.tenantA, fx.adminA, { seed });
      const dup = await register(situationId, dupFile.fileId);
      expect(dup.status).toBe(409);
      const err = (await dup.json()) as { error: { code: string; userAction: string } };
      expect(err.error.code).toBe('KNOW-409-001');
      // 기존 자료를 알려줘야 사용자가 재사용을 고를 수 있다.
      expect(err.error.userAction).toContain(existing.knowledgeDocumentId);

      const forced = await register(situationId, dupFile.fileId, tokenA, { force: true });
      expect(forced.status).toBe(202);
    });

    it('없는 파일·없는 상황·다른 테넌트는 404다', async () => {
      const situationId = await createSituation();
      const missing = await register(situationId, randomUUID());
      expect(missing.status).toBe(404);

      const { fileId } = await makeFile(fx.tenantA, fx.adminA);
      // tenantB 사용자가 tenantA의 상황에 올리려 하면 상황이 보이지 않는다.
      expect((await register(situationId, fileId, tokenB)).status).toBe(404);
    });

    it('요청 본문을 검증한다', async () => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA);
      const bad = await call(
        'POST',
        `/api/v1/situations/${situationId}/knowledge-documents`,
        tokenA,
        {
          idempotencyKey: `key_${randomUUID()}`,
          body: { fileId, documentType: 'NOPE', unknownField: 1 },
        },
      );
      expect(bad.status).toBe(400);
      const err = (await bad.json()) as {
        error: { code: string; violations: { field: string }[] };
      };
      expect(err.error.code).toBe('KNOW-400-001');
      const fields = err.error.violations.map((v) => v.field);
      expect(fields).toContain('documentType');
      expect(fields).toContain('unknownField');
    });
  });

  describe('조회 (UNE-KNOW-002)', () => {
    it('저장된 관측값을 돌려주고 두 축을 함께 싣는다', async () => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA);
      const created = (
        (await (await register(situationId, fileId)).json()) as Envelope<KnowledgeBody>
      ).data;

      const res = await call(
        'GET',
        `/api/v1/knowledge-documents/${created.knowledgeDocumentId}`,
        tokenA,
      );
      expect(res.status).toBe(200);
      const doc = ((await res.json()) as Envelope<KnowledgeBody>).data;
      expect(doc.status).toBe('PENDING_UPLOAD');
      expect(doc.uniStatus).toBeNull();
      expect(doc.evidenceEligible).toBe(false);
      expect(doc.searchable).toBe(false);
    });

    it('다른 테넌트의 문서는 404다', async () => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA);
      const created = (
        (await (await register(situationId, fileId)).json()) as Envelope<KnowledgeBody>
      ).data;
      const res = await call(
        'GET',
        `/api/v1/knowledge-documents/${created.knowledgeDocumentId}`,
        tokenB,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('재시도 (UNE-KNOW-003)', () => {
    /** 워커가 한 일을 흉내낸다 — 여기서 검증할 것은 HTTP 경계다. */
    const settle = async (id: string, patch: string, params: unknown[] = []): Promise<void> => {
      await withClient(dbUrl, (c) =>
        c.query(`UPDATE knowledge_document SET ${patch} WHERE knowledge_document_id = $1`, [
          id,
          ...params,
        ]),
      );
    };

    const registered = async (): Promise<KnowledgeBody> => {
      const situationId = await createSituation();
      const { fileId } = await makeFile(fx.tenantA, fx.adminA);
      return ((await (await register(situationId, fileId)).json()) as Envelope<KnowledgeBody>).data;
    };

    it('실패하지 않은 자료는 재시도할 수 없다', async () => {
      const doc = await registered();
      const res = await call(
        'POST',
        `/api/v1/knowledge-documents/${doc.knowledgeDocumentId}/retry`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body: { reason: '확인' } },
      );
      expect(res.status).toBe(409);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe('UNI-409-001');
    });

    it('전송 실패는 재시도되고 새 잡이 QUEUED로 생긴다', async () => {
      const doc = await registered();
      await settle(
        doc.knowledgeDocumentId,
        `status = 'FAILED', error_json = '{"code":"x"}'::jsonb`,
      );

      const res = await call(
        'POST',
        `/api/v1/knowledge-documents/${doc.knowledgeDocumentId}/retry`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body: { reason: '일시 장애' } },
      );
      expect(res.status).toBe(202);
      const after = ((await res.json()) as Envelope<KnowledgeBody>).data;
      expect(after.status).toBe('PENDING_UPLOAD');
      expect(after.attemptCount).toBe(2);

      // 재시도는 항상 force다 — 앞선 시도가 저쪽에 문서를 남겼을 수 있다.
      const job = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT j.status, j.request_json FROM provider_job j
             JOIN knowledge_document k ON k.provider_job_id = j.provider_job_id
            WHERE k.knowledge_document_id = $1`,
          [doc.knowledgeDocumentId],
        ),
      );
      expect(job.rows[0].status).toBe('QUEUED');
      expect(job.rows[0].request_json).toMatchObject({ force: true });
    });

    it('UNI 처리 실패의 재시도는 두 축을 모두 되돌린다', async () => {
      // 이것이 QA 검토 F4가 잡은 결함이다. uni_status를 남기면 재업로드가
      // 성공해도 폴링 대상에서 영원히 빠지고 근거 자격을 얻지 못한다.
      const doc = await registered();
      await settle(
        doc.knowledgeDocumentId,
        `status = 'REGISTERED', provider_document_id = 'uni-old',
         uni_status = 'ERROR', uni_observed_at = now()`,
      );

      const res = await call(
        'POST',
        `/api/v1/knowledge-documents/${doc.knowledgeDocumentId}/retry`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body: { reason: 'UNI 처리 실패' } },
      );
      expect(res.status).toBe(202);
      const after = ((await res.json()) as Envelope<KnowledgeBody>).data;
      expect(after.status).toBe('PENDING_UPLOAD');
      expect(after.uniStatus).toBeNull();

      const row = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT uni_status, uni_observed_at FROM knowledge_document
            WHERE knowledge_document_id = $1`,
          [doc.knowledgeDocumentId],
        ),
      );
      expect(row.rows[0].uni_status).toBeNull();
      expect(row.rows[0].uni_observed_at).toBeNull();
    });

    it('두 번째 재시도는 409다 (동시 재시도가 UNI에 두 벌을 만들지 않는다)', async () => {
      const doc = await registered();
      await settle(
        doc.knowledgeDocumentId,
        `status = 'REGISTERED', provider_document_id = 'uni-old',
         uni_status = 'ERROR', uni_observed_at = now()`,
      );

      const [r1, r2] = await Promise.all([
        call('POST', `/api/v1/knowledge-documents/${doc.knowledgeDocumentId}/retry`, tokenA, {
          idempotencyKey: `key_${randomUUID()}`,
          body: { reason: '재시도 1' },
        }),
        call('POST', `/api/v1/knowledge-documents/${doc.knowledgeDocumentId}/retry`, tokenA, {
          idempotencyKey: `key_${randomUUID()}`,
          body: { reason: '재시도 2' },
        }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([202, 409]);

      const jobs = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT count(*)::int n FROM provider_job
            WHERE provider_code = 'UNI' AND status = 'QUEUED'
              AND request_json->>'knowledgeDocumentId' = $1`,
          [doc.knowledgeDocumentId],
        ),
      );
      // 등록 시 만든 잡 하나 + 재시도 하나 = 둘. 셋이면 두 재시도가 모두
      // 통과한 것이고 UNI에 같은 문서가 두 벌 올라간다.
      expect(jobs.rows[0].n).toBe(2);
    });

    it('시도 횟수를 다 쓰면 409다', async () => {
      const doc = await registered();
      await settle(
        doc.knowledgeDocumentId,
        `status = 'FAILED', error_json = '{"code":"x"}'::jsonb, attempt_count = 3`,
      );
      const res = await call(
        'POST',
        `/api/v1/knowledge-documents/${doc.knowledgeDocumentId}/retry`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body: { reason: '한 번 더' } },
      );
      expect(res.status).toBe(409);
    });

    it('사유가 없으면 400이고 권한이 없으면 403이다', async () => {
      const doc = await registered();
      const noReason = await call(
        'POST',
        `/api/v1/knowledge-documents/${doc.knowledgeDocumentId}/retry`,
        tokenA,
        { idempotencyKey: `key_${randomUUID()}`, body: {} },
      );
      expect(noReason.status).toBe(400);

      const forbidden = await call(
        'POST',
        `/api/v1/knowledge-documents/${doc.knowledgeDocumentId}/retry`,
        tokenReader,
        { idempotencyKey: `key_${randomUUID()}`, body: { reason: '시도' } },
      );
      expect(forbidden.status).toBe(403);
    });
  });
});
