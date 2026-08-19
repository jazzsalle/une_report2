# Session Handoff

- 일시: 2026-08-19 (회사 PC, 열 번째 세션 — **전면 재구축**)
- 브랜치: `feature/CC-410` (커밋 `448eab9` = POC 추가, 그 다음 커밋 = 구 구현 제거)
- 상태: **POC 동작. 개발팀 인계 가능.**

## 무슨 일이 있었나

사용자가 기존 구현(NestJS+Postgres+RLS+Outbox, ADR 51개)이 의도에서 벗어났다고 판단하고 **전부 새로 만들라**고 결정했다(00:00). 보안·DB·Docker·Supabase 전부 빼고 로컬 POC. 08:00 마감은 넘겼으나(권한 프롬프트로 여러 번 중단) 오후에 전 흐름 동작을 확인했다.

구 코드는 `git` 이력에만 있다. 복구하려면 `git checkout 448eab9 -- services packages ...`.

## 지금 있는 것 — `apps/poc/`

`pnpm dev` 한 줄 → 서버 :3100 + 웹 :5300. 상세는 `apps/poc/README.md`.

| 축 | 동작 확인 (브라우저 + API) |
|---|---|
| 템플릿 스타일 분석 | 6종 HWPX → 개요 4~5수준·기호·글꼴·크기·굵기 프로파일 화면 |
| 계획서 | 기준정보 → **T3Q 목차**(17초, 5장 21절) → **T3Q 초안**(절당 17초, 근거 10건) → 문단 클릭 → **유니 수정**(🔒·이력·복원) → HWPX 내보내기 → rhwp 재로드 뷰 |
| 상황일지 | 훈련상황 생성 + **유니 챗봇 질의**(7단계 절차, 근거 문서 인용, "근거 없음" 구분) → **유니 SOP**(uni-sop-2 매핑, END 합성) → 캔버스 → 임무 8건 전파 → 모바일 수신확인·완료보고 → 상황판(지연 자동판정) → 일지 8절(사실 5 + AI 3) → HWPX 7쪽 |
| 연동 | 계획서→훈련 프리필(LINK-01), 훈련 결과→계획서 "개선" 절 삽입(LINK-02), 계획서 목록 훈련 배지(LINK-03) |
| 폴백 | 유니·T3Q 실패 시 `server/src/mock/*` 재생, 홈에 연동 상태 표시 |

## 이번 세션에 실측으로 알아낸 것 (코드 주석에도 있음)

- **T3Q가 살아 있다.** `T3Q_VERIFY_TLS=0` 필요. `targetAudiences` 열거 4개. content는 섹션 단위 SSE.
- **유니 `/chat/json` 형식이 CC-410 때와 다르다** — `{"__compn__": {...}}` 래핑 + `__status__` + `[DONE]`. 매퍼가 둘 다 받게 고쳤고 mock도 갱신.
- **유니 로그인 429** — 짧은 시간에 반복 로그인하면 막힌다. 토큰 재사용으로 해결.
- rhwp: `insertParagraph(0, count)`가 끝에 추가. 새 문단은 직전 문단 paraShape(정렬) 상속. 문단 0의 표·그림·머리말은 `deleteText`로 안 지워짐 → `deleteControlAt`. `HwpViewer` 만든 뒤 같은 doc export하면 null pointer.
- `tsx watch`·배경 실행이 Windows에서 조용히 죽는다 → `start.cmd`(`start /min cmd /c`)로 분리. `pnpm dev`(concurrently)는 정상.
- Vite `--host` 없이 띄우면 IPv6만 바인딩돼 `127.0.0.1`로 안 열린다.

## 남은 것 / 다음 세션

1. **상황일지 기능정의서 v1.1 docx**를 개발팀에 전달 (사용자 확인 후).
2. SOP 생성 60~80초 동안 `__status__`(searching/reranking/generating) 프레임을 화면에 흘리면 체감이 낫다.
3. 계획서 "나머지 초안 작성"은 절당 17초 × 21절 ≈ 6분 — 데모 전에 미리 생성해 둘 것.
4. 일지 HWPX는 상황보고 템플릿(5수준 □○-○※)으로 나간다. 다른 템플릿을 고르는 UI는 없다(코드에서 `templates.where(/상황보고/)`).
5. `@rhwp/editor`는 외부 studio라 인터넷 없는 환경에선 "에디터 로드 실패"가 뜬다 — 의도된 안내.
6. 유니 `UNI_PASSWORD` 교체는 여전히 권고(422 에코 결함, CC-410 때부터).
7. 데모 데이터: `apps/poc/data/*.json`에 계획서 5건·훈련 3건이 남아 있다. 깨끗이 시작하려면 `data/*.json` 삭제 후 재기동(템플릿은 자동 재등록).

## 환경 재개

```bash
git checkout feature/CC-410 && git pull
pnpm install
pnpm dev            # 서버 :3100 + 웹 :5300
# 또는 apps\poc\start.cmd / stop.cmd
```

`infrastructure/.env`에 `UNI_BASE_URL=http://10.20.10.101:8088`, `UNI_USERNAME`, `UNI_PASSWORD`, `T3Q_VERIFY_TLS=0`. 집 PC엔 이 파일이 없으니 다시 채울 것.
