import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fromTocResponse, toPlanTocData } from './legacy-toc-mapper';
import { LegacyTocResponseError } from './legacy-toc-response.guard';

// vitest runs with the package dir as cwd (base tsconfig is CommonJS, so
// import.meta is unavailable here).
const REPO_ROOT = resolve(process.cwd(), '..', '..');
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'tests', 'contract', 'fixtures', 't3q-legacy', name), 'utf8'),
  ) as Record<string, unknown>;

describe('toPlanTocData (gap matrix rules)', () => {
  it('reproduces the CC-115 representative request from PlanContext values', () => {
    const expected = fixture('rpt-001.request.valid.json');
    const planContext = (expected as { data: Record<string, unknown> }).data;
    expect(toPlanTocData(planContext)).toEqual(expected);
  });

  it('omits null fields instead of sending null (legacy strings reject null)', () => {
    const body = toPlanTocData({
      subject: '지진 대비 계획',
      backgroundInfo: { disasterType: '지진', controlPhase: '대비', location: null },
      purposeOfDocument: { goalOfBusiness: 'g', role: 'r', targetAudiences: ['지자체'] },
      systemPrompt: null,
    });
    const data = body.data as { backgroundInfo: Record<string, unknown> };
    expect('location' in data.backgroundInfo).toBe(false);
    expect('systemPrompt' in body.data).toBe(false);
  });

  it('never sends fields outside the PlanContext vocabulary', () => {
    const body = toPlanTocData({
      subject: 's',
      backgroundInfo: { disasterType: '폭염', controlPhase: '대비' },
      purposeOfDocument: { goalOfBusiness: 'g', role: 'r', targetAudiences: ['대민'] },
      hwpxStyleId: 'style-7',
      internalNote: '보내면 안 됨',
    });
    expect(Object.keys(body.data).sort()).toEqual([
      'backgroundInfo',
      'purposeOfDocument',
      'subject',
    ]);
  });
});

describe('fromTocResponse', () => {
  it('maps the CC-115 representative response to a keyed canonical tree', () => {
    const tree = fromTocResponse(fixture('rpt-001.response.valid.json'));
    expect(tree[0]).toMatchObject({ nodeKey: 'n-1', title: 'Ⅰ. 개요' });
    expect(tree[0].children?.[1].children?.[0]).toMatchObject({
      nodeKey: 'n-1-2-1',
      title: '가. 인명피해 최소화',
    });
    // Deterministic: same response, same keys.
    expect(fromTocResponse(fixture('rpt-001.response.valid.json'))).toEqual(tree);
  });

  it('rejects malformed provider shapes with a pathed error (validate before mapping)', () => {
    expect(() => fromTocResponse({ title: 'x', sections: [{ children: [] }] })).toThrow(
      LegacyTocResponseError,
    );
    expect(() => fromTocResponse({ sections: [] })).toThrow(/title/);
    expect(() => fromTocResponse(null)).toThrow(/object/);
  });
});
