import {
  CHANGE_OPERATION_TYPES,
  documentIrHash,
  type BlockAnchor,
  type BlockIR,
  type ChangeOperation,
  type ChangeSetOrigin,
  type ChangeSetRequest,
  type ChangeViolation,
  type DiffEntry,
  type DocumentIR,
  type EditState,
  type NodeAlias,
  type ParagraphIR,
  type RawXmlAnchor,
  type RunIR,
  type SelectionEnvelope,
  type TableCellIR,
} from '@une/domain';
import type { Prototype } from '../analysis/prototype-registry';
import { AuthoredIdCollisionError, AuthoredIdIssuer } from './authored-id';
import {
  indexDocument,
  insertAt,
  mapCells,
  normalizeAnchorHints,
  removeBlocks,
  replaceBlock,
  type DocumentIndex,
} from './document-tree';
import { blockId, type ParagraphBlock } from './ir-lift';
import {
  INVERSE_SELECTION_BASE,
  invertOperations,
  type BeforeImage,
  type RemovedBlock,
} from './inverse-ops';
import { applyPrefixPolicy, resolveSeed } from './prototype-resolve';
import {
  isInStaticRegion,
  paragraphTextOf,
  resolveSelection,
  type SelectionResolution,
} from './selection-resolver';

/**
 * ChangeSetExecutor (설계 07 §1.9 전건).
 *
 * ## 원자성을 자료구조로 보장한다
 *
 * §1.9는 "on error: rollback() + no partial document mutation"을 요구한다.
 * 여기서는 롤백을 구현하지 않는다 — **롤백할 것이 없게** 만든다:
 *
 *   - 입력 IR은 어떤 경로로도 변형되지 않는다(모든 트리 연산이 새 객체를 만든다).
 *   - 실패 결과 타입에는 `ir` 필드가 **아예 없다**. "절반만 바뀐 문서"는
 *     반환값으로 표현할 수 없으므로, 호출자가 실수로 그것을 저장할 수 없다.
 *   - DB 트랜잭션(`beginTransaction`/`commit`)은 이 파일의 관심사가 아니다.
 *     엔진은 DB를 모르고, API 층이 상태변경·감사이벤트·Outbox를 한 트랜잭션으로
 *     묶는다(.claude/rules/backend.md).
 *
 * ## §1.9 파이프라인과의 차이 한 가지
 *
 * 정본은 `resolveTargets()`와 `checkLocksAndStaticRegions()`를 적용 **전에**
 * 문서 전체에 대해 한 번 도는 단계로 적었다. 그런데 뒤 연산이 앞 연산이 만든
 * 노드를 대상으로 하는 것이 정상 사용(삽입 후 그 문단에 역할 적용)이므로,
 * 두 단계를 **연산 루프 안**으로 옮겨 각 연산 직전에 수행한다. 원자성은
 * 영향받지 않는다 — 아무것도 커밋되지 않은 상태에서 중단하기 때문이다.
 * `validateSchema`/`checkBaseRevision`은 정본대로 루프 밖에서 한 번 돈다.
 *
 * ## dryRun
 *
 * `dryRunAndBuildDiff()`와 `applyOperationsInOrder()`가 같은 계산이다. 순수
 * 함수이므로 "미리 해 보고 버리는 것"과 "하는 것"이 구별되지 않는다.
 * `request.dryRun`이면 결과에 `dryRun: true`만 표시하고 호출자가 개정을 만들지
 * 않는다(US-PLAN-017 A-01: 사용자가 Diff를 승인해야 문서가 움직인다).
 */

/** INSERT_BLOCKS INLINE 소스가 받는 두 가지 모양. */
export interface AuthoredBlockSpec {
  readonly text: string;
  readonly styleRole?: string;
  readonly outlineLevel?: number;
}

/**
 * `GENERATED_BLOCKS`(materialize) 주입 포트.
 *
 * **엔진은 DB를 읽지 않는다.** `generated_block` 행을 읽는 것은 API/워커의 일이고
 * (ADR-27 D2), 엔진은 "블록을 받아서 넣는" 순수 변환만 한다. 그래서 이 인터페이스는
 * 조회 함수가 아니라 **주입 함수**다 — 구현이 없으면 해당 연산은 위반으로 끝난다.
 */
export type GeneratedBlockProvider = (request: {
  readonly planId: string;
  readonly tocVersionId: string;
}) => readonly AuthoredBlockSpec[] | null;

export interface ApplyChangeSetInput {
  readonly ir: DocumentIR;
  readonly request: ChangeSetRequest;
  /** 이 ChangeSet의 ID. 신규 노드 ID의 결정적 좌표가 된다(ADR-30 D2). */
  readonly changeSetId: string;
  readonly currentRevisionId: string;
  readonly prototypes?: readonly Prototype[];
  /** `TemplateProfile.staticRegions[].locator`. */
  readonly staticRegionAnchors?: readonly RawXmlAnchor[];
  /** 이전 ChangeSet들이 남긴 alias 이력(§1.8-2). */
  readonly aliases?: readonly NodeAlias[];
  readonly generatedBlocks?: GeneratedBlockProvider;
}

export type ApplyChangeSetResult =
  | {
      readonly ok: true;
      readonly ir: DocumentIR;
      readonly irHash: string;
      readonly diff: readonly DiffEntry[];
      readonly inverseOperations: readonly ChangeOperation[];
      /** 이번 ChangeSet이 새로 만든 alias(누적본이 아니다). */
      readonly aliases: readonly NodeAlias[];
      /**
       * 이번 ChangeSet이 **무효화한** alias.
       *
       * MERGE의 역연산(SPLIT 복원)은 사라졌던 문단을 되살리므로 "right → left"
       * 재사상이 더는 참이 아니다. alias 이력이 append-only 목록이면 이 사실을
       * 표현할 방법이 없어, 되살아난 문단을 가리키는 선택이 계속 왼쪽 문단으로
       * 끌려간다. 저장 형태 결정(ADR)이 필요한 지점이라 값으로 노출한다.
       */
      readonly aliasRemovals: readonly NodeAlias[];
      readonly warnings: readonly string[];
      readonly dryRun: boolean;
    }
  | { readonly ok: false; readonly violations: readonly ChangeViolation[] };

interface Ctx {
  ir: DocumentIR;
  index: DocumentIndex;
  readonly issuer: AuthoredIdIssuer;
  readonly prototypes: readonly Prototype[];
  readonly staticRegions: readonly RawXmlAnchor[];
  readonly aliases: NodeAlias[];
  readonly aliasRemovals: NodeAlias[];
  readonly diff: DiffEntry[];
  readonly warnings: string[];
  readonly origin: ChangeSetOrigin;
  readonly baseRevisionId: string;
  readonly generatedBlocks: GeneratedBlockProvider | null;
}

