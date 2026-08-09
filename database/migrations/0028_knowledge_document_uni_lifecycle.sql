-- 0028_knowledge_document_uni_lifecycle.sql (CC-220)
--
-- 지식문서(훈련·매뉴얼 자료) 등록과 UNI 비동기 학습상태.
-- 설계 06 US-SIT-009·US-SIT-010, 설계 08 §1.9·§1.14, 설계 10 UNE-KNOW-001~003.
--
-- 0004의 `knowledge_document`는 **제약이 하나도 없다.** 어휘도 상관식도 FK도
-- 없고 `status` 주석은 "UPLOADING~FAILED"라고만 적혀 있다. 이 테이블에 처음
-- 쓰는 것이 CC-220이므로 여기서 모양을 잡는다.
--
-- 테이블 수 변화 없음(63 유지) — 컬럼·제약·인덱스·정책만 추가한다.

-- ===========================================================================
-- §1. provider_job을 비동기로 연다 — 0023이 예고한 마이그레이션
-- ===========================================================================
-- 0023 §4의 주석이 이 자리를 지목한다:
--
--   "QUEUED/RUNNING을 넣지 않는 이유가 이것이다 — 0022 §1의 '도달 가능한
--    상태만' 원칙이고, **비동기로 옮길 때 그 두 값을 추가하는 마이그레이션이
--    함께 온다.**"
--
-- CC-200의 상황 수집은 동기라 세 값으로 충분했다. CC-220은 다르다 — 설계 10
-- §7.23 정상 Sequence 7단계가 "외부 호출이 필요한 경우 DB에 Job/Outbox를
-- Commit하고 **Worker가** T3Q/UNI/Provider를 호출한다"이다. 그래서 UNI 업로드
-- 잡은 요청 트랜잭션에서 QUEUED로 태어나 워커가 RUNNING으로 집는다.
ALTER TABLE provider_job DROP CONSTRAINT IF EXISTS ck_provider_job_status;
ALTER TABLE provider_job ADD CONSTRAINT ck_provider_job_status
  CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED'));

-- `finished_at`은 NOT NULL이었다(0004). 동기 수집에서는 행이 태어날 때 이미
-- 끝나 있었으므로 성립했지만, 비동기에서는 QUEUED/RUNNING인 동안 끝난 시각이
-- **없다.** NOT NULL을 유지한 채 아래 상관식을 걸면 두 조건이 서로 모순해
-- QUEUED 행을 아예 만들 수 없다. 제약을 풀되 아래에서 종결 상태에는 반드시
-- 있도록 강제한다 — 불변식이 컬럼에서 상관식으로 옮겨갈 뿐 약해지지 않는다.
ALTER TABLE provider_job ALTER COLUMN finished_at DROP NOT NULL;

-- 상관식도 함께 넓힌다. 넓히기만 하고 기존 세 갈래의 뜻은 그대로다 —
-- 미종결 두 상태는 아직 결과가 없으므로 오류도 결과수도 없고 끝난 시각도 없다.
-- 이 조건이 없으면 "QUEUED인데 결과가 3건인" 행이 만들어진다.
ALTER TABLE provider_job DROP CONSTRAINT IF EXISTS ck_provider_job_outcome_shape;
ALTER TABLE provider_job ADD CONSTRAINT ck_provider_job_outcome_shape
  CHECK (
    (status IN ('QUEUED', 'RUNNING')
      AND error_json IS NULL AND result_count = 0 AND finished_at IS NULL)
    OR (status = 'SUCCEEDED' AND error_json IS NULL AND finished_at IS NOT NULL)
    OR (status = 'PARTIAL' AND error_json IS NOT NULL AND result_count > 0
        AND finished_at IS NOT NULL)
    OR (status = 'FAILED'  AND error_json IS NOT NULL AND result_count = 0
        AND finished_at IS NOT NULL)
  );

-- 워커가 집을 잡을 때 타는 경로.
CREATE INDEX IF NOT EXISTS ix_provider_job_dispatch
  ON provider_job (provider_code, created_at)
  WHERE status IN ('QUEUED', 'RUNNING');

