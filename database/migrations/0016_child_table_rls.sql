-- 0016_child_table_rls.sql (CC-125) — ADR-25 D2 "0016 후보" 종결.
-- 0015 §7 말미가 알려진 한계로 등록한 항목을 닫는다: plan_context_snapshot /
-- toc_version / toc_node / job_event 네 하위 테이블은 기준선(0008/0011)에서
-- RLS가 한 번도 켜진 적이 없어, 유일한 테넌트 보호가 애플리케이션 조인과
-- 호출부 검증 id(ADR-21 보상통제)였다. CC-125가 job_event payload_json을 mock
-- 합성 데이터에서 실 provider 원문으로 교체하므로, 이 네 테이블은 DB 레벨
-- 테넌트 격리 없이 운영될 수 없다(.claude/rules/security.md "모든
-- repository/query 경로에서 테넌트 격리 강제").
--
-- 방식. 네 테이블 모두 tenant_id 컬럼이 없다(설계 §6.x 정본 — 컬럼을 추가하면
-- 비정규화 사본이 생기고 부모와 어긋날 수 있다). 대신 부모 애그리거트로
-- EXISTS 조인하는 정책을 쓴다. 정책식 안의 참조 테이블에도 RLS가 적용되므로
-- (부모 plan/generation_job의 0008 테넌트 정책) 보호는 이중이며, 명시적인
-- `tenant_id = une_current_tenant_id()` 술어를 정책식에 함께 남겨 부모 정책이
-- 향후 완화되더라도 하위 테이블이 새는 일이 없게 한다.
--
-- une_worker 영향(의도된 결과). 워커의 job_event/toc_* 쓰기는 전부 테넌트
-- 스코프 트랜잭션에서 일어난다(services/worker/src/plan-toc/toc-job.runner.ts
-- tx B0/B1 — withTenant). 디스패치 스코프(withDispatchScope,
-- une_current_tenant_id() IS NULL)는 generation_job만 읽고 쓰며
-- (claimTocJobs / sweepCancelRequested), 이 네 테이블은 건드리지 않는다.
-- 따라서 디스패치 스코프에서 네 테이블이 0행·쓰기 거부가 되는 것은 회귀가
-- 아니라 이번 하드닝의 목표 상태다.
--
-- 인덱스. 정책의 EXISTS는 모두 기존 유니크 인덱스의 선두 컬럼을 탄다
-- (uk_job_event_seq(job_id,...), uk_toc_version_plan_version(plan_id,...),
-- uk_toc_node_version_key(toc_version_id,...),
-- uk_plan_snapshot_version(plan_id,...)) — 신규 인덱스 없음.
-- 실측(EXPLAIN ANALYZE, job 60건 x event 120건, une_app + RLS): UNE-PLAN-011의
-- SSE 조회 `... FROM job_event WHERE job_id=$1 ORDER BY sequence_no`는
-- uk_job_event_seq 스캔을 유지하고, 정책은 `hashed SubPlan`(테넌트의 job_id
-- 집합)으로 평가된다 — job_event 자체는 순차 스캔되지 않는다. 부모 집합이
-- work_mem을 넘기면 PostgreSQL이 상관 서브플랜(generation_job PK 조회)으로
-- 자동 강등하므로 두 경로 모두 인덱스로 닫힌다. 회귀 방지 단언은
-- tests/integration/src/child-table-rls.test.ts의 EXPLAIN 케이스.
--
-- 권한. 0015가 준 une_worker 테이블별 최소권한과 0011의 append-only REVOKE는
-- 그대로다. 특히 job_event의 REVOKE UPDATE, DELETE(0015 §5)는 이 마이그레이션이
-- 건드리지 않는다 — 권한(무엇을 할 수 있나)과 RLS(어느 행에 할 수 있나)는
-- 직교하는 통제이며 둘 다 유지된다.

-- ---------------------------------------------------------------------------
-- 1. job_event -> generation_job
-- ---------------------------------------------------------------------------
-- SSE 스트림과 provider 원문 보존(ADR-25 D10)의 저장소. 부모 job의 tenant_id가
-- 유일한 테넌트 근거다.
ALTER TABLE job_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_job_event_tenant ON job_event;
CREATE POLICY p_job_event_tenant ON job_event
  USING (EXISTS (
    SELECT 1 FROM generation_job j
    WHERE j.job_id = job_event.job_id
      AND j.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM generation_job j
    WHERE j.job_id = job_event.job_id
      AND j.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 2. toc_version -> plan
-- ---------------------------------------------------------------------------
ALTER TABLE toc_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE toc_version FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_toc_version_tenant ON toc_version;
CREATE POLICY p_toc_version_tenant ON toc_version
  USING (EXISTS (
    SELECT 1 FROM plan p
    WHERE p.plan_id = toc_version.plan_id
      AND p.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plan p
    WHERE p.plan_id = toc_version.plan_id
      AND p.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 3. plan_context_snapshot -> plan
-- ---------------------------------------------------------------------------
-- 불변 스냅샷(0011이 UPDATE/DELETE를 이미 회수). RLS는 "누가 읽을 수 있나"를
-- 닫는다 — context_json은 기관의 업무 기준정보 전문을 담는다.
ALTER TABLE plan_context_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_context_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_plan_context_snapshot_tenant ON plan_context_snapshot;
CREATE POLICY p_plan_context_snapshot_tenant ON plan_context_snapshot
  USING (EXISTS (
    SELECT 1 FROM plan p
    WHERE p.plan_id = plan_context_snapshot.plan_id
      AND p.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM plan p
    WHERE p.plan_id = plan_context_snapshot.plan_id
      AND p.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 4. toc_node -> toc_version -> plan (2단 조인)
-- ---------------------------------------------------------------------------
-- toc_node는 plan을 직접 참조하지 않는다. toc_version을 거쳐 plan까지 명시적으로
-- 조인한다(중간 테이블의 정책에 의존하지 않고 스스로 테넌트를 증명).
ALTER TABLE toc_node ENABLE ROW LEVEL SECURITY;
ALTER TABLE toc_node FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_toc_node_tenant ON toc_node;
CREATE POLICY p_toc_node_tenant ON toc_node
  USING (EXISTS (
    SELECT 1 FROM toc_version v
    JOIN plan p ON p.plan_id = v.plan_id
    WHERE v.toc_version_id = toc_node.toc_version_id
      AND p.tenant_id = une_current_tenant_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM toc_version v
    JOIN plan p ON p.plan_id = v.plan_id
    WHERE v.toc_version_id = toc_node.toc_version_id
      AND p.tenant_id = une_current_tenant_id()
  ));

-- ---------------------------------------------------------------------------
-- 5. 남은 하위 테이블(후속 Work Item에서 닫을 대상)
-- ---------------------------------------------------------------------------
-- 본 마이그레이션은 ADR-25 D2가 지목한 계획서/Job 계열 4개만 닫는다. 다른
-- 도메인의 tenant_id 없는 하위 테이블(dispatch, plan_context_draft, task 계열
-- 등)은 각 도메인 Work Item(CC-2xx)에서 같은 EXISTS(부모) 패턴으로 닫는다.
-- 0015 §7 말미의 "0016 후보" 주석은 이력이므로 수정하지 않는다.
