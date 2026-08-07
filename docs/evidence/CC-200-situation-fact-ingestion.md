# CC-200 증거: 상황·후보 SituationFact 수집

- Work Item: **CC-200** Implement Situation and candidate SituationFact ingestion (G3)
- 브랜치: `feature/CC-200`
- 결정 정본: **ADR-33** (`docs/adr/ADR-33-cc200-situation-fact-ingestion.md`)
- 마이그레이션: **0023**(이전 세션 — 격리·어휘·`provider_result`), **0024**(이번 세션 — `updated_at` 트리거)
- 범위 종점: **`situation_fact.status = 'CANDIDATE'`**. 중복군·충돌 해소·SituationSnapshot
  확정(UNE-SIT-009~013)은 CC-210이다.

## 1. 인수기준별 증거

인수기준 네 가지가 각각 어느 테스트로 증명되는지. 모두
`services/api/src/e2e/situation.e2e.test.ts`에서 **실제 마이그레이션된 DB에
런타임 역할 `une_app`(FORCE RLS)으로 HTTP를 지나** 확인한다.

### AC-1. manual / provider facts

| 경로 | 증거 |
|---|---|
| 수동 등록(UNE-SIT-007) | `수동 Fact > 등록하면 CANDIDATE로 남고 상황이 REGISTERED로 올라간다` — `status=CANDIDATE`, `source.providerCode=MANUAL`, `sourceType=USER`, 감사 `FACT_CREATED` + `INCIDENT_REGISTERED` |
| Provider 수집(UNE-SIT-005) | `Provider 수집 > KMA/MOIS 목업에서 후보 Fact를 만들고 Job을 종결 상태로 남긴다` — Job 2건 모두 `SUCCEEDED`, `error=null`, `finishedAt` 존재, 같은 `batchId` |
| 원문 보존 | `Provider 원문을 provider_result에 보존한다` — `payload_sha256` 64자 hex, `item_count>0`, `raw_payload_json.provider='KMA'` |
| 보정(UNE-SIT-008) | `보정은 If-Match를 요구하고 버전을 올리며 before를 감사에 남긴다` |
| 목록(UNE-SIT-014) | `후보 목록(UNE-SIT-014)이 status/factType으로 걸러진다` |
| Job 조회(UNE-SIT-015) | `Job 상태 조회(UNE-SIT-015)가 같은 행을 준다` |

### AC-2. source / timestamps

| 단언 | 증거 |
|---|---|
| 후보마다 출처·조회시각·수집시각 누락 0 | `출처와 시각 > 후보마다 출처·조회시각·수집시각이 누락 없이 붙는다` — 모든 후보에 대해 `source.providerCode`/`sourceName` 비어있지 않고, `source.collectedAt`·`collectedAt`·`observedAt`이 파싱 가능하며 UTC(`Z`)로 나간다 |
| 원천별 provenance 보존 | `Provider마다 출처 행이 따로 생긴다` — `fact_source`가 `['KMA','MOIS']` 두 행으로 갈린다 |

설계 06 US-SIT-005의 완료조건("후보마다 출처·시각·상태 누락 0건")에 대응한다.

### AC-3. normalization

| 갈래 (설계 06 US-SIT-006) | 증거 |
|---|---|
| #1 canonical 변환 | e2e `정규화 > Provider가 준 km/h를 m/s로 옮기고 원문 단위를 남긴다` — `unit='m/s'`, `normalization.outcome='NORMALIZED'`, `originalUnit='km/h'` |
| A-01 변환 불가 → 원문 유지 | e2e `변환 규칙이 없는 단위는 원문을 유지하고 검토 대상으로 표시한다` — 값·단위 그대로, `outcome='ORIGINAL_KEPT'` |
| E-01 필수 누락 → 격리 | e2e `수치 Key에 문자열을 넣으면 422로 격리한다` (`FACT-422-001`) |
| E-02 시각 파싱 실패 → 격리 | e2e `오프셋 없는 발생시각을 거부한다`, 도메인 `TIME_OFFSET_MISSING`/`TIME_UNPARSABLE` 구분 |
| 보정도 같은 규칙 | e2e `3 cm` 보정이 `30 mm`로 저장됨 |
| 관측시각 UTC 이동 | e2e `2026-08-08T09:00:00+09:00` → `2026-08-08T00:00:00.000Z`, `℃` → `degC` |

