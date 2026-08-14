-- DEV/DEMO ONLY — local mock-auth fixtures. Never run against shared or
-- production databases. Run as the admin principal (une), not une_app:
--   pnpm db:seed:dev   (uses DATABASE_URL)
-- Idempotent: fixed UUIDs, ON CONFLICT / WHERE NOT EXISTS guards.
--
-- The role→permission matrix below is a dev convenience, not the design
-- baseline (ADR-22 D2): the confirmed matrix lands with each domain Work
-- Item. No secrets here — mock auth asserts identity, it has no passwords.

INSERT INTO tenant (tenant_id, tenant_code, tenant_name, status)
VALUES ('11111111-1111-4111-8111-111111111111','DEMO-A','데모 기관 A','ACTIVE'),
       ('22222222-2222-4222-8222-222222222222','DEMO-B','데모 기관 B','ACTIVE')
ON CONFLICT (tenant_code) DO NOTHING;

INSERT INTO organization (organization_id, tenant_id, parent_id, org_code, org_name, org_path, sort_order, status)
VALUES
  ('11111111-aaaa-4111-8111-000000000001','11111111-1111-4111-8111-111111111111',NULL,'HQ','재난안전본부','/HQ',1,'ACTIVE'),
  ('11111111-aaaa-4111-8111-000000000002','11111111-1111-4111-8111-111111111111','11111111-aaaa-4111-8111-000000000001','SIT','상황총괄과','/HQ/SIT',1,'ACTIVE'),
  ('22222222-aaaa-4222-8222-000000000001','22222222-2222-4222-8222-222222222222',NULL,'HQ','안전정책본부','/HQ',1,'ACTIVE')
ON CONFLICT (organization_id) DO NOTHING;

INSERT INTO app_user (user_id, tenant_id, login_id, display_name, organization_id, status)
VALUES
  ('11111111-bbbb-4111-8111-000000000001','11111111-1111-4111-8111-111111111111','demo-admin','데모 관리자','11111111-aaaa-4111-8111-000000000001','ACTIVE'),
  ('11111111-bbbb-4111-8111-000000000002','11111111-1111-4111-8111-111111111111','demo-author','데모 작성자','11111111-aaaa-4111-8111-000000000002','ACTIVE'),
  ('11111111-bbbb-4111-8111-000000000003','11111111-1111-4111-8111-111111111111','demo-system','데모 시스템관리자','11111111-aaaa-4111-8111-000000000001','ACTIVE'),
  ('22222222-bbbb-4222-8222-000000000001','22222222-2222-4222-8222-222222222222','demo-b-user','데모 B 사용자','22222222-aaaa-4222-8222-000000000001','ACTIVE')
ON CONFLICT (user_id) DO NOTHING;

-- Dev matrix: INSTITUTION_ADMIN = org/user/rbac/audit reads + admin access;
-- PLAN_AUTHOR = plan/doc authoring reads+writes; TASK_ASSIGNEE = field tasks.
INSERT INTO role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role r JOIN permission p ON (
     (r.role_code = 'SYSTEM_ADMIN')
  OR (r.role_code = 'INSTITUTION_ADMIN' AND p.permission_code IN
      ('ORG_READ','USER_READ','RBAC_READ','AUDIT_READ','ADMIN_ACCESS','ADMIN_ORG'))
  OR (r.role_code = 'PLAN_AUTHOR' AND p.permission_code IN
      ('PLAN_READ','PLAN_CREATE','PLAN_EDIT','PLAN_GENERATE','DOC_READ','DOC_EDIT','DOC_EXPORT','FILE_UPLOAD'))
  OR (r.role_code = 'TASK_ASSIGNEE' AND p.permission_code IN
      ('TASK_READ','TASK_ASSIGNEE')))
WHERE r.tenant_id IS NULL
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO user_role (user_id, role_id, granted_by)
SELECT u.user_id, r.role_id, u.user_id
FROM app_user u JOIN role r ON r.tenant_id IS NULL AND (
     (u.login_id = 'demo-admin'  AND r.role_code IN ('INSTITUTION_ADMIN'))
  OR (u.login_id = 'demo-author' AND r.role_code IN ('PLAN_AUTHOR'))
  -- 상황·SOP·임무·일지 화면을 로컬에서 열기 위한 계정 (CC-410 세션에 추가).
  --
  -- **왜 새 역할에 권한을 채우지 않고 SYSTEM_ADMIN을 주는가.** 위 주석대로
  -- role→permission 매트릭스는 각 도메인 Work Item이 확정한다(ADR-22 D2).
  -- 그런데 CC-200~CC-320이 상황 계열을 구현하면서 이 개발 시드를 갱신하지
  -- 않아, 카탈로그의 15개 역할 중 11개(SITUATION_REGISTRAR·COMMANDER·
  -- SOP_EDITOR·JOURNAL_AUTHOR·EVALUATOR 등)가 **권한 0건**으로 남았다.
  -- 여기서 그 매트릭스를 지어내면 설계에 없는 권한 배분이 개발 시드에서
  -- 태어나 사실처럼 굳는다. SYSTEM_ADMIN은 이미 카탈로그가 전 권한을 준
  -- 역할이므로 **아무것도 새로 짓지 않는다.**
  --
  -- 대가: 이 계정으로는 권한 경계를 시험할 수 없다. 경계 시험은 권한이
  -- 갈린 demo-admin/demo-author와 e2e 하네스가 맡는다(개발 시드는 배포
  -- 경로에 없다).
  OR (u.login_id = 'demo-system' AND r.role_code IN ('SYSTEM_ADMIN'))
  OR (u.login_id = 'demo-b-user' AND r.role_code IN ('PLAN_AUTHOR')))
WHERE NOT EXISTS (
  SELECT 1 FROM user_role ur WHERE ur.user_id = u.user_id AND ur.role_id = r.role_id);
