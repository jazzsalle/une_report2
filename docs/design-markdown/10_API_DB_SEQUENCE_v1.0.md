**재난안전 AI 문서 통합플랫폼**

**API 명세·DB 논리/물리 설계·화면별 Sequence 상세설계서**

Version 1.0 \| 2026.07.27

| **항목**    | **상세**                                                                                                 |
|-------------|----------------------------------------------------------------------------------------------------------|
| 과제명      | 재난관리를 위한 맞춤형 정보생성 및 의사결정지원 대화형 인공지능 기술개발                                 |
| 과제번호    | RS-2024-00407304                                                                                         |
| 작성기관    | 주식회사 유엔이(UNE)                                                                                     |
| 상위 기준선 | 통합설계서 v0.9, ADR v1.1, 개발계획서·상세 WBS v1.0, 계획서/상황일지 사용자 시나리오 v1.0, 화면설계 v1.0 |
| 설계 범위   | UNE 내부 API, T3Q·UNI·공식/보조 Provider Adapter, PostgreSQL 논리·물리 모델, 56개 화면별 동적 Sequence   |
| 문서 통제   | 구현·시험·인수에 직접 사용하는 누적 상세설계 문서이며 내용 길이를 이유로 축약하지 않음                   |

# 문서 통제

| **버전** | **일자**   | **개정내용**                                                              | **작성/승인**  |
|----------|------------|---------------------------------------------------------------------------|----------------|
| 1.0      | 2026.07.27 | ADR v1.1과 56개 화면설계를 기준으로 API·DB·화면별 Sequence 최초 상세 작성 | UNE / 승인예정 |

## 참고문서

| **문서**                                                | **적용**                              |
|---------------------------------------------------------|---------------------------------------|
| UNE 재난안전 AI 문서 통합플랫폼 상세설계서 v0.9         | 전체 아키텍처·도메인 경계·Schema 기준 |
| UNE 통합플랫폼 ADR 의사결정기록서 v1.1                  | ADR-01~18                             |
| UNE 개발계획서 및 상세 WBS v1.0                         | Work Package·Gate·DoD                 |
| 재난안전계획서 생성도구 사용자 시나리오 v1.0            | US-PLAN-001~030                       |
| 상황일지·안전한국훈련 사용자 시나리오 v1.0              | US-SIT-001~040                        |
| 화면목록·화면흐름·상태·권한·오류 메시지 상세설계서 v1.0 | SCR 56개                              |
| \(251124\) MOIS API 명세서 v0.8.5                       | T3Q API-RPT-001/002 및 연계 API       |
| 221.147.100.161:8000 UNI OpenAPI                        | UNI Upload/Search/chat-json/chat 등   |
| 요구사항 정의서 및 기능정의서 251020                    | UFR 계획서/SOP 요구사항               |

# 목차

- 1\. 문서 개요 및 상위 의사결정 추적

- 2\. 시스템 경계와 API 공통규약

- 3\. UNE 내부 API 전체 명세

- 4\. T3Q·UNI·외부 Provider Adapter 명세

- 5\. DB 논리 설계

- 6\. DB 물리 설계·데이터사전

- 7\. 56개 화면별 Sequence 상세설계

- 8\. 상태·권한·오류·트랜잭션·보안

- 9\. 요구사항-화면-API-DB-Sequence-시험 추적

- 10\. 구현·배포·검증 기준

- 부록 A. DDL 예시

- 부록 B. 메시지·Event Schema

- 부록 C. API/DB 수량 요약

# 1. 문서 개요 및 상위 의사결정 추적

## 1.1 목적

본 문서는 확정된 사용자 시나리오와 화면설계를 백엔드 구현 단위로 변환한다. 각 화면 ID와 Scenario ID에 대해 호출 API, DB 읽기·쓰기, 외부 Provider, 상태전이, 권한, 오류, 멱등성, 동시성, 감사 및 인수시험을 연결한다. 화면 또는 하위 상세명세가 상위 통합설계를 대체하거나 축소하지 않으며, 변경은 ADR 또는 Interface Change Request로 관리한다.

## 1.2 책임 경계

| **영역**       | **UNE 책임**                                                                  | **T3Q/ETRI/외부 책임**                      | **강제 규칙**                       |
|----------------|-------------------------------------------------------------------------------|---------------------------------------------|-------------------------------------|
| 재난안전계획서 | React/rhwp Workspace, 기준정보, 목차·본문 수신, 편집, HWPX/PDF/DOCX           | T3Q RPT-001/002와 RAG/LLM                   | 계획서 생성 과정 UNI 호출 0건       |
| 상황일지·훈련  | SituationFact/Snapshot, SOP/Task/Execution Log, 전자상황판, JournalProjection | UNI RAG POC, T3Q 연계정보, ETRI 유사재난 등 | Snapshot+Execution Log가 사실원장   |
| 전파           | UNE Workflow, Transactional Outbox, ChannelPort, 수신·완료 이력               | 외부 SMS/메일/방송 사업자                   | T3Q/UNI를 전파 API로 사용 금지      |
| HWPX           | rhwp 소스 내부 반입, Adapter, Serializer, Validation                          | 한컴오피스는 QA 호환성 시험환경             | 운영 사용자 저장마다 한컴 실행 금지 |
| 외부현황       | Canonical Provider Port, Fact 정규화·확정                                     | KMA/MOIS 우선, SafeKorea/Naver 보조         | 외부값은 후보 Fact, LLM 생성 금지   |

## 1.3 ADR 추적

| **ADR** | **확정 결정**                                                                                            | **본 문서 반영**                         |
|---------|----------------------------------------------------------------------------------------------------------|------------------------------------------|
| ADR-01  | rhwp Web Editor를 중앙 Single Editing Surface로 사용                                                     | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-02  | 임의 HWPX 자동분석 + Template Profile + Prototype Clone                                                  | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-03  | AI는 내용/의미 수준만 생성하고 HWPX 서식은 UNE 엔진이 적용                                               | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-04  | Cursor/Range/Block/Section 선택과 ChangeSet/Diff/Undo                                                    | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-05  | 계획서 생성은 T3Q RPT-001/002만 사용                                                                     | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-06  | 상황일지 POC는 UNI Upload/Search/chat-json/chat                                                          | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-07  | T3Q/UNI는 상황전파에 사용하지 않으며 UNE 내부모듈 담당                                                   | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-08  | 현재상황은 SituationFact/Snapshot으로 관리하고 LLM 생성값 금지                                           | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-09  | KMA/MOIS 우선, SafeKorea 보조, Naver 사용자 요청형 보조수집                                              | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-10  | Execution Log를 사실원장으로 상황일지 생성                                                               | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-11  | 현재 재난상황정보는 UNE canonical Provider Port로 수용하고 T3Q Adapter는 계약 충족 후 활성화             | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-12  | 상황일지는 UNE JournalProjection Engine이 생성하고 T3Q RPT-003은 선택적 보조 Adapter로 한정              | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-13  | UNI compns 스트림은 UniSopMapper Anti-Corruption Layer에서 버전별 변환                                   | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-14  | 웹 보조수집은 공식 API 대체가 아닌 on-demand·Feature Flag 기반 보조 Provider로 제한                      | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-15  | rhwp 특정 Tag/Commit 소스를 다운로드하여 내부 반입하고 보존형 Adapter/Serializer와 호환성 검증 적용      | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-16  | CI 자동검증과 Windows 한컴 HWPX Round-trip 검증을 분리하되 배포 승인에는 둘 다 필수                      | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-17  | 전파는 ChannelPort와 Transactional Outbox로 구현하고 외부채널 미제공 시 System/Simulation Adapter로 검증 | API/DB/Sequence 및 시험 Gate에 구속 적용 |
| ADR-18  | 기관 독립형 Scenario Pack을 개발하고 태풍·호우와 다중밀집건축물 붕괴를 기술 기준 시나리오로 사용         | API/DB/Sequence 및 시험 Gate에 구속 적용 |

# 2. 시스템 경계와 API 공통규약

## 2.1 논리 아키텍처

> \[T3Q Main Portal / SSO\]
>
> \|
>
> v
>
> \[UNE API Gateway / BFF\] -- 단일 진입점, 인증, Rate Limit, Correlation
>
> \|
>
> +-- Identity & RBAC
>
> +-- Plan / Document / HWPX Engine
>
> +-- Situation / Fact / Snapshot
>
> +-- Knowledge / Evidence / UNI Adapter
>
> +-- SOP Graph / Workflow / Task
>
> +-- Execution Log / Journal Projection / Evaluation
>
> +-- Notification / Transactional Outbox / ChannelPort
>
> +-- Provider Adapters: T3Q, UNI, KMA, MOIS, SafeKorea, Naver(on-demand)
>
> \|
>
> +-- PostgreSQL + Object Storage + Redis(optional)

## 2.2 URI·버전·인증

| **항목**  | **규칙**                        | **검증**                                            |
|-----------|---------------------------------|-----------------------------------------------------|
| Base URI  | /api/v1                         | Major Version만 URI에 포함, Minor는 schemaVersion   |
| 인증      | Authorization: Bearer {UNE JWT} | T3Q SSO Token은 /auth/sso/exchange에서 1회 교환     |
| 기관 격리 | tenantId는 JWT Claim에서 확정   | 클라이언트가 임의 지정한 Tenant Header만 신뢰 금지  |
| 추적      | X-Correlation-Id                | 미지정 시 Gateway 생성, T3Q/UNI/Worker까지 전달     |
| 멱등성    | Idempotency-Key                 | 생성·전파·완료·Export·재시도 POST 필수              |
| 동시성    | If-Match/ETag 또는 versionNo    | 불일치 시 409, 자동 덮어쓰기 금지                   |
| 시간      | ISO-8601 +09:00, DB timestamptz | 업무시각 occurredAt과 기록시각 recordedAt 분리      |
| 파일      | 사전등록→직접 업로드→완료확정   | SHA-256, 크기, MIME, 악성코드 검사                  |
| SSE       | text/event-stream               | id/event/data, 15초 heartbeat, Last-Event-ID 재접속 |

## 2.3 공통 응답·오류 Envelope

> {
>
> "success": true,
>
> "data": { },
>
> "meta": {
>
> "requestId": "req_01...",
>
> "correlationId": "corr_01...",
>
> "timestamp": "2026-07-27T19:00:00+09:00",
>
> "schemaVersion": "1.0"
>
> }
>
> }
>
> {
>
> "success": false,
>
> "error": {
>
> "code": "DOC-409-001",
>
> "message": "다른 사용자가 문서를 수정했습니다.",
>
> "detail": "expectedVersion=12, actualVersion=13",
>
> "recoverable": true,
>
> "userAction": "최신 버전을 불러온 뒤 변경 내용을 병합하십시오.",
>
> "violations": \[{"field":"...","reason":"..."}\]
>
> },
>
> "meta": { }
>
> }

## 2.4 HTTP 상태·Retry 정책

| **HTTP**    | **의미**           | **클라이언트/서버 처리**                     |
|-------------|--------------------|----------------------------------------------|
| 200/201     | 정상/생성          | 최종 자원과 ETag 반환                        |
| 202         | 비동기 접수        | jobId, statusUrl, eventStreamUrl 반환        |
| 400         | 문법·필드 오류     | violations 표시, 자동 재시도 금지            |
| 401/403     | 인증/권한          | 재인증 또는 권한 문의                        |
| 404/410     | 없음/만료          | 논리삭제·다운로드 만료 구분                  |
| 409         | 상태·Revision 충돌 | 최신본 조회 후 사용자 병합                   |
| 412         | 선행조건 미충족    | Snapshot/승인/검증 완료 후 재시도            |
| 422         | Schema·업무규칙    | 사용자 수정 또는 Mapper 보정                 |
| 429         | Rate Limit         | Retry-After 준수                             |
| 502/503/504 | Provider 장애      | Circuit Breaker, 지수 Backoff, 부분결과 유지 |

## 2.5 Transaction·Job·Outbox

- 외부 Provider 호출을 DB 장기 트랜잭션 안에서 수행하지 않는다. 요청 Job을 Commit한 뒤 Worker가 호출한다.

- SOP 실행, 임무 상태변경, Execution Event, Outbox Message는 동일 DB 트랜잭션으로 기록한다.

- Outbox Worker는 FOR UPDATE SKIP LOCKED 또는 전용 Queue로 획득하고 Idempotency Key로 중복 전송을 차단한다.

- Execution Log와 Audit Log는 Append-only이며 정정은 원본 Event를 가리키는 새 Event로 기록한다.

- SSE는 DB/Message Event를 화면용 DTO로 투영하며 Provider 원문 Event를 그대로 노출하지 않는다.

# 3. UNE 내부 API 전체 명세

총 121개 Endpoint 후보를 정의한다. API ID는 이후 OpenAPI, 코드, 시험케이스, 로그 대시보드에서 동일하게 사용한다.

## 3.1 AUTH - 인증·세션·조직·권한

| **API ID**   | **Method** | **Endpoint**        | **기능**                   | **권한**      | **핵심 요청**             | **핵심 응답**                          | **오류**       | **DB**                          |
|--------------|------------|---------------------|----------------------------|---------------|---------------------------|----------------------------------------|----------------|---------------------------------|
| UNE-AUTH-001 | POST       | /auth/sso/exchange  | T3Q SSO 토큰 교환          | PUBLIC_SSO    | externalToken, returnUrl  | accessToken, refreshToken, userContext | AUTH-1001~1004 | app_user,user_session,audit_log |
| UNE-AUTH-002 | GET        | /auth/me            | 현재 사용자·기관·역할 조회 | AUTHENTICATED | \-                        | UserContext                            | AUTH-1005      | app_user,user_role,organization |
| UNE-AUTH-003 | POST       | /auth/refresh       | Access Token 갱신          | AUTHENTICATED | refreshToken              | accessToken                            | AUTH-1002      | user_session                    |
| UNE-AUTH-004 | POST       | /auth/logout        | 세션 종료                  | AUTHENTICATED | \-                        | 204                                    | AUTH-1006      | user_session,audit_log          |
| UNE-AUTH-005 | GET        | /organizations/tree | 조직도 조회                | ORG_READ      | tenantId(optional)        | OrganizationTree                       | ORG-2001       | organization                    |
| UNE-AUTH-006 | GET        | /users              | 사용자·담당자 검색         | USER_READ     | orgId,keyword,status,page | Page\<UserSummary\>                    | USER-2101      | app_user,organization           |
| UNE-AUTH-007 | GET        | /roles              | 역할·권한 조회             | RBAC_READ     | scope                     | Role\[\]                               | RBAC-2201      | role,permission,role_permission |

### UNE-AUTH-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/auth/sso/exchange                                                                      |
| 목적        | T3Q SSO 토큰 교환                                                                                   |
| 필요 권한   | PUBLIC_SSO                                                                                          |
| Request     | externalToken, returnUrl                                                                            |
| Response    | accessToken, refreshToken, userContext                                                              |
| 오류        | AUTH-1001~1004                                                                                      |
| DB          | app_user,user_session,audit_log                                                                     |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "accessToken, refreshToken, userContext",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-AUTH-005 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | GET /api/v1/organizations/tree                                                                      |
| 목적        | 조직도 조회                                                                                         |
| 필요 권한   | ORG_READ                                                                                            |
| Request     | tenantId(optional)                                                                                  |
| Response    | OrganizationTree                                                                                    |
| 오류        | ORG-2001                                                                                            |
| DB          | organization                                                                                        |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "OrganizationTree",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

## 3.2 HOME - 홈·알림

| **API ID**   | **Method** | **Endpoint**             | **기능**     | **권한**      | **핵심 요청** | **핵심 응답**                     | **오류**  | **DB**                                  |
|--------------|------------|--------------------------|--------------|---------------|---------------|-----------------------------------|-----------|-----------------------------------------|
| UNE-HOME-001 | GET        | /home/summary            | 통합 홈 요약 | AUTHENTICATED | \-            | recentWorks,myTasks,health,alerts | COM-0001  | document,situation,task,provider_health |
| UNE-HOME-002 | GET        | /notifications           | 알림 목록    | AUTHENTICATED | filter,page   | Page\<Notification\>              | NOTI-3001 | notification                            |
| UNE-HOME-003 | POST       | /notifications/{id}/read | 알림 읽음    | AUTHENTICATED | \-            | Notification                      | NOTI-3002 | notification                            |
| UNE-HOME-004 | POST       | /notifications/read-all  | 전체 읽음    | AUTHENTICATED | filter        | count                             | NOTI-3003 | notification                            |

### UNE-HOME-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | GET /api/v1/home/summary                                                                            |
| 목적        | 통합 홈 요약                                                                                        |
| 필요 권한   | AUTHENTICATED                                                                                       |
| Request     | \-                                                                                                  |
| Response    | recentWorks,myTasks,health,alerts                                                                   |
| 오류        | COM-0001                                                                                            |
| DB          | document,situation,task,provider_health                                                             |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "recentWorks,myTasks,health,alerts",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-HOME-004 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/notifications/read-all                                                                 |
| 목적        | 전체 읽음                                                                                           |
| 필요 권한   | AUTHENTICATED                                                                                       |
| Request     | filter                                                                                              |
| Response    | count                                                                                               |
| 오류        | NOTI-3003                                                                                           |
| DB          | notification                                                                                        |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "count",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

## 3.3 PLAN - 계획서·기준정보·목차·본문 생성

| **API ID**   | **Method** | **Endpoint**                      | **기능**                  | **권한**      | **핵심 요청**                           | **핵심 응답**       | **오류**     | **DB**                          |
|--------------|------------|-----------------------------------|---------------------------|---------------|-----------------------------------------|---------------------|--------------|---------------------------------|
| UNE-PLAN-001 | POST       | /plans                            | 계획서 Workspace 생성     | PLAN_CREATE   | title,startMode,templateFileId          | Plan                | PLAN-4001    | plan,document                   |
| UNE-PLAN-002 | GET        | /plans                            | 계획서 목록·검색          | PLAN_READ     | keyword,status,hazardType,page          | Page\<Plan\>        | PLAN-4002    | plan,document                   |
| UNE-PLAN-003 | GET        | /plans/{planId}                   | 계획서 상세               | PLAN_READ     | planId                                  | PlanDetail          | PLAN-4003    | plan,document                   |
| UNE-PLAN-004 | PATCH      | /plans/{planId}                   | 계획서 메타 수정          | PLAN_EDIT     | If-Match, JSON Merge Patch              | Plan                | PLAN-409-001 | plan,audit_log                  |
| UNE-PLAN-005 | DELETE     | /plans/{planId}                   | 계획서 휴지통 이동        | PLAN_DELETE   | reason                                  | 204                 | PLAN-403-001 | plan                            |
| UNE-PLAN-006 | POST       | /plans/{planId}/context-drafts    | 기준정보 임시저장         | PLAN_EDIT     | PlanContextDraft                        | ContextDraft        | PLAN-422-001 | plan_context_draft              |
| UNE-PLAN-007 | POST       | /plans/{planId}/context-snapshots | 기준정보 Snapshot 확정    | PLAN_EDIT     | PlanContext                             | PlanContextSnapshot | PLAN-412-001 | plan_context_snapshot,audit_log |
| UNE-PLAN-008 | GET        | /plans/{planId}/context-snapshots | 기준정보 Snapshot 목록    | PLAN_READ     | \-                                      | Snapshot\[\]        | PLAN-404-002 | plan_context_snapshot           |
| UNE-PLAN-009 | POST       | /plans/{planId}/toc-jobs          | T3Q RPT-001 목차 생성 Job | PLAN_GENERATE | snapshotId,generationOption             | GenerationJob       | T3Q-502-001  | generation_job                  |
| UNE-PLAN-010 | GET        | /plan-jobs/{jobId}                | 생성 Job 상태 조회        | PLAN_READ     | jobId                                   | GenerationJob       | JOB-404-001  | generation_job                  |
| UNE-PLAN-011 | GET        | /plan-jobs/{jobId}/events         | 생성 Job SSE              | PLAN_READ     | Last-Event-ID                           | SSE\<JobEvent\>     | JOB-503-001  | generation_job,job_event        |
| UNE-PLAN-012 | POST       | /plan-jobs/{jobId}/cancel         | 생성 Job 중지             | PLAN_GENERATE | reason                                  | GenerationJob       | JOB-409-001  | generation_job,job_event        |
| UNE-PLAN-013 | POST       | /plan-jobs/{jobId}/retry          | 실패 단위 재시도          | PLAN_GENERATE | blockIds,reason                         | GenerationJob       | JOB-409-002  | generation_job                  |
| UNE-PLAN-014 | POST       | /plans/{planId}/toc-versions      | 목차 편집 버전 저장       | PLAN_EDIT     | baseVersionId,tocTree                   | TocVersion          | TOC-409-001  | toc_version,toc_node            |
| UNE-PLAN-015 | GET        | /plans/{planId}/toc-versions/{id} | 목차 버전 조회            | PLAN_READ     | id                                      | TocVersion          | TOC-404-001  | toc_version,toc_node            |
| UNE-PLAN-016 | POST       | /plans/{planId}/content-jobs      | T3Q RPT-002 본문 생성 Job | PLAN_GENERATE | snapshotId,tocVersionId,protectedBlocks | GenerationJob       | T3Q-502-002  | generation_job,generated_block  |

### UNE-PLAN-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/plans                                                                                  |
| 목적        | 계획서 Workspace 생성                                                                               |
| 필요 권한   | PLAN_CREATE                                                                                         |
| Request     | title,startMode,templateFileId                                                                      |
| Response    | Plan                                                                                                |
| 오류        | PLAN-4001                                                                                           |
| DB          | plan,document                                                                                       |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "Plan",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-PLAN-005 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | DELETE /api/v1/plans/{planId}                                                                       |
| 목적        | 계획서 휴지통 이동                                                                                  |
| 필요 권한   | PLAN_DELETE                                                                                         |
| Request     | reason                                                                                              |
| Response    | 204                                                                                                 |
| 오류        | PLAN-403-001                                                                                        |
| DB          | plan                                                                                                |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "204",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

## 3.4 DOC - HWPX·rhwp 편집·Revision·검토·Export

| **API ID**  | **Method** | **Endpoint**                                           | **기능**                      | **권한**    | **핵심 요청**                         | **핵심 응답**            | **오류**                | **DB**                                        |
|-------------|------------|--------------------------------------------------------|-------------------------------|-------------|---------------------------------------|--------------------------|-------------------------|-----------------------------------------------|
| UNE-DOC-001 | POST       | /files                                                 | 파일 사전등록·업로드 URL 발급 | FILE_UPLOAD | fileName,size,mimeType,sha256         | FileObject+uploadUrl     | FILE-422-001            | file_object                                   |
| UNE-DOC-002 | POST       | /files/{fileId}/complete                               | 업로드 완료·검사              | FILE_UPLOAD | etag                                  | FileObject               | FILE-422-002            | file_object,malware_scan                      |
| UNE-DOC-003 | POST       | /documents/import-hwpx                                 | HWPX 업로드·분석              | PLAN_CREATE | fileId,planId                         | Document+AnalysisJob     | HWPX-422-001            | document,document_revision,template_profile   |
| UNE-DOC-004 | GET        | /documents/{documentId}/analysis                       | HWPX 분석결과 조회            | DOC_READ    | \-                                    | TemplateProfile,Warnings | HWPX-404-001            | template_profile,prototype_registry           |
| UNE-DOC-005 | GET        | /documents/{documentId}/ir                             | Document IR 조회              | DOC_READ    | revisionId                            | DocumentIR               | DOC-404-001             | document_revision                             |
| UNE-DOC-006 | POST       | /documents/{documentId}/changesets                     | ChangeSet 원자 적용           | DOC_EDIT    | baseRevisionId,selection,operations   | DocumentRevision         | DOC-409-001,DOC-422-004 | change_set,change_operation,document_revision |
| UNE-DOC-007 | GET        | /documents/{documentId}/revisions                      | Revision 목록                 | DOC_READ    | page                                  | Page\<Revision\>         | DOC-404-002             | document_revision                             |
| UNE-DOC-008 | POST       | /documents/{documentId}/revisions/{revisionId}/restore | Revision 복원                 | DOC_EDIT    | reason                                | DocumentRevision         | DOC-409-002             | document_revision,change_set                  |
| UNE-DOC-009 | POST       | /documents/{documentId}/autosaves                      | 자동저장                      | DOC_EDIT    | baseRevisionId,delta,clientMutationId | AutosaveReceipt          | DOC-409-003             | document_autosave                             |
| UNE-DOC-010 | POST       | /documents/{documentId}/ai-edit-jobs                   | 선택영역 AI 편집 제안         | DOC_AI_EDIT | selection,prompt,ruleSnapshot         | GenerationJob            | DOC-422-005             | generation_job,ai_edit_proposal               |
| UNE-DOC-011 | GET        | /documents/{documentId}/ai-edit-jobs/{jobId}/proposal  | AI 편집 Diff 조회             | DOC_READ    | \-                                    | AiEditProposal           | DOC-404-003             | ai_edit_proposal                              |
| UNE-DOC-012 | POST       | /documents/{documentId}/exports                        | HWPX/PDF/DOCX Export          | DOC_EXPORT  | revisionId,format,options             | ExportJob                | EXPORT-422-001          | export_job                                    |
| UNE-DOC-013 | GET        | /exports/{exportId}                                    | Export 상태·검증결과          | DOC_READ    | \-                                    | ExportJob                | EXPORT-404-001          | export_job,validation_report                  |
| UNE-DOC-014 | GET        | /exports/{exportId}/download                           | Export 파일 다운로드          | DOC_READ    | \-                                    | binary                   | EXPORT-410-001          | file_object,export_job                        |
| UNE-DOC-015 | POST       | /documents/{documentId}/submit-review                  | 검토 요청                     | DOC_EDIT    | reviewerIds,message                   | ReviewRequest            | REVIEW-422-001          | review_request,notification                   |
| UNE-DOC-016 | POST       | /documents/{documentId}/review-comments                | 검토의견 등록                 | DOC_REVIEW  | anchor,comment,severity               | ReviewComment            | REVIEW-422-002          | review_comment                                |
| UNE-DOC-017 | POST       | /documents/{documentId}/approve                        | 문서 승인                     | DOC_APPROVE | revisionId,comment                    | Document                 | APPROVAL-412-001        | document,approval,audit_log                   |

### UNE-DOC-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/files                                                                                  |
| 목적        | 파일 사전등록·업로드 URL 발급                                                                       |
| 필요 권한   | FILE_UPLOAD                                                                                         |
| Request     | fileName,size,mimeType,sha256                                                                       |
| Response    | FileObject+uploadUrl                                                                                |
| 오류        | FILE-422-001                                                                                        |
| DB          | file_object                                                                                         |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "FileObject+uploadUrl",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-DOC-005 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | GET /api/v1/documents/{documentId}/ir                                                               |
| 목적        | Document IR 조회                                                                                    |
| 필요 권한   | DOC_READ                                                                                            |
| Request     | revisionId                                                                                          |
| Response    | DocumentIR                                                                                          |
| 오류        | DOC-404-001                                                                                         |
| DB          | document_revision                                                                                   |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "DocumentIR",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

## 3.5 SIT - 상황·훈련·Provider·Fact·Snapshot

| **API ID**  | **Method** | **Endpoint**                                    | **기능**                | **권한**               | **핵심 요청**                             | **핵심 응답**        | **오류**                | **DB**                       |
|-------------|------------|-------------------------------------------------|-------------------------|------------------------|-------------------------------------------|----------------------|-------------------------|------------------------------|
| UNE-SIT-001 | POST       | /situations                                     | 실재난/훈련 등록        | SITUATION_CREATE       | mode,title,hazardType,occurredAt,location | Situation            | SIT-5001                | situation                    |
| UNE-SIT-002 | GET        | /situations                                     | 상황·훈련 목록          | SITUATION_READ         | mode,status,hazardType,page               | Page\<Situation\>    | SIT-5002                | situation                    |
| UNE-SIT-003 | GET        | /situations/{id}                                | 상황 상세               | SITUATION_READ         | id                                        | SituationDetail      | SIT-404-001             | situation,situation_snapshot |
| UNE-SIT-004 | PATCH      | /situations/{id}                                | 상황 기본정보 수정      | SITUATION_EDIT         | If-Match,patch                            | Situation            | SIT-409-001             | situation,audit_log          |
| UNE-SIT-005 | POST       | /situations/{id}/provider-queries               | 공식·보조 Provider 조회 | SITUATION_FACT_COLLECT | providers,query,featureFlags              | ProviderQueryJob     | PROV-503-001            | provider_job                 |
| UNE-SIT-006 | GET        | /provider-jobs/{jobId}/events                   | Provider 수집 SSE       | SITUATION_READ         | Last-Event-ID                             | SSE\<ProviderEvent\> | PROV-503-002            | provider_job,provider_result |
| UNE-SIT-007 | POST       | /situations/{id}/facts                          | 수동 Fact 등록          | SITUATION_FACT_EDIT    | factType,key,value,source,observedAt      | SituationFact        | FACT-422-001            | situation_fact,fact_source   |
| UNE-SIT-008 | PATCH      | /situations/{id}/facts/{factId}                 | 후보 Fact 보정          | SITUATION_FACT_EDIT    | If-Match,patch                            | SituationFact        | FACT-409-001            | situation_fact,audit_log     |
| UNE-SIT-009 | POST       | /situations/{id}/facts/deduplicate              | Fact 중복군 계산        | SITUATION_FACT_EDIT    | strategy,threshold                        | DuplicateGroup\[\]   | FACT-422-002            | fact_duplicate_group         |
| UNE-SIT-010 | GET        | /situations/{id}/conflicts                      | Fact 충돌 목록          | SITUATION_READ         | status                                    | Conflict\[\]         | FACT-404-002            | fact_conflict                |
| UNE-SIT-011 | POST       | /situations/{id}/conflicts/{conflictId}/resolve | Fact 충돌 확정          | SITUATION_CONFIRM      | selectedFactId,reason                     | ConflictResolution   | SIT-412-003             | conflict_resolution          |
| UNE-SIT-012 | POST       | /situations/{id}/snapshots                      | SituationSnapshot 확정  | SITUATION_CONFIRM      | factIds,resolutionIds,effectiveAt,reason  | SituationSnapshot    | SIT-412-003,SIT-422-006 | situation_snapshot,audit_log |
| UNE-SIT-013 | GET        | /situations/{id}/snapshots                      | Snapshot 목록·Diff      | SITUATION_READ         | compareTo                                 | Snapshot\[\]         | SIT-404-003             | situation_snapshot           |

### UNE-SIT-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/situations                                                                             |
| 목적        | 실재난/훈련 등록                                                                                    |
| 필요 권한   | SITUATION_CREATE                                                                                    |
| Request     | mode,title,hazardType,occurredAt,location                                                           |
| Response    | Situation                                                                                           |
| 오류        | SIT-5001                                                                                            |
| DB          | situation                                                                                           |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "Situation",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-SIT-005 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/situations/{id}/provider-queries                                                       |
| 목적        | 공식·보조 Provider 조회                                                                             |
| 필요 권한   | SITUATION_FACT_COLLECT                                                                              |
| Request     | providers,query,featureFlags                                                                        |
| Response    | ProviderQueryJob                                                                                    |
| 오류        | PROV-503-001                                                                                        |
| DB          | provider_job                                                                                        |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "ProviderQueryJob",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

## 3.6 KNOW - 자료학습·UNI 검색·Evidence

| **API ID**   | **Method** | **Endpoint**                         | **기능**              | **권한**         | **핵심 요청**                 | **핵심 응답**     | **오류**     | **DB**                           |
|--------------|------------|--------------------------------------|-----------------------|------------------|-------------------------------|-------------------|--------------|----------------------------------|
| UNE-KNOW-001 | POST       | /situations/{id}/knowledge-documents | 훈련·매뉴얼 자료 등록 | KNOWLEDGE_UPLOAD | fileId,documentType,metadata  | KnowledgeDocument | KNOW-422-001 | knowledge_document               |
| UNE-KNOW-002 | GET        | /knowledge-documents/{id}            | UNI 처리상태 조회     | KNOWLEDGE_READ   | \-                            | KnowledgeDocument | UNI-503-001  | knowledge_document,provider_job  |
| UNE-KNOW-003 | POST       | /knowledge-documents/{id}/retry      | UNI 학습 재시도       | KNOWLEDGE_UPLOAD | reason                        | KnowledgeDocument | UNI-409-001  | knowledge_document,provider_job  |
| UNE-KNOW-004 | POST       | /situations/{id}/evidence-searches   | UNI RAG 근거 검색     | EVIDENCE_SEARCH  | snapshotId,query,filters,topK | EvidenceSet       | UNI-422-002  | evidence_set,evidence_item       |
| UNE-KNOW-005 | GET        | /evidence-sets/{id}                  | EvidenceSet 조회      | EVIDENCE_READ    | \-                            | EvidenceSet       | EVID-404-001 | evidence_set,evidence_item       |
| UNE-KNOW-006 | POST       | /evidence-sets/{id}/lock             | EvidenceSet 고정      | EVIDENCE_LOCK    | reason                        | EvidenceSet       | EVID-409-001 | evidence_set,audit_log           |
| UNE-KNOW-007 | GET        | /evidence-items/{id}/source          | 근거 원문 위치 조회   | EVIDENCE_READ    | \-                            | SourceLocator     | EVID-404-002 | evidence_item,knowledge_document |

### UNE-KNOW-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/situations/{id}/knowledge-documents                                                    |
| 목적        | 훈련·매뉴얼 자료 등록                                                                               |
| 필요 권한   | KNOWLEDGE_UPLOAD                                                                                    |
| Request     | fileId,documentType,metadata                                                                        |
| Response    | KnowledgeDocument                                                                                   |
| 오류        | KNOW-422-001                                                                                        |
| DB          | knowledge_document                                                                                  |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "KnowledgeDocument",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-KNOW-005 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | GET /api/v1/evidence-sets/{id}                                                                      |
| 목적        | EvidenceSet 조회                                                                                    |
| 필요 권한   | EVIDENCE_READ                                                                                       |
| Request     | \-                                                                                                  |
| Response    | EvidenceSet                                                                                         |
| 오류        | EVID-404-001                                                                                        |
| DB          | evidence_set,evidence_item                                                                          |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "EvidenceSet",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

