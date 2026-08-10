import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * EvidenceSet 저장소 (CC-230).
 *
 * `evidence_set`은 tenant_id 컬럼이 없고 `situation`을 거쳐 증명한다.
 * 0031이 RLS 정책을 걸었지만 **그 위에 명시적 테넌트 술어를 또 둔다** —
 * RLS는 마지막 방어선이지 유일한 방어선이 아니다(situation.repository와 같은 규칙).
 */

export interface EvidenceSetRow {
  evidenceSetId: string;
  situationId: string;
  snapshotId: string;
  queryText: string;
  filtersJson: unknown;
  topK: number;
  status: string;
  contentHash: string;
  frozenAt: Date | null;
  frozenBy: string | null;
  freezeReason: string | null;
  providerJobId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EvidenceItemRow {
  evidenceItemId: string;
  evidenceSetId: string;
  knowledgeDocumentId: string;
  providerChunkId: string | null;
  rankNo: number;
  score: string | number | null;
  quoteText: string;
  sourceLocatorJson: unknown;
  citationKey: string;
  isSelected: boolean;
  excludedReason: string | null;
}

/** 근거 자격을 가진 문서 (CC-220의 두 축이 모두 맞는 것). */
export interface EligibleDocumentRow {
  knowledgeDocumentId: string;
  providerDocumentId: string;
  originalName: string;
}

const SELECT_SET = `
  SELECT evidence_set_id, situation_id, snapshot_id, query_text, filters_json, top_k,
         status, content_hash, frozen_at, frozen_by, freeze_reason, provider_job_id,
         created_by, created_at, updated_at
    FROM evidence_set`;

function toSet(row: Record<string, unknown>): EvidenceSetRow {
  return {
    evidenceSetId: row.evidence_set_id as string,
    situationId: row.situation_id as string,
    snapshotId: row.snapshot_id as string,
    queryText: row.query_text as string,
    filtersJson: row.filters_json ?? {},
    topK: row.top_k as number,
    status: row.status as string,
    contentHash: row.content_hash as string,
    frozenAt: (row.frozen_at as Date | null) ?? null,
    frozenBy: (row.frozen_by as string | null) ?? null,
    freezeReason: (row.freeze_reason as string | null) ?? null,
    providerJobId: (row.provider_job_id as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toItem(row: Record<string, unknown>): EvidenceItemRow {
  return {
    evidenceItemId: row.evidence_item_id as string,
    evidenceSetId: row.evidence_set_id as string,
    knowledgeDocumentId: row.knowledge_document_id as string,
    providerChunkId: (row.provider_chunk_id as string | null) ?? null,
    rankNo: row.rank_no as number,
    score: (row.score as string | number | null) ?? null,
    quoteText: row.quote_text as string,
    sourceLocatorJson: row.source_locator_json ?? {},
    citationKey: row.citation_key as string,
    isSelected: row.is_selected as boolean,
    excludedReason: (row.excluded_reason as string | null) ?? null,
  };
}

@Injectable()
export class EvidenceRepository {
  /**
   * 근거 자격이 있는 문서들.
   *
   * **두 축을 SQL에서 함께 본다** — `status='REGISTERED' AND uni_status='READY'`.
   * 도메인 `isEvidenceEligible`과 같은 규칙이며, 여기서 걸러야 UNI에 보낼
   * 문서 목록 자체가 자격 있는 것만으로 구성된다(US-SIT-010 완료조건).
   */
  async findEligibleDocuments(
    c: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<EligibleDocumentRow[]> {
    const r = await c.query(
      `SELECT k.knowledge_document_id, k.provider_document_id, f.original_name
         FROM knowledge_document k
         JOIN file_object f ON f.file_id = k.file_id
        WHERE k.tenant_id = $1 AND k.situation_id = $2
          AND k.status = 'REGISTERED' AND k.uni_status = 'READY'
        ORDER BY k.created_at`,
      [tenantId, situationId],
    );
    return r.rows.map((row) => ({
      knowledgeDocumentId: row.knowledge_document_id as string,
      providerDocumentId: row.provider_document_id as string,
      originalName: row.original_name as string,
    }));
  }

  async findSet(
    c: PoolClient,
    tenantId: string,
    id: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<EvidenceSetRow | null> {
    const r = await c.query(
      `${SELECT_SET}
        WHERE evidence_set_id = $1
          AND EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = evidence_set.situation_id AND s.tenant_id = $2)
        ${opts.forUpdate ? 'FOR UPDATE OF evidence_set' : ''}`,
      [id, tenantId],
    );
    return r.rowCount === 0 ? null : toSet(r.rows[0]);
  }

  async listItems(c: PoolClient, evidenceSetId: string): Promise<EvidenceItemRow[]> {
    const r = await c.query(
      `SELECT evidence_item_id, evidence_set_id, knowledge_document_id, provider_chunk_id,
              rank_no, score, quote_text, source_locator_json, citation_key,
              is_selected, excluded_reason
         FROM evidence_item WHERE evidence_set_id = $1 ORDER BY rank_no`,
      [evidenceSetId],
    );
    return r.rows.map(toItem);
  }

  /** UNE-KNOW-007. 근거 하나의 원문 위치 — 테넌트는 2단 조인으로 증명한다. */
  async findItemWithDocument(
    c: PoolClient,
    tenantId: string,
    itemId: string,
  ): Promise<{ item: EvidenceItemRow; fileName: string; providerDocumentId: string } | null> {
    const r = await c.query(
      `SELECT i.evidence_item_id, i.evidence_set_id, i.knowledge_document_id,
              i.provider_chunk_id, i.rank_no, i.score, i.quote_text, i.source_locator_json,
              i.citation_key, i.is_selected, i.excluded_reason,
              f.original_name, k.provider_document_id
         FROM evidence_item i
         JOIN evidence_set e ON e.evidence_set_id = i.evidence_set_id
         JOIN situation s ON s.situation_id = e.situation_id
         JOIN knowledge_document k ON k.knowledge_document_id = i.knowledge_document_id
         JOIN file_object f ON f.file_id = k.file_id
        WHERE i.evidence_item_id = $1 AND s.tenant_id = $2`,
      [itemId, tenantId],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    return {
      item: toItem(row),
      fileName: row.original_name as string,
      providerDocumentId: (row.provider_document_id as string | null) ?? '',
    };
  }

  /**
   * 검색 잡을 기록한다.
   *
   * **동기 호출이므로 종결 상태로 태어난다** — CC-220의 업로드 잡이 QUEUED로
   * 시작하는 것과 갈리는 지점이다(ADR-37 D2). 0023이 원래 세 상태만 둔 이유가
   * 이 형태였다.
   */
  async insertSearchJob(
    c: PoolClient,
    input: {
      tenantId: string;
      situationId: string;
      queryText: string;
      topK: number;
      documentCount: number;
      correlationId: string;
      ok: boolean;
      resultCount: number;
      error: unknown;
    },
  ): Promise<string> {
    const r = await c.query(
      `INSERT INTO provider_job
         (tenant_id, batch_id, situation_id, provider_code, request_json, status,
          result_count, error_json, correlation_id, finished_at)
       VALUES ($1, gen_random_uuid(), $2, 'UNI', $3::jsonb, $4, $5, $6::jsonb, $7, now())
       RETURNING provider_job_id`,
      [
        input.tenantId,
        input.situationId,
        JSON.stringify({
          operation: 'searchEvidence',
          // 질의는 PII 최소화를 마친 값이다(도메인 minimizePii).
          query: input.queryText,
          topK: input.topK,
          documentCount: input.documentCount,
        }),
        input.ok ? 'SUCCEEDED' : 'FAILED',
        input.resultCount,
        input.error === null ? null : JSON.stringify(input.error),
        input.correlationId,
      ],
    );
    return r.rows[0].provider_job_id as string;
  }

  async insertProviderResult(
    c: PoolClient,
    providerJobId: string,
    payload: unknown,
    sha256: string,
    itemCount: number,
  ): Promise<void> {
    await c.query(
      `INSERT INTO provider_result
         (provider_job_id, seq, raw_payload_json, payload_sha256, item_count)
       VALUES ($1, 1, $2::jsonb, $3, $4)`,
      [providerJobId, JSON.stringify(payload ?? null), sha256, itemCount],
    );
  }

  async insertSet(
    c: PoolClient,
    input: {
      situationId: string;
      snapshotId: string;
      queryText: string;
      filters: unknown;
      topK: number;
      contentHash: string;
      providerJobId: string;
      createdBy: string;
    },
  ): Promise<EvidenceSetRow> {
    const r = await c.query(
      `INSERT INTO evidence_set
         (situation_id, snapshot_id, query_text, filters_json, top_k, status,
          content_hash, provider_job_id, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'DRAFT', $6, $7, $8)
       RETURNING evidence_set_id, situation_id, snapshot_id, query_text, filters_json,
                 top_k, status, content_hash, frozen_at, frozen_by, freeze_reason,
                 provider_job_id, created_by, created_at, updated_at`,
      [
        input.situationId,
        input.snapshotId,
        input.queryText,
        JSON.stringify(input.filters ?? {}),
        input.topK,
        input.contentHash,
        input.providerJobId,
        input.createdBy,
      ],
    );
    return toSet(r.rows[0]);
  }

  async insertItems(
    c: PoolClient,
    evidenceSetId: string,
    items: {
      knowledgeDocumentId: string;
      providerChunkId: string | null;
      rankNo: number;
      score: number | null;
      quoteText: string;
      sourceLocator: unknown;
      citationKey: string;
    }[],
  ): Promise<void> {
    for (const it of items) {
      await c.query(
        `INSERT INTO evidence_item
           (evidence_set_id, knowledge_document_id, provider_chunk_id, rank_no, score,
            quote_text, source_locator_json, citation_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          evidenceSetId,
          it.knowledgeDocumentId,
          it.providerChunkId,
          it.rankNo,
          it.score,
          it.quoteText,
          JSON.stringify(it.sourceLocator ?? {}),
          it.citationKey,
        ],
      );
    }
  }

  async freeze(
    c: PoolClient,
    evidenceSetId: string,
    frozenBy: string,
    reason: string,
    contentHash: string,
  ): Promise<EvidenceSetRow> {
    const r = await c.query(
      `UPDATE evidence_set
          SET status = 'FROZEN', frozen_at = now(), frozen_by = $2, freeze_reason = $3,
              content_hash = $4
        WHERE evidence_set_id = $1
       RETURNING evidence_set_id, situation_id, snapshot_id, query_text, filters_json,
                 top_k, status, content_hash, frozen_at, frozen_by, freeze_reason,
                 provider_job_id, created_by, created_at, updated_at`,
      [evidenceSetId, frozenBy, reason, contentHash],
    );
    return toSet(r.rows[0]);
  }
}
