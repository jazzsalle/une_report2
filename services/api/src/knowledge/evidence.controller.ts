import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { MAX_TOP_K } from '@une/domain';
import type { ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { evidenceErrors } from './evidence-errors';
import {
  EvidenceService,
  type EvidenceSetResource,
  type SourceLocatorResource,
} from './evidence.service';

/**
 * UNE-KNOW-004~007 (CC-230).
 *
 * 검색은 **동기**이므로 200으로 끝난다 — CC-220의 등록이 202인 것과 갈리는
 * 지점이다(ADR-37 D2). 자원을 만들지만 사용자가 곧바로 결과를 보고 고르는
 * 흐름이라 201/Location보다 결과 본문이 맞다.
 */

function rejectUnknownKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  violations: ErrorViolation[],
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      violations.push({ field: key, reason: '알 수 없는 필드입니다.' });
    }
  }
}

interface SearchBody {
  snapshotId?: unknown;
  query?: unknown;
  topK?: unknown;
  filters?: unknown;
}

interface LockBody {
  reason?: unknown;
}

@Controller()
export class EvidenceController {
  constructor(@Inject(EvidenceService) private readonly evidence: EvidenceService) {}

  /** UNE-KNOW-004 */
  @Post('situations/:id/evidence-searches')
  @RequirePermission('EVIDENCE_SEARCH')
  @Idempotent({ required: true, successStatus: 200 })
  @HttpCode(200)
  async search(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: SearchBody | undefined,
  ): Promise<SuccessEnvelope<EvidenceSetResource>> {
    const situationId = uuidParam('id', id);
    const violations: ErrorViolation[] = [];
    const raw = (body ?? {}) as Record<string, unknown>;
    rejectUnknownKeys(raw, ['snapshotId', 'query', 'topK', 'filters'], violations);

    // 기준 판을 **요청이 명시한다**. 생략을 허용하면 서버가 "지금 최신"으로
    // 채우게 되고, 그러면 사용자가 본 판과 다를 수 있다 — EvidenceSet은
    // 동결되므로 그 어긋남이 굳는다(ADR-34 D17과 같은 이유).
    if (typeof raw.snapshotId !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.snapshotId)) {
      violations.push({ field: 'snapshotId', reason: 'UUID여야 합니다.' });
    }
    const query = typeof raw.query === 'string' ? raw.query.trim() : '';
    if (!query) violations.push({ field: 'query', reason: '필수 항목입니다.' });
    else if (query.length > 2000)
      violations.push({ field: 'query', reason: '2000자 이하여야 합니다.' });

    if (raw.topK !== undefined) {
      if (
        !Number.isInteger(raw.topK) ||
        (raw.topK as number) < 1 ||
        (raw.topK as number) > MAX_TOP_K
      ) {
        violations.push({ field: 'topK', reason: `1 이상 ${MAX_TOP_K} 이하의 정수여야 합니다.` });
      }
    }
    if (
      raw.filters !== undefined &&
      (typeof raw.filters !== 'object' || raw.filters === null || Array.isArray(raw.filters))
    ) {
      violations.push({ field: 'filters', reason: '객체여야 합니다.' });
    }

    if (violations.length > 0) throw evidenceErrors.invalidRequest(violations);

    return ok(
      req,
      await this.evidence.search(requireAuth(req), requestMeta(req), situationId, {
        snapshotId: raw.snapshotId as string,
        query,
        topK: raw.topK as number | undefined,
        filters: raw.filters as Record<string, unknown> | undefined,
      }),
    );
  }

  /** UNE-KNOW-005 */
  @Get('evidence-sets/:id')
  @RequirePermission('EVIDENCE_READ')
  async get(
    @Req() req: ApiRequest,
    @Param('id') id: string,
  ): Promise<SuccessEnvelope<EvidenceSetResource>> {
    return ok(req, await this.evidence.get(requireAuth(req), uuidParam('id', id)));
  }

  /** UNE-KNOW-006 */
  @Post('evidence-sets/:id/lock')
  @RequirePermission('EVIDENCE_LOCK')
  @Idempotent({ required: true, successStatus: 200 })
  @HttpCode(200)
  async lock(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: LockBody | undefined,
  ): Promise<SuccessEnvelope<EvidenceSetResource>> {
    const setId = uuidParam('id', id);
    const violations: ErrorViolation[] = [];
    const raw = (body ?? {}) as Record<string, unknown>;
    rejectUnknownKeys(raw, ['reason'], violations);

    // 동결은 되돌릴 수 없으므로 왜 동결했는지가 감사의 핵심이다.
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (!reason) violations.push({ field: 'reason', reason: '필수 항목입니다.' });
    else if (reason.length > 500)
      violations.push({ field: 'reason', reason: '500자 이하여야 합니다.' });

    if (violations.length > 0) throw evidenceErrors.invalidRequest(violations);

    return ok(req, await this.evidence.freeze(requireAuth(req), requestMeta(req), setId, reason));
  }

  /** UNE-KNOW-007 */
  @Get('evidence-items/:id/source')
  @RequirePermission('EVIDENCE_READ')
  async source(
    @Req() req: ApiRequest,
    @Param('id') id: string,
  ): Promise<SuccessEnvelope<SourceLocatorResource>> {
    return ok(req, await this.evidence.sourceLocator(requireAuth(req), uuidParam('id', id)));
  }
}
