/** 중복군 계산과 충돌 판정 (CC-210, UNE-SIT-009/010).
 *
 * 정본은 **설계 06 US-SIT-006**이다.
 *
 *   #2 category+location+timeWindow+eventKey로 그룹화 (동일 provider/sourceId는
 *      후보 갱신)                                              → GROUPED
 *   #3 다른 Provider의 동일내용은 duplicate group으로 묶는다.
 *      **원천 Fact 각각 유지**                                 → DEDUP_VIEW
 *   #4 값/시각/수준 불일치를 conflict 후보로 분류한다.
 *      **자동 덮어쓰기 금지**                                  → CONFLICT_DETECTED
 *   #5 선택/제외 전 상태는 UNREVIEWED                          → REVIEWABLE
 *
 * 두 가지를 지킨다.
 *
 * **그룹화와 충돌 판정은 값을 바꾸지 않는다.** 원천 Fact는 그대로 있고 이
 * 모듈은 "무엇이 무엇과 같은 자리에 있는가"만 말한다. 자동 덮어쓰기 금지는
 * 설계의 요구이자 CLAUDE.md의 "사용자 확인 후에만 권위를 갖는다"와 같은 선이다.
 *
 * **location/eventKey는 그룹화 키에 들어가지 않는다.** `situation_fact`에 그
 * 컬럼이 없기 때문이다(0004). 없는 것을 있는 척하지 않고, 지금 쓸 수 있는
 * 축(factKey + 관측시각 창)으로만 묶는다. 한계는 ADR-34에 남긴다.
 */

import { canonicalHash } from '../canonical-json';

/** 그룹화 전략. 0025 §1의 `ck_fact_duplicate_group_strategy`와 같아야 한다. */
export const DUPLICATE_STRATEGIES = ['KEY_TIME_WINDOW', 'KEY_ONLY'] as const;
export type DuplicateStrategy = (typeof DUPLICATE_STRATEGIES)[number];

export const DEFAULT_DUPLICATE_STRATEGY: DuplicateStrategy = 'KEY_TIME_WINDOW';

/** `KEY_TIME_WINDOW`의 기본 창(분). 같은 Key의 관측이 이 창 안에 있으면 같은
 * 사건을 말하는 것으로 본다. 기상 관측이 보통 10분~1시간 주기이므로 1시간을
 * 기본으로 둔다 — 값이 아니라 **기본값**이며 요청이 바꿀 수 있다. */
export const DEFAULT_TIME_WINDOW_MINUTES = 60;

/** 0004 주석의 `conflict_type` 어휘. 0025 §4의 CHECK와 같다. */
export const CONFLICT_TYPES = ['VALUE', 'TIME', 'SOURCE'] as const;
export type ConflictType = (typeof CONFLICT_TYPES)[number];

/** 0025 §4. `OBSOLETE`는 재계산이 "더 이상 존재하지 않는 충돌"을 닫는 자리다 —
 * 보정으로 값이 같아졌는데 OPEN으로 두면 확정이 영구 차단되고, RESOLVED로
 * 적으면 사용자가 하지 않은 선택을 기록하게 된다(아키텍처 리뷰 M-3). */
