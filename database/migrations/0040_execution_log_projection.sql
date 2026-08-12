-- 0040_execution_log_projection.sql (CC-290)
--
-- Execution Log 조회·정정과 전자상황판 투영. 설계 09 SCR-BOARD-001,
-- 설계 10 UNE-JNL-001~004.
--
-- `execution_event`는 0006이 만들고 0008이 정책을, 0011이 권한 회수를, 0036이
-- append-only 트리거를 걸었다. 지금까지 **쓰기만** 했고 읽는 경로가 없었다.
-- 여기서 그것을 열되, 읽는 쪽이 기대는 성질(정정 구조·순서)을 DB가 보장하게
-- 만든다.
--
-- 테이블 수 변화 없음(66 유지).

-- ===========================================================================
-- §1. 정정은 **별(star)이지 사슬이 아니다**
-- ===========================================================================
-- 정정의 정정을 허용하면 "지금 사실이 무엇인가"에 답하려고 lineage를 재귀로
-- 따라가야 하고, 중간 한 줄이 빠지면 답이 없다. 대신 `corrects_event_id`는
-- **항상 원본을** 가리키게 하고, 유효본은 "그 원본을 가리키는 정정 중 가장
-- 나중에 기록된 것"으로 O(1)에 정해진다. 두 번 틀려도 답이 있다.
--
-- 정정 이벤트는 **자기 타입**을 갖는다. 원본과 같은 타입이면 타입별 집계가
-- 같은 사실을 두 번 센다. 무엇을 정정했는지는 `corrects_event_id` 조인 한 번
-- 이면 나오므로 타입에서 사라져도 잃는 것이 없다.
ALTER TABLE execution_event DROP CONSTRAINT IF EXISTS ck_execution_event_correction_shape;
ALTER TABLE execution_event ADD CONSTRAINT ck_execution_event_correction_shape
  CHECK ((corrects_event_id IS NULL) = (event_type <> 'EXECUTION_EVENT_CORRECTED'));
COMMENT ON COLUMN execution_event.corrects_event_id IS
  '정정 대상 **원본**. 정정 이벤트만 갖고, 정정을 다시 가리킬 수 없다(0040 §1)';

ALTER TABLE execution_event DROP CONSTRAINT IF EXISTS fk_execution_event_corrects;
ALTER TABLE execution_event ADD CONSTRAINT fk_execution_event_corrects
  FOREIGN KEY (corrects_event_id) REFERENCES execution_event (execution_event_id);

-- 위조 검증값은 형식부터 지킨다(0032가 `graph_hash`에 한 것과 같다).
ALTER TABLE execution_event DROP CONSTRAINT IF EXISTS ck_execution_event_hash;
ALTER TABLE execution_event ADD CONSTRAINT ck_execution_event_hash
  CHECK (event_hash ~ '^[0-9a-f]{64}$');

-- 사슬 금지는 CHECK로 쓸 수 없다(다른 행을 봐야 한다).
CREATE OR REPLACE FUNCTION une_guard_execution_correction_star() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_corrects uuid;
  target_tenant uuid;
  target_situation uuid;
BEGIN
  IF NEW.corrects_event_id IS NULL THEN RETURN NEW; END IF;

  SELECT corrects_event_id, tenant_id, situation_id
    INTO target_corrects, target_tenant, target_situation
    FROM execution_event WHERE execution_event_id = NEW.corrects_event_id;

  IF target_tenant IS NULL THEN
    RAISE EXCEPTION '정정 대상 이벤트가 없다 (0040)' USING ERRCODE = '23503';
  END IF;
  IF target_corrects IS NOT NULL THEN
    -- 정정을 정정하면 lineage가 사슬이 된다. 원본을 다시 정정하면 된다.
    RAISE EXCEPTION '정정 이벤트는 다시 정정할 수 없다 — 원본을 정정하라 (0040)'
      USING ERRCODE = '23514';
  END IF;
  IF target_tenant <> NEW.tenant_id OR target_situation <> NEW.situation_id THEN
    -- 정책이 이미 막지만, 다른 상황의 사실을 정정하는 것은 구조적으로도 금지다.
    RAISE EXCEPTION '다른 기관·상황의 이벤트는 정정할 수 없다 (0040)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_execution_correction_star ON execution_event;
