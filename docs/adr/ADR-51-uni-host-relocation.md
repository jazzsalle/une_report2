# ADR-51 — UNI 호스트 이전 (`221.147.100.161:8000` → `10.20.10.101:8088`)

- 상태: **채택** (2026-08-18)
- 대체하지 않는다. **ADR-50의 주소만 갱신한다** — ADR-50이 확정한 계약·매핑·
  capability 판정은 그대로 유효하다.
- 계기: 사용자 통보 2026-08-18 — "UNI 주소가 `http://10.20.10.101:3101/`로 변경".
- 증거: 이 문서 §측정.

## 맥락

CC-410(2026-08-14)은 `http://221.147.100.161:8000`에 실제로 닿아 UNI 계약을
실측으로 결속했다. 그 주소는 저장소 19개 파일에 퍼져 있었다 — 런타임 설정,
계약 `servers`, 규범 문서, 그리고 **측정이 일어난 자리를 적은 증거·주석**.

2026-08-18 사용자가 주소 변경을 통보했다.

## 측정 (2026-08-18)

| 대상 | 결과 |
|---|---|
| `http://221.147.100.161:8000/openapi.json` | **무응답** (2.03s 후 연결 실패) |
| `http://10.20.10.101:3101/` | 200, **Next.js 웹 UI** (nginx/1.24.0, `<title>유니(UNE Intelligence)</title>`) |
| `http://10.20.10.101:3101/openapi.json` · `/auth/login` · `/docs` | **404 HTML** |
| `http://10.20.10.101:8088/openapi.json` | **200 — `UNI RAG System` 1.1.0, OpenAPI 3.1.0, 26경로/28오퍼레이션** |
| `http://10.20.10.101:8088/auth/login` (POST, 운영 자격증명) | **200**, 최상위 `token`(500자)+`user`(`user_id,user_email,user_name,user_division,user_team,user_position,user_role`) |
| `http://10.20.10.101:8000` | **같은 서비스** — 같은 스펙, 문서 20,671건 동일. `server: uvicorn`(앱 직결) |
| `http://10.20.10.101:8088` | 같은 서비스, `Server: nginx/1.24.0` (프록시 정문) |
| `GET /documents/{doc_id}` (양쪽 모두) | **405 Method Not Allowed, `Allow: DELETE`** — 스펙 누락이 아니라 서버가 거부 |
| 포트 탐색 | `:3100`·`:3102` 404, `:8080` 무응답 |

## 결정

### D1 — 통보된 `:3101`은 웹 UI다. 어댑터 base URL은 `http://10.20.10.101:8088`이다

사용자가 전달한 주소는 **사람이 브라우저로 쓰는 화면**이고, UNE 어댑터가 붙는
API가 아니다. `:3101`을 `UNE_UNI_BASE_URL`에 넣으면 어댑터는 `/auth/login`에
POST하고 **Next.js의 404 HTML**을 받는다 — JSON 파서가 깨지면서
`UNI_MALFORMED_RESPONSE`로 보이고, 원인이 주소라는 사실은 어디에도 안 남는다.

그래서 저장소에는 **둘 다** 적는다. 하나만 적으면 다음 사람이 같은 자리에서
같은 것을 섞는다.

**브라우저에서 로그인이 되는 것은 이 사실과 모순되지 않는다.** `:3101`에는
로그인 *화면*이 있고, 그 화면이 자격증명을 보내는 곳은 다른 포트다. 화면의 JS가
직접 그렇게 말한다(§D1a).

### D1a — 포트는 `:8088`이다. `:8000`이 아니다 (2026-08-18 당일 정정)

이 ADR은 처음에 `:8000`으로 적었다가 같은 날 고쳤다. **틀린 값이었다** —
`/openapi.json`도 `/auth/login`도 200이라 맞아 보였지만, 그것은 *동작하는* 값이지
*이 배포가 지정한* 값이 아니었다.

UNI 웹 UI 번들에 API 주소를 고르는 함수가 들어 있다:

