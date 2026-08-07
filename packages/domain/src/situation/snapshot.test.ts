import { describe, expect, it } from 'vitest';
import {
  checkSnapshotConfirmable,
  diffSnapshots,
  nextSnapshotVersion,
  nextStatusOnSnapshotConfirmed,
  snapshotContentHash,
  type SnapshotFact,
} from '../index';

function fact(overrides: Partial<SnapshotFact> = {}): SnapshotFact {
  return {
    factId: '00000000-0000-4000-8000-000000000001',
    factType: 'WEATHER_OBSERVATION',
    factKey: 'temperature',
    value: 25,
    unit: 'degC',
    source: {
      providerCode: 'KMA',
      sourceName: '기상청 (mock)',
      sourceUrl: null,
      collectedAt: '2026-08-08T00:00:00.000Z',
    },
    observedAt: '2026-08-08T00:00:00.000Z',
    collectedAt: '2026-08-08T00:00:00.000Z',
    confidence: null,
    status: 'CANDIDATE',
    ...overrides,
  };
}

const EFFECTIVE = '2026-08-08T00:00:00.000Z';

describe('CC-210 snapshot hash — 설계 06 US-SIT-008 #3', () => {
  it('같은 사실 집합은 순서가 달라도 같은 해시다', () => {
    const a = fact({ factId: 'aaaaaaaa-0000-4000-8000-000000000001' });
    const b = fact({ factId: 'bbbbbbbb-0000-4000-8000-000000000002', factKey: 'humidity' });
    expect(snapshotContentHash([a, b], EFFECTIVE)).toBe(snapshotContentHash([b, a], EFFECTIVE));
  });

  it('64자리 소문자 hex다 (0025 §6 CHECK와 같은 형식)', () => {
    expect(snapshotContentHash([fact()], EFFECTIVE)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('확정자·시각·사유는 해시에 들어가지 않는다', () => {
    // 같은 사실을 다른 사람이 다시 확정해도 "내용이 같은가"를 물을 수 있어야 한다.
    const base = snapshotContentHash([fact()], EFFECTIVE);
    expect(snapshotContentHash([fact()], EFFECTIVE)).toBe(base);
  });

  it('effectiveAt이 다르면 다른 해시다 (기준시각은 사실의 일부)', () => {
    expect(snapshotContentHash([fact()], EFFECTIVE)).not.toBe(
      snapshotContentHash([fact()], '2026-08-09T00:00:00.000Z'),
    );
  });

  it('값이 같아도 근거가 다르면 다른 해시다', () => {
    const a = snapshotContentHash(
      [fact({ factId: 'aaaaaaaa-0000-4000-8000-000000000001' })],
      EFFECTIVE,
    );
    const b = snapshotContentHash(
      [fact({ factId: 'bbbbbbbb-0000-4000-8000-000000000002' })],
      EFFECTIVE,
    );
    expect(a).not.toBe(b);
  });

  it('값이 바뀌면 해시가 바뀐다', () => {
    expect(snapshotContentHash([fact()], EFFECTIVE)).not.toBe(
      snapshotContentHash([fact({ value: 26 })], EFFECTIVE),
    );
  });
});

describe('CC-210 확정 선행조건 — 미해결 충돌 차단 (인수기준 1)', () => {
  const base = {
    facts: [
      {
        factId: 'f1',
        factType: 'WEATHER_OBSERVATION',
        factKey: 'temperature',
        status: 'CANDIDATE',
        hasSource: true,
      },
      {
        factId: 'f2',
        factType: 'WEATHER_OBSERVATION',
        factKey: 'humidity',
        status: 'CANDIDATE',
        hasSource: true,
      },
    ],
    openConflictCount: 0,
  };

  it('정상 경우에는 막지 않는다', () => {
    expect(checkSnapshotConfirmable({ ...base, requestedFactIds: ['f1', 'f2'] })).toEqual([]);
  });

  it('OPEN 충돌이 있으면 막는다 — 자동으로 하나를 고르지 않는다', () => {
    const blockers = checkSnapshotConfirmable({
      ...base,
      requestedFactIds: ['f1'],
      openConflictCount: 2,
    });
    expect(blockers.map((b) => b.reason)).toContain('UNRESOLVED_CONFLICT');
    expect(blockers[0].detail).toContain('2');
  });

  it('선택이 비면 막는다', () => {
    expect(
      checkSnapshotConfirmable({ ...base, requestedFactIds: [] }).map((b) => b.reason),
    ).toContain('NO_FACTS_SELECTED');
  });

  it('출처 없는 Fact는 막는다 (SIT-422-006)', () => {
    const blockers = checkSnapshotConfirmable({
      facts: [
        {
          factId: 'f1',
          factType: 'WEATHER_OBSERVATION',
          factKey: 'temperature',
          status: 'CANDIDATE',
          hasSource: false,
        },
      ],
      openConflictCount: 0,
      requestedFactIds: ['f1'],
    });
    expect(blockers.map((b) => b.reason)).toContain('FACT_WITHOUT_SOURCE');
  });

  it('거부·대체된 Fact는 막는다', () => {
    for (const status of ['REJECTED', 'SUPERSEDED']) {
      const blockers = checkSnapshotConfirmable({
        facts: [
          {
            factId: 'f1',
            factType: 'WEATHER_OBSERVATION',
            factKey: 'temperature',
            status,
            hasSource: true,
          },
        ],
        openConflictCount: 0,
        requestedFactIds: ['f1'],
      });
      expect(
        blockers.map((b) => b.reason),
        status,
      ).toContain('FACT_NOT_SELECTABLE');
    }
  });

  it('이미 확정된 Fact는 재확정에 다시 담을 수 있다 (M-2)', () => {
    // CANDIDATE만 받으면 v1에서 확정한 사실이 v2에 담기지 못해 현재 기준
    // Snapshot에서 사라지고, Diff가 지운 적 없는 사실을 REMOVED로 보고한다.
    const blockers = checkSnapshotConfirmable({
      facts: [
        {
          factId: 'f1',
          factType: 'WEATHER_OBSERVATION',
          factKey: 'temperature',
          status: 'CONFIRMED',
          hasSource: true,
        },
      ],
      openConflictCount: 0,
      requestedFactIds: ['f1'],
    });
    expect(blockers).toEqual([]);
  });

  it('다른 상황의 Fact는 막는다', () => {
    expect(
      checkSnapshotConfirmable({ ...base, requestedFactIds: ['남의-fact'] }).map((b) => b.reason),
    ).toContain('FACT_NOT_IN_SITUATION');
  });

  it('같은 범주·표준 Key를 두 번 확정할 수 없다', () => {
    const blockers = checkSnapshotConfirmable({
      facts: [
        {
          factId: 'f1',
          factType: 'WEATHER_OBSERVATION',
          factKey: 'temperature',
          status: 'CANDIDATE',
          hasSource: true,
        },
        {
          factId: 'f2',
          factType: 'WEATHER_OBSERVATION',
          factKey: 'temperature',
          status: 'CANDIDATE',
          hasSource: true,
        },
      ],
      openConflictCount: 0,
      requestedFactIds: ['f1', 'f2'],
    });
    expect(blockers.map((b) => b.reason)).toContain('DUPLICATE_FACT_KEY');
  });

  it('범주가 다르면 같은 Key라도 함께 확정할 수 있다', () => {
    // 그룹화가 (범주, Key)로 묶으므로 확정 축도 같아야 한다.
    const blockers = checkSnapshotConfirmable({
      facts: [
        {
          factId: 'f1',
          factType: 'USER_ASSERTED',
          factKey: 'value',
          status: 'CANDIDATE',
          hasSource: true,
        },
        {
          factId: 'f2',
          factType: 'FIELD_REPORT',
          factKey: 'reporter',
          status: 'CANDIDATE',
          hasSource: true,
        },
      ],
      openConflictCount: 0,
      requestedFactIds: ['f1', 'f2'],
    });
    expect(blockers).toEqual([]);
  });
});

describe('CC-210 버전과 상태 전이', () => {
  it('첫 확정은 v1, 재확정은 v+1이다 (재확정은 새 snapshotId)', () => {
    expect(nextSnapshotVersion(null)).toBe(1);
    expect(nextSnapshotVersion(1)).toBe(2);
    expect(nextSnapshotVersion(7)).toBe(8);
  });

  it('확정이 상황을 CONTEXT_CONFIRMED로 올린다', () => {
    expect(nextStatusOnSnapshotConfirmed('DRAFT')).toBe('CONTEXT_CONFIRMED');
    expect(nextStatusOnSnapshotConfirmed('REGISTERED')).toBe('CONTEXT_CONFIRMED');
  });

  it('그 이후 상태는 되돌리지 않는다 (재확정이 진행 중인 상황을 뒤로 밀지 않는다)', () => {
    for (const status of ['CONTEXT_CONFIRMED', 'SOP_READY', 'RUNNING', 'PAUSED']) {
      expect(nextStatusOnSnapshotConfirmed(status)).toBe(status);
    }
  });
});

describe('CC-210 Snapshot Diff (인수기준 4)', () => {
  const v1: SnapshotFact[] = [
    fact({ factId: 'a1', factKey: 'temperature', value: 25 }),
    fact({ factId: 'a2', factKey: 'humidity', value: 60, unit: '%' }),
  ];

  it('추가·삭제·변경·유지를 센다', () => {
    const v2: SnapshotFact[] = [
      fact({ factId: 'b1', factKey: 'temperature', value: 27 }), // 변경(근거도 바뀜)
      fact({ factId: 'b3', factKey: 'rainfall_1h', value: 12, unit: 'mm' }), // 추가
    ];
    const diff = diffSnapshots(v1, v2);
    expect({
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
      unchanged: diff.unchanged,
    }).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 0 });
  });

  it('근거(factId)만 바뀌고 값이 같으면 UNCHANGED다', () => {
    // Key 기준 비교의 이유 — 매 확정마다 다른 Provider를 고를 수 있다.
    const v2 = [
      fact({ factId: 'z1', factKey: 'temperature', value: 25 }),
      fact({ factId: 'z2', factKey: 'humidity', value: 60, unit: '%' }),
    ];
    const diff = diffSnapshots(v1, v2);
    expect(diff.unchanged).toBe(2);
    expect(diff.changed).toBe(0);
    const entry = diff.entries.find((e) => e.factKey === 'temperature');
    // 근거가 바뀐 사실은 from/to의 factId로 드러난다.
    expect(entry?.from?.factId).toBe('a1');
    expect(entry?.to?.factId).toBe('z1');
  });

  it('객체 값의 키 순서 차이를 변경이라 부르지 않는다', () => {
    const before = [fact({ factKey: 'damage', value: { a: 1, b: 2 } })];
    const after = [fact({ factId: 'other', factKey: 'damage', value: { b: 2, a: 1 } })];
    expect(diffSnapshots(before, after).changed).toBe(0);
  });

  it('단위만 달라도 변경이다', () => {
    const before = [fact({ factKey: 'rainfall_1h', value: 10, unit: 'mm' })];
    const after = [fact({ factId: 'other', factKey: 'rainfall_1h', value: 10, unit: 'cm' })];
    expect(diffSnapshots(before, after).changed).toBe(1);
  });

  it('빈 Snapshot끼리는 차이가 없다', () => {
    expect(diffSnapshots([], []).entries).toEqual([]);
  });

  it('항목이 표준 Key 순으로 정렬된다', () => {
    const diff = diffSnapshots(v1, []);
    expect(diff.entries.map((e) => e.factKey)).toEqual(['humidity', 'temperature']);
  });
});
