import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.factory';
import { buildMockExternalToken } from '../auth/mock-sso';
import { signUploadTicket } from '../document/upload-ticket';
import { e2eApiConfig } from './test-config';

/**
 * CC-170 UNE-DOC-001~004 e2e — 3단 업로드와 HWPX 반입.
 *
 * 여기서 증명할 것은 **HTTP 표면의 계약**이다: 사전등록의 거부 조건, 티켓의
 * 성질(1회성·만료·파일 귀속), 완료 확정의 검증(크기·해시·내용), 반입의 전제
 * (VERIFIED)와 계획서 링크, 권한과 테넌트 격리, 멱등 재생.
 *
 * 저장소는 인메모리다(vitest.setup.ts의 기본 드라이버). 그래서 티켓은 항상
 * API_DIRECT이며, 그것이 이 테스트가 전송 라우트까지 함께 태울 수 있는 이유다.
 * presign 경로 자체는 provider-adapters의 실 MinIO 테스트가 증명한다.
 */

const ADMIN_URL = process.env.DATABASE_URL;
const SECRET = 'e2e-signing-secret-e2e-signing-secret!!';
const REPO_ROOT = resolve(process.cwd(), '..', '..');
const TEMPLATE = resolve(REPO_ROOT, 'templete', '간략 보고 양식.hwpx');

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
  const tenantA = await tenant('upl-a');
  const tenantB = await tenant('upl-b');
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

  // FILE_UPLOAD와 PLAN_CREATE가 실제로 요구되는지 보려면 권한이 갈린 사용자가
  // 필요하다. reader는 읽기만 가진다.
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('DOC_READ','DOC_EDIT','FILE_UPLOAD','PLAN_CREATE','PLAN_READ')
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
  );
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p ON p.permission_code = 'DOC_READ'
     WHERE r.tenant_id IS NULL AND r.role_code = 'VIEWER'
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
  await c.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     SELECT u.user_id, r.role_id, u.user_id
     FROM app_user u, role r
     WHERE r.tenant_id IS NULL AND r.role_code = 'VIEWER' AND u.user_id = $1`,
    [readerA],
  );
  return { tenantA, tenantB, adminA, readerA, userB };
}

interface RegisterResult {
  fileId: string;
  url: string;
  token: string;
  headers: Record<string, string>;
  driver: string;
  expiresAt: string;
}

describe.skipIf(!ADMIN_URL || !existsSync(TEMPLATE))(
  'CC-170 업로드·반입 e2e (UNE-DOC-001~004)',
  () => {
    let dbName: string;
    let dbUrl: string;
    let app: INestApplication;
    let base: string;
    let fx: Fixtures;
    let tokenA: string;
    let tokenReader: string;
    let tokenB: string;

    const bytes = new Uint8Array(existsSync(TEMPLATE) ? readFileSync(TEMPLATE) : Buffer.alloc(0));
    const sha256 = createHash('sha256').update(bytes).digest('hex');

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
          ...(options.idempotencyKey === undefined
            ? {}
            : { 'idempotency-key': options.idempotencyKey }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });

    /** 본문을 한 번만 읽는다. `expect(res.status, await res.text())`처럼 쓰면
     * 실패 메시지를 만드는 과정에서 스트림이 소비돼 이어지는 json()이 터진다. */
    const readJson = async <T>(res: Response, expected: number): Promise<T> => {
      const text = await res.text();
      expect(res.status, text).toBe(expected);
      return JSON.parse(text) as T;
    };

    const register = async (
      token = tokenA,
      overrides: Record<string, unknown> = {},
    ): Promise<RegisterResult> => {
      const res = await call('POST', '/api/v1/files', token, {
        body: {
          fileName: '간략 보고 양식.hwpx',
          sizeBytes: bytes.length,
          mimeType: 'application/hwp+zip',
          sha256,
          ...overrides,
        },
        idempotencyKey: `reg-${randomUUID()}`,
      });
      const data = (
        await readJson<{
          data: {
            file: { fileId: string };
            upload: {
              url: string;
              headers: Record<string, string>;
              driver: string;
              expiresAt: string;
            };
          };
        }>(res, 201)
      ).data;
      const url = new URL(data.upload.url);
      return {
        fileId: data.file.fileId,
        url: data.upload.url,
        token: url.searchParams.get('token') ?? '',
        headers: data.upload.headers,
        driver: data.upload.driver,
        expiresAt: data.upload.expiresAt,
      };
    };

    /** 발급받은 티켓으로 바이트를 올린다. 절대 URL이 아니라 base를 붙여 쓴다 —
     * 테스트 앱은 임의 포트이므로 설정의 publicBaseUrl과 포트가 다르다. */
    const upload = async (
      ticket: RegisterResult,
      body: Uint8Array = bytes,
      token = ticket.token,
    ): Promise<Response> =>
      fetch(`${base}/api/v1/files/${ticket.fileId}/content?token=${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { ...ticket.headers },
        body,
      });

    const complete = async (fileId: string, token = tokenA): Promise<Response> =>
      call('POST', `/api/v1/files/${fileId}/complete`, token, {
        body: { etag: '"e2e"' },
        idempotencyKey: `cmp-${randomUUID()}`,
      });

    const verifiedFile = async (): Promise<string> => {
      const ticket = await register();
      expect((await upload(ticket)).status).toBe(204);
      await readJson<unknown>(await complete(ticket.fileId), 200);
      return ticket.fileId;
    };

    const createPlan = async (token = tokenA, title = '업로드 e2e 계획서'): Promise<string> => {
      const res = await call('POST', '/api/v1/plans', token, {
        body: { title, startMode: 'UPLOAD_HWPX', hazardType: '폭염', managementPhase: '대비' },
        idempotencyKey: `plan-${randomUUID()}`,
      });
      return (await readJson<{ data: { planId: string } }>(res, 201)).data.planId;
    };

    const importFile = async (
      fileId: string,
      options: { planId?: string; token?: string; title?: string } = {},
    ): Promise<Response> =>
      call('POST', '/api/v1/documents/import-hwpx', options.token ?? tokenA, {
        body: {
          fileId,
          ...(options.planId ? { planId: options.planId } : {}),
          ...(options.title ? { title: options.title } : {}),
        },
        idempotencyKey: `imp-${randomUUID()}`,
      });

    beforeAll(async () => {
      const adminUrl = new URL(ADMIN_URL as string);
      dbName = `cc170_e2e_${randomUUID().slice(0, 8)}`;
      await withClient(ADMIN_URL as string, (c) => c.query(`CREATE DATABASE ${dbName}`));
      adminUrl.pathname = `/${dbName}`;
      dbUrl = adminUrl.toString();
      await runner({
        databaseUrl: dbUrl,
        dir: resolve(REPO_ROOT, 'database', 'migrations'),
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
      tokenReader = await login(fx.tenantA, 'reader-a');
      tokenB = await login(fx.tenantB, 'user-b');
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (dbUrl) {
        await withClient(ADMIN_URL as string, (c) => c.query(`DROP DATABASE IF EXISTS ${dbName}`));
      }
    });

    // --- 정상 경로 -----------------------------------------------------------

    it('사전등록 → 전송 → 완료확정 → 반입 → 분석조회가 이어진다', async () => {
      const ticket = await register();
      // 인메모리 드라이버는 presign을 못 하므로 API 전송 라우트를 가리킨다.
      expect(ticket.driver).toBe('API_DIRECT');
      expect(new Date(ticket.expiresAt).getTime()).toBeGreaterThan(Date.now());

      expect((await upload(ticket)).status).toBe(204);

      const completed = await complete(ticket.fileId);
      expect(completed.status).toBe(200);
      const file = ((await completed.json()) as { data: Record<string, unknown> }).data;
      expect(file.uploadState).toBe('VERIFIED');
      // 검증을 통과해도 AV 스캔은 하지 않았다 — 그것이 사실이다(OB-15).
      expect(file.scanStatus).toBe('PENDING');
      expect(file.verifiedAt).toBeTruthy();
      // 저장소 키는 응답에 나가지 않는다.
      expect(Object.keys(file)).not.toContain('storageKey');

      const planId = await createPlan();
      const imported = await importFile(ticket.fileId, { planId, title: '반입한 계획서 본문' });
      const doc = (await readJson<{ data: Record<string, unknown> }>(imported, 201)).data;
      expect(doc.planId).toBe(planId);
      expect(doc.sourceFileId).toBe(ticket.fileId);
      expect(doc.revisionNo).toBe(1);
      expect(doc.title).toBe('반입한 계획서 본문');
      const analysis = doc.analysis as Record<string, unknown>;
      expect(['AUTO', 'CONFIRM', 'LIMITED', 'REJECT']).toContain(analysis.verdict);
      expect(analysis.analysisHash).toMatch(/^[0-9a-f]{64}$/);

      // 계획서가 실제로 문서를 가리킨다(0003의 plan.document_id — CC-170이 처음 쓴다).
      const planRow = await withClient(dbUrl, (c) =>
        c.query(`SELECT document_id FROM plan WHERE plan_id = $1`, [planId]),
      );
      expect(planRow.rows[0].document_id).toBe(doc.documentId);

      const got = await call('GET', `/api/v1/documents/${doc.documentId}/analysis`, tokenA);
      expect(got.status).toBe(200);
      const detail = ((await got.json()) as { data: Record<string, unknown> }).data;
      expect((detail.analysis as Record<string, unknown>).templateProfileId).toBe(
        analysis.templateProfileId,
      );
      // 전체 프로파일도 함께 나간다(정본 스키마는 contracts/schemas).
      expect((detail.profile as Record<string, unknown>).sourceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(Array.isArray(detail.unsupportedObjects)).toBe(true);

      // 원본 바이트가 그대로 반입됐다 — IR의 sourceHash가 업로드한 해시와 같다.
      expect((detail.profile as { sourceHash: string }).sourceHash).toBe(sha256);
    }, 120_000);

    it('반입은 계획서 없이도 된다 (문서만 만든다)', async () => {
      const fileId = await verifiedFile();
      const res = await importFile(fileId);
      expect(res.status).toBe(201);
      expect(((await res.json()) as { data: { planId: null } }).data.planId).toBeNull();
    }, 120_000);

    // --- 검증 실패 -----------------------------------------------------------

    it('선언한 해시와 다른 바이트는 422 FILE-422-002이고 파일은 ABORTED로 끝난다', async () => {
      const ticket = await register(tokenA, { sha256: 'b'.repeat(64) });
      expect((await upload(ticket)).status).toBe(204);
      const res = await complete(ticket.fileId);
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { code: string; violations: unknown[] } };
      expect(body.error.code).toBe('FILE-422-002');
      expect(JSON.stringify(body.error.violations)).toContain('sha256');

      const row = await withClient(dbUrl, (c) =>
        c.query(`SELECT upload_state, verified_at FROM file_object WHERE file_id = $1`, [
          ticket.fileId,
        ]),
      );
      expect(row.rows[0].upload_state).toBe('ABORTED');
      expect(row.rows[0].verified_at).toBeNull();

      // 거절은 종단이다 — 재확정도 다시 422다.
      expect((await complete(ticket.fileId)).status).toBe(422);
      // 검증되지 않은 파일은 반입할 수 없다.
      const imported = await importFile(ticket.fileId);
      expect(imported.status).toBe(422);
      expect(((await imported.json()) as { error: { code: string } }).error.code).toBe(
        'HWPX-422-001',
      );
    }, 120_000);

    it('HWPX가 아닌 바이트는 크기·해시가 맞아도 거부된다 (내용 기반 판정)', async () => {
      const notHwpx = new Uint8Array(Buffer.from('%PDF-1.7 이것은 HWPX가 아니다'));
      const ticket = await register(tokenA, {
        sizeBytes: notHwpx.length,
        sha256: createHash('sha256').update(notHwpx).digest('hex'),
      });
      expect((await upload(ticket, notHwpx)).status).toBe(204);
      const res = await complete(ticket.fileId);
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: { code: string; violations: unknown[] } };
      expect(body.error.code).toBe('FILE-422-002');
      expect(JSON.stringify(body.error.violations)).toContain('mimeType');
    }, 120_000);

    it('바이트를 올리지 않고 완료하면 409다', async () => {
      const ticket = await register();
      const res = await complete(ticket.fileId);
      expect(res.status).toBe(409);
    }, 120_000);

    // --- 사전등록 거부 -------------------------------------------------------

    it('HWPX가 아닌 MIME·미구현 용도·상한 초과는 422 FILE-422-001이다', async () => {
      for (const overrides of [
        { mimeType: 'application/pdf' },
        { purpose: 'ATTACHMENT' },
        { sizeBytes: 50 * 1024 * 1024 + 1 },
      ]) {
        const res = await call('POST', '/api/v1/files', tokenA, {
          body: {
            fileName: 'x.hwpx',
            sizeBytes: bytes.length,
            mimeType: 'application/hwp+zip',
            sha256,
            ...overrides,
          },
          idempotencyKey: `neg-${randomUUID()}`,
        });
        expect(res.status, JSON.stringify(overrides)).toBe(422);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FILE-422-001');
      }
    }, 120_000);

    it('해시 형식이 아니면 400이다 (도메인 판단 이전)', async () => {
      const res = await call('POST', '/api/v1/files', tokenA, {
        body: {
          fileName: 'x.hwpx',
          sizeBytes: 10,
          mimeType: 'application/hwp+zip',
          sha256: 'NOT-A-HASH',
        },
        idempotencyKey: `neg-${randomUUID()}`,
      });
      expect(res.status).toBe(400);
    }, 120_000);

    // --- 티켓의 성질 ---------------------------------------------------------

    it('티켓은 1회용이며 다른 파일·위조·만료는 403이다', async () => {
      const ticket = await register();
      expect((await upload(ticket)).status).toBe(204);
      // 같은 티켓 재사용: 파일이 이미 PENDING을 벗어나지 않았어도 확정 전에는
      // 다시 쓸 수 있어야 하는가? 아니다 — 확정 전 재전송은 허용하지만(재시도),
      // 확정 후에는 409다. 여기서는 확정 후를 본다.
      expect((await complete(ticket.fileId)).status).toBe(200);
      const again = await upload(ticket);
      expect(again.status).toBe(409);

      // 위조 토큰
      const forged = await upload(ticket, bytes, `${ticket.token}x`);
      expect(forged.status).toBe(403);

      // 다른 파일의 티켓
      const other = await register();
      const crossed = await fetch(
        `${base}/api/v1/files/${other.fileId}/content?token=${encodeURIComponent(ticket.token)}`,
        { method: 'PUT', headers: { 'content-type': 'application/hwp+zip' }, body: bytes },
      );
      expect(crossed.status).toBe(403);

      // 만료된 티켓(서명은 유효하다 — 만료만 지났다)
      const expired = signUploadTicket(SECRET, {
        fileId: other.fileId,
        tenantId: fx.tenantA,
        expiresAt: Math.floor(Date.now() / 1000) - 10,
        sizeBytes: bytes.length,
      });
      expect((await upload(other, bytes, expired)).status).toBe(403);
    }, 120_000);

    it('선언 크기를 넘는 본문은 413이다', async () => {
      const ticket = await register(tokenA, { sizeBytes: 100 });
      const res = await upload(ticket, bytes);
      expect(res.status).toBe(413);
    }, 120_000);

    it('전송 라우트는 Bearer 토큰을 요구하지 않는다 (presign과 같은 성질)', async () => {
      const ticket = await register();
      const res = await fetch(
        `${base}/api/v1/files/${ticket.fileId}/content?token=${encodeURIComponent(ticket.token)}`,
        { method: 'PUT', headers: { 'content-type': 'application/hwp+zip' }, body: bytes },
      );
      expect(res.status).toBe(204);
    }, 120_000);

    // --- 권한·테넌트 ---------------------------------------------------------

    it('FILE_UPLOAD가 없으면 403, PLAN_CREATE가 없으면 반입도 403이다', async () => {
      const res = await call('POST', '/api/v1/files', tokenReader, {
        body: {
          fileName: 'x.hwpx',
          sizeBytes: bytes.length,
          mimeType: 'application/hwp+zip',
          sha256,
        },
        idempotencyKey: `perm-${randomUUID()}`,
      });
      expect(res.status).toBe(403);

      const fileId = await verifiedFile();
      const imported = await importFile(fileId, { token: tokenReader });
      expect(imported.status).toBe(403);
    }, 120_000);

    it('다른 테넌트의 파일은 반입할 수 없다 (404)', async () => {
      const fileId = await verifiedFile();
      const res = await importFile(fileId, { token: tokenB });
      expect(res.status).toBe(404);
    }, 120_000);

    it('다른 테넌트의 파일 완료확정도 404다', async () => {
      const ticket = await register();
      expect((await upload(ticket)).status).toBe(204);
      expect((await complete(ticket.fileId, tokenB)).status).toBe(404);
    }, 120_000);

    // --- 계획서 링크 ---------------------------------------------------------

    it('이미 문서를 가진 계획서에 두 번째 문서를 붙이면 409다', async () => {
      const planId = await createPlan(tokenA, '문서 하나만');
      expect((await importFile(await verifiedFile(), { planId })).status).toBe(201);
      const second = await importFile(await verifiedFile(), { planId });
      expect(second.status).toBe(409);
      // 첫 문서가 그대로 붙어 있다.
      const row = await withClient(dbUrl, (c) =>
        c.query(`SELECT document_id FROM plan WHERE plan_id = $1`, [planId]),
      );
      expect(row.rows[0].document_id).toBeTruthy();
    }, 120_000);

    it('없는 계획서를 지목하면 404이고 문서도 만들어지지 않는다', async () => {
      const before = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int AS n FROM document`),
      );
      const res = await importFile(await verifiedFile(), { planId: randomUUID() });
      expect(res.status).toBe(404);
      const after = await withClient(dbUrl, (c) =>
        c.query(`SELECT count(*)::int AS n FROM document`),
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    }, 120_000);

    // --- 멱등 ---------------------------------------------------------------

    it('같은 Idempotency-Key 재전송은 같은 문서를 돌려준다', async () => {
      const fileId = await verifiedFile();
      const key = `imp-${randomUUID()}`;
      const first = await call('POST', '/api/v1/documents/import-hwpx', tokenA, {
        body: { fileId },
        idempotencyKey: key,
      });
      expect(first.status).toBe(201);
      const second = await call('POST', '/api/v1/documents/import-hwpx', tokenA, {
        body: { fileId },
        idempotencyKey: key,
      });
      expect(second.status).toBe(201);
      const a = ((await first.json()) as { data: { documentId: string } }).data.documentId;
      const b = ((await second.json()) as { data: { documentId: string } }).data.documentId;
      expect(b).toBe(a);
    }, 120_000);

    it('사전등록은 Idempotency-Key가 없으면 400이다', async () => {
      const res = await fetch(`${base}/api/v1/files`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: 'x.hwpx',
          sizeBytes: bytes.length,
          mimeType: 'application/hwp+zip',
          sha256,
        }),
      });
      expect(res.status).toBe(400);
    }, 120_000);

    // --- 분석 조회 -----------------------------------------------------------

    it('분석 이력이 없는 문서는 404 HWPX-404-001이다', async () => {
      const res = await call('GET', `/api/v1/documents/${randomUUID()}/analysis`, tokenA);
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('HWPX-404-001');
    }, 120_000);
  },
);
