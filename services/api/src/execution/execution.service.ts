import { Inject, Injectable } from '@nestjs/common';
import {
  applyCorrections,
  buildCorrectionPayload,
  computeKpi,
  DASHBOARD_STALE_AFTER_MS,
  EXECUTION_CORRECTION_EVENT_TYPE,
  executionEventHash,
  findDivergences,
  foldTaskStates,
  isDashboardStale,
  validateCorrection,
  type DashboardKpi,
} from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import type { RequestMeta } from '../plan/plan.service';
import { executionErrors } from './execution-errors';
import { ExecutionRepository, type ExecutionEventRow } from './execution.repository';

/**
 * Execution Log와 전자상황판 (CC-290, UNE-JNL-001~004).
 *
 * **대시보드는 이벤트에서 계산된다.** 임무 행을 세지 않는다 — CC-280이 임무에
 * 수행 시각 컬럼을 두지 않은 것과 같은 결정이고, 그래야 `at`(시점) 질문에
 * 답할 수 있다. 임무 행에서 오는 것은 이벤트가 모르는 것 하나뿐이다: **기한**.
 */

export interface ExecutionEventResource {
  eventId: string;
  situationId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: string;
  recordedAt: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  correctsEventId: string | null;
  correlationId: string;
  eventHash: string;
}

export interface ExecutionEventDetailResource {
  event: ExecutionEventResource;
  /** 이 이벤트를 정정한 것들. 최신이 유효본이다. */
  corrections: ExecutionEventResource[];
  /** 유효 payload — 정정이 있으면 가장 나중 정정의 것. */
  effectivePayload: Record<string, unknown>;
  /** 정정 대상인 원본(이 이벤트 자체가 정정일 때). */
  correctsEvent: ExecutionEventResource | null;
  correctable: boolean;
}

export interface ExecutionEventPageResource {
  items: Array<ExecutionEventResource & { correctedBy: string | null }>;
  page: number;
  size: number;
  total: number;
}

export interface DashboardTaskResource {
  taskId: string;
  runId: string;
  nodeKey: string;
  title: string;
  assigneeUserId: string | null;
  assigneeOrgId: string | null;
  dueAt: string | null;
  /** **이벤트에서 복원한** 그 시점의 진행률. 없으면 아직 보고되지 않았다. */
  progressPct: number | null;
  /** **이벤트에서 복원한** 그 시점의 상태. */
  status: string;
  /** 그 상태를 만든 이벤트 — KPI에서 사실원장으로 내려가는 길. */
  statusEventId: string;
  overdue: boolean;
}

