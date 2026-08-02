import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromContentResponse, toPlanContentData } from './legacy-content-mapper';
import { LegacyContentResponseError } from './legacy-content-response.guard';

const FIXTURE_DIR = resolve(
  process.cwd(),
  '..',
  '..',
  'tests',
  'contract',
  'fixtures',
  't3q-legacy',
);

const planContext = {
  subject: '2026년 폭염 대비 안전관리 계획',
  backgroundInfo: { disasterType: '폭염', controlPhase: '대비', location: null },
  purposeOfDocument: { goalOfBusiness: '폭염 피해 최소화', role: '담당자', targetAudiences: [] },
  internalNote: undefined,
};

const outline = [
  { nodeKey: 'n-1', title: 'Ⅰ. 개요', children: [{ nodeKey: 'n-1-1', title: '1. 추진 배경' }] },
  { nodeKey: 'u-abcd1234', title: 'Ⅱ. 대비 대책' },
];

describe('toPlanContentData', () => {
  it('reuses the PlanTocData field rules and appends sections + stream', () => {
    const body = toPlanContentData(planContext, outline, true);
    expect(body.data.subject).toBe(planContext.subject);
    expect(body.data.stream).toBe(true);
    expect(body.data.sections).toEqual([
      { name: 'Ⅰ. 개요', children: [{ name: '1. 추진 배경', children: [] }] },
      { name: 'Ⅱ. 대비 대책', children: [] },
    ]);
    // null values are omitted (legacy fields are plain strings).
    expect('location' in (body.data.backgroundInfo as Record<string, unknown>)).toBe(false);
  });

  it('never sends UNE node keys to the provider', () => {
    expect(JSON.stringify(toPlanContentData(planContext, outline, false))).not.toContain('nodeKey');
  });
});

describe('fromContentResponse', () => {
  it('maps the CC-115 response fixture to canonical ContentDrafts', () => {
    const raw = JSON.parse(
      readFileSync(resolve(FIXTURE_DIR, 'rpt-002.response.valid.json'), 'utf8'),
    );
    const sections = fromContentResponse(raw);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('Ⅰ. 개요');
    expect(sections[0].children[0]).toMatchObject({
      title: '1. 추진 배경',
      citations: [
        {
          sourceRef: 'ref-001',
          fileName: '행정안전부_폭염대응지침_2026.pdf',
          page: '12',
        },
      ],
    });
    // Legacy has no stable ids — nodeKey stays unset.
    expect(sections[0].nodeKey).toBeUndefined();
  });

  it('rejects malformed responses before mapping (guard-first rule)', () => {
    expect(() => fromContentResponse({ sections: [{ name: 'x' }] })).toThrow(
      LegacyContentResponseError,
    );
    expect(() => fromContentResponse({ sections: 'nope' })).toThrow(/array/);
    expect(() =>
      fromContentResponse({
        sections: [{ name: 'x', content: 'y', references: [{ id: 1 }], children: [] }],
      }),
    ).toThrow(/id must be a string/);
  });
});
