import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, ago, HAZARDS, type PlanSummary, type PlanTemplate } from '../api';
import { Toast, useToast, useUser } from '../ui';
import { KBadge, KBtn, KCard, KInput, KModal, KSelect, KTable, Pager, SortTh } from '../krds';

const PAGE_SIZES = [30, 50, 70, 100]; // 설계서 302001 "N개 보기" — 기준정보 템플릿 목록과 같은 방식
type SortKey = 'title' | 'hazardType' | 'createdBy' | 'updatedBy' | 'createdAt' | 'updatedAt';
import { EMPTY_DOC, NewDocModal, type NewDocSource } from './NewDocModal';
import { HazardIcon, HeroCards } from './HeroCards';

/** 문서 관리 메인: 히어로 + 기준정보 템플릿 카드(2차년도 홈 화면) + 문서 목록(SCR-CADM-302001) */
export function PlanList() {
  const [user] = useUser();
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [tpls, setTpls] = useState<PlanTemplate[]>([]);
  const [q, setQ] = useState('');
  const [hazard, setHazard] = useState('');
  const [phase, setPhase] = useState('');
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'updatedAt', dir: 'desc' });
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState(false);
  const [fromTpl, setFromTpl] = useState<NewDocSource | null>(null);
  const [toast, show] = useToast();
  const load = () => { get<PlanSummary[]>('/plans').then(setPlans); get<PlanTemplate[]>('/plan-templates').then((l) => setTpls([...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))); };
  useEffect(load, []);
  useEffect(() => { setPage(1); }, [q, hazard, phase, mine, sort, pageSize]);
  const filtered = useMemo(() => {
    const f = plans.filter((p) => (!q || p.title.includes(q)) && (!hazard || p.hazardType === hazard) && (!phase || p.managementPhase === phase) && (!mine || p.createdBy === user?.name));
    const val = (p: PlanSummary): string => sort.key === 'hazardType' ? p.hazardType ?? '' : sort.key === 'updatedBy' ? p.updatedBy ?? p.createdBy : p[sort.key];
    return [...f].sort((a, b) => val(a).localeCompare(val(b), 'ko') * (sort.dir === 'asc' ? 1 : -1));
  }, [plans, q, hazard, phase, mine, sort, user?.name]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'createdAt' || key === 'updatedAt' ? 'desc' : 'asc' }));
  const th = (label: string, key: SortKey) => <SortTh label={label} active={sort.key === key} dir={sort.dir} onClick={() => toggleSort(key)} />;
  const removeChecked = async () => { for (const id of checked) await del(`/plans/${id}?by=${encodeURIComponent(user?.name ?? '')}`); setChecked(new Set()); setConfirmDel(false); show(`${checked.size}개를 휴지통으로 옮겼습니다`); load(); };
  const toggle = (id: string, on: boolean) => { const s = new Set(checked); on ? s.add(id) : s.delete(id); setChecked(s); };
  const progress = (p: PlanSummary) => {
    if (!p.hasToc) return <KBadge>기준정보</KBadge>;
    const tone = p.drafted === p.total && p.total > 0 ? 'light-success' : p.drafted > 0 ? 'light-primary' : 'light-gray';
    return <KBadge tone={tone}>{p.drafted}/{p.total} 초안{p.exported ? ' · 내보냄' : ''}</KBadge>;
  };
  return (
    <>
    <HeroCards tpls={tpls} onNew={() => setFromTpl(EMPTY_DOC)} onPick={(t) => setFromTpl({ id: t.id, name: t.name, context: t.context })} />
    <div className="wrap" style={{ paddingTop: 8, paddingBottom: 24 }}>
      <div className="stack" style={{ gap: 24 }}>
        <KCard title={<>문서 전체 목록 <span className="dim" style={{ fontWeight: 400, fontSize: 15 }}>({filtered.length}/{plans.length})</span></>} right={
          <div className="row">
            <KInput className="search" placeholder="문서 명 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} aria-label="문서 명 검색" />
            <KSelect value={hazard} onChange={(e) => setHazard(e.target.value)} style={{ width: 150 }} aria-label="재난유형"><option value="">재난유형 전체</option>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</KSelect>
            <KSelect value={phase} onChange={(e) => setPhase(e.target.value)} style={{ width: 120 }} aria-label="재난관리단계"><option value="">단계 전체</option><option>예방</option><option>대비</option></KSelect>
            <label className="row" style={{ fontSize: 15, gap: 6, whiteSpace: 'nowrap' }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ width: 18, height: 18 }} /> 내 문서</label>
            <KSelect value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ width: 120 }} aria-label="한 쪽에 보일 개수">{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}개 보기</option>)}</KSelect>
          </div>}>
          {checked.size > 0 && (
            <div className="row" style={{ background: '#eff5ff', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 15 }}>
              <strong>{checked.size}개 선택</strong>
              <KBtn size="xs" kind="danger" onClick={() => setConfirmDel(true)}>삭제</KBtn>
              <KBtn size="xs" onClick={() => setChecked(new Set())}>선택 취소</KBtn>
            </div>
          )}
          <KTable caption="기관의 계획서 문서 목록" widths={['40px', undefined, '10%', '10%', '14%', '8%', '8%', '13%', '9%', '9%']}
            head={[<span className="sr-only">선택</span>, th('문서 명', 'title'), th('재난유형', 'hazardType'), '재난관리단계', '진행', th('생성자', 'createdBy'), th('수정자', 'updatedBy'), th('생성 일시', 'createdAt'), th('수정 일시', 'updatedAt'), '훈련 연동']}
            rows={pageRows.map((p) => [
              <input type="checkbox" aria-label={`${p.title} 선택`} checked={checked.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} style={{ width: 18, height: 18 }} />,
              <Link to={`/plan/${p.id}`} style={{ fontWeight: 700 }}>{p.title}</Link>,
              p.hazardType ? <span className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}><HazardIcon hazard={p.hazardType} size={24} />{p.hazardType}</span> : '-', p.managementPhase ?? '-', progress(p),
              p.createdBy, p.updatedBy ?? p.createdBy,
              <span className="num">{new Date(p.createdAt).toLocaleString('ko-KR')}</span>, <span className="num">{ago(p.updatedAt)}</span>,
              p.linkedExercises.length ? <Link to={`/sit/${p.linkedExercises[p.linkedExercises.length - 1]}`}><KBadge tone="navy">훈련 {p.linkedExercises.length}건</KBadge></Link> : '-',
            ])} />
          <Pager page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} />
        </KCard>
      </div>

      {fromTpl && <NewDocModal source={fromTpl} onClose={() => setFromTpl(null)} />}
      {confirmDel && (
        <KModal title="삭제하기" onClose={() => setConfirmDel(false)}>
          <p style={{ fontSize: 15 }}>선택한 문서 {checked.size}개를 휴지통으로 옮깁니다. 휴지통(문서 관리 메뉴)에서 30일 안에 복원할 수 있습니다.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setConfirmDel(false)}>취소</KBtn><KBtn kind="danger" size="sm" onClick={() => void removeChecked()}>삭제하기</KBtn></div>
        </KModal>
      )}
      <Toast msg={toast} />
    </div>
    </>
  );
}
