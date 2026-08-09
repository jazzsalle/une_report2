# ADR-35: Provider 원문·요청조건의 보존기간과 전용 마스킹 롤

- 상태: ACCEPTED (2026-08-09, CC-210 후속 — OB-16 종결)
- 관련: **ADR-33**(CC-200 D2·D4와 수용 한계 4), **ADR-34**(CC-210),
  마이그레이션 **0026**·**0027**, `docs/evidence/OB-16-payload-retention.md`,
  `docs/handoff/OPEN_BINDINGS.md` OB-16/OB-17,
  `.claude/rules/{security,database,backend,architecture}.md`, CLAUDE.md 비협상 규칙
- 범위: `provider_result.raw_payload_json`과 `provider_job.request_json`의
  수명. `file_object`(오브젝트 저장소 객체를 함께 지워야 한다)와 개인정보
  보존정책 문서 자체는 대상이 아니다.

## 배경: 비협상 규칙 두 개가 정면으로 부딪힌다

0023이 두 필드를 **영구** 보존하게 만들었다. 근거는 CLAUDE.md의 비협상
규칙이다 — "External provider payloads stay behind adapters and are retained
as raw payloads for traceability."

같은 문서 계열의 `.claude/rules/security.md`는 반대 방향을 요구한다 —
"Mask or minimize personal information in UI, logs, exports, and **provider
requests**." `request_json.query`는 형태가 정해지지 않은 객체이고 사용자가
주소·성명·연락처를 검색조건에 넣으면 그대로 남는다. 응답 원문도 마찬가지다.

그리고 **사후에 가릴 방법이 없었다.** 0023이 두 테이블에서 `une_app`의
UPDATE/DELETE를 회수했기 때문이다. OB-16이 열려 있던 정확한 성격은 "개인정보가
남을 수 있다"가 아니라 **"남으면 지울 수단이 시스템에 없다"**였다.

CLAUDE.md는 이런 자리에서 "Stop and create an ADR/change request"라고 지시한다.
이 ADR이 그 기록이다. ADR-33 수용 한계 4가 이 항목을 미뤄 둔 자리였다.

## D1. 행을 지우지 않고 내용만 비운다

**결정**(사용자, 2026-08-09): 보존기간이 지나면 두 필드의 **내용만**
`{"redacted": true}`로 덮는다. 행은 남는다. 기본 30일(1개월).

| 남는다 | 사라진다 |
|---|---|
| `payload_sha256`, `item_count`, `received_at`, `seq` | `raw_payload_json` 내용 |
| `status`, `result_count`, `correlation_id`, `created_at`, `finished_at` | `request_json` 내용 |
| `redacted_at`(비운 시각 — 0026이 신설) | |

**근거**: 감사가 실제로 묻는 것은 "무엇을 받았다고 주장하느냐"이고 그것은
해시로 답할 수 있다. 행을 통째로 지우면 "그때 무엇을 물었고 어떤 해시였는가"
까지 함께 사라진다.

`redacted_at`이 필요한 이유: 그것이 없으면 "원래 비어 있었다"와 "보존기간이
지나 비웠다"를 구분할 수 없다. 감사에서 그 둘은 전혀 다른 사실이다.

**이 결정이 좁히는 비협상 규칙 두 개** — 그 사실을 여기 명시한다.

1. "retained as raw payloads for traceability" → **추적성의 실질은 영구,
   내용은 30일.** 추적성이 답해야 하는 질문(무엇을 언제 받았다고 주장하는가,
   그 주장이 위조되지 않았는가)은 해시·항목수·시각으로 계속 답할 수 있다.
2. "never overwrite audit history" → **감사 기록의 골격은 덮지 않고, 내용
   필드 하나만 한 방향으로 덮는다.** 되돌리는 전이도 두 번 비우는 전이도
   없다(D3).

두 규칙 모두 개인정보 최소화 요구와 동시에 만족시킬 수 없었고, 둘 중
`security.md`가 요구하는 쪽을 법·계약이 강제한다.

## D2. 워커 롤이 아니라 전용 롤 `une_retention`으로 돈다

**결정**: 0026이 하는 일이 하나뿐인 롤을 새로 만든다. `SELECT` 2건 +
컬럼 단위 `UPDATE` 4건이 권한 전량이고 INSERT·DELETE는 없다.
`NOLOGIN NOSUPERUSER NOBYPASSRLS`.

