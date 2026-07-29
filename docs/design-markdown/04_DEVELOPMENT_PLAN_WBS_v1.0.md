**재난안전 AI 문서 통합플랫폼**

**개발계획서 및 상세 WBS**

ADR 확정 기준선 · 3차년도 통합개발 실행계획

| **문서 버전** | Version 1.0 \| 2026.07.26                                                                       |
|---------------|-------------------------------------------------------------------------------------------------|
| **계획 기간** | 2026.07.27 ~ 2026.12.31                                                                         |
| **과제명**    | 재난관리를 위한 맞춤형 정보생성 및 의사결정지원 대화형 인공지능 기술개발                        |
| **과제번호**  | RS-2024-00407304                                                                                |
| **작성기관**  | ㈜유엔이(UNE)                                                                                   |
| **적용 범위** | 재난안전계획서 생성도구 고도화, 상황일지 생성도구, 안전한국훈련 연계, HWPX/rhwp Document Engine |
| **기준선**    | 통합설계 v0.9 + ADR v1.1 + HWPX Engine v1.0 + SituationContext/UNI Adapter v1.0                 |

**㈜유엔이**

# 문서 작성·검토·승인

| **구분** | **소속** | **역할**                                | **상태**         |
|----------|----------|-----------------------------------------|------------------|
| 작성     | ㈜유엔이 | 연구기획·PM·시스템 아키텍처             | 작성 완료        |
| 검토     | ㈜유엔이 | 개발책임자·Frontend·Backend·문서엔진·QA | 개발 착수 검토   |
| 승인     | ㈜유엔이 | 연구소장/PM                             | 개발 기준선 승인 |

# 제·개정 이력

| **버전** | **일자**   | **개정내용**                                                                                                                                                             | **작성** |
|----------|------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| 1.0      | 2026.07.26 | ADR-01~18과 대화 중 확정된 rhwp 소스 반입·한컴 호환성 검증 경계를 반영하여 3차년도 개발계획, Sprint, Gate, Work Package, 세부 WBS, 산출물·시험·위험·인수기준을 최초 작성 | ㈜유엔이 |

| **문서 통제 원칙** 본 문서는 상세설계 내용을 요약·축약한 일정표가 아니다. ADR과 통합설계의 기능·상태·권한·오류·API·DB·Sequence·시험 요구를 실제 개발 작업, 선행조건, 산출물, Definition of Done, Gate 및 증거로 전개한 실행 통제문서이다. 문서가 길다는 이유로 Work Package 또는 세부 작업을 임의 삭제하지 않는다. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 목차

• 1. 개발계획 개요

• 2. ADR 적용 기준과 정정사항

• 3. 개발 대상 시스템과 Work Package

• 4. 개발수행·형상·변경·품질 관리계획

• 5. Work Package별 상세 개발계획

• 6. 일정·Sprint·Milestone·Critical Path

• 7. 상세 WBS

• 8. 산출물·문서·추적성 관리

• 9. 시험·검증·인수 계획

• 10. 위험·외부의존성·대응계획

• 11. 완료·인수·후속단계

• 부록 A. RACI

• 부록 B. ADR-WP-Gate 추적표

• 부록 C. Gate 체크리스트

• 부록 D. 외부 요청사항 Register

# 1. 개발계획 개요

## 1.1 목적

• 재난안전계획서 생성도구와 상황일지 생성도구를 React 기반 통합플랫폼, rhwp Web Editor, UNE Document Orchestrator, HWPX/rhwp Document Engine, SituationContext, Workflow/Propagation/Execution Log로 구현한다.

• 계획서 생성은 T3Q RPT-001/002 전용 Provider로 구현하고, 상황일지·안전한국훈련 POC는 UNI Upload/Search/chat-json/chat과 UNE 내부 Workflow/JournalProjection을 결합한다.

• 임의 HWPX 양식을 분석해 원본 서식을 상속하고, Cursor/Range/Block/Section 단위의 직접편집·AI편집·Diff·Undo를 지원하며, 한컴 호환성 Round-trip 검증을 배포 승인 기준으로 운영한다.

• ADR의 조건부 외부의존성을 개발 대기사항이 아니라 Port/Adapter, Feature Flag, Mock/Stub, Institution Binding Gate로 전환해 2026년 내 프로토타입과 인수증거를 확보한다.

## 1.2 개발 범위와 비범위

| **구분**     | **포함 범위**                                                                                          | **제외/외부 책임**                                      |
|--------------|--------------------------------------------------------------------------------------------------------|---------------------------------------------------------|
| 계획서       | 기준정보, 임의 HWPX 분석, T3Q 목차/본문, rhwp 편집, HWPX/PDF/DOCX 보조 Export                          | LLM/RAG 모델 자체와 계획서 생성용 UNI fallback은 제외   |
| 상황일지     | SituationFact/Snapshot, 사용자 자료, UNI SOP POC, Workflow/전파/Execution Log, JournalProjection, HWPX | T3Q RPT-003은 초기 필수 의존성 아님                     |
| 안전한국훈련 | SOP 생성·검토·승인·실행, 임무전파, 수신·착수·완료, 전자상황판, 평가·일지                               | T3Q/UNI를 전파 API로 사용하지 않음                      |
| 문서엔진     | 특정 Tag/Commit 소스 반입, Adapter, IR, Analyzer, ChangeSet, Serializer, 자동검증, 한컴 QA             | 한컴 서버 자동실행·HWP binary 완전편집은 핵심범위 아님  |
| 외부연계     | KMA/MOIS 공식 API, SafeKorea 보조, Naver 사용자 요청형 Stub, T3Q/UNI Adapter                           | T3Q가 담당하는 외부원천 API 개발·TTS/STT 모델 개발 제외 |
| UI           | React 통합 Workspace와 rhwp 중앙 편집 Surface                                                          | 범용 챗봇 UI·AI Agent 플랫폼 개발 제외                  |

## 1.3 계획기간과 일정 기준

| **일정 기준** 기준 실행기간은 2026.07.27~2026.12.31이며 S0~S11의 12개 Sprint로 운영한다. 외부 API·실증기관·실채널이 늦어져도 Mock/Stub/Simulation으로 공통 도메인과 E2E를 완성하고, 실제 연계는 Adapter 활성화 또는 Institution Binding으로 처리한다. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 1.4 개발 성공조건

| **영역** | **완료 기준**                                                                              |
|----------|--------------------------------------------------------------------------------------------|
| 기준선   | ADR-01~18, Schema, WBS, 사용자 시나리오, 화면/API/DB/Sequence의 추적 누락 0건              |
| 계획서   | T3Q RPT-001/002만 사용하여 목차·본문을 생성하고 rhwp에서 직접/AI 편집 후 HWPX 저장         |
| 문서호환 | HWPX Package/Reference 치명오류 0, 텍스트·표·필드 손실 0, RT-A~G 배포 승인 통과            |
| 상황정보 | 외부 Provider 전부 OFF여도 수동입력으로 Snapshot 확정 가능, Provider 장애격리와 충돌 비교  |
| SOP/훈련 | UNI SSE를 UNE SOP로 변환·검증하고 실행·전파·수신·완료 이력을 Execution Log에 축적          |
| 상황일지 | Snapshot+Execution Log만으로 최소 일지 생성, 모든 문장/표셀 source trace 100%, 허위 Fact 0 |
| 실증대비 | 태풍·호우와 붕괴사고 Reference Scenario E2E 및 기관 Binding 절차 확보                      |

# 2. ADR 적용 기준과 정정사항

## 2.1 ADR-01~18 개발 구속사항

| **ADR** | **결정**                                          | **개발 구속사항**                                           |
|---------|---------------------------------------------------|-------------------------------------------------------------|
| ADR-01  | rhwp Web Editor 단일 편집 Surface                 | 생성·직접편집·AI편집·미리보기·저장의 DocumentState 단일화   |
| ADR-02  | 임의 HWPX 분석+Template Profile+Prototype Clone   | 양식별 문단·표·개요 Prototype을 분석·사용자 확인 후 적용    |
| ADR-03  | AI는 의미/내용만 생성                             | HWPX XML·style ID·기호·공백은 UNE 엔진이 적용               |
| ADR-04  | Selection/ChangeSet/Diff/Undo                     | 안정 ID·revision·잠금으로 사용자수정 보호                   |
| ADR-05  | 계획서 T3Q RPT-001/002 전용                       | UNI fallback·챗봇 API 금지                                  |
| ADR-06  | 상황일지 POC UNI 사용                             | Upload/Search/chat-json/chat을 Backend Operation으로 사용   |
| ADR-07  | 전파 UNE 내부모듈                                 | T3Q/UNI를 상황·임무 전파 API로 사용하지 않음                |
| ADR-08  | SituationFact/Snapshot 사실관리                   | 외부/LLM 응답 자동확정 금지                                 |
| ADR-09  | KMA/MOIS 우선, 웹 보조 격리                       | SafeKorea on-demand, Naver 사용자 요청형/기본 OFF           |
| ADR-10  | Execution Log 사실원장                            | 상황일지는 Projection 파생문서                              |
| ADR-11  | SituationProviderPort와 T3Q Adapter 조건부 활성화 | T3Q API 미확정에도 개발 진행                                |
| ADR-12  | UNE JournalProjection 소유                        | RPT-003은 선택적 Narrative Adapter                          |
| ADR-13  | UniSopMapper ACL                                  | compns SSE를 versioned Mapping Profile로 변환               |
| ADR-14  | 웹수집 운영승인 Gate                              | 상시 크롤링 금지, Flag OFF·fallback                         |
| ADR-15  | rhwp 특정 소스 아카이브 UNE 내부 반입             | Fork 대신 tag/commit+SHA-256+third_party+Adapter/Patch 관리 |
| ADR-16  | 한컴 HWPX 호환성 배포 승인                        | 운영 저장 기능이 아닌 CI+QA Round-trip Gate                 |
| ADR-17  | ChannelPort+Transactional Outbox                  | System/Simulation 필수, 실채널 Adapter 조건부               |
| ADR-18  | 기관독립 Scenario Pack                            | 태풍·호우/붕괴사고 기준, Institution Binding                |

## 2.2 ADR-15 정정 반영: Fork가 아닌 소스 다운로드·내부 반입

**1.** POC Gate를 통과한 특정 Release Tag 또는 Commit SHA의 소스 아카이브를 다운로드한다.

**2.** 다운로드 URL·일시·Commit SHA·SHA-256·빌드 Toolchain·의존버전을 UPSTREAM_VERSION.md에 기록한다.

**3.** 원본 소스는 UNE 내부 Git 저장소의 third_party/rhwp에 반입하고 UNE Adapter와 patch queue를 별도 영역으로 분리한다.

**4.** 원본 수정은 Adapter로 해결할 수 없는 경우에 한해 Patch ID, 영향파일, 사유, 시험범위, upstream issue/PR과 함께 수행한다.

**5.** 업스트림 최신본을 자동 병합하거나 floating main/latest package를 운영 빌드에 사용하지 않는다.

**6.** MIT LICENSE, THIRD_PARTY_LICENSES, SBOM, 금지 폰트 미포함, dependency checksum을 배포 산출물에 포함한다.

## 2.3 ADR-16 정정 반영: 한컴 Round-trip은 운영 기능이 아닌 배포 승인 절차

| **중요 경계** 사용자가 HWPX를 저장할 때 서버가 한컴오피스를 자동 실행하는 구조를 구현하지 않는다. 일반 저장은 UNE Package/Schema/Reference/Semantic/Style/rhwp 재열기 자동검증으로 처리하고, 한컴 열기→저장→종료→재열기→비교는 Serializer·Adapter·양식지원 변경과 Release Candidate 시점의 개발·QA·배포 승인 절차로 수행한다. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 2.4 변경 통제

• T3Q 상황정보 API, RPT-003, 문자·메일·방송 채널, 실증기관, 한컴 시험환경이 확정되어도 기존 ADR을 삭제·덮어쓰지 않는다.

• 기존 Canonical Model과 소유권을 유지한 채 Adapter 활성화·Mapping Profile·Institution Binding·환경 기준선 변경으로 수용한다.

• 공통 도메인·사실원장·문서 호환성 기준을 변경해야 하는 경우에만 신규 ADR 또는 AMENDED/SUPERSEDED 상태로 개정한다.

# 3. 개발 대상 시스템과 Work Package

## 3.1 목표 아키텍처 개발단위

| **계층**        | **구성**                                                                                                 |
|-----------------|----------------------------------------------------------------------------------------------------------|
| Presentation    | React 통합 Workspace, rhwp Editor, 상황등록, SOP Designer, 지휘/담당자 화면, 전자상황판, 상황일지        |
| Application     | UNE Backend/API Gateway, Auth/RBAC, Job/SSE, Document Orchestrator, Workflow, JournalProjection          |
| Document Engine | rhwp source intake, HWPX Package Reader, Document IR, TemplateAnalyzer, ChangeSet, Serializer, Validator |
| Integration     | T3Q Plan Adapter, Situation Providers, UNI Gateway/Mapper, ChannelPort, Object Store                     |
| Data            | PostgreSQL, immutable versions, append-only Execution Log, raw payload/evidence/object refs              |
| Quality         | Contract/E2E, Golden Corpus, CI Track A, Hancom Track B, Security/Performance/Resilience                 |

## 3.2 Work Package 목록

| **WP**            | **Work Package**                                             | **주담당**        | **기간** | **Gate** | **작업수** | **ADR**            |
|-------------------|--------------------------------------------------------------|-------------------|----------|----------|------------|--------------------|
| WP-ADR-BASE       | ADR·기준선·추적성 관리                                       | PM/ARCH           | S0~S11   | G0       | 10         | ADR-01~18          |
| WP-PLATFORM-BASE  | 통합플랫폼 공통 기반                                         | ARCH/FE/BE/DEVOPS | S0~S7    | G1/G3    | 13         | ADR-01,05~09,11~18 |
| WP-HWPX-CORE      | rhwp 소스 반입·HWPX Package·Document IR 기반                 | DOC/ARCH/DEVOPS   | S1~S4    | G2       | 12         | ADR-01~04,15       |
| WP-HWPX-ANALYZE   | 임의 HWPX Template Analyzer·Prototype Registry               | DOC/BE/FE         | S2~S5    | G2/G3    | 10         | ADR-02,03,15       |
| WP-HWPX-EDIT      | rhwp 단일 편집 Surface·Selection·ChangeSet                   | DOC/FE/BE         | S3~S8    | G3       | 13         | ADR-01,03,04       |
| WP-HWPX-SERIALIZE | 보존형 HWPX 저장·Reference Rebuild·Export                    | DOC/BE            | S4~S9    | G2/G4    | 10         | ADR-03,15,16       |
| WP-HWPX-QA        | 한컴 HWPX 호환성 Round-trip·배포 승인                        | QA/DOC/DEVOPS     | S3~S11   | G4       | 11         | ADR-16             |
| WP-PLAN-T3Q       | 재난안전계획서 T3Q RPT-001/002 연계·생성                     | BE/FE/DOC         | S1~S8    | G1/G3    | 12         | ADR-01,03~05       |
| WP-SITUATION      | SituationContext·공식 Provider·Snapshot                      | BE/FE/ARCH        | S2~S8    | G1/G3    | 15         | ADR-08,09,11,14    |
| WP-UNI-RAG        | UNI Upload/Search/chat-json·SOP Mapper POC                   | BE/FE/ARCH        | S2~S7    | G2/G3    | 13         | ADR-06,13          |
| WP-WORKFLOW       | SOP 정의·실행·Task·Execution Log                             | BE/FE/ARCH        | S4~S9    | G3       | 12         | ADR-07,10,12,17,18 |
| WP-PROPAGATION    | 전파 Outbox·ChannelPort·수신상태                             | BE/FE/DEVOPS      | S5~S10   | G3       | 11         | ADR-07,17          |
| WP-JOURNAL        | Execution Log 기반 상황일지 Projection·HWPX                  | BE/FE/DOC         | S6~S10   | G3/G4    | 12         | ADR-06,10,12       |
| WP-SCENARIO       | 사용자 시나리오·안전한국훈련 Reference Scenario·기관 Binding | PM/ARCH/UX/QA     | S1~S10   | G3/G5    | 13         | ADR-18 및 전 ADR   |
| WP-UI             | React 통합 Workspace·화면·상태·권한·오류                     | FE/UX/BE          | S2~S10   | G3       | 16         | ADR-01,04,11~18    |
| WP-API-DB-SEQ     | 화면·API·DB·Sequence 상세설계                                | ARCH/BE/FE/DOC    | S2~S9    | G1/G3    | 12         | ADR-01~18          |
| WP-INTEGRATION-QA | 통합·보안·성능·실증·인수·배포                                | QA/PM/전팀        | S4~S11   | G3~G6    | 17         | ADR-01~18          |

## 3.3 Repository 및 코드 경계

| **경로**                  | **책임**                                                     |
|---------------------------|--------------------------------------------------------------|
| apps/document-workspace   | React 통합 UI, rhwp Adapter 소비                             |
| services/une-api          | 인증·RBAC·Document/Situation/SOP/Journal API                 |
| services/workflow-worker  | Workflow, Outbox, Channel Dispatcher, Escalation             |
| modules/une-rhwp-adapter  | rhwp 원시 API 격리                                           |
| modules/hwpx-engine       | Package/IR/Analyzer/ChangeSet/Serializer/Validator           |
| modules/provider-adapters | T3Q, KMA, MOIS, SafeKorea, UNI, Channel adapters             |
| schemas                   | JSON Schema, OpenAPI, fixtures, mapping profiles, migrations |
| third_party/rhwp          | 다운로드·해시검증한 원본 소스 반입본                         |
| patches/rhwp              | Adapter로 해결 불가한 최소 패치와 Patch Ledger               |
| tests/golden-corpus       | HWPX·Provider·Scenario Golden Corpus                         |
| evidence                  | testRunId 기준 검증증거 및 승인보고서                        |

# 4. 개발수행·형상·변경·품질 관리계획

## 4.1 개발 생명주기와 Gate

| **Gate**        | **통과조건**                                      | **증거**                             | **실패처리**                         |
|-----------------|---------------------------------------------------|--------------------------------------|--------------------------------------|
| G0 기준선       | ADR v1.1, 개발계획/WBS, Register 승인             | ADR Register, WBS, Change Log        | 미통과 시 신규 개발 기준선 반영 금지 |
| G1 Contract     | Canonical Schema/Port/OpenAPI/fixture 검증        | Schema Bundle, Contract Test         | Mapper/API 수정                      |
| G2 POC          | HWPX Core/Serializer, UNI SOP, Provider 위험 제거 | POC Report, 결함·대안                | 범위·대안 ADR                        |
| G3 E2E          | 사용자 시나리오 종단 검증                         | E2E 결과·로그·증거                   | 결함 Backlog·재시험                  |
| G4 HWPX 호환    | CI Track A + 한컴 Track B                         | ValidationReport/RT-A~G              | RC 배포 보류                         |
| G5 실증 Binding | 기관·재난유형·조직·자료·연계·평가 동결            | InstitutionProfile/Scenario Baseline | Simulation 유지                      |
| G6 인수         | 전 Gate와 산출물·품질·실증 증명                   | 인수시험서/승인서/Release Package    | 보완 후 재시험                       |

## 4.2 Sprint 운영

• Sprint 시작: 기준선·선행조건·Definition of Ready·외부의존성·시험 fixture 확인

• Sprint 중간: 설계·코드·Schema 동시 검토, 장애·결함·CR 영향분석, 완료증거 선행 생성

• Sprint 종료: Demo, 자동시험, 기준선 점검, WBS 진척, 위험/의존성 갱신, 다음 Sprint Gate 준비

• POC와 상세설계는 병행하되 POC 결과는 HWPX/UNI/Provider 명세와 Schema Bundle에 즉시 환류한다.

## 4.3 Definition of Ready

• 대응 ADR·사용자 시나리오·Actor·권한이 식별됨

• 입력/출력 Schema 또는 fixture가 존재함

• 선행 WBS와 환경·Secret·Mock 준비상태가 확인됨

• 정상·대안·오류·취소·재시도·권한 Test 조건이 정의됨

• 산출물과 Definition of Done·Evidence 위치가 지정됨

## 4.4 공통 Definition of Done

• 코드리뷰·정적분석·단위/Contract 테스트 통과

• OpenAPI/Schema/DB migration/화면상태·오류가 동기화됨

• ADR-WP-US-SCR-API/DB-SEQ-TC/E2E 추적 링크 완료

• 감사·보안·권한·실패격리·재시도·멱등 규칙 반영

• testRunId, 로그, fixture, screenshot/hash/ValidationReport 등 인수증거 저장

• 문서와 코드의 버전·해시·변경이력이 기준선 Register에 반영

## 4.5 형상·브랜치·릴리스

| **브랜치/영역**     | **운영규칙**                               |
|---------------------|--------------------------------------------|
| main                | 승인된 통합 기준선, 직접 push 금지         |
| develop/integration | Sprint 통합 및 Alpha/Beta                  |
| feature/\<wbs-id\>  | WBS 단위 구현·PR 제목에 WBS/ADR 표기       |
| release/\<version\> | RC 동결, HWPX Track A/B 및 인수증거 생성   |
| hotfix/\<issue\>    | 승인된 치명결함, 동일 회귀·증거 필수       |
| third_party/rhwp    | 고정 반입본, 원본 변경은 Patch Ledger 경유 |

## 4.6 외부의존성 미수신 원칙

| **의존성**           | **일정영향**         | **미수신 기본처리**                                                 |
|----------------------|----------------------|---------------------------------------------------------------------|
| T3Q RPT-001/002      | 계획서 기능 Critical | Mock/Recorded fixture로 UI·Contract 개발, 실제 Adapter Gate 후 활성 |
| T3Q 상황정보/RPT-003 | 비Critical           | UNE Provider/Projection 유지, 향후 Adapter 비교                     |
| UNI 실응답           | POC 연결 필요        | Recorded SSE fixture와 Mapping Profile로 선행개발                   |
| SMS/Email/Broadcast  | 실채널만 조건부      | System/Simulation으로 전체 E2E                                      |
| 실증기관             | G5 필요              | Mock Org/Reference Scenario로 개발                                  |
| Windows/한컴         | G4 필요              | Track A 계속, RC 배포만 보류                                        |

# 5. Work Package별 상세 개발계획

## 5.1 WP-ADR-BASE ADR·기준선·추적성 관리

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>ADR-01~18 및 v0.9 설계를 개발팀이 사용할 수 있는 기준선으로 동결하고 변경·증거·추적체계를 운영한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>PM/ARCH</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-01~18</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S0~S11<br />
2026.07.27~2026.12.31</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G0</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>10</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-ADR-BASE-01 ADR v1.1 정정본 확정: ADR-15를 특정 Tag/Commit 소스 다운로드·UNE 내부 저장소 반입 방식으로 정정하고 ADR-16을 운영기능이 아닌 한컴 호환성 배포 승인 절차로 명확화한다.

• WP-ADR-BASE-02 기준문서 Register 작성: Master 설계, Contract, HWPX 명세, SituationContext 명세, ADR, Schema Bundle의 우선순위·버전·승인상태를 등록한다.

• WP-ADR-BASE-03 OPEN/ADR Register 폐쇄 검증: OPEN-01~08과 ADR-11~18의 대응관계, 조건부 Trigger 및 Change Request 전환규칙을 재검토한다.

• WP-ADR-BASE-04 추적성 식별체계 정의: ADR→WP→US→SCR→API/DB→SEQ→TC/E2E→Evidence의 ID 규칙과 양방향 링크 필드를 정의한다.

• WP-ADR-BASE-05 변경요청·ADR 개정 절차 수립: 외부 API·실증기관·채널·한컴환경 변경 시 기존 ADR 덮어쓰기 없이 CR 또는 신규 ADR로 처리하는 승인절차를 수립한다.

• WP-ADR-BASE-06 Schema/OpenAPI 저장소 골격: JSON Schema, OpenAPI, fixture, mapping profile, migration, contract test를 버전별로 관리할 디렉터리와 CI 검증 규칙을 구성한다.

• WP-ADR-BASE-07 Evidence Repository 구성: 시험 원본·결과·로그·스크린샷·해시·ValidationReport를 testRunId로 묶어 보존하는 구조와 보관기간을 정의한다.

• WP-ADR-BASE-08 외부의존성 Register 운영: T3Q, UNI, 실증수요처, 채널제공자, Windows/한컴 시험환경의 요청사항·기한·대체처리를 등록한다.

• WP-ADR-BASE-09 개발계획서·상세 WBS 승인: 본 개발계획과 WBS의 일정·선행조건·산출물·DoD·Gate·책임을 검토하고 개발 착수 기준선으로 승인한다.

• WP-ADR-BASE-10 기준선 정기점검: 매 Sprint 종료 시 설계·코드·Schema·시험증거 간 버전 불일치와 미승인 변경을 점검한다.

### Work Package 완료 기준

• 미수신 항목이 WBS를 중단시키지 않고 Mock/Stub/Simulation 처리와 연결된다.

• WP와 세부작업이 전부 식별되고 G0 체크리스트가 승인된다.

• Sprint별 기준선 점검기록과 조치결과가 남고 미추적 변경 0건을 유지한다.

## 5.2 WP-PLATFORM-BASE 통합플랫폼 공통 기반

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>React 통합 Workspace와 UNE Backend의 인증·권한·Job·SSE·파일·감사·Feature Flag 기반을 제공한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>ARCH/FE/BE/DEVOPS</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-01,05~09,11~18</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S0~S7<br />
2026.07.27~2026.11.06</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G1/G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>13</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-PLATFORM-BASE-01 Monorepo 구조 확정: apps, services, modules, schemas, third_party, patches, tests, evidence 영역을 분리하고 소유권을 정의한다.

• WP-PLATFORM-BASE-02 CI/CD 파이프라인 구성: Frontend, Backend, Rust/WASM, Schema, unit/contract test, SBOM, artifact 서명을 단계별로 실행한다.

• WP-PLATFORM-BASE-03 환경·Secret 관리: local/dev/test/rc 환경설정, Secret Vault, API key rotation, Feature Flag profile을 정의한다.

• WP-PLATFORM-BASE-04 T3Q 진입 토큰 연계: 메인 플랫폼 로그인 후 전달되는 T3Q 토큰의 검증·세션·만료·권한 매핑·로그아웃 동작을 구현한다.

• WP-PLATFORM-BASE-05 RBAC 공통모듈: DOCUMENT_EDITOR, SITUATION_EDITOR/APPROVER, SOP_DESIGNER/APPROVER, COMMANDER, ASSIGNEE, ADMIN, AUDITOR 권한을 구현한다.

• WP-PLATFORM-BASE-06 감사·상관관계 로그: correlationId, user, role, operation, entity/revision, provider, result, error를 구조화 로그로 남긴다.

• WP-PLATFORM-BASE-07 비동기 Job 공통모델: PENDING/RUNNING/COMPLETED/FAILED/CANCELLED와 progress, retry, resultRef를 지원한다.

• WP-PLATFORM-BASE-08 SSE/Event Gateway: generation.status/block, workflow.task, incident.timeline 이벤트의 인증·재연결·lastEventId·backpressure를 구현한다.

• WP-PLATFORM-BASE-09 파일·Object Store 추상화: HWPX·참조문서·raw payload·증거·export 파일의 메타데이터와 Object Store 경로를 분리한다.

• WP-PLATFORM-BASE-10 Feature Flag 관리: Provider, Web Collector, Naver, 실채널, 실증 Binding을 환경·기관별로 활성화하는 관리기능을 구현한다.

• WP-PLATFORM-BASE-11 오류 taxonomy·사용자 메시지: Provider, Mapping, HWPX, Round-trip, Workflow, Propagation 오류코드와 사용자·운영 메시지를 분리한다.

