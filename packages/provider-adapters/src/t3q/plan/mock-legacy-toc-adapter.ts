import { fromTocResponse, LEGACY_TOC_MAPPING_VERSION, toPlanTocData } from './legacy-toc-mapper';
import type { ProviderCallContext, T3qTocPort, T3qTocRequest, T3qTocResult } from './t3q-toc-port';

/**
 * Deterministic in-process mock of RPT-001 (CC-120, ADR-25 D4). Same input →
 * same outline, no randomness, no network. This is MOCK support only: the
 * capability registry keeps legacyToc at MOCK_ONLY / adapterImplemented:false
 * (the real HTTP adapter is CC-125) — never report this as T3Q support.
 *
 * Failure/latency simulation exists ONLY when a scenario flag is injected
 * (worker config; default off) and is driven by explicit subject prefixes —
 * no production backdoor: with scenarios disabled the prefixes mean nothing.
 */

export const MOCK_FAIL_PREFIX = '[MOCK-FAIL]';
export const MOCK_SLOW_PREFIX = '[MOCK-SLOW]';

// This package compiles without node or DOM lib types (browser-neutral base
// config); setTimeout is global in both runtimes.
declare const setTimeout: (fn: () => void, ms: number) => unknown;

export interface MockTocScenarioOptions {
  /** Enables the subject-prefix scenarios (test/demo only). */
  scenariosEnabled?: boolean;
  /** Milliseconds the slow scenario waits (kept small in tests). */
  slowDelayMs?: number;
}

interface BackgroundInfoShape {
  disasterType?: unknown;
  controlPhase?: unknown;
}

export class MockLegacyT3qTocAdapter implements T3qTocPort {
  readonly providerCode = 'T3Q' as const;
  readonly adapterId = 'mock-legacy-v0.8.5';
  readonly mappingVersion = LEGACY_TOC_MAPPING_VERSION;

  constructor(private readonly options: MockTocScenarioOptions = {}) {}

  async generateToc(request: T3qTocRequest, _context: ProviderCallContext): Promise<T3qTocResult> {
    const startedAt = Date.now();
    const rawRequest = toPlanTocData(request.planContext);
    const subject =
      typeof request.planContext.subject === 'string' ? request.planContext.subject : '';

    if (this.options.scenariosEnabled) {
      if (subject.startsWith(MOCK_FAIL_PREFIX)) {
        return {
          ok: false,
          error: {
            code: 'MOCK_PROVIDER_ERROR',
            message: 'mock scenario: simulated provider failure',
            retryable: true,
          },
          rawRequest,
          latencyMs: Date.now() - startedAt,
        };
      }
      if (subject.startsWith(MOCK_SLOW_PREFIX)) {
        await new Promise<void>((resolve) =>
          setTimeout(() => resolve(), this.options.slowDelayMs ?? 2000),
        );
      }
    }

    const rawResponse = buildMockTocResponse(request.planContext);
    return {
      ok: true,
      tree: fromTocResponse(rawResponse),
      rawRequest,
      rawResponse,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/** Fixed outline rules from PlanContext content — legacy TocResponse shape. */
function buildMockTocResponse(planContext: Record<string, unknown>): {
  title: string;
  sections: Array<{ name: string; children: Array<{ name: string; children: never[] }> }>;
} {
  const subject = typeof planContext.subject === 'string' ? planContext.subject : '무제 계획';
  const background = (planContext.backgroundInfo ?? {}) as BackgroundInfoShape;
  const disasterType =
    typeof background.disasterType === 'string' ? background.disasterType : '재난';
  const controlPhase =
    typeof background.controlPhase === 'string' ? background.controlPhase : '대비';
  const instruction = (planContext.contentInstruction ?? {}) as { essentialFactors?: unknown };
  const factors = Array.isArray(instruction.essentialFactors)
    ? instruction.essentialFactors.filter((f): f is string => typeof f === 'string').slice(0, 10)
    : [];

  const measureChildren =
    factors.length > 0
      ? factors.map((factor, index) => ({
          name: `${index + 1}. ${factor}`,
          children: [] as never[],
        }))
      : [
          { name: `1. ${disasterType} 예방 점검`, children: [] as never[] },
          { name: `2. ${disasterType} ${controlPhase} 태세 확립`, children: [] as never[] },
        ];

  return {
    title: subject,
    sections: [
      {
        name: 'Ⅰ. 개요',
        children: [
          { name: '1. 추진 배경', children: [] },
          { name: '2. 추진 목표', children: [] },
        ],
      },
      { name: `Ⅱ. ${disasterType} ${controlPhase} 대책`, children: measureChildren },
      {
        name: 'Ⅲ. 행정사항',
        children: [
          { name: '1. 기관별 협조사항', children: [] },
          { name: '2. 예산·보고', children: [] },
        ],
      },
    ],
  };
}
