import { describe, expect, it } from 'vitest';
import {
  deriveSequentialEdges,
  fitTitle,
  normalizeNodeKey,
  sopGraphHashInput,
  SOP_NODE_KEY_PATTERN,
  SOP_NODE_TYPES,
  SOP_TITLE_MAX_LENGTH,
  validateSopGraph,
  type SopEdgeDraft,
  type SopGraphDraft,
  type SopNodeDraft,
} from './sop-graph';

/** 매퍼 버전은 어댑터의 것이다(.claude/rules/architecture.md) — 해시 인자로 받는다. */
const MAPPER = 'test-mapper-1';

const node = (
  nodeKey: string,
  type: SopNodeDraft['type'],
  extra: Partial<SopNodeDraft> = {},
): SopNodeDraft => ({
  nodeKey,
  providerNodeKey: nodeKey,
  type,
  title: nodeKey,
  sequence: 1,
  tasks: [],
  decisionExpression: null,
  sourceRefs: [],
  ...extra,
});

const edge = (from: string, to: string, extra: Partial<SopEdgeDraft> = {}): SopEdgeDraft => ({
  fromNodeKey: from,
  toNodeKey: to,
  conditionExpr: null,
  label: null,
  priority: 0,
  ...extra,
});

/** START → A → END */
const linear = (): SopGraphDraft => ({
  nodes: [node('s', 'START'), node('a', 'ACTION'), node('e', 'END')],
  edges: [edge('s', 'a'), edge('a', 'e')],
});

describe('전체 그래프 검증 (__done__ 이후)', () => {
  it('START → ACTION → END는 통과한다', () => {
    expect(validateSopGraph(linear())).toEqual([]);
  });

  it('시작·종료가 없으면 잡는다', () => {
    const g: SopGraphDraft = { nodes: [node('a', 'ACTION')], edges: [] };
    const v = validateSopGraph(g);
    expect(v).toContain('NO_START');
    expect(v).toContain('NO_END');
  });

  it('시작이 둘이면 잡는다', () => {
    const g = linear();
    g.nodes.push(node('s2', 'START'));
    g.edges.push(edge('s2', 'a'));
    expect(validateSopGraph(g)).toContain('MULTIPLE_START');
  });

  it('고립 노드를 잡는다 — 그러나 NOTE는 고립이 정상이다', () => {
    const withOrphan = linear();
    withOrphan.nodes.push(node('x', 'ACTION'));
    expect(validateSopGraph(withOrphan)).toContain('ORPHAN_NODE');

    const withNote = linear();
    withNote.nodes.push(node('memo', 'NOTE'));
    expect(validateSopGraph(withNote)).not.toContain('ORPHAN_NODE');
  });

  it('없는 노드를 가리키는 간선을 잡는다', () => {
    const g = linear();
    g.edges.push(edge('a', 'nowhere'));
    expect(validateSopGraph(g)).toContain('DANGLING_EDGE');
  });

  it('순환을 잡는다', () => {
    const g = linear();
    g.edges.push(edge('e', 's'));
    expect(validateSopGraph(g)).toContain('CYCLE');
  });

  it('갈래가 하나뿐인 DECISION을 잡는다 (분기가 아니다)', () => {
    const g: SopGraphDraft = {
      nodes: [
        node('s', 'START'),
        node('d', 'DECISION', { decisionExpression: 'x > 1' }),
        node('e', 'END'),
      ],
      edges: [edge('s', 'd'), edge('d', 'e')],
    };
    expect(validateSopGraph(g)).toContain('DECISION_WITHOUT_BRANCH');
  });

  it('분기식 없는 DECISION을 잡는다', () => {
    const g: SopGraphDraft = {
      nodes: [node('s', 'START'), node('d', 'DECISION'), node('a', 'ACTION'), node('e', 'END')],
      edges: [edge('s', 'd'), edge('d', 'a'), edge('d', 'e')],
    };
    expect(validateSopGraph(g)).toContain('DECISION_WITHOUT_BRANCH');
  });

  it('중복 노드 키를 잡는다', () => {
    const g = linear();
    g.nodes.push(node('a', 'NOTE'));
    expect(validateSopGraph(g)).toContain('DUPLICATE_NODE_KEY');
  });
});

describe('그래프 해시', () => {
  it('같은 그래프면 같은 값이다', () => {
    expect(sopGraphHashInput(linear(), MAPPER)).toBe(sopGraphHashInput(linear(), MAPPER));
  });

  it('노드·간선 배열 순서에 의존하지 않는다', () => {
    const shuffled = linear();
    shuffled.nodes.reverse();
    shuffled.edges.reverse();
    expect(sopGraphHashInput(shuffled, MAPPER)).toBe(sopGraphHashInput(linear(), MAPPER));
  });

  it('절차가 달라지면 값이 달라진다', () => {
    const changed = linear();
    changed.nodes[1].tasks = [{ instruction: '새 임무', assigneeHint: null }];
    expect(sopGraphHashInput(changed, MAPPER)).not.toBe(sopGraphHashInput(linear(), MAPPER));
  });

  it('매퍼 버전이 해시에 들어간다 (같은 입력을 다르게 옮겼을 수 있다)', () => {
    expect(sopGraphHashInput(linear(), MAPPER)).toContain(MAPPER);
    // 규칙이 바뀌면 같은 그래프라도 다른 값이어야 한다.
    expect(sopGraphHashInput(linear(), MAPPER)).not.toBe(sopGraphHashInput(linear(), 'other-1'));
  });

  it('노드 유형 어휘는 다섯이다', () => {
    expect([...SOP_NODE_TYPES]).toEqual(['START', 'ACTION', 'DECISION', 'NOTE', 'END']);
  });
});

