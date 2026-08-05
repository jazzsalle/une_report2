# CC-170 검증 증거 — 계획서 수직 슬라이스 E2E (SSO mock → HWPX 다운로드)

- 일자: 2026-08-05 (회사 PC)
- 브랜치: feature/CC-170 (base: feature/CC-160 — CC-160이 main에 머지되기 전이라
  그 위에 쌓았다. CC-170은 CC-160의 Export 경로에 의존한다)
- 결정 기록: **ADR-32** (D1~D17 + 수용 한계)
- 측정 환경: Windows 11 + WSL2 Docker(PostgreSQL 16, MinIO), Node 22, 인메모리 저장소
- 대전제: **한/글에서 열린다는 증거는 여전히 없다.** Track B 환경 미확정(OB-08),
  rhwp 미반입(OB-12). CC-160의 한계를 그대로 이월한다.

## 착수 시점에 드러난 것 — 인수기준의 경로에 진입점이 없었다

| 공백 | 사실 |
|---|---|
| 업로드·반입 HTTP API | `UNE-DOC-001~004`가 계약에 `GenericRequest/GenericResponse` 자리표시자로만 있고 컨트롤러가 없었다. ADR-31 D1이 CC-160 범위에서 제외한 뒤 아무 항목도 가져가지 않았다 |
| 문서를 만드는 경로 | `DocumentImportService`가 컨트롤러에 배선되지 않아 테스트만 직접 호출했다 |
| 화면 | `apps/web`은 4개 파일 셸. 화면이 없으면 "화면 캡처" 증거도 없다 |
| `plan.document_id` | 0003부터 컬럼과 FK가 있었으나 **쓰는 코드가 없어** 항상 NULL이었다 |
| `OBJECT_STORAGE_PUBLIC_ENDPOINT` | CC-001부터 `.env.example`에 있었으나 읽는 코드가 없었다 |
| `malware_scan` | UNE-DOC-002의 `x-db-tables`가 가리키지만 어떤 마이그레이션에도 없다 |

## 수용기준 대응

| AC | 구현 | 증거 |
|---|---|---|
| **SSO mock to HWPX download** | 한 프로세스에서 API와 워커를 돌려 전 구간을 지난다. 화면도 같은 경로를 걷는다(5-3 실체화 단계 포함): 로그인 → 계획서 → 기준정보 Snapshot → 업로드 3단 → 반입·분석 → 목차 Job(워커) → 목차 확정 → 본문 Job(워커) → materialize → Export(워커) → 다운로드 | `tests/e2e/src/plan-slice.e2e.test.ts` "정상 경로". **받은 바이트의 SHA-256 == 검증 보고서의 `outputSha256`**, 응답 헤더 `X-Content-Sha256`도 같은 값, 산출물이 여전히 ZIP(HWPX). `plan.document_id == documentId`, `document_revision` 2건(반입 + materialize) |
| **normal/alternate/error paths** | 권한 403(읽기 전용) · 다른 기관 404(문서·Export·다운로드) · 미완료 다운로드 409 · 없는 Export 404 · PDF/DOCX 422 · 무편집 Export 바이트 동일 · 본문 생성 중지 후 재시도 · 멱등 재전송 동일 응답 | 같은 파일 7건 + `services/api/src/e2e/upload-import.e2e.test.ts` 18건(사전등록 거부 3종, 해시 불일치 → ABORTED 종단, HWPX 아닌 내용 거부, 티켓 재전송·위조·만료·교차사용, 413, 계획서 중복 링크 409, **완료확정 동시 요청 2건**) |
| **screen evidence** | `apps/web` 여섯 화면 스테퍼(5-3 실체화 포함). 각 화면이 호출한 API ID와 서버가 준 식별자를 그대로 보여 준다 | `pnpm --filter @une/e2e screens` → `docs/evidence/CC-170/screens/` **12장**. 마지막 캡처(`11-export-validation.png`)가 담은 것: 로그인부터 다운로드까지 **16개 호출**, `UNE-DOC-006 본문 실체화 — 9개 블록 삽입 → revision 2`, 문단 수 44 → 53, Track A **LIMITED**(RTA-STY-002 WARN), 산출물 SHA-256 `edb8d16c…` **"원본과 다름 — 편집이 반영됐다"**. **CI 게이트가 아니다**(ADR-32 D13) — UI 로직은 `apps/web` vitest 28건, 경로는 API E2E가 덮는다. **편집기 화면은 없다**(rhwp 미반입) |
| **performance baseline** | 실문서를 늘린 합성 50쪽(2,000문단)으로 측정 | `tests/e2e/src/perf-baseline.e2e.test.ts` — 아래 표 |

