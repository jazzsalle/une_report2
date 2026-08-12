-- 0042_journal_projection_and_review.sql (CC-300)
--
-- 상황일지 Projection·고정 사실·검토·승인. 설계 09 SCR-JNL 계열,
-- 설계 10 UNE-JNL-005~011.
--
-- 0006이 `journal`과 `journal_projection_item`을 만들었고 **아무도 쓰지
-- 않았다.** CC-290이 `journal_projection_item`을 "CC-300의 것"이라며 남겨
-- 두었고 RLS 커버리지 목록에도 둘이 남아 있다 — 여기서 닫는다.
--
-- 테이블 66 → 68 (`journal_review_request`, `journal_approval`).

-- ===========================================================================
-- §1. 일지 상태 — 도달 가능한 것만
-- ===========================================================================
-- 설계 09 Journal 상태표는 여섯을 적는다: CONFIGURING/PROJECTING/DRAFT/
-- REVIEW/CHANGES_REQUESTED/APPROVED.
--
-- 앞의 둘을 넣지 않는다. **투영이 동기이기 때문이다** — UNE-JNL-005가 Journal을
-- 돌려주고 그때 이미 사실칸이 채워져 있다. 비동기 잡으로 만들면 CONFIGURING과
-- PROJECTING이 생기지만, 투영은 이 저장소 안의 데이터를 읽어 접는 계산이라
-- 바깥을 기다리지 않는다(SOP 생성·계획서 생성이 잡인 것은 T3Q·UNI를 기다리기
-- 때문이다). 값을 만드는 코드가 없는 채로 어휘만 남기지 않는다(0022 §1).
ALTER TABLE journal DROP CONSTRAINT IF EXISTS ck_journal_status;
ALTER TABLE journal ADD CONSTRAINT ck_journal_status
  CHECK (status IN ('DRAFT', 'REVIEW', 'CHANGES_REQUESTED', 'APPROVED'));
COMMENT ON COLUMN journal.status IS
  'DRAFT/REVIEW/CHANGES_REQUESTED/APPROVED. CONFIGURING·PROJECTING은 투영이 동기라 도달하지 않는다(0042 §1)';

ALTER TABLE journal DROP CONSTRAINT IF EXISTS ck_journal_period;
ALTER TABLE journal ADD CONSTRAINT ck_journal_period
  CHECK (period_start < period_end);

ALTER TABLE journal DROP CONSTRAINT IF EXISTS ck_journal_projection_hash;
ALTER TABLE journal ADD CONSTRAINT ck_journal_projection_hash
  CHECK (projection_hash ~ '^[0-9a-f]{64}$');

-- ===========================================================================
-- §2. 관계 — 일지는 **문서**다
-- ===========================================================================
-- `journal.document_id`가 NOT NULL이고 `document.document_type`이
-- 'PLAN/JOURNAL'이다. 물리 설계가 이미 일지를 문서로 편입시켰다.
--
-- 그래서 설계 10이 이름을 쓰는 `journal_revision`·`journal_section`을 만들지
-- 않는다. CC-150이 만든 `document_revision`(불변 스냅샷 + ETag)·`change_set`·
-- `document_block`이 그 자리이고, 병렬 스택을 세우면 편집·Diff·Undo·낙관적
-- 잠금을 두 벌 유지해야 한다. ADR-33 D4(`malware_scan`)·ADR-41 D6
-- (`channel_delivery`)와 같은 판단이다.
ALTER TABLE journal DROP CONSTRAINT IF EXISTS fk_journal_situation;
ALTER TABLE journal ADD CONSTRAINT fk_journal_situation
  FOREIGN KEY (situation_id) REFERENCES situation (situation_id);

ALTER TABLE journal DROP CONSTRAINT IF EXISTS fk_journal_snapshot;
ALTER TABLE journal ADD CONSTRAINT fk_journal_snapshot
  FOREIGN KEY (snapshot_id) REFERENCES situation_snapshot (snapshot_id);

