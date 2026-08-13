# OB-19 / OB-17 증거 — 업로드 용도와 워커 로그인 롤

- 작업: CC-320 후속 (외부 대기 없이 끝낼 수 있는 차단 항목 둘)
- 브랜치: `feature/CC-320`
- ADR: **ADR-47**
- 마이그레이션: `0049_file_object_purpose.sql`,
  `0050_worker_login_role_membership.sql`
- 날짜: 2026-08-13

## OB-19 — 지식문서 용도 파일 업로드

### 무엇이 막혀 있었나

```
POST /api/v1/files {purpose: "KNOWLEDGE_DOCUMENT", mimeType: "application/pdf"}
→ 422 FILE-422-001 "KNOWLEDGE_DOCUMENT 용도는 아직 지원하지 않습니다."
```

UNE-KNOW-001(지식문서 등록)은 `fileId`를 받는데 **그 `fileId`를 만들 수 있는
API가 없었다.** 지식문서 → 근거 검색 → SOP 생성 구간 전체가 API만으로는 도달할
수 없었고, CC-220의 e2e가 `file_object` 행을 SQL로 심어 출발했기 때문에 CC-320
수직 슬라이스가 API로만 지나 보기 전까지 드러나지 않았다.

### 무엇을 했나

1. **용도가 정책을 고른다**(ADR-47 D1). `KNOWLEDGE_DOCUMENT`는
   `application/pdf`·`text/plain`을 `knowledgeMaxFileBytes` 상한으로 받는다.
   HWPX 반입은 그대로다.
2. **지식문서의 내용 판정을 UNE가 하지 않는다.** UNE-DOC-002는 지금까지 HWPX
   패키지 분석을 무조건 걸었고, 그것을 PDF에 걸면 정상 파일이 100% 거절된다.
   PDF 매직바이트를 흉내 내면 UNI가 실제로 읽을 수 있는지와 **무관한 판정이
   한 벌 더** 생기고, 두 벌은 갈라진다. 크기·해시까지만 보고 형식은 UNI가
   판정한다(`uni_status`).
3. **파일 행이 자기 용도를 기억한다**(0049). 지금까지 `purpose`는 감사 detail에만
   남아, 형식이 맞으면 **자리를 바꿔 쓸 수 있었다** — 지식문서용 파일을 HWPX
   반입에, 계획서 양식을 지식문서에. 소비하는 쪽이 대조한다.
4. `ATTACHMENT`는 **열지 않았다.** 현장 사진·동영상이 오는 자리라 개인정보
   최소화와 EXIF 제거 판단이 선행이다.

### 실측

```
# 열렸다
POST /api/v1/files {purpose:"KNOWLEDGE_DOCUMENT", mimeType:"application/pdf"} → 201
PUT  /api/v1/files/{id}/content                                               → 204
POST /api/v1/files/{id}/complete                                              → 200 (HWPX 분석을 걸지 않는다)
POST /api/v1/situations/{id}/knowledge-documents {fileId}                     → 202

# 자리를 바꿔 쓸 수 없다
POST /api/v1/documents/import-hwpx {fileId: <KNOWLEDGE_DOCUMENT 파일>}        → 4xx
POST /api/v1/situations/{id}/knowledge-documents {fileId: <HWPX_IMPORT 파일>}  → 422 PURPOSE_MISMATCH
```

CC-320 수직 슬라이스 (4)단계가 이제 SQL 없이 제품 경로로 지난다.

### 남은 차단

**OB-15(AV)가 여전히 열려 있다.** `scan_status`는 영구 PENDING이고 지식문서
등록은 `CLEAN`을 요구하므로, 제품 경로로 등록하려면 아직
`UNE_KNOWLEDGE_ALLOW_SCAN_PENDING=true`가 필요하다. **OB-19는 두 차단 중 하나만
없앴다.** CC-320 하네스는 이 토글을 켜고 돌며, 켜져 있다는 사실 자체가 완화
기록이다(ADR-36 D6).

## OB-17 — 워커 전용 로그인 롤

### 무엇이 막혀 있었나

`une_app`은 `une_worker`로도 `une_retention`으로도 `SET ROLE`할 수 없었다
(42501, 실측). initdb는 `une_app`만 만들고 두 대상 롤은 마이그레이션이 NOLOGIN
으로 만드는데, **그 사이를 잇는 GRANT가 저장소 어디에도 없었다** — initdb·
마이그레이션·compose·CI 전부. 0015부터의 선재 결함이며, 테스트가 superuser로
접속해 강등하기 때문에 드러나지 않았다.

