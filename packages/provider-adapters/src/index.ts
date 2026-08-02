/**
 * Provider adapter package boundary.
 *
 * Provider-specific DTOs and clients live only in this package
 * (.claude/rules/architecture.md). Ports by Work Item:
 * - T3qPlanProvider port + Legacy/Target-v2 adapters: CC-125 (ADR-26);
 *   capability vocabulary/registry landed with CC-115
 * - UNI adapter: CC-220 / CC-240
 * - SituationProviderPort: CC-200
 * - ChannelPort: CC-270
 *
 * CC-125 dropped the browser-neutral compile target for this package (the
 * legacy HTTP adapter needs undici/node) — plan adapters are backend-only
 * (ADR-26 D11); browser consumers must not import this package.
 */
export const PROVIDER_ADAPTERS_PACKAGE = '@une/provider-adapters';

export {
  CAPABILITY_STATES,
  T3Q_PLAN_FEATURE_CAPABILITIES,
  describeCapability,
  getPlanFeatureCapability,
  type CapabilityState,
  type PlanFeatureCapability,
} from './capability/plan-feature-capabilities';

// ── T3Q plan port (CC-125, ADR-26 D1) ──
export {
  OPERATION_FEATURE_IDS,
  T3Q_PLAN_ERROR_CODES,
  T3Q_PLAN_OPERATIONS,
  capabilityForOperation,
  describeRuntimeCapability,
  notSupported,
  type ContentCapable,
  type ContentGenerationPayload,
  type ProviderCallContext,
  type T3qContentRequest,
  type T3qContentResult,
  type T3qPlanError,
  type T3qPlanErrorCode,
  type T3qPlanFailure,
  type T3qPlanOperation,
  type T3qPlanProvider,
  type T3qPlanResult,
  type T3qPlanSuccess,
  type T3qPlanTrace,
  type T3qTocRequest,
  type T3qTocResult,
  type T3qTransportProfile,
  type TocCapable,
  type TocGenerationPayload,
} from './t3q/plan/t3q-plan-port';

// ── Legacy v0.8.5 mapping/guards ──
export {
  LEGACY_TOC_MAPPING_VERSION,
  fromTocResponse,
  toPlanTocData,
  type LegacyTocRequestBody,
} from './t3q/plan/legacy-toc-mapper';
export {
  LegacyTocResponseError,
  guardTocResponse,
  type LegacyTocResponse,
  type LegacyTocSection,
} from './t3q/plan/legacy-toc-response.guard';
export {
  LEGACY_CONTENT_MAPPING_VERSION,
  fromContentResponse,
  toPlanContentData,
} from './t3q/plan/legacy-content-mapper';
export {
  LegacyContentResponseError,
  guardContentResponse,
  guardContentSection,
  type LegacyContentResponse,
  type LegacyContentSection,
  type LegacyReference,
} from './t3q/plan/legacy-content-response.guard';
export { LEGACY_SSE_DONE, LegacySseError, parseLegacySseTranscript } from './t3q/plan/legacy-sse';

// ── Adapters ──
export {
  LEGACY_CONTENT_PATH,
  LEGACY_TOC_PATH,
  LegacyT3qPlanAdapter,
  type LegacyT3qPlanAdapterOptions,
} from './t3q/plan/legacy-t3q-plan-adapter';
export {
  MOCK_FAIL_PREFIX,
  MOCK_SLOW_PREFIX,
  MockLegacyT3qPlanAdapter,
  buildMockTocResponse,
  type MockTocScenarioOptions,
} from './t3q/plan/mock-legacy-t3q-plan-adapter';
export {
  TARGET_V2_TOC_MAPPING_VERSION,
  TargetV2MappingError,
  fromOutlineSections,
  toTocGenerationRequest,
  type GenerationAcceptedV2,
  type GenerationStatusV2,
  type OutlineSectionV2,
  type TargetV2RequestContext,
  type TocGenerationRequestV2,
} from './t3q/plan/target-v2-toc-mapper';
export {
  TargetV2ResponseError,
  guardGenerationAccepted,
  guardGenerationStatus,
  guardOutlineSections,
} from './t3q/plan/target-v2-response.guard';
export { MockTargetV2Transport, type TargetV2Transport } from './t3q/plan/mock-target-v2-transport';
export {
  TargetV2T3qPlanAdapter,
  UNE_MOCK_PLACEHOLDER_PREFIX,
  type TargetV2T3qPlanAdapterOptions,
} from './t3q/plan/target-v2-t3q-plan-adapter';

// ── Transport primitives (worker/e2e tuning + hygiene tests) ──
export {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  T3qHttpClient,
  T3qHttpError,
  type T3qHttpClientOptions,
  type T3qHttpResponse,
} from './t3q/plan/http/t3q-http-client';
export {
  CircuitBreaker,
  type CircuitBreakerOptions,
  type CircuitState,
} from './t3q/plan/http/circuit-breaker';

// ── Selection (ADR-26 D6) ──
export {
  T3Q_PLAN_ADAPTER_FLAG_KEY,
  T3Q_PLAN_ADAPTER_KINDS,
  createT3qPlanProvider,
  isT3qPlanAdapterKind,
  type PlanProviderFactoryOptions,
  type T3qPlanAdapterKind,
  type T3qPlanTocAdapter,
} from './t3q/plan/plan-provider-factory';
