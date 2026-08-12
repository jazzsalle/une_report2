import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, type ErrorViolation } from './api-error';
import { metaFor } from './envelope';
import type { ApiRequest } from './request-context';

interface ErrorBody {
  code: string;
  message: string;
  detail: string | null;
  recoverable: boolean;
  userAction?: string;
  violations?: ErrorViolation[];
}

/** Maps every thrown error to the common-error envelope (common-error.schema.json). */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<ApiRequest | undefined>();
    const res = ctx.getResponse<Response>();

    let status = 500;
    let extraMeta: Record<string, unknown> | undefined;
    const error: ErrorBody = {
      code: 'COM-0001',
      message: '서버 오류가 발생했습니다.',
      detail: null,
      recoverable: false,
    };

    if (exception instanceof ApiError) {
      status = exception.status;
      error.code = exception.code;
      error.message = exception.message;
      error.recoverable = exception.recoverable;
      if (exception.userAction) error.userAction = exception.userAction;
      if (exception.violations) error.violations = exception.violations;
      extraMeta = exception.meta;
      // Recovery headers (CC-150: the authoritative ETag on a 409). Set before
      // res.json so a header thrown after the body would be a no-op.
      for (const [name, value] of Object.entries(exception.headers ?? {})) {
        res.setHeader(name, value);
      }
    } else if (isPayloadTooLarge(exception)) {
      // express의 `entity.too.large`는 HttpException이 아니라 그냥 500으로
      // 떨어졌다(실측). 본문이 크다는 것은 서버 결함이 아니라 요청의 문제다.
      status = 413;
      error.code = 'COM-0413';
      error.message = '요청 본문이 너무 큽니다.';
      error.recoverable = true;
      error.userAction = '내용을 줄여 다시 시도하십시오.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      error.code = `COM-${String(status).padStart(4, '0')}`;
      error.message = exception.message;
      error.recoverable = status < 500;
    } else {
      // Unexpected failure: keep internals out of the response, keep the
      // correlation id in the log so the report can be traced.
      console.error(`[une-api] unhandled error corr=${req?.correlationId ?? '-'}`, exception);
    }

    res.status(status).json({ success: false, error, meta: { ...metaFor(req), ...extraMeta } });
  }
}

/** express body-parser가 상한을 넘겼을 때 던지는 것. */
function isPayloadTooLarge(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    (exception as { type?: unknown }).type === 'entity.too.large'
  );
}
