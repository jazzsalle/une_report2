// 계획서 생성 도구(/plan) KRDS 디자인 아트보드 생성기.
// 실행: node build.mjs  → *.dc.html + canvas.json 을 이 폴더에 쓴다.
// 공통 골격(헤더·GNB·작업 콘솔 띠·토큰)은 design_handoff_krds_uiux/README.md 를 따르고,
// 화면 구성은 apps/poc/web/src/plan/*.tsx 의 현재 POC 흐름을 따른다.
import { writeFileSync } from 'node:fs';

// ── 아이콘 (KRDS 킷 SVG 대체: 2rem 그리드, stroke 기반) ────────────────────
const I = {
  check: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>',
  angle: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.5 4l6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.5 4l-6 6 6 6"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
  download: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3v10M6 9l4 4 4-4M4 16h12"/></svg>',
  upload: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13V3M6 7l4-4 4 4M4 16h12"/></svg>',
  lock: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="9" width="11" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>',
  refresh: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 10a6 6 0 1 1-1.8-4.3"/><path d="M16 3v4h-4"/></svg>',
  play: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6 4.5v11l9-5.5z"/></svg>',
  search: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="M13.5 13.5L17 17"/></svg>',
  print: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7V3h8v4"/><rect x="3" y="7" width="14" height="7" rx="1.5"/><path d="M6 12h8v5H6z"/></svg>',
  external: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4H4.5A1.5 1.5 0 0 0 3 5.5v10A1.5 1.5 0 0 0 4.5 17h10a1.5 1.5 0 0 0 1.5-1.5V12"/><path d="M11 3h6v6M17 3l-8 8"/></svg>',
  plus: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12"/></svg>',
  close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>',
  infoFill: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM11 14H9V9h2z"/></svg>',
  successFill: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm-1.2 12.3L5 10l1.4-1.4 2.4 2.4 4.8-4.8L15 7.6z"/></svg>',
  errorFill: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9 5h2v6H9zm1 9.3a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"/></svg>',
  spark: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8z"/></svg>',
  chevDown: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7.5l5 5 5-5"/></svg>',
};

