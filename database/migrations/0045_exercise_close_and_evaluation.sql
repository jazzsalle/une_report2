-- 0045 훈련 종료·평가·개선조치 (CC-310, UNE-JNL-012~015).
--
-- 테이블을 만들지 않는다. `evaluation`·`evaluation_score`·`improvement_action`은
-- 0006 기준선에 이미 있고 FK도 0007에 있다. **아무도 쓰지 않았을 뿐이다** —
-- CC-300이 `journal`에서 마주한 것과 같은 상태다. 여기서 더하는 것은 어휘,
-- 산출 근거를 담을 컬럼, 정책, 그리고 얼리는 트리거다.
--
-- 이름에 대하여. 설계 §6.53~6.55는 `eval_evaluation`·`eval_score`·
-- `eval_improvement_action`으로 적고 §3.9와 화면 표는 `evaluation`·
-- `evaluation_score`·`improvement_action`으로 적는다. **DB에 이미 있는 것은
-- 후자**이고(0006), 마이그레이션은 전방으로만 간다. 이름을 바꾸는 것은
-- 데이터 없는 지금도 FK·정책·인덱스를 전부 다시 만드는 일이라, 얻는 것이
-- "설계 문서 한 곳과 글자가 같아진다"뿐이다. 쓰는 이름을 정본으로 삼는다.

-- ===========================================================================
-- §1. 어휘 — 도달 가능한 것만
-- ===========================================================================
-- 0022 §1의 원칙. 설계 06 US-SIT-036이 다섯 상태를 적지만
-- (NOT_STARTED → COLLECTING → REVIEW → APPROVED → ACTION_TRACKING) 그 전이를
-- 만드는 API가 이번 넷에 없다.
--
--   * `NOT_STARTED`는 상태가 아니라 **행이 없는 것**이다.
--   * `COLLECTING`/`REVIEW`를 가르는 연산이 없다.
--   * `ACTION_TRACKING`은 평가의 상태가 아니라 `improvement_action.status`의
--     집계다. 평가 행에 적으면 두 곳이 갈라진다.
--
-- 남는 것은 둘이다: 작성 중(OPEN)과 확정(CONFIRMED). 확정을 넣는 이유는
-- CC-300과 같다 — 확정 없는 평가서는 "누가 무엇에 서명했는가"에 답할 수 없다.
ALTER TABLE evaluation DROP CONSTRAINT IF EXISTS ck_evaluation_status;
ALTER TABLE evaluation ADD CONSTRAINT ck_evaluation_status
  CHECK (status IN ('OPEN', 'CONFIRMED'));
COMMENT ON COLUMN evaluation.status IS
  'OPEN(작성 중)/CONFIRMED(확정·동결). 설계 06의 다섯 상태 중 전이를 만드는 '
  '연산이 있는 둘만 넣었다(0045 §1)';

-- 훈련 평가만 만든다. `USABILITY`는 WP-INTEGRATION-QA-13의 사용성 평가이고
-- 그것을 만드는 경로가 이 항목에 없다.
ALTER TABLE evaluation DROP CONSTRAINT IF EXISTS ck_evaluation_type;
ALTER TABLE evaluation ADD CONSTRAINT ck_evaluation_type
  CHECK (evaluation_type IN ('EXERCISE'));
COMMENT ON COLUMN evaluation.evaluation_type IS
  'EXERCISE만. 설계의 USABILITY(사용성 평가)를 만드는 경로가 이 항목에 없다(0045 §1)';

-- 개선조치는 열리기만 한다. 닫는 API가 이번 넷에 없으므로 `IN_PROGRESS`·
-- `CLOSED`를 어휘에 넣지 않는다 — 넣으면 "언젠가 닫힌다"는 거짓 약속이다.
ALTER TABLE improvement_action DROP CONSTRAINT IF EXISTS ck_improvement_action_status;
ALTER TABLE improvement_action ADD CONSTRAINT ck_improvement_action_status
  CHECK (status IN ('OPEN'));
