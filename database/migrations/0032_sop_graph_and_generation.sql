-- 0032_sop_graph_and_generation.sql (CC-240)
--
-- UNI SOP 생성이 만드는 DRAFT 그래프.
-- 설계 08 §1.11, 설계 10 UNE-SOP-001~002, 마스터 §22.
--
-- 0005의 SOP 네 테이블도 `knowledge_document`·`evidence_set`과 같은 상태였다 —
-- 어휘 CHECK도 상관식도 FK도 없다. **그리고 `sop_version`·`sop_node`·
-- `sop_edge`에 RLS 정책이 없다**(0008은 `sop`에만 걸었다). 0011의 일괄 GRANT
-- 때문에 정책 없는 테이블은 전 테넌트 공개이고, CC-240이 첫 쓰기 경로를 연다.
-- 0023(상황), 0031(근거)에 이어 세 번째로 같은 것을 발견했다.
--
-- 테이블 수 변화 없음(63 유지).

-- ===========================================================================
-- §1. 어휘 — **도달 가능한 상태만** 넣는다
-- ===========================================================================
-- 0022 §1이 세운 원칙이고 0023 §4가 그것 때문에 `provider_job`에 QUEUED를
-- 넣지 않았다가 CC-220에서 예고대로 넓혔다. 그 방식이 실제로 통했으므로
-- 여기서도 같이 한다.
--
-- CC-240이 만드는 것은 **DRAFT SOP와 DRAFT 버전뿐**이다. 검토·승인·폐기는
-- CC-250이고, 그때 이 CHECK를 넓히는 마이그레이션이 함께 온다. 지금
-- `APPROVED`를 넣으면 그 값을 쓰는 코드가 없는 채로 어휘만 남는다.
ALTER TABLE sop DROP CONSTRAINT IF EXISTS ck_sop_status;
ALTER TABLE sop ADD CONSTRAINT ck_sop_status
  CHECK (status IN ('DRAFT'));
COMMENT ON COLUMN sop.status IS 'CC-240은 DRAFT만 만든다. IN_REVIEW/APPROVED/RETIRED는 CC-250이 연다';

ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS ck_sop_version_status;
ALTER TABLE sop_version ADD CONSTRAINT ck_sop_version_status
  CHECK (status IN ('DRAFT'));
COMMENT ON COLUMN sop_version.status IS 'CC-240은 DRAFT만 만든다. LOCKED는 승인(CC-250)이 만든다';

ALTER TABLE sop_node DROP CONSTRAINT IF EXISTS ck_sop_node_type;
ALTER TABLE sop_node ADD CONSTRAINT ck_sop_node_type
  CHECK (node_type IN ('START', 'ACTION', 'DECISION', 'NOTE', 'END'));

ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS ck_sop_version_hash;
ALTER TABLE sop_version ADD CONSTRAINT ck_sop_version_hash
  CHECK (graph_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS ck_sop_version_no;
ALTER TABLE sop_version ADD CONSTRAINT ck_sop_version_no
  CHECK (version_no >= 1);

-- 승인은 "누가 언제"가 함께 있어야 한다(0031 §2와 같은 규칙). DRAFT만 만드는
-- 지금은 둘 다 NULL이어야 한다 — 승인하지 않은 버전에 승인자가 있으면 안 된다.
ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS ck_sop_version_approval_shape;
ALTER TABLE sop_version ADD CONSTRAINT ck_sop_version_approval_shape
  CHECK (
    (approved_by IS NULL AND approved_at IS NULL)
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  );

ALTER TABLE sop_edge DROP CONSTRAINT IF EXISTS ck_sop_edge_priority;
ALTER TABLE sop_edge ADD CONSTRAINT ck_sop_edge_priority
  CHECK (priority >= 0);

-- 자기 자신으로 가는 간선은 즉시 순환이다. 그래프 검증이 잡지만 DB도 막는다.
ALTER TABLE sop_edge DROP CONSTRAINT IF EXISTS ck_sop_edge_not_self;
ALTER TABLE sop_edge ADD CONSTRAINT ck_sop_edge_not_self
  CHECK (from_node_id <> to_node_id);

-- ===========================================================================
-- §2. 매핑 경고와 검증 결과를 남긴다
-- ===========================================================================
-- 설계 08 §1.11이 "누락 필드는 Validator warning으로 반환한다"고 정했다.
-- 경고를 응답으로만 흘려보내면 화면을 닫는 순간 사라진다 — 사용자가 나중에
-- "이 노드에 무엇이 빠졌더라"를 다시 물을 수 없다.
ALTER TABLE sop_node ADD COLUMN IF NOT EXISTS mapping_warnings jsonb;
ALTER TABLE sop_version ADD COLUMN IF NOT EXISTS graph_violations jsonb;
ALTER TABLE sop_version ADD COLUMN IF NOT EXISTS generation_job_id uuid;
ALTER TABLE sop_version ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE sop_version ADD COLUMN IF NOT EXISTS created_by uuid;

COMMENT ON COLUMN sop_node.mapping_warnings IS 'UniSopMapper 경고 (설계 08 §1.11). 노드를 버리지 않고 무엇이 비었는지 남긴다';
COMMENT ON COLUMN sop_version.graph_violations IS '__done__ 이후 전체 검증 결과. 위반이 있어도 DRAFT로 저장한다 — 고칠 대상이 있어야 고친다';
COMMENT ON COLUMN sop_version.generation_job_id IS '이 그래프를 만든 SOP 생성 잡 (원문 추적)';
COMMENT ON COLUMN sop_version.schema_version IS 'UniSopMapper 버전. UNI가 바꾼 것인지 우리가 잘못 옮긴 것인지 구분한다';

UPDATE sop_version SET created_at = COALESCE(created_at, now()) WHERE created_at IS NULL;
ALTER TABLE sop_version ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE sop_version ALTER COLUMN created_at SET DEFAULT now();

-- ===========================================================================
-- §3. 관계
-- ===========================================================================
ALTER TABLE sop DROP CONSTRAINT IF EXISTS fk_sop_tenant_id;
ALTER TABLE sop ADD CONSTRAINT fk_sop_tenant_id
  FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id);

