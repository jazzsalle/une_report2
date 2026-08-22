/**
 * 날씨·기상특보 (2026-08-22).
 *  - 특보: 날씨누리 특보(종합) 화면이 키 없이 읽어 오는 HTML 조각 `/w/wnuri-fct2021/weather/warning.do`와
 *    특보 통보문 목록 `/w/special-report/list.do`를 파싱한다(실측 2026-08-22: "특보 발효현황 발표시각 … 발효시각 … 특보 내용 o 폭염경보 : 지역…").
 *    `KMA_SERVICE_KEY`가 있으면 공공데이터포털 기상특보 조회서비스(WthrWrnInfoService/getPwnStatus)를 먼저 쓴다.
 *  - 날씨: `KMA_SERVICE_KEY`가 있으면 기상청 초단기실황(getUltraSrtNcst, 격자 변환), 없으면 Open-Meteo(키 불필요), 둘 다 실패하면 목업.
 *  모두 10분 캐시. 외부에 못 닿으면 마지막 성공값 → 목업 순으로 폴백하고 `source`로 표시한다.
 */
import { Agent, fetch as undiciFetch } from 'undici';

const KEY = process.env.KMA_SERVICE_KEY ?? '';
const UA = 'Mozilla/5.0 (UNE POC weather)';
const TTL = 10 * 60_000;
const dispatcher = new Agent({ connect: { timeout: 10_000 } });

export interface WarningItem { kind: string; level: '경보' | '주의보' | '기타'; regions: string }
export interface Warnings {
  source: 'kma-api' | 'weather.go.kr' | 'mock';
  announcedAt: string; effectiveAt: string;
  active: WarningItem[];
  preliminary: WarningItem[];
  bulletins: { id: string; kind: '특보' | '정보' | '속보' | '기타'; no: string; time: string; title: string }[];
  fetchedAt: string;
  error?: string;
}
export interface Weather {
  source: 'kma-api' | 'open-meteo' | 'mock';
  place: string; temp: number; condition: '맑음' | '구름조금' | '구름많음' | '흐림' | '비' | '눈' | '소나기' | '안개' | '천둥번개';
  humidity?: number; windMs?: number; fetchedAt: string; error?: string;
}

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(k: string, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(k); if (c && Date.now() - c.at < TTL) return c.value as T;
  const v = await fn(); cache.set(k, { at: Date.now(), value: v }); return v;
}
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const levelOf = (kind: string): WarningItem['level'] => (/경보$/.test(kind) ? '경보' : /주의보$/.test(kind) ? '주의보' : '기타');

/** "o 폭염경보 : 전라남도(…), 광주 o 폭염주의보 : …" → 항목 배열 */
function parseItems(text: string): WarningItem[] {
  const out: WarningItem[] = [];
  for (const m of text.matchAll(/o\s*([가-힣]+(?:경보|주의보)|[가-힣]+)\s*:\s*([^o]*?)(?=\s+o\s|$)/g)) {
    const kind = m[1].trim(); const regions = m[2].trim().replace(/\s*,\s*/g, ', ');
    if (kind && regions) out.push({ kind, level: levelOf(kind), regions });
  }
  return out;
}

