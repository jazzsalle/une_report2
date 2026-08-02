import { describe, expect, it } from 'vitest';
import {
  APPROVAL_LOCKED_STATUSES,
  PLAN_STATUSES,
  canStartContentJob,
  canStartTocJob,
  nextStatusOnContentJobAbort,
  nextStatusOnContentJobStart,
  nextStatusOnContentJobSuccess,
  nextStatusOnContextConfirm,
  nextStatusOnTocConfirm,
  nextStatusOnTocJobAbort,
  nextStatusOnTocJobStart,
  nextStatusOnTocJobSuccess,
} from './plan-status';

describe('plan status model (design 09 §4)', () => {
  it('covers the 13 designed statuses', () => {
    expect(PLAN_STATUSES).toHaveLength(13);
    expect(PLAN_STATUSES).toContain('DRAFT');
    expect(PLAN_STATUSES).toContain('FINAL');
  });

  it('advances only DRAFT to CONTEXT_READY on context confirm', () => {
    expect(nextStatusOnContextConfirm('DRAFT')).toBe('CONTEXT_READY');
    for (const status of PLAN_STATUSES.filter((s) => s !== 'DRAFT')) {
      expect(nextStatusOnContextConfirm(status)).toBe(status);
    }
  });

  it('locks approval outcomes', () => {
    expect([...APPROVAL_LOCKED_STATUSES].sort()).toEqual(['APPROVED', 'FINAL']);
  });

  it('starts TOC jobs only from CONTEXT_READY/OUTLINE_REVIEW/OUTLINE_CONFIRMED', () => {
    const startable = PLAN_STATUSES.filter(canStartTocJob);
    expect(startable.sort()).toEqual(['CONTEXT_READY', 'OUTLINE_CONFIRMED', 'OUTLINE_REVIEW']);
  });

  it('runs the TOC job transition cycle without ever using ERROR', () => {
    expect(nextStatusOnTocJobStart()).toBe('OUTLINE_GENERATING');
    expect(nextStatusOnTocJobSuccess()).toBe('OUTLINE_REVIEW');
    expect(nextStatusOnTocJobAbort(false)).toBe('CONTEXT_READY');
    expect(nextStatusOnTocJobAbort(true)).toBe('OUTLINE_REVIEW');
    expect(nextStatusOnTocConfirm()).toBe('OUTLINE_CONFIRMED');
  });

  // ── CC-130 (ADR-27) ──

  it('starts CONTENT jobs only from OUTLINE_CONFIRMED/EDITING', () => {
    const startable = PLAN_STATUSES.filter(canStartContentJob);
    expect(startable.sort()).toEqual(['EDITING', 'OUTLINE_CONFIRMED']);
  });

  it('runs the CONTENT job transition cycle without ever using ERROR', () => {
    expect(nextStatusOnContentJobStart()).toBe('CONTENT_GENERATING');
    expect(nextStatusOnContentJobSuccess()).toBe('EDITING');
    expect(nextStatusOnContentJobAbort(false)).toBe('OUTLINE_CONFIRMED');
    expect(nextStatusOnContentJobAbort(true)).toBe('EDITING');
  });

  it('keeps the TOC startable set unchanged (content-exists blocking is a service-layer 412)', () => {
    // ADR-27 D9: the set is intentionally NOT narrowed here — the service
    // layer blocks TOC regeneration when current blocks exist so anchors
    // cannot be orphaned; the impact-diff flow is CC-170.
    expect(PLAN_STATUSES.filter(canStartTocJob).sort()).toEqual([
      'CONTEXT_READY',
      'OUTLINE_CONFIRMED',
      'OUTLINE_REVIEW',
    ]);
  });
});
