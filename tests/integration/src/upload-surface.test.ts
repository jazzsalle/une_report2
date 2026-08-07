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
 * CC-170 / migration 0022: 업로드 검증 축과 계획서-문서 링크.
 *
 * 네 가지를 고정한다.
 *  1) `upload_state` 어휘와 `verified_at` 상관식 — "검증되지 않았는데 검증
 *     시각이 있는" 행이 만들어지지 않는지 양성·음성 전건.
 *  2) 앱 롤의 UPDATE 범위 — upload_state/verified_at만 열려 있고 무결성 컬럼
 *     (sha256/storage_key/size_bytes)은 여전히 불변인지. 다운로드 무결성 비교의
 *     기준값이 가변이면 "받은 파일이 검증받은 그 파일인가"에 답할 수 없다.
 *  3) 한 문서를 두 계획서가 주장할 수 없다(uk_plan_document).
 *  4) 기존 행 백필 — 0022 이전에 만들어진 file_object는 서버가 직접 해시를
 *     계산한 바이트이므로 VERIFIED가 사실이다. 0021까지 올린 DB에 행을 넣고
 *     0022를 적용해 실제로 확인한다.
 */

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

const UPLOAD_STATES = ['PENDING', 'VERIFIED', 'ABORTED'] as const;
const HASH = 'c'.repeat(64);

interface UploadFixture extends Fixture {
  planId: string;
  documentId: string;
  fileId: string;
}

