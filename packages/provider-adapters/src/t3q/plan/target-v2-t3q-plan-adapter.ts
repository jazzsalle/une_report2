import type { PlanFeatureCapability } from '../../capability/plan-feature-capabilities';
import {
  TARGET_V2_TOC_MAPPING_VERSION,
  TargetV2MappingError,
  fromOutlineSections,
  toTocGenerationRequest,
  type TargetV2RequestContext,
} from './target-v2-toc-mapper';
import {
  guardGenerationAccepted,
  guardGenerationStatus,
  guardOutlineSections,
} from './target-v2-response.guard';
import { MockTargetV2Transport, type TargetV2Transport } from './mock-target-v2-transport';
import {
  capabilityForOperation,
  type ProviderCallContext,
  type T3qPlanFailure,
  type T3qPlanOperation,
  type T3qPlanProvider,
  type T3qTocRequest,
  type T3qTocResult,
  type TocCapable,
} from './t3q-plan-port';

/**
 * Adapter for the REQUESTED target-v2 contract 1.0.1-request (CC-125,
 * ADR-26 D5). The contract is NOT T3Q-accepted (OB-10): this adapter runs
 * against the in-process mock transport only, capability tocV2 stays
 * MOCK_ONLY (CR-T3Q-* invariant), and nothing here may ever be reported as
 * actual T3Q support. Faithful part: the 202 → poll → COMPLETED job flow.
 * SSE/cancel/semantic edit/evidence/validation are CC-135.
 */

export interface TargetV2T3qPlanAdapterOptions {
  transport?: TargetV2Transport;
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

export class TargetV2T3qPlanAdapter implements T3qPlanProvider, TocCapable {
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
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(() => resolve(), ms)));
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.maxPolls = options.maxPolls ?? 40;
    this.now = options.now ?? (() => Date.now());
  }

  supports(operation: T3qPlanOperation): boolean {
    return operation === 'toc';
  }

  capabilityFor(operation: T3qPlanOperation): PlanFeatureCapability | undefined {
    return capabilityForOperation('target-v2', operation);
  }

  async generateToc(request: T3qTocRequest, context: ProviderCallContext): Promise<T3qTocResult> {
    const startedAt = this.now();
    const trace = request.trace ?? {};
    if (this.runtimeMode === 'live') {
      const placeholder = Object.entries(trace).find(
        ([, value]) => typeof value === 'string' && value.startsWith(UNE_MOCK_PLACEHOLDER_PREFIX),
      );
      if (placeholder) {
        return this.failure(startedAt, undefined, undefined, {
          code: 'T3Q_REQUEST_REJECTED',
          message:
            `${placeholder[0]}에 mock 전용 플레이스홀더(${UNE_MOCK_PLACEHOLDER_PREFIX}*)가 ` +
            'live transport로 전달되려 했습니다 — 실값(CC-150) 없이 실 호출 불가.',
          retryable: false,
        });
      }
    }
    let rawRequest: unknown;
    try {
      const requestContext: TargetV2RequestContext = {
        requestId: trace.requestId ?? '',
        correlationId: context.correlationId,
        tenantId: trace.tenantId ?? '',
        userId: trace.userId ?? '',
        planId: trace.planId ?? '',
        documentId: trace.documentId ?? '',
        baseRevisionId: trace.baseRevisionId ?? '',
        planContextSnapshotId: trace.planContextSnapshotId ?? '',
        contextHash: trace.contextHash ?? '',
        requestedAt: trace.requestedAt ?? '',
      };
      rawRequest = toTocGenerationRequest(request.planContext, requestContext);
    } catch (err) {
      // A missing binding is a UNE-side request defect, not a provider error.
      return this.failure(startedAt, undefined, undefined, {
        code: 'T3Q_REQUEST_REJECTED',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      });
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
          return {
            ok: true,
            adapterId: this.adapterId,
            mappingVersion: TARGET_V2_TOC_MAPPING_VERSION,
            operation: 'toc',
            data: { tree: fromOutlineSections(outline) },
            rawRequest,
            rawResponse: { accepted: rawAccepted, status: rawStatus },
            latencyMs: this.now() - startedAt,
          };
        }
        if (status.status === 'FAILED' || status.status === 'CANCELLED') {
          return this.failure(
            startedAt,
            rawRequest,
            { accepted: rawAccepted, status: rawStatus },
            {
              code: 'T3Q_PROVIDER_ERROR',
              message:
                status.error && typeof status.error === 'object' && 'message' in status.error
                  ? String((status.error as { message?: unknown }).message)
                  : `generation ended as ${status.status}`,
              retryable: status.status === 'FAILED',
            },
          );
        }
        await this.sleep(this.pollIntervalMs);
      }
      return this.failure(
        startedAt,
        rawRequest,
        { accepted: rawAccepted, status: rawStatus },
        {
          code: 'T3Q_TIMEOUT',
          message: `generation did not complete within ${this.maxPolls} polls`,
          retryable: true,
        },
      );
    } catch (err) {
      const violation = err instanceof TargetV2MappingError || err instanceof Error;
      return this.failure(
        startedAt,
        rawRequest,
        rawStatus !== undefined || rawAccepted !== undefined
          ? { accepted: rawAccepted, status: rawStatus }
          : undefined,
        {
          code: 'T3Q_RESPONSE_CONTRACT_VIOLATION',
          message: violation && err instanceof Error ? err.message : String(err),
          retryable: false,
        },
      );
    }
  }

  private failure(
    startedAt: number,
    rawRequest: unknown,
    rawResponse: unknown,
    error: T3qPlanFailure['error'],
  ): T3qPlanFailure {
    return {
      ok: false,
      adapterId: this.adapterId,
      mappingVersion: TARGET_V2_TOC_MAPPING_VERSION,
      operation: 'toc',
      latencyMs: this.now() - startedAt,
      ...(rawRequest !== undefined ? { rawRequest } : {}),
      ...(rawResponse !== undefined ? { rawResponse } : {}),
      error,
    };
  }
}
