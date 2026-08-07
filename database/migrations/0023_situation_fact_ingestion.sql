-- 0023_situation_fact_ingestion.sql (CC-200) — 상황·후보 Fact 수집의 격리와 형태.
--
-- 이 마이그레이션이 닫는 것은 두 가지다.
--   (1) 0018 §9가 "각 도메인 Work Item이 닫는다"고 예고한 상황 계열 하위
--       테이블의 테넌트 격리. CC-200이 이 테이블들에 **첫 쓰기 경로를 연다.**
--   (2) 계약이 가리키지만 존재한 적 없는 `provider_result` 테이블(UNE-SIT-006
--       x-db-tables). CC-170의 `malware_scan`과 같은 드리프트지만 **결론은
--       반대다** — 그쪽은 검사기가 없어 테이블을 만들지 않고 계약을 고쳤고,
--       이쪽은 "외부 Provider 원문 페이로드를 추적성 목적으로 보존한다"가
--       CLAUDE.md의 비협상 도메인 규칙이므로 **테이블을 만드는 것이 정답**이다.
--       원문을 어디에도 두지 않으면 그 규칙이 열린 채로 남는다.
--
-- 착수 시점 실측(빈 DB 아님, 개발 DB에서 확인). situation / fact_source /
-- situation_fact / fact_conflict / conflict_resolution / situation_snapshot /
-- provider_job **일곱 테이블 모두 0행**이고 CHECK 제약이 **하나도 없다.**
-- 그래서 NOT NULL 컬럼 추가와 상태 어휘 고정을 백필 없이 할 수 있다.
--
-- 상태 어휘의 출처. 설계 06 §7.1 표가 정본이다.
--   Incident(=situation)     DRAFT → REGISTERED → CONTEXT_CONFIRMED → SOP_READY
--                            → RUNNING/PAUSED → CLOSING → CLOSED
--   SituationContext         DRAFT → PROVIDER_QUERYING → CANDIDATE_REVIEW
--                            → CONFLICT_OPEN → USER_CONFIRMED
-- 앞의 것은 situation.status 컬럼이 있고, 뒤의 것은 **컬럼이 없다**. 뒤의 것을
-- 컬럼으로 만들지 않은 이유는 §8에 있다.
--
-- 테이블 수: 61 → 62 (provider_result 1개 증가).

-- ===========================================================================
-- §1. situation — 상태 어휘를 고정한다
-- ===========================================================================
-- varchar(20)/varchar(30)에 주석만 있고 제약이 없었다. 주석은 오타를 막지
-- 못한다. 상태는 "안정된 집합"(.claude/rules/database.md)이므로 CHECK로 굳힌다.
--
-- CC-200이 실제로 만드는 값은 DRAFT 하나다. 나머지 일곱은 후속 Work Item
-- (CC-210 CONTEXT_CONFIRMED, CC-2xx SOP_READY~, UNE-JNL-012 CLOSED)이 쓴다.
-- 도달 불가능한 상태를 미리 넣는 것을 0022 §1이 경계했지만, 여기서는 **설계
-- 06이 이미 확정한 전체 집합**을 그대로 옮기는 것이라 사정이 다르다. 매번
-- 마이그레이션을 추가해 어휘를 넓히면 그 사이의 CHECK가 설계와 어긋난 상태로
-- 남는다.
ALTER TABLE situation DROP CONSTRAINT IF EXISTS ck_situation_mode;
ALTER TABLE situation ADD CONSTRAINT ck_situation_mode
  CHECK (mode IN ('LIVE', 'EXERCISE'));

ALTER TABLE situation DROP CONSTRAINT IF EXISTS ck_situation_status;
ALTER TABLE situation ADD CONSTRAINT ck_situation_status
  CHECK (status IN (
    'DRAFT', 'REGISTERED', 'CONTEXT_CONFIRMED', 'SOP_READY',
    'RUNNING', 'PAUSED', 'CLOSING', 'CLOSED'
  ));

-- hazard_type에는 CHECK를 걸지 않는다. 재난유형 10종의 정본은
-- plan-context.schema.json의 enum이고(ADR-23 D3, plan 테이블도 같은 이유로
-- CHECK가 없다) DB에 사본을 만들면 스키마 개정 때 둘이 갈라진다.

ALTER TABLE situation DROP CONSTRAINT IF EXISTS ck_situation_version_no;
ALTER TABLE situation ADD CONSTRAINT ck_situation_version_no
  CHECK (version_no >= 1);