**근거**: 가장 쉬운 길은 `une_worker`에 UPDATE를 주는 것이었고 그것을 하지
않았다. ADR-33 D2의 따름정리가 `une_worker`의 무권한을 회귀 단언으로 고정하고
있어(`tests/integration/src/situation-table-rls.test.ts`), 보존 작업을 위해 그
롤에 권한을 주면 **테스트를 고쳐가면서 그 결정이 조용히 뒤집힌다.**

**ADR-33 D2 따름정리의 재정의**(같은 날 ADR-33 본문도 개정했다): 그것은
**롤 권한 경계**이지 프로세스 경계가 아니다. 워커 *프로세스*는 전용 롤로 이
두 테이블을 정리하지만 `une_worker` *롤*의 42501은 그대로다. 상황 수집·Fact
생성·상태전이는 여전히 워커에 없다 — 보존 정리는 도메인 로직이 아니라 데이터
수명 관리이며 Fact를 만들지도, 상황을 옮기지도, Provider를 부르지도 않는다.

**설정으로도 되돌릴 수 없게 했다.** `UNE_RETENTION_ROLE`이
`UNE_DB_RUNTIME_ROLE`과 같으면 워커가 기동하지 않고, 빈 값도 거부한다(빈 값을
허용하면 접속 롤 그대로 UPDATE가 돌아 컬럼 단위 권한이 통째로 무의미해진다).
`WorkerDatabase.withRetentionScope`는 롤을 인자로 받지 않는다 — 받으면 그
기동 가드를 호출부가 우회할 수 있다.

## D3. 허용 전이는 하나뿐이며 트리거가 그것을 고정한다

**결정**: 0027이 두 테이블에 `BEFORE UPDATE` 트리거를 걸어 다음 전이 하나만
허용한다.

```
(내용 = 원문, redacted_at IS NULL) → (내용 = 마스킹 값, redacted_at = 시각)
```

**근거**: 0026의 CHECK는 `redacted_at IS NULL OR 내용 = 마스킹값`이라 **한
방향만** 막는다. 실측으로 확인했다 — 다음 둘이 모두 성공했다.

- `UPDATE provider_result SET raw_payload_json = '{"forged":1}'`
  (`redacted_at`은 NULL 유지) → 0023 §5가 지키던 **원문 불변성이 뚫린다**
- `UPDATE provider_result SET redacted_at = NULL` (이미 비운 행)
  → `redacted_at`의 목적이 그 자리에서 무효가 된다

컬럼 GRANT는 "어느 컬럼을 쓸 수 있는가"만 말하고 "어떤 값으로"는 말하지
못한다. D1이 "한 방향으로만 덮는다"고 선언했으므로 그 한 방향을 DB가 강제해야
선언이 실제가 된다.

트리거는 **롤을 가리지 않는다** — 테이블 소유자에게도 걸린다. 소유자만 예외로
두면 "마이그레이션으로는 감사 기록을 고칠 수 있다"가 되어 append-only 규칙이
반만 참이 된다. 뒷날 정당한 사유가 생기면 그 마이그레이션이
`ALTER TABLE … DISABLE TRIGGER`를 명시적으로 적어야 하고, 그 한 줄이 곧
감사 기록이 된다.

## D4. BYPASSRLS가 아니라 롤 대상 정책으로 전 테넌트를 본다

**결정**: `NOBYPASSRLS`를 유지한 채 `TO une_retention USING (true)` 정책을
따로 둔다.

**근거**: BYPASSRLS를 주면 "왜 전부 보이는가"가 롤 속성에 숨는다. 정책으로
두면 `pg_policies`에 드러나고 테스트가 그 사실 자체를 단언한다. 기존 테넌트
정책은 `TO` 절이 없어 모든 롤에 붙지만 정책은 permissive라 OR로 합쳐지고,
`une_app`은 이 정책의 대상 자격이 없으므로 여전히 자기 테넌트만 본다(회귀
단언 있음). 0011부터 이 저장소가 유지해 온 방향과 같다.

## D5. 기간은 DB가 아니라 운영 설정이고, 실행 주체는 워커 프로세스다

**결정**: `UNE_PAYLOAD_RETENTION_DAYS`(기본 30). 마이그레이션에 상수로 넣지
않는다. pg_cron이 아니라 워커 프로세스의 별도 타이머
(`UNE_RETENTION_INTERVAL_MS`, 기본 6시간)로 돈다.

