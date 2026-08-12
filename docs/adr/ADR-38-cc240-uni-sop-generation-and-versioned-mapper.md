# ADR-38 — CC-240: UNI SOP 생성과 버전 관리 UniSopMapper

- 상태: 채택 (2026-08-10)
- 범위: UNE-SOP-001/002, 설계 08 §1.8/§1.11/§1.14, 설계 10 SOP 표, 마스터 §22
- 관련: ADR-25(잡 상태기계), ADR-26(원문 보존), ADR-33(상황), ADR-36(UNI 워커 경계), ADR-37(동결 EvidenceSet)
- 마이그레이션: `0032_sop_graph_and_generation.sql`, `0033_worker_sop_source_reads.sql`,
  `0034_revoke_worker_sop_version_update.sql`

## 배경

확정 SituationSnapshot과 동결 EvidenceSet 위에서 UNI가 구조화 SOP를 만든다.
UNI는 `/chat/json`으로 **SSE 스트림**을 보내고(설계 08 §1.11), UNE는 그것을
표준 SopGraph로 옮겨 DRAFT 버전으로 저장한다.

착수 시점에 열려 있던 것.

- `sop_version`·`sop_node`·`sop_edge`에 **RLS 정책이 없었다**(0008은 `sop`에만 걸었다).
- SOP 네 테이블에 어휘 CHECK도 상관식도 FK도 없었다.
- `/chat/json`의 **SSE 프레이밍이 계약에 없다**(OB-04). 이벤트 **이름**만 설계에 있다.
- 워커가 상황 계열 테이블을 읽는 경로가 **한 번도 없었다**.

## 결정

### D1. 매퍼에 버전을 붙이고 그 값을 결과에 남긴다

`UNI_SOP_MAPPER_VERSION = 'uni-sop-1'`을 `sop_version.schema_version`에 적는다.
UNI compns 구조가 UNE 표준과 일치한다는 보장이 없고(설계가 명시한다) 저쪽이
바꿀 수 있다. 어느 규칙으로 옮겼는지가 남지 않으면 나중에 그래프가 이상할 때
**UNI가 바꾼 것인지 우리가 잘못 옮긴 것인지 알 수 없다.**

### D2. 계약의 `schemaVersion`과 매퍼 버전은 **다른 값이다**

계약 `SopGenerationRequest.schemaVersion`은 `'1.0'`(그래프 스키마)이고 매퍼
버전은 `'uni-sop-1'`이다. 한 값으로 합치면 매퍼를 고쳤을 때 클라이언트 계약이
깨진 것처럼 보인다. 경계에서 `graphSchemaVersion`으로 이름을 바꿔 받는다.

### D3. 매핑 실패는 **경고이지 거부가 아니다** — 단, 두 가지는 거부한다

설계 08 §1.11이 "누락 필드는 Validator warning으로 반환한다"고 못박았다.
CC-220/230의 "모르면 거부한다"와 규칙이 다른데 이유가 있다 — 여기는
**스트리밍**이다. `__compn__`이 하나씩 도착해 Canvas에 즉시 쌓이므로, 필드
하나가 비었다고 응답 전체를 버리면 이미 그려진 노드까지 사라진다.

거부하는 것은 둘뿐이다: **노드 키 없음**(가리킬 수 없다), **모르는 노드 유형**
(실행기가 무엇을 할지 모른다). 거부는 **노드 단위**이고 나머지는 살아남는다.

### D4. 그래프 검증 위반은 **실패가 아니다**

`validateSopGraph`가 위반을 찾아도 Job은 COMPLETED이고 버전은 DRAFT로
저장된다. 위반은 `sop_version.graph_violations`에 남는다. 저장하지 않으면
사용자가 Canvas에서 **고칠 대상이 없다**(CC-250).

### D5. 노드 키를 계약 규칙에 맞춰 정규화하고 원본을 남긴다