ALTER TABLE journal DROP CONSTRAINT IF EXISTS fk_journal_document;
ALTER TABLE journal ADD CONSTRAINT fk_journal_document
  FOREIGN KEY (document_id) REFERENCES document (document_id);

ALTER TABLE journal DROP CONSTRAINT IF EXISTS fk_journal_created_by;
ALTER TABLE journal ADD CONSTRAINT fk_journal_created_by
  FOREIGN KEY (created_by) REFERENCES app_user (user_id);

-- 한 문서가 두 일지의 몸이 될 수는 없다.
DROP INDEX IF EXISTS uk_journal_document;
CREATE UNIQUE INDEX uk_journal_document ON journal (document_id);

CREATE INDEX IF NOT EXISTS ix_journal_situation ON journal (situation_id, created_at DESC);

ALTER TABLE journal_projection_item DROP CONSTRAINT IF EXISTS fk_journal_projection_item_journal;
ALTER TABLE journal_projection_item ADD CONSTRAINT fk_journal_projection_item_journal
  FOREIGN KEY (journal_id) REFERENCES journal (journal_id) ON DELETE CASCADE;

-- 한 일지 안에서 섹션 key는 하나다. **이 key가 `document_block.stable_block_key`와
-- 같은 값이다** — 그 연결이 "어느 블록이 어느 사실을 말하는가"를 정하고, 그것이
-- 없으면 사실 대조도 편집 보호도 할 곳이 없다.
DROP INDEX IF EXISTS uk_journal_projection_section;
CREATE UNIQUE INDEX uk_journal_projection_section
  ON journal_projection_item (journal_id, section_key);
COMMENT ON COLUMN journal_projection_item.section_key IS
  '섹션. **`document_block.stable_block_key`와 같은 값**이다 — 사실칸과 문서 블록을 잇는 유일한 키(0042 §2)';

-- ===========================================================================
-- §3. 서술이 어디서 왔는가
-- ===========================================================================
-- 비협상 규칙: "User-edited blocks are protected from regeneration."
-- 그것을 지키려면 **사람이 손댄 칸을 알아야 한다.**
--
-- 편집 이력은 `change_set`이 들고 있지만, 재투영이 "이 칸을 덮어써도 되는가"를
-- 물을 때마다 전체 체인을 재생할 수는 없다. `task.assignee_user_id`가 배정
-- 이력의 현재 포인터인 것과 같은 형태로, 여기서도 현재 출처만 들고 있는다.
ALTER TABLE journal_projection_item
  ADD COLUMN IF NOT EXISTS narrative_source varchar(20) DEFAULT 'PROJECTED' NOT NULL;
COMMENT ON COLUMN journal_projection_item.narrative_source IS
  'PROJECTED(투영이 만든 문장)/AI(제안을 수락)/USER(사람이 씀). USER는 재투영이 덮지 않는다';

ALTER TABLE journal_projection_item DROP CONSTRAINT IF EXISTS ck_journal_narrative_source;
ALTER TABLE journal_projection_item ADD CONSTRAINT ck_journal_narrative_source
  CHECK (narrative_source IN ('PROJECTED', 'AI', 'USER'));

ALTER TABLE journal_projection_item ADD COLUMN IF NOT EXISTS narrative_updated_at timestamptz;
ALTER TABLE journal_projection_item ADD COLUMN IF NOT EXISTS narrative_updated_by uuid;
ALTER TABLE journal_projection_item DROP CONSTRAINT IF EXISTS fk_journal_projection_item_editor;
ALTER TABLE journal_projection_item ADD CONSTRAINT fk_journal_projection_item_editor
  FOREIGN KEY (narrative_updated_by) REFERENCES app_user (user_id);

