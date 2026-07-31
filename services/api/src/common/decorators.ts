import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const IS_PUBLIC = 'une:isPublic';
export const REQUIRED_PERMISSION = 'une:requiredPermission';

/** Route reachable without a Bearer token (PUBLIC_SSO-level endpoints). */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC, true);

/** Permission code (contract x-permission) enforced by PermissionsGuard.
 * Routes without this decorator require authentication only. */
export const RequirePermission = (code: string): CustomDecorator<string> =>
  SetMetadata(REQUIRED_PERMISSION, code);
