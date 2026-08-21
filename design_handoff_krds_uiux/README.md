# Handoff: UNE 재난안전 문서플랫폼 KRDS UI/UX

## Overview
`jazzsalle/une_report2` 저장소의 운영 워크스페이스(`apps/web`) 4개 화면을 KRDS(Korea Design System) 기반으로 재설계한 클릭형 프로토타입의 구현 인계 문서입니다.
대상 화면: ① 계획서 생성(6단계 슬라이스, CC-170) ② 전자상황판(CC-290) ③ 상황일지(CC-300) ④ 종료·평가(CC-310).

## About the Design Files
이 번들의 파일은 **HTML로 만든 디자인 레퍼런스**입니다(프로토타입). 그대로 배포하는 코드가 아니라, 대상 코드베이스(React 19 + Vite, `apps/web`)의 기존 패턴 위에 **동일한 화면을 재구현**하기 위한 기준입니다.
- `une-platform.dc.html` — 4화면 통합 프로토타입 (최종안, 레이아웃 옵션 C 채택)
- `plan-option-a/b.dc.html` — 탐색 과정의 대안 레이아웃 (참고용)
- 파일 내 `<x-dc>` 템플릿 마크업과 `data-dc-script`의 로직 클래스를 읽으면 마크업·상태 규칙을 그대로 확인할 수 있습니다. 프리뷰 렌더링에는 별도 런타임이 필요하므로 **코드 리딩용 레퍼런스**로 취급하세요.

## Fidelity
**High-fidelity.** 색·타이포·간격·컴포넌트는 KRDS v1.0.0 킷의 CSS 클래스와 토큰을 그대로 사용했습니다. 픽셀 값을 새로 정의하지 말고 KRDS 킷(`krds-uiux` 킷: `common.css` + `component/output.css` + `token/krds_tokens.css` + 확장 `extended.css`)을 코드베이스에 도입해 클래스를 그대로 쓰는 것을 권장합니다.

## KRDS 의존성 (필수)
- 스타일시트 로드 순서: `fonts.css` → `token/krds_tokens.css` → `common/common.css` → `component/output.css` → `component/extended.css`
- `html { font-size: 62.5% }` 기준 — **1rem = 10px** (아래 모든 rem 값은 이 기준)
- 서체: Pretendard GOV (Regular 400 / Bold 700)
- 아이콘: 킷의 `img/component/icon/*.svg`를 `.svg-icon.ico-*` 클래스로 사용 (새 SVG 금지)
- `extended.css`는 배포 CSS에 없는 `krds-alert`, `krds-infobox`, `krds-progress` 계열을 보충한 파일 — 프로토타입이 이 3계열을 사용하므로 함께 필요

## 공통 골격 (업무시스템형)
- 헤더: 높이 6.4rem, 흰 배경, 하단 0.1rem `#cdd1d5` 실선. 좌측 로고 블록(3.2rem 사각, `#256ef4` 배경, radius 0.6rem, "UNE" 1.4rem Bold 흰색) + "재난안전 문서플랫폼" 1.8rem Bold
- GNB: 텍스트 탭 4개(계획서 생성 · 전자상황판 · 상황일지 · 종료·평가), 1.7rem, 활성 = Bold + `#256ef4` + `inset 0 -0.3rem 0 #256ef4` 하단 바, `aria-current="page"`
- 우측 유틸: "원주시 안전총괄과 · 김민정 주무관" 1.5rem `#464c53` + `krds-btn tertiary xsmall` 로그아웃
- 본문 캔버스: `#f4f5f6`(gray-5), 콘텐츠 최대폭 152rem, 패딩 2.4rem
- 카드 공통: 흰 배경, 0.1rem `#cdd1d5` 테두리, radius 1.2rem, 패딩 2.4rem (그림자 없음)

## Screens / Views

### 1. 계획서 생성 (작업 콘솔형)
- **서브헤더**(흰 띠): 좌측 계획서명(1.7rem Bold) + ID(1.3rem), 우측 **6단계 파이프라인 칩**
  - 칩: 알약형(radius 10rem), 1.3rem, 패딩 0.5rem 1.2rem, 칩 사이 `ico-angle right` 1.4rem(opacity 0.4)
  - 상태: 완료 = ✓ + `#eef7f0` 배경/`#228738` 글자/`#b9dec3` 테두리 · 현재 = 숫자 + `#256ef4` 배경/흰 글자/Bold · 대기 = 흰 배경/`#8a949e` 글자/`#cdd1d5` 테두리
  - 칩 클릭 = 해당 단계로 이동 (자유 이동 허용, 선행조건 미충족은 화면 안에서 사유 안내 — `blockedReason` 패턴 유지)
