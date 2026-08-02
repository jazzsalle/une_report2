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
  toContentGenerationRequest,
  toEvidenceSearchRequest,
  toPlanContentData,
  toPlanTocData,
  toSemanticEditRequest,
  toTocGenerationRequest,
  toValidationRequest,
  type T3qEvidenceSearchRequest,
  type T3qPlanProvider,
  type T3qPlanTocAdapter,
  type T3qSemanticEditRequest,
  type T3qValidationRequest,
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

/** 확정(키 보유) 목차 — v2 content/validation 요청 매퍼 입력. */
const outline = [
  {
    nodeKey: 'n-1',
    title: 'Ⅰ. 추진 배경',
    generationPolicy: { semanticRole: 'BACKGROUND', generationPolicy: 'GENERATE', required: true },
    children: [
      {
        nodeKey: 'n-1-1',
        title: '1. 폭염 피해 현황',
        generationPolicy: { instruction: '최근 3년 온열질환자 통계를 요약' },
      },
    ],
  },
  { nodeKey: 'n-2', title: 'Ⅱ. 세부 추진계획' },
];

/** v2 provenance가 채워진 인용 — ADR-26 D4 슬롯(legacy 인용은 v2 요청에 태울 수 없음). */
const v2Citation = {
  sourceRef: 'cit-1f2e3d4c5b6a',
  fileName: '2025_폭염종합대책.pdf',
  page: '12',
  excerpt: '무더위쉼터는 읍면동별 1개소 이상 지정하여 운영한다.',
  sourceId: 'src-9a8b7c6d5e4f',
  documentId: 'f52b8d07-3a94-4c16-b0e8-6d7a91c25f43',
  chunkId: 'chunk-0012-03',
  score: 0.87,
  retrievedAt: '2026-08-02T09:00:04+09:00',
};

const semanticEditRequests: Record<'range' | 'block' | 'section', T3qSemanticEditRequest> = {
  range: {
    planContext,
    target: {
      targetType: 'RANGE',
      nodeKey: 'n-2',
      blockKey: 'blk-1',
      range: { start: 0, end: 15 },
    },
    instruction: '선택 구간을 개조식으로 다듬을 것',
    selectedText: '무더위쉼터를 확대 운영한다.',
    surroundingContext: { before: 'Ⅱ. 세부 추진계획', after: '부서별 역할은 아래와 같다.' },
    preserveCitationIds: [v2Citation.sourceRef],
    protectedBlockKeys: ['blk-protected'],
  },
  block: {
    planContext,
    target: { targetType: 'BLOCK', nodeKey: 'n-2', blockKey: 'blk-1' },
    instruction: '블록 본문 전체를 문단부호 □로 정리할 것',
  },
  section: {
    planContext,
    target: { targetType: 'SECTION', nodeKey: 'n-2' },
    instruction: '섹션 전체를 재구성하되 근거 인용은 유지할 것',
    protectedBlockKeys: ['blk-protected'],
  },
};

const evidenceRequest: T3qEvidenceSearchRequest = {
  planContext,
  query: '무더위쉼터 운영 기준과 최근 3년 온열질환자 통계',
  topK: 5,
  filters: { documentType: '지침', year: 2025 },
  supportsBlockKeys: ['blk-1'],
  referenceDocumentIds: [v2Citation.documentId],
};

