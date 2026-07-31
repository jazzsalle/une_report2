import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../common/api-error';
import {
  hashRefreshToken,
  issueRefreshToken,
  refreshTokenTenant,
  signAccessToken,
  verifyAccessToken,
} from './tokens';

const SECRET = 'unit-test-secret-unit-test-secret!!';
const claims = { userId: randomUUID(), tenantId: randomUUID(), sessionId: randomUUID() };

describe('access tokens', () => {
  it('round-trips userId/tenantId/sessionId', () => {
    const token = signAccessToken(SECRET, claims, 900);
    expect(verifyAccessToken(SECRET, token)).toEqual(claims);
  });

  it('rejects a token signed with a different key (forged issuer)', () => {
    const forged = signAccessToken('another-secret-another-secret-!!!', claims, 900);
    expect(() => verifyAccessToken(SECRET, forged)).toThrowError(ApiError);
    try {
      verifyAccessToken(SECRET, forged);
    } catch (err) {
      expect((err as ApiError).code).toBe('AUTH-1005');
      expect((err as ApiError).status).toBe(401);
    }
  });

  it('rejects a payload-tampered token (forged tenant claim)', () => {
    const token = signAccessToken(SECRET, claims, 900);
    const [header, payload, signature] = token.split('.');
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      tid: string;
    };
    body.tid = randomUUID();
    const tampered = [
      header,
      Buffer.from(JSON.stringify(body), 'utf8').toString('base64url'),
      signature,
    ].join('.');
    expect(() => verifyAccessToken(SECRET, tampered)).toThrowError(ApiError);
  });

  it('rejects an expired token', () => {
    const token = signAccessToken(SECRET, claims, -1);
    expect(() => verifyAccessToken(SECRET, token)).toThrowError(ApiError);
  });

  it('rejects the alg=none downgrade', () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: claims.userId, tid: claims.tenantId, sid: claims.sessionId }),
      'utf8',
    ).toString('base64url');
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }), 'utf8').toString(
      'base64url',
    );
    expect(() => verifyAccessToken(SECRET, `${header}.${payload}.`)).toThrowError(ApiError);
  });
});

describe('refresh tokens', () => {
  it('embeds the tenant and stores only a SHA-256 hash', () => {
    const tenantId = randomUUID();
    const { token, hash } = issueRefreshToken(tenantId);
    expect(refreshTokenTenant(token)).toBe(tenantId);
    expect(hash).toBe(hashRefreshToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(hash);
  });

  it('rejects malformed refresh tokens', () => {
    expect(refreshTokenTenant('urs.not-a-uuid.abc')).toBeNull();
    expect(refreshTokenTenant('')).toBeNull();
    expect(refreshTokenTenant(`urs.${randomUUID()}.zz`)).toBeNull();
  });
});