-- 투영이 만든 문장은 행위자가 없다. 사람·AI가 바꾸면 누가 언제인지 남는다.
ALTER TABLE journal_projection_item DROP CONSTRAINT IF EXISTS ck_journal_narrative_authorship;
ALTER TABLE journal_projection_item ADD CONSTRAINT ck_journal_narrative_authorship
  CHECK (
    (narrative_source = 'PROJECTED')
    OR (narrative_updated_at IS NOT NULL AND narrative_updated_by IS NOT NULL)
  );

-- ===========================================================================
-- §4. 검토·승인 — 도메인 전용 (ADR-39와 같은 판단)
-- ===========================================================================
-- 설계 10이 `review_request`·`approval`이라는 공용 이름을 쓰지만 물리 설계에
-- 그 테이블이 없다. CC-250이 SOP에서 같은 상황을 만났고 **도메인 전용**을
-- 골랐다 — `generation_job`의 다형성이 실제 권한 사고를 냈고(CC-240), 전용
-- 테이블은 FK를 걸 수 있으며 RLS가 부모 조인 하나로 끝난다.
CREATE TABLE IF NOT EXISTS journal_review_request (
  journal_review_request_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  journal_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz DEFAULT now() NOT NULL,
  message varchar(2000),
  reviewer_ids uuid[] NOT NULL,
  status varchar(20) NOT NULL
);
COMMENT ON TABLE journal_review_request IS '상황일지 검토요청 (UNE-JNL-009)';
COMMENT ON COLUMN journal_review_request.revision_id IS '검토 대상 Revision — 그 뒤 편집은 새 요청이다';
COMMENT ON COLUMN journal_review_request.status IS 'OPEN/APPROVED/CHANGES_REQUESTED';

ALTER TABLE journal_review_request DROP CONSTRAINT IF EXISTS ck_journal_review_status;
ALTER TABLE journal_review_request ADD CONSTRAINT ck_journal_review_status
  CHECK (status IN ('OPEN', 'APPROVED', 'CHANGES_REQUESTED'));

ALTER TABLE journal_review_request DROP CONSTRAINT IF EXISTS ck_journal_review_reviewers;
ALTER TABLE journal_review_request ADD CONSTRAINT ck_journal_review_reviewers
  CHECK (array_length(reviewer_ids, 1) >= 1);

ALTER TABLE journal_review_request DROP CONSTRAINT IF EXISTS fk_journal_review_journal;
ALTER TABLE journal_review_request ADD CONSTRAINT fk_journal_review_journal
  FOREIGN KEY (journal_id) REFERENCES journal (journal_id) ON DELETE CASCADE;

ALTER TABLE journal_review_request DROP CONSTRAINT IF EXISTS fk_journal_review_revision;
ALTER TABLE journal_review_request ADD CONSTRAINT fk_journal_review_revision
  FOREIGN KEY (revision_id) REFERENCES document_revision (revision_id);

ALTER TABLE journal_review_request DROP CONSTRAINT IF EXISTS fk_journal_review_requester;
ALTER TABLE journal_review_request ADD CONSTRAINT fk_journal_review_requester
  FOREIGN KEY (requested_by) REFERENCES app_user (user_id);

CREATE INDEX IF NOT EXISTS ix_journal_review_journal
  ON journal_review_request (journal_id, requested_at DESC);

-- 승인은 **append-only**다(0035 §3이 `sop_approval`에 세운 규칙과 같다).
-- 승인을 고칠 수 있으면 "누가 무엇을 승인했는가"가 사후에 바뀐다.
CREATE TABLE IF NOT EXISTS journal_approval (
  journal_approval_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  journal_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  journal_review_request_id uuid,
  decision varchar(20) NOT NULL,
  decided_by uuid NOT NULL,
  decided_at timestamptz DEFAULT now() NOT NULL,
  comment varchar(2000),
  /** 승인한 순간의 투영 해시. 그 뒤 사실이 바뀌면 이 값으로 드러난다. */
  projection_hash char(64) NOT NULL
);
COMMENT ON TABLE journal_approval IS '상황일지 승인·반려 (UNE-JNL-010, append-only)';
COMMENT ON COLUMN journal_approval.projection_hash IS
  '승인한 순간의 투영 해시. 그 뒤 사실이 바뀌면 "승인된 것"과 "지금 사실"이 다르다는 것이 이 값으로 드러난다';

