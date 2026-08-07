-- 0025_duplicate_conflict_and_snapshot.sql (CC-210)
--
-- CC-200이 후보 Fact를 `status='CANDIDATE'`까지 만들어 두고 멈췄다. 이 마이그
-- 레이션은 그 다음 세 가지를 연다: 중복군, 충돌 해소, 불변 SituationSnapshot.
--
-- 0023 §8이 "CC-210의 결정 공간"이라며 미뤄 둔 세 항목을 여기서 닫는다.
--   * `fact_duplicate_group` 테이블 (계약 UNE-SIT-009 x-db-tables가 가리키는
--     이름인데 존재한 적이 없다)
--   * `situation_fact` 중복 유니크 키 → **만들지 않는다.** §3 참조.
--   * 파생 Fact 계보 → §2에서 만든다.
--
-- 테이블 수: 62 → 63 (fact_duplicate_group 1개 증가).
--
-- 착수 시점 실측(개발 DB): `fact_conflict`/`conflict_resolution`/
-- `situation_snapshot` 세 테이블 모두 **0행**이고 CHECK 제약이 하나도 없다.
-- 0023 §6이 격리(RLS)만 미리 닫아 두었고 의미는 열려 있었다. 그래서 NOT NULL
-- 컬럼 추가와 상태 어휘 고정을 백필 없이 할 수 있다.

-- ===========================================================================
-- §1. fact_duplicate_group — 계약이 가리키던 유령 테이블을 실체화한다
-- ===========================================================================
-- 설계 06 US-SIT-006 #2/#3: "category+location+timeWindow+eventKey로 그룹화",
-- "다른 Provider의 동일내용은 duplicate group으로 묶는다. **원천 Fact 각각
-- 유지**". 마지막 문장이 형태를 정한다 — 그룹은 Fact를 소유하지 않고 가리킨다.
--
-- 멤버를 별도 테이블이 아니라 `uuid[]`로 두는 이유: 0004의 `fact_conflict`가
-- 이미 `candidate_fact_ids uuid[]`로 같은 관계를 표현한다. 한 저장소 안에서
-- 같은 것을 두 형태로 표현하면 읽는 쪽이 매번 어느 쪽인지 확인해야 한다.
--
-- 그룹은 **계산 결과이지 사실이 아니다.** 전략(strategy)과 임계값(threshold)이
-- 바뀌면 다시 계산되며, 그래서 같은 상황에 대해 재계산이 이전 결과를 대체한다
-- (§1 말미의 UK). 재계산이 가능해야 설계 10 SIT-009의 `strategy,threshold`
-- 요청 파라미터가 의미를 갖는다.
CREATE TABLE IF NOT EXISTS fact_duplicate_group (
  group_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  situation_id uuid NOT NULL,
  fact_key varchar(120) NOT NULL,
  group_key text NOT NULL,
  strategy varchar(30) NOT NULL,
  threshold numeric(5,4),
  member_fact_ids uuid[] NOT NULL,
  member_count int NOT NULL,
  computed_at timestamptz DEFAULT now() NOT NULL,
  computed_by uuid NOT NULL
);
COMMENT ON TABLE fact_duplicate_group IS 'Fact 중복군 (계산 결과, UNE-SIT-009)';
COMMENT ON COLUMN fact_duplicate_group.situation_id IS '상황';
COMMENT ON COLUMN fact_duplicate_group.fact_key IS '표준 Key';
COMMENT ON COLUMN fact_duplicate_group.group_key IS '그룹화 키 (전략이 만든 문자열)';
COMMENT ON COLUMN fact_duplicate_group.strategy IS '그룹화 전략';
COMMENT ON COLUMN fact_duplicate_group.threshold IS '임계값 (전략이 쓰지 않으면 null)';
COMMENT ON COLUMN fact_duplicate_group.member_fact_ids IS '묶인 Fact (원천은 각각 유지된다)';
COMMENT ON COLUMN fact_duplicate_group.member_count IS '멤버 수 (array_length 사본 — 인덱스·정렬용)';
COMMENT ON COLUMN fact_duplicate_group.computed_at IS '계산 시각';
COMMENT ON COLUMN fact_duplicate_group.computed_by IS '계산 요청자';

