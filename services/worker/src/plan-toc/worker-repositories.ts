import type { PoolClient } from 'pg';
import type { FlatTocNode } from '@une/domain';

/** TOC-pipeline-specific raw-SQL repositories (CC-130 slimmed: shared
 * dispatch primitives moved to plan-jobs/job-dispatch.repository — ADR-27
 * D1). Since 0016 these tables carry EXISTS-parent FORCE RLS, so the
 * helpers only work inside a tenant-scoped transaction; WRITE helpers still
 * take only ids that came out of a tenant-verified FOR UPDATE row (defense
 * in depth, review minor 8). */

export async function nextTocVersionNo(client: PoolClient, planId: string): Promise<number> {
  const result = await client.query(
    `SELECT coalesce(max(version_no), 0) + 1 AS next FROM toc_version WHERE plan_id = $1`,
    [planId],
  );
  return Number(result.rows[0].next);
}

export async function insertTocVersion(
  client: PoolClient,
  input: {
    planId: string;
    versionNo: number;
    baseSnapshotId: string;
    contentHash: string;
    createdBy: string;
  },
): Promise<string> {
  const result = await client.query(
    `INSERT INTO toc_version
       (plan_id, version_no, source_type, base_snapshot_id, status, content_hash, created_by)
     VALUES ($1, $2, 'AI', $3, 'DRAFT', $4, $5)
     RETURNING toc_version_id`,
    [input.planId, input.versionNo, input.baseSnapshotId, input.contentHash, input.createdBy],
  );
  return result.rows[0].toc_version_id as string;
}

/** flatten order guarantees parents precede children. */
export async function insertTocNodes(
  client: PoolClient,
  tocVersionId: string,
  rows: readonly FlatTocNode[],
): Promise<void> {
  const idsByKey = new Map<string, string>();
  for (const row of rows) {
    const parentId = row.parentKey ? (idsByKey.get(row.parentKey) ?? null) : null;
    const result = await client.query(
      `INSERT INTO toc_node
         (toc_version_id, parent_node_id, node_key, title, level, sort_order, generation_policy)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
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
    idsByKey.set(row.nodeKey, result.rows[0].toc_node_id as string);
  }
}
