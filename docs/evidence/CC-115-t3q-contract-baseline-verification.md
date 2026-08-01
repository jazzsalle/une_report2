# CC-115 검증 증거 — T3Q 계약 기준선 (legacy RPT-001/002 + target-v2)

- 일자: 2026-08-02 (집 PC, PostgreSQL 로컬 15432)
- 브랜치: feature/CC-115 (main c36c28b 기반)
- 근거 결정: ADR-24 (v2 편집상 수정·example 게이트·contract-tests 배선·
  capability 레지스트리·redocly 재이연·DB 미사용·포트는 CC-125)
- 사용자 승인: v2 계약 편집상 수정 + `1.0.1-request` (2026-08-02)

## 수용 기준 대응

| 기준 | 증거 |
|---|---|
| legacy contract tests | @une/contract-tests `t3q-legacy.contract.test.ts` 13케이스 — UNE 작성 픽스처 7종(README에 출처·provider 미확인 명시)을 계약 스키마로 검증: 정상 요청/응답(재귀 TOC 3단, Reference), SSE 전사본(`x-sse-done` 계약값 대조, 프레임=ContentSection), 음성(필수 누락·null 필드·PlanContentData sections 결손/무명 노드), PlanContext 정합(실값 구성 가능 + 제약은 UNE 측에만 존재 증명), 구조 사실 고정(TocSection 안정 ID 부재=CR-001 근거, x-production-policy OPEN 4항) |
| target-v2 OpenAPI validation | validate-contracts.mjs 섹션 4 신설 — media-type example↔스키마 ajv(2020-12) 검증. 커버리지는 "전 operation − 사유 명시 예외 3건"(리뷰 M3 반영: 허용목록 공허화 불가), 성공(2xx) 응답만 크레딧. legacy 전사본 SHA-256 핀(리뷰 N1). **결함 2건을 수정 전 실측 재현 후 수정**(아래) |
| field gap matrix | docs/handoff/T3Q_PLAN_FIELD_GAP_MATRIX.md (표1 36행: PlanContext 18리프 ↔ legacy ↔ PlanRequestBase 17필드/required 15) + `t3q-field-gap-matrix.test.ts` 5케이스 — 경로 존재성·3방향 완전성·**행 단위 대응(말단 세그먼트 일치, 리뷰 R1)** 기계 검증 |
| feature capability states | `plan-feature-capabilities.ts` 레지스트리 14 feature 전원 **MOCK_ONLY**(adapterImplemented/mockAvailable=false 명시) + `describeCapability()`(상태 단독 노출 방지, AT-T3Q-012) + 불변식 6케이스(상태⇒플래그 정합 — CC-125 정당 승격 시 수정 불요 형태) + `capability-governance.test.ts` 6케이스(OPEN 바인딩 중 provider-verified 주장 차단·UNE_ADAPTER_READY는 도달 가능(리뷰 M1), CONDITIONAL 규칙, VERIFIED 증거는 docs/evidence/CC-*.md 경로+본문 언급 필수(리뷰 N4), 계약 features 키 **양방향** 동치+UNE-local 6종 allowlist(리뷰 N2)) — vitest alias로 **소스** 검증(dist 아님, QA F1) |
| no UNI plan fallback | `no-uni-plan-fallback.test.ts` 2케이스 — 가드 루트 6곳(worker/web/field-web/domain 포함, 리뷰 N5) 토큰 스캔 + 최소 스캔량 단언(공허화 방지) + uni-rag-adapter import 0건 (AT-T3Q-011 정적 반쪽; 런타임 증명은 CC-170) |

## 수정된 계약 결함 (target-v2, 1.0.0→1.0.1-request)

- **조합 결함**: `PlanRequestBase(additionalProperties:false)` + allOf 상속 —
  ajv 실측: Content/SemanticEdit/EvidenceSearch/Validation 4종 **구조적 충족
  불가**, Toc는 자체 optional 필드 사용 시 무효. →
  `unevaluatedProperties: false` 방식으로 수정(오탈자 필드는 계속 거부).
  생성 타입 diff **0바이트**(openapi-typescript 양 키워드 미반영).
- **예제 결함**: 유일한 toc 예제가 required `clientContext`/`requestedAt`
  누락 — example 게이트가 즉시 잡았을 결함(게이트 유효성의 증거).
- 예제 값 어휘 통일: 구 예제의 `hazardType: INFECTIOUS_DISEASE` 등 미승인
  어휘를 PlanContext 실값으로 교체(ADR-24 D1; backgroundInfo는 pass-through
  라 스키마 변경 아님).
- 필드 수준 요청 내용 불변 — provider-requests 문서 각주 + ADR-24로 고정.

## 게이트 실행 결과 (2026-08-02)

