import { describe, expect, it } from 'vitest';
import { APPROVAL_LOCKED_STATUSES, PLAN_STATUSES, nextStatusOnContextConfirm } from './plan-status';

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
});
