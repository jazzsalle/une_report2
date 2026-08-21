# UNI API Binding

## Endpoint

**API (UNE 어댑터가 붙는 곳): `http://10.20.10.101:8088`** — 2026-08-18 실측 확인.
`/openapi.json` 200, `UNI RAG System` 1.1.0, 26경로/28오퍼레이션, `POST /auth/login` 200.
정본 **ADR-51**.

**웹 UI: `http://10.20.10.101:3101`** — 사람이 브라우저로 쓰는 화면(Next.js,
제목 "유니(UNE Intelligence)")이다. **API가 아니다.** `/openapi.json`·`/auth/login`
모두 404 HTML을 돌려주므로 어댑터 base URL로 쓰면 안 된다. UNI 주소를 전달받을 때
이 둘이 섞이기 쉬워 여기 함께 적어 둔다.

이전 호스트 `http://221.147.100.161:8000`은 2026-08-18 기준 **응답하지 않는다**
(연결 시도 2초 후 타임아웃). CC-410의 모든 실측은 그 주소에서 나온 것이며,
증거 문서의 그 주소를 고쳐 쓰지 않는다 — 측정이 일어난 자리는 그 자리다.

## 이 배포의 포트 구성 (실측 2026-08-18)

| 포트 | 정체 | 앞단 |
|---|---|---|
| `:3101` | 웹 UI (Next.js) | nginx/1.24.0 |
| **`:8088`** | **API — 이 값을 쓴다** | nginx/1.24.0 |
| `:8000` | 같은 API의 앱 자체 포트 | uvicorn 직결 (프록시 없음) |

`:8000`과 `:8088`은 **같은 서비스다** — 같은 스펙(`UNI RAG System` 1.1.0, 26경로),
같은 문서 20,671건이 보인다. `:8000`은 uvicorn이 직접 열어 둔 포트이고 `:8088`은
그 앞의 nginx다(`server:` 헤더로 구분).

**`:8088`을 쓰는 근거는 취향이 아니라 UNI 자신의 코드다.** 웹 UI 번들
(`/_next/static/chunks/10zv-nd2sld5-.js`, `0hmj~4zoy-90l.js`)에 API 주소를 고르는
함수가 들어 있다:

```js
let o = { 3101: "8088" };
function resolveApiBase() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}:${o[port] ?? "8000"}`;
}
// 로그인은 fetch(`${resolveApiBase()}/auth/login`, …)
```

즉 **UI가 `:3101`에서 뜨면 API는 `:8088`이라고 UNI가 직접 선언한다.** `8000`은
매핑에 없는 포트를 위한 일반 기본값일 뿐이다. 앱 포트를 직접 찌르면 nginx가
하는 일(속도 제한, 헤더, 장차 TLS 종단)을 건너뛰고, 방화벽이 닫히면 조용히 끊긴다.

`:3100`·`:3102`는 404, `:8080`은 무응답.

## Intended POC operations
- document upload and processing status
- evidence search
- structured JSON generation for SOP candidates
- SSE/chat generation where useful

## Boundary
- browser must not call UNI directly
- plan generation must not call UNI
- UNI is not a propagation, task, execution-log, or journal fact provider
- raw requests/responses and mapping version are retained
- actual base path, authentication, TLS, timeouts, limits, and error schema remain OPEN until live contract verification
