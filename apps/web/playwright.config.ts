import { defineConfig, devices } from '@playwright/test';

// Porta configurável: várias frentes rodam e2e ao mesmo tempo em worktrees diferentes.
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  // e2e/portal-real tem config própria (e2e/portal-real.config.ts: harness do build de produção, seed real e flags por ambiente); fora dela roda sem o ambiente e semeia o banco compartilhado (int/021).
  testIgnore: ['**/portal-real/**'],
  timeout: 60_000,
  retries: 0,
  // Um worker: o backend de e2e usa um PGlite de conexão única (transações de requisições concorrentes se intercalariam) e o banco é compartilhado entre os specs.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    // E2E do Studio roda no build de e2e (.next-e2e, LN_E2E_BUILD=1), o único que contém o backend de teste (PGlite + login de teste).
    // O build de produção não o contém nem aceita estas variáveis (scripts/verify-no-mock.mjs).
    // O limite de tentativas falha fechado em APP_ENV=production sem chave (packages/auth/src/attempts.ts): o harness de e2e
    // roda nesse APP_ENV, então define uma chave SÓ de teste; sem ela o próprio /api/e2e/login responde 400 e nenhum spec sobe.
    env: {
      LN_E2E_BUILD: '1',
      LN_STUDIO_TEST_SESSION: '1',
      LN_STUDIO_DEV_DB: 'pglite',
      PORTAL_BASE_URL: 'https://portal.example.test',
      LN_ATTEMPT_HMAC_KEY: 'chave-de-teste-do-limite-32-bytes!!',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
