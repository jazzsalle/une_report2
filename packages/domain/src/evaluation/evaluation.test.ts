import { describe, expect, it } from 'vitest';
import {
  CLOSE_DISPOSITIONS,
  canClose,
  checkDispositions,
  closureBaselineHash,
  collectCloseBlockers,
  isWaivable,
  type CloseGateInput,
} from './closure';
import {
  deriveMetrics,
  isEvaluationEditable,
  isMetricStale,
  overallScore,
  satisfactionSection,
  scoresWithoutEvidence,
  targetNeedsId,
  validateScores,
  type ScoreInput,
} from './evaluation';

const emptyGate: CloseGateInput = {
  runs: [],
  tasks: [],
  pendingDispatches: [],
  candidateFacts: [],
  openConflicts: [],
  journals: [],
};

const kpi = {
  total: 4,
  notDispatched: 0,
  awaitingAck: 1,
  inProgress: 0,
  completed: 2,
  unable: 1,
  cancelled: 0,
  overdue: 1,
};

describe('종료 게이트 (CC-310)', () => {
  it('미결이 없으면 막지 않는다', () => {
    expect(collectCloseBlockers(emptyGate)).toEqual([]);
  });

  it('다섯 종류를 한 목록으로 접는다', () => {
    const blockers = collectCloseBlockers({
      runs: [
        { runId: 'r1', status: 'RUNNING', label: '대응' },
        { runId: 'r2', status: 'COMPLETED', label: '끝난 것' },
      ],
      tasks: [
        { taskId: 't1', status: 'SENT', title: '방송' },
        { taskId: 't2', status: 'COMPLETED', title: '끝난 임무' },
        { taskId: 't3', status: 'CANCELLED', title: '접힌 임무' },
      ],
      pendingDispatches: [],
      candidateFacts: [{ factId: 'f1', factType: 'DAMAGE' }],
      openConflicts: [{ conflictId: 'c1', factType: 'DAMAGE' }],
      journals: [
        { journalId: 'j1', status: 'DRAFT' },
        { journalId: 'j2', status: 'APPROVED' },
      ],
    });
    expect(blockers.map((b) => b.kind)).toEqual([
      'ACTIVE_RUN',
      'OPEN_TASK',
      'CANDIDATE_FACT',
      'OPEN_CONFLICT',
      'UNAPPROVED_JOURNAL',
    ]);
    // 끝난 것은 세지 않는다.
    expect(blockers.map((b) => b.refId)).not.toContain('r2');
    expect(blockers.map((b) => b.refId)).not.toContain('t2');
    expect(blockers.map((b) => b.refId)).not.toContain('j2');
    // 사람이 왜 막혔는지 읽을 수 있어야 한다.
    for (const blocker of blockers) expect(blocker.detail.length).toBeGreaterThan(0);
  });

  it('처분 없는 미결이 남으면 닫지 않는다', () => {
    const blockers = collectCloseBlockers({
      ...emptyGate,
      tasks: [{ taskId: 't1', status: 'SENT', title: '방송' }],
    });
    const none = checkDispositions(blockers, []);
    expect(none.undisposed.map((b) => b.refId)).toEqual(['t1']);
    expect(canClose(none)).toBe(false);
  });

  it('사유 없는 처분은 처분이 아니다', () => {
    const blockers = collectCloseBlockers({
      ...emptyGate,
      tasks: [{ taskId: 't1', status: 'SENT', title: '방송' }],
    });
    const blank = checkDispositions(blockers, [
      { refId: 't1', disposition: 'WAIVED', reason: '  ' },
    ]);
    expect(blank.reasonMissing).toEqual(['t1']);
    expect(canClose(blank)).toBe(false);

    const ok = checkDispositions(blockers, [
      { refId: 't1', disposition: 'WAIVED', reason: '훈련 종료 후 실물 확인 예정' },
    ]);
    expect(canClose(ok)).toBe(true);
  });

  it('어휘에 없는 처분과 낡은 요청을 가려낸다', () => {
    const blockers = collectCloseBlockers({
      ...emptyGate,
      tasks: [{ taskId: 't1', status: 'SENT', title: '방송' }],
    });
    const bad = checkDispositions(blockers, [
      { refId: 't1', disposition: 'COMPLETED', reason: '끝냈음' },
      { refId: 'gone', disposition: 'WAIVED', reason: '사라진 것' },
    ]);
    // 완료·취소·이관은 각자의 엔드포인트가 한다 — 여기서 흉내 내지 않는다.
    expect(CLOSE_DISPOSITIONS).toEqual(['WAIVED']);
    expect(bad.invalid).toEqual(['t1']);
    expect(bad.unknown).toEqual(['gone']);
    expect(canClose(bad)).toBe(false);
  });

  it('큐에 남은 전파는 사유로 넘길 수 없다', () => {
    // 닫으면 릴레이가 그것을 보내려 할 때 사실원장이 거부하고 지시가 죽는다.
    // 사유를 적는다고 살아나지 않으므로 처분의 대상이 아니다.
    const blockers = collectCloseBlockers({
      ...emptyGate,
      pendingDispatches: [{ outboxId: 'o1', channel: 'SMS', status: 'PENDING' }],
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0].kind).toBe('PENDING_DISPATCH');
    expect(blockers[0].waivable).toBe(false);
    expect(isWaivable('PENDING_DISPATCH')).toBe(false);
    expect(isWaivable('OPEN_TASK')).toBe(true);

    // 사유를 적어도 닫히지 않는다.
    const check = checkDispositions(blockers, [
      { refId: 'o1', disposition: 'WAIVED', reason: '그냥 닫겠다' },
    ]);
    expect(check.unwaivable.map((b) => b.refId)).toEqual(['o1']);
    expect(canClose(check)).toBe(false);
  });

  it('기준선 해시는 순서에 흔들리지 않고 내용에 반응한다', () => {
    const base = {
      snapshotId: 's1',
      snapshotVersionNo: 2,
      eventCount: 10,
      lastEventId: 'e10',
      journals: [
        { journalId: 'j2', status: 'APPROVED', projectionHash: 'b' },
        { journalId: 'j1', status: 'APPROVED', projectionHash: 'a' },
      ],
      runs: [{ runId: 'r1', status: 'COMPLETED' }],
    };
    const reordered = { ...base, journals: [...base.journals].reverse() };
    expect(closureBaselineHash(base)).toBe(closureBaselineHash(reordered));
    expect(closureBaselineHash({ ...base, eventCount: 11 })).not.toBe(closureBaselineHash(base));
  });
});

