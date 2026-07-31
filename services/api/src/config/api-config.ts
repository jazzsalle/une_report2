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
  return {
    port: intEnv(env.PORT, 3001),
    authMode,
    jwtSecret,
    accessTtlSec: intEnv(env.UNE_ACCESS_TOKEN_TTL_SEC, 900),
    refreshTtlSec: intEnv(env.UNE_REFRESH_TOKEN_TTL_SEC, 43200),
    databaseUrl,
    runtimeRole,
  };
}
