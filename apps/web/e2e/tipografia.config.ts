import { defineConfig } from '@playwright/test';

/**
 * Medição de tipografia (FCP/LCP/CLS e provas funcionais) contra um build local já no ar.
 * Não sobe servidor: rode `node e2e/portal-server.mjs 3000 vitrine` (perfil produção/vitrine do e2e) e depois
 * `npx playwright test -c e2e/tipografia.config.ts`.
 * Protocolo e critério: auditoria-design/tipografia/aceite-tipografia.md (UI/UX, 25/11/2026).
 */
export default defineConfig({
  testDir: './tipografia',
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { headless: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
});
