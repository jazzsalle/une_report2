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
 * CC-230 인수 증거 — UNE-KNOW-004~007 (설계 06 US-SIT-011).
 *
 * 인수기준 네 가지가 각각 어디서 증명되는가:
 *   snapshot-derived query → "검색" describe (기준 판 필수·낡은 판 409)
 *   Top-K mapping          → "검색"의 topK 단언
 *   source/page/chunk      → "원문 위치" describe
 *   authorization filter   → "외부 문서" 테스트 (UNI가 준 모르는 문서를 버린다)
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

interface EvidenceBody {
  evidenceSetId: string;
  situationId: string;
  snapshotId: string;
  query: string;
  topK: number;
  status: string;
  contentHash: string;
  frozenAt: string | null;
  rejectedChunkCount: number;
  items: {
    evidenceItemId: string;
    knowledgeDocumentId: string;
    rankNo: number;
    quote: string;
    citationKey: string;
    isSelected: boolean;
  }[];
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
        `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1,$1,'ACTIVE')
         RETURNING tenant_id`,
        [code],
      )
    ).rows[0].tenant_id as string;
  const tenantA = await tenant('evd-a');
  const tenantB = await tenant('evd-b');

  const user = async (t: string, login: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1,$2,$2,'ACTIVE') RETURNING user_id`,
        [t, login],
      )
    ).rows[0].user_id as string;
  const adminA = await user(tenantA, 'evd-admin-a');
  const readerA = await user(tenantA, 'evd-reader-a');
  const userB = await user(tenantB, 'evd-user-b');

  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id FROM role r JOIN permission p
       ON p.permission_code IN ('SITUATION_CREATE','SITUATION_READ','SITUATION_CONFIRM',
                                'EVIDENCE_SEARCH','EVIDENCE_READ','EVIDENCE_LOCK')
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
  );
  await c.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     SELECT u.user_id, r.role_id, u.user_id FROM app_user u, role r
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
       AND u.user_id = ANY($1::uuid[])`,
    [[adminA, userB]],
  );

  // 검색 권한만 없는 역할 — 아무 역할도 없으면 "EVIDENCE_SEARCH가 없으면 403"이
  // 엔드포인트가 READ만 요구해도 통과한다.
  const reviewer = (
    await c.query(
      `INSERT INTO role (tenant_id, role_code, role_name, scope_type)
       VALUES ($1,'CC230_READER','근거 조회자','TENANT') RETURNING role_id`,
      [tenantA],
    )
  ).rows[0].role_id as string;
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT $1, p.permission_id FROM permission p
     WHERE p.permission_code IN ('SITUATION_READ','EVIDENCE_READ')`,
    [reviewer],
  );
  await c.query(`INSERT INTO user_role (user_id, role_id, granted_by) VALUES ($1,$2,$1)`, [
    readerA,
    reviewer,
  ]);

  return { tenantA, tenantB, adminA, readerA, userB };
}

describe.skipIf(!ADMIN_URL)('CC-230 근거 검색·EvidenceSet e2e (UNE-KNOW-004~007)', () => {
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

  /** 확정 판과 READY 지식문서를 갖춘 상황을 admin으로 만든다. */
  const scenario = async (
    code: string,
    documentCount = 2,
  ): Promise<{ situationId: string; snapshotId: string; documentIds: string[] }> =>
    withClient(dbUrl, async (c) => {
      const situationId = (
        await c.query(
          `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
           VALUES ($1,'LIVE',$2,'FLOOD','DRAFT',$3) RETURNING situation_id`,
          [fx.tenantA, `상황 ${code}`, fx.adminA],
        )
      ).rows[0].situation_id as string;

      const snapshotId = (
        await c.query(
          `INSERT INTO situation_snapshot
             (situation_id, version_no, facts_json, content_hash, effective_at, confirmed_by)
           VALUES ($1,1,$2::jsonb,$3,now(),$4) RETURNING snapshot_id`,
          [situationId, JSON.stringify([{ k: code }]), 'a'.repeat(64), fx.adminA],
        )
      ).rows[0].snapshot_id as string;
      await c.query(`UPDATE situation SET current_snapshot_id = $2 WHERE situation_id = $1`, [
        situationId,
        snapshotId,
      ]);

      const documentIds: string[] = [];
      for (let i = 0; i < documentCount; i += 1) {
        const sha = createHash('sha256').update(`${code}-${i}`).digest('hex');
        const fileId = (
          await c.query(
            `INSERT INTO file_object
               (tenant_id, original_name, mime_type, size_bytes, sha256, storage_key,
                scan_status, upload_state, verified_at, purpose, created_by)
             VALUES ($1,$2,'application/pdf',10,$3,$4,'CLEAN','VERIFIED',now(), 'KNOWLEDGE_DOCUMENT', $5)
             RETURNING file_id`,
            [fx.tenantA, `${code}-${i}.pdf`, sha, `k/${code}-${i}`, fx.adminA],
          )
        ).rows[0].file_id as string;
        const docId = (
          await c.query(
            `INSERT INTO knowledge_document
               (tenant_id, situation_id, file_id, document_type, status, retention_scope,
                source_sha256, metadata_json, created_by, provider_document_id,
                uni_status, uni_observed_at)
             VALUES ($1,$2,$3,'MANUAL','REGISTERED','THIS_INCIDENT',$4,'{}'::jsonb,$5,
                     $6,'READY',now())
             RETURNING knowledge_document_id`,
            [fx.tenantA, situationId, fileId, sha, fx.adminA, `uni-${code}-${i}`],
          )
        ).rows[0].knowledge_document_id as string;
        documentIds.push(docId);
      }
      return { situationId, snapshotId, documentIds };
    });

  const search = async (
    situationId: string,
    snapshotId: string,
    extra: Record<string, unknown> = {},
    token = tokenA,
  ): Promise<Response> =>
    call('POST', `/api/v1/situations/${situationId}/evidence-searches`, token, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { snapshotId, query: '태풍 대응 단계별 조치', ...extra },
    });

  beforeAll(async () => {
    if (!existsSync(MIGRATIONS_DIR)) throw new Error('migrations dir not found');
    // mock 시나리오 훅은 설정으로만 켜진다(ADR-33 D19). e2e가 A-01·E-02
    // 갈래를 밟으려면 여기서 켜야 한다.
    process.env.UNE_UNI_MOCK_SCENARIOS = 'true';

    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc230_e2e_${randomUUID().slice(0, 8)}`;
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
    tokenA = await login(fx.tenantA, 'evd-admin-a');
    tokenB = await login(fx.tenantB, 'evd-user-b');
    tokenReader = await login(fx.tenantA, 'evd-reader-a');
  }, 180_000);

  afterAll(async () => {
    delete process.env.UNE_UNI_MOCK_SCENARIOS;
    if (app) await app.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  describe('검색 (UNE-KNOW-004)', () => {
    it('동기로 200을 돌려주고 DRAFT EvidenceSet과 잡·원문을 남긴다', async () => {
      const s = await scenario('ok');
      const res = await search(s.situationId, s.snapshotId);
      // 202가 아니라 200이다 — 사용자가 곧바로 결과를 보고 고른다.
      expect(res.status).toBe(200);
      const set = ((await res.json()) as Envelope<EvidenceBody>).data;
      expect(set.status).toBe('DRAFT');
      expect(set.snapshotId).toBe(s.snapshotId);
      expect(set.items).toHaveLength(2);
      expect(set.items.map((i) => i.rankNo)).toEqual([1, 2]);
      expect(set.items.map((i) => i.citationKey)).toEqual(['E1', 'E2']);
      expect(set.items.every((i) => i.isSelected)).toBe(true);
      expect(set.contentHash).toMatch(/^[0-9a-f]{64}$/);

      const job = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT j.status, j.request_json, r.item_count
             FROM provider_job j LEFT JOIN provider_result r USING (provider_job_id)
            WHERE j.provider_code = 'UNI' AND j.situation_id = $1`,
          [s.situationId],
        ),
      );
      expect(job.rows[0].status).toBe('SUCCEEDED');
      expect(job.rows[0].request_json).toMatchObject({ operation: 'searchEvidence' });
      expect(job.rows[0].item_count).toBe(2);
    });

    it('topK를 넘지 않는다', async () => {
      const s = await scenario('topk', 5);
      const res = await search(s.situationId, s.snapshotId, { topK: 2 });
      const set = ((await res.json()) as Envelope<EvidenceBody>).data;
      expect(set.topK).toBe(2);
      expect(set.items).toHaveLength(2);
    });

    it('확정된 판이 없으면 412다', async () => {
      const s = await scenario('nosnap');
      await withClient(dbUrl, (c) =>
        c.query(`UPDATE situation SET current_snapshot_id = NULL WHERE situation_id = $1`, [
          s.situationId,
        ]),
      );
      const res = await search(s.situationId, s.snapshotId);
      expect(res.status).toBe(412);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe('EVID-412-001');
    });

    it('낡은 판으로는 검색할 수 없다 (동결되면 어긋남이 굳는다)', async () => {
      const s = await scenario('stale');
      const res = await search(s.situationId, randomUUID());
      expect(res.status).toBe(409);
      const err = (await res.json()) as { error: { code: string; userAction: string } };
      expect(err.error.code).toBe('EVID-409-002');
      expect(err.error.userAction).toContain(s.snapshotId);
    });

    it('근거 자격 문서가 없으면 UNI를 부르지 않고 빈 집합을 만든다 (A-01)', async () => {
      const s = await scenario('empty', 0);
      const res = await search(s.situationId, s.snapshotId);
      expect(res.status).toBe(200);
      const set = ((await res.json()) as Envelope<EvidenceBody>).data;
      expect(set.items).toEqual([]);

      // UNI 호출이 없었으므로 원문도 없다.
      const raw = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT count(*)::int n FROM provider_result r JOIN provider_job j USING (provider_job_id)
            WHERE j.situation_id = $1`,
          [s.situationId],
        ),
      );
      expect(raw.rows[0].n).toBe(0);
    });

    it('UNI가 모르는 문서를 주면 버리고 그 수를 알려준다 (E-02 authorization filter)', async () => {
      const s = await scenario('foreign');
      const res = await search(s.situationId, s.snapshotId, { query: '.foreign. 침입 시도' });
      expect(res.status).toBe(200);
      const set = ((await res.json()) as Envelope<EvidenceBody>).data;
      // mock이 남의 문서 하나를 섞어 보낸다. 조용히 버리지 않고 수를 싣는다.
      expect(set.rejectedChunkCount).toBe(1);
      expect(set.items).toHaveLength(2);
      for (const item of set.items) {
        expect(s.documentIds).toContain(item.knowledgeDocumentId);
      }
    });

    it('검색이 실패해도 잡과 원문이 남고 422로 알린다 (E-01)', async () => {
      // QA 검토 C1: 실패 경로가 mock에 없어 UNI-422-002가 한 번도 증명되지
      // 않았다. **잡과 원문이 커밋되는 것**이 D9의 핵심이다 — 트랜잭션 안에서
      // 던지면 롤백되어 "왜 실패했는가"에 답할 수 없다.
      const s = await scenario('fail');
      const res = await search(s.situationId, s.snapshotId, { query: '.search-fail. 대피' });
      expect(res.status).toBe(422);
      const err = (await res.json()) as { error: { code: string; recoverable: boolean } };
      expect(err.error.code).toBe('UNI-422-002');
      expect(err.error.recoverable).toBe(true);

      const job = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT j.status, j.error_json, r.raw_payload_json
             FROM provider_job j LEFT JOIN provider_result r USING (provider_job_id)
            WHERE j.provider_code='UNI' AND j.situation_id=$1`,
          [s.situationId],
        ),
      );
      expect(job.rows[0].status).toBe('FAILED');
      expect(job.rows[0].error_json).toMatchObject({ code: 'UNI_TIMEOUT' });
      // 원문이 남아야 "무엇을 물었고 무엇이 돌아왔는가"에 답할 수 있다.
      expect(job.rows[0].raw_payload_json).not.toBeNull();

      // EvidenceSet은 만들어지지 않는다.
      const sets = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int n FROM evidence_set WHERE situation_id=$1`, [s.situationId]),
      );
      expect(sets.rows[0].n).toBe(0);

      // 실패 후 다시 검색할 수 있다.
      const retry = await search(s.situationId, s.snapshotId);
      expect(retry.status).toBe(200);
    });

    it('종료된 상황에는 근거를 모을 수 없다', async () => {
      const s = await scenario('closed');
      await withClient(dbUrl, (c) =>
        c.query(`UPDATE situation SET status='CLOSED' WHERE situation_id=$1`, [s.situationId]),
      );
      const res = await search(s.situationId, s.snapshotId);
      expect(res.status).toBe(412);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe('EVID-412-002');
    });

    it('질의의 개인정보를 줄여 저장한다 (US-SIT-011 1단계)', async () => {
      const s = await scenario('pii');
      const res = await search(s.situationId, s.snapshotId, {
        query: '신고자 010-1234-5678 hong@example.com 대피 절차',
      });
      const set = ((await res.json()) as Envelope<EvidenceBody>).data;
      expect(set.query).not.toContain('010-1234-5678');
      expect(set.query).not.toContain('hong@example.com');
      expect(set.query).toContain('[연락처]');

      // UNI로 나간 질의도 같은 값이어야 한다 — 저장만 가리고 보내는 것은
      // 원문이면 규칙을 어긴 것이다.
      const job = await withClient(dbUrl, (c) =>
        c.query(
          `SELECT request_json FROM provider_job
            WHERE provider_code='UNI' AND situation_id=$1`,
          [s.situationId],
        ),
      );
      expect(JSON.stringify(job.rows[0].request_json)).not.toContain('010-1234-5678');
    });

    it('권한·멱등·본문을 검사한다', async () => {
      const s = await scenario('guard');
      expect((await search(s.situationId, s.snapshotId, {}, tokenReader)).status).toBe(403);
      expect((await search(s.situationId, s.snapshotId, {}, tokenB)).status).toBe(404);

      const noKey = await call(
        'POST',
        `/api/v1/situations/${s.situationId}/evidence-searches`,
        tokenA,
        { body: { snapshotId: s.snapshotId, query: 'q' } },
      );
      expect(noKey.status).toBe(400);

      const bad = await search(s.situationId, s.snapshotId, { query: '', topK: 999, oops: 1 });
      expect(bad.status).toBe(400);
      const err = (await bad.json()) as {
        error: { code: string; violations: { field: string }[] };
      };
      expect(err.error.code).toBe('EVID-400-001');
      const fields = err.error.violations.map((v) => v.field);
      expect(fields).toEqual(expect.arrayContaining(['query', 'topK', 'oops']));
    });
  });

  describe('조회·동결·원문 위치 (UNE-KNOW-005~007)', () => {
    const made = async (code: string): Promise<EvidenceBody> => {
      const s = await scenario(code);
      const res = await search(s.situationId, s.snapshotId);
      expect(res.status).toBe(200);
      return ((await res.json()) as Envelope<EvidenceBody>).data;
    };

    it('조회하면 근거가 함께 온다', async () => {
      const set = await made('get');
      const res = await call('GET', `/api/v1/evidence-sets/${set.evidenceSetId}`, tokenA);
      expect(res.status).toBe(200);
      const got = ((await res.json()) as Envelope<EvidenceBody>).data;
      expect(got.items).toHaveLength(set.items.length);
    });

    it('남의 기관 EvidenceSet은 404다', async () => {
      const set = await made('cross');
      expect((await call('GET', `/api/v1/evidence-sets/${set.evidenceSetId}`, tokenB)).status).toBe(
        404,
      );
    });

    it('동결하면 FROZEN이 되고 이후 다시 동결할 수 없다', async () => {
      const set = await made('freeze');
      const res = await call('POST', `/api/v1/evidence-sets/${set.evidenceSetId}/lock`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { reason: 'SOP 생성 직전 동결' },
      });
      expect(res.status).toBe(200);
      const frozen = ((await res.json()) as Envelope<EvidenceBody>).data;
      expect(frozen.status).toBe('FROZEN');
      expect(frozen.frozenAt).not.toBeNull();

      const again = await call('POST', `/api/v1/evidence-sets/${set.evidenceSetId}/lock`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { reason: '두 번째' },
      });
      expect(again.status).toBe(409);
      const err = (await again.json()) as { error: { code: string } };
      expect(err.error.code).toBe('EVID-409-001');
    });

    it('동결 뒤에는 DB 수준에서도 항목이 바뀌지 않는다', async () => {
      const set = await made('immutable');
      await call('POST', `/api/v1/evidence-sets/${set.evidenceSetId}/lock`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { reason: '동결' },
      });
      await expect(
        withClient(dbUrl, (c) =>
          c.query(`DELETE FROM evidence_item WHERE evidence_set_id = $1`, [set.evidenceSetId]),
        ),
      ).rejects.toThrow(/동결된/);
    });

    it('선택된 근거가 없으면 동결할 수 없다', async () => {
      const set = await made('noselect');
      await withClient(dbUrl, (c) =>
        c.query(
          `UPDATE evidence_item SET is_selected = false, excluded_reason = '공식 매뉴얼과 충돌'
            WHERE evidence_set_id = $1`,
          [set.evidenceSetId],
        ),
      );
      const res = await call('POST', `/api/v1/evidence-sets/${set.evidenceSetId}/lock`, tokenA, {
        idempotencyKey: `key_${randomUUID()}`,
        body: { reason: '빈 동결' },
      });
      expect(res.status).toBe(422);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe('EVID-422-001');
    });

    it('동결 권한이 없으면 403이고 사유가 없으면 400이다', async () => {
      const set = await made('lockguard');
      expect(
        (
          await call('POST', `/api/v1/evidence-sets/${set.evidenceSetId}/lock`, tokenReader, {
            idempotencyKey: `key_${randomUUID()}`,
            body: { reason: 'x' },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('POST', `/api/v1/evidence-sets/${set.evidenceSetId}/lock`, tokenA, {
            idempotencyKey: `key_${randomUUID()}`,
            body: {},
          })
        ).status,
      ).toBe(400);
    });

    it('근거의 원문 위치를 돌려준다 (source/page/chunk)', async () => {
      const set = await made('source');
      const item = set.items[0];
      const res = await call('GET', `/api/v1/evidence-items/${item.evidenceItemId}/source`, tokenA);
      expect(res.status).toBe(200);
      const loc = (
        (await res.json()) as Envelope<{
          knowledgeDocumentId: string;
          fileName: string;
          providerChunkId: string | null;
          citationKey: string;
          quote: string;
        }>
      ).data;
      expect(loc.knowledgeDocumentId).toBe(item.knowledgeDocumentId);
      expect(loc.fileName).toContain('.pdf');
      expect(loc.citationKey).toBe(item.citationKey);
      expect(loc.quote).toBe(item.quote);
      expect(loc.providerChunkId).not.toBeNull();
    });

    it('남의 기관 근거의 원문 위치는 404다', async () => {
      const set = await made('source-cross');
      expect(
        (await call('GET', `/api/v1/evidence-items/${set.items[0].evidenceItemId}/source`, tokenB))
          .status,
      ).toBe(404);
    });
  });
});
