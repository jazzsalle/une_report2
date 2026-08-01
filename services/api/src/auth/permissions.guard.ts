import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authErrors } from '../common/api-error';
import { AuditRepository } from '../common/audit.repository';
import { REQUIRED_PERMISSION } from '../common/decorators';
import type { ApiRequest } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { AuthRepository } from './auth.repository';

/** Global guard after JwtAuthGuard: enforces the route's x-permission code
 * from the DB (role → role_permission → permission, validity window applied).
 * The screen may hide a button, but the backend re-verifies (design 09 §3.2). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuthRepository) private readonly repo: AuthRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<ApiRequest>();
    const auth = req.auth;
    if (!auth) throw authErrors.unauthenticated();

    auth.permissions ??= await this.db.withTenant(auth.tenantId, (c) =>
      this.repo.loadPermissions(c, auth.tenantId, auth.userId),
    );
    if (!auth.permissions.includes(required)) {
      await this.auditDenied(req, required);
      throw authErrors.forbidden();
    }
    return true;
  }

  /** ACCESS_DENIED audit (design 09 §3.3); best-effort so audit failures
   * cannot turn a 403 into a 500. */
  private async auditDenied(req: ApiRequest, required: string): Promise<void> {
    const auth = req.auth;
    if (!auth) return;
    try {
      await this.db.withTenant(auth.tenantId, (c) =>
        this.audit.insertAudit(c, {
          tenantId: auth.tenantId,
          actorId: auth.userId,
          action: 'ACCESS_DENIED',
          resourceType: 'API',
          correlationId: req.correlationId,
          // Path only — query strings can carry personal data (e.g. user
          // search keywords) that must not land in the audit log.
          detail: { required, method: req.method, path: req.originalUrl.split('?')[0] },
        }),
      );
    } catch (err) {
      console.warn(
        `[une-api] audit write skipped (ACCESS_DENIED): ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
