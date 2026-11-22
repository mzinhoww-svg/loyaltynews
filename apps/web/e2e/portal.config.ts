import { defineConfig, devices } from '@playwright/test';

/**
 * E2E do portal público (Frente 03).
 *   PORTAL_MODE=empty  → fonte vazia (padrão de produção): valida estados vazios honestos.
 *   PORTAL_MODE=mock   → fixtures MOCK: valida listas, matéria, busca, agenda e a faixa "MOCK".
 * Screenshots: apps/web/e2e/screenshots/<modo>/<projeto>-<página>.png
 */
const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock';
const port = mode === 'mock' ? 3102 : 3101;

export default defineConfig({
  testDir: './portal',
  outputDir: '../.test-results/portal',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: process.env.PORTAL_BASE_URL ?? `http://localhost:${port}`, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.PORTAL_BASE_URL
    ? undefined
    : {
        command: `npx next dev -p ${port}`,
        cwd: '..',
        url: `http://localhost:${port}`,
        reuseExistingServer: true,
        timeout: 120_000,
        env: { PORTAL_SOURCE: mode, NEXT_TELEMETRY_DISABLED: '1' },
      },
});