function violation(
  reason: ChangeViolation['reason'],
  detail: string,
  nodeId?: string,
  operationOrder?: number,
): ChangeViolation {
  return {
    reason,
    detail,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(operationOrder === undefined ? {} : { operationOrder }),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// 1. validateSchema

const RELATIONS: ReadonlySet<string> = new Set(['BEFORE', 'AFTER', 'FIRST_CHILD', 'LAST_CHILD']);

function validateSchema(request: ChangeSetRequest): ChangeViolation[] {
  const violations: ChangeViolation[] = [];
  if (request.operations.length === 0) {
    violations.push(violation('UNSUPPORTED_OPERATION', '연산이 하나도 없습니다'));
  }
  const orders = new Set<number>();
  for (const op of request.operations) {
    if (!CHANGE_OPERATION_TYPES.includes(op.type)) {
      violations.push(
        violation(
          'UNSUPPORTED_OPERATION',
          `알 수 없는 연산 유형: ${String(op.type)}`,
          undefined,
          op.order,
        ),
      );
      continue;
    }
    if (orders.has(op.order)) {
      violations.push(
        violation(
          'UNSUPPORTED_OPERATION',
          `연산 order가 중복됩니다: ${op.order}`,
          undefined,
          op.order,
        ),
      );
    }
    orders.add(op.order);
    if (op.anchor && !RELATIONS.has(op.anchor.relation)) {
      violations.push(
        violation('UNSUPPORTED_OPERATION', `알 수 없는 anchor relation`, op.anchor.ref, op.order),
      );
    }
    // §1.9 표의 "필수 인자".
    const payload = asRecord(op.payload);
    switch (op.type) {
      case 'INSERT_BLOCKS':
        if (!op.anchor) {
          violations.push(
            violation('UNSUPPORTED_OPERATION', 'anchor가 필요합니다', undefined, op.order),
          );
        }
        if (!op.source) {
          violations.push(
            violation('UNSUPPORTED_OPERATION', 'source가 필요합니다', undefined, op.order),
          );
        }
        break;
      case 'REPLACE_RANGE':
        if (!op.selection) {
          violations.push(
            violation('UNSUPPORTED_OPERATION', 'selection이 필요합니다', undefined, op.order),
          );
        }
        if (!op.source && !('text' in payload) && !('restoreRuns' in payload)) {
          // 치환할 내용이 없는 REPLACE_RANGE는 사실상 삭제다. 두 어휘가 같은
          // 일을 하면 감사 기록에서 의도를 읽을 수 없다.
          violations.push(
            violation(
              'UNSUPPORTED_OPERATION',
              'REPLACE_RANGE에는 source 또는 payload.text가 필요합니다(삭제는 DELETE_RANGE)',
              undefined,
              op.order,
            ),
          );
        }
        break;
      case 'DELETE_RANGE':
        if (!op.selection) {
          violations.push(
            violation('UNSUPPORTED_OPERATION', 'selection이 필요합니다', undefined, op.order),
          );
        }
        break;
      case 'SPLIT_PARAGRAPH':
        if (
          !op.selection &&
          (readString(payload, 'paragraphId') === null || readNumber(payload, 'offset') === null)
        ) {
          violations.push(
            violation(
              'UNSUPPORTED_OPERATION',
              'paragraphId+offset(또는 CURSOR selection)이 필요합니다',
              undefined,
              op.order,
            ),
          );
        }
        break;
      case 'MERGE_PARAGRAPHS':
        if (readString(payload, 'leftId') === null || readString(payload, 'rightId') === null) {
          violations.push(
            violation('UNSUPPORTED_OPERATION', 'leftId/rightId가 필요합니다', undefined, op.order),
          );
        }
        break;
      case 'MOVE_BLOCK':
        if (readString(payload, 'blockId') === null || !op.anchor) {
          violations.push(
            violation(
              'UNSUPPORTED_OPERATION',
              'blockId+targetAnchor가 필요합니다',
              undefined,
              op.order,
            ),
          );
        }
        break;
      case 'APPLY_STYLE_ROLE':
        if (readString(payload, 'blockId') === null || !('styleRole' in payload)) {
          violations.push(
            violation(
              'UNSUPPORTED_OPERATION',
              'blockId+styleRole이 필요합니다',
              undefined,
              op.order,
            ),
          );
        }
        if ('styleId' in payload) {
          // §1.9 "직접 styleId 설정 금지". 어휘 자체를 거부한다.
          violations.push(
            violation(
              'UNSUPPORTED_OPERATION',
              'APPLY_STYLE_ROLE은 styleId를 직접 설정할 수 없습니다(역할만 지정)',
              readString(payload, 'blockId') ?? undefined,
              op.order,
            ),
          );
        }
        break;
      default:
        if (readString(payload, 'tableId') === null || !Array.isArray(payload.cellOps)) {
          violations.push(
            violation('UNSUPPORTED_OPERATION', 'tableId+cellOps가 필요합니다', undefined, op.order),
          );
        }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// 공통 검사

function anchorOfBlock(block: BlockIR): RawXmlAnchor | null {
  return block.kind === 'PRESERVED' ? block.rawXmlAnchor : (block.rawXmlAnchor ?? null);
}

/** 블록/셀 하나가 편집 가능한지(존재·잠금·정적영역). */
function checkEditable(ctx: Ctx, id: string, order: number, violations: ChangeViolation[]): void {
  const entry = ctx.index.blocks.get(id);
  if (entry) {
    if (entry.block.kind === 'PARAGRAPH' && entry.block.editState.locked) {
      violations.push(violation('LOCKED_BLOCK', '잠긴 블록입니다', id, order));
    }
    if (isInStaticRegion(anchorOfBlock(entry.block), ctx.staticRegions)) {
      violations.push(violation('STATIC_REGION', '정적영역에 속한 블록입니다', id, order));
    }
    // 표 안의 블록이면 표 자체의 정적영역 판정(결재란)도 물려받는다.
    if (entry.tableId !== null) checkTableStatic(ctx, entry.tableId, order, violations);
    return;
  }
  const cell = ctx.index.cells.get(id);
  if (cell) {
    checkTableStatic(ctx, cell.tableId, order, violations);
    return;
  }
  const section = ctx.ir.sections.find((item) => item.sectionId === id);
  if (!section) {
    violations.push(violation('NODE_NOT_FOUND', '노드가 현재 개정에 없습니다', id, order));
  }
}

function checkTableStatic(
  ctx: Ctx,
  tableId: string,
  order: number,
  violations: ChangeViolation[],
): void {
  const table = ctx.index.blocks.get(tableId);
  if (table && isInStaticRegion(anchorOfBlock(table.block), ctx.staticRegions)) {
    violations.push(
      violation('STATIC_REGION', '정적영역(결재란 등)에 속한 표입니다', tableId, order),
    );
  }
}

/** 블록이 원래 있던 자리를 되돌릴 수 있는 앵커로 표현한다. */
function anchorOfPosition(index: DocumentIndex, id: string): BlockAnchor | null {
  const entry = index.blocks.get(id);
  if (!entry) return null;
  const siblings = index.containers.get(entry.containerId) ?? [];
  if (entry.index === 0) return { relation: 'FIRST_CHILD', ref: entry.containerId };
  return { relation: 'AFTER', ref: blockId(siblings[entry.index - 1]) };
}

// ---------------------------------------------------------------------------
// 신규 노드 생성

function authorParagraph(
  ctx: Ctx,
  order: number,
  anchor: BlockAnchor,
  spec: AuthoredBlockSpec,
): BlockIR {
  const seed = resolveSeed({
    prototypes: ctx.prototypes,
    index: ctx.index,
    styleRole: spec.styleRole ?? 'BODY',
    outlineLevel: spec.outlineLevel ?? null,
  });
  if (seed.warning) ctx.warnings.push(seed.warning);
  const run: RunIR = {
    runId: ctx.issuer.issue('R', order),
    text: applyPrefixPolicy(seed, spec.text),
    charPrId: seed.styleRef.charPrId,
    controls: [],
  };
  const editState: EditState = { editedByUser: ctx.origin === 'USER', locked: false };
  return {
    kind: 'PARAGRAPH',
    origin: 'AUTHORED',
    paragraphId: ctx.issuer.issue('P', order),
    runs: [run],
    styleRef: seed.styleRef,
    editState,
    anchorHint: anchor,
    styleRole: seed.styleRole,
    ...(seed.outlineLevel === null ? {} : { outlineLevel: seed.outlineLevel }),
    prototypeId: seed.prototypeId,
  };
}

function isRestoreEntry(value: unknown): value is { restore: BlockIR } {
  return value !== null && typeof value === 'object' && 'restore' in (value as object);
}

function toBlockSpec(value: unknown): AuthoredBlockSpec | null {
  const record = asRecord(value);
  const text = readString(record, 'text');
  if (text === null) return null;
  const styleRole = readString(record, 'styleRole');
  const outlineLevel = readNumber(record, 'outlineLevel');
  return {
    text,
    ...(styleRole === null ? {} : { styleRole }),
    ...(outlineLevel === null ? {} : { outlineLevel }),
  };
}

function buildIncomingBlocks(
  ctx: Ctx,
  op: ChangeOperation,
  anchor: BlockAnchor,
  violations: ChangeViolation[],
): BlockIR[] {
  const source = op.source;
  if (!source) return [];
  if (source.kind === 'INLINE') {
    const out: BlockIR[] = [];
    for (const entry of source.blocks) {
      if (isRestoreEntry(entry)) {
        out.push(entry.restore);
        continue;
      }
      const spec = toBlockSpec(entry);
      if (!spec) {
        violations.push(
          violation('UNSUPPORTED_OPERATION', 'INLINE 블록에 text가 없습니다', undefined, op.order),
        );
        continue;
      }
      out.push(authorParagraph(ctx, op.order, anchor, spec));
    }
    return out;
  }
  if (source.kind === 'PROTOTYPE') {
    const prototype = ctx.prototypes.find((item) => item.prototypeId === source.prototypeId);
    if (!prototype) {
      violations.push(
        violation('NODE_NOT_FOUND', 'prototypeId를 찾을 수 없습니다', source.prototypeId, op.order),
      );
      return [];
    }
    const count = Math.max(0, Math.trunc(source.count));
    return Array.from({ length: count }, () =>
      authorParagraph(ctx, op.order, anchor, {
        text: '',
        styleRole: prototype.styleRole,
        ...(prototype.outlineLevel === null ? {} : { outlineLevel: prototype.outlineLevel }),
      }),
    );
  }
  // GENERATED_BLOCKS — materialize. 엔진은 DB를 읽지 않는다.
  const provided = ctx.generatedBlocks
    ? ctx.generatedBlocks({ planId: source.planId, tocVersionId: source.tocVersionId })
    : null;
  if (!provided) {
    violations.push(
      violation(
        'UNSUPPORTED_OPERATION',
        'GENERATED_BLOCKS 소스가 주입되지 않았습니다(엔진은 generated_block을 조회하지 않습니다)',
        undefined,
        op.order,
      ),
    );
    return [];
  }
  return provided.map((spec) => authorParagraph(ctx, op.order, anchor, spec));
}

// ---------------------------------------------------------------------------
// 문단 텍스트 편집

function replaceParagraphText(
  paragraph: ParagraphBlock,
  start: number,
  end: number,
  insertText: string,
): ParagraphBlock {
  // run은 **지우지 않는다**. 비게 되어도 남겨야 runId와 `controls` 앵커(필드·
  // 공백 구성요소)가 살아남고, CC-160이 XML text node로 되돌릴 대상을 잃지 않는다.
  let cursor = 0;
  let inserted = false;
  const runs = paragraph.runs.map((run) => {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= start || runStart >= end) {
      if (runStart === start && !inserted && insertText !== '' && runEnd > start) {
        inserted = true;
        return { ...run, text: `${insertText}${run.text}` };
      }
      return run;
    }
    const head = run.text.slice(0, Math.max(0, start - runStart));
    const tail = run.text.slice(Math.max(0, Math.min(run.text.length, end - runStart)));
    const middle = inserted ? '' : insertText;
    inserted = true;
    return { ...run, text: `${head}${middle}${tail}` };
  });
  if (!inserted && insertText !== '') {
    // 빈 문단이거나 문단 끝에 붙이는 경우.
    const last = runs.length - 1;
    if (last >= 0) runs[last] = { ...runs[last], text: `${runs[last].text}${insertText}` };
  }
  return { ...paragraph, runs };
}

// ---------------------------------------------------------------------------
// 연산 적용

interface OpOutcome {
  readonly before: BeforeImage | null;
  readonly violations: readonly ChangeViolation[];
}

function resolveOpSelection(ctx: Ctx, envelope: SelectionEnvelope): SelectionResolution {
  // 역연산이 품은 센티널은 요청의 baseRevision으로 치환한다(inverse-ops.ts 참조).
  const rebased: SelectionEnvelope =
    envelope.baseRevisionId === INVERSE_SELECTION_BASE
      ? { ...envelope, baseRevisionId: ctx.baseRevisionId }
      : envelope;
  return resolveSelection(rebased, {
    ir: ctx.ir,
    index: ctx.index,
    currentRevisionId: ctx.baseRevisionId,
    aliases: ctx.aliases,
    staticRegionAnchors: ctx.staticRegions,
  });
}

/**
 * 문자 층 편집인지 블록 층 편집인지 판정한다.
 *
 * `CURSOR`/`TEXT_RANGE`(그리고 로컬 범위가 있는 `TABLE_CELL`)는 문자 층이고,
 * `BLOCK`/`SECTION`은 블록 층이다. 판정을 선택 **유형**으로 하는 이유: offset이
 * 우연히 같다는 이유로 "문단 통째 삭제"로 승격되면, 커서만 놓고 Delete를 누른
 * 사용자가 문단을 잃는다.
 */
function isCharacterScope(kind: string, hasRange: boolean): boolean {
  if (kind === 'CURSOR' || kind === 'TEXT_RANGE') return true;
  return kind === 'TABLE_CELL' && hasRange;
}

function applyInsertBlocks(ctx: Ctx, op: ChangeOperation): OpOutcome {
  const violations: ChangeViolation[] = [];
  const anchor = op.anchor as BlockAnchor;
  checkEditable(ctx, anchor.ref, op.order, violations);
  const blocks = buildIncomingBlocks(ctx, op, anchor, violations);
  if (violations.length > 0) return { before: null, violations };
  const next = insertAt(ctx.ir, anchor, blocks);
  if (!next) {
    return {
      before: null,
      violations: [
        violation('NODE_NOT_FOUND', 'anchor 대상 자리를 찾지 못했습니다', anchor.ref, op.order),
      ],
    };
  }
  ctx.ir = next;
  const ids = blocks.map(blockId);
  for (const id of ids) ctx.diff.push({ kind: 'ADDED', nodeId: id });
  return { before: { kind: 'INSERTED', ids }, violations: [] };
}

function collectRemoved(ctx: Ctx, ids: readonly string[]): RemovedBlock[] {
  return [...ids]
    .sort(
      (a, b) =>
        (ctx.index.blocks.get(a)?.documentOrder ?? 0) -
        (ctx.index.blocks.get(b)?.documentOrder ?? 0),
    )
    .map((id) => ({
      block: ctx.index.blocks.get(id)?.block as BlockIR,
      anchor: anchorOfPosition(ctx.index, id) as BlockAnchor,
    }))
    .filter((entry) => entry.block !== undefined && entry.anchor !== null);
}

/**
 * 문자 층 편집의 공통 경로. `insertText`가 빈 문자열이면 삭제다.
 * 여러 문단에 걸친 문자 범위는 **거부**한다 — 첫/끝 문단을 부분 삭제하고 사이
 * 문단을 지운 뒤 남은 두 조각을 병합하는 복합 의미가 되는데, 그것은 §1.9가
 * SPLIT/MERGE와 블록 연산으로 표현하라고 이미 어휘를 준 일이다. 한 연산에
 * 숨기면 역연산도 감사 기록도 복합이 된다.
 */
function applyTextEdit(
  ctx: Ctx,
  op: ChangeOperation,
  selection: {
    start?: { paragraphId: string; offset: number };
    end?: { paragraphId: string; offset: number };
  },
  insertText: string,
  allowCollapsed: boolean,
): OpOutcome {
  const start = selection.start;
  const end = selection.end;
  if (!start || !end) {
    return {
      before: null,
      violations: [violation('UNSUPPORTED_OPERATION', '문자 범위가 없습니다', undefined, op.order)],
    };
  }
  if (start.paragraphId !== end.paragraphId) {
    return {
      before: null,
      violations: [
        violation(
          'UNSUPPORTED_OPERATION',
          '여러 문단에 걸친 문자 범위 편집은 지원하지 않습니다(SPLIT/MERGE·블록 연산으로 표현하십시오)',
          start.paragraphId,
          op.order,
        ),
      ],
    };
  }
  if (!allowCollapsed && start.offset === end.offset) {
    return {
      before: null,
      violations: [
        violation(
          'UNSUPPORTED_OPERATION',
          '빈 범위는 삭제할 수 없습니다',
          start.paragraphId,
          op.order,
        ),
      ],
    };
  }
  const entry = ctx.index.blocks.get(start.paragraphId);
  if (!entry || entry.block.kind !== 'PARAGRAPH') {
    return {
      before: null,
      violations: [
        violation('NODE_NOT_FOUND', '문단을 찾지 못했습니다', start.paragraphId, op.order),
      ],
    };
  }
  const before: BeforeImage = {
    kind: 'PARAGRAPH_RUNS',
    paragraphId: entry.block.paragraphId,
    runs: entry.block.runs,
  };
  const next = replaceBlock(ctx.ir, entry.block.paragraphId, [
    replaceParagraphText(entry.block, start.offset, end.offset, insertText),
  ]);
  if (!next) {
    return {
      before: null,
      violations: [
        violation('NODE_NOT_FOUND', '문단 치환 실패', entry.block.paragraphId, op.order),
      ],
    };
  }
  ctx.ir = next;
  ctx.diff.push({ kind: 'MODIFIED', nodeId: entry.block.paragraphId });
  return { before, violations: [] };
}

function applyDeleteRange(ctx: Ctx, op: ChangeOperation): OpOutcome {
  const resolved = resolveOpSelection(ctx, op.selection as SelectionEnvelope);
  if (!resolved.ok) {
    return {
      before: null,
      violations: resolved.violations.map((item) => ({ ...item, operationOrder: op.order })),
    };
  }
  const selection = resolved.selection;
  const violations: ChangeViolation[] = [];
  for (const id of selection.targetIds) checkEditable(ctx, id, op.order, violations);
  if (violations.length > 0) return { before: null, violations };

  if (isCharacterScope(selection.kind, selection.start !== undefined)) {
    return applyTextEdit(ctx, op, selection, '', false);
  }

  // 블록 삭제.
  const removed = collectRemoved(ctx, selection.targetIds);
  const result = removeBlocks(ctx.ir, new Set(selection.targetIds));
  ctx.ir = result.ir;
  for (const entry of removed) ctx.diff.push({ kind: 'REMOVED', nodeId: blockId(entry.block) });
  return { before: { kind: 'BLOCKS_REMOVED', removed }, violations: [] };
}

function applyReplaceRange(ctx: Ctx, op: ChangeOperation): OpOutcome {
  const payload = asRecord(op.payload);
  const resolved = resolveOpSelection(ctx, op.selection as SelectionEnvelope);
  if (!resolved.ok) {
    return {
      before: null,
      violations: resolved.violations.map((item) => ({ ...item, operationOrder: op.order })),
    };
  }
  const selection = resolved.selection;
  const violations: ChangeViolation[] = [];
  for (const id of selection.targetIds) checkEditable(ctx, id, op.order, violations);
  if (violations.length > 0) return { before: null, violations };

  // (a) 문단 run 복원 — 문자 편집의 역연산이 쓰는 경로. before 이미지를 그대로
  //     되돌리므로 run 경계에서의 재분배 오차가 생기지 않는다.
  const restoreRuns = payload.restoreRuns;
  if (Array.isArray(restoreRuns)) {
    const targetId = selection.start?.paragraphId ?? selection.targetIds[0];
    const entry = ctx.index.blocks.get(targetId);
    if (!entry || entry.block.kind !== 'PARAGRAPH') {
      return {
        before: null,
        violations: [violation('NODE_NOT_FOUND', '문단을 찾지 못했습니다', targetId, op.order)],
      };
    }
    const before: BeforeImage = {
      kind: 'PARAGRAPH_RUNS',
      paragraphId: entry.block.paragraphId,
      runs: entry.block.runs,
    };
    const next = replaceBlock(ctx.ir, entry.block.paragraphId, [
      { ...entry.block, runs: restoreRuns as RunIR[] },
    ]);
    if (!next)
      return {
        before: null,
        violations: [violation('NODE_NOT_FOUND', '문단 치환 실패', targetId, op.order)],
      };
    ctx.ir = next;
    ctx.diff.push({ kind: 'MODIFIED', nodeId: entry.block.paragraphId });
    return { before, violations: [] };
  }

  // (b) 문자 범위 치환.
  const text = readString(payload, 'text');
  if (isCharacterScope(selection.kind, selection.start !== undefined)) {
    if (text === null) {
      return {
        before: null,
        violations: [
          violation(
            'UNSUPPORTED_OPERATION',
            '문자 범위 치환에는 payload.text가 필요합니다',
            undefined,
            op.order,
          ),
        ],
      };
    }
    return applyTextEdit(ctx, op, selection, text, true);
  }

  // (c) 블록 치환.
  if (selection.targetIds.length === 0) {
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '치환 대상이 없습니다', undefined, op.order)],
    };
  }
  const firstId = selection.targetIds[0];
  const anchor = anchorOfPosition(ctx.index, firstId);
  if (!anchor) {
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '대상 위치를 찾지 못했습니다', firstId, op.order)],
    };
  }
  const incoming = buildIncomingBlocks(ctx, op, anchor, violations);
  if (violations.length > 0) return { before: null, violations };
  const removed = collectRemoved(ctx, selection.targetIds);
  const replaced = replaceBlock(ctx.ir, firstId, incoming);
  if (!replaced) {
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '치환 대상을 찾지 못했습니다', firstId, op.order)],
    };
  }
  const rest = new Set(selection.targetIds.filter((id) => id !== firstId));
  ctx.ir = rest.size > 0 ? removeBlocks(replaced, rest).ir : replaced;
  for (const entry of removed) ctx.diff.push({ kind: 'REMOVED', nodeId: blockId(entry.block) });
  const newIds = incoming.map(blockId);
  for (const id of newIds) ctx.diff.push({ kind: 'ADDED', nodeId: id });
  return { before: { kind: 'BLOCKS_REPLACED', newIds, removed }, violations: [] };
}

