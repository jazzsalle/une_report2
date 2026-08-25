import { useEffect, useMemo, useState } from 'react';
import { del, get, post, ago } from './api';
import { Toast, useToast } from './ui';
import { KBadge, KBtn, KCard, KModal, KSelect, KTable, type Tone } from './krds';

/** 휴지통 항목 — 서버 /api/trash 응답 */
export interface TrashItem { kind: 'plan' | 'planTemplate' | 'exercise' | 'template' | 'manual' | 'sopTemplate'; id: string; title: string; sub: string; createdBy: string; deletedAt: string; deletedBy?: string }
const KIND_LABEL: Record<TrashItem['kind'], string> = { plan: '계획서', planTemplate: '기준정보 템플릿', template: 'HWPX 템플릿', exercise: '상황', manual: '매뉴얼', sopTemplate: 'SOP 템플릿' };
const KIND_TONE: Record<TrashItem['kind'], Tone> = { plan: 'light-primary', planTemplate: 'light-gray', template: 'light-warning', exercise: 'light-success', manual: 'light-primary', sopTemplate: 'light-gray' };

/**
 * 휴지통 (계획서·기준정보 템플릿·훈련상황 공용). 삭제는 소프트 삭제이며 30일 뒤 서버가 자동으로 완전 삭제한다.
 * scope: 계획서 메뉴에선 계획서·기준정보 템플릿, 상황일지 메뉴에선 훈련상황을 기본으로. 환경설정(2026-08-24)에선 'all'로 전체.
 */
