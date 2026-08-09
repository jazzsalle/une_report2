-- 0026_situation_payload_retention.sql (CC-200/210 후속 — OB-16 종결)
--
-- 0023 §5가 Provider 원문(`provider_result.raw_payload_json`)을, §4가 사용자
-- 조회조건(`provider_job.request_json`)을 보존하게 만들었다. 둘 다 **영구**
-- 였고 그것이 OB-16이다.
--
-- 두 규칙이 정면으로 부딪히는 자리다.
--   CLAUDE.md  "External provider payloads … are retained as raw payloads
--              for traceability"
--   security.md "Mask or minimize personal information in UI, logs, exports,
--              and provider requests"
--
-- 사용자 결정(2026-08-09): **1개월 뒤 페이로드만 비우고 해시·항목수·시각은
-- 남긴다.** 감사가 실제로 묻는 것은 "무엇을 받았다고 주장하느냐"이고 그건
-- 해시로 답할 수 있다. 행을 통째로 지우면 "그때 무엇을 물었는가"까지 사라진다.
--
-- `request_json` 쪽도 대상인 이유: `query`는 형태가 정해지지 않은 객체이고
-- 사용자가 주소·성명·연락처를 검색조건에 넣으면 그대로 남는다.
--
-- 테이블 수 변화 없음(63 유지).

-- ===========================================================================
-- §1. 비운 사실 자체를 기록한다
-- ===========================================================================
-- `redacted_at`이 없으면 "원래 비어 있었다"와 "보존기간이 지나 비웠다"를
-- 구분할 수 없다. 감사에서 그 둘은 전혀 다른 사실이다.
ALTER TABLE provider_result ADD COLUMN IF NOT EXISTS redacted_at timestamptz;
COMMENT ON COLUMN provider_result.redacted_at IS '원문을 비운 시각 (보존기간 경과, OB-16)';

ALTER TABLE provider_job ADD COLUMN IF NOT EXISTS redacted_at timestamptz;
COMMENT ON COLUMN provider_job.redacted_at IS '요청 조건을 비운 시각 (보존기간 경과, OB-16)';

-- 비운 행은 표식을 갖는다. 반대로 표식이 있는데 내용이 남아 있는 상태도
-- 만들 수 없다 — 아래 §3의 컬럼 단위 GRANT가 둘을 함께만 쓰게 한다.
ALTER TABLE provider_result DROP CONSTRAINT IF EXISTS ck_provider_result_redaction_shape;
ALTER TABLE provider_result ADD CONSTRAINT ck_provider_result_redaction_shape
  CHECK (redacted_at IS NULL OR raw_payload_json = '{"redacted": true}'::jsonb);

ALTER TABLE provider_job DROP CONSTRAINT IF EXISTS ck_provider_job_redaction_shape;
ALTER TABLE provider_job ADD CONSTRAINT ck_provider_job_redaction_shape
  CHECK (redacted_at IS NULL OR request_json = '{"redacted": true}'::jsonb);

-- 만료 대상 조회 경로: "받은 지 N일이 지났고 아직 안 비운 것".
CREATE INDEX IF NOT EXISTS ix_provider_result_retention
  ON provider_result (received_at)
  WHERE redacted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_provider_job_retention
  ON provider_job (created_at)
  WHERE redacted_at IS NULL;

-- ===========================================================================
-- §2. 전용 롤 — 워커에 권한을 주지 않는다
-- ===========================================================================
-- ADR-33 D2의 따름정리가 "워커는 이 테이블들에 닿지 않는다"이고
-- `situation-table-rls.test.ts`가 `une_worker`의 42501을 회귀로 고정한다.
-- 보존 작업을 위해 그 롤에 권한을 주면 그 결정이 조용히 뒤집힌다.
--
-- 그래서 **하는 일이 하나뿐인 롤**을 만든다. `une_app`도 아니고 `une_worker`도
-- 아니다 — 최소권한(.claude/rules/security.md)이 이 형태를 요구한다.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'une_retention') THEN
    CREATE ROLE une_retention NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- 외부에서 만들어졌더라도 RLS 우회 속성은 갖지 못하게 한다(0011 §1과 같은 취지).
ALTER ROLE une_retention NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO une_retention;

-- 0011의 일괄 GRANT는 `une_app`에만 걸렸으므로 이 롤에는 아무것도 없다.
-- 필요한 것만 준다.
GRANT SELECT ON provider_result TO une_retention;
GRANT SELECT ON provider_job TO une_retention;

-- ===========================================================================
-- §3. 컬럼 단위 UPDATE — 증거 필드는 여전히 불변이다
-- ===========================================================================
-- 이것이 이 마이그레이션의 핵심이다. 페이로드와 표식**만** 쓸 수 있고
-- `payload_sha256`·`item_count`·`received_at`·`status`·`result_count`는
-- 건드릴 수 없다. "무엇을 받았다고 주장하느냐"는 그대로 남는다.
GRANT UPDATE (raw_payload_json, redacted_at) ON provider_result TO une_retention;
GRANT UPDATE (request_json, redacted_at) ON provider_job TO une_retention;

-- `une_app`은 그대로 둔다 — 0023이 회수한 UPDATE/DELETE는 회수된 채다.
-- 애플리케이션은 보존 작업을 할 수 없고, 보존 작업은 애플리케이션이 할 수
-- 있는 다른 일을 할 수 없다.

-- ===========================================================================
-- §4. RLS — 우회가 아니라 명시적 정책으로 전 테넌트를 본다
-- ===========================================================================
-- 보존 작업은 테넌트를 가리지 않는다. `NOBYPASSRLS`를 유지한 채 그것을
-- 가능하게 하는 방법은 **그 롤을 대상으로 하는 정책**을 따로 두는 것이다.
-- BYPASSRLS를 주면 "왜 전부 보이는가"가 롤 속성에 숨고, 정책으로 두면
-- `pg_policies`에 드러난다.
DROP POLICY IF EXISTS p_provider_result_retention ON provider_result;
CREATE POLICY p_provider_result_retention ON provider_result
  TO une_retention
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS p_provider_job_retention ON provider_job;
CREATE POLICY p_provider_job_retention ON provider_job
  TO une_retention
  USING (true)
  WITH CHECK (true);

-- 기존 테넌트 정책은 `TO` 절이 없어 모든 롤에 적용되지만, 정책은 기본이
-- permissive라 OR로 합쳐진다. `une_app`에게는 여전히 자기 테넌트만 보인다
-- (그 롤에는 위 정책의 대상 자격이 없다).

-- ===========================================================================
-- §5. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * 보존기간 값을 DB에 박지 않았다. 1개월은 **운영 설정**
--     (`UNE_PAYLOAD_RETENTION_DAYS`, 기본 30)이며 마이그레이션에 상수로
--     넣으면 바꿀 때마다 마이그레이션이 필요해진다.
--   * 자동 스케줄(pg_cron 등)을 걸지 않았다. 실행 주체는 워커 프로세스이며,
--     그래야 실행 사실이 애플리케이션 로그·감사와 같은 자리에 남는다.
--   * `file_object`(0020이 같은 이유로 미룬 항목)는 대상이 아니다. 그쪽은
--     오브젝트 저장소 객체까지 함께 정리해야 하므로 별도 판단이 필요하다.
--   * 삭제(DELETE)를 주지 않았다. 행이 사라지면 "그때 무엇을 물었고 어떤
--     해시였는가"가 함께 사라진다 — 그것이 이 결정의 반대편이다.
