import { NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api-error';
import { ApiErrorFilter } from './api-error.filter';
import { createLogger } from './observability/logger';
import { MetricsRegistry } from './observability/metrics';

/**
 * CC-430: 필터가 로거·메트릭을 받는다. 시험에서는 줄을 버리는 sink를 준다 —
 * 여기서 확인할 것은 **응답 본문**이고, 로그 내용은 관측성 e2e가 본다.
 */
const filter = (): ApiErrorFilter =>
  new ApiErrorFilter(createLogger({ service: 'test', sink: () => {} }), new MetricsRegistry());

interface Sent {
  status?: number;
  body?: Record<string, unknown>;
}

function hostFor(sent: Sent, req: Record<string, unknown> = {}): ArgumentsHost {
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
      return this;
    },
  };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ArgumentsHost;
}

const ERROR_CODE_RE = /^[A-Z]+-[0-9]{3,4}(-[0-9]{3})?$/;

describe('ApiErrorFilter', () => {
  it('maps ApiError to the common-error envelope', () => {
    const sent: Sent = {};
    filter().catch(
      new ApiError(403, 'COM-0403', '접근 권한이 없습니다.', { userAction: '권한 요청' }),
      hostFor(sent, { requestId: 'req_1', correlationId: 'corr_1' }),
    );
    expect(sent.status).toBe(403);
    const body = sent.body as {
      success: boolean;
      error: { code: string; message: string; recoverable: boolean; userAction: string };
      meta: { requestId: string; correlationId: string; timestamp: string; schemaVersion: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('COM-0403');
    expect(body.error.code).toMatch(ERROR_CODE_RE);
    expect(body.error.userAction).toBe('권한 요청');
    expect(body.meta.requestId).toBe('req_1');
    expect(body.meta.correlationId).toBe('corr_1');
    expect(body.meta.schemaVersion).toBe('1.0');
    expect(() => new Date(body.meta.timestamp).toISOString()).not.toThrow();
  });

  it('maps Nest HttpException with a pattern-conformant code', () => {
    const sent: Sent = {};
    filter().catch(new NotFoundException(), hostFor(sent));
    expect(sent.status).toBe(404);
    const error = (sent.body as { error: { code: string; recoverable: boolean } }).error;
    expect(error.code).toBe('COM-0404');
    expect(error.code).toMatch(ERROR_CODE_RE);
    expect(error.recoverable).toBe(true);
  });

  it('hides internals for unexpected errors and still fills meta', () => {
    const sent: Sent = {};
    filter().catch(new Error('secret detail'), hostFor(sent));
    expect(sent.status).toBe(500);
    const body = sent.body as { error: { code: string; message: string }; meta: object };
    expect(body.error.code).toBe('COM-0001');
    expect(body.error.message).not.toContain('secret detail');
    expect(body.meta).toBeDefined();
  });
});
