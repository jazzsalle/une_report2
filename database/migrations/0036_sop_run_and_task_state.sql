-- 0036_sop_run_and_task_state.sql (CC-260)
--
-- SOP 실행(SopRun)과 임무(Task)의 명시적 상태기계.
-- 설계 09 "SOP Execution"·"Task" 상태표, 설계 10 UNE-SOP-010~016, 마스터 §22.
--
-- 0005가 만든 `sop_run`·`task`·`task_event`에는 어휘 CHECK도 FK도 **RLS 정책도**
-- 없었다. `rls-coverage.test.ts`가 고정한 18개 목록 중 셋을 여기서 닫는다 —
-- "그 항목이 자기 테이블을 열 때 함께 닫는다"는 CC-250의 약속이다.
--
-- 테이블 수 변화 없음(65 유지).

-- ===========================================================================
-- §1. 어휘 — **이번에 도달 가능해지는 것만**
-- ===========================================================================
-- 설계 09의 실행 상태는 여섯이다(READY/RUNNING/PAUSED/COMPLETED/TERMINATED/
-- FAILED). 그중 CC-260이 만들 수 있는 것은 넷뿐이다:
--
--   READY       실행을 만들었으나 아직 시작 전(DRY_RUN 준비 포함)
--   RUNNING     시작됨
--   PAUSED      UNE-SOP-014
--   TERMINATED  UNE-SOP-016
--
-- `COMPLETED`는 **모든 임무가 끝나야** 도달하는데 완료 보고 경로가 CC-280이다.
-- `FAILED`도 그 경로에서 온다. 지금 넣으면 그 값을 만드는 코드가 없는 채로
-- 어휘만 남는다(0022 §1) — 0032가 `sop.status`에 한 것과 같고, 0035가
-- 예고대로 넓힌 것과 같은 방식으로 CC-280이 넓힌다.
ALTER TABLE sop_run DROP CONSTRAINT IF EXISTS ck_sop_run_status;
ALTER TABLE sop_run ADD CONSTRAINT ck_sop_run_status
  CHECK (status IN ('READY', 'RUNNING', 'PAUSED', 'TERMINATED'));
COMMENT ON COLUMN sop_run.status IS 'READY/RUNNING/PAUSED/TERMINATED. COMPLETED·FAILED는 완료 보고(CC-280)가 연다';

ALTER TABLE sop_run DROP CONSTRAINT IF EXISTS ck_sop_run_mode;
ALTER TABLE sop_run ADD CONSTRAINT ck_sop_run_mode
  CHECK (mode IN ('LIVE', 'EXERCISE', 'DRY_RUN'));

-- 끝난 실행만 종료시각을 갖는다. 반대로 끝났는데 시각이 없으면 "언제
-- 끝났는가"에 답할 수 없다.
ALTER TABLE sop_run DROP CONSTRAINT IF EXISTS ck_sop_run_ended_shape;
ALTER TABLE sop_run ADD CONSTRAINT ck_sop_run_ended_shape
  CHECK ((status = 'TERMINATED') = (ended_at IS NOT NULL));

-- 임무 상태도 같은 규칙이다. CC-260이 만드는 것은 생성과 취소뿐이다 —
-- 전파(SENT/DELIVERED)는 CC-270, 수행(ACKNOWLEDGED~COMPLETED)은 CC-280이다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS ck_task_status;
ALTER TABLE task ADD CONSTRAINT ck_task_status
  CHECK (status IN ('CREATED', 'CANCELLED'));
COMMENT ON COLUMN task.status IS 'CREATED/CANCELLED. SENT/DELIVERED는 전파(CC-270), ACKNOWLEDGED~COMPLETED는 수행(CC-280)이 연다';

ALTER TABLE task DROP CONSTRAINT IF EXISTS ck_task_progress;
ALTER TABLE task ADD CONSTRAINT ck_task_progress
  CHECK (progress_pct >= 0 AND progress_pct <= 100);

ALTER TABLE task DROP CONSTRAINT IF EXISTS ck_task_version_no;
ALTER TABLE task ADD CONSTRAINT ck_task_version_no CHECK (version_no >= 1);

-- ===========================================================================
-- §2. 활성화 — "만들어진 임무"와 "지금 해야 하는 임무"는 다르다
-- ===========================================================================
-- 실행을 시작하면 승인된 그래프의 ACTION 노드 전부가 임무로 만들어진다. 그러나
-- 그 순간 수행 대상인 것은 **시작 노드에서 곧바로 닿는 것**뿐이다. 둘을 상태로
-- 구분하지 않는 이유: 설계 09의 임무 상태 어휘에 "활성"이 없고, 전파 상태
-- (SENT)와 섞으면 "보냈다"와 "해야 한다"가 한 값에 눌린다.
--
-- 그래서 시각 컬럼으로 남긴다. NULL이면 아직 차례가 아니다.
ALTER TABLE task ADD COLUMN IF NOT EXISTS activated_at timestamptz;
COMMENT ON COLUMN task.activated_at IS '수행 차례가 된 시각. NULL이면 선행 임무가 남아 있다';

