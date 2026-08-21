import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { del, get, post, ago, HAZARDS, type PlanSummary, type PlanContext } from '../api';
import { Btn, C, Card, Chip, Empty, Input, Modal, Select, Table, useToast, Toast, useUser } from '../ui';

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
  return (
    <div style={{ padding: 24 }}>
      <Card title="기준정보 템플릿" right={<span style={{ fontSize: 12, color: C.muted }}>선택한 템플릿의 기준정보로 새 문서를 시작합니다 · 최근 저장 순</span>} style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          <div onClick={() => { setFromTpl({ id: '', name: '빈 문서', context: { subject: '', hazardType: '폭염', managementPhase: '대비', audience: '지자체', templateId: null }, createdBy: '', updatedAt: '' }); setTitle(''); }} style={{ minWidth: 180, height: 120, border: `2px dashed ${C.border}`, borderRadius: 10, display: 'grid', placeItems: 'center', color: C.muted, fontSize: 13, cursor: 'pointer' }}>+ 빈 문서</div>
          {tpls.map((t) => (
            <div key={t.id} onClick={() => { setFromTpl(t); setTitle(''); }} style={{ minWidth: 200, height: 120, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, cursor: 'pointer', background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><Chip tone="blue">{t.context.hazardType}</Chip><Chip>{t.context.managementPhase}</Chip></div>
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 10 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>{t.createdBy} · {ago(t.updatedAt)}</div>
            </div>
          ))}
          {!tpls.length && <Empty>저장된 기준정보 템플릿이 없습니다. 기준정보 입력 화면에서 "템플릿 등록하기"로 만들 수 있습니다.</Empty>}
        </div>
      </Card>

      <Card title={`문서 전체 목록 (${filtered.length}/${plans.length})`} right={
        <div style={{ display: 'flex', gap: 8 }}>
          <Input placeholder="문서 명 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} />
          <Select value={hazard} onChange={(e) => setHazard(e.target.value)} style={{ width: 130 }}><option value="">재난유형 전체</option>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</Select>
          <Select value={phase} onChange={(e) => setPhase(e.target.value)} style={{ width: 110 }}><option value="">단계 전체</option><option>예방</option><option>대비</option></Select>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 내 문서</label>
        </div>}>
        {checked.size > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: C.blueLight, padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
            <b>{checked.size}개 선택</b>
            <Btn small kind="danger" onClick={() => setConfirmDel(true)}>삭제</Btn>
            <Btn small onClick={() => setChecked(new Set())}>선택 취소</Btn>
          </div>
        )}
        <Table head={['', '문서 명', '재난유형', '재난관리 단계', '진행', '생성자', '수정자', '생성 일시', '수정 일시', '훈련 연동']} rows={filtered.map((p) => [
          <input type="checkbox" checked={checked.has(p.id)} onChange={(e) => { const s = new Set(checked); e.target.checked ? s.add(p.id) : s.delete(p.id); setChecked(s); }} />,
          <Link to={`/plan/${p.id}`} style={{ color: C.blue, fontWeight: 700 }}>{p.title}</Link>,
          p.hazardType ?? '-', p.managementPhase ?? '-',
          p.hasToc ? <Chip tone={p.drafted === p.total && p.total > 0 ? 'green' : p.drafted > 0 ? 'blue' : 'gray'}>{p.drafted}/{p.total} 초안{p.exported ? ' · 내보냄' : ''}</Chip> : <Chip>기준정보</Chip>,
          p.createdBy, p.updatedBy ?? p.createdBy, new Date(p.createdAt).toLocaleString('ko-KR'), ago(p.updatedAt),
          p.linkedExercises.length ? <Link to={`/sit/${p.linkedExercises[p.linkedExercises.length - 1]}`}><Chip tone="navy">훈련 {p.linkedExercises.length}건</Chip></Link> : '-',
        ])} />
      </Card>

      {fromTpl && (
        <Modal title="문서 저장" onClose={() => setFromTpl(null)}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>{fromTpl.id ? `템플릿 "${fromTpl.name}"의 기준정보로 시작합니다.` : '빈 문서로 시작합니다.'} 문서 명을 입력하세요 (최대 20자).</div>
          <Input autoFocus maxLength={20} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void createFromTpl(); }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><Btn onClick={() => setFromTpl(null)}>취소</Btn><Btn kind="primary" disabled={!title.trim()} onClick={() => void createFromTpl()}>저장하기</Btn></div>
        </Modal>
      )}
      {confirmDel && (
        <Modal title="삭제하기" onClose={() => setConfirmDel(false)}>
          <div style={{ fontSize: 13 }}>선택한 문서 {checked.size}개를 삭제합니다. 되돌릴 수 없습니다.</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><Btn onClick={() => setConfirmDel(false)}>취소</Btn><Btn kind="danger" onClick={() => void removeChecked()}>삭제하기</Btn></div>
        </Modal>
      )}
      <Toast msg={toast} />
    </div>
  );
}
