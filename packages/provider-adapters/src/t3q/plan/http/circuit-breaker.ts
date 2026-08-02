/**
 * Minimal process-local circuit breaker (CC-125, ADR-26 D3). Scope: one
 * breaker per (adapter, operation) inside one process — distributed state is
 * CC-430. Clock is injected so tests are deterministic.
 */

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. */
  failureThreshold: number;
  /** How long the circuit stays open before one half-open probe. */
  openMs: number;
  now?: () => number;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    if (this.now() - this.openedAt >= this.options.openMs) return 'half-open';
    return 'open';
  }

  /** True when a call may proceed. In half-open, only the first caller gets
   * the probe; the rest stay rejected until the probe settles. */
  allowRequest(): boolean {
    const state = this.state();
    if (state === 'closed') return true;
    if (state === 'half-open' && !this.probing) {
      this.probing = true;
      return true;
    }
    return false;
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  onFailure(): void {
    this.probing = false;
    if (this.openedAt !== null) {
      // Failed probe (or failure while open): restart the open window.
      this.openedAt = this.now();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.options.failureThreshold) {
      this.openedAt = this.now();
    }
  }
}
