import { describe, expect, it } from 'vitest';
import { MemoryObjectStorage } from './memory-object-storage';
import {
  ObjectStorageError,
  exportObjectKey,
  sha256Of,
  uploadObjectKey,
} from './object-storage-port';
import { createObjectStorage } from './storage-factory';

const TENANT = '11111111-1111-4111-8111-111111111111';
const EXPORT = '22222222-2222-4222-8222-222222222222';
const HASH = 'a'.repeat(64);

describe('exportObjectKey — 테넌트 접두사와 키 위생', () => {
  it('테넌트를 접두사에 두어 저장소 층에서도 경계가 보인다', () => {
    expect(
      exportObjectKey({ tenantId: TENANT, exportId: EXPORT, sha256: HASH, extension: 'hwpx' }),
    ).toBe(`tenants/${TENANT}/exports/${EXPORT}/${HASH}.hwpx`);
  });

  it('같은 내용은 같은 키가 된다 (재시도가 자연히 멱등)', () => {
    const a = exportObjectKey({
      tenantId: TENANT,
      exportId: EXPORT,
      sha256: HASH,
      extension: 'hwpx',
    });
    const b = exportObjectKey({
      tenantId: TENANT,
      exportId: EXPORT,
      sha256: HASH,
      extension: 'hwpx',
    });
    expect(a).toBe(b);
  });

  it('경로 탈출을 시도하는 세그먼트를 거부한다', () => {
    for (const evil of ['../../etc', `${TENANT}/../other`, '', 'not-a-uuid']) {
      expect(() =>
        exportObjectKey({ tenantId: evil, exportId: EXPORT, sha256: HASH, extension: 'hwpx' }),
      ).toThrowError(ObjectStorageError);
      expect(() =>
        exportObjectKey({ tenantId: TENANT, exportId: evil, sha256: HASH, extension: 'hwpx' }),
      ).toThrowError(ObjectStorageError);
    }
  });

  it('해시·확장자 형식이 아니면 거부한다', () => {
    expect(() =>
      exportObjectKey({ tenantId: TENANT, exportId: EXPORT, sha256: 'nope', extension: 'hwpx' }),
    ).toThrowError(/sha256/);
    expect(() =>
      exportObjectKey({ tenantId: TENANT, exportId: EXPORT, sha256: HASH, extension: '../sh' }),
    ).toThrowError(/확장자/);
  });
});

describe('uploadObjectKey — 검증 전 바이트는 내용 주소를 차지하지 않는다', () => {
  const FILE = '33333333-3333-4333-8333-333333333333';

  it('fileId로 격리한다 (sources/{sha256}과 섞이지 않는다)', () => {
    expect(
      uploadObjectKey({ tenantId: TENANT, fileId: FILE, sha256: HASH, extension: 'hwpx' }),
    ).toBe(`tenants/${TENANT}/uploads/${FILE}/${HASH}.hwpx`);
  });

  it('같은 해시를 선언한 두 등록이 서로 다른 키를 받는다', () => {
    const other = '44444444-4444-4444-8444-444444444444';
    expect(
      uploadObjectKey({ tenantId: TENANT, fileId: FILE, sha256: HASH, extension: 'hwpx' }),
    ).not.toBe(
      uploadObjectKey({ tenantId: TENANT, fileId: other, sha256: HASH, extension: 'hwpx' }),
    );
  });

  it('경로 탈출과 형식 위반을 거부한다', () => {
    for (const evil of ['../../etc', '', 'not-a-uuid']) {
      expect(() =>
        uploadObjectKey({ tenantId: evil, fileId: FILE, sha256: HASH, extension: 'hwpx' }),
      ).toThrowError(ObjectStorageError);
      expect(() =>
        uploadObjectKey({ tenantId: TENANT, fileId: evil, sha256: HASH, extension: 'hwpx' }),
      ).toThrowError(ObjectStorageError);
    }
    expect(() =>
      uploadObjectKey({ tenantId: TENANT, fileId: FILE, sha256: 'nope', extension: 'hwpx' }),
    ).toThrowError(/sha256/);
  });
});

