import { describe, expect, it } from 'vitest';
import type { ContentDraft } from './content-draft';
import {
  anchorContentDrafts,
  generatedBlockContentHash,
  outlineCoordinates,
} from './generated-block';
import type { TocNodeDraft } from './toc-tree';

const outline: TocNodeDraft[] = [
  {
    nodeKey: 'n-1',
    title: 'Ⅰ. 개요',
    children: [{ nodeKey: 'n-1-1', title: '1. 추진 배경', children: [] }],
  },
  { nodeKey: 'n-2', title: 'Ⅱ. 대비 대책', children: [] },
];

const draft = (title: string, children: ContentDraft[] = [], text = '□ 본문'): ContentDraft => ({
  title,
  text,
  citations: [],
  children,
});

describe('anchorContentDrafts (legacy has no stable ids — double match)', () => {
  it('anchors a mirroring response tree with node keys, levels, and order', () => {
    const result = anchorContentDrafts(outline, [
      draft('Ⅰ. 개요', [draft('1. 추진 배경')], ''),
      draft('Ⅱ. 대비 대책'),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.anchored.map((b) => [b.nodeKey, b.outlineLevel, b.sortOrder])).toEqual([
      ['n-1', 1, 1],
      ['n-1-1', 2, 2],
      ['n-2', 1, 3],
    ]);
    // The OUTLINE title is authoritative on the persisted block.
    expect(result.anchored[0].title).toBe('Ⅰ. 개요');
  });

  it('tolerates whitespace-only title differences', () => {
    const result = anchorContentDrafts(outline, [
      draft('  Ⅰ.   개요 ', [draft('1. 추진 배경')]),
      draft('Ⅱ. 대비 대책'),
    ]);
    expect(result.issues).toEqual([]);
  });

  it('quarantines the WHOLE response on a title mismatch (no partial acceptance)', () => {
    const result = anchorContentDrafts(outline, [
      draft('완전히 다른 제목', [draft('1. 추진 배경')]),
      draft('Ⅱ. 대비 대책'),
    ]);
    expect(result.anchored).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: 'TITLE_MISMATCH', nodeKey: 'n-1' });
  });

  it('flags blocks outside the outline as OUT_OF_OUTLINE (US-PLAN-012 E-02)', () => {
    const result = anchorContentDrafts(outline, [
      draft('Ⅰ. 개요', [draft('1. 추진 배경')]),
      draft('Ⅱ. 대비 대책'),
      draft('Ⅲ. 유령 섹션'),
    ]);
    expect(result.anchored).toEqual([]);
    expect(result.issues[0].code).toBe('OUT_OF_OUTLINE');
  });

  it('flags missing response nodes as COUNT_MISMATCH', () => {
    const result = anchorContentDrafts(outline, [draft('Ⅰ. 개요', [draft('1. 추진 배경')])]);
    expect(result.issues[0]).toMatchObject({ code: 'COUNT_MISMATCH', path: '/' });
  });

  it('rejects outline nodes without node keys', () => {
    const bare: TocNodeDraft[] = [{ title: '키 없는 노드' }];
    const result = anchorContentDrafts(bare, [draft('키 없는 노드')]);
    expect(result.issues[0].code).toBe('MISSING_NODE_KEY');
  });

  // ── review B-1/F2: scoped anchoring must keep FULL-outline coordinates ──

  it('outlineCoordinates assigns absolute level and global pre-order position', () => {
    const coords = outlineCoordinates(outline);
    expect(coords.get('n-1')).toEqual({ outlineLevel: 1, sortOrder: 1 });
    expect(coords.get('n-1-1')).toEqual({ outlineLevel: 2, sortOrder: 2 });
    expect(coords.get('n-2')).toEqual({ outlineLevel: 1, sortOrder: 3 });
  });

  it('a pruned subtree anchored WITH coordinates keeps absolute positions', () => {
    const coords = outlineCoordinates(outline);
    // Scoped regeneration of the level-2 node alone: without coordinates
    // this would persist as level 1 / sortOrder 1 — permanent structural
    // damage in immutable rows (review B-1/F2).
    const scoped: TocNodeDraft[] = [{ nodeKey: 'n-1-1', title: '1. 추진 배경', children: [] }];
    const result = anchorContentDrafts(scoped, [draft('1. 추진 배경')], coords);
    expect(result.issues).toEqual([]);
    expect(result.anchored).toHaveLength(1);
    expect(result.anchored[0]).toMatchObject({ nodeKey: 'n-1-1', outlineLevel: 2, sortOrder: 2 });

    const scopedTail: TocNodeDraft[] = [{ nodeKey: 'n-2', title: 'Ⅱ. 대비 대책', children: [] }];
    const tail = anchorContentDrafts(scopedTail, [draft('Ⅱ. 대비 대책')], coords);
    expect(tail.anchored[0]).toMatchObject({ nodeKey: 'n-2', outlineLevel: 1, sortOrder: 3 });
  });

  it('quarantines when a node is missing from the coordinate map', () => {
    const coords = outlineCoordinates(outline);
    const ghost: TocNodeDraft[] = [{ nodeKey: 'n-9', title: '유령', children: [] }];
    const result = anchorContentDrafts(ghost, [draft('유령')], coords);
    expect(result.anchored).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: 'MISSING_NODE_KEY', nodeKey: 'n-9' });
  });
});

describe('generatedBlockContentHash', () => {
  it('is deterministic and sensitive to text/citations, not to order metadata', () => {
    const base = {
      nodeKey: 'n-1',
      outlineLevel: 1,
      sortOrder: 1,
      title: 'Ⅰ. 개요',
      text: '□ 본문',
      citations: [{ sourceRef: 'ref-001', fileName: 'a.pdf', page: '3' }],
    };
    const same = generatedBlockContentHash({ ...base, sortOrder: 99, outlineLevel: 2 });
    expect(generatedBlockContentHash(base)).toBe(same);
    expect(generatedBlockContentHash({ ...base, text: '□ 다른 본문' })).not.toBe(same);
    expect(generatedBlockContentHash({ ...base, citations: [] })).not.toBe(same);
  });
});
