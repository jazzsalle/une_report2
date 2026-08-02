# DB Data Dictionary

<!-- GENERATED FILE - do not edit. Regenerate with: pnpm db:data-dictionary -->

적용된 마이그레이션에서 자동 생성된 데이터 사전이다 (G-DB 게이트 증거).
스키마 변경 시 `pnpm db:data-dictionary`로 재생성해 커밋한다 (CI가 drift를 차단).

- 테이블 수: 60
- 적용 마이그레이션: 0001_extensions_and_common, 0002_iam, 0003_plan_document, 0004_situation_knowledge, 0005_sop_task, 0006_event_journal_admin, 0007_foreign_keys_indexes, 0008_row_level_security, 0009_seed_codes, 0010_execution_event_partitioning_plan, 0011_force_rls_and_app_role_grants, 0012_rbac_catalog, 0013_iam_hardening, 0014_api_idempotency, 0015_generation_job_worker_and_toc, 0016_child_table_rls, 0017_generated_block

## api_idempotency

멱등키 재생 저장소 (ADR-23)
- 격리: RLS enforced (FORCE)
- api_idempotency_pkey: PRIMARY KEY (idempotency_id)
- ck_api_idempotency_completed: CHECK ((((state)::text = 'COMPLETED'::text) = ((response_status IS NOT NULL) AND (completed_at IS NOT NULL))))
- ck_api_idempotency_state: CHECK (((state)::text = ANY ((ARRAY['IN_PROGRESS'::character varying, 'COMPLETED'::character varying, 'FAILED'::character varying])::text[])))
- ck_api_idempotency_status_range: CHECK (((response_status IS NULL) OR ((response_status >= 100) AND (response_status <= 599))))
- fk_api_idempotency_tenant: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id)
- 인덱스: api_idempotency_pkey, uk_api_idempotency_key

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| idempotency_id | uuid | NN | gen_random_uuid() | 재생 레코드 |
| tenant_id | uuid | NN |  | 기관 |
| endpoint | character varying(200) | NN |  | METHOD 경로템플릿 |
| idempotency_key | character varying(100) | NN |  | 멱등키 |
| request_hash | character(64) | NN |  | 요청 SHA-256 |
| state | character varying(20) | NN | 'IN_PROGRESS'::character varying | IN_PROGRESS/COMPLETED/FAILED |
| response_status | integer | - |  | 재생 상태코드 |
| response_body | jsonb | - |  | 재생 응답 |
| correlation_id | character varying(80) | NN |  | 추적 |
| created_by | uuid | NN |  | 요청자 |
| created_at | timestamp with time zone | NN | now() | 최초 수신 |
| claimed_at | timestamp with time zone | NN | now() | 최근 선점 |
| completed_at | timestamp with time zone | - |  | 완료 |

## app_user

- 격리: RLS enforced (FORCE)
- app_user_pkey: PRIMARY KEY (user_id)
- fk_app_user_organization_id: FOREIGN KEY (organization_id) REFERENCES organization(organization_id) DEFERRABLE INITIALLY DEFERRED
- fk_app_user_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- uk_app_user_external_user_id: UNIQUE (external_user_id)
- 인덱스: app_user_pkey, uk_app_user_external_user_id

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| user_id | uuid | NN | gen_random_uuid() | 사용자 |
| tenant_id | uuid | NN |  | 기관 |
| external_user_id | character varying(100) | - |  | T3Q 외부 사용자 ID |
| login_id | character varying(100) | NN |  | 로그인 ID |
| display_name | character varying(100) | NN |  | 성명 |
| organization_id | uuid | - |  | 소속 |
| email_enc | bytea | - |  | 암호화 이메일 |
| phone_enc | bytea | - |  | 암호화 전화번호 |
| status | character varying(20) | NN |  | 상태 |
| last_login_at | timestamp with time zone | - |  | 최근 로그인 |

## audit_log

- 격리: RLS enforced (FORCE)
- audit_log_pkey: PRIMARY KEY (audit_id)
- fk_audit_log_actor_id: FOREIGN KEY (actor_id) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_audit_log_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: audit_log_pkey, ix_audit_tenant_time

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| audit_id | uuid | NN | gen_random_uuid() | 감사 |
| tenant_id | uuid | NN |  | 기관 |
| actor_id | uuid | - |  | 행위자 |
| action | character varying(80) | NN |  | 행위 |
| resource_type | character varying(40) | NN |  | 자원 |
| resource_id | uuid | - |  | 대상 |
| before_json | jsonb | - |  | 변경전 |
| after_json | jsonb | - |  | 변경후 |
| correlation_id | character varying(80) | NN |  | 추적 |
| ip_address | inet | - |  | IP |
| user_agent | text | - |  | UA |
| occurred_at | timestamp with time zone | NN | now() | 시각 |

## change_operation

