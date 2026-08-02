import {
  canonicalJson,
  documentIrHash,
  type ChangeOperation,
  type ChangeSetRequest,
  type DocumentIR,
} from '@une/domain';
import { describe, expect, it } from 'vitest';
import {
  applyChangeSet,
  type ApplyChangeSetInput,
  type ApplyChangeSetResult,
} from './change-set-executor';
import { indexDocument } from './document-tree';
import { editFixture, paragraphTextById, topLevelParagraphIds } from './edit-fixtures';
import { blockId } from './ir-lift';

/**
 * ChangeSetExecutor 테스트 (설계 07 §1.9).
 *
 * 8개 연산 × (정상 / 잠금 / 정적영역 / 표 경계 / 원자 rollback).
 * 입력은 합성 HWPX뿐이다(보안: 실 코퍼스 본문을 단언값으로 남기지 않는다).
 */

const REV = 'rev-1';

function request(
  operations: ChangeOperation[],
  overrides: Partial<ChangeSetRequest> = {},
): ChangeSetRequest {
  return { baseRevisionId: REV, origin: 'USER', operations, ...overrides };
}

function apply(
  ir: DocumentIR,
  operations: ChangeOperation[],
  extra: Partial<ApplyChangeSetInput> = {},
): ApplyChangeSetResult {
  const fixture = editFixture();
  return applyChangeSet({
    ir,
    request: request(operations),
    changeSetId: 'CS-TEST-1',
    currentRevisionId: REV,
    prototypes: fixture.prototypes,
    ...extra,
  });
}

function lockParagraph(ir: DocumentIR, paragraphId: string): DocumentIR {
  return {
    ...ir,
    sections: ir.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) =>
        block.kind === 'PARAGRAPH' && block.paragraphId === paragraphId
          ? { ...block, editState: { ...block.editState, locked: true } }
          : block,
      ),
    })),
  };
}

const fx = editFixture();
// 합성 문서 최상위 문단: [secPr, 표지제목, □개요, ○현황, ○조치, □피해현황, 공백, 표호스트]
const [, TITLE_ID, OUTLINE1_ID, OUTLINE2_ID, OUTLINE2B_ID, OUTLINE1B_ID, WS_ID] =
  topLevelParagraphIds(fx.ir);
const TABLE_ID = (
  fx.ir.sections[0].blocks.find((block) => block.kind === 'TABLE') as { tableId: string }
).tableId;
const CELL_IDS = indexDocument(fx.ir).cells;
const [FIRST_CELL_ID] = [...CELL_IDS.keys()];
const CELL_PARAGRAPH_ID = (() => {
  const cell = CELL_IDS.get(FIRST_CELL_ID);
  const first = cell?.cell.blocks[0];
  return first && first.kind === 'PARAGRAPH' ? first.paragraphId : '';
})();

