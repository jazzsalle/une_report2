# T3Q 계획서 생성 필드 갭 매트릭스 (CC-115)

UNE PlanContext ↔ T3Q legacy v0.8.5(RPT-001/002) ↔ target-v2(1.0.1-request)
필드 대응의 정본. CC-120/125/130의 매핑 구현이 이 표를 따른다.
`tests/contract/src/t3q-field-gap-matrix.test.ts`가 아래 표 1의 경로 존재성과
완전성(PlanContext 리프 전체 / legacy 프로퍼티 전체 / PlanRequestBase required
전체)을 기계 검증한다 — 소스 3파일이 바뀌면 이 문서를 갱신해야 테스트가
통과한다.

- 소스: `contracts/schemas/plan-context.schema.json`,
  `contracts/openapi/t3q-report-adapter-v0.8.5-une1.yaml`,
  `contracts/openapi/t3q-plan-api-change-request-v1.yaml`
- 설계 근거: 13_T3Q_PLAN_API_CHANGE_REQUEST §2(갭표)·§4(공통 규칙)
- 관련: [OPEN_BINDINGS.md](OPEN_BINDINGS.md) OB-01/OB-10/OB-11,
  capability 레지스트리
  `packages/provider-adapters/src/capability/plan-feature-capabilities.ts`

## 표 1. 필드 매핑 (기계 검증 대상)

셀 문법: 1열 = plan-context.schema.json 내 점 경로, 2·3열 =
`<스키마명>.<점 경로>` (각 계약의 components.schemas 기준), 없음 = `-`.

| PlanContext | legacy (v0.8.5) | target-v2 (1.0.1-request) | 차이·비고 |
|---|---|---|---|
| subject | PlanTocData.subject | PlanRequestBase.subject | 동일 명칭. UNE·v2는 1~300자, legacy는 무제한 string |
| backgroundInfo | PlanTocData.backgroundInfo | PlanRequestBase.backgroundInfo | v2는 open object — 어휘 정본은 UNE PlanContext |
| backgroundInfo.disasterType | PlanTocData.backgroundInfo.disasterType | - | UNE enum 10종 vs legacy 자유 문자열 (legacy ⊅ UNE 제약) |
| backgroundInfo.controlPhase | PlanTocData.backgroundInfo.controlPhase | - | UNE enum 예방/대비 vs 자유 문자열 |
| backgroundInfo.location | PlanTocData.backgroundInfo.location | - | UNE는 null 허용, legacy는 string만 — **매핑 시 null은 생략** |
| backgroundInfo.startTime | PlanTocData.backgroundInfo.startTime | - | date-time. null 생략 규칙 동일 |
| backgroundInfo.endTime | PlanTocData.backgroundInfo.endTime | - | 〃 |
| backgroundInfo.reportTime | PlanTocData.backgroundInfo.reportTime | - | 〃 |
| contentInstruction | PlanTocData.contentInstruction | PlanRequestBase.contentInstruction | v2는 open object |
| contentInstruction.source | PlanTocData.contentInstruction.source | - | UNE 2000자 제한 |
| contentInstruction.essentialFactors | PlanTocData.contentInstruction.essentialFactors | - | UNE maxItems 50·항목 300자 |
| contentInstruction.writingGuide | PlanTocData.contentInstruction.writingGuide | - | UNE 2000자 제한 |
| expressionRule | PlanTocData.expressionRule | PlanRequestBase.expressionRule | v2는 required `scope: body_only` **신설**(UNE 스키마에 없음 — 매핑 시 상수 주입) |
| expressionRule.tone | PlanTocData.expressionRule.tone | - | |
| expressionRule.maxSentenceLength | PlanTocData.expressionRule.maxSentenceLength | - | 양쪽 모두 string(숫자 아님) |
| expressionRule.paragraphSymbol | PlanTocData.expressionRule.paragraphSymbol | - | |
| expressionRule.bodytextStart | PlanTocData.expressionRule.bodytextStart | - | |
| purposeOfDocument | PlanTocData.purposeOfDocument | PlanRequestBase.purposeOfDocument | v2는 open object |
| purposeOfDocument.goalOfBusiness | PlanTocData.purposeOfDocument.goalOfBusiness | - | |
| purposeOfDocument.role | PlanTocData.purposeOfDocument.role | - | |
| purposeOfDocument.targetAudiences | PlanTocData.purposeOfDocument.targetAudiences | - | UNE enum 4종 vs 자유 문자열 배열 |
| systemPrompt | PlanTocData.systemPrompt | - | v2는 전문 대신 PlanRequestBase.systemPromptVersion — 프롬프트 원문 미전송 |
| - | PlanContentData.sections | ContentGenerationRequest.outline | legacy 이름 트리(TocSection: name/children, **안정 ID 없음** → CR-T3Q-001) vs v2 OutlineSection(sectionId·semanticRole·generationPolicy) |
| - | PlanContentData.stream | - | v2는 동기 스트림 대신 202+Job/SSE(CR-T3Q-003) |
| - | - | PlanRequestBase.schemaVersion | const '2.0' |
| - | - | PlanRequestBase.requestId | 멱등키 겸 요청 식별 |
| - | - | PlanRequestBase.correlationId | UNE 추적 ID 전파 |
| - | - | PlanRequestBase.clientContext | tenantId/userId/locale/timezone |
| - | - | PlanRequestBase.planId | v2 전용 집계 식별자 |
| - | - | PlanRequestBase.documentId | 〃 |
| - | - | PlanRequestBase.baseRevisionId | 409 충돌 판정 기준(설계13 §4) |
| - | - | PlanRequestBase.planContextSnapshotId | 불변 스냅샷 참조(CC-110 산출) |
| - | - | PlanRequestBase.contextHash | 스냅샷 canonical SHA-256 |
| - | - | PlanRequestBase.requestedAt | ISO-8601(+09:00) |
| - | - | PlanRequestBase.referenceDocumentIds | 선택 — CR-T3Q-007 등록 결과 참조 |
| - | - | PlanRequestBase.systemPromptVersion | 선택 — legacy systemPrompt 대체 |

