import type { PoolClient } from 'pg';
import type { TocNodeDraft } from '@une/domain';

/** CONTENT-pipeline repositories (CC-130, ADR-27). All helpers require a
 * tenant-scoped transaction (generated_block/toc_* carry EXISTS-parent
 * FORCE RLS since 0016/0017); ids must come from tenant-verified rows. */

export interface TocVersionWithTree {
  tocVersionId: string;
  contentHash: string;
  tree: TocNodeDraft[];
}

export async function findTocVersionWithNodes(
  client: PoolClient,
  planId: string,
  tocVersionId: string,
): Promise<TocVersionWithTree | null> {
  const version = await client.query(
    `SELECT toc_version_id, content_hash FROM toc_version
     WHERE toc_version_id = $1 AND plan_id = $2`,
    [tocVersionId, planId],
  );
  const versionRow = version.rows[0];
  if (!versionRow) return null;
  // sort_order is the SIBLING index (flattenTocTree), not a global order —
  // level must lead so parents are scanned before their children (the
  // rebuild below links by parent id) and siblings stay in sort_order.
  const nodes = await client.query(
    `SELECT toc_node_id, parent_node_id, node_key, title, level, sort_order
     FROM toc_node WHERE toc_version_id = $1 ORDER BY level, sort_order`,
    [tocVersionId],
  );
  interface MutableNode extends TocNodeDraft {
    children: MutableNode[];
  }
  const byId = new Map<string, MutableNode>();
  const roots: MutableNode[] = [];
  for (const row of nodes.rows) {
    const node: MutableNode = {
      nodeKey: row.node_key as string,
      title: row.title as string,
      children: [],
    };
    byId.set(row.toc_node_id as string, node);
    const parentId = row.parent_node_id as string | null;
    if (parentId && byId.has(parentId)) byId.get(parentId)?.children.push(node);
    else roots.push(node);
  }
  return {
    tocVersionId: versionRow.toc_version_id as string,
    contentHash: versionRow.content_hash as string,
    tree: roots,
  };
}

export interface CurrentBlockRow {
  blockId: string;
  nodeKey: string;
  protectionState: string;
  generationNo: number;
  /** Carried on PRESERVED content.block frames (contract: PRESERVED keeps
   * the EXISTING block's id/hash — review M-4/F3). */
  contentHash: string;
  citationCount: number;
}

/** Current (non-superseded) blocks, locked for the result transaction. */
export async function listCurrentBlocksForUpdate(
  client: PoolClient,
  planId: string,
): Promise<CurrentBlockRow[]> {
  const result = await client.query(
    `SELECT block_id, node_key, protection_state, generation_no, content_hash, citation_count
     FROM generated_block
     WHERE plan_id = $1 AND superseded_at IS NULL
     FOR UPDATE`,
    [planId],
  );
  return result.rows.map((row) => ({
    blockId: row.block_id as string,
    nodeKey: row.node_key as string,
    protectionState: row.protection_state as string,
    generationNo: row.generation_no as number,
    contentHash: row.content_hash as string,
    citationCount: row.citation_count as number,
  }));
}

export async function hasCurrentBlocks(client: PoolClient, planId: string): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM generated_block WHERE plan_id = $1 AND superseded_at IS NULL LIMIT 1`,
    [planId],
  );
  return result.rows.length > 0;
}

/** Next generation for a node across ALL rows (not just the current one):
 * a supersede without a successor (node removed from the outline) must not
 * let a later generation reuse an old generation_no (review m-8). */
export async function nextGenerationNo(
  client: PoolClient,
  planId: string,
  nodeKey: string,
): Promise<number> {
  const result = await client.query(
    `SELECT coalesce(max(generation_no), 0) + 1 AS next
     FROM generated_block WHERE plan_id = $1 AND node_key = $2`,
    [planId, nodeKey],
  );
  return Number(result.rows[0].next);
}

export async function insertGeneratedBlock(
  client: PoolClient,
  input: {
    planId: string;
    tocVersionId: string;
    nodeKey: string;
    generationNo: number;
    sourceJobId: string;
    outlineLevel: number;
    sortOrder: number;
    title: string;
    text: string;
    contentHash: string;
    citations: unknown[];
    createdBy: string;
  },
): Promise<string> {
  const result = await client.query(
    `INSERT INTO generated_block
       (plan_id, toc_version_id, node_key, generation_no, source_job_id, outline_level,
        sort_order, title, text_content, content_hash, citations_json, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'GENERATED', $12)
     RETURNING block_id`,
    [
      input.planId,
      input.tocVersionId,
      input.nodeKey,
      input.generationNo,
      input.sourceJobId,
      input.outlineLevel,
      input.sortOrder,
      input.title,
      input.text,
      input.contentHash,
      JSON.stringify(input.citations),
      input.createdBy,
    ],
  );
  return result.rows[0].block_id as string;
}

/** Supersede the previous current row BEFORE inserting its successor —
 * uk_generated_block_current (partial unique) forbids two current rows for
 * one node even transiently, so the write order is supersede → insert →
 * link. The une_worker protection trigger (0017) rejects this for
 * protected rows and for any column outside superseded_at/
 * superseded_by_block_id/updated_at — defense stays even if the runner
 * filter regresses. */
export async function supersedeBlock(client: PoolClient, blockId: string): Promise<void> {
  await client.query(
    `UPDATE generated_block
     SET superseded_at = now(), updated_at = now()
     WHERE block_id = $1 AND superseded_at IS NULL`,
    [blockId],
  );
}

/** Second step of the supersede chain: record which block replaced it. */
export async function linkSupersededBy(
  client: PoolClient,
  blockId: string,
  byBlockId: string,
): Promise<void> {
  await client.query(
    `UPDATE generated_block
     SET superseded_by_block_id = $2, updated_at = now()
     WHERE block_id = $1 AND superseded_at IS NOT NULL`,
    [blockId, byBlockId],
  );
}
