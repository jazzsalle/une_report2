# Session Handoff

- Date/time: 2026-08-05 (회사 PC, 여섯 번째 세션 — 종료)
- Branch: **feature/CC-170** @ `0f0afd2` (**푸시 안 됨**, 작업 트리 clean)
- Base: **feature/CC-160** `041f0b7` (origin에 있으나 **PR 미생성** — CI가 한 번도
  돌지 않았다). CC-170은 CC-160의 Export 경로에 의존하므로 그 위에 쌓았다.
- Current Work Item: **CC-170 구현·이중 리뷰 반영 완료.** 남은 것은 PR 두 개다.

## ⚠️ 다음 세션에서 먼저 할 것

이 PC 재개면 부트스트랩 불필요. WSL 깨우고 keepalive만 띄우면 된다.

```bash
MSYS_NO_PATHCONV=1 wsl -d Ubuntu -- docker ps    # WSL 깨우기(컨테이너 자동 복구)
pnpm db:migrate                                  # 22개 (0022 신규)
```

- **keepalive는 포그라운드 형태여야 한다.** `wsl -d Ubuntu -- sleep 3500`을
  별도 프로세스로 띄운다(WSL 안에서 nohup으로 던지면 wsl.exe가 즉시 끝나 VM이
  유지되지 않는다). 약 1시간마다 만료되므로 다시 띄운다. WSL이 죽으면 컨테이너도
  내려가지만 볼륨은 남아 `docker ps` 한 번으로 복구된다(이번 세션에서 확인).
- Git Bash에서 `wsl`에 경로를 넘길 때는 `MSYS_NO_PATHCONV=1`을 붙인다 —
  `/mnt/d/...`가 `C:/Program Files/Git/mnt/...`로 망가진다(이번 세션 실측).
- 통합·e2e 테스트는 아래 환경변수가 있어야 **실제로 돈다**. 없으면 조용히
  skip되고 exit 0이다. **수치 인용 전 분모(`Test Files N passed (N)`)를 확인할 것.**
  ```bash
  set -a; . ./infrastructure/.env; set +a
  export DATABASE_URL="postgres://$UNE_DB_USER:$UNE_DB_PASSWORD@127.0.0.1:$UNE_DB_PORT/$UNE_DB_NAME"
  export OBJECT_STORAGE_ENDPOINT="http://127.0.0.1:$UNE_MINIO_API_PORT"
  export OBJECT_STORAGE_BUCKET="$UNE_MINIO_BUCKET"
  export OBJECT_STORAGE_ACCESS_KEY="$UNE_STORAGE_ACCESS_KEY"
  export OBJECT_STORAGE_SECRET_KEY="$UNE_STORAGE_SECRET_KEY"
  ```
- **`gh` CLI가 이 PC에 아직 없다.** 사용자가 `winget install --id GitHub.cli` →
  `gh auth login --web`을 실행하면 PR 생성·CI 확인을 Claude가 처리할 수 있다.
  그때까지 CI는 한 번도 돌지 않는다(ci.yml의 push 트리거는 main뿐).
- 화면 캡처를 다시 만들려면 브라우저가 필요하다(1회):
  `pnpm --filter @une/e2e exec playwright install chromium`. 포트 3399·4399를
  쓰므로 이전 실행이 남아 있으면 `netstat -ano | grep 4399` →
  `taskkill //PID <pid> //F`. `vite preview`는 `--host 127.0.0.1`이 없으면
  IPv6에만 붙어 대기가 영원히 끝나지 않는다(스크립트에 반영됨).

## 바로 이어서 할 일

