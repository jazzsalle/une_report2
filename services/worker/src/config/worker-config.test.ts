import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from './worker-config';

const BASE = { DATABASE_URL: 'postgres://une:x@localhost:15432/une' };

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
});
