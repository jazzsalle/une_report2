import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, put, fmtTime, type Exercise, type Task, type Event, type User } from '../api';
import { Btn, C, Card, Chip, Field, Input, Select, Textarea, Toast, statusTone, useToast } from '../ui';

const TABS = ['임무지시', '최초상황 전파', '현장확인 요청', '조치결과 요청', '추가상황 전파'] as const;
const TEMPLATES: Record<string, { title: string; body: string }> = {
  '임무지시': { title: '[임무지시] {임무명}', body: '{훈련명} 관련 {재난유형} 상황 발생에 따라 {임무명}을(를) 요청합니다. {담당자명}께서는 {완료기한}까지 완료 후 수신 확인 바랍니다. 발생위치: {발생위치}' },
  '최초상황 전파': { title: '[최초상황] {훈련명}', body: '{재난유형} 상황이 발생하였습니다. 발생위치: {발생위치}. 각 부서는 비상 근무체계로 전환하고 수신 확인 바랍니다.' },
  '현장확인 요청': { title: '[현장확인 요청] {임무명}', body: '{담당자명}께서는 {발생위치} 현장을 확인하고 {완료기한}까지 사진 첨부와 함께 결과를 보고 바랍니다.' },
  '조치결과 요청': { title: '[조치결과 요청] {임무명}', body: '{임무명}에 대한 조치 결과를 {완료기한}까지 회신 바랍니다.' },
  '추가상황 전파': { title: '[추가상황] {훈련명}', body: '{재난유형} 상황이 변동되었습니다. 최신 지시를 확인하고 수신 확인 바랍니다.' },
};

