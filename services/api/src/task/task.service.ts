import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  canCompleteRun,
  canReassign,
  canTransitionTask,
  computeActiveTaskNodes,
  isRealChannel,
  outboxIdempotencyKey,
  parseCompletionPolicy,
  validateCompletion,
  type CompletionPolicy,
  type DispatchChannel,
  type DispatchMessageType,
  type EscalationLevel,
  type TaskEventType,
  type TaskExecutionEventType,
  type UnableReasonCode,
} from '@une/domain';
import type { ErrorViolation } from '../common/api-error';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { DispatchRepository } from '../dispatch/dispatch.repository';
import type { RequestMeta } from '../plan/plan.service';
import { SopRunRepository } from '../sop/sop-run.repository';
import { taskErrors } from './task-errors';
import {
  TaskRepository,
  type TaskAssignmentRow,
  type TaskAttachmentRow,
  type TaskContextRow,
  type TaskEventRow,
  type TaskListRow,
} from './task.repository';

/**
 * 현장 임무 수행 (CC-280, UNE-TASK-001/002/004~012).
 *
 * 모든 전이는 한 트랜잭션이다: 조건부 UPDATE → 임무 이벤트 → 사실원장 → 감사
 * (그리고 지휘자에게 알려야 하는 것은 Outbox까지). 비협상 규칙이다.
 *
 * **담당자 확인이 두 계층이다.** 서비스가 먼저 보고, 조건부 UPDATE가 다시
 * 본다. 가드 통과 후 재배정이 일어나는 경합을 DB가 최종적으로 막는다.
 */

export interface TaskResource {
  taskId: string;
  runId: string;
  situationId: string;
  nodeKey: string;
  title: string;
  status: string;
  assigneeUserId: string | null;
  assigneeOrgId: string | null;
  assigneeHint: string | null;
  dueAt: string | null;
  progressPct: number;
  activatedAt: string | null;
  instructions: string[];
  createdAt: string;
}

export interface TaskEventResource {
  taskEventId: string;
  taskId: string;
  eventType: string;
  eventTime: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  /** 이 이벤트가 남긴 임무 상태 — 화면이 곧바로 Stepper를 갱신할 수 있게. */
  taskStatus: string;
}

export interface TaskAttachmentResource {
  taskAttachmentId: string;
  taskId: string;
  fileId: string;
  category: string;
  caption: string | null;
  geo: unknown;
  capturedAt: string | null;
  uploadedBy: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface TaskDetailResource {
  task: TaskResource;
  runStatus: string;
  runMode: string;
  completionPolicy: {
    checklist: Array<{ key: string; label: string; requiresEvidence: boolean }>;
    minAttachments: number;
    requireResult: boolean;
  };
  events: TaskEventResource[];
  attachments: TaskAttachmentResource[];
  assignments: Array<{
    taskAssignmentId: string;
    assigneeUserId: string | null;
    assigneeOrgId: string | null;
    assignedBy: string | null;
    assignedAt: string;
    source: string;
    reason: string | null;
  }>;
}

export interface TaskPageResource {
  items: TaskResource[];
  page: number;
  size: number;
  total: number;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toTaskResource(row: TaskListRow, policy: CompletionPolicy): TaskResource {
  return {
    taskId: row.taskId,
    runId: row.runId,
    situationId: row.situationId,
    nodeKey: row.nodeKey,
    title: row.title,
    status: row.status,
    assigneeUserId: row.assigneeUserId,
    assigneeOrgId: row.assigneeOrgId,
    assigneeHint: policy.assigneeHint,
    dueAt: iso(row.dueAt),
    progressPct: row.progressPct,
    activatedAt: iso(row.activatedAt),
    instructions: policy.instructions,
    createdAt: iso(row.createdAt) as string,
  };
}

function contextToResource(row: TaskContextRow, policy: CompletionPolicy): TaskResource {
  return {
    taskId: row.taskId,
    runId: row.runId,
    situationId: row.situationId,
    nodeKey: row.nodeKey,
    title: row.title,
    status: row.status,
    assigneeUserId: row.assigneeUserId,
    assigneeOrgId: row.assigneeOrgId,
    assigneeHint: policy.assigneeHint,
    dueAt: iso(row.dueAt),
    progressPct: row.progressPct,
    activatedAt: iso(row.activatedAt),
    instructions: policy.instructions,
    createdAt: iso(row.createdAt) as string,
  };
}

/**
 * 이벤트 하나.
 *
 * `taskStatus`는 **그 이벤트가 남긴** 상태다 — 페이로드에 함께 굳혀 두었기
 * 때문에 과거 이벤트도 자기 시점의 값을 말한다. 없으면(0039 이전에 쓰인 줄)
 * 지금 상태로 대신한다.
 */
function toEventResource(
  row: TaskEventRow,
  taskId: string,
  currentStatus: string,
): TaskEventResource {
  const recorded = row.payload.status;
  return {
    taskEventId: row.taskEventId,
    taskId,
    eventType: row.eventType,
    eventTime: iso(row.eventTime) as string,
    actorId: row.actorId,
    payload: row.payload,
    taskStatus: typeof recorded === 'string' ? recorded : currentStatus,
  };
}

function toAttachmentResource(row: TaskAttachmentRow, taskId: string): TaskAttachmentResource {
  return {
    taskAttachmentId: row.taskAttachmentId,
    taskId,
    fileId: row.fileId,
    category: row.category,
    caption: row.caption,
    geo: row.geo ?? null,
    capturedAt: iso(row.capturedAt),
    uploadedBy: row.uploadedBy,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
  };
}

function toAssignmentResource(row: TaskAssignmentRow): TaskDetailResource['assignments'][number] {
  return {
    taskAssignmentId: row.taskAssignmentId,
    assigneeUserId: row.assigneeUserId,
    assigneeOrgId: row.assigneeOrgId,
    assignedBy: row.assignedBy,
    assignedAt: iso(row.assignedAt) as string,
    source: row.source,
    reason: row.reason,
  };
}

/** 실행이 임무를 움직일 수 있는 상태인가. */
function runAcceptsWork(status: string): boolean {
  return status === 'RUNNING';
}

@Injectable()
export class TaskService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(TaskRepository) private readonly repo: TaskRepository,
    @Inject(SopRunRepository) private readonly runs: SopRunRepository,
    @Inject(DispatchRepository) private readonly dispatches: DispatchRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  // -------------------------------------------------------------------------
  // 조회
  // -------------------------------------------------------------------------