## 성능 기준선 (ADR v1.1 G15-5)

합성 문서: 실문서 `간략 보고 양식.hwpx`(44문단)를 2,000문단으로 늘림, 41KB,
생성 329ms. **문단 40개 = 1쪽 가정**(우리는 렌더하지 않으므로 실제 쪽 수는
한/글이 정한다). 바이너리는 커밋하지 않고 테스트 시점에 결정적으로 만든다.

| 항목 | p50 | p95 | max | 설계 목표 | 판정 |
|---|---|---|---|---|---|
| 분석 (엔진, 50쪽) | 148ms | **256ms** | 256ms | P95 5,000ms | **PASS** (약 20배 여유) |
| 업로드 3단 + 반입 (API) | 544ms | **613ms** | 613ms | 분석 목표 준용 | **PASS** |
| 편집 적용 (ChangeSet) | 88ms | **162ms** | 162ms | P95 300ms | **PASS** |
| Export 되쓰기 + Track A (워커) | 325ms | 352ms | 352ms | 설계 목표 없음 | 기준선 등록 |
| 다운로드 (API) | 8ms | 8ms | 8ms | 설계 목표 없음 | 기준선 등록 |

- 표본은 3~5회다. 표본이 적으면 p95는 최댓값에 가깝다.
- 개발 PC 수치이며 **운영 환경 값이 아니다**.
- 성능 테스트는 **게이트가 아니다**(ADR-32 D14) — 실패로 만들면 다음 사람이
  목표치를 낮춰 통과시킨다. 판정은 이 문서와 리뷰가 한다.

## 구현 중 측정으로 드러난 것

### 1. 실체화한 문서는 통째로 Export되지 못했다 (되쓰기 앵커 체인)

한 ChangeSet이 문단을 여럿 넣으면 두 번째부터의 `anchorHint`는 **바로 앞에 넣은
AUTHORED 문단**을 가리킨다(실행기가 넣은 순서대로 이웃을 잡는다). 그 문단은 원본에
없어 `rawXmlAnchor`도 없으므로 되쓰기가 HWPX-1103으로 거절했다.

CC-160은 문단을 **하나** 넣는 경우만 시험했기 때문에 드러나지 않았다. 실체화는
한 번에 여럿을 넣는다 — 즉 CC-160 이후 "본문 생성 → HWPX 저장"은 한 번도 성공한
적이 없었다.

조치: 체인을 거슬러 원본 문단까지 따라간다. 형제들은 같은 자리에 놓이고 순서는
문서 순서가 정한다(`applySplices`의 안정 정렬). 순환은 거부한다.

### 2. 되쓰기가 IR이 정한 서식을 무시했다

되쓰기가 **앵커 이웃**을 복제했으므로, 실행기가 프로토타입(§1.7)에서 고른
`styleRef`가 산출물에 반영되지 않았다. 산출물을 다시 읽으면 IR과 서식이 달라
Track A의 `RTA-STY-001`이 FAIL하고 바이트가 폐기된다.

조치: 자리는 앵커가, **서식은 IR이** 정한다. 의도한 서식과 같은 복제 가능한
문단을 찾아 복제하고, 없으면 거부한다(서식을 지어내지 않는다).

### 3. 실문서의 개요 프로토타입은 run이 4개고 마지막은 빈 run이다

`OUTLINE_1` 프로토타입(`□ HY헤드라인M 15Point `)은 글자속성이 갈려 run이 4개이고
마지막 run은 `hp:t`가 없는 빈 run이다. 복제기가 "run 정확히 1개"를 요구했고
`simpleTextElement`가 빈 run을 "복제 불가"와 구분하지 못했다.

