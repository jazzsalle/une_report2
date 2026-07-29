**SituationContext 및 UNI Adapter 상세명세서**

현재 재난상황정보·사용자 자료 기반 SOP·상황일지 POC 연계

Version 1.0 \| 2026.07.26

# 문서 개요

| **구분**   | **내용**                                                    |
|------------|-------------------------------------------------------------|
| 작성기관   | ㈜유엔이(UNE)                                               |
| 기준선     | 통합플랫폼 상세설계서 v0.9 및 UNE Document AI Contract v1.0 |
| 적용연차   | 3차년도(2026) 개발 기준                                     |
| 문서성격   | 개발자·QA·아키텍트 공통 상세명세                            |
| 연계산출물 | v0.9 개발스키마 번들                                        |

| **문서 원칙** 본 문서는 통합설계서의 내용을 요약한 문서가 아니라, 특정 하위시스템을 구현 가능한 수준으로 재배열·상세화한 통제문서이다. |
|----------------------------------------------------------------------------------------------------------------------------------------|

# 1. SituationContext·UNI Adapter·외부 Provider 상세명세

본 장은 상황일지 POC에서 사용할 현재 재난상황정보 입력, 사용자 훈련자료 업로드, UNI RAG 검색·SOP 생성·일반 편집, 상황확정 Snapshot 및 UNE 내부 전파/Execution Log 연계를 개발 수준으로 정의한다.

## 1.1 서비스별 Provider 적용결정

| **기능**                | **적용 Provider/API**                 | **결정**                                         |
|-------------------------|---------------------------------------|--------------------------------------------------|
| 재난안전계획서 목차     | T3Q API-RPT-001 /reports/plan/toc     | T3Q만 사용                                       |
| 재난안전계획서 본문     | T3Q API-RPT-002 /reports/plan/content | T3Q만 사용                                       |
| T3Q 일일상황일지        | API-RPT-003 /reports/daily            | 초기 상황일지 POC에서는 미사용·향후 Adapter 후보 |
| 사용자 문서 업로드      | UNI POST /documents/upload            | JWT, 비동기 학습                                 |
| RAG 검색                | UNI POST /search/                     | SOP Context 근거 조회                            |
| SOP 구조 생성           | UNI POST /chat/json                   | 인증 없는 B2B SSE이나 UNE Gateway 뒤에 격리      |
| 일반 문서/선택영역 편집 | UNI POST /chat/                       | 챗봇 UI 없이 Backend Operation으로 사용          |
| 상황/임무 전파          | UNE Propagation Module                | SMS·메일·방송·시스템알림, AI Provider와 분리     |

| **핵심 경계** T3Q·UNI API는 상황전파 API가 아니다. 전파·수신·착수·완료·재전파 이력은 UNE 내부 Workflow/Propagation/Execution Log가 담당한다. |
|----------------------------------------------------------------------------------------------------------------------------------------------|

## 1.2 상황정보 입력 원칙과 사용자 흐름

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>① 상황/훈련 기본정보 입력<br />
② [현재 상황정보 불러오기] 선택<br />
③ KMA/MOIS/SafeKorea/Naver 보조 Provider 조회<br />
④ SituationFact 후보 정규화·중복제거·최신성 검증<br />
⑤ 사용자 입력과 외부 후보 비교<br />
⑥ 사용자가 선택·수정·확정<br />
⑦ 불변 SituationSnapshot 생성<br />
⑧ Snapshot + 사용자 업로드자료 + RAG 근거로 SOP 생성<br />
⑨ SOP 승인·실행 → UNE 전파 → Execution Log<br />
⑩ Snapshot + Execution Log 기반 상황일지 생성</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

외부 데이터는 자동 확정하지 않는다. 외부 원천 값과 사용자가 수정한 값은 별도 Fact로 저장하고 originalFactId로 연결한다. 상황일지에는 확정 Snapshot과 실행이력만 사실원장으로 사용한다.