async function fromWeatherGoKr(): Promise<Warnings> {
  const r = await undiciFetch('https://www.weather.go.kr/w/wnuri-fct2021/weather/warning.do', { dispatcher, headers: { 'User-Agent': UA, Referer: 'https://www.weather.go.kr/w/special-report/overall.do', 'X-Requested-With': 'XMLHttpRequest' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`weather.go.kr HTTP ${r.status}`);
  const t = strip(await r.text());
  const announcedAt = t.match(/발표시각\s*:\s*(\d{4}년\s*\d{1,2}월\s*\d{1,2}일(?:\([^)]*\))?\s*[\d:]+)/)?.[1]?.trim() ?? '';
  const effectiveAt = t.match(/발효시각\s*:\s*(.*?)(?=\s*특보 내용|\s*o\s)/)?.[1]?.trim() ?? '';
  // "특보 내용 o … " 구간과 "예비특보 … " 구간을 나눈다
  const body = t.slice(t.indexOf('특보 내용'));
  const preIdx = body.search(/예비특보\s*(내용|발효현황)?/);
  const activeText = preIdx >= 0 ? body.slice(0, preIdx) : body;
  const preText = preIdx >= 0 ? body.slice(preIdx) : '';
  const active = parseItems(activeText);
  const preliminary = parseItems(preText);
  // 통보문 목록(전국): <option value="met:202608222100:284">[특보] 제08-284호 : 2026.08.22.21:00/ 강풍주의보 해제</option>
  let bulletins: Warnings['bulletins'] = [];
  try {
    const r2 = await undiciFetch('https://www.weather.go.kr/w/special-report/list.do', { dispatcher, headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
    const h = await r2.text();
    for (const m of h.matchAll(/<option value="((?:met|inf|ann|cmt|pre)[^"]*)"[^>]*>\s*\[([^\]]+)\]\s*(제[^:]+?)\s*:\s*([\d.]+:\d+)\s*\/?\s*([^<]*)<\/option>/g)) {
      const kind = m[2] === '특보' ? '특보' : m[2] === '정보' ? '정보' : m[2] === '속보' ? '속보' : '기타';
      bulletins.push({ id: m[1], kind, no: m[3].trim(), time: m[4], title: m[5].trim() || (kind === '정보' ? '기상정보' : '') });
      if (bulletins.length >= 12) break;
    }
  } catch { bulletins = []; }
  return { source: 'weather.go.kr', announcedAt, effectiveAt, active, preliminary, bulletins, fetchedAt: new Date().toISOString() };
}

/**
 * 공공데이터포털 기상특보 현황(getPwnStatus) + 통보문 목록(getWthrWrnList). 키가 있을 때만.
 * 실측 2026-08-22: getPwnStatus item = { t6: "o 강풍주의보 : 전라남도(…)
o 풍랑주의보 : …", t7: "o 없음"(예비특보), other: "o 없음", tmFc: "202608222100", tmEf: "202608231100", tmSeq }
 *               getWthrWrnList item = { stnId:"108", title:"[특보] 제08-284호 : 2026.08.22.21:00 / 강풍주의보 해제 (*)", tmFc, tmSeq }
 */
const kmaTime = (v?: string | number) => { const t = String(v ?? ''); const m = t.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/); return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일 ${m[4]}:${m[5]}` : t; };
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
async function kmaJson<T>(path: string, q: string): Promise<T[]> {
  const r = await undiciFetch(`https://apis.data.go.kr/1360000/${path}?serviceKey=${encodeURIComponent(KEY)}&dataType=JSON&${q}`, { dispatcher, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`KMA API HTTP ${r.status}`);
  const j = (await r.json()) as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: T[] } | '' } } };
  if (j.response?.header?.resultCode !== '00') throw new Error(`KMA API ${j.response?.header?.resultMsg ?? '응답 오류'}`);
  const items = j.response?.body?.items; return items && typeof items === 'object' ? items.item ?? [] : [];
}
async function fromKmaApi(): Promise<Warnings> {
  const st = await kmaJson<{ t6?: string; t7?: string; other?: string; tmFc?: string | number; tmEf?: string | number }>('WthrWrnInfoService/getPwnStatus', 'numOfRows=10&pageNo=1');
  const first = st[0];
  const norm = (t?: string) => (t ?? '').replace(/\s+/g, ' ').trim();
  const none = (t: string) => !t || /^o?\s*없음/.test(t);
  const active = none(norm(first?.t6)) ? [] : parseItems(norm(first?.t6));
  const preliminary = none(norm(first?.t7)) ? [] : parseItems(norm(first?.t7));
  let bulletins: Warnings['bulletins'] = [];
  try {
    const to = new Date(); const from = new Date(Date.now() - 86400_000);
    const list = await kmaJson<{ title?: string; tmFc?: string | number; tmSeq?: string | number }>('WthrWrnInfoService/getWthrWrnList', `numOfRows=12&pageNo=1&stnId=108&fromTmFc=${ymd(from)}&toTmFc=${ymd(to)}`);
    bulletins = list.map((i) => { const m = (i.title ?? '').match(/^\[([^\]]+)\]\s*(제[^:]+?)\s*:\s*([\d.]+:\d+)\s*\/?\s*(.*?)\s*(\(\*\))?\s*$/); const kind = m?.[1] === '특보' ? '특보' : m?.[1] === '정보' ? '정보' : m?.[1] === '속보' ? '속보' : '기타'; return { id: `kma:${i.tmFc}:${i.tmSeq}`, kind: kind as Warnings['bulletins'][number]['kind'], no: m?.[2] ?? '', time: m?.[3] ?? String(i.tmFc ?? ''), title: m?.[4] || (kind === '정보' ? '기상정보' : (i.title ?? '')) }; });
  } catch { bulletins = []; }
  return { source: 'kma-api', announcedAt: kmaTime(first?.tmFc), effectiveAt: first?.tmEf ? `${kmaTime(first.tmEf)} 이후` : '', active, preliminary, bulletins, fetchedAt: new Date().toISOString() };
}

