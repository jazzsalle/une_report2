import type { ApiConfig } from '../config/api-config';

/**
 * e2e용 ApiConfig 조립기 (CC-170).
 *
 * 각 e2e가 설정 객체를 리터럴로 적고 있었다. 필드가 하나 늘 때마다 다섯 파일을
 * 함께 고쳐야 하고, 빠뜨리면 `createApp`이 런타임에 터진다(실제로 CC-170의
 * CORS/업로드 설정 추가에서 그렇게 됐다). 조립을 한 곳에 두면 다음 추가는
 * 이 파일 한 줄이다.
 *
 * 기본값은 **운영과 다른 것만** 고른다: 포트 0(임의), `une_app` 역할(관리자
 * URL로 붙어도 RLS를 실제로 태운다), CORS 미설정(교차출처 검사를 하는 테스트가
 * 스스로 켠다).
 */
export function e2eApiConfig(
  input: { databaseUrl: string; jwtSecret: string },
  overrides: Partial<ApiConfig> = {},
): ApiConfig {
  return {
    port: 0,
    authMode: 'mock',
    jwtSecret: input.jwtSecret,
    accessTtlSec: 900,
    refreshTtlSec: 3600,
    databaseUrl: input.databaseUrl,
    runtimeRole: 'une_app',
    publicBaseUrl: 'http://127.0.0.1:0',
    uploadMaxBytes: 50 * 1024 * 1024,
    jsonMaxBytes: 1024 * 1024,
    uploadTicketTtlSec: 900,
    corsAllowedOrigins: [],
    // CC-220: 지식문서 정책. AV 엔진이 없으므로(OB-15) e2e는 scan_status가
    // PENDING인 픽스처를 쓰게 되는데, 그것을 통과로 두면 도메인이 막으려던
    // 바로 그 경로가 테스트에서 사라진다. 기본은 운영과 같은 false로 두고
    // 완화가 필요한 테스트만 명시적으로 켠다.
    knowledgeMaxFileBytes: 50 * 1024 * 1024,
    knowledgeAllowedMimeTypes: new Set(['application/pdf', 'text/plain']),
    knowledgeAllowScanPending: false,
    knowledgeMaxUploadAttempts: 3,
    // CC-200: 목업 시나리오 훅은 **설정으로만** 켜진다(ADR-33 D19). e2e가
    // 부분 장애를 만들려면 여기서 켜야 하고, 운영 기본값은 false다.
    situationMockScenarios: true,
    situationProviderTimeoutMs: 5_000,
    ...overrides,
  };
}
