import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, post, HAZARDS, type Exercise, type PlanSummary } from '../api';
import { Btn, C, Card, Chip, Field, Input, Select, Textarea, Toast, useToast, useUser } from '../ui';

interface Src { filename: string; score: number; text: string; doc_id?: string }
interface Msg { role: 'user' | 'assistant'; text: string; at: string; sources?: Src[]; streaming?: boolean }

const OPTIONS = ['훈련상황 대응 SOP 생성', '상황/임무 전파 메시지 생성', '시간별 상황일지 초안 생성', '부서별 임무 배정안 생성', '판단분기 포함', '현장 확인 요청 포함'];

/** 훈련상황 생성 + AI 챗봇 질의 (참조 데이터 목록 대신 자연어 질의 + 근거 표출) */
export function SitNew() {
  const nav = useNavigate();
  const [user] = useUser();
  const [sp] = useSearchParams();
  const [toast, show] = useToast();
  const [f, setF] = useState({ title: `${new Date().getFullYear()} 안전한국훈련 · 풍수해 대응 훈련`, hazardType: '태풍/호우', phase: '대응', alertLevel: '경계', occurredAt: new Date().toISOString().slice(0, 16), location: '', agency: '', dept: user?.dept ?? '', scenario: '' });
  const [options, setOptions] = useState<string[]>(OPTIONS.slice(0, 4).concat(['판단분기 포함', '현장 확인 요청 포함']));
  const [linkedPlanId, setLinkedPlanId] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [chat, setChat] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const chatBox = useRef<HTMLDivElement>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { get<PlanSummary[]>('/plans').then((p) => setPlans(p.filter((x) => x.hasToc))); }, []);
  // 계획서에서 시작 (LINK-01)
  useEffect(() => { const pid = sp.get('planId'); if (pid) void fromPlan(pid); }, []);
  const fromPlan = async (planId: string) => {
    const r = await post<{ title: string; hazardType: string; phase: string; alertLevel: string; location: string; dept: string; scenario: string; linkedPlanId: string; excerpt: string }>('/link/plan-to-exercise', { planId });
    setF((x) => ({ ...x, title: r.title, hazardType: r.hazardType, phase: r.phase, alertLevel: r.alertLevel, location: r.location || x.location, dept: r.dept || x.dept, scenario: r.scenario }));
    setLinkedPlanId(r.linkedPlanId); show('계획서의 대응 절차를 시나리오에 채웠습니다');
    if (!q) setQ('이 계획서의 대응 절차를 훈련 SOP로 옮기려면 어떤 단계가 필요한가?');
  };
  useEffect(() => { chatBox.current?.scrollTo({ top: chatBox.current.scrollHeight, behavior: 'smooth' }); }, [chat]);
  const cited = (): Src[] => { const out: Src[] = []; for (const m of chat) for (const s of m.sources ?? []) if (!out.some((o) => o.filename === s.filename && o.text === s.text)) out.push(s); return out; };
  const ask = (question?: string) => {
    const text = (question ?? q).trim(); if (!text || asking) return;
    setQ(''); setAsking(true);
    const history = chat.filter((m) => !m.streaming).map((m) => ({ role: m.role, text: m.text }));
    setChat((c) => [...c, { role: 'user', text, at: new Date().toISOString() }, { role: 'assistant', text: '', at: new Date().toISOString(), streaming: true }]);
    const params = new URLSearchParams({ q: text, hazardType: f.hazardType, alertLevel: f.alertLevel, phase: f.phase, location: f.location, scenario: f.scenario, history: JSON.stringify(history.slice(-6)) });
    const es = new EventSource(`/api/exercises/draft/chat/stream?${params}`);
    const upd = (fn: (m: Msg) => Msg) => setChat((c) => { const n = [...c]; n[n.length - 1] = fn(n[n.length - 1]); return n; });
    es.addEventListener('token', (e) => upd((m) => ({ ...m, text: m.text + (JSON.parse((e as MessageEvent).data) as { text: string }).text })));
    es.addEventListener('sources', (e) => upd((m) => ({ ...m, sources: (JSON.parse((e as MessageEvent).data) as { sources: Src[] }).sources })));
    const finish = () => { upd((m) => ({ ...m, streaming: false })); setAsking(false); es.close(); };
    es.addEventListener('done', finish); es.onerror = finish;
  };
  const suggestions = [`${f.hazardType} ${f.alertLevel} 단계에서 재난안전대책본부 구성 절차는?`, `${f.hazardType} 상황에서 상황/임무 전파 대상 부서와 순서는?`, '주민대피 판단 기준과 대피 안내 절차는?', '현장 확인 임무의 완료 기한과 보고 항목은?', `과거 ${f.hazardType} 훈련의 미흡 사항은?`];
  const create = async () => {
    if (!f.title.trim()) return show('훈련명을 입력하세요');
    setBusy(true);
    try {
      const ex = await post<Exercise>('/exercises', { ...f, occurredAt: new Date(f.occurredAt).toISOString(), refData: cited().map((s) => s.filename), options, linkedPlanId, createdBy: user?.name, chat: chat.filter((m) => !m.streaming), citedSources: cited() });
      nav(`/sit/${ex.id}/sop?generate=1`);
    } catch (e) { show((e as Error).message); setBusy(false); }
  };
  const answers = chat.filter((m) => m.role === 'assistant' && !m.streaming).length;
  return (
    <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '360px 1fr 300px', gap: 16, height: '100%', boxSizing: 'border-box' }}>
      {/* 기본정보 */}
      <div style={{ overflow: 'auto' }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>훈련상황 생성 및 AI 질의</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>기본정보를 입력하고, AI에게 자연어로 물어보며 근거를 확인한 뒤 SOP 생성을 시작합니다.</div>
        <Card title="기본정보">
          <Field label="훈련명" required><Input value={f.title} onChange={set('title')} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
            <Field label="재난유형" required><Select value={f.hazardType} onChange={set('hazardType')}>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</Select></Field>
            <Field label="훈련단계"><Select value={f.phase} onChange={set('phase')}><option>예방</option><option>대비</option><option>대응</option><option>복구</option></Select></Field>
            <Field label="상황단계" required><Select value={f.alertLevel} onChange={set('alertLevel')}><option>관심</option><option>주의</option><option>경계</option><option>심각</option></Select></Field>
            <Field label="발생일시"><Input type="datetime-local" value={f.occurredAt} onChange={set('occurredAt')} /></Field>
          </div>
          <Field label="발생위치"><Input value={f.location} onChange={set('location')} placeholder="○○시 ○○구 ○○천 하류 저지대" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
            <Field label="훈련기관"><Input value={f.agency} onChange={set('agency')} placeholder="○○시 재난안전대책본부" /></Field>
            <Field label="담당부서"><Input value={f.dept} onChange={set('dept')} placeholder="안전총괄과" /></Field>
          </div>
          <Field label="상황 시나리오"><Textarea value={f.scenario} onChange={set('scenario')} style={{ minHeight: 110 }} placeholder="집중호우로 인해 ○○천 수위가 급격히 상승하고, 저지대 도로 침수 및 주민 대피 필요성이 제기된 상황을 가정한다." /></Field>
          <Field label="근거 계획서 (연동)" hint="선택하면 계획서의 대응 절차를 시나리오에 채우고 SOP 생성 근거로 씁니다"><Select value={linkedPlanId ?? ''} onChange={(e) => { setLinkedPlanId(e.target.value || null); if (e.target.value) void fromPlan(e.target.value); }}><option value="">(없음)</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.hazardType}</option>)}</Select></Field>
        </Card>
      </div>
      {/* 챗봇 */}
      <Card title={<span>AI 챗봇 질의 <Chip tone="purple">유니</Chip></span>} right={<span style={{ fontSize: 11, color: C.muted }}>답변마다 참고 문서·근거가 표시됩니다</span>} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div ref={chatBox} style={{ flex: 1, overflow: 'auto', background: '#f4f5f6', borderRadius: 8, padding: 12, minHeight: 320 }}>
          {!chat.length && (
            <div style={{ color: C.muted, fontSize: 13 }}>
              <div style={{ marginBottom: 10 }}>훈련상황에 대해 자연어로 물어보세요. 기본정보(재난유형·단계·시나리오)가 질의 맥락으로 함께 전달됩니다.</div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>추천 질의</div>
              {suggestions.map((s) => <div key={s} onClick={() => ask(s)} style={{ padding: '7px 10px', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, cursor: 'pointer', fontSize: 12.5 }}>▸ {s}</div>)}
            </div>
          )}
          {chat.map((m, i) => (
            <div key={i} style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '85%', padding: '9px 12px', borderRadius: 12, background: m.role === 'user' ? C.blue : '#fff', color: m.role === 'user' ? '#fff' : C.text, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', border: m.role === 'user' ? 'none' : `1px solid ${C.border}` }}>
                {m.text || (m.streaming ? '…' : '')}{m.streaming && <span style={{ display: 'inline-block', width: 6, height: 14, background: C.blue, marginLeft: 3, verticalAlign: 'middle' }} />}
              </div>
              {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                <div style={{ maxWidth: '85%', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>참고 문서 · 근거 {m.sources.length}건</div>
                  {m.sources.slice(0, 5).map((s, j) => (
                    <details key={j} style={{ background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12 }}>
                      <summary style={{ cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ fontWeight: 700, flex: 1 }}>{s.filename}</span>{s.score ? <Chip tone="blue">{Math.round(s.score * 100)}%</Chip> : null}</summary>
                      <div style={{ marginTop: 6, color: C.muted, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{s.text}</div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ask(); }} placeholder="예: 경계 단계에서 대책본부 구성 절차는?" disabled={asking} />
          <Btn kind="primary" disabled={asking || !q.trim()} onClick={() => ask()}>{asking ? '답변 중…' : '질의'}</Btn>
        </div>
        {chat.length > 0 && <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>{suggestions.slice(0, 3).map((s) => <Btn key={s} small onClick={() => ask(s)} disabled={asking}>{s.length > 28 ? s.slice(0, 28) + '…' : s}</Btn>)}</div>}
      </Card>
      {/* 옵션·미리보기 */}
      <div style={{ overflow: 'auto' }}>
        <Card title="생성 옵션" style={{ marginBottom: 12 }}>
          {OPTIONS.map((o) => <label key={o} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 6 }}><input type="checkbox" checked={options.includes(o)} onChange={(e) => setOptions(e.target.checked ? [...options, o] : options.filter((x) => x !== o))} />{o}</label>)}
        </Card>
        <Card title="생성 결과 미리보기" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, marginBottom: 8 }}><b>대화·근거</b> <Chip tone="purple">AI</Chip><div style={{ color: C.muted, marginTop: 2 }}>질의 {answers}회 · 인용 근거 {cited().length}건</div>{cited().slice(0, 4).map((s, i) => <div key={i} style={{ fontSize: 11, color: C.muted }}>· {s.filename}</div>)}</div>
          <div style={{ fontSize: 12, marginBottom: 8 }}><b>생성 예정 SOP</b> <Chip tone="purple">AI 생성</Chip><div style={{ color: C.muted, marginTop: 2 }}>8~12개 임무 · 판단분기 {options.includes('판단분기 포함') ? '포함' : '제외'} · 현장확인 {options.includes('현장 확인 요청 포함') ? '포함' : '제외'}</div></div>
          <div style={{ fontSize: 12, marginBottom: 8 }}><b>전파 메시지</b> <Chip tone="purple">AI 생성</Chip><div style={{ color: C.muted, marginTop: 2 }}>임무별 템플릿 · 담당자 수신 확인 요청 포함</div></div>
          <div style={{ fontSize: 12 }}><b>상황일지 초안</b> <Chip tone="purple">AI 생성</Chip><div style={{ color: C.muted, marginTop: 2 }}>최초상황 · 주요 조치 · 현장확인 · 향후계획 구성</div></div>
          <div style={{ marginTop: 10, padding: 8, background: '#f4f5f6', borderRadius: 8, fontSize: 11, color: C.muted, border: `1px dashed ${C.border}` }}>AI 생성 결과는 초안이며, 최종 확정과 전파는 담당자 검토 후 수행됩니다.</div>
        </Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Btn kind="primary" disabled={busy} onClick={() => void create()}>{busy ? '생성 중…' : 'AI 생성 시작 (SOP)'}</Btn>
          <Btn onClick={() => show(f.title && f.hazardType && f.alertLevel ? '필수 항목 확인 완료 · 모순 없음' : '필수 항목이 비어 있습니다')}>AI 기준정보 검증</Btn>
          <Btn onClick={() => { localStorage.setItem('poc.sit.draft', JSON.stringify({ f, chat, options })); show('임시저장되었습니다'); }}>임시저장</Btn>
        </div>
      </div>
      <Toast msg={toast} />
    </div>
  );
}
