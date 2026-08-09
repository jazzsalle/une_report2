/**
 * UNI 지식문서 포트 (CC-220).
 *
 * 설계 06 US-SIT-009·US-SIT-010, 설계 08 §1.8(인증·Gateway)·§1.9(업로드 수명
 * 주기)·§1.14(Timeout/Retry), 설계 10 UNE-KNOW-001~003.
 *
 * T3Q 계획 포트(ADR-26 D1/D2)와 같은 규약을 따른다.
 *
 * - **Provider 실패는 예외가 아니라 결과값이다.** 계약 위반과 미지원도 마찬가지
 *   이며, 원문 요청·응답이 실패와 **함께** 이동한다 — 추적이 실제로 필요한
 *   순간에 원문이 살아 있어야 한다(CLAUDE.md 비협상 규칙).
 * - `adapterId`/`mappingVersion`은 포트 상수가 아니라 **결과마다** 기록한다.
 *
 * **React가 UNI를 직접 부르지 않는다**(설계 08 §1.8, US-SIT-009 3단계). 이
 * 포트의 구현체는 백엔드에서만 산다.
 */

export const UNI_KNOWLEDGE_OPERATIONS = [
  'uploadDocument', // POST /documents/upload
  'getDocumentStatus', // 내부 상태조회 (설계 08 §1.9)
  'getReference', // GET /documents/{id}/reference
] as const;

export type UniKnowledgeOperation = (typeof UNI_KNOWLEDGE_OPERATIONS)[number];

export const UNI_KNOWLEDGE_ERROR_CODES = [
  'UNI_CONNECTION_ERROR', // DNS/refused/TLS/connect-timeout — UNI에 아무것도 닿지 않았다
  'UNI_TIMEOUT', // 응답 timeout — UNI가 **처리했을 수도 있다**(업로드는 특히 위험)
  'UNI_REQUEST_REJECTED', // 400/422 — UNE 매핑 결함 신호
  'UNI_AUTH_ERROR', // 401/403 — 설정 결함 또는 토큰 만료
  'UNI_ENDPOINT_NOT_FOUND', // 404
  'UNI_RATE_LIMITED', // 429
  'UNI_PROVIDER_ERROR', // 5xx
  'UNI_MALFORMED_RESPONSE', // 비-JSON, 잘못된 content type
  'UNI_RESPONSE_CONTRACT_VIOLATION', // 응답 가드가 거부했다 (원문은 보존된다)
  'UNI_NOT_SUPPORTED', // 이 어댑터가 구현하지 않은 오퍼레이션
  'MOCK_PROVIDER_ERROR', // mock 시나리오 실패 (테스트/데모 전용)
] as const;

export type UniKnowledgeErrorCode = (typeof UNI_KNOWLEDGE_ERROR_CODES)[number];

export interface UniKnowledgeError {
  code: UniKnowledgeErrorCode;
  message: string;
  /**
   * 재시도해도 되는가.
   *
   * `UNI_TIMEOUT`은 **retryable이지만 안전하지 않다** — UNI 업로드에는 멱등키가
   * 없고(OB-13), 우리가 못 받은 응답을 저쪽은 이미 처리했을 수 있다. 그래서
   * `sideEffectUncertain`을 따로 둔다. 이 값이 참이면 재시도가 같은 문서를 두 벌
   * 만들 수 있고, 그 판단은 도메인이 한다(UNE-KNOW-003의 force).
   */
  retryable: boolean;
  sideEffectUncertain: boolean;
  httpStatus?: number;
}

export interface UniCallContext {
  correlationId: string;
}

interface UniResultMeta {
  adapterId: string;
  mappingVersion: string;
  operation: UniKnowledgeOperation;
  latencyMs: number;
  httpStatus?: number;
}

/**
 * 원문 보존. 성공·실패 모두에 실린다.
 *
 * `requestSummary`는 요청 **원문이 아니다** — 업로드 요청 본문은 파일 바이트라
 * 통째로 남길 수 없고 남겨서도 안 된다. 무엇을 보냈는지 재현할 수 있는
 * 최소 정보(파일명·크기·해시·질의 파라미터)만 남긴다.
 */
