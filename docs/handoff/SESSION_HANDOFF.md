# Session Handoff

- Date/time: 2026-07-30 (company PC, third session — post-reboot)
- Branches: feature/CC-002 (DONE, PR 대기)
- Current Work Item: CC-002 DONE / next CC-004

## Completed this session

- WSL2 Ubuntu 24.04 registered post-reboot (`ubuntu.exe install --root`;
  reboot alone left the distro unregistered) + Docker Engine CE 29.6.2 /
  Compose v5.3.1 installed inside Ubuntu per infrastructure/README.md
  (systemd auto-starts dockerd).
- CC-002 runtime verified and DONE: compose up healthy (postgres/minio),
  pg_isready + mc ready, host access via WSL localhost forwarding
  (9000/9001=200, TCP 5432 OK), named volumes survive compose down/up
  recreation AND WSL VM restart. Evidence:
  docs/evidence/CC-002-runtime-verification.md.
- CC-002 dual review (project agent types now registered and used directly):
  architecture-guardian CONDITIONAL PASS, qa-gate-reviewer PASS WITH
  CONDITIONS (acceptance criteria independently reproduced). All mandatory
  findings fixed same day:
  - postgres:16.9-bookworm + ICU ko-KR initdb (demo managed-PG parity, M-4)
  - 127.0.0.1 default bind via UNE_BIND_ADDRESS (M-2)
  - MinIO bucket-scoped policy + service account via idempotent
    minio-init.sh; root = human ops only (M-1/C3)
  - non-superuser app role une_app (NOSUPERUSER/NOBYPASSRLS) created by
    initdb/01-app-role.sh; runtime DATABASE_URL uses it (C2)
  - CI: docker compose config --quiet gate (C5)
  - README: WSL idle-shutdown trap, scope deferrals (AV scan → CC-140/220,
    PgBouncer, bucket versioning, digest pinning) (C4/L)
  - status docs synced 4 places + evidence committed (M-3/C1)
- CC-004 acceptance criteria extended: FORCE ROW LEVEL SECURITY + RLS tests
  as une_app (owner/superuser bypasses RLS).
- IMPLEMENTATION_BASELINE §6: OB-14 Railway closure line added (L-3).

## Evidence

- docs/evidence/CC-002-runtime-verification.md (initial + post-fix rebuild:
  une_app rolsuper=f/rolbypassrls=f, ICU ko-KR on DB une, service account
  bucket-RW-OK/admin-denied/mb-denied, minio-init idempotent 2x Exited(0),
  docker port all 127.0.0.1).
- Full pnpm gate green incl. validate:handoff; qa reviewer re-ran the gate
  independently (10/10 tests).

## Exact next actions

1. GitHub에서 feature/CC-002 PR 생성·머지 (CI가 PR에서 실행됨):
   https://github.com/jazzsalle/une_report2/pull/new/feature/CC-002
2. CC-004 (DB 마이그레이션): migration tool 결정(node-pg-migrate vs Prisma
   migrate, ADR-19 deferral) → 57-table baseline, FORCE RLS + une_app 테스트,
   outbox 단일 트랜잭션 통합 테스트. CC-002 런타임 사용 가능.

## Risks/blockers

- WSL2 유휴 자동 종료: Windows에서 localhost:5432/9000 접속 전에 WSL을 먼저
  깨워야 함 (`wsl -d Ubuntu -- docker compose ps`). README에 기록됨.
- initdb 인자/앱 롤 변경은 `docker compose down -v`(볼륨 초기화) 필요 —
  로컬 데이터 삭제 주의.
- Deferred: example-level contract tests는 tests/ 배선 시(CC-115/CC-400),
  redocly 스타일 린트 재평가 동일 시점 (ADR-20 결정 6).
- Root .env.example UNI_VERIFY_TLS=false는 POC-local 전용 (carried risk).
- LOW 이월: OB-14 OPEN/CLOSED 동시 등재 표기(OB-14a/b 분리 제안), 이미지
  digest 고정, MinIO 버킷 버전관리 — 기록 위치는 CC-002 리뷰 결과 참조.

## Notes

- gh CLI 미설치; CI 상태는 GitHub REST API로 확인 가능(공개 저장소).
- 이 PC git core.autocrlf=true — .gitattributes eol=lf가 우선함. WSL로
  마운트되는 셸 스크립트(minio-init.sh, initdb/*.sh)는 LF 필수(.gitattributes
  가 보장, 검증 시 CR 검사 수행).
- mc 이미지는 coreutils 미포함(sed/grep 없음) — minio-init.sh는 셸 내장만
  사용.
