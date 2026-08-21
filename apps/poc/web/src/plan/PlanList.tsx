import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { del, get, post, ago, HAZARDS, type PlanSummary, type PlanContext } from '../api';
import { Toast, useToast, useUser } from '../ui';
import { Icon, KBadge, KBtn, KCard, KField, KInput, KModal, KSelect, KTable } from '../krds';

interface PlanTpl { id: string; name: string; context: PlanContext; createdBy: string; updatedAt: string }

/** 문서 관리 목록(SCR-CADM-302001) + 기준정보 템플릿 썸네일(SCR-CADM-201001) */
export function PlanList() {
  const [user] = useUser();
  const nav = useNavigate();
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [tpls, setTpls] = useState<PlanTpl[]>([]);
  const [q, setQ] = useState('');
  const [hazard, setHazard] = useState('');
  const [phase, setPhase] = useState('');
  const [mine, setMine] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState(false);
  const [fromTpl, setFromTpl] = useState<PlanTpl | null>(null);
  const [title, setTitle] = useState('');
  const [toast, show] = useToast();
  const load = () => { get<PlanSummary[]>('/plans').then(setPlans); get<PlanTpl[]>('/plan-templates').then(setTpls); };
  useEffect(load, []);
  const filtered = plans.filter((p) => (!q || p.title.includes(q)) && (!hazard || p.hazardType === hazard) && (!phase || p.managementPhase === phase) && (!mine || p.createdBy === user?.name));
  const createFromTpl = async () => {
    if (!fromTpl) return;
    const p = await post<{ id: string }>('/plans', { title: title.trim(), createdBy: user?.name });
    await fetch(`/api/plans/${p.id}/context`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fromTpl.context) });
    setFromTpl(null); nav(`/plan/${p.id}`);
  };
  const removeChecked = async () => { for (const id of checked) await del(`/plans/${id}`); setChecked(new Set()); setConfirmDel(false); show('삭제되었습니다'); load(); };
  const toggle = (id: string, on: boolean) => { const s = new Set(checked); on ? s.add(id) : s.delete(id); setChecked(s); };
  const progress = (p: PlanSummary) => {
    if (!p.hasToc) return <KBadge>기준정보</KBadge>;
    const tone = p.drafted === p.total && p.total > 0 ? 'light-success' : p.drafted > 0 ? 'light-primary' : 'light-gray';
    return <KBadge tone={tone}>{p.drafted}/{p.total} 초안{p.exported ? ' · 내보냄' : ''}</KBadge>;
  };
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 24 }}>
      <h1 className="sr-only">문서 관리</h1>
      <div className="stack" style={{ gap: 24 }}>
        <KCard title="기준정보 템플릿" desc="선택한 템플릿의 기준정보로 새 문서를 시작합니다 · 최근 저장 순">
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
            <button type="button" className="tpl-new" onClick={() => { setFromTpl({ id: '', name: '빈 문서', context: { subject: '', hazardType: '폭염', managementPhase: '대비', audience: '지자체', templateId: null }, createdBy: '', updatedAt: '' }); setTitle(''); }}><Icon name="plus" size={20} />빈 문서</button>
            {tpls.map((t) => (
              <button type="button" key={t.id} className="tpl-card" style={{ minWidth: 240 }} onClick={() => { setFromTpl(t); setTitle(''); }}>
                <span className="row" style={{ justifyContent: 'space-between' }}><KBadge tone="light-primary">{t.context.hazardType}</KBadge><KBadge>{t.context.managementPhase}</KBadge></span>
                <strong>{t.name}</strong>
                <span className="meta">{t.createdBy} · {ago(t.updatedAt)}</span>
              </button>
            ))}
            {!tpls.length && <p className="card-desc" style={{ alignSelf: 'center', padding: '0 8px' }}>저장된 기준정보 템플릿이 없습니다. 기준정보 입력 화면에서 "템플릿 등록하기"로 만들 수 있습니다.</p>}
          </div>
        </KCard>

        <KCard title={<>문서 전체 목록 <span className="dim" style={{ fontWeight: 400, fontSize: 15 }}>({filtered.length}/{plans.length})</span></>} right={
          <div className="row">
            <KInput className="search" placeholder="문서 명 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} aria-label="문서 명 검색" />
            <KSelect value={hazard} onChange={(e) => setHazard(e.target.value)} style={{ width: 150 }} aria-label="재난유형"><option value="">재난유형 전체</option>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</KSelect>
            <KSelect value={phase} onChange={(e) => setPhase(e.target.value)} style={{ width: 120 }} aria-label="재난관리단계"><option value="">단계 전체</option><option>예방</option><option>대비</option></KSelect>
            <label className="row" style={{ fontSize: 15, gap: 6, whiteSpace: 'nowrap' }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ width: 18, height: 18 }} /> 내 문서</label>
          </div>}>
          {checked.size > 0 && (
            <div className="row" style={{ background: '#eff5ff', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 15 }}>
              <strong>{checked.size}개 선택</strong>
              <KBtn size="xs" kind="danger" onClick={() => setConfirmDel(true)}>삭제</KBtn>
              <KBtn size="xs" onClick={() => setChecked(new Set())}>선택 취소</KBtn>
            </div>
          )}
          <KTable caption="기관의 계획서 문서 목록" widths={['40px', undefined, '10%', '10%', '14%', '8%', '8%', '13%', '9%', '9%']}
            head={[<span className="sr-only">선택</span>, '문서 명', '재난유형', '재난관리단계', '진행', '생성자', '수정자', '생성 일시', '수정 일시', '훈련 연동']}
            rows={filtered.map((p) => [
              <input type="checkbox" aria-label={`${p.title} 선택`} checked={checked.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} style={{ width: 18, height: 18 }} />,
              <Link to={`/plan/${p.id}`} style={{ fontWeight: 700 }}>{p.title}</Link>,
              p.hazardType ?? '-', p.managementPhase ?? '-', progress(p),
              p.createdBy, p.updatedBy ?? p.createdBy,
              <span className="num">{new Date(p.createdAt).toLocaleString('ko-KR')}</span>, <span className="num">{ago(p.updatedAt)}</span>,
              p.linkedExercises.length ? <Link to={`/sit/${p.linkedExercises[p.linkedExercises.length - 1]}`}><KBadge tone="navy">훈련 {p.linkedExercises.length}건</KBadge></Link> : '-',
            ])} />
        </KCard>
      </div>

      {fromTpl && (
        <KModal title="문서 저장" onClose={() => setFromTpl(null)} desc={<>{fromTpl.id ? `템플릿 "${fromTpl.name}"의 기준정보로 시작합니다.` : '빈 문서로 시작합니다.'} 문서 명을 입력하세요 (최대 20자).</>}>
          <KField label="문서 명" required htmlFor="tpl-title" hint="저장 후 기준정보 입력 화면으로 이동합니다.">
            <KInput id="tpl-title" autoFocus maxLength={20} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void createFromTpl(); }} />
          </KField>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setFromTpl(null)}>취소</KBtn><KBtn kind="primary" size="sm" disabled={!title.trim()} onClick={() => void createFromTpl()}>저장하기</KBtn></div>
        </KModal>
      )}
      {confirmDel && (
        <KModal title="삭제하기" onClose={() => setConfirmDel(false)}>
          <p style={{ fontSize: 15 }}>선택한 문서 {checked.size}개를 삭제합니다. 되돌릴 수 없습니다.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setConfirmDel(false)}>취소</KBtn><KBtn kind="danger" size="sm" onClick={() => void removeChecked()}>삭제하기</KBtn></div>
        </KModal>
      )}
      <Toast msg={toast} />
    </div>
  );
}
