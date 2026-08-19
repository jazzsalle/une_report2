import {
  fitTitle,
  normalizeNodeKey,
  type SopEdgeDraft,
  type SopMappingRejection,
  type SopMappingWarning,
  type SopNodeMapping,
  type SopNodeType,
  type SopTask,
} from '@une/domain';

/**
 * UniSopMapper — UNI `__compn__` 하나를 UNE SopNode로 옮긴다 (CC-240 → CC-410).
 *
 * **여기가 어댑터 패키지인 이유.** provider 필드명(`compnSn`/`compnTyCode`/
 * `endCompns`)을 아는 코드는 어댑터에만 있어야 한다
 * (`.claude/rules/architecture.md`: "Provider-specific DTOs live only under
 * provider adapters"). 도메인은 provider 중립 타입(`SopNodeDraft`)만 안다.
 *
 * **매퍼에 버전이 있다.** 어느 규칙으로 옮겼는지가 `sop_version.schema_version`에
 * 남는다. 그것이 없으면 그래프가 이상할 때 UNI가 바꾼 것인지 우리가 잘못 옮긴
 * 것인지 알 수 없다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## uni-sop-2 (CC-410, 2026-08-14) — 실측으로 다시 썼다
 *
 * `uni-sop-1`은 **설계 08 §1.11이 적은 필드명**(`type`/`name`/`task`/`branch`/
 * `source`)을 기준선으로 삼았다. 실 UNI(`http://221.147.100.161:8000`,
 * `/chat/json` — 그 호스트는 2026-08-18에 `http://10.20.10.101:8088`으로
 * 이전했다, ADR-51. 측정이 일어난 자리라 여기는 고쳐 쓰지 않는다)를 3표본
 * 측정한 결과 **그 이름은 하나도 존재하지 않는다**:
 *
 *   raw.compnSn : 6/6 존재 — 그러나 값이 number(-1)라 문자열 가드에서 탈락
 *   raw.type    : 0/6      → 실제 `compnTyCode` ("104001"/"104003"/"104005")
 *   raw.name    : 0/6      → 실제 `compnSj`
 *   raw.task    : 0/6      → 실제 `compnAttrbSaveParamsList[]`
 *   raw.branch  : 0/6      → 실제 `endCompns[]` (간선을 노드가 직접 들고 온다)
 *   raw.source  : 0/6      → 노드에 없다. 출처는 스트림 수준 `__sources__`뿐
 *
 * 즉 `uni-sop-1`은 실 UNI 응답을 **한 노드도** 매핑하지 못했다(첫 관문
 * `MISSING_NODE_KEY`에서 전량 탈락). 실제 UNI가 보내는 것은 **작도 캔버스
 * 스키마**다 — 좌표·너비·높이·글꼴·색상·화살표 방향까지 들어 있다.
 *
 * ### 옮기는 규칙
 *
 *   compnSn                    → providerNodeKey (숫자를 문자열로) → nodeKey
 *   compnTyCode                → type (아래 유형 코드 표)
 *   compnSj                    → title
 *   compnAttrbSaveParamsList[] → tasks (attrbSj/attrbCn, receive*Sns → 담당)
 *   endCompns[]                → 나가는 간선 (arrwCn이 있으면 분기 라벨)
 *   나머지(좌표·크기·색·글꼴)   → 버린다. UNE 캔버스가 자기 배치를 갖는다
 *
 * ### 버리는 것을 경고로 남기지 않는 이유
 *
 * `uni-sop-1`은 모르는 키가 하나라도 있으면 `UNKNOWN_FIELD_DROPPED`를 붙였다.
 * 실 UNI는 **모든 노드가** 좌표·크기·색을 들고 오므로 그대로 두면 경고가
 * 전 노드에 붙어 아무 정보도 주지 못한다. 그래서 **알면서 버리는 것**
 * (`LAYOUT_KEYS`)과 **정말 모르는 것**을 나눈다 — 후자에만 경고를 붙인다.
 * UNI가 새 필드를 추가하면 그때는 여전히 드러난다.
 */
export const UNI_SOP_MAPPER_VERSION = 'uni-sop-2';

