**재난안전 AI 문서 통합플랫폼**

Architecture Decision Record

**미결정 OPEN 항목 확정 및 개발 기준선**

**의사결정기록서**

**Version 1.1 \| 2026.07.26**

| **과제명**   | 재난관리를 위한 맞춤형 정보생성 및 의사결정지원 대화형 인공지능 기술개발             |
|--------------|--------------------------------------------------------------------------------------|
| **과제번호** | RS-2024-00407304                                                                     |
| **작성기관** | ㈜유엔이(UNE)                                                                        |
| **적용연차** | 3차년도(2026) 개발 기준                                                              |
| **문서성격** | 개발 기준선 구속력을 갖는 Architecture Decision Record 통제문서                      |
| **기준문서** | 통합플랫폼 상세설계서 v0.9, HWPX/rhwp Engine v1.0, SituationContext/UNI Adapter v1.0 |

# 문서 작성·검토·승인

| **구분** | **소속** | **성명/역할**                         | **상태**          |
|----------|----------|---------------------------------------|-------------------|
| 작성     | ㈜유엔이 | 연구기획·시스템 아키텍처              | 작성 완료         |
| 검토     | ㈜유엔이 | 개발책임자·문서엔진 담당·Backend 담당 | 개발 착수 전 검토 |
| 승인     | ㈜유엔이 | 연구소장/PM                           | 기준선 승인       |

## 제·개정 이력

| **버전** | **일자**   | **개정내용**                                                                                                                                                                                                                   | **작성** |
|----------|------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| 1.0      | 2026.07.26 | 통합설계 v0.9의 OPEN-01~OPEN-08을 ADR-11~ADR-18로 확정하고, 구현 경계·Gate·완료기준·재검토 Trigger를 정의                                                                                                                      | ㈜유엔이 |
| 1.1      | 2026.07.26 | ADR-15의 rhwp 관리방식을 GitHub Fork가 아닌 특정 Tag/Commit 소스 아카이브 다운로드·SHA-256 검증·UNE 내부 저장소 반입 방식으로 정정하고, ADR-16을 운영기능이 아닌 한컴 HWPX 호환성 Round-trip 검증 및 배포 승인 기준으로 명확화 | ㈜유엔이 |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>문서 통제 원칙</strong></p>
<p>본 문서는 기존 통합설계서의 내용을 축약하거나 대체하는 요약본이 아니다. 통합설계서 v0.9의 24.2 미결사항을 닫고 개발계획서/WBS에 투입할 수 있도록 결정 근거, 대안, 영향, 구현 규칙, 시험 Gate를 추가한 통제문서이다. 이후 설계 변경은 기존 ADR을 덮어쓰지 않고 SUPERSEDED 또는 AMENDED 상태의 신규 ADR로 추적한다.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 목차

> 1\. 문서 개요
>
> 2\. 기존 확정 ADR 기준선
>
> 3\. OPEN 항목 폐쇄 결과
>
> 4\. ADR-11 T3Q 현재 재난상황정보 API 적용 정책
>
> 5\. ADR-12 상황일지 생성 주체와 T3Q RPT-003 적용 정책
>
> 6\. ADR-13 UNI compns와 UNE SOP Schema 변환 경계
>
> 7\. ADR-14 국민안전24·Naver 보조수집 운영정책
>
> 8\. ADR-15 rhwp 소스 반입·내부 형상관리·라이선스·미지원 객체 정책
>
> 9\. ADR-16 한컴 HWPX 호환성 Round-trip 검증 및 배포 승인 기준
>
> 10\. ADR-17 문자·메일·방송 전파 모듈 경계
>
> 11\. ADR-18 실증기관 및 자연·사회재난 시나리오 기준
>
> 12\. 공통 구현 Gate와 추적성
>
> 13\. 기준문서 개정 및 개발계획서/WBS 입력사항
>
> 부록 A. OPEN 폐쇄 인수 체크리스트
>
> 부록 B. 용어 및 상태 정의

# 1. 문서 개요

## 1.1 목적

통합설계서 v0.9는 재난안전계획서 생성도구, 상황일지 생성도구, 안전한국훈련 연계 SOP 실행, HWPX/rhwp 문서엔진을 하나의 React 기반 플랫폼으로 묶는 개발 기준선이다. 다만 T3Q·UNI·외부 Provider·한컴 실행환경·실증기관처럼 외부 협의나 POC 결과에 의존하는 8개 항목은 OPEN 상태로 남겨 두었다. 본 문서는 해당 항목을 개발이 가능한 형태의 조건부 확정 결정으로 전환한다.

“조건부 확정”은 의사결정을 미루는 것이 아니다. 외부 제공물이 아직 없더라도 UNE가 자체적으로 개발할 수 있는 경계와 기본 동작을 확정하고, 향후 외부 조건이 충족되었을 때 Adapter 교체 또는 설정 변경으로 수용하도록 설계한다. 따라서 개발팀은 T3Q 협의, 실증기관 선정 또는 채널 소스 제공을 기다리지 않고 공통 도메인·Port·Adapter·시험 Stub을 구현할 수 있다.

## 1.2 적용 범위

- OPEN-01~OPEN-08의 상태를 CLOSED-BY-ADR로 변경한다.

- ADR-11~ADR-18을 개발계획서, WBS, 사용자 시나리오, 화면설계, API/DB/Sequence의 상위 의사결정으로 적용한다.

- 계획서 생성 Provider는 기존 ADR-05에 따라 T3Q RPT-001/002만 사용한다. 본 문서의 UNI 관련 결정은 상황일지·SOP POC 범위에 한정한다.

- 상황정보와 실행이력의 사실성은 SituationSnapshot과 Execution Log로 보장하며, LLM 또는 외부 Provider의 응답을 자동 확정하지 않는다.

- HWPX 원본 양식의 보존, 사용자 수정 보호, ChangeSet/Diff/Undo, 한컴 Round-trip은 기능 개발과 별개의 후처리 과제가 아니라 완료기준에 포함한다.

## 1.3 비범위

- T3Q가 담당하는 RAG/LLM 모델 자체, 외부연계 원천 API 개발, TTS/STT 모델 개발

- UNE가 대화형 챗봇 UI 또는 범용 AI Agent 플랫폼을 별도로 개발하는 범위

- 법률 자문을 대체하는 웹수집 이용조건 판단. 본 ADR은 운영승인 Gate와 기술적 안전장치를 정하며 최종 법무 판단은 별도 절차로 남긴다.

- 실증기관의 최종 명칭과 현장 조직도 확정. 본 ADR은 기관 독립형 시나리오 패키지와 Binding 절차를 확정한다.

## 1.4 기준문서 우선순위

| **순위** | **문서**                                             | **적용 용도**                                |
|----------|------------------------------------------------------|----------------------------------------------|
| 1        | UNE 재난안전 AI 문서 통합플랫폼 상세설계서 v0.9      | Master 아키텍처·업무흐름·데이터·검증 기준    |
| 2        | UNE Document AI Contract v1.0 및 v0.9 Schema Bundle  | AI Operation·Document JSON·기계검증 Contract |
| 3        | HWPX/rhwp Document Engine 상세명세서 v1.0            | 임의 HWPX 분석·편집·저장·Round-trip 구현     |
| 4        | SituationContext 및 UNI Adapter 상세명세서 v1.0      | 상황정보·UNI·Provider·SOP POC 구현           |
| 5        | 본 ADR 의사결정기록서 v1.1                           | OPEN 폐쇄, Adapter/Gate/재검토 Trigger       |
| 참조     | T3Q MOIS API v0.8.5, UNI OpenAPI v1.1.0, rhwp 저장소 | 외부 Provider 원본·오픈소스 검토 근거        |

## 1.5 ADR 상태 모델

| **상태**             | **의미**                                                        | **개발 처리**                                 |
|----------------------|-----------------------------------------------------------------|-----------------------------------------------|
| PROPOSED             | 대안 검토 중                                                    | 개발 기준으로 사용 금지                       |
| ACCEPTED             | 결정 승인·효력 발생                                             | WBS/설계/코드/시험에 반영                     |
| ACCEPTED-CONDITIONAL | 기본 경계는 확정, 외부 Trigger 발생 시 Adapter 또는 설정 재평가 | 기본 구현 즉시 착수, Trigger 항목은 Gate 관리 |
| SUPERSEDED           | 신규 ADR이 대체                                                 | 기존 이력 보존, 신규 ADR 링크                 |
| REJECTED             | 채택하지 않음                                                   | 대안 검토 근거로만 보존                       |

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/03_ADR_v1.1/media/image8.png" style="width:6.22047in;height:1.89524in" />

그림 1-1. ADR 수명주기와 개발 산출물 추적

## 1.6 공통 의사결정 원칙

- P-01 사실원장 우선: 외부 API·LLM 응답은 후보 또는 파생 콘텐츠이며, 확정 SituationSnapshot과 Execution Log만 사실원장이다.

- P-02 Port/Adapter 격리: 외부 Provider와 채널은 도메인 모델에 직접 침투하지 않도록 Port와 Anti-Corruption Layer 뒤에 둔다.

- P-03 보존형 문서처리: 지원하지 않는 HWPX 객체를 삭제하거나 재구성하지 않고 원문 fragment를 보존한다. 손실 가능성이 있으면 편집 제한 또는 저장 차단한다.

- P-04 사용자 승인: AI 생성·외부 Fact 선택·SOP 실행·상황일지 확정은 역할별 승인과 감사로그를 거친다.

- P-05 점진적 대체: UNI·Mock·보조 Provider로 검증한 Contract를 T3Q Adapter가 충족하도록 전환하며, 업무·문서·화면 코드를 Provider별로 분기하지 않는다.

- P-06 실패격리: 외부 장애가 상황등록, 수동 SOP 편집, 기존 실행관리, 문서 저장 전체를 중단시키지 않는다.

- P-07 인수증거: 각 ADR은 코드 구현뿐 아니라 E2E 결과, 로그, ValidationReport, Round-trip 보고서 등 재현 가능한 증거로 종료한다.

