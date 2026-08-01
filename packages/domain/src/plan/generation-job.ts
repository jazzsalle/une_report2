import { sha256Hex } from '../canonical-json';

/** generation_job state machine and event vocabulary (CC-120, ADR-25).
 * Persistence records decided values only; the API and the worker both
 * consult this module so transitions cannot drift between processes. */

export const JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'CANCEL_REQUESTED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_TYPES = ['TOC', 'CONTENT', 'AI_EDIT', 'SOP'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set(['COMPLETED', 'CANCELLED']);

/** FAILED is retriable (UNE-PLAN-013), so it is not terminal. */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  QUEUED: ['RUNNING', 'CANCEL_REQUESTED', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'FAILED', 'CANCEL_REQUESTED'],
  // The worker checkpoint resolves a cancel request; a provider failure can
  // still land first.
  CANCEL_REQUESTED: ['CANCELLED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['QUEUED'],
  CANCELLED: [],
};

export function canTransitionJob(from: string, to: string): boolean {
  return (TRANSITIONS[from as JobStatus] ?? []).includes(to as JobStatus);
}

/** Public SSE event vocabulary (contract UNE-PLAN-011). Everything else is
 * internal bookkeeping (raw provider traces) and must never be streamed. */
export const PUBLIC_JOB_EVENT_TYPES = [
  'job.queued',
  'job.started',
  'job.progress',
  'toc.section',
  'job.completed',
  'job.failed',
  'job.cancel_requested',
  'job.cancelled',
  'job.retry_requested',
] as const;

export const INTERNAL_JOB_EVENT_TYPES = [
  'provider.requested',
  'provider.responded',
  'provider.failed',
] as const;

export type JobEventType =
  (typeof PUBLIC_JOB_EVENT_TYPES)[number] | (typeof INTERNAL_JOB_EVENT_TYPES)[number];

const PUBLIC_EVENTS: ReadonlySet<string> = new Set(PUBLIC_JOB_EVENT_TYPES);

export function isPublicJobEvent(eventType: string): boolean {
  return PUBLIC_EVENTS.has(eventType);
}

/**
 * generation_job.idempotency_key (uk_job_idempotency is (tenant_id, key)
 * only): the hash binds job type, endpoint template AND the aggregate id so
 * a client key reused across endpoints or across plans can never collide on
 * the unique index and hand back another aggregate's job (review M2,
 * ADR-25 D7). 64 hex chars fits varchar(100).
 */
export function jobIdempotencyKey(
  jobType: JobType,
  endpointTemplate: string,
  aggregateId: string,
  clientKey: string,
): string {
  return sha256Hex(`${jobType}|${endpointTemplate}|${aggregateId}|${clientKey}`);
}
