import type { WorkerConfig } from '../config/worker-config';
import type { RunSummary, TocJobRunner } from './toc-job.runner';

/** Production polling loop around the timer-free runner. Errors are isolated
 * per tick with a doubling backoff (capped at 30s) so a transient DB outage
 * cannot hot-loop the worker. stop() waits for the in-flight tick (SIGTERM
 * drains gracefully). */
export class TocJobPoller {
  private stopped = false;
  private inFlight: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private backoffMs: number;

  constructor(
    private readonly runner: TocJobRunner,
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
      const summary = await this.runner.runOnce();
      this.onSummary(summary);
      this.backoffMs = this.config.pollIntervalMs;
      // Immediate re-poll while there is a backlog; idle waits an interval.
      this.schedule(summary.claimed > 0 ? 0 : this.config.pollIntervalMs);
    } catch (err) {
      console.error(
        `[une-worker] toc poll tick failed: ${err instanceof Error ? err.message : err}`,
      );
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
      this.schedule(this.backoffMs);
    }
  }
}
