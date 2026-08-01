# ADR-25: CC-120 TOC Job — 워커 디스패치 롤·좁은 포트·Job 상태기계

- 상태: ACCEPTED (2026-08-02, CC-120)
- 관련: 설계 10 §4.2/§6.15-16/§7.9, 설계 09 §4, ADR-21(기준선 결함),
  ADR-23(D5 오류코드·PLAN-412-001 예약), ADR-24(D8 포트 소유),
  .claude/rules/{provider-adapters,security,backend}.md

## D1. 실행 주체 = services/worker의 generation_job 폴링 (Outbox 아님)

설계 10 §4.2 "호출 주체 = UNE Plan Generation Worker", §7.9 7단계에 따라
워커가 `FOR UPDATE SKIP LOCKED` 배치로 QUEUED job을 선점한다.
`outbox_message`는 채널 발송 전용(CC-270)이며 이 루프와 무관하다. 러너는
타이머 없는 `runOnce()`(테스트 결정성) + 프로덕션 폴러(백오프, SIGTERM
드레인) 구조.

## D2. `une_worker` 롤과 "테넌트 미설정 시에만" 디스패치 정책

FORCE RLS 아래에서 une_app 워커는 타 테넌트 job을 볼 수 없다. 해소:
`une_worker`(NOLOGIN·NOBYPASSRLS·테이블별 최소권한) + generation_job 전용
정책 2개 — `une_current_tenant_id() IS NULL`(디스패치 스코프)에서만
QUEUED/RUNNING/CANCEL_REQUESTED 행이 보이고, **WITH CHECK가
QUEUED/RUNNING 쓰기만 허용**하므로 종결 상태(COMPLETED/FAILED/CANCELLED)는
테넌트 스코프 트랜잭션에서만 물리적으로 기록 가능하다. 테넌트를 설정하면
IS NULL 분기가 죽고 기존 tenant 정책만 남는다(permissive OR). 대안 기각:
테넌트 순회(O(N)·신규 테넌트 누락), SECURITY DEFINER(FORCE RLS에서
BYPASSRLS 필요 — 최소권한 역행). 실증: 통합 테스트 9종(0015) + 워커 e2e.

트랜잭션 경계: **tx A**(디스패치, 테넌트 미설정) 선점·취소 스윕 →
**tx B0**(테넌트) 전제조건·job.started → **provider 호출은 트랜잭션 밖**
(backend rule) → **tx B1**(테넌트) 취소 체크포인트 → toc_version 파이프라인
→ COMPLETED/FAILED + plan 전이 + job_event + audit 동일 트랜잭션.

**커버리지 정정(이중 리뷰 M1)**: 디스패치 스코프의 DB 강제는
generation_job(워커 정책)과 RLS 보유 테이블(plan·audit_log — 테넌트
미설정에서 정책 false)에만 성립한다. **plan_context_snapshot·toc_version·
toc_node·job_event는 기준선부터 RLS가 없어** 유일한 테넌트 보호가
애플리케이션 조인/호출부 검증 id(ADR-21 보상통제)다. job_event가 provider
원문을 담게 되었으므로 EXISTS(부모) 정책의 RLS 하드닝(0016 후보)을
**CC-130 이전 과제**로 등록한다. 통합 테스트가 현실을 고정한다(디스패치
스코프에서 plan 0행·audit 거부 / job_event·toc_version 접근 가능 —
알려진 한계 핀).

펜싱 한계(수용): lease 탈취 후 원 워커가 살아 있으면 provider **호출**
자체는 중복될 수 있다(결과 이중 반영은 FOR UPDATE + status 재확인이 차단).
비용은 mock에서 0이며 실 어댑터의 펜싱 토큰은 CC-125에서 재평가.

## D3. 좁은 `T3qTocPort` — ADR-24 D8 정합

CC-120은 `generateToc` 1메서드 포트만 정의한다(packages/provider-adapters).
Canonical 타입(TocNodeDraft/FlatTocNode, 검증·flatten·hash)은
packages/domain. CC-125가 이 포트를 `T3qPlanProvider`(toc/content/edit)로
흡수하고 Legacy/TargetV2 dual 어댑터 + feature flag를 얹는다 — 매퍼
(`legacy-toc-mapper`, `LEGACY_TOC_MAPPING_VERSION`)와 응답 가드는 그대로
승계된다. provider 실패는 throw가 아니라 **결과값**(raw 보존).

## D4. mock은 in-process·결정적·백도어 없음

