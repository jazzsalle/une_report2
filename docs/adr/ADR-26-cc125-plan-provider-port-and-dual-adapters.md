# ADR-26: CC-125 T3qPlanProvider 통합 포트와 Legacy/Target-v2 이중 어댑터

- 상태: ACCEPTED (2026-08-02, CC-125)
- 관련: 설계 10 §4.2, 설계 13 §1/§4/§11, ADR-24(D6/D8), ADR-25(D2/D3/D9/D10),
  .claude/rules/{provider-adapters,security,backend,architecture}.md,
  docs/handoff/{OPEN_BINDINGS.md, T3Q_PLAN_FIELD_GAP_MATRIX.md}

## D1. 단일 `T3qPlanProvider` = 베이스 포트 + op 어휘 완비 + capability 믹스인

`T3qTocPort`(ADR-25 D3)를 예고대로 흡수·삭제하고 `t3q-plan-port.ts`로
통합했다. 형상: `T3qPlanProvider`(정체성 `providerCode/adapterId/variant/
defaultMappingVersion` + `supports()/capabilityFor()`) + 능력 믹스인
`TocCapable`/`ContentCapable` + 제네릭 결과 봉투 `T3qPlanResult<T>`.

- **op 어휘**(toc/content/semanticEdit/evidenceSearch/validate/jobStatus)는
  두 계약이 고정하므로 지금 완비했고 다시 바뀌지 않는다.
- **메서드**는 canonical 반환 타입이 존재하는 것만 선언한다. semanticEdit
  등의 반환형(ChangeProposal 등)은 OB-10/11이 OPEN인 상태라 지금 선언하면
  응답 형상 추정이 된다(ADR-24 D8과 동일 논리) — CC-135가 믹스인만
  가산적으로 추가한다. "전 메서드 선언 + NOT_SUPPORTED"안과 "toc만"안은
  각각 추정 유입/재편 재발로 기각.
- `adapterId`/`mappingVersion`은 포트 상수에서 **호출 결과값으로 승격**:
  한 어댑터가 op마다 다른 매핑 버전을 쓰며(toc `legacy-v0.8.5-une1@1` vs
  content `legacy-v0.8.5-une1@1` — 독립 개정 가능), 추적성 규칙이 요구하는
  것은 호출 단위 기록이다. 워커 job_event도 결과값 기준으로 기록한다.

## D2. provider 실패는 결과값 — 가드 위반 시 raw 유실 결함 시정

실패(전송 오류·상태코드·**응답 계약 위반**·NOT_SUPPORTED·CB open)는 전부
`ok:false` 결과값이고 rawRequest/rawResponse를 동반한다. CC-120 러너는
가드 throw를 `PROVIDER_CONTRACT_VIOLATION`으로 잡되 **rawResponse를
버렸다**(runner의 M3 백스톱 경로) — raw가 가장 필요한 순간의 유실.
CC-125부터 어댑터가 가드 예외를 내부에서 잡아 raw 동봉 실패값으로
반환한다(`T3Q_RESPONSE_CONTRACT_VIOLATION`). 러너 try/catch는 백스톱으로
유지. 워커 e2e가 provider.failed 이벤트의 rawResponse 보존을 회귀로 고정.

오류 분류(`T3Q_PLAN_ERROR_CODES`): CONNECTION_ERROR(응답 전, 재시도 가능)/
TIMEOUT(실행됐을 수 있음)/REQUEST_REJECTED(400·422 = UNE 매핑 결함 신호)/
AUTH_ERROR/ENDPOINT_NOT_FOUND/RATE_LIMITED/PROVIDER_ERROR(5xx)/
MALFORMED_RESPONSE/RESPONSE_CONTRACT_VIOLATION/CIRCUIT_OPEN/NOT_SUPPORTED/
MOCK_PROVIDER_ERROR(mock 시나리오 전용).

## D3. `LegacyT3qPlanAdapter` — OB-01 아래 fail-closed 실 HTTP

