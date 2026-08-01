-- 0015_generation_job_worker_and_toc.sql (CC-120, ADR-25)
-- Generation-job execution plane. No new tables (59-table baseline unchanged).
-- Closes the gaps that block a worker from claiming, streaming and finishing a
-- TOC job (UNE-PLAN-009 ~ UNE-PLAN-013, design 10 §6.15/§6.16, SEQ-SCR-PLAN-006):
--   1) lifecycle timestamps the design's own index definition already assumes,
--   2) CHECK constraints for the job and TOC state sets,
--   3) FKs / unique keys that 0007 omitted,
--   4) a least-privilege `une_worker` role plus cross-tenant dispatch policies.

-- ---------------------------------------------------------------------------
-- 1. generation_job lifecycle columns
-- ---------------------------------------------------------------------------
-- Design §6.15 defines IX-job_generation-TENANT as "(tenant_id, status/created_at
-- 등 업무조회 컬럼)" while the §6.15 column list carries neither created_at nor
-- updated_at. That is the same baseline defect class ADR-21 already resolved for
-- `plan` (index/global timestamp rule vs. missing columns); ADR-25 resolves it
-- for generation_job, whose dispatch order and SLA/timeout detection both need a
-- queue timestamp. Empty-DB baseline: no backfill is required.
ALTER TABLE generation_job ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now() NOT NULL;
ALTER TABLE generation_job ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now() NOT NULL;
-- UNE-PLAN-013 (실패 단위 재시도) reuses one job row across attempts; the retry
-- count must be durable so provider calls stay bounded and idempotency keys can
-- be derived per attempt (ADR-25).
ALTER TABLE generation_job ADD COLUMN IF NOT EXISTS attempt_no int DEFAULT 0 NOT NULL;
COMMENT ON COLUMN generation_job.created_at IS '생성';
COMMENT ON COLUMN generation_job.updated_at IS '수정';
COMMENT ON COLUMN generation_job.attempt_no IS '재시도 횟수';

DROP TRIGGER IF EXISTS trg_generation_job_updated_at ON generation_job;
CREATE TRIGGER trg_generation_job_updated_at BEFORE UPDATE ON generation_job
  FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. State sets as CHECK constraints
