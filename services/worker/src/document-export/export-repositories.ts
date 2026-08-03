import type { PoolClient } from 'pg';

/**
 * Export 러너의 DB 접근 (CC-160, 마이그레이션 0020).
 *
 * 디스패치 범위(테넌트 미설정)에서 쓰는 질의와 테넌트 범위에서 쓰는 질의를
 * 한 파일에 두되 이름으로 구분한다 — 어느 범위에서 불러야 하는지가 호출부의
 * 판단으로 남으면 언젠가 잘못된 범위에서 불린다.
 */

export interface ClaimedExport {
  exportId: string;
  tenantId: string;
  documentId: string;
  revisionId: string;
  format: string;
}

/**
 * 디스패치 범위: QUEUED를 RUNNING으로 집는다.
 *
 * `FOR UPDATE SKIP LOCKED`로 워커 여럿이 같은 Job을 집지 않게 한다.
 * tenant_id를 함께 돌려받는 것이 §1의 핵심이다 — 이 값이 없으면 정산
 * 트랜잭션을 어느 테넌트로 열지 알 수 없다.
 */
export async function claimExports(
  client: PoolClient,
  batchSize: number,
): Promise<ClaimedExport[]> {
  const res = await client.query(
    `UPDATE export_job SET status = 'RUNNING'
      WHERE export_id IN (
        SELECT export_id FROM export_job
         WHERE status = 'QUEUED'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
      )
      RETURNING export_id, tenant_id, document_id, revision_id, format`,
    [batchSize],
  );
  return (res.rows as Record<string, unknown>[]).map((row) => ({
    exportId: row.export_id as string,
    tenantId: row.tenant_id as string,
    documentId: row.document_id as string,
    revisionId: row.revision_id as string,
    format: row.format as string,
  }));
}

/**
 * 죽은 워커가 남긴 RUNNING을 회수한다.
 *
 * 리스가 없으면 워커가 죽는 순간 그 Job은 영원히 RUNNING으로 남는다.
 * 사용자에게는 "생성 중"이 끝나지 않는 화면이 된다.
 */
export async function sweepStaleRunning(
  client: PoolClient,
  leaseTimeoutMs: number,
  batchSize: number,
): Promise<ClaimedExport[]> {
  const res = await client.query(
    `UPDATE export_job SET status = 'RUNNING'
      WHERE export_id IN (
        SELECT export_id FROM export_job
         WHERE status = 'RUNNING'
           AND created_at < now() - ($1::int * interval '1 millisecond')
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      RETURNING export_id, tenant_id, document_id, revision_id, format`,
    [leaseTimeoutMs, batchSize],
  );
  return (res.rows as Record<string, unknown>[]).map((row) => ({
    exportId: row.export_id as string,
    tenantId: row.tenant_id as string,
    documentId: row.document_id as string,
    revisionId: row.revision_id as string,
    format: row.format as string,
  }));
}

export interface ExportSource {
  documentId: string;
  sourceFileId: string | null;
  sourceStorageKey: string | null;
  sourceSha256: string | null;
  revisionIr: unknown;
  baseIr: unknown;
  verdict: string | null;
}

/** 테넌트 범위: 되쓰기에 필요한 원본과 두 IR을 한 번에 읽는다. */
export async function loadExportSource(
  client: PoolClient,
  documentId: string,
  revisionId: string,
): Promise<ExportSource | null> {
  const res = await client.query(
    `SELECT d.document_id, d.source_file_id,
            f.storage_key AS source_storage_key, f.sha256 AS source_sha256,
            r.ir_json AS revision_ir,
            base.ir_json AS base_ir,
            tp.analysis_status AS verdict
       FROM document d
       LEFT JOIN file_object f ON f.file_id = d.source_file_id
       JOIN document_revision r ON r.revision_id = $2 AND r.document_id = d.document_id
       LEFT JOIN LATERAL (
         SELECT ir_json FROM document_revision
          WHERE document_id = d.document_id AND origin = 'IMPORT'
          ORDER BY revision_no LIMIT 1
       ) base ON true
       LEFT JOIN LATERAL (
         SELECT analysis_status FROM template_profile
          WHERE document_id = d.document_id
          ORDER BY profile_version DESC LIMIT 1
       ) tp ON true
      WHERE d.document_id = $1`,
    [documentId, revisionId],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    documentId: row.document_id as string,
    sourceFileId: (row.source_file_id as string | null) ?? null,
    sourceStorageKey: (row.source_storage_key as string | null) ?? null,
    sourceSha256: (row.source_sha256 as string | null) ?? null,
    revisionIr: row.revision_ir,
    baseIr: row.base_ir,
    verdict: (row.verdict as string | null) ?? null,
  };
}

export async function insertFileObject(
  client: PoolClient,
  input: {
    tenantId: string;
    storageKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    createdBy: string;
  },
): Promise<string> {
  const res = await client.query(
    `INSERT INTO file_object
       (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256, scan_status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
     RETURNING file_id`,
    [
      input.tenantId,
      input.storageKey,
      input.originalName,
      input.mimeType,
      input.sizeBytes,
      input.sha256,
      input.createdBy,
    ],
  );
  return res.rows[0].file_id as string;
}

export async function insertValidationReport(
  client: PoolClient,
  input: {
    targetType: 'DOCUMENT' | 'EXPORT';
    targetId: string;
    track: 'A_AUTO' | 'B_HANCOM';
    status: string;
    checks: unknown;
    environment: Record<string, unknown>;
  },
): Promise<string> {
  const res = await client.query(
    `INSERT INTO validation_report
       (target_type, target_id, track, status, checks_json, environment_json)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING validation_report_id`,
    [
      input.targetType,
      input.targetId,
      input.track,
      input.status,
      JSON.stringify(input.checks),
      JSON.stringify(input.environment),
    ],
  );
  return res.rows[0].validation_report_id as string;
}

export async function completeExport(
  client: PoolClient,
  input: { exportId: string; outputFileId: string; validationReportId: string },
): Promise<number> {
  const res = await client.query(
    `UPDATE export_job
        SET status = 'COMPLETED', output_file_id = $2,
            validation_report_id = $3, finished_at = now()
      WHERE export_id = $1 AND status = 'RUNNING'`,
    [input.exportId, input.outputFileId, input.validationReportId],
  );
  return res.rowCount ?? 0;
}

export async function failExport(
  client: PoolClient,
  input: { exportId: string; validationReportId: string | null },
): Promise<number> {
  const res = await client.query(
    `UPDATE export_job
        SET status = 'FAILED', validation_report_id = COALESCE($2, validation_report_id),
            finished_at = now()
      WHERE export_id = $1 AND status = 'RUNNING'`,
    [input.exportId, input.validationReportId],
  );
  return res.rowCount ?? 0;
}

export async function requestedBy(client: PoolClient, exportId: string): Promise<string | null> {
  const res = await client.query(`SELECT requested_by FROM export_job WHERE export_id = $1`, [
    exportId,
  ]);
  return (res.rows[0]?.requested_by as string | undefined) ?? null;
}
