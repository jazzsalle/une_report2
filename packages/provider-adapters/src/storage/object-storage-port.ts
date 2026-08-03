import { createHash } from 'node:crypto';

/**
 * 오브젝트 저장소 포트 (CC-160, ADR-31 / ADR-19 승인 프로필의 "S3 호환 포트").
 *
 * 도메인·API·워커는 이 인터페이스만 안다. S3 SDK 타입은 어댑터 밖으로
 * 나가지 않는다(`.claude/rules/architecture.md`: "Domain services depend on
 * ports/interfaces, never directly on ... storage SDKs").
 *
 * 표면을 넷으로 좁힌 이유. 지금 필요한 것은 "산출물을 넣고, 다운로드로 내주고,
 * 있는지 확인한다"뿐이다. presigned URL·멀티파트·수명주기 정책은 각각 결정이
 * 필요한 주제이고(설계 §7502의 Presigned URL은 UNE-DOC-014가 바이너리
 * 스트리밍으로 계약돼 있어 지금 경로가 아니다), 쓰지도 않을 표면을 열어 두면
 * 어댑터마다 구현하지 않은 메서드가 생긴다.
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

export interface ObjectStoragePort {
  put(input: PutObjectInput): Promise<StoredObject>;
  get(key: string): Promise<FetchedObject>;
  head(key: string): Promise<StoredObject | null>;
  /** 보존기간 만료·정리 경로에서만 쓴다. 실패해도 예외를 던지지 않는다. */
  remove(key: string): Promise<void>;
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
