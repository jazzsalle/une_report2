import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * CC-230 오류 코드 (UNE-KNOW-004~007).
 *
 * 설계 10 KNOW 표가 정한 것은 넷이다 — `UNI-422-002`(검색), `EVID-404-001`(조회),
 * `EVID-409-001`(고정), `EVID-404-002`(원문 위치). 나머지는 CC-230 신설이며
 * ADR-33 D7의 `<도메인>-<HTTP>-<일련>` 표기를 따른다.
 *
 * **던지지 않는 코드를 계약에 남기지 않는다** — CC-220에서 `UNI-503-001`이
 * 정확히 그 상태였고 KNOW 계약 게이트가 지금 그것을 막는다. 여기 정의한 것은
 * 전부 실제 호출부가 있다.
 */
export const evidenceErrors = {
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'EVID-400-001', '근거 검색 요청이 올바르지 않습니다.', { violations }),

  notFound: (): ApiError => new ApiError(404, 'EVID-404-001', 'EvidenceSet을 찾을 수 없습니다.'),

  itemNotFound: (): ApiError => new ApiError(404, 'EVID-404-002', '근거를 찾을 수 없습니다.'),

  situationNotFound: (): ApiError => new ApiError(404, 'EVID-404-003', '상황을 찾을 수 없습니다.'),

  /**
   * 확정된 판이 없다 (US-SIT-011 선행조건).
   *
   * 412다 — 요청이 잘못된 것이 아니라 **선행 상태가 아직 아니다**. CC-200이
   * `SIT-412-001`을 같은 뜻으로 쓴다.
   */
  snapshotRequired: (): ApiError =>
    new ApiError(412, 'EVID-412-001', '확정된 상황 판이 있어야 근거를 검색할 수 있습니다.', {
      userAction: '상황 정보를 확정한 뒤 다시 시도하십시오.',
    }),

  /**
   * 낡은 판으로 검색하려 한다.
   *
   * EvidenceSet은 동결되므로 낡은 판 위에서 모은 근거는 그 어긋남이 그대로
   * 굳는다 — ADR-34 D17이 확정에 건 가드와 같은 축이다.
   */
  snapshotNotCurrent: (currentSnapshotId: string): ApiError =>
    new ApiError(409, 'EVID-409-002', '최신 상황 판이 아닙니다.', {
      recoverable: true,
      userAction: `최신 판(${currentSnapshotId})으로 다시 검색하십시오.`,
    }),

  /** 이미 동결됐다 (UNE-KNOW-006). */
  alreadyFrozen: (): ApiError =>
    new ApiError(409, 'EVID-409-001', '이미 고정된 EvidenceSet입니다.', {
      recoverable: false,
      userAction: '새로 검색하여 다른 EvidenceSet을 만드십시오.',
    }),

  /** 선택된 근거가 없다 — 근거 없이 동결하면 SOP가 근거 없이 생성된다. */
  emptySelection: (): ApiError =>
    new ApiError(422, 'EVID-422-001', '선택된 근거가 없어 고정할 수 없습니다.', {
      userAction: '근거를 하나 이상 선택한 뒤 고정하십시오.',
    }),

  /**
   * UNI 검색 실패 (설계 10 UNE-KNOW-004의 주요 오류).
   *
   * 설계가 `UNI-422-002`를 적었고 그 뜻은 "검색 요청을 처리할 수 없다"이다.
   * 타임아웃·연결 실패·계약 위반을 모두 이 코드로 낸다 — 사용자가 할 수 있는
   * 행동이 같기 때문이다(다시 시도하거나 수동으로 진행, US-SIT-011 E-01).
   * 원인 구분은 `provider_result`의 원문과 감사에 남는다.
   */
  searchFailed: (detail: string): ApiError =>
    new ApiError(422, 'UNI-422-002', `근거 검색에 실패했습니다: ${detail}`, {
      recoverable: true,
      userAction: '다시 검색하거나 업로드 자료를 직접 근거로 사용하십시오.',
    }),
};
