# ADR-21 마이그레이션 도구 확정과 스키마 기준선 결함 해소

- 상태: ACCEPTED
- 결정일: 2026-07-30
- 관련 Work Item: CC-004
- 번호 부여: ADR-20 다음 신규 결정
- 사용자 확인: 2026-07-30 세션에서 도구 선정과 기본값 제거 모두 승인

## 배경과 문제

ADR-19 결정 2는 마이그레이션 도구(node-pg-migrate vs Prisma migrate) 확정을
CC-004로 유예했다. `database/migrations`의 설계 기준선(57테이블)은 CC-004
이전까지 어떤 DB에도 적용된 적이 없었고, 첫 적용 과정에서 기준선 자체의
결함이 드러났다.

## 고려한 대안

| 영역 | 대안 | 판정 | 사유 |
|---|---|---|---|
| 도구 | node-pg-migrate (SQL 파일) | 채택 | 인계된 수작성 SQL을 그대로 실행·추적; RLS/트리거/COMMENT/파티셔닝 등 손으로 쓴 DDL과 forward-only 원칙에 정합; ORM 없음(ADR-19 "명시적 SQL + 포트 경계") |
| 도구 | Prisma migrate | 기각 | schema.prisma가 스키마 원천이 되어 인계 SQL을 introspect+baseline으로 편입해야 하고, RLS·부분 인덱스·COMMENT는 migration.sql 수동 편집을 강제; Prisma Client(ORM)가 포트 경계와 긴장 |

## 확정 결정

1. **도구**: node-pg-migrate v9, SQL 파일 마이그레이션, 추적 테이블
   `pgmigrations`. 루트 `pnpm db:migrate`로 실행하며 `DATABASE_URL`은
   superuser(`une`) — 런타임 롤(`une_app`)은 마이그레이션을 실행하지 않는다.
2. **파일명**: v9은 숫자 접두사를 요구하므로 `V###__name.sql`을
   `0###_name.sql`로 개명했다 (내용 동일, 미적용 상태의 개명이므로
   forward-only 위반 아님). 설계 문서의 V001~V010은 0001~0010에 대응한다.
   신규 마이그레이션은 0012부터 4자리 접두사로 이어간다.
3. **트랜잭션**: 도구가 마이그레이션마다 트랜잭션을 감싸므로 파일 내
   `BEGIN;`/`COMMIT;`을 제거했다.
4. **적용 전 기준선 결함 해소** (모두 첫 적용 전 수정; 사유는 아래):
   - 비-PK(FK/테넌트) 컬럼 74곳의 `DEFAULT gen_random_uuid()` 제거 —
     누락 삽입이 오류 대신 임의 참조/임의 테넌트를 조작하는 함정이었다
     (RLS 아래에서 행이 다른 테넌트로 사라짐). 사용자 승인 완료.
   - `uuid[]/jsonb` 표기 3곳(fact_conflict.candidate_fact_ids,
     journal_projection_item.source_event_ids, evaluation_score.evidence_event_ids)은
     유효한 SQL이 아니다(설계 문서의 양자택일 표기가 그대로 유입).
     순수 UUID 목록이므로 `uuid[]`로 확정.
   - `plan` 테이블에 `created_at`/`updated_at` 추가 + 갱신 트리거 — 설계
     자신의 인덱스 명세(IX-plan_plan-STATUS: tenant_id, status, updated_at)와
     전역 규칙("created_at/updated_at은 DB default now()")이 요구하나 컬럼
     명세에서 누락된 내부 모순의 해소.
   - 설계 UK-outbox-idem `(idempotency_key, channel)` UNIQUE 인덱스가 0007에
     누락되어 있었다 — 중복전송 차단은 CLAUDE.md 멱등 규칙의 DB 강제 지점이며
     적용 후 중복행이 생기면 비가역이므로 지금 추가(`uk_outbox_idem`).
   - 0008의 role/provider_config/retention_policy 정책이 전역 행
     (`tenant_id IS NULL` = 시스템 역할/전역 provider 기본/전역 보존정책)을
     FORCE RLS 아래에서 영구 불가시화했다 → USING에 `OR tenant_id IS NULL`
     추가(읽기 허용), WITH CHECK는 테넌트 행만(전역 행 생성·변경은 관리 경로
     전용). CC-100 RBAC은 이 전제 위에서 시스템 역할을 읽는다.
   - 0001에 빈-스키마 프리플라이트 가드 추가: 마이그레이션 이력 없이 `tenant`
     테이블이 존재하는 부분 프로비저닝 DB에는 즉시 실패한다
     (`IF NOT EXISTS`가 결함 수정을 조용히 건너뛰는 것 방지).
