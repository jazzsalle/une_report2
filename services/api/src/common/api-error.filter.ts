import {
  Catch,
  HttpException,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, type ErrorViolation } from './api-error';
import { metaFor } from './envelope';
import { LOGGER, type StructuredLogger } from './observability/logger.provider';
import { METRICS, type MetricsRegistry } from './observability/metrics';
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
  constructor(
    @Inject(LOGGER) private readonly logger: StructuredLogger,
    @Inject(METRICS) private readonly metrics: MetricsRegistry,
  ) {}

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
    } else if (isClosedSituationWrite(exception)) {
      // **종료된 훈련의 사실원장은 새 사실을 받지 않는다**(0045 §5).
      //
      // 트리거가 던지는 42501을 그대로 두면 `COM-0001 / 500 / 서버 오류`가 되어
      // 사용자는 왜 막혔는지 알 수 없고, 그것이 정상 동작이라는 사실도 모른다.
      // 종료는 정상 상태이므로 서버 오류가 아니라 선행조건 실패다.
      status = 412;
      error.code = 'SIT-412-011';
      error.message = '종료된 훈련입니다.';
      error.recoverable = false;
      error.userAction =
        '이미 종료된 훈련에는 새 사실을 기록할 수 없습니다. 잘못된 기록은 정정(UNE-JNL-004)으로 바로잡으십시오.';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      error.code = `COM-${String(status).padStart(4, '0')}`;
      error.message = exception.message;
      error.recoverable = status < 500;
    } else {
      // Unexpected failure: keep internals out of the response, keep the
      // correlation id in the log so the report can be traced.
      // 상관관계 ID와 함께 구조화해 남기고 센다 (CC-430). 응답에는 여전히
      // 내부가 나가지 않는다 — 로그와 응답은 독자가 다르다.
      this.metrics.errors.inc({ kind: 'unhandled' });
      this.logger.error('unhandled', {
        requestId: req?.requestId ?? null,
        correlationId: req?.correlationId ?? null,
        tenantId: req?.auth?.tenantId ?? null,
        route: (req as unknown as { route?: { path?: string } })?.route?.path ?? 'unmatched',
        error: exception,
      });
    }

    res.status(status).json({ success: false, error, meta: { ...metaFor(req), ...extraMeta } });
  }
}

/** express body-parser가 상한을 넘겼을 때 던지는 것. */
/**
 * 0045 §5의 가드가 던진 것인가.
 *
 * SQLSTATE만 보면 다른 42501(권한 부족)까지 삼킨다 — 그것은 배선 결함이므로
 * 500으로 남아야 한다. 메시지까지 함께 본다.
 */
function isClosedSituationWrite(exception: unknown): boolean {
  const code = (exception as { code?: string } | null)?.code;
  const message = exception instanceof Error ? exception.message : '';
  return code === '42501' && message.includes('종료된 상황에는 새 사실을 쓸 수 없다');
}

function isPayloadTooLarge(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    (exception as { type?: unknown }).type === 'entity.too.large'
  );
}
