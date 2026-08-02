import { HWPX_OBJECT_CLASSES } from '@une/domain';
import { describe, expect, it } from 'vitest';
import { KNOWN_NAMESPACE_URIS } from '../package/xml';
import {
  CATCH_ALL_REASON_CODES,
  CLASSIFICATION_PROPERTY_PARENTS,
  OBJECT_RULES,
  REJECT_RULES,
  UNKNOWN_NAMESPACE_RULE,
  capsVerdictOf,
  matchElementRule,
  matchPartRule,
  type ObjectRule,
} from './object-rules';

/**
 * 규칙표가 **데이터**임을 지키는 테스트. 등급이 코드 분기로 흩어지면
 * "무엇이 왜 그 등급인가"를 표로 보여줄 수 없다(G15-1).
 */

describe('규칙표 자체의 건전성', () => {
  it('reasonCode는 유일하고 명명 규약을 따른다', () => {
    const codes = OBJECT_RULES.map((rule) => rule.reasonCode);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^(PART|OBJ)-[A-Z0-9-]+$/);
  });

  it('모든 규칙이 도메인 등급 유니온 안의 값을 쓴다', () => {
    for (const rule of OBJECT_RULES) {
      expect(HWPX_OBJECT_CLASSES).toContain(rule.objectClass);
    }
  });

  it('모든 규칙에 설계 근거(rationale)가 있다 — 근거 없는 등급은 취향이다', () => {
    for (const rule of [...OBJECT_RULES, UNKNOWN_NAMESPACE_RULE, ...Object.values(REJECT_RULES)]) {
      expect(rule.rationale.length).toBeGreaterThan(10);
      expect(rule.rationale).toMatch(/§/);
    }
  });

  it('PART 규칙은 모든 경로를 덮는다(마지막 폴백 존재)', () => {
    for (const path of ['mimetype', 'Zzz/unknown.bin', 'Contents/section12.xml']) {
      expect(() => matchPartRule(path)).not.toThrow();
    }
  });
});

describe('ADR v1.1 §8.4 등급 매핑', () => {
  const cases: Array<[string, string, string]> = [
    ['Contents/section0.xml', 'NATIVE_EDIT', 'PART-CONTENT-SECTION'],
    ['Contents/header.xml', 'NATIVE_EDIT', 'PART-CONTENT-HEADER'],
    ['mimetype', 'NATIVE_EDIT', 'PART-OPC-DESCRIPTOR'],
    ['Scripts/headerScripts.js', 'PRESERVE_ONLY', 'PART-SCRIPT'],
    ['META-INF/container.rdf', 'PRESERVE_ONLY', 'PART-RDF'],
    ['Preview/PrvImage.png', 'PRESERVE_ONLY', 'PART-PREVIEW'],
    ['BinData/image1.BMP', 'PRESERVE_ONLY', 'PART-BINDATA'],
    ['settings.xml', 'PRESERVE_ONLY', 'PART-UNMODELED'],
  ];

  for (const [path, objectClass, reasonCode] of cases) {
    it(`${path} → ${objectClass} (${reasonCode})`, () => {
      const rule = matchPartRule(path);
      expect(rule.objectClass).toBe(objectClass);
      expect(rule.reasonCode).toBe(reasonCode);
    });
  }
});

