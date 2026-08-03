-- 0020_export_and_validation.sql (CC-160) — Export/검증 표면의 어휘와 디스패치.
--
-- 범위. 이 마이그레이션은 다섯 가지를 한다.
--   1) export_job에 tenant_id를 세워 워커 디스패치를 가능하게 한다
--   2) export_job / validation_report / file_object의 값 어휘를 CHECK로 닫는다
--   3) validation_report를 append-only로 만든다(감사 증거)
--   4) une_worker에 Export 경로 최소 권한을 준다
--   5) ADR-30이 CC-160으로 넘긴 이연 제약 2건을 종결한다
--
-- 새 테이블은 없다. 기준선 테이블 수는 61 그대로다.
--
-- ===========================================================================
-- §1. export_job.tenant_id 신설 — 설계 내부 비대칭 해소
-- ===========================================================================
-- generation_job(설계 §6, 0003:115)에는 tenant_id가 있고 export_job(0003:328)
-- 에는 없다. 두 테이블은 같은 유형의 **비동기 Job**이고 같은 워커 모델을
-- 쓰는데 한쪽만 테넌트를 들고 있다. 이 비대칭은 실행 불가능한 상태를 만든다:
--
--   * 워커의 디스패치 트랜잭션은 app.tenant_id가 없는 상태로 돈다(0015 §7).
--   * 그 상태에서 document의 테넌트 정책은 거짓이므로 document를 읽을 수 없다.
--   * 따라서 0018의 EXISTS(document) 정책만으로는 워커가 export_job 행을
--     **볼 수도 없고**, 봤다 한들 어느 테넌트로 정산해야 하는지 알 수 없다.
--
-- generation_job이 이미 취한 해법(tenant_id를 Job 자신이 들고, 디스패치는
-- 테넌트 없이 읽고 정산은 테넌트 안에서 한다)을 그대로 따른다. 이것은
-- 0015 §1이 generation_job에서, ADR-27 D2가 generated_block에서, 0019 §0이
-- document_autosave에서 해소한 것과 같은 유형의 기준선 결함이다(ADR-31).
--
-- 백필은 document에서 가져온다 — export_job.document_id가 테넌트 근거라는
-- 0018 §7의 판단을 값으로 고정하는 것이다.
ALTER TABLE export_job ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE export_job e
   SET tenant_id = d.tenant_id
  FROM document d
 WHERE d.document_id = e.document_id
   AND e.tenant_id IS DISTINCT FROM d.tenant_id;

-- 부모가 없는 고아 행이 있으면 NOT NULL이 실패한다. 그것이 옳다 —
-- 조용히 0으로 채우거나 지우면 격리 근거가 없는 행을 만들어 낸다.
ALTER TABLE export_job ALTER COLUMN tenant_id SET NOT NULL;

COMMENT ON COLUMN export_job.tenant_id IS '기관 (CC-160: 워커 디스패치 근거)';

-- 정책 교체. USING은 직접 술어로 바꾸고(0018이 실측으로 지적한 hashed SubPlan
-- 비용 제거), WITH CHECK에는 부모 존재 확인을 남긴다 — tenant_id만 보면
-- "우리 테넌트의 아무 값이나" 쓸 수 있어 0018이 막던 고아 쓰기가 다시 열린다.
DROP POLICY IF EXISTS p_export_job_tenant ON export_job;
CREATE POLICY p_export_job_tenant ON export_job
  USING (tenant_id = une_current_tenant_id())
  WITH CHECK (
    tenant_id = une_current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM document d
      WHERE d.document_id = export_job.document_id
        AND d.tenant_id = une_current_tenant_id()
    )
  );

-- ===========================================================================
-- §2. 값 어휘 — @une/domain이 정본, CHECK는 그 사본
-- ===========================================================================
-- 어휘의 정본은 packages/domain/src/document/export.ts다(ADR-29 D4와 같은
-- 이유: 엔진·API·워커·DB 네 곳에 흩어지면 서로 다른 값을 허용하게 된다).
-- 아래 CHECK는 그 목록에서 유도한 것이며, 계약 테스트가 둘을 대조한다.

