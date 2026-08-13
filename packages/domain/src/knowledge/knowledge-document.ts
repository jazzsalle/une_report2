/**
 * 지식문서(훈련·매뉴얼 자료)의 어휘와 상태 규칙 (CC-220).
 *
 * 설계 06 US-SIT-009(업로드·보존범위)·US-SIT-010(비동기 학습상태), 설계 08
 * §1.9(UNI 문서 업로드·학습 수명주기), 설계 10 UNE-KNOW-001~003.
 *
 * **상태를 두 축으로 나눈다.** 0004의 `knowledge_document.status`는 주석이
 * "UPLOADING~FAILED"라고만 적혀 있고, 설계 06은 서로 다른 두 계열을 말한다.
 *
 *   US-SIT-009 상태전이: LOCAL_VALIDATED → UPLOADING → QUEUED/ERROR
 *   US-SIT-010 상태전이: QUEUED → … → READY/ERROR/CANCELLED
 *
 * 앞은 **UNE가 아는 사실**(파일을 검증했고 UNI에 보냈다)이고 뒤는 **UNI가
 * 알려준 사실**(파싱·색인·참조생성이 어디까지 갔다)이다. 한 컬럼에 밀어 넣으면
 * "우리가 보냈다"와 "저쪽이 처리했다"를 구분할 수 없고, 특히 UNI가 응답하지
 * 않을 때 무엇이 참인지 말할 수 없게 된다. ADR-32 D3이 `scan_status`와
 * `upload_state`를 가른 것과 같은 판단이다 — 하지 않은 검사를 했다고 적지
 * 않는다.
 *
 * 그래서 `status`(UNE 등록 축)와 `uniStatus`(UNI 처리 축)를 따로 둔다.
 * `uniStatus`는 UNI가 doc_id를 돌려주기 전까지 `null`이며, 그 `null`은
 * "아직 모른다"이지 "처리되지 않았다"가 아니다.
 */

/** UNE 등록 축 — 우리가 아는 사실만 적는다. */
export const KNOWLEDGE_DOCUMENT_STATUSES = [
  'PENDING_UPLOAD', // 파일 검증까지 끝났고 UNI 전송을 기다린다 (US-SIT-009 LOCAL_VALIDATED)
  'UPLOADING', // 워커가 UNI에 보내는 중이다
  'REGISTERED', // UNI가 doc_id를 돌려줬다 — 여기서부터 uniStatus가 의미를 갖는다
  'FAILED', // 전송이 끝내 실패했다 (US-SIT-009 E-02 UPLOAD_ERROR)
  'CANCELLED', // 사용자가 연결을 끊었다 (US-SIT-010 A-02)
] as const;

export type KnowledgeDocumentStatus = (typeof KNOWLEDGE_DOCUMENT_STATUSES)[number];

/**
 * UNI 처리 축 — 설계 08 §1.9가 적은 어휘 그대로다. UNE가 만들어 낸 값이
 * 아니라 **UNI가 돌려준 문자열의 사본**이므로 여기에 UNE 고유 상태를 섞지
 * 않는다. 모르는 값이 오면 매핑하지 않고 원문을 보존한 채 거부한다.
 */
export const UNI_PROCESSING_STATUSES = [
  'QUEUED',
  'PARSING',
  'INDEXING',
  'REFERENCE_GENERATING',
  'READY',
  'ERROR',
] as const;

export type UniProcessingStatus = (typeof UNI_PROCESSING_STATUSES)[number];

/** 설계 06 US-SIT-009 목적문의 자료 종류. */
export const KNOWLEDGE_DOCUMENT_TYPES = [
  'MANUAL', // 매뉴얼
  'TRAINING_PLAN', // 훈련계획서
  'EVALUATION_GUIDE', // 평가지침
  'MESSAGE_LIST', // 메시지 목록
  'MISSION_CARD', // 기관 임무카드
] as const;

export type KnowledgeDocumentType = (typeof KNOWLEDGE_DOCUMENT_TYPES)[number];

/**
 * 보존범위 (US-SIT-009 입력 `scope`, 완료조건 "무단 장기보존 0건").
 *
 * `THIS_INCIDENT`가 기본이다. `ORG_KB`는 **여기서 만들 수 없다** — US-SIT-009
 * A-02가 기관 KB 승격을 별도 승인 워크플로로 정했고 5단계가 "기관 KB 자동승격
 * 금지"를 명시한다. 어휘에는 두되 등록 시 선택은 막는다(아래 `isScopeSelectableAtUpload`).
 */
