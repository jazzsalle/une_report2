-- 0017_generated_block.sql (CC-130, ADR-27) — PLAN 도메인 본문 생성 산출물(staging).
--
-- 근거. 설계 10 §3.3 UNE-PLAN-016(POST /plans/{planId}/content-jobs)의
-- 관련 테이블은 `generation_job,generated_block`이고, §7 UFR 추적표
-- (UFR-TABLE/CONTENT)도 `toc_*,job_*,generated_block`을 적는다. OpenAPI
-- une-platform-api-v1.yaml의 UNE-PLAN-016 x-db-tables에도 이름이 확정돼
-- 있다. 그런데 §6.2 물리 DDL 표에는 이 테이블 정의가 빠져 있다 — 이름·
-- 소유 API·추적표는 정본인데 컬럼 정의만 누락된, ADR-21이 이미 `plan`
-- (인덱스/타임스탬프 규칙 대 컬럼 누락)과 `generation_job`(0015 §1)에서
-- 해소한 것과 **동일 유형의 기준선 결함**이다. ADR-27이 이 유형을
-- generated_block에 대해 해소하며, 이로써 기준선 테이블 수는 59 → 60이
-- 된다(57 설계 + role_permission(ADR-22) + api_idempotency(ADR-23) +
-- generated_block(ADR-27)).
--
-- document_block(0003)과의 관계. 별개 테이블이다. document_block은
-- Revision에 매달린 **편집 문서 IR**(CC-140/150 소유)이고, generated_block은
-- provider 생성 결과가 계획서/목차 기준으로 적재되는 **생성 산출물
-- staging**이다. 사용자가 초안을 문서로 확정하는 시점에 generated_block →
-- document_block 투영이 일어난다(CC-135/CC-150). 두 테이블의
-- protection_state는 같은 어휘(NONE/USER_LOCKED/SYSTEM_LOCKED)를 쓴다 —
-- 보호 상태가 staging과 문서 사이에서 손실 없이 이동해야 하기 때문이다.
--
-- 세대 모델(행 불변 + supersede). 재생성/부분 재시도(UNE-PLAN-013)는 기존
-- 행을 덮어쓰지 않는다. 새 generation_no 행을 INSERT하고 직전 현재 행에
-- superseded_at/superseded_by_block_id만 표시한다. 따라서
--   * 현재 상태 = (plan_id, node_key) 중 superseded_at IS NULL 인 1행
--     (uk_generated_block_current 부분 유니크가 DB에서 보장),
--   * 생성 이력 = 같은 키의 모든 generation_no 행(uk_generated_block_generation).
-- 이력 삭제는 어떤 런타임 롤에도 허용하지 않는다(§4 REVOKE DELETE).
-- toc_version_id를 함께 고정하는 이유는 재현성이다: 어떤 목차 버전을
-- 기준으로 생성했는지가 블록에 남지 않으면 인용/근거 비교가 불가능해진다.
--
-- 보호 블록. "사용자가 편집한 블록은 재생성으로부터 보호된다"(CLAUDE.md
-- 비협상 도메인 규칙)는 UNE-PLAN-016의 protectedBlocks 파라미터로 요청
-- 시점에 걸러지지만, 요청 필터는 애플리케이션 층의 약속일 뿐이다. ADR-26
-- M2가 정한 "차단은 기제로 보장한다"는 원칙을 그대로 이식해, 워커 롤이
-- 보호 행을 건드리는 경로를 DB 트리거로 닫는다(§5).

