import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  APPROVAL_LOCKED_STATUSES,
  buildContentJobRequest,
  canStartContentJob,
  jobIdempotencyKey,
  nextStatusOnContentJobStart,
} from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { GeneratedBlockRepository } from './generated-block.repository';
import { GenerationJobRepository, type JobRow } from './generation-job.repository';
import { JobEventRepository } from './job-event.repository';
import { PlanRepository } from './plan.repository';
import { planErrors, type RequestMeta } from './plan.service';
import { tocErrors } from './toc-errors';
import { TocVersionRepository } from './toc-version.repository';
import { toJobResource, type JobResource } from './toc-job.service';

export interface ContentJobRequestBody {
  contextSnapshotId: string;
  tocVersionId: string;
  protectedBlockIds?: string[];
  targetNodeKeys?: string[];
}

const CONTENT_JOB_ENDPOINT_TEMPLATE = 'POST /plans/{planId}/content-jobs';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** UNE-PLAN-016 (CC-130, ADR-27). The API only enqueues: provider calls,
 * RUNNING and the terminal states belong to the ContentJobRunner. One
 * transaction: plan lock -> preconditions -> protection persist -> job
 * insert -> job.queued -> plan status -> audit. */
@Injectable()
export class ContentJobService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PlanRepository) private readonly plans: PlanRepository,
    @Inject(TocVersionRepository) private readonly tocVersions: TocVersionRepository,
    @Inject(GeneratedBlockRepository) private readonly blocks: GeneratedBlockRepository,
    @Inject(GenerationJobRepository) private readonly jobs: GenerationJobRepository,
    @Inject(JobEventRepository) private readonly jobEvents: JobEventRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  async requestContentJob(
    auth: AuthContext,
    planId: string,
    body: ContentJobRequestBody,
    clientIdempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<JobResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const plan = await this.plans.findPlan(c, auth.tenantId, planId, { forUpdate: true });
      if (!plan) throw planErrors.notFound();
      if (plan.deletedAt) {
        throw planErrors.preconditionFailed('휴지통의 계획서는 본문을 생성할 수 없습니다.');
      }
      if (APPROVAL_LOCKED_STATUSES.has(plan.status)) {
        throw planErrors.preconditionFailed(
          `현재 상태(${plan.status})에서는 본문을 생성할 수 없습니다.`,
        );
      }
      if (!plan.currentContextSnapshotId) throw tocErrors.snapshotRequired();
      if (body.contextSnapshotId !== plan.currentContextSnapshotId) {
        throw planErrors.invalidRequest([
          { field: 'contextSnapshotId', reason: '현재 확정 Snapshot이 아닙니다.' },
        ]);
      }
      if (!plan.currentTocVersionId) {
        throw planErrors.preconditionFailed(
          '확정된 목차가 없습니다 — 목차를 확정한 뒤 본문을 생성하십시오.',
        );
      }

      const version = await this.tocVersions.findVersionMeta(c, auth.tenantId, body.tocVersionId);
      if (!version || version.planId !== planId) throw tocErrors.versionNotFound();
      if (body.tocVersionId !== plan.currentTocVersionId) {
        throw planErrors.preconditionFailed(
          '요청한 목차 버전이 현재 확정 목차가 아닙니다 — 최신 목차로 다시 요청하십시오.',
        );
      }
      // Explicit CONFIRMED check (review m-3): today canStartContentJob makes
      // an unconfirmed current version unreachable, but that is incidental —
      // the contract requires 412 on an unconfirmed outline directly.
      if (version.status !== 'CONFIRMED') {
        throw planErrors.preconditionFailed(
          '확정되지 않은 목차 버전입니다 — 목차를 확정한 뒤 본문을 생성하십시오.',
        );
      }

      const active = await this.jobs.findActivePlanJob(c, auth.tenantId, planId);
      if (active) throw tocErrors.activeJobExists(active.jobId);
      if (!canStartContentJob(plan.status)) {
        throw planErrors.preconditionFailed(
          `현재 상태(${plan.status})에서는 본문 생성을 시작할 수 없습니다.`,
        );
      }

      // targetNodeKeys must exist in the confirmed outline — 422 (semantic,
      // contract; review M-3/F1). The worker re-validates against the
      // manifest (defense in depth); format errors are a controller 400.
      if (body.targetNodeKeys && body.targetNodeKeys.length > 0) {
        const nodes = await this.tocVersions.listNodes(c, auth.tenantId, body.tocVersionId);
        const known = new Set(nodes.map((node) => node.nodeKey));
        const missing = body.targetNodeKeys.filter((key) => !known.has(key));
        if (missing.length > 0) throw tocErrors.targetNodeUnknown(missing);
      }

      // Protection declarations are PERSISTED before the job exists (ADR-27
      // D4): even if the enqueue fails later, a user-lock is never lost.
      if (body.protectedBlockIds && body.protectedBlockIds.length > 0) {
        const found = await this.blocks.findCurrentByIds(c, planId, body.protectedBlockIds);
        const foundIds = new Set(found.map((block) => block.blockId));
        const unknown = body.protectedBlockIds.filter((id) => !foundIds.has(id));
        if (unknown.length > 0) {
          throw tocErrors.protectedBlockUnknown(unknown);
        }
        const marked = await this.blocks.markProtected(c, planId, body.protectedBlockIds);
        const alreadyProtected = found.filter((block) => block.protectionState !== 'NONE').length;
        if (marked + alreadyProtected !== body.protectedBlockIds.length) {
          // Rows verified above cannot vanish inside this tx (plan is held
          // FOR UPDATE) — a mismatch is an invariant break, never a no-op
          // (review m-5: "protection must never silently no-op").
          throw new Error(
            `protection no-op: expected ${body.protectedBlockIds.length}, marked ${marked}, already ${alreadyProtected}`,
          );
        }
      }

      const snapshot = await this.plans.findSnapshot(
        c,
        auth.tenantId,
        plan.currentContextSnapshotId,
      );
      if (!snapshot) throw tocErrors.snapshotRequired();

      const requestJson = buildContentJobRequest({
        snapshotId: snapshot.contextSnapshotId,
        contextHash: snapshot.contentHash,
        tocVersionId: body.tocVersionId,
        tocContentHash: version.contentHash,
        requestedBy: auth.userId,
        targetNodeKeys: body.targetNodeKeys,
      });

      const idempotencyKey = jobIdempotencyKey(
        'CONTENT',
        CONTENT_JOB_ENDPOINT_TEMPLATE,
        planId,
        clientIdempotencyKey ?? randomUUID(),
      );

      await c.query('SAVEPOINT une_job_insert');
      let job: JobRow;
      try {
        job = await this.jobs.insertJob(c, {
          tenantId: auth.tenantId,
          jobType: 'CONTENT',
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
        if (existing.aggregateId !== planId || existing.jobType !== 'CONTENT') {
          throw tocErrors.idempotencyScopeMismatch();
        }
        return toJobResource(existing);
      }

      await this.jobEvents.append(c, job.jobId, 'job.queued', {
        planId,
        snapshotId: snapshot.contextSnapshotId,
        tocVersionId: body.tocVersionId,
        ...(body.targetNodeKeys?.length ? { targetNodeKeys: body.targetNodeKeys } : {}),
      });
      await this.plans.updatePlanStatus(c, auth.tenantId, planId, nextStatusOnContentJobStart());
      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'CONTENT_JOB_REQUESTED',
        resourceType: 'GENERATION_JOB',
        resourceId: job.jobId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: {
          planId,
          snapshotId: snapshot.contextSnapshotId,
          tocVersionId: body.tocVersionId,
          protectedBlocks: body.protectedBlockIds?.length ?? 0,
          targetNodeKeys: body.targetNodeKeys?.length ?? 0,
        },
      });
      return toJobResource(job);
    });
  }
}
