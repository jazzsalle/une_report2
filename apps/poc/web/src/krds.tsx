/** KRDS 컴포넌트. 스타일은 krds.css(.krds 범위). 계획서 화면은 이 K* 부품을 직접 쓰고, 상황일지는 ui.tsx(같은 CSS 클래스를 입힌 예전 부품)를 쓴다. */
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { User } from './api';
import './krds.css';

/** 공통 헤더: 로고 + GNB(계획서 생성 / 상황일지) + 사용자 선택(인증 대체) */
export function AppHeader({ active, user, users, onUser }: { active: 'plan' | 'sit'; user: User | null; users: User[]; onUser: (u: User) => void }) {
  return (
    <header className="hdr">
      <div className="wrap hdr-in">
        <Link to="/" className="logo"><span className="logo-mark">UNE</span><strong className="logo-tit">재난안전 AI 문서 POC</strong></Link>
        <nav className="gnb" aria-label="주요 메뉴">
          <Link to="/plan" aria-current={active === 'plan' ? 'page' : undefined}>계획서 생성</Link>
          <Link to="/sit" aria-current={active === 'sit' ? 'page' : undefined}>상황일지</Link>
        </nav>
        <div className="util">
          <label htmlFor="user-sel" className="tiny">사용자</label>
          <select id="user-sel" className="k-select" value={user?.id ?? ''} onChange={(e) => { const u = users.find((x) => x.id === e.target.value); if (u) onUser(u); }} style={{ width: 220, height: 32, fontSize: 13 }}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.dept}</option>)}
          </select>
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
