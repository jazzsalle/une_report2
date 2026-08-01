/** Worker configuration. Injected (never read from process.env at import
 * time) so tests can boot the runner against a dedicated database — same
 * pattern as services/api ApiConfig. */

export interface WorkerConfig {
  databaseUrl: string;
  /** SET LOCAL ROLE per transaction; '' disables (superuser test runs use
   * 'une_worker' to exercise the dispatch policies exactly like production). */
  runtimeRole: string;
  pollIntervalMs: number;
  batchSize: number;
  /** A RUNNING claim older than this is considered crashed and re-claimable. */
  leaseTimeoutMs: number;
  /** attempt_no beyond this fails the job without calling the provider. */
  maxAttempts: number;
  /** Enables the mock adapter's subject-prefix scenarios (demo/test only). */
  mockScenariosEnabled: boolean;
  /** Explicit adapter selection (review M4): 'mock' is the only CC-120 value;
   * 'legacy-http' arrives with CC-125 and fails startup until then so a
   * misconfigured deployment can never silently serve mock outlines. */
  t3qAdapter: 'mock';
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for une-worker');
  }
  const runtimeRole = env.UNE_DB_RUNTIME_ROLE ?? 'une_worker';
  if (runtimeRole && !IDENTIFIER.test(runtimeRole)) {
    throw new Error(`UNE_DB_RUNTIME_ROLE must be a plain SQL identifier, got: ${runtimeRole}`);
  }
  const t3qAdapter = env.UNE_T3Q_TOC_ADAPTER ?? 'mock';
  if (t3qAdapter !== 'mock') {
    throw new Error(
      `UNE_T3Q_TOC_ADAPTER=${t3qAdapter} is not available: only 'mock' exists until ` +
        `CC-125 lands the real LegacyT3qPlanAdapter (capability legacyToc is MOCK_ONLY).`,
    );
  }
  return {
    databaseUrl,
    runtimeRole,
    pollIntervalMs: intFrom(env.UNE_WORKER_POLL_INTERVAL_MS, 1000),
    batchSize: intFrom(env.UNE_WORKER_BATCH_SIZE, 5),
    leaseTimeoutMs: intFrom(env.UNE_WORKER_LEASE_TIMEOUT_MS, 300_000),
    maxAttempts: intFrom(env.UNE_WORKER_MAX_ATTEMPTS, 3),
    mockScenariosEnabled: env.UNE_WORKER_MOCK_SCENARIOS === 'true',
    t3qAdapter,
  };
}

function intFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
