import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { post, type Plan } from '../api';
import { Btn, C, Input, Modal, Select, useUser } from '../ui';

/** 상단바(SCR-CADM-101001) + LNB(SCR-CADM-301001) */
export function PlanShell() {
  const [user, setUser, users] = useUser();
  const nav = useNavigate();
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState('');
  const create = async () => {
    const p = await post<Plan>('/plans', { title: title.trim(), createdBy: user?.name ?? '사용자' });
    setNewOpen(false); setTitle(''); nav(`/plan/${p.id}`);
  };
  const navStyle = ({ isActive }: { isActive: boolean }) => ({ display: 'block', padding: '10px 14px', borderRadius: 8, textDecoration: 'none', color: isActive ? '#fff' : '#cbd5e1', background: isActive ? C.blue : 'transparent', fontSize: 13, fontWeight: 600, marginBottom: 4 });
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside style={{ width: 220, background: C.navy, color: '#fff', padding: 16, flexShrink: 0 }}>
        <Link to="/" style={{ color: '#fff', textDecoration: 'none' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 24 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: C.blue, display: 'grid', placeItems: 'center', fontWeight: 900 }}>계</div>
            <div><div style={{ fontWeight: 800, fontSize: 14 }}>재난안전계획서</div><div style={{ fontSize: 11, color: '#94a3b8' }}>문서 생성 도구</div></div>
          </div>
        </Link>
        <Btn kind="primary" onClick={() => setNewOpen(true)} style={{ width: '100%', marginBottom: 16 }}>+ 새 문서 생성</Btn>
        <NavLink to="/plan" end style={navStyle}>문서 관리</NavLink>
        <NavLink to="/plan/templates" style={navStyle}>HWPX 템플릿 · 스타일 분석</NavLink>
        <div style={{ marginTop: 24, borderTop: '1px solid rgba(255,255,255,.15)', paddingTop: 12, fontSize: 11, color: '#94a3b8' }}>
          <div style={{ marginBottom: 6 }}>사용자</div>
          <Select value={user?.id ?? ''} onChange={(e) => { const u = users.find((x) => x.id === e.target.value); if (u) setUser(u); }} style={{ fontSize: 12, padding: '5px 8px' }}>{users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.dept}</option>)}</Select>
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: '#94a3b8' }}><Link to="/sit" style={{ color: '#93c5fd' }}>→ 상황일지 도구</Link></div>
      </aside>
      <main style={{ flex: 1, minWidth: 0 }}>
        <Outlet />
      </main>
      {newOpen && (
        <Modal title="문서 저장" onClose={() => setNewOpen(false)}>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>새 문서 이름을 입력하세요 (최대 20자). 저장 후 기준정보 입력으로 이동합니다.</div>
          <Input autoFocus maxLength={20} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 2026 폭염 대비 계획서" onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) void create(); }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><Btn onClick={() => setNewOpen(false)}>취소</Btn><Btn kind="primary" disabled={!title.trim()} onClick={() => void create()}>저장하기</Btn></div>
        </Modal>
      )}
    </div>
  );
}
