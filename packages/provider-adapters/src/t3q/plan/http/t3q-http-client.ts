import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import type { T3qPlanError, T3qPlanErrorCode } from '../t3q-plan-port';

/**
 * Transport for the legacy T3Q adapter (CC-125, ADR-26 D3).
 *
 * OB-01 discipline — nothing here is guessed:
 * - `baseUrl` is REQUIRED input. The transcript's `servers[0]` is a fact of
 *   the document, not permission to call it; there is no fallback.
 * - auth is `none` (explicit, fixture servers) or `header` (name+token both
 *   required). No Bearer/API-Key convention is assumed as a default.
 * - TLS verification cannot be disabled: this options type has no such
 *   field and the client never touches the TLS layer (a static hygiene test
 *   pins the absence of the disabling tokens from this whole tree).
 * - connect 5s / response 60s defaults are the UNE baseline from design 10
 *   §4.2, NOT provider-agreed values (gap matrix §3).
 *
 * Retry policy (ADR-26 D3): at most ONE retry, and only when the failure
 * happened BEFORE response headers arrived (DNS/refused/TLS/connect
 * timeout) or on 429/503 with Retry-After honored (capped). Legacy has no
 * idempotency key, so once the provider may have executed (response
 * timeout, post-response 5xx) the client never re-sends — the worker's
 * job-level retry owns that decision (ADR-25 D9).
 */

export interface T3qHttpClientOptions {
  baseUrl: string;
  authMode: 'none' | 'header';
  authHeaderName?: string;
  authToken?: string;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  /** Injected in tests for determinism; defaults to an undici Agent built
   * from the timeouts (connect vs headers/body split — the reason undici is
   * an explicit dependency; global fetch cannot express it). */
  dispatcher?: Dispatcher;
  fetchImpl?: typeof undiciFetch;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_RESPONSE_TIMEOUT_MS = 60_000;
const RETRY_AFTER_CAP_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export class T3qHttpError extends Error {
  /** Parsed Retry-After hint (ms) when the provider sent one. */
  retryAfterMs?: number;

  constructor(
    readonly code: T3qPlanErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus?: number,
    /** Response body when one was received (raw trace for failures). */
    readonly bodyText?: string,
  ) {
    super(message);
    this.name = 'T3qHttpError';
  }

  toPlanError(): T3qPlanError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.httpStatus !== undefined ? { httpStatus: this.httpStatus } : {}),
    };
  }
}

export interface T3qHttpResponse {
  status: number;
  contentType: string;
  bodyText: string;
  /** Parsed body when the content type is JSON. */
  bodyJson?: unknown;
  /** Attempts actually made (1 = no retry). */
  attempts: number;
}