## 1.3 SituationContext JSON Schema

| **객체**             | **주요 속성**                                                                                 | **불변/변경 규칙**                     |
|----------------------|-----------------------------------------------------------------------------------------------|----------------------------------------|
| SituationContext     | contextId, incidentId, mode, revision, location, timeWindow, facts, conflicts, providerStatus | 편집 가능, revision 증가               |
| SituationFact        | category, value, time, provider, source, freshness, selection                                 | 원천 Fact 불변. 수정 시 파생 Fact 생성 |
| SituationSnapshot    | snapshotId, contextRevision, selected facts, confirmer, hash                                  | 확정 후 불변                           |
| ProviderStatus       | provider, status, checkedAt, lastSuccessAt                                                    | 조회마다 갱신                          |
| EvidenceSet          | USER_UPLOAD/UNI_RAG/SITUATION_FACT, priority                                                  | SOP 생성 시점 고정                     |
| SOPGenerationContext | snapshotId, evidenceSets, generationOptions                                                   | 요청 감사로그 저장                     |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>{<br />
"contextId": "SCTX-001",<br />
"incidentId": "INC-001",<br />
"mode": "TRAINING",<br />
"revision": 3,<br />
"status": "USER_CONFIRMED",<br />
"disasterType": "태풍/호우",<br />
"location": {"name":"부산광역시 ○○구", "adminCode":"26XXX"},<br />
"timeWindow": {"asOf":"2026-07-26T09:00:00+09:00"},<br />
"facts": [...],<br />
"conflicts": [...],<br />
"confirmedSnapshotId": "SS-001"<br />
}</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 1.4 SituationFact 범주와 Provenance

| **범주**            | **예시**                   | **권고 Provider**      |
|---------------------|----------------------------|------------------------|
| WEATHER_OBSERVATION | 기온·강수량·풍속·습도      | KMA                    |
| WEATHER_FORECAST    | 초단기/단기 예보           | KMA                    |
| WEATHER_WARNING     | 호우·태풍·폭염 특보        | KMA                    |
| DISASTER_MESSAGE    | 긴급재난문자               | MOIS 또는 국민안전24   |
| FIELD_REPORT        | 현장 사진·전화·담당자 보고 | 사용자/현장            |
| DAMAGE_STATUS       | 인명·시설 피해             | 사용자 또는 연계시스템 |
| CONTROL_STATUS      | 도로·시설 통제             | 사용자/공식정보        |
| RESPONSE_STATUS     | 대응단계·조치현황          | Execution Log/사용자   |
| USER_ASSERTED       | 사용자가 직접 확정한 사실  | 사용자                 |

모든 Fact는 observedAt/issuedAt과 retrievedAt을 분리하고 sourceUrl/sourceId/sourceHash/parserVersion을 보존한다. 웹 수집 화면이 변경되어도 어떤 원문과 Parser로 생성되었는지 재현 가능해야 한다.

## 1.5 외부 Provider 수집 인터페이스

| **Provider**         | **운영 우선순위** | **수집 방식**                               | **정책**                              |
|----------------------|-------------------|---------------------------------------------|---------------------------------------|
| KMA_FORECAST         | P0                | 공식 OpenAPI                                | 기본 기상/예보 Fact                   |
| KMA_WARNING          | P0                | 공식 OpenAPI                                | 특보 발효/해제 Fact                   |
| MOIS_MESSAGE         | P0                | 공식 OpenAPI 가능 시                        | 긴급재난문자                          |
| SAFEKOREA_WEB        | P1                | 서버측 DOM Parser + Cache                   | 공식 API 미제공/장애 시 보조          |
| NAVER_WEATHER_SAFETY | P1/P2             | 사용자 요청형 URL Import 또는 제한적 Parser | POC 보조, 약관·robots·DOM 안정성 검토 |
| T3Q_SITUATION        | 향후              | T3Q 전용 API Adapter                        | 동일 SituationFact로 변환             |

