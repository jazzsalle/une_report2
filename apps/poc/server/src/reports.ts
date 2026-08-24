/**
 * 보고서 센터 (범용화 ③, 2026-08-23)
 * 보고서 템플릿(report-templates/*.json) = 절 구조 + 투영 규칙(block) + 문서 스타일 힌트(hwpxTemplateHint).
 * 사실 절은 이벤트·임무·회의·특보에서 표로 투영하고(아래 block 함수), 서술 절은 유니로 쓴다(llm.narrate).
 * 내보내기: HWPX(기존 buildHwpx) · PDF(HWPX → rhwp 쪽 SVG → 헤드리스 크롬 --print-to-pdf, 실측 2026-08-22 287KB/1쪽) · DOCX(docx 라이브러리).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, AlignmentType, BorderStyle, Tab, TabStopType } from 'docx';
import { parseMarkdown, renderHwpxSvg, isNumberingBullet, formatNumbering, distributeWidths, fmtKoDate, extractHeadArea, substituteHeadLine, type MdBlock, type TemplateProfile, type LevelProfile, type HeadItem } from './hwpx.js';
import * as llm from './llm.js';

export type BlockKind = '시간대별조치' | '임무수행' | '전파수신' | '현장보고' | '자원동원' | '피해' | '특보' | '경보이력' | '회의결정' | '미완료' | '기대행동평가' | '복구계획' | '응급복구실적' | '복구재원' | '대응지표';
export interface ReportSectionDef { key: string; title: string; kind: 'fact' | 'narrative'; block?: BlockKind; prompt?: string; titleByMode?: Record<string, string> }
export interface ReportTemplate { type: string; name: string; seqLabel: string; seq?: boolean; modes: string[]; hazards: string[]; description: string; header: { fields: string[] }; sections: ReportSectionDef[]; hwpxTemplateHint: string }
export interface ReportSection { key: string; title: string; kind: 'fact' | 'narrative'; block?: BlockKind; markdown: string; aiGenerated: boolean; reviewed: boolean; editedByUser?: boolean }
export interface ReportHeader { reportedAt: string; reporter: string; dept: string; phone: string; distribution: string[]; krms: { orgCode: string; reportNo: string; seq: string } }

const TPL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'report-templates');
let cache: ReportTemplate[] | null = null;
export function reportTemplates(): ReportTemplate[] {
  if (cache) return cache;
  cache = readdirSync(TPL_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(TPL_DIR, f), 'utf8')) as ReportTemplate);
  const order = ['immediate', 'interim', 'final', 'journal', 'drillResult', 'recovery', 'evaluation'];
  cache.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return cache;
}
export const reportTemplate = (type: string) => reportTemplates().find((t) => t.type === type);

// ── 투영 블록: 사실 → 마크다운 표 ──────────────────────────────────────────
export interface FactSource {
  ex: { id: string; title: string; hazardType: string; phase: string; alertLevel: string; occurredAt: string; location: string; agency: string; dept: string; scenario: string; mode?: string; stage?: string; createdBy: string; alertHistory?: { level: string; at: string; by?: string; reason?: string }[]; stageHistory?: { stage: string; at: string; by?: string }[]; warningsSnapshot?: { at: string; active: { kind: string; level: string; regions: string }[] } };
  events: { at: string; kind: string; content: string; source: string; dept?: string; actor?: string; status?: string }[];
  tasks: { seq: number; title: string; dept: string; assigneeName: string; due: string; status: string; priority?: string; dispatchedAt?: string; ackedAt?: string; reportedAt?: string; result?: string; memo?: string; instructions?: string[] }[];
  meetings: { at: string; chair: string; attendees: string[]; agenda: string; decisions: { alertLevel?: string; stage?: string; evacuation?: boolean; cbs?: boolean; other?: string }; memo?: string }[];
}
const hhmm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '-');
const mmddhhmm = (iso?: string | null) => { if (!iso) return '-'; const d = new Date(iso); return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${hhmm(iso)}`; };
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`)].join('\n');
const noRows = (msg: string) => `- ${msg}`;

/** 피해 보고로 볼 이벤트: 전파·수신확인·SOP 생성 같은 진행 기록은 빼고(“피해 조사 임무를 …에게 전파”가 피해로 잡혔던 실측 2026-08-23), 현장·완료 보고나 피해 낱말이 든 내용만 */
const isDamageEvent = (e: { kind: string; content: string }) => !/전파|수신|상황판단|보고서|AI|회의|경보|단계|기상특보|지연|미완료|완료기한|임무/.test(e.kind) && !/완료기한 초과/.test(e.content) && !/임무를 .*전파|임무 전파|수신 확인/.test(e.content) && /피해|침수|붕괴|파손|유실|정전|단수|이재민|사상|고립|매몰/.test(e.content);
export const BLOCKS: Record<BlockKind, (f: FactSource) => string> = {
  시간대별조치: (f) => { const evs = f.events.filter((e) => e.kind !== 'AI분석'); return evs.length ? table(['시간', '구분', '주요 상황 및 조치사항', '부서/담당', '출처'], evs.map((e) => [mmddhhmm(e.at), e.kind, e.content, [e.dept, e.actor].filter(Boolean).join(' '), e.source])) : noRows('기록된 조치 없음'); },
  임무수행: (f) => (f.tasks.length ? table(['순번', '임무명', '담당부서 / 담당자', '완료기한', '상태', '완료 보고'], f.tasks.map((t) => [String(t.seq), t.title, `${t.dept} / ${t.assigneeName}`, hhmm(t.due), t.status, t.reportedAt ? hhmm(t.reportedAt) : '-'])) : noRows('임무 없음(SOP 미실행)')),
  전파수신: (f) => { const ts = f.tasks.filter((t) => t.dispatchedAt); return ts.length ? table(['임무', '담당자', '전파', '수신확인', '보고'], ts.map((t) => [t.title, t.assigneeName, hhmm(t.dispatchedAt), t.ackedAt ? hhmm(t.ackedAt) : '미확인', t.reportedAt ? hhmm(t.reportedAt) : '-'])) : noRows('전파 기록 없음'); },
  현장보고: (f) => { const ts = f.tasks.filter((t) => t.reportedAt); return ts.length ? ts.map((t) => `- ${hhmm(t.reportedAt)} ${t.assigneeName}: ${t.title} — ${t.result ?? t.status}${t.memo ? ` (${t.memo})` : ''}`).join('\n') : noRows('현장 보고 없음'); },
  자원동원: (f) => {
    // 임무 담당 부서·담당자 투입 시각에서 동원 현황을 뽑는다(장비·물자는 기록이 없어 사람이 채움)
    const byDept = new Map<string, { people: Set<string>; first?: string; tasks: number }>();
    for (const t of f.tasks) { const d = byDept.get(t.dept) ?? { people: new Set<string>(), tasks: 0 }; d.people.add(t.assigneeName); d.tasks++; const at = t.dispatchedAt ?? t.reportedAt; if (at && (!d.first || at < d.first)) d.first = at; byDept.set(t.dept, d); }
    const rows = [...byDept.entries()].map(([dept, d]) => [dept, String(d.people.size), String(d.tasks), d.first ? hhmm(d.first) : '-', '']);
    return rows.length ? table(['부서(반)', '투입 인원', '임무 수', '최초 투입', '장비·물자(기재)'], rows) : noRows('동원 기록 없음');
  },
  피해: (f) => {
    // 피해 보고 이벤트(구분에 '피해'/'현장' 포함)를 비고로 모으고, 인명·시설 칸은 사람이 채운다 — 투영할 수 있는 원천이 없다
    const notes = f.events.filter(isDamageEvent).map((e) => `${mmddhhmm(e.at)} ${e.content}`);
    return table(['구분', '인명(사망/부상/실종)', '이재민', '시설·재산', '비고'], [['누계', '0 / 0 / 0', '0', '', notes.slice(0, 3).join('; ') || '(보고 사항 없음 — 확인 후 기재)']]);
  },
  특보: (f) => { const w = f.ex.warningsSnapshot; return w?.active.length ? `발표 ${mmddhhmm(w.at)} 기준\n\n${table(['특보', '등급', '지역'], w.active.map((x) => [x.kind, x.level, x.regions]))}` : noRows('발효 중인 기상특보 없음'); },
  경보이력: (f) => {
    const rows: string[][] = [];
    for (const a of f.ex.alertHistory ?? []) rows.push([mmddhhmm(a.at), '위기경보', a.level, a.reason ?? '', a.by ?? '']);
    for (const s of f.ex.stageHistory ?? []) rows.push([mmddhhmm(s.at), '대응 단계', s.stage, '', s.by ?? '']);
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    return `현재: 위기경보 **${f.ex.alertLevel}** · 대응 단계 **${f.ex.stage ?? '초기대응'}**\n\n${rows.length ? table(['시각', '구분', '값', '사유', '결정'], rows) : noRows('변경 이력 없음')}`;
  },
  회의결정: (f) => (f.meetings.length ? table(['시각', '주재', '참석', '결정', '안건·메모'], f.meetings.map((m) => { const d = m.decisions; const dec = [d.alertLevel ? `경보 ${d.alertLevel}` : '', d.stage ? `단계 ${d.stage}` : '', d.evacuation ? '대피명령' : '', d.cbs ? 'CBS 발송' : '', d.other ?? ''].filter(Boolean).join(', ') || '결정 없음'; return [mmddhhmm(m.at), m.chair || '-', m.attendees.join(', ') || '-', dec, [m.agenda, m.memo].filter(Boolean).join(' / ')]; })) : noRows('상황판단회의 기록 없음')),
  미완료: (f) => { const ts = f.tasks.filter((t) => ['지연', '미완료', '지원요청', '대기', '전파완료'].includes(t.status)); return ts.length ? ts.map((t) => `- ${t.title} (${t.dept} ${t.assigneeName}) — ${t.status}${t.status === '지연' ? `, 기한 ${hhmm(t.due)}` : ''}`).join('\n') : noRows('없음'); },
  // ── 복구계획서·평가서(연구항목 3, 2026-08-23) ──
  복구계획: (f) => {
    // 피해 관련 이벤트 한 건 = 복구 대상 한 행(복구 방법·예산·완료 예정은 사람이 채움). 없으면 빈 행 하나
    const hits = f.events.filter(isDamageEvent);
    const rows = hits.length ? hits.map((e) => ['', e.content, '', '', e.dept ?? '', '']) : [['(시설·분야)', '(피해 내용)', '(응급/항구 복구 방법)', '', '', '']];
    return table(['구분(시설·분야)', '피해 내용', '복구 방법', '소요 예산(백만원)', '담당 부서', '완료 예정'], rows);
  },
  응급복구실적: (f) => { const ts = f.tasks.filter((t) => t.status === '완료' && /복구|응급|점검|정비|배수|제거|통제/.test(t.title)); return ts.length ? table(['임무', '담당부서 / 담당자', '완료 보고', '결과·비고'], ts.map((t) => [t.title, `${t.dept} / ${t.assigneeName}`, hhmm(t.reportedAt), [t.result, t.memo].filter(Boolean).join(' · ') || '-'])) : noRows('응급복구로 분류된 완료 임무 없음 — 표 편집으로 기재'); },
  복구재원: () => table(['재원', '금액(백만원)', '비고'], [['국비', '', ''], ['지방비(시·도)', '', ''], ['지방비(시·군·구)', '', ''], ['기타(의연금·보험 등)', '', ''], ['합계', '', '']]),
  대응지표: (f) => {
    // 이벤트 원장·임무 기록에서 바로 계산되는 지표. 평가 칸은 평가자가 채운다
    const min = (a?: string | null, b?: string | null) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000) : null);
    const first = f.events.find((e) => e.kind === '최초상황')?.at ?? f.ex.occurredAt;
    const dispatched = f.tasks.filter((t) => t.dispatchedAt); const firstDispatch = dispatched.map((t) => t.dispatchedAt!).sort()[0];
    const acked = dispatched.filter((t) => t.ackedAt); const ackMins = acked.map((t) => min(t.dispatchedAt, t.ackedAt)!).filter((x) => x >= 0);
    const done = f.tasks.filter((t) => t.status === '완료'); const onTime = done.filter((t) => !t.reportedAt || !t.due || t.reportedAt <= t.due);
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');
    const rows: string[][] = [
      ['최초 상황 → 첫 임무 전파', firstDispatch ? `${min(first, firstDispatch)}분` : '-', '최초상황 이벤트 시각 대비 첫 전파 시각', ''],
      ['임무 전파 건수 / 전체 임무', `${dispatched.length} / ${f.tasks.length}`, '전파 기록이 있는 임무', ''],
      ['수신 확인률', pct(acked.length, dispatched.length), `수신확인 ${acked.length} / 전파 ${dispatched.length}`, ''],
      ['평균 수신 확인 소요', ackMins.length ? `${Math.round(ackMins.reduce((a, b) => a + b, 0) / ackMins.length)}분` : '-', '전파 → 수신확인', ''],
      ['임무 완료율', pct(done.length, f.tasks.length), `완료 ${done.length} / ${f.tasks.length}`, ''],
      ['기한 내 완료율', pct(onTime.length, done.length), `기한 내 ${onTime.length} / 완료 ${done.length}`, ''],
      ['지연·미완료·지원요청', String(f.tasks.filter((t) => ['지연', '미완료', '지원요청'].includes(t.status)).length), '상태 기준', ''],
      ['현장 완료 보고 건수', String(f.tasks.filter((t) => t.reportedAt).length), '모바일 완료 보고', ''],
      ['상황판단회의 횟수', String(f.meetings.length), '회의 기록', ''],
      ['위기경보 · 단계 변경 횟수', `${Math.max(0, (f.ex.alertHistory?.length ?? 1) - 1)} · ${Math.max(0, (f.ex.stageHistory?.length ?? 1) - 1)}`, '이력(최초 설정 제외)', ''],
      ['기상특보 기록 건수', String(f.events.filter((e) => e.kind === '기상특보').length), "'기상특보' 이벤트", ''],
    ];
    return table(['지표', '값', '산출 근거', '평가(적정/미흡·의견)'], rows);
  },
  기대행동평가: (f) => {
    // 안전한국훈련 가이드북의 기대행동 평가: 임무별 기한 준수·완료 여부로 적정/지연/미흡을 매긴다(평가자가 고쳐 쓴다)
    const rows = f.tasks.map((t) => { const done = t.status === '완료'; const late = t.reportedAt && t.due && t.reportedAt > t.due; const grade = done && !late ? '적정' : done ? '지연 완료' : t.status === '지연' ? '지연' : '미흡'; return [String(t.seq), t.title, `${t.dept} / ${t.assigneeName}`, hhmm(t.due), t.reportedAt ? hhmm(t.reportedAt) : '-', grade, '']; });
    return rows.length ? table(['순번', '기대행동(임무)', '담당', '기한', '완료', '평가', '평가자 의견'], rows) : noRows('평가할 임무 없음');
  },
};

