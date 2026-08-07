# Session Handoff

- Date/time: 2026-08-07 (회사 PC, 여덟 번째 세션 — 종료)
- Branch: **feature/CC-200** @ `24793ce` (**origin 미푸시**)
- main: `0eabd59` (최신, CI PASS)
- Current Work Item: **CC-200 착수 — 마이그레이션 0023까지 완료, 구현은 시작 전.**

## 이번 세션에 끝난 것

### 1. PR 두 개 머지 — G2 종료

지난 세션의 유일한 미결이었다. **사람이 `!` 접두사로 직접 실행**해서 통과했다
(`gh pr merge`는 Claude Code auto mode 분류기가 여전히 차단한다 — 이번에도 막혔다).

| PR | 머지 커밋 | 결과 |
|---|---|---|
| [#13](https://github.com/jazzsalle/une_report2/pull/13) CC-160 | `e8d8b78` | 머지 커밋 방식, main CI PASS |
| [#14](https://github.com/jazzsalle/une_report2/pull/14) CC-170 | `0eabd59` | 머지 커밋 방식, main CI `verify`+`db-verify` PASS |

순서(#13 → #14)와 방식(`--merge`) 모두 계획대로였다. 열린 PR 없음. **G2 닫힘.**

- ⚠️ **`gh pr merge`는 출력이 비어 보여도 성공한 것이다.** 이번에 두 번 다 빈
  출력이었고 `gh pr view <n> --json state`로 확인하니 MERGED였다. 실패로 오인하지 말 것.

### 2. CC-200 마이그레이션 0023 (`24793ce`)

**0018 §9가 "각 도메인 Work Item이 닫는다"고 예고한 상황 계열 격리를 닫았다.**
착수 시점 실측: `situation`만 RLS가 켜져 있었고 `fact_source`·`situation_fact`·
`provider_job`·`fact_conflict`·`conflict_resolution`·`situation_snapshot`
**여섯 테이블은 정책이 한 번도 없었다.** 0011이 `une_app`에 전 테이블 DML을
일괄 부여하므로 **정책 없는 테이블 = 전 테넌트 공개**였고, CC-200이 첫 쓰기
경로를 여는 순간 테넌트 격리 규칙이 깨지는 상태였다.

- `fact_source`·`provider_job`은 **tenant_id를 직접 세웠다**(EXISTS(부모) 불가).
  전자는 부모 애그리거트가 아예 없어 "아직 참조되지 않는 source 행"이
  fail-open으로 노출된다. 후자는 `situation_id`가 **nullable**이다 —
  UNE-KNOW-002/003이 상황 없는 UNI Job에 같은 테이블을 쓰므로, 상황 경유 정책은
  그 정당한 행들을 전부 막는다.
- **`provider_result` 신설** (테이블 61 → 62). 계약 UNE-SIT-006의 `x-db-tables`가
  **존재하지 않는 이 이름**을 가리키고 있었다. CC-170의 `malware_scan`과 같은
  드리프트지만 **결론은 반대다**: 원문 페이로드 보존은 CLAUDE.md 비협상 규칙이라
  이름을 지우는 대신 실체화하는 쪽이 맞다. UPDATE/DELETE 회수(증거).
- **CHECK 제약이 곧바로 실질 결함을 잡았다.** CC-004 픽스처가 설계 어디에도 없는
  `mode='ACTUAL'`, `status='OPEN'`을 쓰고 있었다. 상태 어휘 정본은 **설계 06
  §7.1**(`DRAFT → REGISTERED → CONTEXT_CONFIRMED → SOP_READY → RUNNING/PAUSED
  → CLOSING → CLOSED`)이다. 픽스처를 설계에 맞췄다(LIVE/DRAFT).
- `provider_job` 상태는 **SUCCEEDED/PARTIAL/FAILED 셋뿐**이다. 동기 수집이라
  행이 종결된 채 태어나 QUEUED/RUNNING이 도달 불가능하다(0022 §1 원칙).

**테스트**: `@une/db-integration` **11 파일 127 테스트 통과(skip 0)** — 빈 DB
전체 적용과 0010→0023 업그레이드 둘 다 포함. 데이터 사전 재생성 완료(62/587).

## ⚠️ 다음 세션에서 가장 먼저 할 일

**1. 브랜치를 푸시하지 않았다.** `feature/CC-200` @ `24793ce`가 로컬에만 있다.

**2. CC-200은 마이그레이션만 끝났고 구현은 0줄이다.** 승인된 계획은 아래와 같다.

### CC-200 남은 작업 (사용자 승인 완료)

이번 세션에 사용자가 두 가지를 결정했다.

- **Provider 수집은 동기 방식**(어댑터 호출은 트랜잭션 밖, 결과는 한 트랜잭션에
  기록, 이미 종결된 Job 반환). 지금 어댑터가 전부 목업이라 비동기로 만들면
  큐·리스·폴링이 실제로는 아무것도 기다리지 않는 장치가 된다. 실 Provider가
  붙으면 응답이 느려지는 한계는 ADR 수용 한계와 OB에 남긴다.
- **계약 공백 두 곳을 CC-200에서 닫는다.** `UNE-SIT-014`(GET 후보 Fact 목록 —
  없으면 SIT-008이 보정할 factId를 얻을 방법이 없다), `UNE-SIT-015`(GET Provider
  Job 상태). SSE(SIT-006) 자체는 CC-170 선례대로 폴링으로 대체하고 수용 한계에 남긴다.

**남은 항목:**

1. **계약 동기화** — `Situation`이 `additionalProperties: true` **자리표시자**다
   (CC-160/ADR-31이 같은 문제를 고치며 남긴 주석이 바로 위에 있다). 어떤 응답이든
   통과하므로 예제 게이트가 아무것도 검증하지 못한다. 실제 형태로 채우고,
   SIT-002 응답이 단건 `Situation`으로 잘못돼 있는 것(Page여야 함)을 고치고,
   SIT-004/007/008의 `GenericRequest`를 전용 스키마로 바꾼다. SIT-014/015 신설.
   **`pnpm generate:contract-types` 재실행 필수** — 지난 세션에 이걸 빠뜨려
   CI가 15초 만에 잡았다.
2. **`packages/domain/src/situation/`** — 상태기계(설계 06 §7.1), fact 표준 key,
   **정규화**(단위·값 형태 — 인수기준 3번).
3. **`packages/provider-adapters/src/situation/`** — `SituationFactProvider` 포트 +
   KMA/MOIS 목업 + **비활성 어댑터**(OB-02 T3Q 상황 API) + **기능 플래그 off**
   (OB-05 SafeKorea/Naver 법적 승인 전). 공식 데이터 수집 에이전트는 T3Q 소유이므로
   UNE는 포트와 어댑터만 만든다.
4. **`services/api/src/situation/`** — SIT-001~005, 007, 008, 014, 015.
   `plan.controller/service/repository`가 그대로 본이 된다(If-Match=version_no
   강한 ETag, `@Idempotent`, `db.withTenant`, audit).
5. **테스트** — 도메인 단위, 어댑터 단위, API e2e, **RLS 통합 테스트 신설**
   (`tests/integration/src/situation-table-rls.test.ts` — 0023 주석이 이 파일명을
   이미 참조한다. `une_worker`가 이 테이블들에 42501로 막히는 것도 단언할 것).
6. **ADR-33** — 0023 주석이 D2/D3/D4/D6을 이미 참조하고 있다. **아직 파일이 없다.**
7. `IMPLEMENTATION_STATUS.md` / `CHANGELOG.md` / OPEN_BINDINGS(보존기간 TTL).
8. 이중 리뷰(`architecture-guardian` + `qa-gate-reviewer` 병렬) — 필수.

### CC-200 범위 밖 (경계)

중복군·충돌 해소·SituationSnapshot 확정(`UNE-SIT-009~013`)은 **CC-210**이다.
CC-200은 `status=CANDIDATE`까지만 만든다. `fact_duplicate_group` 테이블도
만들지 않았다(0023 §8) — 계약의 그 드리프트는 CC-210이 닫는다.

## 환경 재개 (이 PC면 부트스트랩 불필요)

```bash
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- docker ps    # WSL 깨우기(컨테이너 자동 복구)
```

```bash
set -a; . ./infrastructure/.env; set +a
export DATABASE_URL="postgres://$UNE_DB_USER:$UNE_DB_PASSWORD@127.0.0.1:$UNE_DB_PORT/$UNE_DB_NAME"
export OBJECT_STORAGE_ENDPOINT="http://127.0.0.1:$UNE_MINIO_API_PORT"
export OBJECT_STORAGE_BUCKET="$UNE_MINIO_BUCKET"
export OBJECT_STORAGE_ACCESS_KEY="$UNE_STORAGE_ACCESS_KEY"
export OBJECT_STORAGE_SECRET_KEY="$UNE_STORAGE_SECRET_KEY"
pnpm db:migrate     # 23개 — 적용돼 있으면 "No migrations to run!"
```

- **`pnpm db:migrate`도 `DATABASE_URL`이 필요하다.** 위 블록 먼저.
- **keepalive는 포그라운드 형태여야 한다**: `wsl -d Ubuntu -- sleep 3500`을 별도
  프로세스로 띄운다. **약 1시간마다 만료된다.** 테스트가 무더기로 깨지면 코드를
  의심하기 전에 컨테이너부터 확인할 것(`connect ECONNREFUSED 127.0.0.1:5432`).
- 통합·e2e는 위 환경변수가 없으면 **조용히 skip되고 exit 0**이다. 수치 인용 전
  분모(`Test Files N passed (N)`)를 확인할 것.
- Git Bash에서 `wsl`에 경로를 넘길 때는 `MSYS_NO_PATHCONV=1`.
- **gh CLI 2.97.0 설치·인증 완료**(keyring, 재시작해도 유지). 그냥 `gh`로 된다.

## Risks / OPEN

- **feature/CC-200 미푸시** — 이번 세션 최대 미결.
- **CC-200 마이그레이션이 main에 없는 상태에서 다른 브랜치를 파면 안 된다** —
  0023은 62 테이블 기준선을 바꾼다.
- **ADR-33이 없는데 0023 주석이 이미 D2/D3/D4/D6을 참조한다.** 다음 세션에서
  ADR을 쓰기 전까지 그 참조는 매달려 있다.
- **`pnpm test`와 CI `verify`가 덮는 범위가 다르다.** 생성 타입 drift 게이트,
  `validate:handoff`, baseline pytest는 CI에만 있다. 로컬 녹색 ≠ CI 녹색.
- **provider_result 보존기간·TTL 없음** — 원문에 개인정보가 섞일 수 있는데
  보존 정책이 없다(0023 §8, OPEN 등재 필요).
- **`situation.context_state` 컬럼을 만들지 않았다** — 설계 06의 SituationContext
  상태기계는 파생으로 둔다(0023 §8). 비동기 전환 시 `PROVIDER_QUERYING`이 실재하게
  되며 그때 재판단.
- 기존 이월(변동 없음): 한/글 열림 증거 없음(OB-08, rhwp 미반입 OB-12),
  XML 1.0 금지 제어문자 미필터, 실체화 자리 제약(ADR-32 한계 1), AV 스캔 없음(OB-15),
  화면 캡처 CI 미실행, 성능 수치는 개발 PC 표본 3~5회, SSE 대신 폴링, T3Q SSO 없음(OB-01),
  자기닫힘 `<hp:t/>` 되쓰기 오류코드 부정확, 정산 실패 시 고아 객체,
  `rewriteArchive`/`buildXmlDelta` 검증 우회 진입점, PDF/DOCX 미구현(422),
  표·SPLIT/MERGE 되쓰기 미개방, CI가 minio-init 결함 유형 미탐지,
  `canTransitionExport` 호출자 없음, 미반영 리뷰 지적 8건(ADR-32 D17),
  IX-*-TENANT 10건, 0010 파티션 전환 시 append-only REVOKE 재적용,
  UNI_VERIFY_TLS=false POC-local.

## Notes

- `git push`는 사람 승인 후 Claude가 실행 가능. **`gh pr merge`는 승인이 있어도
  분류기가 차단** — 사람이 `!` 접두사로 실행할 것.
- DATABASE_URL: 마이그레이션·시드·테스트는 superuser(une), 런타임은 une_app.
