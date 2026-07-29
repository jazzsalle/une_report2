**재난안전 AI 문서 통합플랫폼  
상세설계서**

계획–실행–기록–환류 기반 3차년도 통합설계 / 개발 기준선

Version 0.9 \| 2026.07.26  
Document AI v1.0 이후 통합결정·HWPX Engine·SituationContext·UNI Adapter 개발명세 반영본

| **과제명**   | 재난관리를 위한 맞춤형 정보생성 및 의사결정지원 대화형 인공지능 기술개발 |
|--------------|--------------------------------------------------------------------------|
| **과제번호** | RS-2024-00407304                                                         |
| **작성기관** | ㈜유엔이(UNE)                                                            |
| **적용연차** | 3차년도(2026) 상세설계 기준                                              |
| **연계문서** | 통합설계 v0.7·v0.8 + UNE Document AI Contract v1.0 + API 명세 반영       |

# 문서 요약

본 문서는 v0.7과 UNE Document AI Contract v1.0 이후 확정된 모든 설계결정을 v0.8의 API·외부 재난정보 설계와 통합하여 개발 기준선으로 확장한 v0.9이다. 재난안전계획서 생성은 T3Q API-RPT-001/002만 사용하고, 상황일지 POC는 UNI 문서 업로드·검색·SOP JSON SSE·일반 편집 API를 적용한다. 현재 재난상황정보는 T3Q 전용 API가 없는 동안 기상청·행정안전부 공식 API를 우선하고 국민안전24 웹 보조수집과 네이버 웨더세이프 사용자 요청형 보조수집을 Adapter로 격리한다. 또한 임의 HWPX 분석부터 Prototype 상속, Selection Resolver, ChangeSet Executor, 보존형 저장, 한컴 Round-trip까지 HWPX/rhwp Document Engine을 개발 수준으로 정의하고 SituationContext JSON Schema, UNI Adapter 요청·응답·SSE·오류정책, 상황등록 화면흐름과 외부 Provider 수집 인터페이스를 확정한다.

| **구분**         | v0.9 확정 방향                                                                                                                     |
|------------------|------------------------------------------------------------------------------------------------------------------------------------|
| 플랫폼           | 계획서와 상황일지를 하나의 React 통합플랫폼으로 구성                                                                               |
| 문서 표준        | Document JSON을 Canonical Model로 사용하고 HTML은 표현층, HWPX는 최종 문서 포맷                                                    |
| HWPX             | rhwp Core 직접 활용 + Adapter/Fork로 UNE 기능 확장, Office-MCP 구현패턴 적극 활용                                                  |
| Workflow         | UNE Workflow Engine 중심, BPMN은 SOP 표현/교환에 선택 적용, DMN은 복잡규칙에 제한 적용                                             |
| MCP              | 필수 인터페이스가 아닌 선택 확장 계층                                                                                              |
| AI/RAG           | UNI RAG 선행검증 → UNE Document AI Contract 확정 → T3Q Adapter 전환                                                                |
| 상황일지         | Execution Log를 사실원장으로 하고 상황일지는 파생 문서로 생성                                                                      |
| T3Q 역할         | RAG/LLM·외부연계·TTS/STT. UNE는 챗봇을 개발하지 않음                                                                               |
| 편집 UX          | rhwp Web Editor를 중앙 Single Editing Surface로 사용. 생성·직접편집·AI 편집·미리보기 기능을 하나의 Workspace로 통합                |
| AI 편집단위      | Cursor / Text Range(Drag) / Block / Section. 화면 좌표가 아니라 paragraphId·blockId·offset·range로 식별                            |
| 범용 양식        | 임의 HWPX 자동분석→신뢰도/호환성 판정→Template Profile/Prototype 생성→사용자 확인(필요 시)                                         |
| 서식 상속        | AI는 기호·공백·들여쓰기·styleId를 직접 생성하지 않고 의미적 Level/Block만 반환. 원본 Prototype Clone으로 서식 계승                 |
| 사용자 수정 보호 | 사용자 수정 Block 자동 보호, AI 재생성 시 Diff/적용/취소, locked/editedByUser 상태와 Undo/Redo 제공                                |
| 계획서 AI        | T3Q API-RPT-001/002만 사용. UNI fallback 및 T3Q 챗봇 API 사용 금지                                                                 |
| 상황일지 AI      | UNI Upload/Search/chat-json/chat을 초기 Provider로 적용. T3Q RPT-003은 향후 Adapter 후보                                           |
| 외부 상황정보    | KMA/MOIS 공식 API 우선, SafeKorea 보조, Naver 사용자 요청형 보조수집                                                               |
| HWPX Engine      | TemplateAnalyzer·OutlinePatternAnalyzer·PrototypeRegistry·SelectionResolver·ChangeSetExecutor·보존형 Serializer·RoundTripValidator |
| 문서체계         | Master 설계서에 상세설계 유지 + 엔진/API 실행명세 별도 통제문서 + JSON Schema Bundle                                               |
| 세션전환         | v0.9와 상세명세 확정 후 새 세션으로 개발계획·사용자 시나리오·화면/시험설계 진행                                                    |

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/01_MASTER_DETAIL_v0.9/media/image1.png" style="width:6.49606in;height:2.26414in" />

# 목차

1\. 개요

2\. 기존 2차년도 시스템 분석

3\. 3차년도 고도화 목표

4\. 통합플랫폼 개념

5\. 통합 서비스 시나리오

6\. 시스템 아키텍처

7\. 재난안전계획서 생성도구 상세설계

8\. 상황일지 생성도구 상세설계

9\. 공통 Document AI Engine 설계

10\. Process/SOP Workflow 설계

11\. HWPX 문서 엔진 설계

12\. AI/RAG 연계 설계

13\. UNE Document AI Contract

14\. UNI RAG 선행검증 구조

15\. T3Q API Gap Analysis 및 개선안

16\. 데이터 모델

17\. 인터페이스 설계

18\. 개발·검증 시나리오

19\. 단계별 구현계획

20\. 재난상황정보 수집·Provider 적용 설계

21\. HWPX/rhwp Document Engine 상세명세

22\. SituationContext·UNI Adapter·외부 Provider 상세명세

23\. 산출물 문서체계와 계획서·사용자 시나리오 편성

24\. 개발 기준선·미결사항·세션 전환

# 1. 개요

## 1.1 목적

재난안전계획서 생성도구와 재난 상황일지 생성도구를 공통 Document AI Engine·Workflow·HWPX Engine·UNE Document AI Contract로 통합한다. v0.9는 v0.8의 API/Provider 설계에 HWPX/rhwp 엔진과 SituationContext/UNI Adapter의 개발명세를 결합한 본 개발 착수 기준선이다.

## 1.2 범위와 비범위

| **구분** | **포함**                                                                      | **제외/담당**                      |
|----------|-------------------------------------------------------------------------------|------------------------------------|
| UNE      | 계획서 생성·편집·HWPX 변환, 상황일지, SOP 실행/이력 UI, Document Orchestrator | 대화형 챗봇 자체개발 제외          |
| T3Q 연계 | RAG/LLM API Adapter, 구조화 응답 검증                                         | LLM/RAG·TTS/STT·외부연계 API는 T3Q |
| 공통     | React 통합 UI, 데이터/파일/Execution Log, 검증엔진                            | 모델 학습 파이프라인 자체개발 제외 |

**설계 근거:** 협약용/연차변경용 연구개발계획서, 2차년도 상세설계서, 6/19 과제 진행방향, 단계평가 의견을 우선 근거로 적용.

# 2. 기존 2차년도 시스템 분석

## 2.1 기존 시스템 구성

| **항목**  | **재난안전계획서**                  | **디지털 SOP**                   |
|-----------|-------------------------------------|----------------------------------|
| Frontend  | React                               | React                            |
| Backend   | .NET/ASP.NET Core 계열              | .NET/ASP.NET Core 계열           |
| DB        | PostgreSQL                          | SQL Server                       |
| 주요 흐름 | 기준정보→목차→초안→미리보기→DOC/PDF | SOP 정의→실행→진행상태→완료/전파 |
| 문서 포맷 | DOC 우회 후 HWP Import              | XML/JSON export 요구             |
| AI 연계   | RAG/LLM 초안 생성                   | 직접 AI 연계는 제한적            |

## 2.2 구조적 한계

• 계획서와 SOP가 물리·논리적으로 분리되어 3차년도 상황일지와 실행이력을 연결하기 어렵다.

• DOC 우회 방식은 HWPX 원본 양식의 스타일·번호·필드·표 구조를 유지하기 어렵다.

• 전체 문서 생성 중심이라 Section/Block 단위 재작성, 근거 추적, 선택영역 편집에 제약이 있다.

• SOP 실행내역을 장기적으로 재사용할 수 있는 공통 Execution Log 모델이 부족하다.

# 3. 3차년도 고도화 목표

| **목표**               | **설계 반영**                                                                 |
|------------------------|-------------------------------------------------------------------------------|
| 계획서 생성도구 고도화 | 다양한 export, HWPX 직접 생성/편집, 템플릿 확대, 품질 안정화                  |
| 상황일지 생성도구      | 위기관리매뉴얼·상황정보·대응정보와 SOP 실행이력을 결합해 시간순 상황일지 생성 |
| 안전한국훈련 연계      | SOP 콘텐츠 생성→상황/임무 전파→수신확인→완료→전자상황판→상황일지              |
| 실증 대비              | 자연재난 1종·사회재난 1종, 지자체/공공기관 실증을 고려한 호환성과 검증체계    |
| 평가 개선              | 자동생성 만족도 외에 문서 품질·호환성·근거성·시나리오 성공률 지표 추가        |

# 4. 통합플랫폼 개념

## 4.1 통합 서비스 정의

통합플랫폼은 “계획–실행–기록–환류”를 하나의 정보 흐름으로 묶는다. 평시에는 계획서를 생성·편집하고, 재난 또는 훈련 시에는 계획·매뉴얼에서 SOP를 구성하여 임무를 실행하며, 모든 수행 이력은 Execution Log로 축적한다. 상황일지는 이 사실원장을 시간·조직·임무 기준으로 투영해 생성하고, 평가·개선결과는 다음 계획서와 RAG 지식으로 환류한다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/01_MASTER_DETAIL_v0.9/media/image1.png" style="width:6.49606in;height:2.26414in" />

## 4.2 공통 자산

• Document AI Contract

• Template Profile / Document JSON

• Document Orchestrator

• HWPX Engine Adapter

• Workflow/SOP Engine

• Execution Log Engine

• Validation Engine

• AI Provider Adapter(UNI/T3Q)

# 5. 통합 서비스 시나리오

## 5.1 평시 계획수립 시나리오

1\. 사용자가 시스템 제공 양식, 저장된 Template Profile 또는 임의 HWPX/기존 완성문서를 업로드한다.

2\. Template Analyzer가 문서구조·개요패턴·들여쓰기/내어쓰기·기호 앞뒤 공백·문단/글자서식·표·머리말/꼬리말·필드 등을 분석하고 신뢰도/호환성을 판정한다.

3\. 자동분석 신뢰도가 낮은 역할만 사용자에게 간단히 확인받아 Template Profile과 Paragraph Prototype Registry를 확정한다.

4\. 사용자가 기준정보·재난유형·작성목적·참조자료를 입력하고 AI가 목차를 생성한다.

5\. Section/Block 단위 AI 생성결과를 별도 미리보기가 아닌 rhwp Web Editor에 즉시 반영한다.

6\. 사용자는 한글 문서를 다루듯 직접 타이핑·삭제·표 편집을 하고, Cursor/드래그/Block/Section 단위로 AI 재작성·확장·근거추가·표변환을 실행한다.

7\. AI는 텍스트와 의미적 구조만 반환하며 UNE HWPX Engine은 원본 양식 Prototype의 개요기호·공백·들여쓰기·ParaShape·CharShape·번호·표스타일을 상속한다.

8\. 사용자 수정 Block은 자동 보호하고 AI 변경은 Diff 확인 후 적용한다. 최종 HWPX를 직접 저장하고 PDF/DOCX는 보조 Export로 제공한다.

## 5.2 재난/훈련 상황 시나리오

1\. 상황이 발생하면 Event를 등록하고 관련 위기관리매뉴얼·SOP·유사이력을 조회한다.

2\. AI 또는 사용자가 SOP 초안을 구성하고 승인 후 실행한다.

3\. 임무를 조직/담당자에게 전파하고 수신확인·착수·완료를 기록한다.

4\. 모든 상태변경은 Execution Event로 적재되어 전자상황판에 시간순 표출된다.

5\. 정해진 시점 또는 사용자 요청 시 상황일지를 생성한다.

6\. 훈련 종료 후 평가/개선사항을 계획서·SOP 개선으로 환류한다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/01_MASTER_DETAIL_v0.9/media/image2.png" style="width:6.49606in;height:2.96946in" />

## 5.3 rhwp Web Editor 중심 사용자 시나리오

문서 생성과 편집을 분리하지 않는다. AI가 생성한 Section/Block은 rhwp Web Editor의 Document Model에 즉시 반영하며 사용자는 생성 완료를 기다리지 않고 완료된 영역부터 직접 편집할 수 있다. 동일 Block을 AI와 사용자가 동시에 수정하지 않도록 generation lock을 적용한다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/01_MASTER_DETAIL_v0.9/media/image5.png" style="width:6.6in;height:3.45439in" />

그림 5-1. rhwp Web Editor를 단일 편집 Surface로 사용하는 통합 Workspace 개념

# 6. 시스템 아키텍처

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/01_MASTER_DETAIL_v0.9/media/image3.png" style="width:6.49606in;height:3.47622in" />

## 6.1 계층별 상세 구성

| **계층**      | **컴포넌트**              | **책임**                                                                                |
|---------------|---------------------------|-----------------------------------------------------------------------------------------|
| Presentation  | React Document Workspace  | 문서목록, 양식업로드, 기준정보, 목차/본문 편집, SOP 실행, 전자상황판, 상황일지          |
| Application   | UNE Application Backend   | 인증문맥, 권한, 문서/프로세스 Job, API Gateway, SSE 이벤트                              |
| Orchestration | UNE Document Orchestrator | AI Operation 해석, Context 조립, Validator, Command 실행, 트랜잭션/재시도               |
| Document      | HWPX Engine Adapter       | rhwp Parser/IR/Writer/WASM, Template Analyzer, Style/Numbering/Anchor, Export           |
| Workflow      | UNE Workflow Engine       | SOP Definition/Instance, Task, Decision, Propagation, Human Approval, BPMN Adapter 선택 |
| AI            | Provider Adapter          | UNI RAG 선행검증, T3Q RAG/LLM 운영 전환                                                 |
| Data          | PostgreSQL + File Store   | 문서/버전/블록/인용/SOP/실행이력/파일 메타                                              |
| Validation    | Validation Engine         | JSON Schema, 근거, 수치/날짜, 문서구조, HWPX 호환성                                     |

## 6.2 핵심 책임경계