/** 유니가 답 대신 상태 문구("JSON 매뉴얼 파일을 생성하고 있습니다. 잠시만 기다려 주세요…")를 돌려준 적이 있다(실측 2026-08-23, 180초). 그럴 땐 한 번 더 묻고, 그래도 안 되면 절에 안내를 남긴다 */
const PLACEHOLDER_RE = /잠시만 기다려|생성하고 있습니다|처리 중입니다|please wait/i;
// 실측 2026-08-23: 예전 실패 때 저장된 '[AI분석] JSON 매뉴얼 파일을 생성하고 있습니다…' 이벤트를 사실 기록에 넣었더니 유니가 그 문장을 그대로 따라 했다 → AI분석·보고 이벤트와 상태 문구는 프롬프트에서 뺀다
async function narrateSafe(kind: string, facts: string, prompt: string, docName: string): Promise<string> {
  for (let i = 0; i < 2; i++) {
    try { const t = await llm.narrate(kind, facts, prompt, docName); if (t.trim() && !PLACEHOLDER_RE.test(t) && t.trim().length > 20) return t; }
    catch (e) { if (i === 1) return `(AI 생성 실패: ${(e as Error).message} — [AI 다시 생성]을 누르세요)`; }
  }
  return '(유니가 문장 대신 처리 중 안내만 돌려주었습니다 — 잠시 뒤 [AI 다시 생성]을 누르세요)';
}

