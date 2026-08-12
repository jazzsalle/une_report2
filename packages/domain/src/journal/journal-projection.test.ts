import { describe, expect, it } from 'vitest';
import {
  canTransitionJournal,
  findFactContradictions,
  isJournalEditable,
  JOURNAL_SECTIONS,
  JOURNAL_STATUSES,
  projectJournal,
  projectionHash,
  touchesLockedFacts,
  type ProjectionInput,
  acceptProposal,
} from './journal-projection';

const AT = (min: number): Date => new Date(Date.UTC(2026, 7, 12, 0, min));

const input = (over: Partial<ProjectionInput> = {}): ProjectionInput => ({
  situationTitle: '집중호우',
  mode: 'LIVE',
  periodStart: AT(0),
  periodEnd: AT(60),
  snapshot: {
    snapshotId: 's1',
    versionNo: 3,
    effectiveAt: AT(5),
    facts: [
      { factType: 'DAMAGE', value: '침수' },
      { factType: 'CONTROL', value: '통제' },
    ],
  },
  events: [
    {
      eventId: 'e1',
      aggregateType: 'TASK',
      aggregateId: 't1',
      eventType: 'TASK_ACKNOWLEDGED',
      occurredAt: AT(10),
      actorId: 'u1',
      payload: { status: 'ACKNOWLEDGED' },
    },
    {
      eventId: 'e2',
      aggregateType: 'SOP_RUN',
      aggregateId: 'r1',
      eventType: 'RUN_STARTED',
      occurredAt: AT(20),
      actorId: 'u1',
      payload: {},
    },
  ],
  tasks: [
    { taskId: 't1', title: '대피 방송', nodeKey: 'a0', status: 'IN_PROGRESS', dueAt: AT(30) },
    { taskId: 't2', title: '통제선', nodeKey: 'a1', status: 'COMPLETED', dueAt: null },
  ],
  eventTypes: [],
  ...over,
});

describe('일지 상태 (CC-300)', () => {
  it('투영이 동기라 CONFIGURING·PROJECTING이 없다', () => {
    // 값을 만드는 코드가 없는 채로 어휘만 남기지 않는다.
    expect([...JOURNAL_STATUSES]).toEqual(['DRAFT', 'REVIEW', 'CHANGES_REQUESTED', 'APPROVED']);
  });

  it('승인은 끝이다 — 정정은 새 일지다', () => {
    for (const to of JOURNAL_STATUSES) {
      expect(canTransitionJournal('APPROVED', to), to).toBe(false);
    }
  });

  it('반려된 일지는 다시 검토를 요청할 수 있다', () => {
    expect(canTransitionJournal('CHANGES_REQUESTED', 'REVIEW')).toBe(true);
    expect(isJournalEditable('CHANGES_REQUESTED')).toBe(true);
  });

  it('검토 중인 일지는 편집하지 않는다', () => {
    // 검토자가 본 것과 승인된 것이 갈라지지 않게.
    expect(isJournalEditable('REVIEW')).toBe(false);
    expect(isJournalEditable('APPROVED')).toBe(false);
  });
});

describe('투영', () => {
  it('다섯 섹션을 모두 만든다 — 비어 있어도', () => {
    // "미결 없음"을 말하는 것과 그 칸이 없는 것은 다르다.
    const items = projectJournal(input({ tasks: [] }));
    expect(items.map((i) => i.sectionKey)).toEqual([...JOURNAL_SECTIONS]);
    const unresolved = items.find((i) => i.sectionKey === 'UNRESOLVED');
    expect(unresolved?.factPayload.unresolvedCount).toBe(0);
    expect(unresolved?.narrativeText).toContain('없다');
  });

  it('기간 밖의 이벤트는 담지 않는다', () => {
    const items = projectJournal(
      input({
        events: [
          {
            eventId: 'late',
            aggregateType: 'TASK',
            aggregateId: 't1',
            eventType: 'TASK_STARTED',
            occurredAt: AT(120),
            actorId: null,
            payload: {},
          },
        ],
      }),
    );
    expect(items.find((i) => i.sectionKey === 'RESPONSE_TIMELINE')?.factPayload.entryCount).toBe(0);
  });

  it('eventTypes를 주면 그 종류만 담는다', () => {
    const items = projectJournal(input({ eventTypes: ['RUN_STARTED'] }));
    const timeline = items.find((i) => i.sectionKey === 'RESPONSE_TIMELINE');
    expect(timeline?.factPayload.entryCount).toBe(1);
    expect(timeline?.sourceEventIds).toEqual(['e2']);
  });

  it('근거 이벤트를 함께 남긴다 (drill-down)', () => {
    const items = projectJournal(input());
    expect(items.find((i) => i.sectionKey === 'RESPONSE_TIMELINE')?.sourceEventIds).toEqual([
      'e1',
      'e2',
    ]);
    // 임무 집계는 임무 이벤트만 근거로 든다.
    expect(items.find((i) => i.sectionKey === 'TASK_SUMMARY')?.sourceEventIds).toEqual(['e1']);
  });

  it('사실칸의 모든 키가 잠긴다', () => {
    for (const item of projectJournal(input())) {
      expect(item.lockedFields.sort()).toEqual(Object.keys(item.factPayload).sort());
    }
  });

  it('미결은 끝나지 않은 임무만이다', () => {
    const items = projectJournal(input());
    const unresolved = items.find((i) => i.sectionKey === 'UNRESOLVED');
    expect(unresolved?.factPayload.unresolvedCount).toBe(1);
  });
});

