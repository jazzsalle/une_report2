**HWPX/rhwp Document Engine 상세명세서**

임의 HWPX 분석·웹 편집·보존형 저장·Round-trip 검증

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

# 1. HWPX/rhwp Document Engine 상세명세

본 장은 임의 HWPX 양식 분석, 원본 서식 상속, rhwp 웹 편집, 선택영역 AI 편집, ChangeSet 적용, HWPX 저장 및 한컴 Round-trip 검증을 개발 가능한 수준으로 정의한다. rhwp를 그대로 사용하는 것이 아니라 UNE Adapter/Fork와 보존형 Serializer를 구현한다.

## 1.1 목적·적용범위·비범위

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

## 1.2 엔진 컴포넌트와 처리경계

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

## 1.3 Canonical Document IR

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

## 1.4 HWPX Package Reader 처리 알고리즘

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

## 1.5 TemplateAnalyzer 입출력과 분석 알고리즘

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

## 1.6 OutlinePatternAnalyzer 상세 알고리즘

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

## 1.7 ParagraphPrototypeRegistry

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

## 1.8 SelectionResolver

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

## 1.9 ChangeSetExecutor

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

## 1.10 HWPX Serializer 및 저장

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

## 1.11 Round-trip 검증

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

## 1.12 성능·동시성·보안

| **항목** | **설계 기준**                                                   |
|----------|-----------------------------------------------------------------|
| 분석시간 | 일반 50쪽 HWPX P95 5초 이내를 목표. 대용량은 비동기 Job         |
| 편집응답 | Selection resolve/ChangeSet apply P95 300ms 이내(LLM 시간 제외) |
| Autosave | ChangeSet 로그 우선 저장, 5~15초 주기 IR snapshot               |
| 동시성   | Optimistic Lock(baseRevision). 충돌 시 자동 덮어쓰기 금지       |
| 파일보안 | 업로드 격리, 악성 ZIP/XML 차단, 확장자·MIME 이중검사            |
| 개인정보 | 문서별 접근권한, 다운로드 감사로그, 임시파일 TTL                |
| 오류복구 | 원본/마지막 정상 revision/ChangeSet log로 복원                  |

## 1.13 개발 인터페이스 초안

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

## 1.14 개발 완료 및 인수 기준

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
