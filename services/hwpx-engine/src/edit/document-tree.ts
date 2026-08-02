import type { BlockAnchor, BlockIR, DocumentIR, TableCellIR } from '@une/domain';
import { blockId } from './ir-lift';

/**
 * IR 트리의 **불변 변형 기본연산** (CC-150).
 *
 * ## 원자성을 자료구조로 보장한다
 *
 * 설계 07 §1.9는 "on error: rollback() + no partial document mutation"을 요구한다.
 * 여기서는 그것을 트랜잭션이 아니라 **자료구조**로 만든다: 모든 함수가 입력
 * IR을 건드리지 않고 새 IR을 돌려주므로, 중간에 실패하면 호출자는 그냥 새
 * IR을 버리면 된다. "절반만 변형된 문서"는 표현 자체가 불가능하다.
 * (DB 트랜잭션 경계는 API 층 소관이다 — 엔진은 DB를 모른다.)
 *
 * ## 컨테이너
 *
 * 블록을 담을 수 있는 자리는 두 곳뿐이다: 섹션(`SectionIR.blocks`)과 표 셀
 * (`TableCellIR.blocks`). 그래서 삽입/삭제/이동은 전부 "어떤 컨테이너의 몇 번째"
 * 로 환원된다.
 */

export type ContainerKind = 'SECTION' | 'CELL';

export interface BlockEntry {
  readonly block: BlockIR;
  readonly containerId: string;
  readonly containerKind: ContainerKind;
  readonly index: number;
  readonly documentOrder: number;
  readonly sectionId: string;
  /** 가장 가까운 상위 표 셀. null이면 본문 최상위(표 경계 검사에 쓴다). */
  readonly cellId: string | null;
  /** 가장 가까운 상위 표. */
  readonly tableId: string | null;
}

export interface CellEntry {
  readonly cell: TableCellIR;
  readonly tableId: string;
  readonly rowId: string;
}

export interface DocumentIndex {
  /** 블록 ID → 위치. 문서 순서(깊이 우선)로 채워진다. */
  readonly blocks: ReadonlyMap<string, BlockEntry>;
  readonly cells: ReadonlyMap<string, CellEntry>;
  /** 컨테이너 ID(섹션/셀) → 그 안의 블록 목록. */
  readonly containers: ReadonlyMap<string, readonly BlockIR[]>;
  /** 문서 순서의 블록 ID 열. TEXT_RANGE의 "start..end 사이" 계산에 쓴다. */
  readonly documentOrder: readonly string[];
  /**
   * 문서가 쓰고 있는 **모든** 안정 ID(섹션·블록·행·셀·run).
   * 신규 ID 발급 충돌 검사(§1.10-2의 IR 층 선반영)의 기준 집합이다.
   */
  readonly allIds: ReadonlySet<string>;
}

export function indexDocument(ir: DocumentIR): DocumentIndex {
  const blocks = new Map<string, BlockEntry>();
  const cells = new Map<string, CellEntry>();
  const containers = new Map<string, readonly BlockIR[]>();
  const documentOrder: string[] = [];
  const allIds = new Set<string>();
  let order = 0;

  const visit = (
    list: readonly BlockIR[],
    containerId: string,
    containerKind: ContainerKind,
    sectionId: string,
    cellId: string | null,
    tableId: string | null,
  ): void => {
    containers.set(containerId, list);
    list.forEach((block, index) => {
      const id = blockId(block);
      allIds.add(id);
      blocks.set(id, {
        block,
        containerId,
        containerKind,
        index,
        documentOrder: order,
        sectionId,
        cellId,
        tableId,
      });
      documentOrder.push(id);
      order += 1;
      if (block.kind === 'PARAGRAPH') {
        for (const run of block.runs) allIds.add(run.runId);
        return;
      }
      if (block.kind !== 'TABLE') return;
      for (const row of block.rows) {
        allIds.add(row.rowId);
        for (const cell of row.cells) {
          allIds.add(cell.cellId);
          cells.set(cell.cellId, { cell, tableId: block.tableId, rowId: row.rowId });
          visit(cell.blocks, cell.cellId, 'CELL', sectionId, cell.cellId, block.tableId);
        }
      }
    });
  };

  for (const section of ir.sections) {
    allIds.add(section.sectionId);
    visit(section.blocks, section.sectionId, 'SECTION', section.sectionId, null, null);
  }

  return { blocks, cells, containers, documentOrder, allIds };
}