도메인 단위 증거는 `packages/domain/src/situation/fact-normalization.test.ts`
(24 테스트)에 있다 — 단위 표, 변환 쌍, 격리 사유 6종, 배치 분리.

### AC-4. partial provider failure

| 시나리오 | 증거 |
|---|---|
| 한 Provider만 실패 | `부분 장애 > 한 Provider가 죽어도 200이고 나머지 후보는 남는다` — KMA `FAILED`/`TIMEOUT`/`retriable=true`/`resultCount=0`, MOIS `SUCCEEDED`, `factsCreated>0` |
| 전멸 (E-01) | `모든 Provider가 실패해도 200이며 사용자 입력 경로는 열려 있다` — 전부 `FAILED`, `factsCreated=0`, 이어서 수동 등록 201 |
| 일부 항목만 탈락 | `일부 항목만 정규화에 실패하면 PARTIAL이고 통과분은 남는다` — `PARTIAL`, `resultCount>0`, `error.kind='NORMALIZATION_REJECTED'`, `rejectedCount=1` |
| 비활성 (E-03) | `비활성 Provider는 조용히 건너뛰지 않고 FAILED 행을 남긴다` — SAFEKOREA/NAVER `DISABLED`, T3Q `NOT_CONTRACTED`, 전부 `retriable=false` |
| 플래그 on ≠ 능력 | `플래그를 켜도 어댑터가 없으면 성공한 척하지 않는다` — `NOT_CONTRACTED` |
| 실패도 감사 | `실패도 감사에 남는다` — `PROVIDER_QUERY_FAILED`, `after_json.failureKind='TIMEOUT'` |

0023 §4의 `ck_provider_job_outcome_shape`가 상태와 증거의 짝을 DB에서 강제하므로,
위 상태값들은 애플리케이션 주장이 아니라 **제약을 통과한 사실**이다.

## 2. 구현 중 실측으로 잡은 결함 3건

주장이 아니라 실행해서 드러난 것만 적는다.

### (1) `new Date('2026-02-30')`가 3월 2일로 굴러간다

달력에 없는 날짜를 거부하는 테스트를 쓰자 통과하지 않았다. JS `Date`는 날짜
오버플로를 NaN이 아니라 **다음 달로 롤오버**한다. 관측시각 `2026-02-30`이
조용히 `2026-03-02`로 저장되는 경로였고, 그렇게 저장된 값은 사후에 되돌릴 수
없다(원문과 대조하기 전까지 아무도 모른다).

정규화기가 정규식 캡처로 월·일·시·분·초·오프셋 범위를 **직접 검사**하도록
고쳤다(`normalizeTimestamp`). 윤초(`:60`)와 오프셋 범위(±14:00 초과)도 함께
막는다. 테스트를 낮추지 않고 구현을 고쳤다.

### (2) 0023이 `updated_at` 트리거를 빠뜨렸다

0023은 `situation.updated_at`과 `situation_fact.updated_at`을 추가하면서 이
저장소의 관례인 `trg_<table>_updated_at`을 함께 두지 않았다. 개발 DB 실측:

```
tbl              tgname
plan             trg_plan_updated_at
(situation)      — 없음
(situation_fact) — 없음
```

