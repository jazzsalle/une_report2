-- 0039_task_notice_and_settled_runs.sql (CC-280 이중검토 보정)
--
-- 0038을 낸 뒤 아키텍처 검토가 찾은 것 셋을 닫는다. 전부 실측으로 확인한
-- 결함이고, 앞의 둘은 **사실원장 밖에서 상태가 바뀌는** 경로다.

-- ===========================================================================
-- §1. 알림 전파가 임무를 몰래 SENT로 만들었다
-- ===========================================================================
-- CC-280의 알림(수행불가·반려·재배정)은 CC-270의 전파를 그대로 쓴다. 그런데
-- 워커 릴레이는 `dispatch.task_id`가 있으면 **종류를 보지 않고** 임무를 SENT로
-- 올린다(`markTaskSent`). 그래서 지시가 한 번도 나가지 않은 임무를 지휘자가
-- Escalation하면 그 임무가 "전파됨"으로 보인다.
--
-- 더 나쁜 것은 그 전이가 `canTransitionTask`를 거치지 않고 `task_event`도
-- `execution_event`도 남기지 않는다는 점이다 — 상태 변경이 사실원장 밖에서
-- 일어난다.
--
-- 종류를 나눈다. `TASK`는 **임무 지시 전파**(UNE-TASK-003)이고 그것만 임무를
-- SENT로 만든다. 알림은 `TASK_NOTICE`다 — 같은 임무를 가리키지만(감사·조회에
-- 필요하다) 임무 상태를 건드리지 않는다.
ALTER TABLE dispatch DROP CONSTRAINT IF EXISTS ck_dispatch_message_type;
ALTER TABLE dispatch ADD CONSTRAINT ck_dispatch_message_type
  CHECK (message_type IN ('SITUATION', 'TASK', 'TASK_NOTICE', 'ESCALATION'));
COMMENT ON COLUMN dispatch.message_type IS
  'SITUATION/TASK(임무 지시 — 이것만 임무를 SENT로 만든다)/TASK_NOTICE(수행 알림)/ESCALATION';

-- ===========================================================================
-- §2. 0036의 종료 보호 트리거가 COMPLETED를 모른다
-- ===========================================================================
-- 0038이 `ck_sop_run_ended_shape`를 두 종료 상태로 넓혔지만
-- `une_guard_task_run_terminated`는 여전히 TERMINATED만 안다. 지금은 앱이
-- `runAcceptsWork(status)==='RUNNING'`으로 막고 있어 실 노출이 없지만, 0036이
-- 그 트리거를 건 이유가 "그 판단이 애플리케이션에만 있으면 결함 하나로
-- 뚫린다"였다. 두 번째 방어선을 되살린다.
CREATE OR REPLACE FUNCTION une_guard_task_run_terminated() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_status text;
BEGIN
  SELECT status INTO run_status FROM sop_run
    WHERE run_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE NEW.run_id END;
  IF run_status IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION '존재하지 않는 실행에 임무를 쓸 수 없다 (0036)' USING ERRCODE = '42501';
  END IF;
  IF run_status IN ('TERMINATED', 'COMPLETED') THEN
    RAISE EXCEPTION '끝난 실행(%)의 임무는 바꿀 수 없다 (0039)', run_status
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- ===========================================================================
-- §3. 첨부 정책이 파일의 테넌트를 보지 않았다
-- ===========================================================================
-- 0038의 `p_task_attachment_tenant`는 임무 쪽 테넌트만 본다. 파일이 같은
-- 기관의 것인지는 앱의 `findUsableFile`만 확인했다 — 단일 방어선이다.
-- `file_object`는 `tenant_id`를 직접 들고 있으므로 정책에서 바로 볼 수 있다.
DROP POLICY IF EXISTS p_task_attachment_tenant ON task_attachment;
CREATE POLICY p_task_attachment_tenant ON task_attachment
  USING (EXISTS (SELECT 1 FROM task t
                   JOIN sop_run r ON r.run_id = t.run_id
                   JOIN situation s ON s.situation_id = r.situation_id
                  WHERE t.task_id = task_attachment.task_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM task t
              JOIN sop_run r ON r.run_id = t.run_id
              JOIN situation s ON s.situation_id = r.situation_id
             WHERE t.task_id = task_attachment.task_id
               AND s.tenant_id = une_current_tenant_id())
    AND EXISTS (SELECT 1 FROM file_object f
                 WHERE f.file_id = task_attachment.file_id
                   AND f.tenant_id = une_current_tenant_id())
  );

-- 정책식은 질의하는 롤의 권한으로 돈다(0033·0037에서 두 번 겪었다).
-- `une_app`은 `file_object`를 이미 읽을 수 있으므로 추가 GRANT는 없다.
