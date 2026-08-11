import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * 현장 임무 저장소 (CC-280).
 *
 * **상태 전이는 전부 조건부 UPDATE다** — `WHERE task_id = $1 AND status = $2
 * [AND assignee_user_id = $3]`. 0행이면 그사이 누군가 바꿨거나 담당자가
 * 아니라는 뜻이고 호출부가 409로 되돌린다.
 *
 * 앱 계층 가드에서 "당신이 담당자인가"를 먼저 보지만 그것만으로는 부족하다.
 * 가드를 통과한 뒤 재배정이 일어나면(현장에서 흔하다) 옛 담당자의 요청이
 * 그대로 통과한다 — 시간차 경합이다. DB 조건이 마지막 방어선이다(0038 §4).
 */

export interface TaskContextRow {
  taskId: string;
  runId: string;
  nodeId: string;
  nodeKey: string;
  title: string;
  status: string;
  assigneeUserId: string | null;
  assigneeOrgId: string | null;
  dueAt: Date | null;
  progressPct: number;
  activatedAt: Date | null;
  versionNo: number;
  completionPolicy: unknown;
  createdAt: Date;
  runStatus: string;
  runMode: string;
  runStartedBy: string | null;
  situationId: string;
}

export interface TaskListRow {
  taskId: string;
  runId: string;
  situationId: string;
  nodeKey: string;
  title: string;
  status: string;
  assigneeUserId: string | null;
  assigneeOrgId: string | null;
  dueAt: Date | null;
  progressPct: number;
  activatedAt: Date | null;
  completionPolicy: unknown;
  createdAt: Date;
}

export interface TaskEventRow {
  taskEventId: string;
  eventType: string;
  eventTime: Date;
  actorId: string | null;
  payload: Record<string, unknown>;
}

