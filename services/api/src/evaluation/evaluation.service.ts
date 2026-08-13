import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  applyCorrections,
  canCloseSituation,
  canClose,
  checkDispositions,
  closureBaselineHash,
  collectCloseBlockers,
  computeKpi,
  deriveMetrics,
  executionEventHash,
  foldTaskStates,
  isEvaluationEditable,
  isMetricStale,
  overallScore,
  satisfactionSection,
  scoresWithoutEvidence,
  targetNeedsId,
  validateScores,
  SITUATION_CLOSABLE_STATUSES,
  type CloseBlocker,
  type MetricBasis,
  type ScoreInput,
} from '@une/domain';
import { AuditRepository } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import type { RequestMeta } from '../plan/plan.service';
import { evaluationErrors } from './evaluation-errors';
import { EvaluationRepository, type EvaluationRow } from './evaluation.repository';

/**
 * 훈련 종료와 평가 (CC-310, UNE-JNL-012~015).
 *
 * 세 가지를 지킨다.
 *
 *   1. **닫기 전에 미결을 전부 드러내고, 처분에 사유를 요구한다.** 인수기준이
 *      "종료시 미결항목·사유 누락 0"이다.
 *   2. **지표는 CC-290의 산출기에서 오고, 낸 시점에 고정된다.** 그리고 낡으면
 *      낡았다고 말한다 — 조용히 다시 계산하지 않는다.
 *   3. **평가 결론에는 근거가 붙고, 그 근거가 이 훈련의 것인지 확인한다.**
 *      존재하지 않거나 남의 이벤트를 근거로 단 평가서는 근거가 없는 것보다 나쁘다.
 */

export interface CloseBlockerResource {
  kind: string;
  refId: string;
  label: string;
  detail: string;
}

export interface ClosurePreviewResource {
  situationId: string;
  status: string;
  blockers: CloseBlockerResource[];
  closable: boolean;
}

export interface SituationClosedResource {
  situationId: string;
  status: string;
  closedAt: string;
  closureEventId: string;
  baselineHash: string;
  waivedCount: number;
}

export interface EvaluationScoreResource {
  scoreId: string;
  criterionCode: string;
  scoreValue: number;
  weightValue: number;
  comment: string | null;
  evidenceEventIds: string[];
}

export interface ImprovementResource {
  actionId: string;
  actionText: string;
  ownerUserId: string | null;
  dueAt: string | null;
  status: string;
  targetType: string | null;
  targetId: string | null;
}

export interface EvaluationResource {
  evaluationId: string;
  situationId: string;
  status: string;
  evaluationType: string;
  overallScore: number | null;
  summary: string | null;
  metrics: Record<string, unknown>;
  /** 고정한 값이 지금 사실과 어긋나는가. 자동으로 다시 계산하지 않는다. */
  metricsStale: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdBy: string;
  createdAt: string;
  scores: EvaluationScoreResource[];
  improvements: ImprovementResource[];
}

