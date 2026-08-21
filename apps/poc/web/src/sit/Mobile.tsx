import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, fmtTime, type Task, type User } from '../api';
import { Btn, C, Chip, Textarea, statusTone } from '../ui';

/** 현장 담당자 모바일 화면 (09-모바일 임무 확인.png) — /m/:assigneeId */
export function Mobile() {
  const { assigneeId = '' } = useParams();
  const [data, setData] = useState<{ user: User; tasks: Task[] } | null>(null);
  const [cur, setCur] = useState<Task | null>(null);
  const [result, setResult] = useState<'완료' | '수행중' | '미완료' | '지원요청'>('완료');
  const [memo, setMemo] = useState('');
  const [checks, setChecks] = useState<Set<number>>(new Set());
  const [receipt, setReceipt] = useState<{ no: string; at: string } | null>(null);
  const load = async () => { const d = await get<{ user: User; tasks: Task[] }>(`/m/${assigneeId}`); setData(d); if (cur) setCur(d.tasks.find((t) => t.id === cur.id) ?? null); else if (d.tasks.length) setCur(d.tasks[0]); return d; };
  useEffect(() => { void load(); const t = setInterval(() => void load(), 4000); return () => clearInterval(t); }, [assigneeId]);
  const ack = async () => { if (!cur) return; await post(`/m/${assigneeId}/tasks/${cur.id}/ack`); await load(); };
  const report = async () => { if (!cur) return; const r = await post<Task & { receiptNo: string }>(`/m/${assigneeId}/tasks/${cur.id}/report`, { result, memo }); setReceipt({ no: r.receiptNo, at: r.reportedAt ?? new Date().toISOString() }); setMemo(''); await load(); };
  const phone: React.CSSProperties = { width: 390, minHeight: 760, background: '#f4f5f6', borderRadius: 36, border: '10px solid #1e2124', overflow: 'hidden', display: 'flex', flexDirection: 'column' };
  return (
    <div className="krds" style={{ minHeight: '100vh', background: '#f4f5f6', display: 'flex', gap: 32, justifyContent: 'center', alignItems: 'flex-start', padding: 32 }}>
      <div style={phone}>
        <div style={{ background: C.navy, color: '#fff', padding: '10px 18px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#cbd5e1' }}><span>{new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</span><span>LTE ▮▮▮</span></div>
          <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 8 }}>{cur?.exercise?.title ?? '안전한국훈련'}</div>
          <div style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>배정 임무 확인 {cur?.priority === '긴급' && <Chip tone="red">긴급</Chip>}</div>
        </div>
        {!data ? <div style={{ padding: 20 }}>불러오는 중…</div> : receipt ? (
          <div style={{ padding: 30, textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: 36, background: C.greenBg, color: C.green, display: 'grid', placeItems: 'center', fontSize: 36, margin: '0 auto 16px' }}>✓</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>보고가 접수되었습니다.</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>상황일지에 자동 반영되었습니다.</div>
            <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginTop: 20, fontSize: 13, textAlign: 'left' }}><div>접수번호 <b>{receipt.no}</b></div><div>보고 시간 <b>{new Date(receipt.at).toLocaleTimeString('ko-KR', { hour12: false })}</b></div></div>
            <Btn kind="primary" style={{ marginTop: 20 }} onClick={() => setReceipt(null)}>임무 목록으로</Btn>
          </div>
        ) : !cur ? <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 13 }}>{data.user.name}님에게 배정된 임무가 없습니다.<div style={{ fontSize: 11, marginTop: 6 }}>전파가 오면 이 화면에 나타납니다 (4초마다 확인).</div></div> : (
          <div style={{ padding: 14, flex: 1, overflow: 'auto' }}>
            {data.tasks.length > 1 && <div style={{ display: 'flex', gap: 4, overflowX: 'auto', marginBottom: 10 }}>{data.tasks.map((t) => <Btn key={t.id} small kind={cur.id === t.id ? 'dark' : 'default'} onClick={() => setCur(t)}>{String(t.seq).padStart(2, '0')} {t.title.slice(0, 8)}</Btn>)}</div>}
            <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{cur.title}</div>
              <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9, marginTop: 6 }}>재난유형 <b style={{ color: C.text }}>{cur.exercise?.hazardType}</b><br />위치 <b style={{ color: C.text }}>{cur.exercise?.location || '-'}</b><br />담당부서 <b style={{ color: C.text }}>{cur.dept}</b><br />완료기한 <b style={{ color: C.orange }}>{fmtTime(cur.due)}</b> &nbsp; <Chip tone={statusTone(cur.status)}>{cur.status}</Chip></div>
              {cur.message && <div style={{ marginTop: 8, fontSize: 12, background: '#f4f5f6', padding: 8, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{cur.message}</div>}
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>수행 지시사항</div>
              {(cur.instructions.length ? cur.instructions : ['현장 상태 확인', '필요 시 사진 첨부', '조치결과 10분 이내 보고']).map((s, i) => <label key={i} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '4px 0' }}><input type="checkbox" checked={checks.has(i)} onChange={(e) => { const n = new Set(checks); e.target.checked ? n.add(i) : n.delete(i); setChecks(n); }} />{s}</label>)}
            </div>
            <div style={{ background: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>현장 보고</div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>{(['완료', '수행중', '미완료', '지원요청'] as const).map((r) => <Btn key={r} small kind={result === r ? 'primary' : 'default'} onClick={() => setResult(r)} style={{ flex: 1 }}>{r}</Btn>)}</div>
              <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="사진 첨부 · 메모 입력" style={{ minHeight: 60 }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 6 }}><span>위치 자동 첨부</span><span style={{ color: C.green, fontWeight: 700 }}>켜짐 ●</span></div>
            </div>
            <Btn kind="primary" style={{ width: '100%', padding: 14, fontSize: 15, marginBottom: 8 }} onClick={() => void ack()} disabled={!!cur.ackedAt}>{cur.ackedAt ? `수신 확인됨 (${fmtTime(cur.ackedAt)})` : '수신 확인'}</Btn>
            <Btn kind="dark" style={{ width: '100%', padding: 14, fontSize: 15 }} onClick={() => void report()} disabled={cur.status === '완료'}>{cur.status === '완료' ? '완료 보고됨' : '임무 완료 보고'}</Btn>
            <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 8 }}>수신 확인 및 임무 완료 보고 결과는 상황일지에 자동 반영됩니다.</div>
          </div>
        )}
      </div>
      <div style={{ maxWidth: 300, fontSize: 13, lineHeight: 1.8, color: C.text }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>현장 담당자 모바일 화면</div>
        <div style={{ color: C.muted }}>현장 담당자가 10초 안에 수신 확인과 완료 보고를 마칠 수 있도록 단순하게 구성했습니다. 보고 결과는 전자 상황판과 상황일지에 자동 반영됩니다.</div>
        <div style={{ marginTop: 14, fontSize: 12 }}><b>담당자 전환</b> {data && <span style={{ color: C.muted }}>(현재 {data.user.name} · {data.user.dept})</span>}<div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>{['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => <Link key={u} to={`/m/${u}`}><Btn small kind={u === assigneeId ? 'dark' : 'default'}>{u}</Btn></Link>)}</div></div>
        <div style={{ marginTop: 14, fontSize: 12 }}><Link to="/sit">← 상황일지 도구로</Link></div>
      </div>
    </div>
  );
}
