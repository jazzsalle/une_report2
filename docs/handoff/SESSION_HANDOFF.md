# Session Handoff

- Date/time: 2026-08-02 (집 PC, CC-125 세션)
- Branch: **feature/CC-125** @ main d484a6b 기반 (CC-120은 PR #7 머지 완료)
- Current Work Item: **CC-125 DONE(구현·이중리뷰 반영·게이트 통과)** —
  커밋·push 후 PR 대기 / next **CC-130** (deps=CC-125)
- 이 PC(집 PC): 로컬 DB 포트 **15432**, 마이그레이션 **16개**(0016 추가).

## Completed this session (CC-125)

**Dual Legacy/Target-v2 T3Q Plan 어댑터 + 통합 포트** — 수용기준 5종 전부
기계 검증. 상세: ADR-26, docs/evidence/CC-125-t3q-dual-adapter-verification.md.

- **포트**: `T3qPlanProvider`(op 어휘 완비 + TocCapable/ContentCapable
  믹스인 + `T3qPlanResult<T>` 봉투 + `runtimeMode`/`transportProfile`).
  `T3qTocPort`는 흡수·삭제(ADR-25 D3 이행). adapterId/mappingVersion은
  호출 결과값 단위 기록.
- **Legacy 실 HTTP**: undici 분리 타임아웃(5s/60s = UNE 기준선, OB-01),
  base URL/auth 폴백 전무(미설정=기동 실패), 응답 전 실패만 1회 재시도 +
  429/503 Retry-After(상한 10s), op별 프로세스 로컬 CB, lease>호출예산
  기동 검증. 픽스처 서버(node:http 실 소켓) 22케이스.
- **RPT-002 경계**: 전송·매핑·가드·SSE 파서·`ContentDraft`(legacy 형상의
  도메인 승격 + v2 provenance 슬롯 예약 — 리뷰 M1 정정)까지. CONTENT job
  파이프라인·GeneratedBlock·보호 블록은 CC-130.
- **Target-v2**: tocV2만, 202→폴링→COMPLETED 결정적 mock. 요청은
  TocGenerationRequest 스키마로 기계 검증(오탈자 음성 포함).
  documentId/baseRevisionId는 mock 전용 플레이스홀더(`une-mock:*`) —
  live transport에서 접두사 감지 시 fail-closed(리뷰 M2 기제화).
- **선택 계층**: `UNE_T3Q_PLAN_ADAPTER=mock-legacy|legacy-http|
  mock-target-v2`. **구 변수 `UNE_T3Q_TOC_ADAPTER`는 기동 하드 실패**(해금
  아님 — ADR-26 D6이 CC-120 예고를 뒤집음). provider_config 토글은 admin
  API 선행 조건부 이연(예약 키 `t3q.planAdapter`). prod+mock 기동 차단.
- **추적성**: CC-120의 가드 위반 raw 유실 결함 시정(실패값에 raw 동봉),
  provider.requested 발행(phase:'intent', 어댑터 transportProfile 기준,
  본문·헤더·토큰 없음), 결과 기준 mappingVersion/httpStatus.
- **0016**: 자식 4테이블(job_event/toc_version/plan_context_snapshot/
  toc_node) EXISTS-부모 FORCE RLS — ADR-25 D2 종결. 한계 핀 테스트 반전,
  EXPLAIN 인덱스 경로 고정.
- **capability**: legacyToc → UNE_ADAPTER_READY(구현∧결선∧live spec 기준
  문장화). legacyContent/tocV2 MOCK_ONLY 유지. CR-T3Q-* 불변식 신설.
  mock 인스턴스는 `describeRuntimeCapability`가 MOCK RUNTIME 명시(리뷰 M3).
- 이중 리뷰 반영(당일 전부): 아키텍처 MAJOR 3(M1 ContentDraft 서술 정정,
  M2 플레이스홀더 차단 기제화, M3 mock 인스턴스 capability 표시) + MINOR
  11, QA PASS WITH CONDITIONS(F1=커밋, R1~R6 반영 — 503/403 테스트,
  수치 오기, 핸드오프 갱신 등).
- 게이트: provider-adapters 67, domain 35, contract-tests 38, worker 24,
  db-integration 51, api 175, baseline 6, contracts(예제 12·면제 2)/
  handoff/build/typecheck/lint/format 전부 PASS.

## Exact next actions

1. **사용자**: push(프롬프트 승인) → PR 생성·머지(CI verify + db-verify).
2. 다음 항목 **CC-130**(RPT-002 CONTENT job + 보호 블록): CC-125가 준
   것 — ContentCapable 어댑터(전송·매핑·SSE 파서 완료), ContentDraft,
   provider.requested. CC-130이 정의할 것 — GeneratedBlock·generated_block
   영속, 보호 블록 준수, 부분 이벤트(job.progress), 워커 CONTENT job 결선
   후 legacyContent capability 승격 평가, 리포지토리 추출 재평가(ADR-25
   D12), v2 generationOption 매핑 재평가(ADR-26 수용 한계).
3. CC-135 이월: v2 mock 확장(SSE/취소/부분재시도/semanticEdit/evidence/
   validation), 응답측 예제 확충(ADR-24 R2), getPlanProviderCapabilities
   예제 동기화, registerPlanReferenceDocument 면제 종결.

## Risks/blockers

- provider 중복 실행 가능성(레거시 멱등키 부재 — lease 하한으로 UNE 창만
  제거, OB-01/CC-400), SSE 프레이밍 UNE 가정(.assumed., OB-01), CB
  프로세스 로컬(CC-430), v2 폴링 예산은 lease 검증 밖(in-process라 무해,
  CC-135 재산정), documentId/baseRevisionId 실값은 CC-150.
- job.progress 이벤트 미발행(CC-130). 기존 이월분(OB-01/10/11 OPEN,
  redocly CC-400) 유지.
- 로컬 무DB `pnpm test`는 worker e2e·db-integration이 조용히 skip(QA R6)
  — CI db-verify가 커버. DATABASE_URL(superuser)을 설정하고 돌릴 것.

## Notes

- 이 PC DATABASE_URL: superuser une @ localhost:**15432**
  (infrastructure/.env 조합; WSL vmIdleTimeout으로 컨테이너가 내려갈 수
  있음 — `wsl -d Ubuntu` 깨우면 restart 정책으로 복구).
- prettier를 docs/·contracts/에 실행하지 말 것(전사본·설계 원문 재포맷
  사고 2회 — 대상은 소스 디렉터리로 한정하고 커밋 전
  `git status -- docs/design-markdown` 무변경 확인).
- services/api e2e는 워커 **소스**를 상대경로 import(tsconfig.test rootDir
  ../..) — dist 검증 금지 원칙(CC-115 QA F1).
- 루트 .env.example의 T3Q_API_BASE_URL은 전사본 host 문서화 전용 —
  UNE_T3Q_BASE_URL로 복사 금지(경고 주석 추가됨).