function applySplitParagraph(ctx: Ctx, op: ChangeOperation): OpOutcome {
  const payload = asRecord(op.payload);
  let paragraphId = readString(payload, 'paragraphId');
  let offset = readNumber(payload, 'offset') ?? 0;

  if (op.selection) {
    const resolved = resolveOpSelection(ctx, op.selection);
    if (!resolved.ok) {
      return {
        before: null,
        violations: resolved.violations.map((item) => ({ ...item, operationOrder: op.order })),
      };
    }
    paragraphId = resolved.selection.start?.paragraphId ?? resolved.selection.targetIds[0];
    offset = resolved.selection.start?.offset ?? 0;
  }
  if (paragraphId === null) {
    return {
      before: null,
      violations: [
        violation('UNSUPPORTED_OPERATION', 'paragraphId가 없습니다', undefined, op.order),
      ],
    };
  }
  const violations: ChangeViolation[] = [];
  checkEditable(ctx, paragraphId, op.order, violations);
  if (violations.length > 0) return { before: null, violations };

  const entry = ctx.index.blocks.get(paragraphId);
  if (!entry || entry.block.kind !== 'PARAGRAPH') {
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '문단이 아닙니다', paragraphId, op.order)],
    };
  }
  const source = entry.block;

  // 복원 모드(MERGE의 역연산): 원래의 오른쪽 문단 객체를 그대로 되살린다.
  const restore = asRecord(payload.restore);
  if (restore.rightParagraph) {
    const right = restore.rightParagraph as ParagraphIR;
    const leftRunCount = readNumber(restore, 'leftRunCount') ?? source.runs.length;
    const left: ParagraphIR = { ...source, runs: source.runs.slice(0, leftRunCount) };
    const restored: ParagraphIR = { ...right, runs: source.runs.slice(leftRunCount) };
    const next = replaceBlock(ctx.ir, paragraphId, [
      { kind: 'PARAGRAPH', ...left },
      { kind: 'PARAGRAPH', ...restored },
    ]);
    if (!next)
      return {
        before: null,
        violations: [violation('NODE_NOT_FOUND', '분할 실패', paragraphId, op.order)],
      };
    ctx.ir = next;
    ctx.diff.push({ kind: 'MODIFIED', nodeId: paragraphId });
    ctx.diff.push({ kind: 'ADDED', nodeId: restored.paragraphId });
    // MERGE가 남긴 "right → left" 재사상을 되돌린다(§1.8-2 alias 이력의 무효화).
    ctx.aliasRemovals.push({
      from: restored.paragraphId,
      to: paragraphId,
      offsetDelta: readNumber(payload, 'offset') ?? 0,
    });
    return {
      before: {
        kind: 'SPLIT',
        leftId: paragraphId,
        rightId: restored.paragraphId,
        leftRunsBefore: source.runs,
      },
      violations: [],
    };
  }

  // 일반 분할. offset은 이미 SelectionResolver가 스냅한 값이거나 payload 값이다.
  const clamped = Math.max(0, Math.min(offset, paragraphTextOf(source).length));
  const leftRuns: RunIR[] = [];
  const rightRuns: RunIR[] = [];
  let cursor = 0;
  for (const run of source.runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    if (runEnd <= clamped) {
      leftRuns.push(run);
      continue;
    }
    if (runStart >= clamped) {
      rightRuns.push(run);
      continue;
    }
    const cut = clamped - runStart;
    leftRuns.push({ ...run, text: run.text.slice(0, cut) });
    rightRuns.push({
      runId: ctx.issuer.issue('R', op.order),
      text: run.text.slice(cut),
      charPrId: run.charPrId,
      // 컨트롤 앵커는 잘린 run 양쪽 중 **왼쪽**에 남긴다. 어느 쪽 문자에
      // 붙어 있었는지 IR이 모르므로, 복제해서 두 벌이 되는 것보다 낫다.
      controls: [],
    });
  }
  if (rightRuns.length === 0) {
    rightRuns.push({
      runId: ctx.issuer.issue('R', op.order),
      text: '',
      charPrId: source.styleRef.charPrId,
      controls: [],
    });
  }
  const rightId = ctx.issuer.issue('P', op.order);
  const right: ParagraphBlock = {
    kind: 'PARAGRAPH',
    paragraphId: rightId,
    runs: rightRuns,
    // §1.9 "동일 Prototype 상속".
    styleRef: source.styleRef,
    editState: { editedByUser: ctx.origin === 'USER', locked: false },
    origin: 'AUTHORED',
    anchorHint: { relation: 'AFTER', ref: paragraphId },
    ...(source.styleRole === undefined ? {} : { styleRole: source.styleRole }),
    ...(source.outlineLevel === undefined ? {} : { outlineLevel: source.outlineLevel }),
    ...(source.prototypeId === undefined ? {} : { prototypeId: source.prototypeId }),
  };
  const next = replaceBlock(ctx.ir, paragraphId, [{ ...source, runs: leftRuns }, right]);
  if (!next)
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '분할 실패', paragraphId, op.order)],
    };
  ctx.ir = next;
  ctx.diff.push({ kind: 'MODIFIED', nodeId: paragraphId });
  ctx.diff.push({ kind: 'ADDED', nodeId: rightId });
  return {
    before: { kind: 'SPLIT', leftId: paragraphId, rightId, leftRunsBefore: source.runs },
    violations: [],
  };
}

