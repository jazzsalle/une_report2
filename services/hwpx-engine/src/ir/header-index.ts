import type { StyleIndex, StyleIndexEntry } from '@une/domain';
import { childrenNamed, firstChild, textOf, walk, type XmlElement } from '../package/xml';

/**
 * header.xml 참조표 색인 (설계 07 §1.4-4: "section Part를 파싱하기 **전에**
 * paraPr/charPr/style/numbering/bullet/binData를 먼저 색인한다").
 *
 * 도메인 `StyleIndex`는 "verbatim 속성 맵"이 계약이므로(문서-IR 주석) 요소
 * 자신의 속성만 담는다. 반면 TemplateAnalyzer는 들여쓰기·정렬·개요수준처럼
 * **자식 요소에 있는 값**이 필요하다. 두 요구를 섞으면 도메인 계약이
 * 흐려지므로, 파생값은 엔진 소유의 `ParaPrDetail`/`CharPrDetail`에 따로 둔다.
 */

export interface ParaPrDetail {
  readonly id: number;
  readonly align: string | null;
  readonly headingType: string | null;
  readonly headingLevel: number | null;
  readonly headingIdRef: number | null;
  /** HWPUNIT. 좌여백·내어쓰기·문단 앞뒤 간격. */
  readonly marginLeft: number;
  readonly marginRight: number;
  readonly marginIntent: number;
  readonly spacingPrev: number;
  readonly spacingNext: number;
  readonly lineSpacingType: string | null;
  readonly lineSpacingValue: number | null;
}

export interface CharPrDetail {
  readonly id: number;
  readonly height: number | null;
  readonly textColor: string | null;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly fontRefHangul: string | null;
}

