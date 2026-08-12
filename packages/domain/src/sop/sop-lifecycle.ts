import type { SopGraphDraft, SopGraphViolation, SopMappingWarning } from './sop-graph';
import { validateSopGraph } from './sop-graph';

/**
 * SOP 수명주기 — 편집·검증·검토·승인 (CC-250).
 *
 * 설계 10 UNE-SOP-003~009, 설계 09 SCR-SOP-004/005.
 *
 * CC-240이 만든 것은 DRAFT 그래프였다. 여기서 그것을 사람이 고치고, 검증하고,
 * 검토에 올리고, 승인해 **버전을 고정**한다.
 */

/** 0035 §1이 넓힌 어휘. `RETIRED`는 폐기 경로가 생길 때 온다. */
export const SOP_LIFECYCLE_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED'] as const;
export type SopLifecycleStatus = (typeof SOP_LIFECYCLE_STATUSES)[number];

/**
 * 상태 전이.
 *
 * **APPROVED에서 나가는 길이 없다.** 승인된 절차를 고치는 것은 새 버전이지
 * 상태 되돌리기가 아니다(비협상 규칙: 정정은 새 버전이고 감사 이력을
 * 덮어쓰지 않는다). 반려(IN_REVIEW → DRAFT)는 그 엔드포인트가 생길 때 연다 —
 * 지금 넣으면 그 전이를 만드는 코드가 없는 채로 규칙만 남는다.
 */
const TRANSITIONS: Record<SopLifecycleStatus, readonly SopLifecycleStatus[]> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED'],
  APPROVED: [],
};

export function canTransitionSop(from: string, to: string): boolean {
  return (TRANSITIONS[from as SopLifecycleStatus] ?? []).includes(to as SopLifecycleStatus);
}

/**
 * 캔버스 편집이 가능한 상태.
 *
 * **검토 중에는 못 고친다.** 검토자가 보는 그래프가 발밑에서 바뀌면 무엇을
 * 검토한 것인지 말할 수 없다 — EvidenceSet 동결(0031)과 같은 이유다.
 * 승인 후에는 새 SOP 버전을 만들 수 없다(APPROVED는 종착이다).
 */
export function canEditSopGraph(status: string): boolean {
  return status === 'DRAFT';
}

/**
 * 검증 보고 (`sop_validation`).
 *
 * **오류와 경고를 가르는 기준은 "이 절차를 실행할 수 있는가"다.**
 *
 * 구조 위반(`SopGraphViolation`)은 전부 오류다 — 시작이 없거나, 끝이 없거나,
 * 끊긴 간선이 있거나, 순환하거나, 종료 뒤로 이어지는 절차는 실행기가 무엇을
 * 할지 알 수 없다. 고립 노드도 오류다: 실행되지 않을 노드를 절차에 남기면
 * 그 노드를 믿은 사람이 하지 않은 일을 했다고 여긴다.
 *
 * 매핑 경고(`SopMappingWarning`)는 경고다 — 제목이 없거나 담당이 비어 있어도
 * 절차는 돈다. 다만 **승인 화면에 반드시 보여야 한다**: 담당 없는 임무를
 * 승인하면 실행 단계에서 아무도 배정되지 않는다.
 *
 * `MISSING_TASK`만 예외로 오류다. 임무가 없는 ACTION 노드는 "무언가 하라"는
 * 말만 있고 무엇을 할지가 없다 — 실행할 수 없는 절차다.
 */
export const SOP_VALIDATION_STATUSES = ['PASS', 'FAIL'] as const;
export type SopValidationStatus = (typeof SOP_VALIDATION_STATUSES)[number];

/** 검증기 버전. 규칙이 바뀌면 올린다 — 과거 PASS가 무슨 규칙 아래였는지 남는다. */
export const SOP_VALIDATOR_VERSION = 'sop-validator-1';

export interface SopValidationIssue {
  code: SopGraphViolation | SopMappingWarning;
  /** 어느 노드의 문제인가. 그래프 전체 문제면 null. */
  nodeKey: string | null;
  message: string;
}

