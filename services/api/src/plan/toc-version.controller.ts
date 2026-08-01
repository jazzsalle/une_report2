import { Body, Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { MAX_TOC_DEPTH, MAX_TOC_TITLE_LENGTH } from '@une/domain';
import { ApiError, type ErrorViolation } from '../common/api-error';
import { isUuid, requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import {
  TocVersionService,
  type TocTreeNodeInput,
  type TocVersionResource,
} from './toc-version.service';

const MAX_NODE_KEY_LENGTH = 80;

interface SaveBody {
  baseVersionId?: unknown;
  tocTree?: unknown;
  confirm?: unknown;
}

function badRequest(violations: ErrorViolation[]): ApiError {
  return new ApiError(400, 'COM-0400', '요청 본문이 올바르지 않습니다.', { violations });
}

/**
 * Shape check only. Semantic rules (depth, node count, duplicate/invalid keys,
 * empty tree, title length) belong to the domain validator and answer 422
 * PLAN-422-002 — the contract lists no PLAN-4001 for UNE-PLAN-014.
 * Descent stops one level past MAX_TOC_DEPTH because validateTocTree stops
 * there too (deeper nodes are unreachable behind DEPTH_EXCEEDED).
 */
function checkNodes(
  value: unknown,
  path: string,
  depth: number,
  violations: ErrorViolation[],
): void {
  if (!Array.isArray(value)) {
    violations.push({ field: path, reason: '배열이어야 합니다.' });
    return;
  }
  value.forEach((raw, index) => {
    const nodePath = `${path}/${index}`;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      violations.push({ field: nodePath, reason: '객체여야 합니다.' });
      return;
    }
    const node = raw as Record<string, unknown>;
    if (typeof node.title !== 'string') {
      violations.push({ field: `${nodePath}/title`, reason: '문자열이어야 합니다.' });
    } else if (node.title.length > MAX_TOC_TITLE_LENGTH * 2) {
      // Hard cap so an oversized payload never reaches the hash/flatten step;
      // the exact limit is reported by the domain validator (422).
      violations.push({ field: `${nodePath}/title`, reason: '제목이 너무 깁니다.' });
    }
    if (node.nodeKey !== undefined && node.nodeKey !== null) {
      if (typeof node.nodeKey !== 'string' || node.nodeKey.length > MAX_NODE_KEY_LENGTH) {
        violations.push({
          field: `${nodePath}/nodeKey`,
          reason: `${MAX_NODE_KEY_LENGTH}자 이하의 문자열이어야 합니다.`,
        });
      }
    }
    if (node.generationPolicy !== undefined && node.generationPolicy !== null) {
      if (typeof node.generationPolicy !== 'object' || Array.isArray(node.generationPolicy)) {
        violations.push({ field: `${nodePath}/generationPolicy`, reason: '객체여야 합니다.' });
      }
    }
    if (node.children !== undefined && node.children !== null && depth <= MAX_TOC_DEPTH) {
      checkNodes(node.children, `${nodePath}/children`, depth + 1, violations);
    }
  });
}

/** UNE-PLAN-014 / UNE-PLAN-015. */
@Controller('plans')
export class TocVersionController {
  constructor(@Inject(TocVersionService) private readonly versions: TocVersionService) {}

  @Post(':planId/toc-versions')
  @RequirePermission('PLAN_EDIT')
  @Idempotent({ required: true, successStatus: 201 })
  async save(
    @Req() req: ApiRequest,
    @Param('planId') planId: string,
    @Body() body: SaveBody | undefined,
  ): Promise<SuccessEnvelope<TocVersionResource>> {
    const id = uuidParam('planId', planId);
    const violations: ErrorViolation[] = [];
    if (!isUuid(body?.baseVersionId)) {
      violations.push({ field: 'baseVersionId', reason: 'UUID 형식의 필수 항목입니다.' });
    }
    checkNodes(body?.tocTree, 'tocTree', 1, violations);
    if (body?.confirm !== undefined && typeof body.confirm !== 'boolean') {
      violations.push({ field: 'confirm', reason: 'true 또는 false여야 합니다.' });
    }
    if (violations.length > 0) throw badRequest(violations);
    return ok(
      req,
      await this.versions.saveVersion(
        requireAuth(req),
        id,
        {
          baseVersionId: body?.baseVersionId as string,
          tocTree: body?.tocTree as TocTreeNodeInput[],
          confirm: body?.confirm === true,
        },
        requestMeta(req),
      ),
    );
  }

  @Get(':planId/toc-versions/:id')
  @RequirePermission('PLAN_READ')
  async get(
    @Req() req: ApiRequest,
    @Param('planId') planId: string,
    @Param('id') tocVersionId: string,
  ): Promise<SuccessEnvelope<TocVersionResource>> {
    return ok(
      req,
      await this.versions.getVersion(
        requireAuth(req),
        uuidParam('planId', planId),
        uuidParam('id', tocVersionId),
      ),
    );
  }
}
