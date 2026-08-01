import type { TocJobGenerationOption, TocNodeDraft } from '@une/domain';

/**
 * Narrow TOC-generation port (CC-120, ADR-25 D3). CC-125 absorbs this into
 * the full T3qPlanProvider port (toc/content/edit) behind which
 * LegacyT3qPlanAdapter and TargetV2T3qPlanAdapter both sit; the request/
 * result shapes and the mapper are designed to survive that move unchanged.
 *
 * Provider failures are RESULT VALUES, not exceptions — the worker records
 * them as job failures with raw traces (design 10 §4.2 traceability).
 */

export interface T3qTocRequest {
  /** UNE PlanContext content (plan-context.schema.json vocabulary). */
  planContext: Record<string, unknown>;
  generationOption?: TocJobGenerationOption;
}

export interface ProviderCallContext {
  correlationId: string;
}

export interface T3qTocSuccess {
  ok: true;
  tree: TocNodeDraft[];
  /** Raw provider request/response for traceability (rules: keep raw). */
  rawRequest: unknown;
  rawResponse: unknown;
  latencyMs: number;
}

export interface T3qTocFailure {
  ok: false;
  error: { code: string; message: string; retryable: boolean };
  rawRequest?: unknown;
  rawResponse?: unknown;
  latencyMs: number;
}

export type T3qTocResult = T3qTocSuccess | T3qTocFailure;

export interface T3qTocPort {
  readonly providerCode: 'T3Q';
  /** Identifies the concrete adapter in traces (e.g. 'mock-legacy-v0.8.5'). */
  readonly adapterId: string;
  /** Mapping contract version recorded with every job (rules: adapter schema
   * version for traceability). */
  readonly mappingVersion: string;
  generateToc(request: T3qTocRequest, context: ProviderCallContext): Promise<T3qTocResult>;
}