-- 0004에는 created_at만 있다. UNE-SIT-004 수정이 version_no를 올리지만 목록이
-- "최근 수정순"을 보여줄 근거가 없다(plan은 0003부터 updated_at을 갖는다).
ALTER TABLE situation ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE situation SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE situation ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE situation ALTER COLUMN updated_at SET DEFAULT now();
COMMENT ON COLUMN situation.updated_at IS '마지막 수정 시각';

-- ===========================================================================
-- §2. fact_source — tenant_id를 세우고 격리를 연다
-- ===========================================================================
-- fact_source는 상황 계열에서 유일하게 **부모 애그리거트가 없다.** situation을
-- 참조하지 않고(0007에 FK 없음) situation_fact가 이쪽을 참조한다. 그래서 0018이
-- 쓴 EXISTS(부모) 패턴을 쓸 수 없다.
--
-- 두 안을 검토했다.
--   (a) situation_fact를 거쳐 상황으로 조인 — 아직 어떤 fact도 참조하지 않는
--       source 행(수집 직후, 정규화 실패로 fact가 하나도 안 생긴 경우)이
--       **모든 테넌트에게 보인다.** fail-open이라 채택하지 않는다.
--   (b) tenant_id 컬럼을 세운다 — 0018이 경계한 "비정규화 사본"이 아니다.
--       사본이 되려면 원본이 있어야 하는데, 이 테이블에는 테넌트를 증명할
--       다른 경로가 애초에 없다. 이것이 원본이다.
-- (b)를 택한다.
--
-- source_name / source_uri는 기관이 어떤 출처를 어떤 조건으로 보는지를 드러낸다
-- (license_json 포함). 타 테넌트가 읽으면 운영 정보 유출이다.
-- 백필 UPDATE가 없는 이유: 이 테이블은 0행이다(머리말 실측). 행이 있었다면
-- 어느 테넌트의 출처인지 알 방법이 없어 이 마이그레이션 자체가 성립하지 않는다.
ALTER TABLE fact_source ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE fact_source ALTER COLUMN tenant_id SET NOT NULL;
COMMENT ON COLUMN fact_source.tenant_id IS '기관 (이 테이블의 유일한 테넌트 근거)';

ALTER TABLE fact_source DROP CONSTRAINT IF EXISTS fk_fact_source_tenant_id;
ALTER TABLE fact_source ADD CONSTRAINT fk_fact_source_tenant_id
  FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED;

-- 어휘는 situation-fact.schema.json의 source.providerCode enum(7종)과
-- 0004의 source_type 주석(API/WEB/FILE/USER)이 정본이다.
ALTER TABLE fact_source DROP CONSTRAINT IF EXISTS ck_fact_source_provider_code;
ALTER TABLE fact_source ADD CONSTRAINT ck_fact_source_provider_code
  CHECK (provider_code IN ('KMA', 'MOIS', 'SAFEKOREA', 'NAVER', 'MANUAL', 'T3Q', 'UNI'));

ALTER TABLE fact_source DROP CONSTRAINT IF EXISTS ck_fact_source_source_type;
ALTER TABLE fact_source ADD CONSTRAINT ck_fact_source_source_type
  CHECK (source_type IN ('API', 'WEB', 'FILE', 'USER'));

ALTER TABLE fact_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_source FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_fact_source_tenant ON fact_source;
CREATE POLICY p_fact_source_tenant ON fact_source
  USING (tenant_id = une_current_tenant_id())
  WITH CHECK (tenant_id = une_current_tenant_id());

-- 접근 경로: "이 상황의 이 Provider 출처를 최근 수집순으로". SIT-005가 매
-- 수집마다 출처 행을 만들므로 (tenant, provider, 시각)이 선두다.
CREATE INDEX IF NOT EXISTS ix_fact_source_tenant_provider_time
  ON fact_source (tenant_id, provider_code, retrieved_at DESC);

-- ===========================================================================
-- §3. situation_fact — 격리, 상태 어휘, 갱신 시각
-- ===========================================================================
-- value_json은 사용자가 입력했거나 Provider가 준 사실 본문이고, 확정되면
-- SituationSnapshot을 거쳐 계획서·일지의 사실 셀이 된다. 타 테넌트 노출은
-- 문서 본문 유출과 같은 등급이다.
ALTER TABLE situation_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE situation_fact FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_situation_fact_tenant ON situation_fact;
CREATE POLICY p_situation_fact_tenant ON situation_fact
  USING (EXISTS (
    SELECT 1 FROM situation s
    WHERE s.situation_id = situation_fact.situation_id
      AND s.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM situation s
    WHERE s.situation_id = situation_fact.situation_id
      AND s.tenant_id = une_current_tenant_id()
  ));

