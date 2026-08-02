# CC-135 검증 증거 — Target-v2 Plan Job·의미 편집·근거·검증 Mock

- 일자: 2026-08-02 (집 PC, 로컬 PostgreSQL 16 @ 15432/WSL2)
- 브랜치: feature/CC-135 (base: main d66b675 = PR #9 머지)
- 결정 기록: ADR-28 (D1~D12 + 수용 한계)
- 대전제: 모든 산출물은 **UNE in-process mock** — 실제 T3Q 지원 아님
  (OB-10/OB-11 OPEN, CR-T3Q-* 불변식)

## 수용기준 대응

| AC | 구현 | 증거 |
|---|---|---|
| job status/SSE/cancel/retry mocks | `MockTargetV2JobStore` 단일 모델(폴링·SSE 프레임·취소·부분재시도가 한 대장에서 파생) + `JobLifecycleCapable` 5메서드(op=jobStatus, ADR-28 D2). SSE는 `.assumed` 프레이밍(id==sequence, heartbeat, Last-Event-ID 재개, 종결 이벤트 필수) | provider-adapters 단위(라이프사이클 8·SSE 6), 계약 예제↔가드 왕복 |
| Range/Block/Section change proposals | `requestSemanticEdit` — 3 targetType, 4 operationType 어휘 전수, baseRevision 에코, 보호블록 요청 사전 거부 + 응답 침범 전체 격리(ADR-28 D8 기제) | 단위 5종 + stale baseRevision 409→T3Q_CONFLICT |
| evidence provenance | `searchEvidence` — Citation 필수 7키 + page/chunkId/supportsBlockIds 충전, score 단조 내림차순, `ContentCitationDraft` 예약 슬롯(ADR-26 D4) 충전; CONTENT 경로로 `generated_block.citations_json`까지 영속 실증 | 단위 2종 + 워커 e2e provenance 단언 + db-integration 카탈로그 핀 |
| validation issues | `validateContent` — 6유형 휴리스틱, 결정적 issueId·정렬, ERROR→valid:false. **어떤 UNE 경로도 이 판정으로 차단하지 않음**(ADR-28 D9) | 단위 2종(결정성 2회 실행 동일 포함) |
| mock-only status visible | 레지스트리 전 v2 기능 MOCK_ONLY 고정(adapterImplemented/mockAvailable true), `describeRuntimeFeature` 8기능 기동 로그, `providerBuild: une-mock-target-v2-*`, provider.requested에 runtimeMode:'mock' 기록 | 거버넌스 테스트 + 워커 e2e + main.ts 기동 로그 |

## 게이트 실행 결과 (이중 리뷰 반영 후 최종)

| 게이트 | 결과 |
|---|---|
| `@une/domain` | 52/52 (canonical-lite 타입은 형 선언 — 소비자 테스트는 어댑터 계층) |
| `@une/provider-adapters` | 108/108 (CC-135 신규 41: SSE 6 + 라이프사이클/edit/evidence/validation/capabilities 24 + 리뷰 회귀 11) |
| `@une/contract-tests` | 60/60 (신규 22 — 매퍼 4종 스키마 기계검증+오탈자 음성, 계약 예제↔가드 왕복 14, 거버넌스 3) |
| `@une/db-integration` | 68/68 (CC-135 신규 3 — v2 provenance 수용·no-evidence 인덱스 불변·카탈로그 핀; 마이그레이션 0건 확증) |
| `@une/worker` | 33/33 (신규 2 — v2 CONTENT 전여정: trace 바인딩·provenance 영속·plan EDITING / 부분실패 M-1 회귀) |
| `@une/api` | 193/193 (회귀 — API 변경 없음) |
| `pnpm validate:contracts` | PASS — 예제 12→22건(+10), 면제 2→0, 전사본 핀 불변, 생성 타입 diff 0 |
| `python -m pytest tests/baseline` | 10 passed (mock-server 무변경) |
| build/typecheck/lint/format/handoff | 전부 PASS (`HANDOFF VALIDATION: PASS`) |

## 핵심 검증 포인트

1. **결정성**: 난수·벽시계 0 — 전 id는 sha256(안정 입력) 파생, 전 시각은
   requestedAt 에코. 동일 요청 2회 → 동일 바이트(단위 고정). 멱등 재제출은
   동일 generation 합류(재시작 없음, AT-T3Q-001).
2. **mock도 가드를 통과해야 한다**: transport는 raw unknown을 반환하고
   어댑터 가드(ContentBlock/Citation/ChangeProposal/ValidationReport/
   Capabilities/SSE)가 전부 검증 — CC-400 실 transport 교체 시 남는 계약
   seam. 위반 주입(보호블록 침범, requestId 에코 불일치, 종결 이벤트 절단)
   전부 음성 테스트로 고정.
3. **PARTIAL 비종결 fail-closed**(ADR-28 D4): 실패 존재 시
   RUNNING→PARTIAL→COMPLETED(failedTargetIds), 전 대상 실패 시 FAILED.
   UNE Job/Plan 어휘에 PARTIAL 미도입(ADR-27 D3 불변).
4. **부분재시도 이중 모델**(ADR-28 D6): provider retry는 실패 대상만 허용
   (성공 대상 조용한 재생성 409), 새 generationId; UNE 측은 targetNodeKeys
   새 job 그대로(blockIds 400 회귀 유지).
5. **워커 seam 종결**: CC-130 리뷰 m-10의 v2 trace 훅 이행 —
   provider.responded.rawRequest에 planId/snapshotId/`jobId#attempt`/
   `une-mock:` 플레이스홀더 실측(워커 e2e). 운영 프로파일은 legacy 불변,
   mock-target-v2 선택 시에만 CONTENT 러너 활성.
6. **계약-구현 양방향 드리프트 차단**: 매퍼 출력→스키마(ajv,
   unevaluatedProperties 실효 음성 포함) + 계약 예제→가드 왕복 + capabilities
   예제↔mock 정본 deep-equal.

## 이중 리뷰 (병렬, opus — 전건 당일 반영)

**architecture-guardian: BLOCKER 0 / MAJOR 2 / MINOR 9.**
- **M-1** v2 부분실패 시 빈 블록이 GENERATED로 영속되어 직전 세대를
  supersede하고 감사가 `failed: 0`으로 기록됨 → 러너가
  `failedNodeKeys`를 소비: 실패 노드는 **행을 쓰지 않고 supersede도 하지
  않으며** `content.block {outcome: FAILED, reason:
  PROVIDER_TARGET_FAILED}` + `job.completed.failed` 카운트로 이행(ADR-27이
  선언한 어휘). 워커 e2e 신설: 이전 세대 현재행 보존·행 수 불변·감사
  카운트 실측.
- **M-2** 어댑터가 provider 자기신고(failedTargetIds)를 관측 누락보다
  우선(fail-open) → 신고∪관측 합집합으로 변경(scope 지정 시 대상 외
  노드 오검출 방지 포함), "COMPLETED+빈 신고+블록 누락" 음성 테스트 고정.
- MINOR 9건 반영: retry BLOCK을 409 위장에서 422 not-mocked로 분리+레지
  스트리 문구·계약 예제 SECTION화(m-1), ADR-27 D8 정정 표식(m-2=QA G-5),
  OB-10 캐비앗을 렌더링되는 examples.summary/description으로 이동+limits
  UNE 상수 명시(m-3), 범위 재생성 실동작(프루닝+ALL)으로 ADR-28 D7 정정
  (m-4), 보호블록 재검사 payload 재귀 스캔(m-5), 멱등키 재사용+페이로드
  불일치 409(m-6), mock job 저장소 상한 500+제거(m-7), live transport
  생성자 opt-in 기제 + 정책 부재 수용 한계 기재(m-8=QA F-4), 완료 절차
  게이트(m-9=QA F-1/F-2 — 본 문서·상태 문서로 이행).

**qa-gate-reviewer: PASS WITH CONDITIONS — F-1~F-4 전부 반영.**
- 주장 수치 **전부 독립 재현**(전 스위트 + 무DB skip 반증 + 예제 기준선
  12건 stash 실측 + 생성 타입 diff 0 + 카탈로그 핀). F-1 상태 문서 갱신,
  F-2 본 문서 수치 확정(96→108 재산정 포함), **F-3** SSE 재개 경계 —
  종결 이후 재개(빈 replay)를 retryable MALFORMED에서 **빈 프레임 성공**
  으로 분리(resume 없는 빈 스트림은 비재시도 MALFORMED; ADR-28 수용
  한계에 규칙 기재), 경계 테스트 2건 신설. **F-4** "전 op fail-closed"
  과장 서술 정정 + live transport 생성자 opt-in으로 기제화.
- 권고 반영: G-1(cancel 후 동결 유지 회귀), G-2(retry 멱등 회귀),
  G-3(live fail-closed op 전수 파라미터화), G-4(PLAN-V2-* 전량 UNE 발명
  갭 매트릭스 명시), G-5(=m-2), G-8(빈 targetIds 사전 거부 테스트),
  G-9(커밋 시 반영분 포함). **수용**: G-6(main.ts 기동 로그 루프 미테스트
  — 헬퍼는 거버넌스 테스트로 고정, job trace의 runtimeMode는 e2e 실측;
  main 부트스트랩 하네스 부재는 기존 관행), G-7(mock job store 동시성 —
  in-process 결정성 mock, 위험 낮음 판단).

## 알려진 한계 (ADR-28 수용 한계)

SSE 프레이밍·PARTIAL 종결성·409 코드 체계는 UNE 가정(OB-10); validation
휴리스틱의 provider 대응 미지(OB-11); ContentBlock 결합의 blockType 손실
(raw 보존); 워커 protectedBlockIds 미전송(id 공간 바인딩 CC-150); 실시간
부분 이벤트는 CC-400 확정 이월(D12).