• WP-PLATFORM-BASE-12 공통 상태·알림 컴포넌트: 대기/진행/완료/오류/제한/승인대기 상태, Toast, Banner, Blocking Modal을 표준화한다.

• WP-PLATFORM-BASE-13 공통 기반 통합시험: Auth-RBAC-Job-SSE-File-Flag-Audit의 종단 동작과 장애복구를 검증한다.

### Work Package 완료 기준

• 재시도 가능 여부·HTTP/SSE 상태·운영로그 필드가 일관되고 민감정보를 노출하지 않는다.

• 각 화면이 동일 상태·오류 용어를 사용하고 접근성 속성을 포함한다.

• 세션만료·권한부족·SSE 재연결·파일권한·Flag OFF 시나리오가 통과한다.

## 5.3 WP-HWPX-CORE rhwp 소스 반입·HWPX Package·Document IR 기반

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>검증된 rhwp 소스 반입본을 재현 가능하게 구축하고 보존형 HWPX Package Reader와 Canonical Document IR을 구현한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>DOC/ARCH/DEVOPS</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-01~04,15</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S1~S4<br />
2026.08.03~2026.09.25</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G2</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>12</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-HWPX-CORE-01 upstream Tag/Commit 후보 선정: rhwp 기능·이슈·의존성·라이선스·빌드 가능성을 비교해 POC 대상 Tag/Commit을 선정한다.

• WP-HWPX-CORE-02 소스 아카이브 다운로드·무결성: 선정 Tag/Commit의 ZIP/TAR 소스를 다운로드하고 SHA-256, 다운로드 URL, 일시를 기록한다.

• WP-HWPX-CORE-03 UNE 내부 저장소 반입: 원본을 third_party/rhwp에 반입하고 원본수정 금지영역·Adapter·patch queue를 분리한다.

• WP-HWPX-CORE-04 라이선스·SBOM·의존성 감사: MIT 고지, third-party license, npm/cargo lock, 취약점·checksum을 점검한다.

• WP-HWPX-CORE-05 Rust/WASM 재현빌드: 고정 toolchain과 lock file로 core/editor WASM을 빌드하고 artifact hash를 생성한다.

• WP-HWPX-CORE-06 UNE rhwp Adapter 골격: Editor lifecycle, command, selection, document state, event를 감싸는 Adapter 인터페이스를 구현한다.

• WP-HWPX-CORE-07 HWPX 업로드 보안검증: ZIP signature, mimetype, content.hpf, 필수 Part, entry 수/크기, path traversal, DTD/XXE를 검사한다.

• WP-HWPX-CORE-08 Header Reference Index: paraPr/charPr/style/numbering/bullet/binData 참조표를 색인한다.

• WP-HWPX-CORE-09 Canonical Document IR: Document/Section/Paragraph/Run/Table/StyleRef/UnknownPart와 rawXmlAnchor를 구현한다.

• WP-HWPX-CORE-10 미지원 Part·객체 보존맵: 알 수 없는 XML·namespace·control·relationship을 raw fragment로 보존한다.

• WP-HWPX-CORE-11 호환성 등급 판정: NATIVE_EDIT/PRESERVE_ONLY/FLATTEN_EXPORT_ONLY/REJECT 기준과 경고·저장차단 정책을 구현한다.

• WP-HWPX-CORE-12 HWPX Core POC Gate: 샘플 10종 이상을 열고 IR 생성·렌더·재열기·호환성 보고서를 작성한다.

### Work Package 완료 기준

• 주변 문단을 읽어도 미지원 Part hash와 관계정보가 유지된다.

• Golden 샘플별 판정근거가 재현되고 손실위험 문서는 저장이 차단된다.

• G15-1 기본요건과 보안검증을 통과하고 다음 단계 결함목록이 확정된다.

## 5.4 WP-HWPX-ANALYZE 임의 HWPX Template Analyzer·Prototype Registry

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>최소양식과 완성문서의 개요·서식·표·정적영역을 분석하여 Template Profile과 검증된 Prototype을 생성한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>DOC/BE/FE</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-02,03,15</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S2~S5<br />
2026.08.17~2026.10.09</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G2/G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>10</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-HWPX-ANALYZE-01 Template Profile Schema: pageProfile, styleRoles, numbering/table profile, anchors, compatibility, confidence 구조를 확정한다.

• WP-HWPX-ANALYZE-02 문단·글자 서식 특징 추출: 문단위치, paraPr/charPr, 글꼴·크기·정렬·간격·indent·prefix 패턴을 특징벡터로 추출한다.

• WP-HWPX-ANALYZE-03 OutlinePatternAnalyzer: 문자형 □/○/―, 자동번호, level, 선행공백, hanging indent, Enter/Tab 규칙을 분석한다.

• WP-HWPX-ANALYZE-04 Paragraph Prototype Registry: TITLE/HEADING/OUTLINE/NOTE/BODY 역할별 원본문단 Prototype과 clone 규칙을 등록한다.

• WP-HWPX-ANALYZE-05 Table Prototype Registry: 표·셀 병합·테두리·배경·너비·셀 내부문단의 Prototype과 반복행 규칙을 등록한다.

• WP-HWPX-ANALYZE-06 StaticRegionClassifier: 머리말·꼬리말·표지·결재란·고정문구·필드를 편집금지/제한영역으로 분류한다.

• WP-HWPX-ANALYZE-07 신뢰도·사용자 확인 규칙: AUTO/CONFIRM/LIMITED/REJECT 신뢰도 임계치와 확인 항목 최소화를 정의한다.

• WP-HWPX-ANALYZE-08 양식 분석 API: 업로드→분석 Job→결과/경고→사용자 확인→Profile 확정 API를 구현한다.

• WP-HWPX-ANALYZE-09 양식 확인 UI: 역할 후보·개요패턴·제한객체·미리보기·확정/수정 화면을 구현한다.

• WP-HWPX-ANALYZE-10 분석 Golden Corpus 검증: 최소양식·완성문서·문자개요·자동번호·표·미지원 객체 문서로 정확도와 재현성을 평가한다.

### Work Package 완료 기준

• 취소·재시도·버전·audit가 적용되고 확정 Profile은 immutable version으로 저장된다.

• 사용자가 문단 역할을 바꾸면 Profile revision과 변경근거가 저장된다.

• G15-1/2가 통과하고 오분류·제한항목이 결함목록에 등록된다.

## 5.5 WP-HWPX-EDIT rhwp 단일 편집 Surface·Selection·ChangeSet

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>사용자 직접편집과 AI 편집을 같은 rhwp Workspace에서 안정 ID·revision·Diff·Undo로 처리한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>DOC/FE/BE</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-01,03,04</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S3~S8<br />
2026.08.31~2026.11.20</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>13</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-HWPX-EDIT-01 Editor Workspace Embed: rhwp Editor를 React Workspace에 삽입하고 문서 로드·저장·상태동기화 경계를 구현한다.

• WP-HWPX-EDIT-02 SelectionContext 모델: Cursor/Text Range/Block/Section 선택을 paragraphId·runId·UTF-16 offset·revision으로 정규화한다.

• WP-HWPX-EDIT-03 SelectionResolver: DOM/editor selection을 Document IR 범위로 변환하고 경계·정적영역·잠금·표셀 범위를 검증한다.

• WP-HWPX-EDIT-04 DocumentCommand 모델: Insert/Replace/Delete/Split/Merge/SetRole/ClonePrototype/Table operation 명령을 정의한다.

• WP-HWPX-EDIT-05 ChangeSetExecutor: baseRevision·selectionSnapshotHash를 확인하고 여러 명령을 원자적으로 적용한다.

• WP-HWPX-EDIT-06 Revision 충돌 처리: 사용자 편집 중 AI 결과 도착, 문서 재로드, 다른 Job 완료 시 충돌 탐지·재기준·취소 흐름을 구현한다.

• WP-HWPX-EDIT-07 Diff Viewer: Block/Section 단위 추가·삭제·교체·서식역할 변화를 비교하고 선택적 적용을 지원한다.

• WP-HWPX-EDIT-08 Undo/Redo Stack: 직접편집과 ChangeSet을 동일 이력으로 관리하고 세션 내 Undo/Redo·저장기준점을 구현한다.

• WP-HWPX-EDIT-09 generation lock: AI 생성대상 Block/Section 잠금, 완료영역 즉시편집, 중지·취소·실패 해제를 구현한다.

• WP-HWPX-EDIT-10 개요 Enter/Tab/Shift+Tab: 문자형/자동번호 개요의 새 문단, level 이동, prefix/indent 상속을 구현한다.

• WP-HWPX-EDIT-11 표 직접편집: 셀 텍스트, 행 추가/삭제, 병합범위 제한, Prototype 기반 표 삽입을 구현한다.

• WP-HWPX-EDIT-12 AI Operation→ChangeSet 매핑: GENERATE_SECTION/REWRITE/EXPAND/SUMMARIZE/CONVERT_TO_TABLE 결과를 검증 후 명령으로 변환한다.

• WP-HWPX-EDIT-13 편집 E2E 검증: 직접편집·AI편집·충돌·잠금·Diff·Undo·개요·표 시나리오를 통합 검증한다.

### Work Package 완료 기준

• 지원 범위 내 span/border/width가 유지되고 미지원 조작은 제한 메시지를 제공한다.

• AI 응답에 HWPX XML/style ID가 없어도 Prototype과 styleRole로 정확히 반영된다.

• G15-3와 E2E-16을 통과하고 사용자수정 손실 0건이다.

## 5.6 WP-HWPX-SERIALIZE 보존형 HWPX 저장·Reference Rebuild·Export

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>Document IR 변경분만 최소 저장하고 참조·미지원 객체·원본 Part를 보존한 HWPX를 생성한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>DOC/BE</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-03,15,16</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S4~S9<br />
2026.09.14~2026.12.04</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G2/G4</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>10</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-HWPX-SERIALIZE-01 XML Delta Writer: 변경 Paragraph/Table만 XML에 반영하고 rawXmlAnchor 기준으로 원본 순서·namespace를 보존한다.

• WP-HWPX-SERIALIZE-02 Reference Rebuilder: paraPr/charPr/style/numbering/bullet/binData/relationship 참조를 재색인·검증한다.

• WP-HWPX-SERIALIZE-03 Package Writer: mimetype 우선순위, content.hpf, 관계파일, 압축방식, 원본 Part·unknown Part를 패키징한다.

• WP-HWPX-SERIALIZE-04 Prototype Clone 저장: 새 문단·표에 원본 Prototype styleRef와 literalPrefix·indent·numbering을 적용한다.

• WP-HWPX-SERIALIZE-05 미지원 객체 보존·저장차단: PRESERVE_ONLY 객체는 원문 복사하고 손실가능 상태는 원본 HWPX 저장을 차단한다.

• WP-HWPX-SERIALIZE-06 Save API·Revision: documentId/baseRevision/targetFormat/idempotencyKey를 받아 원자적 저장·버전·hash를 생성한다.

• WP-HWPX-SERIALIZE-07 PDF/DOCX 보조 Export: HWPX가 최종 원본임을 유지하면서 PDF 미리보기·인쇄와 DOCX 보조 Export 경계를 구현한다.

• WP-HWPX-SERIALIZE-08 자동 ValidationReport: Package/Schema/Reference/Semantic/Style/Compatibility 검증결과와 diff artifact를 생성한다.

• WP-HWPX-SERIALIZE-09 저장 성능 최적화: 50쪽 일반문서의 저장·재열기·메모리 사용을 측정하고 XML 전체재작성 병목을 개선한다.

• WP-HWPX-SERIALIZE-10 Serializer 통합 Gate: 원본→편집→저장→rhwp 재열기와 무편집/편집/미지원 객체 Corpus를 검증한다.

### Work Package 완료 기준

• 치명오류 시 다운로드/승인이 차단되고 경고·허용항목이 구분된다.

• 목표치와 실측치·병목·허용범위가 기록되고 치명 메모리 누수가 없다.

• G15-4 통과, 텍스트·표·필드 손실 0, 한컴 Track B 대상 RC가 생성된다.

## 5.7 WP-HWPX-QA 한컴 HWPX 호환성 Round-trip·배포 승인

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>상시 자동검증과 지정 Windows/한컴 환경의 열기·저장·재열기 회귀시험을 분리하고 Release 승인 증거를 축적한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>QA/DOC/DEVOPS</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-16</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S3~S11<br />
2026.08.31~2026.12.31</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G4</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>11</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-HWPX-QA-01 Golden Corpus 선정: 최소양식, 완성문서, 문자개요, 자동번호, 표/병합, 이미지/수식/필드/미지원 객체 문서를 버전관리한다.

• WP-HWPX-QA-02 Track A CI Suite: ZIP/XML/Schema/Reference/Semantic/rhwp reopen/visual diff/editor E2E를 자동화한다.

• WP-HWPX-QA-03 Visual Diff Mask: 변경대상 Block의 허용영역 mask와 비대상 페이지·표·폰트 회귀 판정규칙을 구현한다.

• WP-HWPX-QA-04 Windows/한컴 시험환경 기준선: OS/locale/배율/해상도/한컴 build/폰트 manifest/VM snapshot과 정식 사용권을 확정한다.

• WP-HWPX-QA-05 RT-A 무편집 저장 시험: 원본→rhwp open/save→한컴 open의 무손실·경고·복구 여부를 검증한다.

• WP-HWPX-QA-06 RT-B AI 삽입 양방향 시험: Analyze→AI insert→save→한컴 open/save→rhwp reopen의 Prototype 상속과 양방향 호환성을 검증한다.

• WP-HWPX-QA-07 RT-C/D/E 구조편집 시험: 표/병합, 문자개요, 자동번호 추가·삭제의 저장·재열기 회귀를 검증한다.

• WP-HWPX-QA-08 RT-F/G 보존·사용자보호 시험: 미지원 객체 주변편집과 사용자수정 Block+Section 재생성에서 원문객체·잠금영역 불변을 검증한다.

• WP-HWPX-QA-09 Round-trip 결과판정·결함관리: 치명/주요/허용차이를 분류하고 source/output/resave/diff/report를 testRunId로 묶는다.

• WP-HWPX-QA-10 운영기능 비포함 검증: 일반 사용자 저장 요청이 한컴 GUI/Windows Agent를 호출하지 않고 UNE 자동검증만 수행하는지 검증한다.

• WP-HWPX-QA-11 RC 배포 승인: 최종 RC의 Track A/Track B 전 Corpus 결과와 환경·폰트·hash를 검토해 배포 승인한다.

### Work Package 완료 기준

• 실패가 재현 가능하고 배포 보류·재시험·예외승인 권한이 정의된다.

• 운영 API/로그에 한컴 호출이 0건이며 Track B는 QA 파이프라인에서만 실행된다.

• 치명손실 0, 미해결 예외 승인 0 또는 공식 승인, 증거 bundle 완비 시 통과한다.

## 5.8 WP-PLAN-T3Q 재난안전계획서 T3Q RPT-001/002 연계·생성

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>계획서 목차·본문 생성은 T3Q 전용 API만 사용하고 구조화 결과를 rhwp 단일 편집 Surface에 반영한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>BE/FE/DOC</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-01,03~05</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S1~S8<br />
2026.08.03~2026.11.20</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G1/G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>12</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-PLAN-T3Q-01 RPT-001/002 명세 기준선: Endpoint, 인증, 요청/응답, Job/SSE, 오류, 샘플을 수집하고 2차년도 요구사항과 Gap을 정리한다.

• WP-PLAN-T3Q-02 T3Q Plan Adapter: T3Q 원시 스키마를 UNE Document AI Contract의 Outline/Block으로 변환하는 Adapter를 구현한다.

• WP-PLAN-T3Q-03 인증·Timeout·Circuit: T3Q 토큰 전달, service credential, timeout, retry, circuit breaker, correlationId를 구현한다.

• WP-PLAN-T3Q-04 목차 요청 매핑: 기준정보, 재난유형, 관리단계, 목적, 역할, 독자, 지침, 표현규칙을 RPT-001 요청으로 변환한다.

• WP-PLAN-T3Q-05 목차 응답 검증·편집: 중복/순환/깊이/빈 제목을 검증하고 Outline Editor에서 추가·수정·삭제·재요청을 지원한다.

• WP-PLAN-T3Q-06 본문 생성 Job: 확정 목차와 기준정보를 RPT-002로 전송하고 Section/Block 단위 진행·중지·재시도를 관리한다.

• WP-PLAN-T3Q-07 부분결과·완료영역 반영: 완료된 Section/Block을 rhwp DocumentState에 즉시 ChangeSet으로 반영하고 generation lock을 해제한다.

• WP-PLAN-T3Q-08 취소·재생성·사용자보호: Job 취소, Section 재생성, baseRevision 충돌, 사용자 수정 Block 보호와 Diff 적용을 구현한다.

• WP-PLAN-T3Q-09 Citation·근거 표시: T3Q가 제공한 근거를 EvidenceRef로 변환하고 문장/Block에 연결하며 미제공 상태를 warning으로 표시한다.

• WP-PLAN-T3Q-10 계획서 저장·Export 연결: 생성·편집 결과를 Template Prototype으로 HWPX 저장하고 PDF/DOCX 보조 Export에 연결한다.

• WP-PLAN-T3Q-11 계획서 오류·복구 UX: T3Q 장애·Schema 오류·부분실패·인증만료에서 수동편집·기존문서 저장은 유지하도록 구현한다.

• WP-PLAN-T3Q-12 UNI 미호출 통합검증: 계획서 목차·본문·재생성 흐름에서 UNI endpoint와 챗봇 API 호출이 발생하지 않음을 로그로 검증한다.

### Work Package 완료 기준

• 목차·본문·사용자편집이 동일 revision의 HWPX에 반영된다.

• 외부장애가 편집기 전체를 중단시키지 않고 재시도 가능 범위가 명확하다.

• 계획서 E2E의 외부호출이 RPT-001/002로 제한되고 위반 0건이다.

## 5.9 WP-SITUATION SituationContext·공식 Provider·Snapshot

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>현재 재난상황을 원천 Fact 후보와 사용자 확정 Snapshot으로 관리하고 외부 Provider 장애와 충돌을 격리한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>BE/FE/ARCH</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-08,09,11,14</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S2~S8<br />
2026.08.17~2026.11.20</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G1/G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>15</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-SITUATION-01 SituationContext Schema: contextId, incidentId, mode, revision, location, timeWindow, facts, conflicts, providerStatus, snapshot을 확정한다.

• WP-SITUATION-02 Incident/Context CRUD: 실재난·훈련 mode, 기본정보, revision, 상태전이를 구현한다.

• WP-SITUATION-03 SituationFact Provenance: observedAt/issuedAt/retrievedAt, provider, sourceId/url/hash, parserVersion, rawPayloadRef를 저장한다.

• WP-SITUATION-04 사용자 직접입력·현장보고: 기상·특보·피해·통제·현장보고·대응단계를 수동 입력하고 증거파일을 첨부한다.

• WP-SITUATION-05 KMA Forecast Adapter: 공식 예보 응답을 WEATHER_FORECAST/OBSERVATION Fact 후보로 변환한다.

• WP-SITUATION-06 KMA Warning Adapter: 기상특보 발효·해제·수정·지역을 WEATHER_WARNING Fact 후보로 변환한다.

• WP-SITUATION-07 MOIS Message Adapter: 재난문자 식별자·발송시각·지역·본문·분류를 DISASTER_MESSAGE로 변환한다.

• WP-SITUATION-08 Normalizer·Deduplicator: Provider별 단위·코드·지역·재난유형을 canonical로 변환하고 중복그룹을 만든다.

• WP-SITUATION-09 Freshness·Reliability 정책: Fact category별 TTL, CURRENT/STALE/EXPIRED, 공식/보조/사용자 신뢰도 표시를 구현한다.

• WP-SITUATION-10 ProviderStatus·Circuit: 마지막 성공시각, 최근오류, DEGRADED/UNAVAILABLE, cache 여부와 circuit breaker를 관리한다.

• WP-SITUATION-11 충돌 비교·사용자 선택: 사용자 입력과 외부 후보의 값·시각·출처 차이를 비교하고 선택·수정 이력을 기록한다.

• WP-SITUATION-12 SituationSnapshot 확정: 선택 Fact 집합, confirmer, contextRevision, hash를 불변 Snapshot으로 생성한다.

• WP-SITUATION-13 SafeKorea on-demand 보조: Feature Flag·allowlist·TTL·DOM fingerprint·parserVersion·fallback을 적용한 요청형 Collector를 구현한다.

• WP-SITUATION-14 Naver 사용자 요청형 Stub: 스케줄 수집을 금지하고 URL Import/1회 조회 계약과 감사·기본 OFF 설정만 구현한다.

• WP-SITUATION-15 Situation E2E: 정상·부분실패·전체실패·충돌·수동입력·Snapshot 정정 시나리오를 검증한다.

### Work Package 완료 기준

• Flag OFF 네트워크 0건, DOM 변경 시 자동중단·원문링크·수동입력을 제공한다.

• 운영스케줄 호출 0건이며 승인 전 실제수집이 비활성화된다.

• E2E-17~19와 ADR-11 완료기준을 통과한다.

## 5.10 WP-UNI-RAG UNI Upload/Search/chat-json·SOP Mapper POC

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>사용자 자료를 UNI에 업로드·검색하고 compns SSE를 UNE SOP Schema로 변환·검증하는 POC를 구현한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>BE/FE/ARCH</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-06,13</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S2~S7<br />
2026.08.17~2026.11.06</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G2/G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>13</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-UNI-RAG-01 UNI Gateway 경계: 브라우저 직접호출을 금지하고 service credential, allowlist, 요청크기, timeout, rate limit를 적용한다.

• WP-UNI-RAG-02 문서 업로드 Adapter: POST /documents/upload의 파일·메타·JWT·비동기 응답을 UNE Job으로 변환한다.

• WP-UNI-RAG-03 학습상태 Polling: 업로드 이후 처리큐 상태를 조회하고 READY/FAILED/timeout을 사용자에게 표시한다.

• WP-UNI-RAG-04 RAG Search Adapter: POST /search 결과를 EvidenceRef(doc/chunk/page/score/source)로 변환한다.

• WP-UNI-RAG-05 EvidenceSet 구성: USER_UPLOAD/UNI_RAG/SITUATION_FACT의 우선순위·고정시점·충돌·hash를 SOPGenerationContext로 만든다.

• WP-UNI-RAG-06 /chat/json 요청: disasterType, snapshot, EvidenceSet, 생성옵션을 provider request로 매핑한다.

• WP-UNI-RAG-07 SSE assembler: compn event, done, error, disconnect, lastEventId를 처리하고 임시 Graph를 구성한다.

• WP-UNI-RAG-08 Raw Event Store: 원시 SSE event, hash, providerSchemaVersion, generationId, sequence를 암호화·TTL 저장한다.

• WP-UNI-RAG-09 UniSopMapper: compnSn/type/name/task/branch/source/unknown fields를 versioned Mapping Profile로 SopNode에 변환한다.

• WP-UNI-RAG-10 Incremental/Final Graph Validator: nodeId·sequence·branch target·duplicate·고립노드·시작/종료·순환정책을 검증한다.

• WP-UNI-RAG-11 UNKNOWN_PROVIDER_NODE 처리: 미지원 type을 추정하지 않고 rawPayloadRef·warning과 함께 보존하고 사용자 치환을 지원한다.

• WP-UNI-RAG-12 SSE 실패·재시도: 연결실패·중간중단·Schema 오류에서 수신 preview와 raw event를 보존하고 새 generation/재개를 처리한다.

• WP-UNI-RAG-13 UNI SOP POC Gate: 정상·누락필드·미지원 type·깨진 branch·중복 sequence fixture와 실연계를 검증한다.

### Work Package 완료 기준

• 사용자가 확인·수정 전 실행불가이며 원문필드가 손실되지 않는다.

• 부분수신이 실행 가능한 SOP로 오인되지 않고 오류원인을 재현할 수 있다.

• Contract Test와 E2E-20/21을 통과하고 T3Q Gap 입력 fixture를 확정한다.

## 5.11 WP-WORKFLOW SOP 정의·실행·Task·Execution Log

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>검증·승인된 SOP를 실행하고 임무 상태변경을 append-only Execution Log 사실원장으로 축적한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>BE/FE/ARCH</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-07,10,12,17,18</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S4~S9<br />
2026.09.14~2026.12.04</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>12</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-WORKFLOW-01 SOP Definition/Version: SopDefinition, Node/Edge, TaskDefinition, EvidenceRef, version/currentVersion을 구현한다.

• WP-WORKFLOW-02 SOP 편집·승인: DRAFT 편집, validation, publish/activate, 생성자·승인자 권한 분리를 구현한다.

• WP-WORKFLOW-03 SOP Instance 생성: incident/snapshot/sopVersion/institution binding을 고정한 실행 instance를 생성한다.

• WP-WORKFLOW-04 Task Instance 상태기계: PENDING→SENT→ACKNOWLEDGED→IN_PROGRESS→COMPLETED/REJECTED/OVERDUE를 구현한다.

• WP-WORKFLOW-05 Decision/Branch 평가: 분기조건, 사용자판단, Fact 참조, 미결분기와 선택근거를 처리한다.

• WP-WORKFLOW-06 조직·담당자 Assignment: RoleBinding과 대체담당·복수수신·담당변경을 Task에 바인딩한다.

• WP-WORKFLOW-07 일시정지·재개·취소: SOP Instance DRAFT/READY/RUNNING/PAUSED/COMPLETED/CANCELLED/FAILED 전이를 구현한다.

• WP-WORKFLOW-08 완료증거·승인: 사진·문서·메모·시간·위치 등 Task 완료증거와 승인/반려를 관리한다.

• WP-WORKFLOW-09 SLA·Escalation: ack/start/complete 기한, overdue, 재전파·대체담당·지휘자 알림 규칙을 구현한다.

• WP-WORKFLOW-10 ExecutionEvent append-only: 전파·수신·착수·완료·반려·정정·재전파를 append-only로 저장하고 correctionOfEventId를 지원한다.

• WP-WORKFLOW-11 Timeline Projection: Execution Event를 시간·조직·임무·상태별로 읽어 전자상황판에 투영한다.

• WP-WORKFLOW-12 Workflow E2E: SOP 승인→실행→분기→담당변경→완료/반려→종료의 정상·예외 흐름을 검증한다.

### Work Package 완료 기준

• 원천 Event 삭제/수정 없이 정정이 연결되고 event hash/order가 보존된다.

• 동일 원장에서 다양한 필터가 일관된 결과를 반환한다.

• Execution Log 누락·중복 0건이며 허용상태전이와 권한시험을 통과한다.

## 5.12 WP-PROPAGATION 전파 Outbox·ChannelPort·수신상태

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>UNE 내부 Workflow와 외부 채널을 Transactional Outbox·Port/Adapter로 분리하고 System/Simulation 채널로 E2E를 보장한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>BE/FE/DEVOPS</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-07,17</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S5~S10<br />
2026.09.28~2026.12.18</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>11</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-PROPAGATION-01 PropagationCommand/Envelope: incident, SOP/task, recipients, body, priority, expiry, idempotencyKey, mode를 정의한다.

• WP-PROPAGATION-02 Transactional Outbox: Task 상태변경/Execution Event와 전파 메시지를 동일 DB 트랜잭션으로 저장한다.

• WP-PROPAGATION-03 ChannelDispatcher: Outbox polling/locking/배치/우선순위/재시도/상태갱신을 구현한다.

• WP-PROPAGATION-04 System Notification Adapter: 웹/앱 내부 알림, 읽음/확인, 링크, 만료를 구현한다.

• WP-PROPAGATION-05 Training Simulation Adapter: 실제 발송 없이 대상·시각·결과를 모의하고 화면·로그에 TRAINING/SIMULATION을 표시한다.

