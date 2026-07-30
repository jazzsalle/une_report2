# Session Handoff

- Date/time: 2026-07-30 (company PC, third session — post-reboot)
- Branches: feature/CC-004 (DONE, PR 대기); CC-002는 PR #2로 main 머지 완료
- Current Work Item: CC-004 DONE / next CC-100

## Completed this session

1. **CC-002 DONE + 머지** (PR #2, CI green): WSL2 Ubuntu 24.04 등록
   (`ubuntu.exe install --root` — 재부팅만으로는 미등록), Docker CE 29.6.2
   설치, compose 런타임 검증(healthy/pg_isready/mc ready/호스트 접근/볼륨
   영속성). 리뷰 반영: postgres:16.9-bookworm + ICU ko-KR, 127.0.0.1 바인드,
   MinIO 버킷 한정 서비스 계정(멱등 minio-init.sh), 비-superuser 앱 롤
   une_app(initdb), CI compose config 게이트.
   증거: docs/evidence/CC-002-runtime-verification.md.
2. **CC-004 DONE** (feature/CC-004, PR 대기):
   - 도구 확정 node-pg-migrate v9 (ADR-21, 사용자 승인). V###__ → 0###_ 개명.
   - 기준선 결함 첫 적용에서 발견·해소(전부 머지 전): uuid[]/jsonb 3곳,
     plan 타임스탬프 누락(설계 내부 모순), 비-PK 랜덤 기본값 74곳,
     uk_outbox_idem 누락, 전역 행(IS NULL) FORCE RLS 차단, 0001 빈-스키마 가드.
   - 0011: FORCE RLS 17, une_app 속성 강제 + 권한, pgmigrations 0권한,
     append-only/불변 5테이블 REVOKE.
   - tests/integration 17/17 (실제 PG 16.9; DATABASE_URL 없으면 skip —
     루트 pnpm test 초록은 DB 커버리지 아님, CI db-verify가 실제 실행).
   - 데이터 사전 docs/db/DATA_DICTIONARY.md (57/512) + CI drift 게이트.
   - 로컬 une DB 프로비저닝 완료 (pgmigrations=11/tables=57/forced=17).
   - 이중 리뷰 필수 지적 당일 반영 (M1~M4, C1~C6).
   증거: docs/evidence/CC-004-migration-verification.md.

## Key decisions

- ADR-21: 도구, 개명, 기준선 결함 해소 목록, 전역 행 정책(읽기만),
  불변성 DB 강제 범위(스냅샷 2종; sop_version/evidence는 CC-250/CC-230 유예),
  테넌트 격리 보상통제(DB RLS는 17개 상위 테이블만; 하위는 서비스 레이어
  조인 — CC-100 수용 기준에 추가됨).
- TECHNOLOGY_PROFILE: migration tool CLOSED (node-pg-migrate v9).

## Exact next actions

1. GitHub에서 feature/CC-004 PR 생성·머지 (push는 사람이 직접 —
   settings.json이 git push를 하드 차단):
   `git push -u origin feature/CC-004` 후
   https://github.com/jazzsalle/une_report2/pull/new/feature/CC-004
   CI에서 verify + db-verify 잡이 모두 실행됨.
2. CC-100 (mock auth/tenant/RBAC; deps CC-003+CC-004 충족): 전역 role 행은
   런타임 읽기 전용, 하위 테이블 테넌트 격리는 리포지토리 조인 강제,
   실접속 une_app 경로 검증 포함.

## Risks/blockers

- WSL 유휴 자동 종료: Windows에서 5432 접속 전 `wsl -d Ubuntu -- true`로
  깨울 것. /tmp도 초기화됨(스크립트 재복사 필요).
- 0010 파티션 전환 시: 파티션별 append-only REVOKE 재적용 필수
  (README 체크리스트).
- IX-*-TENANT 10건 미구현 — 각 도메인 항목에서 Query Plan으로 확정
  (README 대응표).
- Deferred: example-level contract tests(CC-115/CC-400), redocly 재평가,
  UNI_VERIFY_TLS=false POC-local carried risk.

## Notes

- gh CLI 미설치; CI 상태는 GitHub REST API로 확인(공개 저장소).
- mc/postgres 컨테이너 이미지엔 coreutils 최소(minio-init.sh는 셸 내장만).
- 마이그레이션·테스트·사전 생성의 DATABASE_URL은 superuser(une);
  런타임 서비스는 une_app. 헬퍼/스크립트에 une_app 사용 시 즉시 실패 가드.
