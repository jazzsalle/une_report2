import { canonicalJson, sha256Hex } from '../canonical-json';

/**
 * Execution Log와 전자상황판 투영 (CC-290).
 *
 * 설계 09 SCR-BOARD-001, 설계 10 UNE-JNL-001~004.
 *
 * **대시보드는 임무 행이 아니라 이벤트에서 계산된다.** CC-280이 임무에 수행
 * 시각 컬럼을 두지 않은 것과 같은 결정이다 — "언제 무엇이 됐는가"의 정본은
 * 사실원장 하나여야 하고, 대시보드만 다른 정본을 쓰면 그 결정을 배반한다.
 */

/** 정정 이벤트의 타입. 원본과 같은 값을 쓰면 타입별 집계가 두 번 센다. */
export const EXECUTION_CORRECTION_EVENT_TYPE = 'EXECUTION_EVENT_CORRECTED';

/**
 * 정정할 수 있는 이벤트.
 *
 * **사람이 보고한 사실만이다.** 상태 전이나 전파 결과 같은 시스템 관측 이벤트는
 * "시스템이 그때 그렇게 했다"는 기록이라 그 자체로 참이다. 시스템이 잘못했다면
 * 정정이 아니라 **새 도메인 행위**(재전파, 반려, 재배정)로 바로잡는 것이 맞다 —
 * 기록을 고치는 것이 아니라 사실을 하나 더 만드는 것이다.
 */
export const CORRECTABLE_EVENT_TYPES = [
  'TASK_PROGRESS_REPORTED',
  'TASK_COMPLETION_SUBMITTED',
  'TASK_UNABLE_REPORTED',
  'TASK_ATTACHMENT_ADDED',
] as const;
export type CorrectableEventType = (typeof CORRECTABLE_EVENT_TYPES)[number];

export function isCorrectableEventType(v: unknown): v is CorrectableEventType {
  return (CORRECTABLE_EVENT_TYPES as readonly unknown[]).includes(v);
}

/**
 * 정정으로 바꿀 수 없는 필드.
 *
 * `status`가 여기 있는 것이 핵심이다. CC-280이 "이벤트가 자기 시점의 상태를
 * 들고 있다"를 고쳐 놓았는데, 정정으로 그것을 바꿀 수 있으면 같은 결함을
 * 정정 경로로 다시 들여오는 셈이다. 나머지도 사람이 적은 값이 아니라 시스템이
 * 붙인 참조다.
 */
export const PROTECTED_CORRECTION_FIELDS = [
  'status',
  'runId',
  'nodeKey',
  'taskId',
  'correctsEventId',
  'correctedEventHash',
  'correctedEventType',
  'reason',
  'replacementFields',
] as const;

export interface CorrectionViolation {
  field: string;
  reason: string;
}

export interface CorrectionInput {
  targetEventType: string;
  targetIsCorrection: boolean;
  reason: string;
  replacementFields: Record<string, unknown>;
}

/**
 * 대체값의 상한.
 *
 * 사실원장은 append-only라 **나중에 마스킹도 삭제도 할 수 없다.** 값 검증 없이
 * 받으면 개인정보든 300단 중첩 객체든 영구히 남는다(실측으로 둘 다 통과했다).
 */
export const CORRECTION_VALUE_MAX_CHARS = 4_000;
export const CORRECTION_VALUE_MAX_DEPTH = 4;

