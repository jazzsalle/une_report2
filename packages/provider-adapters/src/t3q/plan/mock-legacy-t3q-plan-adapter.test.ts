import { describe, expect, it } from 'vitest';
import {
  MOCK_FAIL_PREFIX,
  MOCK_SLOW_PREFIX,
  MockLegacyT3qPlanAdapter,
} from './mock-legacy-t3q-plan-adapter';

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

const ctx = { correlationId: 'corr_test' };

describe('MockLegacyT3qPlanAdapter', () => {
  it('is deterministic: same input, same tree and raw payloads (3 runs)', async () => {
    const adapter = new MockLegacyT3qPlanAdapter();
    const first = await adapter.generateToc({ planContext }, ctx);
    const second = await adapter.generateToc({ planContext }, ctx);
    const third = await adapter.generateToc({ planContext }, ctx);
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (first.ok && second.ok && third.ok) {
      expect(second.data.tree).toEqual(first.data.tree);
      expect(third.data.tree).toEqual(first.data.tree);
      expect(second.rawResponse).toEqual(first.rawResponse);
    }
  });

  it('reflects PlanContext content (essential factors become measure sections)', async () => {
    const adapter = new MockLegacyT3qPlanAdapter();
    const result = await adapter.generateToc({ planContext }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tree[1].title).toBe('Ⅱ. 폭염 대비 대책');
      expect(result.data.tree[1].children?.map((c) => c.title)).toEqual([
        '1. 무더위쉼터 운영',
        '2. 취약계층 보호 대책',
      ]);
      expect(result.rawRequest).toMatchObject({ data: { subject: planContext.subject } });
      expect(result.adapterId).toBe('mock-legacy-v0.8.5');
      expect(result.operation).toBe('toc');
      expect(result.mappingVersion).toBe('legacy-v0.8.5-une1@1');
    }
  });

  it('generates deterministic content drafts for a given outline (RPT-002 mock)', async () => {
    const adapter = new MockLegacyT3qPlanAdapter();
    const toc = await adapter.generateToc({ planContext }, ctx);
    expect(toc.ok).toBe(true);
    if (!toc.ok) return;
    const first = await adapter.generateContent({ planContext, outline: toc.data.tree }, ctx);
    const second = await adapter.generateContent({ planContext, outline: toc.data.tree }, ctx);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.data.sections).toEqual(first.data.sections);
      expect(first.data.sections).toHaveLength(toc.data.tree.length);
      // Leaf sections carry body text; container sections stay empty.
      expect(first.data.sections[0].text).toBe('');
      expect(first.data.sections[0].children[0].text).toContain('□');
      // Leaves carry a deterministic reference (CC-130 evidence mapping);
      // containers carry none.
      expect(first.data.sections[0].citations).toEqual([]);
      const leafCitations = first.data.sections[0].children[0].citations;
      expect(leafCitations).toHaveLength(1);
      expect(leafCitations[0].sourceRef).toMatch(/^ref-[0-9a-f]{4}$/);
      expect(second.data.sections[0].children[0].citations).toEqual(leafCitations);
      expect(first.operation).toBe('content');
      // Node keys never leak into the provider request (US-PLAN-007 step 5).
      expect(JSON.stringify(first.rawRequest)).not.toContain('"nodeKey"');
    }
  });

  it('supports toc+content only and maps capabilities from the registry', () => {
    const adapter = new MockLegacyT3qPlanAdapter();
    expect(adapter.supports('toc')).toBe(true);
    expect(adapter.supports('content')).toBe(true);
    expect(adapter.supports('semanticEdit')).toBe(false);
    expect(adapter.capabilityFor('toc')?.featureId).toBe('legacyToc');
    expect(adapter.capabilityFor('content')?.featureId).toBe('legacyContent');
    expect(adapter.capabilityFor('validate')).toBeUndefined();
  });

  it('keeps scenario prefixes inert unless scenarios are enabled (no backdoor)', async () => {
    const adapter = new MockLegacyT3qPlanAdapter();
    const result = await adapter.generateToc(
      { planContext: { ...planContext, subject: `${MOCK_FAIL_PREFIX} 제목` } },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('returns failure as a result value (not a throw) under the fail scenario', async () => {
    const adapter = new MockLegacyT3qPlanAdapter({ scenariosEnabled: true });
    const result = await adapter.generateToc(
      { planContext: { ...planContext, subject: `${MOCK_FAIL_PREFIX} 제목` } },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: 'MOCK_PROVIDER_ERROR', retryable: true });
      expect(result.rawRequest).toBeDefined();
    }
  });

  it('delays under the slow scenario', async () => {
    const adapter = new MockLegacyT3qPlanAdapter({ scenariosEnabled: true, slowDelayMs: 50 });
    const start = Date.now();
    const result = await adapter.generateToc(
      { planContext: { ...planContext, subject: `${MOCK_SLOW_PREFIX} 제목` } },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
