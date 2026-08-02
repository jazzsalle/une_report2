import { validateContentDrafts, type ContentDraft } from '@une/domain';
import { CircuitBreaker, type CircuitState } from './http/circuit-breaker';
import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  T3qHttpClient,
  T3qHttpError,
  type T3qHttpClientOptions,
} from './http/t3q-http-client';
import { LEGACY_TOC_MAPPING_VERSION, fromTocResponse, toPlanTocData } from './legacy-toc-mapper';
import {
  LEGACY_CONTENT_MAPPING_VERSION,
  fromContentResponse,
  mapContentSections,
  toPlanContentData,
} from './legacy-content-mapper';
import { guardContentSection } from './legacy-content-response.guard';
import { parseLegacySseTranscript } from './legacy-sse';
import type { PlanFeatureCapability } from '../../capability/plan-feature-capabilities';
import {
  capabilityForOperation,
  notSupported,
  type ContentCapable,
  type ProviderCallContext,
  type T3qContentRequest,
  type T3qContentResult,
  type T3qPlanFailure,
  type T3qPlanOperation,
  type T3qPlanProvider,
  type T3qPlanResult,
  type T3qTocRequest,
  type T3qTocResult,
  type T3qTransportProfile,
  type TocCapable,
} from './t3q-plan-port';

/**
 * Real HTTP adapter for the transcribed T3Q legacy v0.8.5 contract
 * (CC-125, ADR-26 D3). UNVERIFIED against the actual provider: auth,
 * timeouts, rate limits, and the error schema are OPEN (OB-01) — this
 * adapter is exercised only against local fixture servers until CC-400
 * closes the binding. Capability legacyToc is UNE_ADAPTER_READY, never
 * T3Q_*_VERIFIED, while OB-01 stays open.
 *
 * Paths are constants FROM the pinned transcript (facts, not guesses);
 * base URL and auth are injected — see T3qHttpClient for the OB-01 rules.
 */

export const LEGACY_TOC_PATH = '/model-api/ae894/reports/plan/toc';
export const LEGACY_CONTENT_PATH = '/model-api/ae894/reports/plan/content';

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return '(invalid-url)';
  }
}

/** Structural sanity on mapped drafts (same rule as validateTocTree on the
 * toc path): unbounded or empty provider trees never enter job pipelines. */
function assertDraftSanity(sections: readonly ContentDraft[]): void {
  const issues = validateContentDrafts(sections);
  if (issues.length > 0) {
    throw new Error(
      `content draft structure invalid: ${issues
        .slice(0, 5)
        .map((issue) => `${issue.code}@${issue.path}`)
        .join(', ')}`,
    );
  }
}

export type LegacyT3qPlanAdapterOptions = T3qHttpClientOptions & {
  /** Circuit breaker tuning (ADR-26 D3: 5 consecutive → open 30s). */
  breakerFailureThreshold?: number;
  breakerOpenMs?: number;
  now?: () => number;
};

/** Internal: a guard/parser rejection AFTER a successful transport round
 * trip. Carries the raw response so the failure result keeps the trace —
 * the CC-120 runner lost rawResponse on exactly this path (ADR-26 D2). */
class ContractViolation extends Error {
  constructor(
    readonly rawResponse: unknown,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ContractViolation';
  }
}

export class LegacyT3qPlanAdapter implements T3qPlanProvider, TocCapable, ContentCapable {
  readonly providerCode = 'T3Q' as const;
  readonly adapterId = 'legacy-http-v0.8.5';
  readonly variant = 'legacy' as const;
  readonly runtimeMode = 'live' as const;
  readonly transportProfile: T3qTransportProfile;
  readonly defaultMappingVersion = LEGACY_TOC_MAPPING_VERSION;

  private readonly client: T3qHttpClient;
  private readonly breakers: Map<T3qPlanOperation, CircuitBreaker>;
  private readonly now: () => number;

  constructor(options: LegacyT3qPlanAdapterOptions) {
    this.client = new T3qHttpClient(options);
    this.transportProfile = {
      baseUrlHost: hostOf(options.baseUrl),
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      responseTimeoutMs: options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
    };
    this.now = options.now ?? (() => Date.now());
    const breakerOptions = {
      failureThreshold: options.breakerFailureThreshold ?? 5,
      openMs: options.breakerOpenMs ?? 30_000,
      now: this.now,
    };
    this.breakers = new Map([
      ['toc', new CircuitBreaker(breakerOptions)],
      ['content', new CircuitBreaker(breakerOptions)],
    ]);
  }

  supports(operation: T3qPlanOperation): boolean {
    return operation === 'toc' || operation === 'content';
  }

  capabilityFor(operation: T3qPlanOperation): PlanFeatureCapability | undefined {
    return capabilityForOperation('legacy', operation);
  }

  circuitState(operation: T3qPlanOperation): CircuitState {
    return this.breakers.get(operation)?.state() ?? 'closed';
  }

