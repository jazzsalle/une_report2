# ADR-31: CC-160 HWPX 보존 Export·Track A 검증·오브젝트 저장소

- 상태: ACCEPTED (2026-08-03, CC-160)
- 관련: 설계 07 §1.10(Serializer/저장 모드)·§1.11(Round-trip 검증)·§1.14(인수기준),
  설계 10 §3.4(UNE-DOC-012~014)·§6(export_job/validation_report/file_object),
  ADR-19(승인 프로필), **ADR-29(D4/D6/D7/D11)**, **ADR-30(D1/D3/수용한계)**,
  `.claude/rules/{backend,security,architecture,testing,hwpx,provider-adapters}.md`
- 범위: 보존 저장(되쓰기), Track A 자동 검증, 저장소 포트, Export API·워커.
  Track B(한컴)와 시각 비교는 밖 — 근거는 D12.

## D1. 범위 경계

| 대상 | 판정 | 근거 |
|---|---|---|
| Package Writer / XML Delta Writer | **포함** | AC1·AC3의 본체. ADR-29 D11이 `serialize()`를 CC-160 소유로 남겼다 |
| Track A 4계층 자동 검증 | **포함** | AC2·AC4. CLAUDE.md "Track A ... is required for every export" |
| 저장 차단 집행(REJECT/FLATTEN_EXPORT_ONLY) | **포함** | ADR-29 D11이 집행을 CC-160에 배정 |
| 오브젝트 저장소 포트 + 어댑터 | **포함** | 산출물을 둘 곳이 없으면 Export가 끝나지 않는다. ADR-30 D1이 CC-160에 배정 |
| Export API(UNE-DOC-012~014) + 워커 | **포함** | CC-170이 "로그인부터 HWPX 다운로드까지"를 요구한다 |
| import 원본 등록(`source_file_id`) | **포함** | D9 참조 — 이것이 없으면 보존 Export 자체가 성립하지 않는다 |
| 업로드 HTTP API(UNE-DOC-001~004) | **제외** | 파일 사전등록·업로드 완료·분석 요청은 별도 화면 흐름이다. 지금 필요한 것은 **바이트가 저장소에 있는 상태**이고 그것은 `DocumentImportService`가 만든다 |
| PDF/DOCX 변환 | **제외** | 변환기가 없다. 어휘에는 남기고 요청은 422로 거부한다(D5) |
| Track B(한컴 열기-저장-재열기) | **제외** | 릴리스 게이트이며 런타임 경로가 아니다(CLAUDE.md, OB-08) |
| VISUAL 계층(rhwp 렌더 비교) | **제외** | rhwp 미반입(OB-12) |

## D2. 되쓰기는 바이트 구간 교체로만 한다

**결정**: 파싱한 트리를 재직렬화하지 않는다. XML 파서에 원문 구간
(`sourceStart/sourceEnd/innerStart/innerEnd`)을 추가하고, 편집된 자리만
문자열 구간으로 갈아끼운다.

**근거**: 재직렬화는 주석·처리명령·속성 순서·공백·엔터티 표기를 전부 파서의
취향으로 바꾼다. 그 순간 §1.10-3("알 수 없는 요소·속성·Part는 원문 그대로")은
지킬 수 없는 약속이 된다. 구간 교체는 손대지 않은 문자를 **정의상** 보존한다.

**대가**: 구간 좌표계가 하나 늘었다(UTF-16 문자열 인덱스). 앵커가 바이트
오프셋을 거부한 이유(ADR-29 D6)와 같은 이유로 바이트가 아니라 파서의 좌표계를
그대로 노출한다. 되쓰기 직전에 "이 Part를 UTF-8로 왕복할 수 있는가"를 확인하고,
불가능하면 고치지 않고 거부한다(HWPX-1103).

## D3. 되쓰지 않은 엔트리는 재압축하지 않는다

**결정**: ZIP 재작성 시 교체되지 않은 엔트리는 원본 **저장 바이트**를 그대로
복사한다. CC-140이 `storedBytes`와 헤더 필드 원문을 보존해 둔 것이 이를 위한
것이었다(리뷰 G-1).

