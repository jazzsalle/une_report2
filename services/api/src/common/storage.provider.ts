import { createObjectStorage, type ObjectStoragePort } from '@une/provider-adapters';
import type { Provider } from '@nestjs/common';

/**
 * 오브젝트 저장소 주입 토큰 (CC-160).
 *
 * 인터페이스는 런타임 값이 아니므로 Nest가 타입만으로 주입할 수 없다. 토큰을
 * 한 곳에서 정의해 API와 워커가 같은 이름을 쓰게 한다.
 *
 * 팩토리는 `process.env`를 여기서 한 번만 읽는다. 서비스마다 환경변수를
 * 직접 읽으면 어느 값이 실제로 쓰이는지가 호출 지점마다 달라진다.
 */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export const objectStorageProvider: Provider = {
  provide: OBJECT_STORAGE,
  useFactory: (): ObjectStoragePort => createObjectStorage(process.env),
};
