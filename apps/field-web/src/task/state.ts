/**
 * 현장 화면의 상태 규칙 (CC-280, 설계 09 SCR-TASK-001~003).
 *
 * **화면이 판단을 새로 만들지 않는다.** 서버가 상태를 주고 여기서는 그 상태에서
 * 무엇을 누를 수 있는지만 고른다 — 버튼을 숨기는 것은 편의이지 통제가 아니고,
 * 통제는 서버가 다시 한다(설계 09 §3.2).
 */

export const FIELD_STEPS = [
  'SENT',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'COMPLETION_SUBMITTED',
  'COMPLETED',
] as const;
export type FieldStep = (typeof FIELD_STEPS)[number];

export type FieldAction =
  | 'ACKNOWLEDGE'
  | 'START'
  | 'REPORT_PROGRESS'
  | 'SUBMIT_COMPLETION'
  | 'REPORT_UNABLE'
  | 'ADD_ATTACHMENT';

/**
 * 지금 담당자가 할 수 있는 것.
 *
 * `CREATED`에서도 수신확인할 수 있다 — 모의 실행은 전파를 하지 않으므로
 * (ADR-41 D9) 그렇지 않으면 모의로 절차를 한 걸음도 걸어볼 수 없다.
 */
export function availableActions(status: string, isAssignee: boolean): FieldAction[] {
  if (!isAssignee) return [];
  switch (status) {
    case 'CREATED':
    case 'SENT':
      return ['ACKNOWLEDGE'];
    case 'ACKNOWLEDGED':
      return ['START'];
    case 'IN_PROGRESS':
      // `ADD_ATTACHMENT`는 아직 없다. 업로드 흐름이 파일 API와 이어지기 전까지
      // 돌려주면 화면에 없는 버튼을 어휘가 약속하게 된다(ADR-42 수용 한계 8).
      return ['REPORT_PROGRESS', 'SUBMIT_COMPLETION', 'REPORT_UNABLE'];
    // 제출 후에는 지휘자 차례다. 첨부만 더할 수 있게 두면 "검토 중인 내용이
    // 바뀌는" 상태가 되므로 그것도 막는다.
    default:
      return [];
  }
}

/** 화면 Stepper에서 몇 번째 칸인가. -1이면 정상 흐름 밖이다. */
export function stepIndex(status: string): number {
  return (FIELD_STEPS as readonly string[]).indexOf(status);
}

/**
 * 화면 상단에 뜨는 한 줄 (설계 09 SCR-TASK-001 C표 "화면상태").
 *
 * `REASSIGNED`·`REJECTED`는 임무 상태가 아니라 **보는 사람 기준의 표시**다
 * (0038 §1). 그래서 여기서 계산한다.
 */
