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

/** CC-125 / migration 0016: tenant RLS on the four tenant_id-less child tables
 * (job_event, toc_version, toc_node, plan_context_snapshot). Closes ADR-25 D2
 * "0016 후보". Until 0016 their only tenant protection was the application-side
 * parent join (ADR-21 compensating control); job_event now stores real provider
 * payloads, so the isolation must hold in the database itself. */

const CHILD_TABLES = ['job_event', 'toc_version', 'toc_node', 'plan_context_snapshot'] as const;

/** Bulk shape for the SSE access-path assertion: 60 jobs x 120 events. Large
 * enough that a sequential scan is genuinely more expensive than the index. */
const BULK_JOBS = 60;
const BULK_EVENTS_PER_JOB = 120;

interface TenantFixture extends Fixture {
  planId: string;
  snapshotId: string;
  jobId: string;
  tocVersionId: string;
  tocNodeId: string;
}

async function asRole<T>(
  url: string,
  role: 'une_app' | 'une_worker',
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  return withClient(url, async (c) => {
    await c.query(`SET ROLE ${role}`);
    if (tenantId) await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return fn(c);
  });
}

/** Full plan aggregate for one tenant: plan -> snapshot -> job -> job_event and
 * toc_version -> toc_node. Written through the admin principal (superuser
 * bypasses RLS), so the fixtures themselves never depend on the policies. */
async function insertTenantFixture(c: Client, tenantCode: string): Promise<TenantFixture> {
  const base = await insertFixture(c, tenantCode);
  const plan = await c.query(
    `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
     VALUES ($1, 'CC-125 fixture plan', '호우', '대비', 'DRAFT', $2) RETURNING plan_id`,
    [base.tenantId, base.userId],
  );
  const planId = plan.rows[0].plan_id as string;
  const snapshot = await c.query(
    `INSERT INTO plan_context_snapshot (plan_id, version_no, context_json, content_hash, confirmed_by)
     VALUES ($1, 1, '{"subject":"CC-125"}', $2, $3) RETURNING context_snapshot_id`,
    [planId, 'a'.repeat(64), base.userId],
  );
  const snapshotId = snapshot.rows[0].context_snapshot_id as string;
  const job = await c.query(
    `INSERT INTO generation_job
       (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
        status, progress_pct, idempotency_key, correlation_id)
     VALUES ($1, 'TOC', 'PLAN', $2, 'T3Q', '{}', 'RUNNING', 10, $3, $4) RETURNING job_id`,
    [base.tenantId, planId, `idem-${randomUUID()}`, `corr-${randomUUID()}`],
  );
  const jobId = job.rows[0].job_id as string;
  await c.query(
    `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
     VALUES ($1, 1, 'provider.responded', $2)`,
    [jobId, JSON.stringify({ rawResponse: `provider payload of ${tenantCode}` })],
  );
  const version = await c.query(
    `INSERT INTO toc_version
       (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
     VALUES ($1, 1, 'AI', $2, 'DRAFT', $3, $4) RETURNING toc_version_id`,
    [planId, snapshotId, 'b'.repeat(64), base.userId],
  );
  const tocVersionId = version.rows[0].toc_version_id as string;
  const node = await c.query(
    `INSERT INTO toc_node (toc_version_id, node_key, title, level, sort_order, generation_policy)
     VALUES ($1, 'n-1', $2, 1, 1, '{}') RETURNING toc_node_id`,
    [tocVersionId, `${tenantCode} 목차`],
  );
  return {
    ...base,
    planId,
    snapshotId,
    jobId,
    tocVersionId,
    tocNodeId: node.rows[0].toc_node_id as string,
  };
}

