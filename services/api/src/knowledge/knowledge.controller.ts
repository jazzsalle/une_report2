import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { KNOWLEDGE_DOCUMENT_TYPES, RETENTION_SCOPES } from '@une/domain';
import type { ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { knowledgeErrors } from './knowledge-errors';
import { KnowledgeService, type KnowledgeDocumentResource } from './knowledge.service';

/**
 * UNE-KNOW-001~003 (CC-220).
 *
 * UNE-KNOW-004~007(EvidenceSet)은 CC-230이다 — 계약의 그 자리는 아직
 * placeholder이며 이 컨트롤러가 건드리지 않는다.
 *
 * **목록 엔드포인트를 만들지 않았다.** 설계 10은 SCR-SIT-008과 SCR-SIT-009
 * 모두에 대해 이 세 API만 적는다. 화면에 목록이 필요해 보이더라도 설계에 없는
 * 엔드포인트를 여기서 발명하면 계약이 설계보다 앞서 나가고, 그 차이를 다음
 * 사람이 근거 없이 물려받는다. 필요하면 변경요청으로 연다.
 *
 * 등록·재시도는 **202**로 끝난다. UNI 호출을 워커가 하기 때문이며(설계 10
 * §7.23 7단계) 201을 돌려주면 "등록이 끝났다"로 읽힌다. 실제로 끝난 것은
 * 요청 접수이고 UNI 처리는 시작도 하지 않았다.
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

interface CreateBody {
  fileId?: unknown;
  documentType?: unknown;
  retentionScope?: unknown;
  force?: unknown;
  metadata?: unknown;
}

interface RetryBody {
  reason?: unknown;
}

@Controller()
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledge: KnowledgeService) {}

  /** UNE-KNOW-001 */
  @Post('situations/:id/knowledge-documents')
  @RequirePermission('KNOWLEDGE_UPLOAD')
  @Idempotent({ required: true, successStatus: 202 })
  @HttpCode(202)
  async create(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: CreateBody | undefined,
  ): Promise<SuccessEnvelope<KnowledgeDocumentResource>> {
    const situationId = uuidParam('id', id);
    const violations: ErrorViolation[] = [];
    const raw = (body ?? {}) as Record<string, unknown>;
    rejectUnknownKeys(
      raw,
      ['fileId', 'documentType', 'retentionScope', 'force', 'metadata'],
      violations,
    );

    if (typeof raw.fileId !== 'string' || !/^[0-9a-f-]{36}$/i.test(raw.fileId)) {
      violations.push({ field: 'fileId', reason: 'UUID여야 합니다.' });
    }
    if (
      typeof raw.documentType !== 'string' ||
      !(KNOWLEDGE_DOCUMENT_TYPES as readonly string[]).includes(raw.documentType)
    ) {
      violations.push({
        field: 'documentType',
        reason: `허용 값: ${KNOWLEDGE_DOCUMENT_TYPES.join(', ')}`,
      });
    }
    if (
      raw.retentionScope !== undefined &&
      (typeof raw.retentionScope !== 'string' ||
        !(RETENTION_SCOPES as readonly string[]).includes(raw.retentionScope))
    ) {
      violations.push({
        field: 'retentionScope',
        reason: `허용 값: ${RETENTION_SCOPES.join(', ')}`,
      });
    }
    if (raw.force !== undefined && typeof raw.force !== 'boolean') {
      violations.push({ field: 'force', reason: '불리언이어야 합니다.' });
    }
    if (
      raw.metadata !== undefined &&
      (typeof raw.metadata !== 'object' || raw.metadata === null || Array.isArray(raw.metadata))
    ) {
      violations.push({ field: 'metadata', reason: '객체여야 합니다.' });
    }

    if (violations.length > 0) throw knowledgeErrors.invalidRequest(violations);

    return ok(
      req,
      await this.knowledge.create(requireAuth(req), requestMeta(req), situationId, {
        fileId: raw.fileId as string,
        documentType: raw.documentType as string,
        retentionScope: raw.retentionScope as string | undefined,
        force: raw.force as boolean | undefined,
        metadata: raw.metadata as Record<string, unknown> | undefined,
      }),
    );
  }

  /** UNE-KNOW-002 */
  @Get('knowledge-documents/:id')
  @RequirePermission('KNOWLEDGE_READ')
  async get(
    @Req() req: ApiRequest,
    @Param('id') id: string,
  ): Promise<SuccessEnvelope<KnowledgeDocumentResource>> {
    return ok(req, await this.knowledge.get(requireAuth(req), uuidParam('id', id)));
  }

  /** UNE-KNOW-003 */
  @Post('knowledge-documents/:id/retry')
  @RequirePermission('KNOWLEDGE_UPLOAD')
  @Idempotent({ required: true, successStatus: 202 })
  @HttpCode(202)
  async retry(
    @Req() req: ApiRequest,
    @Param('id') id: string,
    @Body() body: RetryBody | undefined,
  ): Promise<SuccessEnvelope<KnowledgeDocumentResource>> {
    const documentId = uuidParam('id', id);
    const violations: ErrorViolation[] = [];
    const raw = (body ?? {}) as Record<string, unknown>;
    rejectUnknownKeys(raw, ['reason'], violations);

    // 설계 10 UNE-KNOW-003의 요청은 `reason` 하나다. 재시도는 감사 대상이고
    // 왜 다시 보냈는지가 그 기록의 핵심이므로 필수로 둔다.
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (!reason) violations.push({ field: 'reason', reason: '필수 항목입니다.' });
    else if (reason.length > 500)
      violations.push({ field: 'reason', reason: '500자 이하여야 합니다.' });

    if (violations.length > 0) throw knowledgeErrors.invalidRequest(violations);

    return ok(
      req,
      await this.knowledge.retry(requireAuth(req), requestMeta(req), documentId, reason),
    );
  }
}
