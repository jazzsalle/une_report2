import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 각 파일이 자기 스크래치 데이터베이스를 만든다. 병렬로 만들면 템플릿에서
    // 경합하므로 파일 단위로 순차 실행한다(tests/integration과 같은 규약).
    fileParallelism: false,
    // 슬라이스 전 구간(반입·목차·본문·Export)이 한 테스트에 들어간다.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