`contracts/schemas/sop-graph.schema.json`이 노드 키를
`^[A-Za-z][A-Za-z0-9_-]{1,79}$`로 못박고 있다. UNI가 숫자나 한글로 시작하는
`compnSn`을 주면 그대로 저장한 그래프는 **나중에 내보낼 수 없다** — 그때
발견하면 이미 쌓인 버전들을 손봐야 한다. 정규화하고 `NODE_KEY_NORMALIZED`
경고를 붙이며 원래 값은 `providerNodeKey`(노드 `config_json`)에 남긴다. 키 규칙은 **계약의 것이므로**
정규화 함수는 도메인에 있고(`normalizeNodeKey`), 어느 provider 필드가
노드 키인가만 어댑터가 안다(D18).
`providerNodeKey`는 **그래프 해시에 넣지 않는다** — 같은 절차인데 UNI가 내부
일련번호만 바꿔 보내면 "바뀐 절차"로 읽힌다.

### D6. 간선은 UNE가 만든다. DECISION 뒤는 잇지 않는다

UNI `__compn__`에 "다음 노드"에 해당하는 필드가 없다(설계 08 §1.11의 필드는
`compnSn/type/name/task/branch/source`뿐이다). UNE가 도착 순서로 잇되
**DECISION 뒤는 잇지 않는다** — 분기의 갈래를 순서로 추측하면 틀린 절차를
사실처럼 그린다. 대신 `DECISION_WITHOUT_BRANCH` 위반으로 남겨 사용자가 그린다.
이 규칙은 매퍼 버전에 묶여 있다.

### D7. `EDGE_FROM_END` 위반을 새로 만들었다

mock 스트림 실측에서 나왔다. UNI가 `END` 뒤에 `__compn__`을 하나 더 보내면
순차 연결이 END를 **통과해 버린다.** DAG는 성립하므로 `CYCLE`에 걸리지 않고
`END`도 있으므로 `NO_END`에도 걸리지 않는다 — 기존 규칙 어느 것도 잡지 못했다.

### D8. `__done__` 없이 끝난 스트림은 부분 결과가 아니라 **오류다**

레거시 T3Q `[DONE]` 규칙과 같은 원리다. 대신 실패에 `partialNodeCount`를
실어 "이미 몇 개를 받았는가"를 알린다 — 설계 08 §1.11이 `__error__`를
"부분결과 폐기 또는 **사용자 선택**"으로 적었으므로, 어댑터는 판단하지 않고
사실만 전한다.

### D9. SSE 프레이밍은 `.assumed` 표기로 가정임을 드러낸다

T3Q RPT-002와 같은 규약이다(`legacy-sse.ts`, `target-v2-sse.assumed.ts`).
`uni-sop-sse.assumed.ts`가 가정하는 것: `data:` 한 줄에 JSON 객체 하나, 그
객체의 **키**가 이벤트 이름, `[DONE]` 리터럴로 종료. UNI가 답하면(CC-410) 이
파일이 provider 진실에 맞춰 재검증되지 그 반대가 아니다.

### D10. mock이 **가짜 SSE 본문을 만들어 실제 파서에 통과시킨다**

이벤트 객체를 곧장 돌려주면 `.assumed` 프레이밍 가정이 한 번도 실행되지 않아,
그 가정이 틀렸을 때 실 연동 시점까지 드러나지 않는다. T3Q mock과 같은 형태다.

### D11. 공개 SSE 어휘는 UNE의 것이다

UNI 원문 이벤트(`__compn__`/`__sources__`)를 그대로 흘리지 않고 `sop.node`/
`sop.sources`로 투영한다. 어휘가 provider의 것이면 provider가 바뀔 때
클라이언트 계약이 함께 깨진다. `__thinking__`은 설계 08 §1.11이 "사용자
화면에 표시하지 않는다"고 적었으므로 SSE로도 나가지 않는다(원문에는 남는다).

### D12. `UNI-503-003`은 HTTP 오류가 아니라 `job.failed` payload 코드다

SSE는 이미 200으로 열려 있으므로 UNI 실패를 HTTP 상태로 알릴 방법이 없다.
계약 설명이 그렇게 적고, 계약 게이트가 API 파일뿐 아니라 **워커 러너까지**
읽어 "선언한 코드를 구현이 던지는가"를 확인한다.

### D13. 재생성은 새 SOP가 아니라 **새 버전**이다

근거가 늘어 다시 만들 때마다 SOP가 하나씩 생기면 "이 상황의 절차"가 무엇인지
말할 수 없다. `ensureSop`이 상황당 하나를 찾거나 만들고 버전만 올린다.

