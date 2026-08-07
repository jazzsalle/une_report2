import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_URL,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
  type Fixture,
} from './db-helpers';

/**
 * CC-160 / migration 0020: Export·검증 표면.
 *
 * 네 가지를 고정한다.
 *  1) 값 어휘 — @une/domain의 목록을 DB가 실제로 강제하는지 양성·음성 전건.
 *  2) 종단 상태 상관식 — "완료됐는데 받을 파일이 없는" 행이 만들어지지 않는지.
 *  3) 워커 디스패치 — 테넌트 없이 집고, 정산은 테넌트 안에서만(0015 §7 모델).
 *  4) 검증 보고서 append-only — 증거는 사후에 달라지지 않는다.
 */

/** 어휘 정본. packages/domain의 상수를 import하지 않고 값을 다시 적는다 —
 * 도메인 상수가 조용히 바뀌면 이 테스트도 함께 바뀌어 DB와의 드리프트를
 * 놓치기 때문이다(0019 테스트와 같은 이유). */
const EXPORT_FORMATS = ['HWPX', 'PDF', 'DOCX'] as const;
const EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
const VALIDATION_TRACKS = ['A_AUTO', 'B_HANCOM'] as const;
const VALIDATION_STATUSES = ['PASS', 'LIMITED', 'FAIL'] as const;
const VALIDATION_TARGET_TYPES = ['DOCUMENT', 'EXPORT'] as const;
const SCAN_STATUSES = ['PENDING', 'CLEAN', 'INFECTED'] as const;

const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';

const HASH = 'a'.repeat(64);

interface ExportFixture extends Fixture {
  documentId: string;
  revisionId: string;
  exportId: string;
  fileId: string;
}

async function asRole<T>(
  url: string,
  role: 'une_app' | 'une_worker',
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query(`SET ROLE ${role}`);
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return fn(c);
  });
}

async function expectSqlState(
  c: Client,
  sql: string,
  params: unknown[],
  sqlstate: string,
  label: string,
): Promise<void> {
  await c.query('SAVEPOINT s');
  try {
    await c.query(sql, params);
    await c.query('ROLLBACK TO SAVEPOINT s');
    throw new Error(`${label}: 거부돼야 하는 문장이 성공했다`);
  } catch (error) {
    const code = (error as { code?: string }).code;
    await c.query('ROLLBACK TO SAVEPOINT s');
    expect(code, `${label} SQLSTATE`).toBe(sqlstate);
  }
}

async function insertExportFixture(c: Client, tenantCode: string): Promise<ExportFixture> {
  const base = await insertFixture(c, tenantCode);
  const document = await c.query(
    `INSERT INTO document (tenant_id, document_type, title, status, owner_id)
     VALUES ($1, 'PLAN', $2, 'EDITING', $3) RETURNING document_id`,
    [base.tenantId, `${tenantCode} 문서`, base.userId],
  );
  const documentId = document.rows[0].document_id as string;

  const revision = await c.query(
    `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, origin, created_by)
     VALUES ($1, 1, '{"v":1}', $2, 'IMPORT', $3) RETURNING revision_id`,
    [documentId, HASH, base.userId],
  );
  const revisionId = revision.rows[0].revision_id as string;

  const file = await c.query(
    `INSERT INTO file_object
       (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
     VALUES ($1, $2, 'out.hwpx', 'application/hwp+zip', 1234, $3, 'CLEAN', $4)
     RETURNING file_id`,
    [base.tenantId, `tenants/${base.tenantId}/exports/${tenantCode}.hwpx`, HASH, base.userId],
  );
  const fileId = file.rows[0].file_id as string;

  const job = await c.query(
    `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
     VALUES ($1, $2, $3, 'HWPX', 'QUEUED', $4) RETURNING export_id`,
    [base.tenantId, documentId, revisionId, base.userId],
  );

  return {
    ...base,
    documentId,
    revisionId,
    exportId: job.rows[0].export_id as string,
    fileId,
  };
}

