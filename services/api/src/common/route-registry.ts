import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { IDEMPOTENT, IS_PUBLIC, REQUIRED_PERMISSION } from './decorators';

/**
 * 런타임에 등록된 라우트 목록 (CC-430).
 *
 * 보안 전수 시험과 계약 대조가 **소스를 정규식으로 읽는 대신** 실제로 등록된
 * 것을 봐야 한다. 정규식은 적힌 것을 보고, 라우터는 선 것을 본다 — 조건부
 * 등록·상속·모듈 누락은 전자에서 보이지 않는다.
 *
 * 이 지식을 API 패키지가 갖는 이유는 단순하다. 라우터와 데코레이터 메타데이터는
 * 이 서비스의 것이고, 테스트 패키지가 `@nestjs/core`를 직접 파면 그 내부 구조에
 * 시험이 매달린다.
 */

export interface RegisteredRoute {
  /** GET/POST/... */
  method: string;
  /** 전역 prefix를 포함한 경로. 경로 파라미터는 `:name` 그대로다. */
  path: string;
  /** `@RequirePermission` 코드. 없으면 인증만 요구한다. */
  permission: string | null;
  /** `@Public` — 토큰 없이 부를 수 있다. */
  isPublic: boolean;
  /** `@Idempotent` 선언 여부. */
  idempotent: boolean;
  /** `Controller.method` — 실패했을 때 어디를 볼지 알려 준다. */
  handler: string;
}

const METHOD_NAMES = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'] as const;

export function listRoutes(app: INestApplication, globalPrefix = 'api/v1'): RegisteredRoute[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const out: RegisteredRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as Record<string, unknown> | undefined;
    if (!instance || !wrapper.metatype) continue;
    const proto = Object.getPrototypeOf(instance) as object;
    const controllerPath = (reflector.get<string>('path', wrapper.metatype) ?? '') as string;
    const controllerPublic = reflector.get<boolean>(IS_PUBLIC, wrapper.metatype) === true;

    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = (instance as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const methodPath = reflector.get<string>('path', handler as never);
      if (methodPath === undefined) continue;
      const methodIndex = reflector.get<number>('method', handler as never);
      const method = METHOD_NAMES[methodIndex ?? 0] ?? 'GET';

      const segments = [globalPrefix, controllerPath, methodPath]
        .map((s) => (s ?? '').replace(/^\/+|\/+$/g, ''))
        .filter((s) => s.length > 0);

      out.push({
        method,
        path: `/${segments.join('/')}`,
        permission: reflector.get<string>(REQUIRED_PERMISSION, handler as never) ?? null,
        isPublic: controllerPublic || reflector.get<boolean>(IS_PUBLIC, handler as never) === true,
        idempotent: reflector.get(IDEMPOTENT, handler as never) !== undefined,
        handler: `${(wrapper.metatype as { name?: string }).name ?? '?'}.${name}`,
      });
    }
  }
  return out;
}