| **주체** | **소유 책임**                                                                                    | **비고**                             |
|----------|--------------------------------------------------------------------------------------------------|--------------------------------------|
| UNE      | React, Orchestrator, HWPX Engine Adapter, Workflow/Execution Log, AI Contract, 데이터/인터페이스 | 챗봇 제외                            |
| T3Q      | Local LLM/RAG, 외부연계 API, TTS/STT, AI 응답 품질                                               | UNE Contract에 맞춘 구조화 응답 협의 |
| ETRI     | 유사재난 교차분석/추천 등 과제 역할                                                              | 필요 API만 연계                      |

## 6.3 배포 구조 원칙

• Frontend는 React 정적배포 또는 UNE 서비스 영역에서 제공한다.

• Document Engine은 WASM(클라이언트)과 서버 처리 조합을 Adapter로 추상화하여 향후 변경 가능하게 한다.

• AI Provider는 환경변수/설정으로 UNI와 T3Q를 교체 가능하게 한다.

• Process-GPT 전체 런타임은 필수 구성요소로 두지 않으며 필요한 오픈소스 기능은 UNE 방식으로 수정·리팩토링해 활용한다.

• MCP는 내부 핵심통신이 아니라 향후 Tool 확장 Adapter로 둔다.

## 6.4 중앙 편집 Surface 및 상태 동기화 구조

• rhwp Web Editor는 작성·미리보기·직접편집·AI 편집을 통합한 Single Editing Surface로 사용한다.

• React Shell은 문서목록·목차패널·AI/근거패널·Job 상태바를 제공하고 실제 문서 편집 Surface는 rhwp Editor와 UNE Adapter가 담당한다.

• Editor Selection을 화면 X/Y 좌표로 저장하지 않고 paragraphId·blockId·offset·range로 정규화하여 Document AI Contract에 전달한다.

• 생성 Job과 편집 세션은 versionId/revision을 공유하며 동일 Block의 동시수정은 optimistic lock + generation lock으로 제어한다.

# 7. 재난안전계획서 생성도구 상세설계

## 7.1 기능 구성

| **모듈**            | **기능**                                   |
|---------------------|--------------------------------------------|
| Template Workspace  | HWPX 업로드·분석·템플릿 저장/버전          |
| Criteria Workspace  | 기준정보 입력·템플릿·참조문서              |
| Outline Editor      | 목차 생성·재요청·추가·수정·삭제·순서변경   |
| AI Draft            | 전체/Section/Block 생성·중지·재시도        |
| Document Editor     | 문단/표/스타일 제한 편집, 선택영역 AI 작업 |
| Evidence Panel      | RAG 근거·Citation·출처 확인                |
| Preview/Export      | HWPX/PDF/DOC 보조 export, 인쇄             |
| Document Repository | 저장·버전·검색·휴지통·공유                 |

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/01_MASTER_DETAIL_v0.9/media/image4.png" style="width:6.49606in;height:2.87166in" />

## 7.2 생성 Job 상태

| **상태**   | **설명**              | **전이**                |
|------------|-----------------------|-------------------------|
| WAITING    | 요청 대기             | →RETRIEVING             |
| RETRIEVING | RAG 근거 검색         | →GENERATING/ERROR       |
| GENERATING | LLM 구조화 생성       | →VALIDATING/CANCELLED   |
| VALIDATING | Schema/근거/규칙 검증 | →APPLYING/RETRY/ERROR   |
| APPLYING   | 문서명령 반영         | →COMPLETED/ERROR        |
| COMPLETED  | 생성 완료             | 편집/재생성 가능        |
| ERROR      | 오류                  | 재시도 가능             |
| CANCELLED  | 사용자 중지           | 부분결과 보존 정책 적용 |

## 7.3 선택영역 AI 편집 Operation

| **Operation**    | **대상**          | **결과**            |
|------------------|-------------------|---------------------|
| REWRITE_BLOCK    | blockId           | 동일 의미 재작성    |
| EXPAND_BLOCK     | blockId           | 세부내용 확장       |
| SUMMARIZE_BLOCK  | blockId/sectionId | 요약                |
| CONVERT_TO_TABLE | blockId\[\]       | 표로 변환           |
| GENERATE_SECTION | sectionId         | 섹션 생성/재생성    |
| SEARCH_EVIDENCE  | query/context     | 근거만 재검색       |
| VALIDATE_CONTENT | targetId          | 수치/날짜/근거 검증 |

## 7.4 rhwp Web Editor 편집모델

| **선택 단위** | **식별모델**                   | **대표 동작**                     | **AI Operation**                        |
|---------------|--------------------------------|-----------------------------------|-----------------------------------------|
| Cursor        | paragraphId + offset           | 이어쓰기·삽입·표추가              | INSERT_AT_CURSOR / GENERATE_NEXT        |
| Text Range    | start/end paragraphId + offset | 재작성·요약·확장·근거추가         | REWRITE_SELECTION / SUMMARIZE_SELECTION |
| Block         | blockId                        | 문단 재생성·이동·삭제·구조변경    | REWRITE_BLOCK / MOVE_BLOCK              |
| Section       | sectionId                      | 절 전체 생성·재생성·하위목차 생성 | GENERATE_SECTION / REGENERATE_SECTION   |

AI 편집은 선택 범위를 의미적 ID로 해석한 뒤 Structured Output을 DocumentCommand로 변환하여 적용한다. 스타일과 개요번호는 AI가 직접 결정하지 않는다.

## 7.5 AI 변경 미리보기·사용자 수정 보호

• AI가 기존 내용을 변경하는 Operation은 기본적으로 Diff Preview를 생성하고 \[적용/다시 생성/취소\]를 제공한다.

• 사용자가 직접 수정한 Block은 editedByUser=true로 기록하고 자동 재생성 대상에서 제외한다. 사용자가 명시적으로 덮어쓰기를 승인한 경우에만 변경한다.

• 확정된 중요문단은 locked=true로 보호할 수 있으며 Section 재생성 시에도 유지한다.

• Undo/Redo는 사용자 명령과 AI DocumentCommand를 동일 ChangeSet 단위로 기록하여 복구 가능하게 한다.

## 7.6 임의 HWPX 양식 업로드 시나리오

사용자는 사전 등록되지 않은 HWPX 양식뿐 아니라 기존에 내용이 채워진 완성문서도 업로드할 수 있다. 시스템은 서식과 콘텐츠를 분리하여 Template Profile을 만들고, 기존 콘텐츠는 필요 시 RAG 참조자료로 사용할 수 있다.

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/01_MASTER_DETAIL_v0.9/media/image6.png" style="width:6.6in;height:3.23825in" />

그림 7-1. 임의 HWPX 양식 자동분석·적용 흐름

| **영역 분류**  | **처리원칙**                  | **예**                      |
|----------------|-------------------------------|-----------------------------|
| STATIC         | 원본 유지, AI 자동변경 금지   | 기관로고·결재란·서명란      |
| AI_GENERATABLE | AI 생성/재생성 가능           | 추진배경·대응방향·세부계획  |
| EDITABLE       | 사용자/AI 모두 수정 가능      | 일반 본문·표 설명           |
| DATA_BOUND     | 외부/기준정보와 연결하여 갱신 | 연락망·현황수치·기준정보 표 |

자동분석 결과에는 confidence와 compatibilityLevel을 포함하며, 모호한 개요/스타일 역할만 사용자에게 확인받는다. “모든 HWPX 100% 자동지원”을 전제로 하지 않고 자동지원·확인지원·제한지원의 3단계 정책을 적용한다.

## 7.7 T3Q 전용 API 적용 확정

재난안전계획서 생성도구의 AI 생성 경로는 T3Q 전용으로 고정하며 UNI API를 호출하지 않는다. UNE Document Orchestrator는 아래 두 T3Q Endpoint를 T3qPlanProvider Adapter로 감싸고, 응답을 UNE Document AI Contract의 Outline·Section·Citation 객체로 변환한다.

| **구분**  | **T3Q Endpoint**                           | **주요 요청**                                                                                | **주요 응답**                                          | **UNE 처리**                                          |
|-----------|--------------------------------------------|----------------------------------------------------------------------------------------------|--------------------------------------------------------|-------------------------------------------------------|
| 목차 생성 | POST /model-api/ae894/reports/plan/toc     | subject, backgroundInfo, contentInstruction, expressionRule, purposeOfDocument, systemPrompt | title, sections{name, children}                        | Outline으로 정규화 후 사용자 편집                     |
| 본문 생성 | POST /model-api/ae894/reports/plan/content | 목차 생성 요청 필드 + sections + stream                                                      | sections{name, content, references, children} 또는 SSE | Section/ContentBlock/Citation으로 정규화 후 HWPX 반영 |

T3Q 요청의 paragraphSymbol은 문서 작성 의도 전달용으로만 사용한다. 최종 개요기호·공백·들여쓰기·ParaShape·CharShape는 HWPX Template Profile과 Paragraph Prototype이 결정한다.

계획서 생성 과정에서 T3Q 호출 실패 시 UNI로 자동 전환하지 않는다. 실패 상태를 사용자에게 표시하고 재시도·부분생성·수동편집으로 처리하여 기관 역할과 평가 근거를 명확히 유지한다.

# 8. 상황일지 생성도구 상세설계

## 8.1 핵심 원칙

상황일지는 사용자가 직접 처음부터 작성하는 문서가 아니라, 상황·임무·전파·확인·수행·완료·판단의 이력을 Execution Log에 사실 데이터로 축적하고 이를 정해진 양식으로 투영(Projection)하여 생성하는 문서로 설계한다.

## 8.2 주요 기능

| **기능**       | **상세**                                           |
|----------------|----------------------------------------------------|
| 상황등록       | 재난/훈련 Event, 발생시각, 위치, 재난유형, 단계    |
| SOP 생성/선택  | 매뉴얼/RAG 기반 SOP 초안 또는 기존 SOP 선택        |
| 상황·임무 전파 | 조직/수신자/채널/내용/기한                         |
| 수신확인       | ACK 시각, 담당자, 상태                             |
| 임무수행       | 시작/진행/보류/완료/증빙                           |
| 전자상황판     | 시간순 Timeline, 임무상태, 미확인/지연 강조        |
| 상황일지 생성  | 시간구간/조직/재난유형 기준 집계 후 HWPX 양식 반영 |
| 평가/환류      | 훈련평가·미흡사항·개선조치와 SOP/계획서 연결       |

## 8.3 Journal 생성 규칙

• 원천 Execution Event는 수정 대신 정정 이벤트를 추가하여 감사성을 유지한다.

• JournalEntry는 여러 Event를 집계할 수 있으며 sourceEventIds를 보존한다.

• AI가 요약한 문장은 fact/evidence와 분리 저장하고 사용자 승인 상태를 둔다.

• 재생성 시 동일 시간구간의 사실 데이터는 유지하고 문장 표현만 갱신 가능하다.

## 8.4 상황 등록과 현재 재난상황정보 보강

사용자는 상황명·재난유형·훈련/실제 구분·발생일시·대상지역·최초상황을 직접 입력한다. 필요 시 \[현재 상황정보 불러오기\]를 실행하면 UNE Situation Context Manager가 공식 외부정보를 조회하여 후보 사실(SituationFact)로 제시하고, 사용자가 선택·수정·확정한 값만 Incident의 기준 상황으로 저장한다.

사용자 입력  
+ 기상청 단기예보/초단기실황  
+ 기상청 기상특보  
+ 행정안전부 긴급재난문자  
+ 국민안전24 보조수집  
↓  
Situation Merge Engine  
↓  
사용자 확인·확정  
↓  
SituationSnapshot vN

## 8.5 사용자 업로드 자료 기반 SOP 생성

최근 안전한국훈련 계획서·훈련 프로그램·메시지 목록·기관 임무카드 등 사용자가 업로드한 자료를 이번 훈련의 우선 근거로 사용할 수 있도록 한다. 파일은 UNI /documents/upload로 등록하고 비동기 학습 완료 상태를 확인한 후, /search/와 /chat/json을 조합하여 SOP JSON을 생성한다.

| **단계**      | **UNI API**                       | **적용 설계**                                                                              |
|---------------|-----------------------------------|--------------------------------------------------------------------------------------------|
| 인증          | POST /auth/login                  | UNE 백엔드가 JWT를 보관하고 브라우저에 최소 범위로 전달                                    |
| 자료 업로드   | POST /documents/upload            | multipart file, uploader, force; 반환 doc_id를 UploadSession에 저장                        |
| 학습상태 확인 | GET /documents/                   | 업로드 문서 상태·오류·완료 여부를 폴링                                                     |
| 참고자료 확인 | GET /documents/{doc_id}/reference | LLM 생성 요약을 사용자에게 미리보기로 제공                                                 |
| 근거 검색     | POST /search/                     | query, top_k로 LLM 생성 전 관련 청크만 조회                                                |
| SOP 생성      | POST /chat/json                   | query, model_key, top_k; compns 단위 SSE를 SOP Draft에 누적                                |
| 일반 편집     | POST /chat/                       | query, history, stream, top_k, session_id 등; 챗봇 UI가 아닌 Editor Command Backend로 사용 |

## 8.6 자료 우선순위·충돌 처리

SOP 생성 기본 우선순위는 ① 이번 훈련 사용자 업로드 자료, ② 사용자 확정 상황정보, ③ 기관 최신자료, ④ 공식 위기관리매뉴얼, ⑤ 유사 재난사례, ⑥ 일반 학습 DB 순으로 한다. 다만 법령·공식 매뉴얼과 업로드 자료가 충돌하면 자동 우선 적용하지 않고 EvidenceConflict를 생성하여 사용자가 선택하도록 한다.

## 8.7 상황전파 책임경계

T3Q와 UNI API는 문자·메일·방송 전파에 사용하지 않는다. SOP 승인 이후 임무 전파는 UNE Propagation Manager와 향후 제공될 UNE 내부 문자·메일·방송 모듈이 수행하며, 발송요청·발송결과·수신확인·재전파·실패는 Execution Log에 기록한다.

# 9. 공통 Document AI Engine 설계

## 9.1 엔진 구성

| **모듈**                    | **책임**                                                |
|-----------------------------|---------------------------------------------------------|
| Context Builder             | 기준정보·문서구조·선택영역·사용자지침·RAG 근거 조립     |
| Operation Router            | Operation별 Provider/Prompt/Validator/Command 흐름 결정 |
| Structured Output Validator | JSON Schema, enum, required, type, length 검증          |
| Evidence Binder             | Citation과 block/claim 연결                             |
| Style Resolver              | styleRole→Template Profile 실제 스타일 매핑             |
| Command Builder             | ContentBlock→DocumentCommand 변환                       |
| Command Executor            | HWPX Engine Adapter 호출, 원자적 적용/rollback          |
| Job Manager                 | 상태·중지·재시도·진행률                                 |
| Audit Logger                | 요청/응답/명령/사용자확정 이력                          |

## 9.2 처리 파이프라인

Request → Context Builder → AI Provider → Structured JSON → Validator → Evidence Binder → Command Builder → HWPX/Workflow Executor → Validation → Commit

## 9.3 결정론적 처리 원칙