## 3.7 SOP - SOP 생성·Canvas·검증·승인·실행

| **API ID**  | **Method** | **Endpoint**                         | **기능**            | **권한**        | **핵심 요청**                                 | **핵심 응답**             | **오류**    | **DB**                                      |
|-------------|------------|--------------------------------------|---------------------|-----------------|-----------------------------------------------|---------------------------|-------------|---------------------------------------------|
| UNE-SOP-001 | POST       | /situations/{id}/sop-generation-jobs | UNI 구조화 SOP 생성 | SOP_GENERATE    | snapshotId,evidenceSetId,schemaVersion        | GenerationJob             | UNI-422-003 | generation_job                              |
| UNE-SOP-002 | GET        | /sop-generation-jobs/{jobId}/events  | SOP 생성 SSE        | SOP_READ        | Last-Event-ID                                 | SSE\<SopGenerationEvent\> | UNI-503-003 | generation_job,job_event                    |
| UNE-SOP-003 | POST       | /sops                                | SOP 정의 생성       | SOP_EDIT        | situationId,title,hazardType                  | Sop                       | SOP-6001    | sop                                         |
| UNE-SOP-004 | GET        | /sops                                | SOP 목록            | SOP_READ        | status,hazardType,page                        | Page\<Sop\>               | SOP-6002    | sop                                         |
| UNE-SOP-005 | GET        | /sops/{sopId}                        | SOP 그래프 조회     | SOP_READ        | versionId                                     | SopGraph                  | SOP-404-001 | sop,sop_version,sop_node,sop_edge           |
| UNE-SOP-006 | POST       | /sops/{sopId}/versions               | SOP Draft 버전 저장 | SOP_EDIT        | baseVersionId,nodes,edges                     | SopVersion                | SOP-409-001 | sop_version,sop_node,sop_edge               |
| UNE-SOP-007 | POST       | /sops/{sopId}/validate               | DAG·임무·분기 검증  | SOP_EDIT        | versionId                                     | SopValidationReport       | SOP-422-007 | sop_validation                              |
| UNE-SOP-008 | POST       | /sops/{sopId}/submit-review          | SOP 검토 요청       | SOP_EDIT        | versionId,reviewers                           | ReviewRequest             | SOP-412-001 | review_request                              |
| UNE-SOP-009 | POST       | /sops/{sopId}/approve                | SOP 승인·버전 고정  | SOP_APPROVE     | versionId,comment                             | SopVersion                | SOP-412-002 | sop_version,approval,audit_log              |
| UNE-SOP-010 | POST       | /sops/{sopId}/simulations            | Dry-run 시작        | SOP_RUN         | versionId,snapshotId,scenario                 | SopRun                    | SOP-422-008 | sop_run,task                                |
| UNE-SOP-011 | POST       | /sops/{sopId}/runs                   | 실행 시작           | SOP_RUN         | approvedVersionId,snapshotId,mode,startPolicy | SopRun                    | SOP-409-005 | sop_run,task,execution_event,outbox_message |
| UNE-SOP-012 | GET        | /sop-runs/{runId}                    | 실행 상세           | SOP_READ        | \-                                            | SopRunDetail              | SOP-404-002 | sop_run,task                                |
| UNE-SOP-013 | GET        | /sop-runs/{runId}/events             | 실행 SSE            | SOP_READ        | Last-Event-ID                                 | SSE\<ExecutionEvent\>     | SOP-503-001 | execution_event                             |
| UNE-SOP-014 | POST       | /sop-runs/{runId}/pause              | 실행 일시중지       | SOP_RUN_CONTROL | reason                                        | SopRun                    | SOP-409-006 | sop_run,execution_event                     |
| UNE-SOP-015 | POST       | /sop-runs/{runId}/resume             | 실행 재개           | SOP_RUN_CONTROL | reason                                        | SopRun                    | SOP-409-007 | sop_run,execution_event                     |
| UNE-SOP-016 | POST       | /sop-runs/{runId}/terminate          | 실행 강제종료       | SOP_RUN_CONTROL | reason,confirmCode                            | SopRun                    | SOP-409-008 | sop_run,task,execution_event,outbox_message |

### UNE-SOP-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/situations/{id}/sop-generation-jobs                                                    |
| 목적        | UNI 구조화 SOP 생성                                                                                 |
| 필요 권한   | SOP_GENERATE                                                                                        |
| Request     | snapshotId,evidenceSetId,schemaVersion                                                              |
| Response    | GenerationJob                                                                                       |
| 오류        | UNI-422-003                                                                                         |
| DB          | generation_job                                                                                      |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "GenerationJob",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-SOP-005 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | GET /api/v1/sops/{sopId}                                                                            |
| 목적        | SOP 그래프 조회                                                                                     |
| 필요 권한   | SOP_READ                                                                                            |
| Request     | versionId                                                                                           |
| Response    | SopGraph                                                                                            |
| 오류        | SOP-404-001                                                                                         |
| DB          | sop,sop_version,sop_node,sop_edge                                                                   |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "SopGraph",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

## 3.8 TASK - 임무·전파·현장보고·Escalation

| **API ID**   | **Method** | **Endpoint**                       | **기능**            | **권한**       | **핵심 요청**                            | **핵심 응답**  | **오류**       | **DB**                                              |
|--------------|------------|------------------------------------|---------------------|----------------|------------------------------------------|----------------|----------------|-----------------------------------------------------|
| UNE-TASK-001 | GET        | /tasks                             | 임무 목록           | TASK_READ      | assignee,status,situationId,due,page     | Page\<Task\>   | TASK-7001      | task,task_assignment                                |
| UNE-TASK-002 | GET        | /tasks/{taskId}                    | 임무 상세           | TASK_READ      | \-                                       | TaskDetail     | TASK-404-001   | task,task_event,task_attachment                     |
| UNE-TASK-003 | POST       | /tasks/{taskId}/dispatch           | 임무·상황 전파      | TASK_DISPATCH  | channels,recipients,messageTemplate      | Dispatch       | OUTBOX-503-001 | dispatch,dispatch_recipient,outbox_message          |
| UNE-TASK-004 | POST       | /tasks/{taskId}/acknowledge        | 수신확인            | TASK_ASSIGNEE  | receivedAt,deviceInfo                    | TaskEvent      | TASK-409-001   | task,task_event,execution_event                     |
| UNE-TASK-005 | POST       | /tasks/{taskId}/start              | 임무 착수           | TASK_ASSIGNEE  | startedAt,note                           | TaskEvent      | TASK-409-002   | task,task_event,execution_event                     |
| UNE-TASK-006 | POST       | /tasks/{taskId}/progress           | 진행보고            | TASK_ASSIGNEE  | progress,note,attachmentIds              | TaskEvent      | TASK-422-006   | task_event,execution_event                          |
| UNE-TASK-007 | POST       | /tasks/{taskId}/complete           | 완료보고            | TASK_ASSIGNEE  | completedAt,result,evidenceIds,checklist | TaskEvent      | TASK-422-008   | task,task_event,execution_event                     |
| UNE-TASK-008 | POST       | /tasks/{taskId}/approve-completion | 완료 승인           | TASK_SUPERVISE | comment                                  | TaskEvent      | TASK-409-004   | task,task_event,execution_event                     |
| UNE-TASK-009 | POST       | /tasks/{taskId}/reject-completion  | 완료 반려           | TASK_SUPERVISE | reason                                   | TaskEvent      | TASK-409-005   | task,task_event,execution_event,outbox_message      |
| UNE-TASK-010 | POST       | /tasks/{taskId}/reassign           | 임무 재배정         | TASK_SUPERVISE | assigneeId,reason                        | TaskEvent      | TASK-409-006   | task,task_assignment,execution_event,outbox_message |
| UNE-TASK-011 | POST       | /tasks/{taskId}/escalate           | Escalation          | TASK_SUPERVISE | level,reason,targetIds                   | TaskEvent      | TASK-409-007   | task_event,execution_event,outbox_message           |
| UNE-TASK-012 | POST       | /tasks/{taskId}/attachments        | 현장 파일 등록      | TASK_ASSIGNEE  | fileId,category,caption,geo              | TaskAttachment | FILE-422-003   | task_attachment,file_object                         |
| UNE-TASK-013 | GET        | /dispatches/{id}                   | 전파·수신 상태 조회 | TASK_READ      | \-                                       | DispatchStatus | DISP-404-001   | dispatch,dispatch_recipient,channel_delivery        |
| UNE-TASK-014 | POST       | /dispatches/{id}/retry             | 실패 수신자 재전파  | TASK_DISPATCH  | recipientIds,channelOverride             | Dispatch       | DISP-409-001   | outbox_message,outbox_attempt                       |

### UNE-TASK-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | GET /api/v1/tasks                                                                                   |
| 목적        | 임무 목록                                                                                           |
| 필요 권한   | TASK_READ                                                                                           |
| Request     | assignee,status,situationId,due,page                                                                |
| Response    | Page\<Task\>                                                                                        |
| 오류        | TASK-7001                                                                                           |
| DB          | task,task_assignment                                                                                |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "Page\<Task\>",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-TASK-005 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/tasks/{taskId}/start                                                                   |
| 목적        | 임무 착수                                                                                           |
| 필요 권한   | TASK_ASSIGNEE                                                                                       |
| Request     | startedAt,note                                                                                      |
| Response    | TaskEvent                                                                                           |
| 오류        | TASK-409-002                                                                                        |
| DB          | task,task_event,execution_event                                                                     |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "TaskEvent",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

## 3.9 JNL - 전자상황판·Execution Log·상황일지·평가

| **API ID**  | **Method** | **Endpoint**                            | **기능**                   | **권한**          | **핵심 요청**                             | **핵심 응답**          | **오류**        | **DB**                                        |
|-------------|------------|-----------------------------------------|----------------------------|-------------------|-------------------------------------------|------------------------|-----------------|-----------------------------------------------|
| UNE-JNL-001 | GET        | /situations/{id}/dashboard              | 전자상황판 집계            | DASHBOARD_READ    | at,runId                                  | DashboardView          | DASH-8001       | situation_snapshot,task,execution_event       |
| UNE-JNL-002 | GET        | /situations/{id}/execution-events       | Execution Log 조회         | EXECUTION_READ    | from,to,type,actor,page                   | Page\<ExecutionEvent\> | EXEC-8002       | execution_event                               |
| UNE-JNL-003 | GET        | /execution-events/{eventId}             | 원본 Event 상세            | EXECUTION_READ    | \-                                        | ExecutionEventDetail   | EXEC-404-001    | execution_event,task_event,dispatch           |
| UNE-JNL-004 | POST       | /execution-events/{eventId}/corrections | 정정 Event 추가            | EXECUTION_CORRECT | reason,replacementFields                  | ExecutionEvent         | EXEC-409-001    | execution_event,audit_log                     |
| UNE-JNL-005 | POST       | /situations/{id}/journal-projections    | 상황일지 Projection 생성   | JOURNAL_CREATE    | snapshotId,from,to,templateId,eventTypes  | Journal                | JOURNAL-412-001 | journal,journal_revision,journal_section      |
| UNE-JNL-006 | GET        | /journals/{journalId}                   | 상황일지 상세              | JOURNAL_READ      | revisionId                                | JournalDetail          | JOURNAL-404-001 | journal,journal_revision                      |
| UNE-JNL-007 | POST       | /journals/{journalId}/ai-draft-jobs     | 상황일지 서술 제안         | JOURNAL_AI_EDIT   | sections,styleRules                       | GenerationJob          | JOURNAL-422-004 | generation_job,ai_edit_proposal               |
| UNE-JNL-008 | POST       | /journals/{journalId}/changesets        | 상황일지 편집              | JOURNAL_EDIT      | baseRevisionId,operations                 | JournalRevision        | JOURNAL-409-001 | journal_revision,change_set                   |
| UNE-JNL-009 | POST       | /journals/{journalId}/submit-review     | 상황일지 검토요청          | JOURNAL_EDIT      | reviewers,message                         | ReviewRequest          | JOURNAL-412-002 | review_request                                |
| UNE-JNL-010 | POST       | /journals/{journalId}/approve           | 상황일지 승인              | JOURNAL_APPROVE   | revisionId,comment                        | Journal                | JOURNAL-412-003 | journal,approval                              |
| UNE-JNL-011 | POST       | /journals/{journalId}/exports           | 상황일지 HWPX/PDF/DOCX     | JOURNAL_EXPORT    | format,revisionId                         | ExportJob              | EXPORT-422-002  | export_job                                    |
| UNE-JNL-012 | POST       | /situations/{id}/close                  | 상황·훈련 종료             | SITUATION_CLOSE   | resultSummary,openTaskPolicy              | Situation              | SIT-412-010     | situation,sop_run,execution_event             |
| UNE-JNL-013 | POST       | /situations/{id}/evaluations            | 훈련 평가 생성             | EVALUATION_EDIT   | criteria,scores,comments,evidenceEventIds | Evaluation             | EVAL-422-001    | evaluation,evaluation_score                   |
| UNE-JNL-014 | POST       | /evaluations/{id}/improvements          | 개선조치 등록              | EVALUATION_EDIT   | actions,owners,dueDates                   | ImprovementPlan        | EVAL-422-002    | improvement_action                            |
| UNE-JNL-015 | GET        | /evaluations/{id}/report                | 만족도·잠재가치·평가보고서 | EVALUATION_READ   | format                                    | EvaluationReport       | EVAL-404-001    | evaluation,survey_response,improvement_action |

### UNE-JNL-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | GET /api/v1/situations/{id}/dashboard                                                               |
| 목적        | 전자상황판 집계                                                                                     |
| 필요 권한   | DASHBOARD_READ                                                                                      |
| Request     | at,runId                                                                                            |
| Response    | DashboardView                                                                                       |
| 오류        | DASH-8001                                                                                           |
| DB          | situation_snapshot,task,execution_event                                                             |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "DashboardView",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-JNL-005 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | POST /api/v1/situations/{id}/journal-projections                                                    |
| 목적        | 상황일지 Projection 생성                                                                            |
| 필요 권한   | JOURNAL_CREATE                                                                                      |
| Request     | snapshotId,from,to,templateId,eventTypes                                                            |
| Response    | Journal                                                                                             |
| 오류        | JOURNAL-412-001                                                                                     |
| DB          | journal,journal_revision,journal_section                                                            |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "Journal",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

## 3.10 ADMIN - 관리·감사·연계·보존

| **API ID**    | **Method** | **Endpoint**                      | **기능**                  | **권한**          | **핵심 요청**                      | **핵심 응답**         | **오류**       | **DB**                         |
|---------------|------------|-----------------------------------|---------------------------|-------------------|------------------------------------|-----------------------|----------------|--------------------------------|
| UNE-ADMIN-001 | GET        | /admin/access/summary             | 기관·사용자·RBAC 요약     | ADMIN_ACCESS      | \-                                 | AccessSummary         | ADMIN-9001     | tenant,app_user,role           |
| UNE-ADMIN-002 | PUT        | /admin/users/{id}/roles           | 사용자 역할 Binding       | ADMIN_ACCESS      | roleIds,scope                      | UserRole\[\]          | ADMIN-409-001  | user_role,audit_log            |
| UNE-ADMIN-003 | GET        | /admin/organization-bindings      | 조직·수신자 Binding 조회  | ADMIN_ORG         | \-                                 | Binding\[\]           | ADMIN-9002     | organization,recipient_binding |
| UNE-ADMIN-004 | POST       | /admin/organization-bindings      | 조직·채널 Binding 생성    | ADMIN_ORG         | orgId,recipientId,channels         | Binding               | ADMIN-422-001  | recipient_binding              |
| UNE-ADMIN-005 | GET        | /admin/audit-logs                 | 감사로그 검색             | AUDIT_READ        | actor,action,resource,from,to,page | Page\<AuditLog\>      | AUDIT-9001     | audit_log                      |
| UNE-ADMIN-006 | GET        | /admin/outbox                     | Outbox 운영조회           | ADMIN_OUTBOX      | status,channel,page                | Page\<OutboxMessage\> | OUTBOX-9001    | outbox_message,outbox_attempt  |
| UNE-ADMIN-007 | POST       | /admin/outbox/{id}/retry          | Outbox 수동 재처리        | ADMIN_OUTBOX      | reason                             | OutboxMessage         | OUTBOX-409-001 | outbox_message,outbox_attempt  |
| UNE-ADMIN-008 | GET        | /admin/provider-configs           | Provider·T3Q·UNI 설정조회 | ADMIN_INTEGRATION | \-                                 | ProviderConfig\[\]    | PROV-9001      | provider_config                |
| UNE-ADMIN-009 | PATCH      | /admin/provider-configs/{id}      | Provider 설정변경         | ADMIN_INTEGRATION | If-Match,patch                     | ProviderConfig        | PROV-409-001   | provider_config,audit_log      |
| UNE-ADMIN-010 | POST       | /admin/provider-configs/{id}/test | Provider 연결시험         | ADMIN_INTEGRATION | testMode                           | ProviderHealth        | PROV-503-010   | provider_health                |
| UNE-ADMIN-011 | GET        | /admin/retention-policies         | 보존정책 조회             | ADMIN_SECURITY    | \-                                 | RetentionPolicy\[\]   | RET-9001       | retention_policy               |
| UNE-ADMIN-012 | PATCH      | /admin/retention-policies/{id}    | 보존정책 변경             | ADMIN_SECURITY    | If-Match,patch                     | RetentionPolicy       | RET-409-001    | retention_policy,audit_log     |

### UNE-ADMIN-001 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | GET /api/v1/admin/access/summary                                                                    |
| 목적        | 기관·사용자·RBAC 요약                                                                               |
| 필요 권한   | ADMIN_ACCESS                                                                                        |
| Request     | \-                                                                                                  |
| Response    | AccessSummary                                                                                       |
| 오류        | ADMIN-9001                                                                                          |
| DB          | tenant,app_user,role                                                                                |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "AccessSummary",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

### UNE-ADMIN-005 상세 계약

| **항목**    | **상세**                                                                                            |
|-------------|-----------------------------------------------------------------------------------------------------|
| Method/Path | GET /api/v1/admin/audit-logs                                                                        |
| 목적        | 감사로그 검색                                                                                       |
| 필요 권한   | AUDIT_READ                                                                                          |
| Request     | actor,action,resource,from,to,page                                                                  |
| Response    | Page\<AuditLog\>                                                                                    |
| 오류        | AUDIT-9001                                                                                          |
| DB          | audit_log                                                                                           |
| 공통 통제   | Authorization, X-Correlation-Id, tenant scope, audit; 생성/상태변경은 Idempotency-Key와 동시성 검증 |

> {
>
> "requestExample": {
>
> "schemaVersion": "1.0",
>
> "clientRequestId": "crq_01...",
>
> "payload": "API별 Request Schema 참조"
>
> },
>
> "responseExample": {
>
> "success": true,
>
> "data": "Page\<AuditLog\>",
>
> "meta": {
>
> "correlationId": "corr_01..."
>
> }
>
> }
>
> }

# 4. T3Q·UNI·외부 Provider Adapter 명세

## 4.1 T3Q MOIS API 원본 목록

| **원본 ID** | **명칭**                     | **Method** | **Endpoint**                                      | **상태** | **UNE Adapter**                            |
|-------------|------------------------------|------------|---------------------------------------------------|----------|--------------------------------------------|
| API-LLM-001 | LLM 텍스트 생성              | POST       | /llms/v1/chat/completions                         | 운영     | T3Q Report/Situation Adapter 내부에서 호출 |
| API-EMB-001 | 텍스트 임베딩 변환           | POST       | /embeddings/bge-m3                                | 운영     | T3Q Report/Situation Adapter 내부에서 호출 |
| API-OCR-001 |                              |            |                                                   |          | T3Q Report/Situation Adapter 내부에서 호출 |
| API-AGT-001 | 문서 요약                    | POST       | /model-api/2b3df/agents/summary                   |          | T3Q Report/Situation Adapter 내부에서 호출 |
| API-RPT-001 | 재난안전계획서 목차 자동생성 | POST       | /model-api/ae894/reports/plan/toc                 | 운영     | T3Q Report/Situation Adapter 내부에서 호출 |
| API-RPT-002 | 재난안전계획서 본문 자동생성 | POST       | /model-api/ae894/reports/plan/content             | 운영     | T3Q Report/Situation Adapter 내부에서 호출 |
| API-RPT-003 | 일일상황일지 자동생성        | POST       | /model-api/ae894/reports/daily                    |          | T3Q Report/Situation Adapter 내부에서 호출 |
| API-RPT-004 | 문서 속 이미지 조회          | GET        | /model-api/ae894/documents/{id}/images/{image_Id} |          | T3Q Report/Situation Adapter 내부에서 호출 |
| API-RPT-005 | 문서 파일 다운로드           | GET        | /model-api/ae894/documents/{id}/download          |          | T3Q Report/Situation Adapter 내부에서 호출 |
| API-CHT-001 | 대화형 챗봇                  | POST       | /model-api/93c49/chat                             | 운영     | T3Q Report/Situation Adapter 내부에서 호출 |
| API-CHT-002 | 문서 열람                    | POST       | /model-api/93c49/documents                        | 운영     | T3Q Report/Situation Adapter 내부에서 호출 |
| API-CHT-003 | 문서 이미지 미리보기         | GET        | /model-api/93c49/documents/{id}/preview           | 운영     | T3Q Report/Situation Adapter 내부에서 호출 |
| API-CHT-004 | 문서 파일 다운로드           | GET        | /model-api/93c49/documents/{id}/download          | 운영     | T3Q Report/Situation Adapter 내부에서 호출 |

## 4.2 T3Q RPT-001/002 변환 계약

| **항목**      | **RPT-001 목차**           | **RPT-002 본문**                          |
|---------------|----------------------------|-------------------------------------------|
| 호출 주체     | UNE Plan Generation Worker | UNE Plan Generation Worker                |
| 입력 기준     | 확정 PlanContextSnapshot   | 확정 Snapshot + TocVersion                |
| 응답 방식     | JSON 동기 또는 Job         | SSE/비동기 Job                            |
| UNE Canonical | TocVersion/TocNode         | GeneratedBlock/EvidenceLink               |
| 재시도        | 전체 또는 요청옵션 변경    | 실패 Block 단위                           |
| 보호          | 계층·제목 Schema 검증      | 사용자 수정 Block 덮어쓰기 금지           |
| 금지          | UNI 호출, Snapshot 수정    | 근거 없는 사실값 생성                     |
| Timeout/CB    | 연결 5초, 응답 60초 기본   | 연결 5초, SSE heartbeat 15초, 총시간 정책 |

## 4.3 UNI OpenAPI 원본 목록

| **ID**  | **Method** | **Path**                            | **Summary**             | **UNE 사용** |
|---------|------------|-------------------------------------|-------------------------|--------------|
| UNI-001 | POST       | /auth/login                         | Login                   | 관리/보조    |
| UNI-002 | GET        | /auth/directory                     | Directory               | 관리/보조    |
| UNI-003 | GET        | /chat/files/{file_id}               | Download Generated File | 관리/보조    |
| UNI-004 | POST       | /chat/                              | Chat                    | POC 대상     |
| UNI-005 | POST       | /chat/json                          | Chat Json               | POC 대상     |
| UNI-006 | POST       | /documents/upload                   | Upload Document         | POC 대상     |
| UNI-007 | POST       | /documents/upload-urls              | Upload From Urls        | 관리/보조    |
| UNI-008 | GET        | /documents/                         | List Documents          | 관리/보조    |
| UNI-009 | GET        | /documents/{doc_id}/reference       | Get Reference           | 관리/보조    |
| UNI-010 | POST       | /documents/retry-errors             | Retry Errors            | 관리/보조    |
| UNI-011 | POST       | /documents/{doc_id}/retry-reference | Retry Reference         | 관리/보조    |
| UNI-012 | DELETE     | /documents/{doc_id}                 | Delete Doc              | 관리/보조    |
| UNI-013 | POST       | /documents/bulk-folder              | Bulk Folder             | 관리/보조    |
| UNI-014 | GET        | /models/                            | List Models             | 관리/보조    |
| UNI-015 | GET        | /sessions/events                    | Session Events          | 관리/보조    |
| UNI-016 | GET        | /sessions/                          | List Sessions           | 관리/보조    |
| UNI-017 | GET        | /sessions/{session_id}              | Get Session             | 관리/보조    |
| UNI-018 | PATCH      | /sessions/{session_id}/model        | Update Model            | 관리/보조    |
| UNI-019 | PATCH      | /sessions/{session_id}/title        | Update Title            | 관리/보조    |
| UNI-020 | PATCH      | /sessions/{session_id}/favorite     | Update Favorite         | 관리/보조    |
| UNI-021 | PATCH      | /sessions/{session_id}/folder       | Update Folder           | 관리/보조    |
| UNI-022 | GET        | /image/health                       | Health                  | 관리/보조    |
| UNI-023 | POST       | /image/                             | Create Image            | 관리/보조    |
| UNI-024 | POST       | /search/                            | Search Knowledge        | POC 대상     |
| UNI-025 | GET        | /health                             | Health                  | 관리/보조    |

## 4.4 UNI Anti-Corruption Layer

| **UNE 기능** | **UNI 원본**              | **Adapter 처리**                                   | **저장**                           |
|--------------|---------------------------|----------------------------------------------------|------------------------------------|
| 문서 업로드  | POST /documents/upload    | 파일ID·메타 변환, 처리상태 Polling, 오류 정규화    | know_document, prov_job            |
| 근거 검색    | POST /search/             | Snapshot→query/filter, Top-K 중복제거, 권한필터    | know_evidence_set/item             |
| 구조화 SOP   | POST /chat/json           | compns/JSON을 버전별 UniSopMapper로 Node/Edge 변환 | sop_version/node/edge              |
| 스트리밍 SOP | POST /chat/               | SSE를 UNE JobEvent로 변환, Last-Event-ID 재접속    | job_generation/job_event           |
| 파일 조회    | GET /chat/files/{file_id} | MIME·악성코드 검사, Object Storage 반입            | file_object                        |
| 조직 조회    | GET /auth/directory       | UNE 조직 Master 우선, 외부 ID Binding              | iam_organization/recipient_binding |

## 4.5 공식·보조 상황정보 Provider

| **Provider**         | **우선순위** | **호출 정책**                     | **Fact 처리**                        | **장애 시**          |
|----------------------|--------------|-----------------------------------|--------------------------------------|----------------------|
| KMA                  | 1            | 공식 API/수집 Agent 계약          | 기상·특보 후보 Fact                  | MOIS 또는 수동입력   |
| MOIS                 | 1            | 공식 API, T3Q Adapter 활성화 가능 | 재난현황·대응 후보 Fact              | KMA/지자체 자료      |
| SafeKorea/국민안전24 | 2            | 공식 출처 보조                    | 공지·행동요령·현황 보조              | 기존 Fact 유지       |
| Naver                | 3            | 사용자 요청 + Feature Flag        | 뉴스/검색은 참고 근거, 자동확정 금지 | 기능 비활성·수동자료 |
| Manual/File          | Fallback     | 사용자 등록·출처 필수             | 후보 Fact                            | 검토·확정 필요       |

- 운영에서 SSL 검증 비활성화를 허용하지 않는다. 인증서 문제는 신뢰 CA 등록과 정식 인증서로 해결한다.

- Provider 원본 Schema는 Adapter 밖으로 노출하지 않고 Canonical SituationFact/Evidence/SOP Contract로 변환한다.

- 모든 원본 응답은 개인정보·라이선스·보존정책을 확인한 뒤 원문 파일 또는 hash를 저장한다.

# 5. DB 논리 설계

## 5.1 도메인·Aggregate

| **도메인** | **주요 Entity**                                               | **Aggregate Root**    |
|------------|---------------------------------------------------------------|-----------------------|
| IAM        | Tenant, Organization, User, Role, Permission                  | User/Role Binding     |
| PLAN       | Plan, PlanContextSnapshot, TocVersion, GenerationJob          | Plan                  |
| DOCUMENT   | Document, Revision, Block, ChangeSet, TemplateProfile, Export | Document              |
| SITUATION  | Situation, SituationFact, FactConflict, SituationSnapshot     | Situation             |
| KNOWLEDGE  | KnowledgeDocument, EvidenceSet, EvidenceItem                  | EvidenceSet           |
| SOP        | Sop, SopVersion, SopNode, SopEdge, SopRun                     | SopVersion/SopRun     |
| TASK       | Task, TaskEvent, Attachment, Dispatch                         | Task                  |
| EVENT      | ExecutionEvent, OutboxMessage, AuditLog                       | ExecutionEvent/Outbox |
| JOURNAL    | Journal, ProjectionItem, Review, Export                       | Journal               |
| EVALUATION | Evaluation, Score, ImprovementAction                          | Evaluation            |
| ADMIN      | ProviderConfig, RetentionPolicy, Notification                 | ProviderConfig        |

## 5.2 핵심 관계

> iam_tenant 1---N iam_user / iam_organization / business aggregates
>
> plan_plan 1---N plan_context_snapshot
>
> plan_plan 1---N plan_toc_version 1---N plan_toc_node
>
> plan_plan 1---1 doc_document 1---N doc_revision 1---N doc_block
>
> doc_revision 1---N doc_change_set 1---N doc_change_operation
>
> sit_situation 1---N sit_fact N---1 sit_fact_source
>
> sit_situation 1---N sit_snapshot
>
> sit_situation 1---N know_evidence_set 1---N know_evidence_item
>
> sop_sop 1---N sop_version 1---N sop_node / sop_edge
>
> sop_version 1---N sop_run 1---N task_task 1---N task_event
>
> state-changing transaction -\> event_execution + event_outbox
>
> sit_snapshot + event_execution -\> jnl_journal -\> doc_document/revision
>
> eval_evaluation -\> eval_score + eval_improvement_action -\> next Plan/SOP revision

## 5.3 사실·버전·원장 원칙

- PlanContextSnapshot, SituationSnapshot, Approved SopVersion은 불변이며 수정 대신 새 버전을 생성한다.

- Document Revision은 부모 Revision을 참조하고 ChangeSet과 Operation으로 변경 근거를 보존한다.

- SituationFact는 후보·확정·기각 상태를 가지며 Snapshot 확정 시점의 Fact JSON과 hash를 고정한다.

- ExecutionEvent는 업무시각과 기록시각을 분리하고 정정 Event가 원본을 참조한다.

- 상황일지는 Snapshot과 Execution Log의 Projection이며 AI 서술은 잠금 사실값을 변경할 수 없다.

## 5.4 데이터 분류·보안

| **분류**      | **예시**                        | **저장·표시 통제**                          |
|---------------|---------------------------------|---------------------------------------------|
| 공개/일반     | 재난유형, SOP 공개문구          | 일반 접근통제                               |
| 내부업무      | 계획서 초안, 상황일지, 실행이력 | 기관·객체 RBAC, 감사                        |
| 개인정보      | 성명, 전화, 이메일, 현장담당자  | 컬럼 암호화, 화면 마스킹, 다운로드 감사     |
| 민감 현장정보 | 위치, 피해, 통제, 내부연락망    | 최소권한, 보존정책, 외부 Provider 전송 제한 |
| Secret        | API Key, Token                  | Vault/KMS 참조만 DB 저장                    |

# 6. DB 물리 설계·데이터사전

PostgreSQL 16 이상을 기준으로 총 57개 핵심 물리 테이블을 정의한다. 테이블명은 구현 시 schema.table 형태(iam.user 등)로 분리할 수 있으며 본 문서에서는 검색성을 위해 접두어를 사용한다.

## 6.1 공통 물리 규칙

- PK는 서버 생성 UUID v7을 권고하고 외부에 순차 정수 PK를 노출하지 않는다.

- 모든 업무테이블은 tenant_id 또는 상위 FK를 통해 tenant를 판정하며 PostgreSQL RLS 또는 Service Layer 강제조건을 적용한다.

- 상태는 varchar + CHECK 또는 코드테이블을 사용하며 변경비용이 큰 DB enum은 제한한다.

- 외부 원문·Document IR·Snapshot은 JSONB로 보존하되 자주 검색하는 Key는 정규 컬럼으로 투영한다.

- HWPX/PDF/이미지/동영상은 Object Storage에 저장하고 DB에는 storage_key, hash, size, MIME, scan_status만 둔다.

- event_execution과 admin_audit_log는 월 단위 RANGE Partition, Outbox는 상태 Partial Index를 적용한다.

- created_at/updated_at은 DB default now(), 업무시간은 명시적 timestamptz로 입력한다.

## 6.2 테이블 요약

