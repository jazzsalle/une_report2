import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, put, sse, coopIndex, type ActionCard, type Exercise, type Org, type Sop, type SopGraph, type SopNode, type SopTemplateSummary, type NodeType, type User } from '../api';
import { Btn, C, Card, Chip, Field, Input, Modal, Select, Table, Textarea, Toast, useToast } from '../ui';

/** 유니 /chat/json 진행 프레임(`__status__`) 라벨 — 실측 순서: searching → reranking → generating */
const STAGE_LABEL: Record<string, string> = { requesting: '유니에 요청', searching: '근거 문서 검색', reranking: '근거 재정렬', generating: 'SOP 절차 생성', end: '마무리' }; // end: 유니가 마지막에 보내는 프레임(실측 2026-08-22)
const STAGES = ['requesting', 'searching', 'reranking', 'generating'];
function SopProgress({ stage, elapsed }: { stage: string | null; elapsed: number }) {
  const idx = stage === 'end' ? STAGES.length : Math.max(0, STAGES.indexOf(stage ?? 'requesting'));
  return (
    <div style={{ padding: '60px 24px', textAlign: 'center', color: C.muted }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>유니 SOP API(/chat/json)로 절차를 생성하고 있습니다 · {elapsed}초</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>상황 정보 + 챗봇 대화 요약 + 인용 근거를 전달 · 보통 60~80초 걸립니다</div>
      <ol style={{ listStyle: 'none', padding: 0, margin: '20px auto 0', display: 'flex', gap: 8, justifyContent: 'center', maxWidth: 640 }} aria-label="진행 단계">
        {STAGES.map((k, i) => <li key={k} style={{ flex: 1, padding: '8px 6px', borderRadius: 6, fontSize: 12.5, fontWeight: i === idx ? 700 : 500, background: i < idx ? C.greenBg : i === idx ? C.blueLight : '#fff', color: i < idx ? C.green : i === idx ? C.blue : C.muted, border: `1px solid ${i === idx ? C.blue : C.border}` }}>{i < idx ? '✓ ' : i === idx ? '● ' : ''}{STAGE_LABEL[k]}</li>)}
      </ol>
    </div>
  );
}

const TYPES: { type: NodeType; label: string; icon: string; bg: string; fg: string }[] = [
  { type: 'START', label: '시작', icon: '▶', bg: '#1e2124', fg: '#fff' },
  { type: 'TASK', label: '프로세스/임무', icon: '□', bg: '#fff', fg: '#1e2124' },
  { type: 'DECISION', label: '판단', icon: '◇', bg: '#fff8e1', fg: '#9d5b00' },
  { type: 'DISPATCH', label: '상황전파', icon: '▷', bg: '#eff5ff', fg: '#0b50d0' },
  { type: 'FIELD_CHECK', label: '현장확인', icon: '◎', bg: '#eef7f0', fg: '#228738' },
  { type: 'AUTO_LOG', label: '상황일지 자동기록', icon: '≡', bg: '#f4f5f6', fg: '#464c53' },
  { type: 'END', label: '종료', icon: '■', bg: '#1e2124', fg: '#fff' },
];
const T = (t: NodeType) => TYPES.find((x) => x.type === t)!;
const LOG_RULES = ['전파 시 자동 기록', '수신 확인 시 자동 기록', '완료 보고 시 자동 기록', '지연 발생 시 자동 기록'];

/** 카드형 노드 크기(2026-08-23): 제목 2줄 + 담당·배지 줄. 시작/종료는 알약 */
const NODE_W = 280, NODE_H = 76, PILL_H = 44, GAP_Y = 130, GAP_X = 320;
/** 스윔레인(D, 2026-08-23): 협업기능별 세로 띠. 띠 너비·행 간격 */
const LANE_W = 310, LANE_ROW = NODE_H + 34, LANE_HEAD = 46;
const nodeH = (t: NodeType) => (t === 'START' || t === 'END' ? PILL_H : NODE_H);
/** 제목을 max자씩 최대 2줄로 — 공백이 있으면 단어 경계 우선, 2줄을 넘으면 말줄임 */
function wrapText(text: string, max = 18): string[] {
  const words = text.split(/\s+/).filter(Boolean); const lines: string[] = []; let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const out: string[] = [];
  for (const l of lines) { let rest = l; while (rest.length > max) { out.push(rest.slice(0, max)); rest = rest.slice(max); } out.push(rest); }
  if (out.length > 2) return [out[0], out[1].slice(0, max - 1) + '…'];
  return out.length ? out : [''];
}
/** BFS 순번(표 보기·호버 카드용): 깊이 → 같은 깊이 안에서는 x 순 */
function orderOf(g: SopGraph, pos: Map<string, { x: number; y: number }>): string[] {
  return [...g.nodes].map((n) => n.id).sort((a, b) => { const pa = pos.get(a) ?? { x: 0, y: 0 }; const pb = pos.get(b) ?? { x: 0, y: 0 }; return pa.y - pb.y || pa.x - pb.x; });
}
/** BFS 깊이(시작 노드부터). 닿지 않는 노드는 맨 뒤 */
function depthOf(g: SopGraph): Map<string, number> {
  const start = g.nodes.find((n) => n.type === 'START') ?? g.nodes[0]; const depth = new Map<string, number>(); if (!start) return depth;
  depth.set(start.id, 0); const q = [start.id];
  while (q.length) { const id = q.shift()!; for (const e of g.edges.filter((e) => e.from === id)) if (!depth.has(e.to)) { depth.set(e.to, depth.get(id)! + 1); q.push(e.to); } }
  for (const n of g.nodes) if (!depth.has(n.id)) depth.set(n.id, Math.max(...depth.values(), 0) + 1);
  return depth;
}
/** 세로 흐름 레이아웃: BFS 깊이 = 행, 같은 행에 여럿이면 가로 분산 (판단 분기) */
function layout(g: SopGraph): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const depth = depthOf(g);
  const rows = new Map<number, string[]>(); for (const [id, d] of depth) rows.set(d, [...(rows.get(d) ?? []), id]);
  const W = 640;
  for (const [d, ids] of rows) ids.forEach((id, i) => pos.set(id, { x: W / 2 + (i - (ids.length - 1) / 2) * GAP_X, y: 50 + d * GAP_Y }));
  return pos;
}
/** 스윔레인 레이아웃: 열 = 협업기능(①~⑬, 없으면 '기타'), 행 = 흐름 순서(노드마다 한 행 — 겹치지 않게) */
function laneLayout(g: SopGraph, lanes: string[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const depth = depthOf(g);
  const order = [...g.nodes].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0));
  // 시작·종료는 첫 띠에 둔다(협업기능이 없다고 '기타' 띠로 보내면 선이 화면을 가로지른다 — 2026-08-23 캡처). 접힌 단계 막대는 전체 폭 중앙
  order.forEach((n, i) => { const col = n.type === 'START' || n.type === 'END' ? 0 : Math.max(0, lanes.indexOf(n.coop ?? '기타')); pos.set(n.id, { x: isGroup(n) ? Math.max((lanes.length * LANE_W) / 2, GROUP_W / 2 + 12) : col * LANE_W + LANE_W / 2, y: LANE_HEAD + 40 + i * LANE_ROW }); }); // 띠가 하나뿐이면(부산처럼 협업기능 없는 코드) 막대가 왼쪽으로 삐져나가지 않게
  return pos;
}
/**
 * 현재 단계만 보기 (사용성 제안 수용, 2026-08-23): 상황이 전개되면 "지금 단계의 임무"만 보여야 빠르다.
 * 접을 단계의 노드들을 단계당 하나의 묶음 노드(g_<단계>)로 치환한 축약 그래프를 만든다. 간선은 묶음으로 옮기고 중복·자기 간선은 버린다.
 */