• WP-PROPAGATION-06 EMAIL/SMS/BROADCAST Stub: capabilities, endpoint/auth/receipt 계약과 Disabled Stub을 선행 구현한다.

• WP-PROPAGATION-07 Receipt/Callback 처리: provider message ID, delivery/ack callback, polling, 순서역전·중복 callback을 처리한다.

• WP-PROPAGATION-08 멱등·재시도·DLQ: task+recipient+channel+messageVersion 키, backoff, retryable/non-retryable, dead-letter를 구현한다.

• WP-PROPAGATION-09 개인정보·첨부 보안: 연락처 암호화/마스킹, 최소본문, 만료 다운로드 토큰, Secret rotation을 적용한다.

• WP-PROPAGATION-10 전파·수신 UI: 수신자별 QUEUED/SENT/DELIVERED/ACK/STARTED/COMPLETED/FAILED와 재전파·대체채널을 제공한다.

• WP-PROPAGATION-11 Propagation E2E: System/Simulation으로 승인→전파→수신→착수→완료→재시도→상황판→일지를 검증한다.

### Work Package 완료 기준

• 로그·화면·이벤트에 원문 연락처와 영구 공개 URL이 노출되지 않는다.

• 전송 성공과 임무완료를 구분하고 권한별 액션이 정확히 제한된다.

• E2E-23과 ADR-17 완료기준, idempotency/장애복구 시험을 통과한다.

## 5.13 WP-JOURNAL Execution Log 기반 상황일지 Projection·HWPX

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>확정 Snapshot과 Execution Log를 결정론적으로 투영하고 선택적 AI 문장화와 검증을 거쳐 HWPX 상황일지를 생성한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>BE/FE/DOC</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-06,10,12</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S6~S10<br />
2026.10.12~2026.12.18</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G3/G4</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>12</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-JOURNAL-01 Journal Domain Schema: JournalDocument/Section/Entry/NarrativeDraft/Approval, sourceRefs, cutoff, revision을 정의한다.

• WP-JOURNAL-02 Projection Cutoff/Revision: 특정 시점까지의 Snapshot·Event를 고정하고 이후 이벤트를 새 revision/후속일지로 처리한다.

• WP-JOURNAL-03 JournalEntry Projection: Event/Fact를 시간순·조직·임무별 Entry로 변환하고 groupKey로 동일사건을 묶는다.

• WP-JOURNAL-04 Section Mapping: 상황개요/기상/특보/피해/통제/조치/기관동향/향후계획을 Template Profile 역할에 매핑한다.

• WP-JOURNAL-05 결정론적 최소일지 생성: AI 없이 고정 규칙과 템플릿으로 표·목록·시간축 초안을 생성한다.

• WP-JOURNAL-06 선택적 Narrative Provider: UNI /chat 또는 향후 RPT-003을 JournalProviderPort로 연결해 표현·요약만 수행한다.

• WP-JOURNAL-07 사실성 Validator: 문장·표셀의 날짜·수치·인명·조치·피해가 sourceEntryIds/factIds에 존재하는지 검증한다.

• WP-JOURNAL-08 사용자 편집·ChangeSet: rhwp에서 Block/Section 편집·AI 재작성·Diff·잠금·Undo를 제공한다.

• WP-JOURNAL-09 승인·정정·감사: 일지 승인, 승인본 다운로드, 정정사유·정정자·정정시각·원본보존을 구현한다.

• WP-JOURNAL-10 Journal HWPX Mapping: Entry/Section을 원본 양식 Prototype·표·개요로 변환하고 ValidationReport를 생성한다.

• WP-JOURNAL-11 RPT-003 비교 Fixture: 향후 T3Q RPT-003의 Schema·근거·부분결과·편집·운영을 비교할 입력/기대출력 fixture를 만든다.

• WP-JOURNAL-12 Journal E2E: Snapshot+Execution Log→Projection→선택적 문장화→검증→편집→승인→HWPX를 검증한다.

### Work Package 완료 기준

• 상황일지 양식의 표·번호·고정영역과 source trace가 보존된다.

• RPT-003 수신 시 Journal 소유권을 바꾸지 않고 Adapter Gate를 평가할 수 있다.

• 근거추적 100%, 허위 Fact 0, 승인본 불변성, Provider OFF fallback을 통과한다.

## 5.14 WP-SCENARIO 사용자 시나리오·안전한국훈련 Reference Scenario·기관 Binding

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>개발·화면·API·시험의 기준이 되는 계획서, 상황일지, 안전한국훈련 시나리오와 자연·사회재난 Scenario Pack을 작성한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>PM/ARCH/UX/QA</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-18 및 전 ADR</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S1~S10<br />
2026.08.03~2026.12.18</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G3/G5</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>13</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-SCENARIO-01 Actor·Role·권한 기준: 계획 담당자, 상황편집/승인, SOP 설계/승인, 지휘자, 담당자, 관리자, 감사자 Actor를 정의한다.

• WP-SCENARIO-02 계획서 생성 사용자 시나리오 v1.0: 양식업로드→분석확인→기준정보→T3Q 목차/본문→직접/AI 편집→Diff→HWPX 저장·Export의 정상·대안·예외를 상세 작성한다.

• WP-SCENARIO-03 상황일지·안전한국훈련 사용자 시나리오 v1.0: 상황등록→Fact 비교·Snapshot→자료업로드·SOP→승인·실행→전파·수신·완료→상황판→일지→평가 흐름을 상세 작성한다.

• WP-SCENARIO-04 Scenario ID·E2E 매핑: 각 단계에 US, SCR, API/DB, Event, E2E, Evidence 식별자를 부여하고 인수기준을 연결한다.

• WP-SCENARIO-05 ScenarioDefinition Schema: disasterType, mode, objective, timeline, SOP, org binding, expected execution, journal, rubric 구조를 정의한다.

• WP-SCENARIO-06 Mock Institution/Organization: 기관·부서·역할·담당자·대체담당·연락채널·지역을 Mock profile로 구성한다.

• WP-SCENARIO-07 태풍·호우 Timeline/Fact Pack: 예보·특보·강수·풍속·재난문자·침수/통제·피해·대응단계의 시각별 입력과 충돌 Fact를 구성한다.

• WP-SCENARIO-08 태풍·호우 SOP/ExpectedExecution: 예찰·대피·도로통제·자원배치·기관전파·완료조건과 기대 Event/시간을 정의한다.

• WP-SCENARIO-09 붕괴사고 Timeline/Fact Pack: 발생시각·위치·붕괴범위·인명·추가붕괴·접근통제·현장보고의 시각별 입력을 구성한다.

• WP-SCENARIO-10 붕괴사고 SOP/ExpectedExecution: 구조접근·대피·의료·교통·시설·홍보·유관기관 분기와 전파·수신·완료를 정의한다.

• WP-SCENARIO-11 Journal Expectation·평가 Rubric: 시나리오별 필수 일지 Section/Entry/source와 성공률·시간·누락·사실성·문서품질·만족도 지표를 정의한다.

• WP-SCENARIO-12 기관 Binding 절차: 실증기관, 재난유형, 조직, 자료, 연계, 평가사항을 G18-1~6 체크리스트로 동결한다.

• WP-SCENARIO-13 Reference Scenario E2E Baseline: 자연·사회 Scenario Pack을 Mock Org/System/Simulation Channel로 실행해 기준결과를 동결한다.

### Work Package 완료 기준

• 자동시험과 실무자 평가항목이 구분되고 증거수집 방법이 명시된다.

• 기관·유형 변경 시 공통 API/DB/화면 수정 없이 Config/Content만 교체된다.

• 두 시나리오의 전 단계와 기대 Event/Journal이 통과하고 증거 bundle이 보관된다.

## 5.15 WP-UI React 통합 Workspace·화면·상태·권한·오류

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>계획서와 상황일지·SOP 실행을 하나의 React 플랫폼에서 제공하고 rhwp Web Editor를 중앙 편집 Surface로 사용한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>FE/UX/BE</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-01,04,11~18</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S2~S10<br />
2026.08.17~2026.12.18</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>16</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-UI-01 정보구조·화면목록: 메뉴, 화면ID, 목적, Actor, 진입/종료, 상태, 주요 데이터, ADR/US 추적을 정의한다.

• WP-UI-02 통합 Navigation/Shell: 메인플랫폼 진입, 최근문서, 계획서, 상황/훈련, SOP, 상황판, 일지, 관리 메뉴를 구현한다.

• WP-UI-03 문서목록·보관함: 문서명·유형·단계·생성/수정일·상태·검색·다운로드·삭제/휴지통 정책을 구현한다.

• WP-UI-04 계획서 기준정보 화면: 주제·재난유형·관리단계·일시·장소·지침·출처·문체·독자·역할·템플릿을 입력·저장·미리보기한다.

• WP-UI-05 rhwp 중앙 Workspace: 좌측 문서구조, 중앙 Editor, 우측 AI/근거/Diff 패널과 Job 상태바를 구현한다.

• WP-UI-06 Template 분석확인 화면: 역할 후보·개요패턴·제한객체·신뢰도·미리보기·확정/수정을 제공한다.

• WP-UI-07 AI 편집·근거·Diff 패널: Cursor/Range/Block/Section Operation, 근거, 경고, Diff 적용/취소, 잠금 상태를 제공한다.

• WP-UI-08 상황등록·Fact 비교 화면: 기본정보, Provider 상태, 후보목록, 충돌비교, 선택/수정, Snapshot 확정을 구현한다.

• WP-UI-09 자료업로드·근거검색 화면: UNI 업로드 상태, 검색결과, EvidenceSet 우선순위·충돌·선택을 표시한다.

• WP-UI-10 SOP Designer/Preview: SSE 수신노드, UNKNOWN/validation warning, Task/branch 편집, Publish/Activate 승인흐름을 구현한다.

• WP-UI-11 지휘자 실행·전파 화면: SOP Instance, Task 배정, 전파, 재전파, 상태, 지연, Escalation, 완료증거를 관리한다.

• WP-UI-12 담당자 임무 화면: 수신확인, 착수, 완료/반려, 증거첨부, 기한, 대체담당 요청을 모바일 대응 UI로 제공한다.

• WP-UI-13 전자상황판: 시간축, 조직/임무 진행률, 지연/실패, 전파·수신·완료, 상황 Fact·Snapshot, 필터를 표출한다.

• WP-UI-14 상황일지 화면: cutoff, Section/Entry, 근거, AI 문장화, Diff, 승인/정정, HWPX 저장을 제공한다.

• WP-UI-15 관리 화면: Provider/Channel/Feature Flag/Template/Institution/Mapping Profile/환경상태를 관리한다.

• WP-UI-16 공통 접근성·상태·오류 검증: 키보드, focus, 대비, label, status live region, 권한·오류메시지·loading/empty를 점검한다.

### Work Package 완료 기준

• sourceRefs·승인본·정정 revision과 사용자 수정 보호가 표시된다.

• 권한·승인·감사·Secret 비노출과 기본 OFF 정책을 준수한다.

• 핵심 화면의 키보드 운용과 상태·권한·오류 일관성 결함이 해소된다.

## 5.16 WP-API-DB-SEQ 화면·API·DB·Sequence 상세설계

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>사용자 시나리오와 ADR을 기준으로 화면ID, API, 데이터 소유권, 상태전이, Sequence를 구현·시험 가능한 수준으로 상세화한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>ARCH/BE/FE/DOC</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-01~18</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S2~S9<br />
2026.08.17~2026.12.04</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G1/G3</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>12</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-API-DB-SEQ-01 도메인·데이터 소유권 Matrix: Document, Template, Situation, SOP, Workflow, Propagation, Execution, Journal, Scenario의 소유 서비스와 불변규칙을 확정한다.

• WP-API-DB-SEQ-02 논리 ERD: 핵심 Entity·키·version·관계·append-only·correction·raw payload·evidence를 모델링한다.

• WP-API-DB-SEQ-03 물리 DB Schema: PostgreSQL 중심 테이블, 인덱스, JSONB, Object Store ref, partition/retention, migration을 설계한다.

• WP-API-DB-SEQ-04 API 목록·리소스 설계: 화면/Actor별 REST/SSE Endpoint, method, auth, idempotency, status를 식별한다.

• WP-API-DB-SEQ-05 OpenAPI 상세명세: request/response/error/example/security/correlation/version/partial result를 작성한다.

• WP-API-DB-SEQ-06 SSE/Event 명세: generation, UNI compn preview, workflow task, incident timeline의 event type·ordering·resume·error를 정의한다.

• WP-API-DB-SEQ-07 계획서 Sequence: 양식분석, RPT-001/002, Block 반영, 사용자편집, Diff, 저장·Export의 정상/오류 Sequence를 작성한다.

• WP-API-DB-SEQ-08 상황정보·SOP Sequence: Provider 수집→Fact→Snapshot→UNI 업로드/검색/SSE→Mapper→SOP 승인 Sequence를 작성한다.

• WP-API-DB-SEQ-09 Workflow·전파 Sequence: SOP 실행→Outbox→Channel→Receipt→Task 상태→Execution Event→재시도/Escalation을 작성한다.

• WP-API-DB-SEQ-10 상황일지 Sequence: cutoff→Projection→선택적 AI→Validator→ChangeSet→승인→HWPX→정정 흐름을 작성한다.

• WP-API-DB-SEQ-11 화면-API-DB 매핑표: 화면 field/action/status/error를 API field, Entity/column, 권한, Event, WBS/TC와 연결한다.

• WP-API-DB-SEQ-12 상세설계 검토·기준선: 개발팀 walkthrough, Schema lint, Sequence scenario review, 변경사항 CR을 처리한다.

### Work Package 완료 기준

• AI OFF fallback과 승인본 불변·후속 Event 처리 분기가 포함된다.

• 미매핑 화면값·API필드·DB컬럼·오류 0건을 목표로 한다.

• 승인자·검토결함·조치·기준선 hash가 기록된다.

## 5.17 WP-INTEGRATION-QA 통합·보안·성능·실증·인수·배포

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>항목</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>목표</td>
<td>Contract, 단위, 통합, E2E, 보안, 성능, 복구, 한컴 호환성, 실증 시나리오 증거를 통합해 최종 프로토타입을 인수한다.</td>
</tr>
<tr class="even">
<td>주담당</td>
<td>QA/PM/전팀</td>
</tr>
<tr class="odd">
<td>적용 ADR</td>
<td>ADR-01~18</td>
</tr>
<tr class="even">
<td>기간</td>
<td>S4~S11<br />
2026.09.14~2026.12.31</td>
</tr>
<tr class="odd">
<td>주요 Gate</td>
<td>G3~G6</td>
</tr>
<tr class="even">
<td>세부 작업 수</td>
<td>17</td>
</tr>
</tbody>
</table>

### 핵심 구현 항목

• WP-INTEGRATION-QA-01 시험전략·품질지표: 단위/Contract/통합/E2E/보안/성능/호환성/사용성/실증의 범위·환경·책임·합격기준을 수립한다.

• WP-INTEGRATION-QA-02 단위시험·정적분석 기준: Frontend/Backend/Rust/WASM의 coverage, lint, type, dependency, secret scan 기준을 적용한다.

• WP-INTEGRATION-QA-03 Contract Test Suite: T3Q, UNI, KMA/MOIS, Channel Stub과 UNE OpenAPI/Schema의 요청·응답·오류 fixture를 검증한다.

• WP-INTEGRATION-QA-04 DB Migration·Rollback 시험: 초기 schema, version migration, 실패 rollback, 데이터보존, append-only 제약을 검증한다.

• WP-INTEGRATION-QA-05 계획서 E2E: 임의 양식→T3Q 목차/본문→편집→Diff→HWPX 저장/Export와 장애흐름을 검증한다.

• WP-INTEGRATION-QA-06 상황·SOP E2E: Fact 수집/충돌/Snapshot→UNI SOP→검증/승인→Workflow 실행까지 검증한다.

• WP-INTEGRATION-QA-07 전파·전자상황판·일지 E2E: Outbox/System/Simulation→수신/착수/완료→Timeline→Journal 승인/HWPX를 검증한다.

• WP-INTEGRATION-QA-08 자연재난 Reference E2E: 태풍·호우 Pack을 전체 플랫폼에서 실행하고 기대 Event/Journal/평가지표를 비교한다.

• WP-INTEGRATION-QA-09 사회재난 Reference E2E: 붕괴사고 Pack을 다기관·분기·증거·Escalation 중심으로 실행한다.

• WP-INTEGRATION-QA-10 보안시험: 인증/권한, 파일업로드, ZIP/XML, SSRF/allowlist, Secret, 개인정보, 로그마스킹, API abuse를 점검한다.

• WP-INTEGRATION-QA-11 성능·부하시험: 50쪽 HWPX 분석/저장, 대형문서 편집, SSE 동시연결, Timeline/Journal projection, Outbox 처리량을 측정한다.

• WP-INTEGRATION-QA-12 장애·복구시험: T3Q/UNI/공식API/DB/Object Store/SSE/Channel 장애·재시작·부분실패·재처리를 검증한다.

• WP-INTEGRATION-QA-13 접근성·사용성 평가: 핵심 Actor가 계획서·상황등록·SOP·전파·일지 시나리오를 수행하고 접근성·만족도·오류이해도를 평가한다.

• WP-INTEGRATION-QA-14 결함 Triaging·회귀: Severity, ADR/WP/US/E2E 영향, 수정버전, 회귀범위를 관리하고 기준선 결함을 종료한다.

• WP-INTEGRATION-QA-15 Alpha/Beta 통합 빌드: S7 Alpha와 S9 Beta를 배포하고 데이터·Schema·시나리오·관찰성·롤백을 검증한다.

• WP-INTEGRATION-QA-16 Release Candidate·한컴 승인: S10 RC를 고정하고 HWPX Track A/B, 보안, 성능, 자연/사회 E2E를 종합 승인한다.

• WP-INTEGRATION-QA-17 최종 인수·v1.0 기준선: 코드·Schema·설계·시나리오·시험·사용자매뉴얼·SBOM·라이선스·증거를 패키징하고 인수한다.

### Work Package 완료 기준

• 환경별 artifact hash, migration, known issue, rollback이 재현된다.

• G4/G5/G6 필수증거가 완비되고 배포보류 사유가 없다.

• 산출물 Register 100%, 추적 누락 0, 승인서·인수시험서·변경이력·후속 backlog가 확정된다.

# 6. 일정·Sprint·Milestone·Critical Path

## 6.1 Sprint Calendar

| **Sprint** | **시작**   | **종료**   | **핵심 초점**      |
|------------|------------|------------|--------------------|
| S0         | 2026.07.27 | 2026.07.31 | 기준선 정비        |
| S1         | 2026.08.03 | 2026.08.14 | 계약·시나리오 착수 |
| S2         | 2026.08.17 | 2026.08.28 | Schema·POC 기반    |
| S3         | 2026.08.31 | 2026.09.11 | 핵심 POC 구현      |
| S4         | 2026.09.14 | 2026.09.25 | POC Gate·상세설계  |
| S5         | 2026.09.28 | 2026.10.09 | 기능 통합 1        |
| S6         | 2026.10.12 | 2026.10.23 | 기능 통합 2        |
| S7         | 2026.10.26 | 2026.11.06 | Alpha 통합         |
| S8         | 2026.11.09 | 2026.11.20 | Beta 안정화        |
| S9         | 2026.11.23 | 2026.12.04 | 실증·회귀          |
| S10        | 2026.12.07 | 2026.12.18 | RC·한컴 검증       |
| S11        | 2026.12.21 | 2026.12.31 | 인수·기준선 확정   |

## 6.2 Milestone

| **ID** | **목표일** | **완료물**                                                          |
|--------|------------|---------------------------------------------------------------------|
| M0     | 2026.08.07 | ADR v1.1·개발계획/WBS·Register G0 승인                              |
| M1     | 2026.08.28 | 계획서/상황일지·안전한국훈련 사용자 시나리오와 Contract/Schema v0.5 |
| M2     | 2026.09.25 | HWPX Core/Template/Serializer POC와 UNI SOP POC G2                  |
| M3     | 2026.10.16 | 화면목록·화면흐름·API/DB/Sequence v0.5                              |
| M4     | 2026.11.06 | 통합 Alpha: 계획서·상황·SOP·Workflow 기본 E2E                       |
| M5     | 2026.11.27 | Beta Feature Complete: 전파·상황판·일지·자연/사회 시나리오          |
| M6     | 2026.12.18 | Release Candidate, HWPX RT-A~G, 보안·성능·E2E 승인                  |
| M7     | 2026.12.31 | 프로토타입 v1.0·인수패키지·v1.0 상세설계 기준선                     |

## 6.3 Work Package Gantt

| **WP**            | **Work Package**                                             | **S0** | **S1** | **S2** | **S3** | **S4** | **S5** | **S6** | **S7** | **S8** | **S9** | **S10** | **S11** |
|-------------------|--------------------------------------------------------------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|---------|---------|
| WP-ADR-BASE       | ADR·기준선·추적성 관리                                       | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**   | **■**   |
| WP-PLATFORM-BASE  | 통합플랫폼 공통 기반                                         | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  |        |        |         |         |
| WP-HWPX-CORE      | rhwp 소스 반입·HWPX Package·Document IR 기반                 |        | **■**  | **■**  | **■**  | **■**  |        |        |        |        |        |         |         |
| WP-HWPX-ANALYZE   | 임의 HWPX Template Analyzer·Prototype Registry               |        |        | **■**  | **■**  | **■**  | **■**  |        |        |        |        |         |         |
| WP-HWPX-EDIT      | rhwp 단일 편집 Surface·Selection·ChangeSet                   |        |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  |        |         |         |
| WP-HWPX-SERIALIZE | 보존형 HWPX 저장·Reference Rebuild·Export                    |        |        |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  |         |         |
| WP-HWPX-QA        | 한컴 HWPX 호환성 Round-trip·배포 승인                        |        |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**   | **■**   |
| WP-PLAN-T3Q       | 재난안전계획서 T3Q RPT-001/002 연계·생성                     |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  |        |         |         |
| WP-SITUATION      | SituationContext·공식 Provider·Snapshot                      |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  |        |         |         |
| WP-UNI-RAG        | UNI Upload/Search/chat-json·SOP Mapper POC                   |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  |        |        |         |         |
| WP-WORKFLOW       | SOP 정의·실행·Task·Execution Log                             |        |        |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  |         |         |
| WP-PROPAGATION    | 전파 Outbox·ChannelPort·수신상태                             |        |        |        |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**   |         |
| WP-JOURNAL        | Execution Log 기반 상황일지 Projection·HWPX                  |        |        |        |        |        |        | **■**  | **■**  | **■**  | **■**  | **■**   |         |
| WP-SCENARIO       | 사용자 시나리오·안전한국훈련 Reference Scenario·기관 Binding |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**   |         |
| WP-UI             | React 통합 Workspace·화면·상태·권한·오류                     |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**   |         |
| WP-API-DB-SEQ     | 화면·API·DB·Sequence 상세설계                                |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  |         |         |
| WP-INTEGRATION-QA | 통합·보안·성능·실증·인수·배포                                |        |        |        |        | **■**  | **■**  | **■**  | **■**  | **■**  | **■**  | **■**   | **■**   |

※ ■는 해당 Work Package의 계획 수행기간을 의미하며, 세부 작업 일정은 제7장 WBS를 기준으로 한다.

## 6.4 Critical Path

**1.** ADR/Schema 기준선 → 계획서·상황일지 사용자 시나리오 → 화면/API/DB/Sequence 상세설계

**2.** rhwp 소스 반입·Document IR → Template Analyzer/Prototype → Selection/ChangeSet → Serializer → Track A/B Round-trip

**3.** SituationContext/Snapshot → UNI SOP Mapper → Workflow/Execution Log → Propagation → JournalProjection → 자연·사회 E2E

**4.** T3Q RPT-001/002 실제 Contract가 계획서 통합의 외부 Critical 항목이며, 미수신 기간에는 Mock fixture로 개발하되 실제 Adapter G1 통과 전 운영완료로 보지 않는다.

**5.** Windows/한컴 시험환경은 개발 자체를 막지 않지만 RC 배포 승인 G4의 Critical 항목이다.

# 7. 상세 WBS

## 7.1 WBS 작성 원칙

• 각 작업은 WBS ID, 세부 수행내용, 책임역할, Sprint/달력기간, 선행조건, 산출물, Definition of Done, ADR/검증 추적을 가진다.

• 외부 제공물이 미확정인 작업은 대기상태로 두지 않고 Mock/Stub/Recorded Fixture/Simulation 작업과 실제 활성화 Gate를 분리한다.

• 개발완료는 코드 작성 완료가 아니라 Schema·문서·시험·증거·기준선 반영 완료를 의미한다.

• 상세 WBS의 작업을 문서 길이 또는 일정 압축을 이유로 삭제할 경우 반드시 CR과 영향분석을 거친다.

| **WBS 규모** 총 17개 Work Package, 212개 세부 작업으로 구성한다. 각 작업의 세부내용과 완료기준은 아래 표를 개발·주간보고·Sprint 검토·인수시험의 기준으로 사용한다. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 7.2 Work Package별 상세 WBS

