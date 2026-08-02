# ADR-28: CC-135 Target-v2 Mock — Job 라이프사이클·의미 편집·근거·검증

- 상태: ACCEPTED (2026-08-02, CC-135)
- 관련: 설계 13 §4/§11/§13, `contracts/openapi/t3q-plan-api-change-request-v1.yaml`
  (1.0.1-request), docs/provider-requests/T3Q_PLAN_API_CHANGE_REQUEST.md,
  ADR-24(D3/D4/D6/R2), ADR-26(D1/D2/D4/D5/D7/D10), ADR-27(D3/D4/D5/D7/D8/D9),
  .claude/rules/{provider-adapters,architecture,security}.md
- 대전제: **target-v2 계약은 T3Q 미수락(OB-10/OB-11)** — 이 ADR의 모든 산출물은
  UNE in-process mock이며, 어떤 문서·로그·보고에서도 실제 T3Q 지원으로
  표현될 수 없다(CLAUDE.md, CR-T3Q-* 불변식).

## D1. 범위 경계 — 어댑터 mock + 계약 예제 + 계약/거버넌스 테스트

CC-135 = `packages/provider-adapters`의 target-v2 전체 mock(포트 믹스인 4종
포함) + 계약 응답측 예제(ADR-24 R2 종결) + 계약·거버넌스 테스트 + CC-130이
예약한 워커 seam 2건(v2 trace 훅 m-10, 기동 로그). 다음은 명시적으로 **밖**:

| 대상 | 소유 | 근거 |
|---|---|---|
| 의미 편집 API·proposal 영속(ai_edit_proposal) | CC-150 | 설계 10 UNE-DOC-010/011, ADR-27 D10 |
| EvidenceSet 영속·근거 정규화 | CC-230 | ADR-27 D8 |
| 실계약 바인딩·실 SSE·펜싱 하한 재산정 | CC-400 | OB-10/OB-11 OPEN |
| Plan 흐름 UNI 무호출 런타임 증명 | CC-170 | ADR-24 D7 |

**마이그레이션 0건.** 유일한 영속 접점은 CONTENT 경로의
`generated_block.citations_json`인데 0017 제약(배열 여부만 검사, STORED
citation_count, 부분 인덱스)은 v2 provenance 원소를 그대로 수용한다 —
db-integration 3케이스가 카탈로그를 핀 고정(65→68). ChangeProposal/
ValidationIssue/Evidence는 CC-135에서 영속하지 않는다.

## D2. op 어휘 불변 — 라이프사이클은 jobStatus 아래 믹스인

`T3Q_PLAN_OPERATIONS` 6종을 유지한다(ADR-26 D1 "어휘 완결" 존중). cancel/
retry/SSE/capabilities는 별도 op가 아니라 `JobLifecycleCapable` 믹스인
메서드이고 결과 meta는 전부 `operation: 'jobStatus'`로 기록된다. 세분화
가시성은 `describeRuntimeFeature(provider, featureId)`가 담당(jobSse/
jobCancel/partialRetry/capabilityDiscovery). 대안(어휘 확장)은 기각 —
소비처의 exhaustive 분기가 전부 깨지고, 추적 의미는 "생성 Job에 대한 부속
조작"이라 jobStatus로 충분하다.

에러 어휘에는 **`T3Q_CONFLICT`**(409: 종결 job cancel/retry, stale
baseRevision)를 추가했다. 워커 러너는 코드 매핑을 providerCode로 그대로
기록하므로 소비처 영향 없음(전수 확인).

## D3. canonical-lite provisional 타입 (@une/domain)

`EditProposalDraft`/`EvidenceItemDraft`/`ValidationIssueDraft(ReportDraft)`를
`packages/domain/src/plan/provider-proposal-drafts.ts`에 신설. 단일
provider(v2 mock) 파생이고 소비자는 어댑터 테스트뿐 — CC-150/CC-230이
재정의할 수 있음을 헤더에 명시(ContentDraft 선례). 대안(어댑터가 v2 DTO
직반환)은 기각: "provider DTO는 어댑터 내부" 아키텍처 규칙 위반.

## D4. PARTIAL은 비종결 — fail-closed 판독

계약의 PARTIAL 서술("일부 성공·일부 실패 또는 생성 중 부분결과")은 종결성이
모호하다. UNE 판독: **PARTIAL = 비종결, 폴링 계속**. 폴 예산 소진 시
`T3Q_TIMEOUT`(raw에 completed/failedTargetIds 보존). 부분성은 종결
COMPLETED의 `failedTargetIds` → `ContentGenerationPayload.failedNodeKeys`로
노출하고, **UNE Job/Plan 상태 어휘에 PARTIAL은 도입하지 않는다**(ADR-27 D3
불변). mock도 같은 모델: 실패 존재 시 RUNNING→PARTIAL(1폴)→COMPLETED,
전 대상 실패 시 FAILED. 종결성 진실은 갭 매트릭스 §3 OPEN(OB-10).

