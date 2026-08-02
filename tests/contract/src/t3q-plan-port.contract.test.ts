import { describe, expect, it } from 'vitest';
import {
  LegacyT3qPlanAdapter,
  MockLegacyT3qPlanAdapter,
  MockTargetV2Transport,
  T3Q_PLAN_ERROR_CODES,
  T3Q_PLAN_OPERATIONS,
  TargetV2T3qPlanAdapter,
  describeRuntimeCapability,
  notSupported,
  toPlanContentData,
  toPlanTocData,
  toTocGenerationRequest,
  type T3qPlanProvider,
  type T3qPlanTocAdapter,
} from '@une/provider-adapters';
import { ajvErrors, contractValidators } from './contract-loader';

/**
 * CC-125 port contract: every adapter behind T3qPlanProvider produces the
 * same result envelope and canonical shapes, and its mapper output satisfies
 * the governing contract schema by machine validation (testing rules:
 * contract tests validate against OpenAPI/JSON Schema).
 */

const planContext = {
  subject: '2026년 폭염 대비 안전관리 계획',
  backgroundInfo: { disasterType: '폭염', controlPhase: '대비' },
  contentInstruction: { essentialFactors: ['무더위쉼터 운영', '취약계층 보호 대책'] },
  purposeOfDocument: {
    goalOfBusiness: '폭염 피해 최소화',
    role: '재난안전 담당자',
    targetAudiences: ['중앙정부'],
  },
};

const v2Context = {
  requestId: 'a2f1e6c0-8a45-4c47-9e3d-1f2a3b4c5d6e',
  correlationId: 'corr_port_contract',
  tenantId: 'b3e2f7d1-9b56-4d58-8f4e-2a3b4c5d6e7f',
  userId: 'c4f3a8e2-ac67-4e69-9a5f-3b4c5d6e7f8a',
  planId: 'd5a4b9f3-bd78-4f7a-ab6a-4c5d6e7f8a9b',
  documentId: 'une-mock:document:pending-cc150',
  baseRevisionId: 'une-mock:revision:pending-cc150',
  planContextSnapshotId: 'e6b5caa4-ce89-4a8b-bc7b-5d6e7f8a9b0c',
  contextHash: 'a'.repeat(64),
  requestedAt: '2026-08-02T09:00:00+09:00',
};

const ctx = { correlationId: v2Context.correlationId };

const mockLegacy = new MockLegacyT3qPlanAdapter();
const legacyHttp = new LegacyT3qPlanAdapter({ baseUrl: 'http://127.0.0.1:9', authMode: 'none' });
const targetV2 = new TargetV2T3qPlanAdapter({
  transport: new MockTargetV2Transport(),
  sleep: async () => {},
});
const ADAPTERS: T3qPlanProvider[] = [mockLegacy, legacyHttp, targetV2];

describe('T3qPlanProvider identity and capability wiring', () => {
  it('every adapter carries identity constants and adapterIds are unique', () => {
    for (const adapter of ADAPTERS) {
      expect(adapter.providerCode).toBe('T3Q');
      expect(adapter.adapterId).toBeTruthy();
      expect(['legacy', 'target-v2']).toContain(adapter.variant);
      expect(adapter.defaultMappingVersion).toBeTruthy();
    }
    expect(new Set(ADAPTERS.map((a) => a.adapterId)).size).toBe(ADAPTERS.length);
  });

  it('supports() never runs ahead of the governed registry', () => {
    for (const adapter of ADAPTERS) {
      for (const operation of T3Q_PLAN_OPERATIONS) {
        if (!adapter.supports(operation)) continue;
        const capability = adapter.capabilityFor(operation);
        expect(capability, `${adapter.adapterId} ${operation} has a registry entry`).toBeDefined();
        if (adapter.adapterId.startsWith('mock-')) {
          expect(capability?.mockAvailable, `${capability?.featureId} mockAvailable`).toBe(true);
        } else {
          expect(
            capability?.adapterImplemented,
            `${capability?.featureId} adapterImplemented`,
          ).toBe(true);
        }
      }
    }
  });

  it('unsupported operations are result values with T3Q_NOT_SUPPORTED', () => {
    const result = notSupported('x', 'v', 'semanticEdit');
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'T3Q_NOT_SUPPORTED', retryable: false });
  });

  it('a mock INSTANCE can never present a non-mock capability line (review M3)', () => {
    for (const adapter of ADAPTERS) {
      const line = describeRuntimeCapability(adapter, 'toc');
      if (adapter.runtimeMode === 'mock') {
        expect(adapter.adapterId.startsWith('mock-'), adapter.adapterId).toBe(true);
        expect(line, adapter.adapterId).toContain('MOCK RUNTIME');
      } else {
        expect(line, adapter.adapterId).toContain('live transport');
        expect(line, adapter.adapterId).not.toContain('MOCK RUNTIME');
      }
    }
    // The registry may say UNE_ADAPTER_READY for legacyToc, but the mock
    // legacy INSTANCE must still be marked as mock in the same line.
    expect(describeRuntimeCapability(mockLegacy, 'toc')).toContain('MOCK RUNTIME');
  });
});

