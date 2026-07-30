-- V004__situation_knowledge.sql: generated from physical DB design baseline v1.0

CREATE TABLE IF NOT EXISTS situation (
  situation_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  mode varchar(20) NOT NULL,
  title varchar(300) NOT NULL,
  hazard_type varchar(50) NOT NULL,
  status varchar(30) NOT NULL,
  occurred_at timestamptz,
  location_text varchar(500),
  current_snapshot_id uuid,
  version_no int DEFAULT 1 NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN situation.situation_id IS '상황/훈련';
COMMENT ON COLUMN situation.tenant_id IS '기관';
COMMENT ON COLUMN situation.mode IS 'LIVE/EXERCISE';
COMMENT ON COLUMN situation.title IS '상황명';
COMMENT ON COLUMN situation.hazard_type IS '재난유형';
COMMENT ON COLUMN situation.status IS 'DRAFT~CLOSED';
COMMENT ON COLUMN situation.occurred_at IS '발생';
COMMENT ON COLUMN situation.location_text IS '장소';
COMMENT ON COLUMN situation.current_snapshot_id IS '현재 Snapshot';
COMMENT ON COLUMN situation.version_no IS '낙관잠금';
COMMENT ON COLUMN situation.created_by IS '등록자';
COMMENT ON COLUMN situation.created_at IS '등록';

CREATE TABLE IF NOT EXISTS fact_source (
  source_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_code varchar(30) NOT NULL,
  source_type varchar(30) NOT NULL,
  source_name varchar(300) NOT NULL,
  source_uri text,
  retrieved_at timestamptz NOT NULL,
  raw_file_id uuid,
  license_json jsonb
);
COMMENT ON COLUMN fact_source.source_id IS '출처';
COMMENT ON COLUMN fact_source.provider_code IS 'KMA/MOIS/SAFEKOREA/NAVER/MANUAL/T3Q';
COMMENT ON COLUMN fact_source.source_type IS 'API/WEB/FILE/USER';
COMMENT ON COLUMN fact_source.source_name IS '출처명';
COMMENT ON COLUMN fact_source.source_uri IS '원문 위치';
COMMENT ON COLUMN fact_source.retrieved_at IS '수집시각';
COMMENT ON COLUMN fact_source.raw_file_id IS '원문';
COMMENT ON COLUMN fact_source.license_json IS '이용조건';

CREATE TABLE IF NOT EXISTS situation_fact (
  fact_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  situation_id uuid NOT NULL,
  fact_type varchar(50) NOT NULL,
  fact_key varchar(120) NOT NULL,
  value_json jsonb NOT NULL,
  source_id uuid NOT NULL,
  observed_at timestamptz,
  collected_at timestamptz NOT NULL,
  confidence numeric(5,4),
  status varchar(20) NOT NULL,
  version_no int DEFAULT 1 NOT NULL
);
COMMENT ON COLUMN situation_fact.fact_id IS 'Fact';
COMMENT ON COLUMN situation_fact.situation_id IS '상황';
COMMENT ON COLUMN situation_fact.fact_type IS '기상/피해/통제 등';
COMMENT ON COLUMN situation_fact.fact_key IS '표준 Key';
COMMENT ON COLUMN situation_fact.value_json IS '값/단위';
COMMENT ON COLUMN situation_fact.source_id IS '출처';
COMMENT ON COLUMN situation_fact.observed_at IS '관측';
COMMENT ON COLUMN situation_fact.collected_at IS '수집';
COMMENT ON COLUMN situation_fact.confidence IS '신뢰도';
COMMENT ON COLUMN situation_fact.status IS 'CANDIDATE/CONFIRMED/REJECTED';
COMMENT ON COLUMN situation_fact.version_no IS '버전';

CREATE TABLE IF NOT EXISTS fact_conflict (
  conflict_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  situation_id uuid NOT NULL,
  fact_key varchar(120) NOT NULL,
  candidate_fact_ids uuid[] NOT NULL,
  conflict_type varchar(30) NOT NULL,
  status varchar(20) NOT NULL,
  detected_at timestamptz NOT NULL
);
COMMENT ON COLUMN fact_conflict.conflict_id IS '충돌';
COMMENT ON COLUMN fact_conflict.situation_id IS '상황';
COMMENT ON COLUMN fact_conflict.fact_key IS 'Key';
COMMENT ON COLUMN fact_conflict.candidate_fact_ids IS '후보';
COMMENT ON COLUMN fact_conflict.conflict_type IS 'VALUE/TIME/SOURCE';
COMMENT ON COLUMN fact_conflict.status IS 'OPEN/RESOLVED';
COMMENT ON COLUMN fact_conflict.detected_at IS '탐지';

CREATE TABLE IF NOT EXISTS conflict_resolution (
  resolution_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conflict_id uuid NOT NULL,
  selected_fact_id uuid NOT NULL,
  reason text NOT NULL,
  resolved_by uuid NOT NULL,
  resolved_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN conflict_resolution.resolution_id IS '해결';
COMMENT ON COLUMN conflict_resolution.conflict_id IS '충돌';
COMMENT ON COLUMN conflict_resolution.selected_fact_id IS '채택 Fact';
COMMENT ON COLUMN conflict_resolution.reason IS '사유';
COMMENT ON COLUMN conflict_resolution.resolved_by IS '확정자';
COMMENT ON COLUMN conflict_resolution.resolved_at IS '시각';

CREATE TABLE IF NOT EXISTS situation_snapshot (
  snapshot_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  situation_id uuid NOT NULL,
  version_no int DEFAULT 1 NOT NULL,
  facts_json jsonb NOT NULL,
  content_hash char(64) NOT NULL,
  effective_at timestamptz NOT NULL,
  supersedes_id uuid,
  confirmed_by uuid NOT NULL,
  confirmed_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN situation_snapshot.snapshot_id IS 'SituationSnapshot';
COMMENT ON COLUMN situation_snapshot.situation_id IS '상황';
COMMENT ON COLUMN situation_snapshot.version_no IS '버전';
COMMENT ON COLUMN situation_snapshot.facts_json IS '불변 사실';
COMMENT ON COLUMN situation_snapshot.content_hash IS '해시';
COMMENT ON COLUMN situation_snapshot.effective_at IS '기준시각';
COMMENT ON COLUMN situation_snapshot.supersedes_id IS '이전';
COMMENT ON COLUMN situation_snapshot.confirmed_by IS '확정자';
COMMENT ON COLUMN situation_snapshot.confirmed_at IS '확정';

CREATE TABLE IF NOT EXISTS provider_job (
  provider_job_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  situation_id uuid,
  provider_code varchar(30) NOT NULL,
  request_json jsonb NOT NULL,
  status varchar(20) NOT NULL,
  result_count int NOT NULL,
  error_json jsonb,
  correlation_id varchar(80) NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN provider_job.provider_job_id IS 'Provider Job';
COMMENT ON COLUMN provider_job.situation_id IS '상황';
COMMENT ON COLUMN provider_job.provider_code IS 'Provider';
COMMENT ON COLUMN provider_job.request_json IS '요청';
COMMENT ON COLUMN provider_job.status IS '상태';
COMMENT ON COLUMN provider_job.result_count IS '결과수';
COMMENT ON COLUMN provider_job.error_json IS '오류';
COMMENT ON COLUMN provider_job.correlation_id IS '추적';
COMMENT ON COLUMN provider_job.created_at IS '생성';

CREATE TABLE IF NOT EXISTS knowledge_document (
  knowledge_document_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  situation_id uuid,
  file_id uuid NOT NULL,
  document_type varchar(40) NOT NULL,
  provider_document_id varchar(150),
  status varchar(20) NOT NULL,
  metadata_json jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN knowledge_document.knowledge_document_id IS '학습문서';
COMMENT ON COLUMN knowledge_document.tenant_id IS '기관';
COMMENT ON COLUMN knowledge_document.situation_id IS '상황';
COMMENT ON COLUMN knowledge_document.file_id IS '파일';
COMMENT ON COLUMN knowledge_document.document_type IS '매뉴얼/훈련계획/평가지침';
COMMENT ON COLUMN knowledge_document.provider_document_id IS 'UNI ID';
COMMENT ON COLUMN knowledge_document.status IS 'UPLOADING~FAILED';
COMMENT ON COLUMN knowledge_document.metadata_json IS '메타';
COMMENT ON COLUMN knowledge_document.created_by IS '등록자';
COMMENT ON COLUMN knowledge_document.created_at IS '등록';

CREATE TABLE IF NOT EXISTS evidence_set (
  evidence_set_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  situation_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  query_text text NOT NULL,
  filters_json jsonb NOT NULL,
  top_k int NOT NULL,
  status varchar(20) NOT NULL,
  content_hash char(64) NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
COMMENT ON COLUMN evidence_set.evidence_set_id IS '근거집합';
COMMENT ON COLUMN evidence_set.situation_id IS '상황';
COMMENT ON COLUMN evidence_set.snapshot_id IS '검색 Snapshot';
COMMENT ON COLUMN evidence_set.query_text IS '질의';
COMMENT ON COLUMN evidence_set.filters_json IS '필터';
COMMENT ON COLUMN evidence_set.top_k IS 'Top-K';
COMMENT ON COLUMN evidence_set.status IS 'DRAFT/LOCKED';
COMMENT ON COLUMN evidence_set.content_hash IS '해시';
COMMENT ON COLUMN evidence_set.created_by IS '생성자';
COMMENT ON COLUMN evidence_set.created_at IS '생성';

CREATE TABLE IF NOT EXISTS evidence_item (
  evidence_item_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  evidence_set_id uuid NOT NULL,
  knowledge_document_id uuid NOT NULL,
  provider_chunk_id varchar(150),
  rank_no int NOT NULL,
  score numeric(8,6),
  quote_text text NOT NULL,
  source_locator_json jsonb NOT NULL,
  citation_key varchar(80) NOT NULL
);
COMMENT ON COLUMN evidence_item.evidence_item_id IS '근거';
COMMENT ON COLUMN evidence_item.evidence_set_id IS '집합';
COMMENT ON COLUMN evidence_item.knowledge_document_id IS '문서';
COMMENT ON COLUMN evidence_item.provider_chunk_id IS 'UNI Chunk';
COMMENT ON COLUMN evidence_item.rank_no IS '순위';
COMMENT ON COLUMN evidence_item.score IS '유사도';
COMMENT ON COLUMN evidence_item.quote_text IS '근거문';
COMMENT ON COLUMN evidence_item.source_locator_json IS '페이지/청크';
COMMENT ON COLUMN evidence_item.citation_key IS '인용키';

