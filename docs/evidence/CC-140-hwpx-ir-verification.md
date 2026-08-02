# CC-140 검증 증거 — HWPX 반입 게이트·패키지 분석·Document IR·호환성 분류

- 일자: 2026-08-02 (집 PC)
- 브랜치: feature/CC-140 (base: main 0c5e198 = PR #10 머지)
- 결정 기록: ADR-29 (D1~D11 + D2 보정 + 수용 한계)
- 대전제: **rhwp 소스는 반입되지 않았다.** 이 항목은 반입을 실행하지 않고
  반입을 강제·검증하는 게이트를 만든다(ADR-29 D1, OB-12).

## 수용기준 대응

| AC | 구현 | 증거 |
|---|---|---|
| source archive provenance template | `PROVENANCE.schema.json`(20필드 + poc_gate 6) + 확장 템플릿 + `INTAKE_PROCEDURE.md`(명령 단위 절차·롤백) + **`validate-source-intake.mjs` R1~R11**를 CI verify에 배선 | 게이트 테스트 총 40건 = **음성(exit≠0) 33 + 양성 대조 7**, 현재 저장소 PASS(R11) |
| package analysis | ZIP 중앙디렉터리 파서(로컬헤더 불신, zip-slip/bomb/중복 차단, CRC32) + OPC 교차검증(mimetype/version/container/hpf) + **SourcePreservationMap** + `unmanifestedParts` | 실 6종 골든 회귀, 합성 9종 음성(HWPX-1001~1005) |
| Document IR | 도메인 정본 타입(`@une/domain`) + 엔진 빌더, 결정적 안정 ID, `partPath#요소[n]` 앵커, **불변식 I1~I7** | I1~I7 전수 테스트 + 무편집 재구성 동치 |
| compatibility classification | 데이터 주도 규칙표(2층: PART/ELEMENT) + `rollUpVerdict`(도메인) + evidence 동반 | 실 6종 판정·근거 고정, catch-all 적중 0건 단언 |

## 게이트 실행 결과 (이중 리뷰 반영 후 최종)

**전부 `pnpm test` 단일 명령으로 재현**(QA F-1: 앞선 보고는 깨진 상태의
수치였다 — 아래는 리뷰 반영 후 재실행 결과다).

| 게이트 | 결과 |
|---|---|
| `@une/domain` | **62** / 10 files |
| `@une/hwpx-engine` | **238** / 13 files (코퍼스 회귀가 실제로 실행됨 — 이전 196은 미실행 상태였다) |
| `@une/contract-tests` | **152** / 9 files (기존 60 + 반입 게이트 50 + IR 계약 11 + **실 엔진 산출물 검증 31**) |
| `@une/db-integration` | 68 / 7 files (skip 0 — DATABASE_URL 설정 후) |
| `@une/provider-adapters` / `@une/api` / `@une/worker` | 108 / 193 / 33 (회귀, 변경 없음) |
| `pnpm validate:intake` | **PASS**(신규 게이트 R1~R12, 반입 전 상태 그린) |
| `pnpm validate:contracts` | PASS (스키마 2종 신규 컴파일) |
| `pnpm validate:handoff` / `pytest tests/baseline` | PASS(503 files) / 10 passed |
| build/typecheck/lint/format | 전부 PASS |
| 마이그레이션 | **0건**(ADR-29 D9) |
| 위생 | `docs/design-markdown`·`contracts/openapi`·`database/migrations` 무변경, `third_party/rhwp/upstream/`은 **`.gitkeep` 하나뿐**(rhwp 미반입) |

## 핵심 검증 포인트

1. **무손실 3중 증명**(ADR-29 D7): I4 커버리지(알려진 Part ∪ unknownParts ==
   ZIP 엔트리 전체) + I5 바이트 보존(엔트리별 sha256 일치) + **무편집 재구성
   동치**(preservationMap만으로 원본 엔트리 집합을 메모리 재구성 → 바이트·
   순서·압축방식 동일). Package Writer(CC-160) 이전에 RT-A의 데이터 충분성을
   선증명한다.
2. **실문서에서만 얻은 사실**: `Contents/content.hpf`의 `opf:manifest`는
   header/section0/settings만 나열하고 **BinData·Scripts·Preview·META-INF는
   매니페스트에 없다**(6종 전부 unmanifested 8개). 즉 `ZIP 엔트리 ⊃ hpf
   매니페스트`이며 비매니페스트 Part 전량 보존이 무손실의 핵심이다. 합성
   픽스처로는 얻을 수 없었던 발견.
3. **반입 게이트가 오늘 vacuous가 아니다**: R8(notices 드리프트)이 반입 전
   상태에도 적용되고, 레이아웃 anti-vacuity 검사가 게이트 구성요소 부재를
   실패로 잡는다. R11로 현재 상태는 그린이며, 누가 반입하든 R1~R10이 자동으로
   물린다(음성 40케이스 + 양성 대조군 2건).
4. **floating 추적 차단이 기제화**: `tag/commit`이 `main`/`master`/`HEAD`/
   `latest`면 실패(R4), 반입 후 `upstream/` 직접 수정은 `tree_digest` 대조로
   차단(R5) — 패치는 `patches/PATCHES.yaml`로만.
5. **개요 계층 신호 실측 교정**: 실 코퍼스에서 `hc:intent`는 음수 hanging
   indent이고 좌여백이 전부 0이라 합으로 정렬하면 계층이 뒤집힌다.
   `(marginLeft, leadingWhitespace 길이)`로 교정하니 §1.6 샘플 기준
   (□→ㅇ→-→*)이 그대로 재현된다 — §1.6-3이 "앞 공백을 따로 저장"하라고 한
   이유가 실제 층 신호였음이 데이터로 확인됐다.
6. **개인정보 최소화**(security.md): 골든 스냅샷·증거에 본문 텍스트,
   `Preview/PrvText`, `BinData`를 기록하지 않는다. 구조·카운트·해시만 남긴다.

## 실 코퍼스 실측 (6종, `templete/`)

| alias | 엔트리 | unmanifested | 판정 | confidence | 상한 유발 객체 | catch-all |
|---|---|---|---|---|---|---|
| report-form | 11 | 8 | LIMITED | 0.8543 | `hp:header`, `hp:newNum`, `hp:pageNum` | 0 |
| work-report-form | 11 | 8 | LIMITED | 0.5574 | `hp:pageNum` | 0 |
| brief-report-form | 13 | 8 | LIMITED | 0.4625 | `hp:header` | 0 |
| doc-template-01 | 13 | 8 | LIMITED | 0.5448 | `hp:fieldBegin/End` | 0 |
| **doc-template-02** | 13 | 8 | LIMITED | 0.5252 | **없음** — confidence 밴드로 판정 | 0 |
| situation-report-template | 14 | 8 | LIMITED | 0.8246 | `hp:pic` | 0 |

분석 소요 7~28ms(§1.12 목표 50쪽 P95 5초 대비 자릿수 여유). G15-5 임계 게이트는
미도입(CC-160).

## 구현 중 발견·시정한 결함

1. **AUTO 판정이 구조적으로 도달 불가능했다** (ADR-29 D2 보정, 2단계 시정).
   - 1차: 포장 Part(`Preview/*`, `META-INF/container.rdf`, `Scripts/*`)가
     상한을 유발 → **모든 HWPX가 갖는 Part**이므로 AUTO가 100% 입력에서
     불가능해지고 G15-1의 "AUTO 판정 재현"이 구조적으로 불성립.
     → `ClassificationScope(PART|ELEMENT)` 도입, 규칙 3을 ELEMENT에 한정.
   - 2차: 본문 층에서도 `hp:colPr`(단 속성) 7건, `hp:fwSpace`(**고정폭 공백**)
     4건, `hp:lineBreak`, `hp:pageHiding`가 catch-all에 걸려 판정을 지배.
     §8.4 PRESERVE_ONLY의 사용자 표시는 "제한 아이콘"인데 공백·레이아웃
     속성에 아이콘을 띄울 대상이 없다. → 명시 규칙으로 승격(NATIVE_EDIT),
     catch-all은 진짜 미지의 것만 남김.
   - 부수: NATIVE_EDIT 컨트롤이 `PRESERVED` 블록으로 승격되어 블록 순서를
     차지하던 것을 `RunIR.controls` 앵커로만 남기도록 수정(CC-150 편집기가
     단 속성 자리에 "보존 객체" 표시를 내는 것을 방지).
   - **회귀 방지**: 골든표에 "라벨"이 아니라 **상한 유발 요소 목록**을
     값으로 고정하고, 레이아웃·공백류가 상한 사유에 나타나면 즉시 실패하는
     단언 추가. catch-all 적중 0건도 문서별로 고정.
2. **AUTO 도달 가능성 증명**: 합성 A/B 쌍(본문 동일, `hp:pageNum` 유무만
   차이)이 **같은 confidence 0.9063**에서 각각 LIMITED / **AUTO**로 갈린다.
   실문서 AUTO 사례는 0건 — G15-1은 합성으로만 충족(OB-07 실문서 확대 필요).
3. **개요 계층 뒤집힘**(위 §5) — 실 코퍼스 실측으로 발견·교정.
4. 안정 ID를 ULID(§1.3 예시)가 아닌 결정적 해시로 — ULID는 시각 기반이라
   I1(결정성)·I7(해시 안정성)과 양립 불가.
5. **ZIP64·data descriptor 명시 거부** — 부분 지원은 "읽는 도구마다 다른
   결과"를 만들어 재현성을 깬다.

## 이중 리뷰 (병렬, opus — 전건 당일 반영)

**architecture-guardian: BLOCKER 1 / MAJOR 8 / MINOR 9.**
- **B-1** CORPUS.yaml에 실측값을 채우면서 로더가 거부하는 키를 넣어 **코퍼스
  회귀 94건이 수집 단계에서 죽어 있었다**(그 상태로 "196 통과"를 기재했다).
  → 로더에 키 추가 + 매니페스트를 골든표와 **교차 고정**(판정·confidence·
  사유 대조)해 "둘 중 하나만 고쳐 통과시키는" 재발 경로까지 차단.
- **M-1/QA F-4** `template-profile.schema.json`이 엔진 산출 타입과 전면
  드리프트(staticRegion.kind 8종 중 5종 표현 불가 등). 드리프트 가드가 enum
  3종만 봐서 못 잡았다. → 도메인 `TemplateProfile` 타입 + `toTemplateProfile()`
  신설, 스키마 재작성, **실 코퍼스 6종의 실제 산출물을 Ajv 검증**하는 계약
  테스트 신설(31건). 이 테스트가 즉시 남은 결함을 잡아냈다 — 새 스키마를
  `allOf`+`additionalProperties:false`로 짜서 **ADR-24 D4가 기록한 JSON Schema
  2020-12 함정을 그대로 반복**했고, 인라인으로 정정했다.
- **M-2** 규칙 미매칭 요소가 `continue`로 버려져 분류·카운트·상한 어디에도
  잡히지 않았고, "catch-all 적중 0건" 가드는 이 구멍의 증상과 정상을 구별할
  수 없었다. → `unclassifiedElements`로 실어 보내고 문서별 **정확 개수**와
  부모 allowlist를 고정. 부수로 네임스페이스 미선언 요소가 미지 가드를
  우회하던 구멍도 차단.
- **M-3** AUTO 도달 불가를 고치며 레이아웃·공백을 `NATIVE_EDIT`로 승격한 것이
  §8.4 등급 정의(편집·재저장 검증 완료)와 어긋났다 — CC-160이 등급으로 저장
  정책을 분기하면 파싱한 적 없는 XML에 "최소저장"이 적용된다. → 등급은
  `PRESERVE_ONLY`로 되돌리고 **`capsVerdict` 축을 분리**. 재실측 결과
  판정·confidence·상한 사유가 **하나도 바뀌지 않은 것**이 "등급만 정직해지고
  상한은 그대로"라는 증거다.
- **M-4** `hp:fwSpace`/`hp:tab`/`hp:nbSpace`가 텍스트에서 사라져 §1.6-3이
  요구한 세 공백 중 일반 space만 실측되고 있었다(그런데 그 길이가 계층 정렬
  키였다). → 공백 문자로 정규화(`lineBreak`/`hypen`은 공백이 아니라 제외).
- **M-5** 소스가 트리에 실재해도 `status: NOT_IMPORTED`면 통과 → **배포물에
  포함되는 소스가 고지에는 "미반입"으로 적힌 상태**가 그린이었다. R2 양방향화.
- **M-6** POC Gate 미강제 + **ADR-29 D1이 상위 정본(§8.3)을 하위 문서(WBS)
  순서로 뒤집은 것**. → 재해석 철회, **R12**로 문언 집행(IMPORTED이면 G15-1 +
  G15-6 PASS 필수, 중간 상태는 `PROVENANCE_RECORDED`).
- **M-7/M-8** 상태표·ADR 등록부 미갱신 → 갱신 완료.
- MINOR 9건 반영: HWPX-1005 심각도 분리(m-1), XML 깊이·요소 수 한도(m-2),
  ordinal 주석 정정(m-4), binData·bullet 참조 검사 I3 편입(m-5), 시스템 기본
  프로토타입 앵커 센티널(m-6), ZIP64/data descriptor/암호화/심링크 음성
  픽스처(m-9). m-3(테스트 코드 공개 표면 분리)은 `exports` 도입 비용 대비
  현재 소비자가 테스트뿐이라 **CC-150으로 이월**(근거 기록).

**qa-gate-reviewer: FAIL → 필수 시정 F-1~F-5 전부 반영.**
- 주장 수치를 전부 독립 재현했고 **F-1에서 실패를 확정**했다: 타임스탬프
  대조로 "CORPUS.yaml을 깨뜨린 뒤 25분 후 DONE 전환, 그 사이 게이트 미실행"을
  지적. `pnpm test`가 첫 실패에서 중단되므로 루트 명령 한 번으로는 api/worker/
  contract-tests가 아예 실행되지 않는 상태였다.
- **F-2**(회귀가 무거운 스위트에서만 드러난 구조) — `corpus.test.ts`가 실제
  CORPUS.yaml을 한 번도 읽지 않았다. → 실물 매니페스트 로딩 단위 테스트 추가
  (8ms). **F-3** 완료 선언 철회 후 재검증 수치로 재기재(본 문서). **F-4**는
  M-1과 동일. **F-5** 보안 경계 분기 음성 픽스처 추가.
- 권고 반영: G-1(무손실 증명 범위 명시 + `PreservedEntry`에 extra field·
  mtime·comment 추가), G-2(빈 표 셀 픽스처), G-3(=m-2), G-4(스위트 가드).
  **수용**: G-5(무DB skip은 CI가 커버), G-7(`templete/` 실 양식의 저장소 보관
  가부는 데이터 소유자 확인 사항).
- QA가 독립 확인한 것: 코퍼스 6종 실측치 전부 일치, 무손실 증명이 **표본이
  아니라 전수**, **개인정보 유입 없음**(골든은 카운트·해시만, 스냅샷 파일
  자체가 없음), rhwp 미반입.

## 알려진 한계 (ADR-29 수용 한계)

실문서 6종(<10종, G15-1 부분 충족); `FLATTEN_EXPORT_ONLY`는 실 코퍼스에
인스턴스가 없어 **합성 전용** 검증; 성능 임계 게이트 미도입; **rhwp Core
미반입으로 렌더/편집 검증 전무**; 한컴 Track B(OB-08) 범위 밖; 빈 표 셀
문서가 등장하면 I6와 스키마 `minItems: 1`이 충돌(실 코퍼스에는 없음,
CC-150 판단); 이름 드리프트 `doc_prototype_registry`↔`style_prototype`↔
`prototype_registry`(CC-150 종결).
