# Session Handoff

- Date/time: 2026-08-02 (집 PC — CC-150 **완료**, PR #12 **머지됨**)
- Branch: **main** @ `4e25b8c` (= PR #12 머지 커밋). feature/CC-150은 머지 후 남아 있다
- Current Work Item: **CC-150 DONE**(머지 완료). 증거문서·이중리뷰·지적 전건
  반영·상태문서 갱신까지 끝냈다. 다음은 **CC-160**.

## ⚠️ 회사 PC에서 먼저 할 것

CC-150이 **의존성과 마이그레이션을 둘 다 늘렸다.** 순서대로 하지 않으면
테스트가 엉뚱한 이유로 실패한다.

```bash
git fetch origin && git checkout main && git pull
pnpm install      # ① 락파일 변경(tests/contract·services/api에 @une/hwpx-engine 추가)
pnpm db:migrate   # ② 0018·0019 신규 — 회사 PC DB에 아직 없다
pnpm -r build     # ③ domain/hwpx-engine dist 필요(다른 워크스페이스가 import)
```

- **DB 포트가 PC마다 다르다**: 집 PC는 **15432**(Windows 네이티브 PG가 5432 점유),
  **회사 PC·저장소 기본값은 5432**. `infrastructure/.env`는 gitignored라 회사 PC
  값이 그대로 있을 것 — 건드리지 말 것.
- 통합 테스트는 `DATABASE_URL`(superuser)이 필요하다. 없으면 db-integration
  107건과 문서 e2e·worker e2e가 **조용히 skip**되고 exit 0이 된다.
  집 PC에서는 `infrastructure/.env`를 읽어 다음과 같이 만들어 썼다:
  `postgres://$UNE_DB_USER:$UNE_DB_PASSWORD@127.0.0.1:$UNE_DB_PORT/$UNE_DB_NAME`
- `pnpm test`는 첫 실패에서 중단된다 — 한 워크스페이스가 깨지면 뒤는 아예 실행되지
  않는다. 수치 인용 전 **분모(`Test Files N passed (N)`)** 까지 확인할 것.
- gh CLI는 집 PC에 설치·인증돼 있고 **PATH에 없다**: `export PATH="$PATH:/c/Program Files/GitHub CLI"`.
  회사 PC는 `gh auth status`로 확인하고 없으면
  `winget install --id GitHub.cli` → `gh auth login --web`.

## 바로 이어서 할 일

1. **CC-160**(HWPX 보존 export + Track A)로 바로 착수. PR #12는 CI
   `verify`/`db-verify` 통과 후 머지됐다(각 1m37s / 1m11s). 선행 사실:
   - `serialize()`는 CC-160 소유로 아직 거부 상태다(ADR-29 D11).
   - CC-150이 `anchorHint`를 데이터로 남겨 두었으므로 XML Delta Writer가 IR
     순서에서 역추론할 필요가 없다(ADR-30 D3).
   - `template_profile.analysis_status` 어휘 확정과
     `document_autosave.status × result_revision_id` CHECK가 CC-160 몫이다.

## Completed this session (CC-150 DONE)

**서버측 편집 코어.** 편집 UI(rhwp 결선)와 HWPX 저장/Export는 범위 밖(각각
미반입·CC-160). 결정 정본: **ADR-30**(D1~D16 + 수용 한계).
증거: `docs/evidence/CC-150-document-edit-verification.md`.

- **DB**: `0018_document_child_table_rls.sql`(문서 하위 8테이블 RLS — ADR-29 D9가
  등재한 차단성 선행조건 해소), `0019_document_edit_surface.sql`(**61번째 테이블
  `document_autosave`** 신설 = `generated_block`과 동일 유형의 기준선 결함 해소,
  Undo 계보 컬럼, CHECK 다수, 멱등 UK, 인덱스).
- **도메인**(`packages/domain/src/document/`): `selection.ts`(3층 분리를 타입으로
  강제, **Offset Normalization Contract** 정본화), `change-set.ts`(8-op 어휘·
  NodeAlias·거부사유 10종), `document-ir.ts` **v2**(NodeProvenance 판별 유니온).
- **엔진**(`services/hwpx-engine/src/edit/`): SelectionResolver §1.8 전건,
  ChangeSetExecutor §1.9 파이프라인, 역연산 도출, 프로토타입 해석, authored-id,
  ir-lift, **커밋 전 `checkEditInvariants`**. 원자성은 롤백이 아니라 자료구조로 —
  실패 결과 타입에 `ir` 필드가 없어 부분 변형을 저장할 수 없다.
- **API**(`services/api/src/document/`): UNE-DOC-005~009, ETag+baseRevisionId 이중
  가드, 409에 ETag 헤더+`meta.conflict`, 멱등, 감사, materialize(ADR-27 D4 3중
  방어 이식), `DocumentImportService`(HTTP 표면 없음 — 업로드 API는 CC-160).
- **계약**: `une-platform-api-v1.yaml` 005~009 재작성, `change-set.schema.json`,
  `document-ir.schema.json` v2, mock 24라우트.

### 실측으로 잡은 것 4건

1. CC-140의 안정 ID가 앵커 파생이라 편집 후 붕괴 → ID 동결 + authored ID 별도 파생.
2. §1.9 표대로 만든 역연산이 틀림(문자 삭제·SPLIT — 6종 전부 해시 불일치 실측 후 정정).
3. RLS 하 자식 전수 스캔 30배 → 0019 인덱스로 173ms→1.2ms.
4. **UNDO_CONFLICT 계보 비교를 애플리케이션에서 왕복시키면 모든 Undo가 자기
   자신과 충돌한다** — `timestamptz`(마이크로초) vs JS `Date`(밀리초) 절삭.
   비교를 SQL 안으로 옮겨 해소(`listAppliedChangeSets`).

### 이중 리뷰 (병렬, opus — 전건 당일 반영)

초기 판정 **arch 2 BLOCKER / 6 MAJOR / 7 MINOR, QA FAIL**. 두 리뷰가 **독립적으로
같은 결함 세 건**을 지목했다. 상세는 ADR-30 **D16**과 증거문서에 있고, 요약:

1. 요청이 `{restore: …}`로 **임의 IR 조각을 문서에 심을 수 있었다**(위조 앵커·
   `locked:true`·500). 판별 유니온은 컴파일 시점 보장이라 캐스트 경로를 못 막는다.
2. **Undo가 실행 불가**였다 — 역연산의 센티널 `baseRevisionId`가 UUID 검증에 걸려
   400. 200 응답이 자기 응답 스키마를 위반하고 있었다.
3. materialize가 `sources[0]`만 검사 → 두 번째 소스부터 3중 방어 우회.

**개정(ADR-30 D16)**: Undo는 `undoesChangeSetId`로 **되돌릴 ChangeSet만 지목**하고
서버가 저장된 역연산을 적용한다(요청에 연산을 실으면 400). UNDO_CONFLICT 구현.
alias는 **노드가 현재 IR에 살아 있으면 밟지 않는다**(복원 후 오편집 차단 —
D14의 저장구조 문제를 판정 규칙으로 닫았다). `ir_hash` 중복 제거 구현,
REJECTED 재전송은 다시 422, `document.status` 강제.

### 게이트 (단일 `pnpm test`, exit 0 · `DATABASE_URL` 설정 — skip 0)

domain 62 / hwpx-engine 353 / contract-tests 188 / api 242 / db-integration 107 /
provider-adapters 108 / worker 33 / baseline 10.
contracts·intake·handoff PASS. build·typecheck·lint·format PASS.
계약 타입 재생성 diff 0. 설계 원문·전사본·rhwp upstream 무변경.

## 알려진 미결 (CC-160 이후 판단)

- `change_operation.before_json`이 **연산별로는** 여전히 `null`. 다만 ChangeSet
  단위 역연산이 최저 order 행의 `after_json.inverse`에 있어 before 정보 자체는
  있다 — 감사 UI가 연산별 before를 요구하면 필요한 것은 수집이 아니라 재배치다.
- `template_profile.analysis_status` 어휘 미확정(도메인 판정 4종 vs 설계 09
  상태표 9종) — CC-160에서 종결.
- `document_block`에 쓰지 않는다(IR이 단일 정본). 투영은 CC-170.
- `document_autosave.status × result_revision_id` 상관 제약 미도입 — CC-160에서 CHECK.
- 자동저장 `seq`는 클라이언트 값이고 단조성을 강제하지 않는다(강제하면 오프라인
  큐의 정상 동작을 거짓 오류로 만든다). 실 편집기 결선 시점(CC-170)에 재평가.
- mock은 자동저장 저널의 SUPERSEDED/CONFLICT와 ChangeSet REJECTED를 재현하지
  않는다(요청 형태·자기모순 422·Undo 형태까지만 맞췄다). mock은 판정 정본이 아니다.
- 성능 임계 게이트 미도입(§1.12 편집 P95 300ms는 측정만).

## 보류 항목 — 막히면 여기서 답을 찾고 먼저 의견을 낼 것

2026-08-02 사용자 결정: 설계 원안대로 개발하는 데 혼선이 생길 수 있으니 아래
3건은 그 다음으로 미룬다(작업항목 34개 원안 유지, 신설 없음).

1. **rhwp 결선** — 2026-08-02 사용자 결정: **선택지 A로 진행**(서버가 offset
   계약을 소유. 이미 구현됨 — 엔진 공백 표 ↔ 도메인 계약 표의 동치를 계약
   테스트가 고정하므로 rhwp 어댑터가 붙을 때 불일치가 즉시 드러난다).
   **선택지 B(`@rhwp/core@0.8.2` devDependency 추가 후 실 코퍼스 적합성 프로브)는
   "나중에"로 보류.** npm 0.8.2 = git v0.8.2, MIT, 빌드된 WASM이라 Rust 툴체인
   불필요.
2. **ProcessGPT 패턴 평가** — 별도 항목으로서의 값어치는 낮다. 특정 문제(보상
   의미론, HITL 재배정 엣지케이스)에 막혔을 때의 참조 카드로 둔다. 데이터모델
   대체 금지(설계 D-05, 12 §4).
3. **외부 소스 분석 규약** — 포크 금지·임시 다운로드·원본 삭제. 대부분
   CLAUDE.md/hwpx.md와 중복이고 강제는 `validate:intake`가 이미 한다.

**라이선스 실측(저장소 직접 확인 — 설계 문구보다 우선)**: rhwp = **MIT**,
process-gpt = **MIT**(설계 논의의 "라이선스 없음"과 다름),
process-gpt-office-mcp = **없음 → 코드 복사 불가**(참고·재구현만).

## Risks/blockers

- **편집 UI 없음** — 설계 07 §1.2/§6.4가 rhwp Editor를 편집 Surface로 배정했고
  `apps/web`은 셸뿐이다. CC-150 서버 계약은 §1.8-4("시각 좌표는 계약에 들어오지
  않는다") 덕분에 편집기와 독립이라 진행 가능했다. **rhwp가 붙는 순간 offset
  계약이 실검증된다** — 계약 테스트가 그 지점을 이미 고정해 두었다.
- 기존 이월분(OB-01/07/08/10/11/12 OPEN) 유지.

## Notes

- prettier를 **docs/·contracts/에 실행하지 말 것**(사고 2회) — 커밋 전
  `git status -- docs/design-markdown` 무변경 확인. 이번 세션은 파일 두 개만
  지정해 실행했다(`npx prettier --write <파일>`).
- **설계 원문(docs/design-markdown)은 수정 금지.** 보완은 ADR + work-items로만.
- 골든 스냅샷·증거 문서에 본문 텍스트·Preview/PrvText·BinData를 넣지 말 것
  (`templete/` 6종은 실제 업무 양식 — security.md).
- **JSON Schema 2020-12에서 `allOf` + `additionalProperties:false` 금지** — base
  브랜치가 sibling의 property를 못 봐 전 인스턴스가 무효가 된다. ADR-24 D4에
  기록됐는데 이 저장소에서 **두 번 재발**했다. 인라인 또는 `unevaluatedProperties`를
  쓰고, 제약이 vacuous하지 않은지 **정상 케이스 수용 테스트**로 함께 고정할 것.
  이번 CC-150에서는 재발하지 않았고, 구조 순회 테스트가 그것을 지킨다.
- 게이트를 깨뜨린 뒤 재실행 없이 완료 선언하지 말 것. 파일을 고쳤으면 단일
  `pnpm test`로 전량 재현한 수치만 기재한다.
- **소스 파일에 리터럴 NUL을 넣지 말 것** — git이 바이너리로 취급해 diff 리뷰가
  불가능해진다. 해시 구분자는 `\u0000` 이스케이프로 쓴다(값은 같다).
