# ADR-24: CC-115 T3Q 계약 기준선 — example 게이트·capability 레지스트리·갭 매트릭스

- 상태: ACCEPTED (2026-08-02, CC-115)
- 관련: ADR-20(계약 게이트·타입 생성), 설계 13(T3Q 변경요청), OB-01/OB-10/
  OB-11, CLAUDE.md T3Q 조항, .claude/rules/provider-adapters.md

## 배경

CC-115는 T3Q legacy(RPT-001/002, v0.8.5 전사본)와 target-v2 변경요청 계약
(1.0.x-request)의 기준선을 세운다. 착수 탐색에서 target-v2 계약의 결함 2건이
ajv 재현으로 확인되었고(D1), CC-003이 이연한 example-level 계약 검증의 수령
시점이 도래했다(ADR-20 D6).

## D1. target-v2 계약 편집상 수정 → `1.0.1-request` (사용자 승인 2026-08-02)

- **결함 A**: `PlanRequestBase`가 `additionalProperties: false`인 채 5개 요청
  스키마가 `allOf`로 상속 — 2020-12 의미론상 base 분기가 자기 필드를 미지
  속성으로 거부한다. 실측(ajv): Content/SemanticEdit/EvidenceSearch/
  Validation 4종은 자체 required 필드 때문에 **구조적으로 충족 불가**,
  TocGenerationRequest는 자체 optional 필드(existingOutline/
  generationOption) 사용 시 무효. 수정: base 개방 + 각 합성 스키마에
  `unevaluatedProperties: false`(오탈자 필드는 계속 거부).
- **결함 B**: 유일한 예제(toc)가 required인 `clientContext`/`requestedAt`
  누락. 수정 + 주요 operation 예제 확충(요청 6·응답 4, 전부 스키마 통과).
- 예제 값 어휘 통일: 구 toc 예제의 `hazardType: INFECTIOUS_DISEASE`/
  `phase: PREPAREDNESS`는 승인된 어느 문서에도 없는 값이었다.
  `backgroundInfo`는 pass-through(open object)이고 실제 송신 어휘의 정본은
  UNE plan-context.schema.json이므로 예제를 PlanContext 실값(`disasterType:
  폭염`, `controlPhase: 대비`)으로 교체했다 — 스키마(필드) 수준 변경 아님.
- **필드 수준 요청 내용 변경 없음** — 발행된 v1.0 DOCX는 그대로 유효하며,
  provider-requests 문서에 각주로 고정.

## D2. example 게이트는 `validate-contracts.mjs` 확장 (vitest 중복 금지)

media-type example/examples ↔ 스키마 ajv(2020-12) 검증을 게이트 섹션 4로
추가한다. 커버리지 요구는 대상 계약의 **전 operation − 사유 명시 예외
목록**(이중 리뷰 M3 — 필수 id 허용목록은 비워지면 공허해진다), 성공(2xx)
응답만 크레딧(공용 4xx 오류 예제로 우회 불가). legacy 전사본은 SHA-256
핀으로 무변경을 강제한다(N1; 핀 갱신은 provider-truth 리뷰와 함께만).
대표 payload(계약 외부 산출물) 검증만 vitest(`@une/contract-tests`)가
맡는다. 구현 주의: components.schemas만 `$defs`로 포인터 재작성(문서 루트
addSchema 금지 — Parameter의 `required: true`가 메타스키마 위반, `$ref`
치환은 앵커 정규식), 응답 객체 자체가 `$ref`인 경우 전체 경로로 1-hop 해석
(components.responses/schemas에 동명 GenerationAccepted 존재). 생성 타입
배너의 계약 버전은 생성 시점에 info.version에서 읽는다(M2 — ADR-20의
"1.0.0-request" 고정 서술은 본 ADR이 대체).

## D3. legacy 계약에는 예제를 넣지 않는다

legacy YAML은 T3Q v0.8.5의 전사본이다. UNE 작성 payload를 넣으면 "T3Q 제공
샘플"로 오독될 위험("fields not present in approved contracts are OPEN, not
guessed"). 대표 픽스처는 `tests/contract/fixtures/t3q-legacy/`에 두고 출처를
README로 명시한다. SSE 프레이밍은 계약이 `x-sse-done`만 명시하므로 전사본
파일명에 `.assumed.`를 넣고 OB-01에 연결한다.

## D4. 계약 테스트의 집: 워크스페이스 `tests/contract` (@une/contract-tests)

CC-003이 이연한 "tests/ wiring"의 이행. 크로스 패키지 가드(no-UNI 스캔,
OPEN_BINDINGS 대조, 갭 매트릭스 드리프트)가 특정 패키지에 속하지 않으므로
독립 워크스페이스가 맞다. capability 레지스트리의 순수 불변식만
provider-adapters에 colocate. `@une/provider-adapters`는 exports "." 루트
엔트리로만 import(ADR-20 D3의 생성 타입 비유출 유지).

