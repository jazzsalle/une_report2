import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import type { Response } from 'express';
import type { ApiRequest } from '../request-context';
import { LOGGER, type StructuredLogger } from './logger.provider';
import { METRICS, type MetricsRegistry } from './metrics';

/**
 * 요청 한 줄 로그 + 지연 메트릭 (CC-430).
 *
 * 한 요청이 무엇이었고 얼마나 걸렸고 어떤 상태로 끝났는지를 **한 줄로** 남긴다.
 * 흩어진 `console.warn`으로는 "느린 요청"이나 "403이 몰리는 경로"를 물을 수 없다.
 *
 * 경로 라벨은 **템플릿**이다(`/situations/:id`). 실제 경로를 쓰면 UUID마다
 * 시계열이 생겨 수집기가 감당하지 못한다. Nest/Express가 매칭한 라우트를 쓰고,
 * 없으면(404 등) `unmatched`로 접는다 — 알 수 없는 경로를 그대로 라벨에 넣는
 * 것은 외부에서 시계열을 만들 수 있게 열어 두는 것과 같다.
 */
@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  constructor(
    @Inject(LOGGER) private readonly logger: StructuredLogger,
    @Inject(METRICS) private readonly metrics: MetricsRegistry,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<ApiRequest>();
    const res = http.getResponse<Response>();
    const started = Date.now();

    const finish = (): void => {
      const durationMs = Date.now() - started;
      const route = routeTemplate(req);
      const status = res.statusCode;

      this.metrics.observeRequest(route, req.method, status, durationMs);

      // 본문·헤더는 남기지 않는다. 남길 것은 **누가 무엇을 얼마나**뿐이고,
      // 그 이상은 규칙이 금지한다(.claude/rules/backend.md).
      this.logger.info('http', {
        requestId: req.requestId,
        correlationId: req.correlationId,
        tenantId: req.auth?.tenantId ?? null,
        userId: req.auth?.userId ?? null,
        method: req.method,
        route,
        status,
        durationMs,
      });
    };

    return next.handle().pipe(
      tap({
        next: finish,
        // 오류도 응답이다 — 예외 필터가 상태 코드를 정한 뒤에 세야 하므로
        // 여기서는 필터가 이미 끝난 시점(res.statusCode)을 읽는다.
        error: finish,
      }),
    );
  }
}

/**
 * 시계열 라벨로 쓸 경로.
 *
 * Express가 매칭한 라우트 경로를 쓴다. 매칭되지 않았으면 `unmatched` —
 * 임의 경로를 라벨에 넣으면 외부에서 시계열을 무한히 만들 수 있다.
 */
function routeTemplate(req: ApiRequest): string {
  const route = (req as unknown as { route?: { path?: string } }).route?.path;
  if (typeof route === 'string' && route.length > 0) {
    const base = (req as unknown as { baseUrl?: string }).baseUrl ?? '';
    return `${base}${route}` || route;
  }
  return 'unmatched';
}