/** UNI가 보내는 compn 원문. 필드 이름은 2026-08-14 실측이다. */
export interface UniRawCompn {
  /** 음수 임시 일련번호(-1, -2, …). **number다** — 문자열이 아니다. */
  compnSn?: unknown;
  /** 나가는 간선. 대상 `compnSn`과 화살표 방향을 담는다. */
  endCompns?: unknown;
  compnGroupSn?: unknown;
  /** 유형 코드. `104001`/`104003`/`104005` 실측. */
  compnTyCode?: unknown;
  /** 노드 제목. */
  compnSj?: unknown;
  /** 노드가 품은 임무 목록. */
  compnAttrbSaveParamsList?: unknown;
  [key: string]: unknown;
}

/**
 * UNI 유형 코드 → UNE 노드 유형.
 *
 * **코드의 뜻은 UNI가 알려준 것이 아니다.** 라이브 스펙에도 설계에도 표가 없다.
 * 3표본에서 관측한 위치와 구조로 읽었다(OB-13에 확인 요청으로 남긴다):
 *
 *   104001 — 3표본 모두 정확히 1개, 들어오는 간선이 없는 첫 노드 → START
 *   104005 — 3표본 모두 정확히 1개, **나가는 간선이 둘** → DECISION
 *   104003 — 나머지 전부, 임무를 품는다 → ACTION
 *
 * 모르는 코드는 **거절하지 않고 ACTION으로 둔다**(아래 이유 참조).
 */
const TYPE_CODES: Record<string, SopNodeType> = {
  '104001': 'START',
  '104003': 'ACTION',
  '104005': 'DECISION',
};

/**
 * 모르는 유형 코드의 기본값.
 *
 * `uni-sop-1`은 모르는 유형을 `UNKNOWN_NODE_TYPE`으로 **거절**했다. 실측 뒤
 * 그 판단을 뒤집는다 — UNI 유형 코드 표를 우리가 못 받은 상태이고(OB-13),
 * 3표본에서 본 세 개가 전부라는 보장이 없다. 처음 보는 코드 하나 때문에 노드를
 * 통째로 버리면 **사용자는 그 절차가 있었다는 사실조차 모른다**. 스트리밍
 * 원칙(ADR-38 D3: 모자란 필드는 경고, 노드는 살린다)과도 어긋난다.
 *
 * 대신 ACTION으로 세우고 원래 코드를 경고에 남긴다.
 */
const FALLBACK_TYPE: SopNodeType = 'ACTION';

/** 알면서 버리는 작도 전용 키 — 경고를 만들지 않는다. */
const LAYOUT_KEYS = new Set([
  'compnCrdnt',
  'width',
  'hg',
  'atmcProgrsYn',
  'charstSort',
  'fontSize',
  'color',
  'compnGroupSn',
]);

/** 옮기는 데 실제로 쓰는 키. */
const MAPPED_KEYS = new Set([
  'compnSn',
  'compnTyCode',
  'compnSj',
  'compnAttrbSaveParamsList',
  'endCompns',
]);

function asTrimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

/**
 * `compnSn`을 문자열 키로 읽는다.
 *
 * **여기가 `uni-sop-1`이 실 UNI에서 전량 탈락한 지점이다.** 실제 값은
 * `number`(-1)인데 문자열 가드만 있었다. 숫자 0도 유효한 키이므로
 * `Number.isFinite`로 본다 — `!v`로 보면 0이 사라진다.
 */
function asNodeKeySource(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return asTrimmed(v);
}