export const CONFLICT_STATUSES = ['OPEN', 'RESOLVED', 'OBSOLETE'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/** 그룹화·판정의 입력. 저장 행에서 필요한 것만 뽑은 중립 형태다. */
export interface FactForGrouping {
  factId: string;
  factKey: string;
  factType: string;
  value: unknown;
  unit: string | null;
  /** 관측시각. 없으면 수집시각으로 대신한다(호출부가 채운다). */
  observedAt: string | null;
  collectedAt: string;
  providerCode: string;
  sourceId: string;
  status: string;
}

export interface DuplicateGroup {
  groupKey: string;
  factType: string;
  factKey: string;
  strategy: DuplicateStrategy;
  threshold: number | null;
  memberFactIds: string[];
}

export interface DetectedConflict {
  /** 충돌의 단위는 그룹의 단위와 같다(0025 §4, 아키텍처 리뷰 B-1). */
  groupKey: string;
  factKey: string;
  conflictType: ConflictType;
  candidateFactIds: string[];
  /** 사람이 읽을 판정 근거. 화면이 "왜 충돌인가"를 말할 수 있어야 한다. */
  detail: string;
}

export interface GroupingOptions {
  strategy?: DuplicateStrategy;
  /** `KEY_TIME_WINDOW`의 창(분). 다른 전략은 무시한다. */
  timeWindowMinutes?: number;
  /** 0~1. 지금 두 전략은 쓰지 않지만 계약·저장 형태가 받는다(설계 10
   * SIT-009의 `strategy,threshold`). 값을 버리지 않고 그대로 기록한다. */
  threshold?: number | null;
}

function timeOf(fact: FactForGrouping): number {
  const source = fact.observedAt ?? fact.collectedAt;
  const parsed = Date.parse(source);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 창의 시작점으로 내림한다. 창 경계를 시각 그대로 쓰면 1초 차이로 다른
 * 그룹이 되므로, 같은 창에 떨어지는 관측이 같은 키를 갖게 만든다. */
function windowStart(ms: number, windowMinutes: number): number {
  const span = Math.max(1, windowMinutes) * 60_000;
  return Math.floor(ms / span) * span;
}

/**
 * 그룹화. **후보(CANDIDATE)만** 대상이다 — 확정·거부·대체된 Fact를 다시 묶으면
 * 이미 끝난 판단을 되살리게 된다.
 *
 * 멤버가 하나뿐인 자리는 그룹이 아니다(0025 §1의 `member_count >= 2`).
 */
export function groupDuplicates(
  facts: readonly FactForGrouping[],
  options: GroupingOptions = {},
): DuplicateGroup[] {
  const strategy = options.strategy ?? DEFAULT_DUPLICATE_STRATEGY;
  const windowMinutes = options.timeWindowMinutes ?? DEFAULT_TIME_WINDOW_MINUTES;
  const threshold = options.threshold ?? null;

  const buckets = new Map<string, { factType: string; factKey: string; ids: string[] }>();
  for (const fact of facts) {
    if (fact.status !== 'CANDIDATE') continue;
    // **범주(factType)가 키에 들어간다.** 설계 06 US-SIT-006 #2가
    // "category+location+timeWindow+eventKey"라고 적었고, category는
    // `situation_fact.fact_type`으로 존재한다. 빼면 범주가 다른 동명 Key가
    // 한 그룹이 되어 허위 충돌이 열린다 — `USER_ASSERTED/temperature`("체감상
    // 더움")와 `WEATHER_OBSERVATION/temperature`(25)가 그 예다. CC-200
    // 아키텍처 리뷰 m-1이 `findFactKeySpec`에서 고친 것과 같은 결함이다
    // (아키텍처 리뷰 M-1).
    const groupKey =
      strategy === 'KEY_ONLY'
        ? `KEY_ONLY|${fact.factType}|${fact.factKey}`
        : `KEY_TIME_WINDOW|${fact.factType}|${fact.factKey}|${windowStart(timeOf(fact), windowMinutes)}`;
    const bucket = buckets.get(groupKey);
    if (bucket) bucket.ids.push(fact.factId);
    else
      buckets.set(groupKey, { factType: fact.factType, factKey: fact.factKey, ids: [fact.factId] });
  }

  const groups: DuplicateGroup[] = [];
  for (const [groupKey, bucket] of buckets) {
    if (bucket.ids.length < 2) continue;
    groups.push({
      groupKey,
      factType: bucket.factType,
      factKey: bucket.factKey,
      strategy,
      threshold,
      // 결정적 순서. 같은 입력이 같은 결과를 주어야 재계산 비교가 성립한다.
      memberFactIds: [...bucket.ids].sort(),
    });
  }
  return groups.sort((a, b) => a.groupKey.localeCompare(b.groupKey));
}

/** 값 비교는 정규화 JSON 해시로 한다. `{a:1,b:2}`와 `{b:2,a:1}`은 같은 값이고,
 * 문자열 비교로는 그것을 알 수 없다. */
function valueSignature(fact: FactForGrouping): string {
  return canonicalHash({ value: fact.value, unit: fact.unit });
}

/**
 * 충돌 판정. 그룹 안에서만 본다 — 그룹은 "같은 자리를 말하는 Fact들"이므로
 * 그 안의 불일치가 곧 충돌이다.
 *
 * 세 갈래는 0004의 어휘를 그대로 쓴다.
 *   VALUE  값(정규화 후)이 서로 다르다
 *   TIME   값은 같은데 관측시각이 다르다
 *   SOURCE 값도 시각도 같은데 출처가 다르다 → **충돌이 아니라 중복이다**
 *
 * 마지막 갈래를 충돌로 올리지 않는 이유: 설계 06 US-SIT-006 #3이 "다른
 * Provider의 동일내용"을 duplicate group으로 규정하고 conflict로 규정하지
 * 않는다. 같은 값을 두 기관이 보내는 것은 오히려 신뢰의 근거다.
 */
export function detectConflicts(
  facts: readonly FactForGrouping[],
  groups: readonly DuplicateGroup[],
): DetectedConflict[] {
  const byId = new Map(facts.map((f) => [f.factId, f]));
  const conflicts: DetectedConflict[] = [];

  for (const group of groups) {
    const members = group.memberFactIds
      .map((id) => byId.get(id))
      .filter((f): f is FactForGrouping => f !== undefined);
    if (members.length < 2) continue;

    const values = new Set(members.map(valueSignature));
    if (values.size > 1) {
      conflicts.push({
        groupKey: group.groupKey,
        factKey: group.factKey,
        conflictType: 'VALUE',
        candidateFactIds: [...group.memberFactIds],
        detail: `같은 자리에 서로 다른 값 ${values.size}종이 있습니다(${members
          .map((m) => m.providerCode)
          .join(', ')}).`,
      });
      continue;
    }

    const times = new Set(members.map((m) => m.observedAt ?? m.collectedAt));
    if (times.size > 1) {
      conflicts.push({
        groupKey: group.groupKey,
        factKey: group.factKey,
        conflictType: 'TIME',
        candidateFactIds: [...group.memberFactIds],
        detail: '값은 같으나 관측시각이 서로 다릅니다.',
      });
      continue;
    }

    // 값도 시각도 같다 — 중복이지 충돌이 아니다. 아무것도 만들지 않는다.
  }

  return conflicts;
}

/** 해소 대상이 그룹의 후보 중 하나여야 한다. 그룹 밖의 Fact를 "선택"하면
 * 그것은 해소가 아니라 다른 사실의 도입이다. */
export function isSelectableCandidate(
  conflict: { candidateFactIds: readonly string[] },
  factId: string,
): boolean {
  return conflict.candidateFactIds.includes(factId);
}