컬럼만 있고 트리거가 없으면 `DEFAULT now()`가 INSERT 때 한 번 박히고 영원히
그대로다. 두 컬럼의 주석(`'마지막 수정 시각'`, `'마지막 보정 시각 (UNE-SIT-008)'`)이
거짓이 되고, 0023 §1이 컬럼을 넣은 이유("목록의 최근 수정순 근거")도 성립하지
않는다.

0023은 이미 적용됐으므로 고치지 않고 **전진 마이그레이션 0024**로 닫았다
(`.claude/rules/database.md`: 전진 전용). 회귀 단언 둘:
`services/api/src/e2e/situation.e2e.test.ts > 수정이 버전을 올리고 updated_at을
움직인다`, `tests/integration/src/situation-table-rls.test.ts > 0024: updated_at 트리거`.

### (3) SIT-005가 201로 나가고 있었다

계약은 200(자원 생성이 아니라 수집 결과 보고)인데 NestJS의 POST 기본값이 201이라
`@HttpCode(200)` 없이 201이 나갔다. e2e가 잡았고, 계약 테스트가 응답 스키마와
함께 이 결정을 고정한다.

## 3. 계약 동기화

착수 시점에 `Situation`은 `additionalProperties: true` **자리표시자**였다.
어떤 응답이든 통과하므로 예제 게이트(ADR-24)가 아무것도 검증하지 못했다.
CC-160/ADR-31이 `ExportJobResource`에서 같은 문제를 닫으며 남긴 주석이 바로
그 위에 있었다.

| 항목 | 전 | 후 |
|---|---|---|
| `Situation` | `additionalProperties: true` | 12필드 실형태 + `SituationDetail` |
| `SituationFact` / `ProviderJob` / `ProviderQueryJob` | 없음 | 신설(실형태) |
| SIT-002 응답 | 단건 `Situation` | `SituationPageResponse` |
| SIT-003 응답 | `Situation` | `SituationDetailResponse` |
| SIT-005 응답 | `Situation` | `ProviderQueryJobResponse`, 200 |
| SIT-007/008 응답 | `Situation` | `SituationFactResponse` |
| SIT-004/007/008 요청 | `GenericRequest`(무엇이든 통과) | 전용 스키마 3종, `additionalProperties: false`, `required: true` |
| SIT-005 `x-db-tables` | `provider_job` 하나 | 실제로 쓰는 여섯 |
| SIT-014 / SIT-015 | 없음 | 신설(ADR-33 D7) |
| `SituationSnapshot` | 자리표시자 | **자리표시자 유지**(CC-210이 채운다 — 의도적이며 계약 테스트가 고정) |

`pnpm generate:contract-types` **재실행 완료**, 재생성 diff 0. 지난 세션에 이걸
빠뜨려 CI가 15초 만에 잡았던 유형이다.

## 4. 드리프트 방지 게이트

`tests/contract/src/situation.contract.test.ts`가 **0023 SQL 원문을 읽어**
마이그레이션 CHECK · 도메인 상수 · 계약 enum 세 곳을 대조한다. 두 곳만 고치면
INSERT가 23514로 떨어지거나 계약이 만들 수 없는 값을 약속하는데, 그 상태를
테스트가 먼저 잡는다.

대조 대상: `ck_situation_status`(8) · `ck_situation_mode`(2) ·
`ck_situation_fact_status`(3) · `ck_fact_source_provider_code`(7, `provider_job`
쪽과도 일치) · `ck_provider_job_status`(3, QUEUED/RUNNING 부재) ·
Fact 범주 6종(설계 01 §20.5) · `factKey` 패턴(situation-fact.schema.json).

`tests/contract/src/file-upload.contract.test.ts`의 x-db-tables 게이트 하한을
31 → **40**으로 올렸다(CC-200이 9건을 더했다). 구현 API 목록은 컨트롤러 주석에서
유도되므로, 하한이 곧 "유도가 살아 있다"는 증거다.

## 5. 테넌트 격리