- **본문 그리드**: `grid-template-columns: minmax(0,2fr) 36rem; gap 2.4rem`
- **좌측(단계별 콘텐츠)** — 단계 제목 2.2rem Bold + API 코드 1.3rem 회색:
  - 1 로그인: 세션 정보 표(`krds-table-wrap > table.tbl.col.data`, caption 필수) — 기관/사용자/인증방식(AUTH_MODE=mock, ADR-22 D3)/세션 시작
  - 2 계획서: 계획서 목록 표 + 우상단 `krds-btn primary small` "새 계획서 만들기", 선택 행 `#eff5ff` 배경 + Bold
  - 3 기준정보: `krds-alert success slim`(Snapshot 확정 고지, 덮어쓰기 불가 문구) + 확정 기준정보 표 + "새 Snapshot 만들기" tertiary
  - 4 HWPX 반입: 파일 카드(`ico-file` 3.2rem + 파일명 1.7rem + `[hwpx, 4.2MB]` 메타) + 분석 결과 표(구조 검증/구성/보존 원칙)
  - 5 목차·본문 생성: 목차 카드(완료 배지 `bg-success`, `<details>`로 목차 펼침) + 본문 생성 카드(`krds-progress large`, `role="progressbar"` + aria-valuenow/min/max, 진행 메시지 "42절 중 26절 생성됨 (62%) · 예상 남은 시간 약 3분")
  - 6 Export: 본문 미완료 시 `krds-alert warning slim` 차단 사유, 완료 시 Export 결과 표(파일명/블록 반영/SHA-256) + `krds-btn primary` 다운로드(`ico-download`)
- **우측 레일(고정)**: "생성 기준" 패널(dl 그리드: 기준정보 Snapshot ID + `bg-light-success` 확정 배지, 반입 문서, 검증 결과, 생성 계약 T3Q RPT-001/002) + "작업 기록" 패널(시각 tabular-nums + 문장, 1.4rem) + Correlation ID(1.2rem) — **Correlation ID는 항상 화면에 노출** (설계 09 필수증거)

### 2. 전자상황판
- 타이틀 행: 상황명 2.2rem Bold + 모드 배지(▲ 훈련 `bg-secondary` / ● 실제 상황 `bg-danger` / ◆ 모의 `bg-gray` — **색만으로 구분 금지, 기호+텍스트 병기**) + 상태 배지 + "실시간 · 10초마다 갱신"(`#228738`) + 우측 마지막 이벤트 시각
- KPI 카드 7개(flex, min-width 11rem): 라벨 1.4rem 회색 + 값 3.2rem Bold. 색: 전체/미전파 `#33363d`, 미수신 `#9d5b00`, 진행 `#256ef4`, 완료 `#228738`, 수행불가/지연 `#d0290e`
- 근거 문구(1.3rem 회색): "이벤트 N건을 발생시각 기준으로 접었습니다…" — 화면이 집계를 재계산하지 않음을 명시
- 그리드 `3fr : 2fr` — 좌: 임무 표(단계/임무/담당/상태 배지/진행/기한, 지연 행 `#fdf2f0` 배경 + 기한에 ⚠), 우: 상황 판 카드(Snapshot v·사실 건수·확정 시각) + 타임라인 리스트(시각 + 이벤트타입 Bold + 상세 + 우측 배지, 행 구분선 `#f1f3f5`)
- 상태 배지 클래스 매핑: 지연 `bg-danger` · 미수신 `bg-light-warning` · 진행 `bg-light-primary` · 완료 `bg-light-success` · 수행불가 `bg-light-danger` · 정정 `bg-light-warning`
- 사실원장 어긋남 경고(조건부): `krds-alert danger slim` — "임무 N건에서 사실원장 재생과 저장된 상태가 다릅니다…"

### 3. 상황일지 (최대폭 96rem 중앙)
- 타이틀 + 상태 배지: 초안 `bg-light-gray` / 검토 중 `bg-light-primary` / 보완 요청됨 `bg-light-warning` / 승인됨 `bg-success`
- 메타 행: 일지 ID · 양식 파일명 · Snapshot 버전 · 사실 해시 앞 12자
- `krds-infobox secondary slim`: "사실칸은 잠겨 있습니다" — 회색 값은 편집·AI 불가, 서술만 수정 가능
- 섹션 카드 3개(피해 현황/조치 사항/향후 계획): **사실 표**(th 32% + td `#f4f5f6` 배경, tabular-nums — 입력 요소 없음) + **서술 form-group**(`form-tit` 레이블 + `krds-input` textarea + `form-hint`에 서술 출처: "사람이 작성함"/"AI 제안을 반영함 (시뮬레이션)"/"아직 작성되지 않음")
- 액션 바(상태별):
  - 초안/보완: [문장 저장 tertiary] [AI 문안 제안 secondary] [검토 요청 primary]
  - 검토 중: 검토자 표시 + [보완 요청 tertiary] [승인 primary]
  - 승인됨: 승인 메타(시각·승인자·사실 해시) + [HWPX로 내보내기 primary + ico-download]
- AI 제안 후 고지: `krds-alert information slim` — "지금 붙어 있는 문안 생성기는 시뮬레이션입니다(OB-03)…"
- 드리프트 경고(조건부, `krds-alert warning slim`) — 상태별 문구 상이 (초안: 사실 갱신 안내 / 검토 중: 승인 대상은 보이는 판 / 승인됨: 새 일지 안내)
- 미승인 시 하단 안내: "승인된 일지만 내보낼 수 있습니다."

