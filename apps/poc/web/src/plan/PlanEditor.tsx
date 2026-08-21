import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, put, sse, HAZARDS, type Plan, type PlanContext, type TocNode, type Template, type SecStatus, type Section } from '../api';
import { Btn, C, Card, Chip, Field, Input, Modal, Select, Textarea, Toast, renderMarkdown, statusTone, useToast, useUser } from '../ui';

type Step = 'context' | 'toc' | 'draft' | 'preview';
const emptyCtx = (): PlanContext => ({ subject: '', hazardType: '폭염', managementPhase: '대비', audience: '지자체', templateId: null, tone: '공문서체' });

export function PlanEditor() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [user] = useUser();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [step, setStep] = useState<Step>('context');
  const [toast, show] = useToast();
  const reload = useCallback(async () => { const p = await get<Plan>(`/plans/${id}`); setPlan(p); return p; }, [id]);
  useEffect(() => { void reload().then((p) => { if (p.toc.length) setStep(Object.keys(p.sections).length ? 'draft' : 'toc'); }); get<Template[]>('/templates').then(setTemplates); }, [id, reload]);
  if (!plan) return <div style={{ padding: 24 }}>불러오는 중…</div>;
  const tpl = templates.find((t) => t.id === plan.context?.templateId) ?? null;
  const total = plan.toc.reduce((a, n) => a + 1 + n.children.length, 0);
  const done = Object.values(plan.sections).filter((s) => s.status === '완료').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* 툴바 (SCR-CADM-401004 / 402001) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: '#fff', borderBottom: `1px solid ${C.border}` }}>
        <Link to="/plan" style={{ color: C.muted, fontSize: 12 }}>← 문서 관리</Link>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{plan.title}</div>
        {plan.context && <Chip tone="blue">{plan.context.hazardType} · {plan.context.managementPhase}</Chip>}
        {tpl && <Chip>템플릿: {tpl.name}</Chip>}
        <div style={{ flex: 1 }} />
        <nav style={{ display: 'flex', gap: 4 }}>
          {([['context', '1. 기준정보'], ['toc', '2. 목차'], ['draft', `3. 초안 (${done}/${total})`], ['preview', '4. 미리보기·내보내기']] as [Step, string][]).map(([k, label]) => (
            <Btn key={k} small kind={step === k ? 'dark' : 'default'} disabled={(k === 'toc' && !plan.context) || (k === 'draft' && !plan.toc.length) || (k === 'preview' && !done)} onClick={() => setStep(k)}>{label}</Btn>
          ))}
        </nav>
        <Btn small onClick={() => nav(`/plan/${id}/editor`)} disabled={!plan.export} title={plan.export ? '내보낸 HWPX를 rhwp 웹 에디터로 엽니다' : '먼저 HWPX로 내보내세요'}>rhwp 에디터에서 열기</Btn>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {step === 'context' && <ContextStep plan={plan} templates={templates} onSaved={async (goToc) => { await reload(); if (goToc) setStep('toc'); }} show={show} user={user?.name ?? ''} />}
        {step === 'toc' && <TocStep plan={plan} reload={reload} show={show} onDraft={() => setStep('draft')} />}
        {step === 'draft' && <DraftStep plan={plan} tpl={tpl} reload={reload} show={show} />}
        {step === 'preview' && <PreviewStep plan={plan} tpl={tpl} reload={reload} show={show} />}
      </div>
      <Toast msg={toast} />
    </div>
  );
}

