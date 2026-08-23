import './env.js';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { col, FILES_DIR, type Row } from './store.js';
import { uniStatus, listDocuments, chatStream } from './uni.js';
import { t3qStatus, t3qContentToMarkdown } from './t3q.js';
import { initRhwp, rhwpVersion, profileTemplate, buildHwpx, renderHwpxSvg, extractParagraphs, PROFILE_VERSION, type TemplateProfile } from './hwpx.js';
import * as llm from './llm.js';
import { getWeather, getWarnings, weatherStatus } from './weather.js';
import type { PlanContext, TocNode, SopGraph } from './llm.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const TEMPLATE_DIR = resolve(process.cwd(), '../../../templete');
const now = () => new Date().toISOString();
/** 휴지통: 삭제는 deletedAt만 찍는다(소프트 삭제). 목록은 alive만, 복원/완전 삭제는 /api/trash. 30일 지나면 기동 시 자동 완전 삭제 */
const alive = <T extends Row>(r: T) => !r.deletedAt;
const TRASH_DAYS = 30;
const bad = (res: Response, code: number, error: string) => res.status(code).json({ error });

// ── 사용자 (고정) ─────────────────────────────────────────────────────────
export const USERS = [
  { id: 'u1', name: '홍길동', dept: '상황총괄반', role: '상황총괄' },
  { id: 'u2', name: '김민수', dept: '현장통제반', role: '현장' },
  { id: 'u3', name: '이지은', dept: '시설복구반', role: '현장' },
  { id: 'u4', name: '박서준', dept: '주민대피지원반', role: '현장' },
  { id: 'u5', name: '최유진', dept: '유관기관협력반', role: '협력' },
  { id: 'u6', name: '정하늘', dept: '안전총괄과', role: '계획 작성자' },
];
/**
 * 기관·조직 설정(2026-08-23, 범용화 ①). 단일 행. 없으면 USERS 6명 + 풍수해 13개 협업기능으로 seed.
 * 매뉴얼 구조(재설계안 1.3): 협업기능 ①~⑬ → 실무반 → 부서 → 담당자. 보고 라인·전파 대상군·운영 설정도 여기.
 */
