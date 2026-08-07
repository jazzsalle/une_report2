import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { exportErrors } from './export-errors';
import { ExportService, type ExportJobResource } from './export.service';

/**
 * UNE-DOC-012/013/014 (설계 10 §3.4).
 *
 * 012는 `documents/{id}/exports`, 013·014는 `exports/{id}` 아래다 — 계약의
 * 경로가 그렇게 갈려 있어 컨트롤러도 둘로 나눈다. 한 컨트롤러에 두 prefix를
 * 억지로 넣으면 라우트가 계약과 다르게 조립될 여지가 생긴다.
 */
@Controller('documents')
export class DocumentExportController {
  constructor(@Inject(ExportService) private readonly exports: ExportService) {}

  /** UNE-DOC-012 */
  @Post(':documentId/exports')
  @RequirePermission('DOC_EXPORT')
  @Idempotent({ required: true, successStatus: 202 })
  @HttpCode(202)
  async requestExport(
    @Req() req: ApiRequest,
    @Param('documentId') documentId: string,
    @Body() body: { format?: unknown; revisionId?: unknown } | undefined,
  ): Promise<SuccessEnvelope<ExportJobResource>> {
    const id = uuidParam('documentId', documentId);
    if (typeof body?.format !== 'string') {
      throw exportErrors.invalidRequest([{ field: 'format', reason: '필수 항목입니다.' }]);
    }
    const revisionId =
      body.revisionId === undefined || body.revisionId === null
        ? null
        : uuidParam('revisionId', String(body.revisionId));

    return ok(
      req,
      await this.exports.requestExport(
        requireAuth(req),
        id,
        { format: body.format, revisionId },
        requestMeta(req),
      ),
    );
  }
}

@Controller('exports')
export class ExportController {
  constructor(@Inject(ExportService) private readonly exports: ExportService) {}

  /** UNE-DOC-013 */
  @Get(':exportId')
  @RequirePermission('DOC_READ')
  async getExport(
    @Req() req: ApiRequest,
    @Param('exportId') exportId: string,
  ): Promise<SuccessEnvelope<ExportJobResource>> {
    const id = uuidParam('exportId', exportId);
    return ok(req, await this.exports.getExport(requireAuth(req), id));
  }

  /** UNE-DOC-014 — 바이너리 응답이므로 envelope를 쓰지 않는다. */
  @Get(':exportId/download')
  @RequirePermission('DOC_READ')
  async download(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('exportId') exportId: string,
  ): Promise<void> {
    const id = uuidParam('exportId', exportId);
    const result = await this.exports.downloadExport(requireAuth(req), id, requestMeta(req));

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', String(result.body.length));
    // 파일명은 사용자 입력에서 왔을 수 있다. RFC 5987 형식으로만 내보내고
    // ASCII 대체값을 함께 둔다 — 원문을 헤더에 그대로 넣으면 개행·따옴표로
    // 헤더를 쪼갤 수 있다.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="export.hwpx"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
    );
    // 산출물은 내용이 바뀌지 않는다(해시가 키의 일부). 그래도 감사 로그가
    // 모든 다운로드를 봐야 하므로 캐시를 허용하지 않는다.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Sha256', result.sha256);
    res.end(Buffer.from(result.body));
  }
}
