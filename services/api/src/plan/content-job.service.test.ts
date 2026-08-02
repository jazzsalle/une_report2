import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../common/request-context';
import type { AuditRepository } from '../common/audit.repository';
import type { DatabaseService } from '../db/database.service';
import type { GeneratedBlockRepository } from './generated-block.repository';
import type { GenerationJobRepository, JobRow } from './generation-job.repository';
import type { JobEventRepository } from './job-event.repository';
import type { PlanRepository, PlanRow } from './plan.repository';
import type { RequestMeta } from './plan.service';
import type { TocVersionRepository } from './toc-version.repository';
import { ContentJobService } from './content-job.service';

const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_ID = '44444444-4444-4444-4444-444444444444';
const SNAPSHOT_ID = '55555555-5555-5555-5555-555555555555';
const JOB_ID = '66666666-6666-6666-6666-666666666666';
const TOC_VERSION_ID = '77777777-7777-7777-7777-777777777777';
const BLOCK_ID = '88888888-8888-8888-8888-888888888888';
const CONTENT_HASH = 'a'.repeat(64);

const auth: AuthContext = { userId: USER_ID, tenantId: TENANT_ID, sessionId: USER_ID };
const meta: RequestMeta = { correlationId: 'corr_test' };

const BODY = { contextSnapshotId: SNAPSHOT_ID, tocVersionId: TOC_VERSION_ID };

function planRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    planId: PLAN_ID,
    tenantId: TENANT_ID,
    title: '계획서',
    hazardType: '호우',
    managementPhase: '예방',
    status: 'OUTLINE_CONFIRMED',
    startMode: 'BLANK',
    documentId: null,
    currentContextSnapshotId: SNAPSHOT_ID,
    currentTocVersionId: TOC_VERSION_ID,
    ownerId: USER_ID,
    versionNo: 1,
    deletedAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as PlanRow;
}

function jobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    jobId: JOB_ID,
    tenantId: TENANT_ID,
    jobType: 'CONTENT',
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
  } as JobRow;
}

