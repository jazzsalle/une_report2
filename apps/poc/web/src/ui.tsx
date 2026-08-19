/** 공통 UI 조각. 기획 화면의 톤(짙은 남색 사이드바, 흰 카드, 파란 강조)을 따른다. */
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { get, type User } from './api';

export const C = {
  navy: '#1f2b4d', navyDark: '#182240', blue: '#2563eb', blueLight: '#e8efff', text: '#1f2933', muted: '#6b7280',
  border: '#e5e7eb', bg: '#f5f7fb', card: '#fff', green: '#16a34a', greenBg: '#e7f7ec', orange: '#f59e0b', orangeBg: '#fff4e0',
  red: '#dc2626', redBg: '#fdecec', purple: '#7c3aed', purpleBg: '#f1eaff', gray: '#6b7280', grayBg: '#f0f1f3',
};

export const font = 'system-ui, -apple-system, "Malgun Gothic", "맑은 고딕", sans-serif';

export function Card({ title, right, children, style, pad = 16 }: { title?: ReactNode; right?: ReactNode; children: ReactNode; style?: CSSProperties; pad?: number }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: pad, ...style }}>
      {(title || right) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          <div>{right}</div>
        </div>
      )}
      {children}
    </div>
  );
}

export function Btn({ children, onClick, kind = 'default', disabled, small, style, type = 'button', title }: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'default' | 'danger' | 'ghost' | 'dark' | 'warn'; disabled?: boolean; small?: boolean; style?: CSSProperties; type?: 'button' | 'submit'; title?: string }) {
  const base: CSSProperties = { padding: small ? '4px 10px' : '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#fff', color: C.text, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: small ? 12 : 13, fontWeight: 600, opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap', fontFamily: font };
  const kinds: Record<string, CSSProperties> = {
    primary: { background: C.blue, color: '#fff', border: `1px solid ${C.blue}` },
    dark: { background: C.navy, color: '#fff', border: `1px solid ${C.navy}` },
    danger: { background: '#fff', color: C.red, border: `1px solid ${C.red}` },
    warn: { background: '#fff', color: C.orange, border: `1px solid ${C.orange}` },
    ghost: { background: 'transparent', border: '1px solid transparent', color: C.blue },
    default: {},
  };
  return <button type={type} title={title} onClick={onClick} disabled={disabled} style={{ ...base, ...kinds[kind], ...style }}>{children}</button>;
}

export function Chip({ children, tone = 'gray', style }: { children: ReactNode; tone?: 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'navy'; style?: CSSProperties }) {
  const m: Record<string, [string, string]> = { gray: [C.grayBg, C.gray], blue: [C.blueLight, C.blue], green: [C.greenBg, C.green], orange: [C.orangeBg, '#b45309'], red: [C.redBg, C.red], purple: [C.purpleBg, C.purple], navy: [C.navy, '#fff'] };
  const [bg, fg] = m[tone];
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, background: bg, color: fg, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', ...style }}>{children}</span>;
}

export const statusTone = (s: string): 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple' => {
  if (['완료', '기록완료', '수신확인', '전파완료', '정상'].includes(s)) return s === '수신확인' ? 'blue' : s === '전파완료' ? 'purple' : 'green';
  if (['진행중', '수행중', '동기화중'].includes(s)) return 'blue';
  if (['지연', '미확인', '오류', '지원요청'].includes(s)) return s === '지연' ? 'orange' : 'red';
  if (['대기', '-', 'DRAFT'].includes(s)) return 'gray';
  if (['미완료', '취소'].includes(s)) return 'red';
  return 'gray';
};

export const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: font, boxSizing: 'border-box', background: '#fff' };
export function Field({ label, children, required, hint, style }: { label: ReactNode; children: ReactNode; required?: boolean; hint?: string; style?: CSSProperties }) {
  return (
    <label style={{ display: 'block', marginBottom: 12, ...style }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>{label}{required && <span style={{ color: C.red }}> *</span>}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{hint}</div>}
    </label>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} style={{ ...inputStyle, ...(props.style ?? {}) }} />; }
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} style={{ ...inputStyle, minHeight: 80, resize: 'vertical', ...(props.style ?? {}) }} />; }
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} style={{ ...inputStyle, ...(props.style ?? {}) }} />; }

export function Modal({ title, onClose, children, width = 480 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 14 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: C.navy, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60, boxShadow: '0 8px 24px rgba(0,0,0,.2)' }}>{msg}</div>;
}
export function useToast(): [string | null, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2200); };
  return [msg, show];
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: tone ?? C.text, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: 32, textAlign: 'center', color: C.muted, fontSize: 13 }}>{children}</div>;
}