5. **V011(0011) 신설**: 17개 테넌트 테이블 `FORCE ROW LEVEL SECURITY`,
   `une_app` 롤 존재 보장(NOLOGIN, 클러스터에 없을 때만) + 멱등
   `ALTER ROLE ... NOSUPERUSER NOBYPASSRLS`(외부 프로비저닝된 롤도 속성 강제)
   + 스키마 권한 부여, `pgmigrations` 이력 테이블 권한 전면 회수,
   append-only/불변 테이블(execution_event, audit_log, task_event,
   plan_context_snapshot, situation_snapshot)의 UPDATE/DELETE 회수.
   sop_version·evidence_set/evidence_item은 승인 전 상태 전이가 있어 DB 회수를
   유예하고 애플리케이션 계층이 불변성을 강제한다(CC-250/CC-230에서 재평가).
   LOGIN/비밀번호는 환경별 프로비저닝(로컬 initdb 스크립트, 관리형 호스트는
   운영 절차).
6. **검증**: `tests/integration`(@une/db-integration)이 빈 DB 적용(57테이블),
   픽스처 위 업그레이드, dispatch+execution_event+outbox 단일 트랜잭션
   원자성, RLS 격리를 실제 PostgreSQL 16에서 검증한다. CI `db-verify` 잡이
   서비스 컨테이너로 동일 검증을 수행한다.
7. **데이터 사전**: `pnpm db:data-dictionary`가 적용된 스키마에서
   `docs/db/DATA_DICTIONARY.md`를 생성하고 CI가 drift를 차단한다 —
   사전은 항상 마이그레이션의 실제 결과와 일치한다.

## 테넌트 격리의 범위 (보상통제)

DB 레벨 RLS는 `tenant_id`를 보유한 17개 상위 애그리게이트 테이블에만 강제된다.
나머지 40개 하위 테이블(dispatch, task, situation_fact, journal 등)은 설계
의도대로(11_BASELINE_INTEGRATION_CHECK §"Service Layer Join 검증 병행")
**서비스 레이어가 상위 애그리게이트 조인으로 테넌트를 강제**하는 것이
보상통제다. CC-004의 RLS 테스트는 17개 테이블의 DB 강제를 검증할 뿐 하위
테이블 격리를 보장하지 않으며, 리포지토리 구현 항목(CC-100 이후)의 수용
기준으로 이관한다.

## 문구 정합 노트

- `.claude/rules/database.md`의 "immutable after merge"와 개명·수정의 정합:
  본 변경은 **merge 전이자 어떤 DB에도 적용 전**인 파일에 대한 것으로 규칙의
  보호 대상(적용·병합된 이력)이 아직 성립하지 않았다.
- 설계 §6.2 요약표의 `plan_plan 12 컬럼` 카운트는 §6.10 컬럼표 기준 14로
  대체된다(created_at/updated_at 추가분).
- 설계 IX-*-TENANT 인덱스 중 10건은 미구현 상태로 남는다 — 대응표와 이관
  계획은 `database/migrations/README.md` 참조(정의가 "업무조회 컬럼 등"으로
  열려 있어 실제 Query Plan 검증 항목에서 확정).

## 영향 범위

- `database/migrations/*` 개명·정리, `0011` 추가
- 루트 `package.json`(node-pg-migrate, pg, db:* 스크립트),
  `pnpm-workspace.yaml`(tests/integration)
- `.github/workflows/ci.yml` db-verify 잡
- `services/*/.env.example`의 런타임 DATABASE_URL은 `une_app` 유지 (CC-002)
- 후속: 파티셔닝 전환(0010 계획)은 별도 ICR로, PgBouncer/백업·복원 검증은
  부하·운영 항목에서