ALTER TABLE situation_fact DROP CONSTRAINT IF EXISTS ck_situation_fact_status;
ALTER TABLE situation_fact ADD CONSTRAINT ck_situation_fact_status
  CHECK (status IN ('CANDIDATE', 'CONFIRMED', 'REJECTED'));

-- numeric(5,4)는 9.9999까지 담는다. 신뢰도는 0~1이며 스키마
-- (situation-fact.schema.json confidence minimum/maximum)가 그렇게 말한다.
ALTER TABLE situation_fact DROP CONSTRAINT IF EXISTS ck_situation_fact_confidence;
ALTER TABLE situation_fact ADD CONSTRAINT ck_situation_fact_confidence
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

ALTER TABLE situation_fact DROP CONSTRAINT IF EXISTS ck_situation_fact_version_no;
ALTER TABLE situation_fact ADD CONSTRAINT ck_situation_fact_version_no
  CHECK (version_no >= 1);

-- 0004에는 collected_at(수집)과 observed_at(관측)만 있고 **행이 마지막으로
-- 바뀐 시각이 없다.** UNE-SIT-008 보정은 version_no로 낙관잠금을 걸지만,
-- 목록 화면이 "언제 보정됐나"를 보여줄 근거가 없고 감사와 대조할 값도 없다.
ALTER TABLE situation_fact ADD COLUMN IF NOT EXISTS updated_at timestamptz;
UPDATE situation_fact SET updated_at = collected_at WHERE updated_at IS NULL;
ALTER TABLE situation_fact ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE situation_fact ALTER COLUMN updated_at SET DEFAULT now();
COMMENT ON COLUMN situation_fact.updated_at IS '마지막 보정 시각 (UNE-SIT-008)';

-- 0007의 ix_fact_situation_key_time은 (situation_id, fact_key, observed_at)이라
-- **후보 목록 조회**(상황별 status별 최신순, UNE-SIT-014)를 타지 못한다.
-- 후보 검토 화면의 기본 질의가 이것이므로 전용 인덱스를 둔다.
CREATE INDEX IF NOT EXISTS ix_situation_fact_status_time
  ON situation_fact (situation_id, status, collected_at DESC);

-- Fact는 근거다. 거부는 status='REJECTED'이지 삭제가 아니다 — 지우면 "왜
-- 채택하지 않았는가"에 답할 수 없고, 확정된 Snapshot이 참조하던 행이 사라지면
-- 불변 Snapshot이 가리키는 근거가 증발한다.
REVOKE DELETE ON situation_fact FROM une_app;

-- 중복 억제 유니크 키를 여기서 만들지 않는다. 중복군 계산(UNE-SIT-009)과
-- 충돌 해소는 CC-210의 몫이고, 그 설계가 정해지기 전에 (situation, key, source,
-- observed_at) 같은 키를 박으면 CC-210이 선택할 수 있는 전략을 미리 잘라낸다.
-- CC-200에서 같은 수집을 두 번 눌렀을 때의 보호는 Idempotency-Key(0014)다.

-- ===========================================================================
-- §4. provider_job — 테넌트, 배치, 종결 형태
-- ===========================================================================
-- provider_job.situation_id는 **nullable**이다(0004). UNE-KNOW-002/003이 상황
-- 없는 UNI 학습 Job에도 이 테이블을 쓰기 때문이다. 그러므로 상황을 거쳐
-- 테넌트를 증명하는 정책은 situation_id IS NULL인 행에서 fail-open이 아니라
-- **fail-closed로도 쓸 수 없다** — 그 행들은 정당한데 전부 막힌다.
-- fact_source와 같은 이유로 tenant_id를 세운다.
ALTER TABLE provider_job ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE provider_job ALTER COLUMN tenant_id SET NOT NULL;
COMMENT ON COLUMN provider_job.tenant_id IS '기관 (situation_id가 nullable이므로 직접 보유)';

ALTER TABLE provider_job DROP CONSTRAINT IF EXISTS fk_provider_job_tenant_id;
ALTER TABLE provider_job ADD CONSTRAINT fk_provider_job_tenant_id
  FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED;

