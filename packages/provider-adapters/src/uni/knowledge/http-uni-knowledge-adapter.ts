import {
  isRetryableUniError,
  uniErrorFromStatus,
  uniFailure,
  uniSuccess,
  type UniCallContext,
  type UniKnowledgeErrorCode,
  type UniKnowledgeOperation,
  type UniKnowledgeProvider,
  type UniKnowledgeResult,
  type UniRawTrace,
  type UniReferenceOutcome,
  type UniSearchInput,
  type UniSearchOutcome,
  type UniStatusOutcome,
  type UniUploadInput,
  type UniUploadOutcome,
} from './uni-knowledge-port';
import {
  guardUniReference,
  guardUniSearch,
  guardUniStatus,
  guardUniUpload,
  type UniFieldNames,
} from './uni-knowledge-response.guard';

/**
 * 실 HTTP UNI 지식문서 어댑터 (CC-220).
 *
 * **아직 검증되지 않았다.** capability는 `UNE_ADAPTER_READY`에 머문다 — 코드는
 * 있지만 실제 UNI에 대고 성공한 적이 없다(T3Q legacy 어댑터와 같은 처지).
 * OB-13이 닫히기 전에는 `T3Q_*_VERIFIED`에 해당하는 승격이 불가능하다.
 *
 * **아무것도 추측하지 않는다.** 설계 08 §1.9가 적은 것(`POST /documents/upload
 * ?uploader=…&force=false`, 응답 `{message, filename, doc_id}`, 상태 어휘)은
 * 기준선으로 쓰고, 적히지 않은 것은 **전부 설정에서 받는다**:
 *
 *   - multipart 파일 필드 이름 (`UNI_UPLOAD_FILE_FIELD`)
 *   - `/auth/login` 응답의 토큰 필드 이름 (`UNI_TOKEN_FIELD`)
 *   - base URL, 자격증명
 *
 * 기본값을 두지 않는 이유: 틀린 기본값으로 실 서버를 호출하면 422가 돌아오고,
 * 그 422를 보고 "UNI가 거부했다"고 읽게 된다. 실제로는 UNE가 잘못 보낸 것이다.
 * 값이 없으면 **기동하지 않는다**(`createHttpUniKnowledgeAdapter`).
 *
 * 설계 08 §1.8: React는 UNI를 직접 부르지 않는다. 이 어댑터는 백엔드 전용이다.
 */

export interface HttpUniKnowledgeConfig {
  baseUrl: string;
  username: string;
  password: string;
  /** multipart 파일 파트의 이름. CC-410 실측: `file`. */
  uploadFileField: string;
  /** `/auth/login` 응답에서 JWT를 담은 필드 이름. CC-410 실측: `token`. */
  tokenField: string;
  /** `/auth/login` 요청의 계정 필드 이름. CC-410 실측: `account`. */
  loginAccountField: string;
  /** 설계 08 §1.14: 업로드 60초. 나머지는 UNE 기준선이며 provider 합의값이 아니다. */
  uploadTimeoutMs: number;
  requestTimeoutMs: number;
  /** 설계 08 §1.14: UNI Search 30초, 1회. */
  searchTimeoutMs: number;
  fieldNames: UniFieldNames;
}

type FetchLike = typeof globalThis.fetch;

export class HttpUniKnowledgeAdapter implements UniKnowledgeProvider {
  readonly adapterId = 'http-uni-knowledge';
  readonly mappingVersion = 'uni-1.1.0-une1';
  readonly isMock = false;

  private token: string | null = null;

