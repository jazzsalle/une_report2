import type {
  ContentCitationDraft,
  ContentDraft,
  EditProposalDraft,
  EvidenceItemDraft,
  TocJobGenerationOption,
  TocNodeDraft,
  ValidationReportDraft,
} from '@une/domain';
import {
  getPlanFeatureCapability,
  type PlanFeatureCapability,
} from '../../capability/plan-feature-capabilities';

/**
 * Unified T3Q plan-generation port (CC-125, ADR-26 D1). Absorbs the CC-120
 * T3qTocPort as announced by ADR-25 D3. Shape:
 *
 * - `T3qPlanProvider` is the identity + capability base every adapter
 *   implements. The OPERATION VOCABULARY is complete now (it mirrors the two
 *   contracts and will not change); METHODS are only declared once their
 *   canonical return types exist — `TocCapable`/`ContentCapable` today,
 *   semantic edit/evidence/validation mixins arrive with CC-135 when their
 *   canonical types (ChangeProposal 등) are owned. Declaring them earlier
 *   would guess OB-10/11 response shapes (same reasoning as ADR-24 D8).
 * - Provider failures are RESULT VALUES, not exceptions — including contract
 *   violations and unsupported operations (ADR-26 D2). Raw request/response
 *   travel WITH the failure so the trace survives exactly when it matters.
 * - `adapterId`/`mappingVersion` are recorded PER RESULT, not read from the
 *   port constants: one adapter maps different operations with different
 *   mapping versions, and traceability rules bind the version to the call.
 */

export const T3Q_PLAN_OPERATIONS = [
  'toc',
  'content',
  'semanticEdit',
  'evidenceSearch',
  'validate',
  'jobStatus',
] as const;

export type T3qPlanOperation = (typeof T3Q_PLAN_OPERATIONS)[number];

export const T3Q_PLAN_ERROR_CODES = [
  'T3Q_CONNECTION_ERROR', // DNS/refused/TLS/connect-timeout — nothing reached the provider
  'T3Q_TIMEOUT', // response timeout — the provider MAY have executed (legacy has no idempotency key)
  'T3Q_REQUEST_REJECTED', // 400/422 — signals a UNE mapping defect
  'T3Q_AUTH_ERROR', // 401/403 — configuration defect
  'T3Q_ENDPOINT_NOT_FOUND', // 404
  'T3Q_RATE_LIMITED', // 429
  'T3Q_PROVIDER_ERROR', // 5xx
  'T3Q_MALFORMED_RESPONSE', // non-JSON, wrong content type, broken SSE framing
  'T3Q_RESPONSE_CONTRACT_VIOLATION', // response guard rejected the payload (raw preserved)
  'T3Q_CIRCUIT_OPEN', // process-local circuit breaker is open
  'T3Q_CONFLICT', // 409 — cancel/retry on a terminal job, stale baseRevision (CC-135)
  'T3Q_NOT_SUPPORTED', // operation not implemented by this adapter/variant
  'MOCK_PROVIDER_ERROR', // mock scenario failure (test/demo only)
] as const;

export type T3qPlanErrorCode = (typeof T3Q_PLAN_ERROR_CODES)[number];

export interface T3qPlanError {
  code: T3qPlanErrorCode;
  message: string;
  retryable: boolean;
  httpStatus?: number;
}

export interface ProviderCallContext {
  correlationId: string;
}

interface T3qPlanResultMeta {
  adapterId: string;
  mappingVersion: string;
  operation: T3qPlanOperation;
  latencyMs: number;
  httpStatus?: number;
}

export type T3qPlanSuccess<T> = T3qPlanResultMeta & {
  ok: true;
  data: T;
  /** Raw provider payloads for traceability (rules: keep raw). NEVER contains
   * transport headers or tokens — bodies only (ADR-26 D8). */
  rawRequest: unknown;
  rawResponse: unknown;
};

export type T3qPlanFailure = T3qPlanResultMeta & {
  ok: false;
  error: T3qPlanError;
  rawRequest?: unknown;
  rawResponse?: unknown;
};

export type T3qPlanResult<T> = T3qPlanSuccess<T> | T3qPlanFailure;

// ── Operation payloads whose canonical types exist today ──

