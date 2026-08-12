-- 0038_field_task_execution.sql (CC-280)
--
-- 현장 임무 수행. 설계 09 "Task" 상태표·SCR-TASK-001~003, 설계 10
-- UNE-TASK-001/002/004~012.
--
-- CC-260이 임무를 만들었고 CC-270이 내보냈다. 여기서 사람이 그것을 받고,
-- 착수하고, 보고하고, 끝낸다. 그리고 **처음으로 실행이 스스로 끝난다** —
-- CC-260이 예고한 `sop_run.COMPLETED`가 여기서 열린다.
--
-- 테이블 65 → 66 (`task_assignment` 하나 추가).

-- ===========================================================================
-- §1. 임무 상태 — 관측되는 것만 넣는다
-- ===========================================================================
-- 설계 09의 Task 상태표는 열하나를 적는다. 그중 셋을 넣지 않는다.
--
--   `DELIVERED`  수신영수증을 주는 채널이 없다(OB-06). 0037이 같은 이유로
--                `dispatch_recipient`에서 뺐고 같은 판단이다.
--
--   `REJECTED`   설계 09 SCR-TASK-003 B표가 "반려 → IN_PROGRESS"라고 적는다.
--                즉 반려하는 **순간** IN_PROGRESS가 되므로 REJECTED인 임무는
--                어떤 질의로도 보이지 않는다. 관측되지 않는 값은 상태가
--                아니라 **전이**다 — `task_event.COMPLETION_REJECTED`로
--                남기고 화면은 그 이벤트에서 "반려 후 재작업 중" 배지를
--                그린다. 어휘에 넣으면 클라이언트 분기·테스트·마이그레이션이
--                영원히 도달하지 않는 값을 다뤄야 한다(0022 §1).
--
--   `REASSIGNED` 같은 이유다. 재배정하면 임무는 **새 담당자의 SENT**가 된다 —
--                새 담당자가 수신확인부터 다시 해야 하기 때문이다. 설계 09가
--                REASSIGNED를 화면상태로 적은 것은 "기존담당 읽기전용"이라는
--                **보는 사람 기준의 표시**이고, 그것은 담당자가 바뀌었다는
--                사실에서 화면이 스스로 판단한다.
--
-- 남는 여덟이 이번에 실제로 만들어진다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS ck_task_status;
ALTER TABLE task ADD CONSTRAINT ck_task_status
  CHECK (status IN ('CREATED', 'SENT', 'ACKNOWLEDGED', 'IN_PROGRESS',
                    'COMPLETION_SUBMITTED', 'COMPLETED', 'UNABLE_REPORTED', 'CANCELLED'));
COMMENT ON COLUMN task.status IS
  'CREATED/SENT/ACKNOWLEDGED/IN_PROGRESS/COMPLETION_SUBMITTED/COMPLETED/UNABLE_REPORTED/CANCELLED. '
  'DELIVERED는 수신영수증(OB-06). REJECTED·REASSIGNED는 상태가 아니라 이벤트다(0038 §1)';

