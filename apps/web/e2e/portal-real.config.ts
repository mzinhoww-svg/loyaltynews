import { defineConfig, devices } from '@playwright/test';

/**
 * E2E do Intelligence por AMBIENTE contra as rotas REAIS (não o fake-api): build de produção de e2e (e2e/portal-server.mjs, perfil
 * producao) + next start com o portal em PORTAL_SOURCE=api apontando para o PRÓPRIO servidor, banco PGlite de e2e e seed real do
 * Intelligence (/api/e2e/login?seed=intelligence). As flags vêm do resolvedor de runtime (ADR-022), como num deploy:
 *   PORTAL_REAL_ENV=production → APP_ENV=production, sem LN_FLAGS_ON (intelligencePessoas tem production: null).
 *   PORTAL_REAL_ENV=staging    → APP_ENV=staging, LN_FLAGS_ON=intelligencePessoas (DP-38).
 * Uso: PORTAL_REAL_ENV=production|staging npx playwright test -c e2e/portal-real.config.ts
 */
const ambiente = process.env.PORTAL_REAL_ENV === 'staging' ? 'staging' : 'production';
const base = Number(process.env.PORTAL_PORT_BASE) || 3480;
const port = base + (ambiente === 'staging' ? 15 : 14);

export default defineConfig({
  testDir: './portal-real',
  // Um worker: o PGlite de e2e tem conexão única e o seed é compartilhado entre os testes.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: '../.test-results/portal-real',
  use: { baseURL: `http://127.0.0.1:${port}`, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `node e2e/portal-server.mjs ${port} producao`,
    cwd: '..',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 1_200_000,
    env: {
      PORTAL_SOURCE: 'api',
      PORTAL_API_BASE_URL: `http://127.0.0.1:${port}`,
      PORT: String(port),
      APP_ENV: ambiente,
      ...(ambiente === 'staging' ? { LN_FLAGS_ON: 'intelligencePessoas' } : {}),
      // Backend de e2e (PGlite + seed): só existe no build de e2e (.next-e2e).
      LN_STUDIO_TEST_SESSION: '1',
      LN_STUDIO_DEV_DB: 'pglite',
      // Chave FIXA só do e2e (não é segredo nem vale em deploy); sem ela o login de teste responde 400.
      LN_ATTEMPT_HMAC_KEY: 'chave-de-teste-do-limite-32-bytes!!',
      NEXT_PUBLIC_SITE_URL: 'https://portal.example.test',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
