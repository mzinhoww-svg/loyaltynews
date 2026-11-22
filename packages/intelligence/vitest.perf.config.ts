import { defineConfig } from 'vitest/config';

// Benchmark reproduzível (não roda em `npm test`): npm run perf -w @ln/intelligence
export default defineConfig({
  test: {
    include: ['bench/**/*.perf.ts'],
    environment: 'node',
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
});
