**  
재난안전 AI 문서 통합플랫폼  
설계기준선 통합점검 및 개발착수 실행패키지**

Version 1.0 / 2026.07.27

| **구분**   | **내용**                                                                                                                      |
|------------|-------------------------------------------------------------------------------------------------------------------------------|
| 과제명     | 재난관리를 위한 맞춤형 정보생성 및 의사결정지원 대화형 인공지능 기술개발                                                      |
| 과제번호   | RS-2024-00407304                                                                                                              |
| 담당기관   | 주식회사 유엔이(UNE)                                                                                                          |
| 기준선     | ADR v1.1, 개발계획서/WBS v1.0, 계획서·상황일지 사용자 시나리오 v1.0, 화면설계 v1.0, API·DB·Sequence v1.0                      |
| 실행산출물 | OpenAPI 3종, JSON Schema 7종, PostgreSQL DDL 10개 Migration, 57개 테이블 데이터사전, ERD, FastAPI Mock, Contract/E2E 시험자료 |
| 문서 성격  | 설계 종료 확인과 구현 착수를 위한 통제문서. 외부 기관 계약 미확정값은 OPEN Binding으로 분리                                   |

# 1. 통합점검 목적과 결론

본 점검은 분리 작성된 설계 산출물 사이의 역할, 상태, 데이터 원장, API, DB, 화면, Sequence 및 시험 추적관계를 재검증하고, 개발 저장소에서 즉시 활용할 수 있는 실행 파일로 변환하기 위한 것이다.

| **판정영역**     | **판정**      | **근거·조치**                                                                                |
|------------------|---------------|----------------------------------------------------------------------------------------------|
| 업무범위         | PASS          | UNE는 계획서·상황일지·HWPX·SOP 실행이력, T3Q는 RAG/LLM·외부연계·TTS/STT로 경계 유지          |
| 계획서 Provider  | PASS          | 목차·본문은 T3Q RPT-001/002 전용. 계획서 과정의 UNI 호출 0건                                 |
| 상황 사실원장    | PASS          | 외부정보는 후보 Fact, 사용자 확정 SituationSnapshot과 Append-only Execution Log만 사실원장   |
| SOP·전파         | PASS          | UNI는 SOP 콘텐츠 후보 생성. 실행·전파·수신·완료는 UNE 내부 Workflow/Outbox/Execution Log     |
| HWPX             | PASS WITH POC | rhwp 소스 반입·Adapter·보존형 Serializer·Track A/Track B Gate 확정. 지원 객체는 POC로 등급화 |
| API·DB·화면 추적 | PASS          | 121 API, 57 물리 테이블, 56 화면 Sequence가 동일 ID 체계로 연결됨                            |
| 외부 계약값      | OPEN BINDING  | T3Q/UNI 인증·오류·SSE·실증기관·채널·한컴 QA 환경은 계약 Gate에서 확정                        |

**결론: 핵심 설계는 개발 착수 기준선으로 승인 가능하다.**

# 2. 설계 기준선 구성과 계층

| **계층**               | **기준문서**                                                  | **통제내용**                                            |
|------------------------|---------------------------------------------------------------|---------------------------------------------------------|
| ADR                    | UNE_통합플랫폼_ADR_의사결정기록서_v1.1                        | 구조적 의사결정과 OPEN Gate                             |
| 개발계획/WBS           | UNE_재난안전_AI문서_통합플랫폼_개발계획서_및_상세WBS_v1.0     | 작업·선행조건·DoD                                       |
| 계획서 시나리오        | UNE_재난안전계획서_생성도구_사용자_시나리오_상세설계서_v1.0   | T3Q RPT-001/002와 rhwp 편집 흐름                        |
| 상황일지·훈련 시나리오 | UNE_상황일지_안전한국훈련_사용자_시나리오_상세설계서_v1.0     | Fact/Snapshot/SOP/전파/Execution Log/일지               |
| 화면설계               | UNE_통합플랫폼_화면목록_화면흐름_상태권한오류_상세설계서_v1.0 | 56개 화면, 상태·권한·오류                               |
| API·DB·Sequence        | UNE_통합플랫폼_API_DB_화면별Sequence_상세설계서_v1.0          | 121 API, 57 테이블, 화면별 동적 Sequence                |
| HWPX 상세              | UNE_HWPX_rhwp_Document_Engine_상세명세서_v1.0                 | Document IR, ChangeSet, Serializer, Validation          |
| Situation/UNI 상세     | UNE_SituationContext_UNI_Adapter_상세명세서_v1.0              | Provider Port, Fact/Snapshot, UNI Anti-Corruption Layer |

