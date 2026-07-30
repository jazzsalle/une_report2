-- CC-004: make RLS enforcement and the runtime role reproducible everywhere.
-- 1) une_app exists as a NOLOGIN/NOSUPERUSER/NOBYPASSRLS role if the cluster
--    did not provision it (local initdb creates it WITH LOGIN; managed hosts
--    provision LOGIN/password out of band).
-- 2) Grants: runtime CRUD on public schema, minus UPDATE/DELETE on
--    append-only event/audit tables (corrections are new events).
-- 3) FORCE ROW LEVEL SECURITY so the table owner cannot bypass tenant
--    policies (superusers still bypass; runtime must connect as une_app).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'une_app') THEN
    CREATE ROLE une_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- Externally provisioned une_app (managed hosts) must not keep RLS-bypassing
-- attributes; idempotent enforcement regardless of who created the role.
ALTER ROLE une_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO une_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO une_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO une_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO une_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO une_app;

-- The migration-history table belongs to the migration principal only.
REVOKE ALL ON pgmigrations FROM une_app;

-- Append-only event streams and immutable snapshots accept inserts only;
-- corrections are new events/versions, never rewrites. sop_version and
-- evidence_set keep pre-approval state transitions, so their immutability
-- is enforced at the application layer until CC-250/CC-230 (ADR-21).
REVOKE UPDATE, DELETE ON execution_event FROM une_app;
REVOKE UPDATE, DELETE ON audit_log FROM une_app;
REVOKE UPDATE, DELETE ON task_event FROM une_app;
REVOKE UPDATE, DELETE ON plan_context_snapshot FROM une_app;
REVOKE UPDATE, DELETE ON situation_snapshot FROM une_app;

ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
ALTER TABLE organization FORCE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
ALTER TABLE role FORCE ROW LEVEL SECURITY;
ALTER TABLE plan FORCE ROW LEVEL SECURITY;
ALTER TABLE generation_job FORCE ROW LEVEL SECURITY;
ALTER TABLE document FORCE ROW LEVEL SECURITY;
ALTER TABLE file_object FORCE ROW LEVEL SECURITY;
ALTER TABLE situation FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_document FORCE ROW LEVEL SECURITY;
ALTER TABLE sop FORCE ROW LEVEL SECURITY;
ALTER TABLE execution_event FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox_message FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_config FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE retention_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE notification FORCE ROW LEVEL SECURITY;
