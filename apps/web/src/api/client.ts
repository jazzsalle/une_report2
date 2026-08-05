import { apiBaseUrl } from '../config';
import { ApiCallError, type ApiFailure } from './errors';

/**
 * UNE API 클라이언트 (CC-170).
 *
 * 얇게 유지한다. 하는 일은 넷이다.
 *   1. 봉투(success/data/meta) 언랩 — 화면은 `data`만 본다.
 *   2. 상관관계 ID 생성·보관 — 사용자가 화면에서 그 값을 읽어 문의할 수 있어야
 *      한다(설계 09 필수증거 "Correlation ID").
 *   3. 멱등 키 부여 — 재시도 가능한 생성 요청은 키 없이 보내지 않는다.
 *   4. 오류를 `ApiCallError`로 정규화 — 화면이 status 숫자를 해석하지 않는다.
 *
 * 토큰은 메모리에만 둔다. localStorage에 넣으면 XSS 한 번으로 세션이 유출되고,
 * 이 앱은 새로고침 후 다시 로그인하면 되는 데모·운영 워크스페이스다.
 */

export interface Envelope<T> {
  success: boolean;
  data: T;
  meta: { requestId: string; correlationId: string; timestamp: string; schemaVersion: string };
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 멱등 키. 생성·상태변경에 필요하다(없으면 서버가 400으로 거부한다). */
  idempotencyKey?: string;
  ifMatch?: string;
  /** 이 호출에만 쓰는 상관관계 ID. 없으면 세션 값을 쓴다. */
  correlationId?: string;
  signal?: AbortSignal;
}

export interface CallResult<T> {
  data: T;
  correlationId: string;
  etag: string | null;
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

export function newIdempotencyKey(label: string): string {
  return `${label}-${randomId('k')}`;
}

export class ApiClient {
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

  /** 새 작업 흐름을 시작할 때 상관관계 ID를 갱신한다(추적 단위 = 사용자의 한 시도). */
  startTrace(): string {
    this.sessionCorrelationId = newCorrelationId();
    return this.sessionCorrelationId;
  }

  async call<T>(path: string, options: CallOptions = {}): Promise<CallResult<T>> {
    const correlationId = options.correlationId ?? this.sessionCorrelationId;
    const headers: Record<string, string> = { 'X-Correlation-Id': correlationId };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    if (options.ifMatch) headers['If-Match'] = options.ifMatch;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      // 네트워크 실패는 서버 오류와 다르다 — 코드가 없으므로 지어낸다면 그것을
      // 명시한다. 사용자에게는 "서버에 닿지 못했다"가 정확한 사실이다.
      throw new ApiCallError({
        status: 0,
        code: 'NET-0000',
        message: `서버에 연결할 수 없습니다: ${(error as Error).message}`,
        recoverable: true,
        userAction: '네트워크와 API 주소를 확인한 뒤 다시 시도하십시오.',
        correlationId,
      });
    }

    const etag = response.headers.get('ETag');
    if (response.status === 204) {
      return { data: undefined as T, correlationId, etag };
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

    if (!response.ok) {
      throw new ApiCallError(toFailure(response.status, parsed, correlationId));
    }
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
    return {
      data: envelope.data,
      correlationId: envelope.meta?.correlationId ?? correlationId,
      etag,
    };
  }

  /**
   * 업로드 티켓으로 바이트를 직접 보낸다.
   *
   * 티켓의 `url`/`method`/`headers`를 **그대로** 쓴다. presign URL에서는 헤더가
   * 서명 대상이므로 하나만 더하거나 빼도 실패한다. 그래서 여기에는 Authorization을
   * 붙이지 않는다 — driver로 분기하지 않는다는 계약의 뜻이 이것이다.
   */
  async uploadBytes(
    ticket: { url: string; method: string; headers: Record<string, string> },
    bytes: Uint8Array | Blob,
    signal?: AbortSignal,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(ticket.url, {
        method: ticket.method,
        headers: ticket.headers,
        body: bytes as BodyInit,
        signal,
      });
    } catch (error) {
      throw new ApiCallError({
        status: 0,
        code: 'NET-0000',
        message: `업로드 대상에 연결할 수 없습니다: ${(error as Error).message}`,
        recoverable: true,
        correlationId: this.sessionCorrelationId,
      });
    }
    if (!response.ok) {
      const body = await response.text();
      throw new ApiCallError({
        status: response.status,
        code: response.status === 403 ? 'FILE-403-001' : 'FILE-422-002',
        message: `업로드가 거부되었습니다 (HTTP ${response.status}).`,
        recoverable: response.status !== 403,
        // 저장소가 XML로 답할 수 있다. 원문을 그대로 보여주지 않고 잘라 둔다.
        userAction: body.slice(0, 200) || undefined,
        correlationId: this.sessionCorrelationId,
      });
    }
  }

  /** Export 산출물을 내려받는다(UNE-DOC-014 — 봉투가 아니라 바이너리다). */
  async downloadExport(
    exportId: string,
  ): Promise<{ blob: Blob; fileName: string; sha256: string }> {
    const headers: Record<string, string> = { 'X-Correlation-Id': this.sessionCorrelationId };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    const response = await fetch(`${this.baseUrl}/exports/${exportId}/download`, { headers });
    if (!response.ok) {
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      throw new ApiCallError(toFailure(response.status, parsed, this.sessionCorrelationId));
    }
    return {
      blob: await response.blob(),
      fileName: fileNameFromDisposition(response.headers.get('Content-Disposition')),
      sha256: response.headers.get('X-Content-Sha256') ?? '',
    };
  }
}

function toFailure(status: number, parsed: unknown, correlationId: string): ApiFailure {
  const body = parsed as {
    error?: {
      code?: string;
      message?: string;
      recoverable?: boolean;
      detail?: string | null;
      violations?: { field: string; reason: string }[];
    };
    meta?: { correlationId?: string };
  } | null;
  const error = body?.error;
  return {
    status,
    code: error?.code ?? `HTTP-${status}`,
    message: error?.message ?? `요청이 실패했습니다 (HTTP ${status}).`,
    recoverable: error?.recoverable ?? status >= 500,
    userAction: typeof error?.detail === 'string' ? error.detail : undefined,
    violations: error?.violations,
    correlationId: body?.meta?.correlationId ?? correlationId,
  };
}

/**
 * `Content-Disposition`에서 파일명을 꺼낸다.
 *
 * 서버는 RFC 5987 형식(`filename*=UTF-8''...`)과 ASCII 대체값을 함께 준다.
 * 한글 파일명이 살아 있는 쪽은 전자다.
 */
export function fileNameFromDisposition(value: string | null): string {
  if (!value) return 'export.hwpx';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      // 잘못 인코딩된 값이면 ASCII 대체값으로 내려간다.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(value);
  return plain ? plain[1] : 'export.hwpx';
}