`MockLegacyT3qTocAdapter`: 같은 PlanContext → 같은 목차(무작위 없음).
실패/지연 시나리오는 주입 플래그(`UNE_WORKER_MOCK_SCENARIOS`, 기본 off) +
subject 접두사(`[MOCK-FAIL]`/`[MOCK-SLOW]`)로만 — 플래그 없으면 접두사는
무의미(프로덕션 백도어 금지). FastAPI mock-server에 T3Q 라우트를 넣지
않는다(mock sync 게이트 파손). capability: `legacyToc.mockAvailable=true`,
**state는 MOCK_ONLY 유지**(실 어댑터·provider 검증 없음).

## D5. 기준선 결함 해소 (마이그레이션 0015, 신규 테이블 0건)

- generation_job `created_at/updated_at`(§6.15 IX-job_generation-TENANT가
  요구, ADR-21 유형) + `attempt_no`(재시도·lease 회계)
- CHECK 8종(상태·유형·진행률·목차 깊이 등), 누락 FK 3건(toc_version→
  snapshot, toc_node 자기참조, plan→toc_version; DEFERRABLE — plan↔version
  상호참조), `uk_toc_version_plan_version`, `uk_job_event_seq`, 디스패치
  부분 인덱스. `ix_toc_version_plan`은 uk의 Index Scan Backward가 커버함을
  EXPLAIN으로 확인해 제외.
- job_event는 append-only(REVOKE UPDATE/DELETE) — 정정도 새 이벤트.
- job_event·toc_*는 tenant_id 없는 하위 테이블 — 모든 조회는
  generation_job/plan 조인 보상통제(ADR-21). SSE 조회 경로 포함.

## D6. plan 상태 매핑 — ERROR 미사용

설계 09 §4 enum이 정본. job 시작 시 `OUTLINE_GENERATING`, 성공 시
`OUTLINE_REVIEW`, 실패/취소 시 기존 목차 유무로 파생되는 검토 상태로
복귀한다(있으면 OUTLINE_REVIEW, 없으면 CONTEXT_READY — US-PLAN-010 E-01
"OUTLINE_REVIEW" 명시 인용; OUTLINE_CONFIRMED에서 시작한 재생성이 실패하면
확정 상태는 소실되고 재확정이 필요하다 — 설계 정합, 리뷰 minor 4 정정).
plan.ERROR는 사용하지 않는다(job.status FAILED가 그 역할).
시작 가능 상태 = CONTEXT_READY/OUTLINE_REVIEW/OUTLINE_CONFIRMED(재생성);
CONTENT_* 이후의 재생성 경고는 CC-130. 사용자 확정(UNE-PLAN-014
confirm=true) 시 OUTLINE_CONFIRMED.

## D7. 멱등 2층 + PLAN-409-002 신설

①공통 인터셉터(api_idempotency, IdempotencyKeyRequired) ②DB 2차 그물:
`generation_job.idempotency_key = sha256(jobType|엔드포인트 템플릿|
**aggregateId**|클라이언트 키)` — 이중 리뷰 M2로 aggregateId가 해시에
추가되었다(없으면 같은 클라이언트 키를 다른 계획서에 쓸 때 타 계획서 job이
반환되는 결정적 오동작). 23505 충돌 시 기존 job을 조회해 반환하되
aggregate/jobType 불일치면 COM-0409로 거절(방어적 백스톱).
같은 계획서에 활성 TOC job 존재 시 **409 PLAN-409-002**(신설 — ADR-23 D5
선례). UNE-PLAN-009의 **PLAN-412-001**은 예약된 원 의미(스냅샷 미확정)로
여기서 처음 사용한다.

## D8. node_key 의미론

AI 트리는 경로 기반 결정적 키(`n-1-2` — 같은 응답이면 재시도에도 동일),
사용자 신규 노드는 `u-<8hex>` 네임스페이스(충돌 불가). 편집 버전은 기존
키를 승계한다 — CC-130 보호 블록 앵커링의 정체성 기반.
`toc_version.content_hash`는 키를 제외한 내용 해시(제목·구조·정책).

## D9. 재시도 = 동일 job 재큐잉

UNE-PLAN-013은 FAILED job을 QUEUED로 되돌린다(sequence_no·SSE 스트림 연속
유지). 사용자 주도 재시도는 **attempt_no를 0으로 리셋**한다(lease 재큐잉이
소진한 자동 재시도 예산을 상속하면 provider 호출 없이 즉시 재실패 — 리뷰
minor 5). 재시도는 UNE-PLAN-009와 동일한 계획서 전제조건(휴지통·승인잠금
412, 활성 job 409 PLAN-409-002)을 재적용한다(QA 필수-2/3 — 휴지통 계획서에
목차가 재생성되는 결함의 시정). `blockIds`는 RPT-002(CC-130) 전용 — TOC
job에는 400 PLAN-4001. 자동 재시도는 크래시 lease 재큐잉(기본 5분)과
maxAttempts(기본 3) 상한뿐 — 타임아웃·백오프·서킷브레이커는 실 어댑터
(CC-125) 소관. CANCEL_REQUESTED인데 실행 주체가 없는 job(실행 전 취소
경합·크래시)은 디스패치의 **취소 스윕**이 회수해 CANCELLED로 종결한다.

