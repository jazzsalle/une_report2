import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface AuthContext {
  userId: string;
  tenantId: string;
  sessionId: string;
  /** Filled lazily by PermissionsGuard; reused within the request. */
  permissions?: string[];
}

export interface ApiRequest extends Request {
  requestId: string;
  correlationId: string;
  auth?: AuthContext;
}

// audit_log.correlation_id is varchar(80); anything longer or with unexpected
// characters would abort the audit INSERT (and with it the login transaction),
// so a non-conforming client value is replaced, never truncated in place.
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,80}$/;

/** Assigns requestId/correlationId before any guard or handler runs. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const r = req as ApiRequest;
  r.requestId = `req_${randomBytes(8).toString('hex')}`;
  const header = req.headers['x-correlation-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  r.correlationId =
    candidate && SAFE_CORRELATION_ID.test(candidate)
      ? candidate
      : `corr_${randomBytes(8).toString('hex')}`;
  res.setHeader('X-Correlation-Id', r.correlationId);
  next();
}
