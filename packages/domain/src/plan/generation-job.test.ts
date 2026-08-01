import { describe, expect, it } from 'vitest';
import {
  INTERNAL_JOB_EVENT_TYPES,
  JOB_STATUSES,
  PUBLIC_JOB_EVENT_TYPES,
  TERMINAL_JOB_STATUSES,
  canTransitionJob,
  isPublicJobEvent,
  jobIdempotencyKey,
} from './generation-job';

describe('generation job state machine', () => {
  it('allows exactly the designed transitions', () => {
    const allowed: Array<[string, string]> = [
      ['QUEUED', 'RUNNING'],
      ['QUEUED', 'CANCEL_REQUESTED'],
      ['QUEUED', 'CANCELLED'],
      ['RUNNING', 'COMPLETED'],
      ['RUNNING', 'FAILED'],
      ['RUNNING', 'CANCEL_REQUESTED'],
      ['CANCEL_REQUESTED', 'CANCELLED'],
      ['CANCEL_REQUESTED', 'FAILED'],
      ['FAILED', 'QUEUED'],
    ];
    const allowedSet = new Set(allowed.map(([f, t]) => `${f}>${t}`));
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        expect(canTransitionJob(from, to), `${from} -> ${to}`).toBe(
          allowedSet.has(`${from}>${to}`),
        );
      }
    }
  });

  it('treats COMPLETED/CANCELLED as terminal but FAILED as retriable', () => {
    expect(TERMINAL_JOB_STATUSES.has('COMPLETED')).toBe(true);
    expect(TERMINAL_JOB_STATUSES.has('CANCELLED')).toBe(true);
    expect(TERMINAL_JOB_STATUSES.has('FAILED')).toBe(false);
    expect(canTransitionJob('FAILED', 'QUEUED')).toBe(true);
  });

  it('separates public SSE vocabulary from internal provider traces', () => {
    for (const type of PUBLIC_JOB_EVENT_TYPES) expect(isPublicJobEvent(type)).toBe(true);
    for (const type of INTERNAL_JOB_EVENT_TYPES) expect(isPublicJobEvent(type)).toBe(false);
  });

  it('derives deterministic keys that cannot collide across endpoints OR aggregates', () => {
    const planA = '2d47b8e1-0c95-4f36-a7d2-6b13e8f5c904';
    const planB = '6b05a9c3-1e72-4b48-9f30-c5d8e1a7b264';
    const a = jobIdempotencyKey('TOC', 'POST /plans/{planId}/toc-jobs', planA, 'client-key-1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(
      jobIdempotencyKey('TOC', 'POST /plans/{planId}/toc-jobs', planA, 'client-key-1'),
    );
    expect(a).not.toBe(
      jobIdempotencyKey('CONTENT', 'POST /plans/{planId}/content-jobs', planA, 'client-key-1'),
    );
    // Same client key on another plan must be a different job (review M2).
    expect(a).not.toBe(
      jobIdempotencyKey('TOC', 'POST /plans/{planId}/toc-jobs', planB, 'client-key-1'),
    );
    expect(a).not.toBe(
      jobIdempotencyKey('TOC', 'POST /plans/{planId}/toc-jobs', planA, 'client-key-2'),
    );
  });
});
