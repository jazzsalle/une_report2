export { createApp } from './app.factory';
export { API_CONFIG, loadApiConfig, type ApiConfig } from './config/api-config';
/**
 * 저장소 주입 토큰 (CC-170). 슬라이스 E2E가 앱이 실제로 쓰는 저장소 인스턴스를
 * 꺼내 워커에 같은 것을 물려주기 위해 필요하다 — 인메모리 어댑터는 프로세스
 * 안의 Map이므로 새로 만들면 워커가 원본 바이트를 찾지 못한다.
 */
export { OBJECT_STORAGE } from './common/storage.provider';
// CC-430: 보안 전수 시험이 **등록된 것**을 봐야 한다. 정규식으로 소스를 읽으면
// 적힌 것만 보이고, 모듈 누락·조건부 등록은 보이지 않는다.
export { listRoutes, type RegisteredRoute } from './common/route-registry';
export { buildMockExternalToken, parseMockExternalToken } from './auth/mock-sso';
export {
  hashRefreshToken,
  issueRefreshToken,
  refreshTokenTenant,
  signAccessToken,
  verifyAccessToken,
} from './auth/tokens';
