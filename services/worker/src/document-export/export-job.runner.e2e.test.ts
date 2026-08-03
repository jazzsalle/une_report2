import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runner as migrate } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HwpxEngine, loadCorpus, readCorpusFile } from '@une/hwpx-engine';
import { MemoryObjectStorage, exportObjectKey } from '@une/provider-adapters';
import { loadWorkerConfig, type WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../db/worker-database.service';
import { ExportJobRunner } from './export-job.runner';

/**
 * CC-160 Export 러너 수용 증거.
 *
 * 실 HWPX 문서를 원본으로 넣고 QUEUED -> COMPLETED 전 구간을 돈다:
 * 디스패치(테넌트 없는 클레임) -> 되쓰기 -> Track A -> 저장소 업로드 ->
 * file_object + validation_report + export_job 종단 상태(한 트랜잭션).
 *
 * 저장소는 인메모리다 — 저장소 자체의 계약은 provider-adapters의 실 MinIO
 * 테스트가 증명하고, 여기서 증명할 것은 **러너의 순서와 원자성**이다.
 * DATABASE_URL이 없으면 건너뛴다(워커 e2e 규약).
 */
const ADMIN_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');
const REPO_ROOT = resolve(process.cwd(), '..', '..');

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface Fixture {
  tenantId: string;
  userId: string;
  documentId: string;
  revisionId: string;
  sourceKey: string;
}

describe.skipIf(!ADMIN_URL)('CC-160 export job runner e2e', () => {
  let dbName: string;
  let dbUrl: string;
  let config: WorkerConfig;
  let db: WorkerDatabase;
  let storage: MemoryObjectStorage;
  let sourceBytes: Uint8Array;
  let sourceIr: unknown;

  const newRunner = (): ExportJobRunner => new ExportJobRunner(db, storage, config);

  const insertFixture = async (c: Client, code: string): Promise<Fixture> => {
    const tenantId = (
      await c.query(
        `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1, $1, 'ACTIVE') RETURNING tenant_id`,
        [code],
      )
    ).rows[0].tenant_id as string;
    const userId = (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, `exp-${code}`],
      )
    ).rows[0].user_id as string;

    const sha256 = createHash('sha256').update(sourceBytes).digest('hex');
    const sourceKey = `tenants/${tenantId}/sources/${code}.hwpx`;
    const fileId = (
      await c.query(
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
         VALUES ($1, $2, 'source.hwpx', 'application/hwp+zip', $3, $4, 'CLEAN', $5)
         RETURNING file_id`,
        [tenantId, sourceKey, sourceBytes.length, sha256, userId],
      )
    ).rows[0].file_id as string;
    await storage.put({
      key: sourceKey,
      body: sourceBytes,
      contentType: 'application/hwp+zip',
    });

    const documentId = (
      await c.query(
        `INSERT INTO document (tenant_id, document_type, title, status, owner_id, source_file_id)
         VALUES ($1, 'PLAN', $2, 'EDITING', $3, $4) RETURNING document_id`,
        [tenantId, `export ${code}`, userId, fileId],
      )
    ).rows[0].document_id as string;

    const revisionId = (
      await c.query(
        `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, origin, created_by)
         VALUES ($1, 1, $2::jsonb, $3, 'IMPORT', $4) RETURNING revision_id`,
        [documentId, JSON.stringify(sourceIr), 'a'.repeat(64), userId],
      )
    ).rows[0].revision_id as string;

    await c.query(
      `INSERT INTO template_profile
         (document_id, profile_version, analysis_status, profile_json, unsupported_objects_json, analysis_hash)
       VALUES ($1, 1, 'LIMITED', '{}', '[]', $2)`,
      [documentId, 'b'.repeat(64)],
    );

    return { tenantId, userId, documentId, revisionId, sourceKey };
  };

  const enqueue = async (c: Client, fx: Fixture): Promise<string> =>
    (
      await c.query(
        `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
         VALUES ($1, $2, $3, 'HWPX', 'QUEUED', $4) RETURNING export_id`,
        [fx.tenantId, fx.documentId, fx.revisionId, fx.userId],
      )
    ).rows[0].export_id as string;

  beforeAll(async () => {
    const corpus = loadCorpus(REPO_ROOT);
    const file = corpus.files[0];
    sourceBytes = readCorpusFile(file);
    expect(createHash('sha256').update(readFileSync(file.path)).digest('hex')).toBe(file.sha256);
    sourceIr = new HwpxEngine().analyzeDocument({ bytes: sourceBytes, fileName: file.alias }).ir;

    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc160_wrk_${randomUUID().slice(0, 8)}`;
    await withClient(ADMIN_URL as string, (c) => c.query(`CREATE DATABASE ${dbName}`));
    adminUrl.pathname = `/${dbName}`;
    dbUrl = adminUrl.toString();
    await migrate({
      databaseUrl: dbUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: 'pgmigrations',
      ignorePattern: '\\..*|README\\.md',
      direction: 'up',
      logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
    });
    config = loadWorkerConfig({
      DATABASE_URL: dbUrl,
      UNE_DB_RUNTIME_ROLE: 'une_worker',
      UNE_WORKER_LEASE_TIMEOUT_MS: '60000',
    });
    db = new WorkerDatabase(config);
    storage = new MemoryObjectStorage();
  }, 300_000);

  afterAll(async () => {
    if (db) await db.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  it('편집이 없는 Export를 완료하고 원본과 바이트가 같은 산출물을 남긴다', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'ok'));
    const exportId = await withClient(dbUrl, (c) => enqueue(c, fx));

    const summary = await newRunner().runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(
          `SELECT status, output_file_id, validation_report_id, finished_at
             FROM export_job WHERE export_id = $1`,
          [exportId],
        )
      ).rows[0];
      expect(job.status).toBe('COMPLETED');
      expect(job.output_file_id).not.toBeNull();
      expect(job.validation_report_id).not.toBeNull();
      expect(job.finished_at).not.toBeNull();

      const file = (
        await c.query(
          `SELECT storage_key, sha256, size_bytes, mime_type, scan_status
             FROM file_object WHERE file_id = $1`,
          [job.output_file_id],
        )
      ).rows[0];
      expect(file.mime_type).toBe('application/hwp+zip');
      // AV 스캐너가 아직 없다(0020 §6). PENDING이 정직한 초기값이다.
      expect(file.scan_status).toBe('PENDING');

      // 편집이 없었으므로 산출물은 원본과 바이트가 같아야 한다(AC1).
      const expectedSha = createHash('sha256').update(sourceBytes).digest('hex');
      expect(file.sha256).toBe(expectedSha);
      expect(Number(file.size_bytes)).toBe(sourceBytes.length);
      expect(file.storage_key).toBe(
        exportObjectKey({
          tenantId: fx.tenantId,
          exportId,
          sha256: expectedSha,
          extension: 'hwpx',
        }),
      );

      const stored = await storage.get(file.storage_key as string);
      expect(Buffer.compare(Buffer.from(stored.body), Buffer.from(sourceBytes))).toBe(0);

      const report = (
        await c.query(
          `SELECT track, status, checks_json, environment_json
             FROM validation_report WHERE validation_report_id = $1`,
          [job.validation_report_id],
        )
      ).rows[0];
      expect(report.track).toBe('A_AUTO');
      expect(report.status).not.toBe('FAIL');
      expect(Array.isArray(report.checks_json)).toBe(true);
      expect((report.checks_json as unknown[]).length).toBeGreaterThanOrEqual(16);
      // 미실행 계층이 사유와 함께 남는다 — 침묵하면 "검사해서 통과"로 읽힌다.
      const env = report.environment_json as Record<string, unknown>;
      expect(Array.isArray(env.notRunLayers)).toBe(true);
      expect((env.notRunLayers as unknown[]).length).toBe(3);
      expect(env.noOp).toBe(true);

      const audit = (
        await c.query(`SELECT action FROM audit_log WHERE resource_id = $1 ORDER BY occurred_at`, [
          fx.documentId,
        ])
      ).rows.map((row: { action: string }) => row.action);
      expect(audit).toContain('EXPORT_COMPLETED');
    });
  }, 120_000);

  it('두 테넌트의 Job을 한 틱에서 각자의 경계로 정산한다', async () => {
    const a = await withClient(dbUrl, (c) => insertFixture(c, 'multi-a'));
    const b = await withClient(dbUrl, (c) => insertFixture(c, 'multi-b'));
    const idA = await withClient(dbUrl, (c) => enqueue(c, a));
    const idB = await withClient(dbUrl, (c) => enqueue(c, b));

    const summary = await newRunner().runOnce();
    expect(summary.claimed).toBe(2);
    expect(summary.completed).toBe(2);

    await withClient(dbUrl, async (c) => {
      for (const [exportId, fx] of [
        [idA, a],
        [idB, b],
      ] as const) {
        const row = (
          await c.query(
            `SELECT e.status, e.tenant_id, f.tenant_id AS file_tenant
               FROM export_job e JOIN file_object f ON f.file_id = e.output_file_id
              WHERE e.export_id = $1`,
            [exportId],
          )
        ).rows[0];
        expect(row.status).toBe('COMPLETED');
        // 결과 파일이 Job과 같은 테넌트에 등록됐다 — 정산이 한 경계 안에서 끝났다.
        expect(row.file_tenant).toBe(fx.tenantId);
        expect(row.tenant_id).toBe(fx.tenantId);
      }
    });
  }, 180_000);

  it('원본이 없는 문서는 FAILED로 정산하고 사유를 보고서에 남긴다', async () => {
    const fx = await withClient(dbUrl, async (c) => {
      const base = await insertFixture(c, 'no-source');
      await c.query(`UPDATE document SET source_file_id = NULL WHERE document_id = $1`, [
        base.documentId,
      ]);
      return base;
    });
    const exportId = await withClient(dbUrl, (c) => enqueue(c, fx));

    const summary = await newRunner().runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 0, failed: 1 });

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(
          `SELECT status, output_file_id, validation_report_id, finished_at
             FROM export_job WHERE export_id = $1`,
          [exportId],
        )
      ).rows[0];
      expect(job.status).toBe('FAILED');
      // 실패에는 결과 파일이 없다(0020 종단 상관식).
      expect(job.output_file_id).toBeNull();
      expect(job.finished_at).not.toBeNull();
      expect(job.validation_report_id).not.toBeNull();

      const report = (
        await c.query(`SELECT status FROM validation_report WHERE validation_report_id = $1`, [
          job.validation_report_id,
        ])
      ).rows[0];
      expect(report.status).toBe('FAIL');
    });
  }, 120_000);

  it('저장소 장애면 산출물을 등록하지 않고 FAILED로 남긴다', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'storage-down'));
    const exportId = await withClient(dbUrl, (c) => enqueue(c, fx));

    storage.unavailable = true;
    try {
      const summary = await newRunner().runOnce();
      expect(summary).toMatchObject({ claimed: 1, failed: 1 });
    } finally {
      storage.unavailable = false;
    }

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(`SELECT status, output_file_id FROM export_job WHERE export_id = $1`, [
          exportId,
        ])
      ).rows[0];
      expect(job.status).toBe('FAILED');
      expect(job.output_file_id).toBeNull();
    });
  }, 120_000);

  it('집을 것이 없으면 아무 일도 하지 않는다', async () => {
    const summary = await newRunner().runOnce();
    expect(summary).toEqual({ claimed: 0, completed: 0, failed: 0, skipped: 0 });
  }, 60_000);
});