ALTER TABLE fact_duplicate_group DROP CONSTRAINT IF EXISTS fk_fact_duplicate_group_situation_id;
ALTER TABLE fact_duplicate_group ADD CONSTRAINT fk_fact_duplicate_group_situation_id
  FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED;

-- 그룹은 둘 이상이어야 그룹이다. 혼자 있는 Fact를 "중복군"이라 부르면
-- 화면이 전 후보를 그룹으로 표시하게 된다.
ALTER TABLE fact_duplicate_group DROP CONSTRAINT IF EXISTS ck_fact_duplicate_group_member_count;
ALTER TABLE fact_duplicate_group ADD CONSTRAINT ck_fact_duplicate_group_member_count
  CHECK (member_count >= 2 AND member_count = coalesce(array_length(member_fact_ids, 1), 0));

-- 어휘. 도메인 DUPLICATE_STRATEGIES와 같아야 한다.
ALTER TABLE fact_duplicate_group DROP CONSTRAINT IF EXISTS ck_fact_duplicate_group_strategy;
ALTER TABLE fact_duplicate_group ADD CONSTRAINT ck_fact_duplicate_group_strategy
  CHECK (strategy IN ('KEY_TIME_WINDOW', 'KEY_ONLY'));

ALTER TABLE fact_duplicate_group DROP CONSTRAINT IF EXISTS ck_fact_duplicate_group_threshold;
ALTER TABLE fact_duplicate_group ADD CONSTRAINT ck_fact_duplicate_group_threshold
  CHECK (threshold IS NULL OR (threshold >= 0 AND threshold <= 1));

-- 한 상황 안에서 같은 group_key가 두 번 나오면 재계산이 이전 결과 위에 쌓인
-- 것이다. 재계산은 지우고 다시 넣는다(§1 머리말).
CREATE UNIQUE INDEX IF NOT EXISTS uk_fact_duplicate_group_situation_key
  ON fact_duplicate_group (situation_id, group_key);

CREATE INDEX IF NOT EXISTS ix_fact_duplicate_group_situation_time
  ON fact_duplicate_group (situation_id, computed_at DESC);

ALTER TABLE fact_duplicate_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_duplicate_group FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_fact_duplicate_group_tenant ON fact_duplicate_group;
CREATE POLICY p_fact_duplicate_group_tenant ON fact_duplicate_group
  USING (EXISTS (
    SELECT 1 FROM situation s
    WHERE s.situation_id = fact_duplicate_group.situation_id
      AND s.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM situation s
    WHERE s.situation_id = fact_duplicate_group.situation_id
      AND s.tenant_id = une_current_tenant_id()
  ));

-- 0011의 ALTER DEFAULT PRIVILEGES가 신규 테이블에 기본 권한을 주지만 이
-- 마이그레이션만 읽고도 알 수 있도록 명시한다(0017 §4·0023 §5와 같은 취지).
-- **DELETE를 회수하지 않는다** — 재계산이 이전 그룹을 지우고 다시 넣는다.
-- 이것은 증거가 아니라 계산 결과다.
GRANT SELECT, INSERT, DELETE ON fact_duplicate_group TO une_app;
REVOKE UPDATE ON fact_duplicate_group FROM une_app;

