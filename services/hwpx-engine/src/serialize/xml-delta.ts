import type { BlockAnchor, BlockIR, DocumentIR, ParagraphIR, RunIR } from '@une/domain';
import { parseAnchor, resolveAnchor } from '../ir/anchors';
import {
  elementsOf,
  isElement,
  parseXmlDocument,
  type XmlElement,
  type XmlNode,
} from '../package/xml';
import { HwpxExportError } from './errors';

/**
 * XML Delta Writer (설계 07 §1.10-1/-3).
 *
 * **되쓰기는 바이트 구간 교체로만 한다.** 트리를 다시 직렬화하지 않는다 —
 * 재직렬화는 주석·처리명령·속성 순서·공백·엔터티 표기를 전부 우리 파서의
 * 취향으로 바꾸고, 그 순간 "알 수 없는 요소는 원문 그대로"(§1.10-3)가
 * 거짓이 된다. 대신 파서가 남긴 `sourceStart/innerStart/...` 구간만 갈아끼우고
 * 나머지 문자는 손대지 않는다.
 *
 * **모르면 거부한다.** 되쓸 자리를 유일하게 지목할 수 없는 구조(공백 요소나
 * 인라인 컨트롤이 섞인 run 등)는 추측해서 쓰지 않고 HWPX-1103으로 실패한다.
 * 잘못 쓴 HWPX는 조용히 열리기 때문에, 여기서 틀리면 사용자는 한참 뒤에
 * 손상된 문서로 알게 된다.
 */

export interface Splice {
  /** 교체 시작(포함) — 디코딩된 Part 문자열 인덱스. */
  readonly start: number;
  /** 교체 끝(제외). */
  readonly end: number;
  readonly replacement: string;
  /** 진단용 — 어떤 편집이 이 구간을 만들었는지. */
  readonly reason: string;
}

export interface PartDelta {
  readonly partPath: string;
  readonly splices: readonly Splice[];
  readonly bytes: Uint8Array;
}

export interface XmlDeltaResult {
  /** partPath → 새 바이트. 변경이 없는 Part는 들어 있지 않다. */
  readonly replacements: ReadonlyMap<string, Uint8Array>;
  readonly parts: readonly PartDelta[];
  readonly spliceCount: number;
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

export function escapeXmlText(value: string): string {
  return value.replace(/[&<>]/g, (character) => XML_ESCAPES[character]);
}

/**
 * 구간 교체 적용. 겹치는 구간은 거부한다 — 겹치면 적용 순서가 결과를 바꾸고,
 * 그 순간 같은 편집이 실행마다 다른 문서를 낸다.
 */
export function applySplices(text: string, splices: readonly Splice[]): string {
  const ordered = [...splices].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].start < ordered[i - 1].end) {
      throw new HwpxExportError(
        'HWPX-1103',
        `${ordered[i - 1].reason} / ${ordered[i].reason}`,
        `되쓰기 구간이 겹칩니다 (${ordered[i - 1].start}..${ordered[i - 1].end} vs ${ordered[i].start}..${ordered[i].end})`,
      );
    }
  }
  let out = '';
  let cursor = 0;
  for (const splice of ordered) {
    out += text.slice(cursor, splice.start) + splice.replacement;
    cursor = splice.end;
  }
  return out + text.slice(cursor);
}

/**
 * 텍스트 스트림에 기여하지 않아 되쓰기를 방해하지 않는 run 자식.
 *
 * `hp:linesegarray`는 줄 배치 캐시이고 `hp:secPr`는 구역 속성이다. 둘 다
 * ir-builder가 텍스트로 세지 않고(§ir-builder 257행) 우리가 해석하지도
 * 않으므로, `hp:t` 안쪽만 갈아끼우는 되쓰기와 자리가 겹치지 않는다.
 * 실 코퍼스의 거의 모든 run이 `linesegarray`를 갖고 있어, 이것을 거부하면
 * 되쓰기 가능한 문단이 사실상 사라진다.
 *
 * **수용 한계**: 텍스트가 바뀌면 `linesegarray`의 줄 좌표는 낡은 값이 된다.
 * 우리는 배치를 계산하지 않는다(§1.1 비범위 — 렌더는 rhwp 몫). 편집기·한/글이
 * 여는 시점에 다시 계산하는 값이므로 그대로 둔다. 지우는 선택지는 더 나쁘다:
 * 지우면 원문에 있던 구조를 우리가 없앤 것이 되어 §1.10-3을 어긴다.
 */
