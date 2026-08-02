# Session Handoff

- Date/time: 2026-08-02 (집 PC, CC-140 세션)
- Branch: **feature/CC-140** @ main 0c5e198 기반 (CC-135는 PR #10 머지 완료)
- Current Work Item: **CC-140 DONE(구현·이중리뷰 반영·게이트 통과)** —
  커밋·push 후 PR 대기 / next **CC-150** (Revision/ChangeSet, deps=CC-135·CC-140)
- 이 PC(집 PC): 로컬 DB 포트 **15432**. CC-140은 **마이그레이션 0건**이라
  DB 없이도 대부분의 게이트가 돈다(다른 워크스페이스 회귀 확인 시에만 필요).

## Completed this session (CC-140)

**rhwp는 여전히 미반입이다.** 이 항목은 반입을 실행하지 않고 **반입을
강제·검증하는 게이트**를 만든다(ADR-29 D1, OB-12). 상세: ADR-29,
docs/evidence/CC-140-hwpx-ir-verification.md.

- **반입 게이트**: `pnpm validate:intake` **R1~R12**를 CI verify에 배선 —
  provenance 스키마(20필드 + G15 poc_gate), floating ref 금지,
  `tree_digest`로 upstream 직접 수정 차단(패치는 PATCHES.yaml로만),
  서브모듈 우회·notices 드리프트·SBOM 누락·미반입 상태 import 차단.
  R12는 §8.3 문언대로 `IMPORTED`에 POC Gate 최소집합(G15-1·G15-6) PASS를
  요구한다. **현재 상태에서 그린(R11)**, 게이트 테스트 50건으로 실효 증명.
- **엔진**(TypeScript, ADR-29 D3, **신규 런타임 의존 0건**): 자체 중앙
  디렉터리 ZIP 리더(로컬헤더 불신·zip-slip/bomb/중복·CRC32) + 자체 pull XML
  파서(DOCTYPE를 선행 바이트 스캔으로 거부 — XXE를 "끄는" 게 아니라
  표현 불가능하게), OPC 교차검증 + SourcePreservationMap + unmanifestedParts.
- **Document IR**: 결정적 안정 ID(ULID 아님 — I1/I7 성립 불가), `partPath#el[n]`
  앵커, 불변식 I1~I7. **타입 정본은 `@une/domain`**(ADR-29 D4), 엔진은 소비만.
- **호환성 2층**: 객체 등급(§8.4) → 문서 판정(§8.6 G15-1) 롤업. 계약 스키마
  2종 + 도메인 유니온 드리프트 가드.
- **무손실 3중 증명**(D7): I4 커버리지 + I5 바이트 보존 + **무편집 재구성
  동치** → Package Writer(CC-160) 이전에 RT-A 데이터 충분성 확보.
- **코퍼스**: `templete/`의 **실 HWPX 6종**(sha256으로 해석) + 합성 9종.
  실문서 발견 — `content.hpf` 매니페스트가 BinData/Scripts/Preview/META-INF를
  적지 않아 **비매니페스트 Part가 무손실의 핵심**.
- **실측으로 잡은 결함 2건**: ① AUTO 판정이 구조적으로 도달 불가(모든 HWPX가
  갖는 포장 Part가 상한 유발 + `hp:colPr`/`fwSpace`/`lineBreak`를 미지원
  객체로 분류) → 롤업 규칙 3을 ELEMENT 층에 한정 + 양성 구성요소를 명시 규칙화,
  catch-all 적중 0건·**상한 "사유"를 값으로** 고정, 합성 A/B 쌍으로 AUTO 도달
  증명. ② 개요 계층 뒤집힘(`hc:intent`가 음수 hanging indent — 앞 공백이 실제
  층 신호, §1.6-3).
- **이중 리뷰 전건 반영**(아키텍처 BLOCKER 1/MAJOR 8/MINOR 9, QA FAIL→F-1~F-5).
  BLOCKER는 이 항목이 막으려던 종류의 결함이었다 — CORPUS.yaml에 실측값을
  채우며 로더가 거부하는 키를 넣어 **코퍼스 회귀 94건이 실행되지 않는 상태**로
  완료 선언했다. 로더 수정 + 매니페스트↔골든 교차 고정으로 차단.
  그 외: 등급/상한 축 분리(`capsVerdict`), 미분류 요소 실어보내기,
  §1.6-3 공백 실측, 반입 게이트 양방향화 + R12(POC Gate), template-profile
  스키마를 실 산출물 기준으로 재작성 + 6종 실검증 계약 테스트.
- 게이트(**단일 `pnpm test`로 재현**): domain 62, hwpx-engine 238,
  contract-tests 152, db-integration 68, provider-adapters 108, api 193,
  worker 33, validate:intake(R1~R12)/contracts/handoff PASS, baseline 10.
  **마이그레이션 0건.**

## Exact next actions

1. **사용자**: PR 생성·머지(gh CLI 사용 가능).
2. 다음 항목 **CC-150**(Revision/ChangeSet/autosave/diff/conflict):
   - **차단성 선행조건**: `0018_document_child_table_rls.sql` — 문서 하위
     테이블(document_revision/document_block/change_set/change_operation/
     template_profile/style_prototype/export_job/validation_report)에 RLS가
     **한 번도 켜진 적이 없고** une_app은 ALL TABLES DML을 갖는다. CC-150이
     첫 쓰기 경로를 여는 순간 테넌트 격리 구멍이 된다(ADR-29 D9, 0016 패턴 적용).
   - **rhwp 적합성 확인 권고**: CC-140의 앵커 모델(`partPath#el[n]`) 위에
     SelectionResolver가 rhwp 편집기 selection을 얹어야 한다. 착수 시점에
     `@rhwp/core`/`@rhwp/editor` **정확 버전 고정**으로 적합성부터 확인하면
     CC-150을 다 짜고 나서 어긋나는 것을 막을 수 있다(아래 보류 항목 1).
   - 이름 드리프트 종결: 설계 `doc_prototype_registry` ↔ 구현 `style_prototype`
     ↔ OpenAPI `x-db-tables: prototype_registry`.
   - 빈 표 셀 문서가 등장하면 I6와 스키마 `minItems: 1`이 충돌(실 코퍼스엔 없음).

## 보류 항목 — 막히면 여기서 답을 찾고 먼저 의견을 낼 것

2026-08-02 사용자 결정: **설계 원안대로 개발하는 데 혼선이 생길 수 있으니
아래 3건은 그 다음으로 미룬다**(작업항목 34개 원안 유지, 신설 없음).
다만 구현이 막히면 여기에 답이 있는지 검토해 **의견을 제시**한다.

1. **rhwp 결선** — `@rhwp/core`/`@rhwp/editor` 정확 버전 고정(2026-08-02
   실측: npm 0.8.2 = git 태그 v0.8.2, MIT, **빌드된 WASM이라 Rust 툴체인
   불필요**). 소스 벤더링은 패치가 실제로 필요하거나 납품 SBOM 생성 시에만 —
   CC-140의 `validate:intake` 게이트가 그때 작동한다. **3건 중 유일하게 실질적
   가치가 있으며 적기는 CC-150 착수 시점.**
2. **ProcessGPT 패턴 평가** — Workflow/HITL/보상/감사. 단, 우리 SOP·Outbox·
   Execution Log는 설계에 이미 상세 규정돼 있어 별도 항목으로서의 값어치는
   낮다. **특정 문제(보상 의미론, HITL 재배정 엣지케이스)에 막혔을 때의 참조
   카드**로 두는 것이 맞다. 데이터모델 대체는 금지(설계 D-05, 12 §4).
3. **외부 소스 분석 규약** — 포크 금지·임시 다운로드·원본 삭제. 대부분
   CLAUDE.md/hwpx.md와 중복이고 강제는 `validate:intake`가 이미 한다.

**라이선스 실측(2026-08-02, 저장소 직접 확인 — 설계 문구보다 우선):**
rhwp = **MIT**, process-gpt = **MIT**(설계 논의의 "라이선스 없음"과 다름),
process-gpt-office-mcp = **없음 → 코드 복사 불가**(참고·재구현만).
office-mcp는 HWPX→HTML 왕복 편집 모델이라 **보존형 요구와 양립하지 않는다** —
쓸 수 있는 건 MCP 도구 계약의 형태뿐.

## Risks/blockers

- **rhwp 미반입 상태에서 편집 표면이 없다.** 설계 07 §1.2/§6.4가 rhwp Editor를
  편집 Surface로 배정했으므로, 프런트 편집 UI는 rhwp 없이는 진행 불가.
  CC-150의 백엔드(Revision/ChangeSet)는 진행 가능.
- 실문서 코퍼스 6종(<10종) — G15-1 부분 충족, 확대는 OB-07.
- `FLATTEN_EXPORT_ONLY`는 실 코퍼스에 인스턴스가 없어 합성 전용 검증.
- 성능 임계 게이트 미도입(G15-5는 CC-160), 한컴 Track B(OB-08/CC-420) 범위 밖.
- 기존 이월분(OB-01/10/11 OPEN) 유지.

## Notes

- 이 PC DATABASE_URL: superuser une @ localhost:**15432**
  (infrastructure/.env 조합; WSL vmIdleTimeout으로 컨테이너가 내려갈 수 있음 —
  `wsl -d Ubuntu` 깨우고 `docker start une-postgres`).
- prettier를 docs/·contracts/에 실행하지 말 것(사고 2회) — 커밋 전
  `git status -- docs/design-markdown` 무변경 확인.
- **설계 원문(docs/design-markdown)은 수정 금지.** 보완이 필요하면 ADR +
  work-items로만 한다.
- 골든 스냅샷·증거 문서에 본문 텍스트·Preview/PrvText·BinData를 넣지 말 것
  (`templete/` 6종은 실제 업무 양식 — security.md 개인정보 최소화).
- gh CLI 2.97 설치·인증됨(PR 생성/CI 확인).
