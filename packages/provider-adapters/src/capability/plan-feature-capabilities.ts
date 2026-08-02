/**
 * T3Q plan-generation feature capability registry (CC-115, ADR-24).
 *
 * Source-controlled statement of what UNE has actually verified per feature —
 * NOT a runtime toggle (runtime enable/disable lives in
 * provider_config.feature_flags_json and is owned by CC-125+). The four
 * states are fixed by .claude/rules/provider-adapters.md; mock support must
 * never be reported as actual T3Q support (CLAUDE.md, design 13 §11).
 *
 * State changes follow the governed procedure (ADR-24): add evidence under
 * docs/evidence/ → update OPEN_BINDINGS if a binding closes → edit this
 * registry → dual review. tests/contract/src/capability-governance.test.ts
 * enforces the invariants.
 */

export const CAPABILITY_STATES = [
  'MOCK_ONLY',
  'UNE_ADAPTER_READY',
  'T3Q_DEV_VERIFIED',
  'T3Q_PROD_VERIFIED',
] as const;

export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export interface PlanFeatureCapability {
  /** v2 ids mirror ProviderCapabilities.features keys in the target-v2
   * contract (drift-checked); legacy ids are UNE-local. */
  featureId: string;
  /** RPT-00x (legacy, live spec v0.8.5) or CR-T3Q-00x (requested, unaccepted). */
  requestId: string;
  state: CapabilityState;
  /** True only when the UNE adapter for this feature exists in this repo. */
  adapterImplemented: boolean;
  /** True only when an in-process contract mock exists (CC-125+). */
  mockAvailable: boolean;
  /** OPEN_BINDINGS.md id gating any promotion past MOCK_ONLY, if any. */
  openBinding: 'OB-01' | 'OB-03' | 'OB-10' | 'OB-11' | null;
  /** docs/evidence/*.md path required for T3Q_*_VERIFIED states. */
  providerEvidence: string | null;
  notes: string;
}

