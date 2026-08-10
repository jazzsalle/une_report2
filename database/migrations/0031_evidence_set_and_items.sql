-- 0031_evidence_set_and_items.sql (CC-230)
--
-- 근거 검색 결과와 불변 EvidenceSet.
-- 설계 06 US-SIT-011, 설계 08 §1.14, 설계 10 UNE-KNOW-004~007.
--
-- 0004의 `evidence_set`/`evidence_item`은 `knowledge_document`와 같은 상태였다 —
-- 어휘 CHECK도 상관식도 FK도 없다. **그리고 RLS 정책이 하나도 없다.**
-- 0011이 `une_app`에 전 테이블 DML을 일괄 부여하므로 정책 없는 테이블은
-- 전 테넌트 공개이며, CC-230이 첫 쓰기 경로를 여는 순간 규칙이 깨진다.
-- 0023이 상황 계열에서 똑같은 상태를 발견하고 닫은 것과 같은 자리다.
--
-- 테이블 수 변화 없음(63 유지).

-- ===========================================================================
-- §1. 신설 컬럼 — 설계가 요구하는데 0004에 없던 것
-- ===========================================================================
-- 동결은 "누가 언제"가 남아야 감사가 성립한다. 0004에는 created_* 밖에 없어
-- 만든 사람과 동결한 사람을 구분할 수 없었다 — 검토자가 만들고 통제관이
-- 동결하는 흐름(US-SIT-011 주 행위자 둘)이 기록되지 않는다.
ALTER TABLE evidence_set ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE evidence_set ADD COLUMN IF NOT EXISTS frozen_by uuid;
ALTER TABLE evidence_set ADD COLUMN IF NOT EXISTS freeze_reason text;
ALTER TABLE evidence_set ADD COLUMN IF NOT EXISTS provider_job_id uuid;
ALTER TABLE evidence_set ADD COLUMN IF NOT EXISTS updated_at timestamptz;

COMMENT ON COLUMN evidence_set.status IS 'DRAFT/FROZEN. 화면 흐름 상태(SEARCHING 등)는 저장하지 않는다(ADR-37 D1)';
COMMENT ON COLUMN evidence_set.content_hash IS '동결 대상의 내용 해시 — 점수·동결자·시각은 넣지 않는다';
COMMENT ON COLUMN evidence_set.frozen_at IS '동결 시각. NULL이면 DRAFT다';
COMMENT ON COLUMN evidence_set.provider_job_id IS '이 결과를 만든 UNI 검색 잡 (원문 추적)';

-- US-SIT-011 4단계 "근거를 선택·제외·우선순위 조정한다". 0004에는 선택 여부를
-- 담을 곳이 없어 **제외한 근거를 지우는 수밖에 없었다** — 그러면 "무엇을 보고
-- 제외했는가"가 사라진다. 후보는 남기고 선택만 끈다.
ALTER TABLE evidence_item ADD COLUMN IF NOT EXISTS is_selected boolean;
ALTER TABLE evidence_item ADD COLUMN IF NOT EXISTS excluded_reason text;

-- **컬럼 한계가 원문 소실로 이어진다.** `score numeric(8,6)`(0004)은 |score| < 100과
-- 소수 6자리를 강제하고, `provider_chunk_id varchar(150)`도 상한이 있다. UNI 점수의
-- 척도가 미확인인데(OB-13) BM25류는 100을 쉽게 넘고, 그러면 항목 INSERT가
-- 22003으로 죽는다 — 같은 트랜잭션의 잡·원문까지 롤백되어 "UNI가 뭘 줬는지
-- 모른 채 500만 남는" 상태가 된다. ADR-37 D9가 피하려던 바로 그 함정이
-- 컬럼 타입으로 열려 있었다(실측: score=100 → 22003, chunk_id 151자 → 22001).
--
-- 정밀도를 풀고 식별자를 넓힌다. 값을 잘라 넣지 않는 이유: 잘린 chunk id는
-- 다른 청크를 가리킬 수 있고, 반올림한 점수는 UNI가 준 값이 아니다.
ALTER TABLE evidence_item ALTER COLUMN score TYPE numeric;
ALTER TABLE evidence_item ALTER COLUMN provider_chunk_id TYPE varchar(255);

COMMENT ON COLUMN evidence_item.is_selected IS '동결에 포함할지. 제외한 후보도 행은 남긴다(US-SIT-011 4단계)';
COMMENT ON COLUMN evidence_item.score IS 'UNI가 준 점수. 척도 미확인(OB-13)이라 정밀도·범위를 제약하지 않는다';