function applyMergeParagraphs(ctx: Ctx, op: ChangeOperation): OpOutcome {
  const payload = asRecord(op.payload);
  const leftId = readString(payload, 'leftId') as string;
  const rightId = readString(payload, 'rightId') as string;
  const violations: ChangeViolation[] = [];
  checkEditable(ctx, leftId, op.order, violations);
  checkEditable(ctx, rightId, op.order, violations);
  if (violations.length > 0) return { before: null, violations };

  const leftEntry = ctx.index.blocks.get(leftId);
  const rightEntry = ctx.index.blocks.get(rightId);
  if (
    !leftEntry ||
    !rightEntry ||
    leftEntry.block.kind !== 'PARAGRAPH' ||
    rightEntry.block.kind !== 'PARAGRAPH'
  ) {
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '병합 대상이 문단이 아닙니다', rightId, op.order)],
    };
  }
  if (
    leftEntry.containerId !== rightEntry.containerId ||
    rightEntry.index !== leftEntry.index + 1
  ) {
    return {
      before: null,
      violations: [
        violation('TABLE_BOUNDARY', '이웃한 두 문단만 병합할 수 있습니다', rightId, op.order),
      ],
    };
  }
  const left = leftEntry.block;
  const right = rightEntry.block;
  // §1.9 "호환 Style 검사". 문단 모양과 스타일이 다르면 병합 결과의 서식이
  // 어느 쪽인지 정의되지 않는다 — 조용히 한쪽을 버리지 않고 거부한다.
  if (
    left.styleRef.paraPrId !== right.styleRef.paraPrId ||
    left.styleRef.styleId !== right.styleRef.styleId
  ) {
    return {
      before: null,
      violations: [
        violation(
          'INCOMPATIBLE_STYLE',
          `문단 모양이 다릅니다(paraPr ${String(left.styleRef.paraPrId)}≠${String(right.styleRef.paraPrId)})`,
          rightId,
          op.order,
        ),
      ],
    };
  }
  const offset = paragraphTextOf(left).length;
  const before: BeforeImage = {
    kind: 'MERGE',
    leftId,
    right,
    leftRunCount: left.runs.length,
    offset,
  };
  // 역 MERGE(=SPLIT 취소)는 분할 전 run 목록을 그대로 복원한다. 이어 붙이기만
  // 하면 쪼개졌던 run이 둘로 남는다(inverse-ops.ts의 leftRunsBefore 주석 참조).
  const restoreRuns = payload.restoreRuns;
  const mergedRuns = Array.isArray(restoreRuns)
    ? (restoreRuns as RunIR[])
    : [...left.runs, ...right.runs];
  const merged: BlockIR = { ...left, runs: mergedRuns };
  const replaced = replaceBlock(ctx.ir, leftId, [merged]);
  if (!replaced)
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '병합 실패', leftId, op.order)],
    };
  ctx.ir = removeBlocks(replaced, new Set([rightId])).ir;
  ctx.aliases.push({ from: rightId, to: leftId, offsetDelta: offset });
  ctx.diff.push({ kind: 'MODIFIED', nodeId: leftId });
  ctx.diff.push({ kind: 'REMOVED', nodeId: rightId });
  return { before, violations: [] };
}

