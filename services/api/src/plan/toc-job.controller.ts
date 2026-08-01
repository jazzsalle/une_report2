import { Body, Controller, Headers, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { ErrorViolation } from '../common/api-error';
import { isUuid, requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { planErrors } from './plan.service';
import { TocJobService, type JobResource } from './toc-job.service';

const MAX_OPTION_LENGTH = 2000;
const GENERATION_OPTION_KEYS = ['additionalInstruction', 'notes'];

interface TocJobBody {
  contextSnapshotId?: unknown;
  generationOption?: unknown;
}

/** UNE-PLAN-009. Separate from PlanController so the job lifecycle
 * (request/cancel/retry) stays in one place with its own service. */
@Controller('plans')
export class TocJobController {
  constructor(@Inject(TocJobService) private readonly jobs: TocJobService) {}

  @Post(':planId/toc-jobs')
  @RequirePermission('PLAN_GENERATE')
  @Idempotent({ required: true, successStatus: 202 })
  @HttpCode(202)
  async requestTocJob(
    @Req() req: ApiRequest,
    @Param('planId') planId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: TocJobBody | undefined,
  ): Promise<SuccessEnvelope<JobResource>> {
    const id = uuidParam('planId', planId);
    const violations: ErrorViolation[] = [];
    if (!isUuid(body?.contextSnapshotId)) {
      violations.push({ field: 'contextSnapshotId', reason: 'UUID 형식의 필수 항목입니다.' });
    }
    const option = parseGenerationOption(body?.generationOption, violations);
    if (violations.length > 0) throw planErrors.invalidRequest(violations);
    return ok(
      req,
      await this.jobs.requestTocJob(
        requireAuth(req),
        id,
        {
          contextSnapshotId: body?.contextSnapshotId as string,
          ...(option ? { generationOption: option } : {}),
        },
        idempotencyKey,
        requestMeta(req),
      ),
    );
  }
}

function parseGenerationOption(
  value: unknown,
  violations: ErrorViolation[],
): { additionalInstruction?: string; notes?: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    violations.push({ field: 'generationOption', reason: '객체여야 합니다.' });
    return undefined;
  }
  const option: { additionalInstruction?: string; notes?: string } = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!GENERATION_OPTION_KEYS.includes(key)) {
      violations.push({ field: `generationOption.${key}`, reason: '허용되지 않는 항목입니다.' });
      continue;
    }
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string' || raw.length > MAX_OPTION_LENGTH) {
      violations.push({
        field: `generationOption.${key}`,
        reason: `${MAX_OPTION_LENGTH}자 이하의 문자열이어야 합니다.`,
      });
      continue;
    }
    option[key as 'additionalInstruction' | 'notes'] = raw;
  }
  return Object.keys(option).length > 0 ? option : undefined;
}
