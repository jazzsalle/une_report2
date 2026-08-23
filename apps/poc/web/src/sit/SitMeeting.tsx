import { useEffect, useState } from 'react';
import { get, post, fmtTime, ALERTS, STAGES, ALERT_COLOR, type Exercise, type ExStage, type Meeting, type User } from '../api';
import { Btn, C, Field, Input, Modal, Select, Textarea, useUser } from '../ui';

/**
 * 상황판단회의 모달 (범용화 ①, 2026-08-23). 매뉴얼 1.4: 위기경보·비상단계·대피명령·CBS 발송은 상황판단회의에서 결정한다.
 * 저장하면 서버가 결정을 적용(경보·단계 변경 이벤트)하고 '상황판단회의' 이벤트를 남긴다.
 */
export function MeetingModal({ ex, onClose, onSaved }: { ex: Exercise; onClose: () => void; onSaved: (m: Meeting) => void }) {
  const [user] = useUser();
  const [users, setUsers] = useState<User[]>([]);
  const [chair, setChair] = useState(user?.name ?? '');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [agenda, setAgenda] = useState('');
  const [alertLevel, setAlertLevel] = useState('');
  const [stage, setStage] = useState<'' | ExStage>('');
  const [evacuation, setEvacuation] = useState(false);
  const [cbs, setCbs] = useState(false);
  const [other, setOther] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<User[]>('/users').then(setUsers).catch(() => {}); }, []);
  const toggle = (n: string) => setAttendees((a) => (a.includes(n) ? a.filter((x) => x !== n) : [...a, n]));
  const save = async () => {
    setBusy(true);
    try {
      const m = await post<Meeting>(`/exercises/${ex.id}/meetings`, { chair, attendees, agenda, decisions: { alertLevel: alertLevel || undefined, stage: stage || undefined, evacuation, cbs, other: other || undefined }, memo, by: user?.name });
      onSaved(m);
    } finally { setBusy(false); }
  };
  const cur = ALERT_COLOR[ex.alertLevel] ?? ALERT_COLOR.관심;
  return (
    <Modal title="상황판단회의" onClose={onClose} width={640}>
      <div style={{ fontSize: 12.5, color: C.muted, marginBottom: 10 }}>현재 위기경보 <b style={{ background: cur.bg, color: cur.fg, padding: '1px 8px', borderRadius: 4 }}>{ex.alertLevel}</b> · 대응 단계 <b>{ex.stage ?? '초기대응'}</b>. 결정 사항만 고르면 경보·단계가 바뀌고 이벤트로 기록됩니다.</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
        <Field label="주재"><Input value={chair} onChange={(e) => setChair(e.target.value)} placeholder="시장 / 부시장 / 국장" /></Field>
        <Field label="참석자" hint="누르면 추가·해제"><div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{users.map((u) => <Btn key={u.id} small kind={attendees.includes(u.name) ? 'primary' : 'default'} onClick={() => toggle(u.name)}>{u.name}</Btn>)}</div></Field>
      </div>
      <Field label="안건 · 현황"><Textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} style={{ minHeight: 60 }} placeholder="기상특보·피해 현황·대처 상황, 긴급구조기관 대응 상황 등" /></Field>
      <div style={{ fontSize: 12, fontWeight: 800, margin: '4px 0 6px' }}>결정 사항</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
        <Field label="위기경보"><Select value={alertLevel} onChange={(e) => setAlertLevel(e.target.value)}><option value="">(유지 — {ex.alertLevel})</option>{ALERTS.map((a) => <option key={a} value={a}>{a}{a === ex.alertLevel ? ' (현재)' : ''}</option>)}</Select></Field>
        <Field label="대응 단계"><Select value={stage} onChange={(e) => setStage(e.target.value as '' | ExStage)}><option value="">(유지 — {ex.stage ?? '초기대응'})</option>{STAGES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 8 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={evacuation} onChange={(e) => setEvacuation(e.target.checked)} /> 대피명령 발령</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={cbs} onChange={(e) => setCbs(e.target.checked)} /> CBS 긴급재난문자 발송</label>
      </div>
      <Field label="기타 결정"><Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="예: 위험구역 설정, 재난현장통합지원본부 설치 검토" /></Field>
      <Field label="메모"><Textarea value={memo} onChange={(e) => setMemo(e.target.value)} style={{ minHeight: 50 }} /></Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}><Btn onClick={onClose}>취소</Btn><Btn kind="primary" disabled={busy} onClick={() => void save()}>{busy ? '저장 중…' : '회의 결과 저장'}</Btn></div>
    </Modal>
  );
}

/** 회의 이력 한 줄 요약 */
export function meetingSummary(m: Meeting): string {
  const d = m.decisions ?? {}; const parts: string[] = [];
  if (d.alertLevel) parts.push(`경보 ${d.alertLevel}`); if (d.stage) parts.push(`단계 ${d.stage}`); if (d.evacuation) parts.push('대피명령'); if (d.cbs) parts.push('CBS'); if (d.other) parts.push(d.other);
  return `${fmtTime(m.at)} 주재 ${m.chair || '-'} · ${parts.length ? parts.join(', ') : '결정 없음'}`;
}