// ── 1. 기준정보 (SCR-CADM-401001, 405002) ──────────────────────────────────
function ContextStep({ plan, templates, onSaved, show, user }: { plan: Plan; templates: Template[]; onSaved: (goToc: boolean) => Promise<void>; show: (m: string) => void; user: string }) {
  const [c, setC] = useState<PlanContext>(plan.context ?? emptyCtx());
  const [saving, setSaving] = useState(false);
  const [tplModal, setTplModal] = useState(false);
  const [tplName, setTplName] = useState('');
  const [loadModal, setLoadModal] = useState(false);
  const [saved, setSaved] = useState<{ id: string; name: string; context: PlanContext; createdBy: string }[]>([]);
  const set = (k: keyof PlanContext) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });
  const valid = c.subject.trim() && c.hazardType && c.managementPhase && c.audience;
  const tpl = templates.find((t) => t.id === c.templateId);
  useEffect(() => { if (tpl && !c.outlineNumbering) setC((x) => ({ ...x, outlineNumbering: tpl.levels.map((l) => l.bullet).filter(Boolean).join(' ') })); }, [tpl?.id]);
  const save = async (goToc: boolean) => {
    setSaving(true);
    try { await put(`/plans/${plan.id}/context`, { ...c, updatedBy: user }); show('저장되었습니다'); await onSaved(goToc); }
    finally { setSaving(false); }
  };
  const registerTpl = async () => { await post('/plan-templates', { name: tplName, context: c, createdBy: user }); setTplModal(false); show('저장되었습니다'); };
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' };
  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      {plan.toc.length > 0 && <div style={{ background: C.orangeBg, color: '#92400e', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 14 }}>이미 목차가 있습니다. 기준정보를 수정하고 다시 목차를 생성하면 기존 초안은 초기화됩니다.</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Btn small onClick={() => { setLoadModal(true); get<typeof saved>('/plan-templates').then(setSaved); }}>템플릿 불러오기</Btn>
        <Btn small disabled={!valid} onClick={() => setTplModal(true)}>템플릿 등록하기</Btn>
      </div>
      <Card title="HWPX 문서 템플릿 (스타일 분석 결과 적용)" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto' }}>
          {templates.map((t) => (
            <div key={t.id} onClick={() => setC({ ...c, templateId: t.id, outlineNumbering: t.levels.map((l) => l.bullet).filter(Boolean).join(' ') })} style={{ minWidth: 190, padding: 10, border: `2px solid ${c.templateId === t.id ? C.blue : C.border}`, borderRadius: 8, cursor: 'pointer', background: c.templateId === t.id ? C.blueLight : '#fff' }}>
              <b style={{ fontSize: 13 }}>{t.name}</b>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{t.levels.map((l) => `${l.bullet}${l.fontSizePt}`).join(' · ')}</div>
              <div style={{ fontSize: 11, color: C.muted }}>본문 {t.bodyFontFamily?.split(' ')[0] ?? '-'} {t.bodyFontSizePt}pt</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>선택한 템플릿의 개요 기호·글꼴·크기가 목차/초안 생성 규칙과 HWPX 내보내기에 적용됩니다. <Link to="/plan/templates">템플릿 관리 →</Link></div>
      </Card>
      <Card title="문서 주제" style={{ marginBottom: 16 }}>
        <Field label="문서 주제" required><Input value={c.subject} onChange={set('subject')} placeholder="예: 2026년 여름철 폭염 대비 재난안전계획" /></Field>
      </Card>
      <Card title="배경 정보" style={{ marginBottom: 16 }}>
        <div style={grid}>
          <Field label="재난유형" required><Select value={c.hazardType} onChange={set('hazardType')}>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</Select></Field>
          <Field label="재난관리단계" required><Select value={c.managementPhase} onChange={set('managementPhase')}><option>예방</option><option>대비</option></Select></Field>
          <Field label="장소"><Input value={c.place ?? ''} onChange={set('place')} placeholder="○○시" /></Field>
          <Field label="재난발생일시"><Input type="datetime-local" value={c.occurredAt ?? ''} onChange={set('occurredAt')} /></Field>
          <Field label="보고일시"><Input type="datetime-local" value={c.reportedAt ?? ''} onChange={set('reportedAt')} /></Field>
        </div>
      </Card>
      <Card title="내용지침" style={{ marginBottom: 16 }}>
        <Field label="출처"><Input value={c.sources ?? ''} onChange={set('sources')} placeholder="재난 및 안전관리 기본법, 폭염 위기관리 표준매뉴얼" /></Field>
        <Field label="필수 포함 요소" hint="쉼표로 구분"><Input value={c.requiredElements ?? ''} onChange={set('requiredElements')} placeholder="취약계층 보호, 무더위쉼터 운영, 비상연락망" /></Field>
        <Field label="작성 가이드"><Textarea value={c.writingGuide ?? ''} onChange={set('writingGuide')} placeholder="담당 부서와 기한을 표로 정리, 수치는 최근 3년 자료" /></Field>
      </Card>
      <Card title="표현 규칙" style={{ marginBottom: 16 }}>
        <div style={grid}>
          <Field label="문체"><Select value={c.tone ?? ''} onChange={set('tone')}><option value="">선택</option><option>공문서체</option><option>개조식</option><option>서술체</option></Select></Field>
          <Field label="문장길이 제한"><Input value={c.sentenceLimit ?? ''} onChange={set('sentenceLimit')} placeholder="60자 이내" /></Field>
          <Field label="문단 개요번호 모양" hint={tpl ? `템플릿 "${tpl.name}"에서 자동 채움` : '템플릿을 선택하면 자동으로 채워집니다'}><Input value={c.outlineNumbering ?? ''} onChange={set('outlineNumbering')} placeholder="□ ㅇ - *" /></Field>
          <Field label="본문 문장 시작"><Input value={c.bodyStart ?? ''} onChange={set('bodyStart')} placeholder="(소제목) 문장…" /></Field>
        </div>
      </Card>
      <Card title="문장 작성 목적" style={{ marginBottom: 16 }}>
        <div style={grid}>
          <Field label="업무 목적"><Input value={c.purpose ?? ''} onChange={set('purpose')} placeholder="폭염 피해 최소화" /></Field>
          <Field label="역할"><Input value={c.role ?? ''} onChange={set('role')} placeholder="안전총괄과" /></Field>
          <Field label="타깃 독자" required hint="T3Q 열거값: 중앙정부 / 지자체 / 내부보고 / 대민"><Select value={c.audience ?? ''} onChange={set('audience')}><option>중앙정부</option><option>지자체</option><option>내부보고</option><option>대민</option></Select></Field>
        </div>
      </Card>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Btn disabled={saving} onClick={() => void save(false)}>저장</Btn>
        <Btn kind="primary" disabled={!valid || saving} onClick={() => void save(true)}>저장하고 목차 생성으로 →</Btn>
      </div>
      {tplModal && <Modal title="기준정보 템플릿 등록" onClose={() => setTplModal(false)}><Input autoFocus maxLength={20} value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="템플릿 명 (최대 20자)" /><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><Btn onClick={() => setTplModal(false)}>취소</Btn><Btn kind="primary" disabled={!tplName.trim()} onClick={() => void registerTpl()}>등록하기</Btn></div></Modal>}
      {loadModal && <Modal title="기준정보 템플릿 불러오기" onClose={() => setLoadModal(false)}>{saved.length ? saved.map((s) => <div key={s.id} style={{ padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, cursor: 'pointer' }} onClick={() => { setC({ ...s.context }); setLoadModal(false); show('불러왔습니다'); }}><b>{s.name}</b> <span style={{ fontSize: 11, color: C.muted }}>{s.context.hazardType} · {s.context.managementPhase} · {s.createdBy}</span></div>) : <div style={{ color: C.muted, fontSize: 13 }}>저장된 템플릿이 없습니다.</div>}</Modal>}
    </div>
  );
}

// ── 2. 목차 (SCR-CADM-401002/003, 404005/006) ────────────────────────────
function TocStep({ plan, reload, show, onDraft }: { plan: Plan; reload: () => Promise<Plan>; show: (m: string) => void; onDraft: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toc, setToc] = useState<TocNode[]>(plan.toc);
  const [selected, setSelected] = useState<string | null>(null);
  const [addModal, setAddModal] = useState<{ parent: TocNode | null } | null>(null);
  const [addTitle, setAddTitle] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  useEffect(() => setToc(plan.toc), [plan.toc]);
  const generate = async () => {
    setBusy(true);
    try { const r = await post<Plan & { tocProvider?: string; tocError?: string }>(`/plans/${plan.id}/toc`, {}); setProvider(r.tocProvider ?? null); if (r.tocError) show(`T3Q 실패 → UNI 폴백: ${r.tocError.slice(0, 60)}`); else show('목차가 생성되었습니다'); await reload(); }
    finally { setBusy(false); }
  };
  const renumber = (list: TocNode[]): TocNode[] => list.map((n, i) => ({ ...n, no: String(i + 1), children: n.children.map((c, j) => ({ ...c, no: `${i + 1}.${j + 1}`, children: [] })) }));
  const persist = async (next: TocNode[]) => { const rn = renumber(next); setToc(rn); await put(`/plans/${plan.id}/toc`, rn); await reload(); };
  const move = (id: string, dir: -1 | 1) => {
    const next = structuredClone(toc);
    for (const n of next) { const j = n.children.findIndex((c) => c.id === id); if (j >= 0) { const k = j + dir; if (k < 0 || k >= n.children.length) return; [n.children[j], n.children[k]] = [n.children[k], n.children[j]]; return void persist(next); } }
    const i = next.findIndex((n) => n.id === id); const k = i + dir; if (i < 0 || k < 0 || k >= next.length) return; [next[i], next[k]] = [next[k], next[i]]; void persist(next);
  };
  const remove = (id: string) => { const next = toc.filter((n) => n.id !== id).map((n) => ({ ...n, children: n.children.filter((c) => c.id !== id) })); void persist(next); show('삭제되었습니다'); };
  const add = () => {
    const node: TocNode = { id: `t${Date.now().toString(36)}`, no: '', title: addTitle.trim(), children: [] };
    const next = addModal?.parent ? toc.map((n) => (n.id === addModal.parent!.id ? { ...n, children: [...n.children, node] } : n)) : [...toc, node];
    void persist(next); setAddModal(null); setAddTitle(''); show('목차가 추가되었습니다');
  };
  const rename = () => { if (!renaming) return; const next = toc.map((n) => (n.id === renaming.id ? { ...n, title: renaming.title } : { ...n, children: n.children.map((c) => (c.id === renaming.id ? { ...c, title: renaming.title } : c)) })); void persist(next); setRenaming(null); show('목차 명이 변경되었습니다'); };
  const row = (n: TocNode, depth: number) => {
    const sec = plan.sections[n.id]; const isSel = selected === n.id;
    return (
      <div key={n.id} onClick={() => editing && setSelected(isSel ? null : n.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', paddingLeft: 10 + depth * 24, borderRadius: 8, background: isSel ? C.blueLight : 'transparent', cursor: editing ? 'pointer' : 'default', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ color: C.muted, fontSize: 12, width: 36 }}>{n.no}</span>
        {renaming?.id === n.id ? <><Input autoFocus value={renaming.title} onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(null); }} style={{ width: 320 }} /><Btn small kind="primary" onClick={rename}>저장</Btn><Btn small onClick={() => setRenaming(null)}>취소</Btn></>
          : <span style={{ fontWeight: depth ? 500 : 700, fontSize: depth ? 13 : 14, flex: 1 }}>{n.title}</span>}
        {sec && <Chip tone={statusTone(sec.status)}>{sec.status}</Chip>}
        {editing && renaming?.id !== n.id && <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <Btn small onClick={() => setRenaming({ id: n.id, title: n.title })} title="수정">✎</Btn>
          <Btn small onClick={() => move(n.id, -1)} title="위로">↑</Btn>
          <Btn small onClick={() => move(n.id, 1)} title="아래로">↓</Btn>
          <Btn small kind="danger" onClick={() => remove(n.id)} title="삭제">✕</Btn>
        </div>}
      </div>
    );
  };
  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <Card title="목차" right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {provider && <Chip tone={provider === 't3q' ? 'green' : 'orange'}>{provider === 't3q' ? 'T3Q RPT-001' : 'UNI 폴백'}</Chip>}
        {!editing ? <>
          <Btn small disabled={busy || !plan.context} onClick={() => void generate()}>{busy ? '생성 중… (T3Q ~15초)' : toc.length ? '목차 재생성' : '목차 생성하기'}</Btn>
          <Btn small disabled={!toc.length} onClick={() => setEditing(true)}>편집하기</Btn>
          <Btn small kind="primary" disabled={!toc.length} onClick={onDraft}>초안 작성하기 →</Btn>
        </> : <>
          <Btn small onClick={() => { setAddModal({ parent: selected ? toc.find((n) => n.id === selected) ?? null : null }); }} disabled={!!renaming}>{selected && toc.some((n) => n.id === selected) ? '하위 목차 추가' : '목차 추가'}</Btn>
          <Btn small kind="primary" onClick={() => { if (renaming) { show('작성 중인 내용이 있습니다'); return; } setEditing(false); setSelected(null); }}>편집 종료</Btn>
        </>}
      </div>}>
        {busy && <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>목차를 생성하고 있습니다… <div style={{ fontSize: 12, marginTop: 6 }}>T3Q RPT-001 호출 중 (기준정보 + 템플릿 개요 기호 전달)</div></div>}
        {!busy && !toc.length && <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>기준정보를 입력한 뒤 [목차 생성하기]를 누르세요.</div>}
        {!busy && toc.map((n) => <div key={n.id}>{row(n, 0)}{n.children.map((c) => row(c, 1))}</div>)}
        {editing && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>목차를 선택하고 [하위 목차 추가]를 누르면 그 아래에 추가됩니다. ↑↓로 이동, ✎로 이름 수정.</div>}
      </Card>
      {addModal && <Modal title={addModal.parent ? '하위 목차 추가' : '목차 추가'} onClose={() => setAddModal(null)}>{addModal.parent && <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>상위 목차: <b>{addModal.parent.no} {addModal.parent.title}</b></div>}<Input autoFocus maxLength={20} value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="목차 명 (최대 20자)" onKeyDown={(e) => { if (e.key === 'Enter' && addTitle.trim()) add(); }} /><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><Btn onClick={() => setAddModal(null)}>취소</Btn><Btn kind="primary" disabled={!addTitle.trim()} onClick={add}>추가하기</Btn></div></Modal>}
    </div>
  );
}

