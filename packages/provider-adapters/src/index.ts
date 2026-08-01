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
