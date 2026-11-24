import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke de login do LN Studio contra um ambiente JÁ NO AR (staging). Não sobe servidor e não roda na suíte normal (arquivo *.smoke.ts).
 * Uso (quem tem o item do Cofre exporta as variáveis no próprio terminal; nada vai para arquivo):
 *   STUDIO_SMOKE_URL=https://<staging> STUDIO_SMOKE_EMAIL=… STUDIO_SMOKE_SENHA=… STUDIO_SMOKE_TOTP=… \
 *   npx playwright test -c e2e/staging/studio-login.config.ts
 * Sem trace, vídeo nem captura: o preenchimento dos campos não pode ficar registrado em artefato.
 */
export default defineConfig({
  testDir: '.',
  testMatch: /studio-login\.smoke\.ts$/,
  outputDir: '../../.test-results/staging-smoke',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.STUDIO_SMOKE_URL,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
