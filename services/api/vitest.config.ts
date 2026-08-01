import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The e2e suites each CREATE DATABASE + migrate against the same cluster;
    // running the files in parallel races pg_catalog updates ("tuple
    // concurrently updated") and turns whole suites into skips (CC-110 QA
    // review 필수-1). Unit files lose nothing measurable from serialization.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
});
