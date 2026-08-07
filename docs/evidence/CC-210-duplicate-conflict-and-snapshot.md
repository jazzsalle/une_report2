# CC-210 증거: 중복군·충돌 해소·불변 SituationSnapshot

- Work Item: **CC-210** Implement duplicate/conflict resolution and SituationSnapshot (G3)
- 브랜치: `feature/CC-210` (CC-200 커밋 `f6afea3` 위)
- 결정 정본: **ADR-34** (`docs/adr/ADR-34-cc210-duplicate-conflict-and-snapshot.md`)
- 마이그레이션: **0025** (테이블 62 → **63**)
- 범위: UNE-SIT-009~013 + **UNE-SIT-008의 의미 변경**(제자리 UPDATE → 파생 Fact).
  지식문서·UNI(UNE-KNOW)는 CC-220.

## 1. 인수기준별 증거

모두 `services/api/src/e2e/situation-resolution.e2e.test.ts`에서 **실제
마이그레이션된 DB에 런타임 역할 `une_app`(FORCE RLS)으로 HTTP를 지나** 확인한다.

### AC-1. unresolved conflict block

| 단언 | 증거 |
|---|---|
| 미해결 충돌이 있으면 412 `SIT-412-003` | `확정 차단 > 미해결 충돌이 있으면 확정할 수 없다` — 위반 목록에 `UNRESOLVED_CONFLICT`, **Snapshot 0건**(부분 기록 없음), 해소 후 재시도는 201 |
| 같은 표준 Key 중복 확정 차단 | `같은 표준 Key를 두 번 확정할 수 없다` — `DUPLICATE_FACT_KEY` |
| 다른 상황/후보 아닌 Fact 차단 | `다른 상황의 Fact나 후보 아닌 Fact는 확정할 수 없다` |
| 권한 | `SITUATION_CONFIRM 권한이 없으면 403이다`(SIT-011·SIT-012 각각) |
| 계약 밖 필드를 조용히 무시하지 않음 | `계약에 없는 conflictResolutionIds를 조용히 무시하지 않는다` → 400 |

도메인 단위 증거는 `packages/domain/src/situation/snapshot.test.ts`의
`checkSnapshotConfirmable` 8건(차단 사유 6종 전부).

### AC-2. immutable snapshot

| 단언 | 증거 |
|---|---|
| 확정 후 변경 0건 | `불변과 해시·버전 > 확정 후 변경 0건 — une_app은 Snapshot을 고치거나 지울 수 없다` — `UPDATE`/`DELETE` 모두 `permission denied`(0011 §3 REVOKE) |
| 확정 후 원천이 움직여도 사본은 그대로 | `확정 후 원천을 보정해도 Snapshot의 사본은 움직이지 않는다` — 확정된 Fact는 후보가 아니므로 보정이 먼저 막히고(1차), 그래도 사본이 별도로 남는다(2차, ADR-34 D9) |
| 해소는 불변 | `이미 해소된 충돌은 다시 정할 수 없다` → 409 `FACT-409-002`. 권한은 0025 §5가 회수 |
| 원천 Fact 불변(파생) | `situation.e2e.test.ts > 보정은 …` — 원본 `SUPERSEDED` + 계보 없음, 파생이 `original_fact_id`/`derived_by`/`derived_reason` 보유 |

### AC-3. hash / version

| 단언 | 증거 |
|---|---|
| v1 생성·해시 형식·사실 사본 | `확정이 v1을 만들고 사실 사본·해시를 담으며 상황을 CONTEXT_CONFIRMED로 올린다` — `contentHash` 64 hex, `facts[0].status='CONFIRMED'`, `currentSnapshotId` 갱신, `contextState='USER_CONFIRMED'` |
| 재확정은 새 snapshotId·v+1·이전 보존 | `재확정은 새 snapshotId·v+1이고 이전을 가리키며 기존은 보존된다` — `supersedesSnapshotId` 연결, 행 2건 |
| 해시 재현성·구성 | 도메인 `snapshot.test.ts` 6건 — 순서 무관, 확정자·시각 제외, `effectiveAt` 포함, **근거(factId) 포함**, 값 변경 시 변화 |

### AC-4. change comparison

| 단언 | 증거 |
|---|---|
| 추가·변경·유지를 센다 | `Diff > 두 판의 추가·삭제·변경·유지를 센다` — `{added:1, removed:0, changed:1, unchanged:1}`. **바뀌지 않은 사실을 v2에 다시 담아** 허위 REMOVED가 나지 않는 것까지 확인한다(ADR-34 D15) |
| 의도적으로 뺀 것만 REMOVED | `의도적으로 뺀 사실만 REMOVED가 된다` |
| compareTo 없으면 목록만 | `compareTo가 없으면 목록만 준다` — `diff: null` |
| 없는 Snapshot 비교는 404 | `없는 Snapshot과 비교하면 404다` |
| Key 기준 비교 | 도메인 `snapshot.test.ts` — 근거만 바뀌면 `UNCHANGED`, 객체 키 순서 차이는 변경 아님, 단위만 달라도 변경 |

