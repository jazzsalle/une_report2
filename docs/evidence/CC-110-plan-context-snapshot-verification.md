# CC-110 검증 증거 — Plan CRUD + 불변 PlanContextSnapshot

- 일자: 2026-08-01 (집 PC, WSL2 Ubuntu 26.04 + Docker CE 29.7.1, PostgreSQL 16 @ localhost:15432)
- 브랜치: feature/CC-110
- 근거 결정: ADR-23 (멱등키 재생 저장소, draft 단일화, start_mode, 오류코드 확정)

## 구현 범위 (UNE-PLAN-001~008)

| API | 구현 | 비고 |
|---|---|---|
| UNE-PLAN-001 POST /plans | ✅ | Idempotency-Key 필수, 201, PLAN_CREATED 감사 |
| UNE-PLAN-002 GET /plans | ✅ | keyword/status/hazardType/inTrash/page/size, 1-기반 페이지 |
| UNE-PLAN-003 GET /plans/{id} | ✅ | PlanDetail(현재 스냅샷 포함), ETag 헤더 |
| UNE-PLAN-004 PATCH /plans/{id} | ✅ | If-Match(version_no) 낙관잠금, 428/409, 메타 3필드 한정 |
| UNE-PLAN-005 DELETE /plans/{id} | ✅ | 204 휴지통 이동(멱등), APPROVED/FINAL 차단 |
| UNE-PLAN-006 POST context-drafts | ✅ | 완화 검증(AJV, required/minLength/minItems 유예), 단일 draft upsert(자연 멱등, 재생 저장소 제외) |
| UNE-PLAN-007 POST context-snapshots | ✅ | 엄격 검증, canonical SHA-256, 버전 max+1, supersedes, dedupe, CONTEXT_READY 전이, 동일 트랜잭션 |
| UNE-PLAN-008 GET context-snapshots | ✅ | 버전 내림차순 목록 |

멱등키 공통 인터셉터(ADR-22 D6 이연 해소): `@Idempotent` 라우트(001/007)에서
api_idempotency 재생 저장소로 동일 키+페이로드 재생 / 상이 페이로드·타 주체
409 / 처리 중 409 / FAILED·stale 재선점 (ADR-23 D1). 재생 식별자는 **구체
경로**(경로 파라미터 포함) — 리뷰 B1 시정. draft(006)와 PATCH(004)는 재생
저장소 제외(자연 멱등 / If-Match, ADR-23 D1 개정, 계약 파라미터 동시 제거).

## 수용 기준 대응

| 기준 | 증거 |
|---|---|
| plan CRUD | e2e plan-crud 23케이스 (생성/목록/상세/수정/삭제/권한/교차테넌트 5경로/승인잠금) |
| context schema validation | validator 단위 6 + e2e draft 완화(빈 값 허용·enum 거부)/엄격 422 (violations에 instancePath) |
| snapshot hash/version | e2e: contentHash 64hex, 버전 1→2, supersedes 연결, dedupe, 동시 확정 직렬화 [1,2], DB REVOKE 불변성, 확정 응답 새 ETag |
| conflict tests | e2e: If-Match 428/409/약한 ETag 400, 동시 PATCH 1승자, 멱등 payload 상이·타 주체·타 계획서(B1 회귀) 409/분리, claim 판정표(재생/FAILED/stale) SQL 검증 |

## 게이트 실행 결과 (2026-08-01, 리뷰 반영 후 최종)

| 명령 | 결과 |
|---|---|
| pnpm build | PASS |
| pnpm typecheck | PASS |
| pnpm lint / format:check | PASS |
| pnpm validate:contracts | PASS (OpenAPI 4 + 스키마 7 + mock sync 13) |
| pnpm validate:handoff | PASS (333 files) |
| pnpm --filter @une/api test (DATABASE_URL 설정) | **107/107 — 5회 연속** (unit 69 + e2e 38: auth 15 + plan 23) |
| pnpm --filter @une/db-integration test | **30/30** (0014 신규 5 포함) |
| 루트 pnpm test (DATABASE_URL 설정) | PASS (전 패키지) |
| pnpm db:migrate (빈 DB) | 14개 적용 |
| pnpm db:data-dictionary | 59테이블·530컬럼, drift 없음 |

QA 리뷰가 재현한 e2e 간헐 실패(두 e2e 파일의 동시 CREATE DATABASE+마이그레이션
→ "tuple concurrently updated", 5회 중 2회 RED)는
`services/api/vitest.config.ts`의 `fileParallelism: false`로 해소 — 위 5회
연속 107/107이 그 증거다.