-- ===========================================================================
-- §2. knowledge_document — 두 축을 따로 둔다
-- ===========================================================================
-- `status`는 **UNE가 아는 사실**(파일을 검증했고 UNI에 보냈다)이고
-- `uni_status`는 **UNI가 알려준 사실**(파싱·색인·참조생성이 어디까지 갔다)이다.
-- 설계 06이 두 계열을 따로 적는다:
--   US-SIT-009  LOCAL_VALIDATED → UPLOADING → QUEUED/ERROR
--   US-SIT-010  QUEUED → … → READY/ERROR/CANCELLED
--
-- 한 컬럼에 합치면 UNI가 응답하지 않을 때 무엇이 참인지 말할 수 없다. 0022 §1이
-- `scan_status`와 `upload_state`를 가른 것과 같은 판단이며(ADR-32 D3),
-- `uni_status`의 NULL은 "아직 모른다"이지 "처리되지 않았다"가 아니다.
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS uni_status varchar(30);
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS uni_observed_at timestamptz;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS reference_json jsonb;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS retention_scope varchar(20);
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS source_sha256 char(64);
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS error_json jsonb;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS attempt_count integer;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS provider_job_id uuid;
ALTER TABLE knowledge_document ADD COLUMN IF NOT EXISTS updated_at timestamptz;

COMMENT ON COLUMN knowledge_document.status IS 'UNE 등록 축: PENDING_UPLOAD/UPLOADING/REGISTERED/FAILED/CANCELLED';
COMMENT ON COLUMN knowledge_document.uni_status IS 'UNI 처리 축(설계 08 §1.9 어휘의 사본). NULL은 "아직 모른다"';
COMMENT ON COLUMN knowledge_document.uni_observed_at IS 'uni_status를 마지막으로 관측한 시각';
COMMENT ON COLUMN knowledge_document.reference_json IS 'UNI 참조요약 메타 (US-SIT-010 4단계)';
COMMENT ON COLUMN knowledge_document.retention_scope IS '보존범위 THIS_INCIDENT/PROJECT/ORG_KB (US-SIT-009)';
COMMENT ON COLUMN knowledge_document.source_sha256 IS '원본 해시 사본 — 중복 탐지(A-01) 경로';
COMMENT ON COLUMN knowledge_document.error_json IS '실패 사유 (E-02 UPLOAD_ERROR)';
COMMENT ON COLUMN knowledge_document.attempt_count IS 'UNI 전송 시도 횟수 (UNE-KNOW-003)';
COMMENT ON COLUMN knowledge_document.provider_job_id IS '가장 최근 UNI 전송 잡';

-- 기존 행이 없는 테이블이지만(CC-220이 첫 사용자다) 관례대로 백필 후 NOT NULL.
UPDATE knowledge_document
   SET retention_scope = COALESCE(retention_scope, 'THIS_INCIDENT'),
       attempt_count   = COALESCE(attempt_count, 0),
       updated_at      = COALESCE(updated_at, created_at)
 WHERE retention_scope IS NULL OR attempt_count IS NULL OR updated_at IS NULL;

ALTER TABLE knowledge_document ALTER COLUMN retention_scope SET NOT NULL;
ALTER TABLE knowledge_document ALTER COLUMN retention_scope SET DEFAULT 'THIS_INCIDENT';
ALTER TABLE knowledge_document ALTER COLUMN attempt_count SET NOT NULL;
ALTER TABLE knowledge_document ALTER COLUMN attempt_count SET DEFAULT 0;
ALTER TABLE knowledge_document ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE knowledge_document ALTER COLUMN updated_at SET DEFAULT now();

-- ===========================================================================
-- §3. 어휘와 상관식
-- ===========================================================================
ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS ck_knowledge_document_status;
ALTER TABLE knowledge_document ADD CONSTRAINT ck_knowledge_document_status
  CHECK (status IN ('PENDING_UPLOAD', 'UPLOADING', 'REGISTERED', 'FAILED', 'CANCELLED'));