describe('투영 해시', () => {
  it('사실이 같으면 같다', () => {
    expect(projectionHash(projectJournal(input()))).toBe(projectionHash(projectJournal(input())));
  });

  it('사실이 바뀌면 바뀐다', () => {
    const before = projectionHash(projectJournal(input()));
    const after = projectionHash(
      projectJournal(
        input({ tasks: [{ taskId: 't9', title: 'x', nodeKey: 'a', status: 'SENT', dueAt: null }] }),
      ),
    );
    expect(after).not.toBe(before);
  });

  it('서술만 바뀌면 해시는 그대로다', () => {
    // 서술을 넣으면 사람이 문장을 다듬을 때마다 "사실이 바뀌었다"는 신호가
    // 무의미해진다.
    const items = projectJournal(input());
    const before = projectionHash(items);
    const edited = items.map((i) => ({ ...i, narrativeText: '사람이 다시 쓴 문장' }));
    expect(projectionHash(edited)).toBe(before);
  });
});

describe('사실 대조 — 서술이 사실을 반박하는가', () => {
  it('같은 이름표에 다른 값이면 잡는다', () => {
    const contradictions = findFactContradictions({ taskCount: 7 }, '임무 5건을 수행했다.');
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]).toMatchObject({
      field: 'taskCount',
      factValue: 7,
      narrativeValue: 5,
    });
  });

  it('값이 같으면 잡지 않는다', () => {
    expect(findFactContradictions({ taskCount: 7 }, '임무 7건을 수행했다.')).toEqual([]);
  });

  it('빠뜨린 것은 모순이 아니다', () => {
    // 오탐이 쏟아지면 경보 피로가 생기고 방어가 없는 것보다 나빠진다.
    expect(findFactContradictions({ taskCount: 7 }, '현장 대응을 계속하고 있다.')).toEqual([]);
  });

  it('어순이 뒤집혀도 잡는다', () => {
    const found = findFactContradictions({ unresolvedCount: 2 }, '5건의 미결이 남았다.');
    expect(found.map((c) => c.narrativeValue)).toContain(5);
  });

  it('자릿수 쉼표를 읽는다', () => {
    const found = findFactContradictions({ eventCount: 1200 }, '이벤트 1,300건이 기록됐다.');
    expect(found[0]?.narrativeValue).toBe(1300);
  });

  it('사실칸에 없는 이름은 보지 않는다', () => {
    // 닫힌 집합에서만 역탐색한다 — 열린 추출을 하면 오탐이 쏟아진다.
    expect(findFactContradictions({}, '사망 3명, 부상 12명.')).toEqual([]);
  });

  it('같은 자리를 두 번 세지 않는다', () => {
    const found = findFactContradictions({ eventCount: 10 }, '이벤트 3건.');
    expect(found).toHaveLength(1);
  });
});

describe('사실칸 보호', () => {
  it('잠긴 필드를 건드리면 이름을 돌려준다', () => {
    // 대조가 있어도 구조적 분리가 하드 불변식으로 깔려 있어야 성립한다.
    expect(touchesLockedFacts(['taskCount', 'byStatus'], ['narrativeText', 'taskCount'])).toEqual([
      'taskCount',
    ]);
  });

  it('서술만 바꾸면 비어 있다', () => {
    expect(touchesLockedFacts(['taskCount'], ['narrativeText'])).toEqual([]);
  });
});

