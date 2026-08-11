import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  dispatchesForReal,
  isRealChannel,
  outboxIdempotencyKey,
  rollUpDispatchStatus,
  type DispatchChannel,
  type DispatchMessageType,
  type RecipientStatus,
} from '@une/domain';
import { ApiError } from '../common/api-error';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import type { RequestMeta } from '../plan/plan.service';
import { SopRunRepository } from '../sop/sop-run.repository';
import { DispatchRepository, type DispatchRow } from './dispatch.repository';

/**
 * UNE-TASK-003 / 013 / 014 (CC-270).
 *
 * **접수와 발송을 나눈다.** API는 전파·수신자·Outbox·사실원장을 **한
 * 트랜잭션**에 커밋하고 끝낸다(CLAUDE.md 비협상 규칙). 실제 채널 호출은 워커
 * 릴레이가 그 줄을 읽어서 한다 — 외부 호출이 트랜잭션 안에서 돌지 않는다.
 */

export const dispatchErrors = {
  taskNotFound: (): ApiError => new ApiError(404, 'TASK-404-001', '임무를 찾을 수 없습니다.'),

  notFound: (): ApiError => new ApiError(404, 'DISP-404-001', '전파를 찾을 수 없습니다.'),

  invalidRequest: (violations: Array<{ field: string; reason: string }>): ApiError =>
    new ApiError(400, 'TASK-400-001', '전파 요청이 올바르지 않습니다.', { violations }),

  /**
   * 모의 실행은 전파하지 않는다.
   *
   * DRY_RUN에서 전파가 나가면 그것은 더 이상 모의가 아니다 — 사람들이 실제로
   * 지시를 받는다.
   */
  dryRunCannotDispatch: (): ApiError =>
    new ApiError(412, 'TASK-412-001', '모의 실행에서는 전파할 수 없습니다.', {
      userAction: '실제 실행에서 전파하십시오.',
    }),

  /** 종료된 실행의 임무는 보내지 않는다. */
  runNotActive: (status: string): ApiError =>
    new ApiError(412, 'TASK-412-002', `실행 상태(${status})에서는 전파할 수 없습니다.`),

  /** 재전파할 것이 없다 (UNE-TASK-014). */
  nothingToRetry: (): ApiError =>
    new ApiError(409, 'DISP-409-001', '재전파할 실패 건이 없습니다.', {
      userAction: '실패한 수신자가 있는지 확인하십시오.',
    }),
};

export interface DispatchResource {
  dispatchId: string;
  taskId: string | null;
  situationId: string;
  messageType: string;
  messageBody: string;
  status: string;
  createdBy: string;
  createdAt: string;
  recipients: Array<{
    recipientId: string;
    userId: string | null;
    organizationId: string | null;
    channel: string;
    deliveryStatus: string;
    /** 이 채널이 시뮬레이션인가 — 화면이 "실제로 나갔다"고 읽지 않게 한다. */
    simulated: boolean;
  }>;
}

