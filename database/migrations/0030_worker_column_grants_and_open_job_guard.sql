-- 0030_worker_column_grants_and_open_job_guard.sql (CC-220 검토 반영)
--
-- 0028 §6이 워커에게 **테이블 단위** UPDATE를 줬다. 아키텍처 검토가 그 결과
-- 두 가지가 열린다고 지적했고 **둘 다 실측으로 확인했다**(회귀 테스트가 먼저
-- 실패하는 것을 보고 고친다).
--
--   (M1) 워커가 UNI 잡의 `request_json`을 마스킹 값으로 덮고 `redacted_at`을
--        세울 수 있었다. 그 두 컬럼은 0026 §3이 전용 롤 뒤로 격리한 바로 그
--        컬럼이고, 0029의 트리거는 마스킹 전이를 **롤과 무관하게** 허용하므로
--        트리거도 막지 못한다. `knowledge_document`도 같은 모양이라 워커가
--        `retention_scope='ORG_KB'`를 쓸 수 있었다 — ADR-36 D7이 애플리케이션
--        계층에서 막는 바로 그 값이다.
--
--   (M2) 테넌트를 세운 트랜잭션에서 워커가 **종결된** UNI 잡을 되돌릴 수
--        있었다. 미종결 조건이 permissive 정책(`p_provider_job_worker_uni_*`)
--        에만 있는데 그 정책은 `une_current_tenant_id() IS NULL`을 요구한다.
--        정산은 테넌트 스코프에서 하므로 그때는 `p_provider_job_tenant`가
--        OR로 통과하고 미종결 조건이 사라진다. 0029 §"남는 질문"이 "지금은
--        도달 경로가 없다"고 적었는데, 도달 경로는 정산 트랜잭션 자신이었다.
--
-- 고치는 방법은 둘 다 같은 원리다 — **필요한 것만 준다.**
--   컬럼 단위 GRANT로 쓸 수 있는 컬럼을 좁히고,
--   RESTRICTIVE 정책으로 쓸 수 있는 행을 좁힌다(AND로 걸리므로 스코프와 무관하다).
--
-- 테이블 수 변화 없음.

-- ===========================================================================
-- §1. 컬럼 단위 UPDATE — 러너가 실제로 쓰는 것만
-- ===========================================================================
-- provider_job: 상태 전이와 정산에 필요한 네 컬럼.
--   `request_json`·`redacted_at`이 빠졌다 → 보존 마스킹은 다시 전용 롤만의 일이다.
--   `provider_code`·`tenant_id`·`situation_id`도 빠졌다 → 잡의 정체를 바꿔
--   제한 정책을 우회할 수 없다.
REVOKE UPDATE ON provider_job FROM une_worker;
GRANT UPDATE (status, result_count, error_json, finished_at) ON provider_job TO une_worker;

-- knowledge_document: 전송 결과와 관측 결과만.
--   `retention_scope`가 빠졌다 → ADR-36 D7(기관 KB 자동승격 금지)이 DB에서도 참이다.
--   `file_id`·`document_type`·`source_sha256`·`created_by`도 빠졌다 → 워커는
--   사용자가 등록한 사실을 바꿀 수 없다.
REVOKE UPDATE ON knowledge_document FROM une_worker;
GRANT UPDATE (status, provider_document_id, error_json, uni_status, uni_observed_at,
              reference_json)
  ON knowledge_document TO une_worker;

-- ===========================================================================
-- §2. 제한 정책 — 미종결 행만, 스코프와 무관하게
-- ===========================================================================
-- RESTRICTIVE는 AND로 합쳐지므로 테넌트를 세우든 안 세우든 적용된다. 0028 §6의
-- permissive 정책들은 그대로 두되(디스패치 스코프의 가시성은 그쪽이 준다),
-- **미종결 조건의 정본은 여기다.**
--
-- `FOR UPDATE` 제한 정책은 `WITH CHECK`을 명시해야 한다 — 생략하면 `USING`이
-- 재사용되어 정산(RUNNING → SUCCEEDED)이 자기 조건에 걸려 막힌다.
DROP POLICY IF EXISTS p_provider_job_worker_open_only ON provider_job;
CREATE POLICY p_provider_job_worker_open_only ON provider_job
  AS RESTRICTIVE FOR UPDATE TO une_worker
  USING (status IN ('QUEUED', 'RUNNING'))
  WITH CHECK (provider_code = 'UNI');

-- 지식문서도 같다. 종결된 문서(FAILED/CANCELLED)는 워커가 되살리지 못한다 —
-- 되살리는 것은 사용자의 재시도(UNE-KNOW-003)뿐이고 그것은 `une_app`이 한다.
DROP POLICY IF EXISTS p_knowledge_document_worker_open_only ON knowledge_document;
CREATE POLICY p_knowledge_document_worker_open_only ON knowledge_document
  AS RESTRICTIVE FOR UPDATE TO une_worker
  USING (status IN ('PENDING_UPLOAD', 'UPLOADING', 'REGISTERED'))
  WITH CHECK (status IN ('UPLOADING', 'REGISTERED', 'FAILED'));

-- ===========================================================================
-- §3. 왜 트리거로 막지 않았는가
-- ===========================================================================
-- 0029의 트리거는 **무엇을 쓰는가**(페이로드 컬럼)를 본다. 여기서 막아야 하는
-- 것은 **누가 무엇에 쓰는가**이고, 그것은 권한과 정책의 일이다. 트리거에
-- 롤 분기를 넣으면 "이 롤은 이걸 할 수 있다"가 세 곳(GRANT·정책·트리거)에
-- 흩어져 어디를 봐야 하는지 알 수 없게 된다.