export interface UniRawTrace {
  requestSummary: Record<string, unknown>;
  responseBody: unknown;
  responseText?: string;
}

export type UniKnowledgeResult<T> =
  | { ok: true; value: T; meta: UniResultMeta; raw: UniRawTrace }
  | { ok: false; error: UniKnowledgeError; meta: UniResultMeta; raw: UniRawTrace };

/** UNI에 올릴 문서. 바이트는 스트림이 아니라 버퍼다 — 크기 상한이 정책으로 있다. */
export interface UniUploadInput {
  fileName: string;
  mimeType: string;
  content: Uint8Array;
  /** 설계 08 §1.9의 질의 파라미터. */
  uploader: string;
  force: boolean;
}

/**
 * 업로드 응답.
 *
 * 필드 이름은 설계 08 §1.9가 적은 `{message, filename, doc_id}`를 기준선으로
 * 삼는다. 번들 스냅샷(`uni-rag-adapter-v1.1.0-une1.yaml`)은 모든 응답이
 * `additionalProperties: true`라 아무것도 말해 주지 않는다 — 실제 필드명은
 * OB-13으로 열려 있고, 어댑터는 설정으로 이름을 바꿀 수 있게 두되 **추측하지
 * 않는다**(맞지 않으면 계약 위반으로 거부하고 원문을 남긴다).
 */
export interface UniUploadOutcome {
  documentId: string;
  fileName: string | null;
  message: string | null;
}

export interface UniStatusOutcome {
  documentId: string;
  /** 설계 08 §1.9의 어휘. 매핑되지 않는 값은 계약 위반으로 거부한다. */
  status: string;
}

export interface UniReferenceOutcome {
  documentId: string;
  /** 200이면 준비됨, 202면 아직 생성 중이다(설계 08 §1.9). */
  ready: boolean;
  reference: Record<string, unknown> | null;
}

export interface UniKnowledgeProvider {
  readonly adapterId: string;
  readonly mappingVersion: string;
  /** mock인지 실 HTTP인지 — 로그·감사·capability 보고가 이 값을 쓴다. */
  readonly isMock: boolean;

  uploadDocument(
    input: UniUploadInput,
    ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniUploadOutcome>>;

  getDocumentStatus(
    documentId: string,
    ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniStatusOutcome>>;

  getReference(
    documentId: string,
    ctx: UniCallContext,
  ): Promise<UniKnowledgeResult<UniReferenceOutcome>>;
}

/** 실패 결과를 만드는 공통 경로 — 원문을 빠뜨릴 수 없게 한다. */
export function uniFailure<T>(
  error: UniKnowledgeError,
  meta: UniResultMeta,
  raw: UniRawTrace,
): UniKnowledgeResult<T> {
  return { ok: false, error, meta, raw };
}

export function uniSuccess<T>(
  value: T,
  meta: UniResultMeta,
  raw: UniRawTrace,
): UniKnowledgeResult<T> {
  return { ok: true, value, meta, raw };
}

/**
 * HTTP 상태를 포트 오류코드로 옮긴다.
 *
 * `sideEffectUncertain`은 여기서 정하지 않는다 — 같은 500이라도 업로드와
 * 상태조회의 부작용 위험이 다르다. 호출부가 오퍼레이션을 알고 결정한다.
 */
export function uniErrorFromStatus(status: number): UniKnowledgeErrorCode {
  if (status === 401 || status === 403) return 'UNI_AUTH_ERROR';
  if (status === 404) return 'UNI_ENDPOINT_NOT_FOUND';
  if (status === 429) return 'UNI_RATE_LIMITED';
  if (status === 400 || status === 422) return 'UNI_REQUEST_REJECTED';
  if (status >= 500) return 'UNI_PROVIDER_ERROR';
  return 'UNI_MALFORMED_RESPONSE';
}

export function isRetryableUniError(code: UniKnowledgeErrorCode): boolean {
  return (
    code === 'UNI_CONNECTION_ERROR' ||
    code === 'UNI_TIMEOUT' ||
    code === 'UNI_RATE_LIMITED' ||
    code === 'UNI_PROVIDER_ERROR'
  );
}
