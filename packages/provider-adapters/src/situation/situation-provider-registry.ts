/**
 * 비활성 어댑터와 Provider 선택 (CC-200).
 *
 * 세 가지를 구분한다. 셋을 한 덩어리로 "실패"라고 부르면 화면이 사용자에게
 * 무엇을 하라고 말할지 정할 수 없다(설계 06 US-SIT-004 E-03이 "Feature Flag
 * 안내"라는 **구체적 복구 동작**을 요구한다).
 *
 *   DISABLED        어댑터는 있는데 기능 플래그가 꺼져 있다 → 켜면 된다.
 *                   SafeKorea/Naver가 여기다. **법적·운영 승인 전**이라
 *                   기본값이 off이고, 그 사실이 OB-05다.
 *   NOT_CONTRACTED  플래그를 켜도 부를 곳이 없다. 계약이 없다.
 *                   T3Q 상황 API가 여기다(OB-02). ADR §4.5 G11-1이
 *                   "실패 시 DISABLED 유지"라고 정한 그 자리다.
 *   TIMEOUT/…       실제로 불렀는데 실패했다.
 *
 * 비활성 Provider도 **행을 남긴다.** provider_job에 FAILED로 기록되므로
 * "그때 무엇을 물었고 왜 못 받았는가"가 감사에 남는다. 조용히 건너뛰면
 * 사용자는 자기가 고른 Provider가 무시된 것을 알 수 없다.
 */

import type { ProviderCode } from '@une/domain';
import {
  providerFailure,
  type CollectSituationQuery,
  type ProviderCollectResult,
  type ProviderFailureKind,
  type ProviderHealth,
  type SituationProviderPort,
} from './situation-provider-port';
import { MockKmaSituationProvider, MockMoisSituationProvider } from './mock-situation-providers';

export class DisabledSituationProvider implements SituationProviderPort {
  constructor(
    readonly providerCode: ProviderCode,
    private readonly kind: Extract<ProviderFailureKind, 'DISABLED' | 'NOT_CONTRACTED'>,
    private readonly openBinding: string,
    private readonly reason: string,
  ) {}

  health(): ProviderHealth {
    return {
      providerCode: this.providerCode,
      available: false,
      reason: this.kind,
      // 실 Provider도 목업도 아니다. 부를 수 있는 것이 없으므로 LIVE라고
      // 말하지 않는다 — 목업 지원을 실 지원으로 보고하지 않는 규칙의 반대편.
      mode: 'MOCK',
      openBinding: this.openBinding,
    };
  }

  collect(_query: CollectSituationQuery): Promise<ProviderCollectResult> {
    return Promise.resolve(
      providerFailure(this.providerCode, this.kind, this.reason, { elapsedMs: 0 }),
    );
  }
}

/** 계약 `ProviderQueryRequest.providers` enum과 같은 다섯. MANUAL은 사용자
 * 입력(UNE-SIT-007)이라 조회 대상이 아니고, UNI는 상황 수집 Provider가
 * 아니다(지식 검색 — UNE-KNOW). */
export const QUERYABLE_PROVIDERS = ['KMA', 'MOIS', 'SAFEKOREA', 'NAVER', 'T3Q'] as const;
export type QueryableProvider = (typeof QUERYABLE_PROVIDERS)[number];

export function isQueryableProvider(value: unknown): value is QueryableProvider {
  return typeof value === 'string' && (QUERYABLE_PROVIDERS as readonly string[]).includes(value);
}

/** 기능 플래그. 기본값이 전부 off인 것은 실수가 아니다 — SafeKorea/Naver는
 * 승인 전이고(OB-05), T3Q는 계약이 없다(OB-02). 켜는 것은 운영 결정이다. */
export interface SituationProviderFlags {
  safekorea?: boolean;
  naver?: boolean;
  t3q?: boolean;
}

