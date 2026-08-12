import type { DashboardTask, DashboardView } from './board-api';

/**
 * 전자상황판의 화면 규칙 (CC-290, 설계 09 SCR-BOARD-001).
 *
 * **화면이 집계를 다시 만들지 않는다.** 서버가 이벤트를 접어 KPI를 주고,
 * 여기서는 그것을 어떻게 보일지만 정한다 — 두 곳에서 세면 두 숫자가 갈라지고,
 * 갈라졌을 때 어느 쪽이 참인지 말할 수 없다.
 */

/** C표 화면상태. */
export type BoardScreenState = 'LIVE' | 'RECONNECTING' | 'STALE' | 'PAUSED_VIEW' | 'CLOSED';

export function boardScreenState(input: {
  situationStatus: string;
  stale: boolean;
  lastFetchFailed: boolean;
  userScrolling: boolean;
}): BoardScreenState {
  // 종료된 상황은 더 갱신되지 않는다 — 그것을 "끊김"으로 보이면 사람이 새로
  // 고침을 반복한다.
  if (input.situationStatus === 'CLOSED') return 'CLOSED';
  if (input.lastFetchFailed) return 'RECONNECTING';
  if (input.stale) return 'STALE';
  if (input.userScrolling) return 'PAUSED_VIEW';
  return 'LIVE';
}

export const BOARD_SCREEN_LABELS: Record<BoardScreenState, string> = {
  LIVE: '실시간',
  RECONNECTING: '연결 재시도 중 — 아래 값은 마지막으로 받은 것입니다',
  STALE: '갱신이 멈춘 것으로 보입니다',
  PAUSED_VIEW: '스크롤 중 — 자동 갱신을 멈췄습니다',
  CLOSED: '종료된 상황의 최종 판입니다',
};

/**
 * KPI 카드 (REG-01: 전체/진행/완료/지연/실패/미수신).
 *
 * 서버가 준 이름과 화면 이름을 여기서 한 번만 잇는다.
 */
export interface KpiCard {
  key: string;
  label: string;
  value: number;
  tone: 'neutral' | 'active' | 'good' | 'warn' | 'bad';
}

export function kpiCards(view: DashboardView): KpiCard[] {
  const k = view.kpi;
  return [
    { key: 'total', label: '전체', value: k.total, tone: 'neutral' },
    { key: 'notDispatched', label: '미전파', value: k.notDispatched, tone: 'neutral' },
    { key: 'awaitingAck', label: '미수신', value: k.awaitingAck, tone: 'warn' },
    { key: 'inProgress', label: '진행', value: k.inProgress, tone: 'active' },
    { key: 'completed', label: '완료', value: k.completed, tone: 'good' },
    { key: 'unable', label: '수행불가', value: k.unable, tone: 'bad' },
    { key: 'overdue', label: '지연', value: k.overdue, tone: 'bad' },
  ];
}

/**
 * 이 판이 지금인가 과거인가.
 *
 * 과거 판을 보면서 실시간이라고 믿으면 지휘 판단이 틀린다. 화면이 그것을
 * 눈에 띄게 말해야 한다.
 */
export function isPointInTime(view: DashboardView, now: Date, toleranceMs = 5_000): boolean {
  return now.getTime() - new Date(view.at).getTime() > toleranceMs;
}

/** Task Grid 정렬 (REG-03). 지연 → 기한 임박 → 나머지. */
export function sortBoardTasks(tasks: readonly DashboardTask[]): DashboardTask[] {
  return [...tasks].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.nodeKey.localeCompare(b.nodeKey);
  });
}

/**
 * 응답이 스스로 밝힌 근거를 사람이 읽을 문장으로.
 *
 * 숫자만 보이면 화면이 그것을 완전한 사실로 읽는다. 기한처럼 이벤트가 모르는
 * 값이 섞여 있다는 것을 판 위에 적는다.
 */
export function provenanceNote(view: DashboardView): string {
  const p = view.provenance;
  const parts = [
    `이벤트 ${p.eventCount}건을 ${p.timeAxis} 기준으로 접었습니다.`,
    `${p.taskRowFields.join('·')}은(는) 임무 행의 현재 값입니다 — 그 변경이 이벤트로 남지 ` +
      '않아 과거 시점 조회에도 현재 값이 쓰입니다.',
  ];
  if (p.truncated) {
    parts.push('⚠ 이벤트가 상한에 걸려 잘렸습니다 — 이 판은 불완전합니다.');
  }
  if (p.tasksWithoutEvents > 0) {
    parts.push(`이벤트가 아직 말하지 않은 임무 ${p.tasksWithoutEvents}건은 판에서 뺐습니다.`);
  }
  return parts.join(' ');
}

/**
 * 재생과 임무 행이 어긋났다.
 *
 * **감추지 않는다.** 어긋났다는 것은 어딘가에서 상태가 사실원장 밖으로
 * 움직였다는 뜻이고, 그것이 이 항목이 세 번 찾은 결함의 형태다. 판이 조용히
 * 한쪽을 고르면 아무도 모른다.
 */
export function divergenceWarning(view: DashboardView): string | null {
  const n = view.provenance.divergences.length;
  if (n === 0) return null;
  return (
    `⚠ 임무 ${n}건에서 사실원장 재생과 저장된 상태가 다릅니다. ` +
    '어딘가에서 상태가 이벤트 없이 바뀌었다는 뜻입니다 — 관리자에게 알리십시오.'
  );
}