ALTER TABLE sop DROP CONSTRAINT IF EXISTS fk_sop_situation_id;
ALTER TABLE sop ADD CONSTRAINT fk_sop_situation_id
  FOREIGN KEY (situation_id) REFERENCES situation (situation_id);

ALTER TABLE sop DROP CONSTRAINT IF EXISTS fk_sop_created_by;
ALTER TABLE sop ADD CONSTRAINT fk_sop_created_by
  FOREIGN KEY (created_by) REFERENCES app_user (user_id);

ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS fk_sop_version_sop_id;
ALTER TABLE sop_version ADD CONSTRAINT fk_sop_version_sop_id
  FOREIGN KEY (sop_id) REFERENCES sop (sop_id) ON DELETE CASCADE;

-- 근거 추적. SOP는 **확정 Snapshot과 동결 EvidenceSet 위에서** 만들어진다
-- (설계 10 UNE-SOP-001 요청이 snapshotId·evidenceSetId다).
ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS fk_sop_version_snapshot;
ALTER TABLE sop_version ADD CONSTRAINT fk_sop_version_snapshot
  FOREIGN KEY (source_snapshot_id) REFERENCES situation_snapshot (snapshot_id);

ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS fk_sop_version_evidence_set;
ALTER TABLE sop_version ADD CONSTRAINT fk_sop_version_evidence_set
  FOREIGN KEY (source_evidence_set_id) REFERENCES evidence_set (evidence_set_id);

ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS fk_sop_version_generation_job;
ALTER TABLE sop_version ADD CONSTRAINT fk_sop_version_generation_job
  FOREIGN KEY (generation_job_id) REFERENCES generation_job (job_id);

ALTER TABLE sop_node DROP CONSTRAINT IF EXISTS fk_sop_node_version;
ALTER TABLE sop_node ADD CONSTRAINT fk_sop_node_version
  FOREIGN KEY (sop_version_id) REFERENCES sop_version (sop_version_id) ON DELETE CASCADE;

ALTER TABLE sop_edge DROP CONSTRAINT IF EXISTS fk_sop_edge_version;
ALTER TABLE sop_edge ADD CONSTRAINT fk_sop_edge_version
  FOREIGN KEY (sop_version_id) REFERENCES sop_version (sop_version_id) ON DELETE CASCADE;

ALTER TABLE sop_edge DROP CONSTRAINT IF EXISTS fk_sop_edge_from;
ALTER TABLE sop_edge ADD CONSTRAINT fk_sop_edge_from
  FOREIGN KEY (from_node_id) REFERENCES sop_node (node_id) ON DELETE CASCADE;

ALTER TABLE sop_edge DROP CONSTRAINT IF EXISTS fk_sop_edge_to;
ALTER TABLE sop_edge ADD CONSTRAINT fk_sop_edge_to
  FOREIGN KEY (to_node_id) REFERENCES sop_node (node_id) ON DELETE CASCADE;

-- 한 버전 안에서 노드 키는 유일하다(도메인 DUPLICATE_NODE_KEY와 같은 규칙).
DROP INDEX IF EXISTS uk_sop_node_key;
CREATE UNIQUE INDEX uk_sop_node_key ON sop_node (sop_version_id, node_key);

