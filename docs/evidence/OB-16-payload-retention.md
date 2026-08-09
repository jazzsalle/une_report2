# OB-16 종결 증거 — Provider 원문·요청조건 보존기간

작성일 2026-08-09 · 대상 마이그레이션 `0026_situation_payload_retention.sql`,
`0027_payload_redaction_transition_guard.sql` · **결정 정본 ADR-35** ·
관련 ADR-33(CC-200) D2·수용 한계 4, ADR-34(CC-210)

## 1. 무엇이 열려 있었나

0023이 두 가지를 **영구** 보존하게 만들었다.

| 위치 | 무엇 | 왜 남겼나 |
|---|---|---|
| `provider_result.raw_payload_json` | Provider 응답 원문 | CLAUDE.md 비협상 규칙 — "External provider payloads … are retained as raw payloads for traceability" |
| `provider_job.request_json` | 사용자가 채운 조회조건 | 무엇을 물었는지 재현해야 감사에서 응답을 해석할 수 있다 |

여기서 두 규칙이 정면으로 부딪힌다. `.claude/rules/security.md`는 "Mask or
minimize personal information in UI, logs, exports, and **provider requests**"를
요구한다. `request_json.query`는 형태가 정해지지 않은 객체이고 사용자가
주소·성명·연락처를 검색조건에 넣으면 그대로 남는다. 응답 원문도 마찬가지다.

그리고 **사후에 가릴 방법이 없었다.** 0023이 두 테이블에서 `une_app`의
UPDATE/DELETE를 회수했기 때문이다. 열린 상태의 정확한 성격은 "개인정보가 남을 수
있다"가 아니라 "남으면 지울 수단이 시스템에 없다"였다.

## 2. 결정

사용자 결정(2026-08-09): **1개월 뒤 페이로드만 비운다. 행은 지우지 않는다.**

행을 통째로 지우는 쪽과 갈린 지점이 여기다. 감사가 실제로 묻는 것은 "무엇을
받았다고 주장하느냐"이고 그건 해시로 답할 수 있다. 행이 사라지면 "그때 무엇을
물었고 어떤 해시였는가"까지 함께 사라진다.

정리 후 남는 것과 사라지는 것:

| 남는다 | 사라진다 |
|---|---|
| `payload_sha256`, `item_count`, `received_at`, `seq` | `raw_payload_json` 내용 |
| `status`, `result_count`, `correlation_id`, `created_at`, `finished_at` | `request_json` 내용 |
| `redacted_at` (**비운 시각 — 새로 추가**) | |

`redacted_at`이 없으면 "원래 비어 있었다"와 "보존기간이 지나 비웠다"를 구분할 수
없다. 감사에서 그 둘은 전혀 다른 사실이다.

## 3. 구현 — 세 가지 판단

### 3.1 전용 롤을 새로 만들었다 (`une_retention`)

가장 쉬운 길은 `une_worker`에 UPDATE를 주는 것이었고, 그것을 하지 않았다.
ADR-33 D2의 따름정리가 "워커는 상황 계열 테이블에 닿지 않는다"이고
`tests/integration/src/situation-table-rls.test.ts`가 `une_worker`의 42501을
회귀로 고정한다. 보존 작업을 위해 그 롤에 권한을 주면 **그 결정이 조용히
뒤집힌다** — 테스트를 고쳐가면서.

그래서 하는 일이 하나뿐인 롤을 만들었다. 실측한 권한 전량:

```
table_privileges : provider_job SELECT, provider_result SELECT   (그게 전부)
column_privileges: provider_job.request_json      UPDATE
                   provider_job.redacted_at       UPDATE
                   provider_result.raw_payload_json UPDATE
                   provider_result.redacted_at    UPDATE
rolcanlogin=false rolbypassrls=false rolsuper=false
```

INSERT도 DELETE도 없다. `payload_sha256`을 바꾸려 하면 42501이다 — 그래야
"해시는 남는다"가 실제로 보장된다.

