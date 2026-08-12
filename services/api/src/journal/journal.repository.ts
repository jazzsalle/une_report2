import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * 상황일지 저장소 (CC-300).
 *
 * **일지는 문서다.** 리비전·변경집합·블록은 CC-150의 것을 그대로 쓰고
 * (`DocumentRepository`), 여기서는 일지만이 아는 것을 다룬다 — 어느 상황·어느
 * 판을 접었는가, 사실칸이 무엇인가, 누가 검토·승인했는가.
 *
 * RLS 위에 명시적 부모 조인을 한 겹 더 둔다(ADR-21 보상통제).
 */

export interface JournalRow {
  journalId: string;
  situationId: string;
  snapshotId: string;
  documentId: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  projectionHash: string;
  /** 담기로 한 이벤트 종류. 빈 배열은 전부(0044). */
  eventTypes: string[];
  createdBy: string;
  createdAt: Date;
}

export interface ProjectionItemRow {
  projectionItemId: string;
  journalId: string;
  sectionKey: string;
  sourceEventIds: string[];
  factPayload: Record<string, unknown>;
  narrativeText: string | null;
  sortOrder: number;
  lockedFields: string[];
  narrativeSource: string;
  narrativeUpdatedAt: Date | null;
  narrativeUpdatedBy: string | null;
}

export interface ReviewRequestRow {
  journalReviewRequestId: string;
  journalId: string;
  revisionId: string;
  requestedBy: string;
  requestedAt: Date;
  message: string | null;
  reviewerIds: string[];
  status: string;
}

export interface ApprovalRow {
  journalApprovalId: string;
  journalId: string;
  revisionId: string;
  journalReviewRequestId: string | null;
  decision: string;
  decidedBy: string;
  decidedAt: Date;
  comment: string | null;
  projectionHash: string;
}

/**
 * 쓰기 경로의 테넌트 술어 (ADR-21 보상통제, 이중검토 M-11).
 *
 * RLS가 DB 층에서 막지만 그것 하나에 의존하지 않는다 — 이 저장소의 쓰기가
 * `journal_id`만으로 돌면, 나중에 붙는 배치·워커·관리 경로가 다른 롤로
 * 들어올 때 아무 방어도 남지 않는다. `$1`은 journal_id, 마지막 인자는 tenantId다.
 */
const TENANT_PREDICATE = `EXISTS (
    SELECT 1 FROM journal j
      JOIN situation s ON s.situation_id = j.situation_id
     WHERE j.journal_id = $1 AND s.tenant_id = $4)`;

const JOURNAL_COLUMNS = `journal_id, situation_id, snapshot_id, document_id,
       period_start, period_end, status, projection_hash, event_types,
       created_by, created_at`;

const ITEM_COLUMNS = `projection_item_id, journal_id, section_key, source_event_ids,
       fact_payload_json, narrative_text, sort_order, locked_fields_json,
       narrative_source, narrative_updated_at, narrative_updated_by`;

function toJournal(row: Record<string, unknown>): JournalRow {
  return {
    journalId: row.journal_id as string,
    situationId: row.situation_id as string,
    snapshotId: row.snapshot_id as string,
    documentId: row.document_id as string,
    periodStart: row.period_start as Date,
    periodEnd: row.period_end as Date,
    status: row.status as string,
    projectionHash: row.projection_hash as string,
    eventTypes: (row.event_types as string[] | null) ?? [],
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
  };
}

function toItem(row: Record<string, unknown>): ProjectionItemRow {
  const locked = row.locked_fields_json;
  return {
    projectionItemId: row.projection_item_id as string,
    journalId: row.journal_id as string,
    sectionKey: row.section_key as string,
    sourceEventIds: (row.source_event_ids as string[] | null) ?? [],
    factPayload: (row.fact_payload_json ?? {}) as Record<string, unknown>,
    narrativeText: (row.narrative_text as string | null) ?? null,
    sortOrder: Number(row.sort_order),
    lockedFields: Array.isArray(locked) ? (locked as string[]) : [],
    narrativeSource: row.narrative_source as string,
    narrativeUpdatedAt: (row.narrative_updated_at as Date | null) ?? null,
    narrativeUpdatedBy: (row.narrative_updated_by as string | null) ?? null,
  };
}

