# CC-240 증거 — UNI SOP 생성과 버전 관리 UniSopMapper

- 항목: CC-240 (UNE-SOP-001, UNE-SOP-002, UNE-SOP-017 신설)
- 결정 정본: **ADR-38** (D1~D21, 수용 한계 14)
- 마이그레이션: `0032_sop_graph_and_generation.sql`, `0033_worker_sop_source_reads.sql`,
  `0034_revoke_worker_sop_version_update.sql`
- 작성: 2026-08-10 (이중 검토 반영 후 재측정)

## 1. 무엇이 동작하는가

확정 SituationSnapshot + 동결 EvidenceSet → UNI `/chat/json` SSE →
UniSopMapper → DRAFT SopGraph(버전) → SSE로 사용자에게 투영.

```
POST /situations/{id}/sop-generation-jobs      (201 QUEUED, 멱등키 필수)
  → SopJobRunner: claim → 근거 검증 → UNI 호출(트랜잭션 밖) → 그래프 적재
GET  /sop-generation-jobs/{jobId}/events       (SSE, Last-Event-ID 재개)
POST /sop-generation-jobs/{jobId}/cancel       (202, UNE 신설 — ADR-38 D19)
```

## 2. 실행한 검증 (검토 반영 후)

| 대상 | 결과 |
|---|---|
| 도메인 (`packages/domain` `src/sop`) | 26 pass |
| UNI SOP 어댑터·매퍼·파서 (`src/uni/sop`) | 54 pass |
| 워커 러너 e2e (실 PostgreSQL) | 14 pass |
| 통합 — SOP RLS + 워커 최소권한 | 18 pass |
| 통합 — 전체 | 193 pass |
| 계약 게이트 (`sop.contract.test.ts`) | 19 pass |
| 계약 — 전체 | 265+ pass |
| API 슬라이스 e2e | 17 pass |
| `pnpm typecheck` / `lint` / `format:check` | 통과 |
| `node scripts/validate-contracts.mjs` | PASS |

마이그레이션 31 → 34, 테이블 63 유지, 데이터사전 63/627.

## 3. 착수 시점 실측으로 찾은 결함

### 3.1 `sop_version`·`sop_node`·`sop_edge`에 RLS 정책이 없었다

0008이 `sop`에만 정책을 걸었고 자식 셋은 비어 있었다. 0011이 `une_app`에 전
테이블 DML을 일괄 부여하므로 **정책 없는 테이블은 전 테넌트 공개**였다.

**세 번째다** — 0023(상황 여섯), 0031(근거 둘), 0032(SOP 셋). 매번 "그 항목이
첫 쓰기 경로를 여는 순간" 발견됐다.

### 3.2 워커에 상황 계열 읽기 권한이 없었다 (0033)

러너를 돌리자 `permission denied for table situation`으로 잡이 RUNNING에
멈췄다. 0032가 출력만 열고 **입력을 잊었다.** 3.1과 방향이 반대라 결과도
반대다: 정책 누락은 조용한 전 테넌트 공개, GRANT 누락은 시끄러운 정지.

### 3.3 `SELECT ... FOR UPDATE`가 열 단위 GRANT로는 안 된다

PostgreSQL은 행 잠금에 **테이블 단위** UPDATE 권한을 요구한다. 잠금을 얻자고
`sop` 전체 UPDATE를 주면 워커가 제목·재난유형까지 바꿀 수 있다 — 잠금을
버렸다(ADR-38 D15).

### 3.4 `EDGE_FROM_END` — mock 스트림이 찾아낸 검증 구멍

END 뒤에 노드가 하나 더 오면 순차 연결이 END를 통과하는데, DAG는 성립하고
END도 있어 `CYCLE`·`NO_END` 어느 것도 잡지 못했다.

### 3.5 노드 키가 그래프 교환 스키마를 만족하지 않을 수 있었다

`sop-graph.schema.json`이 키를 `^[A-Za-z][A-Za-z0-9_-]{1,79}$`로 못박고 있는데
매퍼는 아무 문자열이나 받았다. 저장은 되고 **CC-250의 내보내기가 깨진다.**

### 3.6 계약 게이트가 `UNI-503-003`을 "죽은 코드"로 판정했다

