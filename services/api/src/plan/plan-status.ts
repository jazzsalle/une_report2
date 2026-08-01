/** Plan status model (design 09 §4). Transitions live here as explicit
 * domain functions (architecture rule) — persistence only records the
 * decided value. */

export const PLAN_STATUSES = [
  'DRAFT',
  'CONTEXT_READY',
  'OUTLINE_GENERATING',
  'OUTLINE_REVIEW',
  'OUTLINE_CONFIRMED',
  'CONTENT_GENERATING',
  'EDITING',
  'REVIEW_REQUESTED',
  'CHANGES_REQUESTED',
  'APPROVED',
  'FINAL',
  'REOPENED',
  'ERROR',
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Approval outcomes are records: no trash move, no context rework in
 * CC-110 (re-opening them is the approval-flow item, CC-170+; ADR-23 D4). */
export const APPROVAL_LOCKED_STATUSES: ReadonlySet<string> = new Set(['APPROVED', 'FINAL']);

/** Context snapshot confirm advances a DRAFT plan to CONTEXT_READY
 * (US-PLAN-007); later states keep their status — regeneration impact
 * handling is CC-120 scope (ADR-23 D4). */
export function nextStatusOnContextConfirm(current: string): string {
  return current === 'DRAFT' ? 'CONTEXT_READY' : current;
}