/** `compnAttrbSaveParamsList` 한 항목 → UNE 임무. */
function readTasks(raw: unknown): { tasks: SopTask[]; sawAssigneeSlot: boolean } {
  if (!Array.isArray(raw)) return { tasks: [], sawAssigneeSlot: false };
  const tasks: SopTask[] = [];
  let sawAssigneeSlot = false;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const subject = asTrimmed(rec.attrbSj);
    const content = asTrimmed(rec.attrbCn);
    // 제목만 있고 내용이 없어도 임무다 — 사용자가 채운다.
    const instruction = content ?? subject;
    if (instruction === null) continue;

    // 담당 자리는 **있다**. OB-04 ④가 "담당을 담을 자리가 없다"고 적은 것은
    // 설계 08 §1.11의 `task: string[]` 가정에서 나온 것이고, 실 UNI는
    // `receiveOrgnztSns`(기관)·`receiveUserSns`(사용자) 두 배열을 보낸다.
    // 3표본에서는 전부 비어 있었다 — 자리는 있고 값이 없다. 그 둘은 다르다.
    const orgs = Array.isArray(rec.receiveOrgnztSns) ? rec.receiveOrgnztSns : [];
    const users = Array.isArray(rec.receiveUserSns) ? rec.receiveUserSns : [];
    if ('receiveOrgnztSns' in rec || 'receiveUserSns' in rec) sawAssigneeSlot = true;
    const hint = [...orgs, ...users]
      .map((x) => (typeof x === 'number' || typeof x === 'string' ? String(x) : null))
      .filter((x): x is string => x !== null);

    tasks.push({
      instruction: subject && content ? `${subject}: ${content}` : instruction,
      // provider의 내부 일련번호다. 사람 이름이 아니므로 힌트로만 쓴다.
      assigneeHint: hint.length > 0 ? hint.join(',') : null,
    });
  }
  return { tasks, sawAssigneeSlot };
}

/** `endCompns` → 나가는 간선의 원재료. */
export interface UniRawEdge {
  /** 대상 노드의 provider 키(`compnSn`을 문자열로). */
  toProviderNodeKey: string;
  /** `arrwCn` — 분기 라벨. 대개 null이다. */
  label: string | null;
}

function readEdges(raw: unknown): UniRawEdge[] {
  if (!Array.isArray(raw)) return [];
  const out: UniRawEdge[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const to = asNodeKeySource(rec.compnSn);
    if (to === null) continue;
    out.push({ toProviderNodeKey: to, label: asTrimmed(rec.arrwCn) });
  }
  return out;
}

export interface UniCompnMapping extends SopNodeMapping {
  /** 이 노드에서 나가는 간선. 대상은 **provider 키**이며 아직 해석되지 않았다. */
  outgoing: UniRawEdge[];
}

export function mapUniCompn(
  raw: UniRawCompn,
  sequence: number,
): { ok: true; value: UniCompnMapping } | { ok: false; reason: SopMappingRejection } {
  const providerNodeKey = asNodeKeySource(raw.compnSn);
  if (providerNodeKey === null) return { ok: false, reason: 'MISSING_NODE_KEY' };
  const nodeKey = normalizeNodeKey(providerNodeKey, sequence);

  const warnings: SopMappingWarning[] = [];
  if (nodeKey !== providerNodeKey) warnings.push('NODE_KEY_NORMALIZED');

  const rawCode = asNodeKeySource(raw.compnTyCode);
  const type = (rawCode !== null ? TYPE_CODES[rawCode] : undefined) ?? FALLBACK_TYPE;
  if (rawCode === null || TYPE_CODES[rawCode] === undefined) {
    // 유형을 몰라 ACTION으로 세웠다는 사실은 남겨야 한다. 전용 경고 어휘를
    // 새로 만들지 않고 기존 `UNKNOWN_FIELD_DROPPED`를 쓴다 — 뜻이 같다
    // ("provider가 보낸 것을 우리가 쓰지 못했다").
    warnings.push('UNKNOWN_FIELD_DROPPED');
  }

  const rawTitle = asTrimmed(raw.compnSj);
  if (rawTitle === null) warnings.push('MISSING_TITLE');
  const fitted = fitTitle(rawTitle ?? nodeKey);
  if (fitted.truncated) warnings.push('TITLE_TRUNCATED');

  const { tasks, sawAssigneeSlot } = readTasks(raw.compnAttrbSaveParamsList);
  if (tasks.length === 0 && type === 'ACTION') warnings.push('MISSING_TASK');
  if (type === 'ACTION' && tasks.every((t) => t.assigneeHint === null)) {
    warnings.push('MISSING_ASSIGNEE');
  }
  void sawAssigneeSlot;

  const outgoing = readEdges(raw.endCompns);

  // 분기 조건식은 UNI가 주지 않는다. `endCompns[].arrwCn`이 라벨 자리인데
  // 3표본 전부 null이었다 — 자리는 있고 값이 없다.
  const decisionLabels = outgoing.map((e) => e.label).filter((l): l is string => l !== null);
  const decisionExpression = decisionLabels.length > 0 ? decisionLabels.join(' / ') : null;
  if (type === 'DECISION' && decisionExpression === null) {
    warnings.push('MISSING_DECISION_EXPRESSION');
  }

  // 노드 단위 출처가 없다. `__sources__`는 스트림 전체에 한 번 오고 `doc_id`도
  // 없다(실측: `{filename, score, text}`). 노드↔근거를 이을 방법이 provider에
  // 없다는 뜻이므로 전 노드에 경고가 선다 — 그것이 사실이다.
  const sourceRefs: string[] = [];
  warnings.push('NO_SOURCE_REFS');

  // 정말 모르는 키만 경고한다(작도 키는 알면서 버린다).
  const unknown = Object.keys(raw).filter((k) => !MAPPED_KEYS.has(k) && !LAYOUT_KEYS.has(k));
  if (unknown.length > 0 && !warnings.includes('UNKNOWN_FIELD_DROPPED')) {
    warnings.push('UNKNOWN_FIELD_DROPPED');
  }

  return {
    ok: true,
    value: {
      node: {
        nodeKey,
        providerNodeKey,
        type,
        title: fitted.title,
        sequence,
        tasks,
        decisionExpression: type === 'DECISION' ? decisionExpression : null,
        sourceRefs,
      },
      warnings,
      outgoing,
    },
  };
}