export interface HeaderIndex {
  readonly styleIndex: StyleIndex;
  readonly paraPr: ReadonlyMap<number, ParaPrDetail>;
  readonly charPr: ReadonlyMap<number, CharPrDetail>;
  readonly styleIds: ReadonlySet<number>;
  readonly numberingIds: ReadonlySet<number>;
  readonly bulletIds: ReadonlySet<number>;
  readonly binDataIds: ReadonlySet<string>;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIdList(root: XmlElement, containerLocal: string, itemLocal: string): XmlElement[] {
  const container = firstChild(root, 'refList') ?? root;
  const holder = firstChild(container, containerLocal);
  return holder ? childrenNamed(holder, itemLocal) : [];
}

function toEntries(elements: readonly XmlElement[]): StyleIndexEntry[] {
  return elements.map((element) => ({
    id: toNumber(element.attributes.id, -1),
    attributes: { ...element.attributes },
  }));
}

function childValue(parent: XmlElement, path: readonly string[]): XmlElement | null {
  let node: XmlElement | null = parent;
  for (const step of path) {
    if (!node) return null;
    node = firstChild(node, step);
  }
  return node;
}

function unitValue(parent: XmlElement | null, local: string): number {
  const node = parent ? firstChild(parent, local) : null;
  return node ? toNumber(node.attributes.value, 0) : 0;
}

function readParaPrDetail(element: XmlElement): ParaPrDetail {
  const align = firstChild(element, 'align');
  const heading = firstChild(element, 'heading');
  const margin = firstChild(element, 'margin');
  const lineSpacing = firstChild(element, 'lineSpacing');
  return {
    id: toNumber(element.attributes.id, -1),
    align: align?.attributes.horizontal ?? null,
    headingType: heading?.attributes.type ?? null,
    headingLevel: heading ? toNumber(heading.attributes.level, 0) : null,
    headingIdRef: heading ? toNumber(heading.attributes.idRef, 0) : null,
    marginLeft: unitValue(margin, 'left'),
    marginRight: unitValue(margin, 'right'),
    marginIntent: unitValue(margin, 'intent'),
    spacingPrev: unitValue(margin, 'prev'),
    spacingNext: unitValue(margin, 'next'),
    lineSpacingType: lineSpacing?.attributes.type ?? null,
    lineSpacingValue: lineSpacing ? toNumber(lineSpacing.attributes.value, 0) : null,
  };
}

function readCharPrDetail(element: XmlElement): CharPrDetail {
  const fontRef = firstChild(element, 'fontRef');
  return {
    id: toNumber(element.attributes.id, -1),
    height: element.attributes.height === undefined ? null : toNumber(element.attributes.height, 0),
    textColor: element.attributes.textColor ?? null,
    bold: firstChild(element, 'bold') !== null,
    italic: firstChild(element, 'italic') !== null,
    underline: firstChild(element, 'underline') !== null,
    fontRefHangul: fontRef?.attributes.hangul ?? null,
  };
}

/**
 * binData 참조는 header.xml(`hh:binDataList`)과 content.hpf 매니페스트 두 곳에
 * 나타난다. 실 코퍼스는 후자만 쓰므로(BinData/imageN.BMP가 opf:item으로 등재)
 * 둘 다 받아 합집합으로 색인한다.
 */
export function buildHeaderIndex(
  headerRoot: XmlElement,
  manifestBinDataIds: readonly string[] = [],
): HeaderIndex {
  const paraPrElements = toIdList(headerRoot, 'paraProperties', 'paraPr');
  const charPrElements = toIdList(headerRoot, 'charProperties', 'charPr');
  const styleElements = toIdList(headerRoot, 'styles', 'style');
  const numberingElements = toIdList(headerRoot, 'numberings', 'numbering');
  const bulletElements = toIdList(headerRoot, 'bullets', 'bullet');

  const binDataElements: XmlElement[] = [];
  for (const element of walk(headerRoot)) {
    if (element.localName === 'binData' || element.localName === 'binItem') {
      binDataElements.push(element);
    }
  }

  const styleIndex: StyleIndex = {
    paraPr: toEntries(paraPrElements),
    charPr: toEntries(charPrElements),
    style: toEntries(styleElements),
    numbering: toEntries(numberingElements),
    bullet: toEntries(bulletElements),
    binData: toEntries(binDataElements),
  };

  const paraPr = new Map<number, ParaPrDetail>();
  for (const element of paraPrElements) {
    const detail = readParaPrDetail(element);
    paraPr.set(detail.id, detail);
  }
  const charPr = new Map<number, CharPrDetail>();
  for (const element of charPrElements) {
    const detail = readCharPrDetail(element);
    charPr.set(detail.id, detail);
  }

  const binDataIds = new Set<string>(manifestBinDataIds);
  for (const element of binDataElements) {
    if (element.attributes.id !== undefined) binDataIds.add(element.attributes.id);
    if (element.attributes.binaryItemIDRef !== undefined) {
      binDataIds.add(element.attributes.binaryItemIDRef);
    }
  }

  return {
    styleIndex,
    paraPr,
    charPr,
    styleIds: new Set(styleIndex.style.map((entry) => entry.id)),
    numberingIds: new Set(styleIndex.numbering.map((entry) => entry.id)),
    bulletIds: new Set(styleIndex.bullet.map((entry) => entry.id)),
    binDataIds,
  };
}

/** 개요 문단머리(hh:paraHead) 텍스트 — OutlinePatternAnalyzer 1단계 입력. */
export function numberingHeadTexts(headerRoot: XmlElement): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const container = firstChild(headerRoot, 'refList') ?? headerRoot;
  const numberings = firstChild(container, 'numberings');
  for (const numbering of numberings ? childrenNamed(numberings, 'numbering') : []) {
    const id = numbering.attributes.id ?? '';
    const heads = childrenNamed(numbering, 'paraHead').map((head) => textOf(head));
    result.set(id, heads);
  }
  return result;
}

/** paraPr가 참조하는 borderFill 등 하위 참조 존재 확인용 헬퍼. */
export function hasChildPath(element: XmlElement, path: readonly string[]): boolean {
  return childValue(element, path) !== null;
}
