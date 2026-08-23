/**
 * LLM 프롬프트 계약. UNI /chat/ 가 T3Q RPT-001/002를 대체한다.
 * T3Q가 열리면 이 파일 안의 chatStream/chatText 호출만 바꾼다.
 */
import { chatJson, chatStream, chatText, type StreamHandlers } from './uni.js';
import { t3qToc, t3qContent, t3qContentToMarkdown, t3qSymbolsFor, findT3qSection } from './t3q.js';

export interface PlanContext {
  subject: string;
  hazardType: string;
  managementPhase: string;
  place?: string; occurredAt?: string; reportedAt?: string;
  sources?: string; requiredElements?: string; writingGuide?: string;
  tone?: string; sentenceLimit?: string; outlineNumbering?: string; bodyStart?: string;
  purpose?: string; role?: string; audience?: string;
  templateId?: string | null;
  linkedExerciseId?: string | null;
}
export interface TocNode { id: string; no: string; title: string; children: TocNode[] }

function ctxText(c: PlanContext): string {
  const rows: [string, string | undefined][] = [
    ['문서 주제', c.subject], ['재난유형', c.hazardType], ['재난관리단계', c.managementPhase],
    ['장소', c.place], ['재난발생일시', c.occurredAt], ['보고일시', c.reportedAt],
    ['출처', c.sources], ['필수 포함 요소', c.requiredElements], ['작성 가이드', c.writingGuide],
    ['문체', c.tone], ['문장길이 제한', c.sentenceLimit], ['문단 개요번호 모양', c.outlineNumbering], ['본문 문장 시작', c.bodyStart],
    ['업무 목적', c.purpose], ['역할', c.role], ['타깃 독자', c.audience],
  ];
  return rows.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

function stripFences(s: string): string {
  return s.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();
}

/** 응답 텍스트에서 첫 JSON 배열/객체를 뽑는다. */
function extractJson<T>(s: string): T | null {
  const t = stripFences(s);
  const start = Math.min(...['[', '{'].map((ch) => { const i = t.indexOf(ch); return i < 0 ? Infinity : i; }));
  if (!Number.isFinite(start)) return null;
  const open = t[start]; const close = open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    if (t[i] === open) depth++;
    else if (t[i] === close) { depth--; if (depth === 0) { try { return JSON.parse(t.slice(start, i + 1)) as T; } catch { return null; } } }
  }
  return null;
}

let seq = 0;
const nid = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

// ── 목차 ──────────────────────────────────────────────────────────────────

export interface TocResult { toc: TocNode[]; provider: 't3q' | 'uni' | 'default'; title?: string; error?: string }

/** 목차: T3Q RPT-001 우선. 실패하면 UNI 채팅으로 폴백(그 사실을 provider에 남긴다). */
export async function generateTocWithProvider(ctx: PlanContext, styleRule: string, paragraphSymbol?: string): Promise<TocResult> {
  try {
    const r = await t3qToc(ctx, paragraphSymbol);
    if (r.toc.length) return { toc: r.toc, provider: 't3q', title: r.title };
  } catch (e) {
    const toc = await generateToc(ctx, styleRule);
    return { toc, provider: 'uni', error: (e as Error).message };
  }
  return { toc: await generateToc(ctx, styleRule), provider: 'uni' };
}

