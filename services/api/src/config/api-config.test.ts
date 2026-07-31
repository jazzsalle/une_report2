import { describe, expect, it } from 'vitest';
import { loadApiConfig } from './api-config';

const BASE = {
  DATABASE_URL: 'postgres://une_app:x@localhost:5432/une',
  UNE_AUTH_JWT_SECRET: 's'.repeat(32),
};

describe('loadApiConfig', () => {
  it('enables mock mode only when AUTH_MODE=mock', () => {
    expect(loadApiConfig({ ...BASE, AUTH_MODE: 'mock' }).authMode).toBe('mock');
    expect(loadApiConfig({ ...BASE }).authMode).toBe('disabled');
    expect(loadApiConfig({ ...BASE, AUTH_MODE: 'sso' }).authMode).toBe('disabled');
  });

  it('requires a >=32-char signing secret in mock mode (no default key)', () => {
    expect(() => loadApiConfig({ DATABASE_URL: BASE.DATABASE_URL, AUTH_MODE: 'mock' })).toThrow(
      /UNE_AUTH_JWT_SECRET/,
    );
    expect(() =>
      loadApiConfig({
        DATABASE_URL: BASE.DATABASE_URL,
        AUTH_MODE: 'mock',
        UNE_AUTH_JWT_SECRET: 'short',
      }),
    ).toThrow(/UNE_AUTH_JWT_SECRET/);
  });

  it('does not require the secret outside mock mode', () => {
    expect(loadApiConfig({ DATABASE_URL: BASE.DATABASE_URL }).jwtSecret).toBe('');
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadApiConfig({ UNE_AUTH_JWT_SECRET: BASE.UNE_AUTH_JWT_SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a runtime role that is not a plain identifier', () => {
    expect(() => loadApiConfig({ ...BASE, UNE_DB_RUNTIME_ROLE: 'une_app; DROP TABLE x' })).toThrow(
      /UNE_DB_RUNTIME_ROLE/,
    );
    expect(loadApiConfig({ ...BASE, UNE_DB_RUNTIME_ROLE: 'une_app' }).runtimeRole).toBe('une_app');
  });

  it('applies TTL defaults and rejects non-positive overrides', () => {
    const config = loadApiConfig({ ...BASE, UNE_ACCESS_TOKEN_TTL_SEC: '-5' });
    expect(config.accessTtlSec).toBe(900);
    expect(config.refreshTtlSec).toBe(43200);
  });
});