export const T3Q_PLAN_FEATURE_CAPABILITIES: readonly PlanFeatureCapability[] = [
  // ── Legacy v0.8.5 (live spec exists, but UNE has neither adapter nor any
  //    provider-verified call; auth/TLS/timeout/error schema are OB-01) ──
  {
    featureId: 'legacyToc',
    requestId: 'RPT-001',
    state: 'UNE_ADAPTER_READY',
    adapterImplemented: true,
    mockAvailable: true,
    openBinding: 'OB-01',
    providerEvidence: null,
    notes:
      '목차 생성. CC-125: 실 HTTP LegacyT3qPlanAdapter 구현 + 워커 런타임 결선 ' +
      '(UNE_T3Q_PLAN_ADAPTER=legacy-http). provider 미검증 — OB-01이 열려 있는 동안 ' +
      'T3Q_*_VERIFIED 승격 불가. mock: MockLegacyT3qPlanAdapter.',
  },
  {
    featureId: 'legacyContent',
    requestId: 'RPT-002',
    state: 'UNE_ADAPTER_READY',
    adapterImplemented: true,
    mockAvailable: true,
    openBinding: 'OB-01',
    providerEvidence: null,
    notes:
      '본문 생성. CC-130: CONTENT job 파이프라인 결선(ContentJobRunner + UNE-PLAN-016) — ' +
      'ADR-26 D7 3조건(구현 ∧ 런타임 결선 ∧ live spec) 충족. 운영 경로는 동기 JSON; SSE ' +
      '프레이밍은 UNE 가정(OB-01, UNE_T3Q_CONTENT_STREAM seam). provider 미검증 — OB-01이 ' +
      '열려 있는 동안 T3Q_*_VERIFIED 승격 불가.',
  },
  {
    featureId: 'legacyDaily',
    requestId: 'RPT-003',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-03',
    providerEvidence: null,
    notes: '일일상황일지 — 선택적 보강 전용(Execution Log가 정본, ADR 필요 시에만).',
  },
  // ── Target-v2 (requested contract 1.0.1-request; NOT T3Q-accepted) ──
  {
    featureId: 'tocV2',
    requestId: 'CR-T3Q-001',
    state: 'MOCK_ONLY',
    adapterImplemented: true,
    mockAvailable: true,
    openBinding: 'OB-10',
    providerEvidence: null,
    notes:
      '안정 sectionId·semanticRole 포함 목차 v2. CC-125: TargetV2T3qPlanAdapter + ' +
      'in-process mock(202→폴링→COMPLETED). 대상 계약 자체가 미수락(OB-10)이라 ' +
      'MOCK_ONLY 고정 — CR-T3Q-* 불변식.',
  },
  {
    featureId: 'contentV2',
    requestId: 'CR-T3Q-002',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-10',
    providerEvidence: null,
    notes: '블록·인용 포함 본문 v2, 보호 블록 준수.',
  },
  {
    featureId: 'jobStatus',
    requestId: 'CR-T3Q-003',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-10',
    providerEvidence: null,
    notes:
      '생성 Job 상태 조회. CC-125의 mock 전송기가 내부 폴링용 GenerationStatus를 ' +
      '제공하지만 포트 op(jobStatus)로는 미노출 — 독립 mock은 CC-135.',
  },
  {
    featureId: 'jobSse',
    requestId: 'CR-T3Q-003',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-10',
    providerEvidence: null,
    notes: 'Job 이벤트 SSE(Last-Event-ID 재개).',
  },
  {
    featureId: 'jobCancel',
    requestId: 'CR-T3Q-003',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-10',
    providerEvidence: null,
    notes: 'Job 취소.',
  },
  {
    featureId: 'partialRetry',
    requestId: 'CR-T3Q-003',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-10',
    providerEvidence: null,
    notes: '실패 섹션/블록 단위 재시도.',
  },
  {
    featureId: 'semanticEdit',
    requestId: 'CR-T3Q-004',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-10',
    providerEvidence: null,
    notes: '의미 편집 제안(ChangeProposal).',
  },
  {
    featureId: 'evidenceSearch',
    requestId: 'CR-T3Q-005',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-11',
    providerEvidence: null,
    notes: '근거 검색(Citation) — SHOULD.',
  },
  {
    featureId: 'validation',
    requestId: 'CR-T3Q-006',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-11',
    providerEvidence: null,
    notes: '의미 검증 — SHOULD.',
  },
  {
    featureId: 'referenceUpload',
    requestId: 'CR-T3Q-007',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: null,
    providerEvidence: null,
    notes: 'CONDITIONAL — T3Q 공통 참조문서 등록 API 부재 시에만 요청 유효.',
  },
  {
    featureId: 'capabilityDiscovery',
    requestId: 'CR-T3Q-009',
    state: 'MOCK_ONLY',
    adapterImplemented: false,
    mockAvailable: false,
    openBinding: 'OB-10',
    providerEvidence: null,
    notes: 'GET /v2/capabilities 런타임 협상.',
  },
] as const;

export function getPlanFeatureCapability(featureId: string): PlanFeatureCapability | undefined {
  return T3Q_PLAN_FEATURE_CAPABILITIES.find((entry) => entry.featureId === featureId);
}

/**
 * Human-readable capability line for UI/logs/test reports (AT-T3Q-012).
 * Always renders the qualifying flags with the state so `MOCK_ONLY` with no
 * mock yet cannot read as "mock is ready" (CC-115 review N6; the helper was
 * lost to a test-restore in CC-115 and lands with CC-120) — consumers should
 * display this, not `state` alone.
 */
export function describeCapability(entry: PlanFeatureCapability): string {
  const qualifiers = [
    entry.mockAvailable ? 'mock 있음' : 'mock 미구현',
    entry.adapterImplemented ? '어댑터 구현됨' : '어댑터 미구현',
  ];
  if (entry.openBinding) qualifiers.push(`바인딩 ${entry.openBinding}`);
  return `${entry.featureId}: ${entry.state} (${qualifiers.join(', ')})`;
}
