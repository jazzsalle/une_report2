import type { Response } from 'express';
import { ApiError, type ErrorViolation } from '../common/api-error';

/**
 * DOC-* 오류 어휘와 ETag 관용구 (CC-150).
 *
 * 코드는 설계 10 §3.4의 UNE-DOC-005~009 표가 정본이다. 설계 07의
 * `DAI-1401/1402`(SelectionResolver)는 우선순위 하위 문서(01 MASTER) 계열이며,
 * 같은 사실을 두 어휘로 내보내면 클라이언트가 어느 쪽으로 분기할지 정할 수 없다.
 * HTTP 표면에서는 **DOC-*가 정본**이고, 엔진의 selection 실패는 DOC-422-004의
 * violations로 옮겨 실린다.
 *
 * ETag 관용구는 plan.controller.ts와 동일하다(새로 발명하지 않는다):
 * 강한 태그 `"3"`, 부재 428 COM-0428, 형식 오류 400 COM-0400.
 * 다른 점은 값의 출처 하나뿐이다 — 계획서는 `plan.version_no`,
 * 문서는 `document_revision.revision_no`.
 */

export interface ConflictState {
  currentRevisionId: string;
  currentRevisionNo: number;
  headIrHash: string;
}

/** 409 본문의 복구 정보. `error`는 common-error.schema.json에서
 * `additionalProperties:false`이므로 손대지 않고, 열려 있는 `meta`에 싣는다. */
function conflictOptions(
  state: ConflictState,
  userAction: string,
): {
  recoverable: true;
  userAction: string;
  meta: Record<string, unknown>;
  headers: Record<string, string>;
} {
  return {
    recoverable: true,
    userAction,
    meta: { conflict: { ...state } },
    // 클라이언트가 재시도 전에 GET을 한 번 더 하지 않아도 되도록 권위 있는
    // ETag를 오류 응답에 함께 싣는다(설계 10 §7.10 ALT-02).
    headers: { ETag: `"${state.currentRevisionNo}"` },
  };
}

export const documentErrors = {
  /** IR/Revision을 찾을 수 없음. */
  revisionNotFound: (): ApiError =>
    new ApiError(404, 'DOC-404-001', '문서 IR 또는 Revision을 찾을 수 없습니다.'),
  /** 문서 자체가 없음(다른 테넌트의 문서도 여기로 수렴한다 — 존재 여부를 흘리지 않는다). */
  documentNotFound: (): ApiError => new ApiError(404, 'DOC-404-002', '문서를 찾을 수 없습니다.'),

  invalidRequest: (violations: ErrorViolation[]): ApiError =>
    new ApiError(400, 'COM-0400', '문서 편집 요청이 올바르지 않습니다.', { violations }),

  ifMatchRequired: (): ApiError =>
    new ApiError(428, 'COM-0428', 'If-Match 헤더가 필요합니다.', {
      userAction: '현재 Revision을 조회하여 ETag 값을 If-Match로 제시하십시오.',
    }),
  ifMatchMalformed: (): ApiError =>
    new ApiError(400, 'COM-0400', 'If-Match 헤더가 올바르지 않습니다.', {
      violations: [{ field: 'If-Match', reason: '강한 ETag(리비전 번호 "3" 형식)만 허용됩니다.' }],
    }),

  changeSetConflict: (state: ConflictState): ApiError =>
    new ApiError(
      409,
      'DOC-409-001',
      '문서가 다른 사용자에 의해 변경되었습니다.',
      conflictOptions(
        state,
        `최신 Revision(${state.currentRevisionNo})을 다시 조회한 뒤 편집을 재적용하십시오.`,
      ),
    ),
  restoreConflict: (state: ConflictState): ApiError =>
    new ApiError(
      409,
      'DOC-409-002',
      '복원 기준 Revision이 최신이 아닙니다.',
      conflictOptions(state, `최신 Revision(${state.currentRevisionNo})을 확인한 뒤 복원하십시오.`),
    ),
  autosaveConflict: (state: ConflictState): ApiError =>
    new ApiError(
      409,
      'DOC-409-003',
      '자동저장 기준 Revision이 최신이 아닙니다.',
      conflictOptions(state, '최신본과 로컬 변경을 비교한 뒤 다시 저장하십시오.'),
    ),

  /** 멱등키 재사용(같은 clientMutationId, 다른 내용). 새 DOC-* 코드를 만들지 않고
   * 공통 멱등 충돌 코드를 쓴다 — IdempotencyInterceptor가 헤더 경로에서 내는 것과
   * 같은 사실이므로 클라이언트 분기가 하나로 유지된다. */
  mutationIdReused: (): ApiError =>
    new ApiError(409, 'COM-0409', '동일한 clientMutationId가 다른 요청 내용으로 사용되었습니다.', {
      userAction: '새 clientMutationId로 다시 요청하십시오.',
    }),

  /** selection 해결 불가 · 잠금/정적영역 침범 · 연산 무효. */
  unprocessable: (violations: ErrorViolation[]): ApiError =>
    new ApiError(422, 'DOC-422-004', '변경을 적용할 수 없습니다.', {
      violations,
      recoverable: true,
      userAction: '표시된 노드의 상태를 확인하고 선택영역을 다시 잡으십시오.',
    }),
};

/** If-Match는 `document_revision.revision_no`를 강한 엔티티 태그로 나른다: `"3"`.
 * 약한 태그(`W/"3"`)는 거부한다 — RFC 7232는 If-Match에 강한 비교만 허용한다. */
export function parseIfMatch(header: string | undefined): number {
  if (!header || !header.trim()) throw documentErrors.ifMatchRequired();
  const match = /^\s*"?(\d+)"?\s*$/.exec(header);
  if (!match) throw documentErrors.ifMatchMalformed();
  return Number(match[1]);
}

export function setEtag(res: Response, revisionNo: number): void {
  res.setHeader('ETag', `"${revisionNo}"`);
}
