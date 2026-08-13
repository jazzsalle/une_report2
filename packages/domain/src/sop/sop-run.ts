import { FIELD_TASK_STATUSES, type FieldTaskStatus } from '../task/field-task';
import type { SopEdgeDraft, SopNodeDraft } from './sop-graph';

/**
 * SOP 실행과 임무의 명시적 상태기계 (CC-260).
 *
 * 설계 09 "SOP Execution"·"Task" 상태표, 설계 10 UNE-SOP-010~016.
 */

/**
 * 실행 방식.
 *
 *   LIVE      실제 상황. 전파가 실제로 나간다(CC-270).
 *   EXERCISE  훈련. 실제 상황과 같은 흐름이되 상황 자체가 `mode='EXERCISE'`다.
 *   DRY_RUN   모의. **아무것도 밖으로 나가지 않고 상황 상태도 건드리지 않는다.**
 *
 * DRY_RUN이 상황을 RUNNING으로 만들지 않는 것이 핵심이다 — 모의 실행 때문에
 * 대시보드와 일지가 "대응 중"으로 보이면 그 화면을 믿은 사람이 잘못 판단한다.
 */
export const SOP_RUN_MODES = ['LIVE', 'EXERCISE', 'DRY_RUN'] as const;
export type SopRunMode = (typeof SOP_RUN_MODES)[number];

export function isSopRunMode(v: unknown): v is SopRunMode {
  return (SOP_RUN_MODES as readonly unknown[]).includes(v);
}

/** 모의 실행은 바깥 세계와 상황 상태를 건드리지 않는다. */
export function affectsSituation(mode: SopRunMode): boolean {
  return mode !== 'DRY_RUN';
}

/** 실제로 전파를 내보내는 방식인가 (CC-270이 이 판단을 쓴다). */
export function dispatchesForReal(mode: SopRunMode): boolean {
  return mode === 'LIVE';
}

/**
 * 이 상황에서 이 실행 방식을 열 수 있는가 (CC-320).
 *
 * ADR-41 D9는 `dispatchesForReal(run.mode)`로 훈련의 전파를 막는다. 그런데
 * 실행을 만드는 쪽이 `run.mode`를 **`situation.mode`와 대조하지 않으면** 그
 * 방어가 통째로 비껴간다 — 훈련 상황에서 `mode: 'LIVE'`로 실행을 열면 실제
 * 문자가 나간다. CC-320 수직 슬라이스가 이것을 실측했다(V-2).
 *
 * 규칙은 하나다: **실행은 자기 상황보다 더 실제일 수 없다.**
 *
 *   상황 LIVE      → LIVE / EXERCISE / DRY_RUN 모두 연다.
 *   상황 EXERCISE  → EXERCISE / DRY_RUN만 연다. LIVE는 막는다.
 *
 * 실사건에서 훈련 방식 실행을 여는 것은 막지 않는다 — 그쪽은 덜 실제이므로
 * 밖으로 나가는 것이 없고, 실제 대응과 나란히 도는 연습을 금지할 이유가 없다
 * (`affectsSituation`이 이미 그 자리를 잡아 두었다).
 */
export function canRunModeInSituation(situationMode: string, runMode: SopRunMode): boolean {
  return situationMode === 'EXERCISE' ? runMode !== 'LIVE' : true;
}

/**
 * 실행 상태.
 *
 * 설계 09는 여섯을 적지만 CC-260이 만들 수 있는 것은 넷이다. `COMPLETED`와
 * `FAILED`는 완료 보고(CC-280)에서 온다 — 그 값을 만드는 코드와 함께 어휘가
 * 넓어진다(0022 §1).
 */
