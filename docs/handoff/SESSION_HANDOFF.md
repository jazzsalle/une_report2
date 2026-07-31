# Session Handoff

- Date/time: 2026-07-31 (company PC, fourth session — 종료)
- Branch: main @ 03e6ad4 (PR #4 머지 커밋; 작업 트리 clean, 로컬 feature/CC-100 삭제)
- Current Work Item: CC-100 DONE·머지 / next **CC-110 또는 CC-200** (사용자 선택)
- 다음 세션: 이 PC 재개 시 부트스트랩 불필요 — WSL 깨우기 + (긴 작업이면)
  keepalive(`wsl -d Ubuntu -- sleep 3600 &`) 후 바로 다음 항목 착수.
  로컬 DB는 13 마이그레이션 + dev IAM 시드 적용 상태.

## Completed this session (main 머지, CI verify+db-verify 둘 다 success)

**CC-100 DONE** (PR #4, b605318): mock 인증·테넌트·RBAC.

- UNE-AUTH-001~007 구현 (services/api NestJS: auth/iam 모듈, 전역
  JwtAuthGuard/PermissionsGuard, ApiErrorFilter→common-error envelope,
  DatabaseService.withTenant = 트랜잭션 로컬 `app.tenant_id` + 선택적
  `SET LOCAL ROLE une_app`).
- mock JWT: `AUTH_MODE=mock` + `UNE_AUTH_JWT_SECRET`(32자 미만 기동 실패,
  기본값 없음)에서만 발급. 비-mock exchange는 503 AUTH-1004 (실 SSO OB-01 OPEN).
- 테넌트 위조 5경로 차단 e2e 검증(mock 토큰 tenant/JWT tid 변조/타키 서명/
  refresh tenant 세그먼트/쿼리파라미터). 하위 테이블(user_session/user_role/
  role_permission)은 부모 조인 강제(ADR-21 보상통제) — bare SELECT 비보호를
  통합테스트로 문서화.
- **마이그레이션 0012**: `role_permission` 신설 — 설계 API/SEQ가 읽는 테이블이
  §6 물리 목록에 누락된 내부 모순 해소(58번째 테이블). 권한 카탈로그 54종
  (계약 x-permission 1:1), 시스템 역할 15종(설계 09 §3 1:1), role_code 부분
  유니크. 역할→권한 매트릭스는 설계 미확정이라 **시드하지 않음** — dev 시드
  (`pnpm db:seed:dev`, database/seeds/dev-iam.sql)와 테스트 픽스처만.
- **마이그레이션 0013**(리뷰 반영): permission 카탈로그 런타임 REVOKE,
  카탈로그 GRANT SELECT 명시, `uk_user_session_refresh_hash`.
- 계약 동시 변경: TokenResponse→`{success,data,meta}` envelope(ADR-22 D4),
  `/auth/refresh` `security: []`+`x-permission: PUBLIC_REFRESH`(D3 보완),
  Idempotency-Key 재생 저장소 명시 이연(D6, CC-110+ 공통 인터셉터에서 재평가).
  생성 타입 재생성, validate:contracts PASS.
- 이중 리뷰(architecture-guardian BLOCKER1/MAJOR4/MINOR9 +
  qa-gate-reviewer 필수4) **당일 전부 반영**: X-Correlation-Id
  `^[A-Za-z0-9._:-]{1,80}$` 정규화(varchar(80) 불일치로 로그인 500·감사 우회
  가능했던 결함), refresh 회전 제시-해시 가드(동시 사용 1승자), SUSPENDED
  테넌트·비활성 사용자 전 경로 차단, 존재하지 않는 세션 logout 401,
  ACCESS_DENIED 감사 path 쿼리스트링 제거(PII).
- 테스트: **@une/api 55/55**(unit 40 + e2e 15 — 스크래치 DB에
  마이그레이션 적용 후 une_app 롤로 HTTP 검증; DATABASE_URL 없으면 e2e skip),
  **@une/db-integration 25/25**. CI db-verify에 api e2e 추가.
  루트 `pnpm test`는 `--workspace-concurrency=1`로 직렬화.
- 증거: docs/evidence/CC-100-auth-rbac-verification.md / ADR-22 /
  DATA_DICTIONARY 58테이블·516컬럼 재생성.

## Key decisions (ADR-22 + 추록)

- role_permission 스키마 보완·카탈로그 시드 범위(D1/D2), mock 토큰 형식과
  위조 차단 모델(D3), refresh=Public+회전(D3), TokenResponse envelope(D4),
  AUTH-1001~1006 확정(D5), Idempotency-Key 이연(D6).
- 감사 액션 어휘 확정: LOGIN/LOGIN_FAILED/SESSION_REFRESHED/LOGOUT/
  ACCESS_DENIED — 후속 항목 재사용.
- meta.timestamp는 UTC Z 표기.
- 마이그레이션 주체는 superuser/BYPASSRLS 전제(전역 행 시드; migrations
  README 명문화).
- 수용된 한계: access token은 만료(900s)까지 유효(로그아웃=refresh 폐기),
  LOGIN_FAILED 감사 tenant_id는 주장값(레이트리밋 CC-430 재평가),
  OBJECT scope(user_role.scope_id) 판정은 CC-110+.

## 다른 PC(예: 집 PC)에서 시작할 경우

모든 산출물은 origin/main에 있다. PC별 로컬 요소만 다시 준비한다:

1. `git pull` (main a18a402) → `pnpm install`
2. Docker 런타임 준비(infrastructure/README.md 무료 경로 중 택1; WSL2면
   `wsl --install -d Ubuntu` 후 **재부팅+배포판 등록 확인** — 회사PC에서는
   재부팅 후 `ubuntu.exe install --root` 등록이 추가로 필요했음)
3. `infrastructure/.env` 로컬 생성(gitignored): `cp .env.example .env` 후
   비밀값 5개(UNE_DB_PASSWORD, UNE_DB_APP_PASSWORD, UNE_MINIO_ROOT_PASSWORD,
   UNE_STORAGE_ACCESS_KEY/SECRET_KEY) 채움 (`openssl rand -hex 16`)
4. `services/api/.env` 로컬 생성(CC-100 신규): `cp .env.example .env` 후
   `UNE_AUTH_JWT_SECRET`(`openssl rand -hex 32`)과 DATABASE_URL의
   UNE_DB_APP_PASSWORD 채움
5. `docker compose up -d` → healthy 확인 →
   `DATABASE_URL=postgres://une:<pw>@localhost:5432/une pnpm db:migrate`
   (**13개** 적용) → 선택: `pnpm db:seed:dev` (demo 테넌트/사용자, 멱등)
6. 검증: `pnpm --filter @une/db-integration test` (25/25),
   `pnpm --filter @une/api test` (55/55 — DATABASE_URL 있어야 e2e 15 실행)
7. 전체 게이트: `pnpm build/typecheck/test/lint/format:check/
   validate:contracts/validate:handoff`
8. WSL 유휴 종료는 **작업 도중에도** 발생 — 긴 세션엔
   `wsl -d Ubuntu -- sleep 3600 &` keepalive (infrastructure/README.md).

## Exact next actions

1. 다음 Work Item **사용자 선택**: CC-110(Plan+PlanContextSnapshot, 계획서
   슬라이스) 또는 CC-200(Situation+Fact, 상황 슬라이스) — 둘 다 deps=CC-100
   충족. feature/CC-<id> 브랜치에서 implement-work-item 절차로.
2. CC-110이면: 10_API_DB_SEQUENCE §3.3 PLAN, plan/plan_context_snapshot
   (0003), 불변성 REVOKE(0011), PlanContext JSON Schema
   (contracts/schemas/plan-context.schema.json), Idempotency-Key 공통
   인터셉터 도입 검토(ADR-22 D6).
3. CC-200이면: §3.6 SIT, situation/situation_fact(0004), providers는 mock.

## Risks/blockers

- **WSL 유휴 종료가 작업 도중에도 발생**(이번 세션에서 간헐 ECONNREFUSED로
  확인) — 긴 테스트/마이그레이션 세션엔 keepalive 프로세스 권장
  (infrastructure/README.md 보강됨).
- 0010 파티션 전환 시 파티션별 append-only REVOKE 재적용 필수.
- IX-*-TENANT 10건 미구현 — 각 도메인 항목에서 Query Plan으로 확정.
- Deferred: example-level contract tests + 응답 AJV 검증(CC-115/CC-400),
  x-permission↔@RequirePermission 자동 대조 게이트(권고), 계약 쿼리 파라미터
  미선언(기준선 한계), UNI_VERIFY_TLS=false POC-local carried risk.
- 설계 09 화면표에 카탈로그 외 역할 표기(ORG_ADMIN 등) — 설계 내부 불일치,
  해당 화면 항목 구현 시 확인.

## Notes

- git push는 .claude/settings.json deny로 Claude가 실행 불가 — 사람이 직접.
- gh CLI 미설치; CI 상태는 GitHub REST API(공개 저장소)로 조회.
- DATABASE_URL: 마이그레이션·시드·사전·테스트는 superuser(une), 런타임은
  une_app(services/api/.env). 테스트 e2e는 admin URL + UNE_DB_RUNTIME_ROLE
  =une_app(SET LOCAL ROLE)로 FORCE RLS 동일 적용.
- 이 PC git core.autocrlf=true — .gitattributes eol=lf가 우선.
- services/api/.env에 UNE_AUTH_JWT_SECRET 등 신규 키 필요(.env.example 참조;
  로컬 .env는 gitignored라 다음 세션에서 `openssl rand -hex 32`로 채울 것 —
  이번 세션 e2e는 테스트 내 상수를 사용했으므로 로컬 .env 미갱신 상태일 수 있음).
