-- 0046 종료·확정 가드를 fail-closed로 (CC-310 이중검토 V-9).
--
-- 0045 §4·§5의 두 함수는 부모 행이 **보이지 않으면 그냥 통과**했다.
--
--     SELECT status INTO current_status FROM evaluation WHERE ...;
--     IF current_status = 'CONFIRMED' THEN RAISE ...
--
-- `SELECT ... INTO`는 행이 없으면 NULL을 넣고 계속 간다. 이 함수들은
-- `SECURITY DEFINER`가 아니라 **호출자의 RLS를 받으므로**, 테넌트 문맥이 없는
-- 세션이나 다른 테넌트의 문맥에서는 부모가 보이지 않고 → 가드가 통과한다.
--
-- 0031 §5가 정확히 같은 함정을 발견하고 fail-closed로 고쳤다("보이지 않는 것과
-- 없는 것을 같게 다루면 방어가 조용히 사라진다"). 같은 판단을 여기에도 적용한다.
--
-- 덧붙여 `execution_event.tenant_id`와 `situation.tenant_id`가 어긋난 삽입은
-- 상황이 보이지 않아 종료 가드를 통과했다. 이제 그것도 막힌다 — 애초에
-- 그런 행은 만들어져서는 안 된다.

CREATE OR REPLACE FUNCTION une_guard_evaluation_confirmed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status text;
BEGIN
  IF TG_TABLE_NAME = 'evaluation' THEN
    IF OLD.status = 'CONFIRMED' THEN
      RAISE EXCEPTION '확정된 평가는 바꿀 수 없다 — 정정은 새 평가다 (0045)'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO current_status FROM evaluation
    WHERE evaluation_id = CASE WHEN TG_OP = 'DELETE'
                               THEN OLD.evaluation_id ELSE NEW.evaluation_id END;
  -- **보이지 않으면 막는다.** 통과시키면 테넌트 문맥 없는 경로가 확정된 평가의
  -- 점수를 고칠 수 있다.
  IF NOT FOUND THEN
    RAISE EXCEPTION '평가를 확인할 수 없어 거절한다 (0046)' USING ERRCODE = '42501';
  END IF;
  IF current_status = 'CONFIRMED' THEN
    RAISE EXCEPTION '확정된 평가의 점수·개선조치는 바꿀 수 없다 (0045)'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION une_guard_closed_situation_events() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  situation_status text;
  situation_tenant uuid;
BEGIN
  SELECT status, tenant_id INTO situation_status, situation_tenant
    FROM situation WHERE situation_id = NEW.situation_id;

  -- 상황이 보이지 않으면 종료 여부를 알 수 없다. 모르는 채로 통과시키면
  -- 이 가드는 테넌트 문맥이 있는 경로에만 걸리는 반쪽 방어가 된다.
  IF NOT FOUND THEN
    RAISE EXCEPTION '상황을 확인할 수 없어 사실원장 기록을 거절한다 (0046)'
      USING ERRCODE = '42501';
  END IF;

  -- 이벤트의 테넌트와 상황의 테넌트가 다르면 애초에 만들어져서는 안 되는 행이다.
  IF situation_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION '이벤트의 기관과 상황의 기관이 다르다 (0046)' USING ERRCODE = '42501';
  END IF;

  IF situation_status = 'CLOSED'
     AND NEW.event_type NOT IN ('EXECUTION_EVENT_CORRECTED', 'SITUATION_CLOSED') THEN
    RAISE EXCEPTION
      '종료된 상황에는 새 사실을 쓸 수 없다 — 정정(EXECUTION_EVENT_CORRECTED)만 가능하다 (0045)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
