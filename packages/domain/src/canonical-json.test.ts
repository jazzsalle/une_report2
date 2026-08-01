import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalJson, sha256Hex } from './canonical-json';

describe('sha256Hex (FIPS 180-4 vectors)', () => {
  it('matches the standard test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    // Multi-block input (>55 bytes forces a second padding block).
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes UTF-8 multibyte input (Korean vocabulary)', () => {
    // node:crypto reference value for '폭염' — pins UTF-8 handling.
    expect(sha256Hex('폭염')).toBe(
      'cae5edce7906bd65320cc9051e4162727384d258bf2f46b87f3a3166b6355e0a',
    );
  });
});

describe('canonicalJson', () => {
  it('serializes identical content identically regardless of key order', () => {
    const a = { b: 1, a: { d: [1, 2], c: 'x' } };
    const b = { a: { c: 'x', d: [1, 2] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('keeps array order significant', () => {
    expect(canonicalHash({ a: [1, 2] })).not.toBe(canonicalHash({ a: [2, 1] }));
  });

  it('produces 64-hex hashes and distinguishes content', () => {
    const h1 = canonicalHash({ subject: 'a' });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(canonicalHash({ subject: 'b' }));
  });

  it('drops undefined members like JSON.stringify and handles null', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson(null)).toBe('null');
  });
});
