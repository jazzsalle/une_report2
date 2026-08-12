import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { SopEdgeDraft, SopMappingWarning, SopNodeDraft } from '@une/domain';

/**
 * SOP 캔버스·검토·승인 저장소 (CC-250).
 *
 * 테넌트 격리는 RLS가 한다(0008 `sop`, 0032 자식 셋, 0035 검증·검토·승인).
 * 그래도 `sop` 조회에 `tenant_id`를 함께 거는 것은 방어의 두 번째 층이고,
 * 자식 테이블은 부모 조인으로 스코프가 정해진다.
 */

export interface SopRow {
  sopId: string;
  tenantId: string;
  situationId: string | null;
  title: string;
  hazardType: string;
  status: string;
  currentVersionId: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface SopVersionRow {
  sopVersionId: string;
  sopId: string;
  versionNo: number;
  status: string;
  graphHash: string;
  schemaVersion: string;
  sourceSnapshotId: string | null;
  sourceEvidenceSetId: string | null;
  graphViolations: string[] | null;
  adapterId: string | null;
  generatedByMock: boolean | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface SopNodeRow extends SopNodeDraft {
  warnings: SopMappingWarning[];
  position: { x: number; y: number } | null;
}

const SOP_COLUMNS = `sop_id, tenant_id, situation_id, title, hazard_type, status,
                     current_version_id, created_by, created_at`;

const VERSION_COLUMNS = `sop_version_id, sop_id, version_no, status, graph_hash, schema_version,
                         source_snapshot_id, source_evidence_set_id, graph_violations,
                         adapter_id, generated_by_mock, approved_by, approved_at, created_at`;

function toSop(row: Record<string, unknown>): SopRow {
  return {
    sopId: row.sop_id as string,
    tenantId: row.tenant_id as string,
    situationId: (row.situation_id as string | null) ?? null,
    title: row.title as string,
    hazardType: row.hazard_type as string,
    status: row.status as string,
    currentVersionId: (row.current_version_id as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
  };
}

function toVersion(row: Record<string, unknown>): SopVersionRow {
  return {
    sopVersionId: row.sop_version_id as string,
    sopId: row.sop_id as string,
    versionNo: Number(row.version_no),
    status: row.status as string,
    graphHash: row.graph_hash as string,
    schemaVersion: row.schema_version as string,
    sourceSnapshotId: (row.source_snapshot_id as string | null) ?? null,
    sourceEvidenceSetId: (row.source_evidence_set_id as string | null) ?? null,
    graphViolations: (row.graph_violations as string[] | null) ?? null,
    adapterId: (row.adapter_id as string | null) ?? null,
    generatedByMock: (row.generated_by_mock as boolean | null) ?? null,
    approvedBy: (row.approved_by as string | null) ?? null,
    approvedAt: (row.approved_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

@Injectable()
export class SopRepository {
  // ── sop ───────────────────────────────────────────────────────────────
  async insertSop(
    c: PoolClient,
    input: {
      tenantId: string;
      situationId: string | null;
      title: string;
      hazardType: string;
      createdBy: string;
    },
  ): Promise<SopRow> {
    const r = await c.query(
      `INSERT INTO sop (tenant_id, situation_id, title, hazard_type, status, created_by)
       VALUES ($1, $2, $3, $4, 'DRAFT', $5)
       RETURNING ${SOP_COLUMNS}`,
      [input.tenantId, input.situationId, input.title, input.hazardType, input.createdBy],
    );
    return toSop(r.rows[0]);
  }

  async findSop(
    c: PoolClient,
    tenantId: string,
    sopId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<SopRow | null> {
    const r = await c.query(
      `SELECT ${SOP_COLUMNS} FROM sop
        WHERE sop_id = $1 AND tenant_id = $2${opts.forUpdate ? '\n        FOR UPDATE' : ''}`,
      [sopId, tenantId],
    );
    return r.rows[0] ? toSop(r.rows[0]) : null;
  }

  async searchSops(
    c: PoolClient,
    tenantId: string,
    query: { status?: string; hazardType?: string; page: number; size: number },
  ): Promise<{ items: SopRow[]; totalElements: number }> {
    const filters = [tenantId, query.status ?? null, query.hazardType ?? null];
    const where = `
       WHERE tenant_id = $1
         AND ($2::text IS NULL OR status = $2)
         AND ($3::text IS NULL OR hazard_type = $3)`;
    // 페이지가 끝을 넘어가도 총계는 참이어야 하므로 따로 센다.
    const count = await c.query(`SELECT count(*)::int AS total FROM sop${where}`, filters);
    const rows = await c.query(
      `SELECT ${SOP_COLUMNS} FROM sop${where}
        ORDER BY created_at DESC, sop_id
        LIMIT $4 OFFSET $5`,
      [...filters, query.size, query.page * query.size],
    );
    return { items: rows.rows.map(toSop), totalElements: Number(count.rows[0].total) };
  }

  async updateSopStatus(
    c: PoolClient,
    tenantId: string,
    sopId: string,
    status: string,
  ): Promise<void> {
    await c.query(`UPDATE sop SET status = $3 WHERE sop_id = $1 AND tenant_id = $2`, [
      sopId,
      tenantId,
      status,
    ]);
  }

  async pointAtVersion(c: PoolClient, sopId: string, versionId: string): Promise<void> {
    await c.query(`UPDATE sop SET current_version_id = $2 WHERE sop_id = $1`, [sopId, versionId]);
  }

  // ── sop_version ───────────────────────────────────────────────────────
  async findVersion(
    c: PoolClient,
    sopId: string,
    versionId: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<SopVersionRow | null> {
    const r = await c.query(
      `SELECT ${VERSION_COLUMNS} FROM sop_version
        WHERE sop_version_id = $1 AND sop_id = $2${opts.forUpdate ? '\n        FOR UPDATE' : ''}`,
      [versionId, sopId],
    );
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }

  async nextVersionNo(c: PoolClient, sopId: string): Promise<number> {
    const r = await c.query(
      `SELECT coalesce(max(version_no), 0) + 1 AS next FROM sop_version WHERE sop_id = $1`,
      [sopId],
    );
    return Number(r.rows[0].next);
  }

  async insertVersion(
    c: PoolClient,
    input: {
      sopId: string;
      versionNo: number;
      graphHash: string;
      schemaVersion: string;
      sourceSnapshotId: string | null;
      sourceEvidenceSetId: string | null;
      violations: string[];
      createdBy: string;
    },
  ): Promise<SopVersionRow> {
    // `adapter_id`/`generated_by_mock`은 비운다 — 사람이 만든 버전이다.
    // 0034의 상관식이 "생성 잡이 만든 버전이면 반드시 있어야 한다"를 지킨다.
    const r = await c.query(
      `INSERT INTO sop_version
         (sop_id, version_no, status, graph_hash, source_snapshot_id, source_evidence_set_id,
          schema_version, graph_violations, created_by)
       VALUES ($1, $2, 'DRAFT', $3, $4, $5, $6, $7, $8)
       RETURNING ${VERSION_COLUMNS}`,
      [
        input.sopId,
        input.versionNo,
        input.graphHash,
        input.sourceSnapshotId,
        input.sourceEvidenceSetId,
        input.schemaVersion,
        JSON.stringify(input.violations),
        input.createdBy,
      ],
    );
    return toVersion(r.rows[0]);
  }

  /** 승인: 버전을 LOCKED로 고정한다. 이 UPDATE 뒤로는 트리거가 막는다. */
  async lockVersion(
    c: PoolClient,
    versionId: string,
    approvedBy: string,
  ): Promise<SopVersionRow | null> {
    const r = await c.query(
      `UPDATE sop_version
          SET status = 'LOCKED', approved_by = $2, approved_at = now()
        WHERE sop_version_id = $1 AND status = 'DRAFT'
        RETURNING ${VERSION_COLUMNS}`,
      [versionId, approvedBy],
    );
    return r.rows[0] ? toVersion(r.rows[0]) : null;
  }

  // ── 그래프 ─────────────────────────────────────────────────────────────
  async findGraph(
    c: PoolClient,
    versionId: string,
  ): Promise<{ nodes: SopNodeRow[]; edges: SopEdgeDraft[] }> {
    const nodes = await c.query(
      `SELECT node_key, node_type, title, config_json, sort_order, mapping_warnings,
              position_x, position_y
         FROM sop_node WHERE sop_version_id = $1 ORDER BY sort_order, node_key`,
      [versionId],
    );
    const edges = await c.query(
      `SELECT f.node_key AS from_key, t.node_key AS to_key, e.condition_expr, e.label, e.priority
         FROM sop_edge e
         JOIN sop_node f ON f.node_id = e.from_node_id
         JOIN sop_node t ON t.node_id = e.to_node_id
        WHERE e.sop_version_id = $1
        ORDER BY e.priority, f.node_key, t.node_key`,
      [versionId],
    );
    return {
      nodes: nodes.rows.map((row, index) => {
        const config = (row.config_json ?? {}) as {
          tasks?: SopNodeDraft['tasks'];
          decisionExpression?: string | null;
          sourceRefs?: string[];
          providerNodeKey?: string;
        };
        return {
          nodeKey: row.node_key as string,
          providerNodeKey: config.providerNodeKey ?? (row.node_key as string),
          type: row.node_type as SopNodeDraft['type'],
          title: row.title as string,
          sequence: (row.sort_order as number | null) ?? index + 1,
          tasks: config.tasks ?? [],
          decisionExpression: config.decisionExpression ?? null,
          sourceRefs: config.sourceRefs ?? [],
          warnings: ((row.mapping_warnings as SopMappingWarning[] | null) ??
            []) as SopMappingWarning[],
          position:
            row.position_x === null || row.position_y === null
              ? null
              : { x: Number(row.position_x), y: Number(row.position_y) },
        };
      }),
      edges: edges.rows.map((row) => ({
        fromNodeKey: row.from_key as string,
        toNodeKey: row.to_key as string,
        conditionExpr: (row.condition_expr as string | null) ?? null,
        label: (row.label as string | null) ?? null,
        priority: Number(row.priority),
      })),
    };
  }

  /**
   * 노드·간선을 적재한다.
   *
   * 간선은 노드 **키**로 오고 DB는 **id**로 잇는다 — 그 변환을 한곳에 둔다
   * (워커 러너와 같은 이유이고 같은 형태다).
   */
  async insertGraph(
    c: PoolClient,
    versionId: string,
    nodes: ReadonlyArray<SopNodeRow>,
    edges: ReadonlyArray<SopEdgeDraft>,
  ): Promise<void> {
    const ids = new Map<string, string>();
    let sortOrder = 0;
    for (const node of nodes) {
      sortOrder += 1;
      const r = await c.query(
        `INSERT INTO sop_node
           (sop_version_id, node_key, node_type, title, config_json, sort_order,
            mapping_warnings, position_x, position_y)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING node_id`,
        [
          versionId,
          node.nodeKey,
          node.type,
          node.title,
          JSON.stringify({
            providerNodeKey: node.providerNodeKey,
            tasks: node.tasks,
            decisionExpression: node.decisionExpression,
            sourceRefs: node.sourceRefs,
          }),
          sortOrder,
          JSON.stringify(node.warnings),
          node.position?.x ?? null,
          node.position?.y ?? null,
        ],
      );
      ids.set(node.nodeKey, r.rows[0].node_id as string);
    }
    for (const edge of edges) {
      const from = ids.get(edge.fromNodeKey);
      const to = ids.get(edge.toNodeKey);
      if (!from || !to) {
        // 여기 도달하면 서비스의 사전 검증이 샌 것이다. 조용히 버리면 저장된
        // 그래프와 검증 결과가 달라진다.
        throw new Error(
          `간선이 존재하지 않는 노드를 가리킵니다: ${edge.fromNodeKey}->${edge.toNodeKey}`,
        );
      }
      await c.query(
        `INSERT INTO sop_edge (sop_version_id, from_node_id, to_node_id, condition_expr, priority, label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [versionId, from, to, edge.conditionExpr, edge.priority, edge.label],
      );
    }
  }

  // ── 검증 ──────────────────────────────────────────────────────────────
  async insertValidation(
    c: PoolClient,
    input: {
      sopVersionId: string;
      status: string;
      errors: unknown[];
      warnings: unknown[];
      validatorVersion: string;
      validatedBy: string;
    },
  ): Promise<{ validationId: string; validatedAt: Date }> {
    const r = await c.query(
      `INSERT INTO sop_validation
         (sop_version_id, status, errors_json, warnings_json, validator_version,
          validated_by, validated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       RETURNING validation_id, validated_at`,
      [
        input.sopVersionId,
        input.status,
        JSON.stringify(input.errors),
        JSON.stringify(input.warnings),
        input.validatorVersion,
        input.validatedBy,
      ],
    );
    return { validationId: r.rows[0].validation_id as string, validatedAt: r.rows[0].validated_at };
  }

  /** 승인 게이트가 보는 것은 **가장 최근 검증**이다. */
  async findLatestValidation(
    c: PoolClient,
    versionId: string,
  ): Promise<{ status: string; validatorVersion: string; validatedAt: Date } | null> {
    const r = await c.query(
      `SELECT status, validator_version, validated_at FROM sop_validation
        WHERE sop_version_id = $1 ORDER BY validated_at DESC LIMIT 1`,
      [versionId],
    );
    const row = r.rows[0];
    return row
      ? {
          status: row.status as string,
          validatorVersion: row.validator_version as string,
          validatedAt: row.validated_at as Date,
        }
      : null;
  }

  // ── 검토 요청 ─────────────────────────────────────────────────────────
  async findOpenReview(
    c: PoolClient,
    versionId: string,
  ): Promise<{ reviewRequestId: string } | null> {
    const r = await c.query(
      `SELECT review_request_id FROM sop_review_request
        WHERE sop_version_id = $1 AND status = 'REQUESTED'`,
      [versionId],
    );
    return r.rows[0] ? { reviewRequestId: r.rows[0].review_request_id as string } : null;
  }

  async insertReviewRequest(
    c: PoolClient,
    input: {
      sopId: string;
      sopVersionId: string;
      reviewers: string[];
      message: string | null;
      requestedBy: string;
    },
  ): Promise<{
    reviewRequestId: string;
    requestedAt: Date;
  }> {
    const r = await c.query(
      `INSERT INTO sop_review_request
         (sop_id, sop_version_id, status, reviewer_ids, message, requested_by)
       VALUES ($1, $2, 'REQUESTED', $3::uuid[], $4, $5)
       RETURNING review_request_id, requested_at`,
      [input.sopId, input.sopVersionId, input.reviewers, input.message, input.requestedBy],
    );
    return {
      reviewRequestId: r.rows[0].review_request_id as string,
      requestedAt: r.rows[0].requested_at as Date,
    };
  }

  async resolveReviewRequest(c: PoolClient, versionId: string): Promise<string | null> {
    const r = await c.query(
      `UPDATE sop_review_request
          SET status = 'APPROVED', resolved_at = now()
        WHERE sop_version_id = $1 AND status = 'REQUESTED'
        RETURNING review_request_id`,
      [versionId],
    );
    return r.rows[0] ? (r.rows[0].review_request_id as string) : null;
  }

  // ── 승인 ──────────────────────────────────────────────────────────────
  async insertApproval(
    c: PoolClient,
    input: {
      sopId: string;
      sopVersionId: string;
      reviewRequestId: string | null;
      approvedBy: string;
      comment: string | null;
      graphHash: string;
    },
  ): Promise<string> {
    const r = await c.query(
      `INSERT INTO sop_approval
         (sop_id, sop_version_id, review_request_id, approved_by, comment, graph_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING approval_id`,
      [
        input.sopId,
        input.sopVersionId,
        input.reviewRequestId,
        input.approvedBy,
        input.comment,
        input.graphHash,
      ],
    );
    return r.rows[0].approval_id as string;
  }
}