export function SitDispatch() {
  const { id = '' } = useParams();
  const [ex, setEx] = useState<Exercise | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sel, setSel] = useState<Task | null>(null);
  const [tab, setTab] = useState<typeof TABS[number]>('임무지시');
  const [title, setTitle] = useState(TEMPLATES['임무지시'].title);
  const [body, setBody] = useState(TEMPLATES['임무지시'].body);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [toast, show] = useToast();
  const load = async () => { const [e, t, ev] = await Promise.all([get<Exercise>(`/exercises/${id}`), get<Task[]>(`/exercises/${id}/tasks`), get<Event[]>(`/exercises/${id}/events`)]); setEx(e); setTasks(t); setEvents(ev); if (sel) setSel(t.find((x) => x.id === sel.id) ?? null); };
  useEffect(() => { get<User[]>('/users').then(setUsers); void load(); const t = setInterval(() => void load(), 3000); return () => clearInterval(t); }, [id]);
  useEffect(() => { setTitle(TEMPLATES[tab].title); setBody(TEMPLATES[tab].body); }, [tab]);
  useEffect(() => { if (sel) setRecipients([sel.assigneeId]); }, [sel?.id]);
  const fill = (s: string, t?: Task | null) => !ex ? s : s.replace(/\{훈련명\}/g, ex.title).replace(/\{재난유형\}/g, ex.hazardType).replace(/\{발생위치\}/g, ex.location || '(미지정)').replace(/\{임무명\}/g, t?.title ?? '(임무)').replace(/\{완료기한\}/g, t ? fmtTime(t.due) : '(기한)').replace(/\{담당자명\}/g, t?.assigneeName ?? '(담당자)');
  const dispatch = async () => {
    if (!sel) return;
    const assigneeId = recipients[0] ?? sel.assigneeId;
    await post(`/exercises/${id}/tasks/${sel.id}/dispatch`, { message: `${fill(title, sel)}\n${fill(body, sel)}`, assigneeId });
    show('전파되었습니다'); await load();
  };
  const dispatchAll = async () => { const r = await post<Task[]>(`/exercises/${id}/dispatch-all`, { message: `${TEMPLATES['임무지시'].title}\n${TEMPLATES['임무지시'].body}` }); show(`${r.length}건 전파`); await load(); };
  const redispatch = async () => { const r = await post<{ count: number }>(`/exercises/${id}/redispatch`, {}); show(`미확인자 ${r.count}명 재전파`); await load(); };
  const cnt = (f: (t: Task) => boolean) => tasks.filter(f).length;
  const total = tasks.length || 1;
  const bar = (label: string, n: number, color: string) => <div style={{ marginBottom: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{label}</span><b>{n}명</b></div><div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, marginTop: 3 }}><div style={{ width: `${(n / total) * 100}%`, height: 6, background: color, borderRadius: 3 }} /></div></div>;
  if (!ex) return <div style={{ padding: 24 }}>불러오는 중…</div>;
  if (!tasks.length) return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>임무가 없습니다. <Link to={`/sit/${id}/sop`}>SOP 화면</Link>에서 [훈련 실행으로 이동]을 눌러 임무를 생성하세요.</div>;
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '360px 1fr 300px', gridTemplateRows: 'auto 1fr auto', gap: 14, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 16 }}>상황/임무 전파</b><span style={{ fontSize: 12, color: C.muted }}>SOP에 따라 상황과 임무를 전파하고 수신 여부를 실시간으로 확인합니다.</span>
        <div style={{ flex: 1 }} />
        <Btn small onClick={() => setPreview(true)} disabled={!sel}>전파 미리보기</Btn>
        <Btn small kind="warn" onClick={() => void redispatch()} disabled={!cnt((t) => t.status === '전파완료')}>미확인자 재전파</Btn>
        <Btn small kind="primary" onClick={() => void dispatchAll()} disabled={!cnt((t) => t.status === '대기')}>대기 임무 일괄 전파 ({cnt((t) => t.status === '대기')})</Btn>
      </div>
      <Card title="SOP 임무 목록" style={{ overflow: 'auto' }}>
        {tasks.map((t) => (
          <div key={t.id} onClick={() => setSel(t)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 8px', borderBottom: `1px solid ${C.border}`, background: sel?.id === t.id ? C.blueLight : 'transparent', cursor: 'pointer', borderRadius: 6 }}>
            <span style={{ fontSize: 11, color: C.muted, width: 20 }}>{String(t.seq).padStart(2, '0')}</span>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div><div style={{ fontSize: 11, color: C.muted }}>{t.dept} · {t.assigneeName} · 기한 {fmtTime(t.due)}</div></div>
            <Chip tone={statusTone(t.status)}>{t.status}</Chip>
          </div>
        ))}
      </Card>
      <Card style={{ overflow: 'auto' }}>
        <div style={{ display: 'flex', gap: 14, borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>{TABS.map((t) => <div key={t} onClick={() => setTab(t)} style={{ padding: '6px 2px', fontSize: 13, fontWeight: 700, color: tab === t ? C.blue : C.muted, borderBottom: tab === t ? `2px solid ${C.blue}` : '2px solid transparent', cursor: 'pointer' }}>{t}</div>)}</div>
        {!sel ? <div style={{ color: C.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>왼쪽에서 임무를 선택하세요.</div> : (
          <>
            <Field label="제목"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="본문"><Textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ minHeight: 120 }} /></Field>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>자동 삽입 변수</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>{['{훈련명}', '{재난유형}', '{발생위치}', '{임무명}', '{완료기한}', '{담당자명}'].map((v) => <Btn key={v} small onClick={() => setBody(body + ' ' + v)}>{v}</Btn>)}</div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>전파 대상 <span style={{ fontWeight: 400, color: C.muted }}>부서별 · 개별</span></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>{recipients.map((r) => { const u = users.find((x) => x.id === r); return u ? <Chip key={r} tone="blue">{u.dept} {u.name} <span style={{ cursor: 'pointer' }} onClick={() => setRecipients(recipients.filter((x) => x !== r))}>✕</span></Chip> : null; })}<Select value="" onChange={(e) => { if (e.target.value && !recipients.includes(e.target.value)) setRecipients([...recipients, e.target.value]); }} style={{ width: 160, padding: '3px 6px', fontSize: 12 }}><option value="">+ 대상 추가</option>{users.map((u) => <option key={u.id} value={u.id}>{u.dept} · {u.name}</option>)}</Select></div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>POC에서는 첫 번째 대상이 임무 담당자로 배정되며, 모바일 화면(/m/담당자)에 나타나는 것이 발송입니다.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><Btn kind="primary" onClick={() => void dispatch()} disabled={ex.status === 'CLOSED'}>즉시 전파</Btn></div>
            {sel.message && <div style={{ marginTop: 12, fontSize: 12, background: '#f8fafc', padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap' }}><b>발송된 메시지</b> ({fmtTime(sel.dispatchedAt)})<br />{sel.message}</div>}
          </>
        )}
      </Card>
      <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card title={`전파 현황 · 전체 ${tasks.length}건`}>
          {bar('발송 완료', cnt((t) => !!t.dispatchedAt), C.blue)}{bar('수신 확인', cnt((t) => !!t.ackedAt), '#0ea5e9')}{bar('완료 보고', cnt((t) => t.status === '완료'), C.green)}{bar('지연', cnt((t) => t.status === '지연'), C.orange)}{bar('미확인', cnt((t) => t.status === '전파완료'), C.red)}
        </Card>
        <Card title="담당자 수신 현황" style={{ flex: 1 }}>
          {tasks.filter((t) => t.dispatchedAt).map((t) => <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: `1px solid ${C.border}` }}><div style={{ width: 28, height: 28, borderRadius: 14, background: C.blueLight, color: C.blue, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800 }}>{t.assigneeName[0]}</div><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5, fontWeight: 700 }}>{t.assigneeName} <span style={{ fontWeight: 400, color: C.muted }}>{t.dept}</span></div><div style={{ fontSize: 11, color: C.muted }}>발송 {fmtTime(t.dispatchedAt)} · {t.ackedAt ? `확인 ${fmtTime(t.ackedAt)}` : '미확인'}</div></div><Chip tone={statusTone(t.status)}>{t.status}</Chip></div>)}
          {!tasks.some((t) => t.dispatchedAt) && <div style={{ color: C.muted, fontSize: 12 }}>아직 전파된 임무가 없습니다.</div>}
        </Card>
      </div>
      <Card title={<span>📄 자동 상황일지 기록 내역 <Chip tone="green">자동 기록</Chip></span>} right={<Link to={`/sit/${id}/journal`}><Btn small>상황일지 반영</Btn></Link>} style={{ gridColumn: '1/-1', maxHeight: 150, overflow: 'auto' }}>
        {events.slice(-6).reverse().map((e) => <div key={e.id} style={{ fontSize: 12.5, padding: '3px 0' }}><b style={{ color: C.navy }}>{fmtTime(e.at)}</b> <Chip>{e.kind}</Chip> {e.content}</div>)}
      </Card>
      {preview && sel && <div onClick={() => setPreview(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'grid', placeItems: 'center', zIndex: 50 }}><div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, width: 460 }}><b>전파 미리보기</b><div style={{ marginTop: 10, background: '#f8fafc', padding: 12, borderRadius: 8, fontSize: 13, whiteSpace: 'pre-wrap' }}><b>{fill(title, sel)}</b>{'\n'}{fill(body, sel)}</div><div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>대상: {recipients.map((r) => users.find((u) => u.id === r)?.name).join(', ')}</div><div style={{ textAlign: 'right', marginTop: 12 }}><Btn onClick={() => setPreview(false)}>닫기</Btn></div></div></div>}
      <Toast msg={toast} />
    </div>
  );
}
