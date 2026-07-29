**재난안전 AI 문서 통합플랫폼**

**화면목록·화면흐름·상태·권한·오류 메시지 상세설계서**

계획서 생성 · 상황일지 · 안전한국훈련 · SOP 실행 통합 UI 기준선

**Version 1.0 \| 2026.07.26**

작성기관 ㈜유엔이(UNE)

과제번호 RS-2024-00407304

문서성격 개발자·UI/UX·QA·수요기관 공통 상세 통제문서

# **문서 통제**

| **구분**                 | **내용**                                                                                                                   |
|--------------------------|----------------------------------------------------------------------------------------------------------------------------|
| **문서명**               | UNE 재난안전 AI 문서 통합플랫폼 화면목록·화면흐름·상태·권한·오류 메시지 상세설계서                                         |
| **버전/기준일**          | Version 1.0 \| 2026.07.26                                                                                                  |
| **작성기관**             | ㈜유엔이(UNE)                                                                                                              |
| **상위 기준선**          | 통합플랫폼 상세설계서 v0.9, ADR 의사결정기록서 v1.1, 개발계획서 및 상세 WBS v1.0                                           |
| **선행 사용자 시나리오** | 재난안전계획서 사용자 시나리오 v1.0, 상황일지·안전한국훈련 사용자 시나리오 v1.0                                            |
| **연계 명세**            | HWPX/rhwp Document Engine v1.0, SituationContext·UNI Adapter v1.0                                                          |
| **후속 산출물**          | API 명세, DB 논리/물리 설계, 화면별 Sequence, 시험케이스 및 E2E 인수시험서                                                 |
| **통제 원칙**            | 내용이 길다는 이유로 화면·상태·권한·예외·추적정보를 축약·삭제하지 않으며, 변경은 ADR/요구사항/Scenario/화면 ID로 추적한다. |

## **제·개정 이력**

| **버전** | **일자**   | **개정내용**                                                                       | **작성/승인**  |
|----------|------------|------------------------------------------------------------------------------------|----------------|
| **1.0**  | 2026.07.26 | ADR v1.1 및 계획서·상황일지/안전한국훈련 사용자 시나리오를 기준으로 최초 상세 작성 | UNE / 승인예정 |

# **목차**

1\. 문서 개요·설계 원칙

2\. 정보구조·Navigation·AppShell

3\. Actor·Role·권한 설계

4\. 업무 객체 상태모델

5\. 공통 컴포넌트·UI 상태·접근성

6\. 화면 목록·Route·Scenario 추적

7\. 모듈별 화면흐름

8\. 화면별 상세설계

9\. 오류·경고·알림 메시지 카탈로그

10\. 반응형·접근성·보안·감사 설계

11\. 화면/API/DB/Sequence 후속 입력사항

부록 A. 상태·권한·오류 인수 체크리스트

# **1. 문서 개요·설계 원칙**

## **1.1 목적**

본 문서는 두 사용자 시나리오 문서에서 제시된 화면 후보를 실제 개발 가능한 화면 ID, Route, 레이아웃, 컴포넌트, 입력·출력, 액션, 상태, 역할·권한, 오류·복구, 반응형 및 인수기준으로 확정한다. 각 화면은 후속 API/DB/Sequence 명세의 출발점이며 Scenario ID와 화면 ID를 변경 없이 사용한다.

## **1.2 적용범위와 책임경계**

| **구분**      | **포함**                                                               | **제외/타기관 책임**                    |
|---------------|------------------------------------------------------------------------|-----------------------------------------|
| **계획서**    | T3Q RPT-001/002 기반 목차·본문 생성, rhwp 편집, HWPX 저장/검증         | RAG/LLM 모델·전용 API 구현은 T3Q        |
| **상황·훈련** | SituationFact/Snapshot, 자료·근거, SOP 생성·실행, 전자상황판, 상황일지 | TTS/STT 및 외부연계 API 자체개발은 T3Q  |
| **UNI POC**   | Upload/Search/chat-json/chat Adapter 및 화면 상태                      | UNI 모델·서버 운영 자체개발 제외        |
| **전파**      | UNE Workflow/Outbox/ChannelPort UI와 이력                              | 실제 SMS/메일/방송 사업자 계약은 별도   |
| **HWPX**      | rhwp 단일 편집 Surface, 보존형 저장, 자동검증, QA Gate                 | 운영 중 서버에서 한컴 GUI 자동실행 제외 |

## **1.3 화면설계 구속 원칙**

**•** AI 생성과 문서 편집을 별도 서비스로 분리하지 않고 rhwp Web Editor를 중앙 Single Editing Surface로 사용한다.

**•** 외부 Provider 값은 자동 확정하지 않으며 Fact 후보→사용자 비교·확정→불변 Snapshot의 단계가 화면에서 명확해야 한다.

**•** 계획서 생성은 T3Q RPT-001/002만 호출하며 계획서 화면에서 UNI fallback 또는 챗봇 기능을 제공하지 않는다.

**•** 상황일지는 Execution Log와 확정 Snapshot을 사실원장으로 사용하며 AI가 사실값·시각·출처를 변경할 수 없다.

**•** 사용자 수정 Block, 승인 revision, 확정 Snapshot, 승인 SOP version은 자동 덮어쓰기할 수 없고 Diff·새 버전·정정 Event로 처리한다.

**•** 외부 장애 시 기존 편집·수동입력·수동전파 기록을 지속할 수 있어야 하며 오류 화면이 작업 손실을 유발하지 않는다.

**•** 실제 재난과 훈련 모드는 모든 주요 화면에서 색상뿐 아니라 텍스트 배지와 아이콘으로 구분한다.

| **통제** | **설계 기준** 화면은 정상상태만 정의하지 않는다. LOADING·EMPTY·PARTIAL·DEGRADED·CONFLICT·READ_ONLY·FAILED·RECOVERY 상태와 권한별 버튼 노출·비활성·오류복구를 함께 정의한다. |
|----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# **2. 정보구조·Navigation·AppShell**

## **2.1 통합 정보구조**

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image1.png" style="width:6.49606in;height:1.00961in" />

그림 2-1. 계획-실행-기록-환류 통합 정보구조

## **2.2 1차 Navigation**

| **메뉴**           | **기본 Route**                | **주요 하위영역**                                        | **기본 접근 역할** |
|--------------------|-------------------------------|----------------------------------------------------------|--------------------|
| **통합 홈**        | /app/home                     | 최근 작업, 내 임무, 운영상태, 알림                       | 인증 사용자        |
| **계획서**         | /app/plans                    | 문서목록, 양식분석, 기준정보, 목차, 편집, 검토, 내보내기 | 계획서 역할        |
| **상황·훈련**      | /app/incidents                | 사건등록, Provider, Fact, Snapshot, 자료, Evidence       | 상황/훈련 역할     |
| **SOP·전자상황판** | /app/incidents/:id/sop        | SOP 생성/편집/승인/실행, 전파, Board                     | 지휘·SOP 역할      |
| **상황일지**       | /app/incidents/:id/journals   | 범위, Projection, 편집, 검토, 내보내기                   | 일지 역할          |
| **평가·환류**      | /app/incidents/:id/evaluation | 종료, 체크포인트, 개선조치, 만족도                       | 평가 역할          |
| **관리·QA**        | /app/admin, /app/qa           | RBAC, 조직/채널, 감사/보존, 연계, Template, Round-trip   | 관리/QA/감사 역할  |

## **2.3 AppShell 영역**

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image2.png" style="width:6.49606in;height:3.65404in" />

그림 2-2. 공통 AppShell 레이아웃

| **영역 ID**    | **영역**            | **필수 표시**                                             | **동작 규칙**                                |
|----------------|---------------------|-----------------------------------------------------------|----------------------------------------------|
| **REG-GH**     | Global Header       | 기관·사용자, active context, 알림, 도움말, 로그아웃       | 업무 객체 전환 시 미저장 변경 확인           |
| **REG-NAV**    | Module Navigation   | 권한이 있는 1차 메뉴와 미처리 badge                       | 권한 없는 메뉴는 숨김, deep link 접근 시 403 |
| **REG-CTX**    | Context Header      | 문서/사건/실행 ID, mode, 상태, revision/version, 저장상태 | 화면 스크롤과 무관하게 sticky                |
| **REG-MAIN**   | Primary Work Area   | 화면 핵심 데이터와 action                                 | 페이지별 focus heading 제공                  |
| **REG-DRAWER** | Context Drawer      | AI, Evidence, Validation, Diff, History                   | 접기 가능, 화면상태 보존                     |
| **REG-STATUS** | Global Status/Toast | Job, 저장, 장애, 성공/경고/오류                           | Toast만으로 치명오류를 전달하지 않음         |

# **3. Actor·Role·권한 설계**

| **Role ID**             | **역할 설명**                             | **기본 쓰기범위** |
|-------------------------|-------------------------------------------|-------------------|
| **SYSTEM_ADMIN**        | 시스템 전역 설정, 사용자/기관, 연계, 보존 | 전역/기관         |
| **INSTITUTION_ADMIN**   | 기관 사용자·업무범위 관리                 | 전역/기관         |
| **PLAN_AUTHOR**         | 계획서 생성·편집·내보내기                 | 업무객체별        |
| **PLAN_REVIEWER**       | 계획서 조회·검토의견·Diff 검토            | 업무객체별        |
| **PLAN_APPROVER**       | 계획서 승인·최종본 확정                   | 업무객체별        |
| **TEMPLATE_MANAGER**    | Template Profile·Prototype 관리           | 업무객체별        |
| **DOCUMENT_QA**         | HWPX 검증·Round-trip·배포 Gate            | 업무객체별        |
| **SITUATION_REGISTRAR** | 사건·Fact·Snapshot 등록/확정              | 업무객체별        |
| **SOP_EDITOR**          | Evidence·SOP 생성/편집                    | 업무객체별        |
| **EXERCISE_CONTROLLER** | 훈련통제·Inject·시뮬레이션·실행           | 업무객체별        |
| **COMMANDER**           | 실제/훈련 지휘, 전파·분기·임무·종료       | 업무객체별        |
| **TASK_ASSIGNEE**       | 임무 수신·착수·보고·완료                  | 업무객체별        |
| **JOURNAL_AUTHOR**      | Projection·상황일지 편집                  | 업무객체별        |
| **EVALUATOR**           | 훈련평가·개선조치                         | 업무객체별        |
| **AUDITOR**             | 감사로그·증거·읽기전용                    | 업무객체별        |

## **3.2 권한 판정 우선순위**

**•** 세션 Role → InstitutionBinding → 업무객체 소유/참여 Binding → 객체 상태 → 세부 Action Policy 순서로 판정한다.

**•** 화면이 버튼을 숨기더라도 Backend가 동일 권한을 재검증한다.

**•** 승인·종료·보존·민감정보 열람은 break-glass를 포함해 사유와 감사이벤트를 필수 기록한다.

**•** 실행 중 SOP, 확정 Snapshot, 승인/최종 문서는 수정권한이 있어도 직접 수정할 수 없으며 새 버전으로만 변경한다.

## **3.3 화면 권한 표현 규칙**

| **상황**            | **표현**                         | **사용자 메시지**                                     | **감사**                 |
|---------------------|----------------------------------|-------------------------------------------------------|--------------------------|
| **메뉴 접근 불가**  | 메뉴 숨김, deep link 403         | 접근 권한이 없습니다. 관리자에게 권한을 요청하십시오. | ACCESS_DENIED            |
| **조회만 가능**     | 입력 잠금, 버튼 숨김 또는 비활성 | 현재 상태/역할에서는 조회만 가능합니다.               | READ_ONLY_OPENED         |
| **선행조건 미충족** | 버튼 비활성+이유 tooltip         | Snapshot 확정 후 실행할 수 있습니다.                  | ACTION_BLOCKED           |
| **상태 변경 중**    | 중복 action 차단, 진행상태 표시  | 요청을 처리 중입니다.                                 | ACTION_STARTED/COMPLETED |
| **break-glass**     | 이유·기간·2차 확인               | 민감정보 열람은 감사대상입니다.                       | PRIVILEGED_ACCESS        |

# **4. 업무 객체 상태모델**

## **계획서 Document**

| **상태**               | **기본 편집** | **화면 표시 규칙**                                   |
|------------------------|---------------|------------------------------------------------------|
| **DRAFT**              | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CONTEXT_READY**      | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **OUTLINE_GENERATING** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **OUTLINE_REVIEW**     | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **OUTLINE_CONFIRMED**  | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CONTENT_GENERATING** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **EDITING**            | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REVIEW_REQUESTED**   | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CHANGES_REQUESTED**  | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **APPROVED**           | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **FINAL**              | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REOPENED**           | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **ERROR**              | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **Template Profile**

| **상태**             | **기본 편집** | **화면 표시 규칙**                                   |
|----------------------|---------------|------------------------------------------------------|
| **DRAFT**            | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **ANALYZING**        | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CONFIRM_REQUIRED** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CONFIRMED**        | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REVIEW**           | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **PUBLISHED**        | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **LIMITED**          | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **DEPRECATED**       | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REJECTED**         | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **Incident/Training**

| **상태**              | **기본 편집** | **화면 표시 규칙**                                   |
|-----------------------|---------------|------------------------------------------------------|
| **DRAFT**             | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REGISTERED**        | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CONTEXT_CONFIRMED** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **SOP_READY**         | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **RUNNING**           | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **PAUSED**            | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CLOSING**           | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CLOSED**            | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REOPENED**          | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **ARCHIVED**          | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **SituationSnapshot**

| **상태**       | **기본 편집** | **화면 표시 규칙**                                   |
|----------------|---------------|------------------------------------------------------|
| **DRAFT**      | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CONFIRMED**  | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **SUPERSEDED** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **FINAL**      | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **UNI SourceDocument**

| **상태**       | **기본 편집** | **화면 표시 규칙**                                   |
|----------------|---------------|------------------------------------------------------|
| **UPLOADING**  | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **QUEUED**     | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **PROCESSING** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **READY**      | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **FAILED**     | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **TIMEOUT**    | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **DELETED**    | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **SOP Definition**

| **상태**              | **기본 편집** | **화면 표시 규칙**                                   |
|-----------------------|---------------|------------------------------------------------------|
| **DRAFT**             | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **VALIDATING**        | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **INVALID**           | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **VALID**             | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REVIEW**            | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CHANGES_REQUESTED** | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **APPROVED**          | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **SUPERSEDED**        | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **SOP Execution**

| **상태**       | **기본 편집** | **화면 표시 규칙**                                   |
|----------------|---------------|------------------------------------------------------|
| **READY**      | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **RUNNING**    | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **PAUSED**     | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **COMPLETED**  | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **TERMINATED** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **FAILED**     | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **Task**

| **상태**                 | **기본 편집** | **화면 표시 규칙**                                   |
|--------------------------|---------------|------------------------------------------------------|
| **CREATED**              | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **SENT**                 | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **DELIVERED**            | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **ACKNOWLEDGED**         | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **IN_PROGRESS**          | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **COMPLETION_SUBMITTED** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **COMPLETED**            | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REJECTED**             | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **UNABLE_REPORTED**      | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REASSIGNED**           | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CANCELLED**            | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **Propagation Message**

| **상태**      | **기본 편집** | **화면 표시 규칙**                                   |
|---------------|---------------|------------------------------------------------------|
| **PENDING**   | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **SENDING**   | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **SENT**      | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **DELIVERED** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **FAILED**    | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CANCELLED** | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **Journal**

| **상태**              | **기본 편집** | **화면 표시 규칙**                                   |
|-----------------------|---------------|------------------------------------------------------|
| **CONFIGURING**       | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **PROJECTING**        | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **DRAFT**             | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **REVIEW**            | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CHANGES_REQUESTED** | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **APPROVED**          | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **FINAL**             | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **SUPERSEDED**        | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **SUPPLEMENT**        | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **FAILED**            | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

## **Evaluation Action**

| **상태**        | **기본 편집** | **화면 표시 규칙**                                   |
|-----------------|---------------|------------------------------------------------------|
| **OPEN**        | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **IN_PROGRESS** | 가능          | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **VERIFYING**   | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **CLOSED**      | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |
| **OVERDUE**     | 제한/불가     | 화면 Header·상태 Chip·Action 영역에 동일 상태명 사용 |

# **5. 공통 컴포넌트·UI 상태·접근성**

| **ID**          | **컴포넌트**      | **공통 책임**                                               |
|-----------------|-------------------|-------------------------------------------------------------|
| **CMP-COM-001** | ContextHeader     | 객체명·ID·mode·상태·revision/version·저장상태·핵심 action   |
| **CMP-COM-002** | StatusChip        | 상태 텍스트+아이콘+색상, 색상만으로 의미전달 금지           |
| **CMP-COM-003** | LifecycleStepper  | 선행/현재/완료/오류 단계를 표시하며 완료단계만 직접이동     |
| **CMP-COM-004** | JobStatusBar      | Job progress, correlationId, 취소/재시도, 부분완료          |
| **CMP-COM-005** | ValidationPanel   | 오류코드, 심각도, 위치, 설명, 사용자조치, 원문/대상 이동    |
| **CMP-COM-006** | DiffViewer        | before/after, 추가·삭제·이동·서식, 선택적용, stale revision |
| **CMP-COM-007** | EvidencePanel     | source, score, 원문, 접근권한, citation, sourceHash         |
| **CMP-COM-008** | RevisionTimeline  | revision/version, actor, time, status, hash, artifact       |
| **CMP-COM-009** | ConfirmDialog     | 영향·되돌리기 가능여부·사유필드·확정버튼                    |
| **CMP-COM-010** | Toast/InlineAlert | 성공은 Toast, 경고/오류는 대상영역 Inline+요약              |
| **CMP-COM-011** | DataGrid          | 필터·정렬·페이지·열고정·키보드탐색·빈상태                   |
| **CMP-COM-012** | FileUploader      | 확장자/크기/보안검사, 진행률, 재시도, hash                  |
| **CMP-COM-013** | ModeBadge         | 실제 재난/훈련을 텍스트·아이콘·색으로 구분                  |
| **CMP-COM-014** | AuditDrawer       | correlationId, event lineage, before/after, actor           |
| **CMP-COM-015** | RecipientSelector | 조직/역할/개인, resolved 대상 미리보기, 연락처 마스킹       |
| **CMP-COM-016** | OfflineQueue      | 현장 모바일 임시저장·동기화·중복방지                        |

## **5.2 공통 화면상태**

| **상태**                  | **필수 UI**                      | **Action 규칙**         | **복구**               |
|---------------------------|----------------------------------|-------------------------|------------------------|
| **LOADING**               | Skeleton+현재 작업명             | 중복 action 차단        | timeout 시 오류/재시도 |
| **EMPTY**                 | 빈 이유+첫 action CTA            | 권한 없는 CTA 미표시    | 필터 초기화/신규       |
| **DIRTY**                 | 미저장 표시                      | 화면이동 시 확인        | 자동저장/임시저장      |
| **GENERATING/PROCESSING** | 진행률+현재단계+correlationId    | 가능한 경우 취소        | 부분결과 유지          |
| **PARTIAL**               | 성공/실패 항목 분리              | 성공결과 사용 가능      | 실패만 재시도          |
| **DEGRADED**              | 장애 Provider와 영향범위         | 기존 편집/수동입력 유지 | 상태복구 후 동기화     |
| **CONFLICT**              | 기준 revision과 사용자 변경 Diff | 자동덮어쓰기 금지       | 재기준화/복제/선택적용 |
| **READ_ONLY**             | 읽기전용 배너+사유               | 쓰기 action 숨김/비활성 | 새 버전/권한요청       |
| **FAILED**                | 오류코드+원인+보존된 작업        | 무한재시도 금지         | 재시도/대체경로/문의   |

## **5.3 접근성·키보드 기준**

**•** 본문 텍스트와 배경 대비는 최소 4.5:1, 큰 글자는 3:1을 적용한다.