| **테이블**              | **도메인** | **컬럼수** | **주요 컬럼**                                                                             |
|-------------------------|------------|------------|-------------------------------------------------------------------------------------------|
| iam_tenant              | IAM        | 7          | tenant_id, tenant_code, tenant_name, status, timezone ...                                 |
| iam_organization        | IAM        | 9          | organization_id, tenant_id, parent_id, org_code, org_name ...                             |
| iam_user                | IAM        | 10         | user_id, tenant_id, external_user_id, login_id, display_name ...                          |
| iam_role                | IAM        | 7          | role_id, tenant_id, role_code, role_name, scope_type ...                                  |
| iam_permission          | IAM        | 5          | permission_id, permission_code, resource_type, action, description                        |
| iam_user_role           | IAM        | 8          | user_role_id, user_id, role_id, scope_id, valid_from ...                                  |
| iam_user_session        | IAM        | 8          | session_id, user_id, refresh_hash, issued_at, expires_at ...                              |
| plan_plan               | PLAN       | 12         | plan_id, tenant_id, title, hazard_type, management_phase ...                              |
| plan_context_draft      | PLAN       | 6          | context_draft_id, plan_id, context_json, schema_version, updated_by ...                   |
| plan_context_snapshot   | PLAN       | 8          | context_snapshot_id, plan_id, version_no, context_json, content_hash ...                  |
| plan_toc_version        | PLAN       | 9          | toc_version_id, plan_id, version_no, source_type, base_snapshot_id ...                    |
| plan_toc_node           | PLAN       | 8          | toc_node_id, toc_version_id, parent_node_id, node_key, title ...                          |
| job_generation          | JOB        | 14         | job_id, tenant_id, job_type, aggregate_type, aggregate_id ...                             |
| job_event               | JOB        | 6          | job_event_id, job_id, sequence_no, event_type, payload_json ...                           |
| doc_document            | DOC        | 10         | document_id, tenant_id, document_type, title, source_file_id ...                          |
| doc_revision            | DOC        | 9          | revision_id, document_id, revision_no, parent_revision_id, ir_json ...                    |
| doc_block               | DOC        | 10         | block_id, revision_id, stable_block_key, block_type, parent_block_id ...                  |
| doc_change_set          | DOC        | 9          | change_set_id, document_id, base_revision_id, result_revision_id, client_mutation_id ...  |
| doc_change_operation    | DOC        | 7          | operation_id, change_set_id, operation_order, operation_type, target_json ...             |
| doc_template_profile    | DOC        | 8          | template_profile_id, document_id, profile_version, analysis_status, profile_json ...      |
| doc_prototype_registry  | DOC        | 7          | prototype_id, template_profile_id, prototype_key, prototype_type, source_locator_json ... |
| file_object             | FILE       | 10         | file_id, tenant_id, storage_key, original_name, mime_type ...                             |
| doc_export_job          | DOC        | 10         | export_id, document_id, revision_id, format, status ...                                   |
| doc_validation_report   | DOC        | 9          | validation_report_id, target_type, target_id, track, status ...                           |
| sit_situation           | SIT        | 12         | situation_id, tenant_id, mode, title, hazard_type ...                                     |
| sit_fact_source         | SIT        | 8          | source_id, provider_code, source_type, source_name, source_uri ...                        |
| sit_fact                | SIT        | 11         | fact_id, situation_id, fact_type, fact_key, value_json ...                                |
| sit_fact_conflict       | SIT        | 7          | conflict_id, situation_id, fact_key, candidate_fact_ids, conflict_type ...                |
| sit_conflict_resolution | SIT        | 6          | resolution_id, conflict_id, selected_fact_id, reason, resolved_by ...                     |
| sit_snapshot            | SIT        | 9          | snapshot_id, situation_id, version_no, facts_json, content_hash ...                       |
| prov_job                | PROV       | 9          | provider_job_id, situation_id, provider_code, request_json, status ...                    |
| know_document           | KNOW       | 10         | knowledge_document_id, tenant_id, situation_id, file_id, document_type ...                |
| know_evidence_set       | KNOW       | 10         | evidence_set_id, situation_id, snapshot_id, query_text, filters_json ...                  |
| know_evidence_item      | KNOW       | 9          | evidence_item_id, evidence_set_id, knowledge_document_id, provider_chunk_id, rank_no ...  |
| sop_sop                 | SOP        | 9          | sop_id, tenant_id, situation_id, title, hazard_type ...                                   |
| sop_version             | SOP        | 10         | sop_version_id, sop_id, version_no, status, graph_hash ...                                |
| sop_node                | SOP        | 9          | node_id, sop_version_id, node_key, node_type, title ...                                   |
| sop_edge                | SOP        | 8          | edge_id, sop_version_id, from_node_id, to_node_id, condition_expr ...                     |
| sop_validation          | SOP        | 8          | validation_id, sop_version_id, status, errors_json, warnings_json ...                     |
| sop_run                 | SOP        | 10         | run_id, sop_version_id, situation_id, snapshot_id, mode ...                               |
| task_task               | TASK       | 12         | task_id, run_id, node_id, title, status ...                                               |
| task_event              | TASK       | 8          | task_event_id, task_id, event_type, event_time, actor_id ...                              |
| task_attachment         | TASK       | 8          | task_attachment_id, task_id, file_id, category, caption ...                               |
| msg_dispatch            | MSG        | 8          | dispatch_id, task_id, situation_id, message_type, message_body ...                        |
| msg_dispatch_recipient  | MSG        | 8          | recipient_id, dispatch_id, user_id, organization_id, channel ...                          |
| event_execution         | EVENT      | 13         | execution_event_id, tenant_id, situation_id, aggregate_type, aggregate_id ...             |
| event_outbox            | EVENT      | 12         | outbox_id, tenant_id, aggregate_type, aggregate_id, event_type ...                        |
| event_outbox_attempt    | EVENT      | 9          | attempt_id, outbox_id, attempt_no, started_at, finished_at ...                            |
| jnl_journal             | JNL        | 10         | journal_id, situation_id, snapshot_id, document_id, period_start ...                      |
| jnl_projection_item     | JNL        | 8          | projection_item_id, journal_id, section_key, source_event_ids, fact_payload_json ...      |
| eval_evaluation         | EVAL       | 8          | evaluation_id, situation_id, status, evaluation_type, overall_score ...                   |
| eval_score              | EVAL       | 7          | score_id, evaluation_id, criterion_code, score_value, weight_value ...                    |
| eval_improvement_action | EVAL       | 8          | action_id, evaluation_id, action_text, owner_user_id, due_at ...                          |
| admin_provider_config   | ADMIN      | 10         | provider_config_id, tenant_id, provider_code, enabled, priority_no ...                    |
| admin_audit_log         | ADMIN      | 12         | audit_id, tenant_id, actor_id, action, resource_type ...                                  |
| admin_retention_policy  | ADMIN      | 8          | retention_policy_id, tenant_id, resource_type, retention_days, archive_strategy ...       |
| admin_notification      | ADMIN      | 10         | notification_id, tenant_id, user_id, notification_type, severity ...                      |

### 6.3 iam_tenant

| **컬럼**    | **PostgreSQL 타입** | **제약** | **설명**         |
|-------------|---------------------|----------|------------------|
| tenant_id   | uuid                | PK       | 기관/테넌트 ID   |
| tenant_code | varchar(30)         | UK,NN    | 기관 코드        |
| tenant_name | varchar(200)        | NN       | 기관명           |
| status      | varchar(20)         | NN,CHECK | ACTIVE/SUSPENDED |
| timezone    | varchar(50)         | NN       | Asia/Seoul       |
| created_at  | timestamptz         | NN       | 생성일시         |
| updated_at  | timestamptz         | NN       | 수정일시         |

| **ID**               | **정의**                                        | **목적**       |
|----------------------|-------------------------------------------------|----------------|
| IX-iam_tenant-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.4 iam_organization

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명** |
|-----------------|---------------------|----------|----------|
| organization_id | uuid                | PK       | 조직 ID  |
| tenant_id       | uuid                | FK,NN    | 기관     |
| parent_id       | uuid                | FK       | 상위조직 |
| org_code        | varchar(50)         | NN       | 조직코드 |
| org_name        | varchar(200)        | NN       | 조직명   |
| org_path        | ltree/text          | NN       | 계층경로 |
| sort_order      | int                 | NN       | 정렬     |
| status          | varchar(20)         | NN       | 상태     |
| version_no      | int                 | NN       | 낙관잠금 |

| **ID**                     | **정의**                                        | **목적**       |
|----------------------------|-------------------------------------------------|----------------|
| IX-iam_organization-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.5 iam_user

| **컬럼**         | **PostgreSQL 타입** | **제약** | **설명**           |
|------------------|---------------------|----------|--------------------|
| user_id          | uuid                | PK       | 사용자             |
| tenant_id        | uuid                | FK,NN    | 기관               |
| external_user_id | varchar(100)        | UK       | T3Q 외부 사용자 ID |
| login_id         | varchar(100)        | NN       | 로그인 ID          |
| display_name     | varchar(100)        | NN       | 성명               |
| organization_id  | uuid                | FK       | 소속               |
| email_enc        | bytea               | \-       | 암호화 이메일      |
| phone_enc        | bytea               | \-       | 암호화 전화번호    |
| status           | varchar(20)         | NN       | 상태               |
| last_login_at    | timestamptz         | \-       | 최근 로그인        |

| **ID**             | **정의**                                        | **목적**       |
|--------------------|-------------------------------------------------|----------------|
| IX-iam_user-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.6 iam_role

| **컬럼**   | **PostgreSQL 타입** | **제약** | **설명**             |
|------------|---------------------|----------|----------------------|
| role_id    | uuid                | PK       | 역할                 |
| tenant_id  | uuid                | FK       | NULL이면 시스템 역할 |
| role_code  | varchar(60)         | NN       | 역할코드             |
| role_name  | varchar(120)        | NN       | 역할명               |
| scope_type | varchar(30)         | NN       | SYSTEM/TENANT/OBJECT |
| is_system  | boolean             | NN       | 시스템 역할          |
| version_no | int                 | NN       | 버전                 |

| **ID**             | **정의**                                        | **목적**       |
|--------------------|-------------------------------------------------|----------------|
| IX-iam_role-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.7 iam_permission

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명** |
|-----------------|---------------------|----------|----------|
| permission_id   | uuid                | PK       | 권한     |
| permission_code | varchar(80)         | UK,NN    | 권한코드 |
| resource_type   | varchar(40)         | NN       | 자원     |
| action          | varchar(40)         | NN       | 행위     |
| description     | varchar(300)        | \-       | 설명     |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.8 iam_user_role

| **컬럼**     | **PostgreSQL 타입** | **제약** | **설명**       |
|--------------|---------------------|----------|----------------|
| user_role_id | uuid                | PK       | Binding        |
| user_id      | uuid                | FK,NN    | 사용자         |
| role_id      | uuid                | FK,NN    | 역할           |
| scope_id     | uuid                | \-       | 기관/객체 범위 |
| valid_from   | timestamptz         | \-       | 유효시작       |
| valid_to     | timestamptz         | \-       | 유효종료       |
| granted_by   | uuid                | FK,NN    | 부여자         |
| created_at   | timestamptz         | NN       | 부여일시       |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.9 iam_user_session

| **컬럼**     | **PostgreSQL 타입** | **제약** | **설명**           |
|--------------|---------------------|----------|--------------------|
| session_id   | uuid                | PK       | 세션               |
| user_id      | uuid                | FK,NN    | 사용자             |
| refresh_hash | char(64)            | NN       | Refresh Token hash |
| issued_at    | timestamptz         | NN       | 발급               |
| expires_at   | timestamptz         | NN       | 만료               |
| revoked_at   | timestamptz         | \-       | 폐기               |
| client_ip    | inet                | \-       | IP                 |
| user_agent   | text                | \-       | UA                 |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.10 plan_plan

| **컬럼**                    | **PostgreSQL 타입** | **제약** | **설명**      |
|-----------------------------|---------------------|----------|---------------|
| plan_id                     | uuid                | PK       | 계획서        |
| tenant_id                   | uuid                | FK,NN    | 기관          |
| title                       | varchar(300)        | NN       | 문서명        |
| hazard_type                 | varchar(50)         | NN       | 재난유형      |
| management_phase            | varchar(20)         | NN       | 예방/대비     |
| status                      | varchar(30)         | NN       | 상태          |
| document_id                 | uuid                | FK       | 편집문서      |
| current_context_snapshot_id | uuid                | FK       | 현재 기준정보 |
| current_toc_version_id      | uuid                | FK       | 현재 목차     |
| owner_id                    | uuid                | FK,NN    | 소유자        |
| version_no                  | int                 | NN       | 낙관잠금      |
| deleted_at                  | timestamptz         | \-       | 휴지통        |

| **ID**              | **정의**                                        | **목적**       |
|---------------------|-------------------------------------------------|----------------|
| IX-plan_plan-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |
| IX-plan_plan-STATUS | (tenant_id, status, updated_at/created_at DESC) | 목록·상태 조회 |

### 6.11 plan_context_draft

| **컬럼**         | **PostgreSQL 타입** | **제약** | **설명**      |
|------------------|---------------------|----------|---------------|
| context_draft_id | uuid                | PK       | 임시 기준정보 |
| plan_id          | uuid                | FK,NN    | 계획서        |
| context_json     | jsonb               | NN       | 입력값        |
| schema_version   | varchar(20)         | NN       | Schema 버전   |
| updated_by       | uuid                | FK,NN    | 수정자        |
| updated_at       | timestamptz         | NN       | 수정일시      |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.12 plan_context_snapshot

| **컬럼**            | **PostgreSQL 타입** | **제약** | **설명**      |
|---------------------|---------------------|----------|---------------|
| context_snapshot_id | uuid                | PK       | 확정 Snapshot |
| plan_id             | uuid                | FK,NN    | 계획서        |
| version_no          | int                 | NN       | 버전          |
| context_json        | jsonb               | NN       | 불변 기준정보 |
| content_hash        | char(64)            | NN       | SHA-256       |
| supersedes_id       | uuid                | FK       | 이전 Snapshot |
| confirmed_by        | uuid                | FK,NN    | 확정자        |
| confirmed_at        | timestamptz         | NN       | 확정일시      |

| **ID**     | **정의**                                | **목적**       |
|------------|-----------------------------------------|----------------|
| UK-version | UNIQUE(parent aggregate id, version_no) | 버전 중복 차단 |

### 6.13 plan_toc_version

| **컬럼**         | **PostgreSQL 타입** | **제약** | **설명**        |
|------------------|---------------------|----------|-----------------|
| toc_version_id   | uuid                | PK       | 목차 버전       |
| plan_id          | uuid                | FK,NN    | 계획서          |
| version_no       | int                 | NN       | 버전            |
| source_type      | varchar(20)         | NN       | AI/USER         |
| base_snapshot_id | uuid                | FK,NN    | 기준 Snapshot   |
| status           | varchar(20)         | NN       | DRAFT/CONFIRMED |
| content_hash     | char(64)            | NN       | 해시            |
| created_by       | uuid                | FK,NN    | 작성자          |
| created_at       | timestamptz         | NN       | 생성            |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.14 plan_toc_node

| **컬럼**          | **PostgreSQL 타입** | **제약** | **설명** |
|-------------------|---------------------|----------|----------|
| toc_node_id       | uuid                | PK       | 목차노드 |
| toc_version_id    | uuid                | FK,NN    | 버전     |
| parent_node_id    | uuid                | FK       | 부모     |
| node_key          | varchar(80)         | NN       | 안정 ID  |
| title             | varchar(500)        | NN       | 제목     |
| level             | smallint            | NN       | 계층     |
| sort_order        | int                 | NN       | 순서     |
| generation_policy | jsonb               | NN       | 생성규칙 |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.15 job_generation

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명**                |
|-----------------|---------------------|----------|-------------------------|
| job_id          | uuid                | PK       | 비동기 Job              |
| tenant_id       | uuid                | FK,NN    | 기관                    |
| job_type        | varchar(30)         | NN       | TOC/CONTENT/AI_EDIT/SOP |
| aggregate_type  | varchar(30)         | NN       | PLAN/DOCUMENT/SITUATION |
| aggregate_id    | uuid                | NN       | 대상                    |
| provider_code   | varchar(30)         | NN       | T3Q/UNI/UNE             |
| request_json    | jsonb               | NN       | Adapter 요청            |
| status          | varchar(20)         | NN       | QUEUED~FAILED           |
| progress_pct    | numeric(5,2)        | NN       | 진행률                  |
| idempotency_key | varchar(100)        | NN       | 멱등키                  |
| correlation_id  | varchar(80)         | NN       | 추적                    |
| error_json      | jsonb               | \-       | 오류                    |
| started_at      | timestamptz         | \-       | 시작                    |
| finished_at     | timestamptz         | \-       | 종료                    |

| **ID**                   | **정의**                                        | **목적**       |
|--------------------------|-------------------------------------------------|----------------|
| IX-job_generation-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.16 job_event

| **컬럼**     | **PostgreSQL 타입** | **제약** | **설명**   |
|--------------|---------------------|----------|------------|
| job_event_id | bigserial           | PK       | Job Event  |
| job_id       | uuid                | FK,NN    | Job        |
| sequence_no  | bigint              | NN       | SSE 순번   |
| event_type   | varchar(40)         | NN       | Event 종류 |
| payload_json | jsonb               | NN       | 내용       |
| created_at   | timestamptz         | NN       | 생성       |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.17 doc_document

| **컬럼**            | **PostgreSQL 타입** | **제약** | **설명**                |
|---------------------|---------------------|----------|-------------------------|
| document_id         | uuid                | PK       | 문서                    |
| tenant_id           | uuid                | FK,NN    | 기관                    |
| document_type       | varchar(30)         | NN       | PLAN/JOURNAL            |
| title               | varchar(300)        | NN       | 제목                    |
| source_file_id      | uuid                | FK       | 원본 HWPX               |
| current_revision_id | uuid                | FK       | 현재 Revision           |
| status              | varchar(30)         | NN       | EDITING/REVIEW/APPROVED |
| owner_id            | uuid                | FK,NN    | 소유자                  |
| created_at          | timestamptz         | NN       | 생성                    |
| updated_at          | timestamptz         | NN       | 수정                    |

| **ID**                 | **정의**                                        | **목적**       |
|------------------------|-------------------------------------------------|----------------|
| IX-doc_document-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |
| IX-doc_document-STATUS | (tenant_id, status, updated_at/created_at DESC) | 목록·상태 조회 |

### 6.18 doc_revision

| **컬럼**           | **PostgreSQL 타입** | **제약** | **설명**    |
|--------------------|---------------------|----------|-------------|
| revision_id        | uuid                | PK       | Revision    |
| document_id        | uuid                | FK,NN    | 문서        |
| revision_no        | int                 | NN       | 순번        |
| parent_revision_id | uuid                | FK       | 부모        |
| ir_json            | jsonb               | NN       | Document IR |
| ir_hash            | char(64)            | NN       | 해시        |
| change_summary     | text                | \-       | 변경요약    |
| created_by         | uuid                | FK,NN    | 작성자      |
| created_at         | timestamptz         | NN       | 생성        |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.19 doc_block

| **컬럼**         | **PostgreSQL 타입** | **제약** | **설명**                       |
|------------------|---------------------|----------|--------------------------------|
| block_id         | uuid                | PK       | Block                          |
| revision_id      | uuid                | FK,NN    | Revision                       |
| stable_block_key | varchar(100)        | NN       | 안정 ID                        |
| block_type       | varchar(30)         | NN       | PARAGRAPH/TABLE/...            |
| parent_block_id  | uuid                | FK       | 부모                           |
| sort_order       | int                 | NN       | 순서                           |
| text_content     | text                | \-       | 검색용 텍스트                  |
| style_ref        | varchar(100)        | \-       | 서식 참조                      |
| protection_state | varchar(20)         | NN       | NONE/USER_LOCKED/SYSTEM_LOCKED |
| payload_json     | jsonb               | NN       | IR 세부                        |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.20 doc_change_set

| **컬럼**           | **PostgreSQL 타입** | **제약** | **설명**          |
|--------------------|---------------------|----------|-------------------|
| change_set_id      | uuid                | PK       | 변경세트          |
| document_id        | uuid                | FK,NN    | 문서              |
| base_revision_id   | uuid                | FK,NN    | 기준              |
| result_revision_id | uuid                | FK       | 결과              |
| client_mutation_id | varchar(100)        | NN       | 클라이언트 멱등키 |
| selection_json     | jsonb               | NN       | 선택영역          |
| status             | varchar(20)         | NN       | APPLIED/REJECTED  |
| created_by         | uuid                | FK,NN    | 사용자            |
| created_at         | timestamptz         | NN       | 시각              |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.21 doc_change_operation

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명**      |
|-----------------|---------------------|----------|---------------|
| operation_id    | uuid                | PK       | Operation     |
| change_set_id   | uuid                | FK,NN    | ChangeSet     |
| operation_order | int                 | NN       | 순서          |
| operation_type  | varchar(40)         | NN       | insertText 등 |
| target_json     | jsonb               | NN       | 대상          |
| before_json     | jsonb               | \-       | 변경전        |
| after_json      | jsonb               | \-       | 변경후        |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.22 doc_template_profile

| **컬럼**                 | **PostgreSQL 타입** | **제약** | **설명**                |
|--------------------------|---------------------|----------|-------------------------|
| template_profile_id      | uuid                | PK       | Template Profile        |
| document_id              | uuid                | FK,NN    | 문서                    |
| profile_version          | int                 | NN       | 버전                    |
| analysis_status          | varchar(20)         | NN       | 상태                    |
| profile_json             | jsonb               | NN       | Section/Style/Prototype |
| unsupported_objects_json | jsonb               | NN       | 미지원 객체             |
| analysis_hash            | char(64)            | NN       | 해시                    |
| created_at               | timestamptz         | NN       | 생성                    |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.23 doc_prototype_registry

| **컬럼**            | **PostgreSQL 타입** | **제약** | **설명**             |
|---------------------|---------------------|----------|----------------------|
| prototype_id        | uuid                | PK       | Prototype            |
| template_profile_id | uuid                | FK,NN    | Profile              |
| prototype_key       | varchar(100)        | NN       | 키                   |
| prototype_type      | varchar(40)         | NN       | TITLE/PARA/TABLE/... |
| source_locator_json | jsonb               | NN       | 원본 위치            |
| clone_policy_json   | jsonb               | NN       | 복제정책             |
| style_fingerprint   | char(64)            | NN       | 서식 지문            |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.24 file_object

| **컬럼**      | **PostgreSQL 타입** | **제약** | **설명**               |
|---------------|---------------------|----------|------------------------|
| file_id       | uuid                | PK       | 파일                   |
| tenant_id     | uuid                | FK,NN    | 기관                   |
| storage_key   | varchar(500)        | UK,NN    | Object Key             |
| original_name | varchar(500)        | NN       | 원본명                 |
| mime_type     | varchar(150)        | NN       | MIME                   |
| size_bytes    | bigint              | NN       | 크기                   |
| sha256        | char(64)            | NN       | 무결성                 |
| scan_status   | varchar(20)         | NN       | PENDING/CLEAN/INFECTED |
| created_by    | uuid                | FK,NN    | 등록자                 |
| created_at    | timestamptz         | NN       | 생성                   |

| **ID**                | **정의**                                        | **목적**       |
|-----------------------|-------------------------------------------------|----------------|
| IX-file_object-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.25 doc_export_job

| **컬럼**             | **PostgreSQL 타입** | **제약** | **설명**      |
|----------------------|---------------------|----------|---------------|
| export_id            | uuid                | PK       | Export        |
| document_id          | uuid                | FK,NN    | 문서          |
| revision_id          | uuid                | FK,NN    | Revision      |
| format               | varchar(20)         | NN       | HWPX/PDF/DOCX |
| status               | varchar(20)         | NN       | QUEUED~FAILED |
| output_file_id       | uuid                | FK       | 결과          |
| validation_report_id | uuid                | FK       | 검증          |
| requested_by         | uuid                | FK,NN    | 요청자        |
| created_at           | timestamptz         | NN       | 요청          |
| finished_at          | timestamptz         | \-       | 완료          |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.26 doc_validation_report

| **컬럼**             | **PostgreSQL 타입** | **제약** | **설명**          |
|----------------------|---------------------|----------|-------------------|
| validation_report_id | uuid                | PK       | 검증보고서        |
| target_type          | varchar(30)         | NN       | DOCUMENT/EXPORT   |
| target_id            | uuid                | NN       | 대상              |
| track                | varchar(20)         | NN       | A_AUTO/B_HANCOM   |
| status               | varchar(20)         | NN       | PASS/LIMITED/FAIL |
| checks_json          | jsonb               | NN       | 검사항목          |
| environment_json     | jsonb               | NN       | 버전/환경         |
| evidence_file_id     | uuid                | FK       | 증빙              |
| created_at           | timestamptz         | NN       | 검증일시          |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.27 sit_situation

| **컬럼**            | **PostgreSQL 타입** | **제약** | **설명**      |
|---------------------|---------------------|----------|---------------|
| situation_id        | uuid                | PK       | 상황/훈련     |
| tenant_id           | uuid                | FK,NN    | 기관          |
| mode                | varchar(20)         | NN       | LIVE/EXERCISE |
| title               | varchar(300)        | NN       | 상황명        |
| hazard_type         | varchar(50)         | NN       | 재난유형      |
| status              | varchar(30)         | NN       | DRAFT~CLOSED  |
| occurred_at         | timestamptz         | \-       | 발생          |
| location_text       | varchar(500)        | \-       | 장소          |
| current_snapshot_id | uuid                | FK       | 현재 Snapshot |
| version_no          | int                 | NN       | 낙관잠금      |
| created_by          | uuid                | FK,NN    | 등록자        |
| created_at          | timestamptz         | NN       | 등록          |

| **ID**                  | **정의**                                        | **목적**       |
|-------------------------|-------------------------------------------------|----------------|
| IX-sit_situation-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |
| IX-sit_situation-STATUS | (tenant_id, status, updated_at/created_at DESC) | 목록·상태 조회 |

### 6.28 sit_fact_source

| **컬럼**      | **PostgreSQL 타입** | **제약** | **설명**                            |
|---------------|---------------------|----------|-------------------------------------|
| source_id     | uuid                | PK       | 출처                                |
| provider_code | varchar(30)         | NN       | KMA/MOIS/SAFEKOREA/NAVER/MANUAL/T3Q |
| source_type   | varchar(30)         | NN       | API/WEB/FILE/USER                   |
| source_name   | varchar(300)        | NN       | 출처명                              |
| source_uri    | text                | \-       | 원문 위치                           |
| retrieved_at  | timestamptz         | NN       | 수집시각                            |
| raw_file_id   | uuid                | FK       | 원문                                |
| license_json  | jsonb               | \-       | 이용조건                            |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.29 sit_fact

| **컬럼**     | **PostgreSQL 타입** | **제약** | **설명**                     |
|--------------|---------------------|----------|------------------------------|
| fact_id      | uuid                | PK       | Fact                         |
| situation_id | uuid                | FK,NN    | 상황                         |
| fact_type    | varchar(50)         | NN       | 기상/피해/통제 등            |
| fact_key     | varchar(120)        | NN       | 표준 Key                     |
| value_json   | jsonb               | NN       | 값/단위                      |
| source_id    | uuid                | FK,NN    | 출처                         |
| observed_at  | timestamptz         | \-       | 관측                         |
| collected_at | timestamptz         | NN       | 수집                         |
| confidence   | numeric(5,4)        | \-       | 신뢰도                       |
| status       | varchar(20)         | NN       | CANDIDATE/CONFIRMED/REJECTED |
| version_no   | int                 | NN       | 버전                         |

| **ID**               | **정의**                                   | **목적**      |
|----------------------|--------------------------------------------|---------------|
| IX-sit_fact-key-time | (situation_id, fact_key, observed_at DESC) | Fact 최신조회 |
| GIN-sit_fact-value   | GIN(value_json jsonb_path_ops)             | 조건검색      |

### 6.30 sit_fact_conflict

| **컬럼**           | **PostgreSQL 타입** | **제약** | **설명**          |
|--------------------|---------------------|----------|-------------------|
| conflict_id        | uuid                | PK       | 충돌              |
| situation_id       | uuid                | FK,NN    | 상황              |
| fact_key           | varchar(120)        | NN       | Key               |
| candidate_fact_ids | uuid\[\]/jsonb      | NN       | 후보              |
| conflict_type      | varchar(30)         | NN       | VALUE/TIME/SOURCE |
| status             | varchar(20)         | NN       | OPEN/RESOLVED     |
| detected_at        | timestamptz         | NN       | 탐지              |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.31 sit_conflict_resolution

| **컬럼**         | **PostgreSQL 타입** | **제약** | **설명**  |
|------------------|---------------------|----------|-----------|
| resolution_id    | uuid                | PK       | 해결      |
| conflict_id      | uuid                | FK,NN    | 충돌      |
| selected_fact_id | uuid                | FK,NN    | 채택 Fact |
| reason           | text                | NN       | 사유      |
| resolved_by      | uuid                | FK,NN    | 확정자    |
| resolved_at      | timestamptz         | NN       | 시각      |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.32 sit_snapshot

| **컬럼**      | **PostgreSQL 타입** | **제약** | **설명**          |
|---------------|---------------------|----------|-------------------|
| snapshot_id   | uuid                | PK       | SituationSnapshot |
| situation_id  | uuid                | FK,NN    | 상황              |
| version_no    | int                 | NN       | 버전              |
| facts_json    | jsonb               | NN       | 불변 사실         |
| content_hash  | char(64)            | NN       | 해시              |
| effective_at  | timestamptz         | NN       | 기준시각          |
| supersedes_id | uuid                | FK       | 이전              |
| confirmed_by  | uuid                | FK,NN    | 확정자            |
| confirmed_at  | timestamptz         | NN       | 확정              |

| **ID**     | **정의**                                | **목적**       |
|------------|-----------------------------------------|----------------|
| UK-version | UNIQUE(parent aggregate id, version_no) | 버전 중복 차단 |

### 6.33 prov_job

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명**     |
|-----------------|---------------------|----------|--------------|
| provider_job_id | uuid                | PK       | Provider Job |
| situation_id    | uuid                | FK       | 상황         |
| provider_code   | varchar(30)         | NN       | Provider     |
| request_json    | jsonb               | NN       | 요청         |
| status          | varchar(20)         | NN       | 상태         |
| result_count    | int                 | NN       | 결과수       |
| error_json      | jsonb               | \-       | 오류         |
| correlation_id  | varchar(80)         | NN       | 추적         |
| created_at      | timestamptz         | NN       | 생성         |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.34 know_document

| **컬럼**              | **PostgreSQL 타입** | **제약** | **설명**                 |
|-----------------------|---------------------|----------|--------------------------|
| knowledge_document_id | uuid                | PK       | 학습문서                 |
| tenant_id             | uuid                | FK,NN    | 기관                     |
| situation_id          | uuid                | FK       | 상황                     |
| file_id               | uuid                | FK,NN    | 파일                     |
| document_type         | varchar(40)         | NN       | 매뉴얼/훈련계획/평가지침 |
| provider_document_id  | varchar(150)        | \-       | UNI ID                   |
| status                | varchar(20)         | NN       | UPLOADING~FAILED         |
| metadata_json         | jsonb               | NN       | 메타                     |
| created_by            | uuid                | FK,NN    | 등록자                   |
| created_at            | timestamptz         | NN       | 등록                     |

| **ID**                  | **정의**                                        | **목적**       |
|-------------------------|-------------------------------------------------|----------------|
| IX-know_document-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.35 know_evidence_set

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명**      |
|-----------------|---------------------|----------|---------------|
| evidence_set_id | uuid                | PK       | 근거집합      |
| situation_id    | uuid                | FK,NN    | 상황          |
| snapshot_id     | uuid                | FK,NN    | 검색 Snapshot |
| query_text      | text                | NN       | 질의          |
| filters_json    | jsonb               | NN       | 필터          |
| top_k           | int                 | NN       | Top-K         |
| status          | varchar(20)         | NN       | DRAFT/LOCKED  |
| content_hash    | char(64)            | NN       | 해시          |
| created_by      | uuid                | FK,NN    | 생성자        |
| created_at      | timestamptz         | NN       | 생성          |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.36 know_evidence_item

| **컬럼**              | **PostgreSQL 타입** | **제약** | **설명**    |
|-----------------------|---------------------|----------|-------------|
| evidence_item_id      | uuid                | PK       | 근거        |
| evidence_set_id       | uuid                | FK,NN    | 집합        |
| knowledge_document_id | uuid                | FK,NN    | 문서        |
| provider_chunk_id     | varchar(150)        | \-       | UNI Chunk   |
| rank_no               | int                 | NN       | 순위        |
| score                 | numeric(8,6)        | \-       | 유사도      |
| quote_text            | text                | NN       | 근거문      |
| source_locator_json   | jsonb               | NN       | 페이지/청크 |
| citation_key          | varchar(80)         | NN       | 인용키      |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.37 sop_sop

| **컬럼**           | **PostgreSQL 타입** | **제약** | **설명**      |
|--------------------|---------------------|----------|---------------|
| sop_id             | uuid                | PK       | SOP           |
| tenant_id          | uuid                | FK,NN    | 기관          |
| situation_id       | uuid                | FK       | 상황          |
| title              | varchar(300)        | NN       | 명칭          |
| hazard_type        | varchar(50)         | NN       | 재난유형      |
| status             | varchar(30)         | NN       | DRAFT~RETIRED |
| current_version_id | uuid                | FK       | 현재 버전     |
| created_by         | uuid                | FK,NN    | 작성자        |
| created_at         | timestamptz         | NN       | 생성          |

| **ID**            | **정의**                                        | **목적**       |
|-------------------|-------------------------------------------------|----------------|
| IX-sop_sop-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.38 sop_version

| **컬럼**               | **PostgreSQL 타입** | **제약** | **설명**          |
|------------------------|---------------------|----------|-------------------|
| sop_version_id         | uuid                | PK       | SOP 버전          |
| sop_id                 | uuid                | FK,NN    | SOP               |
| version_no             | int                 | NN       | 버전              |
| status                 | varchar(20)         | NN       | DRAFT/LOCKED      |
| graph_hash             | char(64)            | NN       | 그래프 해시       |
| source_snapshot_id     | uuid                | FK       | SituationSnapshot |
| source_evidence_set_id | uuid                | FK       | 근거              |
| schema_version         | varchar(20)         | NN       | Schema            |
| approved_by            | uuid                | FK       | 승인자            |
| approved_at            | timestamptz         | \-       | 승인              |

| **ID**     | **정의**                                | **목적**       |
|------------|-----------------------------------------|----------------|
| UK-version | UNIQUE(parent aggregate id, version_no) | 버전 중복 차단 |

### 6.39 sop_node

| **컬럼**       | **PostgreSQL 타입** | **제약** | **설명**                       |
|----------------|---------------------|----------|--------------------------------|
| node_id        | uuid                | PK       | 노드                           |
| sop_version_id | uuid                | FK,NN    | 버전                           |
| node_key       | varchar(80)         | NN       | 안정 Key                       |
| node_type      | varchar(20)         | NN       | START/ACTION/DECISION/NOTE/END |
| title          | varchar(300)        | NN       | 제목                           |
| config_json    | jsonb               | NN       | 임무/완료조건/전파             |
| position_x     | numeric(10,2)       | \-       | Canvas X                       |
| position_y     | numeric(10,2)       | \-       | Canvas Y                       |
| sort_order     | int                 | \-       | 정렬                           |

