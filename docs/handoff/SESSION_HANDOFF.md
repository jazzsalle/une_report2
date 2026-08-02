# Session Handoff

- Date/time: 2026-08-02 (집 PC, CC-135 세션)
- Branch: **feature/CC-135** @ main d66b675 기반 (CC-130은 PR #9 머지 완료)
- Current Work Item: **CC-135 DONE(구현·이중리뷰 반영·게이트 통과)** —
  커밋·push 후 PR 대기 / next **CC-140** (HWPX import·IR, deps=CC-001)
- 이 PC(집 PC): 로컬 DB 포트 **15432**, 마이그레이션 **17개**(변경 없음 —
  CC-135는 마이그레이션 0건). gh CLI 2.97 설치·인증됨(PR/CI를 gh로 처리).

## Completed this session (CC-135)

**target-v2 전체 mock** — 수용기준 5종 전부 기계 검증. 상세: ADR-28,
docs/evidence/CC-135-target-v2-mock-verification.md. 대전제: 전부
**MOCK_ONLY**(계약 미수락 OB-10/11) — 실제 T3Q 지원 아님.

- **포트**: 믹스인 4종(semanticEdit/evidence/validation/jobLifecycle) —
  op 어휘 6종 불변(라이프사이클은 jobStatus로 보고, ADR-28 D2),
  T3Q_CONFLICT, describeRuntimeFeature(AC5). canonical-lite provisional
  타입은 @une/domain(provider DTO 격리, D3).
- **mock**: MockTargetV2JobStore 단일 대장(폴링·SSE·취소·부분재시도 무모순),
  `.assumed` SSE(종결 이벤트 필수; 종결 이후 재개=빈 프레임 성공 — QA F-3),
  부분재시도(실패 SECTION만; BLOCK은 422 not-mocked), 멱등 재제출(페이로드
  불일치 409), PARTIAL 비종결 fail-closed(D4).
- **contentV2**: 섹션 블록 결합→outline 평행 트리(D7), evidence provenance
  → citations_json 왕복 실증(마이그레이션 0건 — 카탈로그 핀), validation
  판정은 어떤 UNE 경로도 차단 안 함(D9; ADR-27 D8 원문 정정).
- **워커**: CC-130 m-10 trace seam 종결, **부분실패는 행 미기록·미supersede
  + failed 감사 카운트**(아키 M-1), 기동 시 8개 v2 feature MOCK 라인 출력.
- **리뷰 시정 핵심**: 어댑터 신고∪관측 실패 합집합(M-2 fail-open), 보호
  재검사 payload 재귀 스캔(m-5), live transport 생성자 opt-in(F-4/m-8 —
  타임아웃/재시도/CB 정책은 CC-400 전 부재), 계약 캐비앗을 렌더링되는
  example summary/description으로(m-3).
- 계약: 응답측 예제 12→22(ADR-24 R2 종결), 면제 2→0, 버전 1.0.1-request
  유지(생성 타입 diff 0), retry 예제 SECTION화.
- 게이트(반영 후): domain 52, provider-adapters 108, contract-tests 60,
  db-integration 68, worker 33, api 193, baseline 10 — 전부 green.

## Exact next actions

1. **사용자**: PR 생성·머지(CI verify + db-verify) — gh CLI 사용 가능.
2. 다음 항목 **CC-140**(HWPX import·provenance·IR·prototype 분석 셸,
   deps=CC-001): rhwp 소스 반입 규칙(CLAUDE.md HWPX rules — tag/commit/
   SHA-256/license/SBOM 기록, 공개 포크 기준선 금지) 선행 확인 필요.
   hwpx-specialist 에이전트 활용 후보.
3. CC-135 이월: 실계약 검증·실 SSE·live 정책(타임아웃/CB)·실시간 반영·
   전체 아웃라인+SECTIONS 전송 재평가(CC-400), proposal 적용·id 공간
   바인딩(CC-150), EvidenceSet 영속(CC-230), INSERT_BLOCK targetId 규약
   (OB-10), UNI 무호출 런타임 증명(CC-170).

## Risks/blockers

- v2 mock 충실도가 높아 "T3Q 지원"으로 오독될 위험 — 기계 가드 3중
  (레지스트리 MOCK_ONLY 고정·describeRuntimeFeature·providerBuild
  une-mock-*)이 차단하나, 문서·보고에서 표현 주의 유지.
- live v2 transport는 정책 부재로 생성자 opt-in 없이는 거부됨 — CC-400
  전에 실 호출 경로를 만들지 말 것.
- 로컬 무DB `pnpm test`는 worker e2e·db-integration이 조용히 skip — CI
  db-verify가 커버. DATABASE_URL(superuser)을 설정하고 돌릴 것.
- 기존 이월분(OB-01/10/11 OPEN, redocly CC-400) 유지.

## Notes

- 이 PC DATABASE_URL: superuser une @ localhost:**15432**
  (infrastructure/.env 조합; WSL vmIdleTimeout으로 컨테이너가 내려갈 수
  있음 — `wsl -d Ubuntu` 깨우고 `docker start une-postgres`).
- prettier를 docs/·contracts/에 실행하지 말 것(사고 2회) — 커밋 전
  `git status -- docs/design-markdown` 무변경 확인.
- services/api e2e는 워커 **소스**를 상대경로 import — dist 검증 금지.
- mock-server의 멱등키 누락 응답은 400(관례; 계약상 428 COM-0428) —
  테스트 주석에 기록됨, 일괄 전환은 별도 판단.
- 모델: 이 세션은 Fable 5. 다음 세션이 Opus 5로 돌아도 인계는 본 문서 +
  memory + 상태 문서로 충분(모델 무관); 서브에이전트 정책(opus)·이중
  리뷰·게이트 절차는 그대로 유지할 것.
