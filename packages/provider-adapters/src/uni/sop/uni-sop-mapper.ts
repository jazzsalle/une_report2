import {
  fitTitle,
  isSopNodeType,
  normalizeNodeKey,
  type SopMappingRejection,
  type SopMappingWarning,
  type SopNodeMapping,
  type SopNodeType,
  type SopTask,
} from '@une/domain';

/**
 * UniSopMapper — UNI `__compn__` 하나를 UNE SopNode로 옮긴다 (CC-240).
 *
 * 설계 08 §1.11.
 *
 * **여기가 어댑터 패키지인 이유.** provider 필드명(`compnSn`/`branch`/`task`)을
 * 아는 코드는 어댑터에만 있어야 한다(`.claude/rules/architecture.md`:
 * "Provider-specific DTOs live only under provider adapters"). T3Q 쪽이 이미
 * 같은 형태다 — `legacy-toc-mapper.ts`가 provider 응답을 알고, 도메인은
 * provider 중립 타입(`TocNodeDraft`)만 안다. 처음에는 이 매퍼를 도메인에 두었고
 * 그 결과 어댑터 포트가 도메인에서 provider DTO를 import하는 역전이 생겼다.
 *
 * **매퍼에 버전이 있다.** UNI compns 구조가 UNE 표준과 일치한다는 보장이 없고
 * (설계가 명시한다) 저쪽이 바꿀 수 있다. 어느 규칙으로 옮겼는지가 결과에 남지
 * 않으면, 나중에 그래프가 이상할 때 UNI가 바꾼 것인지 우리가 잘못 옮긴 것인지
 * 알 수 없다. 이 값이 `sop_version.schema_version`에 들어간다.
 */
export const UNI_SOP_MAPPER_VERSION = 'uni-sop-1';

/** UNI가 보내는 compn 원문. 필드 이름은 설계 08 §1.11이 적은 것이다. */
export interface UniRawCompn {
  compnSn?: unknown;
  type?: unknown;
  name?: unknown;
  task?: unknown;
  branch?: unknown;
  source?: unknown;
  [key: string]: unknown;
}

/** 설계 08 §1.11이 적은 UNI 유형 어휘 → UNE 노드 유형. */
const TYPE_ALIASES: Record<string, SopNodeType> = {
  START: 'START',
  BEGIN: 'START',
  ACTION: 'ACTION',
  TASK: 'ACTION',
  STEP: 'ACTION',
  DECISION: 'DECISION',
  BRANCH: 'DECISION',
  NOTE: 'NOTE',
  MEMO: 'NOTE',
  END: 'END',
  FINISH: 'END',
};

const KNOWN_KEYS = new Set(['compnSn', 'type', 'name', 'task', 'branch', 'source']);

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).filter((x): x is string => x !== null);
  const one = asString(v);
  return one === null ? [] : [one];
}

export function mapUniCompn(
  raw: UniRawCompn,
  sequence: number,
): { ok: true; value: SopNodeMapping } | { ok: false; reason: SopMappingRejection } {
  const providerNodeKey = asString(raw.compnSn);
  if (!providerNodeKey) return { ok: false, reason: 'MISSING_NODE_KEY' };
  const nodeKey = normalizeNodeKey(providerNodeKey, sequence);

  const rawType = asString(raw.type);
  const aliased = rawType ? TYPE_ALIASES[rawType.toUpperCase()] : undefined;
  const type = aliased && isSopNodeType(aliased) ? aliased : undefined;
  if (!type) return { ok: false, reason: 'UNKNOWN_NODE_TYPE' };

  const warnings: SopMappingWarning[] = [];
  if (nodeKey !== providerNodeKey) warnings.push('NODE_KEY_NORMALIZED');

  const rawTitle = asString(raw.name);
  if (!rawTitle) warnings.push('MISSING_TITLE');
  // provider 문자열에는 길이 제한이 없고 `sop_node.title`은 varchar(300)이다.
  // 자르지 않으면 22001이 트랜잭션 전체를 되돌린다.
  const fitted = fitTitle(rawTitle ?? nodeKey);
  if (fitted.truncated) warnings.push('TITLE_TRUNCATED');

  const instructions = asStringList(raw.task);
  if (instructions.length === 0 && type === 'ACTION') warnings.push('MISSING_TASK');
  const tasks: SopTask[] = instructions.map((instruction) => ({
    instruction,
    assigneeHint: null,
  }));
  if (type === 'ACTION' && tasks.every((t) => t.assigneeHint === null)) {
    // 누가 하는지 없으면 실행 단계에서 배정할 수 없다 — 사용자가 채워야 한다.
    // 임무가 아예 없을 때도 붙인다: 임무를 채우고 나면 담당은 여전히 비어 있다.
    warnings.push('MISSING_ASSIGNEE');
  }

  const decisionExpression = asString(raw.branch);
  if (type === 'DECISION' && !decisionExpression) warnings.push('MISSING_DECISION_EXPRESSION');

  const sourceRefs = asStringList(raw.source);
  if (sourceRefs.length === 0) warnings.push('NO_SOURCE_REFS');

  // 모르는 필드는 버리되 **버렸다는 사실을 남긴다.** 조용히 버리면 UNI가 새
  // 필드를 추가했을 때 아무도 모른다(OB-04가 열려 있는 동안 특히 그렇다).
  if (Object.keys(raw).some((k) => !KNOWN_KEYS.has(k))) warnings.push('UNKNOWN_FIELD_DROPPED');

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
    },
  };
}