describe('간선 파생 — UNI가 간선을 주지 않는다', () => {
  const n = (nodeKey: string, type: 'START' | 'ACTION' | 'DECISION' | 'NOTE' | 'END') => ({
    nodeKey,
    providerNodeKey: nodeKey,
    type,
    title: nodeKey,
    sequence: 0,
    tasks: [],
    decisionExpression: null,
    sourceRefs: [],
  });

  it('도착 순서대로 잇는다', () => {
    const edges = deriveSequentialEdges([n('s', 'START'), n('a', 'ACTION'), n('e', 'END')]);
    expect(edges.map((x) => `${x.fromNodeKey}->${x.toNodeKey}`)).toEqual(['s->a', 'a->e']);
  });

  it('NOTE는 흐름 밖이다 (주석이 절차를 끊지 않는다)', () => {
    const edges = deriveSequentialEdges([n('s', 'START'), n('memo', 'NOTE'), n('e', 'END')]);
    expect(edges.map((x) => `${x.fromNodeKey}->${x.toNodeKey}`)).toEqual(['s->e']);
  });

  it('DECISION 뒤는 잇지 않는다 (갈래를 순서로 추측하지 않는다)', () => {
    // 추측해서 이으면 틀린 절차가 사실처럼 그려진다. 위반으로 남겨 사용자가 그린다.
    const nodes = [n('s', 'START'), n('d', 'DECISION'), n('a', 'ACTION'), n('e', 'END')];
    const edges = deriveSequentialEdges(nodes);
    expect(edges.some((x) => x.fromNodeKey === 'd')).toBe(false);
    expect(validateSopGraph({ nodes, edges })).toContain('DECISION_WITHOUT_BRANCH');
  });

  it('노드가 하나면 간선이 없다', () => {
    expect(deriveSequentialEdges([n('s', 'START')])).toEqual([]);
  });
});

describe('EDGE_FROM_END', () => {
  it('종료 뒤로 절차가 이어지면 위반이다', () => {
    const nodes = [
      {
        nodeKey: 's',
        providerNodeKey: 's',
        type: 'START' as const,
        title: 's',
        sequence: 1,
        tasks: [],
        decisionExpression: null,
        sourceRefs: [],
      },
      {
        nodeKey: 'e',
        providerNodeKey: 'e',
        type: 'END' as const,
        title: 'e',
        sequence: 2,
        tasks: [],
        decisionExpression: null,
        sourceRefs: [],
      },
      {
        nodeKey: 'x',
        providerNodeKey: 'x',
        type: 'ACTION' as const,
        title: 'x',
        sequence: 3,
        tasks: [],
        decisionExpression: null,
        sourceRefs: [],
      },
    ];
    const v = validateSopGraph({ nodes, edges: deriveSequentialEdges(nodes) });
    // DAG이고 END도 있다 — 기존 규칙 어느 것도 잡지 못한다.
    expect(v).toEqual(['EDGE_FROM_END']);
  });

  it('정상 종료는 위반이 아니다', () => {
    const nodes = [
      {
        nodeKey: 's',
        providerNodeKey: 's',
        type: 'START' as const,
        title: 's',
        sequence: 1,
        tasks: [],
        decisionExpression: null,
        sourceRefs: [],
      },
      {
        nodeKey: 'e',
        providerNodeKey: 'e',
        type: 'END' as const,
        title: 'e',
        sequence: 2,
        tasks: [],
        decisionExpression: null,
        sourceRefs: [],
      },
    ];
    expect(validateSopGraph({ nodes, edges: deriveSequentialEdges(nodes) })).toEqual([]);
  });
});

describe('노드 키·제목을 저장 가능한 모양으로 맞춘다', () => {
  it('규칙에 맞는 키는 그대로 둔다', () => {
    expect(normalizeNodeKey('step-A_1', 7)).toBe('step-A_1');
  });

  it('한글·공백 키를 규칙에 맞게 고친다', () => {
    const key = normalizeNodeKey('대피 단계', 7);
    expect(key).toMatch(SOP_NODE_KEY_PATTERN);
  });

  it('숫자로 시작하는 키에 접두를 붙인다', () => {
    expect(normalizeNodeKey('3', 7)).toBe('n3');
  });

  it('살릴 것이 없으면 순번으로 만든다', () => {
    expect(normalizeNodeKey('!!!', 7)).toBe('n7');
  });

  it('키 길이가 DB 컬럼(varchar 80)을 넘지 않는다', () => {
    expect(normalizeNodeKey('A'.repeat(500), 1).length).toBeLessThanOrEqual(80);
  });

  it('제목이 varchar(300)을 넘으면 자르고 잘랐다고 알린다', () => {
    // 자르지 않으면 22001이 트랜잭션 전체를 되돌리고, 잡은 엉뚱한 사유로 끝난다.
    const long = '가'.repeat(400);
    expect(fitTitle(long)).toEqual({ title: '가'.repeat(300), truncated: true });
    expect(fitTitle('짧다')).toEqual({ title: '짧다', truncated: false });
    expect(SOP_TITLE_MAX_LENGTH).toBe(300);
  });
});
