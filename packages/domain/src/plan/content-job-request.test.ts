import { describe, expect, it } from 'vitest';
import {
  ContentJobRequestError,
  buildContentJobRequest,
  parseContentJobRequest,
} from './content-job-request';

const VALID = {
  snapshotId: 'e6b5caa4-ce89-4a8b-bc7b-5d6e7f8a9b0c',
  contextHash: 'a'.repeat(64),
  tocVersionId: 'd5a4b9f3-bd78-4f7a-ab6a-4c5d6e7f8a9b',
  tocContentHash: 'b'.repeat(64),
  requestedBy: 'c4f3a8e2-ac67-4e69-9a5f-3b4c5d6e7f8a',
};

describe('ContentJobRequest build/parse (API↔worker seam, strict)', () => {
  it('round-trips a full-outline request', () => {
    const built = buildContentJobRequest(VALID);
    expect(built.schemaVersion).toBe('1');
    expect('targetNodeKeys' in built).toBe(false);
    expect(parseContentJobRequest(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });

  it('round-trips a scoped request and rejects duplicates/invalid keys', () => {
    const built = buildContentJobRequest({ ...VALID, targetNodeKeys: ['n-1', 'u-abcd1234'] });
    expect(built.targetNodeKeys).toEqual(['n-1', 'u-abcd1234']);
    expect(() => parseContentJobRequest({ ...built, targetNodeKeys: ['n-1', 'n-1'] })).toThrow(
      /duplicate/,
    );
    expect(() => parseContentJobRequest({ ...built, targetNodeKeys: ['한글키'] })).toThrow(
      /invalid node key/,
    );
    expect(() => parseContentJobRequest({ ...built, targetNodeKeys: [] })).toThrow(/non-empty/);
  });

  it('rejects unknown fields loudly (version-pinned seam)', () => {
    const built = buildContentJobRequest(VALID);
    expect(() => parseContentJobRequest({ ...built, extra: 1 })).toThrow(ContentJobRequestError);
    expect(() => parseContentJobRequest({ ...built, schemaVersion: '2' })).toThrow(/version/);
  });

  it('validates ids and hashes', () => {
    expect(() => buildContentJobRequest({ ...VALID, tocVersionId: 'nope' })).toThrow(/UUID/);
    expect(() => buildContentJobRequest({ ...VALID, tocContentHash: 'short' })).toThrow(/64/);
  });
});
