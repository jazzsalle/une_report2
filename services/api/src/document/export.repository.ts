import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { ExportFormat, ExportStatus, ValidationStatus, ValidationTrack } from '@une/domain';

/**
 * export_job / validation_report / file_object 접근 (CC-160, 마이그레이션 0020).
 *
 * 모든 조회는 RLS가 걸린 연결에서 돈다(DatabaseService.withTenant). 그래서
 * WHERE에 tenant_id를 다시 적지 않는다 — 적으면 "정책이 아니라 이 조건이
 * 격리를 한다"는 인상을 주고, 조건을 빠뜨린 다음 질의가 안전해 보이게 된다.
 */

export interface ExportJobRow {
  exportId: string;
  tenantId: string;
  documentId: string;
  revisionId: string;
  format: ExportFormat;
  status: ExportStatus;
  outputFileId: string | null;
  validationReportId: string | null;
  requestedBy: string;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface ValidationReportRow {
  validationReportId: string;
  targetType: string;
  targetId: string;
  track: ValidationTrack;
  status: ValidationStatus;
  checks: unknown;
  environment: Record<string, unknown>;
  createdAt: Date;
}

export interface FileObjectRow {
  fileId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: string;
}

const JOB_COLUMNS = `export_id, tenant_id, document_id, revision_id, format, status,
                     output_file_id, validation_report_id, requested_by, created_at, finished_at`;

function toJob(row: Record<string, unknown>): ExportJobRow {
  return {
    exportId: row.export_id as string,
    tenantId: row.tenant_id as string,
    documentId: row.document_id as string,
    revisionId: row.revision_id as string,
    format: row.format as ExportFormat,
    status: row.status as ExportStatus,
    outputFileId: (row.output_file_id as string | null) ?? null,
    validationReportId: (row.validation_report_id as string | null) ?? null,
    requestedBy: row.requested_by as string,
    createdAt: row.created_at as Date,
    finishedAt: (row.finished_at as Date | null) ?? null,
  };
}

@Injectable()
export class ExportRepository {
  async insertJob(
    client: PoolClient,
    input: {
      tenantId: string;
      documentId: string;
      revisionId: string;
      format: ExportFormat;
      requestedBy: string;
    },
  ): Promise<ExportJobRow> {
    const res = await client.query(
      `INSERT INTO export_job (tenant_id, document_id, revision_id, format, status, requested_by)
       VALUES ($1, $2, $3, $4, 'QUEUED', $5)
       RETURNING ${JOB_COLUMNS}`,
      [input.tenantId, input.documentId, input.revisionId, input.format, input.requestedBy],
    );
    return toJob(res.rows[0] as Record<string, unknown>);
  }

  async findJob(client: PoolClient, exportId: string): Promise<ExportJobRow | null> {
    const res = await client.query(`SELECT ${JOB_COLUMNS} FROM export_job WHERE export_id = $1`, [
      exportId,
    ]);
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toJob(row) : null;
  }

  async findReport(
    client: PoolClient,
    validationReportId: string,
  ): Promise<ValidationReportRow | null> {
    const res = await client.query(
      `SELECT validation_report_id, target_type, target_id, track, status,
              checks_json, environment_json, created_at
       FROM validation_report WHERE validation_report_id = $1`,
      [validationReportId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      validationReportId: row.validation_report_id as string,
      targetType: row.target_type as string,
      targetId: row.target_id as string,
      track: row.track as ValidationTrack,
      status: row.status as ValidationStatus,
      checks: row.checks_json,
      environment: (row.environment_json as Record<string, unknown>) ?? {},
      createdAt: row.created_at as Date,
    };
  }

  async findFile(client: PoolClient, fileId: string): Promise<FileObjectRow | null> {
    const res = await client.query(
      `SELECT file_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status
       FROM file_object WHERE file_id = $1`,
      [fileId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      fileId: row.file_id as string,
      storageKey: row.storage_key as string,
      originalName: row.original_name as string,
      mimeType: row.mime_type as string,
      // bigint는 드라이버가 문자열로 준다. Number로 좁히기 전에 통과시키면
      // 크기 비교가 문자열 비교가 된다.
      sizeBytes: Number(row.size_bytes),
      sha256: row.sha256 as string,
      scanStatus: row.scan_status as string,
    };
  }
}