-- ---------------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------------
-- IF NOT EXISTS를 쓰지 않는다: 이 이름의 테이블이 이미 있다면 그것은 본
-- 마이그레이션이 아닌 경로로 만들어진 스키마이므로 조용히 넘어가면 안 된다
-- (0001의 empty-schema 가드와 같은 취지).
CREATE TABLE generated_block (
  block_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id uuid NOT NULL,
  toc_version_id uuid NOT NULL,
  node_key varchar(80) NOT NULL,
  generation_no int NOT NULL,
  source_job_id uuid,
  block_type varchar(30) DEFAULT 'PARAGRAPH' NOT NULL,
  outline_level smallint NOT NULL,
  sort_order int DEFAULT 0 NOT NULL,
  title varchar(500) NOT NULL,
  text_content text DEFAULT '' NOT NULL,
  content_hash char(64) NOT NULL,
  citations_json jsonb DEFAULT '[]'::jsonb NOT NULL,
  citation_count int GENERATED ALWAYS AS (jsonb_array_length(citations_json)) STORED,
  status varchar(20) NOT NULL,
  protection_state varchar(20) DEFAULT 'NONE' NOT NULL,
  failure_json jsonb,
  superseded_at timestamptz,
  superseded_by_block_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE generated_block IS '본문 생성 블록(UNE-PLAN-016 산출물, 세대별 불변 + supersede)';
COMMENT ON COLUMN generated_block.block_id IS '생성 블록';
COMMENT ON COLUMN generated_block.plan_id IS '계획서';
COMMENT ON COLUMN generated_block.toc_version_id IS '생성 기준 목차 버전';
COMMENT ON COLUMN generated_block.node_key IS '목차 노드 안정 ID';
COMMENT ON COLUMN generated_block.generation_no IS '세대 번호';
COMMENT ON COLUMN generated_block.source_job_id IS '생성 Job';
COMMENT ON COLUMN generated_block.block_type IS 'PARAGRAPH/TABLE/... (IR 어휘 확정 전)';
COMMENT ON COLUMN generated_block.outline_level IS '개요 수준 1~6';
COMMENT ON COLUMN generated_block.sort_order IS '순서';
COMMENT ON COLUMN generated_block.title IS '제목';
COMMENT ON COLUMN generated_block.text_content IS '본문 텍스트';
COMMENT ON COLUMN generated_block.content_hash IS 'SHA-256';
COMMENT ON COLUMN generated_block.citations_json IS '인용/근거 배열';
COMMENT ON COLUMN generated_block.citation_count IS '인용 수(생성 컬럼)';
COMMENT ON COLUMN generated_block.status IS 'GENERATED/FAILED';
COMMENT ON COLUMN generated_block.protection_state IS 'NONE/USER_LOCKED/SYSTEM_LOCKED';
COMMENT ON COLUMN generated_block.failure_json IS '실패 상세';
COMMENT ON COLUMN generated_block.superseded_at IS '대체 시각';
COMMENT ON COLUMN generated_block.superseded_by_block_id IS '대체 블록';
COMMENT ON COLUMN generated_block.created_by IS '작성자';
COMMENT ON COLUMN generated_block.created_at IS '생성';
COMMENT ON COLUMN generated_block.updated_at IS '수정';

-- ---------------------------------------------------------------------------
-- 2. CHECK 제약 (상태 집합과 형식은 DB에서 닫는다)
-- ---------------------------------------------------------------------------
ALTER TABLE generated_block ADD CONSTRAINT ck_generated_block_generation_no
  CHECK (generation_no > 0);
-- ck_toc_node_level(0015)과 동형: 개요 수준은 화면/HWPX와 같이 1~6으로 닫는다.
ALTER TABLE generated_block ADD CONSTRAINT ck_generated_block_outline_level
  CHECK (outline_level BETWEEN 1 AND 6);
ALTER TABLE generated_block ADD CONSTRAINT ck_generated_block_content_hash
  CHECK (content_hash ~ '^[0-9a-f]{64}$');
-- citation_count(생성 컬럼)이 jsonb_array_length에 의존하므로 배열이 아닌
-- 값은 애초에 들어올 수 없어야 한다(객체를 넣으면 INSERT가 22023으로 깨진다).
ALTER TABLE generated_block ADD CONSTRAINT ck_generated_block_citations_array
  CHECK (jsonb_typeof(citations_json) = 'array');
ALTER TABLE generated_block ADD CONSTRAINT ck_generated_block_status
  CHECK (status IN ('GENERATED', 'FAILED'));
-- document_block(0003 §protection_state)과 동일 어휘 — 보호 상태가 staging과
-- 편집 문서 사이에서 변환 없이 이동한다.
ALTER TABLE generated_block ADD CONSTRAINT ck_generated_block_protection_state
  CHECK (protection_state IN ('NONE', 'USER_LOCKED', 'SYSTEM_LOCKED'));
-- 대체 표시의 일관성: 후속 블록이 지정됐는데 대체 시각이 없는 행은 없다.
-- (역은 허용 — 목차에서 사라진 노드는 후속 블록 없이 대체될 수 있다.)
ALTER TABLE generated_block ADD CONSTRAINT ck_generated_block_supersede
  CHECK (superseded_by_block_id IS NULL OR superseded_at IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. 외래키 (0007 명명/DEFERRABLE 패턴)
-- ---------------------------------------------------------------------------
-- 기준선 전체가 DEFERRABLE INITIALLY DEFERRED다: 한 트랜잭션에서 블록과
-- 부모 포인터를 함께 쓰는 경로(0015 §3)와 같은 이유로 맞춘다.
ALTER TABLE generated_block ADD CONSTRAINT fk_generated_block_plan_id
  FOREIGN KEY (plan_id) REFERENCES plan(plan_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE generated_block ADD CONSTRAINT fk_generated_block_toc_version_id
  FOREIGN KEY (toc_version_id) REFERENCES toc_version(toc_version_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE generated_block ADD CONSTRAINT fk_generated_block_source_job_id
  FOREIGN KEY (source_job_id) REFERENCES generation_job(job_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE generated_block ADD CONSTRAINT fk_generated_block_superseded_by_block_id
  FOREIGN KEY (superseded_by_block_id) REFERENCES generated_block(block_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE generated_block ADD CONSTRAINT fk_generated_block_created_by
  FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- 4. 인덱스
-- ---------------------------------------------------------------------------
-- 현재 상태의 유일성. 부분 유니크라 이력 행(superseded_at NOT NULL)은
-- 몇 세대가 쌓여도 충돌하지 않는다.
CREATE UNIQUE INDEX uk_generated_block_current
  ON generated_block(plan_id, node_key) WHERE superseded_at IS NULL;
-- 세대 재적재 멱등성: 같은 Job이 재전송돼도 같은 (계획서,노드,세대)는 1행.
CREATE UNIQUE INDEX uk_generated_block_generation
  ON generated_block(plan_id, node_key, generation_no);
-- Job 단위 결과 조회/부분 재시도 집계(UNE-PLAN-013).
CREATE INDEX ix_generated_block_job ON generated_block(source_job_id);
-- "근거 없는 현재 블록" 감사 경로(LLM 산출물의 인용 누락 탐지). 생성 컬럼을
-- 조건에 쓰므로 인덱스가 전수 스캔 없이 위반 목록을 낸다.
CREATE INDEX ix_generated_block_no_evidence
  ON generated_block(plan_id) WHERE superseded_at IS NULL AND citation_count = 0;

-- ---------------------------------------------------------------------------
-- 5. RLS: 부모 plan으로 EXISTS 조인 (0016 패턴)
-- ---------------------------------------------------------------------------
-- generated_block에는 tenant_id 컬럼이 없다(비정규화 사본이 부모와 어긋나는
-- 것을 막는 0016의 판단을 그대로 따른다). 정책식 안의 plan에도 RLS가
-- 적용되므로 보호는 이중이고, 명시적인 tenant_id 술어를 함께 남겨 부모
-- 정책이 완화되더라도 새지 않게 한다. 정책은 PERMISSIVE/TO PUBLIC/FOR ALL —
-- une_worker에도 같은 식이 적용되며, 디스패치 스코프
-- (une_current_tenant_id() IS NULL)에서는 항상 거짓이라 0행/쓰기 거부가 된다.
-- 워커의 블록 적재는 전부 테넌트 스코프 트랜잭션에서 일어난다(0016 §서두).
ALTER TABLE generated_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_block FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_generated_block_tenant ON generated_block;
CREATE POLICY p_generated_block_tenant ON generated_block
  USING (EXISTS (
    SELECT 1 FROM plan p
    WHERE p.plan_id = generated_block.plan_id
      AND p.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plan p
    WHERE p.plan_id = generated_block.plan_id
      AND p.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 6. 권한
-- ---------------------------------------------------------------------------
-- une_worker: 0015 §6의 테이블별 최소권한 스타일. 워커는 생성 결과를 넣고
-- (INSERT), 직전 세대를 대체 표시하며(UPDATE), 재시도 시 기존 세대를 읽는다
-- (SELECT). DELETE는 주지 않는다 — 생성 이력은 감사 대상이다.
GRANT SELECT, INSERT, UPDATE ON generated_block TO une_worker;

-- une_app: 0011의 ALTER DEFAULT PRIVILEGES가 신규 테이블에 SELECT/INSERT/
-- UPDATE/DELETE를 상속시킨다. 다만 그 상속은 0011을 실행한 마이그레이션
-- 주체(principal)에 매인 값이므로, 의도한 종단 상태가 주체와 무관하게
-- 성립하도록 명시 GRANT를 함께 둔다(동일 권한의 멱등 재확인).
GRANT SELECT, INSERT, UPDATE ON generated_block TO une_app;
-- 생성 이력은 삭제로 지워지지 않는다. 정정은 새 세대 행이며, 폐기는
-- superseded_at 표시다(0015 §5 job_event append-only REVOKE와 같은 취지 —
-- 여기서는 UPDATE가 supersede/보호상태 변경에 필요하므로 DELETE만 회수).
REVOKE DELETE ON generated_block FROM une_app;

-- ---------------------------------------------------------------------------
-- 7. 보호 블록 트리거 — "차단은 기제로 보장한다"(ADR-26 M2의 이식)
-- ---------------------------------------------------------------------------
-- UNE-PLAN-016은 protectedBlocks를 요청 파라미터로 받아 재생성 대상에서
-- 제외한다. 그러나 그것은 요청 매핑 층의 약속이라, 워커 코드의 결함이나
-- 재시도 경로의 누락이 곧바로 "사용자가 편집한 블록을 AI가 덮어씀"이라는
-- 도메인 규칙 위반이 된다. ADR-26 D5가 mock 플레이스홀더의 실 provider 도달을
-- 애플리케이션 규약이 아닌 기제(fail-closed)로 막은 것과 같은 방식으로,
-- 여기서는 워커 롤의 UPDATE 자체를 DB가 좁힌다.
--
-- 적용 범위. 판정은 current_user 기준이다. 런타임 워커는 une_worker로
-- 접속하고, 통합 테스트는 `SET LOCAL ROLE une_worker`로 같은 상태를 만든다
-- (SET ROLE 후 current_user = une_worker임을 tests/integration/src/
-- generated-block-rls.test.ts가 먼저 단언한다). 마이그레이션/관리 주체
-- (superuser)와 une_app에는 적용되지 않는다 — 사용자가 자기 블록의 잠금을
-- 풀거나(UNE-PLAN-016 이후 편집), 운영자가 데이터를 정정하는 경로까지
-- 트리거로 막으면 정상 업무가 불가능해지기 때문이다. 그 층의 통제는 RBAC와
-- 감사 로그다.
--
-- 허용 변경. 워커에게 열어 두는 것은 세대 전환 표시뿐이다
-- (superseded_at, superseded_by_block_id, 그리고 updated_at 트리거가 쓰는
-- updated_at). 비교를 컬럼 열거가 아니라 to_jsonb 차집합으로 하므로, 앞으로
-- 컬럼이 추가돼도 기본값이 "워커는 못 바꾼다"가 된다.
--
-- citation_count 예외. STORED 생성 컬럼은 BEFORE 트리거가 끝난 뒤 계산되므로
-- 이 시점의 NEW.citation_count는 항상 NULL이고 OLD에는 값이 있다(PostgreSQL 16
-- 동작, 실측). 비교에 넣으면 모든 워커 UPDATE가 무조건 거부돼 트리거가
-- 허용 경로까지 막는다. 파생 원본인 citations_json은 그대로 비교하므로,
-- 이 컬럼을 빼도 "워커는 인용을 못 바꾼다"는 보장은 줄지 않는다.
CREATE OR REPLACE FUNCTION une_generated_block_protect()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed_diff jsonb;
BEGIN
  IF current_user <> 'une_worker' THEN
    RETURN NEW;
  END IF;

  IF OLD.protection_state <> 'NONE' THEN
    RAISE EXCEPTION
      'generated_block %: protected block (protection_state=%) must not be modified by %',
      OLD.block_id, OLD.protection_state, current_user
      USING ERRCODE = '42501';
  END IF;

  allowed_diff := to_jsonb(NEW)
    - 'superseded_at' - 'superseded_by_block_id' - 'updated_at' - 'citation_count';
  IF allowed_diff IS DISTINCT FROM
     (to_jsonb(OLD)
        - 'superseded_at' - 'superseded_by_block_id' - 'updated_at' - 'citation_count') THEN
    RAISE EXCEPTION
      'generated_block %: % may only set superseded_at/superseded_by_block_id (regeneration writes a new generation row)',
      OLD.block_id, current_user
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- 트리거 이름 순서가 곧 실행 순서다: protect(p) → updated_at(u). 보호 판정은
-- updated_at이 갱신되기 전에 끝나며, 비교식이 updated_at을 제외하므로 순서가
-- 뒤바뀌어도 결과는 같다.
DROP TRIGGER IF EXISTS trg_generated_block_protect ON generated_block;
CREATE TRIGGER trg_generated_block_protect BEFORE UPDATE ON generated_block
  FOR EACH ROW EXECUTE FUNCTION une_generated_block_protect();

DROP TRIGGER IF EXISTS trg_generated_block_updated_at ON generated_block;
CREATE TRIGGER trg_generated_block_updated_at BEFORE UPDATE ON generated_block
  FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();
