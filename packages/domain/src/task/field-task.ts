/**
 * 현장 임무 수행 (CC-280).
 *
 * 설계 09 "Task" 상태표·SCR-TASK-001~003, 설계 10 UNE-TASK-004~012.
 *
 * CC-260이 임무를 만들었고 CC-270이 내보냈다. 여기서 사람이 받고, 착수하고,
 * 보고하고, 끝낸다.
 */

/**
 * 임무 상태.
 *
 * 설계 09는 열하나를 적지만 셋은 **관측되지 않는다**(0038 §1):
 *
 *   `DELIVERED`   수신영수증을 주는 채널이 없다(OB-06).
 *   `REJECTED`    반려하는 순간 IN_PROGRESS가 된다 — 상태가 아니라 전이다.
 *   `REASSIGNED`  재배정하면 새 담당자의 SENT가 된다. "기존담당 읽기전용"은
 *                 보는 사람 기준의 화면 표시이지 임무의 상태가 아니다.
 */
export const FIELD_TASK_STATUSES = [
  'CREATED',
  'SENT',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'COMPLETION_SUBMITTED',
  'COMPLETED',
  'UNABLE_REPORTED',
  'CANCELLED',
] as const;
export type FieldTaskStatus = (typeof FIELD_TASK_STATUSES)[number];

export function isFieldTaskStatus(v: unknown): v is FieldTaskStatus {
  return (FIELD_TASK_STATUSES as readonly unknown[]).includes(v);
}