`tests/integration/src/situation-table-rls.test.ts` — **0023 §5 주석이 이미 이
파일명을 참조하고 있었다.** 착수 시점 실측으로 `situation`만 RLS가 켜져 있었고
나머지 여섯은 정책이 **한 번도 없었다**. 0011이 `une_app`에 전 테이블 DML을
일괄 부여하므로 정책 없는 테이블 = 전 테넌트 공개였다.

검증 갈래:

- 일곱 테이블 모두 `relrowsecurity` + `relforcerowsecurity`
- 테이블마다 정책 1개 이상
- 읽기 격리 — 다른 기관 행 8종 전부 0건
- **정책이 vacuous하지 않음** — 자기 기관 행은 보인다(4종 각 1건)
- 테넌트 스코프 없으면 0건
- 쓰기 격리(WITH CHECK) 3종 — 다른 기관 `tenant_id`로 출처 생성, 다른 기관
  상황에 Fact 주입, 다른 기관 Job에 원문 첨부
- 불변 — `une_app`이 `provider_job`/`provider_result`를 UPDATE/DELETE 불가,
  `situation_fact` DELETE 불가(거부는 `REJECTED`이지 삭제가 아니다),
  단 `situation_fact` UPDATE는 가능(UNE-SIT-008 보정)
- **워커 차단** — `une_worker`가 일곱 테이블 전부에 42501(ADR-33 D2: 수집은
  동기 경로이며 워커는 닿지 않는다)

## 6. 게이트 (단일 `pnpm test`, exit 0 · skip 0)

### 재현 절차

수치를 인용하기 전에 **분모**(`Test Files N passed (N)`)를 확인할 것. 아래
환경변수가 없으면 통합·e2e가 **조용히 skip되고 exit 0**이 된다.

```bash
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- docker ps      # 컨테이너 기동 확인
set -a; . ./infrastructure/.env; set +a
export DATABASE_URL="postgres://$UNE_DB_USER:$UNE_DB_PASSWORD@127.0.0.1:$UNE_DB_PORT/$UNE_DB_NAME"
export OBJECT_STORAGE_ENDPOINT="http://127.0.0.1:$UNE_MINIO_API_PORT"
export OBJECT_STORAGE_BUCKET="$UNE_MINIO_BUCKET"
export OBJECT_STORAGE_ACCESS_KEY="$UNE_STORAGE_ACCESS_KEY"
export OBJECT_STORAGE_SECRET_KEY="$UNE_STORAGE_SECRET_KEY"
pnpm db:migrate && pnpm -r build && pnpm test
```

### 수치 (트리를 얼린 뒤 이중 리뷰 반영 완료 상태에서 재실행)

| 워크스페이스 | Test Files | Tests | CC-200 증분 |
|---|---|---|---|
| @une/hwpx-engine | 23 | 426 | — |
| @une/api | 25 | **339** | +1 파일 / +54 |
| @une/contract-tests | 13 | **222** | +1 / +27 |
| @une/provider-adapters | 14 | **162** | +1 / +24 |
| @une/db-integration | 12 | **141** | +1 / +14 |
| @une/domain | 12 | **101** | +2 / +39 |
| @une/worker | 5 | 44 | — |
| @une/e2e | 2 | 13 | — |
| @une/web / @une/field-web | 3 / 1 | 28 / 1 | — |

`build` `typecheck` `lint` `format:check` PASS.
`validate:contracts` `validate:intake` `validate:handoff` PASS.
**계약 타입 재생성 diff 0** — 계약을 마지막으로 고친 뒤 재생성해 확인했다
(md5 대조). 마이그레이션 **24개**, 테이블 **62 유지**, 데이터 사전 62/587 재생성.
계약 예제 **31건**이 전부 자기 스키마를 통과한다(응답 예제 3건 포함).

설계 원문(`docs/design-markdown/`)·전사본·rhwp upstream 무변경(`git status` 0건).

### 게이트 실패를 두 번 겪었고 둘 다 코드가 아니었다

