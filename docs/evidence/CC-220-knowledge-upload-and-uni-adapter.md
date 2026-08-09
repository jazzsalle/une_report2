# CC-220 수용 증거 — 지식문서 업로드와 UNI 어댑터

작성일 2026-08-10 · 브랜치 `feature/CC-220` · 결정 정본 **ADR-36** ·
마이그레이션 **0028**·**0029**·**0030** ·
관련 설계 06 US-SIT-009·US-SIT-010, 설계 08 §1.8·§1.9·§1.14,
설계 10 UNE-KNOW-001~003·§7.23·§7.24 · OB-13/OB-15/OB-17

---

## 1. 인수기준 대조

| 인수기준 | 어디서 증명하는가 |
|---|---|
| file security checks | `knowledge.e2e.test.ts` "검사 결과가 없는 파일은 422다", "업로드 검증 전 파일과 감염 파일도 거부한다", "허용되지 않은 형식은 422다" + 도메인 `checkKnowledgeFile` 8건 |
| object storage | `knowledge-upload.runner.e2e.test.ts` — 러너가 `ObjectStoragePort`로 원본을 읽고, 읽기 실패는 문서를 FAILED로 종결한다(잡이 RUNNING에 남지 않는다) |
| UNI upload status | 같은 파일 "폴링이 설계 08 §1.9 수명주기를 따라 나아가고 READY에서 멈춘다", "관측 시각은 상태가 그대로여도 갱신된다" |
| retry | `knowledge.e2e.test.ts` 재시도 6건 — 차단 3종, 전송 실패 재시도, **두 축 되돌림**, 동시 재시도 409 |

## 2. 핵심 결정 세 가지

### 2.1 상태를 두 축으로 나눴다

0004의 `knowledge_document.status`는 주석이 `'UPLOADING~FAILED'` 한 줄뿐인데
설계 06은 서로 다른 두 계열을 적는다.

```
US-SIT-009  LOCAL_VALIDATED → UPLOADING → QUEUED/ERROR      (UNE가 아는 사실)
US-SIT-010  QUEUED → … → READY/ERROR/CANCELLED              (UNI가 알려준 사실)
```

합치면 **UNI가 응답하지 않을 때 무엇이 참인지 말할 수 없다.** `uni_status`의
`NULL`은 "아직 모른다"이지 "처리되지 않았다"가 아니다. ADR-32 D3이
`scan_status`와 `upload_state`를 가른 것과 같은 판단이다.

근거 자격(`isEvidenceEligible`)은 두 축이 모두 맞아야 참이다 — US-SIT-010
완료조건이 "READY 아닌 자료가 Evidence에 포함된 건 0"이고 CC-230이 이 함수를
게이트로 쓴다.

### 2.2 UNI 호출은 워커가 한다

설계 10 §7.23 7단계가 정한 대로다. 등록은 **202**로 끝난다 — 201이면 "등록이
끝났다"로 읽히지만 실제로 끝난 것은 접수다. 0023 §4가 "비동기로 옮길 때
QUEUED/RUNNING을 추가하는 마이그레이션이 함께 온다"고 예고했고 0028이 그것이다.

### 2.3 미확인 값을 추측하지 않는다

`HttpUniKnowledgeAdapter`는 base URL·자격증명·**multipart 파일 필드명**·
**로그인 토큰 필드명**이 없으면 기동을 거부한다. 틀린 기본값으로 실 서버를
부르면 422가 돌아오고 운영자는 "UNI가 거절했다"로 읽는다 — 실제로는 UNE가
잘못 보낸 것이다. 로그인 응답에 설정된 토큰 필드가 없을 때 다른 필드를 뒤지지
않는 것도 같은 이유다.

요청 규격 `contracts/openapi/uni-knowledge-api-change-request-v1.yaml`
(CR-UNI-001~007)과 사내 개발자용 설명서 `docs/handoff/UNI_KNOWLEDGE_API_REQUEST.md`
를 함께 냈다. capability는 세 기능 모두 `UNE_ADAPTER_READY` + `openBinding: OB-13`
— 코드는 있으나 실제 UNI에 대고 성공한 적이 없다.

## 3. 실행으로 잡은 결함 여섯 가지

전부 **테스트가 먼저 실패하는 것을 보고** 고쳤다.

