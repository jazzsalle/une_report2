/** 불변 SituationSnapshot — 확정·해시·버전·비교 (CC-210, UNE-SIT-012/013).
 *
 * 정본은 **설계 06 US-SIT-008**이다.
 *
 *   #1 확정 대상과 누락·STALE·보조출처 경고를 요약한다     → CONFIRM_PREVIEW
 *   #3 선택 Fact의 canonical JSON hash를 계산한다
 *      (정렬·직렬화 규칙 고정)                             → HASHED
 *   #4 SituationSnapshot을 **불변 저장**한다               → SNAPSHOT_CONFIRMED
 *   #5 Incident 기준 snapshotId를 갱신한다. **기존 Snapshot 보존**
 *                                                          → CONTEXT_CONFIRMED
 *   인수기준: 확정 후 변경 0건, **재확정은 새 snapshotId**
 *   A-02: 확정 후 새 정보가 와도 **기존 Snapshot 자동변경 금지**
 *
 * 이 파일은 판단만 한다 — 저장은 저장소가, 불변성은 DB가 지킨다
 * (0011 §3 `REVOKE UPDATE, DELETE`, 0025 §6의 버전 유니크·해시 형식).
 */

import { canonicalHash } from '../canonical-json';

/** Snapshot에 박히는 Fact의 형태.
 *
 * `situation-snapshot.schema.json`의 `facts[]`는 `situation-fact.schema.json`을
 * 참조하므로 **Fact 전체가 복사돼 들어간다.** 참조(factId 목록)만 두지 않는
 * 이유가 설계 06 A-02다 — 확정 후에 원천이 바뀌어도 Snapshot은 그대로여야
 * 하는데, 참조만 두면 원천을 따라 값이 움직인다. CC-210이 파생 Fact를 도입해
 * 원천을 덮지 않게 했지만(0025 §2), 그것과 별개로 **Snapshot은 자기 사본을
 * 갖는다.** 두 겹의 보호이며 어느 하나가 무너져도 확정 사실은 남는다.
 */
export interface SnapshotFact {
  factId: string;
  factType: string;
  factKey: string;
  value: unknown;
  unit: string | null;
  source: {
    providerCode: string;
    sourceName: string;
    sourceUrl: string | null;
    collectedAt: string;
  };
  observedAt: string | null;
  collectedAt: string;
  confidence: number | null;
  status: string;
}

/**
 * 해시 대상.
 *
 * 무엇을 넣고 무엇을 빼는지가 이 함수의 전부다.
 *
 * **넣는 것**: 사실 자체(값·단위·시각·출처·범주·Key)와 `effectiveAt`.
 * **빼는 것**: `confirmedBy`/`confirmedAt`/`versionNo`/`reason`/`snapshotId`.
 *
 * 뺀 것들은 "누가 언제 확정했는가"이지 "무엇이 사실인가"가 아니다. 같은 사실을
 * 다른 사람이 다시 확정했을 때 해시가 달라지면, 해시로는 **내용이 같은지**를
 * 물을 수 없게 된다. CC-110의 `plan_context_snapshot.content_hash`가 같은
 * 이유로 확정자·시각을 뺀다(ADR-23 D4의 동일 내용 재확정 dedupe).
 *
 * `factId`는 **넣는다.** 값이 같아도 다른 근거에서 온 사실은 다른 Snapshot이며,
 * 감사에서 "이 Snapshot이 가리킨 근거"를 되짚을 수 있어야 한다.
 */
export function snapshotContentHash(facts: readonly SnapshotFact[], effectiveAt: string): string {
  return canonicalHash({
    effectiveAt,
    // 순서가 해시를 바꾸면 같은 사실 집합이 두 해시를 갖는다. factId로 정렬한다.
    facts: [...facts].sort((a, b) => a.factId.localeCompare(b.factId)),
  });
}

/** 확정을 막는 사유. 화면이 무엇을 하라고 말할지 정할 수 있어야 하므로
 * "확정 불가" 하나로 뭉치지 않는다. */
export const SNAPSHOT_BLOCKERS = [
  /** 인수기준 "unresolved conflict block" — 설계 10의 SIT-412-003. */
  'UNRESOLVED_CONFLICT',
  /** 설계 10 오류표 SIT-422-006 "출처 없는 Fact". */
  'FACT_WITHOUT_SOURCE',
  'NO_FACTS_SELECTED',
  /** 후보가 아닌 Fact(거부·대체)를 확정 대상에 넣었다. */
  'FACT_NOT_SELECTABLE',
  /** 이 상황의 Fact가 아니다. */
  'FACT_NOT_IN_SITUATION',
  /** 같은 표준 Key를 두 번 넣었다 — 어느 쪽이 기준인지 정해지지 않는다. */
  'DUPLICATE_FACT_KEY',
] as const;

export type SnapshotBlocker = (typeof SNAPSHOT_BLOCKERS)[number];

export interface SnapshotBlockerDetail {
  reason: SnapshotBlocker;
  detail: string;
}