### 7.2.1 WP-ADR-BASE ADR·기준선·추적성 관리

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-ADR-BASE-01</td>
<td>ADR v1.1 정정본 확정</td>
<td>ADR-15를 특정 Tag/Commit 소스 다운로드·UNE 내부 저장소 반입 방식으로 정정하고 ADR-16을 운영기능이 아닌 한컴 호환성 배포 승인 절차로 명확화한다.</td>
<td>PM/ARCH<br />
S0~S0<br />
07.27~07.31</td>
<td>-</td>
<td>산출물: ADR 의사결정기록서 v1.1<br />
완료: 개정이력·결정문·OPEN 폐쇄표·WP 추적표의 용어가 일치하고 기존 결정의 근거가 보존된다.</td>
<td>ADR-15,16</td>
</tr>
<tr class="even">
<td>WP-ADR-BASE-02</td>
<td>기준문서 Register 작성</td>
<td>Master 설계, Contract, HWPX 명세, SituationContext 명세, ADR, Schema Bundle의 우선순위·버전·승인상태를 등록한다.</td>
<td>PM<br />
S0~S0<br />
07.27~07.31</td>
<td>ADR-BASE-01</td>
<td>산출물: Baseline Register<br />
완료: 파일명·버전·해시·승인자·효력일·대체관계가 기록된다.</td>
<td>G0</td>
</tr>
<tr class="odd">
<td>WP-ADR-BASE-03</td>
<td>OPEN/ADR Register 폐쇄 검증</td>
<td>OPEN-01~08과 ADR-11~18의 대응관계, 조건부 Trigger 및 Change Request 전환규칙을 재검토한다.</td>
<td>ARCH<br />
S0~S0<br />
07.27~07.31</td>
<td>ADR-BASE-01</td>
<td>산출물: OPEN/ADR Register<br />
완료: OPEN 항목 8건 모두 CLOSED-BY-ADR이며 미결 외부조건은 Gate로 이동한다.</td>
<td>ADR-11~18</td>
</tr>
<tr class="even">
<td>WP-ADR-BASE-04</td>
<td>추적성 식별체계 정의</td>
<td>ADR→WP→US→SCR→API/DB→SEQ→TC/E2E→Evidence의 ID 규칙과 양방향 링크 필드를 정의한다.</td>
<td>ARCH/QA<br />
S0~S1<br />
07.27~08.14</td>
<td>ADR-BASE-02</td>
<td>산출물: Traceability Model v1.0<br />
완료: 모든 신규 산출물 템플릿에 추적 필드가 포함되고 누락 검출 규칙이 정해진다.</td>
<td>G0/G1</td>
</tr>
<tr class="odd">
<td>WP-ADR-BASE-05</td>
<td>변경요청·ADR 개정 절차 수립</td>
<td>외부 API·실증기관·채널·한컴환경 변경 시 기존 ADR 덮어쓰기 없이 CR 또는 신규 ADR로 처리하는 승인절차를 수립한다.</td>
<td>PM/ARCH<br />
S0~S1<br />
07.27~08.14</td>
<td>ADR-BASE-03</td>
<td>산출물: Change Control Procedure<br />
완료: 변경등급·영향분석·승인권한·기준선 반영·Rollback 절차가 정의된다.</td>
<td>P-07</td>
</tr>
<tr class="even">
<td>WP-ADR-BASE-06</td>
<td>Schema/OpenAPI 저장소 골격</td>
<td>JSON Schema, OpenAPI, fixture, mapping profile, migration, contract test를 버전별로 관리할 디렉터리와 CI 검증 규칙을 구성한다.</td>
<td>ARCH/BE<br />
S1~S1<br />
08.03~08.14</td>
<td>ADR-BASE-04</td>
<td>산출물: schema-bundle repository<br />
완료: Draft 2020-12 검증, OpenAPI lint, fixture versioning이 CI에서 수행된다.</td>
<td>G1</td>
</tr>
<tr class="odd">
<td>WP-ADR-BASE-07</td>
<td>Evidence Repository 구성</td>
<td>시험 원본·결과·로그·스크린샷·해시·ValidationReport를 testRunId로 묶어 보존하는 구조와 보관기간을 정의한다.</td>
<td>QA/DEVOPS<br />
S1~S2<br />
08.03~08.28</td>
<td>ADR-BASE-04</td>
<td>산출물: Evidence Repository<br />
완료: Gate별 필수 증거 체크리스트와 파일명 규칙이 적용된다.</td>
<td>P-07/G3~G6</td>
</tr>
<tr class="even">
<td>WP-ADR-BASE-08</td>
<td>외부의존성 Register 운영</td>
<td>T3Q, UNI, 실증수요처, 채널제공자, Windows/한컴 시험환경의 요청사항·기한·대체처리를 등록한다.</td>
<td>PM<br />
S0~S11<br />
07.27~12.31</td>
<td>-</td>
<td>산출물: External Dependency Register<br />
완료: 미수신 항목이 WBS를 중단시키지 않고 Mock/Stub/Simulation 처리와 연결된다.</td>
<td>ADR-11~18</td>
</tr>
<tr class="odd">
<td>WP-ADR-BASE-09</td>
<td>개발계획서·상세 WBS 승인</td>
<td>본 개발계획과 WBS의 일정·선행조건·산출물·DoD·Gate·책임을 검토하고 개발 착수 기준선으로 승인한다.</td>
<td>PM/연구소장<br />
S0~S1<br />
07.27~08.14</td>
<td>ADR-BASE-01~08</td>
<td>산출물: 개발계획서 및 상세 WBS v1.0<br />
완료: WP와 세부작업이 전부 식별되고 G0 체크리스트가 승인된다.</td>
<td>G0</td>
</tr>
<tr class="even">
<td>WP-ADR-BASE-10</td>
<td>기준선 정기점검</td>
<td>매 Sprint 종료 시 설계·코드·Schema·시험증거 간 버전 불일치와 미승인 변경을 점검한다.</td>
<td>PM/QA<br />
S1~S11<br />
08.03~12.31</td>
<td>ADR-BASE-09</td>
<td>산출물: Baseline Review Log<br />
완료: Sprint별 기준선 점검기록과 조치결과가 남고 미추적 변경 0건을 유지한다.</td>
<td>G0~G6</td>
</tr>
</tbody>
</table>

### 7.2.2 WP-PLATFORM-BASE 통합플랫폼 공통 기반

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-PLATFORM-BASE-01</td>
<td>Monorepo 구조 확정</td>
<td>apps, services, modules, schemas, third_party, patches, tests, evidence 영역을 분리하고 소유권을 정의한다.</td>
<td>ARCH/DEVOPS<br />
S0~S1<br />
07.27~08.14</td>
<td>ADR-BASE-06</td>
<td>산출물: Repository Layout<br />
완료: 빌드·테스트·배포 경계와 CODEOWNERS가 적용된다.</td>
<td>ADR-15</td>
</tr>
<tr class="even">
<td>WP-PLATFORM-BASE-02</td>
<td>CI/CD 파이프라인 구성</td>
<td>Frontend, Backend, Rust/WASM, Schema, unit/contract test, SBOM, artifact 서명을 단계별로 실행한다.</td>
<td>DEVOPS<br />
S1~S2<br />
08.03~08.28</td>
<td>PLATFORM-BASE-01</td>
<td>산출물: CI/CD Pipeline<br />
완료: main/RC 빌드가 재현 가능하고 실패 단계가 명확히 분리된다.</td>
<td>G1/G4</td>
</tr>
<tr class="odd">
<td>WP-PLATFORM-BASE-03</td>
<td>환경·Secret 관리</td>
<td>local/dev/test/rc 환경설정, Secret Vault, API key rotation, Feature Flag profile을 정의한다.</td>
<td>DEVOPS/BE<br />
S1~S2<br />
08.03~08.28</td>
<td>PLATFORM-BASE-01</td>
<td>산출물: Environment/Secret Profile<br />
완료: Secret이 코드·브라우저·로그에 노출되지 않고 환경별 설정이 분리된다.</td>
<td>ADR-14,17</td>
</tr>
<tr class="even">
<td>WP-PLATFORM-BASE-04</td>
<td>T3Q 진입 토큰 연계</td>
<td>메인 플랫폼 로그인 후 전달되는 T3Q 토큰의 검증·세션·만료·권한 매핑·로그아웃 동작을 구현한다.</td>
<td>BE/FE<br />
S1~S3<br />
08.03~09.11</td>
<td>PLATFORM-BASE-03</td>
<td>산출물: Auth Adapter 및 세션 테스트<br />
완료: 유효/만료/위변조/권한부족 토큰 시험을 통과하고 별도 로그인 화면을 만들지 않는다.</td>
<td>UFR-AUTH-01</td>
</tr>
<tr class="odd">
<td>WP-PLATFORM-BASE-05</td>
<td>RBAC 공통모듈</td>
<td>DOCUMENT_EDITOR, SITUATION_EDITOR/APPROVER, SOP_DESIGNER/APPROVER, COMMANDER, ASSIGNEE, ADMIN, AUDITOR 권한을 구현한다.</td>
<td>BE/FE<br />
S2~S4<br />
08.17~09.25</td>
<td>PLATFORM-BASE-04</td>
<td>산출물: RBAC Policy/Guard<br />
완료: API와 화면버튼에 동일 정책이 적용되고 자기생성·자기승인 분리 규칙을 지원한다.</td>
<td>ADR-17/권한표</td>
</tr>
<tr class="even">
<td>WP-PLATFORM-BASE-06</td>
<td>감사·상관관계 로그</td>
<td>correlationId, user, role, operation, entity/revision, provider, result, error를 구조화 로그로 남긴다.</td>
<td>BE/DEVOPS<br />
S1~S3<br />
08.03~09.11</td>
<td>PLATFORM-BASE-02</td>
<td>산출물: Audit/Observability Module<br />
완료: 주요 사용자·AI·Provider·승인·전파 행위를 감사로그로 재현할 수 있다.</td>
<td>P-04/P-07</td>
</tr>
<tr class="odd">
<td>WP-PLATFORM-BASE-07</td>
<td>비동기 Job 공통모델</td>
<td>PENDING/RUNNING/COMPLETED/FAILED/CANCELLED와 progress, retry, resultRef를 지원한다.</td>
<td>BE<br />
S2~S4<br />
08.17~09.25</td>
<td>PLATFORM-BASE-06</td>
<td>산출물: Job Service<br />
완료: 계획서·UNI 업로드·SOP·일지 Job이 동일 상태모델과 오류 taxonomy를 사용한다.</td>
<td>ADR-05,06,12,13</td>
</tr>
<tr class="even">
<td>WP-PLATFORM-BASE-08</td>
<td>SSE/Event Gateway</td>
<td>generation.status/block, workflow.task, incident.timeline 이벤트의 인증·재연결·lastEventId·backpressure를 구현한다.</td>
<td>BE/FE<br />
S2~S5<br />
08.17~10.09</td>
<td>PLATFORM-BASE-07</td>
<td>산출물: SSE Gateway<br />
완료: 연결중단 후 재연결해 중복 없이 상태를 복구하고 브라우저가 외부 UNI를 직접 호출하지 않는다.</td>
<td>ADR-13</td>
</tr>
<tr class="odd">
<td>WP-PLATFORM-BASE-09</td>
<td>파일·Object Store 추상화</td>
<td>HWPX·참조문서·raw payload·증거·export 파일의 메타데이터와 Object Store 경로를 분리한다.</td>
<td>BE/DEVOPS<br />
S2~S4<br />
08.17~09.25</td>
<td>PLATFORM-BASE-03</td>
<td>산출물: File/Object Store Service<br />
완료: 파일 hash, MIME, 소유권, TTL, 접근권한, 바이러스 검사 상태를 보존한다.</td>
<td>P-03/P-07</td>
</tr>
<tr class="even">
<td>WP-PLATFORM-BASE-10</td>
<td>Feature Flag 관리</td>
<td>Provider, Web Collector, Naver, 실채널, 실증 Binding을 환경·기관별로 활성화하는 관리기능을 구현한다.</td>
<td>BE/FE<br />
S3~S5<br />
08.31~10.09</td>
<td>PLATFORM-BASE-03</td>
<td>산출물: Feature Flag Admin<br />
완료: 기본 OFF 기능은 승인정보 없이는 활성화되지 않고 변경이 감사된다.</td>
<td>ADR-11,14,17,18</td>
</tr>
<tr class="odd">
<td>WP-PLATFORM-BASE-11</td>
<td>오류 taxonomy·사용자 메시지</td>
<td>Provider, Mapping, HWPX, Round-trip, Workflow, Propagation 오류코드와 사용자·운영 메시지를 분리한다.</td>
<td>ARCH/BE/UX<br />
S2~S5<br />
08.17~10.09</td>
<td>ADR-BASE-04</td>
<td>산출물: Error Catalog<br />
완료: 재시도 가능 여부·HTTP/SSE 상태·운영로그 필드가 일관되고 민감정보를 노출하지 않는다.</td>
<td>ADR 공통 오류</td>
</tr>
<tr class="even">
<td>WP-PLATFORM-BASE-12</td>
<td>공통 상태·알림 컴포넌트</td>
<td>대기/진행/완료/오류/제한/승인대기 상태, Toast, Banner, Blocking Modal을 표준화한다.</td>
<td>FE/UX<br />
S3~S6<br />
08.31~10.23</td>
<td>PLATFORM-BASE-11</td>
<td>산출물: UI State Components<br />
완료: 각 화면이 동일 상태·오류 용어를 사용하고 접근성 속성을 포함한다.</td>
<td>WP-UI</td>
</tr>
<tr class="odd">
<td>WP-PLATFORM-BASE-13</td>
<td>공통 기반 통합시험</td>
<td>Auth-RBAC-Job-SSE-File-Flag-Audit의 종단 동작과 장애복구를 검증한다.</td>
<td>QA/BE/FE<br />
S6~S7<br />
10.12~11.06</td>
<td>PLATFORM-BASE-04~12</td>
<td>산출물: Platform E2E Report<br />
완료: 세션만료·권한부족·SSE 재연결·파일권한·Flag OFF 시나리오가 통과한다.</td>
<td>G3</td>
</tr>
</tbody>
</table>

### 7.2.3 WP-HWPX-CORE rhwp 소스 반입·HWPX Package·Document IR 기반

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-HWPX-CORE-01</td>
<td>upstream Tag/Commit 후보 선정</td>
<td>rhwp 기능·이슈·의존성·라이선스·빌드 가능성을 비교해 POC 대상 Tag/Commit을 선정한다.</td>
<td>DOC/ARCH<br />
S1~S1<br />
08.03~08.14</td>
<td>ADR-BASE-09</td>
<td>산출물: Upstream Evaluation Sheet<br />
완료: 선정근거와 제외대안, commit SHA, 의존버전이 기록된다.</td>
<td>ADR-15</td>
</tr>
<tr class="even">
<td>WP-HWPX-CORE-02</td>
<td>소스 아카이브 다운로드·무결성</td>
<td>선정 Tag/Commit의 ZIP/TAR 소스를 다운로드하고 SHA-256, 다운로드 URL, 일시를 기록한다.</td>
<td>DEVOPS/DOC<br />
S1~S1<br />
08.03~08.14</td>
<td>HWPX-CORE-01</td>
<td>산출물: Source Archive + hash<br />
완료: main 최신본이 아닌 고정 아카이브이며 해시가 UPSTREAM_VERSION.md와 일치한다.</td>
<td>ADR-15</td>
</tr>
<tr class="odd">
<td>WP-HWPX-CORE-03</td>
<td>UNE 내부 저장소 반입</td>
<td>원본을 third_party/rhwp에 반입하고 원본수정 금지영역·Adapter·patch queue를 분리한다.</td>
<td>DOC/DEVOPS<br />
S1~S2<br />
08.03~08.28</td>
<td>HWPX-CORE-02</td>
<td>산출물: Internal Source Baseline<br />
완료: 원본·UNE 모듈·패치의 변경이 Git 이력에서 명확히 구분된다.</td>
<td>ADR-15</td>
</tr>
<tr class="even">
<td>WP-HWPX-CORE-04</td>
<td>라이선스·SBOM·의존성 감사</td>
<td>MIT 고지, third-party license, npm/cargo lock, 취약점·checksum을 점검한다.</td>
<td>DEVOPS/QA<br />
S1~S2<br />
08.03~08.28</td>
<td>HWPX-CORE-03</td>
<td>산출물: LICENSE bundle/SBOM<br />
완료: 금지·미확인 라이선스와 임의 폰트 포함 0건, Critical 취약점 처리계획이 존재한다.</td>
<td>G15-6</td>
</tr>
<tr class="odd">
<td>WP-HWPX-CORE-05</td>
<td>Rust/WASM 재현빌드</td>
<td>고정 toolchain과 lock file로 core/editor WASM을 빌드하고 artifact hash를 생성한다.</td>
<td>DOC/DEVOPS<br />
S1~S2<br />
08.03~08.28</td>
<td>HWPX-CORE-03</td>
<td>산출물: Pinned WASM Build<br />
완료: 깨끗한 환경에서 동일 commit의 빌드가 재현되고 hash/빌드정보가 기록된다.</td>
<td>G15-6</td>
</tr>
<tr class="even">
<td>WP-HWPX-CORE-06</td>
<td>UNE rhwp Adapter 골격</td>
<td>Editor lifecycle, command, selection, document state, event를 감싸는 Adapter 인터페이스를 구현한다.</td>
<td>DOC/FE<br />
S2~S3<br />
08.17~09.11</td>
<td>HWPX-CORE-05</td>
<td>산출물: une-rhwp-adapter<br />
완료: UI가 rhwp 원시 API에 직접 종속되지 않고 Mock Adapter로 대체 가능하다.</td>
<td>ADR-01,04</td>
</tr>
<tr class="odd">
<td>WP-HWPX-CORE-07</td>
<td>HWPX 업로드 보안검증</td>
<td>ZIP signature, mimetype, content.hpf, 필수 Part, entry 수/크기, path traversal, DTD/XXE를 검사한다.</td>
<td>DOC/BE<br />
S2~S3<br />
08.17~09.11</td>
<td>HWPX-CORE-05</td>
<td>산출물: HWPX Package Reader<br />
완료: 악성 ZIP/XML fixture가 차단되고 정상파일의 원문 Part 순서·hash가 보존된다.</td>
<td>HWPX-1001~1004</td>
</tr>
<tr class="even">
<td>WP-HWPX-CORE-08</td>
<td>Header Reference Index</td>
<td>paraPr/charPr/style/numbering/bullet/binData 참조표를 색인한다.</td>
<td>DOC<br />
S2~S3<br />
08.17~09.11</td>
<td>HWPX-CORE-07</td>
<td>산출물: Style/Reference Index<br />
완료: 모든 section 참조가 인덱스에 연결되고 dangling 참조가 식별된다.</td>
<td>ADR-03</td>
</tr>
<tr class="odd">
<td>WP-HWPX-CORE-09</td>
<td>Canonical Document IR</td>
<td>Document/Section/Paragraph/Run/Table/StyleRef/UnknownPart와 rawXmlAnchor를 구현한다.</td>
<td>DOC/BE<br />
S2~S4<br />
08.17~09.25</td>
<td>HWPX-CORE-07,08</td>
<td>산출물: Document IR v1.0<br />
완료: 안정 ID·원문 Anchor·참조 인덱스·revision/sourceHash가 직렬화된다.</td>
<td>ADR-02~04</td>
</tr>
<tr class="even">
<td>WP-HWPX-CORE-10</td>
<td>미지원 Part·객체 보존맵</td>
<td>알 수 없는 XML·namespace·control·relationship을 raw fragment로 보존한다.</td>
<td>DOC<br />
S3~S4<br />
08.31~09.25</td>
<td>HWPX-CORE-09</td>
<td>산출물: SourcePreservationMap<br />
완료: 주변 문단을 읽어도 미지원 Part hash와 관계정보가 유지된다.</td>
<td>ADR-15 Preserve-only</td>
</tr>
<tr class="odd">
<td>WP-HWPX-CORE-11</td>
<td>호환성 등급 판정</td>
<td>NATIVE_EDIT/PRESERVE_ONLY/FLATTEN_EXPORT_ONLY/REJECT 기준과 경고·저장차단 정책을 구현한다.</td>
<td>DOC/ARCH<br />
S3~S4<br />
08.31~09.25</td>
<td>HWPX-CORE-09,10</td>
<td>산출물: Compatibility Report<br />
완료: Golden 샘플별 판정근거가 재현되고 손실위험 문서는 저장이 차단된다.</td>
<td>ADR-15</td>
</tr>
<tr class="even">
<td>WP-HWPX-CORE-12</td>
<td>HWPX Core POC Gate</td>
<td>샘플 10종 이상을 열고 IR 생성·렌더·재열기·호환성 보고서를 작성한다.</td>
<td>DOC/QA<br />
S4~S4<br />
09.14~09.25</td>
<td>HWPX-CORE-01~11</td>
<td>산출물: HWPX Core POC Report<br />
완료: G15-1 기본요건과 보안검증을 통과하고 다음 단계 결함목록이 확정된다.</td>
<td>G2/G15-1</td>
</tr>
</tbody>
</table>

### 7.2.4 WP-HWPX-ANALYZE 임의 HWPX Template Analyzer·Prototype Registry

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-HWPX-ANALYZE-01</td>
<td>Template Profile Schema</td>
<td>pageProfile, styleRoles, numbering/table profile, anchors, compatibility, confidence 구조를 확정한다.</td>
<td>DOC/ARCH<br />
S2~S2<br />
08.17~08.28</td>
<td>HWPX-CORE-09</td>
<td>산출물: Template Profile Schema<br />
완료: Schema와 Document IR 간 참조가 100% 정의되고 버전필드가 포함된다.</td>
<td>ADR-02</td>
</tr>
<tr class="even">
<td>WP-HWPX-ANALYZE-02</td>
<td>문단·글자 서식 특징 추출</td>
<td>문단위치, paraPr/charPr, 글꼴·크기·정렬·간격·indent·prefix 패턴을 특징벡터로 추출한다.</td>
<td>DOC<br />
S2~S3<br />
08.17~09.11</td>
<td>HWPX-ANALYZE-01</td>
<td>산출물: Style Feature Extractor<br />
완료: 샘플 문서에서 역할분류에 필요한 특징과 원문 참조가 보존된다.</td>
<td>ADR-02,03</td>
</tr>
<tr class="odd">
<td>WP-HWPX-ANALYZE-03</td>
<td>OutlinePatternAnalyzer</td>
<td>문자형 □/○/―, 자동번호, level, 선행공백, hanging indent, Enter/Tab 규칙을 분석한다.</td>
<td>DOC<br />
S3~S4<br />
08.31~09.25</td>
<td>HWPX-ANALYZE-02</td>
<td>산출물: Outline Pattern Model<br />
완료: 샘플 3종의 개요계층과 기호·공백·들여쓰기 조합이 구분된다.</td>
<td>G15-2</td>
</tr>
<tr class="even">
<td>WP-HWPX-ANALYZE-04</td>
<td>Paragraph Prototype Registry</td>
<td>TITLE/HEADING/OUTLINE/NOTE/BODY 역할별 원본문단 Prototype과 clone 규칙을 등록한다.</td>
<td>DOC/BE<br />
S3~S4<br />
08.31~09.25</td>
<td>HWPX-ANALYZE-02,03</td>
<td>산출물: Paragraph Prototype Registry<br />
완료: AI 텍스트 교체 시 원본 styleRef와 literalPrefix가 상속된다.</td>
<td>ADR-03</td>
</tr>
<tr class="odd">
<td>WP-HWPX-ANALYZE-05</td>
<td>Table Prototype Registry</td>
<td>표·셀 병합·테두리·배경·너비·셀 내부문단의 Prototype과 반복행 규칙을 등록한다.</td>
<td>DOC<br />
S3~S4<br />
08.31~09.25</td>
<td>HWPX-ANALYZE-02</td>
<td>산출물: Table Prototype Registry<br />
완료: 표 생성 시 새 스타일 조합 없이 원본 검증형 Prototype을 사용한다.</td>
<td>ADR-03</td>
</tr>
<tr class="even">
<td>WP-HWPX-ANALYZE-06</td>
<td>StaticRegionClassifier</td>
<td>머리말·꼬리말·표지·결재란·고정문구·필드를 편집금지/제한영역으로 분류한다.</td>
<td>DOC/BE<br />
S3~S4<br />
08.31~09.25</td>
<td>HWPX-ANALYZE-02</td>
<td>산출물: Static Region Map<br />
완료: 선택·AI ChangeSet이 고정영역을 침범할 때 차단 또는 승인요청한다.</td>
<td>ADR-04</td>
</tr>
<tr class="odd">
<td>WP-HWPX-ANALYZE-07</td>
<td>신뢰도·사용자 확인 규칙</td>
<td>AUTO/CONFIRM/LIMITED/REJECT 신뢰도 임계치와 확인 항목 최소화를 정의한다.</td>
<td>ARCH/DOC/UX<br />
S4~S4<br />
09.14~09.25</td>
<td>HWPX-ANALYZE-03~06</td>
<td>산출물: Analysis Confidence Policy<br />
완료: 낮은 신뢰도 역할만 사용자 확인 대상으로 노출되고 원문을 자동 덮어쓰지 않는다.</td>
<td>ADR-02</td>
</tr>
<tr class="even">
<td>WP-HWPX-ANALYZE-08</td>
<td>양식 분석 API</td>
<td>업로드→분석 Job→결과/경고→사용자 확인→Profile 확정 API를 구현한다.</td>
<td>BE/DOC<br />
S4~S5<br />
09.14~10.09</td>
<td>HWPX-ANALYZE-01~07</td>
<td>산출물: Template Analysis API<br />
완료: 취소·재시도·버전·audit가 적용되고 확정 Profile은 immutable version으로 저장된다.</td>
<td>G1/G3</td>
</tr>
<tr class="odd">
<td>WP-HWPX-ANALYZE-09</td>
<td>양식 확인 UI</td>
<td>역할 후보·개요패턴·제한객체·미리보기·확정/수정 화면을 구현한다.</td>
<td>FE/UX/DOC<br />
S4~S5<br />
09.14~10.09</td>
<td>HWPX-ANALYZE-08</td>
<td>산출물: Template Confirmation UI<br />
완료: 사용자가 문단 역할을 바꾸면 Profile revision과 변경근거가 저장된다.</td>
<td>SCR-TPL</td>
</tr>
<tr class="even">
<td>WP-HWPX-ANALYZE-10</td>
<td>분석 Golden Corpus 검증</td>
<td>최소양식·완성문서·문자개요·자동번호·표·미지원 객체 문서로 정확도와 재현성을 평가한다.</td>
<td>QA/DOC<br />
S5~S5<br />
09.28~10.09</td>
<td>HWPX-ANALYZE-01~09</td>
<td>산출물: Template Analysis Test Report<br />
완료: G15-1/2가 통과하고 오분류·제한항목이 결함목록에 등록된다.</td>
<td>G2/G15-1,2</td>
</tr>
</tbody>
</table>

