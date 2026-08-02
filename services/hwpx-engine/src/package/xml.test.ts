import { describe, expect, it } from 'vitest';
import { HwpxImportError } from './errors';
import { DEFAULT_HWPX_LIMITS } from './limits';
import {
  HWPX_NAMESPACES,
  KNOWN_NAMESPACE_URIS,
  assertNoDoctype,
  childrenNamed,
  elementsOf,
  firstChild,
  parseXml,
  textOf,
  walk,
} from './xml';

function xml(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'utf8'));
}

describe('parseXml — 방어', () => {
  it('HWPX-1001: <!DOCTYPE는 파서 설정이 아니라 바이트 스캔으로 거부한다', () => {
    expect(() =>
      parseXml('Contents/section0.xml', xml('<!DOCTYPE a [<!ENTITY x "y">]><a/>')),
    ).toThrowError(HwpxImportError);
    try {
      assertNoDoctype('p.xml', xml('<?xml version="1.0"?><!DOCTYPE a><a/>'));
    } catch (error) {
      expect((error as HwpxImportError).code).toBe('HWPX-1001');
      expect((error as HwpxImportError).detail).toMatch(/DOCTYPE/);
    }
  });

  it('HWPX-1001: <!ENTITY 선언도 거부한다', () => {
    expect(() => assertNoDoctype('p.xml', xml('<a><!ENTITY z "q"></a>'))).toThrowError(/ENTITY/);
  });

  it('HWPX-1001: 정의되지 않은 엔터티 참조를 해석하지 않고 거부한다', () => {
    expect(() => parseXml('p.xml', xml('<a>&xxe;</a>'))).toThrowError(/정의되지 않은 엔터티/);
  });

  it('미리 정의된 엔터티와 숫자 참조만 해석한다', () => {
    const root = parseXml('p.xml', xml('<a>&lt;&amp;&gt;&quot;&apos;&#65;&#x42;</a>'));
    expect(textOf(root)).toBe('<&>"\'AB');
  });

  it('루트가 둘이거나 태그 짝이 안 맞으면 거부한다', () => {
    expect(() => parseXml('p.xml', xml('<a/><b/>'))).toThrowError(/루트 요소가 둘/);
    expect(() => parseXml('p.xml', xml('<a><b></a>'))).toThrowError(/짝이 맞지 않습니다/);
  });

  /**
   * 깊이·요소 수 한도 (리뷰 m-2).
   *
   * 파서 자체는 반복문이라 깊은 중첩에서도 죽지 않는다. 죽는 것은 그 뒤의
   * 재귀 순회(`walk`/`textOf`/`canonicalJson`)이고, 그때 나오는 `RangeError`는
   * `HwpxImportError`가 아니라 반입 층이 다룰 수 없는 형태다. 그래서 파싱
   * 시점에 HWPX-1002로 잘라야 한다.
   */
  it('HWPX-1002: XML 중첩 깊이 한도를 넘으면 거부한다', () => {
    const deep = `${'<a>'.repeat(20)}x${'</a>'.repeat(20)}`;
    const limits = { ...DEFAULT_HWPX_LIMITS, maxXmlDepth: 10 };
    try {
      parseXml('Contents/section0.xml', xml(deep), limits);
      throw new Error('거부되지 않았습니다');
    } catch (error) {
      expect(error).toBeInstanceOf(HwpxImportError);
      expect((error as HwpxImportError).code).toBe('HWPX-1002');
      expect((error as HwpxImportError).locator).toBe('Contents/section0.xml');
      expect((error as HwpxImportError).detail).toMatch(/중첩 깊이 한도 초과 \(11 > 10/);
    }
  });

  it('HWPX-1002: XML 요소 수 한도를 넘으면 거부한다', () => {
    const wide = `<a>${'<b/>'.repeat(20)}</a>`;
    expect(() =>
      parseXml('p.xml', xml(wide), { ...DEFAULT_HWPX_LIMITS, maxElementCount: 10 }),
    ).toThrowError(/요소 수 한도 초과/);
  });

  it('한도 경계를 정확히 지킨다 (깊이 == 한도는 통과)', () => {
    const exact = `${'<a>'.repeat(10)}x${'</a>'.repeat(10)}`;
    expect(() =>
      parseXml('p.xml', xml(exact), { ...DEFAULT_HWPX_LIMITS, maxXmlDepth: 10 }),
    ).not.toThrow();
  });

  it('기본 한도는 실 코퍼스 실측값보다 넉넉하다 (깊이 28, Part당 요소 1,735)', () => {
    // 한도가 실측값에 붙어 있으면 정상 문서가 거부된다. 자릿수 여유를 값으로
    // 고정해 두어야 나중에 누가 "조금만 줄이자"고 할 때 근거가 보인다.
    expect(DEFAULT_HWPX_LIMITS.maxXmlDepth).toBeGreaterThanOrEqual(28 * 5);
    expect(DEFAULT_HWPX_LIMITS.maxElementCount).toBeGreaterThanOrEqual(1735 * 50);
  });
});

describe('parseXml — 네임스페이스와 서수', () => {
  const document = parseXml(
    'Contents/section0.xml',
    xml(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ' +
        'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">' +
        '<hp:p id="1"><hp:run><hp:t>가<hp:lineBreak/>나</hp:t></hp:run></hp:p>' +
        '<hp:p id="2"><hp:run/><hp:run/></hp:p>' +
        '</hs:sec>',
    ),
  );

  it('접두사를 URI로 해석한다', () => {
    expect(document.namespaceUri).toBe(HWPX_NAMESPACES.hs);
    expect(childrenNamed(document, 'p')[0].namespaceUri).toBe(HWPX_NAMESPACES.hp);
    expect(KNOWN_NAMESPACE_URIS.has(HWPX_NAMESPACES.hp)).toBe(true);
  });

  it('같은 localName 형제에 1-base 서수를 매긴다', () => {
    const paragraphs = childrenNamed(document, 'p');
    expect(paragraphs.map((element) => element.ordinal)).toEqual([1, 2]);
    expect(childrenNamed(paragraphs[1], 'run').map((element) => element.ordinal)).toEqual([1, 2]);
  });

  it('속성은 정규화하지 않고 원문 그대로 보존한다', () => {
    expect(childrenNamed(document, 'p')[0].attributes).toEqual({ id: '1' });
  });

  it('텍스트 사이의 인라인 요소를 잃지 않는다', () => {
    const text = firstChild(firstChild(childrenNamed(document, 'p')[0], 'run')!, 't')!;
    expect(textOf(text)).toBe('가나');
    expect(elementsOf(text).map((element) => element.localName)).toEqual(['lineBreak']);
  });

  it('walk는 문서 순서로 자손 전체를 낸다', () => {
    expect([...walk(document)].map((element) => element.localName)).toEqual([
      'sec',
      'p',
      'run',
      't',
      'lineBreak',
      'p',
      'run',
      'run',
    ]);
  });
});