interface OrgRow extends Row {
  name: string; hq: string;
  coopFunctions: { code: string; name: string }[];
  teams: { id: string; name: string; coopCodes: string[]; depts: string[] }[];
  depts: { id: string; name: string; phone?: string }[];
  members: { id: string; name: string; dept: string; role: string; phone?: string }[];
  reportLines: { internal: string[]; upper: string[]; central: string[] };
  audiences: { id: string; name: string; kind: '내부' | '유관기관' | '주민' | '대국민'; contacts?: string }[];
  settings: { delayMinutes: number; defaultChannels: string[]; autoLogRules: string[]; autoLogWarnings: boolean; weatherPlace?: string };
}
const orgs = col<OrgRow>('org');
const DEFAULT_COOP = ['재난상황관리', '긴급생활안정지원', '긴급통신지원', '시설피해 응급복구', '에너지 공급 피해시설 복구', '재난관리자원 지원', '교통대책', '의료 및 방역 서비스', '재난현장 환경정비', '자원봉사 지원 및 관리', '사회질서 유지·주민대피', '수색·구조·구급', '재난수습 홍보'].map((name, i) => ({ code: String.fromCharCode(0x2460 + i), name }));
function ensureOrg(): OrgRow {
  const cur = orgs.all()[0]; if (cur) return cur;
  const depts = [...new Set(USERS.map((u) => u.dept))].map((name, i) => ({ id: `d${i + 1}`, name }));
  return orgs.insert({
    name: '○○시', hq: '○○시 재난안전대책본부', coopFunctions: DEFAULT_COOP,
    teams: [{ id: 't1', name: '상황총괄반', coopCodes: ['①'], depts: ['상황총괄반', '안전총괄과'] }, { id: 't2', name: '현장통제반', coopCodes: ['⑪', '⑫'], depts: ['현장통제반'] }, { id: 't3', name: '시설복구반', coopCodes: ['④', '⑤'], depts: ['시설복구반'] }, { id: 't4', name: '주민대피지원반', coopCodes: ['②', '⑪'], depts: ['주민대피지원반'] }, { id: 't5', name: '유관기관협력반', coopCodes: ['③', '⑥'], depts: ['유관기관협력반'] }],
    depts, members: USERS.map((u) => ({ ...u })),
    reportLines: { internal: ['시장', '부시장', '안전총괄국장'], upper: ['○○도 재난관리과'], central: ['행정안전부 중앙재난안전상황실'] },
    audiences: [{ id: 'a1', name: '지대본 실무반', kind: '내부' }, { id: 'a2', name: '유관기관(소방·경찰·한전·KT)', kind: '유관기관' }, { id: 'a3', name: '사전지정 위험지역 주민', kind: '주민' }, { id: 'a4', name: '대국민(CBS·재난방송)', kind: '대국민' }],
    settings: { delayMinutes: 10, defaultChannels: ['문자', '알림톡'], autoLogRules: ['전파 시 자동 기록', '수신 확인 시 자동 기록', '완료 보고 시 자동 기록', '지연 발생 시 자동 기록'], autoLogWarnings: false },
  });
}
/** 담당자 목록 — 기관 설정의 members. 예전 USERS 모양({id,name,dept,role}) 그대로 */
const members = () => ensureOrg().members;
app.get('/api/users', (_req, res) => res.json(members()));
app.get('/api/org', (_req, res) => res.json(ensureOrg()));
app.put('/api/org', (req, res) => { const o = ensureOrg(); const b = req.body ?? {}; delete b.id; delete b.createdAt; res.json(orgs.update(o.id, b)); });
app.get('/api/health', (_req, res) => res.json({ ok: true, uni: uniStatus(), t3q: t3qStatus(), rhwp: { version: rhwpVersion() }, weather: weatherStatus(), time: now() }));
// 날씨·기상특보 (weather.ts): 10분 캐시, 외부 실패 시 마지막 값→목업 폴백(source로 구분)
app.get('/api/weather', async (req, res) => res.json(await getWeather(req.query.place as string | undefined)));
app.get('/api/weather/warnings', async (_req, res) => res.json(await getWarnings()));
app.get('/api/files/:name', (req, res) => {
  const p = join(FILES_DIR, req.params.name.replace(/[\\/]/g, ''));
  if (!existsSync(p)) return bad(res, 404, '파일 없음');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(req.params.name)}`);
  res.sendFile(p);
});

// ── 템플릿 ────────────────────────────────────────────────────────────────
interface TemplateRow extends Row { name: string; fileName: string; storedPath: string; profile: TemplateProfile; builtin: boolean }
const templates = col<TemplateRow>('templates');

async function registerTemplate(name: string, fileName: string, bytes: Uint8Array, builtin: boolean): Promise<TemplateRow> {
  const profile = await profileTemplate(bytes);
  const stored = `tpl_${nanoid(6)}_${fileName}`;
  writeFileSync(join(FILES_DIR, stored), bytes);
  return templates.insert({ name, fileName, storedPath: stored, profile, builtin });
}
async function seedTemplates() {
  if (!existsSync(TEMPLATE_DIR)) return;
  for (const f of readdirSync(TEMPLATE_DIR).filter((x) => x.toLowerCase().endsWith('.hwpx'))) {
    if (templates.where((t) => t.fileName === f && t.builtin).length) continue;
    try { await registerTemplate(f.replace(/\.hwpx$/i, ''), f, new Uint8Array(readFileSync(join(TEMPLATE_DIR, f))), true); console.log('템플릿 등록:', f); }
    catch (e) { console.error('템플릿 실패:', f, (e as Error).message); }
  }
}
/** 프로파일 형식이 바뀐 뒤(글자모양 ID·표 스타일 추가) 등록된 적 없는 템플릿은 저장된 파일로 다시 분석한다 — 서버 시작 때 한 번 */
async function refreshProfiles() {
  for (const t of templates.all()) {
    const stale = t.profile.tableStyle === undefined || !t.profile.levels.some((l) => l.charShapeId != null) || (t.profile.version ?? 1) < PROFILE_VERSION;
    if (!stale) continue;
    try { templates.update(t.id, { profile: await profileTemplate(new Uint8Array(readFileSync(join(FILES_DIR, t.storedPath)))) }); console.log('템플릿 재분석:', t.name); }
    catch (e) { console.error('템플릿 재분석 실패:', t.name, (e as Error).message); }
  }
}
const tplSummary = (t: TemplateRow) => ({ id: t.id, name: t.name, fileName: t.fileName, builtin: t.builtin, createdAt: t.createdAt, levels: t.profile.levels, bodyFontFamily: t.profile.bodyFontFamily, bodyFontSizePt: t.profile.bodyFontSizePt, styleCount: t.profile.styles.length, pageCount: t.profile.pageCount, styleRuleText: t.profile.styleRuleText, tableStyle: t.profile.tableStyle ?? null });
app.get('/api/templates', (_req, res) => res.json(templates.all().map(tplSummary)));
app.get('/api/templates/:id', (req, res) => { const t = templates.get(req.params.id); return t ? res.json({ ...tplSummary(t), profile: t.profile }) : bad(res, 404, '없음'); });
app.post('/api/templates', upload.single('file'), async (req, res) => {
  if (!req.file) return bad(res, 400, 'file 필요');
  // multer는 파일명을 latin1로 넘긴다 — 한글 파일명이 깨지던 원인(2026-08-21)
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  try { const t = await registerTemplate((req.body?.name as string) || originalName.replace(/\.hwpx$/i, ''), originalName, new Uint8Array(req.file.buffer), false); res.json(tplSummary(t)); }
  catch (e) { bad(res, 422, `HWPX 분석 실패: ${(e as Error).message}`); }
});
app.get('/api/templates/:id/preview', async (req, res) => {
  const t = templates.get(req.params.id); if (!t) return bad(res, 404, '없음');
  const r = await renderHwpxSvg(new Uint8Array(readFileSync(join(FILES_DIR, t.storedPath))), 3);
  res.json(r);
});
app.delete('/api/templates/:id', (req, res) => { const t = templates.get(req.params.id); if (!t) return bad(res, 404, '없음'); if (t.builtin) return bad(res, 400, '내장 템플릿은 삭제 불가'); templates.remove(t.id); res.json({ ok: true }); });

// ── 계획서 ────────────────────────────────────────────────────────────────
type SecStatus = '-' | '대기' | '진행중' | '취소대기' | '취소' | '완료' | '오류';
interface Section { tocId: string; status: SecStatus; markdown: string; userEdited: boolean; sources: unknown[]; history: { at: string; paraId: string; before: string; after: string; instruction: string }[]; origin?: string; provider?: string; references?: unknown[] }
interface PlanRow extends Row { title: string; hazardType?: string; managementPhase?: string; createdBy: string; updatedBy?: string; context: PlanContext | null; toc: TocNode[]; sections: Record<string, Section>; export?: { fileName: string; at: string; pages: number }; linkedExercises: string[]; tocProvider?: string; tocError?: string }
const plans = col<PlanRow>('plans');
const planTemplates = col<Row & { name: string; context: PlanContext; createdBy: string; updatedBy?: string }>('plan_templates');
const cancelFlags = new Map<string, boolean>();

const planSummary = (p: PlanRow) => ({ id: p.id, title: p.title, hazardType: p.context?.hazardType ?? p.hazardType, managementPhase: p.context?.managementPhase ?? p.managementPhase, createdBy: p.createdBy, updatedBy: p.updatedBy, createdAt: p.createdAt, updatedAt: p.updatedAt, hasToc: p.toc.length > 0, drafted: draftableIds(p.toc).filter((id) => p.sections[id]?.status === '완료').length, total: draftableIds(p.toc).length, exported: !!p.export, linkedExercises: p.linkedExercises });
app.get('/api/plans', (_req, res) => res.json(plans.all().filter(alive).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(planSummary)));
app.post('/api/plans', (req, res) => { const { title, createdBy } = req.body ?? {}; if (!title) return bad(res, 400, 'title 필요'); res.json(plans.insert({ title, createdBy: createdBy ?? '사용자', context: null, toc: [], sections: {}, linkedExercises: [] })); });
app.get('/api/plans/:id', (req, res) => { const p = plans.get(req.params.id); return p ? res.json(p) : bad(res, 404, '없음'); });
app.delete('/api/plans/:id', (req, res) => { const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음'); plans.update(p.id, { deletedAt: now(), deletedBy: (req.query.by as string) || undefined }); res.json({ ok: true, trashed: true }); });
app.put('/api/plans/:id/context', (req, res) => { const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음'); const c = req.body as PlanContext; res.json(plans.update(p.id, { context: c, hazardType: c.hazardType, managementPhase: c.managementPhase, updatedBy: (req.body.updatedBy as string) ?? p.updatedBy })); });
app.post('/api/plans/:id/save-as', (req, res) => { const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음'); res.json(plans.insert({ title: req.body?.title ?? `${p.title} 사본`, createdBy: p.createdBy, context: p.context, toc: [], sections: {}, linkedExercises: [] })); });

/** 템플릿 프로파일의 수준별 기호 - T3Q paragraphSymbol과 본문 정규화에 쓴다. */
function symbolsOf(p: PlanRow): string[] {
  const t = p.context?.templateId ? templates.get(p.context.templateId) : null;
  const syms = (t?.profile.levels ?? []).map((l) => l.bullet).filter(Boolean);
  return syms.length ? syms : ['□', 'ㅇ', '-', '*'];
}
/** 기동 시 1회: 옛 변환으로 저장된 T3Q 초안("- ○- 문장", 절 제목 반복)을 새 규칙으로 다시 정리한다. 멱등. */
function cleanupT3qSections() {
  let n = 0;
  for (const p of plans.all()) {
    const sections = { ...p.sections }; let changed = false;
    for (const [id, s] of Object.entries(sections)) {
      if (s.provider !== 't3q' || !s.markdown || s.userEdited) continue;
      const node = p.toc.flatMap((c) => [c, ...c.children]).find((x) => x.id === id);
      const md = t3qContentToMarkdown(s.markdown, symbolsOf(p), node?.title);
      if (md !== s.markdown) { sections[id] = { ...s, markdown: md }; changed = true; n++; }
    }
    if (changed) plans.update(p.id, { sections });
  }
  if (n) console.log(`T3Q 초안 기호 정리: ${n}개 절`);
}
function styleRuleOf(p: PlanRow): string {
  const t = p.context?.templateId ? templates.get(p.context.templateId) : null;
  return t?.profile.styleRuleText ?? '문서 스타일 규칙: 1수준 "□" 16pt 굵게, 2수준 "ㅇ" 15pt, 3수준 "-" 15pt, 4수준 "*" 12pt. 본문 12pt.';
}
app.post('/api/plans/:id/toc', async (req, res) => {
  const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음'); if (!p.context) return bad(res, 400, '기준정보 먼저');
  const r = await llm.generateTocWithProvider(p.context, styleRuleOf(p), symbolsOf(p).join(' '));
  res.json({ ...plans.update(p.id, { toc: r.toc, sections: {}, tocProvider: r.provider, tocError: r.error }), tocProvider: r.provider, tocError: r.error });
});
app.put('/api/plans/:id/toc', (req, res) => {
  const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음');
  const toc = req.body as TocNode[];
  const ids = new Set<string>(); for (const n of toc) { ids.add(n.id); for (const c of n.children) ids.add(c.id); }
  const sections: Record<string, Section> = {}; for (const [k, v] of Object.entries(p.sections)) if (ids.has(k)) sections[k] = v;
  res.json(plans.update(p.id, { toc, sections }));
});
app.get('/api/plans/:id/draft/:tocId/stream', async (req, res) => {
  const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음'); if (!p.context) return bad(res, 400, '기준정보 먼저');
  const tocId = req.params.tocId;
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const key = `${p.id}:${tocId}`; cancelFlags.set(key, false);
  const sec: Section = p.sections[tocId] ?? { tocId, status: '-', markdown: '', userEdited: false, sources: [], history: [] };
  if (sec.userEdited && req.query.force !== '1') { send('done', { markdown: sec.markdown, protected: true }); return res.end(); }
  sec.status = '진행중'; plans.update(p.id, { sections: { ...p.sections, [tocId]: sec } });
  let sources: unknown[] = [];
  const planExcerpt = p.context.linkedExerciseId ? undefined : undefined;
  try {
    const r = await llm.draftSectionWithProvider(p.context, p.toc, tocId, styleRuleOf(p), symbolsOf(p), {
      onToken: (t) => { if (cancelFlags.get(key)) throw new Error('CANCELLED'); send('token', { text: t }); },
      onSources: (s) => { sources = s; send('sources', { sources: s }); },
    }, planExcerpt);
    const cur = plans.get(p.id)!;
    const done: Section = { ...sec, status: '완료', markdown: r.markdown, sources, provider: r.provider, references: r.references };
    plans.update(p.id, { sections: { ...cur.sections, [tocId]: done } });
    send('done', { markdown: r.markdown, provider: r.provider, error: r.error });
  } catch (e) {
    const cur = plans.get(p.id)!;
    const cancelled = (e as Error).message === 'CANCELLED';
    plans.update(p.id, { sections: { ...cur.sections, [tocId]: { ...sec, status: cancelled ? '취소' : '오류' } } });
    send(cancelled ? 'cancelled' : 'error', { message: (e as Error).message });
  }
  res.end();
});
app.post('/api/plans/:id/draft/:tocId/cancel', (req, res) => { cancelFlags.set(`${req.params.id}:${req.params.tocId}`, true); res.json({ ok: true }); });
app.put('/api/plans/:id/sections/:tocId', (req, res) => {
  const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음');
  const prev = p.sections[req.params.tocId] ?? { tocId: req.params.tocId, status: '완료', markdown: '', userEdited: false, sources: [], history: [] };
  const sec: Section = { ...prev, markdown: req.body.markdown ?? prev.markdown, userEdited: req.body.userEdited ?? true, status: '완료' };
  res.json(plans.update(p.id, { sections: { ...p.sections, [req.params.tocId]: sec } }));
});

/** 문단 분할 규약: 빈 줄 기준. 표 블록은 하나의 문단. */
export function splitParas(md: string): string[] { return md.replace(/\r/g, '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean); }
app.post('/api/plans/:id/revise', async (req, res) => {
  const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음');
  const { paraId, instruction } = req.body as { paraId: string; instruction: string };
  const [tocId, pi] = paraId.split('#p'); const idx = Number(pi);
  const sec = p.sections[tocId]; if (!sec) return bad(res, 404, '섹션 없음');
  const paras = splitParas(sec.markdown); if (!(idx in paras)) return bad(res, 404, '문단 없음');
  const after = await llm.revisePara(paras[idx], paras[idx - 1] ?? '', paras[idx + 1] ?? '', instruction, styleRuleOf(p));
  const before = paras[idx]; paras[idx] = after;
  const updated: Section = { ...sec, markdown: paras.join('\n\n'), userEdited: true, history: [...sec.history, { at: now(), paraId, before, after, instruction }] };
  plans.update(p.id, { sections: { ...p.sections, [tocId]: updated } });
  res.json({ paraId, before, after });
});
app.post('/api/plans/:id/revert', (req, res) => {
  const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음');
  const { paraId } = req.body as { paraId: string }; const [tocId, pi] = paraId.split('#p'); const idx = Number(pi);
  const sec = p.sections[tocId]; if (!sec) return bad(res, 404, '섹션 없음');
  const last = [...sec.history].reverse().find((h) => h.paraId === paraId); if (!last) return bad(res, 404, '이력 없음');
  const paras = splitParas(sec.markdown); paras[idx] = last.before;
  plans.update(p.id, { sections: { ...p.sections, [tocId]: { ...sec, markdown: paras.join('\n\n'), history: sec.history.filter((h) => h !== last) } } });
  res.json({ ok: true, markdown: paras.join('\n\n') });
});

/** 초안을 만드는 목차 항목 — 하위 목차가 있는 장은 제목만 두고 본문을 만들지 않는다(장·절 내용이 겹치던 문제, 2026-08-21). 평평한 목차면 장이 곧 본문 단위 */
export const draftable = (n: TocNode) => n.children.length === 0;
export const draftableIds = (toc: TocNode[]) => toc.flatMap((n) => (draftable(n) ? [n.id] : n.children.map((c) => c.id)));
export function planMarkdown(p: PlanRow): string {
  const out: string[] = [];
  for (const n of p.toc) {
    out.push(`# ${n.no} ${n.title}`);
    if (draftable(n) && p.sections[n.id]?.markdown) out.push(p.sections[n.id].markdown);
    for (const c of n.children) { out.push(`## ${c.no} ${c.title}`); if (p.sections[c.id]?.markdown) out.push(p.sections[c.id].markdown); }
  }
  return out.join('\n\n');
}
async function templateFor(p: { context: PlanContext | null }): Promise<{ bytes: Uint8Array; profile: TemplateProfile; row: TemplateRow }> {
  const t = (p.context?.templateId ? templates.get(p.context.templateId) : null) ?? templates.where((x) => /템플릿_01/.test(x.fileName))[0] ?? templates.all()[0];
  if (!t) throw new Error('템플릿 없음');
  return { bytes: new Uint8Array(readFileSync(join(FILES_DIR, t.storedPath))), profile: t.profile, row: t };
}
app.post('/api/plans/:id/export', async (req, res) => {
  const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음');
  try {
    const { bytes, profile } = await templateFor(p);
    const out = await buildHwpx(bytes, profile, p.title, planMarkdown(p), { reportedAt: p.context?.reportedAt, reporter: p.updatedBy ?? p.createdBy });
    const fileName = `plan_${p.id}_${Date.now()}.hwpx`; writeFileSync(join(FILES_DIR, fileName), out);
    const r = await renderHwpxSvg(out, 1);
    plans.update(p.id, { export: { fileName, at: now(), pages: r.pages } });
    res.json({ fileName, url: `/api/files/${fileName}`, pages: r.pages });
  } catch (e) { bad(res, 500, `내보내기 실패: ${(e as Error).message}`); }
});
app.get('/api/plans/:id/export/preview', async (req, res) => {
  const p = plans.get(req.params.id); if (!p?.export) return bad(res, 404, '내보낸 파일 없음');
  const r = await renderHwpxSvg(new Uint8Array(readFileSync(join(FILES_DIR, p.export.fileName))), 30); res.json(r);
});
app.post('/api/plans/:id/import-hwpx', upload.single('file'), async (req, res) => {
  const p = plans.get(req.params.id); if (!p) return bad(res, 404, '없음'); if (!req.file) return bad(res, 400, 'file 필요');
  const bytes = new Uint8Array(req.file.buffer);
  const fileName = `plan_${p.id}_edited_${Date.now()}.hwpx`; writeFileSync(join(FILES_DIR, fileName), bytes);
  const paras = await extractParagraphs(bytes);
  const r = await renderHwpxSvg(bytes, 1);
  plans.update(p.id, { export: { fileName, at: now(), pages: r.pages } });
  res.json({ fileName, url: `/api/files/${fileName}`, paragraphs: paras.filter(Boolean).length });
});
app.get('/api/plan-templates', (_req, res) => res.json(planTemplates.all().filter(alive)));
app.post('/api/plan-templates', (req, res) => res.json(planTemplates.insert({ name: req.body.name, context: req.body.context, createdBy: req.body.createdBy ?? '사용자' })));
app.get('/api/plan-templates/:id', (req, res) => { const t = planTemplates.get(req.params.id); return t ? res.json(t) : bad(res, 404, '없음'); });
app.put('/api/plan-templates/:id', (req, res) => {
  const t = planTemplates.get(req.params.id); if (!t) return bad(res, 404, '없음');
  const { name, context, updatedBy } = req.body as { name?: string; context?: PlanContext; updatedBy?: string };
  const patch: Partial<typeof t> = {};
  if (typeof name === 'string' && name.trim()) patch.name = name.trim().slice(0, 20);
  if (context && typeof context === 'object') patch.context = context;
  if (typeof updatedBy === 'string' && updatedBy) patch.updatedBy = updatedBy;
  planTemplates.update(t.id, patch);
  res.json(planTemplates.get(t.id));
});
app.delete('/api/plan-templates/:id', (req, res) => { const t = planTemplates.get(req.params.id); if (!t) return bad(res, 404, '없음'); planTemplates.update(t.id, { deletedAt: now(), deletedBy: (req.query.by as string) || undefined }); res.json({ ok: true, trashed: true }); });

