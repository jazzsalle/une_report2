import {
  normalizeOffset,
  type BlockIR,
  type ChangeViolation,
  type DocumentIR,
  type NodeAlias,
  type ParagraphIR,
  type RawXmlAnchor,
  type RunSpan,
  type SelectionAdjustment,
  type SelectionContext,
  type SelectionEnvelope,
  type TextPosition,
} from '@une/domain';
import { blocksBetween, indexDocument, type DocumentIndex } from './document-tree';

/**
 * SelectionResolver (설계 07 §1.8 전건).
 *
 * 클라이언트가 보낸 `SelectionEnvelope`(L2 노드 ID + L3 UTF-16 offset)를
 * 실행기가 소비할 수 있는 `SelectionContext`로 정규화한다.
 *
 * ## 이 파일이 하지 않는 것
 *
 * - **offset 정규화 규칙을 재구현하지 않는다.** 서로게이트/결합문자 판정과
 *   스냅 방향(뒤로)은 도메인 `normalizeOffset`이 정본이며 여기서는 호출만 한다.
 *   두 벌이 되는 순간 클라이언트와 서버의 문자 위치가 조용히 갈라진다.
 * - **시각 좌표를 받지 않는다(§1.8-4).** 받을 필드가 타입에 아예 없으므로
 *   런타임 검사가 필요 없다 — 도메인 `SelectionEnvelope`가 이미 보장한다.
 * - **예외를 던지지 않는다(§1.8-5).** baseRevision 불일치는 정상적인 동시성
 *   결과이지 프로그램 오류가 아니다. 값으로 돌려주고 상위(API)가 409로 사상한다.
 */

/** §1.8-5가 지정한 반환 코드. */
export const SELECTION_STALE_REVISION = 'DAI-1401';
export const SELECTION_UNRESOLVABLE = 'DAI-1402';

export interface ResolveSelectionInput {
  readonly ir: DocumentIR;
  /** 이미 만들어 둔 색인이 있으면 재사용한다(연산마다 다시 만들지 않게). */
  readonly index?: DocumentIndex;
  readonly currentRevisionId: string;
  readonly aliases?: readonly NodeAlias[];
  /** `TemplateProfile.staticRegions[].locator` 목록. 호출자가 주입한다. */
  readonly staticRegionAnchors?: readonly RawXmlAnchor[];
}

export type SelectionResolution =
  | { readonly ok: true; readonly selection: SelectionContext }
  | {
      readonly ok: false;
      readonly code: typeof SELECTION_STALE_REVISION | typeof SELECTION_UNRESOLVABLE;
      /** 재선택을 위해 클라이언트에 알려 줄 현재 revision(§1.8-5). */
      readonly latestRevisionId: string;
      readonly violations: readonly ChangeViolation[];
      readonly adjustments: readonly SelectionAdjustment[];
    };

function fail(
  code: typeof SELECTION_STALE_REVISION | typeof SELECTION_UNRESOLVABLE,
  latestRevisionId: string,
  violations: readonly ChangeViolation[],
  adjustments: readonly SelectionAdjustment[] = [],
): SelectionResolution {
  return { ok: false, code, latestRevisionId, violations, adjustments };
}

/**
 * §1.8-2 alias map 재해석. 체인을 따라가되 순환은 즉시 끊는다.
 *
 * ## 살아 있는 노드는 재사상하지 않는다 (ADR-30 D14 보정)
 *
 * alias는 "이 노드는 더 이상 없다, 저 노드가 되었다"는 진술이다. 그러므로
 * **노드가 현재 문서에 실제로 있으면 alias를 밟지 않는다.** 이 선행 규칙이
 * 없으면 복원·Undo가 문단을 되살린 뒤에도 과거 MERGE의 alias가 계속 살아 있어
 * 되살아난 문단을 가리키는 선택이 조용히 왼쪽 문단으로 끌려간다(그리고
 * `offsetDelta`만큼 위치까지 밀린다) — 오류 없이 **다른 문단이 편집된다.**
 *
 * append-only 이력에서 "어느 alias가 아직 유효한가"를 change_set 계보로 판정하는
 * 것은 이력이 길어질수록 비싸고 취약하다. 반면 "노드가 있으면 재사상하지
 * 않는다"는 **현재 문서 상태만 보고** 같은 결론을 내며, merge→undo→merge 반복에도
 * 그대로 성립한다.
 *
 * @param exists 현재 IR에 그 ID의 노드가 있는지. 주지 않으면 순수한 체인 추적이
 *   되므로 **호출자는 반드시 넘겨야 한다** — 생략은 테스트/도구용이다.
 */
