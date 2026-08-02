import type { BlockAnchor } from './document-ir';
import type { SelectionEnvelope } from './selection';

export type { BlockAnchor };

/**
 * ChangeSet vocabulary (CC-150, ADR-30; design 07 §1.9).
 *
 * A ChangeSet is the ONLY way a document changes. It is atomic: either every
 * operation applies and a new revision exists, or nothing happened
 * (§1.9 "on error: rollback() + no partial document mutation"). Corrections
 * are new ChangeSets, never rewrites of an applied one — CLAUDE.md's
 * "never overwrite audit history" applies to editing exactly as it applies
 * to execution events.
 */

/** The eight operations §1.9 fixes. This list does not grow without an ADR:
 * every consumer (executor, inverse generator, diff, audit) switches on it
 * exhaustively. */
export const CHANGE_OPERATION_TYPES = [
  'INSERT_BLOCKS',
  'REPLACE_RANGE',
  'DELETE_RANGE',
  'SPLIT_PARAGRAPH',
  'MERGE_PARAGRAPHS',
  'MOVE_BLOCK',
  'APPLY_STYLE_ROLE',
  'TABLE_PATCH',
] as const;

export type ChangeOperationType = (typeof CHANGE_OPERATION_TYPES)[number];

/** Where a ChangeSet came from. Undo/Redo do NOT get a separate stack —
 * §1.9 keeps AI and user edits in one stack — so this is for audit and
 * display, while ORDER is what actually defines the stack. */
export const CHANGE_SET_ORIGINS = [
  'USER',
  'AI',
  'AUTOSAVE',
  'UNDO',
  'REDO',
  'RESTORE',
  'MATERIALIZE',
] as const;

export type ChangeSetOrigin = (typeof CHANGE_SET_ORIGINS)[number];

/** Where new blocks come from. `GENERATED_BLOCKS` is the materialize path
 * (ADR-27 D2 assigned generated_block → document materialize to CC-150):
 * modelled as a SOURCE of INSERT_BLOCKS rather than a new operation, so the
 * §1.9 vocabulary stays closed. */
export type InsertSource =
  | { kind: 'INLINE'; blocks: unknown[] }
  | { kind: 'PROTOTYPE'; prototypeId: string; count: number }
  | { kind: 'GENERATED_BLOCKS'; planId: string; tocVersionId: string };

export interface ChangeOperation {
  type: ChangeOperationType;
  /** Position within the ChangeSet. Operations apply in this order and the
   * inverse set applies in reverse. */
  order: number;
  selection?: SelectionEnvelope;
  anchor?: BlockAnchor;
  source?: InsertSource;
  /** Operation-specific payload. Left open on purpose: the eight types have
   * genuinely different shapes and the strict per-type schema lives in
   * contracts/schemas/change-set.schema.json. */
  payload?: Record<string, unknown>;
}

export interface ChangeSetRequest {
  /** Optimistic-concurrency partner of the If-Match header (ADR-30 D4). */
  baseRevisionId: string;
  origin: ChangeSetOrigin;
  operations: ChangeOperation[];
  /** Idempotency anchor for retried submissions. */
  clientMutationId?: string;
  /** Build the diff and validate, but create no revision (US-PLAN-017 A-01:
   * the user approves a Diff before the document moves). */
  dryRun?: boolean;
}

/** Why a ChangeSet was refused. Carried in the 422 violations array so the
 * UI can point at the offending node instead of saying "invalid". */
export const CHANGE_REJECTION_REASONS = [
  'NODE_NOT_FOUND',
  'LOCKED_BLOCK',
  'STATIC_REGION',
  'TABLE_BOUNDARY',
  'CELL_MIN_ONE_PARAGRAPH',
  'INCOMPATIBLE_STYLE',
  'PROTECTED_BLOCK',
  'UNDO_CONFLICT',
  'UNSUPPORTED_OPERATION',
  /** A newly derived stable id already exists. Never re-issued with a bumped
   * seq: that would make the same (changeSetId, opOrder, seq) coordinate point
   * at a different node, breaking determinism and pointing Undo at the wrong
   * target. It is an error, not a retry. */
  'ID_COLLISION',
] as const;

export type ChangeRejectionReason = (typeof CHANGE_REJECTION_REASONS)[number];

export interface ChangeViolation {
  reason: ChangeRejectionReason;
  /** Stable id of the node that caused it, when there is one. */
  nodeId?: string;
  operationOrder?: number;
  detail: string;
}

/** One entry of the diff §1.9 requires before commit. */
export interface DiffEntry {
  kind: 'ADDED' | 'REMOVED' | 'MODIFIED' | 'MOVED';
  nodeId: string;
  /** Text preview is deliberately optional and short — change_operation
   * payloads carry document body, which must never reach INFO logs
   * (.claude/rules/backend.md). */
  preview?: string;
}

/** A node remapping. `offsetDelta` is not optional bookkeeping: without it a
 * re-read finds the right node but the wrong character position — MERGE shifts
 * every offset in the right-hand paragraph by the left one's length. */
export interface NodeAlias {
  from: string;
  to: string;
  offsetDelta: number;
}

export interface ChangeSetResult {
  changeSetId: string;
  newRevisionId: string;
  newRevisionNo: number;
  irHash: string;
  diff: DiffEntry[];
  /** Inverse operations, stored so Undo is a data lookup rather than a
   * re-derivation at undo time (ADR-30 D6 proves invert∘apply == identity). */
  inverseOperations: ChangeOperation[];
  /** Node id remappings produced by MERGE, used by SelectionResolver to
   * re-read selections captured before this ChangeSet (§1.8-2). SPLIT emits
   * none — the left paragraph keeps its id, so older selections stay valid. */
  aliases: NodeAlias[];
  /** Aliases this ChangeSet INVALIDATES (a MERGE being undone restores the
   * paragraph the alias pointed away from). An append-only alias list cannot
   * express that, so removals travel separately. */
  aliasRemovals?: NodeAlias[];
}
