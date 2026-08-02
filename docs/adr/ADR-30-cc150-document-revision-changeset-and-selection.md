# ADR-30: CC-150 Document Revision·ChangeSet·Selection·낙관적 동시성

- 상태: ACCEPTED (2026-08-02, CC-150)
- 관련: 설계 07 §1.8(SelectionResolver)·§1.9(ChangeSetExecutor)·§1.3(IR),
  설계 10 §3.4(UNE-DOC-005~009)·§7.10(SCR-PLAN-007), 설계 05
  US-PLAN-015/016/017/020, ADR-27(D2/D4/D10), **ADR-29(D4/D6/D7/D9)**,
  `.claude/rules/{backend,security,architecture,testing}.md`
- 범위: **서버측 편집 코어**. 편집 UI(rhwp 결선)와 HWPX 직렬화/Export는 밖.

## D1. 범위 경계

| 대상 | 판정 | 근거 |
|---|---|---|
| Revision/ChangeSet/Diff/Undo/Autosave(서버) | **포함** | AC 4종이 전부 서버 개념; 설계 10 §7.10의 DB Write 집합과 일치 |
| 편집 UI(rhwp Editor 결선) | **제외** | rhwp 미반입(OB-12), `apps/web`은 셸뿐. §1.8-4가 "시각 좌표는 계약에 들어오지 않는다"로 계약을 편집기와 분리해 두어 안전하게 분리된다 |
| HWPX 저장/Export | **제외(CC-160)** | ADR-29 D11, `serialize()`가 CC-160 소유로 거부 중. CC-150이 구현한 저장 모드는 §1.10의 `AUTOSAVE_IR` 하나 |
| generated_block → document materialize | **포함** | ADR-27 D2/D10이 CC-150에 배정 |
| 업로드·import API(UNE-DOC-001~004) | **제외(CC-160)** | S3 포트 신설은 별도 수직 관심사이고, CC-160이 이미 Export 산출물의 `file_object` 쓰기를 갖는다. 테스트/E2E용 문서는 HTTP 표면 없는 `DocumentImportService`가 만든다 |

**CC-160 전제를 깨지 않을 의무**(ADR-29 D7): `document.source_file_id`를 지우거나
재지정하지 않으며, 모든 파생 revision이 `ir.sourceHash`를 원본 값 그대로
승계한다(불변식 I8).

## D2. 안정 ID 동결 — CC-140의 앵커 파생 결함 해소

**결함**: `paragraphId = f(rawXmlAnchor)`였다(`stableIdForAnchor('P', "…#p[17]")`).
문단을 삽입하면 이후 서수가 밀려 **IR을 다시 빌드하면 ID가 전부 바뀐다.** 그러면
안정 ID(US-PLAN-015)·selection anchors(AC2)·Undo·G15-3이 동시에 무너진다.

**결정**:
- 편집은 IR을 XML에서 **재빌드하지 않는다.** `document_revision.ir_json`을
  로드해 트리를 변형한다 → 기존 노드 ID는 어떤 편집으로도 재계산되지 않는다.
- 신규 노드는 앵커와 무관한 결정적 파생 `authoredStableId(kind, changeSetId,
  opOrder, seq)`. 난수·시각 금지(I1/I7 결정성 유지).
- **충돌 시 재발급하지 않고 오류**(`ID_COLLISION`). seq를 올려 재발급하면 같은
  `(changeSetId, opOrder, seq)` 좌표가 다른 노드를 가리켜 결정성이 깨지고
  Undo가 엉뚱한 노드를 지운다.
- CC-140 산출 경로는 무변경(코퍼스 골든 134건 보호) — `stable-id.ts`는 추가만.

`uk_change_operation_order(change_set_id, operation_order)`(0019)는 성능이 아니라
**정확성 제약**이다: order가 중복되면 authored ID가 충돌하고 `invert∘apply ==
identity`가 깨진다.

## D3. Document IR v2 — NodeProvenance 판별 유니온

신규(AUTHORED) 노드에는 `rawXmlAnchor`가 없다. v1 타입·스키마는 이를 표현할 수
없었다.

```ts
type NodeProvenance =
  | { origin: 'SOURCE';   rawXmlAnchor: RawXmlAnchor; anchorHint?: undefined }
  | { origin: 'AUTHORED'; rawXmlAnchor?: undefined;   anchorHint: BlockAnchor };
```