const MOCK_WARNINGS: Warnings = { source: 'mock', announcedAt: '(목업) 발표시각 없음', effectiveAt: '', active: [{ kind: '폭염주의보', level: '주의보', regions: '강원도(원주, 횡성, 영월), 충청북도' }, { kind: '호우주의보', level: '주의보', regions: '경기도(가평, 양평)' }], preliminary: [], bulletins: [{ id: 'mock', kind: '특보', no: '제00-000호', time: '', title: '(목업) 외부 연결 불가 — 실제 특보 아님' }], fetchedAt: new Date().toISOString() };
let lastWarnings: Warnings | null = null;

export async function getWarnings(): Promise<Warnings> {
  return cached('warnings', async () => {
    const tries: (() => Promise<Warnings>)[] = KEY ? [fromKmaApi, fromWeatherGoKr] : [fromWeatherGoKr];
    let err = '';
    for (const f of tries) { try { const w = await f(); lastWarnings = w; return w; } catch (e) { err = (e as Error).message; } }
    return { ...(lastWarnings ?? MOCK_WARNINGS), error: err, fetchedAt: new Date().toISOString() };
  });
}

// ── 날씨 ─────────────────────────────────────────────────────────────────
/** 기준정보 "장소"·환경설정 지역명 → 위경도 (시·도·주요 도시). 없으면 서울 */
const PLACES: Record<string, [number, number]> = {
  서울: [37.5665, 126.978], 부산: [35.1796, 129.0756], 대구: [35.8714, 128.6014], 인천: [37.4563, 126.7052], 광주: [35.1595, 126.8526], 대전: [36.3504, 127.3845], 울산: [35.5384, 129.3114], 세종: [36.48, 127.289],
  수원: [37.2636, 127.0286], 춘천: [37.8813, 127.7298], 원주: [37.3422, 127.9202], 강릉: [37.7519, 128.8761], 청주: [36.6424, 127.489], 천안: [36.8151, 127.1139], 전주: [35.8242, 127.148], 목포: [34.8118, 126.3922], 여수: [34.7604, 127.6622], 포항: [36.019, 129.3435], 창원: [35.2281, 128.6811], 제주: [33.4996, 126.5312],
  경기: [37.4138, 127.5183], 강원: [37.8228, 128.1555], 충북: [36.6357, 127.4917], 충남: [36.5184, 126.8], 전북: [35.7175, 127.153], 전남: [34.8679, 126.991], 경북: [36.4919, 128.8889], 경남: [35.4606, 128.2132],
};
export function resolvePlace(place?: string): { name: string; lat: number; lon: number } {
  const p = (place ?? '').trim();
  for (const [name, [lat, lon]] of Object.entries(PLACES)) if (p.includes(name)) return { name, lat, lon };
  return { name: '서울', lat: PLACES.서울[0], lon: PLACES.서울[1] };
}

