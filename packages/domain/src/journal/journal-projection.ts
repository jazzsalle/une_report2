import { canonicalJson, sha256Hex } from '../canonical-json';

/**
 * 상황일지 Projection (CC-300).
 *
 * 설계 09 SCR-JNL 계열, 설계 10 UNE-JNL-005~011.
 *
 * **비협상 규칙**: 일지의 사실칸은 SituationSnapshot과 Execution Log에서
 * 투영된다. AI는 사실 비교 뒤에 서술만 다듬을 수 있고, LLM 출력은 어떤
 * 경우에도 권위 있는 사실 출처가 아니다.
 *
 * 그래서 이 파일이 하는 일은 둘이다: 사실을 접는 것, 그리고 **서술이 그 사실을
 * 반박하지 않는지 대조하는 것**.
 */

/**
 * 일지 상태.
 *
 * 설계 09는 여섯을 적지만 `CONFIGURING`·`PROJECTING`은 도달하지 않는다 —
 * 투영이 동기이기 때문이다(0042 §1). 이 저장소 안의 데이터를 읽어 접는
 * 계산이라 바깥을 기다리지 않는다.
 */
export const JOURNAL_STATUSES = ['DRAFT', 'REVIEW', 'CHANGES_REQUESTED', 'APPROVED'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export function isJournalStatus(v: unknown): v is JournalStatus {
  return (JOURNAL_STATUSES as readonly unknown[]).includes(v);
}

const JOURNAL_TRANSITIONS: Record<JournalStatus, readonly JournalStatus[]> = {
  DRAFT: ['REVIEW'],
  REVIEW: ['APPROVED', 'CHANGES_REQUESTED'],
  // 반려된 일지는 다시 고쳐 검토를 요청한다.
  CHANGES_REQUESTED: ['REVIEW'],
  // 승인은 끝이다. 정정은 새 일지다 — 승인된 것을 고치면 "승인자가 본 것"과
  // "승인된 것"이 갈라진다.
  APPROVED: [],
};

export function canTransitionJournal(from: string, to: string): boolean {
  return (JOURNAL_TRANSITIONS[from as JournalStatus] ?? []).includes(to as JournalStatus);
}

export function isJournalEditable(status: string): boolean {
  return status === 'DRAFT' || status === 'CHANGES_REQUESTED';
}

/**
 * 일지 섹션.
 *
 * 설계 09 SCR-JNL-002의 FactRows Grid가 "시각·유형·조직·임무·사실값"을 요구
 * 한다. 섹션은 그 행들을 묶는 단위이고, 문서와는 **문단 ID 규약**으로 잇는다 —
 * `{sectionKey}::FACT` / `::NARRATIVE`(0044 §2). `document_block` 테이블에는
 * 아직 아무도 쓰지 않는다(ADR-30 수용 한계).
 */
export const JOURNAL_SECTIONS = [
  'OVERVIEW',
  'SITUATION_FACTS',
  'RESPONSE_TIMELINE',
  'TASK_SUMMARY',
  'UNRESOLVED',
] as const;
export type JournalSection = (typeof JOURNAL_SECTIONS)[number];

export function isJournalSection(v: unknown): v is JournalSection {
  return (JOURNAL_SECTIONS as readonly unknown[]).includes(v);
}

export const JOURNAL_SECTION_TITLES: Record<JournalSection, string> = {
  OVERVIEW: '개요',
  SITUATION_FACTS: '상황 사실',
  RESPONSE_TIMELINE: '대응 경과',
  TASK_SUMMARY: '임무 집계',
  UNRESOLVED: '미결 사항',
};

/**
 * 사실칸의 사람 읽는 이름.
 *
 * 화면과 **문서**가 같은 표현을 쓴다. 갈라지면 종이에 나간 것과 화면에서 본
 * 것이 다르고, 어느 쪽이 승인된 것인지 말할 수 없다.
 */
export const FACT_FIELD_LABELS: Record<string, string> = {
  situationTitle: '상황명',
  mode: '구분',
  periodStart: '기간 시작',
  periodEnd: '기간 끝',
  snapshotVersionNo: '확정 판 버전',
  effectiveAt: '기준 시각',
  factCount: '확정 사실 수',
  eventCount: '이벤트 수',
  entryCount: '경과 항목 수',
  taskCount: '임무 수',
  byStatus: '상태별',
  unresolvedCount: '미결 항목 수',
  versionNo: '버전',
};

/**
 * 문서 본문·화면에 **내보내지 않는** 사실 키.
 *
 * 내부 식별자는 사람에게 아무 뜻이 없고, 승인·배포되는 문서에 남으면
 * 최소화 원칙을 어긴다(security.md "Mask or minimize … exports"). 값이
 * 사라지는 것은 아니다 — `fact_payload_json`에 그대로 있고 감사·재현은
 * 그쪽을 본다.
 */
const INTERNAL_FACT_FIELDS = new Set(['snapshotId', 'entries', 'items', 'facts']);

function renderFactValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return `${value.length}건`;
  if (typeof value === 'object') {
    return (
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(', ') || '없음'
    );
  }
  return String(value);
}