  async generateToc(request: T3qTocRequest, _context: ProviderCallContext): Promise<T3qTocResult> {
    const rawRequest = toPlanTocData(request.planContext);
    return this.call('toc', LEGACY_TOC_MAPPING_VERSION, rawRequest, async () => {
      const response = await this.client.postJson(LEGACY_TOC_PATH, rawRequest);
      try {
        return {
          rawResponse: response.bodyJson,
          httpStatus: response.status,
          data: { tree: fromTocResponse(response.bodyJson) },
        };
      } catch (err) {
        throw new ContractViolation(response.bodyJson ?? response.bodyText, err);
      }
    });
  }

  async generateContent(
    request: T3qContentRequest,
    _context: ProviderCallContext,
  ): Promise<T3qContentResult> {
    const stream = request.stream ?? true;
    const rawRequest = toPlanContentData(request.planContext, request.outline, stream);
    return this.call('content', LEGACY_CONTENT_MAPPING_VERSION, rawRequest, async () => {
      const response = await this.client.postJson(LEGACY_CONTENT_PATH, rawRequest, stream);
      if (response.contentType.includes('text/event-stream')) {
        // Framing is a UNE assumption (OB-01) — see legacy-sse.ts. Streamed
        // frames each carry one top-level ContentSection.
        try {
          const payloads = parseLegacySseTranscript(response.bodyText);
          const sections: ContentDraft[] = mapContentSections(
            payloads.map((payload, index) => guardContentSection(payload, `/stream/${index}`)),
          );
          assertDraftSanity(sections);
          return {
            rawResponse: response.bodyText,
            httpStatus: response.status,
            data: { sections },
          };
        } catch (err) {
          throw new ContractViolation(response.bodyText, err);
        }
      }
      try {
        const sections = fromContentResponse(response.bodyJson);
        assertDraftSanity(sections);
        return {
          rawResponse: response.bodyJson,
          httpStatus: response.status,
          data: { sections },
        };
      } catch (err) {
        throw new ContractViolation(response.bodyJson ?? response.bodyText, err);
      }
    });
  }

  /** Shared failure normalization: breaker check → HTTP call → guard/map.
   * EVERY failure path returns a result value carrying the raw request (and
   * response when one arrived) — the CC-120 runner lost rawResponse whenever
   * a guard threw, exactly when the trace mattered most (ADR-26 D2/D8). */
  private async call<T>(
    operation: T3qPlanOperation,
    mappingVersion: string,
    rawRequest: unknown,
    execute: () => Promise<{ rawResponse: unknown; httpStatus: number; data: T }>,
  ): Promise<T3qPlanResult<T>> {
    if (!this.supports(operation)) {
      return notSupported(this.adapterId, mappingVersion, operation);
    }
    const breaker = this.breakers.get(operation) as CircuitBreaker;
    const startedAt = this.now();
    if (!breaker.allowRequest()) {
      return this.failure(operation, mappingVersion, startedAt, rawRequest, undefined, {
        code: 'T3Q_CIRCUIT_OPEN',
        message: `circuit open for ${operation} (연속 실패 누적 — 잠시 후 자동 재시도)`,
        retryable: true,
      });
    }
    try {
      const { rawResponse, httpStatus, data } = await execute();
      breaker.onSuccess();
      return {
        ok: true,
        data,
        rawRequest,
        rawResponse,
        latencyMs: this.now() - startedAt,
        adapterId: this.adapterId,
        mappingVersion,
        operation,
        httpStatus,
      };
    } catch (err) {
      breaker.onFailure();
      if (err instanceof T3qHttpError) {
        return this.failure(
          operation,
          mappingVersion,
          startedAt,
          rawRequest,
          err.bodyText,
          err.toPlanError(),
        );
      }
      if (err instanceof ContractViolation) {
        return this.failure(operation, mappingVersion, startedAt, rawRequest, err.rawResponse, {
          code: 'T3Q_RESPONSE_CONTRACT_VIOLATION',
          message: err.message,
          retryable: false,
        });
      }
      // Unexpected mapper defect — still a result value, raw request kept.
      return this.failure(operation, mappingVersion, startedAt, rawRequest, undefined, {
        code: 'T3Q_RESPONSE_CONTRACT_VIOLATION',
        message: err instanceof Error ? err.message : String(err),
        retryable: false,
      });
    }
  }

  private failure(
    operation: T3qPlanOperation,
    mappingVersion: string,
    startedAt: number,
    rawRequest: unknown,
    rawResponse: unknown,
    error: T3qPlanFailure['error'],
  ): T3qPlanFailure {
    return {
      ok: false,
      adapterId: this.adapterId,
      mappingVersion,
      operation,
      latencyMs: this.now() - startedAt,
      rawRequest,
      ...(rawResponse !== undefined ? { rawResponse } : {}),
      error,
    };
  }
}