### 7.2.5 WP-HWPX-EDIT rhwp 단일 편집 Surface·Selection·ChangeSet

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-HWPX-EDIT-01</td>
<td>Editor Workspace Embed</td>
<td>rhwp Editor를 React Workspace에 삽입하고 문서 로드·저장·상태동기화 경계를 구현한다.</td>
<td>FE/DOC<br />
S3~S4<br />
08.31~09.25</td>
<td>HWPX-CORE-06</td>
<td>산출물: Editor Shell<br />
완료: 별도 미리보기와 편집본이 분리되지 않고 DocumentState가 단일 원천으로 유지된다.</td>
<td>ADR-01</td>
</tr>
<tr class="even">
<td>WP-HWPX-EDIT-02</td>
<td>SelectionContext 모델</td>
<td>Cursor/Text Range/Block/Section 선택을 paragraphId·runId·UTF-16 offset·revision으로 정규화한다.</td>
<td>DOC/BE<br />
S3~S4<br />
08.31~09.25</td>
<td>HWPX-CORE-09,HWPX-EDIT-01</td>
<td>산출물: SelectionContext<br />
완료: 화면 좌표에 의존하지 않고 저장·재열기 후에도 대상 식별이 가능하다.</td>
<td>ADR-04</td>
</tr>
<tr class="odd">
<td>WP-HWPX-EDIT-03</td>
<td>SelectionResolver</td>
<td>DOM/editor selection을 Document IR 범위로 변환하고 경계·정적영역·잠금·표셀 범위를 검증한다.</td>
<td>DOC/FE<br />
S4~S5<br />
09.14~10.09</td>
<td>HWPX-EDIT-02</td>
<td>산출물: SelectionResolver<br />
완료: 잘못된 offset·교차 section·고정영역 선택이 오류코드로 차단된다.</td>
<td>ADR-04</td>
</tr>
<tr class="even">
<td>WP-HWPX-EDIT-04</td>
<td>DocumentCommand 모델</td>
<td>Insert/Replace/Delete/Split/Merge/SetRole/ClonePrototype/Table operation 명령을 정의한다.</td>
<td>ARCH/DOC/BE<br />
S4~S5<br />
09.14~10.09</td>
<td>HWPX-EDIT-02</td>
<td>산출물: Document Command Schema<br />
완료: 명령이 provider-neutral하고 inverse operation 생성에 필요한 정보를 포함한다.</td>
<td>ADR-03,04</td>
</tr>
<tr class="odd">
<td>WP-HWPX-EDIT-05</td>
<td>ChangeSetExecutor</td>
<td>baseRevision·selectionSnapshotHash를 확인하고 여러 명령을 원자적으로 적용한다.</td>
<td>DOC/BE<br />
S4~S6<br />
09.14~10.23</td>
<td>HWPX-EDIT-04</td>
<td>산출물: ChangeSet Executor<br />
완료: 부분적용 0, 충돌 시 원본상태 유지, 새 revision과 inverse ops가 생성된다.</td>
<td>ADR-04</td>
</tr>
<tr class="even">
<td>WP-HWPX-EDIT-06</td>
<td>Revision 충돌 처리</td>
<td>사용자 편집 중 AI 결과 도착, 문서 재로드, 다른 Job 완료 시 충돌 탐지·재기준·취소 흐름을 구현한다.</td>
<td>BE/FE/DOC<br />
S5~S6<br />
09.28~10.23</td>
<td>HWPX-EDIT-05</td>
<td>산출물: Conflict Resolution Flow<br />
완료: 사용자 수정이 자동 덮어써지지 않고 재생성/비교/취소 선택이 제공된다.</td>
<td>E2E-16</td>
</tr>
<tr class="odd">
<td>WP-HWPX-EDIT-07</td>
<td>Diff Viewer</td>
<td>Block/Section 단위 추가·삭제·교체·서식역할 변화를 비교하고 선택적 적용을 지원한다.</td>
<td>FE/DOC/UX<br />
S5~S6<br />
09.28~10.23</td>
<td>HWPX-EDIT-05</td>
<td>산출물: Diff UI<br />
완료: 사용자 잠금·직접수정 영역이 강조되고 부분적용 후 참조무결성이 유지된다.</td>
<td>ADR-04</td>
</tr>
<tr class="even">
<td>WP-HWPX-EDIT-08</td>
<td>Undo/Redo Stack</td>
<td>직접편집과 ChangeSet을 동일 이력으로 관리하고 세션 내 Undo/Redo·저장기준점을 구현한다.</td>
<td>DOC/FE<br />
S5~S7<br />
09.28~11.06</td>
<td>HWPX-EDIT-05</td>
<td>산출물: Undo/Redo Engine<br />
완료: 복합 명령을 역순 복원하고 redo 후 동일 document hash를 재현한다.</td>
<td>G15-3</td>
</tr>
<tr class="odd">
<td>WP-HWPX-EDIT-09</td>
<td>generation lock</td>
<td>AI 생성대상 Block/Section 잠금, 완료영역 즉시편집, 중지·취소·실패 해제를 구현한다.</td>
<td>BE/FE<br />
S5~S7<br />
09.28~11.06</td>
<td>PLATFORM-BASE-07,HWPX-EDIT-05</td>
<td>산출물: Generation Lock<br />
완료: 동일 Block 동시수정이 차단되고 다른 완료영역은 계속 편집 가능하다.</td>
<td>ADR-01,04</td>
</tr>
<tr class="even">
<td>WP-HWPX-EDIT-10</td>
<td>개요 Enter/Tab/Shift+Tab</td>
<td>문자형/자동번호 개요의 새 문단, level 이동, prefix/indent 상속을 구현한다.</td>
<td>DOC/FE<br />
S6~S7<br />
10.12~11.06</td>
<td>HWPX-ANALYZE-03,HWPX-EDIT-08</td>
<td>산출물: Outline Editing<br />
완료: RT-D/E 대상 동작이 Prototype 규칙과 일치하고 번호참조가 깨지지 않는다.</td>
<td>G15-3</td>
</tr>
<tr class="odd">
<td>WP-HWPX-EDIT-11</td>
<td>표 직접편집</td>
<td>셀 텍스트, 행 추가/삭제, 병합범위 제한, Prototype 기반 표 삽입을 구현한다.</td>
<td>DOC/FE<br />
S6~S8<br />
10.12~11.20</td>
<td>HWPX-ANALYZE-05,HWPX-EDIT-08</td>
<td>산출물: Table Editing<br />
완료: 지원 범위 내 span/border/width가 유지되고 미지원 조작은 제한 메시지를 제공한다.</td>
<td>RT-C</td>
</tr>
<tr class="even">
<td>WP-HWPX-EDIT-12</td>
<td>AI Operation→ChangeSet 매핑</td>
<td>GENERATE_SECTION/REWRITE/EXPAND/SUMMARIZE/CONVERT_TO_TABLE 결과를 검증 후 명령으로 변환한다.</td>
<td>BE/DOC<br />
S6~S8<br />
10.12~11.20</td>
<td>HWPX-EDIT-04~09</td>
<td>산출물: AI Change Mapper<br />
완료: AI 응답에 HWPX XML/style ID가 없어도 Prototype과 styleRole로 정확히 반영된다.</td>
<td>ADR-03/Contract</td>
</tr>
<tr class="odd">
<td>WP-HWPX-EDIT-13</td>
<td>편집 E2E 검증</td>
<td>직접편집·AI편집·충돌·잠금·Diff·Undo·개요·표 시나리오를 통합 검증한다.</td>
<td>QA/DOC/FE<br />
S8~S8<br />
11.09~11.20</td>
<td>HWPX-EDIT-01~12</td>
<td>산출물: Editor E2E Report<br />
완료: G15-3와 E2E-16을 통과하고 사용자수정 손실 0건이다.</td>
<td>G3</td>
</tr>
</tbody>
</table>

### 7.2.6 WP-HWPX-SERIALIZE 보존형 HWPX 저장·Reference Rebuild·Export

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-HWPX-SERIALIZE-01</td>
<td>XML Delta Writer</td>
<td>변경 Paragraph/Table만 XML에 반영하고 rawXmlAnchor 기준으로 원본 순서·namespace를 보존한다.</td>
<td>DOC<br />
S4~S6<br />
09.14~10.23</td>
<td>HWPX-CORE-09,HWPX-EDIT-05</td>
<td>산출물: XML Delta Writer<br />
완료: 무편집 저장 시 원본과 의미적으로 동일하고 비대상 Part 변경이 최소화된다.</td>
<td>ADR-15</td>
</tr>
<tr class="even">
<td>WP-HWPX-SERIALIZE-02</td>
<td>Reference Rebuilder</td>
<td>paraPr/charPr/style/numbering/bullet/binData/relationship 참조를 재색인·검증한다.</td>
<td>DOC<br />
S5~S7<br />
09.28~11.06</td>
<td>HWPX-SERIALIZE-01</td>
<td>산출물: Reference Rebuilder<br />
완료: dangling reference 0, ID 충돌 0, 불필요한 ID 재번호화가 없다.</td>
<td>G15-4</td>
</tr>
<tr class="odd">
<td>WP-HWPX-SERIALIZE-03</td>
<td>Package Writer</td>
<td>mimetype 우선순위, content.hpf, 관계파일, 압축방식, 원본 Part·unknown Part를 패키징한다.</td>
<td>DOC<br />
S5~S7<br />
09.28~11.06</td>
<td>HWPX-SERIALIZE-01,02</td>
<td>산출물: HWPX Package Writer<br />
완료: 한컴/HWPX 규칙을 만족하고 원본 unknown part hash가 유지된다.</td>
<td>ADR-15</td>
</tr>
<tr class="even">
<td>WP-HWPX-SERIALIZE-04</td>
<td>Prototype Clone 저장</td>
<td>새 문단·표에 원본 Prototype styleRef와 literalPrefix·indent·numbering을 적용한다.</td>
<td>DOC<br />
S5~S7<br />
09.28~11.06</td>
<td>HWPX-ANALYZE-04,05,HWPX-SERIALIZE-01</td>
<td>산출물: Prototype Serializer<br />
완료: 샘플 3종에서 기호 앞 공백·서식·표 스타일 회귀가 없다.</td>
<td>G15-2</td>
</tr>
<tr class="odd">
<td>WP-HWPX-SERIALIZE-05</td>
<td>미지원 객체 보존·저장차단</td>
<td>PRESERVE_ONLY 객체는 원문 복사하고 손실가능 상태는 원본 HWPX 저장을 차단한다.</td>
<td>DOC/BE<br />
S5~S7<br />
09.28~11.06</td>
<td>HWPX-CORE-10,11</td>
<td>산출물: Compatibility Save Policy<br />
완료: 객체 삭제·관계손실 0, 사용자에게 제한사유와 가능한 Export가 표시된다.</td>
<td>RT-F</td>
</tr>
<tr class="even">
<td>WP-HWPX-SERIALIZE-06</td>
<td>Save API·Revision</td>
<td>documentId/baseRevision/targetFormat/idempotencyKey를 받아 원자적 저장·버전·hash를 생성한다.</td>
<td>BE/DOC<br />
S6~S8<br />
10.12~11.20</td>
<td>PLATFORM-BASE-09,HWPX-SERIALIZE-01~05</td>
<td>산출물: Document Save API<br />
완료: 중복요청이 새 버전을 만들지 않고 실패 시 이전 승인본이 유지된다.</td>
<td>API-DOC-SAVE</td>
</tr>
<tr class="odd">
<td>WP-HWPX-SERIALIZE-07</td>
<td>PDF/DOCX 보조 Export</td>
<td>HWPX가 최종 원본임을 유지하면서 PDF 미리보기·인쇄와 DOCX 보조 Export 경계를 구현한다.</td>
<td>BE/DOC<br />
S7~S9<br />
10.26~12.04</td>
<td>HWPX-SERIALIZE-06</td>
<td>산출물: Export Service<br />
완료: 원본 HWPX와 Export 사본의 버전·hash·생성도구가 구분된다.</td>
<td>3차년도 export</td>
</tr>
<tr class="even">
<td>WP-HWPX-SERIALIZE-08</td>
<td>자동 ValidationReport</td>
<td>Package/Schema/Reference/Semantic/Style/Compatibility 검증결과와 diff artifact를 생성한다.</td>
<td>DOC/QA<br />
S6~S8<br />
10.12~11.20</td>
<td>HWPX-SERIALIZE-02~06</td>
<td>산출물: ValidationReport<br />
완료: 치명오류 시 다운로드/승인이 차단되고 경고·허용항목이 구분된다.</td>
<td>ADR-16 Track A</td>
</tr>
<tr class="odd">
<td>WP-HWPX-SERIALIZE-09</td>
<td>저장 성능 최적화</td>
<td>50쪽 일반문서의 저장·재열기·메모리 사용을 측정하고 XML 전체재작성 병목을 개선한다.</td>
<td>DOC/QA<br />
S8~S9<br />
11.09~12.04</td>
<td>HWPX-SERIALIZE-01~08</td>
<td>산출물: Performance Report<br />
완료: 목표치와 실측치·병목·허용범위가 기록되고 치명 메모리 누수가 없다.</td>
<td>G15-5</td>
</tr>
<tr class="even">
<td>WP-HWPX-SERIALIZE-10</td>
<td>Serializer 통합 Gate</td>
<td>원본→편집→저장→rhwp 재열기와 무편집/편집/미지원 객체 Corpus를 검증한다.</td>
<td>QA/DOC<br />
S9~S9<br />
11.23~12.04</td>
<td>HWPX-SERIALIZE-01~09</td>
<td>산출물: Serializer Gate Report<br />
완료: G15-4 통과, 텍스트·표·필드 손실 0, 한컴 Track B 대상 RC가 생성된다.</td>
<td>G2/G4</td>
</tr>
</tbody>
</table>

### 7.2.7 WP-HWPX-QA 한컴 HWPX 호환성 Round-trip·배포 승인

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-HWPX-QA-01</td>
<td>Golden Corpus 선정</td>
<td>최소양식, 완성문서, 문자개요, 자동번호, 표/병합, 이미지/수식/필드/미지원 객체 문서를 버전관리한다.</td>
<td>QA/DOC<br />
S3~S4<br />
08.31~09.25</td>
<td>HWPX-CORE-12</td>
<td>산출물: Golden Corpus v1.0<br />
완료: 문서별 기대결과·허용영역·저작권/보안등급·hash가 등록된다.</td>
<td>ADR-16</td>
</tr>
<tr class="even">
<td>WP-HWPX-QA-02</td>
<td>Track A CI Suite</td>
<td>ZIP/XML/Schema/Reference/Semantic/rhwp reopen/visual diff/editor E2E를 자동화한다.</td>
<td>QA/DOC/DEVOPS<br />
S4~S8<br />
09.14~11.20</td>
<td>HWPX-QA-01</td>
<td>산출물: HWPX CI Test Suite<br />
완료: PR과 RC에서 자동 실행되고 실패 artifact가 Evidence Repository에 남는다.</td>
<td>ADR-16 Track A</td>
</tr>
<tr class="odd">
<td>WP-HWPX-QA-03</td>
<td>Visual Diff Mask</td>
<td>변경대상 Block의 허용영역 mask와 비대상 페이지·표·폰트 회귀 판정규칙을 구현한다.</td>
<td>QA/DOC<br />
S5~S8<br />
09.28~11.20</td>
<td>HWPX-QA-01,02</td>
<td>산출물: Visual Diff Rules<br />
완료: 픽셀 완전일치가 아닌 구조적 허용영역 기준으로 false positive를 통제한다.</td>
<td>ADR-16</td>
</tr>
<tr class="even">
<td>WP-HWPX-QA-04</td>
<td>Windows/한컴 시험환경 기준선</td>
<td>OS/locale/배율/해상도/한컴 build/폰트 manifest/VM snapshot과 정식 사용권을 확정한다.</td>
<td>QA/DEVOPS<br />
S4~S6<br />
09.14~10.23</td>
<td>ADR-BASE-08</td>
<td>산출물: Hancom Test Environment Baseline<br />
완료: 환경 JSON과 snapshot ID가 기록되고 변경 시 기준선 재승인 절차가 있다.</td>
<td>ADR-16 Track B</td>
</tr>
<tr class="odd">
<td>WP-HWPX-QA-05</td>
<td>RT-A 무편집 저장 시험</td>
<td>원본→rhwp open/save→한컴 open의 무손실·경고·복구 여부를 검증한다.</td>
<td>QA/DOC<br />
S6~S8<br />
10.12~11.20</td>
<td>HWPX-SERIALIZE-08,HWPX-QA-04</td>
<td>산출물: RT-A Report<br />
완료: 경고/복구모드 0, 비대상 손실 0, 원본 baseline과 비교가 가능하다.</td>
<td>RT-A</td>
</tr>
<tr class="even">
<td>WP-HWPX-QA-06</td>
<td>RT-B AI 삽입 양방향 시험</td>
<td>Analyze→AI insert→save→한컴 open/save→rhwp reopen의 Prototype 상속과 양방향 호환성을 검증한다.</td>
<td>QA/DOC<br />
S7~S9<br />
10.26~12.04</td>
<td>HWPX-QA-05</td>
<td>산출물: RT-B Report<br />
완료: 텍스트·개요·서식·참조·재열기 오류 0이며 source/output/resave가 보관된다.</td>
<td>RT-B</td>
</tr>
<tr class="odd">
<td>WP-HWPX-QA-07</td>
<td>RT-C/D/E 구조편집 시험</td>
<td>표/병합, 문자개요, 자동번호 추가·삭제의 저장·재열기 회귀를 검증한다.</td>
<td>QA/DOC<br />
S8~S10<br />
11.09~12.18</td>
<td>HWPX-EDIT-10,11,HWPX-QA-04</td>
<td>산출물: RT-C/D/E Report<br />
완료: span·border·width·literalPrefix·numbering level의 치명 회귀 0건이다.</td>
<td>RT-C~E</td>
</tr>
<tr class="even">
<td>WP-HWPX-QA-08</td>
<td>RT-F/G 보존·사용자보호 시험</td>
<td>미지원 객체 주변편집과 사용자수정 Block+Section 재생성에서 원문객체·잠금영역 불변을 검증한다.</td>
<td>QA/DOC<br />
S9~S10<br />
11.23~12.18</td>
<td>HWPX-CORE-10,HWPX-EDIT-06~09</td>
<td>산출물: RT-F/G Report<br />
완료: 객체 XML/relationship/hash와 사용자 수정영역이 보존된다.</td>
<td>RT-F/G</td>
</tr>
<tr class="odd">
<td>WP-HWPX-QA-09</td>
<td>Round-trip 결과판정·결함관리</td>
<td>치명/주요/허용차이를 분류하고 source/output/resave/diff/report를 testRunId로 묶는다.</td>
<td>QA/PM<br />
S8~S11<br />
11.09~12.31</td>
<td>HWPX-QA-05~08</td>
<td>산출물: Round-trip ValidationReport<br />
완료: 실패가 재현 가능하고 배포 보류·재시험·예외승인 권한이 정의된다.</td>
<td>G4</td>
</tr>
<tr class="even">
<td>WP-HWPX-QA-10</td>
<td>운영기능 비포함 검증</td>
<td>일반 사용자 저장 요청이 한컴 GUI/Windows Agent를 호출하지 않고 UNE 자동검증만 수행하는지 검증한다.</td>
<td>QA/BE/DEVOPS<br />
S8~S10<br />
11.09~12.18</td>
<td>HWPX-SERIALIZE-06,HWPX-QA-04</td>
<td>산출물: Runtime Boundary Test<br />
완료: 운영 API/로그에 한컴 호출이 0건이며 Track B는 QA 파이프라인에서만 실행된다.</td>
<td>ADR-16 정정</td>
</tr>
<tr class="odd">
<td>WP-HWPX-QA-11</td>
<td>RC 배포 승인</td>
<td>최종 RC의 Track A/Track B 전 Corpus 결과와 환경·폰트·hash를 검토해 배포 승인한다.</td>
<td>연구소장/PM/QA<br />
S10~S11<br />
12.07~12.31</td>
<td>HWPX-QA-01~10</td>
<td>산출물: Hancom Compatibility Release Approval<br />
완료: 치명손실 0, 미해결 예외 승인 0 또는 공식 승인, 증거 bundle 완비 시 통과한다.</td>
<td>G4/G6</td>
</tr>
</tbody>
</table>

### 7.2.8 WP-PLAN-T3Q 재난안전계획서 T3Q RPT-001/002 연계·생성

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-PLAN-T3Q-01</td>
<td>RPT-001/002 명세 기준선</td>
<td>Endpoint, 인증, 요청/응답, Job/SSE, 오류, 샘플을 수집하고 2차년도 요구사항과 Gap을 정리한다.</td>
<td>ARCH/BE<br />
S1~S2<br />
08.03~08.28</td>
<td>ADR-BASE-08</td>
<td>산출물: T3Q Plan API Contract Matrix<br />
완료: 필수필드·미확정필드·Mock 정책과 협의질문이 확정된다.</td>
<td>ADR-05</td>
</tr>
<tr class="even">
<td>WP-PLAN-T3Q-02</td>
<td>T3Q Plan Adapter</td>
<td>T3Q 원시 스키마를 UNE Document AI Contract의 Outline/Block으로 변환하는 Adapter를 구현한다.</td>
<td>BE<br />
S2~S4<br />
08.17~09.25</td>
<td>PLAN-T3Q-01,ADR-BASE-06</td>
<td>산출물: T3qPlanProvider<br />
완료: UI·Document Engine이 T3Q 필드명을 직접 참조하지 않는다.</td>
<td>ADR-05</td>
</tr>
<tr class="odd">
<td>WP-PLAN-T3Q-03</td>
<td>인증·Timeout·Circuit</td>
<td>T3Q 토큰 전달, service credential, timeout, retry, circuit breaker, correlationId를 구현한다.</td>
<td>BE/DEVOPS<br />
S2~S4<br />
08.17~09.25</td>
<td>PLATFORM-BASE-03,04,PLAN-T3Q-02</td>
<td>산출물: Provider Resilience<br />
완료: 인증/5xx/timeout/부분응답이 UNE 오류 taxonomy로 구분된다.</td>
<td>G1</td>
</tr>
<tr class="even">
<td>WP-PLAN-T3Q-04</td>
<td>목차 요청 매핑</td>
<td>기준정보, 재난유형, 관리단계, 목적, 역할, 독자, 지침, 표현규칙을 RPT-001 요청으로 변환한다.</td>
<td>BE/FE<br />
S2~S4<br />
08.17~09.25</td>
<td>PLAN-T3Q-01,02</td>
<td>산출물: Outline Request Mapper<br />
완료: 필수값 검증과 기준정보 snapshot/audit가 완료된 요청만 전송된다.</td>
<td>UFR-INPUT/TABLE</td>
</tr>
<tr class="odd">
<td>WP-PLAN-T3Q-05</td>
<td>목차 응답 검증·편집</td>
<td>중복/순환/깊이/빈 제목을 검증하고 Outline Editor에서 추가·수정·삭제·재요청을 지원한다.</td>
<td>BE/FE/DOC<br />
S3~S5<br />
08.31~10.09</td>
<td>PLAN-T3Q-04</td>
<td>산출물: Outline Contract Validator/UI<br />
완료: outlineLevel/styleRole만 저장하고 HWPX 기호·공백은 생성하지 않는다.</td>
<td>ADR-03</td>
</tr>
<tr class="even">
<td>WP-PLAN-T3Q-06</td>
<td>본문 생성 Job</td>
<td>확정 목차와 기준정보를 RPT-002로 전송하고 Section/Block 단위 진행·중지·재시도를 관리한다.</td>
<td>BE<br />
S3~S5<br />
08.31~10.09</td>
<td>PLAN-T3Q-01~05,PLATFORM-BASE-07</td>
<td>산출물: Content Generation Job<br />
완료: 대기/생성중/중단/완료/오류 상태와 완료 Block 수신이 재현된다.</td>
<td>UFR-CONTENT</td>
</tr>
<tr class="odd">
<td>WP-PLAN-T3Q-07</td>
<td>부분결과·완료영역 반영</td>
<td>완료된 Section/Block을 rhwp DocumentState에 즉시 ChangeSet으로 반영하고 generation lock을 해제한다.</td>
<td>BE/FE/DOC<br />
S4~S6<br />
09.14~10.23</td>
<td>PLAN-T3Q-06,HWPX-EDIT-09,12</td>
<td>산출물: Incremental Document Apply<br />
완료: 사용자는 완료영역부터 편집하고 실패영역만 재요청할 수 있다.</td>
<td>ADR-01</td>
</tr>
<tr class="even">
<td>WP-PLAN-T3Q-08</td>
<td>취소·재생성·사용자보호</td>
<td>Job 취소, Section 재생성, baseRevision 충돌, 사용자 수정 Block 보호와 Diff 적용을 구현한다.</td>
<td>BE/FE<br />
S5~S7<br />
09.28~11.06</td>
<td>PLAN-T3Q-06,07,HWPX-EDIT-05~09</td>
<td>산출물: Plan Regeneration Flow<br />
완료: 사용자 편집이 자동 덮어써지지 않고 재생성 범위와 영향이 표시된다.</td>
<td>ADR-04</td>
</tr>
<tr class="odd">
<td>WP-PLAN-T3Q-09</td>
<td>Citation·근거 표시</td>
<td>T3Q가 제공한 근거를 EvidenceRef로 변환하고 문장/Block에 연결하며 미제공 상태를 warning으로 표시한다.</td>
<td>BE/FE<br />
S4~S7<br />
09.14~11.06</td>
<td>PLAN-T3Q-02</td>
<td>산출물: Plan Evidence Panel<br />
완료: 근거유무·출처·페이지·score가 표시되고 출처조작 없이 원문식별자를 보존한다.</td>
<td>Contract</td>
</tr>
<tr class="even">
<td>WP-PLAN-T3Q-10</td>
<td>계획서 저장·Export 연결</td>
<td>생성·편집 결과를 Template Prototype으로 HWPX 저장하고 PDF/DOCX 보조 Export에 연결한다.</td>
<td>BE/DOC/FE<br />
S6~S8<br />
10.12~11.20</td>
<td>PLAN-T3Q-07~09,HWPX-SERIALIZE-06~08</td>
<td>산출물: Plan HWPX Output<br />
완료: 목차·본문·사용자편집이 동일 revision의 HWPX에 반영된다.</td>
<td>G3/G4</td>
</tr>
<tr class="odd">
<td>WP-PLAN-T3Q-11</td>
<td>계획서 오류·복구 UX</td>
<td>T3Q 장애·Schema 오류·부분실패·인증만료에서 수동편집·기존문서 저장은 유지하도록 구현한다.</td>
<td>FE/BE/UX<br />
S5~S8<br />
09.28~11.20</td>
<td>PLAN-T3Q-03,06</td>
<td>산출물: Plan Error/Recovery UX<br />
완료: 외부장애가 편집기 전체를 중단시키지 않고 재시도 가능 범위가 명확하다.</td>
<td>P-06</td>
</tr>
<tr class="even">
<td>WP-PLAN-T3Q-12</td>
<td>UNI 미호출 통합검증</td>
<td>계획서 목차·본문·재생성 흐름에서 UNI endpoint와 챗봇 API 호출이 발생하지 않음을 로그로 검증한다.</td>
<td>QA/BE<br />
S8~S8<br />
11.09~11.20</td>
<td>PLAN-T3Q-01~11</td>
<td>산출물: Plan Provider Boundary Report<br />
완료: 계획서 E2E의 외부호출이 RPT-001/002로 제한되고 위반 0건이다.</td>
<td>ADR-05/E2E-22</td>
</tr>
</tbody>
</table>

