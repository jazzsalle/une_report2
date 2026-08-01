# Session Handoff

- Date/time: 2026-08-02 (집 PC, CC-115 세션)
- Branch: **feature/CC-115** @ main c36c28b 기반 (CC-110은 PR #5로 머지 완료)
- Current Work Item: **CC-115 DONE(구현·이중리뷰 반영·게이트 통과)** —
  커밋·push 후 PR 대기 / next **CC-120** (deps=CC-115)
- 이 PC(집 PC): WSL2 Ubuntu 26.04 + Docker CE 29.7.1, 마이그레이션 14 +
  dev 시드. **로컬 DB 포트 15432**(Windows 네이티브 PostgreSQL이 5432 점유;
  gitignored .env 2곳만 — 저장소·회사 PC 기본값은 5432).

## Completed this session (CC-115)

**T3Q 계약 기준선** — 수용기준 5종 전부 기계 검증으로 충족.

- **target-v2 계약 1.0.1-request** (사용자 승인): allOf+additionalProperties
  조합 결함(요청 5종 중 4종 구조적 충족 불가, ajv 실측) →
  `unevaluatedProperties`로 수정. 유일 예제의 required 누락 보정 + 예제
  10건 확충(PlanContext 어휘). **필드 수준 요청 내용 불변** — ADR-24 D1 +
  provider-requests 각주(예제 어휘 교체까지 명시).
- **example 게이트**(validate-contracts.mjs 섹션 4): media-type 예제↔스키마
  ajv 검증, 커버리지는 "전 operation − 사유 명시 예외 3건"(허용목록 공허화
  불가), 2xx만 크레딧, **legacy 전사본 SHA-256 핀**. 음성 재현 5종 증거.
- **@une/contract-tests 신설**(tests/contract, CC-003 이연분 이행): legacy
  픽스처 13(UNE 작성·provider 미확인 명시, SSE `.assumed.`), 갭 매트릭스
  드리프트 5(경로 존재성+3방향 완전성+행 대응), capability 거버넌스 6,
  no-UNI 정적 가드 2 = **26/26**. vitest alias로 **소스** 검증(QA F1 —
  dist 검증이 단독 실행 false green이었음).
- **capability 레지스트리**(provider-adapters/src/capability): 14 feature
  전원 MOCK_ONLY + describeCapability(상태 단독 노출 방지). 승격 의미론
  (ADR-24 D6 개정): OPEN 바인딩은 T3Q_*_VERIFIED만 차단,
  UNE_ADAPTER_READY는 adapterImplemented=true로 도달 가능(CC-125에서 가드
  수정 불요), VERIFIED는 docs/evidence/CC-*.md 실재+본문 언급 필수.
- **갭 매트릭스**: docs/handoff/T3Q_PLAN_FIELD_GAP_MATRIX.md (PlanContext
  18리프 ↔ legacy ↔ PlanRequestBase 17필드/required 15) — CC-120/125/130
  매핑 구현의 정본.
- 마이그레이션 **0건**(ADR-24 D6), 포트는 CC-125 소유(D8), redocly는
  CC-400 재이연(D5).
- 이중 리뷰 반영: architecture-guardian(B1 상태갱신 + M1 가드 의미론 +
  M2 배너 버전 동적화 + M3 커버리지 반전 + MINOR 10) / qa-gate-reviewer
  (F1 dist→소스, F2 필드수 오기 + 권고 6) — **당일 전부 반영**, 상세는
  docs/evidence/CC-115-t3q-contract-baseline-verification.md.
- CHANGELOG에 CC-110·CC-115 항목 추가(CC-110 누락분 소급).

## Exact next actions

1. **사용자**: 커밋 승인 → push(승인 프롬프트) → PR 생성·머지(CI 확인).
2. 다음 항목 **CC-120**(T3Q RPT-001 TOC job, mock adapter): generation_job/
   job_event(0003), UNE-PLAN-009~013, T3qPlanProvider 포트+LegacyT3qPlanAdapter
   착수는 CC-125와 경계 확인(포트는 CC-125 AC — CC-120은 mock adapter 사용
   측), **PLAN-412-001(스냅샷 미확정) 여기서 사용**(ADR-23 D5 예약),
   Job/Outbox 트랜잭션 경계(설계 10 §4.2, SEQ-SCR-PLAN-006), 갭 매트릭스가
   매핑 정본.
3. capability 승격 절차: 증거 → OPEN_BINDINGS → 레지스트리 → 이중 리뷰
   (거버넌스 테스트가 강제).

## Risks/blockers

- OB-01(T3Q 인증/타임아웃/오류/SSE 프레이밍)·OB-10/11(v2 수락) 여전히 OPEN
  — 픽스처·전사본은 UNE 가정, 실계약 검증은 CC-400.
- Deferred(이월): target-v2 응답측 예제(CC-125 mock과 함께), no-UNI 가드
  루트 확대(CC-125), redocly 최소 프로파일(CC-400), example-level 계약
  테스트의 플랫폼 계약 확대(CC-400), 기존 이월분(ADR-23 잔여 등) 유지.
- WSL 유휴 종료 — 긴 세션엔 keepalive.

## Notes

- git push: 승인 프롬프트 방식(2026-08-01 deny 해제).
- 전사본(t3q-report-adapter) 변경 시 validate:contracts의 SHA-256 핀이
  실패한다 — 핀 갱신은 provider-truth 리뷰와 함께만.
- 이 PC DATABASE_URL: superuser une @ localhost:**15432** (비밀값은
  infrastructure/.env).