// ── 공통 스타일 (KRDS v1.0.0 토큰 값을 README 그대로 사용, 1rem = 10px) ──
const CSS = `
:root{--primary:#256ef4;--primary-60:#0b50d0;--primary-70:#083891;--text:#1e2124;--subtle:#464c53;--disabled:#8a949e;--border:#cdd1d5;--line:#f1f3f5;--surface:#f4f5f6;--success:#228738;--success-bg:#eef7f0;--success-bd:#b9dec3;--warn:#9d5b00;--warn-bg:#fff8e1;--warn-bd:#ffe0a3;--danger:#d0290e;--danger-bg:#fdf2f0;--danger-bd:#f4c2b8;--info-bg:#eff5ff;--info-bd:#c2d6ff}
html{font-size:62.5%}
*{box-sizing:border-box}
body{margin:0;font-family:"Pretendard GOV","Pretendard","Noto Sans KR","Malgun Gothic","맑은 고딕",sans-serif;font-size:1.7rem;line-height:1.5;color:var(--text);background:var(--surface);-webkit-font-smoothing:antialiased}
a{color:#256ef4;text-decoration:none}a:hover{color:#083891}
h1,h2,h3,p,ul,ol,dl,figure{margin:0}
button{font-family:inherit}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.wrap{max-width:152rem;margin:0 auto;padding:0 2.4rem}
.hdr{background:#fff;border-bottom:0.1rem solid var(--border)}
.hdr-in{display:flex;align-items:center;gap:3.2rem;height:6.4rem}
.logo{display:flex;align-items:center;gap:1rem}
.logo-mark{display:inline-flex;align-items:center;justify-content:center;width:3.2rem;height:3.2rem;border-radius:0.6rem;background:#256ef4;color:#fff;font-size:1.4rem;font-weight:700}
.logo-tit{font-size:1.8rem;font-weight:700;white-space:nowrap}
.gnb{display:flex;gap:0.4rem;align-self:stretch}
.gnb a{display:flex;align-items:center;padding:0 1.6rem;font-size:1.7rem;color:#464c53;white-space:nowrap}
.gnb a[aria-current="page"]{color:#256ef4;font-weight:700;box-shadow:inset 0 -0.3rem 0 #256ef4}
.util{margin-left:auto;display:flex;align-items:center;gap:1.2rem;font-size:1.5rem;color:var(--subtle);white-space:nowrap}
.band{background:#fff;border-bottom:0.1rem solid var(--border)}
.band-in{display:flex;align-items:center;gap:2.4rem;min-height:5.6rem}
.lnb{display:flex;gap:0.4rem;align-self:stretch}
.lnb a{display:flex;align-items:center;padding:0 1.6rem;font-size:1.5rem;color:#464c53;min-height:5.6rem}
.lnb a[aria-current="page"]{color:#256ef4;font-weight:700;box-shadow:inset 0 -0.3rem 0 #256ef4}
.console{display:flex;align-items:center;gap:2rem;padding:1.2rem 2.4rem;flex-wrap:wrap}
.console .back{display:inline-flex;align-items:center;gap:0.2rem;font-size:1.4rem;color:var(--subtle)}
.console .back svg{width:1.6rem;height:1.6rem}
.doc-tit{min-width:0}
.doc-tit strong{display:block;font-size:1.7rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.doc-tit span{font-size:1.3rem;color:var(--subtle)}
.pipe{list-style:none;display:flex;gap:0.4rem;margin:0 0 0 auto;padding:0;align-items:center}
.pipe li{display:flex;align-items:center;gap:0.4rem}
.pipe .arrow{width:1.4rem;height:1.4rem;opacity:.4}
.chip{display:inline-flex;align-items:center;gap:0.6rem;padding:0.5rem 1.2rem;border-radius:10rem;font-size:1.3rem;border:0.1rem solid;white-space:nowrap;font-weight:400;background:#fff;cursor:pointer;line-height:1.5}
.chip svg{width:1.4rem;height:1.4rem}
.chip.done{background:#eef7f0;color:#228738;border-color:#b9dec3}
.chip.now{background:#256ef4;color:#fff;border-color:#256ef4;font-weight:700}
.chip.todo{color:#8a949e;border-color:#cdd1d5}
.krds-btn{display:inline-flex;align-items:center;justify-content:center;gap:0.6rem;height:4.8rem;padding:0 1.6rem;border-radius:0.8rem;font-size:1.7rem;font-weight:700;border:0.1rem solid transparent;cursor:pointer;white-space:nowrap;line-height:1}
.krds-btn svg{width:1.8rem;height:1.8rem}
.krds-btn.small{height:4rem;padding:0 1.4rem;font-size:1.5rem}
.krds-btn.small svg{width:1.6rem;height:1.6rem}
.krds-btn.xsmall{height:3.2rem;padding:0 1.2rem;font-size:1.3rem;border-radius:0.6rem}
.krds-btn.xsmall svg{width:1.4rem;height:1.4rem}
.krds-btn.primary{background:#256ef4;color:#fff;border-color:#256ef4}
.krds-btn.secondary{background:#fff;color:#256ef4;border-color:#256ef4}
.krds-btn.tertiary{background:#fff;color:#1e2124;border-color:#8a949e}
.krds-btn.danger{background:#fff;color:#d0290e;border-color:#d0290e}
.krds-btn.text{background:transparent;color:#256ef4;border-color:transparent;padding:0 0.8rem}
.krds-btn.icon{width:3.2rem;height:3.2rem;padding:0;border-radius:0.6rem;background:transparent;border-color:transparent;color:#464c53}
.krds-btn[disabled]{opacity:.4;cursor:not-allowed}
.krds-badge{display:inline-flex;align-items:center;gap:0.4rem;padding:0.2rem 0.8rem;border-radius:10rem;font-size:1.3rem;font-weight:700;line-height:1.6;white-space:nowrap}
.bg-success{background:#228738;color:#fff}.bg-light-success{background:#eef7f0;color:#228738}
.bg-primary{background:#256ef4;color:#fff}.bg-light-primary{background:#eff5ff;color:#256ef4}
.bg-light-warning{background:#fff8e1;color:#9d5b00}.bg-danger{background:#d0290e;color:#fff}.bg-light-danger{background:#fdf2f0;color:#d0290e}
.bg-gray{background:#8a949e;color:#fff}.bg-light-gray{background:#f4f5f6;color:#464c53}
.bg-navy{background:#1e2124;color:#fff}
.card{background:#fff;border:0.1rem solid var(--border);border-radius:1.2rem;padding:2.4rem}
.card.tight{padding:2rem}
.card h2,.card h3{font-size:1.9rem;font-weight:700}
.card-head{display:flex;align-items:center;gap:1rem;margin-bottom:1.6rem}
.card-head .grow{flex:1}
.card-desc{font-size:1.5rem;color:var(--subtle)}
.stack{display:flex;flex-direction:column;gap:1.6rem}
.row{display:flex;align-items:center;gap:0.8rem}
.krds-table-wrap{overflow-x:auto}
.tbl{width:100%;border-collapse:collapse;font-size:1.5rem}
.tbl th,.tbl td{padding:1.1rem 1.4rem;border-bottom:0.1rem solid var(--border);text-align:left;vertical-align:middle}
.tbl thead th{background:var(--surface);font-weight:700;color:var(--subtle);border-top:0.1rem solid var(--border);font-size:1.4rem;white-space:nowrap}
.tbl.row-th th{background:var(--surface);width:24%;font-weight:700;color:var(--text)}
.tbl .num{font-variant-numeric:tabular-nums}
.tbl tr.sel td{background:#eff5ff}
.tbl.compact th,.tbl.compact td{padding:0.8rem 1.2rem;font-size:1.4rem}
.krds-alert{display:flex;gap:1rem;align-items:flex-start;padding:1.2rem 1.6rem;border-radius:0.8rem;border:0.1rem solid;font-size:1.5rem;line-height:1.5}
.krds-alert svg{flex-shrink:0;width:2rem;height:2rem;margin-top:0.2rem}
.krds-alert.success{background:var(--success-bg);border-color:var(--success-bd)}.krds-alert.success svg{color:var(--success)}
.krds-alert.warning{background:var(--warn-bg);border-color:var(--warn-bd)}.krds-alert.warning svg{color:var(--warn)}
.krds-alert.information{background:var(--info-bg);border-color:var(--info-bd)}.krds-alert.information svg{color:var(--primary)}
.krds-alert.danger{background:var(--danger-bg);border-color:var(--danger-bd)}.krds-alert.danger svg{color:var(--danger)}
.form-group{display:flex;flex-direction:column;gap:0.6rem}
.form-tit{font-size:1.5rem;font-weight:700}
.form-tit .req{color:#d0290e;margin-left:0.2rem}
.form-hint{font-size:1.3rem;color:var(--subtle)}
.krds-input,.krds-select,.krds-textarea{display:flex;align-items:center;width:100%;height:4rem;padding:0 1.2rem;border:0.1rem solid #8a949e;border-radius:0.8rem;font:inherit;font-size:1.5rem;color:var(--text);background:#fff}
.krds-select{justify-content:space-between;gap:0.8rem}
.krds-select svg{width:1.6rem;height:1.6rem;color:#464c53;flex-shrink:0}
.krds-textarea{height:auto;min-height:8rem;padding:1rem 1.2rem;align-items:flex-start;line-height:1.6}
.ph{color:#8a949e}
.form-grid{display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:1.6rem 2.4rem}
.kv{display:grid;grid-template-columns:auto 1fr;gap:0.6rem 1.2rem;font-size:1.5rem;line-height:1.6}
.kv dt{color:var(--subtle);white-space:nowrap}.kv dd{margin:0}
.rail{display:flex;flex-direction:column;gap:1.6rem}
.rail .card h3{font-size:1.5rem;color:var(--subtle);margin-bottom:1.2rem}
.tabs{display:flex;gap:0.4rem;border-bottom:0.1rem solid var(--border)}
.tabs button{height:4.4rem;padding:0 1.6rem;font-size:1.5rem;color:#464c53;background:transparent;border:none;cursor:pointer}
.tabs button[aria-selected="true"]{color:#256ef4;font-weight:700;box-shadow:inset 0 -0.3rem 0 #256ef4}
.tabs button[disabled]{color:#8a949e;cursor:not-allowed}
.tpl-card{min-width:21rem;border:0.1rem solid var(--border);border-radius:0.8rem;padding:1.4rem 1.6rem;background:#fff;cursor:pointer;display:flex;flex-direction:column;gap:0.6rem}
.tpl-card.sel{border:0.2rem solid #256ef4;background:#eff5ff}
.tpl-card strong{font-size:1.5rem}
.tpl-card .meta{font-size:1.3rem;color:var(--subtle)}
.tpl-card .lv{display:flex;gap:0.4rem;flex-wrap:wrap}
.tpl-card .lv span{font-size:1.2rem;padding:0.1rem 0.6rem;border-radius:0.4rem;background:#f4f5f6;color:#464c53}
.doc-body{font-size:1.5rem;line-height:1.8}
.doc-body .p{padding:0.4rem 0.8rem;margin:0 -0.8rem;border-radius:0.6rem;cursor:pointer}
.doc-body .p.sel{background:#eff5ff;outline:0.2rem solid #256ef4}
.doc-body .h1{font-size:2.2rem;font-weight:700;margin-top:1.6rem}
.doc-body .h2{font-size:1.9rem;font-weight:700;margin-top:1.2rem}
.doc-body .h3{font-size:1.9rem;font-weight:400;padding-left:1.6rem}
.doc-body .h4{font-size:1.5rem;font-weight:400;padding-left:3.2rem}
.doc-body .li{padding-left:3.2rem}
.doc-body table{border-collapse:collapse;width:100%;font-size:1.4rem;margin:0.6rem 0}
.doc-body th,.doc-body td{border:0.1rem solid #cdd1d5;padding:0.6rem 1rem;text-align:left}
.doc-body th{background:#f4f5f6}
.num{font-variant-numeric:tabular-nums}
.dim{color:var(--subtle)}
.tiny{font-size:1.3rem}
`;

const FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap">';

const USER = '안전총괄과 · 정하늘 (계획 작성자)';
function header(active = 'plan') {
  return `<header class="hdr" data-screen-label="공통 헤더">
<div class="wrap hdr-in">
<a class="logo" href="#"><span class="logo-mark">UNE</span><strong class="logo-tit">재난안전 AI 문서 POC</strong></a>
<nav class="gnb" aria-label="주요 메뉴"><a href="#"${active === 'plan' ? ' aria-current="page"' : ''}>계획서 생성</a><a href="#"${active === 'sit' ? ' aria-current="page"' : ''}>상황일지</a></nav>
<div class="util"><span>${USER}</span><button type="button" class="krds-btn tertiary xsmall">사용자 변경</button></div>
</div>
</header>`;
}

function lnb(active) {
  return `<div class="band">
<div class="wrap band-in">
<nav class="lnb" aria-label="계획서 메뉴"><a href="#"${active === 'list' ? ' aria-current="page"' : ''}>문서 관리</a><a href="#"${active === 'tpl' ? ' aria-current="page"' : ''}>HWPX 템플릿 · 스타일 분석</a></nav>
<button type="button" class="krds-btn primary small" style="margin-left:auto">${I.plus} 새 문서 생성</button>
</div>
</div>`;
}