**근거**: 재압축은 zlib 버전·레벨에 따라 결과가 달라진다. 그러면 "우리가
건드리지 않은 부분은 원본과 같다"는 무손실 주장이 **도구 버전 문제**가 된다.
그래서 교체가 하나도 없으면 출력은 입력과 바이트 단위로 동일하다 — 그것이
AC1의 정의이며 실문서 6종에서 확인했다.

**부수**: 리더에 `diskNumberStart`와 `archiveComment`를 추가했다. 없으면
바이트 동일 재작성이 성립하지 않는다.

## D4. 되쓸 자리가 유일하지 않으면 거부한다

**결정**: run의 텍스트를 되쓰는 것은 "텍스트에 기여하는 요소가 정확히 하나의
`hp:t`이고 그 안에 요소가 없는" 경우로 제한한다. 탭·고정폭 빈칸·인라인 컨트롤이
섞이면 HWPX-1103으로 실패한다. `hp:linesegarray`·`hp:secPr`는 텍스트에 기여하지
않으므로 허용한다.

**근거**: 실문서에서 확인한 구조 — `doc-template-01`의 `p[2]`는
`[hp:t, hp:ctrl, hp:ctrl, hp:t]`다(누름틀 필드가 텍스트를 두 조각으로 가른다).
새 문장을 어느 조각에 넣을지 결정할 근거가 없다. 반씩 나눠 넣는 추측은 필드
값을 조용히 망가뜨리고, 잘못 쓴 HWPX는 그냥 열리기 때문에 사용자는 한참 뒤에
알게 된다. **거부는 이 경우 가장 안전한 동작이다.**

**수용 한계**: 텍스트가 바뀌면 `linesegarray`의 줄 좌표는 낡은 값이 된다.
우리는 배치를 계산하지 않는다(§1.1 비범위 — 렌더는 rhwp 몫). 지우는 선택지는
더 나쁘다: 원문에 있던 구조를 우리가 없앤 것이 되어 §1.10-3을 어긴다.

**새 문단**은 `anchorHint`가 지목한 이웃 문단의 **원문을 복제**하고 텍스트만
바꾼다(§1.7 Prototype Clone). 조립하지 않는 이유는 paraPrIDRef·styleIDRef·
charPrIDRef 등 해석하지 않는 속성을 우리가 만들어 내면 원본과 다른 서식이
되기 때문이다. ADR-30 D3이 `anchorHint`를 데이터로 남겨 둔 값이 여기서 쓰인다.

## D5. Track A 검사코드를 신설한다

**문제**: 설계에는 §1.4 **반입** 검사코드표(HWPX-1001~1005)만 있고 저장 검증
코드표가 없다. §1.11은 계층(Package/Reference/Semantic/Style/Visual/Hancom/Edit)과
합격 기준만 적는다.

**결정**: `RTA-<계층>-<번호>` 형식으로 16개를 정의하고 정본을
`packages/domain/src/document/export.ts`에 둔다(ADR-29 D4와 같은 이유 —
어휘가 엔진·API·워커·DB CHECK 네 곳에 흩어지면 서로 다른 값을 허용하게 된다).
저장 오류 코드도 반입 코드를 재사용하지 않고 1100번대를 연다: 같은 코드가
"업로드 거부"와 "저장 실패" 두 뜻을 가지면 감사 로그에서 어느 경로의 사고인지
구분할 수 없다.

**미실행 계층은 침묵하지 않는다**: VISUAL/HANCOM/EDIT은 사유와 함께 보고서에
남는다. "검사 안 함"과 "검사해서 통과"가 같은 모양이면 증거가 거짓말한다.
다만 미실행이 등급을 낮추지는 않는다 — 낮추면 모든 Track A 보고서가 영원히
LIMITED가 되어 등급이 정보를 잃는다.

## D6. 검증에 실패한 산출물은 돌려주지 않는다

**결정**: Track A가 FAIL이면 `preservationSave`가 HWPX-1105로 던지고 바이트를
반환하지 않는다. LIMITED(WARN만 있음)는 통과시키되 보고서에 남는다 — §1.11의
합격 기준은 '치명오류 0'이고 WARN은 치명이 아니다.