다음 사람이 같은 증상을 코드 결함으로 오독하지 않도록 관측된 그대로 적는다.

1. **컨테이너 종료.** 이 세션의 첫 전량 실행이 exit 1이었고 워커 e2e가
   `terminating connection due to administrator command` /
   `the database system is shutting down`으로 죽었다. WSL keepalive가 만료돼
   Postgres 컨테이너가 내려간 것이다. `docker ps` 한 번으로 복구됐다.
2. **실행 중 편집.** QA 리뷰어의 첫 전량 실행은 다른 이유로 exit 1이었다 —
   내가 같은 시각에 `provider-query.service.ts`를 고치고 있어서 vitest가
   import보다 사용이 먼저 저장된 순간을 읽었다(`ReferenceError:
   canCollectFacts is not defined`). **실행 중인 트리는 유효한 증거가 아니다.**
   위 수치는 모든 편집을 끝낸 뒤 얼린 트리에서 한 번에 얻었다.

## 7. 이중 리뷰 (병렬, opus)

초기 판정: **아키텍처 1 BLOCKER / 6 MAJOR / 8 MINOR**, **QA PASS WITH
CONDITIONS**(필수 5 / 권고 6). 전건 당일 반영했다.

두 리뷰가 **독립적으로 같은 것 두 개**를 지목했다 — 응답 스키마가
`additionalProperties` 미설정이라 계약 테스트의 `.not.toBe(true)`가 아무것도
막지 못한다는 것, 그리고 오류코드가 설계와 다른 뜻으로 쓰인다는 것.

### 실질 결함 (코드를 고쳤다)

| # | 지적 | 실제 증상 |
|---|---|---|
| M-1 | 컨트롤러가 시각 검사 규칙의 **두 번째 사본**을 들고 있었고 그 사본에 달력 검사가 없었다 | `occurredAt: '2026-02-30T00:00:00Z'` → 201, `2026-03-02`로 저장. `observedAt`은 도메인이 뒤에서 걸렀지만 `occurredAt`은 정규화를 지나는 경로가 없었다. 사본을 지우고 도메인 `normalizeTimestamp` 하나만 쓴다 |
| M-2 | `Promise.all` + 무보호 `adapter.collect` | 한 어댑터가 **던지면** 배치 전체가 무너져 이미 받은 다른 Provider의 원문·후보가 버려지고 `provider_job` 행이 하나도 안 남는다 — D10·D11이 동시에 깨진다. 경계에서 봉인 |
| M-3 | 시험 훅이 **운영 요청 경로**에 있었다 | `query.mockScenario`를 무조건 해석했고 계약이 그 필드를 문서화했다. `SITUATION_PROVIDERS` 토큰 주입 + `scenariosEnabled`(기본 off)로 옮기고 계약 문구 제거(D19) |
| M-4 | 400에 설계가 다른 뜻으로 정의한 코드 | `PROV-503-001`("Provider 장애")·`FACT-422-001`(정규화 격리)을 형식 오류에 재사용했다. `PROV-400-001`/`FACT-400-001` 신설(D17) |
| M-6 | 단위 미상을 **추측**하고 `NORMALIZED`로 냈다 | 화씨 77 → "정규화 성공, 77 degC", 검토 신호 0. D9(추측하지 않는다)와 반대이고 정보가 더 적은 경우가 더 높게 판정됐다. `UNIT_MISSING` + `ORIGINAL_KEPT`(D18) |
| m-1 | `findFactKeySpec`이 `factType`을 무시 | `FIELD_REPORT.text`(자유 서술)가 `DISASTER_MESSAGE.text`의 `string` 제약에 걸려 객체 값이 422로 격리됐다. (범주, Key) 쌍 조회로 변경 |
| m-3 | 수집 경로 TOCTOU | 리뷰 전에 자체 발견해 이미 닫아 두었다 — 쓰기 트랜잭션에서 `FOR UPDATE`로 재확인, 412면 전체 롤백 |
| R-3 | **타임아웃이 하나도 없었다** | 동기 경로라 느린 Provider 하나가 요청을 무기한 붙잡는다. Provider당 제한시간(`UNE_SITUATION_PROVIDER_TIMEOUT_MS`, 기본 10초) 도입 |
| m-4 | SIT-005만 알 수 없는 키를 흘려보냄 | 계약·구현 양쪽에서 닫음 |
| R-6 | SIT-014 질의 오류가 `SIT-5002`("상황 목록 조건") | `FACT-400-001`로 교정 |