const GROUP_H = 40, GROUP_W = NODE_W + 120;
const isGroup = (n: SopNode) => n.id.startsWith('g_');
const hOf = (n: SopNode | undefined) => (n ? (isGroup(n) ? GROUP_H : nodeH(n.type)) : NODE_H);
function condense(g: SopGraph, collapsed: string[]): { graph: SopGraph; groups: Map<string, { stage: string; ids: string[] }> } {
  const groups = new Map<string, { stage: string; ids: string[] }>();
  if (!collapsed.length) return { graph: g, groups };
  const idOf = (n: SopNode) => (n.stage && collapsed.includes(n.stage) ? `g_${n.stage}` : n.id);
  const nodes: SopNode[] = [];
  for (const n of g.nodes) {
    const gid = idOf(n);
    if (gid === n.id) { nodes.push(n); continue; }
    const cur = groups.get(gid);
    if (cur) cur.ids.push(n.id); else { groups.set(gid, { stage: n.stage!, ids: [n.id] }); nodes.push({ id: gid, type: 'TASK', title: `${n.stage} 단계`, stage: n.stage, tasks: [] }); }
  }
  const seen = new Set<string>(); const edges: SopGraph['edges'] = [];
  const map = new Map(g.nodes.map((n) => [n.id, idOf(n)]));
  for (const e of g.edges) { const from = map.get(e.from) ?? e.from; const to = map.get(e.to) ?? e.to; if (from === to) continue; const k = `${from}>${to}`; if (seen.has(k)) continue; seen.add(k); edges.push({ from, to, label: from.startsWith('g_') || to.startsWith('g_') ? undefined : e.label }); }
  return { graph: { ...g, nodes, edges }, groups };
}

