# ADR-20 계약 검증 게이트와 계약 타입 생성 전략

- 상태: ACCEPTED
- 결정일: 2026-07-30
- 관련 Work Item: CC-003
- 번호 부여: ADR-19 다음 신규 결정

## 배경과 문제

`contracts/openapi`(OpenAPI 3.1 4종)와 `contracts/schemas`(JSON Schema 2020-12
7종)는 구현 기준선이지만 CC-002까지는 기계 검증 게이트가 없었다. 또한
OpenAPI와 구현을 한 변경으로 묶으려면(CLAUDE.md Development workflow)
계약에서 파생되는 타입의 생성 방식이 정해져야 한다. mock-server가 계약과
어긋나는 것도 막아야 한다.

## 고려한 대안

| 영역 | 대안 | 판정 | 사유 |
|---|---|---|---|
| OpenAPI 검증 | @redocly/cli lint | 기각(현재) | 스타일 규칙 중심이라 121-operation 초안 계약에 과도한 노이즈; 구조 검증이 먼저 |
| OpenAPI 검증 | @seriousme/openapi-schema-validator | 채택 | OpenAPI 3.0/3.1 메타스키마 구조 검증, 의존성 작음 |
| JSON Schema 검증 | Ajv 2020-12 컴파일 | 채택 | draft 2020-12 지원, `https://schemas.une.local/` $id 기반 파일 간 $ref 해석 |
| 타입 생성 | NestJS 데코레이터에서 스펙 역생성 | 기각 | 계약이 아니라 구현이 Source of Truth가 되어 우선순위 역전 |
| 타입 생성 | openapi-generator(런타임 클라이언트 포함) | 기각 | 무거운 런타임 클라이언트가 어댑터 경계를 흐림(Provider 원본 노출 위험) |
| 타입 생성 | openapi-typescript (types-only) | 채택 | 타입만 생성, HTTP 클라이언트는 어댑터 내부에 수작성 유지 |

## 확정 결정

1. `pnpm validate:contracts`(`scripts/validate-contracts.mjs`)를 계약 게이트로
   한다: (a) OpenAPI 4종 구조 검증, (b) JSON Schema 7종 Ajv 2020-12 컴파일
   (파일 간 $ref 포함), (c) mock-server 라우트가 플랫폼 계약에 존재하는지
   동기화 검사. CI verify job에서 빌드 전에 실행한다. 계약 파일이 0건으로
   집계되면(디렉터리 이동·글롭 오타) 통과가 아니라 실패다.
   - (c)의 명시적 예외는 두 가지뿐이다: `/health`(계약 외 운영 엔드포인트,
     결정 5)와 mock의 catch-all `/api/v1/{path:path}`(미구현 경로용 일반
     폴백 envelope). 검사는 `@app.<method>`와 `@app.api_route` 데코레이터를
     읽으며, 파싱하지 못하는 등록 방식(APIRouter, include_router,
     add_api_route)이 mock에 나타나면 게이트를 실패시켜 조용한 우회를 막는다.
2. 계약 타입은 `pnpm generate:contract-types`(`scripts/generate-contract-types.mjs`,
   openapi-typescript)로 생성한다. 산출물은 커밋하며 CI가 재생성 후
   `git add -N` + `git diff --exit-code`로 드리프트를 차단한다(신규 미커밋
   생성 파일도 실패 대상).
   - `services/api/src/generated/une-platform-api.ts` ← une-platform-api-v1
   - `packages/provider-adapters/src/generated/` ← T3Q legacy, T3Q target-v2
     change request, UNI RAG 계약
3. 생성 파일은 types-only이다. 런타임 클라이언트·DTO 매핑은 어댑터
   (`packages/provider-adapters`, `services/api`) 안에 수작성하고, Provider
   원본 스키마 타입은 어댑터 경계 밖(UI·도메인)으로 내보내지 않는다
   (provider-adapters 규칙). `packages/domain`은 생성 타입에 의존하지 않는다.
   `@une/provider-adapters`는 `exports` 필드로 루트 진입점만 노출해 생성
   타입으로의 서브패스 딥임포트를 차단한다. target-v2 생성 파일 헤더에는
   "요청 스펙(미수락, OB-10)" 경고를 새긴다.
4. 생성 디렉터리(`**/src/generated/`)는 ESLint·Prettier 검사에서 제외한다.
5. `GET /health`는 계약 외(out-of-contract) 운영 엔드포인트로 확정한다
   (CC-001에서 이연된 결정). 서버 루트에서 제공하며 `/api/v1` 접두사와
   `une-platform-api-v1.yaml`에는 포함하지 않는다. mock 동기화 검사도 이를
   예외로 처리한다.
6. 스타일 린트(@redocly/cli 등) 도입은 계약이 안정화되는 CC-115/CC-400
   시점에 재평가한다.

## 결과

- 계약 위반과 mock 드리프트가 CI에서 즉시 실패한다.
- 계약 변경 시 `generate:contract-types` 재실행이 강제되어 OpenAPI와
  구현(타입)이 한 변경으로 묶인다.
- target-v2 타입은 요청 스펙(1.0.0-request) 기준 생성물이며 T3Q 실제 지원의
  증거가 아니다(OB-10).
