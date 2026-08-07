/**
 * KMA / MOIS 상황 Provider 목업 (CC-200).
 *
 * **목업이다.** 실 Provider 지원으로 보고하지 않는다(CLAUDE.md, ADR-24 절차) —
 * `health().mode`가 항상 `MOCK`이고 그 사실을 계약 테스트가 고정한다.
 * 실 OpenAPI 계약·인증·Rate Limit이 확정되면 ADR §4.5 G11 게이트를 통과한 뒤
 * LIVE 어댑터를 같은 포트 뒤에 붙인다.
 *
 * 결정성. 같은 질의에는 같은 응답을 준다 — 난수도 벽시계도 쓰지 않고
 * `timeWindow.asOf`에서 값을 유도한다. 그래야 골든 비교와 멱등 재전송 검증이
 * 성립한다(CC-135 목업이 같은 이유로 같은 규칙을 지킨다).
 *
 * 시나리오 훅. 계약의 `ProviderQueryRequest.query`가 `providerQuery`로 그대로
 * 내려오므로 `query.mockScenario`로 실패 갈래를 재현한다. E2E가 HTTP를 지나
 * 부분 실패(인수기준 4번)를 만들 수 있는 유일한 경로이며, 실 어댑터에는
 * 존재하지 않을 필드다.
 */

import type { ProviderCode, RawFactItem } from '@une/domain';
import {
  providerFailure,
  type CollectSituationQuery,
  type ProviderCollectResult,
  type ProviderFailureKind,
  type ProviderHealth,
  type SituationProviderPort,
} from './situation-provider-port';

export const MOCK_SITUATION_PARSER_VERSION = 'une-mock-situation-1.0.0';

/** `query.mockScenario`가 가질 수 있는 값. 그 외의 값은 무시한다(정상 응답). */
export const MOCK_SCENARIOS = [
  'TIMEOUT',
  'UPSTREAM_ERROR',
  'PARSER_CHANGED',
  'NO_DATA',
  /** 응답은 왔는데 일부 항목이 정규화에서 탈락한다 → provider_job PARTIAL. */
  'PARTIAL',
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

function scenarioFor(
  query: CollectSituationQuery,
  providerCode: ProviderCode,
): MockScenario | null {
  const raw = query.providerQuery.mockScenario;
  // Provider 하나만 실패시키는 형태도 받는다: {"mockScenario": {"KMA": "TIMEOUT"}}
  const value =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)[providerCode] : raw;
  return typeof value === 'string' && (MOCK_SCENARIOS as readonly string[]).includes(value)
    ? (value as MockScenario)
    : null;
}

/** asOf에서 유도한 결정적 정수. 난수 대신 쓴다. */
function seedOf(asOf: string): number {
  let hash = 0;
  for (let i = 0; i < asOf.length; i += 1) {
    hash = (hash * 31 + asOf.charCodeAt(i)) % 100_000;
  }
  return hash;
}

function wantsCategory(query: CollectSituationQuery, category: string): boolean {
  return query.categories.length === 0 || query.categories.includes(category);
}

export interface MockSituationProviderOptions {
  /** 시나리오 훅을 켠다. **기본값 off** — 켜지 않으면 `query.mockScenario`를
   * 아예 읽지 않는다.
   *
   * 처음에는 요청 본문의 `mockScenario`를 무조건 해석했다. 그러면 시험 훅이
   * 운영 요청 경로에 남고 계약이 그 필드를 약속하게 된다. CC-125의
   * `MockLegacyT3qPlanAdapter`가 같은 문제를 `scenariosEnabled` 옵션(기본
   * off)으로 이미 닫아 두었고, 여기서도 그 선례를 따른다(아키텍처 리뷰 M-3). */
  scenariosEnabled?: boolean;
}

abstract class MockSituationProvider implements SituationProviderPort {
  abstract readonly providerCode: ProviderCode;
  protected abstract readonly sourceName: string;
  protected abstract readonly sourceUri: string;
  protected readonly scenariosEnabled: boolean;

  constructor(options: MockSituationProviderOptions = {}) {
    this.scenariosEnabled = options.scenariosEnabled === true;
  }

  health(): ProviderHealth {
    return {
      providerCode: this.providerCode,
      available: true,
      reason: null,
      mode: 'MOCK',
      openBinding: null,
    };
  }

  protected abstract buildItems(query: CollectSituationQuery, seed: number): RawFactItem[];

  /** PARTIAL 시나리오가 끼워 넣는 항목. 정규화에서 반드시 탈락해야 한다 —
   * factKey 표기 위반은 도메인이 FACT_KEY_MALFORMED로 격리한다. */
  protected brokenItem(): RawFactItem {
    return {
      factType: 'WEATHER_OBSERVATION',
      factKey: 'windSpeed',
      value: 3,
      unit: 'm/s',
      raw: { note: 'mock: camelCase key는 표준 표기가 아니다' },
    };
  }

