# Contract Test Fixtures

## t3q-legacy/

UNE가 작성한 대표 payload다. **T3Q가 제공한 샘플이 아니며**, provider 실동작
으로 확인된 바 없다(OB-01/OB-10 OPEN). 값은 UNE PlanContext
(`contracts/schemas/plan-context.schema.json`)의 실제 어휘(재난유형 10종,
예방/대비, 독자 4종)로 구성해 "legacy 요청은 PlanContext 실값으로 구성
가능하다"를 계약 테스트가 단언할 수 있게 했다.

| 파일                                       | 용도                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| rpt-001.request.valid.json                 | RPT-001 목차 요청(`{data: PlanTocData}`) — legacy·PlanContext 양쪽 유효                  |
| rpt-001.response.valid.json                | TocResponse, 3단 재귀 TocSection                                                         |
| rpt-002.request.valid.json                 | RPT-002 본문 요청 — 위 응답의 sections 재사용 + stream                                   |
| rpt-002.response.valid.json                | ContentResponse + Reference + children                                                   |
| rpt-002.stream.assumed.sse.txt             | SSE 전사본 — **프레이밍은 UNE 가정**(계약은 `x-sse-done: '[DONE]'`만 명시; 상세는 OB-01) |
| rpt-001.request.null-location.invalid.json | `location: null` — legacy `type: string`이라 무효(매핑 시 null은 생략해야 함을 고정)     |
| rpt-001.request.out-of-plancontext.json    | `disasterType: 홍수` — legacy는 유효 / PlanContext는 무효(제약 갭 증명)                  |

픽스처를 바꾸면 `tests/contract/src/t3q-legacy.contract.test.ts`와
`docs/handoff/T3Q_PLAN_FIELD_GAP_MATRIX.md`를 함께 확인할 것.

**구조적 한계**: legacy 전사본 스키마에는 `additionalProperties: false`가
없다(전사본 불변 원칙). 따라서 오탈자·잉여 필드 계열의 매핑 버그는 이
픽스처 테스트로 원리상 검출할 수 없다 — 그런 결함은 CC-125 어댑터의
매핑 단위 테스트에서 UNE 측 타입으로 잡는다.
