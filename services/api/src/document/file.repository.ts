import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * file_object 접근 (CC-170 UNE-DOC-001/002).
 *
 * 0021 §2가 앱 롤의 UPDATE를 컬럼 단위로 회수했고 0022가 `upload_state`/
 * `verified_at`만 다시 열었다. 그래서 이 저장소에는 `sha256`이나 `storage_key`를
 * 바꾸는 메서드가 **없다** — 있어도 DB가 거부하지만, 없는 것이 의도를 말한다.
 */

export interface FileObjectRow {
  fileId: string;
  tenantId: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadState: 'PENDING' | 'VERIFIED' | 'ABORTED';
  scanStatus: string;
  verifiedAt: Date | null;
  createdBy: string;
  createdAt: Date;
}

const COLUMNS = `file_id, tenant_id, storage_key, original_name, mime_type,
                 size_bytes, sha256, upload_state, scan_status, verified_at,
                 created_by, created_at`;

function toRow(row: Record<string, unknown>): FileObjectRow {
  return {
    fileId: row.file_id as string,
    tenantId: row.tenant_id as string,
    storageKey: row.storage_key as string,
    originalName: row.original_name as string,
    mimeType: row.mime_type as string,
    // bigint는 드라이버가 문자열로 준다. Number로 좁히는 것은 안전하다 —
    // 업로드 상한이 Number.MAX_SAFE_INTEGER보다 몇 자리 작다.
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256 as string,
    uploadState: row.upload_state as FileObjectRow['uploadState'],
    scanStatus: row.scan_status as string,
    verifiedAt: (row.verified_at as Date | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
  };
}

@Injectable()
export class FileRepository {
  async insert(
    client: PoolClient,
    input: {
      fileId: string;
      tenantId: string;
      storageKey: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      createdBy: string;
    },
  ): Promise<FileObjectRow> {
    const res = await client.query(
      `INSERT INTO file_object
         (file_id, tenant_id, storage_key, original_name, mime_type, size_bytes,
          sha256, scan_status, upload_state, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', 'PENDING', $8)
       RETURNING ${COLUMNS}`,
      [
        input.fileId,
        input.tenantId,
        input.storageKey,
        input.originalName,
        input.mimeType,
        input.sizeBytes,
        input.sha256,
        input.createdBy,
      ],
    );
    return toRow(res.rows[0] as Record<string, unknown>);
  }

  /**
   * `forUpdate`는 완료 확정 경로에서 쓴다. 같은 파일에 두 번 완료가 들어오면
   * 하나만 검증을 통과해 상태를 옮기고 나머지는 옮겨진 상태를 본다.
   */
  async find(
    client: PoolClient,
    tenantId: string,
    fileId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<FileObjectRow | null> {
    const res = await client.query(
      `SELECT ${COLUMNS} FROM file_object
        WHERE file_id = $1 AND tenant_id = $2
        ${options.forUpdate ? 'FOR UPDATE' : ''}`,
      [fileId, tenantId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toRow(row) : null;
  }

  /** PENDING → VERIFIED. 0022 ck_file_object_verified_shape가 모양을 잡는다. */
  async markVerified(
    client: PoolClient,
    tenantId: string,
    fileId: string,
  ): Promise<FileObjectRow | null> {
    const res = await client.query(
      `UPDATE file_object
          SET upload_state = 'VERIFIED', verified_at = now()
        WHERE file_id = $1 AND tenant_id = $2 AND upload_state = 'PENDING'
        RETURNING ${COLUMNS}`,
      [fileId, tenantId],
    );
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row ? toRow(row) : null;
  }

  /** PENDING → ABORTED. 종단이며 되돌리지 않는다. */
  async markAborted(client: PoolClient, tenantId: string, fileId: string): Promise<void> {
    await client.query(
      `UPDATE file_object SET upload_state = 'ABORTED'
        WHERE file_id = $1 AND tenant_id = $2 AND upload_state = 'PENDING'`,
      [fileId, tenantId],
    );
  }
}