/** 합성한 종료 노드에 붙는 접두사. provider 키와 섞이지 않게 한다. */
const SYNTHETIC_END_PREFIX = 'end';

/**
 * provider 키로 된 간선을 UNE 노드 키로 해석하고, 대상이 없으면 종료 노드를
 * 세운다 (CC-410).
 *
 * **왜 세우는가.** 실 UNI는 마지막 처리 노드에서 나가는 간선을 남기면서 그
 * 대상 노드를 보내지 않는다 — 3표본 전부 그랬고 `__done__.count`가 보낸 노드
 * 수와 일치하므로 **잘린 스트림이 아니다**. 그대로 두면 `DANGLING_EDGE`와
 * `NO_END`가 함께 서서 UNI가 만든 모든 SOP가 승인 불가가 된다.
 *
 * **왜 경고를 붙이는가.** 이 노드의 내용은 UNI가 준 것이 아니다. 같은 매퍼가
 * 노드 키를 고치고 제목을 자를 때와 같은 규칙이다 — 고치되 고쳤다고 말한다.
 */
export function resolveUniEdges(
  mapped: ReadonlyArray<{
    node: { nodeKey: string; providerNodeKey: string };
    outgoing: UniRawEdge[];
  }>,
): {
  edges: SopEdgeDraft[];
  synthesizedEnds: Array<{ nodeKey: string; providerNodeKey: string }>;
} {
  const byProviderKey = new Map<string, string>();
  for (const m of mapped) byProviderKey.set(m.node.providerNodeKey, m.node.nodeKey);

  const synthesized = new Map<string, string>();
  const edges: SopEdgeDraft[] = [];

  for (const m of mapped) {
    let priority = 0;
    for (const raw of m.outgoing) {
      let to = byProviderKey.get(raw.toProviderNodeKey);
      if (to === undefined) {
        to = synthesized.get(raw.toProviderNodeKey);
        if (to === undefined) {
          // provider 번호를 키에 살려 둔다 — 어느 간선이 이 노드를 불렀는지
          // 나중에 되짚을 수 있어야 한다.
          const candidate = normalizeNodeKey(
            `${SYNTHETIC_END_PREFIX}-${raw.toProviderNodeKey}`,
            synthesized.size + 1,
          );
          to = candidate;
          synthesized.set(raw.toProviderNodeKey, candidate);
        }
      }
      priority += 1;
      edges.push({
        fromNodeKey: m.node.nodeKey,
        toNodeKey: to,
        conditionExpr: null,
        label: raw.label,
        priority,
      });
    }
  }

  return {
    edges,
    synthesizedEnds: [...synthesized.entries()].map(([providerNodeKey, nodeKey]) => ({
      nodeKey,
      providerNodeKey,
    })),
  };
}
