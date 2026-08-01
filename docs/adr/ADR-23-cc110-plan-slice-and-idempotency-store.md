# ADR-23: CC-110 Plan 슬라이스 — 멱등키 재생 저장소와 기준정보 계약 확정

- 상태: ACCEPTED (2026-08-01, CC-110)
- 관련: ADR-21(기준선 결함 처리), ADR-22 D6(멱등키 이연), 설계 10 §3.3/§6/§7,
  설계 09 §4(계획서 상태모델), 설계 05 US-PLAN-002/007

## 배경

CC-110은 UNE-PLAN-001~008(계획서 CRUD, 기준정보 임시저장, 불변
PlanContextSnapshot)을 구현한다. 착수 시점에 설계 내부 모순·미확정 3건이
확인되어 본 ADR로 해소한다.

## D1. 멱등키 재생 저장소 `api_idempotency` 신설 (59번째 테이블)

설계 10 §7 공통 통제는 모든 생성/상태변경 POST에 "동일 Key/동일 Payload는
기존 결과를 반환하고 다른 Payload는 409"라는 **재생(replay) 의미론**을
요구하지만, §6 물리 테이블 목록에는 이를 저장할 테이블이 없다(0012의
role_permission과 동일한 내부 모순 유형). 마이그레이션 0014로
`api_idempotency`를 신설한다.

- `(tenant_id, endpoint, idempotency_key)` 유니크 — 인터셉터가
  `INSERT .. ON CONFLICT DO NOTHING`으로 키를 선점한다.
- `request_hash`(정규화 요청 본문 SHA-256)로 동일/상이 payload를 판정한다.
- `state IN (IN_PROGRESS, COMPLETED, FAILED)`. 성공(2xx) 응답만
  `COMPLETED`로 기록·재생한다(`response_status + response_body`,
  성공 envelope 그대로 — meta는 원 요청 값). 핸들러 실패는 `FAILED`로
  표시하고 응답은 기록하지 않는다 — 일시 장애(5xx)가 키에 고착되지 않고
  재시도가 즉시 재선점한다.
- 판정 규칙(선점 실패 시 `SELECT .. FOR UPDATE`):
  - COMPLETED + 동일 해시 → 저장 응답 재생
  - 동일 키 + 상이 해시 → 409 COM-0409 (상태 무관)
  - FAILED + 동일 해시 → 재선점(재시도)
  - IN_PROGRESS + 동일 해시 + `claimed_at` 5분 경과(stale) → 재선점
  - IN_PROGRESS + 동일 해시 + fresh → 409 COM-0409 (recoverable, "처리 중")
- RLS ENABLE+FORCE + tenant 정책, 런타임 DELETE 회수(재생 증적 보존;
  TTL 정리는 운영/워커 항목에서 별도 처리).
- 인터셉터 트랜잭션은 핸들러 트랜잭션과 분리된다(선점 tx → 핸들러 tx →
  기록 tx). 핸들러 성공 후 기록 실패 시 응답은 그대로 반환하고 재생 행은
  IN_PROGRESS로 남는다 — 이후 재시도는 stale 재선점으로 수렴한다(중복
  생성 1회 가능성을 수용; 계획서 생성은 상태 파괴가 없고 감사로 추적된다).

### 적용 범위 (CC-110, 이중 리뷰 개정)

- `POST /plans`, `POST /plans/{planId}/context-snapshots`: Idempotency-Key
  **필수** (계약에 `IdempotencyKeyRequired` 파라미터로 명시).
- `POST /plans/{planId}/context-drafts`: 재생 저장소 **제외**. 단일 draft
  upsert(last-write-wins)로 자연 멱등이며, 재생 저장소를 통과시키면 같은
  키로 내용을 수정해 저장하는 정상 흐름이 영구 409에 갇힌다(QA 재현).
  계약에서 파라미터 제거.
- `PATCH /plans/{planId}`: 재생 저장소 **제외**. 재시도 안전성은 If-Match
  낙관잠금이 제공한다(버전 불일치 409로 결정적). 계약에서 파라미터 제거 —
  선언만 하고 무시하는 상태를 두지 않는다.
- 인증 POST 포함 여부는 ADR-22 D6대로 제외 유지(레이트리밋 항목에서
  재평가).

### 재생 식별자 (이중 리뷰 B1 시정)

- `endpoint`는 라우트 템플릿이 아니라 **구체 경로**(쿼리 제거,
  `METHOD /api/v1/plans/{실제 planId}/...`)다. 경로 파라미터는 자원
  식별자이므로, 같은 키+본문을 다른 계획서에 쓰면 재생이 아니라 별도
  선점이어야 한다(템플릿 방식은 타 계획서 응답을 201로 재생해 확정을
  무음 유실시켰다).
