import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { requestContextMiddleware, type ApiRequest } from './request-context';

function run(header?: string): ApiRequest {
  const req = { headers: header === undefined ? {} : { 'x-correlation-id': header } } as Request;
  const res = { setHeader: () => {} } as unknown as Response;
  requestContextMiddleware(req, res, (() => {}) as NextFunction);
  return req as ApiRequest;
}

describe('requestContextMiddleware', () => {
  it('keeps a conforming client correlation id (up to 80 chars)', () => {
    const id = 'corr_client-1.2:3'.padEnd(80, 'x');
    expect(run(id).correlationId).toBe(id);
  });

  it.each([
    ['81+ chars (audit_log column is varchar(80))', 'x'.repeat(81)],
    ['100 chars (contract max, still over DB width)', 'c'.repeat(100)],
    ['empty string', ''],
    ['control characters', 'corr\nid'],
    ['non-ascii', '상관관계아이디'],
  ])('replaces a non-conforming id: %s', (_label, header) => {
    const result = run(header).correlationId;
    expect(result).not.toBe(header);
    expect(result).toMatch(/^corr_[0-9a-f]{16}$/);
  });

  it('generates ids when the header is absent', () => {
    const req = run();
    expect(req.requestId).toMatch(/^req_[0-9a-f]{16}$/);
    expect(req.correlationId).toMatch(/^corr_[0-9a-f]{16}$/);
  });
});