## 2. 기능 갭 (설계 13 §2 요약 — 서술형)

v2 전용 스키마 17종의 전수 표는 노이즈라 생략한다(완전성 검증은
PlanRequestBase까지 — 사유: 나머지는 기능 단위로 아래에 대응).

| 영역 | legacy v0.8.5 | target-v2 | capability featureId |
|---|---|---|---|
| 목차 | 이름 트리, ID 없음 | OutlineSection(sectionId, semanticRole, generationPolicy) | tocV2 |
| 본문 | 섹션 통짜 텍스트+references | ContentBlock(blockId·유형·상태·contentHash)+Citation(점수·발췌) | contentV2 |
| 편집 | 없음(전체 재생성만) | SemanticEditRequest→ChangeProposal(블록 단위 제안) | semanticEdit |
| 근거 | 응답 내 references만 | 독립 검색 API(Citation) | evidenceSearch |
| Job | 동기(+SSE 본문 한정) | 202+상태/SSE/취소/부분재시도 | jobStatus/jobSse/jobCancel/partialRetry |
| 검증 | 없음 | ValidationRequest 6유형 | validation |
| 오류 | **스키마 없음**(422/500 설명뿐) | ErrorResponse{code,message,retryable,field,correlationId,details} | - |
| 운영 | 인증·타임아웃·한도 전부 OPEN | capabilities 협상 API | capabilityDiscovery |

## 3. 운영·미확정 갭 (OPEN — 추정 금지)

- 인증/타임아웃/레이트리밋/오류 스키마(legacy): **OB-01**. 설계 10 §4.2의
  연결 5s/응답 60s/SSE heartbeat 15s는 UNE 측 기준선일 뿐 provider 합의값
  아님.
- SSE 프레이밍(legacy): 계약은 `x-sse-done: '[DONE]'`만 명시. 프레임 구조는
  UNE 가정(픽스처 `.assumed.` 표기) — OB-01에서 확정.
- v2 수락 여부: CR-001/002/003/004/009 = **OB-10**, CR-005/006 = **OB-11**,
  CR-007 = CONDITIONAL.

## 4. capability 상태 갱신 절차 (ADR-24)

상태 변경(예: MOCK_ONLY → UNE_ADAPTER_READY)은 반드시 ① docs/evidence/에
증거 추가 → ② 바인딩 종결 시 OPEN_BINDINGS.md 갱신 → ③ 레지스트리
(plan-feature-capabilities.ts) 수정 → ④ 이중 리뷰 순서로만 진행한다.
`capability-governance.test.ts`가 OPEN 바인딩 상태의 승격과 증거 없는
VERIFIED를 차단한다.