export async function generateToc(ctx: PlanContext, styleRule: string): Promise<TocNode[]> {
  const q = `당신은 재난안전계획서 작성 전문가다. 아래 기준정보로 재난안전계획서의 목차를 만들어라.
${ctxText(ctx)}
${styleRule}

요구:
- 대목차 6~9개, 각 대목차 아래 소목차 2~4개. 2수준까지만.
- 재난관리단계(${ctx.managementPhase})에 맞는 구성. 대응·복구는 넣지 말 것.
- 반드시 "개선사항 및 보완계획" 또는 유사한 환류 목차를 마지막에 포함할 것.
- **JSON 배열만** 출력. 설명 금지. 형식:
[{"no":"1","title":"개요","children":[{"no":"1.1","title":"목적"}]}]`;
  const text = await chatText(q, { topK: 3, mockKey: 'toc' });
  const raw = extractJson<Array<{ no?: string; title?: string; children?: Array<{ no?: string; title?: string }> }>>(text);
  if (raw && Array.isArray(raw) && raw.length) {
    return raw.map((n, i) => ({
      id: nid(), no: String(n.no ?? i + 1), title: String(n.title ?? '').trim() || `항목 ${i + 1}`,
      children: (n.children ?? []).map((c, j) => ({ id: nid(), no: String(c.no ?? `${i + 1}.${j + 1}`), title: String(c.title ?? '').trim() || `소항목 ${j + 1}`, children: [] })),
    }));
  }
  // 줄 단위 폴백: "1. 제목", "1.1 제목"
  const out: TocNode[] = [];
  for (const line of stripFences(text).split('\n')) {
    const m = line.match(/^\s*(\d+)(?:\.(\d+))?\.?\s+(.+)$/);
    if (!m) continue;
    if (!m[2]) out.push({ id: nid(), no: m[1], title: m[3].trim(), children: [] });
    else out.at(-1)?.children.push({ id: nid(), no: `${m[1]}.${m[2]}`, title: m[3].trim(), children: [] });
  }
  return out.length ? out : defaultToc();
}

export function defaultToc(): TocNode[] {
  const mk = (no: string, title: string, kids: [string, string][] = []): TocNode => ({ id: nid(), no, title, children: kids.map(([n, t]) => ({ id: nid(), no: n, title: t, children: [] })) });
  return [
    mk('1', '개요', [['1.1', '목적'], ['1.2', '적용 범위'], ['1.3', '관련 근거']]),
    mk('2', '재난 위험 분석', [['2.1', '재난 특성'], ['2.2', '취약 요소']]),
    mk('3', '대응 체계', [['3.1', '조직 및 역할'], ['3.2', '비상연락망'], ['3.3', '표준 대응 절차(SOP)']]),
    mk('4', '예방·대비 활동', [['4.1', '사전 점검'], ['4.2', '교육·훈련'], ['4.3', '물자·장비']]),
    mk('5', '상황 전파 및 보고', [['5.1', '전파 체계'], ['5.2', '보고 양식']]),
    mk('6', '개선사항 및 보완계획', [['6.1', '훈련 환류'], ['6.2', '보완 과제']]),
  ];
}

// ── 초안 ──────────────────────────────────────────────────────────────────

function tocOutline(toc: TocNode[]): string {
  return toc.map((n) => `${n.no} ${n.title}` + (n.children.length ? '\n' + n.children.map((c) => `  ${c.no} ${c.title}`).join('\n') : '')).join('\n');
}

export function findToc(toc: TocNode[], id: string): { node: TocNode; depth: number; parent: TocNode | null } | null {
  for (const n of toc) {
    if (n.id === id) return { node: n, depth: 1, parent: null };
    for (const c of n.children) if (c.id === id) return { node: c, depth: 2, parent: n };
  }
  return null;
}

