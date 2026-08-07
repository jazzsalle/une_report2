import type {
  BlockIR,
  DocumentIR,
  HwpxFinding,
  ObjectClassification,
  ParagraphIR,
  RawXmlAnchor,
  RunIR,
  StyleRef,
  TableCellIR,
  TableIR,
  TableRowIR,
  UnknownPart,
} from '@une/domain';
import {
  CLASSIFICATION_TRANSPARENT_ELEMENTS,
  capsVerdictOf,
  matchElementRule,
  REJECT_RULES,
} from '../compat/object-rules';
import { finding } from '../package/errors';
import { isModeledPart } from '../package/opc-package';
import type { PackageAnalysisResult } from '../package/package-analysis';
import {
  KNOWN_NAMESPACE_URIS,
  childrenNamed,
  elementsOf,
  firstChild,
  isElement,
  type XmlElement,
} from '../package/xml';
import { anchorOf, partAnchor } from './anchors';
import { buildHeaderIndex, type HeaderIndex } from './header-index';
import { checkBulletReference, findDanglingBinaryReferences } from './reference-check';
import { stableId, stableIdForAnchor } from './stable-id';

/**
 * Document IR 생성 (설계 07 §1.3, ADR-29 D4).
 *
 * ## 블록 순서 규칙
 *
 * HWPX에서 표·그림은 `hp:p > hp:run > hp:tbl|hp:pic`처럼 **문단 안에** 있다.
 * IR의 `BlockIR`은 평면 시퀀스이므로 다음 규칙으로 옮긴다:
 *
 *   문단마다 (1) PARAGRAPH 블록을 먼저 내고, (2) 그 문단에 들어 있던
 *   블록 규모 객체(표/그림/컨트롤)를 **문서 순서 그대로** 뒤에 잇는다.
 *
 * 이렇게 하면 문단 순서(I6)가 보존되고 어떤 객체도 사라지지 않는다.
 * 인라인 규모(fieldBegin/fwSpace/tab/lineBreak)는 블록으로 올리지 않고
 * `RunIR.controls` 앵커로 남긴다 — 블록으로 올리면 문장 중간이 끊긴다.
 */

/** hp:ctrl의 자식과 이 목록은 블록 규모 객체로 승격한다. */
const BLOCK_LEVEL_OBJECTS: ReadonlySet<string> = new Set([
  'pic',
  'equation',
  'ole',
  'chart',
  'chartSpace',
  'video',
  'container',
  'line',
  'rect',
  'ellipse',
  'arc',
  'polygon',
  'curve',
  'connectLine',
  'textart',
  'compose',
  'dutmal',
  'formCtrl',
]);

/**
 * 문서 판정 상한을 유발하지 않는 컨트롤인가(= 사용자에게 제한을 표시하지
 * 않는 대상인가).
 *
 * 판별 기준을 등급(NATIVE_EDIT)에서 **상한 축**(`capsVerdict === false`)으로
 * 옮겼다(리뷰 M-3). 레이아웃 속성은 IR이 파싱하지 않으므로 등급은
 * PRESERVE_ONLY가 맞지만, PRESERVED 블록으로 블록 흐름에 자리를 잡으면
 * CC-150 편집기가 "보존 객체" 표시를 내게 된다 — §8.4가 "정상"으로 규정한
 * 대상에 제한 아이콘을 붙이는 일이다. 그 의도(자리를 차지하지 않게 한다)는
 * 그대로 두고, 판별만 사실에 맞는 축으로 바꾼다.
 */
function isNonCappingLayoutControl(element: XmlElement): boolean {
  const rule = matchElementRule(
    element.localName,
    element.parent ? element.parent.localName : null,
    element.namespaceUri,
    KNOWN_NAMESPACE_URIS,
  );
  return rule !== null && !capsVerdictOf(rule);
}

