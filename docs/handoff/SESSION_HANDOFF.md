# Session Handoff

- Date/time: 2026-08-01 (집 PC, 첫 부트스트랩 + CC-110 세션)
- Branch: **feature/CC-110** @ main e0dc653 기반 (변경 39파일 스테이징 완료,
  **커밋 대기 — 사용자 승인 필요**)
- Current Work Item: **CC-110 DONE(구현·이중리뷰 반영·게이트 통과)** /
  next **CC-115** (번호 빠른 순 — 사용자 기결정)
- 이 PC(집 PC) 부트스트랩 완료: WSL2 Ubuntu 26.04 + Docker CE 29.7.1,
  compose healthy, 마이그레이션 **14개** + dev IAM 시드 적용.
  **주의: 이 PC는 Windows 네이티브 PostgreSQL이 5432를 점유 → 로컬 포트
  15432 사용** (infrastructure/.env UNE_DB_PORT=15432, services/api/.env
  DATABASE_URL도 15432; 둘 다 gitignored 로컬 파일 — 저장소 기본값은 5432
  유지, 회사 PC는 5432 그대로).

## Completed this session

**부트스트랩(집 PC)**: Docker CE 설치(wsl -u root 경유), .env 2종 생성
(비밀값은 openssl rand, 대화·저장소 미노출), compose up healthy,
마이그레이션 14 + `pnpm db:seed:dev`.

**CC-110 DONE**: UNE-PLAN-001~008 (plan CRUD, 기준정보 draft/불변 snapshot).

