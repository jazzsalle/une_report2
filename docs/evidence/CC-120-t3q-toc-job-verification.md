# CC-120 검증 증거 — T3Q RPT-001 목차 생성 Job (mock adapter)

- 일자: 2026-08-02 (집 PC, PostgreSQL 로컬 15432)
- 브랜치: feature/CC-120 (main 3ebb4d7 = CC-115 머지 기반)
- 근거 결정: ADR-25 (워커 디스패치 롤·좁은 포트·Job 상태기계·멱등 2층·
  node_key 의미론·SSE 어휘 분리)

## 수용 기준 대응

| 기준 | 증거 |
|---|---|
| job/idempotency | 멱등 2층 — ①api_idempotency 인터셉터(동일 키+본문 202 재생·상이 409 COM-0409·누락 400) ②DB 2차 그물 uk_job_idempotency(sha256(jobType\|endpoint\|clientKey), 23505 → SAVEPOINT 폴백으로 기존 job 반환). e2e에서 job 행 1개 보장 검증. 동일 계획서 활성 job → 409 PLAN-409-002(신설) |
| adapter mapping | `legacy-toc-mapper`(갭 매트릭스 정본): CC-115 대표 픽스처 왕복 재현, null 생략, PlanContext 외 필드 미전송. 응답 가드(형상 위반 → job FAILED + raw 보존). 결정적 mock 어댑터(3회 동일 출력, 백도어 없는 시나리오 주입). 매퍼·가드·포트는 CC-125 LegacyT3qPlanAdapter가 그대로 승계 |
| TOC version | job 완료 트랜잭션에서 toc_version(AI/DRAFT, base_snapshot 승계, 내용 해시) + toc_node 트리(결정적 node_key n-*, FK 부모 선행 삽입) + plan.current_toc_version_id/OUTLINE_REVIEW 동시 갱신. UNE-PLAN-014 사용자 편집 버전(USER, 키 승계+u-* 신규, confirm→OUTLINE_CONFIRMED)·015 조회 포함 |
| SSE or polling events | 둘 다 — UNE-PLAN-010 폴링(+result 투영) / 011 SSE(수동 스트리밍: 공개 어휘 9종만, id=sequence_no, Last-Event-ID 재개, provider.* 내부 이벤트 미노출, 종결 이벤트 후 종료). **Nest @Sse가 async 핸들러를 await하지 않아 404가 in-stream으로 삼켜지는 결함을 발견**하고 수동 SSE로 교체(404는 JSON envelope — e2e 검증) |
| failure/retry tests | 워커 e2e: provider 실패 → FAILED(T3Q-502-001)+raw trace+plan 복귀, 스냅샷 해시 불일치(비재시도), lease 만료 재선점, maxAttempts 초과, 취소 스윕. API e2e: FAILED→retry(202 QUEUED)→재실행 COMPLETED, blockIds 400, 비FAILED 409 JOB-409-002, cancel QUEUED→CANCELLED+plan 복귀/종결 409 |

## 게이트 실행 결과 (2026-08-02)

| 명령 | 결과 |
|---|---|
| pnpm --filter @une/domain test | **31/31** (상태기계 전이표 전수, 트리 검증/키/flatten/해시, 요청 시임 라운드트립, SHA-256 표준 벡터) |
| pnpm --filter @une/provider-adapters test | **16/16** (매퍼 픽스처 왕복, 가드, mock 결정성/시나리오) |
| pnpm --filter @une/worker test | **12/12** (e2e 7: 전 여정·2테넌트 무오염·SKIP LOCKED 중복 0·실패·해시 불일치·취소 스윕·lease/maxAttempts) |
| pnpm --filter @une/api test | **175/175** (신규 단위 65 + TOC e2e 11: 전 여정·전제조건·멱등·권한/테넌트·SSE(+Last-Event-ID 400)·cancel·retry 가드·사용자 편집 보호·014/015) |
| pnpm --filter @une/db-integration test | **41/41** (0015 워커 RLS 실증 9 + 디스패치 스코프 음성 2 포함) |
| pnpm --filter @une/contract-tests test | **26/26** (no-UNI 가드 루트에 t3q 디렉터리 추가) |
| 루트 pnpm test / build / typecheck / lint / format:check | PASS |
| pnpm validate:contracts | PASS (mock sync **18 routes**, examples 10, 전사본 핀) |
| python -m pytest tests/baseline | **6 passed** (mock QUEUED→COMPLETED 흐름) |
| pnpm db:migrate (0015) / db:data-dictionary | 15개 적용 / 59테이블·533컬럼 drift 없음 |
| pnpm validate:handoff | PASS |

## 핵심 구현 사실

