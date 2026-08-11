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
  T3Q_JOB_STATUSES,
  T3Q_PLAN_ERROR_CODES,
  T3Q_PLAN_OPERATIONS,
  T3Q_VALIDATION_TYPES,
  capabilityForOperation,
  describeRuntimeCapability,
  describeRuntimeFeature,
  notSupported,
  type ContentCapable,
  type ContentGenerationPayload,
  type EvidenceSearchCapable,
  type EvidenceSearchPayload,
  type JobLifecycleCapable,
  type ProviderCallContext,
  type ProviderCapabilitiesPayload,
  type SemanticEditCapable,
  type T3qContentRequest,
  type T3qContentResult,
  type T3qEvidenceSearchRequest,
  type T3qEvidenceSearchResult,
  type T3qJobAcceptedPayload,
  type T3qJobEventFrame,
  type T3qJobEventsPayload,
  type T3qJobRetryRequest,
  type T3qJobStatus,
  type T3qJobStatusPayload,
  type T3qPlanError,
  type T3qPlanErrorCode,
  type T3qPlanFailure,
  type T3qPlanOperation,
  type T3qPlanProvider,
  type T3qPlanResult,
  type T3qPlanSuccess,
  type T3qPlanTrace,
  type T3qSemanticEditRequest,
  type T3qSemanticEditResult,
  type T3qSemanticEditTarget,
  type T3qTocRequest,
  type T3qTocResult,
  type T3qTransportProfile,
  type T3qValidationBlockInput,
  type T3qValidationRequest,
  type T3qValidationResult,
  type T3qValidationType,
  type TocCapable,
  type TocGenerationPayload,
  type ValidationCapable,
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
  toPlanRequestBase,
  toTocGenerationRequest,
  type GenerationAcceptedV2,
  type GenerationStatusV2,
  type OutlineSectionV2,
  type TargetV2RequestContext,
  type TocGenerationRequestV2,
} from './t3q/plan/target-v2-toc-mapper';
export {
  TargetV2ResponseError,
  guardChangeProposal,
  guardCitation,
  guardContentBlock,
  guardContentBlocks,
  guardEvidenceSearchResponse,
  guardGenerationAccepted,
  guardGenerationStatus,
  guardOutlineSections,
  guardProviderCapabilities,
  guardValidationReport,
} from './t3q/plan/target-v2-response.guard';
export {
  MockTargetV2Transport,
  TargetV2TransportError,
  type MockTargetV2ScenarioOptions,
  type TargetV2Transport,
} from './t3q/plan/mock-target-v2-transport';
export { MockTargetV2JobStore } from './t3q/plan/mock-target-v2-job-store';
export {
  TARGET_V2_TERMINAL_EVENTS,
  TargetV2SseError,
  isTerminalTargetV2Event,
  parseTargetV2Sse,
  serializeTargetV2Sse,
  type TargetV2SseFrame,
} from './t3q/plan/target-v2-sse.assumed';
export {
  MOCK_DEFAULT_REFERENCE_DOCUMENT_ID,
  MOCK_TARGET_V2_CAPABILITIES,
  MOCK_TARGET_V2_PROVIDER_BUILD,
  buildMockChangeProposal,
  buildMockContentBlocks,
  buildMockEvidenceItems,
  buildMockValidationReport,
  type ChangeProposalV2,
  type CitationV2,
  type ContentBlockV2,
  type ContentGenerationRequestV2,
  type ErrorResponseV2,
  type EvidenceSearchRequestV2,
  type ProviderCapabilitiesV2,
  type SemanticEditRequestV2,
  type ValidationIssueV2,
  type ValidationRequestV2,
} from './t3q/plan/mock-target-v2-payloads';
export {
  TARGET_V2_CONTENT_MAPPING_VERSION,
  fromCitationV2,
  fromContentBlocks,
  toContentGenerationRequest,
  toOutlineSections,
} from './t3q/plan/target-v2-content-mapper';
export {
  TARGET_V2_EDIT_MAPPING_VERSION,
  findProtectedBlockViolations,
  fromChangeProposal,
  toSemanticEditRequest,
} from './t3q/plan/target-v2-edit-mapper';
export {
  TARGET_V2_EVIDENCE_MAPPING_VERSION,
  fromEvidenceItems,
  toEvidenceSearchRequest,
} from './t3q/plan/target-v2-evidence-mapper';
export {
  TARGET_V2_VALIDATION_MAPPING_VERSION,
  fromValidationReport,
  toValidationRequest,
} from './t3q/plan/target-v2-validation-mapper';
export {
  TARGET_V2_JOB_MAPPING_VERSION,
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

// ── Object storage port + adapters (CC-160, ADR-31) ──
export {
  ObjectStorageError,
  exportObjectKey,
  sha256Of,
  sourceObjectKey,
  uploadObjectKey,
  type FetchedObject,
  type ObjectStorageErrorKind,
  type ObjectStoragePort,
  type PresignPutInput,
  type PresignedPut,
  type PutObjectInput,
  type StoredObject,
} from './storage/object-storage-port';
export { MemoryObjectStorage } from './storage/memory-object-storage';
export { S3ObjectStorage, type S3ObjectStorageConfig } from './storage/s3-object-storage';
export {
  STORAGE_DRIVERS,
  createObjectStorage,
  type StorageDriver,
  type StorageEnv,
} from './storage/storage-factory';

// ── Situation provider port + adapters (CC-200, ADR-33) ──
export {
  PROVIDER_FAILURE_KINDS,
  isRetriableFailure,
  providerFailure,
  type CollectSituationQuery,
  type ProviderCollectFailure,
  type ProviderCollectResult,
  type ProviderCollectSuccess,
  type ProviderFailureKind,
  type ProviderHealth,
  type SituationProviderPort,
} from './situation/situation-provider-port';
export {
  MOCK_SCENARIOS,
  MOCK_SITUATION_PARSER_VERSION,
  MockKmaSituationProvider,
  MockMoisSituationProvider,
  type MockScenario,
  type MockSituationProviderOptions,
} from './situation/mock-situation-providers';
export {
  DEFAULT_SITUATION_PROVIDER_FLAGS,
  DisabledSituationProvider,
  QUERYABLE_PROVIDERS,
  createSituationProvider,
  isQueryableProvider,
  situationProviderHealth,
  type QueryableProvider,
  type SituationProviderFactory,
  type SituationProviderFlags,
  type SituationProviderRegistryOptions,
} from './situation/situation-provider-registry';

// ── UNI 지식문서 포트 + 어댑터 (CC-220) ──
// 실 HTTP 어댑터는 존재하지만 provider 미검증이다(UNE_ADAPTER_READY).
// mock은 UNI 지원이 아니며 어떤 경로도 그렇게 보고하지 않는다.
export {
  UNI_KNOWLEDGE_OPERATIONS,
  UNI_KNOWLEDGE_ERROR_CODES,
  uniErrorFromStatus,
  uniFailure,
  uniSuccess,
  isRetryableUniError,
  type UniKnowledgeOperation,
  type UniKnowledgeErrorCode,
  type UniKnowledgeError,
  type UniKnowledgeProvider,
  type UniKnowledgeResult,
  type UniCallContext,
  type UniRawTrace,
  type UniUploadInput,
  type UniUploadOutcome,
  type UniStatusOutcome,
  type UniReferenceOutcome,
} from './uni/knowledge/uni-knowledge-port';
export {
  DEFAULT_UNI_FIELD_NAMES,
  guardUniUpload,
  guardUniStatus,
  guardUniReference,
  type UniFieldNames,
} from './uni/knowledge/uni-knowledge-response.guard';
export { MockUniKnowledgeAdapter } from './uni/knowledge/mock-uni-knowledge-adapter';
export {
  HttpUniKnowledgeAdapter,
  type HttpUniKnowledgeConfig,
} from './uni/knowledge/http-uni-knowledge-adapter';
export {
  UNI_KNOWLEDGE_ADAPTERS,
  createUniKnowledgeProvider,
  type UniKnowledgeAdapterId,
  type UniKnowledgeFactoryEnv,
} from './uni/knowledge/uni-knowledge-factory';
export {
  UNI_KNOWLEDGE_FEATURE_CAPABILITIES,
  getUniKnowledgeCapability,
  type UniFeatureCapability,
} from './capability/uni-knowledge-capabilities';

// ── UNI SOP 생성 포트 (CC-240) ──
// SSE 프레이밍은 UNE 가정이다(OB-04) — `.assumed` 표기가 그 사실을 드러낸다.
export {
  UNI_SOP_ERROR_CODES,
  UNI_SOP_STATUSES,
  isRetryableUniSopError,
  type UniSopErrorCode,
  type UniSopError,
  type UniSopEvent,
  type UniSopStatus,
  type UniSopProvider,
  type UniSopRequest,
  type UniSopResult,
  type UniSopResultMeta,
  type UniSopRawTrace,
  type UniSopCallContext,
} from './uni/sop/uni-sop-port';
export {
  UNI_SOP_EVENT_KEYS,
  UNI_SOP_STREAM_TERMINATOR,
  UniSopSseError,
  extractDataLines,
  parseUniSopLine,
  type UniSopParsedFrame,
} from './uni/sop/uni-sop-sse.assumed';
export { UNI_SOP_MAPPER_VERSION, mapUniCompn, type UniRawCompn } from './uni/sop/uni-sop-mapper';
export { MockUniSopAdapter } from './uni/sop/mock-uni-sop-adapter';
export {
  DEFAULT_UNI_SOP_FIELDS,
  HttpUniSopAdapter,
  type HttpUniSopConfig,
} from './uni/sop/http-uni-sop-adapter';
export {
  UNI_SOP_ADAPTERS,
  createUniSopProvider,
  type UniSopAdapterId,
  type UniSopFactoryEnv,
} from './uni/sop/uni-sop-factory';

// ── 전파 채널 포트 (CC-270) ──
// 실제 SMS·이메일·푸시 계약이 OB-06으로 열려 있다. SYSTEM만 진짜이고 나머지는
// 시뮬레이션이며, `isSimulated`가 그 사실을 결과에 실어 나른다.
export {
  CHANNEL_ERROR_CODES,
  isRetryableChannelError,
  type ChannelErrorCode,
  type ChannelProvider,
  type ChannelSendContext,
  type ChannelSendInput,
  type ChannelSendResult,
} from './channel/channel-port';
export {
  SimulationChannelAdapter,
  SystemChannelAdapter,
  createChannelRegistry,
  type ChannelRegistryEnv,
  type SimulationChannelOptions,
} from './channel/simulation-channel-adapter';
