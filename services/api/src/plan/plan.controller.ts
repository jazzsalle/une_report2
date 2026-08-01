import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, type ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { HAZARD_TYPES, MANAGEMENT_PHASES } from './plan-context.validator';
import { PLAN_STATUSES } from '@une/domain';
import {
  PlanService,
  planErrors,
  type ContextDraftResource,
  type PlanDetailResource,
  type PlanPage,
  type PlanResource,
  type SnapshotResource,
} from './plan.service';

const START_MODES = ['BLANK', 'UPLOAD_HWPX', 'RECENT'] as const;

function planIdParam(planId: string): string {
  return uuidParam('planId', planId);
}

/** If-Match carries the plan version_no as a strong entity tag: `"3"`.
 * Weak tags (`W/"3"`) are rejected — RFC 7232 allows only strong comparison
 * for If-Match. Absent header → 428 (design 10 공통 통제 / ADR-23 D5). */
function parseIfMatch(header: string | undefined): number {
  if (!header || !header.trim()) throw planErrors.ifMatchRequired();
  const match = /^\s*"?(\d+)"?\s*$/.exec(header);
  if (!match) {
    throw new ApiError(400, 'COM-0400', 'If-Match 헤더가 올바르지 않습니다.', {
      violations: [{ field: 'If-Match', reason: '강한 ETag(버전 번호 "3" 형식)만 허용됩니다.' }],
    });
  }
  return Number(match[1]);
}

function setEtag(res: Response, versionNo: number): void {
  res.setHeader('ETag', `"${versionNo}"`);
}

