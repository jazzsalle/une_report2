/** Situation (=Incident) status model.
 *
 * 정본은 **설계 06 §7.1 상태 흐름표**이고, 0023 §1의 `ck_situation_status`가
 * 같은 여덟 값을 DB에서 고정한다. 두 곳이 갈라지면 INSERT가 23514로 떨어지므로
 * 이 배열은 그 CHECK와 문자 그대로 같아야 한다.
 *
 * CC-200이 실제로 만드는 값은 DRAFT 하나이고 REGISTERED까지 전이시킨다
 * (설계 06 US-SIT-003 상태전이: DRAFT → REGISTERED). 나머지 여섯은 후속
 * Work Item이 쓴다 — 어휘를 여기 다 두는 이유는 0023 §1과 같다.
 */

export const SITUATION_STATUSES = [
  'DRAFT',
  'REGISTERED',
  'CONTEXT_CONFIRMED',
  'SOP_READY',
  'RUNNING',
  'PAUSED',
  'CLOSING',
  'CLOSED',
] as const;

export type SituationStatus = (typeof SITUATION_STATUSES)[number];

export const SITUATION_MODES = ['LIVE', 'EXERCISE'] as const;
export type SituationMode = (typeof SITUATION_MODES)[number];

export function isSituationStatus(value: unknown): value is SituationStatus {
  return typeof value === 'string' && (SITUATION_STATUSES as readonly string[]).includes(value);
}

export function isSituationMode(value: unknown): value is SituationMode {
  return typeof value === 'string' && (SITUATION_MODES as readonly string[]).includes(value);
}

/** 상황이 종결된 뒤에는 기본정보 수정도 Fact 수집도 열지 않는다. 설계 06 §7.1의
 * "CLOSED 후 정정은 CorrectionEvent와 새 보고 revision"이 그 뜻이다 — 종결
 * 상태를 제자리에서 고치는 경로는 설계에 없다. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(['CLOSING', 'CLOSED']);

export function isSituationClosed(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

/** Fact 수집·등록이 가능한 상태.
 *
 * DRAFT를 포함한다. 설계 06 US-SIT-004의 선행조건은 "기본정보 저장"이고
 * US-SIT-003 #3이 **등록 단계에서 이미** 최초상황을 USER_ASSERTED 후보로
 * 만들기 때문이다 — REGISTERED부터로 좁히면 그 시나리오가 막힌다.
 * 종결(CLOSING/CLOSED)만 제외한다. */
export function canCollectFacts(status: string): boolean {
  return isSituationStatus(status) && !isSituationClosed(status);
}

/** 기본정보 수정(UNE-SIT-004) 가능 여부. 수집과 같은 경계다. */
export function canEditSituation(status: string): boolean {
  return isSituationStatus(status) && !isSituationClosed(status);
}

/** 첫 후보 Fact가 생기는 순간 DRAFT는 REGISTERED가 된다(설계 06 US-SIT-003
 * 상태전이 DRAFT → REGISTERED, #4 "SituationContext revision을 증가시켜
 * 저장한다"). 이미 REGISTERED 이상이면 그대로 둔다 — 뒤로 돌리지 않는다. */
export function nextStatusOnFactRegistered(current: string): string {
  return current === 'DRAFT' ? 'REGISTERED' : current;
}

/** SituationContext 상태기계(설계 06 §7.1 두 번째 줄)는 **컬럼이 아니라 파생값**
 * 이다. 0023 §8이 컬럼을 만들지 않은 이유를 그대로 계산으로 옮긴다.
 *
 * PROVIDER_QUERYING은 여기서 나올 수 없다 — 동기 수집이라 요청 안에서 시작해
 * 끝나므로 어떤 조회 시점에도 관측되지 않는다(ADR-33 D2). 비동기로 옮기면
 * 그 값이 실재하게 되고 그때 이 함수의 입력이 늘어난다.
 *
 * CONFLICT_OPEN / USER_CONFIRMED의 입력(openConflictCount, currentSnapshotId)은
 * CC-210이 채운다. CC-200에서는 각각 0 / null로 들어오므로 도달하지 않는다. */
export interface SituationContextInputs {
  candidateFactCount: number;
  openConflictCount: number;
  currentSnapshotId: string | null;
}

export const SITUATION_CONTEXT_STATES = [
  'DRAFT',
  'PROVIDER_QUERYING',
  'CANDIDATE_REVIEW',
  'CONFLICT_OPEN',
  'USER_CONFIRMED',
] as const;

export type SituationContextState = (typeof SITUATION_CONTEXT_STATES)[number];

export function deriveContextState(inputs: SituationContextInputs): SituationContextState {
  if (inputs.currentSnapshotId !== null) return 'USER_CONFIRMED';
  if (inputs.openConflictCount > 0) return 'CONFLICT_OPEN';
  if (inputs.candidateFactCount > 0) return 'CANDIDATE_REVIEW';
  return 'DRAFT';
}