function applyMoveBlock(ctx: Ctx, op: ChangeOperation): OpOutcome {
  const payload = asRecord(op.payload);
  const targetId = readString(payload, 'blockId') as string;
  const anchor = op.anchor as BlockAnchor;
  const violations: ChangeViolation[] = [];
  checkEditable(ctx, targetId, op.order, violations);
  checkEditable(ctx, anchor.ref, op.order, violations);
  if (violations.length > 0) return { before: null, violations };
  if (anchor.ref === targetId) {
    return {
      before: null,
      violations: [
        violation(
          'UNSUPPORTED_OPERATION',
          '자기 자신을 기준으로 이동할 수 없습니다',
          targetId,
          op.order,
        ),
      ],
    };
  }
  const entry = ctx.index.blocks.get(targetId);
  if (!entry) {
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '이동할 블록이 없습니다', targetId, op.order)],
    };
  }
  // 표를 자기 셀 안으로 옮기는 것(순환) 차단.
  const anchorEntry = ctx.index.blocks.get(anchor.ref) ?? null;
  const anchorCell = ctx.index.cells.get(anchor.ref) ?? null;
  const anchorTableId = anchorEntry ? anchorEntry.tableId : anchorCell ? anchorCell.tableId : null;
  if (entry.block.kind === 'TABLE' && anchorTableId === entry.block.tableId) {
    return {
      before: null,
      violations: [
        violation(
          'UNSUPPORTED_OPERATION',
          '표를 자기 자신 안으로 옮길 수 없습니다',
          targetId,
          op.order,
        ),
      ],
    };
  }
  const origin = anchorOfPosition(ctx.index, targetId) as BlockAnchor;
  const removedIr = removeBlocks(ctx.ir, new Set([targetId])).ir;
  const next = insertAt(removedIr, anchor, [entry.block]);
  if (!next) {
    return {
      before: null,
      violations: [
        violation('NODE_NOT_FOUND', '이동 대상 자리를 찾지 못했습니다', anchor.ref, op.order),
      ],
    };
  }
  ctx.ir = next;
  ctx.diff.push({ kind: 'MOVED', nodeId: targetId });
  return { before: { kind: 'MOVED', blockId: targetId, anchor: origin }, violations: [] };
}