// ── 훈련(상황일지) ────────────────────────────────────────────────────────
type ExStatus = 'DRAFT' | 'SOP_READY' | 'RUNNING' | 'CLOSED';
interface ChatMsg { role: 'user' | 'assistant'; text: string; at: string; sources?: unknown[] }
type ExMode = '실제상황' | '안전한국훈련' | '도상훈련';
type ExStage = '징후감지' | '초기대응' | '비상1' | '비상2·3' | '수습복구';
/** 2026-08-23 범용화 ①: mode·stage·경보/단계 이력·특보 스냅샷은 "필드 추가"만 — 없는 행은 훈련(안전한국훈련)으로 읽는다 */
interface ExerciseRow extends Row { chat?: ChatMsg[]; citedSources?: { filename: string; score: number; text: string; doc_id?: string }[]; title: string; hazardType: string; phase: string; alertLevel: string; occurredAt: string; location: string; agency: string; dept: string; scenario: string; refData: string[]; options: string[]; status: ExStatus; linkedPlanId: string | null; startedAt?: string; closedAt?: string; createdBy: string; analysis?: { suggestion: string; basis: string; at: string };
  mode?: ExMode; stage?: ExStage; alertHistory?: { level: string; at: string; by?: string; reason?: string; meetingId?: string }[]; stageHistory?: { stage: ExStage; at: string; by?: string; meetingId?: string }[]; warningsSnapshot?: { at: string; active: { kind: string; level: string; regions: string }[] } }