DROP INDEX IF EXISTS uk_sop_version_no;
CREATE UNIQUE INDEX uk_sop_version_no ON sop_version (sop_id, version_no);

CREATE INDEX IF NOT EXISTS ix_sop_situation ON sop (situation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_sop_edge_from ON sop_edge (from_node_id);

-- ===========================================================================
-- §4. RLS — 자식 세 테이블에 정책이 한 번도 없었다
-- ===========================================================================
-- `sop`만 0008이 걸었다(tenant_id 직접). 자식들은 `sop`을 거쳐 증명한다.
-- `sop_edge`는 2단 조인이다 — 0023 §3, 0031 §4와 같은 형태다.
ALTER TABLE sop_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_version FORCE ROW LEVEL SECURITY;
ALTER TABLE sop_node ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_node FORCE ROW LEVEL SECURITY;
ALTER TABLE sop_edge ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_edge FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_sop_version_tenant ON sop_version;
CREATE POLICY p_sop_version_tenant ON sop_version
  USING (EXISTS (SELECT 1 FROM sop s
                  WHERE s.sop_id = sop_version.sop_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM sop s
                       WHERE s.sop_id = sop_version.sop_id
                         AND s.tenant_id = une_current_tenant_id()));

DROP POLICY IF EXISTS p_sop_node_tenant ON sop_node;
CREATE POLICY p_sop_node_tenant ON sop_node
  USING (EXISTS (SELECT 1 FROM sop_version v JOIN sop s USING (sop_id)
                  WHERE v.sop_version_id = sop_node.sop_version_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM sop_version v JOIN sop s USING (sop_id)
                       WHERE v.sop_version_id = sop_node.sop_version_id
                         AND s.tenant_id = une_current_tenant_id()));

DROP POLICY IF EXISTS p_sop_edge_tenant ON sop_edge;
CREATE POLICY p_sop_edge_tenant ON sop_edge
  USING (EXISTS (SELECT 1 FROM sop_version v JOIN sop s USING (sop_id)
                  WHERE v.sop_version_id = sop_edge.sop_version_id
                    AND s.tenant_id = une_current_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM sop_version v JOIN sop s USING (sop_id)
                       WHERE v.sop_version_id = sop_edge.sop_version_id
                         AND s.tenant_id = une_current_tenant_id()));

-- ===========================================================================
-- §5. 워커 — SOP 생성 잡을 위해 필요한 것만
-- ===========================================================================
-- `generation_job.job_type`은 0015부터 'SOP'를 포함한다(CC-120이 예고했다).
-- 워커는 이미 `generation_job`·`job_event`에 권한이 있고 잡 유형으로 갈라
-- 집으므로(`job-dispatch.repository`) 추가 정책이 필요 없다.
--
-- 그래프 쓰기 권한만 준다. **DELETE는 주지 않는다** — 0031에서 배운 대로,
-- 삭제 경로가 없는데 권한이 있으면 그것이 곧 구멍이다.
GRANT SELECT, INSERT ON sop TO une_worker;
GRANT SELECT, INSERT, UPDATE ON sop_version TO une_worker;
GRANT SELECT, INSERT ON sop_node TO une_worker;
GRANT SELECT, INSERT ON sop_edge TO une_worker;

-- 워커는 테넌트 스코프에서 쓴다(0015가 세운 형태) — 디스패치 스코프에서는
-- 위 테넌트 정책이 0행이므로 별도 워커 정책이 필요 없다. 그것이 의도다:
-- 그래프는 항상 한 테넌트의 것이고 잡을 집을 때 그 테넌트를 알게 된다.

-- ===========================================================================
-- §6. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * `sop.status`에 IN_REVIEW/APPROVED/RETIRED를 넣지 않았다(§1).
--   * LOCKED 버전의 불변 트리거를 만들지 않았다. LOCKED를 만드는 경로가 아직
--     없으므로 지금 걸면 도달하지 않는 코드가 된다 — 승인과 함께 CC-250에서
--     온다. 0031이 EvidenceSet에 건 것과 같은 형태가 될 것이다.
--   * `position_x/y`에 제약을 걸지 않았다. 캔버스 좌표는 CC-250의 것이고
--     생성 단계에서는 비어 있다.
--   * SOP 생성 잡의 원문은 `job_event`에 남는다(0015가 세운 형태) —
--     `provider_result`가 아니다. 플랜 생성과 같은 경로를 쓰는 것이 맞고,
--     그래야 SSE 부분 이벤트가 한곳에 모인다.