• LLM은 HWPX XML, styleId, 좌표를 직접 생성하지 않는다.

• 허용 Operation·styleRole·blockType는 enum으로 제한한다.

• 문서 구조 변경은 DocumentCommand로만 수행한다.

• AI 실패와 문서엔진 실패를 분리하여 재시도한다.

• 사용자 승인 전 AI 생성결과와 확정 문서를 버전으로 분리한다.

## 9.4 Selection Context Resolver 및 Edit Command 파이프라인

<img src="/mnt/data/UNE_Claude_Code_Max_개발패키지_v1.0_20260728/docs/design-markdown/media/01_MASTER_DETAIL_v0.9/media/image7.png" style="width:6.6in;height:3.23825in" />

그림 9-1. 선택범위 기반 AI 편집과 결정론적 문서 반영

| **컴포넌트**               | **입력**                       | **출력/책임**                                 |
|----------------------------|--------------------------------|-----------------------------------------------|
| Selection Context Resolver | Editor Selection               | cursor/range/block/section을 안정 ID로 정규화 |
| Edit Policy Resolver       | target + editState             | locked/editedByUser/generating 충돌 판정      |
| AI Operation Builder       | SelectionContext + instruction | Provider-neutral AI 요청 생성                 |
| ChangeSet Builder          | AI blocks + current document   | DocumentCommand\[\] + Diff 생성               |
| Transactional Apply        | approved ChangeSet             | 원자적 반영·rollback·revision 증가            |

# 10. Process/SOP Workflow 설계

## 10.1 기술 적용 결정

| **기술**         | **판정**                | **설계 반영**                                                |
|------------------|-------------------------|--------------------------------------------------------------|
| Process-GPT 전체 | 비도입                  | 전체 플랫폼 종속 없이 Workflow/HITL/보상/감사 패턴 차용      |
| Office-MCP       | 수정·리팩토링 활용 가능 | HWPX Tool/HTML page edit/data-id 패턴을 UNE 모듈에 적극 활용 |
| BPMN             | 선택 적용               | SOP 표현·교환·시각화 Adapter                                 |
| DMN              | 제한 적용               | 복잡하고 반복되는 판단규칙만 외부화                          |
| MCP              | 선택 확장               | 향후 AI Agent Tool 호출 Adapter, 현재 REST/SSE 유지          |

## 10.2 Workflow 도메인

| **객체**         | **설명**                                |
|------------------|-----------------------------------------|
| SopDefinition    | 재난유형·상황종류·위기단계별 절차 정의  |
| WorkflowInstance | 특정 Event에 대해 실행된 SOP 인스턴스   |
| TaskDefinition   | 임무 정의, 담당조직, 완료조건, 전파정책 |
| TaskInstance     | 실행 시점의 담당자·기한·상태            |
| DecisionNode     | 상황판단 분기, 수식/DMN 참조 가능       |
| Propagation      | 상황/임무 전파 발신·수신·ACK            |
| ExecutionEvent   | 모든 상태변경 불변 이벤트               |
| HumanApproval    | AI 생성 SOP/중요 분기/일지 승인         |

## 10.3 상태전이

DRAFT → READY → RUNNING → (PAUSED) → COMPLETED  
↘ CANCELLED / FAILED  
Task: PENDING → SENT → ACKNOWLEDGED → IN_PROGRESS → COMPLETED / REJECTED / OVERDUE

# 11. HWPX 문서 엔진 설계

## 11.1 구성

| **모듈**                   | **기능**                                             |
|----------------------------|------------------------------------------------------|
| RhwpAdapter                | parse/load/save/export, Document IR 접근, WASM 연계  |
| TemplateAnalyzer           | 문단/글자/번호/표/필드/섹션/머리말·꼬리말 분석       |
| TemplateProfileManager     | 의미 styleRole과 실제 style/numbering 매핑 저장      |
| AnchorManager              | Field/Bookmark/Paragraph/Block Anchor 관리           |
| StyleMapper                | TITLE/HEADING/BULLET/TABLE/NOTE → 실제 양식 스타일   |
| NumberingManager           | □/○/- 및 숫자개요번호 프로토타입 복제·연속성         |
| TableManager               | 표 프로토타입 복제, 행/열/병합/셀스타일              |
| HwpDocumentCommandExecutor | insert/replace/delete/move/applyStyle/insertTable    |
| CompatibilityValidator     | ZIP/XML 구조, 참조무결성, round-trip, 한컴 열기 검증 |

## 11.2 최소 양식 기반 Template Profile

TemplateProfile {  
templateId, version, pageProfile,  
styleRoles { TITLE, HEADING1, BULLET_SQUARE, BULLET_CIRCLE, BULLET_DASH, NOTE },  
numberingProfiles\[\], tableProfiles\[\], anchors\[\], exportProfile  
}

## 11.2.1 범용 Template Analyzer 요구사항

• 입력은 빈 HWPX 양식과 기존 완성 HWPX 모두 허용한다.

• 문단/글자 속성, styleID/paraPrID/charPrID, 페이지/섹션, 번호/개요, 문자형 개요기호, 들여쓰기/내어쓰기, 기호 앞뒤 공백, 문단 위·아래 간격, 줄간격, 표/셀, 머리말/꼬리말, 필드/책갈피, 이미지·개체를 분석한다.

• 반복 빈도·서식 유사도·문서 위치·문자패턴을 기반으로 TITLE/HEADING/OUTLINE/NOTE/TABLE 등 역할 후보를 군집화한다.

• 구조기반 분석을 우선하고 의미판별이 모호한 경우에만 AI 보조 분류를 사용한다. LLM이 HWPX XML 속성을 직접 생성하거나 수정하지 않는다.

## 11.2.2 OutlinePatternAnalyzer 및 Paragraph Prototype Registry

| **항목**      | **분석/저장대상**                    | **생성 시 처리**                     | **비고**                   |
|---------------|--------------------------------------|--------------------------------------|----------------------------|
| 문자형 개요   | □, ○/ㅇ, -, ―, ※, \* 및 앞뒤 공백    | Prototype 문단 Clone 후 본문만 교체  | AI가 기호/공백 생성 금지   |
| HWP 개요/번호 | outline/numbering 정의, level        | 원본 numbering 정의 참조/연속성 유지 | Ⅰ, 1., 가., (1) 등         |
| 문단 위치     | left/right margin, indent, hanging   | Prototype의 ParaShape 상속           | 공백문자와 들여쓰기를 구분 |
| 문단간격      | before/after, lineSpacing            | 원본 값 상속                         | 양식별 차이 보존           |
| 글자서식      | font, size, ratio, spacing, emphasis | CharShape 상속                       | 텍스트만 AI 결과로 교체    |

가장 안전한 생성방식은 속성값을 새로 조합하는 것이 아니라 원본에서 검증된 Prototype Paragraph/Table을 Clone하고 텍스트·구조적 데이터만 교체하는 방식이다.

## 11.2.3 업로드 샘플 3종 기반 개요패턴 검증

| **샘플**        | **관찰된 개요 패턴**      | **대표 paraPrIDRef** | **설계 시사점**                                                    |
|-----------------|---------------------------|----------------------|--------------------------------------------------------------------|
| 1_업무보고 양식 | □ → " ㅇ" → " -" → " \*"  | 21 / 22 / 23         | 같은 문단속성을 공유하는 단계도 있어 문자패턴+반복문맥을 함께 분석 |
| 2_보고서 양식   | " □" → " ○" → " ―" → " ※" | 28 / 29 / 30         | 단계별 문단 위 간격 차이까지 Prototype 상속 필요                   |
| 3_보고서 양식   | □ → " ㅇ" → " -" → " \*"  | 22 / 25 / 26 / 27    | 개요기호·앞 공백·ParaShape 조합이 양식마다 다름                    |

검증 결과, 동일한 의미적 Level이라도 양식별 문자기호·선행 공백·문단속성 조합이 다르므로 AI 출력에 “□/○/- 및 공백”을 포함시키지 않고 Template Profile의 Prototype Mapping을 적용해야 한다.

## 11.2.4 자동분석 신뢰도·호환성 정책

| **Level** | **조건**                               | **사용자 UX**            | **처리**                                |
|-----------|----------------------------------------|--------------------------|-----------------------------------------|
| AUTO      | 역할 confidence 높음 + 지원개체만 존재 | 분석완료 후 즉시 사용    | Template Profile 자동 확정              |
| CONFIRM   | 일부 역할 모호 또는 비표준 기호        | 모호한 항목만 1~3개 확인 | 사용자 지정 후 Profile 확정             |
| LIMITED   | 미지원/복잡개체 존재                   | 제한사항·영향영역 표시   | 지원가능 영역만 AI 편집, 원본 보존 우선 |

## 11.3 Office-MCP 활용 방침

Office-MCP는 HWPX 템플릿 채움, HTML 페이지 변환·편집·재저장, Tool 계약 등 구현 아이디어를 UNE 방식으로 수정·리팩토링하여 활용한다. 특정 저장소 구조에 직접 결합하지 않고 HWPX Engine Adapter 내부로 흡수하여, 향후 rhwp 또는 다른 엔진 교체가 가능하도록 인터페이스를 고정한다.

## 11.4 HWPX 검증 항목

| **검증**   | **내용**                                        |
|------------|-------------------------------------------------|
| STRUCTURE  | ZIP/XML well-formed, relationship/ID 참조       |
| STYLE      | 원본 핵심 styleRole 보존, 번호연속성            |
| LAYOUT     | 겹침/잘림/페이지 급변, 표 분할                  |
| ROUND_TRIP | 열기→수정→저장→재오픈 무결성                    |
| HANCOM     | 실증 한컴 환경에서 복구경고·손상 없이 열기/저장 |
| CONTENT    | Document JSON과 최종 문서 내용 일치             |

# 12. AI/RAG 연계 설계

## 12.1 Provider 독립 구조

UNE Document Orchestrator  
└─ AiProvider interface  
├─ UniRagProvider \[선행검증/개발\]  
└─ T3qProvider \[통합/운영\]

## 12.2 RAG 응답 최소 요구

| **필드**      | **필수** | **설명**                        |
|---------------|----------|---------------------------------|
| answer/blocks | Y        | 구조화 ContentBlock             |
| citations     | Y        | sourceId/title/page/chunk/score |
| generationId  | Y        | 추적 ID                         |
| model/version | 권고     | 재현성                          |
| status        | Y        | 생성 상태                       |
| warnings      | 권고     | 근거부족/불확실                 |
| usage/latency | 선택     | 성능분석                        |

## 12.3 안전·품질 원칙

• 공공 비공개 문서는 외부 공개형 AI로 전송하지 않는 배포구조를 기본 전제로 한다.

• 수치·날짜·인력·피해규모 등 중요 claim은 Citation 또는 별도 검증결과와 연결한다.

• RAG 근거 없음 상태를 숨기지 않고 warning으로 전달한다.

• AI 응답의 문서 반영 전 Structured Output Validation을 필수화한다.

## 12.4 서비스별 Provider 적용정책

| **서비스**                  | **1차 적용 Provider** | **대체/향후 경로**             | **설계 결정**         |
|-----------------------------|-----------------------|--------------------------------|-----------------------|
| 재난안전계획서 목차·본문    | T3Q RPT-001/RPT-002   | 없음(장애 시 재시도/수동편집)  | T3Q 전용              |
| 상황일지용 사용자 자료 학습 | UNI Documents API     | 향후 T3Q Upload API 협의       | UNI POC               |
| SOP 근거검색                | UNI /search/          | 향후 T3Q RAG Adapter 병행 가능 | Provider Adapter 유지 |
| SOP JSON 생성               | UNI /chat/json        | 향후 T3Q 구조화 생성 API 협의  | UNI POC               |
| 상황일지 문장·선택영역 편집 | UNI /chat/            | 향후 T3Q 구조화 편집 API 협의  | Editor Command로 사용 |
| 현재 재난상황정보           | UNE 외부정보 Adapter  | 향후 T3Q 상황정보 API          | LLM Provider와 분리   |
| 문자·메일·방송 전파         | UNE 내부모듈          | 소스 제공 후 Adapter 연결      | AI Provider와 분리    |

## 12.5 현재 재난상황정보는 LLM 생성값이 아닌 Fact로 관리

기상값·특보·재난문자·발효시각·관측시각은 LLM 프롬프트에서 생성하지 않고 외부 원천 응답을 SituationFact로 정규화한다. LLM은 확정된 Fact를 요약하거나 SOP 문맥으로 재구성할 수 있으나 원본 값·출처·조회시각·적용여부를 변경할 수 없다.

## 12.6 민간 통합표출 서비스 사용 원칙

민간 통합표출 서비스는 공식 API보다 낮은 우선순위의 보조 Provider로 격리한다. 네이버 웨더세이프는 POC에서 사용자가 명시적으로 요청한 조회에 한해 URL Import 또는 제한적 Parser를 Feature Flag로 사용할 수 있으나, 운영 적용 전 이용조건·robots·DOM 안정성 검토를 거친다. 운영 Fact는 기상청·행정안전부 공식 API와 사용자 확정을 우선한다.

# 13. UNE Document AI Contract

## 13.1 목적

Frontend나 HWPX 엔진이 T3Q API 스키마에 직접 종속되지 않도록 UNE가 소유하는 Provider-neutral 표준 계약을 정의한다. Contract는 API 요청/응답뿐 아니라 Document/Workflow Command의 공통 의미모델을 포함한다.

## 13.2 주요 객체

| **객체**         | **핵심 필드**                                                     |
|------------------|-------------------------------------------------------------------|
| RequestEnvelope  | requestId, operation, schemaVersion, userContext, documentContext |
| DocumentContext  | documentId, templateId, disasterType, managementStage, criteria   |
| OutlineItem      | id,parentId,level,title,styleRole                                 |
| ContentBlock     | id,type,styleRole,text,children,table,citations                   |
| Citation         | sourceId,title,page,chunkId,score,quoteHash                       |
| DocumentCommand  | commandId,action,targetId,position,payload,precondition           |
| GenerationStatus | generationId,status,progress,message,partial                      |
| ValidationResult | valid,errors,warnings,checks                                      |
| SituationEvent   | eventId,eventType,occurredAt,source,payload                       |
| JournalRequest   | incidentId,timeRange,templateId,aggregationRules                  |

## 13.3 Operation 목록

GENERATE_OUTLINE \| GENERATE_SECTION \| GENERATE_DOCUMENT \| REWRITE_BLOCK \| EXPAND_BLOCK \| SUMMARIZE_BLOCK \| CONVERT_TO_TABLE \| SEARCH_EVIDENCE \| VALIDATE_CONTENT \| GENERATE_SOP_DRAFT \| GENERATE_JOURNAL \| SUMMARIZE_EXECUTION_LOG

## 13.4 예시 요청/응답

POST /api/ai/operations  
{  
"operation":"GENERATE_SECTION",  
"schemaVersion":"1.0",  
"documentContext":{"documentId":"DOC-001","templateId":"TPL-01"},  
"target":{"sectionId":"SEC-03"}  
}  
  
