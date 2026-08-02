import { canonicalHash, sha256Hex } from '@une/domain';
import {
  buildMockContentBlocks,
  buildMockErrorResponse,
  resolveTargetSections,
  type ContentBlockV2,
  type ContentGenerationRequestV2,
  type OutlineSectionV2,
} from './mock-target-v2-payloads';
import type { TocGenerationRequestV2 } from './target-v2-toc-mapper';
import type { TargetV2SseFrame } from './target-v2-sse.assumed';

/**
 * Deterministic in-process generation-job store for the target-v2 mock
 * (CC-135, CR-T3Q-003). One logical model serves polling, SSE framing,
 * cancel, and partial retry so they can never disagree with each other.
 *
 * Lifecycle: QUEUED → RUNNING×runningPolls → [PARTIAL when failures exist]
 * → COMPLETED | FAILED(all targets failed). PARTIAL is deliberately
 * NON-terminal here (fail-closed reading of the contract's ambiguous
 * wording — ADR-28 D4); partiality of the terminal state travels in
 * failedTargetIds. Cancel freezes progress (AT-T3Q-006); retry creates a
 * NEW job scoped to failed targets only (AT-T3Q-003/007).
 *
 * Determinism: ids derive from requestId/parent ids; timestamps echo
 * requestedAt; failures happen ONLY when a scenario injects failSectionIds.
 */

export class TargetV2TransportError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly body: unknown,
  ) {
    super(`target-v2 transport ${httpStatus}`);
    this.name = 'TargetV2TransportError';
  }
}

export interface MockTargetV2ScenarioOptions {
  /** RUNNING polls before the (PARTIAL→)terminal status. */
  runningPolls?: number;
  /** Content-job sections that fail (seed for partial retry). Default: none. */
  failSectionIds?: string[];
  /** baseRevisionIds whose semantic edit returns 409 (stale revision). */
  editConflictBaseRevisionIds?: string[];
}

interface StoredJob {
  generationId: string;
  kind: 'toc' | 'content';
  tocRequest?: TocGenerationRequestV2;
  contentRequest?: ContentGenerationRequestV2;
  requestFingerprint: string;
  targetSections: OutlineSectionV2[];
  failSectionIds: string[];
  polls: number;
  cancelled?: { reason?: string; frozen: SnapshotAtCancel };
}

function fingerprint(request: unknown): string {
  return canonicalHash(request as Record<string, unknown>);
}

interface SnapshotAtCancel {
  progress: number;
  completedTargetIds: string[];
}

/** Bound on retained jobs (review m-7): the adapter is a process singleton
 * in demo runs, and CONTENT requests hold the full outline — evict the
 * oldest entries instead of growing forever. */
const MAX_RETAINED_JOBS = 500;

export class MockTargetV2JobStore {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly runningPolls: number;
  private readonly failSectionIds: string[];

  constructor(options: MockTargetV2ScenarioOptions = {}) {
    this.runningPolls = options.runningPolls ?? 1;
    this.failSectionIds = options.failSectionIds ?? [];
  }

  submitToc(
    request: TocGenerationRequestV2,
    buildSections: (request: TocGenerationRequestV2) => OutlineSectionV2[],
  ): StoredJob {
    const generationId = `gen-${sha256Hex(request.requestId).slice(0, 16)}`;
    const existing = this.jobs.get(generationId);
    if (existing) {
      this.assertSameFingerprint(existing, request);
      return existing; // idempotent resubmit — same job, no restart
    }
    const job: StoredJob = {
      generationId,
      kind: 'toc',
      tocRequest: request,
      requestFingerprint: fingerprint(request),
      targetSections: buildSections(request),
      failSectionIds: [],
      polls: 0,
    };
    this.remember(job);
    return job;
  }

