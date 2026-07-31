-- 0012: RBAC catalog completion for CC-100 (ADR-22)
--
-- The API/Sequence design reads role_permission (UNE-AUTH-007 DB tables;
-- SEQ reads [tenant, app_user, role, organization, permission,
-- role_permission]) but the physical table list in the same document omits
-- it — the same class of internal inconsistency ADR-21 resolved. Forward-only
-- addition; no applied migration is edited.

CREATE TABLE IF NOT EXISTS role_permission (
  role_permission_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT fk_role_permission_role FOREIGN KEY (role_id)
    REFERENCES role(role_id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permission_permission FOREIGN KEY (permission_id)
    REFERENCES permission(permission_id) ON DELETE CASCADE,
  CONSTRAINT uk_role_permission UNIQUE (role_id, permission_id)
);
COMMENT ON COLUMN role_permission.role_permission_id IS '역할-권한 매핑';
COMMENT ON COLUMN role_permission.role_id IS '역할';
COMMENT ON COLUMN role_permission.permission_id IS '권한';
COMMENT ON COLUMN role_permission.created_at IS '부여일시';
CREATE INDEX IF NOT EXISTS ix_role_permission_role ON role_permission (role_id);

-- role_permission has no tenant_id: tenant isolation is enforced by the
-- service layer joining role (RLS-protected), per the ADR-21 compensating
-- control for child tables.

-- Seed idempotency and integrity: role_code must be unique per scope.
-- Without these, re-running catalog seeds would duplicate system roles.
CREATE UNIQUE INDEX IF NOT EXISTS uk_role_code_global
  ON role (role_code) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_role_code_tenant
  ON role (tenant_id, role_code) WHERE tenant_id IS NOT NULL;

-- Permission catalog: 1:1 with the x-permission codes of
-- contracts/openapi/une-platform-api-v1.yaml (AUTHENTICATED and PUBLIC_SSO
-- are auth levels, not permissions). Rows already seeded by 0009 are skipped.
INSERT INTO permission (permission_code, resource_type, action, description) VALUES
  ('ADMIN_ACCESS','ADMIN','MANAGE','시스템 관리'),
  ('ADMIN_INTEGRATION','ADMIN','INTEGRATION','외부 연계 운영'),
  ('ADMIN_ORG','ADMIN','ORG','조직·채널 관리'),
  ('ADMIN_OUTBOX','ADMIN','OUTBOX','Outbox 운영'),
  ('ADMIN_SECURITY','ADMIN','SECURITY','보안·보존 설정'),
  ('AUDIT_READ','AUDIT','READ','감사로그 조회'),
  ('DASHBOARD_READ','DASHBOARD','READ','전자상황판 조회'),
  ('DOC_AI_EDIT','DOCUMENT','AI_EDIT','문서 AI 문안 개선'),
  ('DOC_APPROVE','DOCUMENT','APPROVE','문서 승인'),
  ('DOC_EDIT','DOCUMENT','EDIT','rhwp 문서 편집'),
  ('DOC_EXPORT','DOCUMENT','EXPORT','문서 내보내기'),
  ('DOC_READ','DOCUMENT','READ','문서 조회'),
  ('DOC_REVIEW','DOCUMENT','REVIEW','문서 검토'),
  ('EVALUATION_EDIT','EVALUATION','EDIT','평가·개선조치 작성'),
  ('EVALUATION_READ','EVALUATION','READ','평가 조회'),
  ('EVIDENCE_LOCK','EVIDENCE','LOCK','Evidence 잠금'),
  ('EVIDENCE_READ','EVIDENCE','READ','Evidence 조회'),
  ('EVIDENCE_SEARCH','EVIDENCE','SEARCH','Evidence 검색'),
  ('EXECUTION_CORRECT','EXECUTION','CORRECT','실행로그 정정 이벤트'),
  ('EXECUTION_READ','EXECUTION','READ','실행로그 조회'),
  ('FILE_UPLOAD','FILE','UPLOAD','파일 업로드'),
  ('JOURNAL_AI_EDIT','JOURNAL','AI_EDIT','일지 AI 문안 개선'),
  ('JOURNAL_APPROVE','JOURNAL','APPROVE','상황일지 승인'),
  ('JOURNAL_CREATE','JOURNAL','CREATE','상황일지 Projection'),
  ('JOURNAL_EDIT','JOURNAL','EDIT','상황일지 편집'),
  ('JOURNAL_EXPORT','JOURNAL','EXPORT','상황일지 내보내기'),
  ('JOURNAL_READ','JOURNAL','READ','상황일지 조회'),
  ('KNOWLEDGE_READ','KNOWLEDGE','READ','학습자료 조회'),
  ('KNOWLEDGE_UPLOAD','KNOWLEDGE','UPLOAD','학습자료 업로드'),
  ('ORG_READ','ORG','READ','조직도 조회'),
  ('PLAN_CREATE','PLAN','CREATE','계획서 생성'),
  ('PLAN_DELETE','PLAN','DELETE','계획서 삭제'),
  ('PLAN_EDIT','PLAN','EDIT','계획서 편집'),
  ('PLAN_GENERATE','PLAN','GENERATE','T3Q 목차·본문 생성'),
  ('PLAN_READ','PLAN','READ','계획서 조회'),
  ('RBAC_READ','RBAC','READ','역할·권한 조회'),
  ('SITUATION_CLOSE','SITUATION','CLOSE','상황 종료'),
  ('SITUATION_CONFIRM','SITUATION','CONFIRM','SituationSnapshot 확정'),
  ('SITUATION_CREATE','SITUATION','CREATE','상황·훈련 등록'),
  ('SITUATION_EDIT','SITUATION','EDIT','상황 편집'),
  ('SITUATION_FACT_COLLECT','SITUATION','FACT_COLLECT','Provider Fact 수집'),
  ('SITUATION_FACT_EDIT','SITUATION','FACT_EDIT','SituationFact 편집'),
  ('SITUATION_READ','SITUATION','READ','상황 조회'),
  ('SOP_APPROVE','SOP','APPROVE','SOP 승인'),
  ('SOP_EDIT','SOP','EDIT','SOP 편집'),
  ('SOP_GENERATE','SOP','GENERATE','SOP 생성'),
  ('SOP_READ','SOP','READ','SOP 조회'),
  ('SOP_RUN','SOP','RUN','SOP 실행'),
  ('SOP_RUN_CONTROL','SOP','RUN_CONTROL','SOP 실행 통제'),
  ('TASK_ASSIGNEE','TASK','REPORT','현장 임무 수행·보고'),
  ('TASK_DISPATCH','TASK','DISPATCH','임무 전파'),
  ('TASK_READ','TASK','READ','임무 조회'),
  ('TASK_SUPERVISE','TASK','SUPERVISE','임무 감독'),
  ('USER_READ','USER','READ','사용자 조회')
ON CONFLICT (permission_code) DO NOTHING;

-- System roles: 1:1 with the Actor·Role catalog of the screen/permission
-- design (09 §3). Global rows (tenant_id IS NULL) are readable but not
-- writable by the runtime role under the 0008 policies; provisioning paths
-- (migrations, ops) manage them.
INSERT INTO role (tenant_id, role_code, role_name, scope_type, is_system) VALUES
  (NULL,'SYSTEM_ADMIN','시스템 관리자','SYSTEM',true),
  (NULL,'INSTITUTION_ADMIN','기관 관리자','TENANT',true),
  (NULL,'PLAN_AUTHOR','계획서 작성자','OBJECT',true),
  (NULL,'PLAN_REVIEWER','계획서 검토자','OBJECT',true),
  (NULL,'PLAN_APPROVER','계획서 승인자','OBJECT',true),
  (NULL,'TEMPLATE_MANAGER','Template 관리자','OBJECT',true),
  (NULL,'DOCUMENT_QA','문서 QA','OBJECT',true),
  (NULL,'SITUATION_REGISTRAR','상황 등록자','OBJECT',true),
  (NULL,'SOP_EDITOR','SOP 편집자','OBJECT',true),
  (NULL,'EXERCISE_CONTROLLER','훈련 통제관','OBJECT',true),
  (NULL,'COMMANDER','지휘관','OBJECT',true),
  (NULL,'TASK_ASSIGNEE','임무 수행자','OBJECT',true),
  (NULL,'JOURNAL_AUTHOR','상황일지 작성자','OBJECT',true),
  (NULL,'EVALUATOR','평가자','OBJECT',true),
  (NULL,'AUDITOR','감사자','OBJECT',true)
ON CONFLICT (role_code) WHERE tenant_id IS NULL DO NOTHING;

-- The role→permission matrix is not finalized in the design (per-screen
-- tables refine it per domain item); runtime only reads the mapping. The
-- design admin APIs write user_role and audit_log, not role_permission, so
-- mapping management stays a provisioning concern for now (re-grant later
-- with the admin Work Item that owns it).
REVOKE INSERT, UPDATE, DELETE ON role_permission FROM une_app;
