# PostgreSQL Migrations

- Forward-only. 적용된 마이그레이션은 절대 수정하지 않는다 (수정은 새 forward 마이그레이션).
- 도구: **node-pg-migrate v9** (SQL 파일, 추적 테이블 `pgmigrations`) — ADR-21.
- `0001`~`0010`은 설계 기준선에서 인계된 초기 스키마다 (57-table baseline).
  설계 문서의 V001~V010 표기는 0001~0010에 대응한다 (v9의 숫자 접두사 요구로
  CC-004에서 개명; 첫 적용 전이므로 forward-only 위반 아님).
- 첫 적용 전 해소된 기준선 결함(사유·목록은 ADR-21): 비-PK 랜덤 UUID 기본값
  74곳 제거, `uuid[]/jsonb` 표기 3곳 → `uuid[]`, plan 테이블
  created_at/updated_at 추가, `BEGIN;/COMMIT;` 제거(도구가 트랜잭션 래핑).
- `0011`: FORCE ROW LEVEL SECURITY + `une_app` 권한 재현성 + append-only
  테이블(execution_event, audit_log, task_event) UPDATE/DELETE 회수.
- `0012`: RBAC 카탈로그 보완 (CC-100, ADR-22) — `role_permission` 테이블
  신설(설계 내부 모순 해소, 58번째 테이블), role_code 부분 유니크 인덱스,
  권한 카탈로그 54종(계약 x-permission 1:1)·시스템 역할 15종 시드,
  role_permission은 런타임 SELECT 전용.
- `0013`: IAM 강화 (CC-100 이중 리뷰, ADR-22 추록) — `permission` 카탈로그
  런타임 쓰기 회수, 카탈로그 GRANT SELECT 명시, `uk_user_session_refresh_hash`.
- `0014`: 멱등키 재생 저장소 (CC-110, ADR-23) — `api_idempotency` 신설
  (59번째 테이블; 설계 §7 재생 의미론 vs §6 물리 목록 누락 해소, RLS
  ENABLE+FORCE, 런타임 DELETE 회수), `uk_plan_context_draft_plan`(계획서당
  draft 1행), `plan.start_mode`(US-PLAN-002 AC-02 저장 컬럼 부재 해소).
- `0015`: 생성 Job 실행면 (CC-120, ADR-25) — 신규 테이블 0건.
  generation_job에 `created_at/updated_at`(+`trg_generation_job_updated_at`)과
  `attempt_no` 추가(§6.15 인덱스 정의가 created_at을 요구하나 컬럼 목록에
  없던 기준선 결함, ADR-21 선례), job/TOC 상태집합 CHECK 8종, 0007이 빠뜨린
  FK 3종(`fk_toc_version_base_snapshot`, `fk_toc_node_parent`,
  `fk_plan_current_toc_version`), `uk_toc_version_plan_version`·
  `uk_job_event_seq`(SSE Last-Event-ID 재개점 유일성), 디스패치/기관조회
  인덱스 4종, job_event append-only(REVOKE UPDATE/DELETE), **`une_worker`
  롤 신설**과 워커 전용 RLS 정책 2종.
- 새 마이그레이션은 `0016_name.sql`부터 4자리 숫자 접두사로 이어간다.
- **마이그레이션 주체 전제**: 전역 행(tenant_id IS NULL) 시드는 FORCE RLS
  아래에서 주체의 RLS 우회를 전제한다 — 마이그레이션은 항상
  superuser/BYPASSRLS 롤로 실행한다(런타임 une_app 금지; 관리형 호스트 포함).

## 런타임 롤 (une_app / une_worker)

| 롤 | 주체 | 테넌트 컨텍스트 | 권한 부여 방식 |
|---|---|---|---|
| `une_app` | `services/api` | 전 트랜잭션에서 `app.tenant_id` 설정 필수 | 0011의 `ALL TABLES` + append-only 회수 |
| `une_worker` | `services/worker` | 큐 스캔 구간에만 미설정 허용 | 0015의 **테이블별 최소권한**(광역 GRANT·기본권한 금지) |

- 두 롤 모두 NOLOGIN NOSUPERUSER NOBYPASSRLS이며 접속 계정은 배포 환경에서
  멤버십으로 부여한다. 마이그레이션은 두 롤 어느 쪽으로도 실행하지 않는다.
- **워커 정책 의미론** (0015 §7): `une_current_tenant_id()`는
  `app.tenant_id` 미설정/빈 문자열에서 NULL이므로(0001) `IS NULL`이 곧
  "테넌트 컨텍스트 없는 디스패치 모드"다. 워커 정책 2종은 PERMISSIVE라
  기존 `p_generation_job_tenant`(TO PUBLIC, FOR ALL)와 OR로 합쳐진다.
  - 테넌트 설정 → `IS NULL`=false → 기존 테넌트 정책만 유효(API와 동일 격리).
  - 테넌트 미설정 → 테넌트 정책이 절대 참이 아니므로 워커 정책만 유효하고,
    가시 범위는 QUEUED/RUNNING/CANCEL_REQUESTED로 제한된다.
  - claim 정책의 `WITH CHECK (status IN ('QUEUED','RUNNING'))`가 테넌트 없는
    트랜잭션의 종결 쓰기(COMPLETED/FAILED/CANCELLED)를 차단한다. 종결은
    결과(toc_version/toc_node/plan)를 쓰는 **테넌트 스코프 트랜잭션**에서만
    가능하므로 결과와 종결이 한 테넌트 경계 안에 남는다.
