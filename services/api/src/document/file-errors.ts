import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * 업로드·반입 오류 코드 (설계 10 §3.4 UNE-DOC-001~004).
 *
 * 설계가 명시한 넷을 정본으로 쓴다: FILE-422-001(사전등록 거부),
 * FILE-422-002(완료 검증 실패), HWPX-422-001(반입 거부), HWPX-404-001(분석 없음).
 *
 * 전송 라우트(`PUT /files/{fileId}/content`)는 카탈로그 API가 아니므로 설계에
 * 코드가 없다. 새 도메인 코드를 지어내는 대신 그 성격에 맞는 코드를 붙인다 —
 * 티켓 불일치·만료는 인가 실패(FILE-403-001), 이미 확정된 파일에 다시 쓰는 것은
 * 상태 충돌(FILE-409-001), 선언 크기 초과는 413(FILE-413-001)이다. 이 셋은
 * 계약의 x-error-codes에도 그대로 적었다.
 */
export const fileErrors = {
  /** 파일을 찾을 수 없음. 다른 테넌트의 파일도 여기로 수렴한다. */
  notFound: (): ApiError => new ApiError(404, 'FILE-404-001', '파일을 찾을 수 없습니다.'),

  /** 사전등록 거부 — 형식·크기·용도. */
  registerRejected: (message: string, violations?: ErrorViolation[]): ApiError =>
    new ApiError(422, 'FILE-422-001', message, violations ? { violations } : undefined),

  /**
   * 완료 검증 실패. 선언과 저장 바이트가 다르다.
   *
   * 무엇이 어긋났는지 violations에 남기되 **재계산한 해시 값을 본문에 싣지
   * 않는다** — 임의 바이트의 해시를 서버가 계산해 돌려주는 것은 오라클이 된다.
   */
  verificationFailed: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'FILE-422-002', '업로드된 파일이 사전등록 정보와 일치하지 않습니다.', {
      violations,
      userAction: '파일을 다시 업로드하십시오.',
    }),

  /** 아직 바이트가 올라오지 않았는데 완료를 요청했다. */
  notUploaded: (): ApiError =>
    new ApiError(409, 'COM-0409', '업로드된 바이트가 없습니다.', {
      recoverable: true,
      userAction: '발급받은 URL로 파일을 먼저 전송하십시오.',
    }),

  /** 티켓이 이 파일의 것이 아니거나 만료됐다. */
  ticketRejected: (): ApiError =>
    new ApiError(403, 'FILE-403-001', '업로드 티켓이 유효하지 않습니다.', {
      userAction: '업로드를 다시 시작하십시오.',
    }),

  /** 이미 확정된 파일에 다시 전송했다. */
  alreadySettled: (state: string): ApiError =>
    new ApiError(409, 'FILE-409-001', `이미 확정된 파일입니다(${state}).`),

  tooLarge: (): ApiError => new ApiError(413, 'FILE-413-001', '사전등록한 크기를 넘는 본문입니다.'),

  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'COM-0400', '요청이 올바르지 않습니다.', { violations }),

  /** 반입 거부 — 검증되지 않은 파일, HWPX가 아닌 내용, 분석 실패. */
  importRejected: (message: string, violations?: ErrorViolation[]): ApiError =>
    new ApiError(422, 'HWPX-422-001', message, violations ? { violations } : undefined),

  /** 반입 대상 계획서가 없다(다른 테넌트·삭제됨 포함). */
  planNotFound: (): ApiError => new ApiError(404, 'PLAN-4003', '계획서를 찾을 수 없습니다.'),

  /**
   * 이 계획서에는 이미 문서가 있다.
   *
   * 덮어쓰면 먼저 있던 문서가 조용히 고아가 된다. 재조회로 고쳐지지 않는
   * 상태 충돌이므로 409다.
   */
  planAlreadyHasDocument: (): ApiError =>
    new ApiError(409, 'COM-0409', '이 계획서에는 이미 본문 문서가 있습니다.', {
      userAction: '기존 문서를 편집하거나 새 계획서를 만드십시오.',
    }),

  /** 분석 이력이 없는 문서. */
  analysisNotFound: (): ApiError =>
    new ApiError(404, 'HWPX-404-001', '이 문서의 분석 결과가 없습니다.'),

  /** 저장소 장애. 없음(404)과 구분한다. */
  storageUnavailable: (): ApiError =>
    new ApiError(503, 'COM-0503', '파일 저장소에 접근할 수 없습니다.', {
      userAction: '잠시 후 다시 시도하십시오.',
    }),
};