async function asAppRole<T>(
  url: string,
  tenantId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query('SET ROLE une_app');
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
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

async function insertUploadFixture(c: Client, tenantCode: string): Promise<UploadFixture> {
  const base = await insertFixture(c, tenantCode);
  const plan = await c.query(
    `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
     VALUES ($1, $2, '폭염', '대비', 'DRAFT', $3) RETURNING plan_id`,
    [base.tenantId, `${tenantCode} 계획서`, base.userId],
  );
  const document = await c.query(
    `INSERT INTO document (tenant_id, document_type, title, status, owner_id)
     VALUES ($1, 'PLAN', $2, 'EDITING', $3) RETURNING document_id`,
    [base.tenantId, `${tenantCode} 문서`, base.userId],
  );
  const file = await c.query(
    `INSERT INTO file_object
       (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
     VALUES ($1, $2, 'in.hwpx', 'application/hwp+zip', 4321, $3, 'PENDING', $4)
     RETURNING file_id, upload_state`,
    [base.tenantId, `tenants/${base.tenantId}/sources/${tenantCode}.hwpx`, HASH, base.userId],
  );
  // 기본값이 PENDING이어야 한다 — 새 업로드는 아무것도 검증되지 않은 상태다.
  expect(file.rows[0].upload_state).toBe('PENDING');
  return {
    ...base,
    planId: plan.rows[0].plan_id as string,
    documentId: document.rows[0].document_id as string,
    fileId: file.rows[0].file_id as string,
  };
}

describe.skipIf(!ADMIN_URL)('upload verification surface (CC-170, migration 0022)', () => {
  let db: { name: string; url: string };
  let fxA: UploadFixture;
  let fxB: UploadFixture;

  beforeAll(async () => {
    db = await createTestDb('cc170_upload');
    await migrate(db.url);
    await withClient(db.url, async (c) => {
      fxA = await insertUploadFixture(c, 'cc170-a');
      fxB = await insertUploadFixture(c, 'cc170-b');
    });
  }, 180_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  // -------------------------------------------------------------------------
  // 1. 어휘와 상관식 (0022 §1)
  // -------------------------------------------------------------------------

  it('accepts every upload_state and rejects anything else', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      for (const state of UPLOAD_STATES) {
        const verifiedAt = state === 'VERIFIED' ? 'now()' : 'NULL';
        await c.query(
          `INSERT INTO file_object
             (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256,
              scan_status, upload_state, verified_at, created_by)
           VALUES ($1, $2, 'x.hwpx', 'application/hwp+zip', 1, $3, 'PENDING', $4, ${verifiedAt}, $5)`,
          [
            fxA.tenantId,
            `tenants/${fxA.tenantId}/sources/state-${state}.hwpx`,
            HASH,
            state,
            fxA.userId,
          ],
        );
      }
      await expectSqlState(
        c,
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256,
            scan_status, upload_state, created_by)
         VALUES ($1, $2, 'x.hwpx', 'application/hwp+zip', 1, $3, 'PENDING', 'UPLOADED', $4)`,
        [fxA.tenantId, `tenants/${fxA.tenantId}/sources/bogus.hwpx`, HASH, fxA.userId],
        CHECK_VIOLATION,
        'upload_state=UPLOADED (어휘 밖)',
      );
      await c.query('ROLLBACK');
    });
  }, 60_000);

  it('ties verified_at to VERIFIED in both directions', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      // VERIFIED인데 시각이 없다 → 거부
      await expectSqlState(
        c,
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256,
            scan_status, upload_state, created_by)
         VALUES ($1, $2, 'x.hwpx', 'application/hwp+zip', 1, $3, 'PENDING', 'VERIFIED', $4)`,
        [fxA.tenantId, `tenants/${fxA.tenantId}/sources/no-time.hwpx`, HASH, fxA.userId],
        CHECK_VIOLATION,
        'VERIFIED without verified_at',
      );
      // PENDING인데 시각이 있다 → 거부 (그 시각을 근거로 쓰는 코드가 생긴다)
      await expectSqlState(
        c,
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256,
            scan_status, upload_state, verified_at, created_by)
         VALUES ($1, $2, 'x.hwpx', 'application/hwp+zip', 1, $3, 'PENDING', 'PENDING', now(), $4)`,
        [fxA.tenantId, `tenants/${fxA.tenantId}/sources/early-time.hwpx`, HASH, fxA.userId],
        CHECK_VIOLATION,
        'PENDING with verified_at',
      );
      await c.query('ROLLBACK');
    });
  }, 60_000);

  // -------------------------------------------------------------------------
  // 2. 앱 롤의 UPDATE 범위 (0022 §1 + 0021 §2)
  // -------------------------------------------------------------------------

  it('lets une_app settle the upload but never touch the integrity columns', async () => {
    await asAppRole(db.url, fxA.tenantId, async (c) => {
      await c.query('BEGIN');
      await c.query(
        `UPDATE file_object SET upload_state = 'VERIFIED', verified_at = now()
          WHERE file_id = $1`,
        [fxA.fileId],
      );
      const row = await c.query(
        `SELECT upload_state, verified_at FROM file_object WHERE file_id = $1`,
        [fxA.fileId],
      );
      expect(row.rows[0].upload_state).toBe('VERIFIED');
      expect(row.rows[0].verified_at).toBeTruthy();

      // AV 스캐너가 도착했을 때를 위해 scan_status도 열려 있다(0021 §2).
      await c.query(`UPDATE file_object SET scan_status = 'CLEAN' WHERE file_id = $1`, [
        fxA.fileId,
      ]);

      for (const [column, value] of [
        ['sha256', 'd'.repeat(64)],
        ['storage_key', 'tenants/evil/key.hwpx'],
        ['size_bytes', '1'],
        ['original_name', 'renamed.hwpx'],
      ] as const) {
        await expectSqlState(
          c,
          `UPDATE file_object SET ${column} = $2 WHERE file_id = $1`,
          [fxA.fileId, value],
          INSUFFICIENT_PRIVILEGE,
          `une_app UPDATE file_object.${column}`,
        );
      }
      await c.query('COMMIT');
    });
  }, 60_000);

  // -------------------------------------------------------------------------
  // 3. 계획서-문서 링크 (0022 §2)
  // -------------------------------------------------------------------------

  it('lets one plan claim a document and blocks a second claim', async () => {
    await asAppRole(db.url, fxA.tenantId, async (c) => {
      await c.query('BEGIN');
      await c.query(`UPDATE plan SET document_id = $2 WHERE plan_id = $1`, [
        fxA.planId,
        fxA.documentId,
      ]);
      // 같은 테넌트의 두 번째 계획서가 같은 문서를 주장할 수 없다.
      const other = await c.query(
        `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
         VALUES ($1, '두 번째 계획서', '폭염', '대비', 'DRAFT', $2) RETURNING plan_id`,
        [fxA.tenantId, fxA.userId],
      );
      await expectSqlState(
        c,
        `UPDATE plan SET document_id = $2 WHERE plan_id = $1`,
        [other.rows[0].plan_id, fxA.documentId],
        UNIQUE_VIOLATION,
        'second plan claiming the same document',
      );
      await c.query('COMMIT');
    });
  }, 60_000);

  it('frees the document once the claiming plan is trashed (partial index)', async () => {
    await asAppRole(db.url, fxB.tenantId, async (c) => {
      await c.query(`UPDATE plan SET document_id = $2 WHERE plan_id = $1`, [
        fxB.planId,
        fxB.documentId,
      ]);
      // 휴지통으로 간 계획서는 인덱스 대상이 아니다 — 문서를 다시 쓸 수 있어야
      // 잘못 만든 계획서를 버리고 다시 시작할 수 있다.
      await c.query(`UPDATE plan SET deleted_at = now() WHERE plan_id = $1`, [fxB.planId]);
      const revived = await c.query(
        `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id, document_id)
         VALUES ($1, '다시 만든 계획서', '폭염', '대비', 'DRAFT', $2, $3) RETURNING plan_id`,
        [fxB.tenantId, fxB.userId, fxB.documentId],
      );
      expect(revived.rows[0].plan_id).toBeTruthy();
    });
  }, 60_000);

  it('keeps the plan-document FK honest — deferred, so it fires at COMMIT', async () => {
    // 0007의 FK는 DEFERRABLE INITIALLY DEFERRED다. 그래서 INSERT 자체는
    // 통과하고 위반은 커밋 시점에 드러난다. 그 사실을 그대로 고정한다 —
    // "INSERT가 거부된다"고 적으면 스키마가 아니라 테스트가 거짓이 된다.
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id, document_id)
         VALUES ($1, '없는 문서', '폭염', '대비', 'DRAFT', $2, '00000000-0000-4000-8000-0000000000ff')`,
        [fxA.tenantId, fxA.userId],
      );
      let code: string | undefined;
      try {
        await c.query('COMMIT');
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code, 'plan.document_id -> missing document (at COMMIT)').toBe('23503');
    });
  }, 60_000);
});

