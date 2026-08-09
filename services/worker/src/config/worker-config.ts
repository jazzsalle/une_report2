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
  /** RPT-002 transport mode. Default FALSE on purpose (ADR-27 D5): the SSE
   * framing is a UNE assumption (OB-01) and stays off the operational path;
   * this seam exists for the CC-400 real-contract verification. */
  t3qContentStream: boolean;
  /** Provider 원문/요청조건 보존기간 (일). 사용자 결정 2026-08-09 = 1개월.
   * DB 상수가 아니라 운영 설정이다 — 0026 §5. */
  payloadRetentionDays: number;
  /** 보존 정리 전용 롤. `une_worker`가 아니다 — 0026 §2. */
  retentionRole: string;
  /** 한 트랜잭션에서 비우는 최대 행 수(테이블별). */
  retentionBatchSize: number;
  /** 정리 주기. 하루 한 번이면 충분하다 — 만료 판정 단위가 '일'이다. */
  retentionIntervalMs: number;
  /** 정리 자체를 끌 수 있다. 기본은 켬 — 꺼두면 OB-16이 다시 열린다. */
  retentionEnabled: boolean;
  /** 지식문서 UNI 전송 스윕 주기 (CC-220). */
  knowledgeUploadIntervalMs: number;
  /** 한 스윕에서 상태를 관측할 문서 수. */
  knowledgePollBatchSize: number;
  /** 상태 관측 주기. 설계 08 §1.14의 backoff는 문서 단위이고 이것은 스윕 단위다. */
  knowledgePollIntervalMs: number;
  knowledgeEnabled: boolean;
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

  // 보존 정리는 **다른 롤**로 돈다. 비워두는 것을 허용하지 않는다 — 빈 값이면
  // 연결 롤(운영에서는 소유자/슈퍼유저) 그대로 UPDATE가 돌고, 0026이 컬럼
  // 단위로 좁혀둔 권한이 통째로 무의미해진다.
  const retentionRole = env.UNE_RETENTION_ROLE ?? 'une_retention';
  if (!IDENTIFIER.test(retentionRole)) {
    throw new Error(`UNE_RETENTION_ROLE must be a plain SQL identifier, got: ${retentionRole}`);
  }
  if (retentionRole === runtimeRole) {
    throw new Error(
      `UNE_RETENTION_ROLE must differ from UNE_DB_RUNTIME_ROLE (${runtimeRole}): ` +
        '보존 정리 권한을 워커 롤에 얹으면 ADR-33 D2(워커는 상황 계열 테이블에 ' +
        '닿지 않는다)가 조용히 뒤집힌다.',
    );
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
    // Covers legacy-http only. Re-evaluated at CC-135 (review minor 11):
    // target-v2 stayed in-process mock (full lifecycle, but no network
    // transport — OB-10 unaccepted), so the fencing floor still does not
    // apply to it. Re-derive when CC-400 binds a real v2 transport.
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
    t3qContentStream: env.UNE_T3Q_CONTENT_STREAM === 'true',
    payloadRetentionDays: intFrom(env.UNE_PAYLOAD_RETENTION_DAYS, 30),
    retentionRole,
    retentionBatchSize: intFrom(env.UNE_RETENTION_BATCH_SIZE, 500),
    retentionIntervalMs: intFrom(env.UNE_RETENTION_INTERVAL_MS, 6 * 60 * 60 * 1000),
    retentionEnabled: env.UNE_RETENTION_ENABLED !== 'false',
    knowledgeUploadIntervalMs: intFrom(env.UNE_KNOWLEDGE_UPLOAD_INTERVAL_MS, 5_000),
    knowledgePollBatchSize: intFrom(env.UNE_KNOWLEDGE_POLL_BATCH_SIZE, 20),
    knowledgePollIntervalMs: intFrom(env.UNE_KNOWLEDGE_POLL_INTERVAL_MS, 15_000),
    knowledgeEnabled: env.UNE_KNOWLEDGE_ENABLED !== 'false',
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