export interface SnapshotConfirmInput {
  /** 확정 대상으로 요청된 factId 목록(요청 순서 그대로). */
  requestedFactIds: readonly string[];
  /** 이 상황의 Fact들(상태·출처 포함). */
  facts: readonly {
    factId: string;
    factType: string;
    factKey: string;
    status: string;
    hasSource: boolean;
  }[];
  /** OPEN 상태 충돌 수. */
  openConflictCount: number;
}

/**
 * 확정 선행조건 검사.
 *
 * **미해결 충돌이 있으면 확정하지 않는다.** 설계 06 US-SIT-008의 선행조건이
 * "미해결 필수충돌 없음"이고 US-SIT-007 #5가 "미해결 필수충돌이 있으면 경고"다.
 * 자동으로 하나를 고르지 않는 이유는 US-SIT-006 #4의 "자동 덮어쓰기 금지"와
 * 같다 — 어느 값이 사실인지는 사람이 정한다.
 *
 * 예외 승인 경로("또는 승인된 예외")는 만들지 않는다. 승인 주체·기록 형태가
 * 설계에 없고, 지금 만들면 추측한 승인이 감사에 남는다(ADR-34 수용 한계).
 */
export function checkSnapshotConfirmable(input: SnapshotConfirmInput): SnapshotBlockerDetail[] {
  const blockers: SnapshotBlockerDetail[] = [];

  if (input.requestedFactIds.length === 0) {
    blockers.push({ reason: 'NO_FACTS_SELECTED', detail: '확정할 Fact가 없습니다.' });
  }

  if (input.openConflictCount > 0) {
    blockers.push({
      reason: 'UNRESOLVED_CONFLICT',
      detail: `해소되지 않은 충돌이 ${input.openConflictCount}건 있습니다. 먼저 확정하십시오.`,
    });
  }

  const byId = new Map(input.facts.map((f) => [f.factId, f]));
  const seenKeys = new Map<string, string>();

  for (const factId of input.requestedFactIds) {
    const fact = byId.get(factId);
    if (!fact) {
      blockers.push({
        reason: 'FACT_NOT_IN_SITUATION',
        detail: `이 상황의 Fact가 아닙니다: ${factId}`,
      });
      continue;
    }
    // 확정 대상은 **후보이거나 이미 확정된 것**이다.
    //
    // 처음에는 CANDIDATE만 받았는데, 그러면 v1에서 확정한 Fact가 CONFIRMED가
    // 되어 v2에 다시 담을 수 없다. 재확정은 v2에 새로 확정하는 것만 담게 되고,
    // 바뀌지 않은 사실이 **현재 기준 Snapshot에서 통째로 사라진다** — Diff가
    // 사용자가 지운 적 없는 사실을 REMOVED로 보고했다(아키텍처 리뷰 M-2).
    // 거부·대체된 것만 막는다.
    if (fact.status !== 'CANDIDATE' && fact.status !== 'CONFIRMED') {
      blockers.push({
        reason: 'FACT_NOT_SELECTABLE',
        detail: `후보가 아닌 Fact는 확정할 수 없습니다(${fact.status}): ${factId}`,
      });
      continue;
    }
    if (!fact.hasSource) {
      blockers.push({
        reason: 'FACT_WITHOUT_SOURCE',
        detail: `출처가 없는 Fact는 확정할 수 없습니다: ${factId}`,
      });
      continue;
    }
    // 그룹화가 (범주, Key)로 묶으므로 중복 판정도 같은 축이어야 한다 —
    // `USER_ASSERTED/value`와 `FIELD_REPORT/value`는 다른 사실이다.
    const identity = `${fact.factType}|${fact.factKey}`;
    const previous = seenKeys.get(identity);
    if (previous !== undefined) {
      blockers.push({
        reason: 'DUPLICATE_FACT_KEY',
        detail: `같은 범주·표준 Key를 두 번 확정할 수 없습니다(${fact.factType}/${fact.factKey}): ${previous}, ${factId}`,
      });
      continue;
    }
    seenKeys.set(identity, factId);
  }

  return blockers;
}

/**
 * 확정은 **내가 본 판 위에서** 이뤄져야 한다.
 *
 * 설계 06 US-SIT-008은 입력에 `contextRevision`을 두고 E-01에 "revision 불일치
 * → 최신 Context 재검토 요구"라고 적었다. CC-210 본편은 그것을 구현하지 않아
 * 통제관 둘이 같은 화면을 열어 두고 각각 확정하면 **둘 다 성공했다** — 뒤에
 * 누른 사람은 앞사람의 확정을 보지 못한 채 기준 상황을 바꿨고, 앞사람은 자기
 * 확정이 여전히 기준이라고 믿었다. 이 함수가 그 경로를 닫는다
 * (ADR-34 D17, 수용 한계 10 닫힘).
 *
 * 상황 행 잠금은 **순서만 정할 뿐** 그 사실을 알려주지 않는다.
 *
 * 검사 축으로 `situation.version_no`(If-Match)가 아니라 **직전 snapshotId**를
 * 쓴다(사용자 결정 2026-08-09). 확정이 실제로 묻는 것은 "당신이 본 판이 아직
 * 최신인가"이지 "상황의 제목·장소가 그대로인가"가 아니다. 버전을 쓰면 무관한
 * 편집이 확정을 막는다.
 *
 * 첫 확정은 양쪽 모두 `null`이다. 요청이 이 값을 **생략할 수 없게** 해야
 * 가드가 우회되지 않는다 — 계약에서 required로 둔 이유다.
 */
