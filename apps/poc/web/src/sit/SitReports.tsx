import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { del, get, post, put, fmtDate, pickSaveLocation, writeFileTo, type Exercise, type PlanSummary, type Report, type ReportTemplateSummary, type Task, type Template } from '../api';
import { Btn, C, Card, Chip, Field, Input, Modal, Select, Textarea, Toast, renderMarkdown, useToast, useUser } from '../ui';

/**
 * 보고서 센터 (범용화 ③, 2026-08-23) — 예전 "상황일지 관리" 자리(/sit/:id/journal 도 이 화면).
 * 좌: 보고서 목록(종류·차수·버전·상태) + 새 보고서 / 중: 절 보기·편집(사실 절은 표 마크다운, 서술 절은 AI 재생성·다듬기) + 상태 전환 / 우: 머리 정보·배부처·KRMS 연계 필드, 내보내기(HWPX·PDF·DOCX·미리보기), 계획서 환류
 */
/** ISO(UTC) → <input type=datetime-local> 값(현지 시각). slice(0,16)은 UTC라 9시간 어긋난다 */
const toLocalInput = (iso: string) => { const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const z = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
const URL_RE = /(https?:\/\/\S+)/;
const PDF_GUIDE = ['서버 PC에 Chrome 또는 Edge가 있어야 PDF를 만들 수 있습니다(Edge는 Windows 10/11에 기본 포함).', 'Chrome 설치: https://www.google.com/chrome/ → 설치 후 서버 재기동.', '다른 경로에 설치돼 있으면 infrastructure/.env 에 CHROME_PATH=<chrome.exe 또는 msedge.exe 전체 경로> 를 적고 서버를 재기동합니다.', 'PDF 없이도 HWPX·DOCX 내보내기와 미리보기는 그대로 됩니다.'];
const STATUS_TONE: Record<Report['status'], 'gray' | 'blue' | 'green'> = { 초안: 'gray', 검토중: 'blue', 최종: 'green' };
const MODE_HINT: Record<string, string> = { immediate: '실제상황·도상훈련', interim: '실제상황·도상훈련', final: '실제상황·도상훈련', journal: '모든 모드', drillResult: '안전한국훈련·도상훈련', recovery: '실제상황·도상훈련(수습복구 단계)', evaluation: '모든 모드(종료 후)' };

export function SitReports() {
  const { id = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const [user] = useUser();
  const [ex, setEx] = useState<Exercise | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [list, setList] = useState<Report[]>([]);
  const [tpls, setTpls] = useState<ReportTemplateSummary[]>([]);
  const [rid, setRid] = useState<string | null>(null);
  const [r, setR] = useState<Report | null>(null);
  const [cur, setCur] = useState<string>('');
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newType, setNewType] = useState('');
  const [hwpxTpls, setHwpxTpls] = useState<Template[]>([]);
  const [hwpxTplId, setHwpxTplId] = useState('');
  const [preview, setPreview] = useState<{ pages: number; svgs: string[] } | null>(null);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [linkPlan, setLinkPlan] = useState('');
  const [toast, show] = useToast();
  // PDF는 서버 PC의 Chrome/Edge로 만든다 — 없으면 오류 대신 설치 안내(사용자 요청 2026-08-23)
  const [pdf, setPdf] = useState<{ available: boolean; browser: 'chrome' | 'edge' | null } | null>(null);
  const [guide, setGuide] = useState<string[] | null>(null);
  useEffect(() => { get<{ pdf?: { available: boolean; browser: 'chrome' | 'edge' | null } }>('/health').then((h) => setPdf(h.pdf ?? { available: false, browser: null })).catch(() => setPdf({ available: false, browser: null })); }, []);

  const loadList = async () => { const l = await get<Report[]>(`/exercises/${id}/reports`); setList(l); return l; };
  const loadReport = async (x: string) => { const rr = await get<Report>(`/reports/${x}`); setR(rr); if (!rr.sections.some((s) => s.key === cur)) setCur(rr.sections[0]?.key ?? ''); return rr; };
  useEffect(() => {
    get<Exercise>(`/exercises/${id}`).then((e) => { setEx(e); setTasks(e.tasks ?? []); if (e.linkedPlanId) setLinkPlan(e.linkedPlanId); });
    get<ReportTemplateSummary[]>('/report-templates').then(setTpls).catch(() => {});
    get<Template[]>('/templates').then(setHwpxTpls).catch(() => {});
    get<PlanSummary[]>('/plans').then(setPlans).catch(() => {});
    void loadList().then((l) => {
      // ?generate=1 (상황판·대시보드의 "AI 상황일지 초안 생성")은 상황일지 보고서를 만든다(이미 있으면 그것을 연다)
      const j = l.find((x) => x.type === 'journal');
      if (sp.get('generate') === '1' && !j) { void create('journal'); setSp({}); }
      else if (sp.get('report') && l.some((x) => x.id === sp.get('report'))) setRid(sp.get('report')); // ?report=<id> 로 특정 보고서를 바로 연다
      else if (l[0]) setRid(j?.id ?? l[0].id);
    });
  }, [id]);
  useEffect(() => { if (rid) void loadReport(rid); else setR(null); }, [rid]);
  useEffect(() => { if (!hwpxTplId && hwpxTpls.length) setHwpxTplId(r?.export?.hwpx?.templateId ?? hwpxTpls.find((t) => /상황보고/.test(t.fileName))?.id ?? hwpxTpls[0].id); }, [hwpxTpls, r?.export?.hwpx?.templateId]);
  useEffect(() => { if (ex && !newType && tpls.length) { const m = ex.mode ?? '안전한국훈련'; setNewType((tpls.find((t) => t.modes.includes(m) && t.type !== 'journal') ?? tpls[0]).type); } }, [ex, tpls]);

  const create = async (type: string) => {
    setBusy('create');
    try { const nr = await post<Report>(`/exercises/${id}/reports`, { type, by: user?.name }); await loadList(); setRid(nr.id); show(`${nr.templateName}${nr.seqLabel === '보' ? ` ${nr.seq}보` : ''} 초안을 만들었습니다`); }
    catch (e) { show((e as Error).message); } finally { setBusy(null); }
  };
  const patch = async (body: Partial<Report> & { by?: string }) => { if (!r) return; try { const nr = await put<Report>(`/reports/${r.id}`, body); setR(nr); await loadList(); return nr; } catch (e) { show((e as Error).message); } };
  const saveEdit = async () => { if (!r || edit === null) return; await patch({ sections: r.sections.map((s) => (s.key === cur ? { ...s, markdown: edit, reviewed: true, editedByUser: true } : s)) }); setEdit(null); show('저장했습니다'); };
  const setHeader = (h: Partial<Report['header']>) => { if (!r) return; setR({ ...r, header: { ...r.header, ...h } }); };
  const saveHeader = async () => { if (!r) return; await patch({ header: r.header }); show('머리 정보를 저장했습니다'); };
  const act = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); try { await fn(); } catch (e) { show((e as Error).message); } finally { setBusy(null); } };
  const regenerate = () => act('regen', async () => { if (!r) return; setR(await post<Report>(`/reports/${r.id}/regenerate`, { sectionKey: cur })); show('다시 생성했습니다'); });
  const polish = () => act('polish', async () => { if (!r) return; setR(await post<Report>(`/reports/${r.id}/polish`, { sectionKey: cur })); show('문장을 다듬었습니다'); });
  const refresh = () => act('refresh', async () => { if (!r) return; setR(await post<Report>(`/reports/${r.id}/refresh`, {})); show('사실 절을 최신 기록으로 다시 투영했습니다'); });
  const newVersion = () => act('version', async () => { if (!r) return; const nr = await post<Report>(`/reports/${r.id}/versions`, { by: user?.name }); await loadList(); setRid(nr.id); show(`v${nr.version} 초안을 만들었습니다`); });
  const remove = () => act('remove', async () => { if (!r) return; await del(`/reports/${r.id}`); const l = await loadList(); setRid(l[0]?.id ?? null); show('삭제했습니다'); });
  // 저장 위치 창은 클릭 직후에만 열린다 — 서버 생성을 기다린 뒤 열면 브라우저가 거부하므로 먼저 묻는다
  const exportAs = async (format: 'hwpx' | 'pdf' | 'docx') => {
    if (!r) return;
    if (format === 'pdf' && pdf && !pdf.available) { setGuide(PDF_GUIDE); return; }
    const handle = await pickSaveLocation(`${r.title}.${format}`);
    setBusy(format);
    try {
      const out = await post<{ fileName: string; url: string; pages?: number; templateName?: string }>(`/reports/${r.id}/export`, { format, templateId: hwpxTplId || undefined });
      await loadReport(r.id);
      if (handle === 'cancelled') show(`${format.toUpperCase()} 생성 완료 · 저장은 취소됨 — [최근 파일]로 받을 수 있습니다`);
      else { const how = await writeFileTo(handle, `/api/files/${out.fileName}`, out.fileName); show(how === 'saved' ? `저장했습니다: ${out.fileName}${out.pages ? ` (${out.pages}쪽)` : ''}` : `${format.toUpperCase()} 생성 완료 · 브라우저 다운로드 폴더에 저장`); }
    } catch (e) { const err = e as Error & { code?: string; guide?: string[] }; if (err.code === 'BROWSER_NOT_FOUND') setGuide(err.guide ?? PDF_GUIDE); else show(err.message); } finally { setBusy(null); }
  };
  const download = async (format: 'hwpx' | 'pdf' | 'docx') => { const f = r?.export?.[format]; if (!f) return; const handle = await pickSaveLocation(f.fileName); if (handle === 'cancelled') return; try { const how = await writeFileTo(handle, `/api/files/${f.fileName}`, f.fileName); show(how === 'saved' ? `저장했습니다: ${f.fileName}` : '브라우저 다운로드 폴더에 저장했습니다'); } catch (e) { show((e as Error).message); } };
  const openPreview = () => act('preview', async () => { if (!r) return; setPreview(await get(`/reports/${r.id}/preview`)); });
  const feedback = async () => { if (!linkPlan) return; const out = await post<{ tocId: string; title: string }>('/link/exercise-to-plan', { exerciseId: id, planId: linkPlan }); show(`계획서 "${out.title}" 절에 환류 반영`); };
  if (!ex) return <div style={{ padding: 24 }}>불러오는 중…</div>;
  const sec = r?.sections.find((s) => s.key === cur);
  const locked = r?.status === '최종';
  const mode = ex.mode ?? '안전한국훈련';
  const unacked = tasks.filter((t) => t.status === '전파완료').length; const delayed = tasks.filter((t) => t.status === '지연').length; const aiNeed = r?.sections.filter((s) => s.aiGenerated && !s.reviewed).length ?? 0;
  const label = (x: Report) => `${x.templateName}${x.seqLabel === '보' ? ` ${x.seq}보` : ''}`;
  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '240px 1fr 300px', gridTemplateRows: 'auto 1fr', gap: 12, height: '100%', boxSizing: 'border-box' }}>
      <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 16 }}>보고서</b>
        {r && <Chip tone={STATUS_TONE[r.status]}>{label(r)} · v{r.version} · {r.status}</Chip>}
        <div style={{ flex: 1 }} />
        {r && !locked && <>
          <Btn small disabled={!sec || !!busy || sec.kind !== 'narrative'} onClick={regenerate}>{busy === 'regen' ? '생성 중…' : 'AI 다시 생성'}</Btn>
          <Btn small disabled={!sec || !!busy || sec.kind !== 'narrative'} onClick={polish}>AI로 문장 다듬기</Btn>
          <Btn small disabled={!!busy} onClick={refresh} title="이벤트·임무·회의 기록이 더 쌓였으면 사실 절 표를 다시 만듭니다(직접 고친 절은 보존)">사실 절 갱신</Btn>
          {r.status === '초안' && <Btn small onClick={() => void patch({ status: '검토중' }).then(() => show('검토중으로 바꿨습니다'))}>검토 요청</Btn>}
          {r.status === '검토중' && <Btn small kind="primary" onClick={() => void patch({ status: '최종', by: user?.name }).then(() => show('최종 확정 — 이후 편집은 새 버전으로'))}>최종 확정</Btn>}
        </>}
        {r && locked && <Btn small kind="primary" onClick={newVersion} disabled={!!busy}>새 버전(v{r.version + 1})으로 고치기</Btn>}
        {r && <Btn small kind="danger" onClick={remove} disabled={!!busy}>삭제</Btn>}
      </div>
      {/* 좌: 목록 + 새 보고서 */}
      <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Card title="새 보고서" pad={12}>
          <Select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ width: '100%', marginBottom: 6 }} aria-label="보고서 종류">{tpls.map((t) => <option key={t.type} value={t.type}>{t.name}{t.modes.includes(mode) ? '' : ' (다른 모드용)'}</option>)}</Select>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6, lineHeight: 1.5 }}>{tpls.find((t) => t.type === newType)?.description}<br />권장 모드: {MODE_HINT[newType] ?? '-'}</div>
          <Btn kind="primary" style={{ width: '100%' }} disabled={!newType || busy === 'create'} onClick={() => void create(newType)}>{busy === 'create' ? '생성 중…(서술 절 AI)' : '초안 생성'}</Btn>
        </Card>
        <Card title={`보고서 목록 (${list.length})`} pad={8} style={{ flex: 1 }}>
          {!list.length && <div style={{ fontSize: 12, color: C.muted, padding: 8 }}>아직 보고서가 없습니다. 위에서 종류를 고르고 초안을 만드세요.</div>}
          {list.map((x) => (
            <div key={x.id} onClick={() => { setRid(x.id); setEdit(null); }} style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', background: rid === x.id ? C.blueLight : 'transparent', border: `1px solid ${rid === x.id ? C.blue : 'transparent'}`, marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center' }}>{label(x)}<span style={{ fontSize: 11, color: C.muted, fontWeight: 500 }}>v{x.version}</span><div style={{ flex: 1 }} /><Chip tone={STATUS_TONE[x.status]}>{x.status}</Chip></div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{fmtDate(x.createdAt)} · {x.createdBy ?? '-'}{x.export?.hwpx ? ' · HWPX' : ''}{x.export?.pdf ? ' · PDF' : ''}{x.export?.docx ? ' · DOCX' : ''}</div>
            </div>
          ))}
        </Card>
      </div>
      {/* 중: 문서 */}
      <Card style={{ overflow: 'auto', background: '#fff' }}>
        {!r ? <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>{busy === 'create' ? '이벤트·임무·회의를 절 구조로 투영하고 서술 절을 유니로 생성하는 중…' : '왼쪽에서 보고서를 고르거나 새로 만드세요.'}</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, maxWidth: 1000, margin: '0 auto', padding: '8px 12px' }}>
            <div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>문서 목차</div>
              {r.sections.map((s) => <div key={s.key} onClick={() => { setCur(s.key); setEdit(null); }} style={{ padding: '7px 10px', borderRadius: 8, background: cur === s.key ? C.blueLight : 'transparent', cursor: 'pointer', fontSize: 12.5, fontWeight: cur === s.key ? 700 : 500, display: 'flex', justifyContent: 'space-between', gap: 6 }}><span>{s.title}</span>{s.aiGenerated && !s.reviewed && <span title="AI 생성 · 검토 필요" style={{ color: C.orange }}>●</span>}</div>)}
            </div>
            <div>
              <h1 style={{ textAlign: 'center', fontSize: 20, marginBottom: 4 }}>{r.title}</h1>
              <div style={{ textAlign: 'center', fontSize: 12, color: C.muted, marginBottom: 16, borderBottom: `2px solid ${C.navy}`, paddingBottom: 10 }}>{ex.agency || '기관'} · 보고 {fmtDate(r.header.reportedAt)} · {r.header.reporter}{r.header.dept ? ` (${r.header.dept})` : ''}</div>
              {sec && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}><h2 style={{ fontSize: 15, margin: 0 }}>{sec.title}</h2>{sec.kind === 'fact' ? <Chip tone="green">사실 투영{sec.editedByUser ? ' · 직접 수정' : ''}</Chip> : <Chip tone="purple">AI 생성{sec.reviewed ? ' · 검토됨' : ' · 검토 필요'}</Chip>}<div style={{ flex: 1 }} />
                    {!locked && (edit === null ? <Btn small onClick={() => setEdit(sec.markdown)}>{sec.kind === 'fact' ? '표 편집' : '편집'}</Btn> : <><Btn small kind="primary" onClick={() => void saveEdit()}>저장</Btn><Btn small onClick={() => setEdit(null)}>취소</Btn></>)}
                  </div>
                  {edit !== null ? <><Textarea value={edit} onChange={(e) => setEdit(e.target.value)} style={{ minHeight: 320, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} />{sec.kind === 'fact' && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>표는 `| 칸 | 칸 |` 마크다운입니다. 피해 현황처럼 기록이 없는 칸은 여기서 채우세요. 직접 고친 절은 [사실 절 갱신]에서 보존됩니다.</div>}</> : (
                    <div style={{ background: sec.aiGenerated && !sec.reviewed ? '#eff5ff' : 'transparent', borderRadius: 8, padding: sec.aiGenerated && !sec.reviewed ? '8px 14px' : 0 }}>{renderMarkdown(sec.markdown)}</div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </Card>
      {/* 우: 머리 정보 · 내보내기 · 환류 */}
      <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {r && (
          <Card title="머리 정보 · 배부처 · 연계" pad={12}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '0 8px' }}>
              <Field label="보고자"><Input value={r.header.reporter} onChange={(e) => setHeader({ reporter: e.target.value })} disabled={locked} /></Field>
              <Field label="소속"><Input value={r.header.dept} onChange={(e) => setHeader({ dept: e.target.value })} disabled={locked} /></Field>
            </div>
            <Field label="연락처"><Input value={r.header.phone} onChange={(e) => setHeader({ phone: e.target.value })} disabled={locked} /></Field>
            <Field label="보고 일시"><Input type="datetime-local" value={toLocalInput(r.header.reportedAt)} onChange={(e) => setHeader({ reportedAt: new Date(e.target.value).toISOString() })} disabled={locked} /></Field>
            <Field label="배부처 (쉼표)"><Input value={r.header.distribution.join(', ')} onChange={(e) => setHeader({ distribution: e.target.value.split(/\s*,\s*/).filter(Boolean) })} disabled={locked} placeholder="시장, 부시장, ○○도 재난관리과" /></Field>
            <div style={{ fontSize: 11, color: C.muted, margin: '2px 0 4px' }}>KRMS 연계 필드(3차년도 T3Q 연동 대비 — 값만 보관)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) 64px', gap: '0 6px' }}>
              <Field label="기관코드"><Input value={r.header.krms.orgCode} onChange={(e) => setHeader({ krms: { ...r.header.krms, orgCode: e.target.value } })} disabled={locked} /></Field>
              <Field label="보고번호"><Input value={r.header.krms.reportNo} onChange={(e) => setHeader({ krms: { ...r.header.krms, reportNo: e.target.value } })} disabled={locked} /></Field>
              <Field label="차수"><Input value={r.header.krms.seq} onChange={(e) => setHeader({ krms: { ...r.header.krms, seq: e.target.value } })} disabled={locked} /></Field>
            </div>
            {!locked && <Btn small style={{ width: '100%' }} onClick={() => void saveHeader()}>머리 정보 저장</Btn>}
          </Card>
        )}
        <Card title="검토 필요 알림" pad={12} style={{ background: C.orangeBg, border: '1px solid #ffe0a3' }}><div style={{ fontSize: 12.5, lineHeight: 1.9 }}>· 미확인 담당자 <b>{unacked}</b>명<br />· 지연 임무 <b>{delayed}</b>건<br />· AI 생성 문장 검토 필요 <b>{aiNeed}</b>건</div></Card>
        {r && (
          <Card title="내보내기" pad={12}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>HWPX 템플릿(문서 스타일)</div>
            <Select value={hwpxTplId} onChange={(e) => setHwpxTplId(e.target.value)} style={{ marginBottom: 8, width: '100%' }} aria-label="HWPX 템플릿">{hwpxTpls.map((t) => <option key={t.id} value={t.id}>{t.name}{/상황보고/.test(t.fileName) ? ' (기본)' : ''}</option>)}</Select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
              <Btn kind="primary" disabled={!!busy} onClick={() => void exportAs('hwpx')}>{busy === 'hwpx' ? '생성 중…' : 'HWPX'}</Btn>
              <Btn kind={pdf && !pdf.available ? 'default' : 'primary'} disabled={!!busy} onClick={() => void exportAs('pdf')} title={pdf && !pdf.available ? 'PDF 변환용 브라우저가 서버 PC에 없습니다 — 누르면 설치 안내' : `HWPX를 쪽 그림으로 바꿔 ${pdf?.browser === 'edge' ? 'Edge' : '크롬'}으로 PDF를 만듭니다`}>{busy === 'pdf' ? '변환 중…' : pdf && !pdf.available ? 'PDF ⓘ' : 'PDF'}</Btn>
              <Btn kind="primary" disabled={!!busy} onClick={() => void exportAs('docx')}>{busy === 'docx' ? '생성 중…' : 'DOCX'}</Btn>
            </div>
            {pdf && !pdf.available && <div style={{ fontSize: 11, color: C.orange, marginBottom: 6 }}>PDF: 서버 PC에 Chrome/Edge가 없어 지금은 만들 수 없습니다. <a href="#" onClick={(e) => { e.preventDefault(); setGuide(PDF_GUIDE); }}>설치 안내</a></div>}
            <Btn style={{ width: '100%', marginBottom: 6 }} disabled={!!busy} onClick={openPreview} title="HWPX 쪽 단위 미리보기(rhwp) — 브라우저 설치와 무관">{busy === 'preview' ? '미리보기 준비 중…' : '미리보기'}</Btn>
            {(['hwpx', 'pdf', 'docx'] as const).map((f) => r.export?.[f] && <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.muted, marginBottom: 4 }}><span style={{ flex: 1 }}>{f.toUpperCase()} · {fmtDate(r.export![f]!.at)}{r.export![f]!.pages ? ` · ${r.export![f]!.pages}쪽` : ''}</span><Btn small onClick={() => void download(f)}>최근 파일</Btn></div>)}
          </Card>
        )}
        <Card title="계획서로 환류 (연동)" pad={12}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>지연·미완료 임무와 개선 필요사항을 계획서의 "개선사항 및 보완계획" 절에 넣습니다.</div>
          <Select value={linkPlan} onChange={(e) => setLinkPlan(e.target.value)} style={{ marginBottom: 6, width: '100%' }}><option value="">계획서 선택</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select>
          <Btn kind="primary" style={{ width: '100%' }} disabled={!linkPlan} onClick={() => void feedback()}>결과 → 계획서 반영</Btn>
          {linkPlan && <div style={{ marginTop: 6, fontSize: 11 }}><Link to={`/plan/${linkPlan}`}>계획서 열기 →</Link></div>}
        </Card>
      </div>
      {preview && r && (
        <Modal title={`미리보기 — ${r.title} (${preview.pages}쪽 중 ${preview.svgs.length}쪽)`} onClose={() => setPreview(null)} width={900}>
          <div style={{ background: '#f4f5f6', padding: 16, display: 'grid', gap: 16, maxHeight: '75vh', overflow: 'auto' }}>
            {preview.svgs.map((s, i) => <div key={i} className="hwp-page" dangerouslySetInnerHTML={{ __html: s }} />)}
          </div>
        </Modal>
      )}
      {guide && (
        <Modal title="PDF 내보내기 — 브라우저 설치 안내" onClose={() => setGuide(null)} width={560}>
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <p style={{ margin: '0 0 8px' }}>PDF는 서버 PC에 있는 Chrome 또는 Edge가 문서를 쪽 단위로 인쇄해 만듭니다(화면의 미리보기와는 다른 경로). 지금은 찾지 못했습니다.</p>
            <ol style={{ margin: 0, paddingLeft: 20 }}>{guide.map((g, i) => <li key={i} style={{ marginBottom: 4 }}>{g.split(URL_RE).map((part, j) => (/^https?:\/\//.test(part) ? <a key={j} href={part} target="_blank" rel="noreferrer">{part}</a> : part))}</li>)}</ol>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}><Btn onClick={() => { setGuide(null); void exportAs('hwpx'); }}>대신 HWPX로 내보내기</Btn><Btn kind="primary" onClick={() => setGuide(null)}>확인</Btn></div>
        </Modal>
      )}
      <Toast msg={toast} />
    </div>
  );
}
