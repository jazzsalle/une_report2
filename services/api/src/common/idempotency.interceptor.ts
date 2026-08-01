import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { from, of, throwError, type Observable } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { DatabaseService } from '../db/database.service';
import { ApiError, authErrors } from './api-error';
import { canonicalHash } from './canonical-json';
import { IDEMPOTENT, type IdempotentOptions } from './decorators';
import {
  IdempotencyRepository,
  type ClaimResult,
  type IdempotencyRequest,
} from './idempotency.repository';
import type { ApiRequest } from './request-context';

// Mirrors the contract's IdempotencyKeyRequired pattern and the varchar(100)
// column; a non-conforming key is a client defect, never silently truncated.
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,100}$/;

function missingKey(): ApiError {
  return new ApiError(400, 'COM-0400', 'Idempotency-Key 헤더가 필요합니다.', {
    violations: [{ field: 'Idempotency-Key', reason: '생성/상태변경 POST는 멱등키가 필수입니다.' }],
  });
}

function malformedKey(): ApiError {
  return new ApiError(400, 'COM-0400', 'Idempotency-Key 형식이 올바르지 않습니다.', {
    violations: [
      { field: 'Idempotency-Key', reason: '허용 문자 [A-Za-z0-9._:-], 최대 100자입니다.' },
    ],
  });
}

/** Replay-store enforcement for @Idempotent routes (ADR-23 D1). Runs after
 * the auth guards, so req.auth is always present on protected routes. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(IdempotencyRepository) private readonly repo: IdempotencyRepository,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<IdempotentOptions | undefined>(
      IDEMPOTENT,
      context.getHandler(),
    );
    if (!options) return next.handle();
    return from(this.prepare(context, options)).pipe(
      mergeMap(({ claim, record }) => {
        if (!claim) return next.handle();
        if (claim.state === 'REPLAY') {
          context.switchToHttp().getResponse<Response>().status(claim.status);
          return of(claim.body);
        }
        // CLAIMED: run the handler, then persist the outcome. A failure to
        // record a success never converts the client's response (ADR-23 D1);
        // handler errors mark the claim FAILED and re-throw unchanged.
        return next.handle().pipe(
          mergeMap((body) => from(record.success(body)).pipe(mergeMap(() => of(body)))),
          catchError((err: unknown) =>
            from(record.failure()).pipe(mergeMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }

  private warnRecordFailure(stage: string, idem: IdempotencyRequest, err: unknown): void {
    console.warn(
      `[une-api] idempotency ${stage} skipped corr=${idem.correlationId} endpoint=${idem.endpoint}: ` +
        `${err instanceof Error ? err.message : err}`,
    );
  }

  private async prepare(
    context: ExecutionContext,
    options: IdempotentOptions,
  ): Promise<{
    claim: ClaimResult | null;
    record: { success(body: unknown): Promise<void>; failure(): Promise<void> };
  }> {
    const req = context.switchToHttp().getRequest<ApiRequest>();
    if (!req.auth) throw authErrors.unauthenticated();
    const auth = req.auth;

    const header = req.headers['idempotency-key'];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key) {
      if (options.required) throw missingKey();
      return { claim: null, record: { success: async () => {}, failure: async () => {} } };
    }
    if (!SAFE_IDEMPOTENCY_KEY.test(key)) throw malformedKey();

    const idem: IdempotencyRequest = {
      tenantId: auth.tenantId,
      // Concrete path (query stripped): path parameters are resource
      // identifiers, so the same key+body against another aggregate must be a
      // separate claim, never a replay of the first resource (review B1).
      endpoint: `${req.method} ${req.originalUrl.split('?')[0]}`,
      key,
      requestHash: canonicalHash(req.body ?? null),
      correlationId: req.correlationId,
      createdBy: auth.userId,
    };

    const claim = await this.db.withTenant(auth.tenantId, (client) =>
      this.repo.claim(client, idem),
    );
    if (claim.state === 'MISMATCH') {
      throw new ApiError(409, 'COM-0409', '동일한 멱등키가 다른 요청 내용으로 사용되었습니다.', {
        userAction: '새 Idempotency-Key로 다시 요청하십시오.',
      });
    }
    if (claim.state === 'IN_FLIGHT') {
      throw new ApiError(409, 'COM-0409', '동일한 요청이 처리 중입니다.', {
        recoverable: true,
        userAction: '잠시 후 같은 Idempotency-Key로 다시 시도하십시오.',
      });
    }
    return {
      claim,
      record: {
        success: async (body: unknown) => {
          try {
            await this.db.withTenant(auth.tenantId, (client) =>
              this.repo.recordSuccess(client, idem, options.successStatus, body),
            );
          } catch (err) {
            // Response already produced; the stale-claim takeover converges
            // later retries (ADR-23 D1 accepted limit) — but the accepted
            // duplicate-window must stay observable (no key/body in the log).
            this.warnRecordFailure('record-success', idem, err);
          }
        },
        failure: async () => {
          try {
            await this.db.withTenant(auth.tenantId, (client) =>
              this.repo.recordFailure(client, idem),
            );
          } catch (err) {
            // Same reasoning: never mask the handler's own error.
            this.warnRecordFailure('record-failure', idem, err);
          }
        },
      },
    };
  }
}