describe.skipIf(!ADMIN_URL)('0022 backfill (CC-170)', () => {
  let db: { name: string; url: string };

  beforeAll(async () => {
    db = await createTestDb('cc170_backfill');
  }, 120_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('marks pre-0022 file_object rows VERIFIED with created_at as the time', async () => {
    // 0021까지만 올린다 — 이 시점에는 upload_state 컬럼이 없다.
    await migrate(db.url, 21);
    const seeded = await withClient(db.url, async (c) => {
      const fx = await insertFixture(c, 'cc170-backfill');
      const file = await c.query(
        `INSERT INTO file_object
           (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
         VALUES ($1, $2, 'legacy.hwpx', 'application/hwp+zip', 10, $3, 'PENDING', $4)
         RETURNING file_id, created_at`,
        [fx.tenantId, `tenants/${fx.tenantId}/sources/legacy.hwpx`, HASH, fx.userId],
      );
      return {
        fileId: file.rows[0].file_id as string,
        createdAt: file.rows[0].created_at as Date,
      };
    });

    await migrate(db.url); // 0022

    const row = await withClient(db.url, (c) =>
      c.query(`SELECT upload_state, verified_at FROM file_object WHERE file_id = $1`, [
        seeded.fileId,
      ]),
    );
    // 이 행들의 바이트는 서버가 직접 해시를 계산한 것이다(import·Export 등록
    // 경로). PENDING으로 두면 기존 문서의 원본이 갑자기 "검증되지 않은 파일"이
    // 되어 UNE-DOC-003이 거부한다.
    expect(row.rows[0].upload_state).toBe('VERIFIED');
    expect((row.rows[0].verified_at as Date).getTime()).toBe(seeded.createdAt.getTime());
  }, 180_000);
});