function applyStyleRole(ctx: Ctx, op: ChangeOperation): OpOutcome {
  const payload = asRecord(op.payload);
  const targetId = readString(payload, 'blockId') as string;
  const violations: ChangeViolation[] = [];
  checkEditable(ctx, targetId, op.order, violations);
  if (violations.length > 0) return { before: null, violations };
  const entry = ctx.index.blocks.get(targetId);
  if (!entry || entry.block.kind !== 'PARAGRAPH') {
    return {
      before: null,
      violations: [
        violation('UNSUPPORTED_OPERATION', '역할은 문단에만 적용합니다', targetId, op.order),
      ],
    };
  }
  const paragraph = entry.block;
  const before: BeforeImage = {
    kind: 'ROLE',
    blockId: targetId,
    ...(paragraph.styleRole === undefined ? {} : { styleRole: paragraph.styleRole }),
    ...(paragraph.outlineLevel === undefined ? {} : { outlineLevel: paragraph.outlineLevel }),
    ...(paragraph.prototypeId === undefined ? {} : { prototypeId: paragraph.prototypeId }),
  };

  const restore = payload.restore === undefined ? null : asRecord(payload.restore);
  let updated: ParagraphIR;
  if (restore) {
    const role = readString(restore, 'styleRole');
    const level = readNumber(restore, 'outlineLevel');
    const prototypeId = readString(restore, 'prototypeId');
    updated = {
      ...stripRole(paragraph),
      ...(role === null ? {} : { styleRole: role }),
      ...(level === null ? {} : { outlineLevel: level }),
      ...(prototypeId === null ? {} : { prototypeId }),
    };
  } else {
    const role = readString(payload, 'styleRole');
    if (role === null) {
      updated = stripRole(paragraph);
    } else {
      const level = readNumber(payload, 'outlineLevel');
      const seed = resolveSeed({
        prototypes: ctx.prototypes,
        index: ctx.index,
        styleRole: role,
        outlineLevel: level,
        tableContext: entry.cellId !== null,
      });
      if (seed.warning) ctx.warnings.push(seed.warning);
      // §1.9 "직접 styleId 설정 금지" — `styleRef`는 건드리지 않는다. 실제 서식은
      // CC-160이 prototypeId로 원본 XML 조각을 복제해 적용한다(§1.7 CLONE_XML).
      updated = {
        ...stripRole(paragraph),
        styleRole: role,
        ...(level === null ? {} : { outlineLevel: level }),
        prototypeId: seed.prototypeId,
      };
    }
  }
  const next = replaceBlock(ctx.ir, targetId, [{ kind: 'PARAGRAPH', ...updated }]);
  if (!next)
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '역할 적용 실패', targetId, op.order)],
    };
  ctx.ir = next;
  ctx.diff.push({ kind: 'MODIFIED', nodeId: targetId });
  return { before, violations: [] };
}