```js
let o = { 3101: "8088" };
function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}:${o[port] ?? "8000"}`;
}
```

**UI가 `:3101`에서 뜨면 API는 `:8088`이라고 UNI가 직접 선언한다.** `8000`은
매핑에 없는 포트를 위한 일반 기본값일 뿐이며, 이 배포에는 `3101 → 8088`이라는
명시적 예외가 있다.

두 포트는 같은 서비스다(같은 스펙, 문서 20,671건 동일). 차이는 앞단이다 —
`:8000`은 `server: uvicorn`으로 앱이 직접 열어 둔 포트이고, `:8088`은
`Server: nginx/1.24.0`으로 프록시 뒤다. 앱 포트를 직접 찌르면 nginx가 하는 일
(속도 제한, 헤더, 장차 TLS 종단)을 건너뛰고, 그 포트가 방화벽으로 닫히는 순간
UNE만 조용히 끊긴다 — UNI 화면은 멀쩡한데.

**교훈**: 200이 온다는 것은 주소가 맞다는 증거가 아니다. 이 경우 정답은
provider의 클라이언트가 무엇을 쓰는지에 있었고, 그것은 추측할 필요 없이
번들에 적혀 있었다.

### D2 — 계약이 같다. ADR-50을 다시 열지 않는다

신 호스트의 `/openapi.json`은 CC-410이 기록한 것과 **같은 서비스·같은 버전**이다
(`UNI RAG System` 1.1.0, 26경로). 핵심 경로도 그대로다:

- `POST /auth/login` — 요청 `account`, 응답 `token`+`user` (실호출 200 확인)
- `GET /documents/` (목록), **`DELETE /documents/{doc_id}` — GET 없음**
- `POST /chat/json`

**OB-13(a)는 닫히지 않았다.** `GET /documents/{doc_id}`는 신 호스트에도 없다.
`knowledgeStatus`가 실 UNI에서 동작하지 않는다는 CC-410 잔여 1번은 주소가
바뀌었다고 사라지지 않는다.

### D3 — 측정 기록의 주소는 고쳐 쓰지 않는다

CLAUDE.md: "Corrections are new versions or correction events; never overwrite
audit history."

`docs/evidence/CC-410-uni-contract-binding.md`, `uni-sop-mapper.ts`,
`uni-sop-mapper.test.ts`, `uni-knowledge-capabilities.ts`의 주소는 **어디서
측정했는지를 적은 문장**이다. 그 자리를 신 주소로 치환하면 하지 않은 곳에서
측정했다고 감사에 남는다. 대신 각 자리에 **정정 주석**을 붙였다.

같은 이유로 `docs/design-markdown/`(승인 기준선)과
`docs/handoff/SESSION_HANDOFF.md`(지난 세션 기록)도 건드리지 않는다. 이 ADR이
그 문서들보다 우선한다(CLAUDE.md 우선순위 1).

**신 호스트에서 재확인된 것은 `/openapi.json`과 `/auth/login` 둘뿐이다.**
업로드·검색·SOP 스트림·삭제 401·422 비밀번호 에코는 옛 호스트 측정이며 신
호스트에서 재현하지 않았다. capability 상태를 이 ADR로 승격하지 않는다.

### D4 — 계획 흐름 가드에 신 주소를 **추가**한다 (구 주소는 남긴다)

`tests/contract/src/no-uni-plan-fallback.test.ts`의 금지 토큰 목록은 계획 흐름
코드에 UNI 흔적이 섞이는 것을 막는다(도메인 규칙: "UNI calls in plan flow are
prohibited"). 신 주소로 **교체**하면 아직 옛 주소를 들고 있는 코드가 계획
흐름에 들어와도 통과한다. 둘 다 둔다.

## 변경한 파일

**런타임·규범 (주소 교체):**

| 파일 | 내용 |
|---|---|
| `infrastructure/.env` | `UNI_BASE_URL` (gitignore, 커밋 안 됨) |
| `.env.example` | `UNI_API_BASE_URL` |
| `CLAUDE.md` | UNI 호스트 규칙 — API/UI 구분 명시 |
| `docs/reference/SOURCE_INDEX.md` | |
| `docs/external-dependencies/EXTERNAL_DEPENDENCIES.md` | |
| `docs/external-dependencies/UNI_API_BINDING.md` | 후보 탐색 URL 목록 → 실측 확인값 |
| `contracts/openapi/uni-rag-adapter-v1.1.0-une1.yaml` | `servers[0].url` |
| `contracts/openapi/uni-knowledge-api-change-request-v1.yaml` | `servers[0].url` |

**가드 (추가):** `tests/contract/src/no-uni-plan-fallback.test.ts`

**정정 주석만 (덮어쓰지 않음):** `docs/evidence/CC-410-uni-contract-binding.md`,
`packages/provider-adapters/src/uni/sop/uni-sop-mapper.ts`(+`.test.ts`),
`packages/provider-adapters/src/capability/uni-knowledge-capabilities.ts`

**건드리지 않음:** `docs/design-markdown/10_API_DB_SEQUENCE_v1.0.md`,
`docs/design-markdown/12_CLAUDE_CODE_DEVELOPMENT_HANDOFF_v1.1.md`,
`docs/handoff/SESSION_HANDOFF.md`

## 남는 것

1. **어댑터는 아직 실 UNI에 붙지 않는다.** `infrastructure/.env`가 쓰는 키는
   `UNI_BASE_URL`인데 어댑터 팩토리가 읽는 키는 **`UNE_UNI_BASE_URL`**이다
   (`uni-knowledge-factory.ts:88`, `uni-sop-factory.ts:54`). 접두사가 달라
   현재 로컬 API는 `mock` 어댑터로 뜬다. **이 ADR은 주소만 고쳤고 이 불일치는
   고치지 않았다** — 실 어댑터를 켜는 것은 OB-13(a)로 `knowledgeStatus`가 전부
   실패하는 상태로 들어가는 일이라 별도 판단이 필요하다.
2. **`UNI_PASSWORD` 교체는 여전히 필요하다** (CC-410 Risks). 이전으로 사라지지
   않았고, UNI의 422가 제출 본문을 평문으로 에코하는 결함도 그대로다.
3. **TLS 없음.** 신 주소도 평문 `http`다. 사설 대역(`10.20.10.101`)으로 옮겨
   외부 노출은 줄었지만 사내망 평문이라는 성질은 같다.
4. **ADR-46~49가 `docs/adr/README.md` 인덱스에 여전히 누락**(이전 세션 드리프트).
   이 ADR에서 51만 추가했다.
