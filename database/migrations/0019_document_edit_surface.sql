-- 0019_document_edit_surface.sql (CC-150) — 편집 표면의 물리 스키마.
--
-- 범위. 이 마이그레이션은 네 가지를 한다.
--   1) document_autosave 신설 (설계 §6 물리 DDL 누락 결함 해소, 61번째 테이블)
--   2) Revision/ChangeSet의 계보·출처 컬럼 추가
--   3) 0003이 하나도 두지 않은 CHECK 제약으로 상태 집합과 해시 형식을 닫는다
--   4) 0018이 실측으로 남긴 필수 인덱스 과제를 유일성 키로 종결한다
--
-- ===========================================================================
-- §0. document_autosave 신설의 근거 — generated_block(ADR-27 D2)과 동일 결함
-- ===========================================================================
-- 설계 10에서 이 테이블의 이름은 네 곳에서 정본으로 확정돼 있다.
--   * §3.4 UNE-DOC-009 (POST /documents/{documentId}/autosaves)의 "관련 테이블"
--     칸이 `document_autosave` 하나를 적는다.
--   * SEQ-SCR-PLAN-007 / SEQ-SCR-PLAN-008 / SEQ-SCR-JRN-003 세 시퀀스의
--     "DB Write" 목록이 모두 `document_autosave`를 포함한다.
--   * §7 UFR 추적표(US-PLAN-012~020, US-PLAN-016~019, US-SIT-032/033 행)가
--     화면·API·테이블 축에서 같은 이름을 적는다.
--   * contracts/openapi/une-platform-api-v1.yaml의 une_doc_009 x-db-tables가
--     `document_autosave` 한 줄이다.
-- 그런데 §6 물리 DDL 표(6.17~6.26)에는 이 테이블의 컬럼 정의가 없다.
-- 이름·소유 API·시퀀스·추적표·OpenAPI는 정본인데 컬럼 정의만 빠진, ADR-21이
-- `plan`에서, 0015 §1이 `generation_job`에서, ADR-27 D2가 `generated_block`
-- 에서 이미 해소한 것과 **완전히 동일한 유형의 기준선 결함**이다. 같은 방식
-- (누락된 DDL을 이름·API 계약이 요구하는 최소 형태로 복원)으로 해소한다.
-- 이로써 기준선 테이블 수는 60 → 61이 된다(57 설계 + role_permission(ADR-22)
-- + api_idempotency(ADR-23) + generated_block(ADR-27) + document_autosave).
--
-- 컬럼은 UNE-DOC-009의 계약이 그대로 요구하는 것들이다: 요청이
-- `baseRevisionId, delta, clientMutationId`이고 응답이 `AutosaveReceipt`이며
-- 오류가 DOC-409-003(충돌) 하나다. 즉 이 테이블은 (기준 리비전, 델타,
-- 멱등키, 판정 결과)를 남기는 **명령 저널**이지 문서 본문의 사본이 아니다.
-- 본문은 document_revision.ir_json 하나뿐이라는 원칙을 여기서 깨지 않는다.
--
-- change_set과 별개인 이유. US-PLAN-020 A-01은 "네트워크 일시중단 → 로컬
-- queue에 저장하고 재연결 후 **순서대로** 동기화"를 요구한다. 즉 자동저장은
-- (a) 도착 순서가 클라이언트가 만든 순서와 다를 수 있고, (b) 늦게 도착한
-- 항목이 이미 무의미해졌을 수 있으며(SUPERSEDED), (c) 충돌해도 편집 세션을
-- 끊지 않아야 한다(CONFLICT는 200 계열 수신확인이 아니라 DOC-409-003이지만,
-- 그 판정 자체가 기록으로 남아야 사용자에게 "저장 실패"를 표시할 수 있다 —
-- AC-02). change_set은 이와 반대로 "적용되면 리비전이 생기고 아니면 아무 일도
-- 없었다"는 원자성 모델(설계 07 §1.9)이라 CONFLICT/SUPERSEDED라는 중간
-- 결과를 담을 자리가 없다. 두 모델을 한 테이블에 겹치면 어느 쪽 불변식도
-- 지킬 수 없다.