-- ===========================================================================
-- §2. situation_fact — 파생 Fact 계보
-- ===========================================================================
-- 설계 06 US-SIT-007 #3: "수정 시 derived Fact를 생성한다. originalFactId·
-- actor·reason 기록", 완료조건 "원천 불변". §7.1 주요 데이터도 "원천 Fact
-- 불변. 수정 시 파생 Fact 생성"이다.
--
-- CC-200의 UNE-SIT-008은 제자리 UPDATE였고 ADR-33 수용 한계 12가 그 어긋남을
-- 기록해 두었다. 사용자 결정(2026-08-08)으로 설계 쪽으로 맞춘다.
-- CLAUDE.md 비협상 규칙("Corrections are new versions or correction events;
-- never overwrite audit history")과도 이쪽이 같은 선이다.
--
-- 실질적 이득이 하나 더 있다: 확정된 Snapshot이 가리키는 Fact 행이 나중에
-- 보정으로 **덮이지 않는다.** 제자리 UPDATE에서는 Snapshot이 참조하는 근거의
-- 값이 사후에 바뀔 수 있었다.
ALTER TABLE situation_fact ADD COLUMN IF NOT EXISTS original_fact_id uuid;
COMMENT ON COLUMN situation_fact.original_fact_id IS '파생 원본 Fact (null이면 원천)';

ALTER TABLE situation_fact ADD COLUMN IF NOT EXISTS derived_by uuid;
COMMENT ON COLUMN situation_fact.derived_by IS '파생을 만든 사용자';

ALTER TABLE situation_fact ADD COLUMN IF NOT EXISTS derived_reason text;
COMMENT ON COLUMN situation_fact.derived_reason IS '보정 사유 (설계 06 US-SIT-007 완료조건)';

ALTER TABLE situation_fact DROP CONSTRAINT IF EXISTS fk_situation_fact_original_fact_id;
ALTER TABLE situation_fact ADD CONSTRAINT fk_situation_fact_original_fact_id
  FOREIGN KEY (original_fact_id) REFERENCES situation_fact(fact_id) DEFERRABLE INITIALLY DEFERRED;

-- 파생이면 actor와 사유가 함께 있어야 한다. 셋을 따로 두면 "누가 왜 고쳤는지
-- 모르는 파생 Fact"가 만들어지고, 그것은 설계 06의 완료조건
-- ("모든 선택에 actor/time/source 추적")을 통과하지 못한다.
ALTER TABLE situation_fact DROP CONSTRAINT IF EXISTS ck_situation_fact_derivation_shape;
ALTER TABLE situation_fact ADD CONSTRAINT ck_situation_fact_derivation_shape
  CHECK (
    (original_fact_id IS NULL AND derived_by IS NULL AND derived_reason IS NULL)
    OR (original_fact_id IS NOT NULL AND derived_by IS NOT NULL AND derived_reason IS NOT NULL)
  );

-- 자기 자신에서 파생될 수 없다.
ALTER TABLE situation_fact DROP CONSTRAINT IF EXISTS ck_situation_fact_derivation_not_self;
ALTER TABLE situation_fact ADD CONSTRAINT ck_situation_fact_derivation_not_self
  CHECK (original_fact_id IS NULL OR original_fact_id <> fact_id);

-- 상태 어휘 확장: SUPERSEDED.
--
-- 0022 §1의 "도달 가능한 상태만" 원칙을 지킨다 — CC-200에서는 이 값이 도달
-- 불가능했지만 파생 Fact 경로가 열리는 지금 도달 가능해진다. 원본은 지우지
-- 않고 SUPERSEDED로 남는다(REJECTED가 아니다: 거부는 "채택하지 않기로 한
-- 판단"이고 SUPERSEDED는 "더 최신 파생이 있다"이며 둘은 다른 사실이다).
ALTER TABLE situation_fact DROP CONSTRAINT IF EXISTS ck_situation_fact_status;
ALTER TABLE situation_fact ADD CONSTRAINT ck_situation_fact_status
  CHECK (status IN ('CANDIDATE', 'CONFIRMED', 'REJECTED', 'SUPERSEDED'));

-- 파생 계보 조회 + **원본당 파생은 하나**.
--
-- 애플리케이션은 원본이 CANDIDATE일 때만 파생을 만들고 즉시 SUPERSEDED로
-- 내리므로 둘이 생길 수 없지만, 그 보장이 조건문 하나에만 걸려 있다.
-- 유니크로 한 겹 더 둔다(아키텍처 리뷰 파생 계보 판정).
CREATE UNIQUE INDEX IF NOT EXISTS uk_situation_fact_original
  ON situation_fact (original_fact_id)
  WHERE original_fact_id IS NOT NULL;

-- ===========================================================================
-- §3. situation_fact 중복 유니크 키 — 여전히 만들지 않는다
-- ===========================================================================
-- 0023 §3 말미가 "CC-210의 결정 공간"이라며 미뤄 둔 것이고, 여기서 **만들지
-- 않기로 결정한다.**
--
-- 이유: 중복은 제약이 아니라 **판정**이다. 서로 다른 Provider가 같은 사실을
-- 보내는 것은 정상이고(설계 06 US-SIT-006 #3 "원천 Fact 각각 유지"),
-- 같은 Provider가 같은 키를 다른 시각에 갱신하는 것도 정상이다. 유니크 키를
-- 박으면 두 번째 Provider의 응답이 23505로 떨어지고, 그것은 "중복을 막은 것"이
-- 아니라 **수집을 막은 것**이다. 중복군은 §1이 계산해서 사용자에게 보여 준다.
-- 같은 수집을 두 번 눌렀을 때의 보호는 그대로 Idempotency-Key(0014)다.

-- ===========================================================================
-- §4. fact_conflict — 어휘와 형태
-- ===========================================================================
-- 0004의 컬럼 주석이 정본이다: conflict_type 'VALUE/TIME/SOURCE',
-- status 'OPEN/RESOLVED'. 주석은 오타를 막지 못하므로 CHECK로 굳힌다
-- (0023 §1과 같은 판단).
ALTER TABLE fact_conflict DROP CONSTRAINT IF EXISTS ck_fact_conflict_type;
ALTER TABLE fact_conflict ADD CONSTRAINT ck_fact_conflict_type
  CHECK (conflict_type IN ('VALUE', 'TIME', 'SOURCE'));

-- 0004의 주석은 OPEN/RESOLVED 둘이지만 셋째가 필요하다.
--
-- 보정(파생 Fact)으로 값이 같아지면 그 충돌은 **더 이상 존재하지 않는다.**
-- 그런데 사용자가 명시적으로 해소한 것은 아니므로 RESOLVED로 적으면 하지 않은
-- 선택을 기록하게 되고, OPEN으로 두면 존재하지 않는 충돌이 확정을 영구 차단한다
-- (아키텍처 리뷰 M-3). 그래서 재계산이 닫는 자리를 따로 둔다.
ALTER TABLE fact_conflict DROP CONSTRAINT IF EXISTS ck_fact_conflict_status;
ALTER TABLE fact_conflict ADD CONSTRAINT ck_fact_conflict_status
  CHECK (status IN ('OPEN', 'RESOLVED', 'OBSOLETE'));

-- 충돌도 둘 이상이어야 충돌이다.
ALTER TABLE fact_conflict DROP CONSTRAINT IF EXISTS ck_fact_conflict_candidates;
ALTER TABLE fact_conflict ADD CONSTRAINT ck_fact_conflict_candidates
  CHECK (coalesce(array_length(candidate_fact_ids, 1), 0) >= 2);

ALTER TABLE fact_conflict DROP CONSTRAINT IF EXISTS fk_fact_conflict_situation_id;
ALTER TABLE fact_conflict ADD CONSTRAINT fk_fact_conflict_situation_id
  FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED;

-- 충돌의 단위는 **그룹의 단위와 같아야 한다.**
--
-- 처음에는 (situation_id, fact_key)로 두었는데, §1의 그룹 정체성은
-- `group_key`(= 범주+Key+시간창)라 축이 어긋났다. 그러면 같은 Key의 서로 다른
-- 시간창이 각각 충돌을 만들 때 **두 번째 INSERT가 유니크에 걸려 조용히
-- 사라지고**, 첫 충돌만 해소하면 미해결 불일치가 남아 있는데도 확정이 통과한다
-- (인수기준 1이 우회된다). 아키텍처 리뷰 B-1.
ALTER TABLE fact_conflict ADD COLUMN IF NOT EXISTS group_key text;
COMMENT ON COLUMN fact_conflict.group_key IS '그룹화 키 (충돌의 단위 = 그룹의 단위)';

ALTER TABLE fact_conflict DROP CONSTRAINT IF EXISTS ck_fact_conflict_group_key;
ALTER TABLE fact_conflict ADD CONSTRAINT ck_fact_conflict_group_key
  CHECK (group_key IS NULL OR length(group_key) > 0);

DROP INDEX IF EXISTS uk_fact_conflict_open_per_key;
CREATE UNIQUE INDEX IF NOT EXISTS uk_fact_conflict_open_per_group
  ON fact_conflict (situation_id, group_key)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS ix_fact_conflict_situation_status
  ON fact_conflict (situation_id, status, detected_at DESC);

-- 충돌은 탐지 사실이다. 상태가 OPEN → RESOLVED로 한 번 바뀌므로 UPDATE는
-- 남기고 DELETE만 회수한다 — 지우면 "그때 무엇이 어긋났는가"가 사라진다.
REVOKE DELETE ON fact_conflict FROM une_app;

-- ===========================================================================
-- §5. conflict_resolution — 한 번 정해지면 바뀌지 않는다
-- ===========================================================================
-- 설계 06 US-SIT-007 완료조건: "모든 선택에 actor/time/source 추적, 원천 불변".
-- 결정을 덮어쓸 수 있으면 "누가 무엇을 선택했는가"의 이력이 사라진다. 다시
-- 정하려면 충돌을 다시 열고 새 해소를 남긴다(§4의 부분 유니크가 그것을 허용).
ALTER TABLE conflict_resolution DROP CONSTRAINT IF EXISTS fk_conflict_resolution_conflict_id;
ALTER TABLE conflict_resolution ADD CONSTRAINT fk_conflict_resolution_conflict_id
  FOREIGN KEY (conflict_id) REFERENCES fact_conflict(conflict_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE conflict_resolution DROP CONSTRAINT IF EXISTS fk_conflict_resolution_selected_fact_id;
ALTER TABLE conflict_resolution ADD CONSTRAINT fk_conflict_resolution_selected_fact_id
  FOREIGN KEY (selected_fact_id) REFERENCES situation_fact(fact_id) DEFERRABLE INITIALLY DEFERRED;

-- 한 충돌에 해소는 하나다.
CREATE UNIQUE INDEX IF NOT EXISTS uk_conflict_resolution_conflict
  ON conflict_resolution (conflict_id);

REVOKE UPDATE, DELETE ON conflict_resolution FROM une_app;

-- ===========================================================================
-- §6. situation_snapshot — 불변·버전·해시
-- ===========================================================================
-- 0011 §3이 이미 UPDATE/DELETE를 회수했고 0023 §6이 격리를 닫았다. 남은 것은
-- **형태**다. 설계 06 US-SIT-008 인수기준: "확정 후 변경 0건, 재확정은 새
-- snapshotId".
ALTER TABLE situation_snapshot DROP CONSTRAINT IF EXISTS fk_situation_snapshot_situation_id;
ALTER TABLE situation_snapshot ADD CONSTRAINT fk_situation_snapshot_situation_id
  FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE situation_snapshot DROP CONSTRAINT IF EXISTS fk_situation_snapshot_supersedes_id;
ALTER TABLE situation_snapshot ADD CONSTRAINT fk_situation_snapshot_supersedes_id
  FOREIGN KEY (supersedes_id) REFERENCES situation_snapshot(snapshot_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE situation_snapshot DROP CONSTRAINT IF EXISTS ck_situation_snapshot_version_no;
ALTER TABLE situation_snapshot ADD CONSTRAINT ck_situation_snapshot_version_no
  CHECK (version_no >= 1);

-- 해시는 정규화 JSON의 SHA-256이다. 형식을 굳혀 두면 "해시 자리에 다른 것이
-- 들어온" 상태가 저장되지 않는다(plan_context_snapshot의 content_hash와 같은
-- 취급이며 situation-snapshot.schema.json의 pattern과도 같다).
ALTER TABLE situation_snapshot DROP CONSTRAINT IF EXISTS ck_situation_snapshot_content_hash;
ALTER TABLE situation_snapshot ADD CONSTRAINT ck_situation_snapshot_content_hash
  CHECK (content_hash ~ '^[a-f0-9]{64}$');

-- 확정된 Snapshot은 사실을 하나 이상 담는다. 빈 Snapshot은 "확정했다"는
-- 기록일 뿐 기준 상황이 아니다(스키마의 facts minItems: 1과 같은 선).
ALTER TABLE situation_snapshot DROP CONSTRAINT IF EXISTS ck_situation_snapshot_facts_not_empty;
ALTER TABLE situation_snapshot ADD CONSTRAINT ck_situation_snapshot_facts_not_empty
  CHECK (jsonb_typeof(facts_json) = 'array' AND jsonb_array_length(facts_json) >= 1);

-- 버전은 상황 안에서 유일하다. "재확정은 새 snapshotId"이면서 동시에
-- 버전이 겹치면 어느 것이 vN인지 답할 수 없다.
CREATE UNIQUE INDEX IF NOT EXISTS uk_situation_snapshot_version
  ON situation_snapshot (situation_id, version_no);

-- 계보는 한 줄이다. 두 Snapshot이 같은 것을 대체할 수 없다.
CREATE UNIQUE INDEX IF NOT EXISTS uk_situation_snapshot_supersedes
  ON situation_snapshot (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_situation_snapshot_situation_version
  ON situation_snapshot (situation_id, version_no DESC);

-- 아래 셋은 0007이 이미 만든 것을 **재확인**한다(DROP/ADD가 동치라 무해하다).
-- 처음에는 "FK가 없었다"고 적었는데 `0007_foreign_keys_indexes.sql`에 이미
-- 있었다 — 다음 사람이 읽을 근거가 틀리면 안 되므로 바로잡는다(리뷰 m-1).
ALTER TABLE situation DROP CONSTRAINT IF EXISTS fk_situation_current_snapshot_id;
ALTER TABLE situation ADD CONSTRAINT fk_situation_current_snapshot_id
  FOREIGN KEY (current_snapshot_id) REFERENCES situation_snapshot(snapshot_id)
  DEFERRABLE INITIALLY DEFERRED;

-- ===========================================================================
-- §7. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * `situation_fact` 중복 유니크 키. §3 — 만들지 않기로 **결정**했다.
--     0023이 미룬 항목이 여기서 닫힌다.
--   * 파생 Fact의 깊이 제한. 파생의 파생을 DB에서 막지 않는다 — 보정을 여러
--     번 하는 것은 정상이고, 계보가 길어지는 것 자체는 결함이 아니다.
--     순환은 §2의 not_self와 애플리케이션의 원본 조회로 막는다.
--   * `fact_duplicate_group` 보존기간. 계산 결과이므로 재계산이 대체하며,
--     원문 보존과 달리 증거가 아니다. OB-16의 대상이 아니다.
--   * 확정 시 MFA/재인증(설계 06 US-SIT-008 #2 "MFA/재인증 정책 가능").
--     인증 수준 정본이 아직 없다(ADR-32 D17의 미반영 지적과 같은 자리).
--     ADR-34 수용 한계에 남긴다.
