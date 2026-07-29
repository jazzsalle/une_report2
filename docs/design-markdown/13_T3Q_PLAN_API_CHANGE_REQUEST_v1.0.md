**T3Q 계획서 생성 API 변경·추가 개발요청 규격서**

**재난안전계획서 생성도구 고도화 연계 인터페이스**

Version 1.0 / 2026.07.28

| **구분**  | **내용**                                                                                                       |
|-----------|----------------------------------------------------------------------------------------------------------------|
| 과제      | RS-2024-00407304                                                                                               |
| 요청기관  | 주식회사 유엔이(UNE)                                                                                           |
| 대상기관  | 티쓰리큐(T3Q)                                                                                                  |
| 현행 기준 | MOIS API 명세 v0.8.5의 RPT-001 목차·RPT-002 본문 생성                                                          |
| 요청 목적 | rhwp 기반 직접 편집, 부분 재생성, 사용자 수정 보호, Diff, 근거, 비동기 Job을 지원하는 계획서 생성 API 확장     |
| 적용 원칙 | 현행 RPT-001/002를 즉시 POC에 사용하고, 목표 규격은 Mock/Contract Test로 선행 구현한 뒤 T3Q 실제 API에 Binding |

# 1. 문서 목적과 요청 배경

본 규격서는 계획서 생성도구가 단순한 전체 목차·전체 본문 초안 생성에서
rhwp 기반의 문서 직접 편집, 목차 버전관리, 섹션·블록 부분 재생성, 사용자
수정영역 보호, 근거 검토, AI 편집 제안 및 비동기 생성 작업으로
고도화됨에 따라 T3Q에 요청할 인터페이스 변경·추가 사항을 정의한다.

- UNE는 T3Q 변경 완료를 개발 착수의 선행조건으로 두지 않는다.

- 현행 RPT-001/002는 LegacyT3qPlanAdapter로 유지하고 실제 동작을
  검증한다.

- 본 목표 규격은 TargetV2T3qPlanAdapter와 Mock Server로 먼저 구현한다.

- 계획서 생성 흐름에서 UNI API로 자동 대체하거나 우회하지 않는다.

- T3Q는 의미구조·본문·근거·편집 제안을 제공하고, UNE가 HWPX
  서식·Revision·ChangeSet·Diff·저장·검증을 담당한다.

# 2. 현행 API와 목표 기능의 Gap

| **구분** | **현행 RPT-001/002로 가능한 범위** | **고도화 기능에서 부족한 계약**                                                 |
|----------|------------------------------------|---------------------------------------------------------------------------------|
| 목차     | 제목과 하위 목차 생성              | 안정적 sectionId, parentSectionId, level, semanticRole, 보존·생성 정책          |
| 본문     | 목차 기반 전체/스트리밍 본문 생성  | section/block 대상 생성, 부분 결과, blockId, protectedBlockIds, 실패대상 재시도 |
| 편집     | 재요청 중심                        | Range/Block/Section 의미 편집 제안, baseRevision 충돌, ChangeProposal           |
| 근거     | references 일부 반환               | 문서·페이지·청크·excerpt·score·지원 Block 연결                                  |
| Job      | SSE 또는 응답                      | 상태조회, event sequence, 재접속, cancel, 부분 retry, capability                |
| 검증     | 명시 계약 없음                     | 근거 누락·지원되지 않는 주장·중복·표현규칙·필수목차 검사                        |
| 운영     | 버전·한도 OPEN                     | capability/version/limits API                                                   |

# 3. 요청 항목 총괄

