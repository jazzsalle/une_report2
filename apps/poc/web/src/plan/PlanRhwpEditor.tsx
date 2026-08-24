import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, api, pickSaveLocation, writeFileTo, type Plan } from '../api';
import { Toast, useToast } from '../ui';
import { Icon, KBadge, KBtn } from '../krds';

/**
 * 4-1 경로: @rhwp/editor(iframe 웹 한글 에디터)에 내보낸 HWPX를 로드 → 사용자가 직접 편집 → exportHwpx로 서버에 되돌린다.
 * studio는 외부(edwardkim.github.io) — 인터넷 필요. 선택 텍스트를 호스트로 가져오는 공개 API가 없어 챗봇 수정은 4-2 화면에서 한다.
 */
export function PlanRhwpEditor() {
  const { id = '' } = useParams();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [status, setStatus] = useState('에디터 로딩 중… (studio: edwardkim.github.io)');
  const [ready, setReady] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{ loadFile: (b: ArrayBuffer, n: string) => Promise<{ pageCount: number }>; exportHwpx: () => Promise<Uint8Array>; destroy: () => void } | null>(null);
  const [toast, show] = useToast();
  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await get<Plan>(`/plans/${id}`); if (!alive) return; setPlan(p);
      if (!p.export) { setStatus('먼저 HWPX로 내보내세요.'); return; }
      try {
        const mod = await import('@rhwp/editor');
        const ed = await (mod as { createEditor: (el: HTMLElement, o?: Record<string, unknown>) => Promise<typeof editorRef.current> }).createEditor(boxRef.current!, { height: '100%' });
        if (!alive) { ed?.destroy(); return; }
        editorRef.current = ed;
        const buf = await (await fetch(`/api/files/${p.export.fileName}`)).arrayBuffer();
        const r = await ed!.loadFile(buf, p.export.fileName);
        setStatus(`${p.export.fileName} 로드 완료 · ${r.pageCount}쪽`); setReady(true);
      } catch (e) { setStatus(`에디터 로드 실패: ${(e as Error).message} (인터넷 연결 필요)`); }
    })();
    return () => { alive = false; editorRef.current?.destroy(); };
  }, [id]);
  const saveBack = async () => {
    if (!editorRef.current || !plan) return;
    try {
      const bytes = await editorRef.current.exportHwpx();
      const fd = new FormData(); fd.append('file', new Blob([bytes as BlobPart], { type: 'application/octet-stream' }), `${plan.title}.hwpx`);
      const r = await api<{ fileName: string; paragraphs: number }>('POST', `/plans/${plan.id}/import-hwpx`, undefined, fd);
      show(`서버에 저장됨: ${r.fileName} (${r.paragraphs}문단)`);
    } catch (e) { show((e as Error).message); }
  };
  const download = async () => {
    if (!plan?.export) return;
    const handle = await pickSaveLocation(`${plan.title}.hwpx`); // 기본 파일명은 문서명(2026-08-24)
    if (handle === 'cancelled') return;
    try { const how = await writeFileTo(handle, `/api/files/${plan.export.fileName}`, `${plan.title}.hwpx`); show(how === 'saved' ? `저장했습니다: ${plan.export.fileName}` : '브라우저 다운로드 폴더에 저장했습니다'); }
    catch (e) { show((e as Error).message); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <div className="band">
        <div className="wrap console">
          <Link to={`/plan/${id}`} className="back"><Icon name="back" /> 문서로</Link>
          <div className="doc-tit"><strong>{plan?.title ?? ''}</strong><span>{status}</span></div>
          <KBadge tone="light-primary">rhwp 웹 한글 에디터</KBadge>
          <span className="tiny dim">외부 studio(edwardkim.github.io) iframe · 인터넷 연결 필요</span>
          <div style={{ flex: 1 }} />
          {plan?.export && <KBtn size="sm" onClick={() => void download()} title="저장 위치를 고른 뒤 HWPX를 저장합니다"><Icon name="download" /> 원본 다운로드</KBtn>}
          <KBtn kind="primary" size="sm" disabled={!ready} onClick={() => void saveBack()}>편집본 서버에 저장 (HWPX)</KBtn>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, margin: 24, border: '1px solid #cdd1d5', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
        <div ref={boxRef} style={{ height: '100%' }} />
      </div>
      <Toast msg={toast} />
    </div>
  );
}