-- 한 실행 안에서 노드 하나는 임무 하나다. 둘이면 "그 절차 단계를 했는가"에
-- 답이 둘이 된다.
DROP INDEX IF EXISTS uk_task_run_node;
CREATE UNIQUE INDEX uk_task_run_node ON task (run_id, node_id);

CREATE INDEX IF NOT EXISTS ix_task_run_status ON task (run_id, status);
CREATE INDEX IF NOT EXISTS ix_task_assignee ON task (assignee_user_id, status)
  WHERE assignee_user_id IS NOT NULL;

-- ===========================================================================
-- §3. 관계
-- ===========================================================================
ALTER TABLE sop_run DROP CONSTRAINT IF EXISTS fk_sop_run_version;
ALTER TABLE sop_run ADD CONSTRAINT fk_sop_run_version
  FOREIGN KEY (sop_version_id) REFERENCES sop_version (sop_version_id);

ALTER TABLE sop_run DROP CONSTRAINT IF EXISTS fk_sop_run_situation;
ALTER TABLE sop_run ADD CONSTRAINT fk_sop_run_situation
  FOREIGN KEY (situation_id) REFERENCES situation (situation_id);

ALTER TABLE sop_run DROP CONSTRAINT IF EXISTS fk_sop_run_snapshot;
ALTER TABLE sop_run ADD CONSTRAINT fk_sop_run_snapshot
  FOREIGN KEY (snapshot_id) REFERENCES situation_snapshot (snapshot_id);

ALTER TABLE sop_run DROP CONSTRAINT IF EXISTS fk_sop_run_started_by;
ALTER TABLE sop_run ADD CONSTRAINT fk_sop_run_started_by
  FOREIGN KEY (started_by) REFERENCES app_user (user_id);

CREATE INDEX IF NOT EXISTS ix_sop_run_situation ON sop_run (situation_id, started_at DESC);

ALTER TABLE task DROP CONSTRAINT IF EXISTS fk_task_run;
ALTER TABLE task ADD CONSTRAINT fk_task_run
  FOREIGN KEY (run_id) REFERENCES sop_run (run_id) ON DELETE CASCADE;

-- 임무는 **고정된 버전의 노드**를 가리킨다. 승인 뒤 그래프가 불변이므로
-- (0035 §3) 이 참조는 시간이 지나도 같은 것을 가리킨다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS fk_task_node;
ALTER TABLE task ADD CONSTRAINT fk_task_node
  FOREIGN KEY (node_id) REFERENCES sop_node (node_id);

ALTER TABLE task DROP CONSTRAINT IF EXISTS fk_task_assignee_user;
ALTER TABLE task ADD CONSTRAINT fk_task_assignee_user
  FOREIGN KEY (assignee_user_id) REFERENCES app_user (user_id);

ALTER TABLE task_event DROP CONSTRAINT IF EXISTS fk_task_event_task;
ALTER TABLE task_event ADD CONSTRAINT fk_task_event_task
  FOREIGN KEY (task_id) REFERENCES task (task_id) ON DELETE CASCADE;

ALTER TABLE task_event DROP CONSTRAINT IF EXISTS fk_task_event_actor;
ALTER TABLE task_event ADD CONSTRAINT fk_task_event_actor
  FOREIGN KEY (actor_id) REFERENCES app_user (user_id);

CREATE INDEX IF NOT EXISTS ix_task_event_task ON task_event (task_id, created_at);