interface MeetingRow extends Row { exerciseId: string; at: string; chair: string; attendees: string[]; agenda: string; decisions: { alertLevel?: string; stage?: ExStage; evacuation?: boolean; cbs?: boolean; other?: string }; memo?: string; by?: string }
interface SopRow extends Row { exerciseId: string; version: number; graph: SopGraph }
type TaskStatus = '대기' | '전파완료' | '수신확인' | '수행중' | '완료' | '지연' | '미완료' | '지원요청';
interface TaskRow extends Row { exerciseId: string; nodeId: string; seq: number; title: string; type: string; dept: string; assigneeId: string; assigneeName: string; due: string; priority: string; status: TaskStatus; instructions: string[]; message?: string; dispatchedAt?: string; ackedAt?: string; reportedAt?: string; memo?: string; receiptNo?: string; result?: string }
interface EventRow extends Row { exerciseId: string; at: string; kind: string; content: string; dept?: string; actor?: string; status?: string; source: string; taskId?: string }
interface JournalRow extends Row { exerciseId: string; sections: { key: string; title: string; kind: 'fact' | 'narrative'; markdown: string; aiGenerated: boolean; reviewed: boolean }[]; export?: { fileName: string; at: string; pages?: number; templateId?: string; templateName?: string } }
const exercises = col<ExerciseRow>('exercises');
const sops = col<SopRow>('sops');
const tasks = col<TaskRow>('tasks');
const events = col<EventRow>('events');
const journals = col<JournalRow>('journals');
const meetings = col<MeetingRow>('meetings');
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const logEvent = (exerciseId: string, kind: string, content: string, extra: Partial<EventRow> = {}) => events.insert({ exerciseId, at: now(), kind, content, source: extra.source ?? 'SOP 자동기록', ...extra });
const latestSop = (exId: string) => sops.where((s) => s.exerciseId === exId).sort((a, b) => b.version - a.version)[0];

/** 지연 판정: 완료 전이고 기한 지남 → 지연 이벤트 1회 */
function markOverdue(exId: string) {
  const exRow = exercises.get(exId); if (!exRow || exRow.status !== 'RUNNING') return; // 종료·미실행 훈련은 지연 판정 안 함
  const t = Date.now();
  for (const task of tasks.where((x) => x.exerciseId === exId)) {
    if (['완료', '지연', '대기'].includes(task.status)) continue;
    if (task.due && new Date(task.due).getTime() < t) { tasks.update(task.id, { status: '지연' }); logEvent(exId, '지연', `${task.title} — 완료기한 초과`, { dept: task.dept, actor: task.assigneeName, status: '지연', taskId: task.id }); }
  }
}

const exMode = (e: ExerciseRow): ExMode => e.mode ?? '안전한국훈련';
app.get('/api/exercises', (req, res) => { const m = req.query.mode as string | undefined; res.json(exercises.all().filter(alive).filter((e) => !m || exMode(e) === m).map((e) => ({ ...e, mode: exMode(e) })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); });
/** 발생위치 문자열에서 시·군·구 이름 토큰("강원특별자치도 원주시 …" → ["원주"]) — 특보 지역 문자열과 맞춰 본다 */
const placeTokens = (location: string) => location.split(/[\s,()·]+/).map((t) => t.replace(/(특별자치도|특별자치시|특별시|광역시|도|시|군|구|읍|면|동)$/, '')).filter((t) => t.length >= 2);
const warningsFor = (location: string, active: { kind: string; level: string; regions: string }[]) => { const toks = placeTokens(location); return toks.length ? active.filter((w) => toks.some((t) => w.regions.includes(t))) : []; };
app.post('/api/exercises', async (req, res) => {
  const b = req.body ?? {};
  const mode: ExMode = ['실제상황', '안전한국훈련', '도상훈련'].includes(b.mode) ? b.mode : '안전한국훈련';
  // 실제상황이면 생성 시점의 기상특보를 스냅샷으로 붙인다(4장 규칙). 훈련은 요청에 스냅샷이 있으면 그대로
  let warningsSnapshot: ExerciseRow['warningsSnapshot'] = b.warningsSnapshot;
  if (mode === '실제상황' && !warningsSnapshot) { try { const w = await getWarnings(); warningsSnapshot = { at: w.fetchedAt, active: w.active }; } catch { /* 특보 없이 진행 */ } }
  const ex = exercises.insert({ title: b.title ?? (mode === '실제상황' ? '상황' : '훈련'), hazardType: b.hazardType ?? '태풍/호우', phase: b.phase ?? '대응', alertLevel: b.alertLevel ?? '경계', occurredAt: b.occurredAt ?? now(), location: b.location ?? '', agency: b.agency ?? '', dept: b.dept ?? '', scenario: b.scenario ?? '', refData: b.refData ?? [], options: b.options ?? [], status: 'DRAFT', linkedPlanId: b.linkedPlanId ?? null, createdBy: b.createdBy ?? '사용자', chat: Array.isArray(b.chat) ? b.chat : [], citedSources: Array.isArray(b.citedSources) ? b.citedSources : [],
    mode, stage: (b.stage as ExStage) ?? '초기대응', alertHistory: [{ level: b.alertLevel ?? '경계', at: now(), by: b.createdBy, reason: '상황 생성' }], stageHistory: [{ stage: (b.stage as ExStage) ?? '초기대응', at: now(), by: b.createdBy }], warningsSnapshot });
  logEvent(ex.id, '최초상황', `${ex.title} — ${ex.scenario.slice(0, 80) || (mode === '실제상황' ? '상황 등록' : '훈련상황 등록')}`, { source: mode === '실제상황' ? '상황 접수' : '훈련 시나리오', dept: ex.dept, actor: ex.createdBy, status: '기록완료' });
  if (warningsSnapshot?.active.length) { const hit = warningsFor(ex.location, warningsSnapshot.active); if (hit.length) logEvent(ex.id, '기상특보', `생성 시점 발효 특보: ${hit.map((w) => w.kind).join(', ')}`, { source: '기상청 특보', status: '참고' }); }
  if (ex.linkedPlanId) { const p = plans.get(ex.linkedPlanId); if (p) plans.update(p.id, { linkedExercises: [...new Set([...p.linkedExercises, ex.id])] }); }
  res.json(ex);
});
app.get('/api/exercises/:id', (req, res) => { const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); markOverdue(ex.id); res.json({ ...ex, mode: exMode(ex), stage: ex.stage ?? '초기대응', meetings: meetings.where((m) => m.exerciseId === ex.id).sort((a, b) => b.at.localeCompare(a.at)), pendingWarnings: pendingWarnings.get(ex.id) ?? [], sop: latestSop(ex.id) ?? null, tasks: tasks.where((t) => t.exerciseId === ex.id).sort((a, b) => a.seq - b.seq), eventCount: events.where((e) => e.exerciseId === ex.id).length, journal: journals.where((j) => j.exerciseId === ex.id)[0] ?? null }); });
app.put('/api/exercises/:id', (req, res) => { const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); res.json(exercises.update(ex.id, req.body)); });
const purgeExercise = (id: string) => { for (const c of [sops, tasks, events, journals]) for (const r of (c as ReturnType<typeof col>).where((x) => x.exerciseId === id)) c.remove(r.id); return exercises.remove(id); };
app.delete('/api/exercises/:id', (req, res) => { const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); exercises.update(ex.id, { deletedAt: now(), deletedBy: (req.query.by as string) || undefined }); res.json({ ok: true, trashed: true }); });

// ── 위기경보 · 비상단계 · 상황판단회의 (범용화 ①) ──────────────────────────
const ALERTS = ['관심', '주의', '경계', '심각'];
const STAGES: ExStage[] = ['징후감지', '초기대응', '비상1', '비상2·3', '수습복구'];
function setAlert(ex: ExerciseRow, level: string, by?: string, reason?: string, meetingId?: string) {
  if (!ALERTS.includes(level) || level === ex.alertLevel) return false;
  const prev = ex.alertLevel;
  exercises.update(ex.id, { alertLevel: level, alertHistory: [...(ex.alertHistory ?? []), { level, at: now(), by, reason, meetingId }] });
  logEvent(ex.id, '위기경보 변경', `위기경보 ${prev} → ${level}${reason ? ` (${reason})` : ''}`, { source: meetingId ? '상황판단회의' : '수동 입력', actor: by, status: level });
  return true;
}
function setStage(ex: ExerciseRow, stage: ExStage, by?: string, meetingId?: string) {
  if (!STAGES.includes(stage) || stage === (ex.stage ?? '초기대응')) return false;
  const prev = ex.stage ?? '초기대응';
  exercises.update(ex.id, { stage, stageHistory: [...(ex.stageHistory ?? []), { stage, at: now(), by, meetingId }] });
  logEvent(ex.id, '비상단계 변경', `대응 단계 ${prev} → ${stage}`, { source: meetingId ? '상황판단회의' : '수동 입력', actor: by, status: stage });
  return true;
}
app.put('/api/exercises/:id/alert', (req, res) => { const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); setAlert(ex, req.body?.level, req.body?.by, req.body?.reason); res.json(exercises.get(ex.id)); });
app.put('/api/exercises/:id/stage', (req, res) => { const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); setStage(ex, req.body?.stage, req.body?.by); res.json(exercises.get(ex.id)); });
app.get('/api/exercises/:id/meetings', (req, res) => res.json(meetings.where((m) => m.exerciseId === req.params.id).sort((a, b) => b.at.localeCompare(a.at))));
/** 상황판단회의: 결정(경보·단계·대피명령·CBS)을 저장하고 이벤트로 남긴다. 매뉴얼 1.4: 경보·단계는 회의에서 결정 */
app.post('/api/exercises/:id/meetings', (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음');
  const b = req.body ?? {}; const d = b.decisions ?? {};
  const m = meetings.insert({ exerciseId: ex.id, at: b.at ?? now(), chair: b.chair ?? '', attendees: Array.isArray(b.attendees) ? b.attendees : [], agenda: b.agenda ?? '', decisions: d, memo: b.memo, by: b.by });
  const parts: string[] = [];
  if (d.alertLevel && setAlert(exercises.get(ex.id)!, d.alertLevel, b.by, '상황판단회의 결정', m.id)) parts.push(`위기경보 ${d.alertLevel}`);
  if (d.stage && setStage(exercises.get(ex.id)!, d.stage, b.by, m.id)) parts.push(`단계 ${d.stage}`);
  if (d.evacuation) parts.push('대피명령 발령'); if (d.cbs) parts.push('CBS 긴급재난문자 발송'); if (d.other) parts.push(d.other);
  logEvent(ex.id, '상황판단회의', `상황판단회의(주재 ${m.chair || '-'}) — ${parts.length ? '결정: ' + parts.join(', ') : '결정 사항 없음'}${m.agenda ? ` · 안건: ${m.agenda.slice(0, 60)}` : ''}`, { source: '상황판단회의', actor: b.by, status: '기록완료' });
  res.json({ ...m, exercise: exercises.get(ex.id) });
});