describe('MemoryObjectStorage — 포트 계약', () => {
  it('presign 능력이 없으면 null이다 (흉내낸 URL을 주지 않는다)', async () => {
    const storage = new MemoryObjectStorage();
    expect(
      await storage.presignPut({
        key: 'k',
        contentType: 'application/hwp+zip',
        sha256: HASH,
        expiresInSeconds: 900,
      }),
    ).toBeNull();
  });

  it('넣은 바이트를 그대로 돌려주고 해시를 계산한다', async () => {
    const storage = new MemoryObjectStorage();
    const body = Buffer.from('UNE 산출물');
    const key = exportObjectKey({
      tenantId: TENANT,
      exportId: EXPORT,
      sha256: HASH,
      extension: 'hwpx',
    });

    const put = await storage.put({ key, body, contentType: 'application/hwp+zip' });
    expect(put.sha256).toBe(sha256Of(body));
    expect(put.sizeBytes).toBe(body.length);

    const got = await storage.get(key);
    expect(Buffer.compare(Buffer.from(got.body), body)).toBe(0);
    expect(got.contentType).toBe('application/hwp+zip');
  });

  it('저장한 바이트를 나중에 바꿔도 저장소 안의 값은 변하지 않는다 (복사본 보관)', async () => {
    const storage = new MemoryObjectStorage();
    const body = Buffer.from('원본');
    await storage.put({ key: 'k', body, contentType: 'text/plain' });
    body.fill(0);
    const got = await storage.get('k');
    expect(Buffer.from(got.body).toString('utf8')).toBe('원본');
  });

  it('없는 객체는 NOT_FOUND로 구분된다 (만료 410과 장애 503을 가르는 근거)', async () => {
    const storage = new MemoryObjectStorage();
    await expect(storage.get('missing')).rejects.toThrowError(ObjectStorageError);
    try {
      await storage.get('missing');
    } catch (error) {
      expect((error as ObjectStorageError).kind).toBe('NOT_FOUND');
    }
    expect(await storage.head('missing')).toBeNull();
  });

  it('주입된 장애는 UNAVAILABLE이다 (NOT_FOUND로 뭉개지 않는다)', async () => {
    const storage = new MemoryObjectStorage();
    await storage.put({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain' });
    storage.unavailable = true;
    try {
      await storage.get('k');
      throw new Error('실패했어야 한다');
    } catch (error) {
      expect((error as ObjectStorageError).kind).toBe('UNAVAILABLE');
    }
  });

  it('remove는 없는 키에도 실패하지 않는다 (정리 경로)', async () => {
    const storage = new MemoryObjectStorage();
    await expect(storage.remove('missing')).resolves.toBeUndefined();
  });
});

describe('createObjectStorage — 드라이버 선택', () => {
  it('기본값은 s3다 — 설정을 빠뜨린 배포가 휘발성 저장소로 조용히 동작하지 않는다', () => {
    expect(() => createObjectStorage({})).toThrowError(/저장소 설정이 비어 있습니다/);
  });

  it('필수 설정이 없으면 기동 시점에 어느 값이 빠졌는지 말한다', () => {
    expect(() =>
      createObjectStorage({
        OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
        OBJECT_STORAGE_BUCKET: 'une-documents',
      }),
    ).toThrowError(/OBJECT_STORAGE_ACCESS_KEY, OBJECT_STORAGE_SECRET_KEY/);
  });

  it('memory는 명시적으로 지정해야만 선택된다', () => {
    expect(createObjectStorage({ OBJECT_STORAGE_DRIVER: 'memory' })).toBeInstanceOf(
      MemoryObjectStorage,
    );
  });

  it('알 수 없는 드라이버는 거부한다', () => {
    expect(() => createObjectStorage({ OBJECT_STORAGE_DRIVER: 'local-disk' })).toThrowError(
      /OBJECT_STORAGE_DRIVER/,
    );
  });

  it('s3 드라이버는 설정이 갖춰지면 만들어진다', () => {
    const storage = createObjectStorage({
      OBJECT_STORAGE_DRIVER: 's3',
      OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
      OBJECT_STORAGE_BUCKET: 'une-documents',
      OBJECT_STORAGE_ACCESS_KEY: 'key',
      OBJECT_STORAGE_SECRET_KEY: 'secret',
    });
    expect(storage).toBeDefined();
    expect(storage).not.toBeInstanceOf(MemoryObjectStorage);
  });
});