# 2. 기존 확정 ADR 기준선

통합설계 기준선 인계서 v0.9에서 ADR-01~ADR-10은 이미 확정되었다. 본 문서의 신규 ADR은 이를 변경하지 않고 외부 의존성·운영 Gate를 보완한다. 번호 중복을 방지하기 위해 신규 결정은 ADR-11부터 부여한다.

| **ID** | **결정**                                                    | **구현 구속사항**                                                                         |
|--------|-------------------------------------------------------------|-------------------------------------------------------------------------------------------|
| ADR-01 | rhwp Web Editor를 중앙 Single Editing Surface로 사용        | 별도 생성화면과 편집화면의 문서 상태 불일치를 방지하고 생성 완료 Block부터 즉시 편집한다. |
| ADR-02 | 임의 HWPX 자동분석 + Template Profile + Prototype Clone     | 사용자가 업로드한 최소양식·완성문서를 분석해 역할·개요·표 Prototype을 생성한다.           |
| ADR-03 | AI는 내용/의미 level만 생성, HWPX 서식은 UNE 엔진이 적용    | LLM이 XML/서식 ID/기호 공백을 생성하지 못하게 하여 양식 보존 책임을 문서엔진에 둔다.      |
| ADR-04 | Cursor/Range/Block/Section 선택과 ChangeSet/Diff/Undo       | AI 편집을 안정 ID 기반 명령으로 표준화하고 사용자 수정을 보호한다.                        |
| ADR-05 | 계획서 생성은 T3Q RPT-001/002만 사용                        | UNI fallback과 챗봇 API 사용을 금지하여 기관 책임경계를 유지한다.                         |
| ADR-06 | 상황일지 POC는 UNI Upload/Search/chat-json/chat 사용        | T3Q 일지 API가 확정되기 전 실제 시나리오·Schema를 검증한다.                               |
| ADR-07 | T3Q/UNI는 상황전파에 사용하지 않으며 UNE 내부모듈 담당      | 전파·수신·착수·완료·재전파 이력을 Workflow/Propagation/Execution Log에서 관리한다.        |
| ADR-08 | 현재상황은 SituationFact/Snapshot으로 관리, LLM 생성값 금지 | 원천 Fact·사용자 수정 Fact·확정 Snapshot을 구분한다.                                      |
| ADR-09 | KMA/MOIS 우선, SafeKorea 보조, Naver 사용자 요청형 보조수집 | 공식 API 우선·보조수집 격리 정책을 적용한다.                                              |
| ADR-10 | Execution Log를 사실원장으로 상황일지 생성                  | 상황일지를 원장으로 직접 편집하는 것이 아니라 이력의 Projection 문서로 생성한다.          |

# 3. OPEN 항목 폐쇄 결과

| **OPEN** | **대응 ADR** | **상태**      | **폐쇄 결정**                                                                                                                                   |
|----------|--------------|---------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| OPEN-01  | ADR-11       | CLOSED-BY-ADR | T3Q 상황정보 API를 대기하지 않고 canonical SituationProviderPort와 Provider chain을 구현. T3Q Adapter는 계약 수신 후 활성화.                    |
| OPEN-02  | ADR-12       | CLOSED-BY-ADR | UNE JournalProjection을 기준 생성기로 확정. RPT-003은 선택적 Adapter/비교대상으로 한정.                                                         |
| OPEN-03  | ADR-13       | CLOSED-BY-ADR | UniSopMapper와 versioned mapping을 확정. 실제 응답 차이는 mapping profile 개정으로 수용.                                                        |
| OPEN-04  | ADR-14       | CLOSED-BY-ADR | 공식 API 우선, SafeKorea on-demand 보조, Naver 사용자 요청형만 허용. 운영 Feature Flag 기본 OFF와 승인 Gate 확정.                               |
| OPEN-05  | ADR-15       | CLOSED-BY-ADR | rhwp MIT 기반 특정 Tag/Commit 소스 다운로드·UNE 내부 저장소 반입 + UNE Adapter/보존형 Serializer 채택. 미지원 객체는 Preserve-only/Reject 정책. |
| OPEN-06  | ADR-16       | CLOSED-BY-ADR | CI 검증과 Windows 한컴 Round-trip의 이중 시험체계 확정. 최종 Release Candidate는 한컴 호환성 검증과 배포 승인 기준 통과 필수.                   |
| OPEN-07  | ADR-17       | CLOSED-BY-ADR | ChannelPort + Transactional Outbox 확정. POC 필수 채널은 System, 외부 채널은 Adapter/Stub.                                                      |
| OPEN-08  | ADR-18       | CLOSED-BY-ADR | 기관 독립 Scenario Pack + 자연/사회 기준 시나리오 확정. 최종 실증기관은 Config Binding Gate로 처리.                                             |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>중요</strong></p>
<p>OPEN 항목은 “외부 협의가 끝났다”는 의미로 닫는 것이 아니라, 외부 협의가 끝나지 않아도 UNE가 어떤 기본구조를 구현하고 어떤 조건에서 교체·활성화할지를 확정함으로써 닫는다. 각 외부 Trigger는 ADR을 다시 OPEN으로 되돌리지 않고 별도 Change Request 또는 신규 ADR을 생성한다.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 4. ADR-11 T3Q 현재 재난상황정보 API 적용 정책

ADR-11. 현재 재난상황정보는 UNE canonical Provider Port로 수용하고 T3Q Adapter는 계약 충족 후 활성화

| **상태**     | ACCEPTED-CONDITIONAL  | **대응 OPEN**   | OPEN-01                         |
|--------------|-----------------------|-----------------|---------------------------------|
| **결정일**   | 2026.07.26            | **적용 기준선** | 통합설계 v0.9 이후              |
| **결정권자** | UNE 연구기획/아키텍처 | **재검토 방식** | Trigger 발생 시 신규 ADR로 개정 |

### 4.1 배경과 문제

상황일지·안전한국훈련 시나리오는 현재 기상·특보·재난문자·현장보고·피해·통제·대응상태를 결합해야 한다. 그러나 T3Q 전용 현재 재난상황정보 API는 요청·응답 Schema, 인증, 오류, 출처, 시간 의미가 확정되지 않았다. API를 기다리면 SituationContext, 화면, DB, SOP 생성의 개발이 중단되고, 임시 필드를 직접 사용하면 향후 T3Q API 도입 시 전체 코드를 수정해야 한다.

### 4.2 고려한 대안

| **대안**                              | **내용**                                      | **장점**                       | **문제**                          | **결론** |
|---------------------------------------|-----------------------------------------------|--------------------------------|-----------------------------------|----------|
| A. T3Q API 확정까지 대기              | 외부 계약 후 개발 시작                        | 중복 구현 최소                 | 일정 지연, 화면·DB·시험 착수 불가 | 기각     |
| B. KMA/MOIS 필드를 도메인에 직접 사용 | 현재 확보 가능한 API 중심 구현                | 빠른 POC                       | Provider 종속, T3Q 전환 비용 증가 | 기각     |
| C. canonical Port + Adapter           | UNE SituationFact를 중심으로 각 Provider 변환 | 독립 개발, 병행검증, 점진 전환 | 초기 Mapper/검증 비용             | 채택     |

### 4.3 확정 결정

- SituationProviderPort를 UNE Backend의 유일한 외부 상황정보 진입점으로 정의한다. UI·Workflow·Journal은 KMA, MOIS, SafeKorea, Naver, T3Q의 원시 필드를 직접 참조하지 않는다.

- POC 기본 Provider chain은 USER_INPUT → KMA_FORECAST/KMA_WARNING → MOIS_MESSAGE → SAFEKOREA_WEB(보조) → NAVER_USER_REQUEST(선택) 순으로 구성한다. 사용자가 직접 입력한 정보는 외부 장애 시에도 항상 사용 가능해야 한다.

- T3Q_SITUATION Adapter는 코드와 설정 자리를 선행 구현하되 기본 상태를 DISABLED로 둔다. T3Q 계약이 수신되면 별도 배포 없이 Feature Flag와 Provider 우선순위를 변경할 수 있어야 한다.

- 외부 응답은 SituationFact 후보로만 저장하며 자동으로 SituationSnapshot에 포함하지 않는다. 중복·충돌·freshness를 표시한 후 사용자 또는 승인권자가 선택·수정·확정한다.

- Provider 장애는 해당 ProviderStatus만 DEGRADED/UNAVAILABLE로 전환하고 상황등록·수동입력·기존 Snapshot 조회·SOP 편집을 계속 제공한다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/03_ADR_v1.1/media/image9.png" style="width:6.22047in;height:1.89524in" />

그림 4-1. SituationProviderPort 중심의 외부연계 경계

### 4.4 Canonical Port 계약

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>interface SituationProviderPort {<br />
ProviderKey key();<br />
ProviderCapabilities capabilities();<br />
ProviderResult&lt;List&lt;SituationFactCandidate&gt;&gt; collect(CollectSituationQuery query);<br />
ProviderHealth health();<br />
}<br />
<br />
CollectSituationQuery {<br />
incidentId, disasterType, location{adminCode, geometry?},<br />
timeWindow{from,to,asOf}, categories[], requestReason, requestedBy<br />
}<br />
<br />
SituationFactCandidate {<br />
candidateId, category, normalizedValue, unit, severity,<br />
observedAt, issuedAt, retrievedAt, expiresAt,<br />
location, provider, source{sourceId,url,hash},<br />
freshness, reliability, rawPayloadRef, parserVersion<br />
}</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

### 4.5 T3Q Adapter 활성화 Gate