describe.skipIf(!ADMIN_URL)('export and validation surface (CC-160, migration 0020)', () => {
  let db: { name: string; url: string };
  let fxA: ExportFixture;
  let fxB: ExportFixture;

  beforeAll(async () => {
    db = await createTestDb('cc160_export');
    await migrate(db.url);
    await withClient(db.url, async (c) => {
      fxA = await insertExportFixture(c, 'cc160-a');
      fxB = await insertExportFixture(c, 'cc160-b');
    });
  }, 180_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  // -------------------------------------------------------------------------
  // 1. 값 어휘 (0020 §2)
  // -------------------------------------------------------------------------

  it('accepts every value of the closed vocabularies (positive control)', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      for (const format of EXPORT_FORMATS) {
        await c.query(
          `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
           VALUES ($1, $2, $3, $4, 'QUEUED', $5)`,
          [fxA.tenantId, fxA.documentId, fxA.revisionId, format, fxA.userId],
        );
      }
      for (const status of EXPORT_STATUSES) {
        // 종단 상태는 상관식이 요구하는 모양을 갖춰야 한다(§2).
        const terminal = status === 'COMPLETED';
        const failed = status === 'FAILED';
        await c.query(
          `INSERT INTO export_job
             (tenant_id, document_id, revision_id, format, status, requested_by,
              output_file_id, validation_report_id, finished_at)
           VALUES ($1, $2, $3, 'HWPX', $4, $5, $6, $7, $8)`,
          [
            fxA.tenantId,
            fxA.documentId,
            fxA.revisionId,
            status,
            fxA.userId,
            terminal ? fxA.fileId : null,
            terminal ? await insertReport(c, 'DOCUMENT', fxA.documentId) : null,
            terminal || failed ? new Date('2026-08-03T00:00:00Z') : null,
          ],
        );
      }
      for (const track of VALIDATION_TRACKS) {
        for (const status of VALIDATION_STATUSES) {
          await c.query(
            `INSERT INTO validation_report
               (target_type, target_id, track, status, checks_json, environment_json)
             VALUES ('DOCUMENT', $1, $2, $3, '[]', '{}')`,
            [fxA.documentId, track, status],
          );
        }
      }
      for (const targetType of VALIDATION_TARGET_TYPES) {
        await c.query(
          `INSERT INTO validation_report
             (target_type, target_id, track, status, checks_json, environment_json)
           VALUES ($1, $2, 'A_AUTO', 'PASS', '[]', '{}')`,
          [targetType, targetType === 'DOCUMENT' ? fxA.documentId : fxA.exportId],
        );
      }
      for (const scanStatus of SCAN_STATUSES) {
        await c.query(
          `INSERT INTO file_object
             (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
           VALUES ($1, $2, 'x.hwpx', 'application/hwp+zip', 0, $3, $4, $5)`,
          [fxA.tenantId, `k-${scanStatus}`, HASH, scanStatus, fxA.userId],
        );
      }
      await c.query('ROLLBACK');
    });
  });

  it('rejects every value outside the closed vocabularies (negative, all constraints)', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      await expectSqlState(
        c,
        `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
         VALUES ($1, $2, $3, 'JSON', 'QUEUED', $4)`,
        [fxA.tenantId, fxA.documentId, fxA.revisionId, fxA.userId],
        CHECK_VIOLATION,
        // OpenAPI enum에 있던 JSON은 설계 10 §6의 컬럼 어휘에 없다(ADR-31).
        'export_job.format = JSON',
      );
      await expectSqlState(
        c,
        `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
         VALUES ($1, $2, $3, 'HWPX', 'CANCELLED', $4)`,
        [fxA.tenantId, fxA.documentId, fxA.revisionId, fxA.userId],
        CHECK_VIOLATION,
        'export_job.status = CANCELLED (Export에는 취소 경로가 없다)',
      );
      await expectSqlState(
        c,
        `INSERT INTO validation_report
           (target_type, target_id, track, status, checks_json, environment_json)
         VALUES ('SITUATION', $1, 'A_AUTO', 'PASS', '[]', '{}')`,
        [fxA.documentId],
        CHECK_VIOLATION,
        'validation_report.target_type = SITUATION',
      );
      await expectSqlState(
        c,
        `INSERT INTO validation_report
           (target_type, target_id, track, status, checks_json, environment_json)
         VALUES ('DOCUMENT', $1, 'C_MANUAL', 'PASS', '[]', '{}')`,
        [fxA.documentId],
        CHECK_VIOLATION,
        'validation_report.track = C_MANUAL',
      );
      await expectSqlState(
        c,
        `INSERT INTO validation_report
           (target_type, target_id, track, status, checks_json, environment_json)
         VALUES ('DOCUMENT', $1, 'A_AUTO', 'WARN', '[]', '{}')`,
        [fxA.documentId],
        CHECK_VIOLATION,
        'validation_report.status = WARN (보고서 등급은 3종)',
      );
      await expectSqlState(
        c,
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
         VALUES ($1, 'bad-scan', 'x', 'application/hwp+zip', 0, $2, 'UNKNOWN', $3)`,
        [fxA.tenantId, HASH, fxA.userId],
        CHECK_VIOLATION,
        'file_object.scan_status = UNKNOWN',
      );
      await expectSqlState(
        c,
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
         VALUES ($1, 'bad-hash', 'x', 'application/hwp+zip', 0, 'NOT-A-HASH', 'CLEAN', $2)`,
        [fxA.tenantId, fxA.userId],
        CHECK_VIOLATION,
        'file_object.sha256 형식',
      );
      await expectSqlState(
        c,
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
         VALUES ($1, 'bad-size', 'x', 'application/hwp+zip', -1, $2, 'CLEAN', $3)`,
        [fxA.tenantId, HASH, fxA.userId],
        CHECK_VIOLATION,
        'file_object.size_bytes 음수',
      );
      await c.query('ROLLBACK');
    });
  });

  // -------------------------------------------------------------------------
  // 2. 종단 상태 상관식 (0020 §2)
  // -------------------------------------------------------------------------

  it('rejects a COMPLETED export without a result file or report', async () => {
    // 이것이 없으면 "완료됐는데 받을 파일이 없는" 행이 생기고, 그 모순은
    // 사용자가 다운로드를 눌렀을 때에야 드러난다.
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      await expectSqlState(
        c,
        `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by, finished_at)
         VALUES ($1, $2, $3, 'HWPX', 'COMPLETED', $4, now())`,
        [fxA.tenantId, fxA.documentId, fxA.revisionId, fxA.userId],
        CHECK_VIOLATION,
        'COMPLETED without output_file_id',
      );
      await expectSqlState(
        c,
        `INSERT INTO export_job
           (tenant_id, document_id, revision_id, format, status, requested_by, output_file_id, finished_at)
         VALUES ($1, $2, $3, 'HWPX', 'COMPLETED', $4, $5, now())`,
        [fxA.tenantId, fxA.documentId, fxA.revisionId, fxA.userId, fxA.fileId],
        CHECK_VIOLATION,
        'COMPLETED without validation_report_id',
      );
      await expectSqlState(
        c,
        `INSERT INTO export_job
           (tenant_id, document_id, revision_id, format, status, requested_by, output_file_id)
         VALUES ($1, $2, $3, 'HWPX', 'QUEUED', $4, $5)`,
        [fxA.tenantId, fxA.documentId, fxA.revisionId, fxA.userId, fxA.fileId],
        CHECK_VIOLATION,
        'QUEUED with output_file_id (아직 만들지 않은 결과)',
      );
      await expectSqlState(
        c,
        `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
         VALUES ($1, $2, $3, 'HWPX', 'FAILED', $4)`,
        [fxA.tenantId, fxA.documentId, fxA.revisionId, fxA.userId],
        CHECK_VIOLATION,
        'FAILED without finished_at',
      );
      await c.query('ROLLBACK');
    });
  });

  // -------------------------------------------------------------------------
  // 3. 테넌트 격리 (0020 §1)
  // -------------------------------------------------------------------------

  it('requires tenant_id and shows a tenant only its own export jobs', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      await expectSqlState(
        c,
        `INSERT INTO export_job (document_id, revision_id, format, status, requested_by)
         VALUES ($1, $2, 'HWPX', 'QUEUED', $3)`,
        [fxA.documentId, fxA.revisionId, fxA.userId],
        NOT_NULL_VIOLATION,
        'export_job.tenant_id 누락',
      );
      await c.query('ROLLBACK');
    });

    const visible = await asRole(db.url, 'une_app', fxA.tenantId, (c) =>
      c.query(`SELECT export_id FROM export_job WHERE export_id = ANY($1)`, [
        [fxA.exportId, fxB.exportId],
      ]),
    );
    expect(visible.rows.map((row) => row.export_id)).toEqual([fxA.exportId]);
  });

  it('returns no export rows at all when app.tenant_id is unset (une_app)', async () => {
    const rows = await asRole(db.url, 'une_app', null, (c) =>
      c.query(`SELECT export_id FROM export_job`),
    );
    expect(rows.rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 4. 워커 디스패치 (0020 §4)
  // -------------------------------------------------------------------------

  it('lets a tenant-less worker see queued jobs across tenants', async () => {
    const rows = await asRole(db.url, 'une_worker', null, (c) =>
      c.query(`SELECT export_id, tenant_id FROM export_job WHERE status = 'QUEUED'`),
    );
    const ids = rows.rows.map((row) => row.export_id);
    expect(ids).toContain(fxA.exportId);
    expect(ids).toContain(fxB.exportId);
    // 디스패치에서 테넌트를 **읽을 수 있어야** 정산 트랜잭션을 그 테넌트로
    // 열 수 있다. tenant_id 컬럼이 없던 시절에는 이것이 불가능했다(§1).
    expect(rows.rows.every((row) => row.tenant_id)).toBe(true);
  });

  it('restricts the worker to one tenant once app.tenant_id is set', async () => {
    const rows = await asRole(db.url, 'une_worker', fxA.tenantId, (c) =>
      c.query(`SELECT export_id FROM export_job WHERE status = 'QUEUED'`),
    );
    expect(rows.rows.map((row) => row.export_id)).toEqual([fxA.exportId]);
  });

  it('allows a tenant-less claim to RUNNING but refuses terminal writes', async () => {
    await asRole(db.url, 'une_worker', null, async (c) => {
      const claimed = await c.query(
        `UPDATE export_job SET status = 'RUNNING' WHERE export_id = $1 RETURNING status`,
        [fxB.exportId],
      );
      expect(claimed.rows[0].status).toBe('RUNNING');

      // 종단 쓰기는 테넌트가 설정된 트랜잭션의 몫이다 — 결과(file_object,
      // validation_report)와 정산이 한 테넌트 경계 안에 머물게 하기 위해서다.
      //
      // 조용한 0행이 아니라 **오류**로 거부된다: USING은 통과하지만(집을 수
      // 있는 행이다) WITH CHECK가 QUEUED/RUNNING만 허용하므로 새 행이 정책을
      // 위반한다. 워커가 잘못된 경계에서 정산을 시도하면 즉시 실패한다.
      await expect(
        c.query(
          `UPDATE export_job SET status = 'FAILED', finished_at = now() WHERE export_id = $1`,
          [fxB.exportId],
        ),
      ).rejects.toThrow(/row-level security/);

      await c.query(`UPDATE export_job SET status = 'QUEUED' WHERE export_id = $1`, [fxB.exportId]);
    });
  });

  it('gives une_worker no way to delete export rows or reports', async () => {
    await asRole(db.url, 'une_worker', null, async (c) => {
      await expect(c.query(`DELETE FROM export_job WHERE false`)).rejects.toThrow(
        /permission denied for table export_job/,
      );
      await expect(c.query(`DELETE FROM validation_report WHERE false`)).rejects.toThrow(
        /permission denied for table validation_report/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5. 보고서 append-only (0020 §3)
  // -------------------------------------------------------------------------

  it('denies une_app UPDATE/DELETE on validation_report (증거는 사후에 달라지지 않는다)', async () => {
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      await expect(
        c.query(`UPDATE validation_report SET status = 'PASS' WHERE false`),
      ).rejects.toThrow(/permission denied for table validation_report/);
      await expect(c.query(`DELETE FROM validation_report WHERE false`)).rejects.toThrow(
        /permission denied for table validation_report/,
      );
    });
  });

  it('denies une_app DELETE on file_object (다운로드한 파일의 근거가 사라지면 안 된다)', async () => {
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      await expect(c.query(`DELETE FROM file_object WHERE false`)).rejects.toThrow(
        /permission denied for table file_object/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 6. 이연 종결 확인 (0020 §5)
  // -------------------------------------------------------------------------

  it('closes template_profile.analysis_status to the verdict vocabulary', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      for (const verdict of ['AUTO', 'CONFIRM', 'LIMITED', 'REJECT']) {
        await c.query(
          `INSERT INTO template_profile
             (document_id, profile_version, analysis_status, profile_json, unsupported_objects_json, analysis_hash)
           VALUES ($1, $2, $3, '{}', '[]', $4)`,
          [fxA.documentId, 100 + verdict.length, verdict, HASH],
        );
      }
      // 설계 09의 생명주기 어휘는 이 컬럼의 값이 아니다 — 다른 축이며,
      // 그 컬럼(lifecycle_status)은 화면이 구현될 때 따로 선다(ADR-31).
      await expectSqlState(
        c,
        `INSERT INTO template_profile
           (document_id, profile_version, analysis_status, profile_json, unsupported_objects_json, analysis_hash)
         VALUES ($1, 900, 'PUBLISHED', '{}', '[]', $2)`,
        [fxA.documentId, HASH],
        CHECK_VIOLATION,
        'analysis_status = PUBLISHED (생명주기 어휘)',
      );
      await c.query('ROLLBACK');
    });
  });
});

async function insertReport(c: Client, targetType: string, targetId: string): Promise<string> {
  const report = await c.query(
    `INSERT INTO validation_report
       (target_type, target_id, track, status, checks_json, environment_json)
     VALUES ($1, $2, 'A_AUTO', 'PASS', '[]', '{}') RETURNING validation_report_id`,
    [targetType, targetId],
  );
  return report.rows[0].validation_report_id as string;
}
