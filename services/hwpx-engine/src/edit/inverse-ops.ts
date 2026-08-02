import type { BlockAnchor, BlockIR, ChangeOperation, ParagraphIR, RunIR } from '@une/domain';

/**
 * 역연산 도출 (설계 07 §1.9 generateInverseOperations).
 *
 * ## 별도 컬럼이 아니라 도출이다
 *
 * 역연산은 `(operation_type, target, before)` 세 값에서 **결정적으로** 나온다.
 * "역연산을 따로 적어 두는" 설계는 두 벌의 진실을 만들고, 둘이 어긋나면 Undo가
 * 조용히 다른 노드를 건드린다. 여기서는 적용 시점에 찍은 before 이미지 하나만
 * 남기고 역연산은 그때그때 계산한다.
 *
 * ## 적용 순서 규약
 *
 * `invertOperations()`가 돌려주는 배열은 **오름차순 `order`로 그대로 적용하면
 * 원 ChangeSet이 취소되도록** 이미 뒤집혀 있다(원 연산 N개의 역순 + 한 연산이
 * 여러 역연산을 내는 경우 그 안에서도 복원 가능한 순서). 도메인
 * `ChangeOperation.order` 주석의 "inverse set applies in reverse"는 *원 연산과
 * 역집합의 관계*를 말한 것으로 읽는다 — 소비자(API)가 역집합을 평범한
 * ChangeSet으로 그대로 제출할 수 있어야 Undo 경로에 특수 규칙이 생기지 않는다.
 *
 * ## baseRevisionId 센티널
 *
 * 역연산이 품은 `SelectionEnvelope`는 **아직 존재하지 않는 개정**을 기준으로
 * 한다(역연산은 원 ChangeSet이 만든 개정 위에서 실행된다). 그 자리에 원
 * baseRevisionId를 적으면 §1.8-1 검사가 항상 실패하고, 빈 문자열을 적으면
 * "검사를 건너뛴 선택"과 구별되지 않는다. 그래서 명시적 센티널을 쓰고,
 * 실행기가 요청의 baseRevisionId로 **치환**한다(치환 대상이 센티널일 때만).
 */
export const INVERSE_SELECTION_BASE = '(inverse-base-revision)';

/** 삭제·이동된 블록이 원래 있던 자리. 되돌릴 때 그대로 앵커로 쓴다. */
export interface RemovedBlock {
  readonly block: BlockIR;
  readonly anchor: BlockAnchor;
}

export type BeforeImage =
  | { readonly kind: 'INSERTED'; readonly ids: readonly string[] }
  | { readonly kind: 'BLOCKS_REMOVED'; readonly removed: readonly RemovedBlock[] }
  | {
      readonly kind: 'BLOCKS_REPLACED';
      readonly newIds: readonly string[];
      readonly removed: readonly RemovedBlock[];
    }
  | {
      readonly kind: 'PARAGRAPH_RUNS';
      readonly paragraphId: string;
      readonly runs: readonly RunIR[];
    }
  | {
      readonly kind: 'SPLIT';
      readonly leftId: string;
      readonly rightId: string;
      /**
       * 분할 **전** 문단의 run 목록.
       *
       * 분할이 run 한가운데를 자르면 run이 둘로 쪼개진다(왼쪽은 원래 runId,
       * 오른쪽은 새 runId). 되돌리는 MERGE는 두 문단의 run 목록을 이어 붙일 뿐
       * **쪼개진 run을 다시 붙이지 못한다** — 그러면 문단 텍스트는 같은데 run
       * 구성이 달라 `documentIrHash`가 어긋난다(그리고 CC-160이 원본 XML의
       * `hp:run` 하나를 둘로 쓰게 된다). 그래서 before 이미지에 원래 run 목록을
       * 담고, 역 MERGE가 그것으로 복원한다.
       */
      readonly leftRunsBefore: readonly RunIR[];
    }
  | {
      readonly kind: 'MERGE';
      readonly leftId: string;
      readonly right: ParagraphIR;
      readonly leftRunCount: number;
      readonly offset: number;
    }
  | { readonly kind: 'MOVED'; readonly blockId: string; readonly anchor: BlockAnchor }
  | {
      readonly kind: 'ROLE';
      readonly blockId: string;
      readonly styleRole?: string;
      readonly outlineLevel?: number;
      readonly prototypeId?: string;
    }
  | {
      readonly kind: 'CELLS';
      readonly tableId: string;
      readonly cells: readonly {
        readonly cellId: string;
        readonly rowSpan: number;
        readonly colSpan: number;
        readonly blocks: readonly BlockIR[];
      }[];
    };

