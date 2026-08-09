-- 0029_redaction_guard_allows_lifecycle.sql (CC-220)
--
-- 0027이 `provider_job`/`provider_result`에 건 트리거가 **너무 넓다.**
--
-- 0027을 쓸 때의 근거는 실측이었다 — "이 두 테이블의 UPDATE 경로는 저장소
-- 전체에서 보존 정리 하나뿐"이었고 그래서 허용 전이를 하나로 고정했다. 그
-- 진술은 그때 참이었고 지금은 거짓이다. CC-220이 두 번째 정당한 쓰기 경로를
-- 만든다: 워커가 UNI 잡을 QUEUED → RUNNING → SUCCEEDED/FAILED로 옮긴다
-- (0028 §1, 설계 10 §7.23 7단계).
--
-- 지금 상태로는 워커의 첫 UPDATE가 42501로 죽는다(실측: e2e 7건 실패).
--
-- **좁히되 0027이 막은 두 구멍은 그대로 닫아 둔다.** 0027이 실측으로 확인한
-- 통과 경로는 두 가지였다.
--   (1) UPDATE ... SET raw_payload_json = '{"forged":1}'  (redacted_at은 NULL)
--   (2) UPDATE ... SET redacted_at = NULL                 (이미 비운 행)
--
-- 그 둘은 **페이로드 컬럼과 표식 컬럼**에 관한 것이지 상태·건수·종료시각에
-- 관한 것이 아니었다. 그래서 규칙을 그 두 컬럼으로 한정한다.
--
--   OLD.redacted_at IS NOT NULL  → 어떤 변경도 없다 (비운 행은 끝났다)
--   NEW.redacted_at IS NOT NULL  → 마스킹 전이여야 한다 (내용 = 마스킹 값)
--   그 외                         → 페이로드 컬럼이 **변하지 않아야** 한다.
--                                   나머지 컬럼은 자유다.
--
-- (1)은 세 번째 갈래가 막는다(내용이 변했는데 표식이 없다). (2)는 첫 갈래가
-- 막는다. 상태 전이는 세 번째 갈래를 통과한다 — 페이로드를 건드리지 않으므로.
--
-- 테이블·롤·권한 변화 없음. 함수 본문만 바꾼다(트리거는 그대로 붙어 있다).

CREATE OR REPLACE FUNCTION une_guard_provider_result_redaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.redacted_at IS NOT NULL THEN
    RAISE EXCEPTION
      '이미 비운 provider_result 행은 다시 쓸 수 없다 (OB-16, 0027/0029)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.redacted_at IS NOT NULL THEN
    -- 마스킹 전이. 내용이 정확히 마스킹 값이어야 한다.
    IF NEW.raw_payload_json IS DISTINCT FROM '{"redacted": true}'::jsonb THEN
      RAISE EXCEPTION
        '표식을 세우려면 내용이 마스킹 값이어야 한다 (OB-16, 0029)'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- 마스킹이 아닌 UPDATE. 원문은 불변이다.
  IF NEW.raw_payload_json IS DISTINCT FROM OLD.raw_payload_json THEN
    RAISE EXCEPTION
      'provider_result 원문은 보존기간 마스킹으로만 바뀔 수 있다 (0023 §5, 0029)'
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
      '이미 비운 provider_job 행은 다시 쓸 수 없다 (OB-16, 0027/0029)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.redacted_at IS NOT NULL THEN
    IF NEW.request_json IS DISTINCT FROM '{"redacted": true}'::jsonb THEN
      RAISE EXCEPTION
        '표식을 세우려면 요청 조건이 마스킹 값이어야 한다 (OB-16, 0029)'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- 상태 전이(QUEUED → RUNNING → 종결)는 여기를 지난다. 요청 조건만 불변이다.
  IF NEW.request_json IS DISTINCT FROM OLD.request_json THEN
    RAISE EXCEPTION
      'provider_job 요청 조건은 보존기간 마스킹으로만 바뀔 수 있다 (0023 §4, 0029)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

-- ===========================================================================
-- 남는 질문 하나 — 종결된 잡의 상태를 되돌릴 수 있는가
-- ===========================================================================
-- 이 트리거는 막지 않는다.
--
-- **정정(0030, 아키텍처 검토 M2)**: 여기 "`une_worker`는 0028 §6의 정책이
-- 미종결 행만 보여주므로 종결된 잡을 다시 집을 수 없다 … 지금은 도달 경로가
-- 없다"고 적었는데 **도달 경로가 있었다.** 그 정책은 테넌트 미설정을
-- 요구하는데 정산은 테넌트 스코프에서 한다 — 그 트랜잭션에서 워커가
-- SUCCEEDED 잡을 QUEUED로 되돌리는 것을 실측했다.
--
-- 0030이 제한 정책 `p_provider_job_worker_open_only`로 닫았고 회귀 단언을
-- `situation-table-rls.test.ts`에 남겼다. 상태 자체의 단방향성(종결 → 재개를
-- DB가 금지하는 것)은 여전히 별도 항목이다.
