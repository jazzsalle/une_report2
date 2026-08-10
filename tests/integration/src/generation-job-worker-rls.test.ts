import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  ADMIN_URL,
  createTestDb,
  dropTestDb,
  insertFixture,
  migrate,
  withClient,
  type Fixture,
} from './db-helpers';

/** CC-120 / migration 0015: generation_job worker plane — une_worker least
 * privilege, cross-tenant dispatch policies, append-only job_event, and the
 * job/TOC constraints the baseline left open. */

/** Exactly the grants 0015 (+ later migrations that add a table the worker must
 * touch) give une_worker; anything else is a wide grant. 0017 adds
 * generated_block SELECT/INSERT/UPDATE for the CONTENT job — deliberately no
 * DELETE, because generation history is audit data (CC-130). */
const EXPECTED_WORKER_GRANTS = [
  'audit_log:INSERT',
  'audit_log:SELECT',
  // 0020 (CC-160): Export 러너. 원본 문서/리비전은 읽기만, 산출물과 검증
  // 보고서는 INSERT만 — 둘 다 UPDATE/DELETE 없이 append-only다.
  'document:SELECT',
  'document_revision:SELECT',
  // 0033 (CC-240): SOP 생성의 입력. 읽기뿐이다.
  'evidence_item:SELECT',
  'evidence_set:SELECT',
  'export_job:SELECT',
  'export_job:UPDATE',
  'file_object:INSERT',
  'file_object:SELECT',
  'generated_block:INSERT',
  'generated_block:SELECT',
  'generated_block:UPDATE',
  'generation_job:SELECT',
  'generation_job:UPDATE',
  'job_event:INSERT',
  'job_event:SELECT',
  // 0028 (CC-220, ADR-36 D4): 지식문서 UNI 전송. 설계 10 §7.23 7단계가 UNI
  // 호출자를 워커로 정했다.
  //   * provider_job은 SELECT/UPDATE이되 **제한(RESTRICTIVE) 정책**이
  //     provider_code='UNI' 밖을 어떤 경로로도 보이지 않게 한다 — 테넌트를
  //     세운 트랜잭션에서도 그렇다(실측으로 노출을 재현한 뒤 넣었다).
  //   * provider_result는 **INSERT만**이다. 원문을 남기는 데 읽기는 필요 없고,
  //     SELECT까지 주면 정책 결함 하나가 전 테넌트 원문을 노출한다. 권한 부재는
  //     정책 결함으로 뚫리지 않는다 — 이 목록에 provider_result:SELECT가
  //     **없다는 것**이 그 보장이다.
  'knowledge_document:SELECT',
  'plan:SELECT',
  'plan:UPDATE',
  'plan_context_snapshot:SELECT',
  'provider_job:SELECT',
  'provider_result:INSERT',
  // 0033 (CC-240, ADR-38 D14): SOP 생성 러너가 확정 사실과 동결 근거를 읽는다.
  // **읽기뿐이다** — 상황 쓰기는 `status` 한 열의 컬럼 권한이라 이 목록(테이블
  // 단위 GRANT)에 나타나지 않고, 그 한 전이는 RESTRICTIVE 정책이 고정한다.
  // `situation_fact`·`provider_result`·`fact_conflict` 등 나머지 상황 계열은
  // 여전히 42501이다(situation-table-rls.test.ts가 목록째 고정한다).
  'situation:SELECT',
  'situation_snapshot:SELECT',
  // 0032 (CC-240): SOP 그래프. DELETE는 어디에도 없다 — 삭제 경로가 없는데
  // 권한이 있으면 그것이 곧 구멍이다(0031에서 배운 것).
  'sop:INSERT',
  'sop:SELECT',
  'sop_edge:INSERT',
  'sop_edge:SELECT',
  'sop_node:INSERT',
  'sop_node:SELECT',
  'sop_version:INSERT',
  'sop_version:SELECT',
  // UPDATE는 없다 — 0032가 줬으나 쓰는 코드가 없어 0034가 회수했다. 그
  // 권한으로는 기존 버전의 graph_hash·출처를 감사 없이 갈아치울 수 있었다.
  'template_profile:SELECT',
  'tenant:SELECT',
  'toc_node:INSERT',
  'toc_node:SELECT',
  'toc_version:INSERT',
  'toc_version:SELECT',
  'validation_report:INSERT',
  'validation_report:SELECT',
];

interface PlanFixture extends Fixture {
  planId: string;
  snapshotId: string;
}

/** Runs fn as une_worker; tenantId null = dispatch mode (no tenant context). */
async function asWorker<T>(
  url: string,
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query('SET ROLE une_worker');
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return fn(c);
  });
}

async function asAppRole<T>(
  url: string,
  tenantId: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query('SET ROLE une_app');
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return fn(c);
  });
}

