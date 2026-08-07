/**
 * SituationProviderPort (CC-200, ADR-33).
 *
 * 이름은 **ADR v1.1 §4.4**와 `docs/handoff/OPEN_BINDINGS.md` OB-02가 쓰는
 * 그대로다. 도메인 서비스는 이 포트에만 의존하고 Provider별 DTO는 이 패키지
 * 밖으로 나가지 않는다(.claude/rules/architecture.md).
 *
 * ── ADR §4.4 형태와 이 파일의 차이, 그리고 그 이유 (ADR-33 D4) ──────────────
 * ADR의 `SituationFactCandidate`는 severity·location·freshness·reliability·
 * expiresAt을 들고 있는데, `situation_fact`에는 그 컬럼이 없다(0004/0023).
 * 여기서 두 가지를 하지 않는다.
 *
 *   - 컬럼을 지어내지 않는다. freshness/TTL은 WBS의 별도 항목
 *     (WP-SITUATION-09)이고 CC-200 인수기준에 없다.
 *   - 그 값들을 버리지도 않는다. 어댑터는 응답 **원문 전체**를 `rawPayload`로
 *     함께 돌려주고 API가 `provider_result.raw_payload_json`에 보존한다.
 *     설계 06 US-SIT-006의 "원천 provenance 손실 0건"은 그렇게 지켜진다 —
 *     색인되지 않을 뿐 사라지지 않는다.
 *
 * 그래서 이 포트는 **정규화 전 중립 항목**을 돌려준다. 정규화는 도메인
 * (`@une/domain`의 `normalizeFacts`)이 하고 어댑터는 하지 않는다 — 같은
 * 정규화 규칙이 수동 입력(UNE-SIT-007)에도 걸려야 하기 때문이다.
 */

import type { ProviderCode, RawFactItem } from '@une/domain';

/** 수집 요청. ADR §4.4의 `CollectSituationQuery`를 저장 가능한 형태로 옮겼다. */
export interface CollectSituationQuery {
  /** ADR의 incidentId. 이 저장소의 애그리거트 이름은 situation이다. */
  situationId: string;
  /** ADR의 disasterType. 재난유형 10종의 정본은 plan-context.schema.json이다. */
  hazardType: string;
  location: {
    adminCode: string | null;
    text: string | null;
  };
  timeWindow: {
    from: string | null;
    to: string | null;
    /** 기준시각. 없으면 호출부가 요청 시각으로 채운다. */
    asOf: string;
  };
  /** ADR의 categories[]. 설계 01 §20.5의 Fact 범주다. 빈 배열은 "제한 없음". */
  categories: readonly string[];
  requestReason: string | null;
  requestedBy: string;
  correlationId: string;
  /** 계약 `ProviderQueryRequest.query`가 그대로 내려온 것(설계 10 SIT-005의
   * "핵심 요청: providers,query,featureFlags"). Provider마다 해석이 다르므로
   * 도메인은 들여다보지 않고 전달만 한다. */
  providerQuery: Readonly<Record<string, unknown>>;
}

/** 실패 갈래.
 *
 * 설계 06 US-SIT-004의 오류표(E-01 Timeout, E-02 파서 변경, E-03 비활성)와
 * ADR §4.5 G11-4(Timeout, 인증, 데이터 없음, 부분결과, 서버오류)가 근거다.
 * `retriable`을 갈래마다 고정하는 이유도 G11-4의 "재시도 여부 명확"이다. */
export const PROVIDER_FAILURE_KINDS = [
  'TIMEOUT',
  'UNAUTHORIZED',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'PARSER_CHANGED',
  'NO_DATA',
  /** 기능 플래그가 꺼져 있다(OB-05 SafeKorea/Naver). */
  'DISABLED',
  /** 계약 자체가 없다(OB-02 T3Q 상황 API). 플래그를 켜도 부를 곳이 없다. */
  'NOT_CONTRACTED',
] as const;

export type ProviderFailureKind = (typeof PROVIDER_FAILURE_KINDS)[number];

const RETRIABLE: ReadonlySet<ProviderFailureKind> = new Set<ProviderFailureKind>([
  'TIMEOUT',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
]);

export function isRetriableFailure(kind: ProviderFailureKind): boolean {
  return RETRIABLE.has(kind);
}

export interface ProviderCollectSuccess {
  ok: true;
  providerCode: ProviderCode;
  /** `fact_source.source_name` — 기관이 어떤 출처를 봤는지. */
  sourceName: string;
  /** `fact_source.source_uri`. */
  sourceUri: string | null;
  /** `fact_source.retrieved_at` (ISO-8601, 명시적 오프셋). */
  retrievedAt: string;
  /** 정규화 전 중립 항목. */
  items: readonly RawFactItem[];
  /** `provider_result.raw_payload_json` — 어댑터가 받은 그대로. */
  rawPayload: unknown;
  /** `provider_result.item_count` — 원문이 담고 있던 항목 수(정규화 전). */
  itemCount: number;
  /** ADR §4.6 "SituationFact에는 원문 hash와 parserVersion을 기록한다". */
  parserVersion: string;
  /** Provider 왕복 소요(ms). provider-adapters.md의 "provider timing". */
  elapsedMs: number;
}

export interface ProviderCollectFailure {
  ok: false;
  providerCode: ProviderCode;
  kind: ProviderFailureKind;
  message: string;
  retriable: boolean;
  /** 실패해도 원문이 있으면 남긴다(파서 변경 진단이 이것으로 이뤄진다). */
  rawPayload?: unknown;
  elapsedMs: number;
}

export type ProviderCollectResult = ProviderCollectSuccess | ProviderCollectFailure;

/** 운영 상태(ADR §4.4 `ProviderHealth`). CC-200은 조회 시점 선언값만 쓴다 —
 * 마지막 성공시각·Circuit 상태를 저장하는 관리화면은 UNE-ADMIN-010 몫이다. */
export interface ProviderHealth {
  providerCode: ProviderCode;
  /** 지금 호출하면 시도라도 되는가. */
  available: boolean;
  reason: ProviderFailureKind | null;
  /** 이 어댑터가 실제 Provider를 부르는가, 목업인가.
   * 목업 지원을 실 Provider 지원으로 보고하지 않는다(CLAUDE.md). */
  mode: 'MOCK' | 'LIVE';
  /** 승격을 막고 있는 OPEN_BINDINGS 항목. */
  openBinding: string | null;
}

export interface SituationProviderPort {
  readonly providerCode: ProviderCode;
  health(): ProviderHealth;
  collect(query: CollectSituationQuery): Promise<ProviderCollectResult>;
}

/** 실패를 만들 때 `retriable`이 갈래와 어긋나지 않도록 한 곳을 지난다. */
export function providerFailure(
  providerCode: ProviderCode,
  kind: ProviderFailureKind,
  message: string,
  extra: { rawPayload?: unknown; elapsedMs?: number } = {},
): ProviderCollectFailure {
  return {
    ok: false,
    providerCode,
    kind,
    message,
    retriable: isRetriableFailure(kind),
    ...(extra.rawPayload === undefined ? {} : { rawPayload: extra.rawPayload }),
    elapsedMs: extra.elapsedMs ?? 0,
  };
}