const validationRequest: T3qValidationRequest = {
  planContext,
  validationTypes: ['SCHEMA', 'CITATION_COVERAGE', 'EXPRESSION_RULE'],
  outline,
  blocks: [
    {
      blockKey: 'blk-1',
      nodeKey: 'n-2',
      order: 0,
      text: '무더위쉼터 1,240개소를 지정·운영하고 취약계층 방문 확인을 주 2회 시행',
      citations: [v2Citation],
    },
  ],
};

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

  // ── CC-135: 나머지 v2 요청 매퍼 4종도 같은 기계검증을 받는다. 목 전송기만
  //    보는 매퍼라도 계약이 판정자다(대상 계약 미수락 — OB-10/OB-11). ──

  it('toContentGenerationRequest output satisfies ContentGenerationRequest (ALL/SECTIONS)', () => {
    const validate = v2.compile('ContentGenerationRequest');

    const all = toContentGenerationRequest(planContext, outline, v2Context);
    expect(validate(all), ajvErrors(validate)).toBe(true);
    expect(all.generationScope).toBe('ALL');
    expect(all.targetSectionIds).toBeUndefined();
    // 목차 3노드가 전위순회 좌표(order 0..2)로 평탄화된다.
    expect(all.outline.map((section) => section.sectionId)).toEqual(['n-1', 'n-1-1', 'n-2']);

    const scoped = toContentGenerationRequest(planContext, outline, v2Context, {
      targetNodeKeys: ['n-1-1'],
      protectedBlockKeys: ['blk-user-edited-1'],
    });
    expect(validate(scoped), ajvErrors(validate)).toBe(true);
    expect(scoped.generationScope).toBe('SECTIONS');
    expect(scoped.targetSectionIds).toEqual(['n-1-1']);
    expect(scoped.protectedBlockIds).toEqual(['blk-user-edited-1']);
  });

  it('toSemanticEditRequest output satisfies SemanticEditRequest (RANGE/BLOCK/SECTION)', () => {
    const validate = v2.compile('SemanticEditRequest');
    for (const [label, request] of Object.entries(semanticEditRequests)) {
      const mapped = toSemanticEditRequest(request, v2Context);
      expect(validate(mapped), `${label}: ${ajvErrors(validate)}`).toBe(true);
      expect(mapped.target.targetType, label).toBe(request.target.targetType);
      // RANGE만 range를 싣고, 나머지는 명시적 null(추측 금지).
      expect(mapped.target.range === null, label).toBe(request.target.targetType !== 'RANGE');
    }
  });

  it('toEvidenceSearchRequest output satisfies EvidenceSearchRequest', () => {
    const validate = v2.compile('EvidenceSearchRequest');
    const mapped = toEvidenceSearchRequest(evidenceRequest, v2Context);
    expect(validate(mapped), ajvErrors(validate)).toBe(true);
    expect(mapped.topK).toBe(5);
    expect(mapped.supportsBlockIds).toEqual(['blk-1']);
  });

  it('toValidationRequest output satisfies ValidationRequest (v2 provenance 인용 포함)', () => {
    const validate = v2.compile('ValidationRequest');
    const mapped = toValidationRequest(validationRequest, v2Context);
    expect(validate(mapped), ajvErrors(validate)).toBe(true);
    expect(mapped.validationTypes).toEqual(['SCHEMA', 'CITATION_COVERAGE', 'EXPRESSION_RULE']);
    // 인용 provenance가 실제로 실렸다(빈 배열로 통과하는 공허한 검증이 아님).
    const citation = mapped.blocks[0].citations[0];
    expect(citation.sourceId).toBe(v2Citation.sourceId);
    expect(citation.page).toBe(12);
    expect(citation.supportsBlockIds).toEqual(['blk-1']);
  });

  it('a typo field fails on EVERY v2 request mapper output (unevaluatedProperties 실효)', () => {
    const outputs: [string, Record<string, unknown>][] = [
      ['ContentGenerationRequest', toContentGenerationRequest(planContext, outline, v2Context)],
      ['SemanticEditRequest', toSemanticEditRequest(semanticEditRequests.block, v2Context)],
      ['EvidenceSearchRequest', toEvidenceSearchRequest(evidenceRequest, v2Context)],
      ['ValidationRequest', toValidationRequest(validationRequest, v2Context)],
    ];
    for (const [schemaName, mapped] of outputs) {
      const validate = v2.compile(schemaName);
      expect(validate(mapped), `${schemaName} 정상: ${ajvErrors(validate)}`).toBe(true);
      expect(validate({ ...mapped, contextHash_typo: 'x' }), `${schemaName} 오탈자`).toBe(false);
    }
  });
});