- **판별 유니온을 쓴 이유**: "앵커도 힌트도 없는 노드"가 **컴파일되지 않는다** —
  불변식 I9가 런타임 검사 이전에 타입 층에서 막힌다.
- `PreservedBlockIR`은 `origin: 'SOURCE'` 고정 — 보존 객체는 원본 바이트의
  자리표이고 편집기가 만들 수 있는 대상이 아니다.
- **AUTHORED에 `anchorHint`를 필수로 둔 이유**: CC-160의 XML Delta Writer가 "이
  새 문단을 원본 XML의 어디에 쓸 것인가"를 알아야 한다. 지금 데이터로 남기지
  않으면 CC-160이 IR 순서에서 역추론해야 하고, 그건 §1.10-3(raw fragment 상대
  순서 유지)을 데이터가 아니라 알고리즘 신뢰로 바꾼다. `anchorHint`는 삽입
  시점에 고정하지 않고 매 ChangeSet 끝에 트리에서 정규 재계산한다(기준 노드가
  나중에 삭제·이동되면 삽입 시점 힌트는 조용히 거짓이 된다).
- **엔진이 v2를 직접 산출한다**(lift 경계 유지 대신). 표현이 두 벌이면 모든
  소비자가 "언제 lift해야 하는지"를 알아야 하고 CC-160/CC-170이 그대로 밟는다.
  영속 행이 0건인 지금이 유일한 무비용 시점이었다. `liftV1`은 읽기 경로 정규화
  (멱등)로 남긴다.
- 대가: SOURCE 전용 소비자 11곳에서 앵커가 optional이 됐다. `?? ''`로 뭉개면
  빈 앵커가 `resolveAnchor`에서 `null`이 되어 **I2가 거짓 통과**하므로, 던지는
  헬퍼 `sourceAnchor(node)`로 좁혔다.
- 계약: `document-ir.schema.json`에 `origin`/`anchorHint` + `if/then` 배타 제약.
  **`allOf` + `additionalProperties:false` 조합은 쓰지 않았다** — 2020-12에서
  base 브랜치가 sibling의 property를 못 봐 전 인스턴스가 무효가 되는 함정이며
  ADR-24 D4에 기록됐음에도 이 저장소에서 두 번 재발했다. 제약이 vacuous하지
  않음을 **정상 AUTHORED 노드 수용 케이스**로 함께 고정한다.

## D4. 낙관적 동시성 — ETag + baseRevisionId 이중 가드

`document`에는 `version_no`가 없다. **ETag = 반환한 표현의 `revision_no`**,
강한 태그. plan 계열 관용구(`plan.controller.ts`)를 그대로 따른다: 부재 428
COM-0428 / 형식 오류 400 COM-0400 / 불일치 **409 DOC-409-001** / 성공 시 새
ETag 재설정.

- **head가 아니라 "반환한 표현"인 이유**: 과거 revision을 명시 조회하면 head와
  다른 ETag가 나가고, 그걸 그대로 쓰면 409가 된다. 과거 표현을 기준으로 한
  쓰기는 **실제 충돌**이므로 이쪽이 안전하고 HTTP 의미에도 맞다. head 좌표는
  본문 `headRevisionId/headRevisionNo`로 함께 나간다.
- 계약이 `baseRevisionId`를 required로 못박아 두었으므로 **둘 다** 검증한다.
  둘이 어긋나면 요청 자체가 자기모순이므로 **422 DOC-422-004**.
- **409 페이로드**: `common-error.schema.json`의 `error`가
  `additionalProperties:false`라 구조화 필드를 넣을 수 없다. 스키마를 건드리지
  않고 **`ETag` 헤더 + `meta.conflict{currentRevisionId, currentRevisionNo,
  headIrHash}`**(meta는 open)로 실어 보낸다. 공용 error 스키마 개정은 전 도메인
  파급이라 기각.
- 동시성 실증: 같은 `baseRevisionId`로 동시 2건 → `document FOR UPDATE` 직렬화
  + `uk_document_revision_no` → 정확히 1성공 1×409(실 DB 테스트).

## D5. Offset Normalization Contract

offset 공간 = 문단의 run 텍스트를 순서대로 이은 문자열의 **UTF-16 code unit**
인덱스(§1.8). **어떤 XML 구성요소가 문자를 기여하는가는 세부사항이 아니라 그
공간의 정의**다 — 클라이언트가 다르게 세면 조용히 엉뚱한 위치를 편집한다.