-- 배치. provider_code는 **단수**이므로 한 행은 한 Provider의 결과다. 그런데
-- UNE-SIT-005는 여러 Provider를 한 번에 받는다(ProviderQueryRequest.providers
-- 는 배열). 그래서 한 요청이 N개 행을 만들고, 그 N개를 묶는 키가 필요하다.
-- correlation_id로 묶는 안은 쓰지 않았다 — 상관관계 ID는 클라이언트가 주는
-- 값이고 한 요청에 고유하다는 보장이 없다(재시도가 같은 값을 재사용한다).
ALTER TABLE provider_job ADD COLUMN IF NOT EXISTS batch_id uuid;
ALTER TABLE provider_job ALTER COLUMN batch_id SET NOT NULL;
COMMENT ON COLUMN provider_job.batch_id IS '한 UNE-SIT-005 요청이 만든 행들의 묶음';

-- 종결 시각은 NOT NULL이다. 세 상태(§4 아래)가 모두 종결이므로 "아직 안 끝난
-- 행"이라는 것이 존재하지 않는다. 비동기로 옮기면 nullable로 완화하는 것이
-- 아니라 QUEUED/RUNNING 추가와 함께 상관식으로 다시 묶어야 한다.
ALTER TABLE provider_job ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE provider_job ALTER COLUMN finished_at SET NOT NULL;
COMMENT ON COLUMN provider_job.finished_at IS '종결 시각';

-- 상태. 동기 수집이므로(ADR-33 D2) 행은 만들어질 때 이미 종결돼 있다.
-- QUEUED/RUNNING을 넣지 않는 이유가 이것이다 — 0022 §1의 "도달 가능한 상태만"
-- 원칙이고, 비동기로 옮길 때 그 두 값을 추가하는 마이그레이션이 함께 온다.
--   SUCCEEDED  Provider가 응답했고 모든 항목이 정규화를 통과했다
--   PARTIAL    Provider가 응답했으나 일부 항목이 정규화에서 탈락했다
--              (탈락 사유는 error_json, 통과분은 result_count)
--   FAILED     호출 자체가 실패했거나(비활성·차단·오류) 통과 항목이 0이다
ALTER TABLE provider_job DROP CONSTRAINT IF EXISTS ck_provider_job_status;
ALTER TABLE provider_job ADD CONSTRAINT ck_provider_job_status
  CHECK (status IN ('SUCCEEDED', 'PARTIAL', 'FAILED'));

ALTER TABLE provider_job DROP CONSTRAINT IF EXISTS ck_provider_job_provider_code;
ALTER TABLE provider_job ADD CONSTRAINT ck_provider_job_provider_code
  CHECK (provider_code IN ('KMA', 'MOIS', 'SAFEKOREA', 'NAVER', 'MANUAL', 'T3Q', 'UNI'));

ALTER TABLE provider_job DROP CONSTRAINT IF EXISTS ck_provider_job_result_count;
ALTER TABLE provider_job ADD CONSTRAINT ck_provider_job_result_count
  CHECK (result_count >= 0);

-- 상관식. 상태와 증거가 어긋난 행은 만들 수 없다. 이것이 없으면 "성공인데
-- 오류가 있고 결과가 0건인" 행이 감사에 남고, 그 행을 읽는 코드는 무엇을
-- 믿어야 할지 알 수 없다.
ALTER TABLE provider_job DROP CONSTRAINT IF EXISTS ck_provider_job_outcome_shape;
ALTER TABLE provider_job ADD CONSTRAINT ck_provider_job_outcome_shape
  CHECK (
    (status = 'SUCCEEDED' AND error_json IS NULL)
    OR (status = 'PARTIAL' AND error_json IS NOT NULL AND result_count > 0)
    OR (status = 'FAILED'  AND error_json IS NOT NULL AND result_count = 0)
  );

ALTER TABLE provider_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_job FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_provider_job_tenant ON provider_job;
CREATE POLICY p_provider_job_tenant ON provider_job
  USING (tenant_id = une_current_tenant_id())
  WITH CHECK (tenant_id = une_current_tenant_id());

