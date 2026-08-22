import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, put, sse, type Exercise, type Sop, type SopGraph, type SopNode, type NodeType, type User } from '../api';
import { Btn, C, Card, Chip, Field, Input, Modal, Select, Table, Textarea, Toast, useToast } from '../ui';

/** 유니 /chat/json 진행 프레임(`__status__`) 라벨 — 실측 순서: searching → reranking → generating */
const STAGE_LABEL: Record<string, string> = { requesting: '유니에 요청', searching: '근거 문서 검색', reranking: '근거 재정렬', generating: 'SOP 절차 생성', end: '마무리' }; // end: 유니가 마지막에 보내는 프레임(실측 2026-08-22)
const STAGES = ['requesting', 'searching', 'reranking', 'generating'];
function SopProgress({ stage, elapsed }: { stage: string | null; elapsed: number }) {
  const idx = stage === 'end' ? STAGES.length : Math.max(0, STAGES.indexOf(stage ?? 'requesting'));
  return (
    <div style={{ padding: '60px 24px', textAlign: 'center', color: C.muted }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>유니 SOP API(/chat/json)로 절차를 생성하고 있습니다 · {elapsed}초</div>
      <div style={{ fontSize: 12, marginTop: 6 }}>훈련상황 + 챗봇 대화 요약 + 인용 근거를 전달 · 보통 60~80초 걸립니다</div>
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

/** 세로 흐름 레이아웃: BFS 깊이 = 행, 같은 행에 여럿이면 가로 분산 (판단 분기) */
function layout(g: SopGraph): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const start = g.nodes.find((n) => n.type === 'START') ?? g.nodes[0]; if (!start) return pos;
  const depth = new Map<string, number>([[start.id, 0]]); const q = [start.id];
  while (q.length) { const id = q.shift()!; for (const e of g.edges.filter((e) => e.from === id)) if (!depth.has(e.to)) { depth.set(e.to, depth.get(id)! + 1); q.push(e.to); } }
  for (const n of g.nodes) if (!depth.has(n.id)) depth.set(n.id, Math.max(...depth.values(), 0) + 1);
  const rows = new Map<number, string[]>(); for (const [id, d] of depth) rows.set(d, [...(rows.get(d) ?? []), id]);
  const W = 640;
  for (const [d, ids] of rows) ids.forEach((id, i) => pos.set(id, { x: W / 2 + (i - (ids.length - 1) / 2) * GAP_X, y: 50 + d * GAP_Y }));
  return pos;
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
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  // B 호버 카드 · E 순서도/표 보기 (2026-08-23)
  const [hover, setHover] = useState<string | null>(null);
  // ?view=table / ?node=<id> 로 보기·선택을 링크로 열 수 있다(전파·상황판에서 특정 임무로 바로 오기, 캡처용)
  const [view, setView] = useState<'flow' | 'table'>(() => ((sp.get('view') ?? localStorage.getItem('poc.sop.view')) === 'table' ? 'table' : 'flow'));
  const switchView = (v: 'flow' | 'table') => { setView(v); localStorage.setItem('poc.sop.view', v); };
  const [aiQ, setAiQ] = useState('');
  const [aiA, setAiA] = useState<{ text: string; sources: { filename: string; score: number; text: string }[]; streaming: boolean } | null>(null);
  const [toast, show] = useToast();
  const load = async () => { const e = await get<Exercise>(`/exercises/${id}`); setEx(e); if (e.sop) { setGraph(e.sop.graph); setVersion(e.sop.version); } return e; };
  useEffect(() => { get<User[]>('/users').then(setUsers); void load().then((e) => { if (sp.get('generate') === '1' && !e.sop) { void generate(); setSp({}); } }); }, [id]);
  // 유니 SOP는 60~80초 걸린다 — 진행 단계(`__status__`)와 경과 시간을 흘려 체감을 낫게 한다
  const [stage, setStage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (!busy) return; const t0 = Date.now(); setElapsed(0); const t = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000); return () => clearInterval(t); }, [busy]);
  const generate = () => new Promise<void>((resolve) => {
    setBusy(true); setStage('requesting');
    const finish = () => { setBusy(false); setStage(null); resolve(); };
    sse(`/exercises/${id}/sop/generate/stream`, {
      status: (d) => setStage((d as { status: string }).status),
      done: (d) => { const s = d as Sop; setGraph(s.graph); setVersion(s.version); show(`SOP 초안 v0.${s.version} 생성 (${s.graph.nodes.length}노드, ${s.graph.mapperVersion})`); if (s.graph.warnings.length) console.info('SOP warnings', s.graph.warnings); void load(); finish(); },
      error: (d) => { show((d as { error?: string; message?: string }).error ?? (d as { message?: string }).message ?? '생성 실패'); finish(); },
    });
  });
  const save = async () => { if (!graph) return; const s = await put<Sop>(`/exercises/${id}/sop`, { ...graph, mapperVersion: 'manual' }); setVersion(s.version); show(`SOP v0.${s.version} 저장`); await load(); };
  const start = async () => { await save(); const tasks = await post<unknown[]>(`/exercises/${id}/start`, {}); show(`임무 ${tasks.length}건 생성 — 훈련 실행`); nav(`/sit/${id}/dispatch`); };
  const pos = useMemo(() => (graph ? layout(graph) : new Map<string, { x: number; y: number }>()), [graph]);
  const order = useMemo(() => (graph ? orderOf(graph, pos) : []), [graph, pos]);
  const svgW = Math.max(900, ...[...pos.values()].map((p) => p.x + NODE_W / 2 + 40));
  const svgH = Math.max(...[...pos.values()].map((p) => p.y), 100) + 120;
  const hoverId = hover ?? sel; // 선택된 노드는 카드를 고정 표시
  const hoverNode = graph?.nodes.find((n) => n.id === hoverId) ?? null;
  const hoverPos = hoverId ? pos.get(hoverId) ?? null : null;
  const node = graph?.nodes.find((n) => n.id === sel) ?? null;
  const upd = (patch: Partial<SopNode>) => { if (!graph || !sel) return; setGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === sel ? { ...n, ...patch } : n)) }); };
  const addNode = (type: NodeType) => {
    if (!graph) return; const nid = `n${Date.now().toString(36)}`; const t = T(type);
    const newNode: SopNode = { id: nid, type, title: t.label, tasks: [] };
    const edges = [...graph.edges];
    if (sel) { const out = edges.filter((e) => e.from === sel); if (out.length === 1 && type !== 'END') { edges.push({ from: nid, to: out[0].to }); edges.splice(edges.indexOf(out[0]), 1); } edges.push({ from: sel, to: nid }); }
    setGraph({ ...graph, nodes: [...graph.nodes, newNode], edges }); setSel(nid);
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
    const q = `SOP 노드 "${node.title}"(유형 ${T(node.type).label}, 현재 세부 임무: ${(node.tasks ?? []).join('; ') || '없음'})에 대해: ${aiQ}. 세부 임무는 "- " 목록으로 답하라.`;
    setAiA({ text: '', sources: [], streaming: true });
    const es = new EventSource(`/api/exercises/${id}/chat/stream?q=${encodeURIComponent(q)}`);
    es.addEventListener('token', (e) => setAiA((a) => a && { ...a, text: a.text + (JSON.parse((e as MessageEvent).data) as { text: string }).text }));
    es.addEventListener('sources', (e) => setAiA((a) => a && { ...a, sources: (JSON.parse((e as MessageEvent).data) as { sources: typeof a.sources }).sources }));
    const fin = () => { setAiA((a) => a && { ...a, streaming: false }); es.close(); }; es.addEventListener('done', fin); es.onerror = fin;
  };
  const applyAi = () => { if (!aiA || !node) return; const items = aiA.text.split('\n').map((l) => l.match(/^\s*[-•·*]\s*(.+)$/)?.[1]?.trim()).filter(Boolean) as string[]; if (!items.length) return show('반영할 목록 항목이 없습니다'); upd({ tasks: [...(node.tasks ?? []), ...items] }); show(`${items.length}건 반영`); };
  if (!ex) return <div style={{ padding: 24 }}>불러오는 중…</div>;
  const allSources = graph?.sources ?? [];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr 340px', height: '100%', gap: 0 }}>
      {/* 팔레트 */}
      <div style={{ padding: 14, background: '#fff', borderRight: `1px solid ${C.border}`, overflow: 'auto' }}>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>컴포넌트</div>
        {TYPES.map((t) => <div key={t.type} onClick={() => addNode(t.type)} style={{ padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, fontSize: 12.5, cursor: 'pointer', background: t.bg, color: t.fg, fontWeight: 600 }} title={sel ? '선택 노드 아래에 추가' : '끝에 추가'}>{t.icon} {t.label}</div>)}
        <div style={{ fontSize: 11, color: C.muted, marginTop: 8, lineHeight: 1.6 }}>노드를 선택한 뒤 클릭하면 그 아래에 이어집니다. 노드 클릭 → 우측에서 속성 편집.</div>
        {graph?.warnings?.length ? <details style={{ marginTop: 10, fontSize: 11, color: C.muted }}><summary>매퍼 경고 {graph.warnings.length}</summary>{graph.warnings.map((w, i) => <div key={i}>· {w}</div>)}</details> : null}
      </div>
      {/* 캔버스 */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fff', borderBottom: `1px solid ${C.border}` }}>
          <b style={{ fontSize: 15 }}>SOP 생성/편집</b>
          {graph && <Chip tone="purple">{graph.mapperVersion === 'uni-sop-2' ? 'AI 초안' : graph.mapperVersion === 'manual' ? '편집본' : '기본 SOP'} · v0.{version}</Chip>}
          {linkFrom && <Chip tone="orange">연결 대상 노드를 클릭 (다시 클릭하면 취소)</Chip>}
          <div style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden', marginLeft: 4 }} role="tablist" aria-label="보기 방식">
            {(['flow', 'table'] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => switchView(v)} style={{ border: 0, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: view === v ? C.blue : '#fff', color: view === v ? '#fff' : C.muted }}>{v === 'flow' ? '순서도' : '표'}</button>)}
          </div>
          <div style={{ flex: 1 }} />
          <Btn small onClick={() => void generate()} disabled={busy}>{busy ? `${STAGE_LABEL[stage ?? ''] ?? '생성 중'}… ${elapsed}초` : graph ? 'AI로 재생성' : 'AI SOP 생성'}</Btn>
          {allSources.length > 0 && <Btn small onClick={() => setShowSources(true)}>AI 생성 근거 {allSources.length}</Btn>}
          <Btn small disabled={!graph} onClick={() => void save()}>버전 저장</Btn>
          <Btn small kind="primary" disabled={!graph || ex.status === 'CLOSED'} onClick={() => void start()}>훈련 실행으로 이동 →</Btn>
        </div>
        <div style={{ flex: 1, overflow: 'auto', position: 'relative', background: view === 'flow' ? 'radial-gradient(#cdd1d5 1px, transparent 1px) 0 0/22px 22px, #f4f5f6' : '#f4f5f6' }}>
          {busy && !graph && <SopProgress stage={stage} elapsed={elapsed} />}
          {!busy && !graph && <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>[AI SOP 생성]을 누르세요.</div>}
          {graph && view === 'table' && (
            <div style={{ padding: 16 }}>
              <Table small caption="SOP 임무 표" head={['순번', '유형', '임무명', '담당부서', '담당자', '우선순위', '기한', '채널', '세부 임무', '다음', '기록 규칙']} rows={order.map((id, i) => {
                const n = graph.nodes.find((x) => x.id === id)!; const t = T(n.type); const nexts = graph.edges.filter((e) => e.from === id).map((e) => { const to = graph.nodes.find((x) => x.id === e.to); return `${e.label ? e.label + ' → ' : ''}${to?.title ?? e.to}`; });
                const isSel = sel === id;
                return [
                  <span style={{ fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</span>,
                  <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, background: t.bg, color: t.fg, border: `1px solid ${C.border}`, fontSize: 11, whiteSpace: 'nowrap' }}>{t.icon} {t.label}</span>,
                  <button type="button" onClick={() => setSel(isSel ? null : id)} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: isSel ? C.blue : C.text, cursor: 'pointer', textAlign: 'left', minWidth: 220, display: 'block' }}>{n.title}</button>,
                  n.dept ?? '-', n.assignee ?? <span style={{ color: C.muted }}>(자동)</span>, n.priority ?? '보통', n.due ?? '-', (n.channels ?? []).join('·') || '-',
                  (n.tasks ?? []).length ? <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>{n.tasks!.map((x, j) => <li key={j}>{x}</li>)}</ul> : <span style={{ color: C.muted }}>-</span>,
                  nexts.length ? <div style={{ fontSize: 12, lineHeight: 1.6, minWidth: 120 }}>{nexts.map((x, j) => <div key={j}>{x}</div>)}</div> : <span style={{ color: C.muted }}>(종료)</span>,
                  <span style={{ fontSize: 11, color: C.muted, display: 'block', minWidth: 150 }}>{(n.logRules ?? LOG_RULES).map((r) => r.replace(' 자동 기록', '')).join(' · ')}</span>,
                ];
              })} />
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>임무명을 누르면 우측에서 편집할 수 있습니다. 순번은 흐름도의 위→아래, 왼→오른쪽 순서입니다.</div>
            </div>
          )}
          {graph && view === 'flow' && (
            <svg width={svgW} height={svgH} style={{ display: 'block' }}>
              <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#464c53" /></marker></defs>
              {graph.edges.map((e, i) => { const a = pos.get(e.from); const b = pos.get(e.to); if (!a || !b) return null; const na = graph.nodes.find((x) => x.id === e.from); const nb = graph.nodes.find((x) => x.id === e.to); const y1 = a.y + nodeH(na?.type ?? 'TASK') / 2; const y2 = b.y - nodeH(nb?.type ?? 'TASK') / 2; const mid = (y1 + y2) / 2; return (
                <g key={i}><path d={`M${a.x},${y1} C${a.x},${mid} ${b.x},${mid} ${b.x},${y2}`} stroke="#8a949e" strokeWidth={1.6} fill="none" markerEnd="url(#arr)" />
                  {e.label && <text x={(a.x + b.x) / 2 + (b.x > a.x ? 14 : b.x < a.x ? -14 : 12)} y={mid} fontSize={11} fontWeight={800} fill={e.label === 'YES' ? '#228738' : '#d0290e'} textAnchor="middle">{e.label}</text>}</g>); })}
              {graph.nodes.map((n) => { const p = pos.get(n.id); if (!p) return null; const t = T(n.type); const isSel = sel === n.id; const pill = n.type === 'START' || n.type === 'END'; const h = nodeH(n.type); const lines = pill ? [n.title.length > 28 ? n.title.slice(0, 27) + '…' : n.title] : wrapText(n.title, 18);
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
                    {lines.map((l, li) => <text key={li} x={-NODE_W / 2 + 12} y={-h / 2 + (n.type === 'DECISION' ? 30 : 22) + li * 17} fontSize={13} fontWeight={700} fill={t.fg}>{li === 0 && n.type !== 'DECISION' ? `${t.icon} ` : ''}{l}</text>)}
                    <text x={-NODE_W / 2 + 12} y={h / 2 - 9} fontSize={11} fill="#464c53">{(n.dept ?? '담당 미지정') + (n.assignee ? ` · ${n.assignee}` : '')}</text>
                    {badges.slice(0, 3).map((b, bi) => { const bw = b.text.length * 7 + 12; const x = NODE_W / 2 - 10 - badges.slice(0, bi + 1).reduce((acc, bb) => acc + bb.text.length * 7 + 12 + 4, 0) + 4; return <g key={bi}><rect x={x} y={h / 2 - 22} width={bw} height={16} rx={8} fill={b.bg} /><text x={x + bw / 2} y={h / 2 - 10} textAnchor="middle" fontSize={10} fontWeight={700} fill={b.fg}>{b.text}</text></g>; })}
                  </>}
                </g>); })}
            </svg>
          )}
          {graph && view === 'flow' && hoverNode && hoverPos && (
            <div style={{ position: 'absolute', left: hoverPos.x + NODE_W / 2 + 12 + 300 > svgW ? hoverPos.x - NODE_W / 2 - 12 - 300 : hoverPos.x + NODE_W / 2 + 12, top: Math.max(8, hoverPos.y - 40), width: 300, background: '#fff', border: `1px solid ${sel === hoverNode.id ? C.blue : C.border}`, borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.14)', padding: '10px 12px', fontSize: 12.5, lineHeight: 1.6, pointerEvents: 'none', zIndex: 5 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 4 }}>{T(hoverNode.type).icon} {hoverNode.title}</div>
              <div style={{ color: C.muted }}>{T(hoverNode.type).label} · {hoverNode.dept ?? '담당 미지정'}{hoverNode.assignee ? ` · ${hoverNode.assignee}` : ''}</div>
              <div style={{ color: C.muted }}>우선순위 {hoverNode.priority ?? '보통'}{hoverNode.due ? ` · 기한 ${hoverNode.due}` : ''}{hoverNode.channels?.length ? ` · ${hoverNode.channels.join('·')}` : ''}</div>
              {hoverNode.tasks?.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>{hoverNode.tasks.map((x, j) => <li key={j}>{x}</li>)}</ul> : <div style={{ color: C.muted, marginTop: 4 }}>세부 임무 없음</div>}
              <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>기록: {(hoverNode.logRules ?? LOG_RULES).map((r) => r.replace(' 자동 기록', '')).join(' · ')}{sel === hoverNode.id ? ' · 선택됨(우측에서 편집)' : ''}</div>
            </div>
          )}
        </div>
      </div>
      {/* 속성 패널 */}
      <div style={{ padding: 14, background: '#fff', borderLeft: `1px solid ${C.border}`, overflow: 'auto' }}>
        {!node ? <div style={{ color: C.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>캔버스에서 노드를 선택하면 속성을 편집할 수 있습니다.</div> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><b style={{ fontSize: 14 }}>{T(node.type).icon} {T(node.type).label}</b> <span style={{ fontSize: 11, color: C.muted }}>속성 편집</span><div style={{ flex: 1 }} /><Btn small kind="danger" onClick={removeNode} disabled={node.type === 'START'}>삭제</Btn></div>
            <Field label="임무명"><Input value={node.title} onChange={(e) => upd({ title: e.target.value })} /></Field>
            <Field label="유형"><Select value={node.type} onChange={(e) => upd({ type: e.target.value as NodeType })}>{TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</Select></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 8px' }}>
              <Field label="담당부서"><Input value={node.dept ?? ''} onChange={(e) => upd({ dept: e.target.value })} list="depts" /><datalist id="depts">{[...new Set(users.map((u) => u.dept))].map((d) => <option key={d} value={d} />)}</datalist></Field>
              <Field label="담당자"><Select value={node.assignee ?? ''} onChange={(e) => { const u = users.find((x) => x.name === e.target.value); upd({ assignee: e.target.value, dept: u?.dept ?? node.dept }); }}><option value="">(자동 배정)</option>{users.map((u) => <option key={u.id}>{u.name}</option>)}</Select></Field>
              <Field label="우선순위"><Select value={node.priority ?? '보통'} onChange={(e) => upd({ priority: e.target.value })}><option>긴급</option><option>높음</option><option>보통</option></Select></Field>
              <Field label="완료기한 (HH:mm)"><Input value={node.due ?? ''} onChange={(e) => upd({ due: e.target.value })} placeholder="09:15" /></Field>
            </div>
            <Field label="전파 채널"><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{['문자', '알림톡', '내부알림', '이메일'].map((c) => { const on = node.channels?.includes(c); return <Btn key={c} small kind={on ? 'primary' : 'default'} onClick={() => upd({ channels: on ? node.channels!.filter((x) => x !== c) : [...(node.channels ?? []), c] })}>{c}{on ? ' ✓' : ''}</Btn>; })}</div></Field>
            <Field label="세부 임무 / 지시사항 (줄마다 하나)"><Textarea value={(node.tasks ?? []).join('\n')} onChange={(e) => upd({ tasks: e.target.value.split('\n').filter((x) => x.trim()) })} style={{ minHeight: 90 }} /></Field>
            <Field label="상황일지 기록 규칙"><div style={{ fontSize: 12 }}>{['전파 시 자동 기록', '수신 확인 시 자동 기록', '완료 보고 시 자동 기록', '지연 발생 시 자동 기록'].map((r) => <label key={r} style={{ display: 'flex', gap: 6, marginBottom: 3 }}><input type="checkbox" checked={(node.logRules ?? ['전파 시 자동 기록', '수신 확인 시 자동 기록', '완료 보고 시 자동 기록', '지연 발생 시 자동 기록']).includes(r)} onChange={(e) => { const cur = node.logRules ?? ['전파 시 자동 기록', '수신 확인 시 자동 기록', '완료 보고 시 자동 기록', '지연 발생 시 자동 기록']; upd({ logRules: e.target.checked ? [...cur, r] : cur.filter((x) => x !== r) }); }} />{r}</label>)}</div></Field>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}><Btn small onClick={() => setLinkFrom(linkFrom === node.id ? null : node.id)} kind={linkFrom === node.id ? 'warn' : 'default'}>{linkFrom === node.id ? '연결 취소' : '→ 다른 노드로 연결'}</Btn></div>
            <Card title={<span>AI로 임무 보완 <Chip tone="purple">유니</Chip></span>} pad={10} style={{ background: '#f4f5f6' }}>
              <div style={{ display: 'flex', gap: 4 }}><Input value={aiQ} onChange={(e) => setAiQ(e.target.value)} placeholder="예: 세부 임무를 3개 더" onKeyDown={(e) => { if (e.key === 'Enter') askAi(); }} /><Btn small kind="primary" onClick={askAi} disabled={!aiQ.trim() || aiA?.streaming}>질의</Btn></div>
              {aiA && <div style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, maxHeight: 180, overflow: 'auto' }}>{aiA.text || '…'}{aiA.sources.length > 0 && <div style={{ marginTop: 6, color: C.muted, fontSize: 11 }}>근거: {aiA.sources.slice(0, 3).map((s) => s.filename).join(' · ')}</div>}</div>}
              {aiA && !aiA.streaming && <Btn small style={{ marginTop: 6 }} onClick={applyAi}>선택 노드에 반영</Btn>}
            </Card>
          </>
        )}
        {!node && allSources.length > 0 && (
          <Card title="AI 생성 근거" pad={10} style={{ marginTop: 10, background: '#f4f5f6' }}>
            {allSources.slice(0, 4).map((s, i) => { const x = s as { filename: string; score: number; text: string }; return <div key={i} style={{ fontSize: 12, marginBottom: 8 }}><b>{x.filename}</b>{x.score ? <Chip tone="blue" style={{ marginLeft: 4 }}>{Math.round(x.score * 100)}%</Chip> : null}<div style={{ color: C.muted, marginTop: 2, fontSize: 11 }}>{x.text.slice(0, 120)}</div></div>; })}
            {allSources.length > 4 && <Btn small onClick={() => setShowSources(true)}>전체 {allSources.length}건</Btn>}
          </Card>
        )}
      </div>
      {showSources && <Modal title="AI 생성 근거 (SOP 생성 + 사전 질의 인용)" onClose={() => setShowSources(false)} width={680}>{allSources.map((s, i) => { const x = s as { filename: string; score: number; text: string }; return <div key={i} style={{ padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8, fontSize: 12 }}><b>{x.filename}</b> {x.score ? <Chip tone="blue">{Math.round(x.score * 100)}%</Chip> : null}<div style={{ color: C.muted, marginTop: 4, whiteSpace: 'pre-wrap' }}>{x.text}</div></div>; })}</Modal>}
      <Toast msg={toast} />
    </div>
  );
}