export const SOP_RUN_STATUSES = ['READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'TERMINATED'] as const;
export type SopRunStatus = (typeof SOP_RUN_STATUSES)[number];

const RUN_TRANSITIONS: Record<SopRunStatus, readonly SopRunStatus[]> = {
  // READY는 DRY_RUN 준비 상태다. 시작하거나 접고 나갈 수 있다.
  READY: ['RUNNING', 'TERMINATED'],
  // COMPLETED는 사람이 누르는 것이 아니다 — 마지막 임무가 승인되면 실행이
  // 스스로 끝난다(CC-280 `canCompleteRun`).
  RUNNING: ['PAUSED', 'COMPLETED', 'TERMINATED'],
  PAUSED: ['RUNNING', 'TERMINATED'],
  // 끝난 실행은 끝이다. 되돌리려면 새 실행을 시작한다 — 실행 이력을 덮어쓰지
  // 않는다는 규칙이 여기에도 적용된다.
  COMPLETED: [],
  TERMINATED: [],
};

export function canTransitionRun(from: string, to: string): boolean {
  return (RUN_TRANSITIONS[from as SopRunStatus] ?? []).includes(to as SopRunStatus);
}

/** 끝난 실행은 더 움직이지 않는다 — 완주했든 강제종료했든. */
export function isRunSettled(status: string): boolean {
  return status === 'COMPLETED' || status === 'TERMINATED';
}

/**
 * 임무 상태.
 *
 * CC-260은 생성과 취소 둘이었고, CC-270이 `SENT`를, CC-280이 수행 상태들을
 * 예고대로 열었다. 정본은 `task/field-task.ts`이고 여기서는 실행 쪽 호출부가
 * 쓰던 이름을 유지한다 — `DELIVERED`는 수신영수증을 주는 실제 채널이 붙어야
 * 온다(OB-06).
 */
export const TASK_STATUSES = FIELD_TASK_STATUSES;
export type TaskStatus = FieldTaskStatus;

/**
 * 실행이 만드는 임무.
 *
 * **ACTION 노드만 임무가 된다.** START/END는 흐름의 표시이고 DECISION은
 * 판단이며 NOTE는 주석이다 — 사람에게 배정해 "했는가"를 물을 대상이 아니다.
 */
export function isTaskNode(node: SopNodeDraft): boolean {
  return node.type === 'ACTION';
}

/**
 * 지금 수행할 차례인 임무(=활성 프런티어).
 *
 * **저장하지 않고 계산한다.** 커서를 컬럼에 두면 그래프·임무 상태와 어긋날 수
 * 있고, 어긋났을 때 어느 쪽이 참인지 말할 수 없다.
 *
 * 규칙: START에서 출발해 **완료되지 않은 ACTION을 만나면 거기서 멈춘다.**
 * 그 ACTION이 프런티어다. ACTION이 아닌 노드(DECISION/NOTE/END)는 통과한다 —
 * 분기 판단은 아직 사람이 하지 않으므로 모든 갈래를 따라간다(CC-280이 조건
 * 평가를 붙일 때 좁아진다).
 *
 * `completedNodeKeys`가 비면 시작 직후의 첫 임무들이 나온다.
 */
export function computeActiveTaskNodes(
  graph: {
    nodes: readonly Pick<SopNodeDraft, 'nodeKey' | 'type'>[];
    edges: readonly Pick<SopEdgeDraft, 'fromNodeKey' | 'toNodeKey'>[];
  },
  completedNodeKeys: ReadonlySet<string> = new Set(),
): string[] {
  const byKey = new Map(graph.nodes.map((n) => [n.nodeKey, n]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.fromNodeKey);
    if (list) list.push(edge.toNodeKey);
    else outgoing.set(edge.fromNodeKey, [edge.toNodeKey]);
  }

  const starts = graph.nodes.filter((n) => n.type === 'START').map((n) => n.nodeKey);
  const active = new Set<string>();
  const seen = new Set<string>();
  const queue = [...starts];

  while (queue.length > 0) {
    const key = queue.shift() as string;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = byKey.get(key);
    if (!node) continue;

    if (node.type === 'ACTION' && !completedNodeKeys.has(key)) {
      // 여기서 멈춘다 — 뒤 임무는 이것이 끝나야 차례가 온다.
      active.add(key);
      continue;
    }
    for (const next of outgoing.get(key) ?? []) queue.push(next);
  }
  return [...active];
}

/** 실행 이벤트 어휘 (`execution_event.event_type`). */
export const RUN_EVENT_TYPES = [
  'RUN_CREATED',
  'RUN_STARTED',
  'RUN_PAUSED',
  'RUN_RESUMED',
  'RUN_TERMINATED',
  'TASK_CREATED',
  'TASK_ACTIVATED',
  'TASK_CANCELLED',
  // CC-280이 연다 — 마지막 임무가 승인되면 실행이 스스로 끝난다. 실행
  // 애그리거트의 이벤트이므로 여기 있어야 UNE-SOP-013 SSE가 그것을 흘린다.
  'RUN_COMPLETED',
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/**
 * 강제종료 확인코드 (UNE-SOP-016 `confirmCode`).
 *
 * 되돌릴 수 없는 조작이라 실수로 눌리면 안 된다. 서버가 만든 값을 요구하는
 * 대신 **실행 id의 앞 8자**를 요구한다 — 사용자가 지금 무엇을 끄는지 화면에서
 * 읽어 옮겨야 하므로, 확인 자체가 대상 확인이 된다.
 */
export function terminateConfirmCode(runId: string): string {
  return runId.slice(0, 8);
}
