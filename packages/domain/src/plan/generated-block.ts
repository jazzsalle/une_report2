import { canonicalHash } from '../canonical-json';
import type { ContentDraft } from './content-draft';
import type { TocNodeDraft } from './toc-tree';

/**
 * generated_block domain model (CC-130, ADR-27). Vocabulary is split three
 * ways on purpose (ADR-27 D3):
 * - row `status`      — what the generation produced for this row
 * - `protection_state` — orthogonal row property (0003 document_block
 *   vocabulary reused verbatim so CC-150 inherits it without translation)
 * - event `outcome`   — what happened to a node in ONE generation round
 *   (PRESERVED is an event, not a row state: a protected node produces no
 *   new row at all).
 */

export const GENERATED_BLOCK_STATUSES = ['GENERATED', 'FAILED'] as const;
export type GeneratedBlockStatus = (typeof GENERATED_BLOCK_STATUSES)[number];

export const BLOCK_PROTECTION_STATES = ['NONE', 'USER_LOCKED', 'SYSTEM_LOCKED'] as const;
export type BlockProtectionState = (typeof BLOCK_PROTECTION_STATES)[number];

export const CONTENT_BLOCK_OUTCOMES = ['GENERATED', 'PRESERVED', 'FAILED'] as const;
export type ContentBlockOutcome = (typeof CONTENT_BLOCK_OUTCOMES)[number];

/** One anchored block ready for persistence (worker tx B1 input). */
export interface AnchoredContentBlock {
  nodeKey: string;
  outlineLevel: number;
  sortOrder: number;
  title: string;
  text: string;
  citations: ContentDraft['citations'];
}

export interface AnchorIssue {
  code: 'TITLE_MISMATCH' | 'COUNT_MISMATCH' | 'OUT_OF_OUTLINE' | 'MISSING_NODE_KEY';
  /** JSON-pointer-ish path into the DRAFT tree (screen mapping, ALT-05). */
  path: string;
  nodeKey?: string;
  detail: string;
}

export interface AnchorResult {
  anchored: AnchoredContentBlock[];
  /** Non-empty issues mean the response is QUARANTINED as a whole —
   * US-PLAN-012 E-02: blocks outside the outline are contract errors and
   * must never reach the document. */
  issues: AnchorIssue[];
}

/** Absolute coordinates of every node in the FULL confirmed outline —
 * level and global pre-order position. Anchoring against a PRUNED subtree
 * (scoped regeneration) MUST use these, never walk-relative values: a
 * level-2 node regenerated alone would otherwise be persisted as a level-1
 * block colliding with real top-level sort orders, and generated_block
 * rows are immutable (review B-1/F2). */
export type OutlineCoordinates = ReadonlyMap<string, { outlineLevel: number; sortOrder: number }>;

export function outlineCoordinates(tree: readonly TocNodeDraft[]): OutlineCoordinates {
  const map = new Map<string, { outlineLevel: number; sortOrder: number }>();
  let order = 0;
  const walk = (nodes: readonly TocNodeDraft[], level: number): void => {
    for (const node of nodes) {
      order += 1;
      if (node.nodeKey) map.set(node.nodeKey, { outlineLevel: level, sortOrder: order });
      walk(node.children ?? [], level + 1);
    }
  };
  walk(tree, 1);
  return map;
}

const normalize = (title: string): string => title.trim().replace(/\s+/g, ' ');

/**
 * Anchors a provider ContentDraft tree onto the confirmed outline.
 *
 * Legacy RPT-002 carries no stable ids (CR-T3Q-001), so anchoring uses the
 * DOUBLE match the design allows: the response tree must mirror the request
 * outline positionally AND per-node normalized titles must agree. Any
 * mismatch is an issue — partial acceptance would risk writing body text
 * under the wrong node (the one unrecoverable failure mode).
 */
export function anchorContentDrafts(
  outline: readonly TocNodeDraft[],
  drafts: readonly ContentDraft[],
  /** Coordinates from the FULL outline (outlineCoordinates). When absent
   * (full-outline anchoring), walk-relative values are the same thing;
   * scoped anchoring MUST pass this or coordinates would be wrong. */
  coordinates?: OutlineCoordinates,
): AnchorResult {
  const anchored: AnchoredContentBlock[] = [];
  const issues: AnchorIssue[] = [];
  let sortOrder = 0;

  const walk = (
    outlineNodes: readonly TocNodeDraft[],
    draftNodes: readonly ContentDraft[],
    level: number,
    prefix: string,
  ): void => {
    if (outlineNodes.length !== draftNodes.length) {
      issues.push({
        code: draftNodes.length > outlineNodes.length ? 'OUT_OF_OUTLINE' : 'COUNT_MISMATCH',
        path: prefix || '/',
        detail: `outline has ${outlineNodes.length} node(s), response has ${draftNodes.length}`,
      });
    }
    const pairs = Math.min(outlineNodes.length, draftNodes.length);
    for (let index = 0; index < pairs; index += 1) {
      const outlineNode = outlineNodes[index];
      const draft = draftNodes[index];
      const path = `${prefix}/${index}`;
      if (!outlineNode.nodeKey) {
        issues.push({
          code: 'MISSING_NODE_KEY',
          path,
          detail: `outline node "${outlineNode.title}" has no nodeKey`,
        });
        continue;
      }
      if (normalize(outlineNode.title) !== normalize(draft.title)) {
        issues.push({
          code: 'TITLE_MISMATCH',
          path,
          nodeKey: outlineNode.nodeKey,
          detail: `outline "${outlineNode.title}" vs response "${draft.title}"`,
        });
      }
      sortOrder += 1;
      const absolute = coordinates?.get(outlineNode.nodeKey);
      if (coordinates && !absolute) {
        issues.push({
          code: 'MISSING_NODE_KEY',
          path,
          nodeKey: outlineNode.nodeKey,
          detail: `node "${outlineNode.nodeKey}" is missing from the outline coordinates`,
        });
        continue;
      }
      anchored.push({
        nodeKey: outlineNode.nodeKey,
        outlineLevel: absolute?.outlineLevel ?? level,
        sortOrder: absolute?.sortOrder ?? sortOrder,
        title: outlineNode.title,
        text: draft.text,
        citations: draft.citations,
      });
      walk(outlineNode.children ?? [], draft.children ?? [], level + 1, path);
    }
  };

  walk(outline, drafts, 1, '');
  return issues.length > 0 ? { anchored: [], issues } : { anchored, issues: [] };
}

/** Content identity for a generated block — key-independent of generation
 * bookkeeping (same text+citations under the same node → same hash). */
export function generatedBlockContentHash(block: AnchoredContentBlock): string {
  return canonicalHash({
    nodeKey: block.nodeKey,
    title: block.title,
    text: block.text,
    citations: block.citations,
  });
}
