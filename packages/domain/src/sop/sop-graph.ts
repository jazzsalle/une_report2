import { canonicalJson } from '../canonical-json';

/**
 * SopGraph — UNE 표준 SOP 노드·간선 (CC-240).
 *
 * 설계 08 §1.11(UNI /chat/json SOP SSE Adapter), 설계 10 UNE-SOP-001~002.
 *
 * 0005의 `sop_node.node_type` 주석이 `START/ACTION/DECISION/NOTE/END`이고
 * CHECK는 없다. `knowledge_document`·`evidence_set`과 같은 상태였다.
 */

export const SOP_NODE_TYPES = ['START', 'ACTION', 'DECISION', 'NOTE', 'END'] as const;
export type SopNodeType = (typeof SOP_NODE_TYPES)[number];

export function isSopNodeType(v: unknown): v is SopNodeType {
  return (SOP_NODE_TYPES as readonly unknown[]).includes(v);
}

/** 0005 `sop_version.status` 주석의 두 값. */
export const SOP_VERSION_STATUSES = ['DRAFT', 'LOCKED'] as const;
export type SopVersionStatus = (typeof SOP_VERSION_STATUSES)[number];

export interface SopTask {
  /** 임무 문구. 비면 노드가 무엇을 하라는 것인지 말하지 못한다. */
  instruction: string;
  /** 담당 기관·역할. UNI가 주지 않을 수 있다(경고 대상). */
  assigneeHint: string | null;
}

/** 계약 `sop-graph.schema.json`의 노드 키 규칙. */
export const SOP_NODE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/;

/**
 * 제목 길이 상한 — `sop_node.title`·`sop.title`이 varchar(300)이다.
 *
 * provider 문자열에는 길이 제한이 없다. 자르지 않으면 22001로 트랜잭션 전체가
 * 되돌아가고, 잡은 RUNNING에 머물다 리스가 만료되어 **엉뚱한 사유**
 * (MAX_ATTEMPTS_EXCEEDED)로 끝난다 — 무엇이 잘못됐는지 아무도 알 수 없다.
 */
export const SOP_TITLE_MAX_LENGTH = 300;

/** 상한을 넘으면 자르고 잘랐다는 사실을 돌려준다. */
export function fitTitle(raw: string): { title: string; truncated: boolean } {
  return raw.length <= SOP_TITLE_MAX_LENGTH
    ? { title: raw, truncated: false }
    : { title: raw.slice(0, SOP_TITLE_MAX_LENGTH), truncated: true };
}

export interface SopNodeDraft {
  nodeKey: string;
  /**
   * UNI가 준 원래 `compnSn`. 정규화하지 않았으면 `nodeKey`와 같다.
   *
   * 이것이 없으면 "UNI의 3번 노드"와 "우리 그래프의 n3"를 이을 수 없다.
   */
  providerNodeKey: string;
  type: SopNodeType;
  title: string;
  sequence: number;
  tasks: SopTask[];
  /** DECISION에만 의미가 있다. */
  decisionExpression: string | null;
  /** 근거 출처 — `__sources__`에서 온다. */
  sourceRefs: string[];
}

export interface SopEdgeDraft {
  fromNodeKey: string;
  toNodeKey: string;
  conditionExpr: string | null;
  label: string | null;
  priority: number;
}

export interface SopGraphDraft {
  nodes: SopNodeDraft[];
  edges: SopEdgeDraft[];
}

/**
 * 매핑·검증 경고.
 *
 * **경고이지 오류가 아니다.** 설계 08 §1.11이 "누락 필드는 Validator warning
 * 으로 반환한다"고 못박았다. CC-220/230의 "모르면 거부한다"와 규칙이 다른데,
 * 이유가 있다 — 여기는 **스트리밍**이다. `__compn__`이 하나씩 도착하고 사용자
 * Canvas에 즉시 쌓이므로, 필드 하나가 비었다고 응답 전체를 버리면 이미 화면에
 * 그려진 노드까지 사라진다. 대신 무엇이 비었는지를 노드에 붙여 사용자가
 * 채우게 한다.
 *
 * 그래도 **거부하는 것이 있다**: 노드를 가리킬 수 없게 만드는 것(키 없음),
 * 그래프를 성립시키지 못하는 것(모르는 노드 유형), 존재하지 않는 노드를
 * 가리키는 간선. 이것들은 경고로 두면 그래프 자체가 뜻을 잃는다.
 */