**근거**: 법·계약이 요구하는 기간은 UNE 밖에서 오고 바뀔 수 있다. 상수로
박으면 정책이 바뀔 때마다 마이그레이션이 필요해진다. 실행 주체가 워커인
이유는 "언제 몇 건을 비웠는가"가 애플리케이션 로그와 같은 자리에 남기
위해서다. 플랜 잡 폴러에 얹지 않은 이유는 폴러의 주기가 초 단위이고 이
작업의 만료 단위가 '일'이기 때문이다.

## D6. 스윕 실행 사실을 감사 원장에 남기지 않는다

**결정**: 스윕은 애플리케이션 로그에만 남긴다(0건이어도 남긴다).
`audit_log`에 행을 넣지 않는다.

**근거**: 넣으려면 전용 롤에 `audit_log` INSERT를 줘야 하고, 그 순간 "하는
일이 하나뿐인 롤"이라는 D2의 성격이 사라진다. 행 단위 `redacted_at`이 이미
"무엇이 언제 비워졌는가"에 답하므로 원장의 추가 가치가 그 대가보다 작다.

**대가**: "스윕이 돌았는가"는 로그 보존에 의존한다. 0건 스윕과 실패한 스윕이
로그상 구분되도록 성공은 건수와 무관하게 한 줄씩 남긴다(cutoff 포함).

## 수용 한계

1. **`file_object`의 보존기간은 열려 있다.** 0020이 같은 이유로 미룬 항목이며
   DB 행뿐 아니라 오브젝트 저장소 객체를 함께 정리해야 한다 — 실패 시
   "메타데이터는 지워졌는데 객체는 남는" 상태가 생겨 별도 판단이 필요하다.
2. **개인정보 보존정책 문서 자체가 없다.** 30일은 기술적 기본값이고 법·계약이
   요구하는 기간이 다르면 설정으로 맞춘다. 근거 문서는 UNE 밖에서 온다.
3. **이미 비운 데이터의 복구 경로가 없다.** 그것이 이 기능의 목적이다.
4. **배포 전 차단 항목 — 롤 멤버십이 프로비저닝되지 않는다(OB-17).**
   `une_app`은 `SET ROLE une_retention`도 `SET ROLE une_worker`도 할 수 없다.
   0015(CC-120)부터 있던 선재 결함이며 이 작업이 만든 것이 아니다. 지금
   `services/worker/.env.example`대로 워커를 띄우면 **스윕이 한 번도 돌지
   않고 원문이 무기한 남는다.** 여기서 `GRANT une_retention TO une_app`으로
   닫지 않은 이유: 그 GRANT는 기본이 INHERIT라 권한뿐 아니라 `pg_has_role`로
   **정책 대상 자격까지** 물려주므로 D4의 `USING (true)`가 `une_app`에 붙고
   API 런타임이 전 테넌트 원문을 보게 된다 — D2가 세운 경계가 한 줄로 무너진다.
   올바른 해법은 **워커 전용 로그인 롤**이며, 그 롤에 멤버십을 줄 때
   PostgreSQL 16의 `WITH INHERIT FALSE, SET TRUE`로 상속 없이 `SET ROLE`만
   준다. initdb·compose·CI·배포 문서가 함께 바뀌는 배포 범위다.
5. **테스트는 superuser 접속 위에서 성립한다.** 통합·e2e 모두 접속 후
   `SET ROLE`로 강등하므로 수용 한계 4의 실패를 구조적으로 잡지 못한다.
   초록이라는 사실이 그것을 반증하지 않는다.
6. **`main.ts`의 보존 배선에 테스트가 없다**(QA R2). 활성/비활성 분기, 타이머,
   예외 삼킴, 로그 내용 어느 것도 테스트를 지나지 않는다 — "롤이 없어도 워커는
   살아 있다"는 코드 읽기로만 확인된 사실이다. 러너 자체(`sweep()`)는 e2e 7건이
   덮는다.
7. **트랜잭션 실패 시 부분 정리가 없다는 것에 테스트가 없다**(QA R7).
   `withRetentionScope`가 두 UPDATE를 하나의 BEGIN/COMMIT으로 감싸므로 코드상
   보장되지만 단언은 없다.

## 재검토 트리거

- `file_object` 보존 결정(수용 한계 1)
- 법·계약이 요구하는 보존기간 확정(수용 한계 2)
- OB-17 종결 — 워커 전용 로그인 롤 프로비저닝(수용 한계 4)
- 감사 요구가 "스윕 실행 자체"의 원장 기록을 요구하게 될 때(D6 재평가)
