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
 * CC-150 / migration 0019: 편집 표면의 물리 스키마.
 *
 * 세 가지를 고정한다.
 *  1) document_autosave(61번째 테이블)의 테넌트 격리 — 0018과 같은
 *     EXISTS(document) 패턴이므로 같은 6종 시나리오로 검증한다.
 *  2) 0003이 하나도 두지 않았던 CHECK 제약 — 어휘 밖의 값이 실제로 거부되는지
 *     전건 음성 테스트. "제약을 걸었다"는 DDL의 존재가 아니라 거부 동작이
 *     근거다.
 *  3) 0018이 실측(80,000행에서 3ms → 139ms)으로 남긴 인덱스 과제의 종결 —
 *     §4가 만든 유일성 키가 실제로 조회 계획에 쓰이는지 EXPLAIN으로 핀.
 */

/** 어휘 정본. packages/domain의 상수를 import하지 않고 값을 다시 적는다 —
 * 도메인 상수가 조용히 바뀌면 이 테스트도 함께 바뀌어 DB와의 드리프트를
 * 놓치기 때문이다. 여기서 검증하려는 것은 "DB가 이 집합을 강제한다"이다. */
const CHANGE_OPERATION_TYPES = [
  'INSERT_BLOCKS',
  'REPLACE_RANGE',
  'DELETE_RANGE',
  'SPLIT_PARAGRAPH',
  'MERGE_PARAGRAPHS',
  'MOVE_BLOCK',
  'APPLY_STYLE_ROLE',
  'TABLE_PATCH',
] as const;

const CHANGE_SET_ORIGINS = [
  'USER',
  'AI',
  'AUTOSAVE',
  'UNDO',
  'REDO',
  'RESTORE',
  'MATERIALIZE',
] as const;

const REVISION_ORIGINS = [
  'IMPORT',
  'MATERIALIZE',
  'CHANGESET',
  'AUTOSAVE',
  'UNDO',
  'REDO',
  'RESTORE',
] as const;

const AUTOSAVE_STATUSES = ['ACCEPTED', 'CONFLICT', 'SUPERSEDED'] as const;

/** PostgreSQL SQLSTATE: 23505 unique_violation, 23514 check_violation. */
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

/** EXPLAIN 케이스의 부피. 플래너가 순차 스캔과 인덱스 스캔을 실제로 저울질할
 * 만큼은 되어야 한다(0018과 같은 이유). 문서 20 x 리비전 20 x 블록 30. */
const BULK_DOCS = 20;
const BULK_REVISIONS = 20;
const BULK_BLOCKS = 30;

const HASH_A = 'a'.repeat(64);

