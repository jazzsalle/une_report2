import type { PoolClient } from 'pg';
import type { DispatchChannel, RecipientStatus } from '@une/domain';

/**
 * Outbox 릴레이가 쓰는 SQL (CC-270).
 *
 * 워커 권한은 0037 §5가 정한 칸뿐이다 — `payload_json`과 `idempotency_key`는
 * 손대지 못한다. 그것이 바뀌면 "무엇을 보내기로 했는가"가 사라진다.
 */

export interface ClaimedMessage {
  outboxId: string;
  tenantId: string;
  channel: DispatchChannel;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  attemptNo: number;
  dispatchRecipientId: string | null;
  aggregateId: string;
}

/**
 * 보낼 줄을 집는다.
 *
 * 디스패치 스코프(테넌트 없음)에서 돈다 — 큐는 전 기관 공통이고 릴레이는 그
 * 순서대로 처리한다. `FOR UPDATE SKIP LOCKED`로 여러 릴레이가 같은 줄을 두 번
 * 보내지 않는다.
 *
 * `SENDING`인데 리스가 지난 줄도 함께 집는다 — 워커가 발송 도중 죽으면 그 줄이
 * 영원히 SENDING에 남는다. **다만 그것은 "보냈는데 결과를 못 들은" 경우일 수도
 * 있다**: 그래서 채널 멱등키를 함께 넘겨 두 번 도착하지 않게 한다.
 */
export async function claimMessages(
  client: PoolClient,
  batchSize: number,
  leaseTimeoutMs: number,
): Promise<ClaimedMessage[]> {
  const result = await client.query(
    `UPDATE outbox_message m
        SET status = 'SENDING',
            attempt_count = m.attempt_count + 1,
            next_attempt_at = NULL
      WHERE m.outbox_id IN (
        SELECT outbox_id FROM outbox_message
         WHERE (
           status = 'PENDING'
           OR (status = 'FAILED' AND next_attempt_at <= now())
           OR (status = 'SENDING' AND created_at < now() - ($2::bigint * interval '1 millisecond'))
         )
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING m.outbox_id, m.tenant_id, m.channel, m.event_type, m.payload_json,
                m.idempotency_key, m.attempt_count, m.dispatch_recipient_id, m.aggregate_id`,
    [batchSize, leaseTimeoutMs],
  );
  return result.rows.map((row) => ({
    outboxId: row.outbox_id as string,
    tenantId: row.tenant_id as string,
    channel: row.channel as DispatchChannel,
    eventType: row.event_type as string,
    payload: (row.payload_json ?? {}) as Record<string, unknown>,
    idempotencyKey: row.idempotency_key as string,
    attemptNo: Number(row.attempt_count),
    dispatchRecipientId: (row.dispatch_recipient_id as string | null) ?? null,
    aggregateId: row.aggregate_id as string,
  }));
}

export async function recordAttempt(
  client: PoolClient,
  input: {
    outboxId: string;
    attemptNo: number;
    resultStatus: string;
    providerMessageId: string | null;
    response: Record<string, unknown> | null;
    error: Record<string, unknown> | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO outbox_attempt
       (outbox_id, attempt_no, finished_at, result_status, provider_message_id,
        response_json, error_json)
     VALUES ($1, $2, now(), $3, $4, $5, $6)`,
    [
      input.outboxId,
      input.attemptNo,
      input.resultStatus,
      input.providerMessageId,
      input.response ? JSON.stringify(input.response) : null,
      input.error ? JSON.stringify(input.error) : null,
    ],
  );
}

export async function settleMessage(
  client: PoolClient,
  outboxId: string,
  status: string,
  nextAttemptDelayMs: number | null,
): Promise<void> {
  await client.query(
    `UPDATE outbox_message
        SET status = $2,
            next_attempt_at = CASE
              WHEN $3::bigint IS NULL THEN NULL
              ELSE now() + ($3::bigint * interval '1 millisecond')
            END
      WHERE outbox_id = $1`,
    [outboxId, status, nextAttemptDelayMs],
  );
}

export async function setRecipientStatus(
  client: PoolClient,
  recipientId: string,
  status: RecipientStatus,
): Promise<void> {
  await client.query(`UPDATE dispatch_recipient SET delivery_status = $2 WHERE recipient_id = $1`, [
    recipientId,
    status,
  ]);
}

/** 전파의 수신자 상태를 모아 온다 (합산은 도메인이 한다). */
export async function readRecipientStatuses(
  client: PoolClient,
  dispatchId: string,
): Promise<RecipientStatus[]> {
  const result = await client.query(
    `SELECT delivery_status FROM dispatch_recipient WHERE dispatch_id = $1`,
    [dispatchId],
  );
  return result.rows.map((row) => row.delivery_status as RecipientStatus);
}

export async function findDispatchIdOfRecipient(
  client: PoolClient,
  recipientId: string,
): Promise<string | null> {
  const result = await client.query(
    `SELECT dispatch_id FROM dispatch_recipient WHERE recipient_id = $1`,
    [recipientId],
  );
  return result.rows[0] ? (result.rows[0].dispatch_id as string) : null;
}

export async function setDispatchStatus(
  client: PoolClient,
  dispatchId: string,
  status: string,
): Promise<void> {
  await client.query(`UPDATE dispatch SET status = $2 WHERE dispatch_id = $1`, [
    dispatchId,
    status,
  ]);
}

/**
 * 임무를 SENT로 올린다.
 *
 * 전파가 나간 임무만 해당한다. `CREATED`에서만 올리므로 취소된 임무를 되살리지
 * 않는다(0036의 트리거가 종료된 실행의 임무를 막는 것과 같은 축).
 */
export async function markTaskSent(client: PoolClient, taskId: string): Promise<void> {
  await client.query(
    `UPDATE task SET status = 'SENT', version_no = version_no + 1
      WHERE task_id = $1 AND status = 'CREATED'`,
    [taskId],
  );
}

export async function findTaskIdOfDispatch(
  client: PoolClient,
  dispatchId: string,
): Promise<string | null> {
  const result = await client.query(
    `SELECT task_id FROM dispatch
        WHERE dispatch_id = $1 AND message_type = 'TASK'`,
    [dispatchId],
  );
  return result.rows[0] ? ((result.rows[0].task_id as string | null) ?? null) : null;
}