## D5. v2 SSE 프레이밍은 UNE 가정 (.assumed)

계약은 event 이름만 산문으로 고정하고 스트림 스키마는 `type: string`이다.
`target-v2-sse.assumed.ts`가 UNE가 요청하는 프레이밍(id==data.sequence,
JSON data, 주석형 heartbeat, Last-Event-ID 재개=id>k 재생, 엄격 증가)을
구현·직렬화·파싱한다 — legacy `.assumed` 규약 이식, OB-10 귀속. **종결
이벤트(job.completed|job.failed) 없이 끝난 스트림은 부분 결과가 아니라
`T3Q_MALFORMED_RESPONSE`**(legacy `[DONE]` 원칙 동일). 취소된 job의 스트림
종결은 `job.failed(status: CANCELLED)`로 가정(계약에 job.cancelled 이벤트가
없음 — 갭 기록).

## D6. 부분재시도 이중 모델 — provider retry ≠ UNE 재생성

v2 `retryGenerationJobTargets`는 **provider 측** 실패 대상 재시도이며 새
generationId를 발급한다(mock: 실패 섹션 ⊄ targetIds → 409, 성공 대상 조용한
재생성 금지). UNE 측 부분 재생성은 ADR-27 D7 그대로 **`targetNodeKeys`로 새
UNE job**이고 `blockIds`는 400 유지. 두 층은 섞이지 않는다 — UNE Job 모델은
CC-135에서 불변.

## D7. contentV2 canonical 결합과 손실 명시

v2는 섹션당 다수 ContentBlock, UNE는 노드당 현재 행 1개(0017 부분 유니크).
매퍼는 sectionId 그룹을 `order` 순으로 **결합**해 outline과 평행한
ContentDraft 트리를 만든다(앵커링 위치+제목 이중 일치 그대로 통과; sectionId
== nodeKey). 손실 필드(blockId/blockType/status/contentHash/warnings)는
rawResponse에 보존 — 블록 단위 영속은 CR-T3Q-002 수락 시(CC-400) 재평가.
어댑터에 `targetNodeKeys`가 주어지면 `generationScope: SECTIONS +
targetSectionIds`, 없으면 ALL. **현행 워커의 범위 재생성은 legacy 공유
경로대로 프루닝된 부분 트리 + ALL로 나간다**(리뷰 m-4에서 확정 기록):
provider 요청면의 outlineLevel/order는 부분 트리 상대값이 되지만, UNE
영속 좌표는 `outlineCoordinates(전체 트리)`가 전담하므로(ADR-27 D9/B-1)
데이터 손상은 없다. 전체 아웃라인+SECTIONS 전송으로의 전환은 provider
계약 수락과 함께 CC-400에서 재평가.

**protectedBlockIds 전송**: 포트에 `protectedBlockKeys`를 추가했고 v2
매퍼는 계약 필드로 전송하지만, **워커는 아직 전달하지 않는다** — UNE
generated_block UUID와 provider blockId는 다른 id 공간이고 바인딩은
CC-150(Revision) 소유. 보호 집행은 UNE 3중 방어(B0/B1 재확인 + 0017
트리거)가 전담하며 provider 성실성에 의존하지 않는다(ADR-27 D4 불변).

## D8. 보호블록·에코 침범은 응답 가드가 기제로 차단

의미 편집에서 (a) 보호 블록을 target으로 한 요청은 매퍼가 사전 거부
(`T3Q_REQUEST_REJECTED`), (b) 응답 proposal의 operations/proposedBlocks가
protectedBlockKeys를 건드리면 `findProtectedBlockViolations`가 전체 격리
(`T3Q_RESPONSE_CONTRACT_VIOLATION`, raw 보존). evidence는 requestId 에코
불일치를 같은 코드로 격리. 거버넌스 문장이 아니라 코드 경로다(ADR-26 M2
원칙 이식) — CC-150이 proposal을 ChangeSet으로 적용할 때의 최후 방어선.

## D9. validation mock은 어떤 UNE 경로도 차단하지 않는다

