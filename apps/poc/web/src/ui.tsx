/** 공통 UI 조각 — KRDS 부품(krds.css)을 입힌 판. 상황일지·홈·모바일 화면이 쓴다(루트에 .krds 필요).
 *  계획서 화면은 krds.tsx의 K* 부품을 직접 쓴다. 2026-08-21 KRDS 적용: 색 토큰·글꼴·부품 모양만 바뀌고 props는 그대로. */
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { get, type User } from './api';
import './krds.css';

/** KRDS v1.0.0 토큰 (design_handoff_krds_uiux/README.md). 이름은 예전 그대로 두어 화면 코드 수정을 줄였다. */
export const C = {
  navy: '#1e2124', navyDark: '#1e2124', blue: '#256ef4', blueLight: '#eff5ff', text: '#1e2124', muted: '#464c53',
  border: '#cdd1d5', bg: '#f4f5f6', card: '#fff', green: '#228738', greenBg: '#eef7f0', orange: '#9d5b00', orangeBg: '#fff8e1',
  red: '#d0290e', redBg: '#fdf2f0', purple: '#0b50d0', purpleBg: '#eff5ff', gray: '#464c53', grayBg: '#f4f5f6',
};

export const font = '"Pretendard GOV", "Pretendard", "Noto Sans KR", "Malgun Gothic", "맑은 고딕", sans-serif';

export function Card({ title, right, children, style, pad = 16 }: { title?: ReactNode; right?: ReactNode; children: ReactNode; style?: CSSProperties; pad?: number }) {
  return (
    <section className="card" style={{ padding: pad, ...style }}>
      {(title || right) && (
        <div className="card-head" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h3>
          <div className="grow" />
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const BTN_KIND: Record<string, string> = { primary: 'primary', default: 'tertiary', danger: 'danger', ghost: 'text', dark: 'dark', warn: 'tertiary warn' };
export function Btn({ children, onClick, kind = 'default', disabled, small, style, type = 'button', title }: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'default' | 'danger' | 'ghost' | 'dark' | 'warn'; disabled?: boolean; small?: boolean; style?: CSSProperties; type?: 'button' | 'submit'; title?: string }) {
  return <button type={type} title={title} onClick={onClick} disabled={disabled} className={`k-btn ${BTN_KIND[kind]} ${small ? 'xs' : 'sm'}`} style={style}>{children}</button>;
}

const CHIP_TONE: Record<string, string> = { gray: 'bg-light-gray', blue: 'bg-light-primary', green: 'bg-light-success', orange: 'bg-light-warning', red: 'bg-light-danger', purple: 'bg-ai', navy: 'bg-navy' };
export function Chip({ children, tone = 'gray', style }: { children: ReactNode; tone?: 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple' | 'navy'; style?: CSSProperties }) {
  return <span className={`k-badge ${CHIP_TONE[tone]}`} style={style}>{children}</span>;
}

export const statusTone = (s: string): 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple' => {
  if (['완료', '기록완료', '수신확인', '전파완료', '정상'].includes(s)) return s === '수신확인' ? 'blue' : s === '전파완료' ? 'purple' : 'green';
  if (['진행중', '수행중', '동기화중'].includes(s)) return 'blue';
  if (['지연', '미확인', '오류', '지원요청'].includes(s)) return s === '지연' ? 'orange' : 'red';
  if (['대기', '-', 'DRAFT'].includes(s)) return 'gray';
  if (['미완료', '취소'].includes(s)) return 'red';
  return 'gray';
};

export const inputStyle: CSSProperties = { width: '100%', height: 40, padding: '0 12px', border: '1px solid #8a949e', borderRadius: 8, fontSize: 15, fontFamily: font, boxSizing: 'border-box', background: '#fff' };
export function Field({ label, children, required, hint, style }: { label: ReactNode; children: ReactNode; required?: boolean; hint?: string; style?: CSSProperties }) {
  return (
    <label className="form-group" style={{ marginBottom: 12, gap: 4, ...style }}>
      <span className="form-tit" style={{ fontSize: 14 }}>{label}{required && <span className="req" aria-hidden="true">*</span>}</span>
      {children}
      {hint && <span className="form-hint">{hint}</span>}
    </label>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`k-input${props.className ? ` ${props.className}` : ''}`} />; }
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={`k-textarea${props.className ? ` ${props.className}` : ''}`} />; }
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`k-select${props.className ? ` ${props.className}` : ''}`} />; }

export function Modal({ title, onClose, children, width = 480 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width }} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div role="status" style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1e2124', color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 15, zIndex: 60, fontFamily: font }}>{msg}</div>;
}
export function useToast(): [string | null, (m: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2200); };
  return [msg, show];
}

