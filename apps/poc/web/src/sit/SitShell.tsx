import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { get, type Exercise } from '../api';
import { C, Chip, Select, useUser } from '../ui';

/** 상황일지 셸 — 기획 화면 공통 사이드바 + 상단 상태 바 */
export function SitShell() {
  const [user, setUser, users] = useUser();
  const loc = useLocation();
  const m = loc.pathname.match(/^\/sit\/([^/]+)/);
  const exId = m && !['new', 'data', 'settings'].includes(m[1]) ? m[1] : null;
  const [ex, setEx] = useState<Exercise | null>(null);
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (exId) get<Exercise>(`/exercises/${exId}`).then(setEx).catch(() => setEx(null)); else setEx(null); }, [exId, loc.pathname]);
  const navStyle = ({ isActive }: { isActive: boolean }) => ({ display: 'block', padding: '9px 14px', borderRadius: 8, textDecoration: 'none', color: isActive ? '#fff' : '#cbd5e1', background: isActive ? C.blue : 'transparent', fontSize: 13, fontWeight: 600, marginBottom: 3 });
  const disabledStyle = { display: 'block', padding: '9px 14px', color: '#64748b', fontSize: 13, fontWeight: 600, marginBottom: 3 };
  const item = (to: string, label: string, needEx = false) => needEx && !exId ? <div key={label} style={disabledStyle} title="훈련상황을 먼저 선택하세요">{label}</div> : <NavLink key={label} to={to} end={to === '/sit'} style={navStyle}>{label}</NavLink>;
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 210, background: C.navy, color: '#fff', padding: 14, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <Link to="/" style={{ color: '#fff', textDecoration: 'none' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: C.blue, display: 'grid', placeItems: 'center', fontWeight: 900 }}>일지</div>
            <div><div style={{ fontWeight: 800, fontSize: 14 }}>상황일지 생성도구</div><div style={{ fontSize: 11, color: '#94a3b8' }}>재난관리 업무지원 서비스</div></div>
          </div>
        </Link>
        {item(exId ? `/sit/${exId}` : '/sit', '◈ 대시보드')}
        {item('/sit/new', '＋ 훈련상황 생성')}
        {item(`/sit/${exId}/sop`, '⛁ SOP 생성/편집', true)}
        {item(`/sit/${exId}/dispatch`, '📣 상황/임무 전파', true)}
        {item(`/sit/${exId}/board`, '▦ 전자 상황판', true)}
        {item(`/sit/${exId}/journal`, '📄 상황일지 관리', true)}
        {item('/sit/data', '⇄ 연계 데이터 조회')}
        {item('/sit/settings', '⚙ 환경설정')}
        <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,.15)', paddingTop: 10, fontSize: 11, color: '#94a3b8' }}>현장 담당자 화면</div>
        <Link to={`/m/${user?.id ?? 'u2'}`} style={{ ...disabledStyle, color: '#93c5fd', textDecoration: 'none' }}>▤ 모바일 임무 확인</Link>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>사용자</div>
        <Select value={user?.id ?? ''} onChange={(e) => { const u = users.find((x) => x.id === e.target.value); if (u) setUser(u); }} style={{ fontSize: 12, padding: '5px 8px' }}>{users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.dept}</option>)}</Select>
        <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8' }}><Link to="/plan" style={{ color: '#93c5fd' }}>→ 계획서 도구</Link></div>
        <p style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5, marginTop: 10 }}>훈련상황 대응 절차와 현장 임무 수행 결과를 시간순으로 자동 기록하여 안전한국훈련 상황일지 작성을 지원합니다.</p>
      </aside>
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: '#fff', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}>
          {ex ? <><b style={{ fontSize: 15 }}>{ex.title}</b><Chip tone="orange">상황단계 {ex.alertLevel}</Chip><Chip tone="blue">훈련단계 {ex.phase}</Chip><Chip tone={ex.status === 'RUNNING' ? 'green' : ex.status === 'CLOSED' ? 'gray' : 'purple'}>{ex.status}</Chip></> : <b style={{ fontSize: 15, color: C.muted }}>훈련상황을 선택하거나 새로 만드세요</b>}
          <div style={{ flex: 1 }} />
          <span style={{ color: C.muted }}>{clock.toLocaleString('ko-KR', { hour12: false })}</span>
          <span style={{ color: C.green, fontWeight: 700 }}>● 자동 저장됨</span>
          <span style={{ color: C.muted }}>{user?.name} · {user?.dept}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}><Outlet /></div>
      </main>
    </div>
  );
}
