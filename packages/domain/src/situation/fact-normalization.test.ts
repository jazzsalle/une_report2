import { describe, expect, it } from 'vitest';
import {
  FACT_KEY_CATALOG,
  FACT_NORMALIZATION_VERSION,
  canonicalUnitToken,
  convertUnit,
  findFactKeySpec,
  isNormalized,
  normalizeFact,
  normalizeFacts,
  normalizeTimestamp,
  type NormalizedFact,
} from '../index';

function expectNormalized(result: ReturnType<typeof normalizeFact>): NormalizedFact {
  if (!isNormalized(result)) {
    throw new Error(`expected a normalized fact, got INVALID: ${JSON.stringify(result.notes)}`);
  }
  return result;
}

describe('CC-200 fact normalization — 설계 06 US-SIT-006', () => {
  describe('#1 canonical 변환 (NORMALIZED)', () => {
    it('단위를 canonical 단위로 바꾸고 변환버전을 기록한다', () => {
      const result = expectNormalized(
        normalizeFact({
          factType: 'WEATHER_OBSERVATION',
          factKey: 'wind_speed',
          value: 36,
          unit: 'km/h',
          observedAt: '2026-08-08T09:00:00+09:00',
        }),
      );
      expect(result.outcome).toBe('NORMALIZED');
      expect(result.value).toBe(10); // 36 km/h ÷ 3.6
      expect(result.unit).toBe('m/s');
      expect(result.normalizationVersion).toBe(FACT_NORMALIZATION_VERSION);
    });

    it('원문 값·단위를 잃지 않는다 (완료조건: provenance 손실 0건)', () => {
      const result = expectNormalized(
        normalizeFact({
          factType: 'WEATHER_OBSERVATION',
          factKey: 'temperature',
          value: '77',
          unit: '°F',
        }),
      );
      expect(result.value).toBe(25); // (77-32)*5/9, 부동소수 잔재 제거됨
      expect(result.unit).toBe('degC');
      expect(result.originalValue).toBe('77');
      expect(result.originalUnit).toBe('°F');
    });

    it('시각을 명시적 오프셋과 함께 UTC로 옮긴다', () => {
      const result = expectNormalized(
        normalizeFact({
          factType: 'WEATHER_OBSERVATION',
          factKey: 'humidity',
          value: 80,
          unit: '%',
          observedAt: '2026-08-08T09:00:00+09:00',
        }),
      );
      expect(result.observedAt).toBe('2026-08-08T00:00:00.000Z');
    });

    it('단위가 없으면 추측하지 않고 검토 대상으로 내린다 (D18)', () => {
      // 화씨 77을 넣은 사용자에게 "정규화 성공, 77 degC"를 보여주지 않는다.
      const result = expectNormalized(
        normalizeFact({ factType: 'WEATHER_OBSERVATION', factKey: 'rainfall_1h', value: 12.5 }),
      );
      expect(result.outcome).toBe('ORIGINAL_KEPT');
      expect(result.value).toBe(12.5);
      expect(result.unit).toBeNull();
      expect(result.originalUnit).toBeNull();
      expect(result.notes[0]?.reason).toBe('UNIT_MISSING');
      // 어떤 단위를 기대했는지는 사용자에게 말해 준다.
      expect(result.notes[0]?.detail).toContain('mm');
    });

    it('정보가 더 적은 경우가 더 많은 경우보다 높게 판정되지 않는다', () => {
      const unitMissing = expectNormalized(
        normalizeFact({ factType: 'WEATHER_OBSERVATION', factKey: 'temperature', value: 77 }),
      );
      const unitUnconvertible = expectNormalized(
        normalizeFact({
          factType: 'WEATHER_OBSERVATION',
          factKey: 'temperature',
          value: 77,
          unit: 'rankine',
        }),
      );
      expect(unitMissing.outcome).toBe(unitUnconvertible.outcome);
    });

    it('cm 강수량을 mm로 옮긴다', () => {
      const result = expectNormalized(
        normalizeFact({
          factType: 'WEATHER_OBSERVATION',
          factKey: 'rainfall_1h',
          value: 3,
          unit: 'cm',
        }),
      );
      expect(result.value).toBe(30);
      expect(result.unit).toBe('mm');
    });
  });

  describe('A-01 단위 변환 불가 → 원문값 유지 + 검토 필요', () => {
    it('변환 규칙이 없는 단위는 원문을 그대로 두고 ORIGINAL_KEPT로 낮춘다', () => {
      const result = expectNormalized(
        normalizeFact({
          factType: 'WEATHER_OBSERVATION',
          factKey: 'wind_speed',
          value: 12,
          unit: 'furlong/fortnight',
        }),
      );
      expect(result.outcome).toBe('ORIGINAL_KEPT');
      expect(result.value).toBe(12);
      expect(result.unit).toBe('furlong/fortnight');
      expect(result.notes[0]?.reason).toBe('UNIT_UNCONVERTIBLE');
    });

    it('카탈로그 밖의 Key는 거부하지 않고 원문 보존한다 (열린 어휘)', () => {
      const result = expectNormalized(
        normalizeFact({
          factType: 'FIELD_REPORT',
          factKey: 'collapsed_buildings',
          value: 7,
          unit: '동',
        }),
      );
      expect(result.outcome).toBe('ORIGINAL_KEPT');
      expect(result.value).toBe(7);
      expect(result.unit).toBe('동');
      expect(findFactKeySpec('collapsed_buildings', 'FIELD_REPORT')).toBeUndefined();
    });

    it('같은 이름이라도 범주가 다르면 남의 규칙을 물려받지 않는다 (m-1)', () => {
      // DISASTER_MESSAGE.text는 valueKind 'string'이다. FIELD_REPORT의 자유
      // 서술 text가 그 제약에 걸려 객체 값이 422로 격리되고 있었다.
      const fieldReport = expectNormalized(
        normalizeFact({
          factType: 'FIELD_REPORT',
          factKey: 'text',
          value: { ko: '도로 침수', en: 'road flooded' },
        }),
      );
      expect(fieldReport.outcome).toBe('ORIGINAL_KEPT');
      expect(fieldReport.value).toEqual({ ko: '도로 침수', en: 'road flooded' });

      // 같은 Key라도 DISASTER_MESSAGE에서는 카탈로그 규칙이 그대로 산다.
      const message = normalizeFact({
        factType: 'DISASTER_MESSAGE',
        factKey: 'text',
        value: { ko: '객체' },
      });
      expect(message.outcome).toBe('INVALID');
      expect(message.notes[0]?.reason).toBe('VALUE_KIND_MISMATCH');
    });

    it('단위가 없어야 하는 Key에 단위가 오면 검토 대상으로 표시한다', () => {
      const result = expectNormalized(
        normalizeFact({
          factType: 'WEATHER_WARNING',
          factKey: 'level',
          value: 'WARNING',
          unit: 'mm',
        }),
      );
      expect(result.outcome).toBe('ORIGINAL_KEPT');
      expect(result.notes[0]?.reason).toBe('UNIT_UNEXPECTED');
    });
  });

  describe('E-01 필수 누락 → 후보 격리 (INVALID)', () => {
    it.each([
      ['factType 없음', { factKey: 'temperature', value: 1 }, 'FACT_TYPE_MISSING'],
      [
        'factType 미지 값',
        { factType: 'ASTROLOGY', factKey: 'temperature', value: 1 },
        'FACT_TYPE_UNKNOWN',
      ],
      ['factKey 없음', { factType: 'WEATHER_OBSERVATION', value: 1 }, 'FACT_KEY_MISSING'],
      [
        'factKey 표기 위반(대문자)',
        { factType: 'WEATHER_OBSERVATION', factKey: 'windSpeed', value: 1 },
        'FACT_KEY_MALFORMED',
      ],
      ['value 없음', { factType: 'WEATHER_OBSERVATION', factKey: 'temperature' }, 'VALUE_MISSING'],
      [
        '수치 Key에 문자열',
        { factType: 'WEATHER_OBSERVATION', factKey: 'temperature', value: '더움' },
        'VALUE_KIND_MISMATCH',
      ],
    ])('%s → %s', (_label, item, reason) => {
      const result = normalizeFact(item);
      expect(result.outcome).toBe('INVALID');
      expect(result.notes[0]?.reason).toBe(reason);
    });

    it('격리해도 원문은 남긴다 (자동삭제 0건)', () => {
      const raw = { provider: 'KMA', payload: 'anything' };
      const result = normalizeFact({ factKey: 'temperature', value: 1, raw });
      expect(result.outcome).toBe('INVALID');
      expect(result.raw).toEqual(raw);
    });
  });

  describe('E-02 시각 파싱 실패 → 후보 격리', () => {
    it('오프셋 없는 시각은 추측하지 않고 격리한다', () => {
      const result = normalizeFact({
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 20,
        observedAt: '2026-08-08T09:00:00',
      });
      expect(result.outcome).toBe('INVALID');
      expect(result.notes[0]?.reason).toBe('TIME_OFFSET_MISSING');
    });

    it('읽을 수 없는 시각은 TIME_UNPARSABLE로 구분한다', () => {
      const result = normalizeFact({
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        value: 20,
        observedAt: '어제 오후',
      });
      expect(result.outcome).toBe('INVALID');
      expect(result.notes[0]?.reason).toBe('TIME_UNPARSABLE');
    });

    it('Z 표기는 받는다', () => {
      expect(normalizeTimestamp('2026-08-08T00:00:00Z')).toEqual({
        ok: true,
        value: '2026-08-08T00:00:00.000Z',
      });
    });

    it('달력에 없는 날짜는 거부한다', () => {
      expect(normalizeTimestamp('2026-02-30T00:00:00Z').ok).toBe(false);
    });
  });

  describe('배치 — 통과분과 격리분을 나눈다', () => {
    it('부분 실패에서 둘 다 돌려준다', () => {
      const batch = normalizeFacts([
        { factType: 'WEATHER_OBSERVATION', factKey: 'temperature', value: 20, unit: 'degC' },
        { factType: 'WEATHER_OBSERVATION', factKey: 'temperature', value: '알수없음' },
        { factType: 'WEATHER_OBSERVATION', factKey: 'humidity', value: 60, unit: '%' },
      ]);
      expect(batch.normalized).toHaveLength(2);
      expect(batch.invalid).toHaveLength(1);
    });
  });

  describe('단위 표', () => {
    it('표기 변형을 하나로 모은다', () => {
      expect(canonicalUnitToken('℃')).toBe('degC');
      expect(canonicalUnitToken(' KM/H ')).toBe('km/h');
      expect(canonicalUnitToken('knots')).toBe('kt');
      expect(canonicalUnitToken('파섹')).toBeNull();
    });

    it('없는 변환 쌍은 실패를 돌려준다', () => {
      expect(convertUnit(1, 'degC', 'm/s').ok).toBe(false);
      expect(convertUnit(1, 'kt', 'm/s')).toEqual({ ok: true, value: 0.514444 });
    });
  });

  describe('카탈로그', () => {
    it('모든 표준 Key가 스키마 패턴을 만족한다', () => {
      for (const spec of FACT_KEY_CATALOG) {
        expect(spec.key).toMatch(/^[a-z][a-z0-9_.-]{1,99}$/);
      }
    });

    it('Key가 중복되지 않는다 (조회표가 조용히 덮이지 않도록)', () => {
      const keys = FACT_KEY_CATALOG.map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });
});