function stripRole(paragraph: ParagraphIR): ParagraphIR {
  const copy = { ...paragraph } as Record<string, unknown>;
  delete copy.styleRole;
  delete copy.outlineLevel;
  delete copy.prototypeId;
  return copy as unknown as ParagraphIR;
}

function applyTablePatch(ctx: Ctx, op: ChangeOperation): OpOutcome {
  const payload = asRecord(op.payload);
  const tableId = readString(payload, 'tableId') as string;
  const cellOps = (payload.cellOps as unknown[]).map(asRecord);
  const violations: ChangeViolation[] = [];
  checkEditable(ctx, tableId, op.order, violations);
  const tableEntry = ctx.index.blocks.get(tableId);
  if (!tableEntry || tableEntry.block.kind !== 'TABLE') {
    return {
      before: null,
      violations: [violation('NODE_NOT_FOUND', '표를 찾지 못했습니다', tableId, op.order)],
    };
  }
  const touched: Array<{
    cellId: string;
    rowSpan: number;
    colSpan: number;
    blocks: readonly BlockIR[];
  }> = [];
  const patches = new Map<string, Record<string, unknown>>();
  for (const cellOp of cellOps) {
    const cellId = readString(cellOp, 'cellId');
    if (cellId === null) {
      violations.push(violation('UNSUPPORTED_OPERATION', 'cellId가 없습니다', undefined, op.order));
      continue;
    }
    const cellEntry = ctx.index.cells.get(cellId);
    if (!cellEntry || cellEntry.tableId !== tableId) {
      violations.push(
        violation('TABLE_BOUNDARY', '셀이 이 표에 속하지 않습니다', cellId, op.order),
      );
      continue;
    }
    const kind = readString(cellOp, 'kind') ?? 'SET_TEXT';
    if (kind === 'SET_SPAN') {
      const rowSpan = readNumber(cellOp, 'rowSpan') ?? cellEntry.cell.rowSpan;
      const colSpan = readNumber(cellOp, 'colSpan') ?? cellEntry.cell.colSpan;
      if (rowSpan < 1 || colSpan < 1) {
        violations.push(
          violation('TABLE_BOUNDARY', 'span은 1 이상이어야 합니다', cellId, op.order),
        );
        continue;
      }
    }
    if (kind === 'SET_TEXT') {
      const hasParagraph = cellEntry.cell.blocks.some((block) => block.kind === 'PARAGRAPH');
      if (!hasParagraph) {
        violations.push(
          violation('CELL_MIN_ONE_PARAGRAPH', '셀에 문단이 없습니다', cellId, op.order),
        );
        continue;
      }
    }
    touched.push({
      cellId,
      rowSpan: cellEntry.cell.rowSpan,
      colSpan: cellEntry.cell.colSpan,
      blocks: cellEntry.cell.blocks,
    });
    patches.set(cellId, { ...cellOp, kind });
  }
  if (violations.length > 0) return { before: null, violations };

  const next = mapCells(ctx.ir, (cell) => {
    const patch = patches.get(cell.cellId);
    if (!patch) return cell;
    const kind = readString(patch, 'kind') ?? 'SET_TEXT';
    if (kind === 'SET_SPAN') {
      return {
        ...cell,
        rowSpan: readNumber(patch, 'rowSpan') ?? cell.rowSpan,
        colSpan: readNumber(patch, 'colSpan') ?? cell.colSpan,
      };
    }
    if (kind === 'RESTORE') {
      const restore = asRecord(patch.restore);
      return {
        ...cell,
        rowSpan: readNumber(restore, 'rowSpan') ?? cell.rowSpan,
        colSpan: readNumber(restore, 'colSpan') ?? cell.colSpan,
        blocks: (restore.blocks as BlockIR[] | undefined) ?? cell.blocks,
      };
    }
    if (kind === 'CLEAR') {
      // 셀은 항상 최소 1문단을 유지한다(I6). 비우기는 "문단을 지우는 것"이
      // 아니라 "문단의 내용을 비우는 것"이다.
      return { ...cell, blocks: clearCellText(cell) };
    }
    const text = readString(patch, 'text') ?? '';
    return { ...cell, blocks: setCellText(cell, text) };
  });
  ctx.ir = next;
  ctx.diff.push({ kind: 'MODIFIED', nodeId: tableId });
  return { before: { kind: 'CELLS', tableId, cells: touched }, violations: [] };
}

function setCellText(cell: TableCellIR, text: string): BlockIR[] {
  let done = false;
  return cell.blocks.map((block) => {
    if (done || block.kind !== 'PARAGRAPH') return block;
    done = true;
    // 첫 run에만 텍스트를 넣고 나머지는 비운다. run을 지우지 않으므로 runId와
    // controls 앵커가 살아남는다.
    return {
      ...block,
      runs: block.runs.map((run, i) => ({ ...run, text: i === 0 ? text : '' })),
    };
  });
}

function clearCellText(cell: TableCellIR): BlockIR[] {
  return cell.blocks.map((block) =>
    block.kind === 'PARAGRAPH'
      ? { ...block, runs: block.runs.map((run) => ({ ...run, text: '' })) }
      : block,
  );
}

// ---------------------------------------------------------------------------
// rebuildIndexesAndReferences