**•** 모든 Form label은 프로그램적으로 연결하고 필수·오류를 텍스트로 제공한다.

**•** Grid와 Tree는 키보드 방향키·Enter·Space로 조작하며 drag/drop에는 이동버튼 대안을 제공한다.

**•** Modal/Drawer는 focus trap, 닫기 후 원래 trigger로 focus 복귀, Esc 동작을 제공한다.

**•** 실시간 Board 업데이트는 aria-live polite를 사용하되 잦은 변경으로 읽기를 방해하지 않도록 요약한다.

**•** SOP Canvas는 노드 Tree 대체경로와 속성편집을 제공해 마우스 없이도 구성할 수 있게 한다.

# **6. 화면 목록·Route·Scenario 추적**

| **화면 ID**           | **화면명**                             | **모듈**   | **Route**                                                    | **연계 Scenario**                                               |
|-----------------------|----------------------------------------|------------|--------------------------------------------------------------|-----------------------------------------------------------------|
| **SCR-AUTH-001**      | SSO 토큰 검증·접근결과                 | 공통       | /auth/callback                                               | US-PLAN-001, US-SIT-001                                         |
| **SCR-HOME-001**      | 통합 홈·업무 진입                      | 공통       | /app/home                                                    | US-PLAN-001, US-SIT-001, US-SIT-002                             |
| **SCR-NOTIFY-001**    | 통합 알림센터                          | 공통       | /app/notifications                                           | US-PLAN-024, US-SIT-019, US-SIT-025                             |
| **SCR-PLAN-001**      | 계획서 목록·최근문서·보관함            | 계획서     | /app/plans                                                   | US-PLAN-001, US-PLAN-002, US-PLAN-023                           |
| **SCR-PLAN-002**      | 계획서 시작방식·Workspace 생성         | 계획서     | /app/plans/new                                               | US-PLAN-002, US-PLAN-003                                        |
| **SCR-PLAN-003**      | HWPX 업로드·패키지 검증                | 계획서     | /app/plans/:id/template/upload                               | US-PLAN-003, US-PLAN-004                                        |
| **SCR-PLAN-004**      | Template 분석·Prototype 확인           | 계획서     | /app/plans/:id/template/analyze                              | US-PLAN-005, US-PLAN-006, US-PLAN-025                           |
| **SCR-PLAN-005**      | 기준정보·참조자료·Snapshot             | 계획서     | /app/plans/:id/context                                       | US-PLAN-007, US-PLAN-008, US-PLAN-009                           |
| **SCR-PLAN-006**      | 목차 생성·편집·Diff                    | 계획서     | /app/plans/:id/outline                                       | US-PLAN-009, US-PLAN-010, US-PLAN-011                           |
| **SCR-PLAN-007**      | rhwp 계획서 편집 Workspace             | 계획서     | /app/plans/:id/edit                                          | US-PLAN-012, US-PLAN-013, US-PLAN-014, US-PLAN-015, US-PLAN-020 |
| **SCR-PLAN-008**      | AI 편집·근거·Diff Drawer               | 계획서     | /app/plans/:id/edit?drawer=ai                                | US-PLAN-016, US-PLAN-017, US-PLAN-018, US-PLAN-019              |
| **SCR-PLAN-009**      | 내보내기·Track A 검증                  | 계획서     | /app/plans/:id/export                                        | US-PLAN-021, US-PLAN-022                                        |
| **SCR-PLAN-010**      | 검토·승인·버전·최종본                  | 계획서     | /app/plans/:id/review                                        | US-PLAN-020, US-PLAN-027                                        |
| **SCR-ADMIN-TPL-001** | Template Profile 관리·공유·승격        | 관리       | /app/admin/templates                                         | US-PLAN-028                                                     |
| **SCR-QA-RT-001**     | 한컴 Round-trip QA·배포 Gate           | QA         | /app/qa/hwpx-roundtrip                                       | US-PLAN-029, US-PLAN-030                                        |
| **SCR-SIT-001**       | 사건·훈련 목록·상황 홈                 | 상황·훈련  | /app/incidents                                               | US-SIT-001, US-SIT-002                                          |
| **SCR-SIT-002**       | 사건·훈련 Workspace 개요               | 상황·훈련  | /app/incidents/:id                                           | US-SIT-002, US-SIT-026                                          |
| **SCR-SIT-003**       | 사건·훈련 기본정보 등록                | 상황·훈련  | /app/incidents/new                                           | US-SIT-003                                                      |
| **SCR-SIT-004**       | 외부 Provider 조회·운영상태            | 상황·훈련  | /app/incidents/:id/providers                                 | US-SIT-004, US-SIT-005, US-SIT-039                              |
| **SCR-SIT-005**       | SituationFact 후보·현장보고            | 상황·훈련  | /app/incidents/:id/facts                                     | US-SIT-006, US-SIT-007, US-SIT-022, US-SIT-029                  |
| **SCR-SIT-006**       | 충돌 Fact 비교·결정                    | 상황·훈련  | /app/incidents/:id/facts/conflicts                           | US-SIT-007                                                      |
| **SCR-SIT-007**       | SituationSnapshot 확정·이력            | 상황·훈련  | /app/incidents/:id/snapshots                                 | US-SIT-008, US-SIT-035                                          |
| **SCR-SIT-008**       | 훈련·매뉴얼 자료 업로드                | 상황·훈련  | /app/incidents/:id/sources                                   | US-SIT-009                                                      |
| **SCR-SIT-009**       | UNI 학습상태·문서 관리                 | 상황·훈련  | /app/incidents/:id/sources/status                            | US-SIT-010, US-SIT-039                                          |
| **SCR-SIT-010**       | RAG Evidence 검색·선택·동결            | 상황·훈련  | /app/incidents/:id/evidence                                  | US-SIT-011                                                      |
| **SCR-SOP-001**       | SOP 생성 설정                          | SOP        | /app/incidents/:id/sop/generate                              | US-SIT-012                                                      |
| **SCR-SOP-002**       | SOP JSON SSE 생성·Mapper 결과          | SOP        | /app/incidents/:id/sop/generate/:jobId                       | US-SIT-012, US-SIT-013                                          |
| **SCR-SOP-003**       | SOP Flow Canvas                        | SOP        | /app/incidents/:id/sop/:sopId/edit                           | US-SIT-013, US-SIT-014                                          |
| **SCR-SOP-004**       | 노드 속성·조직·채널 매핑               | SOP        | /app/incidents/:id/sop/:sopId/edit?panel=node                | US-SIT-014                                                      |
| **SCR-SOP-005**       | SOP 검토·승인·버전 고정                | SOP        | /app/incidents/:id/sop/:sopId/review                         | US-SIT-015                                                      |
| **SCR-SOP-006**       | SOP 시뮬레이션·Dry-run                 | SOP        | /app/incidents/:id/sop/:sopId/simulate                       | US-SIT-016, US-SIT-017                                          |
| **SCR-SOP-007**       | SOP 실행 시작·제어·종료                | SOP        | /app/incidents/:id/executions/:executionId                   | US-SIT-017, US-SIT-027                                          |
| **SCR-SOP-008**       | 전파대상·메시지·Outbox                 | SOP        | /app/incidents/:id/executions/:executionId/propagation       | US-SIT-018                                                      |
| **SCR-SOP-009**       | 채널 송신상태·재시도                   | SOP        | /app/incidents/:id/executions/:executionId/messages          | US-SIT-019, US-SIT-025, US-SIT-039                              |
| **SCR-SOP-010**       | 상황판단·분기 선택                     | SOP        | /app/incidents/:id/executions/:executionId/decisions/:nodeId | US-SIT-024                                                      |
| **SCR-TASK-001**      | 현장 임무 수신·착수·진행               | 현장 임무  | /task/:signedToken                                           | US-SIT-020, US-SIT-021                                          |
| **SCR-TASK-002**      | 현장보고·사진·피해/통제 Fact           | 현장 임무  | /task/:token/report                                          | US-SIT-022, US-SIT-029                                          |
| **SCR-TASK-003**      | 임무 완료·불가·반려·재배정             | 현장 임무  | /task/:token/complete                                        | US-SIT-023                                                      |
| **SCR-BOARD-001**     | 전자상황판 통합 모니터링               | 전자상황판 | /app/incidents/:id/board                                     | US-SIT-021, US-SIT-028                                          |
| **SCR-BOARD-002**     | SLA·미수신·Escalation                  | 전자상황판 | /app/incidents/:id/board/escalations                         | US-SIT-025                                                      |
| **SCR-BOARD-003**     | 복수 사건·복수 SOP 통합상황판          | 전자상황판 | /app/boards/multi                                            | US-SIT-026                                                      |
| **SCR-BOARD-004**     | 수동 Event 추가·정정                   | 전자상황판 | /app/incidents/:id/events/manual                             | US-SIT-029                                                      |
| **SCR-JRN-001**       | 상황일지 범위·양식 설정                | 상황일지   | /app/incidents/:id/journals/new                              | US-SIT-030                                                      |
| **SCR-JRN-002**       | JournalProjection·FactRows             | 상황일지   | /app/incidents/:id/journals/:journalId/projection            | US-SIT-031, US-SIT-032                                          |
| **SCR-JRN-003**       | rhwp 상황일지 편집 Workspace           | 상황일지   | /app/incidents/:id/journals/:journalId/edit                  | US-SIT-032, US-SIT-033                                          |
| **SCR-JRN-004**       | 상황일지 근거·Diff·검토                | 상황일지   | /app/incidents/:id/journals/:journalId/review                | US-SIT-033, US-SIT-034                                          |
| **SCR-JRN-005**       | 상황일지 HWPX/PDF/DOCX 내보내기        | 상황일지   | /app/incidents/:id/journals/:journalId/export                | US-SIT-034                                                      |
| **SCR-JRN-006**       | 상황일지 버전·최종본·재생성            | 상황일지   | /app/incidents/:id/journals/:journalId/history               | US-SIT-034, US-SIT-035                                          |
| **SCR-EVAL-001**      | 사건·훈련 종료·최종 기준선             | 평가       | /app/incidents/:id/close                                     | US-SIT-035, US-SIT-036                                          |
| **SCR-EVAL-002**      | 훈련평가 지표·체크포인트               | 평가       | /app/incidents/:id/evaluation/checkpoints                    | US-SIT-036, US-SIT-037, US-SIT-038                              |
| **SCR-EVAL-003**      | 개선조치·SOP/계획서 환류               | 평가       | /app/incidents/:id/evaluation/actions                        | US-SIT-036                                                      |
| **SCR-EVAL-004**      | 만족도·잠재가치·평가보고서             | 평가       | /app/incidents/:id/evaluation/report                         | US-SIT-036, US-SIT-040                                          |
| **SCR-ADMIN-001**     | 기관·사용자·RBAC 관리                  | 관리       | /app/admin/access                                            | US-PLAN-001, US-SIT-040                                         |
| **SCR-ADMIN-002**     | 조직·연락처·채널·수신자 Binding        | 관리       | /app/admin/organization                                      | US-SIT-014, US-SIT-018, US-SIT-040                              |
| **SCR-ADMIN-003**     | 감사·보존·개인정보·보안 설정           | 관리       | /app/admin/audit-security                                    | US-SIT-040, US-PLAN-030                                         |
| **SCR-ADMIN-004**     | Provider·UNI·T3Q·실증 Binding 운영설정 | 관리       | /app/admin/integrations                                      | US-PLAN-024, US-SIT-004, US-SIT-039, US-SIT-040                 |

| **ID** | **화면 ID 통제** 본 문서에서 신규 확정한 SCR-HOME-001, SCR-NOTIFY-001, SCR-SIT-002, SCR-SOP-004/009, SCR-JRN-005/006, SCR-EVAL-002~004, SCR-ADMIN-002~004를 포함해 후속 API/DB/Sequence와 시험문서는 동일 ID를 사용한다. |
|--------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# **7. 모듈별 화면흐름**

## **7.1 재난안전계획서 생성·편집 흐름**

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image3.png" style="width:6.49606in;height:0.42002in" />

그림 7-1. 계획서 생성 화면흐름

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image4.png" style="width:6.49606in;height:3.65404in" />

그림 7-2. rhwp 계획서 Workspace 레이아웃

## **7.2 상황등록·안전한국훈련·SOP·실행 흐름**

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image5.png" style="width:6.49606in;height:0.34435in" />

그림 7-3. 상황·훈련 전체 화면흐름

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image6.png" style="width:6.49606in;height:3.65404in" />

그림 7-4. SituationFact·Snapshot 화면

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image7.png" style="width:6.49606in;height:3.65404in" />

그림 7-5. SOP Canvas·속성패널 화면

## **7.3 현장임무·전자상황판 흐름**

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image8.png" style="width:6.49606in;height:0.52538in" />

그림 7-6. 현장 임무 상태흐름

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image9.png" style="width:5.70866in;height:3.21112in" />

그림 7-7. 현장 임무 모바일 와이어프레임

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image10.png" style="width:6.49606in;height:3.65404in" />

그림 7-8. 전자상황판 와이어프레임

## **7.4 상황일지 생성·편집 흐름**

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image11.png" style="width:6.49606in;height:0.48835in" />

그림 7-9. 상황일지 생성 화면흐름

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/09_SCREEN_FLOW_STATE_PERMISSION_ERROR_v1.0/media/image12.png" style="width:6.49606in;height:3.65404in" />

그림 7-10. 상황일지 편집 Workspace

# **8. 화면별 상세설계**

각 화면은 고유 Route와 Screen ID를 가지며, 공통 AppShell·컴포넌트 기준을 상속한다. 화면별 표의 API 명칭은 후속 API 상세설계에서 확정하되, Action·상태전이·오류복구 조건은 변경하지 않는다.

**SCR-AUTH-001. SSO 토큰 검증·접근결과**

| **항목**            | **상세**                                                                                                |
|---------------------|---------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 공통 / Full page                                                                                        |
| **Route**           | /auth/callback                                                                                          |
| **주요 역할**       | 모든 사용자                                                                                             |
| **연계 Scenario**   | US-PLAN-001, US-SIT-001                                                                                 |
| **화면 목적**       | T3Q 메인 플랫폼에서 전달된 토큰을 검증하고 기관·역할 Binding을 확정한 뒤 적합한 시작 화면으로 이동한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**   | **상세 기능**                                                          | **표시·동작 조건**                   |
|------------|----------------|------------------------------------------------------------------------|--------------------------------------|
| **REG-01** | 인증 진행영역  | 토큰 검증 단계와 correlationId를 표시하며 토큰 원문은 노출하지 않는다. | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 접근거부 카드  | 거부 사유코드, 사용자 조치, 관리자 문의정보를 표시한다.                | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 세션 복구 안내 | 만료/재인증 후 복귀할 원래 route와 미저장 작업 존재 여부를 표시한다.   | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**      | **권한·선행조건**      | **성공 결과/상태전이**              | **실패·복구**                                                                 |
|-----------------|------------------------|-------------------------------------|-------------------------------------------------------------------------------|
| **다시 인증**   | 토큰 만료/무효         | T3Q 로그인으로 이동, returnUrl 보존 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **관리자 문의** | Role/기관 Binding 없음 | 문의정보와 추적번호 복사            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**         | **표현**                             | **공통 규칙**                                   |
|----------------------|--------------------------------------|-------------------------------------------------|
| **TOKEN_VALIDATING** | Spinner, 단계 텍스트, 중복 클릭 차단 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SESSION_ACTIVE**   | 0.5초 이내 대상 route 이동           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **ACCESS_DENIED**    | 문서/사건 데이터 요청 전 차단        | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>AUTH-1001 토큰 누락<br />
AUTH-1002 토큰 만료<br />
AUTH-1003 기관 Binding 없음<br />
AUTH-1004 권한 없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>모바일/데스크톱 동일. 키보드 초점은 오류 제목 → 조치버튼 순서.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 토큰·PII가 화면/로그에 평문 노출되지 않는다.<br />
• 권한확정 전 업무 API가 호출되지 않는다.</td>
</tr>
</tbody>
</table>

**SCR-HOME-001. 통합 홈·업무 진입**

| **항목**            | **상세**                                                                                                   |
|---------------------|------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 공통 / Full page                                                                                           |
| **Route**           | /app/home                                                                                                  |
| **주요 역할**       | 인증 사용자                                                                                                |
| **연계 Scenario**   | US-PLAN-001, US-SIT-001, US-SIT-002                                                                        |
| **화면 목적**       | 계획서, 상황·훈련, 진행 중 임무, 최근 문서와 장애/알림을 한 화면에서 제공하고 역할별 허용 기능만 노출한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**  | **상세 기능**                                                 | **표시·동작 조건**                   |
|------------|---------------|---------------------------------------------------------------|--------------------------------------|
| **REG-01** | 업무 바로가기 | 계획서 신규작성, 사건/훈련 등록, 상황판, 상황일지로 이동한다. | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 최근 작업     | 최근 문서/사건/훈련 5건과 마지막 수정시각을 표시한다.         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 내 임무       | 미확인/진행/기한임박 임무를 표시한다.                         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 운영상태      | T3Q, UNI, Provider, 전파채널 상태를 요약한다.                 | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**         | **권한·선행조건**        | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------------|--------------------------|------------------------|-------------------------------------------------------------------------------|
| **신규 계획서**    | PLAN_AUTHOR 이상         | SCR-PLAN-002           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **사건·훈련 등록** | SITUATION_REGISTRAR 이상 | SCR-SIT-003            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **내 임무 열기**   | TASK_ASSIGNEE            | SCR-TASK-001           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태** | **표현**                                  | **공통 규칙**                                   |
|--------------|-------------------------------------------|-------------------------------------------------|
| **NORMAL**   | 역할별 카드 노출                          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **EMPTY**    | 최근 작업 없음 안내                       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DEGRADED** | 외부 Provider 장애 배너, 기존 작업은 계속 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>COM-0001 홈 데이터 일부 조회 실패<br />
COM-0002 즐겨찾기 저장 실패</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-NOTIFY-001. 통합 알림센터**

| **항목**            | **상세**                                                                                    |
|---------------------|---------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 공통 / Full page / Drawer                                                                   |
| **Route**           | /app/notifications                                                                          |
| **주요 역할**       | 인증 사용자                                                                                 |
| **연계 Scenario**   | US-PLAN-024, US-SIT-019, US-SIT-025                                                         |
| **화면 목적**       | 검토요청, 생성 Job 결과, 임무전파, SLA 경고, Provider 장애를 사용자별로 조회·읽음 처리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                            | **표시·동작 조건**                   |
|------------|--------------|------------------------------------------|--------------------------------------|
| **REG-01** | 필터바       | 미읽음, 업무영역, 심각도, 기간 필터      | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 알림목록     | 발생시각, 업무객체, 요약, 조치링크, 상태 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 상세패널     | correlationId, 관련 Event, 권장조치      | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **읽음처리**      | 본인 알림         | 알림 상태 READ         | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **관련화면 이동** | 유효한 deep link  | 권한 재검증 후 이동    | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **모두 읽음**     | 확인 대화상자     | 현재 필터 범위만 처리  | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**                | **공통 규칙**                                   |
|----------------|-------------------------|-------------------------------------------------|
| **LOADING**    | Skeleton                | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **EMPTY**      | 조건에 맞는 알림 없음   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **NORMAL**     | 읽음/미읽음 구분        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **STALE_LINK** | 대상 삭제/권한변경 안내 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>NOTI-0101 알림목록 조회 실패<br />
NOTI-0102 대상 접근권한 없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-001. 계획서 목록·최근문서·보관함**

