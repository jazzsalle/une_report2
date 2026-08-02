import type { ContentDraft, TocNodeDraft } from '@une/domain';
import { toPlanTocData, type LegacyTocRequestBody } from './legacy-toc-mapper';
import { guardContentResponse, type LegacyContentSection } from './legacy-content-response.guard';

/**
 * PlanContext + outline ↔ T3Q legacy RPT-002 mapping (CC-125). Shares the
 * PlanTocData field rules with the RPT-001 mapper (the transcript reuses the
 * same top-level anchors) and adds `sections` + `stream`.
 */

export const LEGACY_CONTENT_MAPPING_VERSION = 'legacy-v0.8.5-une1@1';

/** Legacy TocSection: name/children only — node keys are UNE-internal and
 * MUST NOT leak into provider requests (US-PLAN-007 step 5). */
interface LegacyTocSectionShape {
  name: string;
  children: LegacyTocSectionShape[];
}

export function toPlanContentData(
  planContext: Record<string, unknown>,
  outline: readonly TocNodeDraft[],
  stream: boolean,
): LegacyTocRequestBody {
  const base = toPlanTocData(planContext);
  const toSections = (nodes: readonly TocNodeDraft[]): LegacyTocSectionShape[] =>
    nodes.map((node) => ({
      name: node.title,
      children: toSections(node.children ?? []),
    }));
  return { data: { ...base.data, sections: toSections(outline), stream } };
}

/** ContentResponse → canonical drafts. Legacy sections carry no stable ids,
 * so nodeKey stays unset (CC-130 re-anchors by title/outline position). */
export function fromContentResponse(raw: unknown): ContentDraft[] {
  return mapContentSections(guardContentResponse(raw).sections);
}

export function mapContentSections(sections: readonly LegacyContentSection[]): ContentDraft[] {
  return sections.map((section) => ({
    title: section.name.trim(),
    text: section.content,
    citations: section.references.map((reference) => ({
      sourceRef: reference.id,
      fileName: reference.fileName,
      page: reference.page || null,
    })),
    children: mapContentSections(section.children),
  }));
}