// ── 보고서 생성 ──────────────────────────────────────────────────────────────
export async function buildSections(tpl: ReportTemplate, f: FactSource, opts: { seq: number; prevSummary?: string }): Promise<ReportSection[]> {
  const mode = f.ex.mode ?? '안전한국훈련';
  const docName = `${mode === '안전한국훈련' ? '안전한국훈련' : '재난 상황'} ${tpl.name}${tpl.seq ? ` ${opts.seq}보` : ''}`;
  const out: ReportSection[] = [];
  const facts = `상황명 ${f.ex.title}, 모드 ${mode}, 재난유형 ${f.ex.hazardType}, 위기경보 ${f.ex.alertLevel}, 대응 단계 ${f.ex.stage ?? '초기대응'}, 발생일시 ${f.ex.occurredAt}, 장소 ${f.ex.location}, 기관 ${f.ex.agency} ${f.ex.dept}.\n시나리오/개요: ${f.ex.scenario}\n최근 기록:\n${f.events.filter((e) => !/AI분석|^보고$/.test(e.kind) && !PLACEHOLDER_RE.test(e.content)).slice(-8).map((e) => `${hhmm(e.at)} [${e.kind}] ${e.content}`).join('\n')}\n임무 ${f.tasks.length}건(완료 ${f.tasks.filter((t) => t.status === '완료').length}, 지연·미완료 ${f.tasks.filter((t) => ['지연', '미완료'].includes(t.status)).length})`;
  const narr = tpl.sections.filter((s) => s.kind === 'narrative');
  const texts = await Promise.all(narr.map((s) => narrateSafe(s.title.replace(/^\d+\.\s*/, ''), facts, s.prompt ?? '', docName)));
  for (const s of tpl.sections) {
    const title = s.titleByMode?.[mode] ?? s.title;
    if (s.kind === 'fact') out.push({ key: s.key, title, kind: 'fact', block: s.block, markdown: s.block ? BLOCKS[s.block](f) : '', aiGenerated: false, reviewed: true });
    else out.push({ key: s.key, title, kind: 'narrative', markdown: texts[narr.indexOf(s)] ?? '', aiGenerated: true, reviewed: false });
  }
  return out;
}
/** 사실 절만 다시 투영(사용자 편집 절은 보존) */
export function refreshFacts(sections: ReportSection[], f: FactSource): ReportSection[] {
  return sections.map((s) => (s.kind === 'fact' && s.block && !s.editedByUser ? { ...s, markdown: BLOCKS[s.block](f) } : s));
}