Response: {"generationId":"GEN-001","blocks":\[...\],"citations":\[...\],"status":"COMPLETED"}

## 13.5 Editor Selection·Template·ChangeSet 객체 추가

| **객체**               | **핵심 필드**                                     | **용도**                            |
|------------------------|---------------------------------------------------|-------------------------------------|
| SelectionContext       | type,cursor,start,end,blockIds,sectionId,revision | Cursor/Drag/Block/Section 공통 표현 |
| TemplateAnalysisResult | templateId,patterns,confidence,unsupportedObjects | 임의 HWPX 분석결과                  |
| OutlinePattern         | level,symbol,leadingText,prototypeId,numberingRef | 개요모양·공백·번호 Prototype        |
| ParagraphPrototype     | prototypeId,paraPrRef,charPrRef,sampleText,role   | 원본 문단 Clone 기준                |
| EditState              | editedByUser,locked,generating,lastEditor         | 사용자 수정 보호·동시편집           |
| ChangeSet              | changeSetId,commands,diff,baseRevision,status     | AI 변경 미리보기·원자적 적용        |
| CompatibilityResult    | level,warnings,unsupportedFeatures,score          | 임의양식 지원등급                   |

## 13.6 AI 편집 Operation 확장

| **Operation**              | **대상**            | **처리원칙**                                 |
|----------------------------|---------------------|----------------------------------------------|
| INSERT_AT_CURSOR           | cursor              | 현재 문단문맥을 기준으로 내용/블록 삽입      |
| REWRITE_SELECTION          | text range          | 선택범위만 재작성, 주변 style/numbering 불변 |
| EXPAND_SELECTION           | text range/block    | 세부내용 확장                                |
| ADD_EVIDENCE               | range/block/section | RAG 근거 재검색 후 Citation 연결             |
| CONVERT_SELECTION_TO_TABLE | range/block\[\]     | 텍스트→Table JSON, 원본 TABLE prototype 적용 |
| APPLY_CHANGESET            | changeSetId         | 사용자 승인 Diff를 원자적으로 적용           |
| REJECT_CHANGESET           | changeSetId         | AI 제안 폐기, 원문 유지                      |

## 13.7 UNE Document AI Contract v1.0 확정

v0.7에서는 13장의 개념 수준 계약을 실제 개발 가능한 JSON 계약으로 확정한다. 동일 계약을 React/rhwp Workspace, UNE Document Orchestrator, UNI RAG Adapter 및 T3Q Adapter가 공유하며, AI의 의미적 생성과 HWPX 표현 적용의 책임을 분리한다.

| **계약 핵심** AI는 outlineLevel·styleRole·텍스트·표 데이터·Citation을 반환하고, 개요기호·앞 공백·들여쓰기·ParaShape·CharShape는 Template Profile과 Paragraph Prototype을 통해 UNE/rhwp가 적용한다. |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 13.8 계약 계층과 책임경계

| **계층**                  | **입력/출력**                      | **책임**                                                             |
|---------------------------|------------------------------------|----------------------------------------------------------------------|
| React + rhwp Workspace    | SelectionContext ↔ ChangeSet       | 커서·드래그·Block·Section 선택, Diff/승인, Undo/Redo                 |
| UNE Document Orchestrator | UNE Request/Response Envelope      | 요청 검증, Provider 변환, 응답 정규화, Citation 결합, ChangeSet 생성 |
| UNI/T3Q Adapter           | Provider별 물리 API ↔ UNE Contract | 필드·상태·오류·Operation 차이 흡수                                   |
| HWPX Engine               | TemplateProfile + DocumentCommand  | Prototype 상속, 결정론적 편집, 저장·Round-trip 검증                  |

## 13.9 Contract v1.0 공통 객체

| **객체**         | **설계 확정내용**                                                                    |
|------------------|--------------------------------------------------------------------------------------|
| DocumentContext  | documentId, revision, documentType, templateId, 재난유형, 목차, 관련 Block, 참조자료 |
| SelectionContext | CURSOR/TEXT_RANGE/BLOCK/SECTION, start/end, documentRevision, selectionSnapshotHash  |
| ContentBlock     | blockId, type, styleRole, outlineLevel, text/table, sourceBlockIds                   |
| TemplateProfile  | 분석상태, 호환성, 신뢰도, 역할별 Prototype, 개요패턴, 영역, 미지원 기능              |
| Citation         | source/chunk/page/score와 supportsBlockIds                                           |
| ChangeSet        | baseRevision, 상태, DocumentCommand, Citation, 검증결과                              |
| Job/SSE          | 생성 상태, 진행률, Block 생성, ChangeSet 준비, 완료·오류 이벤트                      |
| Error            | DAI-1001~1702 표준코드와 retryable 여부                                              |

## 13.10 Operation 및 처리규칙

| **분류**  | **Operation**                                                                 | **처리원칙**                                      |
|-----------|-------------------------------------------------------------------------------|---------------------------------------------------|
| 생성      | GENERATE_OUTLINE / GENERATE_SECTION / GENERATE_DOCUMENT                       | Provider는 의미적 Outline/Blocks를 반환           |
| 선택편집  | INSERT_AT_CURSOR / REWRITE_SELECTION / EXPAND_SELECTION / SUMMARIZE_SELECTION | Selection 검증 후 Diff용 ChangeSet 생성           |
| 근거·구조 | ADD_EVIDENCE / CONVERT_SELECTION_TO_TABLE / VALIDATE_CONTENT                  | Citation 또는 Table/Validation 결과 반환          |
| 업무특화  | GENERATE_SOP_DRAFT / GENERATE_JOURNAL                                         | SOP 문맥 또는 ExecutionEvent 사실데이터 기반 생성 |

- Provider 응답은 HWPX XML이나 ParaShape/CharShape ID를 포함하지 않는다.

- UNE Orchestrator는 Provider의 의미적 Blocks를 검증한 뒤 DocumentCommand와 ChangeSet으로 변환한다.

- ChangeSet 적용 전 baseRevision과 selectionSnapshotHash를 확인하고 충돌 시 적용을 중단한다.

- 사용자가 수정하거나 잠근 Block은 명시적 승인 없이 교체·삭제하지 않는다.

- 상황일지는 ExecutionEvent의 시간·주체·행위 사실을 변경하지 않고 문장만 파생한다.

## 13.11 JSON Schema·OpenAPI 산출물

| **파일**                                   | **용도**                                               |
|--------------------------------------------|--------------------------------------------------------|
| common.schema.json                         | Operation, Selection, Block, Citation, Error 공통 타입 |
| request.schema.json / response.schema.json | AI 요청·응답 Envelope                                  |
| template-profile.schema.json               | 임의 HWPX 자동분석 결과                                |
| change-set.schema.json                     | ChangeSet과 DocumentCommand                            |
| sse-event.schema.json                      | 비동기 Job Event                                       |
| une-document-ai-contract.openapi.yaml      | REST/JSON 및 SSE Endpoint 초안                         |
| examples/\*.json                           | Operation별 개발·검증 Test Vector                      |

| **개발 착수 Gate** Schema Bundle을 TypeScript/C# 공통모델과 Validator의 기준으로 채택하고 Mock Provider가 대표 Test Vector를 반환하면 React/rhwp 및 UNE Backend 개발을 병행 착수한다. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 13.12 T3Q API Gap 확정 기준

| **Gap 항목**  | **확인 기준**                                                          |
|---------------|------------------------------------------------------------------------|
| Operation     | T3Q API가 목차/절/선택편집/근거/일지 Operation을 표현 가능한가         |
| Section/Block | sectionId, blockId, outlineLevel, styleRole을 구조적으로 전달 가능한가 |
| Citation      | sourceId, chunkId, page, score, supportsBlockIds를 제공하는가          |
| Job/Streaming | generationId와 상태·진행률·부분결과를 제공하는가                       |
| 오류          | 부분완료·취소·Timeout·검증오류를 구분 가능한가                         |
| 호환성        | 2차년도 기존 요청·응답을 유지하면서 v2 필드를 확장 가능한가            |

# 14. UNI RAG 선행검증 구조

## 14.1 목적

T3Q 2차년도 API를 3차년도 상세기능에 맞춰 선제적으로 변경하지 않고, UNE가 제어 가능한 UNI RAG/LLM 또는 Mock Provider로 실제 문서 생성 Operation·Schema·검증규칙을 먼저 확정한다.

## 14.2 검증 시나리오

| **No** | **시나리오**           | **검증 포인트**                |
|--------|------------------------|--------------------------------|
| P1     | 목차 생성              | Outline level/parent/styleRole |
| P2     | Section 생성           | Block 구조, Citation           |
| P3     | ○ 하위항목 추가        | 번호·들여쓰기 상속             |
| P4     | 선택 문단 재작성       | targetId 유지, 스타일 불변     |
| P5     | 근거 포함 재생성       | Citation binding               |
| P6     | 중간 문단 삽입         | Anchor 안정성, 번호 재계산     |
| P7     | 표 생성                | Table schema→원본 표스타일     |
| P8     | SOP 초안               | Task/Decision 구조             |
| P9     | Execution Log→상황일지 | 시간순 집계·근거 이벤트        |

## 14.3 산출물

• UNE Document AI Contract v1.0

• Prompt/Operation별 입력·출력 fixture

• Schema Validator

• HWPX Command mapping rule

• T3Q API Gap Matrix

• Contract Test Suite

## 14.4 UNI OpenAPI 실제 매핑

UNI RAG System v1.1.0 명세를 기준으로 상황일지 POC에 필요한 API가 확인되었다. /chat/json은 compns 요소 단위 SSE를 제공하여 SOP Flow 노드를 수신 즉시 화면에 그릴 수 있고, /documents/upload는 파일을 저장한 뒤 비동기 처리큐로 넘긴다. /search/는 LLM 생성 없이 검색·리랭킹 결과를 반환하므로 Evidence Context 사전검증에 적합하다.

/chat/json은 현재 명세상 인증 없이 호출 가능한 백엔드-투-백엔드 Endpoint이므로, 실제 통합 시 인터넷에 직접 노출하지 않고 UNE Backend 또는 API Gateway에서 서비스 계정·허용 IP·요청서명·Rate Limit을 적용한다.

| **UNE 논리기능**   | **UNI Endpoint**                  | **핵심 필드**                                                          | **Contract 변환**               |
|--------------------|-----------------------------------|------------------------------------------------------------------------|---------------------------------|
| UPLOAD_EVIDENCE    | POST /documents/upload            | file, uploader, force → doc_id                                         | UploadedDocument, UploadSession |
| SEARCH_EVIDENCE    | POST /search/                     | query, top_k → filename, score, text, doc_id                           | EvidenceSet, CitationCandidate  |
| GENERATE_SOP_DRAFT | POST /chat/json                   | query, model_key, top_k → \_\_compn\_\_, \_\_sources\_\_, \_\_done\_\_ | SOPNode ChangeSet, Citation     |
| EDITOR_COMMAND     | POST /chat/                       | query, model_key, history, stream, top_k, session_id, thinking, source | ContentBlock ChangeSet          |
| GET_REFERENCE      | GET /documents/{doc_id}/reference | reference dict 또는 202 처리중                                         | DocumentReference               |

# 15. T3Q API Gap Analysis 및 개선안

## 15.1 예비 Gap Matrix

| **영역**  | **2차년도 기준**         | **3차년도 요구**                        | **Gap/개선**                      |
|-----------|--------------------------|-----------------------------------------|-----------------------------------|
| 생성단위  | 전체 목차/전체 초안 중심 | Section/Block/선택영역                  | targetId, sectionId, blockId 추가 |
| Operation | 생성 중심                | rewrite/expand/summarize/table/validate | operation enum 표준화             |
| 응답구조  | 텍스트/문서단위          | ContentBlock\[\]                        | Structured Output 강제            |
| 근거      | 출처 규칙 중심           | 문단/claim별 Citation                   | citations\[\] 표준                |
| 상태      | 대기/생성중/완료/오류    | 검색/생성/검증/반영/부분완료            | generationId + status detail      |
| Streaming | 완료본문 실시간수신      | Block/Status 이벤트                     | SSE event schema                  |
| 오류      | 일반 응답오류            | 부분실패/재시도가능/검증실패            | errorCode/retryable/partial       |
| 버전      | 명시 약함                | Contract 버전 관리                      | schemaVersion                     |
| SOP       | 별도 시스템              | GENERATE_SOP_DRAFT                      | Task/Decision schema              |
| 상황일지  | 미설계                   | GENERATE_JOURNAL                        | ExecutionLog input/ref            |

## 15.2 개선 원칙

• T3Q API를 UNE 내부 표준으로 사용하지 않고 Adapter로 격리한다.

• 기존 2차년도 endpoint를 가능한 유지하고 v2 필드/operation을 확장한다.

• T3Q가 모든 Operation을 한 번에 제공하지 못해도 UNE Orchestrator에서 여러 호출을 조합 가능하게 한다.

• Gap 확정은 UNI POC 후 실제 fixture로 필드 단위 비교한다.

## 15.3 실제 T3Q 명세 반영 Gap 확정

| **항목**           | **현재 T3Q 명세**                           | **v0.8 판단**                                              |
|--------------------|---------------------------------------------|------------------------------------------------------------|
| 계획서 목차        | RPT-001: 구조화 sections 재귀 응답          | 사용 가능. UNE Outline 변환 필요                           |
| 계획서 본문        | RPT-002: sections/content/references 및 SSE | 사용 가능. Block ID·styleRole·revision은 UNE가 부여        |
| 일일상황일지       | RPT-003: data Object → result String 수준   | POC에 사용하지 않음. Execution Log 기반 구조화 계약 미충족 |
| 현재 재난상황정보  | 전용 조회 API 없음                          | UNE Situation Provider로 대체하고 향후 T3Q API 협의        |
| 사용자 자료 업로드 | 계획서·상황일지용 명세 없음                 | 상황일지 POC는 UNI Documents API 사용                      |
| SOP 구조화 생성    | 전용 compns/Task 생성 명세 없음             | 상황일지 POC는 UNI /chat/json 사용                         |
| 상황전파           | T3Q 역할 아님                               | UNE 내부 Propagation Manager 사용                          |

T3Q와의 후속 협의는 완성된 UNI POC Fixture와 UNE SituationContext·SOPGenerationContext·JournalProjection Schema를 제시한 뒤 필요한 필드만 요청하는 방식으로 진행한다. 과제 협업을 유지하되 UNE 개발일정은 T3Q 상황정보 API 확정에 종속시키지 않는다.

# 16. 데이터 모델

## 16.1 핵심 엔터티

