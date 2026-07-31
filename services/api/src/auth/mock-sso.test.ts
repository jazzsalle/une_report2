import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../common/api-error';
import { buildMockExternalToken, parseMockExternalToken } from './mock-sso';

describe('mock external token', () => {
  it('round-trips tenantId/loginId', () => {
    const identity = { tenantId: randomUUID(), loginId: 'demo-admin' };
    expect(parseMockExternalToken(buildMockExternalToken(identity))).toEqual(identity);
  });

  it.each([
    ['no prefix', 'bm90LW1vY2s'],
    ['not JSON', 'mock.!!!'],
    ['not an object', `mock.${Buffer.from('"x"').toString('base64url')}`],
    [
      'tenantId not a uuid',
      `mock.${Buffer.from(JSON.stringify({ tenantId: 'x', loginId: 'a' })).toString('base64url')}`,
    ],
    [
      'missing loginId',
      `mock.${Buffer.from(JSON.stringify({ tenantId: randomUUID() })).toString('base64url')}`,
    ],
    [
      'empty loginId',
      `mock.${Buffer.from(JSON.stringify({ tenantId: randomUUID(), loginId: '' })).toString('base64url')}`,
    ],
    [
      'oversized loginId',
      `mock.${Buffer.from(JSON.stringify({ tenantId: randomUUID(), loginId: 'x'.repeat(101) })).toString('base64url')}`,
    ],
  ])('rejects %s with AUTH-1001', (_label, token) => {
    try {
      parseMockExternalToken(token);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe('AUTH-1001');
    }
  });
});
