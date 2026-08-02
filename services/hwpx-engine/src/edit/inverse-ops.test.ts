import { resolve } from 'node:path';
import { documentIrHash, type ChangeOperation, type DocumentIR } from '@une/domain';
import { describe, expect, it } from 'vitest';
import { HwpxEngine } from '../contract';
import { loadCorpus, readCorpusFile } from '../testing/corpus';
import { applyChangeSet, type ApplyChangeSetResult } from './change-set-executor';
import { indexDocument } from './document-tree';
import { editFixture, topLevelParagraphIds } from './edit-fixtures';
import { liftV1, type ParagraphBlock } from './ir-lift';
import { INVERSE_SELECTION_BASE, invertBefore } from './inverse-ops';

/**
 * 역연산 속성 테스트 — `invert(op) ∘ apply(op) == identity` (ADR-30 D6).
 *
 * ## 왜 해시로 재는가
 *
 * "되돌아왔다"를 눈으로 확인하는 단언은 되돌아오지 **않은** 부분을 보지 못한다.
 * `documentIrHash`는 IR 전체(ID·앵커·origin·anchorHint·run 텍스트·스타일 참조)의
 * 정규화 해시이므로, 한 글자·한 ID라도 다르면 실패한다.
 *
 * ## 보안
 *
 * 실 코퍼스 6종은 실제 업무 양식이다. 여기서는 **구조와 해시만** 쓰고 본문
 * 텍스트를 단언값·로그로 남기지 않는다(CORPUS.yaml 주석, security.md).
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const engine = new HwpxEngine();
const corpus = loadCorpus(REPO_ROOT);

/** 결정적 의사난수(LCG). 시각·Math.random을 쓰지 않는다. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function topParagraphs(ir: DocumentIR): ParagraphBlock[] {
  return ir.sections[0].blocks.filter(
    (block): block is ParagraphBlock => block.kind === 'PARAGRAPH',
  );
}

function textOf(paragraph: ParagraphBlock): string {
  return paragraph.runs.map((run) => run.text).join('');
}

interface Step {
  readonly name: string;
  readonly build: (ir: DocumentIR, revisionId: string) => ChangeOperation[] | null;
}

/**
 * 문서 구조에서 유효한 연산을 뽑는다. 시드는 **대상 선택과 offset**에 쓴다 —
 * 연산 순서는 의존 관계(분할 후 병합 등)가 있어 고정한다.
 */
