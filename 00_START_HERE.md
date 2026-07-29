# UNE 재난안전 AI 문서 통합플랫폼 - Claude Code Max 개발패키지

버전: 1.1  
작성일: 2026-07-28  
과제번호: RS-2024-00407304

## 목적

이 패키지는 설계 완료 후 Claude Code Max에서 실제 개발을 시작하기 위한 인계 기준선이다. DOCX는 공식 설계산출물이며, Markdown·YAML·JSON·SQL은 Claude Code와 개발도구가 직접 읽고 검증할 수 있는 실행 기준선이다.

## 최초 사용 순서

1. 패키지 전체를 신규 Git 저장소 루트에 복사한다.
2. `CLAUDE.md`와 `docs/handoff/IMPLEMENTATION_BASELINE.md`를 읽는다.
3. `work-items/00_DECISIONS_TO_CONFIRM.yaml`의 OPEN 값을 확정한다.
4. `scripts/validate-handoff.sh` 또는 PowerShell 버전을 실행한다.
5. Claude Code를 저장소 루트에서 `claude --permission-mode plan`으로 시작한다.
6. `prompts/01_FIRST_SESSION_PROMPT.md` 내용을 첫 프롬프트로 입력한다.
7. `CC-000`부터 한 Work Item씩 개발하고, 완료할 때마다 `work-items/IMPLEMENTATION_STATUS.md`를 갱신한다.

## 설계 Source of Truth 우선순위

1. `docs/design-docx/03_ADR_v1.1.docx`
2. `docs/handoff/IMPLEMENTATION_BASELINE.md`
3. `docs/design-docx/10_API_DB_SEQUENCE_v1.0.docx`
4. `contracts/openapi/`, `contracts/schemas/`, `database/migrations/`
5. 화면·사용자 시나리오·HWPX·UNI 상세명세
6. 통합플랫폼 마스터 상세설계 v0.9
7. 원천 요구사항 및 참고자료

상충 시 상위 문서를 우선하고, 임의 해석하지 말고 ADR 또는 Change Request를 생성한다.

## 핵심 범위

- UNE: 재난안전계획서 생성도구 고도화, HWPX 편집·저장, 상황일지 생성도구, SOP·임무·전파·실행이력·전자상황판
- T3Q: RAG/LLM, TTS/STT, 외부 연계 API
- 계획서 AI 생성: T3Q RPT-001/002만 사용
- 상황일지 POC: UNI Upload/Search/chat-json/chat 사용 후 T3Q 실제 계약으로 Adapter 교체
- 사실원장: 사용자 확정 SituationSnapshot + Append-only Execution Log
- LLM은 숫자·시간·상태 등 사실값을 새로 만들거나 변경할 수 없음

## 금지

- 계획서 생성 과정에서 UNI API 호출
- LLM 응답을 사실원장으로 저장
- 승인된 Snapshot/SOP Version/Execution Event 덮어쓰기
- 외부 Provider 원본 Schema를 UI·도메인에 직접 노출
- 사용자 수정 Block을 AI 재생성으로 덮어쓰기
- 공개 Fork를 운영 기준선으로 사용
- 운영 요청마다 한컴오피스를 실행하는 구조
- 비밀키·토큰·개인정보의 Git 커밋

## 패키지 구성

- `CLAUDE.md`: 모든 세션에 적용할 프로젝트 핵심 규칙
- `.claude/rules`: 경로별 개발 규칙
- `.claude/skills`: 반복 개발절차
- `.claude/agents`: 전문 Subagent
- `docs/design-docx`: 공식 DOCX 설계산출물
- `docs/design-markdown`: Claude Code 검색용 Markdown 변환본
- `docs/handoff`: 구현 기준선·상태·OPEN·세션 프로토콜
- `contracts`: OpenAPI·JSON Schema
- `database`: DDL·ERD·데이터사전
- `mock-server`: T3Q·UNI 미연계 시 사용하는 POC Mock
- `work-items`: 개발 순서·의존성·완료기준
- `prompts`: 첫 세션·재개·구현·검토 프롬프트
- `scripts`: 설치·검증·세션 시작 보조 스크립트
- `tests`: Contract/E2E 기준


## v1.1 추가 기준선

- `docs/design-docx/13_T3Q_PLAN_API_CHANGE_REQUEST_v1.0.docx`
- `contracts/openapi/t3q-plan-api-change-request-v1.yaml`
- `docs/external-dependencies/`: ProcessGPT, process-gpt-office-mcp, rhwp, UNI Binding
- `.env.example` 및 `config/provider-bindings.example.yaml`
- Plan Provider는 Legacy RPT-001/002와 Target-v2 Mock을 병행하며 T3Q 변경 완료를 기다리지 않는다.
- Target-v2 Mock 동작을 T3Q 실제 지원으로 보고하지 않는다.
