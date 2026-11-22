import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/workers/src/**/*.test.ts', 'apps/web/lib/**/*.test.ts', 'apps/web/app/api/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'apps/web/e2e/**'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
