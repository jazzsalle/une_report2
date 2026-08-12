# CC-300 증거 — 상황일지 Projection·고정 사실·편집·Export

- 항목: CC-300 (UNE-JNL-005~011)
- 결정 정본: **ADR-44** (D1~D21, 수용 한계 12)
- 마이그레이션: `0042_journal_projection_and_review.sql`,
  `0043_revision_origin_projection.sql`,
  `0044_journal_event_types.sql`(이중검토 보정)
- 작성: 2026-08-12 (이중검토 반영 후 전 게이트 재측정)

## 1. 무엇이 동작하는가

```
POST /situations/{id}/journal-projections   일지 생성   (JOURNAL_CREATE,  201)
GET  /journals/{journalId}                  일지 상세   (JOURNAL_READ,    200)
POST /journals/{journalId}/ai-draft-jobs    문안 제안   (JOURNAL_AI_EDIT, 201)
POST /journals/{journalId}/changesets       서술 편집   (JOURNAL_EDIT,    201)
POST /journals/{journalId}/fact-refresh     사실 갱신   (JOURNAL_EDIT,    201)
POST /journals/{journalId}/submit-review    검토 요청   (JOURNAL_EDIT,    201)
POST /journals/{journalId}/approve          승인·반려   (JOURNAL_APPROVE, 201)
POST /journals/{journalId}/exports          내보내기    (JOURNAL_EXPORT,  202)
```

일지는 **반입된 HWPX 양식 사본 위에** 만들어진다. revision 1이 양식 자체,
revision 2가 투영(`origin='PROJECTION'`), 이후 편집·사실 갱신이 각각 판을 올린다.
Export는 CC-160 보존 되쓰기 경로를 그대로 타고 **실제 HWPX 바이트가 나온다**
(아래 §3에서 워커 실행·Track A·다운로드까지 확인).

`apps/web`에 상황일지 화면이 붙었고, 같은 변경에서 **CC-290의 전자상황판도 앱에
연결됐다** — 만들어져 있었으나 어디에도 마운트되지 않아 지금까지 화면으로 존재하지
않았다(`apps/web/src/ops/OpsWorkspace.tsx`).

## 2. 실행한 검증 (모두 이 문서 작성 시점의 트리에서 재측정)

| 대상 | 결과 |
|---|---|
| 도메인(`journal-projection.test.ts` 30 포함) | **353 pass** |
| 워크스페이스(`journal-state.test.ts` 5 포함) | **45 pass** |
| 계약 게이트(`journal.contract.test.ts` 30) | **418 pass** |
| 통합/RLS(마이그레이션 44, 테이블 68) | **197 pass** |
| API(`@une/api`) | **434 pass** |
| HWPX 엔진 | **426 pass** |
| provider 어댑터 | **264 pass** (7 skipped) |
| 현장 앱 | **19 pass** |
| E2E(`journal.e2e.test.ts` 24) | **135 pass (9 files)** |
| `pnpm typecheck` | 오류 0 |
| `pnpm lint` / `pnpm run format:check` | 통과 |
| `pnpm run validate:contracts` | CONTRACT VALIDATION: PASS |

명령.

```
pnpm --filter @une/domain test
pnpm --filter @une/web test
pnpm --filter @une/contract-tests test
pnpm --filter @une/db-integration test
pnpm --filter @une/api test
pnpm --filter @une/hwpx-engine test
pnpm --filter @une/provider-adapters test
pnpm --filter @une/field-web test
pnpm --filter @une/e2e test
pnpm typecheck && pnpm lint && pnpm run format:check && pnpm run validate:contracts
```

## 3. E2E가 실제로 증명하는 것 (24개)