COMMENT ON COLUMN improvement_action.status IS
  'OPEN만. 종결 경로(담당자 완료보고·승인)는 이 항목에 없다(0045 §1)';

ALTER TABLE improvement_action DROP CONSTRAINT IF EXISTS ck_improvement_action_target;
ALTER TABLE improvement_action ADD CONSTRAINT ck_improvement_action_target
  CHECK (
    (target_type IS NULL AND target_id IS NULL)
    OR (target_type = 'SYSTEM' AND target_id IS NULL)
    OR (target_type IN ('PLAN', 'SOP') AND target_id IS NOT NULL)
  );
COMMENT ON COLUMN improvement_action.target_type IS
  'PLAN/SOP는 대상 id가 있어야 하고 SYSTEM은 없다. **포인터일 뿐이다** — '
  '개선조치는 대상 SOP·계획서를 바꾸지 않는다(US-SIT-036 6단계 "자동변경 금지")';

-- 점수는 있는 그대로. 척도를 DB에 고정하지 않는다 — 지표(`criterion_code`)마다
-- 만점이 다를 수 있고 그 정본은 평가 루브릭이지 이 테이블이 아니다. 다만
-- 가중치는 음수일 수 없다(음의 가중치는 "잘할수록 낮은 점수"라는 뜻이 된다).
ALTER TABLE evaluation_score DROP CONSTRAINT IF EXISTS ck_evaluation_score_weight;
ALTER TABLE evaluation_score ADD CONSTRAINT ck_evaluation_score_weight
  CHECK (weight_value >= 0);

-- ===========================================================================
-- §2. 산출 근거 — 무엇을 보고 계산했는가
-- ===========================================================================
-- KPI는 CC-290의 `computeKpi`가 이벤트 재생으로 계산한다(산출기는 하나다,
-- ADR-43 D1). 평가는 그 값을 **그 시점에 고정**한다 — 승인자가 서명하는
-- 문서이므로 조회할 때마다 숫자가 달라지면 무엇을 확정한 것인지 말할 수 없다.
--
-- 고정하면 원 이벤트가 정정될 때(US-SIT-036 E-02) 낡는다. 그것을 자동으로
-- 다시 계산하지 않는다 — CC-300의 드리프트와 같은 판단이다(ADR-44 D6):
-- **위험한 것은 낡은 숫자가 아니라 낡았다고 말하지 않는 숫자다.** 그래서
-- 계산의 근거를 함께 적어 두고, 조회할 때 지금 값과 비교해 드러낸다.
ALTER TABLE evaluation
  ADD COLUMN IF NOT EXISTS metric_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metric_basis_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

COMMENT ON COLUMN evaluation.metric_json IS
  '산출 시점에 고정한 KPI(CC-290 computeKpi 결과). 조회 때 다시 계산하지 않는다';
COMMENT ON COLUMN evaluation.metric_basis_json IS
  '그 값을 무엇을 보고 냈는가 — 이벤트 수·마지막 이벤트 id·기준 시각. '
  '지금 사실과 비교해 드리프트를 드러낸다(0045 §2)';
COMMENT ON COLUMN evaluation.confirmed_by IS '확정자. 확정 뒤에는 점수·의견이 얼어붙는다';