const STEPS = ['기준정보', '목차', '초안', '미리보기·내보내기'];
function consoleBand(current, doneUpTo, draftLabel) {
  const chips = STEPS.map((label, i) => {
    const n = i + 1;
    const state = n === current ? 'now' : n <= doneUpTo ? 'done' : 'todo';
    const mark = state === 'done' ? I.check : `<span>${n}</span>`;
    const text = n === 3 && draftLabel ? `${label} ${draftLabel}` : label;
    const arrow = n < STEPS.length ? `<span class="arrow">${I.angle}</span>` : '';
    const cur = state === 'now' ? ' aria-current="step"' : '';
    return `<li><button type="button" class="chip ${state}"${cur}>${mark} ${text}</button>${arrow}</li>`;
  }).join('\n');
  return `<div class="band">
<div class="wrap console">
<a class="back" href="#">${I.back} 문서 관리</a>
<div class="doc-tit"><strong>2026 폭염 대비 계획서</strong><span>폭염 · 대비 · 템플릿 문서 템플릿_01 · 수정 2026. 8. 21. 10:42 정하늘</span></div>
<ol class="pipe" aria-label="작업 단계">
${chips}
</ol>
<button type="button" class="krds-btn tertiary small"${current < 4 ? ' disabled="disabled"' : ''} title="내보낸 HWPX를 rhwp 웹 에디터로 엽니다">${I.external} rhwp 에디터에서 열기</button>
</div>
</div>`;
}

function page({ label, width, height, body }) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
${FONT}
<style>${CSS}</style>
</helmet>
<div style="width:${width}px;min-height:${height}px;background:#f4f5f6" data-screen-label="${label}">
${body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${width},"height":${height}}}'>
class Component extends DCLogic {
  renderVals() { return {}; }
}
</script>
</body>
</html>
`;
}

const railBasis = (opts = {}) => `<section class="card tight">
<h3>생성 기준</h3>
<dl class="kv">
<dt>HWPX 템플릿</dt><dd>문서 템플릿_01 <span class="krds-badge bg-light-success">스타일 분석됨</span></dd>
<dt>개요 기호</dt><dd>□ 16pt 굵게 · ㅇ 15pt · - 15pt · * 12pt</dd>
<dt>재난유형 · 단계</dt><dd>폭염 · 대비</dd>
<dt>타깃 독자</dt><dd>지자체</dd>
<dt>생성 계약</dt><dd>T3Q RPT-001(목차) / RPT-002(본문)${opts.fallback ? ' · 실패 시 유니 폴백' : ''}</dd>
</dl>
</section>`;

const railLink = `<section class="card tight">
<h3>연동 상태</h3>
<dl class="kv">
<dt>T3Q</dt><dd><span class="krds-badge bg-light-success">연결됨</span> <span class="tiny dim">plf.mois-disaster.t3q.ai</span></dd>
<dt>유니</dt><dd><span class="krds-badge bg-light-success">연결됨</span> <span class="tiny dim">exaone-4.5</span></dd>
<dt>rhwp</dt><dd><span class="krds-badge bg-light-gray">0.8.4</span> <span class="tiny dim">서버 내장</span></dd>
</dl>
</section>`;

// ── 01 문서 관리 (/plan) ─────────────────────────────────────────────────
const main = page({
  label: '문서 관리', width: 1520, height: 1000,
  body: `${header()}
${lnb('list')}
<div class="wrap" style="padding-top:2.4rem;padding-bottom:2.4rem">
<h1 class="sr-only">문서 관리</h1>
<div class="stack" style="gap:2.4rem">
<section class="card">
<div class="card-head"><h2>기준정보 템플릿</h2><span class="card-desc">선택한 템플릿의 기준정보로 새 문서를 시작합니다 · 최근 저장 순</span></div>
<div style="display:flex;gap:1.2rem;overflow-x:auto;padding-bottom:0.4rem">
<button type="button" style="min-width:20rem;height:12.8rem;border:0.2rem dashed #cdd1d5;border-radius:0.8rem;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.6rem;color:#464c53;font-size:1.5rem;cursor:pointer"><span style="display:inline-flex;width:2rem;height:2rem">${I.plus}</span>빈 문서</button>
<div class="tpl-card" style="min-width:24rem"><div class="row" style="justify-content:space-between"><span class="krds-badge bg-light-primary">폭염</span><span class="krds-badge bg-light-gray">대비</span></div><strong>여름철 폭염 대비 (지자체)</strong><span class="meta">정하늘 · 2일 전</span></div>
<div class="tpl-card" style="min-width:24rem"><div class="row" style="justify-content:space-between"><span class="krds-badge bg-light-primary">태풍/호우</span><span class="krds-badge bg-light-gray">예방</span></div><strong>풍수해 예방 기본</strong><span class="meta">정하늘 · 1주 전</span></div>
<div class="tpl-card" style="min-width:24rem"><div class="row" style="justify-content:space-between"><span class="krds-badge bg-light-primary">산불</span><span class="krds-badge bg-light-gray">대비</span></div><strong>봄철 산불 대비 (내부보고)</strong><span class="meta">홍길동 · 3주 전</span></div>
</div>
</section>

<section class="card">
<div class="card-head">
<h2>문서 전체 목록 <span class="dim" style="font-weight:400;font-size:1.5rem">(4/4)</span></h2>
<div class="grow"></div>
<div class="row">
<div class="krds-input" style="width:22rem;height:4rem;gap:0.8rem"><span style="display:inline-flex;width:1.6rem;height:1.6rem;color:#464c53">${I.search}</span><span class="ph">문서 명 검색</span></div>
<div class="krds-select" style="width:15rem"><span>재난유형 전체</span>${I.chevDown}</div>
<div class="krds-select" style="width:12rem"><span>단계 전체</span>${I.chevDown}</div>
<label class="row" style="font-size:1.5rem;gap:0.6rem;white-space:nowrap"><span style="width:1.8rem;height:1.8rem;border:0.1rem solid #8a949e;border-radius:0.3rem;background:#fff;display:inline-block"></span>내 문서</label>
</div>
</div>
<div class="krds-table-wrap">
<table class="tbl">
<caption class="sr-only">기관의 계획서 문서 목록</caption>
<colgroup><col style="width:4rem"><col><col style="width:10%"><col style="width:10%"><col style="width:14%"><col style="width:8%"><col style="width:8%"><col style="width:13%"><col style="width:9%"><col style="width:9%"></colgroup>
<thead><tr><th scope="col"><span class="sr-only">선택</span></th><th scope="col">문서 명</th><th scope="col">재난유형</th><th scope="col">재난관리단계</th><th scope="col">진행</th><th scope="col">생성자</th><th scope="col">수정자</th><th scope="col">생성 일시</th><th scope="col">수정 일시</th><th scope="col">훈련 연동</th></tr></thead>
<tbody>
<tr><td><span style="width:1.8rem;height:1.8rem;border:0.1rem solid #8a949e;border-radius:0.3rem;background:#fff;display:inline-block"></span></td><td><a href="#" style="font-weight:700">2026 폭염 대비 계획서</a></td><td>폭염</td><td>대비</td><td><span class="krds-badge bg-light-primary">5/11 초안</span></td><td>정하늘</td><td>정하늘</td><td class="num">2026. 8. 20. 09:12</td><td class="num">12분 전</td><td>-</td></tr>
<tr><td><span style="width:1.8rem;height:1.8rem;border:0.1rem solid #8a949e;border-radius:0.3rem;background:#fff;display:inline-block"></span></td><td><a href="#" style="font-weight:700">2026 풍수해 예방 계획서</a></td><td>태풍/호우</td><td>예방</td><td><span class="krds-badge bg-light-success">9/9 초안 · 내보냄</span></td><td>정하늘</td><td>홍길동</td><td class="num">2026. 8. 12. 14:05</td><td class="num">3일 전</td><td><a href="#"><span class="krds-badge bg-navy">훈련 1건</span></a></td></tr>
<tr><td><span style="width:1.8rem;height:1.8rem;border:0.1rem solid #8a949e;border-radius:0.3rem;background:#fff;display:inline-block"></span></td><td><a href="#" style="font-weight:700">2026 봄철 산불 대비 계획서</a></td><td>산불</td><td>대비</td><td><span class="krds-badge bg-light-gray">0/8 초안</span></td><td>홍길동</td><td>홍길동</td><td class="num">2026. 7. 28. 10:11</td><td class="num">3주 전</td><td>-</td></tr>
<tr><td><span style="width:1.8rem;height:1.8rem;border:0.1rem solid #8a949e;border-radius:0.3rem;background:#fff;display:inline-block"></span></td><td><a href="#" style="font-weight:700">학교시설 지진 대비 계획서</a></td><td>지진</td><td>대비</td><td><span class="krds-badge bg-light-gray">기준정보</span></td><td>최유진</td><td>최유진</td><td class="num">2026. 7. 3. 16:40</td><td class="num">1개월 전</td><td>-</td></tr>
</tbody>
</table>
</div>
</section>
</div>
</div>`,
});

// ── 문서 저장 모달 ──────────────────────────────────────────────────────
const saveModal = page({
  label: '문서 저장 모달', width: 640, height: 420,
  body: `<div style="min-height:420px;background:rgba(30,33,36,.45);display:flex;align-items:center;justify-content:center;padding:2.4rem">
