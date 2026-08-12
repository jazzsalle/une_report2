import type { PoolClient } from 'pg';

/**
 * 지식문서 UNI 전송의 SQL 경계 (CC-220, ADR-27 D1).
 *
 * 스코프가 두 가지로 갈린다.
 *   - **디스패치 스코프**(테넌트 미설정): 잡을 집는다. 0028 §6의 워커 정책이
 *     `provider_code='UNI'`이고 미종결인 행만 보여준다.
 *   - **테넌트 스코프**: 문서·파일을 읽고 결과를 쓴다. `file_object`와
 *     `knowledge_document`의 테넌트 정책이 TO PUBLIC이라 디스패치 스코프에서는
 *     0행이므로, 실제 작업은 반드시 테넌트를 세우고 한다(0015가 세운 형태와 같다).
 */

export interface ClaimedUploadJob {
  providerJobId: string;
  tenantId: string;
  knowledgeDocumentId: string;
  fileId: string;
  force: boolean;
  correlationId: string;
}

export interface UploadTarget {
  knowledgeDocumentId: string;
  status: string;
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdBy: string;
}

/**
 * QUEUED 잡을 하나 집어 RUNNING으로 올린다.
 *
 * **`operation`으로 거른다.** `provider_code='UNI'`만 보면 CC-240의 SOP 생성
 * 잡까지 이 러너가 집어 간다 — ADR-36 D4가 "CC-240도 같은 원장을 쓴다"를
 * 근거로 이 경계를 택했으므로 그날이 반드시 온다. 걸러 내지 않으면 남의 잡을
 * 집어 `knowledgeDocumentId`가 없는 채로 실패하고, 그 잡은 RUNNING에 갇힌다.
 *
 * `FOR UPDATE SKIP LOCKED`는 저장소의 다른 네 파이프라인과 같은 이유다 —
 * 레플리카 둘이 같은 잡을 집으면 UNI에 같은 문서가 두 벌 올라간다. 업로드는
 * 멱등키가 없으므로(OB-13) 그 중복을 사후에 되돌릴 방법이 없다.
 */