export function resolveAlias(
  aliases: readonly NodeAlias[],
  id: string,
  exists?: (nodeId: string) => boolean,
): { readonly id: string; readonly offsetDelta: number; readonly remapped: boolean } {
  let current = id;
  let offsetDelta = 0;
  let remapped = false;
  const seen = new Set<string>([id]);
  for (;;) {
    if (exists?.(current)) break;
    const hit = aliases.find((alias) => alias.from === current);
    if (!hit || seen.has(hit.to)) break;
    current = hit.to;
    offsetDelta += hit.offsetDelta;
    remapped = true;
    seen.add(current);
  }
  return { id: current, offsetDelta, remapped };
}

export function paragraphTextOf(paragraph: ParagraphIR): string {
  return paragraph.runs.map((run) => run.text).join('');
}

/** 문단 내 run의 누적 UTF-16 span. CC-160이 XML text node로 되돌릴 때 쓴다. */
export function runSpansOf(paragraph: ParagraphIR): RunSpan[] {
  const spans: RunSpan[] = [];
  let cursor = 0;
  for (const run of paragraph.runs) {
    spans.push({ runId: run.runId, start: cursor, end: cursor + run.text.length });
    cursor += run.text.length;
  }
  return spans;
}

function lastSegment(anchor: RawXmlAnchor): string {
  const path = anchor.slice(anchor.indexOf('#') + 1);
  const segment = path.slice(path.lastIndexOf('/') + 1);
  return segment.replace(/\[\d+\]$/, '');
}

/**
 * 필드(누름틀) 제어문자 쌍이 덮는 문자 구간.
 *
 * `hp:fieldBegin`/`hp:fieldEnd`는 offset을 **차지하지 않지만**(도메인
 * `OFFSET_TRANSPARENT_ELEMENTS`) 그 사이의 텍스트는 필드의 내용이다. 쌍 내부에서
 * 문단을 자르거나 범위를 시작하면 CC-160이 필드를 반쪽만 남긴 XML을 쓰게 된다.
 * run 단위로 쌍을 잡는 이유는 IR이 컨트롤을 run의 앵커 목록으로만 갖고 있어
 * 문자 단위 위치를 모르기 때문이다 — 보수적으로 run 경계까지 넓힌다.
 */
export function fieldRegionsOf(paragraph: ParagraphIR): Array<{ start: number; end: number }> {
  const spans = runSpansOf(paragraph);
  const regions: Array<{ start: number; end: number }> = [];
  const open: number[] = [];
  paragraph.runs.forEach((run, i) => {
    for (const control of run.controls) {
      const name = lastSegment(control);
      if (name === 'fieldBegin') open.push(spans[i].start);
      else if (name === 'fieldEnd') {
        const start = open.pop();
        if (start !== undefined) regions.push({ start, end: spans[i].end });
      }
    }
  });
  return regions;
}

function snapOffset(
  paragraph: ParagraphIR,
  offset: number,
): { offset: number; adjustments: SelectionAdjustment[] } {
  const text = paragraphTextOf(paragraph);
  const base = normalizeOffset(text, offset);
  const adjustments = [...base.adjustments];
  let next = base.offset;
  for (const region of fieldRegionsOf(paragraph)) {
    if (next > region.start && next < region.end) {
      next = region.start;
      if (!adjustments.includes('FIELD_BOUNDARY')) adjustments.push('FIELD_BOUNDARY');
    }
  }
  return { offset: next, adjustments };
}

function paragraphOf(index: DocumentIndex, id: string): ParagraphIR | null {
  const entry = index.blocks.get(id);
  if (!entry || entry.block.kind !== 'PARAGRAPH') return null;
  return entry.block;
}

