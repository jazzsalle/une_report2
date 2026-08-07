import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DUPLICATE_STRATEGY,
  DUPLICATE_STRATEGIES,
  detectConflicts,
  groupDuplicates,
  isSelectableCandidate,
  type FactForGrouping,
} from '../index';

function fact(overrides: Partial<FactForGrouping> = {}): FactForGrouping {
  return {
    factId: 'f1',
    factKey: 'temperature',
    factType: 'WEATHER_OBSERVATION',
    value: 25,
    unit: 'degC',
    observedAt: '2026-08-08T00:00:00.000Z',
    collectedAt: '2026-08-08T00:05:00.000Z',
    providerCode: 'KMA',
    sourceId: 's1',
    status: 'CANDIDATE',
    ...overrides,
  };
}

describe('CC-210 중복군 — 설계 06 US-SIT-006 #2/#3', () => {
  it('같은 Key·같은 시간창의 후보를 묶는다', () => {
    const groups = groupDuplicates([
      fact({ factId: 'a', providerCode: 'KMA' }),
      fact({ factId: 'b', providerCode: 'MOIS', observedAt: '2026-08-08T00:30:00.000Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberFactIds).toEqual(['a', 'b']);
    expect(groups[0].strategy).toBe(DEFAULT_DUPLICATE_STRATEGY);
    // 그룹 키에 범주가 들어간다(M-1).
    expect(groups[0].groupKey).toContain('WEATHER_OBSERVATION');
    expect(groups[0].factType).toBe('WEATHER_OBSERVATION');
  });

  it('창을 벗어나면 다른 그룹이고, 혼자면 그룹이 아니다', () => {
    const groups = groupDuplicates([
      fact({ factId: 'a', observedAt: '2026-08-08T00:00:00.000Z' }),
      fact({ factId: 'b', observedAt: '2026-08-08T09:00:00.000Z' }),
    ]);
    // 각 창에 하나씩 — 0025 §1의 member_count >= 2를 만족하지 못한다.
    expect(groups).toEqual([]);
  });

  it('KEY_ONLY 전략은 시각을 무시한다', () => {
    const groups = groupDuplicates(
      [
        fact({ factId: 'a', observedAt: '2026-08-08T00:00:00.000Z' }),
        fact({ factId: 'b', observedAt: '2026-08-08T09:00:00.000Z' }),
      ],
      { strategy: 'KEY_ONLY' },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].memberFactIds).toEqual(['a', 'b']);
  });

  it('범주가 다르면 같은 Key라도 섞이지 않는다 (M-1)', () => {
    // USER_ASSERTED/temperature("체감상 더움")와 WEATHER_OBSERVATION/temperature(25)가
    // 한 그룹이 되면 허위 VALUE 충돌이 열려 확정이 막힌다.
    const groups = groupDuplicates([
      fact({ factId: 'a', factType: 'WEATHER_OBSERVATION', value: 25 }),
      fact({ factId: 'b', factType: 'USER_ASSERTED', value: '체감상 더움', unit: null }),
    ]);
    expect(groups).toEqual([]);
  });

  it('다른 Key는 섞이지 않는다', () => {
    const groups = groupDuplicates([
      fact({ factId: 'a', factKey: 'temperature' }),
      fact({ factId: 'b', factKey: 'humidity' }),
    ]);
    expect(groups).toEqual([]);
  });

  it('후보가 아닌 Fact는 대상이 아니다 (끝난 판단을 되살리지 않는다)', () => {
    for (const status of ['CONFIRMED', 'REJECTED', 'SUPERSEDED']) {
      const groups = groupDuplicates([
        fact({ factId: 'a', status }),
        fact({ factId: 'b', providerCode: 'MOIS' }),
      ]);
      expect(groups, status).toEqual([]);
    }
  });

  it('결정적이다 — 입력 순서가 결과를 바꾸지 않는다', () => {
    const a = fact({ factId: 'a' });
    const b = fact({ factId: 'b', providerCode: 'MOIS' });
    expect(groupDuplicates([a, b])).toEqual(groupDuplicates([b, a]));
  });

  it('threshold를 버리지 않고 그대로 싣는다', () => {
    const groups = groupDuplicates(
      [fact({ factId: 'a' }), fact({ factId: 'b', providerCode: 'MOIS' })],
      { threshold: 0.8 },
    );
    expect(groups[0].threshold).toBe(0.8);
  });

  it('전략 어휘가 0025의 CHECK와 같다', () => {
    expect([...DUPLICATE_STRATEGIES]).toEqual(['KEY_TIME_WINDOW', 'KEY_ONLY']);
  });

  it('관측시각이 없으면 수집시각으로 대신한다', () => {
    const groups = groupDuplicates([
      fact({ factId: 'a', observedAt: null, collectedAt: '2026-08-08T00:00:00.000Z' }),
      fact({
        factId: 'b',
        providerCode: 'MOIS',
        observedAt: null,
        collectedAt: '2026-08-08T00:20:00.000Z',
      }),
    ]);
    expect(groups).toHaveLength(1);
  });
});

describe('CC-210 충돌 판정 — 설계 06 US-SIT-006 #4', () => {
  it('값이 다르면 VALUE 충돌이다', () => {
    const facts = [
      fact({ factId: 'a', value: 25 }),
      fact({ factId: 'b', value: 27, providerCode: 'MOIS' }),
    ];
    const conflicts = detectConflicts(facts, groupDuplicates(facts));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictType).toBe('VALUE');
    expect(conflicts[0].candidateFactIds).toEqual(['a', 'b']);
    // 충돌의 단위는 그룹의 단위와 같다(B-1).
    expect(conflicts[0].groupKey).toBe(groupDuplicates(facts)[0].groupKey);
    expect(conflicts[0].detail).toContain('KMA');
  });

  it('값은 같고 시각이 다르면 TIME 충돌이다', () => {
    const facts = [
      fact({ factId: 'a', observedAt: '2026-08-08T00:00:00.000Z' }),
      fact({ factId: 'b', providerCode: 'MOIS', observedAt: '2026-08-08T00:30:00.000Z' }),
    ];
    const conflicts = detectConflicts(facts, groupDuplicates(facts));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictType).toBe('TIME');
  });

  it('값도 시각도 같으면 충돌이 아니라 중복이다', () => {
    // 설계 06 #3: 다른 Provider의 동일내용은 duplicate group이지 conflict가 아니다.
    const facts = [fact({ factId: 'a' }), fact({ factId: 'b', providerCode: 'MOIS' })];
    const groups = groupDuplicates(facts);
    expect(groups).toHaveLength(1);
    expect(detectConflicts(facts, groups)).toEqual([]);
  });

  it('단위가 다르면 값이 다르다 (25 degC ≠ 25 degF)', () => {
    const facts = [
      fact({ factId: 'a', unit: 'degC' }),
      fact({ factId: 'b', unit: 'degF', providerCode: 'MOIS' }),
    ];
    expect(detectConflicts(facts, groupDuplicates(facts))[0]?.conflictType).toBe('VALUE');
  });

  it('객체 값의 키 순서 차이는 충돌이 아니다', () => {
    const facts = [
      fact({ factId: 'a', factKey: 'damage', value: { a: 1, b: 2 }, unit: null }),
      fact({
        factId: 'b',
        factKey: 'damage',
        value: { b: 2, a: 1 },
        unit: null,
        providerCode: 'MOIS',
      }),
    ];
    expect(detectConflicts(facts, groupDuplicates(facts))).toEqual([]);
  });

  it('그룹이 없으면 충돌도 없다', () => {
    expect(detectConflicts([fact()], [])).toEqual([]);
  });

  it('충돌은 값을 바꾸지 않는다 (자동 덮어쓰기 금지)', () => {
    const facts = [
      fact({ factId: 'a', value: 25 }),
      fact({ factId: 'b', value: 27, providerCode: 'MOIS' }),
    ];
    const before = JSON.stringify(facts);
    detectConflicts(facts, groupDuplicates(facts));
    expect(JSON.stringify(facts)).toBe(before);
  });
});

describe('CC-210 해소 대상 검증', () => {
  it('그룹 밖의 Fact는 선택할 수 없다', () => {
    const conflict = { candidateFactIds: ['a', 'b'] };
    expect(isSelectableCandidate(conflict, 'a')).toBe(true);
    expect(isSelectableCandidate(conflict, 'c')).toBe(false);
  });
});
