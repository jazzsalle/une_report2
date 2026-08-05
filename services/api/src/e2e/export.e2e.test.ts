import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryObjectStorage, exportObjectKey } from '@une/provider-adapters';
import { createApp } from '../app.factory';
import { buildMockExternalToken } from '../auth/mock-sso';
import { OBJECT_STORAGE } from '../common/storage.provider';
import { DocumentImportService } from '../document/document-import.service';
import { e2eApiConfig } from './test-config';

/**
 * CC-160 UNE-DOC-012/013/014 e2e.
 *
 * 실제 PostgreSQL + 실제 HWPX 원본 + 인메모리 저장소. 여기서 증명할 것은
 * **HTTP 표면의 계약**이다: 권한, 멱등 재생, 미지원 형식 거부, 테넌트 격리,
 * 완료되지 않은 산출물의 다운로드, 저장소에서 사라진 산출물의 410.
 * 되쓰기 자체는 엔진/워커 테스트가 증명한다.
 */

const ADMIN_URL = process.env.DATABASE_URL;
const SECRET = 'e2e-signing-secret-e2e-signing-secret!!';
const REPO_ROOT = resolve(process.cwd(), '..', '..');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'database', 'migrations');
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
  const tenantA = await tenant('exp-a');
  const tenantB = await tenant('exp-b');
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

  // INSTITUTION_ADMIN: 문서 읽기·편집·Export. reader는 읽기만 —
  // DOC_EXPORT가 실제로 요구되는지 보려면 권한이 갈린 사용자가 필요하다.
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('DOC_READ','DOC_EDIT','DOC_EXPORT')
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

