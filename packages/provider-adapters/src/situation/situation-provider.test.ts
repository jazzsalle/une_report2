import { normalizeFacts } from '@une/domain';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SITUATION_PROVIDER_FLAGS,
  MOCK_SITUATION_PARSER_VERSION,
  MockKmaSituationProvider,
  MockMoisSituationProvider,
  QUERYABLE_PROVIDERS,
  createSituationProvider,
  isRetriableFailure,
  situationProviderHealth,
  type CollectSituationQuery,
  type ProviderCollectSuccess,
} from '../index';

const ASOF = '2026-08-08T09:00:00+09:00';

function query(overrides: Partial<CollectSituationQuery> = {}): CollectSituationQuery {
  return {
    situationId: '00000000-0000-4000-8000-000000000001',
    hazardType: '호우',
    location: { adminCode: '1100000000', text: '서울특별시' },
    timeWindow: { from: null, to: null, asOf: ASOF },
    categories: [],
    requestReason: null,
    requestedBy: '00000000-0000-4000-8000-0000000000aa',
    correlationId: 'corr-test',
    providerQuery: {},
    ...overrides,
  };
}

function expectOk(result: Awaited<ReturnType<MockKmaSituationProvider['collect']>>) {
  if (!result.ok) throw new Error(`expected success, got ${result.kind}: ${result.message}`);
  return result as ProviderCollectSuccess;
}