export interface DashboardResource {
  situationId: string;
  title: string;
  mode: string;
  status: string;
  /** 이 판이 말하는 시점. `at`을 주지 않으면 지금이다. */
  at: string;
  /** 마지막 이벤트 시각. 화면이 "살아 있는가"를 판단한다. */
  lastEventAt: string | null;
  stale: boolean;
  staleAfterMs: number;
  kpi: DashboardKpi;
  tasks: DashboardTaskResource[];
  runs: Array<{ runId: string; mode: string; status: string; startedAt: string }>;
  snapshot: {
    snapshotId: string;
    versionNo: number;
    effectiveAt: string;
    factCount: number;
  } | null;
  /** 최근 이벤트 몇 개 — 타임라인 미리보기. 전체는 UNE-JNL-002다. */
  recentEvents: Array<ExecutionEventResource & { correctedBy: string | null }>;
  /**
   * 이 집계가 무엇을 근거로 했는가.
   *
   * 숫자만 주면 화면이 그것을 완전한 사실로 읽는다. 기한처럼 이벤트가 모르는
   * 값이 섞여 있다는 것을 응답이 스스로 밝힌다(ADR-43 수용 한계 2).
   */
  provenance: {
    eventCount: number;
    /** 읽은 이벤트가 상한에 걸려 잘렸는가. 잘렸으면 이 판은 불완전하다. */
    truncated: boolean;
    /** `at`을 무엇으로 해석했는가. */
    timeAxis: 'occurredAt';
    /** 기한·제목·담당자는 이벤트가 아니라 임무 행의 **현재** 값이다. */
    taskRowFields: string[];
    /** 이벤트가 아직 말하지 않은 임무 수. 0이 아니면 이벤트가 빠졌을 수 있다. */
    tasksWithoutEvents: number;
    /**
     * 재생 결과와 임무 행이 어긋난 임무.
     *
     * **D1의 전제를 매 조회가 측정한다.** 비어 있지 않으면 어딘가에서 상태가
     * 사실원장 밖으로 움직였다는 뜻이고, 그것이 이 항목이 D3에서 세 번 찾은
     * 결함의 형태다. 과거 시점 조회에서는 당연히 다르므로 재지 않는다.
     */
    divergences: Array<{ taskId: string; replayed: string | null; stored: string }>;
  };
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toResource(row: ExecutionEventRow): ExecutionEventResource {
  return {
    eventId: row.eventId,
    situationId: row.situationId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    occurredAt: iso(row.occurredAt) as string,
    recordedAt: iso(row.recordedAt) as string,
    actorId: row.actorId,
    payload: row.payload,
    correctsEventId: row.correctsEventId,
    correlationId: row.correlationId,
    eventHash: row.eventHash,
  };
}

const RECENT_EVENT_COUNT = 20;

@Injectable()
export class ExecutionService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ExecutionRepository) private readonly repo: ExecutionRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** UNE-JNL-001 — 전자상황판 집계. */
  async getDashboard(
    auth: AuthContext,
    situationId: string,
    query: { at: Date | null; runId: string | null },
  ): Promise<DashboardResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.repo.findSituation(c, auth.tenantId, situationId);
      if (!situation) throw executionErrors.situationNotFound();

      const at = query.at ?? new Date();
      // 같은 커넥션이라 `Promise.all`이 실제 병렬이 아니다(node-postgres가 줄을
      // 세운다). 읽기 트랜잭션을 짧게 두려고 순서대로 부른다.
      const tasks = await this.repo.listSituationTasks(c, auth.tenantId, situationId, query.runId);
      const { rows: events, truncated } = await this.repo.listEventsUpTo(
        c,
        auth.tenantId,
        situationId,
        at,
      );
      const runs = await this.repo.listRuns(c, situationId);
      const snapshot = await this.repo.findLatestSnapshot(c, situationId);

      // **실행 스코프를 payload 필드가 아니라 DB에서 유도한다.** `payload.runId`에
      // 기대면 그 필드를 빠뜨린 이벤트가 조용히 탈락하고(실제로 `TASK_CANCELLED`가
      // 그랬다) 그 임무가 영원히 직전 상태로 보인다.
      const runTaskIds = new Set(tasks.map((t) => t.taskId));
      const scoped = query.runId
        ? events.filter((e) => inRun(e, query.runId as string, runTaskIds))
        : events;

      // **집계는 정정본으로 접는다**(D8). `applyCorrections`가 원본의 시각을
      // 유지한 채 payload만 갈아끼우므로, 정정이 새 관측처럼 상태를 되돌리지
      // 않으면서 값은 최신이 된다.
      const corrected = applyCorrections(scoped);
      const states = foldTaskStates(corrected, at);
      const kpi = computeKpi(tasks, states, at);

      // **표시는 원본이다**(D8의 다른 반쪽). 정정본 payload를 원본 id·해시와 함께
      // 내보내면 해시 검증이 깨진다 — 표시용은 원본 + 표시만 단 목록을 쓴다.
      const timeline = markCorrected(scoped);
      const lastEventAt = scoped.length > 0 ? scoped[scoped.length - 1].occurredAt : null;
      // 지금 판일 때만 잰다. 과거 판은 당연히 임무 행과 다르다.
      const divergences = query.at ? [] : findDivergences(tasks, states);

      return {
        situationId,
        title: situation.title,
        mode: situation.mode,
        status: situation.status,
        at: at.toISOString(),
        lastEventAt: iso(lastEventAt),
        stale: isDashboardStale(lastEventAt, new Date()),
        staleAfterMs: DASHBOARD_STALE_AFTER_MS,
        kpi,
        tasks: tasks.flatMap((task): DashboardTaskResource[] => {
          const projected = states.get(task.taskId);
          // 그 시점에 아직 없던 임무는 판에 올리지 않는다.
          if (!projected) return [];
          const settled = projected.status === 'COMPLETED' || projected.status === 'CANCELLED';
          return [
            {
              taskId: task.taskId,
              runId: task.runId,
              nodeKey: task.nodeKey,
              title: task.title,
              assigneeUserId: task.assigneeUserId,
              assigneeOrgId: task.assigneeOrgId,
              dueAt: iso(task.dueAt),
              // 진행률도 재생에서 온다 — 임무 행의 현재 값을 쓰면 과거 판이
              // 오늘의 진행률을 보여 준다.
              progressPct: projected.progressPct,
              status: projected.status,
              statusEventId: projected.statusEventId,
              overdue: !settled && task.dueAt !== null && task.dueAt.getTime() < at.getTime(),
            },
          ];
        }),
        runs: runs.map((r) => ({
          runId: r.runId,
          mode: r.mode,
          status: r.status,
          startedAt: iso(r.startedAt) as string,
        })),
        snapshot: snapshot
          ? {
              snapshotId: snapshot.snapshotId,
              versionNo: snapshot.versionNo,
              effectiveAt: iso(snapshot.effectiveAt) as string,
              factCount: snapshot.factCount,
            }
          : null,
        recentEvents: timeline
          .slice(-RECENT_EVENT_COUNT)
          .reverse()
          .map((e) => ({ ...toResource(e.row), correctedBy: e.correctedBy })),
        provenance: {
          eventCount: scoped.length,
          truncated,
          timeAxis: 'occurredAt',
          // 이벤트가 모르는 값. 화면이 이것을 판 위에 적는다.
          taskRowFields: ['dueAt', 'title', 'assigneeUserId', 'assigneeOrgId'],
          tasksWithoutEvents: tasks.filter((t) => !states.has(t.taskId)).length,
          divergences,
        },
      };
    });
  }

  /** UNE-JNL-002 — Execution Log 조회. */
  async listEvents(
    auth: AuthContext,
    situationId: string,
    filter: {
      from: Date | null;
      to: Date | null;
      eventType: string | null;
      actorId: string | null;
      aggregateType: string | null;
      page: number;
      size: number;
    },
  ): Promise<ExecutionEventPageResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.repo.findSituation(c, auth.tenantId, situationId);
      if (!situation) throw executionErrors.situationNotFound();

      const { rows, total } = await this.repo.listEvents(c, auth.tenantId, situationId, {
        from: filter.from,
        to: filter.to,
        eventType: filter.eventType,
        actorId: filter.actorId,
        aggregateType: filter.aggregateType,
        limit: filter.size,
        offset: (filter.page - 1) * filter.size,
      });

      // **타임라인은 원본을 감추지 않는다**(설계 09 REG-05). 정정 이벤트도 한
      // 줄로 보이고, 정정된 원본에는 표시만 단다. 한 쪽 안에서 정정을 찾지
      // 못하면 `correctedBy`가 null로 남는데, 그것은 "정정 없음"이 아니라
      // "이 쪽에 없음"이므로 상세(UNE-JNL-003)가 정본이다.
      const marked = markCorrected(rows);

      return {
        items: marked.map((e) => ({ ...toResource(e.row), correctedBy: e.correctedBy })),
        page: filter.page,
        size: filter.size,
        total,
      };
    });
  }

  /** UNE-JNL-003 — 원본 Event 상세와 정정 lineage. */
  async getEvent(auth: AuthContext, eventId: string): Promise<ExecutionEventDetailResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const event = await this.repo.findEvent(c, auth.tenantId, eventId);
      if (!event) throw executionErrors.eventNotFound();

      const corrections = await this.repo.listCorrectionsOf(c, auth.tenantId, eventId);
      const correctsEvent = event.correctsEventId
        ? await this.repo.findEvent(c, auth.tenantId, event.correctsEventId)
        : null;

      const latest = corrections[corrections.length - 1];
      const violations = validateCorrection({
        targetEventType: event.eventType,
        targetIsCorrection: event.correctsEventId !== null,
        reason: 'probe',
        replacementFields: { probe: true },
      });

      return {
        event: toResource(event),
        corrections: corrections.map(toResource),
        effectivePayload: latest ? latest.payload : event.payload,
        correctsEvent: correctsEvent ? toResource(correctsEvent) : null,
        // 화면이 "정정" 버튼을 보일지 판단한다. 서버가 다시 검사하므로 이것은
        // 편의이지 통제가 아니다.
        correctable: violations.length === 0,
      };
    });
  }

  /**
   * UNE-JNL-004 — 정정 이벤트 추가.
   *
   * 원본을 고치지 않는다. **새 이벤트**가 원본을 가리키고, 유효값은 그 정정이
   * 들고 있다. 원본 해시를 다시 계산해 대조한 뒤에만 얹는다 — 원본이 바뀌어
   * 있으면 그 위에 정정을 쌓으면 안 된다.
   */
  async correct(
    auth: AuthContext,
    eventId: string,
    input: { reason: string; replacementFields: Record<string, unknown> },
    meta: RequestMeta,
  ): Promise<ExecutionEventResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      // **같은 원본을 정정하는 요청끼리 줄을 세운다.** 그것이 없으면 동시 정정
      // 두 건이 각자 원본을 기준으로 병합해 먼저 기록된 값이 사라진다(실측).
      // 행 잠금은 쓸 수 없다 — append-only라 UPDATE 권한이 없고, 잠글 수 없는
      // 것이 이 테이블의 보장이다(저장소 주석 참조).
      await this.repo.lockForCorrection(c, eventId);
      const target = await this.repo.findEvent(c, auth.tenantId, eventId);
      if (!target) throw executionErrors.eventNotFound();

      const violations = validateCorrection({
        targetEventType: target.eventType,
        targetIsCorrection: target.correctsEventId !== null,
        reason: input.reason,
        replacementFields: input.replacementFields,
      });
      if (violations.length > 0) throw executionErrors.correctionRejected(violations);

      // 무결성 대조. append-only라 어긋날 수 없고, 어긋났다면 그 사실이 정정
      // 보다 훨씬 급하다.
      const recomputed = executionEventHash({
        situationId: target.situationId,
        aggregateType: target.aggregateType,
        aggregateId: target.aggregateId,
        eventType: target.eventType,
        payload: target.payload,
      });
      if (recomputed !== target.eventHash) throw executionErrors.originalTampered();

      const previous = await this.repo.listCorrectionsOf(c, auth.tenantId, eventId);
      const effectivePayload =
        previous.length > 0 ? previous[previous.length - 1].payload : target.payload;

      const payload = buildCorrectionPayload({
        effectivePayload,
        replacementFields: input.replacementFields,
        reason: input.reason,
        correctedEventId: target.eventId,
        correctedEventType: target.eventType,
        correctedEventHash: target.eventHash,
      });

      const created = await this.repo.insertCorrection(c, {
        tenantId: auth.tenantId,
        situationId: target.situationId,
        aggregateType: target.aggregateType,
        aggregateId: target.aggregateId,
        actorId: auth.userId,
        payload,
        correctsEventId: target.eventId,
        correlationId: meta.correlationId,
        eventType: EXECUTION_CORRECTION_EVENT_TYPE,
        eventHash: executionEventHash({
          situationId: target.situationId,
          aggregateType: target.aggregateType,
          aggregateId: target.aggregateId,
          eventType: EXECUTION_CORRECTION_EVENT_TYPE,
          payload,
        }),
      });

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'EXECUTION_EVENT_CORRECTED',
        resourceType: 'EXECUTION_EVENT',
        resourceId: target.eventId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        // 감사에는 **무엇을 어떻게 바꿨는지**가 남아야 한다.
        before: { payload: effectivePayload },
        detail: {
          correctionEventId: created.eventId,
          replacementFields: input.replacementFields,
          reason: input.reason,
        },
      });

      return toResource(created);
    });
  }
}

/**
 * 이 이벤트가 그 실행에 속하는가.
 *
 * **임무는 DB에서 유도한 집합으로 판정한다.** payload의 `runId`에 기대면 그
 * 필드를 빠뜨린 이벤트가 조용히 탈락한다 — 실제로 `TASK_CANCELLED`와
 * `TASK_ATTACHMENT_ADDED`가 그랬고, 앞의 것은 접힌 임무를 영원히 직전 상태로
 * 보이게 했다. 나머지 애그리거트만 payload를 본다.
 */
function inRun(event: ExecutionEventRow, runId: string, runTaskIds: ReadonlySet<string>): boolean {
  if (event.aggregateType === 'SOP_RUN') return event.aggregateId === runId;
  if (event.aggregateType === 'TASK') return runTaskIds.has(event.aggregateId);
  return event.payload.runId === runId;
}

function markCorrected(
  rows: readonly ExecutionEventRow[],
): Array<{ row: ExecutionEventRow; correctedBy: string | null }> {
  const corrections = new Map<string, string>();
  for (const row of rows) {
    if (row.correctsEventId) corrections.set(row.correctsEventId, row.eventId);
  }
  return rows.map((row) => ({ row, correctedBy: corrections.get(row.eventId) ?? null }));
}