## D5. redocly 스타일 린트: 근거 있는 재이연 (CC-400 재평가)

기본 룰셋은 초안 계약(121 operations)에서 대량 노이즈를 내고, `security: []`
(의도된 OPEN)를 위반으로 찍는다. D2의 60줄 게이트가 지금 필요한 검증
(`no-invalid-media-type-examples` 상당)을 대체한다. CC-400(실계약 바인딩)에서
`spec`/`no-unresolved-refs`/`operation-operationId-unique`/
`no-invalid-media-type-examples` 4룰 최소 프로파일로 재검토한다.

## D6. capability 레지스트리는 소스관리 대상, DB 아님

`packages/provider-adapters/src/capability/plan-feature-capabilities.ts`가
기능별 상태(4종: MOCK_ONLY/UNE_ADAPTER_READY/T3Q_DEV_VERIFIED/
T3Q_PROD_VERIFIED)의 정본이다. capability는 "이 배포본이 무엇을 검증했는가"
라는 리뷰 대상 사실이므로 DB 행이면 증거 없이 운영에서 승격될 수 있어
"mock을 실지원으로 표시 금지" 규칙이 깨진다.
`provider_config.feature_flags_json`은 런타임 토글(테넌트별 on/off, 어댑터
선택) 전용으로 CC-125 소유 — **CC-115 마이그레이션 0건**.

- featureId 어휘는 CR-009 `ProviderCapabilities.features` 키를 정본으로
  (양방향 동치 드리프트 테스트) + UNE-local 6종(legacy 3 + Job 세분 3)
  allowlist.
- 현 기준선: **전원 MOCK_ONLY**(mock조차 미구현 — `mockAvailable: false`,
  `adapterImplemented: false`로 명시). 상태 단독 노출을 막기 위해
  `describeCapability()`를 함께 제공한다(AT-T3Q-012).
- 승격 절차: ①증거 문서 → ②OPEN_BINDINGS 갱신 → ③레지스트리 수정 →
  ④이중 리뷰.
- **가드 의미론(이중 리뷰 M1 개정)**: OPEN 바인딩이 차단하는 것은
  **provider 검증 주장**(T3Q_*_VERIFIED)뿐이다. `UNE_ADAPTER_READY`는 UNE
  측 사실(어댑터 존재)이므로 바인딩이 OPEN이어도 도달 가능 — 단
  `adapterImplemented: true`가 필수. VERIFIED는 `docs/evidence/CC-*.md`
  경로 규격의 실재 문서가 해당 feature를 언급해야 한다. CONDITIONAL
  (CR-T3Q-007, 바인딩 없음)은 바인딩이 배정되기 전까지 MOCK_ONLY 고정.

## D7. no-UNI 가드는 정적 검사, 런타임 증명은 CC-170

`tests/contract/src/no-uni-plan-fallback.test.ts`가 plan-flow 소스에서 UNI
토큰과 uni-rag-adapter import를 차단한다(AT-T3Q-011의 정적 반쪽). 계획서
E2E에서 "UNI 호출 0건" 런타임 증명은 CC-170 소관.

## D8. 포트 인터페이스는 CC-125로

`T3qPlanProvider` 포트는 정의하지 않는다: CC-125 AC가 명시 소유하고, 포트
시그니처가 의존할 Canonical 타입(TocVersion/TocNode/GeneratedBlock)은
CC-120에서 확정된다. CC-115 산출물(featureId 어휘, 갭 매트릭스, 제약 차이
테스트)이 포트 설계의 입력이 된다.

## 결과·한계

- 산출물: example 게이트(+전사본 핀), @une/contract-tests(26케이스),
  capability 레지스트리(+불변식 6, describeCapability), 갭 매트릭스
  (+드리프트 5), no-UNI 가드, 1.0.1-request.
- 수용 한계: 픽스처는 provider 미확인(OB-01/OB-10 OPEN — 실계약 검증은
  CC-400), SSE 프레이밍은 UNE 가정, T3Q provider-side HTTP mock은 CC-125의
  in-process mock으로(FastAPI mock-server에 넣으면 mock sync 게이트 파손).
- 수용 한계(추가, 이중 리뷰): target-v2 **응답측** 예제 커버리지 얇음 —
  ChangeProposal/evidence·validation 인라인 200/ValidationIssue/SSE payload
  예제는 CC-125 mock 구현과 함께 보강(R2). legacy 전사본에는
  `additionalProperties: false`가 없어 잉여 필드 계열 매핑 버그는 픽스처
  테스트로 원리상 검출 불가(전사본 불변 원칙의 대가, fixtures README에
  명시). no-UNI 정적 가드의 토큰·루트는 CC-125에서 t3q 어댑터 디렉터리
  추가와 함께 재확대.
