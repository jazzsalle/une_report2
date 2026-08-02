import type { PlanFeatureCapability } from '../../capability/plan-feature-capabilities';
import {
  TARGET_V2_TOC_MAPPING_VERSION,
  fromOutlineSections,
  toTocGenerationRequest,
  type TargetV2RequestContext,
} from './target-v2-toc-mapper';
import {
  TARGET_V2_CONTENT_MAPPING_VERSION,
  fromContentBlocks,
  toContentGenerationRequest,
} from './target-v2-content-mapper';
import {
  TARGET_V2_EDIT_MAPPING_VERSION,
  findProtectedBlockViolations,
  fromChangeProposal,
  toSemanticEditRequest,
} from './target-v2-edit-mapper';
import {
  TARGET_V2_EVIDENCE_MAPPING_VERSION,
  fromEvidenceItems,
  toEvidenceSearchRequest,
} from './target-v2-evidence-mapper';
import {
  TARGET_V2_VALIDATION_MAPPING_VERSION,
  fromValidationReport,
  toValidationRequest,
} from './target-v2-validation-mapper';
import {
  guardChangeProposal,
  guardEvidenceSearchResponse,
  guardGenerationAccepted,
  guardGenerationStatus,
  guardOutlineSections,
  guardProviderCapabilities,
  guardValidationReport,
} from './target-v2-response.guard';
import {
  MockTargetV2Transport,
  TargetV2TransportError,
  type TargetV2Transport,
} from './mock-target-v2-transport';
import { isTerminalTargetV2Event, parseTargetV2Sse } from './target-v2-sse.assumed';
import {
  capabilityForOperation,
  type ContentCapable,
  type EvidenceSearchCapable,
  type JobLifecycleCapable,
  type ProviderCallContext,
  type ProviderCapabilitiesPayload,
  type SemanticEditCapable,
  type T3qContentRequest,
  type T3qContentResult,
  type T3qEvidenceSearchRequest,
  type T3qEvidenceSearchResult,
  type T3qJobAcceptedPayload,
  type T3qJobEventsPayload,
  type T3qJobRetryRequest,
  type T3qJobStatusPayload,
  type T3qPlanError,
  type T3qPlanFailure,
  type T3qPlanOperation,
  type T3qPlanProvider,
  type T3qPlanResult,
  type T3qPlanTrace,
  type T3qSemanticEditRequest,
  type T3qSemanticEditResult,
  type T3qTocRequest,
  type T3qTocResult,
  type T3qValidationRequest,
  type T3qValidationResult,
  type TocCapable,
  type ValidationCapable,
} from './t3q-plan-port';

/**
 * Adapter for the REQUESTED target-v2 contract 1.0.1-request (CC-125 toc;
 * CC-135 content/semantic edit/evidence/validation/job lifecycle). The
 * contract is NOT T3Q-accepted (OB-10/OB-11): this adapter runs against the
 * in-process mock transport only, every v2 capability stays MOCK_ONLY
 * (CR-T3Q-* invariant), and nothing here may ever be reported as actual T3Q
 * support. Faithful parts: the 202 → poll → terminal job flow, ErrorResponse
 * on non-2xx (thrown as TargetV2TransportError by transports), SSE framing
 * per UNE's `.assumed` convention.
 */

export const TARGET_V2_JOB_MAPPING_VERSION = 'v2-1.0.1-request@1';

export interface TargetV2T3qPlanAdapterOptions {
  transport?: TargetV2Transport;
  /** A non-mock transport is refused at construction unless this is set
   * (review m-8/F-4): the v2 adapter has NO timeout/retry/circuit-breaker/
   * rate-limit policy yet — those are CC-400 scope — so reaching a live
   * wire must be an explicit, reviewed decision, not a constructor default. */
  allowLiveTransport?: boolean;
  /** Poll pacing — injected in tests to run instantly. */
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxPolls?: number;
  now?: () => number;
}

/** UNE-internal marker for values that only exist because the mock flow
 * needs them (documentId/baseRevisionId before CC-150). A LIVE transport
 * must never see these — the adapter fail-closes on the prefix (review M2:
 * the block must be a mechanism, not the absence of a real transport). */
export const UNE_MOCK_PLACEHOLDER_PREFIX = 'une-mock:';

