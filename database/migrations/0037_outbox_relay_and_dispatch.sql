-- 0037_outbox_relay_and_dispatch.sql (CC-270)
--
-- Transactional Outbox와 전파(Dispatch). 시뮬레이션 채널.
-- 설계 09 "Propagation Message" 상태표, 설계 10 UNE-TASK-003/013/014, 마스터 §22.
--
-- CLAUDE.md 비협상 규칙: **상태변경·Execution Event·Outbox insert는 하나의 DB
-- 트랜잭션이다.** 이 마이그레이션은 그 규칙이 성립할 수 있는 형태를 만든다 —
-- 전파 접수는 API 트랜잭션에서 끝나고, 실제 발송은 워커가 Outbox를 읽어서 한다.
--
-- RLS 커버리지 목록(CC-250)에서 셋을 더 닫는다: `dispatch`,
-- `dispatch_recipient`, `outbox_attempt`. 남은 9개.
--
-- 테이블 수 변화 없음(65 유지).

-- ===========================================================================
-- §1. 어휘 — 이번에 도달 가능해지는 것만
-- ===========================================================================
-- Outbox 한 줄의 일생: PENDING → SENDING → SENT | FAILED → (재시도) → DEAD_LETTER
--
--   PENDING      접수됨. 워커가 아직 집지 않았다.
--   SENDING      워커가 집었다(리스). 크래시하면 리스 만료로 회수된다.
--   SENT         채널이 받았다.
--   FAILED       실패했고 **다시 시도한다**(next_attempt_at).
--   DEAD_LETTER  시도를 다 썼다. 사람이 봐야 한다.
--
-- `CANCELLED`는 넣지 않는다 — 전파 취소 경로가 이번 범위에 없다(0022 §1).
ALTER TABLE outbox_message DROP CONSTRAINT IF EXISTS ck_outbox_message_status;
ALTER TABLE outbox_message ADD CONSTRAINT ck_outbox_message_status
  CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD_LETTER'));
COMMENT ON COLUMN outbox_message.status IS 'PENDING/SENDING/SENT/FAILED/DEAD_LETTER. 취소는 그 경로가 생길 때 연다';

-- 채널 어휘. 지금은 전부 **시뮬레이션**이다 — 실제 SMS·이메일·푸시 계약이
-- OB-06으로 열려 있다. SYSTEM은 화면 안 알림이라 시뮬레이션이 아니라 진짜다.
ALTER TABLE outbox_message DROP CONSTRAINT IF EXISTS ck_outbox_message_channel;
ALTER TABLE outbox_message ADD CONSTRAINT ck_outbox_message_channel
  CHECK (channel IN ('SYSTEM', 'SMS', 'EMAIL', 'PUSH'));

-- 재시도 시각의 상관식. **FAILED만 다음 시도를 예약한다** — 다른 상태에
-- 예약이 남아 있으면 릴레이가 끝난 줄을 다시 집는다.
ALTER TABLE outbox_message DROP CONSTRAINT IF EXISTS ck_outbox_message_next_attempt;
ALTER TABLE outbox_message ADD CONSTRAINT ck_outbox_message_next_attempt
  CHECK (
    (status = 'FAILED' AND next_attempt_at IS NOT NULL)
    OR (status = 'PENDING')
    OR (status IN ('SENDING', 'SENT', 'DEAD_LETTER') AND next_attempt_at IS NULL)
  );

ALTER TABLE outbox_message DROP CONSTRAINT IF EXISTS ck_outbox_message_attempts;
ALTER TABLE outbox_message ADD CONSTRAINT ck_outbox_message_attempts
  CHECK (attempt_count >= 0);

ALTER TABLE outbox_attempt DROP CONSTRAINT IF EXISTS ck_outbox_attempt_result;
ALTER TABLE outbox_attempt ADD CONSTRAINT ck_outbox_attempt_result
  CHECK (result_status IN ('SUCCESS', 'RETRY', 'FAIL'));

ALTER TABLE outbox_attempt DROP CONSTRAINT IF EXISTS ck_outbox_attempt_no;
ALTER TABLE outbox_attempt ADD CONSTRAINT ck_outbox_attempt_no CHECK (attempt_no >= 1);

-- 전파는 수신자별 결과를 모아 하나의 상태가 된다.
--   PENDING  접수됨
--   SENDING  일부라도 발송이 시작됐다
--   SENT     **모든** 수신자가 성공
--   PARTIAL  일부 성공 일부 실패 — 실패만 재시도한다
--   FAILED   모두 실패
ALTER TABLE dispatch DROP CONSTRAINT IF EXISTS ck_dispatch_status;
ALTER TABLE dispatch ADD CONSTRAINT ck_dispatch_status
  CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'PARTIAL', 'FAILED'));

