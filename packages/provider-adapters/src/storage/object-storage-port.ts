import { createHash } from 'node:crypto';

/**
 * 오브젝트 저장소 포트 (CC-160, ADR-31 / ADR-19 승인 프로필의 "S3 호환 포트").
 *
 * 도메인·API·워커는 이 인터페이스만 안다. S3 SDK 타입은 어댑터 밖으로
 * 나가지 않는다(`.claude/rules/architecture.md`: "Domain services depend on
 * ports/interfaces, never directly on ... storage SDKs").
 *
 * 표면을 좁게 유지한다. 멀티파트·수명주기 정책은 각각 결정이 필요한 주제이고,
 * 쓰지도 않을 표면을 열어 두면 어댑터마다 구현하지 않은 메서드가 생긴다.
 * 다운로드(UNE-DOC-014)는 계약이 바이너리 스트리밍이므로 presign 경로가
 * 아니다 — 감사와 해시 대조를 서버가 해야 하기 때문이다(ADR-31).
 *
 * CC-170이 `presignPut`을 더했다. 업로드는 그 반대다: 설계 10 §2가 "사전등록→
 * **직접 업로드**→완료확정"이고, 바이트를 API가 중계하면 큰 파일에서 API가
 * 병목이 된다. presign을 할 수 없는 어댑터(인메모리)는 예외를 던지지 않고
 * `null`을 돌려준다 — 능력 질문에 능력으로 답하게 하고, 대체 경로(API 전송
 * 라우트)를 고르는 일은 자기 URL을 아는 호출자에게 남긴다(ADR-32).
 */

export interface PutObjectInput {
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType: string;
  /** 원본 파일명 등 진단용 메타데이터. 개인정보를 넣지 않는다. */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface StoredObject {
  readonly key: string;
  readonly sizeBytes: number;
  /** 저장한 바이트의 SHA-256. file_object.sha256의 값이 된다. */
  readonly sha256: string;
}

export interface FetchedObject extends StoredObject {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface PresignPutInput {
  readonly key: string;
  readonly contentType: string;
  /**
   * 클라이언트가 선언한 SHA-256(hex). 서명에 포함되므로 저장소 **자신이**
   * 다른 바이트를 거부한다 — UNE-DOC-002의 재계산은 그와 독립된 두 번째 검사다.
   */
  readonly sha256: string;
  readonly expiresInSeconds: number;
}

export interface PresignedPut {
  readonly url: string;
  /** 서명 대상 헤더. 그대로 붙여야 하며 더하거나 빼면 서명이 깨진다. */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

export interface ObjectStoragePort {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<FetchedObject>;
  head(key: string): Promise<StoredObject | null>;
  /** 보존기간 만료·정리 경로에서만 쓴다. 실패해도 예외를 던지지 않는다. */
  remove(key: string): Promise<void>;
  /** presign을 지원하지 않는 어댑터는 `null`을 돌려준다(예외가 아니다). */
  presignPut(input: PresignPutInput): Promise<PresignedPut | null>;
}

/**
 * 저장소 오류. 호출자는 "없음"과 "실패"를 구분해야 한다 —
 * UNE-DOC-014는 없는 산출물에 410(EXPORT-410-001)을 돌려주고, 저장소 장애는
 * 503이다. 둘을 한 예외로 뭉치면 장애가 "만료됨"으로 보고된다.
 */
export type ObjectStorageErrorKind = 'NOT_FOUND' | 'UNAVAILABLE' | 'REJECTED';

export class ObjectStorageError extends Error {
  readonly kind: ObjectStorageErrorKind;
  readonly key: string;