export class TargetV2T3qPlanAdapter
  implements
    T3qPlanProvider,
    TocCapable,
    ContentCapable,
    SemanticEditCapable,
    EvidenceSearchCapable,
    ValidationCapable,
    JobLifecycleCapable
{
  readonly providerCode = 'T3Q' as const;
  readonly adapterId = 'mock-target-v2-1.0.1';
  readonly variant = 'target-v2' as const;
  readonly runtimeMode: 'mock' | 'live';
  readonly defaultMappingVersion = TARGET_V2_TOC_MAPPING_VERSION;

  private readonly transport: TargetV2Transport;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly now: () => number;

  constructor(options: TargetV2T3qPlanAdapterOptions = {}) {
    this.transport = options.transport ?? new MockTargetV2Transport();
    this.runtimeMode = this.transport instanceof MockTargetV2Transport ? 'mock' : 'live';
    if (this.runtimeMode === 'live' && options.allowLiveTransport !== true) {
      throw new Error(
        'TargetV2T3qPlanAdapter: live transport는 명시적 allowLiveTransport 없이 금지 — ' +
          'v2 어댑터에는 타임아웃/재시도/서킷브레이커/레이트리밋 정책이 아직 없다(CC-400 소유, ADR-28).',
      );
    }
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(() => resolve(), ms)));
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.maxPolls = options.maxPolls ?? 40;
    this.now = options.now ?? (() => Date.now());
  }

  supports(operation: T3qPlanOperation): boolean {
    return (
      operation === 'toc' ||
      operation === 'content' ||
      operation === 'semanticEdit' ||
      operation === 'evidenceSearch' ||
      operation === 'validate' ||
      operation === 'jobStatus'
    );
  }

  capabilityFor(operation: T3qPlanOperation): PlanFeatureCapability | undefined {
    return capabilityForOperation('target-v2', operation);
  }

  // ── toc (CC-125) ──

  async generateToc(request: T3qTocRequest, context: ProviderCallContext): Promise<T3qTocResult> {
    const op = this.begin('toc', TARGET_V2_TOC_MAPPING_VERSION, request.trace);
    if (op.rejected) return op.rejected;
    let rawRequest: unknown;
    try {
      rawRequest = toTocGenerationRequest(
        request.planContext,
        this.requestContext(request.trace, context),
      );
    } catch (err) {
      return op.mappingFailure(err);
    }
    let rawAccepted: unknown;
    let rawStatus: unknown;
    try {
      rawAccepted = await this.transport.submitToc(rawRequest as never);
      const accepted = guardGenerationAccepted(rawAccepted);
      for (let poll = 0; poll < this.maxPolls; poll += 1) {
        rawStatus = await this.transport.getStatus(accepted.generationId);
        const status = guardGenerationStatus(rawStatus);
        if (status.status === 'COMPLETED') {
          const outline = guardOutlineSections(status.outline ?? [], '/outline');
          return op.success({ tree: fromOutlineSections(outline) }, rawRequest, {
            accepted: rawAccepted,
            status: rawStatus,
          });
        }
        if (status.status === 'FAILED' || status.status === 'CANCELLED') {
          return op.failure(
            rawRequest,
            { accepted: rawAccepted, status: rawStatus },
            {
              code: 'T3Q_PROVIDER_ERROR',
              message: terminalErrorMessage(status.error, status.status),
              retryable: status.status === 'FAILED',
            },
          );
        }
        await this.sleep(this.pollIntervalMs);
      }
      return op.failure(
        rawRequest,
        { accepted: rawAccepted, status: rawStatus },
        {
          code: 'T3Q_TIMEOUT',
          message: `generation did not complete within ${this.maxPolls} polls`,
          retryable: true,
        },
      );
    } catch (err) {
      return op.thrownFailure(err, rawRequest, rawAccepted, rawStatus);
    }
  }

  // ── content (CC-135, CR-T3Q-002) ──

  async generateContent(
    request: T3qContentRequest,
    context: ProviderCallContext,
  ): Promise<T3qContentResult> {
    const op = this.begin('content', TARGET_V2_CONTENT_MAPPING_VERSION, request.trace);
    if (op.rejected) return op.rejected;
    let rawRequest: unknown;
    try {
      rawRequest = toContentGenerationRequest(
        request.planContext,
        request.outline,
        this.requestContext(request.trace, context),
        {
          ...(request.targetNodeKeys ? { targetNodeKeys: request.targetNodeKeys } : {}),
          ...(request.protectedBlockKeys ? { protectedBlockKeys: request.protectedBlockKeys } : {}),
          ...(request.stream !== undefined ? { stream: request.stream } : {}),
        },
      );
    } catch (err) {
      return op.mappingFailure(err);
    }
    let rawAccepted: unknown;
    let rawStatus: unknown;
    try {
      rawAccepted = await this.transport.submitContent(rawRequest as never);
      const accepted = guardGenerationAccepted(rawAccepted);
      for (let poll = 0; poll < this.maxPolls; poll += 1) {
        rawStatus = await this.transport.getStatus(accepted.generationId);
        const status = guardGenerationStatus(rawStatus);
        if (status.status === 'COMPLETED') {
          const mapping = fromContentBlocks(
            request.outline,
            status.blocks ?? [],
            request.targetNodeKeys,
          );
          // UNION of declared and observed failures (review M-2): a provider
          // that reports COMPLETED+failedTargetIds:[] while omitting blocks
          // must not have its self-report override the observed omission —
          // that would be fail-open at exactly the seam the guard protects.
          const failedNodeKeys = [
            ...new Set([...(status.failedTargetIds ?? []), ...mapping.failedNodeKeys]),
          ].sort();
          return op.success({ sections: mapping.sections, failedNodeKeys }, rawRequest, {
            accepted: rawAccepted,
            status: rawStatus,
          });
        }
        if (status.status === 'FAILED' || status.status === 'CANCELLED') {
          return op.failure(
            rawRequest,
            { accepted: rawAccepted, status: rawStatus },
            {
              code: 'T3Q_PROVIDER_ERROR',
              message: terminalErrorMessage(status.error, status.status),
              retryable: status.status === 'FAILED',
            },
          );
        }
        // QUEUED/RUNNING/PARTIAL keep polling — PARTIAL is NON-terminal by
        // UNE's fail-closed reading (ADR-28 D4); raw progress is preserved
        // in the eventual result either way.
        await this.sleep(this.pollIntervalMs);
      }
      return op.failure(
        rawRequest,
        { accepted: rawAccepted, status: rawStatus },
        {
          code: 'T3Q_TIMEOUT',
          message: `generation did not complete within ${this.maxPolls} polls`,
          retryable: true,
        },
      );
    } catch (err) {
      return op.thrownFailure(err, rawRequest, rawAccepted, rawStatus);
    }
  }

  // ── semantic edit (CC-135, CR-T3Q-004) ──

  async requestSemanticEdit(
    request: T3qSemanticEditRequest,
    context: ProviderCallContext,
  ): Promise<T3qSemanticEditResult> {
    const op = this.begin('semanticEdit', TARGET_V2_EDIT_MAPPING_VERSION, request.trace);
    if (op.rejected) return op.rejected;
    let rawRequest: unknown;
    try {
      rawRequest = toSemanticEditRequest(request, this.requestContext(request.trace, context));
    } catch (err) {
      return op.mappingFailure(err);
    }
    let rawResponse: unknown;
    try {
      rawResponse = await this.transport.requestSemanticEdit(rawRequest as never);
      const proposal = guardChangeProposal(rawResponse);
      const violations = findProtectedBlockViolations(proposal, request.protectedBlockKeys ?? []);
      if (violations.length > 0) {
        return op.failure(rawRequest, rawResponse, {
          code: 'T3Q_RESPONSE_CONTRACT_VIOLATION',
          message: `제안이 보호 블록을 침범했습니다: ${violations.join(', ')} — 전체 격리(ADR-28 D8)`,
          retryable: false,
        });
      }
      return op.success(fromChangeProposal(proposal), rawRequest, rawResponse);
    } catch (err) {
      return op.thrownFailure(err, rawRequest, rawResponse);
    }
  }

  // ── evidence search (CC-135, CR-T3Q-005) ──

  async searchEvidence(
    request: T3qEvidenceSearchRequest,
    context: ProviderCallContext,
  ): Promise<T3qEvidenceSearchResult> {
    const op = this.begin('evidenceSearch', TARGET_V2_EVIDENCE_MAPPING_VERSION, request.trace);
    if (op.rejected) return op.rejected;
    let rawRequest: unknown;
    try {
      rawRequest = toEvidenceSearchRequest(request, this.requestContext(request.trace, context));
    } catch (err) {
      return op.mappingFailure(err);
    }
    let rawResponse: unknown;
    try {
      rawResponse = await this.transport.searchEvidence(rawRequest as never);
      const response = guardEvidenceSearchResponse(rawResponse);
      const sentRequestId = (rawRequest as { requestId: string }).requestId;
      if (response.requestId !== sentRequestId) {
        return op.failure(rawRequest, rawResponse, {
          code: 'T3Q_RESPONSE_CONTRACT_VIOLATION',
          message: `response requestId ${response.requestId} != request ${sentRequestId}`,
          retryable: false,
        });
      }
      return op.success({ items: fromEvidenceItems(response.items) }, rawRequest, rawResponse);
    } catch (err) {
      return op.thrownFailure(err, rawRequest, rawResponse);
    }
  }

  // ── validation (CC-135, CR-T3Q-006 — MOCK_ONLY verdict, ADR-28 D9) ──

  async validateContent(
    request: T3qValidationRequest,
    context: ProviderCallContext,
  ): Promise<T3qValidationResult> {
    const op = this.begin('validate', TARGET_V2_VALIDATION_MAPPING_VERSION, request.trace);
    if (op.rejected) return op.rejected;
    let rawRequest: unknown;
    try {
      rawRequest = toValidationRequest(request, this.requestContext(request.trace, context));
    } catch (err) {
      return op.mappingFailure(err);
    }
    let rawResponse: unknown;
    try {
      rawResponse = await this.transport.validateContent(rawRequest as never);
      const report = guardValidationReport(rawResponse);
      return op.success(fromValidationReport(report), rawRequest, rawResponse);
    } catch (err) {
      return op.thrownFailure(err, rawRequest, rawResponse);
    }
  }

  // ── job lifecycle (CC-135, CR-T3Q-003/009 — reported under 'jobStatus') ──

  async getJobStatus(
    jobRef: string,
    _context: ProviderCallContext,
  ): Promise<T3qPlanResult<T3qJobStatusPayload>> {
    const op = this.begin('jobStatus', TARGET_V2_JOB_MAPPING_VERSION);
    let rawResponse: unknown;
    try {
      rawResponse = await this.transport.getStatus(jobRef);
      const status = guardGenerationStatus(rawResponse);
      return op.success(toJobStatusPayload(status), { jobRef }, rawResponse);
    } catch (err) {
      return op.thrownFailure(err, { jobRef }, rawResponse);
    }
  }

  async cancelJob(
    jobRef: string,
    reason: string | undefined,
    context: ProviderCallContext,
  ): Promise<T3qPlanResult<T3qJobStatusPayload>> {
    const op = this.begin('jobStatus', TARGET_V2_JOB_MAPPING_VERSION);
    const rawRequest = { jobRef, ...(reason !== undefined ? { reason } : {}) };
    let rawResponse: unknown;
    try {
      rawResponse = await this.transport.cancelJob(jobRef, reason, context.correlationId);
      const status = guardGenerationStatus(rawResponse);
      return op.success(toJobStatusPayload(status), rawRequest, rawResponse);
    } catch (err) {
      return op.thrownFailure(err, rawRequest, rawResponse);
    }
  }

  async retryJobTargets(
    jobRef: string,
    request: T3qJobRetryRequest,
    context: ProviderCallContext,
  ): Promise<T3qPlanResult<T3qJobAcceptedPayload>> {
    const op = this.begin('jobStatus', TARGET_V2_JOB_MAPPING_VERSION);
    const rawRequest = { jobRef, ...request };
    if (request.targetIds.length === 0) {
      return op.failure(rawRequest, undefined, {
        code: 'T3Q_REQUEST_REJECTED',
        message: 'retry targetIds must not be empty',
        retryable: false,
      });
    }
    let rawResponse: unknown;
    try {
      rawResponse = await this.transport.retryJobTargets(jobRef, request, context.correlationId);
      const accepted = guardGenerationAccepted(rawResponse);
      return op.success(
        { jobRef: accepted.generationId, acceptedAt: accepted.acceptedAt },
        rawRequest,
        rawResponse,
      );
    } catch (err) {
      return op.thrownFailure(err, rawRequest, rawResponse);
    }
  }

  async streamJobEvents(
    jobRef: string,
    options: { lastEventId?: number },
    context: ProviderCallContext,
  ): Promise<T3qPlanResult<T3qJobEventsPayload>> {
    const op = this.begin('jobStatus', TARGET_V2_JOB_MAPPING_VERSION);
    const rawRequest = {
      jobRef,
      ...(options.lastEventId !== undefined ? { lastEventId: options.lastEventId } : {}),
    };
    let rawResponse: unknown;
    try {
      rawResponse = await this.transport.streamEvents(
        jobRef,
        options.lastEventId,
        context.correlationId,
      );
      if (typeof rawResponse !== 'string') {
        return op.failure(rawRequest, rawResponse, {
          code: 'T3Q_MALFORMED_RESPONSE',
          message: 'event stream body must be a string transcript',
          retryable: false,
        });
      }
      let frames: ReturnType<typeof parseTargetV2Sse>;
      try {
        frames = parseTargetV2Sse(rawResponse);
      } catch (sseErr) {
        return op.failure(rawRequest, rawResponse, {
          code: 'T3Q_MALFORMED_RESPONSE',
          message: sseErr instanceof Error ? sseErr.message : String(sseErr),
          retryable: false,
        });
      }
      const last = frames[frames.length - 1];
      if (!last) {
        // Empty replay AFTER a resume point is a legitimate no-op — the
        // caller already consumed the terminal event (QA F-3: this is a
        // deterministically permanent condition, never a retryable error).
        if (options.lastEventId !== undefined) {
          return op.success({ frames: [] }, rawRequest, rawResponse);
        }
        return op.failure(rawRequest, rawResponse, {
          code: 'T3Q_MALFORMED_RESPONSE',
          message: 'event stream carried no frames at all',
          retryable: false,
        });
      }
      // A non-empty stream must still END terminally — same principle as
      // legacy [DONE]: a truncated stream is not a partial result.
      if (!isTerminalTargetV2Event(last.event)) {
        return op.failure(rawRequest, rawResponse, {
          code: 'T3Q_MALFORMED_RESPONSE',
          message: 'event stream ended without job.completed/job.failed — not a partial result',
          retryable: true,
        });
      }
      return op.success({ frames }, rawRequest, rawResponse);
    } catch (err) {
      return op.thrownFailure(err, rawRequest, rawResponse);
    }
  }

  async discoverCapabilities(
    _context: ProviderCallContext,
  ): Promise<T3qPlanResult<ProviderCapabilitiesPayload>> {
    const op = this.begin('jobStatus', TARGET_V2_JOB_MAPPING_VERSION);
    let rawResponse: unknown;
    try {
      rawResponse = await this.transport.getCapabilities();
      const capabilities = guardProviderCapabilities(rawResponse);
      const features: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(capabilities.features)) {
        if (typeof value === 'boolean') features[key] = value;
      }
      return op.success(
        {
          providerBuild: capabilities.providerBuild,
          contractVersions: [...capabilities.contractVersions],
          features,
          limits: { ...(capabilities.limits as Record<string, unknown>) },
        },
        {},
        rawResponse,
      );
    } catch (err) {
      return op.thrownFailure(err, {}, rawResponse);
    }
  }

  // ── shared plumbing ──

  private requestContext(
    trace: T3qPlanTrace | undefined,
    context: ProviderCallContext,
  ): TargetV2RequestContext {
    const t = trace ?? {};
    return {
      requestId: t.requestId ?? '',
      correlationId: context.correlationId,
      tenantId: t.tenantId ?? '',
      userId: t.userId ?? '',
      planId: t.planId ?? '',
      documentId: t.documentId ?? '',
      baseRevisionId: t.baseRevisionId ?? '',
      planContextSnapshotId: t.planContextSnapshotId ?? '',
      contextHash: t.contextHash ?? '',
      requestedAt: t.requestedAt ?? '',
    };
  }

  /** Per-call operation frame: latency bookkeeping, live-placeholder
   * fail-close, and uniform failure construction. */
  private begin(
    operation: T3qPlanOperation,
    mappingVersion: string,
    trace?: T3qPlanTrace,
  ): OperationFrame {
    const startedAt = this.now();
    const now = this.now;
    const adapterId = this.adapterId;
    const frame: OperationFrame = {
      rejected: undefined,
      success: (data, rawRequest, rawResponse) => ({
        ok: true,
        adapterId,
        mappingVersion,
        operation,
        data,
        rawRequest,
        rawResponse,
        latencyMs: now() - startedAt,
      }),
      failure: (rawRequest, rawResponse, error) => ({
        ok: false,
        adapterId,
        mappingVersion,
        operation,
        latencyMs: now() - startedAt,
        ...(rawRequest !== undefined ? { rawRequest } : {}),
        ...(rawResponse !== undefined ? { rawResponse } : {}),
        error,
      }),
      mappingFailure: (err) =>
        frame.failure(undefined, undefined, {
          // A missing binding is a UNE-side request defect, not a provider error.
          code: 'T3Q_REQUEST_REJECTED',
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        }),
      thrownFailure: (err, rawRequest, ...raws) => {
        const rawResponse = raws.find((raw) => raw !== undefined);
        const combined =
          raws.length > 1 && raws.some((raw) => raw !== undefined)
            ? { accepted: raws[0], status: raws[1] }
            : rawResponse;
        if (err instanceof TargetV2TransportError) {
          return frame.failure(rawRequest, err.body, transportError(err));
        }
        return frame.failure(rawRequest, raws.length > 1 ? combined : rawResponse, {
          code: 'T3Q_RESPONSE_CONTRACT_VIOLATION',
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        });
      },
    };
    if (this.runtimeMode === 'live' && trace) {
      const placeholder = Object.entries(trace).find(
        ([, value]) => typeof value === 'string' && value.startsWith(UNE_MOCK_PLACEHOLDER_PREFIX),
      );
      if (placeholder) {
        frame.rejected = frame.failure(undefined, undefined, {
          code: 'T3Q_REQUEST_REJECTED',
          message:
            `${placeholder[0]}에 mock 전용 플레이스홀더(${UNE_MOCK_PLACEHOLDER_PREFIX}*)가 ` +
            'live transport로 전달되려 했습니다 — 실값(CC-150) 없이 실 호출 불가.',
          retryable: false,
        });
      }
    }
    return frame;
  }
}