  /** UNE-TASK-001 — 임무 목록. */
  async listTasks(
    auth: AuthContext,
    filter: {
      assigneeUserId: string | null;
      status: string | null;
      situationId: string | null;
      dueBefore: Date | null;
      page: number;
      size: number;
    },
  ): Promise<TaskPageResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const { rows, total } = await this.repo.listTasks(c, auth.tenantId, {
        assigneeUserId: filter.assigneeUserId,
        status: filter.status,
        situationId: filter.situationId,
        dueBefore: filter.dueBefore,
        limit: filter.size,
        offset: (filter.page - 1) * filter.size,
      });
      // 목록 한 줄마다 완료조건을 다시 읽는다. 임무 행이 그것을 이미 들고
      // 있으므로 추가 질의는 없다.
      const items = rows.map((row) =>
        toTaskResource(row, parseCompletionPolicy(row.completionPolicy)),
      );
      return { items, page: filter.page, size: filter.size, total };
    });
  }

  /** UNE-TASK-002 — 임무 상세. */
  async getTask(auth: AuthContext, taskId: string): Promise<TaskDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.repo.findTask(c, auth.tenantId, taskId);
      if (!task) throw taskErrors.notFound();
      const policy = parseCompletionPolicy(task.completionPolicy);
      const [events, attachments, assignments] = await Promise.all([
        this.repo.listEvents(c, taskId),
        this.repo.listAttachments(c, taskId),
        this.repo.listAssignments(c, taskId),
      ]);
      return {
        task: contextToResource(task, policy),
        runStatus: task.runStatus,
        runMode: task.runMode,
        completionPolicy: {
          checklist: policy.checklist.map((i) => ({
            key: i.key,
            label: i.label,
            requiresEvidence: i.requiresEvidence === true,
          })),
          minAttachments: policy.minAttachments,
          requireResult: policy.requireResult,
        },
        events: events.map((e) => toEventResource(e, taskId, task.status)),
        attachments: attachments.map((a) => toAttachmentResource(a, taskId)),
        assignments: assignments.map(toAssignmentResource),
      };
    });
  }

  // -------------------------------------------------------------------------
  // 담당자 경로 (TASK_ASSIGNEE)
  // -------------------------------------------------------------------------

  /** UNE-TASK-004 — 수신확인. */
  async acknowledge(
    auth: AuthContext,
    taskId: string,
    input: { receivedAt: Date | null; deviceInfo: Record<string, unknown> | null },
    meta: RequestMeta,
  ): Promise<TaskEventResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.loadForAssignee(c, auth, taskId);
      if (task.status === 'ACKNOWLEDGED' || task.status === 'IN_PROGRESS') {
        // 설계 09 `TASK-5203`. 오프라인 재시도가 잦아 실제로 자주 온다.
        throw taskErrors.alreadyAcknowledged();
      }
      if (!canTransitionTask(task.status, 'ACKNOWLEDGED')) {
        throw taskErrors.alreadyAcknowledged();
      }
      return this.applyTransition(c, auth, task, meta, {
        toStatus: 'ACKNOWLEDGED',
        taskEventType: 'ACKNOWLEDGED',
        executionEventType: 'TASK_ACKNOWLEDGED',
        auditAction: 'TASK_ACKNOWLEDGED',
        payload: {
          // 기기 정보는 **모델·OS 수준까지만** 받는다. 식별자를 받으면 개인
          // 위치추적 자료가 되고 그것을 요구한 근거가 없다.
          receivedAt: iso(input.receivedAt),
          deviceInfo: input.deviceInfo ?? null,
        },
        progressPct: null,
      });
    });
  }

  /** UNE-TASK-005 — 착수. */
  async start(
    auth: AuthContext,
    taskId: string,
    input: { startedAt: Date | null; note: string | null },
    meta: RequestMeta,
  ): Promise<TaskEventResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.loadForAssignee(c, auth, taskId);
      if (!canTransitionTask(task.status, 'IN_PROGRESS')) {
        throw taskErrors.cannotStart(task.status);
      }
      return this.applyTransition(c, auth, task, meta, {
        toStatus: 'IN_PROGRESS',
        taskEventType: 'STARTED',
        executionEventType: 'TASK_STARTED',
        auditAction: 'TASK_STARTED',
        payload: { startedAt: iso(input.startedAt), note: input.note },
        progressPct: null,
      });
    });
  }

  /**
   * UNE-TASK-006 — 진행보고.
   *
   * **상태를 바꾸지 않는다.** 진행보고는 몇 번이든 올 수 있고 그때마다 상태가
   * 바뀌면 이력이 의미를 잃는다.
   */
  async reportProgress(
    auth: AuthContext,
    taskId: string,
    input: { progressPct: number; note: string | null; attachmentIds: string[] },
    meta: RequestMeta,
  ): Promise<TaskEventResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.loadForAssignee(c, auth, taskId);
      if (task.status !== 'IN_PROGRESS') throw taskErrors.cannotReport(task.status);

      const moved = await this.repo.updateProgress(c, {
        taskId,
        expectedStatus: 'IN_PROGRESS',
        expectedAssignee: auth.userId,
        progressPct: input.progressPct,
      });
      if (!moved) throw taskErrors.stateChanged();

      return this.recordEvent(c, auth, task, meta, {
        status: 'IN_PROGRESS',
        taskEventType: 'PROGRESS_REPORTED',
        executionEventType: 'TASK_PROGRESS_REPORTED',
        auditAction: 'TASK_PROGRESS_REPORTED',
        payload: {
          progressPct: input.progressPct,
          note: input.note,
          attachmentIds: input.attachmentIds,
        },
      });
    });
  }

  /**
   * UNE-TASK-007 — 완료 보고 (`result` 가 수행불가면 UNABLE_REPORTED).
   *
   * 설계 09 SCR-TASK-003은 "완료 제출"과 "수행불가"를 두 버튼으로 그리지만
   * 설계 10에는 완료 하나뿐이다. 우선순위가 높은 쪽(설계 10)을 따르되 요청의
   * `outcome`이 둘을 가른다 — 엔드포인트를 늘리지 않으면서 두 결과를 낸다.
   */
  async submitCompletion(
    auth: AuthContext,
    taskId: string,
    input: {
      outcome: 'DONE' | 'UNABLE';
      completedAt: Date | null;
      result: string;
      checklist: string[];
      unableReasonCode: UnableReasonCode | null;
    },
    meta: RequestMeta,
  ): Promise<TaskEventResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.loadForAssignee(c, auth, taskId);

      if (input.outcome === 'UNABLE') {
        if (!canTransitionTask(task.status, 'UNABLE_REPORTED')) {
          throw taskErrors.cannotReportUnable(task.status);
        }
        const violations: ErrorViolation[] = [];
        if (!input.unableReasonCode) {
          violations.push({ field: 'unableReasonCode', reason: '수행불가 사유를 고르십시오.' });
        }
        if (input.result.trim().length === 0) {
          violations.push({ field: 'result', reason: '상황을 설명해 주십시오.' });
        }
        if (violations.length > 0) throw taskErrors.invalidUnableReport(violations);

        return this.applyTransition(c, auth, task, meta, {
          toStatus: 'UNABLE_REPORTED',
          taskEventType: 'UNABLE_REPORTED',
          executionEventType: 'TASK_UNABLE_REPORTED',
          auditAction: 'TASK_UNABLE_REPORTED',
          payload: { reasonCode: input.unableReasonCode, result: input.result },
          progressPct: null,
          // 수행불가는 지휘자가 즉시 알아야 한다 — 아무도 안 하는 절차 단계가
          // 조용히 남는 것이 가장 위험하다.
          notify: { kind: 'UNABLE', summary: input.result, to: 'RUN_STARTER' },
        });
      }

      if (!canTransitionTask(task.status, 'COMPLETION_SUBMITTED')) {
        // 설계 09 `TASK-5207`. 승인 뒤 재제출을 조용히 흡수하면 감사 이력이
        // 오염된다.
        throw taskErrors.cannotSubmitCompletion(task.status);
      }

      const policy: CompletionPolicy = parseCompletionPolicy(task.completionPolicy);
      const attachmentCount = await this.repo.countAttachments(c, taskId);
      const violations = validateCompletion(policy, {
        result: input.result,
        checklist: input.checklist,
        attachmentCount,
      });
      if (violations.length > 0) throw taskErrors.completionRejected(violations);

      return this.applyTransition(c, auth, task, meta, {
        toStatus: 'COMPLETION_SUBMITTED',
        taskEventType: 'COMPLETION_SUBMITTED',
        executionEventType: 'TASK_COMPLETION_SUBMITTED',
        auditAction: 'TASK_COMPLETION_SUBMITTED',
        payload: {
          completedAt: iso(input.completedAt),
          result: input.result,
          checklist: input.checklist,
          attachmentCount,
        },
        progressPct: null,
      });
    });
  }

  /** UNE-TASK-012 — 현장 파일 등록. */
  async addAttachment(
    auth: AuthContext,
    taskId: string,
    input: {
      fileId: string;
      category: string;
      caption: string | null;
      geo: unknown;
      capturedAt: Date | null;
    },
    meta: RequestMeta,
  ): Promise<TaskAttachmentResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.loadForAssignee(c, auth, taskId);
      if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
        throw taskErrors.cannotReport(task.status);
      }

      const file = await this.repo.findUsableFile(c, auth.tenantId, input.fileId);
      if (!file) {
        throw taskErrors.attachmentRejected([
          { field: 'fileId', reason: '업로드된 파일을 찾을 수 없습니다.' },
        ]);
      }
      if (file.scanStatus !== 'CLEAN') {
        // 감염되거나 아직 검사 중인 파일이 임무 첨부로 들어가면 그것을 여는
        // 사람은 지휘소다.
        throw taskErrors.attachmentRejected([
          { field: 'fileId', reason: `악성코드 검사를 통과하지 않았습니다 (${file.scanStatus}).` },
        ]);
      }

      await this.repo.insertAttachment(c, {
        taskId,
        fileId: input.fileId,
        category: input.category,
        caption: input.caption,
        geo: input.geo,
        capturedAt: input.capturedAt,
        uploadedBy: auth.userId,
      });

      await this.runs.insertTaskEvent(c, {
        taskId,
        eventType: 'ATTACHMENT_ADDED' satisfies TaskEventType,
        actorId: auth.userId,
        payload: { fileId: input.fileId, category: input.category, status: task.status },
        correlationId: meta.correlationId,
      });
      await this.runs.insertExecutionEvent(c, {
        tenantId: auth.tenantId,
        situationId: task.situationId,
        aggregateType: 'TASK',
        aggregateId: taskId,
        eventType: 'TASK_ATTACHMENT_ADDED',
        actorId: auth.userId,
        payload: { fileId: input.fileId, category: input.category },
        correlationId: meta.correlationId,
      });
      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'TASK_ATTACHMENT_ADDED',
        resourceType: 'TASK',
        resourceId: taskId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const all = await this.repo.listAttachments(c, taskId);
      const created = all.find((a) => a.fileId === input.fileId);
      if (!created)
        throw taskErrors.attachmentRejected([{ field: 'fileId', reason: '등록 실패.' }]);
      return toAttachmentResource(created, taskId);
    });
  }

  // -------------------------------------------------------------------------
  // 지휘자 경로 (TASK_SUPERVISE)
  // -------------------------------------------------------------------------

  /** UNE-TASK-008 — 완료 승인. 실행이 여기서 스스로 끝날 수 있다. */
  async approveCompletion(
    auth: AuthContext,
    taskId: string,
    input: { comment: string | null },
    meta: RequestMeta,
  ): Promise<TaskEventResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.loadForSupervisor(c, auth.tenantId, taskId);
      if (!canTransitionTask(task.status, 'COMPLETED')) {
        throw taskErrors.cannotApprove(task.status);
      }
      const event = await this.applyTransition(c, auth, task, meta, {
        toStatus: 'COMPLETED',
        taskEventType: 'COMPLETION_APPROVED',
        executionEventType: 'TASK_COMPLETED',
        auditAction: 'TASK_COMPLETION_APPROVED',
        payload: { comment: input.comment },
        // 완료된 임무가 40%로 보이면 대시보드가 거짓말을 한다(0038 §4 CHECK).
        progressPct: 100,
        // 담당자 확인은 지휘자 경로에 걸지 않는다.
        skipAssigneeCheck: true,
      });

      await this.advanceRun(c, auth, task, meta);
      return event;
    });
  }

  /**
   * UNE-TASK-009 — 완료 반려.
   *
   * 임무는 `IN_PROGRESS`로 돌아간다. `REJECTED`라는 상태를 두지 않는 이유는
   * 그것이 어떤 순간에도 관측되지 않기 때문이다(0038 §1) — 반려됐다는 사실은
   * 이 이벤트가 들고 있다.
   */
  async rejectCompletion(
    auth: AuthContext,
    taskId: string,
    input: { reason: string },
    meta: RequestMeta,
  ): Promise<TaskEventResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.loadForSupervisor(c, auth.tenantId, taskId);
      if (task.status !== 'COMPLETION_SUBMITTED') throw taskErrors.cannotReject(task.status);

      return this.applyTransition(c, auth, task, meta, {
        toStatus: 'IN_PROGRESS',
        taskEventType: 'COMPLETION_REJECTED',
        executionEventType: 'TASK_COMPLETION_REJECTED',
        auditAction: 'TASK_COMPLETION_REJECTED',
        payload: { reason: input.reason },
        progressPct: null,
        skipAssigneeCheck: true,
        // 담당자가 다시 손봐야 한다는 것을 알려야 한다.
        notify: { kind: 'REJECT', summary: input.reason, to: 'ASSIGNEE' },
      });
    });
  }

  /** UNE-TASK-010 — 재배정. */
  async reassign(
    auth: AuthContext,
    taskId: string,
    input: { assigneeUserId: string | null; assigneeOrgId: string | null; reason: string },
    meta: RequestMeta,
  ): Promise<TaskEventResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.loadForSupervisor(c, auth.tenantId, taskId);
      if (!canReassign(task.status)) throw taskErrors.cannotReassign(task.status);

      const violations: ErrorViolation[] = [];
      if (!input.assigneeUserId && !input.assigneeOrgId) {
        violations.push({ field: 'assigneeId', reason: '재배정 대상을 지정하십시오.' });
      }
      if (input.assigneeUserId) {
        const user = await this.repo.findAssignableUser(c, auth.tenantId, input.assigneeUserId);
        if (!user) {
          // 설계 09 `TASK-5208`.
          violations.push({ field: 'assigneeUserId', reason: '대상 사용자를 찾을 수 없습니다.' });
        } else if (user.status !== 'ACTIVE') {
          violations.push({
            field: 'assigneeUserId',
            reason: `활성 사용자가 아닙니다 (${user.status}).`,
          });
        }
      }
      if (input.assigneeOrgId) {
        const org = await this.repo.findOrganization(c, auth.tenantId, input.assigneeOrgId);
        if (!org)
          violations.push({ field: 'assigneeOrgId', reason: '대상 조직을 찾을 수 없습니다.' });
      }
      if (input.assigneeUserId && input.assigneeUserId === task.assigneeUserId) {
        violations.push({ field: 'assigneeUserId', reason: '이미 이 임무의 담당자입니다.' });
      }
      if (violations.length > 0) throw taskErrors.reassignTargetInvalid(violations);

      const moved = await this.repo.reassignTask(c, {
        taskId,
        fromStatus: task.status,
        assigneeUserId: input.assigneeUserId,
        assigneeOrgId: input.assigneeOrgId,
      });
      if (!moved) throw taskErrors.stateChanged();

      await this.repo.insertAssignment(c, {
        taskId,
        assigneeUserId: input.assigneeUserId,
        assigneeOrgId: input.assigneeOrgId,
        assignedBy: auth.userId,
        source: 'REASSIGN',
        reason: input.reason,
      });

      const event = await this.recordEvent(c, auth, task, meta, {
        status: 'SENT',
        taskEventType: 'REASSIGNED',
        executionEventType: 'TASK_REASSIGNED',
        auditAction: 'TASK_REASSIGNED',
        payload: {
          fromAssigneeUserId: task.assigneeUserId,
          toAssigneeUserId: input.assigneeUserId,
          toAssigneeOrgId: input.assigneeOrgId,
          reason: input.reason,
          previousStatus: task.status,
        },
      });
      await this.notify(c, auth, task, meta, {
        kind: 'REASSIGN',
        summary: input.reason,
        recipientUserId: input.assigneeUserId,
        recipientOrgId: input.assigneeOrgId,
      });
      return event;
    });
  }

  /** UNE-TASK-011 — Escalation. 상태를 바꾸지 않고 위로 알린다. */
  async escalate(
    auth: AuthContext,
    taskId: string,
    input: { level: EscalationLevel; reason: string; targetUserIds: string[] },
    meta: RequestMeta,
  ): Promise<TaskEventResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const task = await this.loadForSupervisor(c, auth.tenantId, taskId);
      if (task.status === 'COMPLETED' || task.status === 'CANCELLED') {
        throw taskErrors.cannotEscalate(task.status);
      }
      if (!runAcceptsWork(task.runStatus)) throw taskErrors.runNotActive(task.runStatus);

      const violations: ErrorViolation[] = [];
      if (input.targetUserIds.length === 0) {
        violations.push({ field: 'targetIds', reason: 'Escalation 대상이 필요합니다.' });
      }
      for (const id of input.targetUserIds) {
        const user = await this.repo.findAssignableUser(c, auth.tenantId, id);
        if (!user)
          violations.push({ field: 'targetIds', reason: `대상을 찾을 수 없습니다: ${id}` });
      }
      if (violations.length > 0) throw taskErrors.invalidEscalation(violations);

      const event = await this.recordEvent(c, auth, task, meta, {
        status: task.status,
        taskEventType: 'ESCALATED',
        executionEventType: 'TASK_ESCALATED',
        auditAction: 'TASK_ESCALATED',
        payload: {
          level: input.level,
          reason: input.reason,
          targetCount: input.targetUserIds.length,
        },
      });

      for (const targetId of input.targetUserIds) {
        await this.notify(c, auth, task, meta, {
          kind: 'ESCALATE',
          summary: `[${input.level}] ${input.reason}`,
          recipientUserId: targetId,
          recipientOrgId: null,
        });
      }
      return event;
    });
  }

  // -------------------------------------------------------------------------
  // 내부
  // -------------------------------------------------------------------------

  /**
   * 담당자 경로의 선행조건.
   *
   * 권한(`TASK_ASSIGNEE`)은 가드가 이미 봤다. 여기서 보는 것은 **이 임무의**
   * 담당자인가이다 — 그 역할은 여러 사람이 함께 갖는다.
   */
  private async loadForAssignee(
    c: PoolClient,
    auth: AuthContext,
    taskId: string,
  ): Promise<TaskContextRow> {
    const task = await this.repo.findTask(c, auth.tenantId, taskId);
    if (!task) throw taskErrors.notFound();
    if (!runAcceptsWork(task.runStatus)) throw taskErrors.runNotActive(task.runStatus);
    if (!task.assigneeUserId) throw taskErrors.noAssignee();
    if (task.assigneeUserId !== auth.userId) throw taskErrors.notAssignee();
    return task;
  }

  private async loadForSupervisor(
    c: PoolClient,
    tenantId: string,
    taskId: string,
  ): Promise<TaskContextRow> {
    const task = await this.repo.findTask(c, tenantId, taskId);
    if (!task) throw taskErrors.notFound();
    if (!runAcceptsWork(task.runStatus)) throw taskErrors.runNotActive(task.runStatus);
    return task;
  }

  /** 조건부 UPDATE → 이벤트 → 사실원장 → 감사 (→ 필요하면 Outbox). */
  private async applyTransition(
    c: PoolClient,
    auth: AuthContext,
    task: TaskContextRow,
    meta: RequestMeta,
    step: {
      toStatus: string;
      taskEventType: TaskEventType;
      executionEventType: TaskExecutionEventType;
      auditAction: string;
      payload: Record<string, unknown>;
      progressPct: number | null;
      skipAssigneeCheck?: boolean;
      notify?: { kind: NotifyKind; summary: string; to: 'ASSIGNEE' | 'RUN_STARTER' };
    },
  ): Promise<TaskEventResource> {
    const moved = await this.repo.transitionTask(c, {
      taskId: task.taskId,
      fromStatus: task.status,
      toStatus: step.toStatus,
      expectedAssignee: step.skipAssigneeCheck ? null : auth.userId,
      progressPct: step.progressPct,
    });
    if (!moved) throw taskErrors.stateChanged();

    const event = await this.recordEvent(c, auth, task, meta, {
      status: step.toStatus,
      taskEventType: step.taskEventType,
      executionEventType: step.executionEventType,
      auditAction: step.auditAction,
      payload: step.payload,
    });

    if (step.notify) {
      const toStarter = step.notify.to === 'RUN_STARTER';
      await this.notify(c, auth, task, meta, {
        kind: step.notify.kind,
        summary: step.notify.summary,
        recipientUserId: toStarter ? task.runStartedBy : task.assigneeUserId,
        recipientOrgId: toStarter ? null : task.assigneeOrgId,
      });
    }
    return event;
  }

  /** 임무 이벤트 + 사실원장 + 감사. 상태를 바꾸지 않는 보고도 여기를 지난다. */
  private async recordEvent(
    c: PoolClient,
    auth: AuthContext,
    task: TaskContextRow,
    meta: RequestMeta,
    step: {
      status: string;
      taskEventType: TaskEventType;
      executionEventType: TaskExecutionEventType;
      auditAction: string;
      payload: Record<string, unknown>;
    },
  ): Promise<TaskEventResource> {
    // **상태를 페이로드에 함께 굳힌다.** 그렇지 않으면 나중에 이력을 낼 때
    // 모든 과거 이벤트에 현재 상태를 붙이게 되고(실측으로 그랬다), 화면이
    // "그때 무엇이 됐는가"를 물으면 거짓을 받는다. `task_event`에 상태 컬럼이
    // 없어 사후 재구성도 안 된다.
    const payload = { ...step.payload, status: step.status };
    const written = await this.runs.insertTaskEvent(c, {
      taskId: task.taskId,
      eventType: step.taskEventType,
      actorId: auth.userId,
      payload,
      correlationId: meta.correlationId,
    });
    await this.runs.insertExecutionEvent(c, {
      tenantId: auth.tenantId,
      situationId: task.situationId,
      aggregateType: 'TASK',
      aggregateId: task.taskId,
      eventType: step.executionEventType,
      actorId: auth.userId,
      payload: { ...payload, runId: task.runId, nodeKey: task.nodeKey },
      correlationId: meta.correlationId,
    });
    await this.audit.insertAudit(c, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action: step.auditAction,
      resourceType: 'TASK',
      resourceId: task.taskId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      taskEventId: written.taskEventId,
      taskId: task.taskId,
      eventType: step.taskEventType,
      eventTime: iso(written.eventTime) as string,
      actorId: auth.userId,
      payload,
      taskStatus: step.status,
    };
  }

  /**
   * 알림 — 전파(CC-270)를 그대로 쓴다.
   *
   * **여기서 채널을 부르지 않는다.** Outbox 한 줄을 같은 트랜잭션에 넣고
   * 워커가 보낸다(ADR-41 D1). 지금 그 줄은 시뮬레이션 채널로 나가므로
   * 아무 데도 도착하지 않는다 — OB-06이 닫혀야 실제로 간다.
   *
   * 모의·훈련 실행에서는 알리지 않는다: `dispatchesForReal`이 LIVE에서만 참인
   * 것과 같은 규칙이고, 훈련 반려가 실제 지휘관에게 가면 훈련이 아니다.
   */
  private async notify(
    c: PoolClient,
    auth: AuthContext,
    task: TaskContextRow,
    meta: RequestMeta,
    input: {
      kind: NotifyKind;
      summary: string;
      recipientUserId: string | null;
      recipientOrgId: string | null;
    },
  ): Promise<void> {
    if (task.runMode !== 'LIVE') return;
    if (!input.recipientUserId && !input.recipientOrgId) return;

    const channel: DispatchChannel = 'SYSTEM';
    const dispatch = await this.dispatches.insertDispatch(c, {
      taskId: task.taskId,
      situationId: task.situationId,
      // **`TASK`가 아니다.** 릴레이는 `TASK` 전파가 성공하면 그 임무를 `SENT`로
      // 올리는데(ADR-41), 알림은 지시가 아니므로 그러면 안 된다 — 지시가 한 번도
      // 나가지 않은 임무가 "전파됨"으로 보이고 그 전이는 이벤트도 남기지 않는다.
      messageType: (input.kind === 'ESCALATE'
        ? 'ESCALATION'
        : 'TASK_NOTICE') as DispatchMessageType,
      messageBody: `${NOTIFY_TITLES[input.kind]}: ${task.title}\n${input.summary}`,
      createdBy: auth.userId,
    });
    const recipientId = await this.dispatches.insertRecipient(c, {
      dispatchId: dispatch.dispatchId,
      userId: input.recipientUserId,
      organizationId: input.recipientOrgId,
      channel,
    });
    await this.dispatches.insertOutbox(c, {
      tenantId: auth.tenantId,
      aggregateId: dispatch.dispatchId,
      eventType: NOTIFY_EVENT_TYPES[input.kind],
      channel,
      payload: {
        // 주소가 아니라 참조다(ADR-41 수용 한계 3).
        recipientRef: input.recipientUserId ?? input.recipientOrgId ?? recipientId,
        subject: `${NOTIFY_TITLES[input.kind]}: ${task.title}`,
        body: input.summary,
        correlationId: meta.correlationId,
      },
      idempotencyKey: outboxIdempotencyKey({
        dispatchId: dispatch.dispatchId,
        recipientId,
        channel,
      }),
      dispatchRecipientId: recipientId,
    });
    // 시뮬레이션 여부는 여기서도 숨기지 않는다 — 사실원장이 그것을 들고 있어야
    // 나중에 "그때 실제로 나갔는가"에 답할 수 있다.
    await this.runs.insertExecutionEvent(c, {
      tenantId: auth.tenantId,
      situationId: task.situationId,
      aggregateType: 'DISPATCH',
      aggregateId: dispatch.dispatchId,
      eventType: NOTIFY_EVENT_TYPES[input.kind],
      actorId: auth.userId,
      payload: {
        taskId: task.taskId,
        kind: input.kind,
        channel,
        simulated: !isRealChannel(channel),
      },
      correlationId: meta.correlationId,
    });
  }

  /**
   * 임무 하나가 끝나면 실행이 앞으로 나아간다.
   *
   * 다음 차례를 **계산**한다(0036 §7 — 커서를 저장하지 않는다). 남은 임무가
   * 전부 끝났으면 실행도 끝난다. 수행불가로 남은 것이 있으면 끝내지 않는다 —
   * 아무도 하지 않은 절차 단계가 완료된 실행 안에 조용히 남는다.
   */
  private async advanceRun(
    c: PoolClient,
    auth: AuthContext,
    task: TaskContextRow,
    meta: RequestMeta,
  ): Promise<void> {
    // **실행 행을 잠근다.** 서로 다른 임무를 동시에 승인하면 두 트랜잭션의
    // 잠금이 겹치지 않아 둘 다 상대를 아직 미완료로 본다 — 모든 임무가
    // COMPLETED인데 실행이 RUNNING에 갇힌다. 그 상태를 되돌릴 경로가 없어
    // 강제종료만 남고, 그러면 감사 이력에 "완주"가 아니라 "강제종료"가 남는다.
    // 같은 이유로 활성화 계산도 낡은 집합으로 돌 수 있다.
    await this.runs.findRun(c, task.runId, { forUpdate: true });

    const graph = await this.repo.findRunGraph(c, task.runId);
    const completed = new Set(await this.repo.listCompletedNodeKeys(c, task.runId));
    const active = computeActiveTaskNodes(
      {
        nodes: graph.nodes.map((n) => ({
          nodeKey: n.nodeKey,
          type: n.type as 'START' | 'ACTION' | 'DECISION' | 'NOTE' | 'END',
          title: n.title,
        })),
        edges: graph.edges,
      },
      completed,
    );
    const activated = await this.repo.activateTasks(c, task.runId, active);
    if (activated.length > 0) {
      // **실행 애그리거트에 남긴다.** UNE-SOP-013 SSE는 `aggregate_type='SOP_RUN'`
      // 으로만 거르므로(CC-260), 임무 애그리거트에만 남기면 실행 화면이 진행을
      // 보지 못한다 — 시작 시점의 활성화는 보이는데 그 뒤가 안 보인다.
      await this.runs.insertExecutionEvent(c, {
        tenantId: auth.tenantId,
        situationId: task.situationId,
        aggregateType: 'SOP_RUN',
        aggregateId: task.runId,
        eventType: 'TASK_ACTIVATED',
        actorId: null,
        payload: { taskIds: activated, nodeKeys: active, afterTaskId: task.taskId },
        correlationId: meta.correlationId,
      });
    }

    const statuses = await this.repo.listRunTaskStatuses(c, task.runId);
    if (!canCompleteRun(statuses)) return;
    const ended = await this.repo.completeRun(c, task.runId);
    if (!ended) return;
    await this.runs.insertExecutionEvent(c, {
      tenantId: auth.tenantId,
      situationId: task.situationId,
      aggregateType: 'SOP_RUN',
      aggregateId: task.runId,
      eventType: 'RUN_COMPLETED',
      actorId: auth.userId,
      payload: { taskCount: statuses.length },
      correlationId: meta.correlationId,
    });
    await this.audit.insertAudit(c, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action: 'SOP_RUN_COMPLETED',
      resourceType: 'SOP_RUN',
      resourceId: task.runId,
      correlationId: meta.correlationId,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }
}

type NotifyKind = 'UNABLE' | 'REJECT' | 'REASSIGN' | 'ESCALATE';

const NOTIFY_TITLES: Record<NotifyKind, string> = {
  UNABLE: '임무 수행불가 보고',
  REJECT: '완료 반려',
  REASSIGN: '임무 재배정',
  ESCALATE: 'Escalation',
};

const NOTIFY_EVENT_TYPES: Record<NotifyKind, TaskExecutionEventType> = {
  UNABLE: 'TASK_UNABLE_REPORTED',
  REJECT: 'TASK_COMPLETION_REJECTED',
  REASSIGN: 'TASK_REASSIGNED',
  ESCALATE: 'TASK_ESCALATED',
};
