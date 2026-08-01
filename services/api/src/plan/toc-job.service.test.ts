import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../common/request-context';
import type { AuditRepository } from '../common/audit.repository';
import type { DatabaseService } from '../db/database.service';
import type { GenerationJobRepository, JobRow } from './generation-job.repository';
import type { JobEventRepository } from './job-event.repository';
import type { PlanRepository, PlanRow } from './plan.repository';
import type { RequestMeta } from './plan.service';
import { TocJobService } from './toc-job.service';

const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_ID = '44444444-4444-4444-4444-444444444444';
const SNAPSHOT_ID = '55555555-5555-5555-5555-555555555555';
const JOB_ID = '66666666-6666-6666-6666-666666666666';
const TOC_VERSION_ID = '77777777-7777-7777-7777-777777777777';
const CONTENT_HASH = 'a'.repeat(64);

const auth: AuthContext = { userId: USER_ID, tenantId: TENANT_ID, sessionId: USER_ID };
const meta: RequestMeta = { correlationId: 'corr_test' };

function planRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    planId: PLAN_ID,
    tenantId: TENANT_ID,
    title: '계획서',
    hazardType: '호우',
    managementPhase: '예방',
    status: 'CONTEXT_READY',
    startMode: 'BLANK',
    documentId: null,
    currentContextSnapshotId: SNAPSHOT_ID,
    currentTocVersionId: null,
    ownerId: USER_ID,
    versionNo: 1,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

function jobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    jobId: JOB_ID,
    tenantId: TENANT_ID,
    jobType: 'TOC',
    aggregateType: 'PLAN',
    aggregateId: PLAN_ID,
    providerCode: 'T3Q',
    requestJson: {},
    status: 'QUEUED',
    progressPct: 0,
    idempotencyKey: 'key',
    correlationId: 'corr_test',
    errorJson: null,
    attemptNo: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

interface Harness {
  service: TocJobService;
  plans: {
    findPlan: ReturnType<typeof vi.fn>;
    findSnapshot: ReturnType<typeof vi.fn>;
    updatePlanStatus: ReturnType<typeof vi.fn>;
  };
  jobs: {
    findActiveTocJob: ReturnType<typeof vi.fn>;
    insertJob: ReturnType<typeof vi.fn>;
    findJobByIdempotencyKey: ReturnType<typeof vi.fn>;
    findJob: ReturnType<typeof vi.fn>;
    updateJobStatus: ReturnType<typeof vi.fn>;
  };
  events: {
    append: ReturnType<typeof vi.fn>;
    findCompletedResult: ReturnType<typeof vi.fn>;
  };
  audit: { insertAudit: ReturnType<typeof vi.fn> };
  query: ReturnType<typeof vi.fn>;
}

function harness(
  overrides: {
    plan?: PlanRow | null;
    activeJob?: JobRow | null;
    job?: JobRow | null;
  } = {},
): Harness {
  const query = vi.fn(async () => ({ rows: [] }));
  const client = { query };
  const db = {
    withTenant: async <T>(_tenantId: string, fn: (c: unknown) => Promise<T>): Promise<T> =>
      fn(client),
  };
  const plans = {
    findPlan: vi.fn(async () => ('plan' in overrides ? overrides.plan : planRow())),
    findSnapshot: vi.fn(async () => ({
      contextSnapshotId: SNAPSHOT_ID,
      planId: PLAN_ID,
      versionNo: 1,
      contextJson: {},
      contentHash: CONTENT_HASH,
      supersedesId: null,
      confirmedBy: USER_ID,
      confirmedAt: new Date('2026-08-01T00:00:00Z'),
    })),
    updatePlanStatus: vi.fn(async () => planRow()),
  };
  const jobs = {
    findActiveTocJob: vi.fn(async () => overrides.activeJob ?? null),
    insertJob: vi.fn(async () => jobRow()),
    findJobByIdempotencyKey: vi.fn(async () => null),
    findJob: vi.fn(async () => ('job' in overrides ? overrides.job : jobRow())),
    updateJobStatus: vi.fn(
      async (_c: unknown, _t: string, _id: string, patch: { status: string }) =>
        jobRow({ status: patch.status }),
    ),
  };
  const events = { append: vi.fn(async () => 1), findCompletedResult: vi.fn(async () => null) };
  const audit = { insertAudit: vi.fn(async () => undefined) };
  const service = new TocJobService(
    db as unknown as DatabaseService,
    plans as unknown as PlanRepository,
    jobs as unknown as GenerationJobRepository,
    events as unknown as JobEventRepository,
    audit as unknown as AuditRepository,
  );
  return { service, plans, jobs, events, audit, query };
}

