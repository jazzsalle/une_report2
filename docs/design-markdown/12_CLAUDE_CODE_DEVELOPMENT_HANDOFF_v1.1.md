**Claude Code Max 개발 인계서**

**외부 의존성·T3Q 계획서 API 변경요청 반영본**

Version 1.1 / 2026.07.28

| **구분**       | **내용**                                                                                |
|----------------|-----------------------------------------------------------------------------------------|
| 과제           | RS-2024-00407304                                                                        |
| 패키지         | UNE_Claude_Code_Max_개발패키지_v1.1_20260728.zip                                        |
| 공식 설계 DOCX | 13종                                                                                    |
| Work Item      | 34개                                                                                    |
| 추가 기준선    | ProcessGPT/rhwp/UNI Binding, T3Q Plan API 변경·추가 요청, Legacy/Target-v2 병행 Adapter |
| 개발 원칙      | T3Q 변경을 기다리지 않고 현행 RPT-001/002와 목표 v2 Mock으로 POC 진행                   |

# 1. 인계 목적

본 인계서는 설계 완료 후 Claude Code Max에서 실제 개발을 수행할 때
필요한 문서형 기준선과 기계판독 계약, 외부 소스·Provider 주소, 개발순서
및 미확정 Binding 통제방법을 정의한다.

# 2. Source of Truth

| **우선순위** | **기준**                                         |
|--------------|--------------------------------------------------|
| 1            | ADR v1.1                                         |
| 2            | Implementation Baseline 및 승인된 Change Request |
| 3            | API·DB·Sequence 상세설계                         |
| 4            | T3Q 계획서 API 변경·추가 요청 규격서             |
| 5            | OpenAPI·JSON Schema·Migration                    |
| 6            | 화면·사용자 시나리오·HWPX·UNI 명세               |
| 7            | 마스터 설계와 원천 요구사항                      |

# 3. 외부 소스와 Provider 주소

| **대상**              | **주소**                                              | **개발 적용**                               |
|-----------------------|-------------------------------------------------------|---------------------------------------------|
| ProcessGPT            | https://github.com/uengine-oss/process-gpt            | 참고 아키텍처·선택 POC                      |
| ProcessGPT Office MCP | https://github.com/uengine-oss/process-gpt-office-mcp | HWPX/Office MCP 계약 검토                   |
| ProcessGPT Docs       | https://docs.process-gpt.io                           | 설치·운영·기능 확인                         |
| rhwp                  | https://github.com/edwardkim/rhwp                     | 고정 Tag/Commit 반입 후 UNE Adapter         |
| rhwp Releases         | https://github.com/edwardkim/rhwp/releases            | POC 대상 버전 검토                          |
| UNI                   | http://221.147.100.161:8000                           | 후보 Host, Live Path/Auth 확인 전 추정 금지 |
| T3Q                   | https://plf.mois-disaster.t3q.ai                      | 현행 명세 후보 Host, 실제 Binding 필요      |

# 4. ProcessGPT·rhwp·UNI 통제

- ProcessGPT 전체 플랫폼을 UNE 시스템에 즉시 결합하지 않고
  BPMN·MCP·Office 제어 소스의 재사용 가능성을 평가한다.

- UNE SOP, Task, Transactional Outbox, Execution Log, Journal
  Projection을 ProcessGPT 데이터모델로 대체하지 않는다.

- rhwp는 floating main을 사용하지 않고 Tag/Commit·SHA-256·License·SBOM을
  기록한 원본 Source Archive를 반입한다.

- UNI는 UNE Backend Adapter를 통해서만 호출하고 계획서 생성 과정에는
  사용하지 않는다.

- 외부 주소·인증·Path·한도·오류 필드는 OPEN Binding으로 관리하며 Claude
  Code가 추정하지 않는다.

# 5. T3Q 계획서 API 적용전략

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>현재 실제 연동<br />
LegacyT3qPlanAdapter -&gt; RPT-001 목차 / RPT-002 본문<br />
<br />
목표 개발<br />
TargetV2T3qPlanAdapter -&gt; v2 Mock -&gt; T3Q 개발 API -&gt; 운영
API<br />
<br />
공통 Port<br />
T3qPlanProvider<br />
<br />
절대 금지<br />
Plan flow -&gt; UNI automatic fallback</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

