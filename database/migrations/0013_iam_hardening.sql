-- 0013: IAM hardening from CC-100 dual review (ADR-22 addendum)
--
-- 1) permission is a global catalog with no RLS; 0011's blanket GRANT left it
--    runtime-writable. The acceptance criterion "global rows are read-only
--    for runtime" applies to it the same as role/role_permission: the catalog
--    is provisioning-managed, the runtime only reads it.
-- 2) role_permission SELECT relied implicitly on 0011 default privileges;
--    state both catalogs' runtime privileges explicitly.
-- 3) user_session.refresh_hash is the refresh-token lookup path; make it
--    unique (hash collisions are impossible in practice, duplicates would
--    make session resolution non-deterministic) and indexed.

GRANT SELECT ON permission TO une_app;
REVOKE INSERT, UPDATE, DELETE ON permission FROM une_app;

GRANT SELECT ON role_permission TO une_app;
REVOKE INSERT, UPDATE, DELETE ON role_permission FROM une_app;

CREATE UNIQUE INDEX IF NOT EXISTS uk_user_session_refresh_hash
  ON user_session (refresh_hash);
