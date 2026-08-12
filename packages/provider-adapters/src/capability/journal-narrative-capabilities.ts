import type { CapabilityState } from './plan-feature-capabilities';

/**
 * 상황일지 서술 제안 capability 레지스트리 (CC-300).
 *
 * `plan-feature-capabilities.ts`와 같은 규약이다 — **UNE가 실제로 무엇을
 * 검증했는지에 대한 소스 관리된 진술**이지 런타임 토글이 아니다.
 *
 * 여기에 적는 이유는 하나다: 어댑터가 `isSimulated`를 응답과 화면까지 정직하게
 * 올리더라도, **거버넌스 표에 없으면 승격 심사에서 누락된다**. "지금 무엇이
 * mock인가"를 한 곳에서 셀 수 없으면, 나중에 누군가 "일지 AI는 되던데요"라고
 * 말할 때 반박할 근거가 없다(이중검토 M-7).
 *
 * 바인딩은 **OB-03**이다 — 설계가 일지 서술에 T3Q RPT-003을 후보로 적었고
 * 소유권 판단이 열려 있다. OB-01(T3Q auth·TLS·SSE 프레이밍)이 아니다.
 */

export interface JournalNarrativeCapability {
  featureId: string;
  /** 설계가 이 기능에 붙여 둔 provider 연산(있다면). */
  requestId: string | null;
  state: CapabilityState;
  adapterImplemented: boolean;
  mockAvailable: boolean;
  openBinding: 'OB-03' | null;
  providerEvidence: string | null;
  notes: string;
}

export const JOURNAL_NARRATIVE_CAPABILITIES: readonly JournalNarrativeCapability[] = [
  {
    featureId: 'journalNarrativeProposal',
    requestId: 'RPT-003',
    state: 'MOCK_ONLY',
    // 실 provider 어댑터는 없다. 붙어 있는 것은 규칙 기반 시뮬레이션이다.
    adapterImplemented: false,
    mockAvailable: true,
    openBinding: 'OB-03',
    providerEvidence: null,
    notes:
      'UNE-JNL-007 서술 제안. T3Q의 두 계약(현행 v0.8.5, 요청한 target-v2) 어느 쪽에도 ' +
      '일지 서술 연산이 없다. 지금 붙은 것은 SimulationNarrativeAdapter(규칙 기반, ' +
      'LLM 없음)이며 isSimulated=true를 응답·화면까지 그대로 올린다. RPT-003 사용 여부와 ' +
      '소유권이 OB-03으로 열려 있어 승격 불가.',
  },
];