function harness(
  overrides: {
    plan?: PlanRow | null;
    activeJob?: JobRow | null;
    versionMeta?: { tocVersionId: string; planId: string; contentHash: string } | null;
    versionStatus?: string;
    currentBlocks?: { blockId: string; nodeKey: string; protectionState: string }[];
    insertThrows?: unknown;
    existingByKey?: JobRow | null;
  } = {},
) {
  const query = vi.fn(async () => ({ rows: [] }));
  const db = {
    withTenant: vi.fn(async (_tenant: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({ query }),
    ),
  };
  const plans = {
    findPlan: vi.fn(async () => ('plan' in overrides ? overrides.plan : planRow())),
    findSnapshot: vi.fn(async () => ({
      contextSnapshotId: SNAPSHOT_ID,
      planId: PLAN_ID,
      versionNo: 1,
      contextJson: {},
      contentHash: CONTENT_HASH,
      confirmedBy: USER_ID,
      confirmedAt: new Date('2026-08-01T00:00:00Z'),
    })),
    updatePlanStatus: vi.fn(async () => planRow({ status: 'CONTENT_GENERATING' })),
  };
  const tocVersions = {
    findVersionMeta: vi.fn(async () =>
      'versionMeta' in overrides
        ? overrides.versionMeta
        : {
            tocVersionId: TOC_VERSION_ID,
            planId: PLAN_ID,
            baseSnapshotId: SNAPSHOT_ID,
            contentHash: CONTENT_HASH,
            status: overrides.versionStatus ?? 'CONFIRMED',
          },
    ),
    listNodes: vi.fn(async () => [{ nodeKey: 'n-1' }, { nodeKey: 'n-1-1' }, { nodeKey: 'n-2' }]),
  };
  const blocks = {
    findCurrentByIds: vi.fn(async () => overrides.currentBlocks ?? []),
    markProtected: vi.fn(async () => overrides.currentBlocks?.length ?? 0),
    hasCurrentBlocks: vi.fn(async () => false),
  };
  const jobs = {
    findActivePlanJob: vi.fn(async () => overrides.activeJob ?? null),
    insertJob: vi.fn(async () => {
      if (overrides.insertThrows) throw overrides.insertThrows;
      return jobRow();
    }),
    findJobByIdempotencyKey: vi.fn(async () =>
      'existingByKey' in overrides ? overrides.existingByKey : null,
    ),
  };
  const events = { append: vi.fn(async () => 1) };
  const audit = { insertAudit: vi.fn(async () => undefined) };
  const service = new ContentJobService(
    db as unknown as DatabaseService,
    plans as unknown as PlanRepository,
    tocVersions as unknown as TocVersionRepository,
    blocks as unknown as GeneratedBlockRepository,
    jobs as unknown as GenerationJobRepository,
    events as unknown as JobEventRepository,
    audit as unknown as AuditRepository,
  );
  return { service, plans, tocVersions, blocks, jobs, events, audit, query };
}

describe('ContentJobService.requestContentJob (UNE-PLAN-016)', () => {
  it('enqueues, persists protections, appends job.queued, moves the plan, audits', async () => {
    const h = harness({
      currentBlocks: [{ blockId: BLOCK_ID, nodeKey: 'n-2', protectionState: 'NONE' }],
    });
    const result = await h.service.requestContentJob(
      auth,
      PLAN_ID,
      { ...BODY, protectedBlockIds: [BLOCK_ID], targetNodeKeys: ['n-1'] },
      'client-key',
      meta,
    );
    expect(result.status).toBe('QUEUED');
    expect(h.blocks.markProtected).toHaveBeenCalledWith(expect.anything(), PLAN_ID, [BLOCK_ID]);
    expect(h.jobs.insertJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobType: 'CONTENT',
        requestJson: expect.objectContaining({
          tocVersionId: TOC_VERSION_ID,
          tocContentHash: CONTENT_HASH,
          targetNodeKeys: ['n-1'],
        }),
      }),
    );
    expect(h.events.append).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
      'job.queued',
      expect.objectContaining({ tocVersionId: TOC_VERSION_ID }),
    );
    expect(h.plans.updatePlanStatus).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      PLAN_ID,
      'CONTENT_GENERATING',
    );
    expect(h.audit.insertAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'CONTENT_JOB_REQUESTED' }),
    );
  });

  it('requires a confirmed outline (412 PLAN-412-002)', async () => {
    const h = harness({ plan: planRow({ currentTocVersionId: null }) });
    await expect(h.service.requestContentJob(auth, PLAN_ID, BODY, 'k', meta)).rejects.toMatchObject(
      { status: 412, code: 'PLAN-412-002' },
    );
  });

  it('rejects a toc version that is not the current confirmed one (412)', async () => {
    const h = harness({
      plan: planRow({ currentTocVersionId: '99999999-9999-9999-9999-999999999999' }),
    });
    await expect(h.service.requestContentJob(auth, PLAN_ID, BODY, 'k', meta)).rejects.toMatchObject(
      { status: 412, code: 'PLAN-412-002' },
    );
  });

  it('rejects an unknown toc version with 404 TOC-404-001', async () => {
    const h = harness({ versionMeta: null });
    await expect(h.service.requestContentJob(auth, PLAN_ID, BODY, 'k', meta)).rejects.toMatchObject(
      { status: 404, code: 'TOC-404-001' },
    );
  });

  it('rejects a superseded contextSnapshotId with 400 PLAN-4001', async () => {
    const h = harness();
    await expect(
      h.service.requestContentJob(
        auth,
        PLAN_ID,
        { ...BODY, contextSnapshotId: '99999999-9999-9999-9999-999999999999' },
        'k',
        meta,
      ),
    ).rejects.toMatchObject({ status: 400, code: 'PLAN-4001' });
  });

  it('rejects while any generation job is active — job type agnostic (409 PLAN-409-002)', async () => {
    const h = harness({ activeJob: jobRow({ jobType: 'TOC', status: 'RUNNING' }) });
    await expect(h.service.requestContentJob(auth, PLAN_ID, BODY, 'k', meta)).rejects.toMatchObject(
      { status: 409, code: 'PLAN-409-002' },
    );
  });

  it('blocks trashed and approval-locked plans (412 PLAN-412-002)', async () => {
    for (const plan of [
      planRow({ deletedAt: new Date() }),
      planRow({ status: 'APPROVED' }),
      planRow({ status: 'FINAL' }),
    ]) {
      const h = harness({ plan });
      await expect(
        h.service.requestContentJob(auth, PLAN_ID, BODY, 'k', meta),
      ).rejects.toMatchObject({ status: 412, code: 'PLAN-412-002' });
    }
  });

  it('rejects unknown protectedBlockIds with 422 PLAN-422-002 listing each id', async () => {
    const h = harness({ currentBlocks: [] });
    await expect(
      h.service.requestContentJob(
        auth,
        PLAN_ID,
        { ...BODY, protectedBlockIds: [BLOCK_ID] },
        'k',
        meta,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PLAN-422-002',
      violations: [{ field: 'protectedBlockIds', reason: expect.stringContaining(BLOCK_ID) }],
    });
    expect(h.blocks.markProtected).not.toHaveBeenCalled();
  });

  it('rejects targetNodeKeys missing from the outline with 422 PLAN-422-002 (review M-3/F1)', async () => {
    const h = harness();
    await expect(
      h.service.requestContentJob(auth, PLAN_ID, { ...BODY, targetNodeKeys: ['n-9'] }, 'k', meta),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PLAN-422-002',
      violations: [{ field: 'targetNodeKeys', reason: expect.stringContaining('n-9') }],
    });
  });

  it('rejects an unconfirmed current toc version with 412 (review m-3)', async () => {
    const h = harness({ versionStatus: 'DRAFT' });
    await expect(h.service.requestContentJob(auth, PLAN_ID, BODY, 'k', meta)).rejects.toMatchObject(
      { status: 412, code: 'PLAN-412-002' },
    );
  });

  it('falls back to the existing job on a uk_job_idempotency (23505) collision', async () => {
    const h = harness({
      insertThrows: Object.assign(new Error('duplicate'), { code: '23505' }),
      existingByKey: jobRow(),
    });
    const result = await h.service.requestContentJob(auth, PLAN_ID, BODY, 'k', meta);
    expect(result.jobId).toBe(JOB_ID);
    expect(h.events.append).not.toHaveBeenCalled();
  });

  it('refuses an idempotency fallback whose aggregate/type mismatches (COM-0409)', async () => {
    const h = harness({
      insertThrows: Object.assign(new Error('duplicate'), { code: '23505' }),
      existingByKey: jobRow({ jobType: 'TOC' }),
    });
    await expect(h.service.requestContentJob(auth, PLAN_ID, BODY, 'k', meta)).rejects.toMatchObject(
      { status: 409, code: 'COM-0409' },
    );
  });
});