**근거**: 설계 §1.10-5의 순서는 "임시 생성 → 구조검증 → 원자적 rename"이다.
만들어 놓고 "실패했음" 표시만 붙이면 그 파일이 어딘가로 샐 수 있다. 검증 안 된
산출물이 존재할 수 있는 시간을 없앤다.

## D7. FLATTEN_EXPORT_ONLY는 EXPORT_COPY도 막는다

설계상 이 등급은 "평탄화 사본만 허용"이지만 **평탄화 변환기가 없다.** 변환 없이
EXPORT_COPY를 열면 평탄화되지 않은 원본 객체가 그대로 나가면서 §8.4 금지를
어기고, 이름만 사본인 산출물이 "평탄화됨"으로 오인된다. 변환기가 생기는 시점에
이 분기를 연다.

## D8. `serialize()` 서명을 바이트 입출력으로 바꾼다

CC-140이 남긴 서명은 `(documentId, outputPath) => Promise<void>`였다. 엔진이
문서 ID를 알면 DB를, 파일 경로를 알면 저장소를 알아야 한다. 둘 다 엔진 경계
밖이다(`architecture.md`). 엔진은 바이트를 받아 **검증된** 바이트를 돌려준다.

같은 이유로 `NotYetImplementedHwpxEngine`과 `SERIALIZE_NOT_IMPLEMENTED`를
제거했다 — 구현이 도착한 뒤에도 "아직 안 됨" 스텁이 남아 있으면 그것을 주입한
코드가 조용히 실패하는 경로가 생긴다.

## D9. import가 원본을 저장소에 등록한다

**결함**: `DocumentImportService`는 `sourceFileId`를 옵션으로만 받고 아무도
채우지 않았다. 결과적으로 모든 문서의 `document.source_file_id`가 NULL이었고,
**보존 Export가 성립할 수 없었다** — 되쓰기는 원본 패키지 위에서 하는 일이다.
API e2e가 전부 422로 떨어지면서 드러났다.

**결정**: import가 원본 바이트를 저장소에 올리고 `file_object`를 등록한다.
ADR-30 D1이 이 배선을 CC-160에 배정한 그 항목이다. 키는
`tenants/{tenantId}/sources/{sha256}.hwpx` — 해시가 파일명이므로 같은 파일을
다시 가져와도 같은 객체이고, `storage_key` 유니크 제약과 충돌하지 않도록
먼저 조회하고 없을 때만 넣는다.

## D10. 저장소는 SDK를 쓴다 (엔진의 무의존 원칙과 구분)

**결정**: `@aws-sdk/client-s3`를 `packages/provider-adapters`에 추가한다.

**근거**: 엔진의 "신규 런타임 의존성 0"(ADR-29 D3)은 HWPX 파싱·직렬화에
적용되는 원칙이다 — 그 영역은 우리가 형식을 완전히 통제하고, 외부 라이브러리가
조용히 바꾸는 동작이 무손실 주장을 무너뜨린다. 인증 프로토콜(SigV4)은 그
반대편이다: 손으로 구현하면 보안 결함이 우리 코드에 생긴다. ADR-19가 승인한
"S3 호환 포트" 프로필 안이므로 프로필 변경이 아니다.

포트는 `put/get/head/remove` 넷으로 좁혔다. presigned URL·멀티파트는 각각
결정이 필요한 주제이고(설계 §7502의 Presigned URL은 UNE-DOC-014가 바이너리
스트리밍으로 계약돼 있어 지금 경로가 아니다), 쓰지도 않을 표면을 열어 두면
어댑터마다 구현하지 않은 메서드가 생긴다.

오류는 NOT_FOUND / UNAVAILABLE / REJECTED로 가른다. 만료(410)와 장애(503)를
한 예외로 뭉치면 설정 오류가 "만료됨"으로 보고되어 아무도 원인을 찾지 못한다.

## D11. export_job이 tenant_id를 든다

