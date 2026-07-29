import { describe, expect, it } from 'vitest';
import { asTenantId, isUuid, newIdempotencyKey } from './ids';

describe('ids', () => {
  it('generates UUID idempotency keys', () => {
    const key = newIdempotencyKey();
    expect(isUuid(key)).toBe(true);
  });

  it('generates distinct keys per call', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it('accepts a valid tenant UUID', () => {
    const id = asTenantId('123e4567-e89b-42d3-a456-426614174000');
    expect(isUuid(id)).toBe(true);
  });

  it('rejects a non-UUID tenant id', () => {
    expect(() => asTenantId('tenant-1')).toThrow(/must be a UUID/);
  });
});
