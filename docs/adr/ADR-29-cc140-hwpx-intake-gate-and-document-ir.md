# ADR-29: CC-140 HWPX 반입 게이트·Document IR·호환성 2층 어휘

- 상태: ACCEPTED (2026-08-02, CC-140)
- 관련: 설계 03 ADR v1.1 §8(ADR-15 §8.3~8.8)·§9(ADR-16), 설계 07 HWPX Engine
  Spec §1.3~§1.7/§1.12/§1.14, 설계 05 US-PLAN-025, 설계 09 REG-04,
  `.claude/rules/hwpx.md`, OB-07/OB-08/OB-12,
  `docs/external-dependencies/RHWP_SOURCE_INTAKE.md`
- 대전제: **rhwp 소스는 아직 반입되지 않았다.** 이 항목은 반입을 실행하지
  않고 반입을 강제·검증하는 게이트를 만든다(D1).

## D1. 반입 게이트와 실반입의 분리

CC-140은 `third_party/rhwp/`의 provenance 스키마·절차·**CI 강제 규칙
R1~R12**만 만든다. 실제 아카이브 다운로드·SHA-256 검증·반입은 하지 않는다.

지금 반입하지 않는 근거는 두 가지다:

1. **사용자 명시 승인 부재** — 외부 아카이브 반입은 CLAUDE.md Safety가
   승인을 요구하는 행위다.
2. **OB-12** 현재 폴백이 "rhwp not imported until provenance gate"이며,
   그 게이트가 곧 이 항목의 산출물이다.

게이트는 **오늘 상태(NOT_IMPORTED + 빈 upstream/)에서 통과**하고(R11),
누가 언제 반입하든 R1~R10·R12가 자동으로 물린다. 반입 실행은 후속 항목으로
분리한다.

### D1 정정 — §8.3의 "POC Gate 통과 후 반입"을 R12로 집행한다

초안은 §8.3의 *"**POC Gate를 통과한** 특정 Tag/Commit의 소스 아카이브를 …
반입한다"* 를 "운영 빌드 승격 조건"으로 재해석하고 그 근거를 WBS(CORE-01~12)
순서에서 가져왔다. **이 재해석을 철회한다** — WBS는 SOURCE_OF_TRUTH 우선순위상
ADR v1.1보다 하위 문서이고, 상위 정본의 명시 문장을 하위 문서 순서로 뒤집는
것은 규칙 위반이다(리뷰 M-6).

대신 **R12**로 문언을 집행한다: `status: IMPORTED`이면 `poc_gate`의 최소
집합 **G15-1(분석) + G15-6(라이선스·SBOM)** 이 `PASS`여야 하고, 나머지
G15-2~G15-5는 `PENDING` 허용·`FAIL` 불가.

최소 집합을 둘로 한정한 근거:
- **G15-6**은 반입 행위 자체가 유발하는 **재배포** 검사다(고지·금지 폰트·
  SBOM). 금지 폰트가 섞인 반입은 이후 어떤 빌드 단계도 되돌리지 못한다.
- **G15-1**은 §8.3이 특정 ref를 고정하라는 이유 그 자체이며, **UNE 계층
  없이 아카이브만으로 수행 가능한 유일한 게이트**라 반입 시점 요구 비용이 0이다.
- G15-2~G15-5(양식상속·편집·저장·성능)는 전부 UNE 소유 계층(Prototype
  Registry·ChangeSetExecutor·보존형 Serializer)이 있어야 수행된다. 6개를
  모두 요구하면 `IMPORTED`가 구조적으로 도달 불가능해지고, 결국 소스는 트리에
  둔 채 status만 낮춰 두는 상태로 밀려난다 — R2가 방금 막은 그 구멍이다.
- 게이트를 아직 돌리지 못한 중간 상태는 **`PROVENANCE_RECORDED`**(기록 먼저,
  `upstream/`은 비어 있음)로 표현한다. 그래서 §8.3 문언과 "먼저 받아서
  시험한다"는 실무가 둘 다 성립한다.