export interface T3qTocRequest {
  /** UNE PlanContext content (plan-context.schema.json vocabulary). */
  planContext: Record<string, unknown>;
  generationOption?: TocJobGenerationOption;
  /** Aggregate bindings the target-v2 PlanRequestBase needs; legacy adapters
   * ignore this. Populated by the caller from job context — never invented
   * inside adapters. */
  trace?: T3qPlanTrace;
}

export interface T3qPlanTrace {
  planId?: string;
  planContextSnapshotId?: string;
  contextHash?: string;
  /** Idempotency anchor (v2 PlanRequestBase.requestId). */
  requestId?: string;
  tenantId?: string;
  userId?: string;
  /** v2-only aggregate ids that do not exist in the UNE plan flow until
   * CC-150 (Revision). Mock-only placeholders are set by the caller and are
   * governance-blocked from promotion (CR-T3Q-* invariant). */
  documentId?: string;
  baseRevisionId?: string;
  requestedAt?: string;
}

export interface TocGenerationPayload {
  tree: TocNodeDraft[];
}

export type T3qTocResult = T3qPlanResult<TocGenerationPayload>;

export interface T3qContentRequest {
  planContext: Record<string, unknown>;
  /** Confirmed outline the content generation follows (RPT-002 sections /
   * v2 ContentGenerationRequest.outline). */
  outline: TocNodeDraft[];
  /** Legacy PlanContentData.stream flag; v2 always runs async jobs. */
  stream?: boolean;
  /** Scoped regeneration targets (v2 generationScope=SECTIONS). Legacy
   * adapters ignore this — UNE prunes the outline instead (ADR-27 D7). */
  targetNodeKeys?: string[];
  /** Protected block ids forwarded on the wire where the contract has the
   * field (v2 ContentGenerationRequest.protectedBlockIds). MOCK-RUNTIME
   * SEMANTICS ONLY (ADR-28): UNE block UUIDs ride as opaque strings — the
   * provider-side id space binding is open (OB-10/CC-150). UNE-side triple
   * enforcement (B0/B1 re-check + 0017 trigger) never depends on this. */
  protectedBlockKeys?: string[];
  trace?: T3qPlanTrace;
}

export interface ContentGenerationPayload {
  sections: ContentDraft[];
  /** v2 GenerationStatus.failedTargetIds surfaced to the caller (empty for
   * legacy). Partiality lives HERE, never in a UNE job status (ADR-28 D4). */
  failedNodeKeys?: string[];
}

export type T3qContentResult = T3qPlanResult<ContentGenerationPayload>;

// ── CC-135 operation payloads (target-v2 mock; canonical-lite types are
//    provisional per ADR-28 D3) ──

export interface T3qSemanticEditTarget {
  targetType: 'RANGE' | 'BLOCK' | 'SECTION';
  /** v2 sectionId. Required for SECTION targets. */
  nodeKey?: string;
  /** v2 blockId. Required for RANGE/BLOCK targets. */
  blockKey?: string;
  /** Character range within the block text. Required for RANGE targets. */
  range?: { start: number; end: number };
}

export interface T3qSemanticEditRequest {
  planContext: Record<string, unknown>;
  target: T3qSemanticEditTarget;
  instruction: string;
  selectedText?: string;
  surroundingContext?: { before?: string; after?: string };
  preserveCitationIds?: string[];
  protectedBlockKeys?: string[];
  trace?: T3qPlanTrace;
}

export type T3qSemanticEditResult = T3qPlanResult<EditProposalDraft>;

export interface T3qEvidenceSearchRequest {
  planContext: Record<string, unknown>;
  query: string;
  topK: number;
  filters?: Record<string, unknown>;
  supportsBlockKeys?: string[];
  referenceDocumentIds?: string[];
  trace?: T3qPlanTrace;
}

export interface EvidenceSearchPayload {
  items: EvidenceItemDraft[];
}

export type T3qEvidenceSearchResult = T3qPlanResult<EvidenceSearchPayload>;

/** The six validation kinds of CR-T3Q-006. The contract keeps issue.type an
 * open string, so responses may carry kinds outside this list — canonical
 * mapping preserves them verbatim. */
export const T3Q_VALIDATION_TYPES = [
  'SCHEMA',
  'CITATION_COVERAGE',
  'UNSUPPORTED_CLAIM',
  'DUPLICATE_CONTENT',
  'EXPRESSION_RULE',
  'MISSING_REQUIRED_SECTION',
] as const;

export type T3qValidationType = (typeof T3Q_VALIDATION_TYPES)[number];

