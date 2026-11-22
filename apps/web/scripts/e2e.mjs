// e2e do LN Studio: constrói o bundle de e2e (.next-e2e, único com a sessão simulada MOCK) e roda o Playwright.
// Uso: npm run e2e  (E2E_PORT define a porta; cada worktree usa a sua).
import { spawnSync } from 'node:child_process';

const env = { ...process.env, LN_E2E_BUILD: '1' };

function run(cmd) {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('npx next build');
run(`npx playwright test ${process.argv.slice(2).join(' ')}`);
