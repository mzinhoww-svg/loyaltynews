import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/web/lib/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'apps/web/e2e/**'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
