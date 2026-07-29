**재난관리를 위한 맞춤형 정보생성 및  
의사결정지원 대화형 인공지능 기술개발**

**재난 상황일지·안전한국훈련  
사용자 시나리오 상세설계서**

SituationContext → Evidence/RAG → SOP → 전파·수신·착수·완료 → Execution Log → 상황일지 → 평가·환류

**Version 1.0 \| 2026.07.26  
**작성기관 ㈜유엔이(UNE)  
과제번호 RS-2024-00407304

# 문서 통제

| **구분**    | **내용**                                                                 |
|-------------|--------------------------------------------------------------------------|
| 문서명      | 재난 상황일지·안전한국훈련 사용자 시나리오 상세설계서                    |
| 버전/기준일 | Version 1.0 \| 2026.07.26                                                |
| 작성기관    | ㈜유엔이(UNE)                                                            |
| 적용연차    | 3차년도(2026) 프로토타입 및 4차년도 안전한국훈련 연계 실증 준비          |
| 상위 기준선 | ADR 의사결정기록서 v1.1, 통합플랫폼 상세설계서 v0.9, 개발계획서/WBS v1.0 |
| 연계 명세   | SituationContext·UNI Adapter v1.0, HWPX/rhwp Document Engine v1.0        |
| 대상 산출물 | 상황일지 생성도구, 안전한국훈련 SOP 실행·전자상황판·상황일지·평가/환류   |
| 후속 산출물 | 통합 화면설계서, API/DB/Sequence 상세설계서, E2E/실증 시험서             |

## 제·개정 이력

| **버전** | **일자**   | **개정내용**                                                                                                                            | **작성** |
|----------|------------|-----------------------------------------------------------------------------------------------------------------------------------------|----------|
| 1.0      | 2026.07.26 | ADR-06~14·17·18과 WP-SITUATION/UNI-RAG/WORKFLOW/PROPAGATION/JOURNAL/SCENARIO를 기준으로 상황일지·안전한국훈련 사용자 시나리오 최초 작성 | ㈜유엔이 |

| **문서 유지 원칙 이 문서는 길이를 이유로 정상·대체·예외 흐름, 상태, 권한, 오류, 검증, 추적내용을 임의 삭제하거나 요약하지 않는다. 변경 시 기존 Scenario ID의 의미를 유지하고 추가·폐기·대체 이력을 남긴다.** |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 목차

| **장** | **내용**                                        |
|--------|-------------------------------------------------|
| 1      | 문서 개요 및 통제 원칙                          |
| 2      | 기준선·범위·책임경계                            |
| 3      | Actor·Role·권한 모델                            |
| 4      | 업무 객체·상태·사실원장 모델                    |
| 5      | 전체 사용자 여정·화면 후보                      |
| 6      | SituationContext·Evidence·AI·Workflow 적용 원칙 |
| 7      | 상세 사용자 시나리오                            |
| 8      | 공통 대체·예외·복구 정책                        |
| 9      | 메시지·알림·감사 이벤트 카탈로그                |
| 10     | E2E·인수시험 시나리오                           |
| 11     | 요구사항·ADR·WBS·화면·API·시험 추적             |
| 12     | 후속 화면설계/API·DB·Sequence 입력사항          |
| 부록 A | 자연재난 Reference Scenario Pack                |
| 부록 B | 사회재난 Reference Scenario Pack                |
| 부록 C | 안전한국훈련 SOP 콘텐츠 예시 적용               |
| 부록 D | 용어·상태·ID 규칙                               |

# 1. 문서 개요 및 통제 원칙

## 1.1 목적

• 실제 재난 또는 안전한국훈련을 등록하고, 현재 상황정보를 사용자 확인으로 확정하며, 훈련자료와 위기관리매뉴얼 근거를 이용해 SOP를 구성·승인·실행하고, 전파·수신·착수·완료 이력을 사실원장으로 축적한 뒤 상황일지와 평가자료를 생성하는 전 과정을 구현·시험 가능한 수준으로 정의한다.

• 각 시나리오는 Actor, 선행조건, Trigger, 입력, 정상흐름, 대체흐름, 예외, 상태, 권한, 데이터, 연계, 감사증거, 인수기준과 요구사항·ADR·WBS 추적을 독립적으로 포함한다.

• 상황일지는 LLM의 자유서술을 사실원장으로 사용하지 않고 확정 SituationSnapshot과 Execution Log에서 파생한다. AI는 표현·구조화 보조에 한정하며 사실값을 생성·변경하지 않는다.

• 본 문서는 화면설계와 API/DB/Sequence를 대체하지 않으며, 다음 단계가 누락 없이 파생되도록 화면 후보와 인터페이스·객체·상태 경계를 식별한다.

## 1.2 적용 원칙

| **ID**   | **원칙**         | **상세**                                                                                                                                 |
|----------|------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| P-SIT-01 | 사실과 표현 분리 | SituationFact/Snapshot과 ExecutionEvent가 사실원장이다. JournalEntry의 서술문은 이 사실을 투영한 파생 표현이며 출처 Event ID를 보존한다. |
| P-SIT-02 | 사용자 확정      | 외부 Provider 결과는 후보 Fact이며 자동 확정하지 않는다. 사용자가 선택·수정·제외하고 Snapshot을 확정한다.                                |
| P-SIT-03 | Provider 경계    | 상황일지 POC는 UNI Upload/Search/chat-json/chat을 사용한다. T3Q RPT-003은 선택적 향후 Adapter이며 현재 주 생성기로 사용하지 않는다.      |
| P-SIT-04 | 전파 책임        | T3Q·UNI는 전파 API가 아니다. 전파·수신·착수·완료·재전파는 UNE Workflow/Propagation/Execution Log가 담당한다.                             |
| P-SIT-05 | 증거 우선순위    | 이번 상황/훈련 업로드자료와 확정 Snapshot을 우선하며, 공식 매뉴얼·기관 KB·유사사례를 후순위로 사용한다. 충돌은 자동 해결하지 않는다.     |
| P-SIT-06 | 실행 멱등성      | 전파·Task 상태변경·Journal Projection은 idempotencyKey와 revision으로 중복 실행을 방지한다.                                              |
| P-SIT-07 | 훈련/실제 격리   | TRAINING과 REAL 모드는 사건·수신자·채널·표시·보존정책을 분리한다. 훈련 메시지에는 훈련임을 명시한다.                                     |
| P-SIT-08 | 문서 편집        | 상황일지 HWPX 편집은 rhwp 단일 Surface, ChangeSet/Diff/Undo, 사용자 수정 보호 원칙을 동일 적용한다.                                      |
| P-SIT-09 | 외부장애 지속성  | KMA/MOIS/UNI/채널 장애가 상황등록·수동 SOP·기존 실행·일지 편집을 전면 중단시키지 않는다.                                                 |
| P-SIT-10 | 감사·재현        | 모든 확정·승인·전파·수신·수정·생성·Export는 actor/time/revision/sourceHash/correlationId로 재현 가능해야 한다.                           |

## 1.3 범위와 비범위

| **구분**      | **포함**                                                      | **제외/책임경계**                                        |
|---------------|---------------------------------------------------------------|----------------------------------------------------------|
| 상황등록      | 실제/훈련 Event, 기본정보, 외부 후보 Fact, 충돌해결, Snapshot | NDMS/온톡 직접 연계는 별도 협의, 외부정보 자동확정 금지  |
| AI/RAG        | UNI 업로드·비동기 학습·검색·SOP JSON·일지 표현보조            | LLM/RAG 모델 자체개발, 사용자용 범용 챗봇 UI             |
| SOP           | 생성·편집·승인·시뮬레이션·실행·중지·분기·재전파               | 법적/행정적 최종 의사결정 자동화                         |
| 전파          | System/Simulation, SMS, Email, Broadcast ChannelPort와 Outbox | 채널사업자 내부 시스템 자체개발                          |
| Execution Log | 전파·수신·착수·완료·보고·판단·중지 이벤트                     | 임의 수정·삭제. 정정은 보정 Event로 처리                 |
| 상황일지      | 시간·조직·임무 Projection, 검토·편집·HWPX/PDF/DOCX            | 사실 없는 AI 추정·보간                                   |
| 안전한국훈련  | Scenario Pack, Inject, 훈련메시지, 전자상황판, 평가·개선환류  | 실제 기관/재난 Binding 전까지 기관 고유 명칭·연락처 확정 |
| HWPX          | 상황일지 템플릿 분석·보존형 저장·자동검증·QA Gate             | 사용자 저장마다 한컴 자동실행                            |

# 2. 기준선·범위·책임경계

## 2.1 기준 문서 우선순위

| **우선** | **문서**                          | **본 시나리오 적용**                                                                     |
|----------|-----------------------------------|------------------------------------------------------------------------------------------|
| 1        | ADR 의사결정기록서 v1.1           | ADR-11~14·17·18: Provider, Journal Projection, UNI Mapper, 보조수집, 전파, 기준 시나리오 |
| 2        | 통합플랫폼 상세설계서 v0.9        | 계획-실행-기록-환류 아키텍처, Situation/Workflow/Journal/HWPX 경계                       |
| 3        | 개발계획서 및 상세 WBS v1.0       | WP-SITUATION, WP-UNI-RAG, WP-WORKFLOW, WP-PROPAGATION, WP-JOURNAL, WP-SCENARIO           |
| 4        | SituationContext·UNI Adapter v1.0 | Fact/Snapshot, Provider, UNI Upload/Search/SSE, 오류·보안·E2E                            |
| 5        | 2차년도 요구사항·상세설계         | UFR-SOP-01~21, SOP 생성·실행·진행·전파·조직·이력·내보내기                                |
| 6        | 과제계획서·단계평가·6/19 회의록   | 상황일지, 안전한국훈련 시범, 시나리오 구체화·품질검증 요구                               |

## 2.2 책임 경계

| **주체**                  | **책임**                                                    | **금지/제약**                                           |
|---------------------------|-------------------------------------------------------------|---------------------------------------------------------|
| 사용자/훈련통제관         | 상황입력·Fact 확정·SOP 검토/승인·Inject·실행/중지·일지 검토 | AI 결과 무검토 승인, 원천 Fact 직접변조 금지            |
| 현장 담당자               | 임무수신·확인·착수·현장보고·완료/불가사유                   | 타 임무/기관 정보 임의 조회 금지                        |
| UNE React                 | 상황등록, 후보비교, Canvas, 전자상황판, 일지 편집           | UNI/T3Q 직접 브라우저 호출 금지                         |
| UNE Backend               | RBAC, Snapshot, Workflow, Outbox, Projection, 감사          | 외부 원시필드 도메인 직접 노출 금지                     |
| UNI Adapter               | 업로드·검색·SSE 수신, SopNode/Block 매핑                    | 전파·Task 상태 변경 금지                                |
| External Provider Adapter | KMA/MOIS/SafeKorea/Naver 원천을 SituationFact로 변환        | 후보 자동확정·기존 Snapshot 자동수정 금지               |
| Channel Adapter           | 메시지 송신·상태 수신                                       | Workflow 상태를 임의 변경하지 않고 ChannelResult만 반환 |
| HWPX Engine               | 일지 양식·서식·보존형 저장·검증                             | AI가 HWPX 스타일/ID 직접 생성하도록 허용 금지           |

| **Provider Boundary 계획서 생성은 T3Q RPT-001/002 전용이며, 본 문서의 SOP·상황일지 POC는 UNI와 UNE 내부 엔진을 사용한다. 두 Provider 흐름을 혼합하지 않는다.** |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 3. Actor·Role·권한 모델

| **Actor ID**           | **명칭**        | **책임**                                                                 |
|------------------------|-----------------|--------------------------------------------------------------------------|
| ACT-SIT-AUTHOR         | 상황등록자      | 사건/훈련 기본정보, 후보 Fact 검토, Snapshot 확정요청, 현장보고 입력     |
| ACT-TRAIN-CONTROLLER   | 훈련통제관      | Scenario Pack/Inject 관리, SOP 승인·실행·중지, 전자상황판 통제, 평가개시 |
| ACT-INCIDENT-COMMANDER | 상황총괄/지휘자 | 실제사건 SOP 승인, 분기판단, 재전파, 종료승인                            |
| ACT-SOP-EDITOR         | SOP 편집자      | AI 초안 검토·수정, 조직/담당/채널 매핑, 완료조건 설정                    |
| ACT-TASK-ASSIGNEE      | 현장 임무담당자 | 수신확인·착수·진행보고·완료/불가/지원요청                                |
| ACT-ORG-MANAGER        | 조직관리자      | 조직·부서·역할·연락처·대체담당 관리                                      |
| ACT-JOURNAL-EDITOR     | 상황일지 작성자 | Projection 범위 선택, 문장 검토·직접/AI 편집, HWPX 저장                  |
| ACT-REVIEWER           | 검토자          | Snapshot/SOP/일지/근거/이력 검토, 보완요청                               |
| ACT-APPROVER           | 승인자          | SOP·상황일지 최종 revision/hash 승인                                     |
| ACT-SYSTEM-ADMIN       | 시스템 관리자   | Feature Flag, Provider/Channel, 보존, 권한 설정                          |
| ACT-AUDITOR            | 감사자          | 읽기전용 감사로그·원천·전파증거 조회                                     |
| ACT-DOC-QA             | 문서 호환성 QA  | HWPX 자동검증·한컴 Round-trip 배포 승인                                  |

## 3.2 권한 Matrix

| **기능**              | **등록자** | **통제관/지휘자** | **SOP 편집자** | **담당자** | **일지작성자** | **승인자** | **관리/감사** |
|-----------------------|------------|-------------------|----------------|------------|----------------|------------|---------------|
| 상황 등록/수정        | A/R        | A/R               | R              | R          | R              | R          | C/R           |
| Snapshot 확정         | 요청       | A/R               | R              | \-         | R              | A          | 감사 R        |
| 자료 업로드/검색      | A/R        | A/R               | A/R            | \-         | R              | R          | Admin C       |
| SOP 생성/편집         | R          | A                 | A/R            | R          | R              | A          | 감사 R        |
| SOP 실행/중지         | \-         | A/R               | 보조           | 수신       | R              | A          | 감사 R        |
| Task 착수/완료        | \-         | 감독              | \-             | A/R        | R              | R          | 감사 R        |
| 전자상황판            | R          | A/R               | R              | 자기임무   | R              | R          | 감사 R        |
| 상황일지 생성/편집    | R          | A                 | R              | R          | A/R            | A          | 감사 R        |
| 최종 확정/재개정      | \-         | 요청              | \-             | \-         | 요청           | A/R        | 감사 R        |
| Provider/Channel 설정 | \-         | \-                | \-             | \-         | \-             | \-         | Admin A/R     |

# 4. 업무 객체·상태·사실원장 모델

| **객체**           | **역할**                | **핵심 속성/불변규칙**                                                                      |
|--------------------|-------------------------|---------------------------------------------------------------------------------------------|
| Incident           | 실제/훈련 사건          | incidentId, mode, disasterType, status, institutionBinding, startedAt/endedAt               |
| SituationContext   | 편집 가능한 상황 작업본 | contextId, revision, facts, conflicts, providerStatus                                       |
| SituationFact      | 원천 또는 파생 사실     | factId, category, value, observed/issued/retrievedAt, provenance, freshness, originalFactId |
| SituationSnapshot  | 확정 상황 기준선        | snapshotId, contextRevision, selectedFactIds, confirmer, hash; 확정 후 불변                 |
| SourceDocument     | 업로드 자료             | docId, scope, sourceHash, UNI 상태, retentionPolicy                                         |
| EvidenceSet/Chunk  | SOP·일지 근거           | evidenceSetId, priority, doc/chunk/source refs, frozenAt                                    |
| SopDefinition      | SOP 버전                | sopId, version, graph, node/task/decision, sourceRefs, approvalStatus                       |
| SopExecution       | 실행 인스턴스           | executionId, incidentId, sopVersion, status, currentNodes                                   |
| TaskAssignment     | 임무 할당               | taskId, assignee/role, dueAt, channel, completionCriteria, status                           |
| PropagationMessage | 전파 명령               | messageId, channel, recipient, template, idempotencyKey, status                             |
| ExecutionEvent     | 사실원장 Event          | eventId, type, occurredAt, actor, payloadHash, correlationId; append-only                   |
| JournalProjection  | 상황일지 투영           | projectionId, timeRange, filter, sourceEventIds, revision                                   |
| JournalEntry       | 시간순 일지 항목        | entryId, factText, narrativeText, sourceEventIds, approvalState                             |
| EvaluationRecord   | 훈련평가·개선           | metric, observation, issue, improvementAction, linkedEvents                                 |

## 4.2 상태 모델

| **대상**         | **상태 흐름**                                                                                  | **통제**                                              |
|------------------|------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| Incident         | DRAFT → REGISTERED → CONTEXT_CONFIRMED → SOP_READY → RUNNING/PAUSED → CLOSING → CLOSED         | CLOSED 후 정정은 CorrectionEvent와 새 보고 revision   |
| SituationContext | DRAFT → PROVIDER_QUERYING → CANDIDATE_REVIEW → CONFLICT_OPEN → USER_CONFIRMED                  | Snapshot 확정 후 Context 수정 시 revision+새 Snapshot |
| UNI Document     | UPLOADING → QUEUED → PARSING → INDEXING → REFERENCE_GENERATING → READY/ERROR                   | READY 전 Evidence 사용 금지                           |
| SOP Definition   | DRAFT → VALIDATING → REVIEW → APPROVED → SUPERSEDED/RETIRED                                    | 실행은 승인된 특정 version 고정                       |
| SOP Execution    | READY → RUNNING → PAUSED → COMPLETED/TERMINATED/FAILED                                         | 중지는 사유·승인·미완료임무 정리                      |
| Task             | PENDING → SENT → RECEIVED → ACKNOWLEDGED → IN_PROGRESS → COMPLETED/FAILED/CANCELLED/REASSIGNED | 각 전이는 ExecutionEvent 생성                         |
| Propagation      | PENDING → OUTBOXED → SENDING → SENT → DELIVERED/FAILED/UNKNOWN → RETRY/ESCALATED               | 채널 결과와 업무 수신확인을 구분                      |
| Journal          | NONE → PROJECTING → DRAFT → REVIEW → APPROVED → FINALIZED → REVISED                            | Finalized 수정은 새 revision                          |
| Evaluation       | NOT_STARTED → COLLECTING → REVIEW → APPROVED → ACTION_TRACKING → CLOSED                        | 개선조치 책임/기한 추적                               |

| **사실원장 원칙 ExecutionEvent는 append-only이며 삭제·수정하지 않는다. 잘못된 이벤트는 원본 eventId를 참조하는 CORRECTION/VOID 이벤트로 보정한다.** |
|-----------------------------------------------------------------------------------------------------------------------------------------------------|

# 5. 전체 사용자 여정·화면 후보

| **ID**   | **여정**       | **핵심 흐름**                                         | **화면 후보**                 |
|----------|----------------|-------------------------------------------------------|-------------------------------|
| J-SIT-01 | 접속/사건등록  | SSO → 사건/훈련 신규등록 → 기본정보                   | SCR-SIT-001~003               |
| J-SIT-02 | 현재상황 확정  | Provider 조회 → 후보/충돌 검토 → Snapshot             | SCR-SIT-004~007               |
| J-SIT-03 | 자료·근거 준비 | 훈련자료 업로드 → READY → 검색/EvidenceSet            | SCR-SIT-008~010               |
| J-SIT-04 | SOP 생성/승인  | UNI SSE → Mapper/검증 → Canvas 편집 → 승인            | SCR-SOP-001~005               |
| J-SIT-05 | 실행/전파      | 실행 → Outbox/채널 → 수신/착수/완료/분기              | SCR-SOP-006~010, SCR-TASK-001 |
| J-SIT-06 | 전자상황판     | 시간순 Event, 조직/임무/채널/경보 상태                | SCR-BOARD-001~003             |
| J-SIT-07 | 상황일지       | 범위선택 → Projection → 표현편집 → 검토/승인 → Export | SCR-JRN-001~006               |
| J-SIT-08 | 훈련종료/평가  | 종료 → 지표·체크포인트 → 개선조치 → 계획/SOP 환류     | SCR-EVAL-001~004              |

| **업무 흐름 사건/훈련 등록 → SituationSnapshot 확정 → 근거 준비 → SOP 생성·승인 → 전파·수행 → Execution Log → 상황일지 → 평가·환류** |
|--------------------------------------------------------------------------------------------------------------------------------------|

# 6. SituationContext·Evidence·AI·Workflow 적용 원칙

## 6.1 상황정보 입력·확정 규칙

| **규칙**          | **적용 내용**                                                                            |
|-------------------|------------------------------------------------------------------------------------------|
| 기본정보          | mode, 재난유형, 지역/시설, 발생·기준시각, 최초상황, 기관, 훈련명/사건명은 사용자 입력    |
| Provider 우선순위 | KMA Forecast/Warning, MOIS Message P0; SafeKorea P1; Naver는 사용자 요청형 Feature Flag  |
| 원천 보존         | sourceUrl/sourceId/sourceHash/parserVersion, observedAt/issuedAt/retrievedAt을 분리 저장 |
| 중복/충돌         | 동일 의미키는 그룹화하되 Provider별 원천 유지. 값/시각/수준 불일치는 OPEN conflict       |
| 수정              | 원천 Fact는 불변. 사용자가 수정하면 derived Fact를 만들고 originalFactId 연결            |
| 확정              | 선택 Fact, 확정자, contextRevision, hash로 불변 Snapshot 생성                            |
| 장애              | 외부조회 실패가 등록을 막지 않으며 사용자 입력만으로 확정 가능                           |

## 6.2 Evidence·SOP 생성 규칙