- **추정 전면 금지**: base URL은 `UNE_T3Q_BASE_URL` 필수 주입(전사본
  `servers[0]`로 폴백하지 않음 — 문서에 있다는 사실이 호출 승인이 아님).
  auth는 `none`(픽스처 서버 전용, 명시 선택)·`header`(이름+토큰 필수) 2종만
  — Bearer/API-Key 관례를 기본값으로 넣지 않는다. 미설정 = 기동 실패.
- **TLS**: 검증 비활성화를 타입으로 표현 불가하게 설계(옵션 부재) + 정적
  위생 테스트가 비활성 토큰의 부재를 t3q/plan 트리 전체에 고정.
- **타임아웃**: 연결 5s/응답 60s는 UNE 기준선(설계 10 §4.2)일 뿐 provider
  합의값 아님(갭 매트릭스 §3) — 코드 주석·env.example에 동일 명시.
  undici `Agent`(connect/headers/body 분리)로 구현 — 전역 fetch로는 연결
  타임아웃 분리가 불가해 undici를 명시 의존으로 추가(착수 스파이크로 CJS
  상호운용 확인, 폴백 불필요).
- **재시도**: 최대 1회, **응답 헤더 수신 전 실패**(DNS/거부/TLS/연결
  타임아웃)와 429/503(Retry-After 준수, 상한 10s)만. 응답 수신 후 5xx·응답
  타임아웃은 재전송하지 않는다 — 레거시 계약에 멱등키가 전무해(갭 매트릭스)
  provider가 이미 실행했는지 알 수 없다. 나머지는 워커 job 재시도(ADR-25
  D9) 소관.
- **서킷브레이커**: (어댑터, op)당 프로세스 로컬 최소 CB(연속 5 실패 →
  open 30s → half-open 1 probe, clock 주입). 분산 CB·레이트리밋 수치는
  OB-01/CC-430 — 구현하지 않음(429 처리 + 워커 batchSize 동시성 상한만).
- **펜싱 완화**: `leaseTimeoutMs > 2×(connect+response)+재시도 지연 상한`을
  기동 검증 — 리스 만료로 두 워커가 같은 job의 provider를 중복 호출하는
  창을 설정 수준에서 제거. provider 측 중복 실행 가능성 자체는 멱등키
  부재로 잔존(수용, OB-01).
- **검증**: 실 서버 없이 로컬 `node:http` 픽스처 서버(CC-115 전사본 픽스처
  서빙) 20케이스 — MockAgent가 아닌 실 소켓이라 타임아웃/거부/SSE 절단이
  실측된다. 경로 상수는 전사본 사실이며 단위 테스트로 동기 고정.

## D4. RPT-002 경계와 canonical-lite `ContentDraft`

CC-125는 본문의 **전송 + 요청 매핑 + 응답 가드 + SSE 파서 + 포트
메서드**까지. CONTENT job 파이프라인·`generated_block`·보호 블록·부분
재시도·`GeneratedBlock` 정의는 **CC-130 소유**. 포트 반환형으로
`@une/domain`에 `ContentDraft{nodeKey?,title,text,citations[],children[]}`를
신설했다. **정정(아키텍처 리뷰 M1)**: 이 형상은 legacy `ContentSection`의
provider 중립 승격이지 legacy∩v2 교집합이 아니다 — v2 `ContentBlock`은
평면(sectionId+order, title/children 없음)이라 canonical 매핑은
`GeneratedBlock`이 생기는 CC-130/CC-135 소유다. 대신
`ContentCitationDraft`에 v2 provenance 슬롯(sourceId/documentId/chunkId/
score/retrievedAt)을 선택 필드로 예약해 그 매핑이 파괴적 변경 없이
가능하게 했고, legacy 어댑터는 이 슬롯을 절대 채우지 않는다(추정 금지).
SSE 프레이밍은 여전히 UNE 가정(`.assumed.` 픽스처, OB-01)이며 파서 헤더에
명시.

## D5. `TargetV2T3qPlanAdapter` — tocV2만, 202+폴링 충실도

- 요청: `toTocGenerationRequest`가 PlanRequestBase 필수 바인딩 전부를
  **호출자 제공값**으로 채운다(상수 주입 2종: `schemaVersion:'2.0'`,
  `expressionRule.scope:'body_only'` — 갭 매트릭스 규정). 누락 시
  `T3Q_REQUEST_REJECTED` 실패값(발명 금지). 매퍼 출력은 contract-tests에서
  `TocGenerationRequest` 스키마로 기계 검증 — v2는
  `unevaluatedProperties:false`라 오탈자 필드를 실제로 잡는다(음성 1건
  포함). legacy 전사본이 원리상 못 주던 검출의 회수.
