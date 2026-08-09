import { ApiError, type ErrorViolation } from '../common/api-error';

/** CC-200 오류 코드.
 *
 * SIT-5001/5002/404-001/409-001, PROV-503-001, FACT-422-001/409-001은
 * **설계 10의 SIT 표**가 정한 값이고 계약의 `x-error-codes`와 같다.
 *
 * FACT-404-001(SIT-014)과 PROV-404-001(SIT-015)은 CC-200이 신설한 두 API의
 * 코드이므로 설계에 없다. 기존 자리표기(`<도메인>-<HTTP>-<일련>`)를 그대로
 * 따랐고 그 사실을 ADR-33 D7에 남긴다.
 *
 * **FACT-400-001 / PROV-400-001도 CC-200 신설이다(ADR-33 D17).** 처음에는
 * 400 요청형식 오류에 `FACT-422-001`과 `PROV-503-001`을 재사용했는데 둘 다
 * 설계가 다른 뜻으로 정의한 코드였다 — 설계 10 오류표의 `PROV-503-001`은
 * "상황 Provider 장애 / 부분결과·수동"이고, `FACT-422-001`은 정규화 격리
 * (D8이 사용자 검토 대상으로 정의한 상태)다. 코드만 보고 복구 안내를 만드는
 * 클라이언트가 형식 오류에 "재시도/부분결과"를 띄우게 된다. 표기 규칙을
 * 스스로 선언해 놓고 어긴 자리였다(아키텍처 리뷰 M-4).
 *
 * 412/428은 도메인 코드를 새로 만들지 않고 공통 코드를 쓴다 — CC-110이
 * COM-0428을 그렇게 정했고, 상태 선행조건은 SIT-412-001로 따로 둔다.
 */
export const situationErrors = {
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'SIT-5001', '상황 요청이 올바르지 않습니다.', { violations }),
  invalidQuery: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'SIT-5002', '상황 목록 조건이 올바르지 않습니다.', { violations }),
  /** SIT-014는 상황 목록이 아니라 Fact 목록이다. `SIT-5002`("상황 목록 조건")를
   * 쓰면 코드가 가리키는 대상이 틀린다(QA 리뷰 R-6). */
  invalidFactQuery: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'FACT-400-001', '후보 Fact 목록 조건이 올바르지 않습니다.', { violations }),
  notFound: (): ApiError => new ApiError(404, 'SIT-404-001', '상황을 찾을 수 없습니다.'),
  versionConflict: (currentVersion: number): ApiError =>
    new ApiError(409, 'SIT-409-001', '상황이 다른 사용자에 의해 변경되었습니다.', {
      recoverable: true,
      userAction: `최신 버전(${currentVersion})을 다시 조회한 뒤 수정하십시오.`,
    }),
  /** 종결된 상황은 제자리에서 고치지 않는다(설계 06 §7.1: CLOSED 후 정정은
   * CorrectionEvent와 새 revision). */
  closed: (status: string): ApiError =>
    new ApiError(412, 'SIT-412-001', `종결된 상황(${status})은 수정할 수 없습니다.`, {
      userAction: '정정이 필요하면 정정 이벤트와 새 보고 판을 사용하십시오.',
    }),
  ifMatchRequired: (): ApiError =>
    new ApiError(428, 'COM-0428', 'If-Match 헤더가 필요합니다.', {
      userAction: '현재 버전을 조회하여 If-Match로 제시하십시오.',
    }),
};

export const factErrors = {
  /** 정규화가 후보를 격리한 경우(설계 06 US-SIT-006 E-01/E-02). */
  invalid: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'FACT-422-001', 'Fact가 표준 형태를 만족하지 않습니다.', { violations }),
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'FACT-400-001', 'Fact 요청이 올바르지 않습니다.', { violations }),
  notFound: (): ApiError => new ApiError(404, 'FACT-404-001', 'Fact를 찾을 수 없습니다.'),
  versionConflict: (currentVersion: number): ApiError =>
    new ApiError(409, 'FACT-409-001', 'Fact가 다른 사용자에 의해 변경되었습니다.', {
      recoverable: true,
      userAction: `최신 버전(${currentVersion})을 다시 조회한 뒤 보정하십시오.`,
    }),
  /** 확정·거부된 Fact는 보정하지 않는다. 확정 이후의 정정은 새 판이지
   * 제자리 수정이 아니다(원천 Fact 불변 — 설계 06 §7.1 주요 데이터). */
  notCandidate: (status: string): ApiError =>
    new ApiError(412, 'FACT-412-001', `후보가 아닌 Fact(${status})는 보정할 수 없습니다.`),
};

