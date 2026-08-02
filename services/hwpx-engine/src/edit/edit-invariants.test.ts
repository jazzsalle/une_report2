import type { BlockIR, ChangeOperation, DocumentIR } from '@une/domain';
import { describe, expect, it } from 'vitest';
import { applyChangeSet } from './change-set-executor';
import { indexDocument } from './document-tree';
import { editFixture, topLevelParagraphIds } from './edit-fixtures';
import { checkEditInvariants, preservedCensus } from './edit-invariants';

/**
 * 편집 후 불변식 + PRESERVED 생존 (ADR-29 D7의 RT-F를 IR 층에서 선증명).
 *
 * 합성 픽스처 `flatten-only-object`에는 보존 객체가 둘 있다: 자동 쪽번호
 * (`hp:pageNum`)와 수식(`hp:equation`). 둘 다 v1이 편집하지 못하는 대상이며,
 * **주변 문단을 편집해도 개수·ID·앵커가 그대로여야** 한다.
 */

const REV = 'rev-1';

function applyOps(ir: DocumentIR, operations: ChangeOperation[], changeSetId = 'CS-INV') {
  return applyChangeSet({
    ir,
    request: { baseRevisionId: REV, origin: 'USER', operations },
    changeSetId,
    currentRevisionId: REV,
    prototypes: editFixture('flatten-only-object').prototypes,
  });
}

describe('PRESERVED 블록 생존 (RT-F IR 층 선증명)', () => {
  const fx = editFixture('flatten-only-object');
  const census = preservedCensus(fx.ir);

  it('보존 객체 2종(쪽번호·수식)이 IR에 블록으로 자리를 차지한다', () => {
    expect(census).toHaveLength(2);
    expect(census.map((item) => item.reasonCode).sort()).toEqual([
      'OBJ-CTRL-PAGE-NUMBER',
      'OBJ-EQUATION',
    ]);
  });

  it('인접 문단을 삽입·삭제·분할·이동해도 preservedId·앵커·개수가 그대로다', () => {
    const ids = topLevelParagraphIds(fx.ir);
    const outline1 = ids[2];
    const outline2 = ids[3];
    const equationHost = ids[ids.length - 1];

    const inserted = applyOps(fx.ir, [
      {
        type: 'INSERT_BLOCKS',
        order: 0,
        anchor: { relation: 'AFTER', ref: equationHost },
        source: { kind: 'INLINE', blocks: [{ text: '수식 바로 뒤 문단' }] },
      },
      {
        type: 'DELETE_RANGE',
        order: 1,
        selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: [outline2] },
      },
      {
        type: 'SPLIT_PARAGRAPH',
        order: 2,
        selection: {
          kind: 'CURSOR',
          baseRevisionId: REV,
          at: { paragraphId: outline1, offset: 1 },
        },
      },
    ]);
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(preservedCensus(inserted.ir)).toEqual(census);

    const moved = applyOps(
      inserted.ir,
      [
        {
          type: 'MOVE_BLOCK',
          order: 0,
          anchor: { relation: 'FIRST_CHILD', ref: fx.ir.sections[0].sectionId },
          payload: { blockId: outline1 },
        },
      ],
      'CS-INV-MOVE',
    );
    expect(moved.ok).toBe(true);
    if (moved.ok) expect(preservedCensus(moved.ir)).toEqual(census);
  });

  it('편집으로는 PRESERVED 블록을 만들 수 없다(타입상 AUTHORED가 없다)', () => {
    for (const block of fx.ir.sections[0].blocks) {
      if (block.kind === 'PRESERVED') expect(block.origin).toBe('SOURCE');
    }
  });
});