// ── 3. 초안 (SCR-CADM-402005/402003) + 챗봇 문단 수정 ─────────────────────
function DraftStep({ plan, tpl, reload, show }: { plan: Plan; tpl: Template | null; reload: () => Promise<Plan>; show: (m: string) => void }) {
  const flat = useMemo(() => plan.toc.flatMap((n) => [{ node: n, depth: 1 }, ...n.children.map((c) => ({ node: c, depth: 2 }))]), [plan.toc]);
  const [current, setCurrent] = useState<string | null>(flat.find((f) => plan.sections[f.node.id]?.status === '완료')?.node.id ?? null);
  const [live, setLive] = useState<Record<string, string>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [autoAll, setAutoAll] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const [selPara, setSelPara] = useState<{ id: string; text: string } | null>(null);
  const [instruction, setInstruction] = useState('');
  const [revising, setRevising] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [editRaw, setEditRaw] = useState<string | null>(null);
  const status = (id: string): SecStatus => (running === id ? '진행중' : plan.sections[id]?.status ?? '-');

  const draftOne = (tocId: string, force = false): Promise<void> => new Promise((resolve) => {
    setRunning(tocId); setLive((l) => ({ ...l, [tocId]: '' })); setCurrent(tocId);
    const close = sse(`/plans/${plan.id}/draft/${tocId}/stream${force ? '?force=1' : ''}`, {
      token: (d) => setLive((l) => ({ ...l, [tocId]: (l[tocId] ?? '') + (d as { text: string }).text })),
      done: async (d) => { const x = d as { provider?: string; error?: string; protected?: boolean }; if (x.protected) show('사용자가 수정한 절은 보호됩니다 (재생성하려면 강제 재생성)'); else if (x.error) show(`T3Q 실패 → UNI 폴백`); setRunning(null); await reload(); resolve(); },
      cancelled: async () => { setRunning(null); show('초안 생성이 취소되었습니다'); await reload(); resolve(); },
      error: async () => { setRunning(null); show('초안 생성에 오류가 발생했습니다'); await reload(); resolve(); },
    });
    stopRef.current = close;
  });
  const cancel = async () => { if (!running) return; await post(`/plans/${plan.id}/draft/${running}/cancel`); stopRef.current?.(); };
  const draftAll = async () => {
    setAutoAll(true);
    for (const f of flat) { if (plan.sections[f.node.id]?.status === '완료') continue; if (!autoAllRef.current) break; await draftOne(f.node.id); }
    setAutoAll(false); show('초안이 작성되었습니다');
  };
  const autoAllRef = useRef(false); useEffect(() => { autoAllRef.current = autoAll; }, [autoAll]);
  const cur = current ? plan.sections[current] : undefined;
  const md = current ? (running === current ? live[current] ?? '' : cur?.markdown ?? '') : '';
  const bullets = tpl?.levels.map((l) => l.bullet) ?? ['□', 'ㅇ', '-', '*'];
  const levelStyle = (lv: number): React.CSSProperties => { const L = tpl?.levels[lv - 1]; return { fontSize: L?.fontSizePt ? Math.min(20, L.fontSizePt) : 16 - lv, fontWeight: L?.bold ? 800 : 700, fontFamily: L?.fontFamily ? `"${L.fontFamily}", ${'inherit'}` : undefined, paddingLeft: L?.indentHu ? L.indentHu / 100 * 2 : 0 }; };
  const revise = async () => {
    if (!selPara || !instruction.trim()) return; setRevising(true);
    try { const r = await post<{ before: string; after: string }>(`/plans/${plan.id}/revise`, { paraId: selPara.id, instruction }); await reload(); setSelPara({ id: selPara.id, text: r.after }); setInstruction(''); show('문단이 수정되었습니다'); }
    catch (e) { show((e as Error).message); } finally { setRevising(false); }
  };
  const revert = async () => { if (!selPara) return; await post(`/plans/${plan.id}/revert`, { paraId: selPara.id }); await reload(); show('원문으로 되돌렸습니다'); setSelPara(null); };
  const saveRaw = async () => { if (!current || editRaw === null) return; await put(`/plans/${plan.id}/sections/${current}`, { markdown: editRaw, userEdited: true }); setEditRaw(null); await reload(); show('저장되었습니다'); };
  const doneCount = flat.filter((f) => plan.sections[f.node.id]?.status === '완료').length;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 340px', height: '100%' }}>
      {/* 목차 영역 */}
      <div style={{ borderRight: `1px solid ${C.border}`, background: '#fff', overflow: 'auto' }}>
        <div style={{ padding: 12, borderBottom: `1px solid ${C.border}`, display: 'flex', gap: 6, alignItems: 'center' }}>
          <b style={{ fontSize: 13, flex: 1 }}>목차 {doneCount}/{flat.length}</b>
          {running ? <Btn small kind="danger" onClick={() => void cancel()}>생성 취소</Btn> : <Btn small kind="primary" onClick={() => void draftAll()} disabled={!!running}>{doneCount ? '나머지 초안 작성' : '초안 작성하기'}</Btn>}
        </div>
        {flat.map(({ node, depth }) => { const st = status(node.id); const sec = plan.sections[node.id]; const clickable = st === '완료' || running === node.id; return (
          <div key={node.id} onClick={() => clickable && setCurrent(node.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', paddingLeft: 12 + (depth - 1) * 16, cursor: clickable ? 'pointer' : 'default', background: current === node.id ? C.blueLight : 'transparent', opacity: clickable ? 1 : 0.6, borderBottom: `1px solid #f1f5f9` }}>
            <span style={{ fontSize: 11, color: C.muted, width: 30 }}>{node.no}</span>
            <span style={{ flex: 1, fontSize: depth === 1 ? 13 : 12, fontWeight: depth === 1 ? 700 : 500 }}>{node.title}</span>
            {sec?.userEdited && <span title="사용자 수정 · 재생성 보호">🔒</span>}
            <Chip tone={statusTone(st)}>{st}</Chip>
            {st !== '진행중' && !running && <span onClick={(e) => e.stopPropagation()}><Btn small kind="ghost" title={sec?.userEdited ? '강제 재생성' : '이 절 생성'} onClick={() => void draftOne(node.id, !!sec?.userEdited)}>{st === '완료' ? '↻' : '▶'}</Btn></span>}
          </div>); })}
      </div>
      {/* 초안 영역 */}
      <div style={{ overflow: 'auto', padding: '20px 32px', background: '#fff' }}>
        {!current ? <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>왼쪽 목차에서 [초안 작성하기]를 누르세요. 초안이 하나라도 완성되면 여기서 확인할 수 있습니다.<div style={{ fontSize: 12, marginTop: 8 }}>T3Q RPT-002가 절 단위로 본문을 생성합니다 (절당 약 15~20초).</div></div> : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{flat.find((f) => f.node.id === current)?.node.no} {flat.find((f) => f.node.id === current)?.node.title}</h2>
              {cur?.provider && <Chip tone={cur.provider === 't3q' ? 'green' : 'orange'}>{cur.provider === 't3q' ? 'T3Q' : 'UNI'}</Chip>}
              {running === current && <Chip tone="blue">생성 중…</Chip>}
              <div style={{ flex: 1 }} />
              {cur?.sources?.length ? <Btn small onClick={() => setShowSources(true)}>근거 {cur.sources.length}</Btn> : null}
              {cur && running !== current && (editRaw === null ? <Btn small onClick={() => setEditRaw(cur.markdown)}>직접 편집</Btn> : <><Btn small kind="primary" onClick={() => void saveRaw()}>저장</Btn><Btn small onClick={() => setEditRaw(null)}>취소</Btn></>)}
            </div>
            {editRaw !== null ? <Textarea value={editRaw} onChange={(e) => setEditRaw(e.target.value)} style={{ minHeight: 480, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} /> : (
              <div style={{ fontFamily: tpl?.bodyFontFamily ? `"${tpl.bodyFontFamily}", ${'inherit'}` : undefined }}>
                {md ? renderMarkdown(md, { paraPrefix: current, onParaClick: running ? undefined : (id, text) => setSelPara({ id, text }), selectedId: selPara?.id, levelStyle, bullets }) : <div style={{ color: C.muted }}>{running === current ? '응답을 기다리는 중…' : '내용이 없습니다'}</div>}
                {running === current && <span style={{ display: 'inline-block', width: 8, height: 16, background: C.blue, animation: 'blink 1s infinite' }} />}
              </div>
            )}
            <style>{`@keyframes blink{50%{opacity:0}}`}</style>
          </>
        )}
      </div>
      {/* 챗봇 패널 */}
      <div style={{ borderLeft: `1px solid ${C.border}`, background: '#f8fafc', padding: 14, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 8 }}>✦ AI 문단 수정</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>본문에서 문단·표·목록을 클릭해 선택한 뒤 수정 지시를 입력하세요. 템플릿 스타일 규칙이 함께 전달됩니다.</div>
        {selPara ? (
          <div style={{ background: '#fff7cc', border: '1px solid #f59e0b', borderRadius: 8, padding: 10, fontSize: 12, marginBottom: 10, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{selPara.text}</div>
        ) : <div style={{ background: '#fff', border: `1px dashed ${C.border}`, borderRadius: 8, padding: 14, fontSize: 12, color: C.muted, marginBottom: 10, textAlign: 'center' }}>선택된 문단 없음</div>}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
          {['더 간결하게', '공문서 문체로', '표로 정리', '수치·근거 보강', '두 문장으로 나눠', '담당 부서 명시'].map((q) => <Btn key={q} small onClick={() => setInstruction(q)} disabled={!selPara}>{q}</Btn>)}
        </div>
        <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="예: 취약계층 보호 항목을 표로 정리하고 담당 부서를 명시해줘" disabled={!selPara} style={{ minHeight: 70 }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Btn kind="primary" disabled={!selPara || !instruction.trim() || revising} onClick={() => void revise()} style={{ flex: 1 }}>{revising ? '수정 중…' : '수정 요청'}</Btn>
          {selPara && cur?.history.some((h) => h.paraId === selPara.id) && <Btn onClick={() => void revert()}>원문 복원</Btn>}
        </div>
        {cur?.history.length ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>수정 이력 ({cur.history.length})</div>
            {[...cur.history].reverse().slice(0, 8).map((h, i) => <div key={i} style={{ fontSize: 11, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: 8, marginBottom: 6 }}><div style={{ color: C.blue, fontWeight: 700 }}>{h.instruction}</div><div style={{ color: C.muted, marginTop: 2 }}>{new Date(h.at).toLocaleTimeString('ko-KR')} · {h.paraId.split('#')[1]}</div></div>)}
          </div>
        ) : null}
      </div>
      {showSources && cur && <Modal title="AI 생성 근거" onClose={() => setShowSources(false)} width={640}>{cur.sources.map((s, i) => <div key={i} style={{ padding: 10, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 8, fontSize: 12 }}><b>{s.filename}</b> <span style={{ color: C.muted }}>{s.text}</span>{s.score ? <Chip>{Math.round(s.score * 100)}%</Chip> : null}</div>)}</Modal>}
    </div>
  );
}

// ── 4. 미리보기·내보내기 (SCR-CADM-404004) ───────────────────────────────
function PreviewStep({ plan, tpl, reload, show }: { plan: Plan; tpl: Template | null; reload: () => Promise<Plan>; show: (m: string) => void }) {
  const [tab, setTab] = useState<'doc' | 'hwpx'>('doc');
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<{ pages: number; htmls: string[] } | null>(null);
  const bullets = tpl?.levels.map((l) => l.bullet) ?? ['□', 'ㅇ', '-', '*'];
  const md = plan.toc.map((n) => [`# ${n.no} ${n.title}`, plan.sections[n.id]?.markdown ?? '', ...n.children.flatMap((c) => [`## ${c.no} ${c.title}`, plan.sections[c.id]?.markdown ?? ''])].filter(Boolean).join('\n\n')).join('\n\n');
  const exportHwpx = async () => {
    setBusy(true);
    try { const r = await post<{ fileName: string; url: string; pages: number }>(`/plans/${plan.id}/export`, {}); await reload(); show(`HWPX 생성 완료 (${r.pages}쪽)`); setTab('hwpx'); setPages(await get(`/plans/${plan.id}/export/preview`)); }
    catch (e) { show((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (tab === 'hwpx' && plan.export && !pages) get<{ pages: number; htmls: string[] }>(`/plans/${plan.id}/export/preview`).then(setPages).catch(() => {}); }, [tab, plan.export]);
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <Btn small kind={tab === 'doc' ? 'dark' : 'default'} onClick={() => setTab('doc')}>문서 미리보기</Btn>
        <Btn small kind={tab === 'hwpx' ? 'dark' : 'default'} onClick={() => setTab('hwpx')} disabled={!plan.export}>HWPX 재로드 뷰 (rhwp 렌더)</Btn>
        <div style={{ flex: 1 }} />
        {tpl && <Chip>템플릿 {tpl.name}</Chip>}
        <Btn kind="primary" disabled={busy} onClick={() => void exportHwpx()}>{busy ? 'HWPX 생성 중…' : plan.export ? 'HWPX 다시 내보내기' : 'HWPX 내보내기'}</Btn>
        {plan.export && <a href={`/api/files/${plan.export.fileName}`} download><Btn>다운로드 ({plan.export.pages}쪽)</Btn></a>}
        {plan.export && <Link to={`/plan/${plan.id}/editor`}><Btn kind="dark">rhwp 에디터에서 열기</Btn></Link>}
        <Btn onClick={() => window.print()}>인쇄</Btn>
      </div>
      {tab === 'doc' && (
        <div style={{ background: '#fff', maxWidth: 820, margin: '0 auto', padding: '48px 56px', boxShadow: '0 2px 12px rgba(0,0,0,.08)', fontFamily: tpl?.bodyFontFamily ? `"${tpl.bodyFontFamily}", inherit` : undefined }}>
          <h1 style={{ textAlign: 'center', fontSize: 24, marginBottom: 32 }}>{plan.title}</h1>
          {renderMarkdown(md, { bullets, levelStyle: (lv) => { const L = tpl?.levels[lv - 1]; return { fontSize: L?.fontSizePt ? Math.min(20, L.fontSizePt) : 16 - lv, fontWeight: L?.bold ? 800 : 700, marginTop: 14 }; } })}
        </div>
      )}
      {tab === 'hwpx' && (
        <div style={{ background: '#e5e7eb', padding: 16, display: 'grid', gap: 12, justifyItems: 'center' }}>
          {!pages ? <div style={{ color: C.muted, padding: 40 }}>rhwp로 HWPX를 다시 열어 렌더링하는 중…</div> : pages.htmls.map((h, i) => <div key={i} style={{ background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,.15)' }} dangerouslySetInnerHTML={{ __html: h }} />)}
          {pages && <div style={{ fontSize: 12, color: C.muted }}>내보낸 HWPX를 rhwp 엔진으로 다시 읽어 HTML로 렌더한 화면입니다 (총 {pages.pages}쪽). 한/글에서 열리는 모양에 가깝습니다.</div>}
        </div>
      )}
    </div>
  );
}
