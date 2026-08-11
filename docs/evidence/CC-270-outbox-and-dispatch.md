# CC-270 증거 — Transactional Outbox와 시뮬레이션 채널

- 항목: CC-270 (UNE-TASK-003/013/014)
- 결정 정본: **ADR-41** (D1~D10, 수용 한계 10)
- 마이그레이션: `0037_outbox_relay_and_dispatch.sql`
- 작성: 2026-08-12

## 1. 무엇이 동작하는가

```
POST /tasks/{taskId}/dispatch     전파 접수   (TASK_DISPATCH, 201)
GET  /dispatches/{id}             상태 조회   (TASK_READ, 200)
POST /dispatches/{id}/retry       재전파      (TASK_DISPATCH, 200)
```

접수는 한 트랜잭션(전파·수신자·Outbox·사실원장·감사)에서 끝나고, 워커
`OutboxRelayRunner`가 큐를 집어 채널로 보낸다.

**아무 데도 가지 않는다.** SYSTEM 외 세 채널은 실제 계약이 없어(OB-06)
시뮬레이션이고, 그 사실이 결과·기록·로그에 실린다.

## 2. 실행한 검증

| 대상 | 결과 |
|---|---|
| 도메인(`outbox.test.ts`) | 23 pass |
| 계약 게이트(`dispatch.contract.test.ts`) | 18 pass |
| 계약 — 전체 | 318 pass |
| API 슬라이스 e2e(`dispatch-outbox.e2e.test.ts`) | 9 pass |
| 통합(마이그레이션 37 · RLS 커버리지 포함) | 197 pass |
| 전체 스위트 | **초록** |
| typecheck / lint / format / validate-contracts | 통과 |

데이터사전 65/646, 테이블 수 변화 없음.

## 3. 실측으로 찾은 것

### 3.1 RESTRICTIVE 정책이 종결 자체를 막았다

릴레이가 메시지를 `SENT`로 종결하지 못하고 `SENDING`에 머물렀다. 원인은
`p_outbox_message_worker_open_only`에 `USING`만 쓴 것 — RESTRICTIVE 정책의
`USING`은 **새 행에도** 적용된다(암묵 `WITH CHECK`). 막으려던 것은 "이미 끝난
줄을 다시 여는 것"이므로 조건은 옛 행에만 걸어야 했다. `WITH CHECK (true)`로
닫았다.

CC-240에서 배운 것과 같은 계열이다 — RESTRICTIVE는 두 방향을 따로 생각해야 한다.

### 3.2 정책 평가에 필요한 읽기 권한이 없었다

릴레이가 임무를 `SENT`로 올릴 때 `permission denied for table sop_run`이 났다.
`task`의 RLS 조건이 `sop_run`을 조인하는데 **정책식은 질의하는 롤의 권한으로
돈다.** 0033이 상황 계열에서 겪은 것과 같은 유형이고, 같은 방식으로 SELECT 하나를
열어 닫았다.

## 4. 판단한 것

### 4.1 접수와 발송을 나눴다 (D1)

"상태변경·Execution Event·Outbox insert는 하나의 트랜잭션"이라는 비협상 규칙이
그 트랜잭션 안에서 채널을 부르는 것을 금지한다. 계약 게이트가 그것을 강제한다 —
`dispatchTask` 트랜잭션 본문에 `.send(`가 없어야 통과한다.

### 4.2 시뮬레이션임이 네 곳에 실린다 (D2)

어댑터(`isSimulated`) · 시도 기록(`response_json.simulated`) · 접수·조회 응답
(`recipients[].simulated`) · 기동 로그. 시뮬레이션 성공을 "전파됐다"로 읽으면
아무도 받지 않은 지시를 받았다고 여긴다.

### 4.3 `DELIVERED`를 넣지 않았다 (D3)

수신영수증을 주는 채널이 없다. 지금 넣으면 영원히 도달하지 않는 값이 화면에
남는다.

### 4.4 부분 실패를 뭉개지 않았다 (D4)

절반이 받았는데 "실패"로 보이면 운영자가 전부 다시 보내고, 받은 사람은 같은
지시를 두 번 받는다. 그리고 **아직 진행 중이면 결론을 내지 않는다** — 지금
PARTIAL이라 말하면 남은 것이 성공했을 때 그 말이 틀린 것이 된다.

### 4.5 `channel_delivery`를 만들지 않았다 (D6)

설계가 이름을 쓰지만 그 정보는 `outbox_attempt`와 `dispatch_recipient`에 이미
있다. 채널별 분기도 수신자 행이 채널을 들고 있어 새 테이블이 담을 것이 없다.

### 4.6 중복 억제 키에 테넌트를 넣었다 (D7)

0007의 인덱스에는 테넌트가 없어, 두 기관이 같은 키를 쓰면 **한쪽의 전파가
조용히 사라졌다.**

## 5. 증명한 규칙

- **원자적 쓰기**: 전파 하나에 Outbox 2줄 · 사실원장 1건 · 감사 1건이 함께 남는다.
- **릴레이가 상태를 밀어 올린다**: Outbox SENT → 수신자 SENT → 전파 SENT →
  임무 SENT.
- **중복 억제**: 같은 멱등키로 두 번 접수해도 전파도 Outbox도 하나다.
- **재시도·백오프**: 첫 실패에 `next_attempt_at`이 잡히고, 시도를 다 쓰면
  `DEAD_LETTER`이며 시도 횟수가 상한을 넘지 않는다.
- **비재시도 실패는 즉시 dead letter**: 주소 오류는 시도 1회로 끝난다.
- **부분 실패는 PARTIAL**, 재전파는 dead letter만 되살리고 **성공한 줄은
  건드리지 않는다**. 되살릴 것이 없으면 409.
- **모의·훈련은 전파하지 않는다**: 둘 다 412.
- **시뮬레이션 표시**: 접수 응답과 시도 기록에서 SYSTEM=false, SMS=true.
- **경계**: 타 기관은 전파 조회 404.

## 6. 남은 조건

ADR-41 수용 한계 10개가 정본이다. 특히:

1. **아무 데도 가지 않는다** — SYSTEM조차 알림함 적재가 없고, 나머지는 OB-06이
   닫혀야 실제로 나간다.
2. **주소를 저장하지 않는다** — 실제 채널이 붙으면 주소 해석 계층이 하나 더 필요하다.
3. **수신확인이 없다**(CC-280), **전파 취소가 없다**.
4. **dead letter 목록 화면이 없다** — 운영 관점의 다음 후보다.
5. RLS 커버리지 목록에 **9개**가 남았다.
