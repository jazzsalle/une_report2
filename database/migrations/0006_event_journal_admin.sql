-- V006__event_journal_admin.sql: generated from physical DB design baseline v1.0

CREATE TABLE IF NOT EXISTS execution_event (
  execution_event_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  situation_id uuid NOT NULL,
  aggregate_type varchar(30) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(50) NOT NULL,
  occurred_at timestamptz DEFAULT now() NOT NULL,
  recorded_at timestamptz DEFAULT now() NOT NULL,
  actor_id uuid,
  payload_json jsonb NOT NULL,
  corrects_event_id uuid,
  correlation_id varchar(80) NOT NULL,
  event_hash char(64) NOT NULL
);
COMMENT ON COLUMN execution_event.execution_event_id IS '사실원장 Event';
COMMENT ON COLUMN execution_event.tenant_id IS '기관';
COMMENT ON COLUMN execution_event.situation_id IS '상황';
COMMENT ON COLUMN execution_event.aggregate_type IS 'TASK/SOP/DISPATCH/...';
COMMENT ON COLUMN execution_event.aggregate_id IS '대상';
COMMENT ON COLUMN execution_event.event_type IS '종류';
COMMENT ON COLUMN execution_event.occurred_at IS '업무시각';
COMMENT ON COLUMN execution_event.recorded_at IS '기록시각';
COMMENT ON COLUMN execution_event.actor_id IS '행위자';
COMMENT ON COLUMN execution_event.payload_json IS '내용';
COMMENT ON COLUMN execution_event.corrects_event_id IS '정정대상';
COMMENT ON COLUMN execution_event.correlation_id IS '추적';
COMMENT ON COLUMN execution_event.event_hash IS '위변조검증';