  submitContent(request: ContentGenerationRequestV2): StoredJob {
    if (request.generationScope === 'BLOCKS') {
      throw new TargetV2TransportError(
        422,
        buildMockErrorResponse(
          'PLAN-V2-422-002',
          'generationScope BLOCKS is not mocked (UNE partial regeneration is section-grained, ADR-27 D7)',
          request.correlationId,
        ),
      );
    }
    const generationId = `gen-${sha256Hex(request.requestId).slice(0, 16)}`;
    const existing = this.jobs.get(generationId);
    if (existing) {
      this.assertSameFingerprint(existing, request);
      return existing;
    }
    const targetSections = resolveTargetSections(request);
    const job: StoredJob = {
      generationId,
      kind: 'content',
      contentRequest: request,
      requestFingerprint: fingerprint(request),
      targetSections,
      failSectionIds: this.failSectionIds.filter((id) =>
        targetSections.some((section) => section.sectionId === id),
      ),
      polls: 0,
    };
    this.remember(job);
    return job;
  }

  /** Same requestId + different payload is a caller defect, not a silent
   * join (review m-6; mirrors the UNE idempotency store's fingerprint rule,
   * ADR-23). The 409 shape is a UNE assumption — gap matrix §3. */
  private assertSameFingerprint(
    job: StoredJob,
    request: TocGenerationRequestV2 | ContentGenerationRequestV2,
  ): void {
    if (job.requestFingerprint !== fingerprint(request)) {
      throw new TargetV2TransportError(
        409,
        buildMockErrorResponse(
          'PLAN-V2-409-005',
          `requestId ${request.requestId}는 다른 페이로드로 이미 접수되었습니다 (멱등키 재사용 위반)`,
          request.correlationId,
        ),
      );
    }
  }

  private remember(job: StoredJob): void {
    if (this.jobs.size >= MAX_RETAINED_JOBS) {
      const oldest = this.jobs.keys().next().value as string | undefined;
      if (oldest !== undefined) this.jobs.delete(oldest);
    }
    this.jobs.set(job.generationId, job);
  }

  acceptedBody(job: StoredJob): Record<string, unknown> {
    const request = (job.tocRequest ?? job.contentRequest) as TocGenerationRequestV2;
    return {
      generationId: job.generationId,
      status: 'QUEUED',
      statusUrl: `/model-api/une-mock/v2/generation-jobs/${job.generationId}`,
      eventStreamUrl: `/model-api/une-mock/v2/generation-jobs/${job.generationId}/events`,
      acceptedAt: request.requestedAt,
      requestId: request.requestId,
      correlationId: request.correlationId,
    };
  }

  /** Poll-advancing status read (mirrors the CC-125 transport behavior). */
  pollStatus(generationId: string): Record<string, unknown> {
    const job = this.jobs.get(generationId);
    if (!job) {
      return {
        generationId,
        status: 'FAILED',
        progress: 0,
        completedTargetIds: [],
        failedTargetIds: [],
        error: {
          code: 'GENERATION_NOT_FOUND',
          message: `unknown generationId: ${generationId}`,
          retryable: false,
        },
      };
    }
    if (!job.cancelled && !this.isTerminal(job)) job.polls += 1;
    return this.statusBody(job);
  }

  /** Non-advancing read (cancel responses, tests). */
  peekStatus(generationId: string): StoredJob | undefined {
    return this.jobs.get(generationId);
  }

  cancel(
    generationId: string,
    reason: string | undefined,
    correlationId: string,
  ): Record<string, unknown> {
    const job = this.jobs.get(generationId);
    if (!job) {
      throw new TargetV2TransportError(
        404,
        buildMockErrorResponse(
          'PLAN-V2-404-001',
          `unknown generationId: ${generationId}`,
          correlationId,
        ),
      );
    }
    if (job.cancelled || this.isTerminal(job)) {
      throw new TargetV2TransportError(
        409,
        buildMockErrorResponse(
          'PLAN-V2-409-002',
          '종결(또는 이미 취소)된 generation은 취소할 수 없습니다.',
          correlationId,
        ),
      );
    }
    job.cancelled = {
      ...(reason !== undefined ? { reason } : {}),
      frozen: {
        progress: this.progressAt(job),
        completedTargetIds: this.progressiveCompleted(job),
      },
    };
    return this.statusBody(job);
  }