  constructor(
    private readonly config: HttpUniKnowledgeConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  private meta(operation: UniKnowledgeOperation, startedAt: number, httpStatus?: number) {
    return {
      adapterId: this.adapterId,
      mappingVersion: this.mappingVersion,
      operation,
      latencyMs: Math.max(0, Date.now() - startedAt),
      httpStatus,
    };
  }

  private fail<T>(
    code: UniKnowledgeErrorCode,
    message: string,
    operation: UniKnowledgeOperation,
    startedAt: number,
    raw: UniRawTrace,
    httpStatus?: number,
  ): UniKnowledgeResult<T> {
    return uniFailure<T>(
      {
        code,
        message,
        retryable: isRetryableUniError(code),
        // 업로드만 부작용이 불확실하다. 조회는 다시 물어도 아무것도 바뀌지 않는다.
        sideEffectUncertain:
          operation === 'uploadDocument' &&
          (code === 'UNI_TIMEOUT' ||
            code === 'UNI_PROVIDER_ERROR' ||
            code === 'UNI_RESPONSE_CONTRACT_VIOLATION' ||
            code === 'UNI_MALFORMED_RESPONSE'),
        httpStatus,
      },
      this.meta(operation, startedAt, httpStatus),
      raw,
    );
  }

  /**
   * 로그인해서 JWT를 얻는다 (설계 08 §1.8).
   *
   * 토큰을 캐시하되 만료를 계산하지 않는다 — 만료 시간의 형태도 OB-13이다.
   * 대신 401을 만나면 한 번 다시 로그인한다. 추측한 TTL로 미리 갱신하는 것보다
   * 실제 거절에 반응하는 편이 틀릴 여지가 적다.
   */
  private async login(): Promise<{ token: string } | { error: string; status?: number }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // **필드 이름은 `account`다 (CC-410, 2026-08-14 실측).** `username`으로
        // 보내면 422다 — 라이브 스펙 `LoginRequest`가 `{account, password}`를
        // required로 못박고 있고 실호출로도 확인했다. `uni-sop-1` 시절 이 한
        // 필드만 설정 밖 하드코딩이었고, 그것이 위 42행 주석이 경고한 바로 그
        // 실패("422를 보고 UNI가 거부했다고 읽는다")를 만들 자리였다.
        body: JSON.stringify({
          [this.config.loginAccountField]: this.config.username,
          password: this.config.password,
        }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (err) {
      return { error: `로그인 호출 실패: ${(err as Error).message}` };
    }
    if (!res.ok) return { error: `로그인이 거절됐다 (${res.status})`, status: res.status };

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { error: '로그인 응답이 JSON이 아니다' };
    }
    const rec = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const token = rec[this.config.tokenField];
    if (typeof token !== 'string' || token.length === 0) {
      // 여기서 다른 필드를 뒤지지 않는다. 추측한 필드에서 문자열을 하나 찾아
      // 토큰으로 쓰면, 그것이 토큰이 아닐 때 401의 원인이 영원히 숨는다.
      return {
        error: `로그인 응답에 토큰 필드 "${this.config.tokenField}"가 없다 (OB-13 — 실제 필드명 미확인)`,
      };
    }
    return { token };
  }

  private async authorized(
    run: (
      token: string,
    ) => Promise<{ res: Response; retriedAuth: boolean } | { authError: string }>,
  ): Promise<{ res: Response } | { authError: string }> {
    if (!this.token) {
      const r = await this.login();
      if ('error' in r) return { authError: r.error };
      this.token = r.token;
    }
    const first = await run(this.token);
    if ('authError' in first) return first;
    if (first.res.status !== 401) return { res: first.res };

    // 한 번만 다시 로그인한다.
    this.token = null;
    const r = await this.login();
    if ('error' in r) return { authError: r.error };
    this.token = r.token;
    const second = await run(this.token);
    if ('authError' in second) return second;
    return { res: second.res };
  }

