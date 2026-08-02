import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static TLS/secret hygiene for the plan adapter tree (ADR-26 D3):
 * disabling TLS verification must be INEXPRESSIBLE — no config field, no
 * env escape hatch, nowhere. Production rule: never bypass TLS verification.
 */

const ADAPTER_ROOT = resolve(__dirname);

const FORBIDDEN_TOKENS = [
  'rejectUnauthorized',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'insecureHTTPParser',
  'checkServerIdentity',
];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.ts$/.test(entry)) files.push(full);
  }
  return files;
}

describe('plan adapter TLS hygiene (static)', () => {
  it('keeps TLS-disabling tokens out of the entire t3q/plan tree', () => {
    const files = walk(ADAPTER_ROOT).filter((f) => !f.endsWith('tls-hygiene.test.ts'));
    expect(files.length).toBeGreaterThanOrEqual(10); // anti-vacuity
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const token of FORBIDDEN_TOKENS) {
        expect(source.includes(token), `${file} contains "${token}"`).toBe(false);
      }
    }
  });
});
