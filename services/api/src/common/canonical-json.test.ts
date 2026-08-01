import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalJson } from './canonical-json';

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

  it('distinguishes different content and produces 64-hex hashes', () => {
    const h1 = canonicalHash({ subject: 'a' });
    const h2 = canonicalHash({ subject: 'b' });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
  });

  it('drops undefined members like JSON.stringify and handles null bodies', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalJson(null)).toBe('null');
  });
});
