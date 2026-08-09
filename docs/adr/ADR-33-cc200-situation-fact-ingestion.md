# ADR-33: CC-200 상황·후보 SituationFact 수집 — 동기 Provider 경로와 정규화

- 상태: ACCEPTED (2026-08-08, CC-200)
- 관련: 설계 01 §20.4~20.5(표준 SituationContext·필수 Fact 범주),
  설계 06 §7.1·US-SIT-003~006(상태기계·수집·정규화 시나리오),
  설계 10 SIT 표(UNE-SIT-001~009), ADR v1.1 §4.4~4.7(SituationProviderPort·G11 게이트),
  `contracts/schemas/situation-fact.schema.json`,
  마이그레이션 **0023**(격리·어휘·`provider_result`)과 **0024**(updated_at 트리거),
  `.claude/rules/{architecture,backend,database,provider-adapters,security,testing}.md`
- 범위: 상황 CRUD, Provider 수집, 후보 Fact 등록·보정·조회까지.
  **`status=CANDIDATE`가 종점이다.** 중복군·충돌 해소·SituationSnapshot 확정
  (UNE-SIT-009~013)은 CC-210이다.
- 선행: 0023은 이전 세션에서 이미 적용됐다. 이 ADR은 그 마이그레이션의 주석이
  **이미 참조하고 있던** D2/D3/D4/D6을 뒤늦게 문서화하고, 구현 단계에서 새로
  내린 결정을 더한 것이다.

## 배경: 0023의 참조가 매달려 있었고, 계약은 아무것도 검증하지 못했다

착수 시점의 상태는 두 가지였다.

**첫째, ADR이 없는데 마이그레이션이 그것을 인용하고 있었다.** 0023의 §4·§8
주석이 "ADR-33 D2", "ADR-33 수용 한계"를 가리키는데 파일이 없었다. 결정의
근거를 읽을 수 없으니 다음 사람이 그 제약을 왜 그렇게 뒀는지 알 수 없다.

**둘째, `Situation` 스키마가 `additionalProperties: true` 자리표시자였다.**
어떤 응답이든 통과하므로 예제 게이트(ADR-24)가 아무것도 검증하지 못한다.
CC-160/ADR-31이 `ExportJobResource`에서 같은 문제를 닫으며 남긴 주석이 바로
그 위에 있었다. 게다가 SIT-002 응답이 `Page<Situation>`이어야 하는데 단건
`Situation`을 가리켰고, SIT-004/007/008은 `GenericRequest`(무엇이든 통과)였다.

---

## D1. 상황 상태는 설계 06 §7.1을 DB CHECK로 굳힌다

**결정**: `situation.mode`/`status`에 CHECK를 걸고, 어휘를 계약 enum·도메인
상수와 문자 그대로 같게 유지한다. 실제로 CC-200이 만드는 값은 `DRAFT`와
`REGISTERED` 둘뿐이지만 여덟 값을 모두 넣는다.

**근거**: 컬럼에 주석만 있고 제약이 없었다. 주석은 오타를 막지 못한다.
어휘를 나눠서 넓히면 그 사이의 CHECK가 설계와 어긋난 채로 남는다.

**실측 근거**: CHECK를 걸자마자 **CC-004 픽스처가 설계 어디에도 없는
`mode='ACTUAL'`, `status='OPEN'`을 쓰고 있던 것**이 드러났다. 픽스처를 설계에
맞췄다(0023 §1, `tests/integration/src/db-helpers.ts`).

**보강(구현 단계)**: 세 곳(마이그레이션 CHECK / 도메인 상수 / 계약 enum)이
갈라지지 않도록 계약 테스트가 **0023 SQL 원문을 읽어** 셋을 대조한다
(`tests/contract/src/situation.contract.test.ts`).

## D2. Provider 수집은 **동기**다

**결정**: UNE-SIT-005는 요청 안에서 Provider를 부르고, 결과를 기록하고,
**이미 종결된** Job들을 돌려준다. `provider_job.status`는 `SUCCEEDED`/`PARTIAL`/
`FAILED` 셋뿐이고 `QUEUED`/`RUNNING`은 없다. `finished_at`은 NOT NULL이다.

**근거**: 사용자 결정(2026-08-07). 지금 어댑터가 **전부 목업**이므로 비동기로
만들면 큐·리스·폴링이 실제로는 아무것도 기다리지 않는 장치가 된다. 0022 §1이
세운 "도달 가능한 상태만 넣는다" 원칙과 같은 선이다 — 관측되지 않는 상태를
어휘에 넣으면 그 값을 다루는 코드가 영원히 죽은 코드로 남는다.