  constructor(kind: ObjectStorageErrorKind, key: string, message: string, cause?: unknown) {
    super(`${kind} ${key}: ${message}`);
    this.name = 'ObjectStorageError';
    this.kind = kind;
    this.key = key;
    if (cause !== undefined) this.cause = cause;
  }
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * 키 설계: `tenants/{tenantId}/exports/{exportId}/{sha256}.{ext}`.
 *
 * 테넌트를 **접두사에** 둔다. DB의 RLS와 별개로 저장소 층에서도 경계가
 * 보여야, 버킷 정책이나 사고 조사에서 "이 객체는 누구 것인가"를 경로만으로
 * 답할 수 있다. 해시를 파일명에 두면 같은 내용을 두 번 올려도 같은 키가 되어
 * 재시도가 자연히 멱등해진다.
 */
export function exportObjectKey(input: {
  readonly tenantId: string;
  readonly exportId: string;
  readonly sha256: string;
  readonly extension: string;
}): string {
  assertSafeSegment(input.tenantId, 'tenantId');
  assertSafeSegment(input.exportId, 'exportId');
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new ObjectStorageError('REJECTED', '(key)', `sha256 형식이 아닙니다: ${input.sha256}`);
  }
  if (!/^[a-z0-9]{1,8}$/.test(input.extension)) {
    throw new ObjectStorageError('REJECTED', '(key)', `확장자 형식이 아닙니다: ${input.extension}`);
  }
  return `tenants/${input.tenantId}/exports/${input.exportId}/${input.sha256}.${input.extension}`;
}

/**
 * 원본 HWPX 키: `tenants/{tenantId}/sources/{sha256}.{ext}`.
 *
 * Export 산출물과 같은 규칙이되 `exports/` 대신 `sources/`다. 해시가 파일명
 * 이므로 같은 파일을 여러 문서가 가져와도 객체는 하나이고, 재업로드가 자연히
 * 멱등해진다(같은 키에 같은 바이트).
 */
export function sourceObjectKey(input: {
  readonly tenantId: string;
  readonly sha256: string;
  readonly extension: string;
}): string {
  assertSafeSegment(input.tenantId, 'tenantId');
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new ObjectStorageError('REJECTED', '(key)', `sha256 형식이 아닙니다: ${input.sha256}`);
  }
  if (!/^[a-z0-9]{1,8}$/.test(input.extension)) {
    throw new ObjectStorageError('REJECTED', '(key)', `확장자 형식이 아닙니다: ${input.extension}`);
  }
  return `tenants/${input.tenantId}/sources/${input.sha256}.${input.extension}`;
}

/**
 * 업로드 키: `tenants/{tenantId}/sources/{fileId}/{sha256}.{ext}`.
 *
 * **fileId로 격리한다.** 사전등록 시점의 해시는 클라이언트의 선언일 뿐
 * 검증되지 않았고, 검증되지 않은 바이트를 내용 주소 키(`sources/{sha256}`)에
 * 올리면 "키가 곧 내용"이라는 전제가 깨진다 — 다른 흐름이 같은 해시를 선언했을
 * 때 서로의 바이트를 보게 된다. 파일명에 선언 해시를 남기는 것은 진단용이며,
 * 불일치는 UNE-DOC-002가 잡는다(ADR-32 D5).
 *
 * 접두사는 `uploads/`가 아니라 `sources/`다. 검증을 통과한 이 객체가 문서의
 * **영구 원본**이 되고 보존 Export가 계속 읽는다 — `uploads/`라는 이름은
 * 수명주기 규칙이나 정리 배치에 "스테이징"으로 읽혀 원본이 사라질 수 있다
 * (CC-160이 `source_file_id` NULL로 이미 겪은 실패 유형, 리뷰 M-4).
 */
export function uploadObjectKey(input: {
  readonly tenantId: string;
  readonly fileId: string;
  readonly sha256: string;
  readonly extension: string;
}): string {
  assertSafeSegment(input.tenantId, 'tenantId');
  assertSafeSegment(input.fileId, 'fileId');
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new ObjectStorageError('REJECTED', '(key)', `sha256 형식이 아닙니다: ${input.sha256}`);
  }
  if (!/^[a-z0-9]{1,8}$/.test(input.extension)) {
    throw new ObjectStorageError('REJECTED', '(key)', `확장자 형식이 아닙니다: ${input.extension}`);
  }
  return `tenants/${input.tenantId}/sources/${input.fileId}/${input.sha256}.${input.extension}`;
}

/**
 * 키 세그먼트 검증. UUID만 통과시킨다.
 *
 * 저장소 키는 사용자 입력이 닿는 경로다. `../`나 `/`가 섞이면 테넌트 접두사를
 * 벗어난 키를 만들 수 있고, 그 순간 접두사 격리가 장식이 된다.
 */
function assertSafeSegment(value: string, label: string): void {
  if (!/^[0-9a-fA-F-]{36}$/.test(value)) {
    throw new ObjectStorageError('REJECTED', '(key)', `${label}가 UUID 형식이 아닙니다`);
  }
}
