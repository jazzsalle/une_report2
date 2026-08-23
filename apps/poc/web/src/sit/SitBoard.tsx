import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, fmtTime, ALERT_COLOR, type Board, type Event, type PendingWarning } from '../api';
import { Btn, C, Card, Chip, Input, Select, Table, Toast, statusTone, useToast, useUser } from '../ui';

const PHASES = ['최초상황', '상황판단', '임무전파', '수신확인', '현장조치', '완료보고', '추가상황', '상황종료'];
const KIND_TONE: Record<string, 'navy' | 'blue' | 'purple' | 'green' | 'orange' | 'red' | 'gray'> = { 최초상황: 'navy', 상황판단: 'blue', 임무전파: 'purple', 수신확인: 'blue', 현장조치: 'orange', 완료보고: 'green', 지연: 'red', 추가상황: 'gray', 수동기록: 'gray', AI분석: 'purple', 상황종료: 'navy' };

export function SitBoard() {
  const { id = '' } = useParams();
  const [user] = useUser();
  const [board, setBoard] = useState<Board | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [fk, setFk] = useState(''); const [fd, setFd] = useState(''); const [fs, setFs] = useState('');
  const [manual, setManual] = useState({ kind: '수동기록', content: '' });
  const [toast, show] = useToast();
  const [pend, setPend] = useState<PendingWarning[]>([]);
  const loadPend = () => get<PendingWarning[]>(`/exercises/${id}/pending-warnings`).then(setPend).catch(() => {});
  useEffect(() => { void loadPend(); const t = setInterval(() => void loadPend(), 30000); return () => clearInterval(t); }, [id]);
  const actPend = async (pid: string, action: 'record' | 'dismiss') => { await post(`/exercises/${id}/pending-warnings/${pid}/${action}`, { by: user?.name }); show(action === 'record' ? '기상특보를 기록했습니다' : '특보 후보를 지웠습니다'); await loadPend(); await load(); };
  const load = async () => { const [b, e] = await Promise.all([get<Board>(`/exercises/${id}/board`), get<Event[]>(`/exercises/${id}/events`)]); setBoard(b); setEvents(e); };
  useEffect(() => { void load(); const t = setInterval(() => void load(), 3000); return () => clearInterval(t); }, [id]);
  if (!board) return <div style={{ padding: 24 }}>불러오는 중…</div>;
  const ex = board.exercise;
  const el = Math.floor(board.elapsedMs / 1000); const elapsed = `${String(Math.floor(el / 3600)).padStart(2, '0')}:${String(Math.floor((el % 3600) / 60)).padStart(2, '0')}:${String(el % 60).padStart(2, '0')}`;
  const depts = [...new Set(events.map((e) => e.dept).filter(Boolean))] as string[];
  const shown = events.filter((e) => (!fk || e.kind === fk) && (!fd || e.dept === fd) && (!fs || e.status === fs));
  const addManual = async () => { if (!manual.content.trim()) return; await post(`/exercises/${id}/events`, { ...manual, actor: user?.name, dept: user?.dept }); setManual({ ...manual, content: '' }); show('기록되었습니다'); await load(); };
  const close = async () => { await post(`/exercises/${id}/close`, {}); show('훈련이 종료되었습니다'); await load(); };
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, height: '100%', boxSizing: 'border-box', overflow: 'auto' }}>
      <div className="card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 24, fontSize: 14 }}>
        <h1 style={{ fontSize: 19, fontWeight: 700 }}>전자 상황판</h1>
        <span className="dim">{ex.hazardType} · {ex.location || '위치 미지정'}</span>
        {([['위기경보', ex.alertLevel, (ALERT_COLOR[ex.alertLevel] ?? ALERT_COLOR.관심).fg], ['대응 단계', ex.stage ?? '초기대응', C.orange], ['경과시간', elapsed, C.text], ['진행 임무', `${board.inProgress + board.dispatched}건`, C.blue], ['지연 임무', `${board.delayed}건`, board.delayed ? C.red : C.text]] as [string, string, string][]).map(([k, v, color]) => (
          <span key={k} style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}><span style={{ fontSize: 13, color: C.muted }}>{k}</span><b className="num" style={{ fontSize: 20, color }}>{v}</b></span>
        ))}
        <div style={{ flex: 1 }} />
        <span className="tiny" style={{ color: C.green, fontWeight: 700 }}>실시간 · 3초마다 갱신</span>
        <span className="tiny dim num">마지막 업데이트 {board.lastEventAt ? new Date(board.lastEventAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-'}</span>
        {ex.status !== 'CLOSED' && <Btn small kind="danger" onClick={() => void close()}>{ex.mode === '실제상황' ? '상황 종료' : '훈련 종료'}</Btn>}
      </div>
      {pend.length > 0 && <div className="card" style={{ padding: '10px 16px', background: '#fff8e1', border: '1px solid #ffe0a3', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}><b>기상특보 변화</b>{pend.map((p) => <span key={p.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><span>{p.kind} <b>{p.change}</b> <span className="dim">{fmtTime(p.at)}</span></span><Btn small kind="primary" onClick={() => void actPend(p.id, 'record')}>기록</Btn><Btn small onClick={() => void actPend(p.id, 'dismiss')}>무시</Btn></span>)}</div>}
      <div style={{ fontSize: 13, color: C.muted }}>SOP 실행, 임무 전파, 수신 확인, 완료 보고 이력이 시간순으로 누적됩니다. 집계는 서버 사실원장에서 접은 값이며 화면에서 다시 계산하지 않습니다.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 280px', gap: 12, flex: 1, minHeight: 0 }}>
        <Card title="단계별 타임라인">
          {PHASES.map((p, i) => { const t = board.timeline.find((x) => x.kind === p)?.at; return <div key={p} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14, opacity: t ? 1 : 0.4 }}><div style={{ width: 12, height: 12, borderRadius: 6, marginTop: 3, background: t ? ['#1e2124', '#256ef4', '#0b50d0', '#256ef4', '#9d5b00', '#228738', '#464c53', '#1e2124'][i] : '#cdd1d5' }} /><div><div style={{ fontSize: 13, fontWeight: 700 }}>{p}</div><div style={{ fontSize: 11, color: C.muted }}>{t ? fmtTime(t) : '—'}</div></div></div>; })}
        </Card>
        <Card title="시간별 상황내역" right={<div style={{ display: 'flex', gap: 6 }}><Select value={fk} onChange={(e) => setFk(e.target.value)} style={{ width: 110, padding: '4px 6px', fontSize: 12 }}><option value="">구분 전체</option>{Object.keys(KIND_TONE).map((k) => <option key={k}>{k}</option>)}</Select><Select value={fd} onChange={(e) => setFd(e.target.value)} style={{ width: 120, padding: '4px 6px', fontSize: 12 }}><option value="">부서 전체</option>{depts.map((d) => <option key={d}>{d}</option>)}</Select><Select value={fs} onChange={(e) => setFs(e.target.value)} style={{ width: 100, padding: '4px 6px', fontSize: 12 }}><option value="">상태 전체</option>{[...new Set(events.map((e) => e.status).filter(Boolean))].map((s) => <option key={s}>{s}</option>)}</Select></div>} style={{ overflow: 'auto' }}>
          <Table small head={['시간', '구분', '상황내용', '담당부서/담당자', '상태', '근거/출처']} rows={shown.map((e) => [<b>{fmtTime(e.at)}</b>, <Chip tone={KIND_TONE[e.kind] ?? 'gray'}>{e.kind}</Chip>, e.content, `${e.dept ?? '-'}${e.actor ? ' / ' + e.actor : ''}`, e.status ? <Chip tone={statusTone(e.status)}>{e.status}</Chip> : '-', <span style={{ color: C.muted }}>{e.source}</span>])} />
          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}><Select value={manual.kind} onChange={(e) => setManual({ ...manual, kind: e.target.value })} style={{ width: 110 }}><option>수동기록</option><option>추가상황</option><option>현장조치</option><option>상황판단</option></Select><Input value={manual.content} onChange={(e) => setManual({ ...manual, content: e.target.value })} placeholder="수동 기록 내용" onKeyDown={(e) => { if (e.key === 'Enter') void addManual(); }} /><Btn small onClick={() => void addManual()}>기록</Btn></div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card title="현재 진행 임무">
            {board.active.length ? board.active.map((t) => <div key={t.id} style={{ padding: 8, border: `1px solid ${t.status === '지연' ? C.orange : C.border}`, background: t.status === '지연' ? C.orangeBg : '#fff', borderRadius: 8, marginBottom: 6 }}><div style={{ fontSize: 13, fontWeight: 700 }}>{t.title}</div><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 3 }}><Chip tone={statusTone(t.status)}>{t.status}</Chip><span style={{ color: t.status === '지연' ? C.orange : C.muted }}>기한 {fmtTime(t.due)}</span></div></div>) : <div style={{ color: C.muted, fontSize: 12 }}>진행 중인 임무가 없습니다.</div>}
          </Card>
          {board.delayed > 0 && <Card style={{ background: C.redBg, border: `1px solid #f4c2b8` }} pad={12}><div style={{ fontWeight: 700, color: C.red, fontSize: 14 }}>지연 알림</div><div style={{ fontSize: 12, marginTop: 4 }}>{board.active.filter((t) => t.status === '지연').map((t) => <div key={t.id}>{t.title} 임무가 완료기한을 초과했습니다. 담당자 재확인이 필요합니다.</div>)}</div></Card>}
        </div>
      </div>
      <Card title={<span>AI 상황일지 초안 생성 <Chip tone="purple">AI 생성</Chip></span>} right={<div style={{ display: 'flex', gap: 6 }}><Link to={`/sit/${id}/journal?review=1`}><Btn small>검토 필요 항목만 보기</Btn></Link><Link to={`/sit/${id}/journal?generate=1`}><Btn small kind="primary">오늘 전체 내역으로 초안 생성</Btn></Link></div>}>
        <div style={{ fontSize: 14, color: C.text, background: '#f4f5f6', padding: 10, borderRadius: 8 }}>"{events.filter((e) => e.kind !== 'AI분석').slice(0, 3).map((e) => `${fmtTime(e.at)} ${e.content}`).join(', ')}{events.length > 3 ? ' …' : ''}"</div>
      </Card>
      <Toast msg={toast} />
    </div>
  );
}