/** 사실칸 한 줄씩. 순서는 `factPayload`의 키 순서를 따른다. */
export function factLines(factPayload: Record<string, unknown>): Array<[string, string]> {
  return Object.entries(factPayload)
    .filter(([key]) => !INTERNAL_FACT_FIELDS.has(key))
    .map(([key, value]) => [FACT_FIELD_LABELS[key] ?? key, renderFactValue(value)]);
}

/** 문서 문단 한 줄. 사실칸을 JSON으로 뿌리지 않는다. */
export function factParagraphText(
  sectionKey: string,
  factPayload: Record<string, unknown>,
): string {
  const title = JOURNAL_SECTION_TITLES[sectionKey as JournalSection] ?? sectionKey;
  const body = factLines(factPayload)
    .map(([label, value]) => `${label} ${value}`)
    .join(' · ');
  return `[${title}] ${body || '집계 없음'}`;
}

/** 서술이 어디서 왔는가. `USER`는 재투영이 덮지 않는다. */
export const NARRATIVE_SOURCES = ['PROJECTED', 'AI', 'USER'] as const;
export type NarrativeSource = (typeof NARRATIVE_SOURCES)[number];

// ---------------------------------------------------------------------------
// 투영
// ---------------------------------------------------------------------------

export interface ProjectionEvent {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: Date;
  actorId: string | null;
  payload: Record<string, unknown>;
}

export interface ProjectionTask {
  taskId: string;
  title: string;
  nodeKey: string;
  status: string;
  dueAt: Date | null;
}

export interface ProjectionSnapshot {
  snapshotId: string;
  versionNo: number;
  effectiveAt: Date;
  facts: Array<Record<string, unknown>>;
}

export interface ProjectionInput {
  situationTitle: string;
  mode: string;
  periodStart: Date;
  periodEnd: Date;
  snapshot: ProjectionSnapshot;
  events: readonly ProjectionEvent[];
  tasks: readonly ProjectionTask[];
  /** 이 종류만 담는다. 비면 전부. */
  eventTypes: readonly string[];
}

export interface ProjectedItem {
  sectionKey: JournalSection;
  sortOrder: number;
  /**
   * 사실. **여기 있는 값이 권위다.**
   *
   * API 어느 경로로도 바뀌지 않고, 서술은 이것을 반박할 수 없다.
   */
  factPayload: Record<string, unknown>;
  /** 이 사실을 만든 이벤트. drill-down의 시작점(설계 09 REG-05). */
  sourceEventIds: string[];
  /** 잠긴 필드 이름. 서술 대조가 이 목록을 본다. */
  lockedFields: string[];
  /** 투영이 만든 첫 문장. 사람이 고칠 수 있다. */
  narrativeText: string;
}

const iso = (d: Date): string => d.toISOString();

function inPeriod(at: Date, input: ProjectionInput): boolean {
  return at.getTime() >= input.periodStart.getTime() && at.getTime() <= input.periodEnd.getTime();
}