const NON_TEXT_RUN_CHILDREN: ReadonlySet<string> = new Set(['linesegarray', 'secPr']);

/**
 * 되쓸 수 있는 run인가.
 *
 * 조건: 텍스트에 기여하는 요소가 정확히 하나의 `hp:t`뿐이고, 그 `hp:t` 안에
 * 요소가 없다. 그래야 `RunIR.text`가 그 `hp:t`의 문자 데이터와 **정확히 같고**,
 * 새 텍스트를 넣을 자리가 유일하게 결정된다. 탭·고정폭 빈칸·인라인 컨트롤이
 * 섞이면 IR의 text 스트림이 여러 요소에서 합성된 값이라(ir-builder의
 * `WHITESPACE_CHARACTERS`) 역매핑이 성립하지 않는다 — 그런 run은 거부한다.
 */
/**
 * run의 되쓰기 적합성 (CC-170).
 *
 * `simpleTextElement`는 "단순 텍스트"와 "hp:t가 아예 없음"을 똑같이 null로
 * 답한다. 복제에서는 둘을 구분해야 한다 — 실문서의 프로토타입 문단은 마지막에
 * **빈 run**(글자속성만 있고 hp:t가 없는 run)을 달고 있는 경우가 흔하고,
 * 그것을 "복제 불가"로 읽으면 개요 프로토타입 전체가 거부된다.
 * 빈 run은 텍스트에 기여하지 않으므로 **손대지 않고 그대로 복제**하면 된다.
 */
type RunShape =
  { kind: 'SIMPLE'; textElement: XmlElement } | { kind: 'EMPTY' } | { kind: 'COMPLEX' };

function classifyRun(runElement: XmlElement): RunShape {
  let textElement: XmlElement | null = null;
  for (const child of elementsOf(runElement)) {
    if (NON_TEXT_RUN_CHILDREN.has(child.localName)) continue;
    if (child.localName !== 't') return { kind: 'COMPLEX' };
    if (textElement) return { kind: 'COMPLEX' };
    if (elementsOf(child).length > 0) return { kind: 'COMPLEX' };
    textElement = child;
  }
  return textElement ? { kind: 'SIMPLE', textElement } : { kind: 'EMPTY' };
}

function simpleTextElement(runElement: XmlElement): XmlElement | null {
  let textElement: XmlElement | null = null;
  for (const child of elementsOf(runElement)) {
    if (NON_TEXT_RUN_CHILDREN.has(child.localName)) continue;
    if (child.localName !== 't') return null;
    if (textElement) return null; // hp:t가 둘 이상이면 어느 쪽에 쓸지 모른다
    if (elementsOf(child).length > 0) return null; // 인라인 컨트롤 포함
    textElement = child;
  }
  return textElement;
}

function paragraphsOf(blocks: readonly BlockIR[]): ParagraphIR[] {
  const out: ParagraphIR[] = [];
  const visit = (list: readonly BlockIR[]): void => {
    for (const block of list) {
      if (block.kind === 'PARAGRAPH') {
        out.push(block);
        continue;
      }
      if (block.kind === 'TABLE') {
        for (const row of block.rows) for (const cell of row.cells) visit(cell.blocks);
      }
    }
  };
  visit(blocks);
  return out;
}

function textOfRuns(runs: readonly RunIR[]): string {
  return runs.map((run) => run.text).join('');
}