describe('편집 후 I1·I2·I6·I8·I9 재검사', () => {
  const fx = editFixture('flatten-only-object');

  it('편집된 IR이 다섯 불변식을 모두 만족한다', () => {
    const ids = topLevelParagraphIds(fx.ir);
    const result = applyOps(fx.ir, [
      {
        type: 'INSERT_BLOCKS',
        order: 0,
        anchor: { relation: 'AFTER', ref: ids[2] },
        source: { kind: 'INLINE', blocks: [{ text: '새 문단' }] },
      },
      {
        type: 'SPLIT_PARAGRAPH',
        order: 1,
        selection: { kind: 'CURSOR', baseRevisionId: REV, at: { paragraphId: ids[3], offset: 1 } },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = checkEditInvariants({
      ir: result.ir,
      baseIr: fx.ir,
      parsedParts: fx.analysis.parsedParts,
    });
    expect(report.checked).toEqual(['I1', 'I2', 'I6', 'I8', 'I9']);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('I8: 편집은 sourceHash와 documentId를 바꾸지 않는다', () => {
    const tampered: DocumentIR = { ...fx.ir, sourceHash: 'b'.repeat(64) };
    const report = checkEditInvariants({ ir: tampered, baseIr: fx.ir });
    expect(report.violations.map((item) => item.invariant)).toContain('I8');
  });

  it('I9: anchorHint 없는 AUTHORED 노드를 잡는다', () => {
    const broken = withFirstBlockReplaced(fx.ir, {
      kind: 'PARAGRAPH',
      origin: 'AUTHORED',
      paragraphId: 'P-BROKEN',
      runs: [],
      styleRef: { paraPrId: null, charPrId: null, numberingId: null, styleId: null },
      editState: { editedByUser: true, locked: false },
      // 타입상 표현할 수 없는 상태를 런타임 검사가 잡는지 본다
      // (영속된 ir_json은 타입 검사를 거치지 않는다).
    } as unknown as BlockIR);
    const report = checkEditInvariants({ ir: broken });
    expect(report.violations.map((item) => item.invariant)).toContain('I9');
  });

  it('I1: ID가 중복되면 잡는다', () => {
    const duplicated: DocumentIR = {
      ...fx.ir,
      sections: [
        {
          ...fx.ir.sections[0],
          blocks: [...fx.ir.sections[0].blocks, fx.ir.sections[0].blocks[2]],
        },
      ],
    };
    const report = checkEditInvariants({ ir: duplicated });
    expect(report.violations.map((item) => item.invariant)).toContain('I1');
  });

  it('I2: SOURCE 노드의 앵커가 역참조되지 않으면 잡는다', () => {
    const broken = withFirstBlockReplaced(fx.ir, {
      ...(fx.ir.sections[0].blocks[0] as BlockIR),
      rawXmlAnchor: 'Contents/section0.xml#p[9999]',
    } as BlockIR);
    const report = checkEditInvariants({ ir: broken, parsedParts: fx.analysis.parsedParts });
    expect(report.violations.map((item) => item.invariant)).toContain('I2');
  });

  it('I6: 표 셀에서 문단이 사라지면 잡는다', () => {
    const emptied: DocumentIR = {
      ...fx.ir,
      sections: [
        {
          ...fx.ir.sections[0],
          blocks: fx.ir.sections[0].blocks.map((block) =>
            block.kind === 'TABLE'
              ? {
                  ...block,
                  rows: block.rows.map((row) => ({
                    ...row,
                    cells: row.cells.map((cell) => ({ ...cell, blocks: [] })),
                  })),
                }
              : block,
          ),
        },
      ],
    };
    const report = checkEditInvariants({ ir: emptied });
    expect(report.violations.map((item) => item.invariant)).toContain('I6');
  });

  it('AUTHORED 노드의 anchorHint는 트리에서 정규 재계산된다(이동 후에도 참이다)', () => {
    const ids = topLevelParagraphIds(fx.ir);
    const inserted = applyOps(fx.ir, [
      {
        type: 'INSERT_BLOCKS',
        order: 0,
        anchor: { relation: 'AFTER', ref: ids[2] },
        source: { kind: 'INLINE', blocks: [{ text: '새 문단' }] },
      },
    ]);
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const newId = (inserted.diff.find((entry) => entry.kind === 'ADDED') as { nodeId: string })
      .nodeId;

    // 기준 노드였던 문단을 지운 뒤에도 힌트는 실제 앞 형제를 가리킨다.
    const removed = applyOps(
      inserted.ir,
      [
        {
          type: 'DELETE_RANGE',
          order: 0,
          selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: [ids[2]] },
        },
      ],
      'CS-INV-DEL',
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const index = indexDocument(removed.ir);
    const entry = index.blocks.get(newId);
    if (entry?.block.kind !== 'PARAGRAPH' || entry.block.origin !== 'AUTHORED') {
      throw new Error('신규 문단을 찾지 못했습니다');
    }
    const hint = entry.block.anchorHint;
    const siblings = index.containers.get(entry.containerId) ?? [];
    if (hint.relation === 'FIRST_CHILD') {
      expect(entry.index).toBe(0);
      expect(hint.ref).toBe(entry.containerId);
    } else {
      expect(hint.relation).toBe('AFTER');
      const previous = siblings[entry.index - 1];
      const previousId =
        previous.kind === 'PARAGRAPH'
          ? previous.paragraphId
          : previous.kind === 'TABLE'
            ? previous.tableId
            : previous.preservedId;
      expect(hint.ref).toBe(previousId);
      expect(hint.ref).not.toBe(ids[2]);
    }
  });
});

function withFirstBlockReplaced(ir: DocumentIR, block: BlockIR): DocumentIR {
  return {
    ...ir,
    sections: [
      { ...ir.sections[0], blocks: [block, ...ir.sections[0].blocks.slice(1)] },
      ...ir.sections.slice(1),
    ],
  };
}
