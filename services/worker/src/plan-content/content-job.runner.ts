import {
  anchorContentDrafts,
  generatedBlockContentHash,
  nextStatusOnContentJobAbort,
  nextStatusOnContentJobSuccess,
  outlineCoordinates,
  parseContentJobRequest,
  type AnchoredContentBlock,
  type ContentJobRequest,
  type TocNodeDraft,
} from '@une/domain';
import type { ContentCapable, T3qContentResult, T3qPlanProvider } from '@une/provider-adapters';
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
import {
  findTocVersionWithNodes,
  hasCurrentBlocks,
  insertGeneratedBlock,
  linkSupersededBy,
  listCurrentBlocksForUpdate,
  nextGenerationNo,
  supersedeBlock,
  type CurrentBlockRow,
} from './content-repositories';
import type { RunSummary } from '../plan-toc/toc-job.runner';

interface JobFailure {
  code: 'T3Q-502-002';
  reason: string;
  message: string;
  retryable: boolean;
  providerCode?: string;
}

const RAW_PAYLOAD_CAP = 200_000;
/** job.progress throttle: every N blocks or 10 percentage points. */
const PROGRESS_EVERY_BLOCKS = 10;

/**
 * CONTENT job execution (CC-130, ADR-27; design 10 §4.2 RPT-002 row).
 * Same 3-tx shape as the TOC runner — dispatch / preconditions / provider
 * call OUTSIDE transactions / result — with the content pipeline in tx B1:
 * anchor → protection re-check → generation supersede → block events.
 *
 * Partial events are SYNTHESIZED from the full response (US-PLAN-012 A-02):
 * the legacy provider answers synchronously, so `content.block` /
 * `job.progress` frames are written in completion order, not real time
 * (honest limit — ADR-27 D5; real streaming arrives with CR-T3Q-003).
 */
export class ContentJobRunner {
  constructor(
    private readonly db: WorkerDatabase,
    private readonly adapter: T3qPlanProvider & ContentCapable,
    private readonly config: WorkerConfig,
  ) {}

