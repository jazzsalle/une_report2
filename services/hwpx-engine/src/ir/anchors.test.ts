import { describe, expect, it } from 'vitest';
import { childrenNamed, firstChild, parseXml, walk, type XmlElement } from '../package/xml';
import { anchorOf, parseAnchor, partAnchor, resolveAnchor } from './anchors';

const SECTION = parseXml(
  'Contents/section0.xml',
  new Uint8Array(
    Buffer.from(
      '<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" ' +
        'xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">' +
        '<hp:p/><hp:p/><hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p/></hp:subList>' +
        '</hp:tc></hp:tr></hp:tbl></hp:run></hp:p>' +
        '</hs:sec>',
      'utf8',
    ),
  ),
);

const PARTS: ReadonlyMap<string, XmlElement> = new Map([['Contents/section0.xml', SECTION]]);

describe('anchorOf (ADR-29 D6)', () => {
  it('설계 예시 형식 partPath#local[ordinal]을 따른다', () => {
    const paragraphs = childrenNamed(SECTION, 'p');
    expect(anchorOf(paragraphs[0])).toBe('Contents/section0.xml#p[1]');
    expect(anchorOf(paragraphs[2])).toBe('Contents/section0.xml#p[3]');
  });

  it('중첩 경로는 루트를 생략하고 이어붙인다', () => {
    const cellParagraph = [...walk(SECTION)].filter(
      (element) => element.localName === 'p' && element.parent?.localName === 'subList',
    )[0];
    expect(anchorOf(cellParagraph)).toBe(
      'Contents/section0.xml#p[3]/run[1]/tbl[1]/tr[1]/tc[1]/subList[1]/p[1]',
    );
  });

  it('바이트 오프셋을 쓰지 않는다(D6) — 숫자는 전부 형제 서수다', () => {
    for (const element of walk(SECTION)) {
      const parsed = parseAnchor(anchorOf(element));
      expect(parsed).not.toBeNull();
      for (const step of parsed!.steps) expect(step.ordinal).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('resolveAnchor (I2 역참조)', () => {
  it('발급한 앵커를 100% 역참조한다', () => {
    for (const element of walk(SECTION)) {
      expect(resolveAnchor(anchorOf(element), PARTS)).toBe(element);
    }
  });

  it('없는 Part·없는 서수·형식 오류는 null', () => {
    expect(resolveAnchor('Contents/section9.xml#p[1]', PARTS)).toBeNull();
    expect(resolveAnchor('Contents/section0.xml#p[99]', PARTS)).toBeNull();
    expect(resolveAnchor('Contents/section0.xml#p', PARTS)).toBeNull();
    expect(resolveAnchor('no-separator', PARTS)).toBeNull();
  });

  it('partAnchor는 루트를 지목하고 `#` 뒤가 비지 않는다(계약 스키마 패턴 충족)', () => {
    expect(partAnchor('Contents/section0.xml')).toBe('Contents/section0.xml#sec[1]');
    expect(partAnchor('Contents/section0.xml')).toMatch(/^[^#]+#.+$/);
    expect(resolveAnchor(partAnchor('Contents/section0.xml'), PARTS)).toBe(SECTION);
  });

  it('IR이 내는 모든 앵커가 계약 스키마의 rawXmlAnchor 패턴을 만족한다', () => {
    for (const element of walk(SECTION)) {
      expect(anchorOf(element)).toMatch(/^[^#]+#.+$/);
    }
  });

  it('firstChild는 직계 자식만 본다', () => {
    expect(firstChild(SECTION, 'tbl')).toBeNull();
  });
});