-- UNI가 돌려준 문자열의 사본이다. 모르는 값을 넣지 않는다 — 매핑되지 않는
-- 상태를 그대로 저장하면 "UNI가 뭐라고 했는지"는 남지만 그 값을 읽는 코드가
-- 판단할 수 없다. 원문은 provider_result가 통째로 갖는다.
ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS ck_knowledge_document_uni_status;
ALTER TABLE knowledge_document ADD CONSTRAINT ck_knowledge_document_uni_status
  CHECK (uni_status IS NULL OR uni_status IN
    ('QUEUED', 'PARSING', 'INDEXING', 'REFERENCE_GENERATING', 'READY', 'ERROR'));

ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS ck_knowledge_document_type;
ALTER TABLE knowledge_document ADD CONSTRAINT ck_knowledge_document_type
  CHECK (document_type IN
    ('MANUAL', 'TRAINING_PLAN', 'EVALUATION_GUIDE', 'MESSAGE_LIST', 'MISSION_CARD'));

ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS ck_knowledge_document_retention_scope;
ALTER TABLE knowledge_document ADD CONSTRAINT ck_knowledge_document_retention_scope
  CHECK (retention_scope IN ('THIS_INCIDENT', 'PROJECT', 'ORG_KB'));

ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS ck_knowledge_document_attempt_count;
ALTER TABLE knowledge_document ADD CONSTRAINT ck_knowledge_document_attempt_count
  CHECK (attempt_count >= 0);

-- 상태와 증거가 어긋난 행은 만들 수 없다.
--   REGISTERED  UNI가 doc_id를 돌려줬다는 뜻이다. 그 값 없이 등록됐다고 적을 수 없다.
--   FAILED      왜 실패했는지 없이 실패했다고 적을 수 없다.
--   그 외        아직 doc_id가 없다.
ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS ck_knowledge_document_outcome_shape;
ALTER TABLE knowledge_document ADD CONSTRAINT ck_knowledge_document_outcome_shape
  CHECK (
    (status = 'REGISTERED' AND provider_document_id IS NOT NULL AND error_json IS NULL)
    OR (status = 'FAILED' AND error_json IS NOT NULL)
    OR (status IN ('PENDING_UPLOAD', 'UPLOADING', 'CANCELLED'))
  );

-- UNI 처리 축은 등록된 뒤에만 의미가 있다. 보내지도 않은 문서의 처리상태를
-- 적으면 US-SIT-010 완료조건("READY 아닌 자료가 Evidence에 포함된 건 0")의
-- 판정 근거가 무너진다.
ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS ck_knowledge_document_uni_axis_shape;
ALTER TABLE knowledge_document ADD CONSTRAINT ck_knowledge_document_uni_axis_shape
  CHECK (
    uni_status IS NULL
    OR (status = 'REGISTERED' AND provider_document_id IS NOT NULL AND uni_observed_at IS NOT NULL)
  );

-- ===========================================================================
-- §4. 관계
-- ===========================================================================
-- 0007이 다른 테이블에 건 것과 같은 형태다. `situation_id`는 nullable이다 —
-- 기관 KB 자료는 특정 상황에 속하지 않는다(US-SIT-009 보존범위 ORG_KB).
ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS fk_knowledge_document_tenant_id;
ALTER TABLE knowledge_document ADD CONSTRAINT fk_knowledge_document_tenant_id
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id);

ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS fk_knowledge_document_situation_id;
ALTER TABLE knowledge_document ADD CONSTRAINT fk_knowledge_document_situation_id
  FOREIGN KEY (situation_id) REFERENCES situation (situation_id);

ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS fk_knowledge_document_file_id;
ALTER TABLE knowledge_document ADD CONSTRAINT fk_knowledge_document_file_id
  FOREIGN KEY (file_id) REFERENCES file_object (file_id);

ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS fk_knowledge_document_created_by;
ALTER TABLE knowledge_document ADD CONSTRAINT fk_knowledge_document_created_by
  FOREIGN KEY (created_by) REFERENCES app_user (user_id);

ALTER TABLE knowledge_document DROP CONSTRAINT IF EXISTS fk_knowledge_document_provider_job_id;
ALTER TABLE knowledge_document ADD CONSTRAINT fk_knowledge_document_provider_job_id
  FOREIGN KEY (provider_job_id) REFERENCES provider_job (provider_job_id);