UPDATE evidence_set SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL;
UPDATE evidence_item SET is_selected = COALESCE(is_selected, true) WHERE is_selected IS NULL;

ALTER TABLE evidence_set ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE evidence_set ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE evidence_item ALTER COLUMN is_selected SET NOT NULL;
ALTER TABLE evidence_item ALTER COLUMN is_selected SET DEFAULT true;

-- ===========================================================================
-- §2. 어휘와 상관식
-- ===========================================================================
ALTER TABLE evidence_set DROP CONSTRAINT IF EXISTS ck_evidence_set_status;
ALTER TABLE evidence_set ADD CONSTRAINT ck_evidence_set_status
  CHECK (status IN ('DRAFT', 'FROZEN'));

-- 설계 06 US-SIT-011 2단계 "기본 top_k=8". 상한은 계약의 EvidenceSearchRequest와
-- 같은 50이다.
ALTER TABLE evidence_set DROP CONSTRAINT IF EXISTS ck_evidence_set_top_k;
ALTER TABLE evidence_set ADD CONSTRAINT ck_evidence_set_top_k
  CHECK (top_k BETWEEN 1 AND 50);

ALTER TABLE evidence_set DROP CONSTRAINT IF EXISTS ck_evidence_set_hash;
ALTER TABLE evidence_set ADD CONSTRAINT ck_evidence_set_hash
  CHECK (content_hash ~ '^[0-9a-f]{64}$');

-- 동결은 "누가 언제"가 함께 있어야 한다. 하나만 있는 행은 만들 수 없다.
ALTER TABLE evidence_set DROP CONSTRAINT IF EXISTS ck_evidence_set_freeze_shape;
ALTER TABLE evidence_set ADD CONSTRAINT ck_evidence_set_freeze_shape
  CHECK (
    (status = 'FROZEN' AND frozen_at IS NOT NULL AND frozen_by IS NOT NULL)
    OR (status = 'DRAFT' AND frozen_at IS NULL AND frozen_by IS NULL)
  );

ALTER TABLE evidence_item DROP CONSTRAINT IF EXISTS ck_evidence_item_rank;
ALTER TABLE evidence_item ADD CONSTRAINT ck_evidence_item_rank
  CHECK (rank_no >= 1);

-- 인용문이 비면 화면에 보여줄 근거가 없다(도메인 EMPTY_QUOTE와 같은 규칙).
ALTER TABLE evidence_item DROP CONSTRAINT IF EXISTS ck_evidence_item_quote;
ALTER TABLE evidence_item ADD CONSTRAINT ck_evidence_item_quote
  CHECK (length(btrim(quote_text)) > 0);

-- 제외에는 사유가 있어야 한다 — 없으면 "왜 뺐는가"가 남지 않는다.
ALTER TABLE evidence_item DROP CONSTRAINT IF EXISTS ck_evidence_item_exclusion_shape;
ALTER TABLE evidence_item ADD CONSTRAINT ck_evidence_item_exclusion_shape
  CHECK (is_selected OR excluded_reason IS NOT NULL);

-- ===========================================================================
-- §3. 관계
-- ===========================================================================
ALTER TABLE evidence_set DROP CONSTRAINT IF EXISTS fk_evidence_set_situation_id;
ALTER TABLE evidence_set ADD CONSTRAINT fk_evidence_set_situation_id
  FOREIGN KEY (situation_id) REFERENCES situation (situation_id);

-- 근거는 **확정된 판** 위에서만 모은다(도메인 SNAPSHOT_NOT_CURRENT).
ALTER TABLE evidence_set DROP CONSTRAINT IF EXISTS fk_evidence_set_snapshot_id;
ALTER TABLE evidence_set ADD CONSTRAINT fk_evidence_set_snapshot_id
  FOREIGN KEY (snapshot_id) REFERENCES situation_snapshot (snapshot_id);

ALTER TABLE evidence_set DROP CONSTRAINT IF EXISTS fk_evidence_set_created_by;
ALTER TABLE evidence_set ADD CONSTRAINT fk_evidence_set_created_by
  FOREIGN KEY (created_by) REFERENCES app_user (user_id);

