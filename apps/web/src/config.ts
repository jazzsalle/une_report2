export function apiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001/api/v1';
}

/**
 * mock 로그인이 주장할 기관(tenant).
 *
 * **화면에서 입력받지 않는다.** 기관 ID는 사용자가 외울 값이 아니라 배포가 아는
 * 값이고, UUID를 손으로 치게 하면 오타가 로그인 실패로만 나타나 원인이 안 보인다.
 *
 * 프로토콜에서 뺀 것이 아니다 — 토큰은 여전히 `{tenantId, loginId}`를 주장하고,
 * 그 사용자가 그 기관에 실제로 있는지는 서버가 판단하며 RLS가 다른 기관 사용자를
 * 가린다(ADR-22 D3). 화면이 그 값을 **묻지 않고 설정에서 가져올 뿐**이다.
 * 로그인 ID만으로 기관을 역추적하게 만들면 기관 간 ID 충돌이 인증 문제가 된다.
 *
 * 기본값은 개발 시드의 기관 A다(`pnpm db:seed:dev`). 다른 기관으로 붙으려면
 * `VITE_DEFAULT_TENANT_ID`를 준다 — 기관 B 격리 확인이 그런 경우다.
 */
export function defaultTenantId(): string {
  return import.meta.env.VITE_DEFAULT_TENANT_ID ?? '11111111-1111-4111-8111-111111111111';
}