| **Gate**         | **필수 확인항목**                                   | **합격 기준**                                         | **실패 시**             |
|------------------|-----------------------------------------------------|-------------------------------------------------------|-------------------------|
| G11-1 계약       | Endpoint, 인증, 요청/응답, 오류코드, Rate Limit     | OpenAPI 또는 동등 수준 명세와 샘플 3종 이상           | DISABLED 유지           |
| G11-2 Provenance | sourceId, 원천기관, 발행/관측/조회시각, 원문 식별자 | SituationFact 필수 필드 100% 매핑 또는 공식 null 정책 | Mapper warning + 미활성 |
| G11-3 의미       | 재난유형·지역·상태·단위·severity                    | 테스트 벡터 20건 canonical 변환 통과                  | 변환규칙 협의           |
| G11-4 오류       | Timeout, 인증, 데이터 없음, 부분결과, 서버오류      | UNE 오류 taxonomy로 구분되고 재시도 여부 명확         | Circuit Breaker 차단    |
| G11-5 병행검증   | 기존 Provider와 동일 사건 비교                      | 중복·충돌이 자동 덮어쓰기 없이 표시                   | 우선순위 승격 금지      |

### 4.6 데이터·보안·운영 영향

- DB에는 provider_raw_payload 또는 Object Store 참조를 보존하고, SituationFact에는 원문 hash와 parserVersion을 기록한다.

- 외부 URL fetch는 allowlist, TLS, Timeout, 응답크기 제한, Content-Type 검사를 적용한다.

- Provider별 TTL은 category 정책으로 관리한다. WEATHER_OBSERVATION과 DISASTER_MESSAGE를 동일한 freshness 기준으로 처리하지 않는다.

- 동일 incident/context에서 collect 요청은 idempotencyKey로 중복 적재를 방지한다.

- 관리화면은 마지막 성공시각, 최근 오류, Circuit 상태, 캐시 사용 여부를 제공한다.

### 4.7 완료·인수 기준

- 외부 Provider 전부를 비활성화한 상태에서 사용자 입력만으로 SituationSnapshot을 확정할 수 있다.

- Mock T3Q Adapter를 포함해 Provider 교체 시 UI와 SituationContext Schema 변경이 없다.

- 동일 Fact의 중복·상충 응답을 원본별로 보존하고 사용자 선택 이력을 감사로그로 재현한다.

- Timeout/5xx/Schema 오류 발생 시 ProviderStatus만 변경되고 기존 상황관리 기능이 지속된다.

### 4.8 재검토 Trigger

T3Q가 현재 재난상황정보 API의 운영 명세와 샘플을 제공하거나, 주관기관이 T3Q API 사용을 의무화한 경우 ADR-11 자체를 폐기하지 않고 “T3Q_SITUATION Adapter 활성화 및 우선순위” 신규 ADR을 작성한다.

# 5. ADR-12 상황일지 생성 주체와 T3Q RPT-003 적용 정책

ADR-12. 상황일지는 UNE JournalProjection Engine이 생성하고 T3Q RPT-003은 선택적 보조 Adapter로 한정

| **상태**     | ACCEPTED-CONDITIONAL  | **대응 OPEN**   | OPEN-02                         |
|--------------|-----------------------|-----------------|---------------------------------|
| **결정일**   | 2026.07.26            | **적용 기준선** | 통합설계 v0.9 이후              |
| **결정권자** | UNE 연구기획/아키텍처 | **재검토 방식** | Trigger 발생 시 신규 ADR로 개정 |

### 5.1 배경과 문제

T3Q API-RPT-003은 일일상황일지 생성 후보이나 초기 POC 적용 여부와 응답 구조가 확정되지 않았다. 상황일지는 실제 대응이력을 기록하는 공식성 높은 문서이므로 LLM이 사실을 보충하거나 실행되지 않은 조치를 작성하면 안 된다. 또한 SOP 실행상태는 UNE Workflow/Execution Log가 소유하므로 외부 API가 전체 일지를 독립 생성하면 사실원장과 문서가 분리된다.

### 5.2 확정 결정

- UNE JournalProjection Engine을 상황일지의 기준 생성기로 확정한다. 입력은 확정 SituationSnapshot, Execution Log, 승인된 사용자 Field Report, 문서 Template Profile이다.

- JournalProjection은 시간순·조직별·임무별로 사실을 투영하는 결정론적 단계와, 문장을 행정문서 형식으로 다듬는 선택적 AI 단계로 분리한다.

- T3Q RPT-003은 초기 POC의 필수 의존성이 아니다. 향후 JournalProviderPort 구현체로 연결하되 사실원장을 직접 수정하거나 Execution Event를 새로 만들 수 없다.

- UNI /chat 또는 T3Q RPT-003의 AI 출력은 factIds/eventIds가 바인딩된 범위에서 요약·표현 변환만 허용한다. 근거 없는 날짜·수치·인명·조치·피해를 추가하면 Validator가 거부한다.

- 외부 AI가 중단되어도 고정 템플릿과 Projection 규칙으로 최소 상황일지를 생성하고 사용자가 rhwp Editor에서 보완할 수 있어야 한다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/03_ADR_v1.1/media/image10.png" style="width:6.22047in;height:1.89524in" />

그림 5-1. 상황일지 생성의 사실원장·Projection·AI 경계

### 5.3 JournalProjection 데이터 규칙

| **객체**        | **필수 참조**                                               | **생성 규칙**                                                    | **불변성**               |
|-----------------|-------------------------------------------------------------|------------------------------------------------------------------|--------------------------|
| JournalDocument | snapshotId, projectionCutoff, templateId, revision          | 특정 시점까지의 사실과 실행이력을 문서로 투영                    | 새 생성 시 revision 증가 |
| JournalEntry    | entryId, occurredAt, eventIds/factIds, organization, taskId | 시간순 정렬, 동일 사건은 groupKey로 묶음                         | 원천 참조 변경 금지      |
| JournalSection  | sectionRole, entries, styleRole                             | 상황개요/기상/피해/통제/조치/기관동향 등 Template Profile에 매핑 | 구조 변경은 ChangeSet    |
| NarrativeDraft  | sourceEntryIds, generatedText, provider, validation         | AI 문장화 결과                                                   | 승인 전 PREVIEW          |
| JournalApproval | approver, approvedAt, documentHash                          | 최종 HWPX와 검증결과 승인                                        | 승인 후 불변             |

### 5.4 외부 일지 Provider 비교 Gate

| **평가항목** | **UNE 기준**                         | **RPT-003 합격 조건**                      | **증거**              |
|--------------|--------------------------------------|--------------------------------------------|-----------------------|
| 사실성       | AI 허위 Fact 0                       | 모든 문장 또는 표 셀이 sourceRefs로 역추적 | 자동 Validator 보고서 |
| Schema       | JournalDocument/Section/Entry와 매핑 | 미매핑 핵심필드 0, 확장필드는 raw 보존     | Contract test         |
| 부분결과     | Section 단위 생성·재시도             | 완료 Section 보존, 실패 Section 식별       | 장애주입 E2E          |
| 편집         | Block/Section ChangeSet              | 안정 ID 유지, 사용자 수정 보호             | Diff/Undo 시험        |
| 운영         | Timeout/취소/재시도                  | UNE Job 상태와 오류 taxonomy 매핑          | 로그·메트릭           |
| 품질         | 행정문서 문체·표 구성                | 실무자 평가 + 규칙검증                     | 비교평가표            |

### 5.5 실패·복구 정책

- AI Provider Timeout 시 해당 NarrativeDraft만 FAILED로 표시하고 JournalEntry와 이미 편집한 Block은 유지한다.

- 재생성은 동일 sourceEntryIds와 baseRevision을 사용하며 사용자 수정 Block을 자동 덮어쓰지 않는다.

- projectionCutoff 이후 발생한 Execution Event는 기존 승인 일지를 수정하지 않고 다음 revision 또는 후속 일지에 반영한다.

- 승인된 일지를 수정할 때는 원본 승인본을 보존하고 정정사유·정정자·정정시각을 기록한다.

### 5.6 완료·인수 기준

- UNI/T3Q 연결 없이 Snapshot+Execution Log만으로 시간순 상황일지 HWPX 초안을 생성한다.

- AI 문장화 결과의 모든 문장에 sourceEntryIds가 연결되고 허위 Fact 검증 오류가 0건이다.

- RPT-003 Mock Adapter를 켜고 끄더라도 Journal DB와 화면 흐름이 동일하다.

- 일지 생성 시점 이후 실행이력 추가가 기존 승인본의 hash를 변경하지 않는다.

### 5.7 재검토 Trigger

T3Q RPT-003의 구조화 응답·근거·Job/Error 계약이 제공되고 비교 Gate를 통과한 경우, 기본 Narrative Provider를 T3Q로 변경할 수 있다. 단 JournalProjection과 사실원장 소유권은 UNE에 유지한다.

# 6. ADR-13 UNI compns와 UNE SOP Schema 변환 경계

ADR-13. UNI compns 스트림은 UniSopMapper Anti-Corruption Layer에서 버전별로 변환

| **상태**     | ACCEPTED              | **대응 OPEN**   | OPEN-03                         |
|--------------|-----------------------|-----------------|---------------------------------|
| **결정일**   | 2026.07.26            | **적용 기준선** | 통합설계 v0.9 이후              |
| **결정권자** | UNE 연구기획/아키텍처 | **재검토 방식** | Trigger 발생 시 신규 ADR로 개정 |

### 6.1 배경과 문제

UNI /chat/json은 compns 요소 단위 SSE를 제공하므로 SOP 노드를 수신 즉시 화면에 표현할 수 있다. 그러나 compnSn, type, name, task, branch, source 등 실제 필드가 UNE의 SopNode, TaskDefinition, DecisionExpression, EvidenceRef와 완전히 일치한다는 보장이 없다. Provider 원시 구조를 Canvas와 DB에 직접 저장하면 UNI 변경이 곧 도메인 변경이 된다.

### 6.2 확정 결정

- UNI 원시 응답을 UniRawCompn으로 먼저 역직렬화하고, UniSopMapper가 UNE SopNode로 변환한다. 외부 필드명은 도메인 객체에 노출하지 않는다.

- Mapper는 providerSchemaVersion과 mappingProfileVersion을 별도 관리한다. 실제 응답이 달라지면 도메인 Schema를 변경하기 전에 Mapping Profile을 추가한다.

- SSE 수신 중에는 임시 Graph에 노드를 누적하고 Incremental Validator로 nodeId, sequence, branch target, duplicate를 검사한다. \_\_done\_\_ 이후 전체 DAG, 시작/종료, 분기, 고립노드, 순환정책을 최종 검증한다.