1. **PR 두 개** — 순서가 중요하다. CC-160을 먼저 머지해야 CC-170의 diff가
   CC-170만 남는다.
   - `feature/CC-160` → main: 본문은 `docs/evidence/CC-160-preservation-export-
     verification.md` + ADR-31 요약 + 수용 한계(한/글 미검증, XML 제어문자, 고아 객체).
   - `feature/CC-170` → main (CC-160 머지 후): 본문은
     `docs/evidence/CC-170-plan-slice-e2e.md` + ADR-32 D1~D17 요약.
   - **`feature/CC-170`은 아직 푸시되지 않았다.** 푸시는 사람 승인 후.
2. PR CI(`verify` + `db-verify`) 통과 확인 후 머지. **db-verify에 `@une/e2e`가
   추가됐다**(리뷰 필수1) — 슬라이스 E2E가 CI에서 처음 돈다.
3. 다음 Work Item: **CC-200**(Situation과 후보 SituationFact 수집 — G3 진입).
   CC-100 의존이므로 선행 조건은 충족이다. G2는 CC-170으로 닫힌다.

## Completed this session — CC-170 (feature/CC-170, 5커밋)

**결정 정본: ADR-32 (D1~D17 + 수용 한계 9항)**
**증거: `docs/evidence/CC-170-plan-slice-e2e.md`, 화면 12장
`docs/evidence/CC-170/screens/`**

### 착수하자 드러난 것 — 인수기준의 경로에 진입점이 없었다

CC-170은 통합·QA 항목처럼 보였지만 **구현 항목**이었다.

- `UNE-DOC-001~004`가 계약에 `GenericRequest/GenericResponse` 자리표시자로만 있고
  컨트롤러가 없었다(ADR-31 D1이 CC-160에서 제외한 뒤 아무 항목도 안 가져갔다).
- `DocumentImportService`는 컨트롤러에 배선되지 않아 테스트만 직접 호출했다.
- `apps/web`은 4개 파일 셸이었다 — 화면이 없으면 "화면 캡처" 증거도 없다.

### 만든 것

- **업로드 3단**(사전등록 → presign/티켓 직접 전송 → 완료확정) + 반입·분석조회.
  검증 지점은 UNE-DOC-002 하나이고, 저장 바이트에서 크기·SHA-256을 재계산하고
  엔진 `analyzePackage`로 내용 기반 HWPX 판정을 한다(확장자·Content-Type 불신).
  presign은 선언 해시를 **서명에 넣어** 저장소가 다른 바이트를 직접 거부한다.
- **마이그레이션 0022**: `upload_state`/`verified_at`(업로드 검증은 AV 검사와 다른
  축 — `scan_status`는 PENDING 유지, **OB-15 신설**), 기존 행 VERIFIED 백필,
  앱 롤에 두 컬럼만 UPDATE 허용, `plan.document_id` 부분 유니크. 테이블 61 유지.
- **슬라이스 UI 6화면**(로그인 → 계획서 → 기준정보 → 반입 → 목차·본문 생성 →
  **5-3 실체화** → Export·다운로드). 신규 런타임 의존성 0, 타입은 계약에서 생성,
  CORS는 env allowlist(와일드카드 기동 거부). **편집기 화면은 없다**(OB-12).
- **신규 워크스페이스 `@une/e2e`** — API와 워커를 한 프로세스에서 돌려 전 구간 통과.
  받은 바이트의 해시가 검증 보고서의 `outputSha256`과 같다.
- **성능 기준선**(합성 50쪽 = 2,000문단, 문단 40개=1쪽 가정, 개발 PC):
  분석 p95 256ms(목표 5,000 PASS) · 업로드+반입 613ms · 편집 적용 162ms(목표 300
  PASS) · Export+TrackA 352ms(기준선) · 다운로드 8ms(기준선). **게이트가 아니다.**

### 이번 세션에 드러난 결함 (전부 수정)

1. **여러 문단을 넣은 문서는 CC-160 이후 한 번도 Export된 적이 없었다.** 두 번째
   부터의 `anchorHint`가 AUTHORED 문단을 가리켜 되쓰기가 HWPX-1103으로 거절했다.
   CC-160은 문단 **하나**만 시험했다. 체인을 거슬러 원본까지 따라가도록 고쳤다.
