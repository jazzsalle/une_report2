import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { DispatchChannel, DispatchMessageType } from '@une/domain';

/** 전파 접수·조회 저장소 (CC-270, UNE-TASK-003/013/014). */

export interface DispatchRow {
  dispatchId: string;
  taskId: string | null;
  situationId: string;
  messageType: string;
  messageBody: string;
  status: string;
  createdBy: string;
  createdAt: Date;
}

export interface RecipientRow {
  recipientId: string;
  dispatchId: string;
  userId: string | null;
  organizationId: string | null;
  channel: string;
  deliveryStatus: string;
  acknowledgedAt: Date | null;
}

export interface AttemptRow {
  recipientId: string | null;
  channel: string;
  attemptNo: number;
  resultStatus: string;
  providerMessageId: string | null;
  simulated: boolean | null;
  finishedAt: Date | null;
  errorCode: string | null;
}

const DISPATCH_COLUMNS = `dispatch_id, task_id, situation_id, message_type, message_body,
                          status, created_by, created_at`;

function toDispatch(row: Record<string, unknown>): DispatchRow {
  return {
    dispatchId: row.dispatch_id as string,
    taskId: (row.task_id as string | null) ?? null,
    situationId: row.situation_id as string,
    messageType: row.message_type as string,
    messageBody: row.message_body as string,
    status: row.status as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
  };
}

@Injectable()
export class DispatchRepository {
  /** 임무와 그 실행의 상황·상태를 함께 읽는다 — 전파 선행조건이 그 둘이다. */
  async findTaskContext(
    c: PoolClient,
    tenantId: string,
    taskId: string,
  ): Promise<{
    taskId: string;
    title: string;
    taskStatus: string;
    runId: string;
    runStatus: string;
    runMode: string;
    situationId: string;
    instructions: string[];
  } | null> {
    const r = await c.query(
      `SELECT t.task_id, t.title, t.status AS task_status, t.completion_policy_json,
              r.run_id, r.status AS run_status, r.mode AS run_mode, r.situation_id
         FROM task t
         JOIN sop_run r ON r.run_id = t.run_id
         JOIN situation s ON s.situation_id = r.situation_id
        WHERE t.task_id = $1 AND s.tenant_id = $2`,
      [taskId, tenantId],
    );
    const row = r.rows[0];
    if (!row) return null;
    const policy = (row.completion_policy_json ?? {}) as { instructions?: string[] };
    return {
      taskId: row.task_id as string,
      title: row.title as string,
      taskStatus: row.task_status as string,
      runId: row.run_id as string,
      runStatus: row.run_status as string,
      runMode: row.run_mode as string,
      situationId: row.situation_id as string,
      instructions: policy.instructions ?? [],
    };
  }

  async insertDispatch(
    c: PoolClient,
    input: {
      taskId: string | null;
      situationId: string;
      messageType: DispatchMessageType;
      messageBody: string;
      createdBy: string;
    },
  ): Promise<DispatchRow> {
    const r = await c.query(
      `INSERT INTO dispatch (task_id, situation_id, message_type, message_body, status, created_by)
       VALUES ($1, $2, $3, $4, 'PENDING', $5)
       RETURNING ${DISPATCH_COLUMNS}`,
      [input.taskId, input.situationId, input.messageType, input.messageBody, input.createdBy],
    );
    return toDispatch(r.rows[0]);
  }

  async insertRecipient(
    c: PoolClient,
    input: {
      dispatchId: string;
      userId: string | null;
      organizationId: string | null;
      channel: DispatchChannel;
    },
  ): Promise<string> {
    // `address_enc`는 비운다 — 실제 채널 계약(OB-06) 전에 개인정보를 모으지 않는다.
    const r = await c.query(
      `INSERT INTO dispatch_recipient
         (dispatch_id, user_id, organization_id, channel, delivery_status)
       VALUES ($1, $2, $3, $4, 'PENDING')
       RETURNING recipient_id`,
      [input.dispatchId, input.userId, input.organizationId, input.channel],
    );
    return r.rows[0].recipient_id as string;
  }

  /**
   * Outbox 한 줄.
   *
   * **같은 트랜잭션에서** 전파·수신자와 함께 들어간다(CLAUDE.md 비협상 규칙).
   * 중복 접수는 `uk_outbox_idem`이 막고, 호출부가 23505를 그대로 성공으로
   * 받아들인다 — 같은 메시지를 두 번 보내지 않는 것이 목적이지 오류를 내는
   * 것이 목적이 아니다.
   */
  async insertOutbox(
    c: PoolClient,
    input: {
      tenantId: string;
      aggregateId: string;
      eventType: string;
      channel: DispatchChannel;
      payload: Record<string, unknown>;
      idempotencyKey: string;
      dispatchRecipientId: string;
    },
  ): Promise<string | null> {
    const r = await c.query(
      `INSERT INTO outbox_message
         (tenant_id, aggregate_type, aggregate_id, event_type, payload_json, channel,
          status, attempt_count, idempotency_key, dispatch_recipient_id)
       VALUES ($1, 'DISPATCH', $2, $3, $4, $5, 'PENDING', 0, $6, $7)
       ON CONFLICT (tenant_id, idempotency_key, channel) DO NOTHING
       RETURNING outbox_id`,
      [
        input.tenantId,
        input.aggregateId,
        input.eventType,
        JSON.stringify(input.payload),
        input.channel,
        input.idempotencyKey,
        input.dispatchRecipientId,
      ],
    );
    return r.rows[0] ? (r.rows[0].outbox_id as string) : null;
  }