| **도메인**  | **엔터티**                                                                              | **주요 관계**                                   |
|-------------|-----------------------------------------------------------------------------------------|-------------------------------------------------|
| Document    | Document, DocumentVersion, Section, Block, Citation                                     | Document 1:N Version; Version 1:N Section/Block |
| Template    | Template, TemplateVersion, TemplateProfile, StyleRole, Anchor                           | TemplateVersion 1:1 Profile                     |
| AI          | GenerationJob, GenerationResult, ValidationResult                                       | Document/Target와 연계                          |
| Incident    | Incident, SituationEvent, SituationSnapshot                                             | Incident 1:N Event                              |
| SOP         | SopDefinition, SopVersion, WorkflowInstance, TaskDefinition, TaskInstance, DecisionNode | Definition→Instance                             |
| Propagation | Propagation, Recipient, Acknowledgement                                                 | Task/Event와 연계                               |
| Execution   | ExecutionEvent, Attachment                                                              | 모든 상태변경 사실원장                          |
| Journal     | Journal, JournalVersion, JournalEntry                                                   | Entry→sourceEventIds                            |

## 16.2 주요 키/버전 원칙

• 모든 비즈니스 객체는 UUID 또는 충돌없는 ID를 사용하고 display 번호와 분리한다.

• Document/Template/SOP는 immutable version을 생성하고 currentVersionId를 별도 관리한다.

• ExecutionEvent는 append-only를 원칙으로 하며 정정은 correctionOfEventId로 연결한다.

• AI 결과는 generationId와 schemaVersion, provider/modelVersion을 기록한다.

• Block ID는 HWPX Paragraph/Anchor와 매핑 가능한 안정 ID로 유지한다.

## 16.2.1 편집·템플릿 분석 확장 엔터티

| **엔터티**         | **주요 필드**                                             | **관계/용도**                |
|--------------------|-----------------------------------------------------------|------------------------------|
| TemplateAnalysis   | id,templateVersionId,status,confidence,compatibilityLevel | TemplateVersion 1:N 분석이력 |
| OutlinePattern     | id,analysisId,level,symbol,leadingText,prototypeId        | 개요 역할 매핑               |
| ParagraphPrototype | id,templateVersionId,paraPrRef,charPrRef,xmlRef           | 원본 서식 Clone 기준         |
| EditSession        | id,documentVersionId,userId,revision,startedAt            | 웹 편집 세션                 |
| ChangeSet          | id,editSessionId,baseRevision,source,status,diff          | 사용자/AI 변경 단위          |
| DocumentLock       | targetId,lockType,owner,generationId,expiresAt            | Block 동시수정/생성 잠금     |

## 16.3 물리 DB 통합 원칙

2차년도 PostgreSQL/SQL Server 자산을 즉시 하나의 DB로 물리 통합하는 것을 전제로 하지 않는다. 3차년도는 논리 도메인과 API를 통합하고, 신규 공통 데이터(Document/Execution Log/Journal)는 PostgreSQL 중심으로 구성한다. 기존 SOP DB는 Migration/Adapter 비용을 고려하여 단계적으로 이관하거나 연계한다.

# 17. 인터페이스 설계

## 17.1 외부/내부 인터페이스 목록

| **IF-ID** | **구간**                 | **방식**              | **주요 데이터**               |
|-----------|--------------------------|-----------------------|-------------------------------|
| IF-01     | React↔UNE Backend        | REST + SSE            | 문서/Job/상태/편집            |
| IF-02     | UNE↔UNI RAG              | REST                  | AI Contract Adapter           |
| IF-03     | UNE↔T3Q                  | REST + Streaming 선택 | RAG/LLM 구조화 응답           |
| IF-04     | Orchestrator↔HWPX Engine | Internal API/WASM     | DocumentCommand/Render/Export |
| IF-05     | Orchestrator↔Workflow    | Internal API          | SOP/Task/Decision/Event       |
| IF-06     | Workflow↔전파채널        | REST/Webhook Adapter  | Propagation/ACK               |
| IF-07     | Execution Log↔Journal    | Internal Event/Query  | Event aggregation             |
| IF-08     | 외부 Tool 확장           | MCP Optional          | 향후 Agent Tool               |

## 17.2 주요 REST API 초안

| **Method** | **Endpoint**                                | **설명**              |
|------------|---------------------------------------------|-----------------------|
| POST       | /api/templates                              | HWPX 템플릿 등록      |
| POST       | /api/templates/{id}/analyze                 | Template Profile 분석 |
| POST       | /api/documents                              | 문서 생성             |
| POST       | /api/documents/{id}/outline:generate        | 목차 생성             |
| POST       | /api/documents/{id}/sections/{sid}:generate | 섹션 생성             |
| POST       | /api/documents/{id}/blocks/{bid}:rewrite    | 블록 재작성           |
| POST       | /api/documents/{id}:export                  | HWPX/PDF export       |
| POST       | /api/incidents                              | 상황 등록             |
| POST       | /api/sops/{id}:run                          | SOP 실행              |
| POST       | /api/tasks/{id}:ack                         | 임무 수신확인         |
| POST       | /api/tasks/{id}:complete                    | 임무 완료             |
| GET        | /api/incidents/{id}/timeline                | 전자상황판            |
| POST       | /api/incidents/{id}/journals:generate       | 상황일지 생성         |

## 17.2.1 범용 HWPX·Editor AI API 확장

| **Method** | **Endpoint**                                | **설명**                                |
|------------|---------------------------------------------|-----------------------------------------|
| POST       | /api/templates:upload                       | 임의 HWPX/기존문서 업로드               |
| POST       | /api/templates/{id}:analyze                 | Template/Outline/Compatibility 자동분석 |
| POST       | /api/templates/{id}:confirm                 | 모호한 역할 사용자 확인 후 Profile 확정 |
| GET        | /api/templates/{id}/analysis                | 신뢰도·미지원객체·Prototype 조회        |
| POST       | /api/documents/{id}/ai:operate              | SelectionContext 기반 공통 AI Operation |
| POST       | /api/documents/{id}/changesets/{cid}:apply  | AI Diff 승인 적용                       |
| POST       | /api/documents/{id}/changesets/{cid}:reject | AI 제안 폐기                            |
| POST       | /api/documents/{id}/blocks/{bid}:lock       | 사용자 확정/보호                        |
| DELETE     | /api/documents/{id}/blocks/{bid}:lock       | 보호 해제                               |
| GET        | /api/documents/{id}/compatibility           | 현재 문서 HWPX 저장 호환성 점검         |

## 17.3 SSE 이벤트

event: generation.status data:{generationId,status,progress}  
event: generation.block data:{generationId,blockId,sectionId,partial}  
event: workflow.task data:{instanceId,taskId,status}  
event: incident.timeline data:{incidentId,eventId,eventType,occurredAt}

## 17.4 오류 표준

| **코드**                  | **의미**                | **재시도**      |
|---------------------------|-------------------------|-----------------|
| AI_SCHEMA_INVALID         | AI 구조화 응답 검증실패 | Y               |
| AI_EVIDENCE_INSUFFICIENT  | 근거 부족               | 조건부          |
| DOC_COMMAND_FAILED        | 문서명령 실패           | Y/rollback      |
| HWPX_COMPATIBILITY_FAILED | HWPX 검증 실패          | N 또는 fallback |
| WORKFLOW_INVALID_STATE    | 상태전이 위반           | N               |
| PROVIDER_TIMEOUT          | AI Provider timeout     | Y               |
| VERSION_CONFLICT          | 동시편집/버전충돌       | 사용자 선택     |

## 17.5 상황정보·UNI SOP 내부 API

| **Method** | **UNE Endpoint**                            | **기능**                                                       |
|------------|---------------------------------------------|----------------------------------------------------------------|
| POST       | /api/incidents                              | 상황/훈련 기본정보 등록                                        |
| POST       | /api/incidents/{id}/situation-context/fetch | 공식 외부정보 Provider 병렬 조회                               |
| POST       | /api/incidents/{id}/situation-context/merge | 후보 Fact 선택·충돌해결·Snapshot 확정                          |
| POST       | /api/incidents/{id}/evidence/upload         | UNI 업로드 요청을 감싸고 UploadSession 생성                    |
| GET        | /api/incidents/{id}/evidence/{docId}/status | 문서 학습상태·참고요약 조회                                    |
| POST       | /api/incidents/{id}/sop/generate            | Evidence Context 구성 후 UNI /chat/json 호출                   |
| POST       | /api/incidents/{id}/sop/{sopId}/approve     | SOP 승인 및 Workflow Instance 생성                             |
| POST       | /api/incidents/{id}/journal/generate        | Execution Log와 SituationSnapshot으로 상황일지 Projection 생성 |

외부 Provider의 실제 URL·인증키는 프론트엔드에 노출하지 않는다. React는 UNE Backend만 호출하고, UNE Adapter가 기상청·행정안전부·국민안전24와 통신한다.

# 18. 개발·검증 시나리오

## 18.1 기능 E2E 시나리오

| **ID** | **시나리오**                                    | **성공기준**                              |
|--------|-------------------------------------------------|-------------------------------------------|
| E2E-01 | 코로나 대비계획 HWPX 업로드→목차→본문→HWPX 저장 | 번호/스타일/표 유지, 한컴 정상 열기       |
| E2E-02 | 선택문단 재작성                                 | 대상 block만 변경, 주변 스타일/번호 불변  |
| E2E-03 | 폭염/호우 표 중심 보고서                        | 표 확장·페이지분할·수치 근거 유지         |
| E2E-04 | 훈련 Event→SOP→임무전파→완료                    | Execution Log 100% 축적                   |
| E2E-05 | Execution Log→상황일지                          | 시간순·출처 이벤트 매핑                   |
| E2E-06 | UNI→T3Q Provider 전환                           | UI/HWPX 계층 수정 없이 Contract Test 통과 |

## 18.1.1 v0.7 추가 E2E 시나리오

| **ID** | **시나리오**                     | **성공기준**                                                                    |
|--------|----------------------------------|---------------------------------------------------------------------------------|
| E2E-07 | 임의 HWPX 3종 업로드·자동분석    | 각 양식의 □/○·ㅇ/-·―/\*·※ 패턴, 선행공백, 문단속성 역할을 식별하고 Profile 생성 |
| E2E-08 | AI 생성 후 rhwp Editor 직접 수정 | 별도 변환 없이 생성결과가 Editor에 반영되고 직접 타이핑/삭제/Undo 정상          |
| E2E-09 | Cursor 위치 AI 삽입              | 현재 문맥과 동일 Level Prototype으로 삽입, 기호/들여쓰기/서식 일치              |
| E2E-10 | Drag 선택 재작성                 | 선택범위만 변경, 주변 paragraph/numbering/style 불변, Diff 제공                 |
| E2E-11 | 사용자 수정 보호                 | editedByUser/locked Block이 Section 재생성에서 보존                             |
| E2E-12 | 비표준 양식 확인지원             | 낮은 confidence 역할만 사용자 확인 후 재분석 없이 재사용                        |
| E2E-13 | HWPX Round-trip                  | 웹 편집→HWPX 저장→한컴 열기/저장→재오픈 시 핵심 구조·스타일 무결성              |

- E2E-14: Contract Schema 검증 - 요청·응답·Template Profile·ChangeSet 예시가 Draft 2020-12 검증을 통과한다.

- E2E-15: Provider 교체 - 동일 Test Vector를 UNI Adapter와 T3Q Adapter에 적용하고 UNE 응답 구조가 동일함을 확인한다.

- E2E-16: Revision 충돌 - 문서 Revision 또는 Selection Snapshot이 변경된 경우 ChangeSet 적용을 차단한다.

## 18.2 품질평가 축

| **축**   | **지표 예**                                    |
|----------|------------------------------------------------|
| 내용품질 | 필수항목 포함률, 전문가/사용자 만족도          |
| 근거성   | Citation 연결률, 근거없는 중요 claim 비율      |
| 문서품질 | 스타일보존율, 번호연속성, 표 레이아웃 오류     |
| 호환성   | 한컴 open/save 성공률, repair warning 0건      |
| Workflow | 전파/ACK/완료 이력 누락률, 상태전이 오류       |
| 성능     | 목차/Section 생성시간, HWPX render/export 시간 |
| 복원력   | AI timeout/부분실패/재시도 성공률              |

## 18.3 v0.8 상황정보·API E2E 시나리오

- E2E-17: 사용자가 위치와 발생시각을 입력하고 공식 기상·특보·재난문자 후보를 불러온 뒤 일부만 선택하여 SituationSnapshot을 확정한다.

- E2E-18: 공식 API 한 곳이 실패하면 나머지 Provider 결과와 캐시를 표시하고, 전체 실패 시 수동입력 모드로 전환한다.

- E2E-19: 동일 항목의 사용자 입력과 외부정보가 충돌하면 자동 덮어쓰지 않고 비교·선택 화면을 제공한다.

- E2E-20: 최근 훈련계획서를 UNI에 업로드하고 학습 완료 후 업로드 자료 우선으로 SOP compns를 SSE 수신·시각화한다.

- E2E-21: 공식 매뉴얼과 사용자 업로드 자료의 조치기준이 충돌하면 EvidenceConflict를 생성하고 승인 전 실행을 차단한다.

- E2E-22: 계획서 목차·본문 생성 중 UNI가 호출되지 않음을 통합로그로 확인한다.

- E2E-23: SOP 실행·문자/메일/방송 전파 과정에서 T3Q·UNI가 전파 API로 호출되지 않음을 확인한다.

# 19. 단계별 구현계획

## 19.1 구현 단계

| **단계**              | **목표**                       | **핵심 산출물**                              |
|-----------------------|--------------------------------|----------------------------------------------|
| 1\. 설계확정          | Contract/도메인/API 기준선     | 상세설계 v0.5→v1.0, Schema v1                |
| 2\. HWPX POC          | 대표양식 직접 생성/편집 검증   | rhwp Fork/Adapter, Template Analyzer, 회귀셋 |
| 3\. UNI AI POC        | Operation·Schema·규칙 검증     | UNI Adapter, fixtures, Contract Test         |
| 4\. 계획서 통합개발   | 목차/Section/Block/편집/export | Plan Generator v3                            |
| 5\. Workflow/상황일지 | SOP 실행·Execution Log·Journal | Workflow Engine, 전자상황판, Journal         |
| 6\. T3Q 통합          | API Gap 반영 및 Provider 전환  | T3Q Adapter v2, 통합시험                     |
| 7\. 실증준비          | 자연/사회재난 및 기관 실증     | 시나리오·매뉴얼·평가체계                     |

## 19.2 우선순위

• P0: HWPX Template Analyzer + Document JSON + Block/Anchor/Style mapping

• P0: UNI Provider POC + T3Q Contract Gap 확정

• P0: Execution Log 데이터모델

• P1: React HWPX Editor 제한기능 및 선택영역 AI 편집

• P1: SOP Workflow/전자상황판/상황일지 Projection

• P2: BPMN import/export Adapter, DMN 선택

• P2: MCP Tool Adapter

## 19.2.1 개발 착수 Gate와 선행 설계 산출물

