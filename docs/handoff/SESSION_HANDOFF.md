# Session Handoff

- Date/time: 2026-07-30 (company PC, third session — 종료)
- Branch: main @ ed60483 (작업 트리 clean, 모든 작업 머지·푸시 완료)
- Current Work Item: CC-004 DONE·머지 / next **CC-100**
- 다음 세션: **내일 회사PC(이 PC)에서 재개** — Docker 런타임·infrastructure/.env·
  로컬 DB(11 마이그레이션)가 이미 프로비저닝돼 있어 부트스트랩 불필요.
  WSL 깨우기(`wsl -d Ubuntu -- true`)만 하고 바로 CC-100 착수.

## Completed this session (모두 main에 머지, CI green)

1. **CC-002 DONE** (PR #2): WSL2 Ubuntu 24.04 등록(`ubuntu.exe install
   --root` — 재부팅만으로는 미등록) + Docker CE 29.6.2, compose 런타임 검증
   (healthy/pg_isready/mc ready/호스트 포트/볼륨 영속성·WSL 재시작 생존).
   리뷰 반영: postgres:16.9-bookworm+ICU ko-KR, 127.0.0.1 바인드,
   MinIO 버킷 한정 서비스 계정(멱등 minio-init.sh), initdb 비-superuser 롤
   une_app, CI compose config 게이트.
   증거: docs/evidence/CC-002-runtime-verification.md
2. **CC-004 DONE** (PR #3, verify+db-verify 둘 다 success):
   node-pg-migrate v9 확정(ADR-21, 사용자 승인), V###__→0###_ 개명.
   기준선 결함 첫 적용에서 발견·전부 머지 전 해소: uuid[]/jsonb 3곳→uuid[],
   plan created_at/updated_at+트리거(설계 내부 모순), 비-PK 랜덤 기본값
   74곳 제거(사용자 승인), BEGIN/COMMIT 제거, uk_outbox_idem 추가,
   전역 행(tenant_id IS NULL) 정책 읽기전용 정정, 0001 빈-스키마 가드.
   0011: FORCE RLS 17테이블, une_app 속성 멱등 강제+권한, pgmigrations
   0권한, append-only/불변 5테이블 REVOKE.
   tests/integration(@une/db-integration) **17/17** (실제 PG 16.9;
   DATABASE_URL 없으면 skip — 루트 pnpm test 초록은 DB 커버리지 아님).
   데이터 사전 docs/db/DATA_DICTIONARY.md(57테이블/512컬럼)+CI drift 게이트,
   CI db-verify 잡 신설. 이중 리뷰 필수 지적(M1~M4/C1~C6) 당일 반영.
   증거: docs/evidence/CC-004-migration-verification.md

## Key decisions

- ADR-21: 도구·개명·기준선 결함 해소·전역 행 정책·불변성 DB 강제 범위
  (스냅샷 2종 REVOKE; sop_version/evidence는 CC-250/CC-230 앱 계층 유예)·
  테넌트 격리 보상통제(DB RLS는 상위 17테이블만, 하위는 서비스 레이어 조인
  — CC-100 수용 기준에 추가됨).
- TECHNOLOGY_PROFILE: migration tool CLOSED (node-pg-migrate v9).
- OB-14 데모 백엔드 호스트 Railway CLOSED(전 세션), 최종 납품 환경 OPEN.

## 다른 PC에서 시작할 경우 (참고)

회사PC 재개 시에는 해당 없음 — 필요하면 `git pull`(원격이 앞서 있을 때만)과
WSL 깨우기만. 새 PC에서 시작할 때만 아래 절차를 따른다:

1. `git pull` (main ed60483) → `pnpm install`
2. Docker 런타임 준비(infrastructure/README.md 무료 경로 중 택1; WSL2면
   `wsl --install -d Ubuntu` 후 **재부팅+배포판 등록 확인** — 회사PC에서는
   재부팅 후 `ubuntu.exe install --root` 등록이 추가로 필요했음)
3. `infrastructure/.env` 새로 작성(gitignored — PC마다 로컬 생성):
   `cp .env.example .env` 후 비밀값 5개(UNE_DB_PASSWORD, UNE_DB_APP_PASSWORD,
   UNE_MINIO_ROOT_PASSWORD, UNE_STORAGE_ACCESS_KEY/SECRET_KEY) 채움
   (`openssl rand -hex 16`)
4. `docker compose up -d` → healthy 확인 →
   `DATABASE_URL=postgres://une:<pw>@localhost:5432/une pnpm db:migrate`
   (11개 적용) → `pnpm --filter @une/db-integration test` (17/17)
5. 전체 게이트: `pnpm build/typecheck/test/lint/format:check/
   validate:contracts/validate:handoff`

## Exact next actions

1. **CC-100** (mock auth/tenant/RBAC; deps CC-003+CC-004 충족, G1):
   feature/CC-100 브랜치에서 implement-work-item 절차로. 수용 기준에 CC-004
   이관분 포함 — 하위 테이블 테넌트 격리는 리포지토리 조인 강제, 전역 role
   행은 런타임 읽기 전용, une_app 실접속(LOGIN) 경로 검증.
2. CC-100 설계 참조: 10_API_DB_SEQUENCE §인증/권한, role/app_user/permission
   테이블(0002), RLS 전제(0008/0011).

## Risks/blockers

- WSL 유휴 자동 종료: Windows에서 5432/9000 접속 전 `wsl -d Ubuntu -- true`
  로 깨울 것(infrastructure/README.md 주의 절).
- 0010 파티션 전환 시 파티션별 append-only REVOKE 재적용 필수(README 체크리스트).
- IX-*-TENANT 10건 미구현 — 각 도메인 항목에서 Query Plan으로 확정(README 대응표).
- Deferred: example-level contract tests(CC-115/CC-400)+redocly 재평가,
  UNI_VERIFY_TLS=false POC-local carried risk.

## Notes

- git push는 .claude/settings.json deny로 Claude가 실행 불가 — 사람이 직접.
- gh CLI 미설치; CI 상태는 GitHub REST API(공개 저장소)로 조회.
- 마이그레이션·테스트·사전 생성 DATABASE_URL은 superuser(une), 런타임은
  une_app; 헬퍼/스크립트에 une_app 사용 시 즉시 실패 가드 있음.
- mc/postgres 컨테이너 이미지는 coreutils 최소(스크립트는 셸 내장만 사용).
- 이 PC git core.autocrlf=true — .gitattributes eol=lf가 우선(셸 스크립트 LF 필수).
