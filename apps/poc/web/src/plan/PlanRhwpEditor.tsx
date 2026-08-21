import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, api, pickSaveLocation, writeFileTo, type Plan } from '../api';
import { Btn, C, Chip, Toast, useToast } from '../ui';

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
    const handle = await pickSaveLocation(plan.export.fileName);
    if (handle === 'cancelled') return;
    try { const how = await writeFileTo(handle, `/api/files/${plan.export.fileName}`, plan.export.fileName); show(how === 'saved' ? `저장했습니다: ${plan.export.fileName}` : '브라우저 다운로드 폴더에 저장했습니다'); }
    catch (e) { show((e as Error).message); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', background: '#fff', borderBottom: `1px solid ${C.border}` }}>
        <Link to={`/plan/${id}`} style={{ color: C.muted, fontSize: 12 }}>← 문서로</Link>
        <b>{plan?.title ?? ''}</b> <Chip tone="purple">rhwp 웹 한글 에디터</Chip>
        <span style={{ fontSize: 12, color: C.muted }}>{status}</span>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" disabled={!ready} onClick={() => void saveBack()}>편집본 서버에 저장 (HWPX)</Btn>
        {plan?.export && <Btn onClick={() => void download()} title="저장 위치를 고른 뒤 HWPX를 저장합니다">원본 다운로드</Btn>}
      </div>
      <div ref={boxRef} style={{ flex: 1, minHeight: 0 }} />
      <Toast msg={toast} />
    </div>
  );
}
