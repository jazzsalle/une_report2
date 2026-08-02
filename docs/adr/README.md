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
