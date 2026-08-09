-- 0027_payload_redaction_transition_guard.sql (OB-16 후속 — 검토 지적 M-1)
--
-- 0026이 보존 정리 전용 롤에게 네 개의 컬럼 UPDATE를 주고, CHECK로
-- "표식이 있으면 내용은 마스킹 값"을 강제했다. 그 술어는 한 방향만 막는다.
--
--   CHECK (redacted_at IS NULL OR raw_payload_json = '{"redacted": true}')
--
-- 두 갈래가 그대로 통과한다. 실측으로 확인했다(둘 다 성공했다).
--
--   (1) UPDATE provider_result SET raw_payload_json = '{"forged":1}'
--       → redacted_at이 NULL이면 술어의 왼쪽이 참이라 통과한다. 0023 §5가
--         `une_app`에서 UPDATE를 회수하며 지키던 **원문 불변성이 뚫린다.**
--   (2) UPDATE provider_result SET redacted_at = NULL   (이미 비운 행)
--       → 역시 왼쪽이 참이라 통과한다. "원래 비어 있었다"와 "보존기간이
--         지나 비웠다"를 구분하려고 `redacted_at`을 넣었는데 그 목적이
--         그 자리에서 무효가 된다.
--
-- 위반하는 규칙: CLAUDE.md "Corrections are new versions or correction
-- events; never overwrite audit history", .claude/rules/database.md
-- "Execution and audit data are append-only", ADR-33 D4(원문 보존).
--
-- 컬럼 GRANT는 "어느 컬럼을 쓸 수 있는가"만 말하고 "어떤 값으로"는 말하지
-- 못한다. 허용 전이가 하나뿐이므로 트리거로 그 하나를 고정한다.
--
--   (내용 = 원문, redacted_at IS NULL)  →  (내용 = 마스킹 값, redacted_at = 시각)
--
-- 그 외의 모든 UPDATE는 거부한다. 되돌리는 전이도, 두 번 비우는 전이도 없다.
--
-- 테이블 수 변화 없음(63 유지). 롤·정책·권한 변화 없음 — 0026이 준 권한을
-- 좁히는 것이 아니라, 그 권한으로 만들 수 있는 **상태**를 좁힌다.

-- ===========================================================================
-- §1. 왜 롤을 가리지 않는가
-- ===========================================================================
-- 트리거는 `une_retention`뿐 아니라 테이블 소유자에게도 걸린다. 그것이
-- 의도다 — 이 두 테이블의 UPDATE 경로는 저장소 전체에서 보존 정리 하나뿐이고
-- (`services/worker/src/retention/payload-retention.runner.ts`), 나머지 롤은
-- 애초에 UPDATE 권한이 없다. 소유자만 예외로 두면 "마이그레이션으로는 감사
-- 기록을 고칠 수 있다"가 되어 append-only 규칙이 반만 참이 된다.
--
-- 뒷날 정당한 사유로 이 두 테이블을 손봐야 한다면, 그 마이그레이션이
-- `ALTER TABLE … DISABLE TRIGGER`를 명시적으로 적고 그 이유를 남겨야 한다.
-- 그 한 줄이 곧 감사 기록이 된다.

CREATE OR REPLACE FUNCTION une_guard_provider_result_redaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION
      '이미 비운 provider_result 행은 다시 쓸 수 없다 (OB-16, 0027)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.redacted_at IS NULL
     OR NEW.raw_payload_json IS DISTINCT FROM '{"redacted": true}'::jsonb THEN
    RAISE EXCEPTION
      'provider_result에 허용되는 UPDATE는 보존기간 마스킹뿐이다 (OB-16, 0027)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION une_guard_provider_job_redaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION
      '이미 비운 provider_job 행은 다시 쓸 수 없다 (OB-16, 0027)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.redacted_at IS NULL
     OR NEW.request_json IS DISTINCT FROM '{"redacted": true}'::jsonb THEN
    RAISE EXCEPTION
      'provider_job에 허용되는 UPDATE는 보존기간 마스킹뿐이다 (OB-16, 0027)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

-- ===========================================================================
-- §2. 트리거 부착
-- ===========================================================================
DROP TRIGGER IF EXISTS trg_provider_result_redaction_only ON provider_result;
CREATE TRIGGER trg_provider_result_redaction_only
  BEFORE UPDATE ON provider_result
  FOR EACH ROW
  EXECUTE FUNCTION une_guard_provider_result_redaction();

DROP TRIGGER IF EXISTS trg_provider_job_redaction_only ON provider_job;
CREATE TRIGGER trg_provider_job_redaction_only
  BEFORE UPDATE ON provider_job
  FOR EACH ROW
  EXECUTE FUNCTION une_guard_provider_job_redaction();

-- ===========================================================================
-- §3. 오류코드를 42501로 고른 이유
-- ===========================================================================
-- 23514(check_violation)가 아니라 42501(insufficient_privilege)이다. 이것은
-- "값이 제약을 어겼다"가 아니라 "이 주체는 이 전이를 할 수 없다"에 가깝고,
-- 0026이 GRANT로 세운 경계와 같은 언어로 읽히는 편이 낫다. 통합 테스트가
-- 이 코드를 단언한다(`tests/integration/src/payload-retention-grants.test.ts`).
--
-- 0026의 CHECK는 그대로 둔다. 트리거가 우회되는 경로(세션 replication role
-- 등)에서도 "표식이 있는데 내용이 남은" 상태만은 DB가 끝까지 거부한다.
