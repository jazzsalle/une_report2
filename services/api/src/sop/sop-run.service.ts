import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  affectsSituation,
  canTransitionRun,
  computeActiveTaskNodes,
  isTaskNode,
  terminateConfirmCode,
  type RunEventType,
  type SopEdgeDraft,
  type SopNodeDraft,
  type SopRunMode,
} from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import type { RequestMeta } from '../plan/plan.service';
import { SituationRepository } from '../situation/situation.repository';
import { sopRunErrors } from './sop-run-errors';
import { SopRunRepository, type SopRunRow, type TaskRow } from './sop-run.repository';
import { SopRepository } from './sop.repository';

/**
 * UNE-SOP-010~016 (CC-260).
 *
 * 승인된 SOP 버전을 실행한다. 임무를 만들고, 지금 할 차례인 것을 활성화하고,
 * 일시중지·재개·강제종료를 사실원장에 남긴다.
 *
 * **전파는 여기서 하지 않는다**(CC-270 Outbox). 임무 수행 보고도 여기가 아니다
 * (CC-280). 그래서 실행은 아직 스스로 끝나지 못한다 — `COMPLETED`가 어휘에
 * 없는 이유다.
 */

export interface SopRunResource {
  runId: string;
  sopVersionId: string;
  situationId: string;
  snapshotId: string;
  mode: string;
  status: string;
  startedBy: string | null;
  startedAt: string;
  endedAt: string | null;
  correlationId: string;
}

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