describe('사실 대조 — 오탐과 사각 (CC-300 이중검토 F4·F5)', () => {
  const input = {
    situationTitle: '침수',
    mode: 'LIVE',
    periodStart: new Date('2026-08-01T00:00:00Z'),
    periodEnd: new Date('2026-08-01T06:00:00Z'),
    snapshot: {
      snapshotId: 's1',
      versionNo: 1,
      effectiveAt: new Date('2026-08-01T00:00:00Z'),
      facts: [{ factType: 'DAMAGE' }, { factType: 'CONTROL' }],
    },
    events: [
      {
        eventId: 'e1',
        aggregateType: 'TASK',
        aggregateId: 't1',
        eventType: 'TASK_CREATED',
        occurredAt: new Date('2026-08-01T01:00:00Z'),
        actorId: 'u1',
        payload: {},
        correctsEventId: null,
      },
    ],
    tasks: [
      { taskId: 't1', title: '대피', nodeKey: 'a0', status: 'SENT', dueAt: null },
      { taskId: 't2', title: '점검', nodeKey: 'a1', status: 'COMPLETED', dueAt: null },
    ],
    eventTypes: [],
  };

  it('갓 만든 일지는 모순이 하나도 없다', () => {
    // **오탐이 상시로 뜨면 사람이 경고를 읽지 않게 된다.** 투영기가 스스로
    // 만든 문장이 자기 사실과 어긋난다고 말하면 그 순간 대조기는 신뢰를 잃는다.
    for (const item of projectJournal(input)) {
      expect(
        findFactContradictions(item.factPayload, item.narrativeText),
        `${item.sectionKey}: ${item.narrativeText}`,
      ).toEqual([]);
    }
  });

  it('다섯 절 모두에서 숫자를 바꾸면 잡는다', () => {
    // 사전에 든 키의 **기본 문형조차** 못 잡으면 한계 선언이 실제보다 넓게 읽힌다.
    for (const item of projectJournal(input)) {
      const tampered = item.narrativeText.replace(/[0-9]+/g, '999');
      if (tampered === item.narrativeText) continue; // 숫자 없는 문장은 대상이 아니다
      expect(
        findFactContradictions(item.factPayload, tampered).length,
        `${item.sectionKey}: ${tampered}`,
      ).toBeGreaterThan(0);
    }
  });

  it('문장부호 쉼표를 자릿수 쉼표로 읽지 않는다', () => {
    expect(findFactContradictions({ eventCount: 0 }, '판 v1, 사실원장 0건.')).toEqual([]);
    // 진짜 자릿수 쉼표는 읽는다.
    expect(findFactContradictions({ eventCount: 1200 }, '사실원장 1,200건.')).toEqual([]);
    expect(findFactContradictions({ eventCount: 5 }, '사실원장 1,200건.')).toHaveLength(1);
  });

  it('버전 번호를 사실 수로 읽지 않는다', () => {
    expect(
      findFactContradictions({ factCount: 2 }, '확정된 상황 판 v1에 사실 2건이 있다.'),
    ).toEqual([]);
  });

  it('흔한 한국어 변형을 잡는다', () => {
    for (const text of ['임무는 999건이다.', '임무 999건.', '999건의 임무를 냈다.']) {
      expect(findFactContradictions({ taskCount: 2 }, text), text).toHaveLength(1);
    }
  });
});

describe('제안 수락 규칙 (CC-300 D4·D5)', () => {
  const cd = [{ field: 'taskCount', factValue: 1, narrativeValue: 9, excerpt: '임무 9건' }];

  it('사실을 반박하면 반영하지 않는다 — AI에는 fail-closed', () => {
    expect(acceptProposal({ contradictions: cd, narrativeSource: 'PROJECTED' })).toBe(false);
    expect(acceptProposal({ contradictions: cd, narrativeSource: 'AI' })).toBe(false);
  });

  it('사람이 쓴 문장은 모순이 없어도 덮지 않는다', () => {
    expect(acceptProposal({ contradictions: [], narrativeSource: 'USER' })).toBe(false);
  });

  it('모순이 없고 사람 문장이 아니면 반영한다', () => {
    expect(acceptProposal({ contradictions: [], narrativeSource: 'PROJECTED' })).toBe(true);
    expect(acceptProposal({ contradictions: [], narrativeSource: 'AI' })).toBe(true);
  });
});