- 미지원 type은 UNKNOWN_PROVIDER_NODE로 보존하고 원문 rawPayloadRef와 warning을 저장한다. 자동으로 일반 Task로 추정하지 않는다.

- 최종 검증 통과 전 SOP는 PREVIEW/DRAFT 상태이며 실행·전파할 수 없다. 사용자가 수정하고 승인한 후 PUBLISHED/ACTIVE로 전환한다.

### 6.3 변환 규칙 기준선

| **UNI 후보 필드** | **UNE 대상**       | **변환 규칙**                                                 | **누락/오류 처리**                      |
|-------------------|--------------------|---------------------------------------------------------------|-----------------------------------------|
| compnSn           | nodeId/sequence    | providerMessageId + compnSn으로 안정 ID 생성, sequence 정수화 | 중복 시 suffix 금지, 오류로 격리        |
| type              | SopNode.type       | 허용 enum 매핑표 사용                                         | UNKNOWN_PROVIDER_NODE + warning         |
| name              | SopNode.name       | trim/길이검증, 원문 별도 보존                                 | 빈 값이면 사용자 확인 필요              |
| task              | TaskDefinition\[\] | 문자열/배열을 정규화하고 담당·완료조건 분리                   | 원문 taskText 보존                      |
| branch            | DecisionEdge\[\]   | 조건식과 target 참조 분리                                     | target 미존재 시 DRAFT 저장만 허용      |
| source            | EvidenceRef\[\]    | doc_id/chunk/page/score/sourceUrl 매핑                        | 근거 누락 warning, 실행승인 정책에 반영 |
| unknown fields    | providerExtensions | JSON Pointer와 raw value 보존                                 | 삭제 금지                               |

### 6.4 SSE 상태기계

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>CONNECTING -&gt; STREAMING -&gt; VALIDATING -&gt; DRAFT_READY<br />
| | |<br />
v v v<br />
CONNECT_FAIL STREAM_FAIL VALIDATION_FAILED<br />
<br />
Rules:<br />
- compn event: UniRawCompn 저장 -&gt; map -&gt; incremental validate -&gt; preview emit<br />
- done event: 전체 graph validate -&gt; SOP DRAFT transaction commit<br />
- error/disconnect: 수신된 raw event와 preview는 보존, 실행 금지<br />
- resume: generationId + lastEventId 지원 시 재개, 미지원 시 새 generation으로 재요청</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

### 6.5 보안·감사

- 인증 없는 B2B SSE Endpoint는 브라우저에서 직접 호출하지 않고 UNE Gateway가 서버측으로 대리한다.

- Gateway는 허용 model_key, top_k, 요청크기, Timeout, 동시 Job 수를 제한한다.

- 원시 응답에는 개인정보 또는 문서 원문이 포함될 수 있으므로 암호화 저장, TTL, 접근권한, 다운로드 금지 정책을 적용한다.

- 생성 요청, EvidenceSet, mappingProfileVersion, raw event hash, 최종 SOP hash를 감사로그에 연결한다.

### 6.6 완료·인수 기준

- 정상·누락필드·미지원 type·깨진 branch·중복 sequence 샘플을 포함한 Contract Test를 통과한다.

- SSE 중간노드가 UI에 표시되지만 최종 검증 전 실행 버튼은 비활성화된다.

- UNI 필드 추가 시 UNE 도메인 migration 없이 providerExtensions에 보존된다.

- Mapper 버전이 다른 동일 raw payload의 변환 결과를 재현할 수 있다.

### 6.7 재검토 Trigger

UNI가 정식 버전 Schema/OpenAPI와 안정적인 event type을 확정하면 Mapping Profile을 신규 버전으로 추가한다. UNE SopNode의 의미 자체가 부족한 경우에만 별도 Domain ADR을 작성한다.

# 7. ADR-14 국민안전24·Naver 보조수집 운영정책

ADR-14. 웹 보조수집은 공식 API 대체가 아닌 on-demand·Feature Flag 기반 보조 Provider로 제한

| **상태**     | ACCEPTED-CONDITIONAL  | **대응 OPEN**   | OPEN-04                         |
|--------------|-----------------------|-----------------|---------------------------------|
| **결정일**   | 2026.07.26            | **적용 기준선** | 통합설계 v0.9 이후              |
| **결정권자** | UNE 연구기획/아키텍처 | **재검토 방식** | Trigger 발생 시 신규 ADR로 개정 |

### 7.1 배경과 문제

국민안전24와 Naver Weather Safety 등 웹 화면은 공식 API가 없거나 사용 가능한 데이터가 제한될 때 상황정보 후보를 보완할 수 있다. 그러나 DOM 변경, 이용조건, robots 정책, 트래픽, 출처 재현성, 데이터 신뢰성 문제가 있어 무제한 주기 크롤러로 운영하면 기술·운영·정책 리스크가 커진다.

### 7.2 확정 결정

- 공식 OpenAPI(KMA/MOIS)를 P0 Provider로 사용하고 웹 수집은 P1/P2 보조 Provider로만 사용한다.

- SafeKorea는 사용자가 현재상황 불러오기를 요청하거나 운영자가 명시한 최소 주기에만 서버측 on-demand 수집한다. 무제한 상시 크롤링은 구현하지 않는다.

- Naver 관련 수집은 사용자 요청형 URL Import 또는 명시적 1회 조회로 제한한다. 운영환경의 자동 스케줄 수집은 기본 금지한다.

- 운영 Feature Flag 기본값은 OFF로 하며, 승인된 도메인·경로·수집항목·최소주기·보관기간이 등록된 경우에만 활성화한다.

- robots 또는 기술적 접근제한을 우회하지 않는다. 접근이 허용되지 않거나 Parser 신뢰도가 낮으면 원문 링크와 사용자 직접입력으로 fallback한다.

- 수집된 값은 자동 확정하지 않고 sourceUrl, retrievedAt, sourceHash, parserVersion, DOM fingerprint를 가진 SituationFact 후보로 제공한다.

### 7.3 Provider별 기본 정책

| **Provider**         | **운영 우선순위** | **기본 상태**          | **수집방식**                      | **캐시/주기**                | **실패 시**      |
|----------------------|-------------------|------------------------|-----------------------------------|------------------------------|------------------|
| KMA_FORECAST/WARNING | P0                | ON                     | 공식 OpenAPI                      | API 정책+category TTL        | 사용자 입력      |
| MOIS_MESSAGE         | P0                | ON 가능 시             | 공식 OpenAPI                      | API 정책+중복제거            | 사용자 입력/링크 |
| SAFEKOREA_WEB        | P1                | POC ON, 운영 승인 필요 | 서버측 on-demand DOM Parser       | Cache, 최소주기, fingerprint | 원문 링크+수동   |
| NAVER_WEATHER_SAFETY | P2                | OFF                    | 사용자 요청형 URL Import/1회 조회 | 짧은 TTL, 스케줄 금지        | 수동 입력        |

### 7.4 운영승인 Gate

| **Gate**     | **검토내용**                                                     | **승인 주체**       | **미승인 상태**           |
|--------------|------------------------------------------------------------------|---------------------|---------------------------|
| G14-1 정책   | 서비스 이용조건, robots, 공개범위, 재배포 가능성                 | 사업/법무/보안 담당 | Feature Flag OFF          |
| G14-2 기술   | allowlist, TLS, timeout, 크기제한, parser test, DOM change alert | 개발/보안           | POC 격리                  |
| G14-3 데이터 | 수집필드 최소화, 개인정보 여부, 보관기간, 원문 삭제 정책         | 데이터 책임자       | 저장 금지 또는 단기 cache |
| G14-4 운영   | 최소주기, 동시요청, 장애알림, 연락창구                           | 운영책임자          | 수동 링크 제공            |

### 7.5 DOM 변경 대응

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>fetch -&gt; validate response -&gt; fingerprint DOM -&gt; select parserVersion<br />
-&gt; parse -&gt; field validation -&gt; SituationFact candidate -&gt; cache<br />
<br />
If selector failure rate &gt; threshold OR fingerprint changes:<br />
providerStatus = DEGRADED<br />
stop automatic parse for affected route<br />
preserve raw hash / response metadata<br />
show original link + manual input<br />
create parser change alert</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

### 7.6 완료·인수 기준

- Feature Flag OFF에서 네트워크 요청이 발생하지 않고 사용자 입력 흐름이 정상 작동한다.

- DOM selector 변경을 주입하면 자동수집을 중단하고 사용자에게 오류·원문링크·수동입력을 제공한다.

- 동일 원문은 sourceHash와 TTL로 중복저장되지 않는다.

- Naver Provider는 스케줄러에서 호출되지 않으며 사용자 요청 audit가 남는다.

### 7.7 재검토 Trigger

공식 API가 제공되거나 이용조건·정책이 변경되면 웹 Adapter 우선순위를 낮추거나 제거한다. 운영 자동수집 확대는 별도 ADR과 승인 Gate를 요구한다.

# 8. ADR-15 rhwp 소스 반입·내부 형상관리·라이선스·미지원 객체 정책

ADR-15. rhwp의 특정 Tag/Commit 소스 아카이브를 다운로드하여 UNE 내부 저장소에 반입하고 보존형 Adapter/Serializer와 호환성 검증을 필수화

| **상태**     | ACCEPTED-CONDITIONAL  | **대응 OPEN**   | OPEN-05                         |
|--------------|-----------------------|-----------------|---------------------------------|
| **결정일**   | 2026.07.26            | **적용 기준선** | 통합설계 v0.9 이후              |
| **결정권자** | UNE 연구기획/아키텍처 | **재검토 방식** | Trigger 발생 시 신규 ADR로 개정 |

### 8.1 검토 근거

