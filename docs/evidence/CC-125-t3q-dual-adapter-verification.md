# CC-125 검증 증거 — Dual Legacy/Target-v2 T3Q Plan 어댑터

- 일자: 2026-08-02 (집 PC, 로컬 PostgreSQL 16 @ 15432/WSL2)
- 브랜치: feature/CC-125 (base: main d484a6b = PR #7 머지)
- 결정 기록: ADR-26 (D1~D11 + 수용 한계)

## 수용기준 대응

| AC | 구현 | 증거 |
|---|---|---|
| one T3qPlanProvider port | `t3q-plan-port.ts` — op 어휘 완비 + TocCapable/ContentCapable 믹스인 + `T3qPlanResult<T>` 봉투, `T3qTocPort` 흡수·삭제 | 포트 계약 테스트 10종(어댑터 3종 동형·supports↔레지스트리 동기) |
| legacy adapter current RPT-001/002 | `LegacyT3qPlanAdapter`(실 HTTP, undici 분리 타임아웃, fail-closed 설정, 재시도·CB) + RPT-002 전송·매핑·가드·SSE 파서 | 픽스처 서버 20케이스 + 워커 e2e legacy-http 전 여정 |
| target-v2 adapter mock | `TargetV2T3qPlanAdapter` — tocV2 202→폴링→COMPLETED, in-process 결정적 전송기 | v2 어댑터 테스트 8종 + 워커 e2e v2 여정(실 job 컨텍스트 바인딩) |
| feature-flag selection | `UNE_T3Q_PLAN_ADAPTER` env + `createT3qPlanProvider` 순수 팩토리; 구 변수 하드 실패; prod+mock 차단 | worker-config 음성 9종 |
| raw payload and mapping version | 결과값 단위 adapterId/mappingVersion/httpStatus; 가드 위반 raw 유실 시정; provider.requested 발행 | 워커 e2e provider.* 이벤트 단언 + raw 보존 회귀 |

## 게이트 실행 결과 (전부 이 세션에서 실행)

| 게이트 | 결과 (이중 리뷰 반영 후 최종 실행) |
|---|---|
| `pnpm --filter @une/provider-adapters test` | 67/67 (9 files; 픽스처 서버 22 — 403/503 추가, CB 4, SSE 7, v2 10 — live 음성 2 추가, 위생 1 포함) |
| `pnpm --filter @une/domain test` | 35/35 (ContentDraft 4 신규) |
| `pnpm --filter @une/contract-tests test` | 38/38 (포트 계약 11 — MOCK RUNTIME 표시 단언 추가; CR-T3Q-* 불변식 1 신규; 갭 매트릭스 드리프트 5 회귀) |
| `pnpm --filter @une/worker test` | 24/24 (config 13, e2e 10 — legacy-http 여정·가드 위반 raw 보존·v2 여정 3 신규) |
| `pnpm --filter @une/db-integration test` | 51/51 (0016 신규 10 + 기존 41; 한계 핀 반전 포함) |
| `pnpm --filter @une/api test` | 175/175 (0016 + 포트 교체 후 회귀) |
| `pnpm db:migrate` (0016) | 적용 완료 — 4테이블 relrowsecurity=t/relforcerowsecurity=t, 정책 각 1건 |
| `pnpm db:data-dictionary` | 재생성, 드리프트 없음(QA가 md5 2회 동일 확인) |
| `pnpm validate:contracts` | PASS — 예제 12건(+2), 면제 3→2, 전사본 SHA-256 핀 불변 |
| `pnpm generate:contract-types` | 재생성 후 git diff 없음(예제-only 변경의 기대 결과) |
| `pnpm build` / `typecheck` / `lint` / `format:check` | 전부 PASS |
| `python scripts/validate_handoff.py` | PASS (420 files) |
| `python -m pytest tests/baseline` | 6 passed |

## 핵심 검증 포인트

### 1. CC-120 raw 유실 결함 시정 (ADR-26 D2)
CC-120 러너는 응답 가드 throw 시 `finalizeFailed(..., undefined)`로
rawResponse를 유실했다. 이제 어댑터가 가드 예외를 잡아
`T3Q_RESPONSE_CONTRACT_VIOLATION` 실패값에 raw를 동봉한다. 워커 e2e
"guard violation: FAILED with rawResponse preserved"가 provider.failed
이벤트의 `rawResponse.title` 실재를 단언(회귀 고정).

### 2. OB-01 fail-closed (추정 0건)
- base URL 미설정 / auth 모드 미설정 / header 모드 이름·토큰 누락 /
  구 변수 사용 / prod+mock → 전부 기동 실패 (음성 테스트 9종).
- 타임아웃 5s/60s는 UNE 기준선 명시(코드·env.example·ADR 3곳).
- 응답 수신 후 재전송 금지: "post-response 500 is NOT resent" 케이스가
  요청 횟수 1을 단언(레거시 멱등키 부재 — 갭 매트릭스 §3).
- TLS 비활성 토큰 부재를 t3q/plan 트리 전체에 정적 단언.

### 3. 비밀 위생
- raw에 전송 헤더를 담지 않는 설계 + 토큰 문자열이 성공/실패 결과 및
  provider.requested/responded 이벤트에 없음을 어댑터·워커 e2e 양쪽에서
  단언. `.env` 파일 무변경·미커밋(env.example만 플레이스홀더로 갱신).

### 4. 0016 자식 테이블 RLS (ADR-25 D2 종결)
- 디스패치 스코프에서 job_event/toc_version/plan_context_snapshot/toc_node
  접근 불가(기존 "알려진 한계 핀" 테스트 반전).
- SSE 조회 EXPLAIN: `Bitmap Index Scan on uk_job_event_seq` 유지, job_event
  Seq Scan 부재(60 job × 120 event 실측 0.092ms). 부모 확대 시 폴백 특성은
  0016 헤더 주석에 기록.

### 5. capability 과대표시 차단
- legacyToc만 UNE_ADAPTER_READY(구현∧워커 결선∧live spec). legacyContent는
  파이프라인 미결선(CC-130), tocV2는 계약 미수락(OB-10)으로 MOCK_ONLY 유지.
- 신규 거버넌스 불변식: CR-T3Q-* 항목은 OB-10/11 OPEN 동안 MOCK_ONLY 고정.
- 기동 로그가 `describeCapability()` 원문 출력 + legacy-http에도
  "provider 미검증(OB-01)" 경고(AT-T3Q-012).

### 6. v2 요청 기계 검증
`toTocGenerationRequest` 출력이 `TocGenerationRequest` 스키마(ajv 2020-12,
`unevaluatedProperties:false`)를 통과하고, 오탈자 필드 주입 시 실패함을
음성으로 고정 — 레거시 전사본이 구조적으로 못 주던 검출의 회수.

## 이중 리뷰 (병렬, opus — 당일 전건 반영)

**architecture-guardian: BLOCKER 0 / MAJOR 3 / MINOR 11.**
- **M1** ContentDraft "legacy∩v2 도출" 주장 과대 → ADR-26 D4 서술 정정
  (legacy 형상의 도메인 승격) + ContentCitationDraft에 v2 provenance 슬롯
  (sourceId/documentId/chunkId/score/retrievedAt) 예약, legacy 어댑터는
  미기입.
- **M2** mock 플레이스홀더의 실 provider 차단이 기제가 아니었음 → 포트에
  `runtimeMode`('mock'|'live', v2는 전송기 실체로 판정) 도입, 워커 주입
  조건을 `variant==='target-v2' && runtimeMode==='mock'`로 축소, 어댑터가
  live transport에서 `une-mock:` 접두 감지 시 `T3Q_REQUEST_REJECTED`
  fail-closed. 음성 2종(live+플레이스홀더 → 거부, live+무플레이스홀더 →
  바인딩 결여 거부) 고정.
- **M3** mock 인스턴스가 UNE_ADAPTER_READY 표시 → `describeRuntimeCapability`
  신설(등록 상태 + 인스턴스 런타임 모드 합성; mock이면 항상 "MOCK RUNTIME"
  표기), 워커 기동 로그 교체, 계약 테스트로 고정.
- MINOR 11건 반영: provider.requested에 `phase:'intent'`(사전 의도 기록임을
  명시) + 전송 정보를 config가 아닌 어댑터 `transportProfile`에서 취득 /
  0016 이후 낡은 RLS 주석 2곳 정정 / validateContentDrafts를 legacy content
  경로에 결선 / jobStatus 레지스트리 notes 사실화 / v2 requestId를 시도별
  `jobId#attemptNo`로(재시도=신규 생성) / v2 계약 description에 편집 로그 /
  루트 .env.example 전사본 host 경고 / SESSION_HANDOFF 전면 갱신(구 변수
  해금 지시 제거) / 본 증거 문서 리뷰 결과 기재 / v2 폴링 예산-lease 관계
  주석(CC-135 재산정).

**qa-gate-reviewer: PASS WITH CONDITIONS.**
- 주장 수치 **전부 독립 재현**(표의 모든 스위트 + validate:contracts +
  타입 드리프트 + 데이터 사전 md5). 커버리지 매트릭스 충족 판정(결함 12종,
  재시도 4경로, CB 7, 설정 음성 10종, 0016 음성·핀 반전, 비밀 위생, 전사본
  무변경, 예제-only diff, ADR-구현 일치, T3qTocPort 잔존 참조 0).
- 필수 F1(브랜치 커밋 0건) → 본 커밋으로 해소.
- 권고 반영: R1 SESSION_HANDOFF 갱신, R2 본 문서 수치 오기 정정, R3
  503 재전송 분기·403 테스트 추가. R4(실 HTTP 동시성 실증)는 ADR-26 수용
  한계와 일관 — CC-400 실증 대상으로 유지, R5는 phase:'intent'로 반영,
  R6(무DB 조용한 skip)은 SESSION_HANDOFF Risks에 기재.

## 알려진 한계 (ADR-26 수용 한계)

provider 중복 실행 가능성(멱등키 부재, 리스 하한으로 UNE 창만 제거),
SSE 프레이밍 UNE 가정, CB 프로세스 로컬, documentId/baseRevisionId mock
플레이스홀더(CC-150), generationOption v2 미매핑(CC-130 재평가).