ALTER TABLE journal_approval DROP CONSTRAINT IF EXISTS ck_journal_approval_decision;
ALTER TABLE journal_approval ADD CONSTRAINT ck_journal_approval_decision
  CHECK (decision IN ('APPROVED', 'CHANGES_REQUESTED'));

ALTER TABLE journal_approval DROP CONSTRAINT IF EXISTS ck_journal_approval_hash;
ALTER TABLE journal_approval ADD CONSTRAINT ck_journal_approval_hash
  CHECK (projection_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE journal_approval DROP CONSTRAINT IF EXISTS fk_journal_approval_journal;
ALTER TABLE journal_approval ADD CONSTRAINT fk_journal_approval_journal
  FOREIGN KEY (journal_id) REFERENCES journal (journal_id) ON DELETE CASCADE;

ALTER TABLE journal_approval DROP CONSTRAINT IF EXISTS fk_journal_approval_revision;
ALTER TABLE journal_approval ADD CONSTRAINT fk_journal_approval_revision
  FOREIGN KEY (revision_id) REFERENCES document_revision (revision_id);

ALTER TABLE journal_approval DROP CONSTRAINT IF EXISTS fk_journal_approval_request;
ALTER TABLE journal_approval ADD CONSTRAINT fk_journal_approval_request
  FOREIGN KEY (journal_review_request_id)
  REFERENCES journal_review_request (journal_review_request_id);

ALTER TABLE journal_approval DROP CONSTRAINT IF EXISTS fk_journal_approval_decider;
ALTER TABLE journal_approval ADD CONSTRAINT fk_journal_approval_decider
  FOREIGN KEY (decided_by) REFERENCES app_user (user_id);

CREATE INDEX IF NOT EXISTS ix_journal_approval_journal
  ON journal_approval (journal_id, decided_at);

-- ===========================================================================
-- §5. RLS — 커버리지 목록에서 둘을 닫는다
-- ===========================================================================
-- 테넌트는 `situation`이 들고 있다(실행 계열과 같은 형태).
ALTER TABLE journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_journal_tenant ON journal;
CREATE POLICY p_journal_tenant ON journal
  USING (EXISTS (SELECT 1 FROM situation s
                  WHERE s.situation_id = journal.situation_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = journal.situation_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE journal_projection_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_projection_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_journal_projection_item_tenant ON journal_projection_item;
CREATE POLICY p_journal_projection_item_tenant ON journal_projection_item
  USING (EXISTS (SELECT 1 FROM journal j JOIN situation s USING (situation_id)
                  WHERE j.journal_id = journal_projection_item.journal_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM journal j JOIN situation s USING (situation_id)
                       WHERE j.journal_id = journal_projection_item.journal_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE journal_review_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_review_request FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_journal_review_tenant ON journal_review_request;
CREATE POLICY p_journal_review_tenant ON journal_review_request
  USING (EXISTS (SELECT 1 FROM journal j JOIN situation s USING (situation_id)
                  WHERE j.journal_id = journal_review_request.journal_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM journal j JOIN situation s USING (situation_id)
                       WHERE j.journal_id = journal_review_request.journal_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE journal_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_approval FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_journal_approval_tenant ON journal_approval;
CREATE POLICY p_journal_approval_tenant ON journal_approval
  USING (EXISTS (SELECT 1 FROM journal j JOIN situation s USING (situation_id)
                  WHERE j.journal_id = journal_approval.journal_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM journal j JOIN situation s USING (situation_id)
                       WHERE j.journal_id = journal_approval.journal_id
                         AND s.tenant_id = une_current_tenant_id()));

-- ===========================================================================
-- §6. 승인된 일지는 얼어붙는다
-- ===========================================================================
-- 비협상 규칙: 승인된 것은 불변이고 정정은 새 버전이다. 0035가 `sop_version`에
-- 건 것과 같은 형태로, 애플리케이션 판단이 하나 무너져도 DB가 막는다.
CREATE OR REPLACE FUNCTION une_guard_journal_approved() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status text;
BEGIN
  IF TG_TABLE_NAME = 'journal' THEN
    -- 승인으로 **들어가는** 전이는 허용한다. 승인된 것을 바꾸는 것만 막는다.
    IF OLD.status = 'APPROVED' THEN
      RAISE EXCEPTION '승인된 상황일지는 바꿀 수 없다 — 정정은 새 일지다 (0042)'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO current_status FROM journal
    WHERE journal_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.journal_id ELSE NEW.journal_id END;
  IF current_status = 'APPROVED' THEN
    RAISE EXCEPTION '승인된 상황일지의 사실칸은 바꿀 수 없다 (0042)' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_journal_approved ON journal;
CREATE TRIGGER trg_journal_approved
  BEFORE UPDATE OR DELETE ON journal
  FOR EACH ROW EXECUTE FUNCTION une_guard_journal_approved();

DROP TRIGGER IF EXISTS trg_journal_projection_item_approved ON journal_projection_item;
CREATE TRIGGER trg_journal_projection_item_approved
  BEFORE INSERT OR UPDATE OR DELETE ON journal_projection_item
  FOR EACH ROW EXECUTE FUNCTION une_guard_journal_approved();

CREATE OR REPLACE FUNCTION une_guard_journal_approval_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '승인 기록은 수정·삭제할 수 없다 (0042)' USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_journal_approval_append_only ON journal_approval;
CREATE TRIGGER trg_journal_approval_append_only
  BEFORE UPDATE OR DELETE ON journal_approval
  FOR EACH ROW EXECUTE FUNCTION une_guard_journal_approval_append_only();

-- ===========================================================================
-- §7. 권한
-- ===========================================================================
GRANT SELECT, INSERT, UPDATE ON journal                  TO une_app;
GRANT SELECT, INSERT, UPDATE ON journal_projection_item  TO une_app;
GRANT SELECT, INSERT, UPDATE ON journal_review_request   TO une_app;
GRANT SELECT, INSERT ON journal_approval                 TO une_app;

REVOKE DELETE ON journal FROM une_app;
REVOKE DELETE ON journal_projection_item FROM une_app;
REVOKE DELETE ON journal_review_request FROM une_app;
REVOKE UPDATE, DELETE ON journal_approval FROM une_app;

-- 워커는 일지에 관여하지 않는다. AI 서술 제안은 `generation_job`을 쓰고 그
-- 권한은 0011·0030이 이미 정했다.

-- ===========================================================================
-- §8. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * **`journal_revision`·`journal_section`을 만들지 않았다**(§2). 일지는
--     문서이고 CC-150의 Revision·ChangeSet·Block이 그 자리다.
--   * **`ai_edit_proposal`을 만들지 않았다.** 제안은 `generation_job`의 결과로
--     남고(원문 보존 규칙과 같은 형태), **수락은 `change_set`으로 물질화된다** —
--     그래야 낙관적 잠금·사실 대조·리비전 이력을 그대로 얻는다. 새 테이블은
--     "잡 결과 + 변경집합" 조합이 덮지 못하는 것이 있을 때 만든다.
--   * **`CONFIGURING`·`PROJECTING`을 넣지 않았다**(§1) — 투영이 동기다.
--   * **재투영을 자동으로 하지 않는다.** `projection_hash`가 어긋난 것을
--     드러내고 사람이 누를 때 갱신한다. 검토·승인 중인 문서가 소리 없이
--     변하면 "승인자가 본 것"과 "승인된 것"이 갈라진다(ADR-44 D4).
--   * **평가·개선조치 컬럼을 미리 파두지 않았다.** 그것은 CC-310의 것이다.