rhwp 저장소는 Rust+WebAssembly 기반 HWP/HWPX 뷰어·에디터로 공개되어 있고, HWPX 파싱·렌더링·웹 에디터·저장 기능을 제공한다. 라이선스는 MIT이며 저작권·허가 고지를 포함하는 조건으로 사용·수정·배포가 가능하다. 동시에 저장소 로드맵은 현재 계열을 읽기/쓰기 기반과 조판 엔진을 체계화하는 단계로 설명하고 있어, 한컴과 동일한 완성도를 전제로 직접 제품화하는 것이 아니라 UNE의 보존형 문서엔진 계층과 Round-trip 검증을 결합해야 한다.

### 8.2 고려한 대안

| **대안**                                      | **설명**                                                      | **평가**                                              | **결론** |
|-----------------------------------------------|---------------------------------------------------------------|-------------------------------------------------------|----------|
| A. rhwp 원본 패키지 그대로 사용               | npm/WASM API만 호출                                           | 빠르지만 업스트림 변경·미지원 객체·저장손실 통제 부족 | 기각     |
| B. HWPX XML 엔진 전면 자체개발                | 모든 Parser/Renderer/Editor 구현                              | 통제력은 높으나 일정·품질·조판 난이도 과대            | 기각     |
| C. pinned rhwp source + UNE 내부 반입/Adapter | 검증된 Core를 고정하고 IR/Prototype/Serializer/Validator 확장 | 일정과 통제력 균형, 유지보수 체계 필요                | 채택     |

### 8.3 확정 결정

- 운영 빌드는 floating main 또는 latest 패키지를 사용하지 않는다. POC Gate를 통과한 tag/commit과 @rhwp/core/@rhwp/editor 버전을 잠그고 SBOM에 기록한다.

- POC Gate를 통과한 특정 Tag 또는 Commit의 소스 아카이브를 다운로드하고 SHA-256을 검증한 후 UNE 내부 Git 저장소의 third_party/rhwp 영역에 반입한다. 원본 반입본과 UNE 자체 모듈을 분리하며 변경은 une/\* Adapter, patch queue, 내부 변경 branch로 구분하고 변경사유·영향 파일·시험결과·upstream issue/PR을 추적한다.

- rhwp Core는 Parser/Renderer/Editor 기반으로 사용하고, TemplateAnalyzer, OutlinePatternAnalyzer, ParagraphPrototypeRegistry, SelectionResolver, ChangeSetExecutor, 보존형 HWPX Serializer, RoundTripValidator는 UNE 소유 계층으로 유지한다.

- MIT LICENSE와 THIRD_PARTY_LICENSES 고지를 배포물·설치패키지·소스 배포 기준에 포함한다. 한컴/Microsoft 등 재배포가 제한되는 폰트 파일은 제품에 임의 포함하지 않고 기관 보유 폰트 또는 재배포 가능한 fallback을 사용한다.

- HWP binary는 참조·열람 가능성을 별도 평가하되 3차년도 핵심 편집·저장 포맷은 HWPX로 한정한다. HWP를 HWPX로 변환하는 과정이 필요하면 원본보존과 변환본 구분을 명시한다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/03_ADR_v1.1/media/image11.png" style="width:6.22047in;height:1.89524in" />

그림 8-1. rhwp Core와 UNE 보존형 문서엔진 및 한컴 검증 경계

### 8.4 객체 호환성 등급

| **등급**            | **의미**                                               | **편집 허용**        | **저장 정책**                       | **사용자 표시**  |
|---------------------|--------------------------------------------------------|----------------------|-------------------------------------|------------------|
| NATIVE_EDIT         | 파싱·렌더·편집·재저장 검증 완료                        | 전체 허용            | 변경 Part 최소저장                  | 정상             |
| PRESERVE_ONLY       | Core가 완전 편집하지 못하지만 raw fragment 보존 가능   | 주변 지원영역만 허용 | 해당 객체 원문 복사, 삭제/이동 제한 | 제한 아이콘·설명 |
| FLATTEN_EXPORT_ONLY | 원본 구조 편집은 불가하나 별도 사본의 시각 Export 가능 | 원본 편집 금지       | 원본 HWPX 저장 금지, PDF 등 사본만  | Export 전용      |
| REJECT              | 필수 Part/참조 깨짐 또는 손실 위험                     | 열기/편집 거부       | 원본 보존, 오류보고                 | 업로드 거부      |

### 8.5 소스 반입·업스트림 관리

| **항목**      | **규칙**                                                                    |
|---------------|-----------------------------------------------------------------------------|
| 버전 고정     | Cargo.lock/package-lock과 Git commit SHA를 동결하고 빌드 산출물에 기록      |
| 업데이트 주기 | 월 1회 또는 보안/치명버그 발생 시 upstream diff 검토. 자동 merge 금지       |
| 패치 분류     | 보안패치, 호환성패치, 기능확장, UNE Adapter로 분류하고 회귀시험 범위를 연결 |
| 라이선스      | LICENSE/THIRD_PARTY_LICENSES/SBOM을 Release artifact에 포함                 |
| 보안          | Dependency audit, 악성 ZIP/XML, WASM 공급망, npm/cargo checksum 검증        |
| 기여          | 범용 수정은 upstream PR 우선 검토, 과제 고유 도메인 로직은 UNE 계층 유지    |

### 8.6 엔진 POC Gate

| **Gate**       | **시험대상**                                        | **합격 기준**                                                      |
|----------------|-----------------------------------------------------|--------------------------------------------------------------------|
| G15-1 분석     | 임의 HWPX 10종 이상                                 | AUTO/CONFIRM/LIMITED/REJECT 판정과 근거 재현                       |
| G15-2 양식상속 | 타깃 샘플 3종                                       | 기호 앞 공백, 들여쓰기, ParaShape, CharShape, 번호, 표 스타일 유지 |
| G15-3 편집     | Cursor/Range/Block/Section, Enter/Tab/Shift+Tab, 표 | 안정 ID, Undo/Redo, 사용자 잠금 보호                               |
| G15-4 저장     | 원본→편집→저장→재열기                               | dangling reference 0, 미지원 객체 무손실                           |
| G15-5 성능     | 일반 50쪽                                           | 분석 P95 5초 목표, 편집 적용 P95 300ms 목표(LLM 제외)              |
| G15-6 라이선스 | 배포 bundle                                         | MIT/Third-party 고지, 금지 폰트 미포함, SBOM 생성                  |

### 8.7 완료·인수 기준

- 고정 tag/commit, 소스 아카이브 SHA-256, UNE 내부 기준 branch, patch 목록, SBOM, LICENSE bundle이 재현 가능한 빌드에 포함된다.

- 미지원 객체가 있는 문서에서 주변 문단만 수정한 후 객체 XML/relationship/hash가 보존된다.

- 손실 가능성이 있는 문서는 경고만 표시하고 저장하는 것이 아니라 등급에 따라 저장을 차단한다.

- 업스트림 업데이트 전후 Golden Corpus 회귀결과를 비교하고 승인 전 운영 버전을 변경하지 않는다.

### 8.8 재검토 Trigger

rhwp 주요버전 변경, 라이선스 변경, 핵심 Serializer 구조 변경, 타깃 HWPX에서 치명 손실 발견, 공공 배포정책 변경 중 하나가 발생하면 신규 ADR로 버전 전환 여부를 결정한다.

# 9. ADR-16 한컴 HWPX 호환성 Round-trip 검증 및 배포 승인 기준

ADR-16. CI 자동검증과 Windows 한컴 HWPX 호환성 Round-trip 검증을 분리하되 배포 승인에는 둘 다 필수 적용

| **상태**     | ACCEPTED              | **대응 OPEN**   | OPEN-06                         |
|--------------|-----------------------|-----------------|---------------------------------|
| **결정일**   | 2026.07.26            | **적용 기준선** | 통합설계 v0.9 이후              |
| **결정권자** | UNE 연구기획/아키텍처 | **재검토 방식** | Trigger 발생 시 신규 ADR로 개정 |

### 9.1 배경과 문제

HWPX ZIP/XML 무결성과 rhwp 화면이 정상이어도 한컴오피스에서 열기·저장·재열기 시 레이아웃, 번호, 표, 필드, 객체가 달라질 수 있다. 반대로 모든 개발 commit을 한컴 GUI로 시험하면 자동화 비용과 실행환경 제약이 크다. 따라서 빠른 CI와 최종 호환성 배포 승인 시험를 분리해야 한다.

### 9.2 확정 결정

- Track A(상시 CI)는 Linux/Container에서 Package, XML, Schema, Reference, Semantic, rhwp Visual Diff, 편집 E2E를 수행한다.

- Track B(Hancom Round-trip)는 고정된 Windows 시험환경과 정식 사용권이 있는 한컴오피스에서 열기→저장→종료→재열기→비교를 수행한다.

한컴 Round-trip은 사용자가 문서를 저장할 때마다 서버에서 한컴오피스를 실행하는 운영 기능이 아니다. 일반 저장 요청은 UNE 자동검증으로 처리하고, 한컴 열기·저장·재열기 검증은 Serializer·Adapter·양식지원 변경 및 Release Candidate 생성 시 수행하는 개발·QA·배포 승인 절차로 한정한다.

- 개발 초기에는 Track B를 수동+반자동으로 운용하고, 안정화 후 Windows Agent/UI Automation 또는 허용된 자동화 인터페이스로 반복 수행한다. 자동화 도구의 채택 여부가 품질 승인 기준 자체를 변경하지 않는다.

- 최종 Release Candidate, 문서엔진 버전 변경, Serializer 변경, Golden Corpus 변경 시 Track B를 의무 수행한다.

- 한컴 자동화가 일시 불가능하면 Release를 자동 승인하지 않는다. 수동 시험증거로 대체하거나 Release를 보류한다.

### 9.3 시험환경 기준

| **구분**      | **고정 항목**                                                            | **관리방식**                     |
|---------------|--------------------------------------------------------------------------|----------------------------------|
| Windows Agent | OS 버전/locale/화면배율/해상도/시간대                                    | 환경정보 JSON과 VM snapshot      |
| 한컴오피스    | 제품·build·패치·설정                                                     | 버전 고정, 변경 시 기준선 재시험 |
| 폰트          | 기관 보유폰트/공개 fallback/대체규칙                                     | 폰트 manifest와 hash             |
| Golden Corpus | 최소양식, 완성문서, 문자개요, 자동번호, 표/병합, 이미지/수식/미지원 객체 | 문서별 기대결과·허용영역 mask    |
| 증거          | 원본/결과/한컴재저장본, screenshot, log, hash, ValidationReport          | 시험실행 ID로 묶어 보관          |