/** UNE-side block snapshot handed to validation (maps onto v2 ContentBlock;
 * blockType defaults to PARAGRAPH when the caller does not know it). */
export interface T3qValidationBlockInput {
  blockKey: string;
  nodeKey: string;
  order: number;
  text: string;
  citations: ContentCitationDraft[];
  blockType?: 'PARAGRAPH' | 'BULLET' | 'TABLE' | 'NOTE' | 'CAPTION' | 'PLACEHOLDER';
}

export interface T3qValidationRequest {
  planContext: Record<string, unknown>;
  validationTypes: T3qValidationType[];
  outline: TocNodeDraft[];
  blocks: T3qValidationBlockInput[];
  trace?: T3qPlanTrace;
}

export type T3qValidationResult = T3qPlanResult<ValidationReportDraft>;

// ── Job lifecycle payloads (CR-T3Q-003; reported under the 'jobStatus'
//    operation — the op vocabulary does not grow, ADR-28 D2) ──

export const T3Q_JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'PARTIAL',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;

export type T3qJobStatus = (typeof T3Q_JOB_STATUSES)[number];

export interface T3qJobStatusPayload {
  /** Provider generationId — opaque to UNE, never a UNE job id. */
  jobRef: string;
  status: T3qJobStatus;
  progress: number;
  completedTargetIds: string[];
  failedTargetIds: string[];
}

export interface T3qJobAcceptedPayload {
  jobRef: string;
  acceptedAt: string;
}

export interface T3qJobRetryRequest {
  targetType: 'SECTION' | 'BLOCK';
  targetIds: string[];
  instructionOverride?: string;
}

/** One parsed SSE frame (v2 framing is a UNE ASSUMPTION — OB-10). */
export interface T3qJobEventFrame {
  /** SSE id == data.sequence; resume anchor for Last-Event-ID. */
  id: number;
  event: string;
  data: Record<string, unknown>;
}

export interface T3qJobEventsPayload {
  frames: T3qJobEventFrame[];
}

export interface ProviderCapabilitiesPayload {
  providerBuild: string;
  contractVersions: string[];
  features: Record<string, boolean>;
  limits: Record<string, unknown>;
}

// ── Port ──

/** Transport identity/budget for pre-call traces (provider.requested).
 * Callers must read THIS, never their own transport config — an adapter/
 * config mismatch would otherwise record a wrong host (review minor). */
export interface T3qTransportProfile {
  baseUrlHost: string;
  connectTimeoutMs: number;
  responseTimeoutMs: number;
}

export interface T3qPlanProvider {
  readonly providerCode: 'T3Q';
  /** Identifies the concrete adapter in traces (e.g. 'legacy-http-v0.8.5'). */
  readonly adapterId: string;
  readonly variant: 'legacy' | 'target-v2';
  /** 'mock' = in-process fabricated responses; 'live' = a real transport.
   * Display/logging MUST consult this so a mock instance can never be
   * presented with a non-mock capability state (review M3; CLAUDE.md
   * "never report mock support as actual T3Q support"). */
  readonly runtimeMode: 'mock' | 'live';
  /** Present only when the adapter owns a real network transport. */
  readonly transportProfile?: T3qTransportProfile;
  /** Logging default; per-call mapping versions live on results. */
  readonly defaultMappingVersion: string;
  supports(operation: T3qPlanOperation): boolean;
  /** Registry entry backing `supports` — the GOVERNED state of the feature.
   * For user-facing/log output use describeRuntimeCapability, which folds
   * runtimeMode in (AT-T3Q-012). */
  capabilityFor(operation: T3qPlanOperation): PlanFeatureCapability | undefined;
}

/** Capability line for logs/UI that can never overstate a mock instance:
 * the governed registry state is always suffixed with the INSTANCE's
 * runtime mode, and mock instances are explicitly marked (review M3). */
export function describeRuntimeCapability(
  provider: T3qPlanProvider,
  operation: T3qPlanOperation,
): string {
  const capability = provider.capabilityFor(operation);
  const base = capability
    ? `${capability.featureId}: ${capability.state} (등록 상태)`
    : `${operation}: 레지스트리 미등록`;
  return provider.runtimeMode === 'mock'
    ? `${base} — 이 인스턴스는 MOCK RUNTIME (${provider.adapterId}; 실제 T3Q 지원 아님)`
    : `${base} — live transport (${provider.adapterId}; provider 미검증은 OPEN_BINDINGS 참조)`;
}