<div role="dialog" aria-labelledby="dlg-tit" style="background:#fff;border-radius:1.2rem;width:48rem;padding:2.4rem;display:flex;flex-direction:column;gap:1.6rem">
<div class="row" style="justify-content:space-between"><h2 id="dlg-tit" style="font-size:1.9rem;font-weight:700">문서 저장</h2><button type="button" class="krds-btn icon" aria-label="닫기">${I.close}</button></div>
<p class="card-desc">템플릿 "여름철 폭염 대비 (지자체)"의 기준정보로 시작합니다. 문서 명을 입력하세요 (최대 20자).</p>
<div class="form-group"><div class="form-tit"><label for="doc-name">문서 명<span class="req">*</span></label></div><div class="krds-input" id="doc-name">2026 폭염 대비 계획서</div><p class="form-hint">저장 후 기준정보 입력 화면으로 이동합니다.</p></div>
<div class="row" style="justify-content:flex-end"><button type="button" class="krds-btn tertiary small">취소</button><button type="button" class="krds-btn primary small">저장하기</button></div>
</div>
</div>`,
});

// ── 02 HWPX 템플릿 · 스타일 분석 (/plan/templates) ─────────────────────────
const tplItem = (name, meta, lv, sel = false, builtin = true) => `<div class="tpl-card ${sel ? 'sel' : ''}" style="min-width:0">
<div class="row" style="justify-content:space-between"><strong>${name}</strong>${builtin ? '<span class="krds-badge bg-light-gray">내장</span>' : '<span class="krds-badge bg-light-primary">업로드</span>'}</div>
<span class="meta">${meta}</span>
<div class="lv">${lv.map((s) => `<span>${s}</span>`).join('')}</div>
</div>`;

const templates = page({
  label: 'HWPX 템플릿 · 스타일 분석', width: 1520, height: 1060,
  body: `${header()}
${lnb('tpl')}
<div class="wrap" style="padding-top:2.4rem;padding-bottom:2.4rem;display:grid;grid-template-columns:38rem minmax(0, 1fr);gap:2.4rem;align-items:start">
<section class="card">
<div class="card-head"><h2>HWPX 템플릿</h2><div class="grow"></div><button type="button" class="krds-btn primary small">${I.upload} 업로드</button></div>
<p class="card-desc" style="margin-bottom:1.6rem">업로드하면 rhwp 엔진이 문단개요번호·기호·글꼴·크기·굵기·스타일을 읽어 프로파일을 만듭니다. 이 프로파일이 목차·초안 생성과 HWPX 내보내기에 적용됩니다.</p>
<div class="stack" style="gap:0.8rem">
${tplItem('문서 템플릿_01', '4수준 · 스타일 26 · 본문 함초롬바탕 12pt', ['□ 16pt B', 'ㅇ 15pt', '- 15pt', '* 12pt'], true)}
${tplItem('문서 템플릿_02', '4수준 · 스타일 24 · 본문 함초롬바탕 12pt', ['□ 15pt B', 'ㅇ 14pt', '- 13pt', '· 12pt'])}
${tplItem('문서 템플릿_상황보고', '3수준 · 스타일 18 · 본문 함초롬돋움 11pt', ['1. 14pt B', '○ 13pt', '- 12pt'])}
${tplItem('보고서 양식', '5수준 · 스타일 31 · 본문 함초롬바탕 12pt', ['Ⅰ. 18pt B', '1. 16pt B', '가. 15pt', '1) 14pt', '가) 13pt'])}
${tplItem('업무보고 양식', '4수준 · 스타일 22 · 본문 맑은 고딕 11pt', ['□ 15pt B', 'ㅇ 14pt', '- 13pt', '※ 11pt'])}
${tplItem('간략 보고 양식', '3수준 · 스타일 15 · 본문 함초롬바탕 12pt', ['□ 16pt B', 'ㅇ 15pt', '- 14pt'])}
</div>
</section>

