# UNE 재난안전 AI 문서 POC

재난안전계획서 생성 도구 + 안전한국훈련 상황일지 생성 도구. 단일 PC에서 `pnpm` 한 줄로 뜬다. DB·Docker 없음(JSON 파일 저장).

- 요구사항: `docs/01_요구사항정의서.md`
- 인터페이스: `docs/02_인터페이스정의서.md`
- 상황일지 기능정의서(개발팀 전달용): `docs/UNE_상황일지_생성도구_기능정의서_v1.1.docx`

## 실행

```bash
# 저장소 루트에서 한 번
pnpm install

# 방법 1 — 터미널 하나에서 서버+웹 (Ctrl+C로 종료)
pnpm --filter @une/poc dev

# 방법 2 — 백그라운드로 띄우기/내리기 (Windows)
apps\poc\start.cmd     # 서버 :3100, 웹 :5300 (로그: apps/poc/data/server.log, web.log)
apps\poc\stop.cmd
```

열기: **http://localhost:5300/**

사내망 다른 PC에서: **http://<이 PC의 IP>:5300/** (예: `http://10.20.20.46:5300/`, IP는 `ipconfig`로 확인 — DHCP라 바뀔 수 있다). 웹이 `--host`로 전체 인터페이스에 바인딩되고 `/api`는 Vite 프록시가 서버(:3100, 루프백 전용)로 중계하므로 5300 하나만 열리면 된다. Windows 방화벽에 node.exe 인바운드 허용(Public)이 있어야 한다 — 없으면 첫 실행 때 뜨는 허용 대화상자에서 승인.

| 주소 | 화면 |
|---|---|
| `/` | 홈 — 두 도구 진입, 연동 상태(T3Q·유니·rhwp) |
| `/plan` | 계획서: 문서 목록·기준정보 템플릿 |
| `/plan/templates` | HWPX 템플릿 업로드 → 스타일 분석(개요 기호·글꼴·크기) |
| `/plan/:id` | 기준정보 → 목차(T3Q) → 초안(T3Q 스트리밍) → 문단 클릭 챗봇 수정(유니) → 미리보기·HWPX 내보내기·rhwp 재로드 뷰 |
| `/plan/:id/editor` | 내보낸 HWPX를 rhwp 웹 에디터(iframe)에서 직접 편집 → 서버에 저장 |
| `/sit` | 상황일지: 대시보드(훈련 선택·AI 상황분석) |
| `/sit/new` | 훈련상황 생성 + **AI 챗봇 질의**(근거 문서 카드) → AI 생성 시작 |
| `/sit/:id/sop` | SOP 캔버스(유니 생성, 편집, 버전, AI 임무 보완) → 훈련 실행 |
| `/sit/:id/dispatch` | 상황/임무 전파(메시지 변수 치환, 담당자 수신 현황) |
| `/sit/:id/board` | 전자 상황판(시간별 상황내역, 단계 타임라인, 지연 알림, 3초 갱신) |
| `/sit/:id/journal` | 상황일지(사실 절 투영 + AI 서술 절, 검토, HWPX 내보내기, 계획서 환류) |
| `/m/:userId` | 현장 담당자 모바일(수신 확인·완료 보고) — u1~u5 |

로그인 없음. 좌측 하단에서 사용자만 고른다.

## 환경 변수

`infrastructure/.env`(루트)를 자동으로 읽는다. 서버 폴더에 `.env`를 두면 우선.

| 키 | 기본값 | 뜻 |
|---|---|---|
| `UNI_BASE_URL` | `http://10.20.10.101:8088` | 유니 RAG API (웹 UI `:3101`은 API가 아님) |
| `UNI_USERNAME` / `UNI_PASSWORD` | — | 유니 로그인 |
| `UNI_MODEL` | `exaone-4.5` | `/models/`의 키 (`qwen3.6-35b`도 가능) |
| `UNI_VERIFY_TLS` | `0` | 유니가 2026-08-24부터 HTTPS(자체 인증서) — POC는 검증 해제 |
| `UNI_MCP_URL` · `UNI_MCP_TOKEN` | — | 유니 검색(MCP `search_knowledge`) 주소·본인 전용 Bearer 토큰. REST `/search/`가 제거되어 조치카드 추출에 필수. 토큰은 공유 금지 |
| `UNI_MOCK` | — | `1`이면 유니를 부르지 않고 `server/src/mock/*` 녹화 응답 재생 |
| `T3Q_API_BASE_URL` | `https://plf.mois-disaster.t3q.ai` | T3Q 계획서 API |
| `T3Q_MODEL_ID` | `ae894` | |
| `KMA_SERVICE_KEY` | — | 기상청 공공데이터포털 일반 인증키(Decoding). 있으면 날씨·특보를 기상청 API로, 없으면 날씨는 Open-Meteo·특보는 날씨누리 화면 파싱(키 불필요) |
| `CHROME_PATH` | — | 보고서 PDF 내보내기(HWPX → 쪽 SVG → 헤드리스 브라우저 `--print-to-pdf`)에 쓸 브라우저 경로. 비우면 Chrome 기본 경로 → **Edge**(윈도우 내장) 순으로 찾고, 둘 다 없으면 화면에 설치 안내 |
| `T3Q_VERIFY_TLS` | `1` | **POC에서는 `0`** — T3Q 인증서 체인이 불완전해 검증을 끈다. 운영은 켠다 |
| `POC_PORT` | `3100` | 서버 포트 |

