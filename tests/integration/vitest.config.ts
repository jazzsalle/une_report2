import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each file CREATE DATABASEs its own scratch database on the shared
    // server; keep files sequential so creation never races on the template.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