describe('TocJobService.requestTocJob', () => {
  it('enqueues a QUEUED job, appends job.queued, moves the plan and audits (happy path)', async () => {
    const h = harness();
    const result = await h.service.requestTocJob(
      auth,
      PLAN_ID,
      { contextSnapshotId: SNAPSHOT_ID },
      'client-key-1',
      meta,
    );
    expect(result).toMatchObject({ jobId: JOB_ID, status: 'QUEUED', attemptNo: 0, result: null });
    const insert = h.jobs.insertJob.mock.calls[0][1];
    expect(insert).toMatchObject({ jobType: 'TOC', aggregateType: 'PLAN', providerCode: 'T3Q' });
    // The worker seam: snapshot id + hash + requesting user, version-pinned.
    expect(insert.requestJson).toEqual({
      schemaVersion: '1',
      snapshotId: SNAPSHOT_ID,
      contextHash: CONTENT_HASH,
      requestedBy: USER_ID,
    });
    // uk_job_idempotency key is derived, never the raw client header.
    expect(insert.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(h.events.append.mock.calls[0][2]).toBe('job.queued');
    expect(h.plans.updatePlanStatus.mock.calls[0][3]).toBe('OUTLINE_GENERATING');
    expect(h.audit.insertAudit.mock.calls[0][1]).toMatchObject({
      action: 'TOC_JOB_REQUESTED',
      resourceType: 'GENERATION_JOB',
      resourceId: JOB_ID,
    });
  });

  it('rejects a plan without a confirmed snapshot with 412 PLAN-412-001', async () => {
    const h = harness({ plan: planRow({ status: 'DRAFT', currentContextSnapshotId: null }) });
    await expect(
      h.service.requestTocJob(auth, PLAN_ID, { contextSnapshotId: SNAPSHOT_ID }, 'k', meta),
    ).rejects.toMatchObject({ status: 412, code: 'PLAN-412-001' });
  });

  it('rejects a superseded contextSnapshotId with 400 PLAN-4001', async () => {
    const h = harness();
    await expect(
      h.service.requestTocJob(
        auth,
        PLAN_ID,
        { contextSnapshotId: '99999999-9999-9999-9999-999999999999' },
        'k',
        meta,
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: 'PLAN-4001',
      violations: [expect.objectContaining({ field: 'contextSnapshotId' })],
    });
  });

  it('rejects a second job while one is in flight with 409 PLAN-409-002 naming the job', async () => {
    const h = harness({ activeJob: jobRow({ status: 'RUNNING' }) });
    await expect(
      h.service.requestTocJob(auth, PLAN_ID, { contextSnapshotId: SNAPSHOT_ID }, 'k', meta),
    ).rejects.toMatchObject({
      status: 409,
      code: 'PLAN-409-002',
      recoverable: true,
      userAction: expect.stringContaining(JOB_ID),
    });
  });

  it('rejects a start from a non-startable status with 412 PLAN-412-002 (orphaned OUTLINE_GENERATING)', async () => {
    const h = harness({ plan: planRow({ status: 'OUTLINE_GENERATING' }) });
    await expect(
      h.service.requestTocJob(auth, PLAN_ID, { contextSnapshotId: SNAPSHOT_ID }, 'k', meta),
    ).rejects.toMatchObject({ status: 412, code: 'PLAN-412-002' });
  });

  it('blocks trashed and approval-locked plans with 412 PLAN-412-002', async () => {
    const trashed = harness({ plan: planRow({ deletedAt: new Date() }) });
    await expect(
      trashed.service.requestTocJob(auth, PLAN_ID, { contextSnapshotId: SNAPSHOT_ID }, 'k', meta),
    ).rejects.toMatchObject({ status: 412, code: 'PLAN-412-002' });
    const approved = harness({ plan: planRow({ status: 'APPROVED' }) });
    await expect(
      approved.service.requestTocJob(auth, PLAN_ID, { contextSnapshotId: SNAPSHOT_ID }, 'k', meta),
    ).rejects.toMatchObject({ status: 412, code: 'PLAN-412-002' });
  });

  it('returns 404 PLAN-4003 for an unknown plan', async () => {
    const h = harness({ plan: null });
    await expect(
      h.service.requestTocJob(auth, PLAN_ID, { contextSnapshotId: SNAPSHOT_ID }, 'k', meta),
    ).rejects.toMatchObject({ status: 404, code: 'PLAN-4003' });
  });

  it('falls back to the existing job on a uk_job_idempotency (23505) collision', async () => {
    const h = harness();
    const existing = jobRow({ status: 'RUNNING' });
    h.jobs.insertJob.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );
    h.jobs.findJobByIdempotencyKey.mockResolvedValueOnce(existing);
    const result = await h.service.requestTocJob(
      auth,
      PLAN_ID,
      { contextSnapshotId: SNAPSHOT_ID },
      'client-key-1',
      meta,
    );
    expect(result).toMatchObject({ jobId: JOB_ID, status: 'RUNNING' });
    // The replay must not double-append events, re-move the plan, or re-audit.
    expect(h.events.append).not.toHaveBeenCalled();
    expect(h.plans.updatePlanStatus).not.toHaveBeenCalled();
    expect(h.audit.insertAudit).not.toHaveBeenCalled();
    // The failed INSERT is undone by a savepoint so the transaction survives.
    const statements = h.query.mock.calls.map((call) => call[0]);
    expect(statements).toContain('SAVEPOINT une_job_insert');
    expect(statements).toContain('ROLLBACK TO SAVEPOINT une_job_insert');
  });

  it('re-throws a unique violation that does not resolve to an existing job', async () => {
    const h = harness();
    h.jobs.insertJob.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: '23505' }),
    );
    await expect(
      h.service.requestTocJob(auth, PLAN_ID, { contextSnapshotId: SNAPSHOT_ID }, 'k', meta),
    ).rejects.toThrow('duplicate');
  });
});

