import type { ContentCitationDraft, ContentDraft, TocNodeDraft } from '@une/domain';
import type {
  CitationV2,
  ContentBlockV2,
  ContentGenerationRequestV2,
  OutlineSectionV2,
} from './mock-target-v2-payloads';
import {
  TargetV2MappingError,
  toPlanRequestBase,
  type TargetV2RequestContext,
} from './target-v2-toc-mapper';

/**
 * UNE outline/content ↔ target-v2 ContentGenerationRequest/ContentBlock
 * mapping (CC-135, ADR-28 D7). The requested contract is NOT T3Q-accepted
 * (OB-10): this mapper feeds the in-process mock only, contentV2 stays
 * MOCK_ONLY.
 *
 * Canonical join (ADR-28 D7): v2 returns MANY blocks per section while
 * generated_block keeps ONE current row per node (0017 uk_current), so the
 * mapper joins a section's block texts in `order` into one ContentDraft.
 * Lossy fields (blockId/blockType/status/contentHash/warnings) survive in
 * rawResponse only — block-grained persistence is re-evaluated when
 * CR-T3Q-002 is accepted (CC-400).
 */

export const TARGET_V2_CONTENT_MAPPING_VERSION = 'v2-1.0.1-request@1';

/** UNE default roles for outlines that did not come from a v2 toc response
 * (user-edited/legacy outlines carry no semanticRole — OB-10 gap). */
const DEFAULT_SEMANTIC_ROLE = 'ACTION_PLAN';

interface OutlinePolicy {
  semanticRole?: unknown;
  generationPolicy?: unknown;
  required?: unknown;
  instruction?: unknown;
}

/** Confirmed UNE outline (keyed tree) → flat v2 OutlineSection[] with
 * absolute pre-order coordinates. Every node MUST carry a nodeKey — content
 * generation runs on confirmed TOC versions only. */
export function toOutlineSections(outline: readonly TocNodeDraft[]): OutlineSectionV2[] {
  const sections: OutlineSectionV2[] = [];
  let order = 0;
  const walk = (nodes: readonly TocNodeDraft[], parent: string | null, level: number): void => {
    nodes.forEach((node, index) => {
      if (!node.nodeKey) {
        throw new TargetV2MappingError(
          'outline',
          `outline node without nodeKey at level ${level} index ${index} — confirmed outlines are keyed`,
        );
      }
      const policy = (node.generationPolicy ?? {}) as OutlinePolicy;
      sections.push({
        sectionId: node.nodeKey,
        parentSectionId: parent,
        outlineLevel: level,
        order,
        title: node.title,
        semanticRole:
          typeof policy.semanticRole === 'string' && policy.semanticRole.length > 0
            ? policy.semanticRole
            : DEFAULT_SEMANTIC_ROLE,
        generationPolicy:
          typeof policy.generationPolicy === 'string' &&
          ['GENERATE', 'PRESERVE', 'USER_ONLY', 'REFERENCE_ONLY'].includes(policy.generationPolicy)
            ? (policy.generationPolicy as OutlineSectionV2['generationPolicy'])
            : 'GENERATE',
        required: typeof policy.required === 'boolean' ? policy.required : false,
        ...(typeof policy.instruction === 'string' && policy.instruction.length > 0
          ? { instruction: policy.instruction }
          : {}),
      });
      order += 1;
      walk(node.children ?? [], node.nodeKey, level + 1);
    });
  };
  walk(outline, null, 1);
  if (sections.length === 0) {
    throw new TargetV2MappingError('outline', 'outline must contain at least one section');
  }
  return sections;
}

export interface ContentRequestOptions {
  targetNodeKeys?: string[];
  /** Forwarded verbatim (mock-runtime id-space semantics — ADR-28, OB-10). */
  protectedBlockKeys?: string[];
  stream?: boolean;
}