| **우선** | **Evidence**                     | **통제**                                            |
|----------|----------------------------------|-----------------------------------------------------|
| 1        | 이번 상황/훈련 사용자 업로드자료 | THIS_INCIDENT/PROJECT scope, sourceHash, READY 상태 |
| 2        | 확정 SituationSnapshot           | AI가 값·시각·출처 변경 금지                         |
| 3        | 기관 최신 대응절차/훈련계획      | 승인된 기관 KB                                      |
| 4        | 공식 위기관리매뉴얼              | 버전·발행기관·페이지/절 식별                        |
| 5        | 기존 계획서/SOP·유사재난         | 보조 근거, 최신성 표시                              |
| 6        | 일반 학습 DB                     | 근거 부족 시 후순위; 자동확정 금지                  |

## 6.3 AI 허용·금지 경계

| **허용**                                         | **UNE 적용**                                                     | **금지**                          |
|--------------------------------------------------|------------------------------------------------------------------|-----------------------------------|
| SopNode/Task/Decision 후보, 문장요약, sourceRefs | UniSopMapper, Graph Validator, JournalProjection, ChangeSet/Diff | Fact 값·시각·출처 추정/변조       |
| 일지 문장 재작성·간결화·표변환                   | sourceEventIds 고정, 사용자 승인                                 | ExecutionEvent 생성·삭제·상태변경 |
| 선택영역 편집                                    | revision/selection 검증 후 Diff                                  | 사용자 수정영역 자동덮어쓰기      |
| 근거추가                                         | EvidenceChunk 연결                                               | 근거 ID 임의 생성                 |

| **SOP Contract SOP 생성 Prompt에는 시작/종료, 행동노드의 담당역할·완료조건·전파대상/채널·기한, 판단노드의 명시적 조건, 모든 노드의 sourceRefs를 강제한다.** |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 7. 상세 사용자 시나리오

## US-SIT-001. SSO 기반 접속과 상황대응 Workspace 수립

| **항목**  | **상세 내용**                                                                                                               |
|-----------|-----------------------------------------------------------------------------------------------------------------------------|
| 목적      | T3Q 메인 플랫폼에서 인증된 사용자가 별도 로그인 없이 UNE 상황일지·훈련 Workspace에 진입하고 기관·역할·모드 권한을 수립한다. |
| 주 행위자 | 상황등록자, 훈련통제관, 지휘자, 일지작성자, 관리자                                                                          |
| 선행조건  | T3Q 로그인 완료, UNE 진입 토큰 규칙 활성화                                                                                  |
| Trigger   | 메인 플랫폼에서 상황일지/안전한국훈련 메뉴 선택                                                                             |
| 입력      | 진입토큰, returnUrl, 선택 업무모드                                                                                          |
| 완료조건  | 권한범위 밖 사건 0건 노출, 토큰 원문 로그 0건                                                                               |
| 화면 후보 | SCR-AUTH-001, SCR-SIT-001                                                                                                   |

| **\#** | **주체**    | **사용자/시스템 행위**                     | **처리·검증 규칙**                      | **결과·상태**    |
|--------|-------------|--------------------------------------------|-----------------------------------------|------------------|
| 1      | 사용자      | 메뉴를 선택한다.                           | 현재 세션·진입토큰·returnUrl 전달       | 진입요청         |
| 2      | UNE Gateway | 서명·발급자·대상·만료·nonce를 검증한다.    | 토큰 원문 로그 금지, correlationId 부여 | TOKEN_VALIDATING |
| 3      | UNE Backend | 사용자·기관·역할을 RBAC에 매핑한다.        | 훈련/실제 권한과 기관 Binding 확인      | SESSION_CREATING |
| 4      | 시스템      | 최근 사건·훈련·미완료 임무를 조회한다.     | 사용자 권한 범위만 조회                 | SESSION_ACTIVE   |
| 5      | 사용자      | 대시보드 또는 returnUrl 화면으로 이동한다. | 감사 이벤트 기록                        | WORKSPACE_READY  |

| **ID** | **조건**           | **처리**                                    | **종료/복귀** |
|--------|--------------------|---------------------------------------------|---------------|
| A-01   | 유효 UNE 세션 존재 | 사용자 동일성 재검증 후 재사용              | 대시보드      |
| A-02   | 직접 URL 접근      | 메인 플랫폼 로그인 경로 안내·returnUrl 보존 | SSO 재진입    |

| **ID** | **오류 조건**       | **사용자 메시지·복구**                                              | **로그·상태** |
|--------|---------------------|---------------------------------------------------------------------|---------------|
| E-01   | 토큰 만료/서명 오류 | “로그인 정보가 만료되었습니다. 메인 플랫폼에서 다시 접속해 주세요.” | AUTH_FAILED   |
| E-02   | 기관/역할 매핑 누락 | “사용 권한을 확인할 수 없습니다.” 관리자 문의                       | ACCESS_DENIED |
| E-03   | 세션 저장소 장애    | 재시도 안내, 신규 실행 금지                                         | SESSION_ERROR |

| **구분**      | **적용 내용**                                               |
|---------------|-------------------------------------------------------------|
| 권한          | 모든 인증 사용자; 실행/승인은 별도 역할 필요                |
| 상태전이      | ANONYMOUS → TOKEN_VALIDATING → SESSION_ACTIVE/ACCESS_DENIED |
| 주요 데이터   | UserSession, InstitutionBinding, RoleBinding                |
| 연계/API 후보 | POST /auth/sso/callback 후보                                |
| 감사 이벤트   | AUTH_LOGIN_SUCCESS/FAIL, SESSION_CREATED                    |
| 인수기준      | 권한범위 밖 사건 0건 노출, 토큰 원문 로그 0건               |
| 추적          | ADR-07·17·18, WP-PLATFORM-BASE/WP-UI                        |

## US-SIT-002. 사건·훈련 목록 조회와 신규 Workspace 생성

| **항목**  | **상세 내용**                                                                            |
|-----------|------------------------------------------------------------------------------------------|
| 목적      | 사용자가 실제 재난 또는 안전한국훈련을 신규 등록하거나 진행 중 사건을 안전하게 재개한다. |
| 주 행위자 | 상황등록자, 훈련통제관, 지휘자                                                           |
| 선행조건  | 활성 세션, 기관 권한 존재                                                                |
| Trigger   | \[신규 사건/훈련\] 또는 목록 항목 선택                                                   |
| 입력      | mode, 기관, 검색조건, 신규/복제 방식                                                     |
| 완료조건  | 중복 생성 0건, 모드별 채널정책 표시                                                      |
| 화면 후보 | SCR-SIT-001~002                                                                          |

| **\#** | **주체** | **사용자/시스템 행위**                                   | **처리·검증 규칙**             | **결과·상태**   |
|--------|----------|----------------------------------------------------------|--------------------------------|-----------------|
| 1      | 시스템   | 기관 범위 사건·훈련 목록을 조회한다.                     | 상태·재난유형·기간·담당자 필터 | LIST_READY      |
| 2      | 사용자   | 신규등록 또는 기존항목을 선택한다.                       | CLOSED는 읽기/재개정만 허용    | SELECTION       |
| 3      | 사용자   | REAL/TRAINING 모드를 선택한다.                           | 훈련은 실제 채널 기본 비활성   | MODE_SELECTED   |
| 4      | 시스템   | Incident DRAFT와 SituationContext revision 1을 생성한다. | ID·기관·생성자 기록            | DRAFT_CREATED   |
| 5      | 시스템   | Workspace와 단계 네비게이션을 연다.                      | 자동저장 활성화                | WORKSPACE_READY |

| **ID** | **조건**            | **처리**                                                   | **종료/복귀** |
|--------|---------------------|------------------------------------------------------------|---------------|
| A-01   | 기존 훈련 복제      | SOP/Scenario Pack 참조만 복제하고 실행이력·개인정보는 제외 | 새 DRAFT      |
| A-02   | 중단 Workspace 재개 | 마지막 revision과 미완료 단계 복원                         | 해당 단계     |

| **ID** | **오류 조건**       | **사용자 메시지·복구**           | **로그·상태**        |
|--------|---------------------|----------------------------------|----------------------|
| E-01   | 중복 신규요청       | idempotencyKey로 기존 DRAFT 반환 | DUPLICATE_SUPPRESSED |
| E-02   | 권한 없는 기관 선택 | 기관 선택 차단                   | ACCESS_DENIED        |

| **구분**      | **적용 내용**                                   |
|---------------|-------------------------------------------------|
| 권한          | INCIDENT_AUTHOR 이상; CLOSED 재개정은 승인권자  |
| 상태전이      | NONE → DRAFT/OPENED                             |
| 주요 데이터   | Incident, SituationContext, WorkspacePreference |
| 연계/API 후보 | GET/POST /incidents 후보                        |
| 감사 이벤트   | INCIDENT_DRAFT_CREATED/OPENED                   |
| 인수기준      | 중복 생성 0건, 모드별 채널정책 표시             |
| 추적          | ADR-18, WP-SCENARIO/WP-UI                       |

## US-SIT-003. 사건·훈련 기본정보 입력과 등록

| **항목**  | **상세 내용**                                                                                      |
|-----------|----------------------------------------------------------------------------------------------------|
| 목적      | 사건명·재난유형·지역·발생시각·최초상황과 훈련 메타데이터를 입력해 상황정보 수집의 기준을 설정한다. |
| 주 행위자 | 상황등록자, 훈련통제관                                                                             |
| 선행조건  | Incident DRAFT                                                                                     |
| Trigger   | 기본정보 저장 선택                                                                                 |
| 입력      | 사건/훈련명, mode, disasterType, location/adminCode, occurredAt/asOf, 최초상황, 훈련 목표·참여기관 |
| 완료조건  | 필수값 누락 0건, TRAINING 표식 적용                                                                |
| 화면 후보 | SCR-SIT-003                                                                                        |

| **\#** | **주체** | **사용자/시스템 행위**                                   | **처리·검증 규칙**                     | **결과·상태**     |
|--------|----------|----------------------------------------------------------|----------------------------------------|-------------------|
| 1      | 사용자   | 기본정보를 입력한다.                                     | 필수값·코드·시각 논리 검증             | EDITING           |
| 2      | 시스템   | 훈련 모드이면 훈련명·일정·통제관·메시지 표식을 요구한다. | 실제 채널 기본 OFF                     | MODE_RULE_APPLIED |
| 3      | 사용자   | 최초상황을 사실/추정/미확인으로 구분한다.                | 추정값은 USER_ASSERTED 후보로 표시     | INITIAL_FACTS     |
| 4      | 시스템   | SituationContext revision을 증가시켜 저장한다.           | 자동저장·감사                          | REGISTERED        |
| 5      | 사용자   | 외부조회 또는 직접 확정 단계로 이동한다.                 | 지역·시각을 Provider 조회조건으로 사용 | CONTEXT_READY     |

| **ID** | **조건**      | **처리**                                         | **종료/복귀**           |
|--------|---------------|--------------------------------------------------|-------------------------|
| A-01   | 발생시각 미정 | 기준시각만 입력하고 미정 배지·후속확인 Task 생성 | REGISTERED_WITH_WARNING |
| A-02   | 복수 지역     | 주 지역+영향지역 목록으로 저장                   | 다지역 Context          |

| **ID** | **오류 조건**            | **사용자 메시지·복구**            | **로그·상태**    |
|--------|--------------------------|-----------------------------------|------------------|
| E-01   | 종료시각이 발생시각 이전 | 필드 오류 표시·저장 차단          | VALIDATION_ERROR |
| E-02   | 지역코드 불일치          | 검색 후보 제시 또는 수동주소 허용 | LOCATION_WARNING |

| **구분**      | **적용 내용**                                  |
|---------------|------------------------------------------------|
| 권한          | 등록자 편집, 지휘자/통제관 확정                |
| 상태전이      | DRAFT → REGISTERED                             |
| 주요 데이터   | Incident, SituationContext, USER_ASSERTED Fact |
| 연계/API 후보 | POST /incidents/{id}/context 후보              |
| 감사 이벤트   | INCIDENT_REGISTERED, CONTEXT_REVISION_SAVED    |
| 인수기준      | 필수값 누락 0건, TRAINING 표식 적용            |
| 추적          | WP-SITUATION, UFR-SOP-03/04                    |

## US-SIT-004. 현재 상황정보 Provider 조회 요청

| **항목**  | **상세 내용**                                                                                                 |
|-----------|---------------------------------------------------------------------------------------------------------------|
| 목적      | KMA·MOIS 등 공식 Provider와 허용된 보조 Provider에서 현재 상황 후보를 조회하되 사용자가 요청 범위를 통제한다. |
| 주 행위자 | 상황등록자, 통제관                                                                                            |
| 선행조건  | 기본정보 저장                                                                                                 |
| Trigger   | \[현재 상황정보 불러오기\] 선택                                                                               |
| 입력      | Provider 선택, 지역, 시각범위, 재난유형, Feature Flag                                                         |
| 완료조건  | 외부장애에도 등록 가능, 출처·조회시각 100% 표시                                                               |
| 화면 후보 | SCR-SIT-004                                                                                                   |

| **\#** | **주체**    | **사용자/시스템 행위**                              | **처리·검증 규칙**                  | **결과·상태**     |
|--------|-------------|-----------------------------------------------------|-------------------------------------|-------------------|
| 1      | 사용자      | Provider와 조회범위를 확인한다.                     | P0 기본선택, Naver는 명시적 요청    | QUERY_CONFIGURED  |
| 2      | UNE Backend | Provider별 비동기 조회를 시작한다.                  | Timeout·Rate Limit·Cache            | PROVIDER_QUERYING |
| 3      | Adapter     | 원천응답을 검증하고 provenance를 부착한다.          | sourceHash/parserVersion 기록       | RAW_VALIDATED     |
| 4      | Normalizer  | SituationFact 후보로 변환한다.                      | category/value/time/location 표준화 | CANDIDATES_READY  |
| 5      | 시스템      | Provider별 성공/실패·조회시각·freshness를 표시한다. | 부분성공 허용                       | CANDIDATE_REVIEW  |

| **ID** | **조건**           | **처리**                                | **종료/복귀**    |
|--------|--------------------|-----------------------------------------|------------------|
| A-01   | 사용자 입력만 사용 | Provider 조회 건너뛰기                  | 후보검토         |
| A-02   | Cache 유효         | 원문 hash·조회시각을 표시하고 캐시 사용 | CANDIDATES_READY |

| **ID** | **오류 조건**      | **사용자 메시지·복구**                       | **로그·상태**     |
|--------|--------------------|----------------------------------------------|-------------------|
| E-01   | KMA/MOIS Timeout   | 해당 Provider UNAVAILABLE, 재시도/사용자입력 | PARTIAL_SUCCESS   |
| E-02   | SafeKorea DOM 변경 | Parser 실패·외부 링크 제공                   | PARSER_CHANGED    |
| E-03   | Naver 비활성       | Feature Flag 안내                            | PROVIDER_DISABLED |

| **구분**      | **적용 내용**                                                     |
|---------------|-------------------------------------------------------------------|
| 권한          | 등록자/통제관 조회; Admin만 Provider 설정                         |
| 상태전이      | REGISTERED → PROVIDER_QUERYING → CANDIDATE_REVIEW                 |
| 주요 데이터   | ProviderStatus, RawArtifact, SituationFact                        |
| 연계/API 후보 | Canonical SituationProviderPort; KMA/MOIS/SafeKorea/Naver Adapter |
| 감사 이벤트   | PROVIDER_QUERY_STARTED/COMPLETED/FAILED                           |
| 인수기준      | 외부장애에도 등록 가능, 출처·조회시각 100% 표시                   |
| 추적          | ADR-11·14, WP-SITUATION                                           |

## US-SIT-005. Provider 부분장애·최신성·신뢰도 검토

| **항목**  | **상세 내용**                                                                                         |
|-----------|-------------------------------------------------------------------------------------------------------|
| 목적      | Provider별 가용성·최신성·신뢰도를 사용자에게 투명하게 표시하고 부분장애가 전체 흐름을 막지 않게 한다. |
| 주 행위자 | 상황등록자, 통제관, 관리자                                                                            |
| 선행조건  | Provider 조회 완료/부분완료                                                                           |
| Trigger   | 후보검토 화면 진입                                                                                    |
| 입력      | ProviderStatus, TTL 정책, 후보 Fact                                                                   |
| 완료조건  | 후보마다 출처·시각·상태 누락 0건                                                                      |
| 화면 후보 | SCR-SIT-004~005                                                                                       |

| **\#** | **주체** | **사용자/시스템 행위**                           | **처리·검증 규칙**               | **결과·상태**       |
|--------|----------|--------------------------------------------------|----------------------------------|---------------------|
| 1      | 시스템   | Provider별 상태·마지막 성공·응답시간을 표시한다. | SUCCESS/PARTIAL/UNAVAILABLE      | STATUS_VISIBLE      |
| 2      | 시스템   | Fact 범주별 CURRENT/AGING/STALE을 계산한다.      | observed/issued/retrievedAt 분리 | FRESHNESS_TAGGED    |
| 3      | 시스템   | 공식/보조/사용자 출처와 신뢰도 정책을 표시한다.  | 점수 자동확정에 사용 금지        | RELIABILITY_VISIBLE |
| 4      | 사용자   | 재조회·제외·수동입력을 선택한다.                 | 기존 후보 보존                   | REVIEW_UPDATED      |
| 5      | 시스템   | 선택결과와 실패원인을 감사로그에 남긴다.         | 원천응답 민감정보 마스킹         | REVIEW_READY        |

| **ID** | **조건**                | **처리**                       | **종료/복귀** |
|--------|-------------------------|--------------------------------|---------------|
| A-01   | STALE 후보 사용         | 경고 확인을 요구하고 선택 가능 | 선택대기      |
| A-02   | 공식 API 실패·보조 성공 | 보조출처 배지와 원문 링크 표시 | 후보검토      |

| **ID** | **오류 조건**      | **사용자 메시지·복구**      | **로그·상태**   |
|--------|--------------------|-----------------------------|-----------------|
| E-01   | 모든 Provider 실패 | 사용자 입력만으로 계속 가능 | UNAVAILABLE_ALL |
| E-02   | 시각 파싱 실패     | 후보 격리·원문 보기 제공    | NORMALIZE_ERROR |

| **구분**      | **적용 내용**                                        |
|---------------|------------------------------------------------------|
| 권한          | 일반 조회 가능; 정책변경 Admin                       |
| 상태전이      | PROVIDER_QUERYING → PARTIAL_SUCCESS/CANDIDATE_REVIEW |
| 주요 데이터   | ProviderStatus, FreshnessPolicy, ReliabilityPolicy   |
| 연계/API 후보 | GET /providers/status 후보                           |
| 감사 이벤트   | PROVIDER_PARTIAL, FACT_STALE_ACCEPTED                |
| 인수기준      | 후보마다 출처·시각·상태 누락 0건                     |
| 추적          | ADR-14, SIT-E2E-02~04                                |

## US-SIT-006. SituationFact 정규화·중복제거·후보 그룹화

| **항목**  | **상세 내용**                                                                                                        |
|-----------|----------------------------------------------------------------------------------------------------------------------|
| 목적      | 서로 다른 Provider·사용자 입력을 canonical Fact로 변환하고 동일 사건 후보를 그룹화하되 원천별 provenance를 보존한다. |
| 주 행위자 | 시스템, 상황등록자                                                                                                   |
| 선행조건  | 원천응답 또는 사용자 입력 존재                                                                                       |
| Trigger   | Normalizer 처리                                                                                                      |
| 입력      | rawItem, provider mapping, category TTL, event key                                                                   |
| 완료조건  | 원천 provenance 손실 0건, 자동삭제 0건                                                                               |
| 화면 후보 | SCR-SIT-005                                                                                                          |

| **\#** | **주체**   | **사용자/시스템 행위**                                 | **처리·검증 규칙**                 | **결과·상태**     |
|--------|------------|--------------------------------------------------------|------------------------------------|-------------------|
| 1      | Normalizer | 필드·단위·시각·지역을 canonical 형식으로 변환한다.     | 변환버전 기록                      | NORMALIZED        |
| 2      | 시스템     | category+location+timeWindow+eventKey로 그룹화한다.    | 동일 provider/sourceId는 후보 갱신 | GROUPED           |
| 3      | 시스템     | 다른 Provider의 동일내용은 duplicate group으로 묶는다. | 원천 Fact 각각 유지                | DEDUP_VIEW        |
| 4      | 시스템     | 값/시각/수준 불일치를 conflict 후보로 분류한다.        | 자동 덮어쓰기 금지                 | CONFLICT_DETECTED |
| 5      | 사용자     | 그룹을 펼쳐 원문·차이를 검토한다.                      | 선택/제외 전 상태 UNREVIEWED       | REVIEWABLE        |

| **ID** | **조건**       | **처리**                    | **종료/복귀** |
|--------|----------------|-----------------------------|---------------|
| A-01   | 단위 변환 불가 | 원문값 유지+NEEDS_REVIEW    | 후보검토      |
| A-02   | 지역 미확정    | incident 기본지역 상속 제안 | 사용자 확인   |

| **ID** | **오류 조건**            | **사용자 메시지·복구**        | **로그·상태** |
|--------|--------------------------|-------------------------------|---------------|
| E-01   | 필수 category/value 누락 | 후보 격리·Provider 오류기록   | FACT_INVALID  |
| E-02   | 중복키 충돌              | 새 Fact ID 발급·충돌그룹 생성 | CONFLICT_OPEN |

| **구분**      | **적용 내용**                            |
|---------------|------------------------------------------|
| 권한          | 시스템 자동, 사용자 읽기/선택            |
| 상태전이      | RAW → NORMALIZED → GROUPED/CONFLICT_OPEN |
| 주요 데이터   | SituationFact, DuplicateGroup, Conflict  |
| 연계/API 후보 | Internal FactNormalizer/Deduplicator     |
| 감사 이벤트   | FACT_NORMALIZED/GROUPED/CONFLICT_CREATED |
| 인수기준      | 원천 provenance 손실 0건, 자동삭제 0건   |
| 추적          | ADR-11, WP-SITUATION                     |