| **ID**          | **정의**                        | **목적**        |
|-----------------|---------------------------------|-----------------|
| UK-sop-node-key | UNIQUE(sop_version_id,node_key) | 버전 내 안정 ID |

### 6.40 sop_edge

| **컬럼**         | **PostgreSQL 타입** | **제약** | **설명** |
|------------------|---------------------|----------|----------|
| edge_id          | uuid                | PK       | Edge     |
| sop_version_id   | uuid                | FK,NN    | 버전     |
| from_node_id     | uuid                | FK,NN    | 출발     |
| to_node_id       | uuid                | FK,NN    | 도착     |
| condition_expr   | text                | \-       | 분기식   |
| condition_schema | jsonb               | \-       | 파라미터 |
| priority         | int                 | NN       | 우선순위 |
| label            | varchar(100)        | \-       | 표시명   |

| **ID**           | **정의**                          | **목적**      |
|------------------|-----------------------------------|---------------|
| CK-sop-edge-self | CHECK(from_node_id\<\>to_node_id) | 자기연결 차단 |

### 6.41 sop_validation

| **컬럼**          | **PostgreSQL 타입** | **제약** | **설명**      |
|-------------------|---------------------|----------|---------------|
| validation_id     | uuid                | PK       | 검증          |
| sop_version_id    | uuid                | FK,NN    | 버전          |
| status            | varchar(20)         | NN       | PASS/FAIL     |
| errors_json       | jsonb               | NN       | 오류          |
| warnings_json     | jsonb               | NN       | 경고          |
| validator_version | varchar(30)         | NN       | 검증기 버전   |
| validated_by      | uuid                | FK       | 사용자/시스템 |
| validated_at      | timestamptz         | NN       | 검증          |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.42 sop_run

| **컬럼**       | **PostgreSQL 타입** | **제약** | **설명**              |
|----------------|---------------------|----------|-----------------------|
| run_id         | uuid                | PK       | 실행                  |
| sop_version_id | uuid                | FK,NN    | 고정 버전             |
| situation_id   | uuid                | FK,NN    | 상황                  |
| snapshot_id    | uuid                | FK,NN    | 시작 Snapshot         |
| mode           | varchar(20)         | NN       | LIVE/DRY_RUN/EXERCISE |
| status         | varchar(20)         | NN       | READY~TERMINATED      |
| started_by     | uuid                | FK,NN    | 시작자                |
| started_at     | timestamptz         | NN       | 시작                  |
| ended_at       | timestamptz         | \-       | 종료                  |
| correlation_id | varchar(80)         | NN       | 추적                  |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.43 task_task

| **컬럼**               | **PostgreSQL 타입** | **제약** | **설명**          |
|------------------------|---------------------|----------|-------------------|
| task_id                | uuid                | PK       | 임무              |
| run_id                 | uuid                | FK,NN    | SOP 실행          |
| node_id                | uuid                | FK,NN    | 원본 노드         |
| title                  | varchar(300)        | NN       | 임무명            |
| status                 | varchar(30)         | NN       | CREATED~CANCELLED |
| assignee_user_id       | uuid                | FK       | 담당자            |
| assignee_org_id        | uuid                | FK       | 담당조직          |
| due_at                 | timestamptz         | \-       | 기한              |
| completion_policy_json | jsonb               | NN       | 완료조건          |
| progress_pct           | numeric(5,2)        | NN       | 진행률            |
| version_no             | int                 | NN       | 낙관잠금          |
| created_at             | timestamptz         | NN       | 생성              |

| **ID**              | **정의**                                        | **목적**       |
|---------------------|-------------------------------------------------|----------------|
| IX-task_task-STATUS | (tenant_id, status, updated_at/created_at DESC) | 목록·상태 조회 |

### 6.44 task_event

| **컬럼**       | **PostgreSQL 타입** | **제약** | **설명**           |
|----------------|---------------------|----------|--------------------|
| task_event_id  | uuid                | PK       | Task Event         |
| task_id        | uuid                | FK,NN    | 임무               |
| event_type     | varchar(40)         | NN       | DISPATCHED/ACK/... |
| event_time     | timestamptz         | NN       | 업무시각           |
| actor_id       | uuid                | FK       | 행위자             |
| payload_json   | jsonb               | NN       | 내용               |
| correlation_id | varchar(80)         | NN       | 추적               |
| created_at     | timestamptz         | NN       | 기록               |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.45 task_attachment

| **컬럼**           | **PostgreSQL 타입** | **제약** | **설명**        |
|--------------------|---------------------|----------|-----------------|
| task_attachment_id | uuid                | PK       | 첨부            |
| task_id            | uuid                | FK,NN    | 임무            |
| file_id            | uuid                | FK,NN    | 파일            |
| category           | varchar(30)         | NN       | PHOTO/DOC/VIDEO |
| caption            | varchar(500)        | \-       | 설명            |
| geo_json           | jsonb               | \-       | 위치            |
| captured_at        | timestamptz         | \-       | 촬영            |
| uploaded_by        | uuid                | FK,NN    | 등록자          |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.46 msg_dispatch

| **컬럼**     | **PostgreSQL 타입** | **제약** | **설명**                  |
|--------------|---------------------|----------|---------------------------|
| dispatch_id  | uuid                | PK       | 전파                      |
| task_id      | uuid                | FK       | 임무                      |
| situation_id | uuid                | FK,NN    | 상황                      |
| message_type | varchar(30)         | NN       | SITUATION/TASK/ESCALATION |
| message_body | text                | NN       | 내용                      |
| status       | varchar(20)         | NN       | PENDING~PARTIAL           |
| created_by   | uuid                | FK,NN    | 발신자                    |
| created_at   | timestamptz         | NN       | 생성                      |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.47 msg_dispatch_recipient

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명**              |
|-----------------|---------------------|----------|-----------------------|
| recipient_id    | uuid                | PK       | 수신자                |
| dispatch_id     | uuid                | FK,NN    | 전파                  |
| user_id         | uuid                | FK       | 사용자                |
| organization_id | uuid                | FK       | 조직                  |
| channel         | varchar(20)         | NN       | SYSTEM/SMS/EMAIL/PUSH |
| address_enc     | bytea               | \-       | 암호화 주소           |
| delivery_status | varchar(20)         | NN       | PENDING~FAILED        |
| acknowledged_at | timestamptz         | \-       | 수신확인              |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.48 event_execution

| **컬럼**           | **PostgreSQL 타입** | **제약** | **설명**              |
|--------------------|---------------------|----------|-----------------------|
| execution_event_id | uuid                | PK       | 사실원장 Event        |
| tenant_id          | uuid                | FK,NN    | 기관                  |
| situation_id       | uuid                | FK,NN    | 상황                  |
| aggregate_type     | varchar(30)         | NN       | TASK/SOP/DISPATCH/... |
| aggregate_id       | uuid                | NN       | 대상                  |
| event_type         | varchar(50)         | NN       | 종류                  |
| occurred_at        | timestamptz         | NN       | 업무시각              |
| recorded_at        | timestamptz         | NN       | 기록시각              |
| actor_id           | uuid                | FK       | 행위자                |
| payload_json       | jsonb               | NN       | 내용                  |
| corrects_event_id  | uuid                | FK       | 정정대상              |
| correlation_id     | varchar(80)         | NN       | 추적                  |
| event_hash         | char(64)            | NN       | 위변조검증            |

| **ID**                    | **정의**                                        | **목적**       |
|---------------------------|-------------------------------------------------|----------------|
| IX-event_execution-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |
| PK partition              | PARTITION BY RANGE(recorded_at)                 | 월 파티션      |
| IX-exec-situation-time    | (situation_id, occurred_at, event_type)         | Timeline       |

### 6.49 event_outbox

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명**     |
|-----------------|---------------------|----------|--------------|
| outbox_id       | uuid                | PK       | Outbox       |
| tenant_id       | uuid                | FK,NN    | 기관         |
| aggregate_type  | varchar(30)         | NN       | 대상         |
| aggregate_id    | uuid                | NN       | 대상 ID      |
| event_type      | varchar(50)         | NN       | 발송종류     |
| payload_json    | jsonb               | NN       | 메시지       |
| channel         | varchar(20)         | NN       | 채널         |
| status          | varchar(20)         | NN       | PENDING~DEAD |
| attempt_count   | int                 | NN       | 시도         |
| next_attempt_at | timestamptz         | \-       | 다음시도     |
| idempotency_key | varchar(100)        | NN       | 멱등키       |
| created_at      | timestamptz         | NN       | 생성         |

| **ID**                 | **정의**                                              | **목적**       |
|------------------------|-------------------------------------------------------|----------------|
| IX-event_outbox-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼)       | 기관 범위 조회 |
| IX-outbox-ready        | (next_attempt_at) WHERE status IN ('PENDING','RETRY') | Worker 획득    |
| UK-outbox-idem         | (idempotency_key, channel)                            | 중복전송 차단  |

### 6.50 event_outbox_attempt

| **컬럼**            | **PostgreSQL 타입** | **제약** | **설명**           |
|---------------------|---------------------|----------|--------------------|
| attempt_id          | uuid                | PK       | 발송시도           |
| outbox_id           | uuid                | FK,NN    | Outbox             |
| attempt_no          | int                 | NN       | 순번               |
| started_at          | timestamptz         | NN       | 시작               |
| finished_at         | timestamptz         | \-       | 종료               |
| result_status       | varchar(20)         | NN       | SUCCESS/RETRY/FAIL |
| provider_message_id | varchar(150)        | \-       | 외부 ID            |
| response_json       | jsonb               | \-       | 응답               |
| error_json          | jsonb               | \-       | 오류               |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.51 jnl_journal

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명**             |
|-----------------|---------------------|----------|----------------------|
| journal_id      | uuid                | PK       | 상황일지             |
| situation_id    | uuid                | FK,NN    | 상황                 |
| snapshot_id     | uuid                | FK,NN    | 기준 Snapshot        |
| document_id     | uuid                | FK,NN    | rhwp 문서            |
| period_start    | timestamptz         | NN       | 시작                 |
| period_end      | timestamptz         | NN       | 종료                 |
| status          | varchar(20)         | NN       | CONFIGURING~APPROVED |
| projection_hash | char(64)            | NN       | Projection 해시      |
| created_by      | uuid                | FK,NN    | 생성자               |
| created_at      | timestamptz         | NN       | 생성                 |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.52 jnl_projection_item

| **컬럼**           | **PostgreSQL 타입** | **제약** | **설명**    |
|--------------------|---------------------|----------|-------------|
| projection_item_id | uuid                | PK       | 투영항목    |
| journal_id         | uuid                | FK,NN    | 일지        |
| section_key        | varchar(80)         | NN       | 섹션        |
| source_event_ids   | uuid\[\]/jsonb      | NN       | 근거 Event  |
| fact_payload_json  | jsonb               | NN       | 잠금 사실값 |
| narrative_text     | text                | \-       | 서술        |
| sort_order         | int                 | NN       | 정렬        |
| locked_fields_json | jsonb               | NN       | 잠금필드    |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.53 eval_evaluation

| **컬럼**        | **PostgreSQL 타입** | **제약** | **설명**           |
|-----------------|---------------------|----------|--------------------|
| evaluation_id   | uuid                | PK       | 평가               |
| situation_id    | uuid                | FK,NN    | 훈련               |
| status          | varchar(20)         | NN       | OPEN~CLOSED        |
| evaluation_type | varchar(30)         | NN       | EXERCISE/USABILITY |
| overall_score   | numeric(6,2)        | \-       | 종합점수           |
| summary         | text                | \-       | 종합의견           |
| created_by      | uuid                | FK,NN    | 평가자             |
| created_at      | timestamptz         | NN       | 생성               |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.54 eval_score

| **컬럼**           | **PostgreSQL 타입** | **제약** | **설명** |
|--------------------|---------------------|----------|----------|
| score_id           | uuid                | PK       | 평가점수 |
| evaluation_id      | uuid                | FK,NN    | 평가     |
| criterion_code     | varchar(60)         | NN       | 지표     |
| score_value        | numeric(6,2)        | NN       | 점수     |
| weight_value       | numeric(6,3)        | NN       | 가중치   |
| comment            | text                | \-       | 의견     |
| evidence_event_ids | uuid\[\]/jsonb      | \-       | 근거     |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.55 eval_improvement_action

| **컬럼**      | **PostgreSQL 타입** | **제약** | **설명**        |
|---------------|---------------------|----------|-----------------|
| action_id     | uuid                | PK       | 개선조치        |
| evaluation_id | uuid                | FK,NN    | 평가            |
| action_text   | text                | NN       | 조치            |
| owner_user_id | uuid                | FK       | 담당            |
| due_at        | timestamptz         | \-       | 기한            |
| status        | varchar(20)         | NN       | OPEN~CLOSED     |
| target_type   | varchar(30)         | \-       | PLAN/SOP/SYSTEM |
| target_id     | uuid                | \-       | 환류대상        |

| **ID**        | **정의**                     | **목적**                 |
|---------------|------------------------------|--------------------------|
| 기본 FK Index | 모든 FK 조회경로에 선택 적용 | 실제 Query Plan으로 확정 |

### 6.56 admin_provider_config

| **컬럼**           | **PostgreSQL 타입** | **제약** | **설명**        |
|--------------------|---------------------|----------|-----------------|
| provider_config_id | uuid                | PK       | Provider 설정   |
| tenant_id          | uuid                | FK       | 기관별 Override |
| provider_code      | varchar(30)         | NN       | T3Q/UNI/KMA/... |
| enabled            | boolean             | NN       | 활성            |
| priority_no        | int                 | NN       | 우선순위        |
| base_url           | varchar(500)        | \-       | URL             |
| credential_ref     | varchar(300)        | \-       | Vault 참조      |
| timeout_json       | jsonb               | NN       | Timeout         |
| feature_flags_json | jsonb               | NN       | Flag            |
| version_no         | int                 | NN       | 버전            |

| **ID**                          | **정의**                                        | **목적**       |
|---------------------------------|-------------------------------------------------|----------------|
| IX-admin_provider_config-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.57 admin_audit_log

| **컬럼**       | **PostgreSQL 타입** | **제약** | **설명** |
|----------------|---------------------|----------|----------|
| audit_id       | uuid                | PK       | 감사     |
| tenant_id      | uuid                | FK,NN    | 기관     |
| actor_id       | uuid                | FK       | 행위자   |
| action         | varchar(80)         | NN       | 행위     |
| resource_type  | varchar(40)         | NN       | 자원     |
| resource_id    | uuid                | \-       | 대상     |
| before_json    | jsonb               | \-       | 변경전   |
| after_json     | jsonb               | \-       | 변경후   |
| correlation_id | varchar(80)         | NN       | 추적     |
| ip_address     | inet                | \-       | IP       |
| user_agent     | text                | \-       | UA       |
| occurred_at    | timestamptz         | NN       | 시각     |

| **ID**                    | **정의**                                        | **목적**       |
|---------------------------|-------------------------------------------------|----------------|
| IX-admin_audit_log-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.58 admin_retention_policy

| **컬럼**            | **PostgreSQL 타입** | **제약** | **설명**                  |
|---------------------|---------------------|----------|---------------------------|
| retention_policy_id | uuid                | PK       | 보존정책                  |
| tenant_id           | uuid                | FK       | 기관                      |
| resource_type       | varchar(40)         | NN       | 자원                      |
| retention_days      | int                 | NN       | 일수                      |
| archive_strategy    | varchar(30)         | NN       | OBJECT_STORAGE/DB_ARCHIVE |
| legal_hold_enabled  | boolean             | NN       | 법적보존                  |
| version_no          | int                 | NN       | 버전                      |
| updated_by          | uuid                | FK,NN    | 수정자                    |

| **ID**                           | **정의**                                        | **목적**       |
|----------------------------------|-------------------------------------------------|----------------|
| IX-admin_retention_policy-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

### 6.59 admin_notification

| **컬럼**          | **PostgreSQL 타입** | **제약** | **설명**           |
|-------------------|---------------------|----------|--------------------|
| notification_id   | uuid                | PK       | 알림               |
| tenant_id         | uuid                | FK,NN    | 기관               |
| user_id           | uuid                | FK,NN    | 수신자             |
| notification_type | varchar(40)         | NN       | 종류               |
| severity          | varchar(20)         | NN       | INFO/WARN/CRITICAL |
| title             | varchar(300)        | NN       | 제목               |
| body              | text                | NN       | 내용               |
| action_url        | varchar(700)        | \-       | 조치링크           |
| read_at           | timestamptz         | \-       | 읽음               |
| created_at        | timestamptz         | NN       | 생성               |

| **ID**                       | **정의**                                        | **목적**       |
|------------------------------|-------------------------------------------------|----------------|
| IX-admin_notification-TENANT | (tenant_id, status/created_at 등 업무조회 컬럼) | 기관 범위 조회 |

# 7. 56개 화면별 Sequence 상세설계

화면설계서의 56개 SCR ID를 그대로 사용한다. 각 화면 Sequence는 브라우저·React/BFF·도메인 서비스·DB·Provider/Worker 간 동작을 정의하고, 화면에서 허용되는 정상·대체·예외 흐름을 API와 데이터 변경으로 연결한다.

| **화면 ID**       | **화면명**                             | **모듈**   | **Route**                                                    | **Scenario**                                                    |
|-------------------|----------------------------------------|------------|--------------------------------------------------------------|-----------------------------------------------------------------|
| SCR-AUTH-001      | SSO 토큰 검증·접근결과                 | 공통       | /auth/callback                                               | US-PLAN-001, US-SIT-001                                         |
| SCR-HOME-001      | 통합 홈·업무 진입                      | 공통       | /app/home                                                    | US-PLAN-001, US-SIT-001, US-SIT-002                             |
| SCR-NOTIFY-001    | 통합 알림센터                          | 공통       | /app/notifications                                           | US-PLAN-024, US-SIT-019, US-SIT-025                             |
| SCR-PLAN-001      | 계획서 목록·최근문서·보관함            | 계획서     | /app/plans                                                   | US-PLAN-001, US-PLAN-002, US-PLAN-023                           |
| SCR-PLAN-002      | 계획서 시작방식·Workspace 생성         | 계획서     | /app/plans/new                                               | US-PLAN-002, US-PLAN-003                                        |
| SCR-PLAN-003      | HWPX 업로드·패키지 검증                | 계획서     | /app/plans/:id/template/upload                               | US-PLAN-003, US-PLAN-004                                        |
| SCR-PLAN-004      | Template 분석·Prototype 확인           | 계획서     | /app/plans/:id/template/analyze                              | US-PLAN-005, US-PLAN-006, US-PLAN-025                           |
| SCR-PLAN-005      | 기준정보·참조자료·Snapshot             | 계획서     | /app/plans/:id/context                                       | US-PLAN-007, US-PLAN-008, US-PLAN-009                           |
| SCR-PLAN-006      | 목차 생성·편집·Diff                    | 계획서     | /app/plans/:id/outline                                       | US-PLAN-009, US-PLAN-010, US-PLAN-011                           |
| SCR-PLAN-007      | rhwp 계획서 편집 Workspace             | 계획서     | /app/plans/:id/edit                                          | US-PLAN-012, US-PLAN-013, US-PLAN-014, US-PLAN-015, US-PLAN-020 |
| SCR-PLAN-008      | AI 편집·근거·Diff Drawer               | 계획서     | /app/plans/:id/edit?drawer=ai                                | US-PLAN-016, US-PLAN-017, US-PLAN-018, US-PLAN-019              |
| SCR-PLAN-009      | 내보내기·Track A 검증                  | 계획서     | /app/plans/:id/export                                        | US-PLAN-021, US-PLAN-022                                        |
| SCR-PLAN-010      | 검토·승인·버전·최종본                  | 계획서     | /app/plans/:id/review                                        | US-PLAN-020, US-PLAN-027                                        |
| SCR-ADMIN-TPL-001 | Template Profile 관리·공유·승격        | 관리       | /app/admin/templates                                         | US-PLAN-028                                                     |
| SCR-QA-RT-001     | 한컴 Round-trip QA·배포 Gate           | QA         | /app/qa/hwpx-roundtrip                                       | US-PLAN-029, US-PLAN-030                                        |
| SCR-SIT-001       | 사건·훈련 목록·상황 홈                 | 상황·훈련  | /app/incidents                                               | US-SIT-001, US-SIT-002                                          |
| SCR-SIT-002       | 사건·훈련 Workspace 개요               | 상황·훈련  | /app/incidents/:id                                           | US-SIT-002, US-SIT-026                                          |
| SCR-SIT-003       | 사건·훈련 기본정보 등록                | 상황·훈련  | /app/incidents/new                                           | US-SIT-003                                                      |
| SCR-SIT-004       | 외부 Provider 조회·운영상태            | 상황·훈련  | /app/incidents/:id/providers                                 | US-SIT-004, US-SIT-005, US-SIT-039                              |
| SCR-SIT-005       | SituationFact 후보·현장보고            | 상황·훈련  | /app/incidents/:id/facts                                     | US-SIT-006, US-SIT-007, US-SIT-022, US-SIT-029                  |
| SCR-SIT-006       | 충돌 Fact 비교·결정                    | 상황·훈련  | /app/incidents/:id/facts/conflicts                           | US-SIT-007                                                      |
| SCR-SIT-007       | SituationSnapshot 확정·이력            | 상황·훈련  | /app/incidents/:id/snapshots                                 | US-SIT-008, US-SIT-035                                          |
| SCR-SIT-008       | 훈련·매뉴얼 자료 업로드                | 상황·훈련  | /app/incidents/:id/sources                                   | US-SIT-009                                                      |
| SCR-SIT-009       | UNI 학습상태·문서 관리                 | 상황·훈련  | /app/incidents/:id/sources/status                            | US-SIT-010, US-SIT-039                                          |
| SCR-SIT-010       | RAG Evidence 검색·선택·동결            | 상황·훈련  | /app/incidents/:id/evidence                                  | US-SIT-011                                                      |
| SCR-SOP-001       | SOP 생성 설정                          | SOP        | /app/incidents/:id/sop/generate                              | US-SIT-012                                                      |
| SCR-SOP-002       | SOP JSON SSE 생성·Mapper 결과          | SOP        | /app/incidents/:id/sop/generate/:jobId                       | US-SIT-012, US-SIT-013                                          |
| SCR-SOP-003       | SOP Flow Canvas                        | SOP        | /app/incidents/:id/sop/:sopId/edit                           | US-SIT-013, US-SIT-014                                          |
| SCR-SOP-004       | 노드 속성·조직·채널 매핑               | SOP        | /app/incidents/:id/sop/:sopId/edit?panel=node                | US-SIT-014                                                      |
| SCR-SOP-005       | SOP 검토·승인·버전 고정                | SOP        | /app/incidents/:id/sop/:sopId/review                         | US-SIT-015                                                      |
| SCR-SOP-006       | SOP 시뮬레이션·Dry-run                 | SOP        | /app/incidents/:id/sop/:sopId/simulate                       | US-SIT-016, US-SIT-017                                          |
| SCR-SOP-007       | SOP 실행 시작·제어·종료                | SOP        | /app/incidents/:id/executions/:executionId                   | US-SIT-017, US-SIT-027                                          |
| SCR-SOP-008       | 전파대상·메시지·Outbox                 | SOP        | /app/incidents/:id/executions/:executionId/propagation       | US-SIT-018                                                      |
| SCR-SOP-009       | 채널 송신상태·재시도                   | SOP        | /app/incidents/:id/executions/:executionId/messages          | US-SIT-019, US-SIT-025, US-SIT-039                              |
| SCR-SOP-010       | 상황판단·분기 선택                     | SOP        | /app/incidents/:id/executions/:executionId/decisions/:nodeId | US-SIT-024                                                      |
| SCR-TASK-001      | 현장 임무 수신·착수·진행               | 현장 임무  | /task/:signedToken                                           | US-SIT-020, US-SIT-021                                          |
| SCR-TASK-002      | 현장보고·사진·피해/통제 Fact           | 현장 임무  | /task/:token/report                                          | US-SIT-022, US-SIT-029                                          |
| SCR-TASK-003      | 임무 완료·불가·반려·재배정             | 현장 임무  | /task/:token/complete                                        | US-SIT-023                                                      |
| SCR-BOARD-001     | 전자상황판 통합 모니터링               | 전자상황판 | /app/incidents/:id/board                                     | US-SIT-021, US-SIT-028                                          |
| SCR-BOARD-002     | SLA·미수신·Escalation                  | 전자상황판 | /app/incidents/:id/board/escalations                         | US-SIT-025                                                      |
| SCR-BOARD-003     | 복수 사건·복수 SOP 통합상황판          | 전자상황판 | /app/boards/multi                                            | US-SIT-026                                                      |
| SCR-BOARD-004     | 수동 Event 추가·정정                   | 전자상황판 | /app/incidents/:id/events/manual                             | US-SIT-029                                                      |
| SCR-JRN-001       | 상황일지 범위·양식 설정                | 상황일지   | /app/incidents/:id/journals/new                              | US-SIT-030                                                      |
| SCR-JRN-002       | JournalProjection·FactRows             | 상황일지   | /app/incidents/:id/journals/:journalId/projection            | US-SIT-031, US-SIT-032                                          |
| SCR-JRN-003       | rhwp 상황일지 편집 Workspace           | 상황일지   | /app/incidents/:id/journals/:journalId/edit                  | US-SIT-032, US-SIT-033                                          |
| SCR-JRN-004       | 상황일지 근거·Diff·검토                | 상황일지   | /app/incidents/:id/journals/:journalId/review                | US-SIT-033, US-SIT-034                                          |
| SCR-JRN-005       | 상황일지 HWPX/PDF/DOCX 내보내기        | 상황일지   | /app/incidents/:id/journals/:journalId/export                | US-SIT-034                                                      |
| SCR-JRN-006       | 상황일지 버전·최종본·재생성            | 상황일지   | /app/incidents/:id/journals/:journalId/history               | US-SIT-034, US-SIT-035                                          |
| SCR-EVAL-001      | 사건·훈련 종료·최종 기준선             | 평가       | /app/incidents/:id/close                                     | US-SIT-035, US-SIT-036                                          |
| SCR-EVAL-002      | 훈련평가 지표·체크포인트               | 평가       | /app/incidents/:id/evaluation/checkpoints                    | US-SIT-036, US-SIT-037, US-SIT-038                              |
| SCR-EVAL-003      | 개선조치·SOP/계획서 환류               | 평가       | /app/incidents/:id/evaluation/actions                        | US-SIT-036                                                      |
| SCR-EVAL-004      | 만족도·잠재가치·평가보고서             | 평가       | /app/incidents/:id/evaluation/report                         | US-SIT-036, US-SIT-040                                          |
| SCR-ADMIN-001     | 기관·사용자·RBAC 관리                  | 관리       | /app/admin/access                                            | US-PLAN-001, US-SIT-040                                         |
| SCR-ADMIN-002     | 조직·연락처·채널·수신자 Binding        | 관리       | /app/admin/organization                                      | US-SIT-014, US-SIT-018, US-SIT-040                              |
| SCR-ADMIN-003     | 감사·보존·개인정보·보안 설정           | 관리       | /app/admin/audit-security                                    | US-SIT-040, US-PLAN-030                                         |
| SCR-ADMIN-004     | Provider·UNI·T3Q·실증 Binding 운영설정 | 관리       | /app/admin/integrations                                      | US-PLAN-024, US-SIT-004, US-SIT-039, US-SIT-040                 |

## 7.1 SCR-AUTH-001 SSO 토큰 검증·접근결과

| **항목**      | **상세**                                 |
|---------------|------------------------------------------|
| 모듈          | 공통                                     |
| Route         | /auth/callback                           |
| 연계 Scenario | US-PLAN-001, US-SIT-001                  |
| 호출 API      | UNE-AUTH-001, UNE-AUTH-002, UNE-AUTH-003 |
| DB Read       | app_user, user_role, organization        |
| DB Write      | app_user, user_session, audit_log        |
| 상위 ADR      | ADR-01~18 공통                           |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**              | **목적**                   | **권한**      | **오류**       |
|----------|--------------|------------|---------------------------|----------------------------|---------------|----------------|
| 1        | UNE-AUTH-001 | POST       | /api/v1/auth/sso/exchange | T3Q SSO 토큰 교환          | PUBLIC_SSO    | AUTH-1001~1004 |
| 2        | UNE-AUTH-002 | GET        | /api/v1/auth/me           | 현재 사용자·기관·역할 조회 | AUTHENTICATED | AUTH-1005      |
| 3        | UNE-AUTH-003 | POST       | /api/v1/auth/refresh      | Access Token 갱신          | AUTHENTICATED | AUTH-1002      |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-AUTH-001)                                                                    | SSO 토큰 검증·접근결과 화면 진입 또는 주요 Action 수행                                            |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | T3Q SSO 토큰 교환 Use Case 실행 (UNE-AUTH-001)                                                    |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[app_user, user_role, organization\] / 쓰기 \[app_user, user_session, audit_log\]           |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-AUTH-001-01 정상: US-PLAN-001의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-AUTH-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-AUTH-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-AUTH-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-AUTH-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.2 SCR-HOME-001 통합 홈·업무 진입

| **항목**      | **상세**                                                                                       |
|---------------|------------------------------------------------------------------------------------------------|
| 모듈          | 공통                                                                                           |
| Route         | /app/home                                                                                      |
| 연계 Scenario | US-PLAN-001, US-SIT-001, US-SIT-002                                                            |
| 호출 API      | UNE-HOME-001, UNE-TASK-001, UNE-AUTH-002                                                       |
| DB Read       | document, situation, task, provider_health, task_assignment, app_user, user_role, organization |
| DB Write      | \-                                                                                             |
| 상위 ADR      | ADR-01~18 공통                                                                                 |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**         | **목적**                   | **권한**      | **오류**  |
|----------|--------------|------------|----------------------|----------------------------|---------------|-----------|
| 1        | UNE-HOME-001 | GET        | /api/v1/home/summary | 통합 홈 요약               | AUTHENTICATED | COM-0001  |
| 2        | UNE-TASK-001 | GET        | /api/v1/tasks        | 임무 목록                  | TASK_READ     | TASK-7001 |
| 3        | UNE-AUTH-002 | GET        | /api/v1/auth/me      | 현재 사용자·기관·역할 조회 | AUTHENTICATED | AUTH-1005 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                            |
|----------|---------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-HOME-001)                                                                    | 통합 홈·업무 진입 화면 진입 또는 주요 Action 수행                                                   |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                       |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                      |
| 4        | BFF -\> Domain Service                                                                            | 통합 홈 요약 Use Case 실행 (UNE-HOME-001)                                                           |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                    |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[document, situation, task, provider_health, task_assignment, app_user\] / 쓰기 \[해당 없음\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출   |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                 |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                             |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                 |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지           |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                         |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-HOME-001-01 정상: US-PLAN-001의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-HOME-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-HOME-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-HOME-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-HOME-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.3 SCR-NOTIFY-001 통합 알림센터

| **항목**      | **상세**                                 |
|---------------|------------------------------------------|
| 모듈          | 공통                                     |
| Route         | /app/notifications                       |
| 연계 Scenario | US-PLAN-024, US-SIT-019, US-SIT-025      |
| 호출 API      | UNE-HOME-002, UNE-HOME-003, UNE-HOME-004 |
| DB Read       | notification                             |
| DB Write      | notification                             |
| 상위 ADR      | ADR-01~18 공통                           |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                    | **목적**  | **권한**      | **오류**  |
|----------|--------------|------------|---------------------------------|-----------|---------------|-----------|
| 1        | UNE-HOME-002 | GET        | /api/v1/notifications           | 알림 목록 | AUTHENTICATED | NOTI-3001 |
| 2        | UNE-HOME-003 | POST       | /api/v1/notifications/{id}/read | 알림 읽음 | AUTHENTICATED | NOTI-3002 |
| 3        | UNE-HOME-004 | POST       | /api/v1/notifications/read-all  | 전체 읽음 | AUTHENTICATED | NOTI-3003 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-NOTIFY-001)                                                                  | 통합 알림센터 화면 진입 또는 주요 Action 수행                                                     |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 알림 목록 Use Case 실행 (UNE-HOME-002)                                                            |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[notification\] / 쓰기 \[notification\]                                                     |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-NOTIFY-001-01 정상: US-PLAN-024의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-NOTIFY-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-NOTIFY-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-NOTIFY-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-NOTIFY-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.4 SCR-PLAN-001 계획서 목록·최근문서·보관함

| **항목**      | **상세**                                               |
|---------------|--------------------------------------------------------|
| 모듈          | 계획서                                                 |
| Route         | /app/plans                                             |
| 연계 Scenario | US-PLAN-001, US-PLAN-002, US-PLAN-023                  |
| 호출 API      | UNE-PLAN-002, UNE-PLAN-003, UNE-PLAN-005               |
| DB Read       | plan, document                                         |
| DB Write      | plan                                                   |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16 |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**           | **목적**           | **권한**    | **오류**     |
|----------|--------------|------------|------------------------|--------------------|-------------|--------------|
| 1        | UNE-PLAN-002 | GET        | /api/v1/plans          | 계획서 목록·검색   | PLAN_READ   | PLAN-4002    |
| 2        | UNE-PLAN-003 | GET        | /api/v1/plans/{planId} | 계획서 상세        | PLAN_READ   | PLAN-4003    |
| 3        | UNE-PLAN-005 | DELETE     | /api/v1/plans/{planId} | 계획서 휴지통 이동 | PLAN_DELETE | PLAN-403-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-001)                                                                    | 계획서 목록·최근문서·보관함 화면 진입 또는 주요 Action 수행                                       |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 계획서 목록·검색 Use Case 실행 (UNE-PLAN-002)                                                     |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[plan, document\] / 쓰기 \[plan\]                                                           |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-001-01 정상: US-PLAN-001의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.5 SCR-PLAN-002 계획서 시작방식·Workspace 생성

