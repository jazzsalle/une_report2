# Session Handoff

- Date/time: 2026-08-08 (집 PC, 아홉 번째 세션 — 종료)
- Branch: **main** @ `816a70a` (= PR #16 머지 커밋)
- Current Work Item: **CC-200·CC-210 둘 다 DONE, 머지 완료.** 열린 PR 없음.
  **G3가 절반 진행됐다** — 다음은 **CC-220**.

## 이번 세션에 끝난 것

한 세션에서 Work Item 두 개를 끝내고 머지까지 했다.

| PR | 항목 | 머지 커밋 | CI |
|---|---|---|---|
| [#15](https://github.com/jazzsalle/une_report2/pull/15) | CC-200 | `cf2fe5a` | verify 2m7s / db-verify 1m46s |
| [#16](https://github.com/jazzsalle/une_report2/pull/16) | CC-210 | `816a70a` | verify 2m3s / db-verify 2m10s |

`gh pr merge`는 이번에 **Claude가 직접 실행했다**(사용자가 "알아서 머지하고
진행해"로 위임). 이전 핸드오프의 "분류기가 차단한다"는 이 조건에서는 해소됐다.
⚠️ **출력이 비어 보여도 성공한 것이다** — `gh pr view <n> --json state`로 확인할 것.

### CC-200 (ADR-33, 마이그레이션 0023·0024)

상황 CRUD + 후보 SituationFact 수집. 종점은 `status=CANDIDATE`.

- **Provider 수집은 동기**(승인). `provider_job`은 SUCCEEDED/PARTIAL/FAILED
  셋뿐이고 행이 종결된 채로 태어난다. 경계: 짧은 읽기 → **트랜잭션 밖** 병렬
  호출 → 한 쓰기 트랜잭션(쓰기 트랜잭션이 상황을 `FOR UPDATE`로 재확인).
- **부분 장애는 200.** 전멸해도 200 + FAILED Job. 실패 8갈래로
  `DISABLED`(OB-05)·`NOT_CONTRACTED`(OB-02)·실제 장애를 구분한다.
- 신설 API **UNE-SIT-014/015**. `Situation` 자리표시자 실형태화.
- **마이그레이션 0024**: 0023이 `updated_at` 컬럼만 넣고 관례 트리거를
  빠뜨려 "마지막 보정 시각"이 INSERT 시각에 고정되던 것을 닫았다.
- 실측 결함 3건: `new Date('2026-02-30')` 롤오버, 위 트리거 누락, SIT-005가
  계약(200) 대신 201.

### CC-210 (ADR-34, 마이그레이션 0025)

중복군·충돌 해소·불변 SituationSnapshot. 테이블 62 → **63**.

- **UNE-SIT-008의 의미가 바뀌었다**(사용자 결정): 보정이 제자리 UPDATE →
  **파생 Fact 생성 + 원본 SUPERSEDED**, `reason` 필수, 출처는 MANUAL/USER 신규.
  응답은 **새 factId**이고 강한 ETag 대신 `Content-Location`을 준다.
  같은 원본 재보정은 이제 **412**(전에는 409).
- 충돌 탐지는 SIT-009 시점(사용자 결정). 값도 시각도 같으면 중복이지 충돌이
  아니다. 확정은 미해결 충돌을 차단하고 자동으로 고르지 않는다.
- Snapshot은 Fact의 **사본**을 갖는다. 해시는 사실+`effectiveAt`만.
  Diff는 **(범주, Key)** 기준.
- **`situation_fact` 중복 유니크 키는 만들지 않기로 결정**(0023 §3이 미룬 항목
  종결). 중복은 제약이 아니라 판정이다.
- 계약의 `SituationSnapshot` 자리표시자 해소 → **상황 계열에 열린 스키마 0건.**

## 이중 리뷰가 잡은 것 — 이번 세션의 가장 큰 값

두 항목 모두 병렬 이중 리뷰(architecture-guardian + qa-gate-reviewer, opus)를
돌렸고 **둘 다 실질 결함을 냈다.** CC-210은 특히 무거웠다.

**CC-200**: arch 1 BLOCKER / 6 MAJOR / 8 MINOR, QA PASS WITH CONDITIONS(필수 5).
- 컨트롤러가 시각 검사 규칙의 **두 번째 사본**을 들고 있었고 그 사본에 달력
  검사가 없어 `occurredAt: 2026-02-30`이 3월 2일로 저장됐다.
- `Promise.all`의 무보호 어댑터 호출 — 하나가 던지면 다른 Provider의 원문·
  후보가 통째로 버려지고 Job 행이 하나도 안 남는다.
- 시험 훅 `mockScenario`가 **운영 요청 경로**에 있었다 → 설정 주입으로 이동.
- **타임아웃이 하나도 없었다** → Provider당 제한시간 도입.
- `PROV-503-001 → PROV-400-001` 재명명이 **테스트 0건 실패로 통과**했다 →
  구현 소스에서 코드를 뽑아 계약과 대조하는 게이트 신설.

**CC-210**: arch **2 BLOCKER** / 11 MAJOR / 9 MINOR, QA PASS WITH
CONDITIONS(필수 7). BLOCKER 둘이 **인수기준 1을 우회하고 있었다.**
1. 충돌의 정체성이 `fact_key` 하나라 그룹의 정체성(범주+Key+창)과 어긋났다.
   같은 Key의 다른 시간창 충돌이 부분 유니크에 걸려 `DO NOTHING`으로
   삼켜졌고, 첫 충돌만 해소하면 미해결 불일치를 못 본 채 확정이 통과했다.
2. 0025가 `SUPERSEDED`를 더했는데 도메인·계약·JSON Schema는 3값 그대로였고,
   **ADR-33 D1의 삼중 대조 게이트가 0023 한 파일만 읽어 초록으로 통과했다.**
   게이트가 막으려던 사고가 게이트를 우회했다 → 게이트가 "제약을 마지막으로
   정의한 마이그레이션"을 찾아 읽도록 고쳤다.

그 밖에 재확정이 이전 판의 사실을 잃어 **Diff가 지운 적 없는 사실을 REMOVED로
보고**하던 것, 재계산이 사라진 충돌을 닫지 않아 **확정이 영구 차단**되던 것
(→ `OBSOLETE` 신설), `openConflictCount` 하드코딩 0으로 `CONFLICT_OPEN`이
도달 불가능하던 것 등 전건 반영.

## ⚠️ 다음 세션에서 먼저 알아야 할 것

1. **로컬 브랜치 정리.** `feature/CC-150`, `feature/CC-200`, `feature/CC-210`이
   머지 후에도 로컬에 남아 있다.
2. **`pnpm test`와 CI `verify`가 덮는 범위가 다르다.** 이번에도
   `pnpm test`는 통과하는데 `pnpm -r typecheck`가 깨진 순간이 있었다 —
   `tests/e2e/src/harness.ts`가 `ApiConfig` 리터럴을 따로 들고 있어 새 필드가
   빠졌고 **vitest는 타입검사를 하지 않는다.** 커밋 전 `-r typecheck` 필수.
3. **WSL keepalive가 약 1시간마다 만료된다.** 이번 세션에 네 번 만료됐고 한
   번은 전량 테스트 도중에 죽어 워커 e2e가 통째로 실패했다
   (`terminating connection due to administrator command`).
   **테스트가 무더기로 깨지면 코드 이전에 컨테이너를 의심할 것.**
   `MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- sleep 3500`을 별도 프로세스로 띄운다.
4. **실행 중인 트리는 유효한 증거가 아니다.** QA 리뷰어의 첫 전량 실행이
   내 편집과 겹쳐 `ReferenceError`로 실패했다. 수치는 편집을 끝낸 뒤 얼린
   트리에서 한 번에 얻을 것.

## 환경 재개 (이 PC면 부트스트랩 불필요)

```bash
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- docker ps    # WSL 깨우기(컨테이너 자동 복구)
set -a; . ./infrastructure/.env; set +a
export DATABASE_URL="postgres://$UNE_DB_USER:$UNE_DB_PASSWORD@127.0.0.1:$UNE_DB_PORT/$UNE_DB_NAME"
export OBJECT_STORAGE_ENDPOINT="http://127.0.0.1:$UNE_MINIO_API_PORT"
export OBJECT_STORAGE_BUCKET="$UNE_MINIO_BUCKET"
export OBJECT_STORAGE_ACCESS_KEY="$UNE_STORAGE_ACCESS_KEY"
export OBJECT_STORAGE_SECRET_KEY="$UNE_STORAGE_SECRET_KEY"
pnpm db:migrate   # 25개
pnpm -r build
```

- **이 PC의 DB 포트는 15432**(회사 PC는 5432). `infrastructure/.env`는 gitignored.
- 통합·e2e는 위 환경변수가 없으면 **조용히 skip되고 exit 0**이다.
  수치 인용 전 분모(`Test Files N passed (N)`)를 확인할 것.
- `gh` 2.97.0 설치·인증됨(keyring). 그냥 `gh`로 된다.

## 게이트 (main 기준, 단일 `pnpm test` exit 0 · skip 0)

| 워크스페이스 | Test Files | Tests |
|---|---|---|
| @une/hwpx-engine | 23 | 426 |
| @une/api | 26 | 375 |
| @une/contract-tests | 13 | 222 |
| @une/provider-adapters | 14 | 162 |
| @une/db-integration | 12 | 141 |
| @une/domain | 14 | 143 |
| @une/worker | 5 | 44 |
| @une/e2e | 2 | 13 |
| @une/web / @une/field-web | 3 / 1 | 28 / 1 |

build·typecheck·lint·format PASS. contracts·intake·handoff PASS.
계약 타입 재생성 diff 0. 마이그레이션 **25개**, 테이블 **63**, 데이터 사전 63/601.

## 다음 항목: CC-220

**지식문서 업로드 + UNI 목업 어댑터**(UNE-KNOW 계열). 의존 CC-210 충족.
착수 전 확인할 것:

- `knowledge_document` 테이블은 0004부터 있다. RLS·어휘 상태를 **실측**할 것 —
  상황 계열이 그랬듯 정책이 없을 수 있다.
- UNI 후보 호스트는 `http://221.147.100.161:8000`이고 **base path·auth를
  추측하지 말 것**(OB-13). 계획 흐름에는 UNI를 쓰지 않는다.
- `packages/provider-adapters/src/index.ts`의 머리말이 "UNI adapter: CC-220 /
  CC-240"이라고 이미 적어 두었다.
- CC-170의 업로드 3단(UNE-DOC-001~004)이 본이 된다 — 파일 업로드는 이미 있다.

## 알려진 미결 (ADR-33·34 수용 한계에서 무거운 것)

- **`contextRevision`/`REVISION_CONFLICT`가 없다**(ADR-34 수용 한계 10).
  낡은 화면을 든 두 통제관이 각각 확정하면 **둘 다 성공하고 경고가 없다.**
  남은 것 중 가장 큰 누락이며 화면(SCR-SIT-007)이 붙는 시점에 재판단해야 한다.
- CONFIRM_PREVIEW·확정 예외 승인·MFA 미구현(수용 한계 3·4·11).
- freshness/STALE 경고 없음 — WP-SITUATION-09.
- `conflict_type='SOURCE'`는 도달 불가능(어휘만 남았다).
- Diff는 항상 최신판과만 비교(v1↔v2 불가).
- 동시 확정 경합의 **실행 증거**가 없다(`FOR UPDATE`와 버전 유니크는 있다).
- `payload_sha256`이 wire 바이트가 아니라 정규 직렬화 해시(ADR-33 한계 10).
- 재난유형 어휘를 상황 모듈이 계획 모듈에서 읽는다(ADR-33 한계 11).
- 응답 본문의 런타임 스키마 검증 없음(ADR-33 한계 13).
- **상황 계열 화면이 없다**(SCR-SIT-003~007). CC-170의 슬라이스 UI는 계획서만
  다룬다.
- 새 OPEN 바인딩 **OB-16**: `provider_result.raw_payload_json`과
  `provider_job.request_json`의 보존기간·TTL 없음. 요청 쪽도 위험이 같다 —
  `query`는 사용자가 채우는 객체라 주소·성명이 들어올 수 있고
  `REVOKE UPDATE, DELETE`라 사후 마스킹 경로가 없다.
- 기존 이월(변동 없음): 한/글 열림 증거 없음(OB-08, rhwp 미반입 OB-12),
  XML 1.0 금지 제어문자 미필터, AV 스캔 없음(OB-15), 화면 캡처 CI 미실행,
  SSE 대신 폴링, T3Q SSO 없음(OB-01), IX-*-TENANT 10건,
  UNI_VERIFY_TLS=false POC-local, ADR-32 D17의 미반영 지적 8건.

## Notes

- **설계 원문(docs/design-markdown)은 수정 금지.** 보완은 ADR + work-items로만.
- prettier를 **docs/·contracts/에 실행하지 말 것**. 파일을 지정해 실행한다.
- **소스 파일에 리터럴 NUL을 넣지 말 것.** 이번 세션에 실제로 2바이트가
  들어갔다가 잡았다(구분자를 `|`로 교체). 해시·식별자 구분자는 눈에 보이는
  문자를 쓸 것.
- **JSON Schema 2020-12에서 `allOf` + `additionalProperties:false` 금지**
  (ADR-24 D4). 이번 세션에는 재발하지 않았다.
- 계약 description에 `: `를 쓰면 YAML 스칼라가 깨진다 — 이번에 한 번 밟았다.
  인용하거나 표현을 바꿀 것.
- 게이트를 깨뜨린 뒤 재실행 없이 완료 선언하지 말 것.
