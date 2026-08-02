import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_FAIL_PREFIX, MockLegacyT3qPlanAdapter } from '@une/provider-adapters';
import { createApp } from '../app.factory';
import { buildMockExternalToken } from '../auth/mock-sso';
import type { ApiConfig } from '../config/api-config';
// The full-journey evidence drives the worker in-process (design 10 §7.9
// 7-9단계). Relative source import on purpose: @une/worker is an app package
// without a library entry; tests must judge worker SOURCE, not stale dist
// (CC-115 QA F1 lesson).
import { loadWorkerConfig } from '../../../worker/src/config/worker-config';
import { WorkerDatabase } from '../../../worker/src/db/worker-database.service';
import { TocJobRunner } from '../../../worker/src/plan-toc/toc-job.runner';

const ADMIN_URL = process.env.DATABASE_URL;
const SECRET = 'e2e-signing-secret-e2e-signing-secret!!';
const MIGRATIONS_DIR = resolve(process.cwd(), '..', '..', 'database', 'migrations');

const validContext = {
  subject: '2026년 폭염 대비 안전관리 계획',
  backgroundInfo: { disasterType: '폭염', controlPhase: '대비' },
  contentInstruction: { essentialFactors: ['무더위쉼터 운영', '취약계층 보호 대책'] },
  purposeOfDocument: {
    goalOfBusiness: '폭염 피해 최소화',
    role: '재난안전 담당자',
    targetAudiences: ['중앙정부'],
  },
};