interface PartContext {
  readonly partPath: string;
  readonly text: string;
  readonly root: XmlElement;
  readonly parts: ReadonlyMap<string, XmlElement>;
}

function locate(context: PartContext, anchor: string, reason: string): XmlElement {
  const element = resolveAnchor(anchor, context.parts);
  if (!element) {
    throw new HwpxExportError(
      'HWPX-1103',
      anchor,
      `${reason}: 앵커가 원본 XML을 가리키지 않습니다`,
    );
  }
  return element;
}

/** 문단의 텍스트 변경을 run 단위 splice로 바꾼다. */
function textSplices(context: PartContext, before: ParagraphIR, after: ParagraphIR): Splice[] {
  const anchor = before.rawXmlAnchor;
  if (anchor === undefined) return [];
  const element = locate(context, anchor, '문단 텍스트 되쓰기');
  const runElements = elementsOf(element).filter((child) => child.localName === 'run');

  if (before.runs.length !== after.runs.length) {
    throw new HwpxExportError(
      'HWPX-1103',
      anchor,
      `run 개수가 달라진 문단은 되쓸 수 없습니다 (${before.runs.length} -> ${after.runs.length})`,
    );
  }
  if (runElements.length !== before.runs.length) {
    throw new HwpxExportError(
      'HWPX-1103',
      anchor,
      `IR run 수와 원본 hp:run 수가 다릅니다 (${before.runs.length} != ${runElements.length})`,
    );
  }

  const splices: Splice[] = [];
  for (let index = 0; index < before.runs.length; index += 1) {
    if (before.runs[index].text === after.runs[index].text) continue;
    const runElement = runElements[index];
    const textElement = simpleTextElement(runElement);
    if (!textElement) {
      throw new HwpxExportError(
        'HWPX-1103',
        `${anchor}/run[${index + 1}]`,
        '탭·고정폭 빈칸·인라인 컨트롤이 섞인 run은 텍스트를 되쓸 수 없습니다',
      );
    }
    splices.push({
      start: textElement.innerStart,
      end: textElement.innerEnd,
      replacement: escapeXmlText(after.runs[index].text),
      reason: `text ${before.paragraphId}`,
    });
  }
  return splices;
}

/**
 * 새 문단의 XML을 만든다 — **프로토타입 문단의 원문을 복제**하고 텍스트만
 * 바꾼다(§1.7 Prototype Clone, §1.14 "기호 앞 공백·들여쓰기·ParaShape·
 * 글자속성이 Prototype Clone으로 유지된다").
 *
 * 새로 조립하지 않는 이유는 명확하다. 문단 하나에는 paraPrIDRef·styleIDRef·
 * charPrIDRef·linesegarray 등 우리가 해석하지 않는 속성이 붙어 있고, 그것을
 * 우리가 만들어 내면 원본 서식과 다른 문단이 된다. 이미 문서 안에 있는
 * 이웃 문단을 복제하면 그 서식이 그대로 승계된다.
 *
 * **run이 여럿인 프로토타입**(CC-170): 실문서의 개요 프로토타입은 글자속성이
 * 갈려 run이 여러 개인 경우가 흔하다(코퍼스의 OUTLINE_1은 4개다). run 하나만
 * 받으면 그런 문서에서는 본문 실체화가 통째로 Export되지 못한다. 그래서 텍스트를
 * **첫 run에 모으고 나머지 run은 비운다**. 첫 run의 글자속성이 새 문단 전체에
 * 적용되는 것이 프로토타입 복제의 의도에 가장 가깝고, 빈 run은 원본 문서에도
 * 흔한 정상 구조다. 대신 조건을 좁힌다: **모든 run이 되쓰기 가능한 단순 텍스트**
 * 여야 한다. 탭·인라인 컨트롤이 섞인 run을 비우면 우리가 해석하지 않는 구조를
 * 없애는 것이 되어 §1.10-3을 어긴다.
 */
