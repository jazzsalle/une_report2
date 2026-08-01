import { describe, expect, it } from 'vitest';
import {
  MOCK_FAIL_PREFIX,
  MOCK_SLOW_PREFIX,
  MockLegacyT3qTocAdapter,
} from './mock-legacy-toc-adapter';

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

describe('MockLegacyT3qTocAdapter', () => {
  it('is deterministic: same input, same tree and raw payloads (3 runs)', async () => {
    const adapter = new MockLegacyT3qTocAdapter();
    const first = await adapter.generateToc({ planContext }, ctx);
    const second = await adapter.generateToc({ planContext }, ctx);
    const third = await adapter.generateToc({ planContext }, ctx);
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (first.ok && second.ok && third.ok) {
      expect(second.tree).toEqual(first.tree);
      expect(third.tree).toEqual(first.tree);
      expect(second.rawResponse).toEqual(first.rawResponse);
    }
  });

  it('reflects PlanContext content (essential factors become measure sections)', async () => {
    const adapter = new MockLegacyT3qTocAdapter();
    const result = await adapter.generateToc({ planContext }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tree[1].title).toBe('Ⅱ. 폭염 대비 대책');
      expect(result.tree[1].children?.map((c) => c.title)).toEqual([
        '1. 무더위쉼터 운영',
        '2. 취약계층 보호 대책',
      ]);
      expect(result.rawRequest).toMatchObject({ data: { subject: planContext.subject } });
    }
  });

  it('keeps scenario prefixes inert unless scenarios are enabled (no backdoor)', async () => {
    const adapter = new MockLegacyT3qTocAdapter();
    const result = await adapter.generateToc(
      { planContext: { ...planContext, subject: `${MOCK_FAIL_PREFIX} 제목` } },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('returns failure as a result value (not a throw) under the fail scenario', async () => {
    const adapter = new MockLegacyT3qTocAdapter({ scenariosEnabled: true });
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
    const adapter = new MockLegacyT3qTocAdapter({ scenariosEnabled: true, slowDelayMs: 50 });
    const start = Date.now();
    const result = await adapter.generateToc(
      { planContext: { ...planContext, subject: `${MOCK_SLOW_PREFIX} 제목` } },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });
});