function isStringField(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

interface CreateBody {
  title?: unknown;
  startMode?: unknown;
  hazardType?: unknown;
  managementPhase?: unknown;
  templateFileId?: unknown;
}

interface PatchBody {
  title?: unknown;
  hazardType?: unknown;
  managementPhase?: unknown;
  [key: string]: unknown;
}

interface DraftBody {
  context?: unknown;
  schemaVersion?: unknown;
}

@Controller('plans')
export class PlanController {
  constructor(@Inject(PlanService) private readonly plans: PlanService) {}

  /** UNE-PLAN-001 */
  @Post()
  @RequirePermission('PLAN_CREATE')
  @Idempotent({ required: true, successStatus: 201 })
  async create(
    @Req() req: ApiRequest,
    @Body() body: CreateBody | undefined,
  ): Promise<SuccessEnvelope<PlanResource>> {
    const violations: ErrorViolation[] = [];
    const title = typeof body?.title === 'string' ? body.title.trim() : undefined;
    if (!title) {
      violations.push({ field: 'title', reason: '필수 항목입니다.' });
    } else if (title.length > 300) {
      violations.push({ field: 'title', reason: '300자 이하여야 합니다.' });
    }
    if (
      !isStringField(body?.startMode) ||
      !(START_MODES as readonly string[]).includes(body.startMode)
    ) {
      violations.push({ field: 'startMode', reason: `허용 값: ${START_MODES.join(', ')}` });
    }
    if (!isStringField(body?.hazardType) || !HAZARD_TYPES.includes(body.hazardType as string)) {
      violations.push({ field: 'hazardType', reason: '재난유형 10종 중 하나여야 합니다.' });
    }
    if (
      !isStringField(body?.managementPhase) ||
      !MANAGEMENT_PHASES.includes(body.managementPhase as string)
    ) {
      violations.push({ field: 'managementPhase', reason: '예방 또는 대비여야 합니다.' });
    }
    if (body?.templateFileId !== undefined && body.templateFileId !== null) {
      // File upload lands in CC-140; accepting the id now would dangle (ADR-23 D3).
      violations.push({
        field: 'templateFileId',
        reason: '아직 지원되지 않는 항목입니다(CC-140).',
      });
    }
    if (violations.length > 0) throw planErrors.invalidRequest(violations);
    return ok(
      req,
      await this.plans.create(
        requireAuth(req),
        {
          title: title as string,
          startMode: body?.startMode as string,
          hazardType: body?.hazardType as string,
          managementPhase: body?.managementPhase as string,
        },
        requestMeta(req),
      ),
    );
  }

  /** UNE-PLAN-002 */
  @Get()
  @RequirePermission('PLAN_READ')
  async search(
    @Req() req: ApiRequest,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
    @Query('hazardType') hazardType?: string,
    @Query('inTrash') inTrash?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<SuccessEnvelope<PlanPage>> {
    const violations: ErrorViolation[] = [];
    if (keyword && keyword.length > 100) {
      violations.push({ field: 'keyword', reason: '100자 이하여야 합니다.' });
    }
    if (status && !(PLAN_STATUSES as readonly string[]).includes(status)) {
      violations.push({ field: 'status', reason: '알 수 없는 상태입니다.' });
    }
    if (hazardType && !HAZARD_TYPES.includes(hazardType)) {
      violations.push({ field: 'hazardType', reason: '재난유형 10종 중 하나여야 합니다.' });
    }
    if (inTrash !== undefined && inTrash !== 'true' && inTrash !== 'false') {
      violations.push({ field: 'inTrash', reason: 'true 또는 false여야 합니다.' });
    }
    const pageNo = page === undefined ? 1 : Number(page);
    if (!Number.isInteger(pageNo) || pageNo < 1) {
      violations.push({ field: 'page', reason: '1 이상의 정수여야 합니다.' });
    }
    const sizeNo = size === undefined ? 20 : Number(size);
    if (!Number.isInteger(sizeNo) || sizeNo < 1 || sizeNo > 100) {
      violations.push({ field: 'size', reason: '1~100 사이 정수여야 합니다.' });
    }
    if (violations.length > 0) throw planErrors.invalidQuery(violations);
    return ok(
      req,
      await this.plans.search(requireAuth(req), {
        keyword: keyword?.trim() || undefined,
        status: status || undefined,
        hazardType: hazardType || undefined,
        inTrash: inTrash === 'true',
        page: pageNo,
        size: sizeNo,
      }),
    );
  }

  /** UNE-PLAN-003 */
  @Get(':planId')
  @RequirePermission('PLAN_READ')
  async detail(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('planId') planId: string,
  ): Promise<SuccessEnvelope<PlanDetailResource>> {
    const detail = await this.plans.detail(requireAuth(req), planIdParam(planId));
    setEtag(res, detail.versionNo);
    return ok(req, detail);
  }

  /** UNE-PLAN-004 */
  @Patch(':planId')
  @RequirePermission('PLAN_EDIT')
  async patch(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('planId') planId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: PatchBody | undefined,
  ): Promise<SuccessEnvelope<PlanResource>> {
    const id = planIdParam(planId);
    const expectedVersion = parseIfMatch(ifMatch);
    const violations: ErrorViolation[] = [];
    const patch: { title?: string; hazardType?: string; managementPhase?: string } = {};
    const allowed = new Set(['title', 'hazardType', 'managementPhase']);
    for (const key of Object.keys(body ?? {})) {
      if (!allowed.has(key)) violations.push({ field: key, reason: '수정할 수 없는 항목입니다.' });
    }
    if (body?.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title || title.length > 300) {
        violations.push({ field: 'title', reason: '1~300자 문자열이어야 합니다.' });
      } else {
        patch.title = title;
      }
    }
    if (body?.hazardType !== undefined) {
      if (!isStringField(body.hazardType) || !HAZARD_TYPES.includes(body.hazardType as string)) {
        violations.push({ field: 'hazardType', reason: '재난유형 10종 중 하나여야 합니다.' });
      } else {
        patch.hazardType = body.hazardType as string;
      }
    }
    if (body?.managementPhase !== undefined) {
      if (
        !isStringField(body.managementPhase) ||
        !MANAGEMENT_PHASES.includes(body.managementPhase as string)
      ) {
        violations.push({ field: 'managementPhase', reason: '예방 또는 대비여야 합니다.' });
      } else {
        patch.managementPhase = body.managementPhase as string;
      }
    }
    if (Object.keys(patch).length === 0 && violations.length === 0) {
      violations.push({ field: '/', reason: '수정할 항목이 최소 1개 필요합니다.' });
    }
    if (violations.length > 0) throw planErrors.invalidRequest(violations);
    const updated = await this.plans.patchMeta(
      requireAuth(req),
      id,
      expectedVersion,
      patch,
      requestMeta(req),
    );
    setEtag(res, updated.versionNo);
    return ok(req, updated);
  }

  /** UNE-PLAN-005 (204: no envelope body) */
  @Delete(':planId')
  @RequirePermission('PLAN_DELETE')
  @HttpCode(204)
  async remove(
    @Req() req: ApiRequest,
    @Param('planId') planId: string,
    @Body() body: { reason?: unknown } | undefined,
  ): Promise<void> {
    const reason =
      typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : undefined;
    if (reason && reason.length > 500) {
      throw planErrors.invalidRequest([{ field: 'reason', reason: '500자 이하여야 합니다.' }]);
    }
    await this.plans.moveToTrash(requireAuth(req), planIdParam(planId), reason, requestMeta(req));
  }

  /** UNE-PLAN-006. No replay store: the single-draft upsert is naturally
   * idempotent (last-write-wins), and a replayed stored response would turn a
   * key reuse with edited content into a permanent 409 (ADR-23 D1 개정). */
  @Post(':planId/context-drafts')
  @RequirePermission('PLAN_EDIT')
  @HttpCode(200)
  async saveDraft(
    @Req() req: ApiRequest,
    @Param('planId') planId: string,
    @Body() body: DraftBody | undefined,
  ): Promise<SuccessEnvelope<ContextDraftResource>> {
    const id = planIdParam(planId);
    if (body?.context === undefined || body.context === null || typeof body.context !== 'object') {
      throw planErrors.invalidRequest([{ field: 'context', reason: '객체가 필요합니다.' }]);
    }
    const schemaVersion = body.schemaVersion === undefined ? undefined : String(body.schemaVersion);
    if (schemaVersion !== undefined && schemaVersion.length > 20) {
      throw planErrors.invalidRequest([
        { field: 'schemaVersion', reason: '20자 이하여야 합니다.' },
      ]);
    }
    return ok(
      req,
      await this.plans.saveDraft(
        requireAuth(req),
        id,
        body.context,
        schemaVersion,
        requestMeta(req),
      ),
    );
  }

  /** UNE-PLAN-007 */
  @Post(':planId/context-snapshots')
  @RequirePermission('PLAN_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  async confirmSnapshot(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('planId') planId: string,
    @Body() body: unknown,
  ): Promise<SuccessEnvelope<SnapshotResource>> {
    const id = planIdParam(planId);
    if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw planErrors.contextInvalid([{ field: '/', reason: 'PlanContext 객체가 필요합니다.' }]);
    }
    const { snapshot, planVersionNo } = await this.plans.confirmSnapshot(
      requireAuth(req),
      id,
      body,
      requestMeta(req),
    );
    // The confirm bumps the plan's version_no; without the new ETag an
    // immediately following PATCH would 409 unexpectedly (review minor).
    setEtag(res, planVersionNo);
    return ok(req, snapshot);
  }

  /** UNE-PLAN-008 */
  @Get(':planId/context-snapshots')
  @RequirePermission('PLAN_READ')
  async listSnapshots(
    @Req() req: ApiRequest,
    @Param('planId') planId: string,
  ): Promise<SuccessEnvelope<{ items: SnapshotResource[] }>> {
    return ok(req, {
      items: await this.plans.listSnapshots(requireAuth(req), planIdParam(planId)),
    });
  }
}