/**
 * 모든 컨테이너의 블록 목록을 `fn`으로 다시 쓴다.
 *
 * 컨테이너를 먼저 처리하고 **그 결과** 안의 표로 내려간다. 순서를 반대로 하면
 * 방금 삽입한 표의 셀을 놓친다.
 */
export function mapContainers(
  ir: DocumentIR,
  fn: (blocks: readonly BlockIR[], containerId: string, kind: ContainerKind) => readonly BlockIR[],
): DocumentIR {
  // 반환은 **가변 배열**이다. 도메인 `SectionIR.blocks`/`TableCellIR.blocks`가
  // 가변 배열이므로 여기서 readonly로 좁히면 대입이 막힌다. 불변성은 타입이
  // 아니라 "입력을 절대 건드리지 않고 새 배열만 만든다"는 이 함수의 계약이 지킨다.
  const rewriteList = (
    list: readonly BlockIR[],
    containerId: string,
    kind: ContainerKind,
  ): BlockIR[] => fn(list, containerId, kind).map(rewriteBlock);

  const rewriteBlock = (block: BlockIR): BlockIR => {
    if (block.kind !== 'TABLE') return block;
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({
          ...cell,
          blocks: rewriteList(cell.blocks, cell.cellId, 'CELL'),
        })),
      })),
    };
  };

  return {
    ...ir,
    sections: ir.sections.map((section) => ({
      ...section,
      blocks: rewriteList(section.blocks, section.sectionId, 'SECTION'),
    })),
  };
}

/** 모든 표 셀을 `fn`으로 다시 쓴다(span 등 셀 자체 속성 변경용). */
export function mapCells(
  ir: DocumentIR,
  fn: (cell: TableCellIR, tableId: string) => TableCellIR,
): DocumentIR {
  const rewriteBlock = (block: BlockIR): BlockIR => {
    if (block.kind !== 'TABLE') return block;
    return {
      ...block,
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => {
          const next = fn(cell, block.tableId);
          return { ...next, blocks: next.blocks.map(rewriteBlock) };
        }),
      })),
    };
  };
  return {
    ...ir,
    sections: ir.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map(rewriteBlock),
    })),
  };
}

/** 블록 하나를 다른 블록(0..n개)으로 치환한다. 대상이 없으면 `null`. */
export function replaceBlock(
  ir: DocumentIR,
  targetId: string,
  replacement: readonly BlockIR[],
): DocumentIR | null {
  let found = false;
  const next = mapContainers(ir, (blocks) => {
    if (!blocks.some((block) => blockId(block) === targetId)) return blocks;
    found = true;
    return blocks.flatMap((block) => (blockId(block) === targetId ? replacement : [block]));
  });
  return found ? next : null;
}

/** 여러 블록을 지운다. 지워진 개수를 함께 돌려준다. */
export function removeBlocks(
  ir: DocumentIR,
  targetIds: ReadonlySet<string>,
): { readonly ir: DocumentIR; readonly removed: number } {
  let removed = 0;
  const next = mapContainers(ir, (blocks) => {
    if (!blocks.some((block) => targetIds.has(blockId(block)))) return blocks;
    return blocks.filter((block) => {
      if (!targetIds.has(blockId(block))) return true;
      removed += 1;
      return false;
    });
  });
  return { ir: next, removed };
}