### 4. 종료·평가 (최대폭 102.4rem)
- 미결 카드: 제목 "정리할 미결 — 끝나지 않은 임무 2건" + 원칙 문구 "사유 없는 처분은 처분이 아닙니다."
- 미결 행(테두리 박스, grid 1fr:1.2fr): 좌 임무 정보(제목 1.6rem Bold + TASK ID·진행률·담당 1.3rem), 우 `form-group` 처분 사유 입력
- 종료 버튼: **모든 waivable 미결에 사유(2자 이상)가 있어야 활성화.** 상태 문구: 미충족 "N건에 사유가 없습니다…"(`#9d5b00`) / 충족 "모든 미결에 사유를 적었습니다…"(`#228738`)
- 평가 지표 카드 4개(임무 달성률/평균 수신확인/평균 완료 시간/정정 이벤트): 값 2.8rem Bold + 부가설명 1.3rem. 헤더에 "산출 시점 … · 자동으로 갱신되지 않습니다" 명시 (ADR-45 D4: 화면이 재계산 금지)
- 만족도 미수집 사유를 같은 문구로 표기: "수집하지 않았습니다 — …"
- 종료 후: "평가 확정" primary (확정된 평가는 수정 불가 고지) → 확정 후: 확정 메타 + [평가서 내려받기 tertiary]

## Interactions & Behavior
- GNB 클릭 = 화면 전환(SPA 상태), 파이프라인 칩 클릭 = 단계 전환
- 본문 생성 완료 → 6단계 Export 활성화 (미완료 시 primary 버튼 disabled + 6단계에 차단 사유)
- 상황일지 상태기계: DRAFT → (검토 요청) REVIEW → (승인) APPROVED / (보완 요청) CHANGES_REQUESTED → 재편집. 검토 중·승인됨에서는 textarea disabled
- 종료·평가: 사유 입력 검증(2자 이상) → 종료 → 평가 확정 (단방향, 되돌리기 없음)
- 전자상황판 10초 폴링 + 마지막 갱신 시각 노출(실서비스, 원본 `SituationBoard.tsx` REFRESH_MS 유지)
- 모션 없음(KRDS 원칙) — progress bar `width 0.2s ease-out`만 허용

## State Management (원본 코드 매핑)
- 계획서 생성: `apps/web/src/slice/state.ts`의 `STEPS`·`blockedReason`·`isJobOpen` 재사용 — 프로토타입 파이프라인 칩 = STEPS 배열
- 전자상황판: `board/board-state.ts`의 `kpiCards`·`sortBoardTasks`·`provenanceNote`·`divergenceWarning` 그대로 — 화면 재계산 금지 원칙 유지
- 상황일지: `journal/journal-state.ts`의 `journalActions`·`driftBanner`·상태 라벨 매핑 그대로
- 종료·평가: `evaluation/evaluation-state.ts`의 `closeReadiness`·`groupBlockers`·`metricsNotice` 그대로

## Design Tokens (KRDS)
- Primary `#256ef4` (primary-50) · hover `#0b50d0`(60) · pressed `#083891`(70)
- 텍스트 basic `#1e2124`(gray-90) · subtle `#464c53`(gray-70) · 비활성 `#8a949e`
- 상태색: success `#228738` · warning 텍스트 `#9d5b00` · danger `#d0290e`/`#de3412` · 지연 행 배경 `#fdf2f0` · 완료 칩 배경 `#eef7f0`
- 표면: 흰색 + gray-5 `#f4f5f6` 2톤만 · 테두리 `#cdd1d5`(gray-30) · 행 구분선 `#f1f3f5`
- radius: 카드 1.2rem · 박스 0.8rem · 로고 0.6rem · 칩/배지 10rem(max)
- 간격: 카드 패딩 2.4rem(작은 패널 2rem) · 그리드 gap 2.4rem · 요소 gap 0.8/1.2/1.6rem
- 타입 스케일: 화면 제목 2.2rem / 카드 제목 1.9rem / 본문 1.7rem / 보조 1.5rem / 메타 1.3~1.4rem / 캡션 1.2rem — 숫자 강조 3.2rem(KPI)·2.8rem(지표)
- 숫자·날짜 표기: `2026. 8. 20. 16:42` · 파일 `[hwpx, 4.2MB]` · 수치는 `font-variant-numeric: tabular-nums`

## Assets
- 아이콘: KRDS 킷 SVG만 사용 — `ico-information-fill`, `ico-success-fill`, `ico-error-fill`, `ico-file`, `ico-download`, `ico-angle right`. 장식용은 `aria-hidden="true"`
- 이미지·로고 없음 (로고 자리는 색 블록 + 텍스트)

## Accessibility
- 모든 표에 `caption` + `scope`, progress에 `role="progressbar"` + aria-value*, 현재 메뉴 `aria-current="page"`, 모드 배지는 기호+텍스트 병기(색맹 대응), 아이콘 단독 사용 금지

## Files
- `une-platform.dc.html` — 최종 4화면 프로토타입 (마크업 + 상태 로직)
- `plan-option-a.dc.html` / `plan-option-b.dc.html` — 계획서 생성 화면 대안 레이아웃 (탐색용, 미채택)
