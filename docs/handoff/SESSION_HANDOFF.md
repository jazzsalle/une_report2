# Session Handoff

- Date/time: 2026-08-14 (회사 PC, 아홉 번째 세션 — 집 PC로 인계)
- Branch: **feature/CC-410** (main `7467e10`에서 분기)
- Current Work Item: **CC-410 IN_PROGRESS — 실 UNI 최초 접속 성공, 매퍼 재작성 완료, 잔여 있음**

## ⚠️ 다음 세션에서 가장 먼저 알아야 할 것

**1. E2E 게이트가 비결정적이다 — 코드 탓이 아니다.**
`execution-log.e2e.test.ts`와 `vertical-slice.e2e.test.ts` (9)가 **같은 빌드로
실행마다 갈린다**(1실패·4실패·21통과 / 18통과·1실패 실측). CC-290의 시계 결함이며
**CC-410과 무관하다** — 변경을 되돌린 상태에서도 재현된다. 테스트가 붉어지면
코드를 의심하기 전에 이것부터 배제할 것. 근거는
`docs/evidence/CC-290-execution-log-and-dashboard.md` §6-9.

원인: `occurred_at`은 **DB의 `now()`**가 찍는데 상황판이 판을 자르는 기준시각은
**API 프로세스의 `new Date()`**다(`execution.service.ts:168`), 조회는
`occurred_at <= $3`(`execution.repository.ts:113`). **DB 시계가 앞선 만큼의 최근
구간이 통째로 탈락한다.** 호스트 시계를 맞춰도 사라지지 않는다(12ms에서도 터진다).
고치려면 기준시각을 **DB 한 곳에서만** 얻어야 한다. 사용자 결정으로 **이번 세션에는
기록만 남겼다.**

**2. 회사 PC의 Windows 시계가 1.5초 뒤처져 있었다.** "지금 동기화" 후 22ms.
집 PC에서도 E2E가 무더기로 깨지면 시계부터 잴 것(§환경 참조).

## 이번 세션에 끝난 것

### 1. CC-410 — 실 UNI 최초 접속 (ADR-50, 마이그레이션 없음)

사내망에서 `http://221.147.100.161:8000`에 **20ms로 닿았다.** 라이브 `/openapi.json`이
열려 있었고(FastAPI 생성본 v1.1.0, 26 오퍼레이션) 실호출·실스트림 3표본을 측정했다.

**OB-13의 두 차단이 닫혔다**: multipart 파일 필드명 **`file`**, 로그인 토큰 필드명
**`token`**. 덤으로 **어댑터가 유일하게 추측하던 자리**가 드러났다 — 로그인 요청
필드가 `username`으로 하드코딩돼 있었고 실서버는 `account`를 받는다(422↔200 실측).
어댑터 자신의 주석이 경고한 실패가 자기 코드에 있었다.

**가장 큰 것: `uni-sop-1`이 실 응답을 한 노드도 매핑하지 못했다.** 설계 08 §1.11이
적은 필드명이 **0/6 존재**한다. 실 UNI는 작도 캔버스 스키마를 보낸다:

| UNE 기대 | 실제 |
|---|---|
| `compnSn` (문자열) | `compnSn` **number** — 문자열 가드에서 전량 탈락 |
| `type` | `compnTyCode` (104001/104003/104005) |
| `name` | `compnSj` |
| `task` | `compnAttrbSaveParamsList` |
| `branch` | `endCompns` (간선을 노드가 들고 온다) |
| `source` | 없음 |

`uni-sop-2`로 재작성했다. **간선을 순번으로 잇던 것이 분기 노드의 두 갈래를 지워
판단 없이 흐르는 절차를 만들고 있었다.** UNI는 마지막 노드가 가리키는 종료 노드를
끝내 보내지 않으므로(3표본 전부, `__done__.count`가 일치) END를 세우고
`END_SYNTHESIZED`를 붙인다 — 세우지 않으면 `NO_END`+`DANGLING_EDGE`로 **UNI가 만든
모든 SOP가 승인 불가**다.

- **`uploader` 전송 중단**: 보내면 UNI가 그 문자열을 소유자로 기록하고 삭제 권한은
  JWT `user_name` 또는 대표이사만 갖는다. UNE는 사용자 UUID를 넣고 있었다 —
  올린 문서를 **영원히 지울 수 없게** 된다(403 실측).
