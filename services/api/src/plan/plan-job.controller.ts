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
import { ApiError } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { JobSseService } from './job-sse.service';
import { TocJobService, type JobResource } from './toc-job.service';

const MAX_REASON_LENGTH = 500;

/**
 * 이 컨트롤러가 다루는 잡 유형 (CC-240 검토 B2).
 *
 * `generation_job`은 도메인을 가리지 않으므로 유형을 명시하지 않으면
 * `PLAN_READ`/`PLAN_GENERATE`로 SOP 잡을 읽고 끄게 된다. 반대 방향은
 * `sop-job.controller.ts`가 막는다.
 */
const PLAN_JOB_TYPES = ['TOC', 'CONTENT', 'AI_EDIT'] as const;

interface ReasonBody {
  reason?: unknown;
  blockIds?: unknown;
}

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

/** UNE-PLAN-010 / 011 / 012 / 013. Job resources are addressed globally by
 * jobId (not nested under the plan), matching the contract paths. */
@Controller('plan-jobs')
export class PlanJobController {
  constructor(
    @Inject(TocJobService) private readonly jobs: TocJobService,
    @Inject(JobSseService) private readonly sse: JobSseService,
  ) {}

  /** UNE-PLAN-010 */
  @Get(':jobId')
  @RequirePermission('PLAN_READ')
  async getJob(
    @Req() req: ApiRequest,
    @Param('jobId') jobId: string,
  ): Promise<SuccessEnvelope<JobResource>> {
    return ok(
      req,
      await this.jobs.getJob(requireAuth(req), uuidParam('jobId', jobId), PLAN_JOB_TYPES),
    );
  }

  /** UNE-PLAN-011. Hand-rolled SSE instead of @Sse(): Nest's SSE path does
   * NOT await an async handler (router-execution-context passes the promise
   * straight into SseStream), so a 404 would be swallowed into an in-stream
   * error frame after a committed 200. Resolving the observable BEFORE
   * touching the response keeps JOB-404-001 a normal JSON envelope. */
  @Get(':jobId/events')
  @RequirePermission('PLAN_READ')
  async events(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('jobId') jobId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Promise<void> {
    const stream = await this.sse.stream(
      requireAuth(req),
      uuidParam('jobId', jobId),
      PLAN_JOB_TYPES,
      lastEventId,
    );

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Proxies must not buffer an event stream.
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

  /** UNE-PLAN-012 */
  @Post(':jobId/cancel')
  @RequirePermission('PLAN_GENERATE')
  @Idempotent({ required: true, successStatus: 202 })
  @HttpCode(202)
  async cancel(
    @Req() req: ApiRequest,
    @Param('jobId') jobId: string,
    @Body() body: ReasonBody | undefined,
  ): Promise<SuccessEnvelope<JobResource>> {
    const id = uuidParam('jobId', jobId);
    const reason = parseReason(body?.reason);
    return ok(
      req,
      await this.jobs.cancelJob(requireAuth(req), id, reason, requestMeta(req), PLAN_JOB_TYPES),
    );
  }

  /** UNE-PLAN-013. blockIds is accepted by the schema (RPT-002 field) and
   * rejected by the service for TOC jobs (400 PLAN-4001). */
  @Post(':jobId/retry')
  @RequirePermission('PLAN_GENERATE')
  @Idempotent({ required: true, successStatus: 202 })
  @HttpCode(202)
  async retry(
    @Req() req: ApiRequest,
    @Param('jobId') jobId: string,
    @Body() body: ReasonBody | undefined,
  ): Promise<SuccessEnvelope<JobResource>> {
    const id = uuidParam('jobId', jobId);
    const reason = parseReason(body?.reason);
    return ok(
      req,
      await this.jobs.retryJob(
        requireAuth(req),
        id,
        { ...(reason ? { reason } : {}), blockIds: body?.blockIds },
        requestMeta(req),
      ),
    );
  }
}