describe('평가 지표 (CC-310)', () => {
  it('분모가 0이면 0%가 아니라 N/A다', () => {
    // "임무가 하나도 없었다"와 "하나도 못 끝냈다"는 다른 말이다(US-SIT-036 E-01).
    const empty = deriveMetrics({ ...kpi, total: 0, completed: 0, overdue: 0 });
    expect(empty.completionRate).toBeNull();
    expect(empty.overdueRate).toBeNull();

    const some = deriveMetrics(kpi);
    expect(some.completionRate).toBe(0.5);
    expect(some.overdueRate).toBe(0.25);
  });

  it('스트림이 달라지면 고정한 지표가 낡았다고 말한다', () => {
    // 해시는 DB가 낸다(summarizeEvents). 여기서 보는 것은 판정 규칙이다 —
    // **계산 시각이 달라진 것만으로는 낡지 않는다.**
    const stored = {
      eventCount: 2,
      lastEventId: 'e2',
      streamHash: 'aaa',
      computedAt: '2026-08-12T00:00:00.000Z',
    };
    expect(isMetricStale(stored, { ...stored, computedAt: '2026-08-13T00:00:00.000Z' })).toBe(
      false,
    );
    // 정정이 붙으면 스트림 해시가 달라진다.
    expect(isMetricStale(stored, { ...stored, eventCount: 3, streamHash: 'bbb' })).toBe(true);
  });
});

describe('평가 점수 (CC-310)', () => {
  const score = (over: Partial<ScoreInput> = {}): ScoreInput => ({
    criterionCode: 'DISPATCH_TIME',
    scoreValue: 80,
    weightValue: 1,
    comment: null,
    evidenceEventIds: ['e1'],
    ...over,
  });

  it('셀 수 없는 값을 막는다', () => {
    expect(validateScores([score()])).toEqual([]);
    expect(validateScores([score({ criterionCode: '  ' })])).toHaveLength(1);
    expect(validateScores([score({ weightValue: -1 })])).toHaveLength(1);
    expect(validateScores([score(), score()])).toHaveLength(1); // 같은 지표 두 번
  });

  it('저장할 수 없는 값은 막는다 — 500이 아니라 422여야 한다', () => {
    expect(validateScores([score({ scoreValue: 1e6 })])).toHaveLength(1);
    expect(validateScores([score({ weightValue: 1e6 })])).toHaveLength(1);
  });

  it('척도는 고정하지 않는다 — 지표마다 다르다', () => {
    expect(
      validateScores([score({ scoreValue: 5 }), score({ criterionCode: 'B', scoreValue: 100 })]),
    ).toEqual([]);
  });

  it('근거 없는 결론은 막지 않고 센다', () => {
    const scores = [score(), score({ criterionCode: 'QUALITATIVE', evidenceEventIds: [] })];
    expect(validateScores(scores)).toEqual([]);
    expect(scoresWithoutEvidence(scores)).toEqual(['QUALITATIVE']);
  });

  it('종합은 가중 평균이고 가중치 합이 0이면 null이다', () => {
    expect(overallScore([score({ scoreValue: 80, weightValue: 1 })])).toBe(80);
    expect(
      overallScore([
        score({ criterionCode: 'A', scoreValue: 100, weightValue: 3 }),
        score({ criterionCode: 'B', scoreValue: 60, weightValue: 1 }),
      ]),
    ).toBe(90);
    expect(overallScore([score({ weightValue: 0 })])).toBeNull();
    expect(overallScore([])).toBeNull();
  });
});

describe('보고서의 빈 자리 (CC-310)', () => {
  it('만족도는 부재를 1급 값으로 적는다', () => {
    // 빈 배열로 두면 "설문을 했는데 응답이 0건"과 구분되지 않는다.
    const section = satisfactionSection();
    expect(section.status).toBe('NOT_COLLECTED');
    expect(section.responseCount).toBe(0);
    expect(section.reason.length).toBeGreaterThan(10);
  });
});

describe('개선조치 환류 (CC-310)', () => {
  it('PLAN·SOP는 대상을 가리켜야 하고 SYSTEM은 아니다', () => {
    expect(targetNeedsId('PLAN')).toBe(true);
    expect(targetNeedsId('SOP')).toBe(true);
    expect(targetNeedsId('SYSTEM')).toBe(false);
  });

  it('확정된 평가는 고칠 수 없다', () => {
    expect(isEvaluationEditable('OPEN')).toBe(true);
    expect(isEvaluationEditable('CONFIRMED')).toBe(false);
  });
});