-- ---------------------------------------------------------------------------
-- §6.15 documents the sets only as prose ("QUEUED~FAILED", "TOC/CONTENT/AI_EDIT/SOP");
-- cancellation (UNE-PLAN-012) needs the intermediate CANCEL_REQUESTED state so a
-- running worker can observe the request and settle as CANCELLED (ADR-25).
ALTER TABLE generation_job DROP CONSTRAINT IF EXISTS ck_generation_job_status;
ALTER TABLE generation_job ADD CONSTRAINT ck_generation_job_status
  CHECK (status IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED'));
ALTER TABLE generation_job DROP CONSTRAINT IF EXISTS ck_generation_job_type;
ALTER TABLE generation_job ADD CONSTRAINT ck_generation_job_type
  CHECK (job_type IN ('TOC', 'CONTENT', 'AI_EDIT', 'SOP'));
ALTER TABLE generation_job DROP CONSTRAINT IF EXISTS ck_generation_job_aggregate_type;
ALTER TABLE generation_job ADD CONSTRAINT ck_generation_job_aggregate_type
  CHECK (aggregate_type IN ('PLAN', 'DOCUMENT', 'SITUATION'));
ALTER TABLE generation_job DROP CONSTRAINT IF EXISTS ck_generation_job_provider;
ALTER TABLE generation_job ADD CONSTRAINT ck_generation_job_provider
  CHECK (provider_code IN ('T3Q', 'UNI', 'UNE'));
ALTER TABLE generation_job DROP CONSTRAINT IF EXISTS ck_generation_job_progress;
ALTER TABLE generation_job ADD CONSTRAINT ck_generation_job_progress
  CHECK (progress_pct >= 0 AND progress_pct <= 100);

ALTER TABLE toc_version DROP CONSTRAINT IF EXISTS ck_toc_version_status;
ALTER TABLE toc_version ADD CONSTRAINT ck_toc_version_status
  CHECK (status IN ('DRAFT', 'CONFIRMED'));
ALTER TABLE toc_version DROP CONSTRAINT IF EXISTS ck_toc_version_source;
ALTER TABLE toc_version ADD CONSTRAINT ck_toc_version_source
  CHECK (source_type IN ('AI', 'USER'));

-- 목차 계층은 화면/HWPX 개요 수준과 동일하게 1~6단계로 닫는다 (SCR-PLAN-006).
ALTER TABLE toc_node DROP CONSTRAINT IF EXISTS ck_toc_node_level;
ALTER TABLE toc_node ADD CONSTRAINT ck_toc_node_level
  CHECK (level BETWEEN 1 AND 6);

-- ---------------------------------------------------------------------------
-- 3. Foreign keys missing from 0007
-- ---------------------------------------------------------------------------
-- 0007 wired toc_version.plan_id / toc_node.toc_version_id / job_event.job_id but
-- left these three referential paths unenforced. plan <-> toc_version is mutually
-- referencing, so both directions stay DEFERRABLE INITIALLY DEFERRED like the rest
-- of the baseline (a version row and the plan pointer are written in one tx).
ALTER TABLE toc_version DROP CONSTRAINT IF EXISTS fk_toc_version_base_snapshot;
ALTER TABLE toc_version ADD CONSTRAINT fk_toc_version_base_snapshot
  FOREIGN KEY (base_snapshot_id) REFERENCES plan_context_snapshot(context_snapshot_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE toc_node DROP CONSTRAINT IF EXISTS fk_toc_node_parent;
ALTER TABLE toc_node ADD CONSTRAINT fk_toc_node_parent
  FOREIGN KEY (parent_node_id) REFERENCES toc_node(toc_node_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE plan DROP CONSTRAINT IF EXISTS fk_plan_current_toc_version;
ALTER TABLE plan ADD CONSTRAINT fk_plan_current_toc_version
  FOREIGN KEY (current_toc_version_id) REFERENCES toc_version(toc_version_id)
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- 4. Unique keys and access-path indexes
-- ---------------------------------------------------------------------------
-- 계획서당 목차 버전 번호는 유일하다 (uk_plan_snapshot_version / uk_sop_version_no 동형).
CREATE UNIQUE INDEX IF NOT EXISTS uk_toc_version_plan_version
  ON toc_version(plan_id, version_no);
-- UNE-PLAN-011 SSE resumes from Last-Event-ID; a duplicated sequence_no would make
-- the resume point ambiguous and replay events to the client.
CREATE UNIQUE INDEX IF NOT EXISTS uk_job_event_seq
  ON job_event(job_id, sequence_no);

-- Worker dispatch scan: cross-tenant, non-terminal jobs in queue order. Partial
-- index keeps it proportional to the in-flight queue, not to job history.
CREATE INDEX IF NOT EXISTS ix_generation_job_dispatch
  ON generation_job(status, created_at)
  WHERE status IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED');
-- IX-job_generation-TENANT (§6.15) closed against the real access path: 기관 범위
-- Job 목록/상태 필터 + 최신순.
CREATE INDEX IF NOT EXISTS ix_generation_job_tenant_status_created
  ON generation_job(tenant_id, status, created_at DESC);
-- 목차 트리 렌더링: 버전 내 부모별 정렬 순서.
CREATE INDEX IF NOT EXISTS ix_toc_node_version_parent_sort
  ON toc_node(toc_version_id, parent_node_id, sort_order);
-- 계획서의 최신 목차 버전 조회는 uk_toc_version_plan_version의
-- Index Scan Backward가 커버한다(EXPLAIN 실증) — 별도 인덱스를 두지 않는다.

-- ---------------------------------------------------------------------------
-- 5. job_event is append-only
-- ---------------------------------------------------------------------------
-- SSE 이벤트 스트림은 정정도 새 이벤트로 표현한다 (0011의 append-only 원칙 확장).
-- une_worker never receives UPDATE/DELETE here either (see section 6).
REVOKE UPDATE, DELETE ON job_event FROM une_app;

-- ---------------------------------------------------------------------------
-- 6. une_worker: least-privilege role for services/worker
-- ---------------------------------------------------------------------------
-- The worker plane must be able to scan the queue across tenants (no tenant
-- context exists before a job is claimed), which une_app must never do. Splitting
-- the connection role — instead of relaxing une_app's policies — keeps the API
-- runtime strictly tenant-scoped (ADR-25).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'une_worker') THEN
    CREATE ROLE une_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
-- Externally provisioned une_worker (managed hosts) must not keep RLS-bypassing
-- attributes; idempotent enforcement regardless of who created the role.
ALTER ROLE une_worker NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO une_worker;

-- Table-by-table minimum. Deliberately NO "GRANT ... ON ALL TABLES" and NO
-- ALTER DEFAULT PRIVILEGES for une_worker: future tables must be granted
-- explicitly by the migration that needs them.
GRANT SELECT, UPDATE ON generation_job TO une_worker;  -- claim / progress / settle
GRANT SELECT, INSERT ON job_event      TO une_worker;  -- append-only SSE stream
GRANT SELECT, INSERT ON toc_version    TO une_worker;  -- RPT-001 결과 적재
GRANT SELECT, INSERT ON toc_node       TO une_worker;
GRANT SELECT, UPDATE ON plan           TO une_worker;  -- current_toc_version_id 갱신
GRANT SELECT         ON plan_context_snapshot TO une_worker;  -- 불변 입력 (읽기 전용)
GRANT SELECT         ON tenant         TO une_worker;  -- 테넌트 유효성 확인
GRANT SELECT, INSERT ON audit_log      TO une_worker;  -- append-only 감사기록
GRANT USAGE, SELECT ON SEQUENCE job_event_job_event_id_seq TO une_worker;

-- The migration-history table belongs to the migration principal only.
REVOKE ALL ON pgmigrations FROM une_worker;

-- ---------------------------------------------------------------------------
-- 7. Worker dispatch policies on generation_job
-- ---------------------------------------------------------------------------
-- Semantics. une_current_tenant_id() returns NULL when app.tenant_id is unset or
-- empty (0001), so "IS NULL" == "worker dispatch mode, no tenant context".
-- Both policies below are PERMISSIVE and therefore OR-ed with the existing
-- p_generation_job_tenant (TO PUBLIC, FOR ALL):
--   * tenant context set   -> IS NULL is false -> only p_generation_job_tenant
--                             applies; the worker is as tenant-scoped as the API.
--   * tenant context unset -> p_generation_job_tenant's tenant_id = NULL is never
--                             true -> only these worker policies apply.
-- The claim policy's WITH CHECK caps what a tenant-less transaction may write:
-- QUEUED (release) or RUNNING (claim/heartbeat). Terminal writes
-- (COMPLETED/FAILED/CANCELLED) therefore require a tenant-scoped transaction,
-- which is the same transaction that writes toc_version/toc_node/plan under the
-- ordinary tenant policies — result and settlement stay in one tenant boundary.
DROP POLICY IF EXISTS p_generation_job_worker_dispatch ON generation_job;
CREATE POLICY p_generation_job_worker_dispatch ON generation_job
  FOR SELECT TO une_worker
  USING (une_current_tenant_id() IS NULL AND status IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED'));

DROP POLICY IF EXISTS p_generation_job_worker_claim ON generation_job;
CREATE POLICY p_generation_job_worker_claim ON generation_job
  FOR UPDATE TO une_worker
  USING (une_current_tenant_id() IS NULL AND status IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED'))
  WITH CHECK (status IN ('QUEUED', 'RUNNING'));

-- Tenant coverage for the other tables the worker touches (corrected in the
-- CC-120 dual review, M1 — the original comment overclaimed):
--   * plan, audit_log: RLS-enabled with 0008 policies TO PUBLIC (verified:
--     pg_policies roles = {public}) — une_worker is covered; in the dispatch
--     scope (tenant unset) these policies evaluate false, so plan reads and
--     audit writes are DB-blocked there (asserted in
--     tests/integration/src/generation-job-worker-rls.test.ts).
--   * plan_context_snapshot, toc_version, toc_node, job_event: RLS was NEVER
--     enabled on these child tables (baseline 0008/0011). Their only tenant
--     protection is the application-layer parent join / caller-verified ids
--     (ADR-21 compensating control) — including in the dispatch scope.
--     job_event now carries raw provider payloads, so enabling RLS with
--     EXISTS(parent) policies is registered as a hardening task (0016
--     candidate) to land before CC-130 (ADR-25 D2).
