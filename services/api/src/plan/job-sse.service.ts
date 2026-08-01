import { Inject, Injectable, Optional, type MessageEvent } from '@nestjs/common';
import { from, timer, type Observable } from 'rxjs';
import { concatMap, takeUntil, takeWhile } from 'rxjs/operators';
import { ApiError } from '../common/api-error';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { GenerationJobRepository } from './generation-job.repository';
import { JobEventRepository, type JobEventRow } from './job-event.repository';
import { jobErrors } from './toc-errors';

export const JOB_SSE_OPTIONS = 'une:jobSseOptions';

export interface JobSseOptions {
  pollMs?: number;
  heartbeatMs?: number;
  maxLifetimeMs?: number;
}

/** Poll cadence for job_event. Short enough to feel live on SCR-PLAN-006,
 * long enough that an idle stream costs one indexed lookup per tick. */
export const DEFAULT_POLL_MS = 400;
/** Contract UNE-PLAN-011: heartbeat every 15 s. */
export const DEFAULT_HEARTBEAT_MS = 15_000;
/** Contract UNE-PLAN-011: the server ends the stream after 30 minutes and the
 * client reconnects with Last-Event-ID. */
export const DEFAULT_MAX_LIFETIME_MS = 30 * 60_000;

/** After these the job cannot produce further public events. */
const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'job.completed',
  'job.failed',
  'job.cancelled',
]);

const LAST_EVENT_ID_PATTERN = /^[0-9]{1,18}$/;

function invalidLastEventId(): ApiError {
  return new ApiError(400, 'COM-0400', 'Last-Event-ID 헤더가 올바르지 않습니다.', {
    violations: [{ field: 'Last-Event-ID', reason: '마지막으로 수신한 순번(숫자)이어야 합니다.' }],
  });
}

function toMessage(jobId: string, row: JobEventRow): MessageEvent {
  return {
    // id is the job_event.sequence_no, which is exactly what the client sends
    // back as Last-Event-ID.
    id: String(row.sequenceNo),
    type: row.eventType,
    data: JSON.stringify({
      jobId,
      type: row.eventType,
      payload: row.payload,
      sequenceNo: row.sequenceNo,
    }),
  };
}

/**
 * Heartbeat frame. Its id repeats the last delivered sequence_no instead of
 * being omitted: Nest's SseStream fabricates an incrementing id for any
 * message without one, which would collide with real sequence numbers and
 * corrupt the resume point. Repeating the cursor keeps the contract's
 * guarantee ("heartbeat는 Last-Event-ID 재개 지점에 영향을 주지 않는다") intact.
 */
function heartbeat(cursor: number): MessageEvent {
  return { id: String(cursor), type: 'heartbeat', data: '{}' };
}

function isTerminal(message: MessageEvent): boolean {
  return typeof message.type === 'string' && TERMINAL_EVENT_TYPES.has(message.type);
}

/** UNE-PLAN-011. Polling projection over the append-only job_event log: the
 * worker writes events in its own transaction, so no in-process pub/sub can be
 * assumed (API and worker are separate services). Each poll opens and closes a
 * short transaction — an open SSE connection never holds a pool connection. */
@Injectable()
export class JobSseService {
  private readonly pollMs: number;
  private readonly heartbeatMs: number;
  private readonly maxLifetimeMs: number;

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(GenerationJobRepository) private readonly jobs: GenerationJobRepository,
    @Inject(JobEventRepository) private readonly events: JobEventRepository,
    @Optional() @Inject(JOB_SSE_OPTIONS) options?: JobSseOptions,
  ) {
    this.pollMs = options?.pollMs ?? DEFAULT_POLL_MS;
    this.heartbeatMs = options?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.maxLifetimeMs = options?.maxLifetimeMs ?? DEFAULT_MAX_LIFETIME_MS;
  }

  /**
   * Async on purpose: the 404 must be raised before the observable is handed to
   * Nest, otherwise the SSE headers are already committed and the error can
   * only be delivered as an in-stream `error` frame instead of a JSON envelope.
   */
  async stream(
    auth: AuthContext,
    jobId: string,
    lastEventId?: string,
  ): Promise<Observable<MessageEvent>> {
    const start = parseLastEventId(lastEventId);
    const job = await this.db.withTenant(auth.tenantId, (c) =>
      this.jobs.findJob(c, auth.tenantId, jobId),
    );
    if (!job) throw jobErrors.notFound();

    let cursor = start;
    let idleTicks = 0;
    const ticksPerHeartbeat = Math.max(1, Math.round(this.heartbeatMs / this.pollMs));

    return timer(0, this.pollMs).pipe(
      concatMap(async (): Promise<MessageEvent[]> => {
        const rows = await this.db.withTenant(auth.tenantId, (c) =>
          this.events.listPublicSince(c, auth.tenantId, jobId, cursor),
        );
        if (rows.length > 0) {
          cursor = rows[rows.length - 1].sequenceNo;
          idleTicks = 0;
          return rows.map((row) => toMessage(jobId, row));
        }
        idleTicks += 1;
        if (idleTicks >= ticksPerHeartbeat) {
          idleTicks = 0;
          return [heartbeat(cursor)];
        }
        return [];
      }),
      concatMap((messages) => from(messages)),
      // Inclusive: the terminal event itself is delivered, then the stream ends.
      takeWhile((message) => !isTerminal(message), true),
      takeUntil(timer(this.maxLifetimeMs)),
    );
  }
}

/** Contract LastEventId: `^[0-9]{1,18}$`; absent means "from the beginning". */
export function parseLastEventId(lastEventId?: string): number {
  if (lastEventId === undefined || lastEventId.trim() === '') return 0;
  const raw = lastEventId.trim();
  if (!LAST_EVENT_ID_PATTERN.test(raw)) throw invalidLastEventId();
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw invalidLastEventId();
  return value;
}
