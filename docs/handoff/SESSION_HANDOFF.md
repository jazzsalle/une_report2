# Session Handoff

- Date/time: 2026-08-14 (집 PC 세션 종료 — 회사 PC로 인계)
- Branch: **main** (PR #30 머지 `e5f8a9c` + ADR-49 PR)
- Current Work Item: **CC-320 · CC-430 DONE. OB-19 · OB-17 · OB-15 닫힘.**
- 다음: **CC-400 / CC-410 / CC-420 — 셋 다 외부 대기.** 그중 **CC-410(UNI)이
  내일 회사 PC에서 진행할 것**이다.

## 내일 회사 PC에서 할 것 — UNI 확인

OB-13의 두 값만 있으면 `HttpUniKnowledgeAdapter`가 코드 변경 없이 동작한다.

1. `POST /documents/upload`의 **multipart 파일 필드명**
2. `POST /auth/login` 응답의 **토큰 필드명**

서버는 `http://221.147.100.161:8000`이고 경로·인증 흐름은 실측 스냅샷이 있다
(`contracts/openapi/uni-rag-adapter-v1.1.0-une1.yaml`). 요청 문서 두 벌도 이미
있다 — `contracts/openapi/uni-knowledge-api-change-request-v1.yaml`,
`docs/handoff/UNI_KNOWLEDGE_API_REQUEST.md`.

⚠ **`infrastructure/.env` 35행에 `UNI_USERNAME=<계정>` 자리표시자가 있어
`set -a; . ./infrastructure/.env`가 깨진다**(`<`를 셸이 리다이렉션으로 읽는다).
값을 채우거나 `UNI_USERNAME="<계정>"`으로 감싸야 아래 시작 절차가 돈다.

⚠ **`UNE_DB_WORKER_PASSWORD`를 `.env`에 추가해야 compose가 뜬다**(0050이
`${...:?}` 가드를 만들었다). 기존 볼륨은 initdb를 다시 돌리지 않으므로 워커 롤을
로컬에서 실제로 쓰려면 볼륨 초기화가 필요하다 — 마이그레이션 0050은 NOLOGIN
롤과 멤버십까지는 만든다.

## 시작 절차

```bash
git checkout main && git pull
pnpm install

# DB는 WSL 안 Docker에 있다. 세션을 붙잡아 두지 않으면 몇 분 뒤 꺼진다.
wsl -d Ubuntu -- bash -lc "docker start une-postgres une-minio"
wsl -d Ubuntu -- bash -lc "sleep 14400" &

set -a; . ./infrastructure/.env; set +a     # 위 ⚠ 두 개를 먼저 고칠 것
export DATABASE_URL="postgres://${UNE_DB_USER}:${UNE_DB_PASSWORD}@localhost:${UNE_DB_PORT}/${UNE_DB_NAME}"
pnpm run db:migrate                         # 50개까지 적용돼 있어야 한다
pnpm build && pnpm --filter @une/e2e test   # 197 pass면 정상
```

## 이번 세션에 끝난 것

| PR | 항목 | 머지 |
|---|---|---|
| [#30](https://github.com/jazzsalle/une_report2/pull/30) | CC-320 · OB-19 · OB-17 · CC-430 · CC-440 문서 | `e5f8a9c` |
| (후속) | ADR-49 인도 자세 결정 셋 | 이 브랜치 |

### CC-320 (ADR-46, 마이그레이션 0047·0048)

수직 슬라이스가 **구간과 구간 사이**를 물었다. 경계에서 셋을 찾았다.

- **V-2 (고침)**: 훈련(EXERCISE) 상황이 `mode:'LIVE'` 실행을 201로 받아들였고
  그 임무는 전파 게이트를 그대로 통과했다 — **훈련이 실제 문자를 보낸다.**
  ADR-41 D9는 `run.mode`만 보고 실행 생성이 `situation.mode`와 대조하지 않았다.
- **V-3 (고침)**: 종료 기준선은 일지·실행 목록까지 담는데 0045는 사실원장만
  얼렸다. **일지 API를 지나지 않는 문서 경로**(`/documents/{id}/changesets`)가
  특히 뚫려 있었고 0048이 `document_revision` INSERT에서 직접 막는다.
  얼어붙은 판의 Export는 열어 둔다.
- **V-1 → OB-19**: 같은 세션에서 닫았다.

### OB-19 · OB-17 (ADR-47, 마이그레이션 0049·0050)

- **OB-19**: 용도별 업로드 정책 + `file_object.purpose`. 소비 측이 자리를
  대조하므로 지식문서 파일을 HWPX 반입에 바꿔 쓸 수 없다.
- **OB-17**(배포 차단이었다): 워커 전용 로그인 롤에 `INHERIT FALSE, SET TRUE`.
  `une_app`에 주면 API가 전 테넌트 원문을 본다.

### CC-430 (ADR-48)

- **보안 전수 매트릭스** — `listRoutes(app)`로 등록된 라우트 전부를 훑는다.
  401·403·테넌트 경계 **전수 통과**.
- **P95** — 대시보드 19ms · 실행로그 10ms · 상황상세 9ms · 사실목록 11ms ·
  임무목록 10ms (참고선 300ms).
- **관측성** — 구조화 로그(가림은 나가는 길목에 한 번만) + Prometheus 메트릭
  (라벨은 경로 템플릿) + `live`/`ready` 분리.
- **백업·복구 훈련** — RTO 22.28s. **첫 실행이 결함을 잡았다**: pg_dump 18로
  서버 16을 덤프하면 복구가 첫 줄에서 죽는다.

### ADR-49 — 사용자 결정 셋 (2026-08-14)

- **D1 / OB-15 닫힘**: AV 엔진을 두지 않는다. 검사 없는 파일 등록을 수용한다.
  `UNE_KNOWLEDGE_ALLOW_SCAN_PENDING=true`가 승인된 배포 설정이 됐다.
  **`scan_status`는 PENDING에 머문다 — CLEAN으로 올리지 않는다.** 수용한 것은
  "검사하지 않은 파일을 받는다"이지 "검사했다고 적는다"가 아니다.
- **D2 / OB-06 강등**: 시뮬레이션 채널만으로 진행한다. 인도 차단이 아니다.
  전파는 아무에게도 배달되지 않으며 그 사실이 전파 상태에 드러난다.
- **D3 / OB-14 기준 확정**: 인도 환경은 **고정 IP 확보 후** 결정한다. 트레이스
  수집기와 오브젝트 저장소 백업이 여기에 딸려 있다.

## 남은 것

| 항목 | 막는 것 |
|---|---|
| CC-400 | **OB-01** T3Q 계약 수용 |
| CC-410 | **OB-13** UNI multipart 필드명·토큰 필드명 ← **내일 이것** |
| CC-420 | **OB-08** 한컴 Track B (Windows + 한컴 수동 QA) |
| CC-430 | DONE |
| CC-440 | 문서 선행 완료. "전 게이트 통과"만 위 셋에 매달려 있다 |

## 지금까지 굳은 판단 (다음 세션이 되풀이하지 않도록)

- **설계가 이름 붙인 테이블이라도 이미 그 일을 하는 것이 있으면 만들지 않는다** —
  ADR-33 D4, ADR-41 D6, ADR-44 D1, ADR-45 D1.
- **도달 가능한 상태만 어휘에 넣는다**(0022 §1). `ATTACHMENT` 용도를 열지 않고
  거절한 것, `malware_scan`을 만들지 않은 것이 같은 판단이다.
- **집계도 판정도 한 곳에서만** 나온다(ADR-43 D1). 지식문서 형식 판정을 UNE가
  흉내 내지 않은 이유(ADR-47 D1), CC-260 실행 제어에 새 가드를 두지 않은 이유
  (ADR-46 D2)가 전부 이것이다.
- **낡음은 드러내되 자동으로 고치지 않는다**(ADR-44 D6, ADR-45 D4).
- **상태 변경은 자기 상태기계 안에서만**(0039 §1, ADR-45 D3).
- **접수 성공(202)이 "됐다"로 읽힌다.** 워커에서 조용히 실패하는 경로는 요청
  시점 거절보다 나쁘다.
- **막는 자리를 API에만 두지 않는다.** 서비스 층 가드만으로는 다음 항목이 새
  경로를 열 때 조용히 뚫린다(ADR-44 D11, ADR-45 D10, ADR-46 D2가 셋째).
- **마이그레이션은 자기가 한 일을 확인하고 끝난다**(ADR-47 D4). "적용됐다"는
  기록만 남고 실제로는 안 선 상태가 가장 나쁘다 — OB-17이 그렇게 살아남았다.
- **공회전 단언을 의심할 것.** OB-17 테스트를 `SET ROLE` 시도 방식으로 썼더니
  superuser 세션이라 둘이 아무것도 증명하지 않았다. 보안 매트릭스의 예외 목록도
  **양방향**으로 봐야 낡지 않는다.
- **하지 않은 것을 했다고 적지 않는다.** AV를 두지 않기로 한 뒤에도
  `scan_status`를 CLEAN으로 올리지 않는 이유가 이것이다(ADR-32 D3 → ADR-49 D1).
- **환경 변수를 하나 늘리면 initdb·compose·.env.example·워커 .env.example·CI를
  함께 바꾼다.** 0050에서 CI만 빠뜨렸고 CI가 잡았다.
- **이중검토·상의는 매번 치명 결함을 찾는다.** CC-280 13건, CC-290 16건,
  CC-300 17건, CC-310 13건. CC-320은 Fable 상의가 V-3의 문서 API 우회 경로를
  찾았다 — 그것 없이 고쳤으면 절반만 막혔다. 건너뛰지 말 것.
