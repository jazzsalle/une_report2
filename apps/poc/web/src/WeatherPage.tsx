import { useEffect, useState } from 'react';
import { get, setWeatherPlace, weatherPlace, WEATHER_ICON, type Weather } from './api';
import { KBtn, KCard, KSelect, KV } from './krds';
import { WarningsCard } from './WeatherCard';

const PLACES = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '수원', '춘천', '원주', '강릉', '청주', '천안', '전주', '목포', '여수', '포항', '창원', '제주', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남'];

/**
 * 날씨·기상특보 상세 — 헤더의 날씨 칩/특보 배지를 누르면 새 창(/weather)으로 연다. 셸(헤더·LNB) 없이 이 창만.
 * 지역을 바꾸면 localStorage(poc.weatherPlace)에 저장되고 원래 창의 헤더 칩이 storage 이벤트로 따라간다 (2026-08-22).
 */
export function WeatherPage() {
  const [place, setPlace] = useState(weatherPlace());
  const [wx, setWx] = useState<Weather | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { document.title = `기상특보 종합 · 날씨 — ${place}`; }, [place]);
  useEffect(() => { let alive = true; setWx(null); get<Weather>(`/weather?place=${encodeURIComponent(place)}`).then((w) => { if (alive) setWx(w); }).catch(() => {}); return () => { alive = false; }; }, [place, tick]);
  const pick = (p: string) => { setWeatherPlace(p); setPlace(p); };
  return (
    <div className="krds" style={{ minHeight: '100vh', background: '#f4f5f6' }}>
      <div className="band"><div className="wrap band-in" style={{ minHeight: 52 }}>
        <strong style={{ fontSize: 17 }}>기상특보 종합 · 날씨</strong>
        <span className="tiny dim">재난 상황 참고용 · 10분 캐시</span>
        <div style={{ flex: 1 }} />
        <KBtn size="sm" onClick={() => setTick((t) => t + 1)}>새로고침</KBtn>
        <KBtn size="sm" onClick={() => window.close()}>닫기</KBtn>
      </div></div>
      <div className="wrap" style={{ paddingTop: 16, paddingBottom: 24 }}>
        <div className="stack" style={{ gap: 16 }}>
          <KCard title="현재 날씨" right={<KSelect value={place} onChange={(e) => pick(e.target.value)} style={{ width: 140 }} aria-label="지역">{PLACES.map((p) => <option key={p}>{p}</option>)}</KSelect>}>
            {!wx ? <p className="dim" style={{ fontSize: 13 }}>불러오는 중…</p> : (
              <div className="row" style={{ gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
                <img src={`/hdr/wx-${WEATHER_ICON[wx.condition]}.svg`} alt={wx.condition} width={72} height={72} style={{ background: '#222931', borderRadius: 12, padding: 8 }} />
                <div><div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{wx.temp.toFixed(1)}°</div><div style={{ fontSize: 15, color: '#464c53', marginTop: 6 }}>{wx.place} · {wx.condition}</div></div>
                <KV items={[['습도', wx.humidity != null ? `${wx.humidity}%` : '-'], ['바람', wx.windMs != null ? `${wx.windMs} m/s` : '-'], ['출처', wx.source === 'mock' ? '목업(외부 연결 실패)' : wx.source === 'kma-api' ? '기상청 초단기실황' : 'Open-Meteo'], ['관측', new Date(wx.fetchedAt).toLocaleString('ko-KR')]]} />
                {wx.error && <span className="tiny" style={{ color: '#d0290e' }}>갱신 실패: {wx.error}</span>}
              </div>
            )}
          </KCard>
          <WarningsCard key={tick} highlight={place} />
        </div>
      </div>
    </div>
  );
}
