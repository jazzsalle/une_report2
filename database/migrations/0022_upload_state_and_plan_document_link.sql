-- 0022_upload_state_and_plan_document_link.sql (CC-170) — 업로드 3단과 계획서-문서 링크.
--
-- 범위. 세 가지를 한다.
--   1) file_object에 업로드 검증 상태(upload_state/verified_at)를 세운다
--   2) plan.document_id를 한 문서에 하나로 못박는다 (역방향 링크는 만들지 않는다)
--   3) 두 컬럼을 앱 롤이 **정확히 필요한 만큼만** 쓸 수 있게 권한을 조정한다
--
-- 새 테이블은 없다. 기준선 테이블 수는 61 그대로다 — `malware_scan`을 만들지
-- 않는 이유는 ADR-32에 있다(AV 스캐너가 없는 상태에서 검사 결과 테이블을 만들면
-- 영구히 빈 테이블이 남고, 계약의 x-db-tables는 그것을 "검사한다"고 말한다).
--
-- ===========================================================================
-- §1. file_object.upload_state / verified_at — 검증 지점을 데이터로 남긴다
-- ===========================================================================
-- 0003의 file_object에는 scan_status(PENDING/CLEAN/INFECTED)뿐이다. 그것은
-- **악성코드 검사** 축이고, UNE-DOC-002가 하는 일은 다른 축이다: 선언한
-- 크기·SHA-256·형식이 저장된 바이트와 같은가.
--
-- 두 축을 한 컬럼에 밀어 넣으면(예: 검증 성공 시 scan_status='CLEAN')
-- 하지 않은 AV 검사를 했다고 감사에 기록하게 된다. AV 스캐너는 없다(OB-15).
-- 그래서 축을 하나 더 세운다.
--
-- 상태는 셋이다. PENDING(사전등록) → VERIFIED 또는 ABORTED. "전송됨"을 상태로
-- 두지 않는다 — 검증하지 않은 '올라옴'은 이후 어떤 결정의 근거도 되지 못하므로
-- 도달 가능한 상태만 늘린다.
ALTER TABLE file_object ADD COLUMN IF NOT EXISTS upload_state varchar(20);
ALTER TABLE file_object ADD COLUMN IF NOT EXISTS verified_at timestamptz;

COMMENT ON COLUMN file_object.upload_state IS 'PENDING/VERIFIED/ABORTED (업로드 검증 축)';
COMMENT ON COLUMN file_object.verified_at IS '검증 확정 시각';

-- 백필. 지금 존재하는 행은 두 경로가 만들었고 둘 다 **서버가 바이트를 손에
-- 들고** 해시를 계산했다(DocumentImportService.registerSource, Export 워커의
-- 산출물 등록). 그러므로 VERIFIED가 사실이며 시각은 생성 시각이다. 여기서
-- PENDING으로 두면 기존 문서의 원본이 갑자기 "검증되지 않은 파일"이 되어
-- UNE-DOC-003이 거부하게 된다.
UPDATE file_object
   SET upload_state = 'VERIFIED',
       verified_at = coalesce(verified_at, created_at)
 WHERE upload_state IS NULL;

ALTER TABLE file_object ALTER COLUMN upload_state SET NOT NULL;
ALTER TABLE file_object ALTER COLUMN upload_state SET DEFAULT 'PENDING';

ALTER TABLE file_object DROP CONSTRAINT IF EXISTS ck_file_object_upload_state;
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_upload_state
  CHECK (upload_state IN ('PENDING', 'VERIFIED', 'ABORTED'));

-- 상관식: 검증 시각은 VERIFIED에만 있다. 없으면 "검증되지 않았는데 검증 시각이
-- 있는" 행이 만들어지고, 그 시각을 근거로 쓰는 코드가 생긴다.
ALTER TABLE file_object DROP CONSTRAINT IF EXISTS ck_file_object_verified_shape;
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_verified_shape
  CHECK ((upload_state = 'VERIFIED') = (verified_at IS NOT NULL));