설정으로도 되돌릴 수 없게 했다. `UNE_RETENTION_ROLE`이 `UNE_DB_RUNTIME_ROLE`과
같으면 워커가 **기동하지 않는다**. 빈 값도 거부한다(빈 값이면 연결 롤 — 운영에서
테이블 소유자 — 그대로 UPDATE가 돌고 컬럼 단위 권한이 통째로 무의미해진다).

### 3.2 BYPASSRLS가 아니라 정책으로 전 테넌트를 본다

정리는 테넌트를 가리지 않는다. `NOBYPASSRLS`를 유지한 채 그것을 가능하게 하는
방법은 그 롤을 대상으로 하는 정책을 따로 두는 것이다.

```sql
CREATE POLICY p_provider_result_retention ON provider_result
  TO une_retention USING (true) WITH CHECK (true);
```

BYPASSRLS를 주면 "왜 전부 보이는가"가 롤 속성에 숨는다. 정책으로 두면
`pg_policies`에 드러나고, 테스트가 그 사실 자체를 단언한다. 기존 테넌트 정책은
`TO` 절이 없어 모든 롤에 붙지만 정책은 permissive라 OR로 합쳐지고, `une_app`은
위 정책의 대상 자격이 없으므로 **여전히 자기 테넌트만 본다**(회귀 단언 있음).

### 3.3 허용 전이를 트리거로 하나만 남겼다 (0027)

아키텍처 검토가 지적한 자리다. 0026의 CHECK는

```sql
CHECK (redacted_at IS NULL OR raw_payload_json = '{"redacted": true}'::jsonb)
```

**한 방향만** 막는다. 실측으로 두 갈래가 통과하는 것을 확인했다.

```
UPDATE provider_result SET raw_payload_json = '{"forged":1}'   → 성공(!)
UPDATE provider_result SET redacted_at = NULL   (비운 행)       → 성공(!)
```

전자는 0023 §5가 `une_app`에서 UPDATE를 회수하며 지키던 **원문 불변성**이
뚫리는 것이고, 후자는 §2가 `redacted_at`을 넣은 목적("원래 비어 있었다"와
"비웠다"의 구분)이 그 자리에서 무효가 되는 것이다. 컬럼 GRANT는 "어느 컬럼을
쓸 수 있는가"만 말하고 "어떤 값으로"는 말하지 못한다.

0027이 `BEFORE UPDATE` 트리거로 전이를 하나만 남긴다.

```
(내용 = 원문, redacted_at IS NULL) → (내용 = 마스킹 값, redacted_at = 시각)
```

되돌리는 전이도, 두 번 비우는 전이도 없다. 트리거는 롤을 가리지 않는다 —
소유자만 예외로 두면 "마이그레이션으로는 감사 기록을 고칠 수 있다"가 되어
append-only가 반만 참이 된다. 0026의 CHECK는 그대로 두었다(트리거가 무력화되는
경로에서의 최후 방어).

### 3.4 기간을 DB에 박지 않았다

1개월은 운영 설정(`UNE_PAYLOAD_RETENTION_DAYS`, 기본 30)이다. 마이그레이션에
상수로 넣으면 정책이 바뀔 때마다 마이그레이션이 필요해진다. 실행 주체도
pg_cron이 아니라 워커 프로세스다 — 그래야 "언제 몇 건을 비웠는가"가 애플리케이션
로그와 같은 자리에 남는다.

## 4. 운영 설정

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `UNE_PAYLOAD_RETENTION_DAYS` | `30` | 보존기간(일). 사용자 결정 = 1개월 |
| `UNE_RETENTION_ROLE` | `une_retention` | 정리 트랜잭션의 `SET LOCAL ROLE`. 워커 롤과 같으면 기동 실패 |
| `UNE_RETENTION_BATCH_SIZE` | `500` | 한 트랜잭션에서 비우는 최대 행 수(테이블별) |
| `UNE_RETENTION_INTERVAL_MS` | `21600000`(6시간) | 정리 주기. 만료 판정 단위가 '일'이므로 자주 돌 이유가 없다 |
| `UNE_RETENTION_ENABLED` | `true` | `false`면 기동 시 "OB-16이 다시 열린 상태"라고 경고를 찍는다 |

