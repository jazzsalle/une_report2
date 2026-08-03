# CC-160 검증 증거 — HWPX 보존 Export·Track A 검증·오브젝트 저장소

- 일자: 2026-08-03 (회사 PC)
- 브랜치: feature/CC-160 (base: main d4dca23 = PR #12 머지 이후)
- 결정 기록: ADR-31 (D1~D16 + 수용 한계)
- 대전제: **한/글에서 열린다는 증거는 없다.** Track B(한컴 열기-저장-재열기)는
  릴리스 게이트이며 환경이 확정되지 않았고(OB-08), rhwp 미반입(OB-12)이라
  시각 비교도 불가능하다. 이 항목이 증명하는 것은 **우리 리더로 다시 읽히고,
  원본 바이트가 보존되며, 참조·의미·서식이 의도와 같다**는 것까지다.

## 수용기준 대응

| AC | 구현 | 증거 |
|---|---|---|
| **no-op round trip** | 교체하지 않은 ZIP 엔트리는 원본 **저장 바이트**를 그대로 복사한다(재압축 금지 — ADR-31 D3). 따라서 편집이 없으면 출력이 입력과 **바이트 단위로 동일**하다. 리더에 `diskNumberStart`/`archiveComment`를 추가해 EOCD까지 복원한다 | `services/hwpx-engine/src/serialize/zip-writer.test.ts` — 실문서 **6종 전부** `Buffer.compare(out, in) === 0` + 재작성본 재파싱 시 엔트리 순서·해시·압축방식 동일. `src/serialize/preservation-save.test.ts` — 6종 전부 `noOp === true`, `outputSha256 === sourceSha256`, Track A FAIL 0. **제품 경로 증거**: `services/worker/src/document-export/export-job.runner.e2e.test.ts` — 실 HWPX가 QUEUED→COMPLETED를 지나 저장소에 올라간 산출물이 원본과 바이트 동일 |
| **reference validation** | 산출물을 **처음 보는 문서처럼** 재분석해 원본과 대조한다. RTA-REF-001(dangling 스타일/번호 참조 0), RTA-REF-002(되쓰기가 **새로 만든** 깨진 참조 0 — 원본에 이미 있던 것과 구분), RTA-REF-003(문단 ID 유일성) | `services/hwpx-engine/src/validate/track-a.ts`, `src/serialize/preservation-save.test.ts`(6종에서 FAIL 0). 참조 검사 자체는 CC-140의 `ir/reference-check.ts`를 재사용 — 검사 정의가 두 벌이 되지 않게 |
| **unsupported object preservation** | 보존 객체를 **위치가 아니라 내용으로** 비교한다: 원본과 산출물에서 PRESERVED 블록의 **원문 조각**을 문서 순서대로 뽑아 배열 동치를 요구(RTA-SEM-004). 앞쪽 삽입·삭제로 앵커 서수가 밀리는 것은 손상이 아니지만 조각의 바이트가 달라지면 손상이다. 되쓰지 않은 Part는 저장 바이트까지 동일(RTA-PKG-007) | `src/serialize/preservation-save.test.ts` — 실문서 6종에서 **주변 문단을 실제로 고친 뒤** RTA-SEM-004/RTA-PKG-007 PASS, 편집된 텍스트가 재분석에서 실제로 보임. `src/serialize/xml-delta.test.ts` — 교체한 Part 외 모든 엔트리의 `storedSha256` 불변 |
| **validation report** | Track A 4계층 **16개 검사코드**(RTA-*, ADR-31 D5 신설)와 **미실행 3계층의 사유**를 함께 낸다. 보고서에 `outputSha256`/`sourceSha256`을 실어 "어느 바이트를 검사했는가"를 못박는다. FAIL이면 산출물 바이트를 **반환하지 않는다**(HWPX-1105) | `src/serialize/preservation-save.test.ts` — 보고서가 `TRACK_A_CHECKS` 전체를 담고 계층 집합이 정확히 4종, `notRunLayers`가 VISUAL/HANCOM/EDIT + 사유(rhwp/Track B 명시), 해시가 산출물과 일치. DB 저장은 `services/worker/.../export-job.runner.e2e.test.ts`(checks ≥16, notRunLayers 3, noOp true), HTTP 노출은 `services/api/src/e2e/export.e2e.test.ts` |

## 게이트 실행 결과

**단일 `pnpm test`(exit 0)로 재현한 수치다.** `DATABASE_URL`(superuser)과
`OBJECT_STORAGE_*`를 설정해 db-integration·api e2e·worker e2e·실 MinIO 통합이
실제로 실행됐음을 분모(`Test Files N passed (N)`)로 확인했다.

| 게이트 | 결과 | CC-150 대비 |
|---|---|---|
| `@une/hwpx-engine` | **423** / 23 files | 353 → +70 (ZIP writer 18, delta 21, 보존저장 31) |
| `@une/api` | **257** / 22 files | 242 → +15 (Export e2e) |
| `@une/provider-adapters` | **128** / 13 files | 108 → +20 (저장소 포트 16, 실 MinIO 4) |
| `@une/db-integration` | **120** / 10 files | 107 → +13 (export-surface 신설, skip 0) |
| `@une/worker` | **44** / 5 files | 33 → +11 (Export 러너 e2e: 동시성·리스·차단 포함) |
| `@une/contract-tests` | **188** / 11 files | 변경 없음 |
| `@une/domain` | **62** / 10 files | 변경 없음 |
| `@une/web` / `@une/field-web` | 1 / 1 | 셸 |
| `pnpm validate:contracts` | **PASS** (예제 15건 — Export 2건 신규) | |
| `pnpm validate:intake` / `validate:handoff` | **PASS** | |
| `build` / `typecheck` / `lint` / `format:check` | **PASS** | |
| 생성 타입 drift | 0 (재생성 후 커밋됨) | |

DB 상태: 마이그레이션 **21개**, 테이블 61(신설 없음), 데이터 사전 61/572 재생성.

## 구현 중 측정으로 드러난 것

### 1. MinIO 서비스 계정에 정책이 부착된 적이 없었다 (CC-002 회귀)

`infrastructure/minio-init.sh`의 가드가 `mc admin user info`의 평문 출력에서
`*une-app*`을 찾는데, 액세스 키가 `une-app-<random>`으로 생성되므로 **패턴이 키
이름에 걸려** 항상 "이미 부착됨"으로 판정했다. 3일 전 인프라 구축 이래 서비스
계정은 모든 요청이 403이었고, 저장소를 실제로 쓰는 첫 코드에서야 드러났다.

- 진단: 실 MinIO 통합 테스트 4건이 전부 `REJECTED ... Access Denied`
- 확인: `mc admin user info` → `PolicyName:` 비어 있음
- 수정: `--json` 출력의 `policyName`으로 매칭 + **부착 후 검증 단계**(실패 시 exit 1)
- 재발 방지: CI db-verify에 MinIO를 띄우고 `@une/provider-adapters` 테스트 추가.
  없으면 통합 테스트가 조용히 skip되고 같은 유형이 다시 지나간다.

CC-002 증거 문서는 "bucket-scoped MinIO service account"를 검증했다고 적었지만,
그 검증은 계정과 정책의 **존재**만 봤고 **부착**은 보지 않았다.

### 2. import가 원본을 저장소에 등록하지 않아 Export가 성립할 수 없었다

`DocumentImportService`는 `sourceFileId`를 옵션으로만 받고 아무도 채우지 않아
모든 문서의 `document.source_file_id`가 NULL이었다. 보존 저장은 원본 패키지
위에서 하는 일이므로 Export는 구조적으로 불가능한 상태였다. API e2e 15건 중
10건이 422로 떨어지면서 드러났다(ADR-31 D9).

### 3. 실문서가 되쓰기 불가 구조를 갖고 있다

`doc-template-01`의 `p[2]`는 `hp:run` 안이 `[hp:t, hp:ctrl, hp:ctrl, hp:t]`다 —
누름틀 필드가 텍스트를 두 조각으로 가른다. IR에서는 단일 run·controls 0으로
보이지만 새 문장을 어느 조각에 넣을지 결정할 근거가 없다. **거부**로 확정하고
그 구조를 회귀 테스트로 고정했다(`xml-delta.test.ts`). 처음 구현은 반대로 너무
넓게 거부했다 — `hp:linesegarray`(줄 배치 캐시)가 있는 run을 전부 막아 되쓰기
가능한 문단이 사실상 사라졌고, 텍스트에 기여하는 요소만 세도록 좁혔다.

### 4. 기존 픽스처가 실제 쓰기 경로에 없는 값을 쓰고 있었다

0020의 CHECK가 걸리자 통합 테스트 5곳이 실패했다. 확인 결과 **제약이 아니라
픽스처가 틀렸다**:

- `analysis_status = 'COMPLETED'` / `'CONFIRMED'` — 어느 어휘에도 없는 값
- `ACCEPTED` 자동저장에 `result_revision_id` 없음 — 실제 서비스는 항상 채운다
- `ACCEPTED → SUPERSEDED` UPDATE — `change-set.service.ts`에
  `UPDATE document_autosave` 자체가 없다(전수 확인). SUPERSEDED는 늦게 도착한
  항목 **자신**이 INSERT되는 것이다

서비스 코드를 전수 확인해 제약이 옳음을 확인하고 픽스처를 실제 어휘로 맞췄다.

### 5. export_job에 tenant_id가 없어 워커가 정산할 수 없었다

`generation_job`에는 있고 `export_job`에는 없는 비대칭. 디스패치 트랜잭션은
테넌트가 없는 상태로 도는데, 그 상태에서는 `document` 정책이 거짓이라 0018의
EXISTS(document) 정책만으로는 행을 볼 수도, 테넌트를 알아낼 수도 없다.
0020이 컬럼을 신설하고 document에서 백필했다(ADR-31 D11).

또한 워커가 `template_profile`을 읽지 못해 저장 차단(ADR-29 D11)의 입력인
호환성 판정을 얻을 수 없었다 — Export 러너 e2e가 `permission denied for table
template_profile`로 실패하면서 드러났고, 0020에 SELECT 권한을 더했다.

## 이중 리뷰에서 드러난 것 (전건 반영)

architecture-guardian(MAJOR 8/MINOR 7)과 qa-gate-reviewer(FAIL, 필수 6)를 병렬로
돌렸다. **구현이 실제로 깨져 있던 것 두 가지**를 포함해 전부 반영했다.

### 6. Track A가 문단 ID로 짝을 맞춰 삽입·삭제가 항상 실패했다

산출물 IR은 새로 빌드되고 문단 ID는 앵커에서 유도되므로, 문단을 하나 넣거나
지우면 뒤쪽 서수가 밀려 ID가 전부 바뀐다. `RTA-STY-001`이 엉뚱한 문단끼리
비교해 **실문서 6종 전부에서 FAIL**이었다 — ADR-30 D2가 지적한 결함이 검증기
쪽에서 재현된 것이다. 비교 축을 문서 순서로 바꾸자 삽입·삭제가 6종 전부 통과.
QA 리뷰는 이 경로를 "미검증"으로 봤으나 실제로는 **깨져 있었다.**

### 7. 워커 리스가 요청 시각을 봤다

`created_at < now() - lease`는 큐에 오래 머문 Job을 클레임 직후부터 stale로
만든다 — 워커가 둘 이상이면 진행 중인 Job을 매 틱마다 재클레임해 되쓰기·업로드가
중복 실행된다. 0021이 `started_at`/`attempt_no`를 신설하고 `generation_job`과
같은 모델로 맞췄다. 동시 실행·리스 회수·시도 상한 테스트를 추가했다.

### 8. CI verify 잡을 내가 깨뜨렸다

앱 환경변수를 `OBJECT_STORAGE_*`로 정리하면서 compose 가드 변수(`UNE_STORAGE_*`)
까지 바꿨다. compose는 인프라 비밀값을, 서비스는 앱 설정을 쓰는 **다른 층**이다.
되돌리고 `docker compose config --quiet`로 실제 통과를 확인했다.

### 그 밖에 닫은 fail-open 세 지점

- 호환성 판정이 없거나 어휘 밖이면 저장을 **중단**한다(기본값 `LIMITED` 제거).
- FLATTEN 판정은 `template_profile.unsupported_objects_json`(분류기의 권위 있는
  출력)을 먼저 본다 — IR 등급만 보면 JSON 왕복에서 빠진 리비전이 조용히 통과한다.
- 저장소에서 받은 원본이 `file_object.sha256`과 다르면 되쓰지 않는다. 다운로드
  경로는 이미 이 비교를 했는데 되쓰기의 **기준**으로 삼을 때는 하지 않았다.

또한 러너에 Job 단위 오류 격리를 넣었고(한 건의 예외가 배치를 중단시키던 경로),
계약의 `checks[].code` 패턴을 실패 코드까지 넓혔으며(실패한 Export의 UNE-DOC-013
응답이 자기 계약을 위반하고 있었다), 무시되던 `options.saveMode`를 계약에서
닫았고, UNE-DOC-014의 미디어타입·410을 구현에 맞췄으며, `file_object`의 UPDATE를
컬럼 단위로 회수했다(`scan_status`만 허용). AC3 테스트의 공허한 단언
(`toBeGreaterThanOrEqual(0)`)도 실패하도록 고쳤다.

## 보안·격리 검증

| 항목 | 증거 |
|---|---|
| 저장소 키 경로 탈출 | `object-storage.test.ts` — `../../etc`, `<uuid>/../other`, 빈 문자열, 비-UUID 전부 거부 |
| 테넌트 격리(저장소) | 키 접두사 `tenants/{tenantId}/`; UUID 형식만 세그먼트로 허용 |
| 테넌트 격리(DB) | `export-surface.test.ts` — 다른 테넌트 Job 비가시, 테넌트 미설정 시 0행, WITH CHECK가 "내 테넌트 값 + 남의 문서"와 "남의 테넌트 값" 둘 다 거부 |
| 테넌트 격리(HTTP) | `export.e2e.test.ts` — 다른 테넌트의 Export 조회·다운로드 **404**(존재를 흘리지 않는다), 다른 테넌트 문서로 Export 생성 422 |
| 권한 | DOC_EXPORT 없는 사용자 403 |
| 멱등 | 같은 Idempotency-Key 재전송 → 같은 exportId, `export_job` 1행. 헤더 부재 400 |
| 산출물 무결성 | 등록된 sha256과 다른 바이트는 내주지 않는다(410) — 저장소 객체만 바꿔치기하는 테스트로 확인 |
| 오류 구분 | 미완료 409 / 만료 410 / 저장소 장애 503 — 각각 독립 테스트 |
| 감사 | `EXPORT_REQUESTED`(접수), `EXPORT_COMPLETED`·`EXPORT_FAILED`(워커), `EXPORT_DOWNLOADED`(다운로드, **바이트를 받은 뒤** 기록) |
| append-only | `validation_report` UPDATE/DELETE 회수, `file_object` DELETE 회수 — une_app·une_worker 양쪽에서 확인 |
| 다운로드 헤더 | 파일명은 RFC 5987 `filename*`로만 내보내고 ASCII 대체값 고정 — 헤더 분리 차단 |

## 알려진 한계 (ADR-31 수용 한계와 동일)

- **VISUAL 계층 검증 전무** (rhwp 미반입, OB-12) — 페이지 이동·글꼴 대체·표 폭
  변경 회귀를 잡는 자동 검사가 없다.
- **Track B 미실행** (OB-08) — 한/글에서 열린다는 증거는 없다.
- **PDF/DOCX 미구현** — 어휘에만 있고 422로 거부한다.
- **FLATTEN_EXPORT_ONLY 합성 검증만** — 실 코퍼스에 사례가 없다.
- **되쓰기 범위**: 텍스트 교체·문단 삽입·문단 삭제. 표 구조 편집·SPLIT/MERGE는
  열지 않았다.
- **linesegarray 미갱신** — 배치는 rhwp/한글이 여는 시점에 재계산한다.
- **AV 스캔 없음** — `scan_status`는 PENDING으로 남는다.
- **보존기간·TTL 없음** — 410 경로는 있으나 만료시키는 정책은 미구현.
- 실 MinIO 통합 테스트는 `OBJECT_STORAGE_*` 미설정 시 **4건 skip**되며 그 사실을
  로그로 신고한다. CI db-verify에서는 실제로 실행된다.
- **자기닫힘 `<hp:t/>`**·**XML 제어문자**·**정산 실패 시 고아 객체**·**검증을
  건너뛰는 엔진 공개 표면** — 리뷰가 지적한 네 가지를 ADR-31 수용 한계에
  명시했다. 앞의 둘은 되쓰기 정확성에 직결되므로 실문서 픽스처와 함께 좁혀야
  한다(CC-170 또는 후속 항목).
- **CI가 D13의 결함 유형 자체는 잡지 못한다** — CI는 MinIO를 root 자격증명으로
  띄우고 `mc mb`만 하며 `minio-init.sh`를 실행하지 않는다. 스크립트의 부착 검증은
  로컬 compose 경로에서만 돈다.

## 재현 방법

```bash
# 인프라
docker compose -f infrastructure/docker-compose.yml up -d

# 환경(로컬 비밀값은 infrastructure/.env에서)
export DATABASE_URL=postgres://une:<pw>@127.0.0.1:5432/une
export OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000
export OBJECT_STORAGE_BUCKET=une-documents
export OBJECT_STORAGE_ACCESS_KEY=<UNE_STORAGE_ACCESS_KEY>
export OBJECT_STORAGE_SECRET_KEY=<UNE_STORAGE_SECRET_KEY>

pnpm db:migrate          # 20개
pnpm build && pnpm test  # 분모까지 확인할 것
pnpm validate:contracts && pnpm validate:intake && pnpm validate:handoff
```
