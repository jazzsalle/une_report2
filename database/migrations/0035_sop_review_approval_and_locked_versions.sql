-- 0035_sop_review_approval_and_locked_versions.sql (CC-250)
--
-- SOP 캔버스 편집 → 검증 → 검토 요청 → 승인·버전 고정.
-- 설계 10 UNE-SOP-003~009, 설계 09 SCR-SOP-004/005, 마스터 §22.
--
-- 0032가 예고한 확장이 여기서 온다: `sop.status`·`sop_version.status` 어휘를
-- 넓히고, LOCKED 버전의 불변 트리거를 건다("LOCKED를 만드는 경로가 아직
-- 없으므로 지금 걸면 도달하지 않는 코드가 된다 — 승인과 함께 CC-250에서 온다").
--
-- 테이블 63 → 65 (`sop_review_request`, `sop_approval` 신설).

-- ===========================================================================
-- §1. 어휘 확장 — 이번에 **도달 가능해지는** 상태만
-- ===========================================================================
-- CC-240은 DRAFT 하나였다. CC-250이 검토 요청(IN_REVIEW)과 승인(APPROVED)을
-- 만든다. `RETIRED`는 넣지 않는다 — 폐기 엔드포인트가 이번 범위에 없고,
-- 그 값을 만드는 경로가 없는 채로 어휘만 남기지 않는다(0022 §1).
ALTER TABLE sop DROP CONSTRAINT IF EXISTS ck_sop_status;
ALTER TABLE sop ADD CONSTRAINT ck_sop_status
  CHECK (status IN ('DRAFT', 'IN_REVIEW', 'APPROVED'));
COMMENT ON COLUMN sop.status IS 'DRAFT/IN_REVIEW/APPROVED. RETIRED는 폐기 경로가 생길 때 연다';

ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS ck_sop_version_status;
ALTER TABLE sop_version ADD CONSTRAINT ck_sop_version_status
  CHECK (status IN ('DRAFT', 'LOCKED'));
COMMENT ON COLUMN sop_version.status IS 'DRAFT/LOCKED. 승인이 LOCKED로 고정하며 그 뒤로는 불변이다(§3)';

-- 0005의 `sop_validation.status` 주석은 PASS/FAIL이고 CHECK가 없었다.
ALTER TABLE sop_validation DROP CONSTRAINT IF EXISTS ck_sop_validation_status;
ALTER TABLE sop_validation ADD CONSTRAINT ck_sop_validation_status
  CHECK (status IN ('PASS', 'FAIL'));

-- 오류가 있는데 PASS일 수는 없다. 반대로 경고만 있으면 PASS다 — 그것이
-- CC-240이 "위반이 있어도 DRAFT로 저장한다"고 정한 것과 같은 축이다.
ALTER TABLE sop_validation DROP CONSTRAINT IF EXISTS ck_sop_validation_outcome_shape;
ALTER TABLE sop_validation ADD CONSTRAINT ck_sop_validation_outcome_shape
  CHECK (
    (status = 'PASS' AND jsonb_array_length(errors_json) = 0)
    OR (status = 'FAIL' AND jsonb_array_length(errors_json) > 0)
  );

ALTER TABLE sop_validation DROP CONSTRAINT IF EXISTS fk_sop_validation_version;
ALTER TABLE sop_validation ADD CONSTRAINT fk_sop_validation_version
  FOREIGN KEY (sop_version_id) REFERENCES sop_version (sop_version_id) ON DELETE CASCADE;

ALTER TABLE sop_validation DROP CONSTRAINT IF EXISTS fk_sop_validation_validated_by;
ALTER TABLE sop_validation ADD CONSTRAINT fk_sop_validation_validated_by
  FOREIGN KEY (validated_by) REFERENCES app_user (user_id);

CREATE INDEX IF NOT EXISTS ix_sop_validation_version
  ON sop_validation (sop_version_id, validated_at DESC);

-- ===========================================================================
-- §2. 검토 요청과 승인 — **SOP 전용 테이블이다**
-- ===========================================================================
-- 설계 10은 `review_request`·`approval`이라는 이름을 SOP·문서·일지 세 도메인에
-- 걸쳐 쓴다. 그러나 컬럼 수준 물리 설계는 어디에도 없고, "공용 테이블"은 이름
-- 재사용에서 나온 추론이지 명시된 다형 설계가 아니다.
--
-- **공용으로 만들지 않는 이유는 실제 사고 때문이다.** `generation_job`이
-- `aggregate_type` 공용인데, CC-240에서 잡 유형을 검사하지 않아 `SOP_READ`만
-- 가진 사용자가 계획서 본문 이벤트를 읽고 `PLAN_GENERATE`로 남의 SOP 잡을 끌
-- 수 있었다. 원인은 공용성 그 자체다 — 테이블이 도메인을 가로지르는 순간 타입
-- 판별 책임이 DB 제약에서 **모든 쿼리 경로의 애플리케이션 코드**로 옮겨가고,
-- 그중 하나만 빠뜨리면 권한 경계가 뚫린다.
--
-- 전용 테이블은 `sop_id`/`sop_version_id`에 **진짜 FK**를 걸 수 있고 RLS가 부모
-- 조인 하나로 끝난다. 나중에 문서·일지가 통합 조회를 요구하면 UNION 뷰를
-- 얹으면 되지만(싸다), 반대로 다형 테이블에 세 도메인 행이 섞여 쌓인 뒤
-- append-only 이력을 쪼개는 것은 비싸다. 되돌리기 비용이 비대칭이다.
--
-- 설계 이름과 어긋나는 것은 ADR-39에 기록한다. API 리소스명 `ReviewRequest`는
-- 그대로 둔다.

CREATE TABLE IF NOT EXISTS sop_review_request (
  review_request_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sop_id uuid NOT NULL,
  sop_version_id uuid NOT NULL,
  status varchar(20) NOT NULL,
  reviewer_ids uuid[] NOT NULL,
  message text,
  requested_by uuid NOT NULL,
  requested_at timestamptz DEFAULT now() NOT NULL,
  resolved_at timestamptz
);
COMMENT ON TABLE sop_review_request IS 'SOP 검토 요청 (UNE-SOP-008). 설계 10의 review_request를 도메인 전용으로 실현한다 — ADR-39';
COMMENT ON COLUMN sop_review_request.reviewer_ids IS '알림 대상. 승인 게이트는 SOP_APPROVE 권한이지 이 목록이 아니다';
COMMENT ON COLUMN sop_review_request.status IS 'REQUESTED/APPROVED. 반려·철회는 그 엔드포인트가 생길 때 연다';

ALTER TABLE sop_review_request DROP CONSTRAINT IF EXISTS ck_sop_review_request_status;
ALTER TABLE sop_review_request ADD CONSTRAINT ck_sop_review_request_status
  CHECK (status IN ('REQUESTED', 'APPROVED'));

-- 검토자가 없는 검토 요청은 아무에게도 가지 않는다.
ALTER TABLE sop_review_request DROP CONSTRAINT IF EXISTS ck_sop_review_request_reviewers;
ALTER TABLE sop_review_request ADD CONSTRAINT ck_sop_review_request_reviewers
  CHECK (cardinality(reviewer_ids) >= 1);

ALTER TABLE sop_review_request DROP CONSTRAINT IF EXISTS ck_sop_review_request_resolved_shape;
ALTER TABLE sop_review_request ADD CONSTRAINT ck_sop_review_request_resolved_shape
  CHECK ((status = 'REQUESTED') = (resolved_at IS NULL));

ALTER TABLE sop_review_request DROP CONSTRAINT IF EXISTS fk_sop_review_request_sop;
ALTER TABLE sop_review_request ADD CONSTRAINT fk_sop_review_request_sop
  FOREIGN KEY (sop_id) REFERENCES sop (sop_id) ON DELETE CASCADE;

ALTER TABLE sop_review_request DROP CONSTRAINT IF EXISTS fk_sop_review_request_version;
ALTER TABLE sop_review_request ADD CONSTRAINT fk_sop_review_request_version
  FOREIGN KEY (sop_version_id) REFERENCES sop_version (sop_version_id) ON DELETE CASCADE;

ALTER TABLE sop_review_request DROP CONSTRAINT IF EXISTS fk_sop_review_request_requested_by;
ALTER TABLE sop_review_request ADD CONSTRAINT fk_sop_review_request_requested_by
  FOREIGN KEY (requested_by) REFERENCES app_user (user_id);

-- 한 버전에 열린 검토 요청은 하나다. 둘이면 어느 것이 "지금 검토 중"인지
-- 말할 수 없다.
DROP INDEX IF EXISTS uk_sop_review_request_open;
CREATE UNIQUE INDEX uk_sop_review_request_open
  ON sop_review_request (sop_version_id) WHERE status = 'REQUESTED';

CREATE INDEX IF NOT EXISTS ix_sop_review_request_sop
  ON sop_review_request (sop_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS sop_approval (
  approval_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sop_id uuid NOT NULL,
  sop_version_id uuid NOT NULL,
  review_request_id uuid,
  approved_by uuid NOT NULL,
  comment text,
  graph_hash char(64) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON TABLE sop_approval IS 'SOP 승인 감사 기록 (UNE-SOP-009). append-only — 정정은 새 버전이다';
COMMENT ON COLUMN sop_approval.graph_hash IS '승인 시점 그래프 해시를 감사 행에 동결한다 — "무엇을 승인했는가"를 나중에 소급 보강할 방법이 없다';

ALTER TABLE sop_approval DROP CONSTRAINT IF EXISTS fk_sop_approval_sop;
ALTER TABLE sop_approval ADD CONSTRAINT fk_sop_approval_sop
  FOREIGN KEY (sop_id) REFERENCES sop (sop_id) ON DELETE CASCADE;

ALTER TABLE sop_approval DROP CONSTRAINT IF EXISTS fk_sop_approval_version;
ALTER TABLE sop_approval ADD CONSTRAINT fk_sop_approval_version
  FOREIGN KEY (sop_version_id) REFERENCES sop_version (sop_version_id) ON DELETE CASCADE;

ALTER TABLE sop_approval DROP CONSTRAINT IF EXISTS fk_sop_approval_review_request;
ALTER TABLE sop_approval ADD CONSTRAINT fk_sop_approval_review_request
  FOREIGN KEY (review_request_id) REFERENCES sop_review_request (review_request_id);

ALTER TABLE sop_approval DROP CONSTRAINT IF EXISTS fk_sop_approval_approved_by;
ALTER TABLE sop_approval ADD CONSTRAINT fk_sop_approval_approved_by
  FOREIGN KEY (approved_by) REFERENCES app_user (user_id);

ALTER TABLE sop_approval DROP CONSTRAINT IF EXISTS ck_sop_approval_graph_hash;
ALTER TABLE sop_approval ADD CONSTRAINT ck_sop_approval_graph_hash
  CHECK (graph_hash ~ '^[0-9a-f]{64}$');

-- 한 버전은 한 번만 승인된다. 재승인은 새 버전이다(비협상 규칙: 정정은 새
-- 버전이고 감사 이력을 덮어쓰지 않는다).
ALTER TABLE sop_approval DROP CONSTRAINT IF EXISTS uk_sop_approval_version;
ALTER TABLE sop_approval ADD CONSTRAINT uk_sop_approval_version UNIQUE (sop_version_id);

-- ===========================================================================
-- §3. LOCKED 버전은 불변이다 (0032 §6이 예고한 트리거)
-- ===========================================================================
-- 0031이 동결 EvidenceSet에 건 것과 같은 형태다. CHECK로는 "이 행이 이전에
-- 무엇이었는가"를 볼 수 없으므로 트리거여야 한다.
CREATE OR REPLACE FUNCTION une_guard_sop_version_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION '승인된 SOP 버전은 수정·삭제할 수 없다 (UNE-SOP-009, 0035)'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_sop_version_locked_immutable ON sop_version;
CREATE TRIGGER trg_sop_version_locked_immutable
  BEFORE UPDATE OR DELETE ON sop_version
  FOR EACH ROW EXECUTE FUNCTION une_guard_sop_version_locked();

-- 자식(노드·간선)도 함께 잠근다. 버전 행만 막으면 그래프 내용은 바뀌는데
-- 해시는 그대로여서 **승인한 것과 저장된 것이 달라진다.**
--
-- **fail-closed다**(0031에서 배운 대로). 부모를 찾지 못하면 막는다 — 단
-- 부모가 지워지는 cascade는 예외다(그 삭제는 이미 위 트리거가 판단했다).
CREATE OR REPLACE FUNCTION une_guard_sop_graph_locked() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
  version_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.sop_version_id ELSE NEW.sop_version_id END;
BEGIN
  SELECT status INTO parent_status FROM sop_version WHERE sop_version_id = version_id;
  IF parent_status IS NULL THEN
    -- 부모가 이미 사라졌다면 이 삭제는 cascade다. 그 외에는 있을 수 없다.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '존재하지 않는 SOP 버전에 그래프를 쓸 수 없다 (0035)' USING ERRCODE = '42501';
  END IF;
  IF parent_status = 'LOCKED' THEN
    RAISE EXCEPTION '승인된 SOP 버전의 그래프는 바꿀 수 없다 (UNE-SOP-009, 0035)'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_sop_node_locked_immutable ON sop_node;
CREATE TRIGGER trg_sop_node_locked_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sop_node
  FOR EACH ROW EXECUTE FUNCTION une_guard_sop_graph_locked();

DROP TRIGGER IF EXISTS trg_sop_edge_locked_immutable ON sop_edge;
CREATE TRIGGER trg_sop_edge_locked_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON sop_edge
  FOR EACH ROW EXECUTE FUNCTION une_guard_sop_graph_locked();

-- 승인 감사 기록은 append-only다. 0031이 `evidence_set`에 한 것과 같이
-- **권한부터 없앤다** — 트리거는 그 다음 방어선이다.
CREATE OR REPLACE FUNCTION une_guard_sop_approval_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '승인 기록은 수정·삭제할 수 없다 (0035)' USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS trg_sop_approval_append_only ON sop_approval;
CREATE TRIGGER trg_sop_approval_append_only
  BEFORE UPDATE OR DELETE ON sop_approval
  FOR EACH ROW EXECUTE FUNCTION une_guard_sop_approval_append_only();

-- ===========================================================================
-- §4. RLS — **새 테이블과 같은 마이그레이션에서 건다**
-- ===========================================================================
-- 이 저장소에서 "새 테이블에 정책을 안 걸어 전 테넌트 공개"가 **네 번** 났다
-- (0023 상황 여섯, 0031 근거 둘, 0032 SOP 셋, 그리고 여기 `sop_validation`).
-- 전수 조사 결과 정책이 한 번도 걸린 적 없는 테이블이 18개다.
-- 실질 방어는 절차다: **CREATE TABLE과 ENABLE/FORCE RLS와 정책과 GRANT는 같은
-- 마이그레이션에서만 온다.** 통합 테스트가 이 규칙을 강제한다.
ALTER TABLE sop_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_validation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_sop_validation_tenant ON sop_validation;
CREATE POLICY p_sop_validation_tenant ON sop_validation
  USING (EXISTS (SELECT 1 FROM sop_version v JOIN sop s USING (sop_id)
                  WHERE v.sop_version_id = sop_validation.sop_version_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM sop_version v JOIN sop s USING (sop_id)
                       WHERE v.sop_version_id = sop_validation.sop_version_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE sop_review_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_review_request FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_sop_review_request_tenant ON sop_review_request;
CREATE POLICY p_sop_review_request_tenant ON sop_review_request
  USING (EXISTS (SELECT 1 FROM sop s
                  WHERE s.sop_id = sop_review_request.sop_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM sop s
                       WHERE s.sop_id = sop_review_request.sop_id
                         AND s.tenant_id = une_current_tenant_id()));

ALTER TABLE sop_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_approval FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_sop_approval_tenant ON sop_approval;
CREATE POLICY p_sop_approval_tenant ON sop_approval
  USING (EXISTS (SELECT 1 FROM sop s
                  WHERE s.sop_id = sop_approval.sop_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM sop s
                       WHERE s.sop_id = sop_approval.sop_id
                         AND s.tenant_id = une_current_tenant_id()));

-- ===========================================================================
-- §5. 권한
-- ===========================================================================
GRANT SELECT, INSERT ON sop_validation     TO une_app;
GRANT SELECT, INSERT, UPDATE ON sop_review_request TO une_app;  -- 승인 시 해소
GRANT SELECT, INSERT ON sop_approval       TO une_app;

-- 삭제 경로가 없으므로 권한도 없다(0031/0034에서 배운 규칙). 승인 기록은
-- 수정도 없다 — 위 트리거는 두 번째 방어선이다.
REVOKE UPDATE, DELETE ON sop_validation FROM une_app;
REVOKE DELETE ON sop_review_request FROM une_app;
REVOKE UPDATE, DELETE ON sop_approval FROM une_app;

-- 워커는 검토·승인에 관여하지 않는다(사람이 하는 일이다). 권한을 주지 않는다.

-- ===========================================================================
-- §6. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * `RETIRED`(sop.status)와 `REJECTED`/`CANCELLED`(검토 상태)를 넣지 않았다.
--     반려·철회·폐기 엔드포인트가 이번 범위에 없다 — 그 값을 만드는 경로가
--     없는 채로 어휘만 남기지 않는다(0022 §1). 0023 §4 → CC-220이 예고대로
--     넓힌 그 방식이다.
--   * 검토자별 개별 응답 테이블(`sop_review_assignee`)을 만들지 않았다.
--     UNE-SOP-009의 승인 게이트는 `SOP_APPROVE` 권한이지 지정 검토자 신원이
--     아니다. 도달하지 않는 워크플로에 테이블과 (잊기 쉬운) 자식 정책을 미리
--     만드는 것이 이 저장소가 반복해서 금지해 온 일이다.
--   * `notification`에 쓰지 않았다. 설계 10 UNE-DOC-015가 그 테이블을 함께
--     적지만 SOP 검토 요청 행에는 없고, 알림 발송은 Outbox 소관(CC-270)이다.
