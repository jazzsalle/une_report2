import { MemoryObjectStorage } from './memory-object-storage';
import type { ObjectStoragePort } from './object-storage-port';
import { S3ObjectStorage } from './s3-object-storage';

/**
 * 저장소 드라이버 선택 (CC-160).
 *
 * `plan-provider-factory.ts`와 같은 모양이다: 환경변수로 고르되 **기본값은
 * 안전한 쪽**이고, 운영에서 쓰면 안 되는 드라이버는 명시적으로 지정해야만
 * 선택된다. 기본을 memory로 두면 설정을 빠뜨린 배포가 조용히 휘발성
 * 저장소로 동작하며 산출물을 잃는다 — 그래서 기본은 s3다.
 *
 * 변수 이름은 CC-001이 `services/api/.env.example`·`services/worker/.env.example`
 * 에 이미 문서화한 `OBJECT_STORAGE_*`를 그대로 쓴다. 새 접두사를 만들면 같은
 * 값을 가리키는 이름이 두 벌이 되고, 어느 쪽이 읽히는지는 코드를 봐야만
 * 알 수 있게 된다.
 */

export const STORAGE_DRIVERS = ['s3', 'memory'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export interface StorageEnv {
  readonly OBJECT_STORAGE_DRIVER?: string;
  readonly OBJECT_STORAGE_ENDPOINT?: string;
  readonly OBJECT_STORAGE_REGION?: string;
  readonly OBJECT_STORAGE_BUCKET?: string;
  readonly OBJECT_STORAGE_ACCESS_KEY?: string;
  readonly OBJECT_STORAGE_SECRET_KEY?: string;
  readonly OBJECT_STORAGE_FORCE_PATH_STYLE?: string;
}

const REQUIRED_S3_KEYS = [
  'OBJECT_STORAGE_ENDPOINT',
  'OBJECT_STORAGE_BUCKET',
  'OBJECT_STORAGE_ACCESS_KEY',
  'OBJECT_STORAGE_SECRET_KEY',
] as const;

export function createObjectStorage(env: StorageEnv): ObjectStoragePort {
  const driver = (env.OBJECT_STORAGE_DRIVER ?? 's3') as StorageDriver;
  if (!STORAGE_DRIVERS.includes(driver)) {
    throw new Error(
      `OBJECT_STORAGE_DRIVER가 올바르지 않습니다: ${driver} (${STORAGE_DRIVERS.join('|')})`,
    );
  }
  if (driver === 'memory') return new MemoryObjectStorage();

  const missing = REQUIRED_S3_KEYS.filter((key) => !env[key]);
  if (missing.length > 0) {
    // 기동 시점에 크게 실패한다. 첫 Export 요청에서야 드러나면 그 요청은
    // QUEUED로 남고 사용자는 이유를 알 수 없다.
    throw new Error(`저장소 설정이 비어 있습니다: ${missing.join(', ')}`);
  }

  return new S3ObjectStorage({
    endpoint: env.OBJECT_STORAGE_ENDPOINT as string,
    region: env.OBJECT_STORAGE_REGION ?? 'us-east-1',
    bucket: env.OBJECT_STORAGE_BUCKET as string,
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY as string,
    secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY as string,
    forcePathStyle: env.OBJECT_STORAGE_FORCE_PATH_STYLE !== 'false',
  });
}
