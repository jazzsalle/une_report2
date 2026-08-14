# CC-410 — 실 UNI 계약 결속과 매핑 확정

- Work Item: **CC-410** (Bind actual UNI contracts and finalize mapping, G5)
- 결정 정본: **ADR-50**
- 측정일: **2026-08-14** (회사 PC, 사내망에서 `http://221.147.100.161:8000` 왕복 ~20ms)
- 상태: **부분 완료.** 인수기준 넷 중 셋 충족, 하나(SSE reconnect)는 provider가
  지원하지 않아 충족 불가. 잔여 작업은 §7.

## 1. 무엇이 실측됐는가

라이브 `/openapi.json`이 열려 있었다(FastAPI 생성본, `UNI RAG System` v1.1.0,
26개 오퍼레이션). 번들 스냅샷(`uni-rag-adapter-v1.1.0-une1.yaml`)은 25개 응답이
모두 `additionalProperties:true`였지만, 라이브 스펙은 **요청 본문 스키마를 실제
필드명으로** 가지고 있었다. 여기에 실호출을 더해 OB-13·OB-04의 미지수를 닫았다.

| 미지수 | 실측값 | 방법 |
|---|---|---|
| OB-13 ① multipart 파일 필드명 | **`file`** (`uploader`·`force`는 쿼리) | 라이브 스펙 + 실업로드 200 |
| OB-13 ② 로그인 토큰 필드명 | **`token`** (+ `user` 객체) | 실호출 200 |
| OB-13 ③ `/search/` 규격 | 요청 `{query, top_k}` / 응답 `{results:[{filename, score, text, doc_id}]}`, score **0..1** | 실호출 200 |
| OB-13 ④ TLS | 여전히 평문 http | 라이브 스펙 |
| OB-04 ① SSE 프레이밍 | **UNE 가정이 맞았다** — `data: {JSON}\n\n`, `event:` 없음, 키가 이벤트 이름, `[DONE]` 리터럴 | 실스트림 3표본 |
| OB-04 ② 요청 본문 필드명 | `{query, model_key?, top_k}` | 라이브 스펙 |
| OB-04 ③ `doc_ids` 문서 범위 지정 | **존재하지 않는다** | 라이브 스펙 (검색·생성 양쪽) |
| OB-04 ④ 담당 자리 | **있다** — `receiveOrgnztSns`/`receiveUserSns` (3표본 모두 빈 배열) | 실스트림 |

## 2. 착수 전에 측정한 것 — 매퍼가 한 노드도 옮기지 못했다

`uni-sop-1`은 **설계 08 §1.11이 적은 필드명**을 "아는 것"으로 취급해 만들어졌다.
실 UNI 3표본으로 대조한 결과:

```
raw.compnSn : 6/6 존재 — 그러나 값이 number(-1)라 문자열 가드에서 탈락
raw.type    : 0/6      → 실제 compnTyCode ("104001"/"104003"/"104005")
raw.name    : 0/6      → 실제 compnSj
raw.task    : 0/6      → 실제 compnAttrbSaveParamsList
raw.branch  : 0/6      → 실제 endCompns (간선을 노드가 직접 들고 온다)
raw.source  : 0/6      → 노드에 없다
```

첫 관문 `MISSING_NODE_KEY`에서 **전량 탈락**한다. 실 UNI가 보내는 것은 절차
그래프가 아니라 **작도 캔버스 스키마**다 — 좌표·너비·높이·글꼴크기·색상·화살표
방향까지 싣는다.

**mock이 이것을 잡지 못한 이유**: CC-240의 mock이 설계의 필드명을 뿜었다.
지어낸 표본은 자기가 세운 가정을 다시 확인할 뿐, 가정이 틀렸다는 것은 영원히
말해 주지 않는다. 그래서 이번에는 **실 응답을 픽스처로 고정했다**
(`packages/provider-adapters/src/uni/__fixtures__/uni-chat-json-sample{1,2,3}.sse`).

## 3. 실측 그래프 (표본 1)

```
compnSn | compnTyCode | compnSj                    | endCompns→
     -1 | 104001      | 호우 침수 상황 발생          | -2
     -2 | 104003      | 침수 정보 수집 및 위기경보 발령 | -3
     -3 | 104005      | 침수 발생 및 위험도 판단      | -4, -5   ← 분기
     -4 | 104003      | 비상 조치 및 대피 유도        | -6
     -5 | 104003      | 평상시 모니터링 유지          | -7
     -6 | 104003      | 사후 복구 및 조치            | -7
```

**`-7`은 끝내 오지 않는다.** `__done__`이 `count: 6`이라고 확인해 주므로 잘린
스트림이 아니다. 표본 2·3에서는 `-6`·`-7` 둘이 매달렸다. 3표본 전부 그랬다 —
UNI의 체계적 동작이다.

## 4. 판단한 것 (정본은 ADR-50)

- **D1 매퍼를 `uni-sop-2`로 올렸다.** 버전이 `sop_version.schema_version`에
  남으므로 기존 데이터는 자기가 `uni-sop-1`로 만들어졌다고 계속 말한다.
- **D2 종료 노드를 세운다**(`END_SYNTHESIZED`). 세우지 않으면 `DANGLING_EDGE`와
  `NO_END`가 함께 서서 **UNI가 만든 모든 SOP가 승인 불가**가 된다. 같은 매퍼가
  노드 키를 고치고 제목을 자를 때와 같은 규칙이다 — 고치되 고쳤다고 말한다.
- **D3 간선을 순번으로 만들지 않는다.** `deriveSequentialEdges`로 일렬로 이으면
  **분기 노드(104005)의 두 갈래가 사라져** 판단 없이 흐르는 절차가 된다.
