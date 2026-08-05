import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ObjectStorageError,
  sha256Of,
  type FetchedObject,
  type ObjectStoragePort,
  type PresignPutInput,
  type PresignedPut,
  type PutObjectInput,
  type StoredObject,
} from './object-storage-port';

/**
 * S3 호환 어댑터 (MinIO 로컬 / S3 배포 — ADR-19 승인 프로필).
 *
 * SDK를 직접 쓰는 유일한 자리다. 서명(SigV4)·재시도·스트리밍을 손으로
 * 구현하지 않는 이유는 그것이 보안에 직결되는 코드이기 때문이다 — 엔진의
 * "신규 의존성 0" 원칙은 HWPX 파싱/직렬화에 적용되는 것이고, 인증 프로토콜은
 * 그 반대편이다(ADR-31).
 */

export interface S3ObjectStorageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /**
   * MinIO는 가상호스트 스타일 주소를 기본 제공하지 않는다. 로컬에서는
   * path-style이어야 하고, 실제 S3에서는 꺼도 된다.
   */
  readonly forcePathStyle?: boolean;
}

/** SDK 오류를 포트 어휘로 좁힌다. 호출자가 SDK 타입을 알 필요가 없어야 한다. */
function toStorageError(key: string, error: unknown): ObjectStorageError {
  const name = (error as { name?: string })?.name ?? '';
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) {
    return new ObjectStorageError('NOT_FOUND', key, '객체가 없습니다', error);
  }
  if (status === 403 || name === 'AccessDenied') {
    // 권한 문제를 NOT_FOUND로 뭉개지 않는다 — 설정 오류가 "만료됨"으로
    // 보고되면 아무도 원인을 찾지 못한다.
    return new ObjectStorageError('REJECTED', key, '저장소가 요청을 거부했습니다', error);
  }
  return new ObjectStorageError('UNAVAILABLE', key, `저장소 오류 (${name || status})`, error);
}

async function collect(body: unknown): Promise<Uint8Array> {
  if (
    body &&
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray === 'function'
  ) {
    return (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Uint8Array.prototype.slice.call(Buffer.concat(chunks), 0);
}

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3ObjectStorageConfig) {
    if (!config.bucket) throw new Error('S3ObjectStorage: bucket이 비어 있습니다');
    if (!config.accessKeyId || !config.secretAccessKey) {
      // 자격증명이 없으면 SDK는 환경·인스턴스 프로파일로 조용히 넘어간다.
      // 그 동작은 로컬에서 "왜 되지?"를, 운영에서 "왜 안 되지?"를 만든다.
      throw new Error('S3ObjectStorage: 자격증명이 비어 있습니다');
    }
    const options: S3ClientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
    this.client = new S3Client(options);
    this.bucket = config.bucket;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const sha256 = sha256Of(input.body);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          // 저장소가 내용을 검증하게 한다. 전송 중 손상이 조용히 통과하면
          // file_object.sha256이 실제 객체와 다른 것을 가리키게 된다.
          ChecksumSHA256: Buffer.from(sha256, 'hex').toString('base64'),
          Metadata: input.metadata ? { ...input.metadata } : undefined,
        }),
      );
    } catch (error) {
      throw toStorageError(input.key, error);
    }
    return { key: input.key, sizeBytes: input.body.length, sha256 };
  }

  async get(key: string): Promise<FetchedObject> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await collect(result.Body);
      return {
        key,
        body,
        contentType: result.ContentType ?? 'application/octet-stream',
        sizeBytes: body.length,
        sha256: sha256Of(body),
      };
    } catch (error) {
      throw toStorageError(key, error);
    }
  }

  async head(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        sizeBytes: Number(result.ContentLength ?? 0),
        // HEAD로는 내용을 읽지 않으므로 해시를 계산할 수 없다. 저장 시 기록한
        // 값(DB의 file_object.sha256)이 정본이며, 여기서 지어내지 않는다.
        sha256: '',
      };
    } catch (error) {
      const storageError = toStorageError(key, error);
      if (storageError.kind === 'NOT_FOUND') return null;
      throw storageError;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      // 정리 경로다. 실패해도 호출자의 트랜잭션을 되돌릴 이유가 없다.
    }
  }

  /**
   * 업로드용 presigned PUT.
   *
   * 선언 해시를 **서명에 넣는다**(`x-amz-checksum-sha256`). 그러면 다른 바이트는
   * 저장소가 직접 거부하므로, 검증되지 않은 바이트가 애초에 자리에 놓이지 않는다.
   * 클라이언트는 돌려준 헤더를 그대로 붙이기만 하면 된다 — 헤더를 하나 빼면
   * 서명이 깨지므로 "체크섬을 안 보내고 통과"하는 경로가 없다.
   */
  async presignPut(input: PresignPutInput): Promise<PresignedPut> {
    if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
      throw new ObjectStorageError('REJECTED', input.key, 'sha256 형식이 아닙니다');
    }
    const checksum = Buffer.from(input.sha256, 'hex').toString('base64');
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ChecksumSHA256: checksum,
    });
    try {
      const url = await getSignedUrl(this.client, command, {
        expiresIn: input.expiresInSeconds,
        // 서명 대상 헤더를 고정한다. SDK가 임의로 더한 헤더까지 서명되면
        // 클라이언트가 재현할 수 없는 요청이 된다.
        signableHeaders: new Set(['content-type', 'x-amz-checksum-sha256']),
      });
      return {
        url,
        headers: {
          'Content-Type': input.contentType,
          'x-amz-checksum-sha256': checksum,
        },
        expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      };
    } catch (error) {
      throw toStorageError(input.key, error);
    }
  }
}