-- export_job.format — 설계 10 §6은 'HWPX/PDF/DOCX'. OpenAPI ExportRequest의
-- enum에는 JSON이 더 있었으나 정본 우선순위(설계 3 > OpenAPI 4)에 따라
-- 계약에서 제거했다(ADR-31). **PDF/DOCX는 어휘에는 있지만 변환기가 없다** —
-- 그것은 DB가 아니라 서비스 층에서 422로 거부한다. 여기서 HWPX만 허용하면
-- 나중에 변환기가 생길 때 데이터 어휘까지 마이그레이션해야 한다.
ALTER TABLE export_job DROP CONSTRAINT IF EXISTS ck_export_job_format;
ALTER TABLE export_job ADD CONSTRAINT ck_export_job_format
  CHECK (format IN ('HWPX', 'PDF', 'DOCX'));

-- export_job.status — 설계 10 §6은 'QUEUED~FAILED'로만 적는다. 생성 Job과
-- 같은 이름을 쓰되 취소 경로는 두지 않는다: Export에는 취소 API가 계약에
-- 없고(UNE-DOC-012~014), 도달할 수 없는 상태를 어휘에 넣으면 그 상태를
-- 처리하는 코드가 영원히 죽은 코드로 남는다.
ALTER TABLE export_job DROP CONSTRAINT IF EXISTS ck_export_job_status;
ALTER TABLE export_job ADD CONSTRAINT ck_export_job_status
  CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'));

-- 종단 일관성. COMPLETED는 결과 파일과 검증 보고서를 모두 가져야 하고,
-- 끝나지 않은 Job은 finished_at을 가질 수 없다. 이 상관식이 없으면
-- "완료됐는데 받을 파일이 없는" 행이 만들어지고, 그 모순은 사용자가
-- 다운로드를 눌렀을 때에야 드러난다.
ALTER TABLE export_job DROP CONSTRAINT IF EXISTS ck_export_job_terminal_shape;
ALTER TABLE export_job ADD CONSTRAINT ck_export_job_terminal_shape
  CHECK (
    (status = 'COMPLETED'
      AND output_file_id IS NOT NULL
      AND validation_report_id IS NOT NULL
      AND finished_at IS NOT NULL)
    OR (status = 'FAILED' AND finished_at IS NOT NULL)
    OR (status IN ('QUEUED', 'RUNNING')
      AND output_file_id IS NULL
      AND finished_at IS NULL)
  );

-- validation_report.target_type — 0018 §8이 CC-160으로 미룬 어휘다. 0018의
-- 정책은 이 두 값에만 부모 경로를 두고 나머지는 fail-closed로 두었는데,
-- 어휘가 열려 있으면 "정책이 조용히 거짓이 되는 행"을 계속 만들 수 있다.
-- 어휘를 닫아 그 상태 자체를 없앤다.
ALTER TABLE validation_report DROP CONSTRAINT IF EXISTS ck_validation_report_target_type;
ALTER TABLE validation_report ADD CONSTRAINT ck_validation_report_target_type
  CHECK (target_type IN ('DOCUMENT', 'EXPORT'));

ALTER TABLE validation_report DROP CONSTRAINT IF EXISTS ck_validation_report_track;
ALTER TABLE validation_report ADD CONSTRAINT ck_validation_report_track
  CHECK (track IN ('A_AUTO', 'B_HANCOM'));

ALTER TABLE validation_report DROP CONSTRAINT IF EXISTS ck_validation_report_status;
ALTER TABLE validation_report ADD CONSTRAINT ck_validation_report_status
  CHECK (status IN ('PASS', 'LIMITED', 'FAIL'));

-- file_object.scan_status — 0003의 COMMENT가 'PENDING/CLEAN/INFECTED'로
-- 어휘를 이미 적어 두었다. 값 검사는 없었다.
ALTER TABLE file_object DROP CONSTRAINT IF EXISTS ck_file_object_scan_status;
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_scan_status
  CHECK (scan_status IN ('PENDING', 'CLEAN', 'INFECTED'));