**트랜잭션 경계**(구현 단계에서 확정):

1. 짧은 읽기 트랜잭션 — 상황이 있고 열려 있는지 확인
2. **트랜잭션 밖** — Provider 병렬 호출 (`.claude/rules/backend.md`:
   "External calls run outside long database transactions")
3. 한 쓰기 트랜잭션 — Job·원문·출처·Fact·상태전이·감사를 함께 기록

**대가**: 실 Provider가 붙으면 응답이 느려진다. 수용 한계 1·2에 남긴다.

**따름정리 (2026-08-09 개정)**: 이것은 **롤 권한 경계**다 — `une_worker`에
권한을 주지 않았고 그 상태 자체를 회귀 단언으로 고정한다
(`tests/integration/src/situation-table-rls.test.ts`). 개정 전 문장은 "워커는
이 테이블들에 닿지 않는다"였는데, 그것을 **프로세스 경계**로 읽으면 이제
거짓이다: 워커 프로세스가 0026이 만든 전용 롤 `une_retention`으로 보존기간
마스킹을 수행한다(수용 한계 4, OB-16). 전용 롤을 따로 둔 이유가 바로 이
경계를 넓히지 않기 위해서다 — `une_worker`의 42501은 그대로다.

여전히 참인 것: 상황 수집·Fact 생성·상태전이는 워커에 없다. 보존 정리는
도메인 로직이 아니라 데이터 수명 관리이며 Fact를 만들지도, 상황을 옮기지도,
Provider를 부르지도 않는다.

## D3. 격리는 부모 경유가 기본이고, 두 테이블만 tenant_id를 직접 세운다

**결정**: `situation_fact`/`provider_result`/`fact_conflict`/
`conflict_resolution`/`situation_snapshot`은 부모 EXISTS 조인으로,
**`fact_source`와 `provider_job`은 `tenant_id` 컬럼**으로 테넌트를 증명한다.

**근거**: 예외 둘에는 각각 이유가 있다.

- `fact_source`는 상황 계열에서 **유일하게 부모 애그리거트가 없다**. 상황을
  참조하지 않고 `situation_fact`가 이쪽을 참조한다. `situation_fact`를 거쳐
  조인하는 안은 **아직 어떤 fact도 참조하지 않는 source 행**(수집 직후,
  정규화 실패로 fact가 하나도 안 생긴 경우)을 모든 테넌트에 노출한다 —
  fail-open이라 채택하지 않았다. 0018이 경계한 "비정규화 사본"이 아니다:
  사본이 되려면 원본이 있어야 하는데 이 테이블에는 테넌트를 증명할 다른 경로가
  애초에 없다. **이것이 원본이다.**
- `provider_job.situation_id`는 **nullable**이다(0004). UNE-KNOW-002/003이
  상황 없는 UNI 학습 Job에 같은 테이블을 쓴다. 상황 경유 정책은 그 정당한
  행들을 **전부 막는다** — fail-open이 아니라 fail-closed라서 더 나쁘다.

**실측 근거**: 착수 시점에 `situation`만 RLS가 켜져 있었고 나머지 여섯은
정책이 **한 번도 없었다**. 0011이 `une_app`에 전 테이블 DML을 일괄 부여하므로
정책 없는 테이블 = 전 테넌트 공개였다.

## D4. `provider_result`를 신설한다 — 계약이 가리키던 유령 테이블

**결정**: `provider_result`(테이블 61 → 62)를 만든다. 원문 응답·SHA-256·항목
수를 보존하고 `une_app`에서 UPDATE/DELETE를 회수한다.

**근거**: 계약 UNE-SIT-006의 `x-db-tables`가 **존재하지 않는 이 이름**을
가리키고 있었다. CC-170의 `malware_scan`과 같은 드리프트지만 **결론은
반대다** — 그쪽은 검사기가 없어 테이블을 만들지 않고 계약을 고쳤고, 이쪽은
"External provider payloads … are retained as raw payloads for traceability"가
CLAUDE.md의 **비협상 도메인 규칙**이므로 테이블을 만드는 것이 정답이다.
원문을 어디에도 두지 않으면 그 규칙이 열린 채로 남는다.

**따름정리**: 어댑터가 정규화한 결과만 남기면 정규화 로직의 버그를 사후에
증명할 수 없다. 그래서 **실패했을 때도 원문이 있으면 남긴다** — 파서 변경
(`PARSER_CHANGED`) 진단이 그것으로 이뤄진다.

## D5. 표준 Key는 소문자다 — 설계 표기와 스키마 패턴의 충돌

