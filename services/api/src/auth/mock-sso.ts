import { authErrors } from '../common/api-error';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = 'mock.';

/** Identity asserted by a mock external token (AUTH_MODE=mock only, ADR-22 D3).
 * The token is not a credential: the DB decides whether the principal exists
 * in the asserted tenant, and RLS hides users of any other tenant. */
export interface MockIdentity {
  tenantId: string;
  loginId: string;
}

export function parseMockExternalToken(token: string): MockIdentity {
  if (!token.startsWith(PREFIX)) throw authErrors.invalidExternalToken();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token.slice(PREFIX.length), 'base64url').toString('utf8'));
  } catch {
    throw authErrors.invalidExternalToken();
  }
  const { tenantId, loginId } = (parsed ?? {}) as { tenantId?: unknown; loginId?: unknown };
  if (
    typeof tenantId !== 'string' ||
    !UUID_RE.test(tenantId) ||
    typeof loginId !== 'string' ||
    loginId.length === 0 ||
    loginId.length > 100
  ) {
    throw authErrors.invalidExternalToken();
  }
  return { tenantId, loginId };
}

/** Builds the mock external token; dev tooling and tests only. */
export function buildMockExternalToken(identity: MockIdentity): string {
  return PREFIX + Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url');
}