| **항목**            | **상세**                                                                                                 |
|---------------------|----------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Full page                                                                                       |
| **Route**           | /app/plans                                                                                               |
| **주요 역할**       | PLAN_AUTHOR, PLAN_REVIEWER, PLAN_APPROVER, AUDITOR                                                       |
| **연계 Scenario**   | US-PLAN-001, US-PLAN-002, US-PLAN-023                                                                    |
| **화면 목적**       | 사용자가 접근 가능한 계획서 목록을 검색하고 신규작성, 재열기, 복제, 삭제/복원, 검토상태 확인을 수행한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                                                 | **표시·동작 조건**                   |
|------------|--------------|---------------------------------------------------------------|--------------------------------------|
| **REG-01** | 검색·필터    | 문서명, 재난유형, 단계, 소유자, 상태, 기간                    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 문서 Grid    | 문서명, 재난유형, revision, 생성/수정일시, 검토상태, 저장상태 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 최근문서     | 최근 5건을 별도 고정                                          | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 휴지통 탭    | 삭제시각, 만료예정, 복원 가능여부                             | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**    | **권한·선행조건**  | **성공 결과/상태전이**           | **실패·복구**                                                                 |
|---------------|--------------------|----------------------------------|-------------------------------------------------------------------------------|
| **신규 작성** | PLAN_AUTHOR        | SCR-PLAN-002                     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **열기**      | READ 권한          | 현재 상태에 따른 편집/조회 route | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **복제**      | PLAN_AUTHOR        | 새 documentId/revision 0         | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **삭제**      | 소유자/관리자      | 휴지통 이동, 확정 필요           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **복원**      | 휴지통 보존기간 내 | 원래 목록 복귀                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태** | **표현**          | **공통 규칙**                                   |
|--------------|-------------------|-------------------------------------------------|
| **LOADING**  | Grid skeleton     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **EMPTY**    | 신규작성 CTA      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **NORMAL**   | 필터·정렬·페이지  | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DELETED**  | 휴지통에서만 조회 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>PLAN-3001 목록 조회 실패<br />
PLAN-3002 복제 실패<br />
PLAN-3003 삭제 권한 없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-002. 계획서 시작방식·Workspace 생성**

| **항목**            | **상세**                                                                                                   |
|---------------------|------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Wizard                                                                                            |
| **Route**           | /app/plans/new                                                                                             |
| **주요 역할**       | PLAN_AUTHOR                                                                                                |
| **연계 Scenario**   | US-PLAN-002, US-PLAN-003                                                                                   |
| **화면 목적**       | 시스템 양식, 저장된 Template Profile, 임의 HWPX, 기존 완성문서 중 시작방식을 선택하고 작업공간을 생성한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**    | **상세 기능**                        | **표시·동작 조건**                   |
|------------|-----------------|--------------------------------------|--------------------------------------|
| **REG-01** | 시작방식 카드   | 각 방식의 지원범위·제한·예상처리시간 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 문서 기본정보   | 문서명, 재난유형, 작성기관, 공개범위 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Template 선택기 | Profile 버전, 호환성, 최근 검증결과  | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 파일 Dropzone   | HWPX만 허용, 크기·보안 안내          | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**         | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **Workspace 생성** | 필수값 유효       | Document DRAFT 생성    | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **이전**           | 변경 없음         | 목록으로               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **임시저장**       | 기본정보 입력됨   | DRAFT 보존             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**             | **표현**       | **공통 규칙**                                   |
|--------------------------|----------------|-------------------------------------------------|
| **START_MODE_SELECTING** | 방식 선택      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FILE_SELECTED**        | 파일 메타 표시 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CREATING**             | 중복 제출 차단 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **WORKSPACE_READY**      | 다음 단계 이동 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>PLAN-3004 문서명 필수<br />
HWPX-7001 지원하지 않는 확장자<br />
FILE-2002 용량 초과</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-003. HWPX 업로드·패키지 검증**

| **항목**            | **상세**                                                                                                             |
|---------------------|----------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Full page                                                                                                   |
| **Route**           | /app/plans/:id/template/upload                                                                                       |
| **주요 역할**       | PLAN_AUTHOR, TEMPLATE_MANAGER                                                                                        |
| **연계 Scenario**   | US-PLAN-003, US-PLAN-004                                                                                             |
| **화면 목적**       | HWPX 업로드 진행률, SHA-256, 패키지 구조·보안검사, 호환성 후보를 표시하고 REJECT/LIMITED 처리와 재업로드를 지원한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**      | **상세 기능**                              | **표시·동작 조건**                   |
|------------|-------------------|--------------------------------------------|--------------------------------------|
| **REG-01** | 파일요약          | 파일명, 크기, hash, 업로더, 업로드시각     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 검증 Stepper      | Signature→ZIP 안전→필수 Part→XML→Reference | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Issue Grid        | 코드, 심각도, part/path, 설명, 조치        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Preservation 요약 | 알 수 없는 Part/객체 보존 수량             | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건**                    | **성공 결과/상태전이**    | **실패·복구**                                                                 |
|-------------------|--------------------------------------|---------------------------|-------------------------------------------------------------------------------|
| **재업로드**      | 검증 실패/교체                       | 기존 Artifact는 이력 보존 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **검증 재실행**   | 정책/Parser 변경 또는 transient 오류 | 새 validationRunId        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **제한모드 계속** | LIMITED이고 치명오류 없음            | 사용자 동의 기록          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**       | **표현**       | **공통 규칙**                                   |
|--------------------|----------------|-------------------------------------------------|
| **UPLOAD_PENDING** | 대기           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **UPLOADING**      | 진행률         | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **VALIDATING**     | 단계별 상태    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **VALIDATED**      | 다음 단계      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **LIMITED**        | 경고 및 동의   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REJECTED**       | 편집 진입 차단 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>HWPX-7002 ZIP 서명 불일치<br />
HWPX-7003 Zip Bomb 의심<br />
HWPX-7004 필수 Part 누락<br />
HWPX-7005 XML 파싱 실패</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-004. Template 분석·Prototype 확인**

| **항목**            | **상세**                                                                                                    |
|---------------------|-------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Full page                                                                                          |
| **Route**           | /app/plans/:id/template/analyze                                                                             |
| **주요 역할**       | PLAN_AUTHOR, TEMPLATE_MANAGER, DOCUMENT_QA                                                                  |
| **연계 Scenario**   | US-PLAN-005, US-PLAN-006, US-PLAN-025                                                                       |
| **화면 목적**       | 자동분석된 문단 역할, 개요Level, Prototype, 정적영역, 미지원 객체와 신뢰도를 시각적으로 검토·수정·확정한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**      | **상세 기능**                                       | **표시·동작 조건**                   |
|------------|-------------------|-----------------------------------------------------|--------------------------------------|
| **REG-01** | 문서 Preview      | 분석 위치 강조, paragraphId 표시                    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 역할 Mapping Grid | 원본문단, 추정 역할, level, confidence, prototypeId | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 정적영역 패널     | 머리말·꼬리말·고정표·필드 잠금                      | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 호환성 패널       | SUPPORTED/PRESERVE_ONLY/LIMITED/REJECT              | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**         | **권한·선행조건**               | **성공 결과/상태전이**      | **실패·복구**                                                                 |
|--------------------|---------------------------------|-----------------------------|-------------------------------------------------------------------------------|
| **역할 수정**      | PLAN_AUTHOR/TEMPLATE_MANAGER    | Profile Draft revision 증가 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Prototype 지정** | TEMPLATE_MANAGER 또는 문서 전용 | 원본문단 clone 기준 설정    | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Profile 확정**   | 치명오류 없음                   | CONFIRMED                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **공유 승격**      | TEMPLATE_MANAGER                | 검증 Gate 통과 후 PUBLISHED | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**         | **표현**                   | **공통 규칙**                                   |
|----------------------|----------------------------|-------------------------------------------------|
| **ANALYZING**        | 진행률                     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONFIRM_REQUIRED** | 저신뢰 항목 강조           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **LIMITED**          | 보존전용 표시              | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONFIRMED**        | 편집 잠금 후 기준정보 이동 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>TPL-2101 분석 Job 실패<br />
TPL-2102 저신뢰 역할 미확정<br />
TPL-2103 순환/깨진 스타일 참조<br />
TPL-2104 공유승격 Gate 미통과</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-005. 기준정보·참조자료·Snapshot**

| **항목**            | **상세**                                                                                                                     |
|---------------------|------------------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Full page                                                                                                           |
| **Route**           | /app/plans/:id/context                                                                                                       |
| **주요 역할**       | PLAN_AUTHOR, PLAN_REVIEWER                                                                                                   |
| **연계 Scenario**   | US-PLAN-007, US-PLAN-008, US-PLAN-009                                                                                        |
| **화면 목적**       | 문서주제, 배경정보, 내용지침, 표현규칙, 작성목적과 참조자료를 입력·검증하고 T3Q 전송 전 불변 PlanContextSnapshot을 생성한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**    | **상세 기능**                                                              | **표시·동작 조건**                   |
|------------|-----------------|----------------------------------------------------------------------------|--------------------------------------|
| **REG-01** | 기준정보 Form   | 재난유형, 단계, 기간, 장소, 필수요소, 문체, 문장길이, 개요규칙, 역할, 독자 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Prompt 미리보기 | 템플릿명 제외, 실제 전송 구조와 문자수                                     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 참조자료 선택   | 접근권한, Provider 상태, 반영여부                                          | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Snapshot 배너   | snapshotId, 생성시각, 전송필드 hash                                        | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**      | **권한·선행조건** | **성공 결과/상태전이**       | **실패·복구**                                                                 |
|-----------------|-------------------|------------------------------|-------------------------------------------------------------------------------|
| **임시저장**    | PLAN_AUTHOR       | PlanContext revision 증가    | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **미리보기**    | 필수값 일부 가능  | 전송예정 구조 표시           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **목차 생성**   | 필수값 PASS       | Snapshot 생성 후 RPT-001 Job | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **템플릿 저장** | PLAN_AUTHOR       | 개인/팀 ContextTemplate      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**              | **표현**         | **공통 규칙**                                   |
|---------------------------|------------------|-------------------------------------------------|
| **CONTEXT_EDITING**       | 편집가능         | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONTEXT_READY**         | 필수값 PASS      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SNAPSHOT_CREATED**      | 전송값 잠금      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REFERENCE_UNAVAILABLE** | 제외 또는 재시도 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>PLAN-3005 필수 기준정보 누락<br />
PLAN-3006 작성가이드 200자 초과<br />
REF-2201 참조자료 접근불가<br />
T3Q-3101 Provider 사용불가</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-006. 목차 생성·편집·Diff**

| **항목**            | **상세**                                                                                                    |
|---------------------|-------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Full page                                                                                          |
| **Route**           | /app/plans/:id/outline                                                                                      |
| **주요 역할**       | PLAN_AUTHOR, PLAN_REVIEWER, PLAN_APPROVER                                                                   |
| **연계 Scenario**   | US-PLAN-009, US-PLAN-010, US-PLAN-011                                                                       |
| **화면 목적**       | RPT-001 결과를 계층 Tree로 표시하고 추가·수정·삭제·이동, 재요청 결과 Diff, 구조검증과 목차 확정을 수행한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                           | **표시·동작 조건**                   |
|------------|--------------|-----------------------------------------|--------------------------------------|
| **REG-01** | 목차 Tree    | drag/drop, level, 생성/사용자수정 표시  | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 노드 속성    | 제목, level, 포함지침, prototype role   | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 검증 패널    | 빈 제목, level jump, 중복경로, 최대깊이 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Diff Viewer  | 추가/삭제/변경/이동별 적용선택          | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**                   | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|------------------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **노드 추가/수정/삭제/이동** | PLAN_AUTHOR       | OutlineRevision 증가   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **재요청**                   | Snapshot 존재     | RPT-001 후 Diff        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **변경 적용**                | 선택 Diff         | 사용자수정 보호        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **목차 확정**                | 검증 PASS         | OUTLINE_CONFIRMED      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**           | **표현**        | **공통 규칙**                                   |
|------------------------|-----------------|-------------------------------------------------|
| **OUTLINE_GENERATING** | Job 상태        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **OUTLINE_REVIEW**     | 편집가능        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DIFF_READY**         | 기존본 유지     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **OUTLINE_CONFIRMED**  | 본문생성 가능   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **OUTLINE_ERROR**      | 재시도/수동작성 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>T3Q-3102 RPT-001 timeout<br />
PLAN-3007 목차 Schema 오류<br />
PLAN-3008 level 규칙 위반<br />
PLAN-3009 사용자수정 충돌</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-007. rhwp 계획서 편집 Workspace**

| **항목**            | **상세**                                                                                                             |
|---------------------|----------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Full page                                                                                                   |
| **Route**           | /app/plans/:id/edit                                                                                                  |
| **주요 역할**       | PLAN_AUTHOR, PLAN_REVIEWER                                                                                           |
| **연계 Scenario**   | US-PLAN-012, US-PLAN-013, US-PLAN-014, US-PLAN-015, US-PLAN-020                                                      |
| **화면 목적**       | 본문 생성 Job의 부분 Block을 즉시 반영하면서 rhwp 직접편집, 자동저장, 생성중지·부분재시도, 문서구조 탐색을 제공한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**   | **상세 기능**                                  | **표시·동작 조건**                   |
|------------|----------------|------------------------------------------------|--------------------------------------|
| **REG-01** | Outline 패널   | Section/Block별 대기·생성·완료·오류·사용자수정 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | rhwp Editor    | 원본 Prototype 서식, 직접 타이핑/삭제/표 편집  | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Job Status Bar | 진행률, 현재 Section, 중지, 실패 수            | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Revision 상태  | 저장중/저장완료/미동기화/충돌                  | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-05** | 우측 Drawer    | AI·근거·검증·이력 탭                           | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**         | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **본문 생성**      | OUTLINE_CONFIRMED | RPT-002 Job 시작       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Job 중지**       | GENERATING        | cutoff 이후 event 무시 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Section 재시도** | ERROR/PARTIAL     | 제안 Diff 생성         | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **자동저장**       | 변경 발생         | batch command 저장     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Undo/Redo**      | 현재 session      | inverse ChangeSet      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**           | **표현**            | **공통 규칙**                                   |
|------------------------|---------------------|-------------------------------------------------|
| **EDITOR_READY**       | 편집가능            | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONTENT_GENERATING** | 생성영역 lock       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PARTIAL**            | 완료 Block 편집가능 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **UNSYNCED**           | 로컬변경 보존       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONFLICT**           | Diff/복구 선택      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READ_ONLY**          | 검토/승인 상태      | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>T3Q-3103 RPT-002 연결끊김<br />
DOC-3201 자동저장 실패<br />
DOC-3202 revision 충돌<br />
DOC-3203 생성영역 편집시도</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-008. AI 편집·근거·Diff Drawer**

| **항목**            | **상세**                                                                                                                     |
|---------------------|------------------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Right drawer / Modal                                                                                                |
| **Route**           | /app/plans/:id/edit?drawer=ai                                                                                                |
| **주요 역할**       | PLAN_AUTHOR, PLAN_REVIEWER                                                                                                   |
| **연계 Scenario**   | US-PLAN-016, US-PLAN-017, US-PLAN-018, US-PLAN-019                                                                           |
| **화면 목적**       | Cursor/Range/Block/Section 선택정보를 바탕으로 AI 편집 작업을 요청하고 근거와 변경사항을 비교한 뒤 명시적으로 적용·취소한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**   | **상세 기능**                                  | **표시·동작 조건**                   |
|------------|----------------|------------------------------------------------|--------------------------------------|
| **REG-01** | Selection 요약 | paragraphId/blockId/offset/range/revision      | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 작업 선택      | 재작성, 확장, 축약, 근거추가, 표변환, 문체변환 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 근거 패널      | citation, 원문 preview, score, 접근권한        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Diff Viewer    | 문자/문단/Block 변경, 보호영역 충돌            | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-05** | 적용 범위      | 전체/선택 변경만 적용                          | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**         | **권한·선행조건**   | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------------|---------------------|------------------------|-------------------------------------------------------------------------------|
| **AI 요청**        | 유효 selection      | Job 생성               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **변경 적용**      | revision 일치       | 원자적 ChangeSet       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **취소**           | DIFF_READY          | 문서 무변경            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **잠금 해제 요청** | editedByUser/locked | 사유 기록              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**        | **표현**                     | **공통 규칙**                                   |
|---------------------|------------------------------|-------------------------------------------------|
| **SELECTION_EMPTY** | 사용법 안내                  | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **AI_GENERATING**   | 취소 가능                    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DIFF_READY**      | 적용 전 원문 유지            | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **STALE_REVISION**  | 재기준화 필요                | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONFLICT**        | 보호 Block 자동덮어쓰기 금지 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>PLAN-3010 선택범위 유효하지 않음<br />
DOC-3204 stale revision<br />
PLAN-3011 근거 접근불가<br />
PLAN-3012 사실/고정영역 변경 시도</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-009. 내보내기·Track A 검증**

| **항목**            | **상세**                                                                                           |
|---------------------|----------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Full page                                                                                 |
| **Route**           | /app/plans/:id/export                                                                              |
| **주요 역할**       | PLAN_AUTHOR, PLAN_APPROVER, DOCUMENT_QA                                                            |
| **연계 Scenario**   | US-PLAN-021, US-PLAN-022                                                                           |
| **화면 목적**       | 보존형 HWPX 저장, 패키지·참조·내용·서식 자동검증, PDF/DOCX 보조 Export와 다운로드 이력을 관리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**       | **상세 기능**                                | **표시·동작 조건**                   |
|------------|--------------------|----------------------------------------------|--------------------------------------|
| **REG-01** | 출력설정           | HWPX/PDF/DOCX, 파일명, 검토표시, 보안표시    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Validation Stepper | Package→Reference→Semantic→Style→rhwp reopen | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Issue Grid         | 치명/경고, 영향범위, 허용여부                | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Artifact 목록      | hash, 크기, 생성자, 생성시각, 다운로드횟수   | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**      | **권한·선행조건**                 | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-----------------|-----------------------------------|------------------------|-------------------------------------------------------------------------------|
| **HWPX 생성**   | 편집 revision 저장완료            | Serializer Job         | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **보조 Export** | HWPX 생성 또는 Canonical Document | 변환 Job               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **다운로드**    | Artifact READY                    | 감사이벤트             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **재검증**      | Artifact 존재                     | 새 ValidationReport    | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**    | **표현**           | **공통 규칙**                                   |
|-----------------|--------------------|-------------------------------------------------|
| **SERIALIZING** | 취소불가 단계 표시 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **VALIDATING**  | 진행률             | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READY**       | 다운로드 가능      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **LIMITED**     | 경고 동의 필요     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAILED**      | 기존 Artifact 유지 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>HWPX-7006 참조 무결성 실패<br />
HWPX-7007 텍스트 손실 감지<br />
HWPX-7008 rhwp 재열기 실패<br />
EXPORT-3301 PDF 변환 실패</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-PLAN-010. 검토·승인·버전·최종본**

| **항목**            | **상세**                                                                              |
|---------------------|---------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 계획서 / Full page                                                                    |
| **Route**           | /app/plans/:id/review                                                                 |
| **주요 역할**       | PLAN_AUTHOR, PLAN_REVIEWER, PLAN_APPROVER, AUDITOR                                    |
| **연계 Scenario**   | US-PLAN-020, US-PLAN-027                                                              |
| **화면 목적**       | Revision 비교, 검토의견, 수정요청, 승인, FinalArtifact 확정과 재개정 분기를 관리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**       | **상세 기능**                                  | **표시·동작 조건**                   |
|------------|--------------------|------------------------------------------------|--------------------------------------|
| **REG-01** | Revision Timeline  | 작성자, 시각, 변경요약, 상태, artifact         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 검토 체크리스트    | 내용·근거·수치·서식·호환성                     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Comment/Issue Grid | 대상 block, 심각도, 담당자, 처리상태           | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 승인 패널          | 승인자, 승인시각, revision/hash, 최종 Artifact | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**   | **권한·선행조건**    | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------|----------------------|------------------------|-------------------------------------------------------------------------------|
| **검토요청** | PLAN_AUTHOR          | REVIEW_REQUESTED       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수정요청** | REVIEWER/APPROVER    | CHANGES_REQUESTED      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **승인**     | APPROVER, 필수이슈 0 | APPROVED/FINAL         | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **재개정**   | 승인문서 소유자      | 새 working revision    | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**          | **표현**            | **공통 규칙**                                   |
|-----------------------|---------------------|-------------------------------------------------|
| **DRAFT**             | 작성자 편집         | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REVIEW_REQUESTED**  | 작성 잠금/의견 대응 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CHANGES_REQUESTED** | 편집 재개           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **APPROVED**          | 승인 revision 잠금  | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FINAL**             | 최종본              | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REOPENED**          | 신규 revision       | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>REVIEW-3401 필수 검토항목 미완료<br />
REVIEW-3402 승인권한 없음<br />
REVIEW-3403 승인대상 revision 변경</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-ADMIN-TPL-001. Template Profile 관리·공유·승격**