  retry(
    generationId: string,
    request: { targetType: 'SECTION' | 'BLOCK'; targetIds: string[]; instructionOverride?: string },
    correlationId: string,
  ): StoredJob {
    const parent = this.jobs.get(generationId);
    if (!parent) {
      throw new TargetV2TransportError(
        404,
        buildMockErrorResponse(
          'PLAN-V2-404-001',
          `unknown generationId: ${generationId}`,
          correlationId,
        ),
      );
    }
    if (!this.isTerminal(parent) || parent.cancelled) {
      throw new TargetV2TransportError(
        409,
        buildMockErrorResponse(
          'PLAN-V2-409-003',
          '종결되지 않은(또는 취소된) generation은 재시도할 수 없습니다.',
          correlationId,
        ),
      );
    }
    // Honest not-mocked vs. conflict split (review m-1): BLOCK-grained retry
    // is simply not mocked (UNE partial regeneration is section-grained,
    // ADR-28 D6) — disguising that as a 409 conflict would misreport mock
    // coverage. Same shape as submitContent's BLOCKS rejection.
    if (request.targetType !== 'SECTION') {
      throw new TargetV2TransportError(
        422,
        buildMockErrorResponse(
          'PLAN-V2-422-003',
          'targetType BLOCK retry is not mocked (UNE partial regeneration is section-grained, ADR-28 D6)',
          correlationId,
        ),
      );
    }
    const failed = new Set(parent.failSectionIds);
    const invalid = request.targetIds.filter((id) => !failed.has(id));
    if (request.targetIds.length === 0 || invalid.length > 0) {
      throw new TargetV2TransportError(
        409,
        buildMockErrorResponse(
          'PLAN-V2-409-004',
          `재시도 대상은 실패한 섹션만 가능합니다 (위반: ${invalid.join(', ') || '(빈 대상)'})`,
          correlationId,
        ),
      );
    }
    const parentRequest = parent.contentRequest as ContentGenerationRequestV2;
    const childId = `gen-${sha256Hex(
      `${generationId}:${[...request.targetIds].sort().join(',')}:${request.instructionOverride ?? ''}`,
    ).slice(0, 16)}`;
    const existing = this.jobs.get(childId);
    if (existing) return existing;
    const child: StoredJob = {
      generationId: childId,
      kind: 'content',
      contentRequest: {
        ...parentRequest,
        generationScope: 'SECTIONS',
        targetSectionIds: request.targetIds,
      },
      requestFingerprint: fingerprint({ parent: generationId, ...request }),
      targetSections: parent.targetSections.filter((section) =>
        request.targetIds.includes(section.sectionId),
      ),
      failSectionIds: [], // the retried run succeeds — that is the scenario's point
      polls: 0,
    };
    this.remember(child);
    return child;
  }

  /** Full deterministic SSE frame timeline for a job (id == sequence). */
  frames(generationId: string, correlationId: string): TargetV2SseFrame[] {
    const job = this.jobs.get(generationId);
    if (!job) {
      throw new TargetV2TransportError(
        404,
        buildMockErrorResponse(
          'PLAN-V2-404-001',
          `unknown generationId: ${generationId}`,
          correlationId,
        ),
      );
    }
    const frames: TargetV2SseFrame[] = [];
    let sequence = 0;
    const nextFrame = (event: string, data: Record<string, unknown>): void => {
      sequence += 1;
      frames.push({ id: sequence, event, data: { ...data, sequence } });
    };
    nextFrame('job.started', { generationId: job.generationId, status: 'RUNNING', progress: 0 });
    if (job.cancelled) {
      nextFrame('job.failed', {
        generationId: job.generationId,
        status: 'CANCELLED',
        completedTargetIds: job.cancelled.frozen.completedTargetIds,
        failedTargetIds: [],
      });
      return frames;
    }
    if (job.kind === 'toc') {
      for (const section of job.targetSections) nextFrame('toc.section', { section });
    } else {
      for (const block of this.contentBlocks(job)) nextFrame('content.block', { block });
    }
    const failed = job.failSectionIds;
    if (failed.length > 0) {
      nextFrame('job.warning', {
        generationId: job.generationId,
        message: '일부 섹션 생성 실패 — 부분 재시도(retry) 가능',
        failedTargetIds: failed,
      });
    }
    if (this.allTargetsFailed(job)) {
      nextFrame('job.failed', {
        generationId: job.generationId,
        status: 'FAILED',
        completedTargetIds: [],
        failedTargetIds: failed,
      });
    } else {
      nextFrame('job.completed', {
        generationId: job.generationId,
        status: 'COMPLETED',
        completedTargetIds: this.completedTargetIds(job),
        failedTargetIds: failed,
      });
    }
    return frames;
  }

