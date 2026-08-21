import { useEffect, useState } from 'react';
import { del, get, put, ago, HAZARDS, type PlanContext, type PlanTemplate, type Template } from '../api';
import { Toast, useToast, useUser } from '../ui';
import { KBadge, KBtn, KCard, KField, KInput, KModal, KSelect, KTable } from '../krds';
import { NewDocModal, type NewDocSource } from './NewDocModal';

/** 기준정보 템플릿 전체 목록(SCR-CADM-302002) — 문서 관리의 카드 줄(201001)과 같은 데이터를 표로 보고 상세(303001)·이름 변경·삭제(304005/304007)·새 문서 시작을 한다.
 *  설계서 대비 미구현: 정렬·N개 보기·페이지네이션, 기준정보 전 항목 편집(303001 편집하기), 새 템플릿 등록 화면(303002) — 등록은 기준정보 입력 화면의 [템플릿 등록하기]로. */
export function PlanBasisTemplates() {
  const [user] = useUser();
  const [list, setList] = useState<PlanTemplate[]>([]);
  const [hwpx, setHwpx] = useState<Template[]>([]);
  const [q, setQ] = useState('');
  const [hazard, setHazard] = useState('');
  const [phase, setPhase] = useState('');
  const [mine, setMine] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState<PlanTemplate[] | null>(null);
  const [detail, setDetail] = useState<PlanTemplate | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [newDoc, setNewDoc] = useState<NewDocSource | null>(null);
  const [toast, show] = useToast();
  const load = () => { get<PlanTemplate[]>('/plan-templates').then((l) => setList([...l].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))); };
  useEffect(() => { load(); get<Template[]>('/templates').then(setHwpx).catch(() => {}); }, []);
  const hwpxName = (c: PlanContext) => (c.templateId ? hwpx.find((t) => t.id === c.templateId)?.name ?? '(삭제됨)' : '-');
  const filtered = list.filter((t) => (!q || t.name.includes(q) || (t.context.subject ?? '').includes(q)) && (!hazard || t.context.hazardType === hazard) && (!phase || t.context.managementPhase === phase) && (!mine || t.createdBy === user?.name));
  const toggle = (id: string, on: boolean) => { const s = new Set(checked); on ? s.add(id) : s.delete(id); setChecked(s); };
  const remove = async (targets: PlanTemplate[]) => { for (const t of targets) await del(`/plan-templates/${t.id}`); setChecked(new Set()); setConfirmDel(null); setDetail(null); show(`${targets.length}개 삭제되었습니다`); load(); };
  const rename = async () => { if (!renaming?.name.trim()) return; await put(`/plan-templates/${renaming.id}`, { name: renaming.name.trim(), updatedBy: user?.name }); setRenaming(null); show('이름이 변경되었습니다'); load(); };
  const fields: [string, (c: PlanContext) => string | undefined][] = [
    ['문서 주제', (c) => c.subject], ['재난유형', (c) => c.hazardType], ['재난관리단계', (c) => c.managementPhase], ['장소', (c) => c.place], ['재난발생일시', (c) => c.occurredAt], ['보고일시', (c) => c.reportedAt],
    ['출처', (c) => c.sources], ['필수 포함 요소', (c) => c.requiredElements], ['작성 가이드', (c) => c.writingGuide],
    ['문체', (c) => c.tone], ['문장길이 제한', (c) => c.sentenceLimit], ['문단 개요번호 모양', (c) => c.outlineNumbering], ['본문 문장 시작', (c) => c.bodyStart],
    ['업무 목적', (c) => c.purpose], ['역할', (c) => c.role], ['타깃 독자', (c) => c.audience], ['HWPX 템플릿', (c) => hwpxName(c)],
  ];
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 24 }}>
      <h1 className="sr-only">기준정보 템플릿</h1>
      <KCard title={<>기준정보 템플릿 <span className="dim" style={{ fontWeight: 400, fontSize: 15 }}>({filtered.length}/{list.length})</span></>} right={
        <div className="row">
          <KInput className="search" placeholder="템플릿명·문서 주제 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} aria-label="템플릿 검색" />
          <KSelect value={hazard} onChange={(e) => setHazard(e.target.value)} style={{ width: 150 }} aria-label="재난유형"><option value="">재난유형 전체</option>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</KSelect>
          <KSelect value={phase} onChange={(e) => setPhase(e.target.value)} style={{ width: 120 }} aria-label="재난관리단계"><option value="">단계 전체</option><option>예방</option><option>대비</option></KSelect>
          <label className="row" style={{ fontSize: 15, gap: 6, whiteSpace: 'nowrap' }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ width: 18, height: 18 }} /> 내 템플릿</label>
        </div>}>
        <p className="card-desc" style={{ marginBottom: 16 }}>기준정보 입력 화면의 [템플릿 등록하기]로 저장한 기준정보 묶음입니다. 문서 관리 화면의 카드와 같은 목록이며, 여기서는 내용 확인·이름 변경·삭제를 할 수 있습니다.</p>
        {checked.size > 0 && (
          <div className="row" style={{ background: '#eff5ff', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 15 }}>
            <strong>{checked.size}개 선택</strong>
            <KBtn size="xs" kind="danger" onClick={() => setConfirmDel(list.filter((t) => checked.has(t.id)))}>삭제</KBtn>
            <KBtn size="xs" onClick={() => setChecked(new Set())}>선택 취소</KBtn>
          </div>
        )}
        <KTable caption="기준정보 템플릿 목록" widths={['40px', undefined, undefined, '8%', '8%', '7%', '11%', '7%', '7%', '11%', '8%', '20%']} emptyText="저장된 기준정보 템플릿이 없습니다. 기준정보 입력 화면의 [템플릿 등록하기]로 만들 수 있습니다."
          head={[<span className="sr-only">선택</span>, '템플릿명', '문서 주제', '재난유형', '재난관리단계', '타깃 독자', 'HWPX 템플릿', '생성자', '수정자', '생성 일시', '수정 일시', <span className="sr-only">작업</span>]}
          rows={filtered.map((t) => [
            <input type="checkbox" aria-label={`${t.name} 선택`} checked={checked.has(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} style={{ width: 18, height: 18 }} />,
            <button type="button" className="k-btn text sm" style={{ fontWeight: 700, padding: 0, height: 'auto' }} onClick={() => setDetail(t)}>{t.name}</button>,
            <span className="dim">{t.context.subject || '-'}</span>,
            <KBadge tone="light-primary">{t.context.hazardType}</KBadge>, t.context.managementPhase, t.context.audience ?? '-', hwpxName(t.context),
            t.createdBy, t.updatedBy ?? t.createdBy, <span className="num">{new Date(t.createdAt).toLocaleString('ko-KR')}</span>, <span className="num">{ago(t.updatedAt)}</span>,
            <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
              <KBtn size="xs" kind="secondary" onClick={() => setNewDoc({ id: t.id, name: t.name, context: t.context })}>새 문서</KBtn>
              <KBtn size="xs" onClick={() => setRenaming({ id: t.id, name: t.name })}>이름 변경</KBtn>
              <KBtn size="xs" kind="danger" onClick={() => setConfirmDel([t])}>삭제</KBtn>
            </span>,
          ])} />
      </KCard>

      {detail && (
        <KModal title={`기준정보 템플릿 — ${detail.name}`} onClose={() => setDetail(null)} width={720} desc={<>{detail.createdBy} · 등록 {new Date(detail.createdAt).toLocaleString('ko-KR')} · 수정 {ago(detail.updatedAt)}</>}>
          <KTable compact caption="템플릿에 저장된 기준정보" widths={['28%', undefined]} head={['항목', '값']} rows={fields.map(([k, f]) => [<strong>{k}</strong>, f(detail.context) || <span className="dim">-</span>])} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <KBtn size="sm" kind="danger" onClick={() => setConfirmDel([detail])}>삭제</KBtn>
            <KBtn size="sm" onClick={() => setRenaming({ id: detail.id, name: detail.name })}>이름 변경</KBtn>
            <KBtn size="sm" kind="primary" onClick={() => { setNewDoc({ id: detail.id, name: detail.name, context: detail.context }); setDetail(null); }}>이 템플릿으로 새 문서</KBtn>
          </div>
        </KModal>
      )}
      {renaming && (
        <KModal title="템플릿 이름 변경" onClose={() => setRenaming(null)}>
          <KField label="템플릿 명" required htmlFor="tpl-rename"><KInput id="tpl-rename" autoFocus maxLength={20} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void rename(); }} /></KField>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setRenaming(null)}>취소</KBtn><KBtn kind="primary" size="sm" disabled={!renaming.name.trim()} onClick={() => void rename()}>저장하기</KBtn></div>
        </KModal>
      )}
      {confirmDel && (
        <KModal title="삭제하기" onClose={() => setConfirmDel(null)}>
          <p style={{ fontSize: 15 }}>{confirmDel.length === 1 ? `템플릿 "${confirmDel[0].name}"을(를)` : `선택한 템플릿 ${confirmDel.length}개를`} 삭제합니다. 이 템플릿으로 이미 만든 문서에는 영향이 없으며, 되돌릴 수 없습니다.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setConfirmDel(null)}>취소</KBtn><KBtn kind="danger" size="sm" onClick={() => void remove(confirmDel)}>삭제하기</KBtn></div>
        </KModal>
      )}
      {newDoc && <NewDocModal source={newDoc} onClose={() => setNewDoc(null)} />}
      <Toast msg={toast} />
    </div>
  );
}