| **항목**            | **상세**                                                                                        |
|---------------------|-------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 관리 / Full page                                                                                |
| **Route**           | /app/admin/templates                                                                            |
| **주요 역할**       | TEMPLATE_MANAGER, DOCUMENT_QA, AUDITOR                                                          |
| **연계 Scenario**   | US-PLAN-028                                                                                     |
| **화면 목적**       | Template Profile, Prototype Registry, 지원 객체, 검증이력과 배포상태를 조회·비교·승격·폐기한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                                         | **표시·동작 조건**                   |
|------------|--------------|-------------------------------------------------------|--------------------------------------|
| **REG-01** | Profile Grid | 이름, 적용재난, sourceHash, version, 상태, 사용문서수 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 상세탭       | Role Mapping, Prototype, 정적영역, 호환성             | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 검증이력     | Golden 문서, Track A/B 결과, known issue              | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 영향분석     | 승격 시 영향 문서/패치                                | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**          | **권한·선행조건**     | **성공 결과/상태전이** | **실패·복구**                                                                 |
|---------------------|-----------------------|------------------------|-------------------------------------------------------------------------------|
| **새 Profile 등록** | TEMPLATE_MANAGER      | DRAFT                  | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **승격요청**        | 검증 PASS             | REVIEW                 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **배포승인**        | DOCUMENT_QA/승인자    | PUBLISHED              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **폐기**            | 사용중 문서 영향 확인 | DEPRECATED             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**           | **공통 규칙**                                   |
|----------------|--------------------|-------------------------------------------------|
| **DRAFT**      | 수정가능           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REVIEW**     | 검증중             | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PUBLISHED**  | 신규문서 선택 가능 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DEPRECATED** | 기존문서만 유지    | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>TPL-2105 sourceHash 중복<br />
TPL-2106 검증증거 부족<br />
TPL-2107 사용중 Profile 삭제 불가</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-QA-RT-001. 한컴 Round-trip QA·배포 Gate**

| **항목**            | **상세**                                                                                                                   |
|---------------------|----------------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | QA / Full page                                                                                                             |
| **Route**           | /app/qa/hwpx-roundtrip                                                                                                     |
| **주요 역할**       | DOCUMENT_QA, TEMPLATE_MANAGER, AUDITOR                                                                                     |
| **연계 Scenario**   | US-PLAN-029, US-PLAN-030                                                                                                   |
| **화면 목적**       | Golden Corpus별 Track A 자동검증과 지정 한컴 환경의 열기·저장·재열기 Track B 결과를 기록하고 Release 승인 여부를 결정한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                               | **표시·동작 조건**                   |
|------------|--------------|---------------------------------------------|--------------------------------------|
| **REG-01** | 시험 Matrix  | 원본/편집유형/한컴버전/OS/기대결과          | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Track A 결과 | 패키지·참조·의미·서식·rhwp 재열기           | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Track B 입력 | 한컴 열기경고, 저장본 업로드, 육안회귀 체크 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Release Gate | 치명결함, 조건부허용, 승인자, 증거링크      | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**             | **권한·선행조건**     | **성공 결과/상태전이** | **실패·복구**                                                                 |
|------------------------|-----------------------|------------------------|-------------------------------------------------------------------------------|
| **시험실행**           | QA                    | ValidationRun 생성     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **한컴 저장본 업로드** | 지정 환경             | hash와 환경기록        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **조건부 승인**        | 경고만 존재           | 허용사유/만료일        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **배포승인**           | 모든 필수 Matrix PASS | Release Candidate 승인 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**    | **표현**         | **공통 규칙**                                   |
|-----------------|------------------|-------------------------------------------------|
| **NOT_RUN**     | 대기             | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RUNNING**     | 자동/수동 단계   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PASS**        | 배포 가능        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONDITIONAL** | Known issue 포함 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAIL**        | 배포 차단        | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>HWPX-7010 한컴 열기 실패<br />
HWPX-7011 복구경고<br />
HWPX-7012 재저장 후 구조회귀<br />
HWPX-7013 시험환경 불일치</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-001. 사건·훈련 목록·상황 홈**

| **항목**            | **상세**                                                                                            |
|---------------------|-----------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Full page                                                                               |
| **Route**           | /app/incidents                                                                                      |
| **주요 역할**       | SITUATION_REGISTRAR, EXERCISE_CONTROLLER, COMMANDER, JOURNAL_AUTHOR, AUDITOR                        |
| **연계 Scenario**   | US-SIT-001, US-SIT-002                                                                              |
| **화면 목적**       | 접근 가능한 사건·훈련을 상태·재난유형·기관·기간으로 조회하고 신규 등록 또는 진행 화면으로 진입한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**  | **상세 기능**                                                | **표시·동작 조건**                   |
|------------|---------------|--------------------------------------------------------------|--------------------------------------|
| **REG-01** | 상태 KPI      | 등록/확정/실행/종료 사건 수, 미수신/지연                     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 사건 Grid     | mode, 재난유형, 위치, 기준시각, Snapshot, 실행상태, 담당기관 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 빠른 필터     | 실제/훈련, 진행중, 내 담당, 최근 24시간                      | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 최근 업데이트 | 마지막 Execution Event                                       | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**         | **권한·선행조건**   | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------------|---------------------|------------------------|-------------------------------------------------------------------------------|
| **신규 등록**      | SITUATION_REGISTRAR | SCR-SIT-003            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Workspace 열기** | READ 권한           | SCR-SIT-002            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **전자상황판**     | RUNNING 사건        | SCR-BOARD-001          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태** | **표현**    | **공통 규칙**                                   |
|--------------|-------------|-------------------------------------------------|
| **LOADING**  | Skeleton    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **EMPTY**    | 등록 CTA    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **NORMAL**   | 실시간 갱신 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **ARCHIVED** | 읽기전용    | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SIT-4001 목록조회 실패<br />
SIT-4002 기관 접근권한 없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-002. 사건·훈련 Workspace 개요**

| **항목**            | **상세**                                                                                                |
|---------------------|---------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Full page                                                                                   |
| **Route**           | /app/incidents/:id                                                                                      |
| **주요 역할**       | 상황 관련 역할                                                                                          |
| **연계 Scenario**   | US-SIT-002, US-SIT-026                                                                                  |
| **화면 목적**       | 사건의 Context, Snapshot, 자료, SOP, 실행, 상황판, 일지, 평가 진행도를 하나의 Step/Tab 구조로 제공한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**      | **상세 기능**                                          | **표시·동작 조건**                   |
|------------|-------------------|--------------------------------------------------------|--------------------------------------|
| **REG-01** | Context Header    | mode, incidentId, status, disasterType, location, asOf | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Lifecycle Stepper | 상황등록→Snapshot→근거→SOP→실행→일지→평가              | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 진행카드          | 각 단계 상태와 미결항목                                | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 최근 Event        | Execution Log 최근 10건                                | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건**   | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------|---------------------|------------------------|-------------------------------------------------------------------------------|
| **단계 이동**     | 해당 단계 권한      | 상태에 맞는 화면       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **사건 일시정지** | COMMANDER           | 사유 입력              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **복제/훈련전환** | EXERCISE_CONTROLLER | 새 incidentId          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**          | **표현**         | **공통 규칙**                                   |
|-----------------------|------------------|-------------------------------------------------|
| **DRAFT**             | 기본정보 편집    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONTEXT_CONFIRMED** | SOP 준비         | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RUNNING**           | 실행/상황판 중심 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CLOSING**           | 미결 정리        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CLOSED**            | 읽기전용         | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SIT-4003 단계 선행조건 미충족<br />
SIT-4004 잘못된 mode 전환</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-003. 사건·훈련 기본정보 등록**

| **항목**            | **상세**                                                                                                   |
|---------------------|------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Wizard                                                                                         |
| **Route**           | /app/incidents/new                                                                                         |
| **주요 역할**       | SITUATION_REGISTRAR, EXERCISE_CONTROLLER                                                                   |
| **연계 Scenario**   | US-SIT-003                                                                                                 |
| **화면 목적**       | 실제 재난과 안전한국훈련을 구분하고 재난유형·위치·시간·기관·훈련계획을 입력해 SituationContext를 생성한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**     | **상세 기능**                                          | **표시·동작 조건**                   |
|------------|------------------|--------------------------------------------------------|--------------------------------------|
| **REG-01** | Mode 선택        | REAL/TRAINING, 화면 전체에 명확한 배지                 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 기본정보 Form    | 제목, 재난유형, 발생/훈련기간, 위치·행정코드, 주관기관 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 훈련정보         | 훈련목표, 참여기관, 통제관, 계획번호                   | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 초기 사용자 Fact | 최초 신고/상황요약/출처                                | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**   | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **임시저장** | 필수 일부         | DRAFT                  | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **등록**     | 필수 PASS         | Incident REGISTERED    | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **취소**     | 변경 존재         | 확인대화상자           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**           | **공통 규칙**                                   |
|----------------|--------------------|-------------------------------------------------|
| **EDITING**    | 입력               | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **VALIDATING** | 행정코드/기관 확인 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REGISTERED** | Workspace 이동     | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SIT-4005 재난유형 필수<br />
SIT-4006 시간범위 오류<br />
SIT-4007 주관기관 Binding 없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-004. 외부 Provider 조회·운영상태**

| **항목**            | **상세**                                                                                                  |
|---------------------|-----------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Full page                                                                                     |
| **Route**           | /app/incidents/:id/providers                                                                              |
| **주요 역할**       | SITUATION_REGISTRAR, COMMANDER, AUDITOR                                                                   |
| **연계 Scenario**   | US-SIT-004, US-SIT-005, US-SIT-039                                                                        |
| **화면 목적**       | KMA/MOIS 공식 API와 SafeKorea/Naver 보조 수집 상태, 최신성, 조회범위, Cache, 실패·재시도 내역을 표시한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**  | **상세 기능**                                    | **표시·동작 조건**                   |
|------------|---------------|--------------------------------------------------|--------------------------------------|
| **REG-01** | Provider 카드 | 우선순위, 방식, lastSuccessAt, status, freshness | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 조회조건      | 지역, 시간범위, 재난범주, on-demand 동의         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 수집 Run Grid | runId, 시작/종료, 건수, 오류, parserVersion      | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 보조수집 경고 | 약관/robots/DOM 안정성, 원문링크                 | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**          | **권한·선행조건**   | **성공 결과/상태전이** | **실패·복구**                                                                 |
|---------------------|---------------------|------------------------|-------------------------------------------------------------------------------|
| **조회 실행**       | SITUATION_REGISTRAR | Collector Job          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Provider 재시도** | FAILED              | backoff 준수           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **원문 열기**       | sourceUrl 존재      | 새 창/감사             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수동입력 전환**   | Provider 불가       | SCR-SIT-005            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**        | **표현**            | **공통 규칙**                                   |
|---------------------|---------------------|-------------------------------------------------|
| **IDLE**            | 조회 전             | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RUNNING**         | Provider별 진행     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PARTIAL_SUCCESS** | 성공 Fact 사용 가능 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAILED**          | 수동입력 지원       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DOM_CHANGED**     | 자동수집 중지       | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>PROV-4101 KMA timeout<br />
PROV-4102 MOIS 인증 실패<br />
PROV-4103 DOM 변경감지<br />
PROV-4104 Rate limit</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-005. SituationFact 후보·현장보고**

| **항목**            | **상세**                                                                                                   |
|---------------------|------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Full page                                                                                      |
| **Route**           | /app/incidents/:id/facts                                                                                   |
| **주요 역할**       | SITUATION_REGISTRAR, COMMANDER, TASK_ASSIGNEE                                                              |
| **연계 Scenario**   | US-SIT-006, US-SIT-007, US-SIT-022, US-SIT-029                                                             |
| **화면 목적**       | 외부·사용자·현장 Fact를 범주별로 정규화해 원천 Provenance와 함께 조회하고 선택·제외·파생수정·수동추가한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**   | **상세 기능**                                                                 | **표시·동작 조건**                   |
|------------|----------------|-------------------------------------------------------------------------------|--------------------------------------|
| **REG-01** | Fact Grid      | category, value, observedAt/issuedAt/retrievedAt, provider, source, freshness | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 중복그룹       | 동일 사건·시각·위치 후보 묶음                                                 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 원문 Preview   | sourceUrl/sourceId/hash/parserVersion                                         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 수동 Fact Form | USER_ASSERTED/현장보고, 첨부, 확인수준                                        | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건**   | **성공 결과/상태전이**   | **실패·복구**                                                                 |
|-------------------|---------------------|--------------------------|-------------------------------------------------------------------------------|
| **선택/제외**     | SITUATION_REGISTRAR | selection 변경           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수정 파생**     | 원천 Fact 불변      | originalFactId 연결      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **현장보고 추가** | 권한/Task 연결      | ExecutionEvent+Fact 후보 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **충돌비교**      | conflict 존재       | SCR-SIT-006              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**      | **표현**           | **공통 규칙**                                   |
|-------------------|--------------------|-------------------------------------------------|
| **FACTS_LOADING** | 수집중             | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REVIEWING**     | 선택가능           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **STALE**         | 최신성 경고        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONFLICT**      | 비교필요           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READ_ONLY**     | Snapshot 포함 Fact | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SIT-4008 observedAt 누락<br />
SIT-4009 원천 Fact 직접수정 금지<br />
FILE-2004 첨부 악성코드 의심</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-006. 충돌 Fact 비교·결정**

| **항목**            | **상세**                                                                                                          |
|---------------------|-------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Full page / Modal                                                                                     |
| **Route**           | /app/incidents/:id/facts/conflicts                                                                                |
| **주요 역할**       | SITUATION_REGISTRAR, COMMANDER                                                                                    |
| **연계 Scenario**   | US-SIT-007                                                                                                        |
| **화면 목적**       | 서로 다른 Provider/시각/단위/지역의 충돌 Fact를 병렬 비교하고 선택·병합·사용자 확정값 생성과 판단사유를 기록한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                          | **표시·동작 조건**                   |
|------------|--------------|----------------------------------------|--------------------------------------|
| **REG-01** | 비교 Header  | category, 충돌원인, 영향 Snapshot 항목 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 후보 비교표  | 값, 단위, 시각, 출처, 신뢰도, 최신성   | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 지도/시간축  | 위치·시점 차이 시 표시                 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 결정 패널    | 선택/병합/새 확정값, 사유, 확인자      | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **후보 선택**     | 권한자            | conflict RESOLVED      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **병합**          | 호환 단위/범위    | 파생 Fact              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **보류**          | 필수항목 아님     | UNRESOLVED 유지        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Snapshot 검토** | 필수 충돌 0       | SCR-SIT-007            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**         | **공통 규칙**                                   |
|----------------|------------------|-------------------------------------------------|
| **UNRESOLVED** | 결정 필요        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RESOLVING**  | 입력             | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RESOLVED**   | 결정내용 잠금    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REOPENED**   | Snapshot 갱신 시 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SIT-4010 단위 변환 불가<br />
SIT-4011 필수 충돌 미해결<br />
SIT-4012 결정사유 누락</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-007. SituationSnapshot 확정·이력**

| **항목**            | **상세**                                                                                                                      |
|---------------------|-------------------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Full page                                                                                                         |
| **Route**           | /app/incidents/:id/snapshots                                                                                                  |
| **주요 역할**       | SITUATION_REGISTRAR, COMMANDER, AUDITOR                                                                                       |
| **연계 Scenario**   | US-SIT-008, US-SIT-035                                                                                                        |
| **화면 목적**       | 선택된 Fact의 확정본을 미리보기하고 불변 Snapshot을 생성하며 이후 변경은 새 Context revision과 Snapshot version으로 관리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**      | **상세 기능**                                               | **표시·동작 조건**                   |
|------------|-------------------|-------------------------------------------------------------|--------------------------------------|
| **REG-01** | Snapshot 미리보기 | 재난유형, 위치, 기준시각, 선택 Fact, 미해결 Warning         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 확정 체크리스트   | 필수 범주, 충돌, 최신성, 확인자                             | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 버전 Timeline     | snapshotId, contextRevision, confirmer, hash, 사용 SOP/일지 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 변경 Diff         | 이전 Snapshot 대비 Fact 추가/제외/변경                      | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **Snapshot 확정** | 필수 PASS         | 불변 Snapshot 생성     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **새 버전 생성**  | 상황변경          | Context revision 증가  | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **이전본 비교**   | 2개 이상          | Diff                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **종료 Snapshot** | CLOSING           | 최종기준선             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**       | **공통 규칙**                                   |
|----------------|----------------|-------------------------------------------------|
| **DRAFT**      | 수정가능       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONFIRMING** | 중복 클릭 차단 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONFIRMED**  | 불변           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SUPERSEDED** | 이력 유지      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FINAL**      | 사건종료 기준  | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SIT-4013 필수 Fact 누락<br />
SIT-4014 최신성 임계치 초과<br />
SIT-4015 사용중 Snapshot 삭제 불가</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-008. 훈련·매뉴얼 자료 업로드**

| **항목**            | **상세**                                                                                                        |
|---------------------|-----------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Full page                                                                                           |
| **Route**           | /app/incidents/:id/sources                                                                                      |
| **주요 역할**       | EXERCISE_CONTROLLER, SOP_EDITOR, SYSTEM_ADMIN                                                                   |
| **연계 Scenario**   | US-SIT-009                                                                                                      |
| **화면 목적**       | 안전한국훈련 계획서·메시지·임무카드·평가지침·위기관리매뉴얼을 업로드하고 보존범위·공개등급·학습요청을 설정한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**   | **상세 기능**                                 | **표시·동작 조건**                   |
|------------|----------------|-----------------------------------------------|--------------------------------------|
| **REG-01** | 자료분류       | 훈련계획/Inject/임무카드/평가지침/매뉴얼/기타 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 파일 업로더    | 다중파일, hash, 악성코드, 개인정보 경고       | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 보존·공개 설정 | 사건전용/기관공유, retention, 원문사용 동의   | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 문서목록       | doc_id, UNI 상태, sourceHash, 삭제/승격       | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이**     | **실패·복구**                                                                 |
|-------------------|-------------------|----------------------------|-------------------------------------------------------------------------------|
| **업로드**        | SOP_EDITOR 이상   | UNI 비동기 요청            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **학습요청**      | 검증 PASS         | QUEUED                     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **삭제**          | 미사용/권한       | UNE 메타와 UNI 삭제 동기화 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **기관공유 승격** | 관리자 승인       | 공유 Evidence source       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**    | **공통 규칙**                                   |
|----------------|-------------|-------------------------------------------------|
| **UPLOADING**  | 진행률      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **QUEUED**     | 학습대기    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PROCESSING** | 파싱/색인   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READY**      | 검색가능    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAILED**     | 재시도/삭제 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>UNI-4201 업로드 실패<br />
UNI-4202 지원하지 않는 파일<br />
FILE-2005 개인정보 포함 경고</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-009. UNI 학습상태·문서 관리**