ALTER TABLE evidence_set DROP CONSTRAINT IF EXISTS fk_evidence_set_frozen_by;
ALTER TABLE evidence_set ADD CONSTRAINT fk_evidence_set_frozen_by
  FOREIGN KEY (frozen_by) REFERENCES app_user (user_id);

ALTER TABLE evidence_set DROP CONSTRAINT IF EXISTS fk_evidence_set_provider_job_id;
ALTER TABLE evidence_set ADD CONSTRAINT fk_evidence_set_provider_job_id
  FOREIGN KEY (provider_job_id) REFERENCES provider_job (provider_job_id);

ALTER TABLE evidence_item DROP CONSTRAINT IF EXISTS fk_evidence_item_evidence_set_id;
ALTER TABLE evidence_item ADD CONSTRAINT fk_evidence_item_evidence_set_id
  FOREIGN KEY (evidence_set_id) REFERENCES evidence_set (evidence_set_id) ON DELETE CASCADE;

-- 근거는 **우리가 올린 문서**만 가리킬 수 있다. 이 FK가 US-SIT-011 E-02
-- ("doc_id 연결 불가 → 결과 격리·사용금지")의 마지막 방어선이다 — 애플리케이션
-- 검사가 뚫려도 UNI가 준 모르는 문서 id는 DB가 거부한다.
ALTER TABLE evidence_item DROP CONSTRAINT IF EXISTS fk_evidence_item_knowledge_document_id;
ALTER TABLE evidence_item ADD CONSTRAINT fk_evidence_item_knowledge_document_id
  FOREIGN KEY (knowledge_document_id) REFERENCES knowledge_document (knowledge_document_id);

-- 한 집합 안에서 순위와 인용 키는 유일하다.
DROP INDEX IF EXISTS uk_evidence_item_rank;
CREATE UNIQUE INDEX uk_evidence_item_rank ON evidence_item (evidence_set_id, rank_no);
DROP INDEX IF EXISTS uk_evidence_item_citation;
CREATE UNIQUE INDEX uk_evidence_item_citation ON evidence_item (evidence_set_id, citation_key);

