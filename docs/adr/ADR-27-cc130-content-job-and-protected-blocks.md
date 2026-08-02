# ADR-27: CC-130 CONTENT Job — generated_block·보호 블록·부분 이벤트 합성

- 상태: ACCEPTED (2026-08-02, CC-130)
- 관련: 설계 10 §3.3(UNE-PLAN-016)/§4.2(RPT-002 행), 설계 05 US-PLAN-012/013/014,
  설계 09 §4/§5.2, ADR-25(D6/D9/D11/D12), ADR-26(D2/D4/D5/D7),
  .claude/rules/{provider-adapters,backend,architecture,security}.md

## D1. 별도 ContentJobRunner + 디스패치 원시연산 공유 (ADR-25 D12 처리)

TocJobRunner 확장(분기 폭증)과 제네릭 Strategy(1개 사례로 조기 추상화)를
기각하고 **별도 러너 + `plan-jobs/job-dispatch.repository` 공유**를 채택.
claim/sweep/job 상태/이벤트/감사/plan 갱신은 jobType 파라미터화만으로
공유되고 파이프라인은 완전 분리된다. 취소 스윕은 **jobType별 분리** —
TOC 러너가 CONTENT job을 종결하면 plan 복귀 규칙이 틀린다(e2e 고정).
폴러는 `PlanJobPoller`(러너 배열 순차 실행)로 일반화, 의미 불변.

ADR-25 D12(리포지토리 추출 트리거)는 **워커 내부 중복 해소로 충족**로
판정한다. api↔worker 공유 패키지는 재이연하되 종결 기준을 명문화한다:
*CC-150이 document_revision 쓰기의 3번째 소비자를 만들거나, 동일 테이블
SQL 결함이 api/worker 양쪽에서 재발하면 추출한다.*

## D2. `generated_block` — 60번째 테이블, 행 불변 + 세대 모델 (0017)

- **근거**: 설계 §3.3 UNE-PLAN-016 DB열·§7 추적표·OpenAPI x-db-tables가
  이름을 확정했으나 §6.2 DDL 표에서 누락 — ADR-21 유형 기준선 결함의
  해소다(59→60, migrations.test 단언 갱신).
- **앵커** = `node_key`(ADR-25 D8 예고). **부모** = plan + toc_version(생성
  기준 기록); `content_version` 부모 테이블은 설계 근거가 없어 기각.
- **세대**: 행은 불변, 재생성은 새 행(generation_no+1) + 구 행
  supersede. `uk_generated_block_current`(부분 유니크)가 노드당 현재 행
  1개를 물리적으로 강제 — 쓰기 순서는 supersede → insert → link(과도
  상태도 유니크가 금지하므로). 제자리 UPDATE(이력 소실)와 전체 스냅샷
  버전(보호 블록 세대 복사) 기각.
- `generated_block`은 PLAN 도메인의 **생성 산출물(staging)**;
  `document_block`(0003)은 DOC 도메인의 편집 표면이고 CC-150이
  materialize를 소유한다.
- RLS: 0016 패턴 EXISTS(plan) ENABLE+FORCE. GRANT: une_worker
  SELECT/INSERT/UPDATE(트리거로 범위 제한), 양 롤 DELETE 금지(이력).
- 한계(DB 리뷰 발견): BEFORE 트리거에서 STORED 생성 컬럼(citation_count)은
  NULL — 트리거 비교에서 제외(원본 citations_json은 비교). CHECK
  `ck_generated_block_citations_array`는 생성 컬럼 계산이 선행돼 실거부
  코드가 22023(불변식 선언으로 유지, 테스트 핀).

## D3. 상태 어휘 3분할 — job PARTIAL 미도입

