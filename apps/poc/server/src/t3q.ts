/**
 * T3Q 계획서 생성 API (RPT-001 목차, RPT-002 본문). 계약: contracts/openapi/t3q-report-adapter-v0.8.5-une1.yaml
 * 실측 2026-08-19: toc 200 (~15s), content SSE `data: {name, content, references[]}` 섹션 단위, 첫 청크 ~3s.
 * TLS: 서버 인증서 체인이 불완전해 POC에서는 이 호스트에 한해 검증을 끈다 (T3Q_VERIFY_TLS=0). 운영은 켠다.
 * targetAudiences 열거: 중앙정부 | 지자체 | 내부보고 | 대민 (422로 확인).
 */
import { Agent, fetch as undiciFetch } from 'undici';
import type { PlanContext, TocNode } from './llm.js';
import { isNumberingBullet } from './hwpx.js';

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

/**
 * T3Q에 보낼 paragraphSymbol: 요청한 절의 **아래** 수준 기호만, 개요번호형("1." "가." "①")은 빼고 **콤마로 구분**한다.
 * 실측 2026-08-21 (같은 절에 세 표기를 동시에 보내 비교):
 *   "□○-", "□ ○ -"  → 줄마다 "□○- (소제목) 문장" 통째 기호, 위계 없음
 *   "□, ○, -"        → "□ 문장" / "  ○ 문장" / "    - 문장" 3단 위계로 돌아옴  ← 채택
 * "1.가.□○-"처럼 번호까지 이어 보내면 소제목에 가나다 순번을 스스로 매기고 문장엔 나머지 기호를 통째로 붙였다.
 */
export function t3qSymbolsFor(symbols: string[], depth: number): string {
  const plain = (arr: string[]) => arr.filter((s) => s && !isNumberingBullet(s));
  const below = plain(symbols.slice(Math.max(0, depth)));
  const pick = below.length ? below : plain(symbols);
  return (pick.length ? pick : ['□', 'ㅇ', '-', '*']).join(', ');
}

/** 기호 문자(템플릿 기호 + 흔한 변형). '*'는 "**(소제목)**" 굵게 표시와 겹치므로 뒤에 '*'나 '('가 오면 기호로 안 본다 */
const SYM_RUN_RE = /^(?:[□■○●◇◆ㅇ•·\-–—]|\*(?![*(]))+\s*/;
/** "가. 제목" / "1) 제목" / "① 제목" — T3Q가 스스로 매긴 소제목 순번 */
const SUBHEAD_RE = /^([가-힣]|\d{1,2}|[①-⑳])[.)]\s+\S/;
const normTitle = (s: string) => s.replace(/^[\d.\s]+/, '').replace(/\s+/g, '').trim();

/**
 * T3Q 본문 → 마크다운 항목. 실측 2026-08-21(문서 "테스트도도도", AI 행정문서 템플릿):
 *   콤마 구분 요청("□, ○, -")이면 "□ 문장" / "  ○ 문장" / "    - 문장" 위계로 온다 → 줄 앞 기호 하나가 곧 수준.
 *   그 밖의 응답(예전 요청 형식):
 *   "1. 감염병 위기 관리 체계 및 기본 방향"   ← 절 제목을 첫 줄에 반복 → 버림
 *   "가. 중앙재난안전대책본부의 총괄 역할"     ← 소제목(T3Q가 순번을 매김) → 깊이 0, 그 아래 문장은 깊이 1
 *   "□○- (소제목) 문장…"                    ← 요청 기호가 통째로 붙음 → 남지 않을 때까지 벗김
 * 결과는 "- " 항목 + 2칸 들여쓰기. 웹·HWPX가 제목 기준 상대 수준으로 템플릿 기호를 입힌다.
 * 저장된 변환 결과에 다시 돌려도 같은 결과(멱등) — 기동 시 옛 저장본 정리에 쓴다. 들여쓴 "- " 줄은 들여쓰기를 깊이로 본다.
 */
