import type { UniRawCompn } from './uni-sop-mapper';

/**
 * UNI SOP 생성 포트 (CC-240).
 *
 * 설계 08 §1.11(/chat/json SOP SSE Adapter), 설계 10 UNE-SOP-001~002.
 *
 * T3Q 계획 포트·UNI 지식문서 포트와 같은 규약이다 — 실패는 예외가 아니라
 * 결과값이고, 원문이 실패와 **함께** 이동한다.
 *
 * **설계 08 §1.8이 `/chat/json`을 "인증 없음 B2B, 외부노출 금지"로 적었다.**
 * UNE Backend Gateway에서만 부르고 React가 직접 부르지 않는다. 이 포트의
 * 구현체는 워커에서만 산다.
 */

export const UNI_SOP_ERROR_CODES = [
  'UNI_SOP_CONNECTION_ERROR',
  'UNI_SOP_TIMEOUT', // 설계 08 §1.14: 첫 이벤트 30초, 전체 5분
  'UNI_SOP_REQUEST_REJECTED',
  'UNI_SOP_PROVIDER_ERROR',
  'UNI_SOP_MALFORMED_STREAM', // 프레이밍이 깨졌다 — 부분 결과가 아니다
  'UNI_SOP_UNTERMINATED', // __done__ 없이 끊겼다
  'UNI_SOP_PROVIDER_REPORTED', // __error__ 이벤트를 받았다
  'MOCK_PROVIDER_ERROR',
] as const;

export type UniSopErrorCode = (typeof UNI_SOP_ERROR_CODES)[number];

export interface UniSopError {
  code: UniSopErrorCode;
  message: string;
  retryable: boolean;
  /**
   * 이미 화면에 그려진 노드가 있는가.
   *
   * 설계 08 §1.11이 `__error__`를 "Job 실패·**부분결과 폐기 또는 사용자
   * 선택**"이라고 적었다 — 폐기 여부가 사용자 결정이므로, 어댑터는 무엇을
   * 이미 받았는지 알려주기만 한다.
   */
  partialNodeCount: number;
}

/** 설계 08 §1.11의 이벤트 어휘. UNE가 만든 것이 아니라 UNI가 보내는 이름이다. */
export const UNI_SOP_STATUSES = ['searching', 'reranking', 'generating'] as const;
export type UniSopStatus = (typeof UNI_SOP_STATUSES)[number];

export type UniSopEvent =
  | { kind: 'status'; status: UniSopStatus }
  /** 사용자 기본화면에는 표시하지 않는다(설계 08 §1.11) — 진단 로그 전용. */
  | { kind: 'thinking'; text: string }
  | { kind: 'compn'; raw: UniRawCompn }
  | { kind: 'sources'; sources: { documentId: string; chunkId: string | null }[] }
  | { kind: 'done'; nodeCount: number | null };

export interface UniSopRequest {
  /** 확정 Snapshot 요약 + 목표 + 동결 근거. 호출부가 PII를 줄여 넘긴다. */
  prompt: string;
  /**
   * 생성 범위인 UNI 문서 id (동결 EvidenceSet에서 온다).
   *
   * 프롬프트 문장에만 적고 끝내지 않는다 — 문장은 provider가 지킬 수도, 무시할
   * 수도 있는 요청이고 범위 필드는 provider가 강제할 수 있는 조건이다. 둘 중
   * 어느 쪽을 UNI가 실제로 쓰는지는 OB-04로 열려 있으므로 **둘 다 준다.**
   */
  documentIds: string[];
  snapshotId: string;
  evidenceSetId: string;
  /** UniSopMapper 버전. 응답을 어느 규칙으로 옮길지 결과에 남는다. */
  schemaVersion: string;
}

export interface UniSopCallContext {
  correlationId: string;
}

export interface UniSopResultMeta {
  adapterId: string;
  mappingVersion: string;
  latencyMs: number;
  /** 받은 이벤트 수 — 스트림이 얼마나 진행됐는지의 유일한 증거다. */
  eventCount: number;
}

/**
 * 원문 보존.
 *
 * 스트림은 **받은 프레임 전부**를 남긴다. `__compn__` 하나가 잘못 매핑됐을 때
 * "UNI가 무엇을 보냈는가"에 답하려면 그 프레임이 있어야 하고, 매핑 결과만
 * 남기면 그 질문에 영원히 답할 수 없다(OB-04가 열려 있는 동안 특히 그렇다).
 */
export interface UniSopRawTrace {
  requestSummary: Record<string, unknown>;
  /** 수신 순서 그대로의 원문 프레임. */
  frames: unknown[];
}

export type UniSopResult =
  | { ok: true; events: UniSopEvent[]; meta: UniSopResultMeta; raw: UniSopRawTrace }
  | { ok: false; error: UniSopError; meta: UniSopResultMeta; raw: UniSopRawTrace };

export interface UniSopProvider {
  readonly adapterId: string;
  readonly mappingVersion: string;
  readonly isMock: boolean;

  /**
   * SOP를 생성한다.
   *
   * **스트림을 모아서 돌려준다.** 이벤트를 콜백으로 흘리지 않는 이유: 이
   * 포트의 호출자는 워커이고, 워커는 이벤트를 `job_event`에 적재한 뒤
   * SSE로 다시 내보낸다(UNE-SOP-002). 중간에 콜백을 두면 "적재 실패"와
   * "전송 실패"가 섞여 어느 쪽이 끊긴 것인지 알 수 없다.
   */
  generateSop(input: UniSopRequest, ctx: UniSopCallContext): Promise<UniSopResult>;
}

export function isRetryableUniSopError(code: UniSopErrorCode): boolean {
  return (
    code === 'UNI_SOP_CONNECTION_ERROR' ||
    code === 'UNI_SOP_TIMEOUT' ||
    code === 'UNI_SOP_PROVIDER_ERROR'
  );
}
