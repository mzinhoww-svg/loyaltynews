import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000, // beforeAll migra PGlite; máquina carregada passa de 10 s
    projects: [
      {
        test: {
          name: 'node',
          include: [
            'packages/*/src/**/*.test.{ts,tsx}',
            'apps/workers/src/**/*.test.ts',
            'apps/web/lib/**/*.test.ts',
            'apps/web/app/api/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', 'apps/web/e2e/**', 'packages/ui/**'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      // Pacote de UI (Frente 05): jsdom, globals e setup próprios.
      'packages/ui/vitest.config.ts',
    ],
  },
});