**결정**: 설계 01 §20.5의 대표 필드명은 camelCase(`windSpeed`, `rainfall1h`)
인데 표준 Key는 `wind_speed`, `rainfall_1h`로 쓴다. 대응표를
`FACT_KEY_CATALOG`의 `designField`에 남긴다.

**근거**: 승인된 `situation-fact.schema.json`의 `factKey` 패턴이
`^[a-z][a-z0-9_.-]{1,99}$`라 **대문자를 허용하지 않는다**. 소스오브트루스
우선순위에서 JSON Schema는 4위, 설계 01(마스터 v0.9)은 7위다. 스키마를
따르고 표기 대응을 잃지 않도록 카탈로그에 남긴다 — 새 Key를 지어낸 것이
아니라 표기만 옮겼다.

**따름정리**: 카탈로그는 **닫힌 집합이 아니다**. 설계가 "대표 필드"라고 적었지
전수라고 적지 않았고, FIELD_REPORT·USER_ASSERTED는 애초에 열린 어휘다.
카탈로그 밖의 Key도 패턴만 맞으면 받되 단위 정규화의 근거가 없으므로
결과를 `ORIGINAL_KEPT`로 낮춘다.

## D6. 중복군·충돌·Snapshot은 CC-210으로 넘긴다

**결정**: `situation_fact`에 중복 억제 유니크 키를 만들지 않는다.
`fact_duplicate_group` 테이블(UNE-SIT-009 `x-db-tables`)도 만들지 않는다.
`fact_conflict`/`conflict_resolution`/`situation_snapshot`은 **격리만** 미리
닫는다.

**근거**: 중복군의 형태를 정하는 것은 계산 전략을 쥔 CC-210이다. 지금
`(situation, key, source, observed_at)` 같은 키를 박으면 CC-210이 선택할 수
있는 전략을 미리 잘라낸다. 빈 테이블에 추측한 컬럼을 남기는 것도 같은 문제다.
격리를 미리 닫는 것은 다른 종류의 일이다 — 테이블이 이미 있고 0011의 일괄
GRANT로 **권한이 이미 열려 있으므로**, 쓰기 경로가 생기기 전에 닫는 것이 맞다
(0018이 `export_job`에 한 것과 같다).

**대가**: 계약의 `fact_duplicate_group` 드리프트는 열린 채로 CC-210에 넘어간다.
`SituationDetail.openConflictCount`는 CC-200에서 항상 0이며, 이것은
"충돌이 없다"가 아니라 **"충돌을 계산하는 경로가 아직 없다"**이다.

## D7. 계약 공백 두 곳을 CC-200에서 닫는다 (UNE-SIT-014 / UNE-SIT-015)

**결정**: `GET /situations/{id}/facts`(SIT-014)와 `GET /provider-jobs/{jobId}`
(SIT-015)를 신설한다. 오류 코드는 `FACT-404-001`/`PROV-404-001`로 기존
표기(`<도메인>-<HTTP>-<일련>`)를 따른다.

**근거**: 설계 10의 SIT 표에는 후보 Fact를 **읽는** API가 없다. 그런데
SIT-008(보정)이 `factId`를 요구하므로, SIT-014가 없으면 사용자가 그 id를 얻을
방법이 수집 응답을 붙잡아 두는 것뿐이다 — SCR-SIT-005 후보검토 화면이 성립하지
않는다. SIT-015는 SSE(SIT-006)의 폴링 대체이며 CC-170이 UNE-PLAN-011에서 같은
선택을 한 선례를 따른다.

**경계**: 새 테이블도 새 권한도 만들지 않았다. 둘 다 `SITUATION_READ`를 쓴다.
SSE 자체는 계약에서 지우지 않는다 — 비동기로 옮길 때 여는 자리이고, 지우면
그 사실이 사라진다.

## D8. 정규화는 값을 바꾸지 **판정하지 않는다**

**결정**: 정규화 결과를 세 갈래 판별 유니온으로 둔다 — `NORMALIZED`(변환 성공),
`ORIGINAL_KEPT`(변환 불가, 원문 유지 + 검토 필요), `INVALID`(격리). 원문은
세 경우 모두 결과에 실려 나온다. confidence는 계산하지 않고 후보를
채택/기각하지 않는다.

**근거**: 설계 06 US-SIT-006이 결과를 정확히 그 셋으로 나눠 뒀다(#1 / A-01 /
E-01·E-02). 완료조건이 "원천 provenance 손실 0건, 자동삭제 0건"이고 격리조차
"후보 격리·원문 보기 제공"이지 폐기가 아니다. 자동 확정을 하지 않는 것은
US-SIT-005 #3의 "점수 자동확정에 사용 금지"와 CLAUDE.md의 "LLM output is never
an authoritative fact source"가 같은 선에 있기 때문이다.