ALTER TABLE evaluation DROP CONSTRAINT IF EXISTS fk_evaluation_confirmed_by;
ALTER TABLE evaluation ADD CONSTRAINT fk_evaluation_confirmed_by
  FOREIGN KEY (confirmed_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE evaluation DROP CONSTRAINT IF EXISTS ck_evaluation_confirmed;
ALTER TABLE evaluation ADD CONSTRAINT ck_evaluation_confirmed
  CHECK (
    (status = 'CONFIRMED' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status <> 'CONFIRMED' AND confirmed_by IS NULL AND confirmed_at IS NULL)
  );

-- 한 훈련에 평가는 하나다. 둘이면 "그 훈련의 평가 점수"에 답이 둘이 된다.
DROP INDEX IF EXISTS uk_evaluation_situation;
CREATE UNIQUE INDEX uk_evaluation_situation ON evaluation (situation_id);

-- 같은 지표를 두 번 적지 않는다.
DROP INDEX IF EXISTS uk_evaluation_score_criterion;
CREATE UNIQUE INDEX uk_evaluation_score_criterion
  ON evaluation_score (evaluation_id, criterion_code);

-- "이 SOP에 걸린 개선조치"를 찾는 경로. 대상 쪽 테이블에는 컬럼을 만들지
-- 않는다 — 승인된 SOP 판은 불변이고, 대상에 흔적을 넣으면 양방향 결합이 된다.
CREATE INDEX IF NOT EXISTS ix_improvement_action_target
  ON improvement_action (target_type, target_id)
  WHERE target_id IS NOT NULL;

-- ===========================================================================
-- §3. RLS — 세 테이블 모두 상황을 통해 테넌트에 닿는다
-- ===========================================================================
-- 0018의 2단 조인 방식과 같다. 이로써 RLS 커버리지 목록에서 평가 계열 셋이
-- 닫힌다(남는 것은 계획 초안과 IAM 세션·역할배정).
ALTER TABLE evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_evaluation_tenant ON evaluation;
CREATE POLICY p_evaluation_tenant ON evaluation
  FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM situation s
                  WHERE s.situation_id = evaluation.situation_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = evaluation.situation_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE evaluation_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_score FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_evaluation_score_tenant ON evaluation_score;
CREATE POLICY p_evaluation_score_tenant ON evaluation_score
  FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM evaluation e JOIN situation s USING (situation_id)
                  WHERE e.evaluation_id = evaluation_score.evaluation_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM evaluation e JOIN situation s USING (situation_id)
                       WHERE e.evaluation_id = evaluation_score.evaluation_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE improvement_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE improvement_action FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_improvement_action_tenant ON improvement_action;
CREATE POLICY p_improvement_action_tenant ON improvement_action
  FOR ALL TO PUBLIC
  USING (EXISTS (SELECT 1 FROM evaluation e JOIN situation s USING (situation_id)
                  WHERE e.evaluation_id = improvement_action.evaluation_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM evaluation e JOIN situation s USING (situation_id)
                       WHERE e.evaluation_id = improvement_action.evaluation_id
                         AND s.tenant_id = une_current_tenant_id()));

-- ===========================================================================
-- §4. 확정된 평가는 얼어붙는다
-- ===========================================================================
-- 0042 §6이 일지에 건 것과 같은 형태다. 서비스 층 가드만으로는 다음 항목이
-- 새 경로를 열 때 조용히 뚫린다 — CC-300 이중검토가 실제로 그 구멍을 찾았다.
CREATE OR REPLACE FUNCTION une_guard_evaluation_confirmed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status text;
BEGIN
  IF TG_TABLE_NAME = 'evaluation' THEN
    -- 확정으로 **들어가는** 전이는 허용한다. 확정된 것을 바꾸는 것만 막는다.
    IF OLD.status = 'CONFIRMED' THEN
      RAISE EXCEPTION '확정된 평가는 바꿀 수 없다 — 정정은 새 평가다 (0045)'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO current_status FROM evaluation
    WHERE evaluation_id = CASE WHEN TG_OP = 'DELETE'
                               THEN OLD.evaluation_id ELSE NEW.evaluation_id END;
  IF current_status = 'CONFIRMED' THEN
    RAISE EXCEPTION '확정된 평가의 점수·개선조치는 바꿀 수 없다 (0045)'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_evaluation_confirmed ON evaluation;
CREATE TRIGGER trg_evaluation_confirmed
  BEFORE UPDATE OR DELETE ON evaluation
  FOR EACH ROW EXECUTE FUNCTION une_guard_evaluation_confirmed();

DROP TRIGGER IF EXISTS trg_evaluation_score_confirmed ON evaluation_score;
CREATE TRIGGER trg_evaluation_score_confirmed
  BEFORE INSERT OR UPDATE OR DELETE ON evaluation_score
  FOR EACH ROW EXECUTE FUNCTION une_guard_evaluation_confirmed();

DROP TRIGGER IF EXISTS trg_improvement_action_confirmed ON improvement_action;
CREATE TRIGGER trg_improvement_action_confirmed
  BEFORE INSERT OR UPDATE OR DELETE ON improvement_action
  FOR EACH ROW EXECUTE FUNCTION une_guard_evaluation_confirmed();

-- ===========================================================================
-- §5. 종료된 상황의 사실원장은 얼되, 정정은 열어 둔다
-- ===========================================================================
-- 이 항목에서 가장 조용히 틀리기 쉬운 자리다.
--
-- US-SIT-035는 종료가 "최종 기준선을 고정한다"고 하고, US-SIT-036 E-02는
-- **평가 중에 원 이벤트가 정정될 수 있다**고 한다. 둘 다 참이어야 한다.
-- 아무것도 막지 않으면 종료 뒤에 새 사실이 새어 들어와 최종 기준선이 거짓이
-- 되고, 전부 막으면 정정이 죽어 잘못된 사실을 고칠 길이 사라진다.
--
-- 그래서 갈랐다: 종료된 상황에는 **새 관측을 쓸 수 없고, 정정과 종료 사건만**
-- 쓸 수 있다. 정정은 원본을 지우지 않고 star로 붙으므로(ADR-43 D4) 기준선을
-- 무너뜨리지 않는다 — 무엇이 언제 고쳐졌는지가 그대로 남는다.
CREATE OR REPLACE FUNCTION une_guard_closed_situation_events() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  situation_status text;
BEGIN
  SELECT status INTO situation_status FROM situation
    WHERE situation_id = NEW.situation_id;
  IF situation_status = 'CLOSED'
     AND NEW.event_type NOT IN ('EXECUTION_EVENT_CORRECTED', 'SITUATION_CLOSED') THEN
    RAISE EXCEPTION
      '종료된 상황에는 새 사실을 쓸 수 없다 — 정정(EXECUTION_EVENT_CORRECTED)만 가능하다 (0045)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_execution_event_closed_situation ON execution_event;
CREATE TRIGGER trg_execution_event_closed_situation
  BEFORE INSERT ON execution_event
  FOR EACH ROW EXECUTE FUNCTION une_guard_closed_situation_events();

-- ===========================================================================
-- §6. 권한
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON evaluation TO une_app;
GRANT SELECT, INSERT ON evaluation_score TO une_app;
GRANT SELECT, INSERT ON improvement_action TO une_app;
-- 점수·개선조치는 고쳐 쓰지 않는다. 평가가 OPEN인 동안 다시 내면 지우고 다시
-- 넣는 것이 아니라 **새 평가를 만든다**(uk_evaluation_situation이 하나로
-- 묶으므로, 다시 내려면 확정 전에 같은 평가에 지표를 더한다).
REVOKE UPDATE, DELETE ON evaluation_score FROM une_app;
REVOKE UPDATE, DELETE ON improvement_action FROM une_app;
REVOKE DELETE ON evaluation FROM une_app;

-- ---------------------------------------------------------------------------
-- 요약.
--   * 테이블 수는 그대로다(68). 0006이 만든 셋에 어휘·정책·트리거를 걸었다.
--   * 어휘는 도달 가능한 것만: evaluation OPEN/CONFIRMED, type EXERCISE,
--     improvement_action OPEN.
--   * KPI는 CC-290 산출기 하나를 쓰고, 값과 **근거**를 함께 고정한다.
--   * 확정된 평가는 DB가 얼린다.
--   * 종료된 상황은 새 사실을 받지 않고 정정만 받는다.
-- ---------------------------------------------------------------------------
