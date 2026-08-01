-- 0014_api_idempotency.sql (CC-110, ADR-23)
-- Replay store for the Idempotency-Key common control (design 10 §7 "멱등성":
-- 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409).
-- The physical table list (§6, 58 tables after 0012) mandates the behavior on
-- every create/state-change POST but provides no storage for it; ADR-23
-- resolves that internal contradiction with this 59th table.

CREATE TABLE IF NOT EXISTS api_idempotency (
  idempotency_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  endpoint varchar(200) NOT NULL,
  idempotency_key varchar(100) NOT NULL,
  request_hash char(64) NOT NULL,
  state varchar(20) DEFAULT 'IN_PROGRESS' NOT NULL,
  response_status int,
  response_body jsonb,
  correlation_id varchar(80) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  claimed_at timestamptz DEFAULT now() NOT NULL,
  completed_at timestamptz,
  CONSTRAINT ck_api_idempotency_state CHECK (
    state IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')
  ),
  CONSTRAINT ck_api_idempotency_completed CHECK (
    (state = 'COMPLETED') = (response_status IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT ck_api_idempotency_status_range CHECK (
    response_status IS NULL OR (response_status >= 100 AND response_status <= 599)
  )
);
COMMENT ON TABLE api_idempotency IS '멱등키 재생 저장소 (ADR-23)';
COMMENT ON COLUMN api_idempotency.idempotency_id IS '재생 레코드';
COMMENT ON COLUMN api_idempotency.tenant_id IS '기관';
COMMENT ON COLUMN api_idempotency.endpoint IS 'METHOD 경로템플릿';
COMMENT ON COLUMN api_idempotency.idempotency_key IS '멱등키';
COMMENT ON COLUMN api_idempotency.request_hash IS '요청 SHA-256';
COMMENT ON COLUMN api_idempotency.state IS 'IN_PROGRESS/COMPLETED/FAILED';
COMMENT ON COLUMN api_idempotency.response_status IS '재생 상태코드';
COMMENT ON COLUMN api_idempotency.response_body IS '재생 응답';
COMMENT ON COLUMN api_idempotency.correlation_id IS '추적';
COMMENT ON COLUMN api_idempotency.created_by IS '요청자';
COMMENT ON COLUMN api_idempotency.created_at IS '최초 수신';
COMMENT ON COLUMN api_idempotency.claimed_at IS '최근 선점';
COMMENT ON COLUMN api_idempotency.completed_at IS '완료';

ALTER TABLE api_idempotency
  ADD CONSTRAINT fk_api_idempotency_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id);

-- One in-flight/completed record per key per endpoint per tenant; the
-- interceptor claims the key with INSERT .. ON CONFLICT DO NOTHING and
-- resolves losers with SELECT .. FOR UPDATE (replay / mismatch-409 /
-- in-flight-409 / stale·FAILED takeover — ADR-23 D1).
CREATE UNIQUE INDEX IF NOT EXISTS uk_api_idempotency_key
  ON api_idempotency(tenant_id, endpoint, idempotency_key);

ALTER TABLE api_idempotency ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_api_idempotency_tenant ON api_idempotency;
CREATE POLICY p_api_idempotency_tenant ON api_idempotency
  USING (tenant_id = une_current_tenant_id())
  WITH CHECK (tenant_id = une_current_tenant_id());
ALTER TABLE api_idempotency FORCE ROW LEVEL SECURITY;

-- Runtime updates a record's state/response but never removes replay
-- evidence; TTL cleanup is an ops/worker concern (ADR-23).
REVOKE DELETE ON api_idempotency FROM une_app;

-- One working draft per plan: UNE-PLAN-006 is an upsert (SCR-PLAN-005 edits a
-- single draft; plan_context_draft rows carry no version). The baseline table
-- allowed unbounded duplicates with no way to select "the" draft (ADR-23 D2).
CREATE UNIQUE INDEX IF NOT EXISTS uk_plan_context_draft_plan
  ON plan_context_draft(plan_id);

-- US-PLAN-002 AC-02 requires the chosen start mode to survive reconnects, but
-- the baseline plan table has no column for it (ADR-23 D3). Existing rows
-- (none in practice; baseline applies to empty DBs) default to BLANK.
ALTER TABLE plan ADD COLUMN IF NOT EXISTS start_mode varchar(20) DEFAULT 'BLANK' NOT NULL;
ALTER TABLE plan DROP CONSTRAINT IF EXISTS ck_plan_start_mode;
ALTER TABLE plan ADD CONSTRAINT ck_plan_start_mode
  CHECK (start_mode IN ('BLANK', 'UPLOAD_HWPX', 'RECENT'));
COMMENT ON COLUMN plan.start_mode IS '시작방식';
