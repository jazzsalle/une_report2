export const API_CONFIG = 'API_CONFIG';

export interface ApiConfig {
  port: number;
  /** 'mock' issues UNE JWTs from mock identity assertions; anything else
   * disables issuance until the real T3Q SSO binding lands (OB-01). */
  authMode: 'mock' | 'disabled';
  /** HS256 signing key. Environment secret only — no default, never committed. */
  jwtSecret: string;
  accessTtlSec: number;
  refreshTtlSec: number;
  databaseUrl: string;
  /** SET LOCAL ROLE applied inside every transaction. Used by tests/CI that
   * connect with an admin URL but must exercise RLS as the runtime role;
   * production connects directly as une_app and leaves this unset. */
  runtimeRole?: string;
  /**
   * 업로드 티켓·다운로드 URL을 만들 때 쓰는 **외부에서 보이는** API 주소
   * (CC-170). presign을 할 수 없는 드라이버에서 클라이언트가 실제로 도달할 수
   * 있는 주소여야 한다. 리버스 프록시 뒤에서는 Host 헤더를 신뢰할 수 없으므로
   * 요청에서 유도하지 않고 설정으로 받는다.
   */
  publicBaseUrl: string;
  /** 업로드 상한. 선언 크기가 넘으면 사전등록 자체를 거부한다(FILE-422-001). */
  uploadMaxBytes: number;
  /** 업로드 티켓 수명. 짧게 둔다 — 티켓은 인증 우회 경로다. */
  uploadTicketTtlSec: number;
  /**
   * 브라우저 허용 출처. 비면 CORS 헤더를 아예 내보내지 않는다(같은 출처만).
   * 와일드카드는 허용하지 않는다.
   */
  corsAllowedOrigins: readonly string[];
}

function intEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const authMode = env.AUTH_MODE === 'mock' ? 'mock' : 'disabled';
  const jwtSecret = env.UNE_AUTH_JWT_SECRET ?? '';
  if (authMode === 'mock' && jwtSecret.length < 32) {
    throw new Error(
      'AUTH_MODE=mock requires UNE_AUTH_JWT_SECRET of at least 32 characters (environment secret)',
    );
  }
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  const runtimeRole = env.UNE_DB_RUNTIME_ROLE || undefined;
  if (runtimeRole && !/^[a-z_][a-z0-9_]*$/.test(runtimeRole)) {
    throw new Error('UNE_DB_RUNTIME_ROLE must be a plain lowercase role name');
  }
  const port = intEnv(env.PORT, 3001);
  return {
    port,
    authMode,
    jwtSecret,
    accessTtlSec: intEnv(env.UNE_ACCESS_TOKEN_TTL_SEC, 900),
    refreshTtlSec: intEnv(env.UNE_REFRESH_TOKEN_TTL_SEC, 43200),
    databaseUrl,
    runtimeRole,
    publicBaseUrl: (env.UNE_PUBLIC_API_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
    uploadMaxBytes: intEnv(env.UNE_UPLOAD_MAX_BYTES, 50 * 1024 * 1024),
    uploadTicketTtlSec: intEnv(env.UNE_UPLOAD_TICKET_TTL_SEC, 900),
    corsAllowedOrigins: parseOrigins(env.UNE_CORS_ALLOWED_ORIGINS),
  };
}

/**
 * CORS 허용 출처 파싱.
 *
 * `*`를 거부한다. 토큰이 Authorization 헤더로 다니므로 와일드카드가 즉시
 * 자격증명 유출로 이어지지는 않지만, 허용 출처는 배포마다 아는 값이고
 * 모르는 채로 열어 두는 편의가 나중에 그대로 운영에 남는다.
 */
function parseOrigins(raw: string | undefined): readonly string[] {
  const items = (raw ?? '')
    .split(',')
    .map((v) => v.trim().replace(/\/+$/, ''))
    .filter((v) => v.length > 0);
  for (const origin of items) {
    if (origin === '*') {
      throw new Error('UNE_CORS_ALLOWED_ORIGINS must list explicit origins (no wildcard)');
    }
    if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
      throw new Error(`UNE_CORS_ALLOWED_ORIGINS entry is not an origin: ${origin}`);
    }
  }
  return items;
}
