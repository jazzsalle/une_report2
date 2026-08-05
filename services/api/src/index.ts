export { createApp } from './app.factory';
export { API_CONFIG, loadApiConfig, type ApiConfig } from './config/api-config';
/**
 * 저장소 주입 토큰 (CC-170). 슬라이스 E2E가 앱이 실제로 쓰는 저장소 인스턴스를
 * 꺼내 워커에 같은 것을 물려주기 위해 필요하다 — 인메모리 어댑터는 프로세스
 * 안의 Map이므로 새로 만들면 워커가 원본 바이트를 찾지 못한다.
 */
export { OBJECT_STORAGE } from './common/storage.provider';
export { buildMockExternalToken, parseMockExternalToken } from './auth/mock-sso';
export {
  hashRefreshToken,
  issueRefreshToken,
  refreshTokenTenant,
  signAccessToken,
  verifyAccessToken,
} from './auth/tokens';