/**
 * 기상특보 감시(재설계안 4장): 10분마다 발효 특보를 상황의 스냅샷과 비교해 발생위치 시·군이 걸린 발표·해제를
 * 후보로 쌓는다. 담당자가 [기록]하면 '기상특보' 이벤트 + 스냅샷 갱신, [무시]하면 스냅샷만 갱신. 기관 설정 autoLogWarnings면 바로 기록.
 */
interface PendingWarning { id: string; at: string; change: '발표' | '해제'; kind: string; level: string; regions: string }
const pendingWarnings = new Map<string, PendingWarning[]>();
async function checkWarnings() {
  let w: Awaited<ReturnType<typeof getWarnings>>; try { w = await getWarnings(); } catch { return; }
  if (w.source === 'mock') return;
  const auto = ensureOrg().settings.autoLogWarnings;
  for (const ex of exercises.all().filter(alive).filter((e) => e.status !== 'CLOSED' && e.location)) {
    const before = warningsFor(ex.location, ex.warningsSnapshot?.active ?? []); const after = warningsFor(ex.location, w.active);
    const key = (x: { kind: string }) => x.kind;
    const added = after.filter((a) => !before.some((b) => key(b) === key(a))); const removed = before.filter((b) => !after.some((a) => key(a) === key(b)));
    if (!added.length && !removed.length) continue;
    const items: PendingWarning[] = [...added.map((a) => ({ id: nanoid(6), at: w.fetchedAt, change: '발표' as const, kind: a.kind, level: a.level, regions: a.regions })), ...removed.map((r) => ({ id: nanoid(6), at: w.fetchedAt, change: '해제' as const, kind: r.kind, level: r.level, regions: r.regions }))];
    if (auto) { for (const it of items) logEvent(ex.id, '기상특보', `${it.kind} ${it.change} — ${it.regions.slice(0, 80)}`, { source: '기상청 특보', status: it.change }); exercises.update(ex.id, { warningsSnapshot: { at: w.fetchedAt, active: w.active } }); }
    else { const cur = pendingWarnings.get(ex.id) ?? []; for (const it of items) if (!cur.some((c) => c.kind === it.kind && c.change === it.change)) cur.push(it); pendingWarnings.set(ex.id, cur); }
  }
}
app.get('/api/exercises/:id/pending-warnings', (req, res) => res.json(pendingWarnings.get(req.params.id) ?? []));
app.post('/api/exercises/:id/pending-warnings/:pid/:action', async (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음');
  const list = pendingWarnings.get(ex.id) ?? []; const it = list.find((x) => x.id === req.params.pid); if (!it) return bad(res, 404, '후보 없음');
  if (req.params.action === 'record') logEvent(ex.id, '기상특보', `${it.kind} ${it.change} — ${it.regions.slice(0, 80)}`, { source: '기상청 특보', actor: req.body?.by, status: it.change });
  pendingWarnings.set(ex.id, list.filter((x) => x.id !== it.id));
  try { const w = await getWarnings(); exercises.update(ex.id, { warningsSnapshot: { at: w.fetchedAt, active: w.active } }); } catch { /* ignore */ }
  res.json({ ok: true, remaining: pendingWarnings.get(ex.id) ?? [] });
});

// ── 휴지통 ────────────────────────────────────────────────────────────────
type TrashKind = 'plan' | 'planTemplate' | 'exercise';
interface TrashItem { kind: TrashKind; id: string; title: string; sub: string; createdBy: string; deletedAt: string; deletedBy?: string }
const trashItems = (): TrashItem[] => [
  ...plans.where((p) => !alive(p)).map((p): TrashItem => ({ kind: 'plan', id: p.id, title: p.title, sub: [p.context?.hazardType ?? p.hazardType, p.context?.managementPhase ?? p.managementPhase].filter(Boolean).join(' · ') || '기준정보 없음', createdBy: p.createdBy, deletedAt: p.deletedAt as string, deletedBy: p.deletedBy as string | undefined })),
  ...planTemplates.where((t) => !alive(t)).map((t): TrashItem => ({ kind: 'planTemplate', id: t.id, title: t.name, sub: [t.context.hazardType, t.context.managementPhase].filter(Boolean).join(' · '), createdBy: t.createdBy, deletedAt: t.deletedAt as string, deletedBy: t.deletedBy as string | undefined })),
  ...exercises.where((e) => !alive(e)).map((e): TrashItem => ({ kind: 'exercise', id: e.id, title: e.title, sub: [e.hazardType, `상황단계 ${e.alertLevel}`, e.status].join(' · '), createdBy: e.createdBy, deletedAt: e.deletedAt as string, deletedBy: e.deletedBy as string | undefined })),
].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
const trashCol = (kind: string) => (kind === 'plan' ? plans : kind === 'planTemplate' ? planTemplates : kind === 'exercise' ? exercises : null) as ReturnType<typeof col> | null;
const purgeOne = (kind: TrashKind, id: string) => (kind === 'exercise' ? purgeExercise(id) : (trashCol(kind) as ReturnType<typeof col>).remove(id));
app.get('/api/trash', (_req, res) => res.json({ items: trashItems(), days: TRASH_DAYS }));
app.post('/api/trash/:kind/:id/restore', (req, res) => { const c = trashCol(req.params.kind); const r = c?.get(req.params.id); if (!c || !r || alive(r)) return bad(res, 404, '휴지통에 없음'); c.update(r.id, { deletedAt: undefined, deletedBy: undefined }); res.json({ ok: true }); });
app.delete('/api/trash/:kind/:id', (req, res) => { const c = trashCol(req.params.kind); const r = c?.get(req.params.id); if (!c || !r || alive(r)) return bad(res, 404, '휴지통에 없음'); res.json({ ok: purgeOne(req.params.kind as TrashKind, r.id) }); });
app.delete('/api/trash', (req, res) => { const kinds = req.query.kind ? String(req.query.kind).split(',') : ['plan', 'planTemplate', 'exercise']; let n = 0; for (const it of trashItems()) if (kinds.includes(it.kind) && purgeOne(it.kind, it.id)) n++; res.json({ ok: true, purged: n }); });
/** 기동 시 1회: 휴지통에 30일 넘게 있던 항목은 완전 삭제 */
function purgeOldTrash() { const limit = Date.now() - TRASH_DAYS * 86400_000; let n = 0; for (const it of trashItems()) if (new Date(it.deletedAt).getTime() < limit && purgeOne(it.kind, it.id)) n++; if (n) console.log(`휴지통 자동 비움: ${n}개 (${TRASH_DAYS}일 경과)`); }

