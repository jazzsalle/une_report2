import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/** 중복군·충돌·해소·Snapshot 저장소 (CC-210).
 *
 * CC-200의 `SituationRepository`와 같은 규칙을 따른다 — `withTenant` 안에서
 * 돌고, **그 위에 부모(situation) 경유 술어를 또 둔다.** 이 테이블들에는
 * tenant_id 컬럼이 없고 0023 §6/0025 §1의 정책이 부모를 거쳐 증명한다.
 */

export interface DuplicateGroupRow {
  groupId: string;
  situationId: string;
  factKey: string;
  groupKey: string;
  strategy: string;
  threshold: string | number | null;
  memberFactIds: string[];
  memberCount: number;
  computedAt: Date;
  computedBy: string;
}

export interface ConflictRow {
  conflictId: string;
  situationId: string;
  groupKey: string | null;
  factKey: string;
  candidateFactIds: string[];
  conflictType: string;
  status: string;
  detectedAt: Date;
}

export interface ConflictResolutionRow {
  resolutionId: string;
  conflictId: string;
  selectedFactId: string;
  reason: string;
  resolvedBy: string;
  resolvedAt: Date;
}

export interface SnapshotRow {
  snapshotId: string;
  situationId: string;
  versionNo: number;
  factsJson: unknown;
  contentHash: string;
  effectiveAt: Date;
  supersedesId: string | null;
  confirmedBy: string;
  confirmedAt: Date;
}

/** 그룹화·판정의 입력이 되는 Fact 투영. 도메인 `FactForGrouping`과 같은 모양. */
export interface FactForGroupingRow {
  factId: string;
  factKey: string;
  factType: string;
  valueJson: unknown;
  observedAt: Date | null;
  collectedAt: Date;
  providerCode: string;
  sourceId: string;
  status: string;
}

const CONFLICT_SELECT = `
  SELECT conflict_id, situation_id, group_key, fact_key, candidate_fact_ids,
         conflict_type, status, detected_at
  FROM fact_conflict`;

const SNAPSHOT_SELECT = `
  SELECT snapshot_id, situation_id, version_no, facts_json, content_hash,
         effective_at, supersedes_id, confirmed_by, confirmed_at
  FROM situation_snapshot`;

function toGroupRow(row: Record<string, unknown>): DuplicateGroupRow {
  return {
    groupId: row.group_id as string,
    situationId: row.situation_id as string,
    factKey: row.fact_key as string,
    groupKey: row.group_key as string,
    strategy: row.strategy as string,
    threshold: (row.threshold as string | number | null) ?? null,
    memberFactIds: row.member_fact_ids as string[],
    memberCount: row.member_count as number,
    computedAt: row.computed_at as Date,
    computedBy: row.computed_by as string,
  };
}

function toConflictRow(row: Record<string, unknown>): ConflictRow {
  return {
    conflictId: row.conflict_id as string,
    situationId: row.situation_id as string,
    groupKey: (row.group_key as string | null) ?? null,
    factKey: row.fact_key as string,
    candidateFactIds: row.candidate_fact_ids as string[],
    conflictType: row.conflict_type as string,
    status: row.status as string,
    detectedAt: row.detected_at as Date,
  };
}

function toSnapshotRow(row: Record<string, unknown>): SnapshotRow {
  return {
    snapshotId: row.snapshot_id as string,
    situationId: row.situation_id as string,
    versionNo: row.version_no as number,
    factsJson: row.facts_json,
    contentHash: row.content_hash as string,
    effectiveAt: row.effective_at as Date,
    supersedesId: (row.supersedes_id as string | null) ?? null,
    confirmedBy: row.confirmed_by as string,
    confirmedAt: row.confirmed_at as Date,
  };
}

@Injectable()
export class ResolutionRepository {
  // ── 그룹화 입력 ──────────────────────────────────────────────────────────