- **주체 격리**: 기존 레코드의 `created_by`가 요청 주체와 다르면 해시가
  같아도 MISMATCH(409) — 동일 테넌트 내 다른 사용자의 응답을 키 충돌로
  읽을 수 없다.
- 재생 응답의 `meta`(correlationId 포함)는 원 요청 값이고
  `X-Correlation-Id` 응답 헤더는 새 값이다 — 추적은 본문 meta 기준
  (수용된 한계, "기존 결과 그대로" 원칙 우선).
- 기록(tx3) 실패는 WARN 로그(corr/endpoint만, 키·본문 제외)로 관측한다.

## D2. `plan_context_draft`는 계획서당 1행 (upsert)

설계 05/09/10 어디에도 draft 다중 보관·선택 UI가 없고 테이블에 버전
컬럼이 없다. "임시저장"은 단일 작업본의 upsert로 확정하고 0014에서
`UNIQUE(plan_id)`를 추가한다. 임시저장 검증은 **완화 모드**(AJV 결과 중
미완성 계열 `required`/`minLength`/`minItems` 위반만 허용 — 빈 제목·빈
독자 목록은 편집 중 정상 상태다. 타입·enum·maxLength·additionalProperties
위반은 422 PLAN-422-001)로, Snapshot 확정은 **엄격 모드**(모든 위반
422)로 검증한다 — US-PLAN-007 AC-01(클라이언트·서버 동일 검증)과
"임시저장은 미완성 허용"을 양립.

## D3. 계획서 생성 계약 보완: hazardType·managementPhase 필수

`plan.hazard_type`/`plan.management_phase`는 NOT NULL인데 기준선
`PlanCreateRequest`에는 두 필드가 없다(내부 모순). US-PLAN-002 입력
("재난유형 초안값")에 따라 생성 요청에 `hazardType`(재난유형 10종),
`managementPhase`(예방/대비)를 **필수**로 추가한다. 값 어휘는 별도 코드
테이블이 물리 목록에 없으므로 plan-context.schema.json의 enum 문자열을
기준 어휘로 사용한다(코드 카탈로그 도입은 설계 변경 요청 대상으로 유예).
`templateFileId`는 파일 업로드가 CC-140 범위이므로 CC-110에서는 값이 오면
400 PLAN-4001(violations에 사유 명시)로 거부하고 CC-140에서 해제한다(OB
아님; 항목 간 순서 문제).

또한 US-PLAN-002 AC-02(시작방식이 저장되어 재접속 시 복구)를 저장할 컬럼이
기준선 plan 테이블에 없어 0014에서 `plan.start_mode`(BLANK/UPLOAD_HWPX/
RECENT, 기본 BLANK)를 추가한다.

## D4. Snapshot 확정 규칙

- 정규화(키 정렬) JSON의 SHA-256을 `content_hash`로 저장.
- `version_no`는 계획서별 `max+1` — plan 행 `FOR UPDATE` 선점으로 직렬화.
- `supersedes_id` = 직전 `current_context_snapshot_id`.
- 같은 트랜잭션에서 `plan.current_context_snapshot_id` 갱신, 상태는
  DRAFT일 때만 CONTEXT_READY로 전이(그 외 상태는 유지 — US-PLAN-007
  AC-03의 재생성 영향 경고는 CC-120 범위), audit_log 기록. 전이 규칙은
  도메인 함수(`plan-status.ts`)가 결정하고 리포지토리는 기록만 한다.
- **승인 잠금(이중 리뷰 M3)**: `APPROVED`/`FINAL` 계획서는 draft 저장·
  Snapshot 확정 모두 412 PLAN-412-002로 거부한다. 승인된 문서의 권위적
  기준정보 포인터가 조용히 교체되는 것을 막고, 해당 상태의 기준정보
  재개정은 승인 흐름 항목(CC-170+)의 재개정 액션으로 위임한다.
- 확정 성공 응답에는 계획서의 새 ETag(version_no)를 헤더로 반환한다 —
  직후 PATCH가 예기치 않은 409가 되지 않도록. dedupe 경로는 버전이
  오르지 않으므로 현재 버전을 반환한다.
- `plan.hazard_type`/`management_phase`는 US-PLAN-002의 **초안값**이고,
  확정 이후의 권위적 어휘는 Snapshot의 `backgroundInfo`다. 두 값의 자동
  동기화나 불일치 거부는 하지 않는다(초안 메타는 목록·필터 용도).
