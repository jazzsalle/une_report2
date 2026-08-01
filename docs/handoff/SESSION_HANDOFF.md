# Session Handoff

- Date/time: 2026-08-02 (집 PC, CC-115 + CC-120 세션)
- Branch: **feature/CC-120** @ main 3ebb4d7 기반 (CC-115는 PR #6 머지 완료)
- Current Work Item: **CC-120 DONE(구현·이중리뷰 반영·게이트 통과)** —
  커밋·push 후 PR 대기 / next **CC-125** (deps=CC-115·CC-120)
- 이 PC(집 PC): 로컬 DB 포트 **15432**, 마이그레이션 **15개** + dev 시드.

## Completed this session (CC-120)

**T3Q RPT-001 목차 생성 Job** — 수용기준 5종 전부 기계 검증.

- **API**: UNE-PLAN-009~015 전부. 멱등 2층(인터셉터 + uk_job_idempotency
  sha256(jobType|endpoint|planId|clientKey)), 010 result 투영, 011 SSE
  (**Nest @Sse가 async 핸들러를 await하지 않는 결함 발견** → 수동 스트리밍;
  공개/내부 이벤트 분리, Last-Event-ID 재개, heartbeat=커서 반복), 012/013
  (retry는 FAILED 전용 + 009와 동일 전제조건 재적용 + attempt 예산 리셋),
  014/015(키 승계·u-* 네임스페이스·confirm→OUTLINE_CONFIRMED, **활성 job 중
  저장 409로 사용자 편집 보호** — 리뷰 B1).
- **워커 실행면**(설계 10 §4.2/§7.9, ADR-25): 0015 — generation_job 보강
  (created_at 등 기준선 결함), `une_worker` 롤 + **테넌트 미설정 시에만
  유효한 디스패치 RLS 정책**(종결 상태는 테넌트 스코프에서만 기록 가능,
  DB 강제 실증). 3-tx 러너(선점 SKIP LOCKED → 전제조건 → provider 호출
  트랜잭션 밖 → 결과 반영), 취소 스윕, lease 재선점, maxAttempts.
- **포트/어댑터**: 좁은 T3qTocPort + 갭 매트릭스 매퍼(CC-115 픽스처 왕복)
  + 응답 가드 + 결정적 mock(명시 플래그·MOCK_ONLY 기동 경고 — mock≠실지원).
  CC-125가 T3qPlanProvider로 흡수 예정.
- **도메인**: job 상태기계, toc-tree(검증·결정적 node_key n-*·flatten·내용
  해시), 순수 SHA-256(브라우저 중립), TocJobRequest 시임.
  plan-status/canonical-json은 services/api → @une/domain 이동.
- 이중 리뷰 반영(당일 전부): B1 사용자 편집 보호 경합, M2 멱등 키에 planId
  누락(타 계획서 job 반환 결함), QA 필수-2/3 retry 가드 우회(휴지통 목차
  재생성 실측), 필수-1 CI 빌드 누락, M3 매퍼 예외 RUNNING 방치, M4 mock
  플래그, M1 하위 테이블 RLS 부재 사실 정정 등 — 상세는
  docs/evidence/CC-120-t3q-toc-job-verification.md.
- 게이트: api **175/175**, worker 12/12, db-integration **41/41**, domain
  31/31, provider-adapters 16/16, contract-tests 26/26, baseline 6,
  contracts(18 mock routes)/handoff/build/typecheck/lint/format 전부 PASS.

## Exact next actions

1. **사용자**: 커밋 승인 → push(프롬프트 승인) → PR 생성·머지(CI verify+
   db-verify — db-verify에 build·worker 스텝 추가됨).
2. 다음 항목 **CC-125**(dual Legacy/TargetV2 어댑터 + T3qPlanProvider 포트
   통합 + feature flag + raw payload/mappingVersion): T3qTocPort·매퍼·가드
   승계, provider_config.feature_flags_json 활용, 타임아웃(설계 §4.2
   5s/60s)·백오프·CB, target-v2 응답측 예제 보강(ADR-24 R2),
  `UNE_T3Q_TOC_ADAPTER='legacy-http'` 해금.
3. **CC-130 이전 과제**(ADR-25 D2 등록): 0016 후보 — job_event/toc_version/
   toc_node/plan_context_snapshot에 EXISTS(부모) RLS 하드닝(job_event가
   provider 원문을 담게 되어 노출 반경 증가).

## Risks/blockers

- job.progress/provider.requested 이벤트는 선언만·미발행(CC-130),
  generationOption은 legacy 매퍼가 미사용(RPT-001 계약에 필드 없음 —
  CC-125에서 확정), lease 탈취 시 provider 중복 호출 가능(결과 이중 반영은
  차단 — 펜싱은 CC-125), baseline mock에 retry 성공 경로 없음(실 서비스
  e2e가 커버).
- 기존 이월분(OB-01/10/11 OPEN, redocly CC-400 등) 유지.

## Notes

- 이 PC DATABASE_URL: superuser une @ localhost:**15432**.
- prettier를 docs/·contracts/에 실행하지 말 것(전사본·설계 원문 재포맷
  사고 2회 — 대상은 소스 디렉터리로 한정하고 커밋 전
  `git status -- docs/design-markdown` 무변경 확인).
- services/api e2e는 워커 **소스**를 상대경로 import(tsconfig.test rootDir
  ../..) — dist 검증 금지 원칙(CC-115 QA F1).