  /** 그룹화·판정의 대상. 출처를 조인해 providerCode를 함께 준다 — 판정 근거
   * 문구가 "어느 기관이 무엇을 보냈는가"를 말해야 하기 때문이다. */
  async listFactsForGrouping(
    client: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<FactForGroupingRow[]> {
    const result = await client.query(
      `SELECT f.fact_id, f.fact_key, f.fact_type, f.value_json, f.observed_at,
              f.collected_at, f.source_id, f.status, s.provider_code
       FROM situation_fact f
       JOIN fact_source s ON s.source_id = f.source_id
       JOIN situation sit ON sit.situation_id = f.situation_id
       WHERE f.situation_id = $1 AND sit.tenant_id = $2
       ORDER BY f.fact_id`,
      [situationId, tenantId],
    );
    return result.rows.map((row) => ({
      factId: row.fact_id as string,
      factKey: row.fact_key as string,
      factType: row.fact_type as string,
      valueJson: row.value_json,
      observedAt: (row.observed_at as Date | null) ?? null,
      collectedAt: row.collected_at as Date,
      providerCode: row.provider_code as string,
      sourceId: row.source_id as string,
      status: row.status as string,
    }));
  }

  // ── fact_duplicate_group ─────────────────────────────────────────────────

  /** 재계산은 이전 결과를 **지우고** 다시 넣는다(0025 §1). 그룹은 계산 결과이지
   * 증거가 아니므로 DELETE 권한이 열려 있다. */
  async deleteGroups(client: PoolClient, tenantId: string, situationId: string): Promise<number> {
    const result = await client.query(
      `DELETE FROM fact_duplicate_group g
       USING situation sit
       WHERE g.situation_id = $1 AND sit.situation_id = g.situation_id AND sit.tenant_id = $2`,
      [situationId, tenantId],
    );
    return result.rowCount ?? 0;
  }

  async insertGroup(
    client: PoolClient,
    situationId: string,
    input: {
      factKey: string;
      groupKey: string;
      strategy: string;
      threshold: number | null;
      memberFactIds: string[];
      computedBy: string;
    },
  ): Promise<DuplicateGroupRow> {
    const result = await client.query(
      `INSERT INTO fact_duplicate_group
         (situation_id, fact_key, group_key, strategy, threshold,
          member_fact_ids, member_count, computed_by)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7, $8)
       RETURNING group_id, situation_id, fact_key, group_key, strategy, threshold,
                 member_fact_ids, member_count, computed_at, computed_by`,
      [
        situationId,
        input.factKey,
        input.groupKey,
        input.strategy,
        input.threshold,
        input.memberFactIds,
        input.memberFactIds.length,
        input.computedBy,
      ],
    );
    return toGroupRow(result.rows[0]);
  }

  // ── fact_conflict ────────────────────────────────────────────────────────

  /**
   * 같은 자리를 다시 열지 않는다.
   *
   * 두 겹이다.
   *   (1) OPEN 중복 — 0025 §4의 부분 유니크가 막는다(`ON CONFLICT DO NOTHING`).
   *   (2) **이미 해소된 같은 후보 집합** — 아래 `NOT EXISTS`가 막는다.
   *
   * (2)가 없으면 사용자가 충돌을 해소한 뒤 "중복군 다시 계산"을 누르는 순간
   * 같은 충돌이 OPEN으로 되살아난다(부분 유니크는 OPEN에만 걸리므로 통과한다).
   * 그러면 해소는 지워지지 않았는데도 **판단이 없던 일이 되고**, 확정은 다시
   * 막힌다. e2e가 실제로 그 상태를 밟아 드러났다.
   *
   * 후보 집합이 **달라지면** 새 충돌을 연다 — 새 값이 도착해 다시 어긋난
   * 것이므로 그때는 사람이 다시 판단해야 한다. `candidate_fact_ids`는 도메인이
   * 정렬해 넘기므로 배열 비교가 결정적이다.
   */
  async insertConflictIfAbsent(
    client: PoolClient,
    situationId: string,
    input: {
      groupKey: string;
      factKey: string;
      conflictType: string;
      candidateFactIds: string[];
    },
  ): Promise<ConflictRow | null> {
    const result = await client.query(
      `INSERT INTO fact_conflict
         (situation_id, group_key, fact_key, candidate_fact_ids, conflict_type,
          status, detected_at)
       -- 같은 파라미터가 INSERT 대상과 비교식 양쪽에 쓰이므로 타입을 명시한다.
       -- 없으면 플래너가 "inconsistent types deduced for parameter"로 거부한다.
       SELECT $1::uuid, $2::text, $3::varchar, $4::uuid[], $5::varchar, 'OPEN', now()
       WHERE NOT EXISTS (
         SELECT 1 FROM fact_conflict prior
         WHERE prior.situation_id = $1::uuid
           AND prior.group_key = $2::text
           AND prior.candidate_fact_ids = $4::uuid[]
       )
       RETURNING conflict_id, situation_id, group_key, fact_key, candidate_fact_ids,
                 conflict_type, status, detected_at`,
      [situationId, input.groupKey, input.factKey, input.candidateFactIds, input.conflictType],
    );
    // `ON CONFLICT DO NOTHING`을 쓰지 않는다. 그러면 유니크 위반이 조용히
    // 삼켜져 "탐지했는데 기록하지 않았다"가 관측 불가능해진다(아키텍처 리뷰
    // B-1). 선행 충돌 검사는 위 NOT EXISTS가 하고, 그래도 유니크에 걸리면
    // 그것은 우리가 모르는 상태이므로 예외로 올라와야 한다.
    return result.rows[0] ? toConflictRow(result.rows[0]) : null;
  }

  /** 재계산에서 사라진 OPEN 충돌을 닫는다(0025 §4의 `OBSOLETE`).
   *
   * 보정으로 값이 같아지면 그 충돌은 더 이상 존재하지 않는다. OPEN으로 두면
   * 확정이 영구 차단되고(아키텍처 리뷰 M-3), RESOLVED로 적으면 사용자가 하지
   * 않은 선택을 기록하게 된다. 이번 계산이 만든 group_key 목록에 없는 OPEN
   * 충돌만 닫는다. */
  async markConflictsObsolete(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    liveGroupKeys: readonly string[],
  ): Promise<string[]> {
    const result = await client.query(
      `UPDATE fact_conflict c
       SET status = 'OBSOLETE'
       FROM situation s
       WHERE c.situation_id = $1 AND s.situation_id = c.situation_id AND s.tenant_id = $2
         AND c.status = 'OPEN'
         AND NOT (c.group_key = ANY($3::text[]))
       RETURNING c.conflict_id`,
      [situationId, tenantId, [...liveGroupKeys]],
    );
    return result.rows.map((r) => r.conflict_id as string);
  }

  /** 요청된 id만 읽는다.
   *
   * 확정이 `page 1 / size 1000`으로 전수를 읽고 있었다. 1000건을 넘는 상황에서
   * 그 뒤의 Fact를 확정하려 하면 "이 상황의 Fact가 아닙니다"로 412가 나고
   * 사용자는 복구할 수 없다 — 실제 원인은 페이징이다(아키텍처 리뷰 M-10). */
  async listFactsByIds(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    factIds: readonly string[],
  ): Promise<FactForGroupingRow[]> {
    if (factIds.length === 0) return [];
    const result = await client.query(
      `SELECT f.fact_id, f.fact_key, f.fact_type, f.value_json, f.observed_at,
              f.collected_at, f.source_id, f.status, s.provider_code
       FROM situation_fact f
       JOIN fact_source s ON s.source_id = f.source_id
       JOIN situation sit ON sit.situation_id = f.situation_id
       WHERE f.fact_id = ANY($1::uuid[]) AND f.situation_id = $2 AND sit.tenant_id = $3`,
      [[...factIds], situationId, tenantId],
    );
    return result.rows.map((row) => ({
      factId: row.fact_id as string,
      factKey: row.fact_key as string,
      factType: row.fact_type as string,
      valueJson: row.value_json,
      observedAt: (row.observed_at as Date | null) ?? null,
      collectedAt: row.collected_at as Date,
      providerCode: row.provider_code as string,
      sourceId: row.source_id as string,
      status: row.status as string,
    }));
  }

  async listConflicts(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    status?: string,
  ): Promise<ConflictRow[]> {
    const result = await client.query(
      `${CONFLICT_SELECT}
       WHERE situation_id = $1
         AND ($3::text IS NULL OR status = $3)
         AND EXISTS (SELECT 1 FROM situation s
                     WHERE s.situation_id = fact_conflict.situation_id
                       AND s.tenant_id = $2)
       ORDER BY detected_at DESC, conflict_id`,
      [situationId, tenantId, status ?? null],
    );
    return result.rows.map(toConflictRow);
  }

  async findConflict(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    conflictId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<ConflictRow | null> {
    const result = await client.query(
      `${CONFLICT_SELECT}
       WHERE conflict_id = $1 AND situation_id = $2
         AND EXISTS (SELECT 1 FROM situation s
                     WHERE s.situation_id = fact_conflict.situation_id
                       AND s.tenant_id = $3)${options.forUpdate ? '\n       FOR UPDATE' : ''}`,
      [conflictId, situationId, tenantId],
    );
    return result.rows[0] ? toConflictRow(result.rows[0]) : null;
  }

  async countOpenConflicts(
    client: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<number> {
    const result = await client.query(
      `SELECT count(*)::int AS total
       FROM fact_conflict c
       JOIN situation s ON s.situation_id = c.situation_id
       WHERE c.situation_id = $1 AND s.tenant_id = $2 AND c.status = 'OPEN'`,
      [situationId, tenantId],
    );
    return Number(result.rows[0].total);
  }

  /** OPEN → RESOLVED. WHERE에 status를 두어 경합에서도 한 번만 전이한다. */
  async markConflictResolved(client: PoolClient, conflictId: string): Promise<boolean> {
    const result = await client.query(
      `UPDATE fact_conflict SET status = 'RESOLVED'
       WHERE conflict_id = $1 AND status = 'OPEN'`,
      [conflictId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  // ── conflict_resolution ──────────────────────────────────────────────────

  async insertResolution(
    client: PoolClient,
    input: {
      conflictId: string;
      selectedFactId: string;
      reason: string;
      resolvedBy: string;
    },
  ): Promise<ConflictResolutionRow> {
    const result = await client.query(
      `INSERT INTO conflict_resolution (conflict_id, selected_fact_id, reason, resolved_by)
       VALUES ($1, $2, $3, $4)
       RETURNING resolution_id, conflict_id, selected_fact_id, reason, resolved_by, resolved_at`,
      [input.conflictId, input.selectedFactId, input.reason, input.resolvedBy],
    );
    const row = result.rows[0];
    return {
      resolutionId: row.resolution_id as string,
      conflictId: row.conflict_id as string,
      selectedFactId: row.selected_fact_id as string,
      reason: row.reason as string,
      resolvedBy: row.resolved_by as string,
      resolvedAt: row.resolved_at as Date,
    };
  }

  // ── situation_snapshot ───────────────────────────────────────────────────

  async latestSnapshotVersion(
    client: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<{ versionNo: number; snapshotId: string } | null> {
    const result = await client.query(
      `SELECT snapshot_id, version_no
       FROM situation_snapshot sn
       WHERE sn.situation_id = $1
         AND EXISTS (SELECT 1 FROM situation s
                     WHERE s.situation_id = sn.situation_id AND s.tenant_id = $2)
       ORDER BY version_no DESC
       LIMIT 1`,
      [situationId, tenantId],
    );
    return result.rows[0]
      ? {
          versionNo: result.rows[0].version_no as number,
          snapshotId: result.rows[0].snapshot_id as string,
        }
      : null;
  }

  async insertSnapshot(
    client: PoolClient,
    situationId: string,
    input: {
      versionNo: number;
      factsJson: unknown;
      contentHash: string;
      effectiveAt: string;
      supersedesId: string | null;
      confirmedBy: string;
    },
  ): Promise<SnapshotRow> {
    const result = await client.query(
      `INSERT INTO situation_snapshot
         (situation_id, version_no, facts_json, content_hash, effective_at,
          supersedes_id, confirmed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING snapshot_id, situation_id, version_no, facts_json, content_hash,
                 effective_at, supersedes_id, confirmed_by, confirmed_at`,
      [
        situationId,
        input.versionNo,
        JSON.stringify(input.factsJson),
        input.contentHash,
        input.effectiveAt,
        input.supersedesId,
        input.confirmedBy,
      ],
    );
    return toSnapshotRow(result.rows[0]);
  }

  async listSnapshots(
    client: PoolClient,
    tenantId: string,
    situationId: string,
  ): Promise<SnapshotRow[]> {
    const result = await client.query(
      `${SNAPSHOT_SELECT}
       WHERE situation_id = $1
         AND EXISTS (SELECT 1 FROM situation s
                     WHERE s.situation_id = situation_snapshot.situation_id
                       AND s.tenant_id = $2)
       ORDER BY version_no DESC`,
      [situationId, tenantId],
    );
    return result.rows.map(toSnapshotRow);
  }

  /** 확정이 상황의 현재 Snapshot 포인터를 옮긴다. 기존 Snapshot은 그대로
   * 남는다(설계 06 US-SIT-008 #5 "기존 Snapshot 보존"). */
  async setCurrentSnapshot(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    snapshotId: string,
    nextStatus: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE situation
       SET current_snapshot_id = $3, status = $4
       WHERE situation_id = $1 AND tenant_id = $2`,
      [situationId, tenantId, snapshotId, nextStatus],
    );
    return (result.rowCount ?? 0) === 1;
  }

  /** 확정된 Fact를 CONFIRMED로 올린다. 반환값(갱신 행수)을 **호출부가
   * 검사한다** — 동시 보정이 먼저 커밋하면 0행이고, 그때 조용히 넘기면
   * Snapshot 사본·원천·파생 셋이 서로 다른 말을 한다(아키텍처 리뷰 M-6).
   * Snapshot이 자기 사본을 갖지만
   * (`facts_json`), 후보 목록 화면이 "이미 확정된 사실"을 구분할 수 있어야 한다. */
  async markFactsConfirmed(
    client: PoolClient,
    tenantId: string,
    situationId: string,
    factIds: readonly string[],
  ): Promise<number> {
    if (factIds.length === 0) return 0;
    const result = await client.query(
      `UPDATE situation_fact f
       SET status = 'CONFIRMED'
       FROM situation sit
       WHERE f.fact_id = ANY($1::uuid[]) AND f.situation_id = $2
         AND sit.situation_id = f.situation_id AND sit.tenant_id = $3
         AND f.status = 'CANDIDATE'`,
      [[...factIds], situationId, tenantId],
    );
    return result.rowCount ?? 0;
  }
}
