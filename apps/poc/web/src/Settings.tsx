import { NavLink, Outlet } from 'react-router-dom';
import { AppHeader } from './krds';
import { useUser } from './ui';

/** 환경설정 — 상단 헤더 톱니바퀴로 진입. HWPX 템플릿·스타일 분석과 휴지통을 계획서·상황일지 LNB에서 분리(사용자 요청 2026-08-24, 기능 동일) */
export function SettingsShell() {
  const [user, setUser, users] = useUser();
  return (
    <div className="krds">
      <AppHeader active="settings" user={user} users={users} onUser={setUser} />
      <div className="band">
        <div className="wrap band-in">
          <nav className="lnb" aria-label="환경설정 메뉴">
            <NavLink to="/settings" end>HWPX 템플릿 · 스타일 분석</NavLink>
            <NavLink to="/settings/trash">휴지통</NavLink>
          </nav>
        </div>
      </div>
      <main><Outlet /></main>
    </div>
  );
}
