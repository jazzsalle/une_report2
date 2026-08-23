/**
 * 매뉴얼 지식화 (범용화 ②, 2026-08-23)
 * 현장조치 행동매뉴얼의 "조치카드"를 유니 검색(/search/, 512자 청크)에서 정규식으로 뽑아 구조화하고, 카드 묶음을 SOP 템플릿(그래프)으로 만든다.
 *
 * 실측 2026-08-23 (영천시 풍수해 현장조치 행동매뉴얼, 유니 REST /search/ — MCP search_knowledge와 같은 청크):
 *   | 코드번호 :  ①-2-8  조치목록 : 대응 조치  조치내용 : 긴급 구조구급 협조사항 파악  주관부서  안전재난하천과  ⓢ지원부서  ⓒ협업기관  영천경찰서, 영천소방서, 군부대  연계코드  ①-3-1 재난상황 접수 및 파악   |
 *   카드 앞에 "## 지대본 / 비상 1단계 / ## ①재난상황관리" 식의 맥락이, 뒤에 "## 1. 세부 조치 제목 / - 체크 항목" 이 따라온다.
 *   청크가 512자라 카드 꼬리(연계코드)가 잘리기도 한다 → 닫는 '|'가 없으면 truncated 로 표시하고, 같은 코드가 온전한 청크에서 다시 나오면 교체한다.
 * 실측 2026-08-23 저녁 (●부산시 풍수해 재난 현장조치 행동매뉴얼(26.7.6.)): 같은 항목을 세로로 쓴다 —
 *   "비상 대응 / 코드번호 :\n44-2 / ## 행 동 요 령 / 조치목록 :\n재난현장 교통소통 확보 / 조치내용 :\n… / 주관부서 :\n부산경찰청 / 지원부서 :\n / 협업기관\n:\n… / ## 1. 제목 / | 표준행동 지시내용 비고 … |"
 *   코드가 숫자(44-2, 협업기능 원문자 없음), ⓢ/ⓒ 접두 없음, 단계는 "비상 대응"·"수습 ・ 복구". 카드 끝은 '|' 또는 "## n." 제목.
 */
import { search } from './uni.js';
import { refineType, type NodeType, type SopEdge, type SopGraph, type SopNode } from './llm.js';

export type ManualStage = '징후감지' | '초기대응' | '비상1' | '비상2·3' | '수습복구';
export const MANUAL_STAGES: ManualStage[] = ['징후감지', '초기대응', '비상1', '비상2·3', '수습복구'];
/** 매뉴얼 본문의 단계 표기 → 표준 단계 */
const STAGE_PATTERNS: [RegExp, ManualStage][] = [
  [/징후\s*감지/g, '징후감지'],
  [/초기\s*대응/g, '초기대응'],
  [/비상\s*2\s*[·ㆍ,~∼]?\s*3\s*단계|비상\s*3\s*단계|비상\s*2\s*단계/g, '비상2·3'],
  [/비상\s*1\s*단계/g, '비상1'],
  [/비상\s*대응/g, '비상1'], // 부산: 단계 번호 없이 '비상 대응' — 비상1로 두고 검수에서 고친다
  [/수습\s*[·ㆍ・]?\s*복구/g, '수습복구'],
];
/** 단계별 검색어에 쓰는 매뉴얼 표기 */
const STAGE_QUERY: Record<ManualStage, string> = { 징후감지: '징후감지 단계', 초기대응: '초기대응 단계', 비상1: '지대본 비상 1단계', '비상2·3': '지대본 비상 2·3단계', 수습복구: '수습복구 단계' };

