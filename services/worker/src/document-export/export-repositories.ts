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
    `UPDATE export_job SET status = 'RUNNING', started_at = now(),
                           attempt_no = attempt_no + 1
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
 * 죽은 워커가 남긴 RUNNING을 회수한다 (0021 §1).
 *
 * 리스가 없으면 워커가 죽는 순간 그 Job은 영원히 RUNNING으로 남고, 사용자
 * 에게는 "생성 중"이 끝나지 않는 화면이 된다.
 *
 * **기준은 `started_at`(클레임 시각)이지 `created_at`(요청 시각)이 아니다.**
 * 요청 시각을 보면 큐에 리스 시간보다 오래 머문 Job이 클레임 직후부터 stale
 * 조건을 영구히 만족해, 워커가 둘 이상일 때 진행 중인 Job을 매 틱마다
 * 재클레임한다(리뷰 M-1). generation_job이 쓰는 것과 같은 축이다(0015 §1).
 *
 * `attempt_no`가 상한에 닿은 Job은 회수하지 않는다 — 정산이 계속 실패하는
 * Job을 무한히 되집으면 워커가 그것만 붙들고 돈다. 상한에 닿은 행은 RUNNING
 * 으로 남고 운영이 본다(FAILED로 강제 정산하려면 테넌트 경계가 필요하므로
 * 디스패치 범위에서 할 수 있는 일이 아니다).
 */
export async function sweepStaleRunning(
  client: PoolClient,
  leaseTimeoutMs: number,
  batchSize: number,
  maxAttempts: number,
): Promise<ClaimedExport[]> {
  const res = await client.query(
    `UPDATE export_job SET status = 'RUNNING', started_at = now(),
                           attempt_no = attempt_no + 1
      WHERE export_id IN (
        SELECT export_id FROM export_job
         WHERE status = 'RUNNING'
           AND started_at IS NOT NULL
           AND started_at < now() - ($1::bigint * interval '1 millisecond')
           AND attempt_no < $3::int
         ORDER BY started_at
         FOR UPDATE SKIP LOCKED
         LIMIT $2
      )
      RETURNING export_id, tenant_id, document_id, revision_id, format`,
    [leaseTimeoutMs, batchSize, maxAttempts],
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
  /**
   * template_profile.unsupported_objects_json — 분류기가 낸 **권위 있는**
   * 미지원 객체 목록(import가 NATIVE_EDIT가 아닌 객체 전량을 넣는다).
   * IR의 보존 블록 등급만 보면 JSON 왕복에서 등급이 빠진 리비전이 조용히
   * "FLATTEN 없음"이 된다(리뷰 M-3).
   */
  unsupportedObjects: unknown;
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
            tp.analysis_status AS verdict,
            tp.unsupported_objects_json AS unsupported_objects
       FROM document d
       LEFT JOIN file_object f ON f.file_id = d.source_file_id
       JOIN document_revision r ON r.revision_id = $2 AND r.document_id = d.document_id
       LEFT JOIN LATERAL (
         SELECT ir_json FROM document_revision
          WHERE document_id = d.document_id AND origin = 'IMPORT'
          ORDER BY revision_no LIMIT 1
       ) base ON true
       LEFT JOIN LATERAL (
         SELECT analysis_status, unsupported_objects_json FROM template_profile
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
    unsupportedObjects: row.unsupported_objects ?? null,
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
    // upload_state는 VERIFIED다 — 산출물 바이트를 워커가 직접 만들고 해시를
    // 계산했으므로 검증된 것이 사실이며, 0022의 백필이 기존 행에 내린 판단과
    // 같다. 기본값(PENDING)에 맡기면 모든 신규 산출물이 "미완료 업로드"로
    // 남아 정리 인덱스에 걸린다(CC-170 리뷰 M-5).
    `INSERT INTO file_object
       (tenant_id, storage_key, original_name, mime_type, size_bytes, sha256,
        scan_status, upload_state, verified_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', 'VERIFIED', now(), $7)
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
