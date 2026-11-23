#!/usr/bin/env node
// Build do apps/web NA VERTRA com o ambiente definido de forma EXPLÍCITA, sem depender de sintaxe de shell nem das variáveis do painel.
// Incidente 22/11/2026: com `... && APP_ENV=staging NEXT_PUBLIC_SITE_URL=<url> npm run build ...` no build_command, a home estática saiu com
// canonical `http://localhost:3000` (a URL não chegou ao `next build` na Vertra; o mesmo comando funciona no ensaio local). Aqui os valores vêm do
// release.json do pacote (gravado por package-web.mjs) e entram direto no ambiente do processo filho, sobrescrevendo qualquer valor do painel.
// Depois do build, confere o HTML estático da home (.next/server/app/index.html): canonical com a URL do ambiente e noindex fora de produção.
// Se não bater, o build FALHA (melhor parar que publicar um staging com URL errada). Mostra no log os valores efetivos (diagnóstico).
// Uso (comando de build do app): node infra/scripts/guard-env.mjs && node infra/scripts/build-web.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { envProblems } from './lib/guards.mjs';

/** Problemas do HTML estático da home em relação ao ambiente esperado. Função pura (testada sem build). */
export function checkHome(html, siteUrl, appEnv) {
  const problems = [];
  const canon = (html.match(/<link[^>]+rel="canonical"[^>]*href="([^"]+)"/i) || html.match(/<link[^>]+href="([^"]+)"[^>]*rel="canonical"/i) || [])[1];
  if (!canon) problems.push('home sem link canonical');
  else if (!canon.startsWith(siteUrl) || /localhost/i.test(canon)) problems.push(`canonical da home é "${canon}"; esperado começar com ${siteUrl}`);
  const noindex = /<meta[^>]+name="robots"[^>]*content="[^"]*noindex/i.test(html) || /<meta[^>]+content="[^"]*noindex[^"]*"[^>]*name="robots"/i.test(html);
  if (!['production', 'producao'].includes(String(appEnv).toLowerCase()) && !noindex) problems.push('home sem meta robots noindex em ambiente não produtivo');
  return problems;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  const root = process.cwd();
  const rel = join(root, 'release.json');
  if (!existsSync(rel)) { console.error('[build-web] release.json ausente: o pacote não foi gerado por package-web.mjs'); process.exit(2); }
  const { siteUrl, appEnv } = JSON.parse(readFileSync(rel, 'utf8'));
  if (!siteUrl || !appEnv) { console.error('[build-web] release.json sem siteUrl/appEnv'); process.exit(2); }

  const probs = envProblems({ ...process.env, APP_ENV: appEnv }, { deploy: true });
  if (probs.length) { console.error(`[build-web] ambiente reprovado:\n - ${probs.join('\n - ')}`); process.exit(1); }

  console.log(`[build-web] APP_ENV=${appEnv} NEXT_PUBLIC_SITE_URL=${siteUrl}`);
  console.log(`[build-web] valores que o painel tinha: APP_ENV=${process.env.APP_ENV ?? '(indefinida)'} NEXT_PUBLIC_SITE_URL=${process.env.NEXT_PUBLIC_SITE_URL ?? '(indefinida)'} (sobrescritos acima)`);
  const win = process.platform === 'win32';
  const r = spawnSync(win ? 'npm.cmd' : 'npm', ['run', 'build', '-w', 'apps/web'], {
    cwd: root, stdio: 'inherit', shell: win, env: { ...process.env, APP_ENV: appEnv, NEXT_PUBLIC_SITE_URL: siteUrl },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);

  const home = join(root, 'apps', 'web', '.next', 'server', 'app', 'index.html');
  if (!existsSync(home)) {
    console.warn('[build-web] AVISO: apps/web/.next/server/app/index.html não existe (home dinâmica?): verificação do HTML pulada');
  } else {
    const problems = checkHome(readFileSync(home, 'utf8'), siteUrl, appEnv);
    if (problems.length) { console.error(`[build-web] BUILD REPROVADO na verificação da home:\n - ${problems.join('\n - ')}`); process.exit(1); }
    console.log('[build-web] verificação da home ok (canonical com a URL do ambiente e noindex)');
  }
}
