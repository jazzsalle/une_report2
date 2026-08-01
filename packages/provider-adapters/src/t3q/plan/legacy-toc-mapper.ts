import { assignAiNodeKeys, type TocNodeDraft } from '@une/domain';
import { guardTocResponse, type LegacyTocResponse } from './legacy-toc-response.guard';

/**
 * PlanContext ↔ T3Q legacy v0.8.5 mapping. The field gap matrix
 * (docs/handoff/T3Q_PLAN_FIELD_GAP_MATRIX.md) is the source of truth; the
 * mapper is shared by the CC-120 mock and the CC-125 LegacyT3qPlanAdapter.
 */

export const LEGACY_TOC_MAPPING_VERSION = 'legacy-v0.8.5-une1@1';

/** RPT-001 request body shape ({data: PlanTocData}). */
export interface LegacyTocRequestBody {
  data: Record<string, unknown>;
}

const TOP_LEVEL_FIELDS = [
  'subject',
  'backgroundInfo',
  'contentInstruction',
  'expressionRule',
  'purposeOfDocument',
  'systemPrompt',
] as const;

/**
 * PlanContext → PlanTocData. Matrix rules: identical field names, null values
 * are OMITTED (legacy fields are plain strings — null is invalid there),
 * nothing outside the PlanContext vocabulary is ever sent (no HWPX style ids,
 * no internal notes — US-PLAN-007 step 5).
 */
export function toPlanTocData(planContext: Record<string, unknown>): LegacyTocRequestBody {
  const data: Record<string, unknown> = {};
  for (const field of TOP_LEVEL_FIELDS) {
    const value = planContext[field];
    if (value === null || value === undefined) continue;
    data[field] = typeof value === 'object' && !Array.isArray(value) ? omitNulls(value) : value;
  }
  return { data };
}

function omitNulls(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue;
    out[key] = entry;
  }
  return out;
}

/**
 * TocResponse → canonical TOC tree. The legacy tree has no stable ids
 * (CR-T3Q-001), so UNE assigns deterministic path keys; the response title is
 * not persisted (toc_version has no title column — the plan carries it).
 */
export function fromTocResponse(raw: unknown): TocNodeDraft[] {
  const response: LegacyTocResponse = guardTocResponse(raw);
  const mapNodes = (sections: LegacyTocResponse['sections']): TocNodeDraft[] =>
    sections.map((section) => ({
      title: section.name.trim(),
      children: mapNodes(section.children),
    }));
  return assignAiNodeKeys(mapNodes(response.sections));
}
