import {
  isOutboxSettled,
  nextAttemptDelayMs,
  nextOutboxState,
  rollUpDispatchStatus,
  type DispatchChannel,
} from '@une/domain';
import type { ChannelProvider, ChannelSendResult } from '@une/provider-adapters';
import type { WorkerConfig } from '../config/worker-config';
import type { WorkerDatabase } from '../db/worker-database.service';
import {
  claimMessages,
  findDispatchIdOfRecipient,
  findTaskIdOfDispatch,
  markTaskSent,
  readRecipientStatuses,
  recordAttempt,
  setDispatchStatus,
  setRecipientStatus,
  settleMessage,
  type ClaimedMessage,
} from './outbox.repository';

export interface OutboxRelaySummary {
  claimed: number;
  sent: number;
  retrying: number;
  deadLettered: number;
}

/**
 * Transactional Outbox 릴레이 (CC-270).
 *
 *   tx A (디스패치 스코프): 보낼 줄을 집는다 — SKIP LOCKED로 두 번 보내지 않는다
 *   ——  채널 호출은 어떤 트랜잭션 밖에서  ——
 *   tx B (테넌트): 시도 기록 → 줄 종결 → 수신자·전파·임무 상태
 *
 * 채널 호출을 트랜잭션 안에서 하면 느린 채널 하나가 커넥션을 잡고, 롤백이
 * "보냈는데 안 보낸 것으로 기록"을 만든다. 플랜·SOP 잡 러너와 같은 골격이다.
 *
 * **시뮬레이션 성공을 실제 도달로 보고하지 않는다** — 시도 기록에
 * `simulated: true`가 남고 기동 로그가 채널별 상태를 적는다.
 */
/**
 * 0045 §5의 가드가 던진 것인가.
 *
 * SQLSTATE만 보면 다른 42501(권한 부족)까지 삼킨다 — 그것은 배선 결함이므로
 * 그대로 터져야 한다. 메시지까지 함께 본다.
 */
function isClosedSituationError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : String(err);
  return code === '42501' && message.includes('종료된 상황에는 새 사실을 쓸 수 없다');
}

export class OutboxRelayRunner {
  constructor(
    private readonly db: WorkerDatabase,
    private readonly channels: Map<DispatchChannel, ChannelProvider>,
    private readonly config: WorkerConfig,
  ) {}