function valueViolations(key: string, value: unknown, depth: number): CorrectionViolation[] {
  if (depth > CORRECTION_VALUE_MAX_DEPTH) {
    return [
      {
        field: `replacementFields.${key}`,
        reason: `중첩이 ${CORRECTION_VALUE_MAX_DEPTH}단을 넘습니다.`,
      },
    ];
  }
  if (typeof value === 'string' && value.length > CORRECTION_VALUE_MAX_CHARS) {
    return [
      {
        field: `replacementFields.${key}`,
        reason: `${CORRECTION_VALUE_MAX_CHARS}자를 넘습니다.`,
      },
    ];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => valueViolations(key, item, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap((item) => valueViolations(key, item, depth + 1));
  }
  return [];
}

/**
 * 정정 요청이 받아들여지는가 (UNE-JNL-004).
 *
 * DB도 star 구조와 대상 존재를 막지만(0040 §1), 사용자에게 이유를 말하는 것은
 * 여기다 — 트리거가 던지는 42501은 화면이 읽을 수 있는 문장이 아니다.
 */
export function validateCorrection(input: CorrectionInput): CorrectionViolation[] {
  const violations: CorrectionViolation[] = [];

  if (input.targetIsCorrection) {
    violations.push({
      field: 'eventId',
      reason: '정정 이벤트는 다시 정정할 수 없습니다. 원본을 정정하십시오.',
    });
  } else if (!isCorrectableEventType(input.targetEventType)) {
    violations.push({
      field: 'eventId',
      reason: `${input.targetEventType}은 사람이 보고한 사실이 아니라 정정할 수 없습니다.`,
    });
  }

  if (input.reason.trim().length === 0) {
    // 왜 고쳤는지 없는 정정은 감사에서 "누군가 값을 바꿨다"로만 남는다.
    violations.push({ field: 'reason', reason: '정정 사유를 입력하십시오.' });
  }

  const keys = Object.keys(input.replacementFields);
  if (keys.length === 0) {
    violations.push({ field: 'replacementFields', reason: '바꿀 값이 없습니다.' });
  }
  for (const key of keys) {
    if ((PROTECTED_CORRECTION_FIELDS as readonly string[]).includes(key)) {
      violations.push({ field: `replacementFields.${key}`, reason: '정정할 수 없는 항목입니다.' });
      continue;
    }
    violations.push(...valueViolations(key, input.replacementFields[key], 1));
  }
  return violations;
}

/**
 * 정정 이벤트의 payload.
 *
 * **입력은 부분 패치이고 저장은 전체다.** 쓰는 시점에 유효 payload와 병합해
 * 완성본을 남긴다 — 읽는 쪽이 매번 체인을 재생하지 않아도 "지금 사실"을 알 수
 * 있고, 원본은 append-only라 나중에 변하지 않으므로 그 병합은 안전하다.
 * `replacementFields`도 함께 남겨 "무엇을 고쳤는가"에 답한다.
 */
export function buildCorrectionPayload(input: {
  effectivePayload: Record<string, unknown>;
  replacementFields: Record<string, unknown>;
  reason: string;
  correctedEventId: string;
  correctedEventType: string;
  correctedEventHash: string;
}): Record<string, unknown> {
  return {
    ...input.effectivePayload,
    ...input.replacementFields,
    correctsEventId: input.correctedEventId,
    correctedEventType: input.correctedEventType,
    // 원본 해시를 싣는다 — 원본 행이 (권한 회수와 트리거를 우회한 무엇으로든)
    // 바뀌면 그 사실이 여기서 드러난다. 전체를 잇는 체인은 만들지 않는다.
    correctedEventHash: input.correctedEventHash,
    reason: input.reason,
    replacementFields: input.replacementFields,
  };
}

/** `event_hash` 계산 — 0006 이래 같은 공식이다. */
export function executionEventHash(input: {
  situationId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}): string {
  return sha256Hex(canonicalJson(input));
}

// ---------------------------------------------------------------------------
// 전자상황판 투영
// ---------------------------------------------------------------------------

export interface FoldableEvent {
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
  correctsEventId: string | null;
}

/**
 * 유효 이벤트 목록.
 *
 * 정정된 원본은 **감추지 않는다** — 타임라인은 원본을 그대로 보여주고 "정정됨"
 * 표시를 단다(설계 09 REG-05). 그러나 집계는 유효값으로 접어야 하므로, 원본
 * 자리에 가장 나중에 기록된 정정의 payload를 끼워 넣은 목록을 따로 만든다.
 */
export function applyCorrections<T extends FoldableEvent>(
  events: readonly T[],
): Array<T & { correctedBy: string | null }> {
  // 호출부가 기록순으로 넘기므로 뒤에 나온 정정이 이긴다 — 두 번 정정하면
  // 나중 것이 유효본이다(0040 §1의 star 구조가 그것을 O(1)로 만든다).
  const latestCorrection = new Map<string, T>();
  for (const e of events) {
    if (e.correctsEventId) latestCorrection.set(e.correctsEventId, e);
  }
  return events
    .filter((e) => !e.correctsEventId)
    .map((e) => {
      const correction = latestCorrection.get(e.eventId);
      if (!correction) return { ...e, correctedBy: null };
      return { ...e, payload: correction.payload, correctedBy: correction.eventId };
    });
}

/**
 * 임무 상태를 **이벤트에서** 복원한다.
 *
 * 각 임무 애그리거트의 `occurredAt <= at`인 마지막 이벤트가 들고 있는 `status`가
 * 그 시점의 상태다(CC-280이 payload에 굳혀 두었다). 상태기계를 다시 돌리지
 * 않는다 — 두 번 계산하면 두 답이 갈라진다.
 */
export function foldTaskStates(
  events: readonly FoldableEvent[],
  at: Date,
): Map<string, TaskProjection> {
  const byTask = new Map<string, TaskProjection>();
  for (const e of events) {
    if (e.aggregateType !== 'TASK') continue;
    // **정정 이벤트는 새 관측이 아니다.** 걸러내지 않으면 그것이 그 임무의
    // 마지막 이벤트가 되고, 정정한 시각(`occurred_at = now()`)과 원본에서
    // 딸려 온 `status`가 이겨 **완료된 임무가 진행으로 되돌아간다**(실측).
    // 정정본을 반영하려면 `applyCorrections`를 먼저 통과시킨다 — 그것은
    // 원본의 시각을 유지한 채 payload만 갈아끼운다.
    if (e.correctsEventId) continue;
    if (e.occurredAt.getTime() > at.getTime()) continue;
    const status = e.payload.status;
    if (typeof status !== 'string') continue;
    const prev = byTask.get(e.aggregateId);
    // 같은 밀리초면 목록 순서(기록순)가 순서를 정한다 — 저장소가
    // `(occurred_at, recorded_at, event_id)` 전순서로 넘긴다.
    if (!prev || e.occurredAt.getTime() >= prev.occurredAt.getTime()) {
      byTask.set(e.aggregateId, {
        status,
        occurredAt: e.occurredAt,
        // **KPI에서 이벤트로 내려가는 길**(설계 06 §drill-down). 이것이 없으면
        // "미수신 3건"에서 그 셋의 근거로 갈 방법이 없다.
        statusEventId: e.eventId,
        progressPct: readProgress(e.payload) ?? prev?.progressPct ?? null,
      });
    } else if (prev.progressPct === null) {
      prev.progressPct = readProgress(e.payload) ?? null;
    }
  }
  return byTask;
}

export interface TaskProjection {
  status: string;
  occurredAt: Date;
  /** 이 상태를 만든 이벤트. KPI → 이벤트 drill-down의 시작점. */
  statusEventId: string;
  /**
   * 그 시점의 진행률.
   *
   * 임무 행의 현재 값이 아니다 — `TASK_PROGRESS_REPORTED` payload가 그것을
   * 들고 있으므로 재생할 수 있고, 재생하지 않으면 과거 판이 오늘의 진행률을
   * 보여 준다.
   */
  progressPct: number | null;
}

function readProgress(payload: Record<string, unknown>): number | null {
  const v = payload.progressPct;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * KPI (설계 09 SCR-BOARD-001 REG-01: 전체/진행/완료/지연/실패/미수신).
 *
 * `overdue`만 이벤트로 답할 수 없다 — 기한은 임무 행에 있고 그 변경이 이벤트로
 * 남지 않는다. 호출부가 기한을 함께 넘기고, 그것이 **현재** 기한이라는 사실을
 * 응답이 밝힌다(ADR-43 수용 한계).
 */
export interface DashboardKpi {
  total: number;
  /** 아직 전파되지 않음. */
  notDispatched: number;
  /** 전파됐으나 수신확인 없음 — 설계의 "미수신". */
  awaitingAck: number;
  /** 수신확인~검토대기. */
  inProgress: number;
  completed: number;
  /** 수행불가로 보고됨 — 설계의 "실패". */
  unable: number;
  cancelled: number;
  /** 기한을 넘겼고 아직 끝나지 않음. */
  overdue: number;
}

const IN_PROGRESS_STATES = new Set(['ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETION_SUBMITTED']);

export function computeKpi(
  tasks: ReadonlyArray<{ taskId: string; dueAt: Date | null }>,
  states: ReadonlyMap<string, { status: string }>,
  at: Date,
): DashboardKpi {
  // **뺄셈 잔여값으로 세지 않는다.** 이벤트가 말하지 않은 임무를 `total`에서
  // 빼는 방식이면 체계적 이벤트 결손(D3이 찾은 바로 그 종류)이 경고가 아니라
  // 그냥 작아진 숫자로 나타난다. 센 것만 세고, 세지 못한 것은 호출부가
  // `provenance`에 실어 화면에 드러낸다.
  const kpi: DashboardKpi = {
    total: tasks.filter((t) => states.has(t.taskId)).length,
    notDispatched: 0,
    awaitingAck: 0,
    inProgress: 0,
    completed: 0,
    unable: 0,
    cancelled: 0,
    overdue: 0,
  };
  for (const task of tasks) {
    // 목록에 있는데 이벤트가 말하지 않았다는 것은 `at` 이전에 만들어지지
    // 않았거나 이벤트가 빠졌다는 뜻이다. 둘 다 세지 않는다.
    const status = states.get(task.taskId)?.status;
    if (!status) continue;
    switch (status) {
      case 'CREATED':
        kpi.notDispatched += 1;
        break;
      case 'SENT':
        kpi.awaitingAck += 1;
        break;
      case 'COMPLETED':
        kpi.completed += 1;
        break;
      case 'UNABLE_REPORTED':
        kpi.unable += 1;
        break;
      case 'CANCELLED':
        kpi.cancelled += 1;
        break;
      default:
        if (IN_PROGRESS_STATES.has(status)) kpi.inProgress += 1;
        break;
    }
    const settled = status === 'COMPLETED' || status === 'CANCELLED';
    if (!settled && task.dueAt && task.dueAt.getTime() < at.getTime()) kpi.overdue += 1;
  }
  return kpi;
}

/**
 * 화면이 "지금 살아 있는 판인가"를 판단하는 기준 (설계 09 C표 STALE).
 *
 * 마지막 이벤트가 오래됐다는 것은 조용한 것일 수도, 갱신이 끊긴 것일 수도
 * 있다. 화면이 둘을 구분하지 못하면 끊긴 화면을 믿는다.
 */
/**
 * 재생 결과와 임무 행이 갈라지는가.
 *
 * **D1의 전제를 매 조회가 측정한다.** "이벤트가 정본"이면 빠진 이벤트는
 * "그 일이 없었다"로 조용히 읽히고, 대조하지 않는 한 아무도 모른다 — 결손이
 * 비가역이라는 논거가 결손 감지 없이는 스스로를 지탱하지 못한다.
 *
 * 지금 시점 조회에서만 뜻이 있다(과거 판은 당연히 다르다).
 */
export function findDivergences(
  tasks: ReadonlyArray<{ taskId: string; currentStatus: string }>,
  states: ReadonlyMap<string, { status: string }>,
): Array<{ taskId: string; replayed: string | null; stored: string }> {
  const out: Array<{ taskId: string; replayed: string | null; stored: string }> = [];
  for (const task of tasks) {
    const replayed = states.get(task.taskId)?.status ?? null;
    if (replayed !== task.currentStatus) {
      out.push({ taskId: task.taskId, replayed, stored: task.currentStatus });
    }
  }
  return out;
}

export const DASHBOARD_STALE_AFTER_MS = 120_000;

export function isDashboardStale(lastEventAt: Date | null, now: Date): boolean {
  if (!lastEventAt) return false;
  return now.getTime() - lastEventAt.getTime() > DASHBOARD_STALE_AFTER_MS;
}
