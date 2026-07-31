import { Controller, Get, Inject, Query, Req } from '@nestjs/common';
import { ApiError, authErrors } from '../common/api-error';
import { RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest, AuthContext } from '../common/request-context';
import type { RoleRow, UserSummaryRow } from './iam.repository';
import { IamService, type OrgTreeNode, type PageResult } from './iam.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireAuth(req: ApiRequest): AuthContext {
  if (!req.auth) throw authErrors.unauthenticated();
  return req.auth;
}

function intQuery(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

@Controller('organizations')
export class OrganizationsController {
  constructor(@Inject(IamService) private readonly iam: IamService) {}

  /** UNE-AUTH-005 */
  @Get('tree')
  @RequirePermission('ORG_READ')
  async tree(
    @Req() req: ApiRequest,
    @Query('tenantId') tenantId?: string,
  ): Promise<SuccessEnvelope<OrgTreeNode[]>> {
    return ok(req, await this.iam.organizationTree(requireAuth(req), tenantId || undefined));
  }
}

@Controller('users')
export class UsersController {
  constructor(@Inject(IamService) private readonly iam: IamService) {}

  /** UNE-AUTH-006 */
  @Get()
  @RequirePermission('USER_READ')
  async search(
    @Req() req: ApiRequest,
    @Query('orgId') orgId?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<SuccessEnvelope<PageResult<UserSummaryRow>>> {
    if (orgId && !UUID_RE.test(orgId)) {
      throw new ApiError(400, 'USER-2101', '요청 필드가 올바르지 않습니다.', {
        violations: [{ field: 'orgId', reason: 'UUID 형식이어야 합니다.' }],
      });
    }
    const query = {
      orgId: orgId || undefined,
      keyword: keyword?.trim() || undefined,
      status: status || undefined,
      page: intQuery(page, 0, 10_000),
      size: Math.max(1, intQuery(size, 20, 100)),
    };
    return ok(req, await this.iam.searchUsers(requireAuth(req), query));
  }
}

@Controller('roles')
export class RolesController {
  constructor(@Inject(IamService) private readonly iam: IamService) {}

  /** UNE-AUTH-007 */
  @Get()
  @RequirePermission('RBAC_READ')
  async list(
    @Req() req: ApiRequest,
    @Query('scope') scope?: string,
  ): Promise<SuccessEnvelope<RoleRow[]>> {
    return ok(req, await this.iam.roles(requireAuth(req), scope || undefined));
  }
}
