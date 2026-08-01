import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../common/api-error';
import type { AuditRepository } from '../common/audit.repository';
import { IS_PUBLIC, REQUIRED_PERMISSION } from '../common/decorators';
import type { ApiConfig } from '../config/api-config';
import type { DatabaseService } from '../db/database.service';
import type { AuthRepository } from './auth.repository';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { signAccessToken } from './tokens';

const SECRET = 'unit-test-secret-unit-test-secret!!';

const config = { authMode: 'mock', jwtSecret: SECRET } as ApiConfig;

function contextFor(
  req: Record<string, unknown>,
  metadata: Record<string, unknown> = {},
): ExecutionContext {
  return {
    getHandler: () => metadata,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function reflectorFor(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;
}

describe('JwtAuthGuard', () => {
  it('lets @Public routes through without a token', () => {
    const guard = new JwtAuthGuard(reflectorFor({ [IS_PUBLIC]: true }), config);
    expect(guard.canActivate(contextFor({ headers: {} }))).toBe(true);
  });

  it('rejects a missing bearer token with AUTH-1005', () => {
    const guard = new JwtAuthGuard(reflectorFor({}), config);
    try {
      guard.canActivate(contextFor({ headers: {} }));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('AUTH-1005');
    }
  });

  it('rejects any bearer token when no signing secret is configured', () => {
    const guard = new JwtAuthGuard(reflectorFor({}), { ...config, jwtSecret: '' } as ApiConfig);
    const token = signAccessToken(
      SECRET,
      {
        userId: randomUUID(),
        tenantId: randomUUID(),
        sessionId: randomUUID(),
      },
      900,
    );
    expect(() =>
      guard.canActivate(contextFor({ headers: { authorization: `Bearer ${token}` } })),
    ).toThrowError(ApiError);
  });

  it('attaches verified claims to the request', () => {
    const guard = new JwtAuthGuard(reflectorFor({}), config);
    const claims = { userId: randomUUID(), tenantId: randomUUID(), sessionId: randomUUID() };
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${signAccessToken(SECRET, claims, 900)}` },
    };
    expect(guard.canActivate(contextFor(req))).toBe(true);
    expect(req.auth).toEqual(claims);
  });
});

describe('PermissionsGuard', () => {
  const auth = {
    userId: randomUUID(),
    tenantId: randomUUID(),
    sessionId: randomUUID(),
  };

  function guardWith(permissions: string[]): {
    guard: PermissionsGuard;
    audit: ReturnType<typeof vi.fn>;
  } {
    const audit = vi.fn().mockResolvedValue(undefined);
    const db = {
      withTenant: (_tenantId: string, fn: (c: unknown) => Promise<unknown>) => fn({}),
    } as unknown as DatabaseService;
    const repo = {
      loadPermissions: vi.fn().mockResolvedValue(permissions),
    } as unknown as AuthRepository;
    const auditRepo = { insertAudit: audit } as unknown as AuditRepository;
    return {
      guard: new PermissionsGuard(
        reflectorFor({ [REQUIRED_PERMISSION]: 'ORG_READ' }),
        db,
        repo,
        auditRepo,
      ),
      audit,
    };
  }

  it('passes routes without a permission requirement', async () => {
    const noRequirement = new PermissionsGuard(
      reflectorFor({}),
      {} as DatabaseService,
      {} as AuthRepository,
      {} as AuditRepository,
    );
    await expect(noRequirement.canActivate(contextFor({ auth }))).resolves.toBe(true);
  });

  it('allows when the DB grants the required permission', async () => {
    const { guard } = guardWith(['ORG_READ']);
    const req: Record<string, unknown> = { auth: { ...auth } };
    await expect(guard.canActivate(contextFor(req))).resolves.toBe(true);
  });

  it('denies with COM-0403 and writes an ACCESS_DENIED audit event', async () => {
    const { guard, audit } = guardWith(['USER_READ']);
    const req: Record<string, unknown> = {
      auth: { ...auth },
      correlationId: 'corr_denied',
      method: 'GET',
      originalUrl: '/api/v1/organizations/tree',
    };
    try {
      await guard.canActivate(contextFor(req));
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as ApiError).code).toBe('COM-0403');
      expect((err as ApiError).status).toBe(403);
    }
    expect(audit).toHaveBeenCalledOnce();
    const entry = audit.mock.calls[0][1] as { action: string; detail: { required: string } };
    expect(entry.action).toBe('ACCESS_DENIED');
    expect(entry.detail.required).toBe('ORG_READ');
  });

  it('treats a missing auth context as unauthenticated', async () => {
    const { guard } = guardWith(['ORG_READ']);
    await expect(guard.canActivate(contextFor({}))).rejects.toMatchObject({ code: 'AUTH-1005' });
  });
});
