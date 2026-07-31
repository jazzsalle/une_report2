import { randomBytes } from 'node:crypto';
import type { ApiRequest } from './request-context';

export interface ResponseMeta {
  requestId: string;
  correlationId: string;
  timestamp: string;
  schemaVersion: '1.0';
}

export function metaFor(req: Partial<ApiRequest> | undefined): ResponseMeta {
  return {
    requestId: req?.requestId ?? `req_${randomBytes(8).toString('hex')}`,
    correlationId: req?.correlationId ?? `corr_${randomBytes(8).toString('hex')}`,
    timestamp: new Date().toISOString(),
    schemaVersion: '1.0',
  };
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export function ok<T>(req: ApiRequest, data: T): SuccessEnvelope<T> {
  return { success: true, data, meta: metaFor(req) };
}