/**
 * 사실을 접는다.
 *
 * **여기서 문장을 지어내지 않는다.** `narrativeText`는 사실을 그대로 읽은
 * 것이고, 다듬는 것은 사람이나 AI 제안의 일이다 — 투영이 해석을 넣기 시작하면
 * "사실"과 "서술"의 경계가 흐려진다.
 */
export function projectJournal(input: ProjectionInput): ProjectedItem[] {
  const wanted = new Set(input.eventTypes);
  const events = input.events
    .filter((e) => inPeriod(e.occurredAt, input))
    .filter((e) => wanted.size === 0 || wanted.has(e.eventType));

  const items: ProjectedItem[] = [];

  // ── 개요 ────────────────────────────────────────────────────────────────
  const overview = {
    situationTitle: input.situationTitle,
    mode: input.mode,
    periodStart: iso(input.periodStart),
    periodEnd: iso(input.periodEnd),
    snapshotId: input.snapshot.snapshotId,
    snapshotVersionNo: input.snapshot.versionNo,
    eventCount: events.length,
  };
  items.push({
    sectionKey: 'OVERVIEW',
    sortOrder: 0,
    factPayload: overview,
    sourceEventIds: [],
    lockedFields: Object.keys(overview),
    narrativeText:
      `${input.situationTitle} (${input.mode}) — ` +
      `${iso(input.periodStart)} ~ ${iso(input.periodEnd)}, ` +
      `상황 판 v${input.snapshot.versionNo}, 사실원장 ${events.length}건.`,
  });

  // ── 상황 사실 ────────────────────────────────────────────────────────────
  // **확정된 판에서만 온다.** 미확정 후보는 사실이 아니다(CC-210의 규칙).
  const facts = {
    snapshotId: input.snapshot.snapshotId,
    versionNo: input.snapshot.versionNo,
    effectiveAt: iso(input.snapshot.effectiveAt),
    factCount: input.snapshot.facts.length,
    facts: input.snapshot.facts,
  };
  items.push({
    sectionKey: 'SITUATION_FACTS',
    sortOrder: 1,
    factPayload: facts,
    sourceEventIds: [],
    lockedFields: Object.keys(facts),
    narrativeText: `확정된 상황 판 v${input.snapshot.versionNo}에 사실 ${input.snapshot.facts.length}건이 있다.`,
  });

  // ── 대응 경과 ────────────────────────────────────────────────────────────
  const timeline = events.map((e) => ({
    eventId: e.eventId,
    occurredAt: iso(e.occurredAt),
    eventType: e.eventType,
    aggregateType: e.aggregateType,
    actorId: e.actorId,
  }));
  const timelineFact = { entryCount: timeline.length, entries: timeline };
  items.push({
    sectionKey: 'RESPONSE_TIMELINE',
    sortOrder: 2,
    factPayload: timelineFact,
    sourceEventIds: events.map((e) => e.eventId),
    lockedFields: Object.keys(timelineFact),
    narrativeText: `기간 안에 기록된 대응 이벤트는 ${timeline.length}건이다.`,
  });

  // ── 임무 집계 ────────────────────────────────────────────────────────────
  const counts = input.tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});
  const taskFact = { taskCount: input.tasks.length, byStatus: counts };
  items.push({
    sectionKey: 'TASK_SUMMARY',
    sortOrder: 3,
    factPayload: taskFact,
    sourceEventIds: events.filter((e) => e.aggregateType === 'TASK').map((e) => e.eventId),
    lockedFields: Object.keys(taskFact),
    narrativeText: `임무 ${input.tasks.length}건. ${
      Object.entries(counts)
        .map(([status, n]) => `${status} ${n}건`)
        .join(', ') || '집계 없음'
    }.`,
  });

  // ── 미결 사항 ────────────────────────────────────────────────────────────
  // 끝나지 않은 임무. **비어 있어도 섹션을 만든다** — "미결 없음"을 말하는 것과
  // 그 칸이 없는 것은 다르다.
  const unresolved = input.tasks
    .filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED')
    .map((t) => ({
      taskId: t.taskId,
      title: t.title,
      status: t.status,
      dueAt: t.dueAt ? iso(t.dueAt) : null,
    }));
  const unresolvedFact = { unresolvedCount: unresolved.length, items: unresolved };
  items.push({
    sectionKey: 'UNRESOLVED',
    sortOrder: 4,
    factPayload: unresolvedFact,
    sourceEventIds: [],
    lockedFields: Object.keys(unresolvedFact),
    narrativeText:
      unresolved.length === 0 ? '미결 임무가 없다.' : `미결 임무 ${unresolved.length}건이 남았다.`,
  });

  return items;
}

