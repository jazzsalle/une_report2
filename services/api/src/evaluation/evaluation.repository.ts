import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * 재생 상한. CC-290이 같은 값으로 대시보드를 자르므로, 여기서 자르지 않으면
 * 같은 훈련을 두 화면이 다른 집합으로 계산한다(ADR-43 D10).
 */
const REPLAY_LIMIT = 20_000;

/**
 * 종료·평가 저장소 (CC-310).
 *
 * RLS 위에 명시적 테넌트 조건을 한 겹 더 둔다(ADR-21 보상통제). 특히 **쓰기
 * 경로**가 id 하나로 돌면 나중에 붙는 배치·워커가 그대로 뚫는다 — CC-300
 * 이중검토가 지적한 바로 그 자리다.
 */

export interface SituationRow {
  situationId: string;
  tenantId: string;
  title: string;
  mode: string;
  status: string;
}

export interface EvaluationRow {
  evaluationId: string;
  situationId: string;
  status: string;
  evaluationType: string;
  overallScore: number | null;
  summary: string | null;
  metric: Record<string, unknown>;
  metricBasis: Record<string, unknown>;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

export interface ScoreRow {
  scoreId: string;
  criterionCode: string;
  scoreValue: number;
  weightValue: number;
  comment: string | null;
  evidenceEventIds: string[];
}

export interface ImprovementRow {
  actionId: string;
  actionText: string;
  ownerUserId: string | null;
  dueAt: Date | null;
  status: string;
  targetType: string | null;
  targetId: string | null;
}

const EVALUATION_COLUMNS = `evaluation_id, situation_id, status, evaluation_type,
       overall_score, summary, metric_json, metric_basis_json,
       confirmed_by, confirmed_at, created_by, created_at`;

function toEvaluation(row: Record<string, unknown>): EvaluationRow {
  return {
    evaluationId: row.evaluation_id as string,
    situationId: row.situation_id as string,
    status: row.status as string,
    evaluationType: row.evaluation_type as string,
    overallScore: row.overall_score === null ? null : Number(row.overall_score),
    summary: (row.summary as string | null) ?? null,
    metric: (row.metric_json as Record<string, unknown>) ?? {},
    metricBasis: (row.metric_basis_json as Record<string, unknown>) ?? {},
    confirmedBy: (row.confirmed_by as string | null) ?? null,
    confirmedAt: (row.confirmed_at as Date | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
  };
}

@Injectable()
export class EvaluationRepository {
  // ── 상황 ─────────────────────────────────────────────────────────────────

  /**
   * 상황 하나.
   *
   * `forUpdate`는 종료 경로가 쓴다. 미결을 세는 것과 상태를 옮기는 것 사이에
   * 다른 트랜잭션이 임무를 하나 만들면 **처분되지 않은 미결을 안고 닫힌다** —
   * 인수기준("미결·사유 누락 0")이 경합에서 깨진다. 행을 먼저 잠그고 센다.
   */
  async findSituation(
    c: PoolClient,
    tenantId: string,
    situationId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<SituationRow | null> {
    const r = await c.query(
      `SELECT situation_id, tenant_id, title, mode, status FROM situation
        WHERE situation_id = $1 AND tenant_id = $2${options.forUpdate ? ' FOR UPDATE' : ''}`,
      [situationId, tenantId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      situationId: row.situation_id as string,
      tenantId: row.tenant_id as string,
      title: row.title as string,
      mode: row.mode as string,
      status: row.status as string,
    };
  }

  /** 조건부 전이. 상태를 읽고 쓰는 사이에 다른 요청이 닫았으면 0행이다. */
  async closeSituation(
    c: PoolClient,
    tenantId: string,
    situationId: string,
    fromStatuses: readonly string[],
  ): Promise<boolean> {
    const r = await c.query(
      `UPDATE situation SET status = 'CLOSED'
        WHERE situation_id = $1 AND tenant_id = $2 AND status = ANY($3::text[])`,
      [situationId, tenantId, fromStatuses],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // ── 종료 게이트가 보는 것들 ──────────────────────────────────────────────

  async listRuns(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<Array<{ runId: string; status: string; label: string }>> {
    const r = await c.query(
      `SELECT r.run_id, r.status, s.title
         FROM sop_run r
         JOIN situation s ON s.situation_id = r.situation_id
        WHERE s.situation_id = $1 AND s.tenant_id = $2
        ORDER BY r.started_at, r.run_id`,
      [situationId, tenantId],
    );
    return r.rows.map((row) => ({
      runId: row.run_id as string,
      status: row.status as string,
      label: (row.title as string) ?? '실행',
    }));
  }

  async listTasks(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<Array<{ taskId: string; status: string; title: string }>> {
    const r = await c.query(
      `SELECT t.task_id, t.status, t.title
         FROM task t
         JOIN sop_run r ON r.run_id = t.run_id
         JOIN situation s ON s.situation_id = r.situation_id
        WHERE s.situation_id = $1 AND s.tenant_id = $2
        ORDER BY t.created_at, t.task_id`,
      [situationId, tenantId],
    );
    return r.rows.map((row) => ({
      taskId: row.task_id as string,
      status: row.status as string,
      title: row.title as string,
    }));
  }

  /**
   * 아직 큐에 남은 전파.
   *
   * 닫은 뒤에 릴레이가 이것을 보내려 하면 사실원장이 거부하고(0045 §5) 그 줄은
   * dead letter가 된다 — 즉 **닫는 순간 나가기로 되어 있던 지시가 죽는다.**
   * 사유로 넘길 수 없는 미결인 이유다.
   */
  async listPendingDispatches(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<Array<{ outboxId: string; channel: string; status: string }>> {
    const r = await c.query(
      `SELECT m.outbox_id, m.channel, m.status
         FROM outbox_message m
         JOIN dispatch_recipient dr ON dr.recipient_id = m.dispatch_recipient_id
         JOIN dispatch d ON d.dispatch_id = dr.dispatch_id
         JOIN task t ON t.task_id = d.task_id
         JOIN sop_run r2 ON r2.run_id = t.run_id
         JOIN situation s ON s.situation_id = r2.situation_id
        WHERE s.situation_id = $1 AND s.tenant_id = $2
          AND m.status IN ('PENDING', 'SENDING', 'FAILED')
        ORDER BY m.created_at, m.outbox_id`,
      [situationId, tenantId],
    );
    return r.rows.map((row) => ({
      outboxId: row.outbox_id as string,
      channel: row.channel as string,
      status: row.status as string,
    }));
  }

  /**
   * 임무의 기한.
   *
   * **`computeKpi`는 기한을 이벤트로 알 수 없다** — 그것은 임무 행에 있고,
   * 호출부가 함께 넘기기로 되어 있다(`execution-log.ts`의 계약). 넘기지 않으면
   * `overdue`가 언제나 0이 되어 평가서에 "지연 0%"라는 거짓이 박힌다.
   */
  async listTaskDueDates(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<Array<{ taskId: string; dueAt: Date | null }>> {
    const r = await c.query(
      `SELECT t.task_id, t.due_at
         FROM task t
         JOIN sop_run r ON r.run_id = t.run_id
         JOIN situation s ON s.situation_id = r.situation_id
        WHERE s.situation_id = $1 AND s.tenant_id = $2`,
      [situationId, tenantId],
    );
    return r.rows.map((row) => ({
      taskId: row.task_id as string,
      dueAt: (row.due_at as Date | null) ?? null,
    }));
  }

  async listCandidateFacts(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<Array<{ factId: string; factType: string }>> {
    const r = await c.query(
      `SELECT f.fact_id, f.fact_type
         FROM situation_fact f
         JOIN situation s ON s.situation_id = f.situation_id
        WHERE s.situation_id = $1 AND s.tenant_id = $2 AND f.status = 'CANDIDATE'
        ORDER BY f.fact_id`,
      [situationId, tenantId],
    );
    return r.rows.map((row) => ({
      factId: row.fact_id as string,
      factType: row.fact_type as string,
    }));
  }

  async listOpenConflicts(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<Array<{ conflictId: string; factType: string }>> {
    const r = await c.query(
      `SELECT k.conflict_id, k.fact_key
         FROM fact_conflict k
         JOIN situation s ON s.situation_id = k.situation_id
        WHERE s.situation_id = $1 AND s.tenant_id = $2 AND k.status = 'OPEN'
        ORDER BY k.conflict_id`,
      [situationId, tenantId],
    );
    return r.rows.map((row) => ({
      conflictId: row.conflict_id as string,
      factType: row.fact_key as string,
    }));
  }

  async listJournals(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<Array<{ journalId: string; status: string; projectionHash: string }>> {
    const r = await c.query(
      `SELECT j.journal_id, j.status, j.projection_hash
         FROM journal j
         JOIN situation s ON s.situation_id = j.situation_id
        WHERE s.situation_id = $1 AND s.tenant_id = $2
        ORDER BY j.created_at, j.journal_id`,
      [situationId, tenantId],
    );
    return r.rows.map((row) => ({
      journalId: row.journal_id as string,
      status: row.status as string,
      projectionHash: row.projection_hash as string,
    }));
  }

  /** 최신 확정 판. 기준선 해시가 무엇을 최종으로 삼았는지 적는다. */
  async findLatestSnapshot(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<{ snapshotId: string; versionNo: number } | null> {
    const r = await c.query(
      `SELECT ss.snapshot_id, ss.version_no
         FROM situation_snapshot ss
         JOIN situation s ON s.situation_id = ss.situation_id
        WHERE s.situation_id = $1 AND s.tenant_id = $2
        ORDER BY ss.version_no DESC LIMIT 1`,
      [situationId, tenantId],
    );
    const row = r.rows[0];
    return row
      ? { snapshotId: row.snapshot_id as string, versionNo: Number(row.version_no) }
      : null;
  }

  // ── 사실원장 ─────────────────────────────────────────────────────────────

  /**
   * 이 훈련의 이벤트 전부. 지표 산출과 근거 검증이 같은 목록을 본다 —
   * 두 곳에서 따로 읽으면 "근거로 단 이벤트가 지표에 안 들어간" 평가가 나온다.
   */
  async listEvents(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<{
    events: Array<{
      eventId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      occurredAt: Date;
      payload: Record<string, unknown>;
      correctsEventId: string | null;
    }>;
    /** 상한에 걸렸는가. 조용히 자르면 부분 집합을 전체로 읽는다(ADR-43 D10). */
    truncated: boolean;
  }> {
    const r = await c.query(
      `SELECT execution_event_id, aggregate_type, aggregate_id, event_type,
              occurred_at, payload_json, corrects_event_id
         FROM execution_event
        WHERE tenant_id = $1 AND situation_id = $2
        ORDER BY occurred_at, recorded_at, execution_event_id
        LIMIT $3`,
      [tenantId, situationId, REPLAY_LIMIT + 1],
    );
    const truncated = r.rows.length > REPLAY_LIMIT;
    return {
      truncated,
      events: r.rows.slice(0, REPLAY_LIMIT).map((row) => ({
        eventId: row.execution_event_id as string,
        aggregateType: row.aggregate_type as string,
        aggregateId: row.aggregate_id as string,
        eventType: row.event_type as string,
        occurredAt: row.occurred_at as Date,
        payload: (row.payload_json as Record<string, unknown>) ?? {},
        correctsEventId: (row.corrects_event_id as string | null) ?? null,
      })),
    };
  }

  /**
   * 드리프트 판정만을 위한 요약.
   *
   * 조회할 때마다 이벤트를 전량 적재해 해시하면 긴 훈련에서 매 조회가 O(n)이다.
   * 같은 값을 DB가 집계로 낸다 — 정정이 붙으면 `stream_hash`가 달라진다.
   */
  async summarizeEvents(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<{ eventCount: number; lastEventId: string | null; streamHash: string }> {
    const r = await c.query(
      `SELECT count(*)::bigint AS n,
              (SELECT execution_event_id FROM execution_event
                WHERE tenant_id = $1 AND situation_id = $2
                ORDER BY occurred_at DESC, recorded_at DESC, execution_event_id DESC
                LIMIT 1) AS last_id,
              coalesce(
                md5(string_agg(
                  execution_event_id::text || ':' || event_type || ':' ||
                    coalesce(corrects_event_id::text, ''),
                  ',' ORDER BY occurred_at, recorded_at, execution_event_id)),
                '') AS stream_hash
         FROM execution_event
        WHERE tenant_id = $1 AND situation_id = $2`,
      [tenantId, situationId],
    );
    const row = r.rows[0];
    return {
      eventCount: Number(row.n),
      lastEventId: (row.last_id as string | null) ?? null,
      streamHash: row.stream_hash as string,
    };
  }

  async insertExecutionEvent(
    c: PoolClient,
    input: {
      tenantId: string;
      situationId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      actorId: string;
      payload: Record<string, unknown>;
      correlationId: string;
      eventHash: string;
    },
  ): Promise<{ eventId: string; occurredAt: Date }> {
    const r = await c.query(
      `INSERT INTO execution_event
         (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
          actor_id, payload_json, correlation_id, event_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
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
        input.eventHash,
      ],
    );
    return {
      eventId: r.rows[0].execution_event_id as string,
      occurredAt: r.rows[0].occurred_at as Date,
    };
  }

  // ── 평가 ─────────────────────────────────────────────────────────────────

  async findEvaluationBySituation(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<EvaluationRow | null> {
    const r = await c.query(
      `SELECT ${EVALUATION_COLUMNS} FROM evaluation e
        WHERE e.situation_id = $1
          AND EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = e.situation_id AND s.tenant_id = $2)`,
      [situationId, tenantId],
    );
    return r.rows[0] ? toEvaluation(r.rows[0]) : null;
  }

  async findEvaluation(
    c: PoolClient,
    tenantId: string,
    evaluationId: string,
  ): Promise<EvaluationRow | null> {
    const r = await c.query(
      `SELECT ${EVALUATION_COLUMNS} FROM evaluation e
        WHERE e.evaluation_id = $1
          AND EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = e.situation_id AND s.tenant_id = $2)`,
      [evaluationId, tenantId],
    );
    return r.rows[0] ? toEvaluation(r.rows[0]) : null;
  }

  async insertEvaluation(
    c: PoolClient,
    input: {
      tenantId: string;
      situationId: string;
      summary: string | null;
      overallScore: number | null;
      metric: Record<string, unknown>;
      metricBasis: Record<string, unknown>;
      createdBy: string;
    },
  ): Promise<EvaluationRow | null> {
    const r = await c.query(
      `INSERT INTO evaluation
         (situation_id, status, evaluation_type, overall_score, summary,
          metric_json, metric_basis_json, created_by)
       SELECT $1, 'OPEN', 'EXERCISE', $2, $3, $4::jsonb, $5::jsonb, $6
        WHERE EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = $1 AND s.tenant_id = $7)
       RETURNING ${EVALUATION_COLUMNS}`,
      [
        input.situationId,
        input.overallScore,
        input.summary,
        JSON.stringify(input.metric),
        JSON.stringify(input.metricBasis),
        input.createdBy,
        input.tenantId,
      ],
    );
    if (!r.rows[0]) return null;
    return toEvaluation(r.rows[0]);
  }

  async insertScore(
    c: PoolClient,
    input: {
      tenantId: string;
      evaluationId: string;
      criterionCode: string;
      scoreValue: number;
      weightValue: number;
      comment: string | null;
      evidenceEventIds: string[];
    },
  ): Promise<void> {
    await c.query(
      `INSERT INTO evaluation_score
         (evaluation_id, criterion_code, score_value, weight_value, comment, evidence_event_ids)
       SELECT $1,$2,$3,$4,$5,$6::uuid[]
        WHERE EXISTS (SELECT 1 FROM evaluation e JOIN situation s USING (situation_id)
                       WHERE e.evaluation_id = $1 AND s.tenant_id = $7)`,
      [
        input.evaluationId,
        input.criterionCode,
        input.scoreValue,
        input.weightValue,
        input.comment,
        input.evidenceEventIds,
        input.tenantId,
      ],
    );
  }

  async listScores(c: PoolClient, tenantId: string, evaluationId: string): Promise<ScoreRow[]> {
    const r = await c.query(
      `SELECT sc.score_id, sc.criterion_code, sc.score_value, sc.weight_value,
              sc.comment, sc.evidence_event_ids
         FROM evaluation_score sc
         JOIN evaluation e ON e.evaluation_id = sc.evaluation_id
         JOIN situation s ON s.situation_id = e.situation_id
        WHERE sc.evaluation_id = $1 AND s.tenant_id = $2
        ORDER BY sc.criterion_code`,
      [evaluationId, tenantId],
    );
    return r.rows.map((row) => ({
      scoreId: row.score_id as string,
      criterionCode: row.criterion_code as string,
      scoreValue: Number(row.score_value),
      weightValue: Number(row.weight_value),
      comment: (row.comment as string | null) ?? null,
      evidenceEventIds: (row.evidence_event_ids as string[] | null) ?? [],
    }));
  }

  /** 확정. 조건부 UPDATE라 이미 확정된 것을 두 번 확정하지 않는다. */
  async confirmEvaluation(
    c: PoolClient,
    tenantId: string,
    evaluationId: string,
    actorId: string,
  ): Promise<boolean> {
    const r = await c.query(
      `UPDATE evaluation SET status = 'CONFIRMED', confirmed_by = $3, confirmed_at = now()
        WHERE evaluation_id = $1 AND status = 'OPEN'
          AND EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = evaluation.situation_id AND s.tenant_id = $2)`,
      [evaluationId, tenantId, actorId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // ── 개선조치 ─────────────────────────────────────────────────────────────

  async insertImprovement(
    c: PoolClient,
    input: {
      tenantId: string;
      evaluationId: string;
      actionText: string;
      ownerUserId: string | null;
      dueAt: Date | null;
      targetType: string | null;
      targetId: string | null;
    },
  ): Promise<ImprovementRow | null> {
    const r = await c.query(
      `INSERT INTO improvement_action
         (evaluation_id, action_text, owner_user_id, due_at, status, target_type, target_id)
       SELECT $1,$2,$3,$4,'OPEN',$5,$6
        WHERE EXISTS (SELECT 1 FROM evaluation e JOIN situation s USING (situation_id)
                       WHERE e.evaluation_id = $1 AND s.tenant_id = $7)
       RETURNING action_id, action_text, owner_user_id, due_at, status, target_type, target_id`,
      [
        input.evaluationId,
        input.actionText,
        input.ownerUserId,
        input.dueAt,
        input.targetType,
        input.targetId,
        input.tenantId,
      ],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      actionId: row.action_id as string,
      actionText: row.action_text as string,
      ownerUserId: (row.owner_user_id as string | null) ?? null,
      dueAt: (row.due_at as Date | null) ?? null,
      status: row.status as string,
      targetType: (row.target_type as string | null) ?? null,
      targetId: (row.target_id as string | null) ?? null,
    };
  }

  async listImprovements(
    c: PoolClient,
    tenantId: string,
    evaluationId: string,
  ): Promise<ImprovementRow[]> {
    const r = await c.query(
      `SELECT a.action_id, a.action_text, a.owner_user_id, a.due_at, a.status,
              a.target_type, a.target_id
         FROM improvement_action a
         JOIN evaluation e ON e.evaluation_id = a.evaluation_id
         JOIN situation s ON s.situation_id = e.situation_id
        WHERE a.evaluation_id = $1 AND s.tenant_id = $2
        ORDER BY a.action_id`,
      [evaluationId, tenantId],
    );
    return r.rows.map((row) => ({
      actionId: row.action_id as string,
      actionText: row.action_text as string,
      ownerUserId: (row.owner_user_id as string | null) ?? null,
      dueAt: (row.due_at as Date | null) ?? null,
      status: row.status as string,
      targetType: (row.target_type as string | null) ?? null,
      targetId: (row.target_id as string | null) ?? null,
    }));
  }

  /** 담당자가 이 기관의 사용자인가. 남의 기관 사용자에게 조치를 맡길 수 없다. */
  async userExists(c: PoolClient, tenantId: string, userId: string): Promise<boolean> {
    const r = await c.query(
      `SELECT 1 FROM app_user WHERE user_id = $1 AND tenant_id = $2 AND status = 'ACTIVE'`,
      [userId, tenantId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * 환류 대상이 실재하는가.
   *
   * 없는 대상을 가리키는 포인터는 거짓 근거다 — "이 SOP를 고치기로 했다"는
   * 기록이 어느 SOP도 가리키지 않는 상태가 된다. 테넌트도 함께 본다.
   */
  async targetExists(
    c: PoolClient,
    tenantId: string,
    targetType: string,
    targetId: string,
  ): Promise<boolean> {
    if (targetType === 'PLAN') {
      const r = await c.query(
        `SELECT 1 FROM plan WHERE plan_id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
        [targetId, tenantId],
      );
      return (r.rowCount ?? 0) > 0;
    }
    if (targetType === 'SOP') {
      const r = await c.query(`SELECT 1 FROM sop WHERE sop_id = $1 AND tenant_id = $2`, [
        targetId,
        tenantId,
      ]);
      return (r.rowCount ?? 0) > 0;
    }
    return false;
  }
}