function anchorOfBlock(block: BlockIR): RawXmlAnchor | null {
  return block.kind === 'PRESERVED' ? block.rawXmlAnchor : (block.rawXmlAnchor ?? null);
}

/**
 * 정적영역 포함 판정 — **양방향**이다.
 *
 * 노드가 영역 **안에** 있어도(머리말 하위 문단), 영역이 노드 **안에** 있어도
 * (문단 안의 누름틀 필드) 그 노드를 편집하면 정적영역이 훼손된다. 한 방향만
 * 보면 "문단째로 지우면 통과, 필드만 지우면 거부" 같은 구멍이 생긴다.
 */
export function isInStaticRegion(
  anchor: RawXmlAnchor | null,
  regions: readonly RawXmlAnchor[],
): boolean {
  if (anchor === null) return false;
  return regions.some(
    (region) =>
      anchor === region || anchor.startsWith(`${region}/`) || region.startsWith(`${anchor}/`),
  );
}

interface Checks {
  readonly index: DocumentIndex;
  readonly staticRegions: readonly RawXmlAnchor[];
}

function checkBlock(checks: Checks, id: string, violations: ChangeViolation[]): void {
  const entry = checks.index.blocks.get(id);
  if (!entry) {
    violations.push({
      reason: 'NODE_NOT_FOUND',
      nodeId: id,
      detail: '노드가 현재 개정에 없습니다',
    });
    return;
  }
  if (entry.block.kind === 'PARAGRAPH' && entry.block.editState.locked) {
    violations.push({ reason: 'LOCKED_BLOCK', nodeId: id, detail: '잠긴 블록입니다' });
  }
  if (isInStaticRegion(anchorOfBlock(entry.block), checks.staticRegions)) {
    violations.push({
      reason: 'STATIC_REGION',
      nodeId: id,
      detail: '정적영역(머리말·결재란·고정문구·필드 등)에 속한 블록입니다',
    });
  }
}