## US-SIT-007. 충돌 Fact 비교·수정·선택·제외

| **항목**  | **상세 내용**                                                                                                    |
|-----------|------------------------------------------------------------------------------------------------------------------|
| 목적      | 동일 의미키의 상충 값과 사용자 입력을 비교해 사용자가 명시적으로 기준 사실을 선택하거나 수정 파생 Fact를 만든다. |
| 주 행위자 | 상황등록자, 통제관/지휘자                                                                                        |
| 선행조건  | Conflict OPEN 또는 미검토 후보 존재                                                                              |
| Trigger   | 충돌해결 화면 진입                                                                                               |
| 입력      | 원천 Fact, 원문, 시각, 출처, 사용자 수정값/사유                                                                  |
| 완료조건  | 모든 선택에 actor/time/source 추적, 원천 불변                                                                    |
| 화면 후보 | SCR-SIT-006                                                                                                      |

| **\#** | **주체** | **사용자/시스템 행위**             | **처리·검증 규칙**                   | **결과·상태**     |
|--------|----------|------------------------------------|--------------------------------------|-------------------|
| 1      | 시스템   | 충돌 후보를 나란히 표시한다.       | 값·시각·Provider·freshness 차이 강조 | CONFLICT_REVIEW   |
| 2      | 사용자   | 선택/제외/수정 중 하나를 지정한다. | 결정사유 필수 정책 가능              | DECISION_INPUT    |
| 3      | 시스템   | 수정 시 derived Fact를 생성한다.   | originalFactId·actor·reason 기록     | DERIVED_CREATED   |
| 4      | 시스템   | Conflict resolution을 저장한다.    | 원천 Fact 불변                       | CONFLICT_RESOLVED |
| 5      | 사용자   | 확정대상 요약으로 이동한다.        | 미해결 필수충돌이 있으면 경고        | READY_TO_CONFIRM  |

| **ID** | **조건**            | **처리**                        | **종료/복귀**  |
|--------|---------------------|---------------------------------|----------------|
| A-01   | 복수 Fact 병존 필요 | 서로 다른 시각/범위로 모두 선택 | RESOLVED_MULTI |
| A-02   | 확정 보류           | OPEN 유지하고 다른 단계 저장    | DRAFT          |

| **ID** | **오류 조건**           | **사용자 메시지·복구**   | **로그·상태**       |
|--------|-------------------------|--------------------------|---------------------|
| E-01   | 원천 Fact 직접수정 시도 | 파생 Fact 생성 안내      | IMMUTABLE_VIOLATION |
| E-02   | 다른 사용자가 선결정    | revision conflict·재조회 | REVISION_CONFLICT   |

| **구분**      | **적용 내용**                                  |
|---------------|------------------------------------------------|
| 권한          | 등록자 편집; 통제관/지휘자 승인정책 가능       |
| 상태전이      | CONFLICT_OPEN → RESOLVED/OPEN                  |
| 주요 데이터   | SituationFact, DerivedFact, ConflictResolution |
| 연계/API 후보 | PATCH /contexts/{id}/conflicts/{cid} 후보      |
| 감사 이벤트   | FACT_SELECTED/EXCLUDED/CORRECTED               |
| 인수기준      | 모든 선택에 actor/time/source 추적, 원천 불변  |
| 추적          | ADR-08·11, SIT-E2E-05                          |

## US-SIT-008. 불변 SituationSnapshot 확정·버전 갱신

| **항목**  | **상세 내용**                                                                              |
|-----------|--------------------------------------------------------------------------------------------|
| 목적      | 검토·충돌해결이 끝난 Fact 집합을 해시와 함께 확정해 SOP·상황일지의 기준 상황으로 고정한다. |
| 주 행위자 | 통제관/지휘자, 승인자                                                                      |
| 선행조건  | 필수 Fact 검토, 미해결 필수충돌 없음 또는 승인된 예외                                      |
| Trigger   | \[상황 확정\] 선택                                                                         |
| 입력      | selectedFactIds, contextRevision, confirmer, confirmation note                             |
| 완료조건  | 확정 후 변경 0건, 재확정은 새 snapshotId                                                   |
| 화면 후보 | SCR-SIT-007                                                                                |

| **\#** | **주체** | **사용자/시스템 행위**                                            | **처리·검증 규칙**                     | **결과·상태**      |
|--------|----------|-------------------------------------------------------------------|----------------------------------------|--------------------|
| 1      | 시스템   | 확정 대상과 누락·STALE·보조출처 경고를 요약한다.                  | 확정 전 최종검증                       | CONFIRM_PREVIEW    |
| 2      | 사용자   | 경고를 확인하고 확정한다.                                         | MFA/재인증 정책 가능                   | CONFIRM_REQUESTED  |
| 3      | 시스템   | 선택 Fact의 canonical JSON hash를 계산한다.                       | 정렬·직렬화 규칙 고정                  | HASHED             |
| 4      | 시스템   | SituationSnapshot을 불변 저장한다.                                | snapshotId, contextRevision, confirmer | SNAPSHOT_CONFIRMED |
| 5      | 시스템   | Incident 기준 snapshotId를 갱신하고 SOP 생성 가능상태로 전환한다. | 기존 Snapshot 보존                     | CONTEXT_CONFIRMED  |

| **ID** | **조건**             | **처리**                                                     | **종료/복귀**    |
|--------|----------------------|--------------------------------------------------------------|------------------|
| A-01   | 외부정보 없이 확정   | 사용자 입력 Fact만 포함하고 경고기록                         | CONFIRMED_MANUAL |
| A-02   | 확정 후 새 정보 도착 | 새 Context revision과 후보 생성, 기존 Snapshot 자동변경 금지 | NEW_CANDIDATE    |

| **ID** | **오류 조건**   | **사용자 메시지·복구**   | **로그·상태**     |
|--------|-----------------|--------------------------|-------------------|
| E-01   | revision 불일치 | 최신 Context 재검토 요구 | REVISION_CONFLICT |
| E-02   | hash 저장 실패  | 확정 롤백·재시도         | SNAPSHOT_ERROR    |

| **구분**      | **적용 내용**                                    |
|---------------|--------------------------------------------------|
| 권한          | 통제관/지휘자 A, 승인자 정책 선택                |
| 상태전이      | USER_CONFIRMED → SNAPSHOT_CONFIRMED; 변경은 vN+1 |
| 주요 데이터   | SituationSnapshot, SnapshotHash, Confirmation    |
| 연계/API 후보 | POST /contexts/{id}/snapshots 후보               |
| 감사 이벤트   | SNAPSHOT_CONFIRMED/SUPERSEDED                    |
| 인수기준      | 확정 후 변경 0건, 재확정은 새 snapshotId         |
| 추적          | ADR-08, WP-SITUATION                             |

## US-SIT-009. 안전한국훈련·위기관리 자료 업로드와 보존범위 설정

| **항목**  | **상세 내용**                                                                                                    |
|-----------|------------------------------------------------------------------------------------------------------------------|
| 목적      | 훈련계획서·메시지 목록·기관 임무카드·평가지침·매뉴얼을 UNI에 등록하고 사건/프로젝트/기관 KB 보존범위를 통제한다. |
| 주 행위자 | 훈련통제관, SOP 편집자, 조직관리자                                                                               |
| 선행조건  | Incident 등록, UNI Gateway 정상                                                                                  |
| Trigger   | \[자료 업로드\] 선택                                                                                             |
| 입력      | 파일, 분류, scope, 보안등급, force, 개인정보 확인                                                                |
| 완료조건  | doc_id·sourceHash·scope 추적, 무단 장기보존 0건                                                                  |
| 화면 후보 | SCR-SIT-008                                                                                                      |

| **\#** | **주체**    | **사용자/시스템 행위**                     | **처리·검증 규칙**                     | **결과·상태** |
|--------|-------------|--------------------------------------------|----------------------------------------|---------------|
| 1      | 사용자      | 파일과 분류·보존범위를 선택한다.           | THIS_INCIDENT 기본, 허용형식/크기 검사 | UPLOAD_READY  |
| 2      | UNE Gateway | 악성코드·MIME·hash·중복을 검사한다.        | 원본명/해시 기록                       | VALIDATED     |
| 3      | UNE Adapter | JWT를 첨부해 /documents/upload를 호출한다. | React 직접호출 금지                    | UPLOADING     |
| 4      | UNI         | doc_id와 처리상태를 반환한다.              | QUEUED/PARSING/INDEXING                | QUEUED        |
| 5      | 시스템      | SourceDocument와 incident를 연결한다.      | 기관 KB 자동승격 금지                  | REGISTERED    |

| **ID** | **조건**         | **처리**                               | **종료/복귀**    |
|--------|------------------|----------------------------------------|------------------|
| A-01   | 중복 hash        | 기존 doc 재사용 또는 force 업로드 선택 | LINKED/NEW       |
| A-02   | 기관 KB 승격요청 | 검토·분류·개인정보 승인 Workflow 생성  | PENDING_APPROVAL |

| **ID** | **오류 조건**     | **사용자 메시지·복구**           | **로그·상태**   |
|--------|-------------------|----------------------------------|-----------------|
| E-01   | 악성코드/금지형식 | 업로드 거부·감사                 | UPLOAD_REJECTED |
| E-02   | UNI 업로드 실패   | 재시도/파일 제외, 기존 흐름 유지 | UPLOAD_ERROR    |

| **구분**      | **적용 내용**                                     |
|---------------|---------------------------------------------------|
| 권한          | 훈련통제관/SOP 편집자 업로드; KB 승격 관리자 승인 |
| 상태전이      | LOCAL_VALIDATED → UPLOADING → QUEUED/ERROR        |
| 주요 데이터   | SourceDocument, ArtifactHash, RetentionScope      |
| 연계/API 후보 | POST UNI /documents/upload via Gateway            |
| 감사 이벤트   | DOCUMENT_UPLOAD_REQUESTED/QUEUED/REJECTED         |
| 인수기준      | doc_id·sourceHash·scope 추적, 무단 장기보존 0건   |
| 추적          | ADR-13, WP-UNI-RAG                                |

## US-SIT-010. UNI 비동기 학습상태 조회·READY 판정·삭제/승격

| **항목**  | **상세 내용**                                                                      |
|-----------|------------------------------------------------------------------------------------|
| 목적      | 업로드 문서의 파싱·색인·참조생성 상태를 추적하고 READY 자료만 SOP 근거로 사용한다. |
| 주 행위자 | 시스템, 훈련통제관/SOP 편집자                                                      |
| 선행조건  | SourceDocument QUEUED                                                              |
| Trigger   | 상태 폴링 또는 화면 열기                                                           |
| 입력      | doc_id, reference status, timeout policy                                           |
| 완료조건  | READY 아닌 자료가 Evidence에 포함된 건 0                                           |
| 화면 후보 | SCR-SIT-009                                                                        |

| **\#** | **주체** | **사용자/시스템 행위**                                   | **처리·검증 규칙**            | **결과·상태**     |
|--------|----------|----------------------------------------------------------|-------------------------------|-------------------|
| 1      | Gateway  | 내부 상태조회/문서목록을 폴링한다.                       | 2/4/8/15초, 최대 5분          | POLLING           |
| 2      | 시스템   | QUEUED/PARSING/INDEXING/REFERENCE_GENERATING을 표시한다. | 사용자 취소 가능              | PROCESSING        |
| 3      | Gateway  | /documents/{id}/reference를 조회한다.                    | 200 READY/202 PROCESSING 구분 | REFERENCE_CHECK   |
| 4      | 시스템   | READY이면 Evidence 사용 가능으로 전환한다.               | reference metadata 저장       | READY             |
| 5      | 사용자   | 오류파일 재시도·제외·삭제·승격을 선택한다.               | 보존정책 적용                 | LIFECYCLE_UPDATED |

| **ID** | **조건**      | **처리**                                 | **종료/복귀**           |
|--------|---------------|------------------------------------------|-------------------------|
| A-01   | 참조요약 지연 | Search 가능 여부를 별도 판정하고 경고    | READY_WITHOUT_REFERENCE |
| A-02   | 사용자 취소   | 사건 연결 해제, 정책에 따라 UNI 삭제요청 | CANCELLED               |

| **ID** | **오류 조건** | **사용자 메시지·복구**               | **로그·상태**      |
|--------|---------------|--------------------------------------|--------------------|
| E-01   | 처리시간 초과 | 상태 UNKNOWN, 수동 새로고침/재업로드 | PROCESSING_TIMEOUT |
| E-02   | UNI ERROR     | 오류사유 표시, SOP에서 제외          | DOCUMENT_ERROR     |

| **구분**      | **적용 내용**                                      |
|---------------|----------------------------------------------------|
| 권한          | 업로드자/통제관; 삭제·승격은 정책권한              |
| 상태전이      | QUEUED → ... → READY/ERROR/CANCELLED               |
| 주요 데이터   | SourceDocument, UniProcessingStatus, ReferenceInfo |
| 연계/API 후보 | GET UNI /documents/, /documents/{id}/reference     |
| 감사 이벤트   | DOCUMENT_READY/ERROR/DELETED/PROMOTED              |
| 인수기준      | READY 아닌 자료가 Evidence에 포함된 건 0           |
| 추적          | WP-UNI-RAG, SIT-E2E-06                             |

## US-SIT-011. RAG 검색·Evidence 후보 검토·EvidenceSet 동결

| **항목**  | **상세 내용**                                                                                                      |
|-----------|--------------------------------------------------------------------------------------------------------------------|
| 목적      | 확정 Snapshot과 업로드자료를 기준으로 SOP 생성에 사용할 근거 청크를 검색·선택하고 생성시점 EvidenceSet을 동결한다. |
| 주 행위자 | SOP 편집자, 통제관                                                                                                 |
| 선행조건  | SituationSnapshot 확정, 0개 이상 READY 문서                                                                        |
| Trigger   | \[근거 검색\] 또는 SOP 생성 준비                                                                                   |
| 입력      | 검색어, disasterType, situation summary, goal, top_k, source filters                                               |
| 완료조건  | 모든 선택 Chunk의 원문·doc_id·score 추적                                                                           |
| 화면 후보 | SCR-SIT-010                                                                                                        |

| **\#** | **주체** | **사용자/시스템 행위**                                 | **처리·검증 규칙**         | **결과·상태**   |
|--------|----------|--------------------------------------------------------|----------------------------|-----------------|
| 1      | 시스템   | Snapshot·목표·자료목록으로 검색 query를 구성한다.      | PII 최소화·프롬프트 기록   | QUERY_READY     |
| 2      | Gateway  | UNI /search/를 호출한다.                               | 기본 top_k=8, Timeout 30초 | SEARCHING       |
| 3      | Adapter  | filename/score/text/doc_id를 EvidenceChunk로 변환한다. | sourceHash·chunkId 연결    | RESULTS_READY   |
| 4      | 사용자   | 근거를 선택·제외·우선순위 조정한다.                    | 공식 충돌 배지 표시        | EVIDENCE_REVIEW |
| 5      | 시스템   | Snapshot+선택 Chunk로 EvidenceSet을 동결한다.          | frozenAt·hash              | EVIDENCE_FROZEN |

| **ID** | **조건**                      | **처리**                                   | **종료/복귀**     |
|--------|-------------------------------|--------------------------------------------|-------------------|
| A-01   | 검색결과 없음                 | 업로드자료 직접 context 또는 수동 SOP 허용 | NO_RESULTS        |
| A-02   | 공식 매뉴얼과 업로드자료 충돌 | Conflict UI에서 사용자 결정                | EVIDENCE_CONFLICT |

| **ID** | **오류 조건**    | **사용자 메시지·복구**          | **로그·상태**    |
|--------|------------------|---------------------------------|------------------|
| E-01   | Search timeout   | 1회 재시도 후 직접 Context/수동 | SEARCH_ERROR     |
| E-02   | doc_id 연결 불가 | 결과 격리·사용금지              | EVIDENCE_INVALID |

| **구분**      | **적용 내용**                             |
|---------------|-------------------------------------------|
| 권한          | SOP 편집자 선택, 통제관 승인              |
| 상태전이      | NONE → SEARCHING → REVIEW → FROZEN        |
| 주요 데이터   | EvidenceSet, EvidenceChunk, SearchRequest |
| 연계/API 후보 | POST UNI /search/ via Gateway             |
| 감사 이벤트   | EVIDENCE_SEARCHED/SELECTED/FROZEN         |
| 인수기준      | 모든 선택 Chunk의 원문·doc_id·score 추적  |
| 추적          | ADR-13, WP-UNI-RAG                        |

## US-SIT-012. UNI /chat/json 기반 SOP JSON SSE 생성

| **항목**  | **상세 내용**                                                                                         |
|-----------|-------------------------------------------------------------------------------------------------------|
| 목적      | Snapshot과 EvidenceSet을 사용해 구조화된 SOP 노드를 스트리밍 생성하고 진행상태를 사용자에게 제공한다. |
| 주 행위자 | SOP 편집자, 통제관, 시스템                                                                            |
| 선행조건  | Snapshot/EvidenceSet 확정, UNI chat-json 사용 가능                                                    |
| Trigger   | \[SOP 초안 생성\] 선택                                                                                |
| 입력      | SOPGenerationContext, generationOptions, Schema version, idempotencyKey                               |
| 완료조건  | SSE 상태순서·Schema 검증, 사실변조 0건                                                                |
| 화면 후보 | SCR-SOP-001~002                                                                                       |

| **\#** | **주체**     | **사용자/시스템 행위**                                       | **처리·검증 규칙**           | **결과·상태**       |
|--------|--------------|--------------------------------------------------------------|------------------------------|---------------------|
| 1      | Orchestrator | 생성 요청·Prompt·Contract version을 저장한다.                | 상황 Fact 변경금지 제약 포함 | JOB_CREATED         |
| 2      | Gateway      | UNI /chat/json SSE 연결을 시작한다.                          | ACL·서비스토큰·요청서명      | JOB_SEARCHING       |
| 3      | Adapter      | status/searching·reranking·generating을 Job 상태로 변환한다. | thinking 사용자 미표시       | JOB_GENERATING      |
| 4      | Adapter      | \_\_compn\_\_을 UniRawCompn으로 수신한다.                    | 부분 JSON/SSE parse·격리     | COMPONENT_STREAMING |
| 5      | UI           | 임시 SOP Canvas에 노드를 표시한다.                           | DRAFT 표시, 실행 금지        | DRAFT_VISIBLE       |
| 6      | Adapter      | sources/done/\[DONE\]을 수신한다.                            | 노드수·소스·종료 검증        | STREAM_DONE         |

| **ID** | **조건**          | **처리**                                  | **종료/복귀**    |
|--------|-------------------|-------------------------------------------|------------------|
| A-01   | 사용자 취소       | SSE 종료·부분결과 폐기 또는 임시저장 선택 | CANCELLED        |
| A-02   | 부분노드 표시 OFF | 완료 후 일괄표시                          | STREAMING_HIDDEN |

| **ID** | **오류 조건**          | **사용자 메시지·복구**     | **로그·상태**          |
|--------|------------------------|----------------------------|------------------------|
| E-01   | 첫 이벤트/전체 Timeout | 연결종료·재시도·수동편집   | JOB_TIMEOUT            |
| E-02   | \_\_error\_\_ 수신     | 부분결과 격리, 오류/재생성 | JOB_FAILED             |
| E-03   | 상황 Fact 변조 탐지    | 전체 결과 폐기             | FACT_MUTATION_REJECTED |

| **구분**      | **적용 내용**                                              |
|---------------|------------------------------------------------------------|
| 권한          | SOP 편집자 생성, 통제관 조회                               |
| 상태전이      | CREATED → SEARCHING → RERANKING → GENERATING → DONE/FAILED |
| 주요 데이터   | SOPGenerationJob, UniRawCompn, SourceRefs                  |
| 연계/API 후보 | POST UNI /chat/json SSE via Gateway                        |
| 감사 이벤트   | SOP_GENERATION_STARTED/COMPONENT/DONE/FAILED               |
| 인수기준      | SSE 상태순서·Schema 검증, 사실변조 0건                     |
| 추적          | ADR-12·13, WP-UNI-RAG                                      |

## US-SIT-013. UniSopMapper 변환·DAG/필수필드 최종검증

| **항목**  | **상세 내용**                                                                                     |
|-----------|---------------------------------------------------------------------------------------------------|
| 목적      | UNI compns를 UNE SopNode/Task/Decision Schema로 변환하고 시작·종료·분기·고립노드·근거를 검증한다. |
| 주 행위자 | 시스템, SOP 편집자                                                                                |
| 선행조건  | SSE compn 수신                                                                                    |
| Trigger   | compn 이벤트 또는 done                                                                            |
| 입력      | UniRawCompn, mapperVersion, SopSchemaVersion                                                      |
| 완료조건  | 승인 SOP의 고립/순환 0건, sourceRefs 연결                                                         |
| 화면 후보 | SCR-SOP-002~003                                                                                   |

| **\#** | **주체**              | **사용자/시스템 행위**                                   | **처리·검증 규칙**              | **결과·상태**     |
|--------|-----------------------|----------------------------------------------------------|---------------------------------|-------------------|
| 1      | Mapper                | type/name/sequence/tasks/decision/sourceRefs를 매핑한다. | 버전별 Anti-Corruption Layer    | MAPPED            |
| 2      | Incremental Validator | 노드 필수필드·ID·참조를 부분검증한다.                    | 오류노드 격리                   | PARTIAL_VALIDATED |
| 3      | Graph Validator       | done 후 시작/종료·연결·순환·분기·고립을 검사한다.        | 실행가능성 판단                 | GRAPH_VALIDATING  |
| 4      | 시스템                | 근거 없음·수신자 미매핑은 Warning으로 표시한다.          | 승인 Gate 정책                  | REVIEW_REQUIRED   |
| 5      | 시스템                | 유효하면 DRAFT SopDefinition version을 저장한다.         | 원시 compn과 변환결과 hash 보존 | SOP_DRAFT         |

