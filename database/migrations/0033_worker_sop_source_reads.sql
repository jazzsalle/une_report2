-- 0033_worker_sop_source_reads.sql (CC-240)
--
-- SOP 생성 러너가 읽어야 하는 근거 테이블 권한.
--
-- **실측으로 발견했다.** 0032가 SOP 그래프 쓰기 권한만 주고 끝냈는데, 러너를
-- 실제로 돌리자 `permission denied for table situation`으로 잡이 RUNNING에
-- 멈췄다. 워커는 지금까지 계획서 계열(plan/plan_context_snapshot)과 지식문서만
-- 읽었고, **상황 계열을 읽는 첫 워커 경로가 CC-240이다.**
--
-- 0031·0032에서 두 번 반복된 것과 같은 형태의 구멍이다 — 다만 그때는 RLS
-- 정책이 없었고 여기는 GRANT가 없었다. 방향이 반대라 결과도 반대다: 정책
-- 누락은 **조용히 전 테넌트 공개**였고, GRANT 누락은 **시끄럽게 실패**한다.
-- 후자가 안전한 실패다.
--
-- 테이블 수 변화 없음(63 유지).

-- ===========================================================================
-- §1. 읽기 — 생성의 입력이 되는 것들
-- ===========================================================================
-- 전부 SELECT뿐이다. SOP 생성은 확정 사실과 동결 근거를 **읽어서** 새 그래프를
-- 만드는 일이고, 입력을 고칠 이유가 없다.
GRANT SELECT ON situation          TO une_worker;  -- 제목·재난유형·상태
GRANT SELECT ON situation_snapshot TO une_worker;  -- 확정 사실 (불변)
GRANT SELECT ON evidence_set       TO une_worker;  -- 동결 근거집합
GRANT SELECT ON evidence_item      TO une_worker;  -- 근거 항목 → 문서 범위
-- knowledge_document는 0028이 이미 SELECT/UPDATE를 줬다(업로드 러너).

-- 상황·근거의 기존 테넌트 정책은 역할을 가리지 않는다(0008 §, 0023 §5,
-- 0031 §4) — `une_current_tenant_id()`만 본다. 워커는 `withTenant`로 그 값을
-- 세우고 들어오므로 별도 워커 정책이 필요 없다. 디스패치 스코프에서는 값이
-- 없어 0행이 되는데, 그것이 의도다: 잡을 집는 단계에서 상황을 읽을 일이 없다.

-- ===========================================================================
-- §2. 쓰기 — 상황 상태 한 칸만
-- ===========================================================================
-- SOP가 만들어지면 상황은 `CONTEXT_CONFIRMED` → `SOP_READY`로 간다. 그 한
-- 칸만 허용한다.
--
-- 0030에서 배운 것을 그대로 적용한다: 테이블 전체 UPDATE를 주면 워커가
-- 제목·재난유형·`current_snapshot_id`까지 바꿀 수 있고, 그 중 마지막은
-- **확정 판을 갈아치우는 것**이라 감사 기록 없이 사실이 바뀐다.
GRANT UPDATE (status) ON situation TO une_worker;

-- 열 권한만으로는 "어느 상태에서 어느 상태로"를 막지 못한다. RESTRICTIVE
-- 정책이 그것을 막는다 — permissive 정책과 AND로 묶이므로 테넌트 조건은
-- 그대로 살아 있다.
DROP POLICY IF EXISTS p_situation_worker_sop_ready_only ON situation;
CREATE POLICY p_situation_worker_sop_ready_only ON situation
  AS RESTRICTIVE FOR UPDATE TO une_worker
  USING (status = 'CONTEXT_CONFIRMED')
  WITH CHECK (status = 'SOP_READY');

COMMENT ON POLICY p_situation_worker_sop_ready_only ON situation IS
  'CC-240: 워커는 CONTEXT_CONFIRMED → SOP_READY 한 칸만 쓴다. 종결·중지 등 다른 전이는 API의 것이다';

-- SOP가 가리키는 현재 버전. 그래프를 만든 쪽이 포인터도 옮겨야 하고, 그
-- 한 열이면 충분하다 — 제목·재난유형·생성자는 워커의 것이 아니다.
GRANT UPDATE (current_version_id) ON sop TO une_worker;

-- ===========================================================================
-- §3. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * `situation`에 INSERT/DELETE를 주지 않았다. 상황을 만드는 것도 지우는
--     것도 워커의 일이 아니다.
--   * `evidence_set`·`evidence_item`에 쓰기를 주지 않았다. 동결된 근거는
--     0031의 트리거가 이미 막지만, 권한이 없으면 트리거까지 갈 일이 없다.
--   * `situation_snapshot`에 쓰기를 주지 않았다. 불변이다.
--   * `sop`에 테이블 단위 UPDATE를 주지 않았다. 그래서 러너는 `sop`을
--     `FOR UPDATE`로 잠그지 못하고, 대신 잠그지 않는다 — 이유는
--     `ensureSop` 주석에 적었다.