조치: 텍스트를 첫 텍스트 run에 모으고 나머지 텍스트 run은 비운다. 빈 run은
손대지 않는다. 탭·인라인 컨트롤이 섞이면 여전히 거부한다(§1.10-3).

### 4. presign URL이 브라우저에서 연결되지 않을 배포가 있었다

`OBJECT_STORAGE_PUBLIC_ENDPOINT`는 CC-001부터 문서화돼 있었으나 읽는 코드가
없었다(presign 경로가 없었으므로 드러나지 않았다). API가 컨테이너 네트워크로
저장소를 보고 브라우저는 호스트 주소로 봐야 하는 배포에서 서명된 URL이 무용하다.
SigV4는 Host를 서명하므로 **브라우저가 보낼 Host로 서명하는 전용 클라이언트**를
두어 해소했다.

### 5. 계약이 존재하지 않는 테이블을 가리켰다 (`malware_scan`)

AV 스캐너가 없으므로 테이블을 만들지 않고 계약을 구현 진실로 교정했다.
재발 방지로 **구현된 API의 `x-db-tables` 전건을 데이터 사전과 대조**하는 계약
테스트를 세웠다(구현 여부는 컨트롤러 주석에서 유도 — 손으로 관리하면 낡는다).

### 6. 같은 관계에 진실을 둘 만들려다 되돌렸다

계획 단계에서 `document.plan_id`를 신설하려 했으나, 구현 중 `plan.document_id`가
0003부터 있고 FK도 있으며 plan 저장소가 이미 읽는다는 것을 확인했다 — 쓰는
경로만 없었다. 역방향 링크를 만들지 않고 그 컬럼을 채우며, 대신 없던 보장
("한 문서를 두 계획서가 주장할 수 없다")을 부분 유니크 인덱스로 세웠다.

### 7. e2e 설정 객체가 다섯 파일에 복제돼 있었다

CORS·업로드 설정을 `ApiConfig`에 더하자 다섯 e2e가 런타임에 터졌다(리터럴로
설정을 조립하고 있었다). `services/api/src/e2e/test-config.ts`로 모아 다음 추가는
한 줄이 되게 했다.

## Track A는 편집 경로에서 LIMITED다

문단을 넣으면 `RTA-STY-002`(개요 수준)가 **WARN**을 내고 보고서는 LIMITED가 된다.
삽입은 뒤쪽 문단의 개요 서수를 밀기 때문이며, 손상이 아니라 편집의 정상적 결과다.
바이트는 나간다. FAIL이면 폐기다(ADR-31 D6) — 그 구분이 이 항목에서 실제로 작동함을
확인했다(결함 2가 FAIL로 잡혀 폐기됐다).

무편집 Export는 여전히 원본과 **바이트 동일**하다(AC1을 제품 경로에서 재확인).

## 게이트 실행 결과

단일 `pnpm test`(exit 0)로 재현한 수치다. `DATABASE_URL`(superuser)과
`OBJECT_STORAGE_*`를 설정해 db-integration·api e2e·worker e2e·실 MinIO 통합·
슬라이스 E2E가 실제로 실행됐음을 분모(`Test Files N passed (N)`)로 확인했다.

| 워크스페이스 | 결과 | CC-160 대비 |
|---|---|---|
| `@une/hwpx-engine` | **426** / 23 files | 423 → +3 (되쓰기 결함 3건 회귀) |
| `@une/api` | **285** / 24 files | 257 → +28 (업로드·반입 e2e 20 — 동시성 2 포함, 티켓 단위 8) |
| `@une/provider-adapters` | **138** / 13 files | 128 → +10 (presign 실 MinIO 3, 키·공개엔드포인트 7) |
| `@une/db-integration` | **127** / 11 files | 120 → +7 (0022 표면 + 백필) |
| `@une/contract-tests` | **195** / 12 files | 188 → +7 (DOC-001~004 표면 + x-db-tables 게이트) |
| `@une/e2e` | **13** / 2 files | 신규 (슬라이스 8 + 성능 5) |
| `@une/web` | **28** / 3 files | 1 → +27 (클라이언트 12, 상태·토큰 12, 앵커 선택 4) |
| `@une/worker` | **44** / 5 files | 변경 없음 |
| `@une/domain` | **62** / 10 files | 변경 없음 |
| `@une/field-web` | 1 / 1 | 셸 |
| baseline pytest | **14** | 10 → +4 (mock 업로드 3단) |
| `pnpm validate:contracts` | **PASS** (예제 23건 — DOC-001~004 8건 신규) | |
| `pnpm validate:intake` / `validate:handoff` | **PASS** | |
| `build` / `typecheck` / `lint` / `format:check` | **PASS** | |
| 생성 타입 drift | 0 (`apps/web/src/generated` 신규 대상 포함) | |