## 5. 검증

```
$ cd services/worker && npx vitest run src/retention
 ✓ src/retention/payload-retention.runner.e2e.test.ts (7 tests) 7221ms
   ✓ 만료분만 비우고 증거 컬럼은 그대로 남긴다
   ✓ 다시 돌아도 이미 비운 행의 redacted_at은 그대로다
   ✓ 테넌트를 가리지 않는다 (전용 롤 정책이 USING (true))
   ✓ 한 번에 비우는 양이 배치 크기를 넘지 않는다
   ✓ 두 러너가 동시에 돌아도 서로의 표식을 덮지 않는다      # QA F1
   ✓ 스윕 결과가 남은 만료분을 함께 알려준다                 # QA R3
   ✓ 보존기간을 늘리면 아무것도 비우지 않는다 (기간은 운영 설정이다)

$ cd services/worker && npx vitest run src/config
 ✓ src/config/worker-config.test.ts (18 tests)      # +5 (보존기간 설정)

$ cd tests/integration && npx vitest run src/payload-retention-grants.test.ts
 ✓ src/payload-retention-grants.test.ts (13 tests) 8635ms
   ✓ 롤은 로그인 불가·RLS 우회 불가다
   ✓ 전 테넌트가 보이는 근거가 정책으로 드러난다
   ✓ 테이블 단위 권한은 SELECT뿐이다 (INSERT/DELETE/TRUNCATE 없음)
   ✓ UPDATE는 페이로드와 표식 컬럼에만 있다
   ✓ 증거 컬럼은 전용 롤로도 바꿀 수 없다
   ✓ 행을 지울 수 없다
   ✓ 표식만 세우고 내용을 남길 수 없다
   ✓ une_app은 여전히 원문을 고치거나 지울 수 없다
   ✓ une_worker는 여전히 두 테이블에 닿지 못한다 (ADR-33 D2)
   ✓ 전용 롤은 테넌트를 세우지 않아도 두 테넌트의 행을 모두 본다
   ✓ une_app에게는 여전히 자기 테넌트만 보인다 (전용 정책이 새지 않는다)
   ✓ 원문을 임의 값으로 덮어쓸 수 없다 (마스킹 값만 허용)      # 0027
   ✓ 이미 비운 행은 표식을 지우거나 다시 쓸 수 없다            # 0027

$ cd tests/integration && npx vitest run src/migrations.test.ts
 ✓ src/migrations.test.ts (8 tests)                 # 27개 마이그레이션, 테이블 63 유지
```

뒤의 두 단언은 0027을 붙이기 전에 먼저 돌려 **둘 다 `NO_ERROR`로 실패하는
것을 확인**했다 — 지적이 이론이 아니라 실제 경로임을 확인한 뒤 막았다.

동시 스윕 테스트도 같은 방식으로 검증했다. `FOR UPDATE SKIP LOCKED`를 뺀
상태로 먼저 돌려 **0027 트리거가 배치를 통째로 롤백하는 것**을 확인했다
(`이미 비운 provider_result 행은 다시 쓸 수 없다`). 테스트가 우연히 초록인
것이 아니라 두 스윕이 실제로 겹친다는 뜻이다.

테이블 수는 63 그대로다 — 0026은 컬럼·롤·정책만, 0027은 함수·트리거만 추가한다.

## 6. 작업 중 드러난 선재 결함 — 롤 멤버십이 프로비저닝되지 않는다

이 작업에서 발견했고 **이 작업이 만든 것이 아니다.** 0015(CC-120)부터 있던
상태다. 실측:

```
$ psql "postgres://une_app:***@localhost:5432/une"
SET LOCAL ROLE une_worker    → 42501 permission denied to set role "une_worker"
SET LOCAL ROLE une_retention → 42501 permission denied to set role "une_retention"
```

