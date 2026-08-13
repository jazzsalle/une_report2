import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runner as migrate } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryObjectStorage, MockUniKnowledgeAdapter } from '@une/provider-adapters';
import { loadWorkerConfig, type WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../db/worker-database.service';
import { KnowledgeUploadRunner } from './knowledge-upload.runner';

/**
 * 지식문서 UNI 전송 수용 증거 (CC-220, UNE-KNOW-001~003).
 *
 * 증명해야 하는 것.
 *   (1) 워커가 QUEUED 잡을 집어 UNI에 보내고 doc_id를 받아 REGISTERED로 만든다.
 *   (2) **원문이 남는다** — 성공·실패 모두. CLAUDE.md 비협상 규칙이다.
 *   (3) 실패는 FAILED + 사유로 끝나고 잡도 함께 종결된다(RUNNING으로 남지 않는다).
 *   (4) 상태 폴링이 설계 08 §1.9의 수명주기를 따라 나아가고 READY에서 멈춘다.
 *   (5) 두 축이 모두 맞기 전에는 근거 자격이 없다(US-SIT-010 완료조건).
 *
 * 이 e2e도 superuser로 접속해 `SET LOCAL ROLE`로 강등한다 — 운영에서 그 전환이
 * 실패한다는 사실(OB-17)을 구조적으로 잡지 못한다는 점은 보존 러너와 같다.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

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
  situationId: string;
  fileId: string;
  documentId: string;
  jobId: string;
  storageKey: string;
}

describe.skipIf(!ADMIN_URL)('지식문서 UNI 전송 러너 e2e (CC-220)', () => {
  let dbName: string;
  let dbUrl: string;
  let config: WorkerConfig;
  let db: WorkerDatabase;
  let storage: MemoryObjectStorage;

  const seed = async (code: string, fileName: string): Promise<Fixture> =>
    withClient(dbUrl, async (c) => {
      const tenantId = (
        await c.query(
          `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1,$1,'ACTIVE')
           RETURNING tenant_id`,
          [code],
        )
      ).rows[0].tenant_id as string;
      const userId = (
        await c.query(
          `INSERT INTO app_user (tenant_id, login_id, display_name, status)
           VALUES ($1,$2,$2,'ACTIVE') RETURNING user_id`,
          [tenantId, `u-${code}`],
        )
      ).rows[0].user_id as string;
      const situationId = (
        await c.query(
          `INSERT INTO situation (tenant_id, mode, title, hazard_type, status, created_by)
           VALUES ($1,'LIVE',$2,'FLOOD','DRAFT',$3) RETURNING situation_id`,
          [tenantId, `상황 ${code}`, userId],
        )
      ).rows[0].situation_id as string;

      const storageKey = `tenants/${tenantId}/knowledge/${code}.bin`;
      const sha = createHash('sha256').update(code).digest('hex');
      const fileId = (
        await c.query(
          `INSERT INTO file_object
             (tenant_id, original_name, mime_type, size_bytes, sha256, storage_key,
              scan_status, upload_state, verified_at, purpose, created_by)
           VALUES ($1,$2,'application/pdf',3,$3,$4,'CLEAN','VERIFIED',now(), 'KNOWLEDGE_DOCUMENT', $5)
           RETURNING file_id`,
          [tenantId, fileName, sha, storageKey, userId],
        )
      ).rows[0].file_id as string;

      const documentId = (
        await c.query(
          `INSERT INTO knowledge_document
             (tenant_id, situation_id, file_id, document_type, status, retention_scope,
              source_sha256, metadata_json, created_by)
           VALUES ($1,$2,$3,'MANUAL','PENDING_UPLOAD','THIS_INCIDENT',$4,'{}'::jsonb,$5)
           RETURNING knowledge_document_id`,
          [tenantId, situationId, fileId, sha, userId],
        )
      ).rows[0].knowledge_document_id as string;

      const jobId = (
        await c.query(
          `INSERT INTO provider_job
             (tenant_id, batch_id, situation_id, provider_code, request_json, status,
              result_count, correlation_id)
           VALUES ($1, gen_random_uuid(), $2, 'UNI', $3::jsonb, 'QUEUED', 0, $4)
           RETURNING provider_job_id`,
          [
            tenantId,
            situationId,
            JSON.stringify({
              operation: 'uploadDocument',
              knowledgeDocumentId: documentId,
              fileId,
              force: false,
            }),
            `corr-${code}`,
          ],
        )
      ).rows[0].provider_job_id as string;

      await c.query(
        `UPDATE knowledge_document SET provider_job_id = $2, attempt_count = 1, last_attempt_at = now()
          WHERE knowledge_document_id = $1`,
        [documentId, jobId],
      );

      await storage.put({
        key: storageKey,
        body: new Uint8Array([1, 2, 3]),
        contentType: 'application/pdf',
      });

      return { tenantId, userId, situationId, fileId, documentId, jobId, storageKey };
    });

  const readDoc = async (id: string) =>
    withClient(
      dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT status, uni_status, uni_observed_at, provider_document_id, error_json
             FROM knowledge_document WHERE knowledge_document_id = $1`,
            [id],
          )
        ).rows[0],
    );

  const readJob = async (id: string) =>
    withClient(
      dbUrl,
      async (c) =>
        (
          await c.query(
            `SELECT status, result_count, error_json, finished_at FROM provider_job
            WHERE provider_job_id = $1`,
            [id],
          )
        ).rows[0],
    );

  beforeAll(async () => {
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc220_${randomUUID().slice(0, 8)}`;
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
    config = loadWorkerConfig({ DATABASE_URL: dbUrl, UNE_DB_RUNTIME_ROLE: 'une_worker' });
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

  it('QUEUED 잡을 집어 UNI에 보내고 REGISTERED로 만든다', async () => {
    const f = await seed('kup-ok', 'manual.pdf');
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const runner = new KnowledgeUploadRunner(db, storage, uni, config);

    const r = await runner.runOnce();
    expect(r).toEqual({ claimed: 1, registered: 1, failed: 0 });

    const doc = await readDoc(f.documentId);
    expect(doc.status).toBe('REGISTERED');
    expect(doc.provider_document_id).toMatch(/^mock-doc-/);
    expect(doc.error_json).toBeNull();
    // 등록만으로는 UNI 처리상태를 모른다 — null은 "아직 모른다"다.
    expect(doc.uni_status).toBeNull();

    const job = await readJob(f.jobId);
    expect(job.status).toBe('SUCCEEDED');
    expect(job.finished_at).not.toBeNull();
  });

  it('원문이 남는다 (CLAUDE.md 비협상 규칙) — 그러나 파일 바이트는 아니다', async () => {
    const rows = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT r.raw_payload_json, r.payload_sha256, r.item_count
           FROM provider_result r JOIN provider_job j USING (provider_job_id)
          WHERE j.provider_code = 'UNI'`,
      ),
    );
    expect(rows.rowCount).toBeGreaterThan(0);
    const raw = rows.rows[0].raw_payload_json as { request: unknown; response: unknown };
    expect(raw.response).toMatchObject({ doc_id: expect.any(String) });
    expect(raw.request).toMatchObject({ fileName: 'manual.pdf', sizeBytes: 3 });
    expect(rows.rows[0].payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    // 파일 내용이 감사기록으로 복사되지 않는다.
    expect(JSON.stringify(raw)).not.toContain('"content"');
  });

  it('전송 실패는 FAILED로 끝나고 잡이 RUNNING으로 남지 않는다', async () => {
    const f = await seed('kup-fail', 'bad.upload-fail.pdf');
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const r = await new KnowledgeUploadRunner(db, storage, uni, config).runOnce();
    expect(r).toEqual({ claimed: 1, registered: 0, failed: 1 });

    const doc = await readDoc(f.documentId);
    expect(doc.status).toBe('FAILED');
    expect(doc.error_json).toMatchObject({ retryable: true });
    expect(doc.provider_document_id).toBeNull();

    const job = await readJob(f.jobId);
    expect(job.status).toBe('FAILED');
    expect(job.result_count).toBe(0);
    expect(job.finished_at).not.toBeNull();
  });

  it('계약 위반 실패는 부작용 불확실을 남긴다 (재시도가 두 벌을 만들 수 있다)', async () => {
    const f = await seed('kup-mal', 'x.malformed.pdf');
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    await new KnowledgeUploadRunner(db, storage, uni, config).runOnce();
    const doc = await readDoc(f.documentId);
    expect(doc.status).toBe('FAILED');
    // 사람이 UNE-KNOW-003에서 판단할 근거가 데이터에 남는다.
    expect(doc.error_json).toMatchObject({ sideEffectUncertain: true, retryable: false });
  });

  it('한 번에 한 잡만 집는다 (업로드는 되돌릴 수 없다)', async () => {
    await seed('kup-a', 'a.pdf');
    await seed('kup-b', 'b.pdf');
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const runner = new KnowledgeUploadRunner(db, storage, uni, config);
    expect((await runner.runOnce()).claimed).toBe(1);
    expect((await runner.runOnce()).claimed).toBe(1);
    expect((await runner.runOnce()).claimed).toBe(0);
  });

  it('폴링이 설계 08 §1.9 수명주기를 따라 나아가고 READY에서 멈춘다', async () => {
    const f = await seed('kup-poll', 'poll.pdf');
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const runner = new KnowledgeUploadRunner(db, storage, uni, config);
    await runner.runOnce();

    const seen: (string | null)[] = [];
    for (let i = 0; i < 5; i += 1) {
      await runner.pollOnce();
      seen.push((await readDoc(f.documentId)).uni_status as string | null);
    }
    expect(seen).toEqual(['QUEUED', 'PARSING', 'INDEXING', 'REFERENCE_GENERATING', 'READY']);

    // READY는 종결이므로 이 문서는 더 이상 묻지 않는다. 스윕이 다른 문서를
    // 집을 수는 있으므로 `polled` 총계가 아니라 **이 문서**를 본다 —
    // 관측 시각이 그대로면 이 문서에는 묻지 않은 것이다.
    const atReady = await readDoc(f.documentId);
    await new Promise((r) => setTimeout(r, 20));
    await runner.pollOnce();
    const afterReady = await readDoc(f.documentId);
    expect(afterReady.uni_status).toBe('READY');
    expect(afterReady.uni_observed_at).toEqual(atReady.uni_observed_at);
    expect(atReady.uni_observed_at).not.toBeNull();
  });

  it('관측 시각은 상태가 그대로여도 갱신된다 (멈춘 문서와 안 본 문서를 구분한다)', async () => {
    const f = await seed('kup-slow', 'slow.slow.pdf');
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const runner = new KnowledgeUploadRunner(db, storage, uni, config);
    await runner.runOnce();

    await runner.pollOnce();
    const first = await readDoc(f.documentId);
    await new Promise((r) => setTimeout(r, 20));
    await runner.pollOnce();
    const second = await readDoc(f.documentId);

    expect(new Date(second.uni_observed_at as string).getTime()).toBeGreaterThan(
      new Date(first.uni_observed_at as string).getTime(),
    );
  });

  it('READY가 된 뒤 참조요약을 받아 저장한다 (US-SIT-010 4단계)', async () => {
    // CC-220·CC-230에서 두 번 미룬 항목이다. 세 번째 이월을 하지 않는다.
    const f = await seed('kup-ref', 'ref.pdf');
    const uni = new MockUniKnowledgeAdapter({ scenariosEnabled: true });
    const runner = new KnowledgeUploadRunner(db, storage, uni, config);
    await runner.runOnce();

    // READY 이전에는 참조요약을 저장하지 않는다 — 202는 "아직"이지 오류가 아니다.
    await runner.pollReferences();
    const early = await withClient(dbUrl, (c) =>
      c.query(`SELECT reference_json FROM knowledge_document WHERE knowledge_document_id = $1`, [
        f.documentId,
      ]),
    );
    expect(early.rows[0].reference_json).toBeNull();

    for (let i = 0; i < 5; i += 1) await runner.pollOnce();
    const ref = await runner.pollReferences();
    expect(ref.stored).toBeGreaterThan(0);

    const after = await withClient(dbUrl, (c) =>
      c.query(`SELECT reference_json FROM knowledge_document WHERE knowledge_document_id = $1`, [
        f.documentId,
      ]),
    );
    expect(after.rows[0].reference_json).toMatchObject({ summary: expect.any(String) });

    // 한 번 받으면 이 문서는 다시 묻지 않는다. 스윕이 다른 문서를 집을 수는
    // 있으므로 총계가 아니라 **이 문서**가 대상에서 빠졌는지를 본다.
    await runner.pollReferences();
    const stable = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT count(*)::int n FROM knowledge_document
          WHERE knowledge_document_id = $1 AND reference_json IS NULL`,
        [f.documentId],
      ),
    );
    expect(stable.rows[0].n).toBe(0);
  });

  it('DB가 두 축이 어긋난 행을 거부한다 (보내지 않은 문서에 처리상태를 적을 수 없다)', async () => {
    const f = await seed('kup-ck', 'ck.pdf');
    await expect(
      withClient(dbUrl, (c) =>
        c.query(
          `UPDATE knowledge_document SET uni_status = 'READY'
            WHERE knowledge_document_id = $1`,
          [f.documentId],
        ),
      ),
    ).rejects.toThrow(/ck_knowledge_document_uni_axis_shape/);
  });
});
