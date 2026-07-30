-- V002__iam.sql: generated from physical DB design baseline v1.0

CREATE TABLE IF NOT EXISTS tenant (
  tenant_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_code varchar(30) NOT NULL,
  tenant_name varchar(200) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('ACTIVE','SUSPENDED')),
  timezone varchar(50) DEFAULT 'Asia/Seoul' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uk_tenant_tenant_code UNIQUE (tenant_code)
);
COMMENT ON COLUMN tenant.tenant_id IS '기관/테넌트 ID';
COMMENT ON COLUMN tenant.tenant_code IS '기관 코드';
COMMENT ON COLUMN tenant.tenant_name IS '기관명';
COMMENT ON COLUMN tenant.status IS 'ACTIVE/SUSPENDED';
COMMENT ON COLUMN tenant.timezone IS 'Asia/Seoul';
COMMENT ON COLUMN tenant.created_at IS '생성일시';
COMMENT ON COLUMN tenant.updated_at IS '수정일시';
DROP TRIGGER IF EXISTS trg_tenant_updated_at ON tenant;
CREATE TRIGGER trg_tenant_updated_at BEFORE UPDATE ON tenant FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();

CREATE TABLE IF NOT EXISTS organization (
  organization_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  parent_id uuid,
  org_code varchar(50) NOT NULL,
  org_name varchar(200) NOT NULL,
  org_path text NOT NULL,
  sort_order int DEFAULT 0 NOT NULL,
  status varchar(20) NOT NULL,
  version_no int DEFAULT 1 NOT NULL
);
COMMENT ON COLUMN organization.organization_id IS '조직 ID';
COMMENT ON COLUMN organization.tenant_id IS '기관';
COMMENT ON COLUMN organization.parent_id IS '상위조직';
COMMENT ON COLUMN organization.org_code IS '조직코드';
COMMENT ON COLUMN organization.org_name IS '조직명';
COMMENT ON COLUMN organization.org_path IS '계층경로';
COMMENT ON COLUMN organization.sort_order IS '정렬';
COMMENT ON COLUMN organization.status IS '상태';
COMMENT ON COLUMN organization.version_no IS '낙관잠금';

CREATE TABLE IF NOT EXISTS app_user (
  user_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  external_user_id varchar(100),
  login_id varchar(100) NOT NULL,
  display_name varchar(100) NOT NULL,
  organization_id uuid,
  email_enc bytea,
  phone_enc bytea,
  status varchar(20) NOT NULL,
  last_login_at timestamptz,
  CONSTRAINT uk_app_user_external_user_id UNIQUE (external_user_id)
);
COMMENT ON COLUMN app_user.user_id IS '사용자';
COMMENT ON COLUMN app_user.tenant_id IS '기관';
COMMENT ON COLUMN app_user.external_user_id IS 'T3Q 외부 사용자 ID';
COMMENT ON COLUMN app_user.login_id IS '로그인 ID';
COMMENT ON COLUMN app_user.display_name IS '성명';
COMMENT ON COLUMN app_user.organization_id IS '소속';
COMMENT ON COLUMN app_user.email_enc IS '암호화 이메일';
COMMENT ON COLUMN app_user.phone_enc IS '암호화 전화번호';
COMMENT ON COLUMN app_user.status IS '상태';
COMMENT ON COLUMN app_user.last_login_at IS '최근 로그인';

CREATE TABLE IF NOT EXISTS role (
  role_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid,
  role_code varchar(60) NOT NULL,
  role_name varchar(120) NOT NULL,
  scope_type varchar(30) NOT NULL,
  is_system boolean DEFAULT false NOT NULL,
  version_no int DEFAULT 1 NOT NULL
);
COMMENT ON COLUMN role.role_id IS '역할';
COMMENT ON COLUMN role.tenant_id IS 'NULL이면 시스템 역할';
COMMENT ON COLUMN role.role_code IS '역할코드';
COMMENT ON COLUMN role.role_name IS '역할명';
COMMENT ON COLUMN role.scope_type IS 'SYSTEM/TENANT/OBJECT';
COMMENT ON COLUMN role.is_system IS '시스템 역할';
COMMENT ON COLUMN role.version_no IS '버전';

CREATE TABLE IF NOT EXISTS permission (
  permission_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  permission_code varchar(80) NOT NULL,
  resource_type varchar(40) NOT NULL,
  action varchar(40) NOT NULL,
  description varchar(300),
  CONSTRAINT uk_permission_permission_code UNIQUE (permission_code)
);
COMMENT ON COLUMN permission.permission_id IS '권한';
COMMENT ON COLUMN permission.permission_code IS '권한코드';
COMMENT ON COLUMN permission.resource_type IS '자원';
COMMENT ON COLUMN permission.action IS '행위';
COMMENT ON COLUMN permission.description IS '설명';

CREATE TABLE IF NOT EXISTS user_role (
  user_role_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  scope_id uuid,
  valid_from timestamptz,
  valid_to timestamptz,
  granted_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN user_role.user_role_id IS 'Binding';
COMMENT ON COLUMN user_role.user_id IS '사용자';
COMMENT ON COLUMN user_role.role_id IS '역할';
COMMENT ON COLUMN user_role.scope_id IS '기관/객체 범위';
COMMENT ON COLUMN user_role.valid_from IS '유효시작';
COMMENT ON COLUMN user_role.valid_to IS '유효종료';
COMMENT ON COLUMN user_role.granted_by IS '부여자';
COMMENT ON COLUMN user_role.created_at IS '부여일시';

CREATE TABLE IF NOT EXISTS user_session (
  session_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  refresh_hash char(64) NOT NULL,
  issued_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  client_ip inet,
  user_agent text
);
COMMENT ON COLUMN user_session.session_id IS '세션';
COMMENT ON COLUMN user_session.user_id IS '사용자';
COMMENT ON COLUMN user_session.refresh_hash IS 'Refresh Token hash';
COMMENT ON COLUMN user_session.issued_at IS '발급';
COMMENT ON COLUMN user_session.expires_at IS '만료';
COMMENT ON COLUMN user_session.revoked_at IS '폐기';
COMMENT ON COLUMN user_session.client_ip IS 'IP';
COMMENT ON COLUMN user_session.user_agent IS 'UA';

