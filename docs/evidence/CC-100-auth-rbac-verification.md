# CC-100 mock 인증·테넌트·RBAC 검증 증거

- 일자: 2026-07-31 (회사 PC, WSL2 Ubuntu + Docker CE, PostgreSQL 16.9)
- 브랜치: feature/CC-100
- 관련 결정: ADR-22 (role_permission 신설, 카탈로그 시드, mock 인증 계약,
  TokenResponse envelope 정합, AUTH-1001~1006 할당, 이중 리뷰 반영 추록)

## 수용 기준 대응

| 수용 기준 | 구현·증거 |
|---|---|
| JWT mock | HS256 UNE JWT (`services/api/src/auth/tokens.ts`), sub/tid/sid claim. 발급은 `AUTH_MODE=mock` + 외부토큰 `mock.<base64url>` 경유(UNE-AUTH-001). 테스트: 발급/검증/만료/변조/타키 서명/alg=none 거부 |
| tenant isolation | 모든 쿼리 `withTenant` 트랜잭션(`set_config('app.tenant_id',…,true)` 트랜잭션 로컬 + RLS) + 명시적 tenant 술어. e2e: A/B 테넌트 조직도·사용자 검색 상호 불가시 |
| permission tests | PermissionsGuard가 DB(user_role→role→role_permission→permission, 유효기간)에서 판정. 단위 8건 + e2e 403/COM-0403 + ACCESS_DENIED 감사 + 통합테스트 유효기간 만료 바인딩 0건 |
| audit login/session events | LOGIN(세션 생성과 단일 트랜잭션), LOGIN_FAILED(별도 트랜잭션 — 본 트랜잭션 롤백에도 생존), SESSION_REFRESHED, LOGOUT, ACCESS_DENIED가 audit_log(append-only, 0011)에 기록. 감사 액션 어휘는 ADR-22 추록에 확정 |
| tenant claim forgery blocked (mock 모드 포함) | (1) mock 토큰의 위조 tenantId → RLS+명시 술어가 사용자 은닉 → 401 AUTH-1003 + LOGIN_FAILED 감사 (2) 발급 JWT의 tid 변조 → 서명 검증 실패 401 (3) 타 키 서명 토큰 → 401 (4) refresh 토큰 tenant 세그먼트 위조 → SHA-256 해시 불일치로 401 (부모조인 방어 자체는 통합테스트가 별도 실증) (5) 쿼리파라미터 tenantId 위조 → 403 ORG-2001. 전부 e2e 검증 |
| AUTH_MODE=mock 게이트 + 환경 비밀 서명키 | `loadApiConfig`: mock 모드에서 `UNE_AUTH_JWT_SECRET` 32자 미만/부재 시 기동 실패, 기본값 없음. 비-mock 모드 exchange → 503 AUTH-1004 (e2e). 단위테스트 6건 |
| 하위 테이블 부모조인 스코핑 + 전역 행 읽기전용 | user_session/user_role/role_permission은 app_user/role 조인 필수(리포지토리 전 쿼리). 통합테스트: bare SELECT 2행(비보호 문서화) vs 조인 시 자기 테넌트만; 전역 role UPDATE는 RLS 정책 위반 거부; permission·role_permission은 une_app SELECT만(0013); une_app 실접속 경로는 e2e가 `SET LOCAL ROLE une_app`(FORCE RLS 동일 적용)으로, LOGIN 자격은 로컬 compose initdb가 프로비저닝 |

## 실행한 게이트 (2026-07-31, 로컬 — 리뷰 반영 후 최종)

```
pnpm build                        # 전 워크스페이스 OK
pnpm typecheck                    # OK (tsconfig.test.json: Bundler resolution)
pnpm test                        # 전 워크스페이스 green, 2회 연속 재현
  @une/api        55/55 (unit 40 + e2e 15; DATABASE_URL 없으면 e2e 15 skip)
  @une/db-integration 25/25 (기존 17 + CC-100 8)
pnpm lint / format:check          # OK
pnpm validate:contracts           # PASS (TokenResponse·/auth/refresh 변경 반영)
pnpm generate:contract-types      # 재생성, drift 없음
pnpm validate:handoff             # PASS (306 files)
pnpm db:migrate                   # 0012·0013 적용 (로컬 une DB: 13 migrations/58 tables)
pnpm db:data-dictionary           # 58 tables / 516 columns 재생성
pnpm db:seed:dev                  # 2회 실행 멱등 확인
```

주: 루트 `pnpm test`는 워크스페이스 직렬 실행(`--workspace-concurrency=1`)로
변경 — 병렬 CREATE DATABASE 간섭 및 로컬 WSL 유휴 종료로 인한 간헐
ECONNREFUSED(infrastructure/README.md 주의 절 보강)와 분리하기 위함.

## 마이그레이션 0012·0013 (ADR-22)

- `role_permission` 신설: 설계 API/SEQ가 읽는 테이블이 물리 목록에서 누락된
  내부 모순 해소(58번째 테이블).
- role_code 부분 유니크 2종(전역/테넌트) — 시드 멱등성·권한 판정 결정성.
- 권한 카탈로그 54종: 계약 x-permission과 1:1(기계적 추적, 발명 아님;
  AUTHENTICATED/PUBLIC_SSO/PUBLIC_REFRESH는 인증 수준이라 제외).