function buildSteps(seed: number): Step[] {
  const random = lcg(seed);
  let splitRightId: string | null = null;

  const pickParagraph = (ir: DocumentIR): ParagraphBlock | null => {
    const candidates = topParagraphs(ir).filter((p) => textOf(p).length >= 4);
    if (candidates.length === 0) return null;
    return candidates[Math.floor(random() * candidates.length) % candidates.length];
  };

  return [
    {
      name: 'INSERT_BLOCKS',
      build: (ir) => {
        const target = pickParagraph(ir);
        if (!target) return null;
        return [
          {
            type: 'INSERT_BLOCKS',
            order: 0,
            anchor: { relation: 'AFTER', ref: target.paragraphId },
            source: { kind: 'INLINE', blocks: [{ text: 'ZZZ' }] },
          },
        ];
      },
    },
    {
      name: 'REPLACE_RANGE(text)',
      build: (ir, revisionId) => {
        const target = pickParagraph(ir);
        if (!target) return null;
        return [
          {
            type: 'REPLACE_RANGE',
            order: 0,
            selection: {
              kind: 'TEXT_RANGE',
              baseRevisionId: revisionId,
              start: { paragraphId: target.paragraphId, offset: 0 },
              end: { paragraphId: target.paragraphId, offset: 2 },
            },
            payload: { text: 'AB' },
          },
        ];
      },
    },
    {
      name: 'DELETE_RANGE(text)',
      build: (ir, revisionId) => {
        const target = pickParagraph(ir);
        if (!target) return null;
        return [
          {
            type: 'DELETE_RANGE',
            order: 0,
            selection: {
              kind: 'TEXT_RANGE',
              baseRevisionId: revisionId,
              start: { paragraphId: target.paragraphId, offset: 0 },
              end: { paragraphId: target.paragraphId, offset: 1 },
            },
          },
        ];
      },
    },
    {
      name: 'SPLIT_PARAGRAPH',
      build: (ir, revisionId) => {
        const target = pickParagraph(ir);
        if (!target) return null;
        splitRightId = target.paragraphId;
        return [
          {
            type: 'SPLIT_PARAGRAPH',
            order: 0,
            selection: {
              kind: 'CURSOR',
              baseRevisionId: revisionId,
              at: { paragraphId: target.paragraphId, offset: 1 },
            },
          },
        ];
      },
    },
    {
      name: 'MERGE_PARAGRAPHS',
      build: (ir) => {
        // 방금 분할한 문단과 그 오른쪽 짝을 다시 합친다(구조상 항상 호환).
        if (splitRightId === null) return null;
        const index = indexDocument(ir);
        const left = index.blocks.get(splitRightId);
        if (!left) return null;
        const siblings = index.containers.get(left.containerId) ?? [];
        const right = siblings[left.index + 1];
        if (!right || right.kind !== 'PARAGRAPH') return null;
        return [
          {
            type: 'MERGE_PARAGRAPHS',
            order: 0,
            payload: { leftId: splitRightId, rightId: right.paragraphId },
          },
        ];
      },
    },
    {
      name: 'APPLY_STYLE_ROLE',
      build: (ir) => {
        const target = pickParagraph(ir);
        if (!target) return null;
        return [
          {
            type: 'APPLY_STYLE_ROLE',
            order: 0,
            payload: { blockId: target.paragraphId, styleRole: 'BODY', outlineLevel: 1 },
          },
        ];
      },
    },
    {
      name: 'MOVE_BLOCK',
      build: (ir) => {
        const paragraphs = topParagraphs(ir);
        if (paragraphs.length < 3) return null;
        const moved = paragraphs[1];
        const anchorRef = paragraphs[paragraphs.length - 1];
        if (moved.paragraphId === anchorRef.paragraphId) return null;
        return [
          {
            type: 'MOVE_BLOCK',
            order: 0,
            anchor: { relation: 'AFTER', ref: anchorRef.paragraphId },
            payload: { blockId: moved.paragraphId },
          },
        ];
      },
    },
    {
      name: 'TABLE_PATCH',
      build: (ir) => {
        const index = indexDocument(ir);
        const cell = [...index.cells.entries()].find(([, entry]) =>
          entry.cell.blocks.some((block) => block.kind === 'PARAGRAPH'),
        );
        if (!cell) return null;
        return [
          {
            type: 'TABLE_PATCH',
            order: 0,
            payload: {
              tableId: cell[1].tableId,
              cellOps: [{ cellId: cell[0], kind: 'SET_TEXT', text: 'PATCHED' }],
            },
          },
        ];
      },
    },
  ];
}

interface Applied {
  readonly ir: DocumentIR;
  readonly undoStack: ChangeOperation[][];
  readonly applied: string[];
}

function applySequence(ir0: DocumentIR, seed: number, tag: string): Applied {
  let current = ir0;
  const undoStack: ChangeOperation[][] = [];
  const applied: string[] = [];
  buildSteps(seed).forEach((step, i) => {
    const revisionId = `rev-${i}`;
    const operations = step.build(current, revisionId);
    if (!operations) return;
    const result: ApplyChangeSetResult = applyChangeSet({
      ir: current,
      request: { baseRevisionId: revisionId, origin: 'USER', operations },
      changeSetId: `CS-${tag}-${i}`,
      currentRevisionId: revisionId,
    });
    // 실패하면 어느 연산인지 이름으로 드러난다(문서 본문은 남기지 않는다).
    expect(result.ok, `${tag}/${step.name}`).toBe(true);
    if (!result.ok) return;
    undoStack.push([...result.inverseOperations]);
    applied.push(step.name);
    current = result.ir;
  });
  return { ir: current, undoStack, applied };
}

function undoAll(ir: DocumentIR, undoStack: readonly ChangeOperation[][], tag: string): DocumentIR {
  let current = ir;
  for (let i = undoStack.length - 1; i >= 0; i -= 1) {
    const result = applyChangeSet({
      ir: current,
      request: { baseRevisionId: 'rev-undo', origin: 'UNDO', operations: undoStack[i] },
      changeSetId: `CS-${tag}-undo-${i}`,
      currentRevisionId: 'rev-undo',
    });
    expect(result.ok, `${tag}/undo#${i}`).toBe(true);
    if (!result.ok) return current;
    current = result.ir;
  }
  return current;
}

