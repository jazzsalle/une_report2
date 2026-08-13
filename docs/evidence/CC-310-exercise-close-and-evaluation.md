# CC-310 증거 — 훈련 종료·평가·개선조치 환류

- 항목: CC-310 (UNE-JNL-012~015)
- 결정 정본: **ADR-45** (D1~D16, 수용 한계 16)
- 마이그레이션: `0045_exercise_close_and_evaluation.sql`,
  `0046_close_guard_fail_closed.sql`(이중검토 보정)
- 작성: 2026-08-13 (이중검토 반영 후 전 게이트 재측정)

## 1. 무엇이 동작하는가

```
GET  /situations/{id}/close-preview        종료 미결 미리보기 (SITUATION_CLOSE, 200)
POST /situations/{id}/close                상황·훈련 종료     (SITUATION_CLOSE, 200)
POST /situations/{id}/evaluations           훈련 평가 생성     (EVALUATION_EDIT,  201)
GET  /evaluations/{evaluationId}            평가 상세          (EVALUATION_READ,  200)
POST /evaluations/{evaluationId}/improvements 개선조치 등록     (EVALUATION_EDIT,  201)
POST /evaluations/{evaluationId}/confirm     평가 확정          (EVALUATION_EDIT,  200)
GET  /evaluations/{evaluationId}/report      평가보고서         (EVALUATION_READ,  200)
```

`apps/web` ops 워크스페이스에 **종료·평가** 탭이 붙었다(종료 게이트 → 평가 →
개선조치 → 보고서). 테이블은 만들지 않았다 — `evaluation`·`evaluation_score`·
`improvement_action`이 0006 기준선에 있었고 FK도 0007에 있었으나 **아무도 쓰지
않았다**. 68 테이블 그대로, 컬럼 675 → 679.

## 2. 실행한 검증 (이 문서 작성 시점 트리)

| 대상 | 결과 |
|---|---|
| 도메인(`evaluation.test.ts` 17 포함) | **370 pass** |
| 워크스페이스(`evaluation-state.test.ts` 7 포함) | **52 pass** |
| 계약 게이트(`evaluation.contract.test.ts` 32) | **452 pass** |
| 통합/RLS(마이그레이션 46, 테이블 68) | **197 pass** |
| API | **434 pass** |
| HWPX 엔진 | **426 pass** |
| provider 어댑터 | **264 pass** (7 skipped) |
| 현장 앱 | **19 pass** |
| E2E(`evaluation.e2e.test.ts` 27) | **162 pass (10 files)** |
| `pnpm typecheck` | 오류 0 |
| `pnpm lint` / `format:check` | 통과 |
| `pnpm run validate:contracts` | CONTRACT VALIDATION: PASS |
| `pnpm run validate:handoff` | HANDOFF VALIDATION: PASS |

## 3. E2E가 실제로 증명하는 것 (27개 중 핵심)

| 시험 | 증명 |
|---|---|
| 미결을 목록으로 미리 보여 준다 | 여섯 종류, 각 항목에 사람이 읽을 `detail` |
| 미결이 있으면 목록과 함께 막는다 | `SIT-412-010` + `meta.blockers` 비어 있지 않음 |
| 사유 없는 처분은 처분이 아니다 | 공백 사유 412 → 사유 채우면 200 |
| 완료·취소는 이 경로에서 하지 않는다 | `COMPLETED` 처분 412 |
| **큐에 남은 전파는 사유로도 넘길 수 없다** | `PENDING_DISPATCH` `waivable:false`, 사유 있어도 412 |
| 시작하지 않은 훈련은 닫지 않는다 | `DRAFT` 종료 412 |
| 정리된 훈련은 처분 없이 닫히고 기준선이 남는다 | `SITUATION_CLOSED` 이벤트 payload의 `baselineHash` 일치 |
| 처분한 사유가 종료 사건에 남는다 | `waived[].reason`·`kind` 확인, 개수 일치 |
| 두 번 닫지 않는다 | 두 번째 412 |
| **닫힌 뒤 새 사실은 못 쓰고 정정은 쓸 수 있다** | 새 관측 42501, 정정 삽입 성공 |
| **종료 뒤 임무 전이는 읽을 수 있는 412다** | 담당자 토큰으로 `POST /tasks/{id}/acknowledge` → `SIT-412-011` + 사용자 안내 문장 |
| 종료된 훈련만 평가할 수 있다 | `EVAL-412-001` |
| 사실원장에서 접은 지표를 고정해 담는다 | 가중 평균 83.33, KPI 재생값, `metricsStale:false` |
| **지연 임무를 실제로 센다** | 미완료 + 기한 초과 → `kpi.overdue = 1`, `overdueRate = 1` |
| 허공을 가리키는 근거는 거절한다 | 없는 이벤트·남의 훈련 이벤트 422 |
| 정정이 붙으면 낡았다고 말한다 | `metricsStale` false→true, **값은 그대로** |
| 한 훈련에 평가는 하나다 | 두 번째 422 |
| 개선조치는 대상을 가리키되 바꾸지 않는다 | `to_jsonb(sop)` 행 전체가 동일 |
| 없는 대상을 가리키는 환류는 거절한다 | `EVAL-422-002` |
| 확정된 평가는 얼어붙는다 | 서비스 409 + **DB 트리거 2종** |
| 보고서가 빈 자리를 말로 채운다 | `satisfaction.status = NOT_COLLECTED` + 사유 |
| 근거 없이 매긴 지표를 보고서가 센다 | `criteriaWithoutEvidence` |
| 없는 형식을 약속하지 않는다 | `format=HWPX` → `EVAL-422-003` |
| 권한·멱등·감사·테넌트 | 403 다섯 경로, 같은 키 재요청 1행, 감사 4종 순서, 404 |

