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
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, AlignmentType, BorderStyle } from 'docx';
import { parseMarkdown, renderHwpxSvg, type MdBlock, type TemplateProfile } from './hwpx.js';
import * as llm from './llm.js';

export type BlockKind = '시간대별조치' | '임무수행' | '전파수신' | '현장보고' | '자원동원' | '피해' | '특보' | '경보이력' | '회의결정' | '미완료' | '기대행동평가';
export interface ReportSectionDef { key: string; title: string; kind: 'fact' | 'narrative'; block?: BlockKind; prompt?: string; titleByMode?: Record<string, string> }
export interface ReportTemplate { type: string; name: string; seqLabel: string; seq?: boolean; modes: string[]; hazards: string[]; description: string; header: { fields: string[] }; sections: ReportSectionDef[]; hwpxTemplateHint: string }
export interface ReportSection { key: string; title: string; kind: 'fact' | 'narrative'; block?: BlockKind; markdown: string; aiGenerated: boolean; reviewed: boolean; editedByUser?: boolean }
export interface ReportHeader { reportedAt: string; reporter: string; dept: string; phone: string; distribution: string[]; krms: { orgCode: string; reportNo: string; seq: string } }

const TPL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'report-templates');
let cache: ReportTemplate[] | null = null;
export function reportTemplates(): ReportTemplate[] {
  if (cache) return cache;
  cache = readdirSync(TPL_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(TPL_DIR, f), 'utf8')) as ReportTemplate);
  const order = ['immediate', 'interim', 'final', 'journal', 'drillResult'];
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
    const notes = f.events.filter((e) => /피해|현장|침수|붕괴|이재민|사상/.test(`${e.kind} ${e.content}`)).map((e) => `${mmddhhmm(e.at)} ${e.content}`);
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
  기대행동평가: (f) => {
    // 안전한국훈련 가이드북의 기대행동 평가: 임무별 기한 준수·완료 여부로 적정/지연/미흡을 매긴다(평가자가 고쳐 쓴다)
    const rows = f.tasks.map((t) => { const done = t.status === '완료'; const late = t.reportedAt && t.due && t.reportedAt > t.due; const grade = done && !late ? '적정' : done ? '지연 완료' : t.status === '지연' ? '지연' : '미흡'; return [String(t.seq), t.title, `${t.dept} / ${t.assigneeName}`, hhmm(t.due), t.reportedAt ? hhmm(t.reportedAt) : '-', grade, '']; });
    return rows.length ? table(['순번', '기대행동(임무)', '담당', '기한', '완료', '평가', '평가자 의견'], rows) : noRows('평가할 임무 없음');
  },
};

// ── 보고서 생성 ──────────────────────────────────────────────────────────────
export async function buildSections(tpl: ReportTemplate, f: FactSource, opts: { seq: number; prevSummary?: string }): Promise<ReportSection[]> {
  const mode = f.ex.mode ?? '안전한국훈련';
  const docName = `${mode === '안전한국훈련' ? '안전한국훈련' : '재난 상황'} ${tpl.name}${tpl.seq ? ` ${opts.seq}보` : ''}`;
  const out: ReportSection[] = [];
  const facts = `상황명 ${f.ex.title}, 모드 ${mode}, 재난유형 ${f.ex.hazardType}, 위기경보 ${f.ex.alertLevel}, 대응 단계 ${f.ex.stage ?? '초기대응'}, 발생일시 ${f.ex.occurredAt}, 장소 ${f.ex.location}, 기관 ${f.ex.agency} ${f.ex.dept}.\n시나리오/개요: ${f.ex.scenario}\n최근 기록:\n${f.events.slice(-8).map((e) => `${hhmm(e.at)} [${e.kind}] ${e.content}`).join('\n')}\n임무 ${f.tasks.length}건(완료 ${f.tasks.filter((t) => t.status === '완료').length}, 지연·미완료 ${f.tasks.filter((t) => ['지연', '미완료'].includes(t.status)).length})`;
  const narr = tpl.sections.filter((s) => s.kind === 'narrative');
  const texts = await Promise.all(narr.map((s) => llm.narrate(s.title.replace(/^\d+\.\s*/, ''), facts, s.prompt ?? '', docName).catch((e: Error) => `(AI 생성 실패: ${e.message})`)));
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
export const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export async function hwpxToPdf(hwpx: Uint8Array, outPdf: string, workDir: string): Promise<{ pages: number }> {
  if (!existsSync(CHROME_PATH)) throw new Error(`크롬을 찾지 못했습니다(CHROME_PATH=${CHROME_PATH}) — PDF 변환에는 Chrome이 필요합니다`);
  const r = await renderHwpxSvg(hwpx, 200);
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
  const html = `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}.p{width:210mm;height:297mm;overflow:hidden;page-break-after:always;break-after:page}.p:last-child{page-break-after:auto}.p svg{width:210mm;height:297mm;display:block}</style>${r.svgs.map((s) => `<div class="p">${s.replace(/<svg /, '<svg preserveAspectRatio="xMidYMid meet" ')}</div>`).join('')}`;
  const htmlPath = join(workDir, `${Date.now()}.html`); writeFileSync(htmlPath, html);
  const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
  await new Promise<void>((resolve, reject) => {
    const p = spawn(CHROME_PATH, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--no-margins', `--print-to-pdf=${outPdf}`, '--virtual-time-budget=5000', fileUrl], { stdio: 'ignore', windowsHide: true });
    const t = setTimeout(() => { p.kill(); reject(new Error('크롬 PDF 변환 시간 초과(60초)')); }, 60_000);
    p.on('exit', (code) => { clearTimeout(t); if (existsSync(outPdf)) resolve(); else reject(new Error(`크롬 PDF 변환 실패(code ${code})`)); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  return { pages: r.pages };
}

// ── DOCX: 마크다운 블록 → docx ────────────────────────────────────────────
const stripMd = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
function runs(text: string, base: { font: string; size: number }): TextRun[] {
  // **굵게**만 지원
  const out: TextRun[] = []; const re = /\*\*(.+?)\*\*/g; let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: base.font, size: base.size })); out.push(new TextRun({ text: m[1], bold: true, font: base.font, size: base.size })); last = m.index + m[0].length; }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: base.font, size: base.size }));
  return out.length ? out : [new TextRun({ text: '', font: base.font, size: base.size })];
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