export function t3qContentToMarkdown(content: string, symbols: string[], sectionTitle?: string): string {
  const ordered = symbols.filter((s) => s && !isNumberingBullet(s)); // 요청 순서 = 수준 순서
  const sym = ordered.filter((s) => !SYM_RUN_RE.test(s)).sort((a, b) => b.length - a.length);
  /** 줄이 요청 기호 **하나**로만 시작하면 그 기호의 순서가 수준 ("□ 문장" → 0, "○ 문장" → 1). 기호가 붙어 있으면("□○-") null */
  const symDepth = (t: string): { depth: number; rest: string } | null => {
    for (const s of [...ordered].sort((a, b) => b.length - a.length)) {
      if (s === '-' || !(t.startsWith(s + ' ') || t === s)) continue;
      const rest = t.slice(s.length).trimStart();
      if (!SYM_RUN_RE.test(rest) || rest.startsWith('**(')) return { depth: ordered.indexOf(s), rest };
    }
    return null;
  };
  const stripLead = (s: string) => {
    let l = s.trimStart();
    for (let guard = 0; guard < 12; guard++) {
      let hit = false;
      // "3.나.□○- 문장"처럼 번호 뒤에 곧바로 기호가 붙어 있으면 T3Q가 요청 기호열을 통째로 붙인 것 — 번호까지 벗긴다
      const glued = l.match(/^(?:\d+[.)]\s*)?(?:[가-힣][.)]\s*)?(?=[□■○●◇◆ㅇ•·\-–—*])/);
      if (glued && glued[0]) { l = l.slice(glued[0].length); hit = true; }
      for (const x of sym) if (l.startsWith(x)) { l = l.slice(x.length).trimStart(); hit = true; }
      const m = l.match(SYM_RUN_RE); if (m) { l = l.slice(m[0].length); hit = true; }
      if (!hit) break;
    }
    return l.trim();
  };
  const title = sectionTitle ? normTitle(sectionTitle) : '';
  type Item = { kind: 'item'; sub: boolean; text: string; depth: number | null; src: 'sym' | 'indent' | null };
  type Row = { kind: 'blank' } | { kind: 'raw'; text: string } | Item;
  const rows: Row[] = [];
  let hasSub = false;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) { rows.push({ kind: 'blank' }); continue; }
    if (/^[|#]/.test(t)) { rows.push({ kind: 'raw', text: t }); continue; }
    // 수준 판정: (a) 요청 기호 하나로 시작 → 기호 순서  (b) 들여쓴 "- " 줄(이전 변환 결과·T3Q 3수준) → 들여쓰기/2  (c) 그 외 null → 소제목 규칙
    let depth: number | null = null; let src: Item['src'] = null;
    const sd = symDepth(t);
    const indent = line.match(/^(\s+)-\s/);
    if (sd) { depth = sd.depth; src = 'sym'; }
    else if (indent) { depth = Math.floor(indent[1].replace(/\t/g, '  ').length / 2); src = 'indent'; }
    let l = stripLead(sd ? sd.rest : t);
    if (!l) continue;
    if (title && normTitle(l) === title) continue; // 절 제목 반복
    l = l.replace(/^\*\*(\([^)]{1,30}\))\*\*\s*/, '$1 ').trim(); // 저장본의 "**(소제목)**"은 굵게 표시를 벗겨 같은 길로
    const m = l.match(/^\(([^)]{1,30})\)\s*(.*)$/);
    // 소제목 줄: "가. 제목"(T3Q가 순번을 매긴 경우) 또는 "(소제목)"만 있는 줄(기호만 보낸 경우, 실측 2026-08-21 두 번째 응답)
    const sub = depth == null && ((SUBHEAD_RE.test(l) && !/[.!?]$/.test(l) && l.length <= 60) || (!!m && !m[2].trim()));
    if (sub) hasSub = true;
    if (m) l = `**(${m[1]})**${m[2].trim() ? ` ${m[2].trim()}` : ''}`;
    rows.push({ kind: 'item', sub, text: l, depth, src });
  }
  // 기호로 정한 수준은 가장 위 기호를 0으로 맞춘다(절 아래 수준만 요청했으므로 "ㅇ, -, *"면 ㅇ가 0)
  const symDepths = rows.filter((r): r is Item => r.kind === 'item' && r.src === 'sym').map((r) => r.depth as number);
  const minSym = symDepths.length ? Math.min(...symDepths) : 0;
  // 옛 변환이 "가."를 이미 벗긴 저장본: 첫 항목이 제목꼴이고 다음 소제목이 "나."면 첫 항목도 소제목으로 본다
  if (hasSub) {
    const items = rows.filter((r): r is Item => r.kind === 'item' && r.depth == null);
    const firstSub = items.find((r) => r.sub);
    const first = items[0];
    if (first && !first.sub && firstSub && /^(나[.)]|2[.)]|②)/.test(firstSub.text) && !/[.!?]$/.test(first.text) && first.text.length <= 60 && !first.text.startsWith('**')) first.sub = true;
  }
  let under = false;
  return rows.map((r) => {
    if (r.kind === 'blank') return '';
    if (r.kind === 'raw') return r.text;
    if (r.depth != null) return `${'  '.repeat(Math.max(0, r.src === 'sym' ? r.depth - minSym : r.depth))}- ${r.text}`;
    if (r.sub) { under = true; return `- ${r.text}`; }
    return `${hasSub && under ? '  ' : ''}- ${r.text}`;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** T3Q가 돌려준 섹션 이름이 우리 목차 노드와 같은 항목인지 (번호 또는 제목 일치). */
export function findT3qSection(name: string, node: TocNode): boolean {
  const n = name.trim();
  const num = n.match(/^([\d.]+?)\.?\s/)?.[1];
  if (num && num === node.no) return true;
  const clean = n.replace(/^[\d.\s]+/, '').trim();
  return clean === node.title.trim() || clean.includes(node.title.trim()) || node.title.trim().includes(clean);
}