- **mock을 실측 모양으로 다시 썼다.** CC-240 mock이 설계 필드명을 뿜었고 그 위에서
  매퍼 시험이 전부 통과했다. 단위 시험 표본을 **실 응답 원문 3벌**로 교체했다
  (`packages/provider-adapters/src/uni/__fixtures__/`, 사내 문서명·고객사명 가림).
- `uni-sop-sse.assumed.ts` → `.measured.ts` (SSE 프레이밍 가정이 **맞았다**).
- capability 3건 `PROVIDER_DEV_VERIFIED` 승격(새 어휘 — UNI에 `T3Q_DEV_VERIFIED`를
  쓰면 레지스트리가 "T3Q가 검증했다"고 말하게 된다).

### 2. 개발 시드에 `demo-system` 추가

**시드 사용자 셋 중 누구도 상황·SOP·임무·일지 권한이 없었다** — 상황 운영 화면이
로컬에서 어떤 계정으로도 열리지 않았다. 카탈로그 15개 역할 중 11개가 권한 0건이다
(CC-200~320이 도메인을 구현하며 개발 시드를 갱신하지 않았다).

`demo-system`에 **SYSTEM_ADMIN**(이미 54권한)을 준다. 새 역할의 매트릭스를 지어내면
설계에 없는 권한 배분이 개발 시드에서 태어나 사실처럼 굳는다.

## 로컬 확인된 것 (스크린샷 근거)

API `:3001`, 웹 `:5173` 기동. `health/ready` 200(DB 26ms·저장소 16ms 실연결).

| 계정 | 되는 것 |
|---|---|
| `demo-author` | 계획서 — 로그인 → **계획서 생성 성공** → 3단계 기준정보 Snapshot |
| `demo-system` | 상황 운영 — 로그인 성공(전 권한) |
| `demo-admin` | **계획서 403** — INSTITUTION_ADMIN에 PLAN_* 없음(설계상 정상) |

기관 ID `11111111-1111-4111-8111-111111111111`.
**시험용 상황 생성함: `d22be3d1-37ce-4c69-870f-2106d0ba2606`** (2026 호우 침수 대응,
LIVE/DRAFT). 상황 운영 화면에 이 ID를 넣으면 된다.

⚠ 재난유형은 **한국어 어휘**다(`FLOOD` 아님): 폭염·태풍/호우·지진·황사·산불·감염병·
가축질병·다중밀집건축물붕괴대형사고·정부주요시설·학교시설. curl로 보낼 때 셸이
UTF-8을 깨뜨리므로 `--data-binary @file`을 쓸 것.

## 테스트

| 무엇 | 결과 |
|---|---|
| typecheck · build · lint · format:check | 통과 |
| provider-adapters | **288 통과** / 7 skip |
| 계약 | **452 통과** |
| 워커 SOP e2e | **14 통과** |
| 매퍼 단위(실 픽스처 3표본) | **34 통과** |
| SOP 슬라이스 e2e | **17 통과** |
| `validate:contracts` · `validate:handoff` | PASS |
| 생성 타입 drift | 재생성분 커밋됨 |
| **E2E 전체** | **비결정적 — 위 ⚠️1 참조** |

## CC-410 잔여 작업

1. **`knowledgeStatus`가 실 UNI에서 동작하지 않는다.** 어댑터가 부르는
   `GET /documents/{doc_id}`가 **라이브에 없다**(DELETE 전용). 상태는 목록
   `GET /documents/`에서 오고 어휘도 다르다 — 설계의 `QUEUED/PARSING/…`가 아니라
   `"참고자료 생성 중"`/`"완료"` + `progress`(0~100). 가드가 모르는 값을 거부하므로
   지금 붙이면 상태 조회가 전부 실패한다. **가장 큰 잔여 항목.**
2. **SSE 재접속은 충족 불가** — `id:`·`retry:`·하트비트가 실측 0줄. 수용 한계로 기록됨.
3. **UNE가 올린 문서를 지울 수 없다** — `DELETE`가 `{account, password}` 재인증을
   요구하는데 `/auth/login`이 200으로 통과시킨 **같은 자격증명을 401로 거부한다**.
4. **UNI에 남은 시험 파일 2건** — 대표이사/사내 담당자만 지울 수 있다.
5. **유형 코드 표 미수령** — 104001/104003/104005 뜻은 3표본 추론이다.
6. **이중검토 미실시** (`architecture-guardian` + `qa-gate-reviewer`).