행 `status`(GENERATED|FAILED) × 행 속성 `protection_state`(0003 어휘
NONE|USER_LOCKED|SYSTEM_LOCKED 재사용 — CC-150 무마찰 승계) × 이벤트
`outcome`(GENERATED|PRESERVED|FAILED — PRESERVED는 "이번 세대에 아무 일도
없었다"는 사건이지 행 상태가 아님). JobStatus에 PARTIAL을 추가하지
않는다: 0015 CHECK·상태기계·계약 enum·SSE 종결 판정이 전부 흔들리고,
부분성은 블록 상태+job.completed 카운트에서 파생된다(ADR-25 D6 선례;
설계 09 §5.2 PARTIAL은 화면 상태). plan 전이: 시작 CONTENT_GENERATING /
성공 EDITING / 중단은 현재 블록 유무로 EDITING·OUTLINE_CONFIRMED 복귀
(plan.ERROR 불사용).

## D4. 보호 블록 = 요청 시 영속 선언 + UNE 측 3중 집행, provider 미전송

- 기록: UNE-PLAN-016 `protectedBlockIds`를 **USER_LOCKED 영속 기록**으로
  승격(계약 필드 기존재; 별도 편집 API는 CC-150 소유라 신설 기각; 요청
  payload 한정 보호는 클라이언트 성실성 의존이라 기각). 알 수 없는 id는
  422 PLAN-422-002.
- provider에는 보호 정보를 **보내지 않는다** — legacy RPT-002에 대응
  필드가 없다(갭 매트릭스; 필드 발명은 OB-01 위반). 전체 생성은 전체
  아웃라인을 보낸다(프루닝은 앵커링을 약화).
- 집행 3중: ① tx B0 대상 계산, ② tx B1 반영 직전 보호 상태 재조회(경합
  시 PRESERVED 이벤트만), ③ **DB 트리거** — une_worker는 보호 행 변경
  불가 + 변경 가능 컬럼을 supersede 3종으로 제한(ADR-26 M2 "기제로 보장"
  이식; 통합 테스트가 SET LOCAL ROLE로 실발동 검증).
- **아웃라인 이동 방어**(ADR-25 D11 이식): B0에서
  plan.current_toc_version_id ≠ 매니페스트 → fail-closed(OUTLINE_CHANGED);
  B1에서 이동 감지 시 결과 **전량 폐기** + `supersededByOutlineChange`.

## D5. 부분 이벤트 = UNE 합성(US-PLAN-012 A-02), 진짜 스트리밍 미채택

공개 어휘에 **`content.block`**({nodeKey, blockId, outcome, sortOrder,
outlineLevel, contentHash, citationCount, reason?}) 신설 + **`job.progress`
발행 시작**(ADR-25 이월 종결; 블록 10개/10%p 스로틀). 동기 JSON과 SSE가
어댑터에서 동일 canonical로 수렴하므로 tx B1에서 블록 순서대로 합성한다.
진짜 스트리밍(프레임별 짧은 tx) 기각 근거: SSE 프레이밍이 UNE 가정
(OB-01)인 위에 지속성 경로를 얹게 되고, 외부 호출 중 DB 쓰기 인터리브가
3-tx 취소 원자성을 무너뜨린다. **수용 한계**: legacy 경로의 부분 이벤트
타이밍은 실시간이 아니다(완료 시 일괄) — 실시간은 CR-T3Q-003 수용
후(CC-135/CC-400). 워커 운영 경로는 `stream:false`(동기 JSON);
`UNE_T3Q_CONTENT_STREAM` seam만 예약.

## D6. cancel/retry 재사용 — job 타입 인지형 확장

UNE-PLAN-012/013을 job 타입 인지형으로 확장: 상태기계·경합 처리는 CC-120
검증분 그대로, plan 복귀 함수(D3)와 감사 action(`{jobType}_JOB_*`)만
분기. QUEUED 즉시 종결 / RUNNING은 워커 체크포인트 원칙 불변.

## D7. 부분 재시도 = 새 job (`targetNodeKeys`), `blockIds`는 400 유지

`blockIds`는 양 타입 모두 400 — legacy는 실패 대상 식별자 자체가 없다
(failedTargetIds는 CR-T3Q-003, OB-10). **범위 지정 재생성 = UNE-PLAN-016
`targetNodeKeys`로 새 job**(자체 멱등키·SSE·감사; 같은 job 행의
매니페스트를 좁히는 안은 ADR-25 D9 "동일 job 재큐잉" 원칙과 재현성을
깨서 기각). provider 실패 블록 단위 재시도(partialRetry)는 CC-135.
프루닝은 대상 subtree만 전송(상위맥락 미포함은 단순화로 기록 —
US-PLAN-014 A-01의 "필요한 상위맥락"은 CR-T3Q-002 재평가).

## D8. 근거 매핑 = `citations_json` 비정규화 (+ citation_count 생성 컬럼)

legacy citation({sourceRef,fileName,page})은 안정 id·검색 경로가 없어
정규화 테이블은 v2 Citation 형상 추정(OB-10/11)이 된다 — 기각.
`ix_generated_block_no_evidence` 부분 인덱스로 "근거 없는 블록" 탐지 경로
확보; `blocksWithoutEvidence`를 job.completed와 contentSummary에 가시화
(~~차단은 CC-135 validation~~ — **정정(ADR-28 D9)**: CC-135 validation은
MOCK_ONLY이므로 어떤 UNE 경로도 차단하지 않는다; 실제 차단은 CR-T3Q-006
수락(OB-11 종결) 후 CC-400/CC-170 판단. LLM 출력 비권위 규칙은 가시화+편집
표면으로 이행). 정규화 저장소 도입 조건: 근거가 검색 가능한 식별자를 갖는
시점(CR-T3Q-005 수용, CC-230 EvidenceSet) — 그때 citations_json이
마이그레이션 원천.

## D9. 활성 job 불변식의 job 타입 확장과 TOC 재생성 차단

`findActivePlanJob`(타입 무관)로 강화 — 진행 중 CONTENT job의 앵커가
목차 재생성으로 사라지는 경합의 원천 차단. 본문 블록 존재 시 **TOC
job(신규·재시도)과 UNE-PLAN-014 수동 목차 저장/확정 전부** 412 차단
(리뷰 M-2 반영 — 수동 편집도 동일한 앵커 고아화 경로다) — 목차 변경 영향
Diff 플로우는 CC-170(ADR-25 D6 이월 종결). 도메인 TOC_JOB_STARTABLE
집합은 불변(차단은 서비스 계층 — plan-status.ts 주석). 계약은
CONTENT_GENERATING에서 409(활성 job)가 412(상태)보다 우선함을 고정.

**앵커 좌표 규칙(리뷰 B-1/F2 반영)**: generated_block의
outline_level/sort_order는 항상 **확정 목차 전체 기준의 절대 좌표**다 —
`outlineCoordinates(전체 트리)`를 앵커링에 주입하며, 범위 지정
재생성(프루닝된 subtree)에서도 walk 상대값을 쓰지 않는다. 상대값이
기록되면 불변 행에 구조 손상이 영구화된다(레벨 소실·순서 충돌).
B1 아웃라인 이동 폐기 시 plan은 abort 복귀(D3)를 따른다 —
CONTENT_GENERATING 고착 금지(리뷰 M-1).

## D10. 계약: 016 상세화, 본문 조회 op 미신설

016을 009 수준으로 상세화(GenerationJobResponse/IdempotencyKeyRequired/
x-error-codes/x-db-tables/예제 3종), `GenerationJobResource.result`에
`contentSummary` 선택 속성(oneOf 분기 기각 — 생성 타입 파괴),
`targetNodeKeys` 신설, retry `blockIds` 서술 최종화, mock 19라우트 동기.
**본문 조회 op(UNE-PLAN-017)는 신설하지 않는다**: 설계 §3.3은 016에서
끝나고 편집·조회 표면은 UNE-DOC-005~011(CC-140/150) 소유 — 지금 만든
블록 리소스는 CC-150이 즉시 재정의해야 한다. 결과 가시성은
contentSummary + content.block SSE로 충족(데모 필요 시 재평가).

## D11. legacyContent → UNE_ADAPTER_READY

ADR-26 D7 3조건 충족: 어댑터 구현(CC-125) ∧ 런타임 결선(본 항목:
ContentJobRunner + UNE-PLAN-016) ∧ live spec(RPT-002 v0.8.5). OB-01은
T3Q_*_VERIFIED만 차단. OPEN_BINDINGS 무변경. contentV2/partialRetry/
jobSse는 CR-T3Q-* 불변식으로 MOCK_ONLY 고정.

## D12. generationOption 종결 (ADR-26 수용 한계)

CONTENT job은 generationOption을 받지 않는다 — 설계 §3.3 핵심요청은
snapshotId/tocVersionId/protectedBlocks뿐이고 legacy에 대응 필드가 없으며
v2 generationOption은 OB-10 OPEN. TOC의 기존 취급(전달만)은 불변. UNE 측
생성 옵션의 실반영은 v2 수용(CR-T3Q-002) 시점에 결정한다.

## 수용 한계 (재평가 지점)

- 부분 이벤트 비실시간(D5) — CC-135/CC-400.
- 프루닝 시 상위맥락 미전송(D7) — CR-T3Q-002 재평가.
- **USER_LOCKED는 CC-150 전까지 비가역**(리뷰 m-4): 보호 해제
  API/경로가 없다 — 해제는 CC-150 편집 표면(document_block 승계) 소유.
  0017 트리거는 une_worker의 보호 행 변경을 영구 차단하며, une_app 경유
  해제 op이 생기면 RBAC·감사가 통제가 된다(0017 §7).
- `generated_block.status='FAILED'`와 `content.block outcome=FAILED`는
  legacy 경로에서 구조적으로 발생하지 않는다(응답 정합 위반은 전량 격리 →
  job FAILED) — 어휘는 CC-135 partialRetry를 위한 선언(리뷰 m-7/G5).
- tx B1은 최대 500블록 × 소수 왕복을 한 트랜잭션에서 수행한다(외부 호출
  없음) — 리스 300s 기본 대비 충분하나 상한 근거는 증거 문서에 기록
  (리뷰 m-11).
- ContentJobRequest에 보호 선언을 담지 않음(보호는 DB가 정본; 매니페스트
  재현성은 스냅샷·목차 해시가 담보) — 감사 필요 시 job.queued payload의
  protectedBlocks 카운트 참조.
- ck_generated_block_citations_array 실거부 코드 22023(D2) — 불변식
  선언으로 유지.
- legacy 중복 실행 가능성(멱등키 부재)은 CONTENT에서 비용이 더 크다 —
  ADR-26 D3 리스 하한 검증 재사용, 결과 반영은 FOR UPDATE 재확인으로
  1회 보장(UNE 측).
