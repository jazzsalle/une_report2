import { CONFIDENCE_WEIGHTS, computeConfidence } from '@une/domain';
import { describe, expect, it } from 'vitest';
import { HwpxEngine } from '../contract';
import { synthHwpx } from '../testing/synth-hwpx';
import { computeConfidenceEvidence } from './confidence';

/**
 * 임계(0.85/0.60)와 롤업 규칙은 `packages/domain`의 테스트가 이미 덮는다.
 * 여기서 검증하는 것은 엔진의 책임인 **성분 산출**이다: 각 성분이 무엇을
 * 세는지, 근거가 없을 때 0이 되는지, 가중치를 재정의하지 않는지.
 */

const engine = new HwpxEngine();

describe('confidence 성분 산출', () => {
  it('도메인 가중치를 재정의하지 않고 그대로 적용한다', () => {
    const result = engine.analyzeDocument({ bytes: synthHwpx('valid') });
    const components = result.template.compatibility.components;
    expect(result.template.compatibility.confidence).toBe(computeConfidence(components));
    expect(Object.keys(components).sort()).toEqual(Object.keys(CONFIDENCE_WEIGHTS).sort());
  });

  it('성분마다 "무엇을 셌는가"를 문자열로 남긴다 (G15-1 근거 재현)', () => {
    const result = engine.analyzeDocument({ bytes: synthHwpx('valid') });
    const basis = result.template.compatibility.confidenceBasis;
    expect(basis.styleConsistency).toMatch(/distinctSignatures=\d+ paragraphs=\d+/);
    expect(basis.prefixConsistency).toMatch(/repeatedPrefixedParagraphs=\d+/);
    expect(basis.indentHierarchy).toMatch(/monotonicLevelPairs=\d+ levelPairs=\d+/);
    expect(basis.repetitionEvidence).toMatch(/paragraphsInRepeatedClusters=\d+/);
    expect(basis.positionEvidence).toMatch(/wellFormedTransitions=\d+ transitions=\d+/);
    expect(basis.semanticHint).toMatch(/semanticKeywordKinds=\d+/);
  });

  it('근거가 하나도 없으면 성분은 0이다(중립값을 주지 않는다)', () => {
    const evidence = computeConfidenceEvidence({
      paragraphs: [],
      clusters: [],
      outline: { patterns: [], assignments: [], warnings: [] },
      staticRegions: [],
    });
    expect(evidence.components).toEqual({
      styleConsistency: 0,
      prefixConsistency: 0,
      indentHierarchy: 0,
      repetitionEvidence: 0,
      positionEvidence: 0,
      semanticHint: 0,
    });
    expect(evidence.value).toBe(0);
  });

  it('모든 성분은 [0,1]을 벗어나지 않는다 — 도메인이 RangeError를 던지는 경계', () => {
    for (const fixture of ['valid', 'multi-section', 'flatten-only-object'] as const) {
      const result = engine.analyzeDocument({ bytes: synthHwpx(fixture) });
      for (const value of Object.values(result.template.compatibility.components)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('반복이 늘면 repetitionEvidence가 오른다 (multi-section이 단일 section보다 높다)', () => {
    const single = engine.analyzeDocument({ bytes: synthHwpx('valid') });
    const multi = engine.analyzeDocument({ bytes: synthHwpx('multi-section') });
    expect(multi.template.compatibility.components.repetitionEvidence).toBeGreaterThan(
      single.template.compatibility.components.repetitionEvidence,
    );
  });
});