function clonedParagraphXml(
  context: PartContext,
  prototype: XmlElement,
  paragraph: ParagraphIR,
): string {
  const runElements = elementsOf(prototype).filter((child) => child.localName === 'run');
  if (runElements.length === 0) {
    throw new HwpxExportError(
      'HWPX-1103',
      paragraph.paragraphId,
      '프로토타입 문단에 run이 없어 복제할 수 없습니다',
    );
  }
  const shapes = runElements.map((run) => classifyRun(run));
  if (shapes.some((shape) => shape.kind === 'COMPLEX')) {
    throw new HwpxExportError(
      'HWPX-1103',
      paragraph.paragraphId,
      '프로토타입 run에 공백 요소·인라인 컨트롤이 있어 복제할 수 없습니다',
    );
  }
  const textElements = shapes
    .filter(
      (shape): shape is { kind: 'SIMPLE'; textElement: XmlElement } => shape.kind === 'SIMPLE',
    )
    .map((shape) => shape.textElement);
  if (textElements.length === 0) {
    throw new HwpxExportError(
      'HWPX-1103',
      paragraph.paragraphId,
      '프로토타입 문단에 텍스트를 넣을 run이 없어 복제할 수 없습니다',
    );
  }

  // 첫 텍스트 run에 전체 텍스트, 나머지 텍스트 run은 비운다. 빈 run은 손대지
  // 않는다. 구간 교체이므로 앞에서부터 자르고 이어 붙인다.
  const source = context.text.slice(prototype.sourceStart, prototype.sourceEnd);
  const replacements = textElements.map((element, index) => ({
    start: element.innerStart - prototype.sourceStart,
    end: element.innerEnd - prototype.sourceStart,
    text: index === 0 ? escapeXmlText(textOfRuns(paragraph.runs)) : '',
  }));
  replacements.sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  for (const replacement of replacements) {
    out += source.slice(cursor, replacement.start) + replacement.text;
    cursor = replacement.end;
  }
  return out + source.slice(cursor);
}

/**
 * 삽입 기준을 **원본 문단까지** 따라간다 (CC-170).
 *
 * 한 ChangeSet이 문단을 여럿 넣으면 두 번째부터의 `anchorHint`는 바로 앞에
 * 넣은 **AUTHORED 문단**을 가리킨다(실행기가 넣은 순서대로 이웃을 잡기
 * 때문이다). 그 문단은 원본에 없으므로 `rawXmlAnchor`도 없고, 그대로 두면
 * 되쓰기가 HWPX-1103으로 거절한다 — 즉 **본문 실체화(materialize)가 통째로
 * Export되지 못한다**. CC-160은 문단 하나를 넣는 경우만 시험했기 때문에
 * 드러나지 않았고, CC-170의 슬라이스 E2E가 처음 밟았다.
 *
 * 해법은 체인을 거슬러 올라가 원본 문단을 찾는 것이다. 그 지점은 모든 형제가
 * 공유하는 같은 삽입 위치이고, 형제들 사이의 순서는 **문서 순서**가 정한다:
 * `editedParagraphs`를 문서 순서로 돌며 splice를 쌓고, `applySplices`의 정렬이
 * 안정 정렬이므로 같은 위치의 삽입은 쌓은 순서를 유지한다.
 *
 * 순환은 방문 집합으로 막는다. IR이 순환 힌트를 담는 것은 결함이므로 조용히
 * 고치지 않고 거절한다.
 */
