import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runner as migrate } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTocJobRequest, canonicalHash, jobIdempotencyKey } from '@une/domain';
import {
  MOCK_FAIL_PREFIX,
  MockLegacyT3qPlanAdapter,
  createT3qPlanProvider,
} from '@une/provider-adapters';
import { loadWorkerConfig, type WorkerConfig } from '../config/worker-config';
import { WorkerDatabase } from '../db/worker-database.service';
import { TocJobRunner } from './toc-job.runner';

/**
 * CC-120 worker acceptance evidence: dispatch (cross-tenant, une_worker RLS),
 * canonical mapping into toc_version/toc_node, failure/cancel/lease paths —
 * against a real migrated scratch database. Skipped without DATABASE_URL.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

const CONTEXT = {
  subject: '2026년 폭염 대비 안전관리 계획',
  backgroundInfo: { disasterType: '폭염', controlPhase: '대비' },
  contentInstruction: { essentialFactors: ['무더위쉼터 운영', '취약계층 보호 대책'] },
  purposeOfDocument: {
    goalOfBusiness: '폭염 피해 최소화',
    role: '재난안전 담당자',
    targetAudiences: ['중앙정부'],
  },
};

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface Fixture {
  tenantId: string;
  userId: string;
  planId: string;
  snapshotId: string;
}

describe.skipIf(!ADMIN_URL)('CC-120 TOC job runner e2e', () => {
  let dbName: string;
  let dbUrl: string;
  let config: WorkerConfig;
  let db: WorkerDatabase;

  const newRunner = (adapter = new MockLegacyT3qPlanAdapter()): TocJobRunner =>
    new TocJobRunner(db, adapter, config);

  const insertFixture = async (
    c: Client,
    code: string,
    context: unknown = CONTEXT,
  ): Promise<Fixture> => {
    const tenantId = (
      await c.query(
        `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1, $1, 'ACTIVE') RETURNING tenant_id`,
        [code],
      )
    ).rows[0].tenant_id as string;
    const userId = (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, `worker-${code}`],
      )
    ).rows[0].user_id as string;
    const planId = (
      await c.query(
        `INSERT INTO plan (tenant_id, title, hazard_type, management_phase, status, owner_id)
         VALUES ($1, $2, '폭염', '대비', 'CONTEXT_READY', $3) RETURNING plan_id`,
        [tenantId, `worker plan ${code}`, userId],
      )
    ).rows[0].plan_id as string;
    const snapshotId = (
      await c.query(
        `INSERT INTO plan_context_snapshot (plan_id, version_no, context_json, content_hash, confirmed_by)
         VALUES ($1, 1, $2, $3, $4) RETURNING context_snapshot_id`,
        [planId, JSON.stringify(context), canonicalHash(context), userId],
      )
    ).rows[0].context_snapshot_id as string;
    await c.query(
      `UPDATE plan SET current_context_snapshot_id = $2, status = 'OUTLINE_GENERATING' WHERE plan_id = $1`,
      [planId, snapshotId],
    );
    return { tenantId, userId, planId, snapshotId };
  };

  const enqueueJob = async (
    c: Client,
    fx: Fixture,
    overrides: { context?: unknown; contextHash?: string } = {},
  ): Promise<string> => {
    const request = buildTocJobRequest({
      snapshotId: fx.snapshotId,
      contextHash: overrides.contextHash ?? canonicalHash(overrides.context ?? CONTEXT),
      requestedBy: fx.userId,
    });
    const jobId = (
      await c.query(
        `INSERT INTO generation_job
           (tenant_id, job_type, aggregate_type, aggregate_id, provider_code, request_json,
            status, progress_pct, idempotency_key, correlation_id)
         VALUES ($1, 'TOC', 'PLAN', $2, 'T3Q', $3, 'QUEUED', 0, $4, $5)
         RETURNING job_id`,
        [
          fx.tenantId,
          fx.planId,
          JSON.stringify(request),
          jobIdempotencyKey('TOC', 'POST /plans/{planId}/toc-jobs', fx.planId, randomUUID()),
          `corr_${randomUUID().slice(0, 8)}`,
        ],
      )
    ).rows[0].job_id as string;
    await c.query(
      `INSERT INTO job_event (job_id, sequence_no, event_type, payload_json)
       VALUES ($1, 1, 'job.queued', '{}')`,
      [jobId],
    );
    return jobId;
  };

  beforeAll(async () => {
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc120_wrk_${randomUUID().slice(0, 8)}`;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await withClient(ADMIN_URL as string, (c) => c.query(`CREATE DATABASE ${dbName}`));
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    adminUrl.pathname = `/${dbName}`;
    dbUrl = adminUrl.toString();
    await migrate({
      databaseUrl: dbUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: 'pgmigrations',
      ignorePattern: '\\..*|README\\.md',
      direction: 'up',
      logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
    });
    // Admin URL + SET LOCAL ROLE une_worker: the worker policies apply exactly
    // as they do for the production une_worker login (auth e2e pattern).
    config = loadWorkerConfig({
      DATABASE_URL: dbUrl,
      UNE_DB_RUNTIME_ROLE: 'une_worker',
      UNE_WORKER_MAX_ATTEMPTS: '2',
      UNE_WORKER_LEASE_TIMEOUT_MS: '60000',
    });
    db = new WorkerDatabase(config);
  }, 240_000);

  afterAll(async () => {
    if (db) await db.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  it('completes a queued job end to end: toc_version tree, plan pointer, events, audit', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'ok'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

    const summary = await newRunner().runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(
          `SELECT status, progress_pct, attempt_no, finished_at FROM generation_job WHERE job_id=$1`,
          [jobId],
        )
      ).rows[0];
      expect(job.status).toBe('COMPLETED');
      expect(Number(job.progress_pct)).toBe(100);
      expect(job.attempt_no).toBe(1);
      expect(job.finished_at).not.toBeNull();

      const plan = (
        await c.query(
          `SELECT status, current_toc_version_id, version_no FROM plan WHERE plan_id=$1`,
          [fx.planId],
        )
      ).rows[0];
      expect(plan.status).toBe('OUTLINE_REVIEW');
      expect(plan.current_toc_version_id).not.toBeNull();

      const version = (
        await c.query(
          `SELECT source_type, status, base_snapshot_id, content_hash, created_by
           FROM toc_version WHERE toc_version_id=$1`,
          [plan.current_toc_version_id],
        )
      ).rows[0];
      expect(version).toMatchObject({
        source_type: 'AI',
        status: 'DRAFT',
        base_snapshot_id: fx.snapshotId,
        created_by: fx.userId,
      });
      expect(version.content_hash).toMatch(/^[0-9a-f]{64}$/);

      const nodes = await c.query(
        `SELECT node_key, title, level, sort_order, parent_node_id FROM toc_node
         WHERE toc_version_id=$1 ORDER BY level, sort_order`,
        [plan.current_toc_version_id],
      );
      expect(nodes.rowCount).toBeGreaterThanOrEqual(5);
      expect(nodes.rows[0].node_key).toBe('n-1');
      const childRow = nodes.rows.find((r) => r.node_key === 'n-2-1');
      expect(childRow.title).toBe('1. 무더위쉼터 운영');
      expect(childRow.parent_node_id).not.toBeNull();

      const events = await c.query(
        `SELECT sequence_no, event_type FROM job_event WHERE job_id=$1 ORDER BY sequence_no`,
        [jobId],
      );
      const types = events.rows.map((r) => r.event_type);
      expect(types[0]).toBe('job.queued');
      expect(types).toContain('job.started');
      expect(types).toContain('provider.responded');
      expect(types).toContain('toc.section');
      expect(types.at(-1)).toBe('job.completed');
      const seqs = events.rows.map((r) => Number(r.sequence_no));
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));

      const completed = (
        await c.query(
          `SELECT payload_json FROM job_event WHERE job_id=$1 AND event_type='job.completed'`,
          [jobId],
        )
      ).rows[0].payload_json;
      expect(completed.tocVersionId).toBe(plan.current_toc_version_id);

      const audit = await c.query(
        `SELECT actor_id FROM audit_log
         WHERE tenant_id=$1 AND action='TOC_VERSION_CREATED' AND resource_id=$2`,
        [fx.tenantId, fx.planId],
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0].actor_id).toBe(fx.userId);
    });
  });

  it('processes jobs of two tenants in one pass without cross-tenant bleed', async () => {
    const [fxA, fxB] = await withClient(dbUrl, async (c) => [
      await insertFixture(c, 'ta'),
      await insertFixture(c, 'tb'),
    ]);
    await withClient(dbUrl, async (c) => {
      await enqueueJob(c, fxA);
      await enqueueJob(c, fxB);
    });

    const summary = await newRunner().runOnce();
    expect(summary.completed).toBe(2);

    await withClient(dbUrl, async (c) => {
      for (const fx of [fxA, fxB]) {
        const plan = (
          await c.query(`SELECT status, current_toc_version_id FROM plan WHERE plan_id=$1`, [
            fx.planId,
          ])
        ).rows[0];
        expect(plan.status).toBe('OUTLINE_REVIEW');
        const version = (
          await c.query(`SELECT plan_id FROM toc_version WHERE toc_version_id=$1`, [
            plan.current_toc_version_id,
          ])
        ).rows[0];
        expect(version.plan_id).toBe(fx.planId);
      }
    });
  });

  it('never processes the same job twice under two concurrent runners (SKIP LOCKED)', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'race'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

    const [s1, s2] = await Promise.all([newRunner().runOnce(), newRunner().runOnce()]);
    expect(s1.completed + s2.completed).toBe(1);
    expect(s1.claimed + s2.claimed).toBe(1);

    await withClient(dbUrl, async (c) => {
      const completions = await c.query(
        `SELECT count(*)::int AS n FROM job_event WHERE job_id=$1 AND event_type='job.completed'`,
        [jobId],
      );
      expect(completions.rows[0].n).toBe(1);
    });
  });

  it('records provider failure as FAILED with raw trace and reverts the plan', async () => {
    const failingContext = { ...CONTEXT, subject: `${MOCK_FAIL_PREFIX} 폭염 계획` };
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'fail', failingContext));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx, { context: failingContext }));

    const summary = await newRunner(
      new MockLegacyT3qPlanAdapter({ scenariosEnabled: true }),
    ).runOnce();
    expect(summary.failed).toBe(1);

    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(`SELECT status, error_json FROM generation_job WHERE job_id=$1`, [jobId])
      ).rows[0];
      expect(job.status).toBe('FAILED');
      expect(job.error_json).toMatchObject({
        code: 'T3Q-502-001',
        reason: 'PROVIDER_ERROR',
        retryable: true,
        providerCode: 'MOCK_PROVIDER_ERROR',
      });

      const plan = (await c.query(`SELECT status FROM plan WHERE plan_id=$1`, [fx.planId])).rows[0];
      expect(plan.status).toBe('CONTEXT_READY'); // no prior outline → revert

      const versions = await c.query(
        `SELECT count(*)::int AS n FROM toc_version WHERE plan_id=$1`,
        [fx.planId],
      );
      expect(versions.rows[0].n).toBe(0);

      const failedEvent = (
        await c.query(
          `SELECT payload_json FROM job_event WHERE job_id=$1 AND event_type='provider.failed'`,
          [jobId],
        )
      ).rows[0];
      expect(failedEvent.payload_json.rawRequest).toBeDefined();
    });
  });

  it('fails a snapshot-hash mismatch without calling the provider', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'hash'));
    const jobId = await withClient(dbUrl, (c) =>
      enqueueJob(c, fx, { contextHash: 'b'.repeat(64) }),
    );

    const summary = await newRunner().runOnce();
    expect(summary.failed).toBe(1);
    await withClient(dbUrl, async (c) => {
      const job = (await c.query(`SELECT error_json FROM generation_job WHERE job_id=$1`, [jobId]))
        .rows[0];
      expect(job.error_json.reason).toBe('SNAPSHOT_HASH_MISMATCH');
      expect(job.error_json.retryable).toBe(false);
    });
  });

  it('honours a cancel requested before execution: CANCELLED, result discarded', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'cancel'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));
    await withClient(dbUrl, (c) =>
      c.query(`UPDATE generation_job SET status='CANCEL_REQUESTED' WHERE job_id=$1`, [jobId]),
    );

    const summary = await newRunner().runOnce();
    expect(summary.cancelled).toBe(1);
    await withClient(dbUrl, async (c) => {
      const job = (await c.query(`SELECT status FROM generation_job WHERE job_id=$1`, [jobId]))
        .rows[0];
      expect(job.status).toBe('CANCELLED');
      const versions = await c.query(
        `SELECT count(*)::int AS n FROM toc_version WHERE plan_id=$1`,
        [fx.planId],
      );
      expect(versions.rows[0].n).toBe(0);
    });
  });

  it('re-claims an expired RUNNING lease and fails the job past max attempts', async () => {
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'lease'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));
    // Simulate a crashed worker: RUNNING with a stale lease and attempts at
    // the limit (maxAttempts=2 in this config; next claim makes it 3).
    await withClient(dbUrl, (c) =>
      c.query(
        `UPDATE generation_job
         SET status='RUNNING', started_at = now() - interval '10 minutes', attempt_no = 2
         WHERE job_id=$1`,
        [jobId],
      ),
    );

    const summary = await newRunner().runOnce();
    expect(summary.claimed).toBe(1);
    expect(summary.failed).toBe(1);
    await withClient(dbUrl, async (c) => {
      const job = (
        await c.query(`SELECT status, error_json, attempt_no FROM generation_job WHERE job_id=$1`, [
          jobId,
        ])
      ).rows[0];
      expect(job.status).toBe('FAILED');
      expect(job.attempt_no).toBe(3);
      expect(job.error_json.reason).toBe('MAX_ATTEMPTS_EXCEEDED');
    });
  });

  // ── CC-125: real-HTTP and target-v2 adapters through the SAME runner ──

  it('legacy-http full journey: fixture server → toc_version + provider.requested/responded traces', async () => {
    const { createServer } = await import('node:http');
    const requests: string[] = [];
    const server = createServer((req, res) => {
      requests.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          title: 'HTTP 목차',
          sections: [
            { name: 'Ⅰ. 개요', children: [{ name: '1. 추진 배경', children: [] }] },
            { name: 'Ⅱ. 대비 대책', children: [] },
          ],
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const httpConfig = loadWorkerConfig({
        DATABASE_URL: dbUrl,
        UNE_DB_RUNTIME_ROLE: 'une_worker',
        UNE_WORKER_LEASE_TIMEOUT_MS: '60000',
        UNE_T3Q_PLAN_ADAPTER: 'legacy-http',
        UNE_T3Q_BASE_URL: `http://127.0.0.1:${port}`,
        UNE_T3Q_AUTH_MODE: 'header',
        UNE_T3Q_AUTH_HEADER_NAME: 'X-T3Q-Key',
        UNE_T3Q_AUTH_TOKEN: 'e2e-token',
        UNE_T3Q_CONNECT_TIMEOUT_MS: '1000',
        UNE_T3Q_RESPONSE_TIMEOUT_MS: '2000',
      });
      const adapter = createT3qPlanProvider({
        kind: 'legacy-http',
        legacyHttp: httpConfig.t3qHttp as NonNullable<typeof httpConfig.t3qHttp>,
      });
      const fx = await withClient(dbUrl, (c) => insertFixture(c, 'http'));
      const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

      const summary = await new TocJobRunner(db, adapter, httpConfig).runOnce();
      expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });
      expect(requests).toEqual(['/model-api/ae894/reports/plan/toc']);

      await withClient(dbUrl, async (c) => {
        const events = (
          await c.query(
            `SELECT event_type, payload_json FROM job_event WHERE job_id=$1 ORDER BY sequence_no`,
            [jobId],
          )
        ).rows;
        const requested = events.find((e) => e.event_type === 'provider.requested');
        expect(requested.payload_json).toMatchObject({
          phase: 'intent',
          adapterId: 'legacy-http-v0.8.5',
          variant: 'legacy',
          runtimeMode: 'live',
          operation: 'toc',
          baseUrlHost: `127.0.0.1:${port}`,
        });
        // Budget only — never headers/tokens.
        expect(JSON.stringify(requested.payload_json)).not.toContain('e2e-token');
        const responded = events.find((e) => e.event_type === 'provider.responded');
        expect(responded.payload_json).toMatchObject({
          adapterId: 'legacy-http-v0.8.5',
          mappingVersion: 'legacy-v0.8.5-une1@1',
          operation: 'toc',
          httpStatus: 200,
        });
        expect(JSON.stringify(responded.payload_json)).not.toContain('e2e-token');
        const nodes = (
          await c.query(
            `SELECT n.title FROM toc_node n
             JOIN toc_version v ON v.toc_version_id = n.toc_version_id
             WHERE v.plan_id=$1 ORDER BY n.sort_order`,
            [fx.planId],
          )
        ).rows.map((r) => r.title);
        expect(nodes).toContain('Ⅰ. 개요');
      });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('legacy-http guard violation: FAILED with rawResponse preserved on provider.failed (CC-120 defect fix)', async () => {
    const { createServer } = await import('node:http');
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"title":"부서진 응답","sections":"nope"}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const adapter = createT3qPlanProvider({
        kind: 'legacy-http',
        legacyHttp: { baseUrl: `http://127.0.0.1:${port}`, authMode: 'none' },
      });
      const fx = await withClient(dbUrl, (c) => insertFixture(c, 'guard'));
      const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

      const summary = await new TocJobRunner(db, adapter, config).runOnce();
      expect(summary.failed).toBe(1);
      await withClient(dbUrl, async (c) => {
        const job = (
          await c.query(`SELECT status, error_json FROM generation_job WHERE job_id=$1`, [jobId])
        ).rows[0];
        expect(job.status).toBe('FAILED');
        expect(job.error_json.providerCode).toBe('T3Q_RESPONSE_CONTRACT_VIOLATION');
        const failed = (
          await c.query(
            `SELECT payload_json FROM job_event WHERE job_id=$1 AND event_type='provider.failed'`,
            [jobId],
          )
        ).rows[0];
        // The raw response used to be lost exactly here (runner M3 backstop
        // swallowed it) — now the adapter carries it into the failure value.
        expect(failed.payload_json.rawResponse).toMatchObject({ title: '부서진 응답' });
        expect(failed.payload_json.rawRequest).toBeDefined();
      });
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('mock-target-v2 journey: PlanRequestBase bindings from job context, stable sectionId node keys', async () => {
    const adapter = createT3qPlanProvider({ kind: 'mock-target-v2' });
    const fx = await withClient(dbUrl, (c) => insertFixture(c, 'v2'));
    const jobId = await withClient(dbUrl, (c) => enqueueJob(c, fx));

    const summary = await new TocJobRunner(db, adapter, config).runOnce();
    expect(summary).toMatchObject({ claimed: 1, completed: 1, failed: 0 });

    await withClient(dbUrl, async (c) => {
      const responded = (
        await c.query(
          `SELECT payload_json FROM job_event WHERE job_id=$1 AND event_type='provider.responded'`,
          [jobId],
        )
      ).rows[0].payload_json;
      expect(responded).toMatchObject({
        adapterId: 'mock-target-v2-1.0.1',
        mappingVersion: 'v2-1.0.1-request@1',
      });
      // The raw v2 request binds the REAL job context — snapshot, hash, ids.
      expect(responded.rawRequest).toMatchObject({
        schemaVersion: '2.0',
        planId: fx.planId,
        planContextSnapshotId: fx.snapshotId,
        // Per-attempt idempotency anchor (review minor 6): retry = new
        // generation, so the requestId carries the attempt number.
        requestId: `${jobId}#1`,
        documentId: 'une-mock:document:pending-cc150',
      });
      const keys = (
        await c.query(
          `SELECT n.node_key FROM toc_node n
           JOIN toc_version v ON v.toc_version_id = n.toc_version_id
           WHERE v.plan_id=$1`,
          [fx.planId],
        )
      ).rows.map((r) => r.node_key as string);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((k) => k.startsWith('s-'))).toBe(true);
    });
  });
});