**따름정리**: 수동 입력(SIT-007)도 Provider 수집과 **같은 정규화기를 지난다**.
사용자가 넣은 값이라고 해서 단위가 canonical이라는 보장이 없고, 두 경로가 다른
규칙을 쓰면 같은 사실이 출처에 따라 다른 값으로 저장된다. 보정(SIT-008)도
같다 — 실제로 `3 cm` 보정이 `30 mm`로 저장되는 것을 E2E가 고정한다.

## D9. 시각은 명시적 오프셋을 요구하고, 없으면 추측하지 않고 격리한다

**결정**: 관측시각·발생시각은 ISO-8601에 오프셋(또는 `Z`)이 있어야 받는다.
오프셋 없는 `2026-08-08T09:00:00`은 `TIME_OFFSET_MISSING`으로 격리하고,
읽을 수 없는 값은 `TIME_UNPARSABLE`로 구분한다.

**근거**: 오프셋이 없으면 KST일 수도 UTC일 수도 있고, 어느 쪽으로 추측해도
**9시간 어긋난 사실이 감사에 남는다.** `.claude/rules/backend.md`가 "ISO-8601
with explicit offset"을 요구하는 자리이고, 설계 06 E-02가 파싱 실패를 폐기가
아니라 **격리**로 처리하라고 정해 뒀다.

**구현 중 실측으로 잡은 것**: `new Date('2026-02-30T00:00:00Z')`는 NaN이
아니라 **3월 2일로 굴러간다.** 존재하지 않는 관측시각이 조용히 사실로
저장되는 경로였다. 구성요소(월·일·시·분·초·오프셋 범위)를 직접 검사하도록
고쳤다(`normalizeTimestamp`).

## D10. 비활성·미계약·실패를 구분하고, 셋 다 행을 남긴다

**결정**: Provider 실패를 여덟 갈래로 나눈다 — `TIMEOUT`, `UNAUTHORIZED`,
`RATE_LIMITED`, `UPSTREAM_ERROR`, `PARSER_CHANGED`, `NO_DATA`, **`DISABLED`**,
**`NOT_CONTRACTED`**. 어느 갈래든 `provider_job`에 `FAILED` 행을 남긴다.

**근거**: 셋을 한 덩어리로 "실패"라고 부르면 화면이 사용자에게 무엇을 하라고
말할지 정할 수 없다. 설계 06 US-SIT-004 E-03이 "Feature Flag 안내"라는
**구체적 복구 동작**을 요구한다.

- `DISABLED` — 어댑터는 있는데 기능 플래그가 꺼져 있다. SafeKorea/Naver가
  여기이며 **법적·운영 승인 전**이라 기본값이 off다(OB-05).
- `NOT_CONTRACTED` — 플래그를 켜도 부를 곳이 없다. T3Q 상황 API가 여기다
  (OB-02, ADR §4.5 G11-1의 "실패 시 DISABLED 유지").

**조용히 건너뛰지 않는 이유**: 건너뛰면 사용자는 자기가 고른 Provider가
무시된 것을 알 수 없다. `retriable`을 갈래마다 고정하는 것도 G11-4의
"재시도 여부 명확" 요구다.

**따름정리**: SafeKorea/Naver는 **플래그를 켜도** `NOT_CONTRACTED`로 답한다.
웹 수집기는 설계 01 §20.3이 "서버측 Collector가 낮은 빈도로 수집·캐시"하라고
정한 별도 구성요소이고 CC-200 범위가 아니다. 플래그가 켜졌다는 사실만으로
능력이 생기지 않는다.

## D11. 부분 장애는 200이다

**결정**: Provider 일부가 실패해도, **전부 실패해도** UNE-SIT-005는 200이고
개별 결과는 `jobs[].status`에 있다. 503은 요청 자체를 처리하지 못한 경우에만
쓴다.

**근거**: 설계 06 US-SIT-005의 목적이 "부분장애가 전체 흐름을 막지 않게
한다"이고, E-01(모든 Provider 실패)조차 "사용자 입력만으로 계속 가능"이다.
ADR §4.7의 인수기준도 "외부 Provider 전부를 비활성화한 상태에서 사용자
입력만으로 SituationSnapshot을 확정할 수 있다"이다.

