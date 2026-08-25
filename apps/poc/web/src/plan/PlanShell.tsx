import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { post, type Plan } from '../api';
import { useUser } from '../ui';
import { AppHeader, Icon, KBtn, KField, KInput, KModal } from '../krds';

/** 공통 헤더(GNB) + 계획서 LNB — KRDS 업무시스템형 골격(design_handoff_krds_uiux/poc-plan). 화면설계서 SCR-CADM-101001 / 301001 */
export function PlanShell() {
  const [user, setUser, users] = useUser();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const create = async () => {
    const p = await post<Plan>('/plans', { title: title.trim(), createdBy: user?.name ?? '사용자' });
    setNewOpen(false); setTitle(''); nav(`/plan/${p.id}`);
  };
  // 문서 작업 화면(/plan/:id)은 자체 작업 콘솔 띠를 그리므로 LNB는 목록·템플릿 화면에서만
  const showLnb = pathname === '/plan' || pathname.startsWith('/plan/basis-templates'); // 템플릿·휴지통은 환경설정으로 이동(2026-08-24)
  return (
    <div className="krds">
      <AppHeader active="plan" user={user} users={users} onUser={setUser} />
      {showLnb && (
        <div className="band">
          <div className="wrap band-in">
            <nav className="lnb" aria-label="계획서 메뉴">
              <NavLink to="/plan" end>문서 관리</NavLink>
              <NavLink to="/plan/basis-templates">기준정보 템플릿</NavLink>
            </nav>
            <KBtn kind="primary" size="sm" style={{ marginLeft: 'auto' }} onClick={() => setNewOpen(true)}><Icon name="plus" /> 새 문서 생성</KBtn>
          </div>
        </div>
      )}
      <main><Outlet /></main>
      {newOpen && (
        <KModal title="문서 저장" onClose={() => setNewOpen(false)} desc="새 문서 이름을 입력하세요 (최대 20자). 저장 후 기준정보 입력으로 이동합니다.">
          <KField label="문서 명" required htmlFor="new-title">
            <KInput id="new-title" autoFocus maxLength={20} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 2026 폭염 대비 계획서" onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void create(); }} />
          </KField>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setNewOpen(false)}>취소</KBtn><KBtn kind="primary" size="sm" disabled={!title.trim()} onClick={() => void create()}>저장하기</KBtn></div>
        </KModal>
      )}
    </div>
  );
}
