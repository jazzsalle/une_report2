import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * CC-250 오류 코드 (UNE-SOP-003~009).
 *
 * 설계 10 SOP 표가 정한 것: `SOP-6001`(정의 생성), `SOP-6002`(목록),
 * `SOP-404-001`(그래프 조회), `SOP-409-001`(Draft 저장), `SOP-422-007`(검증),
 * `SOP-412-001`(검토 요청), `SOP-412-002`(승인). 앞의 둘은 옛 표기인데 설계가
 * 배정한 값이라 그대로 쓴다 — 새로 만드는 것만 ADR-33 D7의
 * `<도메인>-<HTTP>-<일련>`을 따른다.
 *
 * CC-230/240과 같은 규칙: **던지지 않는 코드는 계약에 남기지 않는다.**
 * 계약 게이트가 정의가 아니라 **호출부**를 본다.
 */
export const sopCanvasErrors = {
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'SOP-6001', 'SOP 요청이 올바르지 않습니다.', { violations }),

  invalidQuery: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'SOP-6002', 'SOP 목록 조회 조건이 올바르지 않습니다.', { violations }),

  /** 그래프 본문이 스스로 성립하지 않는다(간선이 없는 노드를 가리키는 등). */
  invalidGraph: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'SOP-400-002', '그래프가 올바르지 않습니다.', { violations }),

  notFound: (): ApiError => new ApiError(404, 'SOP-404-001', 'SOP를 찾을 수 없습니다.'),

  versionNotFound: (): ApiError => new ApiError(404, 'SOP-404-002', 'SOP 버전을 찾을 수 없습니다.'),

  situationNotFound: (): ApiError => new ApiError(404, 'SOP-404-003', '상황을 찾을 수 없습니다.'),

  /**
   * 낙관적 동시성 충돌 (설계 09 ALT-02).
   *
   * 자동 덮어쓰기를 하지 않는다 — 그 사이 누군가 저장했다는 뜻이고, 무엇이
   * 달라졌는지 사용자가 보고 판단해야 한다.
   */
  versionConflict: (currentVersionId: string): ApiError =>
    new ApiError(409, 'SOP-409-001', '다른 사용자가 이미 저장했습니다.', {
      recoverable: true,
      userAction: `최신 버전(${currentVersionId})을 불러와 변경 내용을 다시 반영하십시오.`,
    }),

  /** 이미 검토 중이다. 한 버전에 열린 검토 요청은 하나다(0035 §2). */
  reviewAlreadyOpen: (reviewRequestId: string): ApiError =>
    new ApiError(409, 'SOP-409-003', '이미 검토 요청이 진행 중입니다.', {
      recoverable: true,
      userAction: `진행 중인 검토 요청(${reviewRequestId})을 마친 뒤 다시 시도하십시오.`,
    }),

  /** 검토 요청 선행조건 (설계 10 SOP-412-001). */
  notSubmittable: (status: string): ApiError =>
    new ApiError(412, 'SOP-412-001', `현재 상태(${status})에서는 검토를 요청할 수 없습니다.`, {
      userAction: '초안 상태의 SOP만 검토에 올릴 수 있습니다.',
    }),

  /** 승인 선행조건 (설계 10 SOP-412-002). */
  notApprovable: (reason: string): ApiError =>
    new ApiError(412, 'SOP-412-002', approveMessage(reason), {
      userAction: approveAction(reason),
    }),

  /** 편집 선행조건 — 검토 중이거나 승인된 SOP는 고칠 수 없다. */
  notEditable: (status: string): ApiError =>
    new ApiError(412, 'SOP-412-003', `현재 상태(${status})에서는 그래프를 수정할 수 없습니다.`, {
      userAction:
        status === 'IN_REVIEW'
          ? '검토가 끝난 뒤 수정하십시오 — 검토 중 수정은 검토자가 본 것을 바꿉니다.'
          : '승인된 절차는 수정하지 않습니다. 새 SOP를 만드십시오.',
    }),
};

function approveMessage(reason: string): string {
  switch (reason) {
    case 'ALREADY_LOCKED':
      return '이미 승인된 버전입니다.';
    case 'NOT_IN_REVIEW':
      return '검토 요청을 거치지 않은 SOP는 승인할 수 없습니다.';
    case 'NOT_VALIDATED':
      return '검증하지 않은 버전은 승인할 수 없습니다.';
    case 'VALIDATION_FAILED':
      return '검증에 실패한 버전은 승인할 수 없습니다.';
    default:
      return '승인 선행조건을 만족하지 않습니다.';
  }
}

function approveAction(reason: string): string {
  switch (reason) {
    case 'ALREADY_LOCKED':
      return '정정이 필요하면 새 버전을 만드십시오 — 승인은 되돌리지 않습니다.';
    case 'NOT_IN_REVIEW':
      return '먼저 검토를 요청하십시오.';
    default:
      return '검증을 실행해 오류를 모두 해소한 뒤 다시 시도하십시오.';
  }
}
