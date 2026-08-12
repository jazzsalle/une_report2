import { canonicalJson, sha256Hex } from '../canonical-json';

/**
 * 훈련·사건 종료 게이트 (CC-310, UNE-JNL-012).
 *
 * 설계 06 US-SIT-035의 인수기준은 한 줄이다 — **"종료시 미결항목·사유 누락 0"**.
 * 요약만 보여 주고 닫게 하면 그 기준을 못 지킨다. 그래서 여기서 하는 일은 둘이다.
 *
 *   1. 지금 무엇이 미결인지 **한 목록으로** 접는다.
 *   2. 그 목록의 **모든 항목에 사유 있는 처분이 붙었는지** 본다.
 *
 * 처분은 하나뿐이다: `WAIVED`(사유를 적고 그대로 닫는다). 완료·취소·이관은
 * 각자의 상태기계와 엔드포인트가 있고, 그것을 여기서 흉내 내면 상태 변경이
 * 자기 경로 밖에서 일어난다 — 0039 §1이 고친 결함이 정확히 그것이었다.
 * 닫기 전에 정리하고 싶으면 그 경로로 정리한 뒤 다시 오면 된다.
 */

/** 무엇이 종료를 막는가. 값을 만드는 코드가 있는 다섯만 있다. */
export const CLOSE_BLOCKER_KINDS = [
  'ACTIVE_RUN',
  'OPEN_TASK',
  'PENDING_DISPATCH',
  'CANDIDATE_FACT',
  'OPEN_CONFLICT',
  'UNAPPROVED_JOURNAL',
] as const;
export type CloseBlockerKind = (typeof CLOSE_BLOCKER_KINDS)[number];

export const CLOSE_BLOCKER_LABELS: Record<CloseBlockerKind, string> = {
  ACTIVE_RUN: '진행 중인 실행',
  OPEN_TASK: '끝나지 않은 임무',
  PENDING_DISPATCH: '아직 큐에 남은 전파',
  CANDIDATE_FACT: '확정되지 않은 사실',
  OPEN_CONFLICT: '해소되지 않은 사실 충돌',
  UNAPPROVED_JOURNAL: '승인되지 않은 상황일지',
};

/**
 * **처분할 수 없는 미결.**
 *
 * 나머지는 "그대로 두고 닫는다"가 성립한다 — 사람이 사유를 적고 판단한다.
 * 큐에 남은 전파는 다르다: 닫은 뒤에 릴레이가 그것을 보내려 하면 사실원장이
 * 거부하고(0045 §5), 그 실패는 dead letter로만 남는다. 즉 **닫는 순간 이미
 * 나가기로 되어 있던 지시가 죽는다.** 사유를 적는다고 살아나지 않으므로
 * 처분의 대상이 아니다 — 큐가 빌 때까지 기다리거나 전파를 취소해야 한다.
 */
const UNWAIVABLE: ReadonlySet<CloseBlockerKind> = new Set(['PENDING_DISPATCH']);

export function isWaivable(kind: string): boolean {
  return !UNWAIVABLE.has(kind as CloseBlockerKind);
}

/**
 * 처분 어휘.
 *
 * **`WAIVED` 하나다.** 설계는 완료/취소/이관/예외승인 넷을 적지만, 앞의 셋을
 * 만드는 연산은 이 엔드포인트가 아니라 각 도메인에 있다. 여기서 같은 일을 다시
 * 하면 임무 상태가 임무 상태기계 밖에서 바뀌고, 그 전이는 사실원장에도
 * 제대로 남지 않는다.
 */
export const CLOSE_DISPOSITIONS = ['WAIVED'] as const;
export type CloseDisposition = (typeof CLOSE_DISPOSITIONS)[number];

export interface CloseBlocker {
  kind: CloseBlockerKind;
  /** 막고 있는 것의 식별자(임무·실행·전파·사실·충돌·일지). */
  refId: string;
  label: string;
  /** 지금 상태. 사람이 "왜 미결인지"를 읽을 수 있어야 한다. */
  detail: string;
  /** 사유를 적고 그대로 둘 수 있는가. 전파 대기는 그럴 수 없다. */
  waivable: boolean;
}

export interface CloseGateInput {
  runs: ReadonlyArray<{ runId: string; status: string; label: string }>;
  tasks: ReadonlyArray<{ taskId: string; status: string; title: string }>;
  pendingDispatches: ReadonlyArray<{ outboxId: string; channel: string; status: string }>;
  candidateFacts: ReadonlyArray<{ factId: string; factType: string }>;
  openConflicts: ReadonlyArray<{ conflictId: string; factType: string }>;
  journals: ReadonlyArray<{ journalId: string; status: string }>;
}

/** 실행이 아직 살아 있는 상태(0036 어휘). */
const ACTIVE_RUN_STATUSES = new Set(['READY', 'RUNNING', 'PAUSED']);
/** 임무가 아직 끝나지 않은 상태(0038 어휘). */
const OPEN_TASK_STATUSES = new Set([
  'CREATED',
  'SENT',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'COMPLETION_SUBMITTED',
]);
/** 일지가 아직 승인되지 않은 상태(0042 어휘). */
const UNAPPROVED_JOURNAL_STATUSES = new Set(['DRAFT', 'REVIEW', 'CHANGES_REQUESTED']);

