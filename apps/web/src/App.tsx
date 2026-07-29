import type { JSX } from 'react';
import { apiBaseUrl } from './config';

export function App(): JSX.Element {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>UNE 재난문서 플랫폼 — 운영 워크스페이스</h1>
      <p>CC-001 스켈레톤. 계획서/상황일지 워크스페이스는 이후 Work Item에서 구현됩니다.</p>
      <p>
        API: <code>{apiBaseUrl()}</code>
      </p>
    </main>
  );
}
