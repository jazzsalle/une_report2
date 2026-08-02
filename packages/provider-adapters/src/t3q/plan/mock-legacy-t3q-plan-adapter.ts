import { LEGACY_TOC_MAPPING_VERSION, fromTocResponse, toPlanTocData } from './legacy-toc-mapper';
import {
  LEGACY_CONTENT_MAPPING_VERSION,
  fromContentResponse,
  toPlanContentData,
} from './legacy-content-mapper';
import {
  buildMockOutline,
  buildMockReference,
  buildMockSectionText,
  type MockOutlineNode,
} from './mock-plan-outline';
import type { PlanFeatureCapability } from '../../capability/plan-feature-capabilities';
import {
  capabilityForOperation,
  type ContentCapable,
  type ProviderCallContext,
  type T3qContentRequest,
  type T3qContentResult,
  type T3qPlanOperation,
  type T3qPlanProvider,
  type T3qTocRequest,
  type T3qTocResult,
  type TocCapable,
} from './t3q-plan-port';

/**
 * Deterministic in-process mock of legacy RPT-001/002 (CC-120 → CC-125,
 * ADR-25 D4 / ADR-26 D1). Same input → same output, no randomness, no
 * network. This is MOCK support only — never report it as T3Q support; the
 * capability registry tracks the real adapter separately.
 *
 * Failure/latency simulation exists ONLY when a scenario flag is injected
 * (worker config; default off) and is driven by explicit subject prefixes —
 * no production backdoor: with scenarios disabled the prefixes mean nothing.
 */

export const MOCK_FAIL_PREFIX = '[MOCK-FAIL]';
export const MOCK_SLOW_PREFIX = '[MOCK-SLOW]';

export interface MockTocScenarioOptions {
  /** Enables the subject-prefix scenarios (test/demo only). */
  scenariosEnabled?: boolean;
  /** Milliseconds the slow scenario waits (kept small in tests). */
  slowDelayMs?: number;
}

export class MockLegacyT3qPlanAdapter implements T3qPlanProvider, TocCapable, ContentCapable {
  readonly providerCode = 'T3Q' as const;
  readonly adapterId = 'mock-legacy-v0.8.5';
  readonly variant = 'legacy' as const;
  readonly runtimeMode = 'mock' as const;
  readonly defaultMappingVersion = LEGACY_TOC_MAPPING_VERSION;

  constructor(private readonly options: MockTocScenarioOptions = {}) {}

  supports(operation: T3qPlanOperation): boolean {
    return operation === 'toc' || operation === 'content';
  }

  capabilityFor(operation: T3qPlanOperation): PlanFeatureCapability | undefined {
    return capabilityForOperation('legacy', operation);
  }

  async generateToc(request: T3qTocRequest, _context: ProviderCallContext): Promise<T3qTocResult> {
    const startedAt = Date.now();
    const rawRequest = toPlanTocData(request.planContext);
    const scenario = await this.applyScenario(request.planContext);
    if (scenario) {
      return {
        ok: false,
        adapterId: this.adapterId,
        mappingVersion: LEGACY_TOC_MAPPING_VERSION,
        operation: 'toc',
        error: scenario,
        rawRequest,
        latencyMs: Date.now() - startedAt,
      };
    }

    const outline = buildMockOutline(request.planContext);
    const rawResponse = {
      title: outline.title,
      sections: outline.sections,
    };
    return {
      ok: true,
      adapterId: this.adapterId,
      mappingVersion: LEGACY_TOC_MAPPING_VERSION,
      operation: 'toc',
      data: { tree: fromTocResponse(rawResponse) },
      rawRequest,
      rawResponse,
      latencyMs: Date.now() - startedAt,
    };
  }

  async generateContent(
    request: T3qContentRequest,
    _context: ProviderCallContext,
  ): Promise<T3qContentResult> {
    const startedAt = Date.now();
    const rawRequest = toPlanContentData(request.planContext, request.outline, false);
    const scenario = await this.applyScenario(request.planContext);
    if (scenario) {
      return {
        ok: false,
        adapterId: this.adapterId,
        mappingVersion: LEGACY_CONTENT_MAPPING_VERSION,
        operation: 'content',
        error: scenario,
        rawRequest,
        latencyMs: Date.now() - startedAt,
      };
    }

    const background = (request.planContext.backgroundInfo ?? {}) as { disasterType?: unknown };
    const disasterType =
      typeof background.disasterType === 'string' ? background.disasterType : '재난';
    const toContentSections = (
      nodes: readonly { title: string; children?: unknown }[],
    ): unknown[] =>
      nodes.map((node) => {
        const children = Array.isArray(node.children)
          ? toContentSections(node.children as { title: string }[])
          : [];
        const isLeaf = children.length === 0;
        return {
          name: node.title,
          content: isLeaf ? buildMockSectionText(node.title, disasterType) : '',
          // Leaf sections carry one deterministic reference so the CC-130
          // evidence-mapping path is exercisable end to end.
          references: isLeaf ? [buildMockReference(node.title, disasterType)] : [],
          children,
        };
      });
    const rawResponse = { sections: toContentSections(request.outline) };
    return {
      ok: true,
      adapterId: this.adapterId,
      mappingVersion: LEGACY_CONTENT_MAPPING_VERSION,
      operation: 'content',
      data: { sections: fromContentResponse(rawResponse) },
      rawRequest,
      rawResponse,
      latencyMs: Date.now() - startedAt,
    };
  }

  private async applyScenario(
    planContext: Record<string, unknown>,
  ): Promise<{ code: 'MOCK_PROVIDER_ERROR'; message: string; retryable: boolean } | null> {
    if (!this.options.scenariosEnabled) return null;
    const subject = typeof planContext.subject === 'string' ? planContext.subject : '';
    if (subject.startsWith(MOCK_FAIL_PREFIX)) {
      return {
        code: 'MOCK_PROVIDER_ERROR',
        message: 'mock scenario: simulated provider failure',
        retryable: true,
      };
    }
    if (subject.startsWith(MOCK_SLOW_PREFIX)) {
      await new Promise<void>((resolve) =>
        setTimeout(() => resolve(), this.options.slowDelayMs ?? 2000),
      );
    }
    return null;
  }
}

/** Legacy TocResponse shape reused by tests that need the raw mock payload. */
export function buildMockTocResponse(planContext: Record<string, unknown>): {
  title: string;
  sections: MockOutlineNode[];
} {
  return buildMockOutline(planContext);
}
