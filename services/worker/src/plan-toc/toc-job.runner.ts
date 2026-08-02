import {
  flattenTocTree,
  nextStatusOnTocJobAbort,
  nextStatusOnTocJobSuccess,
  parseTocJobRequest,
  tocTreeContentHash,
  validateTocTree,
  type TocJobRequest,
  type TocNodeDraft,
} from '@une/domain';
import type { T3qPlanTocAdapter, T3qTocResult } from '@une/provider-adapters';
import type { WorkerConfig } from '../config/worker-config';
import type { WorkerDatabase } from '../db/worker-database.service';
import {
  appendJobEvent,
  claimJobs,
  findJobForUpdate,
  findPlanForUpdate,
  findSnapshot,
  insertAudit,
  setJobStatus,
  sweepCancelRequested,
  updatePlanAfterJob,
  type ClaimedJob,
} from '../plan-jobs/job-dispatch.repository';
import { insertTocNodes, insertTocVersion, nextTocVersionNo } from './worker-repositories';

export interface RunSummary {
  claimed: number;
  completed: number;
  failed: number;
  cancelled: number;
  /** Already settled by another worker between claim and processing —
   * counted separately so operational metrics stay honest (review minor 3). */
  skipped: number;
}

interface JobFailure {
  code: 'T3Q-502-001';
  reason: string;
  message: string;
  retryable: boolean;
  providerCode?: string;
}

/** Raw provider payloads are kept for traceability but capped so a runaway
 * response cannot bloat job_event (dedicated trace store re-evaluated and
 * declined — ADR-26 D8; retention policy is CC-430). */
const RAW_PAYLOAD_CAP = 200_000;

/** target-v2 PlanRequestBase requires documentId/baseRevisionId, which do
 * not exist in the UNE plan flow until CC-150 (Revision). These are
 * EXPLICIT mock-only placeholders (ADR-26 D5): the v2 adapter is MOCK_ONLY
 * by the CR-T3Q-* governance invariant, so they can never reach a real
 * provider. Real bindings replace them when CC-150 lands. */
const MOCK_V2_DOCUMENT_ID = 'une-mock:document:pending-cc150';
const MOCK_V2_BASE_REVISION_ID = 'une-mock:revision:pending-cc150';

/**
 * TOC job execution (design 10 §4.2 / §7.9 7-9단계; ADR-25):
 *   tx A  (dispatch scope, no tenant): claim QUEUED + crashed leases
 *   tx B0 (tenant): precondition checks, job.started
 *   —— provider call OUTSIDE any transaction (backend rule) ——
 *   tx B1 (tenant): cancel checkpoint → toc_version pipeline → COMPLETED,
 *                   or FAILED + plan revert. Terminal writes only possible
 *                   here (worker RLS WITH CHECK).
 *
 * runOnce() is timer-free on purpose: tests and the API e2e drive it
 * deterministically; PlanJobPoller adds the production loop.
 */
export class TocJobRunner {
  constructor(
    private readonly db: WorkerDatabase,
    private readonly adapter: T3qPlanTocAdapter,
    private readonly config: WorkerConfig,
  ) {}