export interface TaskAttachmentRow {
  taskAttachmentId: string;
  fileId: string;
  category: string;
  caption: string | null;
  geo: unknown;
  capturedAt: Date | null;
  uploadedBy: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface TaskAssignmentRow {
  taskAssignmentId: string;
  assigneeUserId: string | null;
  assigneeOrgId: string | null;
  assignedBy: string | null;
  assignedAt: Date;
  source: string;
  reason: string | null;
}

const TASK_LIST_COLUMNS = `t.task_id, t.run_id, r.situation_id, n.node_key, t.title, t.status,
       t.assignee_user_id, t.assignee_org_id, t.due_at, t.progress_pct,
       t.activated_at, t.completion_policy_json, t.created_at`;

function toListRow(row: Record<string, unknown>): TaskListRow {
  return {
    taskId: row.task_id as string,
    runId: row.run_id as string,
    situationId: row.situation_id as string,
    nodeKey: row.node_key as string,
    title: row.title as string,
    status: row.status as string,
    assigneeUserId: (row.assignee_user_id as string | null) ?? null,
    assigneeOrgId: (row.assignee_org_id as string | null) ?? null,
    dueAt: (row.due_at as Date | null) ?? null,
    progressPct: Number(row.progress_pct),
    activatedAt: (row.activated_at as Date | null) ?? null,
    completionPolicy: row.completion_policy_json,
    createdAt: row.created_at as Date,
  };
}

@Injectable()
export class TaskRepository {
  /**
   * UNE-TASK-001 — 임무 목록.
   *
   * 테넌트는 RLS가 이미 건다. 여기서 거르는 것은 화면이 요구한 조건뿐이다.
   */
  async listTasks(
    c: PoolClient,
    tenantId: string,
    filter: {
      assigneeUserId: string | null;
      status: string | null;
      situationId: string | null;
      dueBefore: Date | null;
      limit: number;
      offset: number;
    },
  ): Promise<{ rows: TaskListRow[]; total: number }> {
    // RLS가 이미 테넌트를 걸지만 **저장소도 명시적으로 건다**(ADR-21 보상통제).
    // 정책 하나가 드롭되거나 롤이 BYPASSRLS를 얻는 순간 격리가 사라지는 단일
    // 방어선을 만들지 않는다.
    const where: string[] = ['s.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    const add = (sql: string, value: unknown): void => {
      params.push(value);
      where.push(sql.replace('$?', `$${params.length}`));
    };
    if (filter.assigneeUserId) add('t.assignee_user_id = $?', filter.assigneeUserId);
    if (filter.status) add('t.status = $?', filter.status);
    if (filter.situationId) add('r.situation_id = $?', filter.situationId);
    if (filter.dueBefore) add('t.due_at IS NOT NULL AND t.due_at <= $?', filter.dueBefore);
    const clause = `WHERE ${where.join(' AND ')}`;

    const total = await c.query(
      `SELECT count(*)::int AS n
         FROM task t
         JOIN sop_run r ON r.run_id = t.run_id
         JOIN situation s ON s.situation_id = r.situation_id
         JOIN sop_node n ON n.node_id = t.node_id
        ${clause}`,
      params,
    );
    const rows = await c.query(
      `SELECT ${TASK_LIST_COLUMNS}
         FROM task t
         JOIN sop_run r ON r.run_id = t.run_id
         JOIN situation s ON s.situation_id = r.situation_id
         JOIN sop_node n ON n.node_id = t.node_id
        ${clause}
        ORDER BY t.due_at NULLS LAST, t.created_at, t.task_id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, filter.limit, filter.offset],
    );
    return { rows: rows.rows.map(toListRow), total: total.rows[0].n as number };
  }

  /**
   * 임무 하나와 그것이 속한 실행·상황.
   *
   * RLS 위에 **명시적 부모 조인**을 한 겹 더 둔다(ADR-21 보상통제). 이웃
   * 저장소(`dispatch`·`sop_run`)가 같은 형태다.
   */
  async findTask(c: PoolClient, tenantId: string, taskId: string): Promise<TaskContextRow | null> {
    const r = await c.query(
      `SELECT t.task_id, t.run_id, t.node_id, n.node_key, t.title, t.status,
              t.assignee_user_id, t.assignee_org_id, t.due_at, t.progress_pct,
              t.activated_at, t.version_no, t.completion_policy_json, t.created_at,
              r.status AS run_status, r.mode AS run_mode, r.started_by AS run_started_by,
              r.situation_id
         FROM task t
         JOIN sop_run r ON r.run_id = t.run_id
         JOIN situation s ON s.situation_id = r.situation_id
         JOIN sop_node n ON n.node_id = t.node_id
        WHERE t.task_id = $1 AND s.tenant_id = $2`,
      [taskId, tenantId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      taskId: row.task_id as string,
      runId: row.run_id as string,
      nodeId: row.node_id as string,
      nodeKey: row.node_key as string,
      title: row.title as string,
      status: row.status as string,
      assigneeUserId: (row.assignee_user_id as string | null) ?? null,
      assigneeOrgId: (row.assignee_org_id as string | null) ?? null,
      dueAt: (row.due_at as Date | null) ?? null,
      progressPct: Number(row.progress_pct),
      activatedAt: (row.activated_at as Date | null) ?? null,
      versionNo: Number(row.version_no),
      completionPolicy: row.completion_policy_json,
      createdAt: row.created_at as Date,
      runStatus: row.run_status as string,
      runMode: row.run_mode as string,
      runStartedBy: (row.run_started_by as string | null) ?? null,
      situationId: row.situation_id as string,
    };
  }

  /**
   * 담당자 본인 확인을 **DB가** 한 번 더 한다.
   *
   * `expectedAssignee`가 주어지면 그 사람이 아직 담당자일 때만 바뀐다.
   * 0행이면 상태가 바뀌었거나 담당자가 바뀌었다 — 어느 쪽이든 이 요청은 낡았다.
   */
  async transitionTask(
    c: PoolClient,
    input: {
      taskId: string;
      fromStatus: string;
      toStatus: string;
      expectedAssignee: string | null;
      progressPct: number | null;
    },
  ): Promise<boolean> {
    const r = await c.query(
      `UPDATE task
          SET status = $3,
              progress_pct = COALESCE($5, progress_pct),
              version_no = version_no + 1
        WHERE task_id = $1
          AND status = $2
          AND ($4::uuid IS NULL OR assignee_user_id = $4)`,
      [input.taskId, input.fromStatus, input.toStatus, input.expectedAssignee, input.progressPct],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** 진행보고는 상태를 바꾸지 않는다 — 진행률만 움직인다. */
  async updateProgress(
    c: PoolClient,
    input: {
      taskId: string;
      expectedStatus: string;
      expectedAssignee: string;
      progressPct: number;
    },
  ): Promise<boolean> {
    const r = await c.query(
      `UPDATE task SET progress_pct = $4, version_no = version_no + 1
        WHERE task_id = $1 AND status = $2 AND assignee_user_id = $3`,
      [input.taskId, input.expectedStatus, input.expectedAssignee, input.progressPct],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * 재배정 — 담당자를 바꾸고 임무를 새 담당자의 `SENT`로 되돌린다.
   *
   * 새 담당자가 수신확인부터 다시 하는 것이 핵심이다. 진행 중이던 상태를
   * 그대로 물려주면 "받지도 않은 사람이 착수해 있는" 임무가 생긴다.
   */
  async reassignTask(
    c: PoolClient,
    input: {
      taskId: string;
      fromStatus: string;
      assigneeUserId: string | null;
      assigneeOrgId: string | null;
    },
  ): Promise<boolean> {
    const r = await c.query(
      `UPDATE task
          SET status = 'SENT', assignee_user_id = $3, assignee_org_id = $4,
              progress_pct = 0, version_no = version_no + 1
        WHERE task_id = $1 AND status = $2`,
      [input.taskId, input.fromStatus, input.assigneeUserId, input.assigneeOrgId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async insertAssignment(
    c: PoolClient,
    input: {
      taskId: string;
      assigneeUserId: string | null;
      assigneeOrgId: string | null;
      assignedBy: string | null;
      source: 'DISPATCH' | 'REASSIGN';
      reason: string | null;
    },
  ): Promise<string> {
    const r = await c.query(
      `INSERT INTO task_assignment
         (task_id, assignee_user_id, assignee_org_id, assigned_by, source, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING task_assignment_id`,
      [
        input.taskId,
        input.assigneeUserId,
        input.assigneeOrgId,
        input.assignedBy,
        input.source,
        input.reason,
      ],
    );
    return r.rows[0].task_assignment_id as string;
  }

  async listAssignments(c: PoolClient, taskId: string): Promise<TaskAssignmentRow[]> {
    const r = await c.query(
      `SELECT task_assignment_id, assignee_user_id, assignee_org_id, assigned_by,
              assigned_at, source, reason
         FROM task_assignment WHERE task_id = $1 ORDER BY assigned_at, task_assignment_id`,
      [taskId],
    );
    return r.rows.map((row) => ({
      taskAssignmentId: row.task_assignment_id as string,
      assigneeUserId: (row.assignee_user_id as string | null) ?? null,
      assigneeOrgId: (row.assignee_org_id as string | null) ?? null,
      assignedBy: (row.assigned_by as string | null) ?? null,
      assignedAt: row.assigned_at as Date,
      source: row.source as string,
      reason: (row.reason as string | null) ?? null,
    }));
  }

  async listEvents(c: PoolClient, taskId: string): Promise<TaskEventRow[]> {
    const r = await c.query(
      `SELECT task_event_id, event_type, event_time, actor_id, payload_json
         FROM task_event WHERE task_id = $1 ORDER BY event_time, task_event_id`,
      [taskId],
    );
    return r.rows.map((row) => ({
      taskEventId: row.task_event_id as string,
      eventType: row.event_type as string,
      eventTime: row.event_time as Date,
      actorId: (row.actor_id as string | null) ?? null,
      payload: (row.payload_json ?? {}) as Record<string, unknown>,
    }));
  }

  /**
   * 현장 첨부 (UNE-TASK-012).
   *
   * `file_object`와 조인해서 낸다 — 파일 이름·크기·형식은 파일 쪽이 정본이고
   * 첨부 행에 베껴 두면 둘이 어긋난다.
   */
  async listAttachments(c: PoolClient, taskId: string): Promise<TaskAttachmentRow[]> {
    const r = await c.query(
      `SELECT a.task_attachment_id, a.file_id, a.category, a.caption, a.geo_json,
              a.captured_at, a.uploaded_by,
              f.original_name, f.mime_type, f.size_bytes
         FROM task_attachment a
         JOIN file_object f ON f.file_id = a.file_id
        WHERE a.task_id = $1
        ORDER BY a.captured_at NULLS LAST, a.task_attachment_id`,
      [taskId],
    );
    return r.rows.map((row) => ({
      taskAttachmentId: row.task_attachment_id as string,
      fileId: row.file_id as string,
      category: row.category as string,
      caption: (row.caption as string | null) ?? null,
      geo: row.geo_json,
      capturedAt: (row.captured_at as Date | null) ?? null,
      uploadedBy: row.uploaded_by as string,
      originalName: row.original_name as string,
      mimeType: row.mime_type as string,
      sizeBytes: Number(row.size_bytes),
    }));
  }

  async countAttachments(c: PoolClient, taskId: string): Promise<number> {
    const r = await c.query(`SELECT count(*)::int AS n FROM task_attachment WHERE task_id = $1`, [
      taskId,
    ]);
    return r.rows[0].n as number;
  }

  async insertAttachment(
    c: PoolClient,
    input: {
      taskId: string;
      fileId: string;
      category: string;
      caption: string | null;
      geo: unknown;
      capturedAt: Date | null;
      uploadedBy: string;
    },
  ): Promise<string | null> {
    // 같은 파일을 두 번 붙이면 목록에 같은 사진이 둘로 보인다. 현장 앱은
    // 재시도가 잦아 그 중복이 실제로 생기므로 조용히 흡수한다.
    const r = await c.query(
      `INSERT INTO task_attachment
         (task_id, file_id, category, caption, geo_json, captured_at, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (task_id, file_id) DO NOTHING
       RETURNING task_attachment_id`,
      [
        input.taskId,
        input.fileId,
        input.category,
        input.caption,
        input.geo === null || input.geo === undefined ? null : JSON.stringify(input.geo),
        input.capturedAt,
        input.uploadedBy,
      ],
    );
    return r.rows[0] ? (r.rows[0].task_attachment_id as string) : null;
  }

  /**
   * 첨부할 파일이 이 테넌트의 것이고 검사를 통과했는가.
   *
   * `scan_status`를 보는 이유: 감염된 파일이 임무 첨부로 들어가면 그것을 여는
   * 사람은 지휘소다. RLS가 테넌트를 걸지만 `file_object`는 `tenant_id`를 직접
   * 들고 있어 한 번 더 확인한다.
   */
  async findUsableFile(
    c: PoolClient,
    tenantId: string,
    fileId: string,
  ): Promise<{ fileId: string; scanStatus: string; mimeType: string; sizeBytes: number } | null> {
    const r = await c.query(
      `SELECT file_id, scan_status, mime_type, size_bytes
         FROM file_object WHERE file_id = $1 AND tenant_id = $2`,
      [fileId, tenantId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      fileId: row.file_id as string,
      scanStatus: row.scan_status as string,
      mimeType: row.mime_type as string,
      sizeBytes: Number(row.size_bytes),
    };
  }

  /** 재배정 대상이 이 테넌트에 실재하고 활성인가 (설계 09 `TASK-5208`). */
  async findAssignableUser(
    c: PoolClient,
    tenantId: string,
    userId: string,
  ): Promise<{ userId: string; status: string } | null> {
    const r = await c.query(
      `SELECT user_id, status FROM app_user WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return { userId: row.user_id as string, status: row.status as string };
  }

  async findOrganization(
    c: PoolClient,
    tenantId: string,
    organizationId: string,
  ): Promise<{ organizationId: string } | null> {
    const r = await c.query(
      `SELECT organization_id FROM organization WHERE organization_id = $1 AND tenant_id = $2`,
      [organizationId, tenantId],
    );
    return r.rows[0] ? { organizationId: r.rows[0].organization_id as string } : null;
  }

  /**
   * 이 실행의 임무 상태 전부 — 실행이 끝났는지 판단하는 재료.
   */
  async listRunTaskStatuses(c: PoolClient, runId: string): Promise<string[]> {
    const r = await c.query(`SELECT status FROM task WHERE run_id = $1`, [runId]);
    return r.rows.map((row) => row.status as string);
  }

  /** 완료된 임무의 노드 key — 다음 차례를 계산하는 재료. */
  async listCompletedNodeKeys(c: PoolClient, runId: string): Promise<string[]> {
    const r = await c.query(
      `SELECT n.node_key
         FROM task t JOIN sop_node n ON n.node_id = t.node_id
        WHERE t.run_id = $1 AND t.status IN ('COMPLETED', 'CANCELLED')`,
      [runId],
    );
    return r.rows.map((row) => row.node_key as string);
  }

  /**
   * 다음 차례가 된 임무를 활성화한다.
   *
   * 이미 활성인 것은 건드리지 않는다 — `activated_at`이 바뀌면 "언제부터 할
   * 차례였는가"가 흔들리고, 기한 판단이 그 값을 쓴다.
   */
  async activateTasks(c: PoolClient, runId: string, nodeKeys: string[]): Promise<string[]> {
    if (nodeKeys.length === 0) return [];
    const r = await c.query(
      `UPDATE task t SET activated_at = now()
         FROM sop_node n
        WHERE n.node_id = t.node_id
          AND t.run_id = $1
          AND n.node_key = ANY($2::text[])
          AND t.activated_at IS NULL
          AND t.status NOT IN ('COMPLETED', 'CANCELLED')
       RETURNING t.task_id`,
      [runId, nodeKeys],
    );
    return r.rows.map((row) => row.task_id as string);
  }

  /**
   * 실행이 쓰고 있는 그래프.
   *
   * 다음 차례를 **계산**하는 재료다(0036 §7 — 커서를 저장하지 않는다).
   */
  async findRunGraph(
    c: PoolClient,
    runId: string,
  ): Promise<{
    nodes: Array<{ nodeKey: string; type: string; title: string }>;
    edges: Array<{ fromNodeKey: string; toNodeKey: string }>;
  }> {
    const nodes = await c.query(
      `SELECT n.node_key, n.node_type, n.title
         FROM sop_node n
         JOIN sop_run r ON r.sop_version_id = n.sop_version_id
        WHERE r.run_id = $1
        ORDER BY n.sort_order, n.node_key`,
      [runId],
    );
    const edges = await c.query(
      `SELECT fn.node_key AS from_key, tn.node_key AS to_key
         FROM sop_edge e
         JOIN sop_run r ON r.sop_version_id = e.sop_version_id
         JOIN sop_node fn ON fn.node_id = e.from_node_id
         JOIN sop_node tn ON tn.node_id = e.to_node_id
        WHERE r.run_id = $1`,
      [runId],
    );
    return {
      nodes: nodes.rows.map((row) => ({
        nodeKey: row.node_key as string,
        type: row.node_type as string,
        title: row.title as string,
      })),
      edges: edges.rows.map((row) => ({
        fromNodeKey: row.from_key as string,
        toNodeKey: row.to_key as string,
      })),
    };
  }

  /** 실행 종료 — 모든 임무가 끝났을 때만 호출된다. */
  async completeRun(c: PoolClient, runId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE sop_run SET status = 'COMPLETED', ended_at = now()
        WHERE run_id = $1 AND status = 'RUNNING'`,
      [runId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}