describe('CC-200 SituationProviderPort — 목업 어댑터', () => {
  it('KMA 목업은 기상 관측과 특보를 준다', async () => {
    const result = expectOk(await new MockKmaSituationProvider().collect(query()));
    expect(result.providerCode).toBe('KMA');
    expect(result.parserVersion).toBe(MOCK_SITUATION_PARSER_VERSION);
    expect(result.itemCount).toBe(result.items.length);
    expect(result.items.map((i) => i.factKey)).toContain('wind_speed');
    expect(result.items.map((i) => i.factType)).toContain('WEATHER_WARNING');
  });

  it('MOIS 목업은 재난문자를 준다', async () => {
    const result = expectOk(await new MockMoisSituationProvider().collect(query()));
    expect(result.providerCode).toBe('MOIS');
    expect(result.items.every((i) => i.factType === 'DISASTER_MESSAGE')).toBe(true);
  });

  it('categories로 범주를 좁힐 수 있다', async () => {
    const result = expectOk(
      await new MockKmaSituationProvider().collect(query({ categories: ['WEATHER_WARNING'] })),
    );
    expect(result.items.every((i) => i.factType === 'WEATHER_WARNING')).toBe(true);
  });

  it('같은 질의에 같은 응답을 준다 (난수·벽시계 없음)', async () => {
    const a = expectOk(await new MockKmaSituationProvider().collect(query()));
    const b = expectOk(await new MockKmaSituationProvider().collect(query()));
    expect(a.items).toEqual(b.items);
  });

  it('원문 페이로드를 함께 돌려준다 (provider_result 보존용)', async () => {
    const result = expectOk(await new MockKmaSituationProvider().collect(query()));
    expect(result.rawPayload).toBeDefined();
    expect(result.items.every((i) => i.raw !== undefined)).toBe(true);
  });

  it('목업 응답은 도메인 정규화를 통과한다 (canonical 단위로 바뀐다)', async () => {
    const result = expectOk(await new MockKmaSituationProvider().collect(query()));
    const batch = normalizeFacts(result.items);
    expect(batch.invalid).toHaveLength(0);
    const wind = batch.normalized.find((f) => f.factKey === 'wind_speed');
    expect(wind?.unit).toBe('m/s'); // 목업은 km/h로 준다
    const temp = batch.normalized.find((f) => f.factKey === 'temperature');
    expect(temp?.unit).toBe('degC'); // 목업은 ℃로 준다
  });

  describe('시나리오 훅 (부분 실패 재현 — 인수기준 4번)', () => {
    it('기본값은 off다 — 요청 본문으로 켤 수 없다 (ADR-33 D19)', async () => {
      // 시험 훅이 운영 요청 경로에 남으면 계약이 그 필드를 약속하게 된다.
      for (const provider of [new MockKmaSituationProvider(), new MockMoisSituationProvider()]) {
        const result = await provider.collect(
          query({ providerQuery: { mockScenario: 'TIMEOUT' } }),
        );
        expect(result.ok, `${provider.providerCode}가 요청만으로 시나리오를 탔다`).toBe(true);
      }
    });

    it('레지스트리도 기본값 off다', async () => {
      const result = await createSituationProvider('KMA').collect(
        query({ providerQuery: { mockScenario: 'TIMEOUT' } }),
      );
      expect(result.ok).toBe(true);
    });

    it.each([
      ['TIMEOUT', true],
      ['UPSTREAM_ERROR', true],
      ['PARSER_CHANGED', false],
      ['NO_DATA', false],
    ])('%s 시나리오는 실패로 답하고 재시도 여부를 명시한다', async (scenario, retriable) => {
      const result = await new MockKmaSituationProvider({ scenariosEnabled: true }).collect(
        query({ providerQuery: { mockScenario: scenario } }),
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.kind).toBe(scenario);
      expect(result.retriable).toBe(retriable);
      expect(isRetriableFailure(result.kind)).toBe(retriable);
    });

    it('PARSER_CHANGED는 원문을 남긴다 (파서 변경 진단 근거)', async () => {
      const result = await new MockKmaSituationProvider({ scenariosEnabled: true }).collect(
        query({ providerQuery: { mockScenario: 'PARSER_CHANGED' } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.rawPayload).toBeDefined();
    });

    it('Provider별로 다르게 실패시킬 수 있다', async () => {
      const providerQuery = { mockScenario: { KMA: 'TIMEOUT' } };
      const kma = await new MockKmaSituationProvider({ scenariosEnabled: true }).collect(
        query({ providerQuery }),
      );
      const mois = await new MockMoisSituationProvider({ scenariosEnabled: true }).collect(
        query({ providerQuery }),
      );
      expect(kma.ok).toBe(false);
      expect(mois.ok).toBe(true);
    });

    it('PARTIAL 시나리오는 응답은 성공하되 일부 항목이 정규화에서 탈락한다', async () => {
      const result = expectOk(
        await new MockKmaSituationProvider({ scenariosEnabled: true }).collect(
          query({ providerQuery: { mockScenario: 'PARTIAL' } }),
        ),
      );
      const batch = normalizeFacts(result.items);
      expect(batch.normalized.length).toBeGreaterThan(0);
      expect(batch.invalid).toHaveLength(1);
      // provider_job 상관식(0023 §4): PARTIAL은 오류가 있고 결과가 0보다 커야 한다.
      expect(batch.invalid.length > 0 && batch.normalized.length > 0).toBe(true);
    });

    it('알 수 없는 시나리오 값은 무시하고 정상 응답한다', async () => {
      const result = await new MockKmaSituationProvider({ scenariosEnabled: true }).collect(
        query({ providerQuery: { mockScenario: 'NUCLEAR_MELTDOWN' } }),
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('목업임을 숨기지 않는다 (CLAUDE.md)', () => {
    it('KMA/MOIS health는 MOCK이다', () => {
      expect(new MockKmaSituationProvider().health().mode).toBe('MOCK');
      expect(new MockMoisSituationProvider().health().mode).toBe('MOCK');
    });

    it('어떤 Provider도 LIVE로 보고하지 않는다', () => {
      for (const health of situationProviderHealth()) {
        expect(health.mode).toBe('MOCK');
      }
    });
  });
});

describe('CC-200 Provider 선택 — 비활성과 미계약을 구분한다', () => {
  it('기본 플래그는 전부 off다 (승인 전)', () => {
    expect(DEFAULT_SITUATION_PROVIDER_FLAGS).toEqual({
      safekorea: false,
      naver: false,
      t3q: false,
    });
  });

  it('SafeKorea/Naver는 플래그 off일 때 DISABLED로 답한다 (OB-05, E-03)', async () => {
    for (const code of ['SAFEKOREA', 'NAVER'] as const) {
      const provider = createSituationProvider(code);
      const health = provider.health();
      expect(health.available).toBe(false);
      expect(health.reason).toBe('DISABLED');
      expect(health.openBinding).toBe('OB-05');

      const result = await provider.collect(query());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe('DISABLED');
        expect(result.retriable).toBe(false);
      }
    }
  });

  it('플래그를 켜도 어댑터가 없으면 성공한 척하지 않는다', async () => {
    const provider = createSituationProvider('SAFEKOREA', { flags: { safekorea: true } });
    const result = await provider.collect(query());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('NOT_CONTRACTED');
  });

  it('T3Q 상황 API는 계약이 없어 항상 NOT_CONTRACTED다 (OB-02)', async () => {
    for (const flags of [{}, { t3q: true }]) {
      const provider = createSituationProvider('T3Q', { flags });
      expect(provider.health().openBinding).toBe('OB-02');
      const result = await provider.collect(query());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('NOT_CONTRACTED');
    }
  });

  it('조회 대상 Provider는 계약 enum과 같은 다섯이다', () => {
    expect([...QUERYABLE_PROVIDERS]).toEqual(['KMA', 'MOIS', 'SAFEKOREA', 'NAVER', 'T3Q']);
    // MANUAL은 사용자 입력이고 UNI는 상황 수집 Provider가 아니다.
    expect(QUERYABLE_PROVIDERS as readonly string[]).not.toContain('MANUAL');
    expect(QUERYABLE_PROVIDERS as readonly string[]).not.toContain('UNI');
  });

  it('비활성 Provider도 실패 결과를 돌려준다 (조용히 건너뛰지 않는다)', async () => {
    const results = await Promise.all(
      QUERYABLE_PROVIDERS.map((p) => createSituationProvider(p).collect(query())),
    );
    expect(results).toHaveLength(5);
    expect(results.every((r) => r !== undefined)).toBe(true);
  });
});