  async runOnce(): Promise<RunSummary> {
    const summary: RunSummary = { claimed: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 };

    // Cancel sweep: CANCEL_REQUESTED jobs whose execution never started or
    // whose worker crashed — the live checkpoint cannot reach these.
    const cancelTargets = await this.db.withDispatchScope((client) =>
      sweepCancelRequested(client, 'TOC', this.config.batchSize, this.config.leaseTimeoutMs),
    );
    for (const target of cancelTargets) {
      const outcome = await this.finalizeCancelled({
        jobId: target.jobId,
        tenantId: target.tenantId,
        aggregateId: target.aggregateId,
        correlationId: target.correlationId,
        requestJson: null,
        attemptNo: 0,
      });
      if (outcome === 'cancelled') summary.cancelled += 1;
    }

    const claimed = await this.db.withDispatchScope((client) =>
      claimJobs(client, 'TOC', this.config.batchSize, this.config.leaseTimeoutMs),
    );
    summary.claimed = claimed.length;
    for (const job of claimed) {
      // Job isolation: one poisoned job must not take the batch down.
      try {
        const outcome = await this.processJob(job);
        summary[outcome] += 1;
      } catch (err) {
        summary.failed += 1;
        console.error(
          `[une-worker] toc job ${job.jobId} crashed corr=${job.correlationId}: ` +
            `${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return summary;
  }

  private async processJob(
    job: ClaimedJob,
  ): Promise<'completed' | 'failed' | 'cancelled' | 'skipped'> {
    // tx B0: preconditions + job.started under the job's tenant scope.
    const prepared = await this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current) return { kind: 'skip' as const };
      if (current.status === 'CANCEL_REQUESTED') return { kind: 'cancel' as const };
      if (current.status !== 'RUNNING') return { kind: 'skip' as const };

      if (job.attemptNo > this.config.maxAttempts) {
        return {
          kind: 'fail' as const,
          failure: {
            code: 'T3Q-502-001' as const,
            reason: 'MAX_ATTEMPTS_EXCEEDED',
            message: `최대 시도 횟수(${this.config.maxAttempts})를 초과했습니다.`,
            retryable: false,
          },
        };
      }

      let request: TocJobRequest;
      try {
        request = parseTocJobRequest(job.requestJson);
      } catch (err) {
        return {
          kind: 'fail' as const,
          failure: {
            code: 'T3Q-502-001' as const,
            reason: 'INVALID_JOB_REQUEST',
            message: err instanceof Error ? err.message : 'request_json 파싱 실패',
            retryable: false,
          },
        };
      }

      const snapshot = await findSnapshot(
        client,
        job.tenantId,
        job.aggregateId,
        request.snapshotId,
      );
      if (!snapshot) {
        return {
          kind: 'fail' as const,
          failure: {
            code: 'T3Q-502-001' as const,
            reason: 'SNAPSHOT_NOT_FOUND',
            message: '요청 스냅샷을 찾을 수 없습니다.',
            retryable: false,
          },
        };
      }
      if (snapshot.contentHash !== request.contextHash) {
        return {
          kind: 'fail' as const,
          failure: {
            code: 'T3Q-502-001' as const,
            reason: 'SNAPSHOT_HASH_MISMATCH',
            message: '스냅샷 내용이 요청 시점과 다릅니다(불변성 위반 의심).',
            retryable: false,
          },
        };
      }

      await appendJobEvent(client, job.jobId, 'job.started', { attemptNo: job.attemptNo });
      // provider.requested (internal, ADR-26 D8): with a real HTTP adapter
      // this is the only trace of a call that never came back. Emitted in
      // tx B0 BEFORE the call, so it records INTENT, not a wire fact —
      // phase:'intent' makes that explicit for the append-only log (review
      // minor 1 / QA R5). Identity and budget only — NO body/headers/tokens.
      // Transport identity comes from the ADAPTER, never from worker config
      // (a mismatch would record a wrong host — review minor 2).
      await appendJobEvent(client, job.jobId, 'provider.requested', {
        phase: 'intent',
        adapterId: this.adapter.adapterId,
        variant: this.adapter.variant,
        runtimeMode: this.adapter.runtimeMode,
        operation: 'toc',
        ...(this.adapter.transportProfile ? { ...this.adapter.transportProfile } : {}),
      });
      await setJobStatus(client, job.tenantId, job.jobId, { status: 'RUNNING', progressPct: 10 });
      const planAtStart = await findPlanForUpdate(client, job.tenantId, job.aggregateId);
      return {
        kind: 'run' as const,
        request,
        planContext: snapshot.contextJson as Record<string, unknown>,
        // User-edit protection baseline (review B1): if the pointer moves
        // between here and the result transaction, a user edit happened and
        // the AI result must not replace it.
        tocVersionIdAtStart: planAtStart?.currentTocVersionId ?? null,
      };
    });

    if (prepared.kind === 'skip') return 'skipped';
    if (prepared.kind === 'cancel') return this.finalizeCancelled(job);
    if (prepared.kind === 'fail') return this.finalizeFailed(job, prepared.failure, undefined);

    // Provider call outside any DB transaction (backend rule). Adapter
    // exceptions (e.g. the shared response guard throwing on a malformed
    // provider payload) are normalized into job failures here — otherwise the
    // job would sit RUNNING until the lease expires (review M3).
    let result: T3qTocResult;
    try {
      result = await this.adapter.generateToc(
        {
          planContext: prepared.planContext,
          generationOption: prepared.request.generationOption,
          // v2 PlanRequestBase bindings from job context — adapters never
          // invent them; legacy adapters ignore the block entirely.
          // Placeholders are injected ONLY for a mock runtime (review M2);
          // a live v2 transport gets no documentId/baseRevisionId and the
          // mapper fail-closes with T3Q_REQUEST_REJECTED until CC-150
          // provides real values. requestId varies per attempt: v2 treats
          // it as the idempotency key, and a retry is a NEW generation —
          // reusing it could replay the failed attempt (review minor 6).
          ...(this.adapter.variant === 'target-v2'
            ? {
                trace: {
                  planId: job.aggregateId,
                  planContextSnapshotId: prepared.request.snapshotId,
                  contextHash: prepared.request.contextHash,
                  requestId: `${job.jobId}#${job.attemptNo}`,
                  tenantId: job.tenantId,
                  userId: prepared.request.requestedBy,
                  ...(this.adapter.runtimeMode === 'mock'
                    ? {
                        documentId: MOCK_V2_DOCUMENT_ID,
                        baseRevisionId: MOCK_V2_BASE_REVISION_ID,
                      }
                    : {}),
                  requestedAt: new Date().toISOString(),
                },
              }
            : {}),
        },
        { correlationId: job.correlationId },
      );
    } catch (err) {
      return this.finalizeFailed(
        job,
        {
          code: 'T3Q-502-001',
          reason: 'PROVIDER_CONTRACT_VIOLATION',
          message: err instanceof Error ? err.message : 'provider adapter threw',
          retryable: false,
        },
        undefined,
      );
    }

    if (!result.ok) {
      return this.finalizeFailed(
        job,
        {
          code: 'T3Q-502-001',
          reason: 'PROVIDER_ERROR',
          message: result.error.message,
          retryable: result.error.retryable,
          providerCode: result.error.code,
        },
        result,
      );
    }

    const issues = validateTocTree(result.data.tree);
    if (issues.length > 0) {
      return this.finalizeFailed(
        job,
        {
          code: 'T3Q-502-001',
          reason: 'INVALID_PROVIDER_RESPONSE',
          message: `Provider 목차가 UNE 규칙을 위반했습니다: ${issues
            .slice(0, 5)
            .map((issue) => `${issue.code}@${issue.path}`)
            .join(', ')}`,
          retryable: true,
        },
        result,
      );
    }

    return this.finalizeCompleted(
      job,
      prepared.request,
      result,
      result.data.tree,
      prepared.tocVersionIdAtStart,
    );
  }

  private async finalizeCompleted(
    job: ClaimedJob,
    request: TocJobRequest,
    result: Extract<T3qTocResult, { ok: true }>,
    tree: TocNodeDraft[],
    tocVersionIdAtStart: string | null,
  ): Promise<'completed' | 'cancelled' | 'skipped'> {
    return this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current) return 'skipped';
      if (current.status === 'CANCEL_REQUESTED') {
        await this.applyCancelled(client, job, '결과 반영 전 취소 요청 확인 — 결과 폐기');
        return 'cancelled';
      }
      if (current.status !== 'RUNNING') return 'skipped';

      const plan = await findPlanForUpdate(client, job.tenantId, job.aggregateId);
      if (!plan) {
        await this.applyFailed(client, job, {
          code: 'T3Q-502-001',
          reason: 'PLAN_NOT_FOUND',
          message: '계획서를 찾을 수 없습니다.',
          retryable: false,
        });
        return 'skipped';
      }

      const versionNo = await nextTocVersionNo(client, job.aggregateId);
      const tocVersionId = await insertTocVersion(client, {
        planId: job.aggregateId,
        versionNo,
        baseSnapshotId: request.snapshotId,
        contentHash: tocTreeContentHash(tree),
        createdBy: request.requestedBy,
      });
      await insertTocNodes(client, tocVersionId, flattenTocTree(tree));

      // Trace identity comes from the RESULT, not the port constants — one
      // adapter maps different operations with different versions (ADR-26 D1).
      await appendJobEvent(client, job.jobId, 'provider.responded', {
        adapterId: result.adapterId,
        mappingVersion: result.mappingVersion,
        operation: result.operation,
        ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
        latencyMs: result.latencyMs,
        rawRequest: cap(result.rawRequest),
        rawResponse: cap(result.rawResponse),
      });
      for (const node of tree) {
        await appendJobEvent(client, job.jobId, 'toc.section', {
          nodeKey: node.nodeKey,
          title: node.title,
        });
      }
      await setJobStatus(client, job.tenantId, job.jobId, {
        status: 'COMPLETED',
        progressPct: 100,
        finished: true,
      });
      // User-edit protection, defense in depth (review B1): the API's
      // active-job guard should make this unreachable, but if the pointer
      // moved since tx B0 a user edit won — keep the AI version as a row,
      // do not repoint, and record the supersession on the terminal event.
      const supersededByUserEdit = plan.currentTocVersionId !== tocVersionIdAtStart;
      await appendJobEvent(client, job.jobId, 'job.completed', {
        tocVersionId,
        tocVersionNo: versionNo,
        contentHash: tocTreeContentHash(tree),
        ...(supersededByUserEdit ? { supersededByUserEdit: true } : {}),
      });
      if (!supersededByUserEdit) {
        await updatePlanAfterJob(client, job.tenantId, job.aggregateId, {
          status: nextStatusOnTocJobSuccess(),
          currentTocVersionId: tocVersionId,
        });
      }
      await insertAudit(client, {
        tenantId: job.tenantId,
        actorId: request.requestedBy,
        action: 'TOC_VERSION_CREATED',
        resourceType: 'PLAN',
        resourceId: job.aggregateId,
        correlationId: job.correlationId,
        detail: { jobId: job.jobId, tocVersionId, versionNo, sourceType: 'AI' },
      });
      return 'completed';
    });
  }

  private async finalizeFailed(
    job: ClaimedJob,
    failure: JobFailure,
    result: T3qTocResult | undefined,
  ): Promise<'failed' | 'cancelled' | 'skipped'> {
    return this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current) return 'skipped';
      if (current.status === 'CANCEL_REQUESTED') {
        await this.applyCancelled(client, job, '실패 반영 전 취소 요청 확인');
        return 'cancelled';
      }
      if (current.status !== 'RUNNING') return 'skipped';
      await this.applyFailed(client, job, failure, result);
      return 'failed';
    });
  }

  private async applyFailed(
    client: Parameters<typeof setJobStatus>[0],
    job: ClaimedJob,
    failure: JobFailure,
    result?: T3qTocResult,
  ): Promise<void> {
    if (result) {
      await appendJobEvent(client, job.jobId, 'provider.failed', {
        adapterId: result.adapterId,
        mappingVersion: result.mappingVersion,
        operation: result.operation,
        ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
        latencyMs: result.latencyMs,
        rawRequest: cap(result.rawRequest),
        rawResponse: cap(result.rawResponse),
        error: result.ok ? undefined : result.error,
      });
    }
    await setJobStatus(client, job.tenantId, job.jobId, {
      status: 'FAILED',
      errorJson: {
        code: failure.code,
        reason: failure.reason,
        message: failure.message,
        retryable: failure.retryable,
        ...(failure.providerCode ? { providerCode: failure.providerCode } : {}),
      },
      finished: true,
    });
    await appendJobEvent(client, job.jobId, 'job.failed', {
      code: failure.code,
      reason: failure.reason,
      message: failure.message,
      retryable: failure.retryable,
    });
    const plan = await findPlanForUpdate(client, job.tenantId, job.aggregateId);
    if (plan) {
      await updatePlanAfterJob(client, job.tenantId, job.aggregateId, {
        status: nextStatusOnTocJobAbort(plan.currentTocVersionId !== null),
      });
    }
    await insertAudit(client, {
      tenantId: job.tenantId,
      actorId: null,
      action: 'TOC_JOB_FAILED',
      resourceType: 'GENERATION_JOB',
      resourceId: job.jobId,
      correlationId: job.correlationId,
      detail: { planId: job.aggregateId, reason: failure.reason, retryable: failure.retryable },
    });
  }

  private async finalizeCancelled(job: ClaimedJob): Promise<'cancelled'> {
    await this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current || current.status !== 'CANCEL_REQUESTED') return;
      await this.applyCancelled(client, job, '실행 전 취소 요청 확인');
    });
    return 'cancelled';
  }

  private async applyCancelled(
    client: Parameters<typeof setJobStatus>[0],
    job: ClaimedJob,
    note: string,
  ): Promise<void> {
    await setJobStatus(client, job.tenantId, job.jobId, { status: 'CANCELLED', finished: true });
    await appendJobEvent(client, job.jobId, 'job.cancelled', { note });
    const plan = await findPlanForUpdate(client, job.tenantId, job.aggregateId);
    if (plan) {
      await updatePlanAfterJob(client, job.tenantId, job.aggregateId, {
        status: nextStatusOnTocJobAbort(plan.currentTocVersionId !== null),
      });
    }
    await insertAudit(client, {
      tenantId: job.tenantId,
      actorId: null,
      action: 'TOC_JOB_CANCELLED',
      resourceType: 'GENERATION_JOB',
      resourceId: job.jobId,
      correlationId: job.correlationId,
      detail: { planId: job.aggregateId, by: 'worker-checkpoint' },
    });
  }
}

function cap(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  // Byte-accurate (review minor 10): Korean payloads are ~3 bytes/char in
  // UTF-8, so a character count would let ~600KB through a "200KB" cap.
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= RAW_PAYLOAD_CAP) return value ?? null;
  return { truncated: true, originalBytes: bytes, head: text.slice(0, 2000) };
}
