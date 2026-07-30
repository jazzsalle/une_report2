# CC-004 마이그레이션 기준선 검증 증거

- 일시: 2026-07-30 (회사 PC)
- 브랜치: feature/CC-004
- 실행 환경: Windows 11 + WSL2 Ubuntu 24.04, Docker CE 29.6.2,
  PostgreSQL 16.9(bookworm, ICU ko-KR) — CC-002 compose
- 도구: node-pg-migrate v9.0.0 + pg 8.22.0 (ADR-21)

## 수용 기준별 검증

| 기준 | 결과 | 증거 |
|---|---|---|
| empty DB migration | PASS | 빈 스크래치 DB에 `runner` up → pgmigrations 11행(0001~0011), psql 순차 프로브 동일 결과 |
| upgrade fixture migration | PASS | 0001~0010 적용 → 픽스처(tenant/app_user/situation/dispatch) 삽입 → 0011 적용 → 데이터 무손실 + FORCE 플래그 확인 |
| 57-table baseline | PASS | information_schema BASE TABLE 57 (pgmigrations 제외); 로컬 une DB 실제 적용 동일 |
| data dictionary sync | PASS | `pnpm db:data-dictionary` → docs/db/DATA_DICTIONARY.md (57 tables / 512 columns), 재생성 결정성 sha256 동일(QA 재현), CI db-verify가 git add -N + diff로 drift 차단 |
| migration tool decision | PASS | ADR-21 (node-pg-migrate 채택, Prisma 기각 사유, 사용자 승인 2026-07-30) |
| ORM/타입 격리 | PASS | pg/node-pg-migrate는 루트 devDeps + tests/integration에만 존재; apps/services/packages에 DB 클라이언트 의존 0건 (양 리뷰어 독립 확인) |
| outbox 단일 트랜잭션 | PASS | dispatch 상태변경+execution_event+outbox_message 커밋/롤백 테스트 (SET ROLE une_app + set_config app.tenant_id) |
| FORCE RLS + une_app 테스트 | PASS | relforcerowsecurity 17테이블, RLS 테스트는 SET ROLE une_app(rolsuper=f, rolbypassrls=f)로 수행 |

## 테스트 실행 (명령·결과)

```
DATABASE_URL=postgres://une:<UNE_DB_PASSWORD>@localhost:5432/une \
  pnpm --filter @une/db-integration test
→ 2 files, 17/17 passed (migrations 9, outbox-rls 8)

(DATABASE_URL 미설정) → 17 skipped, exit 0  # 루트 pnpm test의 초록은 DB 커버리지가 아님
pnpm db:migrate (로컬 une DB) → 11 applied; pgmigrations=11, tables=57, forced RLS=17
```

테스트 내역: 빈 DB 57테이블/11적용, RLS enable+FORCE 17, une_app 속성(f/f),
append-only·불변 5테이블(APPEND_ONLY_TABLES) UPDATE/DELETE 0건, pgmigrations
권한 0건, uk_outbox_idem UNIQUE 존재+중복 삽입 거부, 픽스처 업그레이드,
outbox 3-write 원자성(커밋/롤백, 롤백 후 사전 상태 복원 비교), 테넌트 격리
(교차 불가시, GUC 미설정 0행, WITH CHECK 거부, tenant_id 누락 거부), 전역 행
(tenant_id IS NULL) 읽기 허용·생성 거부.

네거티브: 부분 프로비저닝 DB(tenant 존재, 이력 없음)에 db:migrate →
0001 프리플라이트 가드가 `baseline must be applied to an empty schema`로 실패.

## RLS 검증의 한계 (기록)

- 테스트는 superuser 접속에서 `SET ROLE une_app`으로 강등해 수행한다
  (0011의 une_app은 NOLOGIN이므로 CI에서 실접속 불가). RLS 판정 관점에서는
  동등하나 CONNECT 등 접속 레벨 권한은 커버하지 않는다. 실접속 경로는 로컬
  initdb가 만드는 LOGIN 롤로 CC-100 이후 서비스 통합 시 검증된다.
- DB 강제 RLS는 tenant_id 보유 17테이블뿐이며 하위 테이블은 서비스 레이어
  조인이 보상통제다 (ADR-21, CC-100 수용 기준 이관).

## 기준선 결함 해소 (ADR-21 §4; 전부 첫 적용·머지 전)

uuid[]/jsonb 3곳 → uuid[]; plan created_at/updated_at+트리거; 비-PK 랜덤
기본값 74곳 제거(잔존 gen_random_uuid 전수 확인: PK 56곳뿐 — QA 재현);
BEGIN/COMMIT 제거; uk_outbox_idem 추가; 전역 행 정책(OR IS NULL) 정정;
0001 빈-스키마 가드. V###__ → 0###_ 개명(도구 요구).

## 리뷰 게이트 (같은 날)

- architecture-guardian: **CONDITIONAL PASS** — M1(상태문서)·M2(uk_outbox_idem)·
  M3(전역 행)·M4(pgmigrations 권한) + R1~R8. 전부 당일 반영(이 파일과
  0001/0007/0008/0011/테스트/CI/README/ADR-21 참조).
- qa-gate-reviewer: **PASS WITH CONDITIONS** — 수용 기준 8개 독립 재현
  (psql 프로브 11/11, vitest 13/13 당시 기준, 사전 sha256 결정성, 게이트 전체,
  frozen-lockfile). C1~C6 전부 당일 반영: F1=uk_outbox_idem(0007)+중복 테스트,
  F2=인덱스 대응표(README), F3=CI git add -N, F4=ALTER ROLE 멱등 강제,
  F5=README 파티션 체크리스트, F6=스냅샷 REVOKE+CC-250/230 유예 기록,
  F7=README 명시, F8=테스트 상태 의존 제거, F9=주석 정정.

## 전체 게이트 (반영 후 재실행)

build / typecheck / lint / format:check / validate:contracts /
validate:handoff(272 files) 전부 PASS. DB 재검증은 볼륨 초기화
(`down -v`) 후 재적용으로 수행 — migrate 11/11, 테스트 17/17, 사전 재생성.
