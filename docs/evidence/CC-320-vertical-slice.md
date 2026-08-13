# CC-320 — 상황–SOP–일지 수직 슬라이스 E2E 증거

- 작업 항목: CC-320 (G3)
- 브랜치: `feature/CC-320`
- ADR: **ADR-46**
- 마이그레이션: `0047_run_mode_must_not_exceed_situation.sql`,
  `0048_closed_situation_freezes_baseline.sql`
- 날짜: 2026-08-13

## 1. 이 항목이 한 일

CC-200부터 CC-310까지 항목마다 슬라이스 E2E가 있었다. 그것들이 증명한 것은
**한 구간이 선다**는 것이고, 저마다 앞 구간을 SQL로 심어 출발점을 만들었다.
그래서 아직 아무도 묻지 못한 것이 남아 있었다 — **구간과 구간 사이가 이어지는가.**

`tests/e2e/src/vertical-slice.e2e.test.ts`는 훈련 하나를 **API와 워커로만**
통과한다. 도메인 행을 SQL로 심지 않는다(테넌트·사용자만 하네스가 만들고, V-1
때문에 지식문서 파일 하나만 예외로 심는다 — 그 자리에 왜 심는지가 본문에 적혀
있다). SQL은 단언할 때만 쓴다.

꿴 경로:

```
상황 등록(CC-200) → 사실 수집·충돌 해소(CC-200/210) → 판 확정(CC-210)
→ 지식문서(CC-220) → 근거 검색·동결(CC-230) → SOP 생성(CC-240)
→ 캔버스·검증·검토·승인(CC-250) → 실행·임무(CC-260) → 전파(CC-270)
→ 현장 수행·에스컬레이션(CC-280) → 실행 로그·대시보드(CC-290)
→ 일지 투영·승인(CC-300) → 종료·평가(CC-310)
```

## 2. 수용 기준 대응

| 기준 | 어디서 증명하나 |
|---|---|
| end-to-end exercise flow | (1)~(13) 전체가 한 시나리오다. 상황 하나가 상태를 쌓아 간다. |
| multiple tasks | (6) ACTION 노드 셋에서 임무 셋이 나오고 `activeNodeKeys`가 `a1`만 연다. (8) 첫 임무 완료·승인이 `a2`를 연다. |
| failure/retry/escalation | (14) 실사건 전파가 채널 실패를 만나 재시도하고 `PENDING/SENDING`에 갇힌 것 없이 `SENT`/`DEAD`로 종결한다. (8b) 지연 임무 에스컬레이션. |
| journal fact consistency | (10) 일지 사실칸이 확정 판을 가리키고, 확정 판의 문자열 사실이 일지 셀에 실제로 실려 있는지 대조한다. `compared > 0` 단언으로 **대조할 것이 없는 공회전**을 막았다. |

## 3. 찾은 것

### V-1 — 지식문서 용도 파일 업로드 경로가 없다 (열어 둠, OB-19)

UNE-KNOW-001은 `fileId`를 받는데 **그 `fileId`를 만들 수 있는 API가 없다.**
UNE-DOC-001은 `IMPLEMENTED_PURPOSES`가 `HWPX_IMPORT` 하나이고 MIME도 HWPX만
받는다. `KNOWLEDGE_DOCUMENT`는 어휘에만 있고 `FILE-422-001`로 거절된다.

즉 지식문서 → 근거 검색 → SOP 생성 구간 전체가 API만으로는 도달할 수 없다.
CC-220의 e2e가 `file_object`를 SQL로 심어 출발했기 때문에 보이지 않았다.

고치려면 용도별 MIME·크기 정책, `file_object.purpose` 저장, AV 경로(OB-15)가
함께 와야 한다. 이 항목의 범위를 넘으므로 **OB-19**로 등재했다(ADR-46 D4).

실측:
```
POST /api/v1/files {purpose: "KNOWLEDGE_DOCUMENT", mimeType: "application/pdf"}
→ 422 FILE-422-001 "KNOWLEDGE_DOCUMENT 용도는 아직 지원하지 않습니다."
```

### V-2 — 훈련 상황이 LIVE 실행을 받아들였다 (고침)

`mode='EXERCISE'` 상황에서 `POST /sops/{id}/runs`에 `mode: 'LIVE'`를 주면
실행이 **201로 만들어졌다.** 그 실행의 임무는 CC-270 전파 게이트를 그대로
통과한다 — ADR-41 D9가 막는 것은 `run.mode`뿐이고, 실행을 만드는 쪽이
`run.mode`를 `situation.mode`와 대조하지 않았다. **훈련이 실제 문자를 보낸다.**

고친 방식(ADR-46 D1): 도메인 규칙 `canRunModeInSituation` + API 거절
`SOP-422-009` + DB 트리거 `0047`. 0047은 적용 시점에 기존 위반 행도 센다.