| **ID** | **조건**      | **처리**                           | **종료/복귀**    |
|--------|---------------|------------------------------------|------------------|
| A-01   | 필수필드 누락 | Repair 요청 1회 후 사용자 수동수정 | REPAIR/REVIEW    |
| A-02   | 수신자 미매핑 | 조직관리에서 역할/담당 지정        | MAPPING_REQUIRED |

| **ID** | **오류 조건**           | **사용자 메시지·복구**     | **로그·상태**      |
|--------|-------------------------|----------------------------|--------------------|
| E-01   | 고립노드/순환           | 승인·실행 금지             | GRAPH_INVALID      |
| E-02   | 지원하지 않는 node type | UNKNOWN으로 격리, 수동변환 | MAPPER_UNSUPPORTED |

| **구분**      | **적용 내용**                                                     |
|---------------|-------------------------------------------------------------------|
| 권한          | 시스템 검증, SOP 편집자 수정                                      |
| 상태전이      | RAW → MAPPED → VALIDATING → DRAFT/INVALID                         |
| 주요 데이터   | SopDefinition, SopNode, TaskTemplate, DecisionRule, MappingReport |
| 연계/API 후보 | Internal UniSopMapper/GraphValidator                              |
| 감사 이벤트   | SOP_MAPPED/VALIDATION_WARNING/FAILED                              |
| 인수기준      | 승인 SOP의 고립/순환 0건, sourceRefs 연결                         |
| 추적          | ADR-13, WP-WORKFLOW                                               |

## US-SIT-014. SOP Canvas 수동 편집·조직/채널/완료조건 매핑

| **항목**  | **상세 내용**                                                                                         |
|-----------|-------------------------------------------------------------------------------------------------------|
| 목적      | AI 초안을 사용자가 Flowchart와 속성패널에서 수정하고 실제 실행 가능한 임무·판단·전파 정보를 완성한다. |
| 주 행위자 | SOP 편집자, 조직관리자, 통제관                                                                        |
| 선행조건  | SOP DRAFT 또는 기존 SOP 복제                                                                          |
| Trigger   | Canvas 편집                                                                                           |
| 입력      | 노드 유형, 임무, 담당 역할/사람, 채널, 메시지, 기한, 완료조건, 판단식                                 |
| 완료조건  | 모든 행동노드에 담당/완료조건, 모든 분기에 조건                                                       |
| 화면 후보 | SCR-SOP-003~004                                                                                       |

| **\#** | **주체** | **사용자/시스템 행위**                                   | **처리·검증 규칙**          | **결과·상태**          |
|--------|----------|----------------------------------------------------------|-----------------------------|------------------------|
| 1      | 사용자   | 시작/행동/판단/전파/설명/종료 노드를 추가·수정·삭제한다. | 안정 nodeId와 revision 사용 | EDITING                |
| 2      | 사용자   | 화살표로 실행순서를 연결한다.                            | 고립/순환 실시간검증        | GRAPH_EDITED           |
| 3      | 사용자   | 임무내용·담당·기한·완료조건을 입력한다.                  | 역할 또는 구체담당 필수     | TASK_CONFIGURED        |
| 4      | 사용자   | 채널·수신자·훈련 메시지 템플릿을 지정한다.               | TRAINING 표식·PII 최소화    | PROPAGATION_CONFIGURED |
| 5      | 사용자   | 판단조건과 true/false 또는 다중분기를 입력한다.          | DMN은 복잡규칙에 제한사용   | DECISION_CONFIGURED    |
| 6      | 시스템   | revision 저장·Diff/Undo를 제공한다.                      | 동시편집 충돌검사           | DRAFT_SAVED            |

| **ID** | **조건**            | **처리**                                         | **종료/복귀** |
|--------|---------------------|--------------------------------------------------|---------------|
| A-01   | 역할만 지정         | 실행 전 Institution Binding에서 실제 담당자 해석 | ROLE_BOUND    |
| A-02   | 자동/수동 실행 혼합 | 노드별 executionMode 저장                        | CONFIGURED    |

| **ID** | **오류 조건**      | **사용자 메시지·복구**      | **로그·상태**    |
|--------|--------------------|-----------------------------|------------------|
| E-01   | 필수 종료노드 삭제 | 저장 가능하나 승인 금지     | VALIDATION_ERROR |
| E-02   | 동시수정           | revision conflict·Diff 병합 | EDIT_CONFLICT    |

| **구분**      | **적용 내용**                                                      |
|---------------|--------------------------------------------------------------------|
| 권한          | SOP 편집자 A/R, 조직관리자 연락처, 통제관 검토                     |
| 상태전이      | DRAFT → EDITING → VALIDATING                                       |
| 주요 데이터   | SopDefinition, Graph, TaskTemplate, RecipientRule, MessageTemplate |
| 연계/API 후보 | Internal SOP API, Org Directory Port                               |
| 감사 이벤트   | SOP_NODE_ADDED/UPDATED/DELETED, SOP_REVISION_SAVED                 |
| 인수기준      | 모든 행동노드에 담당/완료조건, 모든 분기에 조건                    |
| 추적          | UFR-SOP-03~10, WP-WORKFLOW                                         |

## US-SIT-015. SOP 검토·승인·버전 고정

| **항목**  | **상세 내용**                                                                               |
|-----------|---------------------------------------------------------------------------------------------|
| 목적      | 실행 전 SOP 그래프·근거·조직·채널·완료조건을 검토하고 승인된 버전을 불변 기준으로 고정한다. |
| 주 행위자 | 통제관/지휘자, 승인자, 검토자                                                               |
| 선행조건  | SOP Validation PASS 또는 승인가능 Warning                                                   |
| Trigger   | \[검토요청\]/\[승인\]                                                                       |
| 입력      | sopRevision, validationReport, evidenceHash, institutionBinding                             |
| 완료조건  | 실행 인스턴스가 승인 version/hash 고정                                                      |
| 화면 후보 | SCR-SOP-005                                                                                 |

| **\#** | **주체** | **사용자/시스템 행위**                            | **처리·검증 규칙**      | **결과·상태**    |
|--------|----------|---------------------------------------------------|-------------------------|------------------|
| 1      | 편집자   | 검토요청을 제출한다.                              | 현재 revision/hash 고정 | REVIEW_REQUESTED |
| 2      | 검토자   | 그래프·근거·담당·메시지·분기·훈련표식을 확인한다. | 체크리스트              | IN_REVIEW        |
| 3      | 검토자   | 승인/보완요청을 선택한다.                         | 보완은 사유·대상노드    | REVIEW_DECISION  |
| 4      | 승인자   | 최종 revision/hash를 재확인하고 승인한다.         | 권한·재인증             | APPROVED         |
| 5      | 시스템   | SopDefinition version을 불변화한다.               | 실행은 이 version 참조  | SOP_READY        |

| **ID** | **조건**    | **처리**                                 | **종료/복귀**           |
|--------|-------------|------------------------------------------|-------------------------|
| A-01   | 조건부 승인 | Warning 수용사유와 실행전 확인 Task 생성 | APPROVED_WITH_CONDITION |
| A-02   | 보완요청    | DRAFT 새 revision으로 복귀               | EDITING                 |

| **ID** | **오류 조건**          | **사용자 메시지·복구** | **로그·상태**    |
|--------|------------------------|------------------------|------------------|
| E-01   | 검토 중 revision 변경  | 승인 차단·재검토       | REVISION_CHANGED |
| E-02   | 수신자 0명/분기 미완성 | 승인 금지              | VALIDATION_BLOCK |

| **구분**      | **적용 내용**                                    |
|---------------|--------------------------------------------------|
| 권한          | 승인자만 APPROVED; 편집자 승인 불가              |
| 상태전이      | DRAFT → REVIEW → APPROVED/SUPERSEDED             |
| 주요 데이터   | ApprovalRecord, ValidationReport, SopVersionHash |
| 연계/API 후보 | POST /sops/{id}/approve 후보                     |
| 감사 이벤트   | SOP_REVIEWED/APPROVED/REJECTED                   |
| 인수기준      | 실행 인스턴스가 승인 version/hash 고정           |
| 추적          | ADR-13·18, UFR-SOP-11~14                         |

## US-SIT-016. SOP 시뮬레이션·Dry-run 검증

| **항목**  | **상세 내용**                                                                                           |
|-----------|---------------------------------------------------------------------------------------------------------|
| 목적      | 실제 전파 없이 가상 수신자와 Inject를 사용해 분기·임무·기한·전자상황판·일지 Projection을 사전 검증한다. |
| 주 행위자 | 훈련통제관, SOP 편집자, QA                                                                              |
| 선행조건  | 승인 또는 검증대상 SOP                                                                                  |
| Trigger   | \[시뮬레이션\] 선택                                                                                     |
| 입력      | SOP version, virtual clock, Inject set, Simulation Channel                                              |
| 완료조건  | 실제 외부발송 0건, 기대 시나리오 성공률 산출                                                            |
| 화면 후보 | SCR-SOP-006                                                                                             |

| **\#** | **주체**           | **사용자/시스템 행위**                       | **처리·검증 규칙**       | **결과·상태**    |
|--------|--------------------|----------------------------------------------|--------------------------|------------------|
| 1      | 사용자             | 시뮬레이션 범위·가상시각·수신자를 설정한다.  | 실제 채널 강제 OFF       | SIM_READY        |
| 2      | 시스템             | 별도 simulation execution을 생성한다.        | REAL 사건과 데이터 격리  | SIM_RUNNING      |
| 3      | 통제관             | Inject를 순차/수동 투입한다.                 | 예정·실제 투입시각 기록  | INJECTED         |
| 4      | Simulation Adapter | 전파·수신·착수·완료 결과를 모의한다.         | 지연/실패 조건 설정 가능 | EVENTS_EMITTED   |
| 5      | 시스템             | 분기·기한·상황판·Projection 결과를 검증한다. | 시나리오 기대값 비교     | SIM_RESULT       |
| 6      | 사용자             | 결함을 SOP 개선항목으로 등록한다.            | 원본 SOP 자동변경 금지   | IMPROVEMENT_OPEN |

| **ID** | **조건**                | **처리**                            | **종료/복귀**   |
|--------|-------------------------|-------------------------------------|-----------------|
| A-01   | 실제 담당자 참여형 훈련 | System channel과 훈련용 계정만 사용 | PARTICIPANT_SIM |
| A-02   | 특정 분기만 검증        | 선행상태를 seed하여 부분 실행       | PARTIAL_SIM     |

| **ID** | **오류 조건**       | **사용자 메시지·복구** | **로그·상태**   |
|--------|---------------------|------------------------|-----------------|
| E-01   | 실제 채널 활성 감지 | 시뮬레이션 즉시 중단   | SAFETY_BLOCK    |
| E-02   | 기대 Event 누락     | 시험 실패·Trace 저장   | SIM_ASSERT_FAIL |

| **구분**      | **적용 내용**                                            |
|---------------|----------------------------------------------------------|
| 권한          | 통제관/QA 실행                                           |
| 상태전이      | READY → SIM_RUNNING → SIM_COMPLETED/FAILED               |
| 주요 데이터   | SimulationExecution, Inject, ExpectedEvent, TestEvidence |
| 연계/API 후보 | SimulationChannelPort, VirtualClock                      |
| 감사 이벤트   | SIMULATION_STARTED/INJECTED/COMPLETED                    |
| 인수기준      | 실제 외부발송 0건, 기대 시나리오 성공률 산출             |
| 추적          | UFR-SOP-17, WP-SCENARIO/QA                               |

## US-SIT-017. 실제 재난/훈련 SOP 실행 시작

| **항목**  | **상세 내용**                                                                                |
|-----------|----------------------------------------------------------------------------------------------|
| 목적      | 확정 Snapshot과 승인 SOP를 결합해 실행 인스턴스를 생성하고 시작 Event를 사실원장에 기록한다. |
| 주 행위자 | 훈련통제관/지휘자                                                                            |
| 선행조건  | Incident CONTEXT_CONFIRMED, SOP APPROVED, Binding 완료                                       |
| Trigger   | \[실행 시작\] 선택                                                                           |
| 입력      | incidentId, snapshotId, sopVersion, startMode, plannedAt                                     |
| 완료조건  | 승인버전·snapshotId 고정, 시작 Event 1건                                                     |
| 화면 후보 | SCR-SOP-006~007                                                                              |

| **\#** | **주체** | **사용자/시스템 행위**                          | **처리·검증 규칙**             | **결과·상태**      |
|--------|----------|-------------------------------------------------|--------------------------------|--------------------|
| 1      | 사용자   | 실행대상·모드·시작시각·채널정책을 최종확인한다. | TRAINING 표식·실제채널 경고    | START_PREVIEW      |
| 2      | 시스템   | Snapshot/SOP/Binding hash를 검증한다.           | 변경되면 재승인 요구           | PRECHECK           |
| 3      | 시스템   | SopExecution과 초기 Task를 원자적으로 생성한다. | Transaction/Outbox 준비        | RUN_CREATED        |
| 4      | 시스템   | EXECUTION_STARTED Event를 append한다.           | occurredAt/actor/correlationId | RUNNING            |
| 5      | Workflow | 시작노드에서 활성노드를 계산한다.               | 자동/수동 실행정책             | ACTIVE_NODES_READY |
| 6      | UI       | 전자상황판과 실행화면을 갱신한다.               | 실시간 SSE/WebSocket           | MONITORING         |

| **ID** | **조건**       | **처리**                                | **종료/복귀**  |
|--------|----------------|-----------------------------------------|----------------|
| A-01   | 예약 시작      | 스케줄러가 시각 도달 후 precheck 재수행 | SCHEDULED      |
| A-02   | 수동 단계 실행 | 자동노드만 대기, 통제관 클릭            | RUNNING_MANUAL |

| **ID** | **오류 조건**            | **사용자 메시지·복구** | **로그·상태**        |
|--------|--------------------------|------------------------|----------------------|
| E-01   | Snapshot/SOP hash 불일치 | 실행 차단·재검토       | PRECHECK_FAILED      |
| E-02   | 동일 idempotencyKey      | 기존 execution 반환    | DUPLICATE_SUPPRESSED |

| **구분**      | **적용 내용**                                |
|---------------|----------------------------------------------|
| 권한          | 통제관/지휘자 A/R, 승인자 정책               |
| 상태전이      | SOP_READY → EXECUTION RUNNING                |
| 주요 데이터   | SopExecution, TaskAssignment, ExecutionEvent |
| 연계/API 후보 | POST /executions 후보                        |
| 감사 이벤트   | EXECUTION_STARTED                            |
| 인수기준      | 승인버전·snapshotId 고정, 시작 Event 1건     |
| 추적          | ADR-17·18, UFR-SOP-15                        |

## US-SIT-018. 전파대상 해석·메시지 확정·Outbox 적재

| **항목**  | **상세 내용**                                                                                               |
|-----------|-------------------------------------------------------------------------------------------------------------|
| 목적      | 활성 임무의 역할/조직 규칙을 실제 수신자로 해석하고 채널별 메시지를 확정해 Transactional Outbox에 적재한다. |
| 주 행위자 | Workflow, 통제관/지휘자, 조직관리자                                                                         |
| 선행조건  | 활성 전파/행동노드, Institution Binding                                                                     |
| Trigger   | 노드 자동실행 또는 \[전파\] 선택                                                                            |
| 입력      | role/recipient rule, message template, channel, dueAt, incident/snapshot fields                             |
| 완료조건  | Task-Message 원자성, 중복 Outbox 0건                                                                        |
| 화면 후보 | SCR-SOP-008                                                                                                 |

| **\#** | **주체**   | **사용자/시스템 행위**                                       | **처리·검증 규칙**   | **결과·상태**       |
|--------|------------|--------------------------------------------------------------|----------------------|---------------------|
| 1      | Workflow   | 노드의 역할·조직·대체담당 규칙을 해석한다.                   | 기준시각 유효 연락처 | RECIPIENT_RESOLVING |
| 2      | 시스템     | 훈련/실제 표식과 최소 필요 상황정보로 메시지를 렌더링한다.   | 민감정보 최소화      | MESSAGE_PREVIEW     |
| 3      | 사용자     | 수신자·메시지·채널을 최종확인/수정한다.                      | 수정내용 감사        | CONFIRMED           |
| 4      | Backend    | Task와 PropagationMessage/Outbox를 동일 트랜잭션에 저장한다. | idempotencyKey       | OUTBOXED            |
| 5      | Dispatcher | 채널별 송신대기열로 전달한다.                                | 우선순위/재시도 정책 | PENDING_SEND        |

| **ID** | **조건**      | **처리**                                 | **종료/복귀**    |
|--------|---------------|------------------------------------------|------------------|
| A-01   | 수신자 미매핑 | 통제관이 임시 담당자 지정 또는 임무 보류 | MAPPING_REQUIRED |
| A-02   | 복수 채널     | 채널별 Message child 생성                | MULTI_CHANNEL    |

| **ID** | **오류 조건**        | **사용자 메시지·복구**       | **로그·상태**     |
|--------|----------------------|------------------------------|-------------------|
| E-01   | 연락처 형식 오류     | 해당 채널 제외·대체채널 제안 | RECIPIENT_INVALID |
| E-02   | Outbox 트랜잭션 실패 | Task 생성 롤백               | OUTBOX_ERROR      |

| **구분**      | **적용 내용**                                                   |
|---------------|-----------------------------------------------------------------|
| 권한          | Workflow 자동; 통제관 메시지/수신자 수정                        |
| 상태전이      | ACTIVE → RESOLVED → OUTBOXED                                    |
| 주요 데이터   | TaskAssignment, RecipientResolution, PropagationMessage, Outbox |
| 연계/API 후보 | OrgDirectoryPort, OutboxRepository                              |
| 감사 이벤트   | RECIPIENT_RESOLVED/MESSAGE_OUTBOXED                             |
| 인수기준      | Task-Message 원자성, 중복 Outbox 0건                            |
| 추적          | ADR-17, WP-PROPAGATION                                          |

## US-SIT-019. 다채널 상황·임무 전파와 송신결과 처리

| **항목**  | **상세 내용**                                                                                                    |
|-----------|------------------------------------------------------------------------------------------------------------------|
| 목적      | System/Simulation/SMS/Email/Broadcast ChannelPort로 메시지를 송신하고 채널 결과와 업무수신 상태를 분리 기록한다. |
| 주 행위자 | Dispatcher, Channel Adapter, 통제관                                                                              |
| 선행조건  | Outbox PENDING                                                                                                   |
| Trigger   | Dispatcher poll/push                                                                                             |
| 입력      | PropagationMessage, channel config, retry policy                                                                 |
| 완료조건  | 채널실패가 Task 이력에서 누락되지 않음                                                                           |
| 화면 후보 | SCR-SOP-008~009                                                                                                  |

| **\#** | **주체**        | **사용자/시스템 행위**                       | **처리·검증 규칙**           | **결과·상태**   |
|--------|-----------------|----------------------------------------------|------------------------------|-----------------|
| 1      | Dispatcher      | Outbox 항목을 잠금·선점한다.                 | 중복 worker 방지             | SENDING         |
| 2      | Channel Adapter | 채널 요청을 구성해 송신한다.                 | 비밀키 Vault, PII 마스킹로그 | CHANNEL_REQUEST |
| 3      | Adapter         | providerMessageId·송신상태를 반환한다.       | SENT/FAILED/UNKNOWN          | CHANNEL_RESULT  |
| 4      | Backend         | PROPAGATION_SENT/FAILED Event를 append한다.  | 업무 수신확인과 구분         | EVENT_LOGGED    |
| 5      | Retry Policy    | 일시실패는 backoff 재시도한다.               | 최대횟수·TTL                 | RETRY/FINAL     |
| 6      | UI              | 채널별 상태·실패사유·재전파 버튼을 표시한다. | 권한 통제                    | VISIBLE         |

| **ID** | **조건**         | **처리**                                       | **종료/복귀**    |
|--------|------------------|------------------------------------------------|------------------|
| A-01   | 외부 채널 미제공 | System/Simulation Adapter로 E2E 검증           | SIMULATED        |
| A-02   | 한 채널 실패     | 다른 채널 성공을 별도표시·정책에 따라 성공판정 | PARTIAL_DELIVERY |

| **ID** | **오류 조건**  | **사용자 메시지·복구**        | **로그·상태**       |
|--------|----------------|-------------------------------|---------------------|
| E-01   | 인증/쿼터 오류 | Circuit Open·관리자 알림      | CHANNEL_UNAVAILABLE |
| E-02   | 응답 UNKNOWN   | 조회/수동확인·재송신 중복경고 | DELIVERY_UNKNOWN    |

| **구분**      | **적용 내용**                                    |
|---------------|--------------------------------------------------|
| 권한          | Dispatcher 자동; 재전파 통제관                   |
| 상태전이      | OUTBOXED → SENDING → SENT/FAILED/UNKNOWN         |
| 주요 데이터   | ChannelResult, ProviderMessageId, ExecutionEvent |
| 연계/API 후보 | ChannelPort.send/status                          |
| 감사 이벤트   | PROPAGATION_SENT/FAILED/RETRY                    |
| 인수기준      | 채널실패가 Task 이력에서 누락되지 않음           |
| 추적          | ADR-17, UFR-SOP-18                               |

## US-SIT-020. 현장 담당자 임무 수신확인·본인확인