결과: `services/worker/.env.example`대로 워커를 띄우면 첫 트랜잭션이 42501로
죽고, 보존 스윕은 한 번도 돌지 않아 제공자 원문이 무기한 남는다.

### 무엇을 했나

**워커 전용 로그인 롤 `une_worker_app`**을 두고 `INHERIT FALSE, SET TRUE`로
멤버십을 준다(PG16).

- `une_app`에 멤버십을 주지 **않았다** — 기본 `INHERIT`가 정책 대상 자격까지
  물려줘 API 런타임이 전 테넌트 원문을 보게 된다(ADR-35 D2/D4).
- `INHERIT FALSE`라 **`SET ROLE`을 빼먹은 경로가 조용히 통과하지 않는다.**
- **순서 문제를 갈라서 풀었다.** initdb는 마이그레이션보다 먼저 도므로 대상
  롤에 GRANT할 수 없고, 마이그레이션은 비밀번호를 다룰 수 없다. 그래서
  비밀번호·LOGIN은 initdb가, 멤버십은 0050이 준다. 양쪽 어디서 시작해도 같은
  자리에 도착한다.
- 0050은 **자기가 한 일을 확인하고 끝난다**. GRANT가 서지 않으면
  `RAISE EXCEPTION` — "적용됐다"는 기록만 남고 워커는 여전히 죽는 상태가 가장
  나쁘다. 그것이 OB-17이 지금까지 살아남은 방식이다.

### 바뀐 파일

| 파일 | 무엇 |
|---|---|
| `database/migrations/0050_...sql` | 롤·멤버십·적용 확인 |
| `infrastructure/initdb/02-worker-role.sh` | LOGIN·비밀번호 (신규) |
| `infrastructure/docker-compose.yml` | `UNE_DB_WORKER_USER/PASSWORD` 전달 |
| `infrastructure/.env.example` | 두 값 + 왜 `une_app`에 주면 안 되는지 |
| `services/worker/.env.example` | `DATABASE_URL`이 `une_worker_app`을 가리킨다 |
| `tests/integration/src/worker-login-role.test.ts` | 권한 자체를 고정 (신규) |

### 공회전할 뻔한 단언

처음에는 `SET ROLE`을 **시도해 보는** 방식으로 썼다. 그런데 이 테스트는
superuser로 접속하고 `SET ROLE` 권한은 **세션 사용자**를 기준으로 검사되므로,
중간에 무엇으로 갈아입었든 언제나 통과한다 — 네 단언 중 둘이 아무것도 증명하지
않았다. `pg_has_role(member, target, 'SET'|'USAGE')`로 카탈로그에 직접 묻도록
고쳤다.

이것이 CC-310 이중검토가 찾은 "vacuous 단언"과 같은 계열이다.

### 실측

```
pg_has_role('une_worker_app','une_worker','SET')      → true
pg_has_role('une_worker_app','une_retention','SET')   → true
pg_has_role('une_worker_app','une_worker','USAGE')    → false   (INHERIT FALSE)
pg_has_role('une_app','une_worker','SET')             → false
pg_has_role('une_app','une_retention','SET')          → false
SET ROLE 없이 generation_job 조회 (une_worker_app)     → 42501
SET ROLE une_worker 뒤 조회                            → OK
une_worker_app: NOSUPERUSER NOBYPASSRLS NOLOGIN(마이그레이션 기준)
```

`tests/integration/src/worker-login-role.test.ts` **4 passed**.

## 게이트

| 게이트 | 결과 |
|---|---|
| `pnpm build` / `typecheck` / `lint` / `format:check` | PASS |
| `pnpm validate:contracts` | PASS |
| `pnpm run db:migrate` | 48 → **50** |
| `pnpm validate:handoff` | PASS (850 files) |
| 데이터사전 | 68 테이블 / **680** 컬럼 (`file_object.purpose` 추가) |

테스트 (전 스위트, DATABASE_URL 붙인 상태):

| 스위트 | 결과 |
|---|---|
| 도메인 | 370 passed |
| 계약 | 452 passed |
| API | 434 passed |
| 워커 | 79 passed |
| HWPX 엔진 | 426 passed |
| 어댑터 | 264 passed (7 skipped) |
| 워크스페이스 웹 | 53 passed |
| 현장앱 | 19 passed |
| 통합 | **201 passed** (신규 `worker-login-role` 4 포함) |
| E2E | **180 passed** (CC-320 수직 슬라이스 18 포함) |

`tests/integration/src/migrations.test.ts`의 마이그레이션 개수 고정값을
46 → 50으로 갱신했다. 이 테스트가 0047 이후 처음 돈 자리이며, 실제로 잡았다.
