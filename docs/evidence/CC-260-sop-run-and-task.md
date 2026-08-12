# CC-260 증거 — SopRun·Task 명시적 상태기계

- 항목: CC-260 (UNE-SOP-010~016)
- 결정 정본: **ADR-40** (D1~D12, 수용 한계 10)
- 마이그레이션: `0036_sop_run_and_task_state.sql`
- 작성: 2026-08-11

## 1. 무엇이 동작하는가

```
POST /sops/{id}/simulations       Dry-run 시작    (SOP_RUN, 201, 상황 불변)
POST /sops/{id}/runs              실행 시작       (SOP_RUN, 201, LIVE·EXERCISE)
GET  /sop-runs/{runId}            실행 상세       (SOP_READ, 200)
GET  /sop-runs/{runId}/events     실행 SSE        (SOP_READ, 200)
POST /sop-runs/{runId}/pause      일시중지        (SOP_RUN_CONTROL, 200)
POST /sop-runs/{runId}/resume     재개            (SOP_RUN_CONTROL, 200)
POST /sop-runs/{runId}/terminate  강제종료        (SOP_RUN_CONTROL, 200, 확인코드)
```

승인된 SOP 버전을 실행해 임무를 만들고, 지금 할 차례인 것을 활성화하고,
통제 조작을 사실원장에 남긴다.

## 2. 실행한 검증

| 대상 | 결과 |
|---|---|
| 도메인 상태기계(`sop-run.test.ts`) | 18 pass (SOP 전체 62) |
| 계약 게이트(`sop-run.contract.test.ts`) | 15 pass |
| API 슬라이스 e2e(`sop-run.e2e.test.ts`) | 8 pass |
| 마이그레이션 36개 / RLS 커버리지 | pass |
| 전체 스위트 | **초록** |
| typecheck / lint / format / validate-contracts | 통과 |

데이터사전 65/645, 테이블 수 변화 없음.

## 3. 착수 시점 상태

- `sop_run`·`task`·`task_event`에 어휘 CHECK도 FK도 **RLS 정책도** 없었다.
  CC-250이 고정한 18개 목록 중 셋을 여기서 닫았다(남은 12개).
- `execution_event`에 **쓰는 코드가 하나도 없었다** — CC-260이 첫 기록자다.
- 응답 스키마가 `additionalProperties: true` 자리표시자였다.

## 4. 실측으로 찾은 것

### 4.1 사실원장이 권한만으로 지켜지고 있었다

e2e를 쓰다가 `UPDATE execution_event`가 **통과하는 것을 봤다**(superuser 연결).
0011이 `une_app`에서 UPDATE/DELETE를 회수했지만 그것이 유일한 방어였다 —
권한이 잘못 부여되거나 다른 롤이 생기면 사실원장이 고쳐진다.

`task_event`·`sop_approval`에 건 것과 같은 append-only 트리거를 붙였다.
CLAUDE.md 비협상 규칙("실행 로그는 append-only, 정정은 원본을 가리키는 새
이벤트")이 이제 DB 층에도 있다.

## 5. 판단한 것

### 5.1 도달 가능한 상태만 (ADR-40 D1)

실행 넷·임무 둘. `COMPLETED`/`FAILED`와 `SENT`~`COMPLETED`는 그 값을 만드는
코드(CC-270/280)와 함께 온다. 0032 → 0035가 예고대로 넓힌 방식 그대로다.

### 5.2 DRY_RUN은 상황을 건드리지 않는다 (D2)

모의 때문에 대시보드·일지가 "대응 중"으로 보이면 그 화면을 믿은 사람이 잘못
판단한다. 살아 있는 실행 카운트에서도 빠져 실제 대응과 나란히 돈다. 상태는
`READY`에 머문다 — "시작했다"가 아니라 "준비됐다"다.

### 5.3 "만들어진 임무"와 "지금 할 임무"를 갈랐다 (D7·D8)

상태로 구분하지 않는다 — 설계 어휘에 "활성"이 없고 전파 상태와 섞으면 "보냈다"와
"해야 한다"가 한 값에 눌린다. `activated_at` 시각으로 남기고, 프런티어는
**저장하지 않고 계산한다**(커서를 두면 그래프·임무 상태와 어긋날 수 있고 어느
쪽이 참인지 말할 수 없다).

### 5.4 강제종료 확인코드는 실행 id 앞 8자다 (D9)

사용자가 화면에서 읽어 옮겨야 하므로 확인 자체가 "무엇을 끄는가"의 확인이 된다.
인증이 아니라 오조작 방지다 — 권한은 `SOP_RUN_CONTROL`이 본다.

## 6. 증명한 규칙

- **첫 임무만 활성이다.** ACTION 둘이 만들어지고 `activeNodeKeys = ['a']`,
  두 번째의 `activatedAt`은 null.
- **모의는 상황을 건드리지 않는다.** `SOP_READY` 유지, 그 뒤 실제 실행이 되고
  그때 `RUNNING`으로 간다.
- **승인 안 된 버전 412, 낡은 판 422.**
- **살아 있는 실제 실행은 하나** — 두 번째 시작은 409.
- **상태기계대로만 움직인다** — 돌고 있는 것 재개 409, 멈춘 것 또 멈추기 409.
- **강제종료**: 확인코드 틀리면 400, 성공하면 임무 전부 CANCELLED, 그 뒤
  pause/resume/terminate 모두 409, **DB도 임무 수정을 42501로 막는다**.
- **사실원장**: 다섯 종 이벤트가 남고 각 행이 64자 해시를 갖는다. SSE로 도착하고,
  `UPDATE execution_event`는 42501.
- **경계**: VIEWER는 실행·통제 403, 타 기관은 실행 조회 404.

## 7. 남은 조건

ADR-40 수용 한계 10개가 정본이다. 특히:

1. **실행이 스스로 끝나지 못한다** — 완료 보고(CC-280)가 없어 `COMPLETED` 경로가
   없다. 지금 끝내는 유일한 방법은 강제종료다.
2. **전파가 없다** — 임무가 만들어져도 아무에게도 가지 않는다(CC-270).
3. **프런티어가 전진하지 않는다** — 계산은 이미 완료를 읽게 돼 있고, CC-280이
   상태 어휘만 넓히면 움직인다.
4. **분기 조건을 평가하지 않는다** — DECISION의 모든 갈래가 활성이 된다.
5. **`task_attachment`가 여전히 열려 있다** — CC-280이 닫는다.