export function screenState(input: {
  status: string;
  isAssignee: boolean;
  /** 담당자가 지정돼 있는가. 조직에만 배정되면 사람은 비어 있다. */
  hasAssignee: boolean;
  runStatus: string;
  lastEventType: string | null;
}): { key: string; label: string; tone: 'info' | 'action' | 'warn' | 'done' } {
  if (!input.isAssignee) {
    // **셋을 구분한다.** 사람이 배정돼 있으면 그 사람에게 넘어간 것이고,
    // 비어 있으면 아직 아무에게도 배정되지 않았거나 조직에만 배정된 것이다.
    // 하나로 뭉쳐 "넘어갔다"고 말하면 화면이 사실이 아닌 문장을 낸다.
    return input.hasAssignee
      ? { key: 'REASSIGNED', label: '다른 담당자에게 넘어간 임무입니다', tone: 'info' }
      : { key: 'UNASSIGNED', label: '담당자가 아직 지정되지 않았습니다', tone: 'warn' };
  }
  if (input.runStatus !== 'RUNNING') {
    return {
      key: 'RUN_NOT_ACTIVE',
      label: `실행이 진행 중이 아닙니다 (${input.runStatus})`,
      tone: 'warn',
    };
  }
  switch (input.status) {
    case 'CREATED':
    case 'SENT':
      return { key: 'SENT', label: '수신확인이 필요합니다', tone: 'action' };
    case 'ACKNOWLEDGED':
      return { key: 'ACKNOWLEDGED', label: '착수해 주십시오', tone: 'action' };
    case 'IN_PROGRESS':
      return input.lastEventType === 'COMPLETION_REJECTED'
        ? {
            key: 'REJECTED',
            label: '완료가 반려되었습니다 — 보완 후 다시 제출하십시오',
            tone: 'warn',
          }
        : { key: 'IN_PROGRESS', label: '수행 중입니다', tone: 'action' };
    case 'COMPLETION_SUBMITTED':
      return { key: 'SUBMITTED', label: '지휘자 검토를 기다리는 중입니다', tone: 'info' };
    case 'COMPLETED':
      return { key: 'COMPLETED', label: '완료되었습니다', tone: 'done' };
    case 'UNABLE_REPORTED':
      return {
        key: 'UNABLE',
        label: '수행불가로 보고했습니다 — 지휘자 처리를 기다립니다',
        tone: 'warn',
      };
    case 'CANCELLED':
      return { key: 'CANCELLED', label: '취소된 임무입니다', tone: 'info' };
    default:
      return { key: input.status, label: input.status, tone: 'info' };
  }
}

/**
 * 실제/훈련 배지 (설계 09 SCR-TASK-001 REG-01, 인수기준).
 *
 * **색상만으로 구분하지 않는다** — 텍스트와 기호를 함께 낸다. 색각 이상이 있는
 * 사람이 훈련을 실제로 착각하면 그 대가가 크다.
 */
export function modeBadge(runMode: string): { text: string; mark: string; tone: 'live' | 'drill' } {
  if (runMode === 'LIVE') return { text: '실제 상황', mark: '●', tone: 'live' };
  if (runMode === 'EXERCISE') return { text: '훈련', mark: '▲', tone: 'drill' };
  return { text: '모의(발송 없음)', mark: '◆', tone: 'drill' };
}

/**
 * 완료 제출 전 화면이 미리 거르는 것.
 *
 * 서버가 같은 것을 다시 본다(`validateCompletion`). 여기서 보는 이유는 현장이
 * 네트워크가 나쁜 곳에서 제출하고 422를 받는 왕복을 줄이기 위해서다.
 */
export function completionBlockers(
  policy: {
    checklist: { key: string; label: string; requiresEvidence?: boolean }[];
    minAttachments: number;
    requireResult: boolean;
  },
  draft: { result: string; checked: readonly string[]; attachmentCount: number },
): string[] {
  const blockers: string[] = [];
  if (policy.requireResult && draft.result.trim().length === 0) {
    blockers.push('완료 내용을 입력하십시오.');
  }
  const checked = new Set(draft.checked);
  for (const item of policy.checklist) {
    if (!checked.has(item.key)) blockers.push(`완료조건 미충족: ${item.label}`);
  }
  // **서버와 같은 규칙이다**(`validateCompletion`). 증거를 요구하는 항목이 하나라도
  // 있으면 첨부가 최소 하나 필요하다 — 화면이 `minAttachments`만 보면 제출 버튼을
  // 열어 주고 서버가 422를 내서, 미리 거르는 목적 자체가 무력해진다.
  const needsEvidence = policy.checklist.some((item) => item.requiresEvidence === true);
  const required = Math.max(policy.minAttachments, needsEvidence ? 1 : 0);
  if (draft.attachmentCount < required) {
    blockers.push(
      // 첨부 UI가 아직 없으므로(ADR-42 수용 한계 8) 이 임무는 현장 앱에서
      // 완료할 수 없다. 그 사실을 감추면 사람이 버튼을 계속 누른다.
      `증빙 첨부가 ${required}개 이상 필요합니다 (현재 ${draft.attachmentCount}개). ` +
        '현장 앱에는 아직 첨부 등록 화면이 없어 지휘소에 요청해야 합니다.',
    );
  }
  return blockers;
}