| **산출물**               | **착수 전 수준** | **핵심 확정사항**                                            | **개발 연계**                 |
|--------------------------|------------------|--------------------------------------------------------------|-------------------------------|
| 통합플랫폼 상세설계      | v0.9             | 6장·9~17장 구현수준, 사용자 시나리오/상태/시퀀스             | 전팀 기준선                   |
| UNE Document AI Contract | v1.0             | Selection/Block/Template/ChangeSet/Operation JSON Schema     | FE·BE·AI Adapter 공통         |
| HWPX Engine 상세명세     | v1.0             | Analyzer/Prototype/Outline/Editor/Save/Validation 인터페이스 | rhwp/Office-MCP 리팩토링 담당 |
| 화면흐름·기능정의        | v1.0             | Workspace, Cursor/Drag AI UX, Diff/Lock/호환성 화면          | React 개발                    |
| API·DB·Sequence 상세     | v0.9+            | Endpoint, 상태전이, 오류, revision/lock, 주요 sequence       | Backend/통합시험              |

개발은 모든 POC 종료 후 일괄 착수하지 않는다. Contract/화면흐름/핵심 인터페이스를 먼저 고정한 뒤 React Shell·Mock 기반 UI와 rhwp POC를 병행하고, HWPX 저장/호환성 검증결과를 v0.9~v1.0 설계에 환류한다.

## 19.3 최종 의사결정

| **결정** | **내용**                                                                                                                             |
|----------|--------------------------------------------------------------------------------------------------------------------------------------|
| D-01     | 두 기능은 하나의 React 통합플랫폼으로 구현                                                                                           |
| D-02     | UNE Document Orchestrator와 Document AI Contract를 핵심 자체기술로 소유                                                              |
| D-03     | HWPX 엔진은 rhwp 중심으로 활용하고 필요 기능은 UNE 방식으로 수정·확장                                                                |
| D-04     | Office-MCP의 HWPX/HTML/Tool 패턴을 적극 활용하되 Adapter로 종속성 격리                                                               |
| D-05     | Process-GPT 전체 플랫폼은 도입하지 않고 Workflow/HITL/감사 패턴을 차용                                                               |
| D-06     | BPMN은 선택적 표현/교환, MCP는 선택 확장                                                                                             |
| D-07     | UNI RAG 선행검증 후 T3Q API Gap을 확정                                                                                               |
| D-08     | Execution Log를 사실원장으로 하고 상황일지를 파생 문서로 생성                                                                        |
| D-09     | UNE는 챗봇을 개발하지 않음                                                                                                           |
| D-09     | rhwp Web Editor를 계획서 생성도구의 중앙 Single Editing Surface로 사용하고 별도 “미리보기 전용” 화면 의존을 축소                     |
| D-10     | AI 편집 대상은 Cursor/Text Range/Block/Section 4종으로 표준화하고 화면 좌표 대신 안정 ID+offset/range 사용                           |
| D-11     | 임의 HWPX 업로드를 핵심요구로 채택. 자동분석→신뢰도/호환성→사용자 확인(필요 시)→Template Profile 확정                                |
| D-12     | AI는 개요기호·선행공백·들여쓰기·ParaShape/CharShape/Numbering을 직접 생성하지 않으며 원본 Paragraph/Table Prototype을 Clone하여 상속 |
| D-13     | 사용자 직접수정은 editedByUser/locked로 보호하고 AI 변경은 ChangeSet/Diff 승인 후 적용                                               |

## 19.4 v0.8 구현 우선순위 조정

P0-1은 T3Q Plan Provider Adapter와 계획서 Contract Test, P0-2는 HWPX/rhwp Document Engine 핵심 POC, P0-3은 SituationContext Schema와 공식 OpenAPI Adapter, P0-4는 UNI Upload/Search/chat-json 기반 SOP POC로 구분한다. 국민안전24 HTML Adapter는 P1, 네이버 웨더세이프 사용자 요청형 보조수집은 P1/P2 Feature Flag 기능으로 두며 운영 전 조건을 재검토한다.

# 20. 재난상황정보 수집·Provider 적용 설계

## 20.1 설계문제와 최종 결정

T3Q 명세에는 현재 재난상황정보를 구조화하여 조회하는 전용 API가 없으므로, 상황일지 개발을 대기시키지 않고 UNE가 외부정보 수집·정규화 계층을 직접 구현한다. 현재 상황정보는 AI/RAG와 분리된 Fact Provider 영역으로 설계하고, T3Q가 향후 상황정보 API를 제공하면 동일 인터페이스의 추가 Adapter로 연결한다.

## 20.2 데이터원 우선순위

| **우선순위** | **데이터원**                   | **용도**                                | **적용상태**                          |
|--------------|--------------------------------|-----------------------------------------|---------------------------------------|
| 1            | 사용자 직접입력·현장보고       | 최초상황, 피해, 통제, 현장판단          | 필수·최우선, 자동덮어쓰기 금지        |
| 2            | 기상청 단기예보/초단기실황 API | 기온, 강수, 바람, 습도, 예보            | 운영 1차 데이터원                     |
| 3            | 기상청 기상특보 API            | 호우·폭염·대설·태풍 등 특보/예비특보    | 운영 1차 데이터원                     |
| 4            | 행정안전부 긴급재난문자 API    | 지역별 재난문자·발령시각·재난유형       | 운영 1차 데이터원                     |
| 5            | 국민안전24 웹 정보             | 재난상황정보·기상특보·재난문자 교차확인 | 공식 API 실패 시 보조/캐시            |
| 6            | 네이버 웨더세이프              | 여러 재난·기상정보 통합표출 참고        | 사용자 외부링크/비교만, 자동수집 제외 |

## 20.3 수집 아키텍처

KMA Forecast Adapter ─┐  
KMA Warning Adapter ─┤  
MOIS Message Adapter ─┼─\> Situation Normalizer ─\> Deduplicator ─\> Quality Validator  
SafeKorea Web Adapter ─┘ │  
▼  
SituationCandidate Store  
│  
사용자 비교·선택·확정  
▼  
SituationSnapshot

공식 API는 요청 시 조회와 짧은 주기 캐시를 병행한다. 국민안전24 웹 수집은 요청마다 직접 크롤링하지 않고 서버측 Collector가 낮은 빈도로 수집·캐시하며, DOM 변경 감지·파서 실패 알림·원문 URL 보존을 적용한다.

## 20.4 표준 SituationContext

{  
"incidentId": "INC-2026-001",  
"location": {"name":"○○시 ○○동","lat":0.0,"lon":0.0,"adminCode":"..."},  
"asOf": "2026-07-26T09:00:00+09:00",  
"facts": \[  
{  
"factId":"FACT-001", "category":"WEATHER_WARNING",  
"value":{"hazard":"HEAT","level":"WARNING"},  
"observedAt":"...", "retrievedAt":"...",  
"provider":"KMA_WARNING", "sourceUrl":"...",  
"freshness":"CURRENT", "confidence":1.0,  
"selected":true, "userModified":false  
}  
\],  
"summary":{"status":"USER_CONFIRMED","version":3}  
}

## 20.5 필수 Fact 범주

| **범주**            | **대표 필드**                                   | **상황일지/SOP 활용**      |
|---------------------|-------------------------------------------------|----------------------------|
| WEATHER_OBSERVATION | temperature, rainfall1h, humidity, windSpeed    | 현 시점 환경조건           |
| WEATHER_FORECAST    | forecastTime, precipitation, temperatureRange   | 향후 상황전망·선제조치     |
| WEATHER_WARNING     | hazard, level, issuedAt, effectiveAreas         | SOP 발령조건·위기단계 참고 |
| DISASTER_MESSAGE    | messageId, disasterType, area, sentAt, text     | 대외 경보·주민안내 사실    |
| FIELD_REPORT        | reporter, location, damage, control, attachment | 현장 사실·피해·통제        |
| USER_ASSERTED       | field, value, reason                            | 담당자 직접 입력·보정      |

## 20.6 최신성·중복·충돌 규칙

각 Fact에는 observedAt/issuedAt과 retrievedAt을 별도로 저장한다. 동일 Provider·동일 식별자의 재수집은 갱신으로 처리하고, 다른 Provider가 같은 사건을 제공하면 시간·지역·재난유형·본문 유사도로 중복그룹을 만든다. 공식 API와 웹 보조정보가 충돌하면 공식 API를 기본 후보로 제시하되 사용자가 최종 선택한다.

| **상태**    | **판정 예**         | **UI/처리**                                  |
|-------------|---------------------|----------------------------------------------|
| CURRENT     | 갱신주기 이내       | 정상 표시                                    |
| AGING       | 예상 갱신주기 초과  | 노란색 최신성 경고                           |
| STALE       | 허용 임계 초과      | SOP 자동생성 기본 제외, 사용자 강제포함 가능 |
| CONFLICT    | 동일 항목 값 불일치 | 비교화면 후 사용자 선택                      |
| UNAVAILABLE | Provider 장애       | 캐시/수동입력 전환                           |

## 20.7 보완된 상황등록 사용자 흐름

① 상황/훈련 기본정보 입력  
② 현재 상황정보 불러오기(선택)  
③ 공식 기상·특보·재난문자 후보 확인  
④ 사용자 입력과 외부정보 비교·선택  
⑤ SituationSnapshot 확정  
⑥ 사용자 훈련자료 업로드 또는 학습 DB 선택  
⑦ UNI Search + SOP JSON 생성  
⑧ SOP 검토·승인·실행  
⑨ UNE 내부 전파·수신·완료 이력 축적  
⑩ SituationSnapshot + Execution Log 기반 상황일지 생성

## 20.8 향후 T3Q 상황정보 API 수용

T3Q 상황정보 API가 협의·개발되면 T3qSituationProvider를 추가하고 동일 SituationFact로 변환한다. 기존 KMA/MOIS Provider를 제거하지 않고 비교·보완에 활용하며, Provider별 가용성·최신성·정확성 지표를 실증에서 평가한다.

# 부록 A. 설계 추적 및 연계문서

| **설계항목**     | **근거/연계**                                                               |
|------------------|-----------------------------------------------------------------------------|
| 3차년도 UNE 범위 | 연차변경용 연구개발계획서: 계획서 고도화, 상황일지 생성, 복구계획/평가 지원 |
| HWPX 고도화      | 6/19 회의록: HWPX 변환, 템플릿 종류 추가                                    |
| 상황일지/SOP     | 6/19 회의록: SOP 생성→전파→확인/완료→시간별 이력→전자상황판                 |
| 품질/Export      | 단계평가 종합의견: 다양한 파일 export, 시나리오 구체화, 품질검증 보완       |
| 2차년도 기준선   | 상세설계서: 기준정보 JSON, React/.NET, DOC/PDF 우회, 디지털 SOP 요구사항    |
| 기술선정         | 기술심층검토서 v1.0/R1: rhwp, Office-MCP, Process-GPT, BPMN/DMN/MCP 판정    |

# 부록 B. 후속 산출물

• UNE Document AI Contract v1.0 JSON Schema

• T3Q API Gap Analysis 상세표(필드/endpoint/상태코드)

• 논리 ERD 및 물리 데이터사전

• 인터페이스 정의서(IDC) / OpenAPI

• HWPX POC 결과 및 한컴 호환성 시험서

• 통합 화면설계서

• E2E/실증 시험시나리오 및 평가표

# 부록 C. v0.7 신규 설계 요구사항 목록

| **ID**        | **요구사항**                                            | **우선순위** | **검증**         |
|---------------|---------------------------------------------------------|--------------|------------------|
| UFR-HWPX-04   | 사용자 임의 HWPX/기존문서 업로드 및 자동분석            | P0           | E2E-07/12        |
| UFR-HWPX-05   | 개요기호·공백·들여쓰기·문단/글자서식 Prototype 자동추출 | P0           | E2E-07           |
| UFR-HWPX-06   | Template 분석 신뢰도/호환성 판정 및 사용자 확인         | P0           | E2E-12           |
| UFR-EDITOR-03 | rhwp Web Editor를 단일 편집 Surface로 제공              | P0           | E2E-08           |
| UFR-EDITOR-04 | Cursor 기반 AI 삽입                                     | P0           | E2E-09           |
| UFR-EDITOR-05 | Drag Text Range 기반 AI 재작성                          | P0           | E2E-10           |
| UFR-EDITOR-06 | Block/Section 단위 AI 생성·재생성                       | P0           | E2E-02/10        |
| UFR-EDITOR-07 | AI 변경 Diff/적용/취소 및 Undo/Redo                     | P1           | E2E-10           |
| UFR-EDITOR-08 | 사용자 수정 Block 자동 보호/Lock                        | P0           | E2E-11           |
| NFR-HWPX-03   | AI가 HWPX/XML/styleId/개요기호/공백 직접 생성 금지      | P0           | Contract Test    |
| NFR-HWPX-04   | 원본 Prototype Clone 기반 스타일 상속                   | P0           | E2E-07/09        |
| NFR-HWPX-05   | Round-trip 및 한컴 호환성 등급화                        | P0           | E2E-13           |
| NFR-EDIT-01   | revision/lock 기반 동시수정 충돌방지                    | P1           | Concurrency Test |

v0.7의 신규 요구사항은 UNE Document AI Contract v1.0 Schema Bundle, HWPX Engine 상세명세 v1.0, T3Q API Gap Matrix 및 통합플랫폼 상세설계 v0.9의 추적 기준으로 사용한다.

# 부록 D. v0.8 API·외부정보 출처

• T3Q MOIS API 명세 v0.8.5: 계획서 목차·본문·일일상황일지·대화형 API 필드 기준

• UNI RAG System OpenAPI v1.1.0: /documents/upload, /search/, /chat/json, /chat/ 등 상황일지 POC 기준

• 국민안전24: 재난상황정보, 기상특보, 재난문자 교차확인용

• 기상청 단기예보 조회서비스 및 기상특보 조회서비스: 공식 기상 Fact

• 행정안전부 긴급재난문자 API: 공식 재난문자 Fact

• 네이버 웨더세이프: 사용자 요청형 보조수집 또는 외부 확인 링크. 운영 전 이용조건·DOM 안정성 검토 및 Feature Flag 적용

# 21. HWPX/rhwp Document Engine 상세명세

본 장은 임의 HWPX 양식 분석, 원본 서식 상속, rhwp 웹 편집, 선택영역 AI 편집, ChangeSet 적용, HWPX 저장 및 한컴 Round-trip 검증을 개발 가능한 수준으로 정의한다. rhwp를 그대로 사용하는 것이 아니라 UNE Adapter/Fork와 보존형 Serializer를 구현한다.

## 21.1 목적·적용범위·비범위

| **구분** | **설계 범위**                                               | **책임**                         |
|----------|-------------------------------------------------------------|----------------------------------|
| 입력     | 사용자가 업로드한 HWPX, 기존 완성문서, 시스템 제공 최소양식 | HWPX Package Reader              |
| 분석     | 페이지·문단·글자·개요·번호·표·필드·정적영역·미지원 객체     | TemplateAnalyzer                 |
| 편집     | Cursor/Range/Block/Section 선택과 직접편집·AI 편집          | rhwp Adapter + SelectionResolver |
| 적용     | Diff·잠금·Revision 검사 후 원자적 ChangeSet 적용            | ChangeSetExecutor                |
| 출력     | 원본 패키지 보존형 HWPX 저장, PDF/DOCX 보조 Export          | HwpxSerializer                   |
| 검증     | 구조·의미·서식·시각·한컴 열기/저장/재열기                   | RoundTripValidator               |

