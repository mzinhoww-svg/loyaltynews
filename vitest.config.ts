import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/web/lib/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'apps/web/e2e/**'],
          environment: 'node',
          testTimeout: 30_000,
        },
      },
      // Pacote de UI (Frente 05): jsdom, globals e setup próprios.
      'packages/ui/vitest.config.ts',
    ],
  },
});
