-- 0024_situation_updated_at_triggers.sql (CC-200)
--
-- 0023이 `situation.updated_at`과 `situation_fact.updated_at`을 추가하면서
-- 이 저장소의 관례인 `trg_<table>_updated_at` 트리거를 함께 두지 않았다.
-- 실측(개발 DB): `plan`에는 `trg_plan_updated_at`이 있고 두 테이블에는 없다.
--
-- 컬럼만 있고 트리거가 없으면 DEFAULT now()가 INSERT 때 한 번 박히고 그 뒤로
-- 영원히 그대로다. 그러면 두 컬럼의 주석이 **거짓말이 된다**:
--   situation.updated_at       '마지막 수정 시각'
--   situation_fact.updated_at  '마지막 보정 시각 (UNE-SIT-008)'
-- 0023 §1이 이 컬럼을 넣은 이유(목록의 "최근 수정순" 근거)도 성립하지 않는다.
--
-- 애플리케이션이 매 UPDATE마다 `updated_at = now()`를 쓰는 방법도 있지만
-- 채택하지 않았다. 이 두 테이블에 쓰는 경로는 CC-200 하나가 아니다 —
-- CC-210이 CONFIRMED/REJECTED로 상태를 올리고, 그때 빠뜨리면 조용히 어긋난다.
-- `plan`이 트리거를 쓰는 것과 같은 이유이며, 규칙을 한 곳에 둔다.
--
-- 0023은 이미 적용됐으므로 고치지 않는다(.claude/rules/database.md: 전진 전용).
-- 테이블 수 변화 없음(62 유지).

CREATE TRIGGER trg_situation_updated_at
  BEFORE UPDATE ON situation
  FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();

CREATE TRIGGER trg_situation_fact_updated_at
  BEFORE UPDATE ON situation_fact
  FOR EACH ROW EXECUTE FUNCTION une_set_updated_at();
