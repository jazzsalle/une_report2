import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * CC-290 오류 코드 (UNE-JNL-001~004).
 *
 * 설계 10 JNL 표가 정한 번호를 쓴다: `DASH-8001`, `EXEC-8002`, `EXEC-404-001`,
 * `EXEC-409-001`. 앞의 둘은 표에 "오류"로 적혀 있지만 상태코드가 없는 형태라
 * 각각 400·400으로 붙였다 — 조회 요청이 잘못된 경우다.
 *
 * 설계 09의 화면 오류(`BOARD-5401` SSE 연결끊김, `BOARD-5402` Projection 지연,
 * `BOARD-5403` Event 상세 권한없음)는 **던지지 않는다.** 5401·5402는 서버가
 * 내는 것이 아니라 화면이 스스로 판단하는 상태이고(연결이 끊겼다는 것을 서버가
 * 알려 줄 수는 없다), 5403은 권한 가드의 `COM-0403`이다.
 *
 * 앞선 항목들과 같은 규칙: **던지지 않는 코드는 계약에 남기지 않는다.**
 */
export const executionErrors = {
  situationNotFound: (): ApiError => new ApiError(404, 'SIT-404-001', '상황을 찾을 수 없습니다.'),

  eventNotFound: (): ApiError =>
    new ApiError(404, 'EXEC-404-001', '실행 이벤트를 찾을 수 없습니다.'),

  /** 전자상황판 조회 요청이 잘못됐다. */
  invalidDashboardQuery: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'DASH-8001', '전자상황판 조회 조건을 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  /** 실행로그 조회 요청이 잘못됐다. */
  invalidLogQuery: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'EXEC-8002', '실행로그 조회 조건을 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  /**
   * 정정 요청 본문이 잘못됐다.
   *
   * 조회용 `EXEC-8002`를 쓰면 "실행로그 **조회 조건**을 확인하십시오"가 정정
   * 실패에 나간다. 같은 코드에 다른 뜻을 겹치지 않는다.
   */
  invalidCorrectionRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'EXEC-400-001', '정정 요청을 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  /**
   * 정정할 수 없다 (UNE-JNL-004).
   *
   * 대상이 정정 이벤트이거나(사슬 금지), 시스템이 관측한 사실이거나, 바꿀 수
   * 없는 필드를 건드렸다. 셋 다 "요청 자체가 성립하지 않는다"이므로 409다 —
   * 값이 틀린 것이 아니라 그 대상에 이 조작이 없다.
   */
  correctionRejected: (violations: ErrorViolation[]): ApiError =>
    new ApiError(409, 'EXEC-409-001', '이 이벤트는 정정할 수 없습니다.', {
      recoverable: false,
      userAction: '시스템이 기록한 사실은 정정 대신 새 조치(재전파·반려·재배정)로 바로잡습니다.',
      violations,
    }),

  /**
   * 원본이 그사이 바뀌었다.
   *
   * append-only라 일어나면 안 되는 일이다 — 일어났다면 권한 회수와 트리거를
   * 우회한 무엇이 있었다는 뜻이고, 그 위에 정정을 얹으면 안 된다.
   */
  originalTampered: (): ApiError =>
    new ApiError(409, 'EXEC-409-002', '원본 이벤트의 무결성 검증에 실패했습니다.', {
      recoverable: false,
      userAction: '관리자에게 즉시 알리십시오.',
    }),
};