function planExcerptFor(planId: string | null): string | undefined {
  if (!planId) return undefined; const p = plans.get(planId); if (!p) return undefined;
  const pick: string[] = []; const titlesOnly: string[] = [];
  const re = /SOP|절차|대응|연락|조직|역할|전파|체계|상황|점검|훈련|비상|보고/;
  for (const n of p.toc) for (const node of [n, ...n.children]) if (re.test(node.title)) { if (p.sections[node.id]?.markdown) pick.push(`## ${node.no} ${node.title}\n${p.sections[node.id].markdown.slice(0, 800)}`); else titlesOnly.push(`${node.no} ${node.title}`); }
  if (pick.length) return pick.join('\n\n').slice(0, 3000);
  // 초안이 아직 없으면 관련 목차 제목만이라도 넘긴다 (계획서 구조를 SOP 근거로)
  return titlesOnly.length ? `[계획서 "${p.title}" 관련 목차]\n${titlesOnly.join('\n')}` : undefined;
}
/** 훈련상황 챗봇 — 자연어 질의, 근거 표출, 대화 저장. id='draft'면(생성 화면) 쿼리의 임시 맥락으로만 답한다. */
app.get('/api/exercises/:id/chat/stream', async (req, res) => {
  const ex = req.params.id === 'draft' ? null : exercises.get(req.params.id);
  const question = String(req.query.q ?? '').trim(); if (!question) return bad(res, 400, 'q 필요');
  const ctx = ex ?? { hazardType: String(req.query.hazardType ?? ''), alertLevel: String(req.query.alertLevel ?? ''), phase: String(req.query.phase ?? ''), location: String(req.query.location ?? ''), scenario: String(req.query.scenario ?? '') };
  const history = ex?.chat ?? (typeof req.query.history === 'string' ? (JSON.parse(req.query.history) as ChatMsg[]) : []);
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  let sources: unknown[] = [];
  const answer = await chatStream(llm.exerciseChatQuery(ctx as llm.ExerciseLike, question, history), {
    onToken: (t) => send('token', { text: t }),
    onSources: (s) => { sources = s; send('sources', { sources: s }); },
  }, { topK: 5, mockKey: 'chat' });
  if (ex) {
    const chat: ChatMsg[] = [...(ex.chat ?? []), { role: 'user', text: question, at: now() }, { role: 'assistant', text: answer, at: now(), sources }];
    const cited = [...(ex.citedSources ?? [])];
    for (const s of sources as { filename?: string; score?: number; text?: string; doc_id?: string }[]) if (s?.filename && !cited.some((c) => c.filename === s.filename && c.text === s.text)) cited.push({ filename: s.filename, score: s.score ?? 0, text: s.text ?? '', doc_id: s.doc_id });
    exercises.update(ex.id, { chat, citedSources: cited });
  }
  send('done', { answer, sources }); res.end();
});
app.post('/api/exercises/:id/chat/clear', (req, res) => { const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); exercises.update(ex.id, { chat: [], citedSources: [] }); res.json({ ok: true }); });

function chatSummaryOf(ex: ExerciseRow): string | undefined {
  const c = ex.chat ?? []; if (!c.length) return undefined;
  return c.slice(-10).map((m) => `${m.role === 'user' ? 'Q' : 'A'}: ${m.text.slice(0, 400)}`).join('\n').slice(0, 3000);
}
async function generateSopFor(ex: ExerciseRow, onStatus?: (status: string) => void) {
  const graph = await llm.generateSop(ex, planExcerptFor(ex.linkedPlanId), chatSummaryOf(ex), onStatus);
  for (const s of ex.citedSources ?? []) if (!graph.sources.some((g) => (g as { filename?: string }).filename === s.filename)) graph.sources.push(s);
  const v = (latestSop(ex.id)?.version ?? 0) + 1;
  const sop = sops.insert({ exerciseId: ex.id, version: v, graph });
  exercises.update(ex.id, { status: 'SOP_READY' });
  logEvent(ex.id, '상황판단', `초기 상황판단 SOP 생성 (v${v}, ${graph.nodes.length}노드, ${graph.mapperVersion})`, { source: graph.mapperVersion === 'uni-sop-2' ? 'UNI RAG' : '기본 SOP', dept: ex.dept, status: '진행중' });
  return sop;
}
app.post('/api/exercises/:id/sop/generate', async (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음');
  res.json(await generateSopFor(ex));
});
/** SOP 생성 진행 상태 스트림 — 유니 `__status__`(searching/reranking/generating) 프레임을 `status` 이벤트로, 끝나면 `done`에 SOP. 60~80초 대기 체감용 */
app.get('/api/exercises/:id/sop/generate/stream', async (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음');
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('status', { status: 'requesting' });
  try { const sop = await generateSopFor(ex, (status) => send('status', { status })); send('done', sop); }
  catch (e) { send('error', { error: (e as Error).message }); }
  res.end();
});
app.put('/api/exercises/:id/sop', (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음');
  const prev = latestSop(ex.id); const graph = req.body as SopGraph;
  res.json(sops.insert({ exerciseId: ex.id, version: (prev?.version ?? 0) + 1, graph: { ...graph, mapperVersion: graph.mapperVersion ?? 'manual' } }));
});
app.get('/api/exercises/:id/sop/versions', (req, res) => res.json(sops.where((s) => s.exerciseId === req.params.id).map((s) => ({ id: s.id, version: s.version, createdAt: s.createdAt, nodes: s.graph.nodes.length }))));

/** SOP → 임무 인스턴스. TASK/DISPATCH/FIELD_CHECK 노드마다 하나. 담당자 없으면 부서 기준 배정. */
app.post('/api/exercises/:id/start', (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음');
  const sop = latestSop(ex.id); if (!sop) return bad(res, 400, 'SOP 먼저');
  for (const t of tasks.where((x) => x.exerciseId === ex.id)) tasks.remove(t.id);
  const base = Date.now(); let seq = 0;
  for (const n of sop.graph.nodes) {
    if (!['TASK', 'DISPATCH', 'FIELD_CHECK'].includes(n.type)) continue;
    seq += 1;
    const us = members(); const user = us.find((u) => u.name === n.assignee) ?? us.find((u) => u.dept === n.dept) ?? us[(seq - 1) % Math.max(1, us.length)];
    const dueMin = n.due && /^\d{1,2}:\d{2}$/.test(n.due) ? null : 5 * seq;
    const due = dueMin != null ? new Date(base + dueMin * 60_000).toISOString() : (() => { const [h, m] = n.due!.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); })();
    tasks.insert({ exerciseId: ex.id, nodeId: n.id, seq, title: n.title, type: n.type, dept: n.dept ?? user.dept, assigneeId: user.id, assigneeName: user.name, due, priority: n.priority ?? (n.type === 'DISPATCH' ? '긴급' : '보통'), status: '대기', instructions: n.tasks ?? [] });
  }
  exercises.update(ex.id, { status: 'RUNNING', startedAt: now() });
  logEvent(ex.id, '상황판단', `훈련 실행 시작 — 임무 ${seq}건 생성`, { dept: ex.dept, status: '진행중', source: 'SOP 실행' });
  res.json(tasks.where((t) => t.exerciseId === ex.id).sort((a, b) => a.seq - b.seq));
});
app.get('/api/exercises/:id/tasks', (req, res) => { markOverdue(req.params.id); res.json(tasks.where((t) => t.exerciseId === req.params.id).sort((a, b) => a.seq - b.seq)); });
app.put('/api/exercises/:id/tasks/:taskId', (req, res) => { const t = tasks.get(req.params.taskId); if (!t) return bad(res, 404, '없음'); if (req.body.assigneeId) { const u = members().find((x) => x.id === req.body.assigneeId); if (u) req.body.assigneeName = u.name; } res.json(tasks.update(t.id, req.body)); });

const fillMessage = (tpl: string, ex: ExerciseRow, t: TaskRow) => tpl.replace(/\{훈련명\}/g, ex.title).replace(/\{재난유형\}/g, ex.hazardType).replace(/\{발생위치\}/g, ex.location).replace(/\{임무명\}/g, t.title).replace(/\{완료기한\}/g, hhmm(t.due)).replace(/\{담당자명\}/g, t.assigneeName);
function dispatchTask(ex: ExerciseRow, t: TaskRow, template?: string) {
  const message = fillMessage(template ?? '[임무지시] {훈련명} 관련 {재난유형} 상황 발생에 따라 {임무명}을(를) 요청합니다. {담당자명}께서는 {완료기한}까지 완료 후 수신 확인 바랍니다. 발생위치: {발생위치}', ex, t);
  const updated = tasks.update(t.id, { status: '전파완료', dispatchedAt: now(), message })!;
  logEvent(ex.id, '임무전파', `${t.title} 임무를 ${t.dept} ${t.assigneeName}에게 전파`, { dept: t.dept, actor: '상황실', status: '전파완료', taskId: t.id });
  return updated;
}
app.post('/api/exercises/:id/tasks/:taskId/dispatch', (req, res) => { const ex = exercises.get(req.params.id); const t = tasks.get(req.params.taskId); if (!ex || !t) return bad(res, 404, '없음'); if (req.body?.assigneeId) { const u = members().find((x) => x.id === req.body.assigneeId); if (u) tasks.update(t.id, { assigneeId: u.id, assigneeName: u.name, dept: u.dept }); } res.json(dispatchTask(ex, tasks.get(t.id)!, req.body?.message)); });
app.post('/api/exercises/:id/dispatch-all', (req, res) => { const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); const out = tasks.where((t) => t.exerciseId === ex.id && t.status === '대기').map((t) => dispatchTask(ex, t, req.body?.message)); res.json(out); });
app.post('/api/exercises/:id/redispatch', (req, res) => { const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); const targets = tasks.where((t) => t.exerciseId === ex.id && t.status === '전파완료'); for (const t of targets) { tasks.update(t.id, { dispatchedAt: now() }); logEvent(ex.id, '임무전파', `${t.title} — 미확인자 ${t.assigneeName} 재전파`, { dept: t.dept, actor: '상황실', status: '재전파', taskId: t.id }); } res.json({ count: targets.length }); });