### D1 보강 — 게이트의 비대칭 제거(R2 양방향)

초안 R2는 "기록이 IMPORTED인데 소스가 없으면" 한 방향만 봤다. 그 결과
**소스가 실제로 트리에 있는데 status가 `NOT_IMPORTED`인 조합이 통과**했고,
R8은 고지가 기록과 "일치"하기만 하면 되므로 **배포물에 들어가는 소스가 고지에는
"미반입"으로 적힌 상태가 그린**이었다(리뷰 M-5, §8.3 배포물 고지 위반 경로).
R2를 양방향으로 만들어 `upstream/`이 비어 있지 않으면 `IMPORTED` 또는
`SUPERSEDED`를 강제한다.

## D2. 호환성 어휘 2층 확정 — 구버전 관계가 아니라 롤업 관계

설계 정본에 두 어휘가 공존한다. 조사 결과 **층이 다르다**:

| 층 | 어휘 | 정본 | 의미 |
|---|---|---|---|
| 객체 | `NATIVE_EDIT`/`PRESERVE_ONLY`/`FLATTEN_EXPORT_ONLY`/`REJECT` | ADR v1.1 §8.4(등급·편집 허용·저장 정책·사용자 표시) | 객체 하나의 취급 등급 |
| 문서 | `AUTO`/`CONFIRM`/`LIMITED`/`REJECT` | ADR v1.1 §8.6 G15-1 + Spec §1.5 결론부 | 문서(양식) 단위 분석 판정 |

두 층의 연결고리도 정본에 있다 — Spec §1.4 `HWPX-1004 미지원 객체 존재 →
LIMITED + 원문 보존`. 따라서 **롤업 규칙을 코드로 명시**한다:

1. 객체 중 하나라도 `REJECT` → 문서 `REJECT`(§8.4 "열기/편집 거부").
2. 필수 Part 누락·치명적 dangling 참조 → 문서 `REJECT`(HWPX-1003/1005).
3. `FLATTEN_EXPORT_ONLY` 또는 `PRESERVE_ONLY` **ELEMENT 객체** 존재 → 문서
   판정 **상한 `LIMITED`**(HWPX-1004, Spec §1.5-5). **PART 층은 상한을
   유발하지 않는다** — 아래 실측 근거 참조.
4. 그 외 → confidence 가중합(0.30 style / 0.20 prefix / 0.15 indent /
   0.15 repetition / 0.10 position / 0.10 semantic)으로
   `AUTO`(≥0.85) / `CONFIRM`(0.60~0.84) / `LIMITED`(<0.60).

### D2 보정 — 상한은 ELEMENT 층에만 적용한다 (실측으로 확정)

최초 구현은 규칙 3을 층 구분 없이 적용했고, 실 코퍼스 6종이 **전부 LIMITED**로
나왔다. 원인을 전수 집계해 두 겹의 과분류를 확인했다:

1. **포장 Part가 상한을 유발했다.** `Preview/*`,
   `META-INF/container.rdf`, `META-INF/manifest.xml`, `Scripts/*`는
   **모든 HWPX가 갖는** 부속 Part다. 이것이 상한을 유발하면 `AUTO`는
   **100% 입력에서 도달 불가능**해지고, §8.6 G15-1이 요구하는 "AUTO 판정
   재현"이 구조적으로 불가능해진다. 포장 Part의 손실 위험은 등급이 아니라
   **I4(커버리지)+I5(바이트 보존)**가 담보하므로, 상한 판정에서 제외한다.
   → 도메인에 `ClassificationScope('PART'|'ELEMENT')`를 도입하고 규칙 3을
   ELEMENT 층에 한정.