## 2. 실행으로 잡은 결함 2건

주장이 아니라 e2e가 밟아 드러난 것만 적는다.

### (1) 해소한 충돌이 재계산 한 번으로 되살아났다

0025 §4의 부분 유니크는 `status='OPEN'`에만 걸린다. 그래서 사용자가 충돌을
해소해 `RESOLVED`가 된 뒤 "중복군 다시 계산"(SIT-009)을 누르면 **같은 후보
집합에 대해 OPEN 충돌이 새로 열렸다.** 해소 행은 지워지지 않았는데도 판단이
없던 일이 되고, 확정(SIT-012)이 다시 412로 막혔다.

같은 후보 집합의 선행 충돌(OPEN/RESOLVED 불문)이 있으면 열지 않도록 고쳤다.
후보 집합이 **달라지면** 새로 연다 — 새 값이 도착해 다시 어긋난 것이므로
사람이 다시 판단해야 한다. 두 경우 모두 회귀 단언이 있다(ADR-34 D6).

### (2) `inconsistent types deduced for parameter`

위 수정의 `INSERT … SELECT … WHERE NOT EXISTS`에서 같은 파라미터가 INSERT
대상과 비교식 양쪽에 쓰여 플래너가 타입을 정하지 못했다. 500으로 나갔고 e2e
11건이 함께 붉어졌다. 명시 캐스트(`$1::uuid`, `$2::varchar`)로 해소.

## 3. UNE-SIT-008 의미 변경과 그 파급

설계 06 US-SIT-007 #3과 §7.1이 "원천 Fact 불변, 수정 시 파생 Fact 생성"인데
CC-200은 제자리 UPDATE였다(ADR-33 수용 한계 12가 기록). 사용자 결정으로
설계 쪽에 맞췄다.

| 항목 | 전 (CC-200) | 후 (CC-210) |
|---|---|---|
| 저장 | 같은 행 UPDATE | **새 행** + 원본 `SUPERSEDED` |
| 응답 | 같은 `factId`, `versionNo+1` | **새 `factId`**, `versionNo=1` |
| `reason` | 선택 | **필수**(0025 §2 CHECK가 DB에서도 강제) |
| 출처 | 원본 승계 | `MANUAL`/`USER` 신규 — 사용자가 고친 숫자가 기상청 값으로 보이면 안 된다 |
| 감사 | `FACT_UPDATED` | `FACT_CORRECTED`(설계 06 US-SIT-007 감사 이벤트) |
| 같은 원본 재보정 | 409 | **412**(원본이 이미 후보가 아니다) + 파생 1건만 |

CC-200 e2e 3건을 새 의미로 갱신했고, 갱신분이 계보·상태·감사를 함께 단언한다.

## 4. 계약 동기화

**상황 계열의 마지막 자리표시자가 사라졌다.**

| 항목 | 전 | 후 |
|---|---|---|
| `SituationSnapshot` | `additionalProperties: true`(CC-200이 의도적으로 남김) | 실형태 + `SnapshotFact` |
| SIT-009/010/011 응답 | `Situation` 자리표시자 | `DeduplicateResponse` / `FactConflictListResponse` / `ConflictResolutionResponse` |
| SIT-012/013 응답 | `SituationSnapshot` 자리표시자 | `SituationSnapshotResponse` / `SituationSnapshotListResponse`(+`SnapshotDiff`) |
| SIT-009/011 요청 | `GenericRequest` | `DeduplicateRequest` / `ConflictResolveRequest`, `additionalProperties: false` |
| `SituationSnapshotCreateRequest` | 열림 + `conflictResolutionIds` | 닫힘, 그 필드 제거(구현이 400으로 거부 — ADR-34 D6 주석) |
| `SituationFactPatchRequest` | `reason` 선택 | **필수**, `minProperties: 2` |

`pnpm generate:contract-types` 재실행 완료. 계약 테스트가 CC-200의 단언을
새 사실에 맞게 갱신했다(자리표시자 검사 → **상황 계열에 열린 스키마 0건** 검사,
구현 SIT API 9 → 14).

## 5. 테넌트 격리와 불변 권한

`tests/integration/src/situation-table-rls.test.ts`가 0025의 새 표면까지 덮는다 —
`fact_duplicate_group`을 RLS 목록에 더했고, `conflict_resolution`을
`APPEND_ONLY_TABLES`(=`une_app`이 UPDATE/DELETE를 갖지 않아야 하는 목록)에
등재했다. 마이그레이션 테스트가 25개/63테이블을 고정한다.

