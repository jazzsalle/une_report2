/** KRDS 컴포넌트. 스타일은 krds.css(.krds 범위). 계획서 화면은 이 K* 부품을 직접 쓰고, 상황일지는 ui.tsx(같은 CSS 클래스를 입힌 예전 부품)를 쓴다. */
import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { get, weatherPlace, WEATHER_ICON, type User, type Weather, type Warnings } from './api';
import './krds.css';

/** 공통 헤더: 로고 + GNB(계획서 생성 / 상황일지) + 사용자 선택(인증 대체) */
/**
 * 상단 헤더 — Figma "Header"(1920×50, #222931) 구도: 좌 로고(심볼+서비스명) · GNB · 우 아이콘 버튼·날씨·사용자·인사말 (2026-08-22).
 * 심볼·아이콘은 피그마 벡터를 SVG로 변환해 /public/hdr 에 둠. 알림·설정·날씨는 POC 목업(동작 없음).
 */
export function AppHeader({ active, user, users, onUser }: { active: 'plan' | 'sit' | 'settings'; user: User | null; users: User[]; onUser: (u: User) => void }) {
  // 날씨(Open-Meteo/기상청)·특보 건수 — 10분마다. 지역은 브라우저 저장(poc.weatherPlace), 칩을 누르면 바꾼다
  const [wx, setWx] = useState<Weather | null>(null);
  const [wrn, setWrn] = useState<Warnings | null>(null);
  const [place, setPlace] = useState(weatherPlace());
  useEffect(() => { let alive = true; const load = () => { get<Weather>(`/weather?place=${encodeURIComponent(place)}`).then((w) => { if (alive) setWx(w); }).catch(() => {}); get<Warnings>('/weather/warnings').then((w) => { if (alive) setWrn(w); }).catch(() => {}); }; load(); const t = setInterval(load, 10 * 60_000); return () => { alive = false; clearInterval(t); }; }, [place]);
  // 상세는 새 창(/weather)에서 본다. 창에서 지역을 바꾸면 storage 이벤트로 헤더도 따라간다
  const openWeather = () => { window.open('/weather', 'une-weather', 'width=980,height=900,resizable=yes,scrollbars=yes'); };
  useEffect(() => { const on = (e: StorageEvent) => { if (e.key === 'poc.weatherPlace') setPlace(weatherPlace()); }; window.addEventListener('storage', on); return () => window.removeEventListener('storage', on); }, []);
  const wrnCount = wrn?.active.length ?? 0;
  return (
    <header className="hdr">
      <div className="wrap hdr-in">
        <Link to="/" className="logo"><img className="logo-mark" src="/hdr/hdr-protecto.svg" alt="" /><strong className="logo-tit">재난안전 AI 문서</strong></Link>
        <nav className="gnb" aria-label="주요 메뉴">
          <Link to="/plan" aria-current={active === 'plan' ? 'page' : undefined}>계획서 생성</Link>
          <Link to="/sit" aria-current={active === 'sit' ? 'page' : undefined}>상황일지</Link>
        </nav>
        <div className="util">
          <button type="button" className="hdr-ico" title="알림 (목업)" aria-label="알림"><img src="/hdr/hdr-bell.svg" alt="" /></button>
          <Link to="/settings" className="hdr-ico" title="환경설정 — HWPX 템플릿·스타일 분석, 휴지통" aria-label="환경설정" aria-current={active === 'settings' ? 'page' : undefined}><img src="/hdr/hdr-settings.svg" alt="" /></Link>
          <button type="button" className="hdr-weather" onClick={openWeather} title={wx ? `${wx.place} ${wx.condition} ${wx.temp}°${wx.humidity != null ? ` · 습도 ${wx.humidity}%` : ''}${wx.windMs != null ? ` · 바람 ${wx.windMs}m/s` : ''} · 출처 ${wx.source === 'mock' ? '목업' : wx.source}${wx.error ? ' (갱신 실패)' : ''} — 눌러서 상세 보기(새 창)` : '날씨 불러오는 중'}>
            <img src={`/hdr/wx-${WEATHER_ICON[wx?.condition ?? '맑음']}.svg`} alt={wx?.condition ?? ''} />{wx ? `${wx.place} ${wx.temp.toFixed(1)}°` : '…'}
          </button>
          <button type="button" className="hdr-wrn" onClick={openWeather} title={wrn ? `발효 중 특보 ${wrnCount}건${wrn.active.length ? ': ' + wrn.active.map((a) => a.kind).join(', ') : ''} — 눌러서 기상특보 종합(새 창)` : '특보 불러오는 중'}><span className={`hdr-wrn-dot${wrnCount ? ' on' : ''}`} />특보 {wrnCount}</button>
          <div className="hdr-user">
            <label htmlFor="user-sel" className="sr-only">사용자</label>
            <select id="user-sel" value={user?.id ?? ''} onChange={(e) => { const u = users.find((x) => x.id === e.target.value); if (u) onUser(u); }}>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.dept}</option>)}
            </select>
            <span className="hdr-hello">{user ? `${user.name}님 환영합니다` : '환영합니다'}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

