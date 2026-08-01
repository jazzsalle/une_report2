import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { FlatTocNode } from '@une/domain';

/** toc_version / toc_node reads/writes (UNE-PLAN-014, UNE-PLAN-015).
 * Neither table has tenant_id, so every query reaches them through the plan
 * aggregate (JOIN plan ... AND p.tenant_id = $n) — the ADR-21 compensating
 * control also used by plan_context_snapshot in plan.repository.ts. */

export interface TocVersionRow {
  tocVersionId: string;
  planId: string;
  versionNo: number;
  sourceType: string;
  baseSnapshotId: string;
  status: string;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
}

export interface TocNodeRow {
  tocNodeId: string;
  parentNodeId: string | null;
  nodeKey: string;
  title: string;
  level: number;
  sortOrder: number;
  generationPolicy: Record<string, unknown>;
}

export interface TocVersionInsert {
  planId: string;
  versionNo: number;
  sourceType: string;
  baseSnapshotId: string;
  status: string;
  contentHash: string;
  createdBy: string;
}

const VERSION_COLUMNS = `toc_version_id, plan_id, version_no, source_type, base_snapshot_id,
         status, content_hash, created_by, created_at`;
const VERSION_COLUMNS_V = `v.toc_version_id, v.plan_id, v.version_no, v.source_type,
         v.base_snapshot_id, v.status, v.content_hash, v.created_by, v.created_at`;

function toVersionRow(row: Record<string, unknown>): TocVersionRow {
  return {
    tocVersionId: row.toc_version_id as string,
    planId: row.plan_id as string,
    versionNo: Number(row.version_no),
    sourceType: row.source_type as string,
    baseSnapshotId: row.base_snapshot_id as string,
    status: row.status as string,
    contentHash: row.content_hash as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
  };
}

@Injectable()
export class TocVersionRepository {
  async findVersion(
    client: PoolClient,
    tenantId: string,
    planId: string,
    tocVersionId: string,
  ): Promise<TocVersionRow | null> {
    const result = await client.query(
      `SELECT ${VERSION_COLUMNS_V}
       FROM toc_version v
       JOIN plan p ON p.plan_id = v.plan_id AND p.tenant_id = $3
       WHERE v.toc_version_id = $2 AND v.plan_id = $1`,
      [planId, tocVersionId, tenantId],
    );
    return result.rows[0] ? toVersionRow(result.rows[0]) : null;
  }

  /** Whole version in one read: the caller rebuilds the tree from
   * parent_node_id, so no partial/paged access path is needed. Ordering by
   * (level, sort_order) guarantees parents precede their children. */
  async listNodes(
    client: PoolClient,
    tenantId: string,
    tocVersionId: string,
  ): Promise<TocNodeRow[]> {
    const result = await client.query(
      `SELECT n.toc_node_id, n.parent_node_id, n.node_key, n.title, n.level,
              n.sort_order, n.generation_policy
       FROM toc_node n
       JOIN toc_version v ON v.toc_version_id = n.toc_version_id
       JOIN plan p ON p.plan_id = v.plan_id AND p.tenant_id = $2
       WHERE n.toc_version_id = $1
       ORDER BY n.level, n.sort_order`,
      [tocVersionId, tenantId],
    );
    return result.rows.map((row) => ({
      tocNodeId: row.toc_node_id as string,
      parentNodeId: (row.parent_node_id as string | null) ?? null,
      nodeKey: row.node_key as string,
      title: row.title as string,
      level: Number(row.level),
      sortOrder: Number(row.sort_order),
      generationPolicy: (row.generation_policy as Record<string, unknown>) ?? {},
    }));
  }

  /** Caller must hold the plan row FOR UPDATE (uk_toc_version_plan_version). */
  async nextVersionNo(client: PoolClient, planId: string): Promise<number> {
    const result = await client.query(
      `SELECT coalesce(max(version_no), 0) + 1 AS next FROM toc_version WHERE plan_id = $1`,
      [planId],
    );
    return Number(result.rows[0].next);
  }

  async insertVersion(client: PoolClient, input: TocVersionInsert): Promise<TocVersionRow> {
    const result = await client.query(
      `INSERT INTO toc_version
         (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${VERSION_COLUMNS}`,
      [
        input.planId,
        input.versionNo,
        input.sourceType,
        input.baseSnapshotId,
        input.status,
        input.contentHash,
        input.createdBy,
      ],
    );
    return toVersionRow(result.rows[0]);
  }

  /**
   * Inserts a flattened tree in order. flattenTocTree emits parents before
   * children (depth-first), so the nodeKey -> generated uuid map always has the
   * parent resolved by the time a child row is written; fk_toc_node_parent
   * (0015) enforces that invariant in the database.
   */
  async insertNodes(
    client: PoolClient,
    tocVersionId: string,
    rows: readonly FlatTocNode[],
  ): Promise<Map<string, string>> {
    const idByKey = new Map<string, string>();
    for (const row of rows) {
      const parentId = row.parentKey === null ? null : (idByKey.get(row.parentKey) ?? null);
      if (row.parentKey !== null && parentId === null) {
        throw new Error(`toc_node parent not inserted before child: ${row.parentKey}`);
      }
      const result = await client.query(
        `INSERT INTO toc_node
           (toc_version_id, parent_node_id, node_key, title, level, sort_order, generation_policy)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING toc_node_id`,
        [
          tocVersionId,
          parentId,
          row.nodeKey,
          row.title,
          row.level,
          row.sortOrder,
          JSON.stringify(row.generationPolicy),
        ],
      );
      idByKey.set(row.nodeKey, result.rows[0].toc_node_id as string);
    }
    return idByKey;
  }

  /** UNE-PLAN-014 needs the base version's plan_id (tenant/plan match) and
   * base_snapshot_id (a user edit inherits the AI version's base snapshot). */
  async findVersionMeta(
    client: PoolClient,
    tenantId: string,
    tocVersionId: string,
  ): Promise<{ tocVersionId: string; planId: string; baseSnapshotId: string } | null> {
    const result = await client.query(
      `SELECT v.toc_version_id, v.plan_id, v.base_snapshot_id
       FROM toc_version v
       JOIN plan p ON p.plan_id = v.plan_id AND p.tenant_id = $2
       WHERE v.toc_version_id = $1`,
      [tocVersionId, tenantId],
    );
    const row = result.rows[0];
    return row
      ? {
          tocVersionId: row.toc_version_id as string,
          planId: row.plan_id as string,
          baseSnapshotId: row.base_snapshot_id as string,
        }
      : null;
  }
}