### 7.2.9 WP-SITUATION SituationContext·공식 Provider·Snapshot

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-SITUATION-01</td>
<td>SituationContext Schema</td>
<td>contextId, incidentId, mode, revision, location, timeWindow, facts, conflicts, providerStatus, snapshot을 확정한다.</td>
<td>ARCH/BE<br />
S2~S3<br />
08.17~09.11</td>
<td>ADR-BASE-06</td>
<td>산출물: SituationContext Schema v1.0<br />
완료: JSON Schema 검증과 불변/변경 규칙이 정의된다.</td>
<td>ADR-08,11</td>
</tr>
<tr class="even">
<td>WP-SITUATION-02</td>
<td>Incident/Context CRUD</td>
<td>실재난·훈련 mode, 기본정보, revision, 상태전이를 구현한다.</td>
<td>BE/FE<br />
S2~S4<br />
08.17~09.25</td>
<td>SITUATION-01</td>
<td>산출물: Situation API/UI Base<br />
완료: 동일 incident의 context revision이 원자적으로 증가하고 권한검사가 적용된다.</td>
<td>SCR-SIT</td>
</tr>
<tr class="odd">
<td>WP-SITUATION-03</td>
<td>SituationFact Provenance</td>
<td>observedAt/issuedAt/retrievedAt, provider, sourceId/url/hash, parserVersion, rawPayloadRef를 저장한다.</td>
<td>BE<br />
S2~S4<br />
08.17~09.25</td>
<td>SITUATION-01</td>
<td>산출물: Fact/Provenance Store<br />
완료: 원천 Fact는 불변이며 사용자 수정은 originalFactId를 가진 파생 Fact로 생성된다.</td>
<td>ADR-08</td>
</tr>
<tr class="even">
<td>WP-SITUATION-04</td>
<td>사용자 직접입력·현장보고</td>
<td>기상·특보·피해·통제·현장보고·대응단계를 수동 입력하고 증거파일을 첨부한다.</td>
<td>FE/BE<br />
S3~S5<br />
08.31~10.09</td>
<td>SITUATION-02,03</td>
<td>산출물: Manual Fact UI/API<br />
완료: 외부 Provider 전부 OFF 상태에서도 Snapshot 확정이 가능하다.</td>
<td>ADR-11 완료기준</td>
</tr>
<tr class="odd">
<td>WP-SITUATION-05</td>
<td>KMA Forecast Adapter</td>
<td>공식 예보 응답을 WEATHER_FORECAST/OBSERVATION Fact 후보로 변환한다.</td>
<td>BE<br />
S3~S5<br />
08.31~10.09</td>
<td>SITUATION-01,03</td>
<td>산출물: KMA Forecast Adapter<br />
완료: 단위·시각·지역·freshness 변환과 timeout/empty 처리 Contract Test를 통과한다.</td>
<td>ADR-09,11</td>
</tr>
<tr class="even">
<td>WP-SITUATION-06</td>
<td>KMA Warning Adapter</td>
<td>기상특보 발효·해제·수정·지역을 WEATHER_WARNING Fact 후보로 변환한다.</td>
<td>BE<br />
S3~S5<br />
08.31~10.09</td>
<td>SITUATION-01,03</td>
<td>산출물: KMA Warning Adapter<br />
완료: 특보 상태변경과 issuedAt/observedAt 의미가 보존된다.</td>
<td>ADR-09,11</td>
</tr>
<tr class="odd">
<td>WP-SITUATION-07</td>
<td>MOIS Message Adapter</td>
<td>재난문자 식별자·발송시각·지역·본문·분류를 DISASTER_MESSAGE로 변환한다.</td>
<td>BE<br />
S3~S6<br />
08.31~10.23</td>
<td>SITUATION-01,03</td>
<td>산출물: MOIS Message Adapter<br />
완료: 중복문자와 수정/재발송을 구분하고 개인정보·원문정책을 적용한다.</td>
<td>ADR-09,11</td>
</tr>
<tr class="even">
<td>WP-SITUATION-08</td>
<td>Normalizer·Deduplicator</td>
<td>Provider별 단위·코드·지역·재난유형을 canonical로 변환하고 중복그룹을 만든다.</td>
<td>BE/ARCH<br />
S4~S6<br />
09.14~10.23</td>
<td>SITUATION-05~07</td>
<td>산출물: Situation Normalizer<br />
완료: 동일사건의 다중 원천을 자동 삭제하지 않고 group/conflict로 보존한다.</td>
<td>ADR-11</td>
</tr>
<tr class="odd">
<td>WP-SITUATION-09</td>
<td>Freshness·Reliability 정책</td>
<td>Fact category별 TTL, CURRENT/STALE/EXPIRED, 공식/보조/사용자 신뢰도 표시를 구현한다.</td>
<td>ARCH/BE<br />
S4~S6<br />
09.14~10.23</td>
<td>SITUATION-08</td>
<td>산출물: Fact Quality Policy<br />
완료: 기상관측과 재난문자를 동일 TTL로 처리하지 않고 화면에 근거를 표시한다.</td>
<td>ADR-11</td>
</tr>
<tr class="even">
<td>WP-SITUATION-10</td>
<td>ProviderStatus·Circuit</td>
<td>마지막 성공시각, 최근오류, DEGRADED/UNAVAILABLE, cache 여부와 circuit breaker를 관리한다.</td>
<td>BE/FE<br />
S4~S6<br />
09.14~10.23</td>
<td>PLATFORM-BASE-06,SITUATION-05~07</td>
<td>산출물: Provider Health UI/API<br />
완료: 한 Provider 장애가 다른 조회·수동입력·기존 Snapshot을 중단시키지 않는다.</td>
<td>ADR-11</td>
</tr>
<tr class="odd">
<td>WP-SITUATION-11</td>
<td>충돌 비교·사용자 선택</td>
<td>사용자 입력과 외부 후보의 값·시각·출처 차이를 비교하고 선택·수정 이력을 기록한다.</td>
<td>FE/BE/UX<br />
S5~S7<br />
09.28~11.06</td>
<td>SITUATION-08~10</td>
<td>산출물: Fact Conflict UI<br />
완료: 자동 덮어쓰기 없이 선택이 감사되고 원천값이 삭제되지 않는다.</td>
<td>E2E-19</td>
</tr>
<tr class="even">
<td>WP-SITUATION-12</td>
<td>SituationSnapshot 확정</td>
<td>선택 Fact 집합, confirmer, contextRevision, hash를 불변 Snapshot으로 생성한다.</td>
<td>BE/FE<br />
S5~S7<br />
09.28~11.06</td>
<td>SITUATION-02~11</td>
<td>산출물: Snapshot Service<br />
완료: 승인 후 수정은 새 context revision/정정 Snapshot으로만 처리된다.</td>
<td>ADR-08</td>
</tr>
<tr class="odd">
<td>WP-SITUATION-13</td>
<td>SafeKorea on-demand 보조</td>
<td>Feature Flag·allowlist·TTL·DOM fingerprint·parserVersion·fallback을 적용한 요청형 Collector를 구현한다.</td>
<td>BE/DEVOPS<br />
S6~S8<br />
10.12~11.20</td>
<td>PLATFORM-BASE-10,SITUATION-03</td>
<td>산출물: SafeKorea Adapter POC<br />
완료: Flag OFF 네트워크 0건, DOM 변경 시 자동중단·원문링크·수동입력을 제공한다.</td>
<td>ADR-14</td>
</tr>
<tr class="even">
<td>WP-SITUATION-14</td>
<td>Naver 사용자 요청형 Stub</td>
<td>스케줄 수집을 금지하고 URL Import/1회 조회 계약과 감사·기본 OFF 설정만 구현한다.</td>
<td>BE/FE<br />
S6~S8<br />
10.12~11.20</td>
<td>PLATFORM-BASE-10</td>
<td>산출물: Naver Provider Stub<br />
완료: 운영스케줄 호출 0건이며 승인 전 실제수집이 비활성화된다.</td>
<td>ADR-14</td>
</tr>
<tr class="odd">
<td>WP-SITUATION-15</td>
<td>Situation E2E</td>
<td>정상·부분실패·전체실패·충돌·수동입력·Snapshot 정정 시나리오를 검증한다.</td>
<td>QA/BE/FE<br />
S8~S8<br />
11.09~11.20</td>
<td>SITUATION-01~14</td>
<td>산출물: Situation E2E Report<br />
완료: E2E-17~19와 ADR-11 완료기준을 통과한다.</td>
<td>G3</td>
</tr>
</tbody>
</table>

### 7.2.10 WP-UNI-RAG UNI Upload/Search/chat-json·SOP Mapper POC

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-UNI-RAG-01</td>
<td>UNI Gateway 경계</td>
<td>브라우저 직접호출을 금지하고 service credential, allowlist, 요청크기, timeout, rate limit를 적용한다.</td>
<td>BE/DEVOPS<br />
S2~S3<br />
08.17~09.11</td>
<td>PLATFORM-BASE-03</td>
<td>산출물: UNI Gateway<br />
완료: 외부 endpoint/credential이 프론트에 노출되지 않고 요청이 감사된다.</td>
<td>ADR-13</td>
</tr>
<tr class="even">
<td>WP-UNI-RAG-02</td>
<td>문서 업로드 Adapter</td>
<td>POST /documents/upload의 파일·메타·JWT·비동기 응답을 UNE Job으로 변환한다.</td>
<td>BE<br />
S2~S4<br />
08.17~09.25</td>
<td>UNI-RAG-01,PLATFORM-BASE-07,09</td>
<td>산출물: UNI Upload Adapter<br />
완료: 허용형식·크기·hash·중복·실패/재시도가 처리된다.</td>
<td>ADR-06</td>
</tr>
<tr class="odd">
<td>WP-UNI-RAG-03</td>
<td>학습상태 Polling</td>
<td>업로드 이후 처리큐 상태를 조회하고 READY/FAILED/timeout을 사용자에게 표시한다.</td>
<td>BE/FE<br />
S3~S4<br />
08.31~09.25</td>
<td>UNI-RAG-02</td>
<td>산출물: Upload Status Flow<br />
완료: 재접속 후 Job 상태를 복구하고 실패파일을 재요청할 수 있다.</td>
<td>ADR-06</td>
</tr>
<tr class="even">
<td>WP-UNI-RAG-04</td>
<td>RAG Search Adapter</td>
<td>POST /search 결과를 EvidenceRef(doc/chunk/page/score/source)로 변환한다.</td>
<td>BE<br />
S3~S4<br />
08.31~09.25</td>
<td>UNI-RAG-01</td>
<td>산출물: UNI Search Adapter<br />
완료: LLM 생성 없이 검색결과를 재현하고 사용자 업로드 자료 우선순위를 표시한다.</td>
<td>ADR-06</td>
</tr>
<tr class="odd">
<td>WP-UNI-RAG-05</td>
<td>EvidenceSet 구성</td>
<td>USER_UPLOAD/UNI_RAG/SITUATION_FACT의 우선순위·고정시점·충돌·hash를 SOPGenerationContext로 만든다.</td>
<td>ARCH/BE<br />
S3~S5<br />
08.31~10.09</td>
<td>UNI-RAG-02~04,SITUATION-12</td>
<td>산출물: EvidenceSet Service<br />
완료: 생성요청 시점의 근거가 고정되고 이후 자료변경이 기존 SOP를 바꾸지 않는다.</td>
<td>ADR-13</td>
</tr>
<tr class="even">
<td>WP-UNI-RAG-06</td>
<td>/chat/json 요청</td>
<td>disasterType, snapshot, EvidenceSet, 생성옵션을 provider request로 매핑한다.</td>
<td>BE<br />
S3~S5<br />
08.31~10.09</td>
<td>UNI-RAG-01,05</td>
<td>산출물: UNI SOP Request Mapper<br />
완료: 요청크기·model_key·top_k·프롬프트 템플릿 버전이 제한·감사된다.</td>
<td>ADR-13</td>
</tr>
<tr class="odd">
<td>WP-UNI-RAG-07</td>
<td>SSE assembler</td>
<td>compn event, done, error, disconnect, lastEventId를 처리하고 임시 Graph를 구성한다.</td>
<td>BE/FE<br />
S4~S5<br />
09.14~10.09</td>
<td>PLATFORM-BASE-08,UNI-RAG-06</td>
<td>산출물: UNI SSE Assembler<br />
완료: 중간노드가 미리보기에 표시되나 최종검증 전 실행이 차단된다.</td>
<td>ADR-13</td>
</tr>
<tr class="even">
<td>WP-UNI-RAG-08</td>
<td>Raw Event Store</td>
<td>원시 SSE event, hash, providerSchemaVersion, generationId, sequence를 암호화·TTL 저장한다.</td>
<td>BE<br />
S4~S5<br />
09.14~10.09</td>
<td>UNI-RAG-07</td>
<td>산출물: UNI Raw Event Store<br />
완료: Mapper 결과와 원시응답을 재현할 수 있고 일반사용자 다운로드가 금지된다.</td>
<td>ADR-13</td>
</tr>
<tr class="odd">
<td>WP-UNI-RAG-09</td>
<td>UniSopMapper</td>
<td>compnSn/type/name/task/branch/source/unknown fields를 versioned Mapping Profile로 SopNode에 변환한다.</td>
<td>BE/ARCH<br />
S4~S6<br />
09.14~10.23</td>
<td>UNI-RAG-08</td>
<td>산출물: UniSopMapper v1.0<br />
완료: 누락·추가필드를 도메인 migration 없이 warning/providerExtensions로 처리한다.</td>
<td>ADR-13</td>
</tr>
<tr class="even">
<td>WP-UNI-RAG-10</td>
<td>Incremental/Final Graph Validator</td>
<td>nodeId·sequence·branch target·duplicate·고립노드·시작/종료·순환정책을 검증한다.</td>
<td>BE<br />
S4~S6<br />
09.14~10.23</td>
<td>UNI-RAG-09</td>
<td>산출물: SOP Graph Validator<br />
완료: 깨진 branch/중복 sequence는 DRAFT만 저장하고 PUBLISH/EXECUTE를 차단한다.</td>
<td>ADR-13</td>
</tr>
<tr class="odd">
<td>WP-UNI-RAG-11</td>
<td>UNKNOWN_PROVIDER_NODE 처리</td>
<td>미지원 type을 추정하지 않고 rawPayloadRef·warning과 함께 보존하고 사용자 치환을 지원한다.</td>
<td>BE/FE<br />
S5~S6<br />
09.28~10.23</td>
<td>UNI-RAG-09,10</td>
<td>산출물: Unsupported Node UI<br />
완료: 사용자가 확인·수정 전 실행불가이며 원문필드가 손실되지 않는다.</td>
<td>ADR-13</td>
</tr>
<tr class="even">
<td>WP-UNI-RAG-12</td>
<td>SSE 실패·재시도</td>
<td>연결실패·중간중단·Schema 오류에서 수신 preview와 raw event를 보존하고 새 generation/재개를 처리한다.</td>
<td>BE/FE<br />
S5~S7<br />
09.28~11.06</td>
<td>UNI-RAG-07~10</td>
<td>산출물: UNI Recovery Flow<br />
완료: 부분수신이 실행 가능한 SOP로 오인되지 않고 오류원인을 재현할 수 있다.</td>
<td>ADR-13</td>
</tr>
<tr class="odd">
<td>WP-UNI-RAG-13</td>
<td>UNI SOP POC Gate</td>
<td>정상·누락필드·미지원 type·깨진 branch·중복 sequence fixture와 실연계를 검증한다.</td>
<td>QA/BE/FE<br />
S7~S7<br />
10.26~11.06</td>
<td>UNI-RAG-01~12</td>
<td>산출물: UNI SOP POC Report<br />
완료: Contract Test와 E2E-20/21을 통과하고 T3Q Gap 입력 fixture를 확정한다.</td>
<td>G2/G3</td>
</tr>
</tbody>
</table>

### 7.2.11 WP-WORKFLOW SOP 정의·실행·Task·Execution Log

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-WORKFLOW-01</td>
<td>SOP Definition/Version</td>
<td>SopDefinition, Node/Edge, TaskDefinition, EvidenceRef, version/currentVersion을 구현한다.</td>
<td>BE/ARCH<br />
S4~S5<br />
09.14~10.09</td>
<td>UNI-RAG-09,10</td>
<td>산출물: SOP Domain Schema<br />
완료: DRAFT/PUBLISHED/ACTIVE 버전이 불변으로 관리되고 원시 Provider 구조와 분리된다.</td>
<td>ADR-13</td>
</tr>
<tr class="even">
<td>WP-WORKFLOW-02</td>
<td>SOP 편집·승인</td>
<td>DRAFT 편집, validation, publish/activate, 생성자·승인자 권한 분리를 구현한다.</td>
<td>BE/FE<br />
S4~S6<br />
09.14~10.23</td>
<td>WORKFLOW-01,PLATFORM-BASE-05</td>
<td>산출물: SOP Approval Flow<br />
완료: 검증실패·미지원노드·근거충돌 SOP는 활성화되지 않는다.</td>
<td>P-04</td>
</tr>
<tr class="odd">
<td>WP-WORKFLOW-03</td>
<td>SOP Instance 생성</td>
<td>incident/snapshot/sopVersion/institution binding을 고정한 실행 instance를 생성한다.</td>
<td>BE<br />
S5~S6<br />
09.28~10.23</td>
<td>WORKFLOW-01,02,SITUATION-12</td>
<td>산출물: SOP Instance Service<br />
완료: 실행 후 SOP 원본 변경이 기존 instance에 영향을 주지 않는다.</td>
<td>ADR-18</td>
</tr>
<tr class="even">
<td>WP-WORKFLOW-04</td>
<td>Task Instance 상태기계</td>
<td>PENDING→SENT→ACKNOWLEDGED→IN_PROGRESS→COMPLETED/REJECTED/OVERDUE를 구현한다.</td>
<td>BE/FE<br />
S5~S7<br />
09.28~11.06</td>
<td>WORKFLOW-03</td>
<td>산출물: Task State Machine<br />
완료: 허용되지 않은 전이가 차단되고 전이주체·시각·증거가 기록된다.</td>
<td>ADR-17</td>
</tr>
<tr class="odd">
<td>WP-WORKFLOW-05</td>
<td>Decision/Branch 평가</td>
<td>분기조건, 사용자판단, Fact 참조, 미결분기와 선택근거를 처리한다.</td>
<td>BE/FE<br />
S5~S7<br />
09.28~11.06</td>
<td>WORKFLOW-01,03</td>
<td>산출물: Decision Engine<br />
완료: 근거 없는 자동분기를 금지하고 선택이 Execution Event로 기록된다.</td>
<td>ADR-18</td>
</tr>
<tr class="even">
<td>WP-WORKFLOW-06</td>
<td>조직·담당자 Assignment</td>
<td>RoleBinding과 대체담당·복수수신·담당변경을 Task에 바인딩한다.</td>
<td>BE/FE<br />
S5~S7<br />
09.28~11.06</td>
<td>WORKFLOW-03,WP-SCENARIO</td>
<td>산출물: Task Assignment<br />
완료: 기관명·담당자를 코드 상수로 두지 않고 Binding 변경이 감사된다.</td>
<td>ADR-18</td>
</tr>
<tr class="odd">
<td>WP-WORKFLOW-07</td>
<td>일시정지·재개·취소</td>
<td>SOP Instance DRAFT/READY/RUNNING/PAUSED/COMPLETED/CANCELLED/FAILED 전이를 구현한다.</td>
<td>BE/FE<br />
S6~S7<br />
10.12~11.06</td>
<td>WORKFLOW-03,04</td>
<td>산출물: Workflow Lifecycle<br />
완료: 중단사유·승인·미완료 Task 처리와 재개지점이 기록된다.</td>
<td>Process</td>
</tr>
<tr class="even">
<td>WP-WORKFLOW-08</td>
<td>완료증거·승인</td>
<td>사진·문서·메모·시간·위치 등 Task 완료증거와 승인/반려를 관리한다.</td>
<td>BE/FE<br />
S6~S8<br />
10.12~11.20</td>
<td>WORKFLOW-04</td>
<td>산출물: Task Evidence Service<br />
완료: 필수증거 미제출 시 완료확정이 차단되고 파일권한이 적용된다.</td>
<td>ADR-17</td>
</tr>
<tr class="odd">
<td>WP-WORKFLOW-09</td>
<td>SLA·Escalation</td>
<td>ack/start/complete 기한, overdue, 재전파·대체담당·지휘자 알림 규칙을 구현한다.</td>
<td>BE<br />
S6~S8<br />
10.12~11.20</td>
<td>WORKFLOW-04,06</td>
<td>산출물: SLA/Escalation Engine<br />
완료: 시간경과 이벤트가 중복 없이 생성되고 Simulation 모드와 구분된다.</td>
<td>ADR-17</td>
</tr>
<tr class="even">
<td>WP-WORKFLOW-10</td>
<td>ExecutionEvent append-only</td>
<td>전파·수신·착수·완료·반려·정정·재전파를 append-only로 저장하고 correctionOfEventId를 지원한다.</td>
<td>BE/ARCH<br />
S5~S8<br />
09.28~11.20</td>
<td>WORKFLOW-03~09</td>
<td>산출물: Execution Log Engine<br />
완료: 원천 Event 삭제/수정 없이 정정이 연결되고 event hash/order가 보존된다.</td>
<td>ADR-10</td>
</tr>
<tr class="odd">
<td>WP-WORKFLOW-11</td>
<td>Timeline Projection</td>
<td>Execution Event를 시간·조직·임무·상태별로 읽어 전자상황판에 투영한다.</td>
<td>BE/FE<br />
S7~S9<br />
10.26~12.04</td>
<td>WORKFLOW-10</td>
<td>산출물: Execution Timeline API<br />
완료: 동일 원장에서 다양한 필터가 일관된 결과를 반환한다.</td>
<td>ADR-10</td>
</tr>
<tr class="even">
<td>WP-WORKFLOW-12</td>
<td>Workflow E2E</td>
<td>SOP 승인→실행→분기→담당변경→완료/반려→종료의 정상·예외 흐름을 검증한다.</td>
<td>QA/BE/FE<br />
S9~S9<br />
11.23~12.04</td>
<td>WORKFLOW-01~11</td>
<td>산출물: Workflow E2E Report<br />
완료: Execution Log 누락·중복 0건이며 허용상태전이와 권한시험을 통과한다.</td>
<td>G3</td>
</tr>
</tbody>
</table>

### 7.2.12 WP-PROPAGATION 전파 Outbox·ChannelPort·수신상태

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-PROPAGATION-01</td>
<td>PropagationCommand/Envelope</td>
<td>incident, SOP/task, recipients, body, priority, expiry, idempotencyKey, mode를 정의한다.</td>
<td>ARCH/BE<br />
S5~S6<br />
09.28~10.23</td>
<td>WORKFLOW-04,06</td>
<td>산출물: Propagation Schema<br />
완료: 채널 원시필드 없이 동일 명령을 System/SMS/Email/Broadcast에 전달할 수 있다.</td>
<td>ADR-17</td>
</tr>
<tr class="even">
<td>WP-PROPAGATION-02</td>
<td>Transactional Outbox</td>
<td>Task 상태변경/Execution Event와 전파 메시지를 동일 DB 트랜잭션으로 저장한다.</td>
<td>BE<br />
S5~S7<br />
09.28~11.06</td>
<td>PROPAGATION-01,WORKFLOW-10</td>
<td>산출물: Outbox Store<br />
완료: 업무상태 저장 후 메시지 유실 또는 메시지만 발송되는 불일치가 없다.</td>
<td>ADR-17</td>
</tr>
<tr class="odd">
<td>WP-PROPAGATION-03</td>
<td>ChannelDispatcher</td>
<td>Outbox polling/locking/배치/우선순위/재시도/상태갱신을 구현한다.</td>
<td>BE/DEVOPS<br />
S6~S8<br />
10.12~11.20</td>
<td>PROPAGATION-02</td>
<td>산출물: Channel Dispatcher<br />
완료: 다중 worker에서 중복발송 없이 처리하고 지연·실패 메트릭을 제공한다.</td>
<td>ADR-17</td>
</tr>
<tr class="even">
<td>WP-PROPAGATION-04</td>
<td>System Notification Adapter</td>
<td>웹/앱 내부 알림, 읽음/확인, 링크, 만료를 구현한다.</td>
<td>BE/FE<br />
S6~S8<br />
10.12~11.20</td>
<td>PROPAGATION-01,03</td>
<td>산출물: System Channel<br />
완료: POC 필수 채널로 SENT/DELIVERED/ACKNOWLEDGED 흐름을 검증한다.</td>
<td>ADR-17</td>
</tr>
<tr class="odd">
<td>WP-PROPAGATION-05</td>
<td>Training Simulation Adapter</td>
<td>실제 발송 없이 대상·시각·결과를 모의하고 화면·로그에 TRAINING/SIMULATION을 표시한다.</td>
<td>BE/FE<br />
S6~S8<br />
10.12~11.20</td>
<td>PROPAGATION-01,03</td>
<td>산출물: Simulation Channel<br />
완료: 실채널 미제공 상태에서도 종단 훈련 흐름이 재현된다.</td>
<td>ADR-17</td>
</tr>
<tr class="even">
<td>WP-PROPAGATION-06</td>
<td>EMAIL/SMS/BROADCAST Stub</td>
<td>capabilities, endpoint/auth/receipt 계약과 Disabled Stub을 선행 구현한다.</td>
<td>BE<br />
S6~S8<br />
10.12~11.20</td>
<td>PROPAGATION-01</td>
<td>산출물: Channel Adapter Contracts<br />
완료: 실채널 추가 시 Workflow/핵심 DB 변경 없이 Adapter와 설정만 추가한다.</td>
<td>ADR-17</td>
</tr>
<tr class="odd">
<td>WP-PROPAGATION-07</td>
<td>Receipt/Callback 처리</td>
<td>provider message ID, delivery/ack callback, polling, 순서역전·중복 callback을 처리한다.</td>
<td>BE<br />
S7~S9<br />
10.26~12.04</td>
<td>PROPAGATION-03~06</td>
<td>산출물: Receipt Processor<br />
완료: 멱등 처리와 상태전이 검증으로 중복 Execution Event가 생성되지 않는다.</td>
<td>ADR-17</td>
</tr>
<tr class="even">
<td>WP-PROPAGATION-08</td>
<td>멱등·재시도·DLQ</td>
<td>task+recipient+channel+messageVersion 키, backoff, retryable/non-retryable, dead-letter를 구현한다.</td>
<td>BE/DEVOPS<br />
S7~S9<br />
10.26~12.04</td>
<td>PROPAGATION-03,07</td>
<td>산출물: Retry/DLQ Policy<br />
완료: 재처리 중복발송 0, 소진건 운영알림·수동재전파가 가능하다.</td>
<td>ADR-17</td>
</tr>
<tr class="odd">
<td>WP-PROPAGATION-09</td>
<td>개인정보·첨부 보안</td>
<td>연락처 암호화/마스킹, 최소본문, 만료 다운로드 토큰, Secret rotation을 적용한다.</td>
<td>BE/DEVOPS/QA<br />
S7~S9<br />
10.26~12.04</td>
<td>PROPAGATION-01~08</td>
<td>산출물: Propagation Security<br />
완료: 로그·화면·이벤트에 원문 연락처와 영구 공개 URL이 노출되지 않는다.</td>
<td>G17-5</td>
</tr>
<tr class="even">
<td>WP-PROPAGATION-10</td>
<td>전파·수신 UI</td>
<td>수신자별 QUEUED/SENT/DELIVERED/ACK/STARTED/COMPLETED/FAILED와 재전파·대체채널을 제공한다.</td>
<td>FE/UX<br />
S8~S10<br />
11.09~12.18</td>
<td>PROPAGATION-03~09</td>
<td>산출물: Propagation Status UI<br />
완료: 전송 성공과 임무완료를 구분하고 권한별 액션이 정확히 제한된다.</td>
<td>ADR-17</td>
</tr>
<tr class="odd">
<td>WP-PROPAGATION-11</td>
<td>Propagation E2E</td>
<td>System/Simulation으로 승인→전파→수신→착수→완료→재시도→상황판→일지를 검증한다.</td>
<td>QA/BE/FE<br />
S10~S10<br />
12.07~12.18</td>
<td>PROPAGATION-01~10</td>
<td>산출물: Propagation E2E Report<br />
완료: E2E-23과 ADR-17 완료기준, idempotency/장애복구 시험을 통과한다.</td>
<td>G3</td>
</tr>
</tbody>
</table>

