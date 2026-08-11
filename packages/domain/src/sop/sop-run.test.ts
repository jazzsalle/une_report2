import { describe, expect, it } from 'vitest';
import {
  affectsSituation,
  canTransitionRun,
  computeActiveTaskNodes,
  dispatchesForReal,
  isRunSettled,
  isTaskNode,
  SOP_RUN_MODES,
  SOP_RUN_STATUSES,
  TASK_STATUSES,
  terminateConfirmCode,
} from './sop-run';
import type { SopEdgeDraft, SopNodeDraft } from './sop-graph';

const node = (nodeKey: string, type: SopNodeDraft['type']): SopNodeDraft => ({
  nodeKey,
  providerNodeKey: nodeKey,
  type,
  title: nodeKey,
  sequence: 1,
  tasks: [],
  decisionExpression: null,
  sourceRefs: [],
});

const edge = (from: string, to: string): SopEdgeDraft => ({
  fromNodeKey: from,
  toNodeKey: to,
  conditionExpr: null,
  label: null,
  priority: 0,
});

describe('실행 방식', () => {
  it('세 가지다', () => {
    expect([...SOP_RUN_MODES]).toEqual(['LIVE', 'EXERCISE', 'DRY_RUN']);
  });

  it('모의 실행은 상황 상태를 건드리지 않는다', () => {
    // 모의 때문에 대시보드와 일지가 "대응 중"으로 보이면 그 화면을 믿은
    // 사람이 잘못 판단한다.
    expect(affectsSituation('DRY_RUN')).toBe(false);
    expect(affectsSituation('LIVE')).toBe(true);
    expect(affectsSituation('EXERCISE')).toBe(true);
  });

  it('실제 전파는 LIVE에서만 나간다', () => {
    expect(dispatchesForReal('LIVE')).toBe(true);
    expect(dispatchesForReal('EXERCISE')).toBe(false);
    expect(dispatchesForReal('DRY_RUN')).toBe(false);
  });
});

describe('실행 상태 전이', () => {
  it('CC-260이 만드는 것은 넷이다 (COMPLETED/FAILED는 CC-280)', () => {
    expect([...SOP_RUN_STATUSES]).toEqual(['READY', 'RUNNING', 'PAUSED', 'TERMINATED']);
  });

  it('READY → RUNNING → PAUSED → RUNNING', () => {
    expect(canTransitionRun('READY', 'RUNNING')).toBe(true);
    expect(canTransitionRun('RUNNING', 'PAUSED')).toBe(true);
    expect(canTransitionRun('PAUSED', 'RUNNING')).toBe(true);
  });

  it('어느 상태에서든 강제종료할 수 있다', () => {
    for (const from of ['READY', 'RUNNING', 'PAUSED'] as const) {
      expect(canTransitionRun(from, 'TERMINATED'), from).toBe(true);
    }
  });

  it('종료는 끝이다 — 되돌리려면 새 실행이다', () => {
    for (const to of SOP_RUN_STATUSES) {
      expect(canTransitionRun('TERMINATED', to), to).toBe(false);
    }
    expect(isRunSettled('TERMINATED')).toBe(true);
    expect(isRunSettled('PAUSED')).toBe(false);
  });

  it('일시중지한 것을 또 일시중지하지 않는다', () => {
    expect(canTransitionRun('PAUSED', 'PAUSED')).toBe(false);
    expect(canTransitionRun('RUNNING', 'RUNNING')).toBe(false);
  });
});

describe('임무 상태', () => {
  it('CC-260이 만드는 것은 둘이다', () => {
    expect([...TASK_STATUSES]).toEqual(['CREATED', 'CANCELLED']);
  });

  it('ACTION만 임무가 된다', () => {
    expect(isTaskNode(node('a', 'ACTION'))).toBe(true);
    for (const type of ['START', 'END', 'DECISION', 'NOTE'] as const) {
      // 사람에게 배정해 "했는가"를 물을 대상이 아니다.
      expect(isTaskNode(node('x', type)), type).toBe(false);
    }
  });
});

describe('활성 프런티어 — 지금 할 차례인 임무', () => {
  /** START → a → b → END */
  const chain = {
    nodes: [node('s', 'START'), node('a', 'ACTION'), node('b', 'ACTION'), node('e', 'END')],
    edges: [edge('s', 'a'), edge('a', 'b'), edge('b', 'e')],
  };

  it('시작 직후에는 첫 임무만 활성이다', () => {
    // 만들어진 임무와 지금 해야 하는 임무는 다르다.
    expect(computeActiveTaskNodes(chain)).toEqual(['a']);
  });

  it('앞 임무가 끝나면 다음이 차례가 된다', () => {
    expect(computeActiveTaskNodes(chain, new Set(['a']))).toEqual(['b']);
  });

  it('전부 끝나면 활성이 없다', () => {
    expect(computeActiveTaskNodes(chain, new Set(['a', 'b']))).toEqual([]);
  });

  it('갈래가 둘이면 둘 다 차례다 (병렬 대응)', () => {
    const fork = {
      nodes: [node('s', 'START'), node('a', 'ACTION'), node('b', 'ACTION'), node('e', 'END')],
      edges: [edge('s', 'a'), edge('s', 'b'), edge('a', 'e'), edge('b', 'e')],
    };
    expect(computeActiveTaskNodes(fork).sort()).toEqual(['a', 'b']);
  });

  it('DECISION·NOTE는 통과한다 (사람이 할 일이 아니다)', () => {
    const withDecision = {
      nodes: [
        node('s', 'START'),
        node('d', 'DECISION'),
        node('memo', 'NOTE'),
        node('a', 'ACTION'),
        node('e', 'END'),
      ],
      edges: [edge('s', 'd'), edge('d', 'memo'), edge('memo', 'a'), edge('a', 'e')],
    };
    expect(computeActiveTaskNodes(withDecision)).toEqual(['a']);
  });

  it('시작 노드가 없으면 아무것도 활성화하지 않는다', () => {
    // 승인 게이트가 막지만, 계산이 스스로 안전해야 한다.
    const noStart = { nodes: [node('a', 'ACTION')], edges: [] };
    expect(computeActiveTaskNodes(noStart)).toEqual([]);
  });

  it('순환이 있어도 멈춘다', () => {
    const cyclic = {
      nodes: [node('s', 'START'), node('a', 'ACTION'), node('b', 'ACTION')],
      edges: [edge('s', 'a'), edge('a', 'b'), edge('b', 'a')],
    };
    // 승인된 그래프에는 순환이 없지만(검증이 막는다) 계산이 멈추지 않으면
    // 요청 하나가 프로세스를 잡는다.
    expect(computeActiveTaskNodes(cyclic, new Set(['a']))).toEqual(['b']);
  });
});

describe('강제종료 확인코드', () => {
  it('실행 id의 앞 8자다', () => {
    // 사용자가 화면에서 읽어 옮겨야 하므로 확인 자체가 대상 확인이 된다.
    const runId = '3f2a1b9c-0000-4000-8000-000000000000';
    expect(terminateConfirmCode(runId)).toBe('3f2a1b9c');
  });
});