// ── 아이콘 (KRDS 킷 SVG 대체, 20px 그리드 stroke 기반) ──
const PATHS: Record<string, ReactNode> = {
  check: <path d="M4 10.5l4 4 8-9" />,
  angle: <path d="M7.5 4l6 6-6 6" />,
  back: <path d="M12.5 4l-6 6 6 6" />,
  download: <path d="M10 3v10M6 9l4 4 4-4M4 16h12" />,
  upload: <path d="M10 13V3M6 7l4-4 4 4M4 16h12" />,
  lock: <><rect x="4.5" y="9" width="11" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></>,
  refresh: <><path d="M16 10a6 6 0 1 1-1.8-4.3" /><path d="M16 3v4h-4" /></>,
  print: <><path d="M6 7V3h8v4" /><rect x="3" y="7" width="14" height="7" rx="1.5" /><path d="M6 12h8v5H6z" /></>,
  external: <><path d="M8 4H4.5A1.5 1.5 0 0 0 3 5.5v10A1.5 1.5 0 0 0 4.5 17h10a1.5 1.5 0 0 0 1.5-1.5V12" /><path d="M11 3h6v6M17 3l-8 8" /></>,
  plus: <path d="M10 4v12M4 10h12" />,
  close: <path d="M5 5l10 10M15 5L5 15" />,
  up: <path d="M4 12.5l6-6 6 6" />,
  down: <path d="M4 7.5l6 6 6-6" />,
  edit: <path d="M4 16h3l9-9-3-3-9 9zM11 6l3 3" />,
  stop: <rect x="5" y="5" width="10" height="10" rx="1.5" />,
};
const FILLED: Record<string, ReactNode> = {
  play: <path d="M6 4.5v11l9-5.5z" />,
  infoFill: <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm0 4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM11 14H9V9h2z" />,
  successFill: <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zm-1.2 12.3L5 10l1.4-1.4 2.4 2.4 4.8-4.8L15 7.6z" />,
  errorFill: <path d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9 5h2v6H9zm1 9.3a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z" />,
  spark: <path d="M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8z" />,
};
export type IconName = keyof typeof PATHS | keyof typeof FILLED;
export function Icon({ name, size, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  const s = size ? { width: size, height: size, ...style } : style;
  if (FILLED[name]) return <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={s}>{FILLED[name]}</svg>;
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={s}>{PATHS[name]}</svg>;
}

// ── 버튼 ──
export function KBtn({ children, onClick, kind = 'tertiary', size = 'md', disabled, style, title, type = 'button', ariaLabel, className }: { children?: ReactNode; onClick?: () => void; kind?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'text' | 'icon'; size?: 'md' | 'sm' | 'xs'; disabled?: boolean; style?: CSSProperties; title?: string; type?: 'button' | 'submit'; ariaLabel?: string; className?: string }) {
  return <button type={type} className={`k-btn ${kind} ${size}${className ? ` ${className}` : ''}`} onClick={onClick} disabled={disabled} style={style} title={title} aria-label={ariaLabel}>{children}</button>;
}

// ── 배지 ──
export type Tone = 'success' | 'light-success' | 'primary' | 'light-primary' | 'light-warning' | 'danger' | 'light-danger' | 'gray' | 'light-gray' | 'navy';
export function KBadge({ children, tone = 'light-gray', style, title }: { children: ReactNode; tone?: Tone; style?: CSSProperties; title?: string }) {
  return <span className={`k-badge bg-${tone}`} style={style} title={title}>{children}</span>;
}
/** 초안 절 상태(SecStatus) → 배지 톤. 화면설계서 어휘 그대로. */
export const statusToTone = (s: string): Tone => {
  if (s === '완료') return 'light-success';
  if (s === '진행중') return 'light-primary';
  if (s === '오류' || s === '취소') return 'light-danger';
  if (s === '취소대기') return 'light-warning';
  return 'light-gray';
};

// ── 카드 ──
export function KCard({ title, desc, right, children, tight, style, className, titleAs = 'h2' }: { title?: ReactNode; desc?: ReactNode; right?: ReactNode; children: ReactNode; tight?: boolean; style?: CSSProperties; className?: string; titleAs?: 'h2' | 'h3' }) {
  const T = titleAs;
  return (
    <section className={`card${tight ? ' tight' : ''}${className ? ` ${className}` : ''}`} style={style}>
      {(title || right) && <div className="card-head">{title && <T>{title}</T>}{desc && <span className="card-desc">{desc}</span>}<div className="grow" />{right}</div>}
      {children}
    </section>
  );
}

// ── 표 ──
export function KTable({ caption, head, rows, compact, widths, selected, emptyText = '항목이 없습니다', style }: { caption: string; head: ReactNode[]; rows: ReactNode[][]; compact?: boolean; widths?: (string | undefined)[]; selected?: number | null; emptyText?: string; style?: CSSProperties }) {
  return (
    <div className="k-tbl-wrap" style={style}>
      <table className={`k-tbl${compact ? ' compact' : ''}`}>
        <caption className="sr-only">{caption}</caption>
        {widths && <colgroup>{widths.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}</colgroup>}
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((r, i) => <tr key={i} className={selected === i ? 'sel' : undefined}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={head.length} className="empty">{emptyText}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── 알림 ──
export function KAlert({ kind, children, style }: { kind: 'success' | 'warning' | 'information' | 'danger'; children: ReactNode; style?: CSSProperties }) {
  const icon: IconName = kind === 'success' ? 'successFill' : kind === 'information' ? 'infoFill' : 'errorFill';
  return <div className={`k-alert ${kind}`} role={kind === 'danger' || kind === 'warning' ? 'alert' : 'status'} style={style}><Icon name={icon} /><div>{children}</div></div>;
}

// ── 폼 ──
export function KField({ label, required, hint, children, htmlFor, style }: { label: ReactNode; required?: boolean; hint?: ReactNode; children: ReactNode; htmlFor?: string; style?: CSSProperties }) {
  return (
    <div className="form-group" style={style}>
      <div className="form-tit"><label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden="true">*</span>}</label></div>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}
export function KInput(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`k-input${props.className ? ` ${props.className}` : ''}`} />; }
export function KSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`k-select${props.className ? ` ${props.className}` : ''}`} />; }
export function KTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={`k-textarea${props.className ? ` ${props.className}` : ''}`} />; }