/**
 * §1.6-3 공백 구성요소의 문자 정규화 (리뷰 M-4).
 *
 * `RunIR.text`가 `hp:t`의 문자 데이터만 담으면 고정폭 빈칸·비분리 공백·탭이
 * 텍스트에서 사라진다. 그런데 §1.6-4 계층 추론은 `leadingWhitespace.length`를
 * **정렬 키**로 쓰고, §1.6-3 표는 "space/tab/비분리 공백의 실제 문자열"을
 * 요구한다. 실 코퍼스에도 `hp:fwSpace` 4건, `hp:tab` 5건이 hp:t 안에 있으므로
 * 이미 활성 경로다 — 정규화하지 않으면 그 문단들의 층이 한 칸씩 잘못 잡힌다.
 *
 * 매핑 근거:
 *   - `fwSpace`(고정폭 빈칸): 자간이 늘어나지 않는 빈칸. 폭은 보통 빈칸과
 *     같으므로 U+0020. U+2007 같은 특수 공백을 쓰면 §1.6-2 접두사 정규식의
 *     공백류에 걸리지 않아 계층 신호가 오히려 사라진다.
 *   - `nbSpace`(묶음 빈칸): 줄바꿈 금지 공백 = U+00A0.
 *   - `tab`: U+0009.
 *   - `lineBreak`/`hypen`은 **넣지 않는다.** 공백이 아니라 줄 나눔·하이픈
 *     제어이고, 문자로 끼워 넣으면 문단 텍스트 길이·접두사 판정이 원문과
 *     달라진다. 앵커로만 남긴다.
 *
 * 원문 보존(I5)은 바이트가, 역참조(I2)는 앵커가 그대로 책임진다 — 이 정규화는
 * **읽기용 텍스트 스트림**에만 영향을 준다.
 */
/** 공개 export다(CC-150 ADR-30 D5): 이 표가 곧 **offset 공간의 정의**이며,
 * 도메인의 `OFFSET_CONTRIBUTING_ELEMENTS`와 어긋나면 클라이언트와 서버의
 * 문자 위치가 조용히 달라진다. 두 표의 동치는 계약 테스트가 고정한다. */
export const WHITESPACE_CHARACTERS: Readonly<Record<string, string>> = Object.freeze({
  fwSpace: '\u0020',
  nbSpace: '\u00A0',
  tab: '\u0009',
});

export interface ParagraphSource {
  readonly paragraph: ParagraphIR;
  readonly element: XmlElement;
  readonly sectionIndex: number;
  /** 문서 전체에서의 문단 서수(0-base). 위치 근거·반복 전이 계산에 쓴다. */
  readonly documentOrder: number;
  /** 표 셀 안이면 표 앵커, 아니면 null (§1.7 tableContext). */
  readonly tableContext: RawXmlAnchor | null;
  /** 머리말·꼬리말·각주 등 컨트롤 하위 문단이면 true. */
  readonly inControl: boolean;
  /** 첫 hp:run의 charPrIDRef. Style Signature 입력. */
  readonly firstCharPrId: number | null;
}

export interface TableSource {
  readonly table: TableIR;
  readonly element: XmlElement;
  readonly sectionIndex: number;
}

export interface BuildIrOptions {
  readonly documentId?: string;
  readonly revision?: string | null;
}

export interface DocumentIrBuildResult {
  readonly ir: DocumentIR;
  readonly headerIndex: HeaderIndex;
  readonly paragraphs: readonly ParagraphSource[];
  readonly tables: readonly TableSource[];
  readonly findings: readonly HwpxFinding[];
}

