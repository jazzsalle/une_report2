import { canonicalHash } from '../canonical-json';

/** Canonical TOC tree (CC-120, ADR-25): the provider-neutral shape shared by
 * the RPT-001 response mapping (worker) and the user save endpoint
 * (UNE-PLAN-014). Persistence: toc_version + toc_node (design 10 §6.16). */

export interface TocNodeDraft {
  /** Stable identity. AI trees get deterministic path keys (n-1-2); user
   * additions get u-<8hex>. Existing keys survive edits (protected-block
   * anchoring in CC-130 depends on this). */
  nodeKey?: string;
  title: string;
  generationPolicy?: Record<string, unknown>;
  children?: TocNodeDraft[];
}

export interface FlatTocNode {
  nodeKey: string;
  parentKey: string | null;
  title: string;
  level: number;
  sortOrder: number;
  generationPolicy: Record<string, unknown>;
}

export const MAX_TOC_DEPTH = 6;
export const MAX_TOC_NODES = 500;
export const MAX_TOC_TITLE_LENGTH = 500;
const NODE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export interface TocTreeIssue {
  code:
    | 'EMPTY_TITLE'
    | 'TITLE_TOO_LONG'
    | 'DEPTH_EXCEEDED'
    | 'TOO_MANY_NODES'
    | 'DUPLICATE_NODE_KEY'
    | 'INVALID_NODE_KEY'
    | 'EMPTY_TREE';
  /** JSON-pointer-ish anchor for screen field mapping (design §7.9 ALT-05). */
  path: string;
}

export function validateTocTree(nodes: readonly TocNodeDraft[]): TocTreeIssue[] {
  const issues: TocTreeIssue[] = [];
  if (nodes.length === 0) {
    return [{ code: 'EMPTY_TREE', path: '/' }];
  }
  const seenKeys = new Set<string>();
  let count = 0;
  const walk = (list: readonly TocNodeDraft[], depth: number, prefix: string): void => {
    list.forEach((node, index) => {
      const path = `${prefix}/${index}`;
      count += 1;
      if (count > MAX_TOC_NODES) return;
      if (depth > MAX_TOC_DEPTH) {
        issues.push({ code: 'DEPTH_EXCEEDED', path });
        return; // deeper children would only repeat the finding
      }
      const title = node.title?.trim() ?? '';
      if (title.length === 0) issues.push({ code: 'EMPTY_TITLE', path });
      else if (title.length > MAX_TOC_TITLE_LENGTH) issues.push({ code: 'TITLE_TOO_LONG', path });
      if (node.nodeKey !== undefined) {
        if (!NODE_KEY_PATTERN.test(node.nodeKey)) {
          issues.push({ code: 'INVALID_NODE_KEY', path });
        } else if (seenKeys.has(node.nodeKey)) {
          issues.push({ code: 'DUPLICATE_NODE_KEY', path });
        } else {
          seenKeys.add(node.nodeKey);
        }
      }
      walk(node.children ?? [], depth + 1, path);
    });
  };
  walk(nodes, 1, '');
  if (count > MAX_TOC_NODES) issues.push({ code: 'TOO_MANY_NODES', path: '/' });
  return issues;
}

/** Deterministic path-based keys for AI-generated trees: same provider
 * response → same keys, so retries do not shuffle identity (ADR-25 D8). */
export function assignAiNodeKeys(nodes: readonly TocNodeDraft[]): TocNodeDraft[] {
  const assign = (list: readonly TocNodeDraft[], prefix: string): TocNodeDraft[] =>
    list.map((node, index) => {
      const key = `${prefix}-${index + 1}`;
      return { ...node, nodeKey: key, children: assign(node.children ?? [], key) };
    });
  return assign(nodes, 'n');
}

/** User additions get random keys in a distinct namespace so they can never
 * collide with deterministic AI keys. */
export function ensureUserNodeKeys(nodes: readonly TocNodeDraft[]): TocNodeDraft[] {
  const ensure = (list: readonly TocNodeDraft[]): TocNodeDraft[] =>
    list.map((node) => ({
      ...node,
      nodeKey: node.nodeKey ?? `u-${newRandomSuffix()}`,
      children: ensure(node.children ?? []),
    }));
  return ensure(nodes);
}

function newRandomSuffix(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (!cryptoApi?.randomUUID) {
    throw new Error('globalThis.crypto.randomUUID is required (Node 19+ or a modern browser)');
  }
  return cryptoApi.randomUUID().replace(/-/g, '').slice(0, 8);
}

/** Depth-first flatten, parents before children — the toc_node insert order
 * (parent_node_id FK requires parents to exist first). */
export function flattenTocTree(nodes: readonly TocNodeDraft[]): FlatTocNode[] {
  const rows: FlatTocNode[] = [];
  const walk = (list: readonly TocNodeDraft[], parentKey: string | null, level: number): void => {
    list.forEach((node, index) => {
      if (!node.nodeKey) throw new Error('flattenTocTree requires nodeKey on every node');
      rows.push({
        nodeKey: node.nodeKey,
        parentKey,
        title: node.title.trim(),
        level,
        sortOrder: index,
        generationPolicy: node.generationPolicy ?? {},
      });
      walk(node.children ?? [], node.nodeKey, level + 1);
    });
  };
  walk(nodes, null, 1);
  return rows;
}

/** Content identity of a tree: titles, structure, and generation policy —
 * node keys are identity, not content, so re-keying an identical outline
 * yields the same hash (ADR-25 D8). */
export function tocTreeContentHash(nodes: readonly TocNodeDraft[]): string {
  const strip = (list: readonly TocNodeDraft[]): unknown[] =>
    list.map((node) => ({
      title: node.title.trim(),
      generationPolicy: node.generationPolicy ?? {},
      children: strip(node.children ?? []),
    }));
  return canonicalHash(strip(nodes));
}
