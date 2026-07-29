import type { JSX } from 'react';
import { apiBaseUrl } from './config';

export function App(): JSX.Element {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '1rem', maxWidth: '480px' }}>
      <h1>UNE 현장임무</h1>
      <p>CC-001 스켈레톤. 임무 수신/착수/진행/완료 UI는 CC-280에서 구현됩니다.</p>
      <p>
        API: <code>{apiBaseUrl()}</code>
      </p>
    </main>
  );
}