mock 판정은 UNE가 작성한 휴리스틱 6종(SCHEMA/CITATION_COVERAGE/
UNSUPPORTED_CLAIM/DUPLICATE_CONTENT/EXPRESSION_RULE/
MISSING_REQUIRED_SECTION)의 **provider 응답 모사**다. MOCK_ONLY 기능 위에
차단·게이팅을 얹으면 mock을 실지원처럼 쓰는 것 — 금지. ADR-27 D8의 "차단은
CC-135 validation" 문구는 본 결정으로 정정 종결한다: 실제 차단 도입은
CR-T3Q-006 수락(OB-11 종결) 후 CC-400/CC-170 판단. `blocksWithoutEvidence`
가시화(CC-130)는 그대로 유지. 역매핑 fail-closed: v2 provenance가 없는
legacy 인용은 v2 검증 요청에 태울 수 없다(발명 금지).

## D10. 계약 편집 정책 — 예제만, 버전 미상향, 면제 0

`1.0.1-request` 유지(ADR-26 D10: 스키마·필드 변경 시에만 상향; 이번 변경은
응답측 예제 10건 + 주석·편집로그뿐 — 생성 타입 diff 0으로 기계 증명).
`EXAMPLE_REQUIRED_FILES` 면제 2건(SSE·multipart)을 예제 추가로 종결해 면제
0(빈 객체 유지 — 커버리지 강제는 계속). SSE 전사 예제는 "요청 문서"라는
성격상 UNE가 기대하는 프레이밍을 T3Q에 보여주는 요청 품질 장치다(전사본
금지 논리 ADR-24 D3은 legacy 전용). 전사본 핀 무변경.

## D11. capability 판정 — 전 기능 MOCK_ONLY 고정, 협상은 정본이 아님

v2 전 기능 `adapterImplemented: true, mockAvailable: true`로 갱신하되
`state: MOCK_ONLY` 고정 — ADR-26 D7 3조건(구현 ∧ 결선 ∧ **live spec**) 중
live spec이 원천 불충족(계약 미수락). `providerBuild:
'une-mock-target-v2-1.0.1-request'`는 T3Q 빌드로 오독 불가능한 이름.
`discoverCapabilities` 결과(전부 true)는 로그/추적용일 뿐 **레지스트리
정본을 바꾸지 못한다**(ADR-24 D6) — 거버넌스 테스트로 고정.
`referenceUpload`는 false/미구현 유지(CR-T3Q-007 CONDITIONAL).

## D12. 실시간 부분 이벤트 판정 — mock 층 지원, UNE 지속성 경로는 비실시간

mock/어댑터 층은 실시간 프레임(SSE 직렬화·파싱·재개)을 완전 지원한다.
그러나 UNE 워커의 3-tx 지속성 모델은 불변 — 외부 호출 중 DB 쓰기 인터리브는
취소 원자성을 깨므로(ADR-27 D5 기각 근거 유지) `content.block`/`job.progress`
합성은 계속 tx B1 일괄이다. 실시간 반영은 CR-T3Q-003 수락 후 **CC-400
확정 이월**. `UNE_T3Q_CONTENT_STREAM` seam(기본 false)은 유지.

## 수용 한계

- 모든 v2 id(generationId/proposalId/citationId 등)는 UNE mock 파생 —
  provider 실값 아님. documentId/baseRevisionId는 `une-mock:` 플레이스홀더
  — live 전달 시 **trace를 운반하는 전 op**(toc/content/semanticEdit/
  evidenceSearch/validate)가 fail-closed(QA F-4 정정: jobRef만 운반하는
  job lifecycle 계열은 검사 대상 자체가 없음). 더 바깥 방어로 live
  transport 주입 자체가 생성자 `allowLiveTransport` 명시 opt-in 없이는
  거부된다(리뷰 m-8 기제화).
- live v2 transport의 타임아웃/재시도/서킷브레이커/레이트리밋 정책은
  존재하지 않는다 — CC-400 소유. 그 전까지 live 주입은 위 opt-in 가드로
  금지가 기본값이다(리뷰 m-8).
- SSE 재개 경계(QA F-3, D5 보충): resume(lastEventId) 후 빈 replay는
  "이미 종결 소비" no-op으로 **빈 프레임 성공**; resume 없이 빈 스트림은
  MALFORMED(비재시도); 비종결 절단은 MALFORMED(재시도 가능).
- SSE 프레이밍·PARTIAL 종결성·409 코드 체계(PLAN-V2-409-00x)는 UNE
  가정(OB-10). 검증 heuristic의 실 T3Q 대응 여부는 미지(OB-11).
- ContentBlock 결합은 blockType/구조를 잃는다(rawResponse 보존) — 표·서식
  블록의 실 매핑은 CR-T3Q-002 수락 후.
- 워커 protectedBlockIds 전송 없음(id 공간 바인딩 CC-150) — D7 참조.
- legacy 어댑터는 이번 확장 대상 아님(semanticEdit 등은 T3Q_NOT_SUPPORTED
  결과값).