describe('invert ∘ apply == identity (실 코퍼스 6종)', () => {
  for (const [seed, file] of corpus.files.entries()) {
    it(`${file.alias}: 결정적 시드 op 시퀀스를 역적용하면 documentIrHash가 같다`, () => {
      const analyzed = engine.analyzeDocument({
        bytes: readCorpusFile(file),
        fileName: file.alias,
      });
      const ir0 = liftV1(analyzed.ir);
      const before = documentIrHash(ir0);

      const forward = applySequence(ir0, seed + 1, file.alias);
      // 시퀀스가 실제로 문서를 바꾸었는지부터 확인한다 — 아무 일도 안 하고
      // "되돌아왔다"고 말하는 테스트를 막는다.
      expect(forward.applied.length).toBeGreaterThanOrEqual(6);
      expect(documentIrHash(forward.ir)).not.toBe(before);

      const restored = undoAll(forward.ir, forward.undoStack, file.alias);
      expect(documentIrHash(restored)).toBe(before);
    });
  }
});

describe('한 ChangeSet 안의 다중 연산도 역집합 하나로 되돌아온다', () => {
  it('삽입+치환+역할 3연산을 한 번에 적용하고 한 번에 되돌린다', () => {
    const fx = editFixture();
    const [, , outline1, outline2] = topLevelParagraphIds(fx.ir);
    const before = documentIrHash(fx.ir);
    const forward = applyChangeSet({
      ir: fx.ir,
      request: {
        baseRevisionId: 'rev-1',
        origin: 'USER',
        operations: [
          {
            type: 'INSERT_BLOCKS',
            order: 0,
            anchor: { relation: 'AFTER', ref: outline1 },
            source: { kind: 'INLINE', blocks: [{ text: '가' }, { text: '나' }] },
          },
          {
            type: 'REPLACE_RANGE',
            order: 1,
            selection: {
              kind: 'TEXT_RANGE',
              baseRevisionId: 'rev-1',
              start: { paragraphId: outline2, offset: 0 },
              end: { paragraphId: outline2, offset: 2 },
            },
            payload: { text: 'XY' },
          },
          {
            type: 'APPLY_STYLE_ROLE',
            order: 2,
            payload: { blockId: outline2, styleRole: 'BODY' },
          },
        ],
      },
      changeSetId: 'CS-MULTI',
      currentRevisionId: 'rev-1',
      prototypes: fx.prototypes,
    });
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    expect(documentIrHash(forward.ir)).not.toBe(before);

    const undone = applyChangeSet({
      ir: forward.ir,
      request: {
        baseRevisionId: 'rev-2',
        origin: 'UNDO',
        operations: [...forward.inverseOperations],
      },
      changeSetId: 'CS-MULTI-UNDO',
      currentRevisionId: 'rev-2',
      prototypes: fx.prototypes,
    });
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(documentIrHash(undone.ir)).toBe(before);
  });
});

describe('§1.9 역연산 짝', () => {
  it('before 이미지 종류마다 정본 표의 짝을 낸다', () => {
    const pairs: Array<[string, string]> = [
      [invertBefore({ kind: 'INSERTED', ids: ['P-1'] })[0].type, 'DELETE_RANGE'],
      [
        invertBefore({
          kind: 'BLOCKS_REMOVED',
          removed: [
            {
              block: {
                kind: 'PARAGRAPH',
                origin: 'AUTHORED',
                paragraphId: 'P-1',
                runs: [],
                styleRef: { paraPrId: null, charPrId: null, numberingId: null, styleId: null },
                editState: { editedByUser: false, locked: false },
                anchorHint: { relation: 'AFTER', ref: 'P-0' },
              },
              anchor: { relation: 'AFTER', ref: 'P-0' },
            },
          ],
        })[0].type,
        'INSERT_BLOCKS',
      ],
      [
        invertBefore({ kind: 'PARAGRAPH_RUNS', paragraphId: 'P-1', runs: [] })[0].type,
        'REPLACE_RANGE',
      ],
      [
        invertBefore({ kind: 'SPLIT', leftId: 'P-1', rightId: 'P-2', leftRunsBefore: [] })[0].type,
        'MERGE_PARAGRAPHS',
      ],
      [
        invertBefore({
          kind: 'MOVED',
          blockId: 'P-1',
          anchor: { relation: 'AFTER', ref: 'P-0' },
        })[0].type,
        'MOVE_BLOCK',
      ],
      [invertBefore({ kind: 'ROLE', blockId: 'P-1' })[0].type, 'APPLY_STYLE_ROLE'],
      [invertBefore({ kind: 'CELLS', tableId: 'TBL-1', cells: [] })[0].type, 'TABLE_PATCH'],
    ];
    for (const [actual, expected] of pairs) expect(actual).toBe(expected);
  });

  it('역연산의 selection은 아직 없는 개정을 가리키므로 센티널을 쓴다', () => {
    const inverse = invertBefore({ kind: 'INSERTED', ids: ['P-1'] })[0];
    expect(inverse.selection?.baseRevisionId).toBe(INVERSE_SELECTION_BASE);
  });
});
