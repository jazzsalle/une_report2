# ADR-22: CC-100 RBAC 저장구조 보완과 mock 인증 계약

- 상태: ACCEPTED (2026-07-31, CC-100)
- 관련: ADR-19(NestJS), ADR-21(기준선 결함 해소·테넌트 격리 보상통제)

## 배경

CC-100은 mock 인증·테넌트·RBAC을 구현한다. 착수 시 확인된 사실:

1. API·DB·Sequence 상세설계는 `role_permission`을 읽지만(UNE-AUTH-007 DB
   테이블, SEQ-SCR-ADMIN-001 읽기 목록) 같은 문서의 §6 물리 테이블 목록에는
   없다 — ADR-21이 해소한 것과 같은 부류의 설계 내부 모순.
2. 계약(x-permission)은 54개 권한 코드를 요구하나 0009 시드는 12개뿐이고,
   시스템 역할(화면설계 09 §3의 15종)은 시드가 없다.
3. OpenAPI `TokenResponse`는 top-level 필드로 정의됐지만 상세설계 §2 공통
   응답, common-error 스키마, mock-server는 모두
   `{success, data, meta}` envelope를 쓴다(설계 우선순위 3 > 4).

## 결정

### D1. `role_permission` 테이블 신설 (0012, forward-only)

`(role_id, permission_id)` UNIQUE, role/permission FK CASCADE.
tenant_id 없음 — 테넌트 격리는 ADR-21 보상통제대로 서비스 레이어가
RLS 보호되는 `role` 조인으로 강제한다. 런타임(une_app)은 SELECT만 가진다:
설계 관리 API의 쓰기 목록은 user_role·audit_log이며 role_permission 관리는
프로비저닝 경로 전용(관리 Work Item에서 재평가).

### D2. 권한 카탈로그·시스템 역할 시드 (0012)

- 권한 54종: 계약 x-permission과 1:1 (AUTHENTICATED/PUBLIC_SSO는 인증
  수준이므로 제외). 발명 아님 — 계약에서 기계적으로 추적 가능.
- 시스템 역할 15종: 화면설계 09 §3 Actor·Role 카탈로그와 1:1
  (tenant_id NULL, is_system=true; SYSTEM_ADMIN=SYSTEM,
  INSTITUTION_ADMIN=TENANT, 나머지 OBJECT).
- 시드 멱등성·무결성을 위해 role_code 부분 유니크 인덱스 2종 추가
  (전역/테넌트별). 설계에 UK 명세가 없어 보완 — 중복 시스템 역할은
  권한 판정을 비결정적으로 만들므로 무결성 요건으로 정당화.
- **역할→권한 매트릭스는 시드하지 않는다**: 설계가 화면별 표로만 분산
  정의하며 확정 표가 없다. 발명 금지 원칙에 따라 dev/demo 시드
  (`database/seeds/dev-iam.sql`)와 테스트 픽스처로만 제공하고, 도메인
  Work Item이 해당 화면 권한을 구현할 때 확정한다.

### D3. mock 인증 계약 (AUTH_MODE=mock 전용)

- 외부토큰 형식 `mock.<base64url(JSON{tenantId,loginId})>`. 서명 없음 —
  실 T3Q SSO(OB-01 OPEN) 대체가 아니라 로컬/데모 신원 주장이며,
  `AUTH_MODE=mock`이 아니면 UNE-AUTH-001은 503(AUTH-1004)으로 거부한다.
- 발급 JWT는 HS256, 서명키는 환경 비밀 `UNE_AUTH_JWT_SECRET`(32자 미만
  기동 실패, 기본값 없음). claim: sub=userId, tid=tenantId, sid=sessionId.
- **테넌트 위조 차단**: tenantId는 클라이언트 주장이 아니라 DB가 확정한다.
  주장된 tenantId로 `app.tenant_id`를 설정하고 조회하므로, 위조된
  테넌트에서는 RLS가 사용자를 숨겨 401이 된다. 발급된 JWT의 tid를
  위조하면 서명 검증이 실패한다.
- Refresh 토큰은 불투명 토큰 `urs.<tenantId>.<random hex>`로 발급하고
  SHA-256 해시만 저장(user_session.refresh_hash), 사용 시 회전한다.
  UNE-AUTH-003의 "AUTHENTICATED"는 세션 보유자 의미로 해석한다(만료된
  access token으로 갱신 불가하면 갱신 API가 성립하지 않음) — 라우트는
  Public이되 refresh 토큰 자체가 인증 수단이며, 토큰 구조의 tenantId로
  RLS 스코프를 열고 `app_user` 부모 조인으로 위조를 차단한다.
- Access token은 만료까지 유효하다(로그아웃은 refresh 세션 폐기).
  TTL 기본 900초로 노출 창을 제한한다.

### D4. TokenResponse envelope 정합 (계약+구현 동시 변경)

OpenAPI `TokenResponse`를 `{success, data{accessToken, refreshToken,
expiresIn, userContext}, meta}` envelope로 정정. 상세설계 §2 공통 응답
(우선순위 3)이 OpenAPI(4)보다 우선하고 mock-server·오류 스키마와도
일치한다. UNE-AUTH-004(로그아웃)는 설계 표기 204 대신 계약의 200
GenericResponse(envelope, data=null)를 따른다(계약이 이미 200으로 구체화).