export function resolveSelection(
  envelope: SelectionEnvelope,
  input: ResolveSelectionInput,
): SelectionResolution {
  const index = input.index ?? indexDocument(input.ir);
  const aliases = input.aliases ?? [];
  /** 살아 있는 노드는 재사상하지 않는다(`resolveAlias` 주석 참조). */
  const nodeExists = (nodeId: string): boolean => index.blocks.has(nodeId);
  const checks: Checks = { index, staticRegions: input.staticRegionAnchors ?? [] };
  const adjustments: SelectionAdjustment[] = [];
  const violations: ChangeViolation[] = [];

  // 1. baseRevision 일치 (§1.8-1). throw하지 않는다 — 동시성은 정상 경로다.
  if (envelope.baseRevisionId !== input.currentRevisionId) {
    return fail(SELECTION_STALE_REVISION, input.currentRevisionId, [
      {
        reason: 'UNDO_CONFLICT',
        detail:
          `선택이 만들어진 개정(${envelope.baseRevisionId})이 현재 개정` +
          `(${input.currentRevisionId})과 다릅니다. 재선택이 필요합니다.`,
      },
    ]);
  }

  // 2. 노드 존재 확인 + alias 재해석 (§1.8-2).
  const remap = (position: TextPosition): { position: TextPosition; found: ParagraphIR | null } => {
    const alias = resolveAlias(aliases, position.paragraphId, nodeExists);
    if (alias.remapped && !adjustments.includes('ALIAS_REMAPPED')) {
      adjustments.push('ALIAS_REMAPPED');
    }
    const paragraph = paragraphOf(index, alias.id);
    return {
      position: { paragraphId: alias.id, offset: position.offset + alias.offsetDelta },
      found: paragraph,
    };
  };

  const finish = (selection: SelectionContext): SelectionResolution => {
    if (violations.length > 0) {
      return fail(SELECTION_UNRESOLVABLE, input.currentRevisionId, violations, adjustments);
    }
    return { ok: true, selection };
  };

  const base = { baseRevisionId: envelope.baseRevisionId };

  if (envelope.kind === 'CURSOR' || envelope.kind === 'TEXT_RANGE') {
    const startInput = envelope.kind === 'CURSOR' ? envelope.at : envelope.start;
    const endInput = envelope.kind === 'CURSOR' ? envelope.at : envelope.end;
    const startRemap = remap(startInput);
    const endRemap = remap(endInput);
    if (!startRemap.found || !endRemap.found) {
      const missing = !startRemap.found ? startRemap.position : endRemap.position;
      return fail(
        SELECTION_UNRESOLVABLE,
        input.currentRevisionId,
        [
          {
            reason: 'NODE_NOT_FOUND',
            nodeId: missing.paragraphId,
            detail: 'alias 재해석 후에도 문단을 찾지 못했습니다',
          },
        ],
        adjustments,
      );
    }

    // 3. 정방향 정규화 (§1.8-3).
    let startParagraph = startRemap.found;
    let endParagraph = endRemap.found;
    let start = startRemap.position;
    let end = endRemap.position;
    const startEntry = index.blocks.get(startParagraph.paragraphId);
    const endEntry = index.blocks.get(endParagraph.paragraphId);
    const reversed =
      startEntry && endEntry
        ? startEntry.documentOrder > endEntry.documentOrder ||
          (startEntry.documentOrder === endEntry.documentOrder && start.offset > end.offset)
        : false;
    if (reversed) {
      [start, end] = [end, start];
      [startParagraph, endParagraph] = [endParagraph, startParagraph];
      adjustments.push('REVERSED');
    }

    // 표 경계: 다른 컨테이너에 걸치면 범위를 만들 수 없다.
    const targetIds =
      start.paragraphId === end.paragraphId
        ? [start.paragraphId]
        : blocksBetween(index, start.paragraphId, end.paragraphId);
    if (targetIds.length === 0) {
      violations.push({
        reason: 'TABLE_BOUNDARY',
        nodeId: start.paragraphId,
        detail: '선택이 표 셀/섹션 경계를 넘습니다',
      });
    }
    for (const id of targetIds) checkBlock(checks, id, violations);

    // 5. offset 경계 스냅 + runSpans.
    const startSnap = snapOffset(startParagraph, start.offset);
    const endSnap = snapOffset(endParagraph, end.offset);
    for (const adjustment of [...startSnap.adjustments, ...endSnap.adjustments]) {
      if (!adjustments.includes(adjustment)) adjustments.push(adjustment);
    }
    const sameParagraph = start.paragraphId === end.paragraphId;
    const normalizedStart: TextPosition = {
      paragraphId: start.paragraphId,
      offset: startSnap.offset,
    };
    const normalizedEnd: TextPosition = {
      paragraphId: end.paragraphId,
      offset: sameParagraph ? Math.max(startSnap.offset, endSnap.offset) : endSnap.offset,
    };

    return finish({
      kind: envelope.kind,
      ...base,
      targetIds,
      start: normalizedStart,
      end: normalizedEnd,
      // 여러 문단에 걸친 선택에서는 span을 싣지 않는다: `RunSpan`에 문단 ID가
      // 없어서 문단마다 0부터 다시 세는 offset이 한 배열에 섞이면 CC-160이
      // 어느 문단의 좌표인지 복원할 수 없다(있는 것보다 없는 편이 안전하다).
      ...(sameParagraph ? { runSpans: runSpansOf(startParagraph) } : {}),
      adjustments,
    });
  }

  if (envelope.kind === 'BLOCK') {
    const ids: string[] = [];
    for (const rawId of envelope.blockIds) {
      const alias = resolveAlias(aliases, rawId, nodeExists);
      if (alias.remapped && !adjustments.includes('ALIAS_REMAPPED')) {
        adjustments.push('ALIAS_REMAPPED');
      }
      if (!ids.includes(alias.id)) ids.push(alias.id);
    }
    for (const id of ids) checkBlock(checks, id, violations);
    const containers = new Set(
      ids.map((id) => index.blocks.get(id)?.containerId).filter((value) => value !== undefined),
    );
    if (containers.size > 1) {
      violations.push({
        reason: 'TABLE_BOUNDARY',
        detail: '한 선택에 여러 컨테이너(섹션/표 셀)의 블록이 섞였습니다',
      });
    }
    // 비연속 선택도 허용하되(§1.8 BLOCK 행), 문서 순서로 정렬해 돌려준다.
    const ordered = [...ids].sort(
      (a, b) =>
        (index.blocks.get(a)?.documentOrder ?? 0) - (index.blocks.get(b)?.documentOrder ?? 0),
    );
    return finish({ kind: 'BLOCK', ...base, targetIds: ordered, adjustments });
  }

  if (envelope.kind === 'SECTION') {
    const section = input.ir.sections.find((item) => item.sectionId === envelope.sectionId);
    if (!section) {
      return fail(
        SELECTION_UNRESOLVABLE,
        input.currentRevisionId,
        [{ reason: 'NODE_NOT_FOUND', nodeId: envelope.sectionId, detail: '섹션이 없습니다' }],
        adjustments,
      );
    }
    const ids = section.blocks.map((block) =>
      block.kind === 'PARAGRAPH'
        ? block.paragraphId
        : block.kind === 'TABLE'
          ? block.tableId
          : block.preservedId,
    );
    for (const id of ids) checkBlock(checks, id, violations);
    return finish({ kind: 'SECTION', ...base, targetIds: ids, adjustments });
  }

  // TABLE_CELL
  const cellEntry = index.cells.get(envelope.cellId);
  if (!cellEntry || cellEntry.tableId !== envelope.tableId) {
    return fail(
      SELECTION_UNRESOLVABLE,
      input.currentRevisionId,
      [
        {
          reason: cellEntry ? 'TABLE_BOUNDARY' : 'NODE_NOT_FOUND',
          nodeId: envelope.cellId,
          detail: cellEntry ? '셀이 지정한 표에 속하지 않습니다' : '셀이 없습니다',
        },
      ],
      adjustments,
    );
  }
  const table = index.blocks.get(envelope.tableId);
  if (table && isInStaticRegion(anchorOfBlock(table.block), checks.staticRegions)) {
    violations.push({
      reason: 'STATIC_REGION',
      nodeId: envelope.tableId,
      detail: '정적영역(결재란 등)에 속한 표입니다',
    });
  }

  let start: TextPosition | undefined;
  let end: TextPosition | undefined;
  let runSpans: RunSpan[] | undefined;
  if (envelope.start && envelope.end) {
    const startRemap = remap(envelope.start);
    const endRemap = remap(envelope.end);
    const inCell = (id: string): boolean => index.blocks.get(id)?.cellId === envelope.cellId;
    if (!startRemap.found || !endRemap.found) {
      violations.push({
        reason: 'NODE_NOT_FOUND',
        nodeId: envelope.start.paragraphId,
        detail: '셀 내부 문단을 찾지 못했습니다',
      });
    } else if (!inCell(startRemap.position.paragraphId) || !inCell(endRemap.position.paragraphId)) {
      violations.push({
        reason: 'TABLE_BOUNDARY',
        nodeId: envelope.cellId,
        detail: '로컬 범위가 셀 경계를 벗어납니다',
      });
    } else {
      const sameParagraph = startRemap.position.paragraphId === endRemap.position.paragraphId;
      const flip = sameParagraph && startRemap.position.offset > endRemap.position.offset;
      if (flip) adjustments.push('REVERSED');
      const first = flip ? endRemap : startRemap;
      const second = flip ? startRemap : endRemap;
      const firstSnap = snapOffset(first.found as ParagraphIR, first.position.offset);
      const secondSnap = snapOffset(second.found as ParagraphIR, second.position.offset);
      for (const adjustment of [...firstSnap.adjustments, ...secondSnap.adjustments]) {
        if (!adjustments.includes(adjustment)) adjustments.push(adjustment);
      }
      start = { paragraphId: first.position.paragraphId, offset: firstSnap.offset };
      end = { paragraphId: second.position.paragraphId, offset: secondSnap.offset };
      if (sameParagraph) runSpans = runSpansOf(first.found as ParagraphIR);
    }
  }

  return finish({
    kind: 'TABLE_CELL',
    ...base,
    targetIds: [envelope.cellId],
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
    ...(runSpans ? { runSpans } : {}),
    adjustments,
  });
}