<div class="stack">
<section class="card">
<div class="card-head"><h2>스타일 프로파일 — 문서 템플릿_01</h2><span class="krds-badge bg-light-success">rhwp 0.8.4 분석</span><div class="grow"></div><button type="button" class="krds-btn tertiary small">원본 미리보기</button></div>
<h3 style="font-size:1.5rem;margin-bottom:0.8rem">문단 개요 수준 (자동 인식)</h3>
<div class="krds-table-wrap">
<table class="tbl compact">
<caption class="sr-only">템플릿에서 인식한 문단 개요 수준</caption>
<thead><tr><th scope="col">수준</th><th scope="col">기호</th><th scope="col">글꼴</th><th scope="col">크기</th><th scope="col">굵게</th><th scope="col">들여쓰기</th><th scope="col">스타일</th><th scope="col">표본</th></tr></thead>
<tbody>
<tr><td><strong>1수준</strong></td><td style="font-size:1.8rem">□</td><td>함초롬바탕</td><td class="num">16pt</td><td>굵게</td><td class="num">0</td><td>개요 1</td><td class="dim">□ 추진 배경 및 목적</td></tr>
<tr><td><strong>2수준</strong></td><td style="font-size:1.8rem">ㅇ</td><td>함초롬바탕</td><td class="num">15pt</td><td>-</td><td class="num">10</td><td>개요 2</td><td class="dim">ㅇ 폭염 특보 발령 기준 및 대응 체계</td></tr>
<tr><td><strong>3수준</strong></td><td style="font-size:1.8rem">-</td><td>함초롬바탕</td><td class="num">15pt</td><td>-</td><td class="num">20</td><td>개요 3</td><td class="dim">- 무더위쉼터 지정·운영 현황</td></tr>
<tr><td><strong>4수준</strong></td><td style="font-size:1.8rem">*</td><td>함초롬바탕</td><td class="num">12pt</td><td>-</td><td class="num">30</td><td><span class="dim">본문 폴백</span></td><td class="dim">* 경로당 12, 복지관 3, 금융기관 6</td></tr>
</tbody>
</table>
</div>
<div class="form-grid" style="margin-top:1.6rem;font-size:1.5rem">
<div><strong>본문</strong> 함초롬바탕 12pt</div>
<div><strong>쪽수</strong> 3 · <strong>스타일 정의</strong> 26개 · <strong>사용 글꼴</strong> 2종</div>
<div style="grid-column:1 / -1"><strong>개요번호 형식</strong> <span class="num">^1.  ^2.  ^3)  ^4)</span></div>
</div>
<h3 style="font-size:1.5rem;margin:1.6rem 0 0.8rem">LLM에 전달되는 스타일 규칙</h3>
<pre style="margin:0;background:#f4f5f6;border:0.1rem solid #cdd1d5;border-radius:0.8rem;padding:1.2rem 1.6rem;font-size:1.4rem;line-height:1.6;white-space:pre-wrap;font-family:inherit">1수준은 "□"로 시작하고 16pt 굵게, 2수준은 "ㅇ" 15pt, 3수준은 "-" 15pt, 4수준은 "*" 12pt로 쓴다.
본문은 함초롬바탕 12pt. 표는 머리행을 굵게. 문단은 개조식으로 60자 이내.</pre>
</section>
<section class="card">
<div class="card-head"><h2>문단별 인식 결과 (원본)</h2><span class="card-desc">텍스트가 있는 문단 41개 중 6개</span></div>
<div class="krds-table-wrap">
<table class="tbl compact">
<caption class="sr-only">원본 문서의 문단별 스타일 인식 결과</caption>
<thead><tr><th scope="col">#</th><th scope="col">스타일</th><th scope="col">크기</th><th scope="col">굵게</th><th scope="col">기호</th><th scope="col">텍스트</th></tr></thead>
<tbody>
<tr><td class="num">3</td><td>개요 1</td><td class="num">16</td><td>굵게</td><td>□</td><td>추진 배경 및 목적</td></tr>
<tr><td class="num">4</td><td>개요 2</td><td class="num">15</td><td>-</td><td>ㅇ</td><td>폭염 특보 발령 기준 및 대응 체계</td></tr>
<tr><td class="num">5</td><td>개요 3</td><td class="num">15</td><td>-</td><td>-</td><td>무더위쉼터 지정·운영 현황</td></tr>
<tr><td class="num">6</td><td>본문</td><td class="num">12</td><td>-</td><td>*</td><td>경로당 12, 복지관 3, 금융기관 6</td></tr>
<tr><td class="num">9</td><td>개요 1</td><td class="num">16</td><td>굵게</td><td>□</td><td>단계별 대응 계획</td></tr>
<tr><td class="num">10</td><td>개요 2</td><td class="num">15</td><td>-</td><td>ㅇ</td><td>관심 단계 (폭염 영향예보 "관심")</td></tr>
</tbody>
</table>
</div>
</section>
</div>
</div>`,
});

// ── 03 기준정보 (/plan/:id · 1단계) ────────────────────────────────────────
const field = (label, value, { req = false, hint = '', select = false, ph = false, textarea = false } = {}) => `<div class="form-group">
<div class="form-tit"><label>${label}${req ? '<span class="req">*</span>' : ''}</label></div>
${textarea ? `<div class="krds-textarea${ph ? ' ph' : ''}">${value}</div>` : select ? `<div class="krds-select"><span${ph ? ' class="ph"' : ''}>${value}</span>${I.chevDown}</div>` : `<div class="krds-input${ph ? ' ph' : ''}">${value}</div>`}
${hint ? `<p class="form-hint">${hint}</p>` : ''}
</div>`;

const context = page({
  label: '기준정보', width: 1520, height: 1280,
  body: `${header()}
${consoleBand(1, 0, '')}
<div class="wrap" style="padding-top:2.4rem;padding-bottom:2.4rem;display:grid;grid-template-columns:minmax(0, 2fr) 36rem;gap:2.4rem;align-items:start">
<main class="stack">
<div class="row">
<h1 style="font-size:2.2rem;font-weight:700">기준정보 <span class="dim" style="font-size:1.3rem;font-weight:400">SCR-CADM-401001 · 405002</span></h1>
<div style="flex:1"></div>
<button type="button" class="krds-btn tertiary small">템플릿 불러오기</button>
<button type="button" class="krds-btn tertiary small">템플릿 등록하기</button>
</div>

<section class="card">
<div class="card-head"><h2>HWPX 문서 템플릿</h2><span class="card-desc">스타일 분석 결과를 목차·초안 생성 규칙과 내보내기에 적용합니다</span><div class="grow"></div><a href="#" class="tiny">템플릿 관리 →</a></div>
<div style="display:flex;gap:1.2rem;overflow-x:auto">
<div class="tpl-card sel"><strong>문서 템플릿_01</strong><span class="meta">□16 · ㅇ15 · -15 · *12</span><span class="meta">본문 함초롬바탕 12pt</span></div>
<div class="tpl-card"><strong>문서 템플릿_02</strong><span class="meta">□15 · ㅇ14 · -13 · ·12</span><span class="meta">본문 함초롬바탕 12pt</span></div>
<div class="tpl-card"><strong>보고서 양식</strong><span class="meta">Ⅰ.18 · 1.16 · 가.15 · 1)14 · 가)13</span><span class="meta">본문 함초롬바탕 12pt</span></div>
<div class="tpl-card"><strong>업무보고 양식</strong><span class="meta">□15 · ㅇ14 · -13 · ※11</span><span class="meta">본문 맑은 고딕 11pt</span></div>
<div class="tpl-card"><strong>간략 보고 양식</strong><span class="meta">□16 · ㅇ15 · -14</span><span class="meta">본문 함초롬바탕 12pt</span></div>
</div>
</section>

<section class="card">
<div class="card-head"><h2>문서 주제</h2></div>
${field('문서 주제', '2026년 여름철 폭염 대비 재난안전계획', { req: true })}
</section>

<section class="card">
<div class="card-head"><h2>배경 정보</h2></div>
<div class="form-grid">
${field('재난유형', '폭염', { req: true, select: true })}
${field('재난관리단계', '대비', { req: true, select: true })}
${field('장소', '강원특별자치도 원주시')}
${field('재난발생일시', '날짜와 시간 선택', { ph: true })}
${field('보고일시', '2026-08-21 10:00')}
</div>
</section>

<section class="card">
<div class="card-head"><h2>내용지침</h2></div>
<div class="stack">
${field('출처', '재난 및 안전관리 기본법, 폭염 위기관리 표준매뉴얼')}
${field('필수 포함 요소', '취약계층 보호, 무더위쉼터 운영, 비상연락망', { hint: '쉼표로 구분' })}
${field('작성 가이드', '담당 부서와 기한을 표로 정리, 수치는 최근 3년 자료를 근거로 제시', { textarea: true })}
</div>
</section>

<section class="card">
<div class="card-head"><h2>표현 규칙</h2></div>
<div class="form-grid">
${field('문체', '공문서체', { select: true })}
${field('문장길이 제한', '60자 이내')}
${field('문단 개요번호 모양', '□ ㅇ - *', { hint: '템플릿 "문서 템플릿_01"에서 자동 채움' })}
${field('본문 문장 시작', '(소제목) 문장…', { ph: true })}
</div>
</section>

<section class="card">
<div class="card-head"><h2>문장 작성 목적</h2></div>
<div class="form-grid">
${field('업무 목적', '폭염 피해 최소화')}
${field('역할', '안전총괄과')}
${field('타깃 독자', '지자체', { req: true, select: true, hint: 'T3Q 열거값: 중앙정부 / 지자체 / 내부보고 / 대민' })}
</div>
</section>