@Injectable()
export class JournalRepository {
  async findSituation(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<{ situationId: string; title: string; mode: string; status: string } | null> {
    const r = await c.query(
      `SELECT situation_id, title, mode, status FROM situation
        WHERE situation_id = $1 AND tenant_id = $2`,
      [situationId, tenantId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      situationId: row.situation_id as string,
      title: row.title as string,
      mode: row.mode as string,
      status: row.status as string,
    };
  }

  /**
   * 확정된 상황 판.
   *
   * `snapshotId`를 주면 그것이 이 상황의 것인지도 함께 확인한다 — 다른 상황의
   * 판으로 일지를 만들면 사실이 통째로 남의 것이 된다.
   */
  /** 확정 판. 상황을 통해 테넌트를 한 겹 더 확인한다(ADR-21 보상통제). */
  async findSnapshot(
    c: PoolClient,
    tenantId: string,
    situationId: string,
    snapshotId: string | null,
  ): Promise<{
    snapshotId: string;
    versionNo: number;
    effectiveAt: Date;
    facts: Array<Record<string, unknown>>;
  } | null> {
    const params: unknown[] = [situationId, tenantId];
    let clause = '';
    if (snapshotId) {
      params.push(snapshotId);
      clause = ` AND ss.snapshot_id = $${params.length}`;
    }
    const r = await c.query(
      `SELECT ss.snapshot_id, ss.version_no, ss.effective_at, ss.facts_json
         FROM situation_snapshot ss
         JOIN situation s ON s.situation_id = ss.situation_id
        WHERE ss.situation_id = $1 AND s.tenant_id = $2${clause}
        ORDER BY ss.version_no DESC
        LIMIT 1`,
      params,
    );
    const row = r.rows[0];
    if (!row) return null;
    const facts = row.facts_json;
    return {
      snapshotId: row.snapshot_id as string,
      versionNo: Number(row.version_no),
      effectiveAt: row.effective_at as Date,
      facts: Array.isArray(facts) ? (facts as Array<Record<string, unknown>>) : [],
    };
  }

  /** 기간 안의 사실원장. CC-290이 연 읽기 경로와 같은 정렬이다. */
  async listEvents(
    c: PoolClient,
    tenantId: string,
    situationId: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      eventId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      occurredAt: Date;
      actorId: string | null;
      payload: Record<string, unknown>;
      correctsEventId: string | null;
    }>
  > {
    const r = await c.query(
      `SELECT execution_event_id, aggregate_type, aggregate_id, event_type,
              occurred_at, actor_id, payload_json, corrects_event_id
         FROM execution_event
        WHERE tenant_id = $1 AND situation_id = $2
          AND occurred_at >= $3 AND occurred_at <= $4
        ORDER BY occurred_at, recorded_at, execution_event_id`,
      [tenantId, situationId, from, to],
    );
    return r.rows.map((row) => ({
      eventId: row.execution_event_id as string,
      aggregateType: row.aggregate_type as string,
      aggregateId: row.aggregate_id as string,
      eventType: row.event_type as string,
      occurredAt: row.occurred_at as Date,
      actorId: (row.actor_id as string | null) ?? null,
      payload: (row.payload_json ?? {}) as Record<string, unknown>,
      correctsEventId: (row.corrects_event_id as string | null) ?? null,
    }));
  }

  /**
   * 이 기간의 임무.
   *
   * **기간 끝까지 생긴 것만 담는다.** 08~09시 일지가 11시에 만들어진 임무를
   * 세면 그 일지는 자기 기간에 대해 거짓을 말한다. 그리고 살아 있는 상황에서
   * 임무는 계속 늘어나므로, 기간을 걸지 않으면 만들어진 모든 일지가 몇 초 만에
   * 드리프트한 것으로 판정된다.
   *
   * 기간 **시작 이전**에 생긴 임무는 뺀다고 하지 않는다 — 07시에 시작해 08~09시
   * 내내 진행 중이던 임무는 이 기간의 사실이다.
   */
  async listSituationTasks(
    c: PoolClient,
    tenantId: string,
    situationId: string,
    until: Date,
  ): Promise<
    Array<{ taskId: string; title: string; nodeKey: string; status: string; dueAt: Date | null }>
  > {
    const r = await c.query(
      `SELECT t.task_id, t.title, n.node_key, t.status, t.due_at
         FROM task t
         JOIN sop_run r ON r.run_id = t.run_id
         JOIN situation s ON s.situation_id = r.situation_id
         JOIN sop_node n ON n.node_id = t.node_id
        WHERE s.tenant_id = $1 AND s.situation_id = $2 AND t.created_at <= $3
        ORDER BY t.created_at, t.task_id`,
      [tenantId, situationId, until],
    );
    return r.rows.map((row) => ({
      taskId: row.task_id as string,
      title: row.title as string,
      nodeKey: row.node_key as string,
      status: row.status as string,
      dueAt: (row.due_at as Date | null) ?? null,
    }));
  }

  async insertJournal(
    c: PoolClient,
    input: {
      situationId: string;
      snapshotId: string;
      documentId: string;
      periodStart: Date;
      periodEnd: Date;
      projectionHash: string;
      eventTypes: string[];
      createdBy: string;
    },
  ): Promise<JournalRow> {
    const r = await c.query(
      `INSERT INTO journal
         (situation_id, snapshot_id, document_id, period_start, period_end,
          status, projection_hash, event_types, created_by)
       VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8)
       RETURNING ${JOURNAL_COLUMNS}`,
      [
        input.situationId,
        input.snapshotId,
        input.documentId,
        input.periodStart,
        input.periodEnd,
        input.projectionHash,
        input.eventTypes,
        input.createdBy,
      ],
    );
    return toJournal(r.rows[0]);
  }

  async findJournal(
    c: PoolClient,
    tenantId: string,
    journalId: string,
  ): Promise<JournalRow | null> {
    const r = await c.query(
      `SELECT ${JOURNAL_COLUMNS.split(',')
        .map((col) => `j.${col.trim()}`)
        .join(', ')}
         FROM journal j
         JOIN situation s ON s.situation_id = j.situation_id
        WHERE j.journal_id = $1 AND s.tenant_id = $2`,
      [journalId, tenantId],
    );
    return r.rows[0] ? toJournal(r.rows[0]) : null;
  }

  async setJournalStatus(
    c: PoolClient,
    tenantId: string,
    journalId: string,
    fromStatus: string,
    toStatus: string,
  ): Promise<boolean> {
    const r = await c.query(
      `UPDATE journal SET status = $3
        WHERE journal_id = $1 AND status = $2
          AND ${TENANT_PREDICATE}`,
      [journalId, fromStatus, toStatus, tenantId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** 사실이 움직였는지 알려면 새로 접은 해시를 넣어 둔다. */
  async setProjectionHash(c: PoolClient, journalId: string, hash: string): Promise<void> {
    await c.query(`UPDATE journal SET projection_hash = $2 WHERE journal_id = $1`, [
      journalId,
      hash,
    ]);
  }

  async insertProjectionItem(
    c: PoolClient,
    input: {
      journalId: string;
      sectionKey: string;
      sourceEventIds: string[];
      factPayload: Record<string, unknown>;
      narrativeText: string;
      sortOrder: number;
      lockedFields: string[];
    },
  ): Promise<ProjectionItemRow> {
    const r = await c.query(
      `INSERT INTO journal_projection_item
         (journal_id, section_key, source_event_ids, fact_payload_json,
          narrative_text, sort_order, locked_fields_json, narrative_source)
       VALUES ($1, $2, $3::uuid[], $4::jsonb, $5, $6, $7::jsonb, 'PROJECTED')
       RETURNING ${ITEM_COLUMNS}`,
      [
        input.journalId,
        input.sectionKey,
        input.sourceEventIds,
        JSON.stringify(input.factPayload),
        input.narrativeText,
        input.sortOrder,
        JSON.stringify(input.lockedFields),
      ],
    );
    return toItem(r.rows[0]);
  }

  async listProjectionItems(c: PoolClient, journalId: string): Promise<ProjectionItemRow[]> {
    const r = await c.query(
      `SELECT ${ITEM_COLUMNS} FROM journal_projection_item
        WHERE journal_id = $1 ORDER BY sort_order, section_key`,
      [journalId],
    );
    return r.rows.map(toItem);
  }

  async findProjectionItem(
    c: PoolClient,
    journalId: string,
    sectionKey: string,
  ): Promise<ProjectionItemRow | null> {
    const r = await c.query(
      `SELECT ${ITEM_COLUMNS} FROM journal_projection_item
        WHERE journal_id = $1 AND section_key = $2`,
      [journalId, sectionKey],
    );
    return r.rows[0] ? toItem(r.rows[0]) : null;
  }

  /**
   * 서술만 바꾼다.
   *
   * **사실칸(`fact_payload_json`·`locked_fields_json`)에 닿는 UPDATE는 여기에
   * 없다.** 그것이 구조적 분리이고, 사실 대조(도메인)는 그 위에서만 뜻이 있다.
   */
  async updateNarrative(
    c: PoolClient,
    input: {
      journalId: string;
      sectionKey: string;
      narrativeText: string;
      source: 'AI' | 'USER';
      actorId: string;
    },
  ): Promise<boolean> {
    const r = await c.query(
      `UPDATE journal_projection_item
          SET narrative_text = $3, narrative_source = $4,
              narrative_updated_at = now(), narrative_updated_by = $5
        WHERE journal_id = $1 AND section_key = $2`,
      [input.journalId, input.sectionKey, input.narrativeText, input.source, input.actorId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * 재투영 — **사람이 손댄 칸은 덮지 않는다.**
   *
   * 비협상 규칙 "User-edited blocks are protected from regeneration". AI가
   * 쓴 것은 덮는다: 그것은 제안을 수락한 것이지 사람이 쓴 문장이 아니고,
   * 사실이 바뀌면 그 제안의 전제가 사라진다.
   */
  async refreshProjectionItem(
    c: PoolClient,
    input: {
      journalId: string;
      sectionKey: string;
      sourceEventIds: string[];
      factPayload: Record<string, unknown>;
      narrativeText: string;
      lockedFields: string[];
    },
  ): Promise<{ updated: boolean; narrativeKept: boolean }> {
    const r = await c.query(
      `UPDATE journal_projection_item
          SET source_event_ids = $3::uuid[],
              fact_payload_json = $4::jsonb,
              locked_fields_json = $6::jsonb,
              narrative_text = CASE WHEN narrative_source = 'USER'
                                    THEN narrative_text ELSE $5 END,
              narrative_source = CASE WHEN narrative_source = 'USER'
                                      THEN narrative_source ELSE 'PROJECTED' END
        WHERE journal_id = $1 AND section_key = $2
       RETURNING narrative_source`,
      [
        input.journalId,
        input.sectionKey,
        input.sourceEventIds,
        JSON.stringify(input.factPayload),
        input.narrativeText,
        JSON.stringify(input.lockedFields),
      ],
    );
    const row = r.rows[0];
    if (!row) return { updated: false, narrativeKept: false };
    return { updated: true, narrativeKept: row.narrative_source === 'USER' };
  }

  async insertReviewRequest(
    c: PoolClient,
    input: {
      journalId: string;
      revisionId: string;
      requestedBy: string;
      message: string | null;
      reviewerIds: string[];
    },
  ): Promise<ReviewRequestRow> {
    const r = await c.query(
      `INSERT INTO journal_review_request
         (journal_id, revision_id, requested_by, message, reviewer_ids, status)
       VALUES ($1, $2, $3, $4, $5::uuid[], 'OPEN')
       RETURNING journal_review_request_id, journal_id, revision_id, requested_by,
                 requested_at, message, reviewer_ids, status`,
      [input.journalId, input.revisionId, input.requestedBy, input.message, input.reviewerIds],
    );
    const row = r.rows[0];
    return {
      journalReviewRequestId: row.journal_review_request_id as string,
      journalId: row.journal_id as string,
      revisionId: row.revision_id as string,
      requestedBy: row.requested_by as string,
      requestedAt: row.requested_at as Date,
      message: (row.message as string | null) ?? null,
      reviewerIds: (row.reviewer_ids as string[] | null) ?? [],
      status: row.status as string,
    };
  }

  async findOpenReviewRequest(c: PoolClient, journalId: string): Promise<ReviewRequestRow | null> {
    const r = await c.query(
      `SELECT journal_review_request_id, journal_id, revision_id, requested_by,
              requested_at, message, reviewer_ids, status
         FROM journal_review_request
        WHERE journal_id = $1 AND status = 'OPEN'
        ORDER BY requested_at DESC LIMIT 1`,
      [journalId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      journalReviewRequestId: row.journal_review_request_id as string,
      journalId: row.journal_id as string,
      revisionId: row.revision_id as string,
      requestedBy: row.requested_by as string,
      requestedAt: row.requested_at as Date,
      message: (row.message as string | null) ?? null,
      reviewerIds: (row.reviewer_ids as string[] | null) ?? [],
      status: row.status as string,
    };
  }

  async closeReviewRequest(
    c: PoolClient,
    requestId: string,
    status: 'APPROVED' | 'CHANGES_REQUESTED',
  ): Promise<void> {
    await c.query(
      `UPDATE journal_review_request SET status = $2
        WHERE journal_review_request_id = $1 AND status = 'OPEN'`,
      [requestId, status],
    );
  }

  async insertApproval(
    c: PoolClient,
    input: {
      journalId: string;
      revisionId: string;
      reviewRequestId: string | null;
      decision: 'APPROVED' | 'CHANGES_REQUESTED';
      decidedBy: string;
      comment: string | null;
      projectionHash: string;
    },
  ): Promise<ApprovalRow> {
    const r = await c.query(
      `INSERT INTO journal_approval
         (journal_id, revision_id, journal_review_request_id, decision,
          decided_by, comment, projection_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING journal_approval_id, journal_id, revision_id, journal_review_request_id,
                 decision, decided_by, decided_at, comment, projection_hash`,
      [
        input.journalId,
        input.revisionId,
        input.reviewRequestId,
        input.decision,
        input.decidedBy,
        input.comment,
        input.projectionHash,
      ],
    );
    const row = r.rows[0];
    return {
      journalApprovalId: row.journal_approval_id as string,
      journalId: row.journal_id as string,
      revisionId: row.revision_id as string,
      journalReviewRequestId: (row.journal_review_request_id as string | null) ?? null,
      decision: row.decision as string,
      decidedBy: row.decided_by as string,
      decidedAt: row.decided_at as Date,
      comment: (row.comment as string | null) ?? null,
      projectionHash: row.projection_hash as string,
    };
  }

  /** 마지막으로 승인된 판. Export는 이 값만 내보낸다(이중검토 C-2). */
  async findApprovedRevisionId(c: PoolClient, journalId: string): Promise<string | null> {
    const r = await c.query(
      `SELECT revision_id FROM journal_approval
        WHERE journal_id = $1 AND decision = 'APPROVED'
        ORDER BY decided_at DESC LIMIT 1`,
      [journalId],
    );
    return (r.rows[0]?.revision_id as string | undefined) ?? null;
  }

  async listApprovals(c: PoolClient, journalId: string): Promise<ApprovalRow[]> {
    const r = await c.query(
      `SELECT journal_approval_id, journal_id, revision_id, journal_review_request_id,
              decision, decided_by, decided_at, comment, projection_hash
         FROM journal_approval WHERE journal_id = $1 ORDER BY decided_at, journal_approval_id`,
      [journalId],
    );
    return r.rows.map((row) => ({
      journalApprovalId: row.journal_approval_id as string,
      journalId: row.journal_id as string,
      revisionId: row.revision_id as string,
      journalReviewRequestId: (row.journal_review_request_id as string | null) ?? null,
      decision: row.decision as string,
      decidedBy: row.decided_by as string,
      decidedAt: row.decided_at as Date,
      comment: (row.comment as string | null) ?? null,
      projectionHash: row.projection_hash as string,
    }));
  }
}
