import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * CC-220 오류 코드.
 *
 * 설계 10 KNOW 표가 정한 것은 세 개뿐이다 — `KNOW-422-001`(UNE-KNOW-001),
 * `UNI-503-001`(UNE-KNOW-002), `UNI-409-001`(UNE-KNOW-003).
 *
 * 나머지는 CC-220 신설이며 ADR-33 D7이 정본화한 `<도메인>-<HTTP>-<일련>` 표기를
 * 따른다. **설계가 다른 뜻으로 정의한 코드를 재사용하지 않는다** — ADR-33 D17이
 * 바로 그 실수를 고친 자리다. 코드만 보고 복구 안내를 만드는 클라이언트가
 * 형식 오류에 "재시도"를 띄우면 안 된다.
 *
 * `KNOW-422-001`의 뜻은 설계상 "자료 등록 거부"이므로 파일 검사 실패
 * (US-SIT-009 E-01)가 그 자리다. 요청 형식 오류는 `KNOW-400-001`로 가른다.
 *
 * **설계 10이 UNE-KNOW-002에 적은 `UNI-503-001`을 쓰지 않는다.** 그 API는
 * 저장된 관측값을 돌려줄 뿐 UNI를 호출하지 않으므로(ADR-36 D2) 503을 낼
 * 경로가 없다. 던지지 않는 코드를 계약에 남기면 그 목록이 검증 가능한 사실이
 * 아니게 된다 — ADR-33 D17이 `PROV-503-001`에서 내린 결론과 같다.
 */
export const knowledgeErrors = {
  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'KNOW-400-001', '지식문서 등록 요청이 올바르지 않습니다.', { violations }),

  notFound: (): ApiError => new ApiError(404, 'KNOW-404-001', '지식문서를 찾을 수 없습니다.'),

  fileNotFound: (): ApiError =>
    new ApiError(404, 'KNOW-404-002', '업로드된 파일을 찾을 수 없습니다.', {
      userAction: '파일을 먼저 업로드하고 검증을 완료하십시오.',
    }),

  /**
   * 파일 검사 거부 (US-SIT-009 E-01 UPLOAD_REJECTED).
   *
   * 사유를 그대로 노출한다 — 사용자는 "왜 거부됐는지"를 알아야 다음 행동을
   * 고를 수 있고(다른 파일/재검사/관리자 문의), 그 사유는 개인정보가 아니다.
   */
  fileRejected: (reason: string, userAction: string): ApiError =>
    new ApiError(422, 'KNOW-422-001', `자료를 등록할 수 없습니다: ${reason}`, {
      userAction,
    }),

  /**
   * 기관 KB 승격은 등록으로 할 수 없다 (US-SIT-009 5단계 "기관 KB 자동승격 금지",
   * A-02는 별도 승인 워크플로).
   */
  scopeNotSelectable: (): ApiError =>
    new ApiError(422, 'KNOW-422-002', '기관 KB 보존범위는 등록 시점에 지정할 수 없습니다.', {
      userAction: '사건 범위로 등록한 뒤 기관 KB 승격 승인을 요청하십시오.',
    }),

  /**
   * 중복 해시 (US-SIT-009 A-01).
   *
   * 오류가 아니라 **선택 지점**이다. 기존 문서를 재사용할지 강제 업로드할지는
   * 사용자가 정한다 — 그래서 409로 되돌리고 기존 문서를 함께 알려준다.
   */
  duplicateSource: (existingId: string): ApiError =>
    new ApiError(409, 'KNOW-409-001', '같은 내용의 자료가 이미 등록되어 있습니다.', {
      recoverable: true,
      userAction: `기존 자료(${existingId})를 사용하거나 force=true로 다시 등록하십시오.`,
    }),

  /** 재시도할 수 없는 상태 (설계 10 UNE-KNOW-003의 주요 오류). */
  retryNotAllowed: (reason: string, userAction: string): ApiError =>
    new ApiError(409, 'UNI-409-001', `학습을 재시도할 수 없습니다: ${reason}`, {
      recoverable: false,
      userAction,
    }),
};