## DB 변경 (0014, ADR-23)

- `api_idempotency` 신설: uk(tenant,endpoint,key), state CHECK, RLS
  ENABLE+FORCE+정책, 런타임 DELETE 회수. 통합테스트: 유니크 충돌, CHECK,
  RLS 격리(교차 tenant INSERT 거부), DELETE permission denied.
- `uk_plan_context_draft_plan`: 계획서당 draft 1행 (upsert 근거).
- `plan.start_mode` DEFAULT 'BLANK' + CHECK: US-PLAN-002 AC-02 저장 컬럼.
- 업그레이드 경로: 0010 시점 데이터 보존 상태에서 0011~0014 적용 검증.

## 계약 동시 변경

- Plan/PlanDetail/ContextDraft/PlanContextSnapshot 리소스·envelope 응답
  스키마 확정, GET /plans 쿼리 파라미터 선언, DELETE 204,
  `IdempotencyKeyRequired`(001/007) 도입, PlanCreateRequest에
  hazardType/managementPhase 필수(ADR-23 D3).
- 생성 타입 재생성 + plan-context.schema.json → 생성 TS 모듈
  (scripts/generate-contract-types.mjs 확장, CI drift 게이트 동일 적용).

## 이중 리뷰 반영 (architecture-guardian + qa-gate-reviewer, 당일 전부 반영)

**BLOCKER B1 = QA 필수-2** (두 리뷰 공통, QA는 무음 유실을 HTTP로 재현):
멱등 재생 식별자가 라우트 템플릿이라 같은 키+본문을 다른 계획서에 쓰면 첫
계획서의 스냅샷이 201로 재생되고 둘째 계획서는 확정이 무음 유실됐다.
→ 구체 경로로 시정 + `created_by` 주체 격리 추가 + B1 회귀 e2e 2건.

필수/ MAJOR 반영: e2e 파일 병렬 DB 생성 경합 직렬화(필수-1, 5회 연속 GREEN),
페이지 초과 시 totalElements 0 반환(필수-3, count 분리 쿼리 + e2e),
412/428 계약 미선언(필수-4/M1, PreconditionFailed/Required 신설·매핑),
templateFileId 설명 422→400(필수-5), 상태·증거 갱신(필수-6/M6),
PLAN-412-002 신설로 설계 8.3의 PLAN-412-001 원 의미 예약(M2),
APPROVED/FINAL 승인 잠금 — draft/snapshot 412(M3), 상태 전이를 도메인
함수 `plan-status.ts`로 승격(M4), mock-server plan 구간 계약 정합(M5),
PATCH·draft의 IdempotencyKey 파라미터 계약 제거(M7/QA권고5·6 — draft
키 재사용 영구 409 함정 해소).

MINOR/권고 반영: 멱등 기록 실패 WARN 관측, claim 재귀 상한, before_json
감사(PLAN_UPDATED/DELETED + e2e), 약한 ETag 거부(RFC 7232), draft 완화
검증에 minLength/minItems 포함, 스냅샷 확정 응답 ETag, 감사 리포지토리
공용 분리(AuditRepository), OpenAPI 3.1 nullable 교정(플랜 슬라이스),
claim 판정표 SQL 통합 검증, PLAN-403-001/교차테넌트 5경로/동시 확정
직렬화/페이지 경계 e2e, ADR 인덱스(ADR-22/23) 등재.

## 알려진 한계 (수용, ADR-23 명문화)

- 재생 기록 tx 실패 시 중복 생성 1회 가능(WARN 관측 + 감사 추적; stale
  재선점 수렴).
- 재생 응답 본문의 meta는 원 요청 값, X-Correlation-Id 헤더는 신규 —
  추적은 본문 meta 기준.
- `api_idempotency` TTL·보존정책(response_body 무기한 적재)은 CC-430
  계열에서 retention_policy/워커로 확정 — 그때까지 RLS 격리가 통제.
- 메타 PATCH의 비승인 상태 제한 없음(CC-170+에서 재평가).
- templateFileId는 CC-140까지 400 거부.
- 하위 테이블(plan_context_*)의 테넌트 격리는 부모 조인 보상통제(ADR-21).
- `validate:contracts`는 x-error-codes↔responses·mock 응답 스키마 정합을
  검사하지 않음 — 교차 게이트는 후속 개선 항목.
