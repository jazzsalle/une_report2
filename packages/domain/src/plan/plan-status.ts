/** Plan status model (design 09 §4). Transitions live here as explicit
 * domain functions (architecture rule) — persistence only records the
 * decided value. Moved from services/api in CC-120 so the worker shares the
 * same state machine (ADR-25). */

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
 * handling is CC-120+ scope (ADR-23 D4). */
export function nextStatusOnContextConfirm(current: string): string {
  return current === 'DRAFT' ? 'CONTEXT_READY' : current;
}

/** Statuses from which a TOC generation job may start (CC-120, ADR-25).
 * DRAFT is excluded — no confirmed snapshot exists there (PLAN-412-001 path);
 * OUTLINE_GENERATING is excluded — the active-job check answers 409;
 * CONTENT_* and later are CC-130 regeneration-warning scope. */
const TOC_JOB_STARTABLE: ReadonlySet<string> = new Set([
  'CONTEXT_READY',
  'OUTLINE_REVIEW',
  'OUTLINE_CONFIRMED',
]);

export function canStartTocJob(current: string): boolean {
  return TOC_JOB_STARTABLE.has(current);
}

export function nextStatusOnTocJobStart(): string {
  return 'OUTLINE_GENERATING';
}

export function nextStatusOnTocJobSuccess(): string {
  return 'OUTLINE_REVIEW';
}

/** Failure/cancel never sends the plan to ERROR (job.status carries the
 * failure); the plan returns to where it was — derived from whether an
 * outline already exists (US-PLAN-009 E-02: 기존 산출물 보존). */
export function nextStatusOnTocJobAbort(hasTocVersion: boolean): string {
  return hasTocVersion ? 'OUTLINE_REVIEW' : 'CONTEXT_READY';
}

/** Saving a user-edited TOC version keeps OUTLINE_REVIEW; explicit confirm
 * advances to OUTLINE_CONFIRMED (SCR-PLAN-006). */
export function nextStatusOnTocConfirm(): string {
  return 'OUTLINE_CONFIRMED';
}

/** Statuses from which a CONTENT generation job may start (CC-130, ADR-27).
 * OUTLINE_CONFIRMED is the entry (US-PLAN-012 precondition: confirmed
 * outline); EDITING allows regeneration rounds (protected blocks are
 * preserved by the worker filter). CONTENT_GENERATING is excluded — the
 * active-job check answers 409. NOTE: TOC_JOB_STARTABLE stays unchanged on
 * purpose — once content exists, restarting TOC generation is blocked at
 * the service layer (412) so protected-block anchors cannot be orphaned
 * (ADR-27 D9; the impact-diff flow is CC-170). */
const CONTENT_JOB_STARTABLE: ReadonlySet<string> = new Set(['OUTLINE_CONFIRMED', 'EDITING']);

export function canStartContentJob(current: string): boolean {
  return CONTENT_JOB_STARTABLE.has(current);
}

export function nextStatusOnContentJobStart(): string {
  return 'CONTENT_GENERATING';
}

/** Success always lands in EDITING (SCR-PLAN-007: generated body is an
 * editing surface, not an approval state). */
export function nextStatusOnContentJobSuccess(): string {
  return 'EDITING';
}

/** Failure/cancel never sends the plan to ERROR (ADR-25 D6 precedent);
 * the plan returns to where content work stands — EDITING when any current
 * block exists (earlier rounds survive), else back to OUTLINE_CONFIRMED. */
export function nextStatusOnContentJobAbort(hasCurrentBlocks: boolean): string {
  return hasCurrentBlocks ? 'EDITING' : 'OUTLINE_CONFIRMED';
}
