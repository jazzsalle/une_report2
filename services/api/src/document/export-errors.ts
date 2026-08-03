import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * Export 오류 코드 (설계 10 §3.4 UNE-DOC-012~014).
 *
 * 설계가 명시한 셋만 쓴다: EXPORT-422-001(요청 거부), EXPORT-404-001(없음),
 * EXPORT-410-001(산출물 소멸). 새 코드를 지어내지 않는다 — 코드가 늘면
 * 화면의 오류 처리표(설계 09)와 어긋난다.
 */
export const exportErrors = {
  /** Export를 찾을 수 없음. 다른 테넌트의 Export도 여기로 수렴한다. */
  notFound: (): ApiError => new ApiError(404, 'EXPORT-404-001', 'Export를 찾을 수 없습니다.'),

  /** 문서/리비전이 없거나 요청이 업무규칙을 어김. */
  unprocessable: (message: string, violations?: ErrorViolation[]): ApiError =>
    new ApiError(422, 'EXPORT-422-001', message, violations ? { violations } : undefined),

  /**
   * 산출물이 더 이상 없다(보존기간 만료·정리). 404가 아니라 410인 이유는
   * "있었지만 지금은 없다"를 사용자에게 그대로 전하기 위해서다 — 404는
   * "그런 것은 없었다"로 읽힌다.
   */
  gone: (): ApiError =>
    new ApiError(410, 'EXPORT-410-001', 'Export 산출물이 더 이상 존재하지 않습니다.', {
      userAction: '문서에서 Export를 다시 요청하십시오.',
    }),

  /**
   * 아직 완료되지 않은 Export의 다운로드.
   *
   * 설계의 x-error-codes에는 이 경우가 없다. 새 EXPORT-* 코드를 지어내는 대신
   * **기존 공통 코드 COM-0409**를 쓴다 — 도메인 코드를 늘리면 화면의 오류
   * 처리표(설계 09)와 어긋나고, 이것은 도메인 규칙 위반이 아니라 "아직
   * 아님"이라는 상태 충돌이기 때문이다.
   */
  notReady: (status: string): ApiError =>
    new ApiError(409, 'COM-0409', `Export가 아직 완료되지 않았습니다(${status}).`, {
      recoverable: true,
      userAction: 'Export 상태가 COMPLETED가 된 뒤 다시 시도하십시오.',
    }),

  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'COM-0400', 'Export 요청이 올바르지 않습니다.', { violations }),

  /** 저장소 장애. 만료(410)와 구분한다. */
  storageUnavailable: (): ApiError =>
    new ApiError(503, 'COM-0503', '산출물 저장소에 접근할 수 없습니다.', {
      userAction: '잠시 후 다시 시도하십시오.',
    }),
};
