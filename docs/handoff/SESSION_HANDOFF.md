# Session Handoff

- 일시: 2026-08-25 (회사 PC, 열다섯 번째 날)
- 브랜치: `feature/sit-v2`, origin과 동기(0/0). **main보다 10커밋 앞섬**(`a5d9f14`~`e1599a8`) — main 반영 PR은 아직 안 만듦.
- **작업 트리 깨끗하지 않음**: `.claude/rules/` 6개 파일이 삭제된 채 커밋 안 됨(아래 "결정 필요" 참조).
- 상태: 서버 :3100 API + :5300 웹 모두 기동 확인(`/api/plans` 200, `http://10.20.20.46:5300/`). 오늘 재기동함.
- **POC 코드는 오늘 한 줄도 바뀌지 않음.** 계획서·상황일지 기능 상태는 2026-08-24와 동일.

## 2026-08-25에 한 일

| 구분 | 내용 |
|---|---|
| 서버 재기동 | 어제 20:08 기동분이 EXIT 줄 없이 사라짐(PC 종료로 추정 — 8/24 낮의 원인 미상 조기 종료와는 다른 패턴). 재기동 시 웹이 `vite/bin/vite.js` MODULE_NOT_FOUND로 실패 → pnpm 저장소 링크 깨짐 → `pnpm install`(1.5초, +2/-2)로 복구 후 정상. **집·회사 PC를 오가면 이 증상이 재발할 수 있음 — `pnpm install` 먼저.** |
| `/doctor` 점검·정리 | 설치는 정상(네이티브 단일, 2.1.241 = latest 최신). 정리 적용: 스킬 8개 off, 중복 MCP 서버 1개 off, github 플러그인 off, 자동 모드를 기본 권한 모드로, **`.claude/rules/` 파일 6개 삭제**. 상세는 아래. |
| 계획서 생성 방식 전환 검토 | "템플릿 고르면 rhwp 편집기가 배경으로 뜨고 그 위에 초안이 채워지는" 구조를 조사·설계. **사용자가 진행하지 않기로 결정(계획 승인 거부).** 코드 변경 없음. 조사 결과는 아래에 남김 — 나중에 다시 꺼낼 때 재조사 불필요. |

## 결정 필요 (다음 세션 첫 액션)

`.claude/rules/`에서 6개 파일이 **삭제된 채 커밋되지 않았습니다.** `git status`에 ` D`로 보입니다.

- `architecture.md` — 지워진 계층형 구조(포트·어댑터·ADR·트랜잭션 경계) 지시. **항상 로딩**되며 CLAUDE.md의 "새 기능은 `main.ts`·`llm.ts`·`hwpx.ts`에 바로 쓴다"와 정면 모순이었음.
- `backend.md`·`database.md`·`frontend.md`·`hwpx.md`·`testing.md` — 각각 `services/`·`packages/`·`database/`·`tests/`·`apps/web/` 경로에만 반응하는 `paths` 규칙인데 그 폴더들이 전부 없어 **영원히 로딩되지 않던** 파일.
- 남긴 것: `provider-adapters.md`(`contracts/openapi/*t3q*`가 아직 있어 살아 있음), `security.md`.

**셋 중 하나를 고를 것**: (a) 그대로 커밋, (b) `git checkout -- .claude/rules/`로 전부 복구, (c) 일부만 복구.

미완료 항목 하나 더 — `security.md`에서 아래 2줄을 지우려다 **자동 모드 분류기가 차단**해서 못 했습니다(보안 규칙 삭제로 보여서). 둘 다 DB·멀티테넌트 전제라 CLAUDE.md의 "범위 밖"과 어긋납니다. 나머지 4줄(비밀값 금지·개인정보 마스킹·최소 권한·배포 승인)은 지금도 유효.

```
- Enforce tenant isolation on every repository/query path.
- Validate file type by content, size, extension, malware scan result, and authorization.
```

## `/doctor` 적용 내역 (되돌리는 법)

| 파일 | 변경 | 되돌리기 |
|---|---|---|
| `~/.claude/settings.json` | `permissions.defaultMode: "auto"` 추가 · `github@claude-plugins-official` → `false` | 해당 줄 삭제 / `true`로 |
| `.claude/settings.local.json` (git 미추적) | `skillOverrides` 8개 `"off"`: bootstrap-repository, complete-gate, contract-sync, database-migration, hwpx-roundtrip, implement-work-item, t3q-contract-binding, work-batch | `skillOverrides` 블록 삭제 |
| `~/.claude.json` | 이 프로젝트 `disabledMcpServers`에 `une-rag` 추가 | `/mcp enable une-rag` (백업 `~/.claude.json.doctor.bak`) |

