-- 0018_document_child_table_rls.sql (CC-150 차단성 선행조건) — ADR-29 D9 종결.
--
-- 왜 지금 닫는가. 0008/0011/0016을 전수 확인하면 RLS가 켜진 문서 계열 테이블은
-- `document`와 `file_object` 둘뿐이다. 0003이 만드는 document_revision /
-- document_block / change_set / change_operation / template_profile /
-- style_prototype / export_job / validation_report 여덟 테이블은 tenant_id
-- 컬럼도 없고 RLS가 **한 번도 켜진 적이 없다**. 반면 0011은 une_app에
-- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`을
-- 일괄 부여한다 — 즉 정책 없는 테이블 = 전 테넌트 전면 공개다. 지금까지는
-- 이 여덟 테이블에 닿는 쿼리 경로가 없어 잠복 상태였지만, CC-150(Revision /
-- ChangeSet / autosave / diff / conflict)이 **첫 쓰기 경로를 여는 순간**
-- .claude/rules/security.md의 "모든 repository/query 경로에서 테넌트 격리
-- 강제"가 깨진다. 0016이 계획서/Job 계열 네 테이블에 대해 닫은 것과 동일한
-- 문제이며, 0016 §5가 "각 도메인 Work Item에서 같은 EXISTS(부모) 패턴으로
-- 닫는다"고 예고한 그 후속이다.
--
-- 방식(0016 패턴 그대로). tenant_id 컬럼을 추가하지 않는다 — 비정규화 사본은
-- 부모와 어긋날 수 있고, 어긋난 사본은 격리를 강화하는 대신 약화시킨다.
-- 대신 부모 애그리거트(document)까지 EXISTS로 조인하는 정책을 쓴다. 2단
-- 이상인 테이블도 중간 테이블의 정책에 의존하지 않고 document까지 **스스로**
-- 조인해 테넌트를 증명한다. 정책식 안의 참조 테이블에도 RLS가 적용되므로
-- 보호는 이중이고, 명시적인 `tenant_id = une_current_tenant_id()` 술어를 함께
-- 남겨 부모 정책이 향후 완화되더라도 하위 테이블이 새지 않게 한다. 모든
-- 정책은 PERMISSIVE / TO PUBLIC / FOR ALL이며 ENABLE + FORCE를 함께 건다
-- (테이블 소유자도 우회하지 못한다).
--
-- 부모 경로(0007/0003의 실제 FK로 확정).
--   document_revision.document_id            -> document                (1단)
--   document_block.revision_id               -> document_revision -> document (2단)
--   change_set.document_id                   -> document                (1단)
--   change_operation.change_set_id           -> change_set -> document  (2단)
--   template_profile.document_id             -> document                (1단)
--   style_prototype.template_profile_id      -> template_profile -> document (2단)
--   export_job.document_id                   -> document                (1단)
--   validation_report.target_type/target_id  -> document | export_job -> document
--                                               (FK 없는 다형 참조 — 아래 §8)
--
-- 역할 영향.
--   * une_app: 정책이 걸리기 전과 후로 "무엇을 할 수 있나"(권한)는 그대로다.
--     "어느 행에 할 수 있나"만 자기 테넌트의 document 하위로 좁혀진다.
--     CC-150이 열 CRUD 경로는 전부 테넌트 스코프 트랜잭션이므로 회귀가 없다.
--   * une_worker: 이 여덟 테이블에 **권한이 아예 없다**(0011의 ALL TABLES
--     GRANT는 une_app 전용이고, 0015 §6은 une_worker에 테이블별 최소권한만
--     준다 — 실측 확인). 따라서 좁힐 권한이 없으며, 워커가 이 테이블에
--     닿으면 RLS 이전에 42501로 막힌다. 이 상태 자체를 회귀 단언으로 고정한다
--     (tests/integration/src/document-child-table-rls.test.ts).
--   * 디스패치 스코프(une_current_tenant_id() IS NULL)에서는 모든 정책식이
--     항상 거짓이라 0행/쓰기 거부다 — 회귀가 아니라 목표 상태다.
--
-- 인덱스. **신규 인덱스 없음.** 모든 정책의 EXISTS는 부모의 PK 또는 기존
--   유니크 인덱스를 탄다(document_pkey, document_revision_pkey,
--   change_set_pkey, template_profile_pkey, export_job_pkey,
--   uk_document_revision_no). 1단 정책(document_revision / change_set /
--   template_profile / export_job)은 `hashed SubPlan`(테넌트의 document_id
--   집합)으로 쿼리당 한 번만 평가되고, 2단 정책(document_block /
--   change_operation / style_prototype)은 부모 PK 상관 서브플랜으로 평가된다.
--   어느 쪽도 부모를 순차 스캔하지 않는다. 자식 쪽 접근 경로는 정책 적용
--   전(superuser = RLS 우회)과 후(une_app)가 동일하다 — 이 마이그레이션은
--   어떤 조회의 계획 형태도 바꾸지 않는다.
--
-- 실측과 그로부터 나온 CC-150 요구사항(중요). PostgreSQL 16.9,
--   document 80 / document_revision 2,000 / document_block 80,000 /
--   change_set 800 / change_operation 4,000 규모, EXPLAIN (ANALYZE, TIMING OFF):
--     * `SELECT ... FROM document_revision WHERE document_id=$1
--        ORDER BY revision_no DESC LIMIT 1`
--       -> Index Scan Backward using uk_document_revision_no (정책은 hashed
--          SubPlan). RLS 적용 전후 동일 계획.
--     * `SELECT * FROM document_block WHERE revision_id=$1 ORDER BY sort_order`
--       -> 양쪽 모두 Seq Scan(자식 인덱스가 애초에 없다). 다만 실행시간은
--          RLS 우회 3.0~3.7 ms 대 RLS 적용 87~139 ms로 약 30배다. 서브플랜이
--          `never executed`인 조건(일치 행 0건)에서도 동일하게 재현되므로,
--          이 비용은 부모 조회가 아니라 **SubPlan을 포함한 qual을 8만 행에
--          대해 평가하는 것 자체**다. 같은 질의에 (revision_id, sort_order)
--          인덱스를 임시로 만들면 Bitmap Index Scan으로 바뀌며 0.45 ms가 된다.
--   결론: RLS는 "인덱스 없는 자식 테이블 전수 스캔"의 비용을 30배로 만든다.
--   따라서 document_block.revision_id / change_set.document_id /
--   change_operation.change_set_id의 조회 인덱스는 **CC-150에서 선택이 아니라
--   필수**다(설계 §6.19~6.21이 "기본 FK Index … 실제 Query Plan으로 확정"으로
--   유보한 항목 — 위가 그 Query Plan이다). 여기서 만들지 않는 이유는 이
--   테이블들이 아직 비어 있고 쿼리 경로가 없으며, CC-150이 반드시 추가해야
--   하는 키(문서별 stable_block_key 유일성, change_set의 client_mutation_id
--   멱등 UK)의 **선두 컬럼이 정확히 이 FK 컬럼들**이어서, 지금 만든 평범한
--   인덱스는 곧 중복이 되기 때문이다. 유일성 의미를 정하는 것은 상태기계를
--   손에 쥔 CC-150의 몫이고, 이 마이그레이션은 격리만 닫는다.
--
-- 권한. 이 마이그레이션은 DML 권한을 바꾸지 않는다. append-only 후보
--   (document_revision, change_operation)에 REVOKE UPDATE, DELETE를 거는 안을
--   검토했으나, CC-150의 Undo/restore와 ChangeSet 상태 전이(change_set.status,
--   result_revision_id는 생성 후 갱신된다) 설계가 확정되기 전에 잠그면 다음
--   Work Item을 막는다. 권한(무엇을) 결정은 상태기계를 손에 쥔 CC-150 본
--   마이그레이션에 남기고, 여기서는 격리(어느 행에)만 닫는다. 0011/0015가
--   이미 건 append-only REVOKE(execution_event, audit_log, task_event,
--   plan_context_snapshot, situation_snapshot, job_event)는 그대로다.

-- ---------------------------------------------------------------------------
-- 1. document_revision -> document
-- ---------------------------------------------------------------------------
-- 편집 문서 IR(ir_json) 전문의 저장소. 부모 document의 tenant_id가 유일한
-- 테넌트 근거다.
ALTER TABLE document_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_revision FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_document_revision_tenant ON document_revision;
CREATE POLICY p_document_revision_tenant ON document_revision
  USING (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = document_revision.document_id
      AND d.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = document_revision.document_id
      AND d.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 2. document_block -> document_revision -> document (2단 조인)
-- ---------------------------------------------------------------------------
-- document_block은 document를 직접 참조하지 않는다(0007
-- fk_document_block_revision_id). document_revision을 거쳐 document까지
-- 명시적으로 조인한다 — 중간 테이블의 정책이 아니라 자기 정책식으로 테넌트를
-- 증명한다(0016 §4 toc_node와 동형).
ALTER TABLE document_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_block FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_document_block_tenant ON document_block;
CREATE POLICY p_document_block_tenant ON document_block
  USING (EXISTS (
    SELECT 1 FROM document_revision r
    JOIN document d ON d.document_id = r.document_id
    WHERE r.revision_id = document_block.revision_id
      AND d.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM document_revision r
    JOIN document d ON d.document_id = r.document_id
    WHERE r.revision_id = document_block.revision_id
      AND d.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 3. change_set -> document
-- ---------------------------------------------------------------------------
-- selection_json/client_mutation_id는 사용자의 편집 의도와 멱등키를 담는다.
-- base_revision_id도 FK로 걸려 있지만 테넌트 근거는 document_id 하나로 충분하고
-- (두 경로가 다른 테넌트일 수는 없다 — §1 정책이 revision을 이미 문서에 묶는다)
-- 정책식은 짧을수록 계획이 안정적이다.
ALTER TABLE change_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_set FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_change_set_tenant ON change_set;
CREATE POLICY p_change_set_tenant ON change_set
  USING (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = change_set.document_id
      AND d.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = change_set.document_id
      AND d.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 4. change_operation -> change_set -> document (2단 조인)
-- ---------------------------------------------------------------------------
-- before_json/after_json은 문서 본문 조각을 그대로 담는 감사 근거다. Undo가
-- 이 값을 되돌리므로, 타 테넌트가 읽을 수 있으면 본문 유출과 동치다.
ALTER TABLE change_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_operation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_change_operation_tenant ON change_operation;
CREATE POLICY p_change_operation_tenant ON change_operation
  USING (EXISTS (
    SELECT 1 FROM change_set cs
    JOIN document d ON d.document_id = cs.document_id
    WHERE cs.change_set_id = change_operation.change_set_id
      AND d.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM change_set cs
    JOIN document d ON d.document_id = cs.document_id
    WHERE cs.change_set_id = change_operation.change_set_id
      AND d.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 5. template_profile -> document
-- ---------------------------------------------------------------------------
-- CC-140 HWPX 분석 결과(섹션/스타일/미지원 객체 목록). 기관이 올린 원본 서식의
-- 구조가 그대로 드러나므로 문서 본문과 같은 등급으로 격리한다.
ALTER TABLE template_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_profile FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_template_profile_tenant ON template_profile;
CREATE POLICY p_template_profile_tenant ON template_profile
  USING (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = template_profile.document_id
      AND d.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = template_profile.document_id
      AND d.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 6. style_prototype -> template_profile -> document (2단 조인)
-- ---------------------------------------------------------------------------
-- 설계 §6.23 doc_prototype_registry의 구현 이름(이름 드리프트는 ADR-29 수용
-- 한계에 등재됨 — 종결은 CC-150). 여기서는 구현 이름을 그대로 쓴다.
ALTER TABLE style_prototype ENABLE ROW LEVEL SECURITY;
ALTER TABLE style_prototype FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_style_prototype_tenant ON style_prototype;
CREATE POLICY p_style_prototype_tenant ON style_prototype
  USING (EXISTS (
    SELECT 1 FROM template_profile tp
    JOIN document d ON d.document_id = tp.document_id
    WHERE tp.template_profile_id = style_prototype.template_profile_id
      AND d.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM template_profile tp
    JOIN document d ON d.document_id = tp.document_id
    WHERE tp.template_profile_id = style_prototype.template_profile_id
      AND d.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 7. export_job -> document
-- ---------------------------------------------------------------------------
-- CC-160 소유지만 격리는 지금 닫는다: 테이블이 이미 존재하고 권한이 이미
-- 열려 있으므로, 쓰기 경로가 생기기 전에 닫는 것이 이 마이그레이션의 취지다.
-- document_id / revision_id 두 FK 중 document_id가 테넌트 근거다.
ALTER TABLE export_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_job FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_export_job_tenant ON export_job;
CREATE POLICY p_export_job_tenant ON export_job
  USING (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = export_job.document_id
      AND d.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = export_job.document_id
      AND d.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 8. validation_report -> (target_type에 따라) document | export_job -> document
-- ---------------------------------------------------------------------------
-- 유일하게 FK가 없는 테이블이다. 0007은 evidence_file_id조차 FK로 걸지 않았고,
-- 설계 §6.26도 target_id에 FK 표기를 두지 않는다 — 대신 target_type의 값
-- 어휘를 `DOCUMENT/EXPORT` 둘로 명시한다(0003의 COMMENT도 동일). 부모 경로를
-- 임의로 정하지 않고, **설계가 명시한 그 두 값에 대해서만** 경로를 쓴다.
--
-- fail-closed. 두 분기에 해당하지 않는 target_type(오타, 미래에 추가될 대상
-- 종류)은 정책식이 거짓이 되어 읽기 0행 / 쓰기 거부가 된다. 조용한 유출 대신
-- 즉시 실패를 택한 것이다 — 새 target_type이 필요해지는 시점(CC-160 Track A/B
-- 검증 보고서)에 이 정책을 확장하는 마이그레이션이 함께 와야 한다.
-- ADR-29 D9가 "부모 경로 확인"을 요구한 항목이므로, 이 다형 매핑은 CC-150
-- 보고에 판단 근거와 함께 명시한다.
ALTER TABLE validation_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_report FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_validation_report_tenant ON validation_report;
CREATE POLICY p_validation_report_tenant ON validation_report
  USING (
    (validation_report.target_type = 'DOCUMENT' AND EXISTS (
      SELECT 1 FROM document d
      WHERE d.document_id = validation_report.target_id
        AND d.tenant_id = une_current_tenant_id()
    ))
    OR
    (validation_report.target_type = 'EXPORT' AND EXISTS (
      SELECT 1 FROM export_job e
      JOIN document d ON d.document_id = e.document_id
      WHERE e.export_id = validation_report.target_id
        AND d.tenant_id = une_current_tenant_id()
    ))
  )
  WITH CHECK (
    (validation_report.target_type = 'DOCUMENT' AND EXISTS (
      SELECT 1 FROM document d
      WHERE d.document_id = validation_report.target_id
        AND d.tenant_id = une_current_tenant_id()
    ))
    OR
    (validation_report.target_type = 'EXPORT' AND EXISTS (
      SELECT 1 FROM export_job e
      JOIN document d ON d.document_id = e.document_id
      WHERE e.export_id = validation_report.target_id
        AND d.tenant_id = une_current_tenant_id()
    ))
  );

-- ---------------------------------------------------------------------------
-- 9. 남은 tenant_id 없는 하위 테이블
-- ---------------------------------------------------------------------------
-- 0016 §5가 남긴 목록 중 문서 계열 여덟 개를 본 마이그레이션이 닫았다.
-- 아직 남은 것은 다른 도메인의 하위 테이블(plan_context_draft, dispatch,
-- situation_fact/fact_conflict, task 계열, journal 계열 등)이며, 각 도메인
-- Work Item(CC-2xx)이 같은 EXISTS(부모) 패턴으로 닫는다. 0015 §7 말미와
-- 0016 §5의 주석은 이력이므로 수정하지 않는다.
