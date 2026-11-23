#!/usr/bin/env node
// Start do apps/web NA VERTRA que RECUSA subir com o ambiente de execução errado (falha fechada), comparando-o com o release.json do pacote.
// Incidente 22/11/2026: o app subiu "saudável" com (a) APP_COMMIT colado no meio do valor antigo e (b) NEXT_PUBLIC_SITE_URL ausente em execução
// (canonical voltou a http://localhost:3000). Só uma sonda externa percebia. Aqui o app nem inicia (com zero downtime e rollback automático a versão anterior deve continuar no ar; ainda não testado na Vertra).
// Confere: guard de variáveis só de teste, APP_ENV = release.appEnv, NEXT_PUBLIC_SITE_URL = release.siteUrl (sem barra final, sem localhost),
// APP_COMMIT = 40 hex e = release.commit. Não imprime valores de variáveis além de APP_ENV, da URL pública e do commit (nada secreto).
// Uso (start_command do app): node infra/scripts/guard-env.mjs && node infra/scripts/start-web.mjs
//   opções (ensaio local): --port 80 --host 0.0.0.0 (padrões da Vertra)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { envProblems } from './lib/guards.mjs';
import { parseArgs } from './lib/util.mjs';

/** Problemas do ambiente de EXECUÇÃO em relação ao release.json. Função pura (testada sem subir servidor). */
export function startProblems(env, release) {
  const p = [];
  if (!release?.siteUrl || !release?.appEnv || !release?.commit) {
    return ['release.json sem commit/siteUrl/appEnv: o pacote não foi gerado por package-web.mjs com --subdomain'];
  }
  const appEnv = String(env.APP_ENV ?? '');
  if (appEnv.toLowerCase() !== String(release.appEnv).toLowerCase()) p.push(`APP_ENV="${appEnv}" difere do release.json ("${release.appEnv}")`);
  p.push(...envProblems({ ...env, APP_ENV: release.appEnv }, { deploy: true }));
  const url = String(env.NEXT_PUBLIC_SITE_URL ?? '');
  if (!url) p.push(`NEXT_PUBLIC_SITE_URL ausente em execução: páginas dinâmicas e a revalidação da home voltariam a http://localhost:3000; defina ${release.siteUrl}`);
  else if (url !== release.siteUrl) p.push(`NEXT_PUBLIC_SITE_URL="${url}" difere do release.json ("${release.siteUrl}"; sem barra no fim, sem espaços)`);
  // Vitrine (Security R3): em execução PORTAL_VITRINE tem de ser exatamente o que o release.json diz (1 com vitrine; ausente/vazia sem).
  const vitEnv = String(env.PORTAL_VITRINE ?? '').trim();
  const vitRel = release.vitrine === true ? '1' : '';
  if (vitEnv !== vitRel) p.push(release.vitrine === true ? 'PORTAL_VITRINE ausente em execução: o pacote é de VITRINE (release.json.vitrine=true); defina PORTAL_VITRINE=1' : `PORTAL_VITRINE=${env.PORTAL_VITRINE} em execução, mas o pacote NÃO é de vitrine (release.json.vitrine=false): apague a variável`);
  const commit = String(env.APP_COMMIT ?? '');
  if (!/^[0-9a-f]{40}$/.test(commit)) p.push(`APP_COMMIT não é um SHA de 40 caracteres hexadecimais minúsculos (tamanho ${commit.length}); apague o valor inteiro e cole só ${release.commit}`);
  else if (commit !== release.commit) p.push(`APP_COMMIT=${commit} difere do release.json (${release.commit})`);
  return p;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const rel = join(root, 'release.json');
  if (!existsSync(rel)) { console.error('[start-web] release.json ausente: o pacote não foi gerado por package-web.mjs'); process.exit(2); }
  const problems = startProblems(process.env, JSON.parse(readFileSync(rel, 'utf8')));
  if (problems.length) {
    console.error('[start-web] AMBIENTE DE EXECUÇÃO REPROVADO (o app não sobe):\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  console.log(`[start-web] ambiente ok (APP_ENV=${process.env.APP_ENV} NEXT_PUBLIC_SITE_URL=${process.env.NEXT_PUBLIC_SITE_URL} APP_COMMIT=${String(process.env.APP_COMMIT).slice(0, 12)}…)`);
  const next = createRequire(join(root, 'package.json')).resolve('next/dist/bin/next');
  const child = spawn(process.execPath, [next, 'start', 'apps/web', '-p', String(args.port ?? 80), '-H', String(args.host ?? '0.0.0.0')], { cwd: root, stdio: 'inherit', env: process.env });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