사실이 아니었다 — 비동기라서 `job.failed` payload로 도착한다. 게이트가 API
파일만 읽고 있었다.

## 4. 이중 검토가 찾은 것 (전건 반영)

착수 시점 결함과 별개로, **검토가 아니었으면 남았을** 결함들이다.

### 4.1 BLOCKER — QUEUED SOP 잡을 취소할 수 없었다 (실측 재현)

`POST /plan-jobs/{jobId}/cancel`이 `restorePlanStatusOnAbort`를 무조건 부르고,
그 안의 `findPlan(tenantId, aggregateId)`가 SOP 잡의 `situationId`를 계획서로
찾다 실패해 `PLAN-4003`을 던진다. **그 404가 같은 트랜잭션의 CANCELLED 기록까지
되돌린다.**

측정: `CANCEL STATUS 404 {"code":"PLAN-4003"}` / `JOB STATUS AFTER CANCEL QUEUED`.

막다른 길이었다 — `SOP-409-001`이 사용자에게 "진행 중인 Job을 기다리거나
취소하십시오"라고 안내하는데 그 취소가 동작하지 않았고, 워커가 아직 집지 않은
잡(=대부분)에서는 재요청도 막혔다. ADR-38 수용 한계 10의 "취소는 기존 경로가
그대로 동작한다"는 **거짓이었다.**

닫은 방법: PLAN 잡일 때만 계획서 상태를 되돌리고, SOP 전용 취소 엔드포인트
(UNE-SOP-017)를 신설했다.

### 4.2 BLOCKER — 잡 유형을 검사하지 않아 도메인 권한이 서로 통과했다

`generation_job`은 도메인을 가리지 않는데 `JobSseService`가 유형을 보지 않았다.
`SOP_READ`만 가진 사용자가 `/sop-generation-jobs/{planJobId}/events`로 계획서
본문(`content.block`)을 읽고, 반대로 `PLAN_READ`로 SOP 그래프를 읽을 수 있었다.
취소도 같은 구멍이었다.

닫은 방법: 조회·스트림·취소·재시도 네 곳에 허용 유형을 명시하고 벗어나면
404(존재 은닉). e2e가 SOP 전용 사용자로 두 방향을 모두 시험한다.

### 4.3 같은 키로 접히는 노드가 트랜잭션 전체를 되돌렸다

`"3"`과 `"#3"`이 둘 다 `n3`로 정규화된다. 유니크 제약이 23505를 던지면 잡이
RUNNING에 머물다 리스 만료 → 재클레임 → 같은 실패 반복 → **`MAX_ATTEMPTS_EXCEEDED`
라는 엉뚱한 사유**로 끝난다. "위반과 함께 저장한다"(D4)는 원칙이 이 경우에
성립하지 않았다. 조립 단계에서 키 충돌을 해소한다.

### 4.4 provider 문자열 길이를 검증하지 않았다

UNI `name`에는 길이 제한이 없고 `sop_node.title`은 varchar(300)이다. 22001이
같은 실패 모드를 만든다. `fitTitle` + `TITLE_TRUNCATED` 경고로 닫았다.

### 4.5 0032가 워커에 쓰지 않는 `sop_version` UPDATE를 줬다

그 권한으로 기존 버전의 `graph_hash`·출처를 감사 없이 갈아치울 수 있었다.
0034가 회수했고, 통합 테스트가 권한 목록을 고정한다.

### 4.6 UNI DTO와 매퍼가 도메인에 있어 의존 방향이 뒤집혔다

어댑터 포트가 도메인에서 provider DTO를 import하고 있었다. 매퍼를
`packages/provider-adapters/src/uni/sop/uni-sop-mapper.ts`로 옮겼다(ADR-38 D18).

### 4.7 근거 범위 이탈을 검출할 데이터를 쥐고도 검출하지 않았다

ADR이 "UNE가 사후에 잡지 못한다"고 적었는데, 요청 범위와 응답 출처가 둘 다
손에 있었다. `SOURCE_OUT_OF_SCOPE` 경고 + `outOfScopeNodeCount`로 닫았다.
**차단하지는 않는다** — 표시하고 사용자가 판단한다.

### 4.8 provider 문서 id가 공개 계약과 저장소로 그대로 나갔다