CC-140이 `ir-builder`에 정한 표를 **정본으로 승격**한다: `fwSpace`→U+0020,
`nbSpace`→U+00A0, `tab`→U+0009 기여; `lineBreak`/`hypen`/`fieldBegin`/`fieldEnd`
**미기여**. 엔진 표와 도메인 계약 표의 **동치를 계약 테스트가 고정**한다 — 이것이
rhwp 어댑터가 붙을 때 offset 불일치를 즉시 드러내는 지점이다(rhwp 적합성
선택지 A, 사용자 결정 2026-08-02).

경계 스냅 3규칙(전부 **뒤로** 스냅 — 조정은 편집을 좁힐 수는 있어도 넓혀선
안 된다): 서로게이트 페어 / 결합문자 클러스터 / 필드 제어문자 쌍 내부.
스냅 사실은 `SelectionContext.adjustments`로 보고해 사용자에게 "선택이
조정됨"을 표시할 근거를 준다.

## D6. 역연산은 컬럼이 아니라 도출 — 그리고 §1.9 표의 실측 정정

역연산은 `(operation_type, target, before)`에서 결정적으로 도출하고,
`invert(op) ∘ apply(op) == identity`를 **실 코퍼스 6종 속성 테스트**로 증명한다.

구현 중 §1.9 표대로 하면 **틀리는** 두 곳을 실측으로 발견해 정정했다:
- **문자 삭제의 역은 `INSERT_BLOCKS`가 아니다.** run 경계에서 문자를 재분배하면
  텍스트는 같아도 run 구성이 달라져 해시가 어긋난다(6종 전부 실측 불일치) →
  `REPLACE_RANGE(restoreRuns)`. 블록 삭제의 역만 `INSERT_BLOCKS`다.
- **SPLIT의 역은 단순 MERGE가 아니다.** 분할이 run 한가운데를 자르면 MERGE의
  이어붙이기로 쪼개진 run을 되붙일 수 없다 → before 이미지 복원.

역연산 배열은 **오름차순 그대로 적용하면 취소되도록 미리 뒤집어** 반환한다 —
Undo가 평범한 ChangeSet 제출이 되어 API에 특수 규칙이 생기지 않는다.

## D7. Undo/Redo/Restore = 새 ChangeSet·새 revision

CLAUDE.md "corrections are new versions … never overwrite audit history" +
US-PLAN-020 AC-01. 과거 revision·change_set을 UPDATE하지 않는다.
스택은 별도 테이블 없이 `change_set`의 `(document_id, created_at, origin,
undoes_change_set_id)` 계보에서 **파생**한다 — §1.9의 "AI/사용자 편집 동일 스택"을
`origin`이 아니라 **순서**가 지키고, `origin`은 감사·표시용이다.

**UNDO_CONFLICT**(US-PLAN-017 E-03): 대상 ChangeSet 이후 그 노드를 건드린
ChangeSet이 있으면 자동 Undo를 거부하고 422 + 영향 노드 목록을 준다.

## D8. Autosave = batch 1건 → 저널 1행 + ChangeSet 1건 + revision 1건

`ir_hash`가 같으면 새 revision을 만들지 않고 기존 head를 receipt로 반환
(plan `confirmSnapshot`의 content-hash 중복 제거 선례) → revision 폭증 완화.
멱등 앵커는 `clientMutationId`(문서 범위 UK). 판정 순서는 **멱등 → baseRevisionId
정합(422) → 낙관 잠금(409)** — 재전송은 새 편집이 아니므로 If-Match가 낡았다는
이유로 실패하면 안 된다.

**판정을 예외가 아니라 값으로 반환한다**: 트랜잭션 안에서 던지면
`CHANGESET_CONFLICTED`/`AUTOSAVE_FAIL` 감사와 `document_autosave` CONFLICT 행까지
롤백된다. 트랜잭션은 판정을 반환하고 HTTP 오류는 커밋 이후에 만든다
(US-PLAN-020 AC-02가 "자동저장 실패의 즉시 표시"를 요구).

`document_autosave`를 `change_set`과 합치지 않은 이유: 오프라인 재동기화는 도착
순서 역전·SUPERSEDED·CONFLICT라는 **비원자적** 결과를 요구하는데 ChangeSet의
원자성 모델에는 그 자리가 없다. 겹치면 어느 쪽 불변식도 못 지킨다.

## D9. `document_autosave` = 61번째 테이블 (기준선 결함 해소)