-- ===========================================================================
-- §5. 인덱스
-- ===========================================================================
-- 중복 탐지(US-SIT-009 A-01 "중복 hash → 기존 doc 재사용 또는 force 업로드").
-- **유니크가 아니다** — A-01이 force 업로드를 허용하므로 같은 해시의 두 행은
-- 정상이다. 유니크로 막으면 사용자가 고른 선택지가 23505가 된다.
CREATE INDEX IF NOT EXISTS ix_knowledge_document_source_hash
  ON knowledge_document (tenant_id, source_sha256)
  WHERE source_sha256 IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_knowledge_document_situation
  ON knowledge_document (situation_id, created_at DESC);

-- 폴링 대상 조회: 등록됐고 아직 종결 처리상태가 아닌 것.
CREATE INDEX IF NOT EXISTS ix_knowledge_document_polling
  ON knowledge_document (uni_observed_at)
  WHERE status = 'REGISTERED' AND uni_status IS DISTINCT FROM 'READY'
    AND uni_status IS DISTINCT FROM 'ERROR';

DROP TRIGGER IF EXISTS trg_knowledge_document_updated_at ON knowledge_document;
CREATE TRIGGER trg_knowledge_document_updated_at
  BEFORE UPDATE ON knowledge_document
  FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();

-- ===========================================================================
-- §6. 워커 접근 — UNI 잡에만, 정책으로 좁힌다
-- ===========================================================================
-- ADR-33 D2의 따름정리는 **롤 권한 경계**다(2026-08-09 개정): `une_worker`는
-- 상황 계열 테이블에 권한이 없다. CC-220은 그 경계를 넓혀야 하는 첫 항목이다 —
-- 설계 10 §7.23 7단계가 UNI 호출자를 워커로 정했기 때문이다.
--
-- 넓히되 **행 단위로 좁힌다.** 워커는 `provider_code='UNI'`인 잡만 보고, 그
-- 잡이 미종결일 때만 집는다. KMA/MOIS 상황 수집 행은 SELECT 권한이 있어도
-- 정책이 걸러 **0행**이다. 0015의 `generation_job` 디스패치 정책과 같은 형태이며
-- 근거가 `pg_policies`에 드러난다.
--
-- 이것이 D2를 뒤집는가: 뒤집지 않는다. D2가 정한 것은 "상황 수집은 동기다"이고
-- 그 경로는 그대로 API가 한 트랜잭션에서 처리한다. 워커가 얻는 것은 UNI
-- 지식문서 잡뿐이다. 회귀 단언은 42501에서 **"권한은 있으나 0행"**으로
-- 날카로워진다(tests/integration).
-- **`provider_result`에는 SELECT를 주지 않는다.** 원문을 남기는 데 읽기는
-- 필요 없다. 여기서 SELECT까지 주면 정책 결함 하나가 전 테넌트의 Provider
-- 원문(상황 수집 응답 — 개인정보가 들어오는 바로 그 필드)을 노출한다.
-- INSERT만 주면 그 노출 경로는 **권한 자체가 없어** 정책과 무관하게 닫힌다.
-- 0023이 세운 "워커는 provider_result를 읽지 못한다"는 그대로 유지되고
-- 회귀 단언도 42501 그대로다.
GRANT SELECT, UPDATE ON provider_job TO une_worker;
GRANT INSERT         ON provider_result TO une_worker;
GRANT SELECT, UPDATE ON knowledge_document TO une_worker;

-- **제한(RESTRICTIVE) 정책이 먼저다.** 기존 `p_provider_job_tenant`는 TO PUBLIC
-- 이고 permissive라 OR로 합쳐진다 — 워커가 테넌트 컨텍스트를 세운 트랜잭션
-- (결과를 테넌트 경계 안에서 정산할 때 그렇게 한다)에서는 그 정책만으로
-- **KMA/MOIS 상황 수집 행까지 보인다.** 0015의 generation_job은 그 테이블이
-- 통째로 워커의 것이라 문제가 없었지만 provider_job은 두 계열이 섞인다.
--
-- RESTRICTIVE는 OR가 아니라 AND로 걸린다. 그래서 이 한 줄이 "워커는 테넌트를
-- 세우든 안 세우든 UNI 행 말고는 어떤 경로로도 볼 수 없다"를 보장한다.
-- ADR-33 D2가 지키려던 것(워커는 상황 수집 데이터에 닿지 않는다)이 권한 부재
-- 대신 이 정책으로 유지된다.
DROP POLICY IF EXISTS p_provider_job_worker_only_uni ON provider_job;
CREATE POLICY p_provider_job_worker_only_uni ON provider_job
  AS RESTRICTIVE FOR ALL TO une_worker
  USING (provider_code = 'UNI')
  WITH CHECK (provider_code = 'UNI');