function resolveInsertionAnchor(
  paragraph: ParagraphIR & { origin: 'AUTHORED'; anchorHint: BlockAnchor },
  baseById: ReadonlyMap<string, ParagraphIR>,
  editedById: ReadonlyMap<string, ParagraphIR>,
): { anchor: string; relation: string } {
  const seen = new Set<string>([paragraph.paragraphId]);
  let hint: BlockAnchor = paragraph.anchorHint;
  for (;;) {
    const base = baseById.get(hint.ref);
    if (base?.rawXmlAnchor !== undefined) {
      // 원본 문단에 닿았다. 관계는 **체인 첫 힌트**의 것이 아니라 여기서
      // 원본을 만난 관계다 — 형제들은 모두 같은 자리에 놓이고 순서는 문서
      // 순서가 정한다.
      return { anchor: base.rawXmlAnchor, relation: hint.relation };
    }
    const authored = editedById.get(hint.ref);
    if (!authored || authored.origin !== 'AUTHORED') {
      throw new HwpxExportError(
        'HWPX-1103',
        paragraph.paragraphId,
        `anchorHint가 원본 문단을 지목하지 않습니다 (ref=${hint.ref})`,
      );
    }
    if (seen.has(authored.paragraphId)) {
      throw new HwpxExportError(
        'HWPX-1103',
        paragraph.paragraphId,
        `anchorHint가 순환합니다 (${[...seen].join(' -> ')} -> ${authored.paragraphId})`,
      );
    }
    seen.add(authored.paragraphId);
    hint = authored.anchorHint;
  }
}

function sameStyle(a: ParagraphIR['styleRef'], b: ParagraphIR['styleRef']): boolean {
  return a.paraPrId === b.paraPrId && a.styleId === b.styleId && a.charPrId === b.charPrId;
}

/**
 * 복제할 원본 문단을 고른다 — **IR이 지정한 서식과 같은 것으로** (CC-170).
 *
 * 자리는 `anchorHint`가 정하지만 서식은 IR이 정한다. 실행기는 Template
 * Profile의 프로토타입(§1.7 Prototype Clone)에서 새 문단의 `styleRef`를
 * 결정하는데, 되쓰기가 **앵커 이웃**을 복제하면 그 결정이 무시되고 이웃의
 * 서식이 들어간다. 그러면 산출물을 다시 읽었을 때 IR이 말한 서식과 달라
 * Track A의 RTA-STY-001이 FAIL한다 — 실제로 CC-170 슬라이스 E2E가 이 경로를
 * 처음 밟아 드러났다(본문 실체화가 여러 문단을 한 번에 넣는다).
 *
 * 순서: ① 앵커가 이미 같은 서식이면 그대로 쓴다(가장 가까운 이웃이 최선이다).
 * ② 아니면 원본에서 같은 서식의 복제 가능한 문단을 찾는다. ③ 없으면 거부한다 —
 * 서식을 지어내지 않는다.
 */
/**
 * 구역 속성을 품은 문단인가.
 *
 * `hp:secPr`는 텍스트에 기여하지 않아 run 분류에서 EMPTY로 통과하고, "빈 run은
 * 손대지 않는다"는 복제 정책 때문에 **원문 그대로 복제**된다. 그러면 한 섹션에
 * 구역 속성이 둘 생긴다 — 잘못 쓴 HWPX는 조용히 열리므로 사용자는 한참 뒤에
 * 안다(리뷰 M-7). 복제 원본에서 배제한다.
 */
function hasSectionProperties(element: XmlElement): boolean {
  for (const run of elementsOf(element)) {
    if (run.localName !== 'run') continue;
    for (const child of elementsOf(run)) {
      if (child.localName === 'secPr') return true;
    }
  }
  return false;
}