`sop.sources`와 `sourceRefs`가 UNI의 `doc_id`를 실었다. 클라이언트가
`knowledge_document`와 대조할 수 없고, UNI가 id 체계를 바꾸면 근거 참조가
끊긴다. UNE id로 투영하고 provider id는 따로 싣는다.

### 4.9 설계 08 §1.14의 "첫 이벤트 30초"가 집행되지 않았다

데드라인 검사가 `reader.read()` **뒤**에 있어, UNI가 200만 열고 침묵하면 한
번도 실행되지 않고 실제 상한이 5분이 됐다. `Promise.race`로 고쳤고 침묵
스트림 테스트를 추가했다(2초 안에 끊긴다).

### 4.10 마지막 줄에 개행이 없으면 정상 종료가 오류로 뒤집혔다

`data: [DONE]`으로 끝나며 개행이 없는 스트림에서 남은 버퍼를 흘려보내지
않았다. mock은 줄 단위로 넣으므로 이 층을 통과하지 않아 드러나지 않았다 —
D10이 약속한 "가정을 실제 파서에 통과시킨다"가 프레이밍 파서까지만 유효했다.

### 4.11 그 밖에 반영

- provider `__error__` 원문이 공개 SSE로 나갔다 → 내부 이벤트로만(ADR-38 D21).
- 원문이 200KB를 넘으면 **전량 소실**됐다 → 앞에서부터 담고 버린 수를 적는다.
- 계약이 선언한 `SOP-404-002`를 아무도 던지지 않았다 → `JOB-404-001`로 정정하고,
  게이트가 **정의가 아니라 호출**을 보도록 강화했다.
- mock이 요청 범위와 무관한 문서 id를 인용해 정상 경로가 전부 "범위 밖"으로
  보였다(내가 추가한 범위 검출 테스트가 잡았다).
- `HttpUniSopAdapter` 주석의 capability 진술이 레지스트리와 달랐다.
- 정적 가드(AT-T3Q-011)가 `main.ts`의 UNI 심볼을 잡았다 → 조립을
  `sop/sop-wiring.ts`로 옮겼다. `main.ts`는 플랜 러너도 조립하므로 **예외로
  둘 수 없다** — 그 규칙이 가장 필요한 자리다.

## 5. 증명한 규칙

- **원문이 남는다.** 성공 `provider.responded` / 실패 `provider.failed`에 수신
  순서 그대로(200KB 안에서). 프롬프트 본문은 어디에도 없다(길이만).
- **provider 어휘도 값도 새지 않는다.** SSE에 `__compn__`·`provider.*`·UNI 문서
  id·UNI 오류 문장이 없다.
- **위반이 있어도 DRAFT로 남는다.** `EDGE_FROM_END`가 `graph_violations`에.
- **깨진 노드 하나가 나머지를 죽이지 않는다.** `rejectedNodeCount: 1` + 3노드 생존.
- **재생성은 새 버전이다.** `sops: 1, versions: 2`.
- **끊긴 스트림은 실패다.** FAILED + `partialNodeCount > 0`, 그래프 없음.
- **워커는 상태 한 칸만 쓴다.** 제목·`current_snapshot_id`·기존 버전 수정은 42501.
- **mock 산출물이 데이터 층에서 구분된다.** `sop_version.generated_by_mock`.
- **HTTP 경계.** 401 / 403 / 404(타 기관·타 도메인, 존재 은닉) / 409(활성 잡·낡은
  판) / 412(확정 전) / 422(미동결 근거) / 멱등 재요청 동일 Job / 취소 202.

## 6. 남은 조건

ADR-38 수용 한계 14개가 정본이다. 배포·연동에 직접 걸리는 것:

1. **OB-04**: SSE 프레이밍과 `/chat/json` 요청 필드명이 UNE 가정이다.
   capability `sopGeneration = UNE_ADAPTER_READY`.
2. **OB-17**: 워커 전용 로그인 롤이 없으면 SOP 러너도 첫 트랜잭션에서 42501이다.
3. **증분 스트리밍이 아니다** (수용 한계 4).
4. **캔버스 좌표와 승인본 포인터 규칙**은 CC-250 (수용 한계 7·14).
5. **`job_event` 원문 보존기간**이 OB-16 범위 밖이다 (수용 한계 12).
