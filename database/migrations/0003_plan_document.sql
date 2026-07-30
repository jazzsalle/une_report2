-- V003__plan_document.sql: generated from physical DB design baseline v1.0

CREATE TABLE IF NOT EXISTS plan (
  plan_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  title varchar(300) NOT NULL,
  hazard_type varchar(50) NOT NULL,
  management_phase varchar(20) NOT NULL,
  status varchar(30) NOT NULL,
  document_id uuid,
  current_context_snapshot_id uuid,
  current_toc_version_id uuid,
  owner_id uuid NOT NULL,
  version_no int DEFAULT 1 NOT NULL,
  deleted_at timestamptz,
  -- Design §6.10 index IX-plan_plan-STATUS and the global timestamp rule
  -- (§ "created_at/updated_at은 DB default now()") require these; the design
  -- column list omitted them (baseline defect resolved in ADR-21).
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN plan.plan_id IS '계획서';
COMMENT ON COLUMN plan.tenant_id IS '기관';
COMMENT ON COLUMN plan.title IS '문서명';
COMMENT ON COLUMN plan.hazard_type IS '재난유형';
COMMENT ON COLUMN plan.management_phase IS '예방/대비';
COMMENT ON COLUMN plan.status IS '상태';
COMMENT ON COLUMN plan.document_id IS '편집문서';
COMMENT ON COLUMN plan.current_context_snapshot_id IS '현재 기준정보';
COMMENT ON COLUMN plan.current_toc_version_id IS '현재 목차';
COMMENT ON COLUMN plan.owner_id IS '소유자';
COMMENT ON COLUMN plan.version_no IS '낙관잠금';
COMMENT ON COLUMN plan.deleted_at IS '휴지통';
COMMENT ON COLUMN plan.created_at IS '생성';
COMMENT ON COLUMN plan.updated_at IS '수정';
DROP TRIGGER IF EXISTS trg_plan_updated_at ON plan;
CREATE TRIGGER trg_plan_updated_at BEFORE UPDATE ON plan FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();

CREATE TABLE IF NOT EXISTS plan_context_draft (
  context_draft_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id uuid NOT NULL,
  context_json jsonb NOT NULL,
  schema_version varchar(20) NOT NULL,
  updated_by uuid NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN plan_context_draft.context_draft_id IS '임시 기준정보';
COMMENT ON COLUMN plan_context_draft.plan_id IS '계획서';
COMMENT ON COLUMN plan_context_draft.context_json IS '입력값';
COMMENT ON COLUMN plan_context_draft.schema_version IS 'Schema 버전';
COMMENT ON COLUMN plan_context_draft.updated_by IS '수정자';
COMMENT ON COLUMN plan_context_draft.updated_at IS '수정일시';
DROP TRIGGER IF EXISTS trg_plan_context_draft_updated_at ON plan_context_draft;
CREATE TRIGGER trg_plan_context_draft_updated_at BEFORE UPDATE ON plan_context_draft FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();

CREATE TABLE IF NOT EXISTS plan_context_snapshot (
  context_snapshot_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id uuid NOT NULL,
  version_no int DEFAULT 1 NOT NULL,
  context_json jsonb NOT NULL,
  content_hash char(64) NOT NULL,
  supersedes_id uuid,
  confirmed_by uuid NOT NULL,
  confirmed_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN plan_context_snapshot.context_snapshot_id IS '확정 Snapshot';
COMMENT ON COLUMN plan_context_snapshot.plan_id IS '계획서';
COMMENT ON COLUMN plan_context_snapshot.version_no IS '버전';
COMMENT ON COLUMN plan_context_snapshot.context_json IS '불변 기준정보';
COMMENT ON COLUMN plan_context_snapshot.content_hash IS 'SHA-256';
COMMENT ON COLUMN plan_context_snapshot.supersedes_id IS '이전 Snapshot';
COMMENT ON COLUMN plan_context_snapshot.confirmed_by IS '확정자';
COMMENT ON COLUMN plan_context_snapshot.confirmed_at IS '확정일시';

CREATE TABLE IF NOT EXISTS toc_version (
  toc_version_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id uuid NOT NULL,
  version_no int DEFAULT 1 NOT NULL,
  source_type varchar(20) NOT NULL,
  base_snapshot_id uuid NOT NULL,
  status varchar(20) NOT NULL,
  content_hash char(64) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN toc_version.toc_version_id IS '목차 버전';
COMMENT ON COLUMN toc_version.plan_id IS '계획서';
COMMENT ON COLUMN toc_version.version_no IS '버전';
COMMENT ON COLUMN toc_version.source_type IS 'AI/USER';
COMMENT ON COLUMN toc_version.base_snapshot_id IS '기준 Snapshot';
COMMENT ON COLUMN toc_version.status IS 'DRAFT/CONFIRMED';
COMMENT ON COLUMN toc_version.content_hash IS '해시';
COMMENT ON COLUMN toc_version.created_by IS '작성자';
COMMENT ON COLUMN toc_version.created_at IS '생성';

CREATE TABLE IF NOT EXISTS toc_node (
  toc_node_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  toc_version_id uuid NOT NULL,
  parent_node_id uuid,
  node_key varchar(80) NOT NULL,
  title varchar(500) NOT NULL,
  level smallint NOT NULL,
  sort_order int DEFAULT 0 NOT NULL,
  generation_policy jsonb NOT NULL
);
COMMENT ON COLUMN toc_node.toc_node_id IS '목차노드';
COMMENT ON COLUMN toc_node.toc_version_id IS '버전';
COMMENT ON COLUMN toc_node.parent_node_id IS '부모';
COMMENT ON COLUMN toc_node.node_key IS '안정 ID';
COMMENT ON COLUMN toc_node.title IS '제목';
COMMENT ON COLUMN toc_node.level IS '계층';
COMMENT ON COLUMN toc_node.sort_order IS '순서';
COMMENT ON COLUMN toc_node.generation_policy IS '생성규칙';

CREATE TABLE IF NOT EXISTS generation_job (
  job_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  job_type varchar(30) NOT NULL,
  aggregate_type varchar(30) NOT NULL,
  aggregate_id uuid NOT NULL,
  provider_code varchar(30) NOT NULL,
  request_json jsonb NOT NULL,
  status varchar(20) NOT NULL,
  progress_pct numeric(5,2) NOT NULL,
  idempotency_key varchar(100) NOT NULL,
  correlation_id varchar(80) NOT NULL,
  error_json jsonb,
  started_at timestamptz,
  finished_at timestamptz
);
COMMENT ON COLUMN generation_job.job_id IS '비동기 Job';
COMMENT ON COLUMN generation_job.tenant_id IS '기관';
COMMENT ON COLUMN generation_job.job_type IS 'TOC/CONTENT/AI_EDIT/SOP';
COMMENT ON COLUMN generation_job.aggregate_type IS 'PLAN/DOCUMENT/SITUATION';
COMMENT ON COLUMN generation_job.aggregate_id IS '대상';
COMMENT ON COLUMN generation_job.provider_code IS 'T3Q/UNI/UNE';
COMMENT ON COLUMN generation_job.request_json IS 'Adapter 요청';
COMMENT ON COLUMN generation_job.status IS 'QUEUED~FAILED';
COMMENT ON COLUMN generation_job.progress_pct IS '진행률';
COMMENT ON COLUMN generation_job.idempotency_key IS '멱등키';
COMMENT ON COLUMN generation_job.correlation_id IS '추적';
COMMENT ON COLUMN generation_job.error_json IS '오류';
COMMENT ON COLUMN generation_job.started_at IS '시작';
COMMENT ON COLUMN generation_job.finished_at IS '종료';

CREATE TABLE IF NOT EXISTS job_event (
  job_event_id bigserial PRIMARY KEY,
  job_id uuid NOT NULL,
  sequence_no bigint NOT NULL,
  event_type varchar(40) NOT NULL,
  payload_json jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN job_event.job_event_id IS 'Job Event';
COMMENT ON COLUMN job_event.job_id IS 'Job';
COMMENT ON COLUMN job_event.sequence_no IS 'SSE 순번';
COMMENT ON COLUMN job_event.event_type IS 'Event 종류';
COMMENT ON COLUMN job_event.payload_json IS '내용';
COMMENT ON COLUMN job_event.created_at IS '생성';

CREATE TABLE IF NOT EXISTS document (
  document_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  document_type varchar(30) NOT NULL,
  title varchar(300) NOT NULL,
  source_file_id uuid,
  current_revision_id uuid,
  status varchar(30) NOT NULL,
  owner_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN document.document_id IS '문서';
COMMENT ON COLUMN document.tenant_id IS '기관';
COMMENT ON COLUMN document.document_type IS 'PLAN/JOURNAL';
COMMENT ON COLUMN document.title IS '제목';
COMMENT ON COLUMN document.source_file_id IS '원본 HWPX';
COMMENT ON COLUMN document.current_revision_id IS '현재 Revision';
COMMENT ON COLUMN document.status IS 'EDITING/REVIEW/APPROVED';
COMMENT ON COLUMN document.owner_id IS '소유자';
COMMENT ON COLUMN document.created_at IS '생성';
COMMENT ON COLUMN document.updated_at IS '수정';
DROP TRIGGER IF EXISTS trg_document_updated_at ON document;
CREATE TRIGGER trg_document_updated_at BEFORE UPDATE ON document FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();

CREATE TABLE IF NOT EXISTS document_revision (
  revision_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL,
  revision_no int NOT NULL,
  parent_revision_id uuid,
  ir_json jsonb NOT NULL,
  ir_hash char(64) NOT NULL,
  change_summary text,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN document_revision.revision_id IS 'Revision';
COMMENT ON COLUMN document_revision.document_id IS '문서';
COMMENT ON COLUMN document_revision.revision_no IS '순번';
COMMENT ON COLUMN document_revision.parent_revision_id IS '부모';
COMMENT ON COLUMN document_revision.ir_json IS 'Document IR';
COMMENT ON COLUMN document_revision.ir_hash IS '해시';
COMMENT ON COLUMN document_revision.change_summary IS '변경요약';
COMMENT ON COLUMN document_revision.created_by IS '작성자';
COMMENT ON COLUMN document_revision.created_at IS '생성';

CREATE TABLE IF NOT EXISTS document_block (
  block_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  revision_id uuid NOT NULL,
  stable_block_key varchar(100) NOT NULL,
  block_type varchar(30) NOT NULL,
  parent_block_id uuid,
  sort_order int DEFAULT 0 NOT NULL,
  text_content text,
  style_ref varchar(100),
  protection_state varchar(20) NOT NULL,
  payload_json jsonb NOT NULL
);
COMMENT ON COLUMN document_block.block_id IS 'Block';
COMMENT ON COLUMN document_block.revision_id IS 'Revision';
COMMENT ON COLUMN document_block.stable_block_key IS '안정 ID';
COMMENT ON COLUMN document_block.block_type IS 'PARAGRAPH/TABLE/...';
COMMENT ON COLUMN document_block.parent_block_id IS '부모';
COMMENT ON COLUMN document_block.sort_order IS '순서';
COMMENT ON COLUMN document_block.text_content IS '검색용 텍스트';
COMMENT ON COLUMN document_block.style_ref IS '서식 참조';
COMMENT ON COLUMN document_block.protection_state IS 'NONE/USER_LOCKED/SYSTEM_LOCKED';
COMMENT ON COLUMN document_block.payload_json IS 'IR 세부';

CREATE TABLE IF NOT EXISTS change_set (
  change_set_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL,
  base_revision_id uuid NOT NULL,
  result_revision_id uuid,
  client_mutation_id varchar(100) NOT NULL,
  selection_json jsonb NOT NULL,
  status varchar(20) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN change_set.change_set_id IS '변경세트';
COMMENT ON COLUMN change_set.document_id IS '문서';
COMMENT ON COLUMN change_set.base_revision_id IS '기준';
COMMENT ON COLUMN change_set.result_revision_id IS '결과';
COMMENT ON COLUMN change_set.client_mutation_id IS '클라이언트 멱등키';
COMMENT ON COLUMN change_set.selection_json IS '선택영역';
COMMENT ON COLUMN change_set.status IS 'APPLIED/REJECTED';
COMMENT ON COLUMN change_set.created_by IS '사용자';
COMMENT ON COLUMN change_set.created_at IS '시각';

CREATE TABLE IF NOT EXISTS change_operation (
  operation_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  change_set_id uuid NOT NULL,
  operation_order int NOT NULL,
  operation_type varchar(40) NOT NULL,
  target_json jsonb NOT NULL,
  before_json jsonb,
  after_json jsonb
);
COMMENT ON COLUMN change_operation.operation_id IS 'Operation';
COMMENT ON COLUMN change_operation.change_set_id IS 'ChangeSet';
COMMENT ON COLUMN change_operation.operation_order IS '순서';
COMMENT ON COLUMN change_operation.operation_type IS 'insertText 등';
COMMENT ON COLUMN change_operation.target_json IS '대상';
COMMENT ON COLUMN change_operation.before_json IS '변경전';
COMMENT ON COLUMN change_operation.after_json IS '변경후';

CREATE TABLE IF NOT EXISTS template_profile (
  template_profile_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL,
  profile_version int NOT NULL,
  analysis_status varchar(20) NOT NULL,
  profile_json jsonb NOT NULL,
  unsupported_objects_json jsonb NOT NULL,
  analysis_hash char(64) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN template_profile.template_profile_id IS 'Template Profile';
COMMENT ON COLUMN template_profile.document_id IS '문서';
COMMENT ON COLUMN template_profile.profile_version IS '버전';
COMMENT ON COLUMN template_profile.analysis_status IS '상태';
COMMENT ON COLUMN template_profile.profile_json IS 'Section/Style/Prototype';
COMMENT ON COLUMN template_profile.unsupported_objects_json IS '미지원 객체';
COMMENT ON COLUMN template_profile.analysis_hash IS '해시';
COMMENT ON COLUMN template_profile.created_at IS '생성';

CREATE TABLE IF NOT EXISTS style_prototype (
  prototype_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_profile_id uuid NOT NULL,
  prototype_key varchar(100) NOT NULL,
  prototype_type varchar(40) NOT NULL,
  source_locator_json jsonb NOT NULL,
  clone_policy_json jsonb NOT NULL,
  style_fingerprint char(64) NOT NULL
);
COMMENT ON COLUMN style_prototype.prototype_id IS 'Prototype';
COMMENT ON COLUMN style_prototype.template_profile_id IS 'Profile';
COMMENT ON COLUMN style_prototype.prototype_key IS '키';
COMMENT ON COLUMN style_prototype.prototype_type IS 'TITLE/PARA/TABLE/...';
COMMENT ON COLUMN style_prototype.source_locator_json IS '원본 위치';
COMMENT ON COLUMN style_prototype.clone_policy_json IS '복제정책';
COMMENT ON COLUMN style_prototype.style_fingerprint IS '서식 지문';

CREATE TABLE IF NOT EXISTS file_object (
  file_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  storage_key varchar(500) NOT NULL,
  original_name varchar(500) NOT NULL,
  mime_type varchar(150) NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 char(64) NOT NULL,
  scan_status varchar(20) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uk_file_object_storage_key UNIQUE (storage_key)
);
COMMENT ON COLUMN file_object.file_id IS '파일';
COMMENT ON COLUMN file_object.tenant_id IS '기관';
COMMENT ON COLUMN file_object.storage_key IS 'Object Key';
COMMENT ON COLUMN file_object.original_name IS '원본명';
COMMENT ON COLUMN file_object.mime_type IS 'MIME';
COMMENT ON COLUMN file_object.size_bytes IS '크기';
COMMENT ON COLUMN file_object.sha256 IS '무결성';
COMMENT ON COLUMN file_object.scan_status IS 'PENDING/CLEAN/INFECTED';
COMMENT ON COLUMN file_object.created_by IS '등록자';
COMMENT ON COLUMN file_object.created_at IS '생성';

CREATE TABLE IF NOT EXISTS export_job (
  export_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  format varchar(20) NOT NULL,
  status varchar(20) NOT NULL,
  output_file_id uuid,
  validation_report_id uuid,
  requested_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  finished_at timestamptz
);
COMMENT ON COLUMN export_job.export_id IS 'Export';
COMMENT ON COLUMN export_job.document_id IS '문서';
COMMENT ON COLUMN export_job.revision_id IS 'Revision';
COMMENT ON COLUMN export_job.format IS 'HWPX/PDF/DOCX';
COMMENT ON COLUMN export_job.status IS 'QUEUED~FAILED';
COMMENT ON COLUMN export_job.output_file_id IS '결과';
COMMENT ON COLUMN export_job.validation_report_id IS '검증';
COMMENT ON COLUMN export_job.requested_by IS '요청자';
COMMENT ON COLUMN export_job.created_at IS '요청';
COMMENT ON COLUMN export_job.finished_at IS '완료';

CREATE TABLE IF NOT EXISTS validation_report (
  validation_report_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  target_type varchar(30) NOT NULL,
  target_id uuid NOT NULL,
  track varchar(20) NOT NULL,
  status varchar(20) NOT NULL,
  checks_json jsonb NOT NULL,
  environment_json jsonb NOT NULL,
  evidence_file_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN validation_report.validation_report_id IS '검증보고서';
COMMENT ON COLUMN validation_report.target_type IS 'DOCUMENT/EXPORT';
COMMENT ON COLUMN validation_report.target_id IS '대상';
COMMENT ON COLUMN validation_report.track IS 'A_AUTO/B_HANCOM';
COMMENT ON COLUMN validation_report.status IS 'PASS/LIMITED/FAIL';
COMMENT ON COLUMN validation_report.checks_json IS '검사항목';
COMMENT ON COLUMN validation_report.environment_json IS '버전/환경';
COMMENT ON COLUMN validation_report.evidence_file_id IS '증빙';
COMMENT ON COLUMN validation_report.created_at IS '검증일시';

