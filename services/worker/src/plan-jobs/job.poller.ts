import type { WorkerConfig } from '../config/worker-config';

/**
 * 폴러가 실제로 보는 것은 "이번 틱에 몇 건을 집었는가"뿐이다(백로그가 있으면
 * 즉시 재폴링). 러너마다 요약의 나머지 필드는 다르다 — Export에는 취소 경로가
 * 없어(EXPORT_STATUSES) `cancelled`가 영원히 0인 필드로 남는다. 폴러의 계약을
 * 최소로 좁혀, 러너가 자기 도메인에 맞는 요약을 그대로 돌려주게 한다.
 */
export interface PollTickSummary {
  claimed: number;
}

export interface PlanJobRunner {
  runOnce(): Promise<PollTickSummary>;
}

/** Production polling loop around timer-free runners (CC-130 generalized
 * from TocJobPoller — semantics unchanged): one tick runs every runner
 * sequentially; errors are isolated per tick with a doubling backoff
 * (capped at 30s) so a transient DB outage cannot hot-loop the worker.
 * stop() waits for the in-flight tick (SIGTERM drains gracefully). */
export class PlanJobPoller {
  private stopped = false;
  private inFlight: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private backoffMs: number;

  constructor(
    private readonly runners: readonly PlanJobRunner[],
    private readonly config: WorkerConfig,
    private readonly onSummary: (summary: PollTickSummary) => void = () => {},
  ) {
    this.backoffMs = config.pollIntervalMs;
  }

  start(): void {
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    try {
      let claimed = 0;
      for (const runner of this.runners) {
        const summary = await runner.runOnce();
        claimed += summary.claimed;
        this.onSummary(summary);
      }
      this.backoffMs = this.config.pollIntervalMs;
      // Immediate re-poll while there is a backlog; idle waits an interval.
      this.schedule(claimed > 0 ? 0 : this.config.pollIntervalMs);
    } catch (err) {
      console.error(
        `[une-worker] plan-job poll tick failed: ${err instanceof Error ? err.message : err}`,
      );
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      this.schedule(this.backoffMs);
    }
  }
}