export const RETENTION_SCOPES = ['THIS_INCIDENT', 'PROJECT', 'ORG_KB'] as const;

export type RetentionScope = (typeof RETENTION_SCOPES)[number];

export function isKnowledgeDocumentStatus(v: unknown): v is KnowledgeDocumentStatus {
  return (KNOWLEDGE_DOCUMENT_STATUSES as readonly unknown[]).includes(v);
}

export function isUniProcessingStatus(v: unknown): v is UniProcessingStatus {
  return (UNI_PROCESSING_STATUSES as readonly unknown[]).includes(v);
}

export function isKnowledgeDocumentType(v: unknown): v is KnowledgeDocumentType {
  return (KNOWLEDGE_DOCUMENT_TYPES as readonly unknown[]).includes(v);
}

export function isRetentionScope(v: unknown): v is RetentionScope {
  return (RETENTION_SCOPES as readonly unknown[]).includes(v);
}

/** 등록 시점에 사용자가 고를 수 있는 보존범위. `ORG_KB`는 승인 절차를 거친다. */
export function isScopeSelectableAtUpload(scope: RetentionScope): boolean {
  return scope !== 'ORG_KB';
}

/** UNE 등록 축의 종결 상태 — 더 이상 워커가 건드리지 않는다. */
export function isTerminalKnowledgeStatus(status: KnowledgeDocumentStatus): boolean {
  return status === 'FAILED' || status === 'CANCELLED';
}

/**
 * SOP 근거로 쓸 수 있는가.
 *
 * US-SIT-010 완료조건이 "READY 아닌 자료가 Evidence에 포함된 건 0"이다. 두 축이
 * **모두** 맞아야 한다 — UNI가 READY라고 해도 UNE 쪽에서 취소된 문서는 근거가
 * 아니고, 등록이 끝났어도 UNI가 아직 색인 중이면 검색에 걸리지 않는다.
 *
 * CC-230(EvidenceSet)이 이 함수를 게이트로 쓴다.
 */
export function isEvidenceEligible(
  status: KnowledgeDocumentStatus,
  uniStatus: UniProcessingStatus | null,
): boolean {
  return status === 'REGISTERED' && uniStatus === 'READY';
}

/**
 * 참조요약 없이도 검색은 가능한가 (US-SIT-010 A-01 READY_WITHOUT_REFERENCE).
 *
 * `REFERENCE_GENERATING`은 색인이 끝난 뒤 단계다. 참조요약이 늦어진다고 검색을
 * 막으면 A-01이 요구한 "별도 판정"이 되지 않는다.
 */
export function isSearchableWithoutReference(
  status: KnowledgeDocumentStatus,
  uniStatus: UniProcessingStatus | null,
): boolean {
  return status === 'REGISTERED' && (uniStatus === 'READY' || uniStatus === 'REFERENCE_GENERATING');
}

export type KnowledgeRetryBlocker =
  | 'NOT_FAILED' // 실패하지 않은 것을 다시 보낼 이유가 없다
  | 'CANCELLED' // 사용자가 끊은 것은 재시도가 아니라 재등록이다
  | 'ATTEMPTS_EXHAUSTED';

/**
 * 재시도 가능한가 (UNE-KNOW-003).
 *
 * 두 갈래가 재시도 대상이다 — **전송이 실패한 것**(`status='FAILED'`)과
 * **UNI가 처리에 실패한 것**(`uniStatus='ERROR'`, US-SIT-010 E-02). 뒤엣것은
 * 등록 자체는 성공했으므로 `status`가 `REGISTERED`인 채로 재시도한다.
 *
 * 성공한 것을 다시 보내면 UNI에 같은 문서가 두 벌 생긴다 — `force` 없이는
 * 막는다.
 */
export function checkKnowledgeRetryable(
  status: KnowledgeDocumentStatus,
  uniStatus: UniProcessingStatus | null,
  attemptCount: number,
  maxAttempts: number,
): KnowledgeRetryBlocker | null {
  if (status === 'CANCELLED') return 'CANCELLED';
  const transportFailed = status === 'FAILED';
  const providerFailed = status === 'REGISTERED' && uniStatus === 'ERROR';
  if (!transportFailed && !providerFailed) return 'NOT_FAILED';
  if (attemptCount >= maxAttempts) return 'ATTEMPTS_EXHAUSTED';
  return null;
}