export function Table({ head, rows, small }: { head: ReactNode[]; rows: ReactNode[][]; small?: boolean }) {
  const cell: CSSProperties = { padding: small ? '6px 8px' : '9px 10px', borderBottom: `1px solid ${C.border}`, fontSize: small ? 12 : 13, textAlign: 'left', verticalAlign: 'top' };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{head.map((h, i) => <th key={i} style={{ ...cell, background: '#f8fafc', color: C.muted, fontWeight: 700, fontSize: 12 }}>{h}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={cell}>{c}</td>)}</tr>) : <tr><td colSpan={head.length} style={{ ...cell, textAlign: 'center', color: C.muted }}>항목이 없습니다</td></tr>}</tbody>
      </table>
    </div>
  );
}

/** 사용자 선택 (인증 대체) — localStorage에 저장 */
export function useUser(): [User | null, (u: User) => void, User[]] {
  const [users, setUsers] = useState<User[]>([]);
  const [user, setUserState] = useState<User | null>(() => { try { return JSON.parse(localStorage.getItem('poc.user') ?? 'null'); } catch { return null; } });
  useEffect(() => { get<User[]>('/users').then((u) => { setUsers(u); if (!user) { setUserState(u[0]); localStorage.setItem('poc.user', JSON.stringify(u[0])); } }).catch(() => {}); }, []);
  const setUser = (u: User) => { setUserState(u); localStorage.setItem('poc.user', JSON.stringify(u)); };
  return [user, setUser, users];
}

/** 아주 작은 마크다운 → 요소 렌더러 (heading/불릿/표/문단/굵게). 문단마다 data-para-id를 붙인다. */
export function renderMarkdown(md: string, opts: { paraPrefix?: string; onParaClick?: (id: string, text: string) => void; selectedId?: string | null; levelStyle?: (lv: number) => CSSProperties; bullets?: string[] } = {}): ReactNode[] {
  const paras = md.replace(/\r/g, '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const inline = (s: string): ReactNode => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
  };
  return paras.map((para, idx) => {
    const id = `${opts.paraPrefix ?? ''}#p${idx}`;
    const selected = opts.selectedId === id;
    const wrap: CSSProperties = { padding: '4px 6px', margin: '2px -6px', borderRadius: 6, cursor: opts.onParaClick ? 'pointer' : 'default', background: selected ? '#fff7cc' : 'transparent', outline: selected ? '2px solid #f59e0b' : 'none', transition: 'background .12s' };
    const onClick = opts.onParaClick ? () => opts.onParaClick!(id, para) : undefined;
    const h = para.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length; const st = opts.levelStyle?.(lv) ?? { fontSize: 18 - lv * 1.5, fontWeight: 700 };
      const b = opts.bullets?.[lv - 1];
      return <div key={id} data-para-id={id} onClick={onClick} style={{ ...wrap, ...st, marginTop: 10 }}>{b ? `${b} ` : ''}{inline(h[2])}</div>;
    }
    if (/^\s*\|/.test(para)) {
      const rows = para.split('\n').filter((l) => /^\s*\|/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      return (
        <div key={id} data-para-id={id} onClick={onClick} style={wrap}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, margin: '6px 0' }}>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => ri === 0 ? <th key={ci} style={{ border: '1px solid #cbd5e1', padding: '5px 8px', background: '#f1f5f9' }}>{inline(c)}</th> : <td key={ci} style={{ border: '1px solid #cbd5e1', padding: '5px 8px' }}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    if (/^\s*([-*•·ㅇ□■○●]|\d+[.)])\s/.test(para)) {
      const items = para.split('\n').map((l) => l.match(/^(\s*)([-*•·ㅇ□■○●]|\d+[.)])\s+(.*)$/)).filter(Boolean) as RegExpMatchArray[];
      return (
        <div key={id} data-para-id={id} onClick={onClick} style={wrap}>
          {items.map((m, i) => { const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2); const b = opts.bullets?.[Math.min((opts.bullets?.length ?? 1) - 1, depth + 1)] ?? '•'; return <div key={i} style={{ paddingLeft: 12 + depth * 16, fontSize: 13.5, lineHeight: 1.7 }}>{b} {inline(m[3])}</div>; })}
        </div>
      );
    }
    return <p key={id} data-para-id={id} onClick={onClick} style={{ ...wrap, fontSize: 13.5, lineHeight: 1.8, margin: '2px -6px' }}>{inline(para.replace(/\n/g, ' '))}</p>;
  });
}
