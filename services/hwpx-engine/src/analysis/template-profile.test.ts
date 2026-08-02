import {
  CLONE_POLICIES,
  OUTLINE_PATTERN_KINDS,
  PREFIX_POLICIES,
  STATIC_REGION_KINDS,
  canonicalJson,
  type TemplateProfile,
} from '@une/domain';
import { describe, expect, it } from 'vitest';
import { HwpxEngine } from '../contract';
import { synthHwpx } from '../testing/synth-hwpx';
import { toTemplateProfile } from './template-profile';

/**
 * `toTemplateProfile` — 분석 결과의 외부 표현 (리뷰 M-1).
 *
 * 여기서 지키는 것은 세 가지다.
 *  1) 값이 분석 결과와 일치한다(투영이지 재계산이 아니다).
 *  2) JSONB 왕복에 안정적이다 — CC-150이 `template_profile.profile_json`으로
 *     저장했다 읽는다.
 *  3) 열거값이 **도메인 유니온 안에** 있다. 스키마가 표현하지 못하는 값을
 *     엔진이 내면 저장 시점이 아니라 계약 테스트에서야 드러난다.
 */

const engine = new HwpxEngine();

function profileOf(fixture: Parameters<typeof synthHwpx>[0]): TemplateProfile {
  return engine.analyzeDocument({ bytes: synthHwpx(fixture) }).profile;
}

describe('toTemplateProfile', () => {
  it('분석 결과를 그대로 투영한다(재계산하지 않는다)', () => {
    const result = engine.analyzeDocument({ bytes: synthHwpx('valid') });
    const profile = toTemplateProfile(result.template, result.build);
    expect(profile.profileVersion).toBe('1');
    expect(profile.sourceHash).toBe(result.ir.sourceHash);
    expect(profile.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(profile.compatibility.verdict).toBe(result.template.compatibility.verdict);
    expect(profile.compatibility.confidence).toBe(result.template.compatibility.confidence);
    expect(profile.compatibility.components).toEqual(result.template.compatibility.components);
    expect(profile.compatibility.objectCounts).toEqual(result.template.compatibility.objectCounts);
    expect(profile.outlinePatterns).toHaveLength(result.template.outlinePatterns.length);
    expect(profile.prototypes).toHaveLength(result.template.prototypes.length);
    expect(profile.staticRegions).toHaveLength(result.template.staticRegions.length);
    expect(profile.warnings).toEqual([...result.template.warnings]);
  });

  it('배열을 복사한다 — 소비자 변형이 분석 결과를 오염시키지 않는다', () => {
    const result = engine.analyzeDocument({ bytes: synthHwpx('valid') });
    const profile = toTemplateProfile(result.template, result.build);
    profile.warnings.push('오염');
    profile.prototypes.pop();
    expect(result.template.warnings).not.toContain('오염');
    expect(toTemplateProfile(result.template, result.build).prototypes).toHaveLength(
      result.template.prototypes.length,
    );
  });

  it('JSONB 왕복에 안정적이다 (canonicalJson 동치)', () => {
    const profile = profileOf('multi-section');
    const roundTripped = JSON.parse(JSON.stringify(profile)) as TemplateProfile;
    expect(canonicalJson(roundTripped)).toBe(canonicalJson(profile));
    // undefined가 섞이면 왕복에서 키가 사라진다. JSON 문자열 길이로 확인한다.
    expect(JSON.stringify(profile)).toBe(JSON.stringify(roundTripped));
  });

  it('열거값이 전부 도메인 유니온 안에 있다', () => {
    for (const fixture of ['valid', 'multi-section', 'flatten-only-object'] as const) {
      const profile = profileOf(fixture);
      for (const pattern of profile.outlinePatterns) {
        expect(OUTLINE_PATTERN_KINDS).toContain(pattern.kind);
        expect(pattern.outlineLevel).toBeGreaterThanOrEqual(1);
      }
      for (const prototype of profile.prototypes) {
        expect(CLONE_POLICIES).toContain(prototype.clonePolicy);
        expect(PREFIX_POLICIES).toContain(prototype.prefixPolicy);
        expect(prototype.immutable).toBe(true);
        expect(prototype.rawXmlAnchor.length).toBeGreaterThan(0);
      }
      for (const region of profile.staticRegions) {
        expect(STATIC_REGION_KINDS).toContain(region.kind);
        expect(region.locator).toMatch(/^[^#]+#.+$/);
      }
    }
  });

  it('분류 근거를 통째로 실어 나른다 (G15-1 판정 근거 재현)', () => {
    const profile = profileOf('flatten-only-object');
    expect(profile.compatibility.objects.length).toBeGreaterThan(0);
    for (const object of profile.compatibility.objects) {
      expect(object.reasonCode).toMatch(/^(PART|OBJ)-[A-Z0-9-]+$/);
      expect(object.evidence).toContain('::');
      expect(typeof object.capsVerdict).toBe('boolean');
    }
    // 수식이 상한 사유로 남아 있어야 판정(LIMITED)을 값으로 설명할 수 있다.
    const equation = profile.compatibility.objects.find(
      (object) => object.reasonCode === 'OBJ-EQUATION',
    );
    expect(equation?.objectClass).toBe('FLATTEN_EXPORT_ONLY');
    expect(equation?.capsVerdict).toBe(true);
    expect(profile.compatibility.verdict).toBe('LIMITED');
  });

  it('미분류 요소도 프로파일에 남는다 (리뷰 M-2)', () => {
    // 합성 픽스처의 hp:equation > hp:script가 그 자리다. 저장된 프로파일에서
    // "무엇을 분류하지 못했나"를 나중에도 확인할 수 있어야 한다.
    const profile = profileOf('flatten-only-object');
    const unclassified = profile.compatibility.unclassifiedElements;
    expect(unclassified.length).toBeGreaterThan(0);
    expect(unclassified.some((item) => item.parentLocalName === 'equation')).toBe(true);
    for (const item of unclassified) expect(item.anchor).toMatch(/^[^#]+#.+$/);
  });

  it('본문 텍스트를 담지 않는다 (security.md)', () => {
    // 합성 문서의 본문 문장이 프로파일 JSON에 나타나면 안 된다. 기호·공백은
    // 양식 어휘이므로 예외다(§1.6-3이 저장하라고 명시한 값).
    const json = JSON.stringify(profileOf('valid'));
    for (const bodyText of ['합성 보고 양식', '피해현황', '공백 구성요소', '구분', '내용']) {
      expect(json).not.toContain(bodyText);
    }
  });
});
