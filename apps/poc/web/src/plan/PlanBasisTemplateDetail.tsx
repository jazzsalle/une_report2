import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { del, get, put, ago, type PlanContext, type PlanTemplate, type Template } from '../api';
import { Toast, useToast, useUser } from '../ui';
import { H1, Icon, KBadge, KBtn, KCard, KField, KInput, KModal, KTable } from '../krds';
import { HazardIcon } from './HeroCards';
import { ContextForm, contextValid } from './ContextForm';
import { NewDocModal, type NewDocSource } from './NewDocModal';

/** 기준정보 템플릿 상세(SCR-CADM-303001): 보기 ↔ 편집하기(템플릿명 + 기준정보 전 항목), 삭제, 이 템플릿으로 새 문서 */
export function PlanBasisTemplateDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [user] = useUser();
  const [tpl, setTpl] = useState<PlanTemplate | null>(null);
  const [missing, setMissing] = useState(false);
  const [hwpx, setHwpx] = useState<Template[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [ctx, setCtx] = useState<PlanContext | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [newDoc, setNewDoc] = useState<NewDocSource | null>(null);
  const [toast, show] = useToast();
  const load = () => get<PlanTemplate>(`/plan-templates/${id}`).then((t) => { setTpl(t); setName(t.name); setCtx(t.context); }).catch(() => setMissing(true));
  useEffect(() => { void load(); get<Template[]>('/templates').then(setHwpx).catch(() => {}); }, [id]);
  if (missing) return <div className="wrap" style={{ padding: 24 }}><p className="card-desc">템플릿이 없습니다. <Link to="/plan/basis-templates">목록으로</Link></p></div>;
  if (!tpl || !ctx) return <div className="wrap" style={{ padding: 24 }}>불러오는 중…</div>;
  const hwpxName = (c: PlanContext) => (c.templateId ? hwpx.find((t) => t.id === c.templateId)?.name ?? '(삭제됨)' : '-');
  const fields: [string, string | undefined][] = [
    ['문서 주제', tpl.context.subject], ['재난유형', tpl.context.hazardType], ['재난관리단계', tpl.context.managementPhase], ['장소', tpl.context.place], ['재난발생일시', tpl.context.occurredAt], ['보고일시', tpl.context.reportedAt],
    ['출처', tpl.context.sources], ['필수 포함 요소', tpl.context.requiredElements], ['작성 가이드', tpl.context.writingGuide],
    ['문체', tpl.context.tone], ['문장길이 제한', tpl.context.sentenceLimit], ['문단 개요번호 모양', tpl.context.outlineNumbering], ['본문 문장 시작', tpl.context.bodyStart],
    ['업무 목적', tpl.context.purpose], ['역할', tpl.context.role], ['타깃 독자', tpl.context.audience], ['HWPX 템플릿', hwpxName(tpl.context)],
  ];
  const save = async () => {
    if (!name.trim() || !contextValid(ctx)) return;
    setSaving(true);
    try { await put(`/plan-templates/${id}`, { name: name.trim(), context: ctx, updatedBy: user?.name }); await load(); setEditing(false); show('저장되었습니다'); }
    catch (e) { show((e as Error).message); } finally { setSaving(false); }
  };
  const cancel = () => { setName(tpl.name); setCtx(tpl.context); setEditing(false); };
  const remove = async () => { await del(`/plan-templates/${id}?by=${encodeURIComponent(user?.name ?? '')}`); show('휴지통으로 옮겼습니다'); nav('/plan/basis-templates'); };
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 24 }}>
      <div className="stack" style={{ maxWidth: 1100 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Link to="/plan/basis-templates" className="row tiny dim" style={{ gap: 2 }}><Icon name="back" size={16} /> 목록으로</Link>
          <H1 code="SCR-CADM-303001">{editing ? '기준정보 템플릿 편집' : tpl.name}</H1>
          {!editing && <span className="row" style={{ gap: 6 }}><HazardIcon hazard={tpl.context.hazardType} size={28} /><KBadge tone="light-primary">{tpl.context.hazardType}</KBadge></span>}
          <div style={{ flex: 1 }} />
          {editing ? <>
            <KBtn size="sm" onClick={cancel} disabled={saving}>취소</KBtn>
            <KBtn size="sm" kind="primary" onClick={() => void save()} disabled={saving || !name.trim() || !contextValid(ctx)}>저장하기</KBtn>
          </> : <>
            <KBtn size="sm" kind="danger" onClick={() => setConfirmDel(true)}>삭제하기</KBtn>
            <KBtn size="sm" onClick={() => setEditing(true)}>편집하기</KBtn>
            <KBtn size="sm" kind="primary" onClick={() => setNewDoc({ id: tpl.id, name: tpl.name, context: tpl.context })}>이 템플릿으로 새 문서</KBtn>
          </>}
        </div>
        <p className="card-desc">{tpl.createdBy} 등록 · {new Date(tpl.createdAt).toLocaleString('ko-KR')} · 수정 {tpl.updatedBy ?? tpl.createdBy} · {ago(tpl.updatedAt)}</p>

        {editing ? (
          <>
            <KCard title="템플릿 명">
              <KField label="템플릿 명" required htmlFor="tpl-name" hint="최대 20자"><KInput id="tpl-name" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} /></KField>
            </KCard>
            <ContextForm value={ctx} onChange={setCtx} templates={hwpx} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <KBtn onClick={cancel} disabled={saving}>취소</KBtn>
              <KBtn kind="primary" onClick={() => void save()} disabled={saving || !name.trim() || !contextValid(ctx)}>저장하기</KBtn>
            </div>
          </>
        ) : (
          <KCard title="저장된 기준정보">
            <KTable compact caption="템플릿에 저장된 기준정보" widths={['24%', undefined]} head={['항목', '값']} rows={fields.map(([k, v]) => [<strong>{k}</strong>, v || <span className="dim">-</span>])} />
          </KCard>
        )}
      </div>
      {confirmDel && (
        <KModal title="삭제하기" onClose={() => setConfirmDel(false)}>
          <p style={{ fontSize: 15 }}>템플릿 "{tpl.name}"을(를) 휴지통으로 옮깁니다. 이 템플릿으로 이미 만든 문서에는 영향이 없으며, 휴지통에서 30일 안에 복원할 수 있습니다.</p>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setConfirmDel(false)}>취소</KBtn><KBtn kind="danger" size="sm" onClick={() => void remove()}>삭제하기</KBtn></div>
        </KModal>
      )}
      {newDoc && <NewDocModal source={newDoc} onClose={() => setNewDoc(null)} />}
      <Toast msg={toast} />
    </div>
  );
}
