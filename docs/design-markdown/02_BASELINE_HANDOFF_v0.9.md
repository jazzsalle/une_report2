**UNE 통합설계 기준선 인계서**

새 세션·개발단계 전환용

Version 0.9 \| 2026.07.26

# 1. 프로젝트 범위

> **•** UNE는 재난안전계획서 생성도구(2·3차년도), 상황일지 생성도구(3차년도), HWPX 변환·편집을 담당한다.
>
> **•** UNE는 챗봇을 개발하지 않는다. React Frontend와 rhwp Web Editor를 사용한다.
>
> **•** T3Q는 RAG/LLM·외부연계·TTS/STT를 담당하되, 계획서 생성은 T3Q 전용 API만 사용한다.
>
> **•** 상황일지 POC는 UNI API를 먼저 사용하고 전체 시나리오 검증 후 T3Q 연계 범위를 판단한다.

# 2. 최신 기준 문서

| **우선순위** | **문서**                                      | **용도**              |
|--------------|-----------------------------------------------|-----------------------|
| 1            | 통합플랫폼 상세설계서 v0.9                    | Master 개발 기준선    |
| 2            | UNE Document AI Contract v1.0                 | AI/문서 편집 Contract |
| 3            | HWPX/rhwp Document Engine 상세명세 v1.0       | 문서엔진 구현         |
| 4            | SituationContext 및 UNI Adapter 상세명세 v1.0 | 상황일지 연계 구현    |
| 5            | v0.9 개발스키마 ZIP                           | CI/코드 생성 기준     |
| 참조         | T3Q MOIS API v0.8.5, UNI OpenAPI v1.1.0       | Provider 원본 명세    |

# 3. 확정 의사결정

| **ID** | **결정**                                                    |
|--------|-------------------------------------------------------------|
| ADR-01 | rhwp Web Editor를 중앙 Single Editing Surface로 사용        |
| ADR-02 | 임의 HWPX 자동분석 + Template Profile + Prototype Clone     |
| ADR-03 | AI는 내용/의미 level만 생성, HWPX 서식은 UNE 엔진이 적용    |
| ADR-04 | Cursor/Range/Block/Section 선택과 ChangeSet/Diff/Undo       |
| ADR-05 | 계획서 생성은 T3Q RPT-001/002만 사용                        |
| ADR-06 | 상황일지 POC는 UNI Upload/Search/chat-json/chat             |
| ADR-07 | T3Q/UNI는 상황전파에 사용하지 않으며 UNE 내부모듈 담당      |
| ADR-08 | 현재상황은 SituationFact/Snapshot으로 관리, LLM 생성값 금지 |
| ADR-09 | KMA/MOIS 우선, SafeKorea 보조, Naver 사용자 요청형 보조수집 |
| ADR-10 | Execution Log를 사실원장으로 상황일지 생성                  |

# 4. 다음 작업 순서

> **1.** OPEN 항목을 ADR로 확정하고 개발계획서/WBS를 작성한다.
>
> **2.** 계획서 생성 사용자 시나리오와 상황일지/안전한국훈련 사용자 시나리오를 별도 문서로 작성한다.
>
> **3.** 화면목록·화면흐름·상태/권한/오류 메시지를 시나리오와 연결한다.
>
> **4.** API/DB/Sequence 명세를 v0.9 Schema에 맞춰 상세화한다.
>
> **5.** HWPX Engine POC와 UNI SOP POC를 병행하고 결과를 v1.0 설계에 환류한다.

# 5. 새 세션 시작 문구

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>첨부된 통합설계 v0.9, Document AI Contract v1.0,<br />
HWPX Engine v1.0, SituationContext/UNI Adapter v1.0을 기준선으로 사용한다.<br />
기존 설계를 축약하거나 폐기하지 말고 OPEN/ADR 추적성을 유지한다.<br />
이번 세션의 목표는 [개발계획서/WBS 또는 사용자 시나리오 또는 화면/API/DB 상세화]이다.</th>
</tr>
</thead>
<tbody>
</tbody>
</table>
