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
  type MessageEvent,
} from '@nestjs/common';
import type { Response } from 'express';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { ApiError } from '../common/api-error';
import { JobSseService } from '../plan/job-sse.service';
import { TocJobService, type JobResource } from '../plan/toc-job.service';
import { parseSopGenerationBody, SopJobService } from './sop-job.service';

/**
 * 이 컨트롤러가 다루는 잡 유형 (CC-240 검토 B2).
 *
 * 명시하지 않으면 `SOP_READ`만 가진 사용자가
 * `/sop-generation-jobs/{planJobId}/events`로 계획서 본문 이벤트를 받는다.
 */
const SOP_JOB_TYPES = ['SOP'] as const;

const MAX_REASON_LENGTH = 500;

function parseReason(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > MAX_REASON_LENGTH) {
    throw new ApiError(400, 'COM-0400', '요청 본문이 올바르지 않습니다.', {
      violations: [
        { field: 'reason', reason: `${MAX_REASON_LENGTH}자 이하의 문자열이어야 합니다.` },
      ],
    });
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * UNE-SOP-001 / UNE-SOP-002 (CC-240).
 *
 * SSE는 `JobSseService`를 그대로 쓴다 — `generation_job`/`job_event` 위의
 * 투영이고 잡 유형을 가리지 않는다. 다른 것은 **권한**뿐이다: 계획서 스트림은
 * `PLAN_READ`, 이쪽은 `SOP_READ`다.
 */
@Controller()
export class SopJobController {
  constructor(
    @Inject(SopJobService) private readonly sopJobs: SopJobService,
    @Inject(JobSseService) private readonly sse: JobSseService,
    @Inject(TocJobService) private readonly jobs: TocJobService,
  ) {}

  /** UNE-SOP-001 */
  @Post('situations/:id/sop-generation-jobs')
  @RequirePermission('SOP_GENERATE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async requestGeneration(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SuccessEnvelope<JobResource>> {
    return ok(
      req,
      await this.sopJobs.requestSopJob(
        requireAuth(req),
        uuidParam('id', id),
        parseSopGenerationBody(body),
        idempotencyKey,
        requestMeta(req),
      ),
    );
  }

  /**
   * UNE-SOP-002.
   *
   * `@Sse()`를 쓰지 않는 이유는 UNE-PLAN-011과 같다 — Nest의 SSE 경로가 async
   * 핸들러를 await하지 않아서, 200을 이미 보낸 뒤에야 404를 스트림 안 오류
   * 프레임으로 흘리게 된다.
   */
  @Get('sop-generation-jobs/:jobId/events')
  @RequirePermission('SOP_READ')
  async events(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('jobId') jobId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    const stream = await this.sse.stream(
      requireAuth(req),
      uuidParam('jobId', jobId),
      SOP_JOB_TYPES,
      lastEventId,
    );

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const subscription = stream.subscribe({
      next: (message: MessageEvent) => {
        let frame = '';
        if (message.id !== undefined) frame += `id: ${message.id}\n`;
        if (message.type !== undefined) frame += `event: ${message.type}\n`;
        frame += `data: ${typeof message.data === 'string' ? message.data : JSON.stringify(message.data)}\n\n`;
        res.write(frame);
      },
      error: () => res.end(),
      complete: () => res.end(),
    });
    req.on('close', () => subscription.unsubscribe());
  }

  /**
   * UNE-SOP-014. SOP 생성 Job 취소.
   *
   * **왜 UNE-PLAN-012를 쓰지 않는가.** 그쪽은 `PLAN_GENERATE`를 요구한다 —
   * SOP 운용자는 자기가 만든 잡을 끄지 못하고 계획서 작성자는 남의 SOP 잡을
   * 끌 수 있다(검토 B2). 그리고 `SOP-409-001`이 사용자에게 "진행 중인 Job을
   * 기다리거나 취소하십시오"라고 안내하므로, 취소 경로가 없으면 그 안내가
   * 막다른 길이 된다(검토 B1: QUEUED 잡 취소가 PLAN 404로 롤백됐다).
   *
   * 상태기계·감사·이벤트는 계획서 잡과 같은 코드를 쓴다. 다른 것은 권한과
   * 잡 유형 범위뿐이다.
   */
  @Post('sop-generation-jobs/:jobId/cancel')
  @RequirePermission('SOP_GENERATE')
  @Idempotent({ required: true, successStatus: 202 })
  @HttpCode(202)
  async cancel(
    @Req() req: ApiRequest,
    @Param('jobId') jobId: string,
    @Body() body: { reason?: unknown } | undefined,
  ): Promise<SuccessEnvelope<JobResource>> {
    return ok(
      req,
      await this.jobs.cancelJob(
        requireAuth(req),
        uuidParam('jobId', jobId),
        parseReason(body?.reason),
        requestMeta(req),
        SOP_JOB_TYPES,
      ),
    );
  }
}
