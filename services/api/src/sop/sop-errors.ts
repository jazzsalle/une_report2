import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * CC-240 오류 코드 (UNE-SOP-001/002).
 *
 * 설계 10 SOP 표가 정한 것은 둘이다 — `UNI-422-003`(생성 요청),
 * `UNI-503-003`(SSE). 나머지는 CC-240 신설이고 ADR-33 D7의
 * `<도메인>-<HTTP>-<일련>` 표기를 따른다.
 *
 * CC-230과 같은 규칙: **던지지 않는 코드는 계약에 남기지 않는다.**
 */
export const sopErrors = {
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'SOP-400-001', 'SOP 생성 요청이 올바르지 않습니다.', { violations }),

  situationNotFound: (): ApiError => new ApiError(404, 'SOP-404-001', '상황을 찾을 수 없습니다.'),

  // SOP 생성 Job의 404는 여기서 만들지 않는다. 스트림·취소가 공용
  // `JobSseService`/`TocJobService`를 거치므로 실제로 나가는 코드는
  // `JOB-404-001`이다(계약도 그렇게 적었다). 여기에 `SOP-404-002`를 두면
  // "정의는 있는데 아무도 던지지 않는 코드"가 되고, 계약 게이트가 정의만 보고
  // 통과시킨다 — 실제로 그렇게 통과했다(CC-240 QA F4). 게다가 그 번호는 설계
  // 10에서 이미 UNE-SOP-012의 것이다.

  /**
   * 확정된 판이 없거나 SOP를 만들 수 있는 상태가 아니다.
   *
   * 412다 — 요청이 잘못된 것이 아니라 선행 상태가 아직 아니다(CC-200
   * `SIT-412-001`, CC-230 `EVID-412-001`과 같은 축).
   */
  notStartable: (status: string): ApiError =>
    new ApiError(412, 'SOP-412-001', `현재 상태(${status})에서는 SOP를 생성할 수 없습니다.`, {
      userAction: '상황 정보를 확정한 뒤 다시 시도하십시오.',
    }),

  /** 근거집합이 이 상황의 것이 아니거나 아직 동결되지 않았다. */
  evidenceNotFrozen: (): ApiError =>
    new ApiError(422, 'UNI-422-003', '동결된 EvidenceSet이 있어야 SOP를 생성할 수 있습니다.', {
      userAction: '근거를 고정한 뒤 다시 시도하십시오.',
    }),

  /**
   * 낡은 판으로 생성하려 한다.
   *
   * SOP는 확정 사실 위에서 만들어지고 그 결과가 버전으로 굳는다. 낡은 판으로
   * 만들면 어긋남이 그대로 남는다(CC-230 `EVID-409-002`와 같은 축).
   */
  snapshotNotCurrent: (currentSnapshotId: string): ApiError =>
    new ApiError(409, 'SOP-409-002', '최신 상황 판이 아닙니다.', {
      recoverable: true,
      userAction: `최신 판(${currentSnapshotId})으로 다시 생성하십시오.`,
    }),

  /**
   * 이미 이 상황의 SOP 생성 Job이 돌고 있다.
   *
   * 두 개가 동시에 끝나면 같은 근거에서 나온 버전이 둘 생긴다 — 어느 쪽이
   * "그 상황의 절차"인지 말할 수 없게 된다(TOC 잡의 활성 잡 가드와 같은 이유).
   */
  jobInProgress: (jobId: string): ApiError =>
    new ApiError(409, 'SOP-409-001', '이미 진행 중인 SOP 생성 Job이 있습니다.', {
      recoverable: true,
      userAction: `진행 중인 Job(${jobId})을 기다리거나 취소하십시오.`,
    }),
};
