import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    // beforeAll migra PGlite; com a máquina carregada passa de 10 s (Frente 02).
    hookTimeout: 120_000,
    projects: [
      {
        test: {
          name: 'node',
          // Paralelismo limitado: os testes de banco (PGlite em WASM) falham por tempo sob carga paralela total.
          maxWorkers: 4,
          // Vitest 5 exige grupo próprio quando o maxWorkers difere do projeto de UI; roda depois do UI.
          sequence: { groupOrder: 1 },
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