설계 10 §3.4·§7 추적표·OpenAPI `x-db-tables`가 이름을 확정했는데 §6 물리 DDL
표에 정의가 없다 — `generated_block`(ADR-27 D2)과 **동일 유형**의 기준선 결함이며
같은 방식으로 해소한다(0019).

## D10. 문서 하위 테이블 RLS (0018) — ADR-29 D9 이행

8개 테이블(`document_revision`/`document_block`/`change_set`/`change_operation`/
`template_profile`/`style_prototype`/`export_job`/`validation_report`)에 0016
패턴(부모 EXISTS 조인 + 명시 `tenant_id` 술어 + ENABLE/FORCE). `tenant_id` 컬럼
추가 금지(비정규화 사본이 부모와 어긋난다).

- `validation_report`는 **FK가 전무한 다형 부모**다. 설계가 명시한 `DOCUMENT`/
  `EXPORT` 두 값만 경로를 갖고 **나머지는 fail-closed**(0행/쓰기 거부). 조용한
  유출 대신 즉시 실패. target_type 어휘가 늘면 정책 확장 마이그레이션이 함께
  와야 한다.
- **실측 발견**: `document_block` 8만 행 조회가 RLS 하에서 3ms → 139ms(30배).
  원인은 부모 조회가 아니라 **인덱스 없는 자식 전수 스캔에 SubPlan qual을 얹는
  것**이다(일치 행 0건이라 서브플랜이 실행되지 않는 조건에서도 재현). 0019가
  유일성 키를 확정하며 해소 — **173ms → 1.2ms(150배)**. 만들지 않기로 한 두
  인덱스도 측정으로 기각했고, 중복 인덱스가 나중에 다시 추가되지 않도록 회귀
  단언으로 고정했다.

## D11. materialize = `INSERT_BLOCKS`의 source 변형

신규 op·신규 path를 만들지 않는다(§1.9 8-op 어휘와 ADR-27 D10 선례 유지).
`source.kind === 'GENERATED_BLOCKS'`로 표현하고 ADR-27 D4의 3중 방어를 이식:
`current_toc_version_id` 불일치 fail-closed 422 / `superseded_at IS NULL`만 /
보호 상태 블록 제외 + 사유를 `materialize.excluded[]`에 적재.
**엔진은 DB를 읽지 않는다** — 주입 함수(`GeneratedBlockProvider`)로 받고, 주입이
없으면 조용한 빈 삽입 성공이 아니라 위반으로 끝난다.

## D12. 오류코드·이름 드리프트 종결

- 설계 07 §1.8-5의 `DAI-1401/1402`는 01 MASTER(우선순위 7)의 코드 공간이고,
  설계 10 §3.4(우선순위 3)가 이 오퍼레이션에 `DOC-*`를 배정했다 → **DOC-*가
  정본**, DAI는 사상표로만 남긴다(ADR-29 D2의 변종 어휘 처리 승계).
  DOC-404-001/002, 409-001/002/003, 422-004.
- `prototype_registry`(OpenAPI x-db-tables) → **`style_prototype`**(구현·
  마이그레이션 진실). 설계의 `doc_prototype_registry`는 논리명이므로 원문 무변경.

## D13. 배치 — 엔진/도메인/API

설계 07 §1.2가 SelectionResolver·ChangeSetExecutor를 엔진 상자에 배정했으므로
`services/hwpx-engine/src/edit/`에 둔다(엔진은 런타임 의존 0이라 API가 의존해도
비용이 없다). **타입 정본은 `@une/domain`**(ADR-29 D4 불변) — 엔진은 소비만 한다.
트랜잭션 경계는 API 소관: `document FOR UPDATE` → head → 검증 → 엔진(순수) →
revision + change_set + change_operation N + 포인터 + audit **한 트랜잭션**.

**원자성은 롤백이 아니라 자료구조로 보장한다**: 실패 결과 타입에 `ir` 필드가
아예 없어 호출자가 부분 변형을 저장할 수 없고, 모든 트리 연산이 새 객체를
만들어 입력 IR을 변형하지 않는다.

## D14. alias 저장 형태의 제약 (열린 항목)

SPLIT은 alias를 남기지 않는다(왼쪽이 원래 ID를 유지하므로 기존 선택이 계속
유효). MERGE만 `{from: rightId, to: leftId, offsetDelta: 왼쪽 길이}`를 남긴다 —
**offsetDelta가 없으면 재해석이 "노드는 맞히고 위치는 틀리는" 형태**가 된다.