| 시험 | 증명 |
|---|---|
| 확정 판과 사실원장에서 사실칸을 접는다 | 5개 절, `snapshotId` 일치, `document_revision` = [1 IMPORT, 2 PROJECTION], `source_file_id` 존재 |
| 확정 판이 없으면 일지를 만들지 않는다 | `JOURNAL-412-001` |
| 양식 없이는 일지를 만들지 않는다 | `JOURNAL-422-001` — 내보낼 수 없는 문서를 만들지 않는다 |
| 사실칸은 어떤 편집 경로로도 바뀌지 않는다 | 서술 저장 후 DB의 `fact_payload_json` 불변 |
| AI 제안은 시뮬레이션임을 밝히고 사실과 함께 대조된다 | `simulated: true`, `accepted`/`contradictions` 왕복 |
| 사람이 쓴 문장을 AI가 덮지 않는다 | `narrative_source='USER'` 보존, `accepted: false` |
| 사람 편집은 막지 않되 모순을 경고로 단다 | 임무 1건인데 "5건" → `taskCount` 모순 1건, 201 |
| 사실이 바뀌면 드러내되 자동 갱신하지 않는다 | `drifted: true` → 사람이 누른 뒤 갱신, USER 문장 생존 |
| **편집이 문서 판에 반영된다** | 편집 후 IR의 `OVERVIEW::NARRATIVE` 문단 글자가 실제로 바뀐다 |
| **편집은 보고 있던 판 위에서만 저장된다** | 낡은 `baseRevisionId` → `JOURNAL-409-002` |
| 검토 → 승인 | `REVIEW` 중 편집 409, 승인 기록에 `projection_hash` |
| 반려는 사유가 필요하고 다시 고칠 수 있다 | 사유 없는 반려 400, 반려 후 편집 201 |
| 승인된 일지는 얼어붙는다 | 서비스 409 + **DB 트리거** 2종 |
| **승인된 일지의 본문은 문서 편집 경로로도 못 고친다** | `document.status='APPROVED'`, 올바른 If-Match·baseRevisionId로도 거절 |
| 승인 기록은 고칠 수 없다 | `trg_journal_approval_append_only` |
| **Export는 CC-160 경로를 타고 실제 HWPX가 나온다** | 202 → 워커 실행 → `COMPLETED`, Track A `PASS`/`LIMITED`·FAIL 0건, `outputSha256 != sourceSha256`, 다운로드 바이트가 `PK`로 시작 |
| 승인 전에는 내보내지 않는다 | `JOURNAL-412-004` |
| 낡은 채로 검토에 넣지 않는다 / 승인 뒤에는 내보낼 수 있다 | `JOURNAL-412-002` → 갱신 → 승인 → 승인 뒤 drift에도 202 |
| 없는 섹션을 고칠 수 없다 | 400 |
| **권한 없는 사용자는 어느 연산도 하지 못한다** | 읽기 포함 8개 경로 전부 403 |
| **상태가 허락하지 않는 연산은 상태를 이유로 거절한다** | `JOURNAL-412-003` / `412-002` / `409-001` |
| **같은 멱등 키 재요청은 같은 일지를 돌려준다** | 같은 `journalId`, `journal` 1행, 양식 사본 1건 |
| **모든 연산이 감사 기록을 남긴다** | `JOURNAL_PROJECTED → EDITED → REVIEW_REQUESTED → APPROVED` 순서까지 |
| 다른 기관의 일지는 보이지 않는다 | `JOURNAL-404-001` / `SIT-404-001` |

응답은 `assertMatchesSchema`(Ajv 2020-12, CC-290의 실응답 대조 하네스)로
`JournalDetail`·`NarrativeProposal` 스키마와 대조한다 — 계약 문서가 아니라
**서버가 실제로 내보낸 것**을 본다.

## 4. 이 항목에서 잡힌 결함

### 4.1 개발 중 E2E·게이트가 잡은 것

| # | 결함 | 잡은 것 |
|---|---|---|
| 1 | `origin='PROJECTION'`이 `ck_document_revision_origin` 어휘에 없어 일지 생성이 100% 실패 | E2E |
| 2 | 일지 문서에 원본 HWPX가 없어 Export가 100% 거절 | E2E |
| 3 | 리비전 출처 어휘 게이트가 목록을 베껴 적어 0043 확장과 갈라짐 | 계약 게이트 |
| 4 | `JOURNAL-422-007`이 OpenAPI에 미선언 | 계약 게이트 |

### 4.2 이중검토가 잡은 것 (ADR-44 D14~D21)