| **항목**      | **상세**                                                                       |
|---------------|--------------------------------------------------------------------------------|
| 모듈          | 계획서                                                                         |
| Route         | /app/plans/new                                                                 |
| 연계 Scenario | US-PLAN-002, US-PLAN-003                                                       |
| 호출 API      | UNE-PLAN-001, UNE-DOC-001, UNE-DOC-002, UNE-DOC-003                            |
| DB Read       | \-                                                                             |
| DB Write      | plan, document, file_object, malware_scan, document_revision, template_profile |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16                         |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                    | **목적**                      | **권한**    | **오류**     |
|----------|--------------|------------|---------------------------------|-------------------------------|-------------|--------------|
| 1        | UNE-PLAN-001 | POST       | /api/v1/plans                   | 계획서 Workspace 생성         | PLAN_CREATE | PLAN-4001    |
| 2        | UNE-DOC-001  | POST       | /api/v1/files                   | 파일 사전등록·업로드 URL 발급 | FILE_UPLOAD | FILE-422-001 |
| 3        | UNE-DOC-002  | POST       | /api/v1/files/{fileId}/complete | 업로드 완료·검사              | FILE_UPLOAD | FILE-422-002 |
| 4        | UNE-DOC-003  | POST       | /api/v1/documents/import-hwpx   | HWPX 업로드·분석              | PLAN_CREATE | HWPX-422-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-002)                                                                    | 계획서 시작방식·Workspace 생성 화면 진입 또는 주요 Action 수행                                                    |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                    |
| 4        | BFF -\> Domain Service                                                                            | 계획서 Workspace 생성 Use Case 실행 (UNE-PLAN-001)                                                                |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[관련 Aggregate\] / 쓰기 \[plan, document, file_object, malware_scan, document_revision, template_profile\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-002-01 정상: US-PLAN-002의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-002-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-002-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-002-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-002-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.6 SCR-PLAN-003 HWPX 업로드·패키지 검증

| **항목**      | **상세**                                                                 |
|---------------|--------------------------------------------------------------------------|
| 모듈          | 계획서                                                                   |
| Route         | /app/plans/:id/template/upload                                           |
| 연계 Scenario | US-PLAN-003, US-PLAN-004                                                 |
| 호출 API      | UNE-DOC-001, UNE-DOC-002, UNE-DOC-003                                    |
| DB Read       | \-                                                                       |
| DB Write      | file_object, malware_scan, document, document_revision, template_profile |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16                   |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                    | **목적**                      | **권한**    | **오류**     |
|----------|-------------|------------|---------------------------------|-------------------------------|-------------|--------------|
| 1        | UNE-DOC-001 | POST       | /api/v1/files                   | 파일 사전등록·업로드 URL 발급 | FILE_UPLOAD | FILE-422-001 |
| 2        | UNE-DOC-002 | POST       | /api/v1/files/{fileId}/complete | 업로드 완료·검사              | FILE_UPLOAD | FILE-422-002 |
| 3        | UNE-DOC-003 | POST       | /api/v1/documents/import-hwpx   | HWPX 업로드·분석              | PLAN_CREATE | HWPX-422-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                    |
|----------|---------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-003)                                                                    | HWPX 업로드·패키지 검증 화면 진입 또는 주요 Action 수행                                                     |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                               |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                              |
| 4        | BFF -\> Domain Service                                                                            | 파일 사전등록·업로드 URL 발급 Use Case 실행 (UNE-DOC-001)                                                   |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                            |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[관련 Aggregate\] / 쓰기 \[file_object, malware_scan, document, document_revision, template_profile\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출           |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                         |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                     |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                         |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                   |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                 |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-003-01 정상: US-PLAN-003의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-003-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-003-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-003-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-003-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.7 SCR-PLAN-004 Template 분석·Prototype 확인

| **항목**      | **상세**                                                |
|---------------|---------------------------------------------------------|
| 모듈          | 계획서                                                  |
| Route         | /app/plans/:id/template/analyze                         |
| 연계 Scenario | US-PLAN-005, US-PLAN-006, US-PLAN-025                   |
| 호출 API      | UNE-DOC-004, UNE-DOC-005                                |
| DB Read       | template_profile, prototype_registry, document_revision |
| DB Write      | \-                                                      |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16  |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                            | **목적**           | **권한** | **오류**     |
|----------|-------------|------------|-----------------------------------------|--------------------|----------|--------------|
| 1        | UNE-DOC-004 | GET        | /api/v1/documents/{documentId}/analysis | HWPX 분석결과 조회 | DOC_READ | HWPX-404-001 |
| 2        | UNE-DOC-005 | GET        | /api/v1/documents/{documentId}/ir       | Document IR 조회   | DOC_READ | DOC-404-001  |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-004)                                                                    | Template 분석·Prototype 확인 화면 진입 또는 주요 Action 수행                                      |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | HWPX 분석결과 조회 Use Case 실행 (UNE-DOC-004)                                                    |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[template_profile, prototype_registry, document_revision\] / 쓰기 \[해당 없음\]             |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-004-01 정상: US-PLAN-005의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-004-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-004-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-004-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-004-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.8 SCR-PLAN-005 기준정보·참조자료·Snapshot

| **항목**      | **상세**                                               |
|---------------|--------------------------------------------------------|
| 모듈          | 계획서                                                 |
| Route         | /app/plans/:id/context                                 |
| 연계 Scenario | US-PLAN-007, US-PLAN-008, US-PLAN-009                  |
| 호출 API      | UNE-PLAN-006, UNE-PLAN-007, UNE-PLAN-008               |
| DB Read       | plan_context_snapshot                                  |
| DB Write      | plan_context_draft, plan_context_snapshot, audit_log   |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16 |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                             | **목적**               | **권한**  | **오류**     |
|----------|--------------|------------|------------------------------------------|------------------------|-----------|--------------|
| 1        | UNE-PLAN-006 | POST       | /api/v1/plans/{planId}/context-drafts    | 기준정보 임시저장      | PLAN_EDIT | PLAN-422-001 |
| 2        | UNE-PLAN-007 | POST       | /api/v1/plans/{planId}/context-snapshots | 기준정보 Snapshot 확정 | PLAN_EDIT | PLAN-412-001 |
| 3        | UNE-PLAN-008 | GET        | /api/v1/plans/{planId}/context-snapshots | 기준정보 Snapshot 목록 | PLAN_READ | PLAN-404-002 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-005)                                                                    | 기준정보·참조자료·Snapshot 화면 진입 또는 주요 Action 수행                                        |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 기준정보 임시저장 Use Case 실행 (UNE-PLAN-006)                                                    |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[plan_context_snapshot\] / 쓰기 \[plan_context_draft, plan_context_snapshot, audit_log\]    |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-005-01 정상: US-PLAN-007의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-005-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-005-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-005-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-005-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.9 SCR-PLAN-006 목차 생성·편집·Diff

| **항목**      | **상세**                                                                                         |
|---------------|--------------------------------------------------------------------------------------------------|
| 모듈          | 계획서                                                                                           |
| Route         | /app/plans/:id/outline                                                                           |
| 연계 Scenario | US-PLAN-009, US-PLAN-010, US-PLAN-011                                                            |
| 호출 API      | UNE-PLAN-009, UNE-PLAN-010, UNE-PLAN-011, UNE-PLAN-012, UNE-PLAN-013, UNE-PLAN-014, UNE-PLAN-015 |
| DB Read       | generation_job, job_event, toc_version, toc_node                                                 |
| DB Write      | generation_job, job_event, toc_version, toc_node                                                 |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16                                           |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                             | **목적**                  | **권한**      | **오류**    |
|----------|--------------|------------|------------------------------------------|---------------------------|---------------|-------------|
| 1        | UNE-PLAN-009 | POST       | /api/v1/plans/{planId}/toc-jobs          | T3Q RPT-001 목차 생성 Job | PLAN_GENERATE | T3Q-502-001 |
| 2        | UNE-PLAN-010 | GET        | /api/v1/plan-jobs/{jobId}                | 생성 Job 상태 조회        | PLAN_READ     | JOB-404-001 |
| 3        | UNE-PLAN-011 | GET        | /api/v1/plan-jobs/{jobId}/events         | 생성 Job SSE              | PLAN_READ     | JOB-503-001 |
| 4        | UNE-PLAN-012 | POST       | /api/v1/plan-jobs/{jobId}/cancel         | 생성 Job 중지             | PLAN_GENERATE | JOB-409-001 |
| 5        | UNE-PLAN-013 | POST       | /api/v1/plan-jobs/{jobId}/retry          | 실패 단위 재시도          | PLAN_GENERATE | JOB-409-002 |
| 6        | UNE-PLAN-014 | POST       | /api/v1/plans/{planId}/toc-versions      | 목차 편집 버전 저장       | PLAN_EDIT     | TOC-409-001 |
| 7        | UNE-PLAN-015 | GET        | /api/v1/plans/{planId}/toc-versions/{id} | 목차 버전 조회            | PLAN_READ     | TOC-404-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                              |
|----------|---------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-006)                                                                    | 목차 생성·편집·Diff 화면 진입 또는 주요 Action 수행                                                                   |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                         |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                        |
| 4        | BFF -\> Domain Service                                                                            | T3Q RPT-001 목차 생성 Job Use Case 실행 (UNE-PLAN-009)                                                                |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                      |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[generation_job, job_event, toc_version, toc_node\] / 쓰기 \[generation_job, job_event, toc_version, toc_node\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                     |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                                   |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                               |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                                   |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                             |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                           |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-006-01 정상: US-PLAN-009의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-006-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-006-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-006-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-006-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.10 SCR-PLAN-007 rhwp 계획서 편집 Workspace

| **항목**      | **상세**                                                                                             |
|---------------|------------------------------------------------------------------------------------------------------|
| 모듈          | 계획서                                                                                               |
| Route         | /app/plans/:id/edit                                                                                  |
| 연계 Scenario | US-PLAN-012, US-PLAN-013, US-PLAN-014, US-PLAN-015, US-PLAN-020                                      |
| 호출 API      | UNE-DOC-005, UNE-DOC-006, UNE-DOC-007, UNE-DOC-008, UNE-DOC-009, UNE-DOC-010, UNE-DOC-011            |
| DB Read       | document_revision, ai_edit_proposal                                                                  |
| DB Write      | change_set, change_operation, document_revision, document_autosave, generation_job, ai_edit_proposal |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16                                               |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                                  | **목적**              | **권한**    | **오류**                |
|----------|-------------|------------|---------------------------------------------------------------|-----------------------|-------------|-------------------------|
| 1        | UNE-DOC-005 | GET        | /api/v1/documents/{documentId}/ir                             | Document IR 조회      | DOC_READ    | DOC-404-001             |
| 2        | UNE-DOC-006 | POST       | /api/v1/documents/{documentId}/changesets                     | ChangeSet 원자 적용   | DOC_EDIT    | DOC-409-001,DOC-422-004 |
| 3        | UNE-DOC-007 | GET        | /api/v1/documents/{documentId}/revisions                      | Revision 목록         | DOC_READ    | DOC-404-002             |
| 4        | UNE-DOC-008 | POST       | /api/v1/documents/{documentId}/revisions/{revisionId}/restore | Revision 복원         | DOC_EDIT    | DOC-409-002             |
| 5        | UNE-DOC-009 | POST       | /api/v1/documents/{documentId}/autosaves                      | 자동저장              | DOC_EDIT    | DOC-409-003             |
| 6        | UNE-DOC-010 | POST       | /api/v1/documents/{documentId}/ai-edit-jobs                   | 선택영역 AI 편집 제안 | DOC_AI_EDIT | DOC-422-005             |
| 7        | UNE-DOC-011 | GET        | /api/v1/documents/{documentId}/ai-edit-jobs/{jobId}/proposal  | AI 편집 Diff 조회     | DOC_READ    | DOC-404-003             |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                                                                     |
|----------|---------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-007)                                                                    | rhwp 계획서 편집 Workspace 화면 진입 또는 주요 Action 수행                                                                                                   |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                                                                |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                                                               |
| 4        | BFF -\> Domain Service                                                                            | Document IR 조회 Use Case 실행 (UNE-DOC-005)                                                                                                                 |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                                                             |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[document_revision, ai_edit_proposal\] / 쓰기 \[change_set, change_operation, document_revision, document_autosave, generation_job, ai_edit_proposal\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                                                            |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                                                                          |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                                                                      |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                                                                          |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                                                                    |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                                                                  |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-007-01 정상: US-PLAN-012의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-007-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-007-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-007-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-007-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.11 SCR-PLAN-008 AI 편집·근거·Diff Drawer

| **항목**      | **상세**                                                                                             |
|---------------|------------------------------------------------------------------------------------------------------|
| 모듈          | 계획서                                                                                               |
| Route         | /app/plans/:id/edit?drawer=ai                                                                        |
| 연계 Scenario | US-PLAN-016, US-PLAN-017, US-PLAN-018, US-PLAN-019                                                   |
| 호출 API      | UNE-DOC-005, UNE-DOC-006, UNE-DOC-007, UNE-DOC-008, UNE-DOC-009, UNE-DOC-010, UNE-DOC-011            |
| DB Read       | document_revision, ai_edit_proposal                                                                  |
| DB Write      | change_set, change_operation, document_revision, document_autosave, generation_job, ai_edit_proposal |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16                                               |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                                  | **목적**              | **권한**    | **오류**                |
|----------|-------------|------------|---------------------------------------------------------------|-----------------------|-------------|-------------------------|
| 1        | UNE-DOC-005 | GET        | /api/v1/documents/{documentId}/ir                             | Document IR 조회      | DOC_READ    | DOC-404-001             |
| 2        | UNE-DOC-006 | POST       | /api/v1/documents/{documentId}/changesets                     | ChangeSet 원자 적용   | DOC_EDIT    | DOC-409-001,DOC-422-004 |
| 3        | UNE-DOC-007 | GET        | /api/v1/documents/{documentId}/revisions                      | Revision 목록         | DOC_READ    | DOC-404-002             |
| 4        | UNE-DOC-008 | POST       | /api/v1/documents/{documentId}/revisions/{revisionId}/restore | Revision 복원         | DOC_EDIT    | DOC-409-002             |
| 5        | UNE-DOC-009 | POST       | /api/v1/documents/{documentId}/autosaves                      | 자동저장              | DOC_EDIT    | DOC-409-003             |
| 6        | UNE-DOC-010 | POST       | /api/v1/documents/{documentId}/ai-edit-jobs                   | 선택영역 AI 편집 제안 | DOC_AI_EDIT | DOC-422-005             |
| 7        | UNE-DOC-011 | GET        | /api/v1/documents/{documentId}/ai-edit-jobs/{jobId}/proposal  | AI 편집 Diff 조회     | DOC_READ    | DOC-404-003             |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                                                                     |
|----------|---------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-008)                                                                    | AI 편집·근거·Diff Drawer 화면 진입 또는 주요 Action 수행                                                                                                     |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                                                                |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                                                               |
| 4        | BFF -\> Domain Service                                                                            | Document IR 조회 Use Case 실행 (UNE-DOC-005)                                                                                                                 |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                                                             |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[document_revision, ai_edit_proposal\] / 쓰기 \[change_set, change_operation, document_revision, document_autosave, generation_job, ai_edit_proposal\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                                                            |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                                                                          |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                                                                      |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                                                                          |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                                                                    |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                                                                  |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-008-01 정상: US-PLAN-016의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-008-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-008-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-008-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-008-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.12 SCR-PLAN-009 내보내기·Track A 검증

| **항목**      | **상세**                                               |
|---------------|--------------------------------------------------------|
| 모듈          | 계획서                                                 |
| Route         | /app/plans/:id/export                                  |
| 연계 Scenario | US-PLAN-021, US-PLAN-022                               |
| 호출 API      | UNE-DOC-012, UNE-DOC-013, UNE-DOC-014                  |
| DB Read       | export_job, validation_report, file_object             |
| DB Write      | export_job                                             |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16 |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                           | **목적**             | **권한**   | **오류**       |
|----------|-------------|------------|----------------------------------------|----------------------|------------|----------------|
| 1        | UNE-DOC-012 | POST       | /api/v1/documents/{documentId}/exports | HWPX/PDF/DOCX Export | DOC_EXPORT | EXPORT-422-001 |
| 2        | UNE-DOC-013 | GET        | /api/v1/exports/{exportId}             | Export 상태·검증결과 | DOC_READ   | EXPORT-404-001 |
| 3        | UNE-DOC-014 | GET        | /api/v1/exports/{exportId}/download    | Export 파일 다운로드 | DOC_READ   | EXPORT-410-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-009)                                                                    | 내보내기·Track A 검증 화면 진입 또는 주요 Action 수행                                             |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | HWPX/PDF/DOCX Export Use Case 실행 (UNE-DOC-012)                                                  |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[export_job, validation_report, file_object\] / 쓰기 \[export_job\]                         |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-009-01 정상: US-PLAN-021의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-009-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-009-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-009-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-009-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.13 SCR-PLAN-010 검토·승인·버전·최종본

| **항목**      | **상세**                                                                    |
|---------------|-----------------------------------------------------------------------------|
| 모듈          | 계획서                                                                      |
| Route         | /app/plans/:id/review                                                       |
| 연계 Scenario | US-PLAN-020, US-PLAN-027                                                    |
| 호출 API      | UNE-DOC-015, UNE-DOC-016, UNE-DOC-017                                       |
| DB Read       | \-                                                                          |
| DB Write      | review_request, notification, review_comment, document, approval, audit_log |
| 상위 ADR      | ADR-01, ADR-02, ADR-03, ADR-04, ADR-05, ADR-15, ADR-16                      |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                   | **목적**      | **권한**    | **오류**         |
|----------|-------------|------------|------------------------------------------------|---------------|-------------|------------------|
| 1        | UNE-DOC-015 | POST       | /api/v1/documents/{documentId}/submit-review   | 검토 요청     | DOC_EDIT    | REVIEW-422-001   |
| 2        | UNE-DOC-016 | POST       | /api/v1/documents/{documentId}/review-comments | 검토의견 등록 | DOC_REVIEW  | REVIEW-422-002   |
| 3        | UNE-DOC-017 | POST       | /api/v1/documents/{documentId}/approve         | 문서 승인     | DOC_APPROVE | APPROVAL-412-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                       |
|----------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-PLAN-010)                                                                    | 검토·승인·버전·최종본 화면 진입 또는 주요 Action 수행                                                          |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                  |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                 |
| 4        | BFF -\> Domain Service                                                                            | 검토 요청 Use Case 실행 (UNE-DOC-015)                                                                          |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                               |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[관련 Aggregate\] / 쓰기 \[review_request, notification, review_comment, document, approval, audit_log\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출              |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                            |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                        |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                            |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                      |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                    |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-PLAN-010-01 정상: US-PLAN-020의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-PLAN-010-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-PLAN-010-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-PLAN-010-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-PLAN-010-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.14 SCR-ADMIN-TPL-001 Template Profile 관리·공유·승격

| **항목**      | **상세**                          |
|---------------|-----------------------------------|
| 모듈          | 관리                              |
| Route         | /app/admin/templates              |
| 연계 Scenario | US-PLAN-028                       |
| 호출 API      | UNE-ADMIN-001, UNE-ADMIN-005      |
| DB Read       | tenant, app_user, role, audit_log |
| DB Write      | \-                                |
| 상위 ADR      | ADR-01~18 공통                    |

### A. API 호출 명세

| **순번** | **API ID**    | **Method** | **Endpoint**                 | **목적**              | **권한**     | **오류**   |
|----------|---------------|------------|------------------------------|-----------------------|--------------|------------|
| 1        | UNE-ADMIN-001 | GET        | /api/v1/admin/access/summary | 기관·사용자·RBAC 요약 | ADMIN_ACCESS | ADMIN-9001 |
| 2        | UNE-ADMIN-005 | GET        | /api/v1/admin/audit-logs     | 감사로그 검색         | AUDIT_READ   | AUDIT-9001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-ADMIN-TPL-001)                                                               | Template Profile 관리·공유·승격 화면 진입 또는 주요 Action 수행                                   |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 기관·사용자·RBAC 요약 Use Case 실행 (UNE-ADMIN-001)                                               |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[tenant, app_user, role, audit_log\] / 쓰기 \[해당 없음\]                                   |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-ADMIN-TPL-001-01 정상: US-PLAN-028의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-ADMIN-TPL-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-ADMIN-TPL-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-ADMIN-TPL-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-ADMIN-TPL-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.15 SCR-QA-RT-001 한컴 Round-trip QA·배포 Gate

| **항목**      | **상세**                          |
|---------------|-----------------------------------|
| 모듈          | QA                                |
| Route         | /app/qa/hwpx-roundtrip            |
| 연계 Scenario | US-PLAN-029, US-PLAN-030          |
| 호출 API      | UNE-AUTH-002                      |
| DB Read       | app_user, user_role, organization |
| DB Write      | \-                                |
| 상위 ADR      | ADR-01~18 공통                    |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**    | **목적**                   | **권한**      | **오류**  |
|----------|--------------|------------|-----------------|----------------------------|---------------|-----------|
| 1        | UNE-AUTH-002 | GET        | /api/v1/auth/me | 현재 사용자·기관·역할 조회 | AUTHENTICATED | AUTH-1005 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-QA-RT-001)                                                                   | 한컴 Round-trip QA·배포 Gate 화면 진입 또는 주요 Action 수행                                      |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 현재 사용자·기관·역할 조회 Use Case 실행 (UNE-AUTH-002)                                           |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[app_user, user_role, organization\] / 쓰기 \[해당 없음\]                                   |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-QA-RT-001-01 정상: US-PLAN-029의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-QA-RT-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-QA-RT-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-QA-RT-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-QA-RT-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.16 SCR-SIT-001 사건·훈련 목록·상황 홈

| **항목**      | **상세**                                       |
|---------------|------------------------------------------------|
| 모듈          | 상황·훈련                                      |
| Route         | /app/incidents                                 |
| 연계 Scenario | US-SIT-001, US-SIT-002                         |
| 호출 API      | UNE-SIT-002, UNE-SIT-003                       |
| DB Read       | situation, situation_snapshot                  |
| DB Write      | \-                                             |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14 |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**            | **목적**       | **권한**       | **오류**    |
|----------|-------------|------------|-------------------------|----------------|----------------|-------------|
| 1        | UNE-SIT-002 | GET        | /api/v1/situations      | 상황·훈련 목록 | SITUATION_READ | SIT-5002    |
| 2        | UNE-SIT-003 | GET        | /api/v1/situations/{id} | 상황 상세      | SITUATION_READ | SIT-404-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-001)                                                                     | 사건·훈련 목록·상황 홈 화면 진입 또는 주요 Action 수행                                            |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 상황·훈련 목록 Use Case 실행 (UNE-SIT-002)                                                        |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[situation, situation_snapshot\] / 쓰기 \[해당 없음\]                                       |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-001-01 정상: US-SIT-001의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.17 SCR-SIT-002 사건·훈련 Workspace 개요

| **항목**      | **상세**                                       |
|---------------|------------------------------------------------|
| 모듈          | 상황·훈련                                      |
| Route         | /app/incidents/:id                             |
| 연계 Scenario | US-SIT-002, US-SIT-026                         |
| 호출 API      | UNE-SIT-003, UNE-SIT-005, UNE-SIT-012          |
| DB Read       | situation, situation_snapshot                  |
| DB Write      | provider_job, situation_snapshot, audit_log    |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14 |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                             | **목적**                | **권한**               | **오류**                |
|----------|-------------|------------|------------------------------------------|-------------------------|------------------------|-------------------------|
| 1        | UNE-SIT-003 | GET        | /api/v1/situations/{id}                  | 상황 상세               | SITUATION_READ         | SIT-404-001             |
| 2        | UNE-SIT-005 | POST       | /api/v1/situations/{id}/provider-queries | 공식·보조 Provider 조회 | SITUATION_FACT_COLLECT | PROV-503-001            |
| 3        | UNE-SIT-012 | POST       | /api/v1/situations/{id}/snapshots        | SituationSnapshot 확정  | SITUATION_CONFIRM      | SIT-412-003,SIT-422-006 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-002)                                                                     | 사건·훈련 Workspace 개요 화면 진입 또는 주요 Action 수행                                          |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 상황 상세 Use Case 실행 (UNE-SIT-003)                                                             |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[situation, situation_snapshot\] / 쓰기 \[provider_job, situation_snapshot, audit_log\]     |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-002-01 정상: US-SIT-002의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-002-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-002-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-002-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-002-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.18 SCR-SIT-003 사건·훈련 기본정보 등록

| **항목**      | **상세**                                       |
|---------------|------------------------------------------------|
| 모듈          | 상황·훈련                                      |
| Route         | /app/incidents/new                             |
| 연계 Scenario | US-SIT-003                                     |
| 호출 API      | UNE-SIT-001, UNE-SIT-003, UNE-SIT-004          |
| DB Read       | situation, situation_snapshot                  |
| DB Write      | situation, audit_log                           |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14 |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**            | **목적**           | **권한**         | **오류**    |
|----------|-------------|------------|-------------------------|--------------------|------------------|-------------|
| 1        | UNE-SIT-001 | POST       | /api/v1/situations      | 실재난/훈련 등록   | SITUATION_CREATE | SIT-5001    |
| 2        | UNE-SIT-003 | GET        | /api/v1/situations/{id} | 상황 상세          | SITUATION_READ   | SIT-404-001 |
| 3        | UNE-SIT-004 | PATCH      | /api/v1/situations/{id} | 상황 기본정보 수정 | SITUATION_EDIT   | SIT-409-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-003)                                                                     | 사건·훈련 기본정보 등록 화면 진입 또는 주요 Action 수행                                           |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 실재난/훈련 등록 Use Case 실행 (UNE-SIT-001)                                                      |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[situation, situation_snapshot\] / 쓰기 \[situation, audit_log\]                            |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-003-01 정상: US-SIT-003의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-003-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-003-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-003-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-003-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.19 SCR-SIT-004 외부 Provider 조회·운영상태

| **항목**      | **상세**                                       |
|---------------|------------------------------------------------|
| 모듈          | 상황·훈련                                      |
| Route         | /app/incidents/:id/providers                   |
| 연계 Scenario | US-SIT-004, US-SIT-005, US-SIT-039             |
| 호출 API      | UNE-SIT-005, UNE-SIT-006, UNE-SIT-007          |
| DB Read       | provider_job, provider_result                  |
| DB Write      | provider_job, situation_fact, fact_source      |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14 |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                             | **목적**                | **권한**               | **오류**     |
|----------|-------------|------------|------------------------------------------|-------------------------|------------------------|--------------|
| 1        | UNE-SIT-005 | POST       | /api/v1/situations/{id}/provider-queries | 공식·보조 Provider 조회 | SITUATION_FACT_COLLECT | PROV-503-001 |
| 2        | UNE-SIT-006 | GET        | /api/v1/provider-jobs/{jobId}/events     | Provider 수집 SSE       | SITUATION_READ         | PROV-503-002 |
| 3        | UNE-SIT-007 | POST       | /api/v1/situations/{id}/facts            | 수동 Fact 등록          | SITUATION_FACT_EDIT    | FACT-422-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-004)                                                                     | 외부 Provider 조회·운영상태 화면 진입 또는 주요 Action 수행                                       |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 공식·보조 Provider 조회 Use Case 실행 (UNE-SIT-005)                                               |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[provider_job, provider_result\] / 쓰기 \[provider_job, situation_fact, fact_source\]       |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-004-01 정상: US-SIT-004의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-004-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-004-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-004-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-004-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.20 SCR-SIT-005 SituationFact 후보·현장보고

| **항목**      | **상세**                                                                          |
|---------------|-----------------------------------------------------------------------------------|
| 모듈          | 상황·훈련                                                                         |
| Route         | /app/incidents/:id/facts                                                          |
| 연계 Scenario | US-SIT-006, US-SIT-007, US-SIT-022, US-SIT-029                                    |
| 호출 API      | UNE-SIT-007, UNE-SIT-008, UNE-SIT-009, UNE-SIT-010, UNE-SIT-011                   |
| DB Read       | fact_conflict                                                                     |
| DB Write      | situation_fact, fact_source, audit_log, fact_duplicate_group, conflict_resolution |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14                                    |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                           | **목적**         | **권한**            | **오류**     |
|----------|-------------|------------|--------------------------------------------------------|------------------|---------------------|--------------|
| 1        | UNE-SIT-007 | POST       | /api/v1/situations/{id}/facts                          | 수동 Fact 등록   | SITUATION_FACT_EDIT | FACT-422-001 |
| 2        | UNE-SIT-008 | PATCH      | /api/v1/situations/{id}/facts/{factId}                 | 후보 Fact 보정   | SITUATION_FACT_EDIT | FACT-409-001 |
| 3        | UNE-SIT-009 | POST       | /api/v1/situations/{id}/facts/deduplicate              | Fact 중복군 계산 | SITUATION_FACT_EDIT | FACT-422-002 |
| 4        | UNE-SIT-010 | GET        | /api/v1/situations/{id}/conflicts                      | Fact 충돌 목록   | SITUATION_READ      | FACT-404-002 |
| 5        | UNE-SIT-011 | POST       | /api/v1/situations/{id}/conflicts/{conflictId}/resolve | Fact 충돌 확정   | SITUATION_CONFIRM   | SIT-412-003  |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                            |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-005)                                                                     | SituationFact 후보·현장보고 화면 진입 또는 주요 Action 수행                                                         |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                       |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                      |
| 4        | BFF -\> Domain Service                                                                            | 수동 Fact 등록 Use Case 실행 (UNE-SIT-007)                                                                          |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                    |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[fact_conflict\] / 쓰기 \[situation_fact, fact_source, audit_log, fact_duplicate_group, conflict_resolution\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                   |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                                 |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                             |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                                 |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                           |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                         |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-005-01 정상: US-SIT-006의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-005-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-005-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-005-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-005-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.21 SCR-SIT-006 충돌 Fact 비교·결정

| **항목**      | **상세**                                                                          |
|---------------|-----------------------------------------------------------------------------------|
| 모듈          | 상황·훈련                                                                         |
| Route         | /app/incidents/:id/facts/conflicts                                                |
| 연계 Scenario | US-SIT-007                                                                        |
| 호출 API      | UNE-SIT-007, UNE-SIT-008, UNE-SIT-009, UNE-SIT-010, UNE-SIT-011                   |
| DB Read       | fact_conflict                                                                     |
| DB Write      | situation_fact, fact_source, audit_log, fact_duplicate_group, conflict_resolution |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14                                    |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                           | **목적**         | **권한**            | **오류**     |
|----------|-------------|------------|--------------------------------------------------------|------------------|---------------------|--------------|
| 1        | UNE-SIT-007 | POST       | /api/v1/situations/{id}/facts                          | 수동 Fact 등록   | SITUATION_FACT_EDIT | FACT-422-001 |
| 2        | UNE-SIT-008 | PATCH      | /api/v1/situations/{id}/facts/{factId}                 | 후보 Fact 보정   | SITUATION_FACT_EDIT | FACT-409-001 |
| 3        | UNE-SIT-009 | POST       | /api/v1/situations/{id}/facts/deduplicate              | Fact 중복군 계산 | SITUATION_FACT_EDIT | FACT-422-002 |
| 4        | UNE-SIT-010 | GET        | /api/v1/situations/{id}/conflicts                      | Fact 충돌 목록   | SITUATION_READ      | FACT-404-002 |
| 5        | UNE-SIT-011 | POST       | /api/v1/situations/{id}/conflicts/{conflictId}/resolve | Fact 충돌 확정   | SITUATION_CONFIRM   | SIT-412-003  |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                            |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-006)                                                                     | 충돌 Fact 비교·결정 화면 진입 또는 주요 Action 수행                                                                 |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                       |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                      |
| 4        | BFF -\> Domain Service                                                                            | 수동 Fact 등록 Use Case 실행 (UNE-SIT-007)                                                                          |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                    |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[fact_conflict\] / 쓰기 \[situation_fact, fact_source, audit_log, fact_duplicate_group, conflict_resolution\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                   |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                                 |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                             |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                                 |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                           |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                         |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-006-01 정상: US-SIT-007의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-006-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-006-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-006-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-006-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.22 SCR-SIT-007 SituationSnapshot 확정·이력

| **항목**      | **상세**                                       |
|---------------|------------------------------------------------|
| 모듈          | 상황·훈련                                      |
| Route         | /app/incidents/:id/snapshots                   |
| 연계 Scenario | US-SIT-008, US-SIT-035                         |
| 호출 API      | UNE-SIT-012, UNE-SIT-013                       |
| DB Read       | situation_snapshot                             |
| DB Write      | situation_snapshot, audit_log                  |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14 |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                      | **목적**               | **권한**          | **오류**                |
|----------|-------------|------------|-----------------------------------|------------------------|-------------------|-------------------------|
| 1        | UNE-SIT-012 | POST       | /api/v1/situations/{id}/snapshots | SituationSnapshot 확정 | SITUATION_CONFIRM | SIT-412-003,SIT-422-006 |
| 2        | UNE-SIT-013 | GET        | /api/v1/situations/{id}/snapshots | Snapshot 목록·Diff     | SITUATION_READ    | SIT-404-003             |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-007)                                                                     | SituationSnapshot 확정·이력 화면 진입 또는 주요 Action 수행                                       |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | SituationSnapshot 확정 Use Case 실행 (UNE-SIT-012)                                                |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[situation_snapshot\] / 쓰기 \[situation_snapshot, audit_log\]                              |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-007-01 정상: US-SIT-008의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-007-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-007-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-007-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-007-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.23 SCR-SIT-008 훈련·매뉴얼 자료 업로드

