import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

/**
 * 지식문서 저장소 (CC-220).
 *
 * `situation.repository`와 같은 규칙이다 — 모든 질의는 `withTenant` 안에서
 * 돌고 **그 위에 명시적 테넌트 술어를 또 둔다.** 0008의 RLS 정책은 마지막
 * 방어선이지 유일한 방어선이 아니다.
 */

export interface KnowledgeDocumentRow {
  knowledgeDocumentId: string;
  tenantId: string;
  situationId: string | null;
  fileId: string;
  documentType: string;
  providerDocumentId: string | null;
  status: string;
  uniStatus: string | null;
  uniObservedAt: Date | null;
  referenceJson: unknown;
  retentionScope: string;
  sourceSha256: string | null;
  metadataJson: unknown;
  errorJson: unknown;
  attemptCount: number;
  lastAttemptAt: Date | null;
  providerJobId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeFileRow {
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadState: string;
  scanStatus: string;
  storageKey: string;
}

const SELECT_DOC = `
  SELECT knowledge_document_id, tenant_id, situation_id, file_id, document_type,
         provider_document_id, status, uni_status, uni_observed_at, reference_json,
         retention_scope, source_sha256, metadata_json, error_json, attempt_count,
         last_attempt_at, provider_job_id, created_by, created_at, updated_at
    FROM knowledge_document`;

function toDoc(row: Record<string, unknown>): KnowledgeDocumentRow {
  return {
    knowledgeDocumentId: row.knowledge_document_id as string,
    tenantId: row.tenant_id as string,
    situationId: (row.situation_id as string | null) ?? null,
    fileId: row.file_id as string,
    documentType: row.document_type as string,
    providerDocumentId: (row.provider_document_id as string | null) ?? null,
    status: row.status as string,
    uniStatus: (row.uni_status as string | null) ?? null,
    uniObservedAt: (row.uni_observed_at as Date | null) ?? null,
    referenceJson: row.reference_json ?? null,
    retentionScope: row.retention_scope as string,
    sourceSha256: (row.source_sha256 as string | null) ?? null,
    metadataJson: row.metadata_json ?? {},
    errorJson: row.error_json ?? null,
    attemptCount: row.attempt_count as number,
    lastAttemptAt: (row.last_attempt_at as Date | null) ?? null,
    providerJobId: (row.provider_job_id as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

@Injectable()
export class KnowledgeRepository {
  /**
   * 등록 대상 파일. `file_object`의 검증 축과 검사 축을 **둘 다** 읽는다 —
   * 도메인 `checkKnowledgeFile`이 두 축을 따로 판단하기 때문이다.
   */
  async findFile(
    c: PoolClient,
    tenantId: string,
    fileId: string,
  ): Promise<KnowledgeFileRow | null> {
    const r = await c.query(
      `SELECT file_id, original_name, mime_type, size_bytes, sha256,
              upload_state, scan_status, storage_key
         FROM file_object
        WHERE file_id = $1 AND tenant_id = $2`,
      [fileId, tenantId],
    );
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    return {
      fileId: row.file_id as string,
      originalName: row.original_name as string,
      mimeType: row.mime_type as string,
      sizeBytes: Number(row.size_bytes),
      sha256: row.sha256 as string,
      uploadState: row.upload_state as string,
      scanStatus: row.scan_status as string,
      storageKey: row.storage_key as string,
    };
  }

  async findById(
    c: PoolClient,
    tenantId: string,
    id: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<KnowledgeDocumentRow | null> {
    const r = await c.query(
      `${SELECT_DOC} WHERE knowledge_document_id = $1 AND tenant_id = $2${
        opts.forUpdate ? ' FOR UPDATE' : ''
      }`,
      [id, tenantId],
    );
    return r.rowCount === 0 ? null : toDoc(r.rows[0]);
  }

  /**
   * 같은 내용의 자료가 이미 있는가 (US-SIT-009 A-01).
   *
   * 종결된 것(FAILED/CANCELLED)은 세지 않는다 — 실패한 등록을 이유로 다시
   * 올리지 못하게 하면 사용자가 빠져나갈 길이 없다.
   */
  async findLiveDuplicate(
    c: PoolClient,
    tenantId: string,
    sha256: string,
  ): Promise<KnowledgeDocumentRow | null> {
    const r = await c.query(
      `${SELECT_DOC}
        WHERE tenant_id = $1 AND source_sha256 = $2
          AND status NOT IN ('FAILED', 'CANCELLED')
        ORDER BY created_at
        LIMIT 1`,
      [tenantId, sha256],
    );
    return r.rowCount === 0 ? null : toDoc(r.rows[0]);
  }

  async insert(
    c: PoolClient,
    input: {
      tenantId: string;
      situationId: string | null;
      fileId: string;
      documentType: string;
      retentionScope: string;
      sourceSha256: string;
      metadata: unknown;
      createdBy: string;
    },
  ): Promise<KnowledgeDocumentRow> {
    const r = await c.query(
      `INSERT INTO knowledge_document
         (tenant_id, situation_id, file_id, document_type, status, retention_scope,
          source_sha256, metadata_json, created_by)
       VALUES ($1, $2, $3, $4, 'PENDING_UPLOAD', $5, $6, $7::jsonb, $8)
       RETURNING knowledge_document_id, tenant_id, situation_id, file_id, document_type,
                 provider_document_id, status, uni_status, uni_observed_at, reference_json,
                 retention_scope, source_sha256, metadata_json, error_json, attempt_count,
                 last_attempt_at, provider_job_id, created_by, created_at, updated_at`,
      [
        input.tenantId,
        input.situationId,
        input.fileId,
        input.documentType,
        input.retentionScope,
        input.sourceSha256,
        JSON.stringify(input.metadata ?? {}),
        input.createdBy,
      ],
    );
    return toDoc(r.rows[0]);
  }

  /**
   * UNI 전송 잡을 만든다.
   *
   * `provider_code='UNI'`가 워커의 가시 범위를 정한다(0028 §6의 제한 정책).
   * `situation_id`는 nullable이므로 기관 KB 자료도 잡을 가질 수 있다.
   *
   * 요청 조건에 **파일 내용을 넣지 않는다** — 무엇을 보낼지 재현할 수 있는
   * 최소 정보만 남긴다(0026/0027의 보존 정리 대상이기도 하다).
   */
  async insertUploadJob(
    c: PoolClient,
    input: {
      tenantId: string;
      situationId: string | null;
      knowledgeDocumentId: string;
      fileId: string;
      force: boolean;
      correlationId: string;
    },
  ): Promise<string> {
    const r = await c.query(
      `INSERT INTO provider_job
         (tenant_id, batch_id, situation_id, provider_code, request_json, status,
          result_count, correlation_id)
       VALUES ($1, gen_random_uuid(), $2, 'UNI', $3::jsonb, 'QUEUED', 0, $4)
       RETURNING provider_job_id`,
      [
        input.tenantId,
        input.situationId,
        JSON.stringify({
          operation: 'uploadDocument',
          knowledgeDocumentId: input.knowledgeDocumentId,
          fileId: input.fileId,
          force: input.force,
        }),
        input.correlationId,
      ],
    );
    return r.rows[0].provider_job_id as string;
  }

  /**
   * 등록 직후·재시도 시 문서를 잡에 붙이고 시도 횟수를 올린다.
   *
   * **재시도는 두 축을 모두 되돌린다.** 처음에는 `status='REGISTERED'`를
   * 보존했는데(UNI 처리 실패는 등록 자체가 성공한 것이므로) 그 결과 두 가지가
   * 깨졌다 — QA 검토 F4, 실측으로 확인했다.
   *
   *   (1) `uni_status='ERROR'`가 남아 재업로드가 성공해도 문서가 영원히
   *       ERROR에 고정된다. `selectPollTargets`가 ERROR를 제외하므로 다시
   *       관측되지 않고, `isEvidenceEligible`이 영원히 false다 — 재시도가
   *       202를 돌려주고 **아무것도 하지 않는다.**
   *   (2) 상태가 변하지 않으니 `checkKnowledgeRetryable`이 계속 통과해
   *       동시 재시도 둘이 각각 잡을 만든다. 행 잠금은 순서만 정할 뿐
   *       판정 결과를 바꾸지 않는다 → UNI에 같은 문서가 두 벌 생긴다.
   *
   * 그래서 재시도는 언제나 `PENDING_UPLOAD`로 돌아가고 UNI 처리 축을 비운다.
   * 비우는 것이 맞는 이유: 지금부터의 처리상태는 **새 전송의 것**이고, 앞선
   * 전송의 관측값을 남겨 두면 그것이 새 전송의 상태인 것처럼 읽힌다.
   * (`ck_knowledge_document_uni_axis_shape`도 REGISTERED가 아닌 행에
   * `uni_status`가 남는 것을 허용하지 않는다.)
   */
  async attachJob(
    c: PoolClient,
    tenantId: string,
    id: string,
    providerJobId: string,
  ): Promise<KnowledgeDocumentRow> {
    const r = await c.query(
      `UPDATE knowledge_document
          SET provider_job_id = $3,
              attempt_count = attempt_count + 1,
              last_attempt_at = now(),
              error_json = NULL,
              uni_status = NULL,
              uni_observed_at = NULL,
              status = 'PENDING_UPLOAD'
        WHERE knowledge_document_id = $2 AND tenant_id = $1
       RETURNING knowledge_document_id, tenant_id, situation_id, file_id, document_type,
                 provider_document_id, status, uni_status, uni_observed_at, reference_json,
                 retention_scope, source_sha256, metadata_json, error_json, attempt_count,
                 last_attempt_at, provider_job_id, created_by, created_at, updated_at`,
      [tenantId, id, providerJobId],
    );
    return toDoc(r.rows[0]);
  }
}
