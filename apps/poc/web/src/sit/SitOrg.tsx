import { useEffect, useState } from 'react';
import { get, put, type Org } from '../api';
import { Btn, C, Card, Input, Select, Toast, useToast } from '../ui';

/**
 * 기관·조직 설정 (범용화 ①, 2026-08-23) — 예전 환경설정(정적 목업) 자리. 매뉴얼 1.3 구조: 협업기능 ①~⑬ → 실무반 → 부서 → 담당자.
 * 담당자 목록은 전파·SOP의 담당자 선택(/api/users)에 바로 쓰이고, 설정값은 지연 판정·기본 채널·특보 자동기록에 쓰인다.
 */
type Col<T> = { key: keyof T & string; label: string; width?: number; kind?: 'text' | 'select'; options?: string[]; placeholder?: string };
function ListEditor<T extends Record<string, unknown>>({ rows, cols, onChange, make, addLabel }: { rows: T[]; cols: Col<T>[]; onChange: (r: T[]) => void; make: () => T; addLabel: string }) {
  const set = (i: number, k: keyof T, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <table className="k-tbl compact" style={{ width: '100%' }}>
        <thead><tr>{cols.map((c) => <th key={c.key} style={{ width: c.width }}>{c.label}</th>)}<th style={{ width: 56 }} /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => <td key={c.key}>{c.kind === 'select' ? <Select value={String(r[c.key] ?? '')} onChange={(e) => set(i, c.key, e.target.value)}>{(c.options ?? []).map((o) => <option key={o}>{o}</option>)}</Select> : <Input value={String(r[c.key] ?? '')} onChange={(e) => set(i, c.key, e.target.value)} placeholder={c.placeholder} />}</td>)}
              <td><Btn small kind="danger" onClick={() => onChange(rows.filter((_, j) => j !== i))}>삭제</Btn></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={cols.length + 1} style={{ color: C.muted, textAlign: 'center', padding: 12 }}>항목이 없습니다</td></tr>}
        </tbody>
      </table>
      <Btn small style={{ marginTop: 6 }} onClick={() => onChange([...rows, make()])}>+ {addLabel}</Btn>
    </div>
  );
}
const nid = () => Math.random().toString(36).slice(2, 8);
const listToText = (a: string[]) => a.join(', ');
const textToList = (t: string) => t.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export function SitOrg() {
  const [org, setOrg] = useState<Org | null>(null);
  const [health, setHealth] = useState<{ uni?: { baseUrl: string; mock: boolean; model?: string }; t3q?: { baseUrl: string; verifyTls?: boolean }; weather?: { kmaKey: boolean } } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [toast, show] = useToast();
  useEffect(() => { get<Org>('/org').then(setOrg); get('/health').then((h) => setHealth(h as typeof health)).catch(() => {}); }, []);
  const upd = (patch: Partial<Org>) => { setOrg((o) => (o ? { ...o, ...patch } : o)); setDirty(true); };
  const save = async () => { if (!org) return; const r = await put<Org>('/org', org); setOrg(r); setDirty(false); show('기관·조직 설정을 저장했습니다'); };
  if (!org) return <div style={{ padding: 24 }}>불러오는 중…</div>;
  const coopCodes = org.coopFunctions.map((c) => c.code);
  return (
    <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start', overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div><div style={{ fontSize: 16, fontWeight: 800 }}>기관·조직 설정</div><div style={{ fontSize: 12, color: C.muted }}>현장조치 행동매뉴얼의 구조(협업기능 → 실무반 → 부서 → 담당자)대로 기관을 등록합니다. 담당자는 전파·SOP 담당자 선택에, 설정값은 지연 판정·기본 채널·특보 자동기록에 바로 쓰입니다.</div></div>
        <div style={{ flex: 1 }} />
        <Btn kind="primary" disabled={!dirty} onClick={() => void save()}>저장{dirty ? ' *' : ''}</Btn>
      </div>
      <Card title="기관 정보">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px' }}>
          <label style={{ fontSize: 12 }}>기관명<Input value={org.name} onChange={(e) => upd({ name: e.target.value })} /></label>
          <label style={{ fontSize: 12 }}>대책본부 명칭<Input value={org.hq} onChange={(e) => upd({ hq: e.target.value })} /></label>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 4px' }}>보고 라인</div>
        <label style={{ fontSize: 12 }}>내부(쉼표 구분)<Input value={listToText(org.reportLines.internal)} onChange={(e) => upd({ reportLines: { ...org.reportLines, internal: textToList(e.target.value) } })} /></label>
        <label style={{ fontSize: 12 }}>상급기관<Input value={listToText(org.reportLines.upper)} onChange={(e) => upd({ reportLines: { ...org.reportLines, upper: textToList(e.target.value) } })} /></label>
        <label style={{ fontSize: 12 }}>중앙<Input value={listToText(org.reportLines.central)} onChange={(e) => upd({ reportLines: { ...org.reportLines, central: textToList(e.target.value) } })} /></label>
      </Card>
      <Card title="운영 설정">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px', fontSize: 12 }}>
          <label>지연 판정 기준(분)<Input type="number" value={String(org.settings.delayMinutes)} onChange={(e) => upd({ settings: { ...org.settings, delayMinutes: Number(e.target.value) || 0 } })} /></label>
          <label>날씨 기본 지역<Input value={org.settings.weatherPlace ?? ''} onChange={(e) => upd({ settings: { ...org.settings, weatherPlace: e.target.value } })} placeholder="예: 원주" /></label>
        </div>
        <div style={{ fontSize: 12, marginTop: 8 }}>기본 전파 채널</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>{['문자', '알림톡', '내부알림', '이메일'].map((c) => { const on = org.settings.defaultChannels.includes(c); return <Btn key={c} small kind={on ? 'primary' : 'default'} onClick={() => upd({ settings: { ...org.settings, defaultChannels: on ? org.settings.defaultChannels.filter((x) => x !== c) : [...org.settings.defaultChannels, c] } })}>{c}{on ? ' ✓' : ''}</Btn>; })}</div>
        <div style={{ fontSize: 12, marginTop: 8 }}>상황일지 자동 기록 기본값</div>
        {['전파 시 자동 기록', '수신 확인 시 자동 기록', '완료 보고 시 자동 기록', '지연 발생 시 자동 기록'].map((r) => <label key={r} style={{ display: 'flex', gap: 6, fontSize: 12.5, marginTop: 3 }}><input type="checkbox" checked={org.settings.autoLogRules.includes(r)} onChange={(e) => upd({ settings: { ...org.settings, autoLogRules: e.target.checked ? [...org.settings.autoLogRules, r] : org.settings.autoLogRules.filter((x) => x !== r) } })} />{r}</label>)}
        <label style={{ display: 'flex', gap: 6, fontSize: 12.5, marginTop: 6 }}><input type="checkbox" checked={org.settings.autoLogWarnings} onChange={(e) => upd({ settings: { ...org.settings, autoLogWarnings: e.target.checked } })} />기상특보 발표·해제를 확인 없이 자동 기록</label>
        {health && <div style={{ marginTop: 10, fontSize: 11.5, color: C.muted, lineHeight: 1.7, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>연동 상태 — 유니 {health.uni?.baseUrl}{health.uni?.mock ? ' (목업)' : ''} · T3Q {health.t3q?.baseUrl} · 기상청 키 {health.weather?.kmaKey ? '있음' : '없음(Open-Meteo·날씨누리)'}</div>}
      </Card>
      <Card title="협업기능 (매뉴얼 코드 ①~⑬)" style={{ gridColumn: '1 / -1' }}>
        <ListEditor rows={org.coopFunctions} cols={[{ key: 'code', label: '코드', width: 70 }, { key: 'name', label: '기능명' }]} onChange={(r) => upd({ coopFunctions: r })} make={() => ({ code: String.fromCharCode(0x2460 + org.coopFunctions.length), name: '' })} addLabel="협업기능 추가" />
      </Card>
      <Card title="실무반">
        <ListEditor rows={org.teams.map((t) => ({ ...t, coopCodesText: t.coopCodes.join(' '), deptsText: t.depts.join(', ') }))} cols={[{ key: 'name', label: '실무반' }, { key: 'coopCodesText', label: `협업기능 코드(공백 구분: ${coopCodes.join(' ')})` }, { key: 'deptsText', label: '소속 부서(쉼표)' }]} onChange={(r) => upd({ teams: r.map((x) => ({ id: (x.id as string) || nid(), name: x.name as string, coopCodes: String(x.coopCodesText ?? '').split(/\s+/).filter(Boolean), depts: textToList(String(x.deptsText ?? '')) })) })} make={() => ({ id: nid(), name: '', coopCodes: [], depts: [], coopCodesText: '', deptsText: '' })} addLabel="실무반 추가" />
      </Card>
      <Card title="부서">
        <ListEditor rows={org.depts} cols={[{ key: 'name', label: '부서명' }, { key: 'phone', label: '대표 연락처', width: 160 }]} onChange={(r) => upd({ depts: r })} make={() => ({ id: nid(), name: '', phone: '' })} addLabel="부서 추가" />
      </Card>
      <Card title="담당자 (전파·SOP 담당자 목록)" style={{ gridColumn: '1 / -1' }}>
        <ListEditor rows={org.members} cols={[{ key: 'name', label: '이름', width: 120 }, { key: 'dept', label: '부서', kind: 'select', options: [...new Set([...org.depts.map((d) => d.name), ...org.members.map((m) => m.dept)])], width: 200 }, { key: 'role', label: '역할', kind: 'select', options: ['상황총괄', '현장', '협력', '계획 작성자', '조회'], width: 140 }, { key: 'phone', label: '연락처', width: 160 }]} onChange={(r) => upd({ members: r })} make={() => ({ id: `u${nid()}`, name: '', dept: org.depts[0]?.name ?? '', role: '현장', phone: '' })} addLabel="담당자 추가" />
      </Card>
      <Card title="전파 대상군" style={{ gridColumn: '1 / -1' }}>
        <ListEditor rows={org.audiences} cols={[{ key: 'name', label: '대상군' }, { key: 'kind', label: '종류', kind: 'select', options: ['내부', '유관기관', '주민', '대국민'], width: 140 }, { key: 'contacts', label: '연락 수단·DB(메모)' }]} onChange={(r) => upd({ audiences: r })} make={() => ({ id: nid(), name: '', kind: '유관기관' as const, contacts: '' })} addLabel="대상군 추가" />
        <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>매뉴얼의 상황전파 대상(지대본 실무반 · 읍면동 · 유관기관 · 사전지정 주민 · 대국민 CBS/재난방송)을 기관에 맞게 등록합니다. 실제 송출은 POC 범위 밖이며, 전파 화면에서 대상군 단위로 기록됩니다.</div>
      </Card>
      <Toast msg={toast} />
    </div>
  );
}