| **항목**      | **상세**                                       |
|---------------|------------------------------------------------|
| 모듈          | 상황·훈련                                      |
| Route         | /app/incidents/:id/sources                     |
| 연계 Scenario | US-SIT-009                                     |
| 호출 API      | UNE-KNOW-001, UNE-KNOW-002, UNE-KNOW-003       |
| DB Read       | knowledge_document, provider_job               |
| DB Write      | knowledge_document, provider_job               |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14 |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                                | **목적**              | **권한**         | **오류**     |
|----------|--------------|------------|---------------------------------------------|-----------------------|------------------|--------------|
| 1        | UNE-KNOW-001 | POST       | /api/v1/situations/{id}/knowledge-documents | 훈련·매뉴얼 자료 등록 | KNOWLEDGE_UPLOAD | KNOW-422-001 |
| 2        | UNE-KNOW-002 | GET        | /api/v1/knowledge-documents/{id}            | UNI 처리상태 조회     | KNOWLEDGE_READ   | UNI-503-001  |
| 3        | UNE-KNOW-003 | POST       | /api/v1/knowledge-documents/{id}/retry      | UNI 학습 재시도       | KNOWLEDGE_UPLOAD | UNI-409-001  |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-008)                                                                     | 훈련·매뉴얼 자료 업로드 화면 진입 또는 주요 Action 수행                                           |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 훈련·매뉴얼 자료 등록 Use Case 실행 (UNE-KNOW-001)                                                |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[knowledge_document, provider_job\] / 쓰기 \[knowledge_document, provider_job\]             |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-008-01 정상: US-SIT-009의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-008-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-008-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-008-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-008-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.24 SCR-SIT-009 UNI 학습상태·문서 관리

| **항목**      | **상세**                                       |
|---------------|------------------------------------------------|
| 모듈          | 상황·훈련                                      |
| Route         | /app/incidents/:id/sources/status              |
| 연계 Scenario | US-SIT-010, US-SIT-039                         |
| 호출 API      | UNE-KNOW-001, UNE-KNOW-002, UNE-KNOW-003       |
| DB Read       | knowledge_document, provider_job               |
| DB Write      | knowledge_document, provider_job               |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14 |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                                | **목적**              | **권한**         | **오류**     |
|----------|--------------|------------|---------------------------------------------|-----------------------|------------------|--------------|
| 1        | UNE-KNOW-001 | POST       | /api/v1/situations/{id}/knowledge-documents | 훈련·매뉴얼 자료 등록 | KNOWLEDGE_UPLOAD | KNOW-422-001 |
| 2        | UNE-KNOW-002 | GET        | /api/v1/knowledge-documents/{id}            | UNI 처리상태 조회     | KNOWLEDGE_READ   | UNI-503-001  |
| 3        | UNE-KNOW-003 | POST       | /api/v1/knowledge-documents/{id}/retry      | UNI 학습 재시도       | KNOWLEDGE_UPLOAD | UNI-409-001  |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-009)                                                                     | UNI 학습상태·문서 관리 화면 진입 또는 주요 Action 수행                                            |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 훈련·매뉴얼 자료 등록 Use Case 실행 (UNE-KNOW-001)                                                |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[knowledge_document, provider_job\] / 쓰기 \[knowledge_document, provider_job\]             |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-009-01 정상: US-SIT-010의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-009-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-009-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-009-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-009-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.25 SCR-SIT-010 RAG Evidence 검색·선택·동결

| **항목**      | **상세**                                               |
|---------------|--------------------------------------------------------|
| 모듈          | 상황·훈련                                              |
| Route         | /app/incidents/:id/evidence                            |
| 연계 Scenario | US-SIT-011                                             |
| 호출 API      | UNE-KNOW-004, UNE-KNOW-005, UNE-KNOW-006, UNE-KNOW-007 |
| DB Read       | evidence_set, evidence_item, knowledge_document        |
| DB Write      | evidence_set, evidence_item, audit_log                 |
| 상위 ADR      | ADR-06, ADR-08, ADR-09, ADR-11, ADR-13, ADR-14         |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                              | **목적**            | **권한**        | **오류**     |
|----------|--------------|------------|-------------------------------------------|---------------------|-----------------|--------------|
| 1        | UNE-KNOW-004 | POST       | /api/v1/situations/{id}/evidence-searches | UNI RAG 근거 검색   | EVIDENCE_SEARCH | UNI-422-002  |
| 2        | UNE-KNOW-005 | GET        | /api/v1/evidence-sets/{id}                | EvidenceSet 조회    | EVIDENCE_READ   | EVID-404-001 |
| 3        | UNE-KNOW-006 | POST       | /api/v1/evidence-sets/{id}/lock           | EvidenceSet 고정    | EVIDENCE_LOCK   | EVID-409-001 |
| 4        | UNE-KNOW-007 | GET        | /api/v1/evidence-items/{id}/source        | 근거 원문 위치 조회 | EVIDENCE_READ   | EVID-404-002 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                   |
|----------|---------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SIT-010)                                                                     | RAG Evidence 검색·선택·동결 화면 진입 또는 주요 Action 수행                                                |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                              |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                             |
| 4        | BFF -\> Domain Service                                                                            | UNI RAG 근거 검색 Use Case 실행 (UNE-KNOW-004)                                                             |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                           |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[evidence_set, evidence_item, knowledge_document\] / 쓰기 \[evidence_set, evidence_item, audit_log\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출          |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                        |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                    |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                        |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                  |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SIT-010-01 정상: US-SIT-011의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SIT-010-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SIT-010-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SIT-010-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SIT-010-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.26 SCR-SOP-001 SOP 생성 설정

| **항목**      | **상세**                               |
|---------------|----------------------------------------|
| 모듈          | SOP                                    |
| Route         | /app/incidents/:id/sop/generate        |
| 연계 Scenario | US-SIT-012                             |
| 호출 API      | UNE-SOP-001, UNE-SOP-002, UNE-SOP-003  |
| DB Read       | generation_job, job_event              |
| DB Write      | generation_job, sop                    |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18 |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                | **목적**            | **권한**     | **오류**    |
|----------|-------------|------------|---------------------------------------------|---------------------|--------------|-------------|
| 1        | UNE-SOP-001 | POST       | /api/v1/situations/{id}/sop-generation-jobs | UNI 구조화 SOP 생성 | SOP_GENERATE | UNI-422-003 |
| 2        | UNE-SOP-002 | GET        | /api/v1/sop-generation-jobs/{jobId}/events  | SOP 생성 SSE        | SOP_READ     | UNI-503-003 |
| 3        | UNE-SOP-003 | POST       | /api/v1/sops                                | SOP 정의 생성       | SOP_EDIT     | SOP-6001    |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-001)                                                                     | SOP 생성 설정 화면 진입 또는 주요 Action 수행                                                     |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | UNI 구조화 SOP 생성 Use Case 실행 (UNE-SOP-001)                                                   |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[generation_job, job_event\] / 쓰기 \[generation_job, sop\]                                 |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-001-01 정상: US-SIT-012의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.27 SCR-SOP-002 SOP JSON SSE 생성·Mapper 결과

| **항목**      | **상세**                               |
|---------------|----------------------------------------|
| 모듈          | SOP                                    |
| Route         | /app/incidents/:id/sop/generate/:jobId |
| 연계 Scenario | US-SIT-012, US-SIT-013                 |
| 호출 API      | UNE-SOP-001, UNE-SOP-002, UNE-SOP-003  |
| DB Read       | generation_job, job_event              |
| DB Write      | generation_job, sop                    |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18 |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                | **목적**            | **권한**     | **오류**    |
|----------|-------------|------------|---------------------------------------------|---------------------|--------------|-------------|
| 1        | UNE-SOP-001 | POST       | /api/v1/situations/{id}/sop-generation-jobs | UNI 구조화 SOP 생성 | SOP_GENERATE | UNI-422-003 |
| 2        | UNE-SOP-002 | GET        | /api/v1/sop-generation-jobs/{jobId}/events  | SOP 생성 SSE        | SOP_READ     | UNI-503-003 |
| 3        | UNE-SOP-003 | POST       | /api/v1/sops                                | SOP 정의 생성       | SOP_EDIT     | SOP-6001    |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-002)                                                                     | SOP JSON SSE 생성·Mapper 결과 화면 진입 또는 주요 Action 수행                                     |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | UNI 구조화 SOP 생성 Use Case 실행 (UNE-SOP-001)                                                   |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[generation_job, job_event\] / 쓰기 \[generation_job, sop\]                                 |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-002-01 정상: US-SIT-012의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-002-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-002-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-002-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-002-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.28 SCR-SOP-003 SOP Flow Canvas

| **항목**      | **상세**                                        |
|---------------|-------------------------------------------------|
| 모듈          | SOP                                             |
| Route         | /app/incidents/:id/sop/:sopId/edit              |
| 연계 Scenario | US-SIT-013, US-SIT-014                          |
| 호출 API      | UNE-SOP-005, UNE-SOP-006, UNE-SOP-007           |
| DB Read       | sop, sop_version, sop_node, sop_edge            |
| DB Write      | sop_version, sop_node, sop_edge, sop_validation |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18          |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                  | **목적**            | **권한** | **오류**    |
|----------|-------------|------------|-------------------------------|---------------------|----------|-------------|
| 1        | UNE-SOP-005 | GET        | /api/v1/sops/{sopId}          | SOP 그래프 조회     | SOP_READ | SOP-404-001 |
| 2        | UNE-SOP-006 | POST       | /api/v1/sops/{sopId}/versions | SOP Draft 버전 저장 | SOP_EDIT | SOP-409-001 |
| 3        | UNE-SOP-007 | POST       | /api/v1/sops/{sopId}/validate | DAG·임무·분기 검증  | SOP_EDIT | SOP-422-007 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                 |
|----------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-003)                                                                     | SOP Flow Canvas 화면 진입 또는 주요 Action 수행                                                          |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                            |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                           |
| 4        | BFF -\> Domain Service                                                                            | SOP 그래프 조회 Use Case 실행 (UNE-SOP-005)                                                              |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                         |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[sop, sop_version, sop_node, sop_edge\] / 쓰기 \[sop_version, sop_node, sop_edge, sop_validation\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출        |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                      |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                  |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                      |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                              |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-003-01 정상: US-SIT-013의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-003-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-003-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-003-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-003-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.29 SCR-SOP-004 노드 속성·조직·채널 매핑

| **항목**      | **상세**                                            |
|---------------|-----------------------------------------------------|
| 모듈          | SOP                                                 |
| Route         | /app/incidents/:id/sop/:sopId/edit?panel=node       |
| 연계 Scenario | US-SIT-014                                          |
| 호출 API      | UNE-SOP-004, UNE-SOP-005, UNE-SOP-012               |
| DB Read       | sop, sop_version, sop_node, sop_edge, sop_run, task |
| DB Write      | \-                                                  |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18              |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**             | **목적**        | **권한** | **오류**    |
|----------|-------------|------------|--------------------------|-----------------|----------|-------------|
| 1        | UNE-SOP-004 | GET        | /api/v1/sops             | SOP 목록        | SOP_READ | SOP-6002    |
| 2        | UNE-SOP-005 | GET        | /api/v1/sops/{sopId}     | SOP 그래프 조회 | SOP_READ | SOP-404-001 |
| 3        | UNE-SOP-012 | GET        | /api/v1/sop-runs/{runId} | 실행 상세       | SOP_READ | SOP-404-002 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-004)                                                                     | 노드 속성·조직·채널 매핑 화면 진입 또는 주요 Action 수행                                          |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | SOP 목록 Use Case 실행 (UNE-SOP-004)                                                              |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[sop, sop_version, sop_node, sop_edge, sop_run, task\] / 쓰기 \[해당 없음\]                 |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-004-01 정상: US-SIT-014의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-004-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-004-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-004-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-004-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.30 SCR-SOP-005 SOP 검토·승인·버전 고정

| **항목**      | **상세**                                         |
|---------------|--------------------------------------------------|
| 모듈          | SOP                                              |
| Route         | /app/incidents/:id/sop/:sopId/review             |
| 연계 Scenario | US-SIT-015                                       |
| 호출 API      | UNE-SOP-008, UNE-SOP-009                         |
| DB Read       | \-                                               |
| DB Write      | review_request, sop_version, approval, audit_log |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18           |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                       | **목적**           | **권한**    | **오류**    |
|----------|-------------|------------|------------------------------------|--------------------|-------------|-------------|
| 1        | UNE-SOP-008 | POST       | /api/v1/sops/{sopId}/submit-review | SOP 검토 요청      | SOP_EDIT    | SOP-412-001 |
| 2        | UNE-SOP-009 | POST       | /api/v1/sops/{sopId}/approve       | SOP 승인·버전 고정 | SOP_APPROVE | SOP-412-002 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-005)                                                                     | SOP 검토·승인·버전 고정 화면 진입 또는 주요 Action 수행                                           |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | SOP 검토 요청 Use Case 실행 (UNE-SOP-008)                                                         |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[관련 Aggregate\] / 쓰기 \[review_request, sop_version, approval, audit_log\]               |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-005-01 정상: US-SIT-015의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-005-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-005-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-005-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-005-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.31 SCR-SOP-006 SOP 시뮬레이션·Dry-run

| **항목**      | **상세**                               |
|---------------|----------------------------------------|
| 모듈          | SOP                                    |
| Route         | /app/incidents/:id/sop/:sopId/simulate |
| 연계 Scenario | US-SIT-016, US-SIT-017                 |
| 호출 API      | UNE-SOP-010, UNE-SOP-012, UNE-SOP-013  |
| DB Read       | sop_run, task, execution_event         |
| DB Write      | sop_run, task                          |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18 |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                     | **목적**     | **권한** | **오류**    |
|----------|-------------|------------|----------------------------------|--------------|----------|-------------|
| 1        | UNE-SOP-010 | POST       | /api/v1/sops/{sopId}/simulations | Dry-run 시작 | SOP_RUN  | SOP-422-008 |
| 2        | UNE-SOP-012 | GET        | /api/v1/sop-runs/{runId}         | 실행 상세    | SOP_READ | SOP-404-002 |
| 3        | UNE-SOP-013 | GET        | /api/v1/sop-runs/{runId}/events  | 실행 SSE     | SOP_READ | SOP-503-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-006)                                                                     | SOP 시뮬레이션·Dry-run 화면 진입 또는 주요 Action 수행                                            |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | Dry-run 시작 Use Case 실행 (UNE-SOP-010)                                                          |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[sop_run, task, execution_event\] / 쓰기 \[sop_run, task\]                                  |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-006-01 정상: US-SIT-016의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-006-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-006-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-006-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-006-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.32 SCR-SOP-007 SOP 실행 시작·제어·종료

| **항목**      | **상세**                                                                     |
|---------------|------------------------------------------------------------------------------|
| 모듈          | SOP                                                                          |
| Route         | /app/incidents/:id/executions/:executionId                                   |
| 연계 Scenario | US-SIT-017, US-SIT-027                                                       |
| 호출 API      | UNE-SOP-011, UNE-SOP-012, UNE-SOP-013, UNE-SOP-014, UNE-SOP-015, UNE-SOP-016 |
| DB Read       | sop_run, task, execution_event                                               |
| DB Write      | sop_run, task, execution_event, outbox_message                               |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18                                       |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                       | **목적**      | **권한**        | **오류**    |
|----------|-------------|------------|------------------------------------|---------------|-----------------|-------------|
| 1        | UNE-SOP-011 | POST       | /api/v1/sops/{sopId}/runs          | 실행 시작     | SOP_RUN         | SOP-409-005 |
| 2        | UNE-SOP-012 | GET        | /api/v1/sop-runs/{runId}           | 실행 상세     | SOP_READ        | SOP-404-002 |
| 3        | UNE-SOP-013 | GET        | /api/v1/sop-runs/{runId}/events    | 실행 SSE      | SOP_READ        | SOP-503-001 |
| 4        | UNE-SOP-014 | POST       | /api/v1/sop-runs/{runId}/pause     | 실행 일시중지 | SOP_RUN_CONTROL | SOP-409-006 |
| 5        | UNE-SOP-015 | POST       | /api/v1/sop-runs/{runId}/resume    | 실행 재개     | SOP_RUN_CONTROL | SOP-409-007 |
| 6        | UNE-SOP-016 | POST       | /api/v1/sop-runs/{runId}/terminate | 실행 강제종료 | SOP_RUN_CONTROL | SOP-409-008 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-007)                                                                     | SOP 실행 시작·제어·종료 화면 진입 또는 주요 Action 수행                                           |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 실행 시작 Use Case 실행 (UNE-SOP-011)                                                             |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[sop_run, task, execution_event\] / 쓰기 \[sop_run, task, execution_event, outbox_message\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-007-01 정상: US-SIT-017의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-007-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-007-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-007-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-007-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.33 SCR-SOP-008 전파대상·메시지·Outbox

| **항목**      | **상세**                                                     |
|---------------|--------------------------------------------------------------|
| 모듈          | SOP                                                          |
| Route         | /app/incidents/:id/executions/:executionId/propagation       |
| 연계 Scenario | US-SIT-018                                                   |
| 호출 API      | UNE-TASK-003, UNE-TASK-013, UNE-TASK-014                     |
| DB Read       | dispatch, dispatch_recipient, channel_delivery               |
| DB Write      | dispatch, dispatch_recipient, outbox_message, outbox_attempt |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18                       |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                    | **목적**            | **권한**      | **오류**       |
|----------|--------------|------------|---------------------------------|---------------------|---------------|----------------|
| 1        | UNE-TASK-003 | POST       | /api/v1/tasks/{taskId}/dispatch | 임무·상황 전파      | TASK_DISPATCH | OUTBOX-503-001 |
| 2        | UNE-TASK-013 | GET        | /api/v1/dispatches/{id}         | 전파·수신 상태 조회 | TASK_READ     | DISP-404-001   |
| 3        | UNE-TASK-014 | POST       | /api/v1/dispatches/{id}/retry   | 실패 수신자 재전파  | TASK_DISPATCH | DISP-409-001   |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                                        |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-008)                                                                     | 전파대상·메시지·Outbox 화면 진입 또는 주요 Action 수행                                                                          |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                                   |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                                  |
| 4        | BFF -\> Domain Service                                                                            | 임무·상황 전파 Use Case 실행 (UNE-TASK-003)                                                                                     |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                                |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[dispatch, dispatch_recipient, channel_delivery\] / 쓰기 \[dispatch, dispatch_recipient, outbox_message, outbox_attempt\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                               |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                                             |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                                         |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                                             |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                                       |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                                     |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-008-01 정상: US-SIT-018의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-008-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-008-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-008-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-008-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.34 SCR-SOP-009 채널 송신상태·재시도

| **항목**      | **상세**                                            |
|---------------|-----------------------------------------------------|
| 모듈          | SOP                                                 |
| Route         | /app/incidents/:id/executions/:executionId/messages |
| 연계 Scenario | US-SIT-019, US-SIT-025, US-SIT-039                  |
| 호출 API      | UNE-SOP-004, UNE-SOP-005, UNE-SOP-012               |
| DB Read       | sop, sop_version, sop_node, sop_edge, sop_run, task |
| DB Write      | \-                                                  |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18              |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**             | **목적**        | **권한** | **오류**    |
|----------|-------------|------------|--------------------------|-----------------|----------|-------------|
| 1        | UNE-SOP-004 | GET        | /api/v1/sops             | SOP 목록        | SOP_READ | SOP-6002    |
| 2        | UNE-SOP-005 | GET        | /api/v1/sops/{sopId}     | SOP 그래프 조회 | SOP_READ | SOP-404-001 |
| 3        | UNE-SOP-012 | GET        | /api/v1/sop-runs/{runId} | 실행 상세       | SOP_READ | SOP-404-002 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-009)                                                                     | 채널 송신상태·재시도 화면 진입 또는 주요 Action 수행                                              |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | SOP 목록 Use Case 실행 (UNE-SOP-004)                                                              |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[sop, sop_version, sop_node, sop_edge, sop_run, task\] / 쓰기 \[해당 없음\]                 |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-009-01 정상: US-SIT-019의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-009-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-009-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-009-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-009-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.35 SCR-SOP-010 상황판단·분기 선택

| **항목**      | **상세**                                                     |
|---------------|--------------------------------------------------------------|
| 모듈          | SOP                                                          |
| Route         | /app/incidents/:id/executions/:executionId/decisions/:nodeId |
| 연계 Scenario | US-SIT-024                                                   |
| 호출 API      | UNE-SOP-004, UNE-SOP-005, UNE-SOP-012                        |
| DB Read       | sop, sop_version, sop_node, sop_edge, sop_run, task          |
| DB Write      | \-                                                           |
| 상위 ADR      | ADR-06, ADR-07, ADR-13, ADR-17, ADR-18                       |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**             | **목적**        | **권한** | **오류**    |
|----------|-------------|------------|--------------------------|-----------------|----------|-------------|
| 1        | UNE-SOP-004 | GET        | /api/v1/sops             | SOP 목록        | SOP_READ | SOP-6002    |
| 2        | UNE-SOP-005 | GET        | /api/v1/sops/{sopId}     | SOP 그래프 조회 | SOP_READ | SOP-404-001 |
| 3        | UNE-SOP-012 | GET        | /api/v1/sop-runs/{runId} | 실행 상세       | SOP_READ | SOP-404-002 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-SOP-010)                                                                     | 상황판단·분기 선택 화면 진입 또는 주요 Action 수행                                                |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | SOP 목록 Use Case 실행 (UNE-SOP-004)                                                              |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[sop, sop_version, sop_node, sop_edge, sop_run, task\] / 쓰기 \[해당 없음\]                 |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-SOP-010-01 정상: US-SIT-024의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-SOP-010-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-SOP-010-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-SOP-010-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-SOP-010-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.36 SCR-TASK-001 현장 임무 수신·착수·진행

| **항목**      | **상세**                                                             |
|---------------|----------------------------------------------------------------------|
| 모듈          | 현장 임무                                                            |
| Route         | /task/:signedToken                                                   |
| 연계 Scenario | US-SIT-020, US-SIT-021                                               |
| 호출 API      | UNE-TASK-001, UNE-TASK-002, UNE-TASK-004, UNE-TASK-005, UNE-TASK-006 |
| DB Read       | task, task_assignment, task_event, task_attachment                   |
| DB Write      | task, task_event, execution_event                                    |
| 상위 ADR      | ADR-07, ADR-10, ADR-17                                               |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                       | **목적**  | **권한**      | **오류**     |
|----------|--------------|------------|------------------------------------|-----------|---------------|--------------|
| 1        | UNE-TASK-001 | GET        | /api/v1/tasks                      | 임무 목록 | TASK_READ     | TASK-7001    |
| 2        | UNE-TASK-002 | GET        | /api/v1/tasks/{taskId}             | 임무 상세 | TASK_READ     | TASK-404-001 |
| 3        | UNE-TASK-004 | POST       | /api/v1/tasks/{taskId}/acknowledge | 수신확인  | TASK_ASSIGNEE | TASK-409-001 |
| 4        | UNE-TASK-005 | POST       | /api/v1/tasks/{taskId}/start       | 임무 착수 | TASK_ASSIGNEE | TASK-409-002 |
| 5        | UNE-TASK-006 | POST       | /api/v1/tasks/{taskId}/progress    | 진행보고  | TASK_ASSIGNEE | TASK-422-006 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                 |
|----------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-TASK-001)                                                                    | 현장 임무 수신·착수·진행 화면 진입 또는 주요 Action 수행                                                 |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                            |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                           |
| 4        | BFF -\> Domain Service                                                                            | 임무 목록 Use Case 실행 (UNE-TASK-001)                                                                   |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                         |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[task, task_assignment, task_event, task_attachment\] / 쓰기 \[task, task_event, execution_event\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출        |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                      |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                  |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                      |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                              |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-TASK-001-01 정상: US-SIT-020의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-TASK-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-TASK-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-TASK-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-TASK-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.37 SCR-TASK-002 현장보고·사진·피해/통제 Fact

| **항목**      | **상세**                                                             |
|---------------|----------------------------------------------------------------------|
| 모듈          | 현장 임무                                                            |
| Route         | /task/:token/report                                                  |
| 연계 Scenario | US-SIT-022, US-SIT-029                                               |
| 호출 API      | UNE-TASK-001, UNE-TASK-002, UNE-TASK-004, UNE-TASK-005, UNE-TASK-006 |
| DB Read       | task, task_assignment, task_event, task_attachment                   |
| DB Write      | task, task_event, execution_event                                    |
| 상위 ADR      | ADR-07, ADR-10, ADR-17                                               |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                       | **목적**  | **권한**      | **오류**     |
|----------|--------------|------------|------------------------------------|-----------|---------------|--------------|
| 1        | UNE-TASK-001 | GET        | /api/v1/tasks                      | 임무 목록 | TASK_READ     | TASK-7001    |
| 2        | UNE-TASK-002 | GET        | /api/v1/tasks/{taskId}             | 임무 상세 | TASK_READ     | TASK-404-001 |
| 3        | UNE-TASK-004 | POST       | /api/v1/tasks/{taskId}/acknowledge | 수신확인  | TASK_ASSIGNEE | TASK-409-001 |
| 4        | UNE-TASK-005 | POST       | /api/v1/tasks/{taskId}/start       | 임무 착수 | TASK_ASSIGNEE | TASK-409-002 |
| 5        | UNE-TASK-006 | POST       | /api/v1/tasks/{taskId}/progress    | 진행보고  | TASK_ASSIGNEE | TASK-422-006 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                 |
|----------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-TASK-002)                                                                    | 현장보고·사진·피해/통제 Fact 화면 진입 또는 주요 Action 수행                                             |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                            |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                           |
| 4        | BFF -\> Domain Service                                                                            | 임무 목록 Use Case 실행 (UNE-TASK-001)                                                                   |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                         |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[task, task_assignment, task_event, task_attachment\] / 쓰기 \[task, task_event, execution_event\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출        |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                      |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                  |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                      |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                              |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-TASK-002-01 정상: US-SIT-022의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-TASK-002-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-TASK-002-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-TASK-002-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-TASK-002-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.38 SCR-TASK-003 임무 완료·불가·반려·재배정

| **항목**      | **상세**                                          |
|---------------|---------------------------------------------------|
| 모듈          | 현장 임무                                         |
| Route         | /task/:token/complete                             |
| 연계 Scenario | US-SIT-023                                        |
| 호출 API      | UNE-TASK-007, UNE-TASK-008, UNE-TASK-009          |
| DB Read       | \-                                                |
| DB Write      | task, task_event, execution_event, outbox_message |
| 상위 ADR      | ADR-07, ADR-10, ADR-17                            |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                              | **목적**  | **권한**       | **오류**     |
|----------|--------------|------------|-------------------------------------------|-----------|----------------|--------------|
| 1        | UNE-TASK-007 | POST       | /api/v1/tasks/{taskId}/complete           | 완료보고  | TASK_ASSIGNEE  | TASK-422-008 |
| 2        | UNE-TASK-008 | POST       | /api/v1/tasks/{taskId}/approve-completion | 완료 승인 | TASK_SUPERVISE | TASK-409-004 |
| 3        | UNE-TASK-009 | POST       | /api/v1/tasks/{taskId}/reject-completion  | 완료 반려 | TASK_SUPERVISE | TASK-409-005 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-TASK-003)                                                                    | 임무 완료·불가·반려·재배정 화면 진입 또는 주요 Action 수행                                        |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 완료보고 Use Case 실행 (UNE-TASK-007)                                                             |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[관련 Aggregate\] / 쓰기 \[task, task_event, execution_event, outbox_message\]              |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-TASK-003-01 정상: US-SIT-023의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-TASK-003-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-TASK-003-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-TASK-003-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-TASK-003-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.39 SCR-BOARD-001 전자상황판 통합 모니터링

| **항목**      | **상세**                                                                                                                        |
|---------------|---------------------------------------------------------------------------------------------------------------------------------|
| 모듈          | 전자상황판                                                                                                                      |
| Route         | /app/incidents/:id/board                                                                                                        |
| 연계 Scenario | US-SIT-021, US-SIT-028                                                                                                          |
| 호출 API      | UNE-JNL-001, UNE-JNL-002, UNE-JNL-003, UNE-SOP-012, UNE-SOP-013, UNE-TASK-001, UNE-TASK-013                                     |
| DB Read       | situation_snapshot, task, execution_event, task_event, dispatch, sop_run, task_assignment, dispatch_recipient, channel_delivery |
| DB Write      | \-                                                                                                                              |
| 상위 ADR      | ADR-01~18 공통                                                                                                                  |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                             | **목적**            | **권한**       | **오류**     |
|----------|--------------|------------|------------------------------------------|---------------------|----------------|--------------|
| 1        | UNE-JNL-001  | GET        | /api/v1/situations/{id}/dashboard        | 전자상황판 집계     | DASHBOARD_READ | DASH-8001    |
| 2        | UNE-JNL-002  | GET        | /api/v1/situations/{id}/execution-events | Execution Log 조회  | EXECUTION_READ | EXEC-8002    |
| 3        | UNE-JNL-003  | GET        | /api/v1/execution-events/{eventId}       | 원본 Event 상세     | EXECUTION_READ | EXEC-404-001 |
| 4        | UNE-SOP-012  | GET        | /api/v1/sop-runs/{runId}                 | 실행 상세           | SOP_READ       | SOP-404-002  |
| 5        | UNE-SOP-013  | GET        | /api/v1/sop-runs/{runId}/events          | 실행 SSE            | SOP_READ       | SOP-503-001  |
| 6        | UNE-TASK-001 | GET        | /api/v1/tasks                            | 임무 목록           | TASK_READ      | TASK-7001    |
| 7        | UNE-TASK-013 | GET        | /api/v1/dispatches/{id}                  | 전파·수신 상태 조회 | TASK_READ      | DISP-404-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                               |
|----------|---------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-BOARD-001)                                                                   | 전자상황판 통합 모니터링 화면 진입 또는 주요 Action 수행                                               |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                          |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                         |
| 4        | BFF -\> Domain Service                                                                            | 전자상황판 집계 Use Case 실행 (UNE-JNL-001)                                                            |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                       |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[situation_snapshot, task, execution_event, task_event, dispatch, sop_run\] / 쓰기 \[해당 없음\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출      |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                    |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                    |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지              |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                            |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-BOARD-001-01 정상: US-SIT-021의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-BOARD-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-BOARD-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-BOARD-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-BOARD-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.40 SCR-BOARD-002 SLA·미수신·Escalation

| **항목**      | **상세**                                                                                                                        |
|---------------|---------------------------------------------------------------------------------------------------------------------------------|
| 모듈          | 전자상황판                                                                                                                      |
| Route         | /app/incidents/:id/board/escalations                                                                                            |
| 연계 Scenario | US-SIT-025                                                                                                                      |
| 호출 API      | UNE-JNL-001, UNE-JNL-002, UNE-JNL-003, UNE-SOP-012, UNE-SOP-013, UNE-TASK-001, UNE-TASK-013                                     |
| DB Read       | situation_snapshot, task, execution_event, task_event, dispatch, sop_run, task_assignment, dispatch_recipient, channel_delivery |
| DB Write      | \-                                                                                                                              |
| 상위 ADR      | ADR-01~18 공통                                                                                                                  |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                             | **목적**            | **권한**       | **오류**     |
|----------|--------------|------------|------------------------------------------|---------------------|----------------|--------------|
| 1        | UNE-JNL-001  | GET        | /api/v1/situations/{id}/dashboard        | 전자상황판 집계     | DASHBOARD_READ | DASH-8001    |
| 2        | UNE-JNL-002  | GET        | /api/v1/situations/{id}/execution-events | Execution Log 조회  | EXECUTION_READ | EXEC-8002    |
| 3        | UNE-JNL-003  | GET        | /api/v1/execution-events/{eventId}       | 원본 Event 상세     | EXECUTION_READ | EXEC-404-001 |
| 4        | UNE-SOP-012  | GET        | /api/v1/sop-runs/{runId}                 | 실행 상세           | SOP_READ       | SOP-404-002  |
| 5        | UNE-SOP-013  | GET        | /api/v1/sop-runs/{runId}/events          | 실행 SSE            | SOP_READ       | SOP-503-001  |
| 6        | UNE-TASK-001 | GET        | /api/v1/tasks                            | 임무 목록           | TASK_READ      | TASK-7001    |
| 7        | UNE-TASK-013 | GET        | /api/v1/dispatches/{id}                  | 전파·수신 상태 조회 | TASK_READ      | DISP-404-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                               |
|----------|---------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-BOARD-002)                                                                   | SLA·미수신·Escalation 화면 진입 또는 주요 Action 수행                                                  |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                          |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                         |
| 4        | BFF -\> Domain Service                                                                            | 전자상황판 집계 Use Case 실행 (UNE-JNL-001)                                                            |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                       |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[situation_snapshot, task, execution_event, task_event, dispatch, sop_run\] / 쓰기 \[해당 없음\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출      |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                    |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                    |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지              |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                            |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-BOARD-002-01 정상: US-SIT-025의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-BOARD-002-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-BOARD-002-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-BOARD-002-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-BOARD-002-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.41 SCR-BOARD-003 복수 사건·복수 SOP 통합상황판

| **항목**      | **상세**                                                                                                                        |
|---------------|---------------------------------------------------------------------------------------------------------------------------------|
| 모듈          | 전자상황판                                                                                                                      |
| Route         | /app/boards/multi                                                                                                               |
| 연계 Scenario | US-SIT-026                                                                                                                      |
| 호출 API      | UNE-JNL-001, UNE-JNL-002, UNE-JNL-003, UNE-SOP-012, UNE-SOP-013, UNE-TASK-001, UNE-TASK-013                                     |
| DB Read       | situation_snapshot, task, execution_event, task_event, dispatch, sop_run, task_assignment, dispatch_recipient, channel_delivery |
| DB Write      | \-                                                                                                                              |
| 상위 ADR      | ADR-01~18 공통                                                                                                                  |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                             | **목적**            | **권한**       | **오류**     |
|----------|--------------|------------|------------------------------------------|---------------------|----------------|--------------|
| 1        | UNE-JNL-001  | GET        | /api/v1/situations/{id}/dashboard        | 전자상황판 집계     | DASHBOARD_READ | DASH-8001    |
| 2        | UNE-JNL-002  | GET        | /api/v1/situations/{id}/execution-events | Execution Log 조회  | EXECUTION_READ | EXEC-8002    |
| 3        | UNE-JNL-003  | GET        | /api/v1/execution-events/{eventId}       | 원본 Event 상세     | EXECUTION_READ | EXEC-404-001 |
| 4        | UNE-SOP-012  | GET        | /api/v1/sop-runs/{runId}                 | 실행 상세           | SOP_READ       | SOP-404-002  |
| 5        | UNE-SOP-013  | GET        | /api/v1/sop-runs/{runId}/events          | 실행 SSE            | SOP_READ       | SOP-503-001  |
| 6        | UNE-TASK-001 | GET        | /api/v1/tasks                            | 임무 목록           | TASK_READ      | TASK-7001    |
| 7        | UNE-TASK-013 | GET        | /api/v1/dispatches/{id}                  | 전파·수신 상태 조회 | TASK_READ      | DISP-404-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                               |
|----------|---------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-BOARD-003)                                                                   | 복수 사건·복수 SOP 통합상황판 화면 진입 또는 주요 Action 수행                                          |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                          |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                         |
| 4        | BFF -\> Domain Service                                                                            | 전자상황판 집계 Use Case 실행 (UNE-JNL-001)                                                            |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                       |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[situation_snapshot, task, execution_event, task_event, dispatch, sop_run\] / 쓰기 \[해당 없음\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출      |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                    |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                    |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지              |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                            |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-BOARD-003-01 정상: US-SIT-026의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-BOARD-003-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-BOARD-003-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-BOARD-003-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-BOARD-003-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.42 SCR-BOARD-004 수동 Event 추가·정정

| **항목**      | **상세**                                                                                                                        |
|---------------|---------------------------------------------------------------------------------------------------------------------------------|
| 모듈          | 전자상황판                                                                                                                      |
| Route         | /app/incidents/:id/events/manual                                                                                                |
| 연계 Scenario | US-SIT-029                                                                                                                      |
| 호출 API      | UNE-JNL-001, UNE-JNL-002, UNE-JNL-003, UNE-SOP-012, UNE-SOP-013, UNE-TASK-001, UNE-TASK-013                                     |
| DB Read       | situation_snapshot, task, execution_event, task_event, dispatch, sop_run, task_assignment, dispatch_recipient, channel_delivery |
| DB Write      | \-                                                                                                                              |
| 상위 ADR      | ADR-01~18 공통                                                                                                                  |

### A. API 호출 명세

| **순번** | **API ID**   | **Method** | **Endpoint**                             | **목적**            | **권한**       | **오류**     |
|----------|--------------|------------|------------------------------------------|---------------------|----------------|--------------|
| 1        | UNE-JNL-001  | GET        | /api/v1/situations/{id}/dashboard        | 전자상황판 집계     | DASHBOARD_READ | DASH-8001    |
| 2        | UNE-JNL-002  | GET        | /api/v1/situations/{id}/execution-events | Execution Log 조회  | EXECUTION_READ | EXEC-8002    |
| 3        | UNE-JNL-003  | GET        | /api/v1/execution-events/{eventId}       | 원본 Event 상세     | EXECUTION_READ | EXEC-404-001 |
| 4        | UNE-SOP-012  | GET        | /api/v1/sop-runs/{runId}                 | 실행 상세           | SOP_READ       | SOP-404-002  |
| 5        | UNE-SOP-013  | GET        | /api/v1/sop-runs/{runId}/events          | 실행 SSE            | SOP_READ       | SOP-503-001  |
| 6        | UNE-TASK-001 | GET        | /api/v1/tasks                            | 임무 목록           | TASK_READ      | TASK-7001    |
| 7        | UNE-TASK-013 | GET        | /api/v1/dispatches/{id}                  | 전파·수신 상태 조회 | TASK_READ      | DISP-404-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                               |
|----------|---------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-BOARD-004)                                                                   | 수동 Event 추가·정정 화면 진입 또는 주요 Action 수행                                                   |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                          |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                         |
| 4        | BFF -\> Domain Service                                                                            | 전자상황판 집계 Use Case 실행 (UNE-JNL-001)                                                            |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                       |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[situation_snapshot, task, execution_event, task_event, dispatch, sop_run\] / 쓰기 \[해당 없음\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출      |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                    |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                    |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지              |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                            |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-BOARD-004-01 정상: US-SIT-029의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-BOARD-004-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-BOARD-004-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-BOARD-004-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-BOARD-004-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.43 SCR-JRN-001 상황일지 범위·양식 설정

| **항목**      | **상세**                                   |
|---------------|--------------------------------------------|
| 모듈          | 상황일지                                   |
| Route         | /app/incidents/:id/journals/new            |
| 연계 Scenario | US-SIT-030                                 |
| 호출 API      | UNE-JNL-002, UNE-JNL-005                   |
| DB Read       | execution_event                            |
| DB Write      | journal, journal_revision, journal_section |
| 상위 ADR      | ADR-08, ADR-10, ADR-12, ADR-16             |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                | **목적**                 | **권한**       | **오류**        |
|----------|-------------|------------|---------------------------------------------|--------------------------|----------------|-----------------|
| 1        | UNE-JNL-002 | GET        | /api/v1/situations/{id}/execution-events    | Execution Log 조회       | EXECUTION_READ | EXEC-8002       |
| 2        | UNE-JNL-005 | POST       | /api/v1/situations/{id}/journal-projections | 상황일지 Projection 생성 | JOURNAL_CREATE | JOURNAL-412-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-JRN-001)                                                                     | 상황일지 범위·양식 설정 화면 진입 또는 주요 Action 수행                                           |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | Execution Log 조회 Use Case 실행 (UNE-JNL-002)                                                    |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[execution_event\] / 쓰기 \[journal, journal_revision, journal_section\]                    |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-JRN-001-01 정상: US-SIT-030의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-JRN-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-JRN-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-JRN-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-JRN-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.44 SCR-JRN-002 JournalProjection·FactRows

