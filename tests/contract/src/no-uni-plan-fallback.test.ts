import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoPath } from './contract-loader';

/**
 * CC-115 AC "no UNI plan fallback" — static guard for design 13 §1 / AT-T3Q-011
 * and CLAUDE.md "UNI calls in plan flow are prohibited". Runtime proof (zero
 * UNI calls in the plan E2E) is CC-170 scope; this test keeps UNI symbols out
 * of the plan-flow source tree in the meantime.
 */

/** Plan-flow and provider source roots that must stay UNI-free. Widened per
 * review N5/R3; CC-125 adds packages/provider-adapters/src/t3q here. Roots
 * that do not exist yet are skipped, but at least MIN_SCANNED files must be
 * seen overall so the guard cannot go vacuous. */
const GUARDED_ROOTS = [
  'services/api/src/plan',
  'services/worker/src',
  'apps/web/src',
  'apps/field-web/src',
  'packages/domain/src',
  'packages/provider-adapters/src/capability',
];
const MIN_SCANNED = 10;

/** UNI-specific tokens. Deliberately NOT a bare "uni" substring —
 * unique/unicode/unit would false-positive. */
const FORBIDDEN_TOKENS = [
  'uni-rag',
  'UniRag',
  'uniRag',
  'UniSop',
  'UniProvider',
  'uniClient',
  'UNI_',
  '221.147.100.161',
];

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry)) files.push(full);
  }
  return files;
}

describe('no UNI fallback in the plan flow (AT-T3Q-011 static guard)', () => {
  it('keeps UNI tokens out of guarded plan-flow sources', () => {
    let scanned = 0;
    for (const root of GUARDED_ROOTS) {
      const rootPath = repoPath(root);
      if (!existsSync(rootPath)) continue;
      for (const file of walk(rootPath)) {
        scanned += 1;
        const source = readFileSync(file, 'utf8');
        for (const token of FORBIDDEN_TOKENS) {
          expect(source.includes(token), `${file} contains "${token}"`).toBe(false);
        }
      }
    }
    // Anti-vacuity: if refactors move the guarded roots, fail loudly instead
    // of silently scanning nothing.
    expect(scanned).toBeGreaterThanOrEqual(MIN_SCANNED);
  });

  it('keeps the generated UNI adapter types unimported outside their own package', () => {
    const roots = ['services/api/src', 'services/worker/src', 'packages/domain/src'];
    for (const root of roots) {
      for (const file of walk(repoPath(root))) {
        const source = readFileSync(file, 'utf8');
        expect(
          /from\s+['"][^'"]*uni-rag-adapter['"]/.test(source),
          `${file} imports uni-rag-adapter`,
        ).toBe(false);
      }
    }
  });
});
