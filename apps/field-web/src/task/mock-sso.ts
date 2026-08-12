/**
 * mock 외부 토큰 조립 (AUTH_MODE=mock 전용, ADR-22 D3).
 *
 * 이 값은 자격증명이 아니다 — 기관과 로그인 ID를 **주장**할 뿐이고, 실제로 그
 * 사용자가 그 기관에 있는지는 DB가 판단한다. 그래서 브라우저가 만들어도 된다.
 * 실제 T3Q SSO가 붙으면(OB-01) 이 화면은 그 리디렉션으로 대체된다.
 *
 * 서버(`services/api/src/auth/mock-sso.ts`)와 같은 형식을 만든다: `mock.` +
 * base64url(JSON). Node의 Buffer가 없는 환경이므로 직접 인코딩한다.
 */

export function buildMockExternalToken(identity: { tenantId: string; loginId: string }): string {
  const json = JSON.stringify(identity);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  return `mock.${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
