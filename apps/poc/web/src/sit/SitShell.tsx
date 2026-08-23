import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { get, ALERT_COLOR, MODE_LABEL, type Exercise, type Meeting } from '../api';
import { MeetingModal } from './SitMeeting';
import { useUser } from '../ui';
import { AppHeader, Icon, KBadge, KBtn } from '../krds';

/** 상황일지 셸 — KRDS 공통 헤더 + LNB 띠 + 현재 훈련상황 띠 (계획서 셸과 같은 골격) */
export function SitShell() {
  const [user, setUser, users] = useUser();
  const loc = useLocation();
  const m = loc.pathname.match(/^\/sit\/([^/]+)/);
  const exId = m && !['new', 'data', 'manuals', 'settings', 'trash'].includes(m[1]) ? m[1] : null;
  const [ex, setEx] = useState<Exercise | null>(null);
  const [meeting, setMeeting] = useState(false);
  const [tick, setTick] = useState(0); // 회의 저장 뒤 띠 갱신
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (exId) get<Exercise>(`/exercises/${exId}`).then(setEx).catch(() => setEx(null)); else setEx(null); }, [exId, loc.pathname, tick]);
  // 회의 저장 → 띠 갱신 + 열린 화면(SOP 편집 등)에 알림: 단계가 바뀌면 SOP가 그 단계 구간을 자동으로 펼친다
  const onMeetingSaved = (_m: Meeting) => { setMeeting(false); setTick((t) => t + 1); window.dispatchEvent(new CustomEvent('poc:exercise-updated', { detail: exId })); };
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
            {item('/sit', '상황 목록')}
            {item(`/sit/${exId}`, '대시보드', true)}
            {item('/sit/new', '상황 생성')}
            {item(`/sit/${exId}/sop`, 'SOP 생성/편집', true)}
            {item(`/sit/${exId}/dispatch`, '상황/임무 전파', true)}
            {item(`/sit/${exId}/board`, '전자 상황판', true)}
            {item(`/sit/${exId}/reports`, '보고서', true)}
            {item('/sit/manuals', '매뉴얼·SOP 템플릿')}
            {item('/sit/settings', '기관·조직 설정')}
            {item('/sit/trash', '휴지통')}
          </nav>
          <Link to={`/m/${user?.id ?? 'u2'}`} className="k-btn tertiary xs" style={{ marginLeft: 'auto' }} title="현장 담당자 모바일 화면"><Icon name="external" /> 모바일 임무 확인</Link>
        </div>
      </div>
      <div className="band">
        <div className="wrap console" style={{ minHeight: 50, padding: '8px 24px' }}>
          {ex ? <>
            <KBadge tone={ex.mode === '실제상황' ? 'danger' : ex.mode === '도상훈련' ? 'light-gray' : 'light-primary'} title={ex.mode}>{MODE_LABEL[ex.mode ?? '안전한국훈련']}</KBadge>
            <strong style={{ fontSize: 17 }}>{ex.title}</strong>
            <span title="위기경보 — 상황판단회의에서 결정" style={{ background: (ALERT_COLOR[ex.alertLevel] ?? ALERT_COLOR.관심).bg, color: (ALERT_COLOR[ex.alertLevel] ?? ALERT_COLOR.관심).fg, fontWeight: 700, fontSize: 13, padding: '2px 10px', borderRadius: 4 }}>경보 {ex.alertLevel}</span>
            <KBadge tone="light-warning" title="재난대응 단계(징후감지→초기대응→비상1→비상2·3→수습복구)">{ex.stage ?? '초기대응'}</KBadge>
            <KBadge tone="light-primary">훈련단계 {ex.phase}</KBadge>
            <KBadge tone={statusTone}>{ex.status}</KBadge>
            {ex.status !== 'CLOSED' && <KBtn size="xs" kind="secondary" onClick={() => setMeeting(true)} title="위기경보·대응 단계·대피명령·CBS 발송을 결정하고 기록합니다">상황판단회의</KBtn>}
          </> : <span className="dim" style={{ fontSize: 15 }}>상황을 선택하거나 새로 만드세요</span>}
          <div style={{ flex: 1 }} />
          <span className="tiny dim num">{clock.toLocaleString('ko-KR', { hour12: false })}</span>
          <span className="tiny" style={{ color: '#228738', fontWeight: 700 }}>● 자동 저장됨</span>
          <span className="tiny dim">{user?.name} · {user?.dept}</span>
        </div>
      </div>
      <main style={{ flex: 1, minHeight: 0, overflow: 'auto' }}><Outlet /></main>
      {meeting && ex && <MeetingModal ex={ex} onClose={() => setMeeting(false)} onSaved={onMeetingSaved} />}
    </div>
  );
}