/**
 * 투영 해시.
 *
 * **사실만 넣는다.** 서술을 넣으면 사람이 문장을 다듬을 때마다 해시가 바뀌어
 * "사실이 바뀌었다"는 신호가 무의미해진다. 이 값이 하는 일은 하나다 —
 * 일지를 만든 뒤 바깥의 사실이 움직였는지 알려 주는 것.
 */
export function projectionHash(items: readonly ProjectedItem[]): string {
  return sha256Hex(
    canonicalJson(
      items.map((i) => ({
        sectionKey: i.sectionKey,
        factPayload: i.factPayload,
        sourceEventIds: [...i.sourceEventIds].sort(),
      })),
    ),
  );
}

// ---------------------------------------------------------------------------
// 사실 대조 — 서술이 사실을 반박하지 않는가
// ---------------------------------------------------------------------------

/**
 * 비협상 규칙 "AI may improve wording **only after fact comparison**"의 실체.
 *
 * **대조 방향이 핵심이다.** 한국어 자유 텍스트에서 수치를 열린 집합으로 뽑으면
 * 오탐이 쏟아지고, 경보 피로가 생기면 방어가 없는 것보다 나빠진다. 반대로 간다:
 * **사실칸에서 결정론적으로 뽑은 닫힌 집합**을 서술에서 역탐색해, 같은 이름표를
 * 달고 **다른 값**이 나온 곳만 잡는다.
 *
 * 예: 사실칸에 `taskCount: 7`이 있는데 서술에 "임무 5건"이 있으면 잡힌다.
 * 서술에 임무 수를 아예 적지 않으면 잡지 않는다 — 빠뜨린 것은 모순이 아니다.
 *
 * 이것이 완전한 사실 검증은 아니다. 완전한 것은 자연어 이해를 요구하고 그것은
 * 이 프로젝트가 T3Q에 맡긴 영역이다. 여기서 막는 것은 **숫자가 서로 다른 경우**
 * — 재난 상황일지에서 가장 자주, 가장 위험하게 틀리는 종류다.
 */
export interface FactContradiction {
  field: string;
  factValue: number;
  narrativeValue: number;
  /** 서술에서 그 값을 발견한 자리. 화면이 그 부분을 짚어 준다. */
  excerpt: string;
}

/** 사실 이름 → 서술에서 그 값 앞뒤에 붙는 한국어 표현. */
/**
 * 숫자 하나.
 *
 * **자릿수 쉼표는 세 자리 묶음일 때만** 인정한다. `[0-9][0-9,]*`처럼 쓰면
 * `판 v1, 사실원장`의 문장부호 쉼표를 자릿수 쉼표로 삼켜 `1,`을 숫자로 읽고,
 * 갓 만든 일지가 태어나자마자 모순 표시를 달게 된다(이중검토 F4).
 */
const NUMBER = '[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+';

const FIELD_PHRASES: Record<string, readonly string[]> = {
  eventCount: ['이벤트', '사실원장'],
  factCount: ['사실'],
  entryCount: ['이벤트', '대응'],
  taskCount: ['임무'],
  unresolvedCount: ['미결'],
  completedCount: ['완료'],
  snapshotVersionNo: ['판 v', '버전'],
  versionNo: ['판 v', '버전'],
};