### 9.4 Round-trip Matrix

| **ID** | **경로**                                                         | **핵심 검증**                  |
|--------|------------------------------------------------------------------|--------------------------------|
| RT-A   | 원본 → rhwp open → save → 한컴 open                              | 무편집 저장의 무손실           |
| RT-B   | 원본 → Analyze → AI insert → save → 한컴 open/save → rhwp reopen | Prototype 상속·양방향 호환     |
| RT-C   | 표/병합셀 수정 → save → reopen                                   | span, border, width, cell text |
| RT-D   | 문자형 개요 Enter/Tab/Shift+Tab → save → reopen                  | literalPrefix, 공백, indent    |
| RT-E   | 자동번호 개요 추가/삭제 → save → reopen                          | numbering reference, level     |
| RT-F   | 미지원 객체 문서 → 주변 문단 수정 → save                         | 원문 객체/relationship 보존    |
| RT-G   | 사용자 수정 Block + Section AI 재생성                            | 잠금 영역 불변, Diff 정확성    |

### 9.5 합격 기준과 허용영역

- Package 치명오류 0, dangling reference 0, 의도치 않은 문단·표·텍스트·필드 손실 0을 요구한다.

- Visual Diff는 픽셀 완전일치가 아니라 변경 대상 Block의 허용영역 mask를 적용한다. 허용영역 밖의 페이지 이동, 글꼴 대체, 표 폭 변경은 회귀로 판정한다.

- 한컴에서 경고창, 복구모드, 파일손상 안내가 발생하면 즉시 실패다.

- 차이가 한컴 버전 특성인지 Serializer 회귀인지 분리하기 위해 원본의 한컴 open/save baseline을 함께 보관한다.

### 9.6 완료·인수 기준

- CI와 Windows 시험을 동일 testRunId와 문서 hash로 연결한다.

- Release Candidate의 Golden Corpus 전 항목에서 치명 손실 0건이다.

- 한컴 버전·폰트·환경이 바뀌면 baseline을 자동 재사용하지 않고 재승인한다.

- 실패 문서는 source/output/hancom-resave/diff/report를 묶어 개발자가 재현할 수 있다.

### 9.7 재검토 Trigger

한컴오피스 공식 자동화 인터페이스가 제공되거나 시험환경 운영정책이 변경되면 자동화 방식은 개정할 수 있으나, 배포 승인 기준에서 한컴 Round-trip을 제거하려면 별도 ADR이 필요하다.

# 10. ADR-17 문자·메일·방송 전파 모듈 경계

ADR-17. 전파는 ChannelPort와 Transactional Outbox로 구현하고 외부 채널 미제공 시 System/Simulation Adapter로 검증

| **상태**     | ACCEPTED-CONDITIONAL  | **대응 OPEN**   | OPEN-07                         |
|--------------|-----------------------|-----------------|---------------------------------|
| **결정일**   | 2026.07.26            | **적용 기준선** | 통합설계 v0.9 이후              |
| **결정권자** | UNE 연구기획/아키텍처 | **재검토 방식** | Trigger 발생 시 신규 ADR로 개정 |

### 10.1 배경과 문제

안전한국훈련 시나리오는 SOP 임무를 조직·담당자에게 전파하고 수신확인·착수·완료를 기록해야 한다. 그러나 문자, 메일, 방송의 실제 소스코드·Gateway·인증·회신 방식은 확정되지 않았다. 채널별 SDK를 Workflow에 직접 연결하면 외부 소스 제공 전 개발이 중단되고, 전송 성공과 업무상태가 불일치할 수 있다.

### 10.2 확정 결정

- UNE Workflow는 PropagationCommand를 생성하고 Transactional Outbox에 Execution Event와 동일 트랜잭션으로 저장한다.

- ChannelDispatcher가 Outbox를 읽어 ChannelPort 구현체로 전달한다. Workflow/SOP 도메인은 SMS, SMTP, 방송장비 SDK를 직접 호출하지 않는다.

- POC 필수 채널은 SYSTEM_NOTIFICATION과 TRAINING_SIMULATION으로 한다. 실제 문자·메일·방송 소스가 없어도 전파→수신→착수→완료 E2E를 검증할 수 있다.

- EMAIL/SMS/BROADCAST Adapter는 계약과 Stub을 선행 구현하고 인증정보가 제공된 채널만 활성화한다. Simulation 전송은 UI와 로그에 “훈련/모의”를 명확히 표시한다.

- 전송 성공은 임무 완료가 아니다. SENT/DELIVERED/ACKNOWLEDGED/STARTED/COMPLETED 상태를 분리하고 Execution Log에 시간순 기록한다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/03_ADR_v1.1/media/image12.png" style="width:6.22047in;height:1.89524in" />

그림 10-1. 전파 명령·Outbox·채널 Adapter·수신상태 구조

### 10.3 ChannelPort 계약

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>interface ChannelPort {<br />
ChannelType type();<br />
ChannelCapabilities capabilities();<br />
SendResult send(PropagationEnvelope envelope);<br />
ReceiptResult pollOrReceive(ReceiptQuery query);<br />
}<br />
<br />
PropagationEnvelope {<br />
propagationId, incidentId, sopInstanceId, taskInstanceId,<br />
recipients[], subject, body, attachments[], priority,<br />
expiresAt, idempotencyKey, mode{REAL|TRAINING|SIMULATION}<br />
}</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

### 10.4 전파 상태기계

| **상태**     | **의미**                | **전이 주체**   | **실패 처리**                              |
|--------------|-------------------------|-----------------|--------------------------------------------|
| CREATED      | Workflow 명령 생성      | UNE Workflow    | Outbox 저장 실패 시 업무 트랜잭션 rollback |
| QUEUED       | Outbox 대기             | Dispatcher      | 지연 메트릭                                |
| SENDING      | Adapter 호출 중         | Channel Adapter | Timeout → RETRY_WAIT                       |
| SENT         | Provider 접수           | Adapter         | delivery 미확정                            |
| DELIVERED    | 단말/메일함/시스템 전달 | Receipt Adapter | 미지원 채널은 UNKNOWN                      |
| ACKNOWLEDGED | 수신자가 확인           | 사용자/Receipt  | 기한초과 Escalation                        |
| STARTED      | 임무 착수               | 담당자          | 재전파/대체담당                            |
| COMPLETED    | 임무 완료               | 담당자/승인자   | 완료증거 검증                              |
| FAILED/DEAD  | 재시도 소진             | Dispatcher      | DLQ·운영알림·수동재전파                    |

### 10.5 멱등·재시도·개인정보

- idempotencyKey는 taskInstanceId + recipient + channel + messageVersion으로 생성하여 재시도 중복발송을 방지한다.

- 재시도 횟수와 backoff는 채널별 정책으로 관리하고, 비재시도 오류(주소형식·권한·수신거부)는 즉시 FAILED로 분류한다.

- 수신자 전화번호·이메일은 암호화 저장하고 화면·로그에는 마스킹한다. 메시지 본문에 불필요한 개인정보를 포함하지 않는다.

- 첨부파일은 직접 공개 URL이 아니라 만료·권한이 있는 다운로드 토큰을 사용한다.

- 방송 채널은 단방향일 수 있으므로 DELIVERED/ACKNOWLEDGED 지원 여부를 capabilities로 표시한다.

### 10.6 외부 소스 활성화 Gate

| **Gate**       | **필수 계약**                                  | **시험**               |
|----------------|------------------------------------------------|------------------------|
| G17-1 연결     | Endpoint/SDK, 인증, IP/방화벽, 발신자, Sandbox | 연결·인증·Timeout      |
| G17-2 메시지   | 길이, 인코딩, 첨부, 템플릿, 금칙어             | 경계값·한글·첨부       |
| G17-3 수신상태 | 접수ID, delivery/ack callback, polling         | 중복 callback·순서역전 |
| G17-4 운영     | Rate Limit, 비용, 장애연락, 로그보관           | 부하·Circuit Breaker   |
| G17-5 보안     | Secret 보관, 개인정보, 감사, 권한              | Secret rotation·마스킹 |

### 10.7 완료·인수 기준

- System/Simulation Adapter만으로 SOP 승인→전파→수신→착수→완료→상황판→일지 E2E가 통과한다.

- 전송 Adapter 장애 시 Workflow와 Execution Log가 손실되지 않고 Outbox에서 재시도된다.

- 동일 idempotencyKey 재처리 시 중복 메시지가 발송되지 않는다.

- 실제 채널을 추가할 때 Workflow·DB 핵심 Entity 변경 없이 Adapter와 설정만 추가한다.

### 10.8 재검토 Trigger

문자·메일·방송 소스와 운영계약이 제공되면 채널별 활성화 ADR 또는 Change Request를 작성한다. 채널 통합 Gateway를 T3Q가 제공하더라도 UNE의 Outbox·상태·Execution Log 소유권은 유지한다.

# 11. ADR-18 실증기관 및 자연·사회재난 시나리오 기준

ADR-18. 기관 독립형 Scenario Pack을 개발하고 자연재난 태풍·호우, 사회재난 다중밀집건축물 붕괴를 기술 기준 시나리오로 사용

| **상태**     | ACCEPTED-CONDITIONAL  | **대응 OPEN**   | OPEN-08                         |
|--------------|-----------------------|-----------------|---------------------------------|
| **결정일**   | 2026.07.26            | **적용 기준선** | 통합설계 v0.9 이후              |
| **결정권자** | UNE 연구기획/아키텍처 | **재검토 방식** | Trigger 발생 시 신규 ADR로 개정 |

### 11.1 배경과 문제