describe('TocJobService.getJob', () => {
  it('returns 404 JOB-404-001 for an unknown job', async () => {
    const h = harness({ job: null });
    await expect(h.service.getJob(auth, JOB_ID)).rejects.toMatchObject({
      status: 404,
      code: 'JOB-404-001',
    });
  });

  it('projects result from the terminal job.completed event only when COMPLETED', async () => {
    const h = harness({ job: jobRow({ status: 'COMPLETED' }) });
    h.events.findCompletedResult.mockResolvedValueOnce({
      tocVersionId: TOC_VERSION_ID,
      tocVersionNo: 3,
      internalTrace: 'ignored',
    });
    await expect(h.service.getJob(auth, JOB_ID)).resolves.toMatchObject({
      status: 'COMPLETED',
      result: { tocVersionId: TOC_VERSION_ID, tocVersionNo: 3 },
    });

    const running = harness({ job: jobRow({ status: 'RUNNING' }) });
    await expect(running.service.getJob(auth, JOB_ID)).resolves.toMatchObject({ result: null });
    expect(running.events.findCompletedResult).not.toHaveBeenCalled();
  });
});

describe('TocJobService.cancelJob', () => {
  it('cancels a QUEUED job outright and returns the plan to CONTEXT_READY', async () => {
    const h = harness({ job: jobRow({ status: 'QUEUED' }) });
    const result = await h.service.cancelJob(auth, JOB_ID, '오입력', meta);
    expect(result.status).toBe('CANCELLED');
    expect(h.jobs.updateJobStatus.mock.calls[0][3]).toMatchObject({ status: 'CANCELLED' });
    expect(h.plans.updatePlanStatus.mock.calls[0][3]).toBe('CONTEXT_READY');
    expect(h.events.append.mock.calls[0][2]).toBe('job.cancelled');
    expect(h.audit.insertAudit.mock.calls[0][1]).toMatchObject({ action: 'TOC_JOB_CANCELLED' });
  });

  it('returns a plan that already has an outline to OUTLINE_REVIEW (기존 산출물 보존)', async () => {
    const h = harness({ job: jobRow({ status: 'QUEUED' }) });
    h.plans.findPlan.mockResolvedValue(planRow({ currentTocVersionId: TOC_VERSION_ID }));
    await h.service.cancelJob(auth, JOB_ID, undefined, meta);
    expect(h.plans.updatePlanStatus.mock.calls[0][3]).toBe('OUTLINE_REVIEW');
  });

  it('only requests cancellation for a RUNNING job (the worker settles it)', async () => {
    const h = harness({ job: jobRow({ status: 'RUNNING' }) });
    const result = await h.service.cancelJob(auth, JOB_ID, undefined, meta);
    expect(result.status).toBe('CANCEL_REQUESTED');
    expect(h.plans.updatePlanStatus).not.toHaveBeenCalled();
    expect(h.events.append.mock.calls[0][2]).toBe('job.cancel_requested');
    expect(h.audit.insertAudit.mock.calls[0][1]).toMatchObject({
      action: 'TOC_JOB_CANCEL_REQUESTED',
    });
  });

  it.each(['CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED'])(
    'rejects cancelling a %s job with 409 JOB-409-001',
    async (status) => {
      const h = harness({ job: jobRow({ status }) });
      await expect(h.service.cancelJob(auth, JOB_ID, undefined, meta)).rejects.toMatchObject({
        status: 409,
        code: 'JOB-409-001',
      });
    },
  );

  it('returns 404 JOB-404-001 for an unknown job', async () => {
    const h = harness({ job: null });
    await expect(h.service.cancelJob(auth, JOB_ID, undefined, meta)).rejects.toMatchObject({
      status: 404,
      code: 'JOB-404-001',
    });
  });
});

