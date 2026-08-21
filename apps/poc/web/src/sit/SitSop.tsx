import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post, put, type Exercise, type Sop, type SopGraph, type SopNode, type NodeType, type User } from '../api';
import { Btn, C, Card, Chip, Field, Input, Modal, Select, Textarea, Toast, useToast } from '../ui';

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

/** 세로 흐름 레이아웃: BFS 깊이 = 행, 같은 행에 여럿이면 가로 분산 (판단 분기) */
function layout(g: SopGraph): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const start = g.nodes.find((n) => n.type === 'START') ?? g.nodes[0]; if (!start) return pos;
  const depth = new Map<string, number>([[start.id, 0]]); const q = [start.id];
  while (q.length) { const id = q.shift()!; for (const e of g.edges.filter((e) => e.from === id)) if (!depth.has(e.to)) { depth.set(e.to, depth.get(id)! + 1); q.push(e.to); } }
  for (const n of g.nodes) if (!depth.has(n.id)) depth.set(n.id, Math.max(...depth.values(), 0) + 1);
  const rows = new Map<number, string[]>(); for (const [id, d] of depth) rows.set(d, [...(rows.get(d) ?? []), id]);
  const W = 640;
  for (const [d, ids] of rows) ids.forEach((id, i) => pos.set(id, { x: W / 2 + (i - (ids.length - 1) / 2) * 260, y: 40 + d * 96 }));
  return pos;
}

export function SitSop() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const [ex, setEx] = useState<Exercise | null>(null);
  const [graph, setGraph] = useState<SopGraph | null>(null);
  const [version, setVersion] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [aiQ, setAiQ] = useState('');
  const [aiA, setAiA] = useState<{ text: string; sources: { filename: string; score: number; text: string }[]; streaming: boolean } | null>(null);
  const [toast, show] = useToast();
  const load = async () => { const e = await get<Exercise>(`/exercises/${id}`); setEx(e); if (e.sop) { setGraph(e.sop.graph); setVersion(e.sop.version); } return e; };
  useEffect(() => { get<User[]>('/users').then(setUsers); void load().then((e) => { if (sp.get('generate') === '1' && !e.sop) { void generate(); setSp({}); } }); }, [id]);
  const generate = async () => {
    setBusy(true);
    try { const s = await post<Sop>(`/exercises/${id}/sop/generate`, {}); setGraph(s.graph); setVersion(s.version); show(`SOP 초안 v0.${s.version} 생성 (${s.graph.nodes.length}노드, ${s.graph.mapperVersion})`); if (s.graph.warnings.length) console.info('SOP warnings', s.graph.warnings); await load(); }
    catch (e) { show((e as Error).message); } finally { setBusy(false); }
  };
  const save = async () => { if (!graph) return; const s = await put<Sop>(`/exercises/${id}/sop`, { ...graph, mapperVersion: 'manual' }); setVersion(s.version); show(`SOP v0.${s.version} 저장`); await load(); };
  const start = async () => { await save(); const tasks = await post<unknown[]>(`/exercises/${id}/start`, {}); show(`임무 ${tasks.length}건 생성 — 훈련 실행`); nav(`/sit/${id}/dispatch`); };
  const pos = useMemo(() => (graph ? layout(graph) : new Map()), [graph]);
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
          <div style={{ flex: 1 }} />
          <Btn small onClick={() => void generate()} disabled={busy}>{busy ? '유니 생성 중…' : graph ? 'AI로 재생성' : 'AI SOP 생성'}</Btn>
          {allSources.length > 0 && <Btn small onClick={() => setShowSources(true)}>AI 생성 근거 {allSources.length}</Btn>}
          <Btn small disabled={!graph} onClick={() => void save()}>버전 저장</Btn>
          <Btn small kind="primary" disabled={!graph || ex.status === 'CLOSED'} onClick={() => void start()}>훈련 실행으로 이동 →</Btn>
        </div>
        <div style={{ flex: 1, overflow: 'auto', background: 'radial-gradient(#cdd1d5 1px, transparent 1px) 0 0/22px 22px, #f4f5f6' }}>
          {busy && !graph && <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>유니 SOP API(/chat/json)로 절차를 생성하고 있습니다… <div style={{ fontSize: 12, marginTop: 6 }}>훈련상황 + 챗봇 대화 요약 + 인용 근거를 전달</div></div>}
          {!busy && !graph && <div style={{ padding: 60, textAlign: 'center', color: C.muted }}>[AI SOP 생성]을 누르세요.</div>}
          {graph && (
            <svg width={1280} height={Math.max(...[...pos.values()].map((p) => p.y), 100) + 120} style={{ display: 'block' }}>
              <defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#464c53" /></marker></defs>
              {graph.edges.map((e, i) => { const a = pos.get(e.from); const b = pos.get(e.to); if (!a || !b) return null; const y1 = a.y + 22, y2 = b.y - 22; const mid = (y1 + y2) / 2; return (
                <g key={i}><path d={`M${a.x},${y1} C${a.x},${mid} ${b.x},${mid} ${b.x},${y2}`} stroke="#8a949e" strokeWidth={1.6} fill="none" markerEnd="url(#arr)" />
                  {e.label && <text x={(a.x + b.x) / 2 + (b.x > a.x ? 12 : b.x < a.x ? -12 : 10)} y={mid} fontSize={11} fontWeight={800} fill={e.label === 'YES' ? '#228738' : '#d0290e'} textAnchor="middle">{e.label}</text>}</g>); })}
              {graph.nodes.map((n) => { const p = pos.get(n.id); if (!p) return null; const t = T(n.type); const isSel = sel === n.id; const w = n.type === 'DECISION' ? 220 : 210; return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`} onClick={() => (linkFrom ? toggleLink(n.id) : setSel(isSel ? null : n.id))} style={{ cursor: 'pointer' }}>
                  {n.type === 'DECISION' ? <polygon points={`0,-26 ${w / 2},0 0,26 ${-w / 2},0`} fill={t.bg} stroke={isSel ? C.blue : '#9d5b00'} strokeWidth={isSel ? 3 : 1.5} /> : <rect x={-w / 2} y={-22} width={w} height={44} rx={n.type === 'START' || n.type === 'END' ? 22 : 8} fill={t.bg} stroke={isSel ? C.blue : linkFrom === n.id ? C.orange : '#cdd1d5'} strokeWidth={isSel || linkFrom === n.id ? 3 : 1.2} />}
                  <text y={4} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={t.fg}>{t.icon} {n.title.length > 20 ? n.title.slice(0, 20) + '…' : n.title}</text>
                  {n.dept && <text y={36} textAnchor="middle" fontSize={10} fill="#464c53">{n.dept}{n.assignee ? ` · ${n.assignee}` : ''}</text>}
                </g>); })}
            </svg>
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