- 격리: RLS 없음
- change_operation_pkey: PRIMARY KEY (operation_id)
- fk_change_operation_change_set_id: FOREIGN KEY (change_set_id) REFERENCES change_set(change_set_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: change_operation_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| operation_id | uuid | NN | gen_random_uuid() | Operation |
| change_set_id | uuid | NN |  | ChangeSet |
| operation_order | integer | NN |  | 순서 |
| operation_type | character varying(40) | NN |  | insertText 등 |
| target_json | jsonb | NN |  | 대상 |
| before_json | jsonb | - |  | 변경전 |
| after_json | jsonb | - |  | 변경후 |

## change_set

- 격리: RLS 없음
- change_set_pkey: PRIMARY KEY (change_set_id)
- fk_change_set_base_revision_id: FOREIGN KEY (base_revision_id) REFERENCES document_revision(revision_id) DEFERRABLE INITIALLY DEFERRED
- fk_change_set_document_id: FOREIGN KEY (document_id) REFERENCES document(document_id) DEFERRABLE INITIALLY DEFERRED
- fk_change_set_result_revision_id: FOREIGN KEY (result_revision_id) REFERENCES document_revision(revision_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: change_set_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| change_set_id | uuid | NN | gen_random_uuid() | 변경세트 |
| document_id | uuid | NN |  | 문서 |
| base_revision_id | uuid | NN |  | 기준 |
| result_revision_id | uuid | - |  | 결과 |
| client_mutation_id | character varying(100) | NN |  | 클라이언트 멱등키 |
| selection_json | jsonb | NN |  | 선택영역 |
| status | character varying(20) | NN |  | APPLIED/REJECTED |
| created_by | uuid | NN |  | 사용자 |
| created_at | timestamp with time zone | NN | now() | 시각 |

## conflict_resolution

- 격리: RLS 없음
- conflict_resolution_pkey: PRIMARY KEY (resolution_id)
- fk_conflict_resolution_conflict_id: FOREIGN KEY (conflict_id) REFERENCES fact_conflict(conflict_id) DEFERRABLE INITIALLY DEFERRED
- fk_conflict_resolution_resolved_by: FOREIGN KEY (resolved_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_conflict_resolution_selected_fact_id: FOREIGN KEY (selected_fact_id) REFERENCES situation_fact(fact_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: conflict_resolution_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| resolution_id | uuid | NN | gen_random_uuid() | 해결 |
| conflict_id | uuid | NN |  | 충돌 |
| selected_fact_id | uuid | NN |  | 채택 Fact |
| reason | text | NN |  | 사유 |
| resolved_by | uuid | NN |  | 확정자 |
| resolved_at | timestamp with time zone | NN | now() | 시각 |

## dispatch

- 격리: RLS 없음
- dispatch_pkey: PRIMARY KEY (dispatch_id)
- fk_dispatch_created_by: FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_dispatch_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- fk_dispatch_task_id: FOREIGN KEY (task_id) REFERENCES task(task_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: dispatch_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| dispatch_id | uuid | NN | gen_random_uuid() | 전파 |
| task_id | uuid | - |  | 임무 |
| situation_id | uuid | NN |  | 상황 |
| message_type | character varying(30) | NN |  | SITUATION/TASK/ESCALATION |
| message_body | text | NN |  | 내용 |
| status | character varying(20) | NN |  | PENDING~PARTIAL |
| created_by | uuid | NN |  | 발신자 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## dispatch_recipient

- 격리: RLS 없음
- dispatch_recipient_pkey: PRIMARY KEY (recipient_id)
- fk_dispatch_recipient_dispatch_id: FOREIGN KEY (dispatch_id) REFERENCES dispatch(dispatch_id) DEFERRABLE INITIALLY DEFERRED
- fk_dispatch_recipient_organization_id: FOREIGN KEY (organization_id) REFERENCES organization(organization_id) DEFERRABLE INITIALLY DEFERRED
- fk_dispatch_recipient_user_id: FOREIGN KEY (user_id) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: dispatch_recipient_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| recipient_id | uuid | NN | gen_random_uuid() | 수신자 |
| dispatch_id | uuid | NN |  | 전파 |
| user_id | uuid | - |  | 사용자 |
| organization_id | uuid | - |  | 조직 |
| channel | character varying(20) | NN |  | SYSTEM/SMS/EMAIL/PUSH |
| address_enc | bytea | - |  | 암호화 주소 |
| delivery_status | character varying(20) | NN |  | PENDING~FAILED |
| acknowledged_at | timestamp with time zone | - |  | 수신확인 |

## document

- 격리: RLS enforced (FORCE)
- document_pkey: PRIMARY KEY (document_id)
- fk_document_current_revision_id: FOREIGN KEY (current_revision_id) REFERENCES document_revision(revision_id) DEFERRABLE INITIALLY DEFERRED
- fk_document_source_file_id: FOREIGN KEY (source_file_id) REFERENCES file_object(file_id) DEFERRABLE INITIALLY DEFERRED
- fk_document_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: document_pkey, ix_document_tenant_status_updated

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| document_id | uuid | NN | gen_random_uuid() | 문서 |
| tenant_id | uuid | NN |  | 기관 |
| document_type | character varying(30) | NN |  | PLAN/JOURNAL |
| title | character varying(300) | NN |  | 제목 |
| source_file_id | uuid | - |  | 원본 HWPX |
| current_revision_id | uuid | - |  | 현재 Revision |
| status | character varying(30) | NN |  | EDITING/REVIEW/APPROVED |
| owner_id | uuid | NN |  | 소유자 |
| created_at | timestamp with time zone | NN | now() | 생성 |
| updated_at | timestamp with time zone | NN | now() | 수정 |

## document_block

- 격리: RLS 없음
- document_block_pkey: PRIMARY KEY (block_id)
- fk_document_block_parent_block_id: FOREIGN KEY (parent_block_id) REFERENCES document_block(block_id) DEFERRABLE INITIALLY DEFERRED
- fk_document_block_revision_id: FOREIGN KEY (revision_id) REFERENCES document_revision(revision_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: document_block_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| block_id | uuid | NN | gen_random_uuid() | Block |
| revision_id | uuid | NN |  | Revision |
| stable_block_key | character varying(100) | NN |  | 안정 ID |
| block_type | character varying(30) | NN |  | PARAGRAPH/TABLE/... |
| parent_block_id | uuid | - |  | 부모 |
| sort_order | integer | NN | 0 | 순서 |
| text_content | text | - |  | 검색용 텍스트 |
| style_ref | character varying(100) | - |  | 서식 참조 |
| protection_state | character varying(20) | NN |  | NONE/USER_LOCKED/SYSTEM_LOCKED |
| payload_json | jsonb | NN |  | IR 세부 |

## document_revision

- 격리: RLS 없음
- document_revision_pkey: PRIMARY KEY (revision_id)
- fk_document_revision_created_by: FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_document_revision_document_id: FOREIGN KEY (document_id) REFERENCES document(document_id) DEFERRABLE INITIALLY DEFERRED
- fk_document_revision_parent_revision_id: FOREIGN KEY (parent_revision_id) REFERENCES document_revision(revision_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: document_revision_pkey, uk_document_revision_no

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| revision_id | uuid | NN | gen_random_uuid() | Revision |
| document_id | uuid | NN |  | 문서 |
| revision_no | integer | NN |  | 순번 |
| parent_revision_id | uuid | - |  | 부모 |
| ir_json | jsonb | NN |  | Document IR |
| ir_hash | character(64) | NN |  | 해시 |
| change_summary | text | - |  | 변경요약 |
| created_by | uuid | NN |  | 작성자 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## evaluation

- 격리: RLS 없음
- evaluation_pkey: PRIMARY KEY (evaluation_id)
- fk_evaluation_created_by: FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_evaluation_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: evaluation_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| evaluation_id | uuid | NN | gen_random_uuid() | 평가 |
| situation_id | uuid | NN |  | 훈련 |
| status | character varying(20) | NN |  | OPEN~CLOSED |
| evaluation_type | character varying(30) | NN |  | EXERCISE/USABILITY |
| overall_score | numeric(6,2) | - |  | 종합점수 |
| summary | text | - |  | 종합의견 |
| created_by | uuid | NN |  | 평가자 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## evaluation_score

- 격리: RLS 없음
- evaluation_score_pkey: PRIMARY KEY (score_id)
- fk_evaluation_score_evaluation_id: FOREIGN KEY (evaluation_id) REFERENCES evaluation(evaluation_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: evaluation_score_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| score_id | uuid | NN | gen_random_uuid() | 평가점수 |
| evaluation_id | uuid | NN |  | 평가 |
| criterion_code | character varying(60) | NN |  | 지표 |
| score_value | numeric(6,2) | NN |  | 점수 |
| weight_value | numeric(6,3) | NN |  | 가중치 |
| comment | text | - |  | 의견 |
| evidence_event_ids | uuid[] | - |  | 근거 |

## evidence_item

- 격리: RLS 없음
- evidence_item_pkey: PRIMARY KEY (evidence_item_id)
- fk_evidence_item_evidence_set_id: FOREIGN KEY (evidence_set_id) REFERENCES evidence_set(evidence_set_id) DEFERRABLE INITIALLY DEFERRED
- fk_evidence_item_knowledge_document_id: FOREIGN KEY (knowledge_document_id) REFERENCES knowledge_document(knowledge_document_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: evidence_item_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| evidence_item_id | uuid | NN | gen_random_uuid() | 근거 |
| evidence_set_id | uuid | NN |  | 집합 |
| knowledge_document_id | uuid | NN |  | 문서 |
| provider_chunk_id | character varying(150) | - |  | UNI Chunk |
| rank_no | integer | NN |  | 순위 |
| score | numeric(8,6) | - |  | 유사도 |
| quote_text | text | NN |  | 근거문 |
| source_locator_json | jsonb | NN |  | 페이지/청크 |
| citation_key | character varying(80) | NN |  | 인용키 |

## evidence_set

- 격리: RLS 없음
- evidence_set_pkey: PRIMARY KEY (evidence_set_id)
- fk_evidence_set_created_by: FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_evidence_set_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- fk_evidence_set_snapshot_id: FOREIGN KEY (snapshot_id) REFERENCES situation_snapshot(snapshot_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: evidence_set_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| evidence_set_id | uuid | NN | gen_random_uuid() | 근거집합 |
| situation_id | uuid | NN |  | 상황 |
| snapshot_id | uuid | NN |  | 검색 Snapshot |
| query_text | text | NN |  | 질의 |
| filters_json | jsonb | NN |  | 필터 |
| top_k | integer | NN |  | Top-K |
| status | character varying(20) | NN |  | DRAFT/LOCKED |
| content_hash | character(64) | NN |  | 해시 |
| created_by | uuid | NN |  | 생성자 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## execution_event

- 격리: RLS enforced (FORCE)
- execution_event_pkey: PRIMARY KEY (execution_event_id)
- fk_execution_event_actor_id: FOREIGN KEY (actor_id) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_execution_event_corrects_event_id: FOREIGN KEY (corrects_event_id) REFERENCES execution_event(execution_event_id) DEFERRABLE INITIALLY DEFERRED
- fk_execution_event_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- fk_execution_event_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: execution_event_pkey, ix_execution_payload_json, ix_execution_situation_time_type

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| execution_event_id | uuid | NN | gen_random_uuid() | 사실원장 Event |
| tenant_id | uuid | NN |  | 기관 |
| situation_id | uuid | NN |  | 상황 |
| aggregate_type | character varying(30) | NN |  | TASK/SOP/DISPATCH/... |
| aggregate_id | uuid | NN |  | 대상 |
| event_type | character varying(50) | NN |  | 종류 |
| occurred_at | timestamp with time zone | NN | now() | 업무시각 |
| recorded_at | timestamp with time zone | NN | now() | 기록시각 |
| actor_id | uuid | - |  | 행위자 |
| payload_json | jsonb | NN |  | 내용 |
| corrects_event_id | uuid | - |  | 정정대상 |
| correlation_id | character varying(80) | NN |  | 추적 |
| event_hash | character(64) | NN |  | 위변조검증 |

## export_job

- 격리: RLS 없음
- export_job_pkey: PRIMARY KEY (export_id)
- fk_export_job_document_id: FOREIGN KEY (document_id) REFERENCES document(document_id) DEFERRABLE INITIALLY DEFERRED
- fk_export_job_requested_by: FOREIGN KEY (requested_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_export_job_revision_id: FOREIGN KEY (revision_id) REFERENCES document_revision(revision_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: export_job_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| export_id | uuid | NN | gen_random_uuid() | Export |
| document_id | uuid | NN |  | 문서 |
| revision_id | uuid | NN |  | Revision |
| format | character varying(20) | NN |  | HWPX/PDF/DOCX |
| status | character varying(20) | NN |  | QUEUED~FAILED |
| output_file_id | uuid | - |  | 결과 |
| validation_report_id | uuid | - |  | 검증 |
| requested_by | uuid | NN |  | 요청자 |
| created_at | timestamp with time zone | NN | now() | 요청 |
| finished_at | timestamp with time zone | - |  | 완료 |

## fact_conflict

- 격리: RLS 없음
- fact_conflict_pkey: PRIMARY KEY (conflict_id)
- fk_fact_conflict_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- 인덱스: fact_conflict_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| conflict_id | uuid | NN | gen_random_uuid() | 충돌 |
| situation_id | uuid | NN |  | 상황 |
| fact_key | character varying(120) | NN |  | Key |
| candidate_fact_ids | uuid[] | NN |  | 후보 |
| conflict_type | character varying(30) | NN |  | VALUE/TIME/SOURCE |
| status | character varying(20) | NN |  | OPEN/RESOLVED |
| detected_at | timestamp with time zone | NN |  | 탐지 |

## fact_source

- 격리: RLS 없음
- fact_source_pkey: PRIMARY KEY (source_id)
- 인덱스: fact_source_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| source_id | uuid | NN | gen_random_uuid() | 출처 |
| provider_code | character varying(30) | NN |  | KMA/MOIS/SAFEKOREA/NAVER/MANUAL/T3Q |
| source_type | character varying(30) | NN |  | API/WEB/FILE/USER |
| source_name | character varying(300) | NN |  | 출처명 |
| source_uri | text | - |  | 원문 위치 |
| retrieved_at | timestamp with time zone | NN |  | 수집시각 |
| raw_file_id | uuid | - |  | 원문 |
| license_json | jsonb | - |  | 이용조건 |

## file_object

- 격리: RLS enforced (FORCE)
- file_object_pkey: PRIMARY KEY (file_id)
- fk_file_object_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- uk_file_object_storage_key: UNIQUE (storage_key)
- 인덱스: file_object_pkey, uk_file_object_storage_key

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| file_id | uuid | NN | gen_random_uuid() | 파일 |
| tenant_id | uuid | NN |  | 기관 |
| storage_key | character varying(500) | NN |  | Object Key |
| original_name | character varying(500) | NN |  | 원본명 |
| mime_type | character varying(150) | NN |  | MIME |
| size_bytes | bigint | NN |  | 크기 |
| sha256 | character(64) | NN |  | 무결성 |
| scan_status | character varying(20) | NN |  | PENDING/CLEAN/INFECTED |
| created_by | uuid | NN |  | 등록자 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## generated_block

본문 생성 블록(UNE-PLAN-016 산출물, 세대별 불변 + supersede)
- 격리: RLS enforced (FORCE)
- ck_generated_block_citations_array: CHECK ((jsonb_typeof(citations_json) = 'array'::text))
- ck_generated_block_content_hash: CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text))
- ck_generated_block_generation_no: CHECK ((generation_no > 0))
- ck_generated_block_outline_level: CHECK (((outline_level >= 1) AND (outline_level <= 6)))
- ck_generated_block_protection_state: CHECK (((protection_state)::text = ANY ((ARRAY['NONE'::character varying, 'USER_LOCKED'::character varying, 'SYSTEM_LOCKED'::character varying])::text[])))
- ck_generated_block_status: CHECK (((status)::text = ANY ((ARRAY['GENERATED'::character varying, 'FAILED'::character varying])::text[])))
- ck_generated_block_supersede: CHECK (((superseded_by_block_id IS NULL) OR (superseded_at IS NOT NULL)))
- fk_generated_block_created_by: FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_generated_block_plan_id: FOREIGN KEY (plan_id) REFERENCES plan(plan_id) DEFERRABLE INITIALLY DEFERRED
- fk_generated_block_source_job_id: FOREIGN KEY (source_job_id) REFERENCES generation_job(job_id) DEFERRABLE INITIALLY DEFERRED
- fk_generated_block_superseded_by_block_id: FOREIGN KEY (superseded_by_block_id) REFERENCES generated_block(block_id) DEFERRABLE INITIALLY DEFERRED
- fk_generated_block_toc_version_id: FOREIGN KEY (toc_version_id) REFERENCES toc_version(toc_version_id) DEFERRABLE INITIALLY DEFERRED
- generated_block_pkey: PRIMARY KEY (block_id)
- 인덱스: generated_block_pkey, ix_generated_block_job, ix_generated_block_no_evidence, uk_generated_block_current, uk_generated_block_generation

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| block_id | uuid | NN | gen_random_uuid() | 생성 블록 |
| plan_id | uuid | NN |  | 계획서 |
| toc_version_id | uuid | NN |  | 생성 기준 목차 버전 |
| node_key | character varying(80) | NN |  | 목차 노드 안정 ID |
| generation_no | integer | NN |  | 세대 번호 |
| source_job_id | uuid | - |  | 생성 Job |
| block_type | character varying(30) | NN | 'PARAGRAPH'::character varying | PARAGRAPH/TABLE/... (IR 어휘 확정 전) |
| outline_level | smallint | NN |  | 개요 수준 1~6 |
| sort_order | integer | NN | 0 | 순서 |
| title | character varying(500) | NN |  | 제목 |
| text_content | text | NN | ''::text | 본문 텍스트 |
| content_hash | character(64) | NN |  | SHA-256 |
| citations_json | jsonb | NN | '[]'::jsonb | 인용/근거 배열 |
| citation_count | integer | - | jsonb_array_length(citations_json) | 인용 수(생성 컬럼) |
| status | character varying(20) | NN |  | GENERATED/FAILED |
| protection_state | character varying(20) | NN | 'NONE'::character varying | NONE/USER_LOCKED/SYSTEM_LOCKED |
| failure_json | jsonb | - |  | 실패 상세 |
| superseded_at | timestamp with time zone | - |  | 대체 시각 |
| superseded_by_block_id | uuid | - |  | 대체 블록 |
| created_by | uuid | NN |  | 작성자 |
| created_at | timestamp with time zone | NN | now() | 생성 |
| updated_at | timestamp with time zone | NN | now() | 수정 |

## generation_job

- 격리: RLS enforced (FORCE)
- ck_generation_job_aggregate_type: CHECK (((aggregate_type)::text = ANY ((ARRAY['PLAN'::character varying, 'DOCUMENT'::character varying, 'SITUATION'::character varying])::text[])))
- ck_generation_job_progress: CHECK (((progress_pct >= (0)::numeric) AND (progress_pct <= (100)::numeric)))
- ck_generation_job_provider: CHECK (((provider_code)::text = ANY ((ARRAY['T3Q'::character varying, 'UNI'::character varying, 'UNE'::character varying])::text[])))
- ck_generation_job_status: CHECK (((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'RUNNING'::character varying, 'CANCEL_REQUESTED'::character varying, 'COMPLETED'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying])::text[])))
- ck_generation_job_type: CHECK (((job_type)::text = ANY ((ARRAY['TOC'::character varying, 'CONTENT'::character varying, 'AI_EDIT'::character varying, 'SOP'::character varying])::text[])))
- fk_generation_job_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- generation_job_pkey: PRIMARY KEY (job_id)
- 인덱스: generation_job_pkey, ix_generation_job_dispatch, ix_generation_job_tenant_status_created, uk_job_idempotency

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| job_id | uuid | NN | gen_random_uuid() | 비동기 Job |
| tenant_id | uuid | NN |  | 기관 |
| job_type | character varying(30) | NN |  | TOC/CONTENT/AI_EDIT/SOP |
| aggregate_type | character varying(30) | NN |  | PLAN/DOCUMENT/SITUATION |
| aggregate_id | uuid | NN |  | 대상 |
| provider_code | character varying(30) | NN |  | T3Q/UNI/UNE |
| request_json | jsonb | NN |  | Adapter 요청 |
| status | character varying(20) | NN |  | QUEUED~FAILED |
| progress_pct | numeric(5,2) | NN |  | 진행률 |
| idempotency_key | character varying(100) | NN |  | 멱등키 |
| correlation_id | character varying(80) | NN |  | 추적 |
| error_json | jsonb | - |  | 오류 |
| started_at | timestamp with time zone | - |  | 시작 |
| finished_at | timestamp with time zone | - |  | 종료 |
| created_at | timestamp with time zone | NN | now() | 생성 |
| updated_at | timestamp with time zone | NN | now() | 수정 |
| attempt_no | integer | NN | 0 | 재시도 횟수 |

## improvement_action

- 격리: RLS 없음
- fk_improvement_action_evaluation_id: FOREIGN KEY (evaluation_id) REFERENCES evaluation(evaluation_id) DEFERRABLE INITIALLY DEFERRED
- fk_improvement_action_owner_user_id: FOREIGN KEY (owner_user_id) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- improvement_action_pkey: PRIMARY KEY (action_id)
- 인덱스: improvement_action_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| action_id | uuid | NN | gen_random_uuid() | 개선조치 |
| evaluation_id | uuid | NN |  | 평가 |
| action_text | text | NN |  | 조치 |
| owner_user_id | uuid | - |  | 담당 |
| due_at | timestamp with time zone | - |  | 기한 |
| status | character varying(20) | NN |  | OPEN~CLOSED |
| target_type | character varying(30) | - |  | PLAN/SOP/SYSTEM |
| target_id | uuid | - |  | 환류대상 |

## job_event

- 격리: RLS enforced (FORCE)
- fk_job_event_job_id: FOREIGN KEY (job_id) REFERENCES generation_job(job_id) DEFERRABLE INITIALLY DEFERRED
- job_event_pkey: PRIMARY KEY (job_event_id)
- 인덱스: job_event_pkey, uk_job_event_seq

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| job_event_id | bigint | NN | nextval('job_event_job_event_id_seq'::regclass) | Job Event |
| job_id | uuid | NN |  | Job |
| sequence_no | bigint | NN |  | SSE 순번 |
| event_type | character varying(40) | NN |  | Event 종류 |
| payload_json | jsonb | NN |  | 내용 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## journal

- 격리: RLS 없음
- fk_journal_created_by: FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_journal_document_id: FOREIGN KEY (document_id) REFERENCES document(document_id) DEFERRABLE INITIALLY DEFERRED
- fk_journal_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- fk_journal_snapshot_id: FOREIGN KEY (snapshot_id) REFERENCES situation_snapshot(snapshot_id) DEFERRABLE INITIALLY DEFERRED
- journal_pkey: PRIMARY KEY (journal_id)
- 인덱스: journal_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| journal_id | uuid | NN | gen_random_uuid() | 상황일지 |
| situation_id | uuid | NN |  | 상황 |
| snapshot_id | uuid | NN |  | 기준 Snapshot |
| document_id | uuid | NN |  | rhwp 문서 |
| period_start | timestamp with time zone | NN |  | 시작 |
| period_end | timestamp with time zone | NN |  | 종료 |
| status | character varying(20) | NN |  | CONFIGURING~APPROVED |
| projection_hash | character(64) | NN |  | Projection 해시 |
| created_by | uuid | NN |  | 생성자 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## journal_projection_item

- 격리: RLS 없음
- fk_journal_projection_item_journal_id: FOREIGN KEY (journal_id) REFERENCES journal(journal_id) DEFERRABLE INITIALLY DEFERRED
- journal_projection_item_pkey: PRIMARY KEY (projection_item_id)
- 인덱스: journal_projection_item_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| projection_item_id | uuid | NN | gen_random_uuid() | 투영항목 |
| journal_id | uuid | NN |  | 일지 |
| section_key | character varying(80) | NN |  | 섹션 |
| source_event_ids | uuid[] | NN |  | 근거 Event |
| fact_payload_json | jsonb | NN |  | 잠금 사실값 |
| narrative_text | text | - |  | 서술 |
| sort_order | integer | NN | 0 | 정렬 |
| locked_fields_json | jsonb | NN |  | 잠금필드 |

## knowledge_document

- 격리: RLS enforced (FORCE)
- fk_knowledge_document_file_id: FOREIGN KEY (file_id) REFERENCES file_object(file_id) DEFERRABLE INITIALLY DEFERRED
- fk_knowledge_document_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- fk_knowledge_document_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- knowledge_document_pkey: PRIMARY KEY (knowledge_document_id)
- 인덱스: knowledge_document_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| knowledge_document_id | uuid | NN | gen_random_uuid() | 학습문서 |
| tenant_id | uuid | NN |  | 기관 |
| situation_id | uuid | - |  | 상황 |
| file_id | uuid | NN |  | 파일 |
| document_type | character varying(40) | NN |  | 매뉴얼/훈련계획/평가지침 |
| provider_document_id | character varying(150) | - |  | UNI ID |
| status | character varying(20) | NN |  | UPLOADING~FAILED |
| metadata_json | jsonb | NN |  | 메타 |
| created_by | uuid | NN |  | 등록자 |
| created_at | timestamp with time zone | NN | now() | 등록 |

## notification

- 격리: RLS enforced (FORCE)
- fk_notification_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- fk_notification_user_id: FOREIGN KEY (user_id) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- notification_pkey: PRIMARY KEY (notification_id)
- 인덱스: ix_notification_user_unread, notification_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| notification_id | uuid | NN | gen_random_uuid() | 알림 |
| tenant_id | uuid | NN |  | 기관 |
| user_id | uuid | NN |  | 수신자 |
| notification_type | character varying(40) | NN |  | 종류 |
| severity | character varying(20) | NN |  | INFO/WARN/CRITICAL |
| title | character varying(300) | NN |  | 제목 |
| body | text | NN |  | 내용 |
| action_url | character varying(700) | - |  | 조치링크 |
| read_at | timestamp with time zone | - |  | 읽음 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## organization

- 격리: RLS enforced (FORCE)
- fk_organization_parent_id: FOREIGN KEY (parent_id) REFERENCES organization(organization_id) DEFERRABLE INITIALLY DEFERRED
- fk_organization_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- organization_pkey: PRIMARY KEY (organization_id)
- 인덱스: organization_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| organization_id | uuid | NN | gen_random_uuid() | 조직 ID |
| tenant_id | uuid | NN |  | 기관 |
| parent_id | uuid | - |  | 상위조직 |
| org_code | character varying(50) | NN |  | 조직코드 |
| org_name | character varying(200) | NN |  | 조직명 |
| org_path | text | NN |  | 계층경로 |
| sort_order | integer | NN | 0 | 정렬 |
| status | character varying(20) | NN |  | 상태 |
| version_no | integer | NN | 1 | 낙관잠금 |

## outbox_attempt

- 격리: RLS 없음
- fk_outbox_attempt_outbox_id: FOREIGN KEY (outbox_id) REFERENCES outbox_message(outbox_id) DEFERRABLE INITIALLY DEFERRED
- outbox_attempt_pkey: PRIMARY KEY (attempt_id)
- 인덱스: outbox_attempt_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| attempt_id | uuid | NN | gen_random_uuid() | 발송시도 |
| outbox_id | uuid | NN |  | Outbox |
| attempt_no | integer | NN |  | 순번 |
| started_at | timestamp with time zone | NN | now() | 시작 |
| finished_at | timestamp with time zone | - |  | 종료 |
| result_status | character varying(20) | NN |  | SUCCESS/RETRY/FAIL |
| provider_message_id | character varying(150) | - |  | 외부 ID |
| response_json | jsonb | - |  | 응답 |
| error_json | jsonb | - |  | 오류 |

## outbox_message

- 격리: RLS enforced (FORCE)
- fk_outbox_message_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- outbox_message_pkey: PRIMARY KEY (outbox_id)
- 인덱스: ix_outbox_due, outbox_message_pkey, uk_outbox_idem

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| outbox_id | uuid | NN | gen_random_uuid() | Outbox |
| tenant_id | uuid | NN |  | 기관 |
| aggregate_type | character varying(30) | NN |  | 대상 |
| aggregate_id | uuid | NN |  | 대상 ID |
| event_type | character varying(50) | NN |  | 발송종류 |
| payload_json | jsonb | NN |  | 메시지 |
| channel | character varying(20) | NN |  | 채널 |
| status | character varying(20) | NN |  | PENDING~DEAD |
| attempt_count | integer | NN | 0 | 시도 |
| next_attempt_at | timestamp with time zone | - |  | 다음시도 |
| idempotency_key | character varying(100) | NN |  | 멱등키 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## permission

- 격리: RLS 없음
- permission_pkey: PRIMARY KEY (permission_id)
- uk_permission_permission_code: UNIQUE (permission_code)
- 인덱스: permission_pkey, uk_permission_permission_code

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| permission_id | uuid | NN | gen_random_uuid() | 권한 |
| permission_code | character varying(80) | NN |  | 권한코드 |
| resource_type | character varying(40) | NN |  | 자원 |
| action | character varying(40) | NN |  | 행위 |
| description | character varying(300) | - |  | 설명 |

## plan

- 격리: RLS enforced (FORCE)
- ck_plan_start_mode: CHECK (((start_mode)::text = ANY ((ARRAY['BLANK'::character varying, 'UPLOAD_HWPX'::character varying, 'RECENT'::character varying])::text[])))
- fk_plan_current_context_snapshot_id: FOREIGN KEY (current_context_snapshot_id) REFERENCES plan_context_snapshot(context_snapshot_id) DEFERRABLE INITIALLY DEFERRED
- fk_plan_current_toc_version: FOREIGN KEY (current_toc_version_id) REFERENCES toc_version(toc_version_id) DEFERRABLE INITIALLY DEFERRED
- fk_plan_document_id: FOREIGN KEY (document_id) REFERENCES document(document_id) DEFERRABLE INITIALLY DEFERRED
- fk_plan_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- plan_pkey: PRIMARY KEY (plan_id)
- 인덱스: ix_plan_tenant_status_updated, plan_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| plan_id | uuid | NN | gen_random_uuid() | 계획서 |
| tenant_id | uuid | NN |  | 기관 |
| title | character varying(300) | NN |  | 문서명 |
| hazard_type | character varying(50) | NN |  | 재난유형 |
| management_phase | character varying(20) | NN |  | 예방/대비 |
| status | character varying(30) | NN |  | 상태 |
| document_id | uuid | - |  | 편집문서 |
| current_context_snapshot_id | uuid | - |  | 현재 기준정보 |
| current_toc_version_id | uuid | - |  | 현재 목차 |
| owner_id | uuid | NN |  | 소유자 |
| version_no | integer | NN | 1 | 낙관잠금 |
| deleted_at | timestamp with time zone | - |  | 휴지통 |
| created_at | timestamp with time zone | NN | now() | 생성 |
| updated_at | timestamp with time zone | NN | now() | 수정 |
| start_mode | character varying(20) | NN | 'BLANK'::character varying | 시작방식 |

## plan_context_draft

- 격리: RLS 없음
- fk_plan_context_draft_plan_id: FOREIGN KEY (plan_id) REFERENCES plan(plan_id) DEFERRABLE INITIALLY DEFERRED
- fk_plan_context_draft_updated_by: FOREIGN KEY (updated_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- plan_context_draft_pkey: PRIMARY KEY (context_draft_id)
- 인덱스: plan_context_draft_pkey, uk_plan_context_draft_plan

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| context_draft_id | uuid | NN | gen_random_uuid() | 임시 기준정보 |
| plan_id | uuid | NN |  | 계획서 |
| context_json | jsonb | NN |  | 입력값 |
| schema_version | character varying(20) | NN |  | Schema 버전 |
| updated_by | uuid | NN |  | 수정자 |
| updated_at | timestamp with time zone | NN | now() | 수정일시 |

## plan_context_snapshot

- 격리: RLS enforced (FORCE)
- fk_plan_context_snapshot_confirmed_by: FOREIGN KEY (confirmed_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_plan_context_snapshot_plan_id: FOREIGN KEY (plan_id) REFERENCES plan(plan_id) DEFERRABLE INITIALLY DEFERRED
- fk_plan_context_snapshot_supersedes_id: FOREIGN KEY (supersedes_id) REFERENCES plan_context_snapshot(context_snapshot_id) DEFERRABLE INITIALLY DEFERRED
- plan_context_snapshot_pkey: PRIMARY KEY (context_snapshot_id)
- 인덱스: ix_context_snapshot_json, plan_context_snapshot_pkey, uk_plan_snapshot_version

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| context_snapshot_id | uuid | NN | gen_random_uuid() | 확정 Snapshot |
| plan_id | uuid | NN |  | 계획서 |
| version_no | integer | NN | 1 | 버전 |
| context_json | jsonb | NN |  | 불변 기준정보 |
| content_hash | character(64) | NN |  | SHA-256 |
| supersedes_id | uuid | - |  | 이전 Snapshot |
| confirmed_by | uuid | NN |  | 확정자 |
| confirmed_at | timestamp with time zone | NN | now() | 확정일시 |

## provider_config

- 격리: RLS enforced (FORCE)
- fk_provider_config_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- provider_config_pkey: PRIMARY KEY (provider_config_id)
- 인덱스: provider_config_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| provider_config_id | uuid | NN | gen_random_uuid() | Provider 설정 |
| tenant_id | uuid | - |  | 기관별 Override |
| provider_code | character varying(30) | NN |  | T3Q/UNI/KMA/... |
| enabled | boolean | NN | false | 활성 |
| priority_no | integer | NN |  | 우선순위 |
| base_url | character varying(500) | - |  | URL |
| credential_ref | character varying(300) | - |  | Vault 참조 |
| timeout_json | jsonb | NN |  | Timeout |
| feature_flags_json | jsonb | NN |  | Flag |
| version_no | integer | NN | 1 | 버전 |

## provider_job

- 격리: RLS 없음
- fk_provider_job_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- provider_job_pkey: PRIMARY KEY (provider_job_id)
- 인덱스: provider_job_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| provider_job_id | uuid | NN | gen_random_uuid() | Provider Job |
| situation_id | uuid | - |  | 상황 |
| provider_code | character varying(30) | NN |  | Provider |
| request_json | jsonb | NN |  | 요청 |
| status | character varying(20) | NN |  | 상태 |
| result_count | integer | NN |  | 결과수 |
| error_json | jsonb | - |  | 오류 |
| correlation_id | character varying(80) | NN |  | 추적 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## retention_policy

- 격리: RLS enforced (FORCE)
- fk_retention_policy_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- retention_policy_pkey: PRIMARY KEY (retention_policy_id)
- 인덱스: retention_policy_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| retention_policy_id | uuid | NN | gen_random_uuid() | 보존정책 |
| tenant_id | uuid | - |  | 기관 |
| resource_type | character varying(40) | NN |  | 자원 |
| retention_days | integer | NN |  | 일수 |
| archive_strategy | character varying(30) | NN |  | OBJECT_STORAGE/DB_ARCHIVE |
| legal_hold_enabled | boolean | NN | false | 법적보존 |
| version_no | integer | NN | 1 | 버전 |
| updated_by | uuid | NN |  | 수정자 |

## role

- 격리: RLS enforced (FORCE)
- fk_role_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- role_pkey: PRIMARY KEY (role_id)
- 인덱스: role_pkey, uk_role_code_global, uk_role_code_tenant

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| role_id | uuid | NN | gen_random_uuid() | 역할 |
| tenant_id | uuid | - |  | NULL이면 시스템 역할 |
| role_code | character varying(60) | NN |  | 역할코드 |
| role_name | character varying(120) | NN |  | 역할명 |
| scope_type | character varying(30) | NN |  | SYSTEM/TENANT/OBJECT |
| is_system | boolean | NN | false | 시스템 역할 |
| version_no | integer | NN | 1 | 버전 |

## role_permission

- 격리: RLS 없음
- fk_role_permission_permission: FOREIGN KEY (permission_id) REFERENCES permission(permission_id) ON DELETE CASCADE
- fk_role_permission_role: FOREIGN KEY (role_id) REFERENCES role(role_id) ON DELETE CASCADE
- role_permission_pkey: PRIMARY KEY (role_permission_id)
- uk_role_permission: UNIQUE (role_id, permission_id)
- 인덱스: ix_role_permission_role, role_permission_pkey, uk_role_permission

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| role_permission_id | uuid | NN | gen_random_uuid() | 역할-권한 매핑 |
| role_id | uuid | NN |  | 역할 |
| permission_id | uuid | NN |  | 권한 |
| created_at | timestamp with time zone | NN | now() | 부여일시 |

## situation

- 격리: RLS enforced (FORCE)
- fk_situation_created_by: FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_situation_current_snapshot_id: FOREIGN KEY (current_snapshot_id) REFERENCES situation_snapshot(snapshot_id) DEFERRABLE INITIALLY DEFERRED
- fk_situation_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- situation_pkey: PRIMARY KEY (situation_id)
- 인덱스: ix_situation_tenant_status_occurred, situation_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| situation_id | uuid | NN | gen_random_uuid() | 상황/훈련 |
| tenant_id | uuid | NN |  | 기관 |
| mode | character varying(20) | NN |  | LIVE/EXERCISE |
| title | character varying(300) | NN |  | 상황명 |
| hazard_type | character varying(50) | NN |  | 재난유형 |
| status | character varying(30) | NN |  | DRAFT~CLOSED |
| occurred_at | timestamp with time zone | - |  | 발생 |
| location_text | character varying(500) | - |  | 장소 |
| current_snapshot_id | uuid | - |  | 현재 Snapshot |
| version_no | integer | NN | 1 | 낙관잠금 |
| created_by | uuid | NN |  | 등록자 |
| created_at | timestamp with time zone | NN | now() | 등록 |

## situation_fact

- 격리: RLS 없음
- fk_situation_fact_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- fk_situation_fact_source_id: FOREIGN KEY (source_id) REFERENCES fact_source(source_id) DEFERRABLE INITIALLY DEFERRED
- situation_fact_pkey: PRIMARY KEY (fact_id)
- 인덱스: ix_fact_situation_key_time, ix_fact_value_json, situation_fact_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| fact_id | uuid | NN | gen_random_uuid() | Fact |
| situation_id | uuid | NN |  | 상황 |
| fact_type | character varying(50) | NN |  | 기상/피해/통제 등 |
| fact_key | character varying(120) | NN |  | 표준 Key |
| value_json | jsonb | NN |  | 값/단위 |
| source_id | uuid | NN |  | 출처 |
| observed_at | timestamp with time zone | - |  | 관측 |
| collected_at | timestamp with time zone | NN |  | 수집 |
| confidence | numeric(5,4) | - |  | 신뢰도 |
| status | character varying(20) | NN |  | CANDIDATE/CONFIRMED/REJECTED |
| version_no | integer | NN | 1 | 버전 |

## situation_snapshot

- 격리: RLS 없음
- fk_situation_snapshot_confirmed_by: FOREIGN KEY (confirmed_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_situation_snapshot_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- fk_situation_snapshot_supersedes_id: FOREIGN KEY (supersedes_id) REFERENCES situation_snapshot(snapshot_id) DEFERRABLE INITIALLY DEFERRED
- situation_snapshot_pkey: PRIMARY KEY (snapshot_id)
- 인덱스: situation_snapshot_pkey, uk_situation_snapshot_version

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| snapshot_id | uuid | NN | gen_random_uuid() | SituationSnapshot |
| situation_id | uuid | NN |  | 상황 |
| version_no | integer | NN | 1 | 버전 |
| facts_json | jsonb | NN |  | 불변 사실 |
| content_hash | character(64) | NN |  | 해시 |
| effective_at | timestamp with time zone | NN |  | 기준시각 |
| supersedes_id | uuid | - |  | 이전 |
| confirmed_by | uuid | NN |  | 확정자 |
| confirmed_at | timestamp with time zone | NN | now() | 확정 |

## sop

- 격리: RLS enforced (FORCE)
- fk_sop_created_by: FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_current_version_id: FOREIGN KEY (current_version_id) REFERENCES sop_version(sop_version_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_tenant_id: FOREIGN KEY (tenant_id) REFERENCES tenant(tenant_id) DEFERRABLE INITIALLY DEFERRED
- sop_pkey: PRIMARY KEY (sop_id)
- 인덱스: sop_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| sop_id | uuid | NN | gen_random_uuid() | SOP |
| tenant_id | uuid | NN |  | 기관 |
| situation_id | uuid | - |  | 상황 |
| title | character varying(300) | NN |  | 명칭 |
| hazard_type | character varying(50) | NN |  | 재난유형 |
| status | character varying(30) | NN |  | DRAFT~RETIRED |
| current_version_id | uuid | - |  | 현재 버전 |
| created_by | uuid | NN |  | 작성자 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## sop_edge

- 격리: RLS 없음
- fk_sop_edge_from_node_id: FOREIGN KEY (from_node_id) REFERENCES sop_node(node_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_edge_sop_version_id: FOREIGN KEY (sop_version_id) REFERENCES sop_version(sop_version_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_edge_to_node_id: FOREIGN KEY (to_node_id) REFERENCES sop_node(node_id) DEFERRABLE INITIALLY DEFERRED
- sop_edge_pkey: PRIMARY KEY (edge_id)
- 인덱스: sop_edge_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| edge_id | uuid | NN | gen_random_uuid() | Edge |
| sop_version_id | uuid | NN |  | 버전 |
| from_node_id | uuid | NN |  | 출발 |
| to_node_id | uuid | NN |  | 도착 |
| condition_expr | text | - |  | 분기식 |
| condition_schema | jsonb | - |  | 파라미터 |
| priority | integer | NN | 0 | 우선순위 |
| label | character varying(100) | - |  | 표시명 |

## sop_node

- 격리: RLS 없음
- fk_sop_node_sop_version_id: FOREIGN KEY (sop_version_id) REFERENCES sop_version(sop_version_id) DEFERRABLE INITIALLY DEFERRED
- sop_node_pkey: PRIMARY KEY (node_id)
- 인덱스: sop_node_pkey, uk_sop_node_version_key

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| node_id | uuid | NN | gen_random_uuid() | 노드 |
| sop_version_id | uuid | NN |  | 버전 |
| node_key | character varying(80) | NN |  | 안정 Key |
| node_type | character varying(20) | NN |  | START/ACTION/DECISION/NOTE/END |
| title | character varying(300) | NN |  | 제목 |
| config_json | jsonb | NN |  | 임무/완료조건/전파 |
| position_x | numeric(10,2) | - |  | Canvas X |
| position_y | numeric(10,2) | - |  | Canvas Y |
| sort_order | integer | - |  | 정렬 |

## sop_run

- 격리: RLS 없음
- fk_sop_run_situation_id: FOREIGN KEY (situation_id) REFERENCES situation(situation_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_run_snapshot_id: FOREIGN KEY (snapshot_id) REFERENCES situation_snapshot(snapshot_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_run_sop_version_id: FOREIGN KEY (sop_version_id) REFERENCES sop_version(sop_version_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_run_started_by: FOREIGN KEY (started_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- sop_run_pkey: PRIMARY KEY (run_id)
- 인덱스: sop_run_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| run_id | uuid | NN | gen_random_uuid() | 실행 |
| sop_version_id | uuid | NN |  | 고정 버전 |
| situation_id | uuid | NN |  | 상황 |
| snapshot_id | uuid | NN |  | 시작 Snapshot |
| mode | character varying(20) | NN |  | LIVE/DRY_RUN/EXERCISE |
| status | character varying(20) | NN |  | READY~TERMINATED |
| started_by | uuid | NN |  | 시작자 |
| started_at | timestamp with time zone | NN | now() | 시작 |
| ended_at | timestamp with time zone | - |  | 종료 |
| correlation_id | character varying(80) | NN |  | 추적 |

## sop_validation

- 격리: RLS 없음
- fk_sop_validation_sop_version_id: FOREIGN KEY (sop_version_id) REFERENCES sop_version(sop_version_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_validation_validated_by: FOREIGN KEY (validated_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- sop_validation_pkey: PRIMARY KEY (validation_id)
- 인덱스: sop_validation_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| validation_id | uuid | NN | gen_random_uuid() | 검증 |
| sop_version_id | uuid | NN |  | 버전 |
| status | character varying(20) | NN |  | PASS/FAIL |
| errors_json | jsonb | NN |  | 오류 |
| warnings_json | jsonb | NN |  | 경고 |
| validator_version | character varying(30) | NN |  | 검증기 버전 |
| validated_by | uuid | - |  | 사용자/시스템 |
| validated_at | timestamp with time zone | NN |  | 검증 |

## sop_version

- 격리: RLS 없음
- fk_sop_version_approved_by: FOREIGN KEY (approved_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_version_sop_id: FOREIGN KEY (sop_id) REFERENCES sop(sop_id) DEFERRABLE INITIALLY DEFERRED
- fk_sop_version_source_evidence_set_id: FOREIGN KEY (source_evidence_set_id) REFERENCES evidence_set(evidence_set_id) DEFERRABLE INITIALLY DEFERRED
- sop_version_pkey: PRIMARY KEY (sop_version_id)
- 인덱스: sop_version_pkey, uk_sop_version_no

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| sop_version_id | uuid | NN | gen_random_uuid() | SOP 버전 |
| sop_id | uuid | NN |  | SOP |
| version_no | integer | NN | 1 | 버전 |
| status | character varying(20) | NN |  | DRAFT/LOCKED |
| graph_hash | character(64) | NN |  | 그래프 해시 |
| source_snapshot_id | uuid | - |  | SituationSnapshot |
| source_evidence_set_id | uuid | - |  | 근거 |
| schema_version | character varying(20) | NN |  | Schema |
| approved_by | uuid | - |  | 승인자 |
| approved_at | timestamp with time zone | - |  | 승인 |

## style_prototype

- 격리: RLS 없음
- fk_style_prototype_template_profile_id: FOREIGN KEY (template_profile_id) REFERENCES template_profile(template_profile_id) DEFERRABLE INITIALLY DEFERRED
- style_prototype_pkey: PRIMARY KEY (prototype_id)
- 인덱스: style_prototype_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| prototype_id | uuid | NN | gen_random_uuid() | Prototype |
| template_profile_id | uuid | NN |  | Profile |
| prototype_key | character varying(100) | NN |  | 키 |
| prototype_type | character varying(40) | NN |  | TITLE/PARA/TABLE/... |
| source_locator_json | jsonb | NN |  | 원본 위치 |
| clone_policy_json | jsonb | NN |  | 복제정책 |
| style_fingerprint | character(64) | NN |  | 서식 지문 |

## task

- 격리: RLS 없음
- fk_task_assignee_org_id: FOREIGN KEY (assignee_org_id) REFERENCES organization(organization_id) DEFERRABLE INITIALLY DEFERRED
- fk_task_assignee_user_id: FOREIGN KEY (assignee_user_id) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_task_node_id: FOREIGN KEY (node_id) REFERENCES sop_node(node_id) DEFERRABLE INITIALLY DEFERRED
- fk_task_run_id: FOREIGN KEY (run_id) REFERENCES sop_run(run_id) DEFERRABLE INITIALLY DEFERRED
- task_pkey: PRIMARY KEY (task_id)
- 인덱스: ix_task_assignee_status_due, task_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| task_id | uuid | NN | gen_random_uuid() | 임무 |
| run_id | uuid | NN |  | SOP 실행 |
| node_id | uuid | NN |  | 원본 노드 |
| title | character varying(300) | NN |  | 임무명 |
| status | character varying(30) | NN |  | CREATED~CANCELLED |
| assignee_user_id | uuid | - |  | 담당자 |
| assignee_org_id | uuid | - |  | 담당조직 |
| due_at | timestamp with time zone | - |  | 기한 |
| completion_policy_json | jsonb | NN |  | 완료조건 |
| progress_pct | numeric(5,2) | NN |  | 진행률 |
| version_no | integer | NN | 1 | 낙관잠금 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## task_attachment

- 격리: RLS 없음
- fk_task_attachment_file_id: FOREIGN KEY (file_id) REFERENCES file_object(file_id) DEFERRABLE INITIALLY DEFERRED
- fk_task_attachment_task_id: FOREIGN KEY (task_id) REFERENCES task(task_id) DEFERRABLE INITIALLY DEFERRED
- fk_task_attachment_uploaded_by: FOREIGN KEY (uploaded_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- task_attachment_pkey: PRIMARY KEY (task_attachment_id)
- 인덱스: task_attachment_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| task_attachment_id | uuid | NN | gen_random_uuid() | 첨부 |
| task_id | uuid | NN |  | 임무 |
| file_id | uuid | NN |  | 파일 |
| category | character varying(30) | NN |  | PHOTO/DOC/VIDEO |
| caption | character varying(500) | - |  | 설명 |
| geo_json | jsonb | - |  | 위치 |
| captured_at | timestamp with time zone | - |  | 촬영 |
| uploaded_by | uuid | NN |  | 등록자 |

## task_event

- 격리: RLS 없음
- fk_task_event_actor_id: FOREIGN KEY (actor_id) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_task_event_task_id: FOREIGN KEY (task_id) REFERENCES task(task_id) DEFERRABLE INITIALLY DEFERRED
- task_event_pkey: PRIMARY KEY (task_event_id)
- 인덱스: task_event_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| task_event_id | uuid | NN | gen_random_uuid() | Task Event |
| task_id | uuid | NN |  | 임무 |
| event_type | character varying(40) | NN |  | DISPATCHED/ACK/... |
| event_time | timestamp with time zone | NN |  | 업무시각 |
| actor_id | uuid | - |  | 행위자 |
| payload_json | jsonb | NN |  | 내용 |
| correlation_id | character varying(80) | NN |  | 추적 |
| created_at | timestamp with time zone | NN | now() | 기록 |

## template_profile

- 격리: RLS 없음
- fk_template_profile_document_id: FOREIGN KEY (document_id) REFERENCES document(document_id) DEFERRABLE INITIALLY DEFERRED
- template_profile_pkey: PRIMARY KEY (template_profile_id)
- 인덱스: template_profile_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| template_profile_id | uuid | NN | gen_random_uuid() | Template Profile |
| document_id | uuid | NN |  | 문서 |
| profile_version | integer | NN |  | 버전 |
| analysis_status | character varying(20) | NN |  | 상태 |
| profile_json | jsonb | NN |  | Section/Style/Prototype |
| unsupported_objects_json | jsonb | NN |  | 미지원 객체 |
| analysis_hash | character(64) | NN |  | 해시 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## tenant

- 격리: RLS enforced (FORCE)
- tenant_pkey: PRIMARY KEY (tenant_id)
- tenant_status_check: CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'SUSPENDED'::character varying])::text[])))
- uk_tenant_tenant_code: UNIQUE (tenant_code)
- 인덱스: tenant_pkey, uk_tenant_tenant_code

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| tenant_id | uuid | NN | gen_random_uuid() | 기관/테넌트 ID |
| tenant_code | character varying(30) | NN |  | 기관 코드 |
| tenant_name | character varying(200) | NN |  | 기관명 |
| status | character varying(20) | NN |  | ACTIVE/SUSPENDED |
| timezone | character varying(50) | NN | 'Asia/Seoul'::character varying | Asia/Seoul |
| created_at | timestamp with time zone | NN | now() | 생성일시 |
| updated_at | timestamp with time zone | NN | now() | 수정일시 |

## toc_node

- 격리: RLS enforced (FORCE)
- ck_toc_node_level: CHECK (((level >= 1) AND (level <= 6)))
- fk_toc_node_parent: FOREIGN KEY (parent_node_id) REFERENCES toc_node(toc_node_id) DEFERRABLE INITIALLY DEFERRED
- fk_toc_node_toc_version_id: FOREIGN KEY (toc_version_id) REFERENCES toc_version(toc_version_id) DEFERRABLE INITIALLY DEFERRED
- toc_node_pkey: PRIMARY KEY (toc_node_id)
- 인덱스: ix_toc_node_version_parent_sort, toc_node_pkey, uk_toc_node_version_key

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| toc_node_id | uuid | NN | gen_random_uuid() | 목차노드 |
| toc_version_id | uuid | NN |  | 버전 |
| parent_node_id | uuid | - |  | 부모 |
| node_key | character varying(80) | NN |  | 안정 ID |
| title | character varying(500) | NN |  | 제목 |
| level | smallint | NN |  | 계층 |
| sort_order | integer | NN | 0 | 순서 |
| generation_policy | jsonb | NN |  | 생성규칙 |

## toc_version

- 격리: RLS enforced (FORCE)
- ck_toc_version_source: CHECK (((source_type)::text = ANY ((ARRAY['AI'::character varying, 'USER'::character varying])::text[])))
- ck_toc_version_status: CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'CONFIRMED'::character varying])::text[])))
- fk_toc_version_base_snapshot: FOREIGN KEY (base_snapshot_id) REFERENCES plan_context_snapshot(context_snapshot_id) DEFERRABLE INITIALLY DEFERRED
- fk_toc_version_created_by: FOREIGN KEY (created_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_toc_version_plan_id: FOREIGN KEY (plan_id) REFERENCES plan(plan_id) DEFERRABLE INITIALLY DEFERRED
- toc_version_pkey: PRIMARY KEY (toc_version_id)
- 인덱스: toc_version_pkey, uk_toc_version_plan_version

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| toc_version_id | uuid | NN | gen_random_uuid() | 목차 버전 |
| plan_id | uuid | NN |  | 계획서 |
| version_no | integer | NN | 1 | 버전 |
| source_type | character varying(20) | NN |  | AI/USER |
| base_snapshot_id | uuid | NN |  | 기준 Snapshot |
| status | character varying(20) | NN |  | DRAFT/CONFIRMED |
| content_hash | character(64) | NN |  | 해시 |
| created_by | uuid | NN |  | 작성자 |
| created_at | timestamp with time zone | NN | now() | 생성 |

## user_role

- 격리: RLS 없음
- fk_user_role_granted_by: FOREIGN KEY (granted_by) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- fk_user_role_role_id: FOREIGN KEY (role_id) REFERENCES role(role_id) DEFERRABLE INITIALLY DEFERRED
- fk_user_role_user_id: FOREIGN KEY (user_id) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- user_role_pkey: PRIMARY KEY (user_role_id)
- 인덱스: user_role_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| user_role_id | uuid | NN | gen_random_uuid() | Binding |
| user_id | uuid | NN |  | 사용자 |
| role_id | uuid | NN |  | 역할 |
| scope_id | uuid | - |  | 기관/객체 범위 |
| valid_from | timestamp with time zone | - |  | 유효시작 |
| valid_to | timestamp with time zone | - |  | 유효종료 |
| granted_by | uuid | NN |  | 부여자 |
| created_at | timestamp with time zone | NN | now() | 부여일시 |

## user_session

- 격리: RLS 없음
- fk_user_session_user_id: FOREIGN KEY (user_id) REFERENCES app_user(user_id) DEFERRABLE INITIALLY DEFERRED
- user_session_pkey: PRIMARY KEY (session_id)
- 인덱스: uk_user_session_refresh_hash, user_session_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| session_id | uuid | NN | gen_random_uuid() | 세션 |
| user_id | uuid | NN |  | 사용자 |
| refresh_hash | character(64) | NN |  | Refresh Token hash |
| issued_at | timestamp with time zone | NN | now() | 발급 |
| expires_at | timestamp with time zone | NN |  | 만료 |
| revoked_at | timestamp with time zone | - |  | 폐기 |
| client_ip | inet | - |  | IP |
| user_agent | text | - |  | UA |

## validation_report

- 격리: RLS 없음
- validation_report_pkey: PRIMARY KEY (validation_report_id)
- 인덱스: validation_report_pkey

| 컬럼 | 타입 | NULL | 기본값 | 설명 |
|---|---|---|---|---|
| validation_report_id | uuid | NN | gen_random_uuid() | 검증보고서 |
| target_type | character varying(30) | NN |  | DOCUMENT/EXPORT |
| target_id | uuid | NN |  | 대상 |
| track | character varying(20) | NN |  | A_AUTO/B_HANCOM |
| status | character varying(20) | NN |  | PASS/LIMITED/FAIL |
| checks_json | jsonb | NN |  | 검사항목 |
| environment_json | jsonb | NN |  | 버전/환경 |
| evidence_file_id | uuid | - |  | 증빙 |
| created_at | timestamp with time zone | NN | now() | 검증일시 |