/** 머리 정보 표 + 절 → 하나의 마크다운(HWPX·DOCX·PDF 공통 입력) */
export function reportMarkdown(title: string, header: ReportHeader, sections: ReportSection[], opts: { orgName?: string } = {}): string {
  const h = header;
  const head = table(['보고 일시', '보고자', '소속', '연락처'], [[mmddhhmm(h.reportedAt), h.reporter || '-', h.dept || opts.orgName || '-', h.phone || '-']]);
  const dist = h.distribution?.length ? `\n\n배부처: ${h.distribution.join(', ')}` : '';
  const krms = h.krms?.orgCode || h.krms?.reportNo ? `\n\nKRMS 연계: 기관코드 ${h.krms.orgCode || '-'} · 보고번호 ${h.krms.reportNo || '-'}${h.krms.seq ? ` · 차수 ${h.krms.seq}` : ''}` : '';
  return `${head}${dist}${krms}\n\n${sections.map((s) => `# ${s.title}\n\n${s.markdown}`).join('\n\n')}`;
}

// ── PDF: HWPX 쪽 SVG → HTML → 헤드리스 크롬 ────────────────────────────────
/**
 * PDF 변환용 브라우저 찾기: CHROME_PATH env → 크롬 기본 경로(x64·x86·사용자 설치) → **Edge**(윈도우 기본 내장, 같은 --print-to-pdf 지원).
 * 둘 다 없을 때만 BROWSER_NOT_FOUND — 화면은 오류 대신 설치 안내를 띄운다(사용자 요청 2026-08-23).
 */