| **비범위** LLM이 HWPX XML, ParaShape ID, CharShape ID, 앞 공백 또는 개요기호를 직접 생성하는 구조는 허용하지 않는다. AI는 의미적 Block과 outlineLevel/styleRole만 반환한다. |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 21.2 엔진 컴포넌트와 처리경계

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>React Workspace<br />
│ DocumentCommand / SelectionContext<br />
▼<br />
rhwp Editor Adapter ──&gt; SelectionResolver<br />
│ │<br />
│ ▼<br />
├──────────────&gt; ChangeSetExecutor ──&gt; DocumentState / Undo Stack<br />
│ │<br />
▼ ▼<br />
TemplateAnalyzer HWPX Serializer<br />
├─ OutlinePatternAnalyzer ├─ XML Delta Writer<br />
├─ ParagraphPrototypeRegistry ├─ Reference Rebuilder<br />
├─ CompatibilityValidator └─ Package Writer<br />
└─ StaticRegionClassifier │<br />
▼<br />
RoundTripValidator</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **컴포넌트**        | **주요 입력**               | **주요 출력**              | **핵심 보장**                |
|---------------------|-----------------------------|----------------------------|------------------------------|
| HWPX Package Reader | HWPX byte stream            | PackageParts, SourceHash   | Zip-slip 차단, 미지 XML 보존 |
| Document IR Builder | PackageParts                | DocumentIR                 | 안정 ID·참조 인덱스          |
| TemplateAnalyzer    | DocumentIR                  | TemplateAnalysisResult     | 역할·신뢰도·호환성           |
| PrototypeRegistry   | 분석된 원본문단/표          | Paragraph/Table Prototype  | 원본 서식 Clone              |
| SelectionResolver   | Editor selection + revision | 정규화 SelectionContext    | UTF-16 offset·범위 검증      |
| ChangeSetExecutor   | ChangeSet + DocumentState   | New revision + inverse ops | 원자성·Undo/Redo             |
| HwpxSerializer      | DocumentIR + SourceParts    | HWPX                       | 최소변경·ID 무결성           |
| RoundTripValidator  | 원본/결과/한컴 재저장본     | ValidationReport           | 구조·시각·의미 회귀          |

## 21.3 Canonical Document IR

Document IR은 HWPX XML을 완전히 평탄화하지 않는다. 편집에 필요한 Canonical Node와 원문 XML Anchor를 함께 유지하는 보존형 중간모델이다. 알려지지 않은 컨트롤·속성·네임스페이스는 raw fragment로 보존하여 저장 시 손실을 방지한다.

| **객체**    | **필수 속성**                                          | **설명**                       |
|-------------|--------------------------------------------------------|--------------------------------|
| DocumentIR  | documentId, revision, sourceHash, sections, styleIndex | 편집 세션의 기준 객체          |
| SectionIR   | sectionId, blocks, pageSettings                        | section\*.xml 단위             |
| ParagraphIR | paragraphId, runs, styleRef, editState, rawXmlAnchor   | 문단 단위 안정 ID              |
| RunIR       | runId, text, charPrId, controls                        | 문자열과 인라인 제어           |
| TableIR     | tableId, rows/cells, spans, prototypeId                | 셀 내부 Block 포함             |
| StyleRef    | paraPrId, charPrId, numberingId, styleId               | Header reference table 연결    |
| UnknownPart | partPath, contentType, hash                            | 미지원 패키지 Part 무손실 보존 |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>{<br />
"paragraphId": "P-01J...",<br />
"styleRole": "OUTLINE_2",<br />
"outlineLevel": 2,<br />
"styleRef": {"paraPrId": 25, "charPrId": 13, "numberingId": null},<br />
"prototypeId": "PROTO-OUTLINE-2",<br />
"editState": {"editedByUser": true, "locked": false},<br />
"rawXmlAnchor": "Contents/section0.xml#p[17]"<br />
}</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 21.4 HWPX Package Reader 처리 알고리즘

> **1.** 파일 확장자와 MIME만 믿지 않고 ZIP Signature, mimetype, content.hpf, Header/Contents 필수 Part 존재 여부를 교차 검증한다.
>
> **2.** 압축 해제 전 Entry 수, 개별/총 압축해제 크기, 상대경로, 중복경로를 검사하여 Zip Bomb과 Path Traversal을 차단한다.
>
> **3.** XML은 네임스페이스 인식 Parser로 읽고 외부 엔터티와 DTD를 비활성화한다.
>
> **4.** header.xml의 paraPr/charPr/style/numbering/bullet/binData 참조표를 먼저 색인한 후 section Part를 순차 파싱한다.
>
> **5.** 원본 Part 순서·압축방식·알 수 없는 요소·관계파일을 SourcePreservationMap에 기록한다.
>
> **6.** 오류가 치명적이지 않으면 LIMITED 호환성으로 열고, 참조 깨짐·필수 Part 누락은 REJECT로 처리한다.

| **검사코드** | **조건**              | **처리**             |
|--------------|-----------------------|----------------------|
| HWPX-1001    | ZIP/HWPX 서명 불일치  | 업로드 거부          |
| HWPX-1002    | 압축해제 한도 초과    | 업로드 거부·감사로그 |
| HWPX-1003    | 필수 Part 누락        | REJECT               |
| HWPX-1004    | 미지원 객체 존재      | LIMITED + 원문 보존  |
| HWPX-1005    | 깨진 스타일/번호 참조 | CONFIRM 또는 REJECT  |

## 21.5 TemplateAnalyzer 입출력과 분석 알고리즘

| **입력**               | **필드**                                                                                                                                |
|------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|
| AnalyzeTemplateRequest | fileId, analysisMode, roleHints, preserveContent, maxSampleParagraphs                                                                   |
| 문단 Feature           | prefix, whitespace, textLength, paraPrId, charPrId, indent, margins, spacing, heading/numbering, tableContext, pagePosition, repetition |
| 출력                   | TemplateAnalysisResult: compatibility, roles, outlinePatterns, prototypes, staticRegions, warnings                                      |

> **1.** 문단별 Style Signature를 생성한다. Signature는 ParaShape/CharShape ID뿐 아니라 실제 속성값과 prefix·들여쓰기·문단 간격을 포함한다.
>
> **2.** 빈 문단·본문·제목·표제·주석·개요 후보를 규칙 기반으로 1차 분류한다.
>
> **3.** 동일 Signature와 유사 Feature를 군집화하고 문서 내 반복빈도·선후 계층·페이지 위치를 계산한다.
>
> **4.** 제목/개요/주석/표 기본형 후보마다 규칙 점수와 반복 근거를 합산하여 confidence를 산출한다.
>
> **5.** confidence가 기준 이상이면 AUTO, 중간이면 CONFIRM, 복잡객체가 있으나 핵심 편집 가능하면 LIMITED, 핵심 구조 해석 불가면 REJECT로 판정한다.
>
> **6.** 확정된 역할마다 원본문단 또는 표를 불변 Prototype으로 등록한다.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>confidence = 0.30*styleConsistency<br />
+ 0.20*prefixConsistency<br />
+ 0.15*indentHierarchy<br />
+ 0.15*repetitionEvidence<br />
+ 0.10*positionEvidence<br />
+ 0.10*semanticHint<br />
<br />
AUTO &gt;= 0.85<br />
CONFIRM 0.60~0.84<br />
LIMITED &lt; 0.60 또는 미지원 객체 포함<br />
REJECT 필수구조/참조 무결성 실패</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 21.6 OutlinePatternAnalyzer 상세 알고리즘

개요분석은 문자형 기호와 한글 자동 개요/문단번호를 구분한다. 앞 공백을 단순 trim하지 않고 literalPrefix, leadingWhitespace, trailingWhitespace, paragraph indent를 각각 저장한다.

| **단계**               | **판정 기준**                                   | **결과**                             |
|------------------------|-------------------------------------------------|--------------------------------------|
| 1\. 자동번호 검사      | heading type, numbering/bullet 참조, level 속성 | AUTO_NUMBERING 또는 OUTLINE_PROPERTY |
| 2\. 문자형 Prefix 검사 | □, ○/ㅇ, -, ―, ※, \*, 숫자/가/괄호 패턴         | LITERAL_PREFIX                       |
| 3\. 공백 검사          | space/tab/비분리 공백의 실제 문자열             | leadingWhitespace/trailingWhitespace |
| 4\. 계층 추론          | leftMargin, indent, prefix width, 문단 순서     | outlineLevel 후보                    |
| 5\. 반복 검증          | 동일 패턴의 출현 빈도와 부모-자식 전이          | confidence                           |
| 6\. 사용자 확인        | 상충하는 level·강조기호                         | CONFIRM 항목                         |

| **샘플 검증 기준** 업로드된 3종 양식의 서로 다른 패턴(□→ㅇ→-→\*, □→○→―→※ 등)을 독립 Pattern으로 저장한다. 문자 앞 공백과 ParaShape 들여쓰기를 모두 복제해야 한다. |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 21.7 ParagraphPrototypeRegistry

Prototype은 스타일 ID 목록이 아니라 원본문단/표의 재사용 가능한 구조체이다. 기본 정책은 CLONE_XML이며, 안전하게 재구성 가능한 단순 문단만 CLONE_IR 또는 REBUILD_ALLOWED를 허용한다.

| **속성**               | **규칙**                                                                    |
|------------------------|-----------------------------------------------------------------------------|
| prototypeId            | Template Profile 내 영구 ID. 역할 변경 시 새 버전 생성                      |
| sourceParagraphId      | 원본 문단 추적. 원본 삭제와 무관하게 raw fragment 보존                      |
| styleRole/outlineLevel | 의미적 매핑 키                                                              |
| clonePolicy            | CLONE_XML 우선. 미지원 속성 손실 방지                                       |
| prefixPolicy           | KEEP_SOURCE_PREFIX / REPLACE_TEXT_ONLY / NUMBERING_ENGINE                   |
| fallbackChain          | 동일 level → 인접 level → BODY → 시스템 기본형                              |
| immutability           | 원본 Prototype은 수정 금지. 사용자 변경은 새 Custom Prototype으로 승격 가능 |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>resolvePrototype(styleRole, outlineLevel, tableContext):<br />
1) exact(templateId, styleRole, outlineLevel, tableContext)<br />
2) same role without tableContext<br />
3) nearest outline level in same family<br />
4) BODY_DEFAULT<br />
5) SYSTEM_SAFE_DEFAULT + warning</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 21.8 SelectionResolver

| **선택 유형** | **입력**                     | **정규화 결과**          |
|---------------|------------------------------|--------------------------|
| CURSOR        | paragraphId, offset          | collapsed range          |
| TEXT_RANGE    | start/end paragraphId+offset | 정방향 범위              |
| BLOCK         | blockIds                     | 연속/비연속 Block set    |
| SECTION       | sectionId                    | Section 전체 Block range |
| TABLE_CELL    | tableId, cellId, local range | 셀 경계 내 Selection     |

React/JavaScript와의 일관성을 위해 offset 단위는 UTF-16 code unit으로 고정한다. Serializer 직전 XML text node offset으로 다시 매핑하며, 결합문자·이모지·필드 제어문자에 대한 경계검사를 수행한다.

> **1.** baseRevision이 현재 DocumentState.revision과 일치하는지 검사한다.
>
> **2.** paragraphId/blockId가 현재 문서에 존재하는지 확인하고, split/merge 이력의 alias map으로 가능한 경우 재해석한다.
>
> **3.** start/end를 정방향으로 정규화하고 범위가 잠금영역·정적영역·표 경계를 침범하는지 검사한다.
>
> **4.** 시각 좌표는 입력받지 않는다. Editor 좌표는 paragraphId+offset으로 변환된 후에만 Contract에 전달한다.
>
> **5.** 해결 실패 시 최신 revision과 재선택 요구 정보를 DAI-1401/1402로 반환한다.

## 21.9 ChangeSetExecutor

| **Operation**    | **필수 인자**         | **적용 규칙**             |
|------------------|-----------------------|---------------------------|
| INSERT_BLOCKS    | anchor, blocks        | Prototype Resolve 후 삽입 |
| REPLACE_RANGE    | selection, blocks     | 원문 보존·Diff 생성       |
| DELETE_RANGE     | selection             | 잠금/정적영역 금지        |
| SPLIT_PARAGRAPH  | paragraphId, offset   | 동일 Prototype 상속       |
| MERGE_PARAGRAPHS | left/right IDs        | 호환 Style 검사           |
| MOVE_BLOCK       | blockId, targetAnchor | 참조/목차 갱신            |
| APPLY_STYLE_ROLE | blockId, styleRole    | 직접 styleId 설정 금지    |
| TABLE_PATCH      | tableId, cell ops     | span·셀 최소 1문단 유지   |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>apply(changeSet):<br />
validateSchema()<br />
checkBaseRevision()<br />
resolveTargets()<br />
checkLocksAndStaticRegions()<br />
dryRunAndBuildDiff()<br />
beginTransaction()<br />
applyOperationsInOrder()<br />
rebuildIndexesAndReferences()<br />
generateInverseOperations()<br />
incrementRevision()<br />
commit()<br />
emit(document.changed, diff, newRevision)<br />
<br />
on error: rollback() + no partial document mutation</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

Undo/Redo는 AI 편집과 사용자 편집을 구분하지 않고 동일 ChangeSet/InverseChangeSet 스택으로 관리한다. AI 변경은 기본적으로 PREVIEW 상태에서 사용자가 적용해야 COMMITTED가 된다.

## 21.10 HWPX Serializer 및 저장

> **1.** 원본 HWPX를 읽은 Source Package를 기준으로 변경된 Part만 XML Delta Writer가 갱신한다.
>
> **2.** 새 Para/Run/Table ID는 문서 전체 ID Index와 충돌하지 않도록 발급하고 참조표·관계·manifest를 동기화한다.
>
> **3.** 알 수 없는 요소·속성·Part는 원문 그대로 복사한다. 부모 노드 변경 시에도 raw fragment의 상대순서를 유지한다.
>
> **4.** mimetype, content.hpf, version, Preview, BinData 등 패키지 구성요소의 일관성을 검사한다.
>
> **5.** 원본 파일을 직접 덮어쓰지 않고 임시 HWPX 생성 → 구조검증 → 원자적 rename 순서로 저장한다.
>
> **6.** 저장 결과에는 outputFileId, sourceHash, outputHash, validationReportId, revision을 반환한다.

| **저장 모드** | **설명**                                 | **사용처**       |
|---------------|------------------------------------------|------------------|
| SAVE_AS       | 새 파일 생성, 원본 보존                  | 기본             |
| SAVE_REVISION | 동일 문서의 새 revision                  | 문서보관함       |
| EXPORT_COPY   | 개인정보·메타데이터 정책 적용 사본       | 외부 제출        |
| AUTOSAVE_IR   | HWPX 생성 없이 DocumentIR/ChangeSet 저장 | 편집 중 자동저장 |

## 21.11 Round-trip 검증

