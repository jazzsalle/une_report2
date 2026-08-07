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
 * CC-150 차단성 선행조건 / migration 0018: 문서 계열 하위 8개 테이블의 테넌트 RLS.
 *
 * 0019 반영: operation_type 픽스처가 'insertText'(설계 10 §6.21의 예시 표기)
 * 에서 'INSERT_BLOCKS'로 바뀌었다. 0019 §3.5가 설계 07 §1.9의 8종 어휘를
 * ck_change_operation_type으로 닫으므로 예시 문자열은 더 이상 저장되지 않는다.
 * 이 파일이 검증하는 것은 RLS이지 어휘가 아니므로, 픽스처를 정본 어휘로
 * 맞추는 것 외에 단언은 그대로다.
 * ADR-29 D9를 종결한다 — 0008/0011은 document/file_object에만 정책을 두고
 * document_revision / document_block / change_set / change_operation /
 * template_profile / style_prototype / export_job / validation_report에는
 * 정책이 없는 채로 une_app에 ALL TABLES DML을 부여했다. CC-150이 첫 쓰기
 * 경로를 열기 전에 격리를 DB에서 닫는다(0016 패턴: 부모 EXISTS 조인).
 */

const DOC_CHILD_TABLES = [
  'change_operation',
  'change_set',
  'document_block',
  'document_revision',
  'export_job',
  'style_prototype',
  'template_profile',
  'validation_report',
] as const;

/** EXPLAIN 케이스의 부피. document 20 x revision 20 x block 30 = 12,000 블록.
 * 플래너가 순차 스캔과 인덱스 스캔을 실제로 저울질할 만큼은 되어야 한다. */
const BULK_DOCS = 20;
const BULK_REVISIONS = 20;
const BULK_BLOCKS = 30;

