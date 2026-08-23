import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, post, put, fmtDT, type PlanContext, type PlanSummary } from '../api';
import { useUser } from '../ui';
import { KBtn, KField, KInput, KModal } from '../krds';

export interface NewDocSource { id: string; name: string; context: PlanContext }
/** "빈 문서" — 기준정보 기본값만 가진 출발점 */
export const EMPTY_DOC: NewDocSource = { id: '', name: '빈 문서', context: { subject: '', hazardType: '폭염', managementPhase: '대비', audience: '지자체', templateId: null } };

/** "문서 저장" 모달(SCR-CADM-302001): 기준정보 템플릿 또는 빈 문서로 새 문서를 만들고 기준정보 화면으로 이동. 문서 관리·기준정보 템플릿 목록이 함께 쓴다. */
export function NewDocModal({ source, onClose }: { source: NewDocSource; onClose: () => void }) {
  const [user] = useUser();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  // 중복 이름 정책(가, 2026-08-23): 같은 이름이 있어도 만들 수 있되 경고한다 — 기관에서는 연도·차수별 같은 제목이 흔하다
  const [all, setAll] = useState<PlanSummary[]>([]);
  useEffect(() => { get<PlanSummary[]>('/plans').then(setAll).catch(() => {}); }, []);
  const dup = all.filter((p) => p.title.trim() === title.trim());
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const p = await post<{ id: string }>('/plans', { title: title.trim(), createdBy: user?.name ?? '사용자' });
      await put(`/plans/${p.id}/context`, { ...source.context, updatedBy: user?.name });
      nav(`/plan/${p.id}`);
    } finally { setBusy(false); }
  };
  return (
    <KModal title="문서 저장" onClose={onClose} desc={<>{source.id ? `템플릿 "${source.name}"의 기준정보로 시작합니다.` : '빈 문서로 시작합니다.'} 문서 명을 입력하세요 (최대 20자).</>}>
      <KField label="문서 명" required htmlFor="newdoc-title" hint="저장 후 기준정보 입력 화면으로 이동합니다.">
        <KInput id="newdoc-title" autoFocus maxLength={20} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 2026 폭염 대비 계획서" onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
      </KField>
      {dup.length > 0 && <p role="alert" style={{ margin: '-6px 0 10px', fontSize: 13, color: '#c2410c' }}>같은 이름의 문서가 이미 {dup.length}건 있습니다 ({dup.slice(0, 2).map((d) => `${d.createdBy} · ${fmtDT(d.createdAt).slice(0, 10)}`).join(', ')}{dup.length > 2 ? ' 외' : ''}). 그대로 만들 수 있지만 목록에서 구분하기 어려울 수 있습니다.</p>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={onClose}>취소</KBtn><KBtn kind="primary" size="sm" disabled={!title.trim() || busy} onClick={() => void create()}>{dup.length ? '그래도 저장하기' : '저장하기'}</KBtn></div>
    </KModal>
  );
}