describe('TocJobService.retryJob', () => {
  it('rejects blockIds with 400 PLAN-4001 before touching the database', async () => {
    const h = harness({ job: jobRow({ status: 'FAILED' }) });
    await expect(
      h.service.retryJob(auth, JOB_ID, { blockIds: [TOC_VERSION_ID] }, meta),
    ).rejects.toMatchObject({
      status: 400,
      code: 'PLAN-4001',
      violations: [expect.objectContaining({ field: 'blockIds' })],
    });
    expect(h.jobs.findJob).not.toHaveBeenCalled();
  });

  it('requeues a FAILED job, clears the failure, resets the attempt budget and re-enters OUTLINE_GENERATING', async () => {
    const h = harness({ job: jobRow({ status: 'FAILED', errorJson: { code: 'T3Q-502-001' } }) });
    const result = await h.service.retryJob(auth, JOB_ID, { reason: '재시도' }, meta);
    expect(result.status).toBe('QUEUED');
    expect(h.jobs.updateJobStatus.mock.calls[0][3]).toEqual({
      status: 'QUEUED',
      errorJson: null,
      progressPct: 0,
      finishedAt: null,
      // User-driven retry must not inherit an exhausted lease-reclaim budget
      // (review minor 5).
      attemptNo: 0,
    });
    expect(h.plans.updatePlanStatus.mock.calls[0][3]).toBe('OUTLINE_GENERATING');
    expect(h.events.append.mock.calls[0][2]).toBe('job.retry_requested');
    expect(h.audit.insertAudit.mock.calls[0][1]).toMatchObject({ action: 'TOC_JOB_RETRIED' });
  });

  it('re-applies the plan preconditions: trashed or approval-locked plans cannot regrow an outline (QA 필수-2)', async () => {
    const trashed = harness({
      job: jobRow({ status: 'FAILED' }),
      plan: planRow({ deletedAt: new Date() }),
    });
    await expect(trashed.service.retryJob(auth, JOB_ID, {}, meta)).rejects.toMatchObject({
      status: 412,
      code: 'PLAN-412-002',
    });

    const locked = harness({
      job: jobRow({ status: 'FAILED' }),
      plan: planRow({ status: 'APPROVED' }),
    });
    await expect(locked.service.retryJob(auth, JOB_ID, {}, meta)).rejects.toMatchObject({
      status: 412,
      code: 'PLAN-412-002',
    });
  });

  it('refuses retry while another TOC job is active (QA 필수-3)', async () => {
    const h = harness({
      job: jobRow({ status: 'FAILED' }),
      activeJob: jobRow({ jobId: 'a0000000-0000-4000-8000-000000000001', status: 'RUNNING' }),
    });
    await expect(h.service.retryJob(auth, JOB_ID, {}, meta)).rejects.toMatchObject({
      status: 409,
      code: 'PLAN-409-002',
    });
  });

  it.each(['QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'CANCELLED'])(
    'rejects retrying a %s job with 409 JOB-409-002',
    async (status) => {
      const h = harness({ job: jobRow({ status }) });
      await expect(h.service.retryJob(auth, JOB_ID, {}, meta)).rejects.toMatchObject({
        status: 409,
        code: 'JOB-409-002',
      });
    },
  );

  it('returns 404 JOB-404-001 for an unknown job', async () => {
    const h = harness({ job: null });
    await expect(h.service.retryJob(auth, JOB_ID, {}, meta)).rejects.toMatchObject({
      status: 404,
      code: 'JOB-404-001',
    });
  });
});