국민안전24와 네이버 웨더세이프를 “긁어오는” 기능은 무제한 실시간 크롤러로 구현하지 않는다. On-demand Collector, 최소 수집주기, Cache, User-Agent 식별, Rate Limit, 원문 URL, Parser 버전, DOM 변경 알림, 법적·운영 검토를 적용한다.

| **웹 보조 수집 단계** | **처리**                                           |
|-----------------------|----------------------------------------------------|
| Fetch                 | 허용 도메인·TLS·Timeout·응답크기·Content-Type 검사 |
| Parse                 | 선택자/구조 버전별 Parser, 텍스트 정규화           |
| Validate              | 지역·시각·재난유형 필수값 검사                     |
| Normalize             | SituationFact 변환                                 |
| Cache                 | 원문 hash와 TTL 저장                               |
| Detect Change         | 선택자 실패율·DOM fingerprint 변화 감시            |
| Fallback              | 실패 시 사용자 직접입력과 외부 링크 제공           |

| **운영 기본값** 공식 API 우선. SafeKorea는 보조 자동수집 허용. Naver Weather Safety는 POC에서 사용자 요청형 보조수집으로만 활성화하고, 운영 전 이용조건 확인 후 Feature Flag로 제어한다. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 1.6 정규화·중복·최신성·충돌 알고리즘

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>normalize(rawItem):<br />
map provider fields -&gt; canonical category/value/time/location<br />
attach provenance and sourceHash<br />
calculate freshness by category TTL<br />
calculate reliability by provider policy<br />
return SituationFact(selection=UNREVIEWED)<br />
<br />
deduplicate(facts):<br />
group by category + normalized location + time window + event key<br />
same provider/sourceId -&gt; update candidate<br />
different providers -&gt; duplicate group, preserve both provenance<br />
<br />
conflict:<br />
same semantic key but incompatible value/time/level -&gt; OPEN conflict<br />
no automatic overwrite; user selects or creates corrected derived fact</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **범주**            | **CURRENT 기준 예시**            | **STALE 기준 예시**    |
|---------------------|----------------------------------|------------------------|
| WEATHER_OBSERVATION | 관측 30분 이내                   | 2시간 초과             |
| WEATHER_FORECAST    | 발표본 유효시간 내               | 새 발표본 확인 후      |
| WEATHER_WARNING     | 발효/해제 상태 최신              | 해제 또는 새 특보 누락 |
| DISASTER_MESSAGE    | 발송 6시간 이내 또는 사건 진행중 | 상황 종료 후           |
| FIELD_REPORT        | 사용자 지정                      | 후속 정정 보고 존재    |

## 1.7 상황등록 화면흐름

| **화면 단계** | **주요 UI**                                        | **검증**              |
|---------------|----------------------------------------------------|-----------------------|
| 1\. 기본정보  | 실제/훈련, 재난유형, 지역, 발생/기준시각, 최초상황 | 필수값·지역코드       |
| 2\. 외부조회  | Provider 선택, 조회범위, 현재상황 불러오기         | Provider 상태·Timeout |
| 3\. 후보검토  | 기상/특보/문자/현장별 카드, 원문·조회시각          | 출처·freshness 표시   |
| 4\. 충돌해결  | 동일항목 비교, 선택/수정/제외                      | 사용자 결정 필수      |
| 5\. Snapshot  | 확정 대상 요약, 누락 경고                          | 확정자·hash           |
| 6\. SOP 자료  | 업로드자료/UNI DB/상황 Snapshot 포함 옵션          | 우선순위·충돌옵션     |
| 7\. SOP 생성  | 진행상태·노드 스트리밍·근거                        | SSE 검증·Schema 검증  |

상황정보 조회 실패는 상황등록 자체를 막지 않는다. UNAVAILABLE 배지를 표시하고 사용자 입력만으로 Snapshot을 확정할 수 있다. 이후 Provider 복구 시 “새 후보 있음”으로 제시하되 기존 Snapshot을 자동 변경하지 않는다.

