import { useEffect, useState } from 'react';
import { get, type Warnings, type WarningItem } from './api';
import { KBadge, KCard, type Tone } from './krds';

/**
 * 기상특보 종합 카드 — 날씨누리 "특보(종합)"과 같은 내용(발표·발효시각, 발효 중 특보 종류별 지역, 예비특보, 최근 통보문).
 * 서버 /api/weather/warnings (10분 캐시). 재난 상황 참고용이라 상황일지 메인·대시보드에 둔다 (2026-08-22).
 */
export function useWarnings(intervalMs = 5 * 60_000) {
  const [w, setW] = useState<Warnings | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => get<Warnings>('/weather/warnings').then((r) => { if (alive) setW(r); }).catch(() => {});
    void load(); const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [intervalMs]);
  return w;
}

const TONE: Record<WarningItem['level'], Tone> = { '경보': 'danger', '주의보': 'light-warning', '기타': 'light-gray' };
const KIND_TONE: Record<string, Tone> = { '특보': 'light-danger', '정보': 'light-primary', '속보': 'light-warning', '기타': 'light-gray' };

export function WarningsCard({ compact = false, highlight }: { compact?: boolean; highlight?: string }) {
  const w = useWarnings();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => { const s = new Set(open); s.has(k) ? s.delete(k) : s.add(k); setOpen(s); };
  const src = w?.source === 'weather.go.kr' ? '기상청 날씨누리' : w?.source === 'kma-api' ? '기상청 API' : '목업';
  const hit = (r: string) => !!highlight && r.includes(highlight);
  const Item = ({ it }: { it: WarningItem }) => {
    const long = it.regions.length > (compact ? 60 : 140); const show = open.has(it.kind) || !long;
    return (
      <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid #f1f3f5', fontSize: compact ? 13 : 14, lineHeight: 1.6, background: hit(it.regions) ? '#fff8e1' : undefined }}>
        <KBadge tone={TONE[it.level]} style={{ flex: 'none', marginTop: 2 }}>{it.kind}</KBadge>
        <span style={{ color: '#464c53', wordBreak: 'keep-all' }}>{show ? it.regions : `${it.regions.slice(0, compact ? 60 : 140)}…`}{long && <button type="button" onClick={() => toggle(it.kind)} style={{ marginLeft: 6, border: 0, background: 'none', color: '#256ef4', cursor: 'pointer', fontSize: 12 }}>{show ? '접기' : '지역 전체'}</button>}</span>
      </li>
    );
  };
  return (
    <KCard tight={compact} title={<>기상특보 종합 {w && <span className="dim" style={{ fontWeight: 400, fontSize: 14 }}>발효 {w.active.length}건{w.preliminary.length ? ` · 예비 ${w.preliminary.length}건` : ''}</span>}</>} titleAs={compact ? 'h3' : undefined}
      right={<a href="https://www.weather.go.kr/w/special-report/overall.do" target="_blank" rel="noreferrer" className="tiny" style={{ whiteSpace: 'nowrap' }}>날씨누리 특보(종합) ↗</a>}>
      {!w ? <p className="dim" style={{ fontSize: 13 }}>특보를 불러오는 중…</p> : (
        <>
          <p className="tiny dim" style={{ margin: '0 0 6px' }}>발표 {w.announcedAt || '-'}{w.effectiveAt ? ` · 발효 ${w.effectiveAt}` : ''} · 출처 {src}{w.error ? ` (갱신 실패: ${w.error})` : ''}{highlight ? ` · "${highlight}" 포함 지역 강조` : ''}</p>
          {w.active.length ? <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{w.active.map((it) => <Item key={it.kind} it={it} />)}</ul> : <p className="dim" style={{ fontSize: 13 }}>현재 발효 중인 특보가 없습니다.</p>}
          {w.preliminary.length > 0 && <><div className="tiny dim" style={{ marginTop: 10, fontWeight: 700 }}>예비특보</div><ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{w.preliminary.map((it) => <Item key={'p' + it.kind} it={it} />)}</ul></>}
          {!compact && w.bulletins.length > 0 && (
            <>
              <div className="tiny dim" style={{ marginTop: 12, fontWeight: 700 }}>최근 통보문 (전국)</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {w.bulletins.slice(0, 6).map((b) => <li key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 13, borderTop: '1px solid #f1f3f5' }}><KBadge tone={KIND_TONE[b.kind] ?? 'light-gray'}>{b.kind}</KBadge><span className="num dim" style={{ whiteSpace: 'nowrap' }}>{b.time}</span><span>{b.no}</span><span style={{ color: '#1e2124', fontWeight: 500 }}>{b.title}</span></li>)}
              </ul>
            </>
          )}
        </>
      )}
    </KCard>
  );
}
