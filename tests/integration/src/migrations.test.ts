import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_URL,
  APPEND_ONLY_TABLES,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
} from './db-helpers';

const RLS_TABLES = [
  'tenant',
  'organization',
  'app_user',
  'role',
  'plan',
  'generation_job',
  'document',
  'file_object',
  'situation',
  'knowledge_document',
  'sop',
  'execution_event',
  'outbox_message',
  'provider_config',
  'audit_log',
  'retention_policy',
  'notification',
  'api_idempotency',
  // 0016 (CC-125): tenant_id-less child tables isolated through EXISTS(parent).
  'job_event',
  'toc_version',
  'toc_node',
  'plan_context_snapshot',
  // 0017 (CC-130): generation staging, isolated through EXISTS(plan) as well.
  'generated_block',
  // 0018 (CC-150 선행조건, ADR-29 D9): 문서 계열 하위 테이블, EXISTS(document).
  'document_revision',
  'document_block',
  'change_set',
  'change_operation',
  'template_profile',
  'style_prototype',
  'export_job',
  'validation_report',
  // 0019 (CC-150): 자동저장 명령 저널. 0018과 같은 EXISTS(document) 패턴.
  'document_autosave',
  // 0023 (CC-200, ADR-33 D3): 상황 계열. fact_source/provider_job은 부모
  // 애그리거트가 없거나(전자) situation_id가 nullable이라(후자) tenant_id를
  // 직접 갖고, 나머지는 EXISTS(situation) 또는 2단 조인이다.
  'fact_source',
  'situation_fact',
  'fact_conflict',
  'conflict_resolution',
  'situation_snapshot',
  'provider_job',
  'provider_result',
  // 0025 (CC-210): 중복군은 계산 결과지만 어느 상황의 것인지가 곧 테넌트다.
  'fact_duplicate_group',
  // 0031 (CC-230): 0004부터 정책이 한 번도 없었다 — 0011의 일괄 GRANT 때문에
  // 정책 없는 테이블은 전 테넌트 공개였고, CC-230이 첫 쓰기 경로를 연다.
  'evidence_set',
  'evidence_item',
  // 0032 (CC-240): 0008이 `sop`에만 정책을 걸어 자식 셋이 열려 있었다.
  'sop_version',
  'sop_node',
  'sop_edge',
];

