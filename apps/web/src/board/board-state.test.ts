import { describe, expect, it } from 'vitest';
import type { DashboardTask, DashboardView } from './board-api';
import {
  boardScreenState,
  divergenceWarning,
  isPointInTime,
  kpiCards,
  provenanceNote,
  sortBoardTasks,
} from './board-state';

const view = (over: Partial<DashboardView> = {}): DashboardView =>
  ({
    situationId: 's',
    title: '호우',
    mode: 'LIVE',
    status: 'RUNNING',
    at: '2026-08-12T00:00:00.000Z',
    lastEventAt: '2026-08-12T00:00:00.000Z',
    stale: false,
    staleAfterMs: 120000,
    kpi: {
      total: 6,
      notDispatched: 1,
      awaitingAck: 1,
      inProgress: 2,
      completed: 1,
      unable: 1,
      cancelled: 0,
      overdue: 2,
    },
    tasks: [],
    runs: [],
    recentEvents: [],
    provenance: {
      eventCount: 12,
      truncated: false,
      timeAxis: 'occurredAt',
      taskRowFields: ['dueAt', 'title'],
      tasksWithoutEvents: 0,
      divergences: [],
    },
    ...over,
  }) as DashboardView;

const task = (over: Partial<DashboardTask>): DashboardTask =>
  ({
    taskId: 't',
    runId: 'r',
    nodeKey: 'a',
    title: '임무',
    assigneeUserId: null,
    assigneeOrgId: null,
    dueAt: null,
    progressPct: 0,
    status: 'SENT',
    overdue: false,
    ...over,
  }) as DashboardTask;

describe('전자상황판 화면 상태 (CC-290)', () => {
  it('종료된 상황은 끊김이 아니라 최종 판이다', () => {
    // 그렇지 않으면 사람이 새로고침을 반복한다.
    expect(
      boardScreenState({
        situationStatus: 'CLOSED',
        stale: true,
        lastFetchFailed: true,
        userScrolling: false,
      }),
    ).toBe('CLOSED');
  });

  it('연결 실패가 STALE보다 먼저 보인다', () => {
    expect(
      boardScreenState({
        situationStatus: 'RUNNING',
        stale: true,
        lastFetchFailed: true,
        userScrolling: false,
      }),
    ).toBe('RECONNECTING');
  });

  it('조용한 것과 끊긴 것을 구분한다', () => {
    expect(
      boardScreenState({
        situationStatus: 'RUNNING',
        stale: true,
        lastFetchFailed: false,
        userScrolling: false,
      }),
    ).toBe('STALE');
    expect(
      boardScreenState({
        situationStatus: 'RUNNING',
        stale: false,
        lastFetchFailed: false,
        userScrolling: false,
      }),
    ).toBe('LIVE');
  });

  it('스크롤 중에는 자동갱신을 멈춘 사실을 말한다', () => {
    expect(
      boardScreenState({
        situationStatus: 'RUNNING',
        stale: false,
        lastFetchFailed: false,
        userScrolling: true,
      }),
    ).toBe('PAUSED_VIEW');
  });
});

describe('KPI 표시', () => {
  it('설계 REG-01의 여섯 축이 모두 나온다', () => {
    const labels = kpiCards(view()).map((c) => c.label);
    for (const label of ['전체', '진행', '완료', '지연', '수행불가', '미수신']) {
      expect(labels, label).toContain(label);
    }
  });

  it('값을 화면이 다시 계산하지 않는다', () => {
    // 두 곳에서 세면 두 숫자가 갈라진다.
    const cards = kpiCards(view({ kpi: { ...view().kpi, overdue: 7 } }));
    expect(cards.find((c) => c.key === 'overdue')?.value).toBe(7);
  });
});

describe('과거 판 표시', () => {
  it('시점 조회는 실시간과 구분된다', () => {
    const now = new Date('2026-08-12T01:00:00.000Z');
    expect(isPointInTime(view({ at: '2026-08-12T00:00:00.000Z' }), now)).toBe(true);
    expect(isPointInTime(view({ at: '2026-08-12T00:59:59.000Z' }), now)).toBe(false);
  });
});

describe('임무 정렬', () => {
  it('지연이 먼저, 그다음 기한순', () => {
    const sorted = sortBoardTasks([
      task({ taskId: '1', nodeKey: 'c', dueAt: '2026-08-12T05:00:00.000Z' }),
      task({ taskId: '2', nodeKey: 'a', overdue: true }),
      task({ taskId: '3', nodeKey: 'b', dueAt: '2026-08-12T03:00:00.000Z' }),
    ]);
    expect(sorted.map((t) => t.taskId)).toEqual(['2', '3', '1']);
  });

  it('기한 없는 임무는 뒤로 간다', () => {
    const sorted = sortBoardTasks([
      task({ taskId: '1', nodeKey: 'z' }),
      task({ taskId: '2', nodeKey: 'y', dueAt: '2026-08-12T03:00:00.000Z' }),
    ]);
    expect(sorted.map((t) => t.taskId)).toEqual(['2', '1']);
  });
});

describe('근거 표시', () => {
  it('기한이 이벤트에서 오지 않는다는 사실을 판 위에 적는다', () => {
    // 숫자만 보이면 화면이 그것을 완전한 사실로 읽는다.
    const note = provenanceNote(view());
    expect(note).toContain('이벤트 12건');
    expect(note).toContain('occurredAt');
    expect(note).toContain('임무 행의 현재 값');
  });

  it('재생이 잘렸거나 이벤트가 빠진 임무가 있으면 그것도 적는다', () => {
    const note = provenanceNote(
      view({ provenance: { ...view().provenance, truncated: true, tasksWithoutEvents: 2 } }),
    );
    expect(note).toContain('잘렸습니다');
    expect(note).toContain('2건');
  });

  it('재생과 임무 행이 어긋나면 감추지 않는다', () => {
    // 어긋났다는 것은 어딘가에서 상태가 사실원장 밖으로 움직였다는 뜻이다.
    expect(divergenceWarning(view())).toBeNull();
    const warned = divergenceWarning(
      view({
        provenance: {
          ...view().provenance,
          divergences: [{ taskId: 't', replayed: 'SENT', stored: 'COMPLETED' }],
        },
      }),
    );
    expect(warned).toContain('1건');
    expect(warned).toContain('이벤트 없이');
  });
});