function toIdRef(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * hp:t의 텍스트. 문자 데이터에 더해 공백 구성요소(`WHITESPACE_CHARACTERS`)를
 * **문서 순서 그대로** 문자로 정규화해 끼운다. 그 외 자식 요소는 텍스트에
 * 나타나지 않고 controls 앵커로만 남는다.
 */
function characterData(element: XmlElement): string {
  let out = '';
  for (const child of element.children) {
    if (!isElement(child)) {
      out += child.value;
      continue;
    }
    out += WHITESPACE_CHARACTERS[child.localName] ?? '';
  }
  return out;
}

class IrBuilder {
  private readonly findings: HwpxFinding[] = [];
  private readonly paragraphs: ParagraphSource[] = [];
  private readonly tables: TableSource[] = [];
  private documentOrder = 0;

  constructor(private readonly headerIndex: HeaderIndex) {}

  result(): {
    findings: HwpxFinding[];
    paragraphs: ParagraphSource[];
    tables: TableSource[];
  } {
    return { findings: this.findings, paragraphs: this.paragraphs, tables: this.tables };
  }

  buildBlocks(
    container: XmlElement,
    context: { sectionIndex: number; tableContext: RawXmlAnchor | null; inControl: boolean },
  ): BlockIR[] {
    const blocks: BlockIR[] = [];
    for (const child of childrenNamed(container, 'p')) {
      const { paragraph, embedded } = this.buildParagraph(child, context);
      blocks.push({ kind: 'PARAGRAPH', ...paragraph });
      for (const object of embedded) {
        if (object.localName === 'tbl') {
          blocks.push({ kind: 'TABLE', ...this.buildTable(object, context) });
        } else {
          blocks.push(this.buildPreserved(object, context));
        }
      }
    }
    return blocks;
  }

  private buildParagraph(
    element: XmlElement,
    context: { sectionIndex: number; tableContext: RawXmlAnchor | null; inControl: boolean },
  ): { paragraph: ParagraphIR; embedded: XmlElement[] } {
    const anchor = anchorOf(element);
    const paraPrId = toIdRef(element.attributes.paraPrIDRef);
    const styleId = toIdRef(element.attributes.styleIDRef);
    const runElements = childrenNamed(element, 'run');
    const embedded: XmlElement[] = [];
    const runs: RunIR[] = [];

    for (const runElement of runElements) {
      const charPrId = toIdRef(runElement.attributes.charPrIDRef);
      const controls: RawXmlAnchor[] = [];
      let text = '';
      for (const node of runElement.children) {
        if (!isElement(node)) continue;
        if (node.localName === 't') {
          text += characterData(node);
          for (const inline of elementsOf(node)) controls.push(anchorOf(inline));
          continue;
        }
        if (node.localName === 'tbl' || BLOCK_LEVEL_OBJECTS.has(node.localName)) {
          embedded.push(node);
          continue;
        }
        if (node.localName === 'ctrl') {
          for (const ctrlChild of elementsOf(node)) {
            // 배치는 **상한 축을 따른다**. PRESERVED 블록은 블록 순서에서 한
            // 자리를 차지하고, CC-150 편집기가 그 자리에 "보존 객체" 표시를
            // 낸다. 단(column) 속성 같은 레이아웃 컨트롤에 그 표시를 내는 것은
            // §8.4가 "정상"으로 규정한 대상에 제한 아이콘을 붙이는 일이다.
            // 상한을 유발하지 않는 컨트롤은 블록 흐름을 차지하지 않고 앵커로만
            // 남긴다(원문 바이트 보존은 I5, 역참조는 I2가 그대로 덮는다).
            if (isNonCappingLayoutControl(ctrlChild)) controls.push(anchorOf(ctrlChild));
            else embedded.push(ctrlChild);
          }
          continue;
        }
        if (node.localName === 'secPr' || node.localName === 'linesegarray') continue;
        // hp:run 직계의 공백 구성요소(hp:tab/hp:fwSpace/hp:nbSpace)도 텍스트
        // 스트림에 반영한다. 원문은 controls 앵커로 그대로 남는다.
        text += WHITESPACE_CHARACTERS[node.localName] ?? '';
        controls.push(anchorOf(node));
      }
      runs.push({
        runId: stableIdForAnchor('R', anchorOf(runElement)),
        text,
        charPrId,
        controls,
      });
      this.checkCharPr(charPrId, anchorOf(runElement));
    }

    const styleRef = this.buildStyleRef(paraPrId, runs[0]?.charPrId ?? null, styleId, anchor);
    const paragraph: ParagraphIR = {
      paragraphId: stableIdForAnchor('P', anchor),
      runs,
      styleRef,
      editState: { editedByUser: false, locked: false },
      // 읽기 경로가 만드는 노드는 전부 원본 XML에서 왔다(ADR-30 D3). 편집이
      // 만든 노드만 AUTHORED이며, 그것은 CC-150 편집층에서만 생긴다.
      origin: 'SOURCE',
      rawXmlAnchor: anchor,
    };
    this.paragraphs.push({
      paragraph,
      element,
      sectionIndex: context.sectionIndex,
      documentOrder: this.documentOrder,
      tableContext: context.tableContext,
      inControl: context.inControl,
      firstCharPrId: runs[0]?.charPrId ?? null,
    });
    this.documentOrder += 1;
    return { paragraph, embedded };
  }

  private buildStyleRef(
    paraPrId: number | null,
    charPrId: number | null,
    styleId: number | null,
    locator: string,
  ): StyleRef {
    let numberingId: number | null = null;
    if (paraPrId !== null) {
      const detail = this.headerIndex.paraPr.get(paraPrId);
      if (!detail) {
        // FATAL: 문단 모양 자체가 없다. §1.5 Style Signature와 §1.6 계층 추론이
        // 전부 paraPr에서 나오므로 복구할 기준값이 문서 안에 존재하지 않는다.
        this.findings.push(
          finding(
            'HWPX-1005',
            'FATAL',
            locator,
            `paraPrIDRef=${paraPrId}가 header.xml paraProperties에 없습니다`,
          ),
        );
      } else if (
        detail.headingIdRef !== null &&
        (detail.headingType === 'NUMBER' || detail.headingType === 'OUTLINE')
      ) {
        numberingId = detail.headingIdRef;
        if (!this.headerIndex.numberingIds.has(numberingId)) {
          // DEGRADING: 자동번호 정의는 잃었지만 §1.7 prefixPolicy에
          // KEEP_SOURCE_PREFIX 폴백이 정의돼 있어 원문 접두사로 계속 간다.
          this.findings.push(
            finding(
              'HWPX-1005',
              'DEGRADING',
              locator,
              `numbering idRef=${numberingId}가 header.xml numberings에 없습니다 ` +
                '(§1.7 prefixPolicy KEEP_SOURCE_PREFIX로 강등)',
            ),
          );
        }
      }
      const bulletDetail = checkBulletReference(this.headerIndex, paraPrId);
      if (bulletDetail !== null) {
        // DEGRADING: numbering과 같은 층. 글머리표 모양만 잃는다.
        this.findings.push(finding('HWPX-1005', 'DEGRADING', locator, bulletDetail));
      }
    }
    if (styleId !== null && !this.headerIndex.styleIds.has(styleId)) {
      // DEGRADING: hh:style은 paraPr/charPr **기본값**을 묶어 이름 붙인 것이고,
      // hp:p는 이미 자기 paraPrIDRef/charPrIDRef를 명시한다. 없어도 렌더·편집이
      // 성립하므로 §1.4가 허용한 두 결말(CONFIRM/REJECT) 중 CONFIRM 쪽이다.
      this.findings.push(
        finding(
          'HWPX-1005',
          'DEGRADING',
          locator,
          `styleIDRef=${styleId}가 header.xml styles에 없습니다 (문단 자체 paraPr/charPr로 대체)`,
        ),
      );
    }
    return { paraPrId, charPrId, numberingId, styleId };
  }

  private checkCharPr(charPrId: number | null, locator: string): void {
    if (charPrId === null) return;
    if (!this.headerIndex.charPr.has(charPrId)) {
      // FATAL: 글자 모양이 없으면 Style Signature의 charHeight/bold/색이 통째로
      // 비고, §1.5 군집화가 근거 없는 값으로 판정을 내게 된다. paraPr와 같은
      // 이유로 복구 불가로 본다.
      this.findings.push(
        finding(
          'HWPX-1005',
          'FATAL',
          locator,
          `charPrIDRef=${charPrId}가 header.xml charProperties에 없습니다`,
        ),
      );
    }
  }

  private buildTable(
    element: XmlElement,
    context: { sectionIndex: number; tableContext: RawXmlAnchor | null; inControl: boolean },
  ): TableIR {
    const anchor = anchorOf(element);
    const rows: TableRowIR[] = [];
    for (const rowElement of childrenNamed(element, 'tr')) {
      const cells: TableCellIR[] = [];
      for (const cellElement of childrenNamed(rowElement, 'tc')) {
        const span = firstChild(cellElement, 'cellSpan');
        const subList = firstChild(cellElement, 'subList');
        const cellAnchor = anchorOf(cellElement);
        const blocks = subList
          ? this.buildBlocks(subList, {
              sectionIndex: context.sectionIndex,
              tableContext: anchor,
              inControl: context.inControl,
            })
          : [];
        if (blocks.length === 0) {
          // I6: 셀당 최소 1문단. 원본에 없으면 정합성 문제이므로 신고한다
          // (빈 문단을 몰래 만들어 넣으면 무손실이 깨진다).
          this.findings.push(
            finding('HWPX-1005', 'DEGRADING', cellAnchor, '표 셀에 문단이 하나도 없습니다'),
          );
        }
        cells.push({
          cellId: stableIdForAnchor('TC', cellAnchor),
          rowSpan: Number(span?.attributes.rowSpan ?? '1') || 1,
          colSpan: Number(span?.attributes.colSpan ?? '1') || 1,
          blocks,
        });
      }
      rows.push({ rowId: stableIdForAnchor('TR', anchorOf(rowElement)), cells });
    }
    const table: TableIR = {
      tableId: stableIdForAnchor('TBL', anchor),
      rows,
      origin: 'SOURCE',
      rawXmlAnchor: anchor,
    };
    this.tables.push({ table, element, sectionIndex: context.sectionIndex });
    return table;
  }

  private buildPreserved(
    element: XmlElement,
    context: { sectionIndex: number; tableContext: RawXmlAnchor | null; inControl: boolean },
  ): BlockIR {
    const anchor = anchorOf(element);
    const parentLocal = element.parent ? element.parent.localName : null;
    const rule =
      matchElementRule(
        element.localName,
        parentLocal,
        element.namespaceUri,
        KNOWN_NAMESPACE_URIS,
      ) ?? REJECT_RULES.danglingReference;
    const classification: ObjectClassification = {
      objectClass: rule.objectClass,
      scope: rule.scope,
      reasonCode: rule.reasonCode,
      locator: anchor,
      evidence: `element=${element.qName} parent=${parentLocal ?? '(root)'} :: ${rule.rationale}`,
      capsVerdict: capsVerdictOf(rule),
    };
    // 머리말/꼬리말/각주 내부 문단은 PRESERVED 블록의 원문에 이미 들어 있으므로
    // IR 트리에 **중복해서 싣지 않는다**. 다만 정적영역·스타일 분석이 이들을
    // 봐야 하므로 ParagraphSource로는 추적한다(분석 입력 ≠ 편집 대상).
    for (const subList of childrenNamed(element, 'subList')) {
      this.buildBlocks(subList, {
        sectionIndex: context.sectionIndex,
        tableContext: context.tableContext,
        inControl: true,
      });
    }
    return {
      kind: 'PRESERVED',
      // 보존 객체는 AUTHORED가 될 수 없다 — 원본 바이트의 자리표다.
      origin: 'SOURCE',
      preservedId: stableIdForAnchor('PRE', anchor),
      rawXmlAnchor: anchor,
      classification,
    };
  }
}

export function buildDocumentIr(
  analysis: PackageAnalysisResult,
  options: BuildIrOptions = {},
): DocumentIrBuildResult {
  const headerRoot = analysis.parsedParts.get('Contents/header.xml');
  const manifestBinDataIds = analysis.hpfManifest
    .filter((item) => item.href.startsWith('BinData/'))
    .map((item) => item.id);
  const headerIndex = headerRoot
    ? buildHeaderIndex(headerRoot, manifestBinDataIds)
    : buildHeaderIndex(emptyHeaderRoot(), manifestBinDataIds);

  const builder = new IrBuilder(headerIndex);
  const sections = analysis.sectionParts.map((partPath, sectionIndex) => {
    const root = analysis.parsedParts.get(partPath);
    if (!root) {
      return {
        sectionId: stableId('SEC', partPath),
        partPath,
        blocks: [] as BlockIR[],
        pageSettings: { rawXmlAnchor: partAnchor(partPath) },
      };
    }
    const secPr = findSectionProperties(root);
    return {
      sectionId: stableId('SEC', partPath),
      partPath,
      blocks: builder.buildBlocks(root, { sectionIndex, tableContext: null, inControl: false }),
      pageSettings: { rawXmlAnchor: secPr ? anchorOf(secPr) : partAnchor(partPath) },
    };
  });

  const built = builder.result();

  // §1.4-4 binData 참조 무결성 (리뷰 m-5). 문단 스타일 참조와 달리 이 참조는
  // `hp:pic` 아래 `hc:img@binaryItemIDRef`처럼 보존 객체 **내부**에 있어
  // buildStyleRef 경로에 걸리지 않는다. 섹션 트리를 한 번 더 훑는다.
  //
  // 심각도는 DEGRADING이다. 참조가 깨진 그림도 원문 바이트로 그대로 보존되므로
  // (I5) 우리가 새로 잃는 것은 없고, 재저장해도 원본과 같은 상태가 나온다.
  // 사용자에게 "이 그림은 원본에서 이미 깨져 있다"를 알리는 것이 목적이다.
  for (const partPath of analysis.sectionParts) {
    const root = analysis.parsedParts.get(partPath);
    if (!root) continue;
    for (const dangling of findDanglingBinaryReferences(root, headerIndex)) {
      built.findings.push(
        finding('HWPX-1005', 'DEGRADING', dangling.locator, `${dangling.detail} (원문 보존)`),
      );
    }
  }

  const mediaTypeByHref = new Map(
    analysis.hpfManifest.map((item) => [item.href, item.mediaType] as const),
  );
  const unknownParts: UnknownPart[] = analysis.entries
    .filter((entry) => !isModeledPart(entry.partPath))
    .map((entry) => ({
      partPath: entry.partPath,
      contentType: mediaTypeByHref.get(entry.partPath) ?? null,
      hash: entry.sha256,
    }))
    .sort((a, b) => a.partPath.localeCompare(b.partPath));

  const ir: DocumentIR = {
    // v2를 **직접** 산출한다. 표현이 두 벌이면 모든 소비자가 "언제 lift해야
    // 하는지"를 알아야 하고, CC-160/CC-170이 그 부담을 그대로 물려받는다.
    // 영속 데이터가 0건인 지금이 무비용 전환 시점이다(ADR-30).
    irVersion: '2',
    documentId: options.documentId ?? stableId('DOC', analysis.archiveSha256),
    revision: options.revision ?? null,
    sourceHash: analysis.archiveSha256,
    sections,
    styleIndex: headerIndex.styleIndex,
    unknownParts,
    findings: [...analysis.findings, ...built.findings],
  };

  return {
    ir,
    headerIndex,
    paragraphs: built.paragraphs,
    tables: built.tables,
    findings: built.findings,
  };
}

function findSectionProperties(root: XmlElement): XmlElement | null {
  for (const paragraph of childrenNamed(root, 'p')) {
    for (const run of childrenNamed(paragraph, 'run')) {
      const secPr = firstChild(run, 'secPr');
      if (secPr) return secPr;
    }
  }
  return null;
}

/** header.xml이 없는 패키지(HWPX-1003)에서도 IR 골격은 만들어 finding을 보여준다. */
function emptyHeaderRoot(): XmlElement {
  return {
    qName: 'hh:head',
    prefix: 'hh',
    localName: 'head',
    namespaceUri: null,
    attributes: {},
    children: [],
    ordinal: 1,
    parent: null,
    partPath: 'Contents/header.xml',
    // 원문이 없는 합성 노드다. 빈 구간(0,0)으로 두어 되쓰기 대상이 될 수 없게
    // 한다 — 이 자리를 splice하면 존재하지 않는 Part를 고치는 셈이 된다.
    sourceStart: 0,
    sourceEnd: 0,
    innerStart: 0,
    innerEnd: 0,
  };
}

/** 진단용: 분류 투명 요소인지. ir-builder와 classifier가 같은 표를 본다. */
export function isTransparentElement(localName: string): boolean {
  return CLASSIFICATION_TRANSPARENT_ELEMENTS.has(localName);
}
