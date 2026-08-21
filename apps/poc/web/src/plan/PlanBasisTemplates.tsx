import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { del, get, put, ago, HAZARDS, type PlanContext, type PlanTemplate, type Template } from '../api';
import { Toast, useToast, useUser } from '../ui';
import { KBadge, KBtn, KCard, KField, KInput, KModal, KSelect, KTable, Pager, SortTh } from '../krds';
import { NewDocModal, type NewDocSource } from './NewDocModal';
import { HazardIcon } from './HeroCards';

type SortKey = 'name' | 'hazardType' | 'createdBy' | 'updatedBy' | 'createdAt' | 'updatedAt';
const PAGE_SIZES = [30, 50, 70, 100]; // 설계서 302002 ⑤ "N개 보기"

/** 기준정보 템플릿 전체 목록(SCR-CADM-302002) — 문서 관리의 카드 줄(201001)과 같은 데이터를 표로 보고 정렬·검색·필터·페이지, 이름 변경, 삭제(304005/304007), 새 문서 시작을 한다.
 *  템플릿명을 누르면 상세/편집 페이지(303001)로 간다. 등록은 기준정보 입력 화면의 [템플릿 등록하기]로(303002 전용 화면은 범위 밖). */
export function PlanBasisTemplates() {
  const [user] = useUser();
  const [list, setList] = useState<PlanTemplate[]>([]);
  const [hwpx, setHwpx] = useState<Template[]>([]);
  const [q, setQ] = useState('');
  const [hazard, setHazard] = useState('');
  const [phase, setPhase] = useState('');
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'updatedAt', dir: 'desc' });
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirmDel, setConfirmDel] = useState<PlanTemplate[] | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [newDoc, setNewDoc] = useState<NewDocSource | null>(null);
  const [toast, show] = useToast();
  const load = () => { get<PlanTemplate[]>('/plan-templates').then(setList); };
  useEffect(() => { load(); get<Template[]>('/templates').then(setHwpx).catch(() => {}); }, []);
  useEffect(() => { setPage(1); }, [q, hazard, phase, mine, sort, pageSize]);
  const hwpxName = (c: PlanContext) => (c.templateId ? hwpx.find((t) => t.id === c.templateId)?.name ?? '(삭제됨)' : '-');
  const filtered = useMemo(() => {
    const f = list.filter((t) => (!q || t.name.includes(q) || (t.context.subject ?? '').includes(q)) && (!hazard || t.context.hazardType === hazard) && (!phase || t.context.managementPhase === phase) && (!mine || t.createdBy === user?.name));
    const val = (t: PlanTemplate): string => sort.key === 'hazardType' ? t.context.hazardType : sort.key === 'updatedBy' ? t.updatedBy ?? t.createdBy : t[sort.key];
    return [...f].sort((a, b) => val(a).localeCompare(val(b), 'ko') * (sort.dir === 'asc' ? 1 : -1));
  }, [list, q, hazard, phase, mine, sort, user?.name]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'createdBy' || key === 'updatedBy' || key === 'hazardType' ? 'asc' : 'desc' }));
  const th = (label: string, key: SortKey) => <SortTh label={label} active={sort.key === key} dir={sort.dir} onClick={() => toggleSort(key)} />;
  const toggle = (id: string, on: boolean) => { const s = new Set(checked); on ? s.add(id) : s.delete(id); setChecked(s); };
  const remove = async (targets: PlanTemplate[]) => { for (const t of targets) await del(`/plan-templates/${t.id}`); setChecked(new Set()); setConfirmDel(null); show(`${targets.length}개 삭제되었습니다`); load(); };
  const rename = async () => { if (!renaming?.name.trim()) return; await put(`/plan-templates/${renaming.id}`, { name: renaming.name.trim(), updatedBy: user?.name }); setRenaming(null); show('이름이 변경되었습니다'); load(); };
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 24 }}>
      <h1 className="sr-only">기준정보 템플릿</h1>
      <KCard title={<>기준정보 템플릿 <span className="dim" style={{ fontWeight: 400, fontSize: 15 }}>({filtered.length}/{list.length})</span></>} right={
        <div className="row">
          <KInput className="search" placeholder="템플릿명·문서 주제 검색" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} aria-label="템플릿 검색" />
          <KSelect value={hazard} onChange={(e) => setHazard(e.target.value)} style={{ width: 150 }} aria-label="재난유형"><option value="">재난유형 전체</option>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</KSelect>
          <KSelect value={phase} onChange={(e) => setPhase(e.target.value)} style={{ width: 120 }} aria-label="재난관리단계"><option value="">단계 전체</option><option>예방</option><option>대비</option></KSelect>
          <label className="row" style={{ fontSize: 15, gap: 6, whiteSpace: 'nowrap' }}><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} style={{ width: 18, height: 18 }} /> 내 템플릿</label>
          <KSelect value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ width: 120 }} aria-label="한 쪽에 보일 개수">{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}개 보기</option>)}</KSelect>
        </div>}>
        <p className="card-desc" style={{ marginBottom: 16 }}>기준정보 입력 화면의 [템플릿 등록하기]로 저장한 기준정보 묶음입니다. 템플릿명을 누르면 내용을 보고 고칠 수 있습니다. 열 머리글을 누르면 정렬됩니다.</p>
        {checked.size > 0 && (
          <div className="row" style={{ background: '#eff5ff', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 15 }}>
            <strong>{checked.size}개 선택</strong>
            <KBtn size="xs" kind="danger" onClick={() => setConfirmDel(list.filter((t) => checked.has(t.id)))}>삭제</KBtn>
            <KBtn size="xs" onClick={() => setChecked(new Set())}>선택 취소</KBtn>
          </div>
        )}
        <KTable caption="기준정보 템플릿 목록" widths={['40px', undefined, undefined, '8%', '8%', '7%', '11%', '7%', '7%', '11%', '8%', '20%']} emptyText="저장된 기준정보 템플릿이 없습니다. 기준정보 입력 화면의 [템플릿 등록하기]로 만들 수 있습니다."
          head={[<span className="sr-only">선택</span>, th('템플릿명', 'name'), '문서 주제', th('재난유형', 'hazardType'), '재난관리단계', '타깃 독자', 'HWPX 템플릿', th('생성자', 'createdBy'), th('수정자', 'updatedBy'), th('생성 일시', 'createdAt'), th('수정 일시', 'updatedAt'), <span className="sr-only">작업</span>]}
          rows={pageRows.map((t) => [
            <input type="checkbox" aria-label={`${t.name} 선택`} checked={checked.has(t.id)} onChange={(e) => toggle(t.id, e.target.checked)} style={{ width: 18, height: 18 }} />,
            <Link to={`/plan/basis-templates/${t.id}`} style={{ fontWeight: 700 }}>{t.name}</Link>,
            <span className="dim">{t.context.subject || '-'}</span>,
            <span className="row" style={{ gap: 6, whiteSpace: 'nowrap' }}><HazardIcon hazard={t.context.hazardType} size={24} />{t.context.hazardType}</span>, t.context.managementPhase, t.context.audience ?? '-', hwpxName(t.context),
            t.createdBy, t.updatedBy ?? t.createdBy, <span className="num">{new Date(t.createdAt).toLocaleString('ko-KR')}</span>, <span className="num">{ago(t.updatedAt)}</span>,
            <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
              <KBtn size="xs" kind="secondary" onClick={() => setNewDoc({ id: t.id, name: t.name, context: t.context })}>새 문서</KBtn>
              <KBtn size="xs" onClick={() => setRenaming({ id: t.id, name: t.name })}>이름 변경</KBtn>
              <KBtn size="xs" kind="danger" onClick={() => setConfirmDel([t])}>삭제</KBtn>
            </span>,
          ])} />
        <Pager page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} />
      </KCard>

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
