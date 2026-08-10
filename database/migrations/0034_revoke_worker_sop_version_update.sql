-- 0034_revoke_worker_sop_version_update.sql (CC-240 검토 반영)
--
-- 0032 §5가 워커에 `sop_version` **테이블 단위 UPDATE**를 줬는데 **그것을 쓰는
-- 코드가 하나도 없다.** 러너는 INSERT만 하고(`sop-repositories.ts`), 포인터
-- 이동은 0033이 `sop.current_version_id` 열 권한으로 따로 열었다.
--
-- 그 권한으로 워커는 같은 테넌트의 기존 버전에서 `graph_hash`·
-- `source_snapshot_id`·`source_evidence_set_id`·`generation_job_id`·
-- `graph_violations`를 **감사 기록 없이** 갈아치울 수 있다. ADR-38 D14가
-- `situation.current_snapshot_id`를 막은 것과 정확히 같은 종류의 위험이고,
-- 0031이 "삭제 경로가 없는데 권한이 있으면 그것이 곧 구멍이다"라고 적은 것과
-- 같은 규칙이다 — 여기서는 수정 경로가 없는데 권한이 있었다.
--
-- CLAUDE.md 비협상 규칙: 승인된 SOP Version은 불변이고 정정은 새 버전이다.
-- 지금은 `ck_sop_version_status`가 DRAFT만 허용해 승인본이 없지만, 권한을
-- 남겨 두면 CC-250이 LOCKED를 여는 순간 그 규칙이 DB 층에서 먼저 뚫린다.
--
-- 테이블 수 변화 없음(63 유지).

REVOKE UPDATE ON sop_version FROM une_worker;

COMMENT ON TABLE sop_version IS
  'SOP 버전. 워커는 INSERT만 한다 — 기존 버전 수정 경로가 없으므로 권한도 없다(0034)';

-- ===========================================================================
-- §2. 어느 어댑터가 만들었는가 — mock 산출물을 데이터 층에서 구분한다
-- ===========================================================================
-- `schema_version`에는 매퍼 버전(`uni-sop-1`)이 들어가는데, mock 어댑터도 같은
-- 매퍼를 쓰므로 **저장된 버전 행만 보면 mock 산출물과 실 UNI 산출물이 구분되지
-- 않는다.** 구분하려면 `job_event`/`audit_log`를 조인해야 하고, 보존기간이
-- 지나면 그마저 사라진다.
--
-- "mock 성공을 provider 지원으로 보고하지 않는다"는 규칙이 로그·capability
-- 문자열에만 있고 데이터에는 없었다 — 여기서 닫는다.
ALTER TABLE sop_version ADD COLUMN IF NOT EXISTS adapter_id varchar(60);
ALTER TABLE sop_version ADD COLUMN IF NOT EXISTS generated_by_mock boolean;

COMMENT ON COLUMN sop_version.adapter_id IS '이 그래프를 만든 provider 어댑터 id';
COMMENT ON COLUMN sop_version.generated_by_mock IS 'true면 mock 산출물이다 — provider 지원의 증거가 아니다';

-- 사람이 만든 버전(CC-250 캔버스 편집)에는 어댑터가 없다. 그래서 NULL을
-- 허용하되, **생성 잡이 만든 버전이면 반드시 있어야 한다** — 둘의 상관을
-- 고정해 두지 않으면 나중에 "어댑터 없는 생성본"이 조용히 섞인다.
ALTER TABLE sop_version DROP CONSTRAINT IF EXISTS ck_sop_version_generator_shape;
ALTER TABLE sop_version ADD CONSTRAINT ck_sop_version_generator_shape
  CHECK (
    (generation_job_id IS NULL AND adapter_id IS NULL AND generated_by_mock IS NULL)
    OR (generation_job_id IS NOT NULL AND adapter_id IS NOT NULL AND generated_by_mock IS NOT NULL)
  );
