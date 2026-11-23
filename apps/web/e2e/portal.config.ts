import { defineConfig, devices } from '@playwright/test';

/**
 * E2E do portal público (Frente 03).
 *   PORTAL_MODE=empty  → fonte vazia (padrão de produção): valida estados vazios honestos.
 *   PORTAL_MODE=mock   → fixtures MOCK: valida listas, matéria, busca, agenda e a faixa "MOCK".
 *   PORTAL_MODE=api    → PORTAL_SOURCE=api contra um servidor MOCK das rotas públicas (e2e/fake-api.mjs).
 * Screenshots: apps/web/e2e/screenshots/<modo>/<projeto>-<página>.png
 */
const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock' | 'api';
// APP_ENV do servidor sob teste: production (padrão) ou staging. Portas distintas evitam reaproveitar servidor com outro ambiente.
const appEnv = process.env.PORTAL_APP_ENV ?? 'production';
const port = mode === 'mock' ? 3102 : mode === 'api' ? 3105 : appEnv === 'production' ? 3101 : 3103;
const fakeApiPort = 3104;

export default defineConfig({
  testDir: './portal',
  // Em staging só a suíte de ambiente (as demais assumem indexação de produção).
  testMatch: mode === 'api' ? /(api|env)\.spec\.ts/ : appEnv === 'production' ? /.*\.spec\.ts/ : /env\.spec\.ts/,
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
    : [
        ...(mode === 'api'
          ? [
              {
                command: 'node e2e/fake-api.mjs',
                cwd: '..',
                url: `http://localhost:${fakeApiPort}/health`,
                reuseExistingServer: true,
                timeout: 30_000,
                env: { FAKE_API_PORT: String(fakeApiPort) },
              },
            ]
          : []),
        {
          command: `npx next dev -p ${port}`,
          cwd: '..',
          url: `http://localhost:${port}`,
          reuseExistingServer: true,
          timeout: 120_000,
          env: {
            PORTAL_SOURCE: mode,
            ...(mode === 'api' ? { PORTAL_API_BASE_URL: `http://localhost:${fakeApiPort}`, PORT: String(port) } : {}),
            // Mock nunca roda com APP_ENV=production (resolveSourceKind recusa): o servidor de mock usa staging.
            APP_ENV: mode === 'mock' ? 'staging' : appEnv,
            NEXT_PUBLIC_SITE_URL: 'https://portal.example.test',
            NEXT_TELEMETRY_DISABLED: '1',
          },
        },
      ],
});
