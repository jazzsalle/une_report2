import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ErrorViolation } from '../common/api-error';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import {
  ChangeSetService,
  type AutosaveReceiptResource,
  type ChangeSetResultResource,
} from './change-set.service';
import {
  validateMutationId,
  validateOperations,
  validateOrigin,
  validateUuid,
} from './change-set.validator';
import { documentErrors, parseIfMatch, setEtag } from './document-errors';
import {
  DocumentService,
  type DocumentIrResource,
  type RevisionPage,
  type RestoreResult,
} from './document.service';

/**
 * UNE-DOC-005~009 (설계 10 §3.4).
 *
 * 검증 순서는 .claude/rules/backend.md 그대로다:
 * 스키마 → 테넌트 → 역할 → 상태 → 버전/ETag → 멱등.
 * 앞의 셋은 컨트롤러와 가드가, 뒤의 셋은 서비스가 한 트랜잭션 안에서 본다.
 */
@Controller('documents')
export class DocumentController {
  constructor(
    @Inject(DocumentService) private readonly documents: DocumentService,
    @Inject(ChangeSetService) private readonly changeSets: ChangeSetService,
  ) {}

  /** UNE-DOC-005 */
  @Get(':documentId/ir')
  @RequirePermission('DOC_READ')
  async getIr(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('documentId') documentId: string,
    @Query('revisionId') revisionId?: string,
  ): Promise<SuccessEnvelope<DocumentIrResource>> {
    const id = uuidParam('documentId', documentId);
    const revision = revisionId === undefined ? undefined : uuidParam('revisionId', revisionId);
    const resource = await this.documents.getIr(requireAuth(req), id, revision);
    setEtag(res, resource.revisionNo);
    return ok(req, resource);
  }