-- 접근 경로 둘: 상황별 수집 이력(최근순)과 배치 단건 조회(UNE-SIT-005 응답
-- 조립·UNE-SIT-015).
CREATE INDEX IF NOT EXISTS ix_provider_job_situation_time
  ON provider_job (tenant_id, situation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_provider_job_batch
  ON provider_job (batch_id);

-- Job은 수집 사실의 기록이다. 종결된 채로 태어나므로 갱신할 것이 없고,
-- 지우면 "그때 무엇을 물었고 무엇이 실패했는가"가 사라진다.
REVOKE UPDATE, DELETE ON provider_job FROM une_app;

-- ===========================================================================
-- §5. provider_result — 원문 페이로드 보존 (신규 테이블)
-- ===========================================================================
-- CLAUDE.md 비협상 규칙: "External provider payloads stay behind adapters and
-- are retained as raw payloads for traceability." 어댑터가 정규화한 결과만
-- 남기면 정규화 로직의 버그를 사후에 증명할 수 없고, Provider가 실제로 무엇을
-- 줬는지 되짚을 방법이 없다.
--
-- 계약(UNE-SIT-006 x-db-tables)이 이 이름을 이미 쓰고 있었다. 이름을 새로
-- 짓지 않고 그 이름을 실체화한다.
CREATE TABLE IF NOT EXISTS provider_result (
  provider_result_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_job_id uuid NOT NULL,
  seq int NOT NULL,
  raw_payload_json jsonb NOT NULL,
  payload_sha256 char(64) NOT NULL,
  item_count int NOT NULL,
  received_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON TABLE provider_result IS 'Provider 원문 응답 보존 (추적성)';
COMMENT ON COLUMN provider_result.provider_job_id IS '수집 Job';
COMMENT ON COLUMN provider_result.seq IS '응답 순번 (페이지네이션 대비, 1부터)';
COMMENT ON COLUMN provider_result.raw_payload_json IS '어댑터가 받은 그대로의 응답';
COMMENT ON COLUMN provider_result.payload_sha256 IS '원문 해시 (변조 탐지·중복 식별)';
COMMENT ON COLUMN provider_result.item_count IS '원문이 담고 있던 항목 수 (정규화 전)';
COMMENT ON COLUMN provider_result.received_at IS '수신 시각';

ALTER TABLE provider_result DROP CONSTRAINT IF EXISTS fk_provider_result_provider_job_id;
ALTER TABLE provider_result ADD CONSTRAINT fk_provider_result_provider_job_id
  FOREIGN KEY (provider_job_id) REFERENCES provider_job(provider_job_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE provider_result DROP CONSTRAINT IF EXISTS ck_provider_result_seq;
ALTER TABLE provider_result ADD CONSTRAINT ck_provider_result_seq
  CHECK (seq >= 1);

ALTER TABLE provider_result DROP CONSTRAINT IF EXISTS ck_provider_result_item_count;
ALTER TABLE provider_result ADD CONSTRAINT ck_provider_result_item_count
  CHECK (item_count >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uk_provider_result_job_seq
  ON provider_result (provider_job_id, seq);

-- 2단 조인(provider_result -> provider_job -> tenant). 0018의 방식대로 중간
-- 테이블의 정책에 기대지 않고 자기 정책식으로 테넌트를 증명한다.
ALTER TABLE provider_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_result FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_provider_result_tenant ON provider_result;
CREATE POLICY p_provider_result_tenant ON provider_result
  USING (EXISTS (
    SELECT 1 FROM provider_job j
    WHERE j.provider_job_id = provider_result.provider_job_id
      AND j.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM provider_job j
    WHERE j.provider_job_id = provider_result.provider_job_id
      AND j.tenant_id = une_current_tenant_id()
  ));

-- 0011의 ALTER DEFAULT PRIVILEGES가 신규 테이블에 기본 권한을 주지만, 이
-- 마이그레이션만 읽고도 권한을 알 수 있도록 명시한다(0017 §4와 같은 취지).
GRANT SELECT, INSERT ON provider_result TO une_app;
-- 원문은 증거다. 고치거나 지울 수 있으면 증거가 아니다.
REVOKE UPDATE, DELETE ON provider_result FROM une_app;

-- une_worker에는 아무 권한도 주지 않는다. CC-200의 수집은 동기 경로이며
-- 워커는 이 테이블들에 닿지 않는다(ADR-33 D2). 닿으면 RLS 이전에 42501로
-- 막히며, 그 상태 자체를 회귀 단언으로 고정한다
-- (tests/integration/src/situation-table-rls.test.ts).

-- ===========================================================================
-- §6. CC-210이 쓸 테이블 — 격리만 미리 닫는다
-- ===========================================================================
-- fact_conflict / conflict_resolution / situation_snapshot에는 CC-200의 쓰기
-- 경로가 없다. 그래도 지금 닫는 이유는 0018 §7이 export_job을 미리 닫은 것과
-- 같다: 테이블이 이미 있고 0011의 일괄 GRANT로 **권한이 이미 열려 있으므로**,
-- 쓰기 경로가 생기기 전에 닫는 것이 이 작업의 취지다. 의미(상태 전이·불변성
-- 검증)는 손에 쥔 CC-210의 몫이고 여기서는 "어느 행에"만 정한다.
ALTER TABLE fact_conflict ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_conflict FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_fact_conflict_tenant ON fact_conflict;
CREATE POLICY p_fact_conflict_tenant ON fact_conflict
  USING (EXISTS (
    SELECT 1 FROM situation s
    WHERE s.situation_id = fact_conflict.situation_id
      AND s.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM situation s
    WHERE s.situation_id = fact_conflict.situation_id
      AND s.tenant_id = une_current_tenant_id()
  ));

ALTER TABLE conflict_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_resolution FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_conflict_resolution_tenant ON conflict_resolution;
CREATE POLICY p_conflict_resolution_tenant ON conflict_resolution
  USING (EXISTS (
    SELECT 1 FROM fact_conflict fc
    JOIN situation s ON s.situation_id = fc.situation_id
    WHERE fc.conflict_id = conflict_resolution.conflict_id
      AND s.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM fact_conflict fc
    JOIN situation s ON s.situation_id = fc.situation_id
    WHERE fc.conflict_id = conflict_resolution.conflict_id
      AND s.tenant_id = une_current_tenant_id()
  ));

-- situation_snapshot은 0011 §3이 이미 REVOKE UPDATE, DELETE로 불변을 걸었다.
-- 격리는 아직 없었다 — 불변인데 전 테넌트가 읽을 수 있는 상태였다.
ALTER TABLE situation_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE situation_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_situation_snapshot_tenant ON situation_snapshot;
CREATE POLICY p_situation_snapshot_tenant ON situation_snapshot
  USING (EXISTS (
    SELECT 1 FROM situation s
    WHERE s.situation_id = situation_snapshot.situation_id
      AND s.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM situation s
    WHERE s.situation_id = situation_snapshot.situation_id
      AND s.tenant_id = une_current_tenant_id()
  ));

-- ===========================================================================
-- §7. 권한 재확인
-- ===========================================================================
-- 기존 테이블 여섯 개의 DML 권한은 0011의 일괄 GRANT 그대로이며, 위에서 건
-- REVOKE(situation_fact DELETE, provider_job UPDATE/DELETE)만 좁혔다.
-- "무엇을 할 수 있나"가 아니라 "어느 행에 할 수 있나"를 정하는 것이 §2~§6의
-- 정책들이다.

-- ===========================================================================
-- §8. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * situation.context_state 컬럼. 설계 06의 SituationContext 상태기계
--     (DRAFT → PROVIDER_QUERYING → CANDIDATE_REVIEW → CONFLICT_OPEN →
--     USER_CONFIRMED)를 컬럼으로 만들지 않았다. 동기 수집에서는
--     PROVIDER_QUERYING이 관측 가능한 상태가 아니고(요청 안에서 시작해 끝난다),
--     나머지 넷은 전부 파생 가능하다 — 후보 Fact가 있는가, OPEN 충돌이 있는가,
--     current_snapshot_id가 있는가. 저장하면 파생값과 저장값이 갈라지고,
--     갈라지면 어느 쪽이 사실인지 답할 수 없다. 비동기로 옮길 때
--     PROVIDER_QUERYING이 실재하게 되며 그때 다시 판단한다(ADR-33 수용 한계).
--   * situation_fact 중복 유니크 키. §3 말미 참조 — CC-210의 결정 공간이다.
--   * provider_result 보존기간·TTL. 원문에는 개인정보가 섞일 수 있고
--     (.claude/rules/security.md의 최소화 대상), 보존 정책은 아직 없다.
--     0020이 file_object에 대해 같은 이유로 미룬 항목과 같은 성격이며
--     OPEN으로 등재한다. 지금 임의의 기간을 박으면 근거 없는 삭제가 된다.
--   * provider_job의 QUEUED/RUNNING. §4 참조 — 비동기 전환과 함께 온다.
--   * fact_duplicate_group 테이블(UNE-SIT-009 x-db-tables). 존재하지 않는다.
--     CC-200이 만들지 않는 이유는 §6과 같다: 중복군의 형태를 정하는 것은
--     계산 전략을 쥔 CC-210이고, 지금 만들면 빈 테이블에 추측한 컬럼이 남는다.
--     계약의 이 드리프트는 CC-210이 닫는다(ADR-33 D6에 인계 사실을 남긴다).
