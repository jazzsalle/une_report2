# Session Handoff

- Date/time: 2026-08-13 (회사 PC 세션)
- Branch: **feature/CC-320** @ `846d6aa` (main은 `020e49e`, 아직 푸시 안 함)
- Current Work Item: **CC-320 DONE + OB-19·OB-17 닫음.** 열린 PR 없음.
- 다음: **CC-400 / CC-410 / CC-420 — 셋 다 외부 대기.**

## 이번 세션에 끝난 것

| 커밋 | 내용 |
|---|---|
| `f47dd8a` | CC-320 WIP — 수직 슬라이스 E2E + V-2 |
| `23a2d21` | CC-320 DONE (ADR-46, 마이그레이션 0047·0048) |
| `846d6aa` | OB-19·OB-17 닫음 (ADR-47, 마이그레이션 0049·0050) |

### CC-320 (ADR-46)

`tests/e2e/src/vertical-slice.e2e.test.ts` — 훈련 하나를 상황 등록부터 종료·
평가까지 **API와 워커로만** 통과한다. 앞선 슬라이스들이 앞 구간을 SQL로 심어
출발점을 만든 탓에 아직 아무도 묻지 못한 것 — **구간과 구간 사이가 이어지는가**
— 를 묻는다. 경계에서 셋을 찾았다.

- **V-2 (고침)**: `mode='EXERCISE'` 상황이 `mode:'LIVE'` 실행을 201로 받아들였고
  그 임무는 전파 게이트를 그대로 통과했다 — **훈련이 실제 문자를 보낸다.**
  ADR-41 D9는 `run.mode`만 보고, 실행 생성이 `situation.mode`와 대조하지 않았다.
  `canRunModeInSituation` + `SOP-422-009` + 0047 트리거 세 겹.
- **V-3 (고침)**: 종료 기준선은 일지·실행 목록까지 담는데 0045는 사실원장만
  얼렸다. 새 투영·편집·검토요청·승인을 `JOURNAL-409-004`로 막고, **일지 API를
  안 지나는 문서 경로**(`/documents/{id}/changesets` — 일지 문서는
  `status='EDITING'`이라 전부 통했다)를 0048이 `document_revision` INSERT에서
  직접 막는다. **얼어붙은 판의 Export는 열어 둔다** — 읽기 측 물화이지 쓰기가
  아니고, 막으면 닫힌 훈련의 승인 일지를 영영 재출력할 수 없다.
  ADR-45 수용 한계 12·13을 부분 대체한다.
- **V-1 → OB-19로 넘겼다가 같은 세션에서 닫았다.**

### OB-19 · OB-17 (ADR-47)

- **OB-19**: 지식문서 용도 파일 업로드 경로가 없어 지식→근거→SOP 생성 구간이
  API만으로는 도달 불가능했다. 용도별 정책(MIME·크기·내용검사)을 열고
  `file_object.purpose`를 저장(0049)해 소비 측이 자리를 대조한다. **지식문서의
  형식 판정은 UNE가 하지 않는다** — 최종 판정은 UNI의 `uni_status`다.
  `ATTACHMENT`는 열지 않았다(EXIF·개인정보 최소화 선행).
- **OB-17**(배포 전 차단이었다): 워커 전용 로그인 롤 `une_worker_app`에
  `GRANT ... WITH INHERIT FALSE, SET TRUE`(0050). `une_app`에 주면 기본
  `INHERIT`가 정책 대상 자격까지 물려줘 API가 전 테넌트 원문을 본다.
  initdb는 LOGIN·비밀번호만, 마이그레이션은 멤버십만 — **순서 어디서 시작해도
  같은 자리에 도착한다.**

## 회사/집에서 다시 시작하는 법

```bash
git checkout feature/CC-320    # 846d6aa
pnpm install

# DB는 WSL 안 Docker에 있다. 세션을 붙잡아 두지 않으면 몇 분 뒤 꺼진다.
wsl -d Ubuntu -- bash -lc "docker start une-postgres une-minio"
wsl -d Ubuntu -- bash -lc "sleep 14400" &     # 백그라운드로 붙잡기

set -a; . ./infrastructure/.env; set +a
export DATABASE_URL="postgres://${UNE_DB_USER}:${UNE_DB_PASSWORD}@localhost:${UNE_DB_PORT}/${UNE_DB_NAME}"
pnpm run db:migrate                     # 50개까지 적용돼 있어야 한다
pnpm build && pnpm --filter @une/e2e test   # 180 pass면 정상
```

⚠ **`infrastructure/.env`에 `UNE_DB_WORKER_PASSWORD`를 추가해야 한다**(OB-17).
compose가 `:?`로 요구하므로 없으면 `docker compose up`이 거부한다. 기존 볼륨은
initdb를 다시 돌리지 않으므로 **로컬에서 워커 롤을 실제로 쓰려면 볼륨 초기화가
필요**하고, 그러지 않아도 마이그레이션 0050이 NOLOGIN 롤과 멤버십은 만든다.

## 바로 해야 할 일

1. **푸시 + PR**. `feature/CC-320`은 아직 푸시하지 않았다(승인 대기). 커밋 셋을
   한 PR로 올리면 된다 — CC-320과 OB 후속이 같은 브랜치에 있다.