`infrastructure/initdb/01-app-role.sh`는 `une_app` 로그인 롤만 만들고,
`une_worker`/`une_retention`은 마이그레이션이 `NOLOGIN`으로 만든다. 그 사이를
잇는 `GRANT une_worker TO <로그인 롤>`이 저장소 어디에도 없다 — initdb·compose·
CI·스크립트 전부 확인했다. 워커의 `.env.example`은 `une_app`으로 접속하라고
적고 있으므로 **문서대로 띄우면 워커는 첫 트랜잭션에서 42501로 죽는다.**

드러나지 않은 이유는 테스트가 superuser로 접속해 강등하기 때문이다(모든 롤로
`SET ROLE` 가능). 보존 러너도 같은 방식으로 검증했다.

**여기서 고치지 않은 이유.** 고치는 방법이 두 갈래인데 한쪽은 이 작업이 세운
경계를 스스로 무너뜨린다.

- `GRANT une_retention TO une_app` — API 런타임이 보존 롤을 가정할 수 있게 된다.
  API 경로의 SQL 인젝션 하나가 전 테넌트의 원문을 비울 수 있다는 뜻이다.
  §3.1이 워커 롤에 권한을 얹지 않은 것과 같은 이유로 하지 않는다.
- **워커 전용 로그인 롤을 프로비저닝하고 그쪽에만 멤버십을 준다** — 옳은 방향이나
  initdb는 마이그레이션보다 먼저 돌아 대상 롤이 아직 없고, compose·CI·배포
  문서·`.env.example` 세 벌이 함께 바뀐다. 보존기간 결정과 무관한 배포 범위다.

`UNE_DB_RUNTIME_ROLE=''`(빈 값)이면 `SET LOCAL ROLE`을 건너뛰므로 현재는 그
경로로 우회할 수 있지만, 그때는 접속 롤 그대로 돌아 최소권한이 사라진다.
보존 롤은 그 우회를 **막았다**(`UNE_RETENTION_ROLE`은 빈 값을 거부한다) —
빈 값을 허용하면 0026이 컬럼 단위로 좁혀둔 권한이 통째로 무의미해지기 때문이다.

**OB-17로 등재했다**(`docs/handoff/OPEN_BINDINGS.md`). 인계 표만 보는 사람이
"OB-16 Closed"를 "이제 원문이 정리된다"로 읽지 않도록 OB-16 종결 행에도
차단 사실을 함께 적었다. 지금 상태는 **수단은 갖췄으나 아직 돌지 않는다**이다.

`GRANT une_retention TO une_app`이 특히 나쁜 이유를 하나 더 적어 둔다. 그
GRANT는 기본이 `INHERIT`라 권한만 물려주는 것이 아니라 `pg_has_role`로 **정책
대상 자격까지** 물려준다 — §3.2의 `USING (true)` 정책이 `une_app`에도 붙어
API 런타임이 전 테넌트 원문을 **보게 된다.** 이 마이그레이션이 세운 경계가
그 한 줄로 통째로 무너진다.

올바른 형태는 워커 전용 로그인 롤이고, 그 롤에 멤버십을 줄 때 PostgreSQL 16의
`GRANT ... WITH INHERIT FALSE, SET TRUE`로 상속 없이 `SET ROLE`만 준다.

## 7. 이번 결정이 닫지 않은 것

- **`file_object`의 보존기간.** 0020이 같은 이유로 미룬 항목이며 이 결정의
  대상이 아니다. 그쪽은 DB 행뿐 아니라 오브젝트 저장소 객체를 함께 정리해야
  하고, 실패 시 "메타데이터는 지워졌는데 객체는 남는" 상태가 생긴다 — 별도
  판단이 필요하다.
- **개인정보 보존 정책 문서 자체.** 30일은 기술적 기본값이고, 법·계약이
  요구하는 기간이 다르면 설정으로 맞춘다. 근거 문서는 UNE 밖에서 온다.
- **이미 비운 데이터의 복구 경로.** 없다. 그것이 이 기능의 목적이다.
