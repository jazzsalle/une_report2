import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, put, sse, pickSaveLocation, writeFileTo, ago, HAZARDS, type Plan, type PlanContext, type TocNode, type Template, type SecStatus, type Section } from '../api';
import { Toast, renderMarkdown, useToast, useUser } from '../ui';
import { H1, Icon, KAlert, KBadge, KBtn, KCard, KField, KInput, KModal, KSelect, KTable, KTextarea, KV, Pipeline, statusToTone, type PipeStep } from '../krds';

type Step = 'context' | 'toc' | 'draft' | 'preview';
const emptyCtx = (): PlanContext => ({ subject: '', hazardType: '폭염', managementPhase: '대비', audience: '지자체', templateId: null, tone: '공문서체' });
interface Health { uni: { baseUrl: string; mock: boolean; lastFailure: string | null }; t3q: { baseUrl: string; verifyTls: boolean; lastFailure: string | null }; rhwp: { version: string } }

export function PlanEditor() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [user] = useUser();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [step, setStep] = useState<Step>('context');
  const [toast, show] = useToast();
  const reload = useCallback(async () => { const p = await get<Plan>(`/plans/${id}`); setPlan(p); return p; }, [id]);
  useEffect(() => { void reload().then((p) => { if (p.toc.length) setStep(Object.keys(p.sections).length ? 'draft' : 'toc'); }); get<Template[]>('/templates').then(setTemplates); get<Health>('/health').then(setHealth).catch(() => setHealth(null)); }, [id, reload]);
  if (!plan) return <div className="wrap" style={{ padding: 24 }}>불러오는 중…</div>;
  const tpl = templates.find((t) => t.id === plan.context?.templateId) ?? null;
  const total = plan.toc.reduce((a, n) => a + 1 + n.children.length, 0);
  const done = Object.values(plan.sections).filter((s) => s.status === '완료').length;
  // 작업 단계 칩 — 자유 이동 허용, 선행조건 미충족은 비활성 + 사유(title)
  const steps: PipeStep[] = [
    { key: 'context', label: '기준정보', done: !!plan.context },
    { key: 'toc', label: '목차', done: plan.toc.length > 0, disabled: !plan.context, title: !plan.context ? '기준정보를 먼저 저장하세요' : undefined },
    { key: 'draft', label: total ? `초안 ${done}/${total}` : '초안', done: total > 0 && done === total, disabled: !plan.toc.length, title: !plan.toc.length ? '목차를 먼저 생성하세요' : undefined },
    { key: 'preview', label: '미리보기·내보내기', done: !!plan.export, disabled: !done, title: !done ? '초안이 하나 이상 완료되어야 합니다' : undefined },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      {/* 작업 콘솔 띠 (SCR-CADM-401004 / 402001) */}
      <div className="band">
        <div className="wrap console">
          <Link to="/plan" className="back"><Icon name="back" /> 문서 관리</Link>
          <div className="doc-tit">
            <strong>{plan.title}</strong>
            <span>{plan.context ? `${plan.context.hazardType} · ${plan.context.managementPhase}` : '기준정보 미입력'}{tpl ? ` · 템플릿 ${tpl.name}` : ''} · {ago(plan.updatedAt)} {plan.updatedBy ?? plan.createdBy}</span>
          </div>
          <Pipeline steps={steps} current={step} onSelect={(k) => setStep(k as Step)} />
          <KBtn size="sm" onClick={() => nav(`/plan/${id}/editor`)} disabled={!plan.export} title={plan.export ? '내보낸 HWPX를 rhwp 웹 에디터로 엽니다' : '먼저 HWPX로 내보내세요'}><Icon name="external" /> rhwp 에디터에서 열기</KBtn>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {step === 'context' && <ContextStep plan={plan} templates={templates} health={health} onSaved={async (goToc) => { await reload(); if (goToc) setStep('toc'); }} show={show} user={user?.name ?? ''} />}
        {step === 'toc' && <TocStep plan={plan} tpl={tpl} reload={reload} show={show} onDraft={() => setStep('draft')} />}
        {step === 'draft' && <DraftStep plan={plan} tpl={tpl} reload={reload} show={show} />}
        {step === 'preview' && <PreviewStep plan={plan} tpl={tpl} reload={reload} show={show} />}
      </div>
      <Toast msg={toast} />
    </div>
  );
}