| **항목**  | **상세 내용**                                                                                  |
|-----------|------------------------------------------------------------------------------------------------|
| 목적      | 담당자가 시스템 링크/알림에서 임무를 열고 본인·사건·훈련 여부를 확인한 뒤 수신확인을 기록한다. |
| 주 행위자 | 현장 임무담당자                                                                                |
| 선행조건  | Message SENT/DELIVERED, 유효 Task                                                              |
| Trigger   | 임무 링크 열기 또는 앱 알림                                                                    |
| 입력      | signed task token, taskId, recipient, mode                                                     |
| 완료조건  | 수신확인 actor/time 추적, 타인접근 차단                                                        |
| 화면 후보 | SCR-TASK-001                                                                                   |

| **\#** | **주체** | **사용자/시스템 행위**                                    | **처리·검증 규칙**          | **결과·상태**         |
|--------|----------|-----------------------------------------------------------|-----------------------------|-----------------------|
| 1      | 담당자   | 임무 알림을 연다.                                         | 훈련/실제 표식·사건명 표시  | OPENED                |
| 2      | 시스템   | 서명토큰·만료·수신자·Task 상태를 검증한다.                | 토큰 재사용 정책            | IDENTITY_VALIDATED    |
| 3      | 담당자   | 임무내용·기한·완료조건·연락처를 확인한다.                 | 필요 최소 상황정보          | TASK_VIEWED           |
| 4      | 담당자   | \[수신확인\] 또는 \[담당자 아님\]을 선택한다.             | 확인시각·위치/단말 선택수집 | ACKNOWLEDGED/REJECTED |
| 5      | 시스템   | RECEIVED/ACKNOWLEDGED Event를 기록하고 상황판을 갱신한다. | 채널 전달과 업무확인 구분   | BOARD_UPDATED         |

| **ID** | **조건**      | **처리**                      | **종료/복귀**     |
|--------|---------------|-------------------------------|-------------------|
| A-01   | 공용역할 수신 | 해당 역할의 한 사용자가 Claim | CLAIMED           |
| A-02   | 담당자 아님   | 대체담당 해석·통제관 알림     | REASSIGN_REQUIRED |

| **ID** | **오류 조건**    | **사용자 메시지·복구**  | **로그·상태** |
|--------|------------------|-------------------------|---------------|
| E-01   | 토큰 만료        | 재인증/새 링크 요청     | TOKEN_EXPIRED |
| E-02   | 이미 재배정/완료 | 최신 상태 읽기전용 표시 | STATE_CHANGED |

| **구분**      | **적용 내용**                                   |
|---------------|-------------------------------------------------|
| 권한          | 지정 수신자/역할만                              |
| 상태전이      | SENT → RECEIVED → ACKNOWLEDGED/REJECTED         |
| 주요 데이터   | TaskAssignment, TaskAccessToken, ExecutionEvent |
| 연계/API 후보 | POST /tasks/{id}/ack 후보                       |
| 감사 이벤트   | TASK_RECEIVED/ACKNOWLEDGED/REJECTED             |
| 인수기준      | 수신확인 actor/time 추적, 타인접근 차단         |
| 추적          | ADR-17, UFR-SOP-16                              |

## US-SIT-021. 임무 착수·진행상태·예상완료 보고

| **항목**  | **상세 내용**                                                                          |
|-----------|----------------------------------------------------------------------------------------|
| 목적      | 담당자가 임무 착수와 진행률·예상완료·지원필요를 보고해 지휘자와 전자상황판에 반영한다. |
| 주 행위자 | 현장 담당자, 지휘자                                                                    |
| 선행조건  | Task ACKNOWLEDGED                                                                      |
| Trigger   | \[착수\] 또는 진행보고                                                                 |
| 입력      | startedAt, progress, ETA, supportRequest, note                                         |
| 완료조건  | 착수 Event 중복 0, 상태전이 규칙 준수                                                  |
| 화면 후보 | SCR-TASK-001, SCR-BOARD-001                                                            |

| **\#** | **주체** | **사용자/시스템 행위**                      | **처리·검증 규칙**     | **결과·상태**     |
|--------|----------|---------------------------------------------|------------------------|-------------------|
| 1      | 담당자   | \[착수\]를 선택한다.                        | 선행임무/승인조건 검증 | START_REQUESTED   |
| 2      | 시스템   | TASK_STARTED Event를 기록한다.              | occurredAt·actor       | IN_PROGRESS       |
| 3      | 담당자   | 진행률·예상완료·지원필요를 입력한다.        | 범위·필수값 검증       | PROGRESS_REPORTED |
| 4      | 시스템   | TaskProjection과 전자상황판을 갱신한다.     | 마지막 보고시각 표시   | BOARD_UPDATED     |
| 5      | 지휘자   | 지원요청에 후속 Task/전파를 생성할 수 있다. | 원 Task 연결           | FOLLOWUP_CREATED  |

| **ID** | **조건**        | **처리**                                               | **종료/복귀** |
|--------|-----------------|--------------------------------------------------------|---------------|
| A-01   | 오프라인 착수   | 로컬 임시저장 후 연결시 occurredAt/deviceAt 분리동기화 | SYNCED        |
| A-02   | 선행조건 미충족 | 통제관 Override 또는 대기                              | BLOCKED       |

| **ID** | **오류 조건**  | **사용자 메시지·복구**    | **로그·상태**        |
|--------|----------------|---------------------------|----------------------|
| E-01   | 완료 Task 착수 | 상태변경 차단             | INVALID_TRANSITION   |
| E-02   | 중복착수       | idempotencyKey로 1건 처리 | DUPLICATE_SUPPRESSED |

| **구분**      | **적용 내용**                              |
|---------------|--------------------------------------------|
| 권한          | 담당자 A/R; 지휘자 Override                |
| 상태전이      | ACKNOWLEDGED → IN_PROGRESS                 |
| 주요 데이터   | TaskStatus, ProgressReport, SupportRequest |
| 연계/API 후보 | POST /tasks/{id}/start/progress            |
| 감사 이벤트   | TASK_STARTED/PROGRESS_REPORTED             |
| 인수기준      | 착수 Event 중복 0, 상태전이 규칙 준수      |
| 추적          | WP-WORKFLOW                                |

## US-SIT-022. 현장보고·사진/파일·피해/통제 Fact 등록

| **항목**  | **상세 내용**                                                                                                      |
|-----------|--------------------------------------------------------------------------------------------------------------------|
| 목적      | 현장 담당자가 임무 수행 중 관측·피해·통제·사진을 근거와 함께 보고하고 상황 후보 Fact와 Execution Event를 생성한다. |
| 주 행위자 | 현장 담당자, 상황등록자                                                                                            |
| 선행조건  | Task IN_PROGRESS 또는 Incident RUNNING                                                                             |
| Trigger   | \[현장보고\] 선택                                                                                                  |
| 입력      | 보고유형, 관측시각, 위치, 내용, 첨부, 정확도/확인상태                                                              |
| 완료조건  | 보고 원문·작성자·시각·첨부 hash 추적                                                                               |
| 화면 후보 | SCR-TASK-002, SCR-SIT-005                                                                                          |

| **\#** | **주체**   | **사용자/시스템 행위**                              | **처리·검증 규칙**                        | **결과·상태**        |
|--------|------------|-----------------------------------------------------|-------------------------------------------|----------------------|
| 1      | 담당자     | 보고유형과 내용을 입력한다.                         | FIELD_REPORT/DAMAGE_STATUS/CONTROL_STATUS | REPORT_DRAFT         |
| 2      | 시스템     | 첨부 MIME·크기·악성코드·EXIF 정책을 검사한다.       | 개인정보/위치 최소화                      | ATTACHMENT_VALIDATED |
| 3      | 시스템     | FIELD_REPORT Event와 후보 SituationFact를 생성한다. | observedAt/retrievedAt 분리               | REPORT_SUBMITTED     |
| 4      | 상황등록자 | 후보 Fact를 검토·선택·정정한다.                     | 원 보고 불변                              | FACT_REVIEW          |
| 5      | 시스템     | 새 Snapshot 필요 배지를 표시한다.                   | 기존 Snapshot 자동변경 금지               | NEW_CANDIDATE        |

| **ID** | **조건**           | **처리**                                     | **종료/복귀**  |
|--------|--------------------|----------------------------------------------|----------------|
| A-01   | 전화/구두 보고     | 통제관이 대리입력하고 reporter/recorder 분리 | PROXY_RECORDED |
| A-02   | 첨부 없이 긴급보고 | 텍스트 우선 제출, 후속첨부 가능              | SUBMITTED      |

| **ID** | **오류 조건**     | **사용자 메시지·복구**    | **로그·상태**       |
|--------|-------------------|---------------------------|---------------------|
| E-01   | 금지파일/악성코드 | 첨부거부·텍스트 저장 선택 | ATTACHMENT_REJECTED |
| E-02   | 시각/위치 불명    | 미확인 표시·후속확인 Task | INCOMPLETE_REPORT   |

| **구분**      | **적용 내용**                                          |
|---------------|--------------------------------------------------------|
| 권한          | 담당자 보고, 등록자 Fact 확정                          |
| 상태전이      | IN_PROGRESS → REPORT_SUBMITTED; Context NEW_CANDIDATE  |
| 주요 데이터   | FieldReport, Attachment, SituationFact, ExecutionEvent |
| 연계/API 후보 | POST /tasks/{id}/reports, FileStore                    |
| 감사 이벤트   | FIELD_REPORT_SUBMITTED/FACT_CANDIDATE_CREATED          |
| 인수기준      | 보고 원문·작성자·시각·첨부 hash 추적                   |
| 추적          | ADR-08, WP-WORKFLOW/SITUATION                          |

## US-SIT-023. 임무 완료·불가·반려·재배정

| **항목**  | **상세 내용**                                                                                 |
|-----------|-----------------------------------------------------------------------------------------------|
| 목적      | 담당자가 완료증거를 제출하고 지휘자가 완료수용·반려·재배정하여 상태와 이력을 정확히 기록한다. |
| 주 행위자 | 현장 담당자, 지휘자/통제관                                                                    |
| 선행조건  | Task IN_PROGRESS                                                                              |
| Trigger   | \[완료\]/\[수행불가\] 선택                                                                    |
| 입력      | 완료결과, completionCriteria, evidence, 불가사유, 대체담당                                    |
| 완료조건  | 완료와 승인시각 분리, 모든 상태변경 Event                                                     |
| 화면 후보 | SCR-TASK-003                                                                                  |

| **\#** | **주체** | **사용자/시스템 행위**                                                 | **처리·검증 규칙** | **결과·상태**        |
|--------|----------|------------------------------------------------------------------------|--------------------|----------------------|
| 1      | 담당자   | 완료/불가와 결과·증거를 제출한다.                                      | 필수 완료조건 검사 | COMPLETION_SUBMITTED |
| 2      | 시스템   | TASK_COMPLETION_SUBMITTED Event를 기록한다.                            | 제출과 승인 분리   | AWAITING_REVIEW      |
| 3      | 지휘자   | 수용/반려/재배정을 선택한다.                                           | 사유 필수          | DECISION             |
| 4      | 시스템   | 수용 시 COMPLETED, 반려 시 IN_PROGRESS, 재배정 시 REASSIGNED 처리한다. | Event append-only  | STATE_UPDATED        |
| 5      | Workflow | 후속 노드 활성화/분기조건을 재평가한다.                                | 원자적 이벤트처리  | NEXT_NODES           |

| **ID** | **조건**          | **처리**                          | **종료/복귀**  |
|--------|-------------------|-----------------------------------|----------------|
| A-01   | 자동완료 허용노드 | 검증가능 시스템 Event로 완료      | AUTO_COMPLETED |
| A-02   | 부분완료          | 하위 Task 분할 또는 progress 유지 | PARTIAL        |

| **ID** | **오류 조건**  | **사용자 메시지·복구**        | **로그·상태**     |
|--------|----------------|-------------------------------|-------------------|
| E-01   | 증거 누락      | 제출차단 또는 조건부 경고     | CRITERIA_MISSING  |
| E-02   | 동시 승인/반려 | revision conflict·선처리 유지 | DECISION_CONFLICT |

| **구분**      | **적용 내용**                                                     |
|---------------|-------------------------------------------------------------------|
| 권한          | 담당자 제출, 지휘자 수용/반려/재배정                              |
| 상태전이      | IN_PROGRESS → SUBMITTED → COMPLETED/IN_PROGRESS/REASSIGNED/FAILED |
| 주요 데이터   | CompletionReport, Evidence, TaskDecision, ExecutionEvent          |
| 연계/API 후보 | POST /tasks/{id}/complete/review                                  |
| 감사 이벤트   | TASK_COMPLETION_SUBMITTED/COMPLETED/REJECTED/REASSIGNED           |
| 인수기준      | 완료와 승인시각 분리, 모든 상태변경 Event                         |
| 추적          | UFR-SOP-16/20                                                     |

## US-SIT-024. 상황판단 노드 조건평가·분기 선택

| **항목**  | **상세 내용**                                                                                       |
|-----------|-----------------------------------------------------------------------------------------------------|
| 목적      | 판단노드에서 Snapshot·Execution Log·사용자 확인값을 근거로 실행경로를 선택하고 판단근거를 보존한다. |
| 주 행위자 | 지휘자/통제관, Workflow                                                                             |
| 선행조건  | 판단노드 활성, 선행임무 완료                                                                        |
| Trigger   | 자동조건 평가 또는 사용자 분기선택                                                                  |
| 입력      | decisionExpression, inputFacts/events, branch, rationale                                            |
| 완료조건  | 분기마다 근거·actor·입력 hash                                                                       |
| 화면 후보 | SCR-SOP-010                                                                                         |

| **\#** | **주체** | **사용자/시스템 행위**                       | **처리·검증 규칙**            | **결과·상태**    |
|--------|----------|----------------------------------------------|-------------------------------|------------------|
| 1      | Workflow | 판단식 입력값을 Snapshot/Event에서 조회한다. | 허용된 변수만                 | DECISION_READY   |
| 2      | 시스템   | 자동평가 결과와 근거를 표시한다.             | 불확실하면 수동결정 요구      | EVALUATED        |
| 3      | 지휘자   | 분기와 판단사유를 확인/선택한다.             | 수동 Override 사유 필수       | BRANCH_CONFIRMED |
| 4      | 시스템   | DECISION_MADE Event를 기록한다.              | expression/version/input hash | EVENT_LOGGED     |
| 5      | Workflow | 선택 branch의 다음 노드를 활성화한다.        | 비선택 branch 취소/대기       | NEXT_ACTIVE      |

| **ID** | **조건**         | **처리**                              | **종료/복귀** |
|--------|------------------|---------------------------------------|---------------|
| A-01   | 다중분기         | 우선순위/복수 branch 정책에 따라 선택 | MULTI_BRANCH  |
| A-02   | 입력 Fact 미확정 | 추가 확인 Task 또는 수동판단          | WAITING_INPUT |

| **ID** | **오류 조건**      | **사용자 메시지·복구**          | **로그·상태**    |
|--------|--------------------|---------------------------------|------------------|
| E-01   | 표현식 오류        | 자동평가 중지·수동선택/설계수정 | EXPRESSION_ERROR |
| E-02   | 허용되지 않은 변수 | 승인/실행 차단                  | DECISION_INVALID |

| **구분**      | **적용 내용**                                     |
|---------------|---------------------------------------------------|
| 권한          | 지휘자/통제관 결정; Workflow 자동제안             |
| 상태전이      | DECISION_READY → EVALUATED → BRANCH_CONFIRMED     |
| 주요 데이터   | DecisionEvaluation, InputSnapshot, ExecutionEvent |
| 연계/API 후보 | DecisionEngine/DMN optional                       |
| 감사 이벤트   | DECISION_EVALUATED/MADE/OVERRIDDEN                |
| 인수기준      | 분기마다 근거·actor·입력 hash                     |
| 추적          | UFR-SOP-08, WP-WORKFLOW                           |

## US-SIT-025. 미수신·기한초과·실패 임무 Escalation·재전파

| **항목**  | **상세 내용**                                                                                       |
|-----------|-----------------------------------------------------------------------------------------------------|
| 목적      | 수신/착수/완료 SLA를 초과한 임무를 탐지해 대체담당·상위조직·다른 채널로 재전파하고 이력을 연결한다. |
| 주 행위자 | Workflow Scheduler, 지휘자/통제관                                                                   |
| 선행조건  | Task SENT/ACK/IN_PROGRESS, SLA 정책                                                                 |
| Trigger   | SLA 만료 또는 수동 \[재전파\]                                                                       |
| 입력      | taskId, SLA, escalation rule, alternate recipient/channel                                           |
| 완료조건  | 원본과 재전파 lineage, 무한재시도 0                                                                 |
| 화면 후보 | SCR-BOARD-002                                                                                       |

| **\#** | **주체**  | **사용자/시스템 행위**                                    | **처리·검증 규칙**         | **결과·상태**      |
|--------|-----------|-----------------------------------------------------------|----------------------------|--------------------|
| 1      | Scheduler | ack/start/complete deadline을 평가한다.                   | 가상/실제 clock 구분       | SLA_CHECK          |
| 2      | 시스템    | 미수신/지연/실패를 분류한다.                              | 채널실패와 업무미확인 구분 | OVERDUE            |
| 3      | 지휘자    | 자동정책 또는 수동으로 대체담당/상위조직/채널을 선택한다. | 중복수행 위험 경고         | ESCALATION_DECIDED |
| 4      | 시스템    | ESCALATION Event와 child Propagation을 생성한다.          | parentTask/message 연결    | REPROPAGATED       |
| 5      | UI        | 원본·재전파·현재담당을 함께 표시한다.                     | 시간순 이력                | BOARD_UPDATED      |

| **ID** | **조건**            | **처리**                         | **종료/복귀**   |
|--------|---------------------|----------------------------------|-----------------|
| A-01   | 원 담당자 늦은 응답 | 현재담당과 조정·중복방지 확인    | LATE_RESPONSE   |
| A-02   | 일괄 장애           | 기관 비상연락망/방송 채널로 전환 | BULK_ESCALATION |

| **ID** | **오류 조건**        | **사용자 메시지·복구**        | **로그·상태**    |
|--------|----------------------|-------------------------------|------------------|
| E-01   | 대체담당 없음        | 지휘자 수동배정 Critical 알림 | NO_ALTERNATE     |
| E-02   | 재전파 반복한도 초과 | 자동중단·상위승인             | ESCALATION_LIMIT |

| **구분**      | **적용 내용**                                     |
|---------------|---------------------------------------------------|
| 권한          | Scheduler 자동제안, 지휘자 확정                   |
| 상태전이      | SENT/IN_PROGRESS → OVERDUE → ESCALATED/REASSIGNED |
| 주요 데이터   | SlaPolicy, EscalationEvent, ParentChildLink       |
| 연계/API 후보 | Scheduler, OrgDirectory, ChannelPort              |
| 감사 이벤트   | TASK_OVERDUE/ESCALATED/REPROPAGATED               |
| 인수기준      | 원본과 재전파 lineage, 무한재시도 0               |
| 추적          | ADR-17, UFR-SOP-18                                |

## US-SIT-026. 복수 SOP·복수 사건 병행 실행과 격리

| **항목**  | **상세 내용**                                                                                  |
|-----------|------------------------------------------------------------------------------------------------|
| 목적      | 동시에 여러 SOP/사건이 실행될 때 탭·필터·ID·채널·이벤트를 격리하고 사용자의 오조작을 방지한다. |
| 주 행위자 | 지휘자/통제관, 상황실 사용자                                                                   |
| 선행조건  | 2개 이상 RUNNING execution                                                                     |
| Trigger   | 실행 탭 전환/통합상황판                                                                        |
| 입력      | incidentId, executionId, active tab, filter                                                    |
| 완료조건  | 교차 사건 상태변경 0건                                                                         |
| 화면 후보 | SCR-BOARD-003                                                                                  |

| **\#** | **주체**  | **사용자/시스템 행위**                                  | **처리·검증 규칙**           | **결과·상태**     |
|--------|-----------|---------------------------------------------------------|------------------------------|-------------------|
| 1      | UI        | 사건/실행별 탭과 색상·훈련표식을 표시한다.              | 항상 사건명/모드 고정영역    | MULTI_VIEW        |
| 2      | 사용자    | 특정 실행을 선택한다.                                   | 명령 대상 확인 배너          | CONTEXT_SELECTED  |
| 3      | Backend   | 모든 명령에 incidentId/executionId/revision을 검증한다. | 교차오염 차단                | COMMAND_VALIDATED |
| 4      | Event Bus | partition key로 사건별 순서를 유지한다.                 | global time과 event sequence | EVENT_ISOLATED    |
| 5      | UI        | 통합보기와 사건별 보기를 제공한다.                      | 권한범위 필터                | MONITORING        |

| **ID** | **조건**          | **처리**                               | **종료/복귀** |
|--------|-------------------|----------------------------------------|---------------|
| A-01   | 동일 SOP 다중실행 | 각 execution 독립 상태·Task ID         | ISOLATED      |
| A-02   | 통합 지휘대시보드 | 요약지표만 통합하고 명령은 사건선택 후 | SAFE_COMMAND  |

| **ID** | **오류 조건**         | **사용자 메시지·복구**     | **로그·상태**    |
|--------|-----------------------|----------------------------|------------------|
| E-01   | 선택사건 변경 중 명령 | 확인대화·명령취소          | CONTEXT_MISMATCH |
| E-02   | Event 순서 역전       | sequence로 재정렬·지연표시 | OUT_OF_ORDER     |

| **구분**      | **적용 내용**                               |
|---------------|---------------------------------------------|
| 권한          | 권한사건만 조회/명령                        |
| 상태전이      | 각 Incident/Execution 독립                  |
| 주요 데이터   | IncidentPartition, EventSequence, UIContext |
| 연계/API 후보 | Event Stream partition, command API         |
| 감사 이벤트   | CONTEXT_SWITCHED/CROSS_CONTEXT_BLOCKED      |
| 인수기준      | 교차 사건 상태변경 0건                      |
| 추적          | UFR-SOP-15 복수 탭, WP-WORKFLOW/UI          |