| **항목**      | **상세**                                          |
|---------------|---------------------------------------------------|
| 모듈          | 상황일지                                          |
| Route         | /app/incidents/:id/journals/:journalId/projection |
| 연계 Scenario | US-SIT-031, US-SIT-032                            |
| 호출 API      | UNE-JNL-002, UNE-JNL-005                          |
| DB Read       | execution_event                                   |
| DB Write      | journal, journal_revision, journal_section        |
| 상위 ADR      | ADR-08, ADR-10, ADR-12, ADR-16                    |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                | **목적**                 | **권한**       | **오류**        |
|----------|-------------|------------|---------------------------------------------|--------------------------|----------------|-----------------|
| 1        | UNE-JNL-002 | GET        | /api/v1/situations/{id}/execution-events    | Execution Log 조회       | EXECUTION_READ | EXEC-8002       |
| 2        | UNE-JNL-005 | POST       | /api/v1/situations/{id}/journal-projections | 상황일지 Projection 생성 | JOURNAL_CREATE | JOURNAL-412-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-JRN-002)                                                                     | JournalProjection·FactRows 화면 진입 또는 주요 Action 수행                                        |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | Execution Log 조회 Use Case 실행 (UNE-JNL-002)                                                    |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[execution_event\] / 쓰기 \[journal, journal_revision, journal_section\]                    |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-JRN-002-01 정상: US-SIT-031의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-JRN-002-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-JRN-002-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-JRN-002-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-JRN-002-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.45 SCR-JRN-003 rhwp 상황일지 편집 Workspace

| **항목**      | **상세**                                                                                                               |
|---------------|------------------------------------------------------------------------------------------------------------------------|
| 모듈          | 상황일지                                                                                                               |
| Route         | /app/incidents/:id/journals/:journalId/edit                                                                            |
| 연계 Scenario | US-SIT-032, US-SIT-033                                                                                                 |
| 호출 API      | UNE-JNL-006, UNE-JNL-007, UNE-JNL-008, UNE-DOC-006, UNE-DOC-007, UNE-DOC-009                                           |
| DB Read       | journal, journal_revision, document_revision                                                                           |
| DB Write      | generation_job, ai_edit_proposal, journal_revision, change_set, change_operation, document_revision, document_autosave |
| 상위 ADR      | ADR-08, ADR-10, ADR-12, ADR-16                                                                                         |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                               | **목적**            | **권한**        | **오류**                |
|----------|-------------|------------|--------------------------------------------|---------------------|-----------------|-------------------------|
| 1        | UNE-JNL-006 | GET        | /api/v1/journals/{journalId}               | 상황일지 상세       | JOURNAL_READ    | JOURNAL-404-001         |
| 2        | UNE-JNL-007 | POST       | /api/v1/journals/{journalId}/ai-draft-jobs | 상황일지 서술 제안  | JOURNAL_AI_EDIT | JOURNAL-422-004         |
| 3        | UNE-JNL-008 | POST       | /api/v1/journals/{journalId}/changesets    | 상황일지 편집       | JOURNAL_EDIT    | JOURNAL-409-001         |
| 4        | UNE-DOC-006 | POST       | /api/v1/documents/{documentId}/changesets  | ChangeSet 원자 적용 | DOC_EDIT        | DOC-409-001,DOC-422-004 |
| 5        | UNE-DOC-007 | GET        | /api/v1/documents/{documentId}/revisions   | Revision 목록       | DOC_READ        | DOC-404-002             |
| 6        | UNE-DOC-009 | POST       | /api/v1/documents/{documentId}/autosaves   | 자동저장            | DOC_EDIT        | DOC-409-003             |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                                                                             |
|----------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-JRN-003)                                                                     | rhwp 상황일지 편집 Workspace 화면 진입 또는 주요 Action 수행                                                                                                         |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                                                                        |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                                                                       |
| 4        | BFF -\> Domain Service                                                                            | 상황일지 상세 Use Case 실행 (UNE-JNL-006)                                                                                                                            |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                                                                     |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[journal, journal_revision, document_revision\] / 쓰기 \[generation_job, ai_edit_proposal, journal_revision, change_set, change_operation, document_revision\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                                                                    |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                                                                                  |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                                                                              |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                                                                                  |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                                                                            |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                                                                          |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-JRN-003-01 정상: US-SIT-032의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-JRN-003-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-JRN-003-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-JRN-003-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-JRN-003-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.46 SCR-JRN-004 상황일지 근거·Diff·검토

| **항목**      | **상세**                                      |
|---------------|-----------------------------------------------|
| 모듈          | 상황일지                                      |
| Route         | /app/incidents/:id/journals/:journalId/review |
| 연계 Scenario | US-SIT-033, US-SIT-034                        |
| 호출 API      | UNE-JNL-009, UNE-JNL-010                      |
| DB Read       | \-                                            |
| DB Write      | review_request, journal, approval             |
| 상위 ADR      | ADR-08, ADR-10, ADR-12, ADR-16                |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                               | **목적**          | **권한**        | **오류**        |
|----------|-------------|------------|--------------------------------------------|-------------------|-----------------|-----------------|
| 1        | UNE-JNL-009 | POST       | /api/v1/journals/{journalId}/submit-review | 상황일지 검토요청 | JOURNAL_EDIT    | JOURNAL-412-002 |
| 2        | UNE-JNL-010 | POST       | /api/v1/journals/{journalId}/approve       | 상황일지 승인     | JOURNAL_APPROVE | JOURNAL-412-003 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-JRN-004)                                                                     | 상황일지 근거·Diff·검토 화면 진입 또는 주요 Action 수행                                           |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 상황일지 검토요청 Use Case 실행 (UNE-JNL-009)                                                     |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[관련 Aggregate\] / 쓰기 \[review_request, journal, approval\]                              |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-JRN-004-01 정상: US-SIT-033의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-JRN-004-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-JRN-004-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-JRN-004-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-JRN-004-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.47 SCR-JRN-005 상황일지 HWPX/PDF/DOCX 내보내기

| **항목**      | **상세**                                      |
|---------------|-----------------------------------------------|
| 모듈          | 상황일지                                      |
| Route         | /app/incidents/:id/journals/:journalId/export |
| 연계 Scenario | US-SIT-034                                    |
| 호출 API      | UNE-JNL-011, UNE-DOC-013, UNE-DOC-014         |
| DB Read       | export_job, validation_report, file_object    |
| DB Write      | export_job                                    |
| 상위 ADR      | ADR-08, ADR-10, ADR-12, ADR-16                |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                         | **목적**               | **권한**       | **오류**       |
|----------|-------------|------------|--------------------------------------|------------------------|----------------|----------------|
| 1        | UNE-JNL-011 | POST       | /api/v1/journals/{journalId}/exports | 상황일지 HWPX/PDF/DOCX | JOURNAL_EXPORT | EXPORT-422-002 |
| 2        | UNE-DOC-013 | GET        | /api/v1/exports/{exportId}           | Export 상태·검증결과   | DOC_READ       | EXPORT-404-001 |
| 3        | UNE-DOC-014 | GET        | /api/v1/exports/{exportId}/download  | Export 파일 다운로드   | DOC_READ       | EXPORT-410-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-JRN-005)                                                                     | 상황일지 HWPX/PDF/DOCX 내보내기 화면 진입 또는 주요 Action 수행                                   |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 상황일지 HWPX/PDF/DOCX Use Case 실행 (UNE-JNL-011)                                                |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[export_job, validation_report, file_object\] / 쓰기 \[export_job\]                         |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-JRN-005-01 정상: US-SIT-034의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-JRN-005-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-JRN-005-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-JRN-005-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-JRN-005-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.48 SCR-JRN-006 상황일지 버전·최종본·재생성

| **항목**      | **상세**                                                                     |
|---------------|------------------------------------------------------------------------------|
| 모듈          | 상황일지                                                                     |
| Route         | /app/incidents/:id/journals/:journalId/history                               |
| 연계 Scenario | US-SIT-034, US-SIT-035                                                       |
| 호출 API      | UNE-JNL-005, UNE-JNL-006, UNE-JNL-007                                        |
| DB Read       | journal, journal_revision                                                    |
| DB Write      | journal, journal_revision, journal_section, generation_job, ai_edit_proposal |
| 상위 ADR      | ADR-08, ADR-10, ADR-12, ADR-16                                               |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                                | **목적**                 | **권한**        | **오류**        |
|----------|-------------|------------|---------------------------------------------|--------------------------|-----------------|-----------------|
| 1        | UNE-JNL-005 | POST       | /api/v1/situations/{id}/journal-projections | 상황일지 Projection 생성 | JOURNAL_CREATE  | JOURNAL-412-001 |
| 2        | UNE-JNL-006 | GET        | /api/v1/journals/{journalId}                | 상황일지 상세            | JOURNAL_READ    | JOURNAL-404-001 |
| 3        | UNE-JNL-007 | POST       | /api/v1/journals/{journalId}/ai-draft-jobs  | 상황일지 서술 제안       | JOURNAL_AI_EDIT | JOURNAL-422-004 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                                   |
|----------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-JRN-006)                                                                     | 상황일지 버전·최종본·재생성 화면 진입 또는 주요 Action 수행                                                                |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                              |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                             |
| 4        | BFF -\> Domain Service                                                                            | 상황일지 Projection 생성 Use Case 실행 (UNE-JNL-005)                                                                       |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                           |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[journal, journal_revision\] / 쓰기 \[journal, journal_revision, journal_section, generation_job, ai_edit_proposal\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                          |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                                        |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                                    |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                                        |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                                  |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                                |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-JRN-006-01 정상: US-SIT-034의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-JRN-006-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-JRN-006-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-JRN-006-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-JRN-006-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.49 SCR-EVAL-001 사건·훈련 종료·최종 기준선

| **항목**      | **상세**                            |
|---------------|-------------------------------------|
| 모듈          | 평가                                |
| Route         | /app/incidents/:id/close            |
| 연계 Scenario | US-SIT-035, US-SIT-036              |
| 호출 API      | UNE-JNL-012                         |
| DB Read       | \-                                  |
| DB Write      | situation, sop_run, execution_event |
| 상위 ADR      | ADR-01~18 공통                      |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                  | **목적**       | **권한**        | **오류**    |
|----------|-------------|------------|-------------------------------|----------------|-----------------|-------------|
| 1        | UNE-JNL-012 | POST       | /api/v1/situations/{id}/close | 상황·훈련 종료 | SITUATION_CLOSE | SIT-412-010 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-EVAL-001)                                                                    | 사건·훈련 종료·최종 기준선 화면 진입 또는 주요 Action 수행                                        |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 상황·훈련 종료 Use Case 실행 (UNE-JNL-012)                                                        |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[관련 Aggregate\] / 쓰기 \[situation, sop_run, execution_event\]                            |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-EVAL-001-01 정상: US-SIT-035의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-EVAL-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-EVAL-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-EVAL-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-EVAL-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.50 SCR-EVAL-002 훈련평가 지표·체크포인트

| **항목**      | **상세**                                        |
|---------------|-------------------------------------------------|
| 모듈          | 평가                                            |
| Route         | /app/incidents/:id/evaluation/checkpoints       |
| 연계 Scenario | US-SIT-036, US-SIT-037, US-SIT-038              |
| 호출 API      | UNE-JNL-013, UNE-JNL-015                        |
| DB Read       | evaluation, survey_response, improvement_action |
| DB Write      | evaluation, evaluation_score                    |
| 상위 ADR      | ADR-01~18 공통                                  |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                        | **목적**                   | **권한**        | **오류**     |
|----------|-------------|------------|-------------------------------------|----------------------------|-----------------|--------------|
| 1        | UNE-JNL-013 | POST       | /api/v1/situations/{id}/evaluations | 훈련 평가 생성             | EVALUATION_EDIT | EVAL-422-001 |
| 2        | UNE-JNL-015 | GET        | /api/v1/evaluations/{id}/report     | 만족도·잠재가치·평가보고서 | EVALUATION_READ | EVAL-404-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-EVAL-002)                                                                    | 훈련평가 지표·체크포인트 화면 진입 또는 주요 Action 수행                                          |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 훈련 평가 생성 Use Case 실행 (UNE-JNL-013)                                                        |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[evaluation, survey_response, improvement_action\] / 쓰기 \[evaluation, evaluation_score\]  |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-EVAL-002-01 정상: US-SIT-036의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-EVAL-002-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-EVAL-002-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-EVAL-002-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-EVAL-002-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.51 SCR-EVAL-003 개선조치·SOP/계획서 환류

| **항목**      | **상세**                                        |
|---------------|-------------------------------------------------|
| 모듈          | 평가                                            |
| Route         | /app/incidents/:id/evaluation/actions           |
| 연계 Scenario | US-SIT-036                                      |
| 호출 API      | UNE-JNL-014, UNE-JNL-015                        |
| DB Read       | evaluation, survey_response, improvement_action |
| DB Write      | improvement_action                              |
| 상위 ADR      | ADR-01~18 공통                                  |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                          | **목적**                   | **권한**        | **오류**     |
|----------|-------------|------------|---------------------------------------|----------------------------|-----------------|--------------|
| 1        | UNE-JNL-014 | POST       | /api/v1/evaluations/{id}/improvements | 개선조치 등록              | EVALUATION_EDIT | EVAL-422-002 |
| 2        | UNE-JNL-015 | GET        | /api/v1/evaluations/{id}/report       | 만족도·잠재가치·평가보고서 | EVALUATION_READ | EVAL-404-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-EVAL-003)                                                                    | 개선조치·SOP/계획서 환류 화면 진입 또는 주요 Action 수행                                          |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 개선조치 등록 Use Case 실행 (UNE-JNL-014)                                                         |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[evaluation, survey_response, improvement_action\] / 쓰기 \[improvement_action\]            |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-EVAL-003-01 정상: US-SIT-036의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-EVAL-003-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-EVAL-003-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-EVAL-003-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-EVAL-003-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.52 SCR-EVAL-004 만족도·잠재가치·평가보고서

| **항목**      | **상세**                                        |
|---------------|-------------------------------------------------|
| 모듈          | 평가                                            |
| Route         | /app/incidents/:id/evaluation/report            |
| 연계 Scenario | US-SIT-036, US-SIT-040                          |
| 호출 API      | UNE-JNL-013, UNE-JNL-015                        |
| DB Read       | evaluation, survey_response, improvement_action |
| DB Write      | evaluation, evaluation_score                    |
| 상위 ADR      | ADR-01~18 공통                                  |

### A. API 호출 명세

| **순번** | **API ID**  | **Method** | **Endpoint**                        | **목적**                   | **권한**        | **오류**     |
|----------|-------------|------------|-------------------------------------|----------------------------|-----------------|--------------|
| 1        | UNE-JNL-013 | POST       | /api/v1/situations/{id}/evaluations | 훈련 평가 생성             | EVALUATION_EDIT | EVAL-422-001 |
| 2        | UNE-JNL-015 | GET        | /api/v1/evaluations/{id}/report     | 만족도·잠재가치·평가보고서 | EVALUATION_READ | EVAL-404-001 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-EVAL-004)                                                                    | 만족도·잠재가치·평가보고서 화면 진입 또는 주요 Action 수행                                        |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 훈련 평가 생성 Use Case 실행 (UNE-JNL-013)                                                        |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[evaluation, survey_response, improvement_action\] / 쓰기 \[evaluation, evaluation_score\]  |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-EVAL-004-01 정상: US-SIT-036의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-EVAL-004-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-EVAL-004-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-EVAL-004-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-EVAL-004-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.53 SCR-ADMIN-001 기관·사용자·RBAC 관리

| **항목**      | **상세**                                                               |
|---------------|------------------------------------------------------------------------|
| 모듈          | 관리                                                                   |
| Route         | /app/admin/access                                                      |
| 연계 Scenario | US-PLAN-001, US-SIT-040                                                |
| 호출 API      | UNE-ADMIN-001, UNE-ADMIN-002, UNE-AUTH-005, UNE-AUTH-006, UNE-AUTH-007 |
| DB Read       | tenant, app_user, role, organization, permission, role_permission      |
| DB Write      | user_role, audit_log                                                   |
| 상위 ADR      | ADR-01~18 공통                                                         |

### A. API 호출 명세

| **순번** | **API ID**    | **Method** | **Endpoint**                   | **목적**              | **권한**     | **오류**      |
|----------|---------------|------------|--------------------------------|-----------------------|--------------|---------------|
| 1        | UNE-ADMIN-001 | GET        | /api/v1/admin/access/summary   | 기관·사용자·RBAC 요약 | ADMIN_ACCESS | ADMIN-9001    |
| 2        | UNE-ADMIN-002 | PUT        | /api/v1/admin/users/{id}/roles | 사용자 역할 Binding   | ADMIN_ACCESS | ADMIN-409-001 |
| 3        | UNE-AUTH-005  | GET        | /api/v1/organizations/tree     | 조직도 조회           | ORG_READ     | ORG-2001      |
| 4        | UNE-AUTH-006  | GET        | /api/v1/users                  | 사용자·담당자 검색    | USER_READ    | USER-2101     |
| 5        | UNE-AUTH-007  | GET        | /api/v1/roles                  | 역할·권한 조회        | RBAC_READ    | RBAC-2201     |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                   |
|----------|---------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-ADMIN-001)                                                                   | 기관·사용자·RBAC 관리 화면 진입 또는 주요 Action 수행                                                      |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                              |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                             |
| 4        | BFF -\> Domain Service                                                                            | 기관·사용자·RBAC 요약 Use Case 실행 (UNE-ADMIN-001)                                                        |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                           |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[tenant, app_user, role, organization, permission, role_permission\] / 쓰기 \[user_role, audit_log\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출          |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                        |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                    |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                        |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                  |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-ADMIN-001-01 정상: US-PLAN-001의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-ADMIN-001-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-ADMIN-001-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-ADMIN-001-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-ADMIN-001-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.54 SCR-ADMIN-002 조직·연락처·채널·수신자 Binding

| **항목**      | **상세**                                                 |
|---------------|----------------------------------------------------------|
| 모듈          | 관리                                                     |
| Route         | /app/admin/organization                                  |
| 연계 Scenario | US-SIT-014, US-SIT-018, US-SIT-040                       |
| 호출 API      | UNE-ADMIN-003, UNE-ADMIN-004, UNE-AUTH-005, UNE-AUTH-006 |
| DB Read       | organization, recipient_binding, app_user                |
| DB Write      | recipient_binding                                        |
| 상위 ADR      | ADR-01~18 공통                                           |

### A. API 호출 명세

| **순번** | **API ID**    | **Method** | **Endpoint**                        | **목적**                 | **권한**  | **오류**      |
|----------|---------------|------------|-------------------------------------|--------------------------|-----------|---------------|
| 1        | UNE-ADMIN-003 | GET        | /api/v1/admin/organization-bindings | 조직·수신자 Binding 조회 | ADMIN_ORG | ADMIN-9002    |
| 2        | UNE-ADMIN-004 | POST       | /api/v1/admin/organization-bindings | 조직·채널 Binding 생성   | ADMIN_ORG | ADMIN-422-001 |
| 3        | UNE-AUTH-005  | GET        | /api/v1/organizations/tree          | 조직도 조회              | ORG_READ  | ORG-2001      |
| 4        | UNE-AUTH-006  | GET        | /api/v1/users                       | 사용자·담당자 검색       | USER_READ | USER-2101     |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-ADMIN-002)                                                                   | 조직·연락처·채널·수신자 Binding 화면 진입 또는 주요 Action 수행                                   |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | 조직·수신자 Binding 조회 Use Case 실행 (UNE-ADMIN-003)                                            |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[organization, recipient_binding, app_user\] / 쓰기 \[recipient_binding\]                   |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-ADMIN-002-01 정상: US-SIT-014의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-ADMIN-002-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-ADMIN-002-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-ADMIN-002-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-ADMIN-002-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.55 SCR-ADMIN-003 감사·보존·개인정보·보안 설정

| **항목**      | **상세**                                                                  |
|---------------|---------------------------------------------------------------------------|
| 모듈          | 관리                                                                      |
| Route         | /app/admin/audit-security                                                 |
| 연계 Scenario | US-SIT-040, US-PLAN-030                                                   |
| 호출 API      | UNE-ADMIN-005, UNE-ADMIN-006, UNE-ADMIN-007, UNE-ADMIN-011, UNE-ADMIN-012 |
| DB Read       | audit_log, outbox_message, outbox_attempt, retention_policy               |
| DB Write      | outbox_message, outbox_attempt, retention_policy, audit_log               |
| 상위 ADR      | ADR-01~18 공통                                                            |

### A. API 호출 명세

| **순번** | **API ID**    | **Method** | **Endpoint**                          | **목적**           | **권한**       | **오류**       |
|----------|---------------|------------|---------------------------------------|--------------------|----------------|----------------|
| 1        | UNE-ADMIN-005 | GET        | /api/v1/admin/audit-logs              | 감사로그 검색      | AUDIT_READ     | AUDIT-9001     |
| 2        | UNE-ADMIN-006 | GET        | /api/v1/admin/outbox                  | Outbox 운영조회    | ADMIN_OUTBOX   | OUTBOX-9001    |
| 3        | UNE-ADMIN-007 | POST       | /api/v1/admin/outbox/{id}/retry       | Outbox 수동 재처리 | ADMIN_OUTBOX   | OUTBOX-409-001 |
| 4        | UNE-ADMIN-011 | GET        | /api/v1/admin/retention-policies      | 보존정책 조회      | ADMIN_SECURITY | RET-9001       |
| 5        | UNE-ADMIN-012 | PATCH      | /api/v1/admin/retention-policies/{id} | 보존정책 변경      | ADMIN_SECURITY | RET-409-001    |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                                                                    |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-ADMIN-003)                                                                   | 감사·보존·개인정보·보안 설정 화면 진입 또는 주요 Action 수행                                                                                |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                                                               |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                                                              |
| 4        | BFF -\> Domain Service                                                                            | 감사로그 검색 Use Case 실행 (UNE-ADMIN-005)                                                                                                 |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                                                            |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[audit_log, outbox_message, outbox_attempt, retention_policy\] / 쓰기 \[outbox_message, outbox_attempt, retention_policy, audit_log\] |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출                                           |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                                                                         |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                                                                     |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                                                                         |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지                                                   |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                                                                 |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-ADMIN-003-01 정상: US-SIT-040의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-ADMIN-003-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-ADMIN-003-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-ADMIN-003-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-ADMIN-003-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

## 7.56 SCR-ADMIN-004 Provider·UNI·T3Q·실증 Binding 운영설정

| **항목**      | **상세**                                        |
|---------------|-------------------------------------------------|
| 모듈          | 관리                                            |
| Route         | /app/admin/integrations                         |
| 연계 Scenario | US-PLAN-024, US-SIT-004, US-SIT-039, US-SIT-040 |
| 호출 API      | UNE-ADMIN-008, UNE-ADMIN-009, UNE-ADMIN-010     |
| DB Read       | provider_config                                 |
| DB Write      | provider_config, audit_log, provider_health     |
| 상위 ADR      | ADR-01~18 공통                                  |

### A. API 호출 명세

| **순번** | **API ID**    | **Method** | **Endpoint**                             | **목적**                  | **권한**          | **오류**     |
|----------|---------------|------------|------------------------------------------|---------------------------|-------------------|--------------|
| 1        | UNE-ADMIN-008 | GET        | /api/v1/admin/provider-configs           | Provider·T3Q·UNI 설정조회 | ADMIN_INTEGRATION | PROV-9001    |
| 2        | UNE-ADMIN-009 | PATCH      | /api/v1/admin/provider-configs/{id}      | Provider 설정변경         | ADMIN_INTEGRATION | PROV-409-001 |
| 3        | UNE-ADMIN-010 | POST       | /api/v1/admin/provider-configs/{id}/test | Provider 연결시험         | ADMIN_INTEGRATION | PROV-503-010 |

### B. 정상 Sequence

| **순번** | **Actor/Component**                                                                               | **처리**                                                                                          |
|----------|---------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 1        | 사용자 -\> React(SCR-ADMIN-004)                                                                   | Provider·UNI·T3Q·실증 Binding 운영설정 화면 진입 또는 주요 Action 수행                            |
| 2        | React -\> UNE API Gateway/BFF                                                                     | JWT, X-Correlation-Id, 화면 Context ID와 ETag를 포함하여 요청                                     |
| 3        | Gateway -\> Identity/RBAC                                                                         | 기관, 역할, 객체 범위, 상태별 Action 권한 확인                                                    |
| 4        | BFF -\> Domain Service                                                                            | Provider·T3Q·UNI 설정조회 Use Case 실행 (UNE-ADMIN-008)                                           |
| 5        | Domain Service -\> Validator                                                                      | JSON Schema, 업무규칙, 선행 Snapshot/승인/상태, Idempotency 검증                                  |
| 6        | Domain Service -\> PostgreSQL                                                                     | 조회 \[provider_config\] / 쓰기 \[provider_config, audit_log, provider_health\]                   |
| 7        | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 | 외부 호출이 필요한 경우 DB에 Job/Outbox를 Commit하고 Worker가 T3Q/UNI/Provider/ChannelPort를 호출 |
| 8        | Provider Adapter -\> Domain Service                                                               | 원본 응답을 UNE Canonical Contract로 변환하고 Schema·근거·출처 검증                               |
| 9        | Domain Service -\> PostgreSQL                                                                     | Aggregate 상태, Revision/Event/Audit/Outbox를 동일 트랜잭션 경계에 기록                           |
| 10       | Domain Service -\> BFF                                                                            | Resource DTO, ETag/versionNo, validationSummary, correlationId 반환                               |
| 11       | BFF -\> React                                                                                     | 화면상태 LOADING/PROCESSING/PARTIAL/COMPLETED/FAILED를 동기화하고 이미 완료된 결과를 유지         |
| 12       | React -\> 사용자                                                                                  | 성공 결과, 부분실패, 복구 Action, 감사 추적번호를 화면설계 규칙에 따라 표시                       |

### C. 대체·예외 Sequence

| **ID** | **조건**              | **처리**                                                                                 |
|--------|-----------------------|------------------------------------------------------------------------------------------|
| ALT-01 | 권한 없음             | 업무 API 실행 전 403 반환, 메뉴/Action 숨김 또는 조회전용 전환, ACCESS_DENIED 감사 Event |
| ALT-02 | ETag/Version 충돌     | 409 반환, 최신 Revision/상태와 사용자 변경 Diff 제시, 자동 덮어쓰기 금지                 |
| ALT-03 | Provider 일부 장애    | 성공 결과는 PARTIAL로 저장·표시, 실패 Provider만 Retry, 기존 편집/수동입력 유지          |
| ALT-04 | Timeout/네트워크 단절 | Correlation ID로 Job/Outbox 상태 재조회, Idempotency-Key로 중복 생성·전파 방지           |
| ALT-05 | Schema·업무규칙 오류  | 422 violations와 화면 Field/Node/Block Anchor를 반환하여 사용자 수정 유도                |
| ALT-06 | 사용자 취소/화면 이동 | 취소 가능한 Job만 CANCEL_REQUESTED, 완료 결과와 Draft/Autosave 보존                      |

### D. 트랜잭션·감사·인수시험

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>상세</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>트랜잭션</td>
<td>읽기 전용 화면은 Repeatable Read를 요구하지 않으며 조회시점 at을 응답에 포함한다. 상태변경 화면은 Aggregate 변경, Domain/Execution Event, Audit Log, Outbox를 같은 트랜잭션으로 처리하고 외부 발송은 Commit 이후 수행한다.</td>
</tr>
<tr class="even">
<td>멱등성</td>
<td>POST 상태변경·생성·전파는 Idempotency-Key를 사용하며 동일 Key/동일 Payload는 기존 결과를 반환하고 다른 Payload는 409 처리</td>
</tr>
<tr class="odd">
<td>개인정보</td>
<td>목록·로그·알림에서는 전화·이메일·위치 등 최소표시 및 마스킹, 다운로드/원문열람은 감사</td>
</tr>
<tr class="even">
<td>인수시험</td>
<td>• E2E-SCR-ADMIN-004-01 정상: US-PLAN-024의 정상 흐름과 화면 상태전이를 재현한다.<br />
• E2E-SCR-ADMIN-004-02 권한: 권한 없는 사용자는 업무 데이터 요청 전 차단된다.<br />
• E2E-SCR-ADMIN-004-03 충돌: ETag 또는 versionNo 불일치 시 409와 복구 Diff가 제공된다.<br />
• E2E-SCR-ADMIN-004-04 장애: Provider/네트워크 실패 시 입력과 완료 결과가 손실되지 않는다.<br />
• E2E-SCR-ADMIN-004-05 감사: 주요 Action의 actor, object, before/after, correlationId가 감사로그로 추적된다.</td>
</tr>
</tbody>
</table>

