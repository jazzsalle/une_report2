import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  APPROVAL_LOCKED_STATUSES,
  buildTocJobRequest,
  canStartTocJob,
  canTransitionJob,
  jobIdempotencyKey,
  nextStatusOnTocJobAbort,
  nextStatusOnTocJobStart,
  type TocJobGenerationOption,
} from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { GenerationJobRepository, type JobRow } from './generation-job.repository';
import { JobEventRepository } from './job-event.repository';
import { PlanRepository, type PlanRow } from './plan.repository';
import { planErrors, type RequestMeta } from './plan.service';
import { jobErrors, tocErrors } from './toc-errors';

/** Contract GenerationJobResource (dates ISO-8601 UTC). */
export interface JobResource {
  jobId: string;
  jobType: string;
  aggregateType: string;
  aggregateId: string;
  providerCode: string;
  status: string;
  progressPct: number;
  attemptNo: number;
  correlationId: string;
  error: Record<string, unknown> | null;
  result: { tocVersionId: string; tocVersionNo: number } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TocJobRequestBody {
  contextSnapshotId: string;
  generationOption?: TocJobGenerationOption;
}

const TOC_JOB_ENDPOINT_TEMPLATE = 'POST /plans/{planId}/toc-jobs';

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** JobRow -> contract resource. `result` is projected by the caller from the
 * terminal job.completed event (generation_job has no result column). */
export function toJobResource(row: JobRow, result: JobResource['result'] = null): JobResource {
  return {
    jobId: row.jobId,
    jobType: row.jobType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    providerCode: row.providerCode,
    status: row.status,
    progressPct: row.progressPct,
    attemptNo: row.attemptNo,
    correlationId: row.correlationId,
    error: row.errorJson,
    result,
    createdAt: iso(row.createdAt) as string,
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Only the two contract fields are echoed back; the worker may record more
 * bookkeeping in the same event payload. */
function projectResult(payload: Record<string, unknown> | null): JobResource['result'] {
  if (!payload) return null;
  const tocVersionId = payload.tocVersionId;
  const tocVersionNo = payload.tocVersionNo;
  if (typeof tocVersionId !== 'string' || typeof tocVersionNo !== 'number') return null;
  return { tocVersionId, tocVersionNo };
}

/** UNE-PLAN-009 / 010 / 012 / 013. The API only ever enqueues and requests
 * cancellation; provider calls, RUNNING and the terminal states belong to the
 * worker (external calls never run inside these transactions). */
@Injectable()
export class TocJobService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanRepository) private readonly plans: PlanRepository,
    @Inject(GenerationJobRepository) private readonly jobs: GenerationJobRepository,
    @Inject(JobEventRepository) private readonly jobEvents: JobEventRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** UNE-PLAN-009. One transaction: plan lock -> preconditions -> job insert ->
   * job.queued event -> plan status -> audit. */
  async requestTocJob(
    auth: AuthContext,
    planId: string,
    body: TocJobRequestBody,
    clientIdempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<JobResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const plan = await this.plans.findPlan(c, auth.tenantId, planId, { forUpdate: true });
      if (!plan) throw planErrors.notFound();
      if (plan.deletedAt) {
        throw planErrors.preconditionFailed('휴지통의 계획서는 목차를 생성할 수 없습니다.');
      }
      if (APPROVAL_LOCKED_STATUSES.has(plan.status)) {
        throw planErrors.preconditionFailed(
          `현재 상태(${plan.status})에서는 목차를 생성할 수 없습니다.`,
        );
      }
      if (!plan.currentContextSnapshotId) throw tocErrors.snapshotRequired();
      if (body.contextSnapshotId !== plan.currentContextSnapshotId) {
        // Generating from a superseded snapshot would produce an outline that
        // no longer matches the plan's authoritative facts.
        throw planErrors.invalidRequest([
          { field: 'contextSnapshotId', reason: '현재 확정 Snapshot이 아닙니다.' },
        ]);
      }
      const active = await this.jobs.findActiveTocJob(c, auth.tenantId, planId);
      if (active) throw tocErrors.activeJobExists(active.jobId);
      if (!canStartTocJob(plan.status)) {
        // Includes the orphaned OUTLINE_GENERATING case (status says a job is
        // running but none is): the operator must settle it explicitly.
        throw planErrors.preconditionFailed(
          `현재 상태(${plan.status})에서는 목차 생성을 시작할 수 없습니다.`,
        );
      }

      const snapshot = await this.plans.findSnapshot(
        c,
        auth.tenantId,
        plan.currentContextSnapshotId,
      );
      if (!snapshot) throw tocErrors.snapshotRequired();
      const requestJson = buildTocJobRequest({
        snapshotId: snapshot.contextSnapshotId,
        contextHash: snapshot.contentHash,
        requestedBy: auth.userId,
        generationOption: body.generationOption,
      });

      // The interceptor already rejected a missing header (@Idempotent
      // required); randomUUID is a defensive fallback so the NOT NULL column
      // can never be violated.
      const idempotencyKey = jobIdempotencyKey(
        'TOC',
        TOC_JOB_ENDPOINT_TEMPLATE,
        planId,
        clientIdempotencyKey ?? randomUUID(),
      );

      // Second idempotency net behind api_idempotency: a stale claim can be
      // taken over (ADR-23 D1), which would otherwise enqueue a duplicate job.
      // The SAVEPOINT keeps the outer transaction usable after the 23505.
      await c.query('SAVEPOINT une_job_insert');
      let job: JobRow;
      try {
        job = await this.jobs.insertJob(c, {
          tenantId: auth.tenantId,
          jobType: 'TOC',
          aggregateType: 'PLAN',
          aggregateId: planId,
          providerCode: 'T3Q',
          requestJson,
          idempotencyKey,
          correlationId: meta.correlationId,
        });
        await c.query('RELEASE SAVEPOINT une_job_insert');
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        await c.query('ROLLBACK TO SAVEPOINT une_job_insert');
        const existing = await this.jobs.findJobByIdempotencyKey(c, auth.tenantId, idempotencyKey);
        if (!existing) throw err;
        // Defensive (review M2): the key already binds planId+jobType, so a
        // mismatch here means a hash-scope bug — refuse rather than hand back
        // another aggregate's job.
        if (existing.aggregateId !== planId || existing.jobType !== 'TOC') {
          throw tocErrors.idempotencyScopeMismatch();
        }
        return toJobResource(existing);
      }

      await this.jobEvents.append(c, job.jobId, 'job.queued', {
        planId,
        snapshotId: snapshot.contextSnapshotId,
      });
      await this.plans.updatePlanStatus(c, auth.tenantId, planId, nextStatusOnTocJobStart());
      await this.insertJobAudit(c, auth, meta, 'TOC_JOB_REQUESTED', job.jobId, {
        planId,
        snapshotId: snapshot.contextSnapshotId,
      });
      return toJobResource(job);
    });
  }

  /** UNE-PLAN-010. */
  async getJob(auth: AuthContext, jobId: string): Promise<JobResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const job = await this.jobs.findJob(c, auth.tenantId, jobId);
      if (!job) throw jobErrors.notFound();
      const result =
        job.status === 'COMPLETED'
          ? projectResult(await this.jobEvents.findCompletedResult(c, auth.tenantId, jobId))
          : null;
      return toJobResource(job, result);
    });
  }

  /** UNE-PLAN-012. QUEUED settles immediately (no worker owns it yet);
   * RUNNING only records the request — the worker's checkpoint settles it. */
  async cancelJob(
    auth: AuthContext,
    jobId: string,
    reason: string | undefined,
    meta: RequestMeta,
  ): Promise<JobResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      // Lock order job -> plan. requestTocJob locks plan and never locks an
      // existing job row, so the two paths cannot form a cycle.
      const job = await this.jobs.findJob(c, auth.tenantId, jobId, { forUpdate: true });
      if (!job) throw jobErrors.notFound();

      if (job.status === 'QUEUED' && canTransitionJob(job.status, 'CANCELLED')) {
        const updated = await this.jobs.updateJobStatus(c, auth.tenantId, jobId, {
          status: 'CANCELLED',
          finishedAt: new Date(),
        });
        await this.restorePlanStatusOnAbort(c, auth, job);
        await this.jobEvents.append(c, jobId, 'job.cancelled', { reason: reason ?? null });
        await this.insertJobAudit(c, auth, meta, 'TOC_JOB_CANCELLED', jobId, {
          reason: reason ?? null,
          previousStatus: job.status,
        });
        return toJobResource(updated ?? job);
      }

      if (job.status === 'RUNNING' && canTransitionJob(job.status, 'CANCEL_REQUESTED')) {
        const updated = await this.jobs.updateJobStatus(c, auth.tenantId, jobId, {
          status: 'CANCEL_REQUESTED',
        });
        await this.jobEvents.append(c, jobId, 'job.cancel_requested', { reason: reason ?? null });
        await this.insertJobAudit(c, auth, meta, 'TOC_JOB_CANCEL_REQUESTED', jobId, {
          reason: reason ?? null,
          previousStatus: job.status,
        });
        return toJobResource(updated ?? job);
      }

      // CANCEL_REQUESTED (already in flight) and the terminal states.
      throw jobErrors.cancelNotAllowed(job.status);
    });
  }

  /** UNE-PLAN-013. TOC generation is whole-outline only; per-block retry is
   * the RPT-002 content job (CC-130). attempt_no is NOT bumped here — the
   * worker increments it when it claims the requeued job. */
  async retryJob(
    auth: AuthContext,
    jobId: string,
    body: { reason?: string; blockIds?: unknown },
    meta: RequestMeta,
  ): Promise<JobResource> {
    if (body.blockIds !== undefined && body.blockIds !== null) {
      throw planErrors.invalidRequest([
        { field: 'blockIds', reason: 'TOC job은 전체 단위 재시도만 지원합니다(CC-130).' },
      ]);
    }
    return this.db.withTenant(auth.tenantId, async (c) => {
      const job = await this.jobs.findJob(c, auth.tenantId, jobId, { forUpdate: true });
      if (!job) throw jobErrors.notFound();
      if (job.status !== 'FAILED' || !canTransitionJob(job.status, 'QUEUED')) {
        throw jobErrors.retryNotAllowed(job.status);
      }
      // Retry re-enters generation and must pass the same plan preconditions
      // as UNE-PLAN-009 (QA review 필수-2/3: a trashed/approval-locked plan
      // must not regrow an outline, and the one-active-job invariant holds).
      const plan = await this.plans.findPlan(c, auth.tenantId, job.aggregateId, {
        forUpdate: true,
      });
      if (!plan) throw planErrors.notFound();
      if (plan.deletedAt) {
        throw planErrors.preconditionFailed('휴지통의 계획서는 목차를 재생성할 수 없습니다.');
      }
      if (APPROVAL_LOCKED_STATUSES.has(plan.status)) {
        throw planErrors.preconditionFailed(
          `현재 상태(${plan.status})에서는 목차를 재생성할 수 없습니다.`,
        );
      }
      const active = await this.jobs.findActiveTocJob(c, auth.tenantId, plan.planId);
      if (active) throw tocErrors.activeJobExists(active.jobId);

      const updated = await this.jobs.updateJobStatus(c, auth.tenantId, jobId, {
        status: 'QUEUED',
        errorJson: null,
        progressPct: 0,
        finishedAt: null,
        // User-driven retry gets a fresh automatic-retry budget: lease
        // reclaims may have exhausted attempt_no already (review minor 5).
        attemptNo: 0,
      });
      await this.plans.updatePlanStatus(c, auth.tenantId, plan.planId, nextStatusOnTocJobStart());
      await this.jobEvents.append(c, jobId, 'job.retry_requested', {
        reason: body.reason ?? null,
      });
      await this.insertJobAudit(c, auth, meta, 'TOC_JOB_RETRIED', jobId, {
        planId: plan.planId,
        reason: body.reason ?? null,
        attemptBudgetReset: true,
      });
      return toJobResource(updated ?? job);
    });
  }

  /** Cancel/failure never sends the plan to ERROR: it returns to where it was,
   * derived from whether an outline already exists (US-PLAN-009 E-02). */
  private async restorePlanStatusOnAbort(
    client: PoolClient,
    auth: AuthContext,
    job: JobRow,
  ): Promise<PlanRow | null> {
    const plan = await this.plans.findPlan(client, auth.tenantId, job.aggregateId, {
      forUpdate: true,
    });
    if (!plan) throw planErrors.notFound();
    return this.plans.updatePlanStatus(
      client,
      auth.tenantId,
      plan.planId,
      nextStatusOnTocJobAbort(!!plan.currentTocVersionId),
    );
  }

  private async insertJobAudit(
    client: PoolClient,
    auth: AuthContext,
    meta: RequestMeta,
    action: string,
    jobId: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.insertAudit(client, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action,
      resourceType: 'GENERATION_JOB',
      resourceId: jobId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail,
    });
  }
}
