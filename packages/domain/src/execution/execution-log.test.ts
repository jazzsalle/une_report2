import { describe, expect, it } from 'vitest';
import {
  applyCorrections,
  buildCorrectionPayload,
  computeKpi,
  CORRECTABLE_EVENT_TYPES,
  CORRECTION_VALUE_MAX_CHARS,
  DASHBOARD_STALE_AFTER_MS,
  executionEventHash,
  findDivergences,
  foldTaskStates,
  isDashboardStale,
  PROTECTED_CORRECTION_FIELDS,
  validateCorrection,
  type FoldableEvent,
} from './execution-log';

const ev = (
  eventId: string,
  aggregateId: string,
  eventType: string,
  minutes: number,
  payload: Record<string, unknown> = {},
  correctsEventId: string | null = null,
): FoldableEvent => ({
  eventId,
  aggregateType: 'TASK',
  aggregateId,
  eventType,
  occurredAt: new Date(Date.UTC(2026, 7, 12, 0, minutes)),
  payload,
  correctsEventId,
});

const AT = new Date(Date.UTC(2026, 7, 12, 1, 0));

describe('정정 규칙 (CC-290)', () => {
  it('사람이 보고한 사실만 정정할 수 있다', () => {
    // 시스템 관측 이벤트는 "그때 그렇게 했다"는 기록이라 그 자체로 참이다.
    for (const type of CORRECTABLE_EVENT_TYPES) {
      expect(
        validateCorrection({
          targetEventType: type,
          targetIsCorrection: false,
          reason: '오타',
          replacementFields: { note: '고침' },
        }),
        type,
      ).toEqual([]);
    }
    for (const type of ['TASK_ACKNOWLEDGED', 'TASK_COMPLETED', 'TASK_SENT', 'RUN_COMPLETED']) {
      const violations = validateCorrection({
        targetEventType: type,
        targetIsCorrection: false,
        reason: '오타',
        replacementFields: { note: 'x' },
      });
      expect(
        violations.map((v) => v.field),
        type,
      ).toContain('eventId');
    }
  });

  it('정정을 다시 정정할 수 없다 — 원본을 정정한다', () => {
    // 사슬이면 "지금 사실"에 답하려고 재귀를 따라가야 하고, 한 줄이 빠지면
    // 답이 없다.
    const violations = validateCorrection({
      targetEventType: 'TASK_PROGRESS_REPORTED',
      targetIsCorrection: true,
      reason: '또 고침',
      replacementFields: { note: 'x' },
    });
    expect(violations[0].reason).toContain('원본을 정정');
  });

  it('사유 없는 정정을 받지 않는다', () => {
    const violations = validateCorrection({
      targetEventType: 'TASK_PROGRESS_REPORTED',
      targetIsCorrection: false,
      reason: '   ',
      replacementFields: { note: 'x' },
    });
    expect(violations.map((v) => v.field)).toContain('reason');
  });

  it('바꿀 값이 없으면 정정이 아니다', () => {
    const violations = validateCorrection({
      targetEventType: 'TASK_PROGRESS_REPORTED',
      targetIsCorrection: false,
      reason: '고침',
      replacementFields: {},
    });
    expect(violations.map((v) => v.field)).toContain('replacementFields');
  });

  it('status를 정정으로 바꿀 수 없다', () => {
    // 허용하면 "과거 이력에 현재 상태가 붙던" CC-280의 결함을 정정 경로로
    // 다시 들여오는 셈이다.
    expect([...PROTECTED_CORRECTION_FIELDS]).toContain('status');
    for (const field of PROTECTED_CORRECTION_FIELDS) {
      const violations = validateCorrection({
        targetEventType: 'TASK_PROGRESS_REPORTED',
        targetIsCorrection: false,
        reason: '고침',
        replacementFields: { [field]: 'X' },
      });
      expect(
        violations.map((v) => v.field),
        field,
      ).toContain(`replacementFields.${field}`);
    }
  });

  it('정정 payload는 병합된 전체이고 원본 해시를 싣는다', () => {
    // 읽는 쪽이 매번 체인을 재생하지 않아도 되게 완성본을 남긴다. 원본 해시는
    // 원본이 (어떤 경로로든) 바뀌면 그 사실이 드러나게 한다.
    const payload = buildCorrectionPayload({
      effectivePayload: { note: '옛 값', progressPct: 40, status: 'IN_PROGRESS' },
      replacementFields: { note: '새 값' },
      reason: '오타',
      correctedEventId: 'e1',
      correctedEventType: 'TASK_PROGRESS_REPORTED',
      correctedEventHash: 'a'.repeat(64),
    });
    expect(payload.note).toBe('새 값');
    // 건드리지 않은 값도 완성본에 남는다.
    expect(payload.progressPct).toBe(40);
    expect(payload.status).toBe('IN_PROGRESS');
    expect(payload.correctedEventHash).toBe('a'.repeat(64));
    expect(payload.replacementFields).toEqual({ note: '새 값' });
  });

  it('해시는 내용이 바뀌면 바뀐다', () => {
    const base = {
      situationId: 's',
      aggregateType: 'TASK',
      aggregateId: 't',
      eventType: 'TASK_PROGRESS_REPORTED',
      payload: { note: 'a' },
    };
    expect(executionEventHash(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(executionEventHash(base)).toBe(executionEventHash({ ...base }));
    expect(executionEventHash({ ...base, payload: { note: 'b' } })).not.toBe(
      executionEventHash(base),
    );
  });
});

describe('정정 반영', () => {
  it('원본 자리에 가장 나중 정정의 값이 들어간다', () => {
    const events = [
      ev('e1', 't1', 'TASK_PROGRESS_REPORTED', 10, { note: '처음', status: 'IN_PROGRESS' }),
      ev(
        'c1',
        't1',
        'EXECUTION_EVENT_CORRECTED',
        20,
        { note: '한번', status: 'IN_PROGRESS' },
        'e1',
      ),
      ev(
        'c2',
        't1',
        'EXECUTION_EVENT_CORRECTED',
        30,
        { note: '두번', status: 'IN_PROGRESS' },
        'e1',
      ),
    ];
    const applied = applyCorrections(events);
    // 정정 이벤트 자체는 목록에서 빠지고 원본 한 줄만 남는다.
    expect(applied).toHaveLength(1);
    expect(applied[0].eventId).toBe('e1');
    expect(applied[0].payload.note).toBe('두번');
    expect(applied[0].correctedBy).toBe('c2');
  });

  it('정정이 없으면 원본 그대로다', () => {
    const applied = applyCorrections([ev('e1', 't1', 'TASK_STARTED', 10, { note: 'x' })]);
    expect(applied[0].correctedBy).toBeNull();
    expect(applied[0].payload.note).toBe('x');
  });
});

describe('임무 상태 재생', () => {
  it('애그리거트별 마지막 이벤트의 status를 취한다', () => {
    const events = [
      ev('e1', 't1', 'TASK_CREATED', 10, { status: 'CREATED' }),
      ev('e2', 't1', 'TASK_SENT', 20, { status: 'SENT' }),
      ev('e3', 't1', 'TASK_ACKNOWLEDGED', 30, { status: 'ACKNOWLEDGED' }),
      ev('e4', 't2', 'TASK_CREATED', 15, { status: 'CREATED' }),
    ];
    const states = foldTaskStates(events, AT);
    expect(states.get('t1')?.status).toBe('ACKNOWLEDGED');
    expect(states.get('t2')?.status).toBe('CREATED');
  });

  it('시점 이후의 이벤트는 보지 않는다 — 그때의 판이 나와야 한다', () => {
    const events = [
      ev('e1', 't1', 'TASK_CREATED', 10, { status: 'CREATED' }),
      ev('e2', 't1', 'TASK_ACKNOWLEDGED', 50, { status: 'ACKNOWLEDGED' }),
    ];
    const at = new Date(Date.UTC(2026, 7, 12, 0, 30));
    expect(foldTaskStates(events, at).get('t1')?.status).toBe('CREATED');
  });

  it('상태를 들고 있지 않은 이벤트는 상태를 바꾸지 않는다', () => {
    // 첨부·Escalation처럼 상태를 움직이지 않는 이벤트가 있다.
    const events = [
      ev('e1', 't1', 'TASK_ACKNOWLEDGED', 10, { status: 'ACKNOWLEDGED' }),
      ev('e2', 't1', 'TASK_ESCALATED', 20, { level: 'L2' }),
    ];
    expect(foldTaskStates(events, AT).get('t1')?.status).toBe('ACKNOWLEDGED');
  });

  it('정정 이벤트는 새 관측이 아니다 — 상태를 되돌리지 않는다', () => {
    // 걸러내지 않으면 정정이 그 임무의 마지막 이벤트가 되고, 정정한 시각과
    // 원본에서 딸려 온 status가 이겨 완료된 임무가 진행으로 되돌아간다.
    const events = [
      ev('e1', 't1', 'TASK_PROGRESS_REPORTED', 10, { status: 'IN_PROGRESS' }),
      ev('e2', 't1', 'TASK_COMPLETED', 20, { status: 'COMPLETED' }),
      ev('c1', 't1', 'EXECUTION_EVENT_CORRECTED', 30, { status: 'IN_PROGRESS' }, 'e1'),
    ];
    expect(foldTaskStates(events, AT).get('t1')?.status).toBe('COMPLETED');
  });

  it('같은 시각이면 목록 순서가 이긴다 (저장소가 전순서로 넘긴다)', () => {
    const events = [
      ev('e1', 't1', 'TASK_SENT', 10, { status: 'SENT' }),
      ev('e2', 't1', 'TASK_ACKNOWLEDGED', 10, { status: 'ACKNOWLEDGED' }),
    ];
    expect(foldTaskStates(events, AT).get('t1')?.status).toBe('ACKNOWLEDGED');
  });

  it('진행률과 근거 이벤트를 함께 복원한다', () => {
    const events = [
      ev('e1', 't1', 'TASK_STARTED', 10, { status: 'IN_PROGRESS' }),
      ev('e2', 't1', 'TASK_PROGRESS_REPORTED', 20, { status: 'IN_PROGRESS', progressPct: 40 }),
    ];
    const projected = foldTaskStates(events, AT).get('t1');
    expect(projected?.progressPct).toBe(40);
    // KPI에서 사실원장으로 내려가는 길.
    expect(projected?.statusEventId).toBe('e2');
  });

  it('임무가 아닌 애그리거트는 세지 않는다', () => {
    const run: FoldableEvent = {
      ...ev('e1', 'r1', 'RUN_STARTED', 10, { status: 'RUNNING' }),
      aggregateType: 'SOP_RUN',
    };
    expect(foldTaskStates([run], AT).size).toBe(0);
  });
});

describe('KPI', () => {
  const task = (taskId: string, dueMinutes: number | null) => ({
    taskId,
    dueAt: dueMinutes === null ? null : new Date(Date.UTC(2026, 7, 12, 0, dueMinutes)),
  });

  it('상태별로 나눈다', () => {
    const states = new Map([
      ['a', { status: 'CREATED' }],
      ['b', { status: 'SENT' }],
      ['c', { status: 'IN_PROGRESS' }],
      ['d', { status: 'COMPLETED' }],
      ['e', { status: 'UNABLE_REPORTED' }],
      ['f', { status: 'CANCELLED' }],
    ]);
    const kpi = computeKpi(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => task(id, null)),
      states,
      AT,
    );
    expect(kpi).toEqual({
      total: 6,
      notDispatched: 1,
      awaitingAck: 1,
      inProgress: 1,
      completed: 1,
      unable: 1,
      cancelled: 1,
      overdue: 0,
    });
  });

  it('그 시점에 아직 없던 임무는 세지 않는다', () => {
    // 이벤트가 말하지 않은 임무는 그때 존재하지 않았다. **뺄셈 잔여값이 아니라
    // 센 것만 센다** — 그래야 체계적 이벤트 결손이 작아진 숫자로 숨지 않는다.
    const kpi = computeKpi(
      [task('a', null), task('b', null)],
      new Map([['a', { status: 'SENT' }]]),
      AT,
    );
    expect(kpi.total).toBe(1);
    expect(kpi.awaitingAck).toBe(1);
  });

  it('끝난 임무는 기한을 넘겨도 지연이 아니다', () => {
    const states = new Map([
      ['late', { status: 'IN_PROGRESS' }],
      ['done', { status: 'COMPLETED' }],
      ['gone', { status: 'CANCELLED' }],
    ]);
    const kpi = computeKpi([task('late', 10), task('done', 10), task('gone', 10)], states, AT);
    expect(kpi.overdue).toBe(1);
  });

  it('기한이 없으면 지연도 없다', () => {
    const kpi = computeKpi([task('a', null)], new Map([['a', { status: 'IN_PROGRESS' }]]), AT);
    expect(kpi.overdue).toBe(0);
  });
});

describe('재생과 임무 행의 어긋남', () => {
  it('같으면 비어 있고 다르면 그 임무를 말한다', () => {
    // "이벤트가 정본"이면 빠진 이벤트는 "그 일이 없었다"로 조용히 읽힌다 —
    // 대조하지 않으면 아무도 모른다.
    const tasks = [
      { taskId: 'a', currentStatus: 'SENT' },
      { taskId: 'b', currentStatus: 'COMPLETED' },
    ];
    const states = new Map([
      ['a', { status: 'SENT' }],
      ['b', { status: 'ACKNOWLEDGED' }],
    ]);
    expect(findDivergences(tasks, states)).toEqual([
      { taskId: 'b', replayed: 'ACKNOWLEDGED', stored: 'COMPLETED' },
    ]);
  });

  it('이벤트가 아예 없는 임무도 어긋남이다', () => {
    expect(findDivergences([{ taskId: 'a', currentStatus: 'SENT' }], new Map())).toEqual([
      { taskId: 'a', replayed: null, stored: 'SENT' },
    ]);
  });
});

describe('정정 값 상한', () => {
  it('너무 길거나 깊은 값을 받지 않는다', () => {
    // 사실원장은 append-only라 나중에 마스킹도 삭제도 할 수 없다.
    let deep: unknown = 'x';
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    const base = {
      targetEventType: 'TASK_PROGRESS_REPORTED',
      targetIsCorrection: false,
      reason: '고침',
    };
    expect(
      validateCorrection({ ...base, replacementFields: { note: deep } }).map((v) => v.field),
    ).toContain('replacementFields.note');
    expect(
      validateCorrection({
        ...base,
        replacementFields: { note: 'y'.repeat(CORRECTION_VALUE_MAX_CHARS + 1) },
      }),
    ).toHaveLength(1);
    expect(validateCorrection({ ...base, replacementFields: { note: '정상' } })).toHaveLength(0);
  });
});

describe('판이 살아 있는가', () => {
  it('마지막 이벤트가 오래되면 STALE이다', () => {
    const now = new Date(Date.UTC(2026, 7, 12, 1, 0));
    const fresh = new Date(now.getTime() - 1_000);
    const old = new Date(now.getTime() - DASHBOARD_STALE_AFTER_MS - 1);
    expect(isDashboardStale(fresh, now)).toBe(false);
    expect(isDashboardStale(old, now)).toBe(true);
  });

  it('이벤트가 하나도 없으면 STALE이라 말하지 않는다', () => {
    // 아직 아무 일도 없었던 것과 갱신이 끊긴 것은 다르다.
    expect(isDashboardStale(null, new Date())).toBe(false);
  });
});