| **ID**     | **우선순위** | **요청명**                | **요약**                                                    |
|------------|--------------|---------------------------|-------------------------------------------------------------|
| CR-T3Q-001 | MUST         | RPT-001 목차 생성 v2 변경 | 안정적 ID와 의미·생성정책을 포함한 구조화 목차              |
| CR-T3Q-002 | MUST         | RPT-002 본문 생성 v2 변경 | 구조화 ContentBlock, 범위 생성, 사용자 Block 보호, 부분결과 |
| CR-T3Q-003 | MUST         | 생성 Job API 추가         | 상태·SSE·중지·섹션/블록 재시도                              |
| CR-T3Q-004 | MUST         | 계획서 의미 편집 API 추가 | Range/Block/Section 변경 제안과 Revision 충돌               |
| CR-T3Q-005 | SHOULD       | 근거 검색 API 추가        | 출처·문서·페이지·청크 단위 근거                             |
| CR-T3Q-006 | SHOULD       | 의미 검증 API 추가        | Schema·근거·주장·중복·표현규칙·필수목차 검증                |
| CR-T3Q-007 | CONDITIONAL  | 참조문서 등록 API         | 공통 학습·등록 API가 없을 때만 추가                         |
| CR-T3Q-009 | MUST         | Capability API 추가       | 계약버전·Feature Flag·입력·동시작업·파일 한도               |

# 4. 공통 계약 규칙

| **항목** | **요청 규칙**                                                                     |
|----------|-----------------------------------------------------------------------------------|
| 버전     | schemaVersion=2.0, Provider build와 지원 계약버전 조회 가능                       |
| 식별     | requestId, correlationId, planId, documentId, baseRevisionId, Snapshot ID/Hash    |
| 인증     | 최종 방식은 협의하되 Browser 직접 호출 금지, UNE Backend Adapter를 경유           |
| 멱등성   | 생성·재시도·참조등록은 중복 요청이 동일 Job 또는 동일 결과를 반환                 |
| 시간     | ISO-8601, Asia/Seoul 의미 명확화                                                  |
| 오류     | code, message, retryable, field, correlationId, details                           |
| 충돌     | baseRevisionId 불일치 또는 보호 Block 침범 시 409                                 |
| SSE      | id, event, sequence, data, heartbeat, terminal event, Last-Event-ID 재접속        |
| 원문     | T3Q 원문 응답은 UNE가 추적용으로 보존                                             |
| 표현규칙 | 제목/양식은 UNE HWPX Template Profile이 담당하므로 expressionRule.scope=body_only |

# 5. CR-T3Q-001 목차 생성 v2

목차가 편집·재생성·본문 Block의 기준 식별자로 사용되므로 표시 제목만
반환해서는 안 되며, 문서 버전 간 안정적으로 유지되는 sectionId가
필요하다.

| **필드**         | **필수** | **설명**                                            |
|------------------|----------|-----------------------------------------------------|
| sectionId        | Y        | 목차 편집·본문·근거·부분 재생성의 안정 식별자       |
| parentSectionId  | Y/N      | 최상위는 null                                       |
| outlineLevel     | Y        | 1~10                                                |
| order            | Y        | 동일 부모 내 순서                                   |
| title            | Y        | 표시 제목                                           |
| semanticRole     | Y        | BACKGROUND, CURRENT_STATUS, OUTLOOK, ACTION_PLAN 등 |
| generationPolicy | Y        | GENERATE, PRESERVE, USER_ONLY, REFERENCE_ONLY       |
| required         | Y        | 필수 목차 여부                                      |
| instruction      | N        | 해당 섹션 생성 지침                                 |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>POST /model-api/{modelId}/v2/reports/plan/toc<br />
202 Accepted -&gt; generationId, statusUrl, eventStreamUrl<br />
SSE toc.section -&gt; OutlineSection<br />
SSE job.completed -&gt; 전체 OutlineSection[]</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 6. CR-T3Q-002 본문 생성 v2

