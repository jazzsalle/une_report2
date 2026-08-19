# UNE 재난안전 AI 문서 POC

RS-2024-00407304 UNE 담당 영역의 **동작 POC**: 재난안전계획서 생성 도구 + 안전한국훈련 상황일지 생성 도구.

```bash
pnpm install
pnpm dev          # 서버 :3100 + 웹 :5300 → http://localhost:5300/
```

| 경로 | 내용 |
|---|---|
| `apps/poc/` | 전체 코드. 실행법·구조·한계는 `apps/poc/README.md` |
| `apps/poc/docs/` | 요구사항정의서, 인터페이스정의서, 상황일지 기능정의서(docx) |
| `templete/` | HWPX 템플릿 6종 — 기동 시 자동 등록, 스타일 분석 대상 |
| `화면설계서/` | 2차년도 계획서 도구 화면설계서(PDF)·화면목록·기능분해도 |
| `상황일지 기획 화면 예시/` | 상황일지 도구 기획 화면 9장 |
| `설계 및 개발착수 문서/` | 원 설계 문서(docx) — 참고용 |
| `contracts/openapi/` | T3Q·UNI 계약 파일 — 참고용 |
| `docs/adr/`, `docs/handoff/`, `docs/design-markdown/` | 이전 구현의 결정 기록·설계 — 참고용 |
| `infrastructure/.env` | 유니·T3Q 자격증명 (gitignore, 직접 채움) |

이전 구현(NestJS·Postgres·RLS 등)은 2026-08-19에 제거됐다. `git` 이력(`448eab9` 이전)에 있다.