**상관식**: 0023 §4의 `ck_provider_job_outcome_shape`가 상태와 증거의 짝을
DB에서 강제한다 — `SUCCEEDED`면 `error_json IS NULL`, `PARTIAL`이면 non-null
이고 `result_count > 0`, `FAILED`면 non-null이고 `result_count = 0`. 이것이
없으면 "성공인데 오류가 있고 결과가 0건인" 행이 감사에 남고, 그 행을 읽는
코드는 무엇을 믿어야 할지 알 수 없다. **응답은 왔지만 통과 항목이 0인 경우도
`FAILED`다** — 상관식이 그렇게 강제하고, 그것이 0023 §4의 의도다.

## D12. 사용자는 Provider를 사칭할 수 없다

**결정**: UNE-SIT-007 요청은 `providerCode`/`sourceType`을 받지 않는다.
서버가 `MANUAL`/`USER`로 고정한다. 요청에 그 필드가 오면 400이다.

**근거**: 요청이 출처 종류를 고를 수 있으면 사용자가 "기상청이 준 사실"을
직접 만들 수 있다. 확정되면 SituationSnapshot을 거쳐 계획서·일지의 사실 셀이
되므로(CLAUDE.md 비협상 규칙) 출처의 진위는 값의 진위와 같은 등급이다.

## D13. `situation_fact.value_json`은 봉투다

**결정**: `{ value, unit, normalization: {version, outcome, originalValue,
originalUnit, notes}, raw }` 형태로 저장하고, 계약 응답에는 `value`/`unit`/
`normalization`만 투영한다. **`raw`는 저장하되 응답에 싣지 않는다.**

**근거**: 계약의 `SituationFact`는 `value`/`unit`을 최상위에 두는데 DB에는
jsonb 한 칸뿐이다. 새 컬럼을 만들지 않은 것은 0004의 열린 컬럼이 이미 그
자리이기 때문이다. `raw`를 응답에서 빼는 것은 추적성은 지키되 화면·로그로
나가는 개인정보를 늘리지 않기 위해서다(`.claude/rules/security.md`의 최소화).
A-01이 요구하는 원문값 확인은 `normalization.originalValue`로 충분하다.

## D14. ADR §4.4의 후보 필드 일부는 컬럼으로 만들지 않는다

**결정**: `SituationFactCandidate`의 `severity`·`location`·`freshness`·
`reliability`·`expiresAt`은 `situation_fact`의 컬럼이 되지 않는다. 어댑터는
응답 **원문 전체**를 `rawPayload`로 돌려주고 API가 `provider_result`에
보존한다.

**근거**: 두 가지를 하지 않기 위해서다. 컬럼을 지어내지 않는다 — freshness/TTL은
WBS의 별도 항목(WP-SITUATION-09)이고 CC-200 인수기준에 없다. 그 값들을 버리지도
않는다 — 원문에 살아 있으므로 **색인되지 않을 뿐 사라지지 않는다.**

**따름정리**: 그래서 포트는 **정규화 전 중립 항목**을 돌려준다. 정규화는
도메인(`@une/domain`)이 하고 어댑터는 하지 않는다 — 같은 규칙이 수동 입력에도
걸려야 하기 때문이다(D8).

## D15. SituationContext 상태는 컬럼이 아니라 파생값이다

**결정**: 설계 06 §7.1의 두 번째 상태기계(DRAFT → PROVIDER_QUERYING →
CANDIDATE_REVIEW → CONFLICT_OPEN → USER_CONFIRMED)를 컬럼으로 만들지 않고
`deriveContextState(candidateFactCount, openConflictCount, currentSnapshotId)`로
계산한다.

**근거**: 동기 수집에서 `PROVIDER_QUERYING`은 관측 가능한 상태가 아니고
(요청 안에서 시작해 끝난다), 나머지 넷은 전부 파생 가능하다. 저장하면
파생값과 저장값이 갈라지고, 갈라지면 **어느 쪽이 사실인지 답할 수 없다.**

**재평가 시점**: 비동기로 옮길 때 `PROVIDER_QUERYING`이 실재하게 되며 그때
다시 판단한다. 도메인 단위 테스트가 "어떤 입력 조합으로도 PROVIDER_QUERYING이
나오지 않는다"를 고정해 두었으므로, 그날 그 단언이 먼저 깨진다.

## D16. 0023이 빠뜨린 `updated_at` 트리거를 0024로 닫는다

**결정**: `trg_situation_updated_at`, `trg_situation_fact_updated_at`을
**전진 마이그레이션 0024**로 추가한다. 0023은 고치지 않는다.

