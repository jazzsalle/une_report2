import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * 종료·평가 오류 (CC-310, UNE-JNL-012~015).
 *
 * 설계가 적은 넷을 쓴다: `SIT-412-010`(종료 선행조건), `EVAL-422-001`(평가
 * 생성), `EVAL-422-002`(개선조치), `EVAL-404-001`(없음). 나머지는 공통 코드다.
 *
 * 던지지 않는 코드는 만들지 않는다 — 계약이 광고한 오류가 실제로는 나오지
 * 않으면 클라이언트가 다루지 않을 분기를 다루게 된다.
 */
export const evaluationErrors = {
  situationNotFound: (): ApiError => new ApiError(404, 'SIT-404-001', '상황을 찾을 수 없습니다.'),

  notFound: (): ApiError => new ApiError(404, 'EVAL-404-001', '평가를 찾을 수 없습니다.'),

  /**
   * 종료 선행조건 미충족 (UNE-JNL-012).
   *
   * **미결 목록을 본문에 실어 보낸다.** 빈 412는 사용자가 왜 막혔는지 모르고,
   * 화면(SCR-EVAL-001)이 처분 UI를 그릴 근거도 없다.
   */
  closeBlocked: (
    blockers: ReadonlyArray<{ kind: string; refId: string; label: string; detail: string }>,
    violations: ErrorViolation[],
  ): ApiError =>
    new ApiError(412, 'SIT-412-010', '아직 정리되지 않은 항목이 있습니다.', {
      recoverable: true,
      violations,
      meta: { blockers },
    }),

  /** 이미 닫혔거나 닫을 수 있는 상태가 아니다. */
  cannotClose: (status: string): ApiError =>
    new ApiError(412, 'SIT-412-010', `현재 상태(${status})에서는 종료할 수 없습니다.`),

  /** 평가 생성·수정 (UNE-JNL-013). */
  invalidEvaluation: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'EVAL-422-001', '평가 내용을 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  /**
   * 훈련이 끝나지 않았다.
   *
   * US-SIT-036의 선행조건이 CLOSED다. 기준선이 움직이는 채로 평가하면 그
   * 평가서가 무엇을 근거로 삼았는지 나중에 말할 수 없다.
   */
  situationNotClosed: (status: string): ApiError =>
    new ApiError(412, 'EVAL-412-001', `종료된 훈련만 평가할 수 있습니다(현재 ${status}).`, {
      recoverable: true,
      userAction: '먼저 훈련을 종료하십시오(UNE-JNL-012).',
    }),

  /**
   * 한 훈련에 평가는 하나다.
   *
   * 선행 조회와 유니크 위반(23505) 두 곳에서 같은 코드로 나온다 — 동시 요청이
   * 부딪힌 것은 서버 결함이 아니라 "이미 있다"는 사실이다.
   */
  alreadyEvaluated: (): ApiError =>
    new ApiError(422, 'EVAL-422-001', '이미 평가가 있습니다.', {
      recoverable: true,
      violations: [{ field: 'situationId', reason: '지표를 더하려면 그 평가를 여십시오.' }],
    }),

  /** 확정된 평가는 고치지 않는다. 정정은 새 평가다. */
  notEditable: (status: string): ApiError =>
    new ApiError(409, 'EVAL-409-001', `확정된 평가(${status})는 고칠 수 없습니다.`),

  /** 개선조치 (UNE-JNL-014). */
  invalidImprovement: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'EVAL-422-002', '개선조치를 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  /** 보고서 형식 (UNE-JNL-015). 실제로 나오는 것만 지원한다고 말한다. */
  unsupportedFormat: (format: string): ApiError =>
    new ApiError(422, 'EVAL-422-003', `${format} 형식은 지원하지 않습니다.`, {
      violations: [{ field: 'format', reason: '현재 지원하는 형식은 JSON뿐입니다.' }],
    }),
} as const;