const TASK_TRANSITIONS: Record<FieldTaskStatus, readonly FieldTaskStatus[]> = {
  // 전파되면 SENT, 전파 없이 직접 배정된 임무는 바로 수신확인할 수 있다 —
  // 모의 실행(DRY_RUN)은 전파 자체를 하지 않으므로(ADR-41 D9) CREATED에서
  // 곧장 받지 못하면 모의로는 절차를 한 걸음도 걸어볼 수 없다.
  CREATED: ['SENT', 'ACKNOWLEDGED', 'CANCELLED'],
  SENT: ['ACKNOWLEDGED', 'CANCELLED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'SENT', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETION_SUBMITTED', 'UNABLE_REPORTED', 'SENT', 'CANCELLED'],
  // 승인하면 끝, 반려하면 다시 수행 중이다. 재배정도 여기서 가능하다 —
  // 제출 내용이 부실한데 담당자가 자리를 뜬 경우가 현장에 있다.
  COMPLETION_SUBMITTED: ['COMPLETED', 'IN_PROGRESS', 'SENT', 'CANCELLED'],
  // 수행불가는 지휘자가 처리해야 한다: 다른 사람에게 넘기거나(SENT) 접는다.
  UNABLE_REPORTED: ['SENT', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionTask(from: string, to: string): boolean {
  return (TASK_TRANSITIONS[from as FieldTaskStatus] ?? []).includes(to as FieldTaskStatus);
}

/** 더 움직이지 않는 임무. */
export function isTaskSettled(status: string): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

/**
 * 실행이 끝났다고 말할 수 있는가.
 *
 * **수행불가로 남은 임무가 있으면 끝내지 않는다.** 그것을 "끝났다"로 세면
 * 아무도 하지 않은 절차 단계가 완료된 실행 안에 조용히 남는다. 지휘자가
 * 재배정하거나 접어야 비로소 실행이 끝난다.
 */
export function canCompleteRun(taskStatuses: readonly string[]): boolean {
  return (
    taskStatuses.length > 0 && taskStatuses.every((s) => s === 'COMPLETED' || s === 'CANCELLED')
  );
}

/**
 * 재배정 가능한 상태.
 *
 * 끝난 임무는 넘길 것이 없다. `canTransitionTask(status, 'SENT')`로 쓰지 않는
 * 이유: 이미 `SENT`인 임무를 **다른 사람에게** 넘기는 것이 가장 흔한
 * 재배정인데(아직 아무도 받지 않았다) 그것은 제자리 전이라 전이표에 없다.
 */
export function canReassign(status: string): boolean {
  return isFieldTaskStatus(status) && !isTaskSettled(status);
}

/** `task_event.event_type` 어휘. */
export const TASK_EVENT_TYPES = [
  'ACKNOWLEDGED',
  'STARTED',
  'PROGRESS_REPORTED',
  'COMPLETION_SUBMITTED',
  'UNABLE_REPORTED',
  'COMPLETION_APPROVED',
  'COMPLETION_REJECTED',
  'REASSIGNED',
  'ESCALATED',
  'ATTACHMENT_ADDED',
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

/** `execution_event.event_type` 어휘 중 임무가 만드는 것. */
export const TASK_EXECUTION_EVENT_TYPES = [
  // 릴레이가 전파를 끝내고 임무를 SENT로 올릴 때 남긴다. **CC-290 전에는 그
  // 전이가 사실원장 밖에서 일어났다** — 대시보드를 이벤트 재생으로 만들면서
  // 그 구멍이 기능적 결함이 됐다(ADR-43 D3).
  'TASK_SENT',
  'TASK_ACKNOWLEDGED',
  'TASK_STARTED',
  'TASK_PROGRESS_REPORTED',
  'TASK_COMPLETION_SUBMITTED',
  'TASK_UNABLE_REPORTED',
  'TASK_COMPLETED',
  'TASK_COMPLETION_REJECTED',
  'TASK_REASSIGNED',
  'TASK_ESCALATED',
  'TASK_ATTACHMENT_ADDED',
] as const;
export type TaskExecutionEventType = (typeof TASK_EXECUTION_EVENT_TYPES)[number];

/** 현장 첨부 분류 (설계 10 UNE-TASK-012). */
export const TASK_ATTACHMENT_CATEGORIES = ['PHOTO', 'DOC', 'VIDEO', 'OTHER'] as const;
export type TaskAttachmentCategory = (typeof TASK_ATTACHMENT_CATEGORIES)[number];

export function isTaskAttachmentCategory(v: unknown): v is TaskAttachmentCategory {
  return (TASK_ATTACHMENT_CATEGORIES as readonly unknown[]).includes(v);
}

/**
 * 수행불가 사유 (설계 09 SCR-TASK-003 REG-03).
 *
 * 자유서술만 받으면 "왜 안 됐는가"를 나중에 집계할 수 없다 — 훈련 평가
 * (CC-300)가 그 집계를 필요로 한다. 그래서 분류를 강제하고 서술을 함께 받는다.
 */
export const UNABLE_REASON_CODES = ['SAFETY', 'RESOURCE', 'ACCESS', 'UNCLEAR', 'OTHER'] as const;
export type UnableReasonCode = (typeof UNABLE_REASON_CODES)[number];

export function isUnableReasonCode(v: unknown): v is UnableReasonCode {
  return (UNABLE_REASON_CODES as readonly unknown[]).includes(v);
}

/** Escalation 단계 (설계 10 UNE-TASK-011 `level`). */
export const ESCALATION_LEVELS = ['L1', 'L2', 'L3'] as const;
export type EscalationLevel = (typeof ESCALATION_LEVELS)[number];

export function isEscalationLevel(v: unknown): v is EscalationLevel {
  return (ESCALATION_LEVELS as readonly unknown[]).includes(v);
}

/**
 * 완료조건.
 *
 * SOP 노드의 `config_json`에서 임무 생성 시점에 굳는다(`completion_policy_json`).
 * 승인된 SOP 버전은 불변이므로 이 사본은 시간이 지나도 같은 것을 말한다.
 */
export interface CompletionChecklistItem {
  key: string;
  label: string;
  /** 이 항목은 첨부가 있어야 충족된다. */
  requiresEvidence?: boolean;
}

export interface CompletionPolicy {
  instructions: string[];
  assigneeHint: string | null;
  checklist: CompletionChecklistItem[];
  /** 완료 보고에 최소 몇 개의 첨부가 필요한가. */
  minAttachments: number;
  /** 결과 서술을 요구하는가. 기본은 요구한다 — 아래 설명 참조. */
  requireResult: boolean;
}

/**
 * 노드 설정에서 완료조건을 읽는다.
 *
 * **`requireResult`의 기본값이 true다.** SOP를 만든 사람이 완료조건을 적지
 * 않았다는 것은 "아무 조건 없이 완료해도 된다"는 뜻이 아니라 대개 아직 적지
 * 못했다는 뜻이다. 최소한 "무엇을 했는가"는 남아야 상황일지(CC-300)가 그 칸을
 * 채울 수 있다 — 빈 완료보고는 일지에서 빈 칸이 된다.
 *
 * 반면 첨부는 기본으로 요구하지 않는다. 사진을 찍을 수 없는 임무가 실제로
 * 있고(전화 통보, 방송 요청), 못 지킬 조건을 기본값으로 걸면 현장이 아무
 * 사진이나 올려 조건을 우회한다.
 */
export function parseCompletionPolicy(raw: unknown): CompletionPolicy {
  const c = (raw ?? {}) as Record<string, unknown>;
  const instructions = Array.isArray(c.instructions)
    ? c.instructions.filter((x): x is string => typeof x === 'string')
    : [];
  const checklist = Array.isArray(c.checklist)
    ? c.checklist.flatMap((item): CompletionChecklistItem[] => {
        const i = (item ?? {}) as Record<string, unknown>;
        if (typeof i.key !== 'string' || i.key.length === 0) return [];
        return [
          {
            key: i.key,
            label: typeof i.label === 'string' ? i.label : i.key,
            requiresEvidence: i.requiresEvidence === true,
          },
        ];
      })
    : [];
  const min = typeof c.minAttachments === 'number' ? Math.trunc(c.minAttachments) : 0;
  return {
    instructions,
    assigneeHint: typeof c.assigneeHint === 'string' ? c.assigneeHint : null,
    checklist,
    minAttachments: min > 0 ? min : 0,
    requireResult: c.requireResult !== false,
  };
}

export interface CompletionSubmission {
  result: string;
  /** 충족했다고 표시한 체크리스트 key. */
  checklist: readonly string[];
  attachmentCount: number;
}

export interface CompletionViolation {
  field: string;
  reason: string;
}

/**
 * 완료 보고가 조건을 충족하는가 (UNE-TASK-007, `TASK-422-008`).
 *
 * 조건을 못 채운 완료를 받아들이면 대시보드가 "다 했다"고 말하는데 현장은
 * 그렇지 않다. 그 간극이 지휘 판단을 틀리게 한다.
 */
export function validateCompletion(
  policy: CompletionPolicy,
  submission: CompletionSubmission,
): CompletionViolation[] {
  const violations: CompletionViolation[] = [];

  if (policy.requireResult && submission.result.trim().length === 0) {
    violations.push({ field: 'result', reason: '완료 내용을 입력하십시오.' });
  }

  const checked = new Set(submission.checklist);
  const missing = policy.checklist.filter((item) => !checked.has(item.key));
  for (const item of missing) {
    violations.push({ field: `checklist.${item.key}`, reason: `완료조건 미충족: ${item.label}` });
  }

  // 증거를 요구하는 항목이 하나라도 있으면 첨부가 최소 하나는 있어야 한다.
  // 항목별로 어느 첨부가 어느 조건의 증거인지까지는 아직 묶지 않는다(수용 한계).
  const evidenceItems = policy.checklist.filter((item) => item.requiresEvidence);
  const required = Math.max(policy.minAttachments, evidenceItems.length > 0 ? 1 : 0);
  if (submission.attachmentCount < required) {
    violations.push({
      field: 'attachments',
      reason: `증빙 첨부가 ${required}개 이상 필요합니다 (현재 ${submission.attachmentCount}개).`,
    });
  }

  return violations;
}

/**
 * 진행률.
 *
 * 완료는 100이고 그 외에는 보고된 값이다. 뒤로 가는 진행률을 막지 않는다 —
 * 현장이 상황을 다시 보고 낮춰 잡는 일이 실제로 있고, 그것을 막으면 사람이
 * 거짓 숫자를 남긴다.
 */
export function normalizeProgress(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return Math.round(value * 100) / 100;
}