## US-SIT-027. SOP 실행 일시정지·재개·중지·종료

| **항목**  | **상세 내용**                                                                                       |
|-----------|-----------------------------------------------------------------------------------------------------|
| 목적      | 상황 변화·훈련통제·오류에 따라 실행을 일시정지·재개하거나 사유와 미완료임무 처리를 포함해 종료한다. |
| 주 행위자 | 지휘자/훈련통제관, 승인자 정책                                                                      |
| 선행조건  | Execution RUNNING/PAUSED                                                                            |
| Trigger   | \[일시정지\]/\[재개\]/\[중지\]/\[종료\]                                                             |
| 입력      | action, reason, scope, pendingTask disposition, approval                                            |
| 완료조건  | 중지사유·미완료처리 누락 0건                                                                        |
| 화면 후보 | SCR-SOP-007                                                                                         |

| **\#** | **주체** | **사용자/시스템 행위**                           | **처리·검증 규칙**                  | **결과·상태**    |
|--------|----------|--------------------------------------------------|-------------------------------------|------------------|
| 1      | 사용자   | 작업과 사유를 선택한다.                          | 중지/종료는 영향요약 표시           | ACTION_REQUESTED |
| 2      | 시스템   | 권한·상태·미완료 Task·Outbox를 점검한다.         | 진행중 송신 취소가능 여부           | IMPACT_ANALYZED  |
| 3      | 사용자   | 미완료임무를 유지/취소/이관 중 선택한다.         | 필수결정                            | DISPOSITION_SET  |
| 4      | 시스템   | 상태변경 Event를 append하고 Workflow를 제어한다. | PAUSED/RESUMED/TERMINATED/COMPLETED | STATE_CHANGED    |
| 5      | 시스템   | 전자상황판·담당자에게 상태를 전파한다.           | 훈련/실제 표식                      | NOTIFIED         |
| 6      | 시스템   | 종료 시 최종일지/평가 준비상태로 전환한다.       | CLOSING                             | CLOSING          |

| **ID** | **조건**            | **처리**                             | **종료/복귀** |
|--------|---------------------|--------------------------------------|---------------|
| A-01   | 정상 완료           | 모든 필수 종료조건 충족 후 COMPLETED | COMPLETED     |
| A-02   | 부분 scope 일시정지 | 특정 branch/Task만 HOLD              | PARTIAL_PAUSE |

| **ID** | **오류 조건**         | **사용자 메시지·복구**     | **로그·상태**       |
|--------|-----------------------|----------------------------|---------------------|
| E-01   | 권한없는 중지         | 명령거부·감사              | ACCESS_DENIED       |
| E-02   | 중지 중 송신중 메시지 | 결과 UNKNOWN 기록·후속확인 | PARTIAL_TERMINATION |

| **구분**      | **적용 내용**                                        |
|---------------|------------------------------------------------------|
| 권한          | 지휘자/통제관 A/R; 실제 중지는 승인정책 가능         |
| 상태전이      | RUNNING ↔ PAUSED → COMPLETED/TERMINATED              |
| 주요 데이터   | ExecutionControl, PendingDisposition, ExecutionEvent |
| 연계/API 후보 | POST /executions/{id}/pause/resume/terminate         |
| 감사 이벤트   | EXECUTION_PAUSED/RESUMED/TERMINATED/COMPLETED        |
| 인수기준      | 중지사유·미완료처리 누락 0건                         |
| 추적          | UFR-SOP-15, WP-WORKFLOW                              |

## US-SIT-028. 전자상황판 실시간 모니터링·필터·Drill-down

| **항목**  | **상세 내용**                                                                                                    |
|-----------|------------------------------------------------------------------------------------------------------------------|
| 목적      | Execution Log를 시간·조직·임무·상태·채널 기준으로 투영해 현장지휘소가 전체 대응상황과 지연·실패를 즉시 파악한다. |
| 주 행위자 | 지휘자, 통제관, 일지작성자, 감사자                                                                               |
| 선행조건  | Incident RUNNING/CLOSING                                                                                         |
| Trigger   | 전자상황판 진입                                                                                                  |
| 입력      | incident/execution filter, time range, organization, status                                                      |
| 완료조건  | 모든 표출항목 sourceEventIds 연결                                                                                |
| 화면 후보 | SCR-BOARD-001~003                                                                                                |

| **\#** | **주체**   | **사용자/시스템 행위**                              | **처리·검증 규칙**       | **결과·상태**    |
|--------|------------|-----------------------------------------------------|--------------------------|------------------|
| 1      | UI         | 사건요약·경보·Snapshot 기준시각을 표시한다.         | 훈련/실제 고정표식       | SUMMARY          |
| 2      | Projection | ExecutionEvent를 시간순 Timeline으로 투영한다.      | sequence/occurredAt 정렬 | TIMELINE         |
| 3      | UI         | 조직/임무별 수신·착수·완료·지연 KPI를 표시한다.     | 분모/기준 명시           | KPI              |
| 4      | UI         | 채널 발송내역·실패·재전파를 표시한다.               | 메시지 민감정보 마스킹   | PROPAGATION_VIEW |
| 5      | 사용자     | 항목을 선택해 원 Event·근거·담당자·첨부를 조회한다. | 권한별 redaction         | DRILLDOWN        |
| 6      | 시스템     | 지연/실패/새상황 후보를 실시간 배지로 갱신한다.     | SSE/WebSocket 재연결     | LIVE             |

| **ID** | **조건**      | **처리**                             | **종료/복귀** |
|--------|---------------|--------------------------------------|---------------|
| A-01   | 연결 끊김     | 마지막 sequence 이후 재구독·지연배지 | RECONNECTED   |
| A-02   | 대형화면 모드 | 명령기능 제한·자동순환               | DISPLAY_MODE  |

| **ID** | **오류 조건**   | **사용자 메시지·복구**           | **로그·상태**  |
|--------|-----------------|----------------------------------|----------------|
| E-01   | Event gap       | 누락 sequence 재조회·불완전 표시 | EVENT_GAP      |
| E-02   | Projection 지연 | 원 Event 조회 경로 제공          | PROJECTION_LAG |

| **구분**      | **적용 내용**                                 |
|---------------|-----------------------------------------------|
| 권한          | 읽기는 역할범위; 명령은 별도권한              |
| 상태전이      | LIVE/DEGRADED/OFFLINE                         |
| 주요 데이터   | BoardProjection, TimelineItem, KPI, EventLink |
| 연계/API 후보 | GET/stream /boards/{incidentId}               |
| 감사 이벤트   | BOARD_OPENED/DRILLDOWN/PROJECTION_LAG         |
| 인수기준      | 모든 표출항목 sourceEventIds 연결             |
| 추적          | WP-WORKFLOW/JOURNAL/UI                        |

## US-SIT-029. 수동 Event 추가·정정·지연도착 보고 처리

| **항목**  | **상세 내용**                                                                                                           |
|-----------|-------------------------------------------------------------------------------------------------------------------------|
| 목적      | 전화·구두·외부문서 등 자동기록되지 않은 사실을 수동 Event로 추가하고 오류는 원본을 삭제하지 않고 정정 Event로 보정한다. |
| 주 행위자 | 상황등록자, 지휘자, 일지작성자                                                                                          |
| 선행조건  | Incident 존재                                                                                                           |
| Trigger   | \[수동 기록 추가\]/\[정정\] 선택                                                                                        |
| 입력      | eventType, occurredAt, recordedAt, actor/source, payload, correctionTarget                                              |
| 완료조건  | 원본 삭제 0건, occurred/recordedAt 분리                                                                                 |
| 화면 후보 | SCR-BOARD-004                                                                                                           |

| **\#** | **주체**   | **사용자/시스템 행위**                      | **처리·검증 규칙**                | **결과·상태**     |
|--------|------------|---------------------------------------------|-----------------------------------|-------------------|
| 1      | 사용자     | Event 유형·발생시각·출처·내용을 입력한다.   | recordedAt 자동                   | MANUAL_DRAFT      |
| 2      | 시스템     | 지연도착 여부와 시간역전 경고를 표시한다.   | occurredAt 기준 Timeline 삽입     | VALIDATED         |
| 3      | 사용자     | 정정이면 대상 eventId와 사유를 지정한다.    | 원본 불변                         | CORRECTION_LINKED |
| 4      | 시스템     | MANUAL_EVENT/CORRECTION Event를 append한다. | payloadHash·actor                 | EVENT_APPENDED    |
| 5      | Projection | Timeline/Journal을 재투영하고 변경표시한다. | 기존 승인 일지는 새 revision 필요 | REPROJECTED       |

| **ID** | **조건**  | **처리**                 | **종료/복귀**  |
|--------|-----------|--------------------------|----------------|
| A-01   | 대리입력  | reporter와 recorder 분리 | PROXY_RECORDED |
| A-02   | 취소/무효 | VOID Event로 표시        | VOIDED         |

| **ID** | **오류 조건**                | **사용자 메시지·복구** | **로그·상태**    |
|--------|------------------------------|------------------------|------------------|
| E-01   | 대상 eventId 없음            | 정정 저장 차단         | TARGET_NOT_FOUND |
| E-02   | Finalized 일지 직접변경 시도 | 새 revision 안내       | IMMUTABLE_FINAL  |

| **구분**      | **적용 내용**                                   |
|---------------|-------------------------------------------------|
| 권한          | 등록자/지휘자 추가, 감사자 읽기                 |
| 상태전이      | NONE → EVENT_APPENDED; 원본 → CORRECTED_BY      |
| 주요 데이터   | ExecutionEvent, CorrectionEvent, SourceArtifact |
| 연계/API 후보 | POST /events/manual/correction                  |
| 감사 이벤트   | MANUAL_EVENT_ADDED/EVENT_CORRECTED/VOIDED       |
| 인수기준      | 원본 삭제 0건, occurred/recordedAt 분리         |
| 추적          | ADR-10·12, WP-JOURNAL                           |

## US-SIT-030. 상황일지 생성범위·필터·양식 선택

| **항목**  | **상세 내용**                                                                                  |
|-----------|------------------------------------------------------------------------------------------------|
| 목적      | 사용자가 특정 시간·조직·임무·사건단계의 사실원장을 선택하고 상황일지 양식/표현규칙을 지정한다. |
| 주 행위자 | 상황일지 작성자, 지휘자                                                                        |
| 선행조건  | Snapshot과 ExecutionEvent 존재                                                                 |
| Trigger   | \[상황일지 생성\] 선택                                                                         |
| 입력      | timeRange, eventTypes, organizations, executions, templateProfile, style rules                 |
| 완료조건  | 입력범위·query hash·event count 재현                                                           |
| 화면 후보 | SCR-JRN-001                                                                                    |

| **\#** | **주체** | **사용자/시스템 행위**                             | **처리·검증 규칙**            | **결과·상태**     |
|--------|----------|----------------------------------------------------|-------------------------------|-------------------|
| 1      | 사용자   | 일지 기준시각·시간범위·필터를 선택한다.            | 기본 last generated 이후~현재 | SCOPE_SELECTED    |
| 2      | 시스템   | 포함 Event 수·누락구간·미확정 Fact를 요약한다.     | gap 경고                      | SCOPE_PREVIEW     |
| 3      | 사용자   | HWPX Template Profile 또는 시스템 양식을 선택한다. | 호환성 등급 표시              | TEMPLATE_SELECTED |
| 4      | 사용자   | 시간단위·조직묶음·개조식/표 형식을 설정한다.       | 기관규칙 preset               | OPTIONS_SET       |
| 5      | 시스템   | JournalProjection Job과 입력 Snapshot을 생성한다.  | sourceEventIds query hash     | JOB_CREATED       |

| **ID** | **조건**           | **처리**                    | **종료/복귀** |
|--------|--------------------|-----------------------------|---------------|
| A-01   | 전체 사건 누적일지 | 시작~현재 범위              | FULL_RANGE    |
| A-02   | 증분일지           | 이전 Finalized cut-off 이후 | INCREMENTAL   |

| **ID** | **오류 조건** | **사용자 메시지·복구** | **로그·상태**    |
|--------|---------------|------------------------|------------------|
| E-01   | Event 0건     | 빈 일지 생성 전 확인   | NO_EVENTS        |
| E-02   | 템플릿 REJECT | 다른 양식 선택         | TEMPLATE_INVALID |

| **구분**      | **적용 내용**                                                   |
|---------------|-----------------------------------------------------------------|
| 권한          | 일지작성자 생성, 지휘자 범위승인 정책                           |
| 상태전이      | NONE → SCOPE_READY → PROJECTING                                 |
| 주요 데이터   | JournalRequest, EventQuery, TemplateProfile, ProjectionSnapshot |
| 연계/API 후보 | POST /journals/projections 후보                                 |
| 감사 이벤트   | JOURNAL_SCOPE_DEFINED/JOB_CREATED                               |
| 인수기준      | 입력범위·query hash·event count 재현                            |
| 추적          | ADR-12, WP-JOURNAL/HWPX                                         |

## US-SIT-031. Execution Log 기반 JournalProjection·중복/집계·sourceEventIds 보존

| **항목**  | **상세 내용**                                                                                                        |
|-----------|----------------------------------------------------------------------------------------------------------------------|
| 목적      | 선택 Event를 시간순으로 정규화하고 상태변경·전파·보고를 집계해 사실 항목을 생성하되 모든 원본 Event 연결을 유지한다. |
| 주 행위자 | JournalProjection Engine                                                                                             |
| 선행조건  | Journal Job CREATED                                                                                                  |
| Trigger   | Projection 실행                                                                                                      |
| 입력      | Event query result, snapshot, grouping rules                                                                         |
| 완료조건  | 모든 사실행 sourceEventIds 1개 이상, 허위값 0                                                                        |
| 화면 후보 | SCR-JRN-002                                                                                                          |

| **\#** | **주체** | **사용자/시스템 행위**                                  | **처리·검증 규칙**      | **결과·상태** |
|--------|----------|---------------------------------------------------------|-------------------------|---------------|
| 1      | Engine   | Event를 occurredAt+sequence로 정렬한다.                 | 지연도착 포함           | ORDERED       |
| 2      | Engine   | 중복 idempotency/event lineage를 제거한다.              | 원본 ID 목록 유지       | DEDUPED       |
| 3      | Engine   | 전파-수신-착수-완료 체인을 Task별로 연계한다.           | 상태 누락 표시          | CHAINED       |
| 4      | Engine   | 시간/조직/임무 규칙으로 JournalFactRow를 집계한다.      | 수치·시각은 Event에서만 | FACT_ROWS     |
| 5      | Engine   | 각 행에 sourceEventIds와 snapshot fact refs를 저장한다. | 증거추적                | TRACEABLE     |
| 6      | Engine   | Projection hash와 통계/경고를 저장한다.                 | 동일입력 결정적 결과    | PROJECTED     |

| **ID** | **조건**                      | **처리**                 | **종료/복귀**      |
|--------|-------------------------------|--------------------------|--------------------|
| A-01   | 복수 Event를 한 문장으로 집계 | 모든 sourceEventIds 보존 | AGGREGATED         |
| A-02   | Event gap                     | 불완전 경고행 포함       | PROJECTED_WITH_GAP |

| **ID** | **오류 조건**               | **사용자 메시지·복구** | **로그·상태**      |
|--------|-----------------------------|------------------------|--------------------|
| E-01   | Event payload schema 불일치 | 해당 Event 격리·경고   | PARTIAL_PROJECTION |
| E-02   | 결정성 hash 불일치          | Job 실패·회귀조사      | NON_DETERMINISTIC  |

| **구분**      | **적용 내용**                                      |
|---------------|----------------------------------------------------|
| 권한          | 시스템 자동, 일지작성자 결과검토                   |
| 상태전이      | PROJECTING → PROJECTED/PARTIAL/FAILED              |
| 주요 데이터   | JournalProjection, JournalFactRow, SourceEventLink |
| 연계/API 후보 | Internal JournalProjection Engine                  |
| 감사 이벤트   | JOURNAL_PROJECTED/PROJECTION_WARNING               |
| 인수기준      | 모든 사실행 sourceEventIds 1개 이상, 허위값 0      |
| 추적          | ADR-12, WP-JOURNAL                                 |

## US-SIT-032. 상황일지 AI 표현 생성·사실보호·근거검증

| **항목**  | **상세 내용**                                                                                             |
|-----------|-----------------------------------------------------------------------------------------------------------|
| 목적      | Projection 사실행을 행정문서 문장/표로 표현하되 Snapshot/Event의 값·시각·출처를 변경하지 않도록 검증한다. |
| 주 행위자 | 일지작성자, UNI Adapter, Validator                                                                        |
| 선행조건  | JournalProjection 완료                                                                                    |
| Trigger   | \[문장 생성\]/자동 표현단계                                                                               |
| 입력      | FactRows, style rules, source refs, operation JOURNAL_SUMMARIZE                                           |
| 완료조건  | AI 허위 Fact 0, 모든 문장 source refs                                                                     |
| 화면 후보 | SCR-JRN-002~003                                                                                           |

| **\#** | **주체**       | **사용자/시스템 행위**                       | **처리·검증 규칙**        | **결과·상태** |
|--------|----------------|----------------------------------------------|---------------------------|---------------|
| 1      | Orchestrator   | FactRows와 표현규칙으로 AI 요청을 구성한다.  | 원문 Fact와 금지규칙 포함 | AI_REQUEST    |
| 2      | Gateway        | UNI /chat/ 또는 계약된 operation을 호출한다. | 챗봇 UI 없음              | GENERATING    |
| 3      | Adapter        | 의미 Block과 sourceEventIds 연결을 수신한다. | Schema/길이 검증          | BLOCKS_READY  |
| 4      | Fact Validator | 숫자·시각·명칭·출처를 원 Fact와 비교한다.    | 변경/추정 탐지            | FACT_CHECK    |
| 5      | 시스템         | PASS 문장만 DRAFT JournalEntry로 반영한다.   | 불일치 문장 폐기/경고     | DRAFT_READY   |
| 6      | 사용자         | 문장과 근거를 확인한다.                      | 미확인 배지               | REVIEW        |

| **ID** | **조건**      | **처리**                             | **종료/복귀**   |
|--------|---------------|--------------------------------------|-----------------|
| A-01   | AI 미사용     | 규칙기반 템플릿으로 FactRow 직접표현 | RULE_BASED      |
| A-02   | 표현만 재생성 | FactRows/sourceEventIds 고정         | NARRATIVE_REGEN |

| **ID** | **오류 조건**     | **사용자 메시지·복구**    | **로그·상태**  |
|--------|-------------------|---------------------------|----------------|
| E-01   | Fact 값 변조/추정 | 결과 폐기·사용자 직접편집 | FACT_MUTATION  |
| E-02   | UNI 장애          | 규칙기반/수동편집 지속    | AI_UNAVAILABLE |

| **구분**      | **적용 내용**                                      |
|---------------|----------------------------------------------------|
| 권한          | 일지작성자 요청/검토                               |
| 상태전이      | PROJECTED → GENERATING → DRAFT/REJECTED            |
| 주요 데이터   | JournalEntry, NarrativeBlock, FactValidationReport |
| 연계/API 후보 | POST UNI /chat/ via Gateway                        |
| 감사 이벤트   | JOURNAL_AI_REQUESTED/FACT_VALIDATED/REJECTED       |
| 인수기준      | AI 허위 Fact 0, 모든 문장 source refs              |
| 추적          | ADR-12, SituationContext 1.12/1.16                 |

## US-SIT-033. rhwp 상황일지 직접·선택영역 AI 편집·Diff·Undo

| **항목**  | **상세 내용**                                                                                                                |
|-----------|------------------------------------------------------------------------------------------------------------------------------|
| 목적      | 생성된 상황일지를 rhwp 중앙 편집 Surface에서 직접 수정하고 Cursor/Range/Block/Section AI 편집을 Diff 승인 방식으로 수행한다. |
| 주 행위자 | 상황일지 작성자, 검토자                                                                                                      |
| 선행조건  | Journal DRAFT, Template Profile 준비                                                                                         |
| Trigger   | 문서 편집 또는 AI operation                                                                                                  |
| 입력      | selectionContext, revision, instruction, fact constraints                                                                    |
| 완료조건  | 사실값 보호, 사용자수정 자동손실 0건                                                                                         |
| 화면 후보 | SCR-JRN-003~004                                                                                                              |

| **\#** | **주체**          | **사용자/시스템 행위**                                  | **처리·검증 규칙**            | **결과·상태**     |
|--------|-------------------|---------------------------------------------------------|-------------------------------|-------------------|
| 1      | 사용자            | rhwp에서 문장·표·주석을 직접 편집한다.                  | 편집 Block editedByUser=true  | USER_EDITED       |
| 2      | 사용자            | 범위를 선택해 재작성/간결화/표변환/근거추가를 요청한다. | stable IDs/offset/revision    | AI_REQUESTED      |
| 3      | SelectionResolver | 선택과 base revision을 검증한다.                        | 화면좌표 금지                 | SELECTION_VALID   |
| 4      | Adapter           | AI 결과를 ChangeSet 후보로 변환한다.                    | FactValidator 재검증          | DIFF_READY        |
| 5      | 사용자            | Diff를 적용/취소한다.                                   | 사용자 수정 자동덮어쓰기 금지 | APPLIED/CANCELLED |
| 6      | 시스템            | Undo/Redo·자동저장·command journal을 갱신한다.          | inverse ops                   | REVISION_SAVED    |