| **항목**            | **상세**                                                                                                    |
|---------------------|-------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Full page                                                                                       |
| **Route**           | /app/incidents/:id/sources/status                                                                           |
| **주요 역할**       | SOP_EDITOR, SYSTEM_ADMIN, AUDITOR                                                                           |
| **연계 Scenario**   | US-SIT-010, US-SIT-039                                                                                      |
| **화면 목적**       | UNI 비동기 문서 처리 상태를 폴링·조회하고 READY 자료만 근거로 허용하며 실패·timeout·삭제·재학습을 관리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                                                  | **표시·동작 조건**                   |
|------------|--------------|----------------------------------------------------------------|--------------------------------------|
| **REG-01** | 상태 Grid    | doc_id, 파일명, status, progress, chunks, lastCheckedAt, error | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 처리상세     | 파싱/청킹/임베딩 단계, provider trace                          | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 운영정책     | poll interval, timeout, retry count                            | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 사용중 표시  | EvidenceSet/SOP에서 참조 여부                                  | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **상태 새로고침** | 권한자            | UNI status             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **재학습**        | FAILED            | 새 request             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **삭제**          | 미사용            | 확인 후 삭제           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **READY 필터**    | 항상              | SCR-SIT-010            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**    | **공통 규칙**                                   |
|----------------|-------------|-------------------------------------------------|
| **QUEUED**     | 대기        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PROCESSING** | 진행        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READY**      | 선택가능    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAILED**     | 원인/재시도 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **TIMEOUT**    | 운영자 확인 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DELETED**    | 이력만      | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>UNI-4203 상태조회 실패<br />
UNI-4204 처리 timeout<br />
UNI-4205 사용중 문서 삭제불가</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SIT-010. RAG Evidence 검색·선택·동결**

| **항목**            | **상세**                                                                                                                |
|---------------------|-------------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황·훈련 / Full page                                                                                                   |
| **Route**           | /app/incidents/:id/evidence                                                                                             |
| **주요 역할**       | SOP_EDITOR, EXERCISE_CONTROLLER, COMMANDER                                                                              |
| **연계 Scenario**   | US-SIT-011                                                                                                              |
| **화면 목적**       | 확정 Snapshot과 READY 자료를 기준으로 UNI 검색결과를 검토하고 SOP 생성에 사용할 EvidenceSet을 우선순위와 함께 동결한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**     | **상세 기능**                                             | **표시·동작 조건**                   |
|------------|------------------|-----------------------------------------------------------|--------------------------------------|
| **REG-01** | 검색조건         | 질의, disasterType, 목표, top_k, source filter            | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 결과 Grid        | chunk, score, doc, page/section, preview, 선택            | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 원문 Preview     | 문맥 전후, sourceHash                                     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | EvidenceSet 패널 | USER_UPLOAD/UNI_RAG/SITUATION_FACT 우선순위, 선택수, hash | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**           | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|----------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **검색**             | Snapshot 확정     | UNI /search            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **선택/제외**        | 접근권한          | EvidenceSet draft      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **원문열기**         | 권한 확인         | 감사기록               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **EvidenceSet 동결** | 필수 근거검토     | 불변 set 생성          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**       | **표현**              | **공통 규칙**                                   |
|--------------------|-----------------------|-------------------------------------------------|
| **SEARCHING**      | Skeleton              | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RESULTS**        | 선택가능              | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **NO_RESULT**      | 질의수정/사용자자료만 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FROZEN**         | SOP 생성 기준         | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SOURCE_REVOKED** | 재동결 필요           | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>UNI-4206 검색 실패<br />
UNI-4207 원문 접근권한 없음<br />
UNI-4208 EvidenceSet 빈 상태</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-001. SOP 생성 설정**

| **항목**            | **상세**                                                                                               |
|---------------------|--------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Full page                                                                                        |
| **Route**           | /app/incidents/:id/sop/generate                                                                        |
| **주요 역할**       | SOP_EDITOR, EXERCISE_CONTROLLER                                                                        |
| **연계 Scenario**   | US-SIT-012                                                                                             |
| **화면 목적**       | Snapshot·EvidenceSet·생성옵션·Schema version을 확인하고 UNI /chat/json 구조화 SOP 생성 Job을 시작한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**  | **상세 기능**                                  | **표시·동작 조건**                   |
|------------|---------------|------------------------------------------------|--------------------------------------|
| **REG-01** | 입력기준 요약 | snapshotId/hash, evidenceSetId/hash            | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 생성옵션      | SOP 목적, 상세도, 위기경보, 조직가정, 최대노드 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Schema/Mapper | SopSchemaVersion, mapperVersion                | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 요청 Preview  | 개인정보 마스킹, idempotencyKey                | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **초안 생성**     | 입력기준 확정     | SSE Job 시작           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **기준 변경**     | 실행 전           | 해당 화면 이동         | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **기존 SOP 복제** | 접근권한          | DRAFT 생성             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**         | **공통 규칙**                                   |
|----------------|------------------|-------------------------------------------------|
| **READY**      | 생성가능         | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **VALIDATING** | 입력검사         | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **QUEUED**     | UNI 연결대기     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **ERROR**      | 기준 유지 재시도 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SOP-5001 Snapshot 미확정<br />
SOP-5002 EvidenceSet 미동결<br />
UNI-4209 chat/json 연결실패</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-002. SOP JSON SSE 생성·Mapper 결과**

| **항목**            | **상세**                                                                               |
|---------------------|----------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Full page                                                                        |
| **Route**           | /app/incidents/:id/sop/generate/:jobId                                                 |
| **주요 역할**       | SOP_EDITOR, EXERCISE_CONTROLLER                                                        |
| **연계 Scenario**   | US-SIT-012, US-SIT-013                                                                 |
| **화면 목적**       | SSE 이벤트 수신상태, 원시 compn, UNE 변환노드, Schema 검증과 오류를 단계별로 표시한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**       | **상세 기능**                           | **표시·동작 조건**                   |
|------------|--------------------|-----------------------------------------|--------------------------------------|
| **REG-01** | SSE Timeline       | connected→meta→compn\*→done/error       | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 생성노드 목록      | 수신순서, type, sourceRefs, mapper 상태 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 검증 패널          | 필수필드, 고립/순환, 시작/종료, 근거    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Raw/Canonical 비교 | 권한자에 한해 마스킹 표시               | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**          | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|---------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **생성 중지**       | RUNNING           | 수신 cutoff            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **오류노드 재매핑** | Mapper 오류       | 선택 node              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Canvas로 이동**   | done+검증가능     | SCR-SOP-003            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Raw 다운로드**    | 관리자/감사       | 민감정보 마스킹        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**      | **공통 규칙**                                   |
|----------------|---------------|-------------------------------------------------|
| **CONNECTING** | SSE 연결      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **STREAMING**  | 부분노드 표시 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **MAPPING**    | 변환          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DONE**       | Canvas 가능   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PARTIAL**    | 수동보완      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **ERROR**      | 재시도        | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>UNI-4210 SSE 순서오류<br />
SOP-5003 compn 필수필드 누락<br />
SOP-5004 Mapper 미지원 type</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-003. SOP Flow Canvas**

| **항목**            | **상세**                                                                            |
|---------------------|-------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Full page                                                                     |
| **Route**           | /app/incidents/:id/sop/:sopId/edit                                                  |
| **주요 역할**       | SOP_EDITOR, EXERCISE_CONTROLLER, COMMANDER                                          |
| **연계 Scenario**   | US-SIT-013, US-SIT-014                                                              |
| **화면 목적**       | 시작·행동·판단·설명·종료 노드와 Edge를 편집하고 자동배치·검증·Undo/Redo를 제공한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**     | **상세 기능**                              | **표시·동작 조건**                   |
|------------|------------------|--------------------------------------------|--------------------------------------|
| **REG-01** | Node Palette     | 허용 노드 타입                             | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Flow Canvas      | drag, connect, zoom, minimap, multi-select | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Outline Tree     | 노드순서·오류·근거상태                     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Validation Panel | 고립, 순환, 분기조건, 담당/완료조건        | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**              | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **노드 추가/복제/삭제** | SOP_EDITOR        | revision 증가          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Edge 연결**           | 유효 타입         | 그래프 변경            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **자동배치**            | 노드 존재         | 위치만 변경            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **검증**                | 언제든            | ValidationReport       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Undo/Redo**           | session           | inverse operation      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**       | **공통 규칙**                                   |
|----------------|----------------|-------------------------------------------------|
| **DRAFT**      | 편집           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **VALIDATING** | 결과표시       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **INVALID**    | 오류노드 강조  | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **VALID**      | 검토요청 가능  | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READ_ONLY**  | 승인/실행 버전 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SOP-5005 고립노드<br />
SOP-5006 순환경로<br />
SOP-5007 시작/종료 누락<br />
SOP-5008 Edge 연결불가</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-004. 노드 속성·조직·채널 매핑**

| **항목**            | **상세**                                                                                           |
|---------------------|----------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Right panel                                                                                  |
| **Route**           | /app/incidents/:id/sop/:sopId/edit?panel=node                                                      |
| **주요 역할**       | SOP_EDITOR, ORG_ADMIN, EXERCISE_CONTROLLER                                                         |
| **연계 Scenario**   | US-SIT-014                                                                                         |
| **화면 목적**       | 선택 노드의 임무내용, 담당역할/수신자 규칙, 메시지, 채널, 기한, 완료조건, 판단식, 근거를 편집한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**  | **상세 기능**                                    | **표시·동작 조건**                   |
|------------|---------------|--------------------------------------------------|--------------------------------------|
| **REG-01** | 공통속성      | 노드명, 설명, 위기단계, sourceRefs               | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 행동속성      | 임무, 담당 role/person, due, completion criteria | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 전파속성      | 채널, 메시지 템플릿, 첨부, 확인요구              | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 판단속성      | 표현식, 입력값, 분기별 label                     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-05** | 조직 Selector | 기관/부서/역할/개인 Binding                      | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**          | **권한·선행조건**  | **성공 결과/상태전이** | **실패·복구**                                                                 |
|---------------------|--------------------|------------------------|-------------------------------------------------------------------------------|
| **속성 저장**       | 유효값             | node revision          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수신자 미리보기** | Binding 존재       | 실제 대상목록          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **메시지 미리보기** | Template 변수 유효 | 실제/훈련 배지         | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **근거 연결**       | Evidence 접근권한  | sourceRefs             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**        | **표현**       | **공통 규칙**                                   |
|---------------------|----------------|-------------------------------------------------|
| **NO_SELECTION**    | 안내           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **EDITING**         | 필드별 저장    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **INVALID**         | 오류필드 강조  | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **BINDING_MISSING** | 실행 차단 경고 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SOP-5009 담당자 규칙 누락<br />
SOP-5010 완료조건 누락<br />
PROP-5101 채널설정 없음<br />
SOP-5011 판단식 구문오류</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-005. SOP 검토·승인·버전 고정**

| **항목**            | **상세**                                                                         |
|---------------------|----------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Full page                                                                  |
| **Route**           | /app/incidents/:id/sop/:sopId/review                                             |
| **주요 역할**       | SOP_EDITOR, COMMANDER, APPROVER, AUDITOR                                         |
| **연계 Scenario**   | US-SIT-015                                                                       |
| **화면 목적**       | 그래프·근거·조직·채널·완료조건을 검토하고 승인 version/hash를 불변으로 고정한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**   | **상세 기능**                              | **표시·동작 조건**                   |
|------------|----------------|--------------------------------------------|--------------------------------------|
| **REG-01** | 검토 Checklist | 그래프/근거/조직/채널/실행안전             | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Issue Grid     | nodeId, 심각도, 의견, 담당, 상태           | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Version 비교   | 현재 vs 이전 승인본                        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 승인 패널      | 승인자, 기관, evidenceHash, validationHash | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**   | **권한·선행조건**   | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------|---------------------|------------------------|-------------------------------------------------------------------------------|
| **검토요청** | SOP_EDITOR, VALID   | REVIEW                 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수정요청** | 검토자              | DRAFT 복귀             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **승인**     | APPROVER, 필수이슈0 | APPROVED               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **새 버전**  | 승인본 기반         | DRAFT clone            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**          | **표현**  | **공통 규칙**                                   |
|-----------------------|-----------|-------------------------------------------------|
| **DRAFT**             | 편집      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REVIEW**            | 잠금      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CHANGES_REQUESTED** | 편집 재개 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **APPROVED**          | 불변      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SUPERSEDED**        | 이력      | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SOP-5012 검토필수항목 미완료<br />
SOP-5013 승인대상 hash 변경<br />
SOP-5014 실행중 버전 수정금지</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-006. SOP 시뮬레이션·Dry-run**

| **항목**            | **상세**                                                                                             |
|---------------------|------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Full page                                                                                      |
| **Route**           | /app/incidents/:id/sop/:sopId/simulate                                                               |
| **주요 역할**       | EXERCISE_CONTROLLER, SOP_EDITOR, QA                                                                  |
| **연계 Scenario**   | US-SIT-016, US-SIT-017                                                                               |
| **화면 목적**       | 실제 외부발송 없이 가상시계·가상수신자·Inject로 분기·임무·전자상황판·상황일지 Projection을 검증한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**      | **상세 기능**                           | **표시·동작 조건**                   |
|------------|-------------------|-----------------------------------------|--------------------------------------|
| **REG-01** | 시뮬레이션 설정   | 가상시각, 속도, Inject set, 수신자 세트 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 실행 Console      | 활성노드, event, 가상 task, 분기        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 기대결과 비교     | checkpoint, 기대/실제, pass/fail        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 외부발송 차단배너 | SIMULATION Channel만 사용               | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**         | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **시작**           | 승인/검증대상 SOP | SIMULATION execution   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **시간 진행/정지** | RUNNING           | virtual clock          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Inject 투입**    | 정의된 시각/수동  | Event 생성             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **결과확정**       | 종료              | SimulationReport       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**    | **표현**    | **공통 규칙**                                   |
|-----------------|-------------|-------------------------------------------------|
| **CONFIGURING** | 설정        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RUNNING**     | 가상 실행   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PAUSED**      | 시간정지    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **COMPLETED**   | 결과        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAILED**      | 오류/재실행 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SIM-5301 실제 채널 호출 감지<br />
SIM-5302 기대분기 불일치<br />
SIM-5303 Inject 형식오류</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-007. SOP 실행 시작·제어·종료**

| **항목**            | **상세**                                                                                           |
|---------------------|----------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Full page                                                                                    |
| **Route**           | /app/incidents/:id/executions/:executionId                                                         |
| **주요 역할**       | COMMANDER, EXERCISE_CONTROLLER, AUDITOR                                                            |
| **연계 Scenario**   | US-SIT-017, US-SIT-027                                                                             |
| **화면 목적**       | 승인 SOP와 Snapshot을 고정해 실행을 시작하고 일시정지·재개·중지·종료와 미완료임무 처리를 통제한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**  | **상세 기능**                                          | **표시·동작 조건**                   |
|------------|---------------|--------------------------------------------------------|--------------------------------------|
| **REG-01** | 실행 Header   | executionId, mode, sopVersion/hash, snapshotId, status | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 활성노드/임무 | 현재경로, 선행/후행, 상태                              | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Control Bar   | 시작, 일시정지, 재개, 중지, 종료                       | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 종료 Dialog   | 사유, pending task disposition, 승인                   | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**    | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|---------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **실행 시작** | APPROVED+Binding  | RUNNING                | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **일시정지**  | RUNNING           | PAUSED                 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **재개**      | PAUSED            | RUNNING                | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **중지**      | 권한+사유         | TERMINATED             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **종료**      | 완료조건/승인     | COMPLETED              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현**            | **공통 규칙**                                   |
|----------------|---------------------|-------------------------------------------------|
| **READY**      | 시작 전             | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RUNNING**    | 자동/수동 실행      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PAUSED**     | 새 노드 활성화 중지 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **TERMINATED** | 미완료처리 표시     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **COMPLETED**  | 읽기전용            | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SOP-5015 승인 SOP 아님<br />
SOP-5016 Binding 미완료<br />
SOP-5017 미완료임무 처리 누락</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-008. 전파대상·메시지·Outbox**

| **항목**            | **상세**                                                                                                     |
|---------------------|--------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Full page                                                                                              |
| **Route**           | /app/incidents/:id/executions/:executionId/propagation                                                       |
| **주요 역할**       | COMMANDER, EXERCISE_CONTROLLER, ORG_ADMIN                                                                    |
| **연계 Scenario**   | US-SIT-018                                                                                                   |
| **화면 목적**       | 활성 임무의 역할규칙을 실제 수신자로 해석하고 메시지·채널·기한을 확정해 Task와 Outbox를 원자적으로 생성한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**       | **상세 기능**                                      | **표시·동작 조건**                   |
|------------|--------------------|----------------------------------------------------|--------------------------------------|
| **REG-01** | 활성노드 목록      | 전파대상 노드, 상태, 자동/수동                     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Recipient Resolver | role rule→기관/부서/개인, 제외/대체                | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 메시지 Preview     | 실제/훈련 표기, 변수치환, 민감정보                 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Outbox Grid        | messageId, taskId, channel, status, idempotencyKey | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이**  | **실패·복구**                                                                 |
|-------------------|-------------------|-------------------------|-------------------------------------------------------------------------------|
| **대상 확정**     | COMMANDER         | resolvedRecipients 저장 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **전파 실행**     | 필수값 PASS       | Task+Outbox transaction | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **채널 변경**     | 송신 전           | 새 channel              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **대체담당 지정** | Binding 누락      | 조직이력                | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**       | **표현**          | **공통 규칙**                                   |
|--------------------|-------------------|-------------------------------------------------|
| **RESOLVING**      | 대상해석          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READY**          | 전파가능          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **OUTBOX_PENDING** | 송신대기          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PARTIAL**        | 일부대상 오류     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **BLOCKED**        | 수신자 0/채널없음 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>PROP-5102 수신자 0명<br />
PROP-5103 메시지 변수누락<br />
PROP-5104 중복 idempotencyKey</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-009. 채널 송신상태·재시도**

| **항목**            | **상세**                                                                                                            |
|---------------------|---------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Full page                                                                                                     |
| **Route**           | /app/incidents/:id/executions/:executionId/messages                                                                 |
| **주요 역할**       | COMMANDER, EXERCISE_CONTROLLER, SYSTEM_ADMIN, AUDITOR                                                               |
| **연계 Scenario**   | US-SIT-019, US-SIT-025, US-SIT-039                                                                                  |
| **화면 목적**       | System/SMS/Email/Broadcast 채널별 송신·전달·실패와 업무 수신확인을 분리 조회하고 재시도·대체채널·재전파를 수행한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                                            | **표시·동작 조건**                   |
|------------|--------------|----------------------------------------------------------|--------------------------------------|
| **REG-01** | 채널 KPI     | PENDING/SENT/DELIVERED/FAILED/ACK                        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Message Grid | 수신자, 채널, attempt, providerCode, sentAt, deliveredAt | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 상세 Trace   | Outbox→Adapter→Provider→Callback                         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 재시도 정책  | max attempt, backoff, alternate channel                  | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**             | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|------------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **재시도**             | retryable FAILED  | attempt 증가           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **대체채널**           | 정책허용          | 새 Message lineage     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수동 전달기록**      | 외부수단 사용     | 근거/actor             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Provider 상태 확인** | 관리자            | 운영화면 연결          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**     | **표현**      | **공통 규칙**                                   |
|------------------|---------------|-------------------------------------------------|
| **PENDING**      | 대기          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SENDING**      | 처리          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SENT**         | Provider 수락 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DELIVERED**    | 전달 확인     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAILED**       | 원인/재시도   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **ACKNOWLEDGED** | 업무수신 별도 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>PROP-5105 채널 timeout<br />
PROP-5106 provider reject<br />
PROP-5107 최대재시도 초과<br />
PROP-5108 callback 서명오류</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-SOP-010. 상황판단·분기 선택**

