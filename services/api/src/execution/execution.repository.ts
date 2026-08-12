import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * Execution Log 저장소 (CC-290).
 *
 * 쓰기는 하나뿐이다 — **정정 이벤트**. 나머지는 전부 읽기이고, 그 읽기가
 * 전자상황판의 정본이다(ADR-43 D1: 임무 행이 아니라 이벤트에서 계산한다).
 *
 * RLS가 테넌트를 걸지만 질의도 `tenant_id`를 명시적으로 건다(ADR-21 보상통제,
 * CC-280 이중검토에서 되살린 규칙).
 */

export interface ExecutionEventRow {
  eventId: string;
  situationId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: Date;
  recordedAt: Date;
  actorId: string | null;
  payload: Record<string, unknown>;
  correctsEventId: string | null;
  correlationId: string;
  eventHash: string;
}

export interface DashboardTaskRow {
  taskId: string;
  runId: string;
  nodeKey: string;
  title: string;
  assigneeUserId: string | null;
  assigneeOrgId: string | null;
  dueAt: Date | null;
  progressPct: number;
  /** 지금 임무 행이 말하는 상태. 이벤트 재생과 대조하는 데만 쓴다. */
  currentStatus: string;
}

const EVENT_COLUMNS = `execution_event_id, situation_id, aggregate_type, aggregate_id,
       event_type, occurred_at, recorded_at, actor_id, payload_json,
       corrects_event_id, correlation_id, event_hash`;

function toEvent(row: Record<string, unknown>): ExecutionEventRow {
  return {
    eventId: row.execution_event_id as string,
    situationId: row.situation_id as string,
    aggregateType: row.aggregate_type as string,
    aggregateId: row.aggregate_id as string,
    eventType: row.event_type as string,
    occurredAt: row.occurred_at as Date,
    recordedAt: row.recorded_at as Date,
    actorId: (row.actor_id as string | null) ?? null,
    payload: (row.payload_json ?? {}) as Record<string, unknown>,
    correctsEventId: (row.corrects_event_id as string | null) ?? null,
    correlationId: row.correlation_id as string,
    eventHash: row.event_hash as string,
  };
}

/**
 * 한 번에 재생할 이벤트 상한.
 *
 * 넘으면 응답이 `provenance.truncated`로 밝힌다 — 조용히 자르면 화면이 불완전한
 * 판을 완전한 것으로 읽는다.
 */
export const REPLAY_LIMIT = 20_000;