과제는 자연재난 1종, 사회재난 1종을 지자체 1곳 이상과 공공기관 1곳 이상에서 실증하도록 요구하지만, 최종 기관·지역·조직·훈련계획은 협의 중이다. 기관 확정을 기다리면 사용자 시나리오, 화면, DB, API, 인수시험 작성을 진행할 수 없고, 특정 기관을 하드코딩하면 다른 수요처 적용이 어렵다.

### 11.2 확정 결정

- 업무·데이터·시험을 Scenario Template과 Institution Binding으로 분리한다. 시나리오에는 역할, 상황단계, Fact, SOP, 임무, 시간축, 기대 Execution Event를 정의하고 기관명·부서·담당자는 Config로 주입한다.

- 자연재난 기술 기준 시나리오는 태풍·호우로 한다. KMA 예보·특보, MOIS 재난문자, 지역·통제·피해·대응단계 등 SituationContext와 상황일지 기능을 폭넓게 검증할 수 있기 때문이다.

- 사회재난 기술 기준 시나리오는 다중밀집건축물 붕괴 대형사고로 한다. 다기관 임무전파, 현장보고, 구조·대피·통제, 분기 SOP, 수신·착수·완료, 전자상황판을 검증하기 적합하다.

- 위 두 기준 시나리오는 최종 실증 재난유형을 법적으로 확정하는 것이 아니라 개발·인수용 Reference Scenario다. 실증기관 협의 결과 다른 유형이 선택되면 Scenario Config와 콘텐츠를 교체하고 공통 엔진을 재사용한다.

- 기관·지역·조직을 코드와 화면 상수로 두지 않는다. InstitutionProfile, OrganizationUnit, RoleBinding, ContactPoint, LocationProfile, ProviderPolicy로 관리한다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/03_ADR_v1.1/media/image13.png" style="width:6.22047in;height:1.89524in" />

그림 11-1. 기준 시나리오와 실증기관 Binding 전략

### 11.3 Scenario Pack 구성

| **구성요소**        | **필수 내용**                                                  | **추적 대상**          |
|---------------------|----------------------------------------------------------------|------------------------|
| ScenarioDefinition  | scenarioId, disasterType, mode, objective, start/end condition | US/E2E                 |
| SituationTimeline   | 시각별 입력 Fact, 특보, 현장보고, 피해·통제 변화               | SituationFact/Snapshot |
| SopDefinition       | 노드, Task, Decision, 담당 Role, 완료조건, 증거                | SOP/Workflow           |
| OrganizationBinding | 기관, 부서, 역할, 담당자, 대체담당, 연락채널                   | RBAC/Propagation       |
| ExpectedExecution   | 예상 Event 순서·허용시간·분기·Escalation                       | Execution Log          |
| JournalExpectation  | 일지 Section, 필수 Entry, 근거, 문장규칙                       | Journal/E2E            |
| EvaluationRubric    | 성공률, 시간, 누락, 사실성, 문서품질, 만족도                   | 실증평가               |

### 11.4 기준 시나리오 범위

| **구분**    | **태풍·호우 자연재난**                            | **다중밀집건축물 붕괴 사회재난**                  |
|-------------|---------------------------------------------------|---------------------------------------------------|
| 핵심 Fact   | 예보·특보·강수·풍속·재난문자·침수/통제·피해       | 발생시각·위치·붕괴범위·인명·접근통제·현장보고     |
| SOP 분기    | 특보단계, 취약지역 예찰, 대피, 도로통제, 자원배치 | 추가붕괴 위험, 구조접근, 대피, 의료·교통·유관기관 |
| 전파 대상   | 재난안전부서, 읍면동, 시설담당, 유관기관          | 현장지휘, 소방·경찰·의료, 시설관리, 지자체, 홍보  |
| 상황일지    | 기상/특보/피해/통제/조치/기관동향 시간순          | 사고개요/구조·대피/인명·시설/통제/기관조치 시간순 |
| 검증 포인트 | 외부 Provider·freshness·충돌 Fact·주기보고        | 다기관 전파·수신확인·분기·완료증거·전자상황판     |

### 11.5 실증기관 Binding Gate

| **Gate**       | **기관 제공/확정사항**                   | **완료 기준**              |
|----------------|------------------------------------------|----------------------------|
| G18-1 수요처   | 지자체·공공기관, 담당자, 실증환경        | 협조공문/담당자/일정       |
| G18-2 재난유형 | 자연 1종·사회 1종 및 훈련목표            | ScenarioDefinition 동결    |
| G18-3 조직     | 부서·역할·연락망·승인체계                | RoleBinding 100%           |
| G18-4 자료     | 위기관리매뉴얼, 훈련계획, 양식, 과거일지 | EvidenceSet 학습/검증 완료 |
| G18-5 연계     | 외부 Provider, 채널, 보안/망, 계정       | Adapter/Stub 선택 완료     |
| G18-6 평가     | 참여자, 설문, 성공기준, 증거수집         | 인수·실증평가표 승인       |

### 11.6 완료·인수 기준

- 기관명과 담당자를 바꾸어도 동일 Scenario Pack으로 E2E를 실행할 수 있다.

- 태풍·호우와 붕괴 시나리오 각각에서 계획/자료→SOP 생성→승인→전파→수신→착수→완료→상황판→상황일지 흐름이 통과한다.

- 최종 실증유형 변경 시 공통 DB/API/화면을 수정하지 않고 Scenario/Evidence/Config만 변경한다.

- 실증기관 미확정 상태에서도 Mock Organization과 Simulation Channel로 개발·시험이 지속된다.

### 11.7 재검토 Trigger

행안부·수요처 협의로 최종 기관과 재난유형이 확정되면 ADR-18을 폐기하지 않고 Institution Binding 결과서와 실증 Scenario Baseline을 별도 동결한다. 공통 도메인 변경이 필요한 경우만 신규 ADR을 작성한다.

# 12. 공통 구현 Gate와 추적성

## 12.1 개발 단계 Gate

| **Gate**        | **목적**                      | **선행조건**     | **통과 산출물**                       | **실패 시**      |
|-----------------|-------------------------------|------------------|---------------------------------------|------------------|
| G0 기준선       | ADR과 Schema 동결             | ADR-11~18 승인   | ADR Register, Change Log              | WBS 착수 보류    |
| G1 Contract     | Port/Adapter/Domain 계약 검증 | Mock/샘플        | OpenAPI/JSON Schema/Contract Test     | Mapper/계약 수정 |
| G2 POC          | 핵심 기술 위험 제거           | G1               | HWPX POC, UNI SOP POC, Provider Mock  | 범위/대안 ADR    |
| G3 E2E          | 사용자 시나리오 종단 검증     | 화면/API/DB 연결 | US/E2E 결과, 로그, 증거               | 결함 backlog     |
| G4 Round-trip   | 문서 호환성                   | RC build         | 한컴 ValidationReport                 | Release 보류     |
| G5 실증 Binding | 기관·시나리오 확정            | 수요처 협의      | InstitutionProfile, Scenario Baseline | Simulation 유지  |
| G6 인수         | 성과·품질 증명                | 전 Gate          | 인수시험서, 실증평가표, 사용자 승인   | 보완 후 재시험   |

## 12.2 ADR별 개발 산출물 추적

| **ADR** | **주요 코드/설정**                          | **API/DB**                                 | **E2E/증거**                      |
|---------|---------------------------------------------|--------------------------------------------|-----------------------------------|
| ADR-11  | SituationProviderPort, adapters, circuit    | SituationFact, ProviderStatus, collect API | SIT-E2E-01~05, provider health    |
| ADR-12  | JournalProjection, JournalProviderPort      | JournalDocument/Entry, generation Job      | SIT-E2E-09, 허위Fact 0 보고서     |
| ADR-13  | UniSopMapper, SSE assembler                 | SopNode extensions, raw event store        | SIT-E2E-07, Contract tests        |
| ADR-14  | WebCollector, parser registry, flags        | cache/source/provenance                    | DOM change/fallback E2E           |
| ADR-15  | rhwp source intake, UNE Adapter, Serializer | Template/IR/ChangeSet/Validation           | HWPX matrix, SBOM                 |
| ADR-16  | CI suite, Windows runner                    | testRun/validation artifact                | RT-A~G, screenshots/hash          |
| ADR-17  | Outbox, dispatcher, ChannelPort             | Propagation/Receipt/ExecutionEvent         | SIT-E2E-08, retry/idempotency     |
| ADR-18  | Scenario loader, Institution binding        | Scenario/Org/Role Config                   | Natural/Social E2E, 실증 baseline |

## 12.3 오류코드와 메시지 원칙

| **영역**    | **코드 예시**             | **사용자 메시지 원칙**                                                           | **운영 로그**                                        |
|-------------|---------------------------|----------------------------------------------------------------------------------|------------------------------------------------------|
| Provider    | SIT-PROV-UNAVAILABLE      | “현재 외부정보를 불러오지 못했습니다. 직접 입력하거나 나중에 다시 시도하십시오.” | provider, endpoint, status, retryable, correlationId |
| UNI Mapper  | SOP-MAP-INVALID-BRANCH    | “생성된 절차의 분기 연결을 확인해 주십시오.”                                     | raw event ref, mapping version, node/target          |
| Web Parser  | SIT-WEB-DOM-CHANGED       | “보조 사이트 구조가 변경되어 자동수집을 중단했습니다.”                           | fingerprint, parserVersion, selector                 |
| HWPX        | HWPX-UNSUPPORTED-PRESERVE | “지원이 제한된 객체가 있어 해당 영역 편집이 제한됩니다.”                         | partPath, objectType, compatibility                  |
| Round-trip  | HWPX-RT-REGRESSION        | “한컴 호환성 검증에서 원본 외 영역 변경이 발견되었습니다.”                       | diff artifact, mask, build                           |
| Propagation | PROP-DELIVERY-FAILED      | “일부 수신자에게 전파하지 못했습니다. 재전파 또는 대체 채널을 선택하십시오.”     | recipient masked, adapter, attempt, providerId       |

## 12.4 권한 최소 기준

