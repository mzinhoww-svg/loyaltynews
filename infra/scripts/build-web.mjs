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
import { envProblems, VITRINE_BANNER, VITRINE_MARCADORES } from './lib/guards.mjs';
import { buildLeveEnv, typecheckEnv } from './lib/typecheck-report.mjs';

/** Problemas do HTML estático da home em relação ao ambiente esperado. Função pura (testada sem build). */
export function checkHome(html, siteUrl, appEnv, vitrine = false, indexavel = false) {
  const problems = [];
  const canon = (html.match(/<link[^>]+rel="canonical"[^>]*href="([^"]+)"/i) || html.match(/<link[^>]+href="([^"]+)"[^>]*rel="canonical"/i) || [])[1];
  if (!canon) problems.push('home sem link canonical');
  else if (!canon.startsWith(siteUrl) || /localhost/i.test(canon)) problems.push(`canonical da home é "${canon}"; esperado começar com ${siteUrl}`);
  const noindex = /<meta[^>]+name="robots"[^>]*content="[^"]*noindex/i.test(html) || /<meta[^>]+content="[^"]*noindex[^"]*"[^>]*name="robots"/i.test(html);
  // noindex: obrigatório fora de produção e, em produção, enquanto o pacote NÃO for indexável (DP-24: produção nasce sem indexação até o go-live)
  const producao = ['production', 'producao'].includes(String(appEnv).toLowerCase());
  if ((!producao || !indexavel) && !noindex) problems.push(producao ? 'home de produção sem meta robots noindex, mas o pacote não é indexável (DP-24: indexação só no go-live, com --indexavel)' : 'home sem meta robots noindex em ambiente não produtivo');
  // Vitrine do staging (Security R5/R8): com vitrine a home TEM a faixa de demonstração; sem vitrine NÃO pode ter nenhum marcador (nunca fixtures sem rótulo, nunca em produção).
  if (vitrine) { if (!html.includes(VITRINE_BANNER)) problems.push(`vitrine ligada, mas a home não tem a faixa "${VITRINE_BANNER}" (R5): o portal não aplicou PORTAL_VITRINE`); }
  else { const achados = VITRINE_MARCADORES.filter((m) => html.includes(m)); if (achados.length) problems.push(`home sem vitrine contém marcador(es) de demonstração: ${achados.join(' | ')}`); }
  return problems;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  const root = process.cwd();
  const rel = join(root, 'release.json');
  if (!existsSync(rel)) { console.error('[build-web] release.json ausente: o pacote não foi gerado por package-web.mjs'); process.exit(2); }
  const releaseJson = JSON.parse(readFileSync(rel, 'utf8'));
  const { siteUrl, appEnv, vitrine: vitrineRel, indexavel: indexavelRel } = releaseJson;
  const indexavel = indexavelRel === true; // DP-24: release.json é a fonte da verdade; ausente = não indexável
  const vitrine = vitrineRel === true; // release.json é a fonte da verdade; ausente = sem vitrine
  if (!siteUrl || !appEnv) { console.error('[build-web] release.json sem siteUrl/appEnv'); process.exit(2); }

  // O que vale é o release.json, não o painel: PORTAL_VITRINE do painel é ignorada (sobrescrita) e reportada no log.
  const painelVitrine = process.env.PORTAL_VITRINE;
  const efetivo = { ...process.env, APP_ENV: appEnv };
  if (vitrine) efetivo.PORTAL_VITRINE = '1'; else delete efetivo.PORTAL_VITRINE;
  if (indexavel) efetivo.PORTAL_INDEXAVEL = '1'; else delete efetivo.PORTAL_INDEXAVEL;
  // Opcao (e) do PM: o typecheck NAO roda dentro do build da Vertra (RAM); so quando o release.json o dispensa (o pacote exigiu o relatorio de typecheck verde do mesmo commit). O painel nunca decide.
  delete efetivo.LN_BUILD_SKIP_TYPECHECK;
  Object.assign(efetivo, typecheckEnv(releaseJson));
  // Build leve (1 worker no next build) so quando o release.json pede; o painel nao decide (a variavel do painel, se existir, e apagada).
  delete efetivo.CIRCLE_NODE_TOTAL;
  Object.assign(efetivo, buildLeveEnv(releaseJson));
  const probs = envProblems(efetivo, { deploy: true });
  if (probs.length) { console.error(`[build-web] ambiente reprovado:\n - ${probs.join('\n - ')}`); process.exit(1); }

  console.log(`[build-web] APP_ENV=${appEnv} NEXT_PUBLIC_SITE_URL=${siteUrl} PORTAL_VITRINE=${vitrine ? '1' : '(ausente)'} build-leve=${efetivo.CIRCLE_NODE_TOTAL ? '1 worker' : 'padrao'} typecheck-no-build=${efetivo.LN_BUILD_SKIP_TYPECHECK === '1' ? 'dispensado (relatorio ' + (releaseJson.typecheckRelatorio ?? '?') + ')' : 'ligado'}`);
  console.log(`[build-web] valores que o painel tinha: APP_ENV=${process.env.APP_ENV ?? '(indefinida)'} NEXT_PUBLIC_SITE_URL=${process.env.NEXT_PUBLIC_SITE_URL ?? '(indefinida)'} (sobrescritos acima); PORTAL_VITRINE do painel=${painelVitrine === undefined ? '(indefinida)' : painelVitrine}`);
  const win = process.platform === 'win32';
  const r = spawnSync(win ? 'npm.cmd' : 'npm', ['run', 'build', '-w', 'apps/web'], {
    cwd: root, stdio: 'inherit', shell: win, env: { ...efetivo, NEXT_PUBLIC_SITE_URL: siteUrl },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);

  const home = join(root, 'apps', 'web', '.next', 'server', 'app', 'index.html');
  if (!existsSync(home)) {
    console.warn('[build-web] AVISO: apps/web/.next/server/app/index.html não existe (home dinâmica?): verificação do HTML pulada');
  } else {
    const problems = checkHome(readFileSync(home, 'utf8'), siteUrl, appEnv, vitrine, indexavel);
    if (problems.length) { console.error(`[build-web] BUILD REPROVADO na verificação da home:\n - ${problems.join('\n - ')}`); process.exit(1); }
    console.log(`[build-web] verificação da home ok (canonical com a URL do ambiente, noindex${vitrine ? ', faixa da vitrine presente' : ', sem marcadores de demonstração'})`);
  }
}