실측(수정 전 → 후):
```
POST /sops/{id}/runs {mode:'LIVE'}  (situation.mode='EXERCISE')
수정 전: 201 Created
수정 후: 422 SOP-422-009
DB 직접 INSERT: 42501 (0047 트리거)
같은 자리 mode:'EXERCISE': 201 — 막은 것은 "더 실제인 것"뿐이다
```

### V-3 — 종료가 얼리는 것이 사실원장뿐이었다 (고침)

훈련을 `CLOSED`로 닫은 뒤에도 새 일지를 투영하고, 고치고, 승인할 수 있었다.
종료 기준선(`closureBaselineHash`)은 일지 목록(`journalId`·`status`·
`projectionHash`)과 실행 목록까지 담는데 0045 §5가 얼린 것은 `execution_event`
뿐이었다 — ADR-45가 수용 한계 12·13으로 스스로 적어 둔 자리다.

고친 방식(ADR-46 D2·D3):

- **막는다**: 새 일지 투영·일지 편집·검토요청·승인·반려(`JOURNAL-409-004`),
  새 사실 후보·새 확정 판(0048 §1).
- **DB가 한 겹 더 막는다**: 일지 컨트롤러만 막으면 일지 문서는
  `document.status='EDITING'`이라 `/documents/{id}/changesets`·autosave·Undo가
  전부 통한다(ADR-44 이중검토 C-2와 같은 구멍). 0048 §2가 `document_revision`
  INSERT를 직접 지킨다.
- **막지 않는다**: 이미 승인돼 얼어붙은 판의 Export. 읽기 측 물화이지 쓰기가
  아니며, 막으면 닫힌 훈련의 승인 일지를 영영 재출력할 수 없다(감사 제출·
  재인쇄가 정확히 종료 뒤에 필요하다).
- **새 가드를 두지 않는다**: CC-260 실행 제어(pause/resume/terminate)는 상태
  변경과 이벤트 쓰기가 한 트랜잭션이라 0045 §5가 이미 fail-closed다.

실측(수정 전 → 후):
```
POST /journals/{id}/exports          수정 전 202 → 수정 후 202 (의도된 동작)
POST /situations/{id}/journal-projections  수정 전 201 → 후 409 JOURNAL-409-004
POST /journals/{id}/submit-review    수정 전 201 → 후 409 JOURNAL-409-004
POST /situations/{id}/snapshots      수정 전 201 → 후 4xx
INSERT INTO document_revision (일지 문서)  수정 전 성공 → 후 42501 (0048 §2)
```

## 4. 하네스에 더한 것

수직 슬라이스가 API로만 지나려면 하네스가 두 가지를 더 갖춰야 했다.

1. **권한**: `INSTITUTION_ADMIN`에 상황(`SITUATION_CREATE/READ/EDIT/
   FACT_COLLECT/FACT_EDIT/CONFIRM`)과 지식·근거(`KNOWLEDGE_UPLOAD/READ`,
   `EVIDENCE_SEARCH/READ/LOCK`) 권한을 더했다. 앞선 슬라이스들이 이 구간을
   SQL로 심었기 때문에 빠져 있었다.
2. **워커**: `KnowledgeUploadRunner`를 `@une/worker` 공개 표면에 추가하고
   하네스에 붙였다(UNI는 mock — 실 UNI 지원이 아니다, OB-13은 여전히 열려 있다).

이 변경이 기존 e2e 열 개를 깨뜨리지 않는다는 것은 §5의 회귀가 보인다.

## 5. 게이트 결과

| 게이트 | 명령 | 결과 |
|---|---|---|
| 빌드 | `pnpm build` | PASS |
| 계약 | `pnpm validate:contracts` | PASS (OpenAPI 5 + 스키마 7 + mock 29 라우트 + 예제 63) |
| 마이그레이션 | `pnpm run db:migrate` | 46 → **48** 적용 |
| API | `pnpm --filter @une/api test` | **434 passed** |
| E2E | `pnpm --filter @une/e2e test` | (§6) |

## 6. 남긴 것

ADR-46 수용 한계 여섯을 참조한다. 그중 다음 항목이 후속으로 넘어간다.

- **기준선 드리프트를 조회 경로가 아직 말하지 않는다**(한계 1). D2가 새로 쓰는
  길을 막았지만 ADR-45 D5가 일부러 열어 둔 **정정 이벤트**는 여전히
  `eventCount`를 늘린다. `baselineDrift`를 붙일 자리는 상황 상세(CLOSED일 때)가
  정본이고 평가보고서가 재인용이며, 평가의 `metricsStale`과는 **기준 시점이
  다르다** — 종료와 평가 사이에 정정이 붙으면 `baselineDrift=true`·
  `metricsStale=false`가 되므로 둘을 합칠 수 없다.
- **종료 사건 payload가 기준선 전체를 싣지 않는다**(한계 2). 구성요소별 사유를
  내려면 새 종료 사건부터 전체 기준선을 실어야 한다. 이미 닫힌 훈련은 사건이
  불변이므로 해시 불일치 boolean밖에 낼 수 없다.
- **워커의 42501 국소 처리가 전파 릴레이에만 있다**(한계 3).
- **V-1 / OB-19**.
