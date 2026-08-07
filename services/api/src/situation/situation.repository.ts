import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/** Situation aggregate reads/writes (CC-200).
 *
 * 모든 질의는 `DatabaseService.withTenant` 안에서 돌고 **그 위에 명시적
 * 테넌트 술어를 또 둔다.** 0023이 RLS 정책을 걸었지만 RLS는 마지막 방어선이지
 * 유일한 방어선이 아니다(plan.repository와 같은 규칙).
 *
 * `situation_fact`·`provider_result`는 테넌트 컬럼이 없고 부모를 거쳐 증명된다.
 * 그래서 이 저장소는 자식을 만질 때 **항상 부모를 먼저 확인**한다 — 그 순서를
 * 서비스에 맡기지 않는다.
 */

export interface SituationRow {
  situationId: string;
  tenantId: string;
  mode: string;
  title: string;
  hazardType: string;
  status: string;
  occurredAt: Date | null;
  locationText: string | null;
  currentSnapshotId: string | null;
  versionNo: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FactSourceRow {
  sourceId: string;
  providerCode: string;
  sourceType: string;
  sourceName: string;
  sourceUri: string | null;
  retrievedAt: Date;
}

export interface SituationFactRow {
  factId: string;
  situationId: string;
  factType: string;
  factKey: string;
  valueJson: unknown;
  sourceId: string;
  observedAt: Date | null;
  collectedAt: Date;
  confidence: string | number | null;
  status: string;
  versionNo: number;
  updatedAt: Date;
  source: FactSourceRow;
}

export interface ProviderJobRow {
  providerJobId: string;
  batchId: string;
  situationId: string | null;
  providerCode: string;
  requestJson: unknown;
  status: string;
  resultCount: number;
  errorJson: unknown;
  correlationId: string;
  createdAt: Date;
  finishedAt: Date;
}

export interface SituationCreateInput {
  mode: string;
  title: string;
  hazardType: string;
  occurredAt: string | null;
  locationText: string | null;
  createdBy: string;
}

export interface SituationMetaPatch {
  title?: string;
  hazardType?: string;
  occurredAt?: string | null;
  locationText?: string | null;
}

export interface SituationSearchQuery {
  keyword?: string;
  mode?: string;
  status?: string;
  hazardType?: string;
  /** 1-based (contract SituationPageResponse). */
  page: number;
  size: number;
}

export interface FactSearchQuery {
  status?: string;
  factType?: string;
  page: number;
  size: number;
}

export interface FactSourceInsert {
  providerCode: string;
  sourceType: string;
  sourceName: string;
  sourceUri: string | null;
  retrievedAt: string;
}

export interface FactInsert {
  factType: string;
  factKey: string;
  valueJson: unknown;
  sourceId: string;
  observedAt: string | null;
  collectedAt: string;
  confidence: number | null;
}

export interface FactPatch {
  valueJson?: unknown;
  observedAt?: string | null;
  confidence?: number | null;
}

export interface ProviderJobInsert {
  batchId: string;
  situationId: string;
  providerCode: string;
  requestJson: unknown;
  status: string;
  resultCount: number;
  errorJson: unknown | null;
  correlationId: string;
}

const SITUATION_COLUMNS = `situation_id, tenant_id, mode, title, hazard_type, status,
         occurred_at, location_text, current_snapshot_id, version_no,
         created_by, created_at, updated_at`;

const SITUATION_SELECT = `SELECT ${SITUATION_COLUMNS} FROM situation`;

/** situation_fact는 출처 없이는 화면에 낼 수 없다(설계 06 US-SIT-005 완료조건:
 * "후보마다 출처·시각·상태 누락 0건"). 그래서 항상 조인해서 읽는다. */
const FACT_SELECT = `
  SELECT f.fact_id, f.situation_id, f.fact_type, f.fact_key, f.value_json, f.source_id,
         f.observed_at, f.collected_at, f.confidence, f.status, f.version_no, f.updated_at,
         s.provider_code, s.source_type, s.source_name, s.source_uri, s.retrieved_at
  FROM situation_fact f
  JOIN fact_source s ON s.source_id = f.source_id`;

const PROVIDER_JOB_SELECT = `
  SELECT provider_job_id, batch_id, situation_id, provider_code, request_json,
         status, result_count, error_json, correlation_id, created_at, finished_at
  FROM provider_job`;

function toSituationRow(row: Record<string, unknown>): SituationRow {
  return {
    situationId: row.situation_id as string,
    tenantId: row.tenant_id as string,
    mode: row.mode as string,
    title: row.title as string,
    hazardType: row.hazard_type as string,
    status: row.status as string,
    occurredAt: (row.occurred_at as Date | null) ?? null,
    locationText: (row.location_text as string | null) ?? null,
    currentSnapshotId: (row.current_snapshot_id as string | null) ?? null,
    versionNo: row.version_no as number,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toFactRow(row: Record<string, unknown>): SituationFactRow {
  return {
    factId: row.fact_id as string,
    situationId: row.situation_id as string,
    factType: row.fact_type as string,
    factKey: row.fact_key as string,
    valueJson: row.value_json,
    sourceId: row.source_id as string,
    observedAt: (row.observed_at as Date | null) ?? null,
    collectedAt: row.collected_at as Date,
    confidence: (row.confidence as string | number | null) ?? null,
    status: row.status as string,
    versionNo: row.version_no as number,
    updatedAt: row.updated_at as Date,
    source: {
      sourceId: row.source_id as string,
      providerCode: row.provider_code as string,
      sourceType: row.source_type as string,
      sourceName: row.source_name as string,
      sourceUri: (row.source_uri as string | null) ?? null,
      retrievedAt: row.retrieved_at as Date,
    },
  };
}

function toProviderJobRow(row: Record<string, unknown>): ProviderJobRow {
  return {
    providerJobId: row.provider_job_id as string,
    batchId: row.batch_id as string,
    situationId: (row.situation_id as string | null) ?? null,
    providerCode: row.provider_code as string,
    requestJson: row.request_json,
    status: row.status as string,
    resultCount: row.result_count as number,
    errorJson: row.error_json ?? null,
    correlationId: row.correlation_id as string,
    createdAt: row.created_at as Date,
    finishedAt: row.finished_at as Date,
  };
}

/** LIKE 메타문자를 이스케이프해 키워드를 항상 리터럴로 만든다. */
function likePattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
}

@Injectable()
export class SituationRepository {
  // ── situation ────────────────────────────────────────────────────────────

  async insertSituation(
    client: PoolClient,
    tenantId: string,
    input: SituationCreateInput,
  ): Promise<SituationRow> {
    const result = await client.query(
      `INSERT INTO situation
         (tenant_id, mode, title, hazard_type, status, occurred_at, location_text, created_by)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5, $6, $7)
       RETURNING ${SITUATION_COLUMNS}`,
      [
        tenantId,
        input.mode,
        input.title,
        input.hazardType,
        input.occurredAt,
        input.locationText,
        input.createdBy,
      ],
    );
    return toSituationRow(result.rows[0]);
  }

  async findSituation(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<SituationRow | null> {
    const result = await client.query(
      `${SITUATION_SELECT}
       WHERE situation_id = $1 AND tenant_id = $2${options.forUpdate ? '\n       FOR UPDATE' : ''}`,
      [situationId, tenantId],
    );
    return result.rows[0] ? toSituationRow(result.rows[0]) : null;
  }

  async searchSituations(
    client: PoolClient,
    tenantId: string,
    query: SituationSearchQuery,
  ): Promise<{ items: SituationRow[]; totalElements: number }> {
    // 페이지가 끝을 넘어가도 총계는 참이어야 하므로 count를 따로 센다
    // (plan.repository의 review 필수-3과 같은 이유).
    const filterParams = [
      tenantId,
      query.keyword ? likePattern(query.keyword) : null,
      query.mode ?? null,
      query.status ?? null,
      query.hazardType ?? null,
    ];
    const filterSql = `
       WHERE tenant_id = $1
         AND ($2::text IS NULL OR title ILIKE $2)
         AND ($3::text IS NULL OR mode = $3)
         AND ($4::text IS NULL OR status = $4)
         AND ($5::text IS NULL OR hazard_type = $5)`;
    const count = await client.query(
      `SELECT count(*)::int AS total FROM situation${filterSql}`,
      filterParams,
    );
    const result = await client.query(
      `${SITUATION_SELECT}${filterSql}
       ORDER BY updated_at DESC, situation_id
       LIMIT $6 OFFSET $7`,
      [...filterParams, query.size, (query.page - 1) * query.size],
    );
    return {
      items: result.rows.map(toSituationRow),
      totalElements: Number(count.rows[0].total),
    };
  }

  /** 낙관적 동시성: If-Match 버전이 WHERE에 있고 rowCount 0이면 충돌이다.
   * `updated_at`은 0024의 트리거가 올린다 — 여기서 쓰지 않는다. */
  async updateSituationMeta(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    expectedVersion: number,
    patch: SituationMetaPatch,
  ): Promise<SituationRow | null> {
    // nullable 컬럼은 coalesce로 "미지정"과 "null로 지우기"를 구분할 수 없다.
    // 별도의 boolean 플래그로 그 둘을 가른다.
    const result = await client.query(
      `UPDATE situation
       SET title = coalesce($4, title),
           hazard_type = coalesce($5, hazard_type),
           occurred_at = CASE WHEN $6 THEN $7::timestamptz ELSE occurred_at END,
           location_text = CASE WHEN $8 THEN $9::text ELSE location_text END,
           version_no = version_no + 1
       WHERE situation_id = $1 AND tenant_id = $2 AND version_no = $3
       RETURNING ${SITUATION_COLUMNS}`,
      [
        situationId,
        tenantId,
        expectedVersion,
        patch.title ?? null,
        patch.hazardType ?? null,
        Object.prototype.hasOwnProperty.call(patch, 'occurredAt'),
        patch.occurredAt ?? null,
        Object.prototype.hasOwnProperty.call(patch, 'locationText'),
        patch.locationText ?? null,
      ],
    );
    return result.rows[0] ? toSituationRow(result.rows[0]) : null;
  }

  /** 첫 후보 Fact가 상황을 DRAFT → REGISTERED로 올린다(설계 06 US-SIT-003).
   * 상태 판정 자체는 도메인(`nextStatusOnFactRegistered`)이 하고 여기서는
   * 결정된 값을 기록만 한다 — DRAFT 조건을 WHERE에 둬 경합에서도 한 번만
   * 전이한다. version_no는 올리지 않는다: 사용자의 편집이 아니므로 진행 중인
   * If-Match 편집을 이 전이가 깨뜨리면 안 된다. */
  async advanceStatus(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    from: string,
    to: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE situation SET status = $4
       WHERE situation_id = $1 AND tenant_id = $2 AND status = $3`,
      [situationId, tenantId, from, to],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async countCandidateFacts(
    client: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<number> {
    const result = await client.query(
      `SELECT count(*)::int AS total
       FROM situation_fact f
       JOIN situation s ON s.situation_id = f.situation_id
       WHERE f.situation_id = $1 AND s.tenant_id = $2 AND f.status = 'CANDIDATE'`,
      [situationId, tenantId],
    );
    return Number(result.rows[0].total);
  }

  // ── fact_source / situation_fact ─────────────────────────────────────────

  async insertFactSource(
    client: PoolClient,
    tenantId: string,
    input: FactSourceInsert,
  ): Promise<FactSourceRow> {
    const result = await client.query(
      `INSERT INTO fact_source
         (tenant_id, provider_code, source_type, source_name, source_uri, retrieved_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING source_id, provider_code, source_type, source_name, source_uri, retrieved_at`,
      [
        tenantId,
        input.providerCode,
        input.sourceType,
        input.sourceName,
        input.sourceUri,
        input.retrievedAt,
      ],
    );
    const row = result.rows[0];
    return {
      sourceId: row.source_id as string,
      providerCode: row.provider_code as string,
      sourceType: row.source_type as string,
      sourceName: row.source_name as string,
      sourceUri: (row.source_uri as string | null) ?? null,
      retrievedAt: row.retrieved_at as Date,
    };
  }

  async insertFact(
    client: PoolClient,
    situationId: string,
    input: FactInsert,
  ): Promise<{ factId: string }> {
    const result = await client.query(
      `INSERT INTO situation_fact
         (situation_id, fact_type, fact_key, value_json, source_id,
          observed_at, collected_at, confidence, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CANDIDATE')
       RETURNING fact_id`,
      [
        situationId,
        input.factType,
        input.factKey,
        JSON.stringify(input.valueJson),
        input.sourceId,
        input.observedAt,
        input.collectedAt,
        input.confidence,
      ],
    );
    return { factId: result.rows[0].fact_id as string };
  }

  async findFact(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    factId: string,
  ): Promise<SituationFactRow | null> {
    const result = await client.query(
      `${FACT_SELECT}
       JOIN situation sit ON sit.situation_id = f.situation_id
       WHERE f.fact_id = $1 AND f.situation_id = $2 AND sit.tenant_id = $3`,
      [factId, situationId, tenantId],
    );
    return result.rows[0] ? toFactRow(result.rows[0]) : null;
  }

  async searchFacts(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    query: FactSearchQuery,
  ): Promise<{ items: SituationFactRow[]; totalElements: number }> {
    const filterParams = [situationId, tenantId, query.status ?? null, query.factType ?? null];
    const filterSql = `
       JOIN situation sit ON sit.situation_id = f.situation_id
       WHERE f.situation_id = $1 AND sit.tenant_id = $2
         AND ($3::text IS NULL OR f.status = $3)
         AND ($4::text IS NULL OR f.fact_type = $4)`;
    const count = await client.query(
      `SELECT count(*)::int AS total
       FROM situation_fact f
       JOIN fact_source s ON s.source_id = f.source_id${filterSql}`,
      filterParams,
    );
    const result = await client.query(
      `${FACT_SELECT}${filterSql}
       ORDER BY f.collected_at DESC, f.fact_id
       LIMIT $5 OFFSET $6`,
      [...filterParams, query.size, (query.page - 1) * query.size],
    );
    return {
      items: result.rows.map(toFactRow),
      totalElements: Number(count.rows[0].total),
    };
  }

  /** 보정(UNE-SIT-008). fact_type/fact_key/source_id는 건드리지 않는다 —
   * 그것을 바꾸면 보정이 아니라 다른 사실이다. */
  async updateFact(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    factId: string,
    expectedVersion: number,
    patch: FactPatch,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE situation_fact f
       SET value_json = coalesce($5::jsonb, f.value_json),
           observed_at = CASE WHEN $6 THEN $7::timestamptz ELSE f.observed_at END,
           confidence = CASE WHEN $8 THEN $9::numeric ELSE f.confidence END,
           version_no = f.version_no + 1
       FROM situation sit
       WHERE f.fact_id = $1 AND f.situation_id = $2 AND sit.situation_id = f.situation_id
         AND sit.tenant_id = $3 AND f.version_no = $4`,
      [
        factId,
        situationId,
        tenantId,
        expectedVersion,
        patch.valueJson === undefined ? null : JSON.stringify(patch.valueJson),
        Object.prototype.hasOwnProperty.call(patch, 'observedAt'),
        patch.observedAt ?? null,
        Object.prototype.hasOwnProperty.call(patch, 'confidence'),
        patch.confidence ?? null,
      ],
    );
    return (result.rowCount ?? 0) === 1;
  }

  // ── provider_job / provider_result ───────────────────────────────────────

  /** 동기 수집이라 행은 **종결된 채로 태어난다**(0023 §4). finished_at을
   * INSERT에서 채우는 이유가 그것이고, 상관식 CHECK가 상태와 증거의 짝을
   * 강제하므로 잘못 짝지어진 행은 여기서 23514로 떨어진다. */
  async insertProviderJob(
    client: PoolClient,
    tenantId: string,
    input: ProviderJobInsert,
  ): Promise<ProviderJobRow> {
    const result = await client.query(
      `INSERT INTO provider_job
         (tenant_id, batch_id, situation_id, provider_code, request_json,
          status, result_count, error_json, correlation_id, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       RETURNING provider_job_id, batch_id, situation_id, provider_code, request_json,
                 status, result_count, error_json, correlation_id, created_at, finished_at`,
      [
        tenantId,
        input.batchId,
        input.situationId,
        input.providerCode,
        JSON.stringify(input.requestJson),
        input.status,
        input.resultCount,
        input.errorJson === null ? null : JSON.stringify(input.errorJson),
        input.correlationId,
      ],
    );
    return toProviderJobRow(result.rows[0]);
  }

  async insertProviderResult(
    client: PoolClient,
    providerJobId: string,
    input: { seq: number; rawPayload: unknown; payloadSha256: string; itemCount: number },
  ): Promise<void> {
    await client.query(
      `INSERT INTO provider_result
         (provider_job_id, seq, raw_payload_json, payload_sha256, item_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        providerJobId,
        input.seq,
        JSON.stringify(input.rawPayload),
        input.payloadSha256,
        input.itemCount,
      ],
    );
  }

  async findProviderJob(
    client: PoolClient,
    tenantId: string,
    providerJobId: string,
  ): Promise<ProviderJobRow | null> {
    const result = await client.query(
      `${PROVIDER_JOB_SELECT}
       WHERE provider_job_id = $1 AND tenant_id = $2`,
      [providerJobId, tenantId],
    );
    return result.rows[0] ? toProviderJobRow(result.rows[0]) : null;
  }

  async findJobsByBatch(
    client: PoolClient,
    tenantId: string,
    batchId: string,
  ): Promise<ProviderJobRow[]> {
    const result = await client.query(
      `${PROVIDER_JOB_SELECT}
       WHERE batch_id = $1 AND tenant_id = $2
       ORDER BY provider_code`,
      [batchId, tenantId],
    );
    return result.rows.map(toProviderJobRow);
  }
}
