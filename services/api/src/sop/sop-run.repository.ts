import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { canonicalJson, type RunEventType, type SopRunMode } from '@une/domain';

/**
 * SOP 실행·임무 저장소 (CC-260).
 *
 * 테넌트 격리는 0036의 정책이 한다(상황 → 실행 → 임무 → 이벤트 조인).
 */

export interface SopRunRow {
  runId: string;
  sopVersionId: string;
  situationId: string;
  snapshotId: string;
  mode: string;
  status: string;
  startedBy: string;
  startedAt: Date;
  endedAt: Date | null;
  correlationId: string;
}

export interface TaskRow {
  taskId: string;
  runId: string;
  nodeId: string;
  nodeKey: string;
  title: string;
  status: string;
  assigneeUserId: string | null;
  dueAt: Date | null;
  progressPct: number;
  activatedAt: Date | null;
  instructions: string[];
  assigneeHint: string | null;
  createdAt: Date;
}

const RUN_COLUMNS = `run_id, sop_version_id, situation_id, snapshot_id, mode, status,
                     started_by, started_at, ended_at, correlation_id`;

function toRun(row: Record<string, unknown>): SopRunRow {
  return {
    runId: row.run_id as string,
    sopVersionId: row.sop_version_id as string,
    situationId: row.situation_id as string,
    snapshotId: row.snapshot_id as string,
    mode: row.mode as string,
    status: row.status as string,
    startedBy: row.started_by as string,
    startedAt: row.started_at as Date,
    endedAt: (row.ended_at as Date | null) ?? null,
    correlationId: row.correlation_id as string,
  };
}

@Injectable()
export class SopRunRepository {
  async insertRun(
    c: PoolClient,
    input: {
      sopVersionId: string;
      situationId: string;
      snapshotId: string;
      mode: SopRunMode;
      status: string;
      startedBy: string;
      correlationId: string;
    },
  ): Promise<SopRunRow> {
    const r = await c.query(
      `INSERT INTO sop_run
         (sop_version_id, situation_id, snapshot_id, mode, status, started_by, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${RUN_COLUMNS}`,
      [
        input.sopVersionId,
        input.situationId,
        input.snapshotId,
        input.mode,
        input.status,
        input.startedBy,
        input.correlationId,
      ],
    );
    return toRun(r.rows[0]);
  }