DROP POLICY IF EXISTS p_provider_job_worker_uni_dispatch ON provider_job;
CREATE POLICY p_provider_job_worker_uni_dispatch ON provider_job
  FOR SELECT TO une_worker
  USING (une_current_tenant_id() IS NULL
         AND provider_code = 'UNI'
         AND status IN ('QUEUED', 'RUNNING'));

DROP POLICY IF EXISTS p_provider_job_worker_uni_claim ON provider_job;
CREATE POLICY p_provider_job_worker_uni_claim ON provider_job
  FOR UPDATE TO une_worker
  USING (une_current_tenant_id() IS NULL
         AND provider_code = 'UNI'
         AND status IN ('QUEUED', 'RUNNING'))
  WITH CHECK (provider_code = 'UNI');

-- 원문 보존은 비협상 규칙이다(CLAUDE.md). 워커가 UNI를 부르므로 원문을 남기는
-- 것도 워커다. **INSERT 전용 정책**이며 `USING` 절이 없다 — 읽기 권한이
-- 없으므로 읽기 정책도 필요 없다. 이미 쓴 원문은 보존기간 정리(0026/0027)만이
-- 건드릴 수 있다.
--
-- `WITH CHECK`의 하위질의는 `provider_job`을 읽으므로 그 테이블의 워커 정책이
-- 함께 걸린다 — 즉 **잡이 아직 미종결일 때만 원문을 넣을 수 있다.** 의도한
-- 순서다: 원문을 먼저 남기고 그다음에 잡을 종결한다. 반대로 하면 종결과 원문
-- 사이에서 죽었을 때 "성공했다는데 원문이 없는" 행이 남는다.
DROP POLICY IF EXISTS p_provider_result_worker_uni ON provider_result;
CREATE POLICY p_provider_result_worker_uni ON provider_result
  FOR INSERT TO une_worker
  WITH CHECK (EXISTS (SELECT 1 FROM provider_job j
                       WHERE j.provider_job_id = provider_result.provider_job_id
                         AND j.provider_code = 'UNI'));

-- 워커는 자기가 보낸 문서의 상태만 옮긴다.
DROP POLICY IF EXISTS p_knowledge_document_worker ON knowledge_document;
CREATE POLICY p_knowledge_document_worker ON knowledge_document
  FOR SELECT TO une_worker
  USING (une_current_tenant_id() IS NULL
         AND status IN ('PENDING_UPLOAD', 'UPLOADING', 'REGISTERED'));

DROP POLICY IF EXISTS p_knowledge_document_worker_write ON knowledge_document;
CREATE POLICY p_knowledge_document_worker_write ON knowledge_document
  FOR UPDATE TO une_worker
  USING (une_current_tenant_id() IS NULL
         AND status IN ('PENDING_UPLOAD', 'UPLOADING', 'REGISTERED'))
  WITH CHECK (status IN ('UPLOADING', 'REGISTERED', 'FAILED'));

-- ===========================================================================
-- §7. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * `source_sha256`에 UNIQUE를 걸지 않았다. US-SIT-009 A-01이 force 업로드를
--     허용한다 — 유니크는 중복을 막는 것이 아니라 사용자의 선택을 막는다.
--     (0025 §3이 중복 Fact에 유니크를 걸지 않은 것과 같은 판단이다.)
--   * 기관 KB 승격(A-02)의 승인 워크플로를 만들지 않았다. 어휘에 `ORG_KB`는
--     있지만 등록 시점 선택은 애플리케이션이 막는다 — 승인 절차 자체가 별도
--     항목이고, 없는 절차를 통과했다고 적을 수는 없다.
--   * 보존기간 정리를 걸지 않았다. `knowledge_document`는 파일 메타이고 원본은
--     `file_object`/오브젝트 저장소에 있다 — 그쪽 보존은 ADR-35 수용 한계 1이
--     연 항목이며 객체 삭제와 함께 판단해야 한다.