| # | 결함 | 어떻게 드러났나 |
|---|---|---|
| 1 | 0028의 `finished_at IS NULL` CHECK와 컬럼 `NOT NULL`이 서로 모순 — QUEUED 잡을 **아예 만들 수 없었다** | 워커 e2e 8건 전부 실패 |
| 2 | 0027의 트리거가 워커의 모든 UPDATE를 42501로 막았다 | 워커 e2e 7건 실패 → 0029 |
| 3 | 워커가 `provider_job.request_json`을 마스킹할 수 있었다(0026이 전용 롤 뒤로 격리한 컬럼) | 회귀 테스트 실측 → 0030 |
| 4 | 워커가 **종결된** UNI 잡을 QUEUED로 되돌릴 수 있었다(테넌트 스코프에서 permissive 정책이 OR로 통과) | 회귀 테스트 실측 → 0030 |
| 5 | **재시도가 무의미했다** — UNI 처리 실패 재시도가 `uni_status='ERROR'`를 남겨 재업로드가 성공해도 영원히 폴링 대상에서 빠지고 근거 자격을 얻지 못했다. 상태가 안 변하니 동시 재시도 둘이 각각 잡을 만들어 UNI에 두 벌 | QA 검토 F4, API e2e가 재현 |
| 6 | **거부 감사가 남지 않았다** — 파일 검사 거부를 트랜잭션 안에서 기록하고 던져 롤백과 함께 사라졌다(US-SIT-009 E-01) | API e2e "검사 결과가 없는 파일은 422다"의 감사 단언 |

3·4는 **내가 0028에서 만든 구멍**이고, 5·6은 각각 QA 검토와 그 지적을 닫으려
쓴 e2e가 잡았다. 2는 직전 작업(0027)에서 "이 두 테이블의 UPDATE 경로는 보존
정리 하나뿐"이라고 실측에 근거해 판단한 것이 한 Work Item 만에 거짓이 된
경우다.

**주석이 사실과 달랐던 자리 세 곳**(0028 §6 두 곳, 0029 맨 끝)도 함께 정정했다.
근거를 "확인했다"처럼 적었으나 실제로는 의도만 적은 것이었다.

## 4. 워커 권한 경계 (ADR-36 D4)

ADR-33 D2의 롤 권한 경계를 UNI 잡에 한해 넓혔다. 넓히되 좁게 가둔다.

```
provider_job        SELECT + 컬럼 UPDATE(status,result_count,error_json,finished_at)
                    + RESTRICTIVE(provider_code='UNI') + RESTRICTIVE(미종결 행만)
provider_result     INSERT만 — SELECT 없음
knowledge_document  SELECT + 컬럼 UPDATE(결과·관측 컬럼만) + RESTRICTIVE(미종결)
```

`provider_result`에 SELECT를 주지 않은 것이 핵심이다. 원문을 남기는 데 읽기는
필요 없고, 주면 정책 결함 하나가 전 테넌트의 Provider 원문(개인정보가 들어오는
바로 그 필드)을 노출한다. **권한 부재는 정책 결함으로 뚫리지 않는다.**

정직하게 적어 둘 대가: `provider_job`에 한해 보장의 **종류**가 "권한 없음"에서
"권한 있음 + 정책 필터"로 약해졌다. 대체 단언이 더 날카롭지만(테넌트를 세운
경로까지 0행을 증명한다) 내성은 권한 부재 쪽이 강하다.

## 5. 검증

```
$ pnpm build / typecheck / lint / format:check      PASS
$ pnpm validate:contracts / :intake / :handoff      PASS
$ pnpm db:data-dictionary → git diff                드리프트 없음 (63 tables, 613 columns)

$ pnpm test   (skip 0)
  web 28 · domain 170 · db-integration 159 · provider-adapters 199 ·
  hwpx-engine 426 · api 398 · worker 64 · contract 237 · e2e 13
```

CC-220이 더한 것: 도메인 23, UNI 어댑터 37, 워커 e2e 8, API e2e 18,
계약 게이트 13, 통합 회귀 4(워커 권한 경계).

마이그레이션 27→30, 테이블 63 유지.

## 6. 이 항목이 닫지 않은 것

ADR-36 수용 한계 10건이 정본이며 그중 운영에 직접 걸리는 셋:

1. **실 UNI 호출이 한 번도 검증되지 않았다**(OB-13). mock이 검증하는 것은
   UNE 쪽 상태기계뿐이다.
2. **워커가 업로드 중에 죽으면 문서와 잡이 갇힌다** — 복구 경로가 없다.
   초판 ADR은 "UNE-KNOW-003으로 판단한다"고 적었으나 `UPLOADING`은 409다.
   리스 만료(0021 `export_job` 선례) 또는 관리자 재시도가 필요하다.
3. **OB-17이 그대로다** — 워커가 `SET ROLE`을 할 수 없으면 이 파이프라인도
   돌지 않는다. 이 항목의 모든 테스트는 superuser로 접속해 강등하므로
   그 사실을 구조적으로 잡지 못한다.

그 밖에 참조요약 폴링 미구현, PROCESSING_TIMEOUT 화면 표시 없음, 취소 API
없음, 설계 08 §1.14 backoff가 운영 경로에 없음, 재시도가 파일을 다시 검사하지
않음, 업로드 바이트를 `file_object.sha256`과 대조하지 않음.