  async findRun(
    c: PoolClient,
    runId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<SopRunRow | null> {
    const r = await c.query(
      `SELECT ${RUN_COLUMNS} FROM sop_run
        WHERE run_id = $1${opts.forUpdate ? '\n        FOR UPDATE' : ''}`,
      [runId],
    );
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  /**
   * 한 상황에 살아 있는 실행은 하나다.
   *
   * 둘이 동시에 돌면 같은 상황에 대해 "지금 무엇을 하고 있는가"의 답이 둘이
   * 된다. **DRY_RUN은 세지 않는다** — 모의는 실제 대응과 나란히 돌 수 있어야
   * 하고, 그래서 상황 상태도 건드리지 않는다.
   */
  async findLiveRun(c: PoolClient, situationId: string): Promise<SopRunRow | null> {
    const r = await c.query(
      `SELECT ${RUN_COLUMNS} FROM sop_run
        WHERE situation_id = $1
          AND mode <> 'DRY_RUN'
          AND status IN ('READY', 'RUNNING', 'PAUSED')
        ORDER BY started_at DESC
        LIMIT 1`,
      [situationId],
    );
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  async updateRunStatus(
    c: PoolClient,
    runId: string,
    status: string,
    opts: { ended?: boolean } = {},
  ): Promise<SopRunRow | null> {
    const r = await c.query(
      `UPDATE sop_run
          SET status = $2,
              ended_at = CASE WHEN $3 THEN now() ELSE ended_at END
        WHERE run_id = $1
        RETURNING ${RUN_COLUMNS}`,
      [runId, status, opts.ended ?? false],
    );
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }

  /**
   * 승인된 버전의 그래프를 읽는다 (임무 생성 입력).
   *
   * `sop_version.status = 'LOCKED'`를 조건에 넣지 않는다 — 그 판단은 서비스가
   * 하고 오류 문구도 서비스가 고른다. 여기서 걸러 버리면 "버전이 없다"와
   * "승인되지 않았다"가 같은 결과가 된다.
   */
  async findVersionGraph(
    c: PoolClient,
    tenantId: string,
    sopId: string,
    versionId: string,
  ): Promise<{
    versionStatus: string;
    situationId: string | null;
    nodes: Array<{
      nodeId: string;
      nodeKey: string;
      nodeType: string;
      title: string;
      config: unknown;
    }>;
    edges: Array<{ fromNodeKey: string; toNodeKey: string }>;
  } | null> {
    const version = await c.query(
      `SELECT v.status, s.situation_id
         FROM sop_version v JOIN sop s USING (sop_id)
        WHERE v.sop_version_id = $1 AND v.sop_id = $2 AND s.tenant_id = $3`,
      [versionId, sopId, tenantId],
    );
    if (!version.rows[0]) return null;

    const nodes = await c.query(
      `SELECT node_id, node_key, node_type, title, config_json
         FROM sop_node WHERE sop_version_id = $1 ORDER BY sort_order, node_key`,
      [versionId],
    );
    const edges = await c.query(
      `SELECT f.node_key AS from_key, t.node_key AS to_key
         FROM sop_edge e
         JOIN sop_node f ON f.node_id = e.from_node_id
         JOIN sop_node t ON t.node_id = e.to_node_id
        WHERE e.sop_version_id = $1`,
      [versionId],
    );
    return {
      versionStatus: version.rows[0].status as string,
      situationId: (version.rows[0].situation_id as string | null) ?? null,
      nodes: nodes.rows.map((row) => ({
        nodeId: row.node_id as string,
        nodeKey: row.node_key as string,
        nodeType: row.node_type as string,
        title: row.title as string,
        config: row.config_json,
      })),
      edges: edges.rows.map((row) => ({
        fromNodeKey: row.from_key as string,
        toNodeKey: row.to_key as string,
      })),
    };
  }

  async insertTask(
    c: PoolClient,
    input: {
      runId: string;
      nodeId: string;
      title: string;
      assigneeHint: string | null;
      instructions: string[];
      activated: boolean;
    },
  ): Promise<string> {
    const r = await c.query(
      `INSERT INTO task
         (run_id, node_id, title, status, completion_policy_json, progress_pct, activated_at)
       VALUES ($1, $2, $3, 'CREATED', $4, 0, CASE WHEN $5 THEN now() ELSE NULL END)
       RETURNING task_id`,
      [
        input.runId,
        input.nodeId,
        input.title,
        JSON.stringify({ instructions: input.instructions, assigneeHint: input.assigneeHint }),
        input.activated,
      ],
    );
    return r.rows[0].task_id as string;
  }

  async listTasks(c: PoolClient, runId: string): Promise<TaskRow[]> {
    const r = await c.query(
      `SELECT t.task_id, t.run_id, t.node_id, n.node_key, t.title, t.status,
              t.assignee_user_id, t.due_at, t.progress_pct, t.activated_at,
              t.completion_policy_json, t.created_at
         FROM task t JOIN sop_node n ON n.node_id = t.node_id
        WHERE t.run_id = $1
        ORDER BY n.sort_order, n.node_key`,
      [runId],
    );
    return r.rows.map((row) => {
      const policy = (row.completion_policy_json ?? {}) as {
        instructions?: string[];
        assigneeHint?: string | null;
      };
      return {
        taskId: row.task_id as string,
        runId: row.run_id as string,
        nodeId: row.node_id as string,
        nodeKey: row.node_key as string,
        title: row.title as string,
        status: row.status as string,
        assigneeUserId: (row.assignee_user_id as string | null) ?? null,
        dueAt: (row.due_at as Date | null) ?? null,
        progressPct: Number(row.progress_pct),
        activatedAt: (row.activated_at as Date | null) ?? null,
        instructions: policy.instructions ?? [],
        assigneeHint: policy.assigneeHint ?? null,
        createdAt: row.created_at as Date,
      };
    });
  }

  /** 강제종료: 아직 살아 있는 임무를 접는다. */
  async cancelOpenTasks(c: PoolClient, runId: string): Promise<string[]> {
    const r = await c.query(
      `UPDATE task SET status = 'CANCELLED', version_no = version_no + 1
        WHERE run_id = $1 AND status = 'CREATED'
        RETURNING task_id`,
      [runId],
    );
    return r.rows.map((row) => row.task_id as string);
  }

  async insertTaskEvent(
    c: PoolClient,
    input: {
      taskId: string;
      eventType: string;
      actorId: string | null;
      payload: Record<string, unknown>;
      correlationId: string;
    },
  ): Promise<void> {
    await c.query(
      `INSERT INTO task_event (task_id, event_type, event_time, actor_id, payload_json, correlation_id)
       VALUES ($1, $2, now(), $3, $4, $5)`,
      [
        input.taskId,
        input.eventType,
        input.actorId,
        JSON.stringify(input.payload),
        input.correlationId,
      ],
    );
  }

  /**
   * 사실원장 이벤트 (`execution_event`).
   *
   * append-only이고 정정은 새 이벤트다(0011). `event_hash`는 내용에 대한
   * 지문이다 — 나중에 "이 줄이 그때 그대로인가"를 물을 수 있어야 한다.
   */
  async insertExecutionEvent(
    c: PoolClient,
    input: {
      tenantId: string;
      situationId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: RunEventType;
      actorId: string | null;
      payload: Record<string, unknown>;
      correlationId: string;
    },
  ): Promise<{ executionEventId: string; occurredAt: Date }> {
    const hash = createHash('sha256')
      .update(
        canonicalJson({
          situationId: input.situationId,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          eventType: input.eventType,
          payload: input.payload,
        }),
      )
      .digest('hex');
    const r = await c.query(
      `INSERT INTO execution_event
         (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
          actor_id, payload_json, correlation_id, event_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING execution_event_id, occurred_at`,
      [
        input.tenantId,
        input.situationId,
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        input.actorId,
        JSON.stringify(input.payload),
        input.correlationId,
        hash,
      ],
    );
    return {
      executionEventId: r.rows[0].execution_event_id as string,
      occurredAt: r.rows[0].occurred_at as Date,
    };
  }

  /**
   * 실행 이벤트 페이지 (UNE-SOP-013 SSE).
   *
   * `execution_event`에는 순번 컬럼이 없다 — `occurred_at`으로 정렬하고
   * Last-Event-ID는 그 시각을 밀리초로 쓴다. 같은 밀리초에 둘이 들어오면
   * `execution_event_id`로 순서를 고정한다.
   */
  async listRunEventsSince(
    c: PoolClient,
    runId: string,
    afterMs: number,
  ): Promise<Array<{ eventId: string; eventType: string; payload: unknown; occurredAt: Date }>> {
    const r = await c.query(
      `SELECT execution_event_id, event_type, payload_json, occurred_at
         FROM execution_event
        WHERE aggregate_type = 'SOP_RUN'
          AND aggregate_id = $1
          AND occurred_at > to_timestamp($2::double precision / 1000.0)
        ORDER BY occurred_at, execution_event_id`,
      [runId, afterMs],
    );
    return r.rows.map((row) => ({
      eventId: row.execution_event_id as string,
      eventType: row.event_type as string,
      payload: row.payload_json,
      occurredAt: row.occurred_at as Date,
    }));
  }
}
