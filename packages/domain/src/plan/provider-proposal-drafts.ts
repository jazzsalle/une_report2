import type { ContentCitationDraft } from './content-draft';

/**
 * PROVISIONAL canonical-lite shapes for target-v2 semantic edit / evidence /
 * validation adapter results (CC-135, ADR-28 D3). Single-provider by design:
 * the only producer is TargetV2T3qPlanAdapter (mock runtime, OB-10/OB-11
 * open) and the only consumers are adapter tests — no UNE pipeline persists
 * or acts on these yet. CC-150 (ChangeSet/ai_edit_proposal) and CC-230
 * (immutable EvidenceSet) own the durable models and MAY redefine these
 * types; keeping them here (not in the adapter) only enforces the
 * architecture rule that provider DTOs never leak past the adapter.
 *
 * Naming: *Key fields carry provider-issued ids verbatim (opaque to UNE),
 * mirroring ContentDraft.nodeKey. UNE-issued UUIDs never appear here.
 */

export const EDIT_PROPOSAL_OPERATION_TYPES = [
  'REPLACE_RANGE',
  'REPLACE_BLOCK',
  'INSERT_BLOCK',
  'DELETE_BLOCK',
] as const;

export type EditProposalOperationType = (typeof EDIT_PROPOSAL_OPERATION_TYPES)[number];

export interface EditProposalOperationDraft {
  operationType: EditProposalOperationType;
  /** Provider block id the operation targets; null for INSERT_BLOCK. */
  targetBlockKey: string | null;
  /** Operation payload kept open — the contract leaves it additionalProperties:
   * true and UNE must not invent structure beyond what CC-150 will bind. */
  payload: Record<string, unknown>;
}

export interface ProposedBlockDraft {
  blockKey: string;
  /** Provider sectionId (== TOC nodeKey in the v2 id model). */
  nodeKey: string;
  order: number;
  text: string;
  citations: ContentCitationDraft[];
  warnings: string[];
}

/** ChangeProposal, canonicalized. Proposals are NEVER applied by adapters —
 * applying is a UNE Revision/ChangeSet concern (CC-150, US-PLAN-016 AC-02). */
export interface EditProposalDraft {
  proposalKey: string;
  /** Echo of the request's baseRevisionId — conflict detection stays UNE-owned. */
  baseRevisionKey: string;
  operations: EditProposalOperationDraft[];
  proposedBlocks: ProposedBlockDraft[];
  citations: ContentCitationDraft[];
  warnings: string[];
}

/** v2 Citation with block-support links, for evidence search results.
 * Extends the reserved provenance slots of ContentCitationDraft (ADR-26 D4). */
export interface EvidenceItemDraft extends ContentCitationDraft {
  supportsBlockKeys: string[];
}

export const VALIDATION_ISSUE_SEVERITIES = ['INFO', 'WARNING', 'ERROR'] as const;

export type ValidationIssueSeverity = (typeof VALIDATION_ISSUE_SEVERITIES)[number];

export interface ValidationIssueDraft {
  issueKey: string;
  /** Contract leaves type an open string; the six requested kinds live in
   * T3Q_VALIDATION_TYPES (provider-adapters) — unknown types must survive. */
  type: string;
  severity: ValidationIssueSeverity;
  message: string;
  nodeKey: string | null;
  blockKey: string | null;
  citationKey: string | null;
  suggestedAction?: string;
}

/** Validation report, canonicalized. MOCK_ONLY governance (ADR-28 D9): no
 * UNE pipeline may gate or block on this result while the feature registry
 * state is MOCK_ONLY — a mock verdict is not a provider verdict. */
export interface ValidationReportDraft {
  valid: boolean;
  issues: ValidationIssueDraft[];
}
