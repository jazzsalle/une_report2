import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The e2e suites each CREATE DATABASE + migrate against the same cluster;
    // running the files in parallel races pg_catalog updates ("tuple
    // concurrently updated") and turns whole suites into skips (CC-110 QA
    // review 필수-1). Unit files lose nothing measurable from serialization.
    fileParallelism: false,
    // CC-160: 앱이 기동 시점에 저장소 설정을 요구하므로(fail-fast) 테스트
    // 기본 드라이버를 한 곳에서 정한다. 파일마다 env를 세우면 새 e2e가
    // 그것을 빠뜨리는 순간 앱 기동 실패로만 드러난다.
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 240_000,
  },
});