2. **되쓰기가 IR이 정한 서식을 무시했다** — 앵커 이웃을 복제해 프로토타입(§1.7)이
   버려지고 재분석에서 RTA-STY-001이 FAIL했다. 자리는 앵커가, **서식은 IR이** 정한다.
3. **실문서 OUTLINE_1 프로토타입은 run 4개 + 빈 run**이라 복제기가 거절했다.
4. **`OBJECT_STORAGE_PUBLIC_ENDPOINT`가 CC-001부터 문서에만 있었다** — presign이
   생긴 지금, 컨테이너/호스트 주소가 갈리는 배포에서 서명 URL이 연결조차 안 된다.
5. **계약이 존재하지 않는 테이블 `malware_scan`을 가리켰다** → 계약을 교정하고,
   **구현된 API의 x-db-tables 전건을 데이터 사전과 대조**하는 게이트를 세웠다.
6. **화면 캡처가 UI 결함 2건을 잡았다** — UNE-PLAN-007은 기준정보를 본문 최상위로
   받고(임시저장 006만 `{context}`), UNE-PLAN-014는 목차 트리를 다시 실어야 한다.

### 이중 리뷰 (architecture 0 BLOCKER/8 MAJOR/11 MINOR, QA PASS WITH CONDITIONS 필수 3)

QA가 증거 문서의 수치를 **전건 독립 재현**했고 일치했다. 두 리뷰가 같은 둘을 지적했다.

1. **슬라이스 E2E가 CI에서 한 번도 돌지 않았다**(`verify`는 DATABASE_URL이 없어
   전건 침묵 스킵, `db-verify`는 목록에 없었다) → `db-verify`에 추가.
2. **계약이 없는 컬럼 `document.plan_id`를 선언했다** → 계약 교정 + 타입 재생성.
3. (QA) **화면으로 내려받은 HWPX에 생성 본문이 없었다** → 문서에 한계로 적는 대신
   **UI에 실체화 단계를 만들었다**. 재캡처: 16개 호출, 9블록 삽입 → revision 2,
   문단 44→53, 산출물이 원본과 다름(Track A LIMITED).

MAJOR 5건 추가 반영: 반입의 해시 재확인 누락 · 티켓 키가 빈 비밀에서 파생 가능 ·
멱등 재전송 계약 불일치 · `uploads/` 접두사가 영구 원본의 수명을 거짓으로 말함 ·
서버가 만든 file_object가 영구 PENDING · 복제 원본이 `hp:secPr`/표 셀 문단을 고를
수 있었음. MINOR·권고(동시성 테스트 2건 포함)도 반영. 미반영 항목과 이유는
ADR-32 D17.

## 테스트 (단일 `pnpm test`, exit 0, skip 0)

| 워크스페이스 | 결과 | CC-160 대비 |
|---|---|---|
| @une/hwpx-engine | **426** / 23 files | +3 |
| @une/api | **285** / 24 files | +28 |
| @une/provider-adapters | **138** / 13 files | +10 (실 MinIO 9) |
| @une/db-integration | **127** / 11 files | +7 |
| @une/contract-tests | **195** / 12 files | +7 |
| @une/e2e | **13** / 2 files | 신규 |
| @une/web | **28** / 3 files | +27 |
| @une/worker / @une/domain | 44 / 62 | 변경 없음 |
| baseline pytest | **14** | +4 |

게이트: `build` `typecheck` `lint` `format:check` `validate:contracts`
`validate:intake` `validate:handoff` **전부 PASS**. 생성 타입 drift 0,
데이터 사전 61/574 drift 0. 마이그레이션 **22개**.

## Risks / OPEN