/** 서술에서 숫자를 그 앞뒤 낱말과 함께 뽑는다. */
function numbersNear(text: string, phrase: string): Array<{ value: number; excerpt: string }> {
  const out: Array<{ value: number; excerpt: string }> = [];
  const p = escapeRegExp(phrase);

  // `임무 7건` / `이벤트는 7건` / `미결 임무 7건` — 표현과 숫자 사이에 조사나
  // 짧은 명사가 끼는 것을 허용하되 **한글과 공백만** 넘는다. 문장부호를 넘게
  // 하면 다른 절의 숫자를 끌어온다.
  const after = new RegExp(`${p}[가-힣\\s]{0,6}(${NUMBER})`, 'g');

  // `7건의 임무` — 숫자 뒤의 연결은 **수량 표현**만 허용한다. 아무 한글이나
  // 허용하면 `판 v1에 사실 2건`의 버전 번호를 사실 수로 읽는다(이중검토 F4).
  const before = new RegExp(`(${NUMBER})\\s*(?:건|개|명|차|회|번)?\\s*의?\\s*${p}`, 'g');

  for (const re of [after, before]) {
    let m = re.exec(text);
    while (m) {
      const value = Number(m[1].replace(/,/g, ''));
      if (Number.isFinite(value)) out.push({ value, excerpt: m[0] });
      m = re.exec(text);
    }
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 서술이 사실을 반박하는가.
 *
 * 빈 배열이면 모순이 없다는 뜻이지 "서술이 사실을 다 담았다"는 뜻이 아니다.
 */
export function findFactContradictions(
  factPayload: Record<string, unknown>,
  narrativeText: string,
): FactContradiction[] {
  const out: FactContradiction[] = [];
  for (const [field, phrases] of Object.entries(FIELD_PHRASES)) {
    const factValue = factPayload[field];
    if (typeof factValue !== 'number') continue;
    for (const phrase of phrases) {
      for (const found of numbersNear(narrativeText, phrase)) {
        if (found.value !== factValue) {
          out.push({ field, factValue, narrativeValue: found.value, excerpt: found.excerpt });
        }
      }
    }
  }
  // 같은 자리를 두 표현이 함께 잡을 수 있다.
  const seen = new Set<string>();
  return out.filter((c) => {
    const key = `${c.field}|${c.narrativeValue}|${c.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 사실칸 자체를 바꾸려 했는가.
 *
 * 대조(위)가 있어도 **구조적 분리가 하드 불변식으로 깔려 있어야** 성립한다 —
 * 사실에 닿는 경로가 하나라도 열려 있으면 대조는 우회된다.
 */
/**
 * 제안을 반영할 것인가 (CC-300 D4·D5).
 *
 * **AI에는 fail-closed다.** 사실을 반박하면 반영하지 않는다 — 거절 비용은
 * "운영자가 그 문장을 직접 쓴다"뿐이고, 통과 비용은 틀린 숫자가 승인된
 * 일지에 남는 것이다. 사람이 쓴 문장도 덮지 않는다.
 *
 * 규칙을 서비스 안에 두지 않고 여기로 꺼낸 이유: **지금 붙어 있는 어댑터로는
 * 이 분기가 발동하지 않는다.** 시뮬레이션 어댑터는 사실에서만 문장을 만들어
 * 구조적으로 반박이 없기 때문이다(OB-03). 그래서 E2E로는 증명할 수 없고,
 * 규칙 자체를 이름 붙여 여기서 시험한다 — 실 어댑터가 오는 날 이 분기가
 * 처음 도는데, 그때 처음 검증하는 것은 늦다.
 */
export function acceptProposal(input: {
  contradictions: readonly FactContradiction[];
  narrativeSource: string;
}): boolean {
  if (input.contradictions.length > 0) return false;
  return input.narrativeSource !== 'USER';
}

export function touchesLockedFacts(
  lockedFields: readonly string[],
  proposedFields: readonly string[],
): string[] {
  const locked = new Set(lockedFields);
  return proposedFields.filter((f) => locked.has(f));
}
