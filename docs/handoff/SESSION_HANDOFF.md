# Session Handoff

- Date/time: 2026-08-13 (집 PC 세션 종료 — 회사 PC로 인계)
- Branch: **main** @ `4768b21` (PR #29 머지 커밋)
- Current Work Item: **CC-310 DONE, 머지 완료.** 열린 PR 없음.
  다음은 **CC-320**(상황-SOP-일지 수직 슬라이스 E2E).

## 회사에서 바로 시작하는 법

```bash
git checkout main && git pull          # 4768b21 이상이어야 한다
pnpm install

# DB는 WSL 안 Docker에 있다. 세션을 붙잡아 두지 않으면 몇 분 뒤 꺼진다.
wsl -d Ubuntu -- bash -lc "docker start une-postgres une-minio"
wsl -d Ubuntu -- bash -lc "sleep 14400" &     # 백그라운드로 붙잡기

set -a; . ./infrastructure/.env; set +a
export DATABASE_URL="postgres://${UNE_DB_USER}:${UNE_DB_PASSWORD}@localhost:${UNE_DB_PORT}/${UNE_DB_NAME}"
pnpm run db:migrate                     # 46개까지 적용돼 있어야 한다
pnpm build && pnpm --filter @une/e2e test   # 162 pass면 정상
```

⚠️ **이 세션에서 DB 컨테이너가 세 번 꺼졌다.** e2e가 통째로 `ECONNREFUSED`로
실패하면 코드 결함이 아니라 이것이다. 위의 `sleep` 백그라운드가 예방책이다.

## 이번 세션에 끝난 것

| PR | 항목 | 머지 커밋 | CI |
|---|---|---|---|
| [#27](https://github.com/jazzsalle/une_report2/pull/27) | CC-270·280·290 통합(순서 꼬임 정리) | `890e4f3` | pass |
| [#28](https://github.com/jazzsalle/une_report2/pull/28) | CC-300 상황일지 | `73b253d` | verify 1m55s / db-verify 3m12s |
| [#29](https://github.com/jazzsalle/une_report2/pull/29) | CC-310 종료·평가 | `4768b21` | verify 2m24s / db-verify 3m17s |

### CC-300 (ADR-44, 마이그레이션 0042~0044)

상황일지 Projection·고정 사실·편집·Export. 테이블 66 → **68**.

- 사실칸은 확정 판과 사실원장에서만 오고 **닿는 쓰기 경로가 없다**. 문서 IR의
  사실 문단은 `editState.locked`라 CC-150 검증기도 거절한다(두 겹).
- 사실 대조는 **사실 → 문장** 방향. AI에는 fail-closed, 사람에는 경고.
- **일지는 반입된 HWPX 양식 사본 위에서 시작한다** — 맨바닥 IR로 만들면 CC-160
  보존 Export가 100% 거절한다. revision 1 = 양식, 2 = 투영.
- 드리프트는 드러내되 자동 갱신하지 않고, 막는 자리는 Export가 아니라 검토요청.
- 이중검토 결함 17건 수정. 중심 결함: 편집이 문서 판을 만들지 않아 **종이에는
  투영 당시 문장이 나갔고**, 승인된 일지의 문서가 얼지 않았으며, 삽입 앵커가
  절/빈 문단이라 **워커에서 조용히 FAILED**(실제 HWPX 0건)였다.
- CC-290 전자상황판을 그때 처음 앱에 붙였다(`apps/web/src/ops/OpsWorkspace.tsx`).

### CC-310 (ADR-45, 마이그레이션 0045~0046)

훈련 종료·평가·개선조치 환류. **테이블 수 68 그대로**(0006 기준선의 세 테이블을
처음으로 쓴다), 컬럼 675 → 679.

- 종료 게이트는 요약이 아니라 **처분**이다 — 미결 목록을 412 본문에 싣고 각
  항목에 사유 있는 처분을 요구한다. 처분 어휘는 `WAIVED` 하나.
- 지표는 CC-290 `computeKpi` 하나에서 오고 **낸 시점에 고정**된다. 낡으면
  `metricsStale`로 드러내되 자동 재산출은 없다.
- **종료된 사실원장은 얼되 정정은 열어 둔다**(0045 §5 트리거).
- 만족도 설문은 만들지 않고 `NOT_COLLECTED` + 사유로 부재를 1급 값으로 적는다
  (**OB-18**로 등재).
- 이중검토 결함 13건 수정. 중심 결함: **종료된 훈련의 큐에 남은 전파가 무한
  재전송**됐다(배치 롤백 → `SENDING` 잔류 → 임차 만료마다 재발송, 기록은 사라짐).
  게이트에 처분 불가 미결 + 릴레이 국소 dead letter로 막았다.

## 다음 항목: CC-320

`work-items/MASTER_WORK_ITEMS.yaml` CC-320 — 상황-SOP-일지 **수직 슬라이스 E2E**.
수용 기준 넷: `end-to-end exercise flow`, `multiple tasks`,
`failure/retry/escalation`, `journal fact consistency`.

지금 있는 조각으로 한 줄이 이어진다: 상황 등록(CC-200) → 사실 확정(CC-210) →
SOP 생성·승인(CC-240·250) → 실행·임무(CC-260·280) → 전파(CC-270) → 사실원장·
판(CC-290) → 일지(CC-300) → 종료·평가(CC-310). CC-320은 **그 전부를 한 시나리오로
꿰는 것**이고, 조각마다 있는 슬라이스 e2e와 달리 경계에서 어긋나는 것을 찾는 일이다.

**착수 전에 볼 것**: ADR-45 수용 한계 12~16이 CC-320의 후보다. 특히

- **수용 한계 12** — 종료가 얼리는 것은 사실원장뿐이다. 기준선 해시는 일지·실행·
  확정 판까지 담지만 그 값들이 종료 뒤 바뀌는 것을 막지도, 어긋났음을 알려 주지도
  않는다. 수직 슬라이스가 이 구멍을 정확히 밟는다.
- **수용 한계 13** — 미완료 Export·잡을 종료 게이트가 보지 않는다.

## 열린 것

### 사용자가 사내 개발자에게 받아야 할 것 (계속 미해결)

1. UNI `/documents/upload`의 **multipart 필드명**과 업로드 응답 샘플
2. UNI `/auth/login` 응답 샘플(토큰 필드명)

둘 다 **OB-13**이고, 없으면 UNI 지식문서 경로는 실제 호출이 불가능하다(어댑터는
있으나 한 번도 실 UNI에 성공한 적이 없다).

### 배포 전 차단 항목

- **OB-17** — 워커 전용 로그인 롤 프로비저닝. `une_app`은 `une_worker`도
  `une_retention`도 `SET ROLE`할 수 없다(42501, 실측). 지금 `.env.example`대로
  워커를 띄우면 첫 트랜잭션이 실패하고 보존 스윕은 한 번도 돌지 않는다.
- **OB-15** — AV 엔진 없음. `scan_status`는 영구 PENDING.

### 외부 대기

- **OB-01** T3Q 계약 수용 · **OB-03** 일지 서술 연산(RPT-003 사용 여부)
- **OB-04** UNI `/chat/json` 프레이밍 · **OB-06** 실제 채널 계약
- **OB-08** Hancom Track B · **OB-18** 만족도 설문 수집 경로(신규)

## 지금까지 굳은 판단 (다음 세션이 되풀이하지 않도록)

- **설계가 이름 붙인 테이블이라도 이미 그 일을 하는 것이 있으면 만들지 않는다** —
  ADR-33 D4, ADR-41 D6, ADR-44 D1, ADR-45 D1(네 번째).
- **도달 가능한 상태만 어휘에 넣는다**(0022 §1). 값을 만드는 코드가 없는 상태·
  필드·형식은 거짓 약속이다.
- **집계는 한 산출기에서만** 나온다(ADR-43 D1). 두 번째 계산기를 만들면 갈라지는
  날 어느 쪽이 참인지 말할 수 없다.
- **낡음은 드러내되 자동으로 고치지 않는다**(ADR-44 D6, ADR-45 D4).
- **상태 변경은 자기 상태기계 안에서만**(0039 §1, ADR-45 D3).
- **접수 성공(202)이 "됐다"로 읽힌다.** 워커에서 조용히 실패하는 경로는 요청
  시점 거절보다 나쁘다 — e2e를 워커·산출물까지 밀어붙일 것(CC-300 F1, CC-310 V-1).
- **이중검토는 매번 치명 결함을 찾는다.** CC-280 13건, CC-290 16건, CC-300 17건,
  CC-310 13건. 건너뛰지 말 것.