interface Fixtures {
  tenantA: string;
  tenantB: string;
  adminA: string;
  plainA: string;
  userB: string;
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function insertFixtures(c: Client): Promise<Fixtures> {
  const tenant = async (code: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO tenant (tenant_code, tenant_name, status) VALUES ($1, $1, 'ACTIVE')
         RETURNING tenant_id`,
        [code],
      )
    ).rows[0].tenant_id as string;
  const tenantA = await tenant('toc-a');
  const tenantB = await tenant('toc-b');
  const user = async (tenantId: string, login: string): Promise<string> =>
    (
      await c.query(
        `INSERT INTO app_user (tenant_id, login_id, display_name, status)
         VALUES ($1, $2, $2, 'ACTIVE') RETURNING user_id`,
        [tenantId, login],
      )
    ).rows[0].user_id as string;
  const adminA = await user(tenantA, 'admin-a');
  const plainA = await user(tenantA, 'plain-a');
  const userB = await user(tenantB, 'user-b');
  await c.query(
    `INSERT INTO role_permission (role_id, permission_id)
     SELECT r.role_id, p.permission_id
     FROM role r JOIN permission p
       ON p.permission_code IN ('PLAN_CREATE','PLAN_READ','PLAN_EDIT','PLAN_DELETE','PLAN_GENERATE')
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
  );
  await c.query(
    `INSERT INTO user_role (user_id, role_id, granted_by)
     SELECT u.user_id, r.role_id, u.user_id
     FROM app_user u, role r
     WHERE r.tenant_id IS NULL AND r.role_code = 'INSTITUTION_ADMIN'
       AND u.user_id = ANY($1::uuid[])`,
    [[adminA, userB]],
  );
  return { tenantA, tenantB, adminA, plainA, userB };
}

describe.skipIf(!ADMIN_URL)('CC-120 TOC job e2e (API + in-process worker)', () => {
  let dbName: string;
  let app: INestApplication;
  let base: string;
  let dbUrl: string;
  let fx: Fixtures;
  let tokenA: string;
  let tokenB: string;
  let tokenPlain: string;
  let workerDb: WorkerDatabase;
  let workerRunner: TocJobRunner;
  let failRunner: TocJobRunner;

  const login = async (tenantId: string, loginId: string): Promise<string> => {
    const res = await fetch(`${base}/api/v1/auth/sso/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ externalToken: buildMockExternalToken({ tenantId, loginId }) }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
  };

  const call = async (
    method: string,
    path: string,
    token: string,
    options: { body?: unknown; idempotencyKey?: string; ifMatch?: string } = {},
  ): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
        ...(options.ifMatch ? { 'if-match': options.ifMatch } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  /** Plan with a confirmed snapshot (CONTEXT_READY) — the TOC job entry state. */
  const readyPlan = async (
    token: string,
    context: Record<string, unknown> = validContext,
  ): Promise<{ planId: string; snapshotId: string }> => {
    const created = await call('POST', '/api/v1/plans', token, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { title: 'TOC 대상', startMode: 'BLANK', hazardType: '폭염', managementPhase: '대비' },
    });
    expect(created.status).toBe(201);
    const planId = ((await created.json()) as { data: { planId: string } }).data.planId;
    const confirmed = await call('POST', `/api/v1/plans/${planId}/context-snapshots`, token, {
      idempotencyKey: `key_${randomUUID()}`,
      body: context,
    });
    expect(confirmed.status).toBe(201);
    const snapshotId = ((await confirmed.json()) as { data: { contextSnapshotId: string } }).data
      .contextSnapshotId;
    return { planId, snapshotId };
  };

  const startJob = async (
    token: string,
    planId: string,
    snapshotId: string,
  ): Promise<{ jobId: string }> => {
    const res = await call('POST', `/api/v1/plans/${planId}/toc-jobs`, token, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { contextSnapshotId: snapshotId },
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { data: { jobId: string; status: string } };
    expect(body.data.status).toBe('QUEUED');
    return { jobId: body.data.jobId };
  };

  beforeAll(async () => {
    if (!existsSync(MIGRATIONS_DIR)) throw new Error(`migrations dir not found: ${MIGRATIONS_DIR}`);
    const adminUrl = new URL(ADMIN_URL as string);
    dbName = `cc120_e2e_${randomUUID().slice(0, 8)}`;
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
    await runner({
      databaseUrl: dbUrl,
      dir: MIGRATIONS_DIR,
      migrationsTable: 'pgmigrations',
      ignorePattern: '\\..*|README\\.md',
      direction: 'up',
      logger: { info: () => {}, warn: () => {}, error: console.error, debug: () => {} },
    });
    fx = await withClient(dbUrl, insertFixtures);

    const config: ApiConfig = {
      port: 0,
      authMode: 'mock',
      jwtSecret: SECRET,
      accessTtlSec: 900,
      refreshTtlSec: 3600,
      databaseUrl: dbUrl,
      runtimeRole: 'une_app',
    };
    app = await createApp(config);
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    tokenA = await login(fx.tenantA, 'admin-a');
    tokenB = await login(fx.tenantB, 'user-b');
    tokenPlain = await login(fx.tenantA, 'plain-a');

    const workerConfig = loadWorkerConfig({
      DATABASE_URL: dbUrl,
      UNE_DB_RUNTIME_ROLE: 'une_worker',
    });
    workerDb = new WorkerDatabase(workerConfig);
    workerRunner = new TocJobRunner(workerDb, new MockLegacyT3qPlanAdapter(), workerConfig);
    failRunner = new TocJobRunner(
      workerDb,
      new MockLegacyT3qPlanAdapter({ scenariosEnabled: true }),
      workerConfig,
    );
  }, 240_000);

  afterAll(async () => {
    if (workerDb) await workerDb.close();
    if (app) await app.close();
    if (dbName) {
      await withClient(ADMIN_URL as string, (c) =>
        c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`),
      );
    }
  });

  it('runs the full journey: request → worker → COMPLETED job with result → toc version → plan pointer', async () => {
    const { planId, snapshotId } = await readyPlan(tokenA);
    const { jobId } = await startJob(tokenA, planId, snapshotId);

    const planDuring = await call('GET', `/api/v1/plans/${planId}`, tokenA);
    expect(((await planDuring.json()) as { data: { status: string } }).data.status).toBe(
      'OUTLINE_GENERATING',
    );

    const summary = await workerRunner.runOnce();
    expect(summary.completed).toBe(1);

    const jobRes = await call('GET', `/api/v1/plan-jobs/${jobId}`, tokenA);
    expect(jobRes.status).toBe(200);
    const job = (
      (await jobRes.json()) as {
        data: {
          status: string;
          progressPct: number;
          result: { tocVersionId: string; tocVersionNo: number };
        };
      }
    ).data;
    expect(job.status).toBe('COMPLETED');
    expect(job.progressPct).toBe(100);
    expect(job.result.tocVersionNo).toBe(1);

    const versionRes = await call(
      'GET',
      `/api/v1/plans/${planId}/toc-versions/${job.result.tocVersionId}`,
      tokenA,
    );
    expect(versionRes.status).toBe(200);
    const version = (
      (await versionRes.json()) as {
        data: {
          sourceType: string;
          status: string;
          nodes: { nodeKey: string; title: string; children: unknown[] }[];
        };
      }
    ).data;
    expect(version.sourceType).toBe('AI');
    expect(version.status).toBe('DRAFT');
    expect(version.nodes[0].nodeKey).toBe('n-1');
    expect(version.nodes[1].title).toBe('Ⅱ. 폭염 대비 대책');

    const planAfter = await call('GET', `/api/v1/plans/${planId}`, tokenA);
    const planData = (
      (await planAfter.json()) as { data: { status: string; currentTocVersionId: string } }
    ).data;
    expect(planData.status).toBe('OUTLINE_REVIEW');
    expect(planData.currentTocVersionId).toBe(job.result.tocVersionId);

    const audit = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT 1 FROM audit_log WHERE tenant_id=$1 AND action='TOC_JOB_REQUESTED' AND resource_id=$2`,
        [fx.tenantA, jobId],
      ),
    );
    expect(audit.rowCount).toBe(1);
  });

  it('enforces preconditions: no snapshot 412 PLAN-412-001, wrong snapshot 400, trash 412, active job 409', async () => {
    // Plan without a confirmed snapshot.
    const bare = await call('POST', '/api/v1/plans', tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: {
        title: '스냅샷 없음',
        startMode: 'BLANK',
        hazardType: '지진',
        managementPhase: '예방',
      },
    });
    const barePlanId = ((await bare.json()) as { data: { planId: string } }).data.planId;
    const noSnapshot = await call('POST', `/api/v1/plans/${barePlanId}/toc-jobs`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { contextSnapshotId: randomUUID() },
    });
    expect(noSnapshot.status).toBe(412);
    expect(((await noSnapshot.json()) as { error: { code: string } }).error.code).toBe(
      'PLAN-412-001',
    );

    const { planId, snapshotId } = await readyPlan(tokenA);
    const wrongSnapshot = await call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { contextSnapshotId: randomUUID() },
    });
    expect(wrongSnapshot.status).toBe(400);
    expect(((await wrongSnapshot.json()) as { error: { code: string } }).error.code).toBe(
      'PLAN-4001',
    );

    await startJob(tokenA, planId, snapshotId);
    const duplicate = await call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { contextSnapshotId: snapshotId },
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe(
      'PLAN-409-002',
    );

    const trash = await readyPlan(tokenA);
    await call('DELETE', `/api/v1/plans/${trash.planId}`, tokenA);
    const trashed = await call('POST', `/api/v1/plans/${trash.planId}/toc-jobs`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { contextSnapshotId: trash.snapshotId },
    });
    expect(trashed.status).toBe(412);
    expect(((await trashed.json()) as { error: { code: string } }).error.code).toBe('PLAN-412-002');
  });

  it('is idempotent on the client key and guarded by the DB unique as a second net', async () => {
    const { planId, snapshotId } = await readyPlan(tokenA);
    const key = `key_${randomUUID()}`;
    const body = { contextSnapshotId: snapshotId };

    const first = await call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenA, {
      idempotencyKey: key,
      body,
    });
    expect(first.status).toBe(202);
    const jobId = ((await first.json()) as { data: { jobId: string } }).data.jobId;

    const replay = await call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenA, {
      idempotencyKey: key,
      body,
    });
    expect(replay.status).toBe(202);
    expect(((await replay.json()) as { data: { jobId: string } }).data.jobId).toBe(jobId);

    const mismatch = await call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenA, {
      idempotencyKey: key,
      body: { contextSnapshotId: snapshotId, generationOption: { notes: '다른 내용' } },
    });
    expect(mismatch.status).toBe(409);
    expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe('COM-0409');

    const missingKey = await call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenA, { body });
    expect(missingKey.status).toBe(400);
    expect(((await missingKey.json()) as { error: { code: string } }).error.code).toBe('COM-0400');

    const jobs = await withClient(dbUrl, (c) =>
      c.query(
        `SELECT count(*)::int AS n FROM generation_job WHERE aggregate_id=$1 AND job_type='TOC'`,
        [planId],
      ),
    );
    expect(jobs.rows[0].n).toBe(1);
  });

  it('scopes jobs by permission and tenant', async () => {
    const { planId, snapshotId } = await readyPlan(tokenA);

    const forbidden = await call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenPlain, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { contextSnapshotId: snapshotId },
    });
    expect(forbidden.status).toBe(403);

    const crossTenant = await call('POST', `/api/v1/plans/${planId}/toc-jobs`, tokenB, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { contextSnapshotId: snapshotId },
    });
    expect(crossTenant.status).toBe(404);

    const { jobId } = await startJob(tokenA, planId, snapshotId);
    const crossJob = await call('GET', `/api/v1/plan-jobs/${jobId}`, tokenB);
    expect(crossJob.status).toBe(404);
    expect(((await crossJob.json()) as { error: { code: string } }).error.code).toBe('JOB-404-001');

    const crossSse = await fetch(`${base}/api/v1/plan-jobs/${jobId}/events`, {
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossSse.status).toBe(404);
  });

  it('streams public events over SSE with sequence ids, hides provider internals, resumes by Last-Event-ID', async () => {
    const { planId, snapshotId } = await readyPlan(tokenA);
    const { jobId } = await startJob(tokenA, planId, snapshotId);
    await workerRunner.runOnce();

    const parseFrames = (text: string): Array<{ id?: string; event?: string; data: string }> =>
      text
        .split('\n\n')
        .filter((frame) => frame.trim().length > 0)
        .map((frame) => {
          const out: { id?: string; event?: string; data: string } = { data: '' };
          for (const line of frame.split('\n')) {
            if (line.startsWith('id:')) out.id = line.slice(3).trim();
            else if (line.startsWith('event:')) out.event = line.slice(6).trim();
            else if (line.startsWith('data:')) out.data += line.slice(5).trim();
          }
          return out;
        });

    const readStream = async (lastEventId?: string): Promise<string> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(`${base}/api/v1/plan-jobs/${jobId}/events`, {
          headers: {
            authorization: `Bearer ${tokenA}`,
            ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
          },
          signal: controller.signal,
        });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        return await res.text(); // terminal event completes the stream server-side
      } finally {
        clearTimeout(timeout);
      }
    };

    const frames = parseFrames(await readStream());
    const types = frames
      .map((frame) => JSON.parse(frame.data) as { type: string })
      .map((d) => d.type);
    expect(types[0]).toBe('job.queued');
    expect(types).toContain('job.started');
    expect(types).toContain('toc.section');
    expect(types.at(-1)).toBe('job.completed');
    expect(types.some((t) => t.startsWith('provider.'))).toBe(false);
    const ids = frames.map((frame) => Number(frame.id));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    // Resume: only events after the cursor are replayed.
    const resumeAfter = frames[1].id as string;
    const resumed = parseFrames(await readStream(resumeAfter));
    const resumedIds = resumed.map((frame) => Number(frame.id));
    expect(Math.min(...resumedIds)).toBeGreaterThan(Number(resumeAfter));
  });

  it('cancels a QUEUED job (202 CANCELLED) and rejects cancel on terminal jobs', async () => {
    const { planId, snapshotId } = await readyPlan(tokenA);
    const { jobId } = await startJob(tokenA, planId, snapshotId);

    const cancelled = await call('POST', `/api/v1/plan-jobs/${jobId}/cancel`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { reason: '사용자 취소' },
    });
    expect(cancelled.status).toBe(202);
    expect(((await cancelled.json()) as { data: { status: string } }).data.status).toBe(
      'CANCELLED',
    );

    const planAfter = await call('GET', `/api/v1/plans/${planId}`, tokenA);
    expect(((await planAfter.json()) as { data: { status: string } }).data.status).toBe(
      'CONTEXT_READY',
    );

    const again = await call('POST', `/api/v1/plan-jobs/${jobId}/cancel`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe('JOB-409-001');
  });

  it('protects user edits: saving a TOC version while a job is active is refused (review B1)', async () => {
    const { planId, snapshotId } = await readyPlan(tokenA);
    const first = await startJob(tokenA, planId, snapshotId);
    await workerRunner.runOnce();
    const job = (
      (await (await call('GET', `/api/v1/plan-jobs/${first.jobId}`, tokenA)).json()) as {
        data: { result: { tocVersionId: string } };
      }
    ).data;

    // Regeneration job now active — a user save must be rejected, not raced.
    await startJob(tokenA, planId, snapshotId);
    const blocked = await call('POST', `/api/v1/plans/${planId}/toc-versions`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { baseVersionId: job.result.tocVersionId, tocTree: [{ title: '사용자 편집' }] },
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('PLAN-409-002');
  });

  it('re-applies plan preconditions on retry: trashed plans cannot regrow an outline (QA 필수-2/3)', async () => {
    const failingContext = { ...validContext, subject: `${MOCK_FAIL_PREFIX} 재시도 가드` };
    const { planId, snapshotId } = await readyPlan(tokenA, failingContext);
    const { jobId } = await startJob(tokenA, planId, snapshotId);
    await failRunner.runOnce(); // job FAILED, plan reverted to CONTEXT_READY

    await call('DELETE', `/api/v1/plans/${planId}`, tokenA);
    const retried = await call('POST', `/api/v1/plan-jobs/${jobId}/retry`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
    });
    expect(retried.status).toBe(412);
    expect(((await retried.json()) as { error: { code: string } }).error.code).toBe('PLAN-412-002');

    // No outline may exist for the trashed plan.
    const versions = await withClient(dbUrl, (c) =>
      c.query(`SELECT count(*)::int AS n FROM toc_version WHERE plan_id=$1`, [planId]),
    );
    expect(versions.rows[0].n).toBe(0);
  });

  it('rejects a malformed Last-Event-ID with 400 before streaming', async () => {
    const { planId, snapshotId } = await readyPlan(tokenA);
    const { jobId } = await startJob(tokenA, planId, snapshotId);
    const res = await fetch(`${base}/api/v1/plan-jobs/${jobId}/events`, {
      headers: { authorization: `Bearer ${tokenA}`, 'last-event-id': 'abc' },
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('COM-0400');
  });

  it('retries a FAILED job to completion and rejects blockIds / non-FAILED retries', async () => {
    const failingContext = { ...validContext, subject: `${MOCK_FAIL_PREFIX} 폭염 계획` };
    const { planId, snapshotId } = await readyPlan(tokenA, failingContext);
    const { jobId } = await startJob(tokenA, planId, snapshotId);

    const failSummary = await failRunner.runOnce();
    expect(failSummary.failed).toBe(1);

    const failed = await call('GET', `/api/v1/plan-jobs/${jobId}`, tokenA);
    const failedData = (
      (await failed.json()) as { data: { status: string; error: { code: string } } }
    ).data;
    expect(failedData.status).toBe('FAILED');
    expect(failedData.error.code).toBe('T3Q-502-001');

    const blocked = await call('POST', `/api/v1/plan-jobs/${jobId}/retry`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { blockIds: [randomUUID()] },
    });
    expect(blocked.status).toBe(400);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe('PLAN-4001');

    const retried = await call('POST', `/api/v1/plan-jobs/${jobId}/retry`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { reason: '재시도' },
    });
    expect(retried.status).toBe(202);
    const retriedData = ((await retried.json()) as { data: { status: string; attemptNo: number } })
      .data;
    expect(retriedData.status).toBe('QUEUED');
    // User-driven retry resets the automatic-retry budget (ADR-25 D9).
    expect(retriedData.attemptNo).toBe(0);

    // Scenario runner would fail again ([MOCK-FAIL] subject); the normal
    // runner treats the prefix as plain text and completes.
    const summary = await workerRunner.runOnce();
    expect(summary.completed).toBe(1);
    const done = await call('GET', `/api/v1/plan-jobs/${jobId}`, tokenA);
    expect(((await done.json()) as { data: { status: string } }).data.status).toBe('COMPLETED');

    const nonFailed = await call('POST', `/api/v1/plan-jobs/${jobId}/retry`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
    });
    expect(nonFailed.status).toBe(409);
    expect(((await nonFailed.json()) as { error: { code: string } }).error.code).toBe(
      'JOB-409-002',
    );
  });

  it('saves an edited TOC version (keys preserved, new nodes namespaced) and confirms it', async () => {
    const { planId, snapshotId } = await readyPlan(tokenA);
    const { jobId } = await startJob(tokenA, planId, snapshotId);
    await workerRunner.runOnce();
    const job = (
      (await (await call('GET', `/api/v1/plan-jobs/${jobId}`, tokenA)).json()) as {
        data: { result: { tocVersionId: string } };
      }
    ).data;
    const aiVersionId = job.result.tocVersionId;

    const edited = await call('POST', `/api/v1/plans/${planId}/toc-versions`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: {
        baseVersionId: aiVersionId,
        tocTree: [
          { nodeKey: 'n-1', title: 'Ⅰ. 개요(수정)', children: [{ title: '1. 신규 배경' }] },
          { nodeKey: 'n-2', title: 'Ⅱ. 대책', children: [] },
        ],
      },
    });
    expect(edited.status).toBe(201);
    const editedData = (
      (await edited.json()) as {
        data: {
          tocVersionId: string;
          sourceType: string;
          status: string;
          versionNo: number;
          nodes: { nodeKey: string; children: { nodeKey: string }[] }[];
        };
      }
    ).data;
    expect(editedData.sourceType).toBe('USER');
    expect(editedData.status).toBe('DRAFT');
    expect(editedData.versionNo).toBe(2);
    expect(editedData.nodes[0].nodeKey).toBe('n-1');
    expect(editedData.nodes[0].children[0].nodeKey).toMatch(/^u-[0-9a-f]{8}$/);

    // Stale base → conflict.
    const stale = await call('POST', `/api/v1/plans/${planId}/toc-versions`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { baseVersionId: aiVersionId, tocTree: [{ title: 'x' }] },
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('TOC-409-001');

    // Invalid tree → 422 with pathed violations.
    const invalid = await call('POST', `/api/v1/plans/${planId}/toc-versions`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: { baseVersionId: editedData.tocVersionId, tocTree: [{ title: '   ' }] },
    });
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe('PLAN-422-002');

    // Confirm.
    const confirmed = await call('POST', `/api/v1/plans/${planId}/toc-versions`, tokenA, {
      idempotencyKey: `key_${randomUUID()}`,
      body: {
        baseVersionId: editedData.tocVersionId,
        tocTree: [{ nodeKey: 'n-1', title: 'Ⅰ. 확정', children: [] }],
        confirm: true,
      },
    });
    expect(confirmed.status).toBe(201);
    expect(((await confirmed.json()) as { data: { status: string } }).data.status).toBe(
      'CONFIRMED',
    );
    const planAfter = await call('GET', `/api/v1/plans/${planId}`, tokenA);
    expect(((await planAfter.json()) as { data: { status: string } }).data.status).toBe(
      'OUTLINE_CONFIRMED',
    );

    // Cross-plan version fetch → 404.
    const other = await readyPlan(tokenA);
    const crossVersion = await call(
      'GET',
      `/api/v1/plans/${other.planId}/toc-versions/${aiVersionId}`,
      tokenA,
    );
    expect(crossVersion.status).toBe(404);
    expect(((await crossVersion.json()) as { error: { code: string } }).error.code).toBe(
      'TOC-404-001',
    );
  });
});