export type KnowledgeFileBlocker =
  | 'NOT_VERIFIED' // 업로드 검증(UNE-DOC-002)을 통과하지 않았다
  | 'INFECTED' // 악성코드 판정 (US-SIT-009 E-01)
  | 'SCAN_PENDING' // OB-15 — 검사기가 없어 판정이 없다
  | 'TOO_LARGE'
  | 'MIME_NOT_ALLOWED'
  | 'PURPOSE_MISMATCH'; // OB-19 — 지식문서 용도로 등록된 파일이 아니다

/**
 * 업로드 전 파일 검사 (US-SIT-009 2단계 "악성코드·MIME·hash·중복", E-01).
 *
 * `SCAN_PENDING`을 **통과로 처리하지 않는다.** OB-15로 AV 엔진이 아직 없어
 * `scan_status`는 영구 PENDING이며, 그것을 통과로 보면 "검사했다"가 감사에
 * 남는다(ADR-32 D3이 같은 이유로 축을 갈랐다). 대신 운영 설정으로 이 판정을
 * 완화할 수 있게 두고, 완화했다는 사실 자체가 설정에 남는다.
 */
export function checkKnowledgeFile(
  file: {
    uploadState: string;
    scanStatus: string;
    sizeBytes: number;
    mimeType: string;
    /**
     * 등록 용도 (OB-19). 지금까지 파일 행이 이것을 기억하지 않아, 계획서
     * 양식으로 올라온 HWPX를 지식문서로 등록할 수 있었다 — MIME 정책만으로는
     * 못 막는다(HWPX가 지식문서 허용 목록에 들어가면 통과한다).
     *
     * 선택값으로 둔다. 호출자가 주지 않으면 이 검사를 건너뛴다 — 0049 이전에
     * 만들어진 행을 다루는 경로가 아직 있을 수 있다.
     */
    purpose?: string;
  },
  policy: {
    maxSizeBytes: number;
    allowedMimeTypes: ReadonlySet<string>;
    allowScanPending: boolean;
  },
): KnowledgeFileBlocker | null {
  if (file.purpose !== undefined && file.purpose !== 'KNOWLEDGE_DOCUMENT') {
    return 'PURPOSE_MISMATCH';
  }
  if (file.scanStatus === 'INFECTED') return 'INFECTED';
  if (file.uploadState !== 'VERIFIED') return 'NOT_VERIFIED';
  if (file.scanStatus !== 'CLEAN' && !policy.allowScanPending) return 'SCAN_PENDING';
  if (file.sizeBytes > policy.maxSizeBytes) return 'TOO_LARGE';
  if (!policy.allowedMimeTypes.has(file.mimeType)) return 'MIME_NOT_ALLOWED';
  return null;
}

/**
 * UNI 상태 폴링 간격 (설계 08 §1.14 "UNI Reference Poll 최대 5분, 2/4/8/15초").
 *
 * 네 번째 이후는 15초를 유지한다. 설계가 적은 것은 초반 backoff이고 상한은
 * 전체 5분이다.
 */
export const UNI_POLL_BACKOFF_MS = [2_000, 4_000, 8_000, 15_000] as const;
export const UNI_POLL_MAX_ELAPSED_MS = 5 * 60 * 1000;

export function uniPollDelayMs(attempt: number): number {
  const i = Math.min(Math.max(attempt, 0), UNI_POLL_BACKOFF_MS.length - 1);
  return UNI_POLL_BACKOFF_MS[i];
}

/**
 * 폴링을 그만둘 때인가 (US-SIT-010 E-01 PROCESSING_TIMEOUT).
 *
 * 시간이 다 됐다고 문서를 ERROR로 바꾸지 않는다 — UNI는 여전히 처리 중일 수
 * 있고, 우리가 모르는 것을 실패로 적으면 그것도 하지 않은 판정이다. 상태는
 * 마지막으로 **관측한** 값에 머물고 화면이 "UNKNOWN, 수동 새로고침"을 말한다.
 */
export function isPollExhausted(elapsedMs: number): boolean {
  return elapsedMs >= UNI_POLL_MAX_ELAPSED_MS;
}
