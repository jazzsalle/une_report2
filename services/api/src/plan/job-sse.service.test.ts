import { firstValueFrom, toArray } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../common/request-context';
import type { DatabaseService } from '../db/database.service';
import type { GenerationJobRepository } from './generation-job.repository';
import type { JobEventRepository, JobEventRow } from './job-event.repository';
import { JobSseService, parseLastEventId } from './job-sse.service';

const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const JOB_ID = '66666666-6666-6666-6666-666666666666';

const auth: AuthContext = { userId: USER_ID, tenantId: TENANT_ID, sessionId: USER_ID };

function event(sequenceNo: number, eventType: string): JobEventRow {
  return {
    sequenceNo,
    eventType,
    payload: { step: eventType },
    createdAt: new Date('2026-08-01T00:00:00Z'),
  };
}

/** listPublicSince answers one scripted page per poll tick. */
function harness(pages: JobEventRow[][], options: Record<string, number> = {}, jobExists = true) {
  const db = {
    withTenant: async <T>(_tenantId: string, fn: (c: unknown) => Promise<T>): Promise<T> => fn({}),
  };
  const jobs = { findJob: vi.fn(async () => (jobExists ? { jobId: JOB_ID } : null)) };
  let tick = 0;
  const listPublicSince = vi.fn(async (_c: unknown, _t: string, _j: string, after: number) => {
    const page = pages[tick] ?? [];
    tick += 1;
    return page.filter((row) => row.sequenceNo > after);
  });
  const events = { listPublicSince };
  const service = new JobSseService(
    db as unknown as DatabaseService,
    jobs as unknown as GenerationJobRepository,
    events as unknown as JobEventRepository,
    { pollMs: 10, heartbeatMs: 30, maxLifetimeMs: 2_000, ...options },
  );
  return { service, jobs, listPublicSince };
}

describe('JobSseService.stream', () => {
  it('rejects an unknown job with 404 JOB-404-001 before the stream opens', async () => {
    const h = harness([], {}, false);
    await expect(h.service.stream(auth, JOB_ID)).rejects.toMatchObject({
      status: 404,
      code: 'JOB-404-001',
    });
  });

  it('emits public events in sequence order with id = sequence_no and completes on the terminal event', async () => {
    const h = harness([
      [event(1, 'job.queued'), event(2, 'job.started')],
      [event(3, 'job.progress')],
      [event(4, 'job.completed'), event(5, 'toc.section')],
    ]);
    const messages = await firstValueFrom((await h.service.stream(auth, JOB_ID)).pipe(toArray()));
    expect(messages.map((m) => m.type)).toEqual([
      'job.queued',
      'job.started',
      'job.progress',
      'job.completed',
    ]);
    expect(messages.map((m) => m.id)).toEqual(['1', '2', '3', '4']);
    expect(JSON.parse(messages[0].data as string)).toEqual({
      jobId: JOB_ID,
      type: 'job.queued',
      payload: { step: 'job.queued' },
      sequenceNo: 1,
    });
  });

  it.each(['job.failed', 'job.cancelled'])('completes the stream on %s', async (terminal) => {
    const h = harness([[event(1, 'job.started'), event(2, terminal)]]);
    const messages = await firstValueFrom((await h.service.stream(auth, JOB_ID)).pipe(toArray()));
    expect(messages.map((m) => m.type)).toEqual(['job.started', terminal]);
  });

  it('resumes after Last-Event-ID without replaying delivered events', async () => {
    const h = harness([[event(1, 'job.queued'), event(2, 'job.completed')]]);
    const messages = await firstValueFrom(
      (await h.service.stream(auth, JOB_ID, '1')).pipe(toArray()),
    );
    expect(messages.map((m) => m.id)).toEqual(['2']);
    expect(h.listPublicSince.mock.calls[0][3]).toBe(1);
  });

  it('sends a heartbeat after an idle interval and keeps the resume point unchanged', async () => {
    // pollMs 10 / heartbeatMs 30 -> a heartbeat every 3 idle ticks.
    const h = harness([[event(1, 'job.started')], [], [], [], [event(2, 'job.completed')]]);
    const messages = await firstValueFrom((await h.service.stream(auth, JOB_ID)).pipe(toArray()));
    expect(messages.map((m) => m.type)).toEqual(['job.started', 'heartbeat', 'job.completed']);
    // The heartbeat repeats the last delivered sequence_no instead of carrying a
    // new one, so a reconnect resumes exactly where the data stream left off
    // (Nest's SseStream fabricates an id for any frame that omits it).
    expect(messages[1].id).toBe('1');
    expect(messages[1].data).toBe('{}');
  });

  it('ends the stream when the maximum lifetime elapses', async () => {
    const h = harness([], { pollMs: 10, heartbeatMs: 10_000, maxLifetimeMs: 35 });
    const messages = await firstValueFrom((await h.service.stream(auth, JOB_ID)).pipe(toArray()));
    expect(messages).toEqual([]);
    expect(h.listPublicSince.mock.calls.length).toBeGreaterThan(0);
  });

  it('stops polling once the subscriber unsubscribes', async () => {
    const h = harness([[], [], [], [], [], []], { heartbeatMs: 10_000 });
    const subscription = (await h.service.stream(auth, JOB_ID)).subscribe();
    await new Promise((resolve) => setTimeout(resolve, 35));
    subscription.unsubscribe();
    const polls = h.listPublicSince.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(h.listPublicSince.mock.calls.length).toBe(polls);
  });
});

describe('parseLastEventId', () => {
  it('treats an absent or empty header as "from the beginning"', () => {
    expect(parseLastEventId(undefined)).toBe(0);
    expect(parseLastEventId('  ')).toBe(0);
  });

  it('rejects a non-numeric header with 400 COM-0400', () => {
    expect(() => parseLastEventId('abc')).toThrowError(
      expect.objectContaining({ status: 400, code: 'COM-0400' }),
    );
    expect(() => parseLastEventId('-1')).toThrowError(
      expect.objectContaining({ status: 400, code: 'COM-0400' }),
    );
  });
});

describe('contract-pinned SSE defaults (UNE-PLAN-011)', () => {
  it('keeps heartbeat 15s and max lifetime 30min in sync with the contract description', async () => {
    const { DEFAULT_HEARTBEAT_MS, DEFAULT_MAX_LIFETIME_MS } = await import('./job-sse.service');
    expect(DEFAULT_HEARTBEAT_MS).toBe(15_000);
    expect(DEFAULT_MAX_LIFETIME_MS).toBe(30 * 60_000);
  });
});