### D14. 워커에 상황 계열 **읽기**와 상태 한 칸만 연다 (0033)

실측으로 발견했다 — 러너를 돌리자 `permission denied for table situation`으로
잡이 RUNNING에 멈췄다. `situation`·`situation_snapshot`·`evidence_set`·
`evidence_item`에 SELECT만 주고, 쓰기는 `situation.status` **한 열**에
`GRANT UPDATE (status)` + RESTRICTIVE 정책
(`CONTEXT_CONFIRMED` → `SOP_READY` 한 전이)으로 제한한다. 테이블 전체 UPDATE를
주면 워커가 `current_snapshot_id`까지 바꿀 수 있고, 그것은 **감사 기록 없이
확정 사실을 갈아치우는 것**이다(0030에서 정한 선과 같다).

**0032가 같은 선을 한 번 넘었다** — `sop_version`에 테이블 단위 UPDATE를 줬는데
그것을 쓰는 코드가 없었다. 그 권한으로는 기존 버전의 `graph_hash`·출처·위반을
감사 없이 갈아치울 수 있다. 0034가 회수했고, 통합 테스트가 권한 목록을 고정한다
(검토 지적 M3/F9).

### D15. `sop`을 `FOR UPDATE`로 잠그지 않는다

`SELECT ... FOR UPDATE`는 테이블 단위 UPDATE 권한을 요구한다(열 단위 GRANT로는
부족하다). 잠금을 얻자고 `sop` 전체 UPDATE를 주면 D14의 선을 넘는다. 잠금
없이도 안전한 이유: 상황당 활성 SOP 생성 잡은 하나뿐이고(API `findActiveSopJob`),
그 가드가 뚫려도 최악은 SOP가 둘 생기는 것이지 데이터가 깨지지는 않는다.
`sop(situation_id)` 유니크 제약은 버렸다 — UNE-SOP-003이 한 상황에 여러 SOP를
만들 수 있다.

### D16. 어휘는 **도달 가능한 상태만** 넣는다 (0022 §1)

CC-240이 만드는 것은 DRAFT SOP와 DRAFT 버전뿐이다. `sop.status`·
`sop_version.status` CHECK는 `('DRAFT')` 하나다. LOCKED/APPROVED는 그 값을
쓰는 코드와 함께 CC-250이 넓힌다. 0023 §4가 `provider_job`에 같은 방식을 썼고
CC-220이 예고대로 넓혔다 — 그 방식이 실제로 통했다.

### D17. HTTP 어댑터를 만들되 capability는 `UNE_ADAPTER_READY`에 머문다

`/chat/json` 경로와 이벤트 이름은 설계 08이 적었으므로 어댑터를 쓸 수 있다.
그러나 프레이밍(OB-04)과 요청 필드명이 미확인이므로 **실 UNI에 대고 한 번도
성공한 적이 없다.** 요청 필드명은 설정으로 열어 둔다. 운영에서 mock을 쓰면
기동하지 않는다(`UNE_ALLOW_MOCK_PROVIDER=true` 예외).

### D18. UNI DTO와 매퍼는 **어댑터 패키지**에 있다

