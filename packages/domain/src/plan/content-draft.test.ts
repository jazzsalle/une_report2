import { describe, expect, it } from 'vitest';
import { validateContentDrafts, type ContentDraft } from './content-draft';

const section = (title: string, children: ContentDraft[] = []): ContentDraft => ({
  title,
  text: '',
  citations: [],
  children,
});

describe('validateContentDrafts', () => {
  it('accepts a normal nested structure', () => {
    expect(
      validateContentDrafts([section('Ⅰ. 개요', [section('1. 추진 배경')]), section('Ⅱ. 대책')]),
    ).toEqual([]);
  });

  it('rejects an empty tree and empty titles with paths', () => {
    expect(validateContentDrafts([])).toEqual([{ code: 'EMPTY_TREE', path: '/' }]);
    expect(validateContentDrafts([section(' ')])).toEqual([{ code: 'EMPTY_TITLE', path: '/0' }]);
  });

  it('rejects excessive depth', () => {
    let node = section('leaf');
    for (let i = 0; i < 7; i += 1) node = section(`d${i}`, [node]);
    const issues = validateContentDrafts([node]);
    expect(issues.some((issue) => issue.code === 'DEPTH_EXCEEDED')).toBe(true);
  });

  it('rejects oversized trees', () => {
    const sections = Array.from({ length: 501 }, (_, i) => section(`s${i}`));
    expect(validateContentDrafts(sections).some((i) => i.code === 'TOO_MANY_SECTIONS')).toBe(true);
  });
});