## 6. 게이트 (단일 `pnpm test`, exit 0 · skip 0)

재현 절차는 `docs/evidence/CC-200-situation-fact-ingestion.md` §6과 같다
(`DATABASE_URL` + `OBJECT_STORAGE_*` 4종 필요, 없으면 조용히 skip된다).

이중 리뷰 전건 반영 후, 트리를 얼려 재실행한 수치다.

| 워크스페이스 | Test Files | Tests | CC-210 증분 |
|---|---|---|---|
| @une/hwpx-engine | 23 | 426 | — |
| @une/api | 26 | **375** | +1 파일 / +36 |
| @une/contract-tests | 13 | 222 | — (단언 갱신) |
| @une/provider-adapters | 14 | 162 | — |
| @une/db-integration | 12 | 141 | — (단언 갱신) |
| @une/domain | 14 | **143** | +2 / +42 |
| @une/worker | 5 | 44 | — |
| @une/e2e | 2 | 13 | — |
| @une/web / @une/field-web | 3 / 1 | 28 / 1 | — |

`build` `typecheck` `lint` `format:check` PASS.
`validate:contracts` `validate:intake` `validate:handoff` PASS.
마이그레이션 **25개**, 테이블 **63**, 데이터 사전 63/601 재생성.
설계 원문·전사본·rhwp upstream 무변경.

## 7. 이중 리뷰 (병렬, opus)

초기 판정: **아키텍처 2 BLOCKER / 11 MAJOR / 9 MINOR**, **QA PASS WITH
CONDITIONS**(필수 7 / 권고 9). 전건 당일 반영했다. 두 리뷰가 **독립적으로 같은
것 다섯**을 지목했다 — SIT-012의 201↔계약 200 불일치, 질의 파라미터 누락,
`fact_duplicate_group`이 격리 회귀 밖, 죽은 `updateFact`, 해소 시 상태 미검사.

### BLOCKER 2건 — 인수기준 1이 우회되고 있었다

**B-1. 같은 Key의 두 번째 충돌이 조용히 사라졌다.** 그룹의 정체성은
`group_key`(Key+창)인데 충돌의 정체성은 `fact_key` 하나였다. 축이 어긋나
같은 Key의 서로 다른 시간창이 각각 충돌을 만들면 두 번째 INSERT가 부분
유니크에 걸려 `DO NOTHING`으로 삼켜졌고, 저장도 로그도 되지 않았다. 첫 충돌만
해소하면 **미해결 불일치를 사용자가 한 번도 보지 못한 채 확정이 통과했다.**
→ `fact_conflict.group_key` 신설 + 유니크를 `(situation_id, group_key)`로,
`ON CONFLICT DO NOTHING` 제거(ADR-34 D13).

**B-2. `SUPERSEDED`가 DB에만 있었고 삼중 대조 게이트가 그것을 놓쳤다.**
0025가 `ck_situation_fact_status`를 넓혔는데 도메인 상수·계약 enum·JSON
Schema는 3값 그대로였다. ADR-33 D1이 세운 게이트는 **0023 한 파일만 읽어**
초록으로 통과했다 — 게이트가 막으려던 사고가 게이트를 우회했다. 실사용 영향도
있었다: SIT-014가 계약 enum에 없는 `SUPERSEDED`를 반환했고,
`?status=SUPERSEDED` 조회는 400이라 파생 계보의 원본을 볼 방법이 없었다.
→ 세 곳을 함께 넓히고, 게이트가 **제약을 마지막으로 정의한 마이그레이션**을
찾아 읽도록 고쳤다(ADR-34 D16).

### 실질 결함 (코드를 고쳤다)