/** KPI 숫자 (README 전자상황판: 라벨 14px 회색 + 값 32px 굵게) */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div>
      {label && <div style={{ fontSize: 14, color: C.muted, marginBottom: 4 }}>{label}</div>}
      <div className="num" style={{ fontSize: 32, fontWeight: 700, color: tone ?? C.text, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="card-desc" style={{ padding: 32, textAlign: 'center' }}>{children}</p>;
}

export function Table({ head, rows, small, caption = '목록' }: { head: ReactNode[]; rows: ReactNode[][]; small?: boolean; caption?: string }) {
  return (
    <div className="k-tbl-wrap">
      <table className={`k-tbl${small ? ' compact' : ''}`}>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={head.length} className="empty">항목이 없습니다</td></tr>}</tbody>
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
/** 표 미리보기용 — 템플릿 견본 표의 머리행 배경·글꼴 (HWPX 내보내기와 같은 값) */
export interface MdTableStyle { headerBg?: string | null; headerBold?: boolean; fontFamily?: string | null; fontSizePt?: number | null }
const SUBTITLE_RE = /^\*{0,2}\([^)]{1,30}\)\*{0,2}/;
const SUBTITLE_ONLY_RE = /^\*{0,2}\([^)]{1,30}\)\*{0,2}\s*$/;
/**
 * 항목 기호 규칙(서버 hwpx.ts와 동일, 2026-08-21):
 *  - 항목의 수준은 바로 위 제목에 상대적 — 장(□) 아래 항목은 ㅇ, 절(ㅇ) 아래는 -, 그 아래는 *. 절 하나만 렌더할 때는 `baseLevel`(그 절의 깊이)을 준다.
 *  - 소제목만 있는 줄 뒤에 같은 깊이로 이어지는 줄들은 그 소제목의 하위.
 *  - 예전 변환의 "**(소제목)** 문장" 평문단도 1수준 항목으로.
 */
const isNumberingBullet = (b: string) => /^(\d+[.)]|[가-힣][.)]|\(\d+\)|[①-⑳])$/.test(b);
/** 번호형 기호 + 이미 번호로 시작하는 텍스트("1 제목", "1.1 제목", "나. 제목", "② 제목") → 기호 생략 */
const withoutDupNumber = (b: string, text: string) => (b && isNumberingBullet(b) && /^(\d+(\.\d+)*[.)]?|[가-힣][.)]|[①-⑳])\s/.test(text) ? '' : b);
const GANADA = '가나다라마바사아자차카타파하';
/** 번호형 기호의 n번째 값: "가." → 나./다., "1)" → 2)/3), "(1)" → (2), "①" → ②  (서버 hwpx.ts와 같은 규칙) */
function formatNumbering(b: string, n: number): string {
  const m = b.match(/^(\()?(\d+|[가-힣]|[①-⑳])([.)])?$/); if (!m || n < 1) return b;
  const [, open, core, close] = m;
  const v = /\d/.test(core) ? String(n) : /[①-⑳]/.test(core) ? String.fromCharCode(0x2460 + Math.min(19, n - 1)) : (GANADA[(n - 1) % GANADA.length] ?? core);
  return `${open ?? ''}${v}${close ?? ''}`;
}

