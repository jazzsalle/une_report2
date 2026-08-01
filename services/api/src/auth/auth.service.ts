import { Inject, Injectable } from '@nestjs/common';
import { authErrors } from '../common/api-error';
import { AuditRepository, type AuditEntry } from '../common/audit.repository';
import type { AuthContext } from '../common/request-context';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { DatabaseService } from '../db/database.service';
import { AuthRepository, type UserRow } from './auth.repository';
import { parseMockExternalToken } from './mock-sso';
import { hashRefreshToken, issueRefreshToken, refreshTokenTenant, signAccessToken } from './tokens';

export interface RequestMeta {
  correlationId: string;
  ip?: string;
  userAgent?: string;
}

export interface UserContext {
  userId: string;
  loginId: string;
  displayName: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  organizationId: string | null;
  roles: string[];
  permissions: string[];
}

export interface TokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userContext: UserContext;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuthRepository) private readonly repo: AuthRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
  ) {}

  /** UNE-AUTH-001. Mock issuance only under AUTH_MODE=mock (ADR-22 D3); the
   * real T3Q SSO exchange stays unbound (OB-01) and answers AUTH-1004. */
  async exchange(externalToken: unknown, meta: RequestMeta): Promise<TokenBundle> {
    if (this.config.authMode !== 'mock') throw authErrors.ssoNotBound();
    if (typeof externalToken !== 'string') throw authErrors.invalidExternalToken();
    const identity = parseMockExternalToken(externalToken);

    const user = await this.db.withTenant(identity.tenantId, (c) =>
      this.repo.findActiveUserByLogin(c, identity.tenantId, identity.loginId),
    );
    if (!user) {
      // Forged/unknown tenant or unknown user: RLS hides both the same way.
      // Audit in its own transaction so the row survives this failure.
      await this.auditSafe({
        tenantId: identity.tenantId,
        action: 'LOGIN_FAILED',
        resourceType: 'SESSION',
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { reason: 'principal_not_found' },
      });
      throw authErrors.principalNotFound();
    }

    return this.db.withTenant(user.tenantId, async (c) => {
      const refresh = issueRefreshToken(user.tenantId);
      const expiresAt = new Date(Date.now() + this.config.refreshTtlSec * 1000);
      const sessionId = await this.repo.createSession(
        c,
        user.userId,
        refresh.hash,
        expiresAt,
        meta.ip,
        meta.userAgent,
      );
      await this.repo.touchLastLogin(c, user.tenantId, user.userId);
      const roles = await this.repo.loadRoles(c, user.tenantId, user.userId);
      const permissions = await this.repo.loadPermissions(c, user.tenantId, user.userId);
      await this.audit.insertAudit(c, {
        tenantId: user.tenantId,
        actorId: user.userId,
        action: 'LOGIN',
        resourceType: 'SESSION',
        resourceId: sessionId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const accessToken = signAccessToken(
        this.config.jwtSecret,
        { userId: user.userId, tenantId: user.tenantId, sessionId },
        this.config.accessTtlSec,
      );
      return {
        accessToken,
        refreshToken: refresh.token,
        expiresIn: this.config.accessTtlSec,
        userContext: this.toUserContext(user, roles, permissions),
      };
    });
  }

  /** UNE-AUTH-002. */
  async me(auth: AuthContext): Promise<UserContext> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const user = await this.repo.findActiveUserById(c, auth.tenantId, auth.userId);
      if (!user) throw authErrors.unauthenticated();
      const roles = await this.repo.loadRoles(c, auth.tenantId, auth.userId);
      const permissions = await this.repo.loadPermissions(c, auth.tenantId, auth.userId);
      return this.toUserContext(user, roles, permissions);
    });
  }

  /** UNE-AUTH-003. The refresh token itself is the credential (ADR-22 D3);
   * rotation invalidates the presented token on every successful call. */
  async refresh(
    refreshToken: unknown,
    meta: RequestMeta,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    if (typeof refreshToken !== 'string') throw authErrors.invalidRefreshToken();
    const tenantId = refreshTokenTenant(refreshToken);
    if (!tenantId) throw authErrors.invalidRefreshToken();
    const hash = hashRefreshToken(refreshToken);

    return this.db.withTenant(tenantId, async (c) => {
      const session = await this.repo.findSessionByHash(c, tenantId, hash);
      if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
        throw authErrors.invalidRefreshToken();
      }
      const next = issueRefreshToken(tenantId);
      const rotated = await this.repo.rotateSession(
        c,
        tenantId,
        session.sessionId,
        hash,
        next.hash,
        new Date(Date.now() + this.config.refreshTtlSec * 1000),
      );
      if (!rotated) throw authErrors.invalidRefreshToken();
      await this.audit.insertAudit(c, {
        tenantId,
        actorId: session.userId,
        action: 'SESSION_REFRESHED',
        resourceType: 'SESSION',
        resourceId: session.sessionId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const accessToken = signAccessToken(
        this.config.jwtSecret,
        { userId: session.userId, tenantId, sessionId: session.sessionId },
        this.config.accessTtlSec,
      );
      return { accessToken, refreshToken: next.token, expiresIn: this.config.accessTtlSec };
    });
  }

  /** UNE-AUTH-004. Revokes the refresh session; the short-lived access token
   * stays valid until exp (ADR-22 D3). */
  async logout(auth: AuthContext, meta: RequestMeta): Promise<void> {
    await this.db.withTenant(auth.tenantId, async (c) => {
      const outcome = await this.repo.revokeSession(c, auth.tenantId, auth.sessionId, auth.userId);
      // 'missing' means the token's session does not exist in this tenant at
      // all — an authentication problem, not a session-state conflict.
      if (outcome === 'missing') throw authErrors.unauthenticated();
      if (outcome !== 'revoked') throw authErrors.sessionAlreadyClosed();
      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'LOGOUT',
        resourceType: 'SESSION',
        resourceId: auth.sessionId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /** Best-effort audit in its own transaction: a nonexistent tenant fails the
   * audit_log FK, which must not mask the original auth failure. */
  private async auditSafe(entry: AuditEntry): Promise<void> {
    try {
      await this.db.withTenant(entry.tenantId, (c) => this.audit.insertAudit(c, entry));
    } catch (err) {
      console.warn(
        `[une-api] audit write skipped (${entry.action}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private toUserContext(user: UserRow, roles: string[], permissions: string[]): UserContext {
    return {
      userId: user.userId,
      loginId: user.loginId,
      displayName: user.displayName,
      tenantId: user.tenantId,
      tenantCode: user.tenantCode,
      tenantName: user.tenantName,
      organizationId: user.organizationId,
      roles,
      permissions,
    };
  }
}
