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

  // -- 동시성·리스 (리뷰 필수-4) -------------------------------------------

  it('두 러너가 동시에 돌아도 같은 Job을 두 번 처리하지 않는다 (SKIP LOCKED)', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'race'));
    const exportId = await withClient(dbUrl, (c) => enqueue(c, fx));

    const [s1, s2] = await Promise.all([newRunner().runOnce(), newRunner().runOnce()]);
    expect(s1.claimed + s2.claimed).toBe(1);
    expect(s1.completed + s2.completed).toBe(1);

    await withClient(dbUrl, async (c) => {
      // 결과 파일도 검증 보고서도 정확히 하나여야 한다. 중복 실행이 있었다면
      // file_object가 둘이거나 storage_key 유니크 위반으로 터진다.
      const files = await c.query(
        `SELECT count(*)::int AS n FROM file_object
          WHERE storage_key LIKE '%/exports/' || $1 || '/%'`,
        [exportId],
      );
      expect(files.rows[0].n).toBe(1);
      const reports = await c.query(
        `SELECT count(*)::int AS n FROM validation_report WHERE target_id = $1`,
        [exportId],
      );
      expect(reports.rows[0].n).toBe(1);
    });
  }, 180_000);

  it('클레임은 started_at을 세우고, 만료된 리스만 회수한다 (created_at이 아니다)', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'lease'));
    const exportId = await withClient(dbUrl, (c) => enqueue(c, fx));

    // 큐에서 리스 시간보다 오래 대기한 Job을 만든다. created_at 기준 회수였다면
    // 클레임 직후부터 stale이 되어 다른 워커가 즉시 재클레임한다(0021 §1).
    await withClient(dbUrl, (c) =>
      c.query(
        `UPDATE export_job SET created_at = now() - interval '2 hours' WHERE export_id = $1`,
        [exportId],
      ),
    );

    const before = await withClient(dbUrl, (c) =>
      c.query(`SELECT status, started_at FROM export_job WHERE export_id = $1`, [exportId]),
    );
    expect(before.rows[0].status).toBe('QUEUED');
    expect(before.rows[0].started_at).toBeNull();

    const summary = await newRunner().runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 1 });

    await withClient(dbUrl, async (c) => {
      const row = (
        await c.query(`SELECT started_at, attempt_no FROM export_job WHERE export_id = $1`, [
          exportId,
        ])
      ).rows[0];
      expect(row.started_at).not.toBeNull();
      expect(row.attempt_no).toBe(1);
    });

    // 완료된 Job은 다시 집히지 않는다.
    const again = await newRunner().runOnce();
    expect(again.claimed).toBe(0);
  }, 180_000);

  it('죽은 워커가 남긴 RUNNING을 회수하되 시도 상한을 넘기지 않는다', async () => {
    const stale = await withClient(dbUrl, (c) => insertFixture(c, 'stale'));
    const exhausted = await withClient(dbUrl, (c) => insertFixture(c, 'exhausted'));
    const staleId = await withClient(dbUrl, (c) => enqueue(c, stale));
    const exhaustedId = await withClient(dbUrl, (c) => enqueue(c, exhausted));

    await withClient(dbUrl, (c) =>
      c.query(
        `UPDATE export_job
            SET status = 'RUNNING', started_at = now() - interval '1 hour', attempt_no = 1
          WHERE export_id = $1`,
        [staleId],
      ),
    );
    // 상한(maxAttempts 기본 3)에 닿은 Job은 회수 대상이 아니다 — 정산이 계속
    // 실패하는 Job을 무한히 되집으면 워커가 그것만 붙들고 돈다.
    await withClient(dbUrl, (c) =>
      c.query(
        `UPDATE export_job
            SET status = 'RUNNING', started_at = now() - interval '1 hour', attempt_no = 99
          WHERE export_id = $1`,
        [exhaustedId],
      ),
    );

    const summary = await newRunner().runOnce();
    expect(summary.claimed).toBe(1);

    await withClient(dbUrl, async (c) => {
      const rows = await c.query(
        `SELECT export_id, status FROM export_job WHERE export_id = ANY($1)`,
        [[staleId, exhaustedId]],
      );
      const byId = new Map(
        rows.rows.map((r: { export_id: string; status: string }) => [r.export_id, r.status]),
      );
      expect(byId.get(staleId)).toBe('COMPLETED');
      expect(byId.get(exhaustedId)).toBe('RUNNING');
    });
  }, 180_000);

  // -- 저장 차단·집행 입력 (리뷰 필수-2 / M-3) -----------------------------

  it('REJECT 판정 문서는 저장이 차단되고 FAILED로 정산된다 (ADR-29 D11)', async () => {
    const fx = await withClient(dbUrl, async (c) => {
      const base = await insertFixture(c, 'blocked');
      await c.query(
        `UPDATE template_profile SET analysis_status = 'REJECT' WHERE document_id = $1`,
        [base.documentId],
      );
      return base;
    });
    const exportId = await withClient(dbUrl, (c) => enqueue(c, fx));

    const summary = await newRunner().runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 0, failed: 1 });

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(
          `SELECT status, output_file_id, validation_report_id FROM export_job WHERE export_id = $1`,
          [exportId],
        )
      ).rows[0];
      expect(job.status).toBe('FAILED');
      expect(job.output_file_id).toBeNull();

      const report = (
        await c.query(
          `SELECT status, checks_json FROM validation_report WHERE validation_report_id = $1`,
          [job.validation_report_id],
        )
      ).rows[0];
      expect(report.status).toBe('FAIL');
      // 차단 사유가 보고서에 남는다 — export_job에 error_json이 없으므로
      // 사용자에게 "왜 실패했는지"를 보여줄 자리가 이것뿐이다.
      const codes = (report.checks_json as { code: string }[]).map((check) => check.code);
      expect(codes).toContain('HWPX-1104');
    });

    // 산출물이 저장소에 올라가지 않았다 — 차단은 되쓰기 전에 일어난다.
    expect(storage.keys().some((key) => key.includes(`/exports/${exportId}/`))).toBe(false);
  }, 180_000);

  it('호환성 판정이 없으면 저장을 막는다 (집행 입력이 fail-open이면 안 된다)', async () => {
    const fx = await withClient(dbUrl, async (c) => {
      const base = await insertFixture(c, 'noverdict');
      await c.query(`DELETE FROM template_profile WHERE document_id = $1`, [base.documentId]);
      return base;
    });
    const exportId = await withClient(dbUrl, (c) => enqueue(c, fx));

    const summary = await newRunner().runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 0, failed: 1 });

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(`SELECT status, output_file_id FROM export_job WHERE export_id = $1`, [
          exportId,
        ])
      ).rows[0];
      expect(job.status).toBe('FAILED');
      expect(job.output_file_id).toBeNull();
    });
  }, 180_000);

  it('원본 바이트가 등록된 해시와 다르면 되쓰지 않는다 (리뷰 M-6)', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'tampered'));
    const exportId = await withClient(dbUrl, (c) => enqueue(c, fx));

    // 저장소의 원본만 바꿔치기한다 — file_object.sha256은 그대로다.
    await storage.put({
      key: fx.sourceKey,
      body: Buffer.from('not the registered source'),
      contentType: 'application/hwp+zip',
    });

    const summary = await newRunner().runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 0, failed: 1 });

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(`SELECT status, output_file_id FROM export_job WHERE export_id = $1`, [
          exportId,
        ])
      ).rows[0];
      expect(job.status).toBe('FAILED');
      expect(job.output_file_id).toBeNull();
    });
  }, 180_000);
});