## 1.8 UNI 인증·Gateway 원칙

| **Endpoint**              | **명세상 인증**         | **UNE 적용**                                         |
|---------------------------|-------------------------|------------------------------------------------------|
| /auth/login               | 계정 로그인 후 JWT 발급 | Backend Credential Vault/서비스계정 또는 사용자 위임 |
| /documents/upload         | HTTPBearer              | UNE Gateway가 JWT 첨부                               |
| /documents/               | 명세상 공개             | Gateway 내부에서만 사용                              |
| /documents/{id}/reference | 명세상 공개/202 가능    | 폴링은 Gateway가 수행                                |
| /search/                  | 명세상 보안표시 없음    | Gateway 내부 B2B                                     |
| /chat/json                | 인증 없음 B2B           | 외부노출 금지, IP/Network/Token 보완                 |
| /chat/                    | HTTPBearer              | 일반 편집 Operation 전용                             |

| **보안 보완** /chat/json과 다운로드 Endpoint가 명세상 인증 없이 접근 가능하더라도 React가 직접 호출하지 않는다. UNE Backend Gateway에서 네트워크 ACL, 서비스 토큰, 요청서명, Rate Limit, 감사로그를 적용한다. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 1.9 UNI 문서 업로드·학습 수명주기

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>POST /documents/upload?uploader=...&amp;force=false (multipart, JWT)<br />
-&gt; {message, filename, doc_id}<br />
-&gt; 상태: QUEUED/PARSING/INDEXING/REFERENCE_GENERATING/READY/ERROR<br />
-&gt; GET /documents/?q=... 또는 내부 상태조회<br />
-&gt; GET /documents/{doc_id}/reference<br />
200 READY / 202 PROCESSING<br />
-&gt; SOP 생성에 사용<br />
-&gt; 세션/프로젝트 종료 정책에 따라 삭제 또는 기관자료 승격</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **업로드 범위**  | **기본 보존**      | **등록 정책**                        |
|------------------|--------------------|--------------------------------------|
| THIS_INCIDENT    | 상황/훈련 종료+TTL | 기본값, 기관 DB 자동편입 금지        |
| TRAINING_PROJECT | 프로젝트 종료까지  | 반복 훈련 수정에 사용                |
| ORGANIZATION_KB  | 장기               | 검토·승인·분류·개인정보 점검 후 승격 |

UNI 명세의 문서 목록은 대규모 페이지네이션을 지원하므로, UNE는 doc_id를 자체 UploadSession과 연결해 전체 목록 검색에 의존하지 않는다. Reference 생성이 202이면 지수 Backoff 폴링 후 타임아웃 시 “자료 없이 계속/재시도” 선택을 제공한다.

## 1.10 UNI Search Adapter

| **UNI 요청** | **UNE 값**                                                                   |
|--------------|------------------------------------------------------------------------------|
| query        | disasterType + situation summary + SOP goal + selected evidence instructions |
| top_k        | 기본 8, 화면/관리설정으로 제한                                               |
| 응답 results | filename, score, text, doc_id를 EvidenceChunk로 변환                         |

Search 결과는 LLM 생성 전에 사용자 업로드자료, 공식 매뉴얼, 기관자료의 우선순위와 충돌규칙을 적용한다. 유사도 점수만으로 최신 업로드 자료를 밀어내지 않는다.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>Evidence Priority (기본)<br />
1. 이번 상황/훈련 사용자 업로드자료<br />
2. 사용자 확정 SituationSnapshot<br />
3. 기관 최신 대응절차/훈련계획<br />
4. 공식 위기관리매뉴얼<br />
5. 기존 재난안전계획서/SOP<br />
6. 유사 재난사례<br />
7. 일반 학습 DB<br />
<br />
공식 규정과 업로드자료 충돌 시 자동 우선처리 금지 → Conflict UI</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 1.11 UNI /chat/json SOP SSE Adapter