  async runOnce(): Promise<RunSummary> {
    const summary: RunSummary = { claimed: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 };

    const cancelTargets = await this.db.withDispatchScope((client) =>
      sweepCancelRequested(client, 'CONTENT', this.config.batchSize, this.config.leaseTimeoutMs),
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
      claimJobs(client, 'CONTENT', this.config.batchSize, this.config.leaseTimeoutMs),
    );
    summary.claimed = claimed.length;
    for (const job of claimed) {
      try {
        const outcome = await this.processJob(job);
        summary[outcome] += 1;
      } catch (err) {
        summary.failed += 1;
        console.error(
          `[une-worker] content job ${job.jobId} crashed corr=${job.correlationId}: ` +
            `${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return summary;
  }

  private async processJob(
    job: ClaimedJob,
  ): Promise<'completed' | 'failed' | 'cancelled' | 'skipped'> {
    const prepared = await this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current) return { kind: 'skip' as const };
      if (current.status === 'CANCEL_REQUESTED') return { kind: 'cancel' as const };
      if (current.status !== 'RUNNING') return { kind: 'skip' as const };

      if (job.attemptNo > this.config.maxAttempts) {
        return {
          kind: 'fail' as const,
          failure: failure(
            'MAX_ATTEMPTS_EXCEEDED',
            `최대 시도 횟수(${this.config.maxAttempts})를 초과했습니다.`,
            false,
          ),
        };
      }

      let request: ContentJobRequest;
      try {
        request = parseContentJobRequest(job.requestJson);
      } catch (err) {
        return {
          kind: 'fail' as const,
          failure: failure(
            'INVALID_JOB_REQUEST',
            err instanceof Error ? err.message : 'request_json 파싱 실패',
            false,
          ),
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
          failure: failure('SNAPSHOT_NOT_FOUND', '요청 스냅샷을 찾을 수 없습니다.', false),
        };
      }
      if (snapshot.contentHash !== request.contextHash) {
        return {
          kind: 'fail' as const,
          failure: failure(
            'SNAPSHOT_HASH_MISMATCH',
            '스냅샷 내용이 요청 시점과 다릅니다(불변성 위반 의심).',
            false,
          ),
        };
      }

      const tocVersion = await findTocVersionWithNodes(
        client,
        job.aggregateId,
        request.tocVersionId,
      );
      if (!tocVersion) {
        return {
          kind: 'fail' as const,
          failure: failure('TOC_VERSION_NOT_FOUND', '요청 목차 버전을 찾을 수 없습니다.', false),
        };
      }
      if (tocVersion.contentHash !== request.tocContentHash) {
        return {
          kind: 'fail' as const,
          failure: failure(
            'TOC_HASH_MISMATCH',
            '목차 내용이 요청 시점과 다릅니다(아웃라인 드리프트).',
            false,
          ),
        };
      }

      const plan = await findPlanForUpdate(client, job.tenantId, job.aggregateId);
      if (!plan) {
        return {
          kind: 'fail' as const,
          failure: failure('PLAN_NOT_FOUND', '계획서를 찾을 수 없습니다.', false),
        };
      }
      if (plan.currentTocVersionId !== request.tocVersionId) {
        // Outline moved between enqueue and execution — writing under old
        // anchors would attach body text to the wrong nodes. Fail closed.
        return {
          kind: 'fail' as const,
          failure: failure(
            'OUTLINE_CHANGED',
            '계획서의 현재 목차가 요청 시점과 다릅니다 — 새 목차로 다시 요청하십시오.',
            false,
          ),
        };
      }

      // Provider request outline: full outline for full generation; pruned
      // target subtrees for scoped regeneration (US-PLAN-014 A-01).
      // Coordinates ALWAYS come from the FULL outline: anchoring a pruned
      // subtree with walk-relative values would persist a level-2 node as a
      // level-1 block with a colliding sort order — and rows are immutable
      // (review B-1/F2).
      const coordinates = outlineCoordinates(tocVersion.tree);
      let providerOutline: TocNodeDraft[] = tocVersion.tree;
      if (request.targetNodeKeys) {
        const pruned = pruneToTargets(tocVersion.tree, new Set(request.targetNodeKeys));
        if (pruned.missing.length > 0) {
          return {
            kind: 'fail' as const,
            failure: failure(
              'TARGET_NODE_NOT_FOUND',
              `대상 노드가 목차에 없습니다: ${pruned.missing.join(', ')}`,
              false,
            ),
          };
        }
        providerOutline = pruned.subtrees;
      }

      await appendJobEvent(client, job.jobId, 'job.started', { attemptNo: job.attemptNo });
      await appendJobEvent(client, job.jobId, 'provider.requested', {
        phase: 'intent',
        adapterId: this.adapter.adapterId,
        variant: this.adapter.variant,
        runtimeMode: this.adapter.runtimeMode,
        operation: 'content',
        ...(this.adapter.transportProfile ? { ...this.adapter.transportProfile } : {}),
      });
      await setJobStatus(client, job.tenantId, job.jobId, { status: 'RUNNING', progressPct: 10 });
      return {
        kind: 'run' as const,
        request,
        planContext: snapshot.contextJson as Record<string, unknown>,
        providerOutline,
        coordinates,
      };
    });

    if (prepared.kind === 'skip') return 'skipped';
    if (prepared.kind === 'cancel') return this.finalizeCancelled(job);
    if (prepared.kind === 'fail') return this.finalizeFailed(job, prepared.failure, undefined);

    let result: T3qContentResult;
    try {
      result = await this.adapter.generateContent(
        {
          planContext: prepared.planContext,
          outline: prepared.providerOutline,
          // NOTE(CC-135): when a target-v2 content adapter exists, the v2
          // trace block (PlanRequestBase bindings) must be attached here —
          // mirror toc-job.runner.ts (review m-10).
          // Assumed SSE framing (OB-01) stays off the operational path; the
          // sync-JSON response is the transcript-backed shape (ADR-27 D5).
          stream: this.config.t3qContentStream,
        },
        { correlationId: job.correlationId },
      );
    } catch (err) {
      return this.finalizeFailed(
        job,
        failure(
          'PROVIDER_CONTRACT_VIOLATION',
          err instanceof Error ? err.message : 'provider adapter threw',
          false,
        ),
        undefined,
      );
    }

    if (!result.ok) {
      return this.finalizeFailed(
        job,
        {
          ...failure('PROVIDER_ERROR', result.error.message, result.error.retryable),
          providerCode: result.error.code,
        },
        result,
      );
    }

    const anchor = anchorContentDrafts(
      prepared.providerOutline,
      result.data.sections,
      prepared.coordinates,
    );
    if (anchor.issues.length > 0) {
      return this.finalizeFailed(
        job,
        failure(
          'INVALID_PROVIDER_RESPONSE',
          `Provider 본문이 목차와 정합하지 않습니다: ${anchor.issues
            .slice(0, 5)
            .map((issue) => `${issue.code}@${issue.path}`)
            .join(', ')}`,
          true,
        ),
        result,
      );
    }

    return this.finalizeCompleted(job, prepared.request, result, anchor.anchored);
  }

  private async finalizeCompleted(
    job: ClaimedJob,
    request: ContentJobRequest,
    result: Extract<T3qContentResult, { ok: true }>,
    anchored: readonly AnchoredContentBlock[],
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
        await this.applyFailed(
          client,
          job,
          failure('PLAN_NOT_FOUND', '계획서를 찾을 수 없습니다.', false),
        );
        return 'skipped';
      }
      // Outline-move defense (ADR-25 D11 pattern): if the confirmed outline
      // changed while the provider ran, DISCARD everything — old anchors on
      // a new outline would attach body text to wrong nodes.
      if (plan.currentTocVersionId !== request.tocVersionId) {
        await appendJobEvent(client, job.jobId, 'provider.responded', providerTrace(result));
        await appendJobEvent(client, job.jobId, 'job.completed', {
          supersededByOutlineChange: true,
          discardedBlocks: anchored.length,
        });
        await setJobStatus(client, job.tenantId, job.jobId, {
          status: 'COMPLETED',
          progressPct: 100,
          finished: true,
        });
        // The plan must NOT stay CONTENT_GENERATING (no startable set
        // contains it — the plan would be unrecoverable, review M-1);
        // abort semantics apply: nothing was applied this round.
        await this.revertPlan(client, job);
        await insertAudit(client, {
          tenantId: job.tenantId,
          actorId: null,
          action: 'CONTENT_JOB_DISCARDED',
          resourceType: 'GENERATION_JOB',
          resourceId: job.jobId,
          correlationId: job.correlationId,
          detail: { planId: job.aggregateId, reason: 'OUTLINE_CHANGED' },
        });
        return 'completed';
      }

      await appendJobEvent(client, job.jobId, 'provider.responded', providerTrace(result));

      // Protection re-check at write time (tx B1) — a user may have locked
      // blocks between B0 and here; the DB trigger is the final backstop.
      const currentBlocks = await listCurrentBlocksForUpdate(client, job.aggregateId);
      const byNodeKey = new Map<string, CurrentBlockRow>(
        currentBlocks.map((row) => [row.nodeKey, row]),
      );

      let generated = 0;
      let preserved = 0;
      let blocksWithoutEvidence = 0;
      let lastProgressPct = 10;
      const total = anchored.length;

      for (const [index, block] of anchored.entries()) {
        const existing = byNodeKey.get(block.nodeKey);
        if (existing && existing.protectionState !== 'NONE') {
          preserved += 1;
          // PRESERVED carries the EXISTING block's identity — a null hash
          // would be indistinguishable from FAILED (contract; review M-4/F3).
          await appendJobEvent(client, job.jobId, 'content.block', {
            nodeKey: block.nodeKey,
            blockId: existing.blockId,
            outcome: 'PRESERVED',
            sortOrder: block.sortOrder,
            outlineLevel: block.outlineLevel,
            contentHash: existing.contentHash,
            citationCount: existing.citationCount,
            reason: existing.protectionState,
          });
        } else {
          // MAX over ALL generations of the node, not the current row's —
          // a successor-less supersede must not lead to reuse (review m-8).
          const generationNo = await nextGenerationNo(client, job.aggregateId, block.nodeKey);
          const contentHash = generatedBlockContentHash(block);
          // Order matters: uk_generated_block_current forbids two current
          // rows even transiently — supersede first, insert, then link.
          if (existing) await supersedeBlock(client, existing.blockId);
          const blockId = await insertGeneratedBlock(client, {
            planId: job.aggregateId,
            tocVersionId: request.tocVersionId,
            nodeKey: block.nodeKey,
            generationNo,
            sourceJobId: job.jobId,
            outlineLevel: block.outlineLevel,
            sortOrder: block.sortOrder,
            title: block.title,
            text: block.text,
            contentHash,
            citations: block.citations,
            createdBy: request.requestedBy,
          });
          if (existing) await linkSupersededBy(client, existing.blockId, blockId);
          generated += 1;
          if (block.citations.length === 0) blocksWithoutEvidence += 1;
          await appendJobEvent(client, job.jobId, 'content.block', {
            nodeKey: block.nodeKey,
            blockId,
            outcome: 'GENERATED',
            sortOrder: block.sortOrder,
            outlineLevel: block.outlineLevel,
            contentHash,
            citationCount: block.citations.length,
          });
        }

        const done = index + 1;
        const pct = 10 + Math.floor((done / Math.max(total, 1)) * 85);
        // The LAST block always emits a frame (contract wording; review m-1).
        if (done === total || done % PROGRESS_EVERY_BLOCKS === 0 || pct - lastProgressPct >= 10) {
          lastProgressPct = pct;
          await appendJobEvent(client, job.jobId, 'job.progress', {
            completed: done,
            total,
            pct,
          });
        }
      }

      await setJobStatus(client, job.tenantId, job.jobId, {
        status: 'COMPLETED',
        progressPct: 100,
        finished: true,
      });
      await appendJobEvent(client, job.jobId, 'job.completed', {
        tocVersionId: request.tocVersionId,
        generated,
        preserved,
        failed: 0,
        blocksWithoutEvidence,
      });
      await updatePlanAfterJob(client, job.tenantId, job.aggregateId, {
        status: nextStatusOnContentJobSuccess(),
      });
      await insertAudit(client, {
        tenantId: job.tenantId,
        actorId: request.requestedBy,
        action: 'CONTENT_BLOCKS_GENERATED',
        resourceType: 'PLAN',
        resourceId: job.aggregateId,
        correlationId: job.correlationId,
        detail: {
          jobId: job.jobId,
          tocVersionId: request.tocVersionId,
          generated,
          preserved,
          blocksWithoutEvidence,
        },
      });
      return 'completed';
    });
  }

  private async finalizeFailed(
    job: ClaimedJob,
    jobFailure: JobFailure,
    result: T3qContentResult | undefined,
  ): Promise<'failed' | 'cancelled' | 'skipped'> {
    return this.db.withTenant(job.tenantId, async (client) => {
      const current = await findJobForUpdate(client, job.tenantId, job.jobId);
      if (!current) return 'skipped';
      if (current.status === 'CANCEL_REQUESTED') {
        await this.applyCancelled(client, job, '실패 반영 전 취소 요청 확인');
        return 'cancelled';
      }
      if (current.status !== 'RUNNING') return 'skipped';
      await this.applyFailed(client, job, jobFailure, result);
      return 'failed';
    });
  }

  private async applyFailed(
    client: Parameters<typeof setJobStatus>[0],
    job: ClaimedJob,
    jobFailure: JobFailure,
    result?: T3qContentResult,
  ): Promise<void> {
    if (result) {
      await appendJobEvent(client, job.jobId, 'provider.failed', {
        ...providerTrace(result),
        error: result.ok ? undefined : result.error,
      });
    }
    await setJobStatus(client, job.tenantId, job.jobId, {
      status: 'FAILED',
      errorJson: {
        code: jobFailure.code,
        reason: jobFailure.reason,
        message: jobFailure.message,
        retryable: jobFailure.retryable,
        ...(jobFailure.providerCode ? { providerCode: jobFailure.providerCode } : {}),
      },
      finished: true,
    });
    await appendJobEvent(client, job.jobId, 'job.failed', {
      code: jobFailure.code,
      reason: jobFailure.reason,
      message: jobFailure.message,
      retryable: jobFailure.retryable,
    });
    await this.revertPlan(client, job);
    await insertAudit(client, {
      tenantId: job.tenantId,
      actorId: null,
      action: 'CONTENT_JOB_FAILED',
      resourceType: 'GENERATION_JOB',
      resourceId: job.jobId,
      correlationId: job.correlationId,
      detail: {
        planId: job.aggregateId,
        reason: jobFailure.reason,
        retryable: jobFailure.retryable,
      },
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
    await this.revertPlan(client, job);
    await insertAudit(client, {
      tenantId: job.tenantId,
      actorId: null,
      action: 'CONTENT_JOB_CANCELLED',
      resourceType: 'GENERATION_JOB',
      resourceId: job.jobId,
      correlationId: job.correlationId,
      detail: { planId: job.aggregateId, by: 'worker-checkpoint' },
    });
  }

  /** Failure/cancel returns the plan to where content work stands
   * (never plan.ERROR — ADR-25 D6 precedent). */
  private async revertPlan(
    client: Parameters<typeof setJobStatus>[0],
    job: ClaimedJob,
  ): Promise<void> {
    const plan = await findPlanForUpdate(client, job.tenantId, job.aggregateId);
    if (!plan) return;
    if (plan.status !== 'CONTENT_GENERATING') return; // plan already moved on
    await updatePlanAfterJob(client, job.tenantId, job.aggregateId, {
      status: nextStatusOnContentJobAbort(await hasCurrentBlocks(client, job.aggregateId)),
    });
  }
}

function failure(reason: string, message: string, retryable: boolean): JobFailure {
  return { code: 'T3Q-502-002', reason, message, retryable };
}

function providerTrace(result: T3qContentResult): Record<string, unknown> {
  return {
    adapterId: result.adapterId,
    mappingVersion: result.mappingVersion,
    operation: result.operation,
    ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
    latencyMs: result.latencyMs,
    rawRequest: cap(result.rawRequest),
    rawResponse: cap(result.rawResponse),
  };
}

/** Scoped regeneration (US-PLAN-014 A-01): the provider request is pruned
 * to the target subtrees. Ancestor context is intentionally NOT sent —
 * a simplification recorded in ADR-27 (the legacy contract has no partial
 * semantics either way; revisit with CR-T3Q-002). */
function pruneToTargets(
  tree: readonly TocNodeDraft[],
  targets: Set<string>,
): { subtrees: TocNodeDraft[]; missing: string[] } {
  const subtrees: TocNodeDraft[] = [];
  const found = new Set<string>();
  const walk = (nodes: readonly TocNodeDraft[]): void => {
    for (const node of nodes) {
      if (node.nodeKey && targets.has(node.nodeKey)) {
        subtrees.push(node);
        found.add(node.nodeKey);
        continue; // a target's descendants ride along inside the subtree
      }
      walk(node.children ?? []);
    }
  };
  walk(tree);
  const missing = [...targets].filter((key) => !found.has(key));
  return { subtrees, missing };
}

function cap(value: unknown): unknown {
  const text = JSON.stringify(value ?? null);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= RAW_PAYLOAD_CAP) return value ?? null;
  return { truncated: true, originalBytes: bytes, head: text.slice(0, 2000) };
}
