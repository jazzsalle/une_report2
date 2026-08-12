import { apiBaseUrl } from '../config';

/**
 * 현장 앱 API 클라이언트 (CC-280).
 *
 * `apps/web`의 클라이언트와 따로 둔다. 같아 보이지만 **현장 앱만 오프라인
 * 대기열을 갖는다**(`task/offline-queue.ts`) — 지휘소 워크스페이스에 그것이
 * 들어가면 편집이 조용히 나중에 반영되는 위험한 동작이 생긴다. 공유 패키지로
 * 묶는 것은 두 쪽의 요구가 갈라지지 않는다는 가정인데, 여기서 이미 갈라졌다.
 */

export interface Envelope<T> {
  success: boolean;
  data: T;
  meta: { requestId: string; correlationId: string; timestamp: string; schemaVersion: string };
}

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  recoverable: boolean;
  userAction?: string;
  violations?: { field: string; reason: string }[];
  correlationId?: string;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiCallError';
    this.failure = failure;
  }
}

/**
 * 네트워크에 닿지 못한 것인가.
 *
 * 이것이 대기열에 넣을지 판단하는 기준이다. 서버가 400/409로 거절한 것을
 * 대기열에 넣으면 영원히 재시도하면서 같은 거절을 받는다.
 */
export function isOffline(error: unknown): boolean {
  return error instanceof ApiCallError && error.failure.status === 0;
}

/**
 * 세션이 끊겼는가.
 *
 * 대기열 판단에서 이것은 **오프라인과 같은 편**이다 — 서버가 내용을 거절한 것이
 * 아니라 지금 보낼 자격이 없을 뿐이고, 다시 로그인하면 그대로 보낼 수 있다.
 */
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiCallError && error.failure.status === 401;
}

export interface CallOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function randomId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function newCorrelationId(): string {
  return randomId('corr');
}

/**
 * 멱등 키.
 *
 * **행위 단위로 한 번 만들어 대기열에 함께 저장한다.** 재시도할 때마다 새로
 * 만들면 오프라인에서 쌓인 보고가 네트워크 복구 뒤 중복으로 들어간다 —
 * 설계 09 SCR-TASK-001 인수기준이 "네트워크 복구 후 중복 없이 동기화된다"다.
 */
export function newIdempotencyKey(label: string): string {
  return `${label}-${randomId('k')}`;
}

function toFailure(status: number, parsed: unknown, correlationId: string): ApiFailure {
  const body = (parsed ?? {}) as {
    error?: Record<string, unknown>;
    meta?: { correlationId?: string };
  };
  const err = body.error ?? {};
  return {
    status,
    code: typeof err.code === 'string' ? err.code : `COM-${status}`,
    message: typeof err.message === 'string' ? err.message : '요청을 처리하지 못했습니다.',
    recoverable: err.recoverable === true,
    userAction: typeof err.userAction === 'string' ? err.userAction : undefined,
    violations: Array.isArray(err.violations)
      ? (err.violations as { field: string; reason: string }[])
      : undefined,
    correlationId: body.meta?.correlationId ?? correlationId,
  };
}

export class FieldApiClient {
  private accessToken: string | null = null;
  private sessionCorrelationId = newCorrelationId();

  constructor(private readonly baseUrl: string = apiBaseUrl()) {}

  setToken(token: string | null): void {
    this.accessToken = token;
  }

  hasToken(): boolean {
    return this.accessToken !== null;
  }

  correlationId(): string {
    return this.sessionCorrelationId;
  }

  async call<T>(path: string, options: CallOptions = {}): Promise<T> {
    const correlationId = this.sessionCorrelationId;
    const headers: Record<string, string> = { 'X-Correlation-Id': correlationId };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      // status 0은 "서버에 닿지 못했다"는 뜻으로만 쓴다 — 대기열 판단이
      // 여기에 달려 있다.
      throw new ApiCallError({
        status: 0,
        code: 'NET-0000',
        message: `서버에 연결할 수 없습니다: ${(error as Error).message}`,
        recoverable: true,
        userAction: '연결이 돌아오면 자동으로 다시 보냅니다.',
        correlationId,
      });
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) throw new ApiCallError(toFailure(response.status, parsed, correlationId));

    const envelope = parsed as Envelope<T> | null;
    if (!envelope || envelope.success !== true) {
      throw new ApiCallError({
        status: response.status,
        code: 'COM-0500',
        message: '서버 응답 형식이 계약과 다릅니다.',
        recoverable: false,
        correlationId,
      });
    }
    return envelope.data;
  }
}