- 시스템 역할 15종: 화면설계 09 §3 카탈로그와 1:1.
- 역할→권한 매트릭스는 시드하지 않음(설계 미확정) — dev 시드
  (`database/seeds/dev-iam.sql`, `pnpm db:seed:dev`)와 테스트 픽스처만.
- 0013(이중 리뷰 반영): permission 카탈로그 런타임 REVOKE, 카탈로그
  GRANT SELECT 명시, `uk_user_session_refresh_hash` UNIQUE 인덱스.

## 이중 리뷰 결과와 반영 (2026-07-31, 당일 해소)

architecture-guardian (BLOCKER 1, MAJOR 4, MINOR 9) + qa-gate-reviewer
(PASS WITH CONDITIONS: 필수 4, 권고 7). 필수·공통 지적과 반영:

| 지적 | 반영 |
|---|---|
| B-1/M2: X-Correlation-Id ≤100자 수용 vs audit_log varchar(80) → 로그인 500·감사 우회 | 미들웨어 정규화 `^[A-Za-z0-9._:-]{1,80}$`(불일치 시 서버 생성값 대체) + 단위 6케이스 + e2e(100자 헤더로 로그인 성공·감사 기록) |
| M-1/R1: refresh 회전에 제시 해시 가드 없음(동시 사용 모두 성공) | `rotateSession` WHERE에 제시 해시 포함 → 정확히 1승자. e2e 동시 refresh [200,401] |
| M-3: SUSPENDED 테넌트 인증 허용 | 전 인증 경로 `t.status='ACTIVE'` 필터 + e2e 401 |
| R2/m-1: 비활성 사용자 세션 연장·권한 유지 | findSessionByHash/rotateSession/loadRoles/loadPermissions에 `u.status='ACTIVE'` |
| M-4/M3: /auth/refresh 계약(BearerAuth) vs 구현(@Public) 불일치 | 계약을 `security: []` + `x-permission: PUBLIC_REFRESH`로 동시 정정 + 타입 재생성 (ADR-22 D3 보완) |
| M4(QA): permission 카탈로그 런타임 쓰기 가능 | 0013 REVOKE + 통합테스트(grants=SELECT) |
| M-2/R3: Idempotency-Key 미처리 이연 근거 부재 | ADR-22 D6로 명시 이연(재생 저장소는 CC-110+ 공통 인터셉터에서) |
| m-2/AC4: ACCESS_DENIED 감사에 쿼리스트링(PII) 유입 | path만 기록(쿼리스트링 제거) |
| m-8 일부: 존재하지 않는 세션 logout 409 | 401(AUTH-1005)로 분리 |
| m-5: refresh_hash 인덱스 부재 | 0013 UNIQUE 인덱스 |
| m-6: role_permission SELECT의 암묵 의존 | 0013 명시 GRANT |
| m-7: 전역 시드의 superuser 우회 전제 | migrations README에 마이그레이션 주체 BYPASSRLS 전제 명문화 |
| m-4: meta.timestamp 표기 | ADR-22 추록에 UTC Z 확정 |
| M1(QA)/m-9: 상태·증거 문서 미갱신 | 본 문서·IMPLEMENTATION_STATUS·MASTER_WORK_ITEMS·CHANGELOG 갱신, 커밋 포함 |

수용된 한계(수정하지 않음, 근거는 ADR-22 추록): LOGIN_FAILED 감사의
tenant_id는 주장값(존재 테넌트만 기록, 레이트리밋은 CC-430 재평가),
`AUTH_MODE=mock` 배포환경 하드 가드 없음(데모 호스트가 mock 사용),
세션 상태머신의 domain 패키지 승격(후속 정리), 응답 본문 AJV 계약 검증과
계약 쿼리 파라미터 선언(CC-115/CC-400 example-level contract tests 이연
항목에 합류), x-permission↔@RequirePermission 자동 대조 게이트(권고, 후속),
설계 09 화면표의 카탈로그 외 역할 표기(ORG_ADMIN 등)는 설계 내부 불일치로
기록.

## 알려진 한계·이관

- Access token은 만료(기본 900초)까지 유효 — 로그아웃은 refresh 세션만 폐기
  (ADR-22 D3). 세션 단위 즉시 차단이 필요해지면 후속 항목에서 검증 캐시 추가.
- UNE-AUTH-003은 Public 라우트 + refresh 토큰 자체 인증(ADR-22 D3, 계약 동시
  정정 완료).
- 실 T3Q SSO 교환은 OB-01 OPEN 유지 — 비-mock 모드는 503 AUTH-1004.
- 존재하지 않는 tenant의 LOGIN_FAILED는 audit_log FK로 기록 불가 → 앱 로그
  경고로 대체(e2e로 500 미발생 확인).
- OBJECT scope(user_role.scope_id) 판정은 업무객체 항목(CC-110+)에서 구현 —
  CC-100은 테넌트/시스템 수준 판정까지.
- 사용자 검색은 email_enc/phone_enc를 SELECT하지 않음(PII 최소화);
  복호화·마스킹 표시는 해당 화면 항목에서 별도 구현.