export interface ActionCard {
  code: string;              // ①-2-8
  coop: string;              // ①
  seq: [number, number];     // [2, 8]
  title: string;             // 조치목록 (대응 조치)
  content: string;           // 조치내용 (긴급 구조구급 협조사항 파악)
  lead: string;              // 주관부서
  support: string[];         // ⓢ지원부서
  partner: string[];         // ⓒ협업기관
  linkedCodes: { code: string; title: string }[];
  checklist: string[];       // 카드 아래 "## n. …" 제목과 "- " 항목
  stage: ManualStage | null; // 청크 맥락에서 추정 — 사람이 검수
  truncated: boolean;        // 청크 경계에 잘린 카드
  sourceRef: { doc: string; score: number; excerpt: string; query: string };
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*[․・ㆍ]\s*/g, '·').replace(/\s*,\s*/g, ', ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/^[\s:：|]+|[\s:：|]+$/g, '').trim();
const splitList = (s: string) => clean(s).split(/\s*[,、]\s*/).map((x) => x.trim()).filter((x) => x && x !== '-');

/** 청크 하나에서 조치카드를 모두 뽑는다 */
export function parseActionCards(text: string, doc: string, score: number, query: string): ActionCard[] {
  const out: ActionCard[] = [];
  const starts: number[] = [];
  const re = /코드번호\s*[:：]/g; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i];
    const hardEnd = i + 1 < starts.length ? starts[i + 1] : text.length;
    // 카드 본문은 닫는 '|' 까지. 없으면 청크 끝(잘림)
    const pipeAt = text.indexOf('|', from);
    const headM = /\n\s*#{1,3}\s*\d+\s*[.)]\s/.exec(text.slice(from)); const headAt = headM ? from + headM.index : -1; // 부산: "## 1. 제목"이 카드 끝
    const ends = [pipeAt, headAt].filter((x) => x >= 0 && x <= hardEnd);
    const truncated = !ends.length;
    const end = truncated ? hardEnd : Math.min(...ends);
    const body = text.slice(from, end);
    const codeM = /코드번호\s*[:：]\s*(?:([①-⑳])\s*-\s*)?(\d+)\s*-\s*(\d+)/.exec(body);
    if (!codeM) continue;
    const coop = codeM[1] ?? ''; // 부산처럼 원문자 없는 숫자 코드는 협업기능 미상
    const code = coop ? `${coop}-${codeM[2]}-${codeM[3]}` : `${codeM[2]}-${codeM[3]}`;
    // 라벨 위치로 필드를 자른다(라벨 순서는 매뉴얼에서 고정)
    const labels: [string, RegExp][] = [['title', /조치목록\s*[:：]?/], ['content', /조치내용\s*[:：]?/], ['lead', /주관부서\s*[:：]?/], ['support', /[ⓢⓈ]?\s*지원부서\s*[:：]?/], ['partner', /[ⓒⒸ]?\s*협업기관\s*[:：]?/], ['linked', /연계\s*코드\s*[:：]?/]];
    const found: { key: string; start: number; valueStart: number }[] = [];
    let cursor = codeM.index + codeM[0].length;
    for (const [key, lre] of labels) {
      const rest = body.slice(cursor); const lm = lre.exec(rest); if (!lm) continue;
      found.push({ key, start: cursor + lm.index, valueStart: cursor + lm.index + lm[0].length }); cursor = cursor + lm.index + lm[0].length;
    }
    const field = (key: string) => { const f = found.find((x) => x.key === key); if (!f) return ''; const nextStart = found.find((x) => x.start > f.start)?.start ?? body.length; return body.slice(f.valueStart, nextStart); };
    // 부서·기관 칸은 첫 문단(빈 줄 전)까지, 120자 안에서만 — 잘린 카드에서 뒤따르는 본문("※ 비상연락체계 확인 …")이 딸려 들어오던 것을 막는다(실측 부산 2026-08-23)
    const short = (v: string) => { const first = v.replace(/^\s*[:：]?\s*\n?/, '').split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !/^[:：]$/.test(x)) ?? ''; const cut = first.split(/\s*(?:※|❍|○|<!--|##)/)[0]; return cut.length > 120 ? cut.slice(0, 120) : cut; };
    const linkedRaw = field('linked');
    const linkedCodes: { code: string; title: string }[] = [];
    if (linkedRaw) {
      const parts = linkedRaw.split(/(?=[①-⑳]\s*-\s*\d+\s*-\s*\d+)/);
      for (const p of parts) { const cm = /([①-⑳])\s*-\s*(\d+)\s*-\s*(\d+)\s*(.*)/s.exec(p); if (cm) linkedCodes.push({ code: `${cm[1]}-${cm[2]}-${cm[3]}`, title: clean(cm[4]).replace(/\s*\/\s*$/, '') }); }
    }
    // 단계: 카드 앞 본문에서 마지막으로 나온 단계 표기 (없으면 청크 전체에서)
    const before = text.slice(0, from); let stage: ManualStage | null = null; let bestAt = -1;
    for (const [sre, st] of STAGE_PATTERNS) { sre.lastIndex = 0; let sm: RegExpExecArray | null; while ((sm = sre.exec(before))) if (sm.index > bestAt) { bestAt = sm.index; stage = st; } }
    if (!stage) for (const [sre, st] of STAGE_PATTERNS) { sre.lastIndex = 0; if (sre.test(text)) { stage = st; break; } }
    // 체크리스트: 카드 뒤 "## n. 제목" 과 "- 항목" (다음 카드 전까지)
    const after = text.slice(end, hardEnd);
    const checklist: string[] = [];
    for (const line of after.split(/\r?\n/)) {
      const h = /^\s*#{1,3}\s*\d+\s*[.)]\s*(.+)$/.exec(line); const b = /^\s*[-•·]\s*(.+)$/.exec(line);
      const t = /^\s*\|(.+?)\|?\s*$/.exec(line); // 부산: 표준행동 표가 한 줄로 납작해져 온다 — 2칸 이상 공백으로 가른다
      if (t && !/^[\s|:-]+$/.test(line)) { for (const cell of t[1].split(/\s{2,}|\s*\|\s*/).map(clean).filter((x) => x && !/^(표준행동|지시내용|비고|-+)$/.test(x))) { checklist.push(cell); if (checklist.length >= 10) break; } if (checklist.length >= 10) break; continue; }
      const v = clean(h?.[1] ?? b?.[1] ?? ''); if (!v || v === '-' || /^-+$/.test(v)) continue;
      if (h) checklist.push(`[${v}]`); else if (b) checklist.push(v.replace(/^[ⓢⓒ]/, ''));
      if (checklist.length >= 10) break;
    }
    out.push({ code, coop, seq: [Number(codeM[2]), Number(codeM[3])], title: clean(field('title')), content: clean(field('content')), lead: clean(short(field('lead'))), support: splitList(short(field('support'))), partner: splitList(short(field('partner'))), linkedCodes, checklist, stage, truncated, sourceRef: { doc, score, excerpt: text.slice(Math.max(0, from - 80), Math.min(text.length, end + 200)), query } });
  }
  return out;
}

/** 같은 코드가 여러 청크에서 나오면 — 온전한(잘리지 않은) 것, 유사도 높은 것을 남기고 체크리스트는 합친다 */
export function mergeCards(cards: ActionCard[]): ActionCard[] {
  const byCode = new Map<string, ActionCard>();
  for (const c of cards) {
    const cur = byCode.get(c.code);
    if (!cur) { byCode.set(c.code, { ...c, checklist: [...c.checklist] }); continue; }
    const better = (cur.truncated && !c.truncated) || (cur.truncated === c.truncated && c.sourceRef.score > cur.sourceRef.score);
    const keep = better ? { ...c } : { ...cur };
    keep.checklist = [...new Set([...(better ? c.checklist : cur.checklist), ...(better ? cur.checklist : c.checklist)])].slice(0, 12);
    if (!keep.stage) keep.stage = cur.stage ?? c.stage;
    if (!keep.linkedCodes.length) keep.linkedCodes = cur.linkedCodes.length ? cur.linkedCodes : c.linkedCodes;
    byCode.set(c.code, keep);
  }
  return [...byCode.values()].sort(cardOrder);
}
export const coopIndex = (coop: string) => { const i = CIRCLED.indexOf(coop); return i < 0 ? 99 : i; };
export function cardOrder(a: ActionCard, b: ActionCard) { return coopIndex(a.coop) - coopIndex(b.coop) || a.seq[0] - b.seq[0] || a.seq[1] - b.seq[1]; }

export interface ExtractOptions {
  queryPrefix: string;                       // 예: "영천시 풍수해 현장조치 행동매뉴얼"
  docFilter?: string;                        // 출처 파일명에 이 문자열이 있어야 채택 (예: "영천")
  coops: { code: string; name: string }[];   // 기관 설정의 협업기능 ①~⑬
  depth?: 'quick' | 'deep';                  // quick: 협업기능별 13회(top_k 20) · deep: + 단계×협업기능 65회(top_k 10)
  gapFill?: boolean;                         // 코드 빈자리(①-2-3 빠짐 등) 직접 질의 (top_k 3, 최대 40회)
}
export interface ExtractProgress { phase: 'search' | 'deep' | 'gap' | 'done'; i: number; total: number; query: string; found: number; unique: number; elapsedMs: number }

/**
 * 유니 검색을 순차로 돌려 조치카드를 모은다(동시 호출 금지 — 유니 검색은 순차가 안전, 실측 2026-08-22).
 * 실측 2026-08-23: 검색은 결과 1건당 약 1.2초(재정렬) — top_k 10 ≈ 12초, 20 ≈ 23초. 그래서 기본은 협업기능별 13회(top_k 20, 약 5분) + 빈자리 채우기.
 */
export async function extractCards(opt: ExtractOptions, onProgress?: (p: ExtractProgress) => void): Promise<{ cards: ActionCard[]; queries: number; docs: string[]; skippedDocs: string[]; elapsedMs: number }> {
  const t0 = Date.now();
  const all: ActionCard[] = []; const docs = new Set<string>(); const skipped = new Set<string>();
  const accept = (doc: string) => !opt.docFilter || doc.includes(opt.docFilter);
  let nQueries = 0;
  const runQuery = async (q: string, topK: number, phase: ExtractProgress['phase'], i: number, total: number) => {
    let found = 0; nQueries++;
    try {
      const r = await search(q, topK);
      for (const res of r.results) {
        if (!accept(res.filename)) { skipped.add(res.filename); continue; }
        docs.add(res.filename);
        const cards = parseActionCards(res.text, res.filename, res.score, q); found += cards.length; all.push(...cards);
      }
      onProgress?.({ phase, i, total, query: q, found, unique: mergeCards(all).length, elapsedMs: Date.now() - t0 });
    } catch (e) { onProgress?.({ phase, i, total, query: `${q} — 실패: ${(e as Error).message}`, found: 0, unique: mergeCards(all).length, elapsedMs: Date.now() - t0 }); }
  };
  const base = opt.coops.map((c) => `${opt.queryPrefix} ${c.code}${c.name} 조치목록 코드번호 조치내용 주관부서 지원부서 협업기관 연계코드`);
  for (let i = 0; i < base.length; i++) await runQuery(base[i], 20, 'search', i + 1, base.length);
  if (opt.depth === 'deep') {
    const deep: string[] = [];
    for (const st of MANUAL_STAGES) for (const c of opt.coops) deep.push(`${opt.queryPrefix} ${STAGE_QUERY[st]} ${c.code}${c.name} 조치목록 코드번호 조치내용`);
    for (let i = 0; i < deep.length; i++) await runQuery(deep[i], 10, 'deep', i + 1, deep.length);
  }
  // 빈자리 채우기: 같은 협업기능·같은 묶음(①-2-x)에서 번호가 건너뛴 코드를 직접 질의
  if (opt.gapFill !== false) {
    const merged = mergeCards(all); const gaps: string[] = [];
    const groups = new Map<string, number[]>();
    for (const c of merged) { const k = `${c.coop}-${c.seq[0]}`; groups.set(k, [...(groups.get(k) ?? []), c.seq[1]]); }
    for (const [k, nums] of groups) { const max = Math.max(...nums); for (let n = 1; n <= max + 1; n++) if (!nums.includes(n)) gaps.push(`${k}-${n}`); }
    // 연계코드로 언급됐지만 아직 없는 코드도 후보
    for (const c of merged) for (const l of c.linkedCodes) if (!merged.some((x) => x.code === l.code) && !gaps.includes(l.code)) gaps.push(l.code);
    const gapQ = gaps.slice(0, 40);
    for (let i = 0; i < gapQ.length; i++) await runQuery(`${opt.queryPrefix} 코드번호 ${gapQ[i]} 조치목록 조치내용 주관부서`, 3, 'gap', i + 1, gapQ.length);
  }
  const cards = mergeCards(all);
  onProgress?.({ phase: 'done', i: nQueries, total: nQueries, query: '', found: all.length, unique: cards.length, elapsedMs: Date.now() - t0 });
  return { cards, queries: nQueries, docs: [...docs], skippedDocs: [...skipped], elapsedMs: Date.now() - t0 };
}

// ── 카드 → SOP 템플릿 그래프 ────────────────────────────────────────────────

export interface TemplateOptions { hazard: string; stages?: ManualStage[]; coops?: string[]; maxNodes?: number }
const DECISION_RE = /대피\s*명령|위기\s*경보\s*(발령|상향)|주민\s*대피|통제\s*여부|긴급\s*재난\s*문자|CBS/;

/** 단계 → 협업기능 → 코드 순으로 늘어놓고, 판단이 필요한 카드(대피명령·경보 발령 등) 앞에는 판단 노드를 넣는다 */
export function buildTemplateGraph(cards: ActionCard[], opt: TemplateOptions, docs: string[]): SopGraph {
  const stages = opt.stages?.length ? opt.stages : MANUAL_STAGES;
  const pendingNo: string[] = []; // 판단 노드의 NO 분기 — 다음 노드가 생기면 잇는다
  let pick = cards.filter((c) => (!opt.coops?.length || opt.coops.includes(c.coop)) && (c.stage ? stages.includes(c.stage) : true));
  pick = pick.sort((a, b) => (a.stage ? MANUAL_STAGES.indexOf(a.stage) : 99) - (b.stage ? MANUAL_STAGES.indexOf(b.stage) : 99) || cardOrder(a, b));
  if (opt.maxNodes && pick.length > opt.maxNodes) pick = pick.slice(0, opt.maxNodes);
  const nodes: SopNode[] = []; const edges: SopEdge[] = []; const warnings: string[] = [];
  const N = (n: SopNode) => { nodes.push(n); return n.id; };
  const startId = N({ id: 'n_start', type: 'START', title: `시작 · ${opt.hazard} 상황 발생`, tasks: [] });
  let prev = startId; let prevLabel: string | undefined;
  const link = (to: string, label?: string) => { edges.push({ from: prev, to, label }); };
  const idOf = (code: string) => `c_${code.replace(/[^0-9①-⑳]/g, '_')}`;
  let k = 0;
  for (const c of pick) {
    const title = c.content || c.title || c.code;
    const type: NodeType = refineType('TASK', `${c.title} ${c.content} ${c.checklist.join(' ')}`);
    const id = idOf(c.code) + (nodes.some((n) => n.id === idOf(c.code)) ? `_${k++}` : '');
    const node: SopNode = { id, type, title, dept: c.lead.split(/\s*,\s*/)[0] || undefined, tasks: c.checklist.map((x) => x.replace(/^\[(.*)\]$/, '$1')), code: c.code, coop: c.coop, lead: c.lead, support: c.support, partner: c.partner, linkedCodes: c.linkedCodes.map((l) => l.code), stage: c.stage ?? undefined, sourceRef: { doc: c.sourceRef.doc, score: c.sourceRef.score, excerpt: c.sourceRef.excerpt } };
    if (DECISION_RE.test(c.content)) {
      const dId = N({ id: `d_${id}`, type: 'DECISION', title: `${title} 필요 여부`, tasks: ['상황판단회의 결정 확인'], coop: c.coop, stage: c.stage ?? undefined });
      link(dId, prevLabel); prevLabel = undefined;
      N(node); edges.push({ from: dId, to: id, label: 'YES' });
      // NO 분기는 다음 노드로 — 다음 노드가 생기면 잇는다
      prev = id; pendingNo.push(dId);
      continue;
    }
    N(node); link(id, prevLabel); prevLabel = undefined;
    for (const d of pendingNo.splice(0)) edges.push({ from: d, to: id, label: 'NO' });
    prev = id;
  }
  const endId = N({ id: 'n_end', type: 'END', title: '종료 · 상황 종료 보고', tasks: [] });
  link(endId);
  for (const d of pendingNo.splice(0)) edges.push({ from: d, to: endId, label: 'NO' });
  if (!pick.length) warnings.push('선택 조건에 맞는 조치카드가 없어 시작·종료만 있는 템플릿');
  const noStage = pick.filter((c) => !c.stage).length; if (noStage) warnings.push(`단계 미상 카드 ${noStage}장은 맨 뒤에 배치`);
  return { nodes, edges, sources: docs.map((d) => ({ filename: d, score: 1, text: '매뉴얼 조치카드 추출' })), mapperVersion: 'manual-template', warnings };
}
