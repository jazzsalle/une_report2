import { describe, expect, it } from 'vitest';
import { SYSTEM_SAFE_DEFAULT } from '../analysis/prototype-registry';
import { editFixture } from './edit-fixtures';
import { applyPrefixPolicy, resolveSeed } from './prototype-resolve';

/**
 * Prototype Resolve (설계 07 §1.7 폴백 5단계 + prefixPolicy).
 */

const fx = editFixture();

describe('§1.7 resolvePrototype 폴백 체인', () => {
  it('1) exact — 역할과 level이 맞으면 그 원본을 쓴다', () => {
    const seed = resolveSeed({
      prototypes: fx.prototypes,
      index: fx.index,
      styleRole: 'OUTLINE_2',
      outlineLevel: 2,
    });
    expect(seed.step).toBe(1);
    expect(seed.warning).toBeNull();
    expect(seed.styleRole).toBe('OUTLINE_2');
  });

  it('3) nearest level — 없는 level은 같은 계열에서 대체하고 경고한다', () => {
    const seed = resolveSeed({
      prototypes: fx.prototypes,
      index: fx.index,
      styleRole: 'OUTLINE_2',
      outlineLevel: 7,
    });
    expect(seed.step).toBe(3);
    expect(seed.warning).toContain('7');
  });

  it('4) BODY_DEFAULT — 모르는 역할은 본문으로 떨어진다', () => {
    const seed = resolveSeed({
      prototypes: fx.prototypes,
      index: fx.index,
      styleRole: 'UNKNOWN_ROLE',
    });
    expect(seed.step).toBe(4);
    expect(seed.styleRole).toBe('BODY');
  });

  it('5) SYSTEM_SAFE_DEFAULT — 원본이 하나도 없으면 시스템 기본형 + 경고', () => {
    const seed = resolveSeed({ prototypes: [], index: fx.index, styleRole: 'BODY' });
    expect(seed.step).toBe(5);
    expect(seed.prototypeId).toBe(SYSTEM_SAFE_DEFAULT.prototypeId);
    expect(seed.warning).toContain('SYSTEM_SAFE_DEFAULT');
    // 원본 문단이 없으므로 승계할 서식 참조가 없다 — 값을 지어내지 않는다.
    expect(seed.styleRef).toEqual({
      paraPrId: null,
      charPrId: null,
      numberingId: null,
      styleId: null,
    });
  });

  it('IR 층은 styleRef만 승계하고 XML 복제는 prototypeId로 CC-160에 넘긴다', () => {
    const seed = resolveSeed({
      prototypes: fx.prototypes,
      index: fx.index,
      styleRole: 'OUTLINE_1',
      outlineLevel: 1,
    });
    expect(seed.prototypeId).toBeTruthy();
    expect(['CLONE_XML', 'CLONE_IR', 'REBUILD_ALLOWED']).toContain(seed.clonePolicy);
    expect(seed.styleRef.paraPrId).not.toBeNull();
  });
});

describe('§1.7 prefixPolicy', () => {
  it('KEEP_SOURCE_PREFIX는 원본 문자형 접두사를 붙인다', () => {
    const seed = resolveSeed({
      prototypes: fx.prototypes,
      index: fx.index,
      styleRole: 'OUTLINE_1',
      outlineLevel: 1,
    });
    expect(seed.prefixPolicy).toBe('KEEP_SOURCE_PREFIX');
    expect(seed.sourcePrefix.length).toBeGreaterThan(0);
    expect(applyPrefixPolicy(seed, '새 항목')).toBe(`${seed.sourcePrefix}새 항목`);
  });

  it('이미 접두사로 시작하는 텍스트에는 다시 붙이지 않는다', () => {
    const seed = resolveSeed({
      prototypes: fx.prototypes,
      index: fx.index,
      styleRole: 'OUTLINE_1',
      outlineLevel: 1,
    });
    const once = applyPrefixPolicy(seed, '항목');
    expect(applyPrefixPolicy(seed, once)).toBe(once);
  });

  it('REPLACE_TEXT_ONLY는 텍스트만 넣는다', () => {
    const seed = resolveSeed({ prototypes: fx.prototypes, index: fx.index, styleRole: 'BODY' });
    expect(seed.prefixPolicy).toBe('REPLACE_TEXT_ONLY');
    expect(applyPrefixPolicy(seed, '본문')).toBe('본문');
  });

  it('NUMBERING_ENGINE은 문자 접두사를 붙이지 않는다(번호가 두 번 찍힌다)', () => {
    const seed = resolveSeed({
      prototypes: fx.prototypes,
      index: fx.index,
      styleRole: 'OUTLINE_1',
      outlineLevel: 1,
    });
    const numbering = { ...seed, prefixPolicy: 'NUMBERING_ENGINE' as const };
    expect(applyPrefixPolicy(numbering, '제목')).toBe('제목');
  });
});