| **요청군** | **목적**                  |
|------------|---------------------------|
| CR-T3Q-001 | RPT-001 목차 생성 v2 변경 |
| CR-T3Q-002 | RPT-002 본문 생성 v2 변경 |
| CR-T3Q-003 | 생성 Job API 추가         |
| CR-T3Q-004 | 계획서 의미 편집 API 추가 |
| CR-T3Q-005 | 근거 검색 API 추가        |
| CR-T3Q-006 | 의미 검증 API 추가        |
| CR-T3Q-007 | 참조문서 등록 API         |
| CR-T3Q-009 | Capability API 추가       |

# 6. Claude Code Work Item 변경

| **ID** | **작업**                                   | **선행**       |
|--------|--------------------------------------------|----------------|
| CC-115 | 현행 RPT-001/002와 목표 v2 Gap·계약 기준선 | CC-110         |
| CC-125 | Legacy/Target-v2 이중 Adapter와 Mock       | CC-120         |
| CC-135 | Job·의미편집·근거·검증 Mock                | CC-130         |
| CC-400 | 실제 T3Q 계약 Binding과 Mock/Actual 구분   | CC-170, CC-320 |

# 7. 패키지 주요 파일

| **파일**                                                  | **용도**                    |
|-----------------------------------------------------------|-----------------------------|
| CLAUDE.md                                                 | 전 세션 핵심 규칙           |
| docs/external-dependencies/\*                             | 외부 주소·소스 반입·Binding |
| contracts/openapi/t3q-plan-api-change-request-v1.yaml     | T3Q 목표 요청 계약          |
| docs/design-docx/13_T3Q_PLAN_API_CHANGE_REQUEST_v1.0.docx | 공식 요청 규격서            |
| .env.example                                              | 비밀 없는 환경변수 표본     |
| config/provider-bindings.example.yaml                     | Legacy/Mock/Actual 전환     |
| third_party/rhwp/\*                                       | 소스 provenance·patch 기록  |
| work-items/MASTER_WORK_ITEMS.yaml                         | 34개 개발순서               |
| docs/handoff/OPEN_BINDINGS.md                             | 미확정 외부값 통제          |

# 8. 첫 개발 순서

- CC-000: 저장소·기술 Profile·개발환경 확정

- CC-001~004: Repository, Infra, Contract, DB Bootstrap

- CC-110: PlanContextSnapshot

- CC-115: T3Q Legacy/Target Gap와 요청 계약 검증

- CC-120·125·130·135: 현행/목표 Mock을 포함한 계획서 생성 Vertical Slice

- CC-140~170: rhwp/HWPX 직접편집·Revision·Export E2E

- CC-200 이후: Situation–SOP–Task–Execution Log–Journal Slice

- CC-400 이후: 실제 T3Q·UNI와 기관 Binding

# 9. 완료 판정과 진실성

| **상태**          | **의미**                       |
|-------------------|--------------------------------|
| MOCK_ONLY         | UNE Mock으로만 확인            |
| UNE_ADAPTER_READY | UNE 계약·Adapter·시험 완료     |
| T3Q_DEV_VERIFIED  | T3Q 개발서버 Contract/E2E 확인 |
| T3Q_PROD_VERIFIED | 운영 배포·인수 확인            |

개발보고서, 화면 Badge, Test Evidence에서 위 상태를 구분한다. 목표
OpenAPI가 존재한다는 이유만으로 T3Q 제공 완료로 판정해서는 안 된다.

# 10. 개발 착수 Gate

- 패키지 validator PASS

- OpenAPI/YAML/JSON/SQL 구문검증 PASS

- CC-000 결정기록 승인

- Legacy RPT-001/002 Mock 또는 실제 Smoke Test

- Target-v2 Mock Contract Test

- rhwp 소스 미반입 시에도 HWPX Service Port와 Mock으로 Skeleton 진행

- 실제 Secret은 저장소 외부에서 주입