describe('T3qPlanResult envelope', () => {
  it('success results carry canonical data, raw payloads, and per-call trace meta', async () => {
    const runners: [string, T3qPlanTocAdapter, object][] = [
      ['mock-legacy', mockLegacy, {}],
      ['mock-target-v2', targetV2, { trace: v2Context }],
    ];
    for (const [label, adapter, extra] of runners) {
      const result = await adapter.generateToc({ planContext, ...extra }, ctx);
      expect(result.ok, `${label} ok`).toBe(true);
      if (!result.ok) continue;
      expect(result.data.tree.length, label).toBeGreaterThan(0);
      expect(result.rawRequest, label).toBeDefined();
      expect(result.rawResponse, label).toBeDefined();
      expect(result.latencyMs, label).toBeGreaterThanOrEqual(0);
      expect(result.adapterId, label).toBe(adapter.adapterId);
      expect(result.mappingVersion, label).toBeTruthy();
      expect(result.operation, label).toBe('toc');
    }
  });

  it('failures are classified result values (never throws) with known codes', async () => {
    // Missing v2 bindings → request-defect failure.
    const missing = await targetV2.generateToc({ planContext }, ctx);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(T3Q_PLAN_ERROR_CODES).toContain(missing.error.code);
      expect(typeof missing.error.retryable).toBe('boolean');
    }
  });

  it('legacy and target-v2 produce structurally equivalent canonical trees', async () => {
    const legacy = await mockLegacy.generateToc({ planContext }, ctx);
    const v2 = await targetV2.generateToc({ planContext, trace: v2Context }, ctx);
    expect(legacy.ok && v2.ok).toBe(true);
    if (!legacy.ok || !v2.ok) return;
    const shape = (nodes: readonly { title: string; children?: unknown[] }[]): unknown =>
      nodes.map((n) => ({ title: n.title, children: shape((n.children ?? []) as never) }));
    expect(shape(v2.data.tree)).toEqual(shape(legacy.data.tree));
  });
});

describe('mapper output ↔ contract schema (machine validation)', () => {
  const legacy = contractValidators('contracts', 'openapi', 't3q-report-adapter-v0.8.5-une1.yaml');
  const v2 = contractValidators('contracts', 'openapi', 't3q-plan-api-change-request-v1.yaml');

  it('toPlanTocData output satisfies PlanTocData', () => {
    const validate = legacy.compile('PlanTocData');
    expect(validate(toPlanTocData(planContext).data), ajvErrors(validate)).toBe(true);
  });

  it('toPlanContentData output satisfies PlanContentData', () => {
    const outline = [{ nodeKey: 'n-1', title: 'Ⅰ. 개요', children: [{ title: '1. 배경' }] }];
    const validate = legacy.compile('PlanContentData');
    expect(validate(toPlanContentData(planContext, outline, true).data), ajvErrors(validate)).toBe(
      true,
    );
  });

  it('toTocGenerationRequest output satisfies TocGenerationRequest (unevaluatedProperties)', () => {
    const validate = v2.compile('TocGenerationRequest');
    expect(validate(toTocGenerationRequest(planContext, v2Context)), ajvErrors(validate)).toBe(
      true,
    );
  });

  it('a typo field in the v2 request actually fails — detection legacy cannot give', () => {
    const validate = v2.compile('TocGenerationRequest');
    const withTypo = {
      ...toTocGenerationRequest(planContext, v2Context),
      contexthash_typo: 'x',
    };
    expect(validate(withTypo)).toBe(false);
  });
});