describe('요소 규칙', () => {
  const element = (localName: string, parent: string | null, ns = KNOWN_HP) =>
    matchElementRule(localName, parent, ns, KNOWN_NAMESPACE_URIS);

  it('NATIVE_EDIT: 문단·런·텍스트·표', () => {
    expect(element('p', 'sec')?.objectClass).toBe('NATIVE_EDIT');
    expect(element('t', 'run')?.objectClass).toBe('NATIVE_EDIT');
    expect(element('tab', 'run')?.objectClass).toBe('NATIVE_EDIT');
    expect(element('tbl', 'run')?.objectClass).toBe('NATIVE_EDIT');
    expect(element('cellSpan', 'tc')?.objectClass).toBe('NATIVE_EDIT');
  });

  it('PRESERVE_ONLY: 그림·머리말·자동 쪽번호·필드 (사용자에게 제한을 표시할 대상)', () => {
    expect(element('pic', 'run')?.reasonCode).toBe('OBJ-PIC-BINDATA');
    expect(element('header', 'ctrl')?.reasonCode).toBe('OBJ-CTRL-HEADER-FOOTER');
    expect(element('pageNum', 'ctrl')?.reasonCode).toBe('OBJ-CTRL-PAGE-NUMBER');
    expect(element('newNum', 'ctrl')?.reasonCode).toBe('OBJ-CTRL-PAGE-NUMBER');
    expect(element('footNote', 'ctrl')?.reasonCode).toBe('OBJ-CTRL-NOTE');
    expect(element('fieldBegin', 'run')?.reasonCode).toBe('OBJ-FIELD');
  });

  /**
   * 과분류 시정 회귀 + 등급/상한 축 분리 (리뷰 M-3).
   *
   * 두 가지를 **동시에** 지킨다.
   *  (1) 등급은 사실대로 PRESERVE_ONLY다 — IR이 파싱하지 않으므로 NATIVE_EDIT는
   *      거짓 약속이고, CC-160이 등급으로 저장 정책을 분기할 때 위험하다.
   *  (2) 상한은 유발하지 않는다 — 유발하면 모든 실문서가 다시 LIMITED가 되고
   *      AUTO/CONFIRM 밴드가 죽는다.
   * 하나만 지키면 둘 중 하나가 조용히 되돌아간다.
   */
  it('레이아웃 속성: PRESERVE_ONLY이되 상한을 유발하지 않는다', () => {
    for (const localName of ['colPr', 'pageHiding', 'pageBorderFill', 'masterPage']) {
      const rule = element(localName, 'ctrl');
      expect(rule?.reasonCode).toBe('OBJ-SECTION-LAYOUT-PROPERTY');
      expect(rule?.objectClass).toBe('PRESERVE_ONLY');
      expect(capsVerdictOf(rule as ObjectRule)).toBe(false);
    }
  });

  it('공백·줄바꿈: PRESERVE_ONLY이되 상한을 유발하지 않는다 (§1.6 공백은 계층 신호)', () => {
    for (const [localName, parent] of [
      ['fwSpace', 'run'],
      ['nbSpace', 'run'],
      ['lineBreak', 't'],
      ['hypen', 't'],
    ] as const) {
      const rule = element(localName, parent);
      expect(rule?.reasonCode).toBe('OBJ-WHITESPACE-STRUCTURE');
      expect(rule?.objectClass).toBe('PRESERVE_ONLY');
      expect(capsVerdictOf(rule as ObjectRule)).toBe(false);
    }
  });

  it('그 외 규칙은 전부 상한을 유발한다 (기본값이 안전한 쪽이다)', () => {
    const nonCapping = OBJECT_RULES.filter((rule) => !capsVerdictOf(rule)).map(
      (rule) => rule.reasonCode,
    );
    expect(nonCapping).toEqual(['OBJ-SECTION-LAYOUT-PROPERTY', 'OBJ-WHITESPACE-STRUCTURE']);
    expect(capsVerdictOf(UNKNOWN_NAMESPACE_RULE)).toBe(true);
    for (const rule of Object.values(REJECT_RULES)) expect(capsVerdictOf(rule)).toBe(true);
  });

  it('catch-all은 진짜 미지의 것만 잡는다', () => {
    expect(element('someUnknownCtrl', 'ctrl')?.reasonCode).toBe('OBJ-CTRL-UNMODELED');
    expect(element('someUnknownInline', 'run')?.reasonCode).toBe('OBJ-INLINE-UNMODELED');
    // catch-all 목록은 회귀 가드가 참조하는 정본이다.
    expect(CATCH_ALL_REASON_CODES).toEqual([
      'OBJ-CTRL-UNMODELED',
      'OBJ-INLINE-UNMODELED',
      'OBJ-UNKNOWN-NAMESPACE',
    ]);
    for (const code of CATCH_ALL_REASON_CODES) {
      const rule = [...OBJECT_RULES, UNKNOWN_NAMESPACE_RULE].find(
        (item) => item.reasonCode === code,
      );
      expect(rule?.objectClass).toBe('PRESERVE_ONLY');
    }
  });

  it('FLATTEN_EXPORT_ONLY: 수식·OLE·차트·동영상·폼컨트롤', () => {
    for (const localName of ['equation', 'ole', 'chart', 'video', 'comboBox']) {
      expect(element(localName, 'run')?.objectClass).toBe('FLATTEN_EXPORT_ONLY');
    }
  });

  it('미지 네임스페이스 요소는 PRESERVE_ONLY (§1.3 raw fragment 보존)', () => {
    const rule = matchElementRule('anything', 'run', 'urn:vendor:unknown', KNOWN_NAMESPACE_URIS);
    expect(rule).toBe(UNKNOWN_NAMESPACE_RULE);
    expect(rule?.objectClass).toBe('PRESERVE_ONLY');
  });

  it('네임스페이스 미선언(null)도 미지로 본다 — 가장 값싼 우회를 막는다', () => {
    // 이전 구현은 `namespaceUri !== null` 조건이라, 알려진 이름을 쓰되
    // xmlns를 선언하지 않으면 미지 가드를 그대로 지나쳤다(리뷰 M-2).
    const rule = matchElementRule('p', 'sec', null, KNOWN_NAMESPACE_URIS);
    expect(rule).toBe(UNKNOWN_NAMESPACE_RULE);
    expect(rule?.objectClass).toBe('PRESERVE_ONLY');
  });

  it('속성 노드 컨테이너 목록은 검토된 상수다 (미분류 판정의 기준)', () => {
    // 분류기가 잡지 않는 요소는 전부 이 목록의 자식이어야 한다. 목록에 없는
    // 부모 밑에서 미분류가 나오면 회귀 테스트가 실패한다(리뷰 M-2).
    expect(CLASSIFICATION_PROPERTY_PARENTS.has('secPr')).toBe(true);
    expect(CLASSIFICATION_PROPERTY_PARENTS.has('pic')).toBe(true);
    expect(CLASSIFICATION_PROPERTY_PARENTS.has('fieldBegin')).toBe(true);
    // 본문 컨테이너는 여기 들어오면 안 된다 — 들어오면 실제 객체가 속성으로
    // 오분류된다.
    for (const forbidden of ['p', 'run', 't', 'tbl', 'tc', 'ctrl', 'sec']) {
      expect(CLASSIFICATION_PROPERTY_PARENTS.has(forbidden)).toBe(false);
    }
  });

  it('규칙에 걸리지 않는 구조 요소는 분류하지 않는다(null)', () => {
    expect(element('pagePr', 'secPr')).toBeNull();
    expect(element('orgSz', 'pic')).toBeNull();
  });

  it('REJECT 규칙은 별도 상수로만 존재한다(요소 규칙표에는 REJECT가 없다)', () => {
    expect(OBJECT_RULES.some((rule) => rule.objectClass === 'REJECT')).toBe(false);
    expect(REJECT_RULES.requiredPartMissing.objectClass).toBe('REJECT');
    expect(REJECT_RULES.danglingReference.objectClass).toBe('REJECT');
    expect(REJECT_RULES.mimetypeMismatch.objectClass).toBe('REJECT');
  });
});

const KNOWN_HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
