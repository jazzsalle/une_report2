import { describe, expect, it } from 'vitest';
import {
  MAX_TOC_DEPTH,
  MAX_TOC_NODES,
  assignAiNodeKeys,
  ensureUserNodeKeys,
  flattenTocTree,
  tocTreeContentHash,
  validateTocTree,
  type TocNodeDraft,
} from './toc-tree';

const tree: TocNodeDraft[] = [
  {
    title: 'Ⅰ. 개요',
    children: [
      { title: '1. 추진 배경' },
      { title: '2. 추진 목표', children: [{ title: '가. 인명피해 최소화' }] },
    ],
  },
  { title: 'Ⅱ. 대비 대책', children: [{ title: '1. 무더위쉼터 운영' }] },
];

describe('validateTocTree', () => {
  it('accepts a well-formed tree', () => {
    expect(validateTocTree(tree)).toEqual([]);
  });

  it('rejects empty trees, empty titles, and over-long titles with paths', () => {
    expect(validateTocTree([])).toEqual([{ code: 'EMPTY_TREE', path: '/' }]);
    const issues = validateTocTree([{ title: '  ' }, { title: 'x'.repeat(501) }]);
    expect(issues).toContainEqual({ code: 'EMPTY_TITLE', path: '/0' });
    expect(issues).toContainEqual({ code: 'TITLE_TOO_LONG', path: '/1' });
  });

  it('rejects depth beyond the design limit', () => {
    let node: TocNodeDraft = { title: 'leaf' };
    for (let i = 0; i < MAX_TOC_DEPTH; i += 1) node = { title: `level`, children: [node] };
    const issues = validateTocTree([node]);
    expect(issues.some((issue) => issue.code === 'DEPTH_EXCEEDED')).toBe(true);
  });

  it('rejects too many nodes', () => {
    const wide = Array.from({ length: MAX_TOC_NODES + 1 }, (_, i) => ({ title: `절 ${i}` }));
    expect(validateTocTree(wide).some((issue) => issue.code === 'TOO_MANY_NODES')).toBe(true);
  });

  it('rejects duplicate and malformed node keys', () => {
    const issues = validateTocTree([
      { title: 'a', nodeKey: 'n-1' },
      { title: 'b', nodeKey: 'n-1' },
      { title: 'c', nodeKey: '한글키' },
    ]);
    expect(issues).toContainEqual({ code: 'DUPLICATE_NODE_KEY', path: '/1' });
    expect(issues).toContainEqual({ code: 'INVALID_NODE_KEY', path: '/2' });
  });
});

describe('node keys / flatten / hash', () => {
  it('assigns deterministic path-based AI keys', () => {
    const keyed = assignAiNodeKeys(tree);
    expect(keyed[0].nodeKey).toBe('n-1');
    expect(keyed[0].children?.[1].children?.[0].nodeKey).toBe('n-1-2-1');
    expect(assignAiNodeKeys(tree)).toEqual(keyed);
  });

  it('keeps existing keys and namespaces new user keys', () => {
    const keyed = ensureUserNodeKeys([{ title: '유지', nodeKey: 'n-2' }, { title: '신규' }]);
    expect(keyed[0].nodeKey).toBe('n-2');
    expect(keyed[1].nodeKey).toMatch(/^u-[0-9a-f]{8}$/);
  });

  it('flattens parents before children with level and sortOrder', () => {
    const rows = flattenTocTree(assignAiNodeKeys(tree));
    expect(rows.map((r) => r.nodeKey)).toEqual([
      'n-1',
      'n-1-1',
      'n-1-2',
      'n-1-2-1',
      'n-2',
      'n-2-1',
    ]);
    expect(rows[0]).toMatchObject({ parentKey: null, level: 1, sortOrder: 0 });
    expect(rows[3]).toMatchObject({ parentKey: 'n-1-2', level: 3, sortOrder: 0 });
    expect(rows[4]).toMatchObject({ parentKey: null, level: 1, sortOrder: 1 });
  });

  it('hashes content identity independent of node keys', () => {
    const a = tocTreeContentHash(assignAiNodeKeys(tree));
    const b = tocTreeContentHash(ensureUserNodeKeys(tree));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(tocTreeContentHash([{ title: '다른 목차' }]));
  });
});
