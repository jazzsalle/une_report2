import { describe, expect, it } from 'vitest';
import { HwpxEngine } from '../contract';
import { synthHwpx } from '../testing/synth-hwpx';
import { SYSTEM_SAFE_DEFAULT, resolvePrototype, type Prototype } from './prototype-registry';

const engine = new HwpxEngine();

function prototype(overrides: Partial<Prototype>): Prototype {
  return {
    prototypeId: 'PROTO-TEST',
    sourceParagraphId: 'P-TEST',
    sourceTableId: null,
    styleRole: 'OUTLINE_1',
    outlineLevel: 1,
    tableContext: false,
    clonePolicy: 'CLONE_XML',
    prefixPolicy: 'KEEP_SOURCE_PREFIX',
    fallbackChain: [],
    rawXmlAnchor: 'Contents/section0.xml#p[1]',
    immutable: true,
    ...overrides,
  } as Prototype;
}

describe('resolvePrototype — §1.7 폴백 5단계', () => {
  const registry = [
    prototype({ prototypeId: 'A', styleRole: 'OUTLINE_1', outlineLevel: 1 }),
    prototype({
      prototypeId: 'B',
      styleRole: 'OUTLINE_1',
      outlineLevel: 1,
      tableContext: true,
    }),
    prototype({ prototypeId: 'C', styleRole: 'OUTLINE_3', outlineLevel: 3 }),
    prototype({ prototypeId: 'D', styleRole: 'BODY', outlineLevel: null }),
  ];

  it('1) exact(role, level, tableContext)', () => {
    const result = resolvePrototype(registry, {
      styleRole: 'OUTLINE_1',
      outlineLevel: 1,
      tableContext: true,
    });
    expect(result.prototype?.prototypeId).toBe('B');
    expect(result.step).toBe(1);
    expect(result.warning).toBeNull();
  });

  it('3) 같은 family의 가장 가까운 level로 대체하고 경고를 남긴다', () => {
    const result = resolvePrototype(registry, { styleRole: 'OUTLINE_3', outlineLevel: 5 });
    expect(result.prototype?.prototypeId).toBe('C');
    expect(result.step).toBe(3);
    expect(result.warning).toMatch(/대체/);
  });

  it('4) BODY_DEFAULT', () => {
    const result = resolvePrototype(registry, { styleRole: 'CAPTION' });
    expect(result.prototype?.prototypeId).toBe('D');
    expect(result.step).toBe(4);
  });

  it('5) SYSTEM_SAFE_DEFAULT + warning', () => {
    const result = resolvePrototype([], { styleRole: 'CAPTION' });
    expect(result.prototype).toBe(SYSTEM_SAFE_DEFAULT);
    expect(result.step).toBe(5);
    expect(result.warning).toMatch(/서식 손실/);
  });
});

describe('clonePolicy 기본값 — §1.7 "기본 정책은 CLONE_XML"', () => {
  const result = engine.analyzeDocument({ bytes: synthHwpx('valid') });

  it('모든 Prototype이 불변이고 원본 앵커를 갖는다', () => {
    for (const item of result.template.prototypes) {
      expect(item.immutable).toBe(true);
      expect(item.rawXmlAnchor).toMatch(/^Contents\/section\d+\.xml#/);
      expect(item.evidence).toContain('§1.7');
    }
  });

  it('표 Prototype은 언제나 CLONE_XML이다(미지원 속성 손실 방지)', () => {
    const table = result.template.prototypes.find((item) => item.styleRole === 'TABLE_DEFAULT');
    expect(table?.clonePolicy).toBe('CLONE_XML');
  });

  it('문자형 접두사가 있으면 재구성을 허용하지 않는다(CLONE_IR 이하)', () => {
    const outline = result.template.prototypes.filter((item) =>
      item.styleRole.startsWith('OUTLINE_'),
    );
    expect(outline.length).toBeGreaterThan(0);
    for (const item of outline) {
      expect(item.clonePolicy).not.toBe('REBUILD_ALLOWED');
      expect(item.prefixPolicy).toBe('KEEP_SOURCE_PREFIX');
    }
  });

  it('fallbackChain은 항상 BODY_DEFAULT → SYSTEM_SAFE_DEFAULT로 끝난다', () => {
    for (const item of result.template.prototypes) {
      expect(item.fallbackChain.slice(-2)).toEqual(['BODY_DEFAULT', 'SYSTEM_SAFE_DEFAULT']);
    }
  });
});
