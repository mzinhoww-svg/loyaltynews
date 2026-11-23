// e2e do LN Studio: constrói o bundle de e2e (.next-e2e, único com a sessão simulada MOCK) e roda o Playwright.
// Uso: npm run e2e  (E2E_PORT define a porta; cada worktree usa a sua).
import { spawnSync } from 'node:child_process';

// Padrões de ambiente do build de e2e (integração int/002): os testes de indexação do portal (e2e/portal/env.spec.ts)
// esperam APP_ENV=production e a URL de teste portal.example.test (o build de produção recusa localhost). Sobrescreva por
// variável (ex.: PORTAL_APP_ENV=staging APP_ENV=staging) para a outra combinação. É só o build .next-e2e; não afeta produção.
const env = {
  APP_ENV: 'production',
  PORTAL_APP_ENV: process.env.APP_ENV ?? 'production',
  NEXT_PUBLIC_SITE_URL: 'https://portal.example.test',
  ...process.env,
  LN_E2E_BUILD: '1',
};

function run(cmd) {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('npx next build');
run(`npx playwright test ${process.argv.slice(2).join(' ')}`);