export interface DispatchStatusResource extends DispatchResource {
  attempts: Array<{
    recipientId: string | null;
    channel: string;
    attemptNo: number;
    resultStatus: string;
    providerMessageId: string | null;
    simulated: boolean | null;
    finishedAt: string | null;
    errorCode: string | null;
  }>;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class DispatchService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DispatchRepository) private readonly repo: DispatchRepository,
    @Inject(SopRunRepository) private readonly runs: SopRunRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /**
   * UNE-TASK-003 — 임무 전파 접수.
   *
   * 한 트랜잭션: 선행조건 → 전파 → 수신자 → Outbox → 사실원장 → 감사.
   */
  async dispatchTask(
    auth: AuthContext,
    taskId: string,
    input: {
      channels: DispatchChannel[];
      recipients: Array<{ userId: string | null; organizationId: string | null }>;
      messageTemplate: string | null;
    },
    meta: RequestMeta,
  ): Promise<DispatchResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.repo.findTaskContext(c, auth.tenantId, taskId);
      if (!task) throw dispatchErrors.taskNotFound();
      if (!dispatchesForReal(task.runMode as 'LIVE' | 'EXERCISE' | 'DRY_RUN')) {
        // EXERCISE도 여기서 막힌다 — 훈련이 실제 문자를 보내면 훈련이 아니다.
        throw dispatchErrors.dryRunCannotDispatch();
      }
      if (task.runStatus !== 'RUNNING') throw dispatchErrors.runNotActive(task.runStatus);

      const body =
        input.messageTemplate ??
        [task.title, ...task.instructions].filter((x) => x.length > 0).join('\n');

      const dispatch = await this.repo.insertDispatch(c, {
        taskId,
        situationId: task.situationId,
        messageType: 'TASK' as DispatchMessageType,
        messageBody: body,
        createdBy: auth.userId,
      });

      const recipients: DispatchResource['recipients'] = [];
      for (const target of input.recipients) {
        for (const channel of input.channels) {
          const recipientId = await this.repo.insertRecipient(c, {
            dispatchId: dispatch.dispatchId,
            userId: target.userId,
            organizationId: target.organizationId,
            channel,
          });
          await this.repo.insertOutbox(c, {
            tenantId: auth.tenantId,
            aggregateId: dispatch.dispatchId,
            eventType: 'TASK_DISPATCHED',
            channel,
            payload: {
              // 수신자 **참조**만 싣는다. 주소는 저장하지 않는다(OB-06).
              recipientRef: target.userId ?? target.organizationId ?? recipientId,
              subject: task.title,
              body,
              correlationId: meta.correlationId,
            },
            idempotencyKey: outboxIdempotencyKey({
              dispatchId: dispatch.dispatchId,
              recipientId,
              channel,
            }),
            dispatchRecipientId: recipientId,
          });
          recipients.push({
            recipientId,
            userId: target.userId,
            organizationId: target.organizationId,
            channel,
            deliveryStatus: 'PENDING',
            simulated: !isRealChannel(channel),
          });
        }
      }

      // 사실원장 — 상태변경·이벤트·Outbox가 같은 트랜잭션이다.
      await this.runs.insertExecutionEvent(c, {
        tenantId: auth.tenantId,
        situationId: task.situationId,
        aggregateType: 'DISPATCH',
        aggregateId: dispatch.dispatchId,
        eventType: 'TASK_CREATED',
        actorId: auth.userId,
        payload: {
          taskId,
          runId: task.runId,
          channels: input.channels,
          recipientCount: recipients.length,
          simulatedChannels: input.channels.filter((ch) => !isRealChannel(ch)),
        },
        correlationId: meta.correlationId,
      });
      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'TASK_DISPATCHED',
        resourceType: 'DISPATCH',
        resourceId: dispatch.dispatchId,
        correlationId: meta.correlationId,
        ...(meta.ip ? { ip: meta.ip } : {}),
        ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
        detail: { taskId, channels: input.channels, recipientCount: recipients.length },
      });

      return this.toResource(dispatch, recipients);
    });
  }

  /** UNE-TASK-013 — 전파·수신 상태 조회. */
  async getStatus(auth: AuthContext, dispatchId: string): Promise<DispatchStatusResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const dispatch = await this.repo.findDispatch(c, dispatchId);
      if (!dispatch) throw dispatchErrors.notFound();
      const recipients = await this.repo.listRecipients(c, dispatchId);
      const attempts = await this.repo.listAttempts(c, dispatchId);
      return {
        ...this.toResource(
          dispatch,
          recipients.map((r) => ({
            recipientId: r.recipientId,
            userId: r.userId,
            organizationId: r.organizationId,
            channel: r.channel,
            deliveryStatus: r.deliveryStatus,
            simulated: !isRealChannel(r.channel as DispatchChannel),
          })),
        ),
        attempts: attempts.map((a) => ({
          recipientId: a.recipientId,
          channel: a.channel,
          attemptNo: a.attemptNo,
          resultStatus: a.resultStatus,
          providerMessageId: a.providerMessageId,
          simulated: a.simulated,
          finishedAt: iso(a.finishedAt),
          errorCode: a.errorCode,
        })),
      };
    });
  }

  /**
   * UNE-TASK-014 — 실패 수신자 재전파.
   *
   * dead letter만 되살린다. 진행 중인 것을 다시 큐에 넣으면 같은 메시지가 두
   * 번 나간다.
   */
  async retry(
    auth: AuthContext,
    dispatchId: string,
    recipientIds: string[] | null,
    meta: RequestMeta,
  ): Promise<DispatchResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const dispatch = await this.repo.findDispatch(c, dispatchId);
      if (!dispatch) throw dispatchErrors.notFound();

      const requeued = await this.repo.requeueFailed(c, dispatchId, recipientIds);
      if (requeued === 0) throw dispatchErrors.nothingToRetry();
      await this.repo.resetRecipients(c, dispatchId, recipientIds);

      const statuses = (await this.repo.listRecipients(c, dispatchId)).map(
        (r) => r.deliveryStatus as RecipientStatus,
      );
      await this.repo.setDispatchStatus(c, dispatchId, rollUpDispatchStatus(statuses));

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'DISPATCH_RETRIED',
        resourceType: 'DISPATCH',
        resourceId: dispatchId,
        correlationId: meta.correlationId,
        detail: { requeued, recipientIds },
      });

      const refreshed = await this.repo.findDispatch(c, dispatchId);
      const recipients = await this.repo.listRecipients(c, dispatchId);
      return this.toResource(
        refreshed ?? dispatch,
        recipients.map((r) => ({
          recipientId: r.recipientId,
          userId: r.userId,
          organizationId: r.organizationId,
          channel: r.channel,
          deliveryStatus: r.deliveryStatus,
          simulated: !isRealChannel(r.channel as DispatchChannel),
        })),
      );
    });
  }

  private toResource(
    dispatch: DispatchRow,
    recipients: DispatchResource['recipients'],
  ): DispatchResource {
    return {
      dispatchId: dispatch.dispatchId,
      taskId: dispatch.taskId,
      situationId: dispatch.situationId,
      messageType: dispatch.messageType,
      messageBody: dispatch.messageBody,
      status: dispatch.status,
      createdBy: dispatch.createdBy,
      createdAt: iso(dispatch.createdAt) as string,
      recipients,
    };
  }
}

/** 트랜잭션 밖에서 쓰지 않는다 — 타입만 노출한다. */
export type { PoolClient };