export const CHROME_PATH = process.env.CHROME_PATH || '';
const LOCAL = process.env.LOCALAPPDATA || '';
const BROWSER_CANDIDATES: { kind: 'chrome' | 'edge'; path: string }[] = [
  ...(CHROME_PATH ? [{ kind: 'chrome' as const, path: CHROME_PATH }] : []),
  { kind: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  { kind: 'chrome', path: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
  ...(LOCAL ? [{ kind: 'chrome' as const, path: `${LOCAL}\\Google\\Chrome\\Application\\chrome.exe` }] : []),
  { kind: 'edge', path: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
  { kind: 'edge', path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
];
export function findBrowser(): { kind: 'chrome' | 'edge'; path: string } | null { return BROWSER_CANDIDATES.find((c) => existsSync(c.path)) ?? null; }
export function pdfStatus() { const b = findBrowser(); return { available: !!b, browser: b?.kind ?? null, path: b?.path ?? null, chromePathEnv: CHROME_PATH || null }; }
export class BrowserNotFound extends Error { code = 'BROWSER_NOT_FOUND'; constructor() { super('PDF 변환에 쓸 브라우저(Chrome 또는 Edge)를 서버 PC에서 찾지 못했습니다'); } }
export async function hwpxToPdf(hwpx: Uint8Array, outPdf: string, workDir: string): Promise<{ pages: number }> {
  const browser = findBrowser(); if (!browser) throw new BrowserNotFound();
  const r = await renderHwpxSvg(hwpx, 200);
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
  const html = `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}.p{width:210mm;height:297mm;overflow:hidden;page-break-after:always;break-after:page}.p:last-child{page-break-after:auto}.p svg{width:210mm;height:297mm;display:block}</style>${r.svgs.map((s) => `<div class="p">${s.replace(/<svg /, '<svg preserveAspectRatio="xMidYMid meet" ')}</div>`).join('')}`;
  const htmlPath = join(workDir, `${Date.now()}.html`); writeFileSync(htmlPath, html);
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  await new Promise<void>((resolve, reject) => {
    const p = spawn(browser.path, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--no-margins', `--print-to-pdf=${outPdf}`, '--virtual-time-budget=5000', fileUrl], { stdio: 'ignore', windowsHide: true });
    const t = setTimeout(() => { p.kill(); reject(new Error(`${browser.kind === 'edge' ? 'Edge' : '크롬'} PDF 변환 시간 초과(60초)`)); }, 60_000);
    p.on('exit', (code) => { clearTimeout(t); if (existsSync(outPdf)) resolve(); else reject(new Error(`${browser.kind === 'edge' ? 'Edge' : '크롬'} PDF 변환 실패(code ${code})`)); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  return { pages: r.pages };
}

// ── DOCX: 마크다운 블록 → docx ────────────────────────────────────────────
const stripMd = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
function runs(text: string, base: { font: string; size: number; bold?: boolean }): TextRun[] {
  // **굵게**만 지원 — base.bold는 문단(수준) 전체 굵게
  const out: TextRun[] = []; const re = /\*\*(.+?)\*\*/g; let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: base.font, size: base.size, bold: base.bold })); out.push(new TextRun({ text: m[1], bold: true, font: base.font, size: base.size })); last = m.index + m[0].length; }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: base.font, size: base.size, bold: base.bold }));
  return out.length ? out : [new TextRun({ text: '', font: base.font, size: base.size, bold: base.bold })];
}
export async function markdownToDocx(title: string, md: string, profile?: TemplateProfile | null): Promise<Uint8Array> {
  const font = profile?.bodyFontFamily || '맑은 고딕';
  const size = Math.round((profile?.bodyFontSizePt || 11) * 2); // half-points
  const base = { font, size };
  const blocks: MdBlock[] = parseMarkdown(md);
  const children: (Paragraph | Table)[] = [new Paragraph({ text: title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 240 } })];
  const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
  const walk = (bs: MdBlock[]) => {
    for (const b of bs) {
      if (b.kind === 'heading') children.push(new Paragraph({ children: [new TextRun({ text: stripMd(b.text), bold: true, font, size: size + (b.level <= 1 ? 6 : 2) })], heading: b.level <= 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }));
      else if (b.kind === 'bullet') children.push(new Paragraph({ children: runs(b.text, base), bullet: { level: Math.min(2, Math.max(0, b.level - 1)) }, spacing: { after: 60 } }));
      else if (b.kind === 'table' && b.rows?.length) {
        const cols = Math.max(...b.rows.map((r) => r.length));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: b.rows.map((r, ri) => new TableRow({ tableHeader: ri === 0, children: Array.from({ length: cols }, (_, ci) => new TableCell({ borders: { top: border, bottom: border, left: border, right: border }, shading: ri === 0 ? { fill: 'EDEFF2' } : undefined, children: [new Paragraph({ children: runs(r[ci] ?? '', { font, size: size - 2 }), alignment: ri === 0 ? AlignmentType.CENTER : AlignmentType.LEFT })] })) })) }));
        children.push(new Paragraph({ text: '', spacing: { after: 80 } }));
      } else if (b.kind === 'para') children.push(new Paragraph({ children: runs(b.text, base), spacing: { after: 120 } }));
      const kids = (b as MdBlock & { children?: MdBlock[] }).children; if (kids?.length) walk(kids);
    }
  };
  walk(blocks);
  const doc = new Document({ creator: 'UNE 재난안전 AI 문서 POC', title, styles: { default: { document: { run: { font, size } } } }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// ── 계획서 DOCX: HWPX 템플릿 프로파일을 Word로 근사 (2026-08-24) ─────────────
// buildHwpx(hwpx.ts)와 같은 규칙으로 수준(제목 상대)·기호(번호형 카운터·중복 건너뛰기)·글꼴·들여쓰기·표 모양을 입힌다.
// 내어쓰기(줄바꿈 앞줄 정렬)는 Word 문단 서식의 hanging으로: indent.left = 글 시작 위치, 첫 줄만 hanging만큼 왼쪽(기호 위치)에서 시작 — HWPX의 marginLeft+음수 indent와 같은 모양.
// 단위: HWPUNIT(1/100pt) → twip(1/20pt)은 ÷5.
export async function planDocx(title: string, md: string, P: TemplateProfile, meta: { reportedAt?: string; reporter?: string } = {}, templateBytes?: Uint8Array): Promise<Uint8Array> {
  const bodyFont = P.bodyFontFamily || '맑은 고딕';
  const bodySizePt = P.bodyFontSizePt || 11;
  const levelFor = (lv: number) => P.levels.find((l) => l.level === lv) ?? P.levels[Math.min(lv, P.levels.length) - 1] ?? null;
  const fontOf = (L: LevelProfile | null) => ({ font: L?.fontFamily || bodyFont, size: Math.round((L?.fontSizePt || bodySizePt) * 2), bold: !!L?.bold });
  /** 기호+접두 폭(twip): 전각 1em, 반각 0.5em — hwpx.ts markWidthHu와 같은 규칙 */
  const markWidthTw = (lead: string, sizePt: number): number => {
    if (!lead) return 0;
    const em = Math.max(6, sizePt) * 20;
    let w = 0;
    for (const ch of lead) w += /[\u1100-\u11ff\u2460-\u24ff\u25a0-\u25ff\u3000-\ud7ff\uf900-\ufaff\uff01-\uff60]/.test(ch) ? em : em / 2;
    return Math.round(w);
  };
  // 번호형 기호(가./1)/①)는 같은 수준 형제끼리 센다. 더 깊은 수준은 새 항목이 나오면 처음부터 — buildHwpx와 동일
  const counters: number[] = [];
  const bulletFor = (L: LevelProfile | null, plain: string, lv: number): { mark: string; prepend: string } => {
    const b = L?.bullet ?? '';
    for (let i = lv + 1; i < counters.length; i++) counters[i] = 0;
    const skip = !b || plain.startsWith(b) || (isNumberingBullet(b) && /^(\d|[가-힣][.)]|[①-⑳])/.test(plain));
    const mark = !skip && isNumberingBullet(b) ? formatNumbering(b, (counters[lv] = (counters[lv] ?? 0) + 1)) : b;
    return skip ? { mark: plain.startsWith(b) ? b : '', prepend: '' } : { mark, prepend: `${mark} ` };
  };
  // **굵게**는 runs()가 살리므로 남기고, 나머지 인라인 마크다운만 벗긴다
  const clean = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/`(.+?)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1');
  const ts = P.tableStyle ?? null;
  const border = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
  const hex = (c?: string | null) => (c && /^#?[0-9a-fA-F]{6}$/.test(c) ? c.replace('#', '').toUpperCase() : null);

  const children: (Paragraph | Table)[] = [];
  // 머리 영역: 템플릿 머리(제목 표/제목 문단·날짜 줄)를 그대로 재현 — buildHwpx와 같은 치환 규칙(제목 칸→문서주제, 날짜줄→보고일시·보고자) (2026-08-24)
  const headItems: HeadItem[] = templateBytes ? await extractHeadArea(templateBytes, P) : [];
  if (headItems.length) {
    // 제목 자리: 표형이면 "제목" 칸 → 첫 채워진 칸, 문단형이면 글자 크기가 가장 큰 문단
    let placed = false;
    const firstTable = headItems.find((h) => h.kind === 'table' && h.rows?.length);
    if (firstTable?.rows) {
      const cells = firstTable.rows.flat();
      const target = cells.find((c) => /제\s*목/.test(c.text)) ?? cells.find((c) => c.text.trim());
      if (target) { target.text = title; placed = true; }
    }
    let titlePara: HeadItem | null = null;
    if (!placed) {
      for (const h of headItems) if (h.kind === 'para' && (h.fontSizePt ?? 0) > (titlePara?.fontSizePt ?? 0)) titlePara = h;
      if (titlePara) { titlePara.text = title; placed = true; }
    }
    for (const h of headItems) {
      if (h.kind === 'para' && h.text) {
        const sub = h === titlePara ? null : substituteHeadLine(h.text, meta);
        const align = h.alignment === 'center' ? AlignmentType.CENTER : h.alignment === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;
        children.push(new Paragraph({ children: [new TextRun({ text: sub ?? h.text, font: h.fontFamily || bodyFont, size: Math.round((h.fontSizePt || bodySizePt) * 2), bold: !!h.bold })], alignment: align, spacing: { after: 120 } }));
      } else if (h.kind === 'table' && h.rows?.length) {
        const totalW = (h.colWidths ?? []).reduce((a, x) => a + x, 0);
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: h.rows.map((r) => new TableRow({
            children: r.map((c, ci) => new TableCell({
              borders: { top: border, bottom: border, left: border, right: border },
              shading: c.fillType !== 'none' && hex(c.fillColor) ? { fill: hex(c.fillColor) as string } : undefined,
              width: h.colWidths?.[ci] && totalW ? { size: Math.round(((h.colWidths[ci] ?? 0) / totalW) * 100), type: WidthType.PERCENTAGE } : undefined,
              children: [new Paragraph({ children: [new TextRun({ text: substituteHeadLine(c.text, meta) ?? c.text, font: c.fontFamily || bodyFont, size: Math.round((c.fontSizePt || bodySizePt) * 2), bold: !!c.bold })], alignment: AlignmentType.CENTER })],
            })),
          })),
        }));
        children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      }
    }
  } else {
    // 폴백(템플릿에 견본 구간 정보가 없을 때): 가운데 제목 + "(보고일시, 보고자)"
    const t1 = fontOf(levelFor(1));
    children.push(new Paragraph({ children: [new TextRun({ text: title, bold: true, font: t1.font, size: t1.size + 8 })], alignment: AlignmentType.CENTER, spacing: { after: 120 } }));
    if (meta.reportedAt || meta.reporter) {
      const parts = [meta.reportedAt ? `보고일시 ${fmtKoDate(meta.reportedAt)}` : '', meta.reporter ? `보고자 ${meta.reporter}` : ''].filter(Boolean);
      children.push(new Paragraph({ children: [new TextRun({ text: `(${parts.join(', ')})`, font: bodyFont, size: Math.max(12, Math.round(bodySizePt * 2) - 2) })], alignment: AlignmentType.RIGHT, spacing: { after: 240 } }));
    }
  }

  /** 수준 항목 하나: 접두+기호 뒤에 탭 — 내어쓰기(hanging)와 탭 정지를 같은 위치에 둬서
   *  글꼴 폭 추정·양쪽 정렬의 공백 늘림과 무관하게 둘째 줄이 정확히 첫 줄 글 시작 밑에 온다(2026-08-24, 공백 방식은 어긋났음) */
  const pushItem = (lv: number, raw: string) => {
    const L = levelFor(lv);
    const f = fontOf(L);
    let content = clean(raw);
    const bt = bulletFor(L, stripMd(content), lv);
    let mark = bt.mark;
    if (bt.prepend) { /* 생성한 기호를 앞에 붙이는 경우 */ }
    else if (mark && content.startsWith(mark)) content = content.slice(mark.length).replace(/^ /, '');
    else {
      // 내용이 자체 번호로 시작("2. 영국형 …") — 그 번호를 기호로 삼아 탭 정렬
      const m = content.match(/^(\(?\d+[.)]|\(?\d+\)|[가-힣][.)]|[①-⑳])\s+/);
      if (m) { mark = m[1]; content = content.slice(m[0].length); } else mark = '';
    }
    const lead = `${L?.prefix ?? ''}${mark ? `${mark} ` : ''}`;
    const left = Math.round((L?.indentHu ?? 0) / 5) + markWidthTw(lead, L?.fontSizePt || bodySizePt);
    const kids: TextRun[] = [];
    if (mark) kids.push(new TextRun({ text: `${L?.prefix ?? ''}${mark}`, font: f.font, size: f.size, bold: f.bold }), new TextRun({ children: [new Tab()], font: f.font, size: f.size }));
    else if (L?.prefix) content = `${L.prefix}${content}`;
    kids.push(...runs(content, f));
    children.push(new Paragraph({
      children: kids,
      alignment: AlignmentType.JUSTIFIED,
      indent: left > 0 ? { left, hanging: left } : undefined,
      tabStops: mark ? [{ type: TabStopType.LEFT, position: left }] : undefined,
      spacing: { before: lv === 1 ? 240 : 60, after: 60 },
    }));
  };

  // 항목의 수준은 바로 위 제목에 상대적 — buildHwpx와 동일
  let headingLevel = 1;
  for (const b of parseMarkdown(md)) {
    if (b.kind === 'heading') { headingLevel = b.level; pushItem(b.level, b.text); }
    else if (b.kind === 'bullet') pushItem(Math.min(P.levels.length, headingLevel + b.level), b.text);
    else if (b.kind === 'para') children.push(new Paragraph({ children: runs(clean(b.text), { font: bodyFont, size: Math.round(bodySizePt * 2) }), alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 } }));
    else if (b.kind === 'table' && b.rows?.length) {
      const cols = Math.max(...b.rows.map((r) => r.length));
      // 견본 표의 열 너비 비율·머리행/첫 열 배경·글꼴을 그대로 — 테두리는 Word 근사(회색 실선)
      const widths = ts ? distributeWidths(ts.colWidths, cols) : [];
      const totalW = widths.reduce((a, x) => a + x, 0);
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: b.rows.map((r, ri) => new TableRow({
          tableHeader: ri === 0,
          children: Array.from({ length: cols }, (_, ci) => {
            const st = ts ? (ri === 0 ? ts.header : ci === 0 ? ts.firstCol : ts.body) : null;
            const fill = st ? (st.fillType !== 'none' ? hex(st.fillColor) : null) : ri === 0 ? 'EDEFF2' : null;
            const cf = { font: st?.font.fontFamily || bodyFont, size: Math.round((st?.font.fontSizePt || bodySizePt - 1) * 2), bold: !!st?.font.bold };
            return new TableCell({
              borders: { top: border, bottom: border, left: border, right: border },
              shading: fill ? { fill } : undefined,
              width: widths[ci] && totalW ? { size: Math.round((widths[ci] / totalW) * 100), type: WidthType.PERCENTAGE } : undefined,
              children: [new Paragraph({ children: runs(clean(r[ci] ?? ''), cf), alignment: ri === 0 ? AlignmentType.CENTER : AlignmentType.LEFT })],
            });
          }),
        })),
      }));
      children.push(new Paragraph({ text: '', spacing: { after: 80 } }));
    }
  }
  const doc = new Document({ creator: 'UNE 재난안전 AI 문서 POC', title, styles: { default: { document: { run: { font: bodyFont, size: Math.round(bodySizePt * 2) } } } }, sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}
