import { Inject, Injectable } from '@nestjs/common';
import {
  EXPORT_FORMATS,
  IMPLEMENTED_EXPORT_FORMATS,
  type ExportFormat,
  type ExportStatus,
} from '@une/domain';
import { ObjectStorageError, type ObjectStoragePort } from '@une/provider-adapters';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { DatabaseService } from '../db/database.service';
import { OBJECT_STORAGE } from '../common/storage.provider';
import { DocumentRepository } from './document.repository';
import { DocumentService } from './document.service';
import { exportErrors } from './export-errors';
import { ExportRepository, type ExportJobRow } from './export.repository';

/**
 * UNE-DOC-012~014 (설계 10 §3.4, CC-160).
 *
 * API는 **접수만 한다.** 되쓰기·Track A 검증·저장소 업로드는 워커의 몫이다
 * (CC-120이 생성 Job에서 세운 것과 같은 경계). 그래야 HWPX 직렬화가 오래
 * 걸려도 요청 스레드를 잡지 않고, 실패가 재시도 가능한 상태로 남는다.
 */

export interface ValidationSummaryResource {
  validationReportId: string;
  track: string;
  status: string;
  checks: unknown[];
  notRunLayers: unknown[];
  outputSha256?: string;
  sourceSha256?: string;
}

export interface ExportJobResource {
  exportId: string;
  documentId: string;
  revisionId: string;
  format: ExportFormat;
  status: ExportStatus;
  outputFileId: string | null;
  validationReportId: string | null;
  validation: ValidationSummaryResource | null;
  requestedBy: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface DownloadResult {
  body: Uint8Array;
  contentType: string;
  fileName: string;
  sha256: string;
}

function toResource(
  job: ExportJobRow,
  validation: ValidationSummaryResource | null,
): ExportJobResource {
  return {
    exportId: job.exportId,
    documentId: job.documentId,
    revisionId: job.revisionId,
    format: job.format,
    status: job.status,
    outputFileId: job.outputFileId,
    validationReportId: job.validationReportId,
    validation,
    requestedBy: job.requestedBy,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}

/** 문서 상태가 Export를 허용하는가. 편집 중 문서도 내보낼 수 있다 —
 * 사용자는 작업 중인 계획서를 받아 볼 수 있어야 한다. 막는 것은 삭제뿐이다. */
const EXPORTABLE_DOCUMENT_STATUSES: ReadonlySet<string> = new Set([
  'EDITING',
  'REVIEW',
  'APPROVED',
]);

@Injectable()
export class ExportService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DocumentRepository) private readonly documents: DocumentRepository,
    @Inject(DocumentService) private readonly documentService: DocumentService,
    @Inject(ExportRepository) private readonly exports: ExportRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  /** UNE-DOC-012 — 접수 후 202. */
  async requestExport(
    auth: AuthContext,
    documentId: string,
    body: { format: string; revisionId?: string | null },
    meta: RequestMetaLike,
  ): Promise<ExportJobResource> {
    if (!EXPORT_FORMATS.includes(body.format as ExportFormat)) {
      throw exportErrors.invalidRequest([
        { field: 'format', reason: `${EXPORT_FORMATS.join('/')} 중 하나여야 합니다.` },
      ]);
    }
    const format = body.format as ExportFormat;
    if (!IMPLEMENTED_EXPORT_FORMATS.has(format)) {
      // 어휘에는 있으나 변환기가 없다. "지원함"으로 광고하지 않는다.
      throw exportErrors.unprocessable(`${format} 변환은 아직 지원하지 않습니다.`, [
        { field: 'format', reason: '현재 산출 가능한 형식은 HWPX뿐입니다.' },
      ]);
    }

    return this.db.withTenant(auth.tenantId, async (c) => {
      const document = await this.documents.findDocument(c, auth.tenantId, documentId);
      if (!document) throw exportErrors.unprocessable('문서를 찾을 수 없습니다.');
      if (!EXPORTABLE_DOCUMENT_STATUSES.has(document.status)) {
        throw exportErrors.unprocessable(
          `상태가 ${document.status}인 문서는 Export할 수 없습니다.`,
        );
      }
      if (!document.sourceFileId) {
        // 보존 저장은 원본 패키지 위에 되쓰는 것이다. 원본이 없으면 되쓸
        // 대상이 없다 — 합성 패키지를 만들어 내보내는 것은 다른 기능이다.
        throw exportErrors.unprocessable('원본 HWPX가 없는 문서는 보존 Export를 할 수 없습니다.');
      }

      const revision = body.revisionId
        ? await this.documents.findRevision(c, documentId, body.revisionId)
        : await this.documents.findHeadRevision(c, documentId);
      if (!revision) throw exportErrors.unprocessable('대상 Revision을 찾을 수 없습니다.');

      const job = await this.exports.insertJob(c, {
        tenantId: auth.tenantId,
        documentId,
        revisionId: revision.revisionId,
        format,
        requestedBy: auth.userId,
      });

      await this.documentService.insertDocumentAudit(
        c,
        auth,
        meta,
        'EXPORT_REQUESTED',
        documentId,
        {
          exportId: job.exportId,
          revisionId: revision.revisionId,
          format,
        },
      );

      return toResource(job, null);
    });
  }

