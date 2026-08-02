import type { EditProposalDraft } from '@une/domain';
import type { ChangeProposalV2, SemanticEditRequestV2 } from './mock-target-v2-payloads';
import { fromCitationV2 } from './target-v2-content-mapper';
import {
  TargetV2MappingError,
  toPlanRequestBase,
  type TargetV2RequestContext,
} from './target-v2-toc-mapper';
import type { T3qSemanticEditRequest } from './t3q-plan-port';

/**
 * Semantic edit request/proposal mapping (CC-135, CR-T3Q-004, ADR-28).
 * Adapters return PROPOSALS only — applying them is a UNE Revision/ChangeSet
 * concern (CC-150, US-PLAN-016 AC-02). Editing a protected block is a
 * UNE-side request defect and fails before anything leaves the port.
 */

export const TARGET_V2_EDIT_MAPPING_VERSION = 'v2-1.0.1-request@1';

export function toSemanticEditRequest(
  request: T3qSemanticEditRequest,
  context: TargetV2RequestContext,
): SemanticEditRequestV2 {
  const target = request.target;
  if (request.instruction.trim().length === 0) {
    throw new TargetV2MappingError('instruction', 'instruction must be a non-empty string');
  }
  if (target.targetType === 'RANGE' || target.targetType === 'BLOCK') {
    if (!target.blockKey) {
      throw new TargetV2MappingError(
        'target.blockKey',
        `${target.targetType} target requires blockKey`,
      );
    }
  }
  if (target.targetType === 'RANGE') {
    const range = target.range;
    if (
      !range ||
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.start >= range.end
    ) {
      throw new TargetV2MappingError('target.range', 'RANGE target requires 0 <= start < end');
    }
  }
  if (target.targetType === 'SECTION' && !target.nodeKey) {
    throw new TargetV2MappingError('target.nodeKey', 'SECTION target requires nodeKey');
  }
  const protectedKeys = request.protectedBlockKeys ?? [];
  if (target.blockKey && protectedKeys.includes(target.blockKey)) {
    throw new TargetV2MappingError(
      'target.blockKey',
      `protected block cannot be an edit target: ${target.blockKey}`,
    );
  }
  return {
    ...toPlanRequestBase(request.planContext, context),
    target: {
      targetType: target.targetType,
      sectionId: target.nodeKey ?? null,
      blockId: target.blockKey ?? null,
      range:
        target.targetType === 'RANGE' ? (target.range as { start: number; end: number }) : null,
    },
    instruction: request.instruction,
    ...(request.selectedText !== undefined ? { selectedText: request.selectedText } : {}),
    ...(request.surroundingContext !== undefined
      ? { surroundingContext: request.surroundingContext }
      : {}),
    ...(request.preserveCitationIds && request.preserveCitationIds.length > 0
      ? { preserveCitationIds: request.preserveCitationIds }
      : {}),
    ...(protectedKeys.length > 0 ? { protectedBlockIds: protectedKeys } : {}),
  };
}

export function fromChangeProposal(proposal: ChangeProposalV2): EditProposalDraft {
  return {
    proposalKey: proposal.proposalId,
    baseRevisionKey: proposal.baseRevisionId,
    operations: proposal.operations.map((operation) => ({
      operationType:
        operation.operationType as EditProposalDraft['operations'][number]['operationType'],
      targetBlockKey: operation.targetId ?? null,
      payload: (operation.payload ?? {}) as Record<string, unknown>,
    })),
    proposedBlocks: proposal.proposedBlocks.map((block) => ({
      blockKey: block.blockId,
      nodeKey: block.sectionId,
      order: block.order,
      text: block.text,
      citations: block.citations.map(fromCitationV2),
      warnings: [...block.warnings],
    })),
    citations: proposal.citations.map(fromCitationV2),
    warnings: [...proposal.warnings],
  };
}

/** Response-side protection re-check — the MECHANISM behind "the provider
 * must not touch protected blocks" (ADR-28 D8). Violations quarantine the
 * whole proposal via T3Q_RESPONSE_CONTRACT_VIOLATION. Operation payloads are
 * scanned RECURSIVELY (review m-5): the contract leaves payload open and the
 * INSERT_BLOCK targetId convention is itself OPEN (gap matrix §3), so a
 * protected id arriving only via payload (e.g. afterBlockId) must not slip
 * through — over-matching quarantines, which is the safe direction. */
export function findProtectedBlockViolations(
  proposal: ChangeProposalV2,
  protectedBlockKeys: readonly string[],
): string[] {
  if (protectedBlockKeys.length === 0) return [];
  const protectedSet = new Set(protectedBlockKeys);
  const violations = new Set<string>();
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      if (protectedSet.has(value)) violations.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) scan(entry);
      return;
    }
    if (value && typeof value === 'object') {
      for (const entry of Object.values(value)) scan(entry);
    }
  };
  for (const operation of proposal.operations) {
    if (operation.targetId && protectedSet.has(operation.targetId))
      violations.add(operation.targetId);
    scan(operation.payload);
  }
  for (const block of proposal.proposedBlocks) {
    if (protectedSet.has(block.blockId)) violations.add(block.blockId);
  }
  return [...violations].sort();
}
