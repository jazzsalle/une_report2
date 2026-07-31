import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

export interface OrgRow {
  organizationId: string;
  parentId: string | null;
  orgCode: string;
  orgName: string;
  orgPath: string;
  sortOrder: number;
  status: string;
}

export interface UserSummaryRow {
  userId: string;
  loginId: string;
  displayName: string;
  organizationId: string | null;
  orgName: string | null;
  status: string;
}

export interface RoleRow {
  roleId: string;
  roleCode: string;
  roleName: string;
  scopeType: string;
  isSystem: boolean;
  tenantId: string | null;
  permissions: string[];
}

export interface UserSearchQuery {
  orgId?: string;
  keyword?: string;
  status?: string;
  page: number;
  size: number;
}

/** Escapes LIKE metacharacters so a keyword is always a literal match. */
function likePattern(keyword: string): string {
  return `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
}

@Injectable()
export class IamRepository {
  async orgRows(client: PoolClient, tenantId: string): Promise<OrgRow[]> {
    const result = await client.query(
      `SELECT organization_id, parent_id, org_code, org_name, org_path, sort_order, status
       FROM organization
       WHERE tenant_id = $1
       ORDER BY org_path, sort_order, org_code`,
      [tenantId],
    );
    return result.rows.map((row) => ({
      organizationId: row.organization_id as string,
      parentId: (row.parent_id as string | null) ?? null,
      orgCode: row.org_code as string,
      orgName: row.org_name as string,
      orgPath: row.org_path as string,
      sortOrder: row.sort_order as number,
      status: row.status as string,
    }));
  }

  /** PII minimization: encrypted email/phone columns are never selected. */
  async searchUsers(
    client: PoolClient,
    tenantId: string,
    query: UserSearchQuery,
  ): Promise<{ items: UserSummaryRow[]; totalElements: number }> {
    const result = await client.query(
      `SELECT u.user_id, u.login_id, u.display_name, u.organization_id, u.status,
              o.org_name, count(*) OVER () AS total
       FROM app_user u
       LEFT JOIN organization o
         ON o.organization_id = u.organization_id AND o.tenant_id = $1
       WHERE u.tenant_id = $1
         AND ($2::uuid IS NULL OR u.organization_id = $2)
         AND ($3::text IS NULL OR u.display_name ILIKE $3 OR u.login_id ILIKE $3)
         AND ($4::text IS NULL OR u.status = $4)
       ORDER BY u.display_name, u.login_id
       LIMIT $5 OFFSET $6`,
      [
        tenantId,
        query.orgId ?? null,
        query.keyword ? likePattern(query.keyword) : null,
        query.status ?? null,
        query.size,
        query.page * query.size,
      ],
    );
    return {
      items: result.rows.map((row) => ({
        userId: row.user_id as string,
        loginId: row.login_id as string,
        displayName: row.display_name as string,
        organizationId: (row.organization_id as string | null) ?? null,
        orgName: (row.org_name as string | null) ?? null,
        status: row.status as string,
      })),
      totalElements: result.rows.length > 0 ? Number(result.rows[0].total) : 0,
    };
  }

  /** Global rows (tenant_id IS NULL) are readable under the 0008 policies;
   * writes stay on provisioning paths (ADR-21/ADR-22). */
  async roleRows(client: PoolClient, tenantId: string, scope?: string): Promise<RoleRow[]> {
    const result = await client.query(
      `SELECT r.role_id, r.role_code, r.role_name, r.scope_type, r.is_system, r.tenant_id,
              coalesce(
                array_agg(p.permission_code ORDER BY p.permission_code)
                  FILTER (WHERE p.permission_code IS NOT NULL),
                '{}'
              ) AS permissions
       FROM role r
       LEFT JOIN role_permission rp ON rp.role_id = r.role_id
       LEFT JOIN permission p ON p.permission_id = rp.permission_id
       WHERE (r.tenant_id = $1 OR r.tenant_id IS NULL)
         AND ($2::text IS NULL OR r.scope_type = $2)
       GROUP BY r.role_id
       ORDER BY r.is_system DESC, r.role_code`,
      [tenantId, scope ?? null],
    );
    return result.rows.map((row) => ({
      roleId: row.role_id as string,
      roleCode: row.role_code as string,
      roleName: row.role_name as string,
      scopeType: row.scope_type as string,
      isSystem: row.is_system as boolean,
      tenantId: (row.tenant_id as string | null) ?? null,
      permissions: row.permissions as string[],
    }));
  }
}