export interface SopRunDetailResource {
  run: SopRunResource;
  tasks: TaskResource[];
  activeNodeKeys: string[];
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toRunResource(row: SopRunRow): SopRunResource {
  return {
    runId: row.runId,
    sopVersionId: row.sopVersionId,
    situationId: row.situationId,
    snapshotId: row.snapshotId,
    mode: row.mode,
    status: row.status,
    startedBy: row.startedBy,
    startedAt: iso(row.startedAt) as string,
    endedAt: iso(row.endedAt),
    correlationId: row.correlationId,
  };
}

function toTaskResource(row: TaskRow, situationId: string): TaskResource {
  return {
    taskId: row.taskId,
    runId: row.runId,
    situationId,
    nodeKey: row.nodeKey,
    title: row.title,
    status: row.status,
    assigneeUserId: row.assigneeUserId,
    assigneeOrgId: row.assigneeOrgId,
    assigneeHint: row.assigneeHint,
    dueAt: iso(row.dueAt),
    progressPct: row.progressPct,
    activatedAt: iso(row.activatedAt),
    instructions: row.instructions,
    createdAt: iso(row.createdAt) as string,
  };
}

/** `sop_node.config_json`에서 임무 재료를 꺼낸다. */
function nodeTaskInput(config: unknown): { instructions: string[]; assigneeHint: string | null } {
  const c = (config ?? {}) as {
    tasks?: Array<{ instruction?: unknown; assigneeHint?: unknown }>;
  };
  const tasks = Array.isArray(c.tasks) ? c.tasks : [];
  const instructions = tasks
    .map((t) => (typeof t.instruction === 'string' ? t.instruction : ''))
    .filter((x) => x.length > 0);
  const hint = tasks.find((t) => typeof t.assigneeHint === 'string' && t.assigneeHint.length > 0);
  return {
    instructions,
    assigneeHint: hint ? (hint.assigneeHint as string) : null,
  };
}

@Injectable()
export class SopRunService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SopRunRepository) private readonly runs: SopRunRepository,
    @Inject(SopRepository) private readonly sops: SopRepository,
    @Inject(SituationRepository) private readonly situations: SituationRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** UNE-SOP-010 (DRY_RUN) / UNE-SOP-011 (LIVE·EXERCISE) */
  async startRun(
    auth: AuthContext,
    sopId: string,
    input: {
      versionId: string;
      snapshotId: string;
      mode: SopRunMode;
      /** DRY_RUN 시나리오 메모. 사실원장에 남는다. */
      scenario?: string | null;
    },
    meta: RequestMeta,
  ): Promise<SopRunResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const sop = await this.sops.findSop(c, auth.tenantId, sopId, { forUpdate: true });
      if (!sop) throw sopRunErrors.sopNotFound();

      const graph = await this.runs.findVersionGraph(c, auth.tenantId, sopId, input.versionId);
      if (!graph) throw sopRunErrors.versionNotFound();
      // **승인된 버전만 실행한다.** 초안을 실행하면 검토받지 않은 절차가
      // 현장에 나간다.
      if (graph.versionStatus !== 'LOCKED') throw sopRunErrors.versionNotApproved();

      const situationId = graph.situationId;
      if (!situationId) throw sopRunErrors.situationRequired();
      const situation = await this.situations.findSituation(c, auth.tenantId, situationId, {
        forUpdate: true,
      });
      if (!situation) throw sopRunErrors.situationNotFound();
      // 실행은 **확정된 판** 위에서 시작한다. 낡은 판으로 시작하면 대응의
      // 근거와 실제 사실이 어긋난 채로 굳는다.
      if (situation.currentSnapshotId !== input.snapshotId) {
        throw sopRunErrors.snapshotNotCurrent(situation.currentSnapshotId ?? '(없음)');
      }

      if (affectsSituation(input.mode)) {
        // 모의는 세지 않는다 — 실제 대응과 나란히 돌 수 있어야 한다.
        const live = await this.runs.findLiveRun(c, situationId);
        if (live) throw sopRunErrors.runAlreadyLive(live.runId);
      }

      // DRY_RUN은 READY로 남는다 — "시작했다"가 아니라 "준비됐다"다. 실제
      // 실행만 RUNNING으로 간다.
      const status = input.mode === 'DRY_RUN' ? 'READY' : 'RUNNING';
      const run = await this.runs.insertRun(c, {
        sopVersionId: input.versionId,
        situationId,
        snapshotId: input.snapshotId,
        mode: input.mode,
        status,
        startedBy: auth.userId,
        correlationId: meta.correlationId,
      });

      const created = await this.materializeTasks(c, auth, run, graph, meta);

      if (affectsSituation(input.mode)) {
        // SOP_READY에서만 올린다 — 이미 RUNNING이거나 그 뒤 상태면 손대지
        // 않는다(0033이 워커에 건 것과 같은 형태의 조건부 전이다).
        await this.situations.advanceStatus(c, auth.tenantId, situationId, 'SOP_READY', 'RUNNING');
      }

      await this.recordEvent(c, auth, meta, run, 'RUN_CREATED', {
        mode: input.mode,
        sopVersionId: input.versionId,
        snapshotId: input.snapshotId,
        taskCount: created.taskCount,
        activeNodeKeys: created.activeNodeKeys,
        ...(input.scenario ? { scenario: input.scenario } : {}),
      });
      if (status === 'RUNNING') {
        await this.recordEvent(c, auth, meta, run, 'RUN_STARTED', {
          activeNodeKeys: created.activeNodeKeys,
        });
      }
      await this.writeAudit(c, auth, meta, 'SOP_RUN_STARTED', run.runId, {
        sopId,
        mode: input.mode,
        status,
        taskCount: created.taskCount,
      });
      return toRunResource(run);
    });
  }

  /** UNE-SOP-012 */
  async getRun(auth: AuthContext, runId: string): Promise<SopRunDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const run = await this.runs.findRun(c, runId);
      if (!run) throw sopRunErrors.runNotFound();
      const tasks = await this.runs.listTasks(c, runId);
      const graph = await this.runs.findVersionGraph(
        c,
        auth.tenantId,
        // 버전에서 sopId를 되짚지 않고 그래프 조회에 필요한 것만 다시 읽는다.
        await this.sopIdOfVersion(c, run.sopVersionId),
        run.sopVersionId,
      );
      const activeNodeKeys = graph
        ? computeActiveTaskNodes(toGraphDraft(graph), completedNodeKeys(tasks))
        : [];
      return {
        run: toRunResource(run),
        tasks: tasks.map((t) => toTaskResource(t, run.situationId)),
        // 활성 목록은 저장된 값이 아니라 **계산 결과**다.
        activeNodeKeys,
      };
    });
  }

  /** UNE-SOP-014 / 015 */
  async control(
    auth: AuthContext,
    runId: string,
    action: 'pause' | 'resume',
    reason: string | null,
    meta: RequestMeta,
  ): Promise<SopRunResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const run = await this.runs.findRun(c, runId, { forUpdate: true });
      if (!run) throw sopRunErrors.runNotFound();
      const next = action === 'pause' ? 'PAUSED' : 'RUNNING';
      if (!canTransitionRun(run.status, next)) {
        throw action === 'pause'
          ? sopRunErrors.cannotPause(run.status)
          : sopRunErrors.cannotResume(run.status);
      }
      const updated = await this.runs.updateRunStatus(c, runId, next);
      if (!updated) throw sopRunErrors.runNotFound();

      await this.recordEvent(
        c,
        auth,
        meta,
        run,
        action === 'pause' ? 'RUN_PAUSED' : 'RUN_RESUMED',
        { reason, previousStatus: run.status },
      );
      await this.writeAudit(
        c,
        auth,
        meta,
        action === 'pause' ? 'SOP_RUN_PAUSED' : 'SOP_RUN_RESUMED',
        runId,
        { reason, previousStatus: run.status },
      );
      return toRunResource(updated);
    });
  }

  /**
   * UNE-SOP-016 — 강제종료.
   *
   * 되돌릴 수 없다. 살아 있는 임무를 함께 접고, 무엇을 접었는지 사실원장에
   * 남긴다 — 나중에 "그 임무는 왜 안 했는가"에 답할 수 있어야 한다.
   */
  async terminate(
    auth: AuthContext,
    runId: string,
    input: { reason: string | null; confirmCode: string },
    meta: RequestMeta,
  ): Promise<SopRunResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const run = await this.runs.findRun(c, runId, { forUpdate: true });
      if (!run) throw sopRunErrors.runNotFound();
      if (input.confirmCode !== terminateConfirmCode(runId)) {
        throw sopRunErrors.confirmCodeMismatch();
      }
      if (!canTransitionRun(run.status, 'TERMINATED')) {
        throw sopRunErrors.cannotTerminate(run.status);
      }

      // 임무를 먼저 접는다 — 실행이 TERMINATED가 되면 0036의 트리거가 임무
      // 수정을 막는다(그것이 의도다).
      const cancelled = await this.runs.cancelOpenTasks(c, runId);
      for (const taskId of cancelled) {
        const payload = {
          reason: reason(input.reason),
          runTerminated: true,
          status: 'CANCELLED',
        };
        await this.runs.insertTaskEvent(c, {
          taskId,
          eventType: 'CANCELLED',
          actorId: auth.userId,
          payload,
          correlationId: meta.correlationId,
        });
        // **임무별로도 사실원장에 남긴다.** 실행 단위 요약(`taskCount`)만으로는
        // 어느 임무가 접혔는지 알 수 없어 시점 재생이 그 임무를 영원히
        // 직전 상태로 본다(CC-290).
        await this.runs.insertExecutionEvent(c, {
          tenantId: auth.tenantId,
          situationId: run.situationId,
          aggregateType: 'TASK',
          aggregateId: taskId,
          eventType: 'TASK_CANCELLED',
          actorId: auth.userId,
          payload,
          correlationId: meta.correlationId,
        });
      }

      const updated = await this.runs.updateRunStatus(c, runId, 'TERMINATED', { ended: true });
      if (!updated) throw sopRunErrors.runNotFound();

      if (cancelled.length > 0) {
        await this.recordEvent(c, auth, meta, run, 'TASK_CANCELLED', {
          taskCount: cancelled.length,
          reason: reason(input.reason),
        });
      }
      await this.recordEvent(c, auth, meta, run, 'RUN_TERMINATED', {
        reason: reason(input.reason),
        previousStatus: run.status,
        cancelledTaskCount: cancelled.length,
      });
      await this.writeAudit(c, auth, meta, 'SOP_RUN_TERMINATED', runId, {
        reason: reason(input.reason),
        previousStatus: run.status,
        cancelledTaskCount: cancelled.length,
      });
      return toRunResource(updated);
    });
  }

  /** UNE-SOP-013 SSE 페이지. */
  async listEventsSince(
    auth: AuthContext,
    runId: string,
    afterMs: number,
  ): Promise<Array<{ eventId: string; eventType: string; payload: unknown; occurredAt: Date }>> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const run = await this.runs.findRun(c, runId);
      if (!run) throw sopRunErrors.runNotFound();
      return this.runs.listRunEventsSince(c, runId, afterMs);
    });
  }

  async runExists(auth: AuthContext, runId: string): Promise<boolean> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const run = await this.runs.findRun(c, runId);
      return run !== null;
    });
  }

  // ── 내부 ───────────────────────────────────────────────────────────────

  private async materializeTasks(
    c: PoolClient,
    auth: AuthContext,
    run: SopRunRow,
    graph: NonNullable<Awaited<ReturnType<SopRunRepository['findVersionGraph']>>>,
    meta: RequestMeta,
  ): Promise<{ taskCount: number; activeNodeKeys: string[] }> {
    const draft = toGraphDraft(graph);
    const active = new Set(computeActiveTaskNodes(draft));
    let taskCount = 0;

    for (const node of graph.nodes) {
      const asDraft = draft.nodes.find((n) => n.nodeKey === node.nodeKey);
      if (!asDraft || !isTaskNode(asDraft)) continue;
      const material = nodeTaskInput(node.config);
      const taskId = await this.runs.insertTask(c, {
        runId: run.runId,
        nodeId: node.nodeId,
        title: node.title,
        assigneeHint: material.assigneeHint,
        instructions: material.instructions,
        activated: active.has(node.nodeKey),
      });
      taskCount += 1;
      const payload = {
        nodeKey: node.nodeKey,
        activated: active.has(node.nodeKey),
        title: node.title,
        status: 'CREATED',
      };
      await this.runs.insertTaskEvent(c, {
        taskId,
        eventType: 'CREATED',
        actorId: auth.userId,
        payload,
        correlationId: meta.correlationId,
      });
      // **임무별로도 사실원장에 남긴다.** 실행 단위 요약(`taskCount`)만으로는
      // 어느 임무가 언제 생겼는지 알 수 없어 시점 재생이 불가능하다 —
      // CC-290이 대시보드를 이벤트에서 계산하기 때문에 이것이 있어야 한다.
      await this.runs.insertExecutionEvent(c, {
        tenantId: auth.tenantId,
        situationId: run.situationId,
        aggregateType: 'TASK',
        aggregateId: taskId,
        eventType: 'TASK_CREATED',
        actorId: auth.userId,
        payload: { ...payload, runId: run.runId },
        correlationId: meta.correlationId,
      });
    }

    // 실행 단위 요약. 임무별 이벤트는 위에서 하나씩 남겼다 — **요약만으로는
    // 시점 재생이 불가능하다**(CC-290이 대시보드를 이벤트에서 계산한다).
    await this.recordEvent(c, auth, meta, run, 'TASK_CREATED', {
      taskCount,
      activeNodeKeys: [...active],
    });
    if (active.size > 0) {
      await this.recordEvent(c, auth, meta, run, 'TASK_ACTIVATED', {
        nodeKeys: [...active],
      });
    }
    return { taskCount, activeNodeKeys: [...active] };
  }

  private async sopIdOfVersion(c: PoolClient, versionId: string): Promise<string> {
    const r = await c.query(`SELECT sop_id FROM sop_version WHERE sop_version_id = $1`, [
      versionId,
    ]);
    return (r.rows[0]?.sop_id as string) ?? versionId;
  }

  private async recordEvent(
    c: PoolClient,
    auth: AuthContext,
    meta: RequestMeta,
    run: SopRunRow,
    eventType: RunEventType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.runs.insertExecutionEvent(c, {
      tenantId: auth.tenantId,
      situationId: run.situationId,
      aggregateType: 'SOP_RUN',
      aggregateId: run.runId,
      eventType,
      actorId: auth.userId,
      payload: { ...payload, mode: run.mode },
      correlationId: meta.correlationId,
    });
  }

  private async writeAudit(
    c: PoolClient,
    auth: AuthContext,
    meta: RequestMeta,
    action: string,
    runId: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.insertAudit(c, {
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action,
      resourceType: 'SOP_RUN',
      resourceId: runId,
      correlationId: meta.correlationId,
      ...(meta.ip ? { ip: meta.ip } : {}),
      ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
      detail,
    });
  }
}

