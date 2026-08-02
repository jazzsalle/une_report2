/** Canonical-lite content shape returned by T3Q plan adapters (CC-125,
 * ADR-26 D4, wording corrected per architecture review M1): this is the
 * LEGACY ContentSection shape promoted to a provider-neutral name, kept in
 * @une/domain because it is what the CC-130 content pipeline consumes. It
 * is NOT the legacy∩v2 intersection — v2 ContentBlock is flat
 * (sectionId+order, no title/children) and its mapping onto a canonical
 * type is owned by CC-130/CC-135 when GeneratedBlock exists. Optional
 * provenance slots below reserve the v2 fields so that mapping will not
 * need a breaking change. Persistence, protection policy, and regeneration
 * state live on GeneratedBlock (CC-130); adapters never touch those. */

export interface ContentCitationDraft {
  /** Provider-scoped citation/reference id (legacy Reference.id, v2
   * Citation.citationId). Opaque to UNE — traceability only. */
  sourceRef: string;
  fileName: string;
  /** Legacy pages are strings; v2 pages are numbers — normalized to string,
   * null when the provider omits it. */
  page: string | null;
  excerpt?: string;
  // ── v2 Citation provenance slots (reserved; filled by CC-130/135 mapping,
  //    never by the legacy adapter — legacy has no such fields) ──
  sourceId?: string;
  documentId?: string;
  chunkId?: string | null;
  score?: number;
  retrievedAt?: string;
}

export interface ContentDraft {
  /** TOC node this content belongs to, when the request carried keyed
   * outline nodes. Optional: legacy RPT-002 responses carry names only. */
  nodeKey?: string;
  title: string;
  text: string;
  citations: ContentCitationDraft[];
  children: ContentDraft[];
}

export const MAX_CONTENT_DEPTH = 6;
export const MAX_CONTENT_SECTIONS = 500;

export interface ContentDraftIssue {
  code: 'EMPTY_TITLE' | 'DEPTH_EXCEEDED' | 'TOO_MANY_SECTIONS' | 'EMPTY_TREE';
  path: string;
}

/** Structural sanity for adapter output (same spirit as validateTocTree —
 * providers must not push unbounded or empty trees into job pipelines). */
export function validateContentDrafts(sections: readonly ContentDraft[]): ContentDraftIssue[] {
  const issues: ContentDraftIssue[] = [];
  if (sections.length === 0) return [{ code: 'EMPTY_TREE', path: '/' }];
  let count = 0;
  const walk = (list: readonly ContentDraft[], depth: number, prefix: string): void => {
    list.forEach((section, index) => {
      const path = `${prefix}/${index}`;
      count += 1;
      if (count > MAX_CONTENT_SECTIONS) return;
      if (depth > MAX_CONTENT_DEPTH) {
        issues.push({ code: 'DEPTH_EXCEEDED', path });
        return;
      }
      if ((section.title?.trim() ?? '').length === 0) {
        issues.push({ code: 'EMPTY_TITLE', path });
      }
      walk(section.children ?? [], depth + 1, path);
    });
  };
  walk(sections, 1, '');
  if (count > MAX_CONTENT_SECTIONS) issues.push({ code: 'TOO_MANY_SECTIONS', path: '/' });
  return issues;
}