**결함**: `generation_job`에는 `tenant_id`가 있고 `export_job`에는 없다.
두 테이블은 같은 유형의 비동기 Job이고 같은 워커 모델을 쓰는데 한쪽만 테넌트를
들고 있다. 워커의 디스패치 트랜잭션은 `app.tenant_id`가 없는 상태로 도는데
(0015 §7), 그 상태에서 `document`의 정책은 거짓이므로 0018의 EXISTS(document)
정책만으로는 행을 **볼 수도 없고** 어느 테넌트로 정산할지도 알 수 없다.

**결정**: 0020이 `tenant_id`를 신설하고 document에서 백필한다. 0015 §1이
`generation_job`에서, ADR-27 D2가 `generated_block`에서, 0019 §0이
`document_autosave`에서 해소한 것과 같은 유형의 기준선 결함이다. 정책은 직접
술어로 바꾸되 WITH CHECK에는 부모 존재 확인을 남긴다 — tenant_id만 보면
"우리 테넌트의 아무 값이나" 쓸 수 있어 0018이 막던 고아 쓰기가 다시 열린다.

## D12. 어휘 확정과 이연 종결

- **export_job.format**: HWPX/PDF/DOCX(설계 10 §6). OpenAPI enum에 있던 `JSON`은
  제거했다 — 정본 우선순위상 설계(3)가 OpenAPI(4)보다 앞선다. PDF/DOCX는 어휘에
  남기고 요청은 422로 거부한다(`IMPLEMENTED_EXPORT_FORMATS`). 어휘에서 지우면
  DB CHECK와 어긋나고, 구현했다고 광고하면 CLAUDE.md의 "mock을 실 지원으로
  보고하지 않는다"와 같은 종류의 거짓이 된다.
- **export_job.status**: QUEUED/RUNNING/COMPLETED/FAILED. 취소 경로는 두지
  않는다 — 계약에 취소 API가 없고, 도달할 수 없는 상태를 어휘에 넣으면 그것을
  처리하는 코드가 영원히 죽은 코드로 남는다.
- **validation_report.target_type**: DOCUMENT/EXPORT로 닫는다(0018이 CC-160으로
  미룬 항목). 어휘가 열려 있으면 "정책이 조용히 거짓이 되는 행"을 계속 만들 수
  있다. 방어는 약해진 것이 아니라 한 층 앞당겨졌다.
- **document_autosave.status × result_revision_id**: ACCEPTED만 결과 리비전을
  가진다(ADR-30 이연). 실제 쓰기 경로를 전수 확인해 확정했다 —
  `change-set.service.ts`에 `UPDATE document_autosave` 자체가 없고, SUPERSEDED는
  늦게 도착한 항목 **자신**이 INSERT되는 것이다.
- **template_profile.analysis_status**: **판정 축**으로 확정한다
  (AUTO/CONFIRM/LIMITED/REJECT). 정본이 갈렸던 이유는 두 개의 직교하는 축이 한
  컬럼 이름 아래 있었기 때문이다 — ADR v1.1 §8.6의 판정과 설계 09 §4의
  생명주기(DRAFT~DEPRECATED). LIMITED가 양쪽에 다 나오는 것이 그 신호다.
  컬럼 이름이 `analysis_status`이고, 유일한 쓰기 경로가 분류기 판정을 변환 없이
  넣으며, 생명주기를 움직이는 코드가 아직 없다. 화면(설계 09)이 구현되는 시점에
  `lifecycle_status`를 따로 세우는 것이, 없는 워크플로를 지금 추측해서 넣는
  것보다 정확하다.

## D13. minio-init 정책 부착 결함 (CC-002 회귀)

`infrastructure/minio-init.sh`의 가드가 `mc admin user info`의 **평문 출력**에서
`*une-app*`을 찾았는데, 액세스 키가 `une-app-<random>`으로 생성되므로 패턴이
키 이름에 걸려 **정책이 한 번도 부착되지 않았다.** 서비스 계정은 모든 요청이
403이었고, 저장소를 실제로 쓰는 첫 코드(CC-160)에서야 드러났다.

