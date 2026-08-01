import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/** IAM reads/writes. Every query runs inside DatabaseService.withTenant and
 * still carries explicit tenant predicates; child tables without tenant_id
 * (user_session, user_role, role_permission) are always reached through their
 * parent aggregate (app_user / role), per the ADR-21 compensating control. */

export interface UserRow {
  userId: string;
  tenantId: string;
  loginId: string;
  displayName: string;
  organizationId: string | null;
  tenantCode: string;
  tenantName: string;
}

export interface SessionRow {
  sessionId: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

// A SUSPENDED tenant must not authenticate (0002 CHECK: ACTIVE/SUSPENDED);
// callers additionally filter u.status so the failure reason stays opaque.
const USER_SELECT = `
  SELECT u.user_id, u.tenant_id, u.login_id, u.display_name, u.organization_id,
         t.tenant_code, t.tenant_name
  FROM app_user u
  JOIN tenant t ON t.tenant_id = u.tenant_id AND t.status = 'ACTIVE'`;

function toUserRow(row: Record<string, unknown>): UserRow {
  return {
    userId: row.user_id as string,
    tenantId: row.tenant_id as string,
    loginId: row.login_id as string,
    displayName: row.display_name as string,
    organizationId: (row.organization_id as string | null) ?? null,
    tenantCode: row.tenant_code as string,
    tenantName: row.tenant_name as string,
  };
}

@Injectable()
export class AuthRepository {
  async findActiveUserByLogin(
    client: PoolClient,
    tenantId: string,
    loginId: string,
  ): Promise<UserRow | null> {
    const result = await client.query(
      `${USER_SELECT}
       WHERE u.login_id = $1 AND u.tenant_id = $2 AND u.status = 'ACTIVE'`,
      [loginId, tenantId],
    );
    return result.rows[0] ? toUserRow(result.rows[0]) : null;
  }

  async findActiveUserById(
    client: PoolClient,
    tenantId: string,
    userId: string,
  ): Promise<UserRow | null> {
    const result = await client.query(
      `${USER_SELECT}
       WHERE u.user_id = $1 AND u.tenant_id = $2 AND u.status = 'ACTIVE'`,
      [userId, tenantId],
    );
    return result.rows[0] ? toUserRow(result.rows[0]) : null;
  }

  async touchLastLogin(client: PoolClient, tenantId: string, userId: string): Promise<void> {
    await client.query(
      `UPDATE app_user SET last_login_at = now() WHERE user_id = $1 AND tenant_id = $2`,
      [userId, tenantId],
    );
  }

  async createSession(
    client: PoolClient,
    userId: string,
    refreshHash: string,
    expiresAt: Date,
    ip?: string,
    userAgent?: string,
  ): Promise<string> {
    const result = await client.query(
      `INSERT INTO user_session (user_id, refresh_hash, expires_at, client_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING session_id`,
      [userId, refreshHash, expiresAt, ip ?? null, userAgent ?? null],
    );
    return result.rows[0].session_id as string;
  }

  async findSessionByHash(
    client: PoolClient,
    tenantId: string,
    refreshHash: string,
  ): Promise<SessionRow | null> {
    const result = await client.query(
      `SELECT s.session_id, s.user_id, s.expires_at, s.revoked_at
       FROM user_session s
       JOIN app_user u ON u.user_id = s.user_id AND u.tenant_id = $2 AND u.status = 'ACTIVE'
       JOIN tenant t ON t.tenant_id = u.tenant_id AND t.status = 'ACTIVE'
       WHERE s.refresh_hash = $1`,
      [refreshHash, tenantId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id as string,
      userId: row.user_id as string,
      expiresAt: row.expires_at as Date,
      revokedAt: (row.revoked_at as Date | null) ?? null,
    };
  }

  /** Rotation guard: the presented hash is part of the WHERE clause, so two
   * concurrent uses of the same refresh token cannot both succeed — the loser
   * re-evaluates after the winner's commit and matches zero rows (ADR-22 D5
   * rotation conflict → AUTH-1002). */
  async rotateSession(
    client: PoolClient,
    tenantId: string,
    sessionId: string,
    presentedHash: string,
    newHash: string,
    newExpiresAt: Date,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE user_session s SET refresh_hash = $2, expires_at = $3
       FROM app_user u
       WHERE s.session_id = $1 AND s.refresh_hash = $5
         AND u.user_id = s.user_id AND u.tenant_id = $4 AND u.status = 'ACTIVE'
         AND s.revoked_at IS NULL AND s.expires_at > now()
       RETURNING s.session_id`,
      [sessionId, newHash, newExpiresAt, tenantId, presentedHash],
    );
    return result.rowCount === 1;
  }

  async revokeSession(
    client: PoolClient,
    tenantId: string,
    sessionId: string,
    userId: string,
  ): Promise<'revoked' | 'already' | 'missing'> {
    const revoked = await client.query(
      `UPDATE user_session s SET revoked_at = now()
       FROM app_user u
       WHERE s.session_id = $1 AND s.user_id = $2
         AND u.user_id = s.user_id AND u.tenant_id = $3
         AND s.revoked_at IS NULL
       RETURNING s.session_id`,
      [sessionId, userId, tenantId],
    );
    if (revoked.rowCount === 1) return 'revoked';
    const existing = await client.query(
      `SELECT 1
       FROM user_session s
       JOIN app_user u ON u.user_id = s.user_id AND u.tenant_id = $3
       WHERE s.session_id = $1 AND s.user_id = $2`,
      [sessionId, userId, tenantId],
    );
    return existing.rowCount === 1 ? 'already' : 'missing';
  }

  async loadRoles(client: PoolClient, tenantId: string, userId: string): Promise<string[]> {
    const result = await client.query(
      `SELECT DISTINCT r.role_code
       FROM user_role ur
       JOIN app_user u ON u.user_id = ur.user_id AND u.tenant_id = $2 AND u.status = 'ACTIVE'
       JOIN role r ON r.role_id = ur.role_id AND (r.tenant_id = $2 OR r.tenant_id IS NULL)
       WHERE ur.user_id = $1
         AND (ur.valid_from IS NULL OR ur.valid_from <= now())
         AND (ur.valid_to IS NULL OR ur.valid_to > now())
       ORDER BY r.role_code`,
      [userId, tenantId],
    );
    return result.rows.map((row) => row.role_code as string);
  }

  async loadPermissions(client: PoolClient, tenantId: string, userId: string): Promise<string[]> {
    const result = await client.query(
      `SELECT DISTINCT p.permission_code
       FROM user_role ur
       JOIN app_user u ON u.user_id = ur.user_id AND u.tenant_id = $2 AND u.status = 'ACTIVE'
       JOIN role r ON r.role_id = ur.role_id AND (r.tenant_id = $2 OR r.tenant_id IS NULL)
       JOIN role_permission rp ON rp.role_id = r.role_id
       JOIN permission p ON p.permission_id = rp.permission_id
       WHERE ur.user_id = $1
         AND (ur.valid_from IS NULL OR ur.valid_from <= now())
         AND (ur.valid_to IS NULL OR ur.valid_to > now())
       ORDER BY p.permission_code`,
      [userId, tenantId],
    );
    return result.rows.map((row) => row.permission_code as string);
  }
}
