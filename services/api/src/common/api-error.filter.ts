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

    res.status(status).json({ success: false, error, meta: metaFor(req) });
  }
}