export interface EvaluationReportResource {
  evaluation: EvaluationResource;
  satisfaction: ReturnType<typeof satisfactionSection>;
  /** 근거 없이 매긴 지표. 막지 않되 보고서가 말한다. */
  criteriaWithoutEvidence: string[];
  improvementsByTarget: Array<{ targetType: string; count: number }>;
  generatedAt: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

@Injectable()
export class EvaluationService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(EvaluationRepository) private readonly repo: EvaluationRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** 미결 미리보기 — 화면(SCR-EVAL-001)이 처분 UI를 그릴 근거다. */
  async closePreview(auth: AuthContext, situationId: string): Promise<ClosurePreviewResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.repo.findSituation(c, auth.tenantId, situationId);
      if (!situation) throw evaluationErrors.situationNotFound();
      const blockers = await this.gatherBlockers(c, auth, situationId);
      return {
        situationId,
        status: situation.status,
        blockers,
        closable: blockers.length === 0,
      };
    });
  }

  /**
   * UNE-JNL-012 — 종료.
   *
   * 미결이 있으면 **목록과 함께** 412로 막고, 처분이 붙으면 사유와 함께
   * 종료 사건에 싣는다. 처분 어휘는 `WAIVED` 하나다 — 완료·취소·이관은 각자의
   * 상태기계가 하는 일이고, 여기서 흉내 내면 상태가 자기 경로 밖에서 바뀐다.
   */
  async close(
    auth: AuthContext,
    situationId: string,
    input: {
      resultSummary: string | null;
      dispositions: Array<{ refId: string; disposition: string; reason: string }>;
    },
    meta: RequestMeta,
  ): Promise<SituationClosedResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      // **행을 먼저 잠근다.** 미결을 세는 것과 상태를 옮기는 것 사이에 다른
      // 트랜잭션이 임무를 만들면 처분되지 않은 미결을 안고 닫힌다.
      const situation = await this.repo.findSituation(c, auth.tenantId, situationId, {
        forUpdate: true,
      });
      if (!situation) throw evaluationErrors.situationNotFound();
      // 시작하지도 않은 훈련을 닫으면 빈 기준선이 영구 동결된다 — 되돌릴 수 없다.
      if (!canCloseSituation(situation.status)) {
        throw evaluationErrors.cannotClose(situation.status);
      }

      const blockers = await this.gatherBlockers(c, auth, situationId);
      const check = checkDispositions(blockers, input.dispositions);
      if (!canClose(check)) {
        throw evaluationErrors.closeBlocked(blockers, [
          ...check.undisposed.map((b) => ({
            field: b.refId,
            reason: `${b.detail} 처분과 사유가 필요합니다.`,
          })),
          ...check.unwaivable.map((b) => ({
            field: b.refId,
            reason: `${b.detail} 사유로 넘길 수 없습니다 — 먼저 정리하십시오.`,
          })),
          ...check.reasonMissing.map((refId) => ({ field: refId, reason: '사유를 적으십시오.' })),
          ...check.unknown.map((refId) => ({
            field: refId,
            reason: '지금 미결 목록에 없습니다. 목록을 다시 읽으십시오.',
          })),
          ...check.invalid.map((refId) => ({
            field: refId,
            reason: '이 경로의 처분은 WAIVED뿐입니다. 완료·취소는 해당 엔드포인트로 하십시오.',
          })),
        ]);
      }

      // 기준선을 굳힌다 — "무엇을 최종으로 삼고 닫았는가".
      const [stream, journals, snapshot, runs] = await Promise.all([
        this.repo.listEvents(c, auth.tenantId, situationId),
        this.repo.listJournals(c, auth.tenantId, situationId),
        this.repo.findLatestSnapshot(c, auth.tenantId, situationId),
        this.repo.listRuns(c, auth.tenantId, situationId),
      ]);
      const events = stream.events;
      const baselineHash = closureBaselineHash({
        snapshotId: snapshot?.snapshotId ?? null,
        snapshotVersionNo: snapshot?.versionNo ?? null,
        eventCount: events.length,
        lastEventId: events.length > 0 ? events[events.length - 1].eventId : null,
        journals,
        runs,
      });

      const payload = {
        resultSummary: input.resultSummary,
        baselineHash,
        snapshotId: snapshot?.snapshotId ?? null,
        eventCount: events.length,
        // 무엇을 그대로 두고 닫았는지가 여기 남는다. 사유 없이는 여기까지 오지 못한다.
        // 같은 항목을 두 번 처분해도 한 번으로 센다 — 응답의 수와 여기 적힌
        // 수가 다르면 "몇 건을 그대로 두고 닫았는가"에 답이 둘이 된다.
        waived: [...new Map(input.dispositions.map((d) => [d.refId, d])).values()].map((d) => ({
          refId: d.refId,
          kind: blockers.find((b) => b.refId === d.refId)?.kind ?? 'UNKNOWN',
          reason: d.reason.trim(),
        })),
      };

      // **이벤트를 먼저 쓴다.** 0045 §5의 트리거가 CLOSED 상황의 새 사실을
      // 막으므로 순서가 뒤집히면 자기 종료 사건이 자기 트리거에 걸린다
      // (`SITUATION_CLOSED`는 예외로 열려 있지만, 순서를 명시적으로 둔다).
      const closureEvent = await this.repo.insertExecutionEvent(c, {
        tenantId: auth.tenantId,
        situationId,
        aggregateType: 'SITUATION',
        aggregateId: situationId,
        eventType: 'SITUATION_CLOSED',
        actorId: auth.userId,
        payload,
        correlationId: meta.correlationId,
        eventHash: executionEventHash({
          situationId,
          aggregateType: 'SITUATION',
          aggregateId: situationId,
          eventType: 'SITUATION_CLOSED',
          payload,
        }),
      });

      const moved = await this.repo.closeSituation(c, auth.tenantId, situationId, [
        ...SITUATION_CLOSABLE_STATUSES,
      ]);
      if (!moved) throw evaluationErrors.cannotClose(situation.status);

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'SITUATION_CLOSED',
        resourceType: 'SITUATION',
        resourceId: situationId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { baselineHash, waivedCount: payload.waived.length },
      });

      return {
        situationId,
        status: 'CLOSED',
        // 사실원장이 적은 시각을 그대로 쓴다 — 응답만의 시각을 지어내면
        // 사건과 응답이 다른 시각을 말한다.
        closedAt: closureEvent.occurredAt.toISOString(),
        closureEventId: closureEvent.eventId,
        baselineHash,
        waivedCount: payload.waived.length,
      };
    });
  }

  /**
   * UNE-JNL-013 — 평가 생성.
   *
   * 선행조건은 **종료된 훈련**이다(US-SIT-036). 기준선이 움직이는 채로 평가하면
   * 그 평가서가 무엇을 근거로 삼았는지 나중에 말할 수 없다.
   */
  async createEvaluation(
    auth: AuthContext,
    situationId: string,
    input: { summary: string | null; scores: ScoreInput[] },
    meta: RequestMeta,
  ): Promise<EvaluationResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const situation = await this.repo.findSituation(c, auth.tenantId, situationId);
      if (!situation) throw evaluationErrors.situationNotFound();
      if (situation.status !== 'CLOSED') {
        throw evaluationErrors.situationNotClosed(situation.status);
      }
      // 선행 조회만으로는 동시 요청 둘을 막지 못한다 — 유니크 위반(23505)이
      // 그대로 500이 되면 사용자는 "서버 오류"를 본다. 아래에서 함께 받는다.
      if (await this.repo.findEvaluationBySituation(c, auth.tenantId, situationId)) {
        throw evaluationErrors.alreadyEvaluated();
      }

      const violations = validateScores(input.scores).map((v) => ({
        field: `scores.${v.criterionCode}`,
        reason: v.reason,
      }));

      // **근거가 이 훈련의 것인지 본다.** 없는 이벤트나 남의 훈련 이벤트를
      // 근거로 단 평가서는 근거가 없는 것보다 나쁘다 — 있는 것처럼 보인다.
      const stream = await this.repo.listEvents(c, auth.tenantId, situationId);
      const known = new Set(stream.events.map((e) => e.eventId));
      for (const score of input.scores) {
        for (const eventId of score.evidenceEventIds) {
          if (!known.has(eventId)) {
            violations.push({
              field: `scores.${score.criterionCode}.evidenceEventIds`,
              reason: `${eventId}는 이 훈련의 사실원장에 없습니다.`,
            });
          }
        }
      }
      if (violations.length > 0) throw evaluationErrors.invalidEvaluation(violations);

      const dueDates = await this.repo.listTaskDueDates(c, auth.tenantId, situationId);
      const summary = await this.repo.summarizeEvents(c, auth.tenantId, situationId);
      const { metrics, basis } = this.computeMetrics(stream.events, dueDates, summary, {
        truncated: stream.truncated,
      });
      const evaluation = await this.insertEvaluationOrConflict(c, {
        tenantId: auth.tenantId,
        situationId,
        summary: input.summary,
        overallScore: overallScore(input.scores),
        metric: metrics as unknown as Record<string, unknown>,
        metricBasis: basis as unknown as Record<string, unknown>,
        createdBy: auth.userId,
      });
      if (!evaluation) throw evaluationErrors.situationNotFound();
      for (const score of input.scores) {
        await this.repo.insertScore(c, {
          tenantId: auth.tenantId,
          evaluationId: evaluation.evaluationId,
          criterionCode: score.criterionCode.trim(),
          scoreValue: score.scoreValue,
          weightValue: score.weightValue,
          comment: score.comment,
          evidenceEventIds: [...score.evidenceEventIds],
        });
      }

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'EVALUATION_CREATED',
        resourceType: 'EVALUATION',
        resourceId: evaluation.evaluationId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { situationId, criterionCount: input.scores.length },
      });

      return this.assemble(c, auth, evaluation);
    });
  }

  async getEvaluation(auth: AuthContext, evaluationId: string): Promise<EvaluationResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const evaluation = await this.repo.findEvaluation(c, auth.tenantId, evaluationId);
      if (!evaluation) throw evaluationErrors.notFound();
      return this.assemble(c, auth, evaluation);
    });
  }

  /** 확정. 이 뒤로는 점수·개선조치가 DB 층에서 얼어붙는다. */
  async confirmEvaluation(
    auth: AuthContext,
    evaluationId: string,
    meta: RequestMeta,
  ): Promise<EvaluationResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const evaluation = await this.repo.findEvaluation(c, auth.tenantId, evaluationId);
      if (!evaluation) throw evaluationErrors.notFound();
      if (!isEvaluationEditable(evaluation.status)) {
        throw evaluationErrors.notEditable(evaluation.status);
      }
      const moved = await this.repo.confirmEvaluation(c, auth.tenantId, evaluationId, auth.userId);
      if (!moved) throw evaluationErrors.notEditable(evaluation.status);

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'EVALUATION_CONFIRMED',
        resourceType: 'EVALUATION',
        resourceId: evaluationId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: {},
      });

      const confirmed = await this.repo.findEvaluation(c, auth.tenantId, evaluationId);
      return this.assemble(c, auth, confirmed as EvaluationRow);
    });
  }

  /**
   * UNE-JNL-014 — 개선조치.
   *
   * **대상을 바꾸지 않는다.** 개선조치는 SOP·계획서를 가리키기만 하고, 그
   * 문서에 어떤 쓰기도 하지 않는다(US-SIT-036 6단계 "자동변경 금지").
   * 다만 가리키는 대상이 실재하는지는 확인한다 — 허공을 가리키는 포인터는
   * "고치기로 했다"는 기록만 남기고 아무것도 지시하지 않는다.
   */
  async addImprovements(
    auth: AuthContext,
    evaluationId: string,
    input: {
      actions: Array<{
        actionText: string;
        ownerUserId: string | null;
        dueAt: Date | null;
        targetType: string | null;
        targetId: string | null;
      }>;
    },
    meta: RequestMeta,
  ): Promise<EvaluationResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const evaluation = await this.repo.findEvaluation(c, auth.tenantId, evaluationId);
      if (!evaluation) throw evaluationErrors.notFound();
      if (!isEvaluationEditable(evaluation.status)) {
        throw evaluationErrors.notEditable(evaluation.status);
      }

      const violations: Array<{ field: string; reason: string }> = [];
      for (const [index, action] of input.actions.entries()) {
        // 담당자도 대상과 같은 기준으로 본다 — 없는 사용자나 남의 기관 사용자를
        // 담당으로 적으면 FK가 500으로 떨어지고(422여야 한다), 통과하면 다른
        // 기관 사람에게 조치가 맡겨진 기록이 남는다.
        if (action.ownerUserId) {
          const owner = await this.repo.userExists(c, auth.tenantId, action.ownerUserId);
          if (!owner) {
            violations.push({
              field: `actions[${index}].ownerUserId`,
              reason: '이 기관의 활성 사용자가 아닙니다.',
            });
            continue;
          }
        }
        if (action.targetType && targetNeedsId(action.targetType)) {
          if (!action.targetId) {
            violations.push({
              field: `actions[${index}].targetId`,
              reason: `${action.targetType} 환류는 대상을 지정해야 합니다.`,
            });
            continue;
          }
          const exists = await this.repo.targetExists(
            c,
            auth.tenantId,
            action.targetType,
            action.targetId,
          );
          if (!exists) {
            violations.push({
              field: `actions[${index}].targetId`,
              reason: '환류 대상을 찾을 수 없습니다.',
            });
          }
        }
      }
      if (violations.length > 0) throw evaluationErrors.invalidImprovement(violations);

      for (const action of input.actions) {
        await this.repo.insertImprovement(c, {
          tenantId: auth.tenantId,
          evaluationId,
          actionText: action.actionText,
          ownerUserId: action.ownerUserId,
          dueAt: action.dueAt,
          targetType: action.targetType,
          targetId: action.targetId,
        });
      }

      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'IMPROVEMENT_ADDED',
        resourceType: 'EVALUATION',
        resourceId: evaluationId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { count: input.actions.length },
      });

      const after = await this.repo.findEvaluation(c, auth.tenantId, evaluationId);
      return this.assemble(c, auth, after as EvaluationRow);
    });
  }

  /** UNE-JNL-015 — 보고서. 빈 자리를 빈 값이 아니라 **말로** 채운다. */
  async report(auth: AuthContext, evaluationId: string): Promise<EvaluationReportResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const evaluation = await this.repo.findEvaluation(c, auth.tenantId, evaluationId);
      if (!evaluation) throw evaluationErrors.notFound();
      const resource = await this.assemble(c, auth, evaluation);

      const byTarget = new Map<string, number>();
      for (const action of resource.improvements) {
        const key = action.targetType ?? 'UNASSIGNED';
        byTarget.set(key, (byTarget.get(key) ?? 0) + 1);
      }

      return {
        evaluation: resource,
        satisfaction: satisfactionSection(),
        criteriaWithoutEvidence: scoresWithoutEvidence(
          resource.scores.map((s) => ({
            criterionCode: s.criterionCode,
            scoreValue: s.scoreValue,
            weightValue: s.weightValue,
            comment: s.comment,
            evidenceEventIds: s.evidenceEventIds,
          })),
        ),
        improvementsByTarget: [...byTarget.entries()]
          .map(([targetType, count]) => ({ targetType, count }))
          .sort((a, b) => a.targetType.localeCompare(b.targetType)),
        generatedAt: new Date().toISOString(),
      };
    });
  }

  // ── 내부 ─────────────────────────────────────────────────────────────────

  /**
   * 평가를 넣는다 — 동시 요청 둘이 부딪히면 500이 아니라 422다.
   *
   * `uk_evaluation_situation`이 하나로 묶으므로 둘째 요청은 유니크 위반으로
   * 떨어진다. 그것은 서버 결함이 아니라 "이미 있다"는 사실이다.
   */
  private async insertEvaluationOrConflict(
    c: PoolClient,
    input: Parameters<EvaluationRepository['insertEvaluation']>[1],
  ): Promise<EvaluationRow | null> {
    try {
      return await this.repo.insertEvaluation(c, input);
    } catch (err) {
      if ((err as { code?: string } | null)?.code === '23505') {
        throw evaluationErrors.alreadyEvaluated();
      }
      throw err;
    }
  }

  private async gatherBlockers(
    c: PoolClient,
    auth: AuthContext,
    situationId: string,
  ): Promise<CloseBlocker[]> {
    const [runs, tasks, pendingDispatches, candidateFacts, openConflicts, journals] =
      await Promise.all([
        this.repo.listRuns(c, auth.tenantId, situationId),
        this.repo.listTasks(c, auth.tenantId, situationId),
        this.repo.listPendingDispatches(c, auth.tenantId, situationId),
        this.repo.listCandidateFacts(c, auth.tenantId, situationId),
        this.repo.listOpenConflicts(c, auth.tenantId, situationId),
        this.repo.listJournals(c, auth.tenantId, situationId),
      ]);
    return collectCloseBlockers({
      runs,
      tasks,
      pendingDispatches,
      candidateFacts,
      openConflicts,
      journals,
    });
  }

  /**
   * 지표를 낸다 — **CC-290의 산출기 하나로**.
   *
   * 정정은 집계에 반영한다(ADR-43 D8: 집계는 정정본). 그리고 무엇을 보고
   * 냈는지를 함께 적어 나중에 낡음을 판정한다.
   */
  private computeMetrics(
    events: ReadonlyArray<{
      eventId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      occurredAt: Date;
      payload: Record<string, unknown>;
      correctsEventId: string | null;
    }>,
    dueDates: ReadonlyArray<{ taskId: string; dueAt: Date | null }>,
    summary: { eventCount: number; lastEventId: string | null; streamHash: string },
    options: { truncated: boolean },
  ): { metrics: ReturnType<typeof deriveMetrics> & { truncated: boolean }; basis: MetricBasis } {
    const at = events.length > 0 ? events[events.length - 1].occurredAt : new Date(0);
    const applied = applyCorrections(events);
    const states = foldTaskStates(applied, at);
    // **기한은 이벤트가 모른다** — 임무 행에서 온다. 넘기지 않으면 `overdue`가
    // 언제나 0이 되어 평가서에 "지연 0%"라는 거짓이 박힌다(execution-log 계약).
    const byTask = new Map(dueDates.map((t) => [t.taskId, t.dueAt]));
    const tasks = [...states.keys()].map((taskId) => ({
      taskId,
      dueAt: byTask.get(taskId) ?? null,
    }));
    return {
      metrics: { ...deriveMetrics(computeKpi(tasks, states, at)), truncated: options.truncated },
      basis: { ...summary, computedAt: new Date().toISOString() },
    };
  }

  private async assemble(
    c: PoolClient,
    auth: AuthContext,
    evaluation: EvaluationRow,
  ): Promise<EvaluationResource> {
    const [scores, improvements, current] = await Promise.all([
      this.repo.listScores(c, auth.tenantId, evaluation.evaluationId),
      this.repo.listImprovements(c, auth.tenantId, evaluation.evaluationId),
      // 전량 적재하지 않는다 — 드리프트 판정에 필요한 것은 요약뿐이다.
      this.repo.summarizeEvents(c, auth.tenantId, evaluation.situationId),
    ]);
    const stored = evaluation.metricBasis as unknown as MetricBasis;
    return {
      evaluationId: evaluation.evaluationId,
      situationId: evaluation.situationId,
      status: evaluation.status,
      evaluationType: evaluation.evaluationType,
      overallScore: evaluation.overallScore,
      summary: evaluation.summary,
      metrics: evaluation.metric,
      // 낡았다고 말할 뿐 다시 계산하지 않는다(ADR-44 D6과 같은 판단).
      metricsStale:
        typeof stored?.streamHash === 'string' &&
        isMetricStale(stored, { ...current, computedAt: '' }),
      confirmedBy: evaluation.confirmedBy,
      confirmedAt: iso(evaluation.confirmedAt),
      createdBy: evaluation.createdBy,
      createdAt: iso(evaluation.createdAt) as string,
      scores: scores.map((s) => ({
        scoreId: s.scoreId,
        criterionCode: s.criterionCode,
        scoreValue: s.scoreValue,
        weightValue: s.weightValue,
        comment: s.comment,
        evidenceEventIds: s.evidenceEventIds,
      })),
      improvements: improvements.map((a) => ({
        actionId: a.actionId,
        actionText: a.actionText,
        ownerUserId: a.ownerUserId,
        dueAt: iso(a.dueAt),
        status: a.status,
        targetType: a.targetType,
        targetId: a.targetId,
      })),
    };
  }
}
