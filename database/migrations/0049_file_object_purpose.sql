-- ===========================================================================
-- 0049. 파일은 자기가 **어떤 용도로 등록됐는지** 기억한다 (OB-19, ADR-47 D2)
-- ===========================================================================
--
-- CC-320 수직 슬라이스가 찾은 것(V-1).
--
-- UNE-KNOW-001(지식문서 등록)은 `fileId`를 받는데 **그 `fileId`를 만들 수 있는
-- API가 없었다.** UNE-DOC-001은 `HWPX_IMPORT` 용도만 열려 있었고 MIME도 HWPX
-- 둘만 받았다. 지식문서 → 근거 검색 → SOP 생성 구간 전체가 API만으로는 도달할
-- 수 없었다 — CC-220의 e2e가 `file_object` 행을 SQL로 심어 출발했기 때문에
-- 지금까지 드러나지 않았다.
--
-- 용도를 여는 김에 **용도를 저장한다.** 지금까지 `purpose`는 감사 로그의
-- detail에만 남았고 행에는 없었다. 그러면 "이 파일이 어떤 용도로 등록됐는가"를
-- 되물을 수 없고, 그 결과 두 가지가 조용히 통과한다.
--
--   ① HWPX 반입이 지식문서용으로 올라온 파일을 받는다.
--   ② 지식문서 등록이 계획서 양식으로 올라온 HWPX를 받는다.
--
-- 둘 다 "형식은 맞는데 그 자리에 올 파일이 아닌" 경우다. 용도별로 MIME·크기
-- 정책이 다르므로(HWPX는 hwpx만, 지식문서는 PDF·텍스트) 정책을 통과한 뒤에도
-- 자리를 바꿔 쓸 수 있었다.
--
-- 기존 행은 전부 `HWPX_IMPORT`다 — 그것만 등록될 수 있었기 때문이다. 그래서
-- 기본값으로 채우는 것이 추측이 아니라 사실이다.
--
-- 되돌리기: 컬럼을 DROP하면 0048 상태로 돌아간다. 다만 그 시점부터 위 ①②가
-- 다시 열린다.

ALTER TABLE file_object ADD COLUMN IF NOT EXISTS purpose varchar(30);

-- 기존 행은 HWPX_IMPORT뿐이다(다른 용도는 FILE-422-001로 거절됐다).
UPDATE file_object SET purpose = 'HWPX_IMPORT' WHERE purpose IS NULL;

ALTER TABLE file_object ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE file_object ALTER COLUMN purpose SET DEFAULT 'HWPX_IMPORT';

-- 어휘에는 **값을 만드는 코드가 있는 것만** 넣는다(0022 §1). `ATTACHMENT`는
-- CC-280 현장 첨부가 쓰므로 함께 넣는다.
ALTER TABLE file_object DROP CONSTRAINT IF EXISTS ck_file_object_purpose;
ALTER TABLE file_object ADD CONSTRAINT ck_file_object_purpose
  CHECK (purpose IN ('HWPX_IMPORT', 'KNOWLEDGE_DOCUMENT', 'ATTACHMENT'));

COMMENT ON COLUMN file_object.purpose IS
  '등록 용도 HWPX_IMPORT/KNOWLEDGE_DOCUMENT/ATTACHMENT. 용도별 MIME·크기 정책이 다르고, 소비하는 쪽이 자리를 대조한다 (OB-19)';

-- 용도별 조회가 잦지 않으므로 인덱스는 만들지 않는다. 소비 경로는 언제나
-- `file_id`로 한 행을 집는다.
