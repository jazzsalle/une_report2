import { LegacyT3qPlanAdapter, type LegacyT3qPlanAdapterOptions } from './legacy-t3q-plan-adapter';
import {
  MockLegacyT3qPlanAdapter,
  type MockTocScenarioOptions,
} from './mock-legacy-t3q-plan-adapter';
import {
  TargetV2T3qPlanAdapter,
  type TargetV2T3qPlanAdapterOptions,
} from './target-v2-t3q-plan-adapter';
import type { T3qPlanProvider, TocCapable } from './t3q-plan-port';

/**
 * T3Q plan adapter selection (CC-125, ADR-26 D6). Pure function: config in,
 * adapter out — the worker never knows which concrete adapter it drives.
 *
 * Selection is a PROCESS-ENV concern in CC-125. A per-tenant override in
 * provider_config.feature_flags_json is deliberately deferred: une_worker
 * has no provider_config grant, UNE-ADMIN-008/009 do not exist yet, and a
 * direct-SQL toggle would bypass capability governance (ADR-26 D6). The
 * reserved key for that future override is `t3q.planAdapter` — the seam
 * below is where it plugs in.
 */

export const T3Q_PLAN_ADAPTER_KINDS = ['mock-legacy', 'legacy-http', 'mock-target-v2'] as const;

export type T3qPlanAdapterKind = (typeof T3Q_PLAN_ADAPTER_KINDS)[number];

/** Reserved provider_config.feature_flags_json key (not read yet). */
export const T3Q_PLAN_ADAPTER_FLAG_KEY = 't3q.planAdapter';

export function isT3qPlanAdapterKind(value: string): value is T3qPlanAdapterKind {
  return (T3Q_PLAN_ADAPTER_KINDS as readonly string[]).includes(value);
}

export interface PlanProviderFactoryOptions {
  kind: T3qPlanAdapterKind;
  mock?: MockTocScenarioOptions;
  /** Required when kind==='legacy-http' — the adapter constructor enforces
   * base URL/auth completeness (fail-closed at startup, OB-01). */
  legacyHttp?: LegacyT3qPlanAdapterOptions;
  targetV2?: TargetV2T3qPlanAdapterOptions;
}

export type T3qPlanTocAdapter = T3qPlanProvider & TocCapable;

export function createT3qPlanProvider(options: PlanProviderFactoryOptions): T3qPlanTocAdapter {
  switch (options.kind) {
    case 'mock-legacy':
      return new MockLegacyT3qPlanAdapter(options.mock ?? {});
    case 'legacy-http': {
      if (!options.legacyHttp) {
        throw new Error(
          'legacy-http adapter requires explicit HTTP options (UNE_T3Q_BASE_URL 등 — OB-01: no defaults)',
        );
      }
      return new LegacyT3qPlanAdapter(options.legacyHttp);
    }
    case 'mock-target-v2':
      return new TargetV2T3qPlanAdapter(options.targetV2 ?? {});
    default: {
      const never: never = options.kind;
      throw new Error(`unknown T3Q plan adapter kind: ${String(never)}`);
    }
  }
}
