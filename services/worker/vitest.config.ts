import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The e2e suite CREATE DATABASEs against the shared cluster; keep files
    // serial like services/api (CC-110 QA finding on concurrent migrations).
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
});