처음에는 `UniRawCompn`·`mapUniCompn`을 `packages/domain`에 두었다. 그러자
어댑터 포트가 도메인에서 provider DTO를 import하게 되어 **의존 방향이
뒤집혔다**(`.claude/rules/architecture.md`: "Provider-specific DTOs live only
under provider adapters"). T3Q 쪽 선례가 반대다 — `legacy-toc-mapper.ts`가
provider 응답을 알고 도메인은 provider 중립 타입만 안다.

지금 배치: 도메인에는 `SopNodeDraft`/`validateSopGraph`/`deriveSequentialEdges`/
`normalizeNodeKey`/`fitTitle`/경고·위반 어휘(계약 어휘다), 어댑터에는
`UniRawCompn`/`TYPE_ALIASES`/`mapUniCompn`/`UNI_SOP_MAPPER_VERSION`.
`sopGraphHashInput`은 매퍼 버전을 **인자로 받는다** — 도메인이 특정 provider의
매퍼 이름을 알고 있으면 같은 역전이 된다.

### D19. SOP 생성 Job 취소는 별도 엔드포인트다 (UNE-SOP-017, UNE 신설)

설계 10 SOP 표에 없다. UNE-PLAN-012가 이미 잡 취소를 하지만 `PLAN_GENERATE`를
요구하므로, 그것으로 SOP 잡을 끄면 **SOP 운용자는 자기 잡을 못 끄고 계획서
작성자는 남의 SOP 잡을 끈다.** 그리고 `SOP-409-001`이 "진행 중인 Job을
기다리거나 취소하십시오"라고 안내하므로 취소 경로가 없으면 그 안내가 막다른
길이다.

상태기계·감사·이벤트는 계획서 잡과 **같은 코드**를 쓴다. 다른 것은 권한과 잡
유형 범위뿐이다.

### D20. 잡 유형이 곧 권한 경계다

`generation_job`은 도메인을 가리지 않는데 엔드포인트마다 요구 권한이 다르다.
유형을 검사하지 않으면 `SOP_READ`만 가진 사용자가
`/sop-generation-jobs/{planJobId}/events`로 **계획서 본문 이벤트**를 받고, 그
반대도 성립한다(0012의 역할 카탈로그가 `SOP_EDITOR`와 `PLAN_AUTHOR`를 나눠
두었으므로 가상의 조합이 아니다). 조회·스트림·취소·재시도 네 곳 모두 허용
유형을 명시하고, 벗어나면 **404**로 답한다 — 다른 도메인 잡의 존재 여부도
흘리지 않는다.

### D21. 공개 이벤트에 provider가 만든 문자열을 싣지 않는다

`job.failed`는 공개 어휘라 SSE로 사용자에게 그대로 간다. UNI `__error__`의
내용은 우리가 통제하지 못하는 임의 문자열이다(내부 경로·식별자가 섞일 수
있다). D11의 "어휘는 UNE의 것"은 이름만이 아니라 **값에도** 적용된다 —
사용자에게는 UNE 문장을, 원문은 내부 이벤트(`provider.failed`)에만.

같은 이유로 노드의 `sourceRefs`와 `sop.sources`는 **UNE `knowledge_document_id`**
를 싣는다. provider 문서 id를 그대로 저장하면 클라이언트가 대조할 수 없고,
UNI가 id 체계를 바꾸면 저장된 근거 참조가 통째로 끊긴다.

## 수용 한계 (지금 하지 않은 것 / 지금 사실이 아닌 것)

1. **실 UNI 검증이 없다.** mock이 검증하는 것은 UniSopMapper와 UNE 상태기계뿐이다.
   `HttpUniSopAdapter`의 SSE 프레이밍이 맞는지는 OB-04가 닫혀야 안다.
2. **요청 본문 필드명(`query`/`doc_ids`)이 추측이다.** `/chat/json` 요청 스키마는
   번들 스냅샷에서 `additionalProperties: true`뿐이라 정의된 필드가 하나도 없다.
   설정으로 바꿀 수 있게 열어 두었고 기본값은 UNI 지식문서 검색과 같은 이름을 썼다.
3. **문서 범위 지정을 UNI가 지킬지 모른다.** `doc_ids`를 보내면서 프롬프트 문장에도
   문서 목록을 적는다 — 어느 쪽을 UNI가 쓰는지 모르기 때문이다.
   ~~둘 다 무시되면 근거 밖 절차가 생성될 수 있고, 그것을 UNE가 사후에 잡지 못한다.~~
   **정정**: 요청 범위와 응답 출처를 둘 다 쥐고 있으므로 비교는 한 줄이었다.
   범위 밖 출처를 든 노드에 `SOURCE_OUT_OF_SCOPE` 경고를 붙이고
   `job.completed.outOfScopeNodeCount`로 센다. **차단하지는 않는다**(D3의
   스트리밍 원칙) — 표시하고 사용자가 판단한다.
4. **`sop.node` 이벤트는 그래프 적재가 끝난 뒤 한꺼번에 나간다.** 설계 08 §1.11의
   "Canvas에 즉시 쌓인다"는 실시간 감각과 다르다. 포트가 스트림을 모아서
   돌려주기 때문이며(적재 실패와 전송 실패를 섞지 않으려는 선택), 진짜
   증분 스트리밍은 워커→API 이벤트 중계가 필요하다 — CC-250 이후 과제다.
5. **취소는 체크포인트 방식이다.** UNI 호출 도중에는 끊지 않는다. TOC/CONTENT
   잡과 같은 한계이고 같은 이유다(스트림을 중간에 끊으면 원문이 반만 남는다).
6. **`assigneeHint`가 항상 null이다.** 설계 08 §1.11의 `task` 필드가 문자열
   배열이라 담당 정보를 담을 자리가 없다. `MISSING_ASSIGNEE` 경고로 남기고
   사용자가 채운다 — UNI가 담당을 준다면 매퍼 버전이 올라간다. 임무가 아예
   없는 ACTION에도 이 경고를 붙인다(임무를 채우고 나면 담당은 여전히 비어
   있는데, 그때 다시 알리는 경로가 없다).
7. **`position_x/y`가 비어 있다.** 캔버스 좌표는 CC-250의 것이다. 그래서 지금
   저장된 그래프는 `sop-graph.schema.json`의 `position` 필수 조건을 만족하지
   않는다 — 그 스키마는 **내보내기·캔버스 교환 형식**이고 DRAFT 저장 형식이
   아니다. CC-250이 좌표를 채울 때 그 경계를 다시 확인해야 한다.
8. **동시 재생성 경쟁을 DB가 부분적으로만 막는다**(D15).
   ~~API 가드가 유일한 방어선이다.~~ **정정**: `uk_sop_version_no
   (sop_id, version_no)`가 있어 같은 SOP에 같은 번호를 두 번 넣으면 23505로
   한쪽이 되돌아간다. API도 상황 행을 `FOR UPDATE`로 잠근 뒤 활성 잡을 보므로
   실질적으로 직렬화된다. DB가 막지 못하는 것은 **`sop` 행이 둘 생기는 경우**
   뿐이고, 그것도 데이터 손상이 아니라 중복이다.
9. **프롬프트가 확정 사실 본문을 그대로 담는다.** 개인정보 최소화는 스냅샷 단계에
   의존한다. `job_event`에는 프롬프트를 적지 않지만(길이만), UNI에는 간다.
10. **`generation_job` 재시도(UNE-PLAN-013)를 SOP에 열지 않았다.**
    ~~취소는 기존 경로가 그대로 동작한다.~~ **거짓이었다** — QUEUED SOP 잡을
    UNE-PLAN-012로 취소하면 `restorePlanStatusOnAbort`가 `situationId`를
    계획서로 오인해 `PLAN-4003`을 던지고, 그 404가 같은 트랜잭션의 CANCELLED
    기록까지 되돌렸다(실측: 404 + 잡은 QUEUED 그대로). D19의 UNE-SOP-017이
    그것을 닫았고, 재시도는 여전히 계획서 전용이다(SOP 재시도는 새 생성
    요청으로 한다 — 근거가 바뀌었을 수 있으므로 같은 요청을 되돌리는 것이
    옳은지부터 판단해야 한다).
11. **워커 e2e는 superuser로 접속해 `SET LOCAL ROLE`로 강등한다.** 운영에서 그
    전환이 실패한다는 사실(OB-17)은 여기서도 잡히지 않는다.
12. **`job_event`의 원문 프레임에는 보존기간 스윕이 없다.** `PayloadRetentionRunner`는
    `provider_result`/`provider_job`만 본다(TOC/CONTENT에서 넘어온 형태). SOP
    프레임은 확정 사실에서 파생된 절차 본문을 담으므로 OB-16 범위를
    `job_event`로 넓힐지 판단이 필요하다 — CC-430 과제로 남긴다.
13. **원문 상한(200KB)을 넘으면 뒤쪽 프레임이 잘린다.** 통짜로 버리지 않고 앞에서부터
    담되(`keptFrames`/`totalFrames`를 함께 적는다) 긴 스트림의 뒷부분은 남지 않는다.
14. **`sop.current_version_id`를 최신 DRAFT로 옮긴다.** 지금은 DRAFT만 존재하므로
    무해하지만, CC-250이 LOCKED/APPROVED를 열면 **승인본 포인터를 DRAFT가 덮는
    경로**가 된다. CC-250 착수 시 이 규칙부터 다시 정해야 한다.