응답은 `assertMatchesSchema`(Ajv 2020-12)로 `ClosurePreview`·`SituationClosed`·
`Evaluation`·`EvaluationReport`와 대조한다 — 계약 문서가 아니라 **서버가 실제로
내보낸 것**을 본다.

## 4. 이 항목에서 잡힌 결함

### 4.1 개발 중

| # | 결함 | 잡은 것 |
|---|---|---|
| 1 | 실행/임무 씨앗이 0036·0038·0039 제약과 어긋남(ended_at, 완료 실행의 임무 쓰기) | E2E |
| 2 | `dispatch_recipient`·`outbox_message`·`dispatch` 컬럼명 오인 | E2E |

### 4.2 이중검토가 잡은 것 (ADR-45 D11~D16)

| # | 결함 | 심각도 |
|---|---|---|
| V-1 | **종료된 훈련의 큐에 남은 전파가 무한 재전송된다** — 배치 전체 롤백 → `SENDING` 잔류 → 임차 만료마다 재발송, 기록은 사라지고 요약은 `deadLettered`로 오집계 | 치명 |
| D-1 | `listPendingDispatches`의 조인 컬럼 오타로 **종료·미리보기가 전 요청 500** | 치명 |
| V-2 | 종료 뒤 정당한 임무 전이가 `COM-0001 / 500`으로 떨어짐 — 사용자는 이유를 모른다 | 중대 |
| V-3 | `dueAt: null` 하드코딩으로 **`overdue`가 구조적으로 항상 0** — 평가서에 "지연 0%" 거짓 | 중대 |
| V-4 | 재생 상한 없음 + 조회마다 전량 적재 — 대시보드(20,000 상한)와 다른 집합 | 중대 |
| V-5 | `GET /evaluations/{id}`·`confirm`이 **구현됐는데 계약에 없음** | 중대 |
| V-6 | 어떤 상태에서든 종료 가능 — `DRAFT` 빈 훈련이 영구 동결 | 중대 |
| V-7 | 미결 판정과 전이 사이 잠금 없음 — 인수기준이 경합에서 깨진다 | 중대 |
| V-8 | 저장소 다섯 경로가 헤더의 주장과 달리 RLS 단독 의존 | 중대 |
| V-9 | 0045의 두 가드가 fail-open(부모 미가시 시 통과) | 경미→0046 |
| V-10~14 | `closedAt` 지어냄, 자릿수 초과 500, 중복 처분 오집계, 종료에 확인 없음, `x-db-tables` 부정확 | 경미 |
| QA | vacuous 단언 둘(권한 403으로 먼저 막혀 트리거 미태움 / `>= 0` 단언), 담당자 테넌트 미검증, 동시 생성 23505 → 500, `metricBasis` 이중 구현 | 중대 |

**V-1이 이 항목의 중심 결함이다.** 종료를 "미결을 사유로 넘기고 닫는 것"으로
만들면서, 그 미결에 딸린 **큐**를 보지 않았다. 닫은 뒤 바깥으로는 계속 발송되고
안에는 아무 기록도 남지 않는다 — 접수 성공이 "나갔다"로 읽히는 CC-300 F1과 같은
계열이다. 게이트(처분 불가 미결)와 릴레이(국소 dead letter) 두 겹으로 막았다.

## 5. 지금 사실이 아닌 것

ADR-45 수용 한계 16건이 정본이다. 밖으로 말할 때 특히 흐려지기 쉬운 다섯.

1. **만족도 설문이 없다.** 수집 경로 자체가 없어 보고서는 `NOT_COLLECTED` + 사유로
   그 자리를 채운다. `OPEN_BINDINGS.md` **OB-18**로 남겼다.
2. **평가보고서는 JSON뿐이다.** HWPX·PDF는 `EVAL-422-003`으로 거절한다.
3. **종료가 얼리는 것은 사실원장뿐이다.** 기준선 해시는 일지·실행·확정 판까지
   담지만 **그 값들이 종료 뒤에 바뀌는 것을 막지 않고, 어긋났음을 알려 주지도
   않는다**(재계산·대조 경로 없음).
4. **미완료 Export·잡을 게이트가 보지 않는다.** 종료 후 완료되는 Export가 기준선
   밖에서 산출물을 낸다.
5. **개선조치는 열리기만 한다.** 닫는 API가 없어 `status`는 `OPEN` 하나이고,
   `ACTION_TRACKING` 집계도 없다.