CREATE INDEX IF NOT EXISTS ix_evidence_set_situation
  ON evidence_set (situation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_evidence_item_document
  ON evidence_item (knowledge_document_id);

DROP TRIGGER IF EXISTS trg_evidence_set_updated_at ON evidence_set;
CREATE TRIGGER trg_evidence_set_updated_at
  BEFORE UPDATE ON evidence_set
  FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();

-- ===========================================================================
-- §4. RLS — 두 테이블 모두 정책이 한 번도 없었다
-- ===========================================================================
-- `evidence_set`은 tenant_id 컬럼이 없고 `situation`을 거쳐 증명한다.
-- `evidence_item`은 2단 조인이다(0023 §3이 상황 계열에 세운 형태와 같다).
ALTER TABLE evidence_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_set FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_item FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_evidence_set_tenant ON evidence_set;
CREATE POLICY p_evidence_set_tenant ON evidence_set
  USING (EXISTS (SELECT 1 FROM situation s
                  WHERE s.situation_id = evidence_set.situation_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM situation s
                       WHERE s.situation_id = evidence_set.situation_id
                         AND s.tenant_id = une_current_tenant_id()));

DROP POLICY IF EXISTS p_evidence_item_tenant ON evidence_item;
CREATE POLICY p_evidence_item_tenant ON evidence_item
  USING (EXISTS (SELECT 1 FROM evidence_set e JOIN situation s USING (situation_id)
                  WHERE e.evidence_set_id = evidence_item.evidence_set_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM evidence_set e JOIN situation s USING (situation_id)
                       WHERE e.evidence_set_id = evidence_item.evidence_set_id
                         AND s.tenant_id = une_current_tenant_id()));

-- ===========================================================================
-- §5. 동결 후 불변 — 트리거로 강제한다
-- ===========================================================================
-- CLAUDE.md: "Approved PlanContextSnapshot, SituationSnapshot, SOP Version, and
-- Execution Event are immutable." EvidenceSet은 그 목록에 이름이 없지만
-- 설계 06이 "생성시점 EvidenceSet을 **동결한다**"이고 SOP가 그것을 근거로
-- 삼으므로 성격이 같다.
--
-- `une_app`에서 UPDATE를 회수할 수는 없다 — DRAFT는 사용자가 고치는 것이
-- 정상이다. 그래서 **행 단위**로 막는다: 0027/0029가 provider 원문에 쓴 것과
-- 같은 형태다.
-- **DELETE도 막는다.** UPDATE만 막으면 부모를 지우는 것으로 우회된다 —
-- 자식 FK가 ON DELETE CASCADE라 근거까지 함께 사라지고, 그때 자식 가드는
-- 부모가 이미 없어져 `parent_status = NULL`을 읽고 열린 채 통과한다.
-- 실측으로 재현했다(아키텍처 검토 BLOCKER 2-2).
CREATE OR REPLACE FUNCTION une_guard_evidence_set_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'FROZEN' THEN
    RAISE EXCEPTION '동결된 EvidenceSet은 수정·삭제할 수 없다 (US-SIT-011, 0031)'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

DROP TRIGGER IF EXISTS trg_evidence_set_frozen_immutable ON evidence_set;
CREATE TRIGGER trg_evidence_set_frozen_immutable
  BEFORE UPDATE OR DELETE ON evidence_set
  FOR EACH ROW EXECUTE FUNCTION une_guard_evidence_set_frozen();

-- 항목도 같다. 동결된 집합의 근거가 나중에 바뀌면 "그때 무엇을 근거로
-- 만들었는가"가 사라진다.
-- **fail-closed다.** 처음에는 `IF parent_status = 'FROZEN'`이었는데, 부모가
-- 보이지 않으면(cascade로 이미 지워졌거나 RLS가 가렸거나) NULL이라 그 비교가
-- 참이 아니고 가드가 통과한다. 이 함수는 SECURITY DEFINER가 아니라 호출자
-- RLS를 받으므로 테넌트 문맥이 없는 세션에서도 같은 일이 생긴다.
--
-- 예외는 하나뿐이다: 부모가 없고 DELETE이면 **부모 삭제에서 온 cascade**이며,
-- 그 삭제는 위 부모 가드를 이미 통과했으므로(= 부모가 DRAFT였다) 허용한다.
CREATE OR REPLACE FUNCTION une_guard_evidence_item_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status varchar(20);
  target_set uuid;
BEGIN
  target_set := CASE WHEN TG_OP = 'DELETE' THEN OLD.evidence_set_id ELSE NEW.evidence_set_id END;
  SELECT status INTO parent_status FROM evidence_set WHERE evidence_set_id = target_set;

  IF parent_status IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD; -- 부모 삭제의 cascade. 부모 가드가 이미 판단했다.
    END IF;
    RAISE EXCEPTION '보이지 않는 EvidenceSet에 근거를 쓸 수 없다 (0031)'
      USING ERRCODE = '42501';
  END IF;

  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION '동결된 EvidenceSet의 근거는 바꿀 수 없다 (US-SIT-011, 0031)'
      USING ERRCODE = '42501';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

DROP TRIGGER IF EXISTS trg_evidence_item_frozen_immutable ON evidence_item;
CREATE TRIGGER trg_evidence_item_frozen_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON evidence_item
  FOR EACH ROW EXECUTE FUNCTION une_guard_evidence_item_frozen();

-- ===========================================================================
-- §5-1. 삭제 권한을 회수한다
-- ===========================================================================
-- 0011 §33-36이 "sop_version과 evidence_set의 불변은 CC-250/CC-230까지
-- **애플리케이션 계층**에서 강제한다"고 적어 이 항목에 숙제를 넘겼다.
-- 애플리케이션에 삭제 경로가 없으므로 권한 자체를 거둔다 — 트리거는 마지막
-- 방어선이지 유일한 방어선이 아니다.
REVOKE DELETE ON evidence_set FROM une_app;
REVOKE DELETE ON evidence_item FROM une_app;

-- ===========================================================================
-- §6. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * `score`에 범위 제약을 걸지 않았다. UNI 점수의 의미와 범위가 미확인이다
--     (OB-13). 0..1이라고 가정하고 CHECK를 걸면 저쪽이 다른 척도를 쓸 때
--     정상 응답이 23514로 떨어진다.
--   * 워커 권한을 주지 않았다. 검색은 **동기**이므로(ADR-37 D2) 이 테이블에
--     쓰는 것은 API뿐이다. CC-220이 워커에 권한을 연 것과 갈리는 지점이다.
--   * EvidenceSet의 보존기간을 정하지 않았다. 인용문에 개인정보가 들어올 수
--     있으므로 ADR-35와 같은 판단이 필요하지만, 그쪽은 SOP가 근거를 참조하는
--     방식이 정해진 뒤에야 답할 수 있다(CC-240).
