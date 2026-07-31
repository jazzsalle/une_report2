import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { authErrors } from '../common/api-error';

const ISSUER = 'une-api';
const AUDIENCE = 'une-platform';

export interface AccessTokenClaims {
  userId: string;
  tenantId: string;
  sessionId: string;
}

/** HS256 UNE JWT. tenantId/sessionId ride as tid/sid; forging either breaks
 * the signature, which is the tenant-claim forgery block after issuance. */
export function signAccessToken(secret: string, claims: AccessTokenClaims, ttlSec: number): string {
  return jwt.sign({ tid: claims.tenantId, sid: claims.sessionId }, secret, {
    algorithm: 'HS256',
    subject: claims.userId,
    expiresIn: ttlSec,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export function verifyAccessToken(secret: string, token: string): AccessTokenClaims {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch {
    throw authErrors.unauthenticated();
  }
  if (typeof payload === 'string') throw authErrors.unauthenticated();
  const { sub, tid, sid } = payload as { sub?: unknown; tid?: unknown; sid?: unknown };
  if (typeof sub !== 'string' || typeof tid !== 'string' || typeof sid !== 'string') {
    throw authErrors.unauthenticated();
  }
  return { userId: sub, tenantId: tid, sessionId: sid };
}

/** Opaque refresh token `urs.<tenantId>.<random>`; only its SHA-256 is stored
 * (user_session.refresh_hash). The embedded tenantId opens the RLS scope on
 * refresh; the app_user parent join rejects a forged tenant (ADR-22 D3). */
export function issueRefreshToken(tenantId: string): { token: string; hash: string } {
  const token = `urs.${tenantId}.${randomBytes(32).toString('hex')}`;
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenTenant(token: string): string | null {
  const match =
    /^urs\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[0-9a-f]{64}$/i.exec(
      token,
    );
  return match ? match[1] : null;
}
