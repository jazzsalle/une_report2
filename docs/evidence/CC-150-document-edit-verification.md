# CC-150 검증 증거 — Document Revision·ChangeSet·Selection·Autosave·낙관적 동시성

- 일자: 2026-08-02 (집 PC)
- 브랜치: feature/CC-150 (base: main e2a6954 = PR #11 머지)
- 결정 기록: ADR-30 (D1~D15 + 수용 한계)
- 대전제: **편집 UI는 없다.** rhwp가 아직 반입되지 않아(OB-12) `apps/web`은 셸뿐이며,
  이 항목은 **서버측 편집 코어**만 만든다. 설계 07 §1.8-4가 "시각 좌표는 계약에
  들어오지 않는다"로 계약을 편집기와 분리해 두었기 때문에 편집기 없이 진행할 수
  있었다. HWPX 저장/Export는 CC-160이다.

## 수용기준 대응

| AC | 구현 | 증거 |
|---|---|---|
| **ETag/version conflict** | `document`에 `version_no`가 없어 **ETag = 반환한 표현의 `revision_no`**(강한 태그). 부재 428 COM-0428 / 형식오류 400 COM-0400 / 불일치 **409 DOC-409-001** / 성공 시 새 ETag 재설정. 계약이 `baseRevisionId`를 required로 못박으므로 **둘 다** 검증하고 어긋나면 자기모순 요청으로 **422 DOC-422-004**. 409 페이로드는 공용 error 스키마(`additionalProperties:false`)를 건드리지 않고 **`ETag` 헤더 + `meta.conflict`**로 싣는다 (ADR-30 D4) | `services/api/src/e2e/document-edit.e2e.test.ts:368`(ETag 매트릭스 4상태), `:437`(422 자기모순), **`:475` 동시성 — 같은 `baseRevisionId` 2건 동시 전송 → `document FOR UPDATE` 직렬화 + `uk_document_revision_no`로 정확히 1성공 1×409(실 DB)**, `:504`(멱등 재전송 동일결과 / payload 불일치 409 COM-0409), `services/api/src/document/document-errors.test.ts` |
| **selection anchors** | 3층(Selection 요청 / SelectionContext / 시각 좌표 미수용)을 **타입으로 분리 강제**, 선택 유형 5종, alias 재해석, **Offset Normalization Contract 정본화**(ADR-30 D5 — `fwSpace`→U+0020, `nbSpace`→U+00A0, `tab`→U+0009 기여, `lineBreak`/`hypen`/`fieldBegin`/`fieldEnd` 미기여), 경계 스냅 3규칙(전부 뒤로) + `SelectionContext.adjustments` 보고 | `services/hwpx-engine/src/edit/selection-resolver.test.ts`(§1.8-1 baseRevision / §1.8-2 노드존재·alias / §1.8-3 정규화·잠금·정적영역·표경계 / §1.8-4 **시각 좌표 미수용** / §1.8-5 경계 스냅·runSpans / 선택 유형 5종), **`tests/contract/src/offset-contract.test.ts` — 엔진 공백 기여표 ↔ 도메인 계약표의 동치를 고정**(rhwp 어댑터가 붙는 순간 offset 불일치가 즉시 드러나는 지점, 사용자 결정 2026-08-02 선택지 A) |
| **undo/restore** | 역연산은 컬럼이 아니라 `(operation_type, target, before)`에서 **결정적으로 도출**하고 `invert(op) ∘ apply(op) == identity`를 실 코퍼스 6종 속성 테스트로 증명. Undo는 **`undoesChangeSetId`로 되돌릴 ChangeSet만 지목**하고 서버가 저장된 역연산을 적용한다(ADR-30 D16-1) — 요청 표면에 IR 조각이 들어올 자리가 없다. 대상 이후 같은 노드를 건드린 ChangeSet이 있으면 **UNDO_CONFLICT 422 + 영향 노드**(US-PLAN-017 E-03). Undo/Redo/Restore는 전부 **새 ChangeSet·새 revision**이며 과거 revision·change_set을 UPDATE하지 않는다 | `services/hwpx-engine/src/edit/inverse-ops.test.ts:264`(**invert∘apply==identity, 실 코퍼스 6종**), `:286`(다중 연산도 역집합 하나로 복귀), `:345`(§1.9 역연산 짝), **`services/api/src/e2e/document-edit.e2e.test.ts` — Undo 왕복이 HTTP 표면을 통과해 `irHash`가 편집 이전 값으로 정확히 복귀**(제품 경로 증거), UNDO_CONFLICT 422 + 영향 노드, `:744`(**복원은 과거 revision을 건드리지 않고 새 head를 만든다** — US-PLAN-020 AC-01), `:847`(head 자기 복원 422), `services/hwpx-engine/src/edit/edit-invariants.test.ts`(편집 후 I1·I2·I6·I8·I9) |
| **audit** | 적용(`CHANGESET_APPLIED`)·Undo/Redo(출처가 그대로 액션)·거절(`CHANGESET_REJECTED`)·충돌(`CHANGESET_CONFLICTED`)·저장(`REVISION_SAVED`)·복원(`REVISION_RESTORED`)·자동저장(`AUTOSAVE_SUCCESS`/`AUTOSAVE_FAIL`)·가져오기(`DOCUMENT_IMPORTED`). **충돌·거절도 기록이다.** 상태변경 + 감사 기록이 한 트랜잭션 | `services/api/src/e2e/document-edit.e2e.test.ts:1057`(적용=CHANGESET_APPLIED+REVISION_SAVED, UNDO는 UNDO로), `:598`(적용 불가 편집 422 + 거절 기록, 문서는 불변), `:940`(자동저장 충돌 409 DOC-409-003 — **판정 자체가 저널에 남는다**, US-PLAN-020 AC-02), `:1028`(DOC_READ/DOC_EDIT 없는 사용자 403 + ACCESS_DENIED), **`:1115` 문서 본문은 INFO 로그와 감사 detail 어디에도 실리지 않는다**(backend.md·security.md) |

## 게이트 실행 결과

**전부 단일 `pnpm test`(exit 0) 한 번으로 재현한 수치다.** `DATABASE_URL`(superuser)을
설정해 db-integration·worker e2e가 실제로 실행됐음을 분모(`Test Files N passed (N)`)로
함께 확인했다.

| 게이트 | 결과 |
|---|---|
| `@une/domain` | **62** / 10 files |
| `@une/hwpx-engine` | **353** / 20 files (편집 코어 + 리뷰 반영 회귀 5건) |
| `@une/contract-tests` | **188** / 11 files (change-set 23 + document-ir 16 + offset 계약 포함) |
| `@une/api` | **242** / 21 files (문서 편집 e2e **31건**) |
| `@une/db-integration` | **107** / 9 files (skip 0 — 0018 RLS 16건, 0019 편집표면 23건 신규) |
| `@une/provider-adapters` / `@une/worker` | 108 / 11 files, 33 / 4 files (회귀, 변경 없음) |
| `@une/web` / `@une/field-web` | 1 / 1 files, 1 / 1 files (셸) |
| `pnpm validate:contracts` | **PASS** (`change-set.schema.json` 신규 컴파일 포함) |
| `pnpm validate:intake` | **PASS** (R1~R11 — 반입 전 상태 그린, rhwp 여전히 미반입) |
| `pnpm validate:handoff` | **PASS** (539 files) |
| `pytest tests/baseline` | **10 passed** |
| build / typecheck / lint / format:check | 전부 **PASS** |
| `pnpm generate:contract-types` | 재생성 후 **추가 diff 0**(계약↔타입 드리프트 없음) |
| 마이그레이션 | **0018·0019 신규 2건**(forward-only, 적용된 마이그레이션 무수정), 적용 후 공용 스키마 62 테이블 = 도메인 **61** + `pgmigrations` |
| 위생 | `docs/design-markdown`·`templete/`·`third_party/` **무변경** |

## 핵심 검증 포인트

1. **원자성을 롤백이 아니라 자료구조로 보장한다**(ADR-30 D13). 실패 결과 타입에
   `ir` 필드가 **아예 없어** 호출자가 부분 변형을 저장할 수 없고, 모든 트리 연산이
   새 객체를 만들어 입력 IR을 변형하지 않는다. §1.9의 "no partial document
   mutation"이 규율이 아니라 타입 층의 사실이 된다
   (`change-set-executor.test.ts:686`).
2. **판별 유니온이 런타임 검사보다 앞선다**(D3). `NodeProvenance`가
   `SOURCE→rawXmlAnchor` / `AUTHORED→anchorHint` 배타이므로 "앵커도 힌트도 없는
   노드"는 **컴파일되지 않는다** — 불변식 I9가 타입 층에서 막힌다. 대가로 SOURCE
   전용 소비자 11곳에서 앵커가 optional이 됐고, `?? ''`로 뭉개면 빈 앵커가
   `resolveAnchor`에서 `null`이 되어 **I2가 거짓 통과**하므로 던지는 헬퍼
   `sourceAnchor(node)`로 좁혔다. 계약층은 `if/then` 배타 제약으로 같은 규칙을
   건다.
3. **JSON Schema 함정 재발 차단**. `allOf` + `additionalProperties:false` 조합을
   쓰지 않았다(2020-12에서 base 브랜치가 sibling property를 못 봐 전 인스턴스가
   무효가 되는 함정 — ADR-24 D4에 기록됐는데 이 저장소에서 두 번 재발). 제약이
   vacuous하지 않음을 **정상 AUTHORED 노드 수용 케이스**로 함께 고정했다.
4. **트랜잭션 경계**(D13): `document FOR UPDATE` → head 조회 → 검증 → 엔진(순수
   함수) → revision + change_set + change_operation N + 포인터 + audit **한
   트랜잭션**. 반대로 자동저장의 충돌 판정은 **예외가 아니라 값으로 반환**한다 —
   트랜잭션 안에서 던지면 `CHANGESET_CONFLICTED`/`AUTOSAVE_FAIL` 감사와
   `document_autosave` CONFLICT 행까지 함께 롤백되어 US-PLAN-020 AC-02("자동저장
   실패의 즉시 표시")를 만족할 수 없다(D8).
5. **멱등 판정 순서**: 멱등 → `baseRevisionId` 정합(422) → 낙관 잠금(409).
   재전송은 새 편집이 아니므로 If-Match가 낡았다는 이유로 실패하면 안 된다.
6. **materialize는 신규 op를 만들지 않는다**(D11). `INSERT_BLOCKS`의
   `source.kind === 'GENERATED_BLOCKS'` 변형으로 표현하고 ADR-27 D4의 3중 방어를
   이식했다: `current_toc_version_id` 불일치 fail-closed 422 / `superseded_at IS
   NULL`만 / 보호 상태 블록 제외 + 사유를 `materialize.excluded[]`에 적재.
   **엔진은 DB를 읽지 않는다** — 주입 함수로 받고, 주입이 없으면 조용한 빈 삽입
   성공이 아니라 위반으로 끝난다.
7. **RLS는 문서 하위 8테이블 전부**(0018, ADR-29 D9가 등재한 차단성 선행조건
   해소). `tenant_id` 컬럼을 추가하지 않고 부모 EXISTS 조인 + 명시 술어 +
   ENABLE/FORCE. `validation_report`는 FK가 전무한 다형 부모라 설계가 명시한
   `DOCUMENT`/`EXPORT` 두 값만 경로를 갖고 **나머지는 fail-closed**(0행/쓰기
   거부) — 조용한 유출 대신 즉시 실패.

## 실측으로 잡은 결함 3건

1. **CC-140의 안정 ID가 편집 후 붕괴한다**(D2). `paragraphId = f(rawXmlAnchor)`
   였으므로 문단을 삽입하면 서수가 밀려 **IR을 다시 빌드하면 ID가 전부 바뀐다** —
   안정 ID(US-PLAN-015)·selection anchors(AC2)·Undo·G15-3이 동시에 무너진다.
   해소: 편집은 IR을 XML에서 재빌드하지 않고 `document_revision.ir_json`을 변형
   → 기존 ID는 어떤 편집으로도 재계산되지 않는다. 신규 노드는 앵커와 무관한
   `authoredStableId(kind, changeSetId, opOrder, seq)`. 충돌 시 **재발급하지 않고
   오류**(`ID_COLLISION`) — seq를 올려 재발급하면 같은 좌표가 다른 노드를 가리켜
   Undo가 엉뚱한 노드를 지운다. 결함 자체를 `change-set-executor.test.ts:13`이
   재현 테스트로 고정한다.
2. **§1.9 표대로 만든 역연산이 틀렸다**(D6, 6종 전부 해시 불일치 실측 후 정정).
   ① **문자 삭제의 역은 `INSERT_BLOCKS`가 아니다** — run 경계에서 문자를
   재분배하면 텍스트가 같아도 run 구성이 달라져 해시가 어긋난다 →
   `REPLACE_RANGE(restoreRuns)`. 블록 삭제의 역만 `INSERT_BLOCKS`다.
   ② **SPLIT의 역은 단순 MERGE가 아니다** — 분할이 run 한가운데를 자르면 MERGE의
   이어붙이기로 쪼개진 run을 되붙일 수 없다 → before 이미지 복원.
3. **RLS 하 자식 전수 스캔이 30배 느려진다**(D10). `document_block` 8만 행 조회가
   3ms → 139ms. 원인은 부모 조회가 아니라 **인덱스 없는 자식 전수 스캔에 SubPlan
   qual을 얹는 것**이며(일치 행 0건이라 서브플랜이 실행되지 않는 조건에서도 재현),
   0019가 유일성 키를 확정하며 해소됐다 — **173ms → 1.2ms**. 만들지 않기로 한 두
   인덱스도 측정으로 기각했고, 중복 인덱스가 나중에 다시 추가되지 않도록 회귀
   단언으로 고정했다.

## 설계 어휘 충돌 해소 (우선순위 규칙 적용, D12/D15)

- `change_set.status`: 설계 05가 같은 개념에 서로 어긋나는 세 어휘를 적어 채택
  근거가 없고, 우선순위 3(설계 10 §6.20)과 4(0003 COMMENT)가 일치하므로
  **`APPLIED`/`REJECTED` 2종**으로 닫았다. 비원자적 결과는 `document_autosave`가
  맡는다.
- `document.status`: 설계 09의 13종 상태표는 이 컬럼이 아니라 `plan.status`의
  것이다(값 집합이 `PLAN_STATUSES`와 글자 단위로 동일) → **3종**.
- `change_operation.operation_type`: 설계 10의 `"insertText 등"`은 닫힌 집합이
  아니라 예시 한 개다 → 설계 07 §1.9의 **8종**.
- 오류코드: 설계 07 §1.8-5의 `DAI-1401/1402`는 우선순위 7의 코드 공간이고 설계 10
  §3.4(우선순위 3)가 `DOC-*`를 배정했다 → **`DOC-*`가 정본**, DAI는 사상표로만.
- `prototype_registry`(OpenAPI x-db-tables) → **`style_prototype`**(구현·마이그레이션
  진실)로 이름 드리프트 종결. 설계의 `doc_prototype_registry`는 논리명이므로
  원문 무변경.

## 이중 리뷰 (병렬, opus — 전건 당일 반영)

`architecture-guardian`과 `qa-gate-reviewer`를 **서로 모르는 상태로 병렬** 실행했다.
두 리뷰가 **독립적으로 같은 결함 세 건**을 지목했고(무검증 `restore` 주입 / Undo
경로 실행 불가 / materialize 소스 우회), 그 중복이 우연이 아님을 확인해 준다.
초기 판정은 **arch 2 BLOCKER + 6 MAJOR + 7 MINOR / QA FAIL(완료 선언 불가)** 이었다.

### 반영한 BLOCKER 3건

| 지적 | 실패 시나리오 | 반영 |
|---|---|---|
| **요청이 IR 조각을 그대로 심을 수 있다** (arch F4 / QA B-1) | DOC_EDIT 권한자가 `source:{kind:'INLINE', blocks:[{restore:{…origin:'SOURCE', rawXmlAnchor:'…#p[9999]', editState:{locked:true}}}]}`를 보내면 위조 앵커·영구 잠금 노드가 `ir_json`에 영속된다. `{restore:null}`은 엔진에서 TypeError → **500**. 판별 유니온(D3)은 컴파일 시점 보장이라 이 캐스트 경로를 막지 못한다 | 검증기가 `restore`/`restoreRuns`/`rightParagraph`/`leftRunCount`를 **어느 위치에서든 거부**(INLINE 블록·payload·`cellOps[]`)하고, INLINE 블록은 `text`/`styleRole`/`outlineLevel`만 받는다. 엔진에도 구조 검사와 `checkEditInvariants` 배선을 더해 3중으로 막았다 |
| **Undo가 계약상 실행 불가** (arch F2 / QA M-1) | 응답 `inverseOperations`의 `baseRevisionId`가 센티널 문자열이라 UUID를 요구하는 검증기·계약(`format: uuid`)에 걸려 400. 즉 **200 응답이 자기 응답 스키마를 위반**하고 있었다. 기존 UNDO 시험은 손으로 만든 연산을 제출해 이를 잡지 못했다 | Undo는 `undoesChangeSetId`로 **되돌릴 ChangeSet만 지목**한다(ADR-30 D16-1). 서버가 저장된 역연산을 적용하므로 요청 표면에 IR 조각이 들어올 자리가 없다 |
| **복원 후 편집이 다른 문단에 적용된다** (arch F1) | P1+P2 병합 → 병합 이전으로 복원 → P2가 되살아났는데 append-only alias 이력의 `P2→P1`이 살아 있어, P2의 0~3자를 고치면 **P1의 5~8자가 고쳐진다**. 오류 없이 200 | alias는 **노드가 현재 IR에 없을 때만** 밟는다(D16-3). 이력 길이와 무관하게 현재 문서 상태만으로 결론이 나며 merge→undo→merge 반복에도 성립한다 |

### 반영한 MAJOR 7건

- **materialize 소스 우회**(arch F3 / QA M-4): 한 ChangeSet에 `GENERATED_BLOCKS`가 둘이면 `sources[0]`만 검사돼 낡은 목차버전이 200으로 통과하고 같은 블록이 두 번 삽입됐다 → 소스 1개로 제한 + provider를 인자 의존으로.
- **`checkEditInvariants` 미배선**(arch F5): 유일한 호출처가 자기 테스트였다 → `applyChangeSet`이 커밋 전 호출.
- **`ir_hash` 중복 제거 미구현**(arch F6): ADR이 구현된 것처럼 서술했다 → 자동저장에서 실제 구현.
- **REJECTED 재전송이 200**(arch F7 / QA M-5): 오프라인 큐가 성공으로 처리해 편집이 조용히 사라진다 → 원 사유로 다시 422.
- **UNDO_CONFLICT 미구현**(QA M-2): `undoesChangeSetId`가 저장만 되고 계보 질의가 없었다 → `touchedNodeIds` 교집합으로 구현.
- **`document.status` 미검사**(QA M-3): APPROVED 문서가 계속 편집됐다 → 적용·자동저장·복원 모두 422.
- **repository 우회 SQL**(arch F8 / QA N-3): alias 이력만 서비스가 직접 질의했다 → repository로 이동.

### 반영한 MINOR (전건)

자동저장 CONFLICT 행의 `base_revision_id`(요청 기준으로 정정) · 자동저장
자기모순 409→**422** · 0건 삽입의 조용한 성공 · prototype 원본 소실 무경고 ·
엔진의 `Prototype` 재정의와 `as unknown as` 이중 캐스트 · 복원 충돌의
트랜잭션 내 throw · `irVersion` enum · 무효과 `Idempotency-Key` 선언 ·
`stable-id.ts`의 리터럴 NUL(diff 리뷰 불가) · 시험 제목의 `DAI-*` 잔재 ·
ADR 수용 한계의 `before_json` 서술 부정확.

### 리뷰가 확인한 통과 항목

테넌트 격리(0018/0019 전 테이블 FORCE RLS, 교차테넌트 읽기·쓰기·고아행·
superuser 대조군·`une_worker` 42501·EXPLAIN 부모 PK 경유까지 단언) · 마이그레이션
forward-only와 CHECK/UK/인덱스 양방향 고정 · 본문 미유출 · **ADR-24 D4 함정
(`allOf` + `additionalProperties:false`) 재발 없음**(구조 순회 시험으로 고정) ·
불변성(`UPDATE document_revision` 부재) · 자료구조에 의한 원자성 · D2 ID 동결 ·
D4 409 페이로드 일관성 · D13 트랜잭션 경계.

### 반영 과정에서 실측으로 잡은 결함 1건

UNDO_CONFLICT 계보 비교를 애플리케이션에서 왕복시켰더니 **모든 Undo가
UNDO_CONFLICT로 거부**됐다. `timestamptz`는 마이크로초인데 JS `Date`는
밀리초여서 기준값이 잘리고, 대상 ChangeSet이 **자기 자신보다 "이후"** 로
잡혔다. 비교를 SQL 안으로 옮겨 해소했다(`listAppliedChangeSets`).

## 알려진 한계 (ADR-30 수용 한계)

- **편집 UI 없음** — rhwp 렌더/편집 검증 전무(OB-12). 서버 계약만 존재한다.
- 성능 임계 게이트 미도입(§1.12 편집 P95 300ms는 측정만).
- `change_operation.before_json`이 항상 `null`이다(엔진이 per-op before-image를
  공개 표면으로 내지 않는다). Undo는 저장된 역연산으로 충분하지만 감사 열람 UI가
  before를 요구하면 엔진 표면 확장이 필요하다.
- `template_profile.analysis_status` 어휘 미확정(도메인 판정 4종 vs 설계 09 상태표
  9종). 판정값을 변환 없이 넣고 CHECK를 걸지 않았다 — **CC-160에서 종결**.
- `document_block`에 **쓰지 않는다**(IR이 단일 정본). 투영은 CC-170.
- alias 저장 형태(D14): merge→undo→merge 반복 시 append-only 목록으로는 alias
  체인 추적이 옛 항목을 다시 밟는다. `change_set.selection_json`에
  `{aliases, aliasRemovals}`를 접어 넣는 형태로 운용하고 전용 저장 구조는
  CC-170에서 재평가한다.
- `document_autosave.status × result_revision_id` 상관 제약 미도입 — 이번 구현으로
  "ACCEPTED만 result를 채운다"가 확정됐으므로 CC-160에서 CHECK 가능.
- 문자 범위 편집이 여러 문단에 걸치면 **거부**한다(복합 의미를 한 연산에 숨기지
  않기 위해). §1.9가 SPLIT/MERGE·블록 연산 어휘를 이미 제공한다.
- 업로드·import API(UNE-DOC-001~004)는 CC-160. 테스트/E2E용 문서는 HTTP 표면 없는
  `DocumentImportService`가 만든다.
