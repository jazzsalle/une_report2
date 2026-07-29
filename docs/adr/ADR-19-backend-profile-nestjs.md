# ADR-19 백엔드 구현 프로파일: NestJS (Node/TypeScript)

- 상태: ACCEPTED
- 결정일: 2026-07-30
- 승인: jazzsalle, CC-000 승인 기록(`work-items/00_DECISIONS_TO_CONFIRM.yaml`)과 동시 확정
- 번호 부여: `03_ADR_v1.1.md`가 ADR-18까지 부여했으므로 신규 결정은 ADR-19

## 배경과 문제

상세설계(`10_API_DB_SEQUENCE_v1.0.md` §Gateway/BFF)는 백엔드를 "Java Spring Boot 또는
.NET 8 중 UNE 표준"으로 권고했고, 구현 베이스라인과 CLAUDE.md 초기 프로파일은
ASP.NET Core 8을 승인 대기 기본값(`recommended-dotnet8-awaiting-approval`)으로 두었다.
이 권고는 기존 UNE 제품 계열(React + .NET)의 연장선이며 기술적 필수 조건은 아니다.

CC-000 승인 시점에 다음 조건이 확인되었다.

1. 이 리포는 프론트엔드(React/TypeScript), rhwp Rust/WASM 코어를 감싸는
   UNE TypeScript 어댑터와 함께 단일 팀이 유지보수하며, 서비스 계층의 언어
   통일이 생산성과 코드 공유(`packages/domain` 공유 타입)에 직접적인 이점이
   있다. (rhwp 코어 자체는 ADR-15에 따라 pinned Rust/WASM으로 유지되며 본
   ADR의 대상이 아니다.)
2. 개발 PC가 전부 내부망(고정 IP 없음)이라 팀/회의실 공유는 공개 URL 기반
   클라우드 데모 환경으로 이루어진다. 프론트는 Vercel, 백엔드는 클라우드
   컨테이너 호스트에 배포하며, Node 기반 컨테이너는 후보 호스트
   (Render/Railway/Fly) 전부에서 1급 지원된다.

## 고려한 대안

| 대안 | 판정 | 사유 |
|---|---|---|
| ASP.NET Core 8 유지 | 기각 | 기존 제품 계열과의 연속성은 있으나, 이 리포 범위에서는 언어 분절(C# + TS + Rust/WASM + Python)로 공유 타입·계약 동기화 비용이 큼 |
| Java Spring Boot | 기각 | 상세설계가 허용하나 위와 동일한 언어 분절 문제 |
| FastAPI (Python) | 기각 | HWPX 실험 도구와는 통일되나 프론트/rhwp 어댑터와는 분절 |
| NestJS (Node/TypeScript) | 채택 | 서비스 계층 TS 통일(잔여 스택: TS + Rust/WASM + Python), `packages/domain` 타입 직접 공유, OpenAPI 도구(모듈) 성숙, 데모 호스트 지원 우수 |

## 확정 결정

1. `services/api`와 `services/worker`는 NestJS(Node 20+, TypeScript)로 구현한다.
2. 데이터 접근은 마이그레이션 재현성이 있는 도구(예: node-pg-migrate/Prisma migrate 중
   CC-004에서 확정)와 명시적 SQL을 병용한다. `database/migrations`의 forward-only
   원칙은 그대로 적용한다.
3. Transactional Outbox, append-only Execution Log, 상태기계 등 도메인 규칙은
   프레임워크와 무관하게 `packages/domain`에 두고, NestJS 모듈은 포트/어댑터
   경계(architecture rules)를 따른다.
4. 테스트 프로파일은 xUnit/Testcontainers(.NET) 대신 Vitest/Jest +
   Testcontainers-node + Playwright + pytest(Python 도구)로 조정한다.
5. 백엔드/워커/HWPX 엔진은 컨테이너로 배포한다. Vercel 서버리스 함수로
   이전하지 않는다(상주 워커·outbox 폴링·SSE·장시간 HWPX 작업 부적합).

## 영향 범위

- `docs/handoff/IMPLEMENTATION_BASELINE.md` §6, `docs/handoff/TECHNOLOGY_PROFILE.md`,
  `CLAUDE.md` 구현 프로파일 갱신
- CC-001 부트스트랩은 NestJS 스켈레톤으로 진행. CI·HWPX 엔진 이미지에는
  ADR-15의 pinned rhwp를 위한 Rust + wasm 툴체인이 계속 포함되어야 한다
- 상세설계 `10_API_DB_SEQUENCE_v1.0.md` §10.1 계층 권고 표 중 본 ADR이
  대체하는 행은 **Gateway/BFF 행("Spring Boot 또는 .NET 8")과 DB 행의
  Flyway/Liquibase 부분(→ node 계열 마이그레이션 도구, CC-004 확정)뿐**이다.
  PostgreSQL 16+, PgBouncer, MinIO(S3 호환), 관측/시크릿 관련 행은 그대로
  유효하다. `01_MASTER_DETAIL_v0.9.md`(우선순위 7)의 Backend .NET 표기도
  본 ADR로 대체된다
- 본 ADR은 승인된 ADR/변경기록(SOURCE_OF_TRUTH 우선순위 2)으로서
  API/DB/Sequence v1.0(우선순위 3) 및 master design v0.9(우선순위 7)의
  스택 권고에 우선한다. ADR v1.1(우선순위 1)의 ADR-01~18 도메인 결정은
  변경하지 않는다

## 재검토 Trigger

- UNE 사내 표준이 특정 스택을 강제하는 공식 결정이 내려올 때
- 납품 기관 인프라가 Node 런타임을 허용하지 않는 것으로 확인될 때