export interface SopValidationReport {
  status: SopValidationStatus;
  errors: SopValidationIssue[];
  warnings: SopValidationIssue[];
  validatorVersion: string;
}

const VIOLATION_MESSAGES: Record<SopGraphViolation, string> = {
  NO_START: '시작 노드가 없습니다.',
  NO_END: '종료 노드가 없습니다.',
  MULTIPLE_START: '시작 노드가 둘 이상입니다.',
  ORPHAN_NODE: '흐름에 연결되지 않은 노드가 있습니다.',
  DANGLING_EDGE: '존재하지 않는 노드를 가리키는 연결이 있습니다.',
  CYCLE: '절차가 순환합니다.',
  DECISION_WITHOUT_BRANCH: '분기 노드에 조건식이나 갈래가 없습니다.',
  DUPLICATE_NODE_KEY: '노드 키가 중복됩니다.',
  EDGE_FROM_END: '종료 노드에서 나가는 연결이 있습니다.',
};

const WARNING_MESSAGES: Record<SopMappingWarning, string> = {
  MISSING_TITLE: '노드 제목이 없습니다.',
  MISSING_TASK: '실행 노드에 임무가 없습니다.',
  MISSING_ASSIGNEE: '임무에 담당이 지정되지 않았습니다.',
  MISSING_DECISION_EXPRESSION: '분기 조건식이 없습니다.',
  NO_SOURCE_REFS: '근거 출처가 없습니다.',
  UNKNOWN_FIELD_DROPPED: 'provider가 보낸 알 수 없는 필드를 버렸습니다.',
  NODE_KEY_NORMALIZED: 'provider가 준 노드 키를 규칙에 맞게 고쳤습니다.',
  TITLE_TRUNCATED: '제목이 길어 잘렸습니다.',
  SOURCE_OUT_OF_SCOPE: '동결 근거 범위 밖 문서를 출처로 듭니다.',
};

/** 절차를 실행할 수 없게 만드는 매핑 경고. */
const BLOCKING_WARNINGS: ReadonlySet<SopMappingWarning> = new Set<SopMappingWarning>([
  'MISSING_TASK',
]);

export function buildSopValidationReport(
  graph: SopGraphDraft,
  nodeWarnings: ReadonlyArray<{ nodeKey: string; warnings: readonly SopMappingWarning[] }> = [],
): SopValidationReport {
  const errors: SopValidationIssue[] = validateSopGraph(graph).map((code) => ({
    code,
    nodeKey: null,
    message: VIOLATION_MESSAGES[code],
  }));
  const warnings: SopValidationIssue[] = [];

  for (const node of nodeWarnings) {
    for (const code of node.warnings) {
      const issue: SopValidationIssue = {
        code,
        nodeKey: node.nodeKey,
        message: WARNING_MESSAGES[code] ?? code,
      };
      if (BLOCKING_WARNINGS.has(code)) errors.push(issue);
      else warnings.push(issue);
    }
  }

  return {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    errors,
    warnings,
    validatorVersion: SOP_VALIDATOR_VERSION,
  };
}

/**
 * 승인 선행조건.
 *
 * 검증을 통과하지 않은 절차를 승인하면, 실행할 수 없는 절차가 "승인됨"으로
 * 남는다 — 그리고 승인은 되돌릴 수 없다.
 */
export function canApproveSopVersion(input: {
  sopStatus: string;
  versionStatus: string;
  latestValidation: SopValidationStatus | null;
}): { ok: true } | { ok: false; reason: string } {
  if (input.versionStatus === 'LOCKED') {
    return { ok: false, reason: 'ALREADY_LOCKED' };
  }
  if (!canTransitionSop(input.sopStatus, 'APPROVED')) {
    return { ok: false, reason: 'NOT_IN_REVIEW' };
  }
  if (input.latestValidation === null) {
    return { ok: false, reason: 'NOT_VALIDATED' };
  }
  if (input.latestValidation === 'FAIL') {
    return { ok: false, reason: 'VALIDATION_FAILED' };
  }
  return { ok: true };
}