describe('파이프라인 전단 (validateSchema / checkBaseRevision)', () => {
  it('baseRevisionId 불일치를 UNDO_CONFLICT로 거부한다', () => {
    const result = applyChangeSet({
      ir: fx.ir,
      request: request(
        [
          {
            type: 'APPLY_STYLE_ROLE',
            order: 0,
            payload: { blockId: OUTLINE1_ID, styleRole: 'BODY' },
          },
        ],
        {
          baseRevisionId: 'rev-0',
        },
      ),
      changeSetId: 'CS-1',
      currentRevisionId: REV,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0].reason).toBe('UNDO_CONFLICT');
  });

  it('APPLY_STYLE_ROLE에 styleId를 직접 넣으면 어휘 자체를 거부한다(§1.9)', () => {
    const result = apply(fx.ir, [
      {
        type: 'APPLY_STYLE_ROLE',
        order: 0,
        payload: { blockId: OUTLINE1_ID, styleRole: 'BODY', styleId: 3 },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((item) => item.detail.includes('styleId'))).toBe(true);
    }
  });

  it('필수 인자가 빠진 연산을 거부한다', () => {
    const result = apply(fx.ir, [{ type: 'MERGE_PARAGRAPHS', order: 0, payload: {} }]);
    expect(result.ok).toBe(false);
  });
});

describe('INSERT_BLOCKS', () => {
  it('정상: Prototype Resolve 후 삽입하고 AUTHORED 노드가 anchorHint를 갖는다', () => {
    const result = apply(fx.ir, [
      {
        type: 'INSERT_BLOCKS',
        order: 0,
        anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
        source: {
          kind: 'INLINE',
          blocks: [{ text: '새 항목', styleRole: 'OUTLINE_2', outlineLevel: 2 }],
        },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = result.diff.filter((entry) => entry.kind === 'ADDED');
    expect(added).toHaveLength(1);
    const entry = indexDocument(result.ir).blocks.get(added[0].nodeId);
    expect(entry?.block.kind).toBe('PARAGRAPH');
    if (entry?.block.kind !== 'PARAGRAPH') return;
    expect(entry.block.origin).toBe('AUTHORED');
    expect(entry.block.anchorHint).toEqual({ relation: 'AFTER', ref: OUTLINE1_ID });
    expect(entry.block.rawXmlAnchor).toBeUndefined();
    expect(entry.block.prototypeId).toBeTruthy();
    // §1.7 KEEP_SOURCE_PREFIX: OUTLINE_2 원본의 문자 접두사를 승계한다.
    expect(paragraphTextById(result.ir, added[0].nodeId).endsWith('새 항목')).toBe(true);
  });

  it('신규 ID는 changeSetId·순서에서 결정적으로 나온다(같은 입력 → 같은 ID)', () => {
    const op: ChangeOperation = {
      type: 'INSERT_BLOCKS',
      order: 0,
      anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
      source: { kind: 'INLINE', blocks: [{ text: 'X' }] },
    };
    const first = apply(fx.ir, [op]);
    const second = apply(fx.ir, [op]);
    expect(first.ok && second.ok && first.irHash === second.irHash).toBe(true);
  });

  it('0건 삽입은 조용한 성공이 아니라 위반이다', () => {
    // 주입이 없는 GENERATED_BLOCKS는 이미 위반이므로, 여기서는 "주입은 됐는데
    // 결과가 0건"인 경우를 본다. 성공으로 넘기면 화면은 실체화했다고 표시하고
    // 문서에는 아무것도 들어가지 않는다.
    const result = apply(
      fx.ir,
      [
        {
          type: 'INSERT_BLOCKS',
          order: 0,
          anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
          source: {
            kind: 'GENERATED_BLOCKS',
            planId: '11111111-1111-4111-8111-111111111111',
            tocVersionId: '22222222-2222-4222-8222-222222222222',
          },
        },
      ],
      { generatedBlocks: () => [] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0].detail).toContain('삽입할 블록이 없습니다');
  });

  it('형태가 틀린 restore 항목은 IR에 들어가지 못한다', () => {
    // `'restore' in value`만 보고 그대로 넣으면 요청에서 온 임의의 객체가
    // ir_json에 영속된다(판별 유니온은 컴파일 시점 보장이라 막지 못한다).
    for (const forged of [null, {}, { kind: 'PARAGRAPH' }, { kind: '무엇' }]) {
      const result = apply(fx.ir, [
        {
          type: 'INSERT_BLOCKS',
          order: 0,
          anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
          source: { kind: 'INLINE', blocks: [{ restore: forged } as never] },
        },
      ]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.violations.some((item) => item.detail.includes('restore'))).toBe(true);
      }
    }
  });

  it('구조는 맞지만 앵커가 위조된 SOURCE 노드는 편집 후 불변식(I2)이 잡는다', () => {
    // 형태 검사(kind + 안정 ID)를 통과하는 값이라도 커밋 전 관문이 하나 더
    // 있다. `rebuildIndexesAndReferences`는 I2를 보지 않으므로, 검사기를
    // 배선하지 않으면 위조 앵커를 가진 노드가 ir_json에 그대로 영속된다.
    const result = apply(fx.ir, [
      {
        type: 'INSERT_BLOCKS',
        order: 0,
        anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
        source: {
          kind: 'INLINE',
          blocks: [
            {
              restore: {
                kind: 'PARAGRAPH',
                origin: 'SOURCE',
                paragraphId: 'P-위조',
                rawXmlAnchor: '해시없는앵커',
                runs: [],
                styleRef: { paraPrId: null, charPrId: null, numberingId: null, styleId: null },
                editState: { editedByUser: false, locked: false },
              },
            } as never,
          ],
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((item) => item.detail.includes('I2'))).toBe(true);
    }
  });

  it('잠금: 기준 블록이 잠겨 있으면 LOCKED_BLOCK', () => {
    const locked = lockParagraph(fx.ir, OUTLINE1_ID);
    const result = apply(locked, [
      {
        type: 'INSERT_BLOCKS',
        order: 0,
        anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
        source: { kind: 'INLINE', blocks: [{ text: 'X' }] },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0].reason).toBe('LOCKED_BLOCK');
  });

  it('정적영역: 표지 제목 옆 삽입을 STATIC_REGION으로 거부한다', () => {
    const result = apply(
      fx.ir,
      [
        {
          type: 'INSERT_BLOCKS',
          order: 0,
          anchor: { relation: 'AFTER', ref: TITLE_ID },
          source: { kind: 'INLINE', blocks: [{ text: 'X' }] },
        },
      ],
      { staticRegionAnchors: fx.staticRegionAnchors },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0].reason).toBe('STATIC_REGION');
  });

  it('GENERATED_BLOCKS는 주입이 없으면 거부한다(엔진은 DB를 읽지 않는다)', () => {
    const op: ChangeOperation = {
      type: 'INSERT_BLOCKS',
      order: 0,
      anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
      source: { kind: 'GENERATED_BLOCKS', planId: 'PLAN-1', tocVersionId: 'TOC-1' },
    };
    expect(apply(fx.ir, [op]).ok).toBe(false);

    const injected = apply(fx.ir, [op], {
      generatedBlocks: ({ planId }) => (planId === 'PLAN-1' ? [{ text: '생성 블록' }] : null),
    });
    expect(injected.ok).toBe(true);
    if (injected.ok)
      expect(injected.diff.filter((entry) => entry.kind === 'ADDED')).toHaveLength(1);
  });

  it('PROTOTYPE 소스는 등록된 원본에서 count개를 만든다', () => {
    const prototypeId = fx.prototypes.find((item) => item.styleRole === 'OUTLINE_2')
      ?.prototypeId as string;
    const result = apply(fx.ir, [
      {
        type: 'INSERT_BLOCKS',
        order: 0,
        anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
        source: { kind: 'PROTOTYPE', prototypeId, count: 2 },
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.diff.filter((entry) => entry.kind === 'ADDED')).toHaveLength(2);
  });
});

describe('REPLACE_RANGE', () => {
  it('정상: 문자 범위를 치환하고 run·컨트롤을 유지한다', () => {
    const before = paragraphTextById(fx.ir, WS_ID);
    const result = apply(fx.ir, [
      {
        type: 'REPLACE_RANGE',
        order: 0,
        selection: {
          kind: 'TEXT_RANGE',
          baseRevisionId: REV,
          start: { paragraphId: WS_ID, offset: 0 },
          end: { paragraphId: WS_ID, offset: 1 },
        },
        payload: { text: 'Z' },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = paragraphTextById(result.ir, WS_ID);
    expect(after).toHaveLength(before.length);
    expect(after.startsWith('Z')).toBe(true);
    const entry = indexDocument(result.ir).blocks.get(WS_ID);
    const original = indexDocument(fx.ir).blocks.get(WS_ID);
    if (entry?.block.kind !== 'PARAGRAPH' || original?.block.kind !== 'PARAGRAPH') return;
    expect(entry.block.runs.map((run) => run.runId)).toEqual(
      original.block.runs.map((run) => run.runId),
    );
    expect(entry.block.runs.flatMap((run) => run.controls)).toEqual(
      original.block.runs.flatMap((run) => run.controls),
    );
  });

  it('여러 문단에 걸친 문자 범위는 거부한다(SPLIT/MERGE·블록 연산으로 표현)', () => {
    const result = apply(fx.ir, [
      {
        type: 'REPLACE_RANGE',
        order: 0,
        selection: {
          kind: 'TEXT_RANGE',
          baseRevisionId: REV,
          start: { paragraphId: OUTLINE1_ID, offset: 0 },
          end: { paragraphId: OUTLINE2_ID, offset: 1 },
        },
        payload: { text: 'Z' },
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it('블록 치환은 원문을 지우고 새 블록으로 바꾼다', () => {
    const result = apply(fx.ir, [
      {
        type: 'REPLACE_RANGE',
        order: 0,
        selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: [OUTLINE2_ID] },
        source: { kind: 'INLINE', blocks: [{ text: '치환됨' }] },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(indexDocument(result.ir).blocks.has(OUTLINE2_ID)).toBe(false);
    expect(
      result.diff.some((entry) => entry.kind === 'REMOVED' && entry.nodeId === OUTLINE2_ID),
    ).toBe(true);
  });

  it('잠금·정적영역에서 거부한다', () => {
    const locked = lockParagraph(fx.ir, OUTLINE2_ID);
    const lockedResult = apply(locked, [
      {
        type: 'REPLACE_RANGE',
        order: 0,
        selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: [OUTLINE2_ID] },
        source: { kind: 'INLINE', blocks: [{ text: 'X' }] },
      },
    ]);
    expect(lockedResult.ok).toBe(false);

    const staticResult = apply(
      fx.ir,
      [
        {
          type: 'REPLACE_RANGE',
          order: 0,
          selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: [TITLE_ID] },
          source: { kind: 'INLINE', blocks: [{ text: 'X' }] },
        },
      ],
      { staticRegionAnchors: fx.staticRegionAnchors },
    );
    expect(staticResult.ok).toBe(false);
  });
});

describe('DELETE_RANGE', () => {
  it('정상: 블록을 지우고 REMOVED diff를 낸다', () => {
    const result = apply(fx.ir, [
      {
        type: 'DELETE_RANGE',
        order: 0,
        selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: [OUTLINE2B_ID] },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(indexDocument(result.ir).blocks.has(OUTLINE2B_ID)).toBe(false);
  });

  it('빈 범위(커서만)는 문단을 지우지 않고 거부한다', () => {
    const result = apply(fx.ir, [
      {
        type: 'DELETE_RANGE',
        order: 0,
        selection: {
          kind: 'CURSOR',
          baseRevisionId: REV,
          at: { paragraphId: OUTLINE2_ID, offset: 1 },
        },
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it('표 경계: 셀 안팎에 걸친 선택을 거부한다', () => {
    const result = apply(fx.ir, [
      {
        type: 'DELETE_RANGE',
        order: 0,
        selection: {
          kind: 'BLOCK',
          baseRevisionId: REV,
          blockIds: [OUTLINE2_ID, CELL_PARAGRAPH_ID],
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.violations.map((item) => item.reason)).toContain('TABLE_BOUNDARY');
  });

  it('셀의 마지막 문단을 지우면 CELL_MIN_ONE_PARAGRAPH로 거부한다(I6)', () => {
    const result = apply(fx.ir, [
      {
        type: 'DELETE_RANGE',
        order: 0,
        selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: [CELL_PARAGRAPH_ID] },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((item) => item.reason)).toContain('CELL_MIN_ONE_PARAGRAPH');
    }
  });

  it('정적영역 블록 삭제를 거부한다', () => {
    const result = apply(
      fx.ir,
      [
        {
          type: 'DELETE_RANGE',
          order: 0,
          selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: [TITLE_ID] },
        },
      ],
      { staticRegionAnchors: fx.staticRegionAnchors },
    );
    expect(result.ok).toBe(false);
  });
});

describe('SPLIT_PARAGRAPH / MERGE_PARAGRAPHS', () => {
  it('정상: 분할은 동일 Prototype을 상속하고 새 문단은 AUTHORED다', () => {
    const result = apply(fx.ir, [
      {
        type: 'SPLIT_PARAGRAPH',
        order: 0,
        selection: {
          kind: 'CURSOR',
          baseRevisionId: REV,
          at: { paragraphId: OUTLINE1_ID, offset: 2 },
        },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const added = result.diff.find((entry) => entry.kind === 'ADDED') as { nodeId: string };
    const index = indexDocument(result.ir);
    const left = index.blocks.get(OUTLINE1_ID);
    const right = index.blocks.get(added.nodeId);
    if (left?.block.kind !== 'PARAGRAPH' || right?.block.kind !== 'PARAGRAPH') return;
    expect(right.block.origin).toBe('AUTHORED');
    expect(right.block.styleRef).toEqual(left.block.styleRef);
    expect(paragraphTextById(result.ir, OUTLINE1_ID)).toHaveLength(2);
    expect(right.index).toBe(left.index + 1);
  });

  it('병합: 호환 Style이 아니면 INCOMPATIBLE_STYLE로 거부한다', () => {
    // TITLE(charPr/paraPr 다름)과 개요 문단은 병합할 수 없다.
    const result = apply(fx.ir, [
      { type: 'MERGE_PARAGRAPHS', order: 0, payload: { leftId: TITLE_ID, rightId: OUTLINE1_ID } },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.map((item) => item.reason)).toContain('INCOMPATIBLE_STYLE');
    }
  });

  it('병합: 이웃하지 않으면 거부한다', () => {
    const result = apply(fx.ir, [
      {
        type: 'MERGE_PARAGRAPHS',
        order: 0,
        payload: { leftId: OUTLINE2_ID, rightId: OUTLINE1B_ID },
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it('병합: 이웃한 호환 문단을 합치고 alias를 남긴다', () => {
    const result = apply(fx.ir, [
      {
        type: 'MERGE_PARAGRAPHS',
        order: 0,
        payload: { leftId: OUTLINE2_ID, rightId: OUTLINE2B_ID },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aliases).toEqual([
      {
        from: OUTLINE2B_ID,
        to: OUTLINE2_ID,
        offsetDelta: paragraphTextById(fx.ir, OUTLINE2_ID).length,
      },
    ]);
    expect(indexDocument(result.ir).blocks.has(OUTLINE2B_ID)).toBe(false);
  });

  it('잠긴 문단은 분할·병합할 수 없다', () => {
    const locked = lockParagraph(fx.ir, OUTLINE2_ID);
    expect(
      apply(locked, [
        {
          type: 'SPLIT_PARAGRAPH',
          order: 0,
          selection: {
            kind: 'CURSOR',
            baseRevisionId: REV,
            at: { paragraphId: OUTLINE2_ID, offset: 1 },
          },
        },
      ]).ok,
    ).toBe(false);
    expect(
      apply(locked, [
        {
          type: 'MERGE_PARAGRAPHS',
          order: 0,
          payload: { leftId: OUTLINE2_ID, rightId: OUTLINE2B_ID },
        },
      ]).ok,
    ).toBe(false);
  });
});

describe('MOVE_BLOCK', () => {
  it('정상: 참조 위치를 바꾸고 MOVED diff를 낸다', () => {
    const result = apply(fx.ir, [
      {
        type: 'MOVE_BLOCK',
        order: 0,
        anchor: { relation: 'AFTER', ref: OUTLINE1B_ID },
        payload: { blockId: OUTLINE2_ID },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diff).toContainEqual({ kind: 'MOVED', nodeId: OUTLINE2_ID });
    const index = indexDocument(result.ir);
    expect((index.blocks.get(OUTLINE2_ID) as { index: number }).index).toBe(
      (index.blocks.get(OUTLINE1B_ID) as { index: number }).index + 1,
    );
  });

  it('자기 자신을 기준으로 이동할 수 없다', () => {
    const result = apply(fx.ir, [
      {
        type: 'MOVE_BLOCK',
        order: 0,
        anchor: { relation: 'AFTER', ref: OUTLINE2_ID },
        payload: { blockId: OUTLINE2_ID },
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it('표를 자기 셀 안으로 옮길 수 없다(순환)', () => {
    const result = apply(fx.ir, [
      {
        type: 'MOVE_BLOCK',
        order: 0,
        anchor: { relation: 'LAST_CHILD', ref: FIRST_CELL_ID },
        payload: { blockId: TABLE_ID },
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it('정적영역 블록은 이동할 수 없다', () => {
    const result = apply(
      fx.ir,
      [
        {
          type: 'MOVE_BLOCK',
          order: 0,
          anchor: { relation: 'AFTER', ref: OUTLINE1B_ID },
          payload: { blockId: TITLE_ID },
        },
      ],
      { staticRegionAnchors: fx.staticRegionAnchors },
    );
    expect(result.ok).toBe(false);
  });
});

describe('APPLY_STYLE_ROLE', () => {
  it('정상: 역할과 prototypeId만 바꾸고 styleRef는 건드리지 않는다', () => {
    const beforeEntry = indexDocument(fx.ir).blocks.get(OUTLINE2_ID);
    const result = apply(fx.ir, [
      {
        type: 'APPLY_STYLE_ROLE',
        order: 0,
        payload: { blockId: OUTLINE2_ID, styleRole: 'OUTLINE_1', outlineLevel: 1 },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok || beforeEntry?.block.kind !== 'PARAGRAPH') return;
    const after = indexDocument(result.ir).blocks.get(OUTLINE2_ID);
    if (after?.block.kind !== 'PARAGRAPH') return;
    expect(after.block.styleRole).toBe('OUTLINE_1');
    expect(after.block.outlineLevel).toBe(1);
    expect(after.block.prototypeId).toBeTruthy();
    // §1.9 "직접 styleId 설정 금지" — 서식 참조는 그대로다.
    expect(after.block.styleRef).toEqual(beforeEntry.block.styleRef);
  });

  it('문단이 아닌 블록에는 적용할 수 없다', () => {
    const result = apply(fx.ir, [
      { type: 'APPLY_STYLE_ROLE', order: 0, payload: { blockId: TABLE_ID, styleRole: 'BODY' } },
    ]);
    expect(result.ok).toBe(false);
  });

  it('잠금·정적영역에서 거부한다', () => {
    expect(
      apply(lockParagraph(fx.ir, OUTLINE2_ID), [
        {
          type: 'APPLY_STYLE_ROLE',
          order: 0,
          payload: { blockId: OUTLINE2_ID, styleRole: 'BODY' },
        },
      ]).ok,
    ).toBe(false);
    expect(
      apply(
        fx.ir,
        [{ type: 'APPLY_STYLE_ROLE', order: 0, payload: { blockId: TITLE_ID, styleRole: 'BODY' } }],
        {
          staticRegionAnchors: fx.staticRegionAnchors,
        },
      ).ok,
    ).toBe(false);
  });
});

describe('TABLE_PATCH', () => {
  it('정상: 셀 텍스트를 바꿔도 문단과 run이 남는다(§1.9 셀 최소 1문단)', () => {
    const result = apply(fx.ir, [
      {
        type: 'TABLE_PATCH',
        order: 0,
        payload: {
          tableId: TABLE_ID,
          cellOps: [{ cellId: FIRST_CELL_ID, kind: 'SET_TEXT', text: '변경' }],
        },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(paragraphTextById(result.ir, CELL_PARAGRAPH_ID)).toBe('변경');
    const cell = indexDocument(result.ir).cells.get(FIRST_CELL_ID);
    expect(cell?.cell.blocks.filter((block) => block.kind === 'PARAGRAPH')).toHaveLength(1);
  });

  it('CLEAR는 문단을 지우지 않고 내용만 비운다', () => {
    const result = apply(fx.ir, [
      {
        type: 'TABLE_PATCH',
        order: 0,
        payload: { tableId: TABLE_ID, cellOps: [{ cellId: FIRST_CELL_ID, kind: 'CLEAR' }] },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(paragraphTextById(result.ir, CELL_PARAGRAPH_ID)).toBe('');
    expect(indexDocument(result.ir).blocks.has(CELL_PARAGRAPH_ID)).toBe(true);
  });

  it('span 0은 TABLE_BOUNDARY로 거부한다', () => {
    const result = apply(fx.ir, [
      {
        type: 'TABLE_PATCH',
        order: 0,
        payload: {
          tableId: TABLE_ID,
          cellOps: [{ cellId: FIRST_CELL_ID, kind: 'SET_SPAN', colSpan: 0 }],
        },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.violations.map((item) => item.reason)).toContain('TABLE_BOUNDARY');
  });

  it('다른 표의 셀을 지정하면 표 경계 위반이다', () => {
    const result = apply(fx.ir, [
      {
        type: 'TABLE_PATCH',
        order: 0,
        payload: {
          tableId: TABLE_ID,
          cellOps: [{ cellId: 'TC-없음', kind: 'SET_TEXT', text: 'X' }],
        },
      },
    ]);
    expect(result.ok).toBe(false);
  });

  it('정적영역(결재란 등) 표는 수정할 수 없다', () => {
    const tableAnchor = (
      fx.ir.sections[0].blocks.find((block) => block.kind === 'TABLE') as { rawXmlAnchor: string }
    ).rawXmlAnchor;
    const result = apply(
      fx.ir,
      [
        {
          type: 'TABLE_PATCH',
          order: 0,
          payload: {
            tableId: TABLE_ID,
            cellOps: [{ cellId: FIRST_CELL_ID, kind: 'SET_TEXT', text: 'X' }],
          },
        },
      ],
      { staticRegionAnchors: [tableAnchor] },
    );
    expect(result.ok).toBe(false);
  });
});

describe('원자성 (§1.9 "no partial document mutation")', () => {
  it('두 번째 연산이 실패하면 첫 연산의 결과도 남지 않는다', () => {
    const snapshot = canonicalJson(fx.ir);
    const result = apply(lockParagraph(fx.ir, OUTLINE1B_ID), [
      {
        type: 'INSERT_BLOCKS',
        order: 0,
        anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
        source: { kind: 'INLINE', blocks: [{ text: '먼저 성공하는 연산' }] },
      },
      {
        type: 'DELETE_RANGE',
        order: 1,
        selection: { kind: 'BLOCK', baseRevisionId: REV, blockIds: [OUTLINE1B_ID] },
      },
    ]);
    expect(result.ok).toBe(false);
    // 실패 결과 타입에는 ir 필드가 존재하지 않는다 — 부분 변형을 반환할 수 없다.
    expect('ir' in result).toBe(false);
    // 입력 IR도 변형되지 않았다.
    expect(canonicalJson(fx.ir)).toBe(snapshot);
  });

  it('dryRun은 IR을 계산하되 개정 생성 여부를 호출자에게 남긴다', () => {
    const result = applyChangeSet({
      ir: fx.ir,
      request: request(
        [
          {
            type: 'INSERT_BLOCKS',
            order: 0,
            anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
            source: { kind: 'INLINE', blocks: [{ text: 'X' }] },
          },
        ],
        { dryRun: true },
      ),
      changeSetId: 'CS-DRY',
      currentRevisionId: REV,
      prototypes: fx.prototypes,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dryRun).toBe(true);
      expect(result.irHash).not.toBe(documentIrHash(fx.ir));
    }
  });
});

describe('G15-3 Enter/Tab/Shift+Tab 등가', () => {
  it('Enter = SPLIT_PARAGRAPH: 커서 위치에서 두 문단이 된다', () => {
    const before = fx.ir.sections[0].blocks.length;
    const result = apply(fx.ir, [
      {
        type: 'SPLIT_PARAGRAPH',
        order: 0,
        selection: {
          kind: 'CURSOR',
          baseRevisionId: REV,
          at: { paragraphId: OUTLINE2_ID, offset: 3 },
        },
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ir.sections[0].blocks.length).toBe(before + 1);
  });

  it('Tab/Shift+Tab = APPLY_STYLE_ROLE ±1: 왕복하면 IR이 원상복귀한다', () => {
    const seeded = apply(fx.ir, [
      {
        type: 'APPLY_STYLE_ROLE',
        order: 0,
        payload: { blockId: OUTLINE2_ID, styleRole: 'OUTLINE_2', outlineLevel: 2 },
      },
    ]);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const tab = apply(seeded.ir, [
      {
        type: 'APPLY_STYLE_ROLE',
        order: 0,
        payload: { blockId: OUTLINE2_ID, styleRole: 'OUTLINE_2', outlineLevel: 3 },
      },
    ]);
    expect(tab.ok).toBe(true);
    if (!tab.ok) return;
    const tabbed = indexDocument(tab.ir).blocks.get(OUTLINE2_ID);
    if (tabbed?.block.kind !== 'PARAGRAPH') return;
    expect(tabbed.block.outlineLevel).toBe(3);

    const shiftTab = apply(tab.ir, [
      {
        type: 'APPLY_STYLE_ROLE',
        order: 0,
        payload: { blockId: OUTLINE2_ID, styleRole: 'OUTLINE_2', outlineLevel: 2 },
      },
    ]);
    expect(shiftTab.ok).toBe(true);
    if (!shiftTab.ok) return;
    expect(shiftTab.irHash).toBe(seeded.irHash);
  });
});

describe('신규 ID 충돌', () => {
  it('발급 ID가 문서 ID와 충돌하면 재발급하지 않고 위반으로 끝낸다', () => {
    // 발급기가 만들 ID를 미리 문서에 심는다.
    const first = apply(fx.ir, [
      {
        type: 'INSERT_BLOCKS',
        order: 0,
        anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
        source: { kind: 'INLINE', blocks: [{ text: 'X' }] },
      },
    ]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // 같은 changeSetId로 같은 연산을 **이미 그 ID가 있는 문서**에 적용한다.
    const second = applyChangeSet({
      ir: first.ir,
      request: request([
        {
          type: 'INSERT_BLOCKS',
          order: 0,
          anchor: { relation: 'AFTER', ref: OUTLINE1_ID },
          source: { kind: 'INLINE', blocks: [{ text: 'X' }] },
        },
      ]),
      changeSetId: 'CS-TEST-1',
      currentRevisionId: REV,
      prototypes: fx.prototypes,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      // 전용 사유로 나간다 — UNSUPPORTED_OPERATION으로 뭉개면 원인을 가린다.
      expect(second.violations[0].reason).toBe('ID_COLLISION');
      expect(second.violations[0].detail).toContain('충돌');
    }
  });
});

describe('블록 ID 헬퍼', () => {
  it('종류와 무관하게 안정 ID를 돌려준다', () => {
    const blocks = fx.ir.sections[0].blocks;
    expect(blocks.map(blockId).every((id) => id.length > 0)).toBe(true);
  });
});
