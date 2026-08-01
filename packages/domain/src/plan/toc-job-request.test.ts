import { describe, expect, it } from 'vitest';
import { TocJobRequestError, buildTocJobRequest, parseTocJobRequest } from './toc-job-request';

const SNAPSHOT_ID = '4f81d0b6-2c53-49a7-8e14-b7a6c30d9f21';
const USER_ID = '8e14d7b2-96af-4c03-b5d8-31e7f2a90c65';
const HASH = 'a'.repeat(64);

const base = { snapshotId: SNAPSHOT_ID, contextHash: HASH, requestedBy: USER_ID };

describe('TocJobRequest (API ↔ worker seam)', () => {
  it('round-trips through JSON unchanged', () => {
    const built = buildTocJobRequest({
      ...base,
      generationOption: { additionalInstruction: '필수요소를 우선 반영' },
    });
    expect(parseTocJobRequest(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });

  it('rejects unknown fields and unknown versions', () => {
    const valid = buildTocJobRequest(base);
    expect(() => parseTocJobRequest({ ...valid, extra: 1 })).toThrow(TocJobRequestError);
    expect(() => parseTocJobRequest({ ...valid, schemaVersion: '2' })).toThrow(/version/);
  });

  it('rejects malformed ids, hashes, users, and options', () => {
    expect(() => buildTocJobRequest({ ...base, snapshotId: 'nope' })).toThrow(/UUID/);
    expect(() => buildTocJobRequest({ ...base, contextHash: 'short' })).toThrow(/hex/);
    expect(() => buildTocJobRequest({ ...base, requestedBy: 'nobody' })).toThrow(/requestedBy/);
    expect(() =>
      buildTocJobRequest({
        ...base,
        generationOption: { additionalInstruction: 'x'.repeat(2001) },
      }),
    ).toThrow(/2000/);
    expect(() =>
      parseTocJobRequest({
        schemaVersion: '1',
        ...base,
        generationOption: { bogus: true },
      }),
    ).toThrow(/unknown option/);
  });
});