/** Same folding as describeRuntimeCapability, addressed by featureId — for
 * the registry entries finer than the op vocabulary (jobSse/jobCancel/
 * partialRetry/capabilityDiscovery, CC-135 AC "mock-only status visible"). */
export function describeRuntimeFeature(provider: T3qPlanProvider, featureId: string): string {
  const capability = getPlanFeatureCapability(featureId);
  const base = capability
    ? `${capability.featureId}: ${capability.state} (등록 상태)`
    : `${featureId}: 레지스트리 미등록`;
  return provider.runtimeMode === 'mock'
    ? `${base} — 이 인스턴스는 MOCK RUNTIME (${provider.adapterId}; 실제 T3Q 지원 아님)`
    : `${base} — live transport (${provider.adapterId}; provider 미검증은 OPEN_BINDINGS 참조)`;
}

export interface TocCapable {
  generateToc(request: T3qTocRequest, context: ProviderCallContext): Promise<T3qTocResult>;
}

export interface ContentCapable {
  generateContent(
    request: T3qContentRequest,
    context: ProviderCallContext,
  ): Promise<T3qContentResult>;
}

export interface SemanticEditCapable {
  requestSemanticEdit(
    request: T3qSemanticEditRequest,
    context: ProviderCallContext,
  ): Promise<T3qSemanticEditResult>;
}

export interface EvidenceSearchCapable {
  searchEvidence(
    request: T3qEvidenceSearchRequest,
    context: ProviderCallContext,
  ): Promise<T3qEvidenceSearchResult>;
}

export interface ValidationCapable {
  validateContent(
    request: T3qValidationRequest,
    context: ProviderCallContext,
  ): Promise<T3qValidationResult>;
}

/** CR-T3Q-003/009 job lifecycle + discovery. Every method reports under the
 * 'jobStatus' operation (the op vocabulary stays closed — ADR-28 D2); the
 * finer-grained featureIds (jobSse/jobCancel/partialRetry/
 * capabilityDiscovery) are display concerns via describeRuntimeFeature. */
export interface JobLifecycleCapable {
  getJobStatus(
    jobRef: string,
    context: ProviderCallContext,
  ): Promise<T3qPlanResult<T3qJobStatusPayload>>;
  cancelJob(
    jobRef: string,
    reason: string | undefined,
    context: ProviderCallContext,
  ): Promise<T3qPlanResult<T3qJobStatusPayload>>;
  retryJobTargets(
    jobRef: string,
    request: T3qJobRetryRequest,
    context: ProviderCallContext,
  ): Promise<T3qPlanResult<T3qJobAcceptedPayload>>;
  streamJobEvents(
    jobRef: string,
    options: { lastEventId?: number },
    context: ProviderCallContext,
  ): Promise<T3qPlanResult<T3qJobEventsPayload>>;
  discoverCapabilities(
    context: ProviderCallContext,
  ): Promise<T3qPlanResult<ProviderCapabilitiesPayload>>;
}

/** Feature-registry ids per operation and variant (capabilityFor backing). */
export const OPERATION_FEATURE_IDS: Record<
  T3qPlanProvider['variant'],
  Partial<Record<T3qPlanOperation, string>>
> = {
  legacy: { toc: 'legacyToc', content: 'legacyContent' },
  'target-v2': {
    toc: 'tocV2',
    content: 'contentV2',
    semanticEdit: 'semanticEdit',
    evidenceSearch: 'evidenceSearch',
    validate: 'validation',
    jobStatus: 'jobStatus',
  },
};

export function capabilityForOperation(
  variant: T3qPlanProvider['variant'],
  operation: T3qPlanOperation,
): PlanFeatureCapability | undefined {
  const featureId = OPERATION_FEATURE_IDS[variant][operation];
  return featureId ? getPlanFeatureCapability(featureId) : undefined;
}

/** Uniform unsupported-operation RESULT (never a throw — ADR-26 D2). */
export function notSupported(
  adapterId: string,
  mappingVersion: string,
  operation: T3qPlanOperation,
): T3qPlanFailure {
  return {
    ok: false,
    adapterId,
    mappingVersion,
    operation,
    latencyMs: 0,
    error: {
      code: 'T3Q_NOT_SUPPORTED',
      message: `${adapterId} does not support operation '${operation}'`,
      retryable: false,
    },
  };
}