- 끈 스킬 8개는 전부 **지워진 구조(MASTER_WORK_ITEMS.yaml·Postgres·모노레포)의 잔재**. `session-handoff`만 살아 있음(실제 사용 중).
- `une-rag`와 `uni-rag`는 **주소·방식이 완전히 동일한 중복 등록**(둘 다 `http://10.20.10.101:3100/mcp`). `uni-rag`만 남김.
- ⚠️ **`~/.claude.json`에 대소문자만 다른 프로젝트 항목이 둘 있음** — `D:/vibecoding/report2`(MCP 서버가 여기 등록됨)와 `D:/VibeCoding/report2`(비어 있음). **대문자 경로로 Claude Code를 켜면 유니 MCP가 안 보임.** 항상 `D:\vibecoding\report2`에서 실행할 것.
- SessionStart 훅(`load_progress.sh`)은 빠름(중앙값 0.6초)이나 24회 중 5회 오류로 끝남. 세션 시작 때 이 핸드오프가 안 보이면 이 훅을 의심할 것.

## rhwp 편집기 배경 방식 — 조사 결과 (구현 안 함, 나중에 재사용)

전체 문서는 `C:\Users\kyh\.claude\plans\rhwp-giggly-globe.md`. 핵심만:

**결론**: 가능하지만 "편집기 안에 AI가 써 넣는" 그림은 불가능. 실제로는 "서버가 문서를 고쳐 편집기에 다시 띄우는" 것이 된다.

- **`@rhwp/editor` 0.8.4의 천장**: 공개 API가 `loadFile` / `exportHwpx` / `getPageSvg` / `pageCount` / `notifySaved` / `destroy` 뿐. **커서·선택·삽입 API 없음.** 요구사항 **D5**(2026-08-19)가 이미 같은 이유로 4-1 경로를 기각했고, 그 근거는 지금도 유효.
- **`buildHwpx()`가 이미 원하는 일의 90%를 한다** — 템플릿 열기 → 머리 표 "제목" 칸 치환 → 견본 구간 삭제 → 그 자리에 삽입 → 표 생성·서식 복사 → 머리/꼬리 보존.

**실측 (2026-08-25, rhwp 0.8.4 · Node 22.19)**

| 측정 | 값 |
|---|---|
| `buildHwpx` 전체 재조립 (11절·66항목·11표) | **506~570ms** |
| `renderHwpxSvg` 8~9쪽 전부 | **21~40ms** |
| `beginBatch/endBatch`로 감싼 200문단 삽입 | 300ms → **7ms** (43배) |
| 문단 좌표 78개 `getCursorRect` | 27ms |
| SVG 4쪽 페이로드 | 696KB → gzip **13KB** |

→ **성능은 걸림돌이 아니다.** 증분 갱신 같은 장치 불필요, 통째 재생성으로 충분.

**판을 바꾸는 발견**: `getCursorRect`의 좌표계와 `renderPageSvg`의 viewBox 좌표계가 **같다.** 즉 한글 실물 SVG 위에 문단별 투명 클릭 박스를 픽셀 단위로 얹을 수 있고, 문단 주소(`tocId#p인덱스`)가 안 바뀌므로 **챗봇 수정·이력·근거·재생성 보호가 전부 그대로 살아남는다.** 편집기를 안 쓰므로 인터넷도 불필요. "한글 배경"과 "문단 챗봇 수정" 중 하나를 포기해야 한다고 봤던 게 실은 **둘 다 가능**하다.

**현재 동작에 대해 알아야 할 것**
- `AI 행정문서 템플릿.hwpx`의 고정 항목명 "1. 추진 배경"·"2. 주요 내용"과 6×4 표가 **견본 구간으로 판정돼 통째로 삭제된다.** 견본이 더미("가나다라")인 템플릿엔 맞지만, 항목명이 고정된 실제 기관 서식에선 정반대로 동작한다.
- `hwpx.ts` 헤더 주석이 부정확: "`HwpViewer` 만든 뒤 같은 doc으로 export하면 null pointer"라고 적혀 있으나, 실제로는 **그 doc의 모든 메서드가 죽는다**(`getParagraphCount`도 터짐).
- `getFieldList()`가 템플릿 4종 모두 `[]` — 누름틀이 하나도 없음. `insertClickHereField`/`setFieldValueByName`은 왕복 보존 확인됨(심으면 동작함).
- `insertTableRow`는 위 행의 서식(테두리·여백)을 **상속함**(실측 확인).
- `readTableStyle`은 병합 셀 표를 **의도적으로 배제**하고 `cell_idx = row*colCount + col`를 씀. 실제 행정 서식 제목표는 병합이 흔해 여기서 걸린다.
- `sec_idx = 0` 하드코딩(다중 구역 미지원)은 그대로.

