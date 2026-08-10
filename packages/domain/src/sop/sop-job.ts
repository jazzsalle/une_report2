import { SITUATION_STATUSES, type SituationStatus } from '../situation/situation-status';

/**
 * SOP 생성 잡 요청 (UNE-SOP-001, CC-240).
 *
 * `generation_job.request_json`에 그대로 들어가고 워커가 다시 읽는다. API와
 * 워커가 서로 다른 프로세스이므로, 형태를 도메인 한곳에서만 정의한다
 * (`parseTocJobRequest`와 같은 규약).
 */

/** 계약 `SopGenerationRequest.schemaVersion` enum. 지금은 하나뿐이다. */
export const SOP_GRAPH_SCHEMA_VERSIONS = ['1.0'] as const;
export type SopGraphSchemaVersion = (typeof SOP_GRAPH_SCHEMA_VERSIONS)[number];

export interface SopJobRequest {
  /** 확정 SituationSnapshot. SOP는 확정 사실 위에서만 만들어진다. */
  snapshotId: string;
  /** 동결 EvidenceSet. 근거가 움직이면 같은 SOP가 재현되지 않는다. */
  evidenceSetId: string;
  /**
   * 클라이언트가 요청한 **그래프 스키마** 버전(계약값 '1.0').
   *
   * `UNI_SOP_MAPPER_VERSION`(`uni-sop-1`)과 다른 것이다 — 이쪽은 "어떤 모양의
   * 그래프를 원하는가"이고, 저쪽은 "UNI 응답을 어느 규칙으로 옮겼는가"다.
   * 둘을 한 값으로 합치면, 우리가 매퍼를 고쳤을 때 클라이언트 계약이 깨진 것처럼
   * 보인다. `sop_version.schema_version`에는 **매퍼 버전**이 들어간다.
   */
  graphSchemaVersion: SopGraphSchemaVersion;
  requestedBy: string;
}

export function isSopGraphSchemaVersion(v: unknown): v is SopGraphSchemaVersion {
  return (SOP_GRAPH_SCHEMA_VERSIONS as readonly unknown[]).includes(v);
}

export function buildSopJobRequest(input: SopJobRequest): Record<string, unknown> {
  return {
    snapshotId: input.snapshotId,
    evidenceSetId: input.evidenceSetId,
    graphSchemaVersion: input.graphSchemaVersion,
    requestedBy: input.requestedBy,
  };
}

/**
 * 워커가 `request_json`을 다시 읽는다.
 *
 * **모르면 거부한다.** 여기는 스트리밍이 아니라 잡 시작 전이고, 잘못된 요청으로
 * provider를 부르면 그 호출이 낭비이자 오염이다(§1.11의 경고 규칙은 이미 받은
 * 노드를 지키기 위한 것이지 입력 검증을 느슨하게 하라는 뜻이 아니다).
 */
export function parseSopJobRequest(raw: unknown): SopJobRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('request_json이 객체가 아닙니다.');
  }
  const rec = raw as Record<string, unknown>;
  const snapshotId = rec.snapshotId;
  const evidenceSetId = rec.evidenceSetId;
  const graphSchemaVersion = rec.graphSchemaVersion;
  const requestedBy = rec.requestedBy;
  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    throw new Error('request_json.snapshotId가 없습니다.');
  }
  if (typeof evidenceSetId !== 'string' || evidenceSetId.length === 0) {
    throw new Error('request_json.evidenceSetId가 없습니다.');
  }
  if (!isSopGraphSchemaVersion(graphSchemaVersion)) {
    throw new Error('request_json.graphSchemaVersion을 지원하지 않습니다.');
  }
  if (typeof requestedBy !== 'string' || requestedBy.length === 0) {
    throw new Error('request_json.requestedBy가 없습니다.');
  }
  return { snapshotId, evidenceSetId, graphSchemaVersion, requestedBy };
}

/**
 * SOP 생성을 시작할 수 있는 상황 상태.
 *
 * 사실이 확정된 뒤여야 한다(`CONTEXT_CONFIRMED`). 이미 SOP가 있어도
 * (`SOP_READY`) 다시 만들 수 있다 — 근거가 늘면 다른 절차가 나온다.
 * **종결된 상황은 안 된다**: 끝난 상황에 새 절차를 만드는 것은 기록을 흐린다
 * (CC-230의 닫힌 상황 가드와 같은 규칙).
 */
const SOP_STARTABLE: ReadonlySet<string> = new Set<SituationStatus>([
  'CONTEXT_CONFIRMED',
  'SOP_READY',
  'RUNNING',
  'PAUSED',
]);

export function canStartSopJob(status: string): boolean {
  return SOP_STARTABLE.has(status);
}

/** 위 집합이 실제 어휘의 부분집합인지 — 오타가 조용한 거부가 되지 않게 한다. */
export const SOP_STARTABLE_STATUSES: readonly SituationStatus[] = SITUATION_STATUSES.filter((s) =>
  SOP_STARTABLE.has(s),
);