export class T3qHttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly dispatcher: Dispatcher;
  private readonly fetchImpl: typeof undiciFetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: T3qHttpClientOptions) {
    if (!options.baseUrl) {
      throw new Error('T3qHttpClient requires an explicit baseUrl (OB-01: no fallback)');
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    if (options.authMode === 'header') {
      if (!options.authHeaderName || !options.authToken) {
        throw new Error(
          'authMode=header requires authHeaderName and authToken (OB-01: no default auth convention)',
        );
      }
      this.headers = { [options.authHeaderName]: options.authToken };
    } else {
      this.headers = {};
    }
    this.dispatcher =
      options.dispatcher ??
      new Agent({
        connect: { timeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS },
        headersTimeout: options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
        bodyTimeout: options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS,
      });
    this.fetchImpl = options.fetchImpl ?? undiciFetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** POST a JSON body. Accepts JSON responses, plus text/event-stream when
   * `acceptSse` (RPT-002). Throws T3qHttpError on any failure. */
  async postJson(path: string, body: unknown, acceptSse = false): Promise<T3qHttpResponse> {
    let lastError: T3qHttpError | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return { ...(await this.attempt(path, body, acceptSse)), attempts: attempt };
      } catch (err) {
        const httpError =
          err instanceof T3qHttpError
            ? err
            : new T3qHttpError(
                'T3Q_CONNECTION_ERROR',
                err instanceof Error ? err.message : String(err),
                true,
              );
        lastError = httpError;
        if (attempt === 2 || !this.mayResend(httpError)) throw httpError;
        await this.sleep(this.retryDelayMs(httpError));
      }
    }
    throw lastError as T3qHttpError; // unreachable
  }

  /** Resending is safe only when the provider cannot have executed
   * (connection-phase failure) or explicitly said "later" (429/503). */
  private mayResend(error: T3qHttpError): boolean {
    if (error.code === 'T3Q_CONNECTION_ERROR') return true;
    if (error.code === 'T3Q_RATE_LIMITED') return true;
    if (error.code === 'T3Q_PROVIDER_ERROR' && error.httpStatus === 503) return true;
    return false;
  }

  private retryDelayMs(error: T3qHttpError): number {
    if (error.retryAfterMs !== undefined) {
      return Math.min(error.retryAfterMs, RETRY_AFTER_CAP_MS);
    }
    return DEFAULT_RETRY_DELAY_MS;
  }

  private async attempt(
    path: string,
    body: unknown,
    acceptSse: boolean,
  ): Promise<Omit<T3qHttpResponse, 'attempts'>> {
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers },
        body: JSON.stringify(body),
        dispatcher: this.dispatcher,
      });
    } catch (err) {
      throw classifyTransportError(err);
    }

    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch (err) {
      // Headers arrived but the body did not complete — the provider may
      // have executed; never resend (legacy has no idempotency key).
      throw new T3qHttpError(
        'T3Q_TIMEOUT',
        `response body read failed: ${err instanceof Error ? err.message : err}`,
        true,
        response.status,
      );
    }

    if (!response.ok) throw classifyStatus(response, bodyText);

    const contentType = response.headers.get('content-type') ?? '';
    if (acceptSse && contentType.includes('text/event-stream')) {
      return { status: response.status, contentType, bodyText };
    }
    if (!contentType.includes('application/json')) {
      throw new T3qHttpError(
        'T3Q_MALFORMED_RESPONSE',
        `unexpected content type: ${contentType || '(none)'}`,
        false,
        response.status,
        bodyText,
      );
    }
    try {
      return { status: response.status, contentType, bodyText, bodyJson: JSON.parse(bodyText) };
    } catch {
      throw new T3qHttpError(
        'T3Q_MALFORMED_RESPONSE',
        'response is not valid JSON',
        false,
        response.status,
        bodyText,
      );
    }
  }
}

/** undici surfaces transport failures as TypeError with a cause carrying a
 * code. Connection-phase codes mean the request never reached the provider. */
const CONNECTION_PHASE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function classifyTransportError(err: unknown): T3qHttpError {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code ?? '';
  const message = cause?.message ?? (err instanceof Error ? err.message : String(err));
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    // The request reached the wire; the provider may have executed.
    return new T3qHttpError('T3Q_TIMEOUT', `response timeout (${code})`, true);
  }
  if (CONNECTION_PHASE_CODES.has(code)) {
    return new T3qHttpError('T3Q_CONNECTION_ERROR', `${code}: ${message}`, true);
  }
  // Unknown transport failure: treat as connection error but DO NOT resend
  // (mayResend checks the code, classify conservatively as timeout-like).
  return new T3qHttpError('T3Q_TIMEOUT', message, true);
}

function classifyStatus(
  response: { status: number; headers: { get(name: string): string | null } },
  bodyText: string,
): T3qHttpError {
  const status = response.status;
  const make = (code: T3qPlanErrorCode, retryable: boolean): T3qHttpError =>
    new T3qHttpError(code, `provider returned HTTP ${status}`, retryable, status, bodyText);
  if (status === 400 || status === 422) return make('T3Q_REQUEST_REJECTED', false);
  if (status === 401 || status === 403) return make('T3Q_AUTH_ERROR', false);
  if (status === 404) return make('T3Q_ENDPOINT_NOT_FOUND', false);
  if (status === 429) {
    const error = make('T3Q_RATE_LIMITED', true);
    error.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    return error;
  }
  if (status >= 500) {
    const error = make('T3Q_PROVIDER_ERROR', true);
    if (status === 503) error.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    return error;
  }
  return make('T3Q_MALFORMED_RESPONSE', false);
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return undefined;
}
