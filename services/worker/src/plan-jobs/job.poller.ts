import type { WorkerConfig } from '../config/worker-config';
import type { RunSummary } from '../plan-toc/toc-job.runner';

export interface PlanJobRunner {
  runOnce(): Promise<RunSummary>;
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
    private readonly onSummary: (summary: RunSummary) => void = () => {},
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
