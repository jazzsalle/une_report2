import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { get, type Exercise } from '../api';
import { useUser } from '../ui';
import { AppHeader, Icon, KBadge } from '../krds';

/** 상황일지 셸 — KRDS 공통 헤더 + LNB 띠 + 현재 훈련상황 띠 (계획서 셸과 같은 골격) */
export function SitShell() {
  const [user, setUser, users] = useUser();
  const loc = useLocation();
  const m = loc.pathname.match(/^\/sit\/([^/]+)/);
  const exId = m && !['new', 'data', 'settings', 'trash'].includes(m[1]) ? m[1] : null;
  const [ex, setEx] = useState<Exercise | null>(null);
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (exId) get<Exercise>(`/exercises/${exId}`).then(setEx).catch(() => setEx(null)); else setEx(null); }, [exId, loc.pathname]);
  const item = (to: string, label: string, needEx = false) => needEx && !exId
    ? <span key={label} className="lnb-disabled" title="훈련상황을 먼저 선택하세요">{label}</span>
    : <NavLink key={label} to={to} end={to === '/sit' || to === `/sit/${exId}`}>{label}</NavLink>;
  const statusTone = ex?.status === 'RUNNING' ? 'light-success' : ex?.status === 'CLOSED' ? 'light-gray' : 'light-primary';
  return (
    <div className="krds" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppHeader active="sit" user={user} users={users} onUser={setUser} />
      <div className="band">
        <div className="wrap band-in">
          <nav className="lnb" aria-label="상황일지 메뉴">
            {item('/sit', '훈련상황 목록')}
            {item(`/sit/${exId}`, '대시보드', true)}
            {item('/sit/new', '훈련상황 생성')}
            {item(`/sit/${exId}/sop`, 'SOP 생성/편집', true)}
            {item(`/sit/${exId}/dispatch`, '상황/임무 전파', true)}
            {item(`/sit/${exId}/board`, '전자 상황판', true)}
            {item(`/sit/${exId}/journal`, '상황일지 관리', true)}
            {item('/sit/data', '연계 데이터')}
            {item('/sit/settings', '환경설정')}
            {item('/sit/trash', '휴지통')}
          </nav>
          <Link to={`/m/${user?.id ?? 'u2'}`} className="k-btn tertiary xs" style={{ marginLeft: 'auto' }} title="현장 담당자 모바일 화면"><Icon name="external" /> 모바일 임무 확인</Link>
        </div>
      </div>
      <div className="band">
        <div className="wrap console" style={{ minHeight: 50, padding: '8px 24px' }}>
          {ex ? <>
            <strong style={{ fontSize: 17 }}>{ex.title}</strong>
            <KBadge tone="light-warning">상황단계 {ex.alertLevel}</KBadge>
            <KBadge tone="light-primary">훈련단계 {ex.phase}</KBadge>
            <KBadge tone={statusTone}>{ex.status}</KBadge>
          </> : <span className="dim" style={{ fontSize: 15 }}>훈련상황을 선택하거나 새로 만드세요</span>}
          <div style={{ flex: 1 }} />
          <span className="tiny dim num">{clock.toLocaleString('ko-KR', { hour12: false })}</span>
          <span className="tiny" style={{ color: '#228738', fontWeight: 700 }}>● 자동 저장됨</span>
          <span className="tiny dim">{user?.name} · {user?.dept}</span>
        </div>
      </div>
      <main style={{ flex: 1, minHeight: 0, overflow: 'auto' }}><Outlet /></main>
    </div>
  );
}
