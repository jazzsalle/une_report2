import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { del, get, ago, HAZARDS, type Exercise, type PlanSummary } from '../api';
import { Toast, useToast, useUser } from '../ui';
import { KBadge, KBtn, KCard, KInput, KModal, KSelect, KTable, Pager, SortTh, type Tone } from '../krds';
import { HazardIcon, HeroBand, HeroCard, HeroNewCard } from '../plan/HeroCards';
import { WarningsCard } from '../WeatherCard';

const PAGE_SIZES = [30, 50, 70, 100];
type SortKey = 'title' | 'hazardType' | 'status' | 'createdBy' | 'createdAt' | 'updatedAt';
export const EX_STATUS: Record<Exercise['status'], { label: string; tone: Tone; dot: string }> = {
  DRAFT: { label: '작성 중', tone: 'light-gray', dot: '#8a949e' },
  SOP_READY: { label: 'SOP 준비', tone: 'light-primary', dot: '#256ef4' },
  RUNNING: { label: '훈련 진행', tone: 'light-success', dot: '#37b44a' },
  CLOSED: { label: '종료', tone: 'gray', dot: '#464c53' },
};

/** 상황일지 메인 — 계획서 메인과 같은 히어로(새 훈련상황 + 최근 훈련상황 카드) + 훈련상황 전체 목록 + 계획서 연동 시작 (2026-08-22) */
export function SitHome() {
  const nav = useNavigate();
  const [user] = useUser();
  const [list, setList] = useState<Exercise[]>([]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [q, setQ] = useState('');
  const [hazard, setHazard] = useState('');
  const [status, setStatus] = useState<'' | Exercise['status']>('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'updatedAt', dir: 'desc' });
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState<Exercise[] | null>(null);
  const [toast, show] = useToast();
  const load = () => { get<Exercise[]>('/exercises').then(setList); get<PlanSummary[]>('/plans').then((p) => setPlans(p.filter((x) => x.hasToc))); };
  useEffect(load, []);
  useEffect(() => { setPage(1); }, [q, hazard, status, sort, pageSize]);
  const filtered = useMemo(() => {
    const f = list.filter((e) => (!q || e.title.includes(q)) && (!hazard || e.hazardType === hazard) && (!status || e.status === status));
    const val = (e: Exercise): string => e[sort.key] ?? '';
    return [...f].sort((a, b) => val(a).localeCompare(val(b), 'ko') * (sort.dir === 'asc' ? 1 : -1));
  }, [list, q, hazard, status, sort]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'createdAt' || key === 'updatedAt' ? 'desc' : 'asc' }));
  const th = (label: string, key: SortKey) => <SortTh label={label} active={sort.key === key} dir={sort.dir} onClick={() => toggleSort(key)} />;
  const toggle = (id: string, on: boolean) => { const s = new Set(checked); on ? s.add(id) : s.delete(id); setChecked(s); };
  const remove = async (targets: Exercise[]) => { for (const e of targets) await del(`/exercises/${e.id}?by=${encodeURIComponent(user?.name ?? '')}`); setChecked(new Set()); setConfirmDel(null); show(`${targets.length}개를 휴지통으로 옮겼습니다`); load(); };
  const recent = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);
  return (
    <>
      <HeroBand title="훈련상황을 만들고 상황일지까지 한 번에 진행해보세요!" moreTo="/sit/new" moreLabel="훈련상황 생성">
        <HeroNewCard label="새 훈련상황 생성" onClick={() => nav('/sit/new')} />
        {recent.map((e) => {
          const st = EX_STATUS[e.status] ?? EX_STATUS.DRAFT;
          return <HeroCard key={e.id} hazard={e.hazardType} title={e.title} rowLabel={`상황단계 ${e.alertLevel}`} rowValue={st.label} rowDot={st.dot} foot={[e.createdBy, ago(e.updatedAt)]} onClick={() => nav(`/sit/${e.id}`)} titleAttr={`${e.title} — 대시보드 열기`} />;
        })}
        {!list.length && <p className="hero-empty">훈련상황이 없습니다. [새 훈련상황 생성]으로 시작하거나, 아래에서 계획서로 훈련을 시작할 수 있습니다.</p>}
      </HeroBand>
      <div className="wrap" style={{ paddingTop: 8, paddingBottom: 24 }}>
        <div className="stack" style={{ gap: 24 }}>
          <WarningsCard />
          <KCard title={<>훈련상황 전체 목록 <span className="dim" style={{ fontWeight: 400, fontSize: 15 }}>({filtered.length}/{list.length})</span></>} right={
            <div className="row">
              <KInput className="search" placeholder="훈련명 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} aria-label="훈련명 검색" />
              <KSelect value={hazard} onChange={(e) => setHazard(e.target.value)} style={{ width: 150 }} aria-label="재난유형"><option value="">재난유형 전체</option>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</KSelect>
              <KSelect value={status} onChange={(e) => setStatus(e.target.value as '' | Exercise['status'])} style={{ width: 130 }} aria-label="상태"><option value="">상태 전체</option>{(Object.keys(EX_STATUS) as Exercise['status'][]).map((k) => <option key={k} value={k}>{EX_STATUS[k].label}</option>)}</KSelect>
              <KSelect value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ width: 120 }} aria-label="한 쪽에 보일 개수">{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}개 보기</option>)}</KSelect>
            </div>}>
            {checked.size > 0 && (
              <div className="row" style={{ background: '#eff5ff', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 15 }}>
                <strong>{checked.size}개 선택</strong>
                <KBtn size="xs" kind="danger" onClick={() => setConfirmDel(list.filter((e) => checked.has(e.id)))}>삭제</KBtn>
                <KBtn size="xs" onClick={() => setChecked(new Set())}>선택 취소</KBtn>
              </div>
            )}
            <KTable caption="훈련상황 목록" widths={['40px', undefined, '13%', '9%', '9%', '10%', '8%', '12%', '9%', '12%']} emptyText="훈련상황이 없습니다. [새 훈련상황 생성]으로 시작하세요."
              head={[<span className="sr-only">선택</span>, th('훈련명', 'title'), th('재난유형', 'hazardType'), '상황단계', '훈련단계', th('상태', 'status'), th('생성자', 'createdBy'), th('생성 일시', 'createdAt'), th('수정 일시', 'updatedAt'), '연동 계획서']}
              rows={pageRows.map((e) => {
                const st = EX_STATUS[e.status] ?? EX_STATUS.DRAFT; const lp = plans.find((p) => p.id === e.linkedPlanId);
                return [
                  <input type="checkbox" aria-label={`${e.title} 선택`} checked={checked.has(e.id)} onChange={(ev) => toggle(e.id, ev.target.checked)} style={{ width: 18, height: 18 }} />,
                  <Link to={`/sit/${e.id}`} style={{ fontWeight: 700 }}>{e.title}</Link>,
                  <span className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}><HazardIcon hazard={e.hazardType} size={24} />{e.hazardType}</span>,
                  e.alertLevel, e.phase, <KBadge tone={st.tone}>{st.label}</KBadge>, e.createdBy,
                  <span className="num">{new Date(e.createdAt).toLocaleString('ko-KR')}</span>, <span className="num">{ago(e.updatedAt)}</span>,
                  lp ? <Link to={`/plan/${lp.id}`}><KBadge tone="navy">{lp.title}</KBadge></Link> : e.linkedPlanId ? <span className="dim">(삭제됨)</span> : '-',
                ];
              })} />
            <Pager page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} />
          </KCard>
          {plans.length > 0 && (
            <KCard title="계획서에서 훈련 시작 (연동)" desc="계획서의 대응 체계·SOP 절을 훈련 시나리오와 SOP 생성 근거로 가져옵니다.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 8 }}>
                {plans.map((p) => <div key={p.id} className="row" style={{ border: '1px solid #cdd1d5', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}><HazardIcon hazard={p.hazardType} size={24} /><b style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</b><Link to={`/sit/new?planId=${p.id}`} className="k-btn tertiary xs">이 계획서로 훈련 시작 →</Link></div>)}
              </div>
            </KCard>
          )}
        </div>
      </div>
      {confirmDel && (
        <KModal title="삭제하기" onClose={() => setConfirmDel(null)}>
          <p style={{ fontSize: 15 }}>선택한 훈련상황 {confirmDel.length}개를 휴지통으로 옮깁니다. 휴지통에서 30일 안에 복원할 수 있습니다.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setConfirmDel(null)}>취소</KBtn><KBtn kind="danger" size="sm" onClick={() => void remove(confirmDel)}>삭제하기</KBtn></div>
        </KModal>
      )}
      <Toast msg={toast} />
    </>
  );
}
