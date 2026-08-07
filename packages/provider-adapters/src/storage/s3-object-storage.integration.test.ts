import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ObjectStorageError,
  exportObjectKey,
  sha256Of,
  uploadObjectKey,
} from './object-storage-port';
import { S3ObjectStorage } from './s3-object-storage';

/**
 * 실 MinIO 통합 검증 (CC-160).
 *
 * 인메모리 어댑터가 포트 계약을 지키는 것과 "S3 호환 저장소에서 실제로
 * 동작한다"는 다른 주장이다. 서명·path-style·체크섬은 실물에서만 드러난다.
 *
 * 환경변수가 없으면 **건너뛴다** — DB 통합 테스트와 같은 규약이다. CI의
 * db-verify 잡처럼 인프라가 있는 곳에서만 돈다. 건너뛴 것이 통과로 보이지
 * 않도록 마지막에 "설정이 있었는지"를 함께 신고한다.
 */

const ENDPOINT = process.env.OBJECT_STORAGE_ENDPOINT;
const BUCKET = process.env.OBJECT_STORAGE_BUCKET;
const ACCESS_KEY = process.env.OBJECT_STORAGE_ACCESS_KEY;
const SECRET_KEY = process.env.OBJECT_STORAGE_SECRET_KEY;
const CONFIGURED = Boolean(ENDPOINT && BUCKET && ACCESS_KEY && SECRET_KEY);

const TENANT = randomUUID();
const written: string[] = [];

const storage = CONFIGURED
  ? new S3ObjectStorage({
      endpoint: ENDPOINT as string,
      region: process.env.OBJECT_STORAGE_REGION ?? 'us-east-1',
      bucket: BUCKET as string,
      accessKeyId: ACCESS_KEY as string,
      secretAccessKey: SECRET_KEY as string,
      forcePathStyle: true,
    })
  : null;

function keyFor(body: Uint8Array): string {
  return exportObjectKey({
    tenantId: TENANT,
    exportId: randomUUID(),
    sha256: sha256Of(body),
    extension: 'hwpx',
  });
}