// ── 우측 레일: 생성 기준 / 연동 상태 ──────────────────────────────────────
function BasisRail({ ctx, tpl }: { ctx: PlanContext | null; tpl: Template | null }) {
  return (
    <KCard tight title="생성 기준" titleAs="h3">
      <KV items={[
        ['HWPX 템플릿', tpl ? <>{tpl.name} <KBadge tone="light-success">스타일 분석됨</KBadge></> : <KBadge tone="light-warning">선택 안 함</KBadge>],
        ['개요 기호', tpl ? tpl.levels.map((l) => `${l.bullet || '·'} ${l.fontSizePt ?? '?'}pt${l.bold ? ' 굵게' : ''}`).join(' · ') : '-'],
        ['재난유형 · 단계', ctx ? `${ctx.hazardType} · ${ctx.managementPhase}` : '-'],
        ['타깃 독자', ctx?.audience ?? '-'],
        ['생성 계약', 'T3Q RPT-001(목차) / RPT-002(본문) · 실패 시 유니 폴백'],
      ]} />
    </KCard>
  );
}
function LinkRail({ health }: { health: Health | null }) {
  return (
    <KCard tight title="연동 상태" titleAs="h3">
      {health ? (
        <KV items={[
          ['T3Q', <><KBadge tone={health.t3q.lastFailure ? 'light-warning' : 'light-success'}>{health.t3q.lastFailure ? '오류 → 유니 폴백' : '연결됨'}</KBadge> <span className="tiny dim">{health.t3q.baseUrl.replace(/^https?:\/\//, '')}</span></>],
          ['유니', <><KBadge tone={health.uni.mock || health.uni.lastFailure ? 'light-warning' : 'light-success'}>{health.uni.mock ? '목업' : health.uni.lastFailure ? '오류 → 목업' : '연결됨'}</KBadge></>],
          ['rhwp', <><KBadge>{health.rhwp.version}</KBadge> <span className="tiny dim">서버 내장</span></>],
        ]} />
      ) : <p className="tiny" style={{ color: '#d0290e' }}>서버(:3100)에 연결할 수 없습니다.</p>}
    </KCard>
  );
}

// ── 1. 기준정보 (SCR-CADM-401001, 405002) ──────────────────────────────────
function ContextStep({ plan, templates, health, onSaved, show, user }: { plan: Plan; templates: Template[]; health: Health | null; onSaved: (goToc: boolean) => Promise<void>; show: (m: string) => void; user: string }) {
  const [c, setC] = useState<PlanContext>(plan.context ?? emptyCtx());
  const [saving, setSaving] = useState(false);
  const [tplModal, setTplModal] = useState(false);
  const [tplName, setTplName] = useState('');
  const [loadModal, setLoadModal] = useState(false);
  const [saved, setSaved] = useState<{ id: string; name: string; context: PlanContext; createdBy: string }[]>([]);
  const set = (k: keyof PlanContext) => (e: { target: { value: string } }) => setC({ ...c, [k]: e.target.value });
  const valid = c.subject.trim() && c.hazardType && c.managementPhase && c.audience;
  const tpl = templates.find((t) => t.id === c.templateId) ?? null;
  useEffect(() => { if (tpl && !c.outlineNumbering) setC((x) => ({ ...x, outlineNumbering: tpl.levels.map((l) => l.bullet).filter(Boolean).join(' ') })); }, [tpl?.id]);
  const save = async (goToc: boolean) => {
    setSaving(true);
    try { await put(`/plans/${plan.id}/context`, { ...c, updatedBy: user }); show('저장되었습니다'); await onSaved(goToc); }
    finally { setSaving(false); }
  };
  const registerTpl = async () => { await post('/plan-templates', { name: tplName, context: c, createdBy: user }); setTplModal(false); show('저장되었습니다'); };
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 24, display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 360px', gap: 24, alignItems: 'start' }}>
      <div className="stack">
        <div className="row">
          <H1 code="SCR-CADM-401001 · 405002">기준정보</H1>
          <div style={{ flex: 1 }} />
          <KBtn size="sm" onClick={() => { setLoadModal(true); get<typeof saved>('/plan-templates').then(setSaved); }}>템플릿 불러오기</KBtn>
          <KBtn size="sm" disabled={!valid} onClick={() => setTplModal(true)}>템플릿 등록하기</KBtn>
        </div>
        {plan.toc.length > 0 && <KAlert kind="warning">이미 목차가 있습니다. 기준정보를 수정하고 다시 목차를 생성하면 기존 초안은 초기화됩니다.</KAlert>}

        <KCard title="HWPX 문서 템플릿" desc="스타일 분석 결과를 목차·초안 생성 규칙과 내보내기에 적용합니다" right={<Link to="/plan/templates" className="tiny">템플릿 관리 →</Link>}>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto' }}>
            {templates.map((t) => (
              <button type="button" key={t.id} className={`tpl-card${c.templateId === t.id ? ' sel' : ''}`} aria-pressed={c.templateId === t.id} onClick={() => setC({ ...c, templateId: t.id, outlineNumbering: t.levels.map((l) => l.bullet).filter(Boolean).join(' ') })}>
                <strong>{t.name}</strong>
                <span className="meta">{t.levels.map((l) => `${l.bullet}${l.fontSizePt}`).join(' · ')}</span>
                <span className="meta">본문 {t.bodyFontFamily?.split(' ')[0] ?? '-'} {t.bodyFontSizePt}pt</span>
              </button>
            ))}
            {!templates.length && <p className="card-desc">등록된 템플릿이 없습니다. <Link to="/plan/templates">템플릿 관리</Link>에서 HWPX를 업로드하세요.</p>}
          </div>
        </KCard>

        <KCard title="문서 주제">
          <KField label="문서 주제" required htmlFor="f-subject"><KInput id="f-subject" value={c.subject} onChange={set('subject')} placeholder="예: 2026년 여름철 폭염 대비 재난안전계획" /></KField>
        </KCard>
        <KCard title="배경 정보">
          <div className="form-grid">
            <KField label="재난유형" required htmlFor="f-hazard"><KSelect id="f-hazard" value={c.hazardType} onChange={set('hazardType')}>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</KSelect></KField>
            <KField label="재난관리단계" required htmlFor="f-phase"><KSelect id="f-phase" value={c.managementPhase} onChange={set('managementPhase')}><option>예방</option><option>대비</option></KSelect></KField>
            <KField label="장소" htmlFor="f-place"><KInput id="f-place" value={c.place ?? ''} onChange={set('place')} placeholder="○○시" /></KField>
            <KField label="재난발생일시" htmlFor="f-occ"><KInput id="f-occ" type="datetime-local" value={c.occurredAt ?? ''} onChange={set('occurredAt')} /></KField>
            <KField label="보고일시" htmlFor="f-rep"><KInput id="f-rep" type="datetime-local" value={c.reportedAt ?? ''} onChange={set('reportedAt')} /></KField>
          </div>
        </KCard>
        <KCard title="내용지침">
          <div className="stack">
            <KField label="출처" htmlFor="f-src"><KInput id="f-src" value={c.sources ?? ''} onChange={set('sources')} placeholder="재난 및 안전관리 기본법, 폭염 위기관리 표준매뉴얼" /></KField>
            <KField label="필수 포함 요소" hint="쉼표로 구분" htmlFor="f-req"><KInput id="f-req" value={c.requiredElements ?? ''} onChange={set('requiredElements')} placeholder="취약계층 보호, 무더위쉼터 운영, 비상연락망" /></KField>
            <KField label="작성 가이드" htmlFor="f-guide"><KTextarea id="f-guide" value={c.writingGuide ?? ''} onChange={set('writingGuide')} placeholder="담당 부서와 기한을 표로 정리, 수치는 최근 3년 자료" /></KField>
          </div>
        </KCard>
        <KCard title="표현 규칙">
          <div className="form-grid">
            <KField label="문체" htmlFor="f-tone"><KSelect id="f-tone" value={c.tone ?? ''} onChange={set('tone')}><option value="">선택</option><option>공문서체</option><option>개조식</option><option>서술체</option></KSelect></KField>
            <KField label="문장길이 제한" htmlFor="f-len"><KInput id="f-len" value={c.sentenceLimit ?? ''} onChange={set('sentenceLimit')} placeholder="60자 이내" /></KField>
            <KField label="문단 개요번호 모양" htmlFor="f-outline" hint={tpl ? `템플릿 "${tpl.name}"에서 자동 채움` : '템플릿을 선택하면 자동으로 채워집니다'}><KInput id="f-outline" value={c.outlineNumbering ?? ''} onChange={set('outlineNumbering')} placeholder="□ ㅇ - *" /></KField>
            <KField label="본문 문장 시작" htmlFor="f-start"><KInput id="f-start" value={c.bodyStart ?? ''} onChange={set('bodyStart')} placeholder="(소제목) 문장…" /></KField>
          </div>
        </KCard>
        <KCard title="문장 작성 목적">
          <div className="form-grid">
            <KField label="업무 목적" htmlFor="f-purpose"><KInput id="f-purpose" value={c.purpose ?? ''} onChange={set('purpose')} placeholder="폭염 피해 최소화" /></KField>
            <KField label="역할" htmlFor="f-role"><KInput id="f-role" value={c.role ?? ''} onChange={set('role')} placeholder="안전총괄과" /></KField>
            <KField label="타깃 독자" required htmlFor="f-aud" hint="T3Q 열거값: 중앙정부 / 지자체 / 내부보고 / 대민"><KSelect id="f-aud" value={c.audience ?? ''} onChange={set('audience')}><option>중앙정부</option><option>지자체</option><option>내부보고</option><option>대민</option></KSelect></KField>
          </div>
        </KCard>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <KBtn kind="secondary" disabled={saving} onClick={() => void save(false)}>저장</KBtn>
          <KBtn kind="primary" disabled={!valid || saving} onClick={() => void save(true)}>저장하고 목차 생성으로 <Icon name="angle" /></KBtn>
        </div>
      </div>
      <aside className="rail">
        <BasisRail ctx={c} tpl={tpl} />
        <LinkRail health={health} />
      </aside>
      {tplModal && (
        <KModal title="기준정보 템플릿 등록" onClose={() => setTplModal(false)}>
          <KField label="템플릿 명" required htmlFor="tpl-name"><KInput id="tpl-name" autoFocus maxLength={20} value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="템플릿 명 (최대 20자)" /></KField>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setTplModal(false)}>취소</KBtn><KBtn kind="primary" size="sm" disabled={!tplName.trim()} onClick={() => void registerTpl()}>등록하기</KBtn></div>
        </KModal>
      )}
      {loadModal && (
        <KModal title="기준정보 템플릿 불러오기" onClose={() => setLoadModal(false)}>
          {saved.length ? <div className="stack" style={{ gap: 8 }}>{saved.map((s) => (
            <button type="button" key={s.id} className="tpl-card" style={{ minWidth: 0 }} onClick={() => { setC({ ...s.context }); setLoadModal(false); show('불러왔습니다'); }}>
              <strong>{s.name}</strong><span className="meta">{s.context.hazardType} · {s.context.managementPhase} · {s.createdBy}</span>
            </button>
          ))}</div> : <p className="card-desc">저장된 템플릿이 없습니다.</p>}
        </KModal>
      )}
    </div>
  );
}

// ── 2. 목차 (SCR-CADM-401002/003, 404005/006) ────────────────────────────
function TocStep({ plan, tpl, reload, show, onDraft }: { plan: Plan; tpl: Template | null; reload: () => Promise<Plan>; show: (m: string) => void; onDraft: () => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [toc, setToc] = useState<TocNode[]>(plan.toc);
  const [selected, setSelected] = useState<string | null>(null);
  const [addModal, setAddModal] = useState<{ parent: TocNode | null } | null>(null);
  const [addTitle, setAddTitle] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [result, setResult] = useState<{ provider: string; seconds: number; at: string } | null>(null);
  useEffect(() => setToc(plan.toc), [plan.toc]);
  const generate = async () => {
    setBusy(true); const t0 = Date.now();
    try {
      const r = await post<Plan & { tocProvider?: string; tocError?: string }>(`/plans/${plan.id}/toc`, {});
      setResult({ provider: r.tocProvider ?? 'uni', seconds: Math.round((Date.now() - t0) / 1000), at: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) });
      if (r.tocError) show(`T3Q 실패 → 유니 폴백: ${r.tocError.slice(0, 60)}`); else show('목차가 생성되었습니다');
      await reload();
    } finally { setBusy(false); }
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
  const chapters = toc.length, sections = toc.reduce((a, n) => a + n.children.length, 0);
  const providerBadge = (p: string) => (p === 't3q' ? <KBadge tone="light-success">T3Q RPT-001</KBadge> : <KBadge tone="light-warning">유니 폴백</KBadge>);
  const row = (n: TocNode, depth: number) => {
    const sec = plan.sections[n.id]; const isSel = selected === n.id;
    return (
      <li key={n.id} className={`toc-row${isSel ? ' sel' : ''}`} onClick={() => editing && setSelected(isSel ? null : n.id)} style={{ paddingLeft: 12 + depth * 28, cursor: editing ? 'pointer' : 'default' }}>
        <span className="no">{n.no}</span>
        {renaming?.id === n.id ? <>
          <KInput autoFocus value={renaming.title} onChange={(e) => setRenaming({ ...renaming, title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setRenaming(null); }} style={{ width: 360 }} aria-label="목차 명" />
          <KBtn size="xs" kind="primary" onClick={rename}>저장</KBtn><KBtn size="xs" onClick={() => setRenaming(null)}>취소</KBtn>
        </> : <span style={{ flex: 1, fontSize: depth ? 15 : 17, fontWeight: depth ? 400 : 700 }}>{n.title}</span>}
        {sec && <KBadge tone={statusToTone(sec.status)}>{sec.status}</KBadge>}
        {editing && renaming?.id !== n.id && (
          <span className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
            <KBtn kind="icon" ariaLabel="이름 수정" title="이름 수정" onClick={() => setRenaming({ id: n.id, title: n.title })}><Icon name="edit" size={16} /></KBtn>
            <KBtn kind="icon" ariaLabel="위로" title="위로" onClick={() => move(n.id, -1)}><Icon name="up" size={16} /></KBtn>
            <KBtn kind="icon" ariaLabel="아래로" title="아래로" onClick={() => move(n.id, 1)}><Icon name="down" size={16} /></KBtn>
            <KBtn kind="icon" ariaLabel="삭제" title="삭제" style={{ color: '#d0290e' }} onClick={() => remove(n.id)}><Icon name="close" size={16} /></KBtn>
          </span>
        )}
      </li>
    );
  };
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 24, display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 360px', gap: 24, alignItems: 'start' }}>
      <div className="stack">
        <H1 code="SCR-CADM-401002 · 404005">목차</H1>
        {result && !busy && (result.provider === 't3q'
          ? <KAlert kind="success">T3Q RPT-001이 목차를 생성했습니다 ({chapters}장 {sections}절 · {result.seconds}초). 기준정보와 템플릿 개요 기호{tpl ? `(${tpl.levels.map((l) => l.bullet).filter(Boolean).join(' ')})` : ''}가 함께 전달되었습니다.</KAlert>
          : <KAlert kind="warning">T3Q 호출에 실패해 유니가 목차를 생성했습니다 ({chapters}장 {sections}절 · {result.seconds}초).</KAlert>)}
        <KCard title="목차" desc={result ? providerBadge(result.provider) : undefined} right={
          !editing ? <>
            <KBtn size="sm" disabled={busy || !plan.context} onClick={() => void generate()}><Icon name="refresh" /> {busy ? '생성 중… (T3Q ~15초)' : toc.length ? '목차 재생성' : '목차 생성하기'}</KBtn>
            <KBtn size="sm" disabled={!toc.length || busy} onClick={() => setEditing(true)}>편집하기</KBtn>
            <KBtn size="sm" kind="primary" disabled={!toc.length || busy} onClick={onDraft}>초안 작성하기 <Icon name="angle" /></KBtn>
          </> : <>
            <KBtn size="sm" disabled={!!renaming} onClick={() => setAddModal({ parent: selected ? toc.find((n) => n.id === selected) ?? null : null })}><Icon name="plus" /> {selected && toc.some((n) => n.id === selected) ? '하위 목차 추가' : '목차 추가'}</KBtn>
            <KBtn size="sm" kind="primary" onClick={() => { if (renaming) { show('작성 중인 내용이 있습니다'); return; } setEditing(false); setSelected(null); }}>편집 종료</KBtn>
          </>}>
          {busy && <p className="card-desc" style={{ padding: 40, textAlign: 'center' }}>목차를 생성하고 있습니다…<br /><span className="tiny">T3Q RPT-001 호출 중 (기준정보 + 템플릿 개요 기호 전달)</span></p>}
          {!busy && !toc.length && <p className="card-desc" style={{ padding: 40, textAlign: 'center' }}>기준정보를 입력한 뒤 [목차 생성하기]를 누르세요.</p>}
          {!busy && toc.length > 0 && <ol style={{ listStyle: 'none', padding: 0, borderTop: '1px solid #cdd1d5' }}>{toc.map((n) => <li key={n.id}><ol style={{ listStyle: 'none', padding: 0 }}>{row(n, 0)}{n.children.map((c) => row(c, 1))}</ol></li>)}</ol>}
          <p className="form-hint" style={{ marginTop: 12 }}>{editing ? '목차를 선택하고 [하위 목차 추가]를 누르면 그 아래에 추가됩니다. 화살표로 이동, 연필로 이름 수정.' : '[편집하기]를 누르면 목차 명 수정·삭제·위아래 이동·목차 추가·하위 목차 추가를 할 수 있습니다. 편집 중에는 초안 작성이 비활성화됩니다.'}</p>
        </KCard>
      </div>
      <aside className="rail">
        {toc.length > 0 && (
          <KCard tight title="생성 결과" titleAs="h3">
            <KV items={[
              ['생성기', result ? providerBadge(result.provider) : <span className="dim">이전 세션에서 생성</span>],
              ['구성', `${chapters}장 ${sections}절`],
              ['소요', result ? <span className="num">{result.seconds}초 · {result.at}</span> : '-'],
              ['폴백', 'T3Q 실패 시 유니로 자동 생성'],
            ]} />
          </KCard>
        )}
        <BasisRail ctx={plan.context} tpl={tpl} />
      </aside>
      {addModal && (
        <KModal title={addModal.parent ? '하위 목차 추가' : '목차 추가'} onClose={() => setAddModal(null)} desc={addModal.parent ? <>상위 목차: <strong>{addModal.parent.no} {addModal.parent.title}</strong></> : undefined}>
          <KField label="목차 명" required htmlFor="toc-add"><KInput id="toc-add" autoFocus maxLength={20} value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="목차 명 (최대 20자)" onKeyDown={(e) => { if (e.key === 'Enter' && addTitle.trim()) add(); }} /></KField>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setAddModal(null)}>취소</KBtn><KBtn kind="primary" size="sm" disabled={!addTitle.trim()} onClick={add}>추가하기</KBtn></div>
        </KModal>
      )}
    </div>
  );
}

// ── 3. 초안 (SCR-CADM-402005/402003) + 챗봇 문단 수정 ─────────────────────
function DraftStep({ plan, tpl, reload, show }: { plan: Plan; tpl: Template | null; reload: () => Promise<Plan>; show: (m: string) => void }) {
  const flat = useMemo(() => plan.toc.flatMap((n) => [{ node: n, depth: 1 }, ...n.children.map((c) => ({ node: c, depth: 2 }))]), [plan.toc]);
  const [current, setCurrent] = useState<string | null>(flat.find((f) => plan.sections[f.node.id]?.status === '완료')?.node.id ?? null);
  const [live, setLive] = useState<Record<string, string>>({});
  // 동시에 생성 중인 절들. T3Q는 절 하나를 통째로 15~20초 뒤에 돌려주므로 순차로 돌리면 11절에 3~4분 — 3절씩 병렬로 돌린다(2026-08-21).
  const [running, setRunning] = useState<Set<string>>(new Set());
  const runningRef = useRef<Set<string>>(new Set());
  const finishers = useRef<Map<string, () => void>>(new Map());
  const [autoAll, setAutoAll] = useState(false);
  const autoAllRef = useRef(false);
  const [selPara, setSelPara] = useState<{ id: string; text: string } | null>(null);
  const [instruction, setInstruction] = useState('');
  const [revising, setRevising] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [editRaw, setEditRaw] = useState<string | null>(null);
  const status = (id: string): SecStatus => (running.has(id) ? '진행중' : plan.sections[id]?.status ?? '-');
  const setRunningSync = (fn: (s: Set<string>) => Set<string>) => { runningRef.current = fn(runningRef.current); setRunning(new Set(runningRef.current)); };

  const draftOne = (tocId: string, force = false): Promise<void> => new Promise((resolve) => {
    if (runningRef.current.has(tocId)) return resolve();
    setRunningSync((s) => new Set(s).add(tocId)); setLive((l) => ({ ...l, [tocId]: '' }));
    // 보고 있던 절이 생성 중이면 시선을 빼앗지 않고, 아니면 새로 시작한 절을 보여준다
    setCurrent((c) => (c && runningRef.current.has(c) && c !== tocId ? c : tocId));
    let done = false;
    const finish = async () => { if (done) return; done = true; finishers.current.delete(tocId); close(); setRunningSync((s) => { const n = new Set(s); n.delete(tocId); return n; }); await reload(); resolve(); };
    finishers.current.set(tocId, () => void finish());
    const close = sse(`/plans/${plan.id}/draft/${tocId}/stream${force ? '?force=1' : ''}`, {
      token: (d) => setLive((l) => ({ ...l, [tocId]: (l[tocId] ?? '') + (d as { text: string }).text })),
      done: async (d) => { const x = d as { provider?: string; error?: string; protected?: boolean }; if (x.protected) show('사용자가 수정한 절은 보호됩니다 (재생성하려면 강제 재생성)'); else if (x.error) show('T3Q 실패 → 유니 폴백'); await finish(); },
      cancelled: async () => { show('초안 생성이 취소되었습니다'); await finish(); },
      error: async () => { show('초안 생성에 오류가 발생했습니다'); await finish(); },
    });
  });
  /** 생성 중인 절을 모두 취소 — 서버 플래그를 세우고 스트림을 닫는다 (T3Q는 절이 끝나야 플래그를 보므로 서버는 그때 '취소'로 기록) */
  const cancel = async () => {
    autoAllRef.current = false; setAutoAll(false);
    const ids = [...runningRef.current];
    await Promise.all(ids.map((id) => post(`/plans/${plan.id}/draft/${id}/cancel`).catch(() => {})));
    for (const id of ids) finishers.current.get(id)?.();
  };
  const CONCURRENCY = 3;
  const draftAll = async () => {
    setAutoAll(true); autoAllRef.current = true;
    const queue = flat.filter((f) => plan.sections[f.node.id]?.status !== '완료').map((f) => f.node.id);
    let next = 0;
    const worker = async () => { while (autoAllRef.current && next < queue.length) { const id = queue[next++]; await draftOne(id); } };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    const wasCancelled = !autoAllRef.current;
    setAutoAll(false); autoAllRef.current = false;
    if (!wasCancelled) show('초안이 작성되었습니다');
  };
  const cur = current ? plan.sections[current] : undefined;
  const curNode = flat.find((f) => f.node.id === current)?.node;
  const curRunning = !!current && running.has(current);
  const md = current ? (curRunning ? live[current] ?? '' : cur?.markdown ?? '') : '';
  const bullets = tpl?.levels.map((l) => l.bullet) ?? ['□', 'ㅇ', '-', '*'];
  const levelStyle = (lv: number): React.CSSProperties => { const L = tpl?.levels[lv - 1]; return { fontSize: L?.fontSizePt ? Math.min(20, L.fontSizePt) : 16 - lv, fontWeight: L?.bold ? 800 : 700, fontFamily: L?.fontFamily ? `"${L.fontFamily}", inherit` : undefined, paddingLeft: L?.indentHu ? L.indentHu / 100 * 2 : 0 }; };
  const revise = async () => {
    if (!selPara || !instruction.trim()) return; setRevising(true);
    try { const r = await post<{ before: string; after: string }>(`/plans/${plan.id}/revise`, { paraId: selPara.id, instruction }); await reload(); setSelPara({ id: selPara.id, text: r.after }); setInstruction(''); show('문단이 수정되었습니다'); }
    catch (e) { show((e as Error).message); } finally { setRevising(false); }
  };
  const revert = async () => { if (!selPara) return; await post(`/plans/${plan.id}/revert`, { paraId: selPara.id }); await reload(); show('원문으로 되돌렸습니다'); setSelPara(null); };
  const saveRaw = async () => { if (!current || editRaw === null) return; await put(`/plans/${plan.id}/sections/${current}`, { markdown: editRaw, userEdited: true }); setEditRaw(null); await reload(); show('저장되었습니다'); };
  const doneCount = flat.filter((f) => plan.sections[f.node.id]?.status === '완료').length;
  const runningNos = flat.filter((f) => running.has(f.node.id)).map((f) => f.node.no);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 340px', height: '100%', background: '#fff' }}>
      {/* 목차 영역 */}
      <section style={{ borderRight: '1px solid #cdd1d5', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div className="row" style={{ padding: 12, borderBottom: '1px solid #cdd1d5' }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>목차 <span className="num">{doneCount}/{flat.length}</span></h2>
          {running.size ? <KBtn size="xs" kind="danger" onClick={() => void cancel()}><Icon name="stop" /> 생성 취소{running.size > 1 ? ` (${running.size}절)` : ''}</KBtn> : <KBtn size="xs" kind="primary" onClick={() => void draftAll()} disabled={doneCount === flat.length}><Icon name="play" /> {doneCount ? '나머지 초안 작성' : '초안 작성하기'}</KBtn>}
        </div>
        <ol style={{ listStyle: 'none', padding: 0, overflow: 'auto', flex: 1 }}>
          {flat.map(({ node, depth }) => { const st = status(node.id); const sec = plan.sections[node.id]; const clickable = st === '완료' || running.has(node.id); return (
            <li key={node.id} className={`draft-row${current === node.id ? ' cur' : ''}`} onClick={() => clickable && setCurrent(node.id)} style={{ paddingLeft: 12 + (depth - 1) * 18, cursor: clickable ? 'pointer' : 'default', opacity: clickable ? 1 : 0.6 }}>
              <span className="no">{node.no}</span>
              <span style={{ flex: 1, fontSize: depth === 1 ? 15 : 14, fontWeight: depth === 1 ? 700 : 400 }}>{node.title}</span>
              {sec?.userEdited && <span title="사용자 수정 · 재생성 보호" style={{ display: 'inline-flex', color: '#464c53' }}><Icon name="lock" size={16} /></span>}
              <KBadge tone={statusToTone(st)}>{st}</KBadge>
              {/* 일괄 생성이 돌아가는 동안에는 행별 생성 버튼을 숨긴다 (개별 생성 중에는 다른 절도 추가로 시작할 수 있다) */}
              {!autoAll && !running.has(node.id) && <span onClick={(e) => e.stopPropagation()}><KBtn kind="icon" style={{ width: 28, height: 28 }} ariaLabel={st === '완료' ? (sec?.userEdited ? '강제 재생성' : '이 절 다시 생성') : '이 절 생성'} title={st === '완료' ? (sec?.userEdited ? '강제 재생성' : '이 절 다시 생성') : '이 절 생성'} onClick={() => void draftOne(node.id, !!sec?.userEdited)}><Icon name={st === '완료' ? 'refresh' : 'play'} size={16} /></KBtn></span>}
            </li>); })}
        </ol>
        <div style={{ padding: 12, borderTop: '1px solid #f1f3f5' }}>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={flat.length} aria-valuenow={doneCount} aria-label="초안 생성 진행"><span style={{ width: flat.length ? `${Math.round(doneCount / flat.length * 100)}%` : '0%' }} /></div>
          <p className="form-hint" style={{ marginTop: 6 }}>{flat.length}절 중 {doneCount}절 완료{runningNos.length ? ` · ${runningNos.join(', ')} 생성 중 (동시 ${runningNos.length}절 · T3Q RPT-002, 절당 약 15~20초)` : ''}</p>
        </div>
      </section>

      {/* 초안 영역 */}
      <section style={{ overflow: 'auto', padding: '24px 32px', minHeight: 0 }}>
        <h1 className="sr-only">초안</h1>
        {!current ? (
          <p className="card-desc" style={{ padding: 40, textAlign: 'center' }}>왼쪽 목차에서 [초안 작성하기]를 누르세요. 초안이 하나라도 완성되면 여기서 확인할 수 있습니다.<br /><span className="tiny">T3Q RPT-002가 절 단위로 본문을 생성합니다 (절당 약 15~20초).</span></p>
        ) : (
          <>
            <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 19, fontWeight: 700 }}>{curNode?.no} {curNode?.title}</h2>
              {cur?.provider && (cur.provider === 't3q' ? <KBadge tone="light-success">T3Q</KBadge> : <KBadge tone="light-warning">유니</KBadge>)}
              {curRunning && <KBadge tone="light-primary">생성 중…</KBadge>}
              <div style={{ flex: 1 }} />
              {cur?.sources?.length ? <KBtn size="xs" onClick={() => setShowSources(true)}>근거 {cur.sources.length}</KBtn> : null}
              {cur && !curRunning && (editRaw === null ? <KBtn size="xs" onClick={() => setEditRaw(cur.markdown)}>직접 편집</KBtn> : <><KBtn size="xs" kind="primary" onClick={() => void saveRaw()}>저장</KBtn><KBtn size="xs" onClick={() => setEditRaw(null)}>취소</KBtn></>)}
            </div>
            {editRaw !== null ? <KTextarea value={editRaw} onChange={(e) => setEditRaw(e.target.value)} style={{ minHeight: 480, fontFamily: 'ui-monospace, monospace', fontSize: 13 }} aria-label="마크다운 직접 편집" /> : (
              <div className="doc-body" style={{ fontFamily: tpl?.bodyFontFamily ? `"${tpl.bodyFontFamily}", inherit` : undefined }}>
                {md ? renderMarkdown(md, { paraPrefix: current, onParaClick: curRunning ? undefined : (id, text) => setSelPara({ id, text }), selectedId: selPara?.id, levelStyle, bullets }) : <p className="dim">{curRunning ? 'T3Q가 이 절을 생성하는 중입니다… (절 전체가 한 번에 도착합니다)' : '내용이 없습니다'}</p>}
                {curRunning && <span style={{ display: 'inline-block', width: 8, height: 16, background: '#256ef4', animation: 'blink 1s infinite' }} aria-hidden="true" />}
              </div>
            )}
            <style>{`@keyframes blink{50%{opacity:0}}`}</style>
          </>
        )}
      </section>

      {/* AI 문단 수정 패널 */}
      <aside style={{ borderLeft: '1px solid #cdd1d5', background: '#f4f5f6', padding: 16, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        <div className="row"><span style={{ display: 'inline-flex', color: '#256ef4' }}><Icon name="spark" size={18} /></span><h2 style={{ fontSize: 15, fontWeight: 700 }}>AI 문단 수정</h2><KBadge style={{ marginLeft: 'auto' }}>유니</KBadge></div>
        <p className="form-hint">본문에서 문단·표·목록을 클릭해 선택한 뒤 수정 지시를 입력하세요. 템플릿 스타일 규칙이 함께 전달됩니다.</p>
        {selPara ? (
          <div className="sel-para"><div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><strong>선택된 문단</strong><span className="dim num">{selPara.id.split('#')[1]}</span></div><span className="dim">{selPara.text}</span></div>
        ) : <div style={{ background: '#fff', border: '1px dashed #cdd1d5', borderRadius: 8, padding: 14, fontSize: 13, color: '#464c53', textAlign: 'center' }}>선택된 문단 없음</div>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['더 간결하게', '공문서 문체로', '표로 정리', '수치·근거 보강', '두 문장으로 나눠', '담당 부서 명시'].map((q) => <KBtn key={q} size="xs" onClick={() => setInstruction(q)} disabled={!selPara}>{q}</KBtn>)}
        </div>
        <KField label="수정 지시" htmlFor="inst">
          <KTextarea id="inst" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="예: 취약계층 보호 항목을 표로 정리하고 담당 부서를 명시해줘" disabled={!selPara} style={{ minHeight: 90, fontSize: 14 }} />
        </KField>
        <div className="row">
          <KBtn kind="primary" size="sm" disabled={!selPara || !instruction.trim() || revising} onClick={() => void revise()} style={{ flex: 1 }}>{revising ? '수정 중…' : '수정 요청'}</KBtn>
          {selPara && cur?.history.some((h) => h.paraId === selPara.id) && <KBtn size="sm" onClick={() => void revert()}>원문 복원</KBtn>}
        </div>
        <KAlert kind="information" style={{ fontSize: 13, padding: '10px 12px' }}>수정한 문단이 있는 절은 초안을 다시 생성해도 덮어쓰지 않습니다(목차에 자물쇠 표시). 다시 만들려면 생성이 끝난 뒤 그 절의 다시 생성 버튼을 누르세요.</KAlert>
        {cur?.history.length ? (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>수정 이력 <span className="num dim" style={{ fontWeight: 400 }}>({cur.history.length})</span></h3>
            <div className="stack" style={{ gap: 6 }}>
              {[...cur.history].reverse().slice(0, 8).map((h, i) => <div key={i} className="hist"><div style={{ color: '#256ef4', fontWeight: 700 }}>{h.instruction}</div><div className="dim num">{new Date(h.at).toLocaleTimeString('ko-KR')} · {h.paraId.split('#')[1]} · 유니</div></div>)}
            </div>
          </div>
        ) : null}
      </aside>
      {showSources && cur && (
        <KModal title="AI 생성 근거" onClose={() => setShowSources(false)} width={640}>
          <div className="stack" style={{ gap: 8 }}>{cur.sources.map((s, i) => <div key={i} className="hist" style={{ fontSize: 14 }}><strong>{s.filename}</strong> {s.score ? <KBadge>{Math.round(s.score * 100)}%</KBadge> : null}<div className="dim" style={{ marginTop: 4 }}>{s.text}</div></div>)}</div>
        </KModal>
      )}
    </div>
  );
}

// ── 4. 미리보기·내보내기 (SCR-CADM-404004) ───────────────────────────────
// rhwp의 HTML 렌더(재로드 뷰)는 줄 위치가 어긋나게 나와 2026-08-21 화면에서 뺐다. 실제 모양은 다운로드한 HWPX를 한/글이나 rhwp 에디터에서 확인한다.
function PreviewStep({ plan, tpl, reload, show }: { plan: Plan; tpl: Template | null; reload: () => Promise<Plan>; show: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const bullets = tpl?.levels.map((l) => l.bullet) ?? ['□', 'ㅇ', '-', '*'];
  const md = plan.toc.map((n) => [`# ${n.no} ${n.title}`, plan.sections[n.id]?.markdown ?? '', ...n.children.flatMap((c) => [`## ${c.no} ${c.title}`, plan.sections[c.id]?.markdown ?? ''])].filter(Boolean).join('\n\n')).join('\n\n');
  const exportHwpx = async () => {
    // 저장 위치 창은 클릭 직후에만 열린다 — 서버 생성(10초+)을 기다린 뒤 열면 브라우저가 거부하므로 먼저 묻는다.
    const handle = await pickSaveLocation(`${plan.title}.hwpx`);
    setBusy(true);
    try {
      const r = await post<{ fileName: string; url: string; pages: number }>(`/plans/${plan.id}/export`, {}); await reload();
      if (handle === 'cancelled') show(`HWPX 생성 완료 (${r.pages}쪽) · 저장은 취소됨 — [다운로드]로 받을 수 있습니다`);
      else { const how = await writeFileTo(handle, `/api/files/${r.fileName}`, r.fileName); show(how === 'saved' ? `저장했습니다: ${r.fileName} (${r.pages}쪽)` : `HWPX 생성 완료 (${r.pages}쪽) · 브라우저 다운로드 폴더에 저장`); }
    }
    catch (e) { show((e as Error).message); } finally { setBusy(false); }
  };
  const download = async () => {
    if (!plan.export) return;
    const handle = await pickSaveLocation(plan.export.fileName);
    if (handle === 'cancelled') return;
    try { const how = await writeFileTo(handle, `/api/files/${plan.export.fileName}`, plan.export.fileName); show(how === 'saved' ? `저장했습니다: ${plan.export.fileName}` : '브라우저 다운로드 폴더에 저장했습니다'); }
    catch (e) { show((e as Error).message); }
  };
  const edited = Object.values(plan.sections).filter((s) => s.userEdited).length;
  const sectionCount = Object.values(plan.sections).filter((s) => s.status === '완료').length;
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 24, display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) 360px', gap: 24, alignItems: 'start' }}>
      <div className="stack">
        <div className="row no-print" style={{ flexWrap: 'wrap' }}>
          <H1 code="SCR-CADM-404004">미리보기·내보내기</H1>
          <div style={{ flex: 1 }} />
          <KBtn size="sm" onClick={() => window.print()}><Icon name="print" /> 인쇄</KBtn>
          {plan.export && <KBtn size="sm" onClick={() => void download()} title="저장 위치를 고른 뒤 HWPX를 저장합니다"><Icon name="download" /> 다운로드 ({plan.export.pages}쪽)</KBtn>}
          <KBtn kind="primary" size="sm" disabled={busy} onClick={() => void exportHwpx()}>{busy ? 'HWPX 생성 중…' : plan.export ? 'HWPX 다시 내보내기' : 'HWPX 내보내기'}</KBtn>
        </div>
        {plan.export && <KAlert kind="success">HWPX를 생성했습니다 — <strong>{plan.export.fileName}</strong> ({plan.export.pages}쪽) · {new Date(plan.export.at).toLocaleString('ko-KR')}.{tpl ? ` 템플릿 "${tpl.name}"의 개요 스타일을 수준별로 적용했습니다.` : ''}</KAlert>}
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="row no-print" style={{ padding: '12px 24px', borderBottom: '1px solid #cdd1d5' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>문서 미리보기</h2>
            <span className="form-hint">웹 렌더입니다. 한/글에서의 실제 모양은 내보낸 HWPX 파일이나 [rhwp 에디터에서 열기]로 확인하세요.</span>
          </div>
          <div style={{ background: '#f4f5f6', padding: 32 }}>
            <article className="page" style={{ fontFamily: tpl?.bodyFontFamily ? `"${tpl.bodyFontFamily}", inherit` : undefined }}>
              <h2 style={{ textAlign: 'center', fontSize: 22, fontWeight: 700, marginBottom: 32 }}>{plan.title}</h2>
              <div className="doc-body">{renderMarkdown(md, { bullets, levelStyle: (lv) => { const L = tpl?.levels[lv - 1]; return { fontSize: L?.fontSizePt ? Math.min(20, L.fontSizePt) : 16 - lv, fontWeight: L?.bold ? 800 : 700, marginTop: 14 }; } })}</div>
            </article>
          </div>
        </section>
      </div>
      <aside className="rail">
        <KCard tight title="내보내기 결과" titleAs="h3">
          {plan.export ? (
            <KV items={[
              ['파일', plan.export.fileName],
              ['쪽수', <span className="num">{plan.export.pages}쪽</span>],
              ['생성', <span className="num">{new Date(plan.export.at).toLocaleString('ko-KR')}</span>],
              ['반영', `${sectionCount}절 · 사용자 수정 ${edited}절 보존`],
            ]} />
          ) : <p className="card-desc">아직 내보내지 않았습니다. [HWPX 내보내기]를 누르면 저장 위치를 고른 뒤 생성합니다.</p>}
        </KCard>
        {tpl && (
          <KCard tight title="스타일 매핑" titleAs="h3">
            <KTable compact caption="heading 수준별로 적용되는 템플릿 스타일" head={['수준', '기호', '템플릿 스타일']} rows={tpl.levels.map((l) => [l.level, l.bullet || '·', `${l.styleName ?? '본문 폴백'} · ${l.fontSizePt ?? '?'}pt${l.bold ? ' 굵게' : ''}`])} />
          </KCard>
        )}
      </aside>
    </div>
  );
}