/**
 * 앵커가 지시하는 자리에 블록을 넣는다.
 *
 * - `BEFORE`/`AFTER`: `ref`는 **블록** ID.
 * - `FIRST_CHILD`/`LAST_CHILD`: `ref`는 **컨테이너**(섹션 또는 셀) ID.
 *
 * 대상 자리를 찾지 못하면 `null` — 호출자가 `NODE_NOT_FOUND` 위반으로 바꾼다.
 */
export function insertAt(
  ir: DocumentIR,
  anchor: BlockAnchor,
  incoming: readonly BlockIR[],
): DocumentIR | null {
  if (incoming.length === 0) return ir;
  let placed = false;

  if (anchor.relation === 'FIRST_CHILD' || anchor.relation === 'LAST_CHILD') {
    const next = mapContainers(ir, (blocks, containerId) => {
      if (containerId !== anchor.ref) return blocks;
      placed = true;
      return anchor.relation === 'FIRST_CHILD'
        ? [...incoming, ...blocks]
        : [...blocks, ...incoming];
    });
    return placed ? next : null;
  }

  const next = mapContainers(ir, (blocks) => {
    if (!blocks.some((block) => blockId(block) === anchor.ref)) return blocks;
    placed = true;
    return blocks.flatMap((block) =>
      blockId(block) === anchor.ref
        ? anchor.relation === 'BEFORE'
          ? [...incoming, block]
          : [block, ...incoming]
        : [block],
    );
  });
  return placed ? next : null;
}

/**
 * AUTHORED 노드의 `anchorHint`를 트리에서 **정규 재계산**한다.
 *
 * 힌트를 삽입 시점 값 그대로 들고 다니면, 기준 노드가 나중에 삭제·이동되었을 때
 * 조용히 거짓이 된다(CC-160이 없는 자리에 쓰려 한다). 여기서는 매 ChangeSet
 * 적용 끝에 "현재 트리에서의 실제 위치"로 덮어쓴다:
 *
 *   - 컨테이너의 첫 블록  → `{ FIRST_CHILD, ref: 컨테이너 ID }`
 *   - 그 외              → `{ AFTER, ref: 바로 앞 형제 ID }`
 *
 * 결과가 트리의 순수 함수이므로 `documentIrHash`의 결정성이 유지되고,
 * `invert ∘ apply == identity`도 구조가 같으면 힌트까지 같아진다.
 */
export function normalizeAnchorHints(ir: DocumentIR): DocumentIR {
  return mapContainers(ir, (blocks, containerId) =>
    blocks.map((block, index) => {
      if (block.kind === 'PRESERVED' || block.origin !== 'AUTHORED') return block;
      const anchorHint: BlockAnchor =
        index === 0
          ? { relation: 'FIRST_CHILD', ref: containerId }
          : { relation: 'AFTER', ref: blockId(blocks[index - 1]) };
      return { ...block, anchorHint };
    }),
  );
}

/**
 * **같은 컨테이너 안에서** 두 블록 사이(양끝 포함)의 블록 ID를 돌려준다.
 *
 * 문서 순서(`documentOrder`) 슬라이스를 쓰지 않는 이유: 문서 순서는 표 안의
 * 문단까지 평면화하므로, 표를 사이에 둔 두 문단을 슬라이스하면 **표 셀 내부
 * 문단이 선택에 딸려 들어온다**. 그것이 §1.8-3이 막으라고 한 표 경계 침범이다.
 * 컨테이너가 다르면 빈 배열을 돌려주고 호출자가 `TABLE_BOUNDARY`로 처리한다.
 */
export function blocksBetween(index: DocumentIndex, fromId: string, toId: string): string[] {
  const from = index.blocks.get(fromId);
  const to = index.blocks.get(toId);
  if (!from || !to) return [];
  if (from.containerId !== to.containerId) return [];
  const list = index.containers.get(from.containerId) ?? [];
  const [lo, hi] = from.index <= to.index ? [from.index, to.index] : [to.index, from.index];
  return list.slice(lo, hi + 1).map(blockId);
}