function blockSelection(ids: readonly string[]): ChangeOperation['selection'] {
  return { kind: 'BLOCK', baseRevisionId: INVERSE_SELECTION_BASE, blockIds: [...ids] };
}

/**
 * before 이미지 하나를 역연산 0..n개로 바꾼다.
 *
 * §1.9 표의 짝을 그대로 따른다:
 *   INSERT_BLOCKS ↔ DELETE_RANGE, REPLACE_RANGE ↔ REPLACE_RANGE(before),
 *   DELETE_RANGE ↔ INSERT_BLOCKS(before + anchorHint), SPLIT ↔ MERGE,
 *   MERGE ↔ SPLIT(offset은 before에 기록), MOVE ↔ MOVE(before 위치),
 *   APPLY_STYLE_ROLE ↔ APPLY_STYLE_ROLE(before 역할),
 *   TABLE_PATCH ↔ TABLE_PATCH(before 셀 상태).
 */
export function invertBefore(before: BeforeImage): ChangeOperation[] {
  switch (before.kind) {
    case 'INSERTED':
      return before.ids.length === 0
        ? []
        : [{ type: 'DELETE_RANGE', order: 0, selection: blockSelection(before.ids) }];

    case 'BLOCKS_REMOVED':
      // 되돌릴 때는 **원래 위치가 앞쪽인 것부터** 넣어야 뒤쪽 블록의 기준 노드가
      // 이미 존재한다. removed는 문서 순서로 모아 두므로 그대로 쓴다.
      return before.removed.map((entry, i) => ({
        type: 'INSERT_BLOCKS',
        order: i,
        anchor: entry.anchor,
        source: { kind: 'INLINE', blocks: [{ restore: entry.block }] },
      }));

    case 'BLOCKS_REPLACED':
      return [
        {
          type: 'REPLACE_RANGE',
          order: 0,
          selection: blockSelection(before.newIds),
          source: {
            kind: 'INLINE',
            blocks: before.removed.map((entry) => ({ restore: entry.block })),
          },
        },
      ];

    case 'PARAGRAPH_RUNS':
      return [
        {
          type: 'REPLACE_RANGE',
          order: 0,
          selection: {
            kind: 'CURSOR',
            baseRevisionId: INVERSE_SELECTION_BASE,
            at: { paragraphId: before.paragraphId, offset: 0 },
          },
          payload: { restoreRuns: [...before.runs] },
        },
      ];

    case 'SPLIT':
      return [
        {
          type: 'MERGE_PARAGRAPHS',
          order: 0,
          payload: {
            leftId: before.leftId,
            rightId: before.rightId,
            restoreRuns: [...before.leftRunsBefore],
          },
        },
      ];

    case 'MERGE':
      return [
        {
          type: 'SPLIT_PARAGRAPH',
          order: 0,
          payload: {
            paragraphId: before.leftId,
            offset: before.offset,
            restore: { rightParagraph: before.right, leftRunCount: before.leftRunCount },
          },
        },
      ];

    case 'MOVED':
      return [
        {
          type: 'MOVE_BLOCK',
          order: 0,
          anchor: before.anchor,
          payload: { blockId: before.blockId },
        },
      ];

    case 'ROLE':
      return [
        {
          type: 'APPLY_STYLE_ROLE',
          order: 0,
          payload: {
            blockId: before.blockId,
            // 역할이 없던 상태로 되돌리는 것도 표현할 수 있어야 한다.
            styleRole: before.styleRole ?? null,
            restore: {
              ...(before.styleRole === undefined ? {} : { styleRole: before.styleRole }),
              ...(before.outlineLevel === undefined ? {} : { outlineLevel: before.outlineLevel }),
              ...(before.prototypeId === undefined ? {} : { prototypeId: before.prototypeId }),
            },
          },
        },
      ];

    default:
      return [
        {
          type: 'TABLE_PATCH',
          order: 0,
          payload: {
            tableId: before.tableId,
            cellOps: before.cells.map((cell) => ({
              cellId: cell.cellId,
              kind: 'RESTORE',
              restore: { rowSpan: cell.rowSpan, colSpan: cell.colSpan, blocks: cell.blocks },
            })),
          },
        },
      ];
  }
}

/**
 * 원 ChangeSet 전체의 before 이미지 목록을 역 ChangeSet으로 만든다.
 * 원 연산 순서의 **역순**으로 펼치고 `order`를 0부터 다시 매긴다.
 */
export function invertOperations(befores: readonly BeforeImage[]): ChangeOperation[] {
  const out: ChangeOperation[] = [];
  for (let i = befores.length - 1; i >= 0; i -= 1) {
    for (const op of invertBefore(befores[i])) out.push({ ...op, order: out.length });
  }
  return out;
}