describe.skipIf(!CONFIGURED)('S3ObjectStorage — 실 MinIO', () => {
  afterAll(async () => {
    if (!storage) return;
    for (const key of written) await storage.remove(key);
  });

  it('바이트를 넣고 그대로 되찾는다 (해시 일치)', async () => {
    const body = Uint8Array.prototype.slice.call(Buffer.from('UNE HWPX 산출물 바이트'), 0);
    const key = keyFor(body);
    written.push(key);

    const put = await storage!.put({
      key,
      body,
      contentType: 'application/hwp+zip',
      metadata: { exporter: 'cc160' },
    });
    expect(put.sha256).toBe(sha256Of(body));
    expect(put.sizeBytes).toBe(body.length);

    const got = await storage!.get(key);
    expect(Buffer.compare(Buffer.from(got.body), Buffer.from(body))).toBe(0);
    expect(got.sha256).toBe(put.sha256);
    expect(got.contentType).toBe('application/hwp+zip');
  }, 60_000);

  it('head는 크기를 돌려주고, 없는 키에는 null이다', async () => {
    const body = Uint8Array.prototype.slice.call(Buffer.from('head 확인'), 0);
    const key = keyFor(body);
    written.push(key);
    await storage!.put({ key, body, contentType: 'application/octet-stream' });

    const head = await storage!.head(key);
    expect(head?.sizeBytes).toBe(body.length);
    expect(await storage!.head(`${key}.missing`)).toBeNull();
  }, 60_000);

  it('없는 객체를 읽으면 NOT_FOUND다 (장애와 구분된다)', async () => {
    try {
      await storage!.get(`tenants/${TENANT}/exports/${randomUUID()}/${'b'.repeat(64)}.hwpx`);
      throw new Error('실패했어야 한다');
    } catch (error) {
      expect(error).toBeInstanceOf(ObjectStorageError);
      expect((error as ObjectStorageError).kind).toBe('NOT_FOUND');
    }
  }, 60_000);

  it('remove 후에는 다시 읽히지 않는다', async () => {
    const body = Uint8Array.prototype.slice.call(Buffer.from('삭제 대상'), 0);
    const key = keyFor(body);
    await storage!.put({ key, body, contentType: 'application/octet-stream' });
    await storage!.remove(key);
    expect(await storage!.head(key)).toBeNull();
  }, 60_000);

  // --- CC-170 presigned 업로드 ---------------------------------------------
  // presign은 서명·엔드포인트 스타일·체크섬이 모두 맞아야 동작한다. 인메모리
  // 어댑터로는 이 중 무엇도 확인되지 않으므로 실물에서만 증명된다.
  it('presign한 URL로 클라이언트가 직접 PUT할 수 있다', async () => {
    const body = Uint8Array.prototype.slice.call(Buffer.from('presign으로 올린 바이트'), 0);
    const sha256 = sha256Of(body);
    const key = uploadObjectKey({
      tenantId: TENANT,
      fileId: randomUUID(),
      sha256,
      extension: 'hwpx',
    });
    written.push(key);

    const ticket = await storage!.presignPut({
      key,
      contentType: 'application/hwp+zip',
      sha256,
      expiresInSeconds: 900,
    });
    expect(ticket).not.toBeNull();
    expect(ticket!.url).toContain(encodeURIComponent(key).replace(/%2F/g, '/'));
    expect(ticket!.headers['x-amz-checksum-sha256']).toBe(
      Buffer.from(sha256, 'hex').toString('base64'),
    );

    const response = await fetch(ticket!.url, {
      method: 'PUT',
      headers: ticket!.headers as Record<string, string>,
      body,
    });
    expect(response.status, await response.text()).toBe(200);

    // 서버가 실제로 그 바이트를 가지고 있다.
    const got = await storage!.get(key);
    expect(got.sha256).toBe(sha256);
  }, 60_000);

  it('선언과 다른 바이트는 저장소가 거부한다 (체크섬이 서명에 들어 있다)', async () => {
    const declared = Uint8Array.prototype.slice.call(Buffer.from('선언한 내용'), 0);
    const actual = Uint8Array.prototype.slice.call(Buffer.from('실제로 올린 다른 내용'), 0);
    const sha256 = sha256Of(declared);
    const key = uploadObjectKey({
      tenantId: TENANT,
      fileId: randomUUID(),
      sha256,
      extension: 'hwpx',
    });

    const ticket = await storage!.presignPut({
      key,
      contentType: 'application/hwp+zip',
      sha256,
      expiresInSeconds: 900,
    });
    const response = await fetch(ticket!.url, {
      method: 'PUT',
      headers: ticket!.headers as Record<string, string>,
      body: actual,
    });
    expect(response.ok).toBe(false);
    // 거부됐으므로 자리에 아무것도 남지 않는다.
    expect(await storage!.head(key)).toBeNull();
  }, 60_000);

  it('만료된 티켓은 거부된다', async () => {
    const body = Uint8Array.prototype.slice.call(Buffer.from('만료 확인'), 0);
    const sha256 = sha256Of(body);
    const key = uploadObjectKey({
      tenantId: TENANT,
      fileId: randomUUID(),
      sha256,
      extension: 'hwpx',
    });
    const ticket = await storage!.presignPut({
      key,
      contentType: 'application/hwp+zip',
      sha256,
      expiresInSeconds: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await fetch(ticket!.url, {
      method: 'PUT',
      headers: ticket!.headers as Record<string, string>,
      body,
    });
    expect(response.status).toBe(403);
  }, 60_000);
});

describe('S3ObjectStorage — 설정 가드', () => {
  it('자격증명이 비면 기동에서 실패한다 (환경 프로파일로 조용히 넘어가지 않는다)', () => {
    expect(
      () =>
        new S3ObjectStorage({
          endpoint: 'http://127.0.0.1:9000',
          region: 'us-east-1',
          bucket: 'b',
          accessKeyId: '',
          secretAccessKey: '',
        }),
    ).toThrowError(/자격증명/);
  });

  it('MinIO 통합 테스트가 실제로 돌았는지 신고한다 (건너뜀이 통과로 보이지 않게)', () => {
    // 이 단언은 항상 통과한다. 목적은 실행 로그에 설정 유무를 남기는 것이다.
    expect(typeof CONFIGURED).toBe('boolean');
    if (!CONFIGURED) {
      console.warn('[CC-160] OBJECT_STORAGE_* 미설정 — 실 MinIO 통합 검증을 건너뛰었다');
    }
  });
});