| # | 결함 | 심각도 |
|---|---|---|
| C-1 | **편집·사실 갱신이 문서 판을 만들지 않아 종이에는 투영 당시 문장이 나갔다** | 치명 |
| C-2 | **승인된 일지의 문서가 얼지 않아 승인된 적 없는 판을 내보낼 수 있었다** | 치명 |
| C-3 | `eventTypes` 필터를 저장하지 않아 필터 일지가 태어나자마자 drifted·영구 Export 불가 | 치명 |
| F1 | **앵커가 절/빈 문단이라 워커에서 조용히 FAILED — 실제 HWPX가 0건이었다** | 치명 |
| F4 | 대조기가 문장부호 쉼표·버전 번호를 오독해 **갓 만든 일지에 상시 오탐** | 중대 |
| F5 | 다섯 절 중 둘은 어떤 값을 넣어도 못 잡았다 | 중대 |
| F6 | fail-closed 분기가 E2E로 증명 불가인데 시험 이름이 증명한다고 말했다 | 중대 |
| M-1 | 사실칸 침범 검사가 구조적으로 공회전 | 중대 |
| M-2 | 문서 문단에 `factPayload` 원시 JSON(내부 UUID 포함) | 중대 |
| M-3 | 클라이언트 `revisionId`가 Export 선행조건을 우회 | 중대 |
| M-4 | `fact-refresh`가 OpenAPI에 없음 | 중대 |
| M-5 | 계약이 광고한 `baseRevisionId` 낙관 잠금을 구현이 무시 | 중대 |
| M-6 | provider를 서비스가 직접 생성 + 어댑터 원문 미보존 | 중대 |
| M-7 | capability 레지스트리 미등록 + OB-01/OB-03 오인용 | 중대 |
| M-8·M-9 | `stable_block_key`·`PROTECTED_BLOCK` — 존재하지 않는 기제를 근거로 인용 | 중대 |
| M-11 | 저장소 쓰기 경로에 테넌트 술어 없음(RLS 단독 의존) | 중대 |
| 자체 | 임무 집계가 기간으로 잘리지 않음 / Export가 승인을 요구하지 않음 | 중대 |

**F1이 이 항목의 중심 결함이다.** 단위·계약 시험이 전부 통과하고 API도 202를
돌려주는데, 워커에서 조용히 실패해 산출물이 하나도 나오지 않았다. "접수 성공"이
"문서가 나왔다"로 읽히므로 요청 시점 거절보다 나쁘다. E2E를 **워커 실행·Track A·
다운로드 바이트까지** 밀어붙인 뒤에야 드러났다.

**엔진 결함 하나를 함께 고쳤다**(`xml-delta.ts` `pickCloneSource`): 탐색 루프에서는
복제 가능성을 검사하면서 앵커 빠른 길에서는 검사하지 않아, 복제 가능한 문단이
문서에 있어도 앵커를 그대로 골라 실패했다. 계획서 경로에도 있던 함정이다.

## 5. 지금 사실이 아닌 것

ADR-44 수용 한계 12건이 정본이다. 밖으로 말할 때 특히 흐려지기 쉬운 다섯.

1. **T3Q 서술 연산은 없다.** 붙어 있는 것은 규칙 기반 시뮬레이션이고, 어댑터가
   스스로 `simulated: true`를 밝히며 화면에 배너로 뜬다(OB-03, `MOCK_ONLY`).
2. **fail-closed는 E2E가 증명하지 않는다.** 현행 어댑터로는 반박이 구조적으로
   없어 그 분기가 발동하지 않는다. 규칙은 도메인 단위 시험이 잡는다.
3. **양식의 표 칸을 채우지 않는다.** 절 표제를 찾아 그 뒤에 문단으로 부기한다.
   "양식이 채워진 상황일지"가 아니라 "양식 사본에 절별로 부기된 상황일지"다.
   표 셀 채움은 CC-160 되쓰기에 표 행 복제가 열려야 성립한다(ADR-31).
4. **PDF·DOCX는 어휘에만 있다.** 실제로 나가는 것은 HWPX뿐이다(`EXPORT-422-001`로
   정직하게 거절하는 것까지 확인).
5. **사실 대조는 규칙이고 사각이 있다.** 객체 값(`byStatus`)은 검사하지 않고,
   표현과 숫자 사이는 한글·공백 6자까지만 넘는다. 사람 편집이 fail-open인 것은
   이 한계를 전제한 설계다.

그리고 고아 문서(수용 한계 6)는 **편집도 Export도 되는 상태로 남는다.** 정리
경로가 없다는 문장만으로는 노출을 좁게 적은 것이라 한계 항목을 다시 썼다.