const WMO: [number, Weather['condition']][] = [[0, '맑음'], [1, '구름조금'], [2, '구름많음'], [3, '흐림'], [45, '안개'], [48, '안개'], [51, '비'], [53, '비'], [55, '비'], [56, '비'], [57, '비'], [61, '비'], [63, '비'], [65, '비'], [66, '비'], [67, '비'], [71, '눈'], [73, '눈'], [75, '눈'], [77, '눈'], [80, '소나기'], [81, '소나기'], [82, '소나기'], [85, '눈'], [86, '눈'], [95, '천둥번개'], [96, '천둥번개'], [99, '천둥번개']];
async function fromOpenMeteo(name: string, lat: number, lon: number): Promise<Weather> {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&wind_speed_unit=ms&timezone=Asia%2FSeoul`;
  const r = await undiciFetch(u, { dispatcher, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`open-meteo HTTP ${r.status}`);
  const j = (await r.json()) as { current: { temperature_2m: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number } };
  const code = j.current.weather_code; const cond = WMO.find(([c]) => c === code)?.[1] ?? (code < 3 ? '구름조금' : '흐림');
  return { source: 'open-meteo', place: name, temp: j.current.temperature_2m, condition: cond, humidity: j.current.relative_humidity_2m, windMs: j.current.wind_speed_10m, fetchedAt: new Date().toISOString() };
}

/** 기상청 격자(LCC DFS) 변환 — 기상청 공식 산식 */
function toGrid(lat: number, lon: number): { nx: number; ny: number } {
  const RE = 6371.00877, GRID = 5.0, SLAT1 = 30.0, SLAT2 = 60.0, OLON = 126.0, OLAT = 38.0, XO = 43, YO = 136;
  const D = Math.PI / 180; const re = RE / GRID; const slat1 = SLAT1 * D, slat2 = SLAT2 * D, olon = OLON * D, olat = OLAT * D;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5); sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5); sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5); ro = (re * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D * 0.5); ra = (re * sf) / Math.pow(ra, sn);
  let theta = lon * D - olon; if (theta > Math.PI) theta -= 2 * Math.PI; if (theta < -Math.PI) theta += 2 * Math.PI; theta *= sn;
  return { nx: Math.floor(ra * Math.sin(theta) + XO + 0.5), ny: Math.floor(ro - ra * Math.cos(theta) + YO + 0.5) };
}
async function fromKmaNcst(name: string, lat: number, lon: number): Promise<Weather> {
  const { nx, ny } = toGrid(lat, lon);
  const now = new Date(Date.now() - 40 * 60_000); // 실황은 매시 40분 이후 제공 → 40분 전 시각 기준
  const z = (n: number) => String(n).padStart(2, '0');
  const base = `${now.getFullYear()}${z(now.getMonth() + 1)}${z(now.getDate())}`; const time = `${z(now.getHours())}00`;
  const u = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=${encodeURIComponent(KEY)}&numOfRows=20&pageNo=1&dataType=JSON&base_date=${base}&base_time=${time}&nx=${nx}&ny=${ny}`;
  const r = await undiciFetch(u, { dispatcher, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`KMA ncst HTTP ${r.status}`);
  const j = (await r.json()) as { response?: { header?: { resultCode?: string; resultMsg?: string }; body?: { items?: { item?: { category: string; obsrValue: string }[] } } } };
  if (j.response?.header?.resultCode !== '00') throw new Error(`KMA ncst ${j.response?.header?.resultMsg ?? '응답 오류'}`);
  const v = Object.fromEntries((j.response?.body?.items?.item ?? []).map((i) => [i.category, Number(i.obsrValue)]));
  const pty = v.PTY ?? 0; // 0 없음 1 비 2 비/눈 3 눈 5 빗방울 6 빗방울눈날림 7 눈날림
  const cond: Weather['condition'] = pty === 0 ? '맑음' : pty === 3 || pty === 7 ? '눈' : '비';
  return { source: 'kma-api', place: name, temp: v.T1H ?? 0, condition: cond, humidity: v.REH, windMs: v.WSD, fetchedAt: new Date().toISOString() };
}
const lastWeather = new Map<string, Weather>();
export async function getWeather(place?: string): Promise<Weather> {
  const p = resolvePlace(place);
  return cached(`weather:${p.name}`, async () => {
    const tries = KEY ? [fromKmaNcst, fromOpenMeteo] : [fromOpenMeteo];
    let err = '';
    for (const f of tries) { try { const w = await f(p.name, p.lat, p.lon); lastWeather.set(p.name, w); return w; } catch (e) { err = (e as Error).message; } }
    return { ...(lastWeather.get(p.name) ?? { source: 'mock' as const, place: p.name, temp: 32.5, condition: '맑음' as const }), error: err, fetchedAt: new Date().toISOString() };
  });
}
export const weatherStatus = () => ({ kmaKey: !!KEY });