- **실행 구조**(ADR-25 D1/D2): API가 QUEUED job+job.queued+OUTLINE_GENERATING
  +감사를 한 트랜잭션으로 커밋 → 워커가 `une_worker` 디스패치 스코프
  (테넌트 미설정에서만 유효한 RLS 정책, FOR UPDATE SKIP LOCKED)로 선점 →
  provider 호출은 트랜잭션 밖 → 테넌트 스코프에서 결과 반영(종결 상태는
  워커 정책 WITH CHECK상 테넌트 스코프에서만 기록 가능 — DB 강제).
- **경계**: T3qPlanProvider 통합 포트·실 HTTP 어댑터·타임아웃/CB는 CC-125,
  본문 job·블록 재시도는 CC-130, Outbox 릴레이는 CC-270. capability는
  `legacyToc.mockAvailable=true`만 갱신(state MOCK_ONLY 불변 — mock≠실지원).
- CC-115의 describeCapability가 리뷰 중 git restore로 유실됐던 것을 발견,
  CC-120에서 재도입(ADR-25 D13).
- CI db-verify에 `pnpm --filter @une/worker test` 추가.

## 이중 리뷰 반영 (architecture-guardian + qa-gate-reviewer, 당일 전부 반영)

- **B1 (사용자 편집 보호)**: 활성 job 중 UNE-PLAN-014 저장이 워커 완료와
  경합해 사용자 버전 포인터가 AI 버전으로 덮일 수 있었음 → 저장 시 활성
  job 409 PLAN-409-002 + 워커 심층 방어(포인터 이동 감지 시 재지정 생략,
  supersededByUserEdit 마커) + e2e.
- **M2/QA**: 멱등 2차 키에 aggregateId 누락 — 같은 클라이언트 키를 다른
  계획서에 쓰면 타 계획서 job이 반환되는 결정적 결함 → 해시에 planId 포함
  + 23505 폴백에 aggregate/jobType 방어 검사 + 도메인 테스트.
- **QA 필수-2/3**: retry가 휴지통·승인잠금·활성 job 가드를 우회(휴지통
  계획서에 목차 재생성 실측 재현) → UNE-PLAN-009와 동일 전제조건 재적용
  + attempt_no 리셋(minor 5) + 단위 3종·e2e 회귀.
- **QA 필수-1**: CI db-verify에 build 누락(깨끗한 러너에서 dist 미존재로
  실행 불가 — CC-100부터의 선행 결함 포함) → `pnpm build` 스텝 추가.
- **M3**: 매퍼/가드 예외가 job을 RUNNING으로 방치(lease 만료까지) →
  provider 호출 try/catch로 PROVIDER_CONTRACT_VIOLATION 실패 정규화.
- **M4**: mock 어댑터 무조건 결선 → `UNE_T3Q_TOC_ADAPTER` 명시 플래그
  (유일 허용값 mock, 그 외 기동 실패) + 기동 로그 MOCK_ONLY 경고.
- **M1**: 0015 주석이 하위 테이블(toc_*·job_event·snapshot)을 RLS 커버로
  과장 → 사실대로 정정(RLS 부재·보상통제 명시), 디스패치 스코프 음성
  테스트 2종 추가(plan 0행/audit 거부 + 하위 테이블 접근 가능 현실 핀),
  EXISTS(부모) RLS 하드닝을 0016 후보로 CC-130 이전 과제 등록.
- **M5/QA 필수-4**: heartbeat 계약 문구를 구현(커서 반복)에 정합. mock
  불일치 3건(CANCELLED retry 허용, SSE data 형태, nodeKey 형식) 시정.
- MINOR: 이벤트 타입 JobEventType로 협착, RunSummary.skipped 분리,
  raw 상한 UTF-8 바이트 기준, 워커 리포지토리 주석 정정, x-error-codes/
  x-db-tables 보강(009 PLAN-4003·014 TOC-404-001 등), attemptNo 계약
  서술 정정, SSE 상수-계약 핀 테스트, Last-Event-ID 400 e2e.

최종 재실행: @une/api **175/175**, @une/worker 12/12, db-integration
**41/41**(신규 음성 2 포함), domain 31/31(키 스코프 테스트 갱신),
contract-tests 26/26, baseline 6, 전 게이트 PASS.

## 알려진 한계 (수용, ADR-25)

- progress_pct는 10→100 조립(블록 단위 진행률은 CC-130), 워커 시스템
  감사(TOC_JOB_FAILED/CANCELLED)는 actor_id NULL, JOB-503-001은 API가 던질
  경로 없음(스트림 인프라 오류 예약), job_event 보존·정리(CC-430),
  worker↔api 리포지토리 소량 중복(CC-130 추출 재평가), heartbeat id=커서
  반복(Nest SseStream 자체 id 부여 회피 — ADR-25 D10).