describe.skipIf(!ADMIN_URL || !existsSync(TEMPLATE))('CC-160 Export e2e (UNE-DOC-012~014)', () => {
  let dbName: string;
  let dbUrl: string;
  let app: INestApplication;
  let base: string;
  let fx: Fixtures;
  let tokenA: string;
  let tokenReader: string;
  let tokenB: string;
  let importer: DocumentImportService;
  let storage: MemoryObjectStorage;

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

  const importDocument = async (tenantId = fx.tenantA, userId = fx.adminA): Promise<string> => {
    const result = await importer.importFromFile(
      { tenantId, userId, sessionId: randomUUID() },
      TEMPLATE,
      { title: 'Export e2e 문서' },
      { correlationId: `corr_${randomUUID().replace(/-/g, '').slice(0, 16)}` },
    );
    return result.documentId;
  };

  /** 워커를 돌리지 않고 완료 상태를 만든다 — HTTP 계약만 검증하기 위해서다. */
  const completeExport = async (
    exportId: string,
    tenantId: string,
    userId: string,
    bytes: Uint8Array,
  ): Promise<{ storageKey: string; sha256: string }> => {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storageKey = exportObjectKey({ tenantId, exportId, sha256, extension: 'hwpx' });
    await storage.put({ key: storageKey, body: bytes, contentType: 'application/hwp+zip' });
    await withClient(dbUrl, async (c) => {
      const fileId = (
        await c.query(
          `INSERT INTO file_object
             (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
           VALUES ($1, $2, 'result.hwpx', 'application/hwp+zip', $3, $4, 'PENDING', $5)
           RETURNING file_id`,
          [tenantId, storageKey, bytes.length, sha256, userId],
        )
      ).rows[0].file_id as string;
      const reportId = (
        await c.query(
          `INSERT INTO validation_report
             (target_type, target_id, track, status, checks_json, environment_json)
           VALUES ('EXPORT', $1, 'A_AUTO', 'PASS', $2::jsonb, $3::jsonb)
           RETURNING validation_report_id`,
          [
            exportId,
            JSON.stringify([
              { code: 'RTA-PKG-001', layer: 'PACKAGE', outcome: 'PASS', detail: 'ok' },
            ]),
            JSON.stringify({
              notRunLayers: [{ layer: 'VISUAL', reason: 'rhwp 미반입 (OB-12)' }],
              outputSha256: sha256,
              sourceSha256: sha256,
            }),
          ],
        )
      ).rows[0].validation_report_id as string;
      await c.query(
        `UPDATE export_job SET status = 'COMPLETED', output_file_id = $2,
                validation_report_id = $3, finished_at = now()
          WHERE export_id = $1`,
        [exportId, fileId, reportId],
      );
    });
    return { storageKey, sha256 };
  };

  const requestExport = async (documentId: string, token = tokenA): Promise<string> => {
    const res = await call('POST', `/api/v1/documents/${documentId}/exports`, token, {
      body: { format: 'HWPX' },
      idempotencyKey: `exp-${randomUUID()}`,
    });
    expect(res.status).toBe(202);
    return ((await res.json()) as { data: { exportId: string } }).data.exportId;
  };

  beforeAll(async () => {
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc160_e2e_${randomUUID().slice(0, 8)}`;
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

    const config = e2eApiConfig({ databaseUrl: dbUrl, jwtSecret: SECRET });
    // 운영 배선을 그대로 탄다: 팩토리가 드라이버를 고르고 앱이 그것을 주입한다
    // (드라이버 기본값은 vitest.setup.ts가 memory로 둔다). 테스트가 인스턴스를
    // 직접 밀어 넣으면 팩토리·토큰 배선이 검증되지 않는다.
    app = await createApp(config);
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    importer = app.get(DocumentImportService);
    storage = app.get(OBJECT_STORAGE) as MemoryObjectStorage;
    expect(storage).toBeInstanceOf(MemoryObjectStorage);
    tokenA = await login(fx.tenantA, 'admin-a');
    tokenReader = await login(fx.tenantA, 'reader-a');
    tokenB = await login(fx.tenantB, 'user-b');
  }, 300_000);

  afterAll(async () => {
    if (app) await app.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  // ── UNE-DOC-012 ─────────────────────────────────────────────────────────

  it('Export를 접수하고 202와 QUEUED Job을 돌려준다', async () => {
    const documentId = await importDocument();
    const res = await call('POST', `/api/v1/documents/${documentId}/exports`, tokenA, {
      body: { format: 'HWPX' },
      idempotencyKey: `exp-${randomUUID()}`,
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      success: boolean;
      data: { exportId: string; status: string; format: string; outputFileId: null };
    };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('QUEUED');
    expect(body.data.format).toBe('HWPX');
    // 접수 시점에는 결과가 없다(0020 종단 상관식과 같은 사실).
    expect(body.data.outputFileId).toBeNull();
  });

  it('DOC_EXPORT 권한이 없으면 403이다', async () => {
    const documentId = await importDocument();
    const res = await call('POST', `/api/v1/documents/${documentId}/exports`, tokenReader, {
      body: { format: 'HWPX' },
      idempotencyKey: `exp-${randomUUID()}`,
    });
    expect(res.status).toBe(403);
  });

  it('Idempotency-Key가 없으면 400이다', async () => {
    const documentId = await importDocument();
    const res = await call('POST', `/api/v1/documents/${documentId}/exports`, tokenA, {
      body: { format: 'HWPX' },
    });
    expect(res.status).toBe(400);
  });

  it('같은 Idempotency-Key 재전송은 같은 Job을 돌려주고 두 번 만들지 않는다', async () => {
    const documentId = await importDocument();
    const key = `exp-${randomUUID()}`;
    const first = await call('POST', `/api/v1/documents/${documentId}/exports`, tokenA, {
      body: { format: 'HWPX' },
      idempotencyKey: key,
    });
    const second = await call('POST', `/api/v1/documents/${documentId}/exports`, tokenA, {
      body: { format: 'HWPX' },
      idempotencyKey: key,
    });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const idOf = async (res: Response): Promise<string> =>
      ((await res.json()) as { data: { exportId: string } }).data.exportId;
    expect(await idOf(second)).toBe(await idOf(first));

    const count = await withClient(dbUrl, (c) =>
      c.query(`SELECT count(*)::int AS n FROM export_job WHERE document_id = $1`, [documentId]),
    );
    expect(count.rows[0].n).toBe(1);
  });

  it('변환기가 없는 형식(PDF/DOCX)은 422로 거부한다 — 지원한다고 광고하지 않는다', async () => {
    const documentId = await importDocument();
    for (const format of ['PDF', 'DOCX']) {
      const res = await call('POST', `/api/v1/documents/${documentId}/exports`, tokenA, {
        body: { format },
        idempotencyKey: `exp-${randomUUID()}`,
      });
      expect(res.status, format).toBe(422);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('EXPORT-422-001');
    }
  });

  it('어휘 밖 형식은 400이다', async () => {
    const documentId = await importDocument();
    const res = await call('POST', `/api/v1/documents/${documentId}/exports`, tokenA, {
      body: { format: 'JSON' },
      idempotencyKey: `exp-${randomUUID()}`,
    });
    expect(res.status).toBe(400);
  });

  it('다른 테넌트의 문서로는 Export를 만들 수 없다', async () => {
    const documentId = await importDocument();
    const res = await call('POST', `/api/v1/documents/${documentId}/exports`, tokenB, {
      body: { format: 'HWPX' },
      idempotencyKey: `exp-${randomUUID()}`,
    });
    expect(res.status).toBe(422);
  });

  // ── UNE-DOC-013 ─────────────────────────────────────────────────────────

  it('상태 조회가 Track A 요약과 미실행 계층을 함께 낸다', async () => {
    const documentId = await importDocument();
    const exportId = await requestExport(documentId);
    const bytes = new Uint8Array(readFileSync(TEMPLATE));
    await completeExport(exportId, fx.tenantA, fx.adminA, bytes);

    const res = await call('GET', `/api/v1/exports/${exportId}`, tokenA);
    expect(res.status).toBe(200);
    const data = (
      (await res.json()) as {
        data: {
          status: string;
          validation: {
            status: string;
            checks: unknown[];
            notRunLayers: { layer: string; reason: string }[];
            outputSha256: string;
          } | null;
        };
      }
    ).data;
    expect(data.status).toBe('COMPLETED');
    expect(data.validation?.status).toBe('PASS');
    expect(data.validation?.checks.length).toBeGreaterThan(0);
    expect(data.validation?.notRunLayers[0].layer).toBe('VISUAL');
    expect(data.validation?.outputSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('없는 Export와 다른 테넌트의 Export는 똑같이 404다 (존재를 흘리지 않는다)', async () => {
    const documentId = await importDocument();
    const exportId = await requestExport(documentId);

    const missing = await call('GET', `/api/v1/exports/${randomUUID()}`, tokenA);
    expect(missing.status).toBe(404);
    const crossTenant = await call('GET', `/api/v1/exports/${exportId}`, tokenB);
    expect(crossTenant.status).toBe(404);
    expect(((await crossTenant.json()) as { error: { code: string } }).error.code).toBe(
      'EXPORT-404-001',
    );
  });

  // ── UNE-DOC-014 ─────────────────────────────────────────────────────────

  it('완료된 Export의 바이트를 그대로 내려주고 감사 로그를 남긴다', async () => {
    const documentId = await importDocument();
    const exportId = await requestExport(documentId);
    const bytes = new Uint8Array(readFileSync(TEMPLATE));
    const stored = await completeExport(exportId, fx.tenantA, fx.adminA, bytes);

    const res = await fetch(`${base}/api/v1/exports/${exportId}/download`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/hwp+zip');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-sha256')).toBe(stored.sha256);
    const downloaded = Buffer.from(await res.arrayBuffer());
    expect(Buffer.compare(downloaded, Buffer.from(bytes))).toBe(0);

    const audit = await withClient(dbUrl, (c) =>
      c.query(`SELECT action FROM audit_log WHERE resource_id = $1 ORDER BY occurred_at`, [
        documentId,
      ]),
    );
    expect(audit.rows.map((row: { action: string }) => row.action)).toContain('EXPORT_DOWNLOADED');
  });

  it('아직 완료되지 않은 Export의 다운로드는 409다', async () => {
    const documentId = await importDocument();
    const exportId = await requestExport(documentId);
    const res = await fetch(`${base}/api/v1/exports/${exportId}/download`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(409);
  });

  it('저장소에서 사라진 산출물은 410이다 (404가 아니라 "있었지만 없다")', async () => {
    const documentId = await importDocument();
    const exportId = await requestExport(documentId);
    const bytes = new Uint8Array(readFileSync(TEMPLATE));
    const stored = await completeExport(exportId, fx.tenantA, fx.adminA, bytes);

    await storage.remove(stored.storageKey);
    const res = await fetch(`${base}/api/v1/exports/${exportId}/download`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('EXPORT-410-001');
  });

  it('저장소 장애는 503이다 (만료 410과 구분된다)', async () => {
    const documentId = await importDocument();
    const exportId = await requestExport(documentId);
    const bytes = new Uint8Array(readFileSync(TEMPLATE));
    await completeExport(exportId, fx.tenantA, fx.adminA, bytes);

    storage.unavailable = true;
    try {
      const res = await fetch(`${base}/api/v1/exports/${exportId}/download`, {
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res.status).toBe(503);
    } finally {
      storage.unavailable = false;
    }
  });

  it('등록된 해시와 다른 바이트는 내주지 않는다 (410)', async () => {
    const documentId = await importDocument();
    const exportId = await requestExport(documentId);
    const bytes = new Uint8Array(readFileSync(TEMPLATE));
    const stored = await completeExport(exportId, fx.tenantA, fx.adminA, bytes);

    // 저장소의 객체만 바꿔치기한다 — DB의 sha256은 그대로다.
    await storage.put({
      key: stored.storageKey,
      body: Buffer.from('tampered'),
      contentType: 'application/hwp+zip',
    });
    const res = await fetch(`${base}/api/v1/exports/${exportId}/download`, {
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.status).toBe(410);
  });

  it('다른 테넌트는 산출물을 내려받을 수 없다', async () => {
    const documentId = await importDocument();
    const exportId = await requestExport(documentId);
    const bytes = new Uint8Array(readFileSync(TEMPLATE));
    await completeExport(exportId, fx.tenantA, fx.adminA, bytes);

    const res = await fetch(`${base}/api/v1/exports/${exportId}/download`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.status).toBe(404);
  });
});