export function Trash({ scope }: { scope: 'plan' | 'sit' | 'all' }) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState<'' | TrashItem['kind']>('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ items: TrashItem[]; all?: boolean } | null>(null);
  const [toast, show] = useToast();
  const scopeKinds: TrashItem['kind'][] = scope === 'plan' ? ['plan', 'planTemplate', 'template'] : scope === 'sit' ? ['exercise', 'manual', 'sopTemplate'] : ['plan', 'planTemplate', 'template', 'exercise', 'manual', 'sopTemplate'];
  const load = () => get<{ items: TrashItem[]; days: number }>('/trash').then((r) => { setItems(r.items); setDays(r.days); setChecked(new Set()); });
  useEffect(() => { void load(); }, []);
  const shown = useMemo(() => items.filter((it) => (kind ? it.kind === kind : scopeKinds.includes(it.kind))), [items, kind, scope]);
  const key = (it: TrashItem) => `${it.kind}:${it.id}`;
  const toggle = (it: TrashItem, on: boolean) => { const s = new Set(checked); on ? s.add(key(it)) : s.delete(key(it)); setChecked(s); };
  const picked = shown.filter((it) => checked.has(key(it)));
  const restore = async (targets: TrashItem[]) => { for (const it of targets) await post(`/trash/${it.kind}/${it.id}/restore`, {}); show(`${targets.length}개를 복원했습니다`); await load(); };
  const purge = async () => {
    if (!confirm) return;
    if (confirm.all) { const r = await del<{ purged: number }>(`/trash?kind=${(kind ? [kind] : scopeKinds).join(',')}`); show(`${r.purged}개를 완전히 삭제했습니다`); }
    else { for (const it of confirm.items) await del(`/trash/${it.kind}/${it.id}`); show(`${confirm.items.length}개를 완전히 삭제했습니다`); }
    setConfirm(null); await load();
  };
  const others = items.filter((it) => !scopeKinds.includes(it.kind)).length;
  return (
    <div className="wrap" style={{ paddingTop: 24, paddingBottom: 24 }}>
      <h1 className="sr-only">휴지통</h1>
      <KCard title={<>휴지통 <span className="dim" style={{ fontWeight: 400, fontSize: 15 }}>({shown.length})</span></>} desc={`삭제한 항목은 여기에 ${days}일 동안 보관된 뒤 자동으로 완전히 삭제됩니다. 복원하면 원래 목록으로 돌아갑니다.`} right={
        <div className="row">
          <KSelect value={kind} onChange={(e) => setKind(e.target.value as '' | TrashItem['kind'])} style={{ width: 220 }} aria-label="종류">
            <option value="">{scope === 'plan' ? '계획서 · 기준정보 템플릿' : scope === 'sit' ? '훈련상황' : '전체'}</option>
            {(['plan', 'planTemplate', 'template', 'exercise', 'manual', 'sopTemplate'] as const).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}{!scopeKinds.includes(k) ? ' (다른 메뉴)' : ''}</option>)}
          </KSelect>
          <KBtn size="sm" kind="danger" disabled={!shown.length} onClick={() => setConfirm({ items: shown, all: true })}>휴지통 비우기</KBtn>
        </div>}>
        {others > 0 && !kind && <p className="card-desc" style={{ marginBottom: 12 }}>다른 메뉴에서 삭제한 항목 {others}개는 종류를 골라 볼 수 있습니다.</p>}
        {picked.length > 0 && (
          <div className="row" style={{ background: '#eff5ff', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 15 }}>
            <strong>{picked.length}개 선택</strong>
            <KBtn size="xs" kind="secondary" onClick={() => void restore(picked)}>복원</KBtn>
            <KBtn size="xs" kind="danger" onClick={() => setConfirm({ items: picked })}>완전 삭제</KBtn>
            <KBtn size="xs" onClick={() => setChecked(new Set())}>선택 취소</KBtn>
          </div>
        )}
        <KTable caption="휴지통 목록" widths={['40px', '12%', undefined, '22%', '9%', '9%', '12%', '18%']} emptyText="휴지통이 비어 있습니다."
          head={[<span className="sr-only">선택</span>, '종류', '이름', '정보', '생성자', '삭제자', '삭제 일시', <span className="sr-only">작업</span>]}
          rows={shown.map((it) => [
            <input type="checkbox" aria-label={`${it.title} 선택`} checked={checked.has(key(it))} onChange={(e) => toggle(it, e.target.checked)} style={{ width: 18, height: 18 }} />,
            <KBadge tone={KIND_TONE[it.kind]}>{KIND_LABEL[it.kind]}</KBadge>,
            <strong>{it.title}</strong>,
            <span className="dim">{it.sub || '-'}</span>,
            it.createdBy, it.deletedBy ?? '-',
            <span className="num" title={new Date(it.deletedAt).toLocaleString('ko-KR')}>{ago(it.deletedAt, '삭제')}</span>,
            <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
              <KBtn size="xs" kind="secondary" onClick={() => void restore([it])}>복원</KBtn>
              <KBtn size="xs" kind="danger" onClick={() => setConfirm({ items: [it] })}>완전 삭제</KBtn>
            </span>,
          ])} />
      </KCard>
      {confirm && (
        <KModal title={confirm.all ? '휴지통 비우기' : '완전 삭제'} onClose={() => setConfirm(null)}>
          <p style={{ fontSize: 15 }}>{confirm.all ? `휴지통의 ${confirm.items.length}개 항목을` : `선택한 ${confirm.items.length}개 항목을`} 완전히 삭제합니다. <strong>되돌릴 수 없습니다.</strong>{confirm.items.some((i) => i.kind === 'exercise') ? ' 훈련상황은 SOP·임무·이벤트·상황일지도 함께 지워집니다.' : ''}</p>
          <ul style={{ fontSize: 14, color: '#464c53', margin: '8px 0 16px', paddingLeft: 20, maxHeight: 160, overflow: 'auto' }}>{confirm.items.slice(0, 12).map((i) => <li key={key(i)}>{KIND_LABEL[i.kind]} · {i.title}</li>)}{confirm.items.length > 12 && <li>… 외 {confirm.items.length - 12}개</li>}</ul>
          <div className="row" style={{ justifyContent: 'flex-end' }}><KBtn size="sm" onClick={() => setConfirm(null)}>취소</KBtn><KBtn kind="danger" size="sm" onClick={() => void purge()}>완전 삭제</KBtn></div>
        </KModal>
      )}
      <Toast msg={toast} />
    </div>
  );
}