function rebuildIndexesAndReferences(ir: DocumentIR): {
  readonly ir: DocumentIR;
  readonly violations: readonly ChangeViolation[];
} {
  const normalized = normalizeAnchorHints(ir);
  const index = indexDocument(normalized);
  const violations: ChangeViolation[] = [];

  // `DocumentIndex.allIds`는 Set이라 중복을 감춘다. I1은 **목록으로** 다시 센다.
  const counts = new Map<string, number>();
  const bump = (id: string): void => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  for (const section of normalized.sections) {
    bump(section.sectionId);
    const walk = (blocks: readonly BlockIR[]): void => {
      for (const block of blocks) {
        bump(blockId(block));
        if (block.kind === 'PARAGRAPH') {
          for (const run of block.runs) bump(run.runId);
        } else if (block.kind === 'TABLE') {
          for (const row of block.rows) {
            bump(row.rowId);
            for (const cell of row.cells) {
              bump(cell.cellId);
              if (cell.rowSpan < 1 || cell.colSpan < 1) {
                violations.push(violation('TABLE_BOUNDARY', 'span이 1 미만입니다', cell.cellId));
              }
              if (!cell.blocks.some((inner) => inner.kind === 'PARAGRAPH')) {
                violations.push(
                  violation(
                    'CELL_MIN_ONE_PARAGRAPH',
                    '셀에 문단이 하나도 남지 않았습니다',
                    cell.cellId,
                  ),
                );
              }
              walk(cell.blocks);
            }
          }
        }
      }
    };
    walk(section.blocks);
  }
  for (const [id, count] of counts) {
    if (count > 1)
      violations.push(violation('UNSUPPORTED_OPERATION', `ID가 중복되었습니다(${count}회)`, id));
  }

  // 신규 노드의 스타일 참조가 실제 색인에 있는지 확인한다. 기존 노드는 검사하지
  // 않는다 — 원본이 이미 깨진 문서(HWPX-1005)를 편집 불가로 만들지 않기 위해서다.
  const paraPrIds = new Set(normalized.styleIndex.paraPr.map((entry) => entry.id));
  const charPrIds = new Set(normalized.styleIndex.charPr.map((entry) => entry.id));
  for (const entry of index.blocks.values()) {
    const block = entry.block;
    if (block.kind !== 'PARAGRAPH' || block.origin !== 'AUTHORED') continue;
    if (block.styleRef.paraPrId !== null && !paraPrIds.has(block.styleRef.paraPrId)) {
      violations.push(
        violation(
          'UNSUPPORTED_OPERATION',
          `신규 문단의 paraPrId=${block.styleRef.paraPrId}가 색인에 없습니다`,
          block.paragraphId,
        ),
      );
    }
    if (block.styleRef.charPrId !== null && !charPrIds.has(block.styleRef.charPrId)) {
      violations.push(
        violation(
          'UNSUPPORTED_OPERATION',
          `신규 문단의 charPrId=${block.styleRef.charPrId}가 색인에 없습니다`,
          block.paragraphId,
        ),
      );
    }
  }

  return { ir: normalized, violations };
}

// ---------------------------------------------------------------------------
// apply

const APPLIERS: Readonly<Record<string, (ctx: Ctx, op: ChangeOperation) => OpOutcome>> = {
  INSERT_BLOCKS: applyInsertBlocks,
  REPLACE_RANGE: applyReplaceRange,
  DELETE_RANGE: applyDeleteRange,
  SPLIT_PARAGRAPH: applySplitParagraph,
  MERGE_PARAGRAPHS: applyMergeParagraphs,
  MOVE_BLOCK: applyMoveBlock,
  APPLY_STYLE_ROLE: applyStyleRole,
  TABLE_PATCH: applyTablePatch,
};

export function applyChangeSet(input: ApplyChangeSetInput): ApplyChangeSetResult {
  // validateSchema()
  const schemaViolations = validateSchema(input.request);
  if (schemaViolations.length > 0) return { ok: false, violations: schemaViolations };

  // checkBaseRevision()
  if (input.request.baseRevisionId !== input.currentRevisionId) {
    return {
      ok: false,
      violations: [
        violation(
          'UNDO_CONFLICT',
          `baseRevisionId(${input.request.baseRevisionId})가 현재 개정(${input.currentRevisionId})과 다릅니다`,
        ),
      ],
    };
  }

  const initialIndex = indexDocument(input.ir);
  const ctx: Ctx = {
    ir: input.ir,
    index: initialIndex,
    // 충돌 검사 기준은 **적용 전 문서 전체 ID 집합**이다. 적용 중에 발급된 ID는
    // issuer 자신이 따로 기억한다(§1.10-2의 "문서 전체 ID Index").
    issuer: new AuthoredIdIssuer(initialIndex.allIds, input.changeSetId),
    prototypes: input.prototypes ?? [],
    staticRegions: input.staticRegionAnchors ?? [],
    aliases: [...(input.aliases ?? [])],
    aliasRemovals: [],
    diff: [],
    warnings: [],
    origin: input.request.origin,
    baseRevisionId: input.request.baseRevisionId,
    generatedBlocks: input.generatedBlocks ?? null,
  };
  const priorAliasCount = ctx.aliases.length;

  // applyOperationsInOrder()
  const befores: BeforeImage[] = [];
  const ordered = [...input.request.operations].sort((a, b) => a.order - b.order);
  try {
    for (const op of ordered) {
      ctx.index = indexDocument(ctx.ir);
      const outcome = APPLIERS[op.type](ctx, op);
      if (outcome.violations.length > 0) return { ok: false, violations: outcome.violations };
      if (outcome.before) befores.push(outcome.before);
    }
  } catch (error) {
    if (error instanceof AuthoredIdCollisionError) {
      // 조용한 재발급은 추적을 깬다(authored-id.ts 참조). 전용 사유로 끝낸다 —
      // `UNSUPPORTED_OPERATION`으로 뭉개면 "연산이 잘못됐다"와 "ID 공간이
      // 오염됐다"가 같은 코드로 나가 운영에서 원인을 가릴 수 없다.
      return {
        ok: false,
        violations: [violation('ID_COLLISION', error.message, error.id, error.opOrder)],
      };
    }
    throw error;
  }

  // rebuildIndexesAndReferences()
  const rebuilt = rebuildIndexesAndReferences(ctx.ir);
  if (rebuilt.violations.length > 0) return { ok: false, violations: rebuilt.violations };

  // generateInverseOperations() + incrementRevision()
  //   개정 번호 자체는 DB(`document_revision.revision_no`)의 것이므로 여기서는
  //   내용 해시만 계산한다 — "이 개정이 실제로 뭔가 바꿨나"의 답이 그 해시다.
  return {
    ok: true,
    ir: rebuilt.ir,
    irHash: documentIrHash(rebuilt.ir),
    diff: ctx.diff,
    inverseOperations: invertOperations(befores),
    aliases: ctx.aliases.slice(priorAliasCount),
    aliasRemovals: ctx.aliasRemovals,
    warnings: ctx.warnings,
    dryRun: input.request.dryRun === true,
  };
}
