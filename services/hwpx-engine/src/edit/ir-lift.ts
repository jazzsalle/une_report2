import type { BlockIR, DocumentIR, SectionIR } from '@une/domain';

/**
 * IR 읽기 경로의 방어적 정규화 (CC-150, ADR-30 D3).
 *
 * ## 타입은 도메인이 정본이다
 *
 * `NodeOrigin`/`NodeProvenance`/`ParagraphIR`/`TableIR`/`PreservedBlockIR`는
 * 전부 `@une/domain`에 있다(ADR-29 D4). 엔진은 그 타입을 **소비만** 하며 여기서
 * 재정의하지 않는다. 이 파일에 남은 것은 두 가지뿐이다:
 *
 *   1. 판별 유니온에서 한 갈래를 꺼내는 **파생 별칭**(재정의가 아니다).
 *   2. v1로 영속된 `ir_json`을 v2로 올리는 **읽기 경로 정규화**.
 *
 * ## 왜 `liftV1`이 아직 있는가
 *
 * `ir-builder`는 이제 v2를 직접 낸다. 그래도 이 함수를 지우지 않는 이유는
 * 도메인 `DocumentIR.irVersion`이 `'1' | '2'`이기 때문이다 — 즉 v1은 타입상
 * **여전히 표현 가능한 상태**이고, v1로 적힌 `ir_json` 행을 읽는 코드가 생기면
 * 그 행에는 `origin`이 없다. 그때 필요한 것은 "어딘가에서 조용히 기본값을 넣는
 * 것"이 아니라 **한 지점의 명시적 승격**이다(ADR-30: v1 rows are lifted on read).
 *
 * ## AUTHORED 노드는 왜 여기서 안 다루는가
 *
 * v1에는 AUTHORED가 존재할 수 없다. v1은 편집 이전의 읽기 전용 표현이고,
 * 편집이 만든 노드는 v2에서만 생긴다. 그래서 승격은 `origin: 'SOURCE'` 한 방향뿐
 * 이며 `anchorHint`를 지어낼 일이 없다.
 */

/** 판별 유니온에서 한 갈래만 꺼낸 파생 별칭. 재정의가 아니다. */
export type ParagraphBlock = Extract<BlockIR, { kind: 'PARAGRAPH' }>;
export type TableBlock = Extract<BlockIR, { kind: 'TABLE' }>;
export type PreservedBlock = Extract<BlockIR, { kind: 'PRESERVED' }>;

/** 블록의 안정 ID. 종류에 상관없이 한 함수로 얻는다. */
export function blockId(block: BlockIR): string {
  switch (block.kind) {
    case 'PARAGRAPH':
      return block.paragraphId;
    case 'TABLE':
      return block.tableId;
    default:
      return block.preservedId;
  }
}

/**
 * v1로 적힌 IR을 v2로 올린다. **순수 함수이며 하는 일은 `origin: 'SOURCE'`
 * 주입뿐**이다.
 *
 * 값을 하나도 바꾸지 않는 것이 요점이다: ID·앵커·텍스트가 그대로 살아 있어야
 * `document_revision.ir_hash`가 "이 개정이 실제로 뭔가 바꿨나"에 계속 답할 수
 * 있다. 이미 v2면 그대로 돌려준다(멱등).
 */
export function liftV1(ir: DocumentIR): DocumentIR {
  if (ir.irVersion === '2') return ir;
  return { ...ir, irVersion: '2', sections: ir.sections.map(liftSection) };
}

function liftSection(section: SectionIR): SectionIR {
  return { ...section, blocks: section.blocks.map(liftBlock) };
}

function liftBlock(block: BlockIR): BlockIR {
  if (block.kind === 'TABLE') {
    return {
      ...block,
      origin: 'SOURCE',
      rows: block.rows.map((row) => ({
        ...row,
        cells: row.cells.map((cell) => ({ ...cell, blocks: cell.blocks.map(liftBlock) })),
      })),
    } as BlockIR;
  }
  // v1 노드는 정의상 전부 원본 XML에서 왔다. `rawXmlAnchor`는 v1에서도 필수였으므로
  // 그대로 살아 있고, 여기서 새로 만드는 값은 `origin` 하나뿐이다.
  return { ...block, origin: 'SOURCE' } as BlockIR;
}