2. **본문 층에서도 레이아웃·공백이 "미지원 객체"로 잡혔다.** 실측 결과
   `hp:colPr`(단 속성) 7건, `hp:fwSpace`(고정폭 빈칸) 4건,
   `hp:lineBreak` 1건, `hp:pageHiding` 2건이 catch-all에 걸려 판정을
   지배했다. §8.4 PRESERVE_ONLY의 사용자 표시 컬럼은 "제한 아이콘·설명"인데
   단 속성이나 **공백**에 제한 아이콘을 띄울 대상은 없다. §1.6-3은 오히려
   공백을 계층 신호로 **따로 저장**하라고 요구한다.
   → 레이아웃 속성(`colPr`/`pageHiding`/`pageBorderFill`/`masterPage`/
   `pagePr`)과 공백 구성요소(`fwSpace`/`nbSpace`/`lineBreak`/`hypen`)를
   명시 규칙으로 올려 `NATIVE_EDIT`로 등급하고, catch-all은 진짜 미지의
   것만 남긴다(실 코퍼스 catch-all 적중 **0건**을 테스트로 고정).
   부수 시정: NATIVE_EDIT 등급 컨트롤은 `PRESERVED` 블록으로 승격하지 않고
   `RunIR.controls` 앵커로만 남긴다 — 블록으로 올리면 CC-150 편집기가 단
   속성 자리에 "보존 객체" 표시를 내게 된다.

**보정 후 실측**(6종): 여전히 전부 `LIMITED`이지만 사유가 전부 정당하다 —
머리말(`hp:header`), 자동 쪽번호(`hp:pageNum`/`newNum`), 누름틀 필드
(`hp:fieldBegin/End`), 삽입 이미지(`hp:pic`). 특히 **doc-template-02는 상한
객체가 0건**이라 롤업이 단락되지 않고 confidence 밴드로 판정된다(0.5252 <
0.60 → LIMITED) — 밴드가 죽어 있지 않다는 증거다. `AUTO` 도달 가능성은
합성 A/B 쌍으로 증명했다: 본문이 동일하고 `hp:pageNum` 유무만 다른 두
문서가 **같은 confidence(0.9063)** 에서 각각 `LIMITED` / `AUTO`로 갈린다.
실문서 `AUTO` 사례는 0건이며 실문서 확대는 OB-07 소관이다.

**하위 우선순위 문서의 변종 어휘는 폐기하고 사상표로만 남긴다**(설계 원문은
수정하지 않는다 — SOURCE_OF_TRUTH 우선순위상 ADR v1.1이 앞선다):

| 출처 | 변종 | 사상 |
|---|---|---|
| 05 PLAN_USER_SCENARIOS (FULL/CONFIRM/LIMITED/REJECT) | `FULL` | → `AUTO` |
| 05 PLAN_USER_SCENARIOS (FULL/LIMITED/REJECT) | `FULL` | → `AUTO` |
| 09 SCREEN REG-04 (SUPPORTED/PRESERVE_ONLY/LIMITED/REJECT) | `SUPPORTED` | → 객체층 `NATIVE_EDIT`(두 층을 한 패널에 섞은 표기) |

코드에는 두 유니온 타입만 존재하며 변종 문자열은 타입으로 표현 불가능하다.

## D3. 엔진 언어는 TypeScript (Python 불채택)

`TECHNOLOGY_PROFILE.md`가 CLAUDE.md보다 구체적이고 후행한다: "HWPX: pinned
rhwp Rust/WASM core consumed **through a UNE TypeScript adapter**; Python
tools **only behind explicit interfaces**". 추가 근거: `@une/hwpx-engine`이
이미 pnpm/CI에 배선됨, IR은 `document_revision.ir_json`으로 영속되고 API가
반환하므로 `packages/domain`의 `canonical-json`을 공유해야 함(정규화 2벌
방지), 편집 P95 300ms 목표에 프로세스 경계가 불리함.

Python이 유효한 잔여 영역은 Track B(한컴 Windows 자동화)와 시각 Diff이며
둘 다 CC-160/CC-420이다.

## D4. IR 정본 타입은 `@une/domain`, 구현은 `@une/hwpx-engine`

