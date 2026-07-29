/**
 * Branded identifier types. Every aggregate ID is a UUID string carrying a
 * compile-time brand so IDs of different aggregates cannot be mixed up.
 *
 * This package is shared by browser (Vite) and Node (NestJS) runtimes, so it
 * must only use platform-neutral APIs — no `node:*` imports.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;

/**
 * Idempotency key required on every retriable create/dispatch/export request
 * (CLAUDE.md non-negotiable domain rules).
 */
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Web Crypto surface shared by Node 19+ and all supported browsers. */
interface UuidSource {
  randomUUID(): string;
}

function uuidSource(): UuidSource {
  const cryptoApi = (globalThis as { crypto?: Partial<UuidSource> }).crypto;
  if (!cryptoApi?.randomUUID) {
    throw new Error('globalThis.crypto.randomUUID is required (Node 19+ or a modern browser)');
  }
  return cryptoApi as UuidSource;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function newIdempotencyKey(): IdempotencyKey {
  return uuidSource().randomUUID() as IdempotencyKey;
}

export function asTenantId(value: string): TenantId {
  if (!isUuid(value)) {
    throw new Error(`TenantId must be a UUID, got: ${value}`);
  }
  return value as TenantId;
}
