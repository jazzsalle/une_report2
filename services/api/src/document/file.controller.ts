import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { requestMeta, requireAuth, uuidParam } from '../common/controller-utils';
import { Idempotent, Public, RequirePermission } from '../common/decorators';
import { ok, type SuccessEnvelope } from '../common/envelope';
import type { ApiRequest } from '../common/request-context';
import { fileErrors } from './file-errors';
import {
  FileService,
  type FileObjectResource,
  type FileRegistrationResource,
} from './file.service';

/**
 * UNE-DOC-001/002 + 업로드 전송 라우트 (설계 10 §3.4, CC-170).
 *
 * 전송 라우트에는 `x-une-api-id`가 없다 — 카탈로그 API가 아니라 presign을 할 수
 * 없는 드라이버에서만 쓰이는 전송 수단이다(ADR-32). `@Public`인 이유도 같다:
 * presign URL과 같은 성질이어야 하므로 인가는 서명된 티켓 하나로 한다.
 */
@Controller('files')
export class FileController {
  constructor(@Inject(FileService) private readonly files: FileService) {}

  /** UNE-DOC-001 */
  @Post()
  @RequirePermission('FILE_UPLOAD')
  @Idempotent({ required: true, successStatus: 201 })
  @HttpCode(201)
  async register(
    @Req() req: ApiRequest,
    @Body()
    body:
      | {
          fileName?: unknown;
          sizeBytes?: unknown;
          mimeType?: unknown;
          sha256?: unknown;
          purpose?: unknown;
        }
      | undefined,
  ): Promise<SuccessEnvelope<FileRegistrationResource>> {
    const violations: { field: string; reason: string }[] = [];
    if (typeof body?.fileName !== 'string' || body.fileName.trim().length === 0) {
      violations.push({ field: 'fileName', reason: '필수 항목입니다.' });
    }
    if (!Number.isInteger(body?.sizeBytes) || (body?.sizeBytes as number) < 1) {
      violations.push({ field: 'sizeBytes', reason: '1 이상의 정수여야 합니다.' });
    }
    if (typeof body?.mimeType !== 'string' || body.mimeType.trim().length === 0) {
      violations.push({ field: 'mimeType', reason: '필수 항목입니다.' });
    }
    if (typeof body?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(body.sha256)) {
      violations.push({ field: 'sha256', reason: '소문자 16진수 64자여야 합니다.' });
    }
    if (body?.purpose !== undefined && typeof body.purpose !== 'string') {
      violations.push({ field: 'purpose', reason: '문자열이어야 합니다.' });
    }
    if (violations.length > 0) throw fileErrors.invalidRequest(violations);

    return ok(
      req,
      await this.files.register(
        requireAuth(req),
        {
          fileName: body!.fileName as string,
          sizeBytes: body!.sizeBytes as number,
          mimeType: body!.mimeType as string,
          sha256: body!.sha256 as string,
          purpose: body!.purpose as string | undefined,
        },
        requestMeta(req),
      ),
    );
  }

  /** UNE-DOC-002 */
  @Post(':fileId/complete')
  @RequirePermission('FILE_UPLOAD')
  @Idempotent({ required: false, successStatus: 200 })
  @HttpCode(200)
  async complete(
    @Req() req: ApiRequest,
    @Param('fileId') fileId: string,
    @Body() body: { etag?: unknown } | undefined,
  ): Promise<SuccessEnvelope<FileObjectResource>> {
    const id = uuidParam('fileId', fileId);
    if (body?.etag !== undefined && typeof body.etag !== 'string') {
      throw fileErrors.invalidRequest([{ field: 'etag', reason: '문자열이어야 합니다.' }]);
    }
    return ok(
      req,
      await this.files.complete(
        requireAuth(req),
        id,
        { etag: body?.etag as string | undefined },
        requestMeta(req),
      ),
    );
  }

  /**
   * 업로드 전송 (카탈로그 밖). 본문은 원시 바이트다.
   *
   * `express.raw` 미들웨어가 `req.body`를 Buffer로 채운다(main/app.factory에서
   * 이 라우트에만 적용한다 — 전역으로 켜면 JSON 경로가 망가진다).
   */
  @Put(':fileId/content')
  @Public()
  @HttpCode(204)
  async upload(
    @Req() req: ApiRequest,
    @Res() res: Response,
    @Param('fileId') fileId: string,
    @Query('token') token: string | undefined,
  ): Promise<void> {
    const id = uuidParam('fileId', fileId);
    if (typeof token !== 'string' || token.length === 0) throw fileErrors.ticketRejected();
    const body = (req as unknown as { body?: unknown }).body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw fileErrors.invalidRequest([{ field: 'body', reason: '본문이 비어 있습니다.' }]);
    }
    await this.files.storeByTicket(token, id, Uint8Array.prototype.slice.call(body, 0));
    res.status(204).end();
  }
}