| # | 지적 | 실제 증상 |
|---|---|---|
| M-1 | 그룹화가 `category`를 버렸다 | `USER_ASSERTED/temperature`("체감상 더움")와 `WEATHER_OBSERVATION/temperature`(25)가 한 그룹이 되어 허위 충돌이 열리고 확정이 막힌다. CC-200 리뷰 m-1과 같은 결함 |
| M-2 | 재확정이 이전 판의 사실을 잃었다 | 확정 대상이 `CANDIDATE`뿐이라 v1에서 확정한 Fact를 v2에 담을 수 없었다. 현재 기준 Snapshot에서 사실이 사라지고 **Diff가 지운 적 없는 사실을 REMOVED로 보고**했다 — 인수기준 4가 거짓을 말했다 |
| M-3 | 재계산이 사라진 충돌을 닫지 않았다 | 보정으로 값이 같아져도 원래 충돌이 OPEN인 채 남아 **확정이 영구 차단**됐고, 탈출구가 이미 SUPERSEDED된 후보를 선택하는 것뿐이었다 → `OBSOLETE` 신설(D14) |
| M-4 | `openConflictCount`가 하드코딩 0 | ADR-33 D6이 CC-210에 배정한 항목. 설계 06 §7.1의 `CONFLICT_OPEN`이 **어떤 입력으로도 나오지 않는** 상태였다 |
| M-5 | 재계산이 상황 행을 잠그지 않았다 | 확정이 OPEN 충돌 0을 읽은 뒤 커밋 전에 재계산이 충돌을 커밋하면 미해결 충돌이 있는 채로 Snapshot이 만들어진다 |
| M-6 | 확정 승격의 결과를 버렸다 | 동시 보정이 먼저 커밋하면 Snapshot 사본·원천·파생이 서로 다른 말을 한다 → 409 `SIT-409-003` |
| M-9 | 해소가 선택 대상의 상태를 보지 않았다 | 충돌이 열린 뒤 SUPERSEDED가 된 Fact를 기준으로 확정할 수 있었고, 해소는 불변이라 되돌릴 수 없다 |
| M-10 | 확정이 `page 1 / size 1000`으로 잘렸다 | 1000건을 넘으면 "이 상황의 Fact가 아닙니다"로 412가 나고 실제 원인(페이징)이 드러나지 않는다 → 요청 id만 읽는 조회 |
| m-5 | SIT-008이 다른 자원의 ETag를 응답 | 파생의 버전을 실으면 클라이언트가 그 값으로 같은 URL을 다시 PATCH해 412를 받는다 → `Content-Location`으로 대체 |

### 계약 정합 (F-1~F-3, F-7, m-2~m-4, m-6)

SIT-012를 **201**로(자원 생성이며 구현·멱등 successStatus와 일치), 412를
반환하는 세 API에 `'412'` 응답 선언, SIT-010의 `status`·SIT-013의 `compareTo`
질의 파라미터 선언(없어서 **인수기준 4의 유일한 진입점을 타입 클라이언트로
호출할 수 없었다**), SIT-012 description의 `resolutionIds` 제거,
`situation-snapshot.schema.json`에 `snapshotId` 추가, 상황 부재를
`SIT-404-001`로 통일, `SituationFact`에 `originalFactId`/`derivedReason` 노출.

### 게이트·증거 보강 (F-4~F-6, G-1~G-4)

`fact_duplicate_group`을 격리 회귀에 편입(상황 계열에서 **유일하게 DELETE가
열려 있는 테이블**인데 신설분만 빠져 있었다), 죽은 `updateFact` 삭제
(0025 §2가 세운 원천 불변과 정면으로 어긋나는 함수가 재사용을 기다리고 있었다),
`SNAPSHOT_CONFIRMED`·`FACT_GROUPED` 감사 단언, 멱등 재전송(더블클릭이 v1+v2를
만들지 않는다) 및 428, `readerA`에 **확정만 없는 역할**을 실제로 부여(이전에는
아무 역할도 없어 403 테스트가 권한 경계를 격리하지 못했다).

## 8. 알려진 한계 (ADR-34 수용 한계 요약)

전문은 ADR-34에 있다(**18건** — 이중 리뷰가 9건을 더했다). 요약:

1. 그룹화 키에 location/eventKey 없음 — `situation_fact`에 컬럼이 없다
2. `threshold`를 해석하는 전략이 아직 없음(값은 보존)
3. 확정 예외 승인 경로 없음 — 승인 주체·기록 형태가 설계에 없다
4. MFA/재인증 없음 — 인증 수준 정본 미확정
5. STALE 경고 없음 — freshness는 WP-SITUATION-09
6. 파생 계보 길이에 상한 없음(순환은 막힌다)
7. 동시 확정은 행 잠금 + 버전 유니크로만 막는다
8. `SOURCE` 충돌 유형 미생성 — 만드는 규칙이 설계에 없다
9. 중복군 보존기간 없음(계산 결과이므로 OB-16 대상 아님)
10. **`contextRevision`/`REVISION_CONFLICT` 없음** — 낡은 화면을 든 두 통제관이
    각각 확정하면 둘 다 성공하고 경고가 없다. 남은 것 중 가장 큰 누락이다
11. CONFIRM_PREVIEW·`CONFIRMED_MANUAL` 미구현
12. 설계 10의 `resolutionIds`를 의도적으로 400으로 거부
13. SIT-011이 설계 10의 `SIT-412-003`을 쓰지 않는다(확정 차단 전용 코드다)
14. `conflict_type='SOURCE'`는 도달 불가능(어휘만 남았다)
15. Diff는 항상 최신판과만 비교(v1↔v2 비교 불가)
16. Snapshot 사본의 `status`를 `CONFIRMED`로 고정해 해시에 넣는다
17. 동시 확정 경합의 실행 증거 없음
18. SIT-008 파괴적 변경(낡은 If-Match가 409→412, ETag 대신 `Content-Location`)