| 명령 | 결과 |
|---|---|
| pnpm validate:contracts | PASS — 신설 examples 섹션: t3q-plan v2 10건 검증(전 operation − 예외 3), 나머지 3계약 0건, 전사본 핀 일치 |
| 음성 재현 ① required 필드 제거 | FAIL/exit 1 (`must have required property 'requestedAt'`) → 복원 PASS |
| 음성 재현 ② 필수 대상 예제 삭제 | FAIL/exit 1 (`retryGenerationJobTargets must ship a request example`) → 복원 PASS |
| 음성 재현 ③ 갭 매트릭스 행 삭제 (QA) | contract-tests 1 failed → 복원 PASS |
| 음성 재현 ④ 레지스트리 tocV2→T3Q_DEV_VERIFIED | **재빌드 없이** contract-tests 3 failed (F1 수정 후) → 복원 26/26 |
| 음성 재현 ⑤ v2 예제에 오탈자 필드 주입 (QA) | FAIL/exit 1 (`must NOT have unevaluated properties`) — D-2 수정의 기능 실증 |
| pnpm generate:contract-types + drift | PASS (배너 버전 동적화 후 재생성·커밋; 이후 drift 없음) |
| pnpm --filter @une/contract-tests test | **26/26** |
| pnpm --filter @une/provider-adapters test | **6/6** |
| 루트 pnpm test — **DATABASE_URL 없이** | PASS — 신규 계약 테스트 26/26 **skip 없음**(DB 불요 확인, QA 실측) |
| pnpm build / typecheck / lint / format:check | PASS |
| pnpm validate:handoff | PASS |
| DB 마이그레이션 | **0건** (ADR-24 D6 — capability는 소스관리, feature_flags_json은 CC-125 런타임 토글) |

## 신규 배선

- 워크스페이스 `tests/contract`(@une/contract-tests) — CC-003 이연분
  ("example-level contract tests, tests/ wiring") 이행. CI `verify` 잡의
  `pnpm test`가 자동 수행(build 후 실행 순서로 provider-adapters dist 사용).
- capability 레지스트리는 `@une/provider-adapters` 루트 엔트리로 재export
  (생성 타입 비유출 유지, ADR-20 D3).

## 이중 리뷰 반영 (architecture-guardian + qa-gate-reviewer, 당일 전부 반영)

- **QA F1**: 거버넌스 테스트가 dist를 읽어 단독 실행 시 false green →
  vitest alias로 소스 고정, 음성 ④를 재빌드 없이 재현(3 failed).
- **QA F2**: 본 문서 필드 수 오기(16→17필드/required 15) 정정.
- **M1**: OPEN 바인딩 가드가 UNE_ADAPTER_READY까지 봉쇄(4상태 의미론 위반,
  CC-125에서 가드 약화 압력) → provider-verified 주장만 차단하도록 분리,
  기준선 동결 테스트를 상태⇒플래그 불변식으로 재작성(삭제 불요 형태),
  ADR-24 D6 개정.
- **M2**: 생성 타입 배너의 1.0.0-request 하드코딩 → 계약 info.version을
  생성 시점에 읽도록 수정(드리프트 게이트가 이후 자동 강제).
- **M3**: 예제 커버리지 허용목록의 공허화·4xx 공용 예제 우회 → "전
  operation − 사유 명시 예외" 반전 + 2xx만 크레딧.
- MINOR/권고: 전사본 SHA-256 핀(N1), 계약 features 양방향 동치+allowlist
  (N2/R4), CONDITIONAL 규칙(N3), VERIFIED 증거 경로 규격+본문 언급(N4),
  no-UNI 루트 6곳+토큰 확대+최소 스캔량(N5/R3), describeCapability(N6),
  capabilities 예제 providerBuild 중립화(N7), $ref 재작성 앵커 정규식(N8),
  provider-requests 각주에 예제 어휘 교체 명시(N9), .gitkeep 제거(N10),
  매트릭스 행 대응 단언(R1), PlanContentData 음성 케이스(R5), 전사본
  additionalProperties 부재로 잉여 필드 검출 불가 명시(R5, fixtures README).
- 이연 기록(R2): target-v2 **응답측** 예제 커버리지(ChangeProposal,
  evidence/validation 인라인 200, ValidationIssue, SSE payload)는 CC-125
  mock 구현 시 보강 — ADR-24 한계에 명시.

## 알려진 한계 (수용, ADR-24)

- 픽스처·SSE 전사본은 UNE 작성·provider 미확인(OB-01/OB-10/OB-11 OPEN) —
  실계약 검증은 CC-400. SSE 프레이밍은 `.assumed.` 표기.
- T3Q provider-side HTTP mock 없음 — CC-125 in-process mock 소관
  (FastAPI mock-server 추가 시 mock sync 게이트 파손).
- example 게이트는 현재 target-v2에서만 실질 작동(타 계약 예제 0건);
  플랫폼 계약 예제 도입은 CC-400 재평가.
- redocly 스타일 린트 재이연(ADR-24 D5, CC-400 최소 프로파일).
- `T3qPlanProvider` 포트 미정의 — CC-125 AC 소유(ADR-24 D8).