| **항목**            | **상세**                                                                                                           |
|---------------------|--------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | SOP / Modal / Full page                                                                                            |
| **Route**           | /app/incidents/:id/executions/:executionId/decisions/:nodeId                                                       |
| **주요 역할**       | COMMANDER, EXERCISE_CONTROLLER                                                                                     |
| **연계 Scenario**   | US-SIT-024                                                                                                         |
| **화면 목적**       | Snapshot·Execution Event·사용자 확인값을 근거로 판단식 결과와 후보 분기를 표시하고 자동/수동 선택 근거를 기록한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                       | **표시·동작 조건**                   |
|------------|--------------|-------------------------------------|--------------------------------------|
| **REG-01** | 판단조건     | expression, version, 평가시각       | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 입력값 Grid  | Fact/Event, 값, 시각, source        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 분기 후보    | condition result, 활성가능 여부     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 판단사유     | 자동평가 로그 또는 사용자 rationale | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **재평가**        | 새 입력 존재      | 평가 run               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **분기 선택**     | 수동권한          | DECISION_MADE Event    | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **보류**          | 정책허용          | 대기                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **상위승인 요청** | 중요분기          | 알림                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**      | **표현**               | **공통 규칙**                                   |
|-------------------|------------------------|-------------------------------------------------|
| **WAITING_INPUT** | 필수값 부족            | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **EVALUATED**     | 후보표시               | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DECIDED**       | 경로고정               | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **OVERRIDDEN**    | 자동결과 수동변경 기록 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>SOP-5018 판단입력 누락<br />
SOP-5019 분기조건 중복충족<br />
SOP-5020 수동 override 사유 누락</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-TASK-001. 현장 임무 수신·착수·진행**

| **항목**            | **상세**                                                                                                        |
|---------------------|-----------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 현장 임무 / Mobile first                                                                                        |
| **Route**           | /task/:signedToken                                                                                              |
| **주요 역할**       | TASK_ASSIGNEE                                                                                                   |
| **연계 Scenario**   | US-SIT-020, US-SIT-021                                                                                          |
| **화면 목적**       | 서명된 링크로 임무를 열어 본인·사건·훈련 여부를 확인하고 수신확인, 착수, 진행률, 예상완료, 지원요청을 기록한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**  | **상세 기능**                            | **표시·동작 조건**                   |
|------------|---------------|------------------------------------------|--------------------------------------|
| **REG-01** | Mode 배지     | 실제/훈련을 색+텍스트+아이콘으로 구분    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 임무 카드     | 사건, SOP 단계, 임무내용, 기한, 완료조건 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 상태 Stepper  | SENT→ACK→IN_PROGRESS→COMPLETION          | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 진행보고 Form | 진행률, ETA, 지원필요, 메모              | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**   | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **수신확인** | 유효 토큰/본인    | ACKNOWLEDGED           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **착수**     | ACK               | IN_PROGRESS            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **진행보고** | IN_PROGRESS       | PROGRESS_REPORTED      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **전화연결** | 연락처 권한       | 시스템 Event 보조      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**         | **표현**      | **공통 규칙**                                   |
|----------------------|---------------|-------------------------------------------------|
| **TOKEN_VALIDATING** | 로딩          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SENT**             | 수신확인 CTA  | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **ACKNOWLEDGED**     | 착수 CTA      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **IN_PROGRESS**      | 보고/완료 CTA | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **EXPIRED**          | 지휘자 문의   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REASSIGNED**       | 읽기전용      | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>TASK-5201 토큰 만료<br />
TASK-5202 수신자 불일치<br />
TASK-5203 중복 수신확인</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>360~480px 모바일 우선. 주요버튼 최소 44px, 한 손 조작, 오프라인 임시저장.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 실제/훈련 구분을 색상만으로 표현하지 않는다.<br />
• 네트워크 복구 후 중복 없이 동기화된다.</td>
</tr>
</tbody>
</table>

**SCR-TASK-002. 현장보고·사진·피해/통제 Fact**

| **항목**            | **상세**                                                                                                |
|---------------------|---------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 현장 임무 / Mobile first                                                                                |
| **Route**           | /task/:token/report                                                                                     |
| **주요 역할**       | TASK_ASSIGNEE, SITUATION_REGISTRAR                                                                      |
| **연계 Scenario**   | US-SIT-022, US-SIT-029                                                                                  |
| **화면 목적**       | 관측·피해·통제·지원요청을 시각·위치·첨부와 함께 제출해 Execution Event와 SituationFact 후보를 생성한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                      | **표시·동작 조건**                   |
|------------|--------------|------------------------------------|--------------------------------------|
| **REG-01** | 보고유형     | 현장관측/피해/통제/지원요청/기타   | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 시각·위치    | 관측시각, 현재위치 또는 수동입력   | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 내용 Form    | 요약, 상세, 수치·단위, 확인수준    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 첨부         | 사진/파일, 미리보기, 개인정보 주의 | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**   | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **임시저장** | 오프라인 가능     | 로컬 암호화            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **제출**     | 필수 PASS         | Event+Fact 후보        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **추가보고** | 제출 후           | 새 reportId            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **정정**     | 권한/사유         | Correction Event       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**  | **표현**         | **공통 규칙**                                   |
|---------------|------------------|-------------------------------------------------|
| **EDITING**   | 입력             | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **UPLOADING** | 첨부 진행        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SUBMITTED** | 접수번호         | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **OFFLINE**   | 대기열           | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAILED**    | 내용 유지 재시도 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>TASK-5204 위치권한 거부<br />
FILE-2006 첨부 업로드 실패<br />
TASK-5205 관측시각 미래값</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-TASK-003. 임무 완료·불가·반려·재배정**

| **항목**            | **상세**                                                                       |
|---------------------|--------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 현장 임무 / Mobile first / Commander panel                                     |
| **Route**           | /task/:token/complete                                                          |
| **주요 역할**       | TASK_ASSIGNEE, COMMANDER                                                       |
| **연계 Scenario**   | US-SIT-023                                                                     |
| **화면 목적**       | 담당자는 완료증거 또는 수행불가 사유를 제출하고 지휘자는 수용·반려·재배정한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**       | **상세 기능**                | **표시·동작 조건**                   |
|------------|--------------------|------------------------------|--------------------------------------|
| **REG-01** | 완료조건 Checklist | SOP 정의 조건별 충족/증거    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 결과요약           | 완료시각, 내용, 첨부         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 불가사유           | 안전/자원/접근/지시불명/기타 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 지휘자 검토        | 수용/반려/대체담당/새 기한   | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**    | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|---------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **완료 제출** | IN_PROGRESS       | COMPLETION_SUBMITTED   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수행불가**  | IN_PROGRESS       | UNABLE_REPORTED        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수용**      | COMMANDER         | COMPLETED              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **반려**      | COMMANDER         | IN_PROGRESS            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **재배정**    | COMMANDER         | REASSIGNED             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**    | **표현**          | **공통 규칙**                                   |
|-----------------|-------------------|-------------------------------------------------|
| **IN_PROGRESS** | 담당자 입력       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SUBMITTED**   | 검토대기          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **COMPLETED**   | 읽기전용          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REJECTED**    | 수정 후 재제출    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REASSIGNED**  | 기존담당 읽기전용 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>TASK-5206 완료증거 누락<br />
TASK-5207 완료 후 중복제출<br />
TASK-5208 재배정 대상 없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-BOARD-001. 전자상황판 통합 모니터링**

| **항목**            | **상세**                                                                                                      |
|---------------------|---------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 전자상황판 / Full page / Wall display                                                                         |
| **Route**           | /app/incidents/:id/board                                                                                      |
| **주요 역할**       | COMMANDER, EXERCISE_CONTROLLER, JOURNAL_AUTHOR, AUDITOR                                                       |
| **연계 Scenario**   | US-SIT-021, US-SIT-028                                                                                        |
| **화면 목적**       | Execution Log를 시간·조직·임무·상태로 투영해 현장지휘소가 전체 진행, 지연, 실패와 최신상황을 실시간 파악한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**     | **상세 기능**                                | **표시·동작 조건**                   |
|------------|------------------|----------------------------------------------|--------------------------------------|
| **REG-01** | KPI Bar          | 전체/진행/완료/지연/실패/미수신, lastUpdated | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Timeline         | occurredAt 기준, eventType, actor, source    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Task Grid        | 조직, 임무, 담당, 상태, 기한, 진행률         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Situation Panel  | Snapshot 핵심값, 현장보고, 피해/통제         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-05** | Event Drill-down | sourceEventIds, 원본 payload, 정정 lineage   | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**     | **권한·선행조건**   | **성공 결과/상태전이** | **실패·복구**                                                                 |
|----------------|---------------------|------------------------|-------------------------------------------------------------------------------|
| **필터**       | 시간/조직/상태/실행 | Projection만 변경      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **자동갱신**   | 기본 ON             | SSE/reconnect          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Event 상세** | 권한                | 원본/정정 표시         | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수동기록**   | SITUATION_REGISTRAR | SCR-BOARD-004          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**     | **표현**           | **공통 규칙**                                   |
|------------------|--------------------|-------------------------------------------------|
| **LIVE**         | 실시간             | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RECONNECTING** | 마지막갱신 표시    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **STALE**        | 임계치 배너        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PAUSED_VIEW**  | 사용자 스크롤 보호 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CLOSED**       | 최종 Projection    | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>BOARD-5401 SSE 연결끊김<br />
BOARD-5402 Projection 지연<br />
BOARD-5403 Event 상세 권한없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-BOARD-002. SLA·미수신·Escalation**

| **항목**            | **상세**                                                                                    |
|---------------------|---------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 전자상황판 / Full page                                                                      |
| **Route**           | /app/incidents/:id/board/escalations                                                        |
| **주요 역할**       | COMMANDER, EXERCISE_CONTROLLER                                                              |
| **연계 Scenario**   | US-SIT-025                                                                                  |
| **화면 목적**       | 수신/착수/완료 SLA 초과와 채널실패를 탐지해 재전파·대체담당·상위조직 Escalation을 관리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**   | **상세 기능**                                | **표시·동작 조건**                   |
|------------|----------------|----------------------------------------------|--------------------------------------|
| **REG-01** | Escalation KPI | 미수신, 착수지연, 완료지연, 실패채널         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 위반 Grid      | task, 기준시각, 지연, 담당, 원채널, 권고조치 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 규칙 Preview   | SLA, 대체역할, 상위조직, 채널순서            | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Lineage        | 원본 메시지/재전파/결과                      | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**   | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **재전파**   | 권한              | 새 Message lineage     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **대체담당** | Binding 존재      | Task reassigned        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **상위보고** | 규칙/수동         | Escalation Event       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **예외승인** | 사유/기한         | SLA waiver             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현** | **공통 규칙**                                   |
|----------------|----------|-------------------------------------------------|
| **NORMAL**     | 위반없음 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **BREACHED**   | 조치필요 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **ESCALATING** | 처리중   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **RESOLVED**   | 결과표시 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **WAIVED**     | 예외사유 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>PROP-5109 Escalation 규칙없음<br />
PROP-5110 무한재시도 차단<br />
TASK-5209 SLA 예외사유 누락</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-BOARD-003. 복수 사건·복수 SOP 통합상황판**

| **항목**            | **상세**                                                                                         |
|---------------------|--------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 전자상황판 / Full page / Wall display                                                            |
| **Route**           | /app/boards/multi                                                                                |
| **주요 역할**       | COMMANDER, EXERCISE_CONTROLLER, AUDITOR                                                          |
| **연계 Scenario**   | US-SIT-026                                                                                       |
| **화면 목적**       | 여러 사건·실행을 탭·필터·색상·ID로 격리하면서 통합 KPI와 사건별 상세를 제공해 오조작을 방지한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**          | **상세 기능**                            | **표시·동작 조건**                   |
|------------|-----------------------|------------------------------------------|--------------------------------------|
| **REG-01** | Incident Tabs         | mode, incidentId, 상태, 심각도, 갱신시각 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 통합 KPI              | 사건별/전체                              | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Active Context Banner | 현재 조작대상 사건을 고정 표시           | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Cross-event Timeline  | 조회만 가능, 조작은 사건상세에서         | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **탭 전환**       | READ 권한         | activeIncidentId 변경  | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **새 창 고정**    | 상황실            | 사건별 view            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **통합 필터**     | 기관/재난/상태    | 조회                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **조작화면 이동** | 확인대화          | 사건상세               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**           | **표현**        | **공통 규칙**                                   |
|------------------------|-----------------|-------------------------------------------------|
| **MULTI_LIVE**         | 2개 이상        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SINGLE**             | 일반보드 안내   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONTEXT_SWITCHING**  | 조작 차단       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PERMISSION_PARTIAL** | 권한있는 사건만 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>BOARD-5404 교차사건 조작차단<br />
BOARD-5405 일부사건 권한없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-BOARD-004. 수동 Event 추가·정정**

| **항목**            | **상세**                                                                                                |
|---------------------|---------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 전자상황판 / Modal / Full page                                                                          |
| **Route**           | /app/incidents/:id/events/manual                                                                        |
| **주요 역할**       | SITUATION_REGISTRAR, COMMANDER, JOURNAL_AUTHOR                                                          |
| **연계 Scenario**   | US-SIT-029                                                                                              |
| **화면 목적**       | 전화·구두·외부문서 등 자동수집되지 않은 사실을 Event로 추가하고 오류는 삭제 대신 정정 Event로 보정한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**      | **상세 기능**                                            | **표시·동작 조건**                   |
|------------|-------------------|----------------------------------------------------------|--------------------------------------|
| **REG-01** | Event Form        | eventType, occurredAt, recordedAt, actor/source, payload | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 근거첨부          | 통화메모, 문서, 사진, 외부링크                           | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 정정대상 Selector | 원본 eventId, 현재값, 정정값                             | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 영향 Preview      | Board/Journal Projection 변경 예상                       | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**            | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-----------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **추가**              | 필수 PASS         | MANUAL_EVENT_ADDED     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **정정**              | 원본 존재         | CORRECTION_EVENT       | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **취소**              | 변경 존재         | 확인                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **일지반영 미리보기** | Projection 실행   | Diff                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**           | **표현**  | **공통 규칙**                                   |
|------------------------|-----------|-------------------------------------------------|
| **NEW**                | 신규      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CORRECTING**         | 정정      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SUBMITTED**          | 원본 불변 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PROJECTION_PENDING** | 재투영중  | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>BOARD-5406 occurredAt 누락<br />
BOARD-5407 미래/비정상 시각<br />
BOARD-5408 원본 Event 삭제금지</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-JRN-001. 상황일지 범위·양식 설정**

| **항목**            | **상세**                                                                                               |
|---------------------|--------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황일지 / Wizard                                                                                      |
| **Route**           | /app/incidents/:id/journals/new                                                                        |
| **주요 역할**       | JOURNAL_AUTHOR, COMMANDER                                                                              |
| **연계 Scenario**   | US-SIT-030                                                                                             |
| **화면 목적**       | 시간·조직·임무·사건단계·Event 유형과 HWPX 양식·표현규칙을 지정하고 재현 가능한 Journal Job을 생성한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**        | **상세 기능**                                    | **표시·동작 조건**                   |
|------------|---------------------|--------------------------------------------------|--------------------------------------|
| **REG-01** | 범위 Filter         | timeRange, eventTypes, organizations, executions | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Event Count Preview | 대상건수, 최초/최종시각, 누락경고                | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 양식 Selector       | Template Profile, 호환성, 검증이력               | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 표현규칙            | 개조식/서술식, 시간표기, 집계단위, 출처규칙      | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**    | **권한·선행조건**   | **성공 결과/상태전이** | **실패·복구**                                                                 |
|---------------|---------------------|------------------------|-------------------------------------------------------------------------------|
| **미리보기**  | 필터 유효           | Event sample           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **생성 시작** | Snapshot+Event 존재 | JournalJob CREATED     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **설정 저장** | JOURNAL_AUTHOR      | JournalPreset          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**    | **표현**        | **공통 규칙**                                   |
|-----------------|-----------------|-------------------------------------------------|
| **CONFIGURING** | 입력            | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **COUNTING**    | 대상조회        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READY**       | 생성가능        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **EMPTY_RANGE** | 범위수정        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **QUEUED**      | Projection 이동 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>JRN-6001 대상 Event 0건<br />
JRN-6002 시간범위 오류<br />
JRN-6003 Template 호환성 미확인</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-JRN-002. JournalProjection·FactRows**

| **항목**            | **상세**                                                                                                            |
|---------------------|---------------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황일지 / Full page                                                                                                |
| **Route**           | /app/incidents/:id/journals/:journalId/projection                                                                   |
| **주요 역할**       | JOURNAL_AUTHOR, COMMANDER, AUDITOR                                                                                  |
| **연계 Scenario**   | US-SIT-031, US-SIT-032                                                                                              |
| **화면 목적**       | Execution Event를 시간순 정규화·집계하고 모든 FactRow에 sourceEventIds를 보존해 AI 표현생성 전 사실원장을 검토한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**      | **상세 기능**                                  | **표시·동작 조건**                   |
|------------|-------------------|------------------------------------------------|--------------------------------------|
| **REG-01** | Projection Status | query hash, event count, ruleVersion, progress | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | FactRows Grid     | 시각, 유형, 조직, 임무, 사실값, sourceEventIds | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 중복/집계 상세    | 그룹규칙과 포함 Event                          | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 누락/충돌 경고    | 지연도착, 정정, 미해결 Fact                    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-05** | AI 표현 Preview   | Fact 값 잠금                                   | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**            | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-----------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **Projection 재실행** | 규칙/범위 변경    | 새 version             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **FactRow 제외/포함** | 정책허용          | 사유기록               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **원본 Event 보기**   | 권한              | Drill-down             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **표현 생성**         | 검토완료          | AI Job                 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**     | **표현**      | **공통 규칙**                                   |
|------------------|---------------|-------------------------------------------------|
| **PROJECTING**   | 진행          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REVIEW**       | Fact 검토     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **WARNING**      | 누락/충돌     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FACTS_LOCKED** | 표현생성 기준 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAILED**       | 재실행        | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>JRN-6004 sourceEventIds 누락<br />
JRN-6005 중복집계 규칙 충돌<br />
JRN-6006 지연도착 Event 존재</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-JRN-003. rhwp 상황일지 편집 Workspace**

| **항목**            | **상세**                                                                                           |
|---------------------|----------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황일지 / Full page                                                                               |
| **Route**           | /app/incidents/:id/journals/:journalId/edit                                                        |
| **주요 역할**       | JOURNAL_AUTHOR, PLAN_REVIEWER                                                                      |
| **연계 Scenario**   | US-SIT-032, US-SIT-033                                                                             |
| **화면 목적**       | Projection 사실행을 행정문서 문장·표로 표현하고 rhwp에서 직접편집하되 사실값·시각·출처를 보호한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**      | **상세 기능**                      | **표시·동작 조건**                   |
|------------|-------------------|------------------------------------|--------------------------------------|
| **REG-01** | Fact Source 패널  | FactRows, sourceEventIds, 잠금필드 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | rhwp Editor       | 문단/표/스타일, 직접편집           | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Fact Protection   | 값 변경 탐지, 허용 표현영역        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 자동저장/Revision | dirty, saving, saved, conflict     | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-05** | AI Drawer         | 표현 개선, 요약, 표변환            | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**      | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-----------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **직접편집**    | JOURNAL_AUTHOR    | DocumentCommand        | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **AI 표현편집** | 유효 selection    | Diff                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **사실값 복원** | Validator 탐지    | 원본값 재적용          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **자동저장**    | 변경              | revision 증가          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**       | **표현**      | **공통 규칙**                                   |
|--------------------|---------------|-------------------------------------------------|
| **EDITOR_READY**   | 편집          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FACT_VIOLATION** | 적용차단/복원 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **UNSYNCED**       | 로컬보존      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONFLICT**       | Diff          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READ_ONLY**      | 검토/승인     | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>JRN-6007 사실값 변경감지<br />
JRN-6008 sourceRefs 누락<br />
DOC-3205 자동저장 충돌</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-JRN-004. 상황일지 근거·Diff·검토**

