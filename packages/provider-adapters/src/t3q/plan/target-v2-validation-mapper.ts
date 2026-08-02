import { sha256Hex, type ValidationReportDraft } from '@une/domain';
import type {
  ContentBlockV2,
  ValidationIssueV2,
  ValidationRequestV2,
} from './mock-target-v2-payloads';
import { toOutlineSections } from './target-v2-content-mapper';
import {
  TargetV2MappingError,
  toPlanRequestBase,
  type TargetV2RequestContext,
} from './target-v2-toc-mapper';
import type { T3qValidationRequest } from './t3q-plan-port';

/**
 * Semantic validation mapping (CC-135, CR-T3Q-006, ADR-28 D9). The verdict
 * is MOCK_ONLY: no UNE pipeline may gate, block, or fail anything on it —
 * a mock verdict presented as a provider verdict would be exactly the
 * "mock reported as actual T3Q support" failure CLAUDE.md forbids.
 */

export const TARGET_V2_VALIDATION_MAPPING_VERSION = 'v2-1.0.1-request@1';

export function toValidationRequest(
  request: T3qValidationRequest,
  context: TargetV2RequestContext,
): ValidationRequestV2 {
  if (request.validationTypes.length === 0) {
    throw new TargetV2MappingError('validationTypes', 'validationTypes must not be empty');
  }
  const blocks: ContentBlockV2[] = request.blocks.map((block, index) => {
    if (block.blockKey.length === 0 || block.nodeKey.length === 0) {
      throw new TargetV2MappingError(`blocks/${index}`, 'blockKey and nodeKey are required');
    }
    return {
      blockId: block.blockKey,
      sectionId: block.nodeKey,
      // pass-through so blockType-sensitive checks (EXPRESSION_RULE bullet
      // symbol) are reachable via the adapter path; PARAGRAPH when the
      // caller does not know (contract-test finding, CC-135)
      blockType: block.blockType ?? 'PARAGRAPH',
      order: block.order,
      text: block.text,
      structuredData: null,
      citations: block.citations.map((citation, citationIndex) => {
        // Fail-closed reverse mapping: only citations that already carry v2
        // provenance (ADR-26 D4 slots) can ride a v2 request — inventing
        // sourceId/documentId for legacy citations would guess OB-11 truth.
        if (
          citation.sourceId === undefined ||
          citation.documentId === undefined ||
          citation.score === undefined ||
          citation.retrievedAt === undefined
        ) {
          throw new TargetV2MappingError(
            `blocks/${index}/citations/${citationIndex}`,
            'citation lacks v2 provenance (sourceId/documentId/score/retrievedAt) — legacy citations cannot ride a v2 validation request',
          );
        }
        const page = citation.page === null ? null : Number(citation.page);
        return {
          citationId: citation.sourceRef,
          sourceId: citation.sourceId,
          documentId: citation.documentId,
          fileName: citation.fileName,
          page: page !== null && Number.isInteger(page) && page >= 1 ? page : null,
          chunkId: citation.chunkId ?? null,
          excerpt: citation.excerpt ?? '',
          score: citation.score,
          supportsBlockIds: [block.blockKey],
          retrievedAt: citation.retrievedAt,
        };
      }),
      warnings: [],
      status: 'GENERATED',
      contentHash: sha256Hex(block.text),
    };
  });
  return {
    ...toPlanRequestBase(request.planContext, context),
    validationTypes: [...request.validationTypes],
    outline: toOutlineSections(request.outline),
    blocks,
  };
}

export function fromValidationReport(report: {
  valid: boolean;
  issues: ValidationIssueV2[];
}): ValidationReportDraft {
  return {
    valid: report.valid,
    issues: report.issues.map((issue) => ({
      issueKey: issue.issueId,
      type: issue.type,
      severity: issue.severity,
      message: issue.message,
      nodeKey: issue.sectionId ?? null,
      blockKey: issue.blockId ?? null,
      citationKey: issue.citationId ?? null,
      ...(issue.suggestedAction !== undefined ? { suggestedAction: issue.suggestedAction } : {}),
    })),
  };
}
