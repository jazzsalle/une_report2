-- V005__sop_task.sql: generated from physical DB design baseline v1.0
BEGIN;

CREATE TABLE IF NOT EXISTS sop (
  sop_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid DEFAULT gen_random_uuid() NOT NULL,
  situation_id uuid,
  title varchar(300) NOT NULL,
  hazard_type varchar(50) NOT NULL,
  status varchar(30) NOT NULL,
  current_version_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN sop.sop_id IS 'SOP';
COMMENT ON COLUMN sop.tenant_id IS '기관';
COMMENT ON COLUMN sop.situation_id IS '상황';
COMMENT ON COLUMN sop.title IS '명칭';
COMMENT ON COLUMN sop.hazard_type IS '재난유형';
COMMENT ON COLUMN sop.status IS 'DRAFT~RETIRED';
COMMENT ON COLUMN sop.current_version_id IS '현재 버전';
COMMENT ON COLUMN sop.created_by IS '작성자';
COMMENT ON COLUMN sop.created_at IS '생성';

CREATE TABLE IF NOT EXISTS sop_version (
  sop_version_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sop_id uuid DEFAULT gen_random_uuid() NOT NULL,
  version_no int DEFAULT 1 NOT NULL,
  status varchar(20) NOT NULL,
  graph_hash char(64) NOT NULL,
  source_snapshot_id uuid,
  source_evidence_set_id uuid,
  schema_version varchar(20) NOT NULL,
  approved_by uuid,
  approved_at timestamptz
);
COMMENT ON COLUMN sop_version.sop_version_id IS 'SOP 버전';
COMMENT ON COLUMN sop_version.sop_id IS 'SOP';
COMMENT ON COLUMN sop_version.version_no IS '버전';
COMMENT ON COLUMN sop_version.status IS 'DRAFT/LOCKED';
COMMENT ON COLUMN sop_version.graph_hash IS '그래프 해시';
COMMENT ON COLUMN sop_version.source_snapshot_id IS 'SituationSnapshot';
COMMENT ON COLUMN sop_version.source_evidence_set_id IS '근거';
COMMENT ON COLUMN sop_version.schema_version IS 'Schema';
COMMENT ON COLUMN sop_version.approved_by IS '승인자';
COMMENT ON COLUMN sop_version.approved_at IS '승인';

CREATE TABLE IF NOT EXISTS sop_node (
  node_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sop_version_id uuid DEFAULT gen_random_uuid() NOT NULL,
  node_key varchar(80) NOT NULL,
  node_type varchar(20) NOT NULL,
  title varchar(300) NOT NULL,
  config_json jsonb NOT NULL,
  position_x numeric(10,2),
  position_y numeric(10,2),
  sort_order int
);
COMMENT ON COLUMN sop_node.node_id IS '노드';
COMMENT ON COLUMN sop_node.sop_version_id IS '버전';
COMMENT ON COLUMN sop_node.node_key IS '안정 Key';
COMMENT ON COLUMN sop_node.node_type IS 'START/ACTION/DECISION/NOTE/END';
COMMENT ON COLUMN sop_node.title IS '제목';
COMMENT ON COLUMN sop_node.config_json IS '임무/완료조건/전파';
COMMENT ON COLUMN sop_node.position_x IS 'Canvas X';
COMMENT ON COLUMN sop_node.position_y IS 'Canvas Y';
COMMENT ON COLUMN sop_node.sort_order IS '정렬';

CREATE TABLE IF NOT EXISTS sop_edge (
  edge_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sop_version_id uuid DEFAULT gen_random_uuid() NOT NULL,
  from_node_id uuid DEFAULT gen_random_uuid() NOT NULL,
  to_node_id uuid DEFAULT gen_random_uuid() NOT NULL,
  condition_expr text,
  condition_schema jsonb,
  priority int DEFAULT 0 NOT NULL,
  label varchar(100)
);
COMMENT ON COLUMN sop_edge.edge_id IS 'Edge';
COMMENT ON COLUMN sop_edge.sop_version_id IS '버전';
COMMENT ON COLUMN sop_edge.from_node_id IS '출발';
COMMENT ON COLUMN sop_edge.to_node_id IS '도착';
COMMENT ON COLUMN sop_edge.condition_expr IS '분기식';
COMMENT ON COLUMN sop_edge.condition_schema IS '파라미터';
COMMENT ON COLUMN sop_edge.priority IS '우선순위';
COMMENT ON COLUMN sop_edge.label IS '표시명';

CREATE TABLE IF NOT EXISTS sop_validation (
  validation_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sop_version_id uuid DEFAULT gen_random_uuid() NOT NULL,
  status varchar(20) NOT NULL,
  errors_json jsonb NOT NULL,
  warnings_json jsonb NOT NULL,
  validator_version varchar(30) NOT NULL,
  validated_by uuid,
  validated_at timestamptz NOT NULL
);
COMMENT ON COLUMN sop_validation.validation_id IS '검증';
COMMENT ON COLUMN sop_validation.sop_version_id IS '버전';
COMMENT ON COLUMN sop_validation.status IS 'PASS/FAIL';
COMMENT ON COLUMN sop_validation.errors_json IS '오류';
COMMENT ON COLUMN sop_validation.warnings_json IS '경고';
COMMENT ON COLUMN sop_validation.validator_version IS '검증기 버전';
COMMENT ON COLUMN sop_validation.validated_by IS '사용자/시스템';
COMMENT ON COLUMN sop_validation.validated_at IS '검증';

CREATE TABLE IF NOT EXISTS sop_run (
  run_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sop_version_id uuid DEFAULT gen_random_uuid() NOT NULL,
  situation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  snapshot_id uuid DEFAULT gen_random_uuid() NOT NULL,
  mode varchar(20) NOT NULL,
  status varchar(20) NOT NULL,
  started_by uuid NOT NULL,
  started_at timestamptz DEFAULT now() NOT NULL,
  ended_at timestamptz,
  correlation_id varchar(80) NOT NULL
);
COMMENT ON COLUMN sop_run.run_id IS '실행';
COMMENT ON COLUMN sop_run.sop_version_id IS '고정 버전';
COMMENT ON COLUMN sop_run.situation_id IS '상황';
COMMENT ON COLUMN sop_run.snapshot_id IS '시작 Snapshot';
COMMENT ON COLUMN sop_run.mode IS 'LIVE/DRY_RUN/EXERCISE';
COMMENT ON COLUMN sop_run.status IS 'READY~TERMINATED';
COMMENT ON COLUMN sop_run.started_by IS '시작자';
COMMENT ON COLUMN sop_run.started_at IS '시작';
COMMENT ON COLUMN sop_run.ended_at IS '종료';
COMMENT ON COLUMN sop_run.correlation_id IS '추적';

CREATE TABLE IF NOT EXISTS task (
  task_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid DEFAULT gen_random_uuid() NOT NULL,
  node_id uuid DEFAULT gen_random_uuid() NOT NULL,
  title varchar(300) NOT NULL,
  status varchar(30) NOT NULL,
  assignee_user_id uuid,
  assignee_org_id uuid,
  due_at timestamptz,
  completion_policy_json jsonb NOT NULL,
  progress_pct numeric(5,2) NOT NULL,
  version_no int DEFAULT 1 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN task.task_id IS '임무';
COMMENT ON COLUMN task.run_id IS 'SOP 실행';
COMMENT ON COLUMN task.node_id IS '원본 노드';
COMMENT ON COLUMN task.title IS '임무명';
COMMENT ON COLUMN task.status IS 'CREATED~CANCELLED';
COMMENT ON COLUMN task.assignee_user_id IS '담당자';
COMMENT ON COLUMN task.assignee_org_id IS '담당조직';
COMMENT ON COLUMN task.due_at IS '기한';
COMMENT ON COLUMN task.completion_policy_json IS '완료조건';
COMMENT ON COLUMN task.progress_pct IS '진행률';
COMMENT ON COLUMN task.version_no IS '낙관잠금';
COMMENT ON COLUMN task.created_at IS '생성';

CREATE TABLE IF NOT EXISTS task_event (
  task_event_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid DEFAULT gen_random_uuid() NOT NULL,
  event_type varchar(40) NOT NULL,
  event_time timestamptz NOT NULL,
  actor_id uuid,
  payload_json jsonb NOT NULL,
  correlation_id varchar(80) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN task_event.task_event_id IS 'Task Event';
COMMENT ON COLUMN task_event.task_id IS '임무';
COMMENT ON COLUMN task_event.event_type IS 'DISPATCHED/ACK/...';
COMMENT ON COLUMN task_event.event_time IS '업무시각';
COMMENT ON COLUMN task_event.actor_id IS '행위자';
COMMENT ON COLUMN task_event.payload_json IS '내용';
COMMENT ON COLUMN task_event.correlation_id IS '추적';
COMMENT ON COLUMN task_event.created_at IS '기록';

CREATE TABLE IF NOT EXISTS task_attachment (
  task_attachment_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid DEFAULT gen_random_uuid() NOT NULL,
  file_id uuid DEFAULT gen_random_uuid() NOT NULL,
  category varchar(30) NOT NULL,
  caption varchar(500),
  geo_json jsonb,
  captured_at timestamptz,
  uploaded_by uuid NOT NULL
);
COMMENT ON COLUMN task_attachment.task_attachment_id IS '첨부';
COMMENT ON COLUMN task_attachment.task_id IS '임무';
COMMENT ON COLUMN task_attachment.file_id IS '파일';
COMMENT ON COLUMN task_attachment.category IS 'PHOTO/DOC/VIDEO';
COMMENT ON COLUMN task_attachment.caption IS '설명';
COMMENT ON COLUMN task_attachment.geo_json IS '위치';
COMMENT ON COLUMN task_attachment.captured_at IS '촬영';
COMMENT ON COLUMN task_attachment.uploaded_by IS '등록자';

CREATE TABLE IF NOT EXISTS dispatch (
  dispatch_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid,
  situation_id uuid DEFAULT gen_random_uuid() NOT NULL,
  message_type varchar(30) NOT NULL,
  message_body text NOT NULL,
  status varchar(20) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN dispatch.dispatch_id IS '전파';
COMMENT ON COLUMN dispatch.task_id IS '임무';
COMMENT ON COLUMN dispatch.situation_id IS '상황';
COMMENT ON COLUMN dispatch.message_type IS 'SITUATION/TASK/ESCALATION';
COMMENT ON COLUMN dispatch.message_body IS '내용';
COMMENT ON COLUMN dispatch.status IS 'PENDING~PARTIAL';
COMMENT ON COLUMN dispatch.created_by IS '발신자';
COMMENT ON COLUMN dispatch.created_at IS '생성';

CREATE TABLE IF NOT EXISTS dispatch_recipient (
  recipient_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  dispatch_id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid,
  organization_id uuid,
  channel varchar(20) NOT NULL,
  address_enc bytea,
  delivery_status varchar(20) NOT NULL,
  acknowledged_at timestamptz
);
COMMENT ON COLUMN dispatch_recipient.recipient_id IS '수신자';
COMMENT ON COLUMN dispatch_recipient.dispatch_id IS '전파';
COMMENT ON COLUMN dispatch_recipient.user_id IS '사용자';
COMMENT ON COLUMN dispatch_recipient.organization_id IS '조직';
COMMENT ON COLUMN dispatch_recipient.channel IS 'SYSTEM/SMS/EMAIL/PUSH';
COMMENT ON COLUMN dispatch_recipient.address_enc IS '암호화 주소';
COMMENT ON COLUMN dispatch_recipient.delivery_status IS 'PENDING~FAILED';
COMMENT ON COLUMN dispatch_recipient.acknowledged_at IS '수신확인';

COMMIT;