export const SOP_MAPPING_WARNINGS = [
  'MISSING_TITLE',
  'MISSING_TASK',
  'MISSING_ASSIGNEE',
  'MISSING_DECISION_EXPRESSION',
  'NO_SOURCE_REFS',
  'UNKNOWN_FIELD_DROPPED',
  /**
   * UNI가 준 `compnSn`이 노드 키 규칙에 맞지 않아 UNE가 고쳐 썼다.
   *
   * `contracts/schemas/sop-graph.schema.json`이 노드 키를
   * `^[A-Za-z][A-Za-z0-9_-]{1,79}$`로 못박았다(CC-250의 캔버스 저장·교환
   * 형식이 이 스키마를 쓴다). UNI가 숫자나 한글로 시작하는 키를 주면 그대로
   * 저장한 그래프는 **나중에 내보낼 수 없다** — 그때 발견하면 이미 저장된
   * 버전들을 손봐야 한다. 지금 고치고 원래 값을 함께 남긴다.
   */
  'NODE_KEY_NORMALIZED',
  /** provider 제목이 `sop_node.title`(varchar 300)을 넘어 잘렸다. */
  'TITLE_TRUNCATED',
  /**
   * 노드가 **요청 범위 밖 문서**를 근거로 든다.
   *
   * UNI가 `doc_ids`와 프롬프트를 둘 다 무시하면 동결 근거 밖의 절차가 만들어질
   * 수 있다. 요청 범위와 응답 출처를 둘 다 손에 쥐고 있으므로 비교는 한 줄이다 —
   * 잡지 못하는 것이 아니라 잡지 않으면 안 된다(LLM 출력은 권위 있는 사실
   * 출처가 아니다). 거부하지는 않는다(스트리밍 원칙, ADR-38 D3).
   */
  'SOURCE_OUT_OF_SCOPE',
] as const;
export type SopMappingWarning = (typeof SOP_MAPPING_WARNINGS)[number];

/**
 * 노드 키를 계약 규칙에 맞춘다.
 *
 * **규칙이 계약의 것이므로 함수도 도메인에 있다** — provider가 무엇을 주든
 * `sop-graph.schema.json`이 정한 모양이어야 저장한 그래프를 나중에 내보낼 수
 * 있다. 어느 provider 필드가 무엇인가(매핑 규칙)만 어댑터의 것이다.
 *
 * 되도록 원래 값을 살린다 — 키가 바뀌면 provider 응답과 우리 그래프를 눈으로
 * 대조할 수 없다. 살릴 수 없을 때만 순번 기반으로 만든다.
 */
export function normalizeNodeKey(raw: string, sequence: number): string {
  if (SOP_NODE_KEY_PATTERN.test(raw)) return raw;
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+/, '');
  const prefixed = /^[A-Za-z]/.test(cleaned) ? cleaned : `n${cleaned}`;
  const trimmed = prefixed.slice(0, 80);
  return SOP_NODE_KEY_PATTERN.test(trimmed) ? trimmed : `n${sequence}`;
}

export interface SopNodeMapping {
  node: SopNodeDraft;
  warnings: SopMappingWarning[];
}

export type SopMappingRejection =
  | 'MISSING_NODE_KEY' // 가리킬 수 없는 노드는 그래프에 넣을 수 없다
  | 'UNKNOWN_NODE_TYPE'; // 모르는 유형은 실행기가 무엇을 할지 모른다

export const SOP_GRAPH_VIOLATIONS = [
  'NO_START',
  'NO_END',
  'MULTIPLE_START',
  'ORPHAN_NODE',
  'DANGLING_EDGE',
  'CYCLE',
  'DECISION_WITHOUT_BRANCH',
  'DUPLICATE_NODE_KEY',
  /**
   * 종료 노드에서 나가는 간선이 있다.
   *
   * mock 스트림 실측에서 나왔다 — UNI가 `END` 뒤에 `__compn__`을 하나 더 보내면
   * 순차 연결이 END를 **통과해 버린다.** DAG는 성립하므로 CYCLE에 걸리지 않고
   * NO_END에도 걸리지 않는다. 종료 뒤에 절차가 이어지면 그 절차는 끝나지 않는다.
   */
  'EDGE_FROM_END',
] as const;
export type SopGraphViolation = (typeof SOP_GRAPH_VIOLATIONS)[number];

/**
 * 전체 그래프 검증 (설계 08 §1.11 "__done__ 후 전체 DAG/시작·종료/분기/고립노드").
 *
 * 스트리밍 중의 부분 검증과 달리 여기서는 **완결성**을 본다. 이 검증을
 * 통과하지 못한 그래프도 DRAFT로 저장한다 — 사용자가 Canvas에서 고치는 것이
 * 다음 단계이고(CC-250), 저장하지 않으면 고칠 대상이 없다. 위반은 노드가
 * 아니라 **버전에 붙는다.**
 */