| **요청/응답 요소**              | **규격**                                                                                             |
|---------------------------------|------------------------------------------------------------------------------------------------------|
| generationScope                 | ALL, SECTIONS, BLOCKS                                                                                |
| targetSectionIds/targetBlockIds | 부분 생성 대상                                                                                       |
| protectedBlockIds               | 사용자 수정으로 재생성 금지된 Block                                                                  |
| existingBlocks                  | 현재 문맥과 보존 Block                                                                               |
| ContentBlock                    | blockId, sectionId, blockType, order, text, structuredData, citations, warnings, status, contentHash |
| 부분 결과                       | 생성 Block 단위 SSE 및 PARTIAL 상태                                                                  |
| 실패 처리                       | failedTargetIds로 식별하고 해당 대상만 Retry                                                         |

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>ContentBlock {<br />
blockId, sectionId, blockType, order, text,<br />
citations[], warnings[], status,<br />
contentHash<br />
}<br />
<br />
금지: protectedBlockIds의 본문을 변경하거나 새 ID로 우회하여
덮어쓰기</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 7. CR-T3Q-003 생성 Job

| **API**                                        | **기능**                                  |
|------------------------------------------------|-------------------------------------------|
| GET /v2/generation-jobs/{generationId}         | 상태·진행률·완료/실패 대상·부분 결과 조회 |
| GET /v2/generation-jobs/{generationId}/events  | SSE, 재접속, heartbeat                    |
| POST /v2/generation-jobs/{generationId}/cancel | 사용자 중단                               |
| POST /v2/generation-jobs/{generationId}/retry  | SECTION/BLOCK 실패 대상 재시도            |

| **상태**  | **의미**                                  |
|-----------|-------------------------------------------|
| QUEUED    | 접수                                      |
| RUNNING   | 생성 중                                   |
| PARTIAL   | 일부 성공·일부 실패 또는 생성 중 부분결과 |
| COMPLETED | 전체 완료                                 |
| CANCELLED | 사용자/시스템 중단                        |
| FAILED    | 완료 불가                                 |

# 8. CR-T3Q-004 의미 편집 API

rhwp Editor의 커서·선택영역·Block·Section 명령은 T3Q가 HWPX XML이나
서식을 직접 수정하는 방식이 아니라 UNE가 적용할 의미 변경 제안을
반환하는 방식으로 연계한다.

| **입력**                | **설명**                            |
|-------------------------|-------------------------------------|
| targetType              | RANGE, BLOCK, SECTION               |
| sectionId/blockId/range | 대상 식별                           |
| selectedText            | 사용자가 선택한 현재 텍스트         |
| surroundingContext      | 앞·뒤 문맥                          |
| instruction             | 요약, 확장, 문체 변경, 근거 보강 등 |
| preserveCitationIds     | 유지해야 할 근거                    |
| protectedBlockIds       | 변경 금지                           |
| baseRevisionId          | 동시수정 충돌 검증                  |

| **응답**       | **설명**                                                 |
|----------------|----------------------------------------------------------|
| proposalId     | Diff 승인 전 후보 ID                                     |
| operations     | REPLACE_RANGE, REPLACE_BLOCK, INSERT_BLOCK, DELETE_BLOCK |
| proposedBlocks | UNE ChangeSet으로 변환할 Block                           |
| citations      | 유지·추가된 근거                                         |
| warnings       | 근거 부족·범위 초과 등                                   |

# 9. CR-T3Q-005/006 근거와 검증

| **구분**   | **필수 결과**                                                                                              |
|------------|------------------------------------------------------------------------------------------------------------|
| 근거       | citationId, sourceId, documentId, fileName, page, chunkId, excerpt, score, supportsBlockIds, retrievedAt   |
| 검증 유형  | SCHEMA, CITATION_COVERAGE, UNSUPPORTED_CLAIM, DUPLICATE_CONTENT, EXPRESSION_RULE, MISSING_REQUIRED_SECTION |
| 검증 Issue | issueId, type, severity, message, sectionId, blockId, citationId, suggestedAction                          |

# 10. CR-T3Q-009 Capability