-- ---------------------------------------------------------------------------
-- 1. document_autosave 테이블
-- ---------------------------------------------------------------------------
-- IF NOT EXISTS를 쓰지 않는다(0017 §1과 같은 취지): 이 이름의 테이블이 이미
-- 있다면 본 마이그레이션이 아닌 경로로 만들어진 스키마이므로 조용히 넘어가면
-- 안 된다.
CREATE TABLE document_autosave (
  autosave_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid NOT NULL,
  base_revision_id uuid NOT NULL,
  client_mutation_id varchar(100) NOT NULL,
  seq bigint NOT NULL,
  delta_json jsonb NOT NULL,
  result_revision_id uuid,
  status varchar(20) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE document_autosave IS '자동저장 명령 저널(UNE-DOC-009, US-PLAN-020)';
COMMENT ON COLUMN document_autosave.autosave_id IS '자동저장';
COMMENT ON COLUMN document_autosave.document_id IS '문서';
COMMENT ON COLUMN document_autosave.base_revision_id IS '기준 Revision';
COMMENT ON COLUMN document_autosave.client_mutation_id IS '클라이언트 멱등키';
COMMENT ON COLUMN document_autosave.seq IS '클라이언트 큐 순번(오프라인 재동기화 순서)';
COMMENT ON COLUMN document_autosave.delta_json IS '변경 batch(delta)';
COMMENT ON COLUMN document_autosave.result_revision_id IS '결과 Revision(ACCEPTED일 때)';
COMMENT ON COLUMN document_autosave.status IS 'ACCEPTED/CONFLICT/SUPERSEDED';
COMMENT ON COLUMN document_autosave.created_by IS '사용자';
COMMENT ON COLUMN document_autosave.created_at IS '수신';

-- 상태 집합은 DB에서 닫는다(0015 §2 / 0017 §2 관행).
--   ACCEPTED   : 새 리비전이 생겼다(result_revision_id가 그것을 가리킨다).
--   CONFLICT   : baseRevisionId가 최신이 아니었다 → DOC-409-003.
--   SUPERSEDED : 도착했을 때 이미 같은 문서의 더 나중 자동저장이 반영돼 있었다
--                (A-01 재동기화 경로). 실패가 아니라 무해한 폐기다.
ALTER TABLE document_autosave ADD CONSTRAINT ck_document_autosave_status
  CHECK (status IN ('ACCEPTED', 'CONFLICT', 'SUPERSEDED'));

-- 외래키(0007/0017의 명명·DEFERRABLE 패턴 그대로). 기준선 전체가
-- DEFERRABLE INITIALLY DEFERRED이며, 자동저장 수락은 "새 리비전 INSERT +
-- 자동저장 행 INSERT"를 한 트랜잭션에서 쓰므로 같은 성질이 필요하다.
ALTER TABLE document_autosave ADD CONSTRAINT fk_document_autosave_document_id
  FOREIGN KEY (document_id) REFERENCES document(document_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE document_autosave ADD CONSTRAINT fk_document_autosave_base_revision_id
  FOREIGN KEY (base_revision_id) REFERENCES document_revision(revision_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE document_autosave ADD CONSTRAINT fk_document_autosave_result_revision_id
  FOREIGN KEY (result_revision_id) REFERENCES document_revision(revision_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE document_autosave ADD CONSTRAINT fk_document_autosave_created_by
  FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED;

-- 멱등. US-PLAN-020 정상흐름 #1의 "중복 command는 idempotency로 제거한다"와
-- CLAUDE.md의 "모든 재시도 가능한 create/dispatch/export 요청은 멱등키를
-- 쓴다"를 DB에서 보장한다. 오프라인 큐는 같은 항목을 여러 번 재전송하는 것이
-- 정상 동작이므로, 이 유일성이 없으면 재전송이 곧 리비전 중복 생성이 된다.
-- 범위를 document_id로 한정하는 이유: clientMutationId는 클라이언트가 문서
-- 편집 세션 안에서 만드는 값이라 전역 유일성을 요구할 근거가 없다.
CREATE UNIQUE INDEX uk_document_autosave_mutation
  ON document_autosave(document_id, client_mutation_id);

-- 문서별 최신 자동저장 조회(수신확인 재조회, SUPERSEDED 판정). seq DESC를
-- 명시해 "가장 나중 순번" 질의가 역방향 스캔 없이 선두에서 끝나게 한다.
CREATE INDEX ix_document_autosave_doc_seq
  ON document_autosave(document_id, seq DESC);

-- RLS: 0018 패턴 그대로 — tenant_id 컬럼을 두지 않고 부모 document까지
-- EXISTS로 조인하며, 명시적인 tenant_id 술어를 함께 남겨 부모 정책이 향후
-- 완화되더라도 새지 않게 한다. PERMISSIVE / TO PUBLIC / FOR ALL이고
-- ENABLE + FORCE를 함께 건다(테이블 소유자도 우회하지 못한다). 디스패치
-- 스코프(une_current_tenant_id() IS NULL)에서는 항상 거짓 → 0행/쓰기 거부.
-- delta_json은 사용자가 방금 친 문장 그대로이므로 본문과 같은 등급이다.
ALTER TABLE document_autosave ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_autosave FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_document_autosave_tenant ON document_autosave;
CREATE POLICY p_document_autosave_tenant ON document_autosave
  USING (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = document_autosave.document_id
      AND d.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM document d
    WHERE d.document_id = document_autosave.document_id
      AND d.tenant_id = une_current_tenant_id()
  ));

-- 권한. 0011의 ALTER DEFAULT PRIVILEGES가 신규 테이블에 SELECT/INSERT/UPDATE/
-- DELETE를 상속시키지만 그 상속은 0011을 실행한 주체에 매인 값이므로, 의도한
-- 종단 상태를 주체와 무관하게 성립시키기 위해 명시 GRANT를 함께 둔다
-- (0017 §6과 동일한 멱등 재확인).
--   UPDATE가 필요한 이유: 나중 자동저장이 반영되면 앞선 행을 SUPERSEDED로
--   표시한다. 새 행을 넣는 방식은 쓰지 않는다 — 판정 대상은 이미 수신한
--   그 명령이지 새 명령이 아니다.
--   DELETE를 주지 않는 이유: US-PLAN-020 AC-03이 "command journal과 저장
--   artifact hash로 변경을 재현한다"를 인수기준으로 두므로, 자동저장 기록은
--   감사 대상이다. 정정은 새 행이거나 상태 표시이지 삭제가 아니다
--   (0017 §6 generated_block, 0015 §5 job_event와 같은 취지).
GRANT SELECT, INSERT, UPDATE ON document_autosave TO une_app;
REVOKE DELETE ON document_autosave FROM une_app;

-- une_worker: 권한을 주지 않는다. 자동저장은 사용자 요청 경로에서만 발생하며
-- (UNE-DOC-009는 동기 API다) 워커가 닿을 이유가 없다. 0018 §역할 영향이 문서
-- 계열 여덟 테이블에 대해 고정한 상태 — "워커는 RLS 이전에 42501로 막힌다" —
-- 를 신규 테이블에도 그대로 유지한다.

-- ===========================================================================
-- §2. 컬럼 추가 — Revision/ChangeSet의 출처와 계보
-- ===========================================================================
-- 안전성. 아래 네 컬럼이 붙는 두 테이블은 현재 **0행**이다(적용 시점 실측:
-- document_revision 0, change_set 0). 따라서 NOT NULL + DEFAULT 추가에
-- 데이터 마이그레이션이 필요 없고, PostgreSQL 11+ 의 non-volatile default
-- 최적화로 테이블 재작성도 일어나지 않는다. 파괴적 연산은 없다.

-- ---------------------------------------------------------------------------
-- 2.1 document_revision.origin — 리비전이 왜 생겼는가
-- ---------------------------------------------------------------------------
-- change_summary(text)는 사람이 읽는 자유서술이라 질의 술어가 될 수 없다.
-- 그런데 CC-150의 여러 경로가 "이 리비전이 어떤 경로로 만들어졌는가"에 따라
-- 다르게 동작한다: RESTORE는 과거 리비전의 복사본이고(US-PLAN-020 AC-01
-- "복원은 과거 revision을 변경하지 않고 새 head revision을 생성한다"),
-- MATERIALIZE는 generated_block → document_block 투영이며(ADR-27 D2),
-- AUTOSAVE는 사용자가 명시적으로 저장하지 않은 중간 상태다.
-- CHANGESET을 기본값으로 둔다 — 리비전을 만드는 정규 경로가 ChangeSet이고
-- (설계 07 §1.9 "문서가 바뀌는 유일한 방법"), 나머지는 그것의 특수한 출처다.
ALTER TABLE document_revision ADD COLUMN origin varchar(20) DEFAULT 'CHANGESET' NOT NULL;
COMMENT ON COLUMN document_revision.origin IS '리비전 출처 IMPORT/MATERIALIZE/CHANGESET/AUTOSAVE/UNDO/REDO/RESTORE';

-- ---------------------------------------------------------------------------
-- 2.2 document_revision.checkpoint_label — 버전이력에서 조회 가능한 시점
-- ---------------------------------------------------------------------------
-- US-PLAN-020 정상흐름 #3: "사용자는 버전이력에서 생성전/목차확정/초안완료/
-- 수동 checkpoint를 조회한다." 대체흐름 A-02: "목차확정/본문완료/최종저장 시
-- 자동 label." 이 요구를 change_summary 텍스트 스캔으로 대신하는 안은 기각한다
-- — 자유서술을 LIKE로 긁는 것은 질의 경로가 아니라 우연이고, 사용자가 요약을
-- 고쳐 쓰면 이력 조회가 조용히 비어 버린다.
--
-- CHECK를 걸지 않는다. #3의 네 번째 항목이 "수동 checkpoint"이고 A-02의
-- 자동 label 세 종류와 #3의 열거(생성전/목차확정/초안완료)가 이미 서로 다르다
-- (본문완료/최종저장 대 초안완료). 즉 어휘가 정본에서 닫혀 있지 않다.
-- 닫히지 않은 집합을 DB에서 닫으면 사용자 지정 label을 기제로 금지하게 된다.
-- 부분 인덱스는 두지 않는다 — checkpoint 조회는 항상 문서 범위 안에서
-- 일어나고, 그 범위는 아래 §4가 확정하는 uk_document_revision_no가 이미 좁힌다.
ALTER TABLE document_revision ADD COLUMN checkpoint_label varchar(100);
COMMENT ON COLUMN document_revision.checkpoint_label IS 'Checkpoint 라벨(자동/수동, 없으면 NULL)';

-- ---------------------------------------------------------------------------
-- 2.3 change_set.origin — 편집을 누가/무엇이 시작했는가
-- ---------------------------------------------------------------------------
-- packages/domain/src/document/change-set.ts의 CHANGE_SET_ORIGINS 7종과
-- 정확히 같은 집합이다. 설계 07 §1.9는 Undo/Redo에 별도 스택을 두지 않고
-- AI 편집과 사용자 편집을 한 스택에 둔다 — 그래서 "어느 스택인가"가 아니라
-- "어디서 왔는가"가 감사와 표시의 유일한 근거가 된다.
-- 기본값 USER: 출처를 적지 않은 편집은 사용자 편집으로 본다(가장 보수적인
-- 해석 — AI 산출물이 실수로 사람의 편집처럼 보이는 방향이 아니라 그 반대다).
ALTER TABLE change_set ADD COLUMN origin varchar(20) DEFAULT 'USER' NOT NULL;
COMMENT ON COLUMN change_set.origin IS '변경 출처 USER/AI/AUTOSAVE/UNDO/REDO/RESTORE/MATERIALIZE';

-- ---------------------------------------------------------------------------
-- 2.4 change_set.undoes_change_set_id — Undo 계보
-- ---------------------------------------------------------------------------
-- Undo는 새 ChangeSet이다(정정은 새 버전이며 감사 이력을 덮어쓰지 않는다 —
-- CLAUDE.md 비협상 규칙). 그러면 "이 ChangeSet은 무엇을 되돌린 것인가"라는
-- 간선이 필요하다. 이것이 없으면 Redo 대상 판정과 "이미 되돌린 것을 또
-- 되돌리려는" 요청 거부(CHANGE_REJECTION_REASONS의 UNDO_CONFLICT)를 DB에서
-- 질의할 수 없고 애플리케이션 메모리에만 존재하게 된다.
--
-- selection_json에 묻는 대안은 기각한다. selection은 "사용자가 어디를
-- 선택했는가"(SelectionEnvelope)이고 계보는 "어떤 명령을 무효화하는가"다.
-- 서로 다른 개념을 한 jsonb에 겹치면 (a) 의미가 흐려지고 (b) 인덱스 가능한
-- 술어가 되지 않아 계보 역추적이 전수 스캔이 된다.
--
-- self FK. 되돌림 대상은 반드시 같은 테이블의 실재하는 행이다. 문서 간
-- 참조는 §3의 RLS 정책이 이미 막는다(두 행 모두 같은 document를 통해
-- 테넌트를 증명하지만, 서로 다른 document일 수는 있다 — 그 조합의 금지는
-- 상태기계의 몫이지 스키마의 몫이 아니다).
ALTER TABLE change_set ADD COLUMN undoes_change_set_id uuid;
COMMENT ON COLUMN change_set.undoes_change_set_id IS '되돌림 대상 ChangeSet(Undo 계보)';
ALTER TABLE change_set ADD CONSTRAINT fk_change_set_undoes_change_set_id
  FOREIGN KEY (undoes_change_set_id) REFERENCES change_set(change_set_id) DEFERRABLE INITIALLY DEFERRED;

-- ===========================================================================
-- §3. CHECK 제약 — 0003이 하나도 두지 않은 것을 닫는다
-- ===========================================================================
-- 0003은 기준선 물리설계에서 그대로 생성돼 CHECK가 하나도 없다. 0014 §plan,
-- 0015 §2, 0017 §2가 각자의 Work Item 범위에서 상태 집합을 DB로 닫아 온
-- 관행을 문서 계열에 적용한다(.claude/rules/database.md "안정된 상태 집합에
-- CHECK 제약을 쓴다").
--
-- NOT VALID를 쓰지 않는다. 대상 테이블이 모두 0행이라 즉시 검증이 순간에
-- 끝나며, NOT VALID로 남기면 "이미 있는 행은 검사되지 않았다"는 약한 상태가
-- 영구히 남는다. 0행일 때 완전 검증을 택하는 것이 강한 쪽이다.
--
-- 아래에 없는 컬럼은 의도적으로 뺐다(근거는 §6).

-- 3.1 document.status — 설계 10 §6.17 doc_document와 0003 COMMENT가 정확히
--   일치한다(EDITING/REVIEW/APPROVED). 설계 09 §4의 "계획서 Document" 상태표
--   13종은 이 컬럼이 아니라 plan.status의 것이다(값 집합이
--   packages/domain/src/plan/plan-status.ts의 PLAN_STATUSES와 글자 단위로
--   같다). 표 제목이 두 애그리거트를 겹쳐 부르는 것은 설계 09의 표기 문제이며,
--   우선순위(3. API/DB 상세설계 > 5. 화면·시나리오 설계)로 해소된다.
ALTER TABLE document ADD CONSTRAINT ck_document_status
  CHECK (status IN ('EDITING', 'REVIEW', 'APPROVED'));

-- 3.2 change_set.status — 설계 10 §6.20과 0003 COMMENT가 APPLIED/REJECTED로
--   일치한다. 설계 05는 같은 개념에 대해 서로 다른 세 어휘를 적는다
--   (§상태모델표 DRAFT→VALIDATING→READY→APPLIED/REJECTED/CONFLICTED/
--   ROLLED_BACK, US-PLAN-016 APPLIED/CONFLICT/ERROR, US-PLAN-017
--   APPLIED/REJECTED/CONFLICT) — 자기들끼리도 어긋나므로 하위 우선순위
--   문서를 채택할 근거가 없다. 우선순위 3·4가 일치하는 두 값으로 닫는다.
--   이것은 모델과도 정합적이다: ChangeSet은 원자적이라(설계 07 §1.9
--   "on error: rollback() + no partial document mutation") 중간 상태가
--   지속될 수 없고, 충돌은 REJECTED의 한 사유일 뿐 별도 종점이 아니다.
--   충돌·무해폐기 같은 비원자적 결과가 필요한 경로는 §1의 document_autosave가
--   맡는다. 어휘 확장이 필요해지면 전방 마이그레이션 한 줄이다.
ALTER TABLE change_set ADD CONSTRAINT ck_change_set_status
  CHECK (status IN ('APPLIED', 'REJECTED'));

-- 3.3 change_set.origin / document_revision.origin — §2에서 추가한 컬럼.
--   change_set.origin은 packages/domain의 CHANGE_SET_ORIGINS 7종과 동일하다.
--   document_revision.origin은 그와 다른 집합이다(USER/AI 대신 IMPORT/
--   CHANGESET): ChangeSet의 출처는 "누가 요청했나"이고 Revision의 출처는
--   "어떤 기제가 만들었나"라서 축이 다르다. 겹치는 다섯 값(AUTOSAVE, UNDO,
--   REDO, RESTORE, MATERIALIZE)은 두 축에서 같은 뜻이다.
ALTER TABLE change_set ADD CONSTRAINT ck_change_set_origin
  CHECK (origin IN ('USER', 'AI', 'AUTOSAVE', 'UNDO', 'REDO', 'RESTORE', 'MATERIALIZE'));
ALTER TABLE document_revision ADD CONSTRAINT ck_document_revision_origin
  CHECK (origin IN ('IMPORT', 'MATERIALIZE', 'CHANGESET', 'AUTOSAVE', 'UNDO', 'REDO', 'RESTORE'));

-- 3.4 document_block.protection_state — 0003 COMMENT / 설계 10 §6.19 /
--   0017 §2 ck_generated_block_protection_state 세 곳이 모두
--   NONE/USER_LOCKED/SYSTEM_LOCKED로 일치한다(실측 확인). 어휘가 같아야
--   generated_block → document_block 투영에서 보호 상태가 변환 없이 이동한다.
--   "사용자가 편집한 블록은 재생성으로부터 보호된다"(CLAUDE.md)의 표현 수단이
--   이 컬럼이므로, 어휘 밖의 값이 들어오면 보호 판정이 조용히 무력화된다.
ALTER TABLE document_block ADD CONSTRAINT ck_document_block_protection_state
  CHECK (protection_state IN ('NONE', 'USER_LOCKED', 'SYSTEM_LOCKED'));

-- 3.5 change_operation.operation_type — 설계 07 §1.9의 8종 표가 정본이고,
--   packages/domain/src/document/change-set.ts의 CHANGE_OPERATION_TYPES가
--   그것을 그대로 옮긴다("이 목록은 ADR 없이 늘어나지 않는다 — 모든 소비자가
--   이 값으로 전수 분기한다"). 설계 10 §6.21의 "insertText 등"은 닫힌 집합이
--   아니라 예시 한 개다(단수 camelCase 예시 + "등"). 예시와 정본 집합은
--   충돌하지 않으므로 우선순위 판정이 필요 없다.
--   실행기·역연산 생성기·Diff·감사가 모두 이 값으로 전수 분기하므로, 어휘
--   밖의 값이 저장되면 Undo가 역연산을 만들지 못한 채 실패한다.
ALTER TABLE change_operation ADD CONSTRAINT ck_change_operation_type
  CHECK (operation_type IN (
    'INSERT_BLOCKS', 'REPLACE_RANGE', 'DELETE_RANGE', 'SPLIT_PARAGRAPH',
    'MERGE_PARAGRAPHS', 'MOVE_BLOCK', 'APPLY_STYLE_ROLE', 'TABLE_PATCH'
  ));

-- 3.6 해시 형식. 세 컬럼 모두 char(64)이고 소문자 16진 SHA-256을 담는다
--   (0017 §2 ck_generated_block_content_hash와 동일 패턴). char(64)는 공백
--   패딩되므로 64자보다 짧은 값은 패딩된 채로 정규식에 걸려 거부된다 —
--   즉 이 CHECK는 길이 검사도 겸한다. 대문자 16진을 막는 것이 핵심이다:
--   같은 내용이 두 표기로 저장되면 해시 비교가 조용히 실패한다.
ALTER TABLE document_revision ADD CONSTRAINT ck_document_revision_ir_hash
  CHECK (ir_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE template_profile ADD CONSTRAINT ck_template_profile_analysis_hash
  CHECK (analysis_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE style_prototype ADD CONSTRAINT ck_style_prototype_fingerprint
  CHECK (style_fingerprint ~ '^[0-9a-f]{64}$');

-- 3.7 revision_no > 0. uk_document_revision_no(0007)는 유일성만 보장하고
--   부호는 보지 않는다. 리비전 번호는 1부터 증가하는 순번이며(0003 COMMENT
--   '순번'), 0이나 음수는 "이전 리비전"을 표현하는 수단이 아니라 오류다
--   — 계보는 parent_revision_id가 표현한다. 0017 §2
--   ck_generated_block_generation_no와 같은 취지.
ALTER TABLE document_revision ADD CONSTRAINT ck_document_revision_no
  CHECK (revision_no > 0);

-- ===========================================================================
-- §4. 인덱스 — 0018이 실측으로 남긴 필수 과제의 종결
-- ===========================================================================
-- 0018 헤더의 실측: RLS 적용 후 `SELECT * FROM document_block
-- WHERE revision_id=$1 ORDER BY sort_order`가 80,000행 규모에서 3.0~3.7 ms →
-- 87~139 ms(약 30배)가 됐다. 원인은 부모 조회가 아니라 **인덱스 없는 자식
-- 테이블 전수 스캔에 SubPlan을 포함한 qual을 얹는 것 자체**다. 0018은 이
-- 인덱스를 "CC-150이 반드시 추가해야 하는 유일성 키의 선두 컬럼이 정확히
-- 이 FK 컬럼들이라 지금 만들면 곧 중복이 된다"는 이유로 유보하며, 유일성
-- 의미의 판정을 CC-150에 넘겼다. 아래가 그 판정이다.
--
-- 재측정(본 마이그레이션 작성 시점, PostgreSQL 16.9, 0018과 동일 규모:
-- document 80 / document_revision 2,000 / document_block 80,000 /
-- change_set 800 / change_operation 4,000, une_app + RLS 적용,
-- EXPLAIN (ANALYZE, TIMING OFF) 3회):
--   * document_block  revision_id 조회 : 173~190 ms → 1.17~1.24 ms
--       Seq Scan on document_block → Bitmap Index Scan on
--       uk_document_block_stable_key. 약 150배.
--   * change_set      멱등 재조회      : 0.096~0.105 ms → 0.026~0.040 ms
--       Seq Scan on change_set → Index Scan using uk_change_set_mutation.
--       (800행이라 절대시간 차는 작지만 계획 형태가 전수 스캔에서 벗어난다 —
--        이 경로는 모든 편집 요청마다 한 번씩 탄다.)
--   * change_operation 순서 조회       : 0.451~0.568 ms → 0.275~0.287 ms
--       Seq Scan on change_operation → Bitmap Index Scan on
--       uk_change_operation_order.
--   * document_revision 최신 리비전    : 0.059 ms → 0.059 ms (변화 없음)
-- 절대시간은 측정 장비에 따라 다르다(0018은 87~139 ms, 여기서는 173~190 ms를
-- 관측했다). 비교는 같은 장비·같은 세션 안의 전/후만 의미가 있다.

-- ---------------------------------------------------------------------------
-- 4.1 document_block: stable_block_key의 유일성 범위 = **리비전 안**
-- ---------------------------------------------------------------------------
-- 판정 근거.
--   (a) 0003의 COMMENT는 이 컬럼을 '안정 ID'라 부른다. 안정하다는 것은
--       리비전이 바뀌어도 같은 문단이 같은 키를 유지한다는 뜻이다(설계 07
--       §1.3 ParagraphIR.paragraphId "문단 단위 안정 ID", ADR-30 D3 "삽입/
--       이동은 raw XML 앵커가 아니라 안정 ID에 대해 표현된다", 그리고
--       ChangeSetResult.aliases가 SPLIT/MERGE로 생긴 키 재매핑을 실어
--       "이전 리비전에서 잡은 선택영역"을 다시 읽게 하는 구조).
--   (b) document_block은 revision_id만 참조하고 document_id 컬럼이 없다.
--       한 리비전은 그 시점 문서의 블록 집합 전체를 담는다.
--   (a)+(b) ⇒ 같은 키는 문서 안에서 리비전 수만큼 반복되는 것이 **정상**이다.
--       따라서 문서 범위 유일성은 성립할 수 없고(성립시키면 안정 ID가
--       리비전을 넘어 살아남는 것을 스키마가 금지하게 된다), 성립 가능한
--       유일성은 (revision_id, stable_block_key) 하나뿐이다.
--       그리고 이것이 유일성이라는 사실 자체가 의미가 있다: 한 리비전 안에
--       같은 안정 ID가 둘이면 선택영역 해석이 비결정적이 된다.
--
-- 조회 경로를 덮는가 — 덮는다. 선두 컬럼이 revision_id이므로 0018이 측정한
-- `WHERE revision_id = $1` 이 그대로 이 인덱스를 탄다(위 재측정 결과).
-- 별도의 (revision_id, sort_order) 인덱스는 만들지 않는다. 실측에서
-- 임시로 함께 만들어 비교했을 때 1.166~1.182 ms 대 1.168~1.236 ms로 차이가
-- 없었다 — 리비전당 블록 수 규모에서는 정렬이 메모리 quicksort 27 kB로
-- 끝나므로 정렬용 인덱스가 벌어들이는 것이 없고, 문서 실체화(리비전마다 블록
-- 전체 INSERT)라는 쓰기 경로에 인덱스 유지 비용만 더한다.
CREATE UNIQUE INDEX uk_document_block_stable_key
  ON document_block(revision_id, stable_block_key);

-- ---------------------------------------------------------------------------
-- 4.2 change_set: client_mutation_id 멱등 유일성
-- ---------------------------------------------------------------------------
-- 0003은 client_mutation_id를 NOT NULL로 두고 COMMENT에 '클라이언트 멱등키'라
-- 적었지만 유일성을 걸지 않았다 — 멱등키가 중복 가능하면 멱등이 아니다.
-- 범위는 document_id: ChangeSetRequest.clientMutationId는 문서 편집 세션
-- 안에서 만들어지는 값이고(설계 07 §1.9 "재전송된 제출의 멱등 앵커"),
-- 전역 유일성을 요구할 근거가 정본 어디에도 없다. §1의
-- uk_document_autosave_mutation과 같은 범위를 쓴다 — 두 경로의 재전송
-- 의미가 같아야 클라이언트가 하나의 큐로 둘을 다룰 수 있다.
CREATE UNIQUE INDEX uk_change_set_mutation
  ON change_set(document_id, client_mutation_id);

-- ---------------------------------------------------------------------------
-- 4.3 change_operation: (change_set_id, operation_order)
-- ---------------------------------------------------------------------------
-- 컬럼명은 0003 실측 확인(operation_order int NOT NULL, COMMENT '순서').
-- 유일성인 이유: ChangeOperation.order는 "ChangeSet 안의 위치이며 연산은 이
-- 순서로 적용되고 역연산은 역순으로 적용된다"(change-set.ts). 같은 순번이
-- 둘이면 적용 순서가 비결정적이고 invert∘apply == identity(ADR-30 D6)가
-- 깨진다. 순서가 곧 의미인 자리에서는 유일성이 성능이 아니라 정확성이다.
CREATE UNIQUE INDEX uk_change_operation_order
  ON change_operation(change_set_id, operation_order);

-- ---------------------------------------------------------------------------
-- 4.4 document_revision: 신규 인덱스 없음 (중복이므로 만들지 않는다)
-- ---------------------------------------------------------------------------
-- 0007의 `uk_document_revision_no ON document_revision(document_id,
-- revision_no)`가 이미 (document_id, revision_no DESC) 경로를 덮는다.
-- B-tree는 역방향 스캔이 가능하므로 DESC 전용 인덱스가 따로 필요하지 않다.
-- 0018이 이미 `Index Scan Backward using uk_document_revision_no`를 관측했고
-- 본 마이그레이션의 재측정에서도 0.059 ms로 동일했다. 같은 컬럼 순서의
-- 인덱스를 하나 더 만드는 것은 순수한 중복 — 쓰기 비용만 늘고 읽기는
-- 그대로다. .claude/rules/database.md의 "문서화된 접근 경로에 근거해 인덱스를
-- 추가하고 쿼리 플랜으로 확인한다"에 따라 **만들지 않는 것**을 기록한다.

-- ===========================================================================
-- §5. 권한 — 본 마이그레이션이 바꾸지 않는 것
-- ===========================================================================
-- 신규 테이블(§1)을 제외하면 DML 권한을 바꾸지 않는다. 0018 §권한이
-- document_revision / change_operation의 append-only REVOKE를 "상태기계를 손에
-- 쥔 CC-150"에 넘겼으나, 지금 판단하면 아직 이르다:
--   * document_revision: checkpoint_label은 사용자가 나중에 붙이거나 고칠 수
--     있는 라벨이다(US-PLAN-020 #3의 "수동 checkpoint"). UPDATE를 회수하면
--     그 경로가 막힌다. 본문(ir_json/ir_hash)의 불변성은 권한이 아니라
--     "정정은 새 리비전"이라는 규칙과 감사 로그로 지킨다.
--   * change_operation: 0017 §7이 generated_block에 쓴 것과 같은 컬럼 단위
--     트리거로 before_json/after_json만 잠그는 것이 정확한 수단이지만,
--     그것은 ChangeSetExecutor의 쓰기 순서(연산 행을 먼저 넣고 역연산을 나중에
--     채우는지 한 번에 넣는지)가 확정된 뒤에 걸어야 헛되이 막지 않는다.
--     그 결정은 실행기 구현 Work Item의 몫이며, 여기서 미리 잠그면 0018이
--     경계한 "다음 Work Item을 막는" 상황이 그대로 재현된다.
-- 이 유보는 격리(§1의 RLS)와 무관하다 — 어느 행에 닿을 수 있는가는 이미 닫혀
-- 있고, 남은 것은 자기 테넌트 안에서 무엇을 할 수 있는가뿐이다.

-- ===========================================================================
-- §6. 넣지 않은 CHECK와 그 이유
-- ===========================================================================
--   * validation_report.target_type — 0018 §8이 이 컬럼의 다형 참조를
--     fail-closed 정책으로 다루면서 어휘 확장을 CC-160(Track A/B 검증 보고서)
--     범위로 유보했다. 그 판단을 존중한다. 지금 DOCUMENT/EXPORT로 닫으면
--     0018이 정책 층에서 의도적으로 남긴 "새 target_type은 조용히 새지 않고
--     즉시 실패한다"는 관측 가능한 상태가 제약 위반으로 바뀌어, CC-160이
--     확장을 검토할 근거 자체가 사라진다.
--   * template_profile.analysis_status — 정본이 갈린다. 설계 10 §6.22는
--     '상태'라고만 적고 값을 열거하지 않으며, ADR v1.1 §8.6 G15-1 계열
--     어휘(packages/domain의 DOCUMENT_COMPATIBILITY_VERDICTS =
--     AUTO/CONFIRM/LIMITED/REJECT)와 설계 09 §4 Template Profile 상태표
--     (DRAFT/ANALYZING/CONFIRM_REQUIRED/CONFIRMED/REVIEW/PUBLISHED/LIMITED/
--     DEPRECATED/REJECTED)가 서로 다른 집합이다. 게다가 이 컬럼은 CC-140이
--     쓰는 자리다(0018 §5). 확인 불가하므로 넣지 않고 보고한다.
--   * export_job.status / format, validation_report.track / status —
--     CC-160 소유 영역이다. 0018이 격리만 닫고 어휘를 건드리지 않은 경계를
--     그대로 따른다.
--   * document_revision.checkpoint_label — §2.2 참조(정본에서 닫힌 집합이
--     아니다).
--   * document_autosave.seq의 하한 — 클라이언트 큐 순번이 0부터인지 1부터인지
--     정본에 없다. 0을 금지하면 0-based 클라이언트를 기제로 막게 되므로
--     넣지 않는다.
--   * document_autosave의 status × result_revision_id 상관 제약
--     (ACCEPTED면 결과 리비전이 있어야 한다 등) — 그럴듯하지만 정본에 없다.
--     UNE-DOC-009의 계약은 AutosaveReceipt의 형태를 정하지 않았고
--     (GenericResponse), 수락 시점과 리비전 확정 시점이 같은 트랜잭션인지도
--     실행기 구현이 정한다. 상태 상관식은 그 결정 뒤에 건다.