CREATE TABLE IF NOT EXISTS outbox_message (
  outbox_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  aggregate_type varchar(30) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(50) NOT NULL,
  payload_json jsonb NOT NULL,
  channel varchar(20) NOT NULL,
  status varchar(20) NOT NULL,
  attempt_count int DEFAULT 0 NOT NULL,
  next_attempt_at timestamptz,
  idempotency_key varchar(100) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN outbox_message.outbox_id IS 'Outbox';
COMMENT ON COLUMN outbox_message.tenant_id IS '기관';
COMMENT ON COLUMN outbox_message.aggregate_type IS '대상';
COMMENT ON COLUMN outbox_message.aggregate_id IS '대상 ID';
COMMENT ON COLUMN outbox_message.event_type IS '발송종류';
COMMENT ON COLUMN outbox_message.payload_json IS '메시지';
COMMENT ON COLUMN outbox_message.channel IS '채널';
COMMENT ON COLUMN outbox_message.status IS 'PENDING~DEAD';
COMMENT ON COLUMN outbox_message.attempt_count IS '시도';
COMMENT ON COLUMN outbox_message.next_attempt_at IS '다음시도';
COMMENT ON COLUMN outbox_message.idempotency_key IS '멱등키';
COMMENT ON COLUMN outbox_message.created_at IS '생성';

CREATE TABLE IF NOT EXISTS outbox_attempt (
  attempt_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  outbox_id uuid NOT NULL,
  attempt_no int NOT NULL,
  started_at timestamptz DEFAULT now() NOT NULL,
  finished_at timestamptz,
  result_status varchar(20) NOT NULL,
  provider_message_id varchar(150),
  response_json jsonb,
  error_json jsonb
);
COMMENT ON COLUMN outbox_attempt.attempt_id IS '발송시도';
COMMENT ON COLUMN outbox_attempt.outbox_id IS 'Outbox';
COMMENT ON COLUMN outbox_attempt.attempt_no IS '순번';
COMMENT ON COLUMN outbox_attempt.started_at IS '시작';
COMMENT ON COLUMN outbox_attempt.finished_at IS '종료';
COMMENT ON COLUMN outbox_attempt.result_status IS 'SUCCESS/RETRY/FAIL';
COMMENT ON COLUMN outbox_attempt.provider_message_id IS '외부 ID';
COMMENT ON COLUMN outbox_attempt.response_json IS '응답';
COMMENT ON COLUMN outbox_attempt.error_json IS '오류';

CREATE TABLE IF NOT EXISTS journal (
  journal_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  situation_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  document_id uuid NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status varchar(20) NOT NULL,
  projection_hash char(64) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN journal.journal_id IS '상황일지';
COMMENT ON COLUMN journal.situation_id IS '상황';
COMMENT ON COLUMN journal.snapshot_id IS '기준 Snapshot';
COMMENT ON COLUMN journal.document_id IS 'rhwp 문서';
COMMENT ON COLUMN journal.period_start IS '시작';
COMMENT ON COLUMN journal.period_end IS '종료';
COMMENT ON COLUMN journal.status IS 'CONFIGURING~APPROVED';
COMMENT ON COLUMN journal.projection_hash IS 'Projection 해시';
COMMENT ON COLUMN journal.created_by IS '생성자';
COMMENT ON COLUMN journal.created_at IS '생성';

CREATE TABLE IF NOT EXISTS journal_projection_item (
  projection_item_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  journal_id uuid NOT NULL,
  section_key varchar(80) NOT NULL,
  source_event_ids uuid[] NOT NULL,
  fact_payload_json jsonb NOT NULL,
  narrative_text text,
  sort_order int DEFAULT 0 NOT NULL,
  locked_fields_json jsonb NOT NULL
);
COMMENT ON COLUMN journal_projection_item.projection_item_id IS '투영항목';
COMMENT ON COLUMN journal_projection_item.journal_id IS '일지';
COMMENT ON COLUMN journal_projection_item.section_key IS '섹션';
COMMENT ON COLUMN journal_projection_item.source_event_ids IS '근거 Event';
COMMENT ON COLUMN journal_projection_item.fact_payload_json IS '잠금 사실값';
COMMENT ON COLUMN journal_projection_item.narrative_text IS '서술';
COMMENT ON COLUMN journal_projection_item.sort_order IS '정렬';
COMMENT ON COLUMN journal_projection_item.locked_fields_json IS '잠금필드';

CREATE TABLE IF NOT EXISTS evaluation (
  evaluation_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  situation_id uuid NOT NULL,
  status varchar(20) NOT NULL,
  evaluation_type varchar(30) NOT NULL,
  overall_score numeric(6,2),
  summary text,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN evaluation.evaluation_id IS '평가';
COMMENT ON COLUMN evaluation.situation_id IS '훈련';
COMMENT ON COLUMN evaluation.status IS 'OPEN~CLOSED';
COMMENT ON COLUMN evaluation.evaluation_type IS 'EXERCISE/USABILITY';
COMMENT ON COLUMN evaluation.overall_score IS '종합점수';
COMMENT ON COLUMN evaluation.summary IS '종합의견';
COMMENT ON COLUMN evaluation.created_by IS '평가자';
COMMENT ON COLUMN evaluation.created_at IS '생성';

CREATE TABLE IF NOT EXISTS evaluation_score (
  score_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  evaluation_id uuid NOT NULL,
  criterion_code varchar(60) NOT NULL,
  score_value numeric(6,2) NOT NULL,
  weight_value numeric(6,3) NOT NULL,
  comment text,
  evidence_event_ids uuid[]
);
COMMENT ON COLUMN evaluation_score.score_id IS '평가점수';
COMMENT ON COLUMN evaluation_score.evaluation_id IS '평가';
COMMENT ON COLUMN evaluation_score.criterion_code IS '지표';
COMMENT ON COLUMN evaluation_score.score_value IS '점수';
COMMENT ON COLUMN evaluation_score.weight_value IS '가중치';
COMMENT ON COLUMN evaluation_score.comment IS '의견';
COMMENT ON COLUMN evaluation_score.evidence_event_ids IS '근거';

CREATE TABLE IF NOT EXISTS improvement_action (
  action_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  evaluation_id uuid NOT NULL,
  action_text text NOT NULL,
  owner_user_id uuid,
  due_at timestamptz,
  status varchar(20) NOT NULL,
  target_type varchar(30),
  target_id uuid
);
COMMENT ON COLUMN improvement_action.action_id IS '개선조치';
COMMENT ON COLUMN improvement_action.evaluation_id IS '평가';
COMMENT ON COLUMN improvement_action.action_text IS '조치';
COMMENT ON COLUMN improvement_action.owner_user_id IS '담당';
COMMENT ON COLUMN improvement_action.due_at IS '기한';
COMMENT ON COLUMN improvement_action.status IS 'OPEN~CLOSED';
COMMENT ON COLUMN improvement_action.target_type IS 'PLAN/SOP/SYSTEM';
COMMENT ON COLUMN improvement_action.target_id IS '환류대상';

CREATE TABLE IF NOT EXISTS provider_config (
  provider_config_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid,
  provider_code varchar(30) NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  priority_no int NOT NULL,
  base_url varchar(500),
  credential_ref varchar(300),
  timeout_json jsonb NOT NULL,
  feature_flags_json jsonb NOT NULL,
  version_no int DEFAULT 1 NOT NULL
);
COMMENT ON COLUMN provider_config.provider_config_id IS 'Provider 설정';
COMMENT ON COLUMN provider_config.tenant_id IS '기관별 Override';
COMMENT ON COLUMN provider_config.provider_code IS 'T3Q/UNI/KMA/...';
COMMENT ON COLUMN provider_config.enabled IS '활성';
COMMENT ON COLUMN provider_config.priority_no IS '우선순위';
COMMENT ON COLUMN provider_config.base_url IS 'URL';
COMMENT ON COLUMN provider_config.credential_ref IS 'Vault 참조';
COMMENT ON COLUMN provider_config.timeout_json IS 'Timeout';
COMMENT ON COLUMN provider_config.feature_flags_json IS 'Flag';
COMMENT ON COLUMN provider_config.version_no IS '버전';

CREATE TABLE IF NOT EXISTS audit_log (
  audit_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_id uuid,
  action varchar(80) NOT NULL,
  resource_type varchar(40) NOT NULL,
  resource_id uuid,
  before_json jsonb,
  after_json jsonb,
  correlation_id varchar(80) NOT NULL,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN audit_log.audit_id IS '감사';
COMMENT ON COLUMN audit_log.tenant_id IS '기관';
COMMENT ON COLUMN audit_log.actor_id IS '행위자';
COMMENT ON COLUMN audit_log.action IS '행위';
COMMENT ON COLUMN audit_log.resource_type IS '자원';
COMMENT ON COLUMN audit_log.resource_id IS '대상';
COMMENT ON COLUMN audit_log.before_json IS '변경전';
COMMENT ON COLUMN audit_log.after_json IS '변경후';
COMMENT ON COLUMN audit_log.correlation_id IS '추적';
COMMENT ON COLUMN audit_log.ip_address IS 'IP';
COMMENT ON COLUMN audit_log.user_agent IS 'UA';
COMMENT ON COLUMN audit_log.occurred_at IS '시각';

CREATE TABLE IF NOT EXISTS retention_policy (
  retention_policy_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid,
  resource_type varchar(40) NOT NULL,
  retention_days int NOT NULL,
  archive_strategy varchar(30) NOT NULL,
  legal_hold_enabled boolean DEFAULT false NOT NULL,
  version_no int DEFAULT 1 NOT NULL,
  updated_by uuid NOT NULL
);
COMMENT ON COLUMN retention_policy.retention_policy_id IS '보존정책';
COMMENT ON COLUMN retention_policy.tenant_id IS '기관';
COMMENT ON COLUMN retention_policy.resource_type IS '자원';
COMMENT ON COLUMN retention_policy.retention_days IS '일수';
COMMENT ON COLUMN retention_policy.archive_strategy IS 'OBJECT_STORAGE/DB_ARCHIVE';
COMMENT ON COLUMN retention_policy.legal_hold_enabled IS '법적보존';
COMMENT ON COLUMN retention_policy.version_no IS '버전';
COMMENT ON COLUMN retention_policy.updated_by IS '수정자';

CREATE TABLE IF NOT EXISTS notification (
  notification_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  notification_type varchar(40) NOT NULL,
  severity varchar(20) NOT NULL,
  title varchar(300) NOT NULL,
  body text NOT NULL,
  action_url varchar(700),
  read_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN notification.notification_id IS '알림';
COMMENT ON COLUMN notification.tenant_id IS '기관';
COMMENT ON COLUMN notification.user_id IS '수신자';
COMMENT ON COLUMN notification.notification_type IS '종류';
COMMENT ON COLUMN notification.severity IS 'INFO/WARN/CRITICAL';
COMMENT ON COLUMN notification.title IS '제목';
COMMENT ON COLUMN notification.body IS '내용';
COMMENT ON COLUMN notification.action_url IS '조치링크';
COMMENT ON COLUMN notification.read_at IS '읽음';
COMMENT ON COLUMN notification.created_at IS '생성';

