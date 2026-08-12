import { describe, expect, it } from 'vitest';
import type { JournalDetail, JournalFactCell } from './journal-api';
import {
  contradictionNotes,
  driftBanner,
  factRows,
  hasContradictions,
  isEditable,
  journalActions,
} from './journal-state';

const cell = (over: Partial<JournalFactCell> = {}): JournalFactCell =>
  ({
    sectionKey: 'TASK_SUMMARY',
    title: '임무 요약',
    sortOrder: 3,
    factPayload: { taskCount: 4, completedCount: 2 },
    factRows: [
      { label: '임무 수', value: '4' },
      { label: '완료 임무', value: '2' },
    ],
    lockedFields: ['taskCount', 'completedCount'],
    sourceEventIds: [],
    narrativeText: '임무 4건 중 2건을 마쳤다.',
    narrativeSource: 'PROJECTED',
    narrativeUpdatedAt: null,
    narrativeUpdatedBy: null,
    contradictions: [],
    ...over,
  }) as JournalFactCell;

const detail = (
  journal: Partial<JournalDetail['journal']> = {},
  cells: JournalFactCell[] = [cell()],
): JournalDetail =>
  ({
    journal: {
      journalId: 'j1',
      situationId: 's1',
      snapshotId: 'sn1',
      documentId: 'd1',
      currentRevisionId: 'r2',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-02T00:00:00.000Z',
      status: 'DRAFT',
      projectionHash: 'a'.repeat(64),
      createdBy: 'u1',
      createdAt: '2026-08-02T00:00:00.000Z',
      drifted: false,
      currentProjectionHash: 'a'.repeat(64),
      ...journal,
    },
    cells,
    approvals: [],
    openReview: null,
  }) as JournalDetail;

describe('상황일지 화면 규칙 (CC-300)', () => {
  it('초안과 반려에서만 고친다', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('CHANGES_REQUESTED')).toBe(true);
    // 검토 중에 고치면 검토자가 본 것과 승인되는 것이 갈라진다.
    expect(isEditable('REVIEW')).toBe(false);
    expect(isEditable('APPROVED')).toBe(false);
  });

  it('드리프트를 상태마다 다른 말로 알린다', () => {
    expect(driftBanner(detail().journal)).toBeNull();
    expect(driftBanner(detail({ drifted: true }).journal)).toContain('사실 갱신');
    expect(driftBanner(detail({ drifted: true, status: 'REVIEW' }).journal)).toContain(
      '지금 승인하면',
    );
    expect(driftBanner(detail({ drifted: true, status: 'APPROVED' }).journal)).toContain(
      '승인 시점의 사실',
    );
  });

  it('모순을 숨기지 않고 사람이 읽을 문장으로 만든다', () => {
    const bad = cell({
      contradictions: [{ field: 'taskCount', factValue: 4, narrativeValue: 9 }],
    } as Partial<JournalFactCell>);
    expect(contradictionNotes(bad)).toEqual(['taskCount: 사실은 4인데 문장은 9이라고 씁니다.']);
    expect(hasContradictions(detail({}, [bad]))).toBe(true);
    expect(hasContradictions(detail())).toBe(false);
  });

  it('할 수 있는 일만 켠다', () => {
    const draft = journalActions(detail());
    expect(draft.canEdit).toBe(true);
    expect(draft.canRefresh).toBe(false); // 드리프트가 없으면 갱신할 것이 없다
    expect(draft.canExport).toBe(false);
    expect(draft.exportBlockedReason).toContain('승인된 일지만');
    expect(draft.canSubmitReview).toBe(true);

    const review = journalActions(detail({ status: 'REVIEW' }));
    expect(review.canEdit).toBe(false);
    expect(review.canDecide).toBe(true);

    const approved = journalActions(detail({ status: 'APPROVED' }));
    expect(approved.canExport).toBe(true);
    expect(approved.exportBlockedReason).toBeNull();

    // 승인 뒤 사실이 움직여도 내보낼 수 있다 — 승인된 것은 그 시점의 기록이고,
    // 여기서 막으면 살아 있는 상황의 일지는 영영 나가지 못한다.
    const stale = journalActions(
      detail({ status: 'APPROVED', drifted: true, currentProjectionHash: 'b'.repeat(64) }),
    );
    expect(stale.canExport).toBe(true);

    // 낡은 채로 검토에 넣지는 않는다 — 그 자리에서는 갱신할 수 있다.
    const drifting = journalActions(
      detail({ drifted: true, currentProjectionHash: 'b'.repeat(64) }),
    );
    expect(drifting.canSubmitReview).toBe(false);
    expect(drifting.canRefresh).toBe(true);
  });

  it('서버가 준 표시행을 그대로 그린다', () => {
    // 화면이 자기 라벨 표를 따로 들면 종이에 나간 것과 갈라진다 — 라벨을 만드는
    // 곳은 도메인 하나이고, 문서 문단도 같은 값에서 나온다.
    expect(factRows(cell())).toEqual([
      ['임무 수', '4'],
      ['완료 임무', '2'],
    ]);
  });
});