| **SSE Event**              | **UNE 처리**                                   |
|----------------------------|------------------------------------------------|
| \_\_status\_\_: searching  | JOB_SEARCHING                                  |
| \_\_status\_\_: reranking  | JOB_RERANKING                                  |
| \_\_status\_\_: generating | JOB_GENERATING                                 |
| \_\_thinking\_\_           | 사용자 기본화면에는 미표시, 진단로그 제한      |
| \_\_compn\_\_              | SopNode 후보로 즉시 추가·Schema 부분검증       |
| \_\_sources\_\_            | EvidenceSource 매핑                            |
| \_\_done\_\_               | 전체 노드 수/파일정보 확인 후 Final Validation |
| \_\_error\_\_              | Job 실패·부분결과 폐기 또는 사용자 선택        |
| \[DONE\]                   | Stream 종료                                    |

명세의 compns 구조가 UNE 표준 SopNode와 완전히 일치한다는 보장은 없으므로 UniSopMapper를 둔다. compnSn/type/name/task/branch/source를 매핑하고 누락 필드는 Validator warning으로 반환한다.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>UNI __compn__<br />
-&gt; UniRawCompn<br />
-&gt; UniSopMapper<br />
-&gt; SopNode {nodeId, type, name, sequence, tasks, decisionExpression, sourceRefs}<br />
-&gt; Incremental Graph Validator<br />
-&gt; 사용자 Canvas 임시표시<br />
-&gt; __done__ 후 전체 DAG/시작·종료/분기/고립노드 검증<br />
-&gt; DRAFT SOP 저장</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 1.12 UNI /chat 일반 편집 Adapter

/chat/은 UNE가 챗봇 화면을 개발하기 위한 API가 아니다. SelectionContext와 확정 근거를 Prompt Builder가 명시적으로 전달하고, 결과를 Document AI Contract의 의미적 Block 또는 Patch 제안으로 변환한다.

| **Operation**     | **UNI query 구성**                 | **결과 처리**           |
|-------------------|------------------------------------|-------------------------|
| REWRITE_SELECTION | 선택본문+문체/길이/사실제약        | REPLACE_RANGE ChangeSet |
| EXPAND_SELECTION  | 선택본문+추가할 근거 ID            | 본문 확장 Diff          |
| ADD_EVIDENCE      | 선택본문+EvidenceChunk             | Citation 연결           |
| INSERT_AT_CURSOR  | 앞뒤 문맥+삽입목적                 | Prototype 적용 Block    |
| JOURNAL_SUMMARIZE | Snapshot+Execution Events+시간범위 | 상황일지 의미 Block     |

history/session_id는 UNE Document Session과 분리한다. UNI 세션 기능을 사용하더라도 UNE가 기준 revision, selection, evidence, operation을 감사로그에 보존하며 Provider 세션을 사실원장으로 사용하지 않는다.

## 1.13 SOP 생성 Prompt/Context 규칙

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>System constraints<br />
- 확정 SituationSnapshot의 값·시각·출처를 변경하거나 추정하지 말 것<br />
- 사용자 업로드자료를 우선하되 공식 매뉴얼 충돌은 conflicts에 표기<br />
- 시작/종료 노드 포함<br />
- 행동노드는 임무, 담당역할, 완료조건, 전파대상/채널, 기한 포함<br />
- 판단노드는 명시적 조건과 true/false 또는 다중분기 포함<br />
- 모든 노드에 sourceRefs 연결<br />
- UNE SOP JSON Schema 외 텍스트 출력 금지</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **검증**            | **실패 처리**                               |
|---------------------|---------------------------------------------|
| JSON/SSE parse      | 해당 compn 격리, Stream 계속 가능 여부 판정 |
| 필수 노드/필드 누락 | Repair 요청 1회 후 사용자 경고              |
| 고립노드/순환       | Graph Validator 오류, 승인 금지             |
| 근거 없음           | warning + 사용자 확인                       |
| 상황 Fact 변조      | 생성결과 폐기                               |
| 전파 수신자 미매핑  | 조직관리에서 사용자 지정                    |

