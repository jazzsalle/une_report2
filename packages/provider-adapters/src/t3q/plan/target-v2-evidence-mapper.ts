import type { EvidenceItemDraft } from '@une/domain';
import type { CitationV2, EvidenceSearchRequestV2 } from './mock-target-v2-payloads';
import { fromCitationV2 } from './target-v2-content-mapper';
import {
  TargetV2MappingError,
  toPlanRequestBase,
  type TargetV2RequestContext,
} from './target-v2-toc-mapper';
import type { T3qEvidenceSearchRequest } from './t3q-plan-port';

/**
 * Evidence search mapping (CC-135, CR-T3Q-005, ADR-28). Results are
 * NON-AUTHORITATIVE LLM output: nothing here becomes a UNE fact, and no
 * EvidenceSet is persisted before CC-230. The v2 Citation provenance fills
 * the ContentCitationDraft slots reserved by ADR-26 D4.
 */

export const TARGET_V2_EVIDENCE_MAPPING_VERSION = 'v2-1.0.1-request@1';

export function toEvidenceSearchRequest(
  request: T3qEvidenceSearchRequest,
  context: TargetV2RequestContext,
): EvidenceSearchRequestV2 {
  if (request.query.trim().length === 0) {
    throw new TargetV2MappingError('query', 'query must be a non-empty string');
  }
  if (!Number.isInteger(request.topK) || request.topK < 1 || request.topK > 100) {
    throw new TargetV2MappingError('topK', 'topK must be an integer in [1,100]');
  }
  return {
    ...toPlanRequestBase(request.planContext, context),
    ...(request.referenceDocumentIds && request.referenceDocumentIds.length > 0
      ? { referenceDocumentIds: request.referenceDocumentIds }
      : {}),
    query: request.query,
    topK: request.topK,
    ...(request.filters !== undefined ? { filters: request.filters } : {}),
    ...(request.supportsBlockKeys && request.supportsBlockKeys.length > 0
      ? { supportsBlockIds: request.supportsBlockKeys }
      : {}),
  };
}

export function fromEvidenceItems(items: readonly CitationV2[]): EvidenceItemDraft[] {
  return items.map((citation) => ({
    ...fromCitationV2(citation),
    supportsBlockKeys: [...(citation.supportsBlockIds ?? [])],
  }));
}