<div class="row" style="justify-content:flex-end">
<button type="button" class="krds-btn secondary">저장</button>
<button type="button" class="krds-btn primary">저장하고 목차 생성으로 ${I.angle}</button>
</div>
</main>
<aside class="rail">
${railBasis()}
${railLink}
</aside>
</div>`,
});

// ── 04 목차 (2단계) ──────────────────────────────────────────────────────
const tocRow = (no, title, depth, badge = '') => `<li style="display:flex;align-items:center;gap:1.2rem;padding:1.1rem 1.2rem;padding-left:${1.2 + depth * 2.8}rem;border-bottom:0.1rem solid #f1f3f5">
<span class="num dim" style="width:4rem;font-size:1.4rem">${no}</span>
<span style="flex:1;font-size:${depth ? '1.5rem' : '1.7rem'};font-weight:${depth ? 400 : 700}">${title}</span>
${badge}
</li>`;

const toc = page({
  label: '목차', width: 1520, height: 940,
  body: `${header()}
${consoleBand(2, 1, '')}
<div class="wrap" style="padding-top:2.4rem;padding-bottom:2.4rem;display:grid;grid-template-columns:minmax(0, 2fr) 36rem;gap:2.4rem;align-items:start">
<main class="stack">
<h1 style="font-size:2.2rem;font-weight:700">목차 <span class="dim" style="font-size:1.3rem;font-weight:400">SCR-CADM-401002 · 404005</span></h1>
<div class="krds-alert success">${I.successFill}<div>T3Q RPT-001이 목차를 생성했습니다 (4장 11절 · 16초). 기준정보와 템플릿 개요 기호(□ ㅇ - *)가 함께 전달되었습니다.</div></div>
<section class="card">
<div class="card-head">
<h2>목차</h2><span class="krds-badge bg-light-success">T3Q RPT-001</span>
<div class="grow"></div>
<button type="button" class="krds-btn tertiary small">${I.refresh} 목차 재생성</button>
<button type="button" class="krds-btn tertiary small">편집하기</button>
<button type="button" class="krds-btn primary small">초안 작성하기 ${I.angle}</button>
</div>
<ol style="list-style:none;padding:0;border-top:0.1rem solid #cdd1d5">
${tocRow('1', '총칙', 0)}
${tocRow('1.1', '목적', 1)}
${tocRow('1.2', '적용 범위', 1)}
${tocRow('2', '폭염 위험요인 및 현황', 0)}
${tocRow('2.1', '기상 전망 및 특보 기준', 1)}
${tocRow('2.2', '취약계층 및 취약시설 현황', 1)}
${tocRow('3', '예방·대비 대책', 0)}
${tocRow('3.1', '무더위쉼터 운영', 1)}
${tocRow('3.2', '취약계층 보호', 1)}
${tocRow('3.3', '비상연락망 및 근무체계', 1)}
${tocRow('4', '부록', 0)}
</ol>
<p class="form-hint" style="margin-top:1.2rem">[편집하기]를 누르면 목차 명 수정·삭제·위아래 이동·목차 추가·하위 목차 추가를 할 수 있습니다. 편집 중에는 초안 작성이 비활성화됩니다.</p>
</section>
</main>
<aside class="rail">
<section class="card tight">
<h3>생성 결과</h3>
<dl class="kv">
<dt>생성기</dt><dd>T3Q RPT-001 <span class="krds-badge bg-light-success">성공</span></dd>
<dt>구성</dt><dd>4장 11절</dd>
<dt>소요</dt><dd class="num">16초 · 2026. 8. 21. 10:44</dd>
<dt>폴백</dt><dd>T3Q 실패 시 유니 RAG로 자동 생성</dd>
</dl>
</section>
${railBasis()}
</aside>
</div>`,
});

// ── 05 초안 + AI 문단 수정 (3단계) ─────────────────────────────────────────
const badge = (status) => ({
  '완료': '<span class="krds-badge bg-light-success">완료</span>',
  '진행중': '<span class="krds-badge bg-light-primary">진행중</span>',
  '대기': '<span class="krds-badge bg-light-gray">대기</span>',
  '-': '<span class="krds-badge bg-light-gray">-</span>',
  '오류': '<span class="krds-badge bg-light-danger">오류</span>',
}[status]);
// 생성이 돌아가는 동안(POC: running)에는 행별 ▶/↻ 버튼을 숨긴다 — 이 아트보드는 2.2 생성 중 상태.
const draftRow = (no, title, depth, status, { current = false, locked = false } = {}) => {
  const clickable = status === '완료' || status === '진행중';
  return `<li style="display:flex;align-items:center;gap:0.8rem;padding:0.9rem 1.2rem;padding-left:${1.2 + (depth - 1) * 1.8}rem;border-bottom:0.1rem solid #f1f3f5;background:${current ? '#eff5ff' : 'transparent'};opacity:${clickable ? 1 : 0.6};cursor:${clickable ? 'pointer' : 'default'}">
<span class="num dim" style="width:3.2rem;font-size:1.3rem">${no}</span>
<span style="flex:1;font-size:${depth === 1 ? '1.5rem' : '1.4rem'};font-weight:${depth === 1 ? 700 : 400}">${title}</span>
${locked ? `<span style="display:inline-flex;width:1.6rem;height:1.6rem;color:#464c53" title="사용자 수정 · 재생성 보호">${I.lock}</span>` : ''}
${badge(status)}
</li>`;
};

const draft = page({
  label: '초안 · AI 문단 수정', width: 1520, height: 980,
  body: `${header()}
${consoleBand(3, 2, '5/11')}
<div style="display:grid;grid-template-columns:30rem minmax(0, 1fr) 34rem;min-height:78rem;background:#fff;border-bottom:0.1rem solid #cdd1d5">
<section style="border-right:0.1rem solid #cdd1d5;display:flex;flex-direction:column">
<div class="row" style="padding:1.2rem;border-bottom:0.1rem solid #cdd1d5">
<h2 style="font-size:1.5rem;font-weight:700;flex:1">목차 <span class="num">5/11</span></h2>
<button type="button" class="krds-btn danger xsmall">생성 취소</button>
</div>
<ol style="list-style:none;padding:0;overflow:auto">
${draftRow('1', '총칙', 1, '완료')}
${draftRow('1.1', '목적', 2, '완료')}
${draftRow('1.2', '적용 범위', 2, '완료', { locked: true })}
${draftRow('2', '폭염 위험요인 및 현황', 1, '완료')}
${draftRow('2.1', '기상 전망 및 특보 기준', 2, '완료')}
${draftRow('2.2', '취약계층 및 취약시설 현황', 2, '진행중', { current: true })}
${draftRow('3', '예방·대비 대책', 1, '대기')}
${draftRow('3.1', '무더위쉼터 운영', 2, '대기')}
${draftRow('3.2', '취약계층 보호', 2, '대기')}
${draftRow('3.3', '비상연락망 및 근무체계', 2, '대기')}
${draftRow('4', '부록', 1, '대기')}
</ol>
<div style="margin-top:auto;padding:1.2rem;border-top:0.1rem solid #f1f3f5">
<div style="height:0.8rem;border-radius:10rem;background:#cdd1d5;overflow:hidden" role="progressbar" aria-valuemin="0" aria-valuemax="11" aria-valuenow="5" aria-label="초안 생성 진행"><span style="display:block;width:45%;height:100%;background:#256ef4"></span></div>
<p class="form-hint" style="margin-top:0.6rem">11절 중 5절 완료 · 2.2 생성 중 (T3Q RPT-002, 절당 약 15~20초)</p>
</div>
</section>

