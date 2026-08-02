import type { RawXmlAnchor, StaticRegionKind } from '@une/domain';
import { sourceAnchor } from '../ir/anchors';
import type { HeaderIndex } from '../ir/header-index';
import type { ParagraphSource, TableSource } from '../ir/ir-builder';
import { stableId } from '../ir/stable-id';
import { childrenNamed, isElement, walk, type XmlElement } from '../package/xml';
import { paragraphText } from './outline-pattern';

/**
 * 정적 영역 탐지 (설계 07 §1.5 출력 `staticRegions`).
 *
 * 정적 영역은 "생성이 건드리면 안 되는 자리"다 — 머리말·꼬리말·표지·결재란·
 * 고정문구·필드. CC-150의 재생성이 이 자리를 덮어쓰면 사용자 편집 보호
 * (CLAUDE.md "User-edited blocks are protected") 이전에 **양식 자체**가 망가진다.
 *
 * 보안: `evidence`에 본문 텍스트를 넣지 않는다. 매칭된 **라벨 키워드**와
 * 카운트만 남긴다(라벨은 '결재'·'담당'처럼 양식 어휘이며 개인정보가 아니다).
 */

/**
 * 종류 유니온은 `@une/domain`이 정본이다(ADR-29 D4, 리뷰 M-1). 8종 전부가
 * 외부 표현(TemplateProfile)에 그대로 나타나야 한다 — 5종만 표현 가능한
 * 스키마는 PAGE_NUMBER·NOTE·COVER_TITLE·FIXED_PHRASE·APPROVAL_BLOCK을 조용히
 * 떨어뜨리고, 그것들이야말로 "생성이 건드리면 안 되는 자리"다.
 */
export type { StaticRegionKind };

export interface StaticRegion {
  readonly regionId: string;
  readonly kind: StaticRegionKind;
  readonly locator: RawXmlAnchor;
  readonly evidence: string;
}

/** 결재란 라벨 사전. 2개 이상 일치해야 결재란으로 본다(단어 하나는 우연이다). */
const APPROVAL_LABELS = [
  '결재',
  '담당',
  '주무관',
  '팀장',
  '과장',
  '국장',
  '실장',
  '부서장',
  '검토',
  '승인',
  '협조',
  '전결',
];

/** 보고 양식의 고정 문구. 본문이 아니라 서식 문구다. */
const FIXED_PHRASE_PATTERNS = [
  /^\s*붙\s*임/u,
  /^\s*첨\s*부/u,
  /^\s*끝\s*\.?\s*$/u,
  /^\s*이\s*상\s*$/u,
  /^\s*작\s*성\s*자/u,
  /^\s*담\s*당\s*자/u,
  /^\s*연\s*락\s*처/u,
  /^\s*[-–—]\s*.*기준\s*[-–—]\s*$/u,
];

const CONTROL_KIND: Readonly<Record<string, StaticRegionKind>> = Object.freeze({
  header: 'HEADER',
  footer: 'FOOTER',
  pageNum: 'PAGE_NUMBER',
  newNum: 'PAGE_NUMBER',
  autoNum: 'PAGE_NUMBER',
  pageHiding: 'PAGE_NUMBER',
  footNote: 'NOTE',
  endNote: 'NOTE',
});

function region(kind: StaticRegionKind, locator: string, evidence: string): StaticRegion {
  return { regionId: stableId('REG', kind, locator), kind, locator, evidence };
}

export interface DetectStaticRegionsInput {
  readonly sectionRoots: ReadonlyMap<string, XmlElement>;
  readonly paragraphs: readonly ParagraphSource[];
  readonly tables: readonly TableSource[];
  readonly headerIndex: HeaderIndex;
  readonly anchorOf: (element: XmlElement) => RawXmlAnchor;
}

/** 표지 제목 판정 기준: 문서 도입부 + 중앙정렬 또는 큰 글자(16pt≈1600 HWPUNIT). */
const COVER_SCAN_PARAGRAPHS = 5;
const COVER_CHAR_HEIGHT = 1600;

export function detectStaticRegions(input: DetectStaticRegionsInput): StaticRegion[] {
  const regions: StaticRegion[] = [];

  for (const [partPath, root] of [...input.sectionRoots].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (root.localName !== 'sec') continue;
    for (const element of walk(root)) {
      const parentLocal = element.parent?.localName ?? null;
      const kind = CONTROL_KIND[element.localName];
      if (kind && parentLocal === 'ctrl') {
        regions.push(
          region(
            kind,
            input.anchorOf(element),
            `control=${element.qName} part=${partPath} applyPageType=${element.attributes.applyPageType ?? '(none)'}`,
          ),
        );
      }
      if (element.localName === 'fieldBegin') {
        regions.push(
          region(
            'FIELD',
            input.anchorOf(element),
            `field type=${element.attributes.type ?? '(none)'} name=${element.attributes.name ?? '(none)'}`,
          ),
        );
      }
    }
  }

  // 결재란: 표 안에서 라벨 2개 이상이 나오면 결재 블록으로 본다.
  for (const source of input.tables) {
    const matched = new Set<string>();
    for (const cell of walk(source.element)) {
      if (cell.localName !== 'tc') continue;
      const text = cellText(cell);
      for (const label of APPROVAL_LABELS) {
        if (text.includes(label)) matched.add(label);
      }
    }
    if (matched.size >= 2) {
      regions.push(
        region(
          'APPROVAL_BLOCK',
          sourceAnchor(source.table, source.table.tableId),
          `approval labels matched=${[...matched].sort().join('/')} rows=${source.table.rows.length}`,
        ),
      );
    }
  }

  // 표지 제목: 문서 도입부의 중앙정렬 또는 큰 글자 문단.
  for (const source of input.paragraphs) {
    if (source.inControl) continue;
    if (source.documentOrder >= COVER_SCAN_PARAGRAPHS) continue;
    const text = paragraphText(source);
    if (text.trim().length === 0) continue;
    const paraPrId = source.paragraph.styleRef.paraPrId;
    const align =
      paraPrId === null ? null : (input.headerIndex.paraPr.get(paraPrId)?.align ?? null);
    const charHeight =
      source.firstCharPrId === null
        ? null
        : (input.headerIndex.charPr.get(source.firstCharPrId)?.height ?? null);
    if (align !== 'CENTER' && (charHeight ?? 0) < COVER_CHAR_HEIGHT) continue;
    regions.push(
      region(
        'COVER_TITLE',
        sourceAnchor(source.paragraph, source.paragraph.paragraphId),
        `documentOrder=${source.documentOrder} align=${align ?? '(none)'} charHeight=${charHeight ?? -1} textLength=${text.length}`,
      ),
    );
  }

  for (const source of input.paragraphs) {
    const text = paragraphText(source);
    if (text.trim().length === 0) continue;
    const matched = FIXED_PHRASE_PATTERNS.findIndex((pattern) => pattern.test(text));
    if (matched >= 0) {
      regions.push(
        region(
          'FIXED_PHRASE',
          sourceAnchor(source.paragraph, source.paragraph.paragraphId),
          `fixedPhrasePattern=#${matched} textLength=${text.length}`,
        ),
      );
    }
  }

  return regions.sort((a, b) => a.kind.localeCompare(b.kind) || a.locator.localeCompare(b.locator));
}

function cellText(cell: XmlElement): string {
  let out = '';
  for (const subList of childrenNamed(cell, 'subList')) {
    for (const element of walk(subList)) {
      if (element.localName !== 't') continue;
      for (const child of element.children) {
        if (!isElement(child)) out += child.value;
      }
    }
  }
  return out;
}
