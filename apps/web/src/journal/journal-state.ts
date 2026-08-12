import type { JournalDetail, JournalFactCell } from './journal-api';

/**
 * 상황일지 화면 규칙 (CC-300, 설계 09 SCR-JRN-001~006).
 *
 * 화면이 사실을 다시 계산하지 않는다. 서버가 확정 판과 사실원장을 접어
 * 사실칸을 주고, 여기서는 **그것이 무엇인지 사람에게 정확히 말하는 일**만
 * 한다. 특히 셋을 숨기지 않는다.
 *
 *   1. 어느 칸이 사실이고 어느 칸이 사람이 쓴 문장인가.
 *   2. 지금 보고 있는 사실이 낡았는가(드리프트).
 *   3. AI가 손댄 문장인가, 그것이 시뮬레이션인가.
 */

/** 초안과 반려 상태에서만 고친다. 검토 중에 고치면 검토자가 본 것과 갈라진다. */
export function isEditable(journalStatus: string): boolean {
  return journalStatus === 'DRAFT' || journalStatus === 'CHANGES_REQUESTED';
}

export const JOURNAL_STATUS_LABELS: Record<string, string> = {
  DRAFT: '초안',
  REVIEW: '검토 중',
  CHANGES_REQUESTED: '보완 요청됨',
  APPROVED: '승인됨',
};

export const NARRATIVE_SOURCE_LABELS: Record<string, string> = {
  PROJECTED: '투영된 기본 문장',
  AI: 'AI 제안을 반영함',
  USER: '사람이 작성함',
};

/**
 * 드리프트 배너.
 *
 * **낡은 사진이 위험한 것이 아니라, 낡았다고 말하지 않는 사진이 위험하다.**
 * 자동으로 갱신하지 않는 대신 화면이 반드시 말한다.
 */
export function driftBanner(journal: JournalDetail['journal']): string | null {
  if (!journal.drifted) return null;
  if (journal.status === 'APPROVED') {
    return '승인된 뒤 상황이 더 진행됐습니다. 이 일지는 승인 시점의 사실을 담고 있습니다 — 최신 사실은 새 일지로 만드십시오.';
  }
  if (journal.status === 'REVIEW') {
    return '검토 중에 바깥의 사실이 바뀌었습니다. 지금 승인하면 승인되는 것은 화면에 보이는 이 판입니다. 최신 사실을 담으려면 반려하고 사실을 갱신하십시오.';
  }
  return '만든 뒤 상황이 더 진행됐습니다. [사실 갱신]을 누르면 사실칸만 다시 접고, 사람이 쓴 문장은 그대로 둡니다.';
}

/** 서술이 사실을 반박하는가. 사람 편집은 막지 않되 반드시 보인다. */
export function contradictionNotes(cell: JournalFactCell): string[] {
  return cell.contradictions.map(
    (c) => `${c.field}: 사실은 ${c.factValue}인데 문장은 ${c.narrativeValue}이라고 씁니다.`,
  );
}

export function hasContradictions(detail: JournalDetail): boolean {
  return detail.cells.some((cell) => cell.contradictions.length > 0);
}

/**
 * 지금 무엇을 할 수 있는가. 버튼을 눌러 보고 실패로 배우게 하지 않는다.
 *
 * 서버가 같은 판단을 다시 한다 — 여기서 막는 것은 안내이지 통제가 아니다.
 */
export interface JournalActions {
  canEdit: boolean;
  canPropose: boolean;
  canRefresh: boolean;
  canSubmitReview: boolean;
  canDecide: boolean;
  canExport: boolean;
  exportBlockedReason: string | null;
}

export function journalActions(detail: JournalDetail): JournalActions {
  const { journal } = detail;
  const editable = isEditable(journal.status);
  // **드리프트는 Export를 막지 않는다.** 승인된 일지는 그 시점의 기록이고,
  // 살아 있는 상황에서는 승인 직후부터 사실이 계속 움직인다 — 막으면 승인된
  // 일지를 영영 내보낼 수 없다. 낡음을 막는 자리는 검토요청이다.
  const exportBlockedReason =
    journal.status !== 'APPROVED'
      ? '승인된 일지만 내보낼 수 있습니다. 검토·승인을 먼저 마치십시오.'
      : null;
  return {
    canEdit: editable,
    canPropose: editable,
    canRefresh: editable && journal.drifted,
    // 낡은 채로 검토에 넣으면 되돌아오는 길밖에 없다(검토 중에는 갱신 불가).
    canSubmitReview: editable && !journal.drifted,
    canDecide: journal.status === 'REVIEW',
    canExport: exportBlockedReason === null,
    exportBlockedReason,
  };
}

/**
 * 사실칸 표시값.
 *
 * **서버가 준 것을 그대로 그린다.** 화면이 자기 라벨 표를 따로 들면 종이에
 * 나간 문장과 화면이 갈라지고, 승인한 사람이 본 것과 나간 것이 달라진다
 * (이중검토 M-2). 문서 문단도 같은 값에서 만들어진다.
 */
export function factRows(cell: JournalFactCell): Array<[string, string]> {
  return cell.factRows.map((row) => [row.label, row.value]);
}