| **항목**            | **상세**                                                                   |
|---------------------|----------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황일지 / Full page / Drawer                                              |
| **Route**           | /app/incidents/:id/journals/:journalId/review                              |
| **주요 역할**       | JOURNAL_AUTHOR, REVIEWER, APPROVER                                         |
| **연계 Scenario**   | US-SIT-033, US-SIT-034                                                     |
| **화면 목적**       | 문장별 근거, AI 변경 Diff, 누락·중복·수치·시각 검증과 검토의견을 처리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**         | **상세 기능**                        | **표시·동작 조건**                   |
|------------|----------------------|--------------------------------------|--------------------------------------|
| **REG-01** | 문장-근거 Map        | block/문장→FactRow/sourceEventIds    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Diff Viewer          | AI/사용자/검토 변경                  | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Validation Checklist | 사실, 누락, 중복, 시간순, 출처, 서식 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Issue Grid           | 대상, 심각도, 담당, 처리상태         | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**         | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **Diff 적용/취소** | revision 일치     | ChangeSet              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **검토요청**       | 필수검증 PASS     | REVIEW                 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수정요청**       | REVIEWER          | CHANGES_REQUESTED      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **승인**           | APPROVER          | APPROVED               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**          | **표현** | **공통 규칙**                                   |
|-----------------------|----------|-------------------------------------------------|
| **DRAFT**             | 편집     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DIFF_READY**        | 선택적용 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REVIEW**            | 잠금     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CHANGES_REQUESTED** | 편집     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **APPROVED**          | 출력가능 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>JRN-6009 근거없는 문장<br />
JRN-6010 시간순 오류<br />
JRN-6011 승인대상 revision 변경</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-JRN-005. 상황일지 HWPX/PDF/DOCX 내보내기**

| **항목**            | **상세**                                                                                               |
|---------------------|--------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황일지 / Full page                                                                                   |
| **Route**           | /app/incidents/:id/journals/:journalId/export                                                          |
| **주요 역할**       | JOURNAL_AUTHOR, APPROVER, DOCUMENT_QA                                                                  |
| **연계 Scenario**   | US-SIT-034                                                                                             |
| **화면 목적**       | 승인 revision을 보존형 HWPX로 저장하고 Track A 검증, 보조 Export, 다운로드와 Artifact hash를 관리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**    | **상세 기능**                              | **표시·동작 조건**                   |
|------------|-----------------|--------------------------------------------|--------------------------------------|
| **REG-01** | 출력설정        | 파일명, formats, 검토표시, 개인정보 마스킹 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Validation 결과 | 패키지/참조/의미/서식/rhwp reopen          | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Artifact Grid   | format, hash, size, 생성/다운로드          | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 경고승인        | LIMITED 사유와 허용자                      | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**      | **권한·선행조건**      | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-----------------|------------------------|------------------------|-------------------------------------------------------------------------------|
| **내보내기**    | APPROVED 또는 권한정책 | Artifact Job           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **다운로드**    | READY                  | 감사                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **재검증**      | Artifact               | ValidationRun          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **최종본 지정** | APPROVER               | FinalArtifact          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**    | **표현**    | **공통 규칙**                                   |
|-----------------|-------------|-------------------------------------------------|
| **SERIALIZING** | 진행        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **VALIDATING**  | 검증        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READY**       | 다운로드    | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **LIMITED**     | 경고        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FAILED**      | 기존본 유지 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>HWPX-7014 Journal 텍스트손실<br />
JRN-6012 승인되지 않은 revision<br />
EXPORT-3302 보조변환 실패</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-JRN-006. 상황일지 버전·최종본·재생성**

| **항목**            | **상세**                                                                                      |
|---------------------|-----------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 상황일지 / Full page                                                                          |
| **Route**           | /app/incidents/:id/journals/:journalId/history                                                |
| **주요 역할**       | JOURNAL_AUTHOR, COMMANDER, AUDITOR                                                            |
| **연계 Scenario**   | US-SIT-034, US-SIT-035                                                                        |
| **화면 목적**       | 생성범위·Projection·문서 revision·승인·Artifact 계보를 연결하고 사건종료 최종일지를 고정한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**     | **상세 기능**                                  | **표시·동작 조건**                   |
|------------|------------------|------------------------------------------------|--------------------------------------|
| **REG-01** | Lineage Timeline | query→projection→AI→document→approval→artifact | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | Version 비교     | 범위/FactRows/문장/서식                        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 최종본 패널      | Final snapshot/event cutoff/artifact hash      | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 재생성 영향      | 새 Event 반영 여부, 지연도착 표시              | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**           | **권한·선행조건**  | **성공 결과/상태전이** | **실패·복구**                                                                 |
|----------------------|--------------------|------------------------|-------------------------------------------------------------------------------|
| **이전본 열기**      | READ               | 읽기전용               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **새 범위로 재생성** | JOURNAL_AUTHOR     | 새 journal/version     | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **최종본 확정**      | COMMANDER/APPROVER | FINAL                  | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **지연도착 반영**    | 정책               | SUPPLEMENT             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**   | **표현** | **공통 규칙**                                   |
|----------------|----------|-------------------------------------------------|
| **WORKING**    | 작성중   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **APPROVED**   | 승인     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **FINAL**      | 종료기준 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SUPERSEDED** | 이력     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SUPPLEMENT** | 추가일지 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>JRN-6013 최종본 후 직접수정 금지<br />
JRN-6014 지연도착 반영정책 없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-EVAL-001. 사건·훈련 종료·최종 기준선**

| **항목**            | **상세**                                                                                    |
|---------------------|---------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 평가 / Full page                                                                            |
| **Route**           | /app/incidents/:id/close                                                                    |
| **주요 역할**       | COMMANDER, EXERCISE_CONTROLLER, APPROVER                                                    |
| **연계 Scenario**   | US-SIT-035, US-SIT-036                                                                      |
| **화면 목적**       | 미완료임무·미해결 Fact·전파상태를 정리하고 종료시각·사유·최종 Snapshot·최종일지를 고정한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**   | **상세 기능**                                              | **표시·동작 조건**                   |
|------------|----------------|------------------------------------------------------------|--------------------------------------|
| **REG-01** | 종료 Checklist | 실행상태, 미완료Task, 미해결Fact, 실패Message, 최종Journal | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 미결항목 Grid  | 처리방식/사유/담당                                         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 최종기준선     | snapshotId, event cutoff, journal/artifact                 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 승인 패널      | 종료승인자, 시각, hash                                     | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**   | **권한·선행조건**  | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------|--------------------|------------------------|-------------------------------------------------------------------------------|
| **종료준비** | COMMANDER          | CLOSING                | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **미결처리** | 각 담당            | disposition            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **종료확정** | APPROVER, 필수완료 | CLOSED                 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **재개**     | 정책/승인          | REOPENED               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**       | **표현**      | **공통 규칙**                                   |
|--------------------|---------------|-------------------------------------------------|
| **RUNNING**        | 종료불가      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CLOSING**        | 정리          | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **READY_TO_CLOSE** | 승인가능      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CLOSED**         | 불변기준      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REOPENED**       | 새 Event 허용 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>EVAL-6101 미완료임무 미처리<br />
EVAL-6102 최종일지 없음<br />
EVAL-6103 종료승인권한 없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-EVAL-002. 훈련평가 지표·체크포인트**

| **항목**            | **상세**                                                                                                   |
|---------------------|------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 평가 / Full page                                                                                           |
| **Route**           | /app/incidents/:id/evaluation/checkpoints                                                                  |
| **주요 역할**       | EXERCISE_CONTROLLER, EVALUATOR, AUDITOR                                                                    |
| **연계 Scenario**   | US-SIT-036, US-SIT-037, US-SIT-038                                                                         |
| **화면 목적**       | 계획된 체크포인트와 실제 Execution Log를 비교해 대응시간, 수신율, 완료율, 분기정확성, 보고품질을 평가한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**        | **상세 기능**                              | **표시·동작 조건**                   |
|------------|---------------------|--------------------------------------------|--------------------------------------|
| **REG-01** | 평가지표 Grid       | 정의, 계산식, 목표, 실제, 판정, 근거 Event | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 체크포인트 Timeline | Inject, 기대행동, 실제행동, 지연           | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 조직별 Score        | 기관/역할별                                | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 관찰기록            | 통제관 메모, 첨부                          | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**   | **권한·선행조건**  | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------|--------------------|------------------------|-------------------------------------------------------------------------------|
| **자동계산** | Execution Log 존재 | 지표 산출              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **수동판정** | 정성지표           | 사유/근거              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **이의제기** | 참여기관           | 검토 workflow          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **평가확정** | EVALUATOR          | scores locked          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**    | **표현** | **공통 규칙**                                   |
|-----------------|----------|-------------------------------------------------|
| **CALCULATING** | 산출     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REVIEW**      | 판정     | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DISPUTED**    | 이의처리 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CONFIRMED**   | 확정     | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>EVAL-6104 지표근거 Event 없음<br />
EVAL-6105 목표값 미설정<br />
EVAL-6106 수동판정 사유누락</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-EVAL-003. 개선조치·SOP/계획서 환류**

| **항목**            | **상세**                                                                                            |
|---------------------|-----------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 평가 / Full page                                                                                    |
| **Route**           | /app/incidents/:id/evaluation/actions                                                               |
| **주요 역할**       | EVALUATOR, COMMANDER, SOP_EDITOR, PLAN_AUTHOR                                                       |
| **연계 Scenario**   | US-SIT-036                                                                                          |
| **화면 목적**       | 평가결론을 개선조치로 전환해 책임자·기한·우선순위를 지정하고 SOP 또는 계획서 변경요청으로 추적한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트**  | **상세 기능**                                    | **표시·동작 조건**                   |
|------------|---------------|--------------------------------------------------|--------------------------------------|
| **REG-01** | 개선조치 Grid | 문제, 근거, 개선안, 책임, 기한, 상태             | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 환류대상      | SOP node/version, Plan document/block, 조직/교육 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 영향분석      | 관련 시나리오·요구사항·시험                      | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 완료증거      | 수정 revision, 재시험결과                        | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**          | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|---------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **조치등록**        | EVALUATOR         | OPEN                   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **SOP 변경요청**    | SOP_EDITOR        | 새 DRAFT               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **계획서 변경요청** | PLAN_AUTHOR       | 새 revision            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **완료확정**        | 검토자            | CLOSED                 | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**    | **표현** | **공통 규칙**                                   |
|-----------------|----------|-------------------------------------------------|
| **OPEN**        | 담당지정 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **IN_PROGRESS** | 개선중   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **VERIFYING**   | 재시험   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CLOSED**      | 증거연결 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **OVERDUE**     | 기한초과 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>EVAL-6107 책임자 미지정<br />
EVAL-6108 환류대상 접근불가<br />
EVAL-6109 완료증거 없음</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-EVAL-004. 만족도·잠재가치·평가보고서**

| **항목**            | **상세**                                                                                               |
|---------------------|--------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 평가 / Full page                                                                                       |
| **Route**           | /app/incidents/:id/evaluation/report                                                                   |
| **주요 역할**       | EVALUATOR, EXERCISE_CONTROLLER, APPROVER                                                               |
| **연계 Scenario**   | US-SIT-036, US-SIT-040                                                                                 |
| **화면 목적**       | 기간 장기테스트가 아닌 활용성·잠재가치·가능성을 중심으로 설문을 수집하고 평가서·요약보고서를 생성한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                            | **표시·동작 조건**                   |
|------------|--------------|------------------------------------------|--------------------------------------|
| **REG-01** | 설문설정     | 대상그룹, 문항, 5점 척도, 익명/기명      | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 응답현황     | 대상/응답/미응답, 기관별                 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 분석         | 문항별 평균, 분포, 자유의견, 역할별 교차 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 평가보고서   | 성과, 문제, 개선, 근거링크, HWPX/PDF     | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**      | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-----------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **설문발송**    | EVALUATOR         | 알림/링크              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **마감**        | 응답기간 종료     | 분석잠금               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **보고서 생성** | 평가확정          | 문서 Job               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **승인**        | APPROVER          | Final report           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**     | **표현**  | **공통 규칙**                                   |
|------------------|-----------|-------------------------------------------------|
| **DRAFT**        | 문항편집  | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **OPEN**         | 응답수집  | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CLOSED**       | 분석      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **REPORT_READY** | 검토/승인 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>EVAL-6110 중복응답<br />
EVAL-6111 최소응답 미달<br />
EVAL-6112 개인정보 동의 누락</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-ADMIN-001. 기관·사용자·RBAC 관리**

| **항목**            | **상세**                                                                                   |
|---------------------|--------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 관리 / Full page                                                                           |
| **Route**           | /app/admin/access                                                                          |
| **주요 역할**       | SYSTEM_ADMIN, INSTITUTION_ADMIN, AUDITOR                                                   |
| **연계 Scenario**   | US-PLAN-001, US-SIT-040                                                                    |
| **화면 목적**       | 기관, 사용자, 역할, 업무객체별 권한과 T3Q SSO Role Mapping을 관리하고 변경이력을 감사한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                        | **표시·동작 조건**                   |
|------------|--------------|--------------------------------------|--------------------------------------|
| **REG-01** | 기관 Tree    | 기관/부서/실증 Binding               | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 사용자 Grid  | 계정, 상태, 기관, 역할, 마지막로그인 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Role Matrix  | 역할별 화면/행위 권한                | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 변경이력     | before/after, actor, reason          | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**          | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|---------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **사용자 매핑**     | 관리자            | RoleBinding            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **권한변경**        | 최소권한/사유     | 즉시 또는 다음로그인   | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **비활성화**        | 활성업무 확인     | 세션회수               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **권한검토 Export** | AUDITOR           | CSV/PDF                | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**      | **표현**      | **공통 규칙**                                   |
|-------------------|---------------|-------------------------------------------------|
| **ACTIVE**        | 사용가능      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PENDING**       | 승인대기      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **SUSPENDED**     | 접근차단      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **ROLE_CONFLICT** | 상충권한 경고 | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>ADMIN-8001 상충역할<br />
ADMIN-8002 마지막 관리자 삭제불가<br />
ADMIN-8003 권한변경 사유누락</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-ADMIN-002. 조직·연락처·채널·수신자 Binding**

| **항목**            | **상세**                                                                                 |
|---------------------|------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 관리 / Full page                                                                         |
| **Route**           | /app/admin/organization                                                                  |
| **주요 역할**       | ORG_ADMIN, SYSTEM_ADMIN, AUDITOR                                                         |
| **연계 Scenario**   | US-SIT-014, US-SIT-018, US-SIT-040                                                       |
| **화면 목적**       | SOP 역할을 실제 조직·개인·연락처·전파채널로 해석하기 위한 Binding과 유효기간을 관리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                             | **표시·동작 조건**                   |
|------------|--------------|-------------------------------------------|--------------------------------------|
| **REG-01** | 조직도       | 기관/부서/직위/역할                       | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 연락처 Grid  | 전화/이메일/시스템ID, 검증상태, 마스킹    | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | Role Binding | SOP role→대상규칙                         | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 채널 설정    | System/SMS/Email/Broadcast, 활성/우선순위 | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-05** | 유효성 검사  | 중복/누락/만료                            | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**         | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|--------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **조직 등록/수정** | ORG_ADMIN         | version 증가           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **연락처 검증**    | 본인/관리자       | VERIFIED               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Binding 테스트** | 가상 context      | resolved list          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **채널 비활성**    | 영향분석          | 실행중 경고            | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**         | **표현**      | **공통 규칙**                                   |
|----------------------|---------------|-------------------------------------------------|
| **VALID**            | 실행가능      | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **INCOMPLETE**       | 대상해석 불가 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **EXPIRED**          | 재검증        | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **CHANNEL_DEGRADED** | 대체채널      | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>ADMIN-8004 연락처 중복<br />
ADMIN-8005 역할 Binding 0명<br />
PROP-5111 채널 자격증명 오류</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-ADMIN-003. 감사·보존·개인정보·보안 설정**

| **항목**            | **상세**                                                                                                     |
|---------------------|--------------------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 관리 / Full page                                                                                             |
| **Route**           | /app/admin/audit-security                                                                                    |
| **주요 역할**       | SYSTEM_ADMIN, AUDITOR, SECURITY_OFFICER                                                                      |
| **연계 Scenario**   | US-SIT-040, US-PLAN-030                                                                                      |
| **화면 목적**       | 감사로그 검색, 개인정보 마스킹, 자료·Event·Artifact 보존기간, 다운로드·전파 감사와 삭제/법적보존을 통제한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                                        | **표시·동작 조건**                   |
|------------|--------------|------------------------------------------------------|--------------------------------------|
| **REG-01** | 감사검색     | actor, action, object, time, correlationId, severity | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | PII 정책     | 마스킹, 최소수집, 로그금지 필드                      | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 보존정책     | 객체별 retention, archive, legal hold                | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | 삭제대기열   | 예정일, 영향, 승인                                   | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-05** | 보안이벤트   | 비정상 접근/다운로드/실패                            | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**        | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **감사 Export**   | AUDITOR           | 서명/기간              | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **Legal hold**    | SECURITY_OFFICER  | 삭제중지               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **보존정책 변경** | 승인              | 향후객체/기존영향      | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **민감값 열람**   | break-glass       | 이유/이중감사          | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**      | **표현**   | **공통 규칙**                                   |
|-------------------|------------|-------------------------------------------------|
| **NORMAL**        | 정상       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **ALERT**         | 보안이벤트 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **LEGAL_HOLD**    | 삭제금지   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **PURGE_PENDING** | 승인대기   | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>ADMIN-8006 감사검색 범위초과<br />
ADMIN-8007 민감정보 열람권한 없음<br />
ADMIN-8008 보존정책 충돌</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

**SCR-ADMIN-004. Provider·UNI·T3Q·실증 Binding 운영설정**

| **항목**            | **상세**                                                                                            |
|---------------------|-----------------------------------------------------------------------------------------------------|
| **모듈 / 표시형식** | 관리 / Full page                                                                                    |
| **Route**           | /app/admin/integrations                                                                             |
| **주요 역할**       | SYSTEM_ADMIN, INTEGRATION_ADMIN, AUDITOR                                                            |
| **연계 Scenario**   | US-PLAN-024, US-SIT-004, US-SIT-039, US-SIT-040                                                     |
| **화면 목적**       | 외부 Provider endpoint·자격증명 상태·Circuit breaker·Rate limit·실증기관 설정·기능 Flag를 관리한다. |

## **A. 레이아웃·핵심 컴포넌트**

| **영역**   | **컴포넌트** | **상세 기능**                                       | **표시·동작 조건**                   |
|------------|--------------|-----------------------------------------------------|--------------------------------------|
| **REG-01** | 연계 Grid    | T3Q RPT, UNI, KMA, MOIS, SafeKorea, Naver, Channels | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-02** | 상태/Health  | lastSuccess, latency, error rate, circuit           | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-03** | 환경설정     | DEV/TEST/PROD, endpoint, credential alias           | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-04** | Feature Flag | Provider/보조수집/실증기관별                        | 상태·권한·검증 결과에 따라 표시/잠금 |
| **REG-05** | Binding      | 자연/사회재난 Scenario Pack→기관                    | 상태·권한·검증 결과에 따라 표시/잠금 |

## **B. Action·상태전이**

| **Action**            | **권한·선행조건** | **성공 결과/상태전이** | **실패·복구**                                                                 |
|-----------------------|-------------------|------------------------|-------------------------------------------------------------------------------|
| **연결시험**          | 관리자            | health log             | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **기능 활성/비활성**  | Gate 증거         | feature flag           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **자격증명 교체**     | 보안절차          | secret alias           | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |
| **실증 Binding 변경** | 승인              | 영향분석               | 실패 시 입력/현재 revision을 보존하고 Inline 오류와 재시도 또는 대체경로 제공 |

## **C. 화면상태·오류·반응형**