## Risks / OPEN

- **CC-290 시계 결함** — 상기 ⚠️1. 인도 환경에서 API와 DB가 다른 기계이므로 차이가
  0일 수 없다. 재부팅·절전 복귀 직후 초 단위로 벌어진다.
- **`UNI_PASSWORD` 교체 필요** — UNI의 422가 제출 본문을 **비밀번호 평문 포함**으로
  에코한다. UNE 어댑터는 그 본문을 저장하지 않으며 회귀 시험으로 못박았다.
- **ADR-46~49가 `docs/adr/README.md` 인덱스에서 누락**(이전 세션 드리프트).
  ADR-50만 추가했다.
- **`SOURCE_OUT_OF_SCOPE`가 무력해졌다** — UNI가 노드 출처를 주지 않고 `doc_ids`
  범위 지정도 없다. 러너의 대조 코드는 남기고 무력하다는 사실을 시험으로 고정했다.
- 기존 이월(변동 없음): 한/글 열림 증거 없음(OB-08, rhwp 미반입 OB-12), XML 1.0
  금지 제어문자 미필터, AV 없음(OB-15/ADR-49 D1 수용), 화면 캡처 CI 미실행,
  성능 수치는 개발 PC 표본, SSE 대신 폴링, T3Q SSO 없음(OB-01), 정산 실패 시 고아
  객체, PDF/DOCX 미구현(422), IX-*-TENANT 10건, UNI TLS 없음(평문 http).

## 환경 재개 (집 PC)

```bash
git checkout feature/CC-410 && git pull
pnpm install

MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash -lc "docker start une-postgres une-minio"
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- bash -lc "sleep 10800" &   # 포그라운드 유지

set -a; . ./infrastructure/.env; set +a
export DATABASE_URL="postgres://${UNE_DB_USER}:${UNE_DB_PASSWORD}@127.0.0.1:${UNE_DB_PORT}/${UNE_DB_NAME}"
export OBJECT_STORAGE_ENDPOINT="http://127.0.0.1:${UNE_MINIO_API_PORT}"
export OBJECT_STORAGE_BUCKET="$UNE_MINIO_BUCKET"
export OBJECT_STORAGE_ACCESS_KEY="$UNE_STORAGE_ACCESS_KEY"
export OBJECT_STORAGE_SECRET_KEY="$UNE_STORAGE_SECRET_KEY"
pnpm run db:migrate      # 50개
pnpm db:seed:dev         # demo-system 포함
pnpm build
```

**시계부터 재라** — E2E가 무더기로 깨지면 코드가 아니라 이것이다:

```bash
node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const{rows}=await c.query('select clock_timestamp() c');console.log('skew ms:',new Date(rows[0].c).getTime()-Date.now());await c.end()})()"
```

수십 ms면 정상. 수백 ms 이상이면 Windows 설정 → 시간 및 언어 → **"지금 동기화"**.

**서버 기동** (`.env` 예시는 `services/api/.env.example`):

```bash
node services/api/dist/main.js               # :3001, AUTH_MODE=mock
cd apps/web && pnpm dev --host 127.0.0.1 --port 5173
```

- `infrastructure/.env`는 회사 PC에서 채워져 있다(gitignore, 커밋 안 됨).
  **집 PC에는 없으므로 다시 채워야 한다** — 특히 `UNE_DB_WORKER_PASSWORD`와
  `UNI_*` 넷. `UNI_USERNAME`처럼 `<...>` 자리표시자를 따옴표 없이 두면
  `set -a; . ./infrastructure/.env`가 셸 리다이렉션으로 깨진다.
- 통합·e2e는 환경변수 없으면 **조용히 skip되고 exit 0**이다. 수치 인용 전 분모 확인.
- Git Bash에서 `wsl`에 경로를 넘길 때는 `MSYS_NO_PATHCONV=1`.

## Notes

- `git push`는 사람 승인 후 Claude가 실행 가능. **`gh pr merge`는 승인이 있어도
  분류기가 차단** — 사람이 `!` 접두사로 실행할 것. 출력이 비어 보여도 성공한
  것이니 `gh pr view <n> --json state`로 확인할 것.
- DATABASE_URL: 마이그레이션·시드·테스트는 superuser(une), 런타임은 une_app.