-- 0021 §2가 UPDATE를 회수하고 scan_status만 열어 두었다. 검증 확정은 이 두
-- 컬럼만 쓴다 — sha256/storage_key/size_bytes는 여전히 불변이어야 한다.
-- 다운로드 무결성 비교(UNE-DOC-014)의 기준값이 가변이면 "받은 파일이 검증받은
-- 그 파일인가"에 답할 수 없다.
GRANT UPDATE (upload_state, verified_at) ON file_object TO une_app;

-- 워커는 산출물을 등록만 한다(0020 §4는 INSERT/SELECT만 준다). 업로드 검증은
-- 워커의 일이 아니므로 여기서도 주지 않는다.

-- 폴링·정리 경로가 미완료 업로드를 찾을 때 쓴다. 완료된 행은 다수이고
-- 미완료는 소수이므로 부분 인덱스가 맞다.
CREATE INDEX IF NOT EXISTS ix_file_object_pending_upload
  ON file_object (created_at)
  WHERE upload_state = 'PENDING';

-- ===========================================================================
-- §2. plan.document_id를 한 문서에 하나로 못박는다
-- ===========================================================================
-- HwpImportRequest에는 CC-140 이래로 planId가 있었지만 **저장하는 코드가 없어**
-- 항상 무시됐다. 클라이언트는 문서를 계획서에 붙였다고 믿고 서버는 그 사실을
-- 모르는 상태다.
--
-- 링크를 새로 세우지 않는다. `plan.document_id`가 0003부터 있고(FK는 0007
-- fk_plan_document_id) plan 저장소가 이미 읽어 응답에 싣는다 — 값을 쓰는
-- 경로만 없었다. UNE-DOC-003이 그 경로다. 반대 방향(`document.plan_id`)을
-- 새로 만들면 같은 관계에 진실이 둘이 되고, 둘은 반드시 갈라진다.
--
-- 대신 없던 보장을 세운다: 한 문서를 두 계획서가 주장할 수 없다. 이것이 없으면
-- 반입을 두 번 하면 첫 계획서의 문서가 조용히 다른 계획서에 붙는다.
-- NULL은 여러 행이 가질 수 있어야 하므로(문서 없는 계획서는 정상) 부분
-- 유니크 인덱스를 쓴다.
CREATE UNIQUE INDEX IF NOT EXISTS uk_plan_document
  ON plan (document_id)
  WHERE document_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN plan.document_id IS '계획서 본문 문서 (UNE-DOC-003이 채운다)';

-- 0011의 일괄 GRANT가 plan에 UPDATE를 주었으므로 document_id도 쓸 수 있다.
-- 링크를 붙이는 것은 정상 편집이며 감사는 audit_log가 남긴다.

-- ===========================================================================
-- §3. 넣지 않은 것과 그 이유
-- ===========================================================================
--   * document.plan_id. 위 §2 참조 — 역방향 링크는 중복 진실이다.
--   * malware_scan 테이블. 위 머리말과 ADR-32 참조. 스캐너를 붙이는 항목에서
--     scan_status 전이와 함께 만든다.
--   * 업로드 티켓 테이블. 티켓은 서명된 값이며 서버가 보관할 상태가 아니다
--     (presign은 저장소가 검증하고, API_DIRECT는 HMAC을 다시 계산해 확인한다).
--     행을 만들면 만료 청소라는 새 일이 생기는데 얻는 것이 없다.
--   * upload_state의 append-only 트리거. 전이는 PENDING에서만 출발하고
--     ck_file_object_verified_shape가 모양을 잡는다. 되돌리는 UPDATE를 막는
--     것은 트리거의 일이지만, 0020 §5가 같은 판단으로 file_object의 트리거를
--     미뤘고(보존 정책 미정) 그 판단을 여기서 뒤집을 근거가 없다.
