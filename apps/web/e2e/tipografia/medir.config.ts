import { defineConfig } from '@playwright/test';

/**
 * Config da medição de tipografia (medir.spec.ts).
 *
 * O spec mede um build de produção já servido, no perfil vitrine (matéria mock e login de teste),
 * que é o mesmo perfil usado pelo harness de vitrine:
 *
 *   node e2e/portal-server.mjs 3971 vitrine
 *   TIPOGRAFIA_BASE=http://127.0.0.1:3971 npx playwright test -c e2e/tipografia/medir.config.ts
 *
 * Fica fora da suíte principal (playwright.config.ts) porque a suíte sobe o perfil de produção,
 * onde /noticia/mock-mercado-1 e o login de teste não existem: ali as provas medem a página de 404,
 * não o produto.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['medir.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.TIPOGRAFIA_BASE ?? 'http://127.0.0.1:3100' },
});
