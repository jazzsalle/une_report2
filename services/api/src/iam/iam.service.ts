import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import {
  IamRepository,
  type OrgRow,
  type RoleRow,
  type UserSearchQuery,
  type UserSummaryRow,
} from './iam.repository';

export interface OrgTreeNode {
  organizationId: string;
  orgCode: string;
  orgName: string;
  orgPath: string;
  sortOrder: number;
  status: string;
  children: OrgTreeNode[];
}

export interface PageResult<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

function buildTree(rows: OrgRow[]): OrgTreeNode[] {
  const nodes = new Map<string, OrgTreeNode>();
  for (const row of rows) {
    nodes.set(row.organizationId, {
      organizationId: row.organizationId,
      orgCode: row.orgCode,
      orgName: row.orgName,
      orgPath: row.orgPath,
      sortOrder: row.sortOrder,
      status: row.status,
      children: [],
    });
  }
  const roots: OrgTreeNode[] = [];
  for (const row of rows) {
    const node = nodes.get(row.organizationId) as OrgTreeNode;
    const parent = row.parentId ? nodes.get(row.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

@Injectable()
export class IamService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(IamRepository) private readonly repo: IamRepository,
  ) {}

  /** UNE-AUTH-005. tenantId always comes from the verified JWT claim; the
   * optional query param may only confirm it (design §2.2 forbids trusting a
   * client-picked tenant). */
  async organizationTree(auth: AuthContext, requestedTenantId?: string): Promise<OrgTreeNode[]> {
    if (requestedTenantId && requestedTenantId !== auth.tenantId) {
      throw new ApiError(403, 'ORG-2001', '다른 기관의 조직도는 조회할 수 없습니다.');
    }
    const rows = await this.db.withTenant(auth.tenantId, (c) =>
      this.repo.orgRows(c, auth.tenantId),
    );
    return buildTree(rows);
  }

  /** UNE-AUTH-006 */
  async searchUsers(
    auth: AuthContext,
    query: UserSearchQuery,
  ): Promise<PageResult<UserSummaryRow>> {
    const { items, totalElements } = await this.db.withTenant(auth.tenantId, (c) =>
      this.repo.searchUsers(c, auth.tenantId, query),
    );
    return {
      items,
      page: query.page,
      size: query.size,
      totalElements,
      totalPages: Math.ceil(totalElements / query.size),
    };
  }

  /** UNE-AUTH-007 */
  async roles(auth: AuthContext, scope?: string): Promise<RoleRow[]> {
    return this.db.withTenant(auth.tenantId, (c) => this.repo.roleRows(c, auth.tenantId, scope));
  }
}