| **ID** | **조건**                | **처리**                                                      | **종료/복귀** |
|--------|-------------------------|---------------------------------------------------------------|---------------|
| A-01   | 사용자수정 Block 재생성 | 잠금경고 후 명시적 Override                                   | OVERRIDDEN    |
| A-02   | Fact 문구 수정          | 원 Fact 변경이 아닌 표현편집만 허용; 값변경은 정정 Event 필요 | FACT_LOCKED   |

| **ID** | **오류 조건**     | **사용자 메시지·복구**  | **로그·상태**          |
|--------|-------------------|-------------------------|------------------------|
| E-01   | revision mismatch | Diff 재계산/사용자 병합 | REVISION_CONFLICT      |
| E-02   | AI가 Fact 변경    | ChangeSet 폐기          | FACT_MUTATION_REJECTED |

| **구분**      | **적용 내용**                                              |
|---------------|------------------------------------------------------------|
| 권한          | 일지작성자 편집; 검토자 제안                               |
| 상태전이      | DRAFT revision n → n+1; FINALIZED 직접수정 금지            |
| 주요 데이터   | DocumentIR, SelectionContext, ChangeSet, JournalEntry link |
| 연계/API 후보 | rhwp Adapter, UNI /chat/ operation                         |
| 감사 이벤트   | JOURNAL_USER_EDITED/AI_DIFF_APPLIED/UNDO                   |
| 인수기준      | 사실값 보호, 사용자수정 자동손실 0건                       |
| 추적          | ADR-01~04·12·15, WP-HWPX/JOURNAL                           |

## US-SIT-034. 상황일지 검토·승인·HWPX/PDF/DOCX 저장·자동검증

| **항목**  | **상세 내용**                                                                                                       |
|-----------|---------------------------------------------------------------------------------------------------------------------|
| 목적      | 상황일지의 근거·누락·표현·서식을 검토하고 승인 revision을 HWPX로 보존형 저장하며 보조 Export와 자동검증을 수행한다. |
| 주 행위자 | 일지작성자, 검토자, 승인자, 문서 QA                                                                                 |
| 선행조건  | Journal DRAFT, 필수 경고 해소                                                                                       |
| Trigger   | 검토요청/승인/내보내기                                                                                              |
| 입력      | journalRevision, template/source parts, output formats                                                              |
| 완료조건  | 승인 hash와 artifact hash 연결, 텍스트손실 0                                                                        |
| 화면 후보 | SCR-JRN-004~006                                                                                                     |

| **\#** | **주체**    | **사용자/시스템 행위**                                 | **처리·검증 규칙**        | **결과·상태** |
|--------|-------------|--------------------------------------------------------|---------------------------|---------------|
| 1      | 작성자      | 검토요청을 제출한다.                                   | revision/hash 고정        | IN_REVIEW     |
| 2      | 검토자      | sourceEventIds·Snapshot·수치·누락·정정표시를 확인한다. | 체크리스트                | REVIEWED      |
| 3      | 승인자      | 최종 revision/hash를 승인한다.                         | 권한·재인증               | APPROVED      |
| 4      | HWPX Engine | 원본 Template Prototype을 상속해 HWPX를 저장한다.      | 최소변경·미지원 객체 보존 | SERIALIZED    |
| 5      | Validator   | ZIP/XML/참조/텍스트/표/개요/rhwp 재열기를 검사한다.    | Track A 자동검증          | VALIDATED     |
| 6      | 시스템      | HWPX와 PDF/DOCX 보조 Export·인쇄를 제공한다.           | artifact hash/버전 기록   | FINALIZED     |

| **ID** | **조건**         | **처리**                       | **종료/복귀** |
|--------|------------------|--------------------------------|---------------|
| A-01   | 자동검증 Warning | 조건부 승인/QA 확인 후 제공    | LIMITED       |
| A-02   | 재개정           | Finalized 복제하여 새 revision | REVISED       |

| **ID** | **오류 조건**        | **사용자 메시지·복구**  | **로그·상태**    |
|--------|----------------------|-------------------------|------------------|
| E-01   | 참조/패키지 오류     | HWPX 제공 차단·수정복귀 | EXPORT_FAILED    |
| E-02   | 검토후 revision 변경 | 승인무효·재검토         | REVISION_CHANGED |

| **구분**      | **적용 내용**                                         |
|---------------|-------------------------------------------------------|
| 권한          | 작성자 요청, 검토자 검토, 승인자 확정                 |
| 상태전이      | DRAFT → REVIEW → APPROVED → FINALIZED/REVISED         |
| 주요 데이터   | JournalRevision, Artifact, ValidationReport, Approval |
| 연계/API 후보 | HWPX Serializer, PDF/DOCX Export                      |
| 감사 이벤트   | JOURNAL_APPROVED/EXPORTED/VALIDATION_FAILED           |
| 인수기준      | 승인 hash와 artifact hash 연결, 텍스트손실 0          |
| 추적          | ADR-15·16, WP-JOURNAL/HWPX-QA                         |

## US-SIT-035. 사건·훈련 종료·최종 Snapshot/Execution Log 동결·최종일지

| **항목**  | **상세 내용**                                                                                        |
|-----------|------------------------------------------------------------------------------------------------------|
| 목적      | 종료조건과 미완료임무·미해결 Fact·전파상태를 정리하고 사건을 닫아 최종일지·평가의 기준선을 고정한다. |
| 주 행위자 | 지휘자/훈련통제관, 승인자                                                                            |
| 선행조건  | Execution COMPLETED/TERMINATED, Incident CLOSING                                                     |
| Trigger   | \[사건/훈련 종료\] 선택                                                                              |
| 입력      | 종료시각, 종료사유, pending disposition, final snapshot, final journal                               |
| 완료조건  | 종료시 미결항목·사유 누락 0                                                                          |
| 화면 후보 | SCR-EVAL-001                                                                                         |

| **\#** | **주체** | **사용자/시스템 행위**                                         | **처리·검증 규칙** | **결과·상태**   |
|--------|----------|----------------------------------------------------------------|--------------------|-----------------|
| 1      | 시스템   | 미완료 Task·UNKNOWN 전달·OPEN conflict·미승인 일지를 요약한다. | 종료 Gate          | CLOSE_PREVIEW   |
| 2      | 사용자   | 각 미결항목을 완료/취소/이관/예외승인한다.                     | 사유 필수          | ISSUES_RESOLVED |
| 3      | 시스템   | 최종 Snapshot 필요 여부와 최종 Journal을 확인한다.             | hash 고정          | FINAL_BASELINE  |
| 4      | 승인자   | 종료를 승인한다.                                               | 재인증/권한        | CLOSE_APPROVED  |
| 5      | 시스템   | INCIDENT_CLOSED Event와 종료 hash를 기록한다.                  | append-only        | CLOSED          |
| 6      | 시스템   | 보존·삭제·평가 Workflow를 시작한다.                            | scope별 retention  | POST_CLOSE      |

| **ID** | **조건**      | **처리**                                     | **종료/복귀**        |
|--------|---------------|----------------------------------------------|----------------------|
| A-01   | 사후보고 예정 | 종료 후 late event 허용+최종일지 재개정 정책 | CLOSED_WITH_FOLLOWUP |
| A-02   | 훈련 조기종료 | TERMINATED 사유와 범위 기록                  | TERMINATED           |

| **ID** | **오류 조건** | **사용자 메시지·복구** | **로그·상태**        |
|--------|---------------|------------------------|----------------------|
| E-01   | 필수 미결항목 | 종료차단 또는 승인예외 | CLOSE_BLOCKED        |
| E-02   | 동시 종료요청 | idempotency 처리       | DUPLICATE_SUPPRESSED |

| **구분**      | **적용 내용**                                                   |
|---------------|-----------------------------------------------------------------|
| 권한          | 지휘자/통제관 요청, 승인자 A                                    |
| 상태전이      | CLOSING → CLOSED                                                |
| 주요 데이터   | ClosureRecord, FinalSnapshotRef, FinalJournalRef, RetentionPlan |
| 연계/API 후보 | POST /incidents/{id}/close                                      |
| 감사 이벤트   | INCIDENT_CLOSED/RETENTION_STARTED                               |
| 인수기준      | 종료시 미결항목·사유 누락 0                                     |
| 추적          | WP-WORKFLOW/JOURNAL                                             |

## US-SIT-036. 안전한국훈련 평가·체크포인트·개선조치 환류

| **항목**  | **상세 내용**                                                                                                        |
|-----------|----------------------------------------------------------------------------------------------------------------------|
| 목적      | 훈련 종료 후 실행이력·지연·분기·보고·만족도와 통제관 관찰을 결합해 평가서와 개선조치를 만들고 SOP/계획서에 환류한다. |
| 주 행위자 | 훈련통제관, 평가자, 참여기관, 승인자                                                                                 |
| 선행조건  | TRAINING Incident CLOSED                                                                                             |
| Trigger   | \[평가 시작\] 선택                                                                                                   |
| 입력      | 평가지표, 체크포인트, 기대값, 관찰, 설문, Execution Log                                                              |
| 완료조건  | 모든 평가결론 근거 연결, 개선책 책임/기한                                                                            |
| 화면 후보 | SCR-EVAL-001~004                                                                                                     |

| **\#** | **주체** | **사용자/시스템 행위**                              | **처리·검증 규칙**                        | **결과·상태**     |
|--------|----------|-----------------------------------------------------|-------------------------------------------|-------------------|
| 1      | 시스템   | 훈련 KPI를 산출한다.                                | 전파/수신/착수/완료 시간, 시나리오 성공률 | METRICS_READY     |
| 2      | 평가자   | Inject별 기대행동과 실제 Event를 비교한다.          | sourceEventIds                            | CHECKPOINT_REVIEW |
| 3      | 참여자   | 활용성·잠재가치·가능성 중심 만족도/의견을 제출한다. | 개인정보 최소화                           | SURVEY_COLLECTED  |
| 4      | 평가자   | 문제·원인·개선안을 작성한다.                        | 근거 Event/화면/문서 연결                 | ISSUES_IDENTIFIED |
| 5      | 승인자   | 평가서와 개선조치를 승인한다.                       | 책임자·기한 지정                          | ACTIONS_APPROVED  |
| 6      | 시스템   | SOP/Scenario Pack/계획서 개선 Backlog를 생성한다.   | 자동변경 금지                             | FEEDBACK_LINKED   |

| **ID** | **조건**        | **처리**                | **종료/복귀** |
|--------|-----------------|-------------------------|---------------|
| A-01   | 평가자료 부족   | 정성평가+자료부족 명시  | LIMITED_EVAL  |
| A-02   | 기관별 분리평가 | 공통/기관별 결과를 분리 | MULTI_ORG     |

| **ID** | **오류 조건**        | **사용자 메시지·복구** | **로그·상태**       |
|--------|----------------------|------------------------|---------------------|
| E-01   | KPI 분모 0           | N/A 처리·사유표시      | METRIC_NA           |
| E-02   | 평가중 원 Event 정정 | 영향표시·재산출        | METRIC_RECALCULATED |

| **구분**      | **적용 내용**                                                  |
|---------------|----------------------------------------------------------------|
| 권한          | 평가자 작성, 승인자 확정                                       |
| 상태전이      | NOT_STARTED → COLLECTING → REVIEW → APPROVED → ACTION_TRACKING |
| 주요 데이터   | EvaluationRecord, Metric, CheckpointResult, ImprovementAction  |
| 연계/API 후보 | Evaluation Engine, Survey                                      |
| 감사 이벤트   | EVALUATION_STARTED/METRIC_CALCULATED/ACTION_APPROVED           |
| 인수기준      | 모든 평가결론 근거 연결, 개선책 책임/기한                      |
| 추적          | ADR-18, 6/19 회의록, WP-SCENARIO                               |

## US-SIT-037. 자연재난 Reference E2E: 태풍·호우 안전한국훈련

| **항목**  | **상세 내용**                                                                                                    |
|-----------|------------------------------------------------------------------------------------------------------------------|
| 목적      | 태풍·호우 기준 Scenario Pack으로 SituationSnapshot부터 SOP·전파·전자상황판·상황일지·평가까지 전 구간을 검증한다. |
| 주 행위자 | 훈련통제관, 지자체 상황실, 현장담당자, 평가자                                                                    |
| 선행조건  | 자연재난 Scenario Pack·가상 기관 Binding                                                                         |
| Trigger   | 훈련 시작                                                                                                        |
| 입력      | KMA 모의/실제 후보, 호우특보, 하천/침수 Inject, 대피/통제 SOP                                                    |
| 완료조건  | 핵심 경로 성공, 허위 Fact 0, 지연·실패 복구 증거                                                                 |
| 화면 후보 | 부록 A, 전 화면                                                                                                  |

| **\#** | **주체**      | **사용자/시스템 행위**                              | **처리·검증 규칙**         | **결과·상태** |
|--------|---------------|-----------------------------------------------------|----------------------------|---------------|
| 1      | 통제관        | 태풍·호우 훈련 기본정보와 예상경로/특보를 등록한다. | TRAINING 표식              | REGISTERED    |
| 2      | 사용자        | 기상·특보 후보를 검토해 Snapshot을 확정한다.        | 모의 Fact와 공식 Fact 구분 | SNAPSHOT      |
| 3      | 시스템/사용자 | 훈련계획·메시지·매뉴얼로 SOP를 생성·승인한다.       | 근거·Graph 검증            | SOP_READY     |
| 4      | 통제관        | 침수우려/통제/대피 Inject를 투입한다.               | 예정/실제시각              | INJECTED      |
| 5      | 담당자        | 수신·착수·현장보고·완료를 수행한다.                 | 사진/통제 Fact             | EXECUTED      |
| 6      | 시스템        | 전자상황판·상황일지를 생성한다.                     | Event 기반                 | JOURNAL       |
| 7      | 평가자        | 체크포인트와 개선사항을 확정한다.                   | 시나리오 성공률            | EVALUATED     |

| **ID** | **조건**         | **처리**                      | **종료/복귀** |
|--------|------------------|-------------------------------|---------------|
| A-01   | KMA 장애         | 모의 Fact/사용자입력으로 계속 | FALLBACK      |
| A-02   | 추가 강우 Inject | 새 Snapshot v2와 SOP branch   | ESCALATED     |

| **ID** | **오류 조건**    | **사용자 메시지·복구** | **로그·상태**       |
|--------|------------------|------------------------|---------------------|
| E-01   | 대피임무 미수신  | Escalation·재전파 기대 | TEST_FAIL/RECOVERED |
| E-02   | 일지 Fact 불일치 | 인수 실패              | ACCEPTANCE_FAIL     |

| **구분**      | **적용 내용**                                         |
|---------------|-------------------------------------------------------|
| 권한          | 훈련 역할별                                           |
| 상태전이      | E2E 단계별 상태                                       |
| 주요 데이터   | ScenarioPack-NAT, Inject, ExpectedEvent, TestEvidence |
| 연계/API 후보 | Provider Stub+Workflow+Channel+Journal                |
| 감사 이벤트   | E2E_NAT\_\*                                           |
| 인수기준      | 핵심 경로 성공, 허위 Fact 0, 지연·실패 복구 증거      |
| 추적          | ADR-18, SIT-E2E 전체                                  |

## US-SIT-038. 사회재난 Reference E2E: 다중밀집건축물 폭발·붕괴 의심

| **항목**  | **상세 내용**                                                                                                         |
|-----------|-----------------------------------------------------------------------------------------------------------------------|
| 목적      | 1층 광장 폭발음·흔들림·부상자 발생 메시지를 기반으로 소방·경찰·시민안전·현장지휘 임무와 정기보고·종료평가를 검증한다. |
| 주 행위자 | 훈련통제관, 소방/경찰/시민안전 역할, 현장지휘부, 평가자                                                               |
| 선행조건  | 사회재난 Scenario Pack, 조직/역할 가상 Binding                                                                        |
| Trigger   | ST-001 훈련메시지 투입                                                                                                |
| 입력      | 폭발/붕괴 의심, 부상 2명 추정, 영상 제공, 통제/구조/의료/보고 임무                                                    |
| 완료조건  | 기관별 임무수신·완료·정기보고·종료평가 성공                                                                           |
| 화면 후보 | 부록 B/C, 전 화면                                                                                                     |

| **\#** | **주체**     | **사용자/시스템 행위**                           | **처리·검증 규칙**   | **결과·상태**    |
|--------|--------------|--------------------------------------------------|----------------------|------------------|
| 1      | 통제관       | ST-001 메시지를 Inject한다.                      | “훈련” 표식·수신그룹 | MESSAGE_INJECTED |
| 2      | 시스템       | 현장지휘부 구축·초기대응 SOP를 활성화한다.       | 통신망/상황공유      | COMMAND_SETUP    |
| 3      | 소방역할     | 구조·진입·화재위험·부상자 구호 임무를 수행한다.  | 완료증거             | FIRE_TASKS       |
| 4      | 경찰역할     | 통제인력·CCTV·용의자/위험분석 임무를 수행한다.   | 현장보고             | POLICE_TASKS     |
| 5      | 시민안전역할 | 주민대피·안전안내·오보차단·의료연계를 수행한다.  | 다채널               | SAFETY_TASKS     |
| 6      | 상황실       | 2~3분 간격 긴급보고·종결/평가 메시지를 관리한다. | 중복/누락검증        | REPORTING        |
| 7      | 시스템       | 전자상황판·일지·평가서를 생성한다.               | Event lineage        | EVALUATED        |

| **ID** | **조건**             | **처리**                  | **종료/복귀** |
|--------|----------------------|---------------------------|---------------|
| A-01   | 추가 붕괴위험 Inject | 위험구역 확대·대피 branch | ESCALATED     |
| A-02   | 현장통신 불가        | 대체채널/대리입력         | FALLBACK      |

| **ID** | **오류 조건**            | **사용자 메시지·복구** | **로그·상태**    |
|--------|--------------------------|------------------------|------------------|
| E-01   | 기관 역할 미매핑         | 통제관 임시 Binding    | MAPPING_REQUIRED |
| E-02   | 훈련메시지 실채널 오발송 | 즉시중단·보안사고 절차 | SAFETY_INCIDENT  |

| **구분**      | **적용 내용**                                    |
|---------------|--------------------------------------------------|
| 권한          | 훈련 역할별                                      |
| 상태전이      | E2E 단계별 상태                                  |
| 주요 데이터   | ScenarioPack-SOC, ST-001, RoleTasks, ReportCycle |
| 연계/API 후보 | Simulation/System Channel, Workflow, Journal     |
| 감사 이벤트   | E2E_SOC\_\*                                      |
| 인수기준      | 기관별 임무수신·완료·정기보고·종료평가 성공      |
| 추적          | ADR-18, 안전한국훈련 SOP 예시                    |

## US-SIT-039. Provider·UNI·채널 장애 복구와 수동 운영 지속

| **항목**  | **상세 내용**                                                                                                     |
|-----------|-------------------------------------------------------------------------------------------------------------------|
| 목적      | 외부 Provider, UNI RAG, 메시지 채널, 실시간 스트림 장애 시 핵심 상황등록·수동 SOP·기존 실행·일지 편집을 유지한다. |
| 주 행위자 | 사용자, 관리자, 시스템                                                                                            |
| 선행조건  | 각 외부 연계 사용 중                                                                                              |
| Trigger   | Timeout/5xx/Circuit open/stream disconnect                                                                        |
| 입력      | 오류종류, 재시도정책, fallback option                                                                             |
| 완료조건  | 단일 외부장애로 핵심 업무 전면중단 0                                                                              |
| 화면 후보 | 공통 오류 UI                                                                                                      |

| **\#** | **주체**        | **사용자/시스템 행위**                                                   | **처리·검증 규칙**   | **결과·상태**    |
|--------|-----------------|--------------------------------------------------------------------------|----------------------|------------------|
| 1      | 시스템          | 오류를 연계구간별로 분류하고 correlationId를 부여한다.                   | 사용자 메시지 표준화 | ERROR_CLASSIFIED |
| 2      | Circuit Breaker | 일시/지속 장애에 따라 재시도·Open을 적용한다.                            | 무한재시도 금지      | RETRY/OPEN       |
| 3      | UI              | 영향범위와 가능한 수동대안을 제시한다.                                   | 입력/편집 보존       | FALLBACK_OFFERED |
| 4      | 사용자          | 사용자입력·수동 SOP·System Channel·규칙기반 일지를 선택한다.             | 기존 실행 중단 금지  | MANUAL_CONTINUE  |
| 5      | 시스템          | 연계 복구 후 재동기화하되 기존 Snapshot/Execution을 자동변경하지 않는다. | 새 후보/결과로 제시  | RECOVERED        |
| 6      | 관리자          | 장애·복구·데이터차이를 검토한다.                                         | 운영보고             | CLOSED           |

| **ID** | **조건**      | **처리**                    | **종료/복귀** |
|--------|---------------|-----------------------------|---------------|
| A-01   | 부분장애      | 성공 Provider/채널만 계속   | DEGRADED      |
| A-02   | 오프라인 현장 | 로컬 큐 후 순서/중복 동기화 | SYNCED        |

| **ID** | **오류 조건**         | **사용자 메시지·복구**                         | **로그·상태**  |
|--------|-----------------------|------------------------------------------------|----------------|
| E-01   | 재동기화 충돌         | 사용자 병합/정정 Event                         | SYNC_CONFLICT  |
| E-02   | 복구 후 중복송신 위험 | providerMessageId/idempotency 확인 후 확인대화 | DUPLICATE_RISK |

| **구분**      | **적용 내용**                                         |
|---------------|-------------------------------------------------------|
| 권한          | 사용자는 fallback, 관리자는 설정/복구                 |
| 상태전이      | NORMAL → DEGRADED/OFFLINE → RECOVERED                 |
| 주요 데이터   | CircuitState, RetryRecord, OfflineQueue, SyncConflict |
| 연계/API 후보 | ProviderPort/UNI/ChannelPort/Event Stream             |
| 감사 이벤트   | INTEGRATION_FAILED/FALLBACK_USED/RECOVERED            |
| 인수기준      | 단일 외부장애로 핵심 업무 전면중단 0                  |
| 추적          | ADR-11~14·17, WP-INTEGRATION-QA                       |