### 7.2.13 WP-JOURNAL Execution Log 기반 상황일지 Projection·HWPX

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-JOURNAL-01</td>
<td>Journal Domain Schema</td>
<td>JournalDocument/Section/Entry/NarrativeDraft/Approval, sourceRefs, cutoff, revision을 정의한다.</td>
<td>ARCH/BE<br />
S6~S7<br />
10.12~11.06</td>
<td>SITUATION-12,WORKFLOW-10</td>
<td>산출물: Journal Schema v1.0<br />
완료: 원천 참조 불변성과 승인본 hash·정정 규칙이 Schema에 반영된다.</td>
<td>ADR-12</td>
</tr>
<tr class="even">
<td>WP-JOURNAL-02</td>
<td>Projection Cutoff/Revision</td>
<td>특정 시점까지의 Snapshot·Event를 고정하고 이후 이벤트를 새 revision/후속일지로 처리한다.</td>
<td>BE<br />
S6~S7<br />
10.12~11.06</td>
<td>JOURNAL-01</td>
<td>산출물: Journal Projection Context<br />
완료: 승인일지 hash가 후속 Event로 변경되지 않는다.</td>
<td>ADR-12</td>
</tr>
<tr class="odd">
<td>WP-JOURNAL-03</td>
<td>JournalEntry Projection</td>
<td>Event/Fact를 시간순·조직·임무별 Entry로 변환하고 groupKey로 동일사건을 묶는다.</td>
<td>BE<br />
S6~S8<br />
10.12~11.20</td>
<td>JOURNAL-01,02</td>
<td>산출물: Journal Projection Engine<br />
완료: 원천시각·주체·행위·상태를 변경하지 않고 sourceEntryIds가 100% 연결된다.</td>
<td>ADR-10,12</td>
</tr>
<tr class="even">
<td>WP-JOURNAL-04</td>
<td>Section Mapping</td>
<td>상황개요/기상/특보/피해/통제/조치/기관동향/향후계획을 Template Profile 역할에 매핑한다.</td>
<td>BE/DOC<br />
S7~S8<br />
10.26~11.20</td>
<td>JOURNAL-03,HWPX-ANALYZE-01</td>
<td>산출물: Journal Section Rules<br />
완료: 재난유형·기관 양식별 Section rule을 설정으로 교체할 수 있다.</td>
<td>ADR-18</td>
</tr>
<tr class="odd">
<td>WP-JOURNAL-05</td>
<td>결정론적 최소일지 생성</td>
<td>AI 없이 고정 규칙과 템플릿으로 표·목록·시간축 초안을 생성한다.</td>
<td>BE/DOC<br />
S7~S8<br />
10.26~11.20</td>
<td>JOURNAL-03,04</td>
<td>산출물: Deterministic Journal Draft<br />
완료: UNI/T3Q 장애 상태에서도 최소 상황일지 HWPX 초안이 생성된다.</td>
<td>ADR-12</td>
</tr>
<tr class="even">
<td>WP-JOURNAL-06</td>
<td>선택적 Narrative Provider</td>
<td>UNI /chat 또는 향후 RPT-003을 JournalProviderPort로 연결해 표현·요약만 수행한다.</td>
<td>BE<br />
S7~S9<br />
10.26~12.04</td>
<td>JOURNAL-01~05</td>
<td>산출물: Journal Provider Adapter<br />
완료: Provider가 Execution Event/Fact를 생성·수정할 수 없고 OFF 시 기능이 유지된다.</td>
<td>ADR-12</td>
</tr>
<tr class="odd">
<td>WP-JOURNAL-07</td>
<td>사실성 Validator</td>
<td>문장·표셀의 날짜·수치·인명·조치·피해가 sourceEntryIds/factIds에 존재하는지 검증한다.</td>
<td>BE/QA<br />
S7~S9<br />
10.26~12.04</td>
<td>JOURNAL-03,06</td>
<td>산출물: Journal Fact Validator<br />
완료: 근거 없는 claim 0을 요구하고 오류 문장을 자동반영하지 않는다.</td>
<td>ADR-12</td>
</tr>
<tr class="even">
<td>WP-JOURNAL-08</td>
<td>사용자 편집·ChangeSet</td>
<td>rhwp에서 Block/Section 편집·AI 재작성·Diff·잠금·Undo를 제공한다.</td>
<td>FE/BE/DOC<br />
S8~S9<br />
11.09~12.04</td>
<td>JOURNAL-05~07,HWPX-EDIT-12</td>
<td>산출물: Journal Editor<br />
완료: 사용자 수정 Block을 재생성이 덮어쓰지 않고 sourceRefs가 유지된다.</td>
<td>ADR-04</td>
</tr>
<tr class="odd">
<td>WP-JOURNAL-09</td>
<td>승인·정정·감사</td>
<td>일지 승인, 승인본 다운로드, 정정사유·정정자·정정시각·원본보존을 구현한다.</td>
<td>BE/FE<br />
S8~S10<br />
11.09~12.18</td>
<td>JOURNAL-01,08</td>
<td>산출물: Journal Approval Flow<br />
완료: 승인본 직접수정이 금지되고 정정은 새 revision과 원본 링크로 관리된다.</td>
<td>ADR-12</td>
</tr>
<tr class="even">
<td>WP-JOURNAL-10</td>
<td>Journal HWPX Mapping</td>
<td>Entry/Section을 원본 양식 Prototype·표·개요로 변환하고 ValidationReport를 생성한다.</td>
<td>DOC/BE<br />
S8~S10<br />
11.09~12.18</td>
<td>JOURNAL-04,08,HWPX-SERIALIZE-08</td>
<td>산출물: Journal HWPX Output<br />
완료: 상황일지 양식의 표·번호·고정영역과 source trace가 보존된다.</td>
<td>G4</td>
</tr>
<tr class="odd">
<td>WP-JOURNAL-11</td>
<td>RPT-003 비교 Fixture</td>
<td>향후 T3Q RPT-003의 Schema·근거·부분결과·편집·운영을 비교할 입력/기대출력 fixture를 만든다.</td>
<td>ARCH/BE/QA<br />
S9~S10<br />
11.23~12.18</td>
<td>JOURNAL-01~07</td>
<td>산출물: RPT-003 Comparison Pack<br />
완료: RPT-003 수신 시 Journal 소유권을 바꾸지 않고 Adapter Gate를 평가할 수 있다.</td>
<td>ADR-12</td>
</tr>
<tr class="even">
<td>WP-JOURNAL-12</td>
<td>Journal E2E</td>
<td>Snapshot+Execution Log→Projection→선택적 문장화→검증→편집→승인→HWPX를 검증한다.</td>
<td>QA/BE/FE/DOC<br />
S10~S10<br />
12.07~12.18</td>
<td>JOURNAL-01~11</td>
<td>산출물: Journal E2E Report<br />
완료: 근거추적 100%, 허위 Fact 0, 승인본 불변성, Provider OFF fallback을 통과한다.</td>
<td>G3/G4</td>
</tr>
</tbody>
</table>

### 7.2.14 WP-SCENARIO 사용자 시나리오·안전한국훈련 Reference Scenario·기관 Binding

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-SCENARIO-01</td>
<td>Actor·Role·권한 기준</td>
<td>계획 담당자, 상황편집/승인, SOP 설계/승인, 지휘자, 담당자, 관리자, 감사자 Actor를 정의한다.</td>
<td>PM/ARCH/UX<br />
S1~S1<br />
08.03~08.14</td>
<td>ADR-BASE-04</td>
<td>산출물: Actor/Role Catalog<br />
완료: RBAC 권한과 사용자 시나리오 Actor가 1:1 또는 명시적 매핑을 가진다.</td>
<td>권한표</td>
</tr>
<tr class="even">
<td>WP-SCENARIO-02</td>
<td>계획서 생성 사용자 시나리오 v1.0</td>
<td>양식업로드→분석확인→기준정보→T3Q 목차/본문→직접/AI 편집→Diff→HWPX 저장·Export의 정상·대안·예외를 상세 작성한다.</td>
<td>PM/UX/ARCH<br />
S1~S2<br />
08.03~08.28</td>
<td>SCENARIO-01</td>
<td>산출물: 계획서 생성 사용자 시나리오 v1.0<br />
완료: Actor, 전제, Trigger, Main/Alternative/Exception, 상태·권한·오류·인수기준·ADR/E2E 추적이 포함된다.</td>
<td>ADR-01~05,15,16</td>
</tr>
<tr class="odd">
<td>WP-SCENARIO-03</td>
<td>상황일지·안전한국훈련 사용자 시나리오 v1.0</td>
<td>상황등록→Fact 비교·Snapshot→자료업로드·SOP→승인·실행→전파·수신·완료→상황판→일지→평가 흐름을 상세 작성한다.</td>
<td>PM/UX/ARCH<br />
S1~S3<br />
08.03~09.11</td>
<td>SCENARIO-01</td>
<td>산출물: 상황일지·안전한국훈련 사용자 시나리오 v1.0<br />
완료: 실재난/훈련/Simulation, 정상·부분장애·수동입력·정정·재전파·승인 예외가 포함된다.</td>
<td>ADR-06~18</td>
</tr>
<tr class="even">
<td>WP-SCENARIO-04</td>
<td>Scenario ID·E2E 매핑</td>
<td>각 단계에 US, SCR, API/DB, Event, E2E, Evidence 식별자를 부여하고 인수기준을 연결한다.</td>
<td>ARCH/QA<br />
S2~S3<br />
08.17~09.11</td>
<td>SCENARIO-02,03</td>
<td>산출물: Scenario Traceability Matrix<br />
완료: 시나리오 단계별 미추적 기능·상태·오류 0건이다.</td>
<td>G3</td>
</tr>
<tr class="odd">
<td>WP-SCENARIO-05</td>
<td>ScenarioDefinition Schema</td>
<td>disasterType, mode, objective, timeline, SOP, org binding, expected execution, journal, rubric 구조를 정의한다.</td>
<td>ARCH/BE<br />
S2~S4<br />
08.17~09.25</td>
<td>SCENARIO-03,04</td>
<td>산출물: Scenario Pack Schema<br />
완료: 기관명·조직·연락처가 설정으로 분리되고 버전·hash가 포함된다.</td>
<td>ADR-18</td>
</tr>
<tr class="even">
<td>WP-SCENARIO-06</td>
<td>Mock Institution/Organization</td>
<td>기관·부서·역할·담당자·대체담당·연락채널·지역을 Mock profile로 구성한다.</td>
<td>PM/BE/QA<br />
S3~S4<br />
08.31~09.25</td>
<td>SCENARIO-05</td>
<td>산출물: Mock Institution Pack<br />
완료: 실증기관 미확정 상태에서도 RoleBinding 100%와 E2E가 가능하다.</td>
<td>ADR-18</td>
</tr>
<tr class="odd">
<td>WP-SCENARIO-07</td>
<td>태풍·호우 Timeline/Fact Pack</td>
<td>예보·특보·강수·풍속·재난문자·침수/통제·피해·대응단계의 시각별 입력과 충돌 Fact를 구성한다.</td>
<td>PM/ARCH/QA<br />
S3~S5<br />
08.31~10.09</td>
<td>SCENARIO-05,06</td>
<td>산출물: Natural Scenario Fact Pack<br />
완료: SituationContext 정상·충돌·Provider 실패·수동입력 분기가 모두 포함된다.</td>
<td>ADR-18</td>
</tr>
<tr class="even">
<td>WP-SCENARIO-08</td>
<td>태풍·호우 SOP/ExpectedExecution</td>
<td>예찰·대피·도로통제·자원배치·기관전파·완료조건과 기대 Event/시간을 정의한다.</td>
<td>PM/ARCH/QA<br />
S4~S6<br />
09.14~10.23</td>
<td>SCENARIO-07</td>
<td>산출물: Natural SOP/Execution Pack<br />
완료: 계획/자료→SOP→전파→완료→일지의 전체 흐름이 추적된다.</td>
<td>ADR-18</td>
</tr>
<tr class="odd">
<td>WP-SCENARIO-09</td>
<td>붕괴사고 Timeline/Fact Pack</td>
<td>발생시각·위치·붕괴범위·인명·추가붕괴·접근통제·현장보고의 시각별 입력을 구성한다.</td>
<td>PM/ARCH/QA<br />
S4~S6<br />
09.14~10.23</td>
<td>SCENARIO-05,06</td>
<td>산출물: Social Scenario Fact Pack<br />
완료: 다기관·현장보고·상황정정·증거첨부가 포함된다.</td>
<td>ADR-18</td>
</tr>
<tr class="even">
<td>WP-SCENARIO-10</td>
<td>붕괴사고 SOP/ExpectedExecution</td>
<td>구조접근·대피·의료·교통·시설·홍보·유관기관 분기와 전파·수신·완료를 정의한다.</td>
<td>PM/ARCH/QA<br />
S5~S7<br />
09.28~11.06</td>
<td>SCENARIO-09</td>
<td>산출물: Social SOP/Execution Pack<br />
완료: 분기·대체담당·Escalation·완료증거·전자상황판 검증이 포함된다.</td>
<td>ADR-18</td>
</tr>
<tr class="odd">
<td>WP-SCENARIO-11</td>
<td>Journal Expectation·평가 Rubric</td>
<td>시나리오별 필수 일지 Section/Entry/source와 성공률·시간·누락·사실성·문서품질·만족도 지표를 정의한다.</td>
<td>QA/PM<br />
S5~S7<br />
09.28~11.06</td>
<td>SCENARIO-07~10</td>
<td>산출물: Journal Expectation/Rubric<br />
완료: 자동시험과 실무자 평가항목이 구분되고 증거수집 방법이 명시된다.</td>
<td>G6</td>
</tr>
<tr class="even">
<td>WP-SCENARIO-12</td>
<td>기관 Binding 절차</td>
<td>실증기관, 재난유형, 조직, 자료, 연계, 평가사항을 G18-1~6 체크리스트로 동결한다.</td>
<td>PM/ARCH<br />
S7~S10<br />
10.26~12.18</td>
<td>SCENARIO-05~11,ADR-BASE-08</td>
<td>산출물: Institution Binding Guide<br />
완료: 기관·유형 변경 시 공통 API/DB/화면 수정 없이 Config/Content만 교체된다.</td>
<td>G5</td>
</tr>
<tr class="odd">
<td>WP-SCENARIO-13</td>
<td>Reference Scenario E2E Baseline</td>
<td>자연·사회 Scenario Pack을 Mock Org/System/Simulation Channel로 실행해 기준결과를 동결한다.</td>
<td>QA/전팀<br />
S9~S10<br />
11.23~12.18</td>
<td>SCENARIO-01~12</td>
<td>산출물: Natural/Social E2E Baseline<br />
완료: 두 시나리오의 전 단계와 기대 Event/Journal이 통과하고 증거 bundle이 보관된다.</td>
<td>G3/G5</td>
</tr>
</tbody>
</table>

### 7.2.15 WP-UI React 통합 Workspace·화면·상태·권한·오류

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-UI-01</td>
<td>정보구조·화면목록</td>
<td>메뉴, 화면ID, 목적, Actor, 진입/종료, 상태, 주요 데이터, ADR/US 추적을 정의한다.</td>
<td>UX/FE/ARCH<br />
S2~S3<br />
08.17~09.11</td>
<td>SCENARIO-02,03</td>
<td>산출물: 화면목록/IA v1.0<br />
완료: 시나리오의 모든 사용자 접점이 화면 또는 명시적 Backend 처리로 연결된다.</td>
<td>SCR Trace</td>
</tr>
<tr class="even">
<td>WP-UI-02</td>
<td>통합 Navigation/Shell</td>
<td>메인플랫폼 진입, 최근문서, 계획서, 상황/훈련, SOP, 상황판, 일지, 관리 메뉴를 구현한다.</td>
<td>FE/UX<br />
S3~S4<br />
08.31~09.25</td>
<td>PLATFORM-BASE-04,UI-01</td>
<td>산출물: React Application Shell<br />
완료: 권한별 메뉴가 숨김/비활성/접근거부 정책과 일치한다.</td>
<td>ADR-01</td>
</tr>
<tr class="odd">
<td>WP-UI-03</td>
<td>문서목록·보관함</td>
<td>문서명·유형·단계·생성/수정일·상태·검색·다운로드·삭제/휴지통 정책을 구현한다.</td>
<td>FE/BE<br />
S3~S5<br />
08.31~10.09</td>
<td>UI-02,PLATFORM-BASE-09</td>
<td>산출물: Document Library<br />
완료: 권한·소유권·버전·최종본 표시와 오류처리가 구현된다.</td>
<td>UFR-STORAGE</td>
</tr>
<tr class="even">
<td>WP-UI-04</td>
<td>계획서 기준정보 화면</td>
<td>주제·재난유형·관리단계·일시·장소·지침·출처·문체·독자·역할·템플릿을 입력·저장·미리보기한다.</td>
<td>FE/UX/BE<br />
S3~S5<br />
08.31~10.09</td>
<td>SCENARIO-02,PLAN-T3Q-04</td>
<td>산출물: Plan Context Screen<br />
완료: 필수값·문자수·날짜·선택 규칙과 기준정보 snapshot이 일치한다.</td>
<td>UFR-INPUT</td>
</tr>
<tr class="odd">
<td>WP-UI-05</td>
<td>rhwp 중앙 Workspace</td>
<td>좌측 문서구조, 중앙 Editor, 우측 AI/근거/Diff 패널과 Job 상태바를 구현한다.</td>
<td>FE/UX/DOC<br />
S4~S7<br />
09.14~11.06</td>
<td>HWPX-EDIT-01,UI-02</td>
<td>산출물: Document Workspace<br />
완료: 생성·직접편집·AI편집·미리보기·저장이 동일 DocumentState에서 작동한다.</td>
<td>ADR-01</td>
</tr>
<tr class="even">
<td>WP-UI-06</td>
<td>Template 분석확인 화면</td>
<td>역할 후보·개요패턴·제한객체·신뢰도·미리보기·확정/수정을 제공한다.</td>
<td>FE/UX<br />
S4~S6<br />
09.14~10.23</td>
<td>HWPX-ANALYZE-08,UI-05</td>
<td>산출물: Template Confirmation Screen<br />
완료: CONFIRM/LIMITED 상태와 사용자 수정 이력이 명확히 표시된다.</td>
<td>ADR-02,15</td>
</tr>
<tr class="odd">
<td>WP-UI-07</td>
<td>AI 편집·근거·Diff 패널</td>
<td>Cursor/Range/Block/Section Operation, 근거, 경고, Diff 적용/취소, 잠금 상태를 제공한다.</td>
<td>FE/UX<br />
S5~S8<br />
09.28~11.20</td>
<td>HWPX-EDIT-02~09,PLAN-T3Q-09</td>
<td>산출물: AI/Evidence/Diff Panel<br />
완료: 선택대상과 baseRevision이 표시되고 사용자수정 보호 동작이 이해 가능하다.</td>
<td>ADR-04</td>
</tr>
<tr class="even">
<td>WP-UI-08</td>
<td>상황등록·Fact 비교 화면</td>
<td>기본정보, Provider 상태, 후보목록, 충돌비교, 선택/수정, Snapshot 확정을 구현한다.</td>
<td>FE/UX/BE<br />
S4~S7<br />
09.14~11.06</td>
<td>SCENARIO-03,SITUATION-02~12</td>
<td>산출물: Situation Registration Screen<br />
완료: 외부실패·cache·stale·수동입력·승인권한이 시각적으로 구분된다.</td>
<td>ADR-08,11</td>
</tr>
<tr class="odd">
<td>WP-UI-09</td>
<td>자료업로드·근거검색 화면</td>
<td>UNI 업로드 상태, 검색결과, EvidenceSet 우선순위·충돌·선택을 표시한다.</td>
<td>FE/UX<br />
S4~S7<br />
09.14~11.06</td>
<td>UNI-RAG-02~05</td>
<td>산출물: Evidence Management Screen<br />
완료: 비동기 실패·재시도와 근거고정 시점을 사용자가 확인할 수 있다.</td>
<td>ADR-06</td>
</tr>
<tr class="even">
<td>WP-UI-10</td>
<td>SOP Designer/Preview</td>
<td>SSE 수신노드, UNKNOWN/validation warning, Task/branch 편집, Publish/Activate 승인흐름을 구현한다.</td>
<td>FE/UX/BE<br />
S5~S8<br />
09.28~11.20</td>
<td>UNI-RAG-07~11,WORKFLOW-01,02</td>
<td>산출물: SOP Designer<br />
완료: 최종검증 전 실행버튼 비활성화, 오류노드와 원문근거가 연결된다.</td>
<td>ADR-13</td>
</tr>
<tr class="odd">
<td>WP-UI-11</td>
<td>지휘자 실행·전파 화면</td>
<td>SOP Instance, Task 배정, 전파, 재전파, 상태, 지연, Escalation, 완료증거를 관리한다.</td>
<td>FE/UX/BE<br />
S6~S9<br />
10.12~12.04</td>
<td>WORKFLOW-03~09,PROPAGATION-01~10</td>
<td>산출물: Incident Command Screen<br />
완료: 전송상태와 업무상태를 분리하고 권한별 조치가 정확하다.</td>
<td>ADR-17</td>
</tr>
<tr class="even">
<td>WP-UI-12</td>
<td>담당자 임무 화면</td>
<td>수신확인, 착수, 완료/반려, 증거첨부, 기한, 대체담당 요청을 모바일 대응 UI로 제공한다.</td>
<td>FE/UX/BE<br />
S6~S9<br />
10.12~12.04</td>
<td>WORKFLOW-04,08,PROPAGATION-04</td>
<td>산출물: Task Assignee Screen<br />
완료: 타인임무 변경 불가, 만료·오프라인/재연결 상태와 증거검증을 처리한다.</td>
<td>ADR-17</td>
</tr>
<tr class="odd">
<td>WP-UI-13</td>
<td>전자상황판</td>
<td>시간축, 조직/임무 진행률, 지연/실패, 전파·수신·완료, 상황 Fact·Snapshot, 필터를 표출한다.</td>
<td>FE/UX/BE<br />
S7~S10<br />
10.26~12.18</td>
<td>WORKFLOW-11,SCENARIO-08,10</td>
<td>산출물: Electronic Situation Board<br />
완료: Execution Log 원장과 화면값이 일치하고 훈련/실재난 모드가 구분된다.</td>
<td>ADR-10,18</td>
</tr>
<tr class="even">
<td>WP-UI-14</td>
<td>상황일지 화면</td>
<td>cutoff, Section/Entry, 근거, AI 문장화, Diff, 승인/정정, HWPX 저장을 제공한다.</td>
<td>FE/UX/BE/DOC<br />
S7~S10<br />
10.26~12.18</td>
<td>JOURNAL-01~10</td>
<td>산출물: Journal Screen<br />
완료: sourceRefs·승인본·정정 revision과 사용자 수정 보호가 표시된다.</td>
<td>ADR-12</td>
</tr>
<tr class="odd">
<td>WP-UI-15</td>
<td>관리 화면</td>
<td>Provider/Channel/Feature Flag/Template/Institution/Mapping Profile/환경상태를 관리한다.</td>
<td>FE/BE/DEVOPS<br />
S7~S10<br />
10.26~12.18</td>
<td>PLATFORM-BASE-10,SITUATION-10,PROPAGATION-06</td>
<td>산출물: Admin Console<br />
완료: 권한·승인·감사·Secret 비노출과 기본 OFF 정책을 준수한다.</td>
<td>ADR-11,14,17,18</td>
</tr>
<tr class="even">
<td>WP-UI-16</td>
<td>공통 접근성·상태·오류 검증</td>
<td>키보드, focus, 대비, label, status live region, 권한·오류메시지·loading/empty를 점검한다.</td>
<td>QA/UX/FE<br />
S9~S10<br />
11.23~12.18</td>
<td>UI-01~15,PLATFORM-BASE-12</td>
<td>산출물: UI Quality Report<br />
완료: 핵심 화면의 키보드 운용과 상태·권한·오류 일관성 결함이 해소된다.</td>
<td>G3/G6</td>
</tr>
</tbody>
</table>

### 7.2.16 WP-API-DB-SEQ 화면·API·DB·Sequence 상세설계

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-API-DB-SEQ-01</td>
<td>도메인·데이터 소유권 Matrix</td>
<td>Document, Template, Situation, SOP, Workflow, Propagation, Execution, Journal, Scenario의 소유 서비스와 불변규칙을 확정한다.</td>
<td>ARCH/BE<br />
S2~S3<br />
08.17~09.11</td>
<td>ADR-BASE-04,SCENARIO-01</td>
<td>산출물: Domain Ownership Matrix<br />
완료: 중복 원장과 외부 Provider 직접소유가 없고 모든 Entity의 writer가 하나로 정의된다.</td>
<td>ADR-10~12</td>
</tr>
<tr class="even">
<td>WP-API-DB-SEQ-02</td>
<td>논리 ERD</td>
<td>핵심 Entity·키·version·관계·append-only·correction·raw payload·evidence를 모델링한다.</td>
<td>ARCH/BE<br />
S3~S5<br />
08.31~10.09</td>
<td>API-DB-SEQ-01</td>
<td>산출물: Logical ERD v1.0<br />
완료: 시나리오와 ADR의 데이터 요구가 누락 없이 반영된다.</td>
<td>G1</td>
</tr>
<tr class="odd">
<td>WP-API-DB-SEQ-03</td>
<td>물리 DB Schema</td>
<td>PostgreSQL 중심 테이블, 인덱스, JSONB, Object Store ref, partition/retention, migration을 설계한다.</td>
<td>BE/DBA<br />
S4~S6<br />
09.14~10.23</td>
<td>API-DB-SEQ-02</td>
<td>산출물: Physical DB Design v1.0<br />
완료: PK/FK/unique/idempotency/index/암호화/보관정책이 정의된다.</td>
<td>ADR-11~17</td>
</tr>
<tr class="even">
<td>WP-API-DB-SEQ-04</td>
<td>API 목록·리소스 설계</td>
<td>화면/Actor별 REST/SSE Endpoint, method, auth, idempotency, status를 식별한다.</td>
<td>ARCH/BE/FE<br />
S3~S5<br />
08.31~10.09</td>
<td>SCENARIO-02~04,UI-01</td>
<td>산출물: Interface List v1.0<br />
완료: 모든 사용자 액션과 비동기 이벤트가 API 또는 명시적 local command에 연결된다.</td>
<td>G1</td>
</tr>
<tr class="odd">
<td>WP-API-DB-SEQ-05</td>
<td>OpenAPI 상세명세</td>
<td>request/response/error/example/security/correlation/version/partial result를 작성한다.</td>
<td>BE/ARCH<br />
S4~S7<br />
09.14~11.06</td>
<td>API-DB-SEQ-04,ADR-BASE-06</td>
<td>산출물: OpenAPI v1.0<br />
완료: lint/contract test를 통과하고 provider 원시필드가 외부 UI 계약에 노출되지 않는다.</td>
<td>G1</td>
</tr>
<tr class="even">
<td>WP-API-DB-SEQ-06</td>
<td>SSE/Event 명세</td>
<td>generation, UNI compn preview, workflow task, incident timeline의 event type·ordering·resume·error를 정의한다.</td>
<td>BE/FE<br />
S4~S6<br />
09.14~10.23</td>
<td>PLATFORM-BASE-08,API-DB-SEQ-04</td>
<td>산출물: SSE Contract v1.0<br />
완료: 재연결·중복·순서역전·done/error가 테스트 fixture로 검증된다.</td>
<td>ADR-13</td>
</tr>
<tr class="odd">
<td>WP-API-DB-SEQ-07</td>
<td>계획서 Sequence</td>
<td>양식분석, RPT-001/002, Block 반영, 사용자편집, Diff, 저장·Export의 정상/오류 Sequence를 작성한다.</td>
<td>ARCH/BE/FE/DOC<br />
S4~S6<br />
09.14~10.23</td>
<td>SCENARIO-02,API-DB-SEQ-04,05</td>
<td>산출물: Plan Sequence Spec<br />
완료: Actor·UI·Backend·T3Q·Document Engine·DB·Object Store·SSE가 모두 표현된다.</td>
<td>ADR-01~05</td>
</tr>
<tr class="even">
<td>WP-API-DB-SEQ-08</td>
<td>상황정보·SOP Sequence</td>
<td>Provider 수집→Fact→Snapshot→UNI 업로드/검색/SSE→Mapper→SOP 승인 Sequence를 작성한다.</td>
<td>ARCH/BE/FE<br />
S4~S7<br />
09.14~11.06</td>
<td>SCENARIO-03,API-DB-SEQ-04~06</td>
<td>산출물: Situation/SOP Sequence Spec<br />
완료: 외부실패·충돌·부분SSE·validation 실패·fallback 분기가 포함된다.</td>
<td>ADR-08,11,13,14</td>
</tr>
<tr class="odd">
<td>WP-API-DB-SEQ-09</td>
<td>Workflow·전파 Sequence</td>
<td>SOP 실행→Outbox→Channel→Receipt→Task 상태→Execution Event→재시도/Escalation을 작성한다.</td>
<td>ARCH/BE/FE<br />
S5~S7<br />
09.28~11.06</td>
<td>WORKFLOW,PROPAGATION,API-DB-SEQ-04</td>
<td>산출물: Workflow/Propagation Sequence Spec<br />
완료: 업무트랜잭션과 외부발송 경계, 멱등·중복 callback이 표현된다.</td>
<td>ADR-17</td>
</tr>
<tr class="even">
<td>WP-API-DB-SEQ-10</td>
<td>상황일지 Sequence</td>
<td>cutoff→Projection→선택적 AI→Validator→ChangeSet→승인→HWPX→정정 흐름을 작성한다.</td>
<td>ARCH/BE/FE/DOC<br />
S6~S8<br />
10.12~11.20</td>
<td>JOURNAL,API-DB-SEQ-04</td>
<td>산출물: Journal Sequence Spec<br />
완료: AI OFF fallback과 승인본 불변·후속 Event 처리 분기가 포함된다.</td>
<td>ADR-12</td>
</tr>
<tr class="odd">
<td>WP-API-DB-SEQ-11</td>
<td>화면-API-DB 매핑표</td>
<td>화면 field/action/status/error를 API field, Entity/column, 권한, Event, WBS/TC와 연결한다.</td>
<td>ARCH/QA/FE/BE<br />
S6~S8<br />
10.12~11.20</td>
<td>API-DB-SEQ-01~10,UI-01~15</td>
<td>산출물: Screen/API/DB Trace Matrix<br />
완료: 미매핑 화면값·API필드·DB컬럼·오류 0건을 목표로 한다.</td>
<td>G3</td>
</tr>
<tr class="even">
<td>WP-API-DB-SEQ-12</td>
<td>상세설계 검토·기준선</td>
<td>개발팀 walkthrough, Schema lint, Sequence scenario review, 변경사항 CR을 처리한다.</td>
<td>PM/ARCH/전팀<br />
S8~S9<br />
11.09~12.04</td>
<td>API-DB-SEQ-01~11</td>
<td>산출물: 화면/API/DB/Sequence 상세설계서 v1.0<br />
완료: 승인자·검토결함·조치·기준선 hash가 기록된다.</td>
<td>G1/G3</td>
</tr>
</tbody>
</table>