CREATE TRIGGER trg_execution_correction_star
  BEFORE INSERT ON execution_event
  FOR EACH ROW EXECUTE FUNCTION une_guard_execution_correction_star();

-- ===========================================================================
-- §2. 읽는 경로가 기대는 인덱스
-- ===========================================================================
-- 타임라인(UNE-JNL-002)은 상황 단위 시간순이다.
CREATE INDEX IF NOT EXISTS ix_execution_event_timeline
  ON execution_event (situation_id, occurred_at, execution_event_id);

-- 대시보드(UNE-JNL-001)는 **애그리거트별 마지막 이벤트**를 접는다. 임무 상태를
-- 임무 행에서 읽지 않고 이벤트에서 복원하는 것이 이 항목의 결정이다(ADR-43 D1).
CREATE INDEX IF NOT EXISTS ix_execution_event_fold
  ON execution_event (situation_id, aggregate_type, aggregate_id, occurred_at DESC);

-- 정정 lineage.
CREATE INDEX IF NOT EXISTS ix_execution_event_corrects
  ON execution_event (corrects_event_id)
  WHERE corrects_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_execution_event_actor
  ON execution_event (situation_id, actor_id, occurred_at)
  WHERE actor_id IS NOT NULL;

-- ===========================================================================
-- §3. 워커도 사실원장에 쓴다
-- ===========================================================================
-- **릴레이가 임무를 `SENT`로 올리면서 아무 이벤트도 남기지 않았다.** CC-280이
-- 알림 전파에서 고친 것(0039 §1)과 같은 계열의 구멍이다 — 상태가 사실원장
-- 밖에서 움직이면 대시보드가 그 변화를 설명할 수 없고, 시점 재생도 그 임무를
-- 영원히 `CREATED`로 본다.
--
-- CC-290이 대시보드를 **이벤트 재생**으로 만들기 때문에 이 구멍은 이제
-- 기능적 결함이다. 워커에 INSERT를 연다(UPDATE/DELETE는 0011·0036이 막은
-- 그대로다).
GRANT INSERT ON execution_event TO une_worker;
GRANT SELECT ON execution_event TO une_worker;

-- 워커가 상황을 찾으려면 전파를 읽어야 한다. 0037이 이미 열었다.

-- ===========================================================================
-- §4. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * **투영 테이블을 만들지 않았다.** `journal_projection_item`은 상황일지
--     (CC-300)의 것이고, 대시보드는 읽는 시점에 계산한다. 구체화하면 원본과
--     어긋날 수 있고 어긋났을 때 어느 쪽이 참인지 말할 수 없다.
--   * **스냅샷·체크포인트를 만들지 않았다.** 상황 하나의 이벤트 수가 재생을
--     못 할 규모라는 근거가 아직 없다. 느린 것이 측정되면 그때 만든다.
--   * **빠진 과거 이벤트를 소급 합성하지 않았다.** 기한 변경처럼 이벤트가 없는
--     사실은 없는 대로 둔다 — append-only 감사 체계에서 그것이 정직한 답이다.
--     한계는 ADR-43 수용 한계에 적는다.
--   * **전체 이벤트를 잇는 해시 체인을 만들지 않았다.** 1차 방어는 권한 회수와
--     트리거이고, 정정→원본 해시 링크만으로 lineage 무결성은 충족된다.
--   * `recorded_at` 축의 별도 질의(bitemporal)를 만들지 않았다. `at`은
--     `occurred_at` 하나로 해석한다(ADR-43 D2).