## 1.14 오류·Retry·Circuit Breaker

| **구간**            | **Timeout/Retry**                         | **Fallback**                   |
|---------------------|-------------------------------------------|--------------------------------|
| KMA/MOIS API        | 연결 3초, 전체 10초, 2회 지수 Backoff     | SafeKorea/사용자 입력          |
| SafeKorea/Naver Web | 전체 10초, 1회, Parser 실패 자동반복 금지 | 외부 링크/수동 입력            |
| UNI Upload          | 60초 업로드, 처리 비동기                  | 재시도 또는 파일 제외          |
| UNI Reference Poll  | 최대 5분, 2/4/8/15초                      | 참고요약 없이 Search 진행 가능 |
| UNI Search          | 30초, 1회                                 | 선택 업로드자료 직접 Context   |
| UNI chat/json       | 첫 이벤트 30초, 전체 5분                  | 부분 SOP 폐기/재생성           |
| UNI chat            | 전체 2분                                  | 사용자 편집 유지               |

Provider별 최근 실패율이 임계치를 넘으면 Circuit OPEN으로 전환하고 화면에 UNAVAILABLE을 표시한다. 상황등록과 수동 SOP 편집은 계속 사용할 수 있어야 한다.

## 1.15 데이터보안·감사·개인정보

> **•** 사용자 업로드문서는 기본 THIS_INCIDENT 범위이며 자동으로 기관 전체 학습 DB에 편입하지 않는다.
>
> **•** 개인정보·연락처·비공개 훈련정보를 업로드하기 전 분류/마스킹 정책과 접근권한을 적용한다.
>
> **•** UNI 요청에는 필요한 문맥만 최소화하여 전송하고, 원본 파일 ID·Prompt·응답·근거·사용자 결정을 추적한다.
>
> **•** 공개 인증이 없는 UNI Endpoint는 내부망/Gateway에서만 사용하며 외부 URL을 사용자에게 직접 노출하지 않는다.
>
> **•** 웹 보조수집 원문은 TTL 후 삭제 가능하되 sourceHash와 인용정보는 감사정책에 따라 보존한다.
>
> **•** 상황 Snapshot과 Execution Log의 정정은 원본 삭제가 아니라 새 revision/정정 Event로 기록한다.

## 1.16 개발·인수 E2E

| **ID**     | **시나리오**                             | **합격 기준**                       |
|------------|------------------------------------------|-------------------------------------|
| SIT-E2E-01 | 사용자 입력만으로 SituationSnapshot 확정 | 외부 장애에도 등록 가능             |
| SIT-E2E-02 | KMA 특보+MOIS 문자 조회 후 선택          | 출처·시각·freshness 유지            |
| SIT-E2E-03 | SafeKorea DOM 변경                       | 파서 실패 감지·사용자 입력 fallback |
| SIT-E2E-04 | Naver 사용자 요청형 보조수집             | Feature Flag·출처·캐시·실패격리     |
| SIT-E2E-05 | 충돌 Fact 비교·수정·확정                 | 원본/수정값 모두 추적               |
| SIT-E2E-06 | 훈련계획서 업로드→READY→Search           | doc_id와 Evidence 연결              |
| SIT-E2E-07 | /chat/json compn SSE                     | 노드 실시간표시·최종 Graph 검증     |
| SIT-E2E-08 | SOP 승인→UNE 전파→완료                   | Execution Log 시간순 축적           |
| SIT-E2E-09 | Snapshot+Log 상황일지 생성               | AI 허위 Fact 0, 근거 추적           |
| SIT-E2E-10 | UNI 장애                                 | 수동 SOP/일지 편집과 기존 실행 지속 |
