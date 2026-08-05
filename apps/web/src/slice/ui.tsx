import type { CSSProperties, JSX, ReactNode } from 'react';
import type { ApiFailure } from '../api/errors';
import { describeFailure, nextActionFor } from '../api/errors';

/**
 * 화면 조각 (CC-170).
 *
 * 디자인 시스템을 만들지 않는다. 이 화면의 목적은 슬라이스가 이어진다는 것을
 * 사람이 보고 확인하는 것이고, 그 목적에는 "무엇이 지금 상태인가"와 "무엇이
 * 잘못됐고 다음에 무엇을 하면 되는가"가 읽히면 충분하다.
 */

const palette = {
  border: '#d4d9e0',
  muted: '#5a6572',
  ok: '#1f7a4d',
  warn: '#8a6d00',
  bad: '#a32020',
  panel: '#f7f8fa',
};

export function Panel({
  title,
  children,
  footnote,
}: {
  title: string;
  children: ReactNode;
  footnote?: string;
}): JSX.Element {
  return (
    <section
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
        background: '#fff',
      }}
    >
      <h2 style={{ fontSize: '1rem', margin: '0 0 0.75rem' }}>{title}</h2>
      {children}
      {footnote ? (
        <p style={{ color: palette.muted, fontSize: '0.8rem', marginTop: '0.75rem' }}>{footnote}</p>
      ) : null}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label style={{ display: 'block', marginBottom: '0.6rem' }}>
      <span style={{ display: 'block', fontSize: '0.8rem', color: palette.muted }}>{label}</span>
      {children}
    </label>
  );
}

export const inputStyle: CSSProperties = {
  width: '100%',
  maxWidth: 480,
  padding: '0.45rem 0.6rem',
  border: `1px solid ${palette.border}`,
  borderRadius: 4,
  fontSize: '0.95rem',
};

export function Button({
  onClick,
  children,
  disabled,
  kind = 'primary',
  testId,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  kind?: 'primary' | 'ghost';
  testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      style={{
        padding: '0.5rem 0.9rem',
        marginRight: '0.5rem',
        borderRadius: 4,
        border: kind === 'primary' ? 'none' : `1px solid ${palette.border}`,
        background: kind === 'primary' ? (disabled ? '#9aa5b1' : '#1f4e8c') : '#fff',
        color: kind === 'primary' ? '#fff' : '#1f2933',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: '0.9rem',
      }}
    >
      {children}
    </button>
  );
}

/** 키-값 표. 화면 증거에서 "무엇이 저장됐나"를 그대로 읽을 수 있어야 한다. */
export function Facts({ rows }: { rows: [string, ReactNode][] }): JSX.Element {
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem', width: '100%' }}>
      <tbody>
        {rows.map(([key, value]) => (
          <tr key={key}>
            <th
              style={{
                textAlign: 'left',
                padding: '0.25rem 0.75rem 0.25rem 0',
                color: palette.muted,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                verticalAlign: 'top',
              }}
            >
              {key}
            </th>
            <td style={{ padding: '0.25rem 0', wordBreak: 'break-all' }}>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Mono({ children }: { children: ReactNode }): JSX.Element {
  return <code style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>{children}</code>;
}

export function StatusChip({ value }: { value: string }): JSX.Element {
  const tone =
    value === 'COMPLETED' || value === 'VERIFIED' || value === 'PASS'
      ? palette.ok
      : value === 'FAILED' || value === 'ABORTED' || value === 'FAIL' || value === 'REJECT'
        ? palette.bad
        : palette.warn;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.1rem 0.5rem',
        borderRadius: 999,
        border: `1px solid ${tone}`,
        color: tone,
        fontSize: '0.78rem',
      }}
      data-testid="status-chip"
    >
      {value}
    </span>
  );
}

/**
 * 오류 표시.
 *
 * 서버 메시지를 그대로 보여주고, 다음 행동과 상관관계 ID를 함께 둔다. 코드를
 * 숨기지 않는 이유는 사용자가 문의할 때 그것이 유일하게 대조 가능한 값이기
 * 때문이다.
 */
export function FailureBox({ failure }: { failure: ApiFailure }): JSX.Element {
  const action = nextActionFor(failure);
  return (
    <div
      role="alert"
      data-testid="failure"
      style={{
        border: `1px solid ${palette.bad}`,
        background: '#fdf3f3',
        borderRadius: 6,
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
      }}
    >
      <strong style={{ color: palette.bad }}>{describeFailure(failure)}</strong>
      {action ? <p style={{ margin: '0.4rem 0 0' }}>{action}</p> : null}
      {failure.violations?.length ? (
        <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
          {failure.violations.map((v) => (
            <li key={`${v.field}:${v.reason}`}>
              <Mono>{v.field}</Mono> — {v.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {failure.correlationId ? (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.8rem', color: palette.muted }}>
          Correlation ID: <Mono>{failure.correlationId}</Mono>
        </p>
      ) : null}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p
      style={{
        background: palette.panel,
        border: `1px solid ${palette.border}`,
        borderRadius: 6,
        padding: '0.6rem 0.8rem',
        fontSize: '0.85rem',
        color: palette.muted,
      }}
    >
      {children}
    </p>
  );
}

export const colors = palette;