export function collectCloseBlockers(input: CloseGateInput): CloseBlocker[] {
  const out: CloseBlocker[] = [];

  for (const run of input.runs) {
    if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
    out.push({
      kind: 'ACTIVE_RUN',
      refId: run.runId,
      label: run.label,
      detail: `실행이 ${run.status} 상태입니다. 완료하거나 종료한 뒤 닫으십시오.`,
      waivable: true,
    });
  }
  for (const task of input.tasks) {
    if (!OPEN_TASK_STATUSES.has(task.status)) continue;
    out.push({
      kind: 'OPEN_TASK',
      refId: task.taskId,
      label: task.title,
      detail: `임무가 ${task.status} 상태입니다.`,
      waivable: true,
    });
  }
  for (const dispatch of input.pendingDispatches) {
    out.push({
      kind: 'PENDING_DISPATCH',
      refId: dispatch.outboxId,
      label: dispatch.channel,
      detail:
        `전파가 ${dispatch.status} 상태로 큐에 남아 있습니다. 닫으면 이 지시는 나가지 못하고 ` +
        `사실원장도 그것을 받지 않습니다 — 사유로 넘길 수 없습니다.`,
      waivable: false,
    });
  }
  for (const fact of input.candidateFacts) {
    out.push({
      kind: 'CANDIDATE_FACT',
      refId: fact.factId,
      label: fact.factType,
      detail: '확정되지 않은 사실입니다. 확정하지 않으면 최종 기준선에 들어가지 않습니다.',
      waivable: true,
    });
  }
  for (const conflict of input.openConflicts) {
    out.push({
      kind: 'OPEN_CONFLICT',
      refId: conflict.conflictId,
      label: conflict.factType,
      detail: '해소되지 않은 사실 충돌입니다.',
      waivable: true,
    });
  }
  for (const journal of input.journals) {
    if (!UNAPPROVED_JOURNAL_STATUSES.has(journal.status)) continue;
    out.push({
      kind: 'UNAPPROVED_JOURNAL',
      refId: journal.journalId,
      label: journal.journalId,
      detail: `상황일지가 ${journal.status} 상태입니다.`,
      waivable: true,
    });
  }
  return out;
}

export interface DispositionInput {
  refId: string;
  disposition: string;
  reason: string;
}

export interface DispositionCheck {
  /** 처분이 붙지 않은 미결. 이것이 남으면 닫지 않는다. */
  undisposed: CloseBlocker[];
  /** 사유로 넘길 수 없는 미결. 사유를 적어도 닫히지 않는다. */
  unwaivable: CloseBlocker[];
  /** 사유가 비었거나 너무 짧은 처분. */
  reasonMissing: string[];
  /** 미결에 없는 것을 처분했다 — 요청이 낡았다는 뜻이다. */
  unknown: string[];
  /** 어휘에 없는 처분. */
  invalid: string[];
}

/** 사유 한 줄은 "확인함" 같은 말로 채워질 수 있지만, 빈 칸은 막는다. */
export const CLOSE_REASON_MIN_CHARS = 2;
export const CLOSE_REASON_MAX_CHARS = 500;

export function checkDispositions(
  blockers: readonly CloseBlocker[],
  dispositions: readonly DispositionInput[],
): DispositionCheck {
  const byRef = new Map(dispositions.map((d) => [d.refId, d]));
  const blockerIds = new Set(blockers.map((b) => b.refId));

  const undisposed = blockers.filter((b) => b.waivable && !byRef.has(b.refId));
  const unwaivable = blockers.filter((b) => !b.waivable);
  const reasonMissing: string[] = [];
  const unknown: string[] = [];
  const invalid: string[] = [];

  for (const d of dispositions) {
    if (!blockerIds.has(d.refId)) {
      unknown.push(d.refId);
      continue;
    }
    if (!(CLOSE_DISPOSITIONS as readonly string[]).includes(d.disposition)) {
      invalid.push(d.refId);
      continue;
    }
    const reason = d.reason.trim();
    if (reason.length < CLOSE_REASON_MIN_CHARS || reason.length > CLOSE_REASON_MAX_CHARS) {
      reasonMissing.push(d.refId);
    }
  }
  return { undisposed, unwaivable, reasonMissing, unknown, invalid };
}

export function canClose(check: DispositionCheck): boolean {
  return (
    check.undisposed.length === 0 &&
    check.unwaivable.length === 0 &&
    check.reasonMissing.length === 0 &&
    check.unknown.length === 0 &&
    check.invalid.length === 0
  );
}

/**
 * 종료 기준선 해시.
 *
 * "무엇을 최종으로 삼고 닫았는가"를 한 값으로 굳힌다. 나중에 정정 이벤트가
 * 붙어도(0045 §5가 그것만 허용한다) 이 값은 그대로이므로, 종료 시점의 기준선과
 * 지금 사실을 비교할 수 있다.
 */
export interface ClosureBaseline {
  snapshotId: string | null;
  snapshotVersionNo: number | null;
  eventCount: number;
  lastEventId: string | null;
  journals: ReadonlyArray<{ journalId: string; status: string; projectionHash: string }>;
  runs: ReadonlyArray<{ runId: string; status: string }>;
}

export function closureBaselineHash(baseline: ClosureBaseline): string {
  return sha256Hex(
    canonicalJson({
      snapshotId: baseline.snapshotId,
      snapshotVersionNo: baseline.snapshotVersionNo,
      eventCount: baseline.eventCount,
      lastEventId: baseline.lastEventId,
      journals: [...baseline.journals]
        .map((j) => ({
          journalId: j.journalId,
          status: j.status,
          projectionHash: j.projectionHash,
        }))
        .sort((a, b) => a.journalId.localeCompare(b.journalId)),
      runs: [...baseline.runs]
        .map((r) => ({ runId: r.runId, status: r.status }))
        .sort((a, b) => a.runId.localeCompare(b.runId)),
    }),
  );
}