interface DocFixture extends Fixture {
  documentId: string;
  revisionId: string;
  blockId: string;
  changeSetId: string;
  operationId: string;
  templateProfileId: string;
  prototypeId: string;
  exportId: string;
  /** target_type='DOCUMENT' 보고서 */
  reportOnDocumentId: string;
  /** target_type='EXPORT' 보고서 */
  reportOnExportId: string;
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

/** 한 테넌트의 문서 애그리거트 전체. admin(superuser)로 넣으므로 픽스처 자체는
 * 정책에 의존하지 않는다 — 정책을 검증하는 데이터가 정책에 의존하면 안 된다. */
async function insertDocFixture(c: Client, tenantCode: string): Promise<DocFixture> {
  const base = await insertFixture(c, tenantCode);
  const document = await c.query(
    `INSERT INTO document (tenant_id, document_type, title, status, owner_id)
     VALUES ($1, 'PLAN', $2, 'EDITING', $3) RETURNING document_id`,
    [base.tenantId, `${tenantCode} 문서`, base.userId],
  );
  const documentId = document.rows[0].document_id as string;

  const revision = await c.query(
    `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, created_by)
     VALUES ($1, 1, $2, $3, $4) RETURNING revision_id`,
    [documentId, JSON.stringify({ tenant: tenantCode }), 'a'.repeat(64), base.userId],
  );
  const revisionId = revision.rows[0].revision_id as string;

  const block = await c.query(
    `INSERT INTO document_block
       (revision_id, stable_block_key, block_type, sort_order, text_content, protection_state, payload_json)
     VALUES ($1, 'b-1', 'PARAGRAPH', 1, $2, 'NONE', '{}') RETURNING block_id`,
    [revisionId, `${tenantCode} 본문`],
  );

  const changeSet = await c.query(
    `INSERT INTO change_set
       (document_id, base_revision_id, client_mutation_id, selection_json, status, created_by)
     VALUES ($1, $2, $3, '{}', 'APPLIED', $4) RETURNING change_set_id`,
    [documentId, revisionId, `cm-${tenantCode}`, base.userId],
  );
  const changeSetId = changeSet.rows[0].change_set_id as string;

  const operation = await c.query(
    `INSERT INTO change_operation
       (change_set_id, operation_order, operation_type, target_json, before_json, after_json)
     VALUES ($1, 1, 'INSERT_BLOCKS', '{}', $2, $3) RETURNING operation_id`,
    [
      changeSetId,
      JSON.stringify({ text: `${tenantCode} 변경전` }),
      JSON.stringify({ text: `${tenantCode} 변경후` }),
    ],
  );

  const profile = await c.query(
    `INSERT INTO template_profile
       (document_id, profile_version, analysis_status, profile_json, unsupported_objects_json, analysis_hash)
     VALUES ($1, 1, 'LIMITED', '{}', '[]', $2) RETURNING template_profile_id`,
    [documentId, 'b'.repeat(64)],
  );
  const templateProfileId = profile.rows[0].template_profile_id as string;

  const prototype = await c.query(
    `INSERT INTO style_prototype
       (template_profile_id, prototype_key, prototype_type, source_locator_json, clone_policy_json, style_fingerprint)
     VALUES ($1, 'title', 'TITLE', '{}', '{}', $2) RETURNING prototype_id`,
    [templateProfileId, 'c'.repeat(64)],
  );

  // 0020: export_job이 tenant_id를 직접 들고(워커 디스패치 근거), 종단 상태는
  // 결과 파일·검증 보고서·완료시각을 모두 요구한다. 이 픽스처가 검증하려는
  // 것은 격리이므로 종단 상태를 흉내 내지 않고 QUEUED로 둔다 — 완료 상태의
  // 상관식은 export 전용 테스트(export-surface)가 다룬다.
  const exportJob = await c.query(
    `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
     VALUES ($1, $2, $3, 'HWPX', 'QUEUED', $4) RETURNING export_id`,
    [base.tenantId, documentId, revisionId, base.userId],
  );
  const exportId = exportJob.rows[0].export_id as string;

  const reportOnDocument = await c.query(
    `INSERT INTO validation_report
       (target_type, target_id, track, status, checks_json, environment_json)
     VALUES ('DOCUMENT', $1, 'A_AUTO', 'PASS', '[]', '{}') RETURNING validation_report_id`,
    [documentId],
  );
  const reportOnExport = await c.query(
    `INSERT INTO validation_report
       (target_type, target_id, track, status, checks_json, environment_json)
     VALUES ('EXPORT', $1, 'A_AUTO', 'PASS', '[]', '{}') RETURNING validation_report_id`,
    [exportId],
  );

  return {
    ...base,
    documentId,
    revisionId,
    blockId: block.rows[0].block_id as string,
    changeSetId,
    operationId: operation.rows[0].operation_id as string,
    templateProfileId,
    prototypeId: prototype.rows[0].prototype_id as string,
    exportId,
    reportOnDocumentId: reportOnDocument.rows[0].validation_report_id as string,
    reportOnExportId: reportOnExport.rows[0].validation_report_id as string,
  };
}

describe.skipIf(!ADMIN_URL)('document child-table tenant RLS (CC-150, migration 0018)', () => {
  let db: { name: string; url: string };
  let fxA: DocFixture;
  let fxB: DocFixture;
  /** EXPLAIN 케이스가 쓰는, 리비전이 많은 테넌트 A 문서. */
  let bulkDocumentId: string;
  let bulkRevisionId: string;

  beforeAll(async () => {
    db = await createTestDb('cc150_doc_rls');
    await migrate(db.url);
    await withClient(db.url, async (c) => {
      fxA = await insertDocFixture(c, 'cc150-a');
      fxB = await insertDocFixture(c, 'cc150-b');

      // 부피가 없으면 플래너는 어떤 계획에서도 순차 스캔을 고르고 EXPLAIN
      // 단언이 아무것도 증명하지 못한다(0016 케이스와 같은 이유).
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
      // export_job / validation_report에도 부피를 준다. 0020이 두 테이블에
      // 인덱스를 더했는데 행이 2건뿐이면 플래너는 언제나 순차 스캔을 고르고
      // "부모를 순차 스캔하지 않는다"는 단언이 아무것도 증명하지 못한다
      // (이 파일이 document/revision/block에 이미 적용한 원칙과 같다).
      await c.query(
        `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
         SELECT d.tenant_id, d.document_id, r.revision_id, 'HWPX', 'QUEUED', $1
         FROM document d
         JOIN document_revision r ON r.document_id = d.document_id
         WHERE d.title LIKE 'bulk %'`,
        [fxA.userId],
      );
      await c.query(
        `INSERT INTO validation_report
           (target_type, target_id, track, status, checks_json, environment_json)
         SELECT 'EXPORT', e.export_id, 'A_AUTO', 'PASS', '[]', '{}' FROM export_job e`,
      );

      await c.query('ANALYZE document');
      await c.query('ANALYZE document_revision');
      await c.query('ANALYZE document_block');
      await c.query('ANALYZE export_job');
      await c.query('ANALYZE validation_report');

      const bulk = await c.query(
        `SELECT document_id FROM document WHERE title = 'bulk 1' AND tenant_id = $1`,
        [fxA.tenantId],
      );
      bulkDocumentId = bulk.rows[0].document_id as string;
      const bulkRevision = await c.query(
        `SELECT revision_id FROM document_revision WHERE document_id = $1 ORDER BY revision_no LIMIT 1`,
        [bulkDocumentId],
      );
      bulkRevisionId = bulkRevision.rows[0].revision_id as string;
    });
  }, 180_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('enables and forces RLS with one tenant policy per document child table', async () => {
    const state = await withClient(db.url, (c) =>
      c.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT array_agg(p.policyname::text ORDER BY p.policyname)
                 FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
         FROM pg_class c
         WHERE c.relname = ANY($1) AND c.relkind = 'r'
         ORDER BY c.relname`,
        [[...DOC_CHILD_TABLES]],
      ),
    );
    expect(state.rows).toHaveLength(DOC_CHILD_TABLES.length);
    for (const row of state.rows) {
      expect(row.relrowsecurity, `${row.relname} RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} RLS forced`).toBe(true);
      // export_job은 0020(CC-160)에서 워커 디스패치 정책 둘을 더 받는다.
      // 0015 §7이 generation_job에 쓴 것과 같은 모델이며, 테넌트 정책은
      // 그대로 남아 있어야 한다(추가지 대체가 아니다).
      const expected =
        row.relname === 'export_job'
          ? ['p_export_job_tenant', 'p_export_job_worker_claim', 'p_export_job_worker_dispatch']
          : [`p_${row.relname}_tenant`];
      expect(row.policies, `${row.relname} policy`).toEqual(expected);
    }
  });

  it('shows a tenant only its own document child rows (une_app)', async () => {
    const visible = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => ({
      revisions: await c.query(
        `SELECT revision_id FROM document_revision WHERE revision_id = ANY($1)`,
        [[fxA.revisionId, fxB.revisionId]],
      ),
      blocks: await c.query(`SELECT block_id FROM document_block WHERE block_id = ANY($1)`, [
        [fxA.blockId, fxB.blockId],
      ]),
      changeSets: await c.query(
        `SELECT change_set_id FROM change_set WHERE change_set_id = ANY($1)`,
        [[fxA.changeSetId, fxB.changeSetId]],
      ),
      operations: await c.query(
        `SELECT operation_id FROM change_operation WHERE operation_id = ANY($1)`,
        [[fxA.operationId, fxB.operationId]],
      ),
      profiles: await c.query(
        `SELECT template_profile_id FROM template_profile WHERE template_profile_id = ANY($1)`,
        [[fxA.templateProfileId, fxB.templateProfileId]],
      ),
      prototypes: await c.query(
        `SELECT prototype_id FROM style_prototype WHERE prototype_id = ANY($1)`,
        [[fxA.prototypeId, fxB.prototypeId]],
      ),
      exports: await c.query(`SELECT export_id FROM export_job WHERE export_id = ANY($1)`, [
        [fxA.exportId, fxB.exportId],
      ]),
      reports: await c.query(
        `SELECT validation_report_id FROM validation_report WHERE validation_report_id = ANY($1)
         ORDER BY target_type`,
        [
          [
            fxA.reportOnDocumentId,
            fxA.reportOnExportId,
            fxB.reportOnDocumentId,
            fxB.reportOnExportId,
          ],
        ],
      ),
    }));
    expect(visible.revisions.rows.map((r) => r.revision_id)).toEqual([fxA.revisionId]);
    expect(visible.blocks.rows.map((r) => r.block_id)).toEqual([fxA.blockId]);
    expect(visible.changeSets.rows.map((r) => r.change_set_id)).toEqual([fxA.changeSetId]);
    expect(visible.operations.rows.map((r) => r.operation_id)).toEqual([fxA.operationId]);
    expect(visible.profiles.rows.map((r) => r.template_profile_id)).toEqual([
      fxA.templateProfileId,
    ]);
    expect(visible.prototypes.rows.map((r) => r.prototype_id)).toEqual([fxA.prototypeId]);
    expect(visible.exports.rows.map((r) => r.export_id)).toEqual([fxA.exportId]);
    // 다형 참조 두 분기(DOCUMENT/EXPORT)가 모두 자기 테넌트만 통과시킨다.
    expect(visible.reports.rows.map((r) => r.validation_report_id)).toEqual([
      fxA.reportOnDocumentId,
      fxA.reportOnExportId,
    ]);
  });

  it('hides another tenant document body on a direct id lookup (the leak this closes)', async () => {
    // 0018 이전에는 정책이 없어 이 세 질의가 타 테넌트의 문서 본문/편집 이력을
    // 그대로 반환했다. ir_json / text_content / before_json은 모두 본문이다.
    const leaked = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => ({
      ir: await c.query(`SELECT ir_json FROM document_revision WHERE revision_id = $1`, [
        fxB.revisionId,
      ]),
      text: await c.query(`SELECT text_content FROM document_block WHERE block_id = $1`, [
        fxB.blockId,
      ]),
      undo: await c.query(
        `SELECT before_json, after_json FROM change_operation WHERE operation_id = $1`,
        [fxB.operationId],
      ),
    }));
    expect(leaked.ir.rows).toHaveLength(0);
    expect(leaked.text.rows).toHaveLength(0);
    expect(leaked.undo.rows).toHaveLength(0);
  });

  it('returns no document child rows at all when app.tenant_id is unset (une_app)', async () => {
    const counts = await asRole(db.url, 'une_app', null, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM document_revision) AS revisions,
                (SELECT count(*)::int FROM document_block)    AS blocks,
                (SELECT count(*)::int FROM change_set)        AS change_sets,
                (SELECT count(*)::int FROM change_operation)  AS operations,
                (SELECT count(*)::int FROM template_profile)  AS profiles,
                (SELECT count(*)::int FROM style_prototype)   AS prototypes,
                (SELECT count(*)::int FROM export_job)        AS exports,
                (SELECT count(*)::int FROM validation_report) AS reports`,
      ),
    );
    expect(counts.rows[0]).toEqual({
      revisions: 0,
      blocks: 0,
      change_sets: 0,
      operations: 0,
      profiles: 0,
      prototypes: 0,
      exports: 0,
      reports: 0,
    });
  });

  it('proves the rows exist and only the policy hides them (superuser control)', async () => {
    // 대조군이 없으면 "0행"은 정책이 판정한 결과인지 데이터가 없는 것인지
    // 구분되지 않는다. superuser는 RLS를 우회한다.
    const counts = await withClient(db.url, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM document_revision WHERE revision_id = ANY($1)) AS revisions,
                (SELECT count(*)::int FROM document_block WHERE block_id = ANY($2))       AS blocks,
                (SELECT count(*)::int FROM change_operation WHERE operation_id = ANY($3)) AS operations,
                (SELECT count(*)::int FROM validation_report WHERE validation_report_id = ANY($4)) AS reports`,
        [
          [fxA.revisionId, fxB.revisionId],
          [fxA.blockId, fxB.blockId],
          [fxA.operationId, fxB.operationId],
          [fxA.reportOnDocumentId, fxB.reportOnExportId],
        ],
      ),
    );
    expect(counts.rows[0]).toEqual({ revisions: 2, blocks: 2, operations: 2, reports: 2 });
  });

  it('rejects cross-tenant writes through WITH CHECK (une_app)', async () => {
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      await expect(
        c.query(
          `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, created_by)
           VALUES ($1, 99, '{}', $2, $3)`,
          [fxB.documentId, 'e'.repeat(64), fxA.userId],
        ),
        'document_revision',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO document_block
             (revision_id, stable_block_key, block_type, sort_order, protection_state, payload_json)
           VALUES ($1, 'evil', 'PARAGRAPH', 9, 'NONE', '{}')`,
          [fxB.revisionId],
        ),
        'document_block',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO change_set
             (document_id, base_revision_id, client_mutation_id, selection_json, status, created_by)
           VALUES ($1, $2, 'evil', '{}', 'APPLIED', $3)`,
          [fxB.documentId, fxB.revisionId, fxA.userId],
        ),
        'change_set',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO change_operation
             (change_set_id, operation_order, operation_type, target_json)
           VALUES ($1, 9, 'INSERT_BLOCKS', '{}')`,
          [fxB.changeSetId],
        ),
        'change_operation',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO template_profile
             (document_id, profile_version, analysis_status, profile_json, unsupported_objects_json, analysis_hash)
           VALUES ($1, 9, 'LIMITED', '{}', '[]', $2)`,
          [fxB.documentId, 'f'.repeat(64)],
        ),
        'template_profile',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO style_prototype
             (template_profile_id, prototype_key, prototype_type, source_locator_json, clone_policy_json, style_fingerprint)
           VALUES ($1, 'evil', 'TITLE', '{}', '{}', $2)`,
          [fxB.templateProfileId, '0'.repeat(64)],
        ),
        'style_prototype',
      ).rejects.toThrow(/row-level security/);
      // 0020 이후 export_job은 tenant_id를 직접 든다. 위조 시도는 "내 테넌트
      // 값을 적고 남의 문서를 가리키는" 형태가 된다 — WITH CHECK의
      // EXISTS(document) 절이 그것을 막는다. tenant_id를 비우는 형태는 RLS가
      // 아니라 NOT NULL에 걸리므로 격리 검증이 되지 않는다.
      await expect(
        c.query(
          `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
           VALUES ($1, $2, $3, 'HWPX', 'QUEUED', $4)`,
          [fxA.tenantId, fxB.documentId, fxB.revisionId, fxA.userId],
        ),
        'export_job (내 테넌트 + 남의 문서)',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
           VALUES ($1, $2, $3, 'HWPX', 'QUEUED', $4)`,
          [fxB.tenantId, fxB.documentId, fxB.revisionId, fxA.userId],
        ),
        'export_job (남의 테넌트 값 직접 기재)',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO validation_report
             (target_type, target_id, track, status, checks_json, environment_json)
           VALUES ('DOCUMENT', $1, 'A_AUTO', 'PASS', '[]', '{}')`,
          [fxB.documentId],
        ),
        'validation_report/DOCUMENT',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO validation_report
             (target_type, target_id, track, status, checks_json, environment_json)
           VALUES ('EXPORT', $1, 'A_AUTO', 'PASS', '[]', '{}')`,
          [fxB.exportId],
        ),
        'validation_report/EXPORT',
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('blocks orphan child rows whose parent does not exist (une_app)', async () => {
    // 부모가 없으면 EXISTS는 거짓이다. FK는 DEFERRABLE INITIALLY DEFERRED라
    // COMMIT까지 판정을 미루지만, RLS의 WITH CHECK는 문장 시점에 즉시 막는다 —
    // 즉 "부모 없는 하위 행"은 FK 이전에 정책이 먼저 거부한다.
    const ghost = '00000000-0000-0000-0000-0000000000ff';
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      await expect(
        c.query(
          `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, created_by)
           VALUES ($1, 1, '{}', $2, $3)`,
          [ghost, '1'.repeat(64), fxA.userId],
        ),
        'orphan document_revision',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO document_block
             (revision_id, stable_block_key, block_type, sort_order, protection_state, payload_json)
           VALUES ($1, 'orphan', 'PARAGRAPH', 1, 'NONE', '{}')`,
          [ghost],
        ),
        'orphan document_block',
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO change_operation (change_set_id, operation_order, operation_type, target_json)
           VALUES ($1, 1, 'INSERT_BLOCKS', '{}')`,
          [ghost],
        ),
        'orphan change_operation',
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('rejects a validation_report target_type outside the vocabulary (0020이 닫았다)', async () => {
    // 0018 §8은 어휘 밖 target_type을 **정책**으로만 막았다(읽기 0행/쓰기 거부).
    // CC-160이 실제로 보고서를 쓰게 되면서 0020 §2가 어휘를 CHECK로 닫았고,
    // 이제 그런 행은 superuser로도 만들 수 없다 — 정책이 조용히 거짓이 되는
    // 행 자체가 존재하지 않는다. 방어는 약해진 것이 아니라 한 층 앞당겨졌다.
    await withClient(db.url, async (c) => {
      await expect(
        c.query(
          `INSERT INTO validation_report
             (target_type, target_id, track, status, checks_json, environment_json)
           VALUES ('SITUATION', $1, 'A_AUTO', 'PASS', '[]', '{}')`,
          [fxA.documentId],
        ),
      ).rejects.toThrow(/ck_validation_report_target_type/);
    });

    // 어휘 안의 값은 여전히 정책이 테넌트로 가른다(0018의 fail-closed 유지).
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      await expect(
        c.query(
          `INSERT INTO validation_report
             (target_type, target_id, track, status, checks_json, environment_json)
           VALUES ('DOCUMENT', $1, 'A_AUTO', 'PASS', '[]', '{}')`,
          [fxB.documentId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('lets a tenant read and write its own document aggregate (une_app happy path)', async () => {
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      const revision = await c.query(
        `INSERT INTO document_revision (document_id, revision_no, ir_json, ir_hash, created_by)
         VALUES ($1, 2, '{"edited":true}', $2, $3) RETURNING revision_id`,
        [fxA.documentId, '2'.repeat(64), fxA.userId],
      );
      const revisionId = revision.rows[0].revision_id as string;

      const block = await c.query(
        `INSERT INTO document_block
           (revision_id, stable_block_key, block_type, sort_order, text_content, protection_state, payload_json)
         VALUES ($1, 'b-2', 'PARAGRAPH', 2, '편집된 문단', 'USER_LOCKED', '{}') RETURNING block_id`,
        [revisionId],
      );
      expect(block.rows[0].block_id).toBeTruthy();

      const changeSet = await c.query(
        `INSERT INTO change_set
           (document_id, base_revision_id, result_revision_id, client_mutation_id, selection_json, status, created_by)
         VALUES ($1, $2, $3, 'cm-happy', '{}', 'APPLIED', $4) RETURNING change_set_id`,
        [fxA.documentId, fxA.revisionId, revisionId, fxA.userId],
      );
      const changeSetId = changeSet.rows[0].change_set_id as string;

      await c.query(
        `INSERT INTO change_operation
           (change_set_id, operation_order, operation_type, target_json, before_json, after_json)
         VALUES ($1, 1, 'INSERT_BLOCKS', '{}', '{"t":"전"}', '{"t":"후"}')`,
        [changeSetId],
      );

      // ChangeSet 상태 전이(UPDATE)와 Undo 경로가 정책 아래에서 계속 동작해야 한다.
      const updated = await c.query(
        `UPDATE change_set SET status = 'REJECTED' WHERE change_set_id = $1 RETURNING status`,
        [changeSetId],
      );
      expect(updated.rows[0].status).toBe('REJECTED');

      const ops = await c.query(
        `SELECT count(*)::int AS n FROM change_operation WHERE change_set_id = $1`,
        [changeSetId],
      );
      expect(ops.rows[0].n).toBe(1);
    });
  });

  it('cannot update or delete another tenant rows even with the row id (une_app)', async () => {
    // USING이 UPDATE/DELETE 대상 선택도 막으므로 "0행 영향"이 되어야 한다.
    const affected = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => ({
      updated: await c.query(
        `UPDATE document_revision SET change_summary = '탈취' WHERE revision_id = $1`,
        [fxB.revisionId],
      ),
      deleted: await c.query(`DELETE FROM document_block WHERE block_id = $1`, [fxB.blockId]),
    }));
    expect(affected.updated.rowCount).toBe(0);
    expect(affected.deleted.rowCount).toBe(0);

    const survived = await withClient(db.url, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM document_block WHERE block_id = $1) AS blocks,
                (SELECT count(*)::int FROM document_revision
                  WHERE revision_id = $2 AND change_summary IS NULL) AS untouched`,
        [fxB.blockId, fxB.revisionId],
      ),
    );
    expect(survived.rows[0]).toEqual({ blocks: 1, untouched: 1 });
  });

  it('gives une_worker only the Export-path privileges on the document child tables', async () => {
    // 0011의 ALL TABLES GRANT는 une_app 전용이고 0015 §6은 une_worker에
    // 테이블별 최소권한만 준다. 0020(CC-160)이 Export 러너에게 딱 두 테이블을
    // 열었다: export_job은 claim/settle이라 SELECT+UPDATE, validation_report는
    // 감사 증거라 SELECT+INSERT뿐이다(UPDATE/DELETE 없음). 나머지 여섯은
    // 여전히 0건이어야 한다 — 일괄 GRANT 재도입 방지.
    const grants = await withClient(db.url, (c) =>
      c.query(
        `SELECT table_name, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.role_table_grants
         WHERE grantee = 'une_worker' AND table_name = ANY($1)
         GROUP BY table_name ORDER BY table_name`,
        [[...DOC_CHILD_TABLES]],
      ),
    );
    expect(grants.rows).toEqual([
      // 대상 리비전의 IR을 읽어야 되쓰기를 할 수 있다. 읽기뿐이다.
      { table_name: 'document_revision', privs: 'SELECT' },
      { table_name: 'export_job', privs: 'SELECT,UPDATE' },
      // 호환성 판정은 저장 차단 집행의 입력이다(ADR-29 D11). 읽기뿐이다.
      { table_name: 'template_profile', privs: 'SELECT' },
      { table_name: 'validation_report', privs: 'INSERT,SELECT' },
    ]);
  });

  it('blocks une_worker before RLS with a privilege error on these tables', async () => {
    await asRole(db.url, 'une_worker', fxA.tenantId, async (c) => {
      // 0020이 Export 러너에게 연 것은 document_revision(읽기)·export_job·
      // validation_report뿐이다. 편집 표면은 워커의 일이 아니므로 여전히
      // RLS 이전에 권한 오류로 막힌다.
      await expect(c.query(`SELECT count(*) FROM document_block`)).rejects.toThrow(
        /permission denied for table document_block/,
      );
      await expect(c.query(`SELECT count(*) FROM change_operation`)).rejects.toThrow(
        /permission denied for table change_operation/,
      );
      await expect(c.query(`SELECT count(*) FROM change_set`)).rejects.toThrow(
        /permission denied for table change_set/,
      );
      // 읽기를 준 테이블에도 쓰기는 없다 — 최소권한이 방향까지 좁힌다.
      await expect(
        c.query(`UPDATE document_revision SET revision_no = revision_no WHERE false`),
      ).rejects.toThrow(/permission denied for table document_revision/);
    });
  });

  it('keeps une_app privileges on the document child tables unchanged (no over-locking)', async () => {
    // 0018은 격리(어느 행에)만 닫고 권한(무엇을)은 건드리지 않는다. CC-150의
    // Undo/restore와 ChangeSet 상태 전이가 필요로 하는 DML이 그대로 남아야 한다.
    const grants = await withClient(db.url, (c) =>
      c.query(
        `SELECT table_name, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
         FROM information_schema.role_table_grants
         WHERE grantee = 'une_app' AND table_name = ANY($1)
         GROUP BY table_name ORDER BY table_name`,
        [[...DOC_CHILD_TABLES]],
      ),
    );
    expect(grants.rows).toHaveLength(DOC_CHILD_TABLES.length);
    for (const row of grants.rows) {
      // 0020 §3: validation_report는 append-only가 됐다. 검증 보고서는
      // 산출물이 어떤 근거로 나갔는지를 말하는 감사 증거이고, 재검증은 새
      // 보고서이지 과거 판정의 덮어쓰기가 아니다.
      const expected =
        row.table_name === 'validation_report' ? 'INSERT,SELECT' : 'DELETE,INSERT,SELECT,UPDATE';
      expect(row.privs, `${row.table_name} privileges`).toBe(expected);
    }
  });

  it('keeps the revision lookup on uk_document_revision_no under RLS (EXPLAIN)', async () => {
    // 0016과 같은 회귀 핀: 새 정책이 대표 조회를 순차 스캔으로 떨어뜨리면 안 된다.
    // 최신 Revision 조회는 ETag/버전 충돌 판정(CC-150 수용기준)의 기본 경로다.
    const plan = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      const res = await c.query(
        `EXPLAIN SELECT revision_id, revision_no, ir_hash FROM document_revision
         WHERE document_id = $1 ORDER BY revision_no DESC LIMIT 1`,
        [bulkDocumentId],
      );
      return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
    });
    expect(plan, plan).toMatch(/Index Scan[^\n]*uk_document_revision_no/);
    expect(plan, plan).not.toMatch(/Seq Scan on document_revision/);
    // 정책의 부모 조회도 순차 스캔이 아니어야 한다 — document는 tenant_id
    // 인덱스(ix_plan_tenant_status_updated 계열이 아닌 document 자체)로 걸러지며,
    // 어떤 경우에도 부모를 행마다 다시 읽지 않는다(hashed SubPlan).
    expect(plan, plan).toMatch(/hashed SubPlan/);
  });

  it('resolves every child policy through a parent primary key, never a parent scan (EXPLAIN)', async () => {
    // 2단 정책(document_block/change_operation/style_prototype)이 부모를
    // PK로 찾는지 고정한다. 여기가 무너지면 자식 1행마다 부모 전수 스캔이 된다.
    const explain = (sql: string, params: unknown[]): Promise<string> =>
      asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        const res = await c.query(`EXPLAIN ${sql}`, params);
        return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
      });

    const blocks = await explain(
      `SELECT block_id, sort_order FROM document_block WHERE revision_id = $1 ORDER BY sort_order`,
      [bulkRevisionId],
    );
    expect(blocks, blocks).toMatch(/Index Scan using document_revision_pkey/);
    expect(blocks, blocks).not.toMatch(/Seq Scan on document_revision/);

    const operations = await explain(
      `SELECT operation_id FROM change_operation WHERE change_set_id = $1 ORDER BY operation_order`,
      [fxA.changeSetId],
    );
    expect(operations, operations).toMatch(/Index Scan using change_set_pkey/);
    expect(operations, operations).not.toMatch(/Seq Scan on change_set/);

    const prototypes = await explain(
      `SELECT prototype_id FROM style_prototype WHERE template_profile_id = $1`,
      [fxA.templateProfileId],
    );
    expect(prototypes, prototypes).toMatch(/Index Scan using template_profile_pkey/);
    expect(prototypes, prototypes).not.toMatch(/Seq Scan on template_profile/);

    const reports = await explain(
      `SELECT validation_report_id FROM validation_report WHERE target_type = 'EXPORT' AND target_id = $1`,
      [fxA.exportId],
    );
    // 0020이 (target_type, target_id, created_at DESC)와 export_job(document_id)
    // 인덱스를 더하면서 계획이 바뀌었다. 지키려는 불변식은 인덱스 **이름**이나
    // 스캔 **종류**가 아니라 두 가지다: 보고서를 대상에서 되찾을 때 새 인덱스가
    // 쓰이고, 정책의 EXPORT 분기가 export_job을 훑지 않는다.
    //
    // `document`에 대해서는 단언하지 않는다 — 이 픽스처의 document는 21행이라
    // 순차 스캔이 옳은 계획이고, 그것을 금지하면 플래너의 정상 동작을 회귀로
    // 신고하게 된다.
    expect(reports, reports).toMatch(/ix_validation_report_target/);
    expect(reports, reports).not.toMatch(/Seq Scan on export_job/);
    expect(reports, reports).not.toMatch(/Seq Scan on validation_report/);
  });

  it('does not change the child access path compared to the RLS-bypassed baseline (EXPLAIN)', async () => {
    // 0018이 "접근 경로를 바꾸지 않는다"는 주장을 그대로 검증한다. superuser는
    // RLS를 우회하므로 그 계획이 곧 정책 도입 전 계획이다. 비교 대상은 자식
    // 스캔 노드의 **형태**(노드 종류 + 인덱스 + 테이블)다. 비용/행수 추정치는
    // 정책 술어가 추가되면 당연히 달라지므로 제외한다 — 그 차이는 접근 경로의
    // 변화가 아니라 선택도 추정의 변화다.
    const topScan = (plan: string, table: string): string => {
      const line = plan.split('\n').find((l) => l.includes(`on ${table}`));
      return (line ?? '')
        .trim()
        .replace(/^->\s*/, '')
        .replace(/\s*\(cost=.*$/, '');
    };
    const query = `SELECT revision_id, revision_no FROM document_revision
                   WHERE document_id = $1 ORDER BY revision_no DESC LIMIT 1`;

    const baseline = await withClient(db.url, async (c) => {
      const res = await c.query(`EXPLAIN ${query}`, [bulkDocumentId]);
      return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
    });
    const underRls = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      const res = await c.query(`EXPLAIN ${query}`, [bulkDocumentId]);
      return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
    });

    expect(topScan(underRls, 'document_revision')).toBe(topScan(baseline, 'document_revision'));
  });
});
