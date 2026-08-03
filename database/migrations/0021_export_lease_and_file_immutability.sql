-- 0021_export_lease_and_file_immutability.sql (CC-160 리뷰 반영)
--
-- CC-100이 0013으로 한 것과 같은 성격이다: 0020을 고치지 않고 앞으로만 간다.
-- 아키텍처 리뷰가 지적한 두 가지를 닫는다.
--   1) export_job의 리스 근거 컬럼 부재 (M-1)
--   2) file_object의 무결성 컬럼이 앱 롤에게 가변 (m-2)
--
-- ===========================================================================
-- §1. export_job.started_at / attempt_no — 리스 회수의 근거 (M-1)
-- ===========================================================================
-- 0020의 워커 sweep은 `created_at < now() - lease`로 죽은 워커를 회수했다.
-- created_at은 **요청 시각**이지 클레임 시각이 아니다. 큐에 리스 시간보다
-- 오래 머문 Job은 클레임된 직후부터 stale 조건을 영구히 만족하므로, 워커가
-- 둘 이상이면 진행 중인 Job을 매 폴링 틱마다 재클레임한다 — 같은 문서에
-- 되쓰기·Track A·저장소 PUT이 중복 실행된다.
--
-- generation_job은 이 문제를 이미 해결해 두었다(0003:128 started_at,
-- 0015 §1의 claim이 `SET status='RUNNING', started_at = now()`). 같은 모양을
-- 쓴다 — 두 비동기 Job이 서로 다른 리스 모델을 갖는 것 자체가 결함의 원인이다.
--
-- attempt_no도 함께 둔다. 리스 회수만 있고 시도 상한이 없으면 정산이 계속
-- 실패하는 Job이 무한 재시도된다(generation_job은 max_attempts로 막는다).
ALTER TABLE export_job ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE export_job ADD COLUMN IF NOT EXISTS attempt_no integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN export_job.started_at IS '클레임 시각 (리스 회수 근거)';
COMMENT ON COLUMN export_job.attempt_no IS '시도 횟수 (무한 재시도 방지)';

ALTER TABLE export_job DROP CONSTRAINT IF EXISTS ck_export_job_attempt_no;
ALTER TABLE export_job ADD CONSTRAINT ck_export_job_attempt_no
  CHECK (attempt_no >= 0);

-- QUEUED는 아직 집히지 않았으므로 started_at을 가질 수 없다. 이 상관식이
-- 없으면 "대기 중인데 시작 시각이 있는" 행이 리스 계산을 오염시킨다.
ALTER TABLE export_job DROP CONSTRAINT IF EXISTS ck_export_job_started_shape;
ALTER TABLE export_job ADD CONSTRAINT ck_export_job_started_shape
  CHECK (status = 'QUEUED' AND started_at IS NULL OR status <> 'QUEUED');

-- 폴링 인덱스를 리스 축으로 다시 세운다. 0020의 (status, created_at)은
-- QUEUED 정렬에는 맞지만 RUNNING 회수에는 맞지 않는다.
DROP INDEX IF EXISTS ix_export_job_dispatch;
CREATE INDEX IF NOT EXISTS ix_export_job_queued
  ON export_job (created_at)
  WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS ix_export_job_running_lease
  ON export_job (started_at)
  WHERE status = 'RUNNING';

-- ===========================================================================
-- §2. file_object의 무결성 컬럼을 앱 롤에게서 회수 (m-2)
-- ===========================================================================
-- 0020 §3은 DELETE만 회수하고 주석에는 "갱신을 막는다"고 적었다. 실제로는
-- 0011의 ALL TABLES GRANT가 준 UPDATE가 그대로 남아 sha256/storage_key가
-- 가변이었다 — 다운로드 무결성 비교(UNE-DOC-014)의 **기준값**이 가변이라는
-- 뜻이다. "다운로드한 파일이 검증받은 그 파일인가"에 답할 수 없게 된다.
--
-- 트리거를 기다릴 필요가 없다. 컬럼 단위 권한으로 지금 닫는다: scan_status만
-- 열어 두면 AV 스캐너가 도착했을 때 상태 전이가 가능하고, 나머지는 append-only다.
REVOKE UPDATE ON file_object FROM une_app;
GRANT UPDATE (scan_status) ON file_object TO une_app;

-- 워커도 같다. 산출물을 등록만 하고 고치지 않는다(0020 §4는 INSERT/SELECT만
-- 주었으므로 회수할 UPDATE가 없지만, 이후 일괄 GRANT가 재도입돼도 이 의도가
-- 남도록 명시한다).
REVOKE UPDATE ON file_object FROM une_worker;

-- ===========================================================================
-- §3. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * export_job.save_mode. 설계 07 §1.10의 저장 모드는 계약(ExportRequest.
--     options.saveMode)에 있지만 CC-160은 SAVE_AS만 산출한다. 컬럼을 먼저
--     만들면 채워지지 않는 열이 생기고, 어느 모드가 실제로 쓰였는지는 여전히
--     알 수 없다. ADR-31 D14가 계약에서 옵션을 닫는 쪽을 택했으므로 컬럼도
--     그 결정이 뒤집힐 때 함께 만든다.
--   * export_job.max_attempts. generation_job은 컬럼으로 갖지만, Export는
--     재시도 정책이 워커 설정 하나뿐이라(UNE_WORKER_MAX_ATTEMPTS) 행마다
--     다른 상한을 둘 근거가 없다. 필요해지면 그때 세운다.