ALTER TABLE dispatch DROP CONSTRAINT IF EXISTS ck_dispatch_message_type;
ALTER TABLE dispatch ADD CONSTRAINT ck_dispatch_message_type
  CHECK (message_type IN ('SITUATION', 'TASK', 'ESCALATION'));

-- 수신자 상태. **`DELIVERED`를 넣지 않는다** — 도달 확인은 채널이 수신영수증을
-- 줘야 알 수 있고, 시뮬레이션 채널은 "받았다"까지만 말한다. 실제 채널 계약이
-- 오면(OB-06) 그때 이 어휘가 넓어진다. 지금 넣으면 영원히 도달하지 않는 값이
-- 화면에 남는다.
ALTER TABLE dispatch_recipient DROP CONSTRAINT IF EXISTS ck_dispatch_recipient_status;
ALTER TABLE dispatch_recipient ADD CONSTRAINT ck_dispatch_recipient_status
  CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED'));
COMMENT ON COLUMN dispatch_recipient.delivery_status IS 'PENDING/SENT/FAILED. DELIVERED는 수신영수증을 주는 실제 채널이 붙을 때 연다(OB-06)';

ALTER TABLE dispatch_recipient DROP CONSTRAINT IF EXISTS ck_dispatch_recipient_channel;
ALTER TABLE dispatch_recipient ADD CONSTRAINT ck_dispatch_recipient_channel
  CHECK (channel IN ('SYSTEM', 'SMS', 'EMAIL', 'PUSH'));

-- 수신자는 사람이거나 조직이다. 둘 다 비면 어디로 보낼지가 없다.
ALTER TABLE dispatch_recipient DROP CONSTRAINT IF EXISTS ck_dispatch_recipient_target;
ALTER TABLE dispatch_recipient ADD CONSTRAINT ck_dispatch_recipient_target
  CHECK (user_id IS NOT NULL OR organization_id IS NOT NULL);

-- 임무 상태에 SENT를 연다(CC-260이 예고한 확장). `DELIVERED`는 위와 같은
-- 이유로 아직 없다.
ALTER TABLE task DROP CONSTRAINT IF EXISTS ck_task_status;
ALTER TABLE task ADD CONSTRAINT ck_task_status
  CHECK (status IN ('CREATED', 'SENT', 'CANCELLED'));
COMMENT ON COLUMN task.status IS 'CREATED/SENT/CANCELLED. DELIVERED는 수신영수증(OB-06), ACKNOWLEDGED~COMPLETED는 수행(CC-280)이 연다';

-- ===========================================================================
-- §2. 중복 억제와 릴레이 인덱스
-- ===========================================================================
-- 0007의 `uk_outbox_idem (idempotency_key, channel)`이 이미 있다. 그런데
-- **테넌트가 빠져 있다** — 두 기관이 같은 키를 쓰면 한쪽이 막힌다. 키는
-- 대상 id를 포함해 만들지만(도메인 `outboxIdempotencyKey`), 그 규칙을 어기는
-- 호출부 하나가 다른 기관의 전파를 조용히 삼키게 둘 수는 없다.
DROP INDEX IF EXISTS uk_outbox_idem;
CREATE UNIQUE INDEX uk_outbox_idem
  ON outbox_message (tenant_id, idempotency_key, channel);

-- 릴레이가 집는 조건 그대로의 부분 인덱스. 끝난 줄(SENT/DEAD_LETTER)은 곧
-- 대다수가 되므로 인덱스에서 뺀다.
DROP INDEX IF EXISTS ix_outbox_claimable;
CREATE INDEX ix_outbox_claimable
  ON outbox_message (next_attempt_at NULLS FIRST, created_at)
  WHERE status IN ('PENDING', 'FAILED', 'SENDING');

CREATE INDEX IF NOT EXISTS ix_outbox_attempt_message
  ON outbox_attempt (outbox_id, attempt_no);

