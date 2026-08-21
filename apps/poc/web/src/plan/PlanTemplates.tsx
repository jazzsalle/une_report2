import { useEffect, useRef, useState } from 'react';
import { api, get, type Template } from '../api';
import { Toast, useToast } from '../ui';
import { Icon, KBadge, KBtn, KCard, KModal, KTable } from '../krds';

/** PLAN-01 HWPX 템플릿 업로드 → 스타일 프로파일 (문단개요번호·글꼴·크기·굵기) */
export function PlanTemplates() {
  const [list, setList] = useState<Template[]>([]);
  const [sel, setSel] = useState<Template | null>(null);
  const [preview, setPreview] = useState<{ pages: number; htmls: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, show] = useToast();
  const load = () => get<Template[]>('/templates').then(setList);
  useEffect(() => { void load(); }, []);
  const open = async (t: Template) => { const full = await get<Template>(`/templates/${t.id}`); setSel(full); setPreview(null); };
  const upload = async (f: File) => {
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', f); const t = await api<Template>('POST', '/templates', undefined, fd); show(`분석 완료: ${t.levels.length}수준 · ${t.styleCount}스타일`); await load(); await open(t); }
    catch (e) { show((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 24, display: 'grid', gridTemplateColumns: '380px minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
      <h1 className="sr-only">HWPX 템플릿 · 스타일 분석</h1>
      <KCard title="HWPX 템플릿" right={<KBtn kind="primary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" /> {busy ? '분석 중…' : '업로드'}</KBtn>}>
        <input ref={fileRef} type="file" accept=".hwpx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <p className="card-desc" style={{ marginBottom: 16 }}>업로드하면 rhwp 엔진이 문단개요번호·기호·글꼴·크기·굵기·스타일을 읽어 프로파일을 만듭니다. 이 프로파일이 목차·초안 생성과 HWPX 내보내기에 적용됩니다.</p>
        <div className="stack" style={{ gap: 8 }}>
          {list.map((t) => (
            <button type="button" key={t.id} className={`tpl-card${sel?.id === t.id ? ' sel' : ''}`} style={{ minWidth: 0 }} onClick={() => void open(t)} aria-pressed={sel?.id === t.id}>
              <span className="row" style={{ justifyContent: 'space-between' }}><strong>{t.name}</strong>{t.builtin ? <KBadge>내장</KBadge> : <KBadge tone="light-primary">업로드</KBadge>}</span>
              <span className="meta">{t.levels.length}수준 · 스타일 {t.styleCount} · 본문 {t.bodyFontFamily ?? '-'} {t.bodyFontSizePt ?? '?'}pt</span>
              <span className="lv">{t.levels.map((l) => <span key={l.level}>{l.bullet || '·'} {l.fontSizePt}pt{l.bold ? ' B' : ''}</span>)}</span>
            </button>
          ))}
          {!list.length && <p className="card-desc">등록된 템플릿이 없습니다.</p>}
        </div>
      </KCard>
      <div className="stack">
        {!sel ? <KCard><p className="card-desc" style={{ textAlign: 'center', padding: 32 }}>왼쪽에서 템플릿을 선택하면 분석 결과가 표시됩니다.</p></KCard> : (
          <>
            <KCard title={`스타일 프로파일 — ${sel.name}`} desc={<KBadge tone="light-success">rhwp 분석</KBadge>} right={<KBtn size="sm" onClick={async () => setPreview(await get(`/templates/${sel.id}/preview`))}>원본 미리보기</KBtn>}>
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>문단 개요 수준 (자동 인식)</h3>
              <KTable compact caption="템플릿에서 인식한 문단 개요 수준" head={['수준', '기호', '글꼴', '크기', '굵게', '들여쓰기', '스타일', '표본']} rows={sel.levels.map((l) => [
                <strong>{l.level}수준</strong>, <span style={{ fontSize: 18 }}>{l.bullet || '—'}</span>, l.fontFamily ?? '-', <span className="num">{l.fontSizePt ? `${l.fontSizePt}pt` : '-'}</span>, l.bold ? '굵게' : '-', <span className="num">{l.indentHu ? Math.round(l.indentHu / 100) : 0}</span>, l.styleName ?? <span className="dim">본문 폴백</span>, <span className="dim">{l.sampleText}</span>,
              ])} />
              <div className="form-grid" style={{ marginTop: 16, fontSize: 15 }}>
                <div><strong>본문</strong> {sel.bodyFontFamily ?? '-'} {sel.bodyFontSizePt ?? '?'}pt</div>
                <div><strong>쪽수</strong> {sel.pageCount} · <strong>스타일 정의</strong> {sel.styleCount}개 · <strong>사용 글꼴</strong> {sel.profile?.fontsUsed.length ?? 0}종</div>
                {sel.profile?.numbering[0]?.levelFormats?.length ? <div style={{ gridColumn: '1 / -1' }}><strong>개요번호 형식</strong> <span className="num">{sel.profile.numbering[0].levelFormats.slice(0, 6).join('  ')}</span></div> : null}
              </div>
              <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>표 스타일 (견본 표에서 인식)</h3>
              {sel.tableStyle ? (
                <div className="stack" style={{ gap: 10 }}>
                  <KTable compact caption="견본 표의 셀 종류별 모양" head={['셀', '배경', '글꼴', '정렬·여백']} rows={([['머리행', sel.tableStyle.header], ['첫 열', sel.tableStyle.firstCol], ['본문', sel.tableStyle.body]] as const).map(([k, c]) => [
                    <strong>{k}</strong>,
                    <span className="row" style={{ gap: 6 }}><span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 4, border: '1px solid #cdd1d5', background: c.fillType !== 'none' ? c.fillColor : '#fff' }} /><span className="num">{c.fillType !== 'none' ? c.fillColor : '없음'}</span></span>,
                    `${c.font.fontFamily ?? '-'} ${c.font.fontSizePt ?? '?'}pt${c.font.bold ? ' 굵게' : ''}`,
                    <span className="num">{c.verticalAlign === 1 ? '세로 가운데' : '세로 위'} · 여백 {Math.round(c.paddingLeft / 100)}/{Math.round(c.paddingTop / 100)}</span>,
                  ])} />
                  <p className="form-hint">견본 표 {sel.tableStyle.rows}×{sel.tableStyle.cols} · 열 너비 비율 {(() => { const t = sel.tableStyle!.colWidths.reduce((a, b) => a + b, 0) || 1; return sel.tableStyle!.colWidths.map((w) => Math.round((w / t) * 100)).join(' : '); })()}{sel.tableStyle.table.repeatHeader ? ' · 머리행 반복' : ''} — 내보내기 표와 웹 미리보기 표에 이 모양을 적용합니다. 생성 표의 열 수가 다르면 첫 열 비율을 지키고 나머지를 균등 배분합니다.</p>
                </div>
              ) : <p className="form-hint">템플릿에 행·열이 2개 이상인 표가 없어 표 스타일을 읽지 못했습니다. 내보내기 표는 기본 모양(흰 배경·균등 열)으로 만들어지고 글꼴만 본문을 따릅니다.</p>}
              <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>LLM에 전달되는 스타일 규칙</h3>
              <pre style={{ margin: 0, background: '#f4f5f6', border: '1px solid #cdd1d5', borderRadius: 8, padding: '12px 16px', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{sel.styleRuleText}</pre>
            </KCard>
            <KCard title="문단별 인식 결과 (원본)">
              <KTable compact caption="원본 문서의 문단별 스타일 인식 결과" head={['#', '스타일', '크기', '굵게', '기호', '텍스트']} rows={(sel.profile?.paragraphs ?? []).filter((p) => p.text.trim()).map((p) => [<span className="num">{p.idx}</span>, p.styleName, <span className="num">{p.fontSizePt ?? '-'}</span>, p.bold ? '굵게' : '-', p.bullet, p.text.slice(0, 80)])} />
            </KCard>
          </>
        )}
      </div>
      {preview && sel && (
        <KModal title={`원본 미리보기 — ${sel.name} (${preview.pages}쪽 중 ${preview.htmls.length}쪽)`} onClose={() => setPreview(null)} width={900}>
          <div style={{ background: '#f4f5f6', padding: 16, display: 'grid', gap: 16, justifyItems: 'center', maxHeight: '75vh', overflow: 'auto' }}>
            {preview.htmls.map((h, i) => <div key={i} style={{ background: '#fff', border: '1px solid #cdd1d5', transform: 'scale(.85)', transformOrigin: 'top center', marginBottom: -140 }} dangerouslySetInnerHTML={{ __html: h }} />)}
          </div>
        </KModal>
      )}
      <Toast msg={toast} />
    </div>
  );
}
