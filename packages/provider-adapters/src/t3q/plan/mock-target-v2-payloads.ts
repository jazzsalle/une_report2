import { sha256Hex } from '@une/domain';
import type { components } from '../../generated/t3q-plan-api-v2';

/**
 * Single deterministic source for every target-v2 mock payload (CC-135,
 * ADR-28). The contract examples in t3q-plan-api-change-request-v1.yaml copy
 * the CAPABILITIES value below verbatim (deep-equal contract test), and the
 * mock transport builds blocks/citations/proposals/issues from these
 * builders only — no second implementation may drift.
 *
 * Determinism rules (ADR-28): no wall clock, no randomness. Every id derives
 * from sha256 over stable request inputs; every timestamp echoes the
 * request's requestedAt. Same request → same response bytes.
 */

export type ContentGenerationRequestV2 = components['schemas']['ContentGenerationRequest'];
export type ContentBlockV2 = components['schemas']['ContentBlock'];
export type CitationV2 = components['schemas']['Citation'];
export type SemanticEditRequestV2 = components['schemas']['SemanticEditRequest'];
export type ChangeProposalV2 = components['schemas']['ChangeProposal'];
export type EvidenceSearchRequestV2 = components['schemas']['EvidenceSearchRequest'];
export type ValidationRequestV2 = components['schemas']['ValidationRequest'];
export type ValidationIssueV2 = components['schemas']['ValidationIssue'];
export type ProviderCapabilitiesV2 = components['schemas']['ProviderCapabilities'];
export type ErrorResponseV2 = components['schemas']['ErrorResponse'];
export type OutlineSectionV2 = components['schemas']['OutlineSection'];

/** Unmistakably-UNE build tag: a reader can never take this for a T3Q build
 * (CLAUDE.md "never report mock support as actual T3Q support"). */
export const MOCK_TARGET_V2_PROVIDER_BUILD = 'une-mock-target-v2-1.0.1-request';

/** Canonical capabilities-discovery mock response (CR-T3Q-009). features
 * reflect what THIS mock actually implements — referenceUpload stays false
 * (CR-T3Q-007 CONDITIONAL, no mock). limits are UNE mock constants, not
 * provider truth (OB-10). */
export const MOCK_TARGET_V2_CAPABILITIES: ProviderCapabilitiesV2 = {
  providerBuild: MOCK_TARGET_V2_PROVIDER_BUILD,
  contractVersions: ['2.0'],
  features: {
    tocV2: true,
    contentV2: true,
    semanticEdit: true,
    evidenceSearch: true,
    validation: true,
    referenceUpload: false,
    jobSse: true,
    partialRetry: true,
  },
  limits: {
    maxInputChars: 200000,
    maxSections: 200,
    maxBlocks: 5000,
    maxConcurrentJobsPerTenant: 4,
    maxReferenceFileBytes: 52428800,
    supportedReferenceMimeTypes: ['application/pdf', 'text/plain'],
  },
};

/** Matches the contract example's reference document so evidence output and
 * examples share one world. */
export const MOCK_DEFAULT_REFERENCE_DOCUMENT_ID = 'f52b8d07-3a94-4c16-b0e8-6d7a91c25f43';
export const MOCK_DEFAULT_REFERENCE_FILE_NAME = '2025_폭염종합대책.pdf';

export function deriveMockId(prefix: string, seed: string, length = 16): string {
  return `${prefix}-${sha256Hex(seed).slice(0, length)}`;
}