  // ── internals ──

  private isTerminal(job: StoredJob): boolean {
    return job.polls > this.terminalAfter(job);
  }

  private terminalAfter(job: StoredJob): number {
    // failures add one PARTIAL poll between RUNNING and the terminal state
    return (
      this.runningPolls + (job.failSectionIds.length > 0 && !this.allTargetsFailed(job) ? 1 : 0)
    );
  }

  private allTargetsFailed(job: StoredJob): boolean {
    return (
      job.kind === 'content' &&
      job.targetSections.length > 0 &&
      job.failSectionIds.length === job.targetSections.length
    );
  }

  private completedTargetIds(job: StoredJob): string[] {
    const failed = new Set(job.failSectionIds);
    return job.targetSections
      .filter((section) => !failed.has(section.sectionId))
      .map((section) => section.sectionId);
  }

  private progressiveCompleted(job: StoredJob): string[] {
    const all = this.completedTargetIds(job);
    const share = Math.floor(
      (all.length * Math.min(job.polls, this.runningPolls)) / (this.runningPolls + 1),
    );
    return all.slice(0, share);
  }

  private progressAt(job: StoredJob): number {
    return Math.min(
      90,
      Math.round((Math.min(job.polls, this.runningPolls) / (this.runningPolls + 1)) * 100),
    );
  }

  private contentBlocks(job: StoredJob): ContentBlockV2[] {
    const request = job.contentRequest as ContentGenerationRequestV2;
    const failed = new Set(job.failSectionIds);
    const sections = job.targetSections.filter((section) => !failed.has(section.sectionId));
    return buildMockContentBlocks(request, job.generationId, sections);
  }

  private statusBody(job: StoredJob): Record<string, unknown> {
    const request = (job.tocRequest ?? job.contentRequest) as TocGenerationRequestV2;
    const base = {
      generationId: job.generationId,
      updatedAt: request.requestedAt,
    };
    if (job.cancelled) {
      return {
        ...base,
        status: 'CANCELLED',
        progress: job.cancelled.frozen.progress,
        completedTargetIds: job.cancelled.frozen.completedTargetIds,
        failedTargetIds: [],
        warnings: [],
        error: null,
      };
    }
    if (job.polls <= this.runningPolls) {
      return {
        ...base,
        status: 'RUNNING',
        progress: this.progressAt(job),
        completedTargetIds: this.progressiveCompleted(job),
        failedTargetIds: [],
      };
    }
    if (!this.isTerminal(job)) {
      // PARTIAL: non-terminal by UNE's fail-closed reading (ADR-28 D4)
      return {
        ...base,
        status: 'PARTIAL',
        progress: 90,
        completedTargetIds: this.completedTargetIds(job),
        failedTargetIds: job.failSectionIds,
        warnings: ['일부 섹션에서 생성에 실패했습니다.'],
        error: null,
      };
    }
    if (this.allTargetsFailed(job)) {
      return {
        ...base,
        status: 'FAILED',
        progress: 100,
        completedTargetIds: [],
        failedTargetIds: job.failSectionIds,
        warnings: [],
        error: buildMockErrorResponse(
          'PLAN-V2-500-001',
          '요청한 모든 대상 섹션의 생성이 실패했습니다.',
          request.correlationId,
          true,
        ),
      };
    }
    if (job.kind === 'toc') {
      return {
        ...base,
        status: 'COMPLETED',
        progress: 100,
        completedTargetIds: job.targetSections.map((section) => section.sectionId),
        failedTargetIds: [],
        outline: job.targetSections,
        warnings: [],
        error: null,
      };
    }
    return {
      ...base,
      status: 'COMPLETED',
      progress: 100,
      completedTargetIds: this.completedTargetIds(job),
      failedTargetIds: job.failSectionIds,
      blocks: this.contentBlocks(job),
      warnings:
        job.failSectionIds.length > 0 ? ['일부 섹션 생성 실패 — 부분 재시도(retry) 가능'] : [],
      error: null,
    };
  }
}