`--json` 출력의 `policyName`으로 매칭하고, 부착 후 검증 단계를 추가해 실패 시
스크립트가 중단되게 했다. CI db-verify에 MinIO를 띄우고 저장소 통합 테스트를
추가했다 — 그것이 없으면 통합 테스트가 조용히 skip되고 같은 유형이 다시
지나간다. `services:` 컨테이너를 쓰지 않은 이유는 GitHub이 이미지의 기본
명령을 실행하는데 MinIO는 `server /data`가 필요하기 때문이다.

## D14. 저장 모드 옵션은 계약에서 닫는다

`ExportRequest.options.saveMode`를 계약에 넣었다가 제거했다. 구현은 SAVE_AS
하나만 산출하는데 옵션을 열어 두면 클라이언트가 `SAVE_REVISION`을 보내고
**조용히 SAVE_AS로 처리**된다 — `export_job`에 모드를 담을 자리도 없어 사후
추적도 불가능하다(리뷰 M-5). 지금은 계약에서 닫고, 모드를 실제로 지원하는
시점에 `export_job.save_mode`와 함께 연다.

## D15. 실패한 Export도 같은 보고서로 말한다

`export_job`에는 `error_json`이 없다(0020 §6). 그러므로 저장 차단(HWPX-1104),
검증 실패(HWPX-1105), 되쓰기 불가(HWPX-1103), 저장소 오류의 사유가 남을 자리는
`validation_report.checks_json`뿐이다. 계약의 `checks[].code` 패턴을 RTA-* 외에
`HWPX-\d{4}`·`STORAGE-*`·`EXPORT-*`까지 넓히고, `layer`를 선택 항목으로 바꿨다 —
저장소 장애를 `PACKAGE`로 적으면 인프라 사고가 패키지 검증 실패로 감사에 남는다
(리뷰 M-4).

## D16. 리뷰에서 드러난 결함 (측정으로 발견)

이중 리뷰가 **구현이 깨져 있던 두 가지**를 드러냈고, 둘 다 고쳤다.

**(1) Track A가 문단 ID로 짝을 맞춰 삽입·삭제가 항상 실패했다.** 산출물의 IR은
새로 빌드되고 그 문단 ID는 앵커에서 유도되므로(`stableIdForAnchor`), 문단을
하나 넣거나 지우면 뒤쪽 문단의 서수가 밀려 ID가 전부 바뀐다. `RTA-STY-001`이
엉뚱한 문단끼리 비교해 실문서 6종 전부에서 FAIL이었다 — ADR-30 D2가 지적한
것과 **같은 결함이 검증기 쪽에서 재현된 것**이다. 비교 축을 문서 순서로
바꿨고, 문단 수가 이미 어긋난 경우는 비교를 건너뛴다(같은 원인으로 두 번
실패를 보고하면 진단이 흐려진다).

**(2) 워커 리스가 `created_at`(요청 시각)을 봤다.** 큐에 리스 시간보다 오래
머문 Job은 클레임 직후부터 stale 조건을 영구히 만족해, 워커가 둘 이상이면
진행 중인 Job을 매 틱마다 재클레임한다. 0021이 `started_at`/`attempt_no`를
신설하고 `generation_job`과 같은 모델로 맞췄다.

그 밖에 리뷰가 지적한 fail-open 세 지점도 닫았다: 호환성 판정이 없거나 어휘
밖이면 저장을 **중단**하고(기본값 LIMITED 제거), FLATTEN 판정은
`template_profile.unsupported_objects_json`(분류기의 권위 있는 출력)을 먼저
보며, 저장소에서 받은 원본 바이트가 `file_object.sha256`과 다르면 되쓰지 않는다.
러너에는 Job 단위 오류 격리를 넣었다 — 한 건의 예외가 배치 전체를 중단시키고
나머지를 RUNNING으로 남기던 경로였다.

## 수용 한계

- **VISUAL 계층 검증 전무** — rhwp 미반입(OB-12). 페이지 이동·글꼴 대체·표 폭
  변경 회귀는 지금 어떤 자동 검사도 잡지 못한다.
- **Track B 미실행** — 한컴 열기-저장-재열기는 릴리스 게이트이며 환경이
  확정되지 않았다(OB-08). 산출물이 한/글에서 열린다는 증거는 **없다.**