**아직 검증 안 된 것 (재개하면 여기부터)**
1. **편집기 왕복 손실** — 템플릿을 편집기에 넣었다 *무편집으로* 빼서 머리 제목표·보고경로표·테두리·개요번호가 남는지, 3회 연속 누적은 어떤지. `exportHwpx`는 바이트 패치가 아니라 파싱→IR→재직렬화라 손실 가능. `exportHwpxWithReport().contentLoss()`로 계측 가능(현재 미사용).
2. **표 셀 번호 좌표계** — `getTableCellBboxes`의 `cellIdx`가 `insertTextInCell`이 받는 번호와 같은 체계인지. 이번 조사는 같다고 **가정**만 했고 교차 확인 안 함. 어긋나면 값이 엉뚱한 칸에 들어간다.

**테스트 방법 (사용자와 합의된 방향, 실행은 안 함)**: 포크하지 말 것 — 서버 부팅이 rhwp WASM에 하드 의존이고 테스트 재료(템플릿 4종·계획서 22건·표 든 절 71개)가 이 저장소에 있음. 대신 ① 화면 없이 스크립트로 위 2건 실측 → ② 브랜치 하나 파서 `/api/lab/*` + `/lab/canvas` 라우트 **추가만**(기존 코드 0줄 수정, 되돌리기는 라우트 2줄 삭제) → ③ 검증 후 `PlanEditor`에 토글로 편입.

## 실측으로 알아낸 것 (이전 세션들, 코드 주석에도 있음)

- **유니 검색**: MCP `search_knowledge`가 512자 청크. 결과 1건당 ≈1.2초 → 협업기능별 13회(top_k 20)가 기본(≈5분). "코드번호 ①-2-3" 직접 질의는 새 카드 0장. **동시 호출 금지**(서버가 큐로 직렬화).
- **매뉴얼 카드 형식은 기관마다 다르다**: 영천(가로 한 줄 표, `①-2-8`, ⓢ/ⓒ) vs 부산(세로 항목, `44-2`, 단계 "비상 대응"). 공통 코드 0개. 새 기관 매뉴얼은 청크 2~3개를 먼저 보고 형식 확인. 영천 40장·부산 24장.
- **유니 서술 절이 프롬프트 속 문장을 따라 한다**: 옛 실패 이벤트 문구를 사실 기록에 넣자 그 문장만 돌려줌(180초). → AI분석·보고 이벤트·상태 문구 제외 + 재시도(`reports.ts narrateSafe`).
- PDF: HWPX → rhwp 쪽 SVG → A4 HTML → 헤드리스 브라우저 `--print-to-pdf`. Chrome·Edge 모두 6쪽 동일. `file:///D:/...` 윈도우 경로여야 함(MSYS `/d/…`는 빈 페이지).
- 기상청 API: 특보 `getPwnStatus`+`getWthrWrnList`, 날씨 `getUltraSrtNcst`(LCC 격자). 키는 `infrastructure/.env` `KMA_SERVICE_KEY`(Decoding형). 날씨누리 `warning.do`는 키 없이 파싱 가능.
- T3Q `paragraphSymbol`은 `"□, ○, -"`처럼 콤마 구분.
- 수정자는 서버 미들웨어가 `X-User` 헤더로 기록한다(계획서·기준정보 템플릿, 성공한 쓰기만, save-as 제외). 화면 `api()`가 localStorage `poc.user`에서 헤더를 만든다 — 스크립트로 고칠 땐 헤더를 직접 넣어야 수정자가 남는다.
- Git Bash에서 한글 JSON을 `curl -d`로 보내면 CP949로 깨진다 → Python `urllib`로 UTF-8 전송. Python이 MSYS 경로(`/c/...`)는 못 연다.
- PowerShell 5.1의 `ConvertFrom-Json`은 정상 JSON을 "Unrecognized escape sequence"로 잘못 거부할 때가 있다(`.claude/settings.local.json`에서 발생). Python `json`으로 교차 확인할 것. 또 `~/.claude.json`은 대소문자 중복 키 때문에 아예 파싱 실패한다.