-- ===========================================================================
-- §4. RLS — 18개 목록에서 셋을 닫는다
-- ===========================================================================
-- 테넌트는 `situation`이 들고 있다. `sop_run`은 상황을 직접 가리키므로 한 번
-- 조인, `task`는 실행을 거쳐 두 번, `task_event`는 세 번이다(0031/0032와 같은
-- 형태). 조인이 길어지는 것이 싫다고 `tenant_id`를 비정규화하면 부모-자식
-- 테넌트 불일치를 앱이 지켜야 한다 — 그 쪽이 더 위험하다.
ALTER TABLE sop_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_run FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_sop_run_tenant ON sop_run;
CREATE POLICY p_sop_run_tenant ON sop_run
  USING (EXISTS (SELECT 1 FROM situation s
                  WHERE s.situation_id = sop_run.situation_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = sop_run.situation_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_task_tenant ON task;
CREATE POLICY p_task_tenant ON task
  USING (EXISTS (SELECT 1 FROM sop_run r JOIN situation s USING (situation_id)
                  WHERE r.run_id = task.run_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM sop_run r JOIN situation s USING (situation_id)
                       WHERE r.run_id = task.run_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE task_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_task_event_tenant ON task_event;
CREATE POLICY p_task_event_tenant ON task_event
  USING (EXISTS (SELECT 1 FROM task t
                   JOIN sop_run r ON r.run_id = t.run_id
                   JOIN situation s ON s.situation_id = r.situation_id
                  WHERE t.task_id = task_event.task_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM task t
                        JOIN sop_run r ON r.run_id = t.run_id
                        JOIN situation s ON s.situation_id = r.situation_id
                       WHERE t.task_id = task_event.task_id
                         AND s.tenant_id = une_current_tenant_id()));

-- ===========================================================================
-- §5. append-only — 임무 이벤트는 정정하지 않는다
-- ===========================================================================
-- 0011이 `execution_event`에 한 것과 같은 규칙이다. 임무 이벤트는 "언제 무엇이
-- 있었다"의 기록이고, 틀렸으면 새 이벤트로 정정한다.
REVOKE UPDATE, DELETE ON task_event FROM une_app;

CREATE OR REPLACE FUNCTION une_guard_task_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '임무 이벤트는 수정·삭제할 수 없다 (0036)' USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_task_event_append_only ON task_event;
CREATE TRIGGER trg_task_event_append_only
  BEFORE UPDATE OR DELETE ON task_event
  FOR EACH ROW EXECUTE FUNCTION une_guard_task_event_append_only();

-- 종료된 실행의 임무는 더 바뀌지 않는다. 상태기계가 이미 막지만, 그 판단이
-- 애플리케이션에만 있으면 결함 하나로 뚫린다(0035에서 같은 이유로 트리거를
-- 걸었다).
CREATE OR REPLACE FUNCTION une_guard_task_run_terminated() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_status text;
BEGIN
  SELECT status INTO run_status FROM sop_run
    WHERE run_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
  IF run_status IS NULL THEN
    -- 부모가 이미 사라졌다면 cascade다. 그 외에는 있을 수 없다.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION '존재하지 않는 실행에 임무를 쓸 수 없다 (0036)' USING ERRCODE = '42501';
  END IF;
  IF run_status = 'TERMINATED' THEN
    RAISE EXCEPTION '종료된 실행의 임무는 바꿀 수 없다 (UNE-SOP-016, 0036)'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_task_run_terminated ON task;
CREATE TRIGGER trg_task_run_terminated
  BEFORE INSERT OR UPDATE OR DELETE ON task
  FOR EACH ROW EXECUTE FUNCTION une_guard_task_run_terminated();

-- ===========================================================================
-- §6. 권한
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON sop_run TO une_app;
GRANT SELECT, INSERT, UPDATE ON task    TO une_app;
GRANT SELECT, INSERT ON task_event      TO une_app;

-- 삭제 경로가 없으므로 권한도 없다(0031/0034/0035와 같은 규칙).
REVOKE DELETE ON sop_run FROM une_app;
REVOKE DELETE ON task FROM une_app;

-- 워커는 실행에 관여하지 않는다. 전파(CC-270)가 열릴 때 그때 필요한 것만 준다.

-- ===========================================================================
-- §7. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * `COMPLETED`/`FAILED`(실행)와 `SENT`~`COMPLETED`(임무)를 넣지 않았다(§1).
--   * `task_assignment` 테이블을 쓰지 않았다. 설계 10 UNE-TASK-001이 이름을
--     쓰지만 CC-260은 노드의 담당 힌트를 `task.assignee_*`에 직접 적는다 —
--     재배정 이력이 필요한 시점(CC-280 UNE-TASK-010)에 그 테이블이 온다.
--   * `task_attachment`에 손대지 않았다. 현장 파일 등록은 CC-280이고, 그
--     항목이 자기 테이블의 정책을 함께 연다(RLS 커버리지 목록에 남아 있다).
--   * 실행 커서를 별도 컬럼으로 두지 않았다. 다음에 할 일은 그래프와 임무
--     상태에서 **계산**된다 — 저장하면 그 둘과 어긋날 수 있고, 어긋났을 때
--     어느 쪽이 참인지 말할 수 없다.

-- ===========================================================================
-- §8. 사실원장도 두 번째 방어선을 갖는다
-- ===========================================================================
-- **CC-260이 `execution_event`의 첫 기록자다.** 0011이 `une_app`에서
-- UPDATE/DELETE를 회수했지만 그것이 유일한 방어였다 — 권한이 잘못 부여되는
-- 순간(또는 다른 롤이 생기는 순간) 사실원장이 고쳐질 수 있다.
--
-- `task_event`(§5)·`sop_approval`(0035 §3)에 건 것과 같은 규칙이다. 실측으로
-- 확인했다: superuser 연결에서 `UPDATE execution_event`가 그대로 통과했다.
--
-- CLAUDE.md 비협상 규칙: 실행 로그는 append-only이고 정정은 `corrects_event_id`가
-- 원본을 가리키는 **새 이벤트**다.
CREATE OR REPLACE FUNCTION une_guard_execution_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '실행 이벤트는 수정·삭제할 수 없다 — 정정은 corrects_event_id를 가진 새 이벤트다 (0036)'
    USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_execution_event_append_only ON execution_event;
CREATE TRIGGER trg_execution_event_append_only
  BEFORE UPDATE OR DELETE ON execution_event
  FOR EACH ROW EXECUTE FUNCTION une_guard_execution_event_append_only();