function chunkIdFor(page: number, slot: number): string {
  return `chunk-${String(page).padStart(4, '0')}-${String(slot).padStart(2, '0')}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

interface MockCitationSeed {
  seed: string;
  index: number;
  documentId: string;
  fileName: string;
  supportsBlockIds: string[];
  retrievedAt: string;
  excerpt: string;
}

export function buildMockCitation(input: MockCitationSeed): CitationV2 {
  const page = 3 + ((parseInt(sha256Hex(input.seed).slice(0, 4), 16) + input.index * 2) % 28);
  return {
    citationId: deriveMockId('cit', `${input.seed}:${input.index}`, 12),
    sourceId: deriveMockId('src', `src:${input.seed}:${input.index}`, 12),
    documentId: input.documentId,
    fileName: input.fileName,
    page,
    chunkId: chunkIdFor(page, input.index % 5),
    excerpt: input.excerpt,
    score: round2(Math.max(0.05, 0.95 - input.index * 0.07)),
    supportsBlockIds: input.supportsBlockIds,
    retrievedAt: input.retrievedAt,
  };
}

/** Sections the request actually targets, in document order. BLOCKS scope is
 * not mocked (UNE partial regeneration is section-grained, ADR-27 D7) — the
 * transport rejects it before this runs. */
export function resolveTargetSections(request: ContentGenerationRequestV2): OutlineSectionV2[] {
  const ordered = [...request.outline].sort((a, b) => a.order - b.order);
  if (request.generationScope === 'SECTIONS') {
    const wanted = new Set(request.targetSectionIds ?? []);
    return ordered.filter((section) => wanted.has(section.sectionId));
  }
  return ordered;
}

/**
 * Deterministic ContentBlock fabrication. Level-1 sections get two blocks
 * (PARAGRAPH + BULLET) so the section-grouped canonical mapping is actually
 * exercised; deeper sections get one. The LAST targeted section carries no
 * citations — a stable no-evidence case for blocksWithoutEvidence paths.
 */
export function buildMockContentBlocks(
  request: ContentGenerationRequestV2,
  generationId: string,
  sections: readonly OutlineSectionV2[] = resolveTargetSections(request),
): ContentBlockV2[] {
  const blocks: ContentBlockV2[] = [];
  const citationRequired = request.generationOption?.citationRequired !== false;
  sections.forEach((section, sectionIndex) => {
    const blockCount = section.outlineLevel === 1 ? 2 : 1;
    const withEvidence = citationRequired && sectionIndex < sections.length - 1;
    for (let order = 0; order < blockCount; order += 1) {
      const blockId = deriveMockId('blk', `${generationId}:${section.sectionId}:${order}`);
      const text =
        order === 0
          ? `${section.title} — ${request.subject}에 대한 개요를 정리한다.` +
            (section.instruction ? ` (${section.instruction})` : '')
          : `${section.title}의 세부 추진 항목을 개조식으로 제시한다.`;
      blocks.push({
        blockId,
        sectionId: section.sectionId,
        blockType: order === 0 ? 'PARAGRAPH' : 'BULLET',
        order,
        text,
        structuredData: null,
        citations:
          withEvidence && order === 0
            ? [
                buildMockCitation({
                  seed: `${generationId}:${section.sectionId}`,
                  index: sectionIndex,
                  documentId:
                    request.referenceDocumentIds?.[0] ?? MOCK_DEFAULT_REFERENCE_DOCUMENT_ID,
                  fileName: MOCK_DEFAULT_REFERENCE_FILE_NAME,
                  supportsBlockIds: [blockId],
                  retrievedAt: request.requestedAt,
                  excerpt: `${section.title} 관련 지침 발췌.`,
                }),
              ]
            : [],
        warnings: [],
        status: 'GENERATED',
        contentHash: sha256Hex(text),
      });
    }
  });
  return blocks;
}

/** Deterministic ChangeProposal (CR-T3Q-004). The builder NEVER touches
 * protectedBlockIds — and the adapter guard re-checks that on the response
 * side as a mechanism, not a promise (ADR-28 D8). */
export function buildMockChangeProposal(request: SemanticEditRequestV2): ChangeProposalV2 {
  const target = request.target;
  const requestedAt = request.requestedAt;
  const editedText = `[개선] ${request.selectedText ?? '대상 본문'} → ${request.instruction}`;
  const preserved = (request.preserveCitationIds ?? []).map((citationId, index) => ({
    ...buildMockCitation({
      seed: `preserve:${request.requestId}`,
      index,
      documentId: MOCK_DEFAULT_REFERENCE_DOCUMENT_ID,
      fileName: MOCK_DEFAULT_REFERENCE_FILE_NAME,
      supportsBlockIds: target.blockId ? [target.blockId] : [],
      retrievedAt: requestedAt,
      excerpt: '보존 지정된 기존 인용.',
    }),
    citationId,
  }));
  const sectionId = target.sectionId ?? deriveMockId('sec', `sec:${request.requestId}`);
  const makeBlock = (blockId: string, order: number, text: string): ContentBlockV2 => ({
    blockId,
    sectionId,
    blockType: 'PARAGRAPH',
    order,
    text,
    structuredData: null,
    citations: order === 0 ? preserved : [],
    warnings: [],
    status: 'GENERATED',
    contentHash: sha256Hex(text),
  });

  let operations: ChangeProposalV2['operations'];
  let proposedBlocks: ContentBlockV2[];
  if (target.targetType === 'RANGE') {
    const blockId = target.blockId as string;
    const range = target.range as { start?: number; end?: number };
    operations = [
      {
        operationType: 'REPLACE_RANGE',
        targetId: blockId,
        payload: { range: { start: range.start, end: range.end }, text: editedText },
      },
    ];
    proposedBlocks = [makeBlock(blockId, 0, editedText)];
  } else if (target.targetType === 'BLOCK') {
    const blockId = target.blockId as string;
    operations = [
      { operationType: 'REPLACE_BLOCK', targetId: blockId, payload: { text: editedText } },
    ];
    proposedBlocks = [makeBlock(blockId, 0, editedText)];
  } else {
    const replaceId = target.blockId ?? deriveMockId('blk', `edit:${request.requestId}:0`);
    const insertId = deriveMockId('blk', `edit:${request.requestId}:1`);
    const deleteId = deriveMockId('blk', `edit:${request.requestId}:2`);
    const insertedText = `${request.instruction}에 따른 신규 보강 문단.`;
    operations = [
      { operationType: 'REPLACE_BLOCK', targetId: replaceId, payload: { text: editedText } },
      {
        operationType: 'INSERT_BLOCK',
        targetId: null,
        payload: { afterBlockId: replaceId, text: insertedText },
      },
      { operationType: 'DELETE_BLOCK', targetId: deleteId, payload: { reason: '중복 문단 정리' } },
    ];
    proposedBlocks = [makeBlock(replaceId, 0, editedText), makeBlock(insertId, 1, insertedText)];
  }
  return {
    proposalId: deriveMockId('prop', request.requestId),
    baseRevisionId: request.baseRevisionId,
    operations,
    proposedBlocks,
    citations: preserved,
    warnings: [],
  };
}

/** Deterministic evidence search results (CR-T3Q-005): scores strictly
 * descending, provenance fully populated, pool capped at 8. */
export function buildMockEvidenceItems(request: EvidenceSearchRequestV2): CitationV2[] {
  const poolSize = Math.min(request.topK, 8);
  const documents =
    request.referenceDocumentIds && request.referenceDocumentIds.length > 0
      ? request.referenceDocumentIds
      : [MOCK_DEFAULT_REFERENCE_DOCUMENT_ID];
  return Array.from({ length: poolSize }, (_, index) => {
    const documentId = documents[index % documents.length];
    return buildMockCitation({
      seed: `evidence:${request.query}`,
      index,
      documentId,
      fileName:
        documentId === MOCK_DEFAULT_REFERENCE_DOCUMENT_ID
          ? MOCK_DEFAULT_REFERENCE_FILE_NAME
          : `ref-${documentId.slice(0, 8)}.pdf`,
      supportsBlockIds: request.supportsBlockIds ?? [],
      retrievedAt: request.requestedAt,
      excerpt: `"${request.query}" 관련 근거 발췌 ${index + 1}.`,
    });
  });
}

const NORMALIZE_RE = /\s+/g;

/** Deterministic validation heuristics (CR-T3Q-006, six kinds). These are
 * UNE-authored imitations of a provider verdict — MOCK_ONLY governance
 * forbids any UNE pipeline from gating on them (ADR-28 D9). */
export function buildMockValidationReport(request: ValidationRequestV2): {
  valid: boolean;
  issues: ValidationIssueV2[];
} {
  const kinds = new Set(request.validationTypes);
  const issues: ValidationIssueV2[] = [];
  const push = (
    type: string,
    severity: ValidationIssueV2['severity'],
    message: string,
    sectionId: string | null,
    blockId: string | null,
    suggestedAction: string,
  ): void => {
    issues.push({
      issueId: deriveMockId('iss', `${type}:${sectionId ?? ''}:${blockId ?? ''}:${message}`, 12),
      type,
      severity,
      message,
      sectionId,
      blockId,
      citationId: null,
      suggestedAction,
    });
  };

  if (kinds.has('SCHEMA')) {
    for (const block of request.blocks) {
      if (block.text.trim().length === 0) {
        push(
          'SCHEMA',
          'ERROR',
          '블록 text가 비어 있습니다.',
          block.sectionId,
          block.blockId,
          '블록을 재생성하거나 삭제하십시오.',
        );
      }
    }
  }
  if (kinds.has('CITATION_COVERAGE')) {
    for (const block of request.blocks) {
      if (block.citations.length === 0) {
        push(
          'CITATION_COVERAGE',
          'WARNING',
          '블록에 인용 근거가 없습니다.',
          block.sectionId,
          block.blockId,
          '근거 검색(evidence/search)으로 인용을 보강하십시오.',
        );
      }
    }
  }
  if (kinds.has('UNSUPPORTED_CLAIM')) {
    for (const block of request.blocks) {
      if (/\d/.test(block.text) && block.citations.length === 0) {
        push(
          'UNSUPPORTED_CLAIM',
          'WARNING',
          '수치·연도가 포함된 주장에 인용이 없습니다.',
          block.sectionId,
          block.blockId,
          '수치의 출처를 인용으로 연결하십시오.',
        );
      }
    }
  }
  if (kinds.has('DUPLICATE_CONTENT')) {
    const seen = new Map<string, string>();
    for (const block of request.blocks) {
      const normalized = block.text.replace(NORMALIZE_RE, ' ').trim();
      if (normalized.length === 0) continue;
      const first = seen.get(normalized);
      if (first !== undefined) {
        push(
          'DUPLICATE_CONTENT',
          'WARNING',
          `블록 ${first}와(과) 내용이 중복됩니다.`,
          block.sectionId,
          block.blockId,
          '중복 블록을 통합하거나 삭제하십시오.',
        );
      } else {
        seen.set(normalized, block.blockId);
      }
    }
  }
  if (kinds.has('EXPRESSION_RULE')) {
    const rule = request.expressionRule as Record<string, unknown>;
    const maxLenRaw = rule.maxSentenceLength;
    const maxLen =
      typeof maxLenRaw === 'number' ? maxLenRaw : maxLenRaw ? Number(maxLenRaw) : undefined;
    const symbol = typeof rule.paragraphSymbol === 'string' ? rule.paragraphSymbol : undefined;
    for (const block of request.blocks) {
      if (maxLen !== undefined && Number.isFinite(maxLen)) {
        const tooLong = block.text
          .split(/(?<=[.!?다])\s+/)
          .some((sentence) => sentence.length > maxLen);
        if (tooLong) {
          push(
            'EXPRESSION_RULE',
            'INFO',
            `문장 길이가 maxSentenceLength(${maxLen})를 초과합니다.`,
            block.sectionId,
            block.blockId,
            '문장을 분리해 개조식으로 다듬으십시오.',
          );
        }
      }
      if (symbol && block.blockType === 'BULLET' && !block.text.startsWith(symbol)) {
        push(
          'EXPRESSION_RULE',
          'INFO',
          `개조식 블록이 문단 기호(${symbol})로 시작하지 않습니다.`,
          block.sectionId,
          block.blockId,
          `블록 서두에 ${symbol} 기호를 적용하십시오.`,
        );
      }
    }
  }
  if (kinds.has('MISSING_REQUIRED_SECTION')) {
    const covered = new Set(request.blocks.map((block) => block.sectionId));
    for (const section of request.outline) {
      if (section.required && !covered.has(section.sectionId)) {
        push(
          'MISSING_REQUIRED_SECTION',
          'ERROR',
          `필수 섹션 "${section.title}"에 본문 블록이 없습니다.`,
          section.sectionId,
          null,
          '해당 섹션의 본문을 생성하십시오.',
        );
      }
    }
  }

  issues.sort((a, b) => {
    const byType = a.type.localeCompare(b.type);
    if (byType !== 0) return byType;
    const bySection = String(a.sectionId ?? '').localeCompare(String(b.sectionId ?? ''));
    if (bySection !== 0) return bySection;
    return String(a.blockId ?? '').localeCompare(String(b.blockId ?? ''));
  });
  return { valid: issues.every((issue) => issue.severity !== 'ERROR'), issues };
}

export function buildMockErrorResponse(
  code: string,
  message: string,
  correlationId: string,
  retryable = false,
): ErrorResponseV2 {
  return { code, message, retryable, field: null, correlationId };
}
