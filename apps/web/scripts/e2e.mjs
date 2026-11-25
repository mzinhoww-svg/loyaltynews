// e2e do LN Studio: constrói o bundle de e2e (.next-e2e, único com a sessão simulada MOCK) e roda o Playwright.
// Uso: npm run e2e  (E2E_PORT define a porta; cada worktree usa a sua).
import { spawnSync } from 'node:child_process';

// Padrões de ambiente do build de e2e (integração int/002): os testes de indexação do portal (e2e/portal/env.spec.ts)
// esperam APP_ENV=production e a URL de teste portal.example.test (o build de produção recusa localhost). Sobrescreva por
// variável (ex.: PORTAL_APP_ENV=staging APP_ENV=staging) para a outra combinação. É só o build .next-e2e; não afeta produção.
// DP-24 (int/007): em produção a indexação só abre com PORTAL_INDEXAVEL=1; o e2e de produção liga o interruptor como o
// e2e/portal.config.ts. PORTAL_INDEXAVEL_E2E=0 testa a produção SEM o interruptor (padrão do go-live).
//
// ORDEM DOS SPECS: o banco de e2e é UM só, começa vazio e os specs rodam em série na ordem alfabética dos arquivos.
// Dois specs do fim dependem do que o studio-cms.spec.ts deixa no banco ("Banco Beta revisa tarifas de cartão"):
//   - studio-z-correcao-cms.spec.ts e, depois dele, studio-z-fabrica-correcao.spec.ts.
// Rodá-los sozinhos falha por falta de dado, não por defeito de código — rode com studio-cms antes (ex.:
// `node scripts/e2e.mjs studio-cms studio-z-correcao-cms studio-z-fabrica-correcao`) ou a suíte inteira.
const appEnvE2e = process.env.APP_ENV ?? 'production';
const indexavelE2e = appEnvE2e === 'production' && (process.env.PORTAL_INDEXAVEL_E2E ?? '1') === '1';
const env = {
  APP_ENV: 'production',
  PORTAL_APP_ENV: process.env.APP_ENV ?? 'production',
  NEXT_PUBLIC_SITE_URL: 'https://portal.example.test',
  ...(indexavelE2e ? { PORTAL_INDEXAVEL: '1' } : {}),
  ...process.env,
  LN_E2E_BUILD: '1',
  // O limite de tentativas falha fechado sem sal (decisão de privacidade: IP só como HMAC). O harness precisa da chave.
  LN_ATTEMPT_HMAC_KEY: 'e2e-chave-do-hmac-de-ip-com-32-caracteres',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'segredo-de-teste-do-e2e-com-32-bytes!!',
};

function run(cmd) {
  const r = spawnSync(cmd, { stdio: 'inherit', shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run('npx next build');
run(`npx playwright test ${process.argv.slice(2).join(' ')}`);
