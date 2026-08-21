import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, post, fmtTime, fmtDate, type Board, type Event, type Exercise, type PlanSummary } from '../api';
import { Btn, C, Card, Chip, Empty, Stat, Table, Toast, statusTone, useToast } from '../ui';

const FLOW = ['T3Q·유니 연계', '훈련상황 생성', 'SOP 생성/편집', '임무 전파', '현장 확인', '상황내역 자동 기록', '상황일지 생성'];

export function SitDashboard() {
  const { id } = useParams();
  const nav = useNavigate();
  const [list, setList] = useState<Exercise[]>([]);
  const [board, setBoard] = useState<Board | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [toast, show] = useToast();
  useEffect(() => { get<Exercise[]>('/exercises').then((l) => { setList(l); if (!id && l.length) nav(`/sit/${l[0].id}`, { replace: true }); }); get<PlanSummary[]>('/plans').then((p) => setPlans(p.filter((x) => x.hasToc))); }, [id]);
  useEffect(() => { if (!id) return; const load = () => { get<Board>(`/exercises/${id}/board`).then(setBoard).catch(() => setBoard(null)); get<Event[]>(`/exercises/${id}/events`).then(setEvents).catch(() => {}); }; load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [id]);
  const analyze = async () => { setAnalyzing(true); try { await post(`/exercises/${id}/analyze`, {}); const b = await get<Board>(`/exercises/${id}/board`); setBoard(b); } finally { setAnalyzing(false); } };
  if (!id || !board) return (
    <div style={{ padding: 24 }}>
      <Card title="훈련상황 목록" right={<div style={{ display: 'flex', gap: 6 }}><Link to="/sit/new"><Btn small kind="primary">+ 훈련상황 생성</Btn></Link></div>}>
        {list.length ? <Table head={['훈련명', '재난유형', '상황단계', '상태', '생성', '']} rows={list.map((e) => [<Link to={`/sit/${e.id}`} style={{ fontWeight: 700, color: C.blue }}>{e.title}</Link>, e.hazardType, e.alertLevel, <Chip tone={e.status === 'RUNNING' ? 'green' : e.status === 'CLOSED' ? 'gray' : 'purple'}>{e.status}</Chip>, fmtDate(e.createdAt), <Btn small kind="danger" onClick={async () => { if (confirm('삭제할까요?')) { await fetch(`/api/exercises/${e.id}`, { method: 'DELETE' }); setList(list.filter((x) => x.id !== e.id)); } }}>삭제</Btn>])} /> : <Empty>훈련상황이 없습니다. [훈련상황 생성]으로 시작하거나, 계획서에서 훈련을 시작할 수 있습니다.</Empty>}
      </Card>
      {plans.length > 0 && <Card title="계획서에서 훈련 시작 (연동)" style={{ marginTop: 16 }}><div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>계획서의 대응 체계·SOP 절을 훈련 시나리오와 SOP 생성 근거로 가져옵니다.</div>{plans.map((p) => <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 13 }}><b style={{ flex: 1 }}>{p.title}</b><Chip tone="blue">{p.hazardType}</Chip><Link to={`/sit/new?planId=${p.id}`}><Btn small>이 계획서로 훈련 시작 →</Btn></Link></div>)}</Card>}
      <Toast msg={toast} />
    </div>
  );
  const ex = board.exercise;
  const pct = board.total ? Math.round((board.done / board.total) * 100) : 0;
  const stepIdx = ex.status === 'DRAFT' ? 1 : ex.status === 'SOP_READY' ? 2 : ex.status === 'RUNNING' ? (board.reported ? 5 : board.dispatched || board.acked ? 4 : 3) : 6;
  const donut = (p: number) => { const r = 34, c = 2 * Math.PI * r; return <svg width={90} height={90}><circle cx={45} cy={45} r={r} stroke="#e5e7eb" strokeWidth={12} fill="none" /><circle cx={45} cy={45} r={r} stroke={C.green} strokeWidth={12} fill="none" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 45 45)" /><text x={45} y={50} textAnchor="middle" fontSize={16} fontWeight={800}>{p}%</text></svg>; };
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {FLOW.map((f, i) => <span key={f} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: i === stepIdx ? C.navy : i < stepIdx ? C.blueLight : '#fff', color: i === stepIdx ? '#fff' : i < stepIdx ? C.blue : C.muted, border: `1px solid ${i <= stepIdx ? C.blue : C.border}` }}>{f}</span>{i < FLOW.length - 1 && <span style={{ color: C.muted }}>→</span>}</span>)}
        <div style={{ flex: 1 }} />
        <select value={id} onChange={(e) => nav(`/sit/${e.target.value}`)} style={{ padding: 6, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12 }}>{list.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
        <Link to="/sit/new"><Btn small>+ 새 훈련</Btn></Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        <Card title="훈련상황"><div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{ex.hazardType}</div><div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>발생위치 {ex.location || '-'}<br />발생일시 {fmtDate(ex.occurredAt)}<br />훈련기관 {ex.agency || '-'}</div></Card>
        <Card title={`SOP 진행률 · 전체 ${board.total}건`}><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div style={{ fontSize: 12, lineHeight: 2 }}><span style={{ color: C.green }}>●</span> 완료 {board.done} &nbsp; <span style={{ color: C.blue }}>●</span> 진행중 {board.inProgress}<br /><span style={{ color: C.orange }}>●</span> 지연 {board.delayed} &nbsp; <span style={{ color: C.gray }}>●</span> 대기 {board.waiting + board.dispatched}</div>{donut(pct)}</div></Card>
        <Card title="임무 전파 현황"><Stat label="" value={<span>{board.acked} <span style={{ fontSize: 14, color: C.muted, fontWeight: 400 }}>/ {board.total}명 수신 확인</span></span>} /><div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, margin: '8px 0' }}><div style={{ width: `${board.total ? (board.acked / board.total) * 100 : 0}%`, height: 6, background: C.blue, borderRadius: 3 }} /></div><div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}><span style={{ color: C.red, fontWeight: 700 }}>미확인 {board.unacked}명</span><span style={{ color: C.muted }}>보고 {board.reported}건</span></div></Card>
        <Card title="상황일지 자동 기록"><Stat label="" value={<span>{board.autoLogged} <span style={{ fontSize: 14, color: C.muted, fontWeight: 400 }}>건 자동 기록</span></span>} /><div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}><Chip tone="blue">AI 초안 {board.aiCount}</Chip><Chip tone="purple">검토 필요 {board.unacked + board.delayed}</Chip><Chip tone="green">최종 반영 {board.done}</Chip></div></Card>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12 }}>
        <Card title={<span>진행 중인 SOP 임무 현황 <Chip tone="blue">실시간</Chip></span>} right={<Link to={`/sit/${id}/dispatch`}><Btn small>전체 보기</Btn></Link>}>
          <Table small head={['순번', '임무명', '담당부서 / 담당자', '완료기한', '상태']} rows={board.active.map((t) => [String(t.seq).padStart(2, '0'), t.title, `${t.dept} / ${t.assigneeName}`, fmtTime(t.due), <Chip tone={statusTone(t.status)}>{t.status}</Chip>])} />
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card title={<span>✦ AI 상황분석 제안 <Chip tone="purple">AI 생성</Chip></span>} style={{ background: C.navy, color: '#fff' }}>
            {board.analysis ? <><div style={{ fontSize: 13, lineHeight: 1.7 }}>{board.analysis.suggestion}</div><div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 6 }}>근거: {board.analysis.basis || '-'} · {fmtTime(board.analysis.at)}</div></> : <div style={{ fontSize: 12, color: '#cbd5e1' }}>상황판 요약을 유니에게 보내 조치 제안을 받습니다.</div>}
            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}><Btn small kind="primary" onClick={() => void analyze()} disabled={analyzing}>{analyzing ? '분석 중…' : board.analysis ? '다시 분석' : '상황 분석'}</Btn>{board.analysis && <Link to={`/sit/${id}/journal`}><Btn small>상황일지에 반영</Btn></Link>}<Link to={`/sit/${id}/sop`}><Btn small>SOP 추가 생성</Btn></Link></div>
          </Card>
          <Card title="⚠ 주의 알림" style={{ background: C.orangeBg, border: '1px solid #fcd34d' }} pad={12}>
            <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>{board.delayed ? <div>· 완료기한 초과 임무 <b>{board.delayed}건</b></div> : null}{board.unacked ? <div>· 미확인 담당자 <b>{board.unacked}명</b> — 재전파 필요</div> : null}{!board.delayed && !board.unacked && <div style={{ color: C.muted }}>현재 주의 항목 없음</div>}</div>
            {board.unacked > 0 && <Btn small style={{ marginTop: 6, width: '100%' }} onClick={async () => { await post(`/exercises/${id}/redispatch`, {}); show('재전파했습니다'); }}>미확인자 재전파</Btn>}
          </Card>
        </div>
      </div>
      <Card title="시간별 상황내역" right={<div style={{ display: 'flex', gap: 6 }}><Link to={`/sit/${id}/board`}><Btn small>전자 상황판 열기</Btn></Link><Link to={`/sit/${id}/journal?generate=1`}><Btn small kind="dark">AI 상황일지 초안 생성</Btn></Link></div>}>
        <div style={{ fontSize: 11, color: C.muted, marginBottom: 10 }}>SOP 실행, 임무 전파, 수신 확인, 완료 보고 이력이 시간순으로 누적됩니다.</div>
        <div style={{ display: 'flex', gap: 0, overflowX: 'auto' }}>{events.filter((e) => e.kind !== 'AI분석').slice(-6).map((e, i, arr) => <div key={e.id} style={{ flex: 1, minWidth: 160, position: 'relative', paddingRight: 12 }}><div style={{ display: 'flex', alignItems: 'center' }}><div style={{ width: 12, height: 12, borderRadius: 6, border: `3px solid ${C.blue}`, background: '#fff' }} />{i < arr.length - 1 && <div style={{ flex: 1, height: 2, background: '#cbd5e1' }} />}</div><div style={{ fontSize: 13, fontWeight: 800, marginTop: 6 }}>{fmtTime(e.at)}</div><div style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>{e.kind}</div><div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{e.content}</div></div>)}</div>
      </Card>
      <Toast msg={toast} />
    </div>
  );
}
