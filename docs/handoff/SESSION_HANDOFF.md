# Session Handoff

- Date/time: 2026-08-03 (회사 PC, 다섯 번째 세션 — 종료)
- Branch: **feature/CC-160** @ `2fc5ca0` (origin에 푸시됨, 작업 트리 clean)
- Base: main `d4dca23` (= PR #12 머지 이후) + 이번 세션 main 직접 커밋 `09c2049`
- Current Work Item: **CC-160 구현 완료·이중 리뷰 반영 완료.** PR 미생성 —
  아래 "바로 이어서 할 일" 1번.

## ⚠️ 다음 세션에서 먼저 할 것

이 PC 재개면 부트스트랩 불필요. WSL 깨우고 keepalive만 띄우면 된다.

```bash
wsl -d Ubuntu -- docker compose ps      # WSL 깨우기(컨테이너 자동 복구)
pnpm db:migrate                          # 21개 (0020·0021 신규)
```

- **keepalive는 포그라운드 형태여야 한다.** `wsl -d Ubuntu -- sleep 3600`을
  별도 프로세스로 띄운다. `wsl ... -- bash -lc 'nohup sleep 3600 &'`처럼 WSL
  **안에서** 던지면 wsl.exe가 즉시 끝나 VM이 유지되지 않는다(이번 세션에서
  두 번 확인, `infrastructure/README.md`에 명문화). 약 1시간마다 만료된다.
- 통합·e2e 테스트는 `DATABASE_URL`(superuser) + `OBJECT_STORAGE_*`가 있어야
  실제로 돈다. 없으면 조용히 skip되고 exit 0이 된다. **수치 인용 전 분모
  (`Test Files N passed (N)`)를 확인할 것.**
  ```bash
  set -a; . ./infrastructure/.env; set +a
  export DATABASE_URL="postgres://$UNE_DB_USER:$UNE_DB_PASSWORD@127.0.0.1:$UNE_DB_PORT/$UNE_DB_NAME"
  export OBJECT_STORAGE_ENDPOINT="http://127.0.0.1:$UNE_MINIO_API_PORT"
  export OBJECT_STORAGE_BUCKET="$UNE_MINIO_BUCKET"
  export OBJECT_STORAGE_ACCESS_KEY="$UNE_STORAGE_ACCESS_KEY"
  export OBJECT_STORAGE_SECRET_KEY="$UNE_STORAGE_SECRET_KEY"
  ```
- `gh` CLI가 이 PC에 **없다**. CI 상태는 GitHub REST API로 조회했다
  (`/repos/jazzsalle/une_report2/actions/runs?branch=...`). PR 생성은 사람이
  직접 하거나 `winget install --id GitHub.cli` → `gh auth login --web`.

## 바로 이어서 할 일

1. **PR 생성** — 브랜치는 이미 푸시됐다.
   https://github.com/jazzsalle/une_report2/pull/new/feature/CC-160
   본문은 `docs/evidence/CC-160-preservation-export-verification.md`와 ADR-31
   요약으로 구성하면 된다. **CI는 PR을 열어야 돈다**(ci.yml의 push 트리거는
   main뿐이라 브랜치 푸시만으로는 실행되지 않는다 — 실측 확인).
2. PR CI(`verify` + `db-verify`) 통과 확인 후 머지.
3. 다음 Work Item: **CC-170**(Plan vertical slice E2E — "SSO mock to HWPX
   download"). CC-160이 그 다운로드 경로를 완성했으므로 선행 조건은 충족이다.

## Completed this session

### 전반부 — main 직접 커밋·푸시 (CI verify/db-verify 통과)

- 회사 PC 부트스트랩: `pnpm install` → `db:migrate` → `pnpm -r build`.
- **CRLF 회귀 근본 해결** (main `09c2049`): 워크트리 104개 파일이 CRLF였고
  `validate:contracts`의 transcript pin(ADR-24 D3)이 깨졌다. 커밋된 텍스트
  blob 480개는 전부 LF임을 SHA로 전수 확인한 뒤 워크트리를 복원했고,
  `.gitattributes`에 `* text=auto eol=lf` 기본 규칙을 추가했다(기존 확장자
  15종 목록이 `.csv .dot .svg .mmd .txt .ps1 .ini`·dotfile을 놓치고 있었다).
- `infrastructure/README.md`에 keepalive 함정 명시.
- 저장소 루트의 정체불명 파일 `env.download`·`env.test.download` 삭제
  (다른 프로젝트 Supabase 설정, gitignore에 걸리지 않아 커밋 위험이었다).

### CC-160 (feature/CC-160, 5커밋, 61 files +7704/-128)

**결정 정본: ADR-31 (D1~D16 + 수용 한계)**
**증거: `docs/evidence/CC-160-preservation-export-verification.md`**

- **엔진**(`services/hwpx-engine/src/serialize/`, `src/validate/`):
  ZIP Writer(교체하지 않은 엔트리는 원본 **저장 바이트** 복사 — 재압축 금지),
  XML Delta Writer(트리 재직렬화가 아니라 **원문 구간 교체**), Track A 4계층
  16개 검사(RTA-*), 보존 저장 파이프라인(차단 판정 → 되쓰기 → 검증 → FAIL이면
  바이트 폐기). 파서에 `sourceStart/innerStart` 등 원문 구간 추가, 리더에
  `diskNumberStart`/`archiveComment` 추가(없으면 바이트 동일 재작성 불가).
- **도메인**: `packages/domain/src/document/export.ts` — 저장 모드·형식·상태·
  검증 어휘와 Track A 검사코드 정본, `decideSaveBlock`(ADR-29 D11 집행).
- **DB**: 0020(export_job.tenant_id 신설, 어휘 CHECK, 종단 상관식,
  validation_report append-only, 워커 최소권한·디스패치 정책, ADR-30 이연 2건
  종결), 0021(리뷰 반영: `started_at`/`attempt_no` 리스, file_object 컬럼 단위
  불변). **테이블 61 유지**, 마이그레이션 21개, 데이터 사전 61/572.
- **저장소**: `ObjectStoragePort` + S3(MinIO)/인메모리 어댑터 + 팩토리.
  키 `tenants/{tenantId}/{exports|sources}/…/{sha256}.hwpx`. 신규 런타임
  의존성 `@aws-sdk/client-s3`(ADR-31 D10 — 엔진 무의존 원칙과 구분).
- **API**: UNE-DOC-012/013/014. 다운로드는 감사 대상이며 등록된 sha256과
  다른 바이트는 내주지 않는다. 만료(410)·미완료(409)·저장소 장애(503) 구분.
- **워커**: `document-export/` 러너. 디스패치(테넌트 없이 claim) → 되쓰기·
  Track A·업로드(트랜잭션 **밖**) → file_object+validation_report+export_job
  한 트랜잭션 정산.
- **import 배선 해소**: `DocumentImportService`가 원본 바이트를 저장소에
  등록한다(ADR-31 D9). 이것이 없어 `source_file_id`가 항상 NULL이었고 보존
  Export가 **구조적으로 불가능**했다.
- **계약**: `ExportJob` 빈 자리표시자를 실제 형태로 채움, 예제 2건,
  format enum에서 `JSON` 제거(설계 10 §6 우선), UNE-DOC-014 미디어타입·410 정합.

## 이번 세션에서 드러난 결함 (전부 수정)

1. **MinIO 서비스 계정에 정책이 부착된 적이 없었다** (CC-002 회귀). init 가드가
   `*une-app*`을 평문 출력에서 찾는데 액세스 키가 `une-app-<random>`이라 항상
   "이미 부착됨"으로 판정 → 3일간 모든 요청 403. `--json`의 `policyName` 매칭
   + 부착 후 검증(실패 시 exit 1)으로 수정. CI db-verify에 MinIO 추가.
2. **import가 원본을 등록하지 않아 Export 불가** (위 D9).
3. **Track A가 문단 ID로 짝을 맞춰 삽입·삭제가 실문서 6종 전부 실패**. 산출물
   IR의 ID는 앵커에서 재유도되므로 문단을 넣거나 지우면 뒤쪽 ID가 전부 바뀐다
   (ADR-30 D2 결함의 검증기 쪽 재현). 비교 축을 문서 순서로 교정.
4. **워커 리스가 요청 시각(`created_at`) 기준**이라 큐에 오래 머문 Job이 클레임
   직후부터 stale → 다중 워커에서 중복 실행. 0021이 `started_at`으로 교정.
5. **CI verify를 이번 세션에서 깨뜨렸다가 복구했다** — 앱 환경변수를
   `OBJECT_STORAGE_*`로 정리하며 compose 가드 변수(`UNE_STORAGE_*`)까지 바꿨다.
   되돌리고 `docker compose config --quiet`로 통과 확인.
6. 기존 통합 테스트 픽스처가 실제 쓰기 경로가 만들지 않는 값을 쓰고 있었다
   (0020 CHECK가 노출). 서비스 코드를 전수 확인해 픽스처를 교정.

## 이중 리뷰

architecture-guardian(**BLOCKER 0 / MAJOR 8 / MINOR 7**)과
qa-gate-reviewer(**FAIL, 필수 6**)를 병렬 실행. **지적 전건 반영**(`2fc5ca0`).
QA가 독립 재현한 수치는 주장과 정확히 일치했다.

## 테스트 (단일 `pnpm test`, exit 0, skip 0)

| 워크스페이스 | 결과 | CC-150 대비 |
|---|---|---|
| @une/hwpx-engine | **423** / 23 files | 353 → +70 |
| @une/api | **257** / 22 files | 242 → +15 |
| @une/provider-adapters | **128** / 13 files | 108 → +20 (실 MinIO 4) |
| @une/db-integration | **120** / 10 files | 107 → +13 |
| @une/worker | **44** / 5 files | 33 → +11 |
| @une/contract-tests | **188** / 11 files | 변경 없음 |
| @une/domain | **62** / 10 files | 변경 없음 |
| @une/web / @une/field-web | 1 / 1 | 셸 |

게이트: `build` `typecheck` `lint` `format:check` `validate:contracts`
`validate:intake` `validate:handoff` **전부 PASS**. 생성 타입 drift 0.

## Key decisions (ADR-31)

D1 범위 경계 / D2 바이트 구간 교체 / D3 재압축 금지 / D4 애매하면 거부 +
프로토타입 복제 / D5 Track A 검사코드 신설 / D6 FAIL이면 바이트 폐기 /
D7 FLATTEN은 EXPORT_COPY도 차단 / D8 `serialize()` 바이트 입출력 /
D9 import 원본 등록 / D10 저장소 SDK 도입 근거 / D11 export_job.tenant_id /
D12 어휘 확정·이연 종결(`analysis_status`는 **판정 축**) / D13 minio-init 결함 /
D14 saveMode 옵션 계약에서 닫음 / D15 실패도 같은 보고서로 / D16 리뷰 결함.

## Risks / OPEN

- **한/글에서 열린다는 증거는 없다** — Track B 환경 미확정(OB-08), rhwp
  미반입(OB-12)이라 VISUAL 계층도 불가. 이 항목의 가장 큰 한계다.
- **XML 1.0 금지 제어문자를 거르지 않는다** — 편집 텍스트에 섞이면 그대로
  기록되고 우리 리더가 관대해 Track A도 통과한다. Track B 미실행이므로 **어떤
  게이트도 잡지 못하는 유일한 경로**. 후속 항목에서 좁혀야 한다.
- 자기닫힘 `<hp:t/>` 되쓰기 시 태그 밖에 문자가 들어간다(Track A가 폐기하므로
  손상은 나가지 않으나 오류 코드가 부정확하다).
- 정산 실패 시 저장소 고아 객체(내용 주소라 재시도는 안전, 보존 정책 미구현).
- 엔진 공개 표면에 검증을 건너뛰는 진입점(`rewriteArchive`/`buildXmlDelta`).
- PDF/DOCX 미구현(422), FLATTEN_EXPORT_ONLY 합성 검증만, 표·SPLIT/MERGE 되쓰기
  미개방, AV 스캔 없음(`scan_status`는 PENDING), 보존기간·TTL 없음.
- **CI가 D13 결함 유형 자체는 못 잡는다** — CI는 MinIO를 root로 띄우고
  `mc mb`만 하며 `minio-init.sh`를 실행하지 않는다.
- `canTransitionExport`/`TERMINAL_EXPORT_STATUSES`는 아직 호출자가 없다
  (상태 전이 강제는 DB CHECK뿐).
- 기존 이월: IX-*-TENANT 10건 미구현, 0010 파티션 전환 시 append-only REVOKE
  재적용, UNI_VERIFY_TLS=false POC-local, 설계 09 화면표의 카탈로그 외 역할.

## Notes

- `git push`는 사람 승인 후 Claude가 실행 가능(이번 세션에서 main과
  feature/CC-160 모두 푸시). PR 생성은 gh 부재로 불가.
- DATABASE_URL: 마이그레이션·시드·테스트는 superuser(une), 런타임은 une_app.
  워커 e2e는 admin URL + `UNE_DB_RUNTIME_ROLE=une_worker`.
- `services/api`의 테스트는 `vitest.setup.ts`가 `OBJECT_STORAGE_DRIVER`를
  memory로 기본 설정한다(앱이 기동 시점에 저장소 설정을 요구하기 때문).
- 이 PC git `core.autocrlf=true` — `.gitattributes`의 `* text=auto eol=lf`가
  우선하며 이번 세션에 정리했다.