- **D4 모르는 유형 코드를 거부하지 않는다.** `uni-sop-1`은 거부했다. 유형 코드
  표를 받지 못한 상태에서 거부하면 처음 보는 코드 하나 때문에 사용자는 그 절차가
  있었다는 사실조차 모른다.
- **D5 `uploader`를 보내지 않는다.** 보내면 UNI가 그 문자열을 소유자로 기록하고
  삭제 권한은 JWT `user_name` 또는 대표이사만 갖는다. UNE는 여기에 사용자 UUID를
  넣고 있었다 — 올린 문서를 **영원히 지울 수 없게** 된다(403 실측).
- **D6 실측된 필드명은 기본값이 된다.** `required`로 막아 둔 근거("틀린 기본값으로
  호출하면 UNE의 결함이 UNI의 거절처럼 보인다")가 측정으로 사라졌다.
- **D7 `chunk_id` 기본값을 철회했다.** 실재하지 않는 이름을 두면 "UNI가 안 줬다"와
  "우리가 딴 이름을 봤다"가 구분되지 않는다. 빈 문자열 = 찾지 않는다.

## 5. 실행한 검증

| 무엇 | 명령 | 결과 |
|---|---|---|
| 매퍼 단위(실 픽스처 3표본) | `vitest run src/uni/sop/uni-sop-mapper.test.ts` | **34 통과** |
| provider-adapters 전체 | `pnpm --filter @une/provider-adapters test` | **288 통과 / 7 skip** |
| 계약 | `pnpm --filter @une/contract-tests test` | **452 통과** |
| 워커 SOP e2e | `vitest run src/sop/sop-job.runner.e2e.test.ts` | **14 통과** |
| SOP 슬라이스 e2e | `vitest run src/sop-slice.e2e.test.ts` | **17 통과** |
| 타입·빌드 | `pnpm typecheck && pnpm build` | 통과 |
| 생성 타입 drift | `pnpm generate:contract-types` | 재생성분 커밋됨 |

**⚠ E2E 전체는 비결정적이다.** `execution-log.e2e.test.ts`와
`vertical-slice.e2e.test.ts` (9)가 같은 빌드로 실행마다 갈린다(1실패·4실패·21통과 /
18통과·1실패). **CC-410과 무관한 CC-290의 시계 결함**이며 근거는
`docs/evidence/CC-290-execution-log-and-dashboard.md` §6-9에 있다. 되돌린 상태에서도
같은 확률로 실패한다.

## 6. 보안

- **UNI의 422는 제출 본문을 그대로 에코한다 — 비밀번호를 평문으로.** UNE 어댑터는
  로그인 실패 응답의 본문을 **읽지 않는다**(상태 코드만 문자열로 만든다). 사실원장은
  append-only라 한 번 들어가면 마스킹도 삭제도 못 하므로, 이 성질을 회귀 테스트로
  못박았다(`http-uni-knowledge-adapter.test.ts`).
- 픽스처에서 사내 문서명·발췌·고객사명을 가렸다. **구조는 손대지 않았다** —
  매핑이 보는 것이 구조이므로 가린 자리가 판정에 끼어들지 않는다.
- 측정 중 UNI에 올린 시험 파일 2건이 남아 있다(§7).

## 7. 잔여 작업 — CC-410은 아직 닫히지 않았다

1. **`knowledgeStatus`가 실 UNI에서 동작하지 않는다.** 어댑터가 부르는
   `GET /documents/{doc_id}`가 **라이브 스펙에 없다**(그 경로는 DELETE 전용).
   상태는 목록 `GET /documents/`의 항목에서 오고 어휘도 다르다 — 설계 08 §1.9의
   `QUEUED/PARSING/…`가 아니라 `"참고자료 생성 중"`/`"완료"` + `progress`(0~100).
   가드가 모르는 값을 거부하므로 지금 붙이면 상태 조회가 전부 실패한다.
2. **SSE 재접속(인수기준)은 충족 불가.** `id:`·`retry:`·하트비트가 실측 0줄이라
   Last-Event-ID로 이어받을 수단이 provider에 없다. 재접속 = 전체 재생성.
3. **UNE가 올린 문서를 지울 수 없다.** `DELETE /documents/{doc_id}`는 본문에
   `{account, password}` 재인증을 요구하는데, **`/auth/login`이 200으로 통과시킨
   같은 자격증명을 401 "비밀번호가 올바르지 않습니다"로 거부한다**(실측). 멱등키
   부재와 겹치면 재시도가 지울 수 없는 중복 문서를 공용 색인(2만671건)에 쌓는다.
4. **남은 시험 파일 2건** — `UNE-CC410-TEST-2026-08-14T07-33-27-688Z.txt`
   (uploader=UNE-CC410, 403으로 삭제 불가), `UNE-CC410-TEST-nouploader-…txt`
   (uploader=도상래, 401로 삭제 불가). 대표이사 계정이나 사내 담당자가 지워야 한다.
5. **유형 코드 표를 받지 못했다.** `104001`=START, `104003`=ACTION, `104005`=DECISION은
   3표본에서 위치와 구조로 읽은 것이고 UNI가 알려준 것이 아니다.
6. **근거 추적이 끊겼다.** 노드에 출처가 없고 `__sources__`에도 `doc_id`가 없어
   `SOURCE_OUT_OF_SCOPE` 검사가 아무것도 잡지 못한다. 러너의 대조 코드는 남겨
   두었고, 그것이 지금 무력하다는 사실을 시험으로 고정했다.
7. **`UNI_PASSWORD` 교체 권고** — 422 에코로 세션 기록에 평문이 남았다.
