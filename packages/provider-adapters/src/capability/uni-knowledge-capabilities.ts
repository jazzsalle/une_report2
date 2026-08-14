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
 * **CC-410(2026-08-14)에서 셋이 승격됐다.** 실 UNI(`http://221.147.100.161:8000`)에
 * 대고 업로드·검색·SOP 생성이 성공했고 응답을 픽스처로 고정했다. OB-13의 두
 * 미지수(multipart 파일 필드명 `file`, 로그인 토큰 필드명 `token`)도 실측으로
 * 닫혔다. `PROVIDER_DEV_VERIFIED`를 쓴다 — `T3Q_DEV_VERIFIED`를 쓰면 레지스트리가
 * "T3Q가 검증했다"고 말하게 된다.
 *
 * **`knowledgeStatus`는 승격하지 못했다.** 어댑터가 부르는
 * `GET /documents/{doc_id}`가 **라이브 UNI에 존재하지 않고**(목록 `GET /documents/`와
 * `GET /documents/{doc_id}/reference`만 있다) 상태 어휘도 설계와 다르다
 * (설계: QUEUED/PARSING/… ↔ 실측: "참고자료 생성 중"/"완료" + progress 0~100).
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
    state: 'PROVIDER_DEV_VERIFIED',
    adapterImplemented: true,
    mockAvailable: true,
    openBinding: null,
    providerEvidence: 'docs/evidence/CC-410-uni-contract-binding.md',
    notes:
      '지식문서 업로드. **2026-08-14 실 UNI에서 200 확인** — multipart 파일 필드명은 ' +
      '`file`, `uploader`/`force`는 쿼리 파라미터, 응답은 설계 08 §1.9 그대로 ' +
      '{message, filename, doc_id}. **`uploader`는 보내지 않는다** — 보내면 UNI가 그 ' +
      '문자열을 소유자로 기록해 UNE 계정으로 영원히 삭제할 수 없게 된다(403 실측).',
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
      '**승격 불가 — 이 엔드포인트는 라이브 UNI에 없다(CC-410 실측).** 어댑터는 ' +
      'GET /documents/{doc_id}를 부르는데 라이브 스펙에 그 경로가 없다(DELETE만 있다). ' +
      '상태는 목록 GET /documents/ 의 항목에서 오고, 어휘도 다르다 — 설계 08 §1.9의 ' +
      'QUEUED/PARSING/INDEXING/REFERENCE_GENERATING/READY/ERROR가 아니라 한국어 표시 ' +
      '문자열("참고자료 생성 중"/"완료")과 progress(0~100)다. 가드가 모르는 값을 ' +
      '거부하므로 지금 실 UNI에 붙이면 상태 조회가 전부 실패한다. CC-410 잔여 작업.',
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
    state: 'PROVIDER_DEV_VERIFIED',
    adapterImplemented: true,
    mockAvailable: true,
    openBinding: null,
    providerEvidence: 'docs/evidence/CC-410-uni-contract-binding.md',
    notes:
      '근거 검색(CC-230). **2026-08-14 실 UNI에서 200 확인** — 요청 {query, top_k}, ' +
      '응답 {results:[{filename, score, text, doc_id}]}, score는 0..1 척도. ' +
      '**chunk id는 없고**(기본 필드명을 빈 문자열로 두어 찾지 않는다) 설계 09 ' +
      'REG-02/03의 page/section도 없다. **doc_ids 범위 지정 필드가 아예 없다** — ' +
      '문서 범위를 좁혀 검색할 수 없다(OB-13에 요청으로 남는다).',
  },
  {
    featureId: 'sopGeneration',
    endpoint: 'POST /chat/json',
    state: 'PROVIDER_DEV_VERIFIED',
    adapterImplemented: true,
    mockAvailable: true,
    // OB-13(필드명)이 아니라 **OB-04**다 — 여기서 막고 있는 것은 응답
    // 필드명이 아니라 SSE **프레이밍 자체**이고, 그것이 틀리면 어댑터가
    // 한 줄도 읽지 못한다.
    openBinding: null,
    providerEvidence: 'docs/evidence/CC-410-uni-contract-binding.md',
    notes:
      'UNI 구조화 SOP 생성(CC-240 → CC-410). **2026-08-14 실 UNI 3표본 확인.** ' +
      'SSE 프레이밍 가정이 맞았다(data: 한 줄에 JSON 객체 하나, 키가 이벤트 이름, ' +
      '[DONE] 리터럴, event: 없음). 그러나 **compn 필드명은 설계 08 §1.11과 전혀 ' +
      '달랐고**(type/name/task/branch/source → compnTyCode/compnSj/' +
      'compnAttrbSaveParamsList/endCompns) uni-sop-1은 실 응답을 한 노드도 매핑하지 ' +
      '못했다 — uni-sop-2가 실측 어휘로 옮긴다. **재접속은 불가능하다**: id:/retry:/' +
      '하트비트가 0줄이라 Last-Event-ID로 이어받을 수단이 없다(ADR-50 수용 한계).',
  },
];

export function getUniKnowledgeCapability(featureId: string): UniFeatureCapability | undefined {
  return UNI_KNOWLEDGE_FEATURE_CAPABILITIES.find((c) => c.featureId === featureId);
}