CREATE INDEX IF NOT EXISTS ix_dispatch_situation ON dispatch (situation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_dispatch_recipient_dispatch
  ON dispatch_recipient (dispatch_id, delivery_status);

-- ===========================================================================
-- §3. 관계
-- ===========================================================================
ALTER TABLE dispatch DROP CONSTRAINT IF EXISTS fk_dispatch_task;
ALTER TABLE dispatch ADD CONSTRAINT fk_dispatch_task
  FOREIGN KEY (task_id) REFERENCES task (task_id) ON DELETE CASCADE;

ALTER TABLE dispatch DROP CONSTRAINT IF EXISTS fk_dispatch_situation;
ALTER TABLE dispatch ADD CONSTRAINT fk_dispatch_situation
  FOREIGN KEY (situation_id) REFERENCES situation (situation_id);

ALTER TABLE dispatch DROP CONSTRAINT IF EXISTS fk_dispatch_created_by;
ALTER TABLE dispatch ADD CONSTRAINT fk_dispatch_created_by
  FOREIGN KEY (created_by) REFERENCES app_user (user_id);

ALTER TABLE dispatch_recipient DROP CONSTRAINT IF EXISTS fk_dispatch_recipient_dispatch;
ALTER TABLE dispatch_recipient ADD CONSTRAINT fk_dispatch_recipient_dispatch
  FOREIGN KEY (dispatch_id) REFERENCES dispatch (dispatch_id) ON DELETE CASCADE;

ALTER TABLE dispatch_recipient DROP CONSTRAINT IF EXISTS fk_dispatch_recipient_user;
ALTER TABLE dispatch_recipient ADD CONSTRAINT fk_dispatch_recipient_user
  FOREIGN KEY (user_id) REFERENCES app_user (user_id);

ALTER TABLE outbox_attempt DROP CONSTRAINT IF EXISTS fk_outbox_attempt_message;
ALTER TABLE outbox_attempt ADD CONSTRAINT fk_outbox_attempt_message
  FOREIGN KEY (outbox_id) REFERENCES outbox_message (outbox_id) ON DELETE CASCADE;

-- Outbox 한 줄이 어느 수신자에게 가는지. 0006에는 그 연결이 없어 "이 메시지가
-- 누구에게 갔는가"에 답할 수 없었다 — 전파 상태 화면(UNE-TASK-013)이 그것을
-- 묻는다.
ALTER TABLE outbox_message ADD COLUMN IF NOT EXISTS dispatch_recipient_id uuid;
COMMENT ON COLUMN outbox_message.dispatch_recipient_id IS '이 메시지의 수신자. 전파가 아닌 Outbox(도메인 이벤트 발행)에서는 NULL이다';

ALTER TABLE outbox_message DROP CONSTRAINT IF EXISTS fk_outbox_message_recipient;
ALTER TABLE outbox_message ADD CONSTRAINT fk_outbox_message_recipient
  FOREIGN KEY (dispatch_recipient_id) REFERENCES dispatch_recipient (recipient_id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS ix_outbox_recipient ON outbox_message (dispatch_recipient_id)
  WHERE dispatch_recipient_id IS NOT NULL;

-- ===========================================================================
-- §4. RLS — 목록에서 셋을 더 닫는다
-- ===========================================================================
-- `dispatch`는 상황을 거쳐, 나머지는 그 부모를 거쳐 테넌트를 증명한다.
-- `outbox_message`는 0008/0011이 이미 `tenant_id` 정책을 갖고 있다.
ALTER TABLE dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dispatch_tenant ON dispatch;
CREATE POLICY p_dispatch_tenant ON dispatch
  USING (EXISTS (SELECT 1 FROM situation s
                  WHERE s.situation_id = dispatch.situation_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = dispatch.situation_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE dispatch_recipient ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_recipient FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_dispatch_recipient_tenant ON dispatch_recipient;
CREATE POLICY p_dispatch_recipient_tenant ON dispatch_recipient
  USING (EXISTS (SELECT 1 FROM dispatch d JOIN situation s USING (situation_id)
                  WHERE d.dispatch_id = dispatch_recipient.dispatch_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM dispatch d JOIN situation s USING (situation_id)
                       WHERE d.dispatch_id = dispatch_recipient.dispatch_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE outbox_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_attempt FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_outbox_attempt_tenant ON outbox_attempt;
CREATE POLICY p_outbox_attempt_tenant ON outbox_attempt
  USING (EXISTS (SELECT 1 FROM outbox_message m
                  WHERE m.outbox_id = outbox_attempt.outbox_id
                    AND m.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM outbox_message m
                       WHERE m.outbox_id = outbox_attempt.outbox_id
                         AND m.tenant_id = une_current_tenant_id()));

-- ===========================================================================
-- §5. 워커 — 릴레이가 필요한 것만
-- ===========================================================================
-- 릴레이는 디스패치 스코프(테넌트 없음)에서 큐를 집고, 결과를 쓸 때는 그 줄의
-- 테넌트를 안다. 0015가 `generation_job`에 세운 형태와 같다.
GRANT SELECT ON situation TO une_worker;  -- 0033이 이미 줬다(멱등)
-- **정책 평가에 필요한 읽기.** `task`·`dispatch_recipient`의 RLS 조건이
-- `sop_run`을 조인하고, 정책식은 질의하는 롤의 권한으로 돈다 — 이 GRANT가
-- 없으면 릴레이가 임무를 고칠 때 `permission denied for table sop_run`이
-- 난다(실측). 0033이 상황 계열에서 겪은 것과 같은 유형이다.
GRANT SELECT ON sop_run TO une_worker;
GRANT SELECT, UPDATE ON outbox_message TO une_worker;
GRANT SELECT, INSERT ON outbox_attempt TO une_worker;
GRANT SELECT, UPDATE ON dispatch TO une_worker;
GRANT SELECT, UPDATE ON dispatch_recipient TO une_worker;
GRANT SELECT, UPDATE ON task TO une_worker;

-- 릴레이가 쓰는 칸만 연다(0030에서 배운 대로). 특히 `payload_json`과
-- `idempotency_key`는 손대지 못한다 — 그것이 바뀌면 "무엇을 보내기로 했는가"가
-- 사라진다.
REVOKE UPDATE ON outbox_message FROM une_worker;
GRANT UPDATE (status, attempt_count, next_attempt_at) ON outbox_message TO une_worker;

REVOKE UPDATE ON dispatch FROM une_worker;
GRANT UPDATE (status) ON dispatch TO une_worker;

REVOKE UPDATE ON dispatch_recipient FROM une_worker;
GRANT UPDATE (delivery_status) ON dispatch_recipient TO une_worker;

REVOKE UPDATE ON task FROM une_worker;
GRANT UPDATE (status, version_no) ON task TO une_worker;

-- 디스패치 스코프에서 큐를 집으려면 테넌트 없이도 보여야 한다. 0015가
-- `generation_job`에 한 것과 같은 형태의 워커 정책이다.
DROP POLICY IF EXISTS p_outbox_message_worker ON outbox_message;
CREATE POLICY p_outbox_message_worker ON outbox_message
  FOR SELECT TO une_worker
  USING (une_current_tenant_id() IS NULL OR tenant_id = une_current_tenant_id());

DROP POLICY IF EXISTS p_outbox_message_worker_write ON outbox_message;
CREATE POLICY p_outbox_message_worker_write ON outbox_message
  FOR UPDATE TO une_worker
  USING (une_current_tenant_id() IS NULL OR tenant_id = une_current_tenant_id())
  WITH CHECK (une_current_tenant_id() IS NULL OR tenant_id = une_current_tenant_id());

-- **끝난 줄은 워커도 되돌리지 못한다.** 0030이 `provider_job`에서 배운 것과
-- 같다 — 그때 종결된 잡이 QUEUED로 되돌아가는 것을 실측했다.
-- **`WITH CHECK (true)`가 필요하다.** RESTRICTIVE 정책에 USING만 쓰면 그것이
-- 새 행에도 적용되어, 릴레이가 줄을 SENT/DEAD_LETTER로 **종결하는 것 자체가
-- 막힌다**(실측: 메시지가 SENDING에 머물렀다). 여기서 막으려는 것은 "이미
-- 끝난 줄을 다시 여는 것"이므로 조건은 **옛 행**에만 걸어야 한다.
DROP POLICY IF EXISTS p_outbox_message_worker_open_only ON outbox_message;
CREATE POLICY p_outbox_message_worker_open_only ON outbox_message
  AS RESTRICTIVE FOR UPDATE TO une_worker
  USING (status IN ('PENDING', 'SENDING', 'FAILED'))
  WITH CHECK (true);

COMMENT ON POLICY p_outbox_message_worker_open_only ON outbox_message IS
  'CC-270: 릴레이는 아직 끝나지 않은 줄만 고친다. SENT/DEAD_LETTER는 되돌릴 수 없다';

-- ===========================================================================
-- §6. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * **`channel_delivery` 테이블을 만들지 않았다.** 설계 10 UNE-TASK-013이
--     이름을 쓰지만, 그 정보는 이미 두 곳에 있다 — 시도별 상세는
--     `outbox_attempt`(provider_message_id·응답·오류), 수신자별 결과는
--     `dispatch_recipient.delivery_status`다. 채널별 분기도 이미 수신자 행이
--     채널을 들고 있어(한 사람에게 SMS와 EMAIL을 보내면 행이 둘이다) 새 테이블이
--     담을 것이 남지 않는다. ADR-33 D4가 `malware_scan`에 내린 결론과 같은 형태다.
--   * `DELIVERED`(수신자)와 `CANCELLED`(Outbox)를 넣지 않았다(§1).
--   * 실제 채널 자격증명·주소를 저장하지 않는다. `address_enc`는 비운 채로
--     둔다 — 실제 채널 계약(OB-06)이 오기 전에 개인정보를 모으지 않는다.
--   * Outbox 보존기간 정책이 없다. `job_event`·`sop_validation`과 같은 상태이고
--     같은 판단이 필요하다(ADR-38 수용 한계 12).
