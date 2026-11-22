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
    // Sessão simulada do Studio SÓ para testes (cookie ln-test-session); a UI mostra MOCK. Nenhum deploy pode definir esta variável.
    env: { LN_STUDIO_TEST_SESSION: '1' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