유니·T3Q에 닿지 못하면 자동으로 목업으로 폴백하고 홈 화면 "연동 상태"에 표시된다. 데모가 외부망 하나에 멈추지 않는다.

## 구조

```
apps/poc/
  server/src/
    main.ts    Express 라우트 전부 (계획서·훈련·임무·이벤트·일지·연동)
    env.ts     .env 로더 (가장 먼저 import)
    store.ts   JSON 컬렉션 (data/*.json) — DB로 옮길 때 이 파일만
    uni.ts     유니 클라이언트 (로그인·재로그인, /chat/ 스트림, /chat/json, 목업 폴백)
    t3q.ts     T3Q RPT-001(목차)·RPT-002(본문 SSE) 어댑터
    llm.ts     프롬프트 계약 + SOP 매퍼(uni-sop-2) + T3Q 우선/유니 폴백
    hwpx.ts    rhwp WASM: 템플릿 프로파일링, 마크다운→HWPX, HWPX→HTML
    mock/      오프라인 목업 응답
  web/src/
    ui.tsx     공통 컴포넌트 + 마크다운 렌더러(문단 id)
    plan/      계획서 화면 4개
    sit/       상황일지 화면 7개 + 모바일
  data/        런타임 데이터 (gitignore) — templates/plans/exercises/sops/tasks/events/journals.json, files/
  docs/        요구사항·인터페이스·기능정의서
```

## 실측으로 확인된 것 (2026-08-19)

- rhwp `@rhwp/core` 0.8.4: 템플릿 6종(`templete/*.hwpx`) 프로파일링 — 개요 4~5수준, 기호(□ ㅇ - * ○ ※), 글꼴명, 크기, 굵기 인식. 마크다운→HWPX 생성 후 재파싱·렌더 정상. 주의: 문단 0의 표·그림·머리말 컨트롤은 `deleteText`로 안 지워져 `deleteControlAt`으로 제거함. 새 문단은 직전 문단의 정렬을 상속하므로 매 문단 `applyParaFormat`으로 명시.
- T3Q: `toc` 15~17초, `content` 섹션 단위 SSE(`data: {name, content, references[]}`), `targetAudiences`는 `중앙정부|지자체|내부보고|대민`만 허용(422로 확인). 응답 본문 `□ㅇ-* (소제목) …` 관례 → 마크다운으로 정규화.
- 유니: `/chat/` 토큰 SSE(첫 토큰 ~5초), `/chat/json` 노드가 `{"__compn__": {...}}`로 감싸져 옴(+`__status__`, `__sources__`, `[DONE]`) — CC-410 당시와 달라 매퍼에서 둘 다 받음. 로그인 속도 제한(429) 있음 — 토큰 재사용.
- `@rhwp/editor`는 외부 studio(`edwardkim.github.io`) iframe — 인터넷 필요. 선택 텍스트를 호스트로 넘기는 공개 API가 없어 챗봇 문단 수정은 웹 렌더(4-2)에서 한다.

## 범위 밖 / 알려진 한계

- 인증·권한·기관 분리, 감사로그, DB, 실제 SMS/알림톡, DOCX/PDF, 표 단위 챗봇 편집(문단·문장·목록만), 한/글 실기 열림 검증(rhwp 렌더로만 확인).
- SOP 생성은 유니 생성 시간(60~80초)을 그대로 기다린다. 진행 상태 프레임(`__status__`)을 화면에 흘리는 건 후속.
- 유니 `GET /documents/{id}`가 없어 문서 상태 폴링은 목록으로만.
- 임무 완료기한은 SOP 노드에 `HH:mm`이 없으면 실행 시각 + 5분×순번(데모용).

## 테스트 스크립트

`server` 폴더에서 `npx tsx` 로 돌려본 검증 스크립트는 세션 중 임시로 썼고 남기지 않았다. API 흐름은 아래 두 호출 순서로 재현된다 — 인터페이스정의서 B절 참고.

- 계획서: `POST /api/plans` → `PUT …/context` → `POST …/toc` → `GET …/draft/:tocId/stream` → `POST …/revise` → `POST …/export` → `GET …/export/preview`
- 훈련: `POST /api/exercises` → `POST …/sop/generate` → `POST …/start` → `POST …/dispatch-all` → `POST /api/m/:u/tasks/:t/ack|report` → `GET …/board` → `POST …/journal/generate` → `POST …/journal/export` → `POST …/close` → `POST /api/link/exercise-to-plan`