## 운영 규칙 (사용자 결정)

- `bypassPermissions` 같은 권한 우회 설정은 **절대 커밋하지 않는다**. 디자인 폴더는 디자인이 끝난 뒤에만 올린다. `*.fig`는 gitignore.
- 푸시·PR 생성은 Claude가 하고, **머지는 사용자가 "머지해"라고 할 때만**.
- 브랜치 전략: `main`은 안정판, `feature/sit-v2`에서 단계별 PR. 데이터 변경은 **필드 추가만**(안정판이 같은 JSON을 읽게).
- 상황관리: 실제/훈련/도상은 **같은 화면·모드 전환**, 훈련 SOP → 실제 승격 기능 없음. 상황일지를 T3Q로 만들지 않는다.
- SOP·상황판처럼 급박할 때 보는 화면은 **사용성 문제가 보이면 그때그때 제안**(묻지 않고 바꾸지는 않음).

## 남은 것 / 다음 세션

1. **`.claude/rules/` 삭제분 처리** — 위 "결정 필요" 참조. 첫 액션.
2. **main 반영 PR**: `feature/sit-v2`가 main보다 10커밋 앞(계획서 DOCX·HWPX 수정·환경설정 분리·호버 메뉴·핸드오프). 사용자가 원할 때 PR 생성 → "머지해"로 진행.
3. DOCX 검증(사용자 직접): 즉보 `hsBLNczNV9`(영천), 평가서·복구계획서 `TP4wm_UNV2`(훈련), 분석 보고서 `04_…분석보고서.hwpx` 표 칸 확인 — 8/24부터 이월, 완료 여부 기록 없음.
4. 보류(사용자 결정): 전파 화면 "현재 단계 임무 일괄 전파"는 뺌. **주관부서별 스윔레인**(부산처럼 협업기능 없는 매뉴얼용)은 나중에 스윔레인 화면을 보여주며 다시 제안.
5. 후보: 상황판에서 현재 단계 임무 우선 정렬, 매뉴얼 단계 추정 편향(부산 카드 다수가 수습복구) 검수 UI 보강, 복구계획서 피해 행 원천(피해 보고 이벤트 종류) 신설.
6. 유니 `UNI_PASSWORD` 교체 권고 유지. 유니가 바쁘면 서술 절이 30초 → 180초로 늘어남(재시도 1회).
7. 테스트 데이터: 매뉴얼 2권(영천·부산), SOP 템플릿 2개, 실제상황 `hsBLNczNV9`(영천)·`yf2jV3fKJF`(부산), 보고서 즉보 v1(최종)·v2·중간 1보·2보·복구계획서·평가서 — 데모용으로 남겨 둠.

**해소된 이월 항목**: 8/24 핸드오프의 "유니 주소가 `https`로 찍힘 — 확인 요망"은 확인 완료. `infrastructure/.env`의 `UNI_BASE_URL`과 `uni.ts:14`의 기본값이 **둘 다 `https://10.20.10.101:8088`로 일치**한다. 의도된 값으로 보고 그대로 둠.

## 환경 재개

```bash
git checkout feature/sit-v2 && git pull
pnpm install                    # PC를 옮겼거나 vite MODULE_NOT_FOUND가 나면 반드시
pnpm dev                        # 서버 :3100 + 웹 :5300
```

`infrastructure/.env`: `UNI_BASE_URL=https://10.20.10.101:8088`, `UNI_USERNAME`, `UNI_PASSWORD`, `T3Q_VERIFY_TLS=0`, `KMA_SERVICE_KEY`, (선택) `CHROME_PATH`. 집 PC엔 이 파일이 없으니 다시 채울 것. 유니 MCP(`10.20.10.101:3100/mcp`)는 Claude Code 로컬 스코프에만 등록됨(커밋 안 됨) — **소문자 경로에서 실행해야 보임**.
서버를 Claude Code로 띄울 땐 PowerShell WMI `Win32_Process.Create`(숨김 창) + exit 로그 래퍼 — 도구 호출이 끝나면 일반 프로세스는 죽는다(메모리 `poc-server-detached-launch`).
