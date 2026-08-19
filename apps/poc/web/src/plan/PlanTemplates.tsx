import { useEffect, useRef, useState } from 'react';
import { api, get, type Template } from '../api';
import { Btn, C, Card, Chip, Empty, Modal, Table, Toast, useToast } from '../ui';

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
    <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'start' }}>
      <div>
        <Card title="HWPX 템플릿" right={<Btn kind="primary" small disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? '분석 중…' : '+ 업로드'}</Btn>}>
          <input ref={fileRef} type="file" accept=".hwpx" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>업로드하면 rhwp 엔진이 문단개요번호·기호·글꼴·크기·굵기·스타일을 읽어 프로파일을 만듭니다. 이 프로파일이 목차·초안 생성과 HWPX 내보내기에 적용됩니다.</div>
          {list.map((t) => (
            <div key={t.id} onClick={() => void open(t)} style={{ padding: 10, border: `1px solid ${sel?.id === t.id ? C.blue : C.border}`, background: sel?.id === t.id ? C.blueLight : '#fff', borderRadius: 8, marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b style={{ fontSize: 13 }}>{t.name}</b>{t.builtin && <Chip>내장</Chip>}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{t.levels.length}수준 · 스타일 {t.styleCount} · 본문 {t.bodyFontFamily ?? '-'} {t.bodyFontSizePt ?? '?'}pt</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>{t.levels.map((l) => <Chip key={l.level} tone="gray">{l.bullet || '·'} {l.fontSizePt}pt{l.bold ? ' B' : ''}</Chip>)}</div>
            </div>
          ))}
        </Card>
      </div>
      <div>
        {!sel ? <Card><Empty>왼쪽에서 템플릿을 선택하면 분석 결과가 표시됩니다.</Empty></Card> : (
          <>
            <Card title={`스타일 프로파일 — ${sel.name}`} right={<div style={{ display: 'flex', gap: 6 }}><Btn small onClick={async () => setPreview(await get(`/templates/${sel.id}/preview`))}>원본 미리보기</Btn></div>} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>문단 개요 수준 (자동 인식)</div>
              <Table small head={['수준', '기호', '글꼴', '크기', '굵게', '들여쓰기', '스타일', '표본']} rows={sel.levels.map((l) => [
                <b>{l.level}수준</b>, <span style={{ fontSize: 16 }}>{l.bullet || '—'}</span>, l.fontFamily ?? '-', l.fontSizePt ? `${l.fontSizePt}pt` : '-', l.bold ? '●' : '', l.indentHu ? Math.round(l.indentHu / 100) : 0, l.styleName ?? <span style={{ color: C.muted }}>본문 폴백</span>, <span style={{ color: C.muted }}>{l.sampleText}</span>,
              ])} />
              <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                <div><b>본문</b> {sel.bodyFontFamily ?? '-'} {sel.bodyFontSizePt ?? '?'}pt</div>
                <div><b>쪽수</b> {sel.pageCount} · <b>스타일 정의</b> {sel.styleCount}개 · <b>사용 글꼴</b> {sel.profile?.fontsUsed.length ?? 0}종</div>
                {sel.profile?.numbering[0]?.levelFormats?.length ? <div style={{ gridColumn: '1/-1' }}><b>개요번호 형식</b> {sel.profile.numbering[0].levelFormats.slice(0, 6).join('  ')}</div> : null}
              </div>
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>LLM에 전달되는 스타일 규칙</div>
                <pre style={{ background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{sel.styleRuleText}</pre>
              </div>
            </Card>
            <Card title="문단별 인식 결과 (원본)">
              <Table small head={['#', '스타일', '크기', 'B', '기호', '텍스트']} rows={(sel.profile?.paragraphs ?? []).filter((p) => p.text.trim()).map((p) => [p.idx, p.styleName, p.fontSizePt ?? '-', p.bold ? '●' : '', p.bullet, <span style={{ fontFamily: 'inherit' }}>{p.text.slice(0, 80)}</span>])} />
            </Card>
          </>
        )}
      </div>
      {preview && sel && (
        <Modal title={`원본 미리보기 — ${sel.name} (${preview.pages}쪽 중 ${preview.htmls.length}쪽)`} onClose={() => setPreview(null)} width={900}>
          <div style={{ background: '#e5e7eb', padding: 16, display: 'grid', gap: 16, justifyItems: 'center', maxHeight: '75vh', overflow: 'auto' }}>
            {preview.htmls.map((h, i) => <div key={i} style={{ background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,.15)', transform: 'scale(.85)', transformOrigin: 'top center', marginBottom: -140 }} dangerouslySetInnerHTML={{ __html: h }} />)}
          </div>
        </Modal>
      )}
      <Toast msg={toast} />
    </div>
  );
}