| **구분** | **요청 필드**                                                                                                         |
|----------|-----------------------------------------------------------------------------------------------------------------------|
| 계약     | providerBuild, contractVersions                                                                                       |
| 기능     | tocV2, contentV2, semanticEdit, evidenceSearch, validation, referenceUpload, jobSse, partialRetry                     |
| 한도     | maxInputChars, maxSections, maxBlocks, maxConcurrentJobsPerTenant, maxReferenceFileBytes, supportedReferenceMimeTypes |

# 11. Legacy와 Target-v2 병행 적용

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th>T3qPlanProvider<br />
├─ LegacyT3qPlanAdapter # 현재 RPT-001/002 실제 API<br />
└─ TargetV2T3qPlanAdapter # 본 요청 계약, 초기에는 Mock<br />
<br />
Feature 상태<br />
MOCK_ONLY<br />
UNE_ADAPTER_READY<br />
T3Q_DEV_VERIFIED<br />
T3Q_PROD_VERIFIED</th>
</tr>
</thead>
<tbody>
</tbody>
</table>

- RPT-001/002의 현재 작동 여부와 규칙을 먼저 실제로 검증한다.

- 목표 v2 기능은 Mock으로 계획서 Vertical Slice에 포함한다.

- T3Q가 기능별로 제공하는 시점에 Capability와 Contract Test 결과에 따라
  Adapter 기능을 전환한다.

- Mock 지원을 T3Q 실제 구현으로 표시하지 않는다.

- T3Q v2 일부 기능이 없더라도 rhwp 직접 편집, 수동 편집, 저장·내보내기
  기능은 계속 동작한다.

# 12. 인수시험

| **시험ID** | **시험**              | **합격기준**                             |
|------------|-----------------------|------------------------------------------|
| AT-T3Q-001 | 동일 멱등키 목차 요청 | 동일 generationId 또는 동일 의미 결과    |
| AT-T3Q-002 | sectionId 안정성      | 재요청 조건이 동일하면 보존대상 ID 유지  |
| AT-T3Q-003 | 부분 본문 생성        | 지정 section/block만 결과                |
| AT-T3Q-004 | 보호 Block            | protectedBlockIds 내용 변경 0건          |
| AT-T3Q-005 | SSE 재접속            | Last-Event-ID 이후 누락·중복 없이 처리   |
| AT-T3Q-006 | 중지                  | CANCELLED 후 신규 Block 생성 없음        |
| AT-T3Q-007 | 부분 재시도           | 실패 대상만 재생성                       |
| AT-T3Q-008 | Revision 충돌         | 오래된 baseRevisionId는 409              |
| AT-T3Q-009 | 근거 추적             | 본문 Block에서 문서·페이지·청크까지 추적 |
| AT-T3Q-010 | Capability            | 실제 지원·한도 조회 가능                 |
| AT-T3Q-011 | UNI 격리              | 계획서 E2E에서 UNI 호출 0건              |
| AT-T3Q-012 | Mock 표시             | UI/로그/시험보고에서 MOCK_ONLY 구분      |

# 13. 협의·회신 요청표

| **항목**      | **T3Q 회신 요청**                    |
|---------------|--------------------------------------|
| 수용 여부     | CR별 수용/부분수용/대안/불가         |
| 개발 일정     | 개발서버 제공 예정일과 운영 반영일   |
| Path          | 제안 Path 수용 또는 대체 Path        |
| 인증·TLS      | 개발/운영별 방식                     |
| SSE           | Event 명·재접속·heartbeat            |
| 오류          | 표준 오류 Schema와 Provider code     |
| 한도          | 입력·동시 Job·파일·Rate limit        |
| 샘플          | 정상·부분·오류 대표 Payload          |
| Contract Test | T3Q 개발서버 연동 시험 창구와 책임자 |

# 부록 A. 기계판독 계약

본 문서와 동일한 요청 계약은 Claude Code 개발패키지의
\`contracts/openapi/t3q-plan-api-change-request-v1.yaml\`에 포함한다.
YAML은 T3Q 구현 완료 선언서가 아니라 UNE 요청 및 Mock 기준선이다.