/** CC-210. 설계 10 SIT 표가 정한 코드를 그대로 쓴다 —
 * FACT-404-002(충돌 목록), SIT-412-003(미해결 충돌), SIT-422-006(출처 없는
 * Fact), SIT-404-003(Snapshot). 400 형식 오류는 CC-200이 세운 표기를 따른다. */
export const conflictErrors = {
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'FACT-400-002', '충돌 요청이 올바르지 않습니다.', { violations }),
  situationNotFound: (): ApiError => new ApiError(404, 'FACT-404-002', '상황을 찾을 수 없습니다.'),
  notFound: (): ApiError => new ApiError(404, 'FACT-404-002', '충돌을 찾을 수 없습니다.'),
  /** 설계 06 US-SIT-007 E-02(다른 사용자가 선결정) — 재조회 후 다시 판단한다.
   * 해소는 불변이므로(0025 §5) 덮어쓰기가 아니라 충돌이다. */
  alreadyResolved: (): ApiError =>
    new ApiError(409, 'FACT-409-002', '이미 해소된 충돌입니다.', {
      recoverable: true,
      userAction: '최신 상태를 다시 조회한 뒤 판단하십시오.',
    }),
  selectionNotCandidate: (): ApiError =>
    new ApiError(422, 'FACT-422-002', '이 충돌의 후보가 아닌 Fact는 선택할 수 없습니다.', {
      userAction: '충돌 후보 중에서 선택하거나, 새 사실이라면 Fact로 등록하십시오.',
    }),
};

export const snapshotErrors = {
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'SIT-400-003', 'Snapshot 요청이 올바르지 않습니다.', { violations }),
  notFound: (): ApiError => new ApiError(404, 'SIT-404-003', 'Snapshot을 찾을 수 없습니다.'),
  /** 인수기준 "unresolved conflict block". 설계 10의 SIT-412-003이다. */
  blocked: (violations: ErrorViolation[]): ApiError =>
    new ApiError(412, 'SIT-412-003', '확정 선행조건을 만족하지 않습니다.', {
      violations,
      userAction: '충돌을 해소하고 확정 대상을 다시 고르십시오.',
    }),
  /** 확정 기준이 최신이 아니다 — 설계 06 US-SIT-008 E-01의 REVISION_CONFLICT.
   * 요청이 말한 직전 판과 지금의 현재 판이 다르면, 요청자는 그 사이의 확정을
   * 보지 못한 것이다. */
  staleBaseline: (currentSnapshotId: string | null): ApiError =>
    new ApiError(409, 'SIT-409-004', '확정 기준이 최신이 아닙니다.', {
      recoverable: true,
      userAction:
        currentSnapshotId === null
          ? '아직 확정된 판이 없습니다. 최신 상태를 다시 조회한 뒤 확정하십시오.'
          : `그 사이에 다른 확정(${currentSnapshotId})이 있었습니다. 최신 판을 검토한 뒤 다시 확정하십시오.`,
    }),
  /** 확정 도중 대상 Fact가 다른 요청에 의해 바뀌었다(아키텍처 리뷰 M-6). */
  raced: (): ApiError =>
    new ApiError(409, 'SIT-409-003', '확정 대상이 처리 중에 변경되었습니다.', {
      recoverable: true,
      userAction: '최신 후보 목록을 다시 조회한 뒤 확정하십시오.',
    }),
  /** 설계 10 오류표 SIT-422-006 "출처 없는 Fact / 출처 등록". */
  factWithoutSource: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'SIT-422-006', '출처가 없는 Fact는 확정할 수 없습니다.', { violations }),
};

export const providerErrors = {
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'PROV-400-001', 'Provider 조회 요청이 올바르지 않습니다.', { violations }),
  jobNotFound: (): ApiError =>
    new ApiError(404, 'PROV-404-001', 'Provider 수집 Job을 찾을 수 없습니다.'),
};
