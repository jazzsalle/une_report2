import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ErrorViolation } from '../common/api-error';
import { isUuid, requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { planErrors } from './plan.service';
import { ContentJobService } from './content-job.service';
import type { JobResource } from './toc-job.service';

const NODE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const MAX_TARGET_NODE_KEYS = 100;
const MAX_PROTECTED_BLOCK_IDS = 500;

interface ContentJobBody {
  contextSnapshotId?: unknown;
  tocVersionId?: unknown;
  protectedBlockIds?: unknown;
  targetNodeKeys?: unknown;
}

/** UNE-PLAN-016 (CC-130). */
@Controller('plans')
export class ContentJobController {
  constructor(@Inject(ContentJobService) private readonly jobs: ContentJobService) {}

  @Post(':planId/content-jobs')
  @RequirePermission('PLAN_GENERATE')
  @Idempotent({ required: true, successStatus: 202 })
  @HttpCode(202)
  async requestContentJob(
    @Req() req: ApiRequest,
    @Param('planId') planId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: ContentJobBody | undefined,
  ): Promise<SuccessEnvelope<JobResource>> {
    const id = uuidParam('planId', planId);
    const violations: ErrorViolation[] = [];
    if (!isUuid(body?.contextSnapshotId)) {
      violations.push({ field: 'contextSnapshotId', reason: 'UUID 형식의 필수 항목입니다.' });
    }
    if (!isUuid(body?.tocVersionId)) {
      violations.push({ field: 'tocVersionId', reason: 'UUID 형식의 필수 항목입니다.' });
    }
    const protectedBlockIds = parseUuidArray(
      body?.protectedBlockIds,
      'protectedBlockIds',
      MAX_PROTECTED_BLOCK_IDS,
      violations,
    );
    const targetNodeKeys = parseNodeKeys(body?.targetNodeKeys, violations);
    if (violations.length > 0) throw planErrors.invalidRequest(violations);
    return ok(
      req,
      await this.jobs.requestContentJob(
        requireAuth(req),
        id,
        {
          contextSnapshotId: body?.contextSnapshotId as string,
          tocVersionId: body?.tocVersionId as string,
          ...(protectedBlockIds ? { protectedBlockIds } : {}),
          ...(targetNodeKeys ? { targetNodeKeys } : {}),
        },
        idempotencyKey,
        requestMeta(req),
      ),
    );
  }
}

function parseUuidArray(
  value: unknown,
  field: string,
  maxItems: number,
  violations: ErrorViolation[],
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    violations.push({ field, reason: '비어 있지 않은 배열이어야 합니다.' });
    return undefined;
  }
  if (value.length > maxItems) {
    violations.push({ field, reason: `최대 ${maxItems}개까지 지정할 수 있습니다.` });
    return undefined;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isUuid(entry)) {
      violations.push({ field: `${field}[${index}]`, reason: 'UUID 형식이어야 합니다.' });
      continue;
    }
    if (seen.has(entry as string)) {
      violations.push({ field: `${field}[${index}]`, reason: '중복된 항목입니다.' });
      continue;
    }
    seen.add(entry as string);
    out.push(entry as string);
  }
  return violations.length > 0 ? undefined : out;
}

function parseNodeKeys(value: unknown, violations: ErrorViolation[]): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    violations.push({ field: 'targetNodeKeys', reason: '비어 있지 않은 배열이어야 합니다.' });
    return undefined;
  }
  if (value.length > MAX_TARGET_NODE_KEYS) {
    violations.push({
      field: 'targetNodeKeys',
      reason: `최대 ${MAX_TARGET_NODE_KEYS}개까지 지정할 수 있습니다.`,
    });
    return undefined;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || !NODE_KEY_PATTERN.test(entry)) {
      violations.push({ field: `targetNodeKeys[${index}]`, reason: '유효한 노드 키가 아닙니다.' });
      continue;
    }
    if (seen.has(entry)) {
      violations.push({ field: `targetNodeKeys[${index}]`, reason: '중복된 항목입니다.' });
      continue;
    }
    seen.add(entry);
    out.push(entry);
  }
  return violations.length > 0 ? undefined : out;
}