### 7.2.17 WP-INTEGRATION-QA 통합·보안·성능·실증·인수·배포

<table style="width:100%;">
<colgroup>
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
<col style="width: 14%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>WBS ID</strong></th>
<th><strong>작업명</strong></th>
<th><strong>세부 수행내용</strong></th>
<th><strong>담당/기간</strong></th>
<th><strong>선행</strong></th>
<th><strong>산출물·완료기준</strong></th>
<th><strong>추적</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>WP-INTEGRATION-QA-01</td>
<td>시험전략·품질지표</td>
<td>단위/Contract/통합/E2E/보안/성능/호환성/사용성/실증의 범위·환경·책임·합격기준을 수립한다.</td>
<td>QA/PM<br />
S4~S5<br />
09.14~10.09</td>
<td>ADR-BASE-04,07</td>
<td>산출물: Test Strategy v1.0<br />
완료: ADR 완료기준과 정량지표가 Test Case로 연결된다.</td>
<td>G3~G6</td>
</tr>
<tr class="even">
<td>WP-INTEGRATION-QA-02</td>
<td>단위시험·정적분석 기준</td>
<td>Frontend/Backend/Rust/WASM의 coverage, lint, type, dependency, secret scan 기준을 적용한다.</td>
<td>QA/DEVOPS/전팀<br />
S4~S11<br />
09.14~12.31</td>
<td>INTEGRATION-QA-01</td>
<td>산출물: CI Quality Gate<br />
완료: 신규 Critical 정적결함·Secret 유출 0, 핵심도메인 목표 coverage가 충족된다.</td>
<td>G1</td>
</tr>
<tr class="odd">
<td>WP-INTEGRATION-QA-03</td>
<td>Contract Test Suite</td>
<td>T3Q, UNI, KMA/MOIS, Channel Stub과 UNE OpenAPI/Schema의 요청·응답·오류 fixture를 검증한다.</td>
<td>QA/BE<br />
S5~S9<br />
09.28~12.04</td>
<td>API-DB-SEQ-05,06</td>
<td>산출물: Contract Test Report<br />
완료: provider 변경 시 UI/도메인 Schema가 변하지 않고 주요 fixture가 통과한다.</td>
<td>G1</td>
</tr>
<tr class="even">
<td>WP-INTEGRATION-QA-04</td>
<td>DB Migration·Rollback 시험</td>
<td>초기 schema, version migration, 실패 rollback, 데이터보존, append-only 제약을 검증한다.</td>
<td>QA/BE/DBA<br />
S6~S9<br />
10.12~12.04</td>
<td>API-DB-SEQ-03</td>
<td>산출물: DB Migration Report<br />
완료: 재실행 멱등·rollback·승인본/Execution Event 손실 0건이다.</td>
<td>G3</td>
</tr>
<tr class="odd">
<td>WP-INTEGRATION-QA-05</td>
<td>계획서 E2E</td>
<td>임의 양식→T3Q 목차/본문→편집→Diff→HWPX 저장/Export와 장애흐름을 검증한다.</td>
<td>QA/전팀<br />
S7~S9<br />
10.26~12.04</td>
<td>SCENARIO-02,PLAN-T3Q,HWPX</td>
<td>산출물: Plan E2E Report<br />
완료: UNI 미호출, 사용자수정 보존, HWPX 자동검증, 오류복구가 통과한다.</td>
<td>G3/G4</td>
</tr>
<tr class="even">
<td>WP-INTEGRATION-QA-06</td>
<td>상황·SOP E2E</td>
<td>Fact 수집/충돌/Snapshot→UNI SOP→검증/승인→Workflow 실행까지 검증한다.</td>
<td>QA/전팀<br />
S7~S9<br />
10.26~12.04</td>
<td>SCENARIO-03,SITUATION,UNI-RAG,WORKFLOW</td>
<td>산출물: Situation/SOP E2E Report<br />
완료: Provider 부분실패·SSE 오류·미지원노드·수동입력 분기가 통과한다.</td>
<td>G3</td>
</tr>
<tr class="odd">
<td>WP-INTEGRATION-QA-07</td>
<td>전파·전자상황판·일지 E2E</td>
<td>Outbox/System/Simulation→수신/착수/완료→Timeline→Journal 승인/HWPX를 검증한다.</td>
<td>QA/전팀<br />
S8~S10<br />
11.09~12.18</td>
<td>PROPAGATION,JOURNAL,UI</td>
<td>산출물: Execution/Journal E2E Report<br />
완료: Execution Event 누락·중복 0, source trace 100%, 승인본 불변성을 충족한다.</td>
<td>G3/G4</td>
</tr>
<tr class="even">
<td>WP-INTEGRATION-QA-08</td>
<td>자연재난 Reference E2E</td>
<td>태풍·호우 Pack을 전체 플랫폼에서 실행하고 기대 Event/Journal/평가지표를 비교한다.</td>
<td>QA/PM/전팀<br />
S9~S10<br />
11.23~12.18</td>
<td>SCENARIO-07,08,13</td>
<td>산출물: Natural Scenario Report<br />
완료: 전체 단계 성공, 허용시간·누락·사실성·문서품질 증거가 수집된다.</td>
<td>G5/G6</td>
</tr>
<tr class="odd">
<td>WP-INTEGRATION-QA-09</td>
<td>사회재난 Reference E2E</td>
<td>붕괴사고 Pack을 다기관·분기·증거·Escalation 중심으로 실행한다.</td>
<td>QA/PM/전팀<br />
S9~S10<br />
11.23~12.18</td>
<td>SCENARIO-09,10,13</td>
<td>산출물: Social Scenario Report<br />
완료: 분기·전파·담당변경·완료증거·상황판·일지가 기대값과 일치한다.</td>
<td>G5/G6</td>
</tr>
<tr class="even">
<td>WP-INTEGRATION-QA-10</td>
<td>보안시험</td>
<td>인증/권한, 파일업로드, ZIP/XML, SSRF/allowlist, Secret, 개인정보, 로그마스킹, API abuse를 점검한다.</td>
<td>QA/SEC/전팀<br />
S8~S10<br />
11.09~12.18</td>
<td>전 WP</td>
<td>산출물: Security Test Report<br />
완료: Critical/High 미조치 0, 예외승인은 공식 기록으로 제한된다.</td>
<td>G6</td>
</tr>
<tr class="odd">
<td>WP-INTEGRATION-QA-11</td>
<td>성능·부하시험</td>
<td>50쪽 HWPX 분석/저장, 대형문서 편집, SSE 동시연결, Timeline/Journal projection, Outbox 처리량을 측정한다.</td>
<td>QA/DEVOPS/전팀<br />
S8~S10<br />
11.09~12.18</td>
<td>전 WP</td>
<td>산출물: Performance Report<br />
완료: 목표·실측·병목·수용기준과 개선결과가 기록된다.</td>
<td>G15-5/G6</td>
</tr>
<tr class="even">
<td>WP-INTEGRATION-QA-12</td>
<td>장애·복구시험</td>
<td>T3Q/UNI/공식API/DB/Object Store/SSE/Channel 장애·재시작·부분실패·재처리를 검증한다.</td>
<td>QA/DEVOPS/전팀<br />
S8~S10<br />
11.09~12.18</td>
<td>전 WP</td>
<td>산출물: Resilience/Recovery Report<br />
완료: 외부장애가 수동입력·기존문서 편집·Execution Log를 손실시키지 않는다.</td>
<td>P-06</td>
</tr>
<tr class="odd">
<td>WP-INTEGRATION-QA-13</td>
<td>접근성·사용성 평가</td>
<td>핵심 Actor가 계획서·상황등록·SOP·전파·일지 시나리오를 수행하고 접근성·만족도·오류이해도를 평가한다.</td>
<td>QA/UX/PM<br />
S9~S10<br />
11.23~12.18</td>
<td>UI-16,SCENARIO-11</td>
<td>산출물: Usability Evaluation<br />
완료: 치명 사용성 결함 해소와 3차년도 만족도 평가자료가 확보된다.</td>
<td>G6</td>
</tr>
<tr class="even">
<td>WP-INTEGRATION-QA-14</td>
<td>결함 Triaging·회귀</td>
<td>Severity, ADR/WP/US/E2E 영향, 수정버전, 회귀범위를 관리하고 기준선 결함을 종료한다.</td>
<td>QA/PM/전팀<br />
S5~S11<br />
09.28~12.31</td>
<td>INTEGRATION-QA-01</td>
<td>산출물: Defect Register<br />
완료: Release blocker 0, 미해결 결함은 승인된 제한사항과 사용자고지로 관리된다.</td>
<td>G3~G6</td>
</tr>
<tr class="odd">
<td>WP-INTEGRATION-QA-15</td>
<td>Alpha/Beta 통합 빌드</td>
<td>S7 Alpha와 S9 Beta를 배포하고 데이터·Schema·시나리오·관찰성·롤백을 검증한다.</td>
<td>DEVOPS/QA/전팀<br />
S7~S9<br />
10.26~12.04</td>
<td>PLATFORM-BASE-02,전 WP</td>
<td>산출물: Alpha/Beta Release Notes<br />
완료: 환경별 artifact hash, migration, known issue, rollback이 재현된다.</td>
<td>G3</td>
</tr>
<tr class="even">
<td>WP-INTEGRATION-QA-16</td>
<td>Release Candidate·한컴 승인</td>
<td>S10 RC를 고정하고 HWPX Track A/B, 보안, 성능, 자연/사회 E2E를 종합 승인한다.</td>
<td>PM/QA/연구소장<br />
S10~S10<br />
12.07~12.18</td>
<td>HWPX-QA-11,INTEGRATION-QA-05~15</td>
<td>산출물: RC Approval Package<br />
완료: G4/G5/G6 필수증거가 완비되고 배포보류 사유가 없다.</td>
<td>G4~G6</td>
</tr>
<tr class="odd">
<td>WP-INTEGRATION-QA-17</td>
<td>최종 인수·v1.0 기준선</td>
<td>코드·Schema·설계·시나리오·시험·사용자매뉴얼·SBOM·라이선스·증거를 패키징하고 인수한다.</td>
<td>PM/전팀<br />
S11~S11<br />
12.21~12.31</td>
<td>INTEGRATION-QA-01~16</td>
<td>산출물: Prototype v1.0/Acceptance Package<br />
완료: 산출물 Register 100%, 추적 누락 0, 승인서·인수시험서·변경이력·후속 backlog가 확정된다.</td>
<td>G6</td>
</tr>
</tbody>
</table>

# 8. 산출물·문서·추적성 관리

## 8.1 주요 산출물 Register

| **ID**     | **산출물**                                   | **목표 Sprint** | **책임** | **Gate** |
|------------|----------------------------------------------|-----------------|----------|----------|
| D-ADR-01   | ADR 의사결정기록서 v1.1                      | S0              | PM/ARCH  | G0       |
| D-PLAN-01  | 개발계획서 및 상세 WBS v1.0                  | S1              | PM       | G0       |
| D-US-PLAN  | 계획서 생성 사용자 시나리오 v1.0             | S2              | PM/UX    | G1       |
| D-US-SIT   | 상황일지·안전한국훈련 사용자 시나리오 v1.0   | S3              | PM/UX    | G1       |
| D-SCR-01   | 화면목록·화면흐름·상태/권한/오류 설계서      | S5              | UX/FE    | G3       |
| D-API-01   | OpenAPI/JSON Schema Bundle v1.0              | S7              | ARCH/BE  | G1       |
| D-DB-01    | 논리/물리 DB 설계서 v1.0                     | S7              | ARCH/BE  | G1       |
| D-SEQ-01   | 계획서·상황/SOP·전파·일지 Sequence 명세      | S8              | ARCH     | G3       |
| D-HWPX-POC | HWPX Core/Analyzer/Serializer POC 보고서     | S4              | DOC/QA   | G2       |
| D-UNI-POC  | UNI SOP POC·Mapping/Contract 보고서          | S7              | BE/QA    | G2       |
| D-SCENARIO | 자연/사회 Reference Scenario Pack            | S10             | PM/QA    | G5       |
| D-RT       | 한컴 HWPX 호환성 Round-trip ValidationReport | S10             | QA/DOC   | G4       |
| D-TEST     | 통합·보안·성능·복구·사용성 시험보고서        | S10             | QA       | G6       |
| D-REL      | 프로토타입 v1.0·Release/Acceptance Package   | S11             | PM/전팀  | G6       |

## 8.2 추적성 Chain

| **필수 Chain** ADR → Work Package/WBS → 사용자 시나리오(US) → 화면(SCR) → API/DB/Sequence → Test Case/E2E → Evidence/Approval. 어느 한 단계라도 누락되면 해당 기능은 완료로 승인하지 않는다. |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 8.3 문서 버전·승인

• 초안 v0.x는 검토결함과 미결항목을 포함할 수 있으나 적용 기준선은 승인된 v1.0 이상 또는 명시된 Baseline Tag로 제한한다.

• 상세설계·명세·시나리오·화면/API/DB/Sequence는 요약본이 아니라 구현 가능한 통제문서로 유지한다.

• POC 결과가 기존 설계와 다르면 설계내용을 삭제하지 않고 가정·결과·변경근거·영향·신규 기준을 개정이력과 ADR/CR로 누적한다.

# 9. 시험·검증·인수 계획

## 9.1 시험계층

| **시험**       | **범위**                                                         | **시점**              |
|----------------|------------------------------------------------------------------|-----------------------|
| 단위/정적      | 도메인 규칙, Mapper, Parser, Validator, State machine, 보안 lint | PR CI                 |
| Contract       | T3Q/UNI/KMA/MOIS/Channel 및 UNE OpenAPI/Schema                   | G1                    |
| 통합           | DB/Object Store/SSE/Job/Adapter/Workflow 연계                    | Sprint 종료           |
| E2E            | 계획서, 상황/SOP, 전파/상황판/일지, 자연/사회 Scenario           | G3/G5                 |
| HWPX Track A   | Package/Reference/Semantic/Visual/rhwp reopen                    | 상시 CI/RC            |
| HWPX Track B   | 한컴 open/save/reopen RT-A~G                                     | RC·문서엔진/양식 변경 |
| 보안/성능/복구 | 인증·권한·파일·SSRF·PII, 문서/동시성, 장애복구                   | G6                    |
| 사용성/실증    | Actor 시나리오, 접근성, 만족도, 평가 Rubric                      | G6                    |

## 9.2 핵심 정량·정성 기준

| **영역**        | **합격기준**                                                                |
|-----------------|-----------------------------------------------------------------------------|
| HWPX 구조       | Package 치명오류 0, dangling reference 0, 텍스트·표·필드 의도치 않은 손실 0 |
| 사용자 편집보호 | 사용자 수정/locked Block 자동덮어쓰기 0, revision 충돌 무시 0               |
| 계획서 Provider | 계획서 E2E의 UNI 호출 0, T3Q RPT-001/002 경계 위반 0                        |
| 상황 사실성     | Snapshot 자동확정 0, 원천/파생 Fact provenance 100%, Provider 장애격리      |
| SOP 검증        | 최종 Graph validation 전 실행 0, 깨진 branch/UNKNOWN 미승인 실행 0          |
| 전파            | Execution Event 유실·중복 0, 동일 idempotencyKey 중복발송 0                 |
| 상황일지        | 문장·표셀 source trace 100%, 근거 없는 날짜·수치·조치·피해 0                |
| 시나리오        | 자연·사회 Reference E2E 통과, Mock Org에서 기관교체 시 공통코드 수정 0      |

## 9.3 인수증거

• 승인된 기준문서·Schema·소스 Commit·artifact hash·SBOM·License bundle

• Test Case/E2E 결과, 구조화 로그, DB snapshot, raw/normalized fixture

• HWPX source/output/hancom-resave/diff/screenshot/ValidationReport

• 자연·사회 Scenario 실행 Timeline·Execution Log·Journal·평가표

• 보안·성능·복구·사용성 보고서, 결함 Register, 승인·예외·제한사항

# 10. 위험·외부의존성·대응계획

| **ID** | **위험**                                | **영향/가능성** | **대응**                                                             | **책임**  |
|--------|-----------------------------------------|-----------------|----------------------------------------------------------------------|-----------|
| R-01   | T3Q RPT-001/002 계약 지연               | 상/상           | Mock fixture로 선행개발, 실제 Adapter G1을 Critical milestone로 관리 | PM/BE     |
| R-02   | T3Q 응답 Schema가 2차년도 가정과 불일치 | 상/중           | UNE Contract/Adapter 격리, Gap Matrix와 Contract Test                | ARCH/BE   |
| R-03   | rhwp 특정 문서 객체 미지원              | 상/상           | 호환성 등급, Preserve-only/Reject, Golden Corpus 확대                | DOC       |
| R-04   | Serializer가 참조·번호·표를 손상        | 상/상           | Delta Writer/Reference Rebuilder, Track A/B, 저장차단                | DOC/QA    |
| R-05   | 한컴 시험환경·라이선스 확보 지연        | 상/중           | Track A 계속, RC G4만 보류, 수동 시험증거 기준선                     | PM/QA     |
| R-06   | 한컴 버전·폰트 차이로 Visual Diff 증가  | 중/상           | 환경/폰트 manifest, 원본 open/save baseline, 허용영역 mask           | QA        |
| R-07   | UNI compns/SSE 필드 변경                | 상/중           | Raw Event Store, Mapping Profile versioning, recorded fixture        | BE        |
| R-08   | KMA/MOIS API 제한·장애                  | 중/상           | ProviderStatus/Circuit/Cache/수동입력 fallback                       | BE        |
| R-09   | SafeKorea/Naver 정책·DOM 변경           | 중/상           | Feature Flag OFF, on-demand, DOM fingerprint, 원문링크               | PM/BE     |
| R-10   | 실채널 미제공                           | 중/상           | System/Simulation E2E, ChannelPort Stub                              | BE        |
| R-11   | 실증기관·유형 선정 지연                 | 중/상           | Mock Org와 Reference Scenario, G5 Binding 분리                       | PM        |
| R-12   | 사용자 시나리오 확정 지연               | 상/중           | S1~S3 우선작성, 화면/API/DB 착수 Gate로 관리                         | PM/UX     |
| R-13   | 외부 AI의 허위 Fact                     | 상/중           | Snapshot/Execution Log 소유권, sourceRefs Validator, AI OFF fallback | ARCH/QA   |
| R-14   | 문서·코드·Schema 불일치                 | 상/중           | Traceability, Sprint Baseline Review, Contract CI                    | PM/QA     |
| R-15   | 동시편집·AI 결과 충돌                   | 중/상           | baseRevision, selection hash, generation lock, Diff/Undo             | DOC/BE    |
| R-16   | 파일·원문에 개인정보/비공개정보 포함    | 상/중           | 암호화, RBAC, TTL, 마스킹, 다운로드 제한, 감사                       | SEC/BE    |
| R-17   | 대형 HWPX·WASM 성능 부족                | 중/중           | 50쪽 P95 측정, 부분파싱/Delta 저장, 메모리 프로파일링                | DOC/QA    |
| R-18   | Outbox 재시도로 중복발송                | 상/중           | idempotencyKey, unique constraint, callback dedupe, DLQ              | BE        |
| R-19   | WBS 범위가 일정 대비 과다               | 상/중           | Critical Path·Gate 우선, 기능삭제는 CR, 외부기능은 Stub 분리         | PM        |
| R-20   | 오픈소스 라이선스/공급망 문제           | 상/하           | 고정소스·SHA-256·SBOM·License bundle·dependency audit                | DEVOPS/QA |

## 10.2 외부 요청사항 관리

| **대상**        | **요청사항**                                                           | **미수신 처리**             |
|-----------------|------------------------------------------------------------------------|-----------------------------|
| T3Q             | RPT-001/002 운영 Schema·샘플·오류·인증·부분결과, 상황정보 API, RPT-003 | RPT-001/002만 개발 Critical |
| UNI             | Upload/Search/chat-json 실 payload·SSE sample·model_key·처리상태       | Recorded fixture로 선행     |
| 실증 수요처     | 기관·재난유형·조직·연락망·매뉴얼·양식·일정·평가                        | G5 전까지 Mock 사용         |
| 채널 제공자     | SMS/Email/Broadcast API·SDK·인증·회신·Sandbox                          | System/Simulation 사용      |
| 시험환경 관리자 | Windows/한컴 build/폰트/자동화 권한/정식 사용권                        | G4 RC 전 필요               |

# 11. 완료·인수·후속단계

## 11.1 개발완료 판정

• 코드·Schema·DB migration·화면·API·Sequence·시험·증거·문서가 동일 기준선으로 승인된다.

• 계획서 생성, 상황등록/SOP, 전파/상황판/상황일지, HWPX 저장의 종단 시나리오가 통과한다.

• HWPX Track A/B와 자연·사회 Reference Scenario, 보안·성능·복구·사용성 평가가 완료된다.

• 미해결 외부의존성은 Adapter/Flag/Binding 상태와 후속 Trigger가 명시되고 공통기능을 막지 않는다.

• 최종 인수패키지에 SBOM·라이선스·소스반입 기록·한컴 환경·ValidationReport·Release Note가 포함된다.

## 11.2 본 문서 이후 작업순서

**1.** 재난안전계획서 생성 사용자 시나리오 상세문서 작성

**2.** 상황일지·안전한국훈련 사용자 시나리오 상세문서 작성

**3.** 화면목록·화면흐름·상태·권한·오류 메시지 상세설계

**4.** OpenAPI·DB 논리/물리 모델·Sequence 상세화

**5.** HWPX Engine POC와 UNI SOP POC 병행 및 설계 v1.0 환류

**6.** 자연·사회 Reference Scenario E2E와 실증기관 Binding

| **종료 선언** 본 개발계획서 및 상세 WBS의 승인으로 ADR 확정 이후 개발 착수 기준선이 성립한다. 이후 일정·범위·책임·외부연계·품질기준 변경은 본 WBS를 직접 삭제하거나 축약하지 않고 Change Request와 영향분석을 통해 반영한다. |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 부록 A. RACI

| **업무**                     | **PM/연구소장** | **ARCH** | **FE/UX** | **BE** | **DOC** | **QA/DEVOPS** |
|------------------------------|-----------------|----------|-----------|--------|---------|---------------|
| 기준선/ADR/WBS               | A               | R        | C         | C      | C       | C             |
| React UI/UX                  | C               | C        | A/R       | C      | C       | C             |
| Backend/API/DB               | C               | A        | C         | R      | C       | C             |
| HWPX/rhwp Engine             | C               | A        | C         | C      | R       | C             |
| Provider/UNI/T3Q             | C               | A        | C         | R      | C       | C             |
| Workflow/Propagation/Journal | C               | A        | C         | R      | C       | C             |
| 시험/인수/증거               | A               | C        | C         | C      | C       | R             |
| 배포/환경/SBOM               | C               | C        | C         | C      | C       | A/R           |

R=Responsible, A=Accountable, C=Consulted. 실명과 투입률은 조직 확정 후 Institution/Project Resource Binding으로 갱신한다.

# 부록 B. ADR-WP-Gate 추적표

| **ADR**   | **주요 WP**                                        | **Gate** |
|-----------|----------------------------------------------------|----------|
| ADR-01~04 | WP-HWPX-ANALYZE/EDIT/SERIALIZE, WP-PLAN-T3Q, WP-UI | G2/G3/G4 |
| ADR-05    | WP-PLAN-T3Q                                        | G1/G3    |
| ADR-06    | WP-UNI-RAG, WP-JOURNAL                             | G2/G3    |
| ADR-07    | WP-WORKFLOW, WP-PROPAGATION                        | G3       |
| ADR-08~09 | WP-SITUATION                                       | G1/G3    |
| ADR-10    | WP-WORKFLOW, WP-JOURNAL                            | G3/G4    |
| ADR-11    | WP-SITUATION, WP-PLATFORM-BASE                     | G1/G3    |
| ADR-12    | WP-JOURNAL                                         | G3/G4    |
| ADR-13    | WP-UNI-RAG                                         | G2/G3    |
| ADR-14    | WP-SITUATION, WP-PLATFORM-BASE                     | G1/G3    |
| ADR-15    | WP-HWPX-CORE/ANALYZE/EDIT/SERIALIZE                | G2/G4    |
| ADR-16    | WP-HWPX-QA, WP-INTEGRATION-QA                      | G4/G6    |
| ADR-17    | WP-WORKFLOW/PROPAGATION/UI                         | G3       |
| ADR-18    | WP-SCENARIO, WP-INTEGRATION-QA                     | G5/G6    |

# 부록 C. Gate 체크리스트

| **Gate** | **필수 체크**                                                           |
|----------|-------------------------------------------------------------------------|
| G0       | ADR v1.1 승인, WBS 승인, Register/Change Control/Trace ID 적용          |
| G1       | JSON Schema/OpenAPI lint, Mock/실샘플 Contract, 오류/인증/부분결과 정의 |
| G2       | HWPX 10종·양식 3종·UNI 정상/오류 fixture, POC 보고서와 대안결정         |
| G3       | 사용자 시나리오 정상/대안/예외 E2E, 로그/DB/스크린샷/trace 완비         |
| G4       | Track A 전항목 통과, Windows/한컴 환경 기준선, RT-A~G, 치명손실 0       |
| G5       | 기관/유형/조직/자료/연계/평가 G18-1~6 또는 Mock Baseline 승인           |
| G6       | 보안/성능/복구/사용성/자연·사회 E2E, 산출물 100%, Release 승인          |

# 부록 D. 외부 요청사항 Register 초기값

| **ID**      | **대상**   | **요청**                                              | **목표** | **미수신 처리**              |
|-------------|------------|-------------------------------------------------------|----------|------------------------------|
| EXT-T3Q-01  | T3Q        | RPT-001 목차 요청/응답/오류/인증 샘플                 | S1       | PLAN-T3Q Mock 유지           |
| EXT-T3Q-02  | T3Q        | RPT-002 본문 Job/부분결과/취소/오류 샘플              | S2       | Recorded fixture             |
| EXT-T3Q-03  | T3Q        | 현재 상황정보 API 및 RPT-003 명세                     | S8       | UNE Provider/Projection 유지 |
| EXT-UNI-01  | UNI        | Upload/Search/chat-json 실 payload·SSE 정상/오류 샘플 | S2       | Recorded fixture             |
| EXT-SITE-01 | 수요처     | 실증기관·자연/사회 재난유형·담당자·일정               | S8       | Reference Scenario           |
| EXT-SITE-02 | 수요처     | 위기관리매뉴얼·훈련계획·양식·과거일지                 | S8       | 샘플/공개자료                |
| EXT-CH-01   | 채널제공자 | SMS/Email/Broadcast API·인증·회신                     | S9       | System/Simulation            |
| EXT-RT-01   | 시험환경   | Windows/한컴 build/폰트/VM/정식 사용권                | S7       | Track A, RC 보류             |