app.get('/api/exercises/:id/events', (req, res) => { markOverdue(req.params.id); const after = req.query.after as string | undefined; res.json(events.where((e) => e.exerciseId === req.params.id && (!after || e.at > after)).sort((a, b) => a.at.localeCompare(b.at))); });
app.post('/api/exercises/:id/events', (req, res) => { const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); res.json(logEvent(ex.id, req.body.kind ?? '수동기록', req.body.content ?? '', { source: '수동 입력', actor: req.body.actor, dept: req.body.dept, status: '기록완료' })); });
app.get('/api/exercises/:id/board', (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); markOverdue(ex.id);
  const ts = tasks.where((t) => t.exerciseId === ex.id); const evs = events.where((e) => e.exerciseId === ex.id).sort((a, b) => a.at.localeCompare(b.at));
  const count = (s: TaskStatus[]) => ts.filter((t) => s.includes(t.status)).length;
  const phaseOrder = ['최초상황', '상황판단', '임무전파', '수신확인', '현장조치', '완료보고', '추가상황', '상황종료'];
  const timeline = phaseOrder.map((k) => ({ kind: k, at: evs.find((e) => e.kind === k)?.at ?? null }));
  const elapsedMs = ex.startedAt ? Date.now() - new Date(ex.startedAt).getTime() : 0;
  res.json({ exercise: ex, elapsedMs, total: ts.length, done: count(['완료']), inProgress: count(['수신확인', '수행중']), delayed: count(['지연']), waiting: count(['대기']), dispatched: count(['전파완료']), unacked: ts.filter((t) => t.status === '전파완료').length, acked: ts.filter((t) => t.ackedAt).length, reported: ts.filter((t) => t.reportedAt).length, timeline, active: ts.filter((t) => !['완료', '대기'].includes(t.status)).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5), lastEventAt: evs.at(-1)?.at ?? null, autoLogged: evs.filter((e) => e.source !== '수동 입력').length, aiCount: evs.filter((e) => e.kind === 'AI분석').length, analysis: ex.analysis ?? null });
});
app.post('/api/exercises/:id/analyze', async (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음');
  const ts = tasks.where((t) => t.exerciseId === ex.id); const evs = events.where((e) => e.exerciseId === ex.id).slice(-8);
  const summary = `훈련: ${ex.title} / ${ex.hazardType} / 단계 ${ex.alertLevel}\n임무: 총 ${ts.length}, 완료 ${ts.filter((t) => t.status === '완료').length}, 지연 ${ts.filter((t) => t.status === '지연').length}, 미확인 ${ts.filter((t) => t.status === '전파완료').length}\n최근 기록:\n${evs.map((e) => `${hhmm(e.at)} [${e.kind}] ${e.content}`).join('\n')}`;
  const a = await llm.analyze(summary);
  exercises.update(ex.id, { analysis: { ...a, at: now() } });
  logEvent(ex.id, 'AI분석', a.suggestion, { source: 'UNI RAG', status: '검토필요' });
  res.json(a);
});
app.post('/api/exercises/:id/close', (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음'); markOverdue(ex.id);
  const ts = tasks.where((t) => t.exerciseId === ex.id);
  for (const t of ts) if (!['완료'].includes(t.status)) tasks.update(t.id, { status: t.status === '지연' ? '지연' : '미완료' });
  exercises.update(ex.id, { status: 'CLOSED', closedAt: now() });
  logEvent(ex.id, '상황종료', `훈련 종료 — 완료 ${ts.filter((t) => t.status === '완료').length}/${ts.length}, 지연 ${ts.filter((t) => t.status === '지연').length}`, { dept: ex.dept, actor: '상황실', status: '종료', source: '훈련 종료' });
  res.json(exercises.get(ex.id));
});

// 모바일
app.get('/api/m/:assigneeId', (req, res) => { const u = members().find((x) => x.id === req.params.assigneeId); if (!u) return bad(res, 404, '담당자 없음'); const list = tasks.where((t) => t.assigneeId === u.id && t.status !== '대기').sort((a, b) => (b.dispatchedAt ?? '').localeCompare(a.dispatchedAt ?? '')); res.json({ user: u, tasks: list.map((t) => ({ ...t, exercise: exercises.get(t.exerciseId) })) }); });
app.post('/api/m/:assigneeId/tasks/:taskId/ack', (req, res) => { const t = tasks.get(req.params.taskId); if (!t) return bad(res, 404, '없음'); const u = tasks.update(t.id, { status: t.status === '전파완료' ? '수신확인' : t.status, ackedAt: now() })!; logEvent(t.exerciseId, '수신확인', `${t.dept} ${t.assigneeName} 수신 확인 — ${t.title}`, { dept: t.dept, actor: t.assigneeName, status: '수신확인', source: '모바일 응답', taskId: t.id }); res.json(u); });
app.post('/api/m/:assigneeId/tasks/:taskId/report', (req, res) => {
  const t = tasks.get(req.params.taskId); if (!t) return bad(res, 404, '없음');
  const result = (req.body?.result as TaskStatus) ?? '완료'; const memo = (req.body?.memo as string) ?? '';
  const receiptNo = `SKX-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(events.all().length + 1).padStart(3, '0')}`;
  const status: TaskStatus = result === '완료' ? '완료' : result === '수행중' ? '수행중' : result === '지원요청' ? '지원요청' : '미완료';
  const u = tasks.update(t.id, { status, reportedAt: now(), memo, receiptNo, result })!;
  logEvent(t.exerciseId, result === '완료' ? '완료보고' : '현장조치', `${t.title} — ${result}${memo ? `: ${memo}` : ''}`, { dept: t.dept, actor: t.assigneeName, status: result, source: '모바일 응답', taskId: t.id });
  res.json({ ...u, receiptNo });
});