export async function claimUploadJob(c: PoolClient): Promise<ClaimedUploadJob | null> {
  const r = await c.query(
    `UPDATE provider_job
        SET status = 'RUNNING'
      WHERE provider_job_id = (
        SELECT provider_job_id FROM provider_job
         WHERE provider_code = 'UNI' AND status = 'QUEUED'
           AND request_json->>'operation' = 'uploadDocument'
         ORDER BY created_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
    RETURNING provider_job_id, tenant_id, request_json, correlation_id`,
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  const req = (row.request_json ?? {}) as Record<string, unknown>;
  // 잡을 이미 RUNNING으로 올렸으므로 여기서 던지면 그 잡이 갇힌다. 모양이
  // 틀린 요청은 호출부가 잡 단위로 종결할 수 있도록 빈 값으로 넘긴다.
  const docId = typeof req.knowledgeDocumentId === 'string' ? req.knowledgeDocumentId : '';
  return {
    providerJobId: row.provider_job_id as string,
    tenantId: row.tenant_id as string,
    knowledgeDocumentId: docId,
    fileId: typeof req.fileId === 'string' ? req.fileId : '',
    force: req.force === true,
    correlationId: (row.correlation_id as string) ?? '',
  };
}

/** 테넌트 스코프에서 문서와 파일 메타를 읽는다. */
export async function loadUploadTarget(
  c: PoolClient,
  tenantId: string,
  knowledgeDocumentId: string,
): Promise<UploadTarget | null> {
  const r = await c.query(
    `SELECT k.knowledge_document_id, k.status, k.file_id, k.created_by,
            f.original_name, f.mime_type, f.size_bytes, f.storage_key
       FROM knowledge_document k
       JOIN file_object f ON f.file_id = k.file_id
      WHERE k.knowledge_document_id = $1 AND k.tenant_id = $2`,
    [knowledgeDocumentId, tenantId],
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return {
    knowledgeDocumentId: row.knowledge_document_id as string,
    status: row.status as string,
    fileId: row.file_id as string,
    originalName: row.original_name as string,
    mimeType: row.mime_type as string,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key as string,
    createdBy: row.created_by as string,
  };
}

/** 문서를 UPLOADING으로 옮긴다 — 화면이 "보내는 중"을 볼 수 있어야 한다. */
export async function markUploading(
  c: PoolClient,
  tenantId: string,
  knowledgeDocumentId: string,
): Promise<void> {
  await c.query(
    `UPDATE knowledge_document SET status = 'UPLOADING'
      WHERE knowledge_document_id = $1 AND tenant_id = $2 AND status = 'PENDING_UPLOAD'`,
    [knowledgeDocumentId, tenantId],
  );
}

/**
 * Provider 원문을 남긴다. **잡을 종결하기 전에** 불러야 한다 —
 * 0028 §6의 INSERT 정책이 미종결 잡만 보이게 하고, 그 순서가 "성공했다는데
 * 원문이 없는" 행을 막는다.
 */
export async function insertProviderResult(
  c: PoolClient,
  providerJobId: string,
  payload: unknown,
  sha256: string,
  itemCount: number,
): Promise<void> {
  await c.query(
    `INSERT INTO provider_result
       (provider_job_id, seq, raw_payload_json, payload_sha256, item_count)
     VALUES ($1, 1, $2::jsonb, $3, $4)`,
    [providerJobId, JSON.stringify(payload ?? null), sha256, itemCount],
  );
}

/** 등록 성공 — UNI가 doc_id를 돌려줬다. */
export async function settleRegistered(
  c: PoolClient,
  tenantId: string,
  knowledgeDocumentId: string,
  providerJobId: string,
  providerDocumentId: string,
): Promise<void> {
  await c.query(
    `UPDATE knowledge_document
        SET status = 'REGISTERED', provider_document_id = $3, error_json = NULL
      WHERE knowledge_document_id = $1 AND tenant_id = $2`,
    [knowledgeDocumentId, tenantId, providerDocumentId],
  );
  await c.query(
    `UPDATE provider_job
        SET status = 'SUCCEEDED', result_count = 1, finished_at = now()
      WHERE provider_job_id = $1`,
    [providerJobId],
  );
}

/**
 * 전송 실패.
 *
 * `sideEffectUncertain`을 오류에 함께 남긴다 — 재시도가 UNI에 같은 문서를 두 벌
 * 만들 수 있는지는 사람이 판단해야 하고, 그 판단의 근거가 여기 없으면 화면이
 * 아무 말도 할 수 없다.
 */
export async function settleFailed(
  c: PoolClient,
  tenantId: string,
  knowledgeDocumentId: string,
  providerJobId: string,
  error: { code: string; message: string; retryable: boolean; sideEffectUncertain: boolean },
): Promise<void> {
  const payload = JSON.stringify(error);
  await c.query(
    `UPDATE knowledge_document
        SET status = 'FAILED', error_json = $3::jsonb
      WHERE knowledge_document_id = $1 AND tenant_id = $2`,
    [knowledgeDocumentId, tenantId, payload],
  );
  await c.query(
    `UPDATE provider_job
        SET status = 'FAILED', result_count = 0, error_json = $2::jsonb, finished_at = now()
      WHERE provider_job_id = $1`,
    [providerJobId, payload],
  );
}

/**
 * 문서를 가리키지 못하는 잡을 종결한다.
 *
 * `settleFailed`는 문서와 잡을 함께 닫지만, `request_json`이 망가져
 * `knowledgeDocumentId`가 없으면 닫을 문서가 없다. 그때 아무것도 하지 않으면
 * 잡이 RUNNING에 영구히 갇힌다.
 */
export async function settleJobFailed(
  c: PoolClient,
  providerJobId: string,
  error: { code: string; message: string },
): Promise<void> {
  await c.query(
    `UPDATE provider_job
        SET status = 'FAILED', result_count = 0, error_json = $2::jsonb, finished_at = now()
      WHERE provider_job_id = $1`,
    [providerJobId, JSON.stringify(error)],
  );
}

/**
 * 참조요약을 아직 받지 못한 문서 (US-SIT-010 4단계 "reference metadata 저장").
 *
 * **CC-220·CC-230에서 두 번 미뤘다.** ADR-36 수용 한계 2가 "CC-230에서 근거와
 * 함께 온다"고 적었고 ADR-37 수용 한계 3이 다시 CC-240으로 넘겼다. 세 번째
 * 이월은 설계 결함 신호이므로 여기서 닫는다.
 *
 * `READY`인데 `reference_json`이 비어 있는 것만 고른다 — 참조요약은 색인이
 * 끝난 뒤에 생기고(설계 08 §1.9), 한 번 받으면 다시 물을 이유가 없다.
 */
export async function selectReferenceTargets(c: PoolClient, limit: number): Promise<PollTarget[]> {
  const r = await c.query(
    `SELECT knowledge_document_id, tenant_id, provider_document_id, uni_status
       FROM knowledge_document
      WHERE status = 'REGISTERED' AND uni_status = 'READY'
        AND provider_document_id IS NOT NULL
        AND reference_json IS NULL
      ORDER BY uni_observed_at NULLS FIRST
      LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    knowledgeDocumentId: row.knowledge_document_id as string,
    tenantId: row.tenant_id as string,
    providerDocumentId: row.provider_document_id as string,
    uniStatus: (row.uni_status as string | null) ?? null,
  }));
}

/**
 * 참조요약을 기록한다.
 *
 * **아직 준비되지 않은 경우(202)는 쓰지 않는다.** 빈 객체를 넣으면
 * `reference_json IS NULL` 조건이 거짓이 되어 다시는 묻지 않게 된다 —
 * "받았다"와 "아직이다"를 구분할 수 없어진다.
 */
export async function recordReference(
  c: PoolClient,
  tenantId: string,
  knowledgeDocumentId: string,
  reference: unknown,
): Promise<void> {
  await c.query(
    `UPDATE knowledge_document SET reference_json = $3::jsonb
      WHERE knowledge_document_id = $1 AND tenant_id = $2 AND status = 'REGISTERED'`,
    [knowledgeDocumentId, tenantId, JSON.stringify(reference)],
  );
}

export interface PollTarget {
  knowledgeDocumentId: string;
  tenantId: string;
  providerDocumentId: string;
  uniStatus: string | null;
}

/**
 * 처리상태를 더 물어봐야 하는 문서들 (US-SIT-010).
 *
 * 종결 상태(READY/ERROR)는 제외한다 — 다시 물어도 바뀌지 않고, 물으면 UNI에
 * 쓸모없는 부하만 준다. 디스패치 스코프에서 전 테넌트를 훑는다.
 */
export async function selectPollTargets(c: PoolClient, limit: number): Promise<PollTarget[]> {
  const r = await c.query(
    `SELECT knowledge_document_id, tenant_id, provider_document_id, uni_status
       FROM knowledge_document
      WHERE status = 'REGISTERED'
        AND provider_document_id IS NOT NULL
        AND (uni_status IS NULL OR uni_status NOT IN ('READY', 'ERROR'))
      ORDER BY uni_observed_at NULLS FIRST
      LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({
    knowledgeDocumentId: row.knowledge_document_id as string,
    tenantId: row.tenant_id as string,
    providerDocumentId: row.provider_document_id as string,
    uniStatus: (row.uni_status as string | null) ?? null,
  }));
}

/**
 * 관측한 처리상태를 기록한다.
 *
 * `uni_observed_at`을 **관측할 때마다** 갱신한다. 상태가 그대로여도 갱신한다 —
 * "언제 마지막으로 확인했는가"가 US-SIT-010 E-01(PROCESSING_TIMEOUT)의 판정
 * 근거이고, 상태가 바뀔 때만 적으면 멈춰 있는 문서와 확인하지 않은 문서를
 * 구분할 수 없다.
 */
export async function recordUniStatus(
  c: PoolClient,
  tenantId: string,
  knowledgeDocumentId: string,
  uniStatus: string,
): Promise<void> {
  await c.query(
    `UPDATE knowledge_document
        SET uni_status = $3, uni_observed_at = now()
      WHERE knowledge_document_id = $1 AND tenant_id = $2 AND status = 'REGISTERED'`,
    [knowledgeDocumentId, tenantId, uniStatus],
  );
}
