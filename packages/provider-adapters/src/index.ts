/**
 * Provider adapter package boundary.
 *
 * Provider-specific DTOs and clients live only in this package
 * (.claude/rules/architecture.md). Ports are introduced by their Work Items:
 * - T3qPlanProvider (Legacy RPT-001/002 + Target-v2): CC-115 / CC-125
 * - UNI adapter: CC-220 / CC-240
 * - SituationProviderPort: CC-200
 * - ChannelPort: CC-270
 *
 * This file intentionally exports no port implementations yet.
 */
export const PROVIDER_ADAPTERS_PACKAGE = '@une/provider-adapters';