// ── 모달 ──
export function KModal({ title, onClose, children, width = 480, desc }: { title: string; onClose: () => void; children: ReactNode; width?: number; desc?: ReactNode }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>{title}</h2><KBtn kind="icon" onClick={onClose} ariaLabel="닫기"><Icon name="close" /></KBtn></div>
        {desc && <p className="card-desc">{desc}</p>}
        {children}
      </div>
    </div>
  );
}

// ── 키·값 목록 (우측 레일) ──
export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return <dl className="kv">{items.map(([k, v], i) => <Fragment key={i}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
}

// ── 작업 단계 파이프라인 칩 (완료 ✓ / 현재 / 대기) ──
export interface PipeStep { key: string; label: string; done: boolean; disabled?: boolean; title?: string }
export function Pipeline({ steps, current, onSelect }: { steps: PipeStep[]; current: string; onSelect: (k: string) => void }) {
  return (
    <ol className="pipe" aria-label="작업 단계">
      {steps.map((s, i) => {
        const state = s.key === current ? 'now' : s.done ? 'done' : 'todo';
        return (
          <li key={s.key}>
            <button type="button" className={`chip ${state}`} aria-current={state === 'now' ? 'step' : undefined} disabled={s.disabled} title={s.title} onClick={() => onSelect(s.key)}>
              {state === 'done' ? <Icon name="check" /> : <span>{i + 1}</span>} {s.label}
            </button>
            {i < steps.length - 1 && <span className="arrow"><Icon name="angle" /></span>}
          </li>
        );
      })}
    </ol>
  );
}

/** 정렬 가능한 표 머리글 — 누르면 오름/내림 전환, 현재 정렬 열에 화살표 */
export function SortTh({ label, active, dir, onClick }: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return <button type="button" className={`th-sort${active ? ' on' : ''}`} onClick={onClick} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>{label}<span aria-hidden="true">{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ' ↕'}</span></button>;
}

/** 페이지 바: "총 N건 중 a–b" + 이전/번호/다음 (설계서 302002 ⑧). 데이터는 호출 쪽에서 slice */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages);
  const from = total ? (cur - 1) * pageSize + 1 : 0, to = Math.min(total, cur * pageSize);
  const nums: number[] = [];
  for (let p = Math.max(1, cur - 2); p <= Math.min(pages, cur + 2); p++) nums.push(p);
  return (
    <nav className="pager" aria-label="페이지">
      <span className="tiny dim num">총 {total}건 중 {from}–{to}</span>
      <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
        <KBtn size="xs" disabled={cur <= 1} onClick={() => onPage(cur - 1)}>이전</KBtn>
        {nums[0] > 1 && <span className="dim">…</span>}
        {nums.map((p) => <KBtn key={p} size="xs" kind={p === cur ? 'primary' : 'tertiary'} onClick={() => onPage(p)} ariaLabel={`${p}쪽`}>{p}</KBtn>)}
        {nums[nums.length - 1] < pages && <span className="dim">…</span>}
        <KBtn size="xs" disabled={cur >= pages} onClick={() => onPage(cur + 1)}>다음</KBtn>
      </div>
    </nav>
  );
}

/** 화면 제목 + 화면설계서 코드 */
export function H1({ children, code }: { children: ReactNode; code?: string }) {
  return <h1 className="h1">{children}{code && <span className="code">{code}</span>}</h1>;
}
