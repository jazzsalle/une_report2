import { describe, expect, it } from 'vitest';
import type { CloseBlocker, ClosurePreview, Evaluation } from './evaluation-api';
import {
  closeReadiness,
  evaluationActions,
  groupBlockers,
  metricsNotice,
  satisfactionNotice,
} from './evaluation-state';

const blocker = (over: Partial<CloseBlocker> = {}): CloseBlocker =>
  ({
    kind: 'OPEN_TASK',
    refId: 't1',
    label: '방송',
    detail: '임무가 SENT 상태입니다.',
    waivable: true,
    ...over,
  }) as CloseBlocker;

const preview = (over: Partial<ClosurePreview> = {}): ClosurePreview =>
  ({
    situationId: 's1',
    status: 'RUNNING',
    blockers: [blocker()],
    closable: false,
    ...over,
  }) as ClosurePreview;

const evaluation = (over: Partial<Evaluation> = {}): Evaluation =>
  ({
    evaluationId: 'e1',
    situationId: 's1',
    status: 'OPEN',
    evaluationType: 'EXERCISE',
    overallScore: 80,
    summary: null,
    metrics: {},
    metricsStale: false,
    confirmedBy: null,
    confirmedAt: null,
    createdBy: 'u1',
    createdAt: '2026-08-12T00:00:00.000Z',
    scores: [],
    improvements: [],
    ...over,
  }) as Evaluation;

describe('종료 게이트 화면 규칙 (CC-310)', () => {
  it('미결을 종류별로 묶는다', () => {
    const grouped = groupBlockers([
      blocker({ refId: 't1' }),
      blocker({ refId: 't2' }),
      blocker({ kind: 'ACTIVE_RUN', refId: 'r1' }),
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].label).toBe('끝나지 않은 임무');
    expect(grouped[0].items).toHaveLength(2);
    expect(grouped[1].label).toBe('진행 중인 실행');
  });

  it('사유가 빈 채로 누르게 두지 않는다', () => {
    // 412를 받고서야 알게 하면 사용자가 실패를 눌러 배운다.
    const empty = closeReadiness(preview(), {});
    expect(empty.ready).toBe(false);
    expect(empty.missing).toBe(1);
    expect(empty.message).toContain('사유 없는 처분은 처분이 아닙니다');

    const blank = closeReadiness(preview(), { t1: '  ' });
    expect(blank.ready).toBe(false);

    const filled = closeReadiness(preview(), { t1: '종료 후 실물 점검 예정' });
    expect(filled.ready).toBe(true);
    expect(filled.missing).toBe(0);
  });

  it('미결이 없으면 그대로 닫을 수 있다', () => {
    const clean = closeReadiness(preview({ blockers: [], closable: true }), {});
    expect(clean.ready).toBe(true);
  });

  it('처분할 수 없는 미결은 사유를 다 적어도 닫히지 않는다', () => {
    const p = preview({
      blockers: [blocker(), blocker({ kind: 'PENDING_DISPATCH', refId: 'o1', waivable: false })],
    });
    const r = closeReadiness(p, { t1: '사후 점검', o1: '그냥 닫겠다' });
    expect(r.ready).toBe(false);
    expect(r.message).toContain('사유로 넘길 수 없습니다');
  });

  it('이미 닫힌 훈련은 다시 닫지 않는다', () => {
    const closed = closeReadiness(preview({ status: 'CLOSED', blockers: [] }), {});
    expect(closed.ready).toBe(false);
    expect(closed.message).toContain('이미 종료');
  });
});

describe('평가 화면 규칙 (CC-310)', () => {
  it('낡은 지표를 상태에 따라 다른 말로 알린다', () => {
    expect(metricsNotice(evaluation())).toBeNull();
    expect(metricsNotice(evaluation({ metricsStale: true }))).toContain(
      '자동으로 갱신되지 않습니다',
    );
    expect(metricsNotice(evaluation({ metricsStale: true, status: 'CONFIRMED' }))).toContain(
      '확정 시점의 것',
    );
  });

  it('확정된 평가는 고칠 수 없다고 말한다', () => {
    const open = evaluationActions(evaluation());
    expect(open.canAddImprovement).toBe(true);
    expect(open.canConfirm).toBe(true);
    expect(open.frozenReason).toBeNull();

    const confirmed = evaluationActions(evaluation({ status: 'CONFIRMED' }));
    expect(confirmed.canAddImprovement).toBe(false);
    expect(confirmed.canConfirm).toBe(false);
    expect(confirmed.frozenReason).toContain('새 평가');
  });

  it('만족도가 없다는 사실을 서버가 준 말로 적는다', () => {
    // 화면이 자기 문장을 지어내면 보고서와 화면이 갈라진다.
    expect(satisfactionNotice('NOT_COLLECTED', '설문 수집 경로가 없습니다.')).toBe(
      '설문 수집 경로가 없습니다.',
    );
  });
});