export function SitSop() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const [ex, setEx] = useState<Exercise | null>(null);
  const [graph, setGraph] = useState<SopGraph | null>(null);
  const [version, setVersion] = useState(0);
  const [sel, setSel] = useState<string | null>(() => sp.get('node'));
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [org, setOrg] = useState<Org | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  // B 호버 카드 · E 순서도/표 보기 (2026-08-23) · D 스윔레인 · C 줌/팬 (범용화 ②)
  const [hover, setHover] = useState<string | null>(null);
  // ?view=table|lane / ?node=<id> 로 보기·선택을 링크로 열 수 있다(전파·상황판에서 특정 임무로 바로 오기, 캡처용)
  const [view, setView] = useState<'flow' | 'lane' | 'table'>(() => { const v = sp.get('view') ?? localStorage.getItem('poc.sop.view'); return v === 'table' || v === 'lane' ? v : 'flow'; });
  const switchView = (v: 'flow' | 'lane' | 'table') => { setView(v); localStorage.setItem('poc.sop.view', v); };
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [aiQ, setAiQ] = useState('');
  const [aiA, setAiA] = useState<{ text: string; sources: { filename: string; score: number; text: string }[]; streaming: boolean } | null>(null);
  // 범용화 ②: 매뉴얼 카드 가져오기 · 원문 보기 · 템플릿 적용
  const [cardsOpen, setCardsOpen] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);
  const [templates, setTemplates] = useState<SopTemplateSummary[]>([]);
  // 현재 단계만 보기: 기본 켬(localStorage). expanded = 사용자가 추가로 펼친 단계. 단계가 바뀌면 비우고 새 단계 구간으로 스크롤
  const [focus, setFocus] = useState(() => localStorage.getItem('poc.sop.focus') !== '0');
  const [expanded, setExpanded] = useState<string[]>([]);
  const prevStage = useRef<string | null>(null);
  const scrollReq = useRef(false);
  const [toast, show] = useToast();
  const load = async () => { const e = await get<Exercise>(`/exercises/${id}`); setEx(e); if (e.sop) { setGraph(e.sop.graph); setVersion(e.sop.version); } return e; };
  // 셸의 상황판단회의 저장 → 상황 다시 읽기(단계·경보 갱신)
  useEffect(() => { const h = () => { void load(); }; window.addEventListener('poc:exercise-updated', h); return () => window.removeEventListener('poc:exercise-updated', h); }, [id]);
  useEffect(() => {
    get<User[]>('/users').then(setUsers); get<Org>('/org').then(setOrg).catch(() => {});
    void load().then((e) => { get<SopTemplateSummary[]>(`/sop-templates?hazard=${encodeURIComponent(e.hazardType)}`).then(setTemplates).catch(() => {}); if (sp.get('generate') === '1' && !e.sop) { void generate(); setSp({}); } });
  }, [id]);
  // 유니 SOP는 60~80초 걸린다 — 진행 단계(`__status__`)와 경과 시간을 흘려 체감을 낫게 한다
  const [stage, setStage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (!busy) return; const t0 = Date.now(); setElapsed(0); const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000); return () => clearInterval(t); }, [busy]);
  const generate = () => new Promise<void>((resolve) => {
    setBusy(true); setStage('requesting');
    const finish = () => { setBusy(false); setStage(null); resolve(); };
    sse(`/exercises/${id}/sop/generate/stream`, {
      status: (d) => setStage((d as { status: string }).status),
      done: (d) => { const s = d as Sop; setGraph(s.graph); setVersion(s.version); show(`SOP 초안 v0.${s.version} 생성 (${s.graph.nodes.length}노드, ${s.graph.mapperVersion.startsWith('template') ? '매뉴얼 템플릿' : s.graph.mapperVersion})`); if (s.graph.warnings.length) console.info('SOP warnings', s.graph.warnings); void load(); finish(); },
      error: (d) => { show((d as { error?: string; message?: string }).error ?? (d as { message?: string }).message ?? '생성 실패'); finish(); },
    });
  });
  const applyTemplate = async (tid: string) => { if (!tid) return; const s = await post<Sop>(`/exercises/${id}/sop/from-template`, { templateId: tid }); setGraph(s.graph); setVersion(s.version); show(`템플릿 적용 v0.${s.version} (${s.graph.nodes.length}노드)`); await load(); };
  const save = async () => { if (!graph) return; const s = await put<Sop>(`/exercises/${id}/sop`, { ...graph, mapperVersion: 'manual' }); setVersion(s.version); show(`SOP v0.${s.version} 저장`); await load(); };
  const start = async () => { await save(); const tasks = await post<unknown[]>(`/exercises/${id}/start`, {}); show(`임무 ${tasks.length}건 생성 — 상황 실행`); nav(`/sit/${id}/dispatch`); };
  // 스윔레인 열: 그래프에 있는 협업기능(①~⑬ 순) + 없는 노드는 '기타'
  const lanes = useMemo(() => { if (!graph) return []; const s = [...new Set(graph.nodes.map((n) => n.coop).filter(Boolean) as string[])].sort((a, b) => coopIndex(a) - coopIndex(b)); return graph.nodes.some((n) => !n.coop && n.type !== 'START' && n.type !== 'END') ? [...s, '기타'] : s; }, [graph]);
  const laneName = (c: string) => (c === '기타' ? '미지정' : org?.coopFunctions.find((x) => x.code === c)?.name ?? '');
  const curStage = ex?.stage ?? '초기대응';
  const stagesInGraph = useMemo(() => (graph ? [...new Set(graph.nodes.map((n) => n.stage).filter(Boolean) as string[])] : []), [graph]);
  const canFocus = stagesInGraph.length > 1; // 단계 정보가 둘 이상일 때만 의미 있음(유니 생성 SOP는 단계가 없다)
  const collapsed = canFocus && focus ? stagesInGraph.filter((st) => st !== curStage && !expanded.includes(st)) : [];
  // 선택 노드가 접힌 구간에 있으면 그 구간을 펼친다(?node= 링크·표에서 선택)
  useEffect(() => { if (!graph || !sel) return; const n = graph.nodes.find((x) => x.id === sel); if (n?.stage && collapsed.includes(n.stage)) setExpanded((e) => [...e, n.stage!]); }, [sel, graph]);
  // 단계가 바뀌면(상황판단회의) 펼침을 초기화하고 새 단계 구간으로 이동
  useEffect(() => { if (!ex) return; if (prevStage.current && prevStage.current !== curStage) { setExpanded([]); scrollReq.current = true; show(`대응 단계 ${prevStage.current} → ${curStage}: 해당 구간을 펼쳤습니다`); } prevStage.current = curStage; }, [curStage, ex]);
  const { graph: vgraph, groups } = useMemo(() => (graph ? condense(graph, collapsed) : { graph: null, groups: new Map<string, { stage: string; ids: string[] }>() }), [graph, collapsed.join('|')]);
  const pos = useMemo(() => (vgraph ? (view === 'lane' ? laneLayout(vgraph, lanes) : layout(vgraph)) : new Map<string, { x: number; y: number }>()), [vgraph, view, lanes]);
  const order = useMemo(() => (vgraph ? orderOf(vgraph, view === 'lane' ? layout(vgraph) : pos) : []), [vgraph, pos, view]);
  const fullOrder = useMemo(() => (graph ? orderOf(graph, layout(graph)) : []), [graph]); // 표 보기는 전체
  // 단계 구분선 위치: 흐름 순서(order)로 훑으며 단계가 바뀌는 첫 노드의 위쪽(접힌 묶음은 막대 자체가 라벨이라 제외)
  const stageBreaks = useMemo(() => {
    if (!vgraph) return [] as { y: number; label: string; stage: string }[];
    const out: { y: number; label: string; stage: string }[] = []; let cur: string | undefined;
    for (const nid of order) { const n = vgraph.nodes.find((x) => x.id === nid); const p = pos.get(nid); if (!n || !p || !n.stage) continue; if (isGroup(n)) { cur = n.stage; continue; } if (n.stage === cur) continue; cur = n.stage; out.push({ y: p.y - nodeH(n.type) / 2 - (view === 'lane' ? 18 : 26), label: `${n.stage} 단계${n.stage === curStage ? ' · 현재' : ''}`, stage: n.stage }); }
    return out;
  }, [vgraph, order, pos, view, curStage]);
  // 단계 변경·집중 보기 전환 뒤 현재 단계 구간으로 스크롤
  useEffect(() => { if (!scrollReq.current || !vgraph) return; scrollReq.current = false; const first = order.find((nid) => vgraph.nodes.find((x) => x.id === nid)?.stage === curStage); const p = first ? pos.get(first) : null; const el = canvasRef.current; if (p && el) el.scrollTo({ top: Math.max(0, (p.y - 140) * zoom), behavior: 'smooth' }); }, [pos, order, vgraph, curStage, zoom]);
  const toggleFocus = () => { const v = !focus; setFocus(v); localStorage.setItem('poc.sop.focus', v ? '1' : '0'); setExpanded([]); scrollReq.current = v; };
  const svgW = view === 'lane' ? Math.max(900, lanes.length * LANE_W + 40, GROUP_W + 40) : Math.max(900, ...[...pos.values()].map((p) => p.x + NODE_W / 2 + 40));
  const svgH = Math.max(...[...pos.values()].map((p) => p.y), 100) + 120;
  const hoverId = hover ?? sel; // 선택된 노드는 카드를 고정 표시
  const hoverNode = hoverId && !hoverId.startsWith('g_') ? graph?.nodes.find((n) => n.id === hoverId) ?? null : null;
  const hoverPos = hoverId ? pos.get(hoverId) ?? null : null;
  const node = graph?.nodes.find((n) => n.id === sel) ?? null;
  const upd = (patch: Partial<SopNode>) => { if (!graph || !sel) return; setGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === sel ? { ...n, ...patch } : n)) }); };
  /** 선택 노드 아래에 끼워 넣기(선택 없으면 끝에) */
  const insertNode = (newNode: SopNode) => {
    if (!graph) return;
    const edges = [...graph.edges];
    if (sel) { const out = edges.filter((e) => e.from === sel); if (out.length === 1 && newNode.type !== 'END') { edges.push({ from: newNode.id, to: out[0].to }); edges.splice(edges.indexOf(out[0]), 1); } edges.push({ from: sel, to: newNode.id }); }
    setGraph({ ...graph, nodes: [...graph.nodes, newNode], edges }); setSel(newNode.id);
  };
  const addNode = (type: NodeType) => { const t = T(type); insertNode({ id: `n${Date.now().toString(36)}`, type, title: t.label, tasks: [] }); };
  const addFromCard = (c: ActionCard) => {
    const title = c.content || c.title || c.code; const type: NodeType = /전파|통보|알림|공지|요청|보고/.test(title) ? 'DISPATCH' : /현장|점검|확인|출동|순찰/.test(title) ? 'FIELD_CHECK' : 'TASK';
    insertNode({ id: `c${Date.now().toString(36)}`, type, title, dept: c.lead.split(/\s*,\s*/)[0] || undefined, tasks: c.checklist.map((x) => x.replace(/^\[(.*)\]$/, '$1')), code: c.code, coop: c.coop, lead: c.lead, support: c.support, partner: c.partner, linkedCodes: c.linkedCodes.map((l) => l.code), stage: c.stage ?? undefined, sourceRef: { doc: c.sourceRef.doc, score: c.sourceRef.score, excerpt: c.sourceRef.excerpt } });
    show(`${c.code} 추가`);
  };
  const removeNode = () => {
    if (!graph || !sel) return; const inE = graph.edges.filter((e) => e.to === sel); const outE = graph.edges.filter((e) => e.from === sel);
    const edges = graph.edges.filter((e) => e.from !== sel && e.to !== sel);
    if (inE.length && outE.length) for (const a of inE) for (const b of outE) edges.push({ from: a.from, to: b.to, label: a.label });
    setGraph({ ...graph, nodes: graph.nodes.filter((n) => n.id !== sel), edges }); setSel(null);
  };
  const toggleLink = (target: string) => {
    if (!graph || !linkFrom) return;
    const exists = graph.edges.find((e) => e.from === linkFrom && e.to === target);
    setGraph({ ...graph, edges: exists ? graph.edges.filter((e) => e !== exists) : [...graph.edges, { from: linkFrom, to: target }] }); setLinkFrom(null);
  };
  const askAi = () => {
    if (!aiQ.trim() || !node) return;
    const q = `SOP 노드 "${node.title}"(유형 ${T(node.type).label}${node.code ? `, 매뉴얼 코드 ${node.code}` : ''}, 현재 세부 임무: ${(node.tasks ?? []).join('; ') || '없음'})에 대해: ${aiQ}. 세부 임무는 "- " 목록으로 답하라.`;
    setAiA({ text: '', sources: [], streaming: true });
    const es = new EventSource(`/api/exercises/${id}/chat/stream?q=${encodeURIComponent(q)}`);
    es.addEventListener('token', (e) => setAiA((a) => a && { ...a, text: a.text + (JSON.parse((e as MessageEvent).data) as { text: string }).text }));
    es.addEventListener('sources', (e) => setAiA((a) => a && { ...a, sources: (JSON.parse((e as MessageEvent).data) as { sources: typeof a.sources }).sources }));
    const fin = () => { setAiA((a) => a && { ...a, streaming: false }); es.close(); }; es.addEventListener('done', fin); es.onerror = fin;
  };
  const applyAi = () => { if (!aiA || !node) return; const items = aiA.text.split('\n').map((l) => l.match(/^\s*[-•·*]\s*(.+)$/)?.[1]?.trim()).filter(Boolean) as string[]; if (!items.length) return show('반영할 목록 항목이 없습니다'); upd({ tasks: [...(node.tasks ?? []), ...items] }); show(`${items.length}건 반영`); };
  // C 줌/팬: 버튼·Ctrl+휠로 확대/축소, 빈 바탕을 끌면 이동(스크롤), 맞춤은 화면에 전체가 들어가게
  const zoomTo = (z: number) => setZoom(Math.min(2, Math.max(0.3, Math.round(z * 100) / 100)));
  const fit = () => { const el = canvasRef.current; if (!el) return; zoomTo(Math.min(1, (el.clientWidth - 24) / svgW, (el.clientHeight - 24) / svgH)); };
  const onWheel = (e: React.WheelEvent) => { if (!e.ctrlKey) return; e.preventDefault(); zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); };
  const onDown = (e: React.MouseEvent) => { const t = e.target as HTMLElement; if (!(t.tagName === 'svg' || t === e.currentTarget || t.dataset.lane === '1')) return; const el = canvasRef.current!; drag.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }; };
  const onMove = (e: React.MouseEvent) => { const d = drag.current; if (!d) return; const el = canvasRef.current!; el.scrollLeft = d.sl - (e.clientX - d.x); el.scrollTop = d.st - (e.clientY - d.y); };
  const onUp = () => { drag.current = null; };
  useEffect(() => { const el = canvasRef.current; if (!el) return; const h = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); }; el.addEventListener('wheel', h, { passive: false }); return () => el.removeEventListener('wheel', h); }, []);
  if (!ex) return <div style={{ padding: 24 }}>불러오는 중…</div>;
  const allSources = graph?.sources ?? [];
  const fromTemplate = graph?.mapperVersion.startsWith('template');
  const renderGroup = (n: SopNode) => {
    const p = pos.get(n.id); const g = groups.get(n.id); if (!p || !g) return null;
    const w = view === 'lane' ? Math.max(GROUP_W, lanes.length * LANE_W - 40) : GROUP_W;
    return (
      <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => setExpanded((e) => [...e, g.stage])} style={{ cursor: 'pointer' }}>
        <title>{`${g.stage} 단계 임무 ${g.ids.length}개 — 클릭하면 펼칩니다`}</title>
        <rect x={-w / 2} y={-GROUP_H / 2} width={w} height={GROUP_H} rx={8} fill="#f4f5f6" stroke="#9aa3ad" strokeDasharray="5 4" />
        <text x={-w / 2 + 14} y={5} fontSize={12.5} fontWeight={800} fill="#464c53">▸ {g.stage} 단계 · 임무 {g.ids.length}개 (접힘)</text>
        <text x={w / 2 - 14} y={5} textAnchor="end" fontSize={11.5} fontWeight={700} fill={C.blue}>펼치기</text>
      </g>);
  };
  const renderNode = (n: SopNode) => {
    if (isGroup(n)) return renderGroup(n);
    const p = pos.get(n.id); if (!p) return null; const t = T(n.type); const isSel = sel === n.id; const pill = n.type === 'START' || n.type === 'END'; const h = nodeH(n.type); const lines = pill ? [n.title.length > 28 ? n.title.slice(0, 27) + '…' : n.title] : wrapText(n.title, n.code ? 16 : 18);
    const badges: { text: string; bg: string; fg: string }[] = [];
    if (n.tasks?.length) badges.push({ text: `세부 ${n.tasks.length}`, bg: '#eff5ff', fg: '#0b50d0' });
    if (n.due) badges.push({ text: n.due, bg: '#f4f5f6', fg: '#464c53' });
    if (n.priority && n.priority !== '보통') badges.push({ text: n.priority, bg: n.priority === '긴급' ? '#fdf2f0' : '#fff8e1', fg: n.priority === '긴급' ? '#d0290e' : '#9d5b00' });
    if (n.channels?.length) badges.push({ text: `채널 ${n.channels.length}`, bg: '#f4f5f6', fg: '#464c53' });
    const stroke = isSel ? C.blue : linkFrom === n.id ? C.orange : n.type === 'DECISION' ? '#d99a1c' : '#cdd1d5';
    return (
      <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => (linkFrom ? toggleLink(n.id) : setSel(isSel ? null : n.id))} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover((h0) => (h0 === n.id ? null : h0))} style={{ cursor: 'pointer' }}>
        <rect x={-NODE_W / 2} y={-h / 2} width={NODE_W} height={h} rx={pill ? h / 2 : 10} fill={t.bg} stroke={stroke} strokeWidth={isSel || linkFrom === n.id ? 3 : n.type === 'DECISION' ? 2 : 1.2} />
        {pill ? <text y={5} textAnchor="middle" fontSize={13} fontWeight={700} fill={t.fg}>{t.icon} {lines[0]}</text> : <>
          {n.type === 'DECISION' && <text x={-NODE_W / 2 + 12} y={-h / 2 + 14} fontSize={10} fontWeight={800} fill="#9d5b00">◇ 판단</text>}
          {/* 매뉴얼 코드 배지(우상단) — 조치카드 출처가 한눈에 보이게 */}
          {n.code && <g><rect x={NODE_W / 2 - 10 - (n.code.length * 7 + 10)} y={-h / 2 + 6} width={n.code.length * 7 + 10} height={15} rx={4} fill="#eef7f0" stroke="#bfe3c6" /><text x={NODE_W / 2 - 10 - (n.code.length * 7 + 10) / 2} y={-h / 2 + 17} textAnchor="middle" fontSize={10} fontWeight={800} fill="#1a6b2c">{n.code}</text></g>}
          {lines.map((l, li) => <text key={li} x={-NODE_W / 2 + 12} y={-h / 2 + (n.type === 'DECISION' ? 30 : 22) + li * 17} fontSize={13} fontWeight={700} fill={t.fg}>{li === 0 && n.type !== 'DECISION' ? `${t.icon} ` : ''}{l}</text>)}
          <text x={-NODE_W / 2 + 12} y={h / 2 - 9} fontSize={11} fill="#464c53">{((n.dept ?? n.lead?.split(',')[0]) ?? '담당 미지정') + (n.assignee ? ` · ${n.assignee}` : '')}</text>
          {badges.slice(0, 3).map((b, bi) => { const bw = b.text.length * 7 + 12; const x = NODE_W / 2 - 10 - badges.slice(0, bi + 1).reduce((acc, bb) => acc + bb.text.length * 7 + 12 + 4, 0) + 4; return <g key={bi}><rect x={x} y={h / 2 - 22} width={bw} height={16} rx={8} fill={b.bg} /><text x={x + bw / 2} y={h / 2 - 10} textAnchor="middle" fontSize={10} fontWeight={700} fill={b.fg}>{b.text}</text></g>; })}
        </>}
      </g>);
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr 340px', height: '100%', gap: 0 }}>
      {/* 팔레트 */}
      <div style={{ padding: 14, background: '#fff', borderRight: `1px solid ${C.border}`, overflow: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>컴포넌트</div>
        {TYPES.map((t) => <div key={t.type} onClick={() => addNode(t.type)} style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, fontSize: 12.5, cursor: 'pointer', background: t.bg, color: t.fg, fontWeight: 600 }} title={sel ? '선택 노드 아래에 추가' : '끝에 추가'}>{t.icon} {t.label}</div>)}
        <div onClick={() => setCardsOpen(true)} style={{ padding: '8px 10px', border: `1px dashed ${C.green}`, borderRadius: 8, marginBottom: 6, fontSize: 12.5, cursor: 'pointer', background: '#eef7f0', color: '#1a6b2c', fontWeight: 700 }} title="매뉴얼 조치카드를 골라 노드로 추가">⊕ 매뉴얼 카드에서</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>노드를 선택한 뒤 클릭하면 그 아래에 이어집니다. 노드 클릭 → 우측에서 속성 편집. Ctrl+휠로 확대/축소, 빈 바탕을 끌어 이동. [현재 단계만]이 켜져 있으면 다른 단계는 막대로 접히고, 상황판단회의로 단계가 바뀌면 그 구간이 자동으로 열립니다.</div>
        {graph?.warnings?.length ? <details style={{ marginTop: 10, fontSize: 11, color: C.muted }}><summary>매퍼 경고 {graph.warnings.length}</summary>{graph.warnings.map((w, i) => <div key={i}>· {w}</div>)}</details> : null}
      </div>
      {/* 캔버스 */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fff', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 15 }}>SOP 생성/편집</b>
          {graph && <Chip tone={fromTemplate ? 'green' : 'purple'}>{fromTemplate ? '매뉴얼 템플릿' : graph.mapperVersion === 'uni-sop-2' ? 'AI 초안' : graph.mapperVersion === 'manual' ? '편집본' : '기본 SOP'} · v0.{version}</Chip>}
          {linkFrom && <Chip tone="orange">연결 대상 노드를 클릭 (다시 클릭하면 취소)</Chip>}
          <div style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden', marginLeft: 4 }} role="tablist" aria-label="보기 방식">
            {(['flow', 'lane', 'table'] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => switchView(v)} style={{ border: 0, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: view === v ? C.blue : '#fff', color: view === v ? '#fff' : C.muted }} title={v === 'lane' ? '협업기능(부서)별 세로 띠로 보기' : undefined}>{v === 'flow' ? '순서도' : v === 'lane' ? '스윔레인' : '표'}</button>)}
          </div>
          {view !== 'table' && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '0 4px' }} aria-label="확대/축소">
            <button type="button" onClick={() => zoomTo(zoom * 0.9)} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }} title="축소 (Ctrl+휠)">−</button>
            <button type="button" onClick={() => zoomTo(1)} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, minWidth: 40 }} title="100%">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => zoomTo(zoom * 1.1)} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }} title="확대 (Ctrl+휠)">+</button>
            <button type="button" onClick={fit} style={{ border: 0, background: 'none', cursor: 'pointer', fontSize: 11.5, padding: '2px 6px', color: C.blue, fontWeight: 700 }} title="전체가 보이게 맞춤">맞춤</button>
          </div>}
          {canFocus && view !== 'table' && <button type="button" onClick={toggleFocus} aria-pressed={focus} title={focus ? `현재 대응 단계(${curStage}) 구간만 펼치고 다른 단계는 막대로 접습니다 — 끄면 전체` : '현재 단계 구간만 펼쳐 보기'} style={{ border: `1px solid ${focus ? C.blue : C.border}`, background: focus ? C.blueLight : '#fff', color: focus ? C.blue : C.muted, borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{focus ? '● ' : '○ '}현재 단계만 · {curStage}</button>}
          <div style={{ flex: 1 }} />
          {templates.length > 0 && <Select value="" onChange={(e) => void applyTemplate(e.target.value)} style={{ height: 32, width: 200, fontSize: 12 }} title="매뉴얼 조치카드로 만든 템플릿을 새 버전으로 적용"><option value="">템플릿에서 생성…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.nodes})</option>)}</Select>}
          <Btn small onClick={() => void generate()} disabled={busy}>{busy ? `${STAGE_LABEL[stage ?? ''] ?? '생성 중'}… ${elapsed}초` : graph ? 'AI로 재생성' : 'AI SOP 생성'}</Btn>
          {allSources.length > 0 && <Btn small onClick={() => setShowSources(true)}>생성 근거 {allSources.length}</Btn>}
          <Btn small disabled={!graph} onClick={() => void save()}>버전 저장</Btn>
          <Btn small kind="primary" disabled={!graph || ex.status === 'CLOSED'} onClick={() => void start()}>상황 실행으로 이동 →</Btn>
        </div>
        <div ref={canvasRef} onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} style={{ flex: 1, overflow: 'auto', position: 'relative', cursor: drag.current ? 'grabbing' : undefined, background: view !== 'table' ? 'radial-gradient(#cdd1d5 1px, transparent 1px) 0 0/22px 22px, #f4f5f6' : '#f4f5f6' }}>
          {busy && !graph && <SopProgress stage={stage} elapsed={elapsed} />}
          {!busy && !graph && <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>[AI SOP 생성]을 누르거나{templates.length ? ' 템플릿을 고르세요.' : ' 매뉴얼 템플릿을 만들어 적용하세요.'}</div>}
          {graph && view === 'table' && (
            <div style={{ padding: 16 }}>
              <Table small caption="SOP 임무 표" head={['순번', '유형', '코드', '임무명', '담당부서', '담당자', '우선순위', '기한', '채널', '세부 임무', '다음', '기록 규칙']} rows={fullOrder.map((nid, i) => {
                const n = graph.nodes.find((x) => x.id === nid)!; const t = T(n.type); const nexts = graph.edges.filter((e) => e.from === nid).map((e) => { const to = graph.nodes.find((x) => x.id === e.to); return `${e.label ? e.label + ' → ' : ''}${to?.title ?? e.to}`; });
                const isSel = sel === nid;
                return [
                  <span style={{ fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</span>,
                  <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: t.bg, color: t.fg, border: `1px solid ${C.border}`, fontSize: 11, whiteSpace: 'nowrap' }}>{t.icon} {t.label}</span>,
                  <span style={{ whiteSpace: 'nowrap' }}>{n.code ? <span style={{ fontSize: 11, fontWeight: 800, color: '#1a6b2c' }}>{n.code}</span> : <span style={{ color: C.muted }}>-</span>}{n.stage && <div style={{ fontSize: 10.5, color: n.stage === curStage ? C.blue : C.muted, fontWeight: n.stage === curStage ? 800 : 500 }}>{n.stage}{n.stage === curStage ? ' ●' : ''}</div>}</span>,
                  <button type="button" onClick={() => setSel(isSel ? null : nid)} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: isSel ? C.blue : C.text, cursor: 'pointer', textAlign: 'left', minWidth: 200, display: 'block' }}>{n.title}</button>,
                  <span style={{ fontSize: 12 }}>{n.dept ?? n.lead ?? '-'}{n.support?.length ? <div style={{ fontSize: 11, color: C.muted }}>ⓢ {n.support.join(', ')}</div> : null}{n.partner?.length ? <div style={{ fontSize: 11, color: C.muted }}>ⓒ {n.partner.join(', ')}</div> : null}</span>,
                  n.assignee ?? <span style={{ color: C.muted }}>(자동)</span>, n.priority ?? '보통', n.due ?? '-', (n.channels ?? []).join('·') || '-',
                  (n.tasks ?? []).length ? <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>{n.tasks!.map((x, j) => <li key={j}>{x}</li>)}</ul> : <span style={{ color: C.muted }}>-</span>,
                  nexts.length ? <div style={{ fontSize: 12, lineHeight: 1.6, minWidth: 120 }}>{nexts.map((x, j) => <div key={j}>{x}</div>)}</div> : <span style={{ color: C.muted }}>(종료)</span>,
                  <span style={{ fontSize: 11, color: C.muted, display: 'block', minWidth: 150 }}>{(n.logRules ?? LOG_RULES).map((r) => r.replace(' 자동 기록', '')).join(' · ')}</span>,
                ];
              })} />
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>임무명을 누르면 우측에서 편집할 수 있습니다. 순번은 흐름도의 위→아래, 왼→오른쪽 순서입니다.</div>
            </div>
          )}
          {graph && view !== 'table' && (
            <div style={{ width: svgW * zoom, height: svgH * zoom, position: 'relative' }}>
              <div style={{ transform: `scale(${zoom})`, transformOrigin: '0 0', width: svgW, height: svgH, position: 'absolute', left: 0, top: 0 }}>
                <svg width={svgW} height={svgH} style={{ display: 'block' }}>
                  <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#464c53" /></marker></defs>
                  {view === 'lane' && lanes.map((c, i) => (
                    <g key={c} data-lane="1">
                      <rect data-lane="1" x={i * LANE_W} y={0} width={LANE_W} height={svgH} fill={i % 2 ? '#eef0f2' : '#f7f8f9'} stroke="#dfe3e6" />
                      <rect x={i * LANE_W} y={0} width={LANE_W} height={LANE_HEAD} fill={c === '기타' ? '#e4e7ea' : '#dbe7f7'} stroke="#cdd1d5" />
                      <text x={i * LANE_W + LANE_W / 2} y={19} textAnchor="middle" fontSize={13} fontWeight={800} fill={c === '기타' ? '#464c53' : '#0b50d0'}>{c === '기타' ? '기타' : c}</text>
                      <text x={i * LANE_W + LANE_W / 2} y={36} textAnchor="middle" fontSize={11} fill="#464c53">{laneName(c)}</text>
                    </g>
                  ))}
                  {/* 간선: 순서도는 곡선, 스윔레인은 꺾은선(아래 → 옆 띠 → 아래) — 띠를 비스듬히 가로지르는 곡선은 어느 띠로 가는지 읽기 어렵다(사용자 제안 2026-08-23) */}
                  {/* 단계 구분선 — 매뉴얼 단계(징후감지→…→수습복구)가 바뀌는 행 위에 점선과 라벨. 긴 SOP에서 "지금 어느 단계인가"를 바로 읽게 한다 */}
                  {stageBreaks.map((b) => <g key={b.y} onClick={() => { if (canFocus && focus && b.stage !== curStage) setExpanded((e) => e.filter((x) => x !== b.stage)); }} style={{ cursor: canFocus && focus && b.stage !== curStage ? 'pointer' : undefined }}><title>{canFocus && focus && b.stage !== curStage ? '클릭하면 이 단계를 접습니다' : ''}</title><line x1={0} y1={b.y} x2={svgW} y2={b.y} stroke="#9aa3ad" strokeDasharray="6 5" /><rect x={8} y={b.y - 11} width={b.label.length * 12 + 14} height={22} rx={11} fill={b.stage === curStage ? C.blue : '#1e2124'} /><text x={15} y={b.y + 4} fontSize={11.5} fontWeight={800} fill="#fff">{b.label}</text></g>)}
                  {vgraph!.edges.map((e, i) => { const a = pos.get(e.from); const b = pos.get(e.to); if (!a || !b) return null; const na = vgraph!.nodes.find((x) => x.id === e.from); const nb = vgraph!.nodes.find((x) => x.id === e.to); const y1 = a.y + hOf(na) / 2; const y2 = b.y - hOf(nb) / 2; const ax = view === 'lane' && na && isGroup(na) ? LANE_W / 2 : a.x; const bx = view === 'lane' && nb && isGroup(nb) ? LANE_W / 2 : b.x; /* 스윔레인에서 접힌 막대는 첫 띠 쪽으로 선을 잇는다(긴 사선 방지) */ const mid = (y1 + y2) / 2; return (
                    <g key={i}><path d={view === 'lane' ? `M${ax},${y1} V${mid} H${bx} V${y2}` : `M${ax},${y1} C${ax},${mid} ${bx},${mid} ${bx},${y2}`} stroke="#8a949e" strokeWidth={1.6} fill="none" strokeLinejoin="round" markerEnd="url(#arr)" />
                      {e.label && <text x={(ax + bx) / 2 + (bx > ax ? 14 : bx < ax ? -14 : 12)} y={mid} fontSize={11} fontWeight={800} fill={e.label === 'YES' ? '#228738' : '#d0290e'} textAnchor="middle">{e.label}</text>}</g>); })}
                  {vgraph!.nodes.map(renderNode)}
                </svg>
                {hoverNode && hoverPos && (
                  <div style={{ position: 'absolute', left: hoverPos.x + NODE_W / 2 + 12 + 300 > svgW ? hoverPos.x - NODE_W / 2 - 12 - 300 : hoverPos.x + NODE_W / 2 + 12, top: Math.max(8, hoverPos.y - 40), width: 300, background: '#fff', border: `1px solid ${sel === hoverNode.id ? C.blue : C.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.14)', padding: '10px 12px', fontSize: 12.5, lineHeight: 1.6, pointerEvents: 'none', zIndex: 5 }}>
                    <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 4 }}>{T(hoverNode.type).icon} {hoverNode.title}</div>
                    <div style={{ color: C.muted }}>{T(hoverNode.type).label} · {hoverNode.dept ?? hoverNode.lead ?? '담당 미지정'}{hoverNode.assignee ? ` · ${hoverNode.assignee}` : ''}</div>
                    {hoverNode.code && <div style={{ color: '#1a6b2c', fontSize: 11.5 }}>매뉴얼 {hoverNode.code}{hoverNode.coop ? ` · ${hoverNode.coop} ${laneName(hoverNode.coop)}` : ''}{hoverNode.stage ? ` · ${hoverNode.stage}` : ''}</div>}
                    {(hoverNode.support?.length || hoverNode.partner?.length) ? <div style={{ color: C.muted, fontSize: 11.5 }}>{hoverNode.support?.length ? `ⓢ ${hoverNode.support.join(', ')} ` : ''}{hoverNode.partner?.length ? `ⓒ ${hoverNode.partner.join(', ')}` : ''}</div> : null}
                    <div style={{ color: C.muted }}>우선순위 {hoverNode.priority ?? '보통'}{hoverNode.due ? ` · 기한 ${hoverNode.due}` : ''}{hoverNode.channels?.length ? ` · ${hoverNode.channels.join('·')}` : ''}</div>
                    {hoverNode.tasks?.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>{hoverNode.tasks.slice(0, 6).map((x, j) => <li key={j}>{x}</li>)}{hoverNode.tasks.length > 6 && <li style={{ color: C.muted }}>… 외 {hoverNode.tasks.length - 6}</li>}</ul> : <div style={{ color: C.muted, marginTop: 4 }}>세부 임무 없음</div>}
                    <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>기록: {(hoverNode.logRules ?? LOG_RULES).map((r) => r.replace(' 자동 기록', '')).join(' · ')}{sel === hoverNode.id ? ' · 선택됨(우측에서 편집)' : ''}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* 속성 패널 */}
      <div style={{ padding: 14, background: '#fff', borderLeft: `1px solid ${C.border}`, overflow: 'auto' }}>
        {!node ? <div style={{ color: C.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>캔버스에서 노드를 선택하면 속성을 편집할 수 있습니다.</div> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><b style={{ fontSize: 14 }}>{T(node.type).icon} {T(node.type).label}</b> <span style={{ fontSize: 11, color: C.muted }}>속성 편집</span><div style={{ flex: 1 }} /><Btn small kind="danger" onClick={removeNode} disabled={node.type === 'START'}>삭제</Btn></div>
            {node.code && (
              <div style={{ background: '#eef7f0', border: '1px solid #bfe3c6', borderRadius: 8, padding: '8px 10px', fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ color: '#1a6b2c' }}>매뉴얼 {node.code}</b>{node.coop && <Chip tone="green">{node.coop} {laneName(node.coop)}</Chip>}{node.stage && <Chip tone="gray">{node.stage}</Chip>}<div style={{ flex: 1 }} />{node.sourceRef && <Btn small onClick={() => setSrcOpen(true)}>원문 보기</Btn>}</div>
                {node.linkedCodes?.length ? <div style={{ color: C.muted, fontSize: 11.5 }}>연계코드 {node.linkedCodes.join(' ')}</div> : null}
                {node.sourceRef && <div style={{ color: C.muted, fontSize: 11 }}>{node.sourceRef.doc}</div>}
              </div>
            )}
            <Field label="임무명"><Input value={node.title} onChange={(e) => upd({ title: e.target.value })} /></Field>
            <Field label="유형"><Select value={node.type} onChange={(e) => upd({ type: e.target.value as NodeType })}>{TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</Select></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 8px' }}>
              <Field label="담당부서"><Input value={node.dept ?? ''} onChange={(e) => upd({ dept: e.target.value })} list="depts" /><datalist id="depts">{[...new Set([...users.map((u) => u.dept), ...(org?.depts.map((d) => d.name) ?? [])])].map((d) => <option key={d} value={d} />)}</datalist></Field>
              <Field label="담당자"><Select value={node.assignee ?? ''} onChange={(e) => { const u = users.find((x) => x.name === e.target.value); upd({ assignee: e.target.value, dept: u?.dept ?? node.dept }); }}><option value="">(자동 배정)</option>{users.map((u) => <option key={u.id}>{u.name}</option>)}</Select></Field>
              <Field label="우선순위"><Select value={node.priority ?? '보통'} onChange={(e) => upd({ priority: e.target.value })}><option>긴급</option><option>높음</option><option>보통</option></Select></Field>
              <Field label="완료기한 (HH:mm)"><Input value={node.due ?? ''} onChange={(e) => upd({ due: e.target.value })} placeholder="09:15" /></Field>
            </div>
            {(node.code || node.lead || node.support?.length || node.partner?.length) ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 8px' }}>
                <Field label="ⓢ 지원부서 (쉼표)"><Input value={(node.support ?? []).join(', ')} onChange={(e) => upd({ support: e.target.value.split(/\s*,\s*/).filter(Boolean) })} /></Field>
                <Field label="ⓒ 협업기관 (쉼표)"><Input value={(node.partner ?? []).join(', ')} onChange={(e) => upd({ partner: e.target.value.split(/\s*,\s*/).filter(Boolean) })} /></Field>
              </div>
            ) : null}
            <Field label="전파 채널"><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{['문자', '알림톡', '내부알림', '이메일'].map((c) => { const on = node.channels?.includes(c); return <Btn key={c} small kind={on ? 'primary' : 'default'} onClick={() => upd({ channels: on ? node.channels!.filter((x) => x !== c) : [...(node.channels ?? []), c] })}>{c}{on ? ' ✓' : ''}</Btn>; })}</div></Field>
            <Field label="세부 임무 / 지시사항 (줄마다 하나)"><Textarea value={(node.tasks ?? []).join('\n')} onChange={(e) => upd({ tasks: e.target.value.split('\n').filter((x) => x.trim()) })} style={{ minHeight: 90 }} /></Field>
            <Field label="상황일지 기록 규칙"><div style={{ fontSize: 12 }}>{LOG_RULES.map((r) => <label key={r} style={{ display: 'flex', gap: 6, marginBottom: 3 }}><input type="checkbox" checked={(node.logRules ?? LOG_RULES).includes(r)} onChange={(e) => { const cur = node.logRules ?? LOG_RULES; upd({ logRules: e.target.checked ? [...cur, r] : cur.filter((x) => x !== r) }); }} />{r}</label>)}</div></Field>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}><Btn small onClick={() => setLinkFrom(linkFrom === node.id ? null : node.id)} kind={linkFrom === node.id ? 'warn' : 'default'}>{linkFrom === node.id ? '연결 취소' : '→ 다른 노드로 연결'}</Btn></div>
            <Card title={<span>AI로 임무 보완 <Chip tone="purple">유니</Chip></span>} pad={10} style={{ background: '#f4f5f6' }}>
              <div style={{ display: 'flex', gap: 4 }}><Input value={aiQ} onChange={(e) => setAiQ(e.target.value)} placeholder="예: 세부 임무를 3개 더" onKeyDown={(e) => { if (e.key === 'Enter') askAi(); }} /><Btn small kind="primary" onClick={askAi} disabled={!aiQ.trim() || aiA?.streaming}>질의</Btn></div>
              {aiA && <div style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, maxHeight: 180, overflow: 'auto' }}>{aiA.text || '…'}{aiA.sources.length > 0 && <div style={{ marginTop: 6, color: C.muted, fontSize: 11 }}>근거: {aiA.sources.slice(0, 3).map((s) => s.filename).join(' · ')}</div>}</div>}
              {aiA && !aiA.streaming && <Btn small style={{ marginTop: 6 }} onClick={applyAi}>선택 노드에 반영</Btn>}
            </Card>
          </>
        )}
        {!node && allSources.length > 0 && (
          <Card title="생성 근거" pad={10} style={{ marginTop: 10, background: '#f4f5f6' }}>
            {allSources.slice(0, 4).map((s, i) => { const x = s as { filename: string; score: number; text: string }; return <div key={i} style={{ fontSize: 12, marginBottom: 8 }}><b>{x.filename}</b>{x.score ? <Chip tone="blue" style={{ marginLeft: 4 }}>{Math.round(x.score * 100)}%</Chip> : null}<div style={{ color: C.muted, marginTop: 2, fontSize: 11 }}>{x.text.slice(0, 120)}</div></div>; })}
            {allSources.length > 4 && <Btn small onClick={() => setShowSources(true)}>전체 {allSources.length}건</Btn>}
          </Card>
        )}
        {!node && graph && graph.nodes.some((n) => n.code) && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: C.muted, lineHeight: 1.6 }}>녹색 코드 배지가 있는 임무는 매뉴얼 조치카드에서 왔습니다. 선택하면 주관·지원·협업과 원문을 볼 수 있고, [스윔레인]은 협업기능별로 임무를 세로 띠로 나눠 보여줍니다.</div>
        )}
      </div>
      {showSources && <Modal title="생성 근거 (SOP 생성 + 사전 질의 인용)" onClose={() => setShowSources(false)} width={680}>{allSources.map((s, i) => { const x = s as { filename: string; score: number; text: string }; return <div key={i} style={{ padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8, fontSize: 12 }}><b>{x.filename}</b> {x.score ? <Chip tone="blue">{Math.round(x.score * 100)}%</Chip> : null}<div style={{ color: C.muted, marginTop: 4, whiteSpace: 'pre-wrap' }}>{x.text}</div></div>; })}</Modal>}
      {srcOpen && node?.sourceRef && <Modal title={`${node.code} 원문 발췌 — ${node.sourceRef.doc}`} onClose={() => setSrcOpen(false)} width={720}><div style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>유사도 {Math.round(node.sourceRef.score * 100)}%</div><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6, background: '#f4f5f6', padding: 12, borderRadius: 8, maxHeight: 420, overflow: 'auto', fontFamily: 'inherit' }}>{node.sourceRef.excerpt}</pre></Modal>}
      {cardsOpen && <CardPicker hazard={ex.hazardType} coopName={laneName} onPick={(c) => addFromCard(c)} onClose={() => setCardsOpen(false)} />}
      <Toast msg={toast} />
    </div>
  );
}

/** 매뉴얼 조치카드 고르기 — 재난유형의 모든 매뉴얼에서 검색, [추가]하면 선택 노드 아래에 들어간다 */
function CardPicker({ hazard, coopName, onPick, onClose }: { hazard: string; coopName: (c: string) => string; onPick: (c: ActionCard) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(true);
  const [cards, setCards] = useState<ActionCard[] | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  useEffect(() => { get<ActionCard[]>(`/action-cards?${all ? '' : `hazard=${encodeURIComponent(hazard)}&`}q=${encodeURIComponent(q)}`).then(setCards).catch(() => setCards([])); }, [q, all, hazard]);
  return (
    <Modal title="매뉴얼 조치카드에서 임무 추가" onClose={onClose} width={820}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="코드·조치·부서 검색 (예: 대피, ①-3, 소방서)" style={{ flex: 1 }} />
        <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={!all} onChange={(e) => setAll(!e.target.checked)} />{hazard} 매뉴얼만</label>
      </div>
      <div style={{ maxHeight: 440, overflow: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
        {cards === null ? <div style={{ padding: 16, color: C.muted }}>불러오는 중…</div> : !cards.length ? <div style={{ padding: 16, color: C.muted, fontSize: 12.5 }}>카드가 없습니다. [매뉴얼·SOP 템플릿]에서 매뉴얼을 등록하고 추출하세요.</div> : cards.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, background: added.includes(c.id) ? '#eef7f0' : '#fff' }}>
            <span style={{ fontWeight: 800, color: '#1a6b2c', width: 58, flexShrink: 0 }}>{c.code}</span>
            <span style={{ width: 70, flexShrink: 0, color: C.muted, fontSize: 11 }}>{c.stage ?? '단계 미상'}</span>
            <span style={{ flex: 1, minWidth: 0 }}><b>{c.content || c.title}</b><div style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.coop} {coopName(c.coop)} · {c.lead || '-'}{c.support.length ? ` · ⓢ ${c.support.join(', ')}` : ''}{c.partner.length ? ` · ⓒ ${c.partner.join(', ')}` : ''}{c.manualName ? ` · ${c.manualName}` : ''}</div></span>
            <Btn small kind={added.includes(c.id) ? 'default' : 'primary'} onClick={() => { onPick(c); setAdded((a) => [...a, c.id]); }}>{added.includes(c.id) ? '추가됨 · 다시' : '추가'}</Btn>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}><Btn onClick={onClose}>닫기</Btn></div>
    </Modal>
  );
}