describe.skipIf(!ADMIN_URL)('child-table tenant RLS (CC-125, migration 0016)', () => {
  let db: { name: string; url: string };
  let fxA: TenantFixture;
  let fxB: TenantFixture;
  /** A bulk job of tenant A, used for the SSE access-path assertion. */
  let bulkJobId: string;

  beforeAll(async () => {
    db = await createTestDb('cc125_child_rls');
    await migrate(db.url);
    await withClient(db.url, async (c) => {
      fxA = await insertTenantFixture(c, 'cc125-a');
      fxB = await insertTenantFixture(c, 'cc125-b');

      // Volume for the EXPLAIN assertion. Without it the planner picks a
      // sequential scan on any plan shape and the test proves nothing.
      await c.query(
        `INSERT INTO generation_job
           (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
            status, progress_pct, idempotency_key, correlation_id)
         SELECT $1, 'TOC', 'PLAN', $2, 'T3Q', '{}', 'RUNNING', 10, 'bulk-' || g, 'corr-bulk-' || g
         FROM generate_series(1, $3::int) g`,
        [fxA.tenantId, fxA.planId, BULK_JOBS],
      );
      await c.query(
        `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
         SELECT j.job_id, s, 'job.progress', '{"pct":1}'
         FROM generation_job j, generate_series(1, $1::int) s
         WHERE j.idempotency_key LIKE 'bulk-%'`,
        [BULK_EVENTS_PER_JOB],
      );
      await c.query('ANALYZE job_event');
      await c.query('ANALYZE generation_job');
      const bulk = await c.query(`SELECT job_id FROM generation_job WHERE idempotency_key = $1`, [
        'bulk-1',
      ]);
      bulkJobId = bulk.rows[0].job_id as string;
    });
  }, 180_000);

  afterAll(async () => {
    if (db) await dropTestDb(db.name);
  });

  it('enables and forces RLS with one tenant policy per child table', async () => {
    const state = await withClient(db.url, (c) =>
      c.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                (SELECT array_agg(p.policyname::text ORDER BY p.policyname)
                 FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
         FROM pg_class c
         WHERE c.relname = ANY($1) AND c.relkind = 'r'
         ORDER BY c.relname`,
        [[...CHILD_TABLES]],
      ),
    );
    expect(state.rows).toHaveLength(CHILD_TABLES.length);
    for (const row of state.rows) {
      expect(row.relrowsecurity, `${row.relname} RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} RLS forced`).toBe(true);
      expect(row.policies, `${row.relname} policy`).toEqual([`p_${row.relname}_tenant`]);
    }
  });

  it('shows a tenant only its own child rows and hides the other tenant (une_app)', async () => {
    const visible = await asRole(db.url, 'une_app', fxA.tenantId, async (c) => ({
      events: await c.query(`SELECT job_id FROM job_event WHERE job_id = ANY($1)`, [
        [fxA.jobId, fxB.jobId],
      ]),
      versions: await c.query(
        `SELECT toc_version_id FROM toc_version WHERE toc_version_id = ANY($1)`,
        [[fxA.tocVersionId, fxB.tocVersionId]],
      ),
      nodes: await c.query(`SELECT toc_node_id FROM toc_node WHERE toc_node_id = ANY($1)`, [
        [fxA.tocNodeId, fxB.tocNodeId],
      ]),
      snapshots: await c.query(
        `SELECT context_snapshot_id FROM plan_context_snapshot WHERE context_snapshot_id = ANY($1)`,
        [[fxA.snapshotId, fxB.snapshotId]],
      ),
    }));
    expect(visible.events.rows.map((r) => r.job_id)).toEqual([fxA.jobId]);
    expect(visible.versions.rows.map((r) => r.toc_version_id)).toEqual([fxA.tocVersionId]);
    expect(visible.nodes.rows.map((r) => r.toc_node_id)).toEqual([fxA.tocNodeId]);
    expect(visible.snapshots.rows.map((r) => r.context_snapshot_id)).toEqual([fxA.snapshotId]);
  });

  it('hides the raw provider payload of another tenant even on a direct id lookup', async () => {
    // The regression this migration exists for: job_event.payload_json now
    // carries real provider request/response traces (ADR-25 D10).
    const leaked = await asRole(db.url, 'une_app', fxA.tenantId, (c) =>
      c.query(`SELECT payload_json FROM job_event WHERE job_id = $1`, [fxB.jobId]),
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it('returns no child rows at all when app.tenant_id is unset (une_app)', async () => {
    const counts = await asRole(db.url, 'une_app', null, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM job_event) AS events,
                (SELECT count(*)::int FROM toc_version) AS versions,
                (SELECT count(*)::int FROM toc_node) AS nodes,
                (SELECT count(*)::int FROM plan_context_snapshot) AS snapshots`,
      ),
    );
    expect(counts.rows[0]).toEqual({ events: 0, versions: 0, nodes: 0, snapshots: 0 });
  });

  it('rejects cross-tenant child writes through WITH CHECK (une_app)', async () => {
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      await expect(
        c.query(
          `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
           VALUES ($1, 99, 'job.progress', '{}')`,
          [fxB.jobId],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO toc_version
             (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
           VALUES ($1, 99, 'AI', $2, 'DRAFT', $3, $4)`,
          [fxB.planId, fxB.snapshotId, 'c'.repeat(64), fxA.userId],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO toc_node (toc_version_id, node_key, title, level, sort_order, generation_policy)
           VALUES ($1, 'evil', '타 테넌트 노드', 1, 9, '{}')`,
          [fxB.tocVersionId],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO plan_context_snapshot
             (plan_id, version_no, context_json, content_hash, confirmed_by)
           VALUES ($1, 99, '{}', $2, $3)`,
          [fxB.planId, 'd'.repeat(64), fxA.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('lets a tenant write its own child rows (une_app happy path unchanged)', async () => {
    await asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
      const appended = await c.query(
        `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
         VALUES ($1, 2, 'job.progress', '{"pct":50}') RETURNING sequence_no`,
        [fxA.jobId],
      );
      expect(Number(appended.rows[0].sequence_no)).toBe(2);
      const version = await c.query(
        `INSERT INTO toc_version
           (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
         VALUES ($1, 2, 'USER', $2, 'DRAFT', $3, $4) RETURNING toc_version_id`,
        [fxA.planId, fxA.snapshotId, 'e'.repeat(64), fxA.userId],
      );
      const node = await c.query(
        `INSERT INTO toc_node (toc_version_id, node_key, title, level, sort_order, generation_policy)
         VALUES ($1, 'n-1', '사용자 목차', 1, 1, '{}') RETURNING toc_node_id`,
        [version.rows[0].toc_version_id],
      );
      expect(node.rows[0].toc_node_id).toBeTruthy();
    });
  });

  it('blocks the une_worker dispatch scope from reading any child row', async () => {
    // Intended consequence of 0016: every worker write to these tables happens
    // in a tenant-scoped transaction (toc-job.runner tx B0/B1 withTenant); the
    // dispatch scope only claims/sweeps generation_job.
    const counts = await asRole(db.url, 'une_worker', null, (c) =>
      c.query(
        `SELECT (SELECT count(*)::int FROM job_event) AS events,
                (SELECT count(*)::int FROM toc_version) AS versions,
                (SELECT count(*)::int FROM toc_node) AS nodes,
                (SELECT count(*)::int FROM plan_context_snapshot) AS snapshots`,
      ),
    );
    expect(counts.rows[0]).toEqual({ events: 0, versions: 0, nodes: 0, snapshots: 0 });
  });

  it('blocks the une_worker dispatch scope from writing child rows', async () => {
    await asRole(db.url, 'une_worker', null, async (c) => {
      await expect(
        c.query(
          `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
           VALUES ($1, 500, 'job.started', '{}')`,
          [fxA.jobId],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO toc_version
             (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
           VALUES ($1, 500, 'AI', $2, 'DRAFT', $3, $4)`,
          [fxA.planId, fxA.snapshotId, 'f'.repeat(64), fxA.userId],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        c.query(
          `INSERT INTO toc_node (toc_version_id, node_key, title, level, sort_order, generation_policy)
           VALUES ($1, 'dispatch', '디스패치 노드', 1, 500, '{}')`,
          [fxA.tocVersionId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('keeps the une_worker tenant scope fully functional (read and append)', async () => {
    await asRole(db.url, 'une_worker', fxA.tenantId, async (c) => {
      const snapshot = await c.query(
        `SELECT content_hash FROM plan_context_snapshot WHERE context_snapshot_id = $1`,
        [fxA.snapshotId],
      );
      expect(snapshot.rows).toHaveLength(1);

      const appended = await c.query(
        `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
         VALUES ($1, (SELECT coalesce(max(sequence_no), 0) + 1 FROM job_event WHERE job_id = $1),
                 'provider.responded', '{"rawResponse":"real provider payload"}')
         RETURNING sequence_no`,
        [fxA.jobId],
      );
      expect(Number(appended.rows[0].sequence_no)).toBeGreaterThan(1);

      const version = await c.query(
        `INSERT INTO toc_version
           (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
         VALUES ($1, 10, 'AI', $2, 'DRAFT', $3, $4) RETURNING toc_version_id`,
        [fxA.planId, fxA.snapshotId, '9'.repeat(64), fxA.userId],
      );
      const node = await c.query(
        `INSERT INTO toc_node (toc_version_id, node_key, title, level, sort_order, generation_policy)
         VALUES ($1, 'n-1', '워커 목차', 1, 1, '{}') RETURNING toc_node_id`,
        [version.rows[0].toc_version_id],
      );
      expect(node.rows[0].toc_node_id).toBeTruthy();

      // The worker must still not reach the other tenant's rows.
      const other = await c.query(`SELECT job_id FROM job_event WHERE job_id = $1`, [fxB.jobId]);
      expect(other.rows).toHaveLength(0);
    });
  });

  it('keeps the SSE read path on uk_job_event_seq under RLS (EXPLAIN)', async () => {
    // CC-120 used EXPLAIN to reject a redundant index; here it proves the
    // opposite direction — the new EXISTS policy must not degrade the
    // UNE-PLAN-011 stream read into a sequential scan over every tenant's
    // events.
    const explain = async (sql: string, params: unknown[]): Promise<string> =>
      asRole(db.url, 'une_app', fxA.tenantId, async (c) => {
        const res = await c.query(`EXPLAIN ${sql}`, params);
        return res.rows.map((r) => r['QUERY PLAN'] as string).join('\n');
      });

    const plain = await explain(`SELECT * FROM job_event WHERE job_id = $1 ORDER BY sequence_no`, [
      bulkJobId,
    ]);
    expect(plain, plain).toMatch(/(Bitmap )?Index (Only )?Scan[^\n]*uk_job_event_seq/);
    expect(plain, plain).not.toMatch(/Seq Scan on job_event/);

    // The repository query (JobEventRepository.listPublicSince) keeps its own
    // tenant join on top of the policy; same access path is required.
    const repository = await explain(
      `SELECT e.sequence_no, e.event_type, e.payload_json, e.created_at
       FROM job_event e
       JOIN generation_job g ON g.job_id = e.job_id AND g.tenant_id = $2
       WHERE e.job_id = $1 AND e.sequence_no > $3
       ORDER BY e.sequence_no`,
      [bulkJobId, fxA.tenantId, 0],
    );
    expect(repository, repository).toMatch(/(Bitmap )?Index (Only )?Scan[^\n]*uk_job_event_seq/);
    expect(repository, repository).not.toMatch(/Seq Scan on job_event/);
  });
});
