import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { executionErrors } from './execution-errors';
import {
  ExecutionService,
  type DashboardResource,
  type ExecutionEventDetailResource,
  type ExecutionEventPageResource,
  type ExecutionEventResource,
} from './execution.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 200;
const MAX_REASON = 2000;
const MAX_REPLACEMENT_FIELDS = 30;
const AGGREGATE_TYPES = ['TASK', 'SOP_RUN', 'DISPATCH'];

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function isoDate(v: unknown, field: string, violations: ErrorViolation[]): Date | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') {
    violations.push({ field, reason: 'ISO-8601 문자열이어야 합니다.' });
    return null;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    violations.push({ field, reason: '읽을 수 없는 시각입니다.' });
    return null;
  }
  return d;
}

function paging(
  page: string | undefined,
  size: string | undefined,
  violations: ErrorViolation[],
): { page: number; size: number } {
  const p = page ? Number(page) : 1;
  const s = size ? Number(size) : 50;
  if (!Number.isInteger(p) || p < 1) violations.push({ field: 'page', reason: '1 이상의 정수.' });
  if (!Number.isInteger(s) || s < 1 || s > MAX_PAGE_SIZE) {
    violations.push({ field: 'size', reason: `1~${MAX_PAGE_SIZE} 사이여야 합니다.` });
  }
  return { page: p, size: s };
}

/** UNE-JNL-001·002 — 상황 단위 조회. */
@Controller('situations')
export class SituationBoardController {
  constructor(@Inject(ExecutionService) private readonly execution: ExecutionService) {}

  /**
   * 전자상황판 집계.
   *
   * `at`을 주면 **그 시점의 판**을 낸다 — 이벤트를 재생해 복원하므로 "그때
   * 지휘소가 무엇을 보고 있었는가"에 답할 수 있다(ADR-43 D1).
   */
  @Get(':id/dashboard')
  @RequirePermission('DASHBOARD_READ')
  async dashboard(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Query('at') at?: string,
    @Query('runId') runId?: string,
  ): Promise<SuccessEnvelope<DashboardResource>> {
    const auth = requireAuth(req);
    const situationId = uuidParam('id', id);
    const violations: ErrorViolation[] = [];
    const atDate = isoDate(at, 'at', violations);
    if (runId !== undefined && runId !== '' && !UUID.test(runId)) {
      violations.push({ field: 'runId', reason: 'UUID여야 합니다.' });
    }
    if (violations.length > 0) throw executionErrors.invalidDashboardQuery(violations);

    return ok(
      req,
      await this.execution.getDashboard(auth, situationId, {
        at: atDate,
        runId: runId && runId !== '' ? runId : null,
      }),
    );
  }

  /** Execution Log 조회. */
  @Get(':id/execution-events')
  @RequirePermission('EXECUTION_READ')
  async events(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type?: string,
    @Query('actor') actor?: string,
    @Query('aggregateType') aggregateType?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<SuccessEnvelope<ExecutionEventPageResource>> {
    const auth = requireAuth(req);
    const situationId = uuidParam('id', id);
    const violations: ErrorViolation[] = [];
    const fromDate = isoDate(from, 'from', violations);
    const toDate = isoDate(to, 'to', violations);
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      violations.push({ field: 'from', reason: 'from이 to보다 늦습니다.' });
    }
    if (actor !== undefined && actor !== '' && !UUID.test(actor)) {
      violations.push({ field: 'actor', reason: 'UUID여야 합니다.' });
    }
    if (type !== undefined && type !== '' && type.length > 50) {
      violations.push({ field: 'type', reason: '50자 이하여야 합니다.' });
    }
    if (
      aggregateType !== undefined &&
      aggregateType !== '' &&
      !AGGREGATE_TYPES.includes(aggregateType)
    ) {
      violations.push({
        field: 'aggregateType',
        reason: `${AGGREGATE_TYPES.join('/')} 중에서 고르십시오.`,
      });
    }
    const { page: pageNo, size: pageSize } = paging(page, size, violations);
    if (violations.length > 0) throw executionErrors.invalidLogQuery(violations);

    return ok(
      req,
      await this.execution.listEvents(auth, situationId, {
        from: fromDate,
        to: toDate,
        eventType: type && type !== '' ? type : null,
        actorId: actor && actor !== '' ? actor : null,
        aggregateType: aggregateType && aggregateType !== '' ? aggregateType : null,
        page: pageNo,
        size: pageSize,
      }),
    );
  }
}

/** UNE-JNL-003·004 — 이벤트 단위. */
@Controller('execution-events')
export class ExecutionEventController {
  constructor(@Inject(ExecutionService) private readonly execution: ExecutionService) {}

  @Get(':eventId')
  @RequirePermission('EXECUTION_READ')
  async detail(
    @Req() req: ApiRequest,
    @Param('eventId') eventId: string,
  ): Promise<SuccessEnvelope<ExecutionEventDetailResource>> {
    const auth = requireAuth(req);
    return ok(req, await this.execution.getEvent(auth, uuidParam('eventId', eventId)));
  }

  /**
   * 정정 Event 추가.
   *
   * 원본은 그대로 남는다. `replacementFields`는 **부분 패치**로 받고 서버가
   * 유효 payload와 병합해 완성본을 저장한다 — 읽는 쪽이 체인을 재생하지
   * 않아도 되게.
   */
  @Post(':eventId/corrections')
  @RequirePermission('EXECUTION_CORRECT')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async correct(
    @Req() req: ApiRequest,
    @Param('eventId') eventId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<ExecutionEventResource>> {
    const auth = requireAuth(req);
    const id = uuidParam('eventId', eventId);
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (reason.length === 0 || reason.length > MAX_REASON) {
      violations.push({ field: 'reason', reason: `1~${MAX_REASON}자의 정정 사유가 필요합니다.` });
    }
    const replacementFields = rec(b.replacementFields);
    if (Object.keys(replacementFields).length > MAX_REPLACEMENT_FIELDS) {
      violations.push({
        field: 'replacementFields',
        reason: `${MAX_REPLACEMENT_FIELDS}개 이하여야 합니다.`,
      });
    }
    if (violations.length > 0) throw executionErrors.invalidCorrectionRequest(violations);

    return ok(
      req,
      await this.execution.correct(auth, id, { reason, replacementFields }, requestMeta(req)),
    );
  }
}
