import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { isSopRunMode, type SopRunMode } from '@une/domain';
import { ApiError, type ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { sopRunErrors } from './sop-run-errors';
import { SopRunService, type SopRunDetailResource, type SopRunResource } from './sop-run.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 2000;
/** 계약 LastEventId와 같은 형태 — 여기서는 epoch 밀리초다. */
const LAST_EVENT_ID = /^[0-9]{1,18}$/;

/** SSE 폴링 주기. UNE-PLAN-011과 같은 값을 쓴다. */
const POLL_MS = 400;
const HEARTBEAT_MS = 15_000;
const MAX_LIFETIME_MS = 30 * 60_000;

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw new ApiError(400, 'COM-0400', '요청 본문이 올바르지 않습니다.', {
      violations: [{ field, reason: `${MAX_TEXT}자 이하의 문자열이어야 합니다.` }],
    });
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** UNE-SOP-010 / 011 — 실행 시작(모의 포함). */
@Controller('sops')
export class SopRunStartController {
  constructor(@Inject(SopRunService) private readonly runs: SopRunService) {}

  /** UNE-SOP-010 — Dry-run. 상황 상태를 건드리지 않는다. */
  @Post(':sopId/simulations')
  @RequirePermission('SOP_RUN')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async simulate(
    @Req() req: ApiRequest,
    @Param('sopId') sopId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SopRunResource>> {
    const b = rec(body);
    const violations: ErrorViolation[] = [];
    if (typeof b.versionId !== 'string' || !UUID.test(b.versionId)) {
      violations.push({ field: 'versionId', reason: 'UUID여야 합니다.' });
    }
    if (typeof b.snapshotId !== 'string' || !UUID.test(b.snapshotId)) {
      violations.push({ field: 'snapshotId', reason: 'UUID여야 합니다.' });
    }
    if (violations.length > 0) {
      throw new ApiError(400, 'COM-0400', '요청 본문이 올바르지 않습니다.', { violations });
    }
    return ok(
      req,
      await this.runs.startRun(
        requireAuth(req),
        uuidParam('sopId', sopId),
        {
          versionId: b.versionId as string,
          snapshotId: b.snapshotId as string,
          mode: 'DRY_RUN',
          scenario: optionalText(b.scenario, 'scenario'),
        },
        requestMeta(req),
      ),
    );
  }

  /** UNE-SOP-011 — 실제 실행(LIVE/EXERCISE). */
  @Post(':sopId/runs')
  @RequirePermission('SOP_RUN')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async start(
    @Req() req: ApiRequest,
    @Param('sopId') sopId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SopRunResource>> {
    const b = rec(body);
    const violations: ErrorViolation[] = [];
    if (typeof b.approvedVersionId !== 'string' || !UUID.test(b.approvedVersionId)) {
      violations.push({ field: 'approvedVersionId', reason: 'UUID여야 합니다.' });
    }
    if (typeof b.snapshotId !== 'string' || !UUID.test(b.snapshotId)) {
      violations.push({ field: 'snapshotId', reason: 'UUID여야 합니다.' });
    }
    if (!isSopRunMode(b.mode)) {
      violations.push({ field: 'mode', reason: 'LIVE/EXERCISE/DRY_RUN 중 하나여야 합니다.' });
    } else if (b.mode === 'DRY_RUN') {
      // 모의는 전용 엔드포인트가 있다. 여기서 받으면 "실행 시작"과 "모의"가
      // 같은 감사 기록으로 남아 나중에 구분할 수 없다.
      violations.push({ field: 'mode', reason: '모의 실행은 /simulations를 사용하십시오.' });
    }
    if (violations.length > 0) {
      throw new ApiError(400, 'COM-0400', '요청 본문이 올바르지 않습니다.', { violations });
    }
    return ok(
      req,
      await this.runs.startRun(
        requireAuth(req),
        uuidParam('sopId', sopId),
        {
          versionId: b.approvedVersionId as string,
          snapshotId: b.snapshotId as string,
          mode: b.mode as SopRunMode,
        },
        requestMeta(req),
      ),
    );
  }
}

/** UNE-SOP-012~016 — 실행 조회·스트림·통제. */
@Controller('sop-runs')
export class SopRunController {
  constructor(@Inject(SopRunService) private readonly runs: SopRunService) {}

  /** UNE-SOP-012 */
  @Get(':runId')
  @RequirePermission('SOP_READ')
  async detail(
    @Req() req: ApiRequest,
    @Param('runId') runId: string,
  ): Promise<SuccessEnvelope<SopRunDetailResource>> {
    return ok(req, await this.runs.getRun(requireAuth(req), uuidParam('runId', runId)));
  }

  /**
   * UNE-SOP-013 — 실행 SSE.
   *
   * `@Sse()`를 쓰지 않는 이유는 UNE-PLAN-011·UNE-SOP-002와 같다 — Nest의 SSE
   * 경로가 async 핸들러를 await하지 않아 404가 스트림 안 오류로 밀린다.
   *
   * `execution_event`에는 순번 컬럼이 없으므로 **Last-Event-ID는 발생시각의
   * epoch 밀리초**다. 같은 밀리초의 두 이벤트는 id로 순서를 고정한다.
   */
  @Get(':runId/events')
  @RequirePermission('SOP_READ')
  async events(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('runId') runId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    const auth = requireAuth(req);
    const id = uuidParam('runId', runId);
    let cursor = parseCursor(lastEventId);

    // 헤더를 보내기 전에 존재를 확인한다 — 200을 열어 놓고 안에서 404를
    // 흘리면 이미 늦다.
    if (!(await this.runs.runExists(auth, id))) throw sopRunErrors.runNotFound();

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    const startedAt = Date.now();
    let idleTicks = 0;
    const ticksPerHeartbeat = Math.max(1, Math.round(HEARTBEAT_MS / POLL_MS));

    while (!closed && Date.now() - startedAt < MAX_LIFETIME_MS) {
      const rows = await this.runs.listEventsSince(auth, id, cursor);
      if (rows.length > 0) {
        idleTicks = 0;
        for (const row of rows) {
          cursor = row.occurredAt.getTime();
          res.write(
            `id: ${cursor}\nevent: ${row.eventType}\n` +
              `data: ${JSON.stringify({
                runId: id,
                type: row.eventType,
                payload: row.payload,
                occurredAt: row.occurredAt.toISOString(),
              })}\n\n`,
          );
        }
        // 종료 이벤트를 보내면 스트림을 닫는다 — 더 나올 것이 없다.
        if (rows.some((r) => r.eventType === 'RUN_TERMINATED')) break;
      } else {
        idleTicks += 1;
        if (idleTicks >= ticksPerHeartbeat) {
          idleTicks = 0;
          // heartbeat의 id는 커서를 되풀이한다 — 재개 지점을 흐리지 않는다.
          res.write(`id: ${cursor}\nevent: heartbeat\ndata: {}\n\n`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    res.end();
  }

  /** UNE-SOP-014 */
  @Post(':runId/pause')
  @RequirePermission('SOP_RUN_CONTROL')
  @Idempotent({ required: true, successStatus: 200 })
  @HttpCode(200)
  async pause(
    @Req() req: ApiRequest,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SopRunResource>> {
    return ok(
      req,
      await this.runs.control(
        requireAuth(req),
        uuidParam('runId', runId),
        'pause',
        optionalText(rec(body).reason, 'reason'),
        requestMeta(req),
      ),
    );
  }

  /** UNE-SOP-015 */
  @Post(':runId/resume')
  @RequirePermission('SOP_RUN_CONTROL')
  @Idempotent({ required: true, successStatus: 200 })
  @HttpCode(200)
  async resume(
    @Req() req: ApiRequest,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SopRunResource>> {
    return ok(
      req,
      await this.runs.control(
        requireAuth(req),
        uuidParam('runId', runId),
        'resume',
        optionalText(rec(body).reason, 'reason'),
        requestMeta(req),
      ),
    );
  }

  /** UNE-SOP-016 */
  @Post(':runId/terminate')
  @RequirePermission('SOP_RUN_CONTROL')
  @Idempotent({ required: true, successStatus: 200 })
  @HttpCode(200)
  async terminate(
    @Req() req: ApiRequest,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SopRunResource>> {
    const b = rec(body);
    if (typeof b.confirmCode !== 'string' || b.confirmCode.trim().length === 0) {
      throw new ApiError(400, 'COM-0400', '요청 본문이 올바르지 않습니다.', {
        violations: [{ field: 'confirmCode', reason: '필수입니다.' }],
      });
    }
    return ok(
      req,
      await this.runs.terminate(
        requireAuth(req),
        uuidParam('runId', runId),
        {
          reason: optionalText(b.reason, 'reason'),
          confirmCode: b.confirmCode.trim(),
        },
        requestMeta(req),
      ),
    );
  }
}

/** Last-Event-ID는 epoch 밀리초다. 없으면 처음부터. */
export function parseCursor(lastEventId?: string): number {
  if (lastEventId === undefined || lastEventId.trim() === '') return 0;
  const raw = lastEventId.trim();
  if (!LAST_EVENT_ID.test(raw)) {
    throw new ApiError(400, 'COM-0400', 'Last-Event-ID 헤더가 올바르지 않습니다.', {
      violations: [
        { field: 'Last-Event-ID', reason: '마지막으로 수신한 시각(밀리초)이어야 합니다.' },
      ],
    });
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new ApiError(400, 'COM-0400', 'Last-Event-ID 헤더가 올바르지 않습니다.', {
      violations: [{ field: 'Last-Event-ID', reason: '정수여야 합니다.' }],
    });
  }
  return value;
}
