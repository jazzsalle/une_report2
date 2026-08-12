import type { CloseBlocker, ClosurePreview, Evaluation } from './evaluation-api';

/**
 * 종료·평가 화면 규칙 (CC-310, 설계 09 SCR-EVAL-001~004).
 *
 * 화면이 판단을 다시 만들지 않는다. 서버가 미결을 접어 주고, 여기서는 그것을
 * 사람에게 정확히 말하는 일만 한다. 특히 셋을 숨기지 않는다.
 *
 *   1. 왜 못 닫는가 — 목록과 이유.
 *   2. 사유 없는 처분은 처분이 아니다 — 누르기 전에 알려 준다.
 *   3. 지표가 낡았는가 — 정정이 붙었는데 숫자는 그대로다.
 */

export const CLOSE_BLOCKER_LABELS: Record<string, string> = {
  ACTIVE_RUN: '진행 중인 실행',
  OPEN_TASK: '끝나지 않은 임무',
  PENDING_DISPATCH: '아직 큐에 남은 전파 (사유로 넘길 수 없음)',
  CANDIDATE_FACT: '확정되지 않은 사실',
  OPEN_CONFLICT: '해소되지 않은 사실 충돌',
  UNAPPROVED_JOURNAL: '승인되지 않은 상황일지',
};

export const EVALUATION_STATUS_LABELS: Record<string, string> = {
  OPEN: '작성 중',
  CONFIRMED: '확정됨',
};

/** 종류별로 묶어 보여 준다 — 스무 줄의 평면 목록은 읽히지 않는다. */
export function groupBlockers(
  blockers: readonly CloseBlocker[],
): Array<{ kind: string; label: string; items: CloseBlocker[] }> {
  const byKind = new Map<string, CloseBlocker[]>();
  for (const blocker of blockers) {
    const list = byKind.get(blocker.kind) ?? [];
    list.push(blocker);
    byKind.set(blocker.kind, list);
  }
  return [...byKind.entries()].map(([kind, items]) => ({
    kind,
    label: CLOSE_BLOCKER_LABELS[kind] ?? kind,
    items,
  }));
}

/**
 * 지금 닫을 수 있는가.
 *
 * 서버가 같은 판단을 다시 한다 — 여기서 막는 것은 안내이지 통제가 아니다.
 * 다만 **사유가 빈 채로 누르게 두지는 않는다**: 412를 받고서야 알게 하면
 * 사용자가 실패를 눌러 배운다.
 */
export function closeReadiness(
  preview: ClosurePreview | null,
  reasons: Record<string, string>,
): { ready: boolean; missing: number; message: string } {
  if (!preview) return { ready: false, missing: 0, message: '미결을 먼저 확인하십시오.' };
  if (preview.status === 'CLOSED') {
    return { ready: false, missing: 0, message: '이미 종료된 훈련입니다.' };
  }
  if (preview.blockers.length === 0) {
    return { ready: true, missing: 0, message: '정리할 미결이 없습니다.' };
  }
  // 처분할 수 없는 미결이 하나라도 있으면 사유를 다 적어도 닫히지 않는다.
  const unwaivable = preview.blockers.filter((b) => !b.waivable).length;
  const missing = preview.blockers.filter(
    (b) => b.waivable && (reasons[b.refId] ?? '').trim().length < 2,
  ).length;
  if (unwaivable > 0) {
    return {
      ready: false,
      missing,
      message: `${unwaivable}건은 사유로 넘길 수 없습니다 — 먼저 정리해야 닫힙니다.`,
    };
  }
  return {
    ready: missing === 0,
    missing,
    message:
      missing === 0
        ? '모든 미결에 사유를 적었습니다. 그대로 두고 닫습니다.'
        : `${missing}건에 사유가 없습니다. 사유 없는 처분은 처분이 아닙니다.`,
  };
}

/**
 * 지표가 낡았다는 말.
 *
 * **다시 계산해서 보여 주지 않는다.** 평가는 사람이 확정하는 문서이고, 화면이
 * 몰래 새 숫자를 그리면 확정된 값과 보이는 값이 갈라진다(ADR-45 D4).
 */
export function metricsNotice(evaluation: Evaluation): string | null {
  if (!evaluation.metricsStale) return null;
  return evaluation.status === 'CONFIRMED'
    ? '확정 뒤에 원 이벤트가 정정됐습니다. 이 평가서의 숫자는 확정 시점의 것입니다 — 다시 내려면 새 평가가 필요합니다.'
    : '평가를 만든 뒤 원 이벤트가 정정됐습니다. 아래 숫자는 산출 시점의 것이며 자동으로 갱신되지 않습니다.';
}

export interface EvaluationActions {
  canAddImprovement: boolean;
  canConfirm: boolean;
  frozenReason: string | null;
}

export function evaluationActions(evaluation: Evaluation): EvaluationActions {
  const open = evaluation.status === 'OPEN';
  return {
    canAddImprovement: open,
    canConfirm: open,
    frozenReason: open ? null : '확정된 평가는 고칠 수 없습니다. 정정은 새 평가입니다.',
  };
}

/** 보고서가 비운 자리를 화면도 같은 말로 비운다. */
export function satisfactionNotice(status: string, reason: string): string {
  return status === 'NOT_COLLECTED' ? reason : '';
}