-- 무결성 해시는 형식을 고정한다(0019 §3이 ir_hash에 건 것과 같은 층).
ALTER TABLE file_object DROP CONSTRAINT IF EXISTS ck_file_object_sha256;
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_sha256
  CHECK (sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE file_object DROP CONSTRAINT IF EXISTS ck_file_object_size;
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_size
  CHECK (size_bytes >= 0);

-- ===========================================================================
-- §3. validation_report는 append-only — 검증 보고서는 감사 증거다
-- ===========================================================================
-- CLAUDE.md: "Corrections are new versions or correction events; never
-- overwrite audit history." 재검증은 새 보고서를 만드는 일이지 과거 보고서의
-- 판정을 고쳐 쓰는 일이 아니다. export_job.validation_report_id가 어느
-- 보고서를 가리키는지가 곧 "그 산출물이 어떤 근거로 나갔는가"이므로,
-- 그 행이 나중에 바뀌면 증거가 사후에 달라진다.
REVOKE UPDATE, DELETE ON validation_report FROM une_app;

-- file_object도 같은 이유로 갱신을 막는다. storage_key/sha256이 바뀌면
-- "다운로드한 파일이 검증받은 그 파일인가"를 더 이상 말할 수 없다.
-- scan_status만은 나중에 채워야 하므로(AV 스캔은 비동기, OB 범위) 컬럼 단위
-- 트리거가 필요하다 — 지금은 스캐너가 없어 걸 자리가 없으므로 §6에 남긴다.
REVOKE DELETE ON file_object FROM une_app;

-- ===========================================================================
-- §4. 워커 권한과 디스패치 정책
-- ===========================================================================
GRANT SELECT, UPDATE ON export_job        TO une_worker;  -- claim / settle
GRANT SELECT, INSERT ON validation_report TO une_worker;  -- Track A 보고서
GRANT SELECT, INSERT ON file_object       TO une_worker;  -- 산출물 등록
GRANT SELECT ON document                  TO une_worker;  -- 원본 문서 메타
GRANT SELECT ON document_revision         TO une_worker;  -- 대상 리비전 IR

-- 0015 §7과 같은 의미론이다. une_current_tenant_id()가 NULL이면 디스패치
-- 모드이며, 그때만 아래 정책이 적용된다(PERMISSIVE OR).
--
-- claim의 WITH CHECK가 테넌트 없는 트랜잭션이 쓸 수 있는 것을 QUEUED/RUNNING
-- 으로 제한한다. 종단 쓰기(COMPLETED/FAILED)는 테넌트가 설정된 트랜잭션을
-- 요구하며, 그 트랜잭션이 file_object/validation_report를 같이 쓴다 —
-- 결과와 정산이 하나의 테넌트 경계 안에 머문다.
DROP POLICY IF EXISTS p_export_job_worker_dispatch ON export_job;
CREATE POLICY p_export_job_worker_dispatch ON export_job
  FOR SELECT TO une_worker
  USING (une_current_tenant_id() IS NULL AND status IN ('QUEUED', 'RUNNING'));

DROP POLICY IF EXISTS p_export_job_worker_claim ON export_job;
CREATE POLICY p_export_job_worker_claim ON export_job
  FOR UPDATE TO une_worker
  USING (une_current_tenant_id() IS NULL AND status IN ('QUEUED', 'RUNNING'))
  WITH CHECK (status IN ('QUEUED', 'RUNNING'));

-- 워커 폴링 경로. 대기 중인 Job을 오래된 것부터 집는다.
CREATE INDEX IF NOT EXISTS ix_export_job_dispatch
  ON export_job (status, created_at)
  WHERE status IN ('QUEUED', 'RUNNING');

-- 문서별 Export 이력 조회(UNE-DOC-013 목록 경로와 화면).
CREATE INDEX IF NOT EXISTS ix_export_job_document
  ON export_job (document_id, created_at DESC);

-- 보고서를 대상에서 되찾는 경로. 다형 참조라 (type, id) 복합이다.
CREATE INDEX IF NOT EXISTS ix_validation_report_target
  ON validation_report (target_type, target_id, created_at DESC);

-- ===========================================================================
-- §5. ADR-30이 CC-160으로 넘긴 이연 제약 2건 종결
-- ===========================================================================

-- (1) document_autosave.status × result_revision_id 상관 제약.
-- 0019 §6은 "ACCEPTED만 결과 리비전을 가진다"가 확정되지 않았다며 미뤘고,
-- CC-150 구현이 그것을 확정했다(ADR-30 수용 한계 말미). 이제 건다.
ALTER TABLE document_autosave DROP CONSTRAINT IF EXISTS ck_document_autosave_result_shape;
ALTER TABLE document_autosave ADD CONSTRAINT ck_document_autosave_result_shape
  CHECK (
    (status = 'ACCEPTED' AND result_revision_id IS NOT NULL)
    OR (status IN ('CONFLICT', 'SUPERSEDED') AND result_revision_id IS NULL)
  );

-- (2) template_profile.analysis_status 어휘 확정.
--
-- 정본이 갈렸던 이유는 **두 개의 서로 다른 축이 한 컬럼 이름 아래 있었기**
-- 때문이다(0019 §6이 "확인 불가"로 남긴 항목):
--   * ADR v1.1 §8.6 G15-1 계열: AUTO/CONFIRM/LIMITED/REJECT — 호환성 분석의
--     **판정**이다. 분류기가 문서를 보고 계산하는 값.
--   * 설계 09 §4 Template Profile 상태표: DRAFT/ANALYZING/CONFIRM_REQUIRED/
--     CONFIRMED/REVIEW/PUBLISHED/LIMITED/DEPRECATED/REJECTED — 프로필의
--     **생명주기**다. 사람이 검토·승인·게시하며 옮기는 값.
--
-- 둘은 대체 관계가 아니라 직교한다(판정 LIMITED인 프로필도 PUBLISHED일 수
-- 있다). LIMITED가 양쪽에 다 나오는 것이 두 축이 섞였다는 신호다.
--
-- 결정(ADR-31): 이 컬럼은 **판정** 축으로 확정한다. 근거는 세 가지다.
--   * 컬럼 이름이 analysis_status — 분석의 상태다.
--   * 실제로 쓰는 유일한 경로(DocumentImportService)가 분류기 판정을 변환
--     없이 넣는다. 지금 생명주기로 바꾸면 기존 데이터가 전부 위반이 된다.
--   * 생명주기를 움직이는 코드가 아직 없다. 화면(설계 09)이 구현되는 시점에
--     `lifecycle_status` 컬럼을 따로 세우는 것이, 없는 워크플로를 지금
--     추측해서 넣는 것보다 정확하다. §6에 과제로 남긴다.
ALTER TABLE template_profile DROP CONSTRAINT IF EXISTS ck_template_profile_analysis_status;
ALTER TABLE template_profile ADD CONSTRAINT ck_template_profile_analysis_status
  CHECK (analysis_status IN ('AUTO', 'CONFIRM', 'LIMITED', 'REJECT'));

-- ===========================================================================
-- §6. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * export_job.output_file_id / validation_report_id의 FK. 0007은 이 테이블의
--     document_id/revision_id/requested_by에는 FK를 걸었지만 이 둘은 남겼다
--     (0007:39~41 참조). 결과 참조라 Job 생성 시점에는 비어 있기 때문으로
--     보이는데, nullable FK는 그 자체로 성립하므로 이유가 되지 않는다.
--     그럼에도 지금 걸지 않는 이유는 file_object의 삭제 정책(보존기간·TTL,
--     UNE-DOC-014의 410 EXPORT-410-001)이 아직 없어서다. FK를 먼저 걸면
--     만료 삭제가 CASCADE인지 RESTRICT인지를 지금 결정해야 하고, 그 결정은
--     보존 정책(retention_policy 테이블)이 실제로 구현되는 시점의 몫이다.
--     그때까지 §2의 ck_export_job_terminal_shape가 "완료인데 결과가 없는"
--     행을 막는다.
--   * validation_report.target_id의 FK. 다형 참조(DOCUMENT|EXPORT)라 FK를
--     걸 수 없다. 0018 §8의 정책이 부모 경로를 대신 확인한다.
--   * file_object.scan_status의 컬럼 단위 append-only 트리거. AV 스캐너가
--     아직 없어(설계 §7502의 'AV Scan'은 OB 범위) PENDING에서 움직이는
--     경로 자체가 없다. 스캐너가 도착할 때 트리거와 상태 전이를 함께 건다.
--   * template_profile.lifecycle_status. 설계 09의 9종 생명주기를 담을
--     컬럼이지만 이를 움직이는 화면·API가 아직 없다. §5 (2) 참조.
--   * export_job의 멱등 유니크 키. UNE-DOC-012의 Idempotency-Key 재생은
--     0014 api_idempotency(ADR-23)가 이미 담당한다. 테이블마다 별도 UK를
--     두면 재생 판정이 두 곳에 생겨 어느 쪽이 정본인지 알 수 없게 된다.
--   * export_job.error_json. generation_job에는 있지만 export_job의 설계
--     컬럼 목록에는 없다. 실패 사유는 validation_report.checks_json에
--     남으며(Track A 실패가 주된 실패 원인), 그 외 오류는 감사 로그가
--     받는다. 컬럼을 늘리기 전에 실제로 담을 것이 무엇인지 확인한다.
