-- Tenant isolation policies. Application must SET LOCAL app.tenant_id = <uuid> for each transaction.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_tenant ON tenant;
CREATE POLICY p_tenant_tenant ON tenant USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_organization_tenant ON organization;
CREATE POLICY p_organization_tenant ON organization USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_app_user_tenant ON app_user;
CREATE POLICY p_app_user_tenant ON app_user USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

-- role/provider_config/retention_policy: tenant_id IS NULL은 전역(시스템) 행.
-- 런타임은 읽기만 허용하고(WITH CHECK는 테넌트 행만) 전역 행 생성/변경은
-- 관리 경로(superuser) 전용이다 (ADR-21).
ALTER TABLE role ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_role_tenant ON role;
CREATE POLICY p_role_tenant ON role USING (tenant_id = une_current_tenant_id() OR tenant_id IS NULL) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE plan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_plan_tenant ON plan;
CREATE POLICY p_plan_tenant ON plan USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE generation_job ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_generation_job_tenant ON generation_job;
CREATE POLICY p_generation_job_tenant ON generation_job USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE document ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_document_tenant ON document;
CREATE POLICY p_document_tenant ON document USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE file_object ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_file_object_tenant ON file_object;
CREATE POLICY p_file_object_tenant ON file_object USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE situation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_situation_tenant ON situation;
CREATE POLICY p_situation_tenant ON situation USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE knowledge_document ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_knowledge_document_tenant ON knowledge_document;
CREATE POLICY p_knowledge_document_tenant ON knowledge_document USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE sop ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_sop_tenant ON sop;
CREATE POLICY p_sop_tenant ON sop USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE execution_event ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_execution_event_tenant ON execution_event;
CREATE POLICY p_execution_event_tenant ON execution_event USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE outbox_message ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_outbox_message_tenant ON outbox_message;
CREATE POLICY p_outbox_message_tenant ON outbox_message USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE provider_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_provider_config_tenant ON provider_config;
CREATE POLICY p_provider_config_tenant ON provider_config USING (tenant_id = une_current_tenant_id() OR tenant_id IS NULL) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_audit_log_tenant ON audit_log;
CREATE POLICY p_audit_log_tenant ON audit_log USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE retention_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_retention_policy_tenant ON retention_policy;
CREATE POLICY p_retention_policy_tenant ON retention_policy USING (tenant_id = une_current_tenant_id() OR tenant_id IS NULL) WITH CHECK (tenant_id = une_current_tenant_id());

ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_notification_tenant ON notification;
CREATE POLICY p_notification_tenant ON notification USING (tenant_id = une_current_tenant_id()) WITH CHECK (tenant_id = une_current_tenant_id());