@Injectable()
export class ExecutionRepository {
  async findSituation(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<{ situationId: string; mode: string; status: string; title: string } | null> {
    const r = await c.query(
      `SELECT situation_id, mode, status, title FROM situation
        WHERE situation_id = $1 AND tenant_id = $2`,
      [situationId, tenantId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      situationId: row.situation_id as string,
      mode: row.mode as string,
      status: row.status as string,
      title: row.title as string,
    };
  }

  /**
   * 상황의 이벤트 전부(시점까지).
   *
   * 대시보드가 이것을 접는다. **정정 이벤트도 함께 가져온다** — 유효값을
   * 만들려면 원본과 정정이 같은 목록에 있어야 한다.
   *
   * 기록순으로 정렬한다: 같은 `occurred_at`이면 `recorded_at`, 그것도 같으면
   * id다. 순서가 흔들리면 "가장 나중 정정"이 흔들린다.
   */
  async listEventsUpTo(
    c: PoolClient,
    tenantId: string,
    situationId: string,
    at: Date,
  ): Promise<{ rows: ExecutionEventRow[]; truncated: boolean }> {
    // **천장을 둔다.** 화면이 10초마다 폴링하고 운영자 수만큼 곱해지는데,
    // 긴 상황의 전체 이력을 매번 프로세스 메모리로 끌어오면 그것이 먼저
    // 무너진다. 잘렸다는 사실은 감추지 않고 응답이 밝힌다(D10).
    const r = await c.query(
      `SELECT ${EVENT_COLUMNS} FROM execution_event
        WHERE tenant_id = $1 AND situation_id = $2 AND occurred_at <= $3
        ORDER BY occurred_at, recorded_at, execution_event_id
        LIMIT ${REPLAY_LIMIT + 1}`,
      [tenantId, situationId, at],
    );
    const truncated = r.rows.length > REPLAY_LIMIT;
    return { rows: r.rows.slice(0, REPLAY_LIMIT).map(toEvent), truncated };
  }

  /** UNE-JNL-002 — 타임라인 한 쪽. */
  async listEvents(
    c: PoolClient,
    tenantId: string,
    situationId: string,
    filter: {
      from: Date | null;
      to: Date | null;
      eventType: string | null;
      actorId: string | null;
      aggregateType: string | null;
      limit: number;
      offset: number;
    },
  ): Promise<{ rows: ExecutionEventRow[]; total: number }> {
    const where: string[] = ['tenant_id = $1', 'situation_id = $2'];
    const params: unknown[] = [tenantId, situationId];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace('$?', `$${params.length}`));
    };
    if (filter.from) add('occurred_at >= $?', filter.from);
    if (filter.to) add('occurred_at <= $?', filter.to);
    if (filter.eventType) add('event_type = $?', filter.eventType);
    if (filter.actorId) add('actor_id = $?', filter.actorId);
    if (filter.aggregateType) add('aggregate_type = $?', filter.aggregateType);
    const clause = `WHERE ${where.join(' AND ')}`;

    const total = await c.query(`SELECT count(*)::int AS n FROM execution_event ${clause}`, params);
    const rows = await c.query(
      `SELECT ${EVENT_COLUMNS} FROM execution_event ${clause}
        ORDER BY occurred_at DESC, recorded_at DESC, execution_event_id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, filter.limit, filter.offset],
    );
    return { rows: rows.rows.map(toEvent), total: total.rows[0].n as number };
  }

  async findEvent(
    c: PoolClient,
    tenantId: string,
    eventId: string,
  ): Promise<ExecutionEventRow | null> {
    const r = await c.query(
      `SELECT ${EVENT_COLUMNS} FROM execution_event
        WHERE execution_event_id = $1 AND tenant_id = $2`,
      [eventId, tenantId],
    );
    return r.rows[0] ? toEvent(r.rows[0]) : null;
  }

  /**
   * 같은 원본을 정정하는 트랜잭션끼리 줄을 세운다.
   *
   * **`SELECT ... FOR UPDATE`를 쓸 수 없다.** 행 잠금은 테이블 UPDATE 권한을
   * 요구하는데 `execution_event`는 append-only라 `une_app`에서 그것을
   * 회수했다(0011) — 즉 잠글 수 없는 것이 이 테이블의 보장이다. CC-240이
   * `sop`에서 같은 벽을 만났다.
   *
   * 그래서 자문 잠금을 쓴다. 트랜잭션이 끝나면 자동으로 풀리고, 같은 원본을
   * 정정하는 요청만 서로 기다린다 — 그것이 없으면 동시 정정 두 건이 각자
   * 원본을 기준으로 병합해 먼저 기록된 값이 사라진다(실측).
   */
  async lockForCorrection(c: PoolClient, eventId: string): Promise<void> {
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [eventId]);
  }

  /**
   * 이 원본을 가리키는 정정 전부 (설계 09 REG-05 lineage).
   *
   * **원본을 감추지 않는다.** 상세는 원본을 그대로 주고 정정 목록을 함께 준다.
   */
  async listCorrectionsOf(
    c: PoolClient,
    tenantId: string,
    eventId: string,
  ): Promise<ExecutionEventRow[]> {
    const r = await c.query(
      `SELECT ${EVENT_COLUMNS} FROM execution_event
        WHERE tenant_id = $1 AND corrects_event_id = $2
        ORDER BY recorded_at, execution_event_id`,
      [tenantId, eventId],
    );
    return r.rows.map(toEvent);
  }

  /** 임무 목록. 기한은 이벤트에 없어 여기서만 온다(ADR-43 수용 한계 2). */
  async listSituationTasks(
    c: PoolClient,
    tenantId: string,
    situationId: string,
    runId: string | null,
  ): Promise<DashboardTaskRow[]> {
    const params: unknown[] = [tenantId, situationId];
    let runClause = '';
    if (runId) {
      params.push(runId);
      runClause = ` AND r.run_id = $${params.length}`;
    }
    const r = await c.query(
      `SELECT t.task_id, t.run_id, n.node_key, t.title, t.assignee_user_id,
              t.assignee_org_id, t.due_at, t.progress_pct, t.status
         FROM task t
         JOIN sop_run r ON r.run_id = t.run_id
         JOIN situation s ON s.situation_id = r.situation_id
         JOIN sop_node n ON n.node_id = t.node_id
        WHERE s.tenant_id = $1 AND s.situation_id = $2${runClause}
        ORDER BY t.due_at NULLS LAST, t.created_at, t.task_id`,
      params,
    );
    return r.rows.map((row) => ({
      taskId: row.task_id as string,
      runId: row.run_id as string,
      nodeKey: row.node_key as string,
      title: row.title as string,
      assigneeUserId: (row.assignee_user_id as string | null) ?? null,
      assigneeOrgId: (row.assignee_org_id as string | null) ?? null,
      dueAt: (row.due_at as Date | null) ?? null,
      progressPct: Number(row.progress_pct),
      currentStatus: row.status as string,
    }));
  }

  /** 확정된 최신 상황 판 (설계 09 REG-04). */
  async findLatestSnapshot(
    c: PoolClient,
    situationId: string,
  ): Promise<{
    snapshotId: string;
    versionNo: number;
    effectiveAt: Date;
    factCount: number;
  } | null> {
    const r = await c.query(
      `SELECT snapshot_id, version_no, effective_at,
              jsonb_array_length(COALESCE(facts_json, '[]'::jsonb)) AS fact_count
         FROM situation_snapshot
        WHERE situation_id = $1
        ORDER BY version_no DESC
        LIMIT 1`,
      [situationId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      snapshotId: row.snapshot_id as string,
      versionNo: Number(row.version_no),
      effectiveAt: row.effective_at as Date,
      factCount: Number(row.fact_count),
    };
  }

  async listRuns(
    c: PoolClient,
    situationId: string,
  ): Promise<Array<{ runId: string; mode: string; status: string; startedAt: Date }>> {
    const r = await c.query(
      `SELECT run_id, mode, status, started_at FROM sop_run
        WHERE situation_id = $1 ORDER BY started_at DESC`,
      [situationId],
    );
    return r.rows.map((row) => ({
      runId: row.run_id as string,
      mode: row.mode as string,
      status: row.status as string,
      startedAt: row.started_at as Date,
    }));
  }

  /**
   * 정정 이벤트 한 줄 (UNE-JNL-004).
   *
   * `corrects_event_id`가 원본을 가리키고, 0040 §1의 트리거가 그 대상이
   * 정정이 아님을 보장한다.
   */
  async insertCorrection(
    c: PoolClient,
    input: {
      tenantId: string;
      situationId: string;
      aggregateType: string;
      aggregateId: string;
      actorId: string;
      payload: Record<string, unknown>;
      correctsEventId: string;
      correlationId: string;
      eventHash: string;
      eventType: string;
    },
  ): Promise<ExecutionEventRow> {
    const r = await c.query(
      `INSERT INTO execution_event
         (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
          actor_id, payload_json, corrects_event_id, correlation_id, event_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${EVENT_COLUMNS}`,
      [
        input.tenantId,
        input.situationId,
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        input.actorId,
        JSON.stringify(input.payload),
        input.correctsEventId,
        input.correlationId,
        input.eventHash,
      ],
    );
    return toEvent(r.rows[0]);
  }
}