**실측 근거**: 0023이 두 컬럼을 추가하면서 이 저장소의 관례인
`trg_<table>_updated_at`을 함께 두지 않았다. 개발 DB에서 확인했다 —
`plan`에는 `trg_plan_updated_at`이 있고 두 테이블에는 없었다. 컬럼만 있고
트리거가 없으면 `DEFAULT now()`가 INSERT 때 한 번 박히고 영원히 그대로여서
두 컬럼의 주석이 **거짓말이 된다**(`situation_fact.updated_at` = "마지막 보정
시각 (UNE-SIT-008)"). 0023 §1이 컬럼을 넣은 이유(목록의 "최근 수정순" 근거)도
성립하지 않는다.

**애플리케이션에서 쓰지 않는 이유**: 이 두 테이블에 쓰는 경로는 CC-200 하나가
아니다. CC-210이 CONFIRMED/REJECTED로 상태를 올리고, 그때 빠뜨리면 조용히
어긋난다. `plan`이 트리거를 쓰는 것과 같은 이유다.

**0023을 고치지 않는 이유**: 이미 적용됐다(`.claude/rules/database.md`: 전진
전용). 편집해도 재실행되지 않으므로 고친 척만 하게 된다.

## D17. 400은 400의 코드를 쓴다 — `FACT-400-001` / `PROV-400-001` 신설

**결정**: 요청 형식 오류에 `FACT-400-001`, `PROV-400-001`을 신설한다.
계약의 `x-error-codes`는 **실제로 반환하는 코드만** 적는다.

**배경(이중 리뷰 M-4)**: 처음에는 400에 `FACT-422-001`과 `PROV-503-001`을
재사용했는데 둘 다 설계가 다른 뜻으로 정의한 코드였다. 설계 10 오류표의
`PROV-503-001`은 "상황 Provider 장애 / 부분결과·수동"이고, `FACT-422-001`은
정규화 격리 — D8이 **사용자 검토 대상**으로 정의한 상태다. 코드만 보고 복구
안내를 만드는 클라이언트가 형식 오류에 "재시도/부분결과"를 띄운다.
D7이 스스로 `<도메인>-<HTTP>-<일련>` 표기를 정본으로 선언해 놓고 어긴 자리였다.

**따름정리**: `PROV-503-001`은 **한 번도 반환되지 않는다.** Provider 장애가
200이기 때문이다(D11). 계약의 `x-error-codes`에서 뺐다 — 반환하지 않는 코드를
남겨 두면 그 목록이 검증 가능한 사실이 아니게 된다(CC-170이 `malware_scan`
드리프트를 닫은 것과 같은 판단). 설계 10 표에서 이 코드가 지시하는 상황은
`jobs[].error.kind`가 대신 표현한다.

## D18. 단위가 없으면 추측하지 않는다

**결정**: 표준 단위가 있는 Key에 단위 없이 값이 오면 `unit`을 채우지 않고
결과를 `ORIGINAL_KEPT`로 내리며 `UNIT_MISSING` 사유를 남긴다.

**배경(이중 리뷰 M-6)**: 처음에는 "단위가 없으면 canonical로 온 것"으로 보고
`unit = spec.unit`을 채운 뒤 `NORMALIZED`로 냈다. 그러면 **화씨 77을 넣은
사용자에게 화면이 "정규화 성공, 77 degC"를 보여주고 검토 신호가 하나도 없다.**

두 군데와 어긋났다. **D9**는 오프셋 없는 시각을 "어느 쪽으로 추측해도 9시간
어긋난 사실이 감사에 남는다"는 이유로 격리하는데, 단위 미상은 정확히 같은
종류의 모호성이다. 그리고 정보가 **더 많은** 경우(단위는 있으나 변환 불가 →
`ORIGINAL_KEPT`)보다 정보가 **더 적은** 경우가 더 높게 판정되는 뒤집힘이었다.
값은 수치로 정리하되 단위는 비워 두고 검토 대상으로 내린다.

## D19. 목업 시나리오 훅은 설정으로만 켜진다

**결정**: `MockSituationProvider`에 `scenariosEnabled`(기본 **false**)를 두고,
API는 `SITUATION_PROVIDERS` 토큰으로 팩토리를 **주입받는다**. 훅은
`UNE_SITUATION_MOCK_SCENARIOS=true`로만 켜지며 요청 본문으로는 켤 수 없다.
계약의 `ProviderQueryRequest.query` 설명에서 `mockScenario` 문장을 뺐다.

**배경(이중 리뷰 M-3)**: `ProviderQueryService`가 요청 핸들러 안에서 구체
팩토리 `createSituationProvider`를 직접 불렀다. 그래서 레지스트리가 준비해 둔
`overrides`("시험용 대체")에 API에서 도달할 방법이 없었고, **E2E가 운영 요청
본문의 `mockScenario`로만 실패 갈래를 만들 수 있었다.** 시험 훅이 운영 경로에
남고 계약이 그 필드를 약속하는 상태였다.

이 저장소는 이미 다른 방식을 정해 두었다 — CC-160의 `OBJECT_STORAGE` 토큰 +
`useFactory`, CC-120/125의 생성자 주입, CC-125 `MockLegacyT3qPlanAdapter`의
`scenariosEnabled`(기본 off). CC-200만 이음매를 만들지 않았다.

---

## 수용 한계 (알고 남긴 것)

1. **SSE(UNE-SIT-006)를 구현하지 않았다.** SIT-015 폴링으로 대체했고 계약에는
   남겨 뒀다. 동기 수집에서는 스트림에 실을 중간 상태가 없다(D2). CC-170이
   UNE-PLAN-011에서 같은 선택을 했다. 비동기 전환과 함께 연다.
2. **실 Provider가 붙으면 SIT-005 응답이 느려진다.** 지금은 목업이라 즉시
   끝나지만 실 KMA/MOIS는 초 단위다. **제한시간은 있다** — Provider 한 곳당
   `UNE_SITUATION_PROVIDER_TIMEOUT_MS`(기본 10초)이고 초과는 그 Provider의
   `TIMEOUT` 실패로 접혀 배치는 계속 간다. **없는 것은 재시도·백오프·
   서킷브레이커·레이트리밋**이며(`.claude/rules/provider-adapters.md`가 요구하는
   것들) 실 어댑터와 함께 온다. 지금 만들면 목업 앞에서 아무것도 하지 않는
   장치가 된다(D2와 같은 이유).
3. **KMA/MOIS는 목업이다.** `health().mode`가 항상 `MOCK`이고
   `packages/provider-adapters/src/situation/situation-provider.test.ts`가
   그것을 고정한다. 실 지원으로 보고하지 않는다(CLAUDE.md, ADR-24 절차).
   실 OpenAPI·인증·Rate Limit이 확정되면 ADR §4.5 G11 게이트를 통과한 뒤
   같은 포트 뒤에 LIVE 어댑터를 붙인다.
   다만 **상황 Provider는 `plan-feature-capabilities` 레지스트리에 등재되지
   않았다.** 그 레지스트리는 T3Q 계획 생성 전용(ADR-24)이고 상황 Provider는
   T3Q가 아니다. `health().mode`/`openBinding`이 같은 사실을 나르지만 ADR-24의
   승격 절차 밖이다 — 실 어댑터를 붙일 때 레지스트리를 일반화할지 결정한다
   (QA 리뷰 R-4).
4. ~~**`provider_result`의 보존기간·TTL이 없다.**~~ **닫힘 (2026-08-09,
   마이그레이션 0026 / OB-16).** 사용자 결정으로 **1개월 뒤 페이로드만 비운다** —
   행은 남기고 `payload_sha256`·`item_count`·수신시각·상태는 그대로 둔다.
   `provider_job.request_json`도 같은 대상이다(조회조건에 개인정보가 들어올 수
   있고 `une_app`에는 UPDATE가 없어 사후 마스킹 경로도 없었다).
   **D2를 뒤집지 않기 위해 전용 롤 `une_retention`을 새로 만들었다** — 워커에
   권한을 얹으면 "워커는 상황 계열 테이블에 닿지 않는다"가 조용히 사라진다.
   근거·실측 권한·검증은 `docs/evidence/OB-16-payload-retention.md`.
   `file_object`(0020이 미룬 항목)는 오브젝트 저장소 객체까지 함께 정리해야
   하므로 여전히 열려 있다.
5. **freshness/TTL(CURRENT/AGING/STALE)을 계산하지 않는다.** WP-SITUATION-09가
   그 항목이고 CC-200 인수기준에 없다. 근거값(`observedAt`/`collectedAt`)은
   전부 저장돼 있으므로 계산은 나중에 가능하다.
6. **`SituationDetail.currentSnapshot`을 응답에 싣지 않는다.** `currentSnapshotId`
   까지만 준다. Snapshot 형태는 CC-210의 결정 공간이다(D6).
7. **중복 수집 억제가 멱등키뿐이다.** 같은 조건을 다른 멱등키로 두 번 부르면
   후보 Fact가 두 벌 생긴다. 중복군 계산이 CC-210이므로 의도된 상태이며,
   그때 `(situation, key, source, observed_at)`의 취급이 정해진다.
8. **`x-db-tables`가 설계 10 표보다 넓어졌다.** SIT-005는 설계가 `provider_job`
   하나만 적었지만 실제로는 여섯 표를 쓴다(원문 보존·출처·후보·상태전이·감사).
   계약을 구현에 맞췄다 — 설계 표가 요약이지 전수가 아니었다.
9. **자동저장·초안 개념이 없다.** 설계 06 US-SIT-003 #4의 "SituationContext
   revision을 증가시켜 저장"은 `situation.version_no`로만 구현했다. 편집 중
   초안(plan의 `plan_context_draft`에 해당하는 것)은 만들지 않았다.
10. **`payload_sha256`은 wire 바이트의 해시가 아니다.** 포트가
    `rawPayload: unknown`(이미 파싱된 값)만 나르므로 정규 직렬화
    (`canonicalHash`) 해시를 저장한다. 변조 탐지·중복 식별에는 쓸 수 있지만
    **제3자가 Provider 응답 원문으로 재계산한 해시와는 일치하지 않는다.**
    LIVE 어댑터를 붙일 때 포트에 `rawBody?: string`(+ content type)을 추가해
    수신 바이트로 계산하도록 바꾼다. 0023 §5의 컬럼 주석("원문 해시")은 그때
    문자 그대로 참이 된다(이중 리뷰 m-2).
11. **재난유형 어휘를 상황 모듈이 계획 모듈에서 읽는다**
    (`situation.controller.ts` → `../plan/plan-context.validator`). 정본은
    `plan-context.schema.json`이고(ADR-23 D3) 그 파생 상수를 공유하는 것이지만,
    두 도메인의 공통 어휘이므로 `@une/domain`에 두는 편이 모듈 경계에 맞다.
    옮기지 않은 이유는 파생의 출발점인 생성 스키마 모듈이
    `services/api/src/generated/`에 있어 이동이 계약 타입 생성 경로까지
    건드리기 때문이다 — CC-200 범위 밖의 변경이라 다음 항목으로 넘긴다
    (이중 리뷰 m-7).
12. **보정이 원천 표기를 덮는다.** UNE-SIT-008은 보정값으로 정규화를 다시
    돌리므로 `value_json.normalization.originalValue/originalUnit`과 `raw`가
    **보정 시점의 값으로 교체된다.** Provider 수집분은 원문이
    `provider_result`에 남지만 MANUAL Fact의 최초 입력값은 `audit_log`의
    `before_json`에만 남는다. 설계 06 US-SIT-006의 "원천 provenance 손실 0건"을
    문자 그대로 읽으면 어긋난다. 원천 Fact를 불변으로 두고 보정을 **파생
    Fact**로 만드는 것이 설계 06 §7.1의 본래 형태이며(주요 데이터: "원천 Fact
    불변. 수정 시 파생 Fact 생성"), 그 구조는 파생 계보 컬럼을 요구하므로
    CC-210의 결정 공간과 겹친다. 지금은 감사에 남는 것으로 두고 넘긴다
    (QA 리뷰 R-5).
13. **응답 스키마의 런타임 검증이 없다.** 계약 예제 게이트가 SIT-001/005/007의
    응답 예제를 스키마와 대조하고 응답 스키마는 `additionalProperties: false`로
    닫혀 있지만, **실제 응답 본문을 스키마로 검증하는 실행은 없다** — e2e의
    수작업 필드 단언이 그 자리를 대신한다. 생성 타입이나 AJV로 응답을 검증하는
    것은 슬라이스 UI가 이 API를 쓰는 시점(CC-210+)에 함께 판단한다(QA 리뷰 R-1).

## 다음 항목으로 넘기는 것

- **CC-210**: 중복군(`fact_duplicate_group`)·충돌 해소·SituationSnapshot 확정,
  `openConflictCount` 실계산, `SituationSnapshot` 스키마 실형태화,
  `situation_fact` 중복 키 전략, 계약의 `fact_duplicate_group` 드리프트 종결.
- **WP-SITUATION-09**: freshness/reliability 정책과 category별 TTL.
- **실 Provider(ADR §4.5 G11)**: KMA/MOIS LIVE 어댑터, 타임아웃·서킷브레이커,
  capability 상태 승격.
- **OB-02/OB-05**: T3Q 상황 API 계약, SafeKorea/Naver 법적·운영 승인.
- ~~**보존 정책**: `provider_result` TTL~~ — 2026-08-09 닫힘(0026, OB-16).
  남은 것은 `file_object`의 보존기간과, 배포 전에 닫아야 할 롤 멤버십
  프로비저닝(증거 문서 §6 — `une_app`은 `une_worker`/`une_retention`으로
  `SET ROLE`할 수 없다. 0015부터 있던 선재 결함이다).
