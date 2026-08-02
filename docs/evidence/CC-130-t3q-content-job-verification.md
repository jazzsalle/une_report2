# CC-130 검증 증거 — T3Q RPT-002 CONTENT Job과 보호 블록

- 일자: 2026-08-02 (집 PC, 로컬 PostgreSQL 16 @ 15432/WSL2)
- 브랜치: feature/CC-130 (base: main 61e140a = PR #8 머지)
- 결정 기록: ADR-27 (D1~D12 + 수용 한계)

## 수용기준 대응

| AC | 구현 | 증거 |
|---|---|---|
| partial content events | `content.block` 공개 이벤트 신설 + `job.progress` 발행 시작(스로틀) — 동기 응답을 tx B1에서 블록 단위로 합성(US-PLAN-012 A-02) | 워커 e2e 이벤트 순서·SSE e2e content.block 2건 + provider.* 은닉 |
| cancel/retry | UNE-PLAN-012/013 job 타입 인지형 확장(복귀 함수·감사 분기), jobType별 취소 스윕, blockIds 400 유지 + `targetNodeKeys` 범위 재생성=새 job | 워커 e2e per-type 스윕·API e2e 409/412/400 음성 |
| protected user blocks | protectedBlockIds → USER_LOCKED 영속(요청 시점) + 워커 B0/B1 이중 필터 + 0017 DB 트리거(une_worker 보호 행 변경 불가) — provider 미전송(OB-01) | 워커 e2e PRESERVED(행 불변) + db-integration 트리거 음성 6종 |
| evidence mapping | ContentDraft.citations → `citations_json` + `citation_count` 생성 컬럼 + no-evidence 부분 인덱스, `blocksWithoutEvidence` 가시화 | 워커 e2e leaf 인용 단언 + contentSummary 검증 + EXPLAIN 인덱스 핀 |

## 게이트 실행 결과 (이중 리뷰 반영 후 최종 수치는 하단 리뷰 절 참조)

| 게이트 | 결과 |
|---|---|
| `@une/domain` | 49/49 (generated-block 앵커링 7·content-job-request 4·plan-status CONTENT 3 신규) |
| `@une/provider-adapters` | 67/67 (mock 결정적 근거 생성 단언 추가) |
| `@une/contract-tests` | 38/38 (legacyContent UNE_ADAPTER_READY 승격 후 거버넌스 회귀) |
| `@une/db-integration` | 65/65 (0017 신규 14 — RLS·트리거·부분 유니크·EXPLAIN 2종) |
| `@une/worker` | 30/30 (content e2e 6 신규: 전여정/보호/세대 supersede/아웃라인 이동/범위/스윕 격리) |
| `@une/api` | 188/188 (content-job service 11 + e2e 2 신규) |
| `pnpm db:migrate` (0017) | 적용 — 60번째 테이블, FORCE RLS, 트리거 2, 인덱스 5, 양 롤 DELETE 없음 |
| `pnpm validate:contracts` | PASS — mock sync 19라우트, une-platform 예제 3건 |
| `python -m pytest tests/baseline` | 9 passed (본문 job 흐름 3 신규) |
| build/typecheck/lint/format/handoff/타입 드리프트 | 전부 PASS |

## 핵심 검증 포인트

1. **보호 3중 방어 실증**: 워커 필터(PRESERVED 이벤트, 새 행 0) + DB
   트리거가 `SET LOCAL ROLE une_worker`에서 보호 행 supersede/본문 변경을
   42501로 거부(대조: superuser에서는 통과 — 트리거 판정 증명), 부분
   유니크가 이중 현재 행을 물리 차단.
2. **세대 모델**: 재생성 시 구 행 불변 supersede(순서: supersede→insert→
   link — 부분 유니크의 과도 상태 금지 실측 반영), generation_no 단조.
3. **오앵커링 차단**: 위치+정규화 제목 이중 일치, 불일치·아웃라인 밖 블록은
   전량 격리(부분 수용 없음); 아웃라인 이동 시 B0 fail-closed / B1 전량
   폐기(`supersededByOutlineChange`).
4. **구현 결함 자체 발견·수정 2건**: (a) toc_node.sort_order는 형제 내
   순서 — 트리 재구성 ORDER BY를 level 선행으로 수정, (b) supersede 전
   insert가 uk_current와 충돌 — 쓰기 순서 재정렬. DB 에이전트 발견 1건:
   BEFORE 트리거에서 STORED 생성 컬럼 NULL → 비교 제외(0017 §7 주석).
5. **활성 job 불변식 확장**: TOC↔CONTENT 상호 409, 본문 존재 시 TOC
   재생성 412(신규·재시도 모두) — API e2e 고정.
6. **capability 승격**: legacyContent → UNE_ADAPTER_READY(ADR-26 D7 3조건
   충족; OPEN_BINDINGS 무변경; CR-T3Q-* 불변식 회귀 green).

## 이중 리뷰 (병렬, opus — 당일 전건 반영)

**architecture-guardian: BLOCKER 1 / MAJOR 5 / MINOR 11.**
- **B-1(=QA F2)** 범위 재생성이 프루닝 트리 기준 walk 상대값으로
  outline_level/sort_order를 기록 → 불변 행에 구조 손상. **시정**:
  `outlineCoordinates(전체 트리)`를 앵커링에 주입(절대 좌표), 도메인
  음성 3종 + 워커 e2e를 심층 노드(n-1-1)·후미 노드(n-2)로 교체해 좌표
  동일성 고정. (기존 e2e가 첫 최상위 노드만 써서 결함이 가려졌던 것도
  교훈으로 기록.)
- **M-1(=QA G1)** B1 아웃라인 이동 폐기 경로가 plan을 CONTENT_GENERATING에
  고착 → 폐기 분기에 abort 복귀 추가 + 어댑터 훅으로 B0↔B1 사이 이동을
  실측하는 e2e 신설(전량 폐기·plan 복귀 동시 단언).
- **M-2** UNE-PLAN-014 수동 목차 저장이 본문 존재 시 무차단(앵커 고아화
  우회로) → saveVersion에 412 가드 + 단위/e2e + 계약·mock 동기.
- **M-3(=QA F1)** targetNodeKeys 미존재 노드 400 vs 계약·mock 422 →
  `targetNodeUnknown`(422 PLAN-422-002)로 통일, 형식 오류만 400 유지.
- **M-4(=QA F3)** PRESERVED 프레임 contentHash/citationCount null → 기존
  행 값 탑재(FAILED와 구분 가능), 저장소 SELECT 확장 + e2e 단언.
- **M-5(=QA F4/G9)** 009/012/013/016 계약의 x-db-tables·x-error-codes·
  서술 미갱신 → 전부 동기(016 +PLAN-4003, 013 +PLAN-412-002/409-002).
- MINOR 11건 반영: 진행률 마지막 블록 항상 발행(m-1/G4), contentSummary
  서술 현행 능력으로 축소(m-2/G5), CONFIRMED 명시 검증(m-3), USER_LOCKED
  비가역 수용 한계 기재(m-4), markProtected no-op fail-closed(m-5),
  hasCurrentBlocks 리포지토리 경유(m-6), FAILED 어휘 선언적 명시(m-7),
  generation_no MAX 산정(m-8), 활성 job 메시지 일반화(m-9), CC-135 trace
  주석(m-10), tx B1 상한 근거 기재(m-11).

**qa-gate-reviewer: PASS WITH CONDITIONS — 필수 5건(F1~F5) 전부 반영.**
- 주장 수치 **전부 독립 재현**(전 스위트 + validate:contracts + 타입/사전
  드리프트 0 + 0017 카탈로그). F1=M-3, F2=B-1, F3=M-4 동일 건. F4 016
  PLAN-4003 누락 → 계약 반영. F5 본 절 공란 → 본 기록으로 해소.
- 권고 반영: G1~G7 상기 포함, G2(TOC 재시도×본문 412 무테스트 → 단위
  추가), G3(CONTENT cancel/retry 타입 분기 무테스트 → 단위 3종 추가),
  G6(markProtected 실 DB 영속 무검증 → e2e 2라운드 보호 여정 추가),
  G8(CI에 pytest baseline 편입).

**반영 후 최종 수치**: domain **52**, provider-adapters 67, contract-tests
38, db-integration 65, worker **31**, api **193**, baseline **10** —
전부 green. tx B1 상한 근거(m-11): 최대 500블록 ×
블록당 2~4 왕복, 외부 호출 없음, 로컬 실측 전여정 ~0.3s — 리스 기본
300s 대비 여유 2자릿수 배.

## 알려진 한계 (ADR-27 수용 한계)

부분 이벤트 비실시간(완료 시 일괄 — CC-135/CC-400), 프루닝 상위맥락
미전송(CR-T3Q-002 재평가), ck_citations_array 실거부 22023, legacy 멱등키
부재로 provider 중복 실행 가능성 잔존(UNE 측 반영은 1회 보장).
