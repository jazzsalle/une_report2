export interface ErrorViolation {
  field: string;
  reason: string;
}

interface ApiErrorOptions {
  recoverable?: boolean;
  userAction?: string;
  violations?: ErrorViolation[];
  /** Extra keys merged into the response envelope's `meta` (CC-150).
   * `error` is `additionalProperties:false` in common-error.schema.json, so
   * recovery data a client needs to act on a 409 (the current revision it must
   * re-read) belongs in `meta`, which the schema leaves open. */
  meta?: Record<string, unknown>;
  /** Response headers set alongside the error body. CC-150 uses it to put the
   * authoritative ETag on a 409 so the client does not need a second GET
   * before retrying (design 10 §7.10 ALT-02 "최신 Revision/상태 제시"). */
  headers?: Record<string, string>;
}

/** Domain error carried to the common-error envelope (common-error.schema.json). */
export class ApiError extends Error {
  readonly recoverable: boolean;
  readonly userAction?: string;
  readonly violations?: ErrorViolation[];
  readonly meta?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    options: ApiErrorOptions = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.recoverable = options.recoverable ?? false;
    this.userAction = options.userAction;
    this.violations = options.violations;
    this.meta = options.meta;
    this.headers = options.headers;
  }
}

/** AUTH-1001~1006 assignments per ADR-22 D5. Messages never reveal whether
 * the tenant, the user, or the status check failed. */
export const authErrors = {
  invalidExternalToken: (): ApiError =>
    new ApiError(401, 'AUTH-1001', '외부 토큰을 검증할 수 없습니다.'),
  invalidRefreshToken: (): ApiError =>
    new ApiError(401, 'AUTH-1002', '세션 갱신에 실패했습니다. 다시 로그인하십시오.', {
      recoverable: true,
      userAction: '다시 로그인하십시오.',
    }),
  principalNotFound: (): ApiError => new ApiError(401, 'AUTH-1003', '인증에 실패했습니다.'),
  ssoNotBound: (): ApiError =>
    new ApiError(503, 'AUTH-1004', 'SSO 연계가 구성되지 않았습니다.', {
      recoverable: true,
      userAction: '관리자에게 문의하십시오.',
    }),
  unauthenticated: (): ApiError => new ApiError(401, 'AUTH-1005', '인증이 필요합니다.'),
  sessionAlreadyClosed: (): ApiError => new ApiError(409, 'AUTH-1006', '이미 종료된 세션입니다.'),
  forbidden: (): ApiError =>
    new ApiError(403, 'COM-0403', '접근 권한이 없습니다. 관리자에게 권한을 요청하십시오.'),
};
