import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * CC-300 오류 코드 (UNE-JNL-005~011).
 *
 * 설계 10 JNL 표가 정한 번호를 쓴다: `JOURNAL-412-001`(투영 선행조건),
 * `JOURNAL-404-001`, `JOURNAL-422-004`(AI 제안), `JOURNAL-409-001`(편집 충돌),
 * `JOURNAL-412-002`(검토요청), `JOURNAL-412-003`(승인), `EXPORT-422-002`.
 *
 * 편집·Export는 **기존 경로에 위임한다**(CC-150 ChangeSet, CC-160 Export).
 * 그쪽이 던지는 코드는 여기서 다시 만들지 않는다 — 같은 실패에 두 이름이
 * 붙으면 클라이언트가 분기할 수 없다.
 *
 * 앞선 항목들과 같은 규칙: **던지지 않는 코드는 계약에 남기지 않는다.**
 */
export const journalErrors = {
  situationNotFound: (): ApiError => new ApiError(404, 'SIT-404-001', '상황을 찾을 수 없습니다.'),

  notFound: (): ApiError => new ApiError(404, 'JOURNAL-404-001', '상황일지를 찾을 수 없습니다.'),

  /**
   * 확정된 상황 판이 없거나 지정한 판이 그 상황의 것이 아니다.
   *
   * **일지의 사실칸은 확정된 판에서만 온다.** 미확정 후보로 일지를 만들면
   * 사람이 그것을 확정된 사실로 읽는다.
   */
  snapshotRequired: (): ApiError =>
    new ApiError(412, 'JOURNAL-412-001', '확정된 상황 판이 필요합니다.', {
      recoverable: true,
      userAction: '상황 판을 확정한 뒤 일지를 만드십시오.',
    }),

  invalidPeriod: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'JOURNAL-422-001', '상황일지 생성 요청을 확인하십시오.', {
      recoverable: true,
      violations,
    }),

  /** 초안·반려 상태에서만 고칠 수 있다. */
  notEditable: (status: string): ApiError =>
    new ApiError(409, 'JOURNAL-409-001', `현재 상태(${status})에서는 편집할 수 없습니다.`, {
      recoverable: true,
      userAction: '검토 중이면 반려를 기다리고, 승인된 일지는 새로 만드십시오.',
    }),

  cannotSubmitReview: (status: string): ApiError =>
    new ApiError(412, 'JOURNAL-412-002', `현재 상태(${status})에서는 검토를 요청할 수 없습니다.`),

  cannotDecide: (status: string): ApiError =>
    new ApiError(412, 'JOURNAL-412-003', `현재 상태(${status})에서는 승인·반려할 수 없습니다.`),

  /**
   * 검토받은 판이 아니다.
   *
   * 검토요청 뒤에 편집이 있었으면 승인자가 본 것과 승인되는 것이 다르다.
   */
  revisionMoved: (reviewedRevisionId: string | null): ApiError =>
    new ApiError(409, 'JOURNAL-409-002', '보고 있던 판이 아닙니다.', {
      recoverable: true,
      userAction: `현재 판(${reviewedRevisionId ?? '없음'})을 다시 읽은 뒤 저장하십시오.`,
    }),

  /**
   * 사실칸·서술칸에 대응하는 문단이 문서에 없다 (이중검토 C-1).
   *
   * 되쓸 자리가 없으면 그 절은 **종이에 나가지 않는다.** 조용히 넘어가면
   * 화면에는 있고 문서에는 없는 절이 생기고, 그것을 승인하게 된다.
   */
  documentOutOfSync: (paragraphIds: string[]): ApiError =>
    new ApiError(409, 'JOURNAL-409-003', '문서와 사실칸이 어긋났습니다.', {
      violations: paragraphIds.map((id) => ({
        field: id,
        reason: '문서에서 해당 문단을 찾지 못했습니다.',
      })),
      userAction: '일지를 다시 만들어야 합니다.',
    }),

  /**
   * AI 제안이 사실을 건드리거나 반박한다 (UNE-JNL-007).
   *
   * **AI에게는 fail-closed다.** 사람의 편집에는 경고만 달지만 제안은 거절한다 —
   * 거절 비용은 "운영자가 그 문장을 직접 쓴다"뿐이고, 통과 비용은 틀린 숫자가
   * 승인된 일지에 남는 것이다.
   */
  proposalRejected: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'JOURNAL-422-004', 'AI 제안이 사실과 어긋납니다.', {
      recoverable: true,
      userAction: '사실칸을 확인하고 서술을 직접 쓰거나 다시 제안받으십시오.',
      violations,
    }),

  /** 잠긴 사실칸을 바꾸려 했다. */
  factLocked: (fields: string[]): ApiError =>
    new ApiError(422, 'JOURNAL-422-005', '사실칸은 편집할 수 없습니다.', {
      violations: fields.map((f) => ({
        field: f,
        reason: '투영된 사실이라 서술 편집으로 바꿀 수 없습니다.',
      })),
      userAction: '사실이 틀렸다면 원 도메인에서 정정 이벤트를 남기십시오(UNE-JNL-004).',
    }),

  /** 없는 섹션에 제안·편집을 걸었다. */
  sectionNotFound: (sectionKey: string): ApiError =>
    new ApiError(422, 'JOURNAL-422-006', `없는 섹션입니다: ${sectionKey}`),

  /**
   * 양식을 일지의 몸으로 쓸 수 없다 — 절이 하나도 없거나 IR을 읽을 수 없다.
   *
   * 반입 게이트(UNE-DOC-003)가 REJECT를 먼저 거르지만, 통과한 패키지가
   * 비어 있을 수는 있다. 그 위에 부기하면 절 구분이 없는 문서가 나온다.
   * 설계 06 US-SIT-030 E-02 "템플릿 REJECT → 다른 양식 선택"과 같은 처지다.
   */
  templateUnusable: (): ApiError =>
    new ApiError(422, 'JOURNAL-422-007', '이 양식으로는 상황일지를 만들 수 없습니다.', {
      violations: [
        { field: 'templateFileId', reason: '양식에 본문 절이 없습니다. 다른 양식을 선택하십시오.' },
      ],
    }),

  /**
   * 낡은 채로 검토에 넣지 않는다 (UNE-JNL-009).
   *
   * 검토 중에는 사실 갱신이 막힌다(초안·반려에서만 편집). 낡은 채 들어가면
   * 반려하고 되돌아오는 것 말고 길이 없으므로, 들어가기 전에 막는다.
   */
  driftedForReview: (): ApiError =>
    new ApiError(412, 'JOURNAL-412-002', '만든 뒤 사실이 바뀌었습니다.', {
      recoverable: true,
      userAction: '사실을 갱신한 뒤 검토를 요청하십시오. 사람이 쓴 문장은 그대로 남습니다.',
    }),

  /** 승인 전에는 내보내지 않는다 (설계 06 US-SIT-034 3~4단계). */
  exportBeforeApproval: (status: string): ApiError =>
    new ApiError(
      412,
      'JOURNAL-412-004',
      `승인되지 않은 상황일지(${status})는 내보낼 수 없습니다.`,
      { userAction: '검토·승인을 먼저 마치십시오.' },
    ),

  /** 설계 10 UNE-JNL-011 `EXPORT-422-002`. */
  exportRejected: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'EXPORT-422-002', '상황일지를 내보낼 수 없습니다.', {
      recoverable: true,
      violations,
    }),
};