  /** UNE-DOC-013 — 상태와 Track A 요약. */
  async getExport(auth: AuthContext, exportId: string): Promise<ExportJobResource> {
    return this.db.withTenant(auth.tenantId, async (c) => {
      const job = await this.exports.findJob(c, exportId);
      if (!job) throw exportErrors.notFound();
      if (!job.validationReportId) return toResource(job, null);

      const report = await this.exports.findReport(c, job.validationReportId);
      if (!report) return toResource(job, null);
      const checks = Array.isArray(report.checks) ? report.checks : [];
      const environment = report.environment;
      return toResource(job, {
        validationReportId: report.validationReportId,
        track: report.track,
        status: report.status,
        checks,
        notRunLayers: Array.isArray(environment.notRunLayers) ? environment.notRunLayers : [],
        ...(typeof environment.outputSha256 === 'string'
          ? { outputSha256: environment.outputSha256 }
          : {}),
        ...(typeof environment.sourceSha256 === 'string'
          ? { sourceSha256: environment.sourceSha256 }
          : {}),
      });
    });
  }

  /**
   * UNE-DOC-014 — 산출물 스트리밍.
   *
   * 다운로드는 감사 대상이다(설계 10 §1391 "다운로드 감사로그"). 저장소에서
   * 바이트를 받은 뒤에 기록한다 — 실패한 다운로드를 "받아 갔다"로 남기면
   * 감사 기록이 사실과 달라진다.
   */
  async downloadExport(
    auth: AuthContext,
    exportId: string,
    meta: RequestMetaLike,
  ): Promise<DownloadResult> {
    const prepared = await this.db.withTenant(auth.tenantId, async (c) => {
      const job = await this.exports.findJob(c, exportId);
      if (!job) throw exportErrors.notFound();
      if (job.status !== 'COMPLETED') throw exportErrors.notReady(job.status);
      if (!job.outputFileId) throw exportErrors.gone();
      const file = await this.exports.findFile(c, job.outputFileId);
      if (!file) throw exportErrors.gone();
      return { job, file };
    });

    let fetched;
    try {
      fetched = await this.storage.get(prepared.file.storageKey);
    } catch (error) {
      if (error instanceof ObjectStorageError && error.kind === 'NOT_FOUND') {
        // DB는 파일을 안다고 하는데 저장소에 없다 = 보존기간 만료·정리.
        throw exportErrors.gone();
      }
      throw exportErrors.storageUnavailable();
    }

    if (fetched.sha256 !== prepared.file.sha256) {
      // 등록된 해시와 다른 바이트를 내주지 않는다. 손상이든 교체든,
      // 검증받은 그 산출물이 아니다.
      throw exportErrors.gone();
    }

    await this.db.withTenant(auth.tenantId, async (c) => {
      await this.documentService.insertDocumentAudit(
        c,
        auth,
        meta,
        'EXPORT_DOWNLOADED',
        prepared.job.documentId,
        {
          exportId: prepared.job.exportId,
          fileId: prepared.file.fileId,
          sha256: prepared.file.sha256,
          sizeBytes: prepared.file.sizeBytes,
        },
      );
    });

    return {
      body: fetched.body,
      contentType: prepared.file.mimeType,
      fileName: prepared.file.originalName,
      sha256: prepared.file.sha256,
    };
  }
}