- **새 테이블을 워커가 읽/쓰려면** 그 마이그레이션에서 `une_worker`에게
  테이블별로 명시 GRANT해야 한다(0015는 의도적으로 `ALTER DEFAULT
  PRIVILEGES`를 쓰지 않는다). 통합 테스트
  `generation-job-worker-rls.test.ts`의 `EXPECTED_WORKER_GRANTS`가 광역
  GRANT 유입을 차단한다.
- `job_event`에는 tenant_id가 없어 RLS 대상이 아니다(0011 note와 동일한 하위
  테이블 보상통제: 서비스 레이어가 job_id로 조인해 테넌트를 좁힌다).

## 새 마이그레이션 체크리스트

- **빈 DB 전용**: 이 기준선은 빈 스키마에만 적용한다. 0001의 프리플라이트
  가드가 부분 프로비저닝 DB(이력 없이 tenant 존재)를 즉시 실패시킨다.
- **append-only 테이블 추가 시**: 0011의 `ALTER DEFAULT PRIVILEGES`가 새
  테이블에 UPDATE/DELETE를 자동 부여하므로, 같은 마이그레이션에서 REVOKE하고
  `tests/integration/src/db-helpers.ts`의 `APPEND_ONLY_TABLES`에 추가한다.
  execution_event 파티션 전환(0010 계획) 시 파티션별 REVOKE 재적용 필수.
- **RLS 테이블 추가 시**: ENABLE + FORCE + 정책을 같은 마이그레이션에서 묶고
  데이터 사전을 재생성한다.

## 설계 인덱스 대응 (IX-*-TENANT 이관)

설계 IX-*-TENANT는 정의가 "(tenant_id, status/created_at 등 업무조회 컬럼)"으로
열려 있어, 다음 4개만 설계에 닫힌 정의가 있어 구현했다:
`ix_plan_tenant_status_updated`, `ix_document_tenant_status_updated`,
`ix_situation_tenant_status_occurred`, `ix_audit_tenant_time`
(+ `generation_job`의 부분 유니크 `uk_job_idempotency`).

미구현 10건(app_user, organization, role, file_object, knowledge_document,
sop, execution_event, outbox_message, provider_config, retention_policy,
notification 중 위 4개 제외)은 FORCE RLS 아래 전 질의에 tenant 필터가 붙는
만큼, 각 도메인 구현 항목에서 **실제 Query Plan으로 컬럼을 확정해 추가**한다
(ADR-21 문구 정합 노트). 고volume인 execution_event/outbox_message는 각각
CC-260/CC-270에서 우선 처리.

## 실행

```bash
# superuser(une)로 실행; 런타임 롤(une_app)은 마이그레이션 금지
DATABASE_URL=postgres://une:<UNE_DB_PASSWORD>@localhost:5432/une pnpm db:migrate

# 적용 상태 확인
psql "$DATABASE_URL" -c 'SELECT * FROM pgmigrations ORDER BY id'
```

PowerShell에서는 `$env:DATABASE_URL = "..."` 후 `pnpm db:migrate`.
포트는 `infrastructure/.env`의 `UNE_DB_PORT`를 따른다 — 네이티브 PostgreSQL이
5432를 점유한 PC에서는 `15432`처럼 다른 포트로 뜬다.
Windows에서 컨테이너 DB에 접속하기 전에 WSL을 먼저 깨울 것
(`infrastructure/README.md`의 WSL 유휴 종료 주의 참조).

## 검증

- 통합 테스트: `DATABASE_URL=<superuser url> pnpm --filter @une/db-integration test`
  (빈 DB 적용 59테이블, 픽스처 업그레이드, outbox 원자성·멱등키, RLS 격리,
  워커 롤 권한·디스패치 정책 — DATABASE_URL 미설정 시 전부 skip. 따라서
  **루트 `pnpm test`의 초록은 DB 커버리지를 의미하지 않는다**; 실제 실행은
  CI `db-verify` 잡)
- RLS의 DB 강제는 tenant_id 보유 17테이블뿐이다. 하위 테이블(dispatch, task
  등)은 서비스 레이어 조인이 보상통제다 (ADR-21 "테넌트 격리의 범위")
- 데이터 사전: `pnpm db:data-dictionary` → `docs/db/DATA_DICTIONARY.md`
  재생성·커밋 (CI `db-verify` 잡이 drift 차단)