- **PDF/DOCX 미구현** — 어휘에만 있고 422로 거부한다.
- **FLATTEN_EXPORT_ONLY는 합성 검증만** — 실 코퍼스에 사례가 없다(ADR-29 한계
  승계).
- **되쓰기 범위**: 텍스트 교체·문단 삽입·문단 삭제. 표 구조 편집·SPLIT/MERGE의
  되쓰기는 열지 않았다 — 실행기(CC-150)가 만드는 IR 변화를 구간 교체로 옮기는
  규칙이 연산마다 다르고, 검증되지 않은 규칙을 넣는 것보다 거부가 낫다.
- **linesegarray 미갱신** — D4 참조.
- **`hasFlattenExportOnlyObject` 판정은 IR의 보존 블록 등급으로 한다.** 분류
  결과 전체를 다시 계산하지 않으므로, IR에 등급이 실리지 않은 경로가 생기면
  집행이 약해진다. IR 스키마가 등급을 요구하고 있어 지금은 성립한다.
- **AV 스캔 없음** — `file_object.scan_status`는 PENDING으로 남는다. 스캐너는
  OB 범위이며, 0020 §6이 상태 전이 트리거를 그 시점으로 미뤘다.
- **보존기간·TTL 없음** — UNE-DOC-014의 410은 저장소에서 객체가 사라진 경우를
  처리하지만, 사라지게 만드는 정책(retention_policy)은 아직 구현되지 않았다.
- **자기닫힘 `<hp:t/>`에 텍스트를 쓰면 태그 밖에 문자가 들어간다.** 파서가
  자기닫힘 요소에 `innerStart == innerEnd == sourceEnd`를 주기 때문이다. Track A가
  `RTA-SEM-002`로 잡아 산출물을 폐기하므로 손상은 나가지 않지만, 사용자는
  `HWPX-1103`(되쓸 수 없는 구조) 대신 `HWPX-1105`(검증 실패)를 받는다. 빈 문단에
  문장을 넣는 것은 흔한 동작이므로 실문서 픽스처와 함께 좁혀야 한다(리뷰 M-7).
- **XML 1.0 금지 제어문자를 거르지 않는다.** 편집 텍스트에 ` `~`` 등이
  섞이면 그대로 기록되고, 우리 리더가 관대해 Track A도 통과한다. Track B가
  미실행이므로 어떤 게이트도 잡지 못한다 — PASS 보고서를 단 산출물이 한/글에서
  열리지 않을 수 있는 유일한 알려진 경로다(리뷰 M-8).
- **정산 실패 시 저장소 객체가 고아로 남는다.** PUT 이후 정산 트랜잭션이 실패하면
  보상 삭제가 없다. 키가 내용 주소(sha256)라 재시도는 같은 키에 같은 바이트를
  덮어쓰므로 실질 피해는 저장 공간이며, 보존 정책이 구현되면 회수된다(리뷰 m-6).
- **엔진 공개 표면에 검증을 건너뛰는 진입점이 남아 있다** — `rewriteArchive`/
  `buildXmlDelta`를 직접 부르면 D6·D11을 우회한 바이트를 만들 수 있다. 현재
  호출자는 테스트뿐이다(리뷰 m-3).
- **`canTransitionExport`/`TERMINAL_EXPORT_STATUSES`는 아직 호출자가 없다.**
  상태 전이를 코드로 강제하는 지점은 DB CHECK(0020 §2)뿐이다.
- **CI가 잡지 못하는 것**: D13이 고친 정책 부착 결함 자체는 CI에서 재현되지
  않는다. CI는 MinIO를 root 자격증명으로 띄우고 `mc mb`만 하며 `minio-init.sh`를
  실행하지 않는다. 스크립트의 검증 단계는 로컬 compose 경로에서만 돈다(리뷰 권고-7).

## 재검토 Trigger

rhwp 실반입(VISUAL 계층 가능), 한컴 Track B 환경 확정(OB-08), 평탄화 변환기
도입(D7 분기), PDF/DOCX 변환기 도입, 표/SPLIT/MERGE 되쓰기 요구, AV 스캐너
도입, 보존 정책 구현(FK·TTL), 설계 09 Template Profile 화면 구현
(`lifecycle_status` 신설).