export function validateSopGraph(graph: SopGraphDraft): SopGraphViolation[] {
  const violations: SopGraphViolation[] = [];
  const keys = graph.nodes.map((n) => n.nodeKey);
  const keySet = new Set(keys);
  if (keySet.size !== keys.length) violations.push('DUPLICATE_NODE_KEY');

  const starts = graph.nodes.filter((n) => n.type === 'START');
  if (starts.length === 0) violations.push('NO_START');
  if (starts.length > 1) violations.push('MULTIPLE_START');
  if (!graph.nodes.some((n) => n.type === 'END')) violations.push('NO_END');

  for (const e of graph.edges) {
    if (!keySet.has(e.fromNodeKey) || !keySet.has(e.toNodeKey)) {
      violations.push('DANGLING_EDGE');
      break;
    }
  }

  // 고립 노드 — NOTE는 흐름에 붙지 않아도 정상이다(주석이다).
  const touched = new Set<string>();
  for (const e of graph.edges) {
    touched.add(e.fromNodeKey);
    touched.add(e.toNodeKey);
  }
  if (graph.nodes.some((n) => n.type !== 'NOTE' && !touched.has(n.nodeKey) && keys.length > 1)) {
    violations.push('ORPHAN_NODE');
  }

  for (const n of graph.nodes) {
    if (n.type === 'DECISION') {
      const out = graph.edges.filter((e) => e.fromNodeKey === n.nodeKey);
      // 분기는 갈래가 둘 이상이어야 분기다.
      if (out.length < 2 || !n.decisionExpression) {
        violations.push('DECISION_WITHOUT_BRANCH');
        break;
      }
    }
  }

  const endKeys = new Set(graph.nodes.filter((n) => n.type === 'END').map((n) => n.nodeKey));
  if (graph.edges.some((e) => endKeys.has(e.fromNodeKey))) violations.push('EDGE_FROM_END');

  if (hasCycle(graph)) violations.push('CYCLE');
  return violations;
}

/**
 * 도착 순서대로 노드를 잇는다.
 *
 * UNI `__compn__`은 **간선을 주지 않는다** — 설계 08 §1.11의 필드는
 * `compnSn/type/name/task/branch/source`뿐이고 "다음 노드"에 해당하는 것이
 * 없다. 그래서 UNE가 흐름을 만들어야 하고, 가진 정보는 도착 순서뿐이다.
 *
 * **DECISION은 잇지 않는다.** 분기의 갈래를 순서로 추측하면 틀린 절차를
 * 사실처럼 그린다. 대신 `DECISION_WITHOUT_BRANCH` 위반으로 남겨 사용자가
 * Canvas에서 갈래를 그리게 한다(CC-250). NOTE도 흐름 밖이다.
 *
 * 이 규칙이 `UNI_SOP_MAPPER_VERSION`에 묶여 있다 — UNI가 나중에 간선을 주면
 * 매퍼 버전이 올라가지, 이 함수가 조용히 바뀌지 않는다.
 */
export function deriveSequentialEdges(nodes: SopNodeDraft[]): SopEdgeDraft[] {
  const flow = nodes.filter((n) => n.type !== 'NOTE');
  const edges: SopEdgeDraft[] = [];
  for (let i = 0; i < flow.length - 1; i += 1) {
    if (flow[i].type === 'DECISION') continue;
    edges.push({
      fromNodeKey: flow[i].nodeKey,
      toNodeKey: flow[i + 1].nodeKey,
      conditionExpr: null,
      label: null,
      priority: 0,
    });
  }
  return edges;
}

function hasCycle(graph: SopGraphDraft): boolean {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!adj.has(e.fromNodeKey)) adj.set(e.fromNodeKey, []);
    adj.get(e.fromNodeKey)?.push(e.toNodeKey);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const walk = (key: string): boolean => {
    const s = state.get(key) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(key, 1);
    for (const next of adj.get(key) ?? []) {
      if (walk(next)) return true;
    }
    state.set(key, 2);
    return false;
  };
  return graph.nodes.some((n) => walk(n.nodeKey));
}

/**
 * 그래프 해시 (`sop_version.graph_hash`).
 *
 * 매퍼 버전을 **인자로 받는다.** 그 값은 provider 응답을 어느 규칙으로 옮겼는지를
 * 가리키므로 어댑터의 것이고(`.claude/rules/architecture.md`), 도메인이 특정
 * provider의 매퍼 이름을 알고 있으면 의존 방향이 뒤집힌다.
 *
 * 노드 키로 정렬한다 — 도착 순서나 저장 순서에 의존하면 같은 그래프가 다른
 * 해시를 갖는다. 위치(`position_x/y`)는 넣지 않는다: 캔버스에서 노드를 옮기는
 * 것은 절차를 바꾸는 것이 아니다.
 */
export function sopGraphHashInput(graph: SopGraphDraft, mapperVersion: string): string {
  const nodes = [...graph.nodes]
    .sort((a, b) => a.nodeKey.localeCompare(b.nodeKey))
    .map((n) => ({
      nodeKey: n.nodeKey,
      // providerNodeKey는 해시에 넣지 않는다 — 같은 절차인데 UNI가 내부
      // 일련번호만 바꿔 보내면 해시가 달라져 "바뀐 절차"로 읽힌다.
      type: n.type,
      title: n.title,
      tasks: n.tasks.map((t) => ({ instruction: t.instruction, assigneeHint: t.assigneeHint })),
      decisionExpression: n.decisionExpression,
      sourceRefs: [...n.sourceRefs].sort(),
    }));
  const edges = [...graph.edges]
    .sort(
      (a, b) =>
        a.fromNodeKey.localeCompare(b.fromNodeKey) || a.toNodeKey.localeCompare(b.toNodeKey),
    )
    .map((e) => ({
      fromNodeKey: e.fromNodeKey,
      toNodeKey: e.toNodeKey,
      conditionExpr: e.conditionExpr,
      label: e.label,
      priority: e.priority,
    }));
  return canonicalJson({ mapperVersion, nodes, edges });
}