### D5. 오류코드 할당 (AUTH-1001~1006)

설계는 범위만 지정하므로 내부 코드로 확정: 1001 외부토큰 형식/검증 실패,
1002 refresh 무효·만료·회전 충돌, 1003 사용자 없음/비활성(메시지는 원인
비구분), 1004 SSO 미바인딩/모드 불일치, 1005 access token 무효(401 공통),
1006 세션 이미 종료. 권한 부족 403은 COM-0403 + ACCESS_DENIED 감사.

## 이중 리뷰 반영 추록 (2026-07-31, architecture-guardian + qa-gate-reviewer)

### D6. 인증 POST의 Idempotency-Key는 CC-100에서 미구현 (명시적 이연)

계약이 세 인증 POST에 선언한 `Idempotency-Key`(optional 헤더)는 CC-100에서
재생(replay) 저장소를 구현하지 않는다. 근거: (1) mock-server도 인증 교환에는
멱등키를 요구하지 않음, (2) exchange 재시도는 추가 세션 생성일 뿐 상태 파괴가
없음, (3) refresh는 회전 충돌 가드(제시 해시 WHERE 포함)로 동시/재시도가
결정적으로 1승자만 남음(패자는 AUTH-1002 → 재로그인), (4) logout 재시도는
409로 수렴. 멱등키 재생 저장소는 생성·전파 계열 항목(CC-110+)의 공통
인터셉터로 도입하고 그때 인증 POST 포함 여부를 재평가한다.

### D3 보완 (리뷰 반영)

- `/auth/refresh` 계약을 `security: []` + `x-permission: PUBLIC_REFRESH`로
  동시 정정(동시 변경 원칙). PUBLIC_REFRESH는 PUBLIC_SSO/AUTHENTICATED와
  같은 **인증 수준**이며 권한 카탈로그(54종)에는 포함하지 않는다.
- 회전 충돌 가드: `rotateSession`의 WHERE에 제시된 refresh 해시를 포함해
  동일 토큰 동시 사용 시 정확히 1건만 성공한다(ADR-22 D5의 AUTH-1002).
- SUSPENDED 테넌트·비활성 사용자는 로그인/refresh/권한 판정 전 경로에서
  차단한다(`t.status='ACTIVE'`, `u.status='ACTIVE'`; 메시지는 원인 비구분).
- `X-Correlation-Id`는 `^[A-Za-z0-9._:-]{1,80}$`로 정규화(불일치 시 서버
  생성값 대체). audit_log.correlation_id varchar(80)과의 폭 불일치로 감사
  실패→로그인 500/감사 우회가 가능했던 결함의 수정.
- 존재하지 않는 세션의 logout은 409가 아니라 401(AUTH-1005) — 상태 충돌이
  아니라 인증 문제.

### 기타 확정 사항

- **0013_iam_hardening**: `permission` 카탈로그 런타임 REVOKE(전역 카탈로그
  읽기전용 원칙을 role/role_permission과 동일 적용), 카탈로그 GRANT SELECT
  명시(0011 기본권한 암묵 의존 제거), `uk_user_session_refresh_hash` UNIQUE
  인덱스(refresh 조회 경로·결정성).
- **마이그레이션 주체 전제**: 0012의 전역 role 시드는 FORCE RLS 아래에서
  마이그레이션 주체의 RLS 우회(superuser/BYPASSRLS)를 전제한다. 이는 기존
  운영 전제("superuser une가 마이그레이션, une_app은 런타임")와 동일하며
  관리형 호스트에서도 마이그레이션 주체는 BYPASSRLS여야 한다
  (database/migrations/README.md에 명시).
- **감사 액션 어휘**: LOGIN / LOGIN_FAILED / SESSION_REFRESHED / LOGOUT /
  ACCESS_DENIED (resource_type=SESSION|API). 설계 09 §10.3의 예시 어휘
  (LOGIN_SUCCESS/FAILURE)를 대체하는 확정 어휘로, 후속 항목이 재사용한다.
- **meta.timestamp는 UTC Z 표기** (ISO-8601, 명시적 오프셋 규칙 충족).
  설계 예시의 +09:00 표기는 표시 계층 관심사로 본다.
- ACCESS_DENIED 감사의 path는 쿼리스트링을 제거하고 기록(PII 최소화).
- **한계(수용)**: LOGIN_FAILED 감사의 tenant_id는 주장된 값이다(존재하는
  테넌트일 때만 기록됨). mock 모드 한정이며, 실패 감사 레이트리밋은 보안
  항목(CC-430)에서 재평가. `AUTH_MODE=mock`의 배포환경 가드는 데모 호스트가
  mock을 쓰는 현 단계에서는 두지 않고 TECHNOLOGY_PROFILE의 운영 규칙
  (unmasked data 환경 금지)으로 통제한다.

## 영향

- `database/migrations/0012_rbac_catalog.sql`·`0013_iam_hardening.sql`
  신설(58 테이블), DATA_DICTIONARY 재생성, 통합테스트 57→58 보정.
- `services/api` auth/iam 모듈, 전역 가드·필터, pg 런타임 풀(une_app).
- 계약 `TokenResponse`·`/auth/refresh` 변경 + 생성 타입 재생성(동시 변경
  원칙).