2. CI의 `db-verify`가 마이그레이션 50개와 데이터사전 68/680을 확인한다.

## 다음 항목 — UNE가 지금 할 수 있는 것은 사실상 끝났다

남은 셋이 전부이고 **셋 다 외부 대기**다.

| 항목 | 막는 것 |
|---|---|
| CC-400 (실 T3Q 계약 결속) | **OB-01** — T3Q auth/base URL/TLS/오류 스키마, RPT-002 SSE 프레이밍 |
| CC-410 (실 UNI 계약 결속) | **OB-13** — `/documents/upload` multipart 필드명, `/auth/login` 토큰 필드명 |
| CC-420 (한컴 Track B) | **OB-08** — Windows + 한컴 오피스 수동 QA 환경 |

CC-430·CC-440은 위 셋에 매달려 있다.

## 열린 것

### 사용자가 사내 개발자에게 받아야 할 것 (계속 미해결)

1. UNI `/documents/upload`의 **multipart 필드명**과 업로드 응답 샘플
2. UNI `/auth/login` 응답 샘플(토큰 필드명)

둘 다 **OB-13**이고, 없으면 UNI 지식문서 경로는 실제 호출이 불가능하다.

### 배포 전 차단 항목

- ~~OB-17~~ **닫혔다**(0050).
- **OB-15** — AV 엔진 없음. `scan_status`는 영구 PENDING. OB-19가 닫힌 지금
  **지식문서 등록을 막는 것은 이것 하나뿐**이고, 그동안은
  `UNE_KNOWLEDGE_ALLOW_SCAN_PENDING=true`가 필요하다(켜져 있다는 사실 자체가
  완화 기록이다).

### 외부 대기

- **OB-01** T3Q 계약 수용 · **OB-03** 일지 서술 연산 · **OB-04** UNI `/chat/json`
  프레이밍 · **OB-06** 실제 채널 계약 · **OB-08** Hancom Track B
  · **OB-18** 만족도 설문 수집 경로

### 후속으로 남긴 것 (ADR-46 수용 한계)

- **기준선 드리프트를 조회 경로가 아직 말하지 않는다**(한계 1). V-3가 *새로
  쓰는* 길은 막았지만 ADR-45 D5가 일부러 열어 둔 **정정 이벤트**는 여전히
  `eventCount`를 늘린다. `baselineDrift`를 붙일 자리는 **상황 상세(CLOSED일 때)가
  정본**이고 평가보고서가 재인용이며, 평가의 `metricsStale`과는 **기준 시점이
  다르다**(종료 시점 vs 평가 생성 시점) — 종료와 평가 사이에 정정이 붙으면
  `baselineDrift=true`·`metricsStale=false`가 되므로 둘을 합칠 수 없다.
- **종료 사건 payload가 기준선 전체를 싣지 않는다**(한계 2).
- **워커의 42501 국소 처리가 전파 릴레이에만 있다**(한계 3).

## 지금까지 굳은 판단 (다음 세션이 되풀이하지 않도록)

- **설계가 이름 붙인 테이블이라도 이미 그 일을 하는 것이 있으면 만들지 않는다** —
  ADR-33 D4, ADR-41 D6, ADR-44 D1, ADR-45 D1.
- **도달 가능한 상태만 어휘에 넣는다**(0022 §1). `ATTACHMENT`를 열지 않고
  거절한 것이 같은 판단이다(ADR-47 D1).
- **집계는 한 산출기에서만** 나온다(ADR-43 D1). **판정도 마찬가지다** —
  지식문서 형식 판정을 UNE가 흉내 내지 않은 이유(ADR-47 D1), CC-260 실행
  제어에 새 가드를 두지 않은 이유(ADR-46 D2)가 전부 이것이다.
- **낡음은 드러내되 자동으로 고치지 않는다**(ADR-44 D6, ADR-45 D4).
- **상태 변경은 자기 상태기계 안에서만**(0039 §1, ADR-45 D3).
- **접수 성공(202)이 "됐다"로 읽힌다.** 워커에서 조용히 실패하는 경로는 요청
  시점 거절보다 나쁘다 — e2e를 워커·산출물까지 밀어붙일 것.
- **막는 자리를 API에만 두지 않는다.** 서비스 층 가드만으로는 다음 항목이 새
  경로를 열 때 조용히 뚫린다(ADR-44 D11, ADR-45 D10, ADR-46 D2가 셋째).
- **마이그레이션은 자기가 한 일을 확인하고 끝난다**(ADR-47 D4). "적용됐다"는
  기록만 남고 실제로는 안 선 상태가 가장 나쁘다 — OB-17이 그렇게 살아남았다.
- **공회전 단언을 의심할 것.** OB-17 테스트를 `SET ROLE` 시도 방식으로 썼더니
  superuser 세션이라 둘이 아무것도 증명하지 않았다. CC-310 이중검토가 찾은
  것과 같은 계열이다.
- **이중검토·상의는 매번 치명 결함을 찾는다.** CC-280 13건, CC-290 16건,
  CC-300 17건, CC-310 13건. CC-320은 Fable 상의가 V-3의 문서 API 우회 경로를
  찾았다 — 그것 없이 고쳤으면 절반만 막혔다. 건너뛰지 말 것.
