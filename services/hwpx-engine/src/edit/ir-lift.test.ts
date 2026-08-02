import { canonicalJson, documentIrHash, type BlockIR, type DocumentIR } from '@une/domain';
import { describe, expect, it } from 'vitest';
import { HwpxEngine } from '../contract';
import { synthHwpx } from '../testing/synth-hwpx';
import {
  blocksBetween,
  indexDocument,
  insertAt,
  normalizeAnchorHints,
  removeBlocks,
  replaceBlock,
} from './document-tree';
import { editFixture } from './edit-fixtures';
import { blockId, liftV1 } from './ir-lift';

/**
 * IR v2 산출·v1 승격과 불변 트리 연산.
 */

const engine = new HwpxEngine();

/** 영속된 v1 `ir_json` 행을 흉내 낸다: `origin`이 없고 irVersion이 '1'이다.
 *  JSON은 타입 검사를 거치지 않으므로 이 상태가 실제로 존재할 수 있다. */
function downgradeToV1(ir: unknown): DocumentIR {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (key === 'origin') continue;
        out[key] = strip(inner);
      }
      return out;
    }
    return value;
  };
  const downgraded = strip(JSON.parse(canonicalJson(ir))) as { irVersion: string };
  downgraded.irVersion = '1';
  return downgraded as unknown as DocumentIR;
}

describe('ir-builder는 v2를 직접 낸다', () => {
  const analyzed = engine.analyzeDocument({ bytes: synthHwpx('valid') });

  it('irVersion이 2이고 모든 노드가 SOURCE + rawXmlAnchor를 갖는다', () => {
    expect(analyzed.ir.irVersion).toBe('2');
    for (const block of analyzed.ir.sections[0].blocks) {
      expect(block.origin).toBe('SOURCE');
      expect(block.rawXmlAnchor).toMatch(/^[^#]+#.+$/);
      if (block.kind !== 'TABLE') continue;
      for (const row of block.rows) {
        for (const cell of row.cells) {
          for (const inner of cell.blocks) expect(inner.origin).toBe('SOURCE');
        }
      }
    }
  });

  it('읽기 경로는 AUTHORED 노드를 만들지 않는다', () => {
    expect(canonicalJson(analyzed.ir)).not.toContain('AUTHORED');
    expect(canonicalJson(analyzed.ir)).not.toContain('anchorHint');
  });
});

describe('liftV1 — 영속된 v1 행의 읽기 경로 승격', () => {
  const analyzed = engine.analyzeDocument({ bytes: synthHwpx('valid') });

  it('origin 주입 외에는 아무 값도 바꾸지 않는다(승격 후 v2 원본과 동일)', () => {
    const lifted = liftV1(downgradeToV1(analyzed.ir));
    expect(canonicalJson(lifted)).toBe(canonicalJson(JSON.parse(canonicalJson(analyzed.ir))));
    // ID·앵커·텍스트가 그대로여야 ir_hash가 의미를 유지한다.
    expect(documentIrHash(lifted)).toBe(documentIrHash(analyzed.ir));
  });

  it('표 셀 내부 문단까지 재귀적으로 승격한다', () => {
    const lifted = liftV1(downgradeToV1(analyzed.ir));
    const table = lifted.sections[0].blocks.find((block) => block.kind === 'TABLE');
    expect(table).toBeDefined();
    if (table?.kind !== 'TABLE') return;
    for (const cell of table.rows[0].cells) {
      for (const inner of cell.blocks) expect(inner.origin).toBe('SOURCE');
    }
  });

  it('이미 v2면 그대로 돌려준다(멱등, 참조 동일)', () => {
    expect(liftV1(analyzed.ir)).toBe(analyzed.ir);
  });
});

describe('불변 트리 연산', () => {
  const fx = editFixture();
  const first = fx.ir.sections[0].blocks[2];
  const firstId = blockId(first);

  const authored: BlockIR = {
    kind: 'PARAGRAPH',
    origin: 'AUTHORED',
    paragraphId: 'P-NEW',
    runs: [{ runId: 'R-NEW', text: '새', charPrId: null, controls: [] }],
    styleRef: { paraPrId: null, charPrId: null, numberingId: null, styleId: null },
    editState: { editedByUser: true, locked: false },
    anchorHint: { relation: 'AFTER', ref: firstId },
  };

  it('insertAt은 입력 IR을 건드리지 않는다', () => {
    const snapshot = canonicalJson(fx.ir);
    const next = insertAt(fx.ir, { relation: 'AFTER', ref: firstId }, [authored]);
    expect(next).not.toBeNull();
    expect(canonicalJson(fx.ir)).toBe(snapshot);
    expect(indexDocument(next as never).blocks.has('P-NEW')).toBe(true);
  });

  it('없는 기준 노드에는 삽입하지 않고 null을 돌려준다', () => {
    expect(insertAt(fx.ir, { relation: 'AFTER', ref: 'P-없음' }, [authored])).toBeNull();
  });

  it('FIRST_CHILD/LAST_CHILD는 컨테이너(섹션·셀) ID를 기준으로 한다', () => {
    const sectionId = fx.ir.sections[0].sectionId;
    const head = insertAt(fx.ir, { relation: 'FIRST_CHILD', ref: sectionId }, [authored]);
    expect(head && blockId(head.sections[0].blocks[0])).toBe('P-NEW');
    const cellId = [...fx.index.cells.keys()][0];
    const inCell = insertAt(fx.ir, { relation: 'LAST_CHILD', ref: cellId }, [authored]);
    expect(inCell && indexDocument(inCell).blocks.get('P-NEW')?.cellId).toBe(cellId);
  });

  it('replaceBlock/removeBlocks도 원본을 보존한다', () => {
    const snapshot = canonicalJson(fx.ir);
    expect(replaceBlock(fx.ir, firstId, [])).not.toBeNull();
    expect(removeBlocks(fx.ir, new Set([firstId])).removed).toBe(1);
    expect(canonicalJson(fx.ir)).toBe(snapshot);
  });

  it('blocksBetween은 컨테이너가 다르면 빈 배열이다(표 경계)', () => {
    const cellParagraphId = [...fx.index.blocks.values()].find(
      (entry) => entry.cellId !== null && entry.block.kind === 'PARAGRAPH',
    )?.block;
    expect(cellParagraphId).toBeDefined();
    expect(blocksBetween(fx.index, firstId, blockId(cellParagraphId as BlockIR))).toEqual([]);
  });

  it('normalizeAnchorHints는 힌트를 트리에서 다시 계산한다', () => {
    const inserted = insertAt(fx.ir, { relation: 'AFTER', ref: firstId }, [
      { ...authored, anchorHint: { relation: 'AFTER', ref: '거짓말' } },
    ]);
    const normalized = normalizeAnchorHints(inserted as never);
    const entry = indexDocument(normalized).blocks.get('P-NEW');
    if (entry?.block.kind !== 'PARAGRAPH' || entry.block.origin !== 'AUTHORED') {
      throw new Error('신규 문단을 찾지 못했습니다');
    }
    expect(entry.block.anchorHint).toEqual({ relation: 'AFTER', ref: firstId });
  });
});
