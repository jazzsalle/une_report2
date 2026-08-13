-- ===========================================================================
-- 0047. 실행 방식은 상황 방식보다 더 실제일 수 없다 (CC-320 V-2, ADR-46 D1)
-- ===========================================================================
--
-- CC-320 수직 슬라이스가 실측한 것.
--
-- ADR-41 D9는 훈련이 실제 문자를 보내지 못하게 `dispatchesForReal(run.mode)`로
-- 막는다. 그런데 실행을 만드는 쪽(`SopRunService.createRun`)이 `run.mode`를
-- **`situation.mode`와 대조하지 않았다.** 그래서 `mode='EXERCISE'` 상황에
-- `mode='LIVE'` 실행을 열 수 있었고, 그 실행의 임무는 전파 게이트를 그대로
-- 통과한다 — 훈련이 실제 문자를 보낸다.
--
-- 방어를 API에만 두지 않는 이유는 앞선 항목들과 같다. 워커·보정 스크립트·
-- 앞으로 생길 다른 경로가 같은 실수를 하지 못해야 하고, "요청 시점 검증"은
-- 한 벌 더 있어도 손해가 없다(0039 §1이 같은 형태로 임무 상태를 지켰다).
--
-- 규칙: 상황이 EXERCISE면 LIVE 실행을 만들 수 없다. 반대 방향(실사건에서
-- 훈련·모의 실행)은 막지 않는다 — 그쪽은 덜 실제이므로 밖으로 나가는 것이
-- 없고, 실제 대응과 나란히 도는 연습을 금지할 이유가 없다.
--
-- 되돌리기: 아래 트리거와 함수를 DROP하면 0046 상태로 돌아간다. 데이터
-- 변경이 없으므로 전방 수정만으로 충분하다.

CREATE OR REPLACE FUNCTION une_guard_run_mode_within_situation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  situation_mode text;
BEGIN
  SELECT mode INTO situation_mode FROM situation
    WHERE situation_id = NEW.situation_id;

  -- 상황을 못 찾으면 여기서 판단하지 않는다. FK가 이미 그 자리를 지킨다.
  IF situation_mode IS NULL THEN
    RETURN NEW;
  END IF;

  IF situation_mode = 'EXERCISE' AND NEW.mode = 'LIVE' THEN
    RAISE EXCEPTION
      '훈련(EXERCISE) 상황에서는 LIVE 실행을 만들 수 없다 — 훈련이 실제 전파를 낸다 (0047)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION une_guard_run_mode_within_situation() IS
  'CC-320 V-2: 실행 방식이 상황 방식보다 더 실제일 수 없다. ADR-41 D9의 전파 방어가 비껴가는 것을 막는다.';

DROP TRIGGER IF EXISTS trg_run_mode_within_situation ON sop_run;
CREATE TRIGGER trg_run_mode_within_situation
  BEFORE INSERT OR UPDATE OF mode, situation_id ON sop_run
  FOR EACH ROW EXECUTE FUNCTION une_guard_run_mode_within_situation();

-- ---------------------------------------------------------------------------
-- 기존 행 점검
-- ---------------------------------------------------------------------------
-- 이미 어긋난 행이 있으면 트리거를 걸어도 조용히 남는다(트리거는 앞으로만
-- 본다). 있으면 기동을 멈춘다 — 훈련이 실제 전파를 냈다는 뜻이므로 사람이
-- 봐야 한다.
DO $$
DECLARE
  offending int;
BEGIN
  SELECT count(*) INTO offending
    FROM sop_run r JOIN situation s ON s.situation_id = r.situation_id
   WHERE s.mode = 'EXERCISE' AND r.mode = 'LIVE';
  IF offending > 0 THEN
    RAISE EXCEPTION
      '훈련 상황에 LIVE 실행이 %건 있다. 0047을 적용하기 전에 사람이 확인해야 한다.', offending
      USING ERRCODE = '23514';
  END IF;
END $$;
