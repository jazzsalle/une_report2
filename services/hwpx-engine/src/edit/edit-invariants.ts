import type { BlockIR, DocumentIR } from '@une/domain';
import { resolveAnchor } from '../ir/anchors';
import type { XmlElement } from '../package/xml';
import { blockId } from './ir-lift';

/**
 * 편집 후 불변식 (CC-150).
 *
 * CC-140의 `checkInvariants`(I1~I7)는 **패키지 분석 결과**를 입력으로 받으므로
 * 편집된 IR에는 그대로 쓸 수 없다(재빌드 비교·바이트 보존은 원본 패키지 기준
 * 이다). 편집 층에서 성립해야 하는 것만 다시 세운다:
 *
 *   - **I1** 안정 ID 유일(신규 ID 발급 후에도).
 *   - **I2** `origin === 'SOURCE'` 노드의 앵커는 여전히 원본 XML을 역참조한다.
 *     AUTHORED 노드는 앵커가 없으므로 검사 대상이 아니다 — 그것이 v2가 origin을
 *     타입에 넣은 이유다.
 *   - **I6** 셀당 최소 1문단, span ≥ 1. **문단 순서의 앵커 서수 단조성은
 *     검사하지 않는다** — `MOVE_BLOCK`이 SOURCE 문단의 순서를 바꾸는 것은
 *     §1.9가 허용한 정상 편집이므로, CC-140의 원문 순서 검사를 그대로 연장하면
 *     정당한 편집이 위반으로 잡힌다.
 *   - **I8**(신규) `sourceHash` 승계 불변. 편집은 원본 패키지를 바꾸지 않는다.
 *     이 값이 흔들리면 CC-160이 어떤 원본 바이트 위에 delta를 쓸지 잃는다
 *     (ADR-29 D7: 무손실 저장은 "원본 패키지 바이트를 계속 보유한다"는 전제 위에
 *     선다).
 *   - **I9**(신규) AUTHORED 노드는 `anchorHint`를 갖는다. 없으면 CC-160이 쓸
 *     자리를 IR 순서에서 역추론해야 한다(§1.10-3이 데이터 보장에서 알고리즘
 *     신뢰로 격하된다).
 */

export type EditInvariantId = 'I1' | 'I2' | 'I6' | 'I8' | 'I9';

export interface EditInvariantViolation {
  readonly invariant: EditInvariantId;
  readonly locator: string;
  readonly detail: string;
}

export interface EditInvariantReport {
  readonly checked: readonly EditInvariantId[];
  readonly violations: readonly EditInvariantViolation[];
  readonly ok: boolean;
}

export interface CheckEditInvariantsInput {
  readonly ir: DocumentIR;
  /** 편집 전 IR. I8의 비교 기준이다. */
  readonly baseIr?: DocumentIR;
  /** `PackageAnalysisResult.parsedParts`. 있으면 I2를 실제로 역참조한다. */
  readonly parsedParts?: ReadonlyMap<string, XmlElement>;
}

function fail(invariant: EditInvariantId, locator: string, detail: string): EditInvariantViolation {
  return { invariant, locator, detail };
}

export function* walkBlocks(blocks: readonly BlockIR[]): Generator<BlockIR> {
  for (const block of blocks) {
    yield block;
    if (block.kind !== 'TABLE') continue;
    for (const row of block.rows) {
      for (const cell of row.cells) yield* walkBlocks(cell.blocks);
    }
  }
}

/** PRESERVED 블록 인구조사 — RT-F(주변 편집 후 보존)의 IR 층 증거. */
export function preservedCensus(
  ir: DocumentIR,
): Array<{ preservedId: string; rawXmlAnchor: string; reasonCode: string }> {
  const out: Array<{ preservedId: string; rawXmlAnchor: string; reasonCode: string }> = [];
  for (const section of ir.sections) {
    for (const block of walkBlocks(section.blocks)) {
      if (block.kind !== 'PRESERVED') continue;
      out.push({
        preservedId: block.preservedId,
        rawXmlAnchor: block.rawXmlAnchor,
        reasonCode: block.classification.reasonCode,
      });
    }
  }
  return out.sort((a, b) => a.preservedId.localeCompare(b.preservedId));
}

export function checkEditInvariants(input: CheckEditInvariantsInput): EditInvariantReport {
  const { ir } = input;
  const violations: EditInvariantViolation[] = [];
  const counts = new Map<string, number>();
  const bump = (id: string): void => {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };

  for (const section of ir.sections) {
    bump(section.sectionId);
    for (const block of walkBlocks(section.blocks)) {
      bump(blockId(block));

      // I2 / I9 — 출신별 앵커 계약.
      if (block.kind === 'PRESERVED' || block.origin === 'SOURCE') {
        const anchor = block.rawXmlAnchor as string;
        if (!/^[^#]+#.+$/.test(anchor)) {
          violations.push(fail('I2', anchor, 'SOURCE 노드의 앵커 형식이 계약과 다릅니다'));
        } else if (input.parsedParts && !resolveAnchor(anchor, input.parsedParts)) {
          violations.push(fail('I2', anchor, 'SOURCE 노드의 앵커를 역참조할 수 없습니다'));
        }
      } else if (!block.anchorHint) {
        violations.push(fail('I9', blockId(block), 'AUTHORED 노드에 anchorHint가 없습니다'));
      }

      if (block.kind === 'PARAGRAPH') {
        for (const run of block.runs) bump(run.runId);
        continue;
      }
      if (block.kind !== 'TABLE') continue;
      for (const row of block.rows) {
        bump(row.rowId);
        for (const cell of row.cells) {
          bump(cell.cellId);
          // I6
          if (cell.rowSpan < 1 || cell.colSpan < 1) {
            violations.push(fail('I6', cell.cellId, 'span이 1 미만입니다'));
          }
          if (!cell.blocks.some((inner) => inner.kind === 'PARAGRAPH')) {
            violations.push(fail('I6', cell.cellId, '셀에 문단이 없습니다'));
          }
        }
      }
    }
  }

  // I1
  for (const [id, count] of counts) {
    if (count > 1) violations.push(fail('I1', id, `안정 ID가 ${count}회 중복되었습니다`));
  }

  // I8
  if (input.baseIr && input.baseIr.sourceHash !== ir.sourceHash) {
    violations.push(
      fail(
        'I8',
        '(document)',
        `sourceHash가 편집으로 바뀌었습니다 ${input.baseIr.sourceHash} → ${ir.sourceHash}`,
      ),
    );
  }
  if (input.baseIr && input.baseIr.documentId !== ir.documentId) {
    violations.push(fail('I8', '(document)', 'documentId가 편집으로 바뀌었습니다'));
  }

  return {
    checked: ['I1', 'I2', 'I6', 'I8', 'I9'],
    violations,
    ok: violations.length === 0,
  };
}