describe.skipIf(!ADMIN_URL)('empty-database migration (CC-004)', () => {
  let db: { name: string; url: string };

  beforeAll(async () => {
    db = await createTestDb('cc004_empty');
    await migrate(db.url);
  }, 120_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('applies all 36 baseline migrations', async () => {
    const applied = await withClient(db.url, (c) =>
      c.query('SELECT name FROM pgmigrations ORDER BY id'),
    );
    expect(applied.rows).toHaveLength(36);
    expect(applied.rows[0].name).toBe('0001_extensions_and_common');
    expect(applied.rows[10].name).toBe('0011_force_rls_and_app_role_grants');
    expect(applied.rows[11].name).toBe('0012_rbac_catalog');
    expect(applied.rows[12].name).toBe('0013_iam_hardening');
    expect(applied.rows[13].name).toBe('0014_api_idempotency');
    expect(applied.rows[14].name).toBe('0015_generation_job_worker_and_toc');
    expect(applied.rows[15].name).toBe('0016_child_table_rls');
    expect(applied.rows[16].name).toBe('0017_generated_block');
    expect(applied.rows[17].name).toBe('0018_document_child_table_rls');
    expect(applied.rows[18].name).toBe('0019_document_edit_surface');
    expect(applied.rows[19].name).toBe('0020_export_and_validation');
    expect(applied.rows[20].name).toBe('0021_export_lease_and_file_immutability');
    expect(applied.rows[21].name).toBe('0022_upload_state_and_plan_document_link');
    expect(applied.rows[22].name).toBe('0023_situation_fact_ingestion');
    // 0024 (CC-200): 0023이 situation/situation_fact에 updated_at을 추가하면서
    // 이 저장소의 관례인 trg_*_updated_at 트리거를 빠뜨렸다. 컬럼만 있고
    // 트리거가 없으면 '마지막 수정 시각'이 INSERT 시각에 고정된다.
    expect(applied.rows[23].name).toBe('0024_situation_updated_at_triggers');
    // 0025 (CC-210): 중복군 테이블 신설(62→63), 파생 Fact 계보, 충돌·해소·
    // Snapshot의 어휘/불변/버전 제약.
    expect(applied.rows[24].name).toBe('0025_duplicate_conflict_and_snapshot');
    // 0026 (OB-16 종결): provider 원문·요청조건의 보존기간. 테이블은 늘지
    // 않는다(63 유지) — 컬럼·전용 롤·정책만 추가한다.
    expect(applied.rows[25].name).toBe('0026_situation_payload_retention');
    // 0027: 0026의 CHECK가 한 방향만 막아 원문 위조와 표식 삭제가 통과했다.
    // 허용 전이를 트리거로 하나만 남긴다. 테이블·롤·권한 변화 없음.
    expect(applied.rows[26].name).toBe('0027_payload_redaction_transition_guard');
    // 0028 (CC-220): knowledge_document에 어휘·상관식·FK를 세우고(0004는 제약이
    // 하나도 없었다) provider_job에 QUEUED/RUNNING을 연다 — 0023 §4가 "비동기로
    // 옮길 때 함께 온다"고 예고한 그 마이그레이션이다. 테이블은 늘지 않는다.
    expect(applied.rows[27].name).toBe('0028_knowledge_document_uni_lifecycle');
    // 0029 (CC-220): 0027의 트리거가 provider_job의 **모든** UPDATE를 막아
    // 워커의 상태 전이까지 42501이었다. 규칙을 페이로드·표식 컬럼으로 좁힌다.
    expect(applied.rows[28].name).toBe('0029_redaction_guard_allows_lifecycle');
    // 0030 (CC-220 검토 반영): 0028의 테이블 단위 UPDATE가 워커에게 마스킹
    // 컬럼과 종결 잡까지 열어 줬다(실측). 컬럼 GRANT + 제한 정책으로 좁힌다.
    expect(applied.rows[29].name).toBe('0030_worker_column_grants_and_open_job_guard');
    // 0031 (CC-230): evidence_set/evidence_item에 어휘·상관식·FK를 세우고
    // **정책이 한 번도 없던 두 테이블에 RLS를 켠다** — 0023이 상황 계열에서
    // 발견한 것과 같은 상태였다. 테이블은 늘지 않는다.
    expect(applied.rows[30].name).toBe('0031_evidence_set_and_items');
    // 0032 (CC-240): SOP 네 테이블의 어휘·상관식·FK. `sop_version`·`sop_node`·
    // `sop_edge`에 **RLS 정책이 한 번도 없었다** — 0008은 `sop`에만 걸었다.
    // 0023(상황)·0031(근거)에 이어 세 번째로 같은 것을 발견했다.
    expect(applied.rows[31].name).toBe('0032_sop_graph_and_generation');
  });

  // 61 = 57 design tables + role_permission (ADR-22) + api_idempotency (ADR-23)
  // + generated_block (ADR-27) + document_autosave (0019). 0018 adds policies
  // only, no tables. Neither generated_block nor document_autosave is a new
  // requirement: for both, design 10's API table, its sequence "DB Write" lists,
  // the §7 UFR trace table and the OpenAPI x-db-tables all name the table, while
  // §6's DDL table omits its columns — the same ADR-21 baseline defect class
  // already resolved for plan and generation_job. document_autosave is named by
  // UNE-DOC-009 (design 10 §3.4) and by une_doc_009's x-db-tables.
  // 62 = 61 + provider_result (0023/CC-200). 계약(UNE-SIT-006 x-db-tables)이
  // 이미 이름을 쓰고 있었고, 원문 페이로드 보존은 CLAUDE.md 비협상 규칙이라
  // 이름을 실체화하는 쪽이 맞다(ADR-33 D4 — malware_scan과 결론이 반대인 이유).
  // 63 = 62 + fact_duplicate_group (0025/CC-210). 계약 UNE-SIT-009의
  // x-db-tables가 이 이름을 가리키는데 존재한 적이 없었다 — provider_result와
  // 같은 유형이고 같은 결론이다(ADR-34 D1).
  // 65 = 63 + sop_review_request + sop_approval (0035/CC-250). 설계 10은
  // `review_request`·`approval`을 세 도메인이 공유하는 이름으로 쓰지만 컬럼
  // 수준 물리 설계가 없다 — 도메인 전용으로 실현했다(ADR-39). `generation_job`
  // 공용성이 CC-240에서 실제 권한 사고를 냈고, 전용 테이블은 FK를 걸 수 있고
  // RLS가 부모 조인 하나로 끝난다.
  it('creates the 65-table baseline (+ sop_review_request, sop_approval)', async () => {
    const tables = await withClient(db.url, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
           AND table_name <> 'pgmigrations'`,
      ),
    );
    expect(tables.rows[0].n).toBe(65);
  });

  it('enables and forces RLS on all tenant-isolated tables', async () => {
    const flags = await withClient(db.url, (c) =>
      c.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class
         WHERE relname = ANY($1) AND relkind = 'r'`,
        [RLS_TABLES],
      ),
    );
    expect(flags.rows).toHaveLength(RLS_TABLES.length);
    for (const row of flags.rows) {
      expect(row.relrowsecurity, `${row.relname} RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} RLS forced`).toBe(true);
    }
  });

  it('provides une_app as a non-superuser, non-bypassrls role', async () => {
    const role = await withClient(db.url, (c) =>
      c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'une_app'`),
    );
    expect(role.rows).toHaveLength(1);
    expect(role.rows[0].rolsuper).toBe(false);
    expect(role.rows[0].rolbypassrls).toBe(false);
  });

  it('denies une_app UPDATE/DELETE on append-only and immutable tables', async () => {
    const privs = await withClient(db.url, (c) =>
      c.query(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'une_app'
           AND table_name = ANY($1)
           AND privilege_type IN ('UPDATE', 'DELETE')`,
        [APPEND_ONLY_TABLES],
      ),
    );
    expect(privs.rows).toHaveLength(0);
  });

  it('gives une_app zero privileges on the migration-history table', async () => {
    const privs = await withClient(db.url, (c) =>
      c.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'une_app' AND table_name = 'pgmigrations'`,
      ),
    );
    expect(privs.rows).toHaveLength(0);
  });

  it('enforces the outbox idempotency unique key (idempotency_key, channel)', async () => {
    const idx = await withClient(db.url, (c) =>
      c.query(
        `SELECT indexdef FROM pg_indexes
         WHERE tablename = 'outbox_message' AND indexname = 'uk_outbox_idem'`,
      ),
    );
    expect(idx.rows).toHaveLength(1);
    expect(idx.rows[0].indexdef).toContain('UNIQUE');
  });
});

describe.skipIf(!ADMIN_URL)('upgrade migration on fixture data (CC-004)', () => {
  let db: { name: string; url: string };

  beforeAll(async () => {
    db = await createTestDb('cc004_upgrade');
  }, 120_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('upgrades a populated 0010-level database to 0036 without data loss', async () => {
    await migrate(db.url, 10);
    const fixture = await withClient(db.url, (c) => insertFixture(c, 'upg'));

    await migrate(db.url); // remaining: 0011 ~ 0036

    const rows = await withClient(db.url, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM tenant) AS tenants,
                (SELECT count(*)::int FROM situation) AS situations,
                (SELECT count(*)::int FROM dispatch) AS dispatches,
                (SELECT relforcerowsecurity FROM pg_class WHERE relname = 'tenant') AS forced`,
      ),
    );
    expect(rows.rows[0]).toEqual({ tenants: 1, situations: 1, dispatches: 1, forced: true });

    const applied = await withClient(db.url, (c) =>
      c.query('SELECT count(*)::int AS n FROM pgmigrations'),
    );
    expect(applied.rows[0].n).toBe(36);
    expect(fixture.tenantId).toBeTruthy();
  }, 120_000);
});