### 게이트를 세웠다 (같은 결함이 다시 통과하지 못하도록)

- **F-3**: `PROV-503-001 → PROV-400-001` 재명명이 **테스트 0건 실패로
  통과했다.** 어떤 테스트도 SIT 계열 400 코드를 단언하지 않았기 때문이다.
  `situation-errors.ts` 소스에서 코드를 뽑아 계약 `x-error-codes`와 대조하는
  게이트를 세웠다(CC-150의 `DOC-*` 선례). 경로 파라미터가 있는 구현 API는
  `COM-0400`을, 멱등 API는 `COM-0409`를 선언해야 통과한다.
- **R-1/R-2**: 응답 스키마 7종을 `additionalProperties: false`로 닫고,
  계약 테스트 단언을 `.not.toBe(true)` → `.toBe(false)`로 올렸다(전자는
  **키가 없어도 통과**한다). SIT-001/005/007에 **응답 예제**를 넣어 예제
  게이트가 실제로 형태를 검사하게 했다.
- **M-5**: `SituationCreateRequest`가 세 곳에서 구현과 어긋나 있었다 —
  클라이언트가 쓰는 `locationText`가 계약에 없고, `additionalProperties`가
  열려 있어 계약이 허용하는 요청을 구현이 400으로 막고, 3.1 문서에 3.0 문법
  `nullable: true`가 남아 `occurredAt: null`이 스키마 위반이었다. 셋 다 닫고
  계약 테스트의 strict 검사 대상에 SIT-001·SIT-005를 추가했다.

### F-4: 비어 있던 테스팅 규칙 축 6개를 채웠다

Fact 동시 보정 충돌(409 `FACT-409-001`) · 권한 거부 403 5경로 + SIT-004 ·
잘못된 UUID 400 `COM-0400` 3경로 · **SIT-005 멱등 재전송**(같은 키로 두 번
불러도 Job 1건·후보 두 벌 아님 — 수용 한계 7이 "중복 억제가 멱등키뿐"이라
적었으므로 그 멱등키가 듣는지가 증명돼 있어야 한다) · 종결 상황 + 수동
Fact 412 · 빈 목록과 페이지 끝(총계는 참으로 유지).

## 8. 덮지 않은 경로 (명시)

"덮은 척"보다 낫다.

- **응답 본문의 런타임 스키마 검증**이 없다. 계약 예제는 게이트가 검사하지만
  실제 응답은 e2e의 수작업 필드 단언이 대신한다(ADR-33 수용 한계 13).
- **타임아웃 초과 경로의 실행 증거**가 없다. 목업이 즉시 끝나므로 10초를
  기다리게 만들 수 없고, 설정 기본값만 단위 테스트로 고정했다.
- **어댑터가 던지는 경로(M-2)의 실행 증거**가 없다. 목업은 던지지 않는다.
  주입 이음매(D19)가 생겼으므로 실 어댑터 시점에 대체 어댑터로 검증 가능하다.
- **동시성**은 낙관잠금(409)까지만 덮었다. 두 요청을 실제로 동시에 던지는
  경합 테스트는 없다.
- **CC-210 소유 경로**(중복군·충돌·Snapshot 확정)는 애초에 범위 밖이다.

