/**
 * T3Q 계획서 생성 API (RPT-001 목차, RPT-002 본문). 계약: contracts/openapi/t3q-report-adapter-v0.8.5-une1.yaml
 * 실측 2026-08-19: toc 200 (~15s), content SSE `data: {name, content, references[]}` 섹션 단위, 첫 청크 ~3s.
 * TLS: 서버 인증서 체인이 불완전해 POC에서는 이 호스트에 한해 검증을 끈다 (T3Q_VERIFY_TLS=0). 운영은 켠다.
 * targetAudiences 열거: 중앙정부 | 지자체 | 내부보고 | 대민 (422로 확인).
 */
import { Agent, fetch as undiciFetch } from 'undici';
import type { PlanContext, TocNode } from './llm.js';

const BASE = (process.env.T3Q_API_BASE_URL ?? 'https://plf.mois-disaster.t3q.ai').replace(/\/+$/, '');
const MODEL = process.env.T3Q_MODEL_ID ?? 'ae894';
const VERIFY = process.env.T3Q_VERIFY_TLS !== '0' && process.env.T3Q_VERIFY_TLS !== 'false';
const API_KEY = process.env.T3Q_API_KEY ?? '';
const dispatcher = new Agent({ connect: { rejectUnauthorized: VERIFY } });
let lastFailure: string | null = null;
export const t3qStatus = () => ({ baseUrl: BASE, model: MODEL, verifyTls: VERIFY, lastFailure });

export const AUDIENCES = ['중앙정부', '지자체', '내부보고', '대민'] as const;
function audienceOf(v?: string): string {
  if (!v) return '지자체';
  const hit = AUDIENCES.find((a) => v.includes(a));
  if (hit) return hit;
  if (/시민|주민|국민|대국민/.test(v)) return '대민';
  if (/중앙|부처|행안부/.test(v)) return '중앙정부';
  if (/내부|본부|실무/.test(v)) return '내부보고';
  return '지자체';
}
const isoOrUndef = (s?: string) => { if (!s) return undefined; const d = new Date(s); return Number.isNaN(d.getTime()) ? undefined : d.toISOString(); };

/** 기준정보 → T3Q data. paragraphSymbol은 템플릿에서 뽑은 수준별 기호("□ ㅇ - *"). */
export function toT3qData(ctx: PlanContext, paragraphSymbol?: string) {
  return {
    subject: ctx.subject,
    backgroundInfo: { disasterType: ctx.hazardType, controlPhase: ctx.managementPhase, location: ctx.place || undefined, startTime: isoOrUndef(ctx.occurredAt), reportTime: isoOrUndef(ctx.reportedAt) },
    contentInstruction: { source: ctx.sources || undefined, essentialFactors: ctx.requiredElements ? ctx.requiredElements.split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean) : undefined, writingGuide: ctx.writingGuide || undefined },
    expressionRule: { tone: ctx.tone || undefined, maxSentenceLength: ctx.sentenceLimit || undefined, paragraphSymbol: paragraphSymbol || ctx.outlineNumbering || undefined, bodytextStart: ctx.bodyStart || undefined },
    purposeOfDocument: { goalOfBusiness: ctx.purpose || ctx.subject, role: ctx.role || '재난안전 담당', targetAudiences: [audienceOf(ctx.audience)] },
  };
}

interface T3qSection { name: string; children: T3qSection[] }
let seq = 0; const nid = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

/** T3Q 섹션 트리 → UNE TocNode(2수준). 3수준은 2수준 제목 아래로 접는다. */
export function fromT3qSections(sections: T3qSection[]): TocNode[] {
  const clean = (name: string) => name.replace(/^\s*[\d.]+\s*/, '').trim();
  const numOf = (name: string, fallback: string) => name.match(/^\s*([\d.]+?)\.?\s/)?.[1] ?? fallback;
  return sections.map((s, i) => {
    const pno = numOf(s.name, String(i + 1));
    return {
      id: nid(), no: pno, title: clean(s.name),
      // T3Q는 소목차 번호를 "1."처럼 자기 번호만 주기도 한다 → 부모.자기 로 합성
      children: (s.children ?? []).map((c, j) => { const raw = numOf(c.name, `${j + 1}`); const no = raw.includes('.') ? raw : `${pno}.${raw}`; return { id: nid(), no, title: clean(c.name), children: [] }; }),
    };
  });
}

