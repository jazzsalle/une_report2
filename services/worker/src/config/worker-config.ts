import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  isT3qPlanAdapterKind,
  type T3qPlanAdapterKind,
} from '@une/provider-adapters';

/** Worker configuration. Injected (never read from process.env at import
 * time) so tests can boot the runner against a dedicated database — same
 * pattern as services/api ApiConfig. */

export interface T3qHttpWorkerConfig {
  baseUrl: string;
  authMode: 'none' | 'header';
  authHeaderName?: string;
  authToken?: string;
  connectTimeoutMs: number;
  responseTimeoutMs: number;
}

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
  /** Explicit adapter selection (CC-125, ADR-26 D6). env-only in CC-125;
   * the provider_config.feature_flags_json override is a reserved seam. */
  planAdapter: T3qPlanAdapterKind;
  /** Present only when planAdapter === 'legacy-http'. */
  t3qHttp?: T3qHttpWorkerConfig;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Retry-After cap in the HTTP client — part of the worst-case call budget. */
const RETRY_DELAY_CAP_MS = 10_000;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for une-worker');
  }
  const runtimeRole = env.UNE_DB_RUNTIME_ROLE ?? 'une_worker';
  if (runtimeRole && !IDENTIFIER.test(runtimeRole)) {
    throw new Error(`UNE_DB_RUNTIME_ROLE must be a plain SQL identifier, got: ${runtimeRole}`);
  }

  // The CC-120 variable is retired, not silently accepted: it meant "mock is
  // the only value" and reusing it for real-adapter selection would change
  // that meaning without the operator noticing (ADR-26 D6).
  if (env.UNE_T3Q_TOC_ADAPTER !== undefined) {
    throw new Error(
      'UNE_T3Q_TOC_ADAPTER is retired (CC-125). Use UNE_T3Q_PLAN_ADAPTER=' +
        "mock-legacy | legacy-http | mock-target-v2 (default 'mock-legacy').",
    );
  }
  const planAdapter = env.UNE_T3Q_PLAN_ADAPTER ?? 'mock-legacy';
  if (!isT3qPlanAdapterKind(planAdapter)) {
    throw new Error(
      `UNE_T3Q_PLAN_ADAPTER=${planAdapter} is invalid: expected ` +
        'mock-legacy | legacy-http | mock-target-v2.',
    );
  }

  // Mock adapters must never serve production silently (AT-T3Q-012 /
  // "mock support is not T3Q support"). Explicit opt-in only.
  if (
    env.NODE_ENV === 'production' &&
    planAdapter !== 'legacy-http' &&
    env.UNE_ALLOW_MOCK_PROVIDER !== 'true'
  ) {
    throw new Error(
      `UNE_T3Q_PLAN_ADAPTER=${planAdapter} is a mock and NODE_ENV=production. ` +
        'Set UNE_ALLOW_MOCK_PROVIDER=true only for an approved demo environment.',
    );
  }

  const leaseTimeoutMs = intFrom(env.UNE_WORKER_LEASE_TIMEOUT_MS, 300_000);

  let t3qHttp: T3qHttpWorkerConfig | undefined;
  if (planAdapter === 'legacy-http') {
    t3qHttp = loadT3qHttpConfig(env);
    // Fencing floor (ADR-26 D3): if a lease can expire while one provider
    // call (with its single retry) is still legitimately in flight, a second
    // worker would double-call a provider that has no idempotency key.
    // Covers legacy-http only: the v2 mock's poll budget (maxPolls×interval)
    // is in-process today; re-derive this bound when CC-135 gives target-v2
    // a real transport (review minor 11).
    const callBudgetMs =
      2 * (t3qHttp.connectTimeoutMs + t3qHttp.responseTimeoutMs) + RETRY_DELAY_CAP_MS;
    if (leaseTimeoutMs <= callBudgetMs) {
      throw new Error(
        `UNE_WORKER_LEASE_TIMEOUT_MS=${leaseTimeoutMs} must exceed the worst-case ` +
          `T3Q call budget ${callBudgetMs}ms (2×(connect+response)+retry delay cap).`,
      );
    }
  }

  return {
    databaseUrl,
    runtimeRole,
    pollIntervalMs: intFrom(env.UNE_WORKER_POLL_INTERVAL_MS, 1000),
    batchSize: intFrom(env.UNE_WORKER_BATCH_SIZE, 5),
    leaseTimeoutMs,
    maxAttempts: intFrom(env.UNE_WORKER_MAX_ATTEMPTS, 3),
    mockScenariosEnabled: env.UNE_WORKER_MOCK_SCENARIOS === 'true',
    planAdapter,
    ...(t3qHttp ? { t3qHttp } : {}),
  };
}

/** OB-01 discipline: base URL and auth have NO defaults and NO fallbacks.
 * Anything missing fails startup — a misconfigured worker must never call
 * an unapproved host or send a guessed credential shape. */
function loadT3qHttpConfig(env: NodeJS.ProcessEnv): T3qHttpWorkerConfig {
  const baseUrl = env.UNE_T3Q_BASE_URL ?? '';
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error(
      'UNE_T3Q_PLAN_ADAPTER=legacy-http requires UNE_T3Q_BASE_URL (absolute http(s) URL). ' +
        'The transcript servers entry is NOT a fallback (OB-01).',
    );
  }
  const authMode = env.UNE_T3Q_AUTH_MODE ?? '';
  if (authMode !== 'none' && authMode !== 'header') {
    throw new Error(
      "UNE_T3Q_AUTH_MODE must be explicitly 'none' (fixture servers only) or 'header' — " +
        'no default auth convention exists (OB-01).',
    );
  }
  let authHeaderName: string | undefined;
  let authToken: string | undefined;
  if (authMode === 'header') {
    authHeaderName = env.UNE_T3Q_AUTH_HEADER_NAME ?? '';
    authToken = env.UNE_T3Q_AUTH_TOKEN ?? '';
    if (!authHeaderName || !authToken) {
      throw new Error(
        'UNE_T3Q_AUTH_MODE=header requires UNE_T3Q_AUTH_HEADER_NAME and UNE_T3Q_AUTH_TOKEN.',
      );
    }
  }
  return {
    baseUrl,
    authMode,
    ...(authHeaderName ? { authHeaderName } : {}),
    ...(authToken ? { authToken } : {}),
    // UNE baseline from design 10 §4.2 — NOT provider-agreed values (OB-01).
    connectTimeoutMs: intFrom(env.UNE_T3Q_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS),
    responseTimeoutMs: intFrom(env.UNE_T3Q_RESPONSE_TIMEOUT_MS, DEFAULT_RESPONSE_TIMEOUT_MS),
  };
}

function intFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
