import { createSituationProvider, type SituationProviderFactory } from '@une/provider-adapters';
import type { Provider } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from '../config/api-config';

/**
 * 상황 Provider 주입 토큰 (CC-200, ADR-33 D19).
 *
 * `ProviderQueryService`가 요청 핸들러 안에서 구체 팩토리
 * `createSituationProvider`를 직접 부르고 있었다. 그러면 두 가지가 막힌다 —
 * 도메인 서비스가 포트가 아니라 구현에 붙고(.claude/rules/architecture.md),
 * 레지스트리가 준비해 둔 `overrides`(시험용 대체)에 API에서 도달할 방법이
 * 없어서 **E2E가 운영 요청 본문의 `mockScenario`로만 실패 갈래를 만들 수
 * 있었다**(아키텍처 리뷰 M-3).
 *
 * CC-160의 `OBJECT_STORAGE`와 같은 형태다: 토큰 하나, 팩토리 하나, 설정은
 * 여기서 한 번만 읽는다. 시나리오 훅은 **설정으로만** 켜지며 요청으로는
 * 켤 수 없다.
 */
export const SITUATION_PROVIDERS = Symbol('SITUATION_PROVIDERS');

export const situationProviderFactory: Provider = {
  provide: SITUATION_PROVIDERS,
  inject: [API_CONFIG],
  useFactory: (config: ApiConfig): SituationProviderFactory => {
    const scenariosEnabled = config.situationMockScenarios;
    return (provider, options = {}) =>
      createSituationProvider(provider, { ...options, scenariosEnabled });
  },
};