DB 상태: 마이그레이션 **22개**, 테이블 **61 유지**, 데이터 사전 61/574
(+`upload_state`, +`verified_at`).

## 이중 리뷰

`architecture-guardian`(**BLOCKER 0 / MAJOR 8 / MINOR 11**)과 `qa-gate-reviewer`
(**PASS WITH CONDITIONS**, 필수 3)를 병렬로 돌렸다. QA는 이 문서의 수치를 전건
독립 재현했고 값이 일치했다(성능은 표본 3~5회 수준의 편차 안에서 판정 동일).

두 리뷰가 **같은 두 가지**를 지적했다.

1. **이 항목의 대표 증거인 슬라이스 E2E가 CI에서 한 번도 실행되지 않았다.**
   `verify` 잡은 `DATABASE_URL`이 없어 `describe.skipIf`로 전건 침묵 스킵되고,
   `db-verify` 잡은 워크스페이스를 명시적으로 나열하는데 `@une/e2e`가 없었다.
   CC-140이 겪은 실패 유형(로더 결함으로 코퍼스 회귀가 조용히 꺼져 있었다)과
   같은 구조다. `db-verify`에 추가했다.
2. **계약이 존재하지 않는 컬럼 `document.plan_id`를 진실로 선언했다** — ADR-32 D4가
   `malware_scan`으로 닫은 결함 유형이 컬럼 층위에서 재발했고, 이 항목이 세운
   `x-db-tables` 게이트는 테이블 이름만 보므로 잡지 못한다. 계약을 고치고 타입을
   재생성했다.

QA의 세 번째 필수는 더 아팠다: **화면으로 내려받은 HWPX에 생성 본문이 한 글자도
없었다.** `apps/web`에 materialize 호출이 없어 목차·본문 생성 다음이 곧장 Export였고,
캡처의 Track A가 "원본과 바이트 동일"을 그대로 보여 주고 있었다. 문서에 한계로
적는 대신 **UI에 실체화 단계(5-3)를 만들었다** — 인수기준이 "SSO부터 HWPX
다운로드까지"인데 그 다운로드가 원본 그대로라면 증거가 인수기준보다 약하다.

아키텍처 리뷰의 나머지 MAJOR 다섯도 전부 반영했다(ADR-32 D17 표). 요지:
반입이 저장소 바이트의 해시를 다시 확인하지 않았고(워커는 이미 한다),
티켓 서명 키가 빈 비밀에서 파생될 수 있었고, 서버가 만든 `file_object`가 0022의
백필 판단과 반대로 영구 PENDING이었고, 복제 원본이 `hp:secPr`를 품은 문단을 고를
수 있었고(구역 속성이 둘인 HWPX는 조용히 열린다), 업로드 키의 `uploads/` 접두사가
영구 원본의 수명을 거짓으로 말했다.

## 남는 한계

ADR-32 "수용 한계" 9항을 정본으로 본다. 요약:

1. **실체화 자리에 제약이 있다** — 표 뒤·정적영역 뒤에는 놓을 수 없고, 화면이
   그 사실을 미리 말해 주지 못한다. E2E는 정적영역 밖 마지막 문단 뒤를 고른다.
2. 한/글 미검증(OB-08, OB-12) · 편집기 화면 없음 · AV 스캔 없음(OB-15).
3. 화면 캡처는 CI에서 돌지 않아 회귀를 잡지 못한다.
4. 성능 수치는 개발 PC 값이고 표본이 3~5회다.
5. 실제 T3Q SSO 없음(OB-01) · 화면이 SSE를 쓰지 않는다(폴링).
6. XML 1.0 금지 제어문자 미검사(CC-160 이월).