interface OperationFrame {
  rejected: T3qPlanFailure | undefined;
  success: <T>(
    data: T,
    rawRequest: unknown,
    rawResponse: unknown,
  ) => T3qPlanResult<T> & { ok: true };
  failure: (rawRequest: unknown, rawResponse: unknown, error: T3qPlanError) => T3qPlanFailure;
  mappingFailure: (err: unknown) => T3qPlanFailure;
  thrownFailure: (err: unknown, rawRequest: unknown, ...raws: unknown[]) => T3qPlanFailure;
}

function transportError(err: TargetV2TransportError): T3qPlanError {
  const { httpStatus } = err;
  const message =
    err.body && typeof err.body === 'object' && 'message' in err.body
      ? String((err.body as { message?: unknown }).message)
      : `transport error ${httpStatus}`;
  if (httpStatus === 409) return { code: 'T3Q_CONFLICT', message, retryable: false, httpStatus };
  if (httpStatus === 404)
    return { code: 'T3Q_ENDPOINT_NOT_FOUND', message, retryable: false, httpStatus };
  if (httpStatus === 400 || httpStatus === 422)
    return { code: 'T3Q_REQUEST_REJECTED', message, retryable: false, httpStatus };
  if (httpStatus === 401 || httpStatus === 403)
    return { code: 'T3Q_AUTH_ERROR', message, retryable: false, httpStatus };
  if (httpStatus === 429) return { code: 'T3Q_RATE_LIMITED', message, retryable: true, httpStatus };
  return {
    code: 'T3Q_PROVIDER_ERROR',
    message,
    retryable: httpStatus >= 500,
    httpStatus,
  };
}

function terminalErrorMessage(error: unknown, status: string): string {
  return error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message)
    : `generation ended as ${status}`;
}

function toJobStatusPayload(status: {
  generationId: string;
  status: string;
  progress: number;
  completedTargetIds?: string[];
  failedTargetIds?: string[];
}): T3qJobStatusPayload {
  return {
    jobRef: status.generationId,
    status: status.status as T3qJobStatusPayload['status'],
    progress: status.progress,
    completedTargetIds: [...(status.completedTargetIds ?? [])],
    failedTargetIds: [...(status.failedTargetIds ?? [])],
  };
}
