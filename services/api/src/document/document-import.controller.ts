import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { isUuid, requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import {
  DocumentImportService,
  type DocumentAnalysisResource,
  type ImportedDocumentResource,
} from './document-import.service';
import { fileErrors } from './file-errors';

/**
 * UNE-DOC-003/004 (설계 10 §3.4, CC-170).
 *
 * 반입 권한은 `PLAN_CREATE`다 — 계약이 그렇게 적혀 있고, 실제로 이 동작은
 * "계획서 작업을 시작한다"에 속한다. 분석 조회는 `DOC_READ`다.
 */
@Controller('documents')
export class DocumentImportController {
  constructor(@Inject(DocumentImportService) private readonly imports: DocumentImportService) {}

  /** UNE-DOC-003 */
  @Post('import-hwpx')
  @RequirePermission('PLAN_CREATE')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async importHwpx(
    @Req() req: ApiRequest,
    @Body() body: { fileId?: unknown; planId?: unknown; title?: unknown } | undefined,
  ): Promise<SuccessEnvelope<ImportedDocumentResource>> {
    const violations: { field: string; reason: string }[] = [];
    if (!isUuid(body?.fileId)) {
      violations.push({ field: 'fileId', reason: 'UUID 형식의 필수 항목입니다.' });
    }
    if (body?.planId !== undefined && body.planId !== null && !isUuid(body.planId)) {
      violations.push({ field: 'planId', reason: 'UUID 형식이어야 합니다.' });
    }
    if (
      body?.title !== undefined &&
      (typeof body.title !== 'string' || body.title.trim().length === 0 || body.title.length > 300)
    ) {
      violations.push({ field: 'title', reason: '1~300자 문자열이어야 합니다.' });
    }
    if (violations.length > 0) throw fileErrors.invalidRequest(violations);

    return ok(
      req,
      await this.imports.importFromFileObject(
        requireAuth(req),
        {
          fileId: body!.fileId as string,
          planId: (body!.planId as string | null | undefined) ?? null,
          title: body!.title as string | undefined,
        },
        requestMeta(req),
      ),
    );
  }

  /** UNE-DOC-004 */
  @Get(':documentId/analysis')
  @RequirePermission('DOC_READ')
  async getAnalysis(
    @Req() req: ApiRequest,
    @Param('documentId') documentId: string,
  ): Promise<SuccessEnvelope<DocumentAnalysisResource>> {
    const id = uuidParam('documentId', documentId);
    return ok(req, await this.imports.getAnalysis(requireAuth(req), id));
  }
}