CC-135 선례(provider-proposal-drafts)를 따른다. CC-150의 API/워커가 IR을
다루면서 HWPX 엔진 전체를 의존하지 않게 하는 경계다. 엔진은 타입을 소비할
뿐 재정의하지 않는다.

## D5. IR/TemplateProfile JSON Schema는 `contracts/schemas/`에 편입

Spec §1.14 인수기준("Schema Bundle의 Document IR/Template/Prototype 예제가
CI에서 검증된다")을 `scripts/validate-contracts.mjs`의 기존
`contracts/schemas/*.json` Ajv 2020-12 검증 경로로 충족한다.
`une-platform-api-v1.yaml`은 **무변경** — UNE-DOC-003/004/005 응답 상세화는
CC-150 소유.

## D6. `rawXmlAnchor` = partPath + 요소경로 + 서수 (바이트 오프셋 불채택)

Spec 예시 `"Contents/section0.xml#p[17]"`를 그대로 채택한다. 바이트 오프셋은
UTF-8 바이트 / UTF-16 코드유닛 이중 인덱싱 문제를 만들고, CC-150
SelectionResolver가 쓰는 문자 offset과 층이 섞인다. 앵커는 **구조 위치**만
가리키고 문자 위치는 상위 층이 다룬다.

## D7. 무손실 증명 방식 — 커버리지·바이트·재구성 3중

Package Writer(CC-160)가 없는 상태에서 "미지원 객체 무손실"을 선증명한다:

- **I4 커버리지 불변식**: `알려진 Part ∪ UnknownPart == ZIP 엔트리 전체`
  (차집합 0). IR이 어떤 엔트리도 버리지 않음.
- **I5 바이트 보존**: SourcePreservationMap의 엔트리별 sha256이 원본과 일치.
- **무편집 재구성 동치**: preservationMap만으로 원본 엔트리 집합을 메모리
  상 재구성해 바이트·순서·압축방식이 원본과 같음을 단언(실제 ZIP 쓰기는
  하지 않음).

이 셋은 RT-A(무편집 저장 무손실)의 **데이터 충분성**을 CC-160 이전에
증명한다. "주변 편집 후 보존"(RT-F)의 실증은 CC-150+CC-160.

**증명 범위의 경계**(QA G-1): 위 셋이 증명하는 것은 **엔트리 내용 집합의
동치**이지 "아카이브 바이트 동일 재작성"이 아니다. `PreservedEntry`는
경로·순서·압축방식·CRC·크기·GP flags·external attributes를 담지만 ZIP
extra field 바이트·DOS mtime·versionMadeBy·엔트리 comment는 담지 않는다.
또한 preservationMap은 **인메모리**이며 `ir_json`에 실리지 않는다 — IR만으로는
unknownPart의 바이트를 복원할 수 없다(해시만 보유). 따라서 CC-160의 무손실
저장은 **원본 패키지 바이트를 `file_object`로 계속 보유하고 열 때마다
preservationMap을 재구축한다**는 전제 위에 선다. 이 전제를 CC-160의
선행조건으로 등재한다.

## D8. 코퍼스 = 실문서 6종 + 합성 ≥4종

`templete/`의 실 HWPX 6종이 git에 추적되고 있어 분석·IR·분류를 **합성이
아닌 실문서로** 검증한다. 실문서에서만 얻을 수 있었던 사실 하나를 기록해
둔다: `Contents/content.hpf`의 `opf:manifest`는 header/section0/settings
3개만 나열하고 **BinData·Scripts·Preview·META-INF는 매니페스트에 없다.**
즉 `ZIP 엔트리 ⊃ hpf 매니페스트`이며 **비매니페스트 Part 전량 보존이
무손실의 핵심**이다.

합성 픽스처는 음성·희소 케이스 전용(서명 불일치, zip bomb, path traversal,
DOCTYPE/XXE, 필수 Part 누락, dangling 참조, 중복 경로, FLATTEN 전용 객체,
다중 섹션). G15-1의 "임의 HWPX 10종 이상"은 **부분 충족**이며 실문서 확대는
OB-07(실증기관)/G4에서 종결한다.

코퍼스는 파일명이 아니라 **sha256으로 해석**한다(실 파일명이 한글이라
유니코드 정규화·인코딩 차이에 노출됨) — `CORPUS.yaml`이 ASCII alias id를
부여한다.

## D9. 마이그레이션 0건 — 그리고 문서 하위 테이블 RLS 갭 등재

CC-140은 어떤 테이블에도 쓰지 않으므로 마이그레이션이 없다(의존성도
CC-001뿐, CC-004/CC-100 아님).

다만 조사 중 **차단성 결함**을 발견해 기록한다: 0008/0011/0016 전수 확인
결과 RLS가 켜진 문서 계열 테이블은 `document`·`file_object` 둘뿐이고,
`document_revision`/`document_block`/`change_set`/`change_operation`/
`template_profile`/`style_prototype`/`export_job`/`validation_report`는
RLS가 **한 번도 켜진 적이 없다**. 반면 0011은 `une_app`에 ALL TABLES
DML을 일괄 부여한다. 지금은 쿼리 경로가 없어 잠복 상태지만 **CC-150이 첫
쓰기 경로를 여는 순간 테넌트 격리 구멍**이 된다(0016이 job_event·toc_*에
대해 닫은 것과 동일한 문제).

→ `0018_document_child_table_rls.sql`(0016의 부모 EXISTS 조인 패턴)을
**CC-150의 차단성 선행조건**으로 등재한다. CC-140에서 미리 만들지 않는 이유는
"마이그레이션은 그것을 쓰는 코드와 함께"라는 기존 관행이다.

부수 발견: 0015의 `ck_generation_job_type`은 `TOC/CONTENT/AI_EDIT/SOP`만
허용한다. 분석을 비동기 Job으로 만들면 `HWPX_ANALYZE` 추가 마이그레이션이
필요하다 — CC-140은 동기 라이브러리 호출만 하므로 해당 없음(CC-150/160 판단).

## D10. `packages/hwpx-adapter/` 신설은 CC-145로 연기

`RHWP_SOURCE_INTAKE.md`가 예고한 어댑터 패키지는 rhwp WASM 바인딩이 없는
상태에서는 빈 껍데기다. 실반입과 함께 만든다.

## D11. FLATTEN_EXPORT_ONLY 저장 차단은 판정만, 집행은 CC-160

§8.4의 "원본 HWPX 저장 금지"와 §8.7의 "등급에 따라 저장을 차단"은 저장
경로가 존재해야 집행 가능하다. CC-140은 등급과 근거(evidence)를 산출하고,
차단 집행은 Serializer/Export와 함께 CC-160이 소유한다.

## 수용 한계

- 실문서 6종(<10종) — G15-1 부분 충족, 나머지는 합성.
- `FLATTEN_EXPORT_ONLY`는 실 코퍼스에 인스턴스가 없어 **합성 전용**으로만
  검증된다(수식/OLE/차트 미포함 코퍼스).
- 성능은 실측 기록만 하고 회귀 임계 게이트를 도입하지 않는다(G15-5는 CC-160).
- rhwp 렌더/편집 검증은 전무하다 — Core가 반입되지 않았다.
- 한컴 Track B(OB-08)는 범위 밖이며 런타임 경로가 아님을 재확인만 한다.
- 이름 드리프트 발견: 설계 `doc_prototype_registry` ↔ 구현 `style_prototype`
  ↔ OpenAPI `x-db-tables: prototype_registry`. CC-150에서 종결.

## 재검토 Trigger

rhwp 실반입(CC-145), 실문서 코퍼스 10종 이상 확보(OB-07), 한컴 Track B
환경 확정(OB-08), 다중 섹션·수식·OLE 실문서 등장, rhwp 라이선스 변경.
