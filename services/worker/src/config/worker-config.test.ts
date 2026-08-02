import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from './worker-config';

const BASE = { DATABASE_URL: 'postgres://une:x@localhost:15432/une' };

const LEGACY_HTTP = {
  ...BASE,
  UNE_T3Q_PLAN_ADAPTER: 'legacy-http',
  UNE_T3Q_BASE_URL: 'http://127.0.0.1:9999',
  UNE_T3Q_AUTH_MODE: 'none',
};

describe('loadWorkerConfig', () => {
  it('fails fast without DATABASE_URL', () => {
    expect(() => loadWorkerConfig({})).toThrow(/DATABASE_URL/);
  });

  it('defaults to the une_worker role and sane polling values', () => {
    const config = loadWorkerConfig({ ...BASE });
    expect(config.runtimeRole).toBe('une_worker');
    expect(config.pollIntervalMs).toBe(1000);
    expect(config.batchSize).toBe(5);
    expect(config.leaseTimeoutMs).toBe(300_000);
    expect(config.maxAttempts).toBe(3);
    expect(config.mockScenariosEnabled).toBe(false);
    expect(config.planAdapter).toBe('mock-legacy');
    expect(config.t3qHttp).toBeUndefined();
  });

  it('rejects a role that is not a plain identifier (SET LOCAL ROLE injection guard)', () => {
    expect(() => loadWorkerConfig({ ...BASE, UNE_DB_RUNTIME_ROLE: 'une_worker; DROP' })).toThrow(
      /identifier/,
    );
  });

  it('reads overrides and ignores garbage numbers', () => {
    const config = loadWorkerConfig({
      ...BASE,
      UNE_WORKER_POLL_INTERVAL_MS: '250',
      UNE_WORKER_BATCH_SIZE: 'nope',
      UNE_WORKER_MOCK_SCENARIOS: 'true',
    });
    expect(config.pollIntervalMs).toBe(250);
    expect(config.batchSize).toBe(5);
    expect(config.mockScenariosEnabled).toBe(true);
  });

  // ── CC-125 adapter selection (ADR-26 D6) ──

  it('hard-fails on the retired CC-120 variable instead of silently accepting it', () => {
    expect(() => loadWorkerConfig({ ...BASE, UNE_T3Q_TOC_ADAPTER: 'mock' })).toThrow(
      /UNE_T3Q_TOC_ADAPTER is retired/,
    );
  });

  it('rejects unknown adapter kinds', () => {
    expect(() => loadWorkerConfig({ ...BASE, UNE_T3Q_PLAN_ADAPTER: 'real-t3q' })).toThrow(
      /invalid/,
    );
  });

  it('selects mock-target-v2 without extra config', () => {
    expect(loadWorkerConfig({ ...BASE, UNE_T3Q_PLAN_ADAPTER: 'mock-target-v2' }).planAdapter).toBe(
      'mock-target-v2',
    );
  });

  // ── legacy-http: OB-01 fail-closed rules ──

  it('legacy-http without UNE_T3Q_BASE_URL fails startup (no transcript fallback)', () => {
    expect(() =>
      loadWorkerConfig({ ...BASE, UNE_T3Q_PLAN_ADAPTER: 'legacy-http', UNE_T3Q_AUTH_MODE: 'none' }),
    ).toThrow(/UNE_T3Q_BASE_URL/);
  });

  it('legacy-http without an explicit auth mode fails startup (no default convention)', () => {
    expect(() =>
      loadWorkerConfig({
        ...BASE,
        UNE_T3Q_PLAN_ADAPTER: 'legacy-http',
        UNE_T3Q_BASE_URL: 'http://127.0.0.1:9999',
      }),
    ).toThrow(/UNE_T3Q_AUTH_MODE/);
  });

  it('auth mode header requires both header name and token', () => {
    expect(() => loadWorkerConfig({ ...LEGACY_HTTP, UNE_T3Q_AUTH_MODE: 'header' })).toThrow(
      /UNE_T3Q_AUTH_HEADER_NAME/,
    );
    expect(() =>
      loadWorkerConfig({
        ...LEGACY_HTTP,
        UNE_T3Q_AUTH_MODE: 'header',
        UNE_T3Q_AUTH_HEADER_NAME: 'X-T3Q-Key',
      }),
    ).toThrow(/UNE_T3Q_AUTH_TOKEN/);
  });

  it('legacy-http parses with UNE-baseline timeouts (not provider-agreed — OB-01)', () => {
    const config = loadWorkerConfig({ ...LEGACY_HTTP });
    expect(config.planAdapter).toBe('legacy-http');
    expect(config.t3qHttp).toMatchObject({
      baseUrl: 'http://127.0.0.1:9999',
      authMode: 'none',
      connectTimeoutMs: 5_000,
      responseTimeoutMs: 60_000,
    });
  });

  it('rejects a lease that a single provider call (with retry) could outlive', () => {
    // budget = 2*(5s+60s)+10s = 140s → lease of 100s must fail
    expect(() =>
      loadWorkerConfig({ ...LEGACY_HTTP, UNE_WORKER_LEASE_TIMEOUT_MS: '100000' }),
    ).toThrow(/call budget/);
    expect(
      loadWorkerConfig({ ...LEGACY_HTTP, UNE_WORKER_LEASE_TIMEOUT_MS: '150000' }).leaseTimeoutMs,
    ).toBe(150_000);
  });

  // ── production guard ──

  it('blocks mock adapters in production without explicit opt-in', () => {
    expect(() => loadWorkerConfig({ ...BASE, NODE_ENV: 'production' })).toThrow(
      /UNE_ALLOW_MOCK_PROVIDER/,
    );
    expect(
      loadWorkerConfig({ ...BASE, NODE_ENV: 'production', UNE_ALLOW_MOCK_PROVIDER: 'true' })
        .planAdapter,
    ).toBe('mock-legacy');
    expect(loadWorkerConfig({ ...LEGACY_HTTP, NODE_ENV: 'production' }).planAdapter).toBe(
      'legacy-http',
    );
  });
});