export function toContentGenerationRequest(
  planContext: Record<string, unknown>,
  outline: readonly TocNodeDraft[],
  context: TargetV2RequestContext,
  options: ContentRequestOptions = {},
): ContentGenerationRequestV2 {
  const sections = toOutlineSections(outline);
  const targets = options.targetNodeKeys ?? [];
  if (targets.length > 0) {
    const known = new Set(sections.map((section) => section.sectionId));
    const unknown = targets.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      throw new TargetV2MappingError(
        'targetNodeKeys',
        `target keys not in the outline: ${unknown.join(', ')}`,
      );
    }
  }
  return {
    ...toPlanRequestBase(planContext, context),
    outline: sections,
    generationScope: targets.length > 0 ? 'SECTIONS' : 'ALL',
    ...(targets.length > 0 ? { targetSectionIds: targets } : {}),
    ...(options.protectedBlockKeys && options.protectedBlockKeys.length > 0
      ? { protectedBlockIds: options.protectedBlockKeys }
      : {}),
    generationOption: {
      stream: options.stream ?? false,
      citationRequired: true,
      partialResultAllowed: true,
    },
  };
}

export function fromCitationV2(citation: CitationV2): ContentCitationDraft {
  return {
    sourceRef: citation.citationId,
    fileName: citation.fileName,
    page: citation.page === null || citation.page === undefined ? null : String(citation.page),
    ...(citation.excerpt ? { excerpt: citation.excerpt } : {}),
    sourceId: citation.sourceId,
    documentId: citation.documentId,
    chunkId: citation.chunkId ?? null,
    score: citation.score,
    retrievedAt: citation.retrievedAt,
  };
}

export interface ContentBlocksMappingResult {
  sections: ContentDraft[];
  /** TARGETED outline nodes that received no blocks — the OBSERVED failure
   * view, independent of what the provider declares (review M-2: adapters
   * must not let a provider's self-report override observed omissions). */
  failedNodeKeys: string[];
}

/**
 * v2 ContentBlock[] → ContentDraft tree PARALLEL to the request outline
 * (anchorContentDrafts contract: position+title double match). Blocks are
 * grouped by sectionId and joined in `order`. A block whose sectionId is not
 * in the outline is a contract violation. Sections without blocks stay in
 * the tree with empty text; the ones that were actually TARGETED (all of
 * the outline unless targetNodeKeys narrows it) are reported in
 * failedNodeKeys — untargeted empty nodes are scope, not failure.
 */
export function fromContentBlocks(
  outline: readonly TocNodeDraft[],
  blocks: readonly ContentBlockV2[],
  targetNodeKeys?: readonly string[],
): ContentBlocksMappingResult {
  const bySection = new Map<string, ContentBlockV2[]>();
  for (const block of blocks) {
    const list = bySection.get(block.sectionId) ?? [];
    list.push(block);
    bySection.set(block.sectionId, list);
  }
  const knownKeys = new Set<string>();
  const collect = (nodes: readonly TocNodeDraft[]): void => {
    for (const node of nodes) {
      if (node.nodeKey) knownKeys.add(node.nodeKey);
      collect(node.children ?? []);
    }
  };
  collect(outline);
  for (const sectionId of bySection.keys()) {
    if (!knownKeys.has(sectionId)) {
      throw new TargetV2MappingError('blocks', `block sectionId not in the outline: ${sectionId}`);
    }
  }
  const targeted =
    targetNodeKeys && targetNodeKeys.length > 0 ? new Set(targetNodeKeys) : knownKeys;
  const failedNodeKeys: string[] = [];
  const walk = (nodes: readonly TocNodeDraft[]): ContentDraft[] =>
    nodes.map((node) => {
      const nodeKey = node.nodeKey as string;
      const sectionBlocks = [...(bySection.get(nodeKey) ?? [])].sort((a, b) => a.order - b.order);
      if (sectionBlocks.length === 0 && targeted.has(nodeKey)) failedNodeKeys.push(nodeKey);
      return {
        nodeKey,
        title: node.title,
        text: sectionBlocks.map((block) => block.text).join('\n'),
        citations: sectionBlocks.flatMap((block) => block.citations.map(fromCitationV2)),
        children: walk(node.children ?? []),
      };
    });
  return { sections: walk(outline), failedNodeKeys };
}