/** tenant/user/situation + plan + confirmed context snapshot (TOC job input). */
async function insertPlanFixture(c: Client, tenantCode: string): Promise<PlanFixture> {
  const base = await insertFixture(c, tenantCode);
  const plan = await c.query(
    `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
     VALUES ($1, 'CC-120 fixture plan', '호우', '대비', 'DRAFT', $2) RETURNING plan_id`,
    [base.tenantId, base.userId],
  );
  const planId = plan.rows[0].plan_id as string;
  const snapshot = await c.query(
    `INSERT INTO plan_context_snapshot (plan_id, version_no, context_json, content_hash, confirmed_by)
     VALUES ($1, 1, '{}', $2, $3) RETURNING context_snapshot_id`,
    [planId, 'a'.repeat(64), base.userId],
  );
  return { ...base, planId, snapshotId: snapshot.rows[0].context_snapshot_id as string };
}

/** Admin-side job insert; the worker role holds no INSERT on generation_job. */
async function insertJob(c: Client, fx: PlanFixture, status = 'QUEUED'): Promise<string> {
  const job = await c.query(
    `INSERT INTO generation_job
       (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
        status, progress_pct, idempotency_key, correlation_id)
     VALUES ($1, 'TOC', 'PLAN', $2, 'T3Q', '{}', $3, 0, $4, $5) RETURNING job_id`,
    [fx.tenantId, fx.planId, status, `idem-${randomUUID()}`, `corr-${randomUUID()}`],
  );
  return job.rows[0].job_id as string;
}