export function isSnapshotBaselineCurrent(
  expectedSnapshotId: string | null,
  currentSnapshotId: string | null,
): boolean {
  return expectedSnapshotId === currentSnapshotId;
}

/** 재확정은 새 snapshotId이고 버전은 하나 오른다(설계 06 인수기준).
 * 기존 Snapshot은 그대로 남고 새 것이 `supersedes_id`로 이전을 가리킨다. */
export function nextSnapshotVersion(currentVersion: number | null): number {
  return (currentVersion ?? 0) + 1;
}

/** 확정이 상황 상태를 CONTEXT_CONFIRMED로 올린다(설계 06 US-SIT-008 #5
 * 상태전이, 설계 06 §7.1의 Incident 흐름). 이미 그 이후 상태면 그대로 둔다 —
 * 재확정이 진행 중인 상황을 되돌리지 않는다. */
const BEFORE_CONTEXT_CONFIRMED: ReadonlySet<string> = new Set(['DRAFT', 'REGISTERED']);

export function nextStatusOnSnapshotConfirmed(current: string): string {
  return BEFORE_CONTEXT_CONFIRMED.has(current) ? 'CONTEXT_CONFIRMED' : current;
}

// ── Diff (UNE-SIT-013 compareTo) ────────────────────────────────────────────

export const SNAPSHOT_DIFF_KINDS = ['ADDED', 'REMOVED', 'CHANGED', 'UNCHANGED'] as const;
export type SnapshotDiffKind = (typeof SNAPSHOT_DIFF_KINDS)[number];

export interface SnapshotDiffEntry {
  factKey: string;
  kind: SnapshotDiffKind;
  from: { factId: string; value: unknown; unit: string | null; observedAt: string | null } | null;
  to: { factId: string; value: unknown; unit: string | null; observedAt: string | null } | null;
}

export interface SnapshotDiff {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  entries: SnapshotDiffEntry[];
}

function sideOf(fact: SnapshotFact): SnapshotDiffEntry['from'] {
  return {
    factId: fact.factId,
    value: fact.value,
    unit: fact.unit,
    observedAt: fact.observedAt,
  };
}

/**
 * 두 Snapshot을 **표준 Key 기준으로** 비교한다(인수기준 "change comparison").
 *
 * factId로 비교하지 않는 이유: 확정할 때마다 다른 근거(다른 Provider 응답)를
 * 고를 수 있고, 그러면 같은 사실이 매번 "삭제 + 추가"로 보인다. 사용자가 묻는
 * 것은 "무엇이 달라졌나"이지 "어느 행을 골랐나"가 아니다. 근거가 바뀐 사실은
 * `from.factId`/`to.factId`로 드러난다.
 *
 * 같은 Key가 한 Snapshot에 두 번 들어갈 수 없다는 것은
 * `checkSnapshotConfirmable`의 `DUPLICATE_FACT_KEY`가 보장한다.
 */
export function diffSnapshots(
  from: readonly SnapshotFact[],
  to: readonly SnapshotFact[],
): SnapshotDiff {
  // 비교 축은 확정 축(범주+Key)과 같아야 한다.
  const identityOf = (f: SnapshotFact): string => `${f.factType}|${f.factKey}`;
  const fromByKey = new Map(from.map((f) => [identityOf(f), f]));
  const toByKey = new Map(to.map((f) => [identityOf(f), f]));
  const keys = [...new Set([...fromByKey.keys(), ...toByKey.keys()])].sort();

  const entries: SnapshotDiffEntry[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const identity of keys) {
    const before = fromByKey.get(identity);
    const after = toByKey.get(identity);
    const factKey = (before ?? after)?.factKey ?? identity;

    if (!before && after) {
      added += 1;
      entries.push({ factKey, kind: 'ADDED', from: null, to: sideOf(after) });
      continue;
    }
    if (before && !after) {
      removed += 1;
      entries.push({ factKey, kind: 'REMOVED', from: sideOf(before), to: null });
      continue;
    }
    if (!before || !after) continue;

    // 값 비교도 정규화 해시로 한다 — 키 순서가 다른 같은 객체를 "변경"이라
    // 부르지 않는다.
    const same =
      canonicalHash({ value: before.value, unit: before.unit, observedAt: before.observedAt }) ===
      canonicalHash({ value: after.value, unit: after.unit, observedAt: after.observedAt });
    if (same) {
      unchanged += 1;
      entries.push({ factKey, kind: 'UNCHANGED', from: sideOf(before), to: sideOf(after) });
    } else {
      changed += 1;
      entries.push({ factKey, kind: 'CHANGED', from: sideOf(before), to: sideOf(after) });
    }
  }

  return { added, removed, changed, unchanged, entries };
}