# 8. 상태·권한·오류·트랜잭션·보안

## 8.1 객체 상태전이

| **객체**          | **상태전이**                                                                                                              | **주요 Guard**             |
|-------------------|---------------------------------------------------------------------------------------------------------------------------|----------------------------|
| Plan              | DRAFT → CONTEXT_READY → OUTLINE_GENERATING → OUTLINE_REVIEW → CONTENT_GENERATING → EDITING → REVIEW → APPROVED → ARCHIVED | APPROVED 수정은 새 개정    |
| Template Profile  | UPLOADED → ANALYZING → CONFIRM_REQUIRED → CONFIRMED → SUPERSEDED                                                          | 분석경고 확인 후 확정      |
| Situation         | DRAFT → REGISTERED → CONTEXT_CONFIRMED → SOP_READY → RUNNING → PAUSED → COMPLETED/CANCELLED → CLOSED                      | CLOSED 이후 사실 수정 금지 |
| SituationSnapshot | DRAFT → CONFIRMED → SUPERSEDED → FINAL                                                                                    | 불변, 새 버전만            |
| KnowledgeDocument | UPLOADING → QUEUED → PROCESSING → READY/PARTIAL/FAILED                                                                    | 원본 파일 유지             |
| SOP Definition    | DRAFT → VALIDATING → INVALID/VALID → REVIEW → APPROVED → RETIRED                                                          | 승인버전 불변              |
| SOP Run           | READY → RUNNING ↔ PAUSED → COMPLETED/TERMINATED                                                                           | 승인버전+Snapshot          |
| Task              | CREATED → SENT → DELIVERED → ACKNOWLEDGED → IN_PROGRESS → COMPLETION_REPORTED → COMPLETED/REJECTED/REASSIGNED             | 증빙·담당권한              |
| Journal           | CONFIGURING → PROJECTING → DRAFT → REVIEW → APPROVED → EXPORTED                                                           | Snapshot+기간+Event 고정   |
| Improvement       | OPEN → IN_PROGRESS → VERIFYING → CLOSED                                                                                   | 근거·책임자·기한           |

## 8.2 역할·권한 Matrix

| **행위**                | **PLAN_AUTHOR** | **PLAN_REVIEWER** | **PLAN_APPROVER** | **SITUATION_MANAGER** | **SOP_DESIGNER** | **COMMANDER** | **TASK_ASSIGNEE** | **SYSTEM_ADMIN** | **AUDITOR** |
|-------------------------|-----------------|-------------------|-------------------|-----------------------|------------------|---------------|-------------------|------------------|-------------|
| 계획서 생성·편집        | O               | R                 | R                 | \-                    | \-               | \-            | \-                | R                | R           |
| 계획서 승인             | \-              | C                 | O                 | \-                    | \-               | \-            | \-                | \-               | R           |
| Fact 편집·Snapshot 확정 | \-              | \-                | \-                | O                     | C                | A             | \-                | R                | R           |
| SOP 편집·검증           | \-              | \-                | \-                | C                     | O                | A             | R                 | R                | R           |
| SOP 실행·중지           | \-              | \-                | \-                | C                     | R                | O             | R                 | R                | R           |
| 임무 수신·진행·완료     | \-              | \-                | \-                | A                     | R                | A             | O                 | R                | R           |
| Execution Event 정정    | \-              | \-                | \-                | O                     | C                | A             | C                 | R                | R           |
| Provider·RBAC·보존      | \-              | \-                | \-                | \-                    | \-               | \-            | \-                | O                | R           |

O=주 수행, A=승인·관리, C=검토·협조, R=조회, -=불가

## 8.3 오류코드 Catalog

| **코드**        | **메시지**                 | **복구**              |
|-----------------|----------------------------|-----------------------|
| AUTH-1001       | SSO 토큰 누락              | T3Q 로그인으로 재이동 |
| AUTH-1002       | 토큰 만료                  | returnUrl 보존 재인증 |
| AUTH-1003       | 기관 Binding 없음          | 관리자 문의           |
| AUTH-1004       | 권한 없음                  | 403·감사              |
| PLAN-412-001    | PlanContextSnapshot 미확정 | 기준정보 확정         |
| T3Q-502-001     | T3Q 목차 Provider 오류     | 자동/수동 재시도      |
| T3Q-502-002     | T3Q 본문 Provider 오류     | 실패 Block만 재시도   |
| DOC-409-001     | Document Revision 충돌     | 최신본 Diff·병합      |
| DOC-422-004     | 보호영역 침범              | 선택영역 수정         |
| HWPX-422-001    | HWPX 패키지 오류           | 원본/검증보고서       |
| EXPORT-422-001  | Export 검증 실패           | Track A 보고서        |
| SIT-412-003     | 미해결 Fact 충돌           | 충돌 확정             |
| SIT-422-006     | 출처 없는 Fact             | 출처 등록             |
| PROV-503-001    | 상황 Provider 장애         | 부분결과/수동         |
| UNI-422-003     | UNI SOP Schema 불일치      | Mapper 보정/재생성    |
| SOP-422-007     | SOP 그래프 오류            | 고립·순환·분기 수정   |
| SOP-409-005     | 중복 실행                  | 기존 Run 열기         |
| TASK-422-008    | 완료 증빙 누락             | 사진/체크리스트       |
| OUTBOX-503-001  | 채널 발송 실패             | Retry/대체채널        |
| JOURNAL-422-004 | AI 서술과 원장 사실 불일치 | 제안 폐기·원장 유지   |

## 8.4 보안 통제

- API Gateway가 플랫폼 단일 진입점이며 인증·접근통제보다 하위 데이터 수집 계층에 배치하지 않는다.

- JWT 서명·만료·aud/iss 검증, Refresh Token hash 저장, 세션 폐기목록 적용.

- Tenant 격리, 객체단위 권한, 조회전용 상태, 승인·전파·정정에 추가 권한 적용.

- 파일은 확장자뿐 아니라 MIME/매직바이트/악성코드 검사, HWPX ZIP Bomb 방지, 압축해제 한도 적용.

- Provider Credential은 Vault/KMS에 저장하고 DB와 로그에는 참조키만 보존.

- PII는 컬럼 암호화, 응답 마스킹, Export/원문열람 감사, 보존기간 종료 시 파기 또는 비식별화.

- Audit/Execution Event hash와 정정 연결을 이용해 위변조 검증.

# 9. 요구사항-화면-API-DB-Sequence-시험 추적

| **Scenario**                                                    | **화면**          | **API**                                                                                          | **DB**                                                                                                                          | **Sequence**          | **시험**                    |
|-----------------------------------------------------------------|-------------------|--------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|-----------------------|-----------------------------|
| US-PLAN-001, US-SIT-001                                         | SCR-AUTH-001      | UNE-AUTH-001, UNE-AUTH-002, UNE-AUTH-003                                                         | app_user, user_session, audit_log, user_role, organization                                                                      | SEQ-SCR-AUTH-001      | E2E-SCR-AUTH-001-01~05      |
| US-PLAN-001, US-SIT-001, US-SIT-002                             | SCR-HOME-001      | UNE-HOME-001, UNE-TASK-001, UNE-AUTH-002                                                         | document, situation, task, provider_health, task_assignment, app_user, user_role, organization                                  | SEQ-SCR-HOME-001      | E2E-SCR-HOME-001-01~05      |
| US-PLAN-024, US-SIT-019, US-SIT-025                             | SCR-NOTIFY-001    | UNE-HOME-002, UNE-HOME-003, UNE-HOME-004                                                         | notification                                                                                                                    | SEQ-SCR-NOTIFY-001    | E2E-SCR-NOTIFY-001-01~05    |
| US-PLAN-001, US-PLAN-002, US-PLAN-023                           | SCR-PLAN-001      | UNE-PLAN-002, UNE-PLAN-003, UNE-PLAN-005                                                         | plan, document                                                                                                                  | SEQ-SCR-PLAN-001      | E2E-SCR-PLAN-001-01~05      |
| US-PLAN-002, US-PLAN-003                                        | SCR-PLAN-002      | UNE-PLAN-001, UNE-DOC-001, UNE-DOC-002, UNE-DOC-003                                              | plan, document, file_object, malware_scan, document_revision, template_profile                                                  | SEQ-SCR-PLAN-002      | E2E-SCR-PLAN-002-01~05      |
| US-PLAN-003, US-PLAN-004                                        | SCR-PLAN-003      | UNE-DOC-001, UNE-DOC-002, UNE-DOC-003                                                            | file_object, malware_scan, document, document_revision, template_profile                                                        | SEQ-SCR-PLAN-003      | E2E-SCR-PLAN-003-01~05      |
| US-PLAN-005, US-PLAN-006, US-PLAN-025                           | SCR-PLAN-004      | UNE-DOC-004, UNE-DOC-005                                                                         | template_profile, prototype_registry, document_revision                                                                         | SEQ-SCR-PLAN-004      | E2E-SCR-PLAN-004-01~05      |
| US-PLAN-007, US-PLAN-008, US-PLAN-009                           | SCR-PLAN-005      | UNE-PLAN-006, UNE-PLAN-007, UNE-PLAN-008                                                         | plan_context_draft, plan_context_snapshot, audit_log                                                                            | SEQ-SCR-PLAN-005      | E2E-SCR-PLAN-005-01~05      |
| US-PLAN-009, US-PLAN-010, US-PLAN-011                           | SCR-PLAN-006      | UNE-PLAN-009, UNE-PLAN-010, UNE-PLAN-011, UNE-PLAN-012, UNE-PLAN-013, UNE-PLAN-014, UNE-PLAN-015 | generation_job, job_event, toc_version, toc_node                                                                                | SEQ-SCR-PLAN-006      | E2E-SCR-PLAN-006-01~05      |
| US-PLAN-012, US-PLAN-013, US-PLAN-014, US-PLAN-015, US-PLAN-020 | SCR-PLAN-007      | UNE-DOC-005, UNE-DOC-006, UNE-DOC-007, UNE-DOC-008, UNE-DOC-009, UNE-DOC-010, UNE-DOC-011        | document_revision, change_set, change_operation, document_autosave, generation_job, ai_edit_proposal                            | SEQ-SCR-PLAN-007      | E2E-SCR-PLAN-007-01~05      |
| US-PLAN-016, US-PLAN-017, US-PLAN-018, US-PLAN-019              | SCR-PLAN-008      | UNE-DOC-005, UNE-DOC-006, UNE-DOC-007, UNE-DOC-008, UNE-DOC-009, UNE-DOC-010, UNE-DOC-011        | document_revision, change_set, change_operation, document_autosave, generation_job, ai_edit_proposal                            | SEQ-SCR-PLAN-008      | E2E-SCR-PLAN-008-01~05      |
| US-PLAN-021, US-PLAN-022                                        | SCR-PLAN-009      | UNE-DOC-012, UNE-DOC-013, UNE-DOC-014                                                            | export_job, validation_report, file_object                                                                                      | SEQ-SCR-PLAN-009      | E2E-SCR-PLAN-009-01~05      |
| US-PLAN-020, US-PLAN-027                                        | SCR-PLAN-010      | UNE-DOC-015, UNE-DOC-016, UNE-DOC-017                                                            | review_request, notification, review_comment, document, approval, audit_log                                                     | SEQ-SCR-PLAN-010      | E2E-SCR-PLAN-010-01~05      |
| US-PLAN-028                                                     | SCR-ADMIN-TPL-001 | UNE-ADMIN-001, UNE-ADMIN-005                                                                     | tenant, app_user, role, audit_log                                                                                               | SEQ-SCR-ADMIN-TPL-001 | E2E-SCR-ADMIN-TPL-001-01~05 |
| US-PLAN-029, US-PLAN-030                                        | SCR-QA-RT-001     | UNE-AUTH-002                                                                                     | app_user, user_role, organization                                                                                               | SEQ-SCR-QA-RT-001     | E2E-SCR-QA-RT-001-01~05     |
| US-SIT-001, US-SIT-002                                          | SCR-SIT-001       | UNE-SIT-002, UNE-SIT-003                                                                         | situation, situation_snapshot                                                                                                   | SEQ-SCR-SIT-001       | E2E-SCR-SIT-001-01~05       |
| US-SIT-002, US-SIT-026                                          | SCR-SIT-002       | UNE-SIT-003, UNE-SIT-005, UNE-SIT-012                                                            | situation, situation_snapshot, provider_job, audit_log                                                                          | SEQ-SCR-SIT-002       | E2E-SCR-SIT-002-01~05       |
| US-SIT-003                                                      | SCR-SIT-003       | UNE-SIT-001, UNE-SIT-003, UNE-SIT-004                                                            | situation, situation_snapshot, audit_log                                                                                        | SEQ-SCR-SIT-003       | E2E-SCR-SIT-003-01~05       |
| US-SIT-004, US-SIT-005, US-SIT-039                              | SCR-SIT-004       | UNE-SIT-005, UNE-SIT-006, UNE-SIT-007                                                            | provider_job, provider_result, situation_fact, fact_source                                                                      | SEQ-SCR-SIT-004       | E2E-SCR-SIT-004-01~05       |
| US-SIT-006, US-SIT-007, US-SIT-022, US-SIT-029                  | SCR-SIT-005       | UNE-SIT-007, UNE-SIT-008, UNE-SIT-009, UNE-SIT-010, UNE-SIT-011                                  | situation_fact, fact_source, audit_log, fact_duplicate_group, fact_conflict, conflict_resolution                                | SEQ-SCR-SIT-005       | E2E-SCR-SIT-005-01~05       |
| US-SIT-007                                                      | SCR-SIT-006       | UNE-SIT-007, UNE-SIT-008, UNE-SIT-009, UNE-SIT-010, UNE-SIT-011                                  | situation_fact, fact_source, audit_log, fact_duplicate_group, fact_conflict, conflict_resolution                                | SEQ-SCR-SIT-006       | E2E-SCR-SIT-006-01~05       |
| US-SIT-008, US-SIT-035                                          | SCR-SIT-007       | UNE-SIT-012, UNE-SIT-013                                                                         | situation_snapshot, audit_log                                                                                                   | SEQ-SCR-SIT-007       | E2E-SCR-SIT-007-01~05       |
| US-SIT-009                                                      | SCR-SIT-008       | UNE-KNOW-001, UNE-KNOW-002, UNE-KNOW-003                                                         | knowledge_document, provider_job                                                                                                | SEQ-SCR-SIT-008       | E2E-SCR-SIT-008-01~05       |
| US-SIT-010, US-SIT-039                                          | SCR-SIT-009       | UNE-KNOW-001, UNE-KNOW-002, UNE-KNOW-003                                                         | knowledge_document, provider_job                                                                                                | SEQ-SCR-SIT-009       | E2E-SCR-SIT-009-01~05       |
| US-SIT-011                                                      | SCR-SIT-010       | UNE-KNOW-004, UNE-KNOW-005, UNE-KNOW-006, UNE-KNOW-007                                           | evidence_set, evidence_item, audit_log, knowledge_document                                                                      | SEQ-SCR-SIT-010       | E2E-SCR-SIT-010-01~05       |
| US-SIT-012                                                      | SCR-SOP-001       | UNE-SOP-001, UNE-SOP-002, UNE-SOP-003                                                            | generation_job, job_event, sop                                                                                                  | SEQ-SCR-SOP-001       | E2E-SCR-SOP-001-01~05       |
| US-SIT-012, US-SIT-013                                          | SCR-SOP-002       | UNE-SOP-001, UNE-SOP-002, UNE-SOP-003                                                            | generation_job, job_event, sop                                                                                                  | SEQ-SCR-SOP-002       | E2E-SCR-SOP-002-01~05       |
| US-SIT-013, US-SIT-014                                          | SCR-SOP-003       | UNE-SOP-005, UNE-SOP-006, UNE-SOP-007                                                            | sop, sop_version, sop_node, sop_edge, sop_validation                                                                            | SEQ-SCR-SOP-003       | E2E-SCR-SOP-003-01~05       |
| US-SIT-014                                                      | SCR-SOP-004       | UNE-SOP-004, UNE-SOP-005, UNE-SOP-012                                                            | sop, sop_version, sop_node, sop_edge, sop_run, task                                                                             | SEQ-SCR-SOP-004       | E2E-SCR-SOP-004-01~05       |
| US-SIT-015                                                      | SCR-SOP-005       | UNE-SOP-008, UNE-SOP-009                                                                         | review_request, sop_version, approval, audit_log                                                                                | SEQ-SCR-SOP-005       | E2E-SCR-SOP-005-01~05       |
| US-SIT-016, US-SIT-017                                          | SCR-SOP-006       | UNE-SOP-010, UNE-SOP-012, UNE-SOP-013                                                            | sop_run, task, execution_event                                                                                                  | SEQ-SCR-SOP-006       | E2E-SCR-SOP-006-01~05       |
| US-SIT-017, US-SIT-027                                          | SCR-SOP-007       | UNE-SOP-011, UNE-SOP-012, UNE-SOP-013, UNE-SOP-014, UNE-SOP-015, UNE-SOP-016                     | sop_run, task, execution_event, outbox_message                                                                                  | SEQ-SCR-SOP-007       | E2E-SCR-SOP-007-01~05       |
| US-SIT-018                                                      | SCR-SOP-008       | UNE-TASK-003, UNE-TASK-013, UNE-TASK-014                                                         | dispatch, dispatch_recipient, outbox_message, channel_delivery, outbox_attempt                                                  | SEQ-SCR-SOP-008       | E2E-SCR-SOP-008-01~05       |
| US-SIT-019, US-SIT-025, US-SIT-039                              | SCR-SOP-009       | UNE-SOP-004, UNE-SOP-005, UNE-SOP-012                                                            | sop, sop_version, sop_node, sop_edge, sop_run, task                                                                             | SEQ-SCR-SOP-009       | E2E-SCR-SOP-009-01~05       |
| US-SIT-024                                                      | SCR-SOP-010       | UNE-SOP-004, UNE-SOP-005, UNE-SOP-012                                                            | sop, sop_version, sop_node, sop_edge, sop_run, task                                                                             | SEQ-SCR-SOP-010       | E2E-SCR-SOP-010-01~05       |
| US-SIT-020, US-SIT-021                                          | SCR-TASK-001      | UNE-TASK-001, UNE-TASK-002, UNE-TASK-004, UNE-TASK-005, UNE-TASK-006                             | task, task_assignment, task_event, task_attachment, execution_event                                                             | SEQ-SCR-TASK-001      | E2E-SCR-TASK-001-01~05      |
| US-SIT-022, US-SIT-029                                          | SCR-TASK-002      | UNE-TASK-001, UNE-TASK-002, UNE-TASK-004, UNE-TASK-005, UNE-TASK-006                             | task, task_assignment, task_event, task_attachment, execution_event                                                             | SEQ-SCR-TASK-002      | E2E-SCR-TASK-002-01~05      |
| US-SIT-023                                                      | SCR-TASK-003      | UNE-TASK-007, UNE-TASK-008, UNE-TASK-009                                                         | task, task_event, execution_event, outbox_message                                                                               | SEQ-SCR-TASK-003      | E2E-SCR-TASK-003-01~05      |
| US-SIT-021, US-SIT-028                                          | SCR-BOARD-001     | UNE-JNL-001, UNE-JNL-002, UNE-JNL-003, UNE-SOP-012, UNE-SOP-013, UNE-TASK-001, UNE-TASK-013      | situation_snapshot, task, execution_event, task_event, dispatch, sop_run, task_assignment, dispatch_recipient                   | SEQ-SCR-BOARD-001     | E2E-SCR-BOARD-001-01~05     |
| US-SIT-025                                                      | SCR-BOARD-002     | UNE-JNL-001, UNE-JNL-002, UNE-JNL-003, UNE-SOP-012, UNE-SOP-013, UNE-TASK-001, UNE-TASK-013      | situation_snapshot, task, execution_event, task_event, dispatch, sop_run, task_assignment, dispatch_recipient                   | SEQ-SCR-BOARD-002     | E2E-SCR-BOARD-002-01~05     |
| US-SIT-026                                                      | SCR-BOARD-003     | UNE-JNL-001, UNE-JNL-002, UNE-JNL-003, UNE-SOP-012, UNE-SOP-013, UNE-TASK-001, UNE-TASK-013      | situation_snapshot, task, execution_event, task_event, dispatch, sop_run, task_assignment, dispatch_recipient                   | SEQ-SCR-BOARD-003     | E2E-SCR-BOARD-003-01~05     |
| US-SIT-029                                                      | SCR-BOARD-004     | UNE-JNL-001, UNE-JNL-002, UNE-JNL-003, UNE-SOP-012, UNE-SOP-013, UNE-TASK-001, UNE-TASK-013      | situation_snapshot, task, execution_event, task_event, dispatch, sop_run, task_assignment, dispatch_recipient                   | SEQ-SCR-BOARD-004     | E2E-SCR-BOARD-004-01~05     |
| US-SIT-030                                                      | SCR-JRN-001       | UNE-JNL-002, UNE-JNL-005                                                                         | execution_event, journal, journal_revision, journal_section                                                                     | SEQ-SCR-JRN-001       | E2E-SCR-JRN-001-01~05       |
| US-SIT-031, US-SIT-032                                          | SCR-JRN-002       | UNE-JNL-002, UNE-JNL-005                                                                         | execution_event, journal, journal_revision, journal_section                                                                     | SEQ-SCR-JRN-002       | E2E-SCR-JRN-002-01~05       |
| US-SIT-032, US-SIT-033                                          | SCR-JRN-003       | UNE-JNL-006, UNE-JNL-007, UNE-JNL-008, UNE-DOC-006, UNE-DOC-007, UNE-DOC-009                     | journal, journal_revision, generation_job, ai_edit_proposal, change_set, change_operation, document_revision, document_autosave | SEQ-SCR-JRN-003       | E2E-SCR-JRN-003-01~05       |
| US-SIT-033, US-SIT-034                                          | SCR-JRN-004       | UNE-JNL-009, UNE-JNL-010                                                                         | review_request, journal, approval                                                                                               | SEQ-SCR-JRN-004       | E2E-SCR-JRN-004-01~05       |
| US-SIT-034                                                      | SCR-JRN-005       | UNE-JNL-011, UNE-DOC-013, UNE-DOC-014                                                            | export_job, validation_report, file_object                                                                                      | SEQ-SCR-JRN-005       | E2E-SCR-JRN-005-01~05       |
| US-SIT-034, US-SIT-035                                          | SCR-JRN-006       | UNE-JNL-005, UNE-JNL-006, UNE-JNL-007                                                            | journal, journal_revision, journal_section, generation_job, ai_edit_proposal                                                    | SEQ-SCR-JRN-006       | E2E-SCR-JRN-006-01~05       |
| US-SIT-035, US-SIT-036                                          | SCR-EVAL-001      | UNE-JNL-012                                                                                      | situation, sop_run, execution_event                                                                                             | SEQ-SCR-EVAL-001      | E2E-SCR-EVAL-001-01~05      |
| US-SIT-036, US-SIT-037, US-SIT-038                              | SCR-EVAL-002      | UNE-JNL-013, UNE-JNL-015                                                                         | evaluation, evaluation_score, survey_response, improvement_action                                                               | SEQ-SCR-EVAL-002      | E2E-SCR-EVAL-002-01~05      |
| US-SIT-036                                                      | SCR-EVAL-003      | UNE-JNL-014, UNE-JNL-015                                                                         | improvement_action, evaluation, survey_response                                                                                 | SEQ-SCR-EVAL-003      | E2E-SCR-EVAL-003-01~05      |
| US-SIT-036, US-SIT-040                                          | SCR-EVAL-004      | UNE-JNL-013, UNE-JNL-015                                                                         | evaluation, evaluation_score, survey_response, improvement_action                                                               | SEQ-SCR-EVAL-004      | E2E-SCR-EVAL-004-01~05      |
| US-PLAN-001, US-SIT-040                                         | SCR-ADMIN-001     | UNE-ADMIN-001, UNE-ADMIN-002, UNE-AUTH-005, UNE-AUTH-006, UNE-AUTH-007                           | tenant, app_user, role, user_role, audit_log, organization, permission, role_permission                                         | SEQ-SCR-ADMIN-001     | E2E-SCR-ADMIN-001-01~05     |
| US-SIT-014, US-SIT-018, US-SIT-040                              | SCR-ADMIN-002     | UNE-ADMIN-003, UNE-ADMIN-004, UNE-AUTH-005, UNE-AUTH-006                                         | organization, recipient_binding, app_user                                                                                       | SEQ-SCR-ADMIN-002     | E2E-SCR-ADMIN-002-01~05     |
| US-SIT-040, US-PLAN-030                                         | SCR-ADMIN-003     | UNE-ADMIN-005, UNE-ADMIN-006, UNE-ADMIN-007, UNE-ADMIN-011, UNE-ADMIN-012                        | audit_log, outbox_message, outbox_attempt, retention_policy                                                                     | SEQ-SCR-ADMIN-003     | E2E-SCR-ADMIN-003-01~05     |
| US-PLAN-024, US-SIT-004, US-SIT-039, US-SIT-040                 | SCR-ADMIN-004     | UNE-ADMIN-008, UNE-ADMIN-009, UNE-ADMIN-010                                                      | provider_config, audit_log, provider_health                                                                                     | SEQ-SCR-ADMIN-004     | E2E-SCR-ADMIN-004-01~05     |

## 9.2 대표 요구사항 추적

| **요구사항군**             | **Scenario/화면**   | **API**             | **DB**                            | **Acceptance Evidence**               |
|----------------------------|---------------------|---------------------|-----------------------------------|---------------------------------------|
| UFR-AUTH                   | SCR-AUTH/HOME/ADMIN | UNE-AUTH/HOME/ADMIN | iam\_\*                           | 토큰·기관·역할 Binding, 권한차단 로그 |
| UFR-INPUT/INFO/GUIDE/RULES | SCR-PLAN-005        | UNE-PLAN-006~008    | plan_context_draft/snapshot       | Schema 검증·Snapshot hash             |
| UFR-TABLE/CONTENT          | SCR-PLAN-006~008    | UNE-PLAN-009~016    | toc\_\*,job\_\*,generated_block   | T3Q Contract Test, SSE, 부분재시도    |
| UFR-PREVIEW/EXPORT/STORAGE | SCR-PLAN-007~012    | UNE-DOC-\*          | doc\_\*,file_object               | Revision/ChangeSet, HWPX Track A/B    |
| UFR-SOP-01~18              | SCR-SOP-\*          | UNE-SOP/TASK-\*     | sop\_\*,task\_\*,event\_\*        | DAG 검증, 실행·전파·수신·완료         |
| 3차년도 상황일지           | SCR-SIT/JRN/EVAL    | UNE-SIT/KNOW/JNL-\* | sit\_\*,know\_\*,jnl\_\*,eval\_\* | Snapshot+Execution Log Projection     |

# 10. 구현·배포·검증 기준

## 10.1 권고 구현 스택

| **계층**       | **권고**                                                   | **필수 통제**                                  |
|----------------|------------------------------------------------------------|------------------------------------------------|
| Frontend       | React + TypeScript, TanStack Query, 상태관리, rhwp Adapter | Context 유지, SSE 재접속, ETag, Autosave       |
| Gateway/BFF    | Java Spring Boot 또는 .NET 8 중 UNE 표준                   | OpenAPI 3.1, JWT/RBAC, Rate Limit, Correlation |
| Domain/Worker  | 모듈형 Monolith 우선, Job Worker 분리                      | Aggregate Transaction, Outbox, Adapter ACL     |
| DB             | PostgreSQL 16+, Flyway/Liquibase, PgBouncer                | Migration 재현, Partition, RLS/tenant filter   |
| Object Storage | S3 호환 MinIO                                              | SHA-256, AV Scan, Presigned URL                |
| Cache/Realtime | Redis optional, SSE 우선                                   | Cache key tenant 포함, Event 재처리            |
| Observability  | OpenTelemetry, Prometheus, Grafana                         | API/Job/Provider/Outbox SLI                    |
| Secrets        | Vault/KMS                                                  | 평문 Secret 금지                               |

## 10.2 비기능 목표

| **항목**   | **목표**                         | **측정**                   |
|------------|----------------------------------|----------------------------|
| 일반 API   | P95 2초 이하                     | APM/API 부하시험           |
| 전자상황판 | P95 3초 이하                     | 대표 1000 Event 집계       |
| 생성접수   | 3초 이내 202+jobId               | T3Q/UNI 실제 생성시간 제외 |
| SSE        | 15초 heartbeat, 재접속 복구      | 네트워크 단절 시험         |
| Autosave   | 5~10초 Debounce                  | 입력 손실 0건              |
| Outbox     | 1분 이내 1차 발송                | 채널 Mock/실제 시험        |
| DB         | RPO 15분/RTO 4시간 기본안        | 실증기관 협의·복구훈련     |
| 파일       | HWPX/PDF/DOCX Export 성공률·검증 | Track A 전수, Track B RC   |

## 10.3 Contract·통합·인수시험

- 모든 Endpoint는 OpenAPI 3.1, JSON Schema, 예시, 권한, 오류, 멱등성, ETag를 포함한다.

- T3Q/UNI는 Mock Server Contract Test와 실제 개발서버 E2E Test를 각각 수행한다.

- DB Migration은 빈 DB와 이전 기준선 DB에서 재현하고 실패 시 Forward-fix 절차를 검증한다.

- 56개 화면의 E2E-화면ID-01~05 정상·권한·충돌·장애·감사 시험을 자동화 또는 반복 가능한 절차서로 관리한다.

- Execution Event/Outbox 원자성, 중복 Worker, 재시도, Dead Letter, 수동 재처리 시험을 수행한다.

- HWPX Track A 자동검증은 모든 Export에 적용하고 Release Candidate는 지정 한컴 버전 Track B Round-trip 검증을 통과해야 한다.

- 평가의견의 시나리오 구체화·품질검증 요구를 Scenario-화면-API-DB-시험 Evidence로 증빙한다.

## 10.4 완료 Gate

| **Gate**   | **통과기준**                             | **증빙**                            |
|------------|------------------------------------------|-------------------------------------|
| G-API      | OpenAPI lint 0 error, Contract Test 통과 | openapi.yaml, test report           |
| G-DB       | Migration·제약·Index·Backup/Restore 통과 | migration log, ERD, data dictionary |
| G-SEQ      | 56개 화면 Sequence 정상/대체/예외 검증   | E2E report, screen recording        |
| G-PROVIDER | T3Q/UNI/공식 Provider Adapter 계약 통과  | mock+real E2E evidence              |
| G-OUTBOX   | 중복 0, 재시도·DLQ·감사 가능             | outbox test                         |
| G-HWPX-A   | Package/참조/IR/스타일 자동검증          | ValidationReport                    |
| G-HWPX-B   | 한컴 열기·저장·재열기 호환성             | QA checklist, 결과파일              |
| G-SEC      | 권한·Tenant·PII·파일·Secret 보안시험     | security report                     |

# 부록 A. PostgreSQL DDL 예시

> CREATE TABLE event_execution (
>
> execution_event_id uuid PRIMARY KEY,
>
> tenant_id uuid NOT NULL,
>
> situation_id uuid NOT NULL,
>
> aggregate_type varchar(30) NOT NULL,
>
> aggregate_id uuid NOT NULL,
>
> event_type varchar(50) NOT NULL,
>
> occurred_at timestamptz NOT NULL,
>
> recorded_at timestamptz NOT NULL DEFAULT now(),
>
> actor_id uuid,
>
> payload_json jsonb NOT NULL,
>
> corrects_event_id uuid REFERENCES event_execution(execution_event_id),
>
> correlation_id varchar(80) NOT NULL,
>
> event_hash char(64) NOT NULL
>
> ) PARTITION BY RANGE (recorded_at);
>
> CREATE INDEX ix_exec_situation_time
>
> ON event_execution (situation_id, occurred_at, event_type);
>
> CREATE TABLE event_outbox (
>
> outbox_id uuid PRIMARY KEY,
>
> tenant_id uuid NOT NULL,
>
> aggregate_type varchar(30) NOT NULL,
>
> aggregate_id uuid NOT NULL,
>
> event_type varchar(50) NOT NULL,
>
> payload_json jsonb NOT NULL,
>
> channel varchar(20) NOT NULL,
>
> status varchar(20) NOT NULL,
>
> attempt_count int NOT NULL DEFAULT 0,
>
> next_attempt_at timestamptz,
>
> idempotency_key varchar(100) NOT NULL,
>
> created_at timestamptz NOT NULL DEFAULT now(),
>
> UNIQUE(idempotency_key, channel)
>
> );
>
> CREATE INDEX ix_outbox_ready ON event_outbox(next_attempt_at)
>
> WHERE status IN ('PENDING','RETRY');

# 부록 B. Event·SSE Schema

> event: task.progressed
>
> id: 000000012345
>
> data: {
>
> "schemaVersion": "1.0",
>
> "correlationId": "corr\_...",
>
> "situationId": "...",
>
> "aggregateType": "TASK",
>
> "aggregateId": "...",
>
> "eventType": "TASK_PROGRESS_REPORTED",
>
> "occurredAt": "2026-07-27T19:30:00+09:00",
>
> "payload": {"progressPct": 50, "status": "IN_PROGRESS"}
>
> }

# 부록 C. 산출물 수량 요약

| **구분**             | **수량** | **비고**                   |
|----------------------|----------|----------------------------|
| UNE 내부 API         | 121      | OpenAPI 후보 Endpoint      |
| T3Q 원본 API         | 13       | MOIS v0.8.5 반영           |
| UNI 원본 Path/Method | 25       | OpenAPI PDF 추출           |
| 핵심 물리 테이블     | 57       | PostgreSQL 컬럼·제약·Index |
| 화면별 Sequence      | 56       | SCR ID 전수                |
| 화면별 기본 E2E      | 280      | 정상·권한·충돌·장애·감사   |
| ADR 추적             | 18       | ADR-01~18                  |

본 문서의 API·DB·Sequence는 구현 기준선이다. 변경 시 Interface Change Request에서 영향 화면, Scenario, Migration, Contract Test, E2E Test와 산출물 버전을 동시에 갱신한다.
