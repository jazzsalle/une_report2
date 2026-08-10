import type { CapabilityState } from './plan-feature-capabilities';

/**
 * UNI 지식문서 기능 capability 레지스트리 (CC-220).
 *
 * `plan-feature-capabilities.ts`와 같은 규약이다 — **UNE가 실제로 무엇을
 * 검증했는지에 대한 소스 관리된 진술**이지 런타임 토글이 아니다. mock 지원을
 * 실 UNI 지원으로 보고하지 않는다(CLAUDE.md, `.claude/rules/provider-adapters.md`).
 *
 * 상태 어휘는 T3Q용으로 만들어졌지만 뜻은 provider 중립이다:
 *   MOCK_ONLY           mock만 있다
 *   UNE_ADAPTER_READY   실 어댑터 코드가 있으나 provider 미검증
 *   *_DEV/PROD_VERIFIED 실제 provider에 대고 성공했다
 *
 * UNI는 전부 `UNE_ADAPTER_READY`다. HTTP 어댑터는 있지만 **한 번도 실제 UNI에
 * 대고 성공한 적이 없고**, multipart 파일 필드명과 로그인 토큰 필드명이
 * OB-13으로 열려 있어 지금 호출하면 실패한다. 그 두 값이 오기 전까지는
 * 승격이 불가능하다.
 */

export interface UniFeatureCapability {
  featureId: string;
  /** 설계 08의 UNI 엔드포인트. */
  endpoint: string;
  state: CapabilityState;
  adapterImplemented: boolean;
  mockAvailable: boolean;
  /** 승격을 막는 OPEN_BINDINGS id. */
  openBinding: 'OB-04' | 'OB-13' | null;
  providerEvidence: string | null;
  notes: string;
}

export const UNI_KNOWLEDGE_FEATURE_CAPABILITIES: readonly UniFeatureCapability[] = [
  {
    featureId: 'knowledgeUpload',
    endpoint: 'POST /documents/upload',
    state: 'UNE_ADAPTER_READY',
    adapterImplemented: true,
    mockAvailable: true,
    openBinding: 'OB-13',
    providerEvidence: null,
    notes:
      '지식문서 업로드. HttpUniKnowledgeAdapter 구현 + 워커 결선. ' +
      '경로·질의 파라미터·응답 모양은 설계 08 §1.9가 기준선이지만 ' +
      '**multipart 파일 필드명이 미확인**이라 실 호출은 아직 성공할 수 없다(OB-13). ' +
      'mock: MockUniKnowledgeAdapter — UNI 지원이 아니다.',
  },
  {
    featureId: 'knowledgeStatus',
    endpoint: 'GET /documents/{id}',
    state: 'UNE_ADAPTER_READY',
    adapterImplemented: true,
    mockAvailable: true,
    openBinding: 'OB-13',
    providerEvidence: null,
    notes:
      'UNI 처리상태 조회. 상태 어휘는 설계 08 §1.9(QUEUED/PARSING/INDEXING/' +
      'REFERENCE_GENERATING/READY/ERROR)를 가드가 강제하며 모르는 값은 거부한다. ' +
      '응답 필드명은 설정으로 바꿀 수 있다(OB-13).',
  },
  {
    featureId: 'knowledgeReference',
    endpoint: 'GET /documents/{id}/reference',
    state: 'UNE_ADAPTER_READY',
    adapterImplemented: true,
    mockAvailable: true,
    openBinding: 'OB-13',
    providerEvidence: null,
    notes:
      '참조요약 조회. 200 READY / 202 PROCESSING 구분은 설계 08 §1.9가 적었고 ' +
      '준비 여부의 근거는 본문이 아니라 상태코드다. 본문 스키마는 미확인(OB-13).',
  },
  {
    featureId: 'knowledgeSearch',
    endpoint: 'POST /search/',
    state: 'UNE_ADAPTER_READY',
    adapterImplemented: true,
    mockAvailable: true,
    openBinding: 'OB-13',
    providerEvidence: null,
    notes:
      '근거 검색(CC-230). 감싸는 배열 필드명·chunk id 필드명·score 척도·doc_ids ' +
      '범위 지정 지원 여부가 **전부 미확인**이다(CR-UNI-008). 설계 06 US-SIT-011 ' +
      '3단계의 filename/score/text/doc_id만 기준선으로 쓴다. mock이 검증하는 것은 ' +
      'UNE 쪽 상태기계뿐이다.',
  },
];

export function getUniKnowledgeCapability(featureId: string): UniFeatureCapability | undefined {
  return UNI_KNOWLEDGE_FEATURE_CAPABILITIES.find((c) => c.featureId === featureId);
}