- `documentId`/`baseRevisionId`는 CC-150(Revision) 전까지 UNE 플로우에
  실체가 없다 → 워커가 **명시적 mock 전용 플레이스홀더**
  (`une-mock:document:pending-cc150` 등)를 주입한다. 실 provider 도달
  차단은 **기제**로 보장한다(아키텍처 리뷰 M2 반영): ① 포트의
  `runtimeMode`('mock'|'live' — v2 어댑터는 전송기 실체로 판정)와 워커의
  플레이스홀더 주입 조건 결합(`variant==='target-v2' &&
  runtimeMode==='mock'`), ② 어댑터가 live transport에서 `une-mock:` 접두
  trace 값을 감지하면 `T3Q_REQUEST_REJECTED`로 fail-closed(음성 테스트
  고정). CR-T3Q-* 불변식(D7)은 이에 더한 거버넌스 층. `clientContext.locale`은
  UNE 운영 기본값 `ko-KR`(UNE 소유 값).
- 응답: `OutlineSection.sectionId → nodeKey` 직결(CR-T3Q-001의 존재 이유),
  parentSectionId/order로 트리 복원. mock 전송기는 in-process 결정적
  202→RUNNING→COMPLETED (FastAPI mock-server 미확장 — ADR-24 한계 조항
  준수). SSE/취소/부분재시도/semanticEdit/evidence/validation mock과 응답측
  예제 확충은 **CC-135로 이연**(ADR-24 R2 사유 재지정 — 만들지 않는 응답의
  예제를 지금 쓰는 것이 추정이다).

## D6. 어댑터 선택 = 프로세스 env 단일 층 (`UNE_T3Q_PLAN_ADAPTER`)

`mock-legacy | legacy-http | mock-target-v2` → `createT3qPlanProvider`
순수 팩토리. provider_config.feature_flags_json 테넌트 토글은 **이연**:
(a) une_worker에 provider_config GRANT가 없어 마이그레이션이 선행되고,
(b) UNE-ADMIN-008/009 부재로 유일한 설정 경로가 직접 SQL — 증거·리뷰 없이
미검증 어댑터로 전환 가능한 거버넌스 우회가 된다(ADR-24 D6 논리),
(c) FORCE RLS라 선택 시점을 테넌트 tx 안으로 끌어오는 구조 변경 동반.
예약 키 `t3q.planAdapter`만 문서·상수로 고정(후속 admin 항목).
안전장치: 구 변수 `UNE_T3Q_TOC_ADAPTER`는 **하드 실패**(의미가 바뀐 채
통과 방지), production+mock은 `UNE_ALLOW_MOCK_PROVIDER=true` 명시 opt-in
없이는 기동 실패, 기동 로그에 `describeCapability()` 출력(AT-T3Q-012).

## D7. capability 판정 기준 문장화와 CR-T3Q-* 불변식

**`UNE_ADAPTER_READY` = 어댑터 구현 ∧ 워커 런타임 결선 ∧ 대상 계약이 live
spec(RPT-*)**. 적용:

| featureId | 판정 | 근거 |
|---|---|---|
| legacyToc | MOCK_ONLY → **UNE_ADAPTER_READY** | 3조건 충족. OB-01 OPEN은 T3Q_*_VERIFIED만 차단 |
| legacyContent | MOCK_ONLY 유지 (adapter·mock 구현 표기) | 전송·매핑·SSE 파서는 있으나 job 파이프라인 미결선(CC-130) |
| tocV2 | MOCK_ONLY 유지 (adapter·mock 구현 표기) | 대상 계약 미수락(OB-10) — live spec 아님 |

기계 가드 신설(거버넌스 테스트): **requestId가 CR-T3Q-*인 항목은 그
바인딩(OB-10/11)이 OPEN인 동안 MOCK_ONLY 고정** — 기존 "바인딩 없는
CONDITIONAL은 MOCK_ONLY" 규칙의 일반화. OPEN_BINDINGS는 닫지 않고 OB-01
fallback 서술만 정정.