| ADR -\> WBS -\> 사용자 시나리오 -\> 화면 ID -\> API ID -\> DB Table/Column -\> Sequence ID -\> Contract/E2E Test -\> Evidence |
|-------------------------------------------------------------------------------------------------------------------------------|

# 3. 기관·시스템 책임경계 재검증

| **기능**            | **UNE**                                        | **T3Q**                     | **UNI**                      | **원장·주의**                            |
|---------------------|------------------------------------------------|-----------------------------|------------------------------|------------------------------------------|
| 계획서 목차·본문    | UI, Snapshot, Job, rhwp 편집, HWPX             | RPT-001/002 생성            | 사용 안 함                   | PlanContextSnapshot 및 Document Revision |
| 상황정보            | Provider Adapter, Fact 정규화·확정             | 계약된 상황정보 API 후보    | 직접 사실원장 아님           | SituationSnapshot                        |
| 훈련자료·SOP 콘텐츠 | 학습등록 UI, EvidenceSet, UniSopMapper, Canvas | 위기관리·재난정보 연계 가능 | Upload/Search/chat-json/chat | 승인된 SopVersion                        |
| 임무·전파           | Workflow, ChannelPort, Outbox, 수신·완료       | 외부 채널 API 제공 가능     | 담당하지 않음                | Execution Log                            |
| 상황일지            | Projection, 사실잠금, rhwp, Export             | RPT-003 선택적 표현 보조    | RAG 근거 보조                | Snapshot + Execution Log                 |
| STT/TTS             | 결과 표시·연계                                 | 개발·제공                   | 담당하지 않음                | T3Q 계약                                 |

# 4. 실행산출물 인벤토리

| **산출물**          | **수량**                | **개발 활용**                                                                      |
|---------------------|-------------------------|------------------------------------------------------------------------------------|
| UNE OpenAPI         | 121 Endpoint            | ADMIN 12, AUTH 7, DOC 17, HOME 4, JNL 15, KNOW 7, PLAN 16, SIT 13, SOP 16, TASK 14 |
| T3Q Adapter OpenAPI | 3 Endpoint              | RPT-001/002 필수, RPT-003 선택                                                     |
| UNI Adapter OpenAPI | 25 Path/Method          | 자료 업로드·검색·SSE SOP 생성 및 보조 API                                          |
| JSON Schema         | 7종                     | 입력·사실·그래프·Event·Projection 자동검증                                         |
| PostgreSQL          | 57 Table / 10 Migration | DDL, FK, Index, RLS, Seed, 파티션 전환안                                           |
| ERD                 | DOT/SVG/PNG/Mermaid     | 개발·검토·문서삽입                                                                 |
| Mock Server         | FastAPI                 | Frontend·Provider Adapter 병렬개발                                                 |
| 시험자료            | pytest + Contract/E2E   | 착수 Gate와 회귀시험                                                               |

# 5. OpenAPI 기준선

## 5.1 UNE 내부 API 도메인

| **도메인** | **API 수** | **주요 기능**                  |
|------------|------------|--------------------------------|
| ADMIN      | 12         | RBAC·감사·연계                 |
| AUTH       | 7          | SSO·조직·사용자                |
| DOC        | 17         | HWPX·편집·Export               |
| HOME       | 4          | 홈·알림                        |
| JNL        | 15         | 상황판·Execution Log·일지·평가 |
| KNOW       | 7          | UNI 자료·Evidence              |
| PLAN       | 16         | 기준정보·T3Q Job               |
| SIT        | 13         | Fact·Snapshot                  |
| SOP        | 16         | 생성·검증·승인·실행            |
| TASK       | 14         | 전파·현장보고                  |

## 5.2 공통 계약

