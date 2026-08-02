# Session Handoff

- Date/time: 2026-08-02 (집 PC, CC-130 세션)
- Branch: **feature/CC-130** @ main 61e140a 기반 (CC-125는 PR #8 머지 완료)
- Current Work Item: **CC-130 DONE(구현·이중리뷰 반영·게이트 통과)** —
  커밋·push 후 PR 대기 / next **CC-135** (deps=CC-130)
- 이 PC(집 PC): 로컬 DB 포트 **15432**, 마이그레이션 **17개**(0017 추가).

## Completed this session (CC-130)

**RPT-002 CONTENT job + 보호 블록** — 수용기준 4종 전부 기계 검증.
상세: ADR-27, docs/evidence/CC-130-t3q-content-job-verification.md.

- **0017 `generated_block`**(60번째 테이블 — §3.3/x-db-tables vs §6.2
  기준선 결함 해소, ADR-27 D2): 행 불변 + 세대 supersede(부분 유니크
  current), protection_state(0003 어휘), citations_json+citation_count,
  EXISTS-plan FORCE RLS, une_worker 보호 트리거(보호 행·비허용 컬럼 변경
  차단; BEFORE 트리거에서 STORED 컬럼 NULL 이슈 반영).
- **ContentJobRunner**: 3-tx, 위치+정규화 제목 이중 일치 앵커링(불일치는
  전량 격리), B0/B1 보호 재확인, 아웃라인 이동 fail-closed/전량 폐기,
  content.block/job.progress 합성(비실시간 — 수용 한계), 운영 경로 동기
  JSON(`UNE_T3Q_CONTENT_STREAM` seam). 공유 디스패치 원시연산
  `plan-jobs/`로 추출(ADR-25 D12 종결), PlanJobPoller 일반화.
- **API**: UNE-PLAN-016(보호 영속·targetNodeKeys·contentSummary), 활성 job
  불변식 job 타입 무관 + 본문 존재 시 TOC 재생성 412(ADR-27 D9), 부분
  재시도=새 job(blockIds 400), cancel/retry 타입 인지형.
- **capability**: legacyContent → UNE_ADAPTER_READY(3조건 충족).
- 자체 발견 결함 수정: toc_node 트리 재구성 ORDER BY level(sort_order는
  형제 내 순서), supersede→insert 순서(부분 유니크 과도 상태), 트리거
  STORED 컬럼(DB 에이전트).
- 이중 리뷰 당일 전건 반영: 아키텍처 BLOCKER 1(범위 재생성 좌표 손상 →
  전체 목차 절대 좌표 주입) + MAJOR 5(폐기 경로 plan 고착, 수동 목차 저장
  가드, 422 통일, PRESERVED 해시, 계약 동기) + MINOR 11; QA F1~F5·G1~G9
  (CI pytest baseline 편입 포함). 상세: 증거 문서 이중 리뷰 절.
- 게이트(반영 후): domain 52, provider-adapters 67, contract-tests 38,
  db-integration 65, worker 31, api 193, baseline 10, mock 19라우트 —
  전부 green.

## Exact next actions

1. **사용자**: push(프롬프트 승인) → PR 생성·머지(CI verify + db-verify).
2. 다음 항목 **CC-135**(target-v2 plan job·semantic edit·evidence·
   validation mocks): CC-130이 준 것 — generated_block/ContentDraft
   provenance 슬롯/CR-T3Q-* 불변식/UNE_T3Q_CONTENT_STREAM seam. CC-135가
   할 것 — v2 job status/SSE/cancel/부분재시도(failedTargetIds) mock,
   ChangeProposal/ValidationIssue/evidence mock, 응답측 예제 확충(ADR-24
   R2), getPlanProviderCapabilities 예제 동기화,
   registerPlanReferenceDocument 면제 종결, v2 PARTIAL 매핑 재평가.
3. 이월 항목: 실시간 부분 이벤트(CC-135/CC-400), generated_block →
   document_revision materialize(CC-150), 목차 변경 영향 Diff(CC-170),
   근거 정규화(CC-230), 0016/0017 보존정책(CC-430).

## Risks/blockers

- legacy 멱등키 부재 → provider 중복 실행 가능성은 CONTENT에서 비용이 더
  큼(UNE 측 반영은 FOR UPDATE 재확인으로 1회 보장; OB-01/CC-400).
- 부분 이벤트 타이밍 비실시간(완료 시 일괄) — UX 기대와 어긋날 수 있음,
  CR-T3Q-003 수용 후 해소.
- 로컬 무DB `pnpm test`는 worker e2e·db-integration이 조용히 skip — CI
  db-verify가 커버. DATABASE_URL(superuser)을 설정하고 돌릴 것.
- 기존 이월분(OB-01/10/11 OPEN, redocly CC-400) 유지.

## Notes

- 이 PC DATABASE_URL: superuser une @ localhost:**15432**
  (infrastructure/.env 조합; WSL vmIdleTimeout으로 컨테이너가 내려갈 수
  있음 — `wsl -d Ubuntu` 깨우고 `docker start une-postgres`).
- prettier를 docs/·contracts/에 실행하지 말 것(사고 2회) — 커밋 전
  `git status -- docs/design-markdown` 무변경 확인.
- services/api e2e는 워커 **소스**를 상대경로 import — dist 검증 금지.
- mock-server의 멱등키 누락 응답은 400(관례; 계약상 428 COM-0428) —
  테스트 주석에 기록됨, 일괄 전환은 별도 판단.
