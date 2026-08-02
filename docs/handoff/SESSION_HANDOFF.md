# Session Handoff

- Date/time: 2026-08-02 (집 PC, CC-150 세션 — **미완, 내일 회사 PC에서 계속**)
- Branch: **feature/CC-150** @ main e2a6954 기반 (CC-140은 PR #11 머지 완료)
- Current Work Item: **CC-150 진행 중(WIP)** — 구현·마이그레이션·계약은 완료,
  **증거문서·이중리뷰·상태문서 갱신이 남음**. 완료 선언하지 않았다.

## ⚠️ 회사 PC로 옮길 때 먼저 할 것

이 브랜치는 **의존성과 마이그레이션이 둘 다 늘었다.** 순서대로 하지 않으면
테스트가 엉뚱한 이유로 실패한다.

```bash
git fetch origin && git checkout feature/CC-150 && git pull
pnpm install      # ① 락파일 변경(tests/contract·services/api에 @une/hwpx-engine 추가)
pnpm db:migrate   # ② 0018·0019 신규 — 회사 PC DB에 아직 없다
pnpm -r build     # ③ domain/hwpx-engine dist 필요(다른 워크스페이스가 import)
```

- **DB 포트가 PC마다 다르다**: 집 PC는 **15432**(Windows 네이티브 PG가 5432 점유),
  **회사 PC·저장소 기본값은 5432**. `infrastructure/.env`는 gitignored라 회사 PC
  값이 그대로 있을 것 — 건드리지 말 것.
- 통합 테스트는 `DATABASE_URL`(superuser)이 필요하다. 없으면 db-integration
  107건과 worker e2e가 **조용히 skip**되고 exit 0이 된다.
- `pnpm test`는 첫 실패에서 중단된다 — 한 워크스페이스가 깨지면 뒤는 아예 실행되지
  않는다. 수치 인용 전 **분모(`Test Files N passed (N)`)** 까지 확인할 것
  (CC-140에서 이 함정에 빠졌다).
- gh CLI는 집 PC에만 설치·인증돼 있다. 회사 PC는 `gh auth status`로 확인하고
  없으면 `winget install --id GitHub.cli` → `gh auth login --web`.

## Completed this session (CC-150, WIP)

**서버측 편집 코어.** 편집 UI(rhwp 결선)와 HWPX 저장/Export는 범위 밖(각각
미반입·CC-160). 결정 정본: **ADR-30**(D1~D15 + 수용 한계).

- **DB**: `0018_document_child_table_rls.sql`(문서 하위 8테이블 RLS — ADR-29 D9가
  등재한 차단성 선행조건 해소), `0019_document_edit_surface.sql`(**61번째 테이블
  `document_autosave`** 신설 = `generated_block`과 동일 유형의 기준선 결함 해소,
  Undo 계보 컬럼, CHECK 다수, 멱등 UK, 인덱스).
- **도메인**(`packages/domain/src/document/`): `selection.ts`(3층 분리를 타입으로
  강제, **Offset Normalization Contract** 정본화), `change-set.ts`(8-op 어휘·
  NodeAlias·거부사유 10종), `document-ir.ts` **v2**(NodeProvenance 판별 유니온).
- **엔진**(`services/hwpx-engine/src/edit/`): SelectionResolver §1.8 전건,
  ChangeSetExecutor §1.9 파이프라인, 역연산 도출, 프로토타입 해석, authored-id,
  ir-lift. **원자성은 롤백이 아니라 자료구조로** — 실패 결과 타입에 `ir` 필드가
  없어 부분 변형을 저장할 수 없다.
- **API**(`services/api/src/document/`): UNE-DOC-005~009, ETag+baseRevisionId 이중
  가드, 409에 ETag 헤더+`meta.conflict`, 멱등, 감사 6종, materialize(ADR-27 D4
  3중 방어 이식), `DocumentImportService`(HTTP 표면 없음 — 업로드 API는 CC-160).
- **계약**: `une-platform-api-v1.yaml` 005~009 전면 재작성 + 신규 컴포넌트 20종,
  `change-set.schema.json` 신규, `document-ir.schema.json` v2(조건부 provenance),
  `prototype_registry`→`style_prototype` 이름 드리프트 종결, mock 24라우트.
- **실측으로 잡은 것 3건**: ① CC-140의 안정 ID가 앵커 파생이라 편집 후 붕괴
  (→ ID 동결 + authored ID 별도 파생), ② §1.9 표대로 만든 역연산이 틀림(문자
  삭제·SPLIT — 6종 전부 해시 불일치 실측 후 정정), ③ RLS 하 자식 전수 스캔
  30배(→ 0019 인덱스로 173ms→1.2ms).

### 게이트 (이 브랜치 현재 상태)
domain 62 / hwpx-engine 348 / contract-tests 186 / api 233 / db-integration 107 /
provider-adapters 108 / worker 33 / baseline 10. contracts·intake·handoff PASS.
build·typecheck·lint·format PASS. 설계 원문·전사본·rhwp upstream 무변경.

## 내일 회사 PC에서 할 일 (CC-150 마무리)

1. **증거문서** `docs/evidence/CC-150-document-edit-verification.md` — 수용기준
   4종(ETag/version conflict, selection anchors, undo/restore, audit) 대응표 +
   게이트 수치 + 핵심 검증 포인트. CC-140 증거문서를 형식 참고.
2. **이중 리뷰**: `architecture-guardian` + `qa-gate-reviewer` **병렬(둘 다 opus)**.
   중점: ADR-30 D2(ID 동결)의 실효, D3 판별 유니온이 계약 층까지 무는지,
   D4 이중 가드·409 페이로드, D13 트랜잭션 경계, materialize 3중 방어, 본문이
   로그·감사에 없는지, alias 저장 형태(D14)의 한계.
3. 지적 전건 반영 → **단일 `pnpm test`로 전 게이트 재현** → 그 수치로만 문서 기재.
4. `work-items/{IMPLEMENTATION_STATUS.md, MASTER_WORK_ITEMS.yaml, CHANGELOG.md}`
   갱신 + `docs/adr/README.md`에 **ADR-30 행 추가**(아직 미등재).
5. 커밋·PR·머지 → 다음 **CC-160**(HWPX 보존 export + Track A).

## 알려진 미결 (내일 판단할 것)

- **ADR-30이 `docs/adr/README.md`에 미등재** — 4번에서 반드시 처리.
- `change_operation.before_json`이 항상 `null`(엔진이 per-op before-image를 공개
  표면으로 내지 않음). Undo는 저장된 역연산으로 충분하나 감사 열람 UI가 before를
  요구하면 엔진 표면 확장 필요.
- `template_profile.analysis_status` 어휘 미확정(도메인 판정 4종 vs 설계 09
  상태표 9종) — CC-160에서 종결.
- `document_block`에 쓰지 않는다(IR이 단일 정본). 투영은 CC-170.
- alias 저장 형태: merge→undo→merge 반복 시 append-only 목록으로는 부족
  (ADR-30 D14) — 편집 이력이 길어지는 CC-170에서 재평가.
- `document_autosave.status × result_revision_id` 상관 제약 미도입 — 이번 구현으로
  "ACCEPTED만 result를 채운다"가 확정됐으므로 CC-160에서 CHECK 가능.

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
  않는다") 덕분에 편집기와 독립이라 진행 가능했다.
- 성능 임계 게이트 미도입(§1.12 편집 P95 300ms는 측정만).
- 기존 이월분(OB-01/07/08/10/11 OPEN) 유지.

## Notes

- prettier를 **docs/·contracts/에 실행하지 말 것**(사고 2회) — 커밋 전
  `git status -- docs/design-markdown` 무변경 확인.
- **설계 원문(docs/design-markdown)은 수정 금지.** 보완은 ADR + work-items로만.
- 골든 스냅샷·증거 문서에 본문 텍스트·Preview/PrvText·BinData를 넣지 말 것
  (`templete/` 6종은 실제 업무 양식 — security.md).
- **JSON Schema 2020-12에서 `allOf` + `additionalProperties:false` 금지** — base
  브랜치가 sibling의 property를 못 봐 전 인스턴스가 무효가 된다. ADR-24 D4에
  기록됐는데 이 저장소에서 **두 번 재발**했다. 인라인 또는 `unevaluatedProperties`를
  쓰고, 제약이 vacuous하지 않은지 **정상 케이스 수용 테스트**로 함께 고정할 것.
- 게이트를 깨뜨린 뒤 재실행 없이 완료 선언하지 말 것(CC-140에서 실제로 발생 —
  QA가 타임스탬프로 적발). 파일을 고쳤으면 단일 `pnpm test`로 전량 재현한 수치만
  기재한다.
