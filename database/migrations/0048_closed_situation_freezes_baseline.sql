-- ===========================================================================
-- 0048. 종료는 사실원장만이 아니라 기준선이 담은 것 전부를 얼린다
--       (CC-320 V-3, ADR-46 D2)
-- ===========================================================================
--
-- CC-320 수직 슬라이스가 실측한 것.
--
-- 종료가 남기는 기준선 해시(`closureBaselineHash`)는 확정 판, 실행 사건 수·
-- 마지막 사건, **일지 목록(journalId·status·projectionHash)**, **실행 목록**
-- 까지 담는다. 그런데 0045 §5가 얼린 것은 `execution_event`뿐이었다. 그래서
-- 종료 뒤에도 일지를 새로 투영하고 고치고 승인할 수 있었고, 그때마다 기준선은
-- 조용히 거짓이 됐다 — 어긋났다고 말해 주는 코드도 없었다(ADR-45 한계 12·13).
--
-- 무엇을 막고 무엇을 여는가.
--
--   막는다  종료된 상황의 **사실 후보·확정 판** 쓰기.
--           종료된 상황에 딸린 **일지 문서의 새 판(document_revision)**.
--   연다    이미 승인돼 얼어붙은 일지 판의 Export — 같은 내용을 다시 뽑는
--           일이므로 기준선을 흔들지 않는다. 감사 제출·재인쇄가 정확히
--           종료 뒤에 필요한 일이다(ADR-44 D10과 같은 판단).
--           정정 이벤트 — 0045 §5가 이미 열어 두었다(ADR-45 D5).
--
-- **API 가드만으로는 부족하다**는 것이 이 마이그레이션의 이유다. 일지
-- 컨트롤러만 막으면 일지 문서는 `document.status='EDITING'`이므로
-- `/documents/{id}/changesets`·autosave·Undo가 전부 통한다(ADR-44 이중검토
-- C-2가 찾은 것과 같은 구멍). 그래서 `document_revision`을 직접 지킨다.
--
-- 되돌리기: 아래 트리거와 함수를 DROP하면 0047 상태로 돌아간다. 데이터
-- 변경이 없으므로 전방 수정만으로 충분하다.

-- ---------------------------------------------------------------------------
-- §1. 종료된 상황에는 새 사실 후보도 새 확정 판도 쓸 수 없다
-- ---------------------------------------------------------------------------
-- 0045 §5는 `execution_event`만 지킨다. 확정 판은 기준선이 이름으로 담고
-- 있고, 사실 후보는 그 확정 판의 상류다. 종료 뒤에 사실이 움직이는 유일한
-- 길은 정정 이벤트여야 한다(ADR-45 D5·D9).
--
-- waive된 미확정 사실(`CANDIDATE_FACT`)의 사후 확정도 여기서 막힌다 —
-- waive의 뜻이 "그대로 두고 닫는다"이므로(ADR-45 D3) 일관된다.

CREATE OR REPLACE FUNCTION une_guard_closed_situation_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  situation_status text;
BEGIN
  SELECT status INTO situation_status FROM situation
    WHERE situation_id = NEW.situation_id;
  IF situation_status = 'CLOSED' THEN
    RAISE EXCEPTION
      '종료된 상황의 사실·판은 바꿀 수 없다 — 정정 이벤트로만 남긴다 (0048)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION une_guard_closed_situation_facts() IS
  'CC-320 V-3: 종료된 상황의 사실 후보·확정 판 동결. 기준선이 담은 것을 지킨다.';

DROP TRIGGER IF EXISTS trg_closed_situation_facts ON situation_fact;
CREATE TRIGGER trg_closed_situation_facts
  BEFORE INSERT OR UPDATE ON situation_fact
  FOR EACH ROW EXECUTE FUNCTION une_guard_closed_situation_facts();

DROP TRIGGER IF EXISTS trg_closed_situation_snapshots ON situation_snapshot;
CREATE TRIGGER trg_closed_situation_snapshots
  BEFORE INSERT OR UPDATE ON situation_snapshot
  FOR EACH ROW EXECUTE FUNCTION une_guard_closed_situation_facts();

-- ---------------------------------------------------------------------------
-- §2. 종료된 상황의 일지 문서는 새 판을 만들 수 없다
-- ---------------------------------------------------------------------------
-- 기준선은 일지의 `projectionHash`와 `status`를 담는다. 새 판이 생기면 둘
-- 중 하나는 반드시 움직인다.
--
-- **일지에 연결된 문서만** 본다. 계획서 문서는 상황을 가리키지 않으므로
-- 이 트리거의 대상이 아니고, 대상으로 삼으면 종료가 무관한 문서 작업을
-- 막는다.

CREATE OR REPLACE FUNCTION une_guard_closed_situation_journal_revisions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  situation_status text;
BEGIN
  SELECT s.status INTO situation_status
    FROM journal j JOIN situation s ON s.situation_id = j.situation_id
   WHERE j.document_id = NEW.document_id;

  -- 일지 문서가 아니면 여기서 판단하지 않는다.
  IF situation_status IS NULL THEN
    RETURN NEW;
  END IF;

  IF situation_status = 'CLOSED' THEN
    RAISE EXCEPTION
      '종료된 상황의 일지 문서는 새 판을 만들 수 없다 (0048)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION une_guard_closed_situation_journal_revisions() IS
  'CC-320 V-3: 종료된 상황의 일지 문서 동결. 일지 API를 지나지 않는 문서 경로(changeset/autosave/Undo)까지 막는다.';

DROP TRIGGER IF EXISTS trg_closed_situation_journal_revisions ON document_revision;
CREATE TRIGGER trg_closed_situation_journal_revisions
  BEFORE INSERT ON document_revision
  FOR EACH ROW EXECUTE FUNCTION une_guard_closed_situation_journal_revisions();

-- ---------------------------------------------------------------------------
-- §3. 일지 상태 자체도 종료 뒤에는 움직이지 않는다
-- ---------------------------------------------------------------------------
-- `journal.status`는 기준선이 직접 담는 값이다. 승인·반려가 여기서 막힌다.
-- "종료 뒤에 서류 마감만 하게 해 주자"가 정확히 V-3의 조용한 어긋남이다.

CREATE OR REPLACE FUNCTION une_guard_closed_situation_journals() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  situation_status text;
BEGIN
  SELECT status INTO situation_status FROM situation
    WHERE situation_id = NEW.situation_id;
  IF situation_status = 'CLOSED' THEN
    RAISE EXCEPTION
      '종료된 상황의 일지는 만들 수도 바꿀 수도 없다 (0048)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION une_guard_closed_situation_journals() IS
  'CC-320 V-3: 종료된 상황의 일지 행 동결. 기준선이 journalId·status를 담는다.';

DROP TRIGGER IF EXISTS trg_closed_situation_journals ON journal;
CREATE TRIGGER trg_closed_situation_journals
  BEFORE INSERT OR UPDATE ON journal
  FOR EACH ROW EXECUTE FUNCTION une_guard_closed_situation_journals();