function reason(value: string | null): string | null {
  return value;
}

/** 저장 형태를 도메인 계산이 쓰는 모양으로 옮긴다. */
function toGraphDraft(graph: {
  nodes: Array<{ nodeKey: string; nodeType: string; title: string; config: unknown }>;
  edges: Array<{ fromNodeKey: string; toNodeKey: string }>;
}): { nodes: SopNodeDraft[]; edges: SopEdgeDraft[] } {
  return {
    nodes: graph.nodes.map((n, index) => {
      const config = (n.config ?? {}) as {
        tasks?: SopNodeDraft['tasks'];
        decisionExpression?: string | null;
        sourceRefs?: string[];
        providerNodeKey?: string;
      };
      return {
        nodeKey: n.nodeKey,
        providerNodeKey: config.providerNodeKey ?? n.nodeKey,
        type: n.nodeType as SopNodeDraft['type'],
        title: n.title,
        sequence: index + 1,
        tasks: config.tasks ?? [],
        decisionExpression: config.decisionExpression ?? null,
        sourceRefs: config.sourceRefs ?? [],
      };
    }),
    edges: graph.edges.map((e) => ({
      fromNodeKey: e.fromNodeKey,
      toNodeKey: e.toNodeKey,
      conditionExpr: null,
      label: null,
      priority: 0,
    })),
  };
}

/**
 * 완료된 노드.
 *
 * CC-260에는 완료 보고가 없으므로 지금은 항상 빈 집합이다 — 그래서 활성
 * 프런티어는 시작 직후의 첫 임무들에 머문다. CC-280이 완료를 만들면 이 함수가
 * 그것을 읽고 프런티어가 전진한다.
 */
function completedNodeKeys(tasks: readonly TaskRow[]): Set<string> {
  return new Set(tasks.filter((t) => t.status === 'COMPLETED').map((t) => t.nodeKey));
}
