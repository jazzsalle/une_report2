import { ApiError } from '../common/api-error';

/**
 * CC-260 오류 코드 (UNE-SOP-010~016).
 *
 * 설계 10 SOP 표가 정한 것: `SOP-422-008`(Dry-run), `SOP-409-005`(실행 시작),
 * `SOP-404-002`(실행 상세 — 그러나 그 번호는 CC-250이 SOP 버전 404에 쓰고 있어
 * 실행에는 `SOP-404-004`를 새로 쓴다), `SOP-503-001`(SSE), `SOP-409-006/007/008`
 * (일시중지·재개·강제종료).
 *
 * CC-230/240/250과 같은 규칙: **던지지 않는 코드는 계약에 남기지 않는다.**
 */
export const sopRunErrors = {
  sopNotFound: (): ApiError => new ApiError(404, 'SOP-404-001', 'SOP를 찾을 수 없습니다.'),

  versionNotFound: (): ApiError => new ApiError(404, 'SOP-404-002', 'SOP 버전을 찾을 수 없습니다.'),

  runNotFound: (): ApiError => new ApiError(404, 'SOP-404-004', '실행을 찾을 수 없습니다.'),

  situationNotFound: (): ApiError => new ApiError(404, 'SOP-404-003', '상황을 찾을 수 없습니다.'),

  /**
   * 승인되지 않은 버전 (UNE-SOP-011 선행조건).
   *
   * 초안을 실행하면 검토받지 않은 절차가 현장에 나간다.
   */
  versionNotApproved: (): ApiError =>
    new ApiError(412, 'SOP-412-004', '승인된 SOP 버전만 실행할 수 있습니다.', {
      userAction: '검토를 마치고 승인한 뒤 실행하십시오.',
    }),

  /** 상황에 연결되지 않은 SOP는 실행할 수 없다 — 어느 상황의 대응인지 없다. */
  situationRequired: (): ApiError =>
    new ApiError(412, 'SOP-412-004', '상황에 연결된 SOP만 실행할 수 있습니다.', {
      userAction: '상황을 지정한 SOP를 사용하십시오.',
    }),

  /** 낡은 판으로 시작하려 한다 — 대응 근거와 실제 사실이 어긋난 채로 굳는다. */
  snapshotNotCurrent: (currentSnapshotId: string): ApiError =>
    new ApiError(422, 'SOP-422-008', '최신 상황 판이 아닙니다.', {
      recoverable: true,
      userAction: `최신 판(${currentSnapshotId})으로 다시 시작하십시오.`,
    }),

  /**
   * 실행 방식이 상황 방식보다 더 실제다 (CC-320 V-2).
   *
   * 훈련 상황에서 LIVE 실행을 열면 ADR-41 D9의 방어(`dispatchesForReal`)가
   * 비껴가고 훈련이 실제 문자를 보낸다. 요청 시점에 거절한다 — 만들어진 뒤에
   * 전파에서 막으면 이미 임무가 현장 화면에 떠 있다.
   */
  runModeExceedsSituation: (situationMode: string, runMode: string): ApiError =>
    new ApiError(422, 'SOP-422-009', '상황 방식보다 더 실제인 실행은 시작할 수 없습니다.', {
      recoverable: false,
      userAction: `훈련(${situationMode}) 상황에서는 ${runMode} 실행을 열 수 없습니다. EXERCISE 또는 DRY_RUN으로 시작하십시오.`,
    }),

  /**
   * 이미 살아 있는 실행이 있다.
   *
   * 둘이 동시에 돌면 같은 상황에 대해 "지금 무엇을 하고 있는가"의 답이 둘이
   * 된다. 모의(DRY_RUN)는 세지 않는다.
   */
  runAlreadyLive: (runId: string): ApiError =>
    new ApiError(409, 'SOP-409-005', '이미 진행 중인 실행이 있습니다.', {
      recoverable: true,
      userAction: `진행 중인 실행(${runId})을 종료한 뒤 다시 시작하십시오.`,
    }),

  cannotPause: (status: string): ApiError =>
    new ApiError(409, 'SOP-409-006', `현재 상태(${status})에서는 일시중지할 수 없습니다.`),

  cannotResume: (status: string): ApiError =>
    new ApiError(409, 'SOP-409-007', `현재 상태(${status})에서는 재개할 수 없습니다.`),

  cannotTerminate: (status: string): ApiError =>
    new ApiError(409, 'SOP-409-008', `현재 상태(${status})에서는 종료할 수 없습니다.`),

  /**
   * 확인코드 불일치 (UNE-SOP-016).
   *
   * 400이다 — 요청이 잘못됐다. 상태 문제가 아니라 사용자가 지금 무엇을 끄는지
   * 확인하지 않았다는 뜻이다.
   */
  confirmCodeMismatch: (): ApiError =>
    new ApiError(400, 'SOP-400-003', '확인코드가 일치하지 않습니다.', {
      userAction: '화면에 표시된 실행 확인코드를 그대로 입력하십시오.',
    }),
};
