# Session Handoff

- 일시: 2026-08-21 (회사 PC, 열한 번째 세션 — 2026-08-20~21 이틀치)
- 브랜치: `feature/CC-410`, **main과 동일**(PR #32~#41 모두 머지, 마지막 `f1178f2`). 작업 트리 깨끗함.
- 상태: **POC 동작. 개발팀 인계 가능.** 서버는 이 PC에서 숨김 프로세스로 떠 있음(:3100 API, :5300 웹; `http://10.20.20.46:5300/`).

## 이번 세션에 한 일 (PR 순)

| PR | 내용 |
|---|---|
| #32~#34 | KRDS 디자인 시안(`design_handoff_krds_uiux/poc-plan/`) → 계획서·상황일지·홈·모바일 화면에 적용(`web/src/krds.{css,tsx}`, `ui.tsx` 재스킨). HWPX 다운로드·내보내기는 "다른 이름으로 저장" 창(`showSaveFilePicker`, https/localhost만; 아니면 일반 다운로드) |
| #35 | HWPX 내보내기 충실도: 템플릿 견본 구간만 교체, 제목 표 칸 교체, 수준별 charShapeId/paraShapeId 복사(글꼴은 `applyCharFormat`으로 안 바뀜), 깨지던 rhwp 재로드 뷰 제거 |
| #36 | 템플릿 **표 스타일** 분석·적용(머리행/첫 열/본문 셀 모양·열 너비) |
| #37 | 기준정보 템플릿 목록 페이지(`/plan/basis-templates`: 정렬·N개 보기·페이지·이름 변경·삭제) + 상세/편집 페이지, `PUT /api/plan-templates/:id` |
| #38 | 초안: 체크한 절만 동시 3절 생성, 하위 목차 있는 장은 제목만(`draftable`), 항목 기호는 제목 깊이에 **상대적** |
| #39 | 계획서 메인에 2차년도 홈 화면 구도 — **Figma `.fig`를 직접 해독**해 배경 이미지·재난유형 아이콘 10종(벡터→SVG) 추출(`web/public/hero/`, `HeroCards.tsx`) |
| #40 | 히어로 여백 축소, 문서 목록 정렬·30/50/70/100개·페이지 바, 기준정보 템플릿에 재난유형 아이콘 |
| #41 | **T3Q 기호 문제 해결**(아래) + 원본 미리보기 HTML→**SVG**, 템플릿 꼬리 빈 표 제거(프로파일 version 2) |

## 실측으로 알아낸 것 (코드 주석에도 `실측 2026-08-21`로 있음)

- **T3Q `paragraphSymbol`은 콤마로 구분해 보내야 한다.** `"□○-"`·`"□ ○ -"`는 줄마다 `□○- (소제목) 문장` 통째 기호(위계 없음), **`"□, ○, -"`** 는 `□ 문장`/`  ○ 문장`/`    - 문장` 3단 위계. 번호형(`1.` `가.`)을 섞어 보내면 T3Q가 가나다 순번을 스스로 매긴다. 요청은 절 아래 수준의 비번호 기호만(`t3qSymbolsFor`), 변환은 `t3qContentToMarkdown`(예전 응답 형식도 정리, 멱등, 서버 기동 시 옛 저장본 1회 정리).
- 번호형 기호(`가.` `1.` `①`)는 웹·HWPX가 형제끼리 **가·나·다 자동 매김**(`formatNumbering`, 양쪽 동일 구현). 텍스트가 이미 번호면 생략.
- rhwp `renderPageSvg`는 원본과 같게 나오고 `renderPageHtml`은 제목 표·표가 깨진다 → 미리보기는 전부 SVG(`renderHwpxSvg`). 한글→PDF 스냅샷 불필요. 단, SVG 렌더에서 쪽 경계에 걸친 표의 아랫줄이 비어 보일 수 있음(파일 안 셀 텍스트는 정상 — 확인함).
- rhwp `applyCharFormat fontFamily` 무시 → `setCharShapeId` 복사. 표 셀 API(`insertTextInCell`/`setCellProperties`/`setTableProperties`/`getTableDimensions`/`getCellInfo`) 모두 동작·저장됨.
- Figma `.fig` = zip(`canvas.fig` + images/). `canvas.fig`는 zstd 청크 + kiwi 스키마 → Node `zlib.zstdDecompressSync` + `kiwi-schema`로 해독. 벡터는 `u8 명령 + float32` 블롭 → SVG path. (메모리 `figma-fig-decode`)
- multer 파일명은 latin1 → `Buffer.from(name,'latin1').toString('utf8')`. Git Bash `curl -d`에 한글 넣으면 깨짐 → 항상 UTF-8 파일로 `--data-binary @file`.
- 서버는 Claude Code 도구로 띄우면 호출이 끝날 때 죽는다 → PowerShell WMI `Win32_Process.Create`(숨김 창) + exit 로그 래퍼(`data/server-exit.log`). 원인 미상으로 가끔 더 죽기도 함 — 재기동 전 `data/server.log` 먼저 읽을 것. (메모리 `poc-server-detached-launch`)

## 운영 규칙 (사용자 결정)

- `bypassPermissions` 같은 권한 우회 설정은 **절대 커밋하지 않는다**. 디자인 폴더는 디자인이 끝난 뒤에만 올린다.
- 푸시는 Claude가 하고, **PR 생성·머지는 사용자가 `! gh pr create --fill --base main` / `! gh pr merge N --merge`** 로 한다(`!` 앞에 공백이 있으면 실행되지 않음).
- `*.fig`는 gitignore. 변환된 에셋만 `web/public/hero/`.

## 남은 것 / 다음 세션

1. 상황일지(`/sit`) 메인에도 히어로 구도를 적용할지 결정. 문서 목록 재난유형 열에 아이콘 붙이기는 `HazardIcon`으로 바로 가능.
2. 기준정보 템플릿 샘플 5개("(샘플)")는 데모용 — 필요 없으면 목록에서 삭제.
3. 데모 전 초안 미리 생성(절당 15~20초, 동시 3절). T3Q가 429를 내면 `PlanEditor.tsx`의 `CONCURRENCY`를 낮출 것.
4. 상황일지 기능정의서 v1.1 docx 개발팀 전달(사용자 확인 후). SOP 생성 중 `__status__` 표시, 일지 템플릿 선택 UI는 예전부터 남은 항목.
5. 유니 `UNI_PASSWORD` 교체 권고 유지. 유니 타임아웃은 간헐적(10.20.10.101:8088) — 반복되면 `uni.ts` 타임아웃 조정.

## 환경 재개

```bash
git checkout feature/CC-410 && git pull
pnpm install
pnpm dev            # 서버 :3100 + 웹 :5300 (수동 실행이 가장 안정적)
```

`infrastructure/.env`에 `UNI_BASE_URL=http://10.20.10.101:8088`, `UNI_USERNAME`, `UNI_PASSWORD`, `T3Q_VERIFY_TLS=0`. 집 PC엔 이 파일이 없으니 다시 채울 것. 템플릿 프로파일은 기동 시 `version`이 낮으면 자동 재분석, T3Q 옛 저장본도 기동 시 자동 정리된다.
