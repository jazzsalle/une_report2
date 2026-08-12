import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { isDispatchChannel, type DispatchChannel } from '@une/domain';
import type { ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import {
  DispatchService,
  dispatchErrors,
  type DispatchResource,
  type DispatchStatusResource,
} from './dispatch.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 4000;
const MAX_RECIPIENTS = 500;

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** UNE-TASK-003 — 임무·상황 전파. */
@Controller('tasks')
export class TaskDispatchController {
  constructor(@Inject(DispatchService) private readonly dispatches: DispatchService) {}

  @Post(':taskId/dispatch')
  @RequirePermission('TASK_DISPATCH')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async dispatch(
    @Req() req: ApiRequest,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<DispatchResource>> {
    const b = rec(body);
    const violations: ErrorViolation[] = [];

    const channels = Array.isArray(b.channels) ? b.channels : [];
    if (channels.length === 0) {
      violations.push({ field: 'channels', reason: '채널이 하나 이상이어야 합니다.' });
    }
    if (channels.some((ch) => !isDispatchChannel(ch))) {
      violations.push({ field: 'channels', reason: 'SYSTEM/SMS/EMAIL/PUSH 중에서 고르십시오.' });
    }

    const rawRecipients = Array.isArray(b.recipients) ? b.recipients : [];
    if (rawRecipients.length === 0) {
      // 수신자가 없는 전파는 아무 데도 가지 않는다.
      violations.push({ field: 'recipients', reason: '수신자가 하나 이상이어야 합니다.' });
    }
    if (rawRecipients.length > MAX_RECIPIENTS) {
      violations.push({
        field: 'recipients',
        reason: `수신자는 ${MAX_RECIPIENTS}명 이하여야 합니다.`,
      });
    }

    const recipients: Array<{ userId: string | null; organizationId: string | null }> = [];
    for (const [index, raw] of rawRecipients.entries()) {
      const r = rec(raw);
      const userId = typeof r.userId === 'string' && UUID.test(r.userId) ? r.userId : null;
      const organizationId =
        typeof r.organizationId === 'string' && UUID.test(r.organizationId)
          ? r.organizationId
          : null;
      if (!userId && !organizationId) {
        violations.push({
          field: `recipients[${index}]`,
          reason: 'userId 또는 organizationId가 필요합니다.',
        });
        continue;
      }
      recipients.push({ userId, organizationId });
    }

    const template = b.messageTemplate;
    if (template !== undefined && template !== null) {
      if (typeof template !== 'string' || template.length > MAX_BODY) {
        violations.push({
          field: 'messageTemplate',
          reason: `${MAX_BODY}자 이하의 문자열이어야 합니다.`,
        });
      }
    }
    if (violations.length > 0) throw dispatchErrors.invalidRequest(violations);

    return ok(
      req,
      await this.dispatches.dispatchTask(
        requireAuth(req),
        uuidParam('taskId', taskId),
        {
          // 같은 채널을 두 번 적어도 한 번만 보낸다.
          channels: [...new Set(channels as DispatchChannel[])],
          recipients,
          messageTemplate:
            typeof template === 'string' && template.trim().length > 0 ? template.trim() : null,
        },
        requestMeta(req),
      ),
    );
  }
}

/** UNE-TASK-013 / 014 — 전파 상태와 재전파. */
@Controller('dispatches')
export class DispatchController {
  constructor(@Inject(DispatchService) private readonly dispatches: DispatchService) {}

  @Get(':dispatchId')
  @RequirePermission('TASK_READ')
  async status(
    @Req() req: ApiRequest,
    @Param('dispatchId') dispatchId: string,
  ): Promise<SuccessEnvelope<DispatchStatusResource>> {
    return ok(
      req,
      await this.dispatches.getStatus(requireAuth(req), uuidParam('dispatchId', dispatchId)),
    );
  }

  @Post(':dispatchId/retry')
  @RequirePermission('TASK_DISPATCH')
  @Idempotent({ required: true, successStatus: 200 })
  @HttpCode(200)
  async retry(
    @Req() req: ApiRequest,
    @Param('dispatchId') dispatchId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<DispatchResource>> {
    const raw = rec(body).recipientIds;
    let recipientIds: string[] | null = null;
    if (raw !== undefined && raw !== null) {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string' || !UUID.test(x))) {
        throw dispatchErrors.invalidRequest([
          { field: 'recipientIds', reason: 'UUID 목록이어야 합니다.' },
        ]);
      }
      recipientIds = [...new Set(raw as string[])];
    }
    return ok(
      req,
      await this.dispatches.retry(
        requireAuth(req),
        uuidParam('dispatchId', dispatchId),
        recipientIds,
        requestMeta(req),
      ),
    );
  }
}
