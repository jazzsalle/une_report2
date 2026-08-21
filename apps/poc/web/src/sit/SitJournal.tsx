import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { get, post, put, fmtDate, pickSaveLocation, writeFileTo, type Exercise, type Journal, type Task, type PlanSummary } from '../api';
import { Btn, C, Card, Chip, Modal, Select, Textarea, Toast, renderMarkdown, useToast } from '../ui';

export function SitJournal() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const [ex, setEx] = useState<Exercise | null>(null);
  const [j, setJ] = useState<Journal | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cur, setCur] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [linkPlan, setLinkPlan] = useState('');
  const [toast, show] = useToast();
  const load = async () => { const e = await get<Exercise>(`/exercises/${id}`); setEx(e); setJ(e.journal ?? null); setTasks(e.tasks ?? []); return e; };
  useEffect(() => { void load().then((e) => { if (sp.get('generate') === '1' || (!e.journal && (e.eventCount ?? 0) > 0)) { void generate(); setSp({}); } }); get<PlanSummary[]>('/plans').then((p) => { setPlans(p); }); }, [id]);
  useEffect(() => { if (ex?.linkedPlanId) setLinkPlan(ex.linkedPlanId); }, [ex?.linkedPlanId]);
  const generate = async () => { setBusy(true); try { const r = await post<Journal>(`/exercises/${id}/journal/generate`, {}); setJ(r); show('상황일지 초안이 생성되었습니다'); } catch (e) { show((e as Error).message); } finally { setBusy(false); } };
  const polish = async (key: string) => { setBusy(true); try { await post(`/exercises/${id}/journal/polish`, { sectionKey: key }); await load(); show('문장을 다듬었습니다'); } finally { setBusy(false); } };
  const saveEdit = async () => { if (!j || edit === null) return; const sections = j.sections.map((s) => (s.key === cur ? { ...s, markdown: edit, reviewed: true } : s)); await put(`/exercises/${id}/journal`, { sections }); setEdit(null); await load(); show('저장되었습니다'); };
  const markReviewed = async () => { if (!j) return; const sections = j.sections.map((s) => ({ ...s, reviewed: true })); await put(`/exercises/${id}/journal`, { sections }); await load(); show('검토 완료'); };
  // 저장 위치 창은 클릭 직후에만 열린다 — 서버 생성을 기다린 뒤 열면 브라우저가 거부하므로 먼저 묻는다 (계획서 PlanEditor와 동일).
  const exportHwpx = async () => {
    const handle = await pickSaveLocation(`${ex?.title ?? '훈련'}_상황일지.hwpx`);
    setBusy(true);
    try {
      const r = await post<{ fileName: string; url: string }>(`/exercises/${id}/journal/export`, {}); await load();
      if (handle === 'cancelled') show('HWPX 생성 완료 · 저장은 취소됨 — [최근 파일 다운로드]로 받을 수 있습니다');
      else { const how = await writeFileTo(handle, `/api/files/${r.fileName}`, r.fileName); show(how === 'saved' ? `저장했습니다: ${r.fileName}` : 'HWPX 생성 완료 · 브라우저 다운로드 폴더에 저장'); }
    } catch (e) { show((e as Error).message); } finally { setBusy(false); }
  };
  const download = async () => {
    if (!j?.export) return;
    const handle = await pickSaveLocation(j.export.fileName);
    if (handle === 'cancelled') return;
    try { const how = await writeFileTo(handle, `/api/files/${j.export.fileName}`, j.export.fileName); show(how === 'saved' ? `저장했습니다: ${j.export.fileName}` : '브라우저 다운로드 폴더에 저장했습니다'); }
    catch (e) { show((e as Error).message); }
  };
  const feedback = async () => { if (!linkPlan) return; const r = await post<{ tocId: string; title: string }>('/link/exercise-to-plan', { exerciseId: id, planId: linkPlan }); show(`계획서 "${r.title}" 절에 훈련 환류 반영`); await load(); };
  if (!ex) return <div style={{ padding: 24 }}>불러오는 중…</div>;
  const sec = j?.sections.find((s) => s.key === cur);
  const unacked = tasks.filter((t) => t.status === '전파완료').length; const delayed = tasks.filter((t) => t.status === '지연').length; const aiNeed = j?.sections.filter((s) => s.aiGenerated && !s.reviewed).length ?? 0;
  const origins = [['SOP 실행 이력', ex.eventCount ?? 0], ['임무 전파 이력', tasks.filter((t) => t.dispatchedAt).length], ['모바일 수신 확인', tasks.filter((t) => t.ackedAt).length], ['현장 완료 보고', tasks.filter((t) => t.reportedAt).length], ['AI 분석 결과', ex.analysis ? 1 : 0]] as [string, number][];
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '220px 1fr 280px', gridTemplateRows: 'auto 1fr', gap: 12, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 16 }}>상황일지 검토 및 내보내기</b>{j && <Chip tone="purple">검토 중 · 초안</Chip>}
        <div style={{ flex: 1 }} />
        <Btn small onClick={() => void generate()} disabled={busy}>{busy ? '생성 중…' : j ? '초안 재생성' : '✦ AI 상황일지 초안 생성'}</Btn>
        <Btn small disabled={!sec || busy || sec.kind !== 'narrative'} onClick={() => void polish(cur)}>✦ AI로 문장 다듬기</Btn>
        <Btn small disabled={!j} onClick={() => void markReviewed()}>검토 완료</Btn>
        <Btn small kind="primary" disabled={!j || busy} onClick={() => void exportHwpx()}>최종본 저장 · HWPX</Btn>
      </div>
      <Card title="문서 목차" style={{ overflow: 'auto' }}>
        {(j?.sections ?? []).map((s) => <div key={s.key} onClick={() => { setCur(s.key); setEdit(null); }} style={{ padding: '8px 10px', borderRadius: 8, background: cur === s.key ? C.blueLight : 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: cur === s.key ? 700 : 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>{s.title}</span>{s.aiGenerated && !s.reviewed && <span title="AI 생성 · 검토 필요" style={{ color: C.purple }}>✦</span>}</div>)}
        {!j && <div style={{ color: C.muted, fontSize: 12 }}>초안을 생성하면 목차가 표시됩니다.</div>}
      </Card>
      <Card style={{ overflow: 'auto', background: '#fff' }}>
        {!j ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>{busy ? '이벤트를 절 구조로 투영하고 서술 절을 유니로 생성하는 중…' : '[AI 상황일지 초안 생성]을 누르세요.'}</div> : (
          <div style={{ maxWidth: 800, margin: '0 auto', padding: '16px 24px' }}>
            <h1 style={{ textAlign: 'center', fontSize: 22, marginBottom: 4 }}>훈련 상황일지</h1>
            <div style={{ textAlign: 'center', fontSize: 12, color: C.muted, marginBottom: 20, borderBottom: `2px solid ${C.navy}`, paddingBottom: 12 }}>{ex.title} · {ex.agency || '훈련기관'} · 보고일시 {fmtDate(new Date().toISOString())}</div>
            {sec && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><h2 style={{ fontSize: 16, margin: 0 }}>{sec.title}</h2>{sec.kind === 'fact' ? <Chip tone="green">사실 투영</Chip> : <Chip tone="purple">AI 생성{sec.reviewed ? ' · 검토됨' : ' · 검토 필요'}</Chip>}<div style={{ flex: 1 }} />{edit === null ? <Btn small onClick={() => setEdit(sec.markdown)}>편집</Btn> : <><Btn small kind="primary" onClick={() => void saveEdit()}>저장</Btn><Btn small onClick={() => setEdit(null)}>취소</Btn></>}</div>
                {edit !== null ? <Textarea value={edit} onChange={(e) => setEdit(e.target.value)} style={{ minHeight: 300, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} /> : (
                  <div style={{ background: sec.aiGenerated && !sec.reviewed ? '#faf5ff' : 'transparent', borderLeft: sec.aiGenerated && !sec.reviewed ? `3px solid ${C.purple}` : 'none', padding: sec.aiGenerated && !sec.reviewed ? '4px 10px' : 0 }}>{renderMarkdown(sec.markdown)}</div>
                )}
              </>
            )}
          </div>
        )}
      </Card>
      <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Card title="자동 기록 원천">{origins.map(([k, v]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0' }}><span>{k}</span><b>{v}건</b></div>)}</Card>
        <Card title="검토 필요 알림" style={{ background: C.orangeBg, border: '1px solid #fcd34d' }}><div style={{ fontSize: 12.5, lineHeight: 1.9 }}>· 미확인 담당자 <b>{unacked}</b>명<br />· 지연 임무 <b>{delayed}</b>건<br />· AI 생성 문장 검토 필요 <b>{aiNeed}</b>건</div></Card>
        <Card title="내보내기">
          <Btn kind="dark" style={{ width: '100%', marginBottom: 6 }} disabled={!j || busy} onClick={() => void exportHwpx()}>HWPX 다운로드 (상황보고 템플릿)</Btn>
          {j?.export && <Btn style={{ width: '100%', marginBottom: 6 }} onClick={() => void download()} title="저장 위치를 고른 뒤 HWPX를 저장합니다">최근 파일 다운로드</Btn>}
          <Btn style={{ width: '100%' }} disabled title="후속 범위">DOCX / PDF (후속)</Btn>
        </Card>
        <Card title="계획서로 환류 (연동)">
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>지연·미완료 임무와 개선 필요사항을 계획서의 "개선사항 및 보완계획" 절에 새 문단으로 넣습니다.</div>
          <Select value={linkPlan} onChange={(e) => setLinkPlan(e.target.value)} style={{ marginBottom: 6 }}><option value="">계획서 선택</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select>
          <Btn kind="primary" style={{ width: '100%' }} disabled={!linkPlan} onClick={() => void feedback()}>훈련 결과 → 계획서 반영</Btn>
          {linkPlan && <div style={{ marginTop: 6, fontSize: 11 }}><Link to={`/plan/${linkPlan}`}>계획서 열기 →</Link></div>}
        </Card>
      </div>
      <Toast msg={toast} />
    </div>
  );
}