function pickCloneSource(
  context: PartContext,
  paragraph: ParagraphIR,
  anchorElement: XmlElement,
  baseParagraphs: readonly ParagraphIR[],
  topLevelParagraphIds: readonly string[],
): XmlElement {
  // 후보는 최상위 블록 문단으로 좁힌다(표 셀 안 문단 제외).
  const topLevelIds = new Set(topLevelParagraphIds);
  const anchorParagraph = baseParagraphs.find(
    (candidate) =>
      candidate.rawXmlAnchor !== undefined && isSameElement(context, candidate, anchorElement),
  );
  if (
    anchorParagraph &&
    sameStyle(anchorParagraph.styleRef, paragraph.styleRef) &&
    !hasSectionProperties(anchorElement)
  ) {
    return anchorElement;
  }
  for (const candidate of baseParagraphs) {
    if (candidate.rawXmlAnchor === undefined) continue;
    // 표 셀 안 문단은 복제 원본이 아니다 — 표 되쓰기는 열려 있지 않다(m-9).
    if (!topLevelIds.has(candidate.paragraphId)) continue;
    if (!sameStyle(candidate.styleRef, paragraph.styleRef)) continue;
    const element = resolveAnchor(candidate.rawXmlAnchor, context.parts);
    if (!element) continue;
    // 복제 가능한 모양인지 여기서 확인한다. 뒤에서 실패하면 "어느 문단을
    // 고르다 실패했는지"가 오류에 남지 않는다.
    const runElements = elementsOf(element).filter((child) => child.localName === 'run');
    const shapes = runElements.map((run) => classifyRun(run));
    if (shapes.some((shape) => shape.kind === 'COMPLEX')) continue;
    if (!shapes.some((shape) => shape.kind === 'SIMPLE')) continue;
    // 구역 속성을 복제하면 섹션에 secPr가 둘이 된다(M-7).
    if (hasSectionProperties(element)) continue;
    return element;
  }
  throw new HwpxExportError(
    'HWPX-1103',
    paragraph.paragraphId,
    `의도한 서식(paraPr=${paragraph.styleRef.paraPrId ?? '-'}, style=${
      paragraph.styleRef.styleId ?? '-'
    }, charPr=${paragraph.styleRef.charPrId ?? '-'})과 같은 복제 가능한 문단이 원본에 없습니다`,
  );
}

function isSameElement(context: PartContext, paragraph: ParagraphIR, element: XmlElement): boolean {
  if (paragraph.rawXmlAnchor === undefined) return false;
  const resolved = resolveAnchor(paragraph.rawXmlAnchor, context.parts);
  return resolved === element;
}

/** 삽입 지점: 기준 노드의 앞/뒤. FIRST_CHILD/LAST_CHILD는 표 셀 편집용이다. */
function insertionPoint(reference: XmlElement, relation: string, paragraphId: string): number {
  switch (relation) {
    case 'BEFORE':
      return reference.sourceStart;
    case 'AFTER':
      return reference.sourceEnd;
    case 'FIRST_CHILD':
      return reference.innerStart;
    case 'LAST_CHILD':
      return reference.innerEnd;
    default:
      throw new HwpxExportError(
        'HWPX-1103',
        paragraphId,
        `알 수 없는 anchorHint 관계입니다 (${relation})`,
      );
  }
}

/**
 * 원본 IR과 편집된 IR을 비교해 Part별 되쓰기 계획을 만든다.
 *
 * ChangeSet이 아니라 **두 IR의 차이**를 본다. 실행기가 낸 연산 목록을 다시
 * 해석하면 실행기와 되쓰기가 서로 다른 이해를 가질 수 있고, 그 어긋남은
 * 산출물에서만 드러난다. IR은 실행기의 결과 그 자체다.
 */
