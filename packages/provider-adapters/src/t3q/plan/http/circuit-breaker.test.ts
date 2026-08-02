import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe('CircuitBreaker', () => {
  it('opens after the failure threshold and rejects while open', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 3, openMs: 30_000, now: clock.now });
    expect(breaker.allowRequest()).toBe(true);
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.state()).toBe('closed');
    breaker.onFailure();
    expect(breaker.state()).toBe('open');
    expect(breaker.allowRequest()).toBe(false);
  });

  it('half-opens after the window, allows exactly one probe, closes on success', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, openMs: 30_000, now: clock.now });
    breaker.onFailure();
    expect(breaker.allowRequest()).toBe(false);
    clock.advance(30_000);
    expect(breaker.state()).toBe('half-open');
    expect(breaker.allowRequest()).toBe(true); // the probe
    expect(breaker.allowRequest()).toBe(false); // concurrent callers stay blocked
    breaker.onSuccess();
    expect(breaker.state()).toBe('closed');
    expect(breaker.allowRequest()).toBe(true);
  });

  it('re-opens the window when the probe fails', () => {
    const clock = makeClock();
    const breaker = new CircuitBreaker({ failureThreshold: 1, openMs: 30_000, now: clock.now });
    breaker.onFailure();
    clock.advance(30_000);
    expect(breaker.allowRequest()).toBe(true);
    breaker.onFailure();
    expect(breaker.state()).toBe('open');
    clock.advance(29_999);
    expect(breaker.allowRequest()).toBe(false);
    clock.advance(1);
    expect(breaker.allowRequest()).toBe(true);
  });

  it('success resets the consecutive-failure count', () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, openMs: 1000, now: () => 0 });
    breaker.onFailure();
    breaker.onSuccess();
    breaker.onFailure();
    expect(breaker.state()).toBe('closed');
  });
});