  async findDispatch(c: PoolClient, dispatchId: string): Promise<DispatchRow | null> {
    const r = await c.query(`SELECT ${DISPATCH_COLUMNS} FROM dispatch WHERE dispatch_id = $1`, [
      dispatchId,
    ]);
    return r.rows[0] ? toDispatch(r.rows[0]) : null;
  }

  async listRecipients(c: PoolClient, dispatchId: string): Promise<RecipientRow[]> {
    const r = await c.query(
      `SELECT recipient_id, dispatch_id, user_id, organization_id, channel,
              delivery_status, acknowledged_at
         FROM dispatch_recipient WHERE dispatch_id = $1 ORDER BY channel, recipient_id`,
      [dispatchId],
    );
    return r.rows.map((row) => ({
      recipientId: row.recipient_id as string,
      dispatchId: row.dispatch_id as string,
      userId: (row.user_id as string | null) ?? null,
      organizationId: (row.organization_id as string | null) ?? null,
      channel: row.channel as string,
      deliveryStatus: row.delivery_status as string,
      acknowledgedAt: (row.acknowledged_at as Date | null) ?? null,
    }));
  }

  /**
   * 시도 이력 (UNE-TASK-013).
   *
   * `channel_delivery` 테이블을 만들지 않은 이유가 여기 있다 — 이 조인이 그
   * 테이블이 담았을 것을 전부 준다(ADR-41 D6).
   */
  async listAttempts(c: PoolClient, dispatchId: string): Promise<AttemptRow[]> {
    const r = await c.query(
      `SELECT m.dispatch_recipient_id, m.channel, a.attempt_no, a.result_status,
              a.provider_message_id, a.finished_at,
              a.response_json ->> 'simulated' AS simulated,
              a.error_json ->> 'code' AS error_code
         FROM outbox_message m
         JOIN outbox_attempt a ON a.outbox_id = m.outbox_id
         JOIN dispatch_recipient dr ON dr.recipient_id = m.dispatch_recipient_id
        WHERE dr.dispatch_id = $1
        ORDER BY a.finished_at NULLS LAST, a.attempt_no`,
      [dispatchId],
    );
    return r.rows.map((row) => ({
      recipientId: (row.dispatch_recipient_id as string | null) ?? null,
      channel: row.channel as string,
      attemptNo: Number(row.attempt_no),
      resultStatus: row.result_status as string,
      providerMessageId: (row.provider_message_id as string | null) ?? null,
      simulated: row.simulated === null ? null : row.simulated === 'true',
      finishedAt: (row.finished_at as Date | null) ?? null,
      errorCode: (row.error_code as string | null) ?? null,
    }));
  }

  /**
   * 재전파 대상 (UNE-TASK-014).
   *
   * **끝난 줄만 되살린다.** 진행 중인 것을 다시 큐에 넣으면 같은 메시지가 두
   * 번 나간다.
   */
  async requeueFailed(
    c: PoolClient,
    dispatchId: string,
    recipientIds: string[] | null,
  ): Promise<number> {
    const r = await c.query(
      `UPDATE outbox_message m
          SET status = 'PENDING', attempt_count = 0, next_attempt_at = NULL
        WHERE m.dispatch_recipient_id IN (
          SELECT recipient_id FROM dispatch_recipient
           WHERE dispatch_id = $1
             AND ($2::uuid[] IS NULL OR recipient_id = ANY($2::uuid[]))
        )
          AND m.status = 'DEAD_LETTER'`,
      [dispatchId, recipientIds],
    );
    return r.rowCount ?? 0;
  }

  async resetRecipients(
    c: PoolClient,
    dispatchId: string,
    recipientIds: string[] | null,
  ): Promise<void> {
    await c.query(
      `UPDATE dispatch_recipient SET delivery_status = 'PENDING'
        WHERE dispatch_id = $1
          AND delivery_status = 'FAILED'
          AND ($2::uuid[] IS NULL OR recipient_id = ANY($2::uuid[]))`,
      [dispatchId, recipientIds],
    );
  }

  async setDispatchStatus(c: PoolClient, dispatchId: string, status: string): Promise<void> {
    await c.query(`UPDATE dispatch SET status = $2 WHERE dispatch_id = $1`, [dispatchId, status]);
  }
}
