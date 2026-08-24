import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, HAZARDS, type PlanContext, type Template } from '../api';
import { KCard, KField, KInput, KModal, KSelect, KTextarea } from '../krds';

/** 기준정보 입력 폼(SCR-CADM-401001) — 문서의 기준정보 단계와 기준정보 템플릿 편집 화면이 같이 쓴다. 값만 주고받고 저장은 호출 쪽 몫. */
export function ContextForm({ value: c, onChange, templates }: { value: PlanContext; onChange: (next: PlanContext) => void; templates: Template[] }) {
  const set = (k: keyof PlanContext) => (e: { target: { value: string } }) => onChange({ ...c, [k]: e.target.value });
  const tpl = templates.find((t) => t.id === c.templateId) ?? null;
  useEffect(() => { if (tpl && !c.outlineNumbering) onChange({ ...c, outlineNumbering: tpl.levels.map((l) => l.bullet).filter(Boolean).join(' ') }); }, [tpl?.id]);
  // 템플릿 카드에 1쪽 썸네일(사용자 요청 2026-08-24) — 글 설명 대신 원문 모습. 클릭하면 전체 쪽 미리보기 모달
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (async () => { for (const t of templates) { if (thumbs[t.id]) continue; try { const r = await get<{ svg: string }>(`/templates/${t.id}/thumb`); if (!alive) return; setThumbs((m: Record<string, string>) => ({ ...m, [t.id]: r.svg })); } catch { /* 썸네일 실패는 카드만 글로 */ } } })();
    return () => { alive = false; };
  }, [templates]);
  const [preview, setPreview] = useState<{ t: Template; pages: number; svgs: string[] } | null>(null);
  const openPreview = async (t: Template) => { try { const r = await get<{ pages: number; svgs: string[] }>(`/templates/${t.id}/preview`); setPreview({ t, ...r }); } catch { /* ignore */ } };
  return (
    <>
      <KCard title="HWPX 문서 템플릿" desc="스타일 분석 결과를 목차·초안 생성 규칙과 내보내기에 적용합니다" right={<Link to="/plan/templates" className="tiny">템플릿 관리 →</Link>}>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto' }}>
          {templates.map((t) => (
            <div key={t.id} role="button" tabIndex={0} className={`tpl-card${c.templateId === t.id ? ' sel' : ''}`} aria-pressed={c.templateId === t.id}
              onClick={() => onChange({ ...c, templateId: t.id, outlineNumbering: t.levels.map((l) => l.bullet).filter(Boolean).join(' ') })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange({ ...c, templateId: t.id, outlineNumbering: t.levels.map((l) => l.bullet).filter(Boolean).join(' ') }); } }}>
              {thumbs[t.id]
                ? <button type="button" className="thumb" title="크게 미리보기" aria-label={`${t.name} 미리보기`} onClick={(e) => { e.stopPropagation(); void openPreview(t); }} dangerouslySetInnerHTML={{ __html: thumbs[t.id] }} />
                : <span className="thumb empty" aria-hidden="true">미리보기 준비 중…</span>}
              <strong>{t.name}</strong>
              <span className="meta">{t.levels.map((l) => `${l.bullet}${l.fontSizePt}`).join(' · ')} · 본문 {t.bodyFontFamily?.split(' ')[0] ?? '-'} {t.bodyFontSizePt}pt</span>
            </div>
          ))}
          {!templates.length && <p className="card-desc">등록된 템플릿이 없습니다. <Link to="/plan/templates">템플릿 관리</Link>에서 HWPX를 업로드하세요.</p>}
        </div>
      </KCard>
      {preview && (
        <KModal title={`원본 미리보기 — ${preview.t.name} (${preview.pages}쪽 중 ${preview.svgs.length}쪽)`} onClose={() => setPreview(null)} width={900}>
          <div style={{ background: '#f4f5f6', padding: 16, display: 'grid', gap: 16, maxHeight: '75vh', overflow: 'auto' }}>
            {preview.svgs.map((s: string, i: number) => <div key={i} className="hwp-page" dangerouslySetInnerHTML={{ __html: s }} />)}
          </div>
        </KModal>
      )}

      <KCard title="문서 주제">
        <KField label="문서 주제" required htmlFor="f-subject"><KInput id="f-subject" value={c.subject} onChange={set('subject')} placeholder="예: 2026년 여름철 폭염 대비 재난안전계획" /></KField>
      </KCard>
      <KCard title="배경 정보">
        <div className="form-grid">
          <KField label="재난유형" required htmlFor="f-hazard"><KSelect id="f-hazard" value={c.hazardType} onChange={set('hazardType')}>{HAZARDS.map((h) => <option key={h}>{h}</option>)}</KSelect></KField>
          <KField label="재난관리단계" required htmlFor="f-phase"><KSelect id="f-phase" value={c.managementPhase} onChange={set('managementPhase')}><option>예방</option><option>대비</option></KSelect></KField>
          <KField label="장소" htmlFor="f-place"><KInput id="f-place" value={c.place ?? ''} onChange={set('place')} placeholder="○○시" /></KField>
          <KField label="재난발생일시" htmlFor="f-occ"><KInput id="f-occ" type="datetime-local" value={c.occurredAt ?? ''} onChange={set('occurredAt')} /></KField>
          <KField label="보고일시" htmlFor="f-rep"><KInput id="f-rep" type="datetime-local" value={c.reportedAt ?? ''} onChange={set('reportedAt')} /></KField>
        </div>
      </KCard>
      <KCard title="내용지침">
        <div className="stack">
          <KField label="출처" htmlFor="f-src"><KInput id="f-src" value={c.sources ?? ''} onChange={set('sources')} placeholder="재난 및 안전관리 기본법, 폭염 위기관리 표준매뉴얼" /></KField>
          <KField label="필수 포함 요소" hint="쉼표로 구분" htmlFor="f-req"><KInput id="f-req" value={c.requiredElements ?? ''} onChange={set('requiredElements')} placeholder="취약계층 보호, 무더위쉼터 운영, 비상연락망" /></KField>
          <KField label="작성 가이드" htmlFor="f-guide"><KTextarea id="f-guide" value={c.writingGuide ?? ''} onChange={set('writingGuide')} placeholder="담당 부서와 기한을 표로 정리, 수치는 최근 3년 자료" /></KField>
        </div>
      </KCard>
      <KCard title="표현 규칙">
        <div className="form-grid">
          <KField label="문체" htmlFor="f-tone"><KSelect id="f-tone" value={c.tone ?? ''} onChange={set('tone')}><option value="">선택</option><option>공문서체</option><option>개조식</option><option>서술체</option></KSelect></KField>
          <KField label="문장길이 제한" htmlFor="f-len"><KInput id="f-len" value={c.sentenceLimit ?? ''} onChange={set('sentenceLimit')} placeholder="60자 이내" /></KField>
          <KField label="문단 개요번호 모양" htmlFor="f-outline" hint={tpl ? `템플릿 "${tpl.name}"에서 자동 채움` : '템플릿을 선택하면 자동으로 채워집니다'}><KInput id="f-outline" value={c.outlineNumbering ?? ''} onChange={set('outlineNumbering')} placeholder="□ ㅇ - *" /></KField>
          <KField label="본문 문장 시작" htmlFor="f-start"><KInput id="f-start" value={c.bodyStart ?? ''} onChange={set('bodyStart')} placeholder="(소제목) 문장…" /></KField>
        </div>
      </KCard>
      <KCard title="문장 작성 목적">
        <div className="form-grid">
          <KField label="업무 목적" htmlFor="f-purpose"><KInput id="f-purpose" value={c.purpose ?? ''} onChange={set('purpose')} placeholder="폭염 피해 최소화" /></KField>
          <KField label="역할" htmlFor="f-role"><KInput id="f-role" value={c.role ?? ''} onChange={set('role')} placeholder="안전총괄과" /></KField>
          <KField label="타깃 독자" required htmlFor="f-aud" hint="T3Q 열거값: 중앙정부 / 지자체 / 내부보고 / 대민"><KSelect id="f-aud" value={c.audience ?? ''} onChange={set('audience')}><option>중앙정부</option><option>지자체</option><option>내부보고</option><option>대민</option></KSelect></KField>
        </div>
      </KCard>
    </>
  );
}

/** 기준정보 유효성 — 문서 저장·템플릿 등록의 공통 조건 */
export const contextValid = (c: PlanContext) => !!(c.subject.trim() && c.hazardType && c.managementPhase && c.audience);