-- 실행 상태에 `COMPLETED`를 연다 — 모든 임무가 끝나면 실행도 끝난다.
-- `FAILED`는 여전히 넣지 않는다: 그 값을 만드는 경로가 아직 없다. 임무가
-- 수행불가로 남으면 실행은 **끝나지 않고 RUNNING에 머문다**(§4).
ALTER TABLE sop_run DROP CONSTRAINT IF EXISTS ck_sop_run_status;
ALTER TABLE sop_run ADD CONSTRAINT ck_sop_run_status
  CHECK (status IN ('READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'TERMINATED'));
COMMENT ON COLUMN sop_run.status IS
  'READY/RUNNING/PAUSED/COMPLETED/TERMINATED. FAILED는 그 값을 만드는 경로가 생길 때 연다';

-- 0036의 `ck_sop_run_ended_shape`는 TERMINATED만 알았다. 끝난 실행이 둘이 됐다.
ALTER TABLE sop_run DROP CONSTRAINT IF EXISTS ck_sop_run_ended_shape;
ALTER TABLE sop_run ADD CONSTRAINT ck_sop_run_ended_shape
  CHECK ((status IN ('COMPLETED', 'TERMINATED')) = (ended_at IS NOT NULL));

-- ===========================================================================
-- §2. 담당자 — 임무를 누가 지고 있는가, 그리고 누가 졌었는가
-- ===========================================================================
-- 0036 §7이 "재배정 이력이 필요한 시점(CC-280)에 그 테이블이 온다"고 적었다.
-- 지금이 그 시점이다.
--
-- `task.assignee_user_id`는 **지금**의 담당자이고, `task_assignment`는 **거쳐
-- 간** 담당자 전부다. 둘 다 두는 이유: 임무 목록 질의는 매번 최신 배정 행을
-- 찾는 서브쿼리 없이 담당자로 걸러야 하고(현장 앱의 첫 화면이다), 반면
-- "누가 언제부터 언제까지 이 임무를 졌는가"는 목록 질의가 답할 수 없다.
--
-- 이력은 **append-only다.** `released_at` 같은 컬럼을 두지 않는다 — 그것을
-- 두면 이력 행을 나중에 고쳐야 하고, 고칠 수 있는 이력은 이력이 아니다.
-- 배정 구간은 다음 행의 `assigned_at`이 끝을 말한다.
CREATE TABLE IF NOT EXISTS task_assignment (
  task_assignment_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid NOT NULL,
  assignee_user_id uuid,
  assignee_org_id uuid,
  assigned_by uuid,
  assigned_at timestamptz DEFAULT now() NOT NULL,
  source varchar(20) NOT NULL,
  reason varchar(500)
);
COMMENT ON TABLE task_assignment IS '임무 담당 이력 (append-only). 지금 담당자는 task.assignee_user_id';
COMMENT ON COLUMN task_assignment.task_assignment_id IS '배정';
COMMENT ON COLUMN task_assignment.task_id IS '임무';
COMMENT ON COLUMN task_assignment.assignee_user_id IS '담당자';
COMMENT ON COLUMN task_assignment.assignee_org_id IS '담당조직';
COMMENT ON COLUMN task_assignment.assigned_by IS '배정한 사람. 전파에서 자동 배정되면 전파 접수자';
COMMENT ON COLUMN task_assignment.assigned_at IS '배정 시각. 다음 행의 이 값이 이 배정의 끝이다';
COMMENT ON COLUMN task_assignment.source IS 'DISPATCH(전파에서 자동)/REASSIGN(UNE-TASK-010)';
COMMENT ON COLUMN task_assignment.reason IS '재배정 사유';

ALTER TABLE task_assignment DROP CONSTRAINT IF EXISTS ck_task_assignment_source;
ALTER TABLE task_assignment ADD CONSTRAINT ck_task_assignment_source
  CHECK (source IN ('DISPATCH', 'REASSIGN'));

-- 사람도 조직도 없는 배정은 "아무에게도 맡기지 않았다"는 뜻이라 배정이 아니다.
ALTER TABLE task_assignment DROP CONSTRAINT IF EXISTS ck_task_assignment_target;
ALTER TABLE task_assignment ADD CONSTRAINT ck_task_assignment_target
  CHECK (assignee_user_id IS NOT NULL OR assignee_org_id IS NOT NULL);

ALTER TABLE task_assignment DROP CONSTRAINT IF EXISTS fk_task_assignment_task;
ALTER TABLE task_assignment ADD CONSTRAINT fk_task_assignment_task
  FOREIGN KEY (task_id) REFERENCES task (task_id) ON DELETE CASCADE;

ALTER TABLE task_assignment DROP CONSTRAINT IF EXISTS fk_task_assignment_user;
ALTER TABLE task_assignment ADD CONSTRAINT fk_task_assignment_user
  FOREIGN KEY (assignee_user_id) REFERENCES app_user (user_id);

ALTER TABLE task_assignment DROP CONSTRAINT IF EXISTS fk_task_assignment_org;
ALTER TABLE task_assignment ADD CONSTRAINT fk_task_assignment_org
  FOREIGN KEY (assignee_org_id) REFERENCES organization (organization_id);

ALTER TABLE task_assignment DROP CONSTRAINT IF EXISTS fk_task_assignment_by;
ALTER TABLE task_assignment ADD CONSTRAINT fk_task_assignment_by
  FOREIGN KEY (assigned_by) REFERENCES app_user (user_id);

CREATE INDEX IF NOT EXISTS ix_task_assignment_task ON task_assignment (task_id, assigned_at);

-- 0036이 `task.assignee_user_id`에만 FK를 걸었다. 조직 담당도 실재해야 한다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS fk_task_assignee_org;
ALTER TABLE task ADD CONSTRAINT fk_task_assignee_org
  FOREIGN KEY (assignee_org_id) REFERENCES organization (organization_id);

-- ===========================================================================
-- §3. 현장 첨부 — RLS 커버리지 목록에서 하나를 닫는다
-- ===========================================================================
-- CC-250이 고정한 목록에 `task_attachment`가 "CC-280이 열 때 닫는다"로 남아
-- 있었다. 지금 UNE-TASK-012가 그 첫 쓰기 경로다.
ALTER TABLE task_attachment DROP CONSTRAINT IF EXISTS ck_task_attachment_category;
ALTER TABLE task_attachment ADD CONSTRAINT ck_task_attachment_category
  CHECK (category IN ('PHOTO', 'DOC', 'VIDEO', 'OTHER'));

CREATE INDEX IF NOT EXISTS ix_task_attachment_task ON task_attachment (task_id);

-- 같은 파일을 한 임무에 두 번 붙이면 목록에 같은 사진이 둘로 보인다. 현장
-- 앱은 재시도가 잦으므로 그 중복이 실제로 생긴다.
DROP INDEX IF EXISTS uk_task_attachment_file;
CREATE UNIQUE INDEX uk_task_attachment_file ON task_attachment (task_id, file_id);

ALTER TABLE task_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_task_attachment_tenant ON task_attachment;
CREATE POLICY p_task_attachment_tenant ON task_attachment
  USING (EXISTS (SELECT 1 FROM task t
                   JOIN sop_run r ON r.run_id = t.run_id
                   JOIN situation s ON s.situation_id = r.situation_id
                  WHERE t.task_id = task_attachment.task_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM task t
                        JOIN sop_run r ON r.run_id = t.run_id
                        JOIN situation s ON s.situation_id = r.situation_id
                       WHERE t.task_id = task_attachment.task_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE task_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignment FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_task_assignment_tenant ON task_assignment;
CREATE POLICY p_task_assignment_tenant ON task_assignment
  USING (EXISTS (SELECT 1 FROM task t
                   JOIN sop_run r ON r.run_id = t.run_id
                   JOIN situation s ON s.situation_id = r.situation_id
                  WHERE t.task_id = task_assignment.task_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM task t
                        JOIN sop_run r ON r.run_id = t.run_id
                        JOIN situation s ON s.situation_id = r.situation_id
                       WHERE t.task_id = task_assignment.task_id
                         AND s.tenant_id = une_current_tenant_id()));

-- ===========================================================================
-- §4. 담당자 본인 확인은 **DB에서도** 강제된다
-- ===========================================================================
-- 앱 계층 가드가 "당신이 담당자인가"를 먼저 본다. 그러나 가드를 통과한 뒤
-- 재배정이 일어나면(현장에서 흔하다) 옛 담당자의 요청이 그대로 통과한다 —
-- 시간차 경합이다.
--
-- 그래서 상태 전이는 전부 `WHERE task_id=$1 AND assignee_user_id=$2 AND
-- status=$3` 조건부 UPDATE로 실행하고 0행이면 409로 되돌린다. 조건부 UPDATE가
-- 상태기계 집행과 본인 확인을 한 번에 한다.
--
-- 여기서는 그 규칙이 무너지지 않도록 **담당자 없는 임무가 수행 상태로 가는
-- 것**을 막는다. 담당자가 없는데 ACKNOWLEDGED이면 "누가 받았는가"에 답이 없다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS ck_task_assignee_required;
ALTER TABLE task ADD CONSTRAINT ck_task_assignee_required
  CHECK (
    status IN ('CREATED', 'SENT', 'CANCELLED')
    OR assignee_user_id IS NOT NULL
  );

-- 진행률은 상태와 어긋나면 안 된다. 완료된 임무가 40%로 보이면 대시보드가
-- 거짓말을 한다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS ck_task_progress_settled;
ALTER TABLE task ADD CONSTRAINT ck_task_progress_settled
  CHECK (status <> 'COMPLETED' OR progress_pct = 100);

CREATE INDEX IF NOT EXISTS ix_task_due ON task (due_at)
  WHERE due_at IS NOT NULL AND status NOT IN ('COMPLETED', 'CANCELLED');

-- ===========================================================================
-- §5. 권한
-- ===========================================================================
GRANT SELECT, INSERT ON task_assignment TO une_app;
GRANT SELECT, INSERT ON task_attachment TO une_app;

-- 이력과 첨부는 지우지 않는다. 잘못 붙인 첨부는 새 이벤트로 정정한다
-- (0031/0034/0035/0036과 같은 규칙).
REVOKE UPDATE, DELETE ON task_assignment FROM une_app;
REVOKE UPDATE, DELETE ON task_attachment FROM une_app;

CREATE OR REPLACE FUNCTION une_guard_task_assignment_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '배정 이력은 수정·삭제할 수 없다 — 바꾸려면 새 배정이다 (0038)'
    USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_task_assignment_append_only ON task_assignment;
CREATE TRIGGER trg_task_assignment_append_only
  BEFORE UPDATE OR DELETE ON task_assignment
  FOR EACH ROW EXECUTE FUNCTION une_guard_task_assignment_append_only();

-- ===========================================================================
-- §6. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * `DELIVERED`(임무)·`FAILED`(실행)·`REJECTED`·`REASSIGNED`를 넣지 않았다(§1).
--
--   * **수행 시각 컬럼을 넣지 않았다.** `acknowledged_at`·`started_at`·
--     `completed_at`을 task에 두면 "언제 착수했는가"의 답이 둘이 된다 —
--     `task_event`가 이미 행위자·시각·내용을 append-only로 들고 있고 그것이
--     정본이다. 대시보드(CC-290)는 그 이벤트를 투영한다.
--     (`activated_at`은 예외다. 그것은 사람의 행위가 아니라 그래프에서
--      계산된 시스템 사실이라 이벤트로 남길 행위자가 없다.)
--
--   * `channel_delivery`를 여전히 만들지 않았다(ADR-41 D6).
--
--   * **완료조건을 테이블로 분해하지 않았다.** 체크리스트 항목을 행으로 두면
--     SOP 버전이 불변인데 그 사본이 임무마다 흩어진다. 조건은 임무 생성
--     시점에 `completion_policy_json`으로 굳고, 제출 결과는 이벤트에 남는다.
--
--   * **서명링크 인증을 넣지 않았다.** 설계 09 SCR-TASK-001이
--     `/task/:signedToken`을 적지만, 지금 그 링크를 배달할 채널이 없다 —
--     SMS·이메일·푸시가 전부 시뮬레이션이고 주소도 저장하지 않는다(ADR-41).
--     배달할 수 없는 bearer 인증 경로는 공격면만 있고 사용자가 없다. 설계
--     10(우선순위 3)이 이 API들의 권한을 `TASK_ASSIGNEE`/`TASK_SUPERVISE`로
--     적고 있어 문서 우선순위로도 이쪽이 이긴다. OB-06이 닫히면 그때 더한다.