describe.skipIf(!ADMIN_URL)('generation_job worker role and dispatch RLS (CC-120)', () => {
  let db: { name: string; url: string };
  let fxA: PlanFixture;
  let fxB: PlanFixture;

  beforeAll(async () => {
    db = await createTestDb('cc120_worker');
    await migrate(db.url);
    await withClient(db.url, async (c) => {
      fxA = await insertPlanFixture(c, 'cc120-a');
      fxB = await insertPlanFixture(c, 'cc120-b');
    });
  }, 180_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('provides une_worker as a non-superuser, non-bypassrls role', async () => {
    const role = await withClient(db.url, (c) =>
      c.query(
        `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
         FROM pg_roles WHERE rolname = 'une_worker'`,
      ),
    );
    expect(role.rows).toHaveLength(1);
    expect(role.rows[0]).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });

  it('grants une_worker table-by-table minimum privileges only', async () => {
    const privs = await withClient(db.url, (c) =>
      c.query(
        `SELECT table_name, privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'une_worker' AND table_schema = 'public'
         ORDER BY table_name, privilege_type`,
      ),
    );
    const actual = privs.rows.map((r) => `${r.table_name}:${r.privilege_type}`);
    expect(actual).toEqual(EXPECTED_WORKER_GRANTS);

    // No migration-history access, and the bigserial stream stays usable.
    const extra = await withClient(db.url, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM information_schema.role_table_grants
                 WHERE grantee = 'une_worker' AND table_name = 'pgmigrations') AS migration_grants,
                has_sequence_privilege('une_worker', 'job_event_job_event_id_seq', 'USAGE') AS seq_usage`,
      ),
    );
    expect(extra.rows[0]).toEqual({ migration_grants: 0, seq_usage: true });
  });

  it('워커의 컬럼 단위 권한 목록을 고정한다 (0030, 0033)', async () => {
    // 테이블 단위 목록만 고정하면 컬럼 권한이 조용히 늘어난다. 실제로 그 경로로
    // 워커가 `request_json`을 비울 수 있었던 적이 있다(0030 이전, 실측).
    const cols = await withClient(db.url, (c) =>
      c.query(
        `SELECT table_name, column_name, privilege_type
           FROM information_schema.role_column_grants
          WHERE grantee = 'une_worker' AND table_schema = 'public'
            AND (table_name, privilege_type) NOT IN (
              SELECT table_name, privilege_type FROM information_schema.role_table_grants
               WHERE grantee = 'une_worker' AND table_schema = 'public')
          ORDER BY table_name, column_name, privilege_type`,
      ),
    );
    expect(cols.rows.map((r) => `${r.table_name}.${r.column_name}:${r.privilege_type}`)).toEqual([
      // 0030: 지식문서의 관측 결과 칸만. 파일·소유자·보존범위는 없다.
      'knowledge_document.error_json:UPDATE',
      'knowledge_document.provider_document_id:UPDATE',
      'knowledge_document.reference_json:UPDATE',
      'knowledge_document.status:UPDATE',
      'knowledge_document.uni_observed_at:UPDATE',
      'knowledge_document.uni_status:UPDATE',
      // 0030: UNI 잡의 결과 칸만. request_json·redacted_at은 **없다** —
      // 그 둘은 0026이 전용 롤 뒤로 격리한 컬럼이다.
      'provider_job.error_json:UPDATE',
      'provider_job.finished_at:UPDATE',
      'provider_job.result_count:UPDATE',
      'provider_job.status:UPDATE',
      // 0033: 상황 상태 한 칸. current_snapshot_id·title은 여기 없다 —
      // 그것이 열리면 감사 기록 없이 확정 사실이 바뀐다.
      'situation.status:UPDATE',
      // 0033: SOP가 가리키는 현재 버전.
      'sop.current_version_id:UPDATE',
    ]);
  });

  it('lets a tenant-less worker see queued jobs across tenants', async () => {
    const [jobA, jobB] = await withClient(db.url, async (c) => [
      await insertJob(c, fxA),
      await insertJob(c, fxB),
    ]);
    const seen = await asWorker(db.url, null, (c) =>
      c.query(`SELECT job_id, tenant_id FROM generation_job WHERE job_id = ANY($1)`, [
        [jobA, jobB],
      ]),
    );
    expect(seen.rows.map((r) => r.tenant_id).sort()).toEqual([fxA.tenantId, fxB.tenantId].sort());

    // Terminal jobs are outside the dispatch policy even without tenant context.
    await withClient(db.url, (c) =>
      c.query(`UPDATE generation_job SET status = 'COMPLETED' WHERE job_id = $1`, [jobB]),
    );
    const afterSettle = await asWorker(db.url, null, (c) =>
      c.query(`SELECT job_id FROM generation_job WHERE job_id = ANY($1)`, [[jobA, jobB]]),
    );
    expect(afterSettle.rows.map((r) => r.job_id)).toEqual([jobA]);
  });

  it('restricts the worker to one tenant once app.tenant_id is set', async () => {
    const [jobA, jobB] = await withClient(db.url, async (c) => [
      await insertJob(c, fxA),
      await insertJob(c, fxB),
    ]);
    const seen = await asWorker(db.url, fxA.tenantId, (c) =>
      c.query(`SELECT job_id FROM generation_job WHERE job_id = ANY($1)`, [[jobA, jobB]]),
    );
    expect(seen.rows.map((r) => r.job_id)).toEqual([jobA]);
  });

  it('allows a tenant-less claim to RUNNING but refuses terminal writes', async () => {
    const jobId = await withClient(db.url, (c) => insertJob(c, fxA));
    await asWorker(db.url, null, async (c) => {
      await expect(
        c.query(
          `UPDATE generation_job SET status = 'COMPLETED', finished_at = now() WHERE job_id = $1`,
          [jobId],
        ),
      ).rejects.toThrow(/row-level security policy/);
      const claimed = await c.query(
        `UPDATE generation_job
           SET status = 'RUNNING', started_at = now(), attempt_no = attempt_no + 1
         WHERE job_id = $1 AND status = 'QUEUED' RETURNING attempt_no, updated_at`,
        [jobId],
      );
      expect(claimed.rows).toHaveLength(1);
      expect(claimed.rows[0].attempt_no).toBe(1);
      expect(claimed.rows[0].updated_at).toBeInstanceOf(Date);
    });

    // Settlement happens in the tenant-scoped transaction that writes the result.
    await asWorker(db.url, fxA.tenantId, async (c) => {
      const settled = await c.query(
        `UPDATE generation_job SET status = 'COMPLETED', progress_pct = 100, finished_at = now()
         WHERE job_id = $1 RETURNING status`,
        [jobId],
      );
      expect(settled.rows[0].status).toBe('COMPLETED');
    });
  });

  it('keeps job_event append-only for the API runtime role', async () => {
    const jobId = await withClient(db.url, async (c) => {
      const id = await insertJob(c, fxA);
      await c.query(
        `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
         VALUES ($1, 1, 'JOB_QUEUED', '{}')`,
        [id],
      );
      return id;
    });
    await asAppRole(db.url, fxA.tenantId, async (c) => {
      await expect(
        c.query(`UPDATE job_event SET event_type = 'TAMPERED' WHERE job_id = $1`, [jobId]),
      ).rejects.toThrow(/permission denied/);
      await expect(c.query(`DELETE FROM job_event WHERE job_id = $1`, [jobId])).rejects.toThrow(
        /permission denied/,
      );
      // Appending a new event is the only correction path.
      await c.query(
        `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
         VALUES ($1, 2, 'JOB_PROGRESS', '{}')`,
        [jobId],
      );
    });
  });

  it('rejects duplicate SSE sequence numbers and duplicate TOC version numbers', async () => {
    await withClient(db.url, async (c) => {
      const jobId = await insertJob(c, fxA);
      const event = (): Promise<unknown> =>
        c.query(
          `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
           VALUES ($1, 7, 'JOB_PROGRESS', '{}')`,
          [jobId],
        );
      await event();
      await expect(event()).rejects.toThrow(/uk_job_event_seq/);

      const tocVersion = (): Promise<unknown> =>
        c.query(
          `INSERT INTO toc_version
             (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
           VALUES ($1, 3, 'AI', $2, 'DRAFT', $3, $4)`,
          [fxA.planId, fxA.snapshotId, 'b'.repeat(64), fxA.userId],
        );
      await tocVersion();
      await expect(tocVersion()).rejects.toThrow(/uk_toc_version_plan_version/);
    });
  });

  it('closes the job and TOC state sets with CHECK constraints', async () => {
    await withClient(db.url, async (c) => {
      await expect(insertJob(c, fxA, 'PAUSED')).rejects.toThrow(/ck_generation_job_status/);
      const jobId = await insertJob(c, fxA);
      await expect(
        c.query(`UPDATE generation_job SET progress_pct = 101 WHERE job_id = $1`, [jobId]),
      ).rejects.toThrow(/ck_generation_job_progress/);
      await expect(
        c.query(
          `INSERT INTO toc_version
             (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
           VALUES ($1, 90, 'GUESS', $2, 'DRAFT', $3, $4)`,
          [fxA.planId, fxA.snapshotId, 'c'.repeat(64), fxA.userId],
        ),
      ).rejects.toThrow(/ck_toc_version_source/);
      const version = await c.query(
        `INSERT INTO toc_version
           (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
         VALUES ($1, 91, 'AI', $2, 'DRAFT', $3, $4) RETURNING toc_version_id`,
        [fxA.planId, fxA.snapshotId, 'd'.repeat(64), fxA.userId],
      );
      await expect(
        c.query(
          `INSERT INTO toc_node (toc_version_id, node_key, title, level, generation_policy)
           VALUES ($1, 'n-7', '7단계', 7, '{}')`,
          [version.rows[0].toc_version_id],
        ),
      ).rejects.toThrow(/ck_toc_node_level/);
    });
  });

  it('enforces the FKs 0007 omitted (plan.current_toc_version_id)', async () => {
    await withClient(db.url, async (c) => {
      await c.query('BEGIN');
      await c.query(`UPDATE plan SET current_toc_version_id = $1 WHERE plan_id = $2`, [
        randomUUID(),
        fxA.planId,
      ]);
      // DEFERRABLE INITIALLY DEFERRED: the violation surfaces at COMMIT.
      await expect(c.query('COMMIT')).rejects.toThrow(/fk_plan_current_toc_version/);
    });
  });

  it('blocks the dispatch scope from RLS-covered tables (plan reads, audit writes)', async () => {
    // Review M1: in the dispatch scope only generation_job is intentionally
    // visible; plan/audit_log have tenant policies that evaluate false.
    await asWorker(db.url, null, async (c) => {
      const plans = await c.query(`SELECT count(*)::int AS n FROM plan`);
      expect(plans.rows[0].n).toBe(0);
      await expect(
        c.query(
          `INSERT INTO audit_log (tenant_id, action, resource_type, correlation_id)
           VALUES ($1, 'X', 'X', 'corr_x')`,
          [fxA.tenantId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('blocks the dispatch scope from child tables too (0016 closed the 0015 gap)', async () => {
    // Inverted by CC-125 / migration 0016. Until then these child tables had
    // no RLS and the dispatch scope could read them (0015 §7 known limitation,
    // ADR-25 D2). 0016 gives each an EXISTS(parent) tenant policy, so the
    // tenant-less dispatch scope now sees nothing — the same rule that already
    // applied to plan/audit_log above. Full coverage lives in
    // tests/integration/src/child-table-rls.test.ts.
    await withClient(db.url, async (c) => {
      // Guarantee non-zero rows exist, so "0 rows" proves RLS, not emptiness.
      const jobId = await insertJob(c, fxA);
      await c.query(
        `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
         VALUES ($1, 1, 'job.started', '{}')`,
        [jobId],
      );
      await c.query(
        `INSERT INTO toc_version
           (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
         VALUES ($1, 500, 'AI', $2, 'DRAFT', $3, $4)`,
        [fxA.planId, fxA.snapshotId, '5'.repeat(64), fxA.userId],
      );
      const seeded = await c.query(
        `SELECT (SELECT count(*)::int FROM job_event) AS events,
                (SELECT count(*)::int FROM toc_version) AS versions`,
      );
      expect(seeded.rows[0].events).toBeGreaterThan(0);
      expect(seeded.rows[0].versions).toBeGreaterThan(0);
    });

    await asWorker(db.url, null, async (c) => {
      const events = await c.query(`SELECT count(*)::int AS n FROM job_event`);
      expect(events.rows[0].n).toBe(0);
      const versions = await c.query(`SELECT count(*)::int AS n FROM toc_version`);
      expect(versions.rows[0].n).toBe(0);
    });
  });
});