| **권한**           | **주요 행위**                               | **제한**                      |
|--------------------|---------------------------------------------|-------------------------------|
| DOCUMENT_EDITOR    | 계획서/일지 직접 편집, AI ChangeSet 요청    | 승인된 일지 원본 수정 불가    |
| SITUATION_EDITOR   | Fact 입력·후보 선택·수정                    | Snapshot 확정은 별도 권한     |
| SITUATION_APPROVER | Snapshot 확정·정정 승인                     | 원천 Fact 삭제 불가           |
| SOP_DESIGNER       | SOP DRAFT 편집                              | ACTIVE 실행 불가              |
| SOP_APPROVER       | SOP Publish/Activate                        | 자기 생성·자기 승인 분리 권고 |
| INCIDENT_COMMANDER | SOP 실행·전파·재전파·Escalation             | 채널 Secret 접근 불가         |
| TASK_ASSIGNEE      | 수신확인·착수·완료·증거제출                 | 타인 임무 변경 불가           |
| SYSTEM_ADMIN       | Provider/Channel/Feature Flag/Template 관리 | 문서 내용 임의 승인 불가      |
| AUDITOR            | 로그·버전·증거 조회                         | 편집·실행 불가                |

# 13. 기준문서 개정 및 개발계획서/WBS 입력사항

## 13.1 기준문서 개정 지시

| **문서**                  | **개정 위치**                             | **반영 내용**                                                          | **목표 버전**   |
|---------------------------|-------------------------------------------|------------------------------------------------------------------------|-----------------|
| 통합플랫폼 상세설계서     | 24.2 미결정·협의 필요사항                 | OPEN-01~08을 CLOSED-BY-ADR로 변경하고 ADR-11~18 링크                   | v1.0 또는 v0.10 |
| HWPX/rhwp Engine 명세     | 지원범위·성능·인수                        | pinned source intake, 객체등급, SBOM, Hancom Track B 배포 승인         | v1.1            |
| SituationContext/UNI 명세 | Provider/Mapper/전파                      | T3Q Adapter activation, Mapping Profile, Web Feature Flag, ChannelPort | v1.1            |
| Schema/OpenAPI Bundle     | Provider/Journal/SOP/Propagation/Scenario | 신규 Entity·enum·error schema                                          | v1.0            |
| 개발계획서/WBS            | 신규 작성                                 | ADR별 Work Package, Gate, 책임, 선행조건, 증거                         | v1.0            |
| 사용자 시나리오           | 신규 작성                                 | 계획서/상황일지/안전한국훈련 Actor·예외·인수기준                       | v1.0            |
| 화면설계/API/DB Sequence  | 후속 상세화                               | Scenario ID와 ADR 추적                                                 | v1.0            |

## 13.2 개발계획서/WBS에 반드시 포함할 Work Package

| **WP ID**         | **Work Package**                        | **주요 완료물**                            |
|-------------------|-----------------------------------------|--------------------------------------------|
| WP-ADR-BASE       | ADR/Schema 기준선 관리                  | ADR Register, Change control, traceability |
| WP-HWPX-CORE      | rhwp source intake/baseline/build       | pinned build, SBOM, adapter skeleton       |
| WP-HWPX-ANALYZE   | TemplateAnalyzer/Prototype              | 임의 양식 분석·확인                        |
| WP-HWPX-EDIT      | Selection/ChangeSet/Undo                | rhwp Workspace 통합                        |
| WP-HWPX-SERIALIZE | 보존형 저장/Reference                   | HWPX output                                |
| WP-HWPX-QA        | CI+Hancom Round-trip                    | Golden corpus report                       |
| WP-PLAN-T3Q       | RPT-001/002 Adapter                     | 계획서 목차/본문 생성                      |
| WP-SITUATION      | SituationContext/Provider               | Fact/Snapshot/health                       |
| WP-UNI-RAG        | Upload/Search/SSE/Mapper                | SOP Draft POC                              |
| WP-WORKFLOW       | SOP instance/task/decision              | 실행상태                                   |
| WP-PROPAGATION    | Outbox/Channel adapters                 | 전파·수신·재시도                           |
| WP-JOURNAL        | Projection/AI validation/HWPX           | 상황일지 생성                              |
| WP-SCENARIO       | Natural/Social pack/Institution binding | E2E baseline                               |
| WP-UI             | React unified workspace/dashboard       | 화면상태·권한·오류                         |
| WP-INTEGRATION-QA | Contract/E2E/보안/성능                  | 인수증거                                   |

## 13.3 외부 협업 요청 목록

| **요청 대상**   | **요청사항**                                                 | **UNE 대기 여부**        | **미수신 시 기본 처리**             |
|-----------------|--------------------------------------------------------------|--------------------------|-------------------------------------|
| T3Q             | RPT-001/002 운영 Schema/샘플/오류, 상황정보 API, RPT-003     | 계획서 API만 Critical    | 상황/일지는 Mock·UNI·UNE Projection |
| UNI 운영담당    | /upload,/search,/chat/json 실제 payload·SSE sample·model_key | POC 연결 시 필요         | Recorded fixture로 Mapper 개발      |
| 실증 수요처     | 기관·재난유형·조직·자료·일정·평가기준                        | 최종 실증 Binding에 필요 | Reference Scenario/Mock Org         |
| 채널 제공자     | SMS/EMAIL/BROADCAST SDK/API/인증/회신                        | 실채널 활성화에 필요     | System/Simulation Adapter           |
| 시험환경 관리자 | Windows/한컴/폰트/자동화 권한                                | Release Gate에 필요      | 개발 CI 진행, Release 보류          |

## 13.4 다음 산출물 착수 조건

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>ADR 단계 완료 조건</strong></p>
<p>본 문서 승인, OPEN-01~08 상태 갱신, ADR-11~18의 Work Package와 Gate를 개발계획서/WBS에 배치하면 ADR 확정 단계가 완료된다. 다음 산출물은 “개발계획서 및 WBS”이며, 단순 일정표가 아니라 각 WP의 책임자·기간·선행조건·산출물·Definition of Done·ADR/Scenario/E2E 추적을 포함해야 한다.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 부록 A. OPEN 폐쇄 인수 체크리스트

| **ID** | **검사항목**       | **합격 조건**                                                     | **확인** |
|--------|--------------------|-------------------------------------------------------------------|----------|
| A-01   | OPEN Register      | OPEN-01~08이 CLOSED-BY-ADR이고 대응 ADR 링크가 존재               | □        |
| A-02   | Provider Port      | T3Q 없이 SituationContext 개발 가능한 canonical contract 존재     | □        |
| A-03   | Journal Ownership  | UNE Projection과 사실원장 경계가 API/DB에 반영                    | □        |
| A-04   | UNI Mapper         | raw/mapping/domain 계층과 version 정책 존재                       | □        |
| A-05   | Web Collection     | Feature Flag·on-demand·fallback·운영승인 Gate 존재                | □        |
| A-06   | rhwp Baseline      | tag/commit lock·source archive hash·SBOM·license notice 정책 존재 | □        |
| A-07   | Unsupported Object | NATIVE/PRESERVE/EXPORT/REJECT 등급과 저장차단 규칙 존재           | □        |
| A-08   | Hancom QA          | CI와 Windows Round-trip Matrix 및 증거보관 정의                   | □        |
| A-09   | Propagation        | Outbox·ChannelPort·상태·멱등·재시도 정의                          | □        |
| A-10   | Scenario           | 자연/사회 Reference Scenario와 Institution Binding 정의           | □        |
| A-11   | Traceability       | ADR→WP→US→SCR→API/DB→E2E→Evidence 연결 규칙 존재                  | □        |
| A-12   | Change Control     | Trigger 발생 시 기존 ADR 덮어쓰기 금지 및 신규 ADR 절차 정의      | □        |

# 부록 B. 용어 및 상태 정의

| **용어**              | **정의**                                                                                     |
|-----------------------|----------------------------------------------------------------------------------------------|
| Anti-Corruption Layer | 외부 Provider의 데이터 모델이 UNE 도메인 모델에 직접 침투하지 않도록 변환·검증하는 격리 계층 |
| Canonical Model       | Provider와 화면에 독립적인 UNE 표준 객체. SituationFact, SopNode, JournalEntry 등이 해당     |
| Feature Flag          | 배포 없이 기능·Provider·채널을 활성/비활성하는 설정. 보안·운영 승인이 필요한 기능은 기본 OFF |
| Fact                  | 외부 또는 사용자에게서 수집된 원천 사실 후보. 원천 값은 불변이며 수정은 파생 Fact로 생성     |
| SituationSnapshot     | 특정 contextRevision에서 사용자가 선택·확정한 Fact 집합. 확정 후 불변                        |
| Execution Log         | SOP 실행 중 전파·수신·착수·완료·재전파·승인 등 모든 상태변경의 사실원장                      |
| Projection            | 사실원장을 특정 문서·화면 형태로 읽어 생성하는 파생 표현. 상황일지가 대표적                  |
| Prototype Clone       | 원본문단·표의 구조와 서식을 복제하여 AI 내용에 적용하는 방식                                 |
| Preserve-only         | 객체를 해석·편집하지 못해도 원문 XML/Part를 보존하고 주변만 편집하는 호환성 등급             |
| Round-trip            | 원본을 열고 편집·저장한 후 한컴에서 재저장하고 다시 열어 구조·의미·서식 회귀를 검증하는 과정 |
| Transactional Outbox  | 업무 DB 상태와 전파 메시지를 한 트랜잭션으로 기록하고 외부 발송은 비동기로 처리하는 패턴     |
| Institution Binding   | 범용 시나리오의 역할·조직·지역·연락처를 실제 실증기관 값으로 연결하는 설정 단계              |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>종료 선언</strong></p>
<p>본 문서의 승인으로 통합설계서 v0.9의 OPEN-01~OPEN-08은 개발 기준 관점에서 모두 폐쇄된다. 외부 API·기관·채널·시험환경이 이후 확정되는 경우는 본 결정의 실패가 아니라 예정된 Adapter 활성화 또는 Binding Trigger이며, 변경 이력은 신규 ADR 또는 Change Request로 관리한다.</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>
