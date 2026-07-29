# UNE Disaster Document Platform

RS-2024-00407304의 UNE 담당 영역: 재난안전계획서 생성 도구 + 상황일지/안전한국훈련 지원 도구.
설계 기준선과 작업 규칙은 `CLAUDE.md`, `docs/handoff/`, `work-items/`를 먼저 읽는다.

## 구조

| 경로 | 내용 |
|---|---|
| `apps/web` | React/TS 운영 워크스페이스 (Vite, :5173) |
| `apps/field-web` | 반응형 현장임무 UI (Vite, :5174) |
| `services/api` | NestJS 도메인 API (:3001, 계약 base `/api/v1`, ops `/health`는 루트) |
| `services/worker` | NestJS standalone 워커 (outbox/job 폴링은 CC-270) |
| `services/hwpx-engine` | HWPX 분석/직렬화 경계 — rhwp 반입은 ADR-15 게이트 후 CC-140 |
| `packages/domain` | 공유 도메인 타입/규칙 |
| `packages/provider-adapters` | T3Q/UNI/공식 제공자 어댑터 (포트는 CC-115+) |
| `contracts` | OpenAPI/JSON Schema |
| `database/migrations` | PostgreSQL forward-only 마이그레이션 (CC-004부터) |
| `tests` | 크로스컷 스위트 자리 (G0에서는 미연결 — 패키지 unit 테스트는 각 패키지 내부, `tests/baseline` pytest는 추후 연결) |
| `templete` | 실제 HWPX 보고서/상황보고 양식 — HWPX 라운드트립 테스트 입력 |

## 요구 사항

- Node >= 22.12, pnpm >= 10 (`npm install -g pnpm`)
- Python 3.11+ (검증 스크립트)
- Docker Compose 호환 런타임 — CC-002부터 (무료 경로: WSL2 Docker Engine CE / Rancher Desktop / Podman)

## 루트 명령

```bash
pnpm install          # 워크스페이스 전체 설치
pnpm build            # 전체 빌드
pnpm typecheck        # 전체 타입체크
pnpm test             # 전체 테스트 (vitest)
pnpm lint             # ESLint (flat config)
pnpm validate:handoff # 핸드오프/YAML/JSON 검증
```

## 기술 프로파일

CC-000 승인 (2026-07-30): NestJS(Node/TS) · React 19 · PostgreSQL 16+ · pnpm ·
MinIO(S3 호환) · GitHub Actions. 근거와 제약: `docs/handoff/TECHNOLOGY_PROFILE.md`,
`docs/adr/README.md` (ADR 등록부).