<section style="padding:2.4rem 3.2rem;overflow:auto">
<h1 class="sr-only">초안</h1>
<div class="row" style="margin-bottom:1.6rem">
<h2 style="font-size:1.9rem;font-weight:700">2.2 취약계층 및 취약시설 현황</h2>
<span class="krds-badge bg-light-success">T3Q</span>
<span class="krds-badge bg-light-primary">생성 중…</span>
<div style="flex:1"></div>
<button type="button" class="krds-btn tertiary xsmall">근거 3</button>
<button type="button" class="krds-btn tertiary xsmall" disabled="disabled">직접 편집</button>
</div>
<div class="doc-body" style="font-family:'함초롬바탕','HCR Batang','Noto Serif KR',serif">
<div class="p h1">□ 취약계층 현황</div>
<div class="p h2">ㅇ 폭염 취약계층은 65세 이상 독거노인, 거동불편자, 만성질환자, 야외근로자로 구분하며 2026. 6. 30. 기준 원주시 내 대상자는 12,480명이다.</div>
<div class="p sel">
<table>
<caption class="sr-only">폭염 취약계층 구분별 대상자 수</caption>
<thead><tr><th scope="col">구분</th><th scope="col">대상자(명)</th><th scope="col">전년 대비</th><th scope="col">관리 부서</th></tr></thead>
<tbody><tr><td>독거노인</td><td class="num">7,912</td><td class="num">+4.1%</td><td>노인장애인과</td></tr><tr><td>거동불편자</td><td class="num">2,305</td><td class="num">+1.8%</td><td>노인장애인과</td></tr><tr><td>야외근로자</td><td class="num">2,263</td><td class="num">-0.6%</td><td>일자리경제과</td></tr></tbody>
</table>
</div>
<div class="p h3">- 독거노인 중 냉방기기 미보유 가구 1,204가구는 생활지원사 1일 1회 안부 확인 대상으로 우선 관리한다.</div>
<div class="p h1">□ 취약시설 현황</div>
<div class="p h2">ㅇ 관내 무더위쉼터 412개소 중 야간·휴일 연장운영 쉼터는 38개소이며, 경로당 비율이 71%로 가장 높다.</div>
<div class="p h3">- 야외 작업장(건설현장 27, 농작업 밀집지 14)은 폭염 영향예보 "주의" 이상 시 휴식시간 보장 점검 대상이다.<span style="display:inline-block;width:0.8rem;height:1.6rem;background:#256ef4;vertical-align:text-bottom;margin-left:0.2rem" aria-hidden="true"></span></div>
</div>
</section>

<aside style="border-left:0.1rem solid #cdd1d5;background:#f4f5f6;padding:1.6rem;display:flex;flex-direction:column;gap:1.2rem;overflow:auto">
<div class="row"><span style="display:inline-flex;width:1.8rem;height:1.8rem;color:#256ef4">${I.spark}</span><h2 style="font-size:1.5rem;font-weight:700">AI 문단 수정</h2><span class="krds-badge bg-light-gray" style="margin-left:auto">유니</span></div>
<p class="form-hint">본문에서 문단·표·목록을 클릭해 선택한 뒤 수정 지시를 입력하세요. 템플릿 스타일 규칙이 함께 전달됩니다.</p>
<div style="background:#eff5ff;border:0.1rem solid #256ef4;border-radius:0.8rem;padding:1.2rem;font-size:1.3rem;line-height:1.6;max-height:14rem;overflow:auto">
<div class="row" style="justify-content:space-between;margin-bottom:0.6rem"><strong>선택된 문단</strong><span class="dim num">2.2 · #p2 · 표</span></div>
<span class="dim">| 구분 | 대상자(명) | 전년 대비 | 관리 부서 |<br>| 독거노인 | 7,912 | +4.1% | 노인장애인과 |<br>| 거동불편자 | 2,305 | +1.8% | 노인장애인과 |<br>| 야외근로자 | 2,263 | -0.6% | 일자리경제과 |</span>
</div>
<div style="display:flex;gap:0.6rem;flex-wrap:wrap">
<button type="button" class="krds-btn tertiary xsmall">더 간결하게</button>
<button type="button" class="krds-btn tertiary xsmall">공문서 문체로</button>
<button type="button" class="krds-btn tertiary xsmall">표로 정리</button>
<button type="button" class="krds-btn tertiary xsmall">수치·근거 보강</button>
<button type="button" class="krds-btn tertiary xsmall">두 문장으로 나눠</button>
<button type="button" class="krds-btn tertiary xsmall">담당 부서 명시</button>
</div>
<div class="form-group">
<div class="form-tit"><label for="inst">수정 지시</label></div>
<div class="krds-textarea" id="inst" style="min-height:9rem;font-size:1.4rem">최근 3년 증감 추이 열을 추가하고, 관리 부서는 과 단위로 통일해줘</div>
</div>
<div class="row">
<button type="button" class="krds-btn primary small" style="flex:1">수정 요청</button>
<button type="button" class="krds-btn tertiary small">원문 복원</button>
</div>
<div class="krds-alert information" style="font-size:1.3rem;padding:1rem 1.2rem">${I.infoFill}<div>수정한 문단이 있는 절은 초안을 다시 생성해도 덮어쓰지 않습니다(목차에 자물쇠 표시). 다시 만들려면 생성이 끝난 뒤 그 절의 다시 생성 버튼을 누르세요.</div></div>
<div>
<h3 style="font-size:1.4rem;font-weight:700;margin-bottom:0.8rem">수정 이력 <span class="num dim" style="font-weight:400">(2)</span></h3>
<div class="stack" style="gap:0.6rem">
<div style="background:#fff;border:0.1rem solid #cdd1d5;border-radius:0.6rem;padding:1rem;font-size:1.3rem"><div style="color:#256ef4;font-weight:700">공문서 문체로</div><div class="dim num">10:51:08 · #p1 · 유니</div></div>
<div style="background:#fff;border:0.1rem solid #cdd1d5;border-radius:0.6rem;padding:1rem;font-size:1.3rem"><div style="color:#256ef4;font-weight:700">담당 부서 명시</div><div class="dim num">10:49:32 · #p3 · 유니</div></div>
</div>
</div>
</aside>
</div>`,
});

// ── 06 미리보기·내보내기 (4단계) ─────────────────────────────────────────
const exportStep = page({
  label: '미리보기 · 내보내기', width: 1520, height: 1100,
  body: `${header()}