| **검증계층** | **검사 항목**                                  | **합격 기준**                |
|--------------|------------------------------------------------|------------------------------|
| Package      | ZIP, mimetype, manifest, 관계, XML well-formed | 치명오류 0                   |
| Reference    | paraPr/charPr/style/numbering/binData ID       | dangling reference 0         |
| Semantic     | 문단·표·텍스트·필드·개요 level                 | 의도치 않은 손실 0           |
| Style        | 글꼴, 크기, 장평, 간격, 들여쓰기, 번호         | Prototype 기준 일치          |
| Visual       | rhwp render before/after, 페이지·줄바꿈        | 허용영역 외 회귀 0           |
| Hancom       | 한컴 열기→저장→재열기                          | 오류 없이 열림·핵심구조 유지 |
| Edit         | Enter/Tab/Shift+Tab, Undo/Redo, 표 편집        | E2E 전부 통과                |

시각 Diff는 픽셀 완전일치가 아니라 변경 허용영역 마스크를 적용한다. 사용자가 수정한 Block 외 영역에서 페이지 이동·글꼴 대체·표 폭 변경이 발생하면 회귀로 판정한다.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>RoundTrip Matrix<br />
A. 원본 → rhwp open → save → 한컴 open<br />
B. 원본 → Template Analyze → AI insert → save → 한컴 open/save → rhwp reopen<br />
C. 표/병합셀 수정 → save → reopen<br />
D. 문자형 개요 Enter/Tab/Shift+Tab → save → reopen<br />
E. 자동번호 개요 추가/삭제 → save → reopen<br />
F. 미지원 객체 포함 문서 → 주변 문단 수정 → 객체 무손실 확인</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 21.12 성능·동시성·보안

| **항목** | **설계 기준**                                                   |
|----------|-----------------------------------------------------------------|
| 분석시간 | 일반 50쪽 HWPX P95 5초 이내를 목표. 대용량은 비동기 Job         |
| 편집응답 | Selection resolve/ChangeSet apply P95 300ms 이내(LLM 시간 제외) |
| Autosave | ChangeSet 로그 우선 저장, 5~15초 주기 IR snapshot               |
| 동시성   | Optimistic Lock(baseRevision). 충돌 시 자동 덮어쓰기 금지       |
| 파일보안 | 업로드 격리, 악성 ZIP/XML 차단, 확장자·MIME 이중검사            |
| 개인정보 | 문서별 접근권한, 다운로드 감사로그, 임시파일 TTL                |
| 오류복구 | 원본/마지막 정상 revision/ChangeSet log로 복원                  |

## 21.13 개발 인터페이스 초안

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>POST /api/v1/templates/analyze<br />
POST /api/v1/templates/{templateId}/confirm<br />
GET /api/v1/templates/{templateId}/profile<br />
POST /api/v1/documents/open<br />
POST /api/v1/documents/{documentId}/commands/preview<br />
POST /api/v1/documents/{documentId}/changesets/apply<br />
POST /api/v1/documents/{documentId}/undo<br />
POST /api/v1/documents/{documentId}/redo<br />
POST /api/v1/documents/{documentId}/save-hwpx<br />
GET /api/v1/validation/{reportId}</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **내부 인터페이스** | **메서드**                                                     |
|---------------------|----------------------------------------------------------------|
| TemplateAnalyzer    | analyze(DocumentIR, AnalyzeOptions) -\> TemplateAnalysisResult |
| PrototypeRegistry   | resolve(role, level, context) -\> Prototype                    |
| SelectionResolver   | resolve(DocumentState, SelectionEnvelope) -\> SelectionContext |
| ChangeSetExecutor   | preview/apply/revert(ChangeSet)                                |
| HwpxSerializer      | serialize(DocumentIR, SourcePackage) -\> HwpxBytes             |
| RoundTripValidator  | validate(source, output, optionalHancomResave) -\> Report      |

## 21.14 개발 완료 및 인수 기준

> **•** 임의 HWPX 10종 이상에서 AUTO/CONFIRM/LIMITED 판정과 분석근거가 재현된다.
>
> **•** 업로드 샘플 3종의 기호 앞 공백, 들여쓰기, ParaShape, 글자속성이 Prototype Clone으로 유지된다.
>
> **•** Cursor/Range/Block/Section 편집 및 AI ChangeSet이 Revision 충돌 없이 적용된다.
>
> **•** 사용자 수정/잠금 Block이 Section 재생성으로 덮어써지지 않는다.
>
> **•** 한컴 열기·저장·재열기 Round-trip에서 치명 손실이 없고 회귀보고서가 생성된다.
>
> **•** 미지원 객체가 있는 문서도 해당 객체를 삭제하거나 변형하지 않고 주변 지원영역만 편집한다.
>
> **•** Schema Bundle의 Document IR/Template/Prototype 예제가 CI에서 검증된다.

# 22. SituationContext·UNI Adapter·외부 Provider 상세명세

본 장은 상황일지 POC에서 사용할 현재 재난상황정보 입력, 사용자 훈련자료 업로드, UNI RAG 검색·SOP 생성·일반 편집, 상황확정 Snapshot 및 UNE 내부 전파/Execution Log 연계를 개발 수준으로 정의한다.

## 22.1 서비스별 Provider 적용결정

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

## 22.2 상황정보 입력 원칙과 사용자 흐름

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

## 22.3 SituationContext JSON Schema

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

## 22.4 SituationFact 범주와 Provenance

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

## 22.5 외부 Provider 수집 인터페이스

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

## 22.6 정규화·중복·최신성·충돌 알고리즘

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

## 22.7 상황등록 화면흐름

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

## 22.8 UNI 인증·Gateway 원칙

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

## 22.9 UNI 문서 업로드·학습 수명주기

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

## 22.10 UNI Search Adapter

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

## 22.11 UNI /chat/json SOP SSE Adapter

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

## 22.12 UNI /chat 일반 편집 Adapter

/chat/은 UNE가 챗봇 화면을 개발하기 위한 API가 아니다. SelectionContext와 확정 근거를 Prompt Builder가 명시적으로 전달하고, 결과를 Document AI Contract의 의미적 Block 또는 Patch 제안으로 변환한다.

| **Operation**     | **UNI query 구성**                 | **결과 처리**           |
|-------------------|------------------------------------|-------------------------|
| REWRITE_SELECTION | 선택본문+문체/길이/사실제약        | REPLACE_RANGE ChangeSet |
| EXPAND_SELECTION  | 선택본문+추가할 근거 ID            | 본문 확장 Diff          |
| ADD_EVIDENCE      | 선택본문+EvidenceChunk             | Citation 연결           |
| INSERT_AT_CURSOR  | 앞뒤 문맥+삽입목적                 | Prototype 적용 Block    |
| JOURNAL_SUMMARIZE | Snapshot+Execution Events+시간범위 | 상황일지 의미 Block     |

history/session_id는 UNE Document Session과 분리한다. UNI 세션 기능을 사용하더라도 UNE가 기준 revision, selection, evidence, operation을 감사로그에 보존하며 Provider 세션을 사실원장으로 사용하지 않는다.

## 22.13 SOP 생성 Prompt/Context 규칙

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

## 22.14 오류·Retry·Circuit Breaker

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

## 22.15 데이터보안·감사·개인정보

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

## 22.16 개발·인수 E2E

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

# 23. 산출물 문서체계와 계획서·사용자 시나리오 편성

## 23.1 최종 문서체계 결정

| **문서**                              | **내용**                                                       | **편성 결정**                                       | **주 독자**           |
|---------------------------------------|----------------------------------------------------------------|-----------------------------------------------------|-----------------------|
| 통합플랫폼 상세설계서                 | 전체 아키텍처, 업무흐름, 데이터, API, 알고리즘, 화면흐름, 검증 | 상세내용을 삭제·요약하지 않고 Master로 유지         | PM/아키텍트/개발/평가 |
| HWPX/rhwp Document Engine 상세명세    | 엔진 객체·알고리즘·입출력·오류·Round-trip                      | 별도 통제문서 병행 + Master 장에 핵심 상세내용 포함 | 문서엔진 개발/QA      |
| SituationContext·UNI Adapter 상세명세 | Schema, Provider, UNI endpoint/SSE, 화면, 오류                 | 별도 통제문서 병행 + Master 장에 핵심 상세내용 포함 | Backend/AI 연계/QA    |
| 개발계획서                            | WBS, 인력, 일정, 산출물, Gate, 리스크, 협업요청                | 설계 v0.9 동결 후 별도 파일                         | PM/개발팀/경영        |
| 사용자 시나리오·업무절차·인수시험서   | 역할별 시나리오, 화면행동, 예외, 데이터, 기대결과, 시험 ID     | 별도 파일 작성. Master에도 설계수준 E2E 유지        | 현업/UX/QA/실증기관   |
| 화면설계서                            | 화면목록, Wireframe, 상태, 권한, 메시지                        | 별도 파일, Scenario ID 추적                         | UX/FE/현업            |
| JSON Schema/OpenAPI Bundle            | 기계검증 가능한 Contract                                       | ZIP 별도 관리                                       | 개발/CI               |

## 23.2 계획서를 별도 파일로 두는 이유

> **•** 설계 기준과 달리 일정·인력·예산·협력기관 의존성은 수시로 변경되므로 설계서 개정 없이 운영계획을 갱신할 수 있어야 한다.
>
> **•** 개발계획서는 WBS·담당자·기간·완료기준·의존 API·리스크·의사결정 Gate를 관리하며, 상세설계 장 번호와 추적한다.
>
> **•** 통합설계서에는 기술 구현순서와 Gate를 계속 포함하되, 실제 일정과 자원배치는 별도 개발계획서가 기준이 된다.

## 23.3 사용자 시나리오를 별도 파일로 병행하는 이유

> **•** 사용자 시나리오는 현업 검토·UX 설계·인수시험·교육에서 반복 사용되므로 기술설계와 다른 독자 및 변경주기를 가진다.
>
> **•** 별도 시나리오 문서는 Actor, 사전조건, 정상흐름, 대체흐름, 예외, 사용 데이터, 화면, API, Execution Event, 결과, 인수기준을 한 건씩 관리한다.
>
> **•** Master 설계서의 사용자 흐름과 E2E를 삭제하지 않는다. 별도 문서는 동일 내용을 현업/시험 관점으로 재구성하고 Scenario ID로 양방향 추적한다.

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>Traceability<br />
Business Requirement -&gt; User Scenario (US-xxx)<br />
-&gt; Screen Flow (SCR-xxx)<br />
-&gt; API/Contract (API/DAI-xxx)<br />
-&gt; Data Entity/Schema<br />
-&gt; E2E Test (E2E-xxx)<br />
-&gt; Acceptance Evidence</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## 23.4 설계 완료 후 작성 순서

> **1.** v0.9와 두 상세명세를 개발 기준선으로 검토·동결한다.
>
> **2.** 미결정 항목을 ADR(Architecture Decision Record)로 확정한다.
>
> **3.** 개발계획서/WBS를 작성하여 POC와 본개발의 책임·일정·완료기준을 배정한다.
>
> **4.** 계획서 생성과 상황일지/안전한국훈련 사용자 시나리오를 역할별로 작성한다.
>
> **5.** 화면설계서와 API/DB/Sequence를 Scenario ID 기준으로 상세화한다.
>
> **6.** 인수시험서와 실증평가표를 시나리오에서 파생한다.

# 24. 개발 기준선·미결사항·세션 전환

## 24.1 v0.9 개발 기준선

| **영역**          | **기준선**                                               |
|-------------------|----------------------------------------------------------|
| Master            | 통합플랫폼 상세설계서 v0.9                               |
| AI Contract       | UNE Document AI Contract v1.0 + Schema Bundle            |
| 계획서 Provider   | T3Q RPT-001/002                                          |
| 상황일지 Provider | UNI Upload/Search/chat-json/chat                         |
| 문서엔진          | HWPX/rhwp Document Engine 상세명세 v1.0                  |
| 상황정보          | SituationContext·UNI Adapter 상세명세 v1.0               |
| 스키마            | UNE v0.9 개발스키마 Bundle                               |
| 편집 UX           | rhwp Single Editing Surface + Cursor/Range/Block/Section |
| 전파              | UNE 내부 Propagation Module                              |
| 사실원장          | SituationSnapshot + Execution Log                        |

## 24.2 미결정·협의 필요사항

| **ID**  | **항목**                                | **현재 처리**                           | **확정 시점**          |
|---------|-----------------------------------------|-----------------------------------------|------------------------|
| OPEN-01 | T3Q 현재 재난상황정보 API               | 외부 Provider로 대체, Adapter 자리 확보 | T3Q 협의 후            |
| OPEN-02 | T3Q RPT-003 상황일지 사용 여부          | 초기 미사용                             | UNI POC 비교 후        |
| OPEN-03 | UNI compns 실제 필드와 SOP Schema Gap   | UniSopMapper로 격리                     | 실제 응답 샘플 후      |
| OPEN-04 | 국민안전24/Naver 웹수집 이용조건        | POC 보조·Feature Flag                   | 운영 전 법무/정책 검토 |
| OPEN-05 | rhwp 지원범위/라이선스/미지원 HWPX 객체 | POC와 코드검토                          | 엔진 POC Gate          |
| OPEN-06 | 한컴 자동화 시험환경                    | 수동+자동 시험안 병행                   | 개발환경 확정          |
| OPEN-07 | 문자/메일/방송 모듈 소스 인터페이스     | Adapter 계약만 정의                     | 소스 제공 시           |
| OPEN-08 | 실증기관·자연/사회재난 시나리오         | 범용 설계 유지                          | 수요처 협의 시         |

## 24.3 세션 전환 판단

현재 세션은 분석·의사결정·파일 산출 이력이 매우 길어졌으므로, v0.9 및 두 상세명세가 산출된 시점부터 다음 단계는 새 세션에서 진행하는 것이 효율적이다. 다만 새 세션은 문맥을 잃지 않도록 본 문서와 “통합설계 기준선 인계서 v0.9”를 첫 메시지에 첨부하고 작업목표를 지정해야 한다.

| **현재 세션에서 완료**                                                   | **새 세션에서 시작**                                                                |
|--------------------------------------------------------------------------|-------------------------------------------------------------------------------------|
| v0.9 Master, HWPX Engine v1.0, Situation/UNI v1.0, Schema Bundle, 인계서 | ADR 확정, 개발계획서/WBS, 사용자 시나리오, 화면설계, API/DB Sequence, POC 결과 반영 |
| 과거 설계결정 통합                                                       | 개발 실행·검증 중심의 짧은 작업단위                                                 |
| 미결정 목록 고정                                                         | OPEN ID별 결정 및 문서 개정                                                         |

# 부록 E. v0.9 신규 산출물

> **•** UNE_HWPX_rhwp_Document_Engine_상세명세서_v1.0_20260726.docx
>
> **•** UNE_SituationContext_UNI_Adapter_상세명세서_v1.0_20260726.docx
>
> **•** UNE_재난안전_AI문서플랫폼_v0.9_개발스키마_20260726.zip
>
> **•** UNE_통합설계_기준선_인계서_v0.9_20260726.docx