- **CC-160·CC-170 둘 다 PR이 없어 CI 검증을 받지 않았다.** 이것이 가장 큰 미결이다.
- **한/글에서 열린다는 증거는 없다** — Track B 환경 미확정(OB-08), rhwp
  미반입(OB-12)이라 VISUAL 계층도 불가.
- **실체화 자리에 제약이 있다** — 표 뒤·정적영역 뒤에는 놓을 수 없고, 화면이 그
  사실을 미리 말해 주지 못한다(ADR-32 수용 한계 1).
- **AV 스캔 없음**(OB-15 신설) — `scan_status`는 영구 PENDING.
- **화면 캡처는 CI에서 돌지 않아 회귀를 잡지 못한다**(ADR-32 D13).
- 성능 수치는 개발 PC 값이고 표본 3~5회다. 화면이 SSE(UNE-PLAN-011)를 쓰지 않는다
  (폴링). 실제 T3Q SSO 없음(OB-01).
- **XML 1.0 금지 제어문자를 거르지 않는다** — 편집 텍스트에 섞이면 그대로 기록되고
  우리 리더가 관대해 Track A도 통과한다. Track B 미실행이므로 어떤 게이트도 잡지
  못하는 유일한 경로다.
- 자기닫힘 `<hp:t/>` 되쓰기 시 태그 밖에 문자가 들어간다(Track A가 폐기하므로
  손상은 나가지 않으나 오류 코드가 부정확하다).
- 정산 실패 시 저장소 고아 객체(내용 주소라 재시도는 안전, 보존 정책 미구현).
- 엔진 공개 표면에 검증을 건너뛰는 진입점(`rewriteArchive`/`buildXmlDelta`).
- PDF/DOCX 미구현(422), FLATTEN_EXPORT_ONLY 합성 검증만, 표·SPLIT/MERGE 되쓰기
  미개방, 보존기간·TTL 없음.
- **CI가 minio-init 결함 유형은 못 잡는다** — CI는 MinIO를 root로 띄우고 `mc mb`만
  하며 `minio-init.sh`를 실행하지 않는다.
- `canTransitionExport`/`TERMINAL_EXPORT_STATUSES`는 아직 호출자가 없다.
- 미반영 리뷰 지적: 413 봉투 형태, 전송 라우트 감사, 요청 본문 strict 검증,
  x-permission 인증수준 정본, 설정 진입점 이원화, `SliceWorkspace.tsx` 컴포넌트
  테스트, 성능 표본 표기, OB 번호 순서(ADR-32 D17).
- 기존 이월: IX-*-TENANT 10건 미구현, 0010 파티션 전환 시 append-only REVOKE
  재적용, UNI_VERIFY_TLS=false POC-local, 설계 09 화면표의 카탈로그 외 역할.

## Notes

- `git push`는 사람 승인 후 Claude가 실행 가능. PR 생성은 `gh` 부재로 아직 불가.
- DATABASE_URL: 마이그레이션·시드·테스트는 superuser(une), 런타임은 une_app.
  워커·E2E는 admin URL + `UNE_DB_RUNTIME_ROLE=une_worker`(하네스가 설정한다).
- `services/api`의 e2e는 `src/e2e/test-config.ts`로 설정을 조립한다 — `ApiConfig`에
  필드를 더할 때 다섯 파일을 고치지 않아도 된다(이번 세션에 그렇게 터졌다).
- `services/api`의 테스트는 `vitest.setup.ts`가 `OBJECT_STORAGE_DRIVER`를 memory로
  기본 설정한다(앱이 기동 시점에 저장소 설정을 요구하기 때문).
- mock 서버(`mock-server/app.py`)도 업로드 3단을 구현하며 실제로 해시를 검증한다.
  baseline pytest는 venv가 필요하다: `python -m venv <dir>` → `pip install -r
  mock-server/requirements.txt pytest httpx`.
- 이 PC git `core.autocrlf=true` — `.gitattributes`의 `* text=auto eol=lf`가 우선한다.