## 9. 오류코드 최종 표 (구현 emit ↔ 계약 `x-error-codes`)

이번에 실제로 드리프트가 났던 자리라 표로 남긴다. 이 대조는
`tests/contract/src/situation.contract.test.ts`가 매 실행 검사한다.

| API | 반환 코드 |
|---|---|
| SIT-001 | `SIT-5001`(400) · `COM-0400` · `COM-0409` |
| SIT-002 | `SIT-5002`(400) |
| SIT-003 | `SIT-404-001` · `COM-0400` |
| SIT-004 | `SIT-5001` · `SIT-404-001` · `SIT-409-001` · `SIT-412-001` · `COM-0428` · `COM-0400` · `COM-0409` |
| SIT-005 | `PROV-400-001` · `SIT-404-001` · `SIT-412-001` · `COM-0400` · `COM-0409` |
| SIT-007 | `FACT-400-001` · `FACT-422-001` · `SIT-404-001` · `SIT-412-001` · `COM-0400` · `COM-0409` |
| SIT-008 | `FACT-400-001` · `FACT-404-001` · `FACT-409-001` · `FACT-412-001` · `FACT-422-001` · `COM-0428` · `COM-0400` · `COM-0409` |
| SIT-014 | `FACT-400-001` · `FACT-404-001` · `COM-0400` |
| SIT-015 | `PROV-404-001` · `COM-0400` |

**`PROV-503-001`은 어디에도 없다.** 설계 10 오류표는 "상황 Provider 장애 /
부분결과·수동"으로 정의하지만 Provider 장애는 200 + `jobs[].status='FAILED'`
이므로(D11) 이 코드가 나갈 자리가 없다. 계약 테스트가 그 부재를 단언한다.

## 10. 알려진 한계 (ADR-33 수용 한계 요약)

전문은 ADR-33에 있다(13건). 요약:

1. SSE(UNE-SIT-006) 미구현 — SIT-015 폴링으로 대체, 계약에는 남겨 둠
2. 실 Provider가 붙으면 SIT-005 응답이 느려짐(동기 수집). **제한시간은 있다**
   (Provider당 기본 10초); 없는 것은 재시도·백오프·서킷브레이커·레이트리밋
3. KMA/MOIS는 **목업** — `health().mode`가 항상 `MOCK`, 어댑터 단위 테스트가
   고정. 다만 상황 Provider는 T3Q 전용 capability 레지스트리에 등재되지 않음
4. `provider_result` **와 `provider_job.request_json`** 보존기간·TTL 없음 →
   **OB-16 신설**
5. freshness/TTL(CURRENT/AGING/STALE) 미계산 — WP-SITUATION-09
6. `SituationDetail.currentSnapshot` 미제공(id까지만) — CC-210
7. 중복 수집 억제가 멱등키뿐 — 중복군은 CC-210 (멱등키가 실제로 듣는 것은 e2e로 증명)
8. SIT-005 `x-db-tables`가 설계 10 표보다 넓음(계약을 구현에 맞춤)
9. 자동저장·초안 개념 없음 — `situation.version_no`로만 구현
10. `payload_sha256`이 wire 바이트가 아니라 정규 직렬화 해시 — LIVE 어댑터 시점에 교정
11. 재난유형 어휘를 상황 모듈이 계획 모듈에서 읽음(정본은 스키마) — 이동은 다음 항목
12. **보정이 원천 표기를 덮는다** — 원천 Fact 불변 + 파생 Fact는 CC-210 결정 공간
13. 응답 본문의 런타임 스키마 검증 없음 — 계약 예제와 e2e 필드 단언으로 대체

`SituationDetail.openConflictCount`는 CC-200에서 항상 0이다. 이것은 "충돌이
없다"가 아니라 **"충돌을 계산하는 경로가 아직 없다"**이며, 그 사실을 코드 주석과
ADR 양쪽에 남겼다.