**제약**: 같은 노드 쌍이 merge→undo→merge를 반복하면 append-only 목록에서 alias
체인 추적이 옛 항목을 다시 밟는다. 따라서 저장 형태는 **`change_set_id`별로
유효/무효를 판정할 수 있어야** 하며 단순 append 목록으로는 부족하다. CC-150은
`change_set.selection_json`에 `{aliases, aliasRemovals}`를 접어 넣는 형태로
운용하고, 전용 저장 구조는 편집 이력이 길어지는 시점(CC-170)에 재평가한다.

**DELETE로 사라진 노드는 alias를 만들지 않는다** — 삭제된 문단을 다른 문단으로
재해석하면 사용자가 선택한 적 없는 자리를 편집하게 된다. `NODE_NOT_FOUND`로
재선택을 요구하는 것이 §1.8-2의 "가능한 경우"에 맞는 해석이다.

## D15. 설계 어휘 충돌 해소 (우선순위 규칙 적용)

- **`change_set.status`**: 설계 05가 같은 개념에 서로 어긋나는 세 어휘를 적는다
  (`DRAFT→VALIDATING→…`, `APPLIED/CONFLICT/ERROR`, `APPLIED/REJECTED/CONFLICT`).
  자기들끼리 충돌해 채택 근거가 없고, 우선순위 3(설계 10 §6.20)과 4(0003
  COMMENT)가 `APPLIED/REJECTED`로 일치한다 → **2종으로 닫는다.** 모델과도
  정합적이다: ChangeSet은 원자적이라 중간 상태가 지속될 수 없고, 비원자적
  결과는 `document_autosave`가 맡는다.
- **`document.status`**: 설계 09의 13종 상태표는 이 컬럼이 아니라 `plan.status`의
  것이다(값 집합이 `PLAN_STATUSES`와 글자 단위로 동일) → `EDITING/REVIEW/
  APPROVED` 3종.
- **`change_operation.operation_type`**: 설계 10의 `"insertText 등"`은 닫힌
  집합이 아니라 예시 한 개다 → 설계 07 §1.9의 **8종**. 0018 테스트 픽스처 4곳이
  `insertText`를 쓰고 있어 함께 정정했다.

## 수용 한계

- 편집 **UI 없음**, rhwp 렌더/편집 검증 전무(OB-12) — 서버 계약만 존재한다.
- 성능 임계 게이트 미도입(§1.12 편집 P95 300ms는 측정만, G15-5는 CC-160 선례).
- `change_operation.before_json`이 항상 `null`이다 — 엔진이 per-op before-image를
  공개 표면으로 내지 않는다. Undo는 저장된 역연산으로 충분하지만 감사 열람 UI가
  before를 요구하면 엔진 표면 확장이 필요하다.
- `template_profile.analysis_status`의 어휘가 여전히 미확정(도메인 판정 4종 vs
  설계 09 상태표 9종). CC-150은 판정값을 변환 없이 넣고 CHECK를 걸지 않았다 —
  **CC-160에서 종결**.
- `document_block`에 **쓰지 않는다**. 설계 10의 어떤 API 행도 이 테이블을 읽거나
  쓰지 않으며(전수 확인) IR이 단일 정본이다. 검색·보호 투영이 실제 질의 경로를
  얻는 시점(CC-170)에 채운다 — 0019가 이 테이블의 UPDATE/DELETE 권한을 남겨 둔
  이유다.
- append-only REVOKE 유보: `checkpoint_label`은 사용자가 나중에 붙이는 값이라
  UPDATE 회수가 그 경로를 막고, `change_operation`은 실행기의 쓰기 순서가 확정된
  뒤 컬럼 단위 트리거로 거는 것이 정확하다.
- `document_autosave.status × result_revision_id` 상관 제약 미도입 — 이번
  구현으로 "ACCEPTED만 result를 채운다"가 확정됐으므로 CC-160에서 CHECK 가능.
- 문자 범위 편집이 **여러 문단에 걸치면 거부**한다(복합 의미를 한 연산에 숨기지
  않기 위해). §1.9가 SPLIT/MERGE·블록 연산 어휘를 이미 제공한다.

## 재검토 Trigger

rhwp 반입·편집기 결선(offset 계약 실검증), 편집 이력이 길어져 alias 체인이
문제가 되는 시점(D14), CC-160의 Serializer가 `anchorHint`를 실제로 소비하는
시점, `before_json`을 요구하는 감사 UI 등장, `analysis_status` 어휘 확정.