export function buildXmlDelta(input: {
  readonly baseIr: DocumentIR;
  readonly editedIr: DocumentIR;
  readonly partBytes: ReadonlyMap<string, Uint8Array>;
}): XmlDeltaResult {
  const { baseIr, editedIr, partBytes } = input;
  const parts: PartDelta[] = [];
  const replacements = new Map<string, Uint8Array>();
  let spliceCount = 0;

  for (const baseSection of baseIr.sections) {
    const editedSection = editedIr.sections.find(
      (section) => section.sectionId === baseSection.sectionId,
    );
    if (!editedSection) {
      throw new HwpxExportError(
        'HWPX-1102',
        baseSection.partPath,
        '섹션 삭제는 보존 저장 경로가 지원하지 않습니다',
      );
    }

    const bytes = partBytes.get(baseSection.partPath);
    if (!bytes) {
      throw new HwpxExportError(
        'HWPX-1102',
        baseSection.partPath,
        '원본 패키지에 섹션 Part가 없습니다',
      );
    }

    const { root, text } = parseXmlDocument(baseSection.partPath, bytes);
    const context: PartContext = {
      partPath: baseSection.partPath,
      text,
      root,
      parts: new Map([[baseSection.partPath, root]]),
    };

    const baseParagraphs = paragraphsOf(baseSection.blocks);
    const topLevelParagraphIds: string[] = [];
    for (const block of baseSection.blocks) {
      if (block.kind === 'PARAGRAPH') topLevelParagraphIds.push(block.paragraphId);
    }
    const editedParagraphs = paragraphsOf(editedSection.blocks);
    const baseById = new Map(baseParagraphs.map((p) => [p.paragraphId, p]));
    const editedById = new Map(editedParagraphs.map((p) => [p.paragraphId, p]));

    const splices: Splice[] = [];

    // 1) 텍스트 변경
    for (const before of baseParagraphs) {
      const after = editedById.get(before.paragraphId);
      if (!after) continue;
      if (textOfRuns(before.runs) === textOfRuns(after.runs)) continue;
      splices.push(...textSplices(context, before, after));
    }

    // 2) 삭제된 문단
    for (const before of baseParagraphs) {
      if (editedById.has(before.paragraphId)) continue;
      const anchor = before.rawXmlAnchor;
      if (anchor === undefined) continue;
      const element = locate(context, anchor, '문단 삭제');
      splices.push({
        start: element.sourceStart,
        end: element.sourceEnd,
        replacement: '',
        reason: `delete ${before.paragraphId}`,
      });
    }

    // 3) 새 문단 — 자리는 anchorHint가, **서식은 IR이** 정한다
    for (const after of editedParagraphs) {
      if (baseById.has(after.paragraphId)) continue;
      if (after.origin !== 'AUTHORED') {
        throw new HwpxExportError(
          'HWPX-1103',
          after.paragraphId,
          'SOURCE 문단이 원본에 없습니다 (IR이 원본과 어긋났습니다)',
        );
      }
      const resolved = resolveInsertionAnchor(after, baseById, editedById);
      const referenceElement = locate(context, resolved.anchor, '문단 삽입 기준');
      const at = insertionPoint(referenceElement, resolved.relation, after.paragraphId);
      const prototypeElement = pickCloneSource(
        context,
        after,
        referenceElement,
        baseParagraphs,
        topLevelParagraphIds,
      );
      splices.push({
        start: at,
        end: at,
        replacement: clonedParagraphXml(context, prototypeElement, after),
        reason: `insert ${after.paragraphId}`,
      });
    }

    if (splices.length === 0) continue;

    // 되쓰기 전에 **왕복 안전성**을 확인한다. 디코딩된 문자열을 다시 UTF-8로
    // 인코딩했을 때 원본 바이트와 다르면(깨진 UTF-8 등) 구간 교체가 손대지
    // 않은 부분까지 바꿔 버린다. 그런 Part는 고치지 않고 거부한다.
    if (Buffer.compare(Buffer.from(text, 'utf8'), Buffer.from(bytes)) !== 0) {
      throw new HwpxExportError(
        'HWPX-1103',
        baseSection.partPath,
        'Part를 UTF-8로 왕복할 수 없습니다 (되쓰면 손대지 않은 바이트가 바뀝니다)',
      );
    }

    const updated = applySplices(text, splices);
    const updatedBytes = Uint8Array.prototype.slice.call(Buffer.from(updated, 'utf8'), 0);
    replacements.set(baseSection.partPath, updatedBytes);
    parts.push({ partPath: baseSection.partPath, splices, bytes: updatedBytes });
    spliceCount += splices.length;
  }

  return { replacements, parts, spliceCount };
}

/** 진단용 — 되쓰기가 손댄 요소 수를 세는 데 쓴다. */
export function countElements(node: XmlNode): number {
  if (!isElement(node)) return 0;
  let total = 1;
  for (const child of node.children) total += countElements(child);
  return total;
}

export { parseAnchor };