${consoleBand(4, 3, '11/11')}
<div class="wrap" style="padding-top:2.4rem;padding-bottom:2.4rem;display:grid;grid-template-columns:minmax(0, 2fr) 36rem;gap:2.4rem;align-items:start">
<main class="stack">
<div class="row">
<h1 style="font-size:2.2rem;font-weight:700">미리보기·내보내기 <span class="dim" style="font-size:1.3rem;font-weight:400">SCR-CADM-404004</span></h1>
<div style="flex:1"></div>
<button type="button" class="krds-btn tertiary small">${I.print} 인쇄</button>
<button type="button" class="krds-btn tertiary small">${I.download} 다운로드 (3쪽)</button>
<button type="button" class="krds-btn primary small">HWPX 다시 내보내기</button>
</div>
<div class="krds-alert success">${I.successFill}<div>HWPX를 생성했습니다 — <strong>2026 폭염 대비 계획서.hwpx</strong> (3쪽) · 2026. 8. 21. 11:02. 템플릿 "문서 템플릿_01"의 개요 스타일을 수준별로 적용했습니다.</div></div>
<section class="card" style="padding:0;overflow:hidden">
<div class="tabs" style="padding:0 1.6rem" role="tablist">
<button type="button" role="tab" aria-selected="true">문서 미리보기</button>
<button type="button" role="tab" aria-selected="false">HWPX 재로드 뷰 (rhwp 렌더)</button>
</div>
<div style="background:#f4f5f6;padding:3.2rem;display:flex;justify-content:center">
<article style="background:#fff;width:72rem;min-height:64rem;padding:5.6rem 6.4rem;border:0.1rem solid #cdd1d5;font-family:'함초롬바탕','HCR Batang','Noto Serif KR',serif">
<h2 style="text-align:center;font-size:2.2rem;font-weight:700;margin-bottom:3.2rem">2026년 여름철 폭염 대비 재난안전계획</h2>
<div class="doc-body">
<div class="h1">□ 1. 총칙</div>
<div class="h2">ㅇ 1.1 목적</div>
<div class="h3">- 이 계획은 여름철 폭염으로 인한 인명·재산 피해를 최소화하기 위해 원주시의 예방·대비 체계와 부서별 임무를 정한다.</div>
<div class="h2">ㅇ 1.2 적용 범위</div>
<div class="h3">- 폭염 영향예보 "관심" 단계부터 해제 시까지 시 본청·읍면동·유관기관에 적용한다.</div>
<div class="h1">□ 2. 폭염 위험요인 및 현황</div>
<div class="h2">ㅇ 2.1 기상 전망 및 특보 기준</div>
<div class="h3">- 2026년 여름 평균기온은 평년보다 높을 확률 60%, 폭염일수는 최근 3년 평균 21.3일보다 늘어날 전망이다.</div>
<div class="h4">* 폭염주의보: 최고 체감온도 33℃ 이상 2일 이상 / 폭염경보: 35℃ 이상 2일 이상</div>
</div>
</article>
</div>
</section>
</main>
<aside class="rail">
<section class="card tight">
<h3>내보내기 결과</h3>
<dl class="kv">
<dt>파일</dt><dd>2026 폭염 대비 계획서.hwpx</dd>
<dt>쪽수</dt><dd class="num">3쪽</dd>
<dt>생성</dt><dd class="num">2026. 8. 21. 11:02 · rhwp 0.8.4</dd>
<dt>반영</dt><dd>11절 · 사용자 수정 2문단 보존</dd>
</dl>
</section>
<section class="card tight">
<h3>스타일 매핑</h3>
<div class="krds-table-wrap">
<table class="tbl compact">
<caption class="sr-only">heading 수준별로 적용된 템플릿 스타일</caption>
<thead><tr><th scope="col">수준</th><th scope="col">기호</th><th scope="col">템플릿 스타일</th></tr></thead>
<tbody>
<tr><td>1</td><td>□</td><td>개요 1 · 16pt 굵게</td></tr>
<tr><td>2</td><td>ㅇ</td><td>개요 2 · 15pt</td></tr>
<tr><td>3</td><td>-</td><td>개요 3 · 15pt</td></tr>
<tr><td>4</td><td>*</td><td>본문 폴백 · 12pt</td></tr>
</tbody>
</table>
</div>
</section>
</aside>
</div>`,
});

// ── 07 rhwp 에디터 (/plan/:id/editor) ────────────────────────────────────
const rhwp = page({
  label: 'rhwp 에디터', width: 1520, height: 800,
  body: `${header()}
<div class="band">
<div class="wrap console">
<a class="back" href="#">${I.back} 문서로</a>
<div class="doc-tit"><strong>2026 폭염 대비 계획서</strong><span>2026 폭염 대비 계획서.hwpx 로드 완료 · 3쪽</span></div>
<span class="krds-badge bg-light-primary">rhwp 웹 한글 에디터</span>
<span class="tiny dim">외부 studio(edwardkim.github.io) iframe · 인터넷 연결 필요</span>
<div style="flex:1"></div>
<button type="button" class="krds-btn tertiary small">${I.download} 원본 다운로드</button>
<button type="button" class="krds-btn primary small">편집본 서버에 저장 (HWPX)</button>
</div>
</div>
<div style="margin:2.4rem;height:62rem;border:0.1rem solid #cdd1d5;border-radius:1.2rem;background:#fff;display:flex;flex-direction:column;overflow:hidden">
<div style="height:4.8rem;border-bottom:0.1rem solid #cdd1d5;background:#f4f5f6;display:flex;align-items:center;gap:1.2rem;padding:0 1.6rem;font-size:1.3rem;color:#464c53">
<span style="width:9rem;height:2.4rem;border-radius:0.4rem;background:#cdd1d5"></span><span style="width:6rem;height:2.4rem;border-radius:0.4rem;background:#cdd1d5"></span><span style="width:6rem;height:2.4rem;border-radius:0.4rem;background:#cdd1d5"></span><span style="width:12rem;height:2.4rem;border-radius:0.4rem;background:#cdd1d5"></span>
<span style="margin-left:auto">@rhwp/editor 도구 모음 (외부 제공)</span>
</div>
<div style="flex:1;background:#f4f5f6;display:flex;align-items:center;justify-content:center">
<div style="width:56rem;height:44rem;background:#fff;border:0.1rem solid #cdd1d5;display:flex;align-items:center;justify-content:center;text-align:center;color:#8a949e;font-size:1.5rem;line-height:1.7">rhwp 에디터 영역<br><span class="tiny">내보낸 HWPX가 이 안에서 열리고, 편집 결과는 [편집본 서버에 저장]으로 되돌립니다.</span></div>
</div>
</div>`,
});

// ── 쓰기 ─────────────────────────────────────────────────────────────────
const files = {
  'Main.dc.html': main,
  'SaveModal.dc.html': saveModal,
  'Templates.dc.html': templates,
  'Context.dc.html': context,
  'Toc.dc.html': toc,
  'Draft.dc.html': draft,
  'Export.dc.html': exportStep,
  'RhwpEditor.dc.html': rhwp,
};
for (const [name, html] of Object.entries(files)) writeFileSync(new URL(name, import.meta.url), html);

const GAP = 120, COL2 = 1520 + GAP;
// 행 간격 120px로 정렬: 1행 y=0, 2행 y=1180, 3행 y=2580, 4행 y=3800
const canvas = {
  artboards: [
    { file: 'Main.dc.html', title: '01 문서 관리 — /plan', x: 0, y: 0, w: 1520, h: 1000 },
    { file: 'Templates.dc.html', title: '02 HWPX 템플릿 · 스타일 분석 — /plan/templates', x: COL2, y: 0, w: 1520, h: 1060 },
    { file: 'Context.dc.html', title: '03 기준정보 — /plan/:id (1단계)', x: 0, y: 1180, w: 1520, h: 1280 },
    { file: 'Toc.dc.html', title: '04 목차 — 2단계', x: COL2, y: 1180, w: 1520, h: 940 },
    { file: 'Draft.dc.html', title: '05 초안 + AI 문단 수정 — 3단계', x: 0, y: 2580, w: 1520, h: 980 },
    { file: 'Export.dc.html', title: '06 미리보기·내보내기 — 4단계', x: COL2, y: 2580, w: 1520, h: 1100 },
    { file: 'RhwpEditor.dc.html', title: '07 rhwp 에디터 — /plan/:id/editor', x: 0, y: 3800, w: 1520, h: 800 },
    { file: 'SaveModal.dc.html', title: '01-1 문서 저장 모달', x: COL2, y: 3800, w: 640, h: 420 },
  ],
  annotations: [
    { id: 'brief', x: 0, y: -320, w: 760, text: '계획서 생성 도구(/plan) — KRDS 디자인 초안\n화면 순서: 01 문서 관리 → 02 HWPX 템플릿 → 문서 작업 4단계(03 기준정보 → 04 목차 → 05 초안+AI 문단 수정 → 06 미리보기·내보내기) → 07 rhwp 에디터\n골격·토큰은 design_handoff_krds_uiux/README.md(KRDS v1.0.0) 기준, 화면 구성은 apps/poc/web/src/plan/*.tsx 기준.\n표 안의 수치·템플릿 글꼴·문서명은 예시 데이터입니다.' },
  ],
  launch: { view: 'canvas' },
};
writeFileSync(new URL('canvas.json', import.meta.url), JSON.stringify(canvas, null, 2));
console.log('wrote', Object.keys(files).length, 'artboards + canvas.json');