// 상황일지
function buildJournalFacts(ex: ExerciseRow) {
  const evs = events.where((e) => e.exerciseId === ex.id).sort((a, b) => a.at.localeCompare(b.at)); const ts = tasks.where((t) => t.exerciseId === ex.id).sort((a, b) => a.seq - b.seq);
  const table = (rows: string[][], head: string[]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, '/')).join(' | ')} |`)].join('\n');
  return {
    timeline: table(evs.filter((e) => e.kind !== 'AI분석').map((e) => [hhmm(e.at), e.kind, e.content, e.source]), ['시간', '구분', '주요 상황 및 조치사항', '출처']),
    tasks: table(ts.map((t) => [String(t.seq), t.title, `${t.dept} / ${t.assigneeName}`, hhmm(t.due), t.status]), ['순번', '임무명', '담당부서 / 담당자', '완료기한', '상태']),
    dispatch: table(ts.filter((t) => t.dispatchedAt).map((t) => [t.title, t.assigneeName, hhmm(t.dispatchedAt!), t.ackedAt ? hhmm(t.ackedAt) : '미확인', t.reportedAt ? hhmm(t.reportedAt) : '-']), ['임무', '담당자', '전파', '수신확인', '보고']),
    field: ts.filter((t) => t.reportedAt).map((t) => `- ${hhmm(t.reportedAt!)} ${t.assigneeName}: ${t.title} — ${t.result ?? t.status}${t.memo ? ` (${t.memo})` : ''}`).join('\n') || '- (현장 보고 없음)',
    incomplete: ts.filter((t) => ['지연', '미완료', '지원요청'].includes(t.status)).map((t) => `- ${t.title} (${t.dept} ${t.assigneeName}) — ${t.status}`).join('\n') || '- 없음',
    firstEvents: evs.slice(0, 5).map((e) => `${hhmm(e.at)} [${e.kind}] ${e.content}`).join('\n'),
    evs, ts,
  };
}
app.post('/api/exercises/:id/journal/generate', async (req, res) => {
  const ex = exercises.get(req.params.id); if (!ex) return bad(res, 404, '없음');
  const f = buildJournalFacts(ex);
  const [overview, first, opinion] = await Promise.all([
    llm.narrate('훈련 개요', `훈련명 ${ex.title}, 재난유형 ${ex.hazardType}, 훈련단계 ${ex.phase}, 상황단계 ${ex.alertLevel}, 일시 ${ex.occurredAt}, 장소 ${ex.location}, 기관 ${ex.agency} ${ex.dept}. 시나리오: ${ex.scenario}`),
    llm.narrate('최초 상황', f.firstEvents),
    llm.narrate('종합 의견', `임무 총 ${f.ts.length}건, 완료 ${f.ts.filter((t) => t.status === '완료').length}건, 지연·미완료 ${f.ts.filter((t) => ['지연', '미완료'].includes(t.status)).length}건. 미완료: ${f.incomplete}`),
  ]);
  const sections: JournalRow['sections'] = [
    { key: 'overview', title: '1. 훈련 개요', kind: 'narrative', markdown: overview, aiGenerated: true, reviewed: false },
    { key: 'first', title: '2. 최초 상황', kind: 'narrative', markdown: first, aiGenerated: true, reviewed: false },
    { key: 'timeline', title: '3. 시간대별 주요 상황', kind: 'fact', markdown: f.timeline, aiGenerated: false, reviewed: true },
    { key: 'tasks', title: '4. SOP 임무 수행 내역', kind: 'fact', markdown: f.tasks, aiGenerated: false, reviewed: true },
    { key: 'dispatch', title: '5. 전파 및 수신 확인 내역', kind: 'fact', markdown: f.dispatch, aiGenerated: false, reviewed: true },
    { key: 'field', title: '6. 현장 조치 결과', kind: 'fact', markdown: f.field, aiGenerated: false, reviewed: true },
    { key: 'incomplete', title: '7. 미완료 및 개선 필요사항', kind: 'fact', markdown: f.incomplete, aiGenerated: false, reviewed: true },
    { key: 'opinion', title: '8. 종합 의견', kind: 'narrative', markdown: opinion, aiGenerated: true, reviewed: false },
  ];
  const prev = journals.where((j) => j.exerciseId === ex.id)[0];
  const j = prev ? journals.update(prev.id, { sections })! : journals.insert({ exerciseId: ex.id, sections });
  res.json(j);
});
app.put('/api/exercises/:id/journal', (req, res) => { const prev = journals.where((j) => j.exerciseId === req.params.id)[0]; if (!prev) return bad(res, 404, '일지 없음'); res.json(journals.update(prev.id, { sections: req.body.sections })); });
app.post('/api/exercises/:id/journal/polish', async (req, res) => { const j = journals.where((x) => x.exerciseId === req.params.id)[0]; if (!j) return bad(res, 404, '일지 없음'); const s = j.sections.find((x) => x.key === req.body.sectionKey); if (!s) return bad(res, 404, '절 없음'); s.markdown = await llm.polish(s.markdown); s.aiGenerated = true; s.reviewed = false; journals.update(j.id, { sections: j.sections }); res.json(s); });
app.post('/api/exercises/:id/journal/export', async (req, res) => {
  const ex = exercises.get(req.params.id); const j = journals.where((x) => x.exerciseId === req.params.id)[0]; if (!ex || !j) return bad(res, 404, '일지 없음');
  // 템플릿: 요청 body.templateId > 직전 내보내기 템플릿 > "상황보고" 내장 템플릿 (2026-08-22 선택 UI 추가)
  const wanted = (req.body?.templateId as string | undefined) ?? j.export?.templateId;
  const t = (wanted ? templates.get(wanted) : null) ?? templates.where((x) => /상황보고/.test(x.fileName))[0] ?? templates.all()[0]; if (!t) return bad(res, 500, '템플릿 없음');
  const md = j.sections.map((s) => `# ${s.title}\n\n${s.markdown}`).join('\n\n');
  const out = await buildHwpx(new Uint8Array(readFileSync(join(FILES_DIR, t.storedPath))), t.profile, `훈련 상황일지 — ${ex.title}`, md, { reportedAt: ex.occurredAt, reporter: ex.createdBy });
  const fileName = `journal_${ex.id}_${Date.now()}.hwpx`; writeFileSync(join(FILES_DIR, fileName), out);
  const r = await renderHwpxSvg(out, 1);
  journals.update(j.id, { export: { fileName, at: now(), pages: r.pages, templateId: t.id, templateName: t.name } });
  res.json({ fileName, url: `/api/files/${fileName}`, pages: r.pages, templateName: t.name });
});
app.get('/api/exercises/:id/journal/preview', async (req, res) => { const j = journals.where((x) => x.exerciseId === req.params.id)[0]; if (!j?.export) return bad(res, 404, '내보낸 파일 없음'); res.json(await renderHwpxSvg(new Uint8Array(readFileSync(join(FILES_DIR, j.export.fileName))), 30)); });

// UNI 문서 목록(연계 데이터 화면·참조 데이터 선택)
app.get('/api/uni/documents', async (req, res) => { try { res.json(await listDocuments(Number(req.query.page ?? 1), Number(req.query.size ?? 20))); } catch (e) { res.json({ documents: [], total: 0, error: (e as Error).message }); } });

// ── 연동 ──────────────────────────────────────────────────────────────────
app.post('/api/link/plan-to-exercise', (req, res) => {
  const p = plans.get(req.body?.planId); if (!p) return bad(res, 404, '계획서 없음');
  const excerpt = planExcerptFor(p.id) ?? '';
  const scenario = `[근거 계획서: ${p.title}]\n${excerpt.replace(/^#+\s.*$/gm, '').replace(/\n{2,}/g, '\n').slice(0, 600)}`.trim();
  res.json({ title: `${new Date().getFullYear()} 안전한국훈련 · ${p.context?.hazardType ?? p.hazardType ?? ''} 대응 훈련`, hazardType: p.context?.hazardType ?? p.hazardType ?? '태풍/호우', phase: '대응', alertLevel: '경계', location: p.context?.place ?? '', agency: '', dept: p.context?.role ?? '', scenario, refData: [`계획서: ${p.title}`, ...(p.context?.sources ? [p.context.sources] : [])], linkedPlanId: p.id, excerpt });
});
app.post('/api/link/exercise-to-plan', (req, res) => {
  const ex = exercises.get(req.body?.exerciseId); const p = plans.get(req.body?.planId); if (!ex || !p) return bad(res, 404, '없음');
  const f = buildJournalFacts(ex);
  const badTasks = f.ts.filter((t) => ['지연', '미완료', '지원요청'].includes(t.status));
  const md = [
    `**훈련 환류 (${ex.title}, ${new Date(ex.closedAt ?? ex.updatedAt).toLocaleDateString('ko-KR')})**`,
    `임무 총 ${f.ts.length}건 중 완료 ${f.ts.filter((t) => t.status === '완료').length}건, 지연 ${f.ts.filter((t) => t.status === '지연').length}건, 미완료 ${f.ts.filter((t) => t.status === '미완료').length}건, 지원요청 ${f.ts.filter((t) => t.status === '지원요청').length}건.`,
    `**미완료·지연 임무**\n\n${badTasks.length ? badTasks.map((t) => `- ${t.title} (${t.dept} ${t.assigneeName}) — ${t.status}`).join('\n') : '- 없음'}`,
    `**개선 필요사항**\n\n${badTasks.length ? badTasks.map((t) => `- ${t.title}: 담당(${t.dept}) 배정·기한(${hhmm(t.due)}) 재검토 [확인 필요]`).join('\n') : '- 없음'}`,
  ].join('\n\n');
  let target = p.toc.flatMap((n) => [n, ...n.children]).find((n) => /개선|보완|환류/.test(n.title));
  const toc = [...p.toc];
  if (!target) { target = { id: `t${nanoid(6)}`, no: String(toc.length + 1), title: '개선사항 및 보완계획', children: [] }; toc.push(target); }
  const prev = p.sections[target.id];
  const sec: Section = { tocId: target.id, status: '완료', markdown: prev?.markdown ? `${prev.markdown}\n\n${md}` : md, userEdited: false, sources: [{ filename: `훈련 ${ex.title}`, score: 1, text: '훈련 환류' }], history: prev?.history ?? [], origin: '훈련 환류' };
  plans.update(p.id, { toc, sections: { ...p.sections, [target.id]: sec }, linkedExercises: [...new Set([...p.linkedExercises, ex.id])] });
  res.json({ ok: true, tocId: target.id, title: target.title, markdown: sec.markdown });
});
app.get('/api/link/plan/:planId/exercises', (req, res) => { const p = plans.get(req.params.planId); if (!p) return bad(res, 404, '없음'); res.json(p.linkedExercises.map((id) => exercises.get(id)).filter(Boolean)); });

// ── 기동 ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.POC_PORT ?? 3100);
initRhwp().then(async () => {
  await seedTemplates();
  await refreshProfiles();
  cleanupT3qSections();
  purgeOldTrash();
  ensureOrg();
  setTimeout(() => void checkWarnings(), 15_000); setInterval(() => void checkWarnings(), 10 * 60_000);
  app.listen(PORT, '127.0.0.1', () => console.log(`poc-server :${PORT} | rhwp ${rhwpVersion()} | UNI ${uniStatus().baseUrl}${uniStatus().mock ? ' (MOCK)' : ''}`));
}).catch((e) => { console.error('rhwp 초기화 실패', e); process.exit(1); });
