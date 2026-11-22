import { defineConfig, devices } from '@playwright/test';

// Porta configurável: várias frentes rodam e2e ao mesmo tempo em worktrees diferentes.
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    // E2E do Studio roda no build de e2e (.next-e2e, LN_E2E_BUILD=1), o único que contém a sessão simulada (MOCK).
    // O build de produção não a contém nem aceita esta variável (scripts/verify-no-mock.mjs).
    env: { LN_E2E_BUILD: '1', LN_STUDIO_TEST_SESSION: '1', LN_STUDIO_DEV_DB: 'pglite' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