  /** UNE-DOC-006 */
  @Post(':documentId/changesets')
  @RequirePermission('DOC_EDIT')
  // 200: 새 URL의 자원을 만드는 것이 아니라 기존 문서를 다음 head로 옮긴다.
  // 계약(UNE-DOC-006)도 200 하나만 성공 상태로 선언한다.
  @HttpCode(200)
  async applyChangeSet(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('documentId') documentId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<SuccessEnvelope<ChangeSetResultResource>> {
    const id = uuidParam('documentId', documentId);
    const expectedRevisionNo = parseIfMatch(ifMatch);
    const violations: ErrorViolation[] = [];
    const baseRevisionId = validateUuid(body?.baseRevisionId, 'baseRevisionId', violations);
    const clientMutationId = validateMutationId(
      body?.clientMutationId,
      'clientMutationId',
      violations,
    );
    const origin = validateOrigin(body?.origin ?? 'USER', violations);
    const operations = validateOperations(body?.operations, violations);
    if (body?.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
      violations.push({ field: 'dryRun', reason: 'boolean이어야 합니다.' });
    }
    if (body?.undoesChangeSetId !== undefined) {
      validateUuid(body.undoesChangeSetId, 'undoesChangeSetId', violations);
    }
    for (const [field, max] of [
      ['checkpointLabel', 100],
      ['changeSummary', 2000],
    ] as const) {
      const value = body?.[field];
      if (value !== undefined && (typeof value !== 'string' || value.length > max)) {
        violations.push({ field, reason: `${max}자 이하 문자열이어야 합니다.` });
      }
    }
    if (violations.length > 0) throw documentErrors.invalidRequest(violations);

    const result = await this.changeSets.apply(
      requireAuth(req),
      id,
      expectedRevisionNo,
      {
        baseRevisionId,
        origin,
        operations,
        clientMutationId,
        dryRun: body?.dryRun === true,
        ...(typeof body?.undoesChangeSetId === 'string'
          ? { undoesChangeSetId: body.undoesChangeSetId }
          : {}),
        ...(typeof body?.checkpointLabel === 'string'
          ? { checkpointLabel: body.checkpointLabel }
          : {}),
        ...(typeof body?.changeSummary === 'string' ? { changeSummary: body.changeSummary } : {}),
      },
      requestMeta(req),
    );
    // 성공하면 ETag를 새로 설정한다. dryRun은 문서를 움직이지 않았으므로 기준이
    // 그대로다 — 그때도 태그를 내보내야 클라이언트가 다음 요청에 쓸 값을 잃지
    // 않는다(계획서 PATCH가 confirm 뒤 ETag를 다시 세우는 것과 같은 이유).
    setEtag(res, result.newRevisionNo ?? expectedRevisionNo);
    return ok(req, result);
  }

  /** UNE-DOC-007 */
  @Get(':documentId/revisions')
  @RequirePermission('DOC_READ')
  async listRevisions(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('documentId') documentId: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ): Promise<SuccessEnvelope<RevisionPage>> {
    const id = uuidParam('documentId', documentId);
    const violations: ErrorViolation[] = [];
    const pageNo = page === undefined ? 1 : Number(page);
    if (!Number.isInteger(pageNo) || pageNo < 1) {
      violations.push({ field: 'page', reason: '1 이상의 정수여야 합니다.' });
    }
    const sizeNo = size === undefined ? 20 : Number(size);
    if (!Number.isInteger(sizeNo) || sizeNo < 1 || sizeNo > 100) {
      violations.push({ field: 'size', reason: '1~100 사이 정수여야 합니다.' });
    }
    if (violations.length > 0) throw documentErrors.invalidRequest(violations);
    const result = await this.documents.listRevisions(requireAuth(req), id, pageNo, sizeNo);
    if (result.headRevisionNo !== null) setEtag(res, result.headRevisionNo);
    return ok(req, result);
  }

  /** UNE-DOC-008 */
  @Post(':documentId/revisions/:revisionId/restore')
  @RequirePermission('DOC_EDIT')
  @HttpCode(200)
  async restore(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('documentId') documentId: string,
    @Param('revisionId') revisionId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<SuccessEnvelope<RestoreResult>> {
    const id = uuidParam('documentId', documentId);
    const target = uuidParam('revisionId', revisionId);
    const expectedRevisionNo = parseIfMatch(ifMatch);
    const violations: ErrorViolation[] = [];
    for (const [field, max] of [
      ['reason', 500],
      ['checkpointLabel', 100],
    ] as const) {
      const value = body?.[field];
      if (value !== undefined && (typeof value !== 'string' || value.length > max)) {
        violations.push({ field, reason: `${max}자 이하 문자열이어야 합니다.` });
      }
    }
    if (violations.length > 0) throw documentErrors.invalidRequest(violations);
    const result = await this.documents.restoreRevision(
      requireAuth(req),
      id,
      target,
      expectedRevisionNo,
      {
        ...(typeof body?.reason === 'string' ? { reason: body.reason } : {}),
        ...(typeof body?.checkpointLabel === 'string'
          ? { checkpointLabel: body.checkpointLabel }
          : {}),
      },
      requestMeta(req),
    );
    setEtag(res, result.revision.revisionNo);
    return ok(req, result);
  }

  /** UNE-DOC-009 */
  @Post(':documentId/autosaves')
  @RequirePermission('DOC_EDIT')
  @HttpCode(200)
  async autosave(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('documentId') documentId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<SuccessEnvelope<AutosaveReceiptResource>> {
    const id = uuidParam('documentId', documentId);
    const expectedRevisionNo = parseIfMatch(ifMatch);
    const violations: ErrorViolation[] = [];
    const baseRevisionId = validateUuid(body?.baseRevisionId, 'baseRevisionId', violations);
    const clientMutationId = validateMutationId(
      body?.clientMutationId,
      'clientMutationId',
      violations,
    );
    const delta = body?.delta;
    let operations: ReturnType<typeof validateOperations> = [];
    if (typeof delta !== 'object' || delta === null || Array.isArray(delta)) {
      violations.push({ field: 'delta', reason: '객체가 필요합니다.' });
    } else {
      operations = validateOperations((delta as Record<string, unknown>).operations, violations);
    }
    let seq: number | undefined;
    if (body?.seq !== undefined) {
      // 하한을 0으로 둔다: 클라이언트 큐가 0-based인지 1-based인지 정본에 없다
      // (0019 §6과 같은 판단 — 없는 규칙을 기제로 만들지 않는다).
      if (typeof body.seq !== 'number' || !Number.isInteger(body.seq) || body.seq < 0) {
        violations.push({ field: 'seq', reason: '0 이상의 정수여야 합니다.' });
      } else {
        seq = body.seq;
      }
    }
    if (violations.length > 0) throw documentErrors.invalidRequest(violations);

    const receipt = await this.changeSets.autosave(
      requireAuth(req),
      id,
      expectedRevisionNo,
      {
        baseRevisionId,
        delta: { operations },
        clientMutationId,
        ...(seq === undefined ? {} : { seq }),
      },
      requestMeta(req),
    );
    setEtag(res, receipt.resultRevisionNo ?? expectedRevisionNo);
    return ok(req, receipt);
  }
}