  async runOnce(): Promise<OutboxRelaySummary> {
    const summary: OutboxRelaySummary = { claimed: 0, sent: 0, retrying: 0, deadLettered: 0 };

    const claimed = await this.db.withDispatchScope((client) =>
      claimMessages(client, this.config.batchSize, this.config.leaseTimeoutMs),
    );
    summary.claimed = claimed.length;

    for (const message of claimed) {
      // 한 줄이 터져도 배치가 죽지 않는다.
      try {
        const outcome = await this.deliver(message);
        summary[outcome] += 1;
      } catch (err) {
        summary.deadLettered += 1;
        console.error(
          `[une-worker] outbox ${message.outboxId} crashed: ` +
            `${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return summary;
  }

  private async deliver(message: ClaimedMessage): Promise<'sent' | 'retrying' | 'deadLettered'> {
    const provider = this.channels.get(message.channel);

    // 채널이 없으면 재시도해도 같다 — 설정이 바뀌기 전에는 영원히 없다.
    let result: ChannelSendResult;
    if (!provider) {
      result = {
        ok: false,
        providerMessageId: null,
        error: {
          code: 'CHANNEL_NOT_CONFIGURED',
          message: `채널 어댑터가 없습니다: ${message.channel}`,
          retryable: false,
        },
        raw: { channel: message.channel },
        latencyMs: 0,
      };
    } else {
      try {
        result = await provider.send(
          {
            channel: message.channel,
            recipientRef: String(message.payload.recipientRef ?? message.aggregateId),
            subject: (message.payload.subject as string | null) ?? null,
            body: String(message.payload.body ?? ''),
            idempotencyKey: message.idempotencyKey,
          },
          { correlationId: String(message.payload.correlationId ?? message.outboxId) },
        );
      } catch (err) {
        // 어댑터가 던지면 그것은 우리 결함이거나 채널 장애다. 재시도한다 —
        // 재시도가 소진되면 dead letter로 사람이 본다.
        result = {
          ok: false,
          providerMessageId: null,
          error: {
            code: 'CHANNEL_UNAVAILABLE',
            message: err instanceof Error ? err.message : '채널 어댑터가 예외를 던졌습니다.',
            retryable: true,
          },
          raw: { threw: true },
          latencyMs: 0,
        };
      }
    }

    const decision = nextOutboxState({
      attemptNo: message.attemptNo,
      ok: result.ok,
      retryable: result.error?.retryable ?? false,
    });
    const delay = decision.scheduleRetry
      ? nextAttemptDelayMs(message.attemptNo, message.outboxId)
      : null;

    /** 종료된 훈련이라 사실원장이 이 전파를 받지 않았다. */
    let closedSituation = false;

    await this.db.withTenant(message.tenantId, async (client) => {
      await recordAttempt(client, {
        outboxId: message.outboxId,
        attemptNo: message.attemptNo,
        resultStatus: decision.result,
        providerMessageId: result.providerMessageId,
        // 시뮬레이션 여부가 시도 기록에 남는다 — 나중에 이 줄을 보고
        // "전파됐다"고 읽으면 안 된다.
        response: {
          ...result.raw,
          adapterId: provider?.adapterId ?? null,
          simulated: provider?.isSimulated ?? null,
          latencyMs: result.latencyMs,
        },
        error: result.error ? { ...result.error } : null,
      });
      await settleMessage(client, message.outboxId, decision.status, delay);

      // 수신자·전파·임무는 **끝난 줄에서만** 움직인다. 재시도 예정인 줄이
      // 수신자를 FAILED로 만들면 화면이 아직 진행 중인 것을 실패로 보여 준다.
      if (message.dispatchRecipientId && isOutboxSettled(decision.status)) {
        await setRecipientStatus(
          client,
          message.dispatchRecipientId,
          decision.status === 'SENT' ? 'SENT' : 'FAILED',
        );
        const dispatchId = await findDispatchIdOfRecipient(client, message.dispatchRecipientId);
        if (dispatchId) {
          const statuses = await readRecipientStatuses(client, dispatchId);
          const rolled = rollUpDispatchStatus(statuses);
          await setDispatchStatus(client, dispatchId, rolled);

          // 임무는 **하나라도 나갔으면** SENT다. 전부 실패하면 그대로 둔다 —
          // 아무도 받지 않은 임무를 "보냄"으로 표시하면 운영자가 기다린다.
          if (rolled === 'SENT' || rolled === 'PARTIAL') {
            const taskId = await findTaskIdOfDispatch(client, dispatchId);
            if (taskId) {
              // 상태만 바꾸지 않는다 — 사실원장에도 남긴다(0040 §3).
              try {
                await markTaskSent(client, taskId, {
                  tenantId: message.tenantId,
                  // 큐에 실린 상관관계 ID를 이어 쓴다 — 접수한 요청과 이 이벤트가
                  // 같은 추적선에 있어야 한다.
                  correlationId:
                    typeof message.payload.correlationId === 'string'
                      ? message.payload.correlationId
                      : `outbox-${message.outboxId}`,
                });
              } catch (err) {
                // **종료된 훈련의 사실원장은 새 사실을 받지 않는다**(0045 §5).
                //
                // 그냥 던지면 이 트랜잭션 전체가 롤백되고 — 시도 기록도, 줄의
                // 상태 전이도 함께 사라진다. 줄은 `SENDING`인 채 남아 임차가
                // 만료될 때마다 **다시 집혀 다시 발송된다**. 바깥으로는 계속
                // 나가면서 안에는 아무 기록도 남지 않는 상태가 된다.
                //
                // 그래서 여기서 국소적으로 받는다: 이 줄은 더 보낼 곳이 없으므로
                // dead letter로 확정하고, 왜 그렇게 됐는지를 시도 기록에 남긴다.
                if (!isClosedSituationError(err)) throw err;
                closedSituation = true;
              }
            }
          }
        }
      }
    });

    if (closedSituation) {
      // 같은 줄을 다시 집지 않도록 **별도 트랜잭션에서** 확정한다. 재시도해도
      // 결과가 달라지지 않는다 — 훈련은 이미 닫혔다.
      await this.db.withTenant(message.tenantId, async (client) => {
        await recordAttempt(client, {
          outboxId: message.outboxId,
          attemptNo: message.attemptNo,
          resultStatus: 'DEAD_LETTER',
          providerMessageId: result.providerMessageId,
          response: { adapterId: provider?.adapterId ?? null },
          error: {
            code: 'SITUATION_CLOSED',
            message:
              '종료된 훈련이라 사실원장이 전파 사실을 받지 않았습니다. 이 줄은 더 재시도하지 않습니다.',
            retryable: false,
          },
        });
        await settleMessage(client, message.outboxId, 'DEAD_LETTER', null);
      });
      return 'deadLettered';
    }

    if (decision.status === 'SENT') return 'sent';
    if (decision.status === 'FAILED') return 'retrying';
    return 'deadLettered';
  }
}
