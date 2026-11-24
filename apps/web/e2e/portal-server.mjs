// Servidor do e2e do portal contra o BUILD DE PRODUÇÃO (PM-2026-11-23-L): `next build` de e2e (LN_E2E_BUILD=1) e `next start`.
// O next dev fica só para desenvolvimento local: com os workers padrão ele compilava rotas sob demanda e travava (ERR_NETWORK_IO_SUSPENDED).
//  - Dois perfis de build, como nos deploys: 'producao' (APP_ENV=production → .next-e2e; modos empty e api) e 'vitrine'
//    (PORTAL_VITRINE=1 com APP_ENV=staging → .next-e2e-vitrine, igual à vitrine do staging; modo mock). As páginas estáticas saem do build
//    com o ambiente do perfil, exatamente como no deploy.
//  - Cada build é feito UMA vez e reaproveitado: só se refaz quando o código muda (carimbo = perfil + HEAD + árvore suja de apps/web e
//    packages) ou com PORTAL_E2E_REBUILD=1.
//  - Variáveis de cada modo (PORTAL_SOURCE, APP_ENV, PORTAL_INDEXAVEL…) valem em RUNTIME: vêm do webServer.env do portal.config.ts.
// Uso (pelo portal.config.ts): node e2e/portal-server.mjs <porta> <producao|vitrine>
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const port = process.argv[2] ?? process.env.PORT ?? '3101';
const perfil = process.argv[3] === 'vitrine' ? 'vitrine' : 'producao';
const DIST = perfil === 'vitrine' ? '.next-e2e-vitrine' : '.next-e2e';
const STAMP = join(DIST, 'portal-e2e.stamp');

// Variáveis de BUILD do perfil. As de runtime (modo do portal) NÃO entram no build.
const BUILD_ENV = {
  APP_ENV: perfil === 'vitrine' ? 'staging' : 'production',
  ...(perfil === 'vitrine' ? { PORTAL_VITRINE: '1' } : {}),
  NEXT_PUBLIC_SITE_URL: 'https://portal.example.test',
  LN_E2E_BUILD: '1',
  LN_E2E_DIST: DIST,
  NEXT_TELEMETRY_DISABLED: '1',
};
const RUNTIME_ONLY = ['PORTAL_SOURCE', 'PORTAL_API_BASE_URL', 'PORTAL_INDEXAVEL', 'PORT', 'LN_STUDIO_TEST_SESSION', 'LN_STUDIO_DEV_DB'];
if (perfil !== 'vitrine') RUNTIME_ONLY.push('PORTAL_VITRINE');

const git = (args) => spawnSync('git', args, { encoding: 'utf8', cwd: '.', shell: false }).stdout ?? '';
// Só o que entra no bundle conta para o carimbo: specs/e2e, testes unitários e arquivos de teste não refazem o build de minutos.
const ALVO = [
  '.', '../../packages',
  ':(exclude)e2e', ':(exclude)lib/**/*.test.ts', ':(glob,exclude)**/*.spec.ts', ':(glob,exclude)**/*.test.ts', ':(glob,exclude)**/*.test.tsx',
  ':(exclude).test-results', ':(exclude)../.test-results',
];
function carimbo() {
  const head = git(['rev-parse', 'HEAD']).trim();
  const sujo = git(['status', '--porcelain', '--', ...ALVO]);
  const diff = git(['diff', 'HEAD', '--', ...ALVO]);
  return createHash('sha256').update(`${perfil}\n${head}\n${sujo}\n${diff}`).digest('hex');
}

const atual = carimbo();
const precisa = process.env.PORTAL_E2E_REBUILD === '1' || !existsSync(join(DIST, 'BUILD_ID')) || !existsSync(STAMP) || readFileSync(STAMP, 'utf8').trim() !== atual;
if (precisa) {
  console.log(`[portal-e2e] next build perfil ${perfil} (${DIST}) — código mudou ou não havia build`);
  const env = { ...process.env, ...BUILD_ENV };
  for (const k of RUNTIME_ONLY) delete env[k];
  const b = spawnSync('npx next build', { stdio: 'inherit', shell: true, env });
  if (b.status !== 0) process.exit(b.status ?? 1);
  writeFileSync(STAMP, atual);
} else {
  console.log(`[portal-e2e] reaproveitando ${DIST} (perfil ${perfil}, código igual ao do build)`);
}

// Cada subida vale como um deploy novo: o cache de dados do Next (fetch com `next.revalidate`, ex.: plano de anúncios a 60 s) fica gravado
// na pasta do build e sobreviveria entre modos que usam a MESMA URL do servidor MOCK (ex.: PORTAL_API_ADS=sem e depois =com).
rmSync(join(DIST, 'cache', 'fetch-cache'), { recursive: true, force: true });

// Runtime: as variáveis do modo + LN_E2E_BUILD/LN_E2E_DIST (o next start lê a pasta do build pela config e só aceita a fonte mock
// fora do deploy com LN_E2E_BUILD=1).
const srv = spawn(`npx next start -p ${port}`, { stdio: 'inherit', shell: true, env: { ...process.env, LN_E2E_BUILD: '1', LN_E2E_DIST: DIST, NEXT_TELEMETRY_DISABLED: '1' } });
const parar = () => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(srv.pid), '/t', '/f'], { stdio: 'ignore' });
  else srv.kill('SIGTERM');
};
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { parar(); process.exit(0); });
process.on('exit', parar);
srv.on('exit', (code) => process.exit(code ?? 0));