## US-SIT-040. 개인정보·보안·감사·보존·기관 Binding 통제

| **항목**  | **상세 내용**                                                                                           |
|-----------|---------------------------------------------------------------------------------------------------------|
| 목적      | 연락처·현장사진·문서·메시지·감사로그의 최소수집·마스킹·접근권한·보존기간과 실증기관 Binding을 통제한다. |
| 주 행위자 | 시스템 관리자, 조직관리자, 감사자, 보안담당                                                             |
| 선행조건  | 기관 설정 또는 실증 Binding                                                                             |
| Trigger   | 설정변경/감사조회/보존만료                                                                              |
| 입력      | 기관, 역할, 연락처, 채널, retention, redaction, audit query                                             |
| 완료조건  | PII 평문로그 0, 권한누락 0, 기관전환 설정만으로 가능                                                    |
| 화면 후보 | SCR-ADMIN-001~004                                                                                       |

| **\#** | **주체** | **사용자/시스템 행위**                                           | **처리·검증 규칙**              | **결과·상태**      |
|--------|----------|------------------------------------------------------------------|---------------------------------|--------------------|
| 1      | 관리자   | 기관·조직·역할·채널·Provider Binding을 설정한다.                 | 환경별 Feature Flag/Secret 분리 | BINDING_DRAFT      |
| 2      | 보안검증 | 연락처·토큰·첨부·로그의 암호화/마스킹 정책을 검증한다.           | 최소권한                        | SECURITY_VALIDATED |
| 3      | 관리자   | 보존기간과 삭제/승격 정책을 설정한다.                            | 법적/과제정책                   | RETENTION_SET      |
| 4      | 시스템   | 만료자료를 삭제/비식별/보존홀드한다.                             | 감사 Event                      | RETENTION_EXECUTED |
| 5      | 감사자   | actor/time/revision/sourceHash/message/event lineage를 조회한다. | 읽기전용·민감정보 redaction     | AUDIT_VIEW         |
| 6      | 승인자   | 기관 Binding Gate를 승인한다.                                    | 자연/사회 시나리오 양쪽 검증    | BINDING_APPROVED   |

| **ID** | **조건**      | **처리**                                 | **종료/복귀** |
|--------|---------------|------------------------------------------|---------------|
| A-01   | 실증기관 미정 | 기관독립 Scenario Pack+가상 Binding 유지 | UNBOUND       |
| A-02   | 법적보존 Hold | 삭제대상에서 제외·사유/기한              | LEGAL_HOLD    |

| **ID** | **오류 조건**           | **사용자 메시지·복구**      | **로그·상태**   |
|--------|-------------------------|-----------------------------|-----------------|
| E-01   | 과도한 권한/평문 Secret | 승인차단                    | SECURITY_BLOCK  |
| E-02   | 삭제 실패               | 재시도·관리자 Critical 알림 | RETENTION_ERROR |

| **구분**      | **적용 내용**                                                           |
|---------------|-------------------------------------------------------------------------|
| 권한          | Admin 설정, 보안/승인자 승인, Auditor 읽기                              |
| 상태전이      | DRAFT → VALIDATED → APPROVED/REJECTED                                   |
| 주요 데이터   | InstitutionBinding, RoleBinding, SecretRef, RetentionPolicy, AuditEvent |
| 연계/API 후보 | Vault, IAM, FileStore lifecycle                                         |
| 감사 이벤트   | BINDING_CHANGED/RETENTION_EXECUTED/AUDIT_ACCESSED                       |
| 인수기준      | PII 평문로그 0, 권한누락 0, 기관전환 설정만으로 가능                    |
| 추적          | ADR-17·18, WP-PLATFORM/SCENARIO/QA                                      |

# 8. 공통 대체·예외·복구 정책

| **구간**        | **기본 Timeout/Retry**                   | **Fallback/복구**                   | **사용자 작업 보존**     |
|-----------------|------------------------------------------|-------------------------------------|--------------------------|
| KMA/MOIS        | 연결 3초·전체 10초·2회 backoff           | SafeKorea/사용자입력                | Context DRAFT 유지       |
| SafeKorea/Naver | 전체 10초·1회, Parser 실패 자동반복 금지 | 외부 링크/수동입력                  | 기존 후보 유지           |
| UNI Upload      | 업로드 60초, 처리 비동기                 | 재시도/파일제외                     | 사건/Snapshot 유지       |
| UNI Reference   | 최대 5분 폴링                            | 참조요약 없이 Search 가능 여부 판정 | 파일상태 표시            |
| UNI Search      | 30초·1회                                 | 선택자료 직접 Context/수동 SOP      | Evidence 선택 유지       |
| UNI chat/json   | 첫 이벤트 30초·전체 5분                  | 부분결과 폐기/수동 SOP              | SOP 편집본 유지          |
| UNI chat        | 전체 2분                                 | 규칙기반/직접편집                   | 사용자 편집 유지         |
| Channel         | 채널별 backoff·최대횟수                  | 다른 채널/System/수동연락           | Task/Outbox lineage 유지 |
| Event Stream    | 재연결+lastSequence                      | 폴링/불완전 배지                    | 원 Event 유지            |
| HWPX 저장       | 1회 재시도                               | DOCX/PDF 보조·편집본 유지           | Document revision 유지   |

## 8.2 오류 심각도와 사용자 조치

| **등급** | **예시**                                   | **시스템 처리**           | **사용자 조치**    |
|----------|--------------------------------------------|---------------------------|--------------------|
| INFO     | Provider 일부 미선택, 자동저장             | 업무 지속                 | 확인 없음/선택     |
| WARNING  | STALE Fact, 근거없음, 수신자 미매핑        | 승인 Gate 또는 명시확인   | 검토·수정·예외수용 |
| ERROR    | UNI 실패, HWPX 검증실패, Task 전이오류     | 해당 기능 중단·데이터보존 | 재시도/수동/관리자 |
| CRITICAL | 훈련메시지 실발송, 권한침해, 사실원장 손상 | 실행차단·보안알림         | 즉시중지·사고대응  |

# 9. 메시지·알림·감사 이벤트 카탈로그

## 9.1 사용자 메시지

| **코드**   | **상황**               | **메시지 원칙/예시**                                                               |
|------------|------------------------|------------------------------------------------------------------------------------|
| SIT-W-001  | 외부조회 부분실패      | “일부 외부정보를 불러오지 못했습니다. 사용자 입력만으로 계속할 수 있습니다.”       |
| SIT-W-002  | STALE/보조출처         | “최신성이 낮거나 보조 출처입니다. 원문과 조회시각을 확인해 주세요.”                |
| SIT-E-001  | Snapshot revision 충돌 | “다른 사용자가 상황정보를 변경했습니다. 최신 내용을 검토한 뒤 다시 확정해 주세요.” |
| SOP-E-001  | Graph 승인불가         | “시작·종료·분기·담당자 또는 연결이 완전하지 않아 승인할 수 없습니다.”              |
| PROP-W-001 | 전달상태 UNKNOWN       | “전달 여부를 확인할 수 없습니다. 중복 발송 가능성을 확인한 후 재전파해 주세요.”    |
| TASK-W-001 | 기한초과               | “임무 확인/착수/완료 기한이 지났습니다. 재전파 또는 재배정을 검토해 주세요.”       |
| JRN-E-001  | AI 사실불일치          | “생성 문장이 확정 사실과 일치하지 않아 반영하지 않았습니다.”                       |
| HWPX-E-001 | 저장검증 실패          | “HWPX 검증에 실패했습니다. 편집내용은 보존되며 수정 후 다시 저장할 수 있습니다.”   |
| SEC-C-001  | 훈련 실채널 위험       | “훈련 모드에서 실제 외부 채널 발송이 감지되어 실행을 중단했습니다.”                |

## 9.2 주요 감사 이벤트

| **분류** | **이벤트**                                                       |
|----------|------------------------------------------------------------------|
| AUD-01   | INCIDENT_DRAFT_CREATED                                           |
| AUD-02   | INCIDENT_REGISTERED                                              |
| AUD-03   | PROVIDER_QUERY_STARTED/COMPLETED/FAILED                          |
| AUD-04   | FACT_NORMALIZED/SELECTED/CORRECTED                               |
| AUD-05   | SNAPSHOT_CONFIRMED                                               |
| AUD-06   | DOCUMENT_UPLOAD_QUEUED/READY/ERROR                               |
| AUD-07   | EVIDENCE_FROZEN                                                  |
| AUD-08   | SOP_GENERATION_STARTED/DONE/FAILED                               |
| AUD-09   | SOP_REVISION_SAVED/APPROVED                                      |
| AUD-10   | EXECUTION_STARTED/PAUSED/RESUMED/TERMINATED/COMPLETED            |
| AUD-11   | MESSAGE_OUTBOXED/SENT/FAILED/RETRY                               |
| AUD-12   | TASK_RECEIVED/ACKNOWLEDGED/STARTED/PROGRESS/COMPLETED/REASSIGNED |
| AUD-13   | DECISION_MADE                                                    |
| AUD-14   | FIELD_REPORT_SUBMITTED                                           |
| AUD-15   | EVENT_CORRECTED                                                  |
| AUD-16   | JOURNAL_PROJECTED/AI_REJECTED/APPROVED/EXPORTED                  |
| AUD-17   | EVALUATION_APPROVED                                              |
| AUD-18   | BINDING_CHANGED/RETENTION_EXECUTED                               |

# 10. E2E·인수시험 시나리오

| **ID**     | **시나리오**                    | **합격 기준**                  |
|------------|---------------------------------|--------------------------------|
| SIT-E2E-01 | 사용자 입력만으로 Snapshot 확정 | 외부장애에도 등록·확정 가능    |
| SIT-E2E-02 | KMA 특보+MOIS 문자 조회/선택    | 출처·시각·freshness 유지       |
| SIT-E2E-03 | SafeKorea DOM 변경              | 파서 실패 감지·수동 fallback   |
| SIT-E2E-04 | Naver 사용자 요청형             | Feature Flag·출처·캐시·격리    |
| SIT-E2E-05 | 충돌 Fact 수정/확정             | 원본/파생 모두 추적            |
| SIT-E2E-06 | 업로드→READY→Search             | doc_id·Evidence 연결           |
| SIT-E2E-07 | chat/json SSE→Graph             | 노드 스트리밍·최종검증         |
| SIT-E2E-08 | SOP 승인→전파→완료              | Execution Log 시간순 축적      |
| SIT-E2E-09 | Snapshot+Log→일지               | AI 허위 Fact 0·근거추적        |
| SIT-E2E-10 | UNI 장애                        | 수동 SOP/일지·기존 실행 지속   |
| SIT-E2E-11 | 채널 부분장애                   | Outbox·재시도·대체채널·lineage |
| SIT-E2E-12 | 기한초과 Escalation             | 재전파·재배정·전자상황판       |
| SIT-E2E-13 | 자연재난 태풍·호우              | Reference Scenario 전 구간     |
| SIT-E2E-14 | 사회재난 폭발·붕괴 의심         | 기관 역할별 임무·정기보고·평가 |
| SIT-E2E-15 | HWPX 상황일지                   | 자동검증·한컴 QA 기준선        |
| SIT-E2E-16 | 기관 Binding 교체               | 코드변경 없이 설정 전환        |

## 10.2 인수 완료조건

• 모든 확정 SituationSnapshot이 선택 Fact와 hash, confirmer, contextRevision을 보유한다.

• 승인 SOP의 시작·종료·행동·판단·분기·담당·완료조건·sourceRefs가 유효하다.

• 전파·수신·착수·완료·정정·중지 이벤트가 append-only Execution Log에 누락 없이 기록된다.

• 전자상황판의 모든 Timeline/KPI가 sourceEventIds 또는 원 Event로 drill-down 가능하다.

• 상황일지의 모든 사실행·문장이 Snapshot/ExecutionEvent 근거를 보유하며 AI 허위 Fact가 0건이다.

• UNI/Provider/채널 단일 장애에도 수동 운영과 기존 실행이 지속된다.

• 자연재난 1종·사회재난 1종 Reference Scenario가 기관독립 Binding으로 통과한다.

• HWPX 최종 산출물이 자동검증을 통과하고 배포후보에서는 한컴 호환성 Round-trip 증거를 보유한다.

# 11. 요구사항·ADR·WBS·화면·API·시험 추적

| **기능군**               | **요구/ADR**             | **WBS**                 | **Scenario**   | **화면 후보**                    | **시험**         |
|--------------------------|--------------------------|-------------------------|----------------|----------------------------------|------------------|
| 상황등록/Fact/Snapshot   | ADR-08·11·14             | WP-SITUATION            | US-SIT-003~008 | SCR-SIT-003~007                  | SIT-E2E-01~05    |
| UNI 자료/RAG/SOP 생성    | ADR-06·12·13             | WP-UNI-RAG              | US-SIT-009~013 | SCR-SIT-008~010, SCR-SOP-001~003 | SIT-E2E-06~07    |
| SOP 편집/승인/시뮬레이션 | UFR-SOP-02~17, ADR-18    | WP-WORKFLOW/SCENARIO    | US-SIT-014~017 | SCR-SOP-003~007                  | SIM/E2E          |
| 전파/수신/임무           | ADR-07·17, UFR-SOP-18~20 | WP-PROPAGATION/WORKFLOW | US-SIT-018~027 | SCR-SOP-008~010, SCR-TASK        | SIT-E2E-08·11·12 |
| 전자상황판/Execution Log | ADR-10·12                | WP-WORKFLOW/UI          | US-SIT-028~029 | SCR-BOARD                        | SIT-E2E-08       |
| 상황일지/HWPX            | ADR-12·15·16             | WP-JOURNAL/HWPX         | US-SIT-030~035 | SCR-JRN                          | SIT-E2E-09·15    |
| 평가/환류/실증           | ADR-18, 단계평가/회의록  | WP-SCENARIO/QA          | US-SIT-036~040 | SCR-EVAL/ADMIN                   | SIT-E2E-13·14·16 |

# 12. 후속 화면설계/API·DB·Sequence 입력사항

## 12.1 화면설계 필수 입력

• 화면별 Scenario ID, Actor/권한, 진입조건, 정상·로딩·빈값·부분성공·오류·읽기전용·동시수정 상태를 정의한다.

• Situation 후보카드는 출처, 원문링크, observed/issued/retrievedAt, freshness, 신뢰도, 선택/수정/제외를 표시한다.

• SOP Canvas는 node type, 연결, Task/Decision/Propagation 속성, sourceRefs, validation warning, revision/Diff를 표시한다.

• 현장 임무 화면은 훈련/실제 표식, 임무·기한·완료조건·수신/착수/진행/완료·첨부·지원요청을 최소 단계로 제공한다.

• 전자상황판은 사건 고정문맥, Timeline, 조직/임무 KPI, 채널상태, 지연/실패, 원 Event drill-down을 제공한다.

• 상황일지 Workspace는 범위/양식, FactRow/문장/근거, rhwp 편집, 검토/승인, Export/검증상태를 연결한다.

## 12.2 API·DB·Sequence 필수 입력

| **영역** | **필수 상세화**                                                                                                                                        |
|----------|--------------------------------------------------------------------------------------------------------------------------------------------------------|
| API      | Incident/Context/Fact/Conflict/Snapshot, Document/Evidence, SOP/Execution/Task, Propagation/Outbox, Event/Board, Journal/Evaluation OpenAPI와 오류코드 |
| DB       | 불변/가변 구분, PK/FK/unique/idempotency, revision/hash, append-only Event, source provenance, retention/PII                                           |
| Sequence | 상황조회·Snapshot, UNI Upload/Search/SSE, SOP 승인/실행, Outbox 송신/수신, Task 상태전이, Journal Projection/AI/Diff/HWPX                              |
| 상태     | 명령 사전조건, 허용전이, 동시성/낙관잠금, 재시도·보상·Circuit Breaker                                                                                  |
| 시험     | Scenario step와 API call·DB mutation·Event·UI state·감사증거의 1:1 Trace                                                                               |

# 부록 A. 자연재난 Reference Scenario Pack: 태풍·호우

| **구성**    | **상세**                                                                                    |
|-------------|---------------------------------------------------------------------------------------------|
| 기본상황    | 태풍 접근 및 호우특보, 취약지역 침수우려, 하천수위 상승, 도로통제 가능성                    |
| 주요 역할   | 상황총괄, 기상/하천 모니터링, 교통통제, 대피지원, 현장점검, 홍보/재난문자                   |
| Inject 예시 | 특보 발효, 시간당 강우 증가, 저지대 침수신고, 하천범람 우려, 대피소 개방, 통제구간 확대     |
| 필수 임무   | 상황판단회의, 취약지역 점검, 통제/대피, 자원배치, 유관기관 전파, 정기 상황보고              |
| 기대 Event  | MESSAGE_SENT/ACK, TASK_STARTED/COMPLETED, FIELD_REPORT, DECISION_MADE, SNAPSHOT_V2, JOURNAL |
| 평가지표    | 최초전파시간, 수신확인율, 착수/완료시간, 지연임무, 분기적정성, 일지 사실정확성              |

| **업무 흐름 태풍/호우 후보조회 → Snapshot v1 → SOP 승인 → 특보 Inject → 점검·통제·대피 → Snapshot v2 → 상황일지 → 평가** |
|--------------------------------------------------------------------------------------------------------------------------|

# 부록 B. 사회재난 Reference Scenario Pack: 다중밀집건축물 폭발·붕괴 의심

| **구성**      | **상세**                                                                                            |
|---------------|-----------------------------------------------------------------------------------------------------|
| 초기 메시지   | ST-001: 1층 광장에서 폭발음·흔들림 감지, 부상자 2명 추정, 소방·경찰 즉시 출동과 영상 제공 협조 요청 |
| 현장지휘      | 2층 종합상황실 등 가상 위치, 소방/경찰/시민안전/시설관리/의료 역할                                  |
| 소방 임무     | 인력·장비 출동, 구조도구, 화재위험·진입점검, 부상자 구조·구급소 이송                                |
| 경찰 임무     | 주변차단·통제인력, CCTV 확보/분석, 용의자·위험수색, 추가위험 발견 시 순찰 강화                      |
| 시민안전 임무 | 주민 대피유도·안전안내, 보도/SNS 통합, 오보차단, 의료기관·응급센터 연계                             |
| 보고 주기     | 초기 긴급보고 후 2~3분 간격 갱신, 인명피해·구조진행·위험요소·요청사항                               |
| 종료/평가     | 통제관 종결메시지, 기관별 수행결과, 현장지휘본부-종합평가 보고                                      |

# 부록 C. 안전한국훈련 SOP 콘텐츠 예시 적용

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/06_SITUATION_EXERCISE_SCENARIOS_v1.0/media/image1.png" style="width:5.75in;height:9.40764in" />

그림 C-1. 사용자 제공 안전한국훈련 SOP 콘텐츠 예시: 메시지 수신 → 현장지휘부 → 기관별 임무 → 정기보고 → 종료·평가

| **예시 요소**    | **설계 반영**                                                                          |
|------------------|----------------------------------------------------------------------------------------|
| 메시지 중심 전파 | Inject/PropagationMessage/Outbox와 훈련표식으로 모델링                                 |
| 기관별 임무      | Role Task Template과 Institution Binding으로 소방·경찰·시민안전 임무 구성              |
| 정기 보고        | Timer/SLA 기반 반복 Task 및 JournalProjection 입력 Event                               |
| 현장지휘부       | Command Setup Task와 전자상황판 조직/역할 뷰                                           |
| 훈련 종료·평가   | Execution 종료, 최종일지, Checkpoint/Metric/ImprovementAction                          |
| 보완 필요        | 화면 출력용 ASCII 플로차트를 실제 실행 가능한 DAG·상태·근거·수신자·완료조건으로 구조화 |

# 부록 D. 용어·상태·ID 규칙

| **구분**         | **규칙/예시**                                                                                  |
|------------------|------------------------------------------------------------------------------------------------|
| Incident ID      | INC-{ULID}; 실제/훈련 mode는 별도 필드이며 ID 재사용 금지                                      |
| Context/Snapshot | SCTX-{ULID}, SS-{ULID}; Snapshot은 불변                                                        |
| Fact/Conflict    | FACT-{ULID}, CFLT-{ULID}; derived Fact는 originalFactId 필수                                   |
| SOP/Execution    | SOP-{ULID}:vN, EXE-{ULID}; 실행은 특정 SOP version/hash 고정                                   |
| Task/Message     | TASK-{ULID}, MSG-{ULID}; parent/child·idempotencyKey 보존                                      |
| ExecutionEvent   | EVT-{ULID}; occurredAt, recordedAt, sequence, correlationId, payloadHash                       |
| Journal          | JRN-{ULID}:rN, ENTRY-{ULID}; sourceEventIds 1개 이상                                           |
| 시간             | 저장은 UTC offset 포함 ISO-8601, 화면은 기관 Timezone; occurred/issued/retrieved/recorded 분리 |
| 상태명           | 영문 대문자 canonical code + 한국어 표시명; API/DB/UI 동일 enum version 관리                   |
| 오류             | {DOMAIN}-{SEVERITY}-{NNN}; 사용자 메시지와 기술로그/correlationId 분리                         |

| **후속 단계 본 문서에는 상세 사용자 시나리오 40건을 포함한다. 다음 단계에서는 각 Scenario의 화면 후보를 실제 화면목록·와이어프레임·컴포넌트·상태·권한·오류 메시지로 확정하고, API/DB/Sequence를 동일 ID로 연결한다.** |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