  async collect(query: CollectSituationQuery): Promise<ProviderCollectResult> {
    const scenario = this.scenariosEnabled ? scenarioFor(query, this.providerCode) : null;
    const elapsedMs = 1;

    const failureKinds: Partial<Record<MockScenario, ProviderFailureKind>> = {
      TIMEOUT: 'TIMEOUT',
      UPSTREAM_ERROR: 'UPSTREAM_ERROR',
      PARSER_CHANGED: 'PARSER_CHANGED',
      NO_DATA: 'NO_DATA',
    };
    const kind = scenario ? failureKinds[scenario] : undefined;
    if (kind) {
      return providerFailure(this.providerCode, kind, `mock ${this.providerCode}: ${kind}`, {
        elapsedMs,
        ...(kind === 'PARSER_CHANGED' ? { rawPayload: { unexpected: 'shape' } } : {}),
      });
    }

    const seed = seedOf(query.timeWindow.asOf);
    const items = this.buildItems(query, seed);
    if (scenario === 'PARTIAL') items.push(this.brokenItem());

    return {
      ok: true,
      providerCode: this.providerCode,
      sourceName: this.sourceName,
      sourceUri: this.sourceUri,
      retrievedAt: query.timeWindow.asOf,
      items,
      rawPayload: {
        provider: this.providerCode,
        requestedAt: query.timeWindow.asOf,
        location: query.location,
        items,
      },
      itemCount: items.length,
      parserVersion: MOCK_SITUATION_PARSER_VERSION,
      elapsedMs,
    };
  }
}

/** 기상청 — WEATHER_OBSERVATION / WEATHER_WARNING (설계 01 §20.5). */
export class MockKmaSituationProvider extends MockSituationProvider {
  readonly providerCode: ProviderCode = 'KMA';
  protected readonly sourceName = '기상청 방재기상정보 (mock)';
  protected readonly sourceUri = 'https://www.weather.go.kr/';

  protected buildItems(query: CollectSituationQuery, seed: number): RawFactItem[] {
    const items: RawFactItem[] = [];
    const asOf = query.timeWindow.asOf;

    if (wantsCategory(query, 'WEATHER_OBSERVATION')) {
      // 단위를 일부러 canonical이 아닌 것으로 준다 — 정규화가 실제로 일을
      // 하는지 E2E에서 드러나야 한다(km/h → m/s).
      items.push(
        {
          factType: 'WEATHER_OBSERVATION',
          factKey: 'temperature',
          value: 20 + (seed % 15),
          unit: '℃',
          observedAt: asOf,
          raw: { stn: '108', field: 'ta' },
        },
        {
          factType: 'WEATHER_OBSERVATION',
          factKey: 'wind_speed',
          value: 18 + (seed % 20),
          unit: 'km/h',
          observedAt: asOf,
          raw: { stn: '108', field: 'ws' },
        },
        {
          factType: 'WEATHER_OBSERVATION',
          factKey: 'rainfall_1h',
          value: seed % 40,
          unit: 'mm',
          observedAt: asOf,
          raw: { stn: '108', field: 'rn1' },
        },
      );
    }

    if (wantsCategory(query, 'WEATHER_WARNING')) {
      items.push(
        {
          factType: 'WEATHER_WARNING',
          factKey: 'hazard',
          value: query.hazardType,
          observedAt: asOf,
          raw: { wrn: 'mock' },
        },
        {
          factType: 'WEATHER_WARNING',
          factKey: 'level',
          value: seed % 2 === 0 ? 'WARNING' : 'ADVISORY',
          observedAt: asOf,
          raw: { wrn: 'mock' },
        },
      );
    }

    return items;
  }
}

/** 행정안전부 — DISASTER_MESSAGE (설계 01 §20.5). */
export class MockMoisSituationProvider extends MockSituationProvider {
  readonly providerCode: ProviderCode = 'MOIS';
  protected readonly sourceName = '행정안전부 재난문자 (mock)';
  protected readonly sourceUri = 'https://www.safekorea.go.kr/';

  protected buildItems(query: CollectSituationQuery, seed: number): RawFactItem[] {
    if (!wantsCategory(query, 'DISASTER_MESSAGE')) return [];
    const asOf = query.timeWindow.asOf;
    const area = query.location.text ?? query.location.adminCode ?? '전국';
    return [
      {
        factType: 'DISASTER_MESSAGE',
        factKey: 'message_id',
        value: `MOCK-MSG-${seed}`,
        observedAt: asOf,
        raw: { md101Sn: seed },
      },
      {
        factType: 'DISASTER_MESSAGE',
        factKey: 'disaster_type',
        value: query.hazardType,
        observedAt: asOf,
        raw: { md101Sn: seed },
      },
      {
        factType: 'DISASTER_MESSAGE',
        factKey: 'area',
        value: area,
        observedAt: asOf,
        raw: { md101Sn: seed },
      },
      {
        factType: 'DISASTER_MESSAGE',
        factKey: 'text',
        // 개인정보를 담지 않는다(security.md) — 목업이라도 형태가 본이 된다.
        value: `[${area}] ${query.hazardType} 관련 안전 안내 (mock)`,
        observedAt: asOf,
        raw: { md101Sn: seed },
      },
    ];
  }
}