- plan 모듈(services/api/src/plan/*): CRUD + If-Match(version_no) 낙관잠금
  (강한 ETag만, 428/409), 휴지통 soft delete(멱등 204, APPROVED/FINAL 403),
  draft 완화검증(AJV 2020-12, required/minLength/minItems만 유예)·단일
  upsert, snapshot 엄격검증 + canonical SHA-256 + 버전 max+1(FOR UPDATE
  직렬화) + supersedes + 동일해시 dedupe + DRAFT→CONTEXT_READY(도메인 전이
  함수 plan-status.ts) + 승인잠금 412 — 전부 동일 트랜잭션 + 감사
  (PLAN_CREATED/UPDATED/DELETED/PLAN_CONTEXT_SAVED/CONTEXT_SNAPSHOT_CREATED,
  UPDATED/DELETED는 before_json 포함).
- **멱등키 공통 인터셉터**(ADR-22 D6 해소, ADR-23 D1): 마이그레이션 0014
  `api_idempotency`(59번째 테이블, RLS FORCE, 런타임 DELETE 회수) +
  `@Idempotent` 라우트(생성 001·확정 007 필수). 재생 식별자는 **구체
  경로+주체(created_by)** — 리뷰 BLOCKER(타 계획서 응답 재생·확정 무음
  유실, QA가 HTTP 재현)를 당일 시정. draft/PATCH는 재생 저장소 제외(자연
  멱등/If-Match; 계약 파라미터 동시 제거).
- 0014 추가분: `uk_plan_context_draft_plan`(draft 1행), `plan.start_mode`
  (US-PLAN-002 AC-02 저장 컬럼 부재 해소).
- 계약 동시 변경: Plan 슬라이스 스키마 확정(envelope, PlanResource 등),
  GET /plans 쿼리 파라미터, DELETE 204, `IdempotencyKeyRequired`,
  412/428 공통 응답 신설, **PLAN-412-002 신설**(상태 전제조건;
  PLAN-412-001은 설계 8.3 원 의미로 CC-120에 예약), 3.1 nullable 교정,
  PlanCreateRequest에 hazardType/managementPhase 필수(ADR-23 D3).
  mock-server plan 구간도 계약 정합(400 PLAN-4001, CONTEXT_READY,
  contextJson, 실제 SHA-256).
- plan-context.schema.json → 생성 TS 모듈(generate-contract-types.mjs 확장,
  동일 drift 게이트).
- AuditRepository 공용 분리(도메인 서비스가 auth 모듈에 의존하지 않게).
- 이중 리뷰(architecture-guardian BLOCKER1+MAJOR7+MINOR14 /
  qa-gate-reviewer 필수6+권고12) **당일 전부 반영** — 상세는
  docs/evidence/CC-110-plan-context-snapshot-verification.md "이중 리뷰
  반영" 절.
- 테스트: **@une/api 107/107 — 5회 연속**(e2e 38: plan 23 + auth 15;
  vitest.config.ts fileParallelism:false로 e2e 동시 CREATE DATABASE 경합
  해소), **@une/db-integration 30/30**(0014 신규 5), 루트 pnpm test PASS,
  build/typecheck/lint/format/validate:contracts/validate:handoff PASS.

## Key decisions (ADR-23)

- api_idempotency 재생 저장소(D1: 구체경로+주체 식별, 2xx만 COMPLETED,
  FAILED/stale 재선점, drafts·PATCH 제외), draft 단일행+완화검증(D2),
  생성계약 hazardType/managementPhase 필수 + start_mode 컬럼(D3),
  snapshot 확정 규칙(D4: 승인잠금 412, 전이 도메인 함수, 확정응답 ETag,
  hazard 초안값/snapshot 권위 어휘), 오류코드 확정(D5: PLAN-412-002 신설,
  COM-0400 일반화, 412/428 계약 선언, 강한 ETag만).
- 수용 한계: 재생 기록 실패 시 중복 1회(WARN 관측), api_idempotency
  TTL·보존은 CC-430 계열, 메타 PATCH 상태 제한은 CC-170+ 재평가,
  x-error-codes↔responses 교차 게이트 부재는 후속 개선.

## Exact next actions

1. **사용자**: 스테이징된 CC-110 변경 검토 → 커밋 승인(메시지 예:
   "CC-110 DONE: plan CRUD + immutable PlanContextSnapshot +
   api_idempotency (ADR-23); dual-review fixes applied") → `! git push`
   → PR 생성·머지(CI verify+db-verify 확인).
2. 다음 항목 **CC-115**(T3Q RPT-001/002 현행 + target-v2 계약 기준선):
   deps=CC-110 충족. contracts/openapi/t3q-* 2종, 필드 갭 매트릭스,
   capability 상태 분리(mock≠실지원, OB-10/11), no UNI plan fallback.
3. CC-120 진입 시 PLAN-412-001(스냅샷 미확정) 사용 — ADR-23 D5 예약 참조.

## Risks/blockers

- WSL 유휴 종료(집 PC도 동일 리스크) — 긴 세션엔
  `wsl -d Ubuntu -- sleep 3600 &` keepalive. 이 세션은 keepalive 사용.
- 이 PC 로컬 포트 15432 — 문서/스크립트 예시는 5432이므로 명령 실행 시
  로컬 .env의 포트를 따를 것.
- Deferred(이월): example-level contract tests(CC-115/CC-400),
  x-permission↔@RequirePermission 자동 대조, x-error-codes↔responses 교차
  게이트, api_idempotency TTL/보존(CC-430), IX-*-TENANT 잔여 10건,
  mock-server에 context-drafts 라우트 없음(mock sync 13 유지 결정).

## Notes

- git push는 deny rule로 Claude 실행 불가 — 사용자가 `! git push`.
- gh CLI 미설치; CI 상태는 GitHub REST API로 조회.
- DATABASE_URL(이 PC): superuser
  `postgres://une:<UNE_DB_PASSWORD>@localhost:15432/une` (비밀값은
  infrastructure/.env), 테스트 e2e는 admin URL + UNE_DB_RUNTIME_ROLE=
  une_app 패턴 유지.
- services/api vitest는 이제 파일 직렬 실행(fileParallelism:false) —
  e2e 스위트가 늘어나도 같은 클러스터에서 안전.
