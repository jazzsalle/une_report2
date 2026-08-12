import { useState, type JSX } from 'react';
import { OpsWorkspace } from './ops/OpsWorkspace';
import { SliceWorkspace } from './slice/SliceWorkspace';

/**
 * 운영 워크스페이스.
 *
 * 두 흐름이 있다.
 *   * **계획서 슬라이스**(CC-170) — 로그인 → 계획서 → 기준정보 → HWPX 반입 →
 *     목차·본문 생성 → Export·다운로드. 자기 로그인을 가진 완결된 흐름이다.
 *   * **운영 화면**(CC-290·CC-300) — 전자상황판과 상황일지. 상황 하나를 두고
 *     보는 화면이라 로그인과 상황 ID를 공유한다.
 *
 * 문서 편집기는 아직 없다 — rhwp가 반입되지 않았다(OB-12).
 */
export function App(): JSX.Element {
  const [view, setView] = useState<'slice' | 'ops'>('slice');
  return (
    <div>
      <nav
        style={{
          display: 'flex',
          gap: '0.5rem',
          padding: '0.6rem 1rem',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <button
          onClick={() => setView('slice')}
          disabled={view === 'slice'}
          data-testid="nav-slice"
        >
          계획서
        </button>
        <button onClick={() => setView('ops')} disabled={view === 'ops'} data-testid="nav-ops">
          상황 운영
        </button>
      </nav>
      {view === 'slice' ? <SliceWorkspace /> : <OpsWorkspace />}
    </div>
  );
}