export async function t3qToc(ctx: PlanContext, paragraphSymbol?: string): Promise<{ title: string; toc: TocNode[] }> {
  const r = await undiciFetch(`${BASE}/model-api/${MODEL}/reports/plan/toc`, {
    method: 'POST', dispatcher,
    headers: { 'Content-Type': 'application/json', ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
    body: JSON.stringify({ data: toT3qData(ctx, paragraphSymbol) }),
    signal: AbortSignal.timeout(180_000),
  });
  const txt = await r.text();
  if (!r.ok) { lastFailure = `toc HTTP ${r.status}: ${txt.slice(0, 200)}`; throw new Error(lastFailure); }
  lastFailure = null;
  const j = JSON.parse(txt) as { title: string; sections: T3qSection[] };
  return { title: j.title, toc: fromT3qSections(j.sections ?? []) };
}

export interface T3qContentEvent { name: string; content: string; references: { id: string; fileId: string; fileName: string; page: string }[] }

/**
 * 본문 스트리밍. T3Q는 섹션 단위로 `data: {...}`를 흘린다(토큰 단위 아님).
 * sections에 요청한 섹션만 넣으면 그 섹션(+children)만 온다.
 */
export async function t3qContent(ctx: PlanContext, sections: T3qSection[], paragraphSymbol: string | undefined, onSection: (s: T3qContentEvent) => void): Promise<T3qContentEvent[]> {
  const r = await undiciFetch(`${BASE}/model-api/${MODEL}/reports/plan/content`, {
    method: 'POST', dispatcher,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
    body: JSON.stringify({ data: { ...toT3qData(ctx, paragraphSymbol), sections, stream: true } }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!r.ok || !r.body) { const t = await r.text().catch(() => ''); lastFailure = `content HTTP ${r.status}: ${t.slice(0, 200)}`; throw new Error(lastFailure); }
  lastFailure = null;
  const out: T3qContentEvent[] = [];
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const handle = (payload: string) => {
    const p = payload.trim(); if (!p || p === '[DONE]') return;
    try { const j = JSON.parse(p) as T3qContentEvent; if (j && typeof j.content === 'string') { out.push(j); onSection(j); } } catch { /* 부분 프레임 */ }
  };
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); for (const line of frame.split('\n')) if (line.startsWith('data:')) handle(line.slice(5)); }
  }
  for (const line of buf.split('\n')) if (line.startsWith('data:')) handle(line.slice(5));
  return out;
}

/** T3Q 본문의 "□ㅇ-* (소제목) 문장…" 관례를 마크다운으로: 기호 접두는 떼고 (소제목)은 굵게. */
export function t3qContentToMarkdown(content: string, symbols: string[]): string {
  const sym = symbols.filter(Boolean);
  const joined = sym.join('');
  // 실측 2026-08-21: T3Q는 줄마다 요청한 기호 문자열("□ㅇ-*")을 통째로 앞에 붙여 돌려주며 줄 사이 위계가 없다.
  // 그래서 각 줄을 2수준 항목("- ")으로 만든다 → 웹 렌더·HWPX 모두 템플릿의 2수준 기호(ㅇ)와 글자모양을 입힌다.
  // (예전처럼 기호만 벗기면 평문단이 되어 내보낸 HWPX에 기호가 하나도 남지 않았다.)
  return content.split('\n').map((line) => {
    let l = line;
    if (joined && l.startsWith(joined)) l = l.slice(joined.length).trim();
    for (const s of sym) if (l.startsWith(s + ' ') || l.startsWith(s)) { l = l.slice(s.length).trim(); break; }
    l = l.trim();
    if (!l || /^[|#]/.test(l) || /^\s*([-*•·]|\d+[.)])\s/.test(l)) return l;
    const m = l.match(/^\(([^)]{1,30})\)\s*(.*)$/);
    if (m) l = `**(${m[1]})** ${m[2]}`;
    return `- ${l}`;
  }).join('\n');
}

/** T3Q가 돌려준 섹션 이름이 우리 목차 노드와 같은 항목인지 (번호 또는 제목 일치). */
export function findT3qSection(name: string, node: TocNode): boolean {
  const n = name.trim();
  const num = n.match(/^([\d.]+?)\.?\s/)?.[1];
  if (num && num === node.no) return true;
  const clean = n.replace(/^[\d.\s]+/, '').trim();
  return clean === node.title.trim() || clean.includes(node.title.trim()) || node.title.trim().includes(clean);
}
