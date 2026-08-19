# UNE 재난안전 AI 문서 POC

## 지금 이 저장소는

2026-08-19에 **전면 재구축**됐다. 이전의 NestJS·Postgres·RLS·Outbox 구현(ADR-19~51, CC-000~430)은 사용자 판단으로 과도하다고 보고 `git` 이력(커밋 `448eab9` 이전)에만 남기고 작업 트리에서 제거했다. 지금 코드는 `apps/poc/` 하나다.

- 실행·구조·한계: `apps/poc/README.md`
- 요구사항: `apps/poc/docs/01_요구사항정의서.md`
- 인터페이스: `apps/poc/docs/02_인터페이스정의서.md`
- 상황일지 기능정의서(개발팀 전달): `apps/poc/docs/UNE_상황일지_생성도구_기능정의서_v1.1.docx`
- 마지막 세션 기록: `docs/handoff/SESSION_HANDOFF.md`

한국어로 보고·주석을 쓴다. 코드 관례가 요구할 때만 영어.

## 목표

개발팀에 넘길 **동작하는 POC**. 보안·암호화·멀티테넌트·감사·DB는 범위 밖. 단일 PC, `pnpm dev` 한 줄.

### 재난안전계획서 생성 도구 (`/plan`)
1. 2차년도 화면설계서(`화면설계서/*.pdf`, V0.2.6) 흐름 준수: 문서 저장 → 기준정보 → 목차 생성/편집 → 초안(목차별 진행 상태) → 편집 → 내보내기
2. HWPX 템플릿(`templete/*.hwpx`)의 문단개요번호·기호·글꼴·크기·스타일을 rhwp로 분석해 목차·초안 생성과 내보내기에 적용
3. 목차·초안은 **T3Q RPT-001/002**(`https://plf.mois-disaster.t3q.ai`, TLS 검증 해제 `T3Q_VERIFY_TLS=0`). 실패 시 유니 폴백
4. 문단 선택 → 챗봇(유니) 수정 → 교체. 사용자 수정 문단은 재생성 보호
5. HWPX 내보내기(rhwp) → rhwp 재로드 뷰 → `@rhwp/editor`에서 직접 편집 가능

### 상황일지 생성 도구 (`/sit`)
기획 화면 9장(`상황일지 기획 화면 예시/*.png`): 훈련상황 생성(**AI 챗봇 자연어 질의 + 근거 문서 카드** — 등록 문서 목록은 노출하지 않음) → 유니 SOP 생성/캔버스 편집 → 임무 전파 → 모바일 수신확인/완료보고 → 전자상황판(이벤트 투영) → 상황일지(사실 절 투영 + AI 서술 절) → HWPX.

### 연동
계획서(T3Q 생성) → 훈련(유니 SOP + 사실 기록) → 계획서 개정(훈련 결과 환류). 상황일지를 T3Q로 만들지 않는다 — 문서 성격이 다르다.

## 외부 연동 (실측)

| | 주소 | 메모 |
|---|---|---|
| 유니 RAG API | `http://10.20.10.101:8088` | `:3101`은 웹 UI(API 아님). `/auth/login {account,password}` → `token`. `/chat/` 토큰 SSE, `/chat/json` 노드가 `{"__compn__":…}`로 감싸짐. 로그인 429 있음 — 토큰 재사용 |
| T3Q | `https://plf.mois-disaster.t3q.ai/model-api/ae894/reports/plan/{toc,content}` | 인증서 체인 불완전 → POC는 검증 해제. `targetAudiences`는 중앙정부/지자체/내부보고/대민 |
| rhwp | `@rhwp/core` 0.8.4 (MIT, WASM) 서버 내장 · `@rhwp/editor` iframe(외부 studio) | 문단 0 컨트롤은 `deleteControlAt`으로, 새 문단 정렬은 매번 `applyParaFormat`으로 |
| 2차년도 사이트 | `https://ec2-43-200-234-120.ap-northeast-2.compute.amazonaws.com:7083/main` | 참고 |

자격증명은 `infrastructure/.env`(gitignore). 유니·T3Q에 못 닿으면 `apps/poc/server/src/mock/*`로 폴백.

## 작업 규칙

- 새 기능은 `apps/poc/server/src/main.ts`(라우트)·`llm.ts`(프롬프트)·`hwpx.ts`(문서)·`web/src/{plan,sit}`에 바로 쓴다. 문서 작성은 요구사항·인터페이스 두 개만 갱신.
- 외부 API 응답 모양은 **실호출로 확인**한 뒤 코드에 반영하고 그 사실을 주석에 남긴다(`실측 YYYY-MM-DD`).
- 삭제·푸시·배포는 사용자 승인 후. 비밀값은 코드·문서·로그에 넣지 않는다.
- 지우지 말 것: `화면설계서/`, `상황일지 기획 화면 예시/`, `templete/`, `설계 및 개발착수 문서/`.
