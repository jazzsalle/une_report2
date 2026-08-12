import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * CC-280 오류 코드 (UNE-TASK-001/002/004~012).
 *
 * 설계 10 TASK 표가 정한 번호를 그대로 쓴다: `TASK-404-001`, `TASK-409-001~007`,
 * `TASK-422-006`, `TASK-422-008`, `FILE-422-003`. 표에 없는 것(권한·선행조건)은
 * 같은 규칙으로 이어 붙인다.
 *
 * 설계 09의 화면 오류(`TASK-5201~5208`)는 **던지지 않는다.** 그 번호들은
 * 서명링크 화면(`/task/:signedToken`)을 전제로 하는데 그 인증 경로를 만들지
 * 않았다(0038 §6). 대응되는 개념은 아래 API 코드가 담는다:
 * 5202 수신자 불일치 → `TASK-403-001`, 5203 중복 수신확인 → `TASK-409-001`,
 * 5206 완료증거 누락·5207 완료 후 중복제출 → `TASK-422-008`·`TASK-409-008`,
 * 5208 재배정 대상 없음 → `TASK-422-010`.
 *
 * CC-230/240/250/260/270과 같은 규칙: **던지지 않는 코드는 계약에 남기지 않는다.**
 */
export const taskErrors = {
  notFound: (): ApiError => new ApiError(404, 'TASK-404-001', '임무를 찾을 수 없습니다.'),

  /**
   * 담당자가 아니다.
   *
   * `TASK_ASSIGNEE` 권한은 여러 현장요원이 함께 갖는 역할이라 그것만으로는
   * "이 임무를 할 사람"이 되지 않는다. 권한과 배정은 다른 질문이다.
   */
  notAssignee: (): ApiError =>
    new ApiError(403, 'TASK-403-001', '이 임무의 담당자가 아닙니다.', {
      userAction: '담당자 재배정이 필요하면 지휘자에게 요청하십시오.',
    }),

  /**
   * 담당자가 아직 지정되지 않았다 — 누가 받았는지 기록할 수 없다.
   *
   * `TASK-412-001`·`TASK-412-002`는 CC-270이 전파에 이미 쓰고 있다. 같은 번호에
   * 다른 뜻을 겹치면 클라이언트가 코드로 분기할 수 없다.
   */
  noAssignee: (): ApiError =>
    new ApiError(412, 'TASK-412-003', '담당자가 지정되지 않은 임무입니다.', {
      recoverable: true,
      userAction: '지휘자가 담당자를 배정한 뒤 진행하십시오.',
    }),

  /**
   * 종료·일시중지된 실행의 임무는 움직이지 않는다.
   *
   * CC-270이 전파에 쓰는 `TASK-412-002`와 **같은 뜻**이라 같은 코드를 쓴다 —
   * 실행 상태 때문에 지금 이 조작을 할 수 없다는 한 가지 사실이다.
   */
  runNotActive: (status: string): ApiError =>
    new ApiError(412, 'TASK-412-002', `실행이 진행 중이 아닙니다 (현재 ${status}).`, {
      recoverable: true,
      userAction: '지휘자가 실행을 재개한 뒤 다시 시도하십시오.',
    }),

  alreadyAcknowledged: (): ApiError =>
    new ApiError(409, 'TASK-409-001', '이미 수신확인한 임무입니다.', {
      recoverable: true,
      userAction: '화면을 새로고침하면 현재 상태가 보입니다.',
    }),

  cannotStart: (status: string): ApiError =>
    new ApiError(409, 'TASK-409-002', `현재 상태(${status})에서는 착수할 수 없습니다.`),

  cannotReport: (status: string): ApiError =>
    new ApiError(409, 'TASK-409-003', `현재 상태(${status})에서는 진행보고할 수 없습니다.`),

  cannotApprove: (status: string): ApiError =>
    new ApiError(409, 'TASK-409-004', `현재 상태(${status})에서는 완료 승인할 수 없습니다.`),

  cannotReject: (status: string): ApiError =>
    new ApiError(409, 'TASK-409-005', `현재 상태(${status})에서는 완료 반려할 수 없습니다.`),

  cannotReassign: (status: string): ApiError =>
    new ApiError(409, 'TASK-409-006', `현재 상태(${status})에서는 재배정할 수 없습니다.`),

  cannotEscalate: (status: string): ApiError =>
    new ApiError(409, 'TASK-409-007', `현재 상태(${status})에서는 Escalation할 수 없습니다.`),

  /**
   * 완료 보고를 두 번 냈다 (설계 09 `TASK-5207`).
   *
   * 승인 뒤 재제출이 조용히 통과하면 감사 이력이 오염된다 — 그래서 흡수하지
   * 않고 거부한다. 반면 수신확인은 부작용이 단조로워 같은 멱등키면 재생한다.
   */
  cannotSubmitCompletion: (status: string): ApiError =>
    new ApiError(409, 'TASK-409-008', `현재 상태(${status})에서는 완료 보고할 수 없습니다.`),

  cannotReportUnable: (status: string): ApiError =>
    new ApiError(409, 'TASK-409-009', `현재 상태(${status})에서는 수행불가 보고할 수 없습니다.`),

  /** 다른 사람이 먼저 바꿨다 — 조건부 UPDATE가 0행을 돌려준 경우. */
  stateChanged: (): ApiError =>
    new ApiError(409, 'TASK-409-010', '임무 상태가 그사이 바뀌었습니다.', {
      recoverable: true,
      userAction: '최신 상태를 다시 읽은 뒤 시도하십시오.',
    }),

  invalidProgress: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'TASK-422-006', '진행보고 값을 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  completionRejected: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'TASK-422-008', '완료조건을 충족하지 않았습니다.', {
      recoverable: true,
      userAction: '미충족 항목을 채우고 다시 제출하십시오.',
      violations,
    }),

  invalidUnableReport: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'TASK-422-009', '수행불가 보고 내용을 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  /** 설계 09 `TASK-5208` 재배정 대상 없음. */
  reassignTargetInvalid: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'TASK-422-010', '재배정 대상을 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  invalidEscalation: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'TASK-422-011', 'Escalation 요청을 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  /** 설계 10 UNE-TASK-012 `FILE-422-003`. */
  attachmentRejected: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'FILE-422-003', '첨부 파일을 확인하십시오.', {
      recoverable: true,
      violations,
    }),
};
