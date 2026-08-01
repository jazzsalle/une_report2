import { ApiError, authErrors } from './api-error';
import type { ApiRequest, AuthContext } from './request-context';

/** Controller-layer helpers shared by every domain controller (lifted out of
 * plan.controller.ts in CC-120 so the TOC/job controllers reuse one
 * definition instead of copying the COM-0400 path-parameter check). */

export function requireAuth(req: ApiRequest): AuthContext {
  if (!req.auth) throw authErrors.unauthenticated();
  return req.auth;
}

/** Structurally compatible with plan.service RequestMeta; declared here so the
 * common layer keeps no dependency on a domain module. */
export interface RequestMetaLike {
  correlationId: string;
  ip?: string;
  userAgent?: string;
}

export function requestMeta(req: ApiRequest): RequestMetaLike {
  return {
    correlationId: req.correlationId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Path parameters are validated before any repository call so a malformed id
 * is a 400, never a 404 or a database type error. */
export function uuidParam(name: string, value: string): string {
  if (!UUID_RE.test(value)) {
    throw new ApiError(400, 'COM-0400', '경로 파라미터가 올바르지 않습니다.', {
      violations: [{ field: name, reason: 'UUID 형식이어야 합니다.' }],
    });
  }
  return value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