## D10. SSE 공개/내부 이벤트 분리·raw 보존 상한

공개 어휘 9종(@une/domain PUBLIC_JOB_EVENT_TYPES)만 UNE-PLAN-011로
흐른다. provider 원문(rawRequest/rawResponse)은 internal
`provider.responded|failed` job_event에 보존하되 200KB 상한(초과 시
truncated 마커) — 전용 provider trace 저장소는 CC-125에서 재평가.
heartbeat 프레임은 **마지막 전달 sequence_no를 id로 반복**한다 — Nest
SseStream이 id 없는 프레임에 자체 증가 id를 강제 부여해 커서를 오염시키는
것이 확인되어, "heartbeat는 재개 지점에 영향 없음" 보장을 커서 반복으로
구현했다(계약 description도 동일 의미). Last-Event-ID = 마지막 수신
sequence_no, SSE 최대 수명 30분(계약 명시값).

## D11. UNE-PLAN-014/015 포함, Diff 적용은 제외 — 사용자 편집 보호

사용자 편집 목차 버전 저장/조회는 "TOC version" AC에 포함(응답 검증용
트리 validator를 공유하므로 한계비용 낮음, CC-130이 확정 TocVersion을
입력으로 요구). US-PLAN-011의 항목별 Diff 적용/3-way merge UI는 CC-170.

**사용자 편집 보호(이중 리뷰 B1)**: 활성 TOC job이 있는 동안 UNE-PLAN-014
저장은 409 PLAN-409-002로 거절한다(진행 중 job이 완료되며 사용자 버전
포인터를 AI 버전으로 덮어쓰는 경합 차단 — CLAUDE.md 사용자 편집 보호).
심층 방어로 워커 tx B1은 tx B0에서 스냅샷한 `current_toc_version_id`와
비교해 포인터가 이동했으면(비-API 경로) AI 버전을 행으로만 남기고
재지정하지 않으며 `job.completed`에 `supersededByUserEdit: true`를 남긴다.
확정(OUTLINE_CONFIRMED) 후 재편집/재생성은 검토 상태로의 강등을 **의도된
동작**으로 확정한다(확정은 목차의 스냅샷 버전 행으로 보존됨).

## D12. worker↔api 리포지토리 소량 중복 수용

동일 테이블에 대한 소규모 raw SQL이 양쪽에 존재한다(worker-repositories
vs services/api plan 리포지토리). 공유 패키지 추출은 소비자가 3곳이 되는
CC-130에서 재평가 — 그 전 추출은 추상화 비용이 더 크다.

## D13. capability 갱신

`legacyToc.mockAvailable=true`(본 ADR + CC-120 증거 문서가 근거),
state/adapterImplemented 불변. CC-115의 describeCapability 헬퍼는 리뷰
반영 중 테스트 복원(git restore)에 유실됐던 것이 확인되어 CC-120에서
재도입했다(증거 문서에 기록).

## 결과·한계

- 산출물: 0015(+통합 9), 도메인 plan 모듈(상태기계·트리·요청 시임),
  T3qTocPort+매퍼+가드+mock(+단위 16), 워커 러너/폴러(+e2e 7),
  UNE-PLAN-009~015 API·SSE, 계약 상세화·mock 18라우트.
- 수용 한계: 워커 감사 중 시스템 이벤트(TOC_JOB_FAILED/CANCELLED 스윕)는
  actor_id NULL(시스템 주체), progress_pct는 10→100 조립(세밀한 진행률은
  CC-130 블록 단위에서), job_event 정리·보존정책은 CC-430 계열.
- 수용 한계(추가, 이중 리뷰/QA): `job.progress`·`provider.requested` 이벤트
  어휘는 선언만 있고 CC-120은 발행하지 않는다(블록 단위 진행이 생기는
  CC-130에서 발행 시작). `generationOption`은 request_json→포트까지
  전달되지만 legacy 매퍼(RPT-001 계약에 대응 필드 없음)와 mock이 사용하지
  않는다 — 실제 반영 방식은 CC-125에서 legacy 계약 한계와 함께 확정.
  raw 상한은 UTF-8 바이트 기준 200KB(초과 시 truncated 마커). mock
  어댑터는 명시 플래그(`UNE_T3Q_TOC_ADAPTER=mock`, 유일 허용값)로 결선되고
  기동 로그에 MOCK_ONLY 경고를 남긴다(M4).
