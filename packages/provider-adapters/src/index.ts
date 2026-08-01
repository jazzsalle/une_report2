/**
 * Provider adapter package boundary.
 *
 * Provider-specific DTOs and clients live only in this package
 * (.claude/rules/architecture.md). Ports are introduced by their Work Items:
 * - T3qPlanProvider port + Legacy/Target-v2 adapters: CC-125
 *   (capability vocabulary/registry landed with CC-115)
 * - UNI adapter: CC-220 / CC-240
 * - SituationProviderPort: CC-200
 * - ChannelPort: CC-270
 *
 * This file intentionally exports no port implementations yet.
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

export type {
  ProviderCallContext,
  T3qTocFailure,
  T3qTocPort,
  T3qTocRequest,
  T3qTocResult,
  T3qTocSuccess,
} from './t3q/plan/t3q-toc-port';
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
  MOCK_FAIL_PREFIX,
  MOCK_SLOW_PREFIX,
  MockLegacyT3qTocAdapter,
  type MockTocScenarioOptions,
} from './t3q/plan/mock-legacy-toc-adapter';
