import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // File-based tests only (YAML/JSON/registry reads) — no DB, no network.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      // Governance tests must judge the SOURCE registry, not a stale dist
      // build (QA review F1: dist made a local run false-green after a
      // source edit). The import specifier stays the package's public "."
      // entry — only its resolution is pinned to source for tests.
      '@une/provider-adapters': resolve(
        __dirname,
        '..',
        '..',
        'packages',
        'provider-adapters',
        'src',
        'index.ts',
      ),
    },
  },
});
