import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC = 'une:isPublic';
export const REQUIRED_PERMISSION = 'une:requiredPermission';
export const IDEMPOTENT = 'une:idempotent';

export interface IdempotentOptions {
  /** Reject the request with 400 COM-0400 when the header is missing (ADR-23 D1). */
  required: boolean;
  /** Status code stored for replay; must match the operation's success status. */
  successStatus: number;
}

/** Route reachable without a Bearer token (PUBLIC_SSO-level endpoints). */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC, true);

/** Permission code (contract x-permission) enforced by PermissionsGuard.
 * Routes without this decorator require authentication only. */
export const RequirePermission = (code: string): CustomDecorator<string> =>
  SetMetadata(REQUIRED_PERMISSION, code);

/** Create/state-change POST protected by the Idempotency-Key replay store
 * (api_idempotency, ADR-23 D1). Enforced by IdempotencyInterceptor. */
export const Idempotent = (options: IdempotentOptions): CustomDecorator<string> =>
  SetMetadata(IDEMPOTENT, options);