/** heading 레벨을 depth+1부터 시작하도록 재매핑, 코드펜스 제거. */
export function normalizeDraft(md: string, depth: number): string {
  let t = stripFences(md);
  const levels = [...t.matchAll(/^(#{1,6})\s/gm)].map((m) => m[1].length);
  if (levels.length) {
    const min = Math.min(...levels);
    const shift = depth + 1 - min;
    if (shift !== 0) t = t.replace(/^(#{1,6})(\s)/gm, (_, h: string, sp: string) => '#'.repeat(Math.max(1, Math.min(6, h.length + shift))) + sp);
  }
  return t.trim();
}

export interface DraftResult { markdown: string; provider: 't3q' | 'uni'; references: unknown[]; error?: string }

/**
 * 초안: T3Q RPT-002 우선. T3Q는 섹션 단위로 통째 오므로 받은 즉시 token 이벤트로 흘린다.
 * 실패하면 UNI 토큰 스트리밍으로 폴백.
 */
export async function draftSectionWithProvider(
  ctx: PlanContext, toc: TocNode[], tocId: string, styleRule: string, symbols: string[], h: StreamHandlers, planExcerpt?: string,
): Promise<DraftResult> {
  const found = findToc(toc, tocId);
  if (!found) throw new Error('목차 항목 없음');
  const { node, depth, parent } = found;
  try {
    const req = parent
      ? [{ name: `${parent.no}. ${parent.title}`, children: [{ name: `${node.no}. ${node.title}`, children: [] }] }]
      : [{ name: `${node.no}. ${node.title}`, children: [] }];
    let target = '';
    const refs: unknown[] = [];
    await t3qContent(ctx, req, t3qSymbolsFor(symbols, depth), (s) => {
      if (!findT3qSection(s.name, node)) return;
      const md = normalizeDraft(t3qContentToMarkdown(s.content, symbols, node.title), depth);
      target = target ? `${target}\n\n${md}` : md;
      refs.push(...(s.references ?? []));
      h.onToken(md);
    });
    if (!target) throw new Error('T3Q 응답에 대상 섹션 없음');
    h.onSources?.(refs.map((r) => { const x = r as { fileName?: string; page?: string }; return { filename: x.fileName ?? '', score: 0, text: `p.${x.page ?? '?'}` }; }));
    h.onDone?.();
    return { markdown: target, provider: 't3q', references: refs };
  } catch (e) {
    const md = await draftSection(ctx, toc, tocId, styleRule, h, planExcerpt);
    return { markdown: md, provider: 'uni', references: [], error: (e as Error).message };
  }
}

export async function draftSection(
  ctx: PlanContext, toc: TocNode[], tocId: string, styleRule: string, h: StreamHandlers, planExcerpt?: string,
): Promise<string> {
  const found = findToc(toc, tocId);
  if (!found) throw new Error('목차 항목 없음');
  const { node, depth, parent } = found;
  const q = `당신은 재난안전계획서 작성 전문가다. 아래 기준정보와 전체 목차를 참고하여, **"${node.no} ${node.title}"** 항목의 본문만 작성하라.
[기준정보]
${ctxText(ctx)}
[전체 목차]
${tocOutline(toc)}
${parent ? `[상위 목차] ${parent.no} ${parent.title}` : ''}
${styleRule}
${planExcerpt ? `[참고 자료]\n${planExcerpt}\n` : ''}
요구:
- 마크다운으로 작성. 제목("${node.no} ${node.title}")은 다시 쓰지 말고 본문부터 시작.
- 소제목이 필요하면 ${'#'.repeat(depth + 1)} 수준부터 사용.
- 항목 나열은 "-" 불릿, 수치·담당·기한이 있으면 표(마크다운 표)로.
- 문장은 공문서 문체("~한다", "~하여야 한다"). ${ctx.sentenceLimit ? `문장 길이 제한: ${ctx.sentenceLimit}.` : ''}
- 근거 자료의 내용을 우선 반영하고, 없는 사실은 지어내지 말고 "[확인 필요]"로 표시.
- 분량 300~600자.`;
  const full = await chatStream(q, h, { topK: 4, mockKey: 'draft' });
  return normalizeDraft(full, depth);
}

// ── 문단 수정 ─────────────────────────────────────────────────────────────

export async function revisePara(para: string, prev: string, next: string, instruction: string, styleRule: string): Promise<string> {
  const q = `다음은 재난안전계획서의 한 문단이다. 지시에 따라 **이 문단만** 고쳐 써라.
[앞 문단] ${prev || '(없음)'}
[대상 문단] ${para}
[뒤 문단] ${next || '(없음)'}
[지시] ${instruction}
${styleRule}
요구: 고친 문단 텍스트만 출력. 따옴표·머리말·설명 금지. 마크다운 서식(불릿·표)은 원문 형식을 유지.
주의: 위 스타일 규칙은 참고용이다 — 문단 앞에 □ ㅇ - * ※ 같은 기호나 개요번호(^1. 등)를 새로 붙이지 마라. 원문에 없던 기호는 추가하지 않는다.`;
  const t = stripFences(await chatText(q, { topK: 2, mockKey: 'revise' }));
  let out = t.replace(/^["'“”]+|["'“”]+$/g, '').replace(/^(수정문|고친 문단|결과)\s*[:：]\s*/i, '').trim();
  // 원문에 없던 선두 기호/개요번호를 벗긴다 (□^1. / ㅇ / ※ 등)
  const hadBullet = /^\s*([□■○●◇◆ㅇ※\-*•·]|\^?\d+[.)])/.test(para);
  if (!hadBullet) out = out.replace(/^\s*(?:[□■○●◇◆ㅇ※•·]\s*)?(?:\^?\d+[.)]\s*)?/, '').trim();
  return out;
}

// ── SOP (UNI /chat/json → 그래프) ─────────────────────────────────────────

export type NodeType = 'START' | 'TASK' | 'DECISION' | 'DISPATCH' | 'FIELD_CHECK' | 'AUTO_LOG' | 'END';
export interface SopNode {
  id: string; type: NodeType; title: string; dept?: string; assignee?: string;
  priority?: string; due?: string; channels?: string[]; tasks?: string[]; logRules?: string[];
  // 범용화 ② (2026-08-23): 매뉴얼 조치카드 출처 — 코드·협업기능·주관/지원/협업·연계코드·단계·원문. 필드 추가만(없으면 기존 노드)
  code?: string; coop?: string; lead?: string; support?: string[]; partner?: string[]; linkedCodes?: string[]; stage?: string;
  sourceRef?: { doc: string; score: number; excerpt: string };
}
export interface SopEdge { from: string; to: string; label?: string }
export interface SopGraph { nodes: SopNode[]; edges: SopEdge[]; sources: unknown[]; mapperVersion: string; warnings: string[] }

const TYPE_CODES: Record<string, NodeType> = { '104001': 'START', '104003': 'TASK', '104005': 'DECISION' };

/** 제목 키워드로 TASK를 세분한다 (전파/현장확인/자동기록). */
export function refineType(t: NodeType, title: string): NodeType {
  if (t !== 'TASK') return t;
  if (/전파|통보|알림|공지|요청/.test(title)) return 'DISPATCH';
  if (/현장|점검|확인|출동|순찰/.test(title)) return 'FIELD_CHECK';
  if (/기록|일지/.test(title)) return 'AUTO_LOG';
  return 'TASK';
}

/** uni-sop-2 규칙(실측 CC-410) — compnSn(number)·compnTyCode·compnSj·compnAttrbSaveParamsList·endCompns. */
export function mapUniSop(items: unknown[]): SopGraph {
  const warnings: string[] = [];
  const nodes: SopNode[] = [];
  const edges: SopEdge[] = [];
  const keyOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim() : null);
  // 실측 2026-08-19: 노드는 {"__compn__": {...}} 로 감싸져 온다 (CC-410 당시엔 맨 객체). 둘 다 받는다.
  // 그 외 프레임: {"__status__": "searching|reranking|generating"}, {"__sources__": [...]}, "[DONE]"
  const unwrapped = items.map((x) => (x && typeof x === 'object' && !Array.isArray(x) && '__compn__' in (x as object) ? (x as { __compn__: unknown }).__compn__ : x));
  const rawNodes = unwrapped.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x) && ('compnSn' in (x as object) || 'compnSj' in (x as object)));
  let sources: unknown[] = [];
  for (const it of items) if (it && typeof it === 'object' && '__sources__' in (it as object)) sources = (it as { __sources__: unknown[] }).__sources__;
  if (!rawNodes.length) warnings.push(`노드 없음 — 프레임 ${items.length}개 중 인식된 compn 0`);

  const idMap = new Map<string, string>();
  for (const r of rawNodes) {
    const k = keyOf(r.compnSn); if (!k) { warnings.push('compnSn 없는 노드 건너뜀'); continue; }
    idMap.set(k, `n${idMap.size + 1}`);
  }
  for (const r of rawNodes) {
    const k = keyOf(r.compnSn); if (!k) continue;
    const id = idMap.get(k)!;
    const code = String(r.compnTyCode ?? '');
    let type: NodeType = TYPE_CODES[code] ?? 'TASK';
    if (!TYPE_CODES[code]) warnings.push(`모르는 유형 코드 ${code} → TASK`);
    const title = String(r.compnSj ?? '').trim() || `노드 ${id}`;
    type = refineType(type, title);
    const tasks: string[] = [];
    if (Array.isArray(r.compnAttrbSaveParamsList)) for (const a of r.compnAttrbSaveParamsList as Record<string, unknown>[]) {
      const sj = typeof a?.attrbSj === 'string' ? a.attrbSj.trim() : ''; const cn = typeof a?.attrbCn === 'string' ? a.attrbCn.trim() : '';
      if (sj || cn) tasks.push(sj && cn ? `${sj}: ${cn}` : sj || cn);
    }
    nodes.push({ id, type, title, tasks });
    if (Array.isArray(r.endCompns)) for (const e of r.endCompns as Record<string, unknown>[]) {
      const to = keyOf(e?.compnSn); if (!to) continue;
      const toId = idMap.get(to);
      if (!toId) { warnings.push(`간선 대상 ${to} 없음(END로 합성)`); edges.push({ from: id, to: '__END__', label: typeof e.arrwCn === 'string' ? e.arrwCn : undefined }); continue; }
      edges.push({ from: id, to: toId, label: typeof e.arrwCn === 'string' && e.arrwCn.trim() ? e.arrwCn.trim() : undefined });
    }
  }
  // END 합성 (UNI는 종료 노드를 보내지 않는다 — 실측)
  const hasEnd = nodes.some((n) => n.type === 'END');
  if (!hasEnd) {
    const endId = 'nEnd';
    nodes.push({ id: endId, type: 'END', title: '종료' });
    for (const e of edges) if (e.to === '__END__') e.to = endId;
    const outs = new Set(edges.map((e) => e.from));
    for (const n of nodes) if (n.id !== endId && !outs.has(n.id)) edges.push({ from: n.id, to: endId });
  }
  if (!nodes.some((n) => n.type === 'START') && nodes.length) nodes[0].type = 'START';
  return { nodes, edges, sources, mapperVersion: 'uni-sop-2', warnings };
}

export interface ExerciseLike { title: string; hazardType: string; alertLevel: string; phase: string; location: string; agency: string; dept: string; scenario: string; occurredAt: string }

export async function generateSop(ex: ExerciseLike, planExcerpt?: string, chatSummary?: string, onStatus?: (status: string) => void): Promise<SopGraph> {
  const q = `${ex.hazardType} 재난 대응 표준행동절차(SOP)를 작성하라. 훈련명: ${ex.title}. 상황단계: ${ex.alertLevel}, 훈련단계: ${ex.phase}. 발생위치: ${ex.location}. 훈련기관: ${ex.agency}, 담당부서: ${ex.dept}.
상황 시나리오: ${ex.scenario}
${chatSummary ? `담당자와 AI의 사전 질의응답 요약(이 내용을 절차에 반영하라):\n${chatSummary}\n` : ''}${planExcerpt ? `근거 계획서 발췌:\n${planExcerpt}\n위 계획서의 대응 체계·절차를 따르라.` : ''}
절차는 시작 → 초기 상황판단 → 대책본부 구성 → 상황/임무 전파 → 현장 확인 → 판단 분기(주민대피 필요 여부 등) → 조치결과 수신 → 상황일지 기록 → 종료 순으로 8~12개 노드.`;
  const items = await chatJson(q, { topK: 5, onStatus });
  const g = mapUniSop(items);
  if (g.nodes.length < 3) return defaultSop(ex);
  return g;
}

export function defaultSop(ex: ExerciseLike): SopGraph {
  const N = (id: string, type: NodeType, title: string, extra: Partial<SopNode> = {}): SopNode => ({ id, type, title, ...extra });
  const nodes = [
    N('n1', 'START', `시작 · ${ex.hazardType} 훈련상황 발생 등록`),
    N('n2', 'TASK', '초기 상황 판단', { dept: '안전총괄과', tasks: ['기상특보·피해 접수 확인', '상황단계 판단'] }),
    N('n3', 'TASK', '재난안전대책본부 구성 요청', { dept: '상황실', tasks: ['본부장 보고', '반별 소집'] }),
    N('n4', 'DISPATCH', '상황/임무 전파', { dept: '상황총괄반', channels: ['문자', '알림톡'], tasks: ['부서별 임무 전파', '수신 확인 요청'] }),
    N('n5', 'FIELD_CHECK', '현장 담당자 수신 확인', { dept: '현장통제반' }),
    N('n6', 'FIELD_CHECK', '피해 우려지역 현장 점검', { dept: '현장통제반', tasks: ['도로·시설 상태 확인', '사진 첨부'] }),
    N('n7', 'DECISION', '주민대피 필요 여부'),
    N('n8', 'DISPATCH', '주민대피 안내 및 유관기관 협조 요청', { dept: '주민대피지원반' }),
    N('n9', 'TASK', '모니터링 지속', { dept: '상황총괄반' }),
    N('n10', 'TASK', '조치결과 수신', { dept: '상황총괄반' }),
    N('n11', 'AUTO_LOG', '상황일지 자동 기록'),
    N('n12', 'END', '종료'),
  ];
  const edges: SopEdge[] = [
    { from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }, { from: 'n5', to: 'n6' }, { from: 'n6', to: 'n7' },
    { from: 'n7', to: 'n8', label: 'YES' }, { from: 'n7', to: 'n9', label: 'NO' }, { from: 'n8', to: 'n10' }, { from: 'n9', to: 'n10' }, { from: 'n10', to: 'n11' }, { from: 'n11', to: 'n12' },
  ];
  return { nodes, edges, sources: [], mapperVersion: 'manual', warnings: ['UNI 응답이 없어 기본 SOP를 사용'] };
}

// ── 서술 ──────────────────────────────────────────────────────────────────

export async function narrate(kind: string, facts: string, extra = ''): Promise<string> {
  const q = `다음 사실 기록을 바탕으로 안전한국훈련 상황일지의 "${kind}" 절을 공문서 문체로 2~4문장 작성하라. 사실에 없는 내용은 쓰지 말 것. 텍스트만 출력.
[사실 기록]
${facts}
${extra}`;
  return stripFences(await chatText(q, { topK: 2, mockKey: 'narrate' }));
}

export async function polish(text: string): Promise<string> {
  const q = `다음 문장을 뜻은 그대로 두고 공문서 문체로 간결하게 다듬어라. 결과 텍스트만 출력.\n${text}`;
  return stripFences(await chatText(q, { topK: 1, mockKey: 'polish' }));
}

export async function analyze(summary: string): Promise<{ suggestion: string; basis: string }> {
  const q = `다음은 진행 중인 재난 훈련 상황판 요약이다. 상황총괄 담당자에게 지금 필요한 조치 제안을 한 문장으로, 근거를 한 문장으로 답하라. 형식: {"suggestion":"...","basis":"..."} JSON만.\n${summary}`;
  const t = await chatText(q, { topK: 3, mockKey: 'analyze' });
  let j = extractJson<{ suggestion?: string; basis?: string }>(t);
  // 모델이 {"suggestion":"...":"","basis":...} 처럼 깨진 JSON을 주기도 한다 — 정규식으로 한 번 더 시도
  if (!j?.suggestion) { const m1 = t.match(/"suggestion"\s*:\s*"([^"]+)"/); const m2 = t.match(/"basis"\s*:\s*"([^"]+)"/); if (m1) j = { suggestion: m1[1], basis: m2?.[1] ?? '' }; }
  const plain = stripFences(t).replace(/[{}"\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return { suggestion: (j?.suggestion ?? plain).slice(0, 200), basis: (j?.basis ?? '').slice(0, 200) };
}

/** 훈련상황 챗봇 질의 — 기본정보를 맥락으로 붙인다. 답변은 chatStream으로 흘린다. */
export function exerciseChatQuery(ex: Partial<ExerciseLike>, question: string, history: { role: string; text: string }[] = []): string {
  const ctx = [`재난유형 ${ex.hazardType ?? '-'}`, `상황단계 ${ex.alertLevel ?? '-'}`, `훈련단계 ${ex.phase ?? '-'}`, ex.location ? `발생위치 ${ex.location}` : '', ex.scenario ? `시나리오: ${ex.scenario.slice(0, 400)}` : ''].filter(Boolean).join(', ');
  const hist = history.slice(-6).map((h) => `${h.role === 'user' ? '담당자' : 'AI'}: ${h.text.slice(0, 300)}`).join('\n');
  return `당신은 재난 상황총괄 담당자를 돕는 안전한국훈련 보조자다. 등록된 위기관리매뉴얼·훈련일지·평가서를 근거로 간결하게 답하라. 절차는 번호 목록으로, 근거가 없으면 "근거 문서에서 확인되지 않음"이라고 말하라.
[훈련상황] ${ctx}
${hist ? `[이전 대화]\n${hist}\n` : ''}[질문] ${question}`;
}
