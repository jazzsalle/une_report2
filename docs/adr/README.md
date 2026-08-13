# ADR Register

전체 ADR 등록부. ADR-01~10은 통합설계 기준선 인계서 v0.9에서, ADR-11~18은
`docs/design-markdown/03_ADR_v1.1.md`에서 확정되었다. ADR-19부터는 이
디렉터리에 개별 파일로 추가한다. 신규 ADR은 이 표에 반드시 등재한다.

| ID | 제목 | 상태 | 출처 | 재검토 Trigger |
|---|---|---|---|---|
| ADR-01 | rhwp Web Editor를 중앙 Single Editing Surface로 사용 | ACCEPTED | 02_BASELINE_HANDOFF_v0.9, 03_ADR_v1.1 §2 | - |
| ADR-02 | 임의 HWPX 자동분석 + Template Profile + Prototype Clone | ACCEPTED | 03_ADR_v1.1 §2 | - |
| ADR-03 | AI는 내용/의미 level만 생성, HWPX 서식은 UNE 엔진이 적용 | ACCEPTED | 03_ADR_v1.1 §2 | - |
| ADR-04 | Cursor/Range/Block/Section 선택과 ChangeSet/Diff/Undo | ACCEPTED | 03_ADR_v1.1 §2 | - |
| ADR-05 | 계획서 생성은 T3Q RPT-001/002만 사용 | ACCEPTED | 03_ADR_v1.1 §2 | - |
| ADR-06 | 상황일지 POC는 UNI Upload/Search/chat-json/chat 사용 | ACCEPTED | 03_ADR_v1.1 §2 | - |
| ADR-07 | 상황전파는 T3Q/UNI가 아닌 UNE 내부모듈 담당 | ACCEPTED | 03_ADR_v1.1 §2 | - |
| ADR-08 | 현재상황은 SituationFact/Snapshot 관리, LLM 생성값 금지 | ACCEPTED | 03_ADR_v1.1 §2 | - |
| ADR-09 | KMA/MOIS 우선, SafeKorea 보조, Naver 사용자 요청형 보조수집 | ACCEPTED | 03_ADR_v1.1 §2 | - |
| ADR-10 | Execution Log를 사실원장으로 상황일지 생성 | ACCEPTED | 03_ADR_v1.1 §2 | - |
| ADR-11 | T3Q 현재 재난상황정보 API 적용 정책 | ACCEPTED | 03_ADR_v1.1 §4 | §4.8 참조 |
| ADR-12 | 상황일지 생성 주체와 T3Q RPT-003 적용 정책 | ACCEPTED | 03_ADR_v1.1 §5 | §5.7 참조 |
| ADR-13 | UNI compns와 UNE SOP Schema 변환 경계 | ACCEPTED | 03_ADR_v1.1 §6 | §6.7 참조 |
| ADR-14 | 국민안전24·Naver 보조수집 운영정책 | ACCEPTED | 03_ADR_v1.1 §7 | §7 참조 |
| ADR-15 | rhwp pinned 소스 반입과 보존형 Serializer | ACCEPTED | 03_ADR_v1.1 §8 | §8 참조 |
| ADR-16 | CI 검증 + Windows 한컴 Round-trip 이중 시험체계 | ACCEPTED | 03_ADR_v1.1 §9 | §9 참조 |
| ADR-17 | ChannelPort + Transactional Outbox | ACCEPTED | 03_ADR_v1.1 §10 | §10 참조 |
| ADR-18 | 기관 독립 Scenario Pack | ACCEPTED | 03_ADR_v1.1 §11 | §11 참조 |
| ADR-19 | 백엔드 구현 프로파일: NestJS (Node/TypeScript) | ACCEPTED | [ADR-19-backend-profile-nestjs.md](ADR-19-backend-profile-nestjs.md) | 사내 표준 강제 또는 납품 인프라의 Node 미허용 |
| ADR-20 | 계약 검증 게이트와 계약 타입 생성 전략 | ACCEPTED | [ADR-20-contract-validation-and-type-generation.md](ADR-20-contract-validation-and-type-generation.md) | 계약 안정화 후 스타일 린트 도입 재평가(CC-115/CC-400) |
| ADR-21 | 마이그레이션 도구 확정과 스키마 기준선 결함 해소 | ACCEPTED | [ADR-21-migration-tool-and-baseline-corrections.md](ADR-21-migration-tool-and-baseline-corrections.md) | 파티셔닝 전환(0010 계획)은 별도 ICR; 백업·복원 검증은 운영 항목 |
| ADR-22 | CC-100 RBAC 저장소 보완과 mock 인증 모델 | ACCEPTED | [ADR-22-cc100-rbac-storage-and-mock-auth.md](ADR-22-cc100-rbac-storage-and-mock-auth.md) | 실 SSO 바인딩(OB-01), 레이트리밋 항목에서 D6 재평가 |
| ADR-23 | CC-110 Plan 슬라이스 — 멱등키 재생 저장소와 기준정보 계약 확정 | ACCEPTED | [ADR-23-cc110-plan-slice-and-idempotency-store.md](ADR-23-cc110-plan-slice-and-idempotency-store.md) | api_idempotency TTL·보존(CC-430 계열), 승인 잠금 재개정 액션(CC-170+), 재난유형 코드 카탈로그 설계 변경 요청 |
| ADR-24 | CC-115 T3Q 계약 기준선 — example 게이트·capability 레지스트리·갭 매트릭스 | ACCEPTED | [ADR-24-t3q-contract-baseline-and-example-gate.md](ADR-24-t3q-contract-baseline-and-example-gate.md) | OB-01/OB-10/OB-11 종결 시 capability 승격·실계약 검증(CC-400), redocly 최소 프로파일 재평가(CC-400) |
| ADR-25 | CC-120 TOC Job — 워커 디스패치 롤·좁은 포트·Job 상태기계 | ACCEPTED | [ADR-25-cc120-toc-job-worker-and-tenant-dispatch.md](ADR-25-cc120-toc-job-worker-and-tenant-dispatch.md) | T3qPlanProvider 통합·실 어댑터·회복성(CC-125), 블록 단위 진행률·재시도(CC-130), 리포지토리 추출 재평가(CC-130), job_event 보존(CC-430) |
| ADR-26 | CC-125 T3qPlanProvider 통합 포트와 Legacy/Target-v2 이중 어댑터 | ACCEPTED | [ADR-26-cc125-plan-provider-port-and-dual-adapters.md](ADR-26-cc125-plan-provider-port-and-dual-adapters.md) | CONTENT job 결선(CC-130 완료 — ADR-27), v2 mock 확장·응답측 예제(CC-135), 실계약 검증·OB-01 종결(CC-400), provider_config 테넌트 토글(admin 항목), CB 분산화·보존정책(CC-430), documentId/baseRevisionId 실값(CC-150) |
| ADR-27 | CC-130 CONTENT Job — generated_block·보호 블록·부분 이벤트 합성 | ACCEPTED | [ADR-27-cc130-content-job-and-protected-blocks.md](ADR-27-cc130-content-job-and-protected-blocks.md) | 실시간 부분 이벤트·partialRetry·v2 매핑(CC-135), generated_block→document_revision materialize·편집 API(CC-150), 목차 변경 영향 Diff(CC-170), 근거 정규화(CC-230), api↔worker 공유 추출 종결 기준(D1) |
| ADR-28 | CC-135 Target-v2 Mock — Job 라이프사이클·의미 편집·근거·검증 | ACCEPTED | [ADR-28-cc135-target-v2-mocks.md](ADR-28-cc135-target-v2-mocks.md) | 실계약 검증·실 SSE·펜싱 재산정·실시간 반영(CC-400), proposal 적용·id 공간 바인딩(CC-150), EvidenceSet 영속(CC-230), UNI 무호출 런타임 증명(CC-170) |
| ADR-29 | CC-140 HWPX 반입 게이트·Document IR·호환성 2층 어휘 | ACCEPTED | [ADR-29-cc140-hwpx-intake-gate-and-document-ir.md](ADR-29-cc140-hwpx-intake-gate-and-document-ir.md) | rhwp 실반입·POC Gate(CC-145 계열), 편집·Revision(CC-150)과 문서 하위 테이블 RLS 0018 선행조건, 보존 직렬화·Track A(CC-160), 실문서 코퍼스 10종 확대(OB-07), 한컴 Track B(OB-08/CC-420) |
| ADR-30 | CC-150 Document Revision·ChangeSet·Selection·낙관적 동시성 | ACCEPTED | [ADR-30-cc150-document-revision-changeset-and-selection.md](ADR-30-cc150-document-revision-changeset-and-selection.md) | rhwp 반입·편집기 결선(offset 계약 실검증, OB-12), alias 체인 재평가(D14, CC-170), CC-160 Serializer의 `anchorHint` 소비, `before_json` 요구 감사 UI, `analysis_status` 어휘 확정(CC-160) |
| ADR-31 | CC-160 HWPX 보존 Export·Track A 검증·오브젝트 저장소 | ACCEPTED | [ADR-31-cc160-preservation-export-and-track-a.md](ADR-31-cc160-preservation-export-and-track-a.md) | rhwp 실반입(VISUAL 계층), 한컴 Track B 환경 확정(OB-08), 평탄화 변환기, PDF/DOCX 변환기, 표/SPLIT/MERGE 되쓰기, AV 스캐너, 보존 정책(FK·TTL), 설계 09 Template Profile 화면(`lifecycle_status`) |
| ADR-32 | CC-170 계획서 수직 슬라이스 — 업로드 진입점·최소 UI·성능 기준선 | ACCEPTED | [ADR-32-cc170-plan-slice-upload-and-ui.md](ADR-32-cc170-plan-slice-upload-and-ui.md) | 실 T3Q SSO(OB-01), rhwp 편집기 결선(OB-12), AV 스캐너(OB-15), 화면 캡처 CI 편입, 미반영 리뷰 지적 8건(D17), SSE 전환(UNE-PLAN-011) |
| ADR-33 | CC-200 상황·후보 SituationFact 수집 — 동기 Provider 경로와 정규화 | ACCEPTED | [ADR-33-cc200-situation-fact-ingestion.md](ADR-33-cc200-situation-fact-ingestion.md) | 중복군·충돌·Snapshot 확정(CC-210), freshness/TTL(WP-SITUATION-09), 실 KMA/MOIS 어댑터·G11 게이트, T3Q 상황 API(OB-02), SafeKorea/Naver 승인(OB-05), provider_result 보존 TTL(**ADR-35에서 종결**), D2 워커 권한 경계는 **ADR-36 D4**가 UNI 잡에 한해 넓혔다 |
| ADR-34 | CC-210 중복군·충돌 해소·불변 SituationSnapshot | ACCEPTED | [ADR-34-cc210-duplicate-conflict-and-snapshot.md](ADR-34-cc210-duplicate-conflict-and-snapshot.md) | 지식문서·UNI 어댑터(CC-220), freshness/STALE 경고(WP-SITUATION-09), 상황 계열 화면(SCR-SIT-005~007), 확정 예외 승인·MFA(인증 수준 정본 확정 후), 그룹화 키의 location/eventKey |
| ADR-35 | Provider 원문·요청조건의 보존기간과 전용 마스킹 롤 | ACCEPTED | [ADR-35-provider-payload-retention-and-redaction-role.md](ADR-35-provider-payload-retention-and-redaction-role.md) | `file_object` 보존(0020이 미룬 항목), 법·계약 보존기간 확정, 워커 전용 로그인 롤 프로비저닝(OB-17), 스윕 실행의 감사 원장 기록 요구 시 D6 재평가 |
| ADR-36 | CC-220 지식문서 업로드 — 비동기 UNI 경로와 워커 권한 경계 | ACCEPTED | [ADR-36-cc220-knowledge-upload-and-uni-worker-boundary.md](ADR-36-cc220-knowledge-upload-and-uni-worker-boundary.md) | OB-13 종결 시 capability 승격·실계약 검증, CC-230 EvidenceSet(참조요약 폴링), CC-240 UNI SOP(같은 provider 원장), AV 도입 시 D6 재평가, 취소·기관 KB 승격 워크플로 |
| ADR-37 | CC-230 근거 검색과 불변 EvidenceSet | ACCEPTED | [ADR-37-cc230-evidence-search-and-frozen-evidence-set.md](ADR-37-cc230-evidence-search-and-frozen-evidence-set.md) | OB-13/CR-UNI-008 종결 시 실계약 검증(CC-410), CC-240에서 참조요약 폴링·EvidenceSet 보존, 기관 KB 승격 후 A-02 충돌 탐지, 근거 선택·제외 API(SCR-SIT-010) |
| ADR-38 | CC-240 UNI SOP 생성과 버전 관리 UniSopMapper | ACCEPTED | [ADR-38-cc240-uni-sop-generation-and-versioned-mapper.md](ADR-38-cc240-uni-sop-generation-and-versioned-mapper.md) | OB-04 종결 시 `.assumed` SSE 프레이밍 재검증(CC-410), 증분 스트리밍(수용 한계 4), 캔버스 좌표와 `sop-graph.schema.json` position 필수 조건(CC-250), 승인본 포인터 규칙(수용 한계 14), SOP 재시도 정책, `job_event` 원문 보존기간(수용 한계 12) |
| ADR-39 | CC-250 SOP 캔버스·검증·검토·승인 | ACCEPTED | [ADR-39-cc250-sop-canvas-review-and-approval.md](ADR-39-cc250-sop-canvas-review-and-approval.md) | 반려·철회 엔드포인트(수용 한계 1), 검토 알림(CC-270), 검토자별 개별 응답, 정책 없는 18개 테이블 닫기(수용 한계 10), sop_validation 보존기간 |
| ADR-40 | CC-260 SopRun·Task 명시적 상태기계 | ACCEPTED | [ADR-40-cc260-sop-run-and-task-state-machine.md](ADR-40-cc260-sop-run-and-task-state-machine.md) | 완료 보고와 COMPLETED 어휘(CC-280), 전파(CC-270), 프런티어 전진·분기 조건 평가, 담당 배정·task_assignment, task_attachment 정책 |
| ADR-41 | CC-270 Transactional Outbox와 시뮬레이션 채널 | ACCEPTED | [ADR-41-cc270-transactional-outbox-and-simulation-channels.md](ADR-41-cc270-transactional-outbox-and-simulation-channels.md) | OB-06 종결 시 실제 채널 어댑터·주소 해석·DELIVERED 어휘, 수신확인(CC-280), 전파 취소, dead letter 운영 화면, Outbox 보존기간, 채널 속도 제한 |
| ADR-42 | CC-280 현장 임무 수행과 담당자 확인 (D13~D15는 이중검토 보정) | ACCEPTED | [ADR-42-cc280-field-task-execution.md](ADR-42-cc280-field-task-execution.md) | OB-06 종결 시 서명링크 인증·주소 해석, 역할규칙→담당자 배정, 미완료 임무 일괄 처리(CC-320), 분기 조건 평가, 현장 첨부 업로드 흐름, 현장 앱 실시간 갱신 |
| ADR-43 | CC-290 Execution Log와 전자상황판 투영 (D12~D16은 이중검토 보정) | ACCEPTED | [ADR-43-cc290-execution-log-and-dashboard-projection.md](ADR-43-cc290-execution-log-and-dashboard-projection.md) | 상황 단위 SSE(설계 10에 없음), 기한 변경 이벤트, recordedAt 축, 재생 캐시, 정정 승인 절차, SCR-BOARD-002(SLA·미수신)·004(수동기록), 이벤트 보존기간 |
| ADR-44 | CC-300 상황일지 Projection·고정 사실·편집·Export (D14~D21은 이중검토 보정) | ACCEPTED | [ADR-44-cc300-journal-projection-and-locked-facts.md](ADR-44-cc300-journal-projection-and-locked-facts.md) | OB-03 종결 시 실 서술 어댑터, 양식 표 셀 매핑(CC-160 표 행 복제 선행), PDF·DOCX 변환기, 시스템 기본 양식, 증분·누적 일지 구분, 재개정(US-SIT-034 A-02), 검토자별 응답·자기승인 금지, 고아 문서 정리 경로, 평가·개선조치(CC-310) |
| ADR-45 | CC-310 훈련 종료·평가·개선조치 환류 (D11~D16은 이중검토 보정) | ACCEPTED | [ADR-45-cc310-exercise-close-and-evaluation.md](ADR-45-cc310-exercise-close-and-evaluation.md) | OB-18 만족도 설문 수집 경로, 평가보고서 HWPX·PDF 양식, 종료 후 비이벤트 기준선 동결·대조, 미완료 Export·잡의 종료 게이트 포함, 개선조치 종결(ACTION_TRACKING), 체크포인트 기대값 대조, 기관별 분리평가, 재산출 연산, 예외승인 재인증, 종료 취소 |
