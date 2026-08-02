import type { TocTreeIssue } from '@une/domain';
import { ApiError } from '../common/api-error';

/** UNE-PLAN-009 ~ UNE-PLAN-015 error catalogue (contract x-error-codes).
 * Trash / approval-lock preconditions are NOT here: they reuse
 * planErrors.preconditionFailed (PLAN-412-002) from plan.service.ts so a
 * single state-precondition code stays authoritative (ADR-23 D5).
 * T3Q-502-001 is likewise absent — the provider failure is recorded by the
 * worker on the job (job.failed / error_json), never thrown by this API. */

export const jobErrors = {
  notFound: (): ApiError => new ApiError(404, 'JOB-404-001', 'Job을 찾을 수 없습니다.'),
  /** UNE-PLAN-012: already settled, or a cancel is already in flight. */
  cancelNotAllowed: (status: string): ApiError =>
    new ApiError(409, 'JOB-409-001', `취소할 수 없는 상태의 Job입니다(현재 상태: ${status}).`),
  /** UNE-PLAN-013: only FAILED is retriable (generation-job.ts TRANSITIONS). */
  retryNotAllowed: (status: string): ApiError =>
    new ApiError(409, 'JOB-409-002', `재시도할 수 없는 상태의 Job입니다(현재 상태: ${status}).`),
};

export const tocErrors = {
  /** PLAN-409-002. Recoverable: the caller can wait for or cancel the running
   * job. Job-type agnostic since CC-130 (ADR-27 D9). The common-error
   * envelope has no free-form `detail`, so the existing job id is carried in
   * userAction (violations is for request fields only). */
  activeJobExists: (jobId: string): ApiError =>
    new ApiError(409, 'PLAN-409-002', '이미 진행 중인 생성 Job이 있습니다.', {
      recoverable: true,
      userAction: `진행 중인 Job(${jobId})이 끝나기를 기다리거나 해당 Job을 취소한 뒤 다시 시도하십시오.`,
    }),
  /** PLAN-412-001 keeps its design 8.3 meaning ("기준정보 Snapshot 미확정");
   * CC-110 reserved the code and routed state preconditions to PLAN-412-002. */
  snapshotRequired: (): ApiError =>
    new ApiError(412, 'PLAN-412-001', '기준정보 Snapshot 확정이 필요합니다.', {
      userAction: '기준정보를 확정한 뒤 다시 시도하십시오.',
    }),
  versionNotFound: (): ApiError =>
    new ApiError(404, 'TOC-404-001', '목차 버전을 찾을 수 없습니다.'),
  /** TOC-409-001. baseVersionId no longer matches plan.current_toc_version_id
   * (another user saved or a job finished in between). */
  versionConflict: (currentVersionId: string | null): ApiError =>
    new ApiError(409, 'TOC-409-001', '목차가 다른 사용자에 의해 변경되었습니다.', {
      recoverable: true,
      userAction: currentVersionId
        ? `최신 목차 버전(${currentVersionId})을 다시 조회한 뒤 저장하십시오.`
        : '현재 계획서에 확정된 목차 버전이 없습니다. 계획서를 다시 조회하십시오.',
    }),
  /** PLAN-422-002. TocTreeIssue.path is the client-side anchor (field) and
   * TocTreeIssue.code the machine-readable reason (설계 §7.9 ALT-05). */
  treeInvalid: (issues: readonly TocTreeIssue[]): ApiError =>
    new ApiError(422, 'PLAN-422-002', '목차 구조가 유효하지 않습니다.', {
      violations: issues.map((issue) => ({ field: issue.path, reason: issue.code })),
    }),
  /** COM-0409. Defensive backstop (review M2): the 2nd-net unique fallback
   * found a job whose aggregate/type does not match this request — a hash
   * scope bug, never something to silently return. */
  idempotencyScopeMismatch: (): ApiError =>
    new ApiError(409, 'COM-0409', '멱등키가 다른 대상의 작업과 충돌했습니다.', {
      userAction: '새 Idempotency-Key로 다시 요청하십시오.',
    }),
  /** PLAN-422-002 (CC-130): protectedBlockIds referenced blocks that are not
   * current blocks of this plan — protection must never silently no-op. */
  protectedBlockUnknown: (unknownIds: readonly string[]): ApiError =>
    new ApiError(422, 'PLAN-422-002', '보호 대상 블록을 찾을 수 없습니다.', {
      violations: unknownIds.map((id) => ({
        field: 'protectedBlockIds',
        reason: `현재 블록이 아닙니다: ${id}`,
      })),
    }),
  /** PLAN-422-002 (CC-130, review M-3/F1): targetNodeKeys that are missing
   * from the confirmed TOC version. 422 (semantic) — format errors stay a
   * controller-level 400, matching the contract split. */
  targetNodeUnknown: (missing: readonly string[]): ApiError =>
    new ApiError(422, 'PLAN-422-002', '대상 노드를 목차에서 찾을 수 없습니다.', {
      violations: missing.map((key) => ({
        field: 'targetNodeKeys',
        reason: `목차에 없는 노드입니다: ${key}`,
      })),
    }),
};
