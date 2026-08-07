import {
  ObjectStorageError,
  sha256Of,
  type FetchedObject,
  type ObjectStoragePort,
  type PresignPutInput,
  type PutObjectInput,
  type StoredObject,
} from './object-storage-port';

/**
 * 인메모리 어댑터 (테스트·로컬 전용).
 *
 * 단위 테스트와 API/워커 e2e가 MinIO 없이 돌 수 있어야 한다. 저장소를
 * 띄우지 않으면 실행되지 않는 테스트는 결국 CI에서 조용히 건너뛰게 되고,
 * 그 순간 Export 경로에 회귀 그물이 사라진다.
 *
 * **운영 경로에서 쓰지 않는다.** 팩토리가 `STORAGE_DRIVER=memory`일 때만
 * 만들고, 그 값은 운영 설정에 존재하지 않는다.
 */
export class MemoryObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<
    string,
    { body: Uint8Array; contentType: string; sha256: string }
  >();

  /** 장애 경로 테스트용. 켜면 모든 호출이 UNAVAILABLE로 실패한다. */
  unavailable = false;

  put(input: PutObjectInput): Promise<StoredObject> {
    this.guard(input.key);
    const sha256 = sha256Of(input.body);
    this.objects.set(input.key, {
      body: Uint8Array.prototype.slice.call(input.body, 0),
      contentType: input.contentType,
      sha256,
    });
    return Promise.resolve({ key: input.key, sizeBytes: input.body.length, sha256 });
  }

  get(key: string): Promise<FetchedObject> {
    this.guard(key);
    const found = this.objects.get(key);
    if (!found) {
      return Promise.reject(new ObjectStorageError('NOT_FOUND', key, '객체가 없습니다'));
    }
    return Promise.resolve({
      key,
      body: found.body,
      contentType: found.contentType,
      sizeBytes: found.body.length,
      sha256: found.sha256,
    });
  }

  head(key: string): Promise<StoredObject | null> {
    this.guard(key);
    const found = this.objects.get(key);
    return Promise.resolve(
      found ? { key, sizeBytes: found.body.length, sha256: found.sha256 } : null,
    );
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  /**
   * presign할 수 없다 — 이 어댑터에는 HTTP 종단점이 없다. 흉내낸 URL을 돌려주면
   * 클라이언트가 쓸 수 없는 주소를 받고 실패가 업로드 단계로 미뤄진다. `null`은
   * "능력 없음"이며, 호출자는 자기 전송 라우트로 대체한다(ADR-32).
   */
  presignPut(_input: PresignPutInput): Promise<null> {
    return Promise.resolve(null);
  }

  /** 테스트 보조 — 저장된 키 목록. */
  keys(): string[] {
    return [...this.objects.keys()].sort();
  }

  clear(): void {
    this.objects.clear();
    this.unavailable = false;
  }

  private guard(key: string): void {
    if (this.unavailable) {
      throw new ObjectStorageError('UNAVAILABLE', key, '주입된 저장소 장애 (테스트)');
    }
  }
}