- **동일 내용 재확정 dedupe**: 현재 스냅샷과 content_hash가 같으면 새
  버전을 만들지 않고 현재 스냅샷을 반환한다(버전 증식 방지).
- 휴지통(deleted_at) 계획서에는 draft/snapshot 불가 — 412 PLAN-412-001.

## D5. 오류코드 (설계 8.3 + 계약 x-error-codes 정합)

| 코드 | 조건 |
|---|---|
| PLAN-4001 | 계획서 본문 요청 위반(생성/PATCH/draft 요청 필드, templateFileId 보류 포함) — 400, violations |
| PLAN-4002 | 목록 쿼리 위반 — 400 |
| PLAN-4003 | 계획서 없음/타 기관 — 404 |
| PLAN-409-001 | If-Match 버전 불일치 — 409 |
| PLAN-403-001 | 삭제 권한 있으나 상태상 불가(APPROVED/FINAL) — 403 |
| PLAN-422-001 | 기준정보 스키마 위반 — 422, violations |
| PLAN-412-001 | **예약**: PlanContextSnapshot 미확정(설계 8.3 원 의미, CC-120 toc-jobs에서 사용) |
| PLAN-412-002 | 상태 전제조건 위반(휴지통·승인 잠금 계획서의 수정/draft/snapshot) — 412 (신설; 원 의미를 대체 코드 없이 흡수하지 않기 위한 분리) |
| PLAN-404-002 | Snapshot 목록의 계획서 없음 — 404 |
| COM-0428 | PATCH에 If-Match 누락 — 428 |
| COM-0400 | 요청 헤더·경로 형식 위반(필수 Idempotency-Key 누락/형식, If-Match 형식, UUID 경로 파라미터) — 400 |
| COM-0409 | 멱등키 재사용(payload 상이·타 주체) 또는 처리 중 — 409 |

412/428 응답은 계약 `components/responses`(PreconditionFailed/
PreconditionRequired)로 선언한다 — 구현이 반환하는 상태코드는 전부 계약에
선언되어야 한다는 원칙(이중 리뷰 M1). If-Match는 RFC 7232대로 강한
비교만 허용(약한 `W/"n"`은 400).

- PATCH 대상은 메타 3필드(title, hazardType, managementPhase)로 한정.
  status·owner 변경은 별도 도메인 액션(후속 항목). CC-110에서는 메타 PATCH에
  상태 제한을 두지 않는다(APPROVED/FINAL은 승인 흐름 항목 CC-170+에서
  도달 가능해지는 시점에 재평가 — 수용된 한계).
- DELETE(휴지통 이동)는 멱등: 이미 휴지통이면 204 no-op.
- 동일 내용 재확정 dedupe 시에도 201로 기존 스냅샷 자원을 반환한다(계약은
  201 단일 성공 응답).
- 감사 액션 어휘 추가: PLAN_CREATED / PLAN_UPDATED / PLAN_DELETED /
  PLAN_CONTEXT_SAVED / CONTEXT_SNAPSHOT_CREATED (resource_type=PLAN).

## 결과

- 마이그레이션 0014(api_idempotency + uk_plan_context_draft_plan),
  데이터 사전 59테이블 재생성.
- 계약·구현 동시 변경: Plan/PlanDetail/ContextDraft/PlanContextSnapshot
  응답 스키마 확정(envelope), GET /plans 쿼리 파라미터 선언,
  DELETE 204, IdempotencyKeyRequired 도입.
- 수용된 한계: 재생 기록 tx 실패 시 중복 생성 1회 가능(감사로 추적,
  WARN 관측), 하위 테이블(plan_context_*)의 테넌트 격리는 부모 조인
  보상통제(ADR-21), 재난유형 어휘의 코드 카탈로그 부재는 설계 변경 요청
  대상, 메타 PATCH의 비승인 상태 제한 없음(CC-170+ 재평가).
- `api_idempotency` 보존: 런타임(une_app) DELETE 회수로 정리는 **운영
  주체(superuser/운영 롤)** 만 가능하다. `response_body`에는 성공 envelope
  전문(기준정보 자유서술 포함 가능)이 무기한 적재되므로, TTL 정리와
  `retention_policy` 연계는 보존·감사 항목(CC-430 계열)에서 워커/운영
  절차로 확정한다 — 그때까지는 테넌트 RLS 격리가 유일한 통제다.
- 검증 게이트 공백(기록): `validate:contracts`는 x-error-codes ↔ responses
  선언 정합과 mock 응답 스키마 정합을 검사하지 않는다. 교차 검사 게이트는
  후속 개선 항목으로 남긴다(이중 리뷰 M1/M5 참고).