export function renderMarkdown(md: string, opts: { paraPrefix?: string; onParaClick?: (id: string, text: string) => void; selectedId?: string | null; levelStyle?: (lv: number) => CSSProperties; bullets?: string[]; tableStyle?: MdTableStyle | null; baseLevel?: number } = {}): ReactNode[] {
  // 블록 첫 줄의 들여쓰기("  - 문장")가 항목 깊이를 정하므로 앞 공백은 남기고 뒤만 자른다
  const paras = md.replace(/\r/g, '').split(/\n\s*\n/).map((s) => s.replace(/^\n+/, '').trimEnd()).filter((s) => s.trim());
  let headingLevel = opts.baseLevel ?? 0;
  // 개요번호형 기호("1." "가." "①")인데 텍스트가 이미 번호로 시작하면("1 감염병…", "나. 중대본…") 기호를 또 붙이지 않는다 — 서버 hwpx.ts bulletText와 같은 규칙
  // 번호형 기호는 같은 수준의 형제끼리 가·나·다 / 1·2·3으로 센다(블록을 넘어 이어짐). 더 깊은 수준은 새 항목이 나오면 처음부터.
  const counters: number[] = [];
  const mark = (b: string, lv: number, text: string) => {
    for (let i = lv + 1; i < counters.length; i++) counters[i] = 0;
    const m = withoutDupNumber(b, text);
    return m && isNumberingBullet(m) ? formatNumbering(m, (counters[lv] = (counters[lv] ?? 0) + 1)) : m;
  };
  const bulletChar = (depth: number, text = '') => { const bs = opts.bullets ?? ['□', 'ㅇ', '-', '*']; const lv = Math.min(bs.length - 1, headingLevel + depth); return mark(bs[lv] ?? '•', lv, text); };
  const inline = (s: string): ReactNode => {
    // T3Q 표 셀의 <br>은 줄바꿈으로
    const parts = s.replace(/<br\s*\/?>/gi, '\n').split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i} style={{ whiteSpace: 'pre-line' }}>{p}</span>));
  };
  return paras.map((para, idx) => {
    const id = `${opts.paraPrefix ?? ''}#p${idx}`;
    const selected = opts.selectedId === id;
    const wrap: CSSProperties = { padding: '4px 8px', margin: '2px -8px', borderRadius: 6, cursor: opts.onParaClick ? 'pointer' : 'default', background: selected ? '#eff5ff' : 'transparent', outline: selected ? '2px solid #256ef4' : 'none', transition: 'background .12s' };
    const onClick = opts.onParaClick ? () => opts.onParaClick!(id, para) : undefined;
    const h = para.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length; headingLevel = lv; const st = opts.levelStyle?.(lv) ?? { fontSize: 19 - lv * 1.5, fontWeight: 700 };
      const b = mark(opts.bullets?.[lv - 1] ?? '', lv - 1, h[2]);
      return <div key={id} data-para-id={id} onClick={onClick} style={{ ...wrap, ...st, marginTop: 10 }}>{b ? `${b} ` : ''}{inline(h[2])}</div>;
    }
    if (/^\s*\|/.test(para)) {
      const rows = para.split('\n').filter((l) => /^\s*\|/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      const ts = opts.tableStyle;
      const tableFont: CSSProperties = { fontFamily: ts?.fontFamily ? `"${ts.fontFamily}", inherit` : undefined, fontSize: ts?.fontSizePt ? Math.min(16, Math.max(12, ts.fontSizePt + 2)) : 14 };
      return (
        <div key={id} data-para-id={id} onClick={onClick} style={wrap}>
          <table style={{ borderCollapse: 'collapse', width: '100%', margin: '6px 0', ...tableFont }}>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => ri === 0 ? <th key={ci} style={{ border: '1px solid #cdd1d5', padding: '6px 10px', background: ts?.headerBg ?? '#f4f5f6', textAlign: 'center', fontWeight: ts?.headerBold === false ? 400 : 700 }}>{inline(c)}</th> : <td key={ci} style={{ border: '1px solid #cdd1d5', padding: '6px 10px' }}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    if (/^\s*([-*•·ㅇ□■○●]|\d+[.)])\s/.test(para)) {
      const raw = para.split('\n').map((l) => l.match(/^(\s*)([-*•·ㅇ□■○●]|\d+[.)])\s+(.*)$/)).filter(Boolean) as RegExpMatchArray[];
      // 소제목만 있는 줄 아래로 같은 깊이 줄들을 한 단계 내린다
      let parent: number | null = null;
      const items = raw.map((m) => {
        let depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2); const text = m[3];
        if (SUBTITLE_ONLY_RE.test(text)) parent = depth;
        else if (parent != null && depth <= parent && SUBTITLE_RE.test(text)) parent = null; // 소제목으로 시작하는 형제 항목에서 중첩 끝
        else if (parent != null && depth === parent) depth += 1;
        else if (parent != null && depth < parent) parent = null;
        return { depth, text };
      });
      return (
        <div key={id} data-para-id={id} onClick={onClick} style={wrap}>
          {items.map((it, i) => <div key={i} style={{ paddingLeft: 12 + it.depth * 16, fontSize: 15, lineHeight: 1.7 }}>{bulletChar(it.depth, it.text)} {inline(it.text)}</div>)}
        </div>
      );
    }
    const flat = para.replace(/\n/g, ' ');
    if (SUBTITLE_RE.test(flat)) {
      // "**(소제목)** 문장" 평문단(예전 변환) → 제목 바로 아래 수준의 항목으로
      return <div key={id} data-para-id={id} onClick={onClick} style={{ ...wrap, paddingLeft: 12, fontSize: 15, lineHeight: 1.8 }}>{bulletChar(0, flat)} {inline(flat)}</div>;
    }
    return <p key={id} data-para-id={id} onClick={onClick} style={{ ...wrap, fontSize: 15, lineHeight: 1.8, margin: '2px -8px' }}>{inline(flat)}</p>;
  });
}