- Base URL은 \`/api/v1\`, JSON은 UTF-8, 파일은 사전등록/완료 2단계 또는 multipart를 적용한다.

- JWT Claim의 tenant/role을 서버가 확정하고 X-Tenant-Id 클라이언트 값만 신뢰하지 않는다.

- 모든 변경 요청은 X-Correlation-Id를 전 구간 전달하고 생성·전파·Export에는 Idempotency-Key를 적용한다.

- 편집·설정 변경은 ETag/If-Match 또는 versionNo로 낙관적 잠금을 적용한다.

- SSE는 Heartbeat와 Last-Event-ID 재접속, 명시적 완료·오류 Event를 포함한다.

- 외부 Provider 원문 오류는 UNE 오류 Envelope로 변환하되 운영로그에는 Correlation ID와 원본 상태를 보존한다.

# 6. JSON Schema 기준선

| **파일**                       | **검증 대상**   | **불변조건**                           |
|--------------------------------|-----------------|----------------------------------------|
| plan-context.schema.json       | 계획서 기준정보 | 재난유형·예방/대비·작성목적 필수       |
| situation-fact.schema.json     | 후보/확정 Fact  | 출처·수집시각·표준 Key 필수            |
| situation-snapshot.schema.json | 상황 확정본     | Fact 배열·버전·SHA-256·확정자          |
| sop-graph.schema.json          | SOP Node/Edge   | 시작/종료·Node Key·분기 Edge 입력구조  |
| execution-event.schema.json    | 실행이력 원장   | 업무시각·기록시각·정정참조·Event Hash  |
| journal-projection.schema.json | 상황일지 투영   | Snapshot·기간·Event ID·Projection Hash |
| common-error.schema.json       | 표준 오류       | 오류코드·복구가능성·사용자 조치        |

# 7. DB 구축 기준선

| **도메인**          | **테이블 수** | **테이블**                                                                                                                                                                                                                                                  |
|---------------------|---------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| IAM                 | 7             | tenant, organization, app_user, role, permission, user_role, user_session                                                                                                                                                                                   |
| PLAN/DOCUMENT       | 17            | plan, plan_context_draft, plan_context_snapshot, toc_version, toc_node, generation_job, job_event, document, document_revision, document_block, change_set, change_operation, template_profile, style_prototype, file_object, export_job, validation_report |
| SITUATION/KNOWLEDGE | 10            | situation, fact_source, situation_fact, fact_conflict, conflict_resolution, situation_snapshot, provider_job, knowledge_document, evidence_set, evidence_item                                                                                               |
| SOP/TASK            | 12            | sop, sop_version, sop_node, sop_edge, sop_validation, sop_run, task, task_event, task_attachment, dispatch, dispatch_recipient, execution_event                                                                                                             |
| EVENT/JOURNAL/ADMIN | 11            | outbox_message, outbox_attempt, journal, journal_projection_item, evaluation, evaluation_score, improvement_action, provider_config, audit_log, retention_policy, notification                                                                              |

## 7.1 원장·불변·트랜잭션 원칙

- PlanContextSnapshot, SituationSnapshot, 승인 SopVersion은 UPDATE하지 않고 새 버전을 생성한다.

- Execution Event와 Audit Log는 삭제·덮어쓰기하지 않고 정정 Event를 추가한다.

- SOP 실행·Task 활성화·Execution Event·Outbox Message는 동일 DB Transaction으로 기록한다.

- 외부 채널 전송은 Commit 이후 Worker가 수행하며 재시도·Dead Letter·수동재처리를 지원한다.

- HWPX/PDF/이미지는 Object Storage에 저장하고 DB에는 SHA-256, MIME, 크기, Storage Key를 저장한다.

- Tenant ID가 있는 테이블은 PostgreSQL RLS를 적용하고 하위 Aggregate는 Service Layer Join 검증을 병행한다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/11_BASELINE_INTEGRATION_CHECK_v1.0/media/image1.png" style="width:6.49606in;height:1.05314in" />

그림 1. UNE 통합플랫폼 도메인 ERD 개요(상세 57개 테이블 ERD는 패키지 별도 제공)

# 8. Mock Server와 병렬개발 방식

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>cd 05_mock_server<br />
python -m uvicorn app:app --host 127.0.0.1 --port 8080<br />
# Swagger: http://127.0.0.1:8080/docs</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **지원 흐름**  | **Mock 상태**                                 |
|----------------|-----------------------------------------------|
| SSO 교환       | Mock JWT·UserContext 반환                     |
| 계획서         | 생성 -\> Context Snapshot -\> TOC Job -\> SSE |
| 상황           | Situation 등록 -\> Snapshot                   |
| SOP            | SOP 생성 -\> Run -\> Task 생성                |
| 현장임무       | 수신확인 -\> 완료보고                         |
| 상황일지       | Journal Projection                            |
| 나머지 121 API | 표준 Envelope Generic fallback                |

# 9. 시험·검증 Gate

| **Gate**  | **검증**                                              | **구분**         |
|-----------|-------------------------------------------------------|------------------|
| G-OPENAPI | YAML Parse, 121 operationId, Path Parameter, 표준응답 | Blocking         |
| G-SCHEMA  | 7개 Draft 2020-12 Schema 자체검증 및 예제검증         | Blocking         |
| G-DB      | Migration 순서, PK/FK/Index/RLS, 빈 DB 재현           | Blocking         |
| G-MOCK    | 계획서 및 상황-SOP-임무-일지 Smoke Test               | Blocking         |
| G-T3Q     | RPT-001/002 Mock Contract + 실제 개발서버 Contract    | Blocking         |
| G-UNI     | Upload/Search/chat-json/chat SSE·Mapper Contract      | Blocking         |
| G-HWPX-A  | ZIP/XML/참조/Document IR 재열기 자동검증              | Blocking         |
| G-HWPX-B  | Windows/한컴 열기·저장·재열기 회귀시험                | Release Blocking |
| G-E2E     | 10개 핵심 업무 시나리오와 감사증거                    | Release Blocking |

# 10. OPEN Binding과 변경통제

| **ID**  | **미확정 항목**                   | **주체**     | **종료조건**                    |
|---------|-----------------------------------|--------------|---------------------------------|
| BIND-01 | T3Q 현재 재난상황 API             | T3Q          | API 계약서·Mock·개발서버 성공   |
| BIND-02 | T3Q RPT-003 상황일지 사용 여부    | UNE/T3Q      | 선택적 Adapter 또는 미사용 결정 |
| BIND-03 | UNI compns 필드와 SOP Schema Gap  | UNE/UNI      | Mapper 표·Golden JSON 20건      |
| BIND-04 | SafeKorea/Naver 보조수집          | PM/법무      | 약관·보안·운영 승인             |
| BIND-05 | rhwp 지원 객체와 소스 반입 Commit | UNE 개발팀   | Tag/Commit/SHA-256/SBOM/POC     |
| BIND-06 | 한컴 QA 환경                      | UNE/수요기관 | Windows·한컴 버전·라이선스      |
| BIND-07 | 실제 전파 채널                    | 수요기관/T3Q | ChannelPort 계약·테스트 계정    |
| BIND-08 | 실증기관 및 자연/사회 재난        | 행안부/기관  | Binding 문서·Scenario Pack      |

OPEN 항목은 핵심 설계 미완료가 아니다. 외부 계약값은 Adapter 또는 Binding 레이어에서만 변경하며, Snapshot·Execution Log·HWPX 보존·기관 격리 원칙을 변경할 경우 새 ADR을 발행한다.

# 11. 개발팀 착수 순서

| **순서** | **작업**             | **완료조건**                                                           |
|----------|----------------------|------------------------------------------------------------------------|
| 1        | 패키지 검증          | 07_validation/run_validation.sh 실행, 오류 0건                         |
| 2        | 저장소 구성          | openapi/schema/db/mock/test 폴더 반입, 브랜치 보호                     |
| 3        | DB Bootstrap         | V001~V009 적용, Seed·RLS 검증                                          |
| 4        | Backend Skeleton     | OpenAPI Codegen 또는 Controller Stub, 오류 Envelope·JWT·Tenant Context |
| 5        | Frontend 병렬개발    | Mock Server 연결, 56개 화면 Query/Mutation Key 확정                    |
| 6        | Provider Adapter POC | T3Q RPT-001/002, UNI Upload/Search/chat-json/chat                      |
| 7        | HWPX POC             | rhwp 반입, 코로나 샘플 Package/IR/Serializer/Track A                   |
| 8        | Workflow POC         | SOP Run-Task-Outbox-Execution Event 원자성                             |
| 9        | E2E                  | 계획서와 훈련 2개 수직 Slice 통과                                      |
| 10       | Release Gate         | 한컴 Round-trip, 보안·성능·기관 Binding                                |

# 12. 추적성·수용기준

| **도메인** | **추적 경로**                                                                          | **인수기준**                       |
|------------|----------------------------------------------------------------------------------------|------------------------------------|
| PLAN       | PlanContextSnapshot -\> T3Q RPT-001/002 -\> Document Revision                          | UNI 호출 0, 사용자 수정 Block 보호 |
| HWPX       | Source File -\> Template Profile/Prototype -\> ChangeSet -\> Serializer -\> Validation | 미지원 객체 보존, 참조오류 0       |
| SITUATION  | Provider Raw -\> Fact -\> Conflict Resolution -\> Snapshot                             | 출처 없는 Fact 확정 금지           |
| SOP        | EvidenceSet -\> UNI -\> UniSopMapper -\> SopVersion -\> Approval                       | DAG 검증 및 승인버전 고정          |
| TASK       | SopRun -\> Task -\> Dispatch/Outbox -\> ACK/Progress/Complete                          | 중복전파·중복완료 방지             |
| JOURNAL    | Snapshot + Execution Event -\> Projection -\> rhwp/Export                              | AI가 숫자·시각·상태 변조 금지      |
| SECURITY   | JWT/RBAC/Tenant/RLS/Audit                                                              | 기관 교차접근 403 및 감사증거      |

# 부록 A. 패키지 파일 해시

| **상대경로**                                                  | **SHA-256**                                                      | **크기(Byte)** |
|---------------------------------------------------------------|------------------------------------------------------------------|----------------|
| 00_README.md                                                  | af308d10bbff46bf6d4d0bcfdd764c1474f3f3e36692da944a0bcd4276fe5cff | 2055           |
| 02_openapi/t3q-report-adapter-v0.8.5-une1.yaml                | fd82f44c2afd02686e049ea63c666cb88114f1994a2a7b00f7a3250928bb4e6c | 6826           |
| 02_openapi/une-platform-api-v1.yaml                           | 5fdd9431e9a2330b56d352085250fffc3ada7d23209da145e5682b1c56397807 | 186184         |
| 02_openapi/uni-rag-adapter-v1.1.0-une1.yaml                   | 4fd33a6695d6a311d76081a434604dc56fca108107377246954c6132645ce637 | 24344          |
| 03_json_schema/common-error.schema.json                       | d834b5176d1919e2f9321a8ad47694302087c002a32aff9845d94e0df4441a7b | 2049           |
| 03_json_schema/execution-event.schema.json                    | 51c426361a73743d925234c273f20603e116ebcf8296af3e919acd944bdf4b67 | 1489           |
| 03_json_schema/journal-projection.schema.json                 | 9a66b1e22bda19c205225f64714ab46b23ae8a8197d13fec5ac7ba8d4988ec08 | 1873           |
| 03_json_schema/plan-context.schema.json                       | a39e6b3a56e00a704983da3f2e43c661f5d8cc545bc75ff46a11674528c8f375 | 3669           |
| 03_json_schema/situation-fact.schema.json                     | eb19f9899021cb9f2651ebcb924420fc322b2d8932b7c633ef082025fe921901 | 2017           |
| 03_json_schema/situation-snapshot.schema.json                 | e88f3a49fb22dbc7e55f5f28f2e38106d70123bfd941661f06a104867caa8e39 | 1211           |
| 03_json_schema/sop-graph.schema.json                          | 7d7d066b43a421033a5033708994f47032360aa17aa6f49945875f3b97f659e9 | 3241           |
| 04_database/data-dictionary.csv                               | 57381033e455e70fe032621ef2a24fe45b69ab31b78696d0e7804b94511fc772 | 24874          |
| 04_database/ddl/V001\_\_extensions_and_common.sql             | 289086be60dc339e7b39c8cbc9ba1a20b0981eeca36ef1ed8aab5e0283002788 | 456            |
| 04_database/ddl/V002\_\_iam.sql                               | 591b896468c5c227532b5dc0fc24774c64c5923af759dbd793f58a57e5d87357 | 5833           |
| 04_database/ddl/V003\_\_plan_document.sql                     | 3e4bcd70d00754bbe200af106e2fe95f9c93341dbec18f1618a597f1aa6ae3b0 | 16659          |
| 04_database/ddl/V004\_\_situation_knowledge.sql               | 4c54d14e2e81f2031914a3e270ba7993477ff8b817a76aa352be392da93df7ab | 9683           |
| 04_database/ddl/V005\_\_sop_task.sql                          | cbcdb1383dc18b0e3896b0e3b3245cf8415cb0b322ccf388d2b398f3c509ea1e | 9790           |
| 04_database/ddl/V006\_\_event_journal_admin.sql               | 9b4742c3930528af0d52075eee73d08a4e6f283f8c056a02e7da119f986c4d28 | 12121          |
| 04_database/ddl/V007\_\_foreign_keys_indexes.sql              | 2e9e771f91f2852c6fd3f727555d489f2b9a30c3c1bed8328e38d136ae8913c0 | 20438          |
| 04_database/ddl/V008\_\_row_level_security.sql                | 014a60f804e41b537866ffb65942789fd2720e57948aad69e02996a53d68a2de | 4407           |
| 04_database/ddl/V009\_\_seed_codes.sql                        | ec3362a73df4d37f937b310fabc3e8dd9c6726412c5b9a1b14d11f1a8023fe01 | 1132           |
| 04_database/ddl/V010\_\_execution_event_partitioning_plan.sql | 91ed37ab354c6b91b5e66283e9acb04f2e4f3d08672bb6bbb31da62ec1dc566c | 495            |
| 04_database/erd/une-platform-domain-overview.dot              | 7a608b11fc9ee511a532ba030e82ff5b002f2d444a550ab86d36ff232b183525 | 1008           |
| 04_database/erd/une-platform-domain-overview.png              | ae6ee287a4eb7787d5aa1f0ce58dae89a973b0d4864470d995efe1189767fb86 | 58253          |
| 04_database/erd/une-platform-domain-overview.svg              | dab21e1fd204da815630ff033af64b0fbcf28dd845cb020244b2972cc9f1af86 | 6689           |
| 04_database/erd/une-platform-erd.dot                          | 2914882d37195bf3993aba412ede2213d65ebcb3e104804ad5a8ed303b344efa | 17665          |
| 04_database/erd/une-platform-erd.mmd                          | b5451140bcab1f6cec985e3a87a210293993082f64d26e170db062530dde64a6 | 20334          |
| 04_database/erd/une-platform-erd.png                          | b286f555013d6555880a4102f8bd4b5bdb1e1c733286d70b952a64b31d704888 | 592329         |
| 04_database/erd/une-platform-erd.svg                          | d5ec6371d40ed47398e58326255c9c145a5a44ea3bbade1622f3b585b29a56e8 | 57564          |
| 05_mock_server/README.md                                      | 382ab5b0a07275e32967c282ee0dc80c6c47257e3d855887c145804d01ca844d | 384            |
| 05_mock_server/app.py                                         | ea70899a37b94a2ba617dee5fff47055514d02677b97644c3047ff15f528ded4 | 7667           |
| 05_mock_server/requirements.txt                               | 607522df8e5487b1c18e7cf130a1f4745ac89827f37184dbf2134cc09754f0a4 | 43             |
| 05_mock_server/run_mock.sh                                    | 5857df56e2b2f176bbb179313d2ee2e9458cdcdfaf367999926984508f15b81f | 101            |
| 06_tests/api-catalog.csv                                      | 485b0699ca0e9ed11aa17522b3e19a64fd38fe13e5f2194eb32f37d9c8930416 | 18095          |
| 06_tests/api-contract-test-plan.md                            | c612059017c9b492400584355e494edbf814a5f29e22083573da0c978089ca4b | 562            |
| 06_tests/e2e-test-scenarios.md                                | 66d9b1db38edfa1db96cf812d1d0e377bbeb03acd4cd3789ea3e850a5569fadd | 3559           |
| 06_tests/pytest.ini                                           | 9f1d90ecfee477af340240d0b54d309b88205025760a55e7e0e91ac9e6d8eb7c | 53             |
| 06_tests/test_mock_api.py                                     | 8dd357cd0d6e808b6dd3aadbab3d27d5e7002d59286fdc9683e0b0a4c004087c | 2265           |
| 07_validation/run_validation.sh                               | ec029a23090b72aa07d69da8ee0873c5f5e353a53fcb1dbdc6f0dd143f4f36f4 | 119            |
| 07_validation/validate_package.py                             | fea2c0b5d0f9a0eb689ea558e9a427e97001317db5457b37a8ab76fb93079886 | 1558           |

# 부록 B. 최종 승인 체크리스트

- [ ] 01. OpenAPI 121개 Endpoint와 기존 API ID가 일치한다.

- [ ] 02. JSON Schema 7종이 Draft 2020-12 검증을 통과한다.

- [ ] 03. 57개 물리 테이블과 데이터사전이 상세설계와 일치한다.

- [ ] 04. Mock Server 및 pytest Smoke Test가 통과한다.

- [ ] 05. T3Q/UNI 미확정값은 OPEN Binding으로 식별되어 코드에 하드코딩되지 않는다.

- [ ] 06. 계획서에서 UNI를 호출하지 않는다.

- [ ] 07. SituationSnapshot과 Execution Log가 사실원장으로 유지된다.

- [ ] 08. SOP 실행과 Outbox가 동일 Transaction이다.

- [ ] 09. HWPX Source/Revision/Validation이 추적되고 한컴 Round-trip은 Release Gate다.

- [ ] 10. 기관 격리·RBAC·감사·보존정책 시험계획이 있다.