interface EditFixture extends Fixture {
  documentId: string;
  revisionId: string;
  changeSetId: string;
  autosaveId: string;
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

/** 실패한 문장이 트랜잭션을 중단시키지 않도록 SAVEPOINT로 감싼다. 하나의
 * 세션에서 여러 음성 케이스를 이어서 던지려면 필요하다. */
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

/** 한 테넌트의 편집 표면 전체. admin(superuser)로 넣으므로 픽스처 자체는
 * 정책에 의존하지 않는다 — 정책을 검증하는 데이터가 정책에 의존하면 안 된다. */
async function insertEditFixture(c: Client, tenantCode: string): Promise<EditFixture> {
  const base = await insertFixture(c, tenantCode);
  const document = await c.query(
    `INSERT INTO document (tenant_id, document_type, title, status, owner_id)
     VALUES ($1, 'PLAN', $2, 'EDITING', $3) RETURNING document_id`,
    [base.tenantId, `${tenantCode} 문서`, base.userId],
  );
  const documentId = document.rows[0].document_id as string;

  const revision = await c.query(
    `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, origin, created_by)
     VALUES ($1, 1, $2, $3, 'IMPORT', $4) RETURNING revision_id`,
    [documentId, JSON.stringify({ tenant: tenantCode }), HASH_A, base.userId],
  );
  const revisionId = revision.rows[0].revision_id as string;

  const changeSet = await c.query(
    `INSERT INTO change_set
       (document_id, base_revision_id, client_mutation_id, selection_json, status, origin, created_by)
     VALUES ($1, $2, $3, '{}', 'APPLIED', 'USER', $4) RETURNING change_set_id`,
    [documentId, revisionId, `cm-${tenantCode}`, base.userId],
  );
  const changeSetId = changeSet.rows[0].change_set_id as string;

  const autosave = await c.query(
    `INSERT INTO document_autosave
       (document_id, base_revision_id, client_mutation_id, seq, delta_json, status, created_by)
     VALUES ($1, $2, $3, 1, $4, 'ACCEPTED', $5) RETURNING autosave_id`,
    [
      documentId,
      revisionId,
      `auto-${tenantCode}`,
      JSON.stringify({ text: `${tenantCode} 자동저장 본문` }),
      base.userId,
    ],
  );

  return {
    ...base,
    documentId,
    revisionId,
    changeSetId,
    autosaveId: autosave.rows[0].autosave_id as string,
  };
}

describe.skipIf(!ADMIN_URL)('document edit surface (CC-150, migration 0019)', () => {
  let db: { name: string; url: string };
  let fxA: EditFixture;
  let fxB: EditFixture;
  let bulkRevisionId: string;

  beforeAll(async () => {
    db = await createTestDb('cc150_edit');
    await migrate(db.url);
    await withClient(db.url, async (c) => {
      fxA = await insertEditFixture(c, 'cc150e-a');
      fxB = await insertEditFixture(c, 'cc150e-b');

      await c.query(
        `INSERT INTO document (tenant_id, document_type, title, status, owner_id)
         SELECT $1, 'PLAN', 'bulk ' || g, 'EDITING', $2 FROM generate_series(1, $3::int) g`,
        [fxA.tenantId, fxA.userId, BULK_DOCS],
      );
      await c.query(
        `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, created_by)
         SELECT d.document_id, g, '{"bulk":true}', $1, $2
         FROM document d, generate_series(1, $3::int) g
         WHERE d.title LIKE 'bulk %'`,
        ['d'.repeat(64), fxA.userId, BULK_REVISIONS],
      );
      await c.query(
        `INSERT INTO document_block
           (revision_id, stable_block_key, block_type, sort_order, protection_state, payload_json)
         SELECT r.revision_id, 'b-' || g, 'PARAGRAPH', g, 'NONE', '{}'
         FROM document_revision r
         JOIN document d ON d.document_id = r.document_id AND d.title LIKE 'bulk %',
              generate_series(1, $1::int) g`,
        [BULK_BLOCKS],
      );
      await c.query(
        `INSERT INTO change_set
           (document_id, base_revision_id, client_mutation_id, selection_json, status, created_by)
         SELECT r.document_id, r.revision_id, 'bulk-cm-' || r.revision_id, '{}', 'APPLIED', $1
         FROM document_revision r
         JOIN document d ON d.document_id = r.document_id AND d.title LIKE 'bulk %'`,
        [fxA.userId],
      );
      await c.query(
        `INSERT INTO change_operation (change_set_id, operation_order, operation_type, target_json)
         SELECT cs.change_set_id, g, 'INSERT_BLOCKS', '{}'
         FROM change_set cs, generate_series(1, 5) g
         WHERE cs.client_mutation_id LIKE 'bulk-cm-%'`,
      );
      await c.query(
        `INSERT INTO document_autosave
           (document_id, base_revision_id, client_mutation_id, seq, delta_json, status, created_by)
         SELECT r.document_id, r.revision_id, 'bulk-auto-' || r.revision_id || '-' || g,
                g, '{"d":1}', 'SUPERSEDED', $1
         FROM document_revision r
         JOIN document d ON d.document_id = r.document_id AND d.title LIKE 'bulk %',
              generate_series(1, 5) g`,
        [fxA.userId],
      );

      for (const t of [
        'document',
        'document_revision',
        'document_block',
        'change_set',
        'change_operation',
        'document_autosave',
      ]) {
        await c.query(`ANALYZE ${t}`);
      }

      const bulkRevision = await c.query(
        `SELECT r.revision_id FROM document_revision r
         JOIN document d ON d.document_id = r.document_id
         WHERE d.title = 'bulk 1' ORDER BY r.revision_no LIMIT 1`,
      );
      bulkRevisionId = bulkRevision.rows[0].revision_id as string;
    });
  }, 180_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  // -------------------------------------------------------------------------
  // 1. document_autosave 구조
  // -------------------------------------------------------------------------

  it('creates document_autosave with the UNE-DOC-009 column contract', async () => {
    // 설계 §6 물리 DDL에 정의가 없는 테이블이므로(0019 §0), 컬럼 계약이
    // OpenAPI/시퀀스가 요구하는 형태 그대로인지 스키마 자체를 단언한다.
    const cols = await withClient(db.url, (c) =>
      c.query(
        `SELECT column_name, data_type, is_nullable, character_maximum_length
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'document_autosave'
         ORDER BY column_name`,
      ),
    );
    const shape = Object.fromEntries(
      cols.rows.map((r) => [
        r.column_name as string,
        `${r.data_type}${r.character_maximum_length ? `(${r.character_maximum_length})` : ''}:${r.is_nullable}`,
      ]),
    );
    expect(shape).toEqual({
      autosave_id: 'uuid:NO',
      document_id: 'uuid:NO',
      base_revision_id: 'uuid:NO',
      client_mutation_id: 'character varying(100):NO',
      seq: 'bigint:NO',
      delta_json: 'jsonb:NO',
      result_revision_id: 'uuid:YES',
      status: 'character varying(20):NO',
      created_by: 'uuid:NO',
      created_at: 'timestamp with time zone:NO',
    });
  });

  it('enables, forces and policies RLS on document_autosave (0018 pattern)', async () => {
    const state = await withClient(db.url, (c) =>
      c.query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT array_agg(p.policyname::text ORDER BY p.policyname)
                 FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = 'document_autosave') AS policies
         FROM pg_class c WHERE c.relname = 'document_autosave' AND c.relkind = 'r'`,
      ),
    );
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].relrowsecurity).toBe(true);
    expect(state.rows[0].relforcerowsecurity).toBe(true);
    expect(state.rows[0].policies).toEqual(['p_document_autosave_tenant']);
  });

  // -------------------------------------------------------------------------
  // 2. document_autosave RLS 6종 (0018/0017 하네스와 동형)
  // -------------------------------------------------------------------------

  it('shows a tenant only its own autosave rows (une_app)', async () => {
    const visible = await asRole(db.url, 'une_app', fxA.tenantId, (c) =>
      c.query(`SELECT autosave_id FROM document_autosave WHERE autosave_id = ANY($1)`, [
        [fxA.autosaveId, fxB.autosaveId],
      ]),
    );
    expect(visible.rows.map((r) => r.autosave_id)).toEqual([fxA.autosaveId]);
  });

  it('hides another tenant autosave delta on a direct id lookup (the leak this closes)', async () => {
    // delta_json은 사용자가 방금 친 문장 그대로다 — 본문 유출과 동치다.
    const leaked = await asRole(db.url, 'une_app', fxA.tenantId, (c) =>
      c.query(`SELECT delta_json FROM document_autosave WHERE autosave_id = $1`, [fxB.autosaveId]),
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it('returns no autosave rows at all when app.tenant_id is unset (une_app)', async () => {
    const counts = await asRole(db.url, 'une_app', null, (c) =>
      c.query(`SELECT count(*)::int AS n FROM document_autosave`),
    );
    expect(counts.rows[0].n).toBe(0);
  });

  it('proves the autosave rows exist and only the policy hides them (superuser control)', async () => {
    const counts = await withClient(db.url, (c) =>
      c.query(`SELECT count(*)::int AS n FROM document_autosave WHERE autosave_id = ANY($1)`, [
        [fxA.autosaveId, fxB.autosaveId],
      ]),
    );
    expect(counts.rows[0].n).toBe(2);
  });

  it('rejects cross-tenant and orphan autosave writes through WITH CHECK (une_app)', async () => {
    const ghost = '00000000-0000-0000-0000-0000000000ff';
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      await expect(
        c.query(
          `INSERT INTO document_autosave
             (document_id, base_revision_id, client_mutation_id, seq, delta_json, status, created_by)
           VALUES ($1, $2, 'evil', 1, '{}', 'ACCEPTED', $3)`,
          [fxB.documentId, fxB.revisionId, fxA.userId],
        ),
        'cross-tenant autosave',
      ).rejects.toThrow(/row-level security/);

      // 부모 document가 없으면 EXISTS는 거짓이다. FK는 DEFERRABLE이라 COMMIT
      // 까지 판정을 미루지만 RLS의 WITH CHECK는 문장 시점에 즉시 막는다.
      await expect(
        c.query(
          `INSERT INTO document_autosave
             (document_id, base_revision_id, client_mutation_id, seq, delta_json, status, created_by)
           VALUES ($1, $2, 'orphan', 1, '{}', 'ACCEPTED', $3)`,
          [ghost, fxA.revisionId, fxA.userId],
        ),
        'orphan autosave',
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('cannot update another tenant autosave even with the row id (une_app)', async () => {
    const affected = await asRole(db.url, 'une_app', fxA.tenantId, (c) =>
      c.query(`UPDATE document_autosave SET status = 'SUPERSEDED' WHERE autosave_id = $1`, [
        fxB.autosaveId,
      ]),
    );
    expect(affected.rowCount).toBe(0);
    const survived = await withClient(db.url, (c) =>
      c.query(`SELECT status FROM document_autosave WHERE autosave_id = $1`, [fxB.autosaveId]),
    );
    expect(survived.rows[0].status).toBe('ACCEPTED');
  });

  it('lets a tenant write and supersede its own autosave (une_app happy path)', async () => {
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      const inserted = await c.query(
        `INSERT INTO document_autosave
           (document_id, base_revision_id, client_mutation_id, seq, delta_json, status, created_by)
         VALUES ($1, $2, 'cm-happy-auto', 7, '{"t":"편집중"}', 'ACCEPTED', $3)
         RETURNING autosave_id, created_at`,
        [fxA.documentId, fxA.revisionId, fxA.userId],
      );
      expect(inserted.rows[0].autosave_id).toBeTruthy();
      expect(inserted.rows[0].created_at).toBeInstanceOf(Date);

      // 나중 자동저장이 반영되면 앞선 행을 SUPERSEDED로 표시한다(UPDATE 경로).
      const superseded = await c.query(
        `UPDATE document_autosave SET status = 'SUPERSEDED'
         WHERE autosave_id = $1 RETURNING status`,
        [inserted.rows[0].autosave_id],
      );
      expect(superseded.rows[0].status).toBe('SUPERSEDED');
    });
  });

  // -------------------------------------------------------------------------
  // 3. 멱등 UK와 권한
  // -------------------------------------------------------------------------

  it('rejects a replayed autosave with the same (document_id, client_mutation_id) as 23505', async () => {
    // 오프라인 큐는 같은 항목을 여러 번 재전송하는 것이 정상 동작이다
    // (US-PLAN-020 A-01). 그때 리비전이 중복 생성되지 않는 근거가 이 UK다.
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      await c.query('BEGIN');
      await expectSqlState(
        c,
        `INSERT INTO document_autosave
           (document_id, base_revision_id, client_mutation_id, seq, delta_json, status, created_by)
         VALUES ($1, $2, $3, 2, '{"replay":true}', 'ACCEPTED', $4)`,
        [fxA.documentId, fxA.revisionId, `auto-cc150e-a`, fxA.userId],
        UNIQUE_VIOLATION,
        'autosave replay',
      );
      await c.query('ROLLBACK');
    });

    // 같은 멱등키라도 다른 문서면 통과한다 — 범위가 document_id인 것의 의미.
    await withClient(db.url, async (c) => {
      const other = await c.query(
        `INSERT INTO document_autosave
           (document_id, base_revision_id, client_mutation_id, seq, delta_json, status, created_by)
         VALUES ($1, $2, 'auto-cc150e-a', 1, '{}', 'ACCEPTED', $3) RETURNING autosave_id`,
        [fxB.documentId, fxB.revisionId, fxB.userId],
      );
      expect(other.rows[0].autosave_id).toBeTruthy();
      await c.query(`DELETE FROM document_autosave WHERE autosave_id = $1`, [
        other.rows[0].autosave_id,
      ]);
    });
  });

  it('denies une_app DELETE on document_autosave (command journal is audit evidence)', async () => {
    // US-PLAN-020 AC-03: "command journal과 저장 artifact hash로 변경을
    // 재현한다." 삭제가 가능하면 그 인수기준이 성립하지 않는다.
    const grants = await withClient(db.url, (c) =>
      c.query(
        `SELECT string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.role_table_grants
         WHERE grantee = 'une_app' AND table_name = 'document_autosave'`,
      ),
    );
    expect(grants.rows[0].privs).toBe('INSERT,SELECT,UPDATE');

    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      await expect(
        c.query(`DELETE FROM document_autosave WHERE autosave_id = $1`, [fxA.autosaveId]),
      ).rejects.toThrow(/permission denied for table document_autosave/);
    });
  });

  it('gives une_worker no privileges on document_autosave', async () => {
    // UNE-DOC-009는 동기 사용자 요청 경로이며 워커가 닿을 이유가 없다.
    // 0018이 문서 계열 여덟 테이블에 고정한 상태를 신규 테이블에도 유지한다.
    const grants = await withClient(db.url, (c) =>
      c.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'une_worker' AND table_name = 'document_autosave'`,
      ),
    );
    expect(grants.rows).toEqual([]);

    await asRole(db.url, 'une_worker', fxA.tenantId, async (c) => {
      await expect(c.query(`SELECT count(*) FROM document_autosave`)).rejects.toThrow(
        /permission denied for table document_autosave/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // 4. CHECK 제약 전건 (0019 §3)
  // -------------------------------------------------------------------------

  it('accepts every value of the closed vocabularies (positive control)', async () => {
    // 음성 테스트만 있으면 "너무 좁게 잠갔다"를 잡지 못한다. 정본 어휘의
    // 모든 값이 실제로 들어가는지 먼저 확인한다.
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      let revisionNo = 100;
      for (const origin of REVISION_ORIGINS) {
        await c.query(
          `INSERT INTO document_revision
             (document_id, revision_no, ir_json, ir_hash, origin, created_by)
           VALUES ($1, $2, '{}', $3, $4, $5)`,
          [fxA.documentId, revisionNo++, HASH_A, origin, fxA.userId],
        );
      }
      let n = 0;
      for (const origin of CHANGE_SET_ORIGINS) {
        await c.query(
          `INSERT INTO change_set
             (document_id, base_revision_id, client_mutation_id, selection_json, status, origin, created_by)
           VALUES ($1, $2, $3, '{}', 'APPLIED', $4, $5)`,
          [fxA.documentId, fxA.revisionId, `vocab-${n++}`, origin, fxA.userId],
        );
      }
      let order = 1;
      for (const type of CHANGE_OPERATION_TYPES) {
        await c.query(
          `INSERT INTO change_operation
             (change_set_id, operation_order, operation_type, target_json)
           VALUES ($1, $2, $3, '{}')`,
          [fxA.changeSetId, order++, type],
        );
      }
      let seq = 100;
      for (const status of AUTOSAVE_STATUSES) {
        await c.query(
          `INSERT INTO document_autosave
             (document_id, base_revision_id, client_mutation_id, seq, delta_json, status, created_by)
           VALUES ($1, $2, $3, $4, '{}', $5, $6)`,
          [fxA.documentId, fxA.revisionId, `vocab-auto-${status}`, seq++, status, fxA.userId],
        );
      }
      for (const status of ['EDITING', 'REVIEW', 'APPROVED']) {
        await c.query(`UPDATE document SET status = $1 WHERE document_id = $2`, [
          status,
          fxA.documentId,
        ]);
      }
      for (const state of ['NONE', 'USER_LOCKED', 'SYSTEM_LOCKED']) {
        await c.query(
          `INSERT INTO document_block
             (revision_id, stable_block_key, block_type, sort_order, protection_state, payload_json)
           VALUES ($1, $2, 'PARAGRAPH', 1, $3, '{}')`,
          [fxA.revisionId, `prot-${state}`, state],
        );
      }
      await c.query('ROLLBACK');
    });
  });

  it('rejects every value outside the closed vocabularies as 23514 (negative, all constraints)', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');

      // 3.1 document.status
      await expectSqlState(
        c,
        `UPDATE document SET status = 'DRAFT' WHERE document_id = $1`,
        [fxA.documentId],
        CHECK_VIOLATION,
        'document.status (plan.status 어휘 오용)',
      );

      // 3.2 change_set.status — 설계 05의 CONFLICTED는 채택하지 않았다.
      await expectSqlState(
        c,
        `INSERT INTO change_set
           (document_id, base_revision_id, client_mutation_id, selection_json, status, created_by)
         VALUES ($1, $2, 'bad-status', '{}', 'CONFLICTED', $3)`,
        [fxA.documentId, fxA.revisionId, fxA.userId],
        CHECK_VIOLATION,
        'change_set.status',
      );

      // 3.3 change_set.origin / document_revision.origin
      await expectSqlState(
        c,
        `INSERT INTO change_set
           (document_id, base_revision_id, client_mutation_id, selection_json, status, origin, created_by)
         VALUES ($1, $2, 'bad-origin', '{}', 'APPLIED', 'SYSTEM', $3)`,
        [fxA.documentId, fxA.revisionId, fxA.userId],
        CHECK_VIOLATION,
        'change_set.origin',
      );
      // USER/AI는 ChangeSet의 축이지 Revision의 축이 아니다.
      await expectSqlState(
        c,
        `INSERT INTO document_revision
           (document_id, revision_no, ir_json, ir_hash, origin, created_by)
         VALUES ($1, 200, '{}', $2, 'USER', $3)`,
        [fxA.documentId, HASH_A, fxA.userId],
        CHECK_VIOLATION,
        'document_revision.origin',
      );

      // 3.4 document_block.protection_state
      await expectSqlState(
        c,
        `INSERT INTO document_block
           (revision_id, stable_block_key, block_type, sort_order, protection_state, payload_json)
         VALUES ($1, 'bad-prot', 'PARAGRAPH', 1, 'LOCKED', '{}')`,
        [fxA.revisionId],
        CHECK_VIOLATION,
        'document_block.protection_state',
      );

      // 3.5 change_operation.operation_type — 설계 10 §6.21의 예시 표기.
      await expectSqlState(
        c,
        `INSERT INTO change_operation
           (change_set_id, operation_order, operation_type, target_json)
         VALUES ($1, 90, 'insertText', '{}')`,
        [fxA.changeSetId],
        CHECK_VIOLATION,
        'change_operation.operation_type',
      );

      // 3.6 해시 형식: 대문자, 짧은 값 모두 거부한다.
      await expectSqlState(
        c,
        `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, created_by)
         VALUES ($1, 201, '{}', $2, $3)`,
        [fxA.documentId, 'A'.repeat(64), fxA.userId],
        CHECK_VIOLATION,
        'document_revision.ir_hash (대문자)',
      );
      await expectSqlState(
        c,
        `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, created_by)
         VALUES ($1, 202, '{}', $2, $3)`,
        [fxA.documentId, 'abc', fxA.userId],
        CHECK_VIOLATION,
        'document_revision.ir_hash (char(64) 공백 패딩)',
      );
      await expectSqlState(
        c,
        `INSERT INTO template_profile
           (document_id, profile_version, analysis_status, profile_json, unsupported_objects_json, analysis_hash)
         VALUES ($1, 1, 'CONFIRMED', '{}', '[]', $2)`,
        [fxA.documentId, 'Z'.repeat(64)],
        CHECK_VIOLATION,
        'template_profile.analysis_hash',
      );
      const profile = await c.query(
        `INSERT INTO template_profile
           (document_id, profile_version, analysis_status, profile_json, unsupported_objects_json, analysis_hash)
         VALUES ($1, 1, 'CONFIRMED', '{}', '[]', $2) RETURNING template_profile_id`,
        [fxA.documentId, 'b'.repeat(64)],
      );
      await expectSqlState(
        c,
        `INSERT INTO style_prototype
           (template_profile_id, prototype_key, prototype_type, source_locator_json, clone_policy_json, style_fingerprint)
         VALUES ($1, 'k', 'TITLE', '{}', '{}', $2)`,
        [profile.rows[0].template_profile_id, 'not-a-hash'],
        CHECK_VIOLATION,
        'style_prototype.style_fingerprint',
      );

      // 3.7 revision_no > 0
      await expectSqlState(
        c,
        `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, created_by)
         VALUES ($1, 0, '{}', $2, $3)`,
        [fxA.documentId, HASH_A, fxA.userId],
        CHECK_VIOLATION,
        'document_revision.revision_no',
      );

      // §1 document_autosave.status
      await expectSqlState(
        c,
        `INSERT INTO document_autosave
           (document_id, base_revision_id, client_mutation_id, seq, delta_json, status, created_by)
         VALUES ($1, $2, 'bad-auto-status', 9, '{}', 'PENDING', $3)`,
        [fxA.documentId, fxA.revisionId, fxA.userId],
        CHECK_VIOLATION,
        'document_autosave.status',
      );

      await c.query('ROLLBACK');
    });
  });

  it('keeps validation_report.target_type open (0018 deferred it to CC-160)', async () => {
    // 0018 §8은 어휘 밖 target_type을 정책이 fail-closed로 다루도록 남겼다.
    // 0019가 CHECK로 닫아 버리면 그 관측 가능한 상태가 제약 위반으로 바뀐다.
    // "닫지 않았다"를 명시적으로 고정해 두어야 나중에 무심코 닫히지 않는다.
    const constraints = await withClient(db.url, (c) =>
      c.query(
        `SELECT conname FROM pg_constraint
         WHERE conrelid = 'validation_report'::regclass AND contype = 'c'`,
      ),
    );
    expect(constraints.rows).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 5. 유일성 키 (0019 §4)
  // -------------------------------------------------------------------------

  it('scopes stable_block_key uniqueness to the revision, not the document', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      // 같은 리비전 안의 중복은 거부된다 — 선택영역 해석이 비결정적이 되므로.
      await expectSqlState(
        c,
        `INSERT INTO document_block
           (revision_id, stable_block_key, block_type, sort_order, protection_state, payload_json)
         VALUES ($1, 'b-1', 'PARAGRAPH', 99, 'NONE', '{}')`,
        [bulkRevisionId],
        UNIQUE_VIOLATION,
        'stable_block_key in revision',
      );

      // 같은 문서의 다른 리비전에서 같은 키가 반복되는 것은 **정상**이다 —
      // "안정 ID"란 리비전을 넘어 같은 문단이 같은 키를 유지한다는 뜻이다.
      const sibling = await c.query(
        `SELECT r2.revision_id FROM document_revision r1
         JOIN document_revision r2 ON r2.document_id = r1.document_id
         WHERE r1.revision_id = $1 AND r2.revision_id <> r1.revision_id LIMIT 1`,
        [bulkRevisionId],
      );
      const siblingCount = await c.query(
        `SELECT count(*)::int AS n FROM document_block
         WHERE revision_id = ANY($1) AND stable_block_key = 'b-1'`,
        [[bulkRevisionId, sibling.rows[0].revision_id]],
      );
      expect(siblingCount.rows[0].n, '같은 문서의 두 리비전이 같은 안정 ID를 갖는다').toBe(2);
      await c.query('ROLLBACK');
    });
  });