| **화면상태**      | **표현**   | **공통 규칙**                                   |
|-------------------|------------|-------------------------------------------------|
| **HEALTHY**       | 정상       | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DEGRADED**      | 부분장애   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **OPEN_CIRCUIT**  | 자동차단   | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **DISABLED**      | 수동비활성 | ContextHeader·StatusChip·Action 활성상태 동기화 |
| **MISCONFIGURED** | 배포차단   | ContextHeader·StatusChip·Action 활성상태 동기화 |

<table>
<colgroup>
<col style="width: 50%" />
<col style="width: 50%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>구분</strong></th>
<th><strong>내용</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>오류코드</strong></td>
<td>INT-8201 endpoint 연결실패<br />
INT-8202 자격증명 만료<br />
INT-8203 Gate 증거 없이 활성화<br />
INT-8204 실증 Binding 불완전</td>
</tr>
<tr class="even">
<td><strong>반응형·접근성</strong></td>
<td>Desktop 1280px 이상 우선. 1024px에서 패널 접기. 모바일은 조회 중심.</td>
</tr>
<tr class="odd">
<td><strong>인수기준</strong></td>
<td>• 권한·상태·오류 조건과 Scenario 정상/대체/예외 흐름이 재현된다.<br />
• 실패 시 사용자 입력과 이미 완료된 결과가 손실되지 않는다.<br />
• 주요 상태변경과 민감 action이 감사이벤트로 추적된다.</td>
</tr>
</tbody>
</table>

# **9. 오류·경고·알림 메시지 카탈로그**

## **9.1 메시지 설계 규칙**

**•** 사용자 메시지는 문제, 영향, 보존된 작업, 즉시 가능한 조치, 추적번호 순서로 구성한다.

**•** 기술 스택 trace나 Provider 응답 원문은 일반 사용자에게 노출하지 않고 오류코드·correlationId로 지원한다.

**•** 치명오류는 Toast만 사용하지 않고 대상영역 Inline Alert와 작업보존/복구 경로를 제공한다.

**•** 동일 action의 중복요청은 idempotencyKey로 차단하고 사용자는 기존 처리상태로 이동한다.

**•** 실제 재난/훈련 전파 실패는 단순 오류가 아니라 전자상황판·Execution Log·Escalation에 지속 표시한다.

| **코드**       | **심각도** | **표시문구**                                                         | **영향**                | **사용자 조치**               |
|----------------|------------|----------------------------------------------------------------------|-------------------------|-------------------------------|
| **AUTH-1001**  | ERROR      | 인증정보가 전달되지 않았습니다.                                      | 업무화면 접근 불가      | T3Q 로그인으로 다시 이동      |
| **AUTH-1002**  | WARNING    | 로그인 세션이 만료되었습니다. 미저장 작업은 임시 보존되었습니다.     | 쓰기 중단               | 재인증 후 returnUrl 복귀      |
| **AUTH-1003**  | ERROR      | 기관 또는 역할 정보가 등록되지 않았습니다.                           | 전체 접근 불가          | 관리자 문의/추적번호          |
| **COM-0001**   | WARNING    | 일부 홈 정보를 불러오지 못했습니다.                                  | 해당 카드만 빈 상태     | 새로고침, 다른 업무 계속      |
| **FILE-2002**  | ERROR      | 파일 크기가 허용한도를 초과했습니다.                                 | 업로드 실패             | 허용크기 안내/다른 파일       |
| **FILE-2004**  | ERROR      | 첨부파일에서 보안위험이 감지되었습니다.                              | 첨부 차단               | 파일 교체/보안문의            |
| **HWPX-7003**  | ERROR      | 안전한 HWPX 패키지로 확인되지 않았습니다.                            | 양식 사용 불가          | 재업로드/검사결과 보기        |
| **HWPX-7004**  | ERROR      | 필수 HWPX 구성요소가 누락되었습니다.                                 | 편집 진입 차단          | 다른 원본 사용                |
| **HWPX-7005**  | ERROR      | HWPX XML을 해석할 수 없습니다.                                       | 분석 실패               | Parser 결과/재업로드          |
| **HWPX-7006**  | ERROR      | 문서 참조 무결성 검증에 실패했습니다.                                | Artifact 다운로드 차단  | 오류 Part 수정/재생성         |
| **HWPX-7007**  | ERROR      | 저장 과정에서 텍스트 손실 가능성이 감지되었습니다.                   | 배포 차단               | 이전 revision 복원/QA         |
| **HWPX-7011**  | ERROR      | 한컴에서 복구 경고가 발생했습니다.                                   | Release Gate 실패       | 시험결과 검토/Serializer 수정 |
| **PLAN-3005**  | ERROR      | 필수 기준정보를 입력하십시오.                                        | 목차 생성 차단          | 오류필드로 이동               |
| **T3Q-3101**   | WARNING    | 계획서 AI 서비스에 연결할 수 없습니다. 편집 내용은 유지됩니다.       | 생성 불가, 편집 가능    | 재시도/상태확인               |
| **T3Q-3102**   | WARNING    | 목차 생성 응답이 지연되고 있습니다.                                  | Job 대기                | 계속대기/취소/재시도          |
| **T3Q-3103**   | WARNING    | 본문 생성 연결이 중단되었습니다. 완료된 문단은 유지됩니다.           | 부분결과                | 실패 Section만 재시도         |
| **DOC-3201**   | WARNING    | 자동저장에 실패했습니다. 현재 변경은 브라우저에 임시 보존되었습니다. | 서버 미동기화           | 재시도/복사/다운로드          |
| **DOC-3202**   | ERROR      | 다른 변경으로 문서 revision이 갱신되었습니다.                        | 적용차단                | Diff/재기준화/복제            |
| **PROV-4101**  | WARNING    | 기상정보 조회에 실패했습니다.                                        | 해당 Provider Fact 없음 | 재시도/수동입력               |
| **PROV-4103**  | ERROR      | 보조 수집 화면구조가 변경되어 자동수집을 중지했습니다.               | SafeKorea/Naver 중지    | 원문링크/Parser 점검          |
| **SIT-4011**   | ERROR      | Snapshot 확정에 필요한 충돌정보가 남아 있습니다.                     | 확정 차단               | 충돌비교 화면                 |
| **SIT-4014**   | WARNING    | 선택한 상황정보가 최신성 기준을 초과했습니다.                        | 확정 가능 여부 정책     | 새로조회/사유확정             |
| **UNI-4201**   | ERROR      | 문서 업로드 또는 학습요청에 실패했습니다.                            | Evidence 사용 불가      | 재시도/삭제                   |
| **UNI-4204**   | WARNING    | 문서 처리가 제한시간을 초과했습니다.                                 | READY 아님              | 상태확인/재학습               |
| **UNI-4206**   | WARNING    | 근거 검색에 실패했습니다.                                            | RAG 결과 없음           | 사용자자료/Fact만 사용        |
| **UNI-4210**   | ERROR      | SOP 생성 스트림 순서가 올바르지 않습니다.                            | 생성결과 승인 불가      | Job 재시도/Raw 추적           |
| **SOP-5005**   | ERROR      | 연결되지 않은 SOP 노드가 있습니다.                                   | 승인 차단               | 노드로 이동                   |
| **SOP-5006**   | ERROR      | 허용되지 않은 순환경로가 있습니다.                                   | 승인 차단               | Edge 수정                     |
| **SOP-5016**   | ERROR      | 실행에 필요한 조직·채널 Binding이 완료되지 않았습니다.               | 실행 차단               | 관리/노드속성 이동            |
| **PROP-5102**  | ERROR      | 전파대상으로 해석된 수신자가 없습니다.                               | 전파 차단               | Binding/대체대상              |
| **PROP-5105**  | WARNING    | 전파채널 응답이 지연되고 있습니다.                                   | 송신상태 미확정         | 재시도/대체채널               |
| **PROP-5107**  | ERROR      | 최대 재시도 횟수를 초과했습니다.                                     | Escalation 필요         | 상위보고/수동전달             |
| **TASK-5201**  | ERROR      | 임무 링크가 만료되었거나 유효하지 않습니다.                          | 임무 접근 불가          | 지휘자 문의                   |
| **TASK-5206**  | ERROR      | 완료조건 또는 증거가 부족합니다.                                     | 완료제출 차단           | 누락항목 표시                 |
| **BOARD-5401** | WARNING    | 실시간 연결이 끊겼습니다. 마지막 갱신시각을 확인하십시오.            | Board stale             | 자동재연결/수동새로고침       |
| **JRN-6004**   | ERROR      | 상황일지 사실행의 원본 Event 연결이 누락되었습니다.                  | AI 표현/승인 차단       | Projection 재실행             |
| **JRN-6007**   | ERROR      | 확정 사실값 변경이 감지되어 적용하지 않았습니다.                     | ChangeSet 차단          | 원문복원/표현만 수정          |
| **EVAL-6101**  | ERROR      | 미완료 임무의 처리방식이 지정되지 않았습니다.                        | 사건종료 차단           | 미결목록 이동                 |
| **ADMIN-8003** | ERROR      | 권한변경 사유를 입력하십시오.                                        | 변경 차단               | 사유입력                      |
| **INT-8202**   | ERROR      | 외부연계 자격증명이 만료되었습니다.                                  | 해당 연계 비활성        | Secret 교체                   |

## **9.2 알림·확인 대화상자**

| **Action**           | **확인문구 핵심**                                | **필수 입력**                | **되돌리기**                   |
|----------------------|--------------------------------------------------|------------------------------|--------------------------------|
| **문서/사건 삭제**   | 삭제대상, 보존기간, 공유/승인 영향               | 삭제사유(승인본/사건은 필수) | 휴지통 기간 내 가능            |
| **Snapshot 확정**    | 선택 Fact 수, 미해결 Warning, 확정 후 불변       | 확정자 확인                  | 새 버전만 가능                 |
| **SOP 실행 시작**    | 실제/훈련, SOP version, Snapshot, 수신자/채널 수 | 실행사유/계획시각            | 중지 Event만 가능              |
| **상황·임무 전파**   | 실제/훈련, 대상, 채널, 메시지 Preview            | 수동전파 사유(필요 시)       | 송신 전 취소, 송신 후 정정전파 |
| **SOP 실행 중지**    | 미완료임무, 후속노드, 전파상태                   | 중지사유, 미완료처리         | 재개 불가 시 새 실행           |
| **계획서/일지 승인** | revision/hash, 미해결 이슈, Artifact             | 승인의견                     | 재개정만 가능                  |
| **사건·훈련 종료**   | 미결 Task/Fact/Message, 최종 Snapshot/Journal    | 종료사유, 미결 disposition   | 승인 후 재개 Event             |

# **10. 반응형·접근성·보안·감사 설계**

## **10.1 Breakpoint와 지원범위**

| **구간**        | **기준**    | **지원원칙**                                                    |
|-----------------|-------------|-----------------------------------------------------------------|
| **대형 상황판** | 1920px 이상 | Board KPI·Timeline·Escalation 동시표시, wall display mode, 16:9 |
| **Desktop**     | 1280~1919px | 전체 편집기·Canvas·3패널 구조 기본                              |
| **Tablet**      | 768~1279px  | 좌/우 패널 Drawer 전환, Canvas/Editor 중심                      |
| **Mobile**      | 360~767px   | TASK 화면 전체지원, Board/문서/관리 화면은 조회·핵심조치 제한   |

## **10.2 보안·개인정보 화면 규칙**

**•** 연락처·토큰·자격증명·원문 민감값은 기본 마스킹하고 권한 있는 상세열람은 사유와 감사이벤트를 남긴다.

**•** 다운로드·원문열기·전파·권한변경·삭제·승인·종료는 감사대상 Action으로 correlationId를 화면에 제공한다.

**•** 실제 재난/훈련 전환은 기존 incident에서 허용하지 않고 새 사건 복제 또는 승인된 변경절차를 사용한다.

**•** 파일 업로드는 확장자/MIME/Signature/크기/악성코드/압축해제 한도를 모두 검증한다.

**•** 브라우저 로컬 임시저장은 민감정보 최소화·암호화·만료정책을 적용하고 로그아웃/완료 시 정리한다.

## **10.3 감사이벤트 화면 연결**

| **업무군**        | **필수 감사이벤트 예시**                                                                      | **화면 표시**              |
|-------------------|-----------------------------------------------------------------------------------------------|----------------------------|
| **인증/RBAC**     | LOGIN_SUCCESS/FAILURE, ROLE_MAPPED, ACCESS_DENIED, PRIVILEGED_ACCESS                          | AUTH/ADMIN Audit Drawer    |
| **계획서**        | CONTEXT_SNAPSHOT_CREATED, OUTLINE_REQUESTED, BLOCK_APPLIED, USER_EDIT, APPROVED, EXPORTED     | PLAN Revision/History      |
| **상황/Snapshot** | FACT_COLLECTED, FACT_DERIVED, CONFLICT_RESOLVED, SNAPSHOT_CONFIRMED                           | SIT Fact/Snapshot Timeline |
| **SOP/실행**      | SOP_GENERATED, NODE_CHANGED, APPROVED, EXECUTION_STARTED/PAUSED/TERMINATED                    | SOP/Board Timeline         |
| **전파/임무**     | MESSAGE_QUEUED/SENT/FAILED, TASK_ACK/START/REPORT/COMPLETE/REASSIGN                           | Message/Task/Board         |
| **상황일지**      | PROJECTION_CREATED, AI_EXPRESSION, FACT_VIOLATION_BLOCKED, JOURNAL_APPROVED, ARTIFACT_CREATED | JRN History                |
| **평가/환류**     | EVALUATION_CONFIRMED, IMPROVEMENT_CREATED/CLOSED, FEEDBACK_REQUESTED                          | EVAL Timeline              |

# **11. 화면/API/DB/Sequence 후속 입력사항**

## **11.1 API 상세설계 입력**

| **화면군**    | **필수 API Port/Operation**                                                               | **공통 요구**                                           |
|---------------|-------------------------------------------------------------------------------------------|---------------------------------------------------------|
| **공통/Auth** | SSO callback, session/me, notifications, permissions                                      | correlationId, error envelope, idempotency              |
| **계획서**    | Document, Template, PlanContext, RPT-001/002 Adapter, Job SSE, ChangeSet, Export, Review  | revision precondition, partial result, cancel/retry     |
| **상황**      | Incident, ProviderRun, Fact, Conflict, Snapshot, SourceDocument, EvidenceSet              | provenance, immutable snapshot, provider status         |
| **SOP/전파**  | SOP Definition, Validate, Approve, Simulation, Execution, Task, Outbox, Message, Decision | version/hash lock, transactional outbox, channel result |
| **Board**     | Execution Event SSE, Projection, Escalation, Manual/Correction Event                      | occurredAt/recordedAt, sourceEventIds                   |
| **상황일지**  | JournalConfig, Projection, AI expression, Document, Review, Export, Final                 | fact lock, lineage, query hash                          |
| **평가/관리** | Close, Metric, Improvement, Survey, RBAC, Organization, Retention, Integration Health     | approval/audit, effective dates                         |

## **11.2 DB 상세설계 입력**

| **도메인**        | **핵심 Entity**                                                                                         | **불변·무결성 조건**                                |
|-------------------|---------------------------------------------------------------------------------------------------------|-----------------------------------------------------|
| **문서**          | document, revision, source_artifact, template_profile, prototype, changeset, generation_job, artifact   | documentId+revision unique, 승인 revision immutable |
| **상황**          | incident, situation_context, fact, fact_conflict, snapshot, provider_run, source_document, evidence_set | 원천 Fact 불변, snapshot hash unique                |
| **SOP**           | sop_definition, sop_version, node, edge, validation, approval, execution                                | 승인 version immutable, 실행이 승인 hash 참조       |
| **전파/임무**     | task, task_event, outbox, message, delivery_attempt, recipient_binding                                  | idempotencyKey unique, event append-only            |
| **Execution Log** | execution_event, correction_link, projection_checkpoint                                                 | 원본 삭제 금지, correction lineage                  |
| **상황일지**      | journal, projection, fact_row, journal_revision, sentence_source, journal_artifact                      | 모든 fact_row/source sentence에 sourceEventIds      |
| **평가/관리**     | evaluation, metric_result, improvement_action, survey, role_binding, retention_policy, audit_event      | 권한/정책 effective time, 감사 append-only          |

## **11.3 Sequence 상세설계 우선순위**

| **Sequence ID**  | **대상 흐름**                               | **핵심 예외**                                         |
|------------------|---------------------------------------------|-------------------------------------------------------|
| **SEQ-PLAN-01**  | SSO→문서목록→Workspace 생성                 | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-PLAN-02**  | HWPX upload→검증→Template 분석→확정         | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-PLAN-03**  | PlanContext Snapshot→RPT-001→목차 Diff/확정 | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-PLAN-04**  | RPT-002 SSE→Block→ChangeSet→rhwp→자동저장   | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-PLAN-05**  | AI 선택편집→Diff→stale revision 처리        | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-PLAN-06**  | Serializer→Track A→Artifact                 | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-SIT-01**   | Provider 조회→Fact 정규화→충돌→Snapshot     | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-SIT-02**   | UNI Upload→상태→Search→EvidenceSet          | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-SOP-01**   | chat/json SSE→Mapper→Canvas→검증/승인       | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-SOP-02**   | Execution 시작→Task/Outbox→Channel→ACK      | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-SOP-03**   | Task 진행/완료→Decision→후속노드            | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-BOARD-01** | Execution Event→Projection→SSE Board        | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-JRN-01**   | Event query→Projection→AI 표현→rhwp         | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-JRN-02**   | Journal 승인→HWPX 검증→Final                | timeout·partial·conflict·권한·idempotency·재시도·감사 |
| **SEQ-EVAL-01**  | 사건종료→평가→개선조치→계획서/SOP 환류      | timeout·partial·conflict·권한·idempotency·재시도·감사 |

# **부록 A. 상태·권한·오류 인수 체크리스트**

| **체크 ID**      | **검증내용**                                                                 | **판정**      | **증거**              |
|------------------|------------------------------------------------------------------------------|---------------|-----------------------|
| **UI-ACC-001**   | 권한 없는 메뉴·Action이 숨김/비활성이고 Backend 403과 일치한다.              | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-STATE-001** | 모든 비동기 화면에 LOADING/PARTIAL/FAILED/RETRY 상태가 있다.                 | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-LOSS-001**  | 외부 장애·세션만료·자동저장 실패 시 사용자 입력이 손실되지 않는다.           | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-MODE-001**  | 실제 재난/훈련이 색상 외 텍스트·아이콘으로 구분된다.                         | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-IMM-001**   | Snapshot, 승인 SOP/문서/일지를 직접수정할 수 없고 새 버전/정정으로 처리한다. | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-AI-001**    | AI 변경은 Diff 승인 전 원문에 적용되지 않는다.                               | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-FACT-001**  | 상황일지 사실값 변경 시 적용이 차단되고 sourceEventIds가 유지된다.           | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-HWPX-001**  | HWPX 검증 실패 시 다운로드/배포를 차단하고 기존 Artifact를 유지한다.         | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-PROP-001**  | 전파실패·미수신·SLA 초과가 Board에서 지속 노출되고 Escalation 가능하다.      | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-A11Y-001**  | 키보드, focus, label, contrast, 오류텍스트 기준을 충족한다.                  | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-AUD-001**   | 승인·전파·종료·권한변경·민감열람·다운로드가 감사이벤트로 추적된다.           | □ PASS □ FAIL | 화면캡처·로그·시험 ID |
| **UI-TRACE-001** | 각 화면이 Scenario, Role, 상태, 오류, 후속 API/DB/Sequence ID와 연결된다.    | □ PASS □ FAIL | 화면캡처·로그·시험 ID |

| **다음** | **후속 단계** 본 화면설계서 v1.0을 기준으로 API/DB/Sequence 상세설계를 작성한다. 화면 ID, 객체 상태, 권한, 오류코드는 후속 설계에서 임의 변경하지 않으며 변경 필요 시 ADR 또는 변경요청으로 추적한다. |
|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