  async uploadDocument(
    input: UniUploadInput,
    ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniUploadOutcome>> {
    const startedAt = Date.now();
    const raw: UniRawTrace = {
      requestSummary: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.content.byteLength,
        uploader: input.uploader,
        force: input.force,
        fileField: this.config.uploadFileField,
        correlationId: ctx.correlationId,
      },
      responseBody: null,
    };

    const url = new URL(`${this.config.baseUrl}/documents/upload`);
    // **`uploader`를 보내지 않는다 (CC-410, 2026-08-14 실측).**
    //
    // 보내면 UNI가 그 문자열을 문서 소유자로 기록하고, 삭제 권한은 "업로드한
    // 본인(JWT의 `user_name`) 또는 대표이사"만 갖는다. UNE는 여기에
    // `target.createdBy`(UNE 사용자 UUID)를 넣고 있었으므로 **UNI에 올린 문서를
    // UNE 계정으로 영원히 지울 수 없게 된다** — 실측으로 403을 확인했다
    // ("삭제 권한이 없습니다. 업로드한 본인 또는 대표이사만 삭제할 수 있습니다").
    // 멱등키가 없어(OB-13 §6) 재시도가 중복 문서를 만드는 것과 겹치면, 2만 건짜리
    // 공용 색인에 **지울 수 없는 쓰레기**가 쌓인다.
    //
    // 생략하면 UNI가 JWT의 `user_name`을 쓴다(실측 확인). 누가 올렸는지는 UNE
    // 쪽 `knowledge_document`가 이미 안다 — provider에 UUID를 흘릴 이유가 없다.
    // `input.uploader`는 원문 추적(`raw.requestSummary`)에만 남는다.
    url.searchParams.set('force', String(input.force));

    const send = async (token: string) => {
      const form = new FormData();
      // 파일 파트 이름이 OB-13이다. 설정값을 그대로 쓴다.
      const bytes = input.content;
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      form.append(
        this.config.uploadFileField,
        new Blob([buffer], { type: input.mimeType }),
        input.fileName,
      );
      try {
        const res = await this.fetchImpl(url.toString(), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'x-correlation-id': ctx.correlationId,
          },
          body: form,
          signal: AbortSignal.timeout(this.config.uploadTimeoutMs),
        });
        return { res, retriedAuth: false };
      } catch (err) {
        return { authError: `업로드 호출 실패: ${(err as Error).message}` };
      }
    };

    const outcome = await this.authorized(send);
    if ('authError' in outcome) {
      const timedOut = /timeout|abort/i.test(outcome.authError);
      return this.fail(
        timedOut ? 'UNI_TIMEOUT' : 'UNI_CONNECTION_ERROR',
        outcome.authError,
        'uploadDocument',
        startedAt,
        raw,
      );
    }

    const res = outcome.res;
    const text = await res.text().catch(() => '');
    raw.responseText = text;
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return this.fail(
        'UNI_MALFORMED_RESPONSE',
        '업로드 응답이 JSON이 아니다',
        'uploadDocument',
        startedAt,
        raw,
        res.status,
      );
    }
    raw.responseBody = body;

    if (!res.ok) {
      return this.fail(
        uniErrorFromStatus(res.status),
        `업로드가 거절됐다 (${res.status})`,
        'uploadDocument',
        startedAt,
        raw,
        res.status,
      );
    }

    const guarded = guardUniUpload(body, this.config.fieldNames);
    if (!guarded.ok) {
      return this.fail(
        'UNI_RESPONSE_CONTRACT_VIOLATION',
        guarded.reason,
        'uploadDocument',
        startedAt,
        raw,
        res.status,
      );
    }
    return uniSuccess(guarded.value, this.meta('uploadDocument', startedAt, res.status), raw);
  }

  async getDocumentStatus(
    documentId: string,
    ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniStatusOutcome>> {
    const startedAt = Date.now();
    const raw: UniRawTrace = {
      requestSummary: { documentId, correlationId: ctx.correlationId },
      responseBody: null,
    };
    const res = await this.getJson(
      `${this.config.baseUrl}/documents/${encodeURIComponent(documentId)}`,
      ctx,
      raw,
    );
    if ('failure' in res) {
      return this.fail(
        res.failure.code,
        res.failure.message,
        'getDocumentStatus',
        startedAt,
        raw,
        res.failure.status,
      );
    }
    const guarded = guardUniStatus(res.body, documentId, this.config.fieldNames);
    if (!guarded.ok) {
      return this.fail(
        'UNI_RESPONSE_CONTRACT_VIOLATION',
        guarded.reason,
        'getDocumentStatus',
        startedAt,
        raw,
        res.status,
      );
    }
    return uniSuccess(guarded.value, this.meta('getDocumentStatus', startedAt, res.status), raw);
  }

  async getReference(
    documentId: string,
    ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniReferenceOutcome>> {
    const startedAt = Date.now();
    const raw: UniRawTrace = {
      requestSummary: { documentId, correlationId: ctx.correlationId },
      responseBody: null,
    };
    const res = await this.getJson(
      `${this.config.baseUrl}/documents/${encodeURIComponent(documentId)}/reference`,
      ctx,
      raw,
      // 202는 정상 응답이다 — 실패로 접지 않는다.
      (s) => s === 200 || s === 202,
    );
    if ('failure' in res) {
      return this.fail(
        res.failure.code,
        res.failure.message,
        'getReference',
        startedAt,
        raw,
        res.failure.status,
      );
    }
    const guarded = guardUniReference(res.status, res.body, documentId);
    if (!guarded.ok) {
      return this.fail(
        'UNI_RESPONSE_CONTRACT_VIOLATION',
        guarded.reason,
        'getReference',
        startedAt,
        raw,
        res.status,
      );
    }
    return uniSuccess(guarded.value, this.meta('getReference', startedAt, res.status), raw);
  }

  /**
   * 근거 검색 (CC-230).
   *
   * **재시도하지 않는다.** 설계 08 §1.14가 "30초, 1회"이고, US-SIT-011 E-01은
   * 실패 시 "1회 재시도 후 직접 Context/수동"이라 **재시도 여부를 사용자가**
   * 고른다. 어댑터가 조용히 다시 부르면 그 선택지가 사라지고 30초가 60초가 된다.
   */
  async searchEvidence(
    input: UniSearchInput,
    ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniSearchOutcome>> {
    const startedAt = Date.now();
    // **`filters`를 provider에 보내지 않는다.** 처음에는 `...input.filters`를
    // 마지막에 펼쳤는데, 그러면 클라이언트가 준 임의 객체가 `doc_ids`·`top_k`·
    // `query`를 **덮어쓴다** — 사용자가 `{"doc_ids": []}`를 보내면 UNE가 UNI에
    // 범위 제한 없는 질의를 대신 던지고, 그 응답 원문(남의 기관 문서 본문)이
    // 요청자 테넌트의 `provider_result`에 영구히 적재된다(실측으로 재현했다).
    //
    // 예약 키만 막는 것으로 끝내지 않은 이유: CR-UNI-008의 `SearchRequest`에
    // `filters`가 **정의되어 있지 않다.** 계약에 없는 필드를 provider에 보내는
    // 것은 추측이다(.claude/rules/provider-adapters.md). 값은 UNE가
    // `evidence_set.filters_json`에 보관만 하고, 규격이 닫히면 그때 싣는다.
    const body = {
      query: input.query,
      top_k: input.topK,
      doc_ids: input.documentIds,
    };
    const raw: UniRawTrace = {
      // 질의 원문을 남긴다 — 어떤 근거가 왜 나왔는지 재현하려면 필요하고,
      // PII 최소화는 호출부가 이미 마쳤다(도메인 minimizePii).
      requestSummary: {
        query: input.query,
        topK: input.topK,
        documentCount: input.documentIds.length,
        correlationId: ctx.correlationId,
      },
      responseBody: null,
    };

    const send = async (token: string) => {
      try {
        const res = await this.fetchImpl(`${this.config.baseUrl}/search/`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-correlation-id': ctx.correlationId,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.searchTimeoutMs),
        });
        return { res, retriedAuth: false };
      } catch (err) {
        return { authError: `검색 호출 실패: ${(err as Error).message}` };
      }
    };

    const outcome = await this.authorized(send);
    if ('authError' in outcome) {
      const timedOut = /timeout|abort/i.test(outcome.authError);
      return this.fail(
        timedOut ? 'UNI_TIMEOUT' : 'UNI_CONNECTION_ERROR',
        outcome.authError,
        'searchEvidence',
        startedAt,
        raw,
      );
    }

    const res = outcome.res;
    const text = await res.text().catch(() => '');
    raw.responseText = text;
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      return this.fail(
        'UNI_MALFORMED_RESPONSE',
        '검색 응답이 JSON이 아니다',
        'searchEvidence',
        startedAt,
        raw,
        res.status,
      );
    }
    raw.responseBody = parsed;

    if (!res.ok) {
      return this.fail(
        uniErrorFromStatus(res.status),
        `검색이 거절됐다 (${res.status})`,
        'searchEvidence',
        startedAt,
        raw,
        res.status,
      );
    }

    const guarded = guardUniSearch(parsed, this.config.fieldNames);
    if (!guarded.ok) {
      return this.fail(
        'UNI_RESPONSE_CONTRACT_VIOLATION',
        guarded.reason,
        'searchEvidence',
        startedAt,
        raw,
        res.status,
      );
    }
    return uniSuccess(guarded.value, this.meta('searchEvidence', startedAt, res.status), raw);
  }

  private async getJson(
    url: string,
    ctx: UniCallContext,
    raw: UniRawTrace,
    accept: (status: number) => boolean = (s) => s >= 200 && s < 300,
  ): Promise<
    | { body: unknown; status: number }
    | { failure: { code: UniKnowledgeErrorCode; message: string; status?: number } }
  > {
    const send = async (token: string) => {
      try {
        const res = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            authorization: `Bearer ${token}`,
            'x-correlation-id': ctx.correlationId,
          },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        });
        return { res, retriedAuth: false };
      } catch (err) {
        return { authError: `호출 실패: ${(err as Error).message}` };
      }
    };
    const outcome = await this.authorized(send);
    if ('authError' in outcome) {
      const timedOut = /timeout|abort/i.test(outcome.authError);
      return {
        failure: {
          code: timedOut ? 'UNI_TIMEOUT' : 'UNI_CONNECTION_ERROR',
          message: outcome.authError,
        },
      };
    }
    const res = outcome.res;
    const text = await res.text().catch(() => '');
    raw.responseText = text;
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return {
          failure: {
            code: 'UNI_MALFORMED_RESPONSE',
            message: '응답이 JSON이 아니다',
            status: res.status,
          },
        };
      }
    }
    raw.responseBody = body;
    if (!accept(res.status)) {
      return {
        failure: {
          code: uniErrorFromStatus(res.status),
          message: `요청이 거절됐다 (${res.status})`,
          status: res.status,
        },
      };
    }
    return { body, status: res.status };
  }
}