  it('enforces change_set idempotency per document and operation order per change set', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      await expectSqlState(
        c,
        `INSERT INTO change_set
           (document_id, base_revision_id, client_mutation_id, selection_json, status, created_by)
         VALUES ($1, $2, $3, '{}', 'APPLIED', $4)`,
        [fxA.documentId, fxA.revisionId, 'cm-cc150e-a', fxA.userId],
        UNIQUE_VIOLATION,
        'change_set.client_mutation_id replay',
      );
      // 같은 멱등키라도 다른 문서면 통과한다.
      await c.query(
        `INSERT INTO change_set
           (document_id, base_revision_id, client_mutation_id, selection_json, status, created_by)
         VALUES ($1, $2, 'cm-cc150e-a', '{}', 'APPLIED', $3)`,
        [fxB.documentId, fxB.revisionId, fxB.userId],
      );

      await c.query(
        `INSERT INTO change_operation (change_set_id, operation_order, operation_type, target_json)
         VALUES ($1, 50, 'MOVE_BLOCK', '{}')`,
        [fxA.changeSetId],
      );
      // 같은 순번이 둘이면 적용 순서가 비결정적이고 invert∘apply == identity가 깨진다.
      await expectSqlState(
        c,
        `INSERT INTO change_operation (change_set_id, operation_order, operation_type, target_json)
         VALUES ($1, 50, 'DELETE_RANGE', '{}')`,
        [fxA.changeSetId],
        UNIQUE_VIOLATION,
        'change_operation.operation_order',
      );
      await c.query('ROLLBACK');
    });
  });

  it('records the undo lineage as a self reference, not inside selection_json', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      const undo = await c.query(
        `INSERT INTO change_set
           (document_id, base_revision_id, client_mutation_id, selection_json, status, origin,
            undoes_change_set_id, created_by)
         VALUES ($1, $2, 'undo-1', '{}', 'APPLIED', 'UNDO', $3, $4)
         RETURNING change_set_id`,
        [fxA.documentId, fxA.revisionId, fxA.changeSetId, fxA.userId],
      );
      // 계보가 질의 가능한 술어라는 것이 요점이다(selection_json에 묻으면 불가능).
      const lineage = await c.query(
        `SELECT undone.change_set_id FROM change_set u
         JOIN change_set undone ON undone.change_set_id = u.undoes_change_set_id
         WHERE u.change_set_id = $1`,
        [undo.rows[0].change_set_id],
      );
      expect(lineage.rows[0].change_set_id).toBe(fxA.changeSetId);

      // 실재하지 않는 대상은 self FK가 막는다(DEFERRABLE이라 COMMIT 시점).
      await c.query(
        `INSERT INTO change_set
           (document_id, base_revision_id, client_mutation_id, selection_json, status, origin,
            undoes_change_set_id, created_by)
         VALUES ($1, $2, 'undo-ghost', '{}', 'APPLIED', 'UNDO',
                 '00000000-0000-0000-0000-0000000000ff', $3)`,
        [fxA.documentId, fxA.revisionId, fxA.userId],
      );
      await expect(c.query('COMMIT')).rejects.toThrow(/fk_change_set_undoes_change_set_id/);
      await c.query('ROLLBACK');
    });
  });

  it('defaults origin on existing write paths without breaking them', async () => {
    // 0018 시절의 INSERT 문(origin을 모르는 코드)이 그대로 동작해야 한다.
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      const revision = await c.query(
        `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, created_by)
         VALUES ($1, 300, '{}', $2, $3) RETURNING origin, checkpoint_label`,
        [fxA.documentId, HASH_A, fxA.userId],
      );
      expect(revision.rows[0].origin).toBe('CHANGESET');
      expect(revision.rows[0].checkpoint_label).toBeNull();

      const changeSet = await c.query(
        `INSERT INTO change_set
           (document_id, base_revision_id, client_mutation_id, selection_json, status, created_by)
         VALUES ($1, $2, 'default-origin', '{}', 'APPLIED', $3)
         RETURNING origin, undoes_change_set_id`,
        [fxA.documentId, fxA.revisionId, fxA.userId],
      );
      expect(changeSet.rows[0].origin).toBe('USER');
      expect(changeSet.rows[0].undoes_change_set_id).toBeNull();
      await c.query('ROLLBACK');
    });
  });

  it('makes checkpoint history a queryable predicate rather than a text scan', async () => {
    // US-PLAN-020 #3의 "생성전/목차확정/초안완료/수동 checkpoint 조회".
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      const labels = ['생성전', '목차확정', '초안완료', '사용자가 직접 붙인 라벨'];
      let no = 400;
      for (const label of labels) {
        await c.query(
          `INSERT INTO document_revision
             (document_id, revision_no, ir_json, ir_hash, checkpoint_label, created_by)
           VALUES ($1, $2, '{}', $3, $4, $5)`,
          [fxA.documentId, no++, HASH_A, label, fxA.userId],
        );
      }
      const history = await c.query(
        `SELECT checkpoint_label FROM document_revision
         WHERE document_id = $1 AND checkpoint_label IS NOT NULL
         ORDER BY revision_no`,
        [fxA.documentId],
      );
      // 수동 라벨이 어휘 CHECK에 걸리지 않는 것이 핵심이다(0019 §2.2).
      expect(history.rows.map((r) => r.checkpoint_label)).toEqual(labels);
      await c.query('ROLLBACK');
    });
  });

  // -------------------------------------------------------------------------
  // 6. EXPLAIN 회귀 핀 (0018 실측 139ms의 종결)
  // -------------------------------------------------------------------------

  it('resolves the document_block revision lookup through uk_document_block_stable_key (EXPLAIN)', async () => {
    // 0018 헤더의 실측: 이 질의가 RLS 아래 80,000행에서 3ms → 139ms였고,
    // 원인은 인덱스 없는 자식 전수 스캔에 SubPlan qual을 얹는 것이었다.
    // 유일성 키의 선두 컬럼이 revision_id이므로 그 경로가 여기서 닫힌다.
    const plan = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      const res = await c.query(
        `EXPLAIN SELECT block_id, sort_order FROM document_block
         WHERE revision_id = $1 ORDER BY sort_order`,
        [bulkRevisionId],
      );
      return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
    });
    expect(plan, plan).toMatch(/Scan[^\n]*uk_document_block_stable_key/);
    expect(plan, plan).not.toMatch(/Seq Scan on document_block/);
  });

  it('resolves change_set idempotency and change_operation order through their unique keys (EXPLAIN)', async () => {
    const explain = (sql: string, params: unknown[]): Promise<string> =>
      asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        const res = await c.query(`EXPLAIN ${sql}`, params);
        return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
      });

    // 모든 편집 요청이 한 번씩 타는 멱등 재조회 경로.
    const idem = await explain(
      `SELECT change_set_id, status FROM change_set
       WHERE document_id = $1 AND client_mutation_id = $2`,
      [fxA.documentId, 'cm-cc150e-a'],
    );
    expect(idem, idem).toMatch(/Scan[^\n]*uk_change_set_mutation/);
    expect(idem, idem).not.toMatch(/Seq Scan on change_set/);

    const ops = await explain(
      `SELECT operation_id, operation_type FROM change_operation
       WHERE change_set_id = $1 ORDER BY operation_order`,
      [fxA.changeSetId],
    );
    expect(ops, ops).toMatch(/Scan[^\n]*uk_change_operation_order/);
    expect(ops, ops).not.toMatch(/Seq Scan on change_operation/);

    const autosaves = await explain(
      `SELECT autosave_id, status FROM document_autosave
       WHERE document_id = $1 ORDER BY seq DESC LIMIT 1`,
      [fxA.documentId],
    );
    expect(autosaves, autosaves).toMatch(/Scan[^\n]*ix_document_autosave_doc_seq/);
    expect(autosaves, autosaves).not.toMatch(/Seq Scan on document_autosave/);
  });

  it('does not add a redundant (document_id, revision_no DESC) index (0019 §4.4)', async () => {
    // uk_document_revision_no가 이미 역방향 스캔으로 덮는다. 중복 인덱스를
    // 만들지 않았다는 결정을 회귀로 고정한다 — 나중에 "인덱스가 없네" 하고
    // 다시 추가되는 것을 막는 것이 이 단언의 목적이다.
    const indexes = await withClient(db.url, (c) =>
      c.query(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'document_revision' ORDER BY indexname`,
      ),
    );
    expect(indexes.rows.map((r) => r.indexname)).toEqual([
      'document_revision_pkey',
      'uk_document_revision_no',
    ]);

    const plan = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      const res = await c.query(
        `EXPLAIN SELECT revision_id, revision_no FROM document_revision
         WHERE document_id = $1 ORDER BY revision_no DESC LIMIT 1`,
        [fxA.documentId],
      );
      return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
    });
    expect(plan, plan).toMatch(/Index Scan Backward using uk_document_revision_no/);
  });
});
