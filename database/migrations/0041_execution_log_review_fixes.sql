-- 0041_execution_log_review_fixes.sql (CC-290 이중검토 보정)
--
-- 0040을 낸 뒤 두 검토가 찾은 것을 닫는다. 0040은 이미 적용됐으므로 고치지
-- 않고 전진 마이그레이션으로 정리한다.

-- ===========================================================================
-- §1. 워커에게 정정 권한까지 준 셈이었다
-- ===========================================================================
-- 0040 §3은 `GRANT INSERT ON execution_event`를 통째로 줬다. 그 안에
-- `corrects_event_id`가 들어 있어 워커가 정정 이벤트를 넣을 수 있다 — 0040의
-- 트리거는 **모양**만 보고 누가 쓰는지는 보지 않는다.
--
-- D4/D7이 "정정은 API 경로 하나"라고 말하지만 그 유일성이 애플리케이션 코드에만
-- 있었다. 0037 §5가 릴레이의 outbox UPDATE를 컬럼 단위로 좁힌 것과 같은 규칙을
-- 여기에도 적용한다.
REVOKE INSERT ON execution_event FROM une_worker;
GRANT INSERT (tenant_id, situation_id, aggregate_type, aggregate_id, event_type,
              actor_id, payload_json, correlation_id, event_hash)
  ON execution_event TO une_worker;

-- ===========================================================================
-- §2. 중복 제약·인덱스를 걷어낸다
-- ===========================================================================
-- 0007이 이미 만든 것을 0040이 다시 만들었다. 삽입마다 두 번 검사하고 지연성이
-- 서로 달라(0007은 DEFERRABLE, 0040은 즉시) 어느 쪽이 먼저 터지는지 예측할 수
-- 없다. **0007 쪽을 남긴다** — 그것이 원래의 설계이고 다른 FK와 지연성이 같다.
ALTER TABLE execution_event DROP CONSTRAINT IF EXISTS fk_execution_event_corrects;

-- `ix_execution_event_timeline (situation_id, occurred_at, execution_event_id)`은
-- 0007의 `ix_execution_situation_time_type (situation_id, occurred_at, event_type)`과
-- 선행 두 열이 같다. 타임라인 질의는 그것으로 충분하다.
DROP INDEX IF EXISTS ix_execution_event_timeline;

-- `ix_execution_event_fold`는 **어느 질의도 쓰지 않았다.** 0040의 주석은
-- "애그리거트별 마지막 이벤트를 접는다"며 정당화했지만 실제 fold는 애플리케이션
-- 메모리에서 일어나고, 저장소 질의는 `(tenant_id, situation_id, occurred_at)`
-- 필터에 `occurred_at` 정렬이다. 최대 볼륨 테이블에 쓰기 비용만 얹혔다.
--
-- 대신 실제 접근 경로에 맞는 것을 만든다: 상황 안에서 시간 창을 자르고
-- 애그리거트 종류로 거르는 형태다.
DROP INDEX IF EXISTS ix_execution_event_fold;
CREATE INDEX IF NOT EXISTS ix_execution_event_aggregate
  ON execution_event (situation_id, aggregate_type, occurred_at);

-- ===========================================================================
-- §3. 정정 병합을 직렬화한다
-- ===========================================================================
-- 동시 정정 두 건이 서로를 삼켰다(실측). 둘 다 원본을 기준으로 병합하므로
-- 먼저 기록된 정정의 값이 유효 payload에서 사라진다.
--
-- 서비스가 원본 행을 `FOR UPDATE`로 잡고 병합한다. DB 쪽에 더 걸 것은 없다 —
-- 원본은 append-only라 잠금이 다른 쓰기를 막지 않고, 같은 원본을 정정하는
-- 트랜잭션끼리만 줄을 선다.
COMMENT ON COLUMN execution_event.corrects_event_id IS
  '정정 대상 **원본**. 정정 이벤트만 갖고, 정정을 다시 가리킬 수 없다(0040 §1). '
  '병합은 원본 행을 FOR UPDATE로 잡고 한다 — 동시 정정이 서로를 삼키지 않게(0041 §3)';