## D8. raw 보존은 job_event 유지 — 전용 저장소 기각 (ADR-25 D10 종결)

`provider_trace` 전용 테이블은 도입하지 않는다: 실제 동인(보존기간·PII·
아카이빙)은 CC-430이고, 지금 도입하면 마이그레이션+GRANT+보존정책+조회
경로가 따라붙는데 얻는 것이 없다. job_event는 append-only(REVOKE) + 200KB
캡 + 0016 RLS(D9). 개선 4종: ① 가드 위반 raw 유실 시정(D2), ②
provider.responded/failed payload에 operation/httpStatus/결과 기준
mappingVersion 추가, ③ **provider.requested 발행 시작**(tx B0 말미;
adapterId/variant/op/baseUrlHost/타임아웃 예산만 — 본문·헤더·토큰 없음;
실 HTTP에서 "호출했는데 안 돌아온" 상태의 유일한 흔적), ④ 위생 고정 —
raw에 전송 헤더를 아예 담지 않는 설계 + 토큰 문자열이 결과·이벤트 어디에도
없음을 단언하는 테스트(어댑터·워커 e2e 양쪽).

## D9. 0016 자식 테이블 RLS 하드닝 이행 (ADR-25 D2 종결)

`job_event/toc_version/plan_context_snapshot/toc_node`에 EXISTS(부모)
ENABLE+FORCE RLS — CC-125가 job_event raw를 mock 합성에서 실 provider
데이터로 바꾸는 바로 그 항목이므로 여기서 닫았다(브랜치 첫 논리 단계로
분리). 워커 쓰기는 전부 테넌트 스코프 tx임을 사전 확인, 디스패치
스코프에서 4테이블 접근 불가가 **의도된 결과**(기존 "알려진 한계 핀"
테스트 반전). SSE 조회는 EXPLAIN 단언으로 `uk_job_event_seq` 인덱스 경로
유지 확인(job_event Seq Scan 부재). @une/db-integration 51/51.

## D10. 계약 편집 정책

전사본(`t3q-report-adapter-v0.8.5-une1.yaml`)은 SHA-256 핀 그대로 무변경.
target-v2는 **예제만** 추가(cancelGenerationJob 요청, getGenerationJob
COMPLETED+outline)하고 `info.version=1.0.1-request` **미상향** — 요청
계약의 버전 상향은 "T3Q에 새 요청을 냈다"는 신호이므로 스키마·필드 변경
시에만 올린다. 예제 게이트 면제는 1건 종결·1건 CC-135/CC-400 재지정(면제
3→2). getPlanProviderCapabilities 예제 동기화 주석은 CC-135로 정정.

## D11. `@une/provider-adapters`의 브라우저 중립성 포기

실 HTTP 어댑터가 undici/@types/node를 요구한다. plan 어댑터는 백엔드
전용(규칙: provider SDK는 어댑터 뒤)이고 브라우저 소비자가 없으므로
패키지를 node 대상 컴파일로 전환(로컬 `declare` 우회 제거). apps/*가 이
패키지를 import하지 않는 것은 no-UNI 가드와 별개로 워크스페이스 의존
그래프가 보장.

## 수용 한계 (재평가 지점)

- **provider 중복 실행 가능성**: 레거시 멱등키 부재로 잔존. 리스 하한
  검증으로 UNE 측 창만 제거. provider 측 처리 방식은 OB-01(CC-400).
- **SSE 프레이밍**은 UNE 가정(`.assumed.`) — OB-01 확정 시 파서 재검증.
- **CB는 프로세스 로컬**, 레이트리밋 수치 미구현 — CC-430/OB-01.
- **documentId/baseRevisionId mock 플레이스홀더** — CC-150이 실값으로
  대체하기 전까지 tocV2는 D7 불변식과 무관하게도 승격 불가.
- **generationOption(v2 preserveSectionIds 등) 미매핑** — UNE
  TocJobGenerationOption과 형상이 달라 대응 없이 생략(추정 금지). CC-130
  보호 블록 설계와 함께 재평가.