export const DEFAULT_SITUATION_PROVIDER_FLAGS: Required<SituationProviderFlags> = {
  safekorea: false,
  naver: false,
  t3q: false,
};

export interface SituationProviderRegistryOptions {
  flags?: SituationProviderFlags;
  /** 목업의 시나리오 훅을 켠다. 기본값 off — 운영 경로에서는 켜지 않는다.
   * API는 설정(`UNE_SITUATION_MOCK_SCENARIOS`)으로만 켤 수 있고 요청 본문으로는
   * 켤 수 없다(ADR-33 D19). */
  scenariosEnabled?: boolean;
  /** 시험용 대체. 운영 경로에서는 쓰지 않는다. */
  overrides?: Partial<Record<QueryableProvider, SituationProviderPort>>;
}

/** 도메인 서비스가 의존하는 팩토리 형태. API는 이 함수를 **주입받아** 쓰고
 * 구체 팩토리를 직접 부르지 않는다(.claude/rules/architecture.md). */
export type SituationProviderFactory = (
  provider: QueryableProvider,
  options?: SituationProviderRegistryOptions,
) => SituationProviderPort;

/**
 * Provider별 어댑터를 고른다.
 *
 * SafeKorea/Naver는 플래그를 켜도 **아직 어댑터가 없다** — 웹 수집기는
 * 설계 01 §20.3이 "서버측 Collector가 낮은 빈도로 수집·캐시"하라고 정한
 * 별도 구성요소이고 CC-200 범위가 아니다. 켰을 때 조용히 성공한 척하지
 * 않도록 NOT_CONTRACTED로 답한다(플래그가 켜졌다는 사실만으로 능력이 생기지
 * 않는다).
 */
export function createSituationProvider(
  provider: QueryableProvider,
  options: SituationProviderRegistryOptions = {},
): SituationProviderPort {
  const override = options.overrides?.[provider];
  if (override) return override;

  const flags = { ...DEFAULT_SITUATION_PROVIDER_FLAGS, ...options.flags };

  switch (provider) {
    case 'KMA':
      return new MockKmaSituationProvider({ scenariosEnabled: options.scenariosEnabled === true });
    case 'MOIS':
      return new MockMoisSituationProvider({ scenariosEnabled: options.scenariosEnabled === true });
    case 'SAFEKOREA':
      return flags.safekorea
        ? new DisabledSituationProvider(
            'SAFEKOREA',
            'NOT_CONTRACTED',
            'OB-05',
            '국민안전24 수집기는 아직 구현되지 않았습니다(설계 01 §20.3 서버측 Collector).',
          )
        : new DisabledSituationProvider(
            'SAFEKOREA',
            'DISABLED',
            'OB-05',
            '국민안전24 연동은 법적·운영 승인 전이라 비활성입니다.',
          );
    case 'NAVER':
      return flags.naver
        ? new DisabledSituationProvider(
            'NAVER',
            'NOT_CONTRACTED',
            'OB-05',
            'Naver 보조 출처 수집기는 아직 구현되지 않았습니다.',
          )
        : new DisabledSituationProvider(
            'NAVER',
            'DISABLED',
            'OB-05',
            'Naver 연동은 법적·운영 승인 전이라 비활성입니다. 명시적 요청과 승인이 필요합니다.',
          );
    case 'T3Q':
      return new DisabledSituationProvider(
        'T3Q',
        'NOT_CONTRACTED',
        'OB-02',
        'T3Q 상황정보 API는 승인된 계약이 없습니다(ADR §4.5 G11-1: 실패 시 DISABLED 유지).',
      );
    default: {
      const exhaustive: never = provider;
      throw new Error(`unknown provider: ${String(exhaustive)}`);
    }
  }
}

export function situationProviderHealth(
  options: SituationProviderRegistryOptions = {},
): ProviderHealth[] {
  return QUERYABLE_PROVIDERS.map((p) => createSituationProvider(p, options).health());
}
