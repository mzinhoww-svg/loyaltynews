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
import { restaurarPrebuilt } from './lib/prebuilt.mjs';
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
  // o start NUNCA usa a exceção do CI=true do runner do GitHub (só o build): GITHUB_ACTIONS no app em execução é recusado (Security 24/11)
  if (String(env.GITHUB_ACTIONS ?? '') !== '') p.push('GITHUB_ACTIONS definida em execução: a variável é do runner do GitHub Actions e não pode existir no app da Vertra; apague-a');
  const url = String(env.NEXT_PUBLIC_SITE_URL ?? '');
  if (!url) p.push(`NEXT_PUBLIC_SITE_URL ausente em execução: páginas dinâmicas e a revalidação da home voltariam a http://localhost:3000; defina ${release.siteUrl}`);
  else if (url !== release.siteUrl) p.push(`NEXT_PUBLIC_SITE_URL="${url}" difere do release.json ("${release.siteUrl}"; sem barra no fim, sem espaços)`);
  // Vitrine (Security R3): em execução PORTAL_VITRINE tem de ser exatamente o que o release.json diz (1 com vitrine; ausente/vazia sem).
  const vitEnv = String(env.PORTAL_VITRINE ?? '').trim();
  const vitRel = release.vitrine === true ? '1' : '';
  if (vitEnv !== vitRel) p.push(release.vitrine === true ? 'PORTAL_VITRINE ausente em execução: o pacote é de VITRINE (release.json.vitrine=true); defina PORTAL_VITRINE=1' : `PORTAL_VITRINE=${env.PORTAL_VITRINE} em execução, mas o pacote NÃO é de vitrine (release.json.vitrine=false): apague a variável`);
  // DP-24: em execução PORTAL_INDEXAVEL tem de ser 1 só se o release.json for indexável (go-live); do contrário ausente.
  const idxEnv = String(env.PORTAL_INDEXAVEL ?? ''); // exato, sem trim (I4)
  const idxRel = release.indexavel === true ? '1' : '';
  if (idxEnv !== idxRel) p.push(release.indexavel === true ? 'PORTAL_INDEXAVEL ausente em execução: o pacote é INDEXÁVEL (release.json.indexavel=true); defina PORTAL_INDEXAVEL=1' : `PORTAL_INDEXAVEL=${env.PORTAL_INDEXAVEL} em execução, mas o pacote NÃO é indexável (release.json.indexavel=false): apague a variável (a indexação só liga no go-live)`);
  if (String(env.LN_BUILD_SKIP_TYPECHECK ?? '') !== '') p.push('LN_BUILD_SKIP_TYPECHECK definida em execução: ela só existe no build e vem do release.json (semTypecheckNoBuild); apague a variável do app');
  const commit = String(env.APP_COMMIT ?? '');
  if (!/^[0-9a-f]{40}$/.test(commit)) p.push(`APP_COMMIT não é um SHA de 40 caracteres hexadecimais minúsculos (tamanho ${commit.length}); apague o valor inteiro e cole só ${release.commit}`);
  else if (commit !== release.commit) p.push(`APP_COMMIT=${commit} difere do release.json (${release.commit})`);
  return p;
}

/**
 * Como o `next start` é chamado. O Next carrega o `next.config.ts` com um gancho de require; começando da RAIZ do repositório com `next start apps/web` (como era), um
 * `next.config.ts` que importa um módulo .ts irmão (ex.: ./cache-policy, int/016 em diante) NÃO acha o módulo ("Cannot find module './cache-policy'": servidor "Ready" mas sem
 * config, 0 de 200 no /api/health; reproduzido em 24/11 com o build da int/018 e reprovou os ensaios das int/016–018). Começando de DENTRO de apps/web, sem o argumento de pasta,
 * o mesmo build sobe normalmente. O .next, o distDir e a raiz do workspace não mudam (tudo é relativo ao projeto apps/web).
 */
export function nextStartInvocation(root, nextBin, port, host) {
  return { args: [nextBin, 'start', '-p', String(port), '-H', String(host)], cwd: join(root, 'apps', 'web') };
}

/**
 * FALHA FECHADA do pré-construído: depois de `restaurarPrebuilt`, o app só sobe se houver `prebuilt/prebuilt.json`,
 * `apps/web/.next/.ln-prebuilt.json` (a marca da restauração), o `BUILD_ID` do `.next` e a marca/prebuilt apontarem o
 * mesmo build/commit. Sem isso, o volume pode servir um `.next` antigo reportando o commit novo — verde falso.
 * Devolve a lista de conferências reprovadas (vazia = pode subir). Função pura, testada sem subir servidor.
 * DECISÃO: o `restaurarPrebuilt` PODE consertar um `.next` sem marca ou com marca divergente quando há manifesto coerente;
 * os testes de processo provam o exit 0 com `.next`/marca corrigidos. A recusa é só o irrecuperável: manifesto ausente/
 * ilegível, `release.prebuilt=true` sem manifesto e prebuilt corrompido.
 */
export function prebuiltStartProblems(root, release) {
  const p = [];
  const declarado = release?.prebuilt === true;
  const temPrebuilt = existsSync(join(root, 'prebuilt')) || existsSync(join(root, 'apps', 'web', '.next', '.ln-prebuilt.json'));
  // Pacote comum legítimo (sem release.prebuilt e sem artefato/marca): o build é o da Vertra e o start segue.
  // Qualquer sinal de pré-construído (declarado no release.json, pasta prebuilt/ ou marca no .next) exige a prova completa.
  if (!declarado && !temPrebuilt) return p;
  const man = join(root, 'prebuilt', 'prebuilt.json');
  let pb = null;
  if (!existsSync(man)) p.push(declarado ? 'release.json declara prebuilt=true e prebuilt/prebuilt.json ausente: recuso servir o .next do volume' : 'prebuilt/prebuilt.json ausente: recuso servir o .next do volume');
  else {
    try { pb = JSON.parse(readFileSync(man, 'utf8').replace(/^\uFEFF/, '')); } catch { p.push('prebuilt/prebuilt.json ilegível'); }
  }
  const destino = join(root, 'apps', 'web', '.next');
  const marca = join(destino, '.ln-prebuilt.json');
  let m = null;
  if (!existsSync(marca)) p.push('apps/web/.next/.ln-prebuilt.json ausente: não há prova de que o .next do volume veio do prebuilt');
  else {
    try { m = JSON.parse(readFileSync(marca, 'utf8')); } catch { p.push('apps/web/.next/.ln-prebuilt.json ilegível'); }
  }
  const bid = existsSync(join(destino, 'BUILD_ID')) ? readFileSync(join(destino, 'BUILD_ID'), 'utf8').trim() : null;
  if (!bid) p.push('apps/web/.next/BUILD_ID ausente');
  if (m && bid && m.buildId !== bid) p.push(`BUILD_ID da marca (${m.buildId}) difere do .next (${bid})`);
  if (m && pb && m.buildId !== pb.buildId) p.push(`BUILD_ID da marca (${m.buildId}) difere do prebuilt.json (${pb.buildId})`);
  if (m && pb && m.commit && pb.commit && m.commit !== pb.commit) p.push(`commit da marca (${m.commit}) difere do prebuilt.json (${pb.commit})`);
  return p;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const rel = join(root, 'release.json');
  if (!existsSync(rel)) { console.error('[start-web] release.json ausente: o pacote não foi gerado por package-web.mjs'); process.exit(2); }
  const release = JSON.parse(readFileSync(rel, 'utf8'));
  const problems = startProblems(process.env, release);
  if (problems.length) {
    console.error('[start-web] AMBIENTE DE EXECUÇÃO REPROVADO (o app não sobe):\n - ' + problems.join('\n - '));
    process.exit(1);
  }
  console.log(`[start-web] ambiente ok (APP_ENV=${process.env.APP_ENV} NEXT_PUBLIC_SITE_URL=${process.env.NEXT_PUBLIC_SITE_URL} APP_COMMIT=${String(process.env.APP_COMMIT).slice(0, 12)}…)`);
  // Pacote PRÉ-CONSTRUÍDO (sem next build na Vertra): restaura o .next e confere que ele é deste commit/ambiente.
  // FALHA FECHADA: sem prebuilt.json/marca/BUILD_ID coerente, o app NÃO sobe (não existe "segue com o .next do volume").
  const pb = restaurarPrebuilt(root, release);
  if (pb.ativo) {
    for (const l of pb.log) console.log(`[start-web] prebuilt: ${l}`);
    if (pb.problemas.length) { console.error(['[start-web] PRÉ-CONSTRUÍDO REPROVADO (o app não sobe):', ...pb.problemas].join('\n - ')); process.exit(1); }
  }
  const pbp = prebuiltStartProblems(root, release);
  if (pbp.length) {
    console.error('[start-web] PRÉ-CONSTRUÍDO EXIGIDO/REPROVADO (o app não sobe):\n - ' + pbp.join('\n - '));
    process.exit(1);
  }
  console.log('[start-web] prebuilt ok (.next, marca e BUILD_ID coerentes com o prebuilt.json)');
  const next = createRequire(join(root, 'package.json')).resolve('next/dist/bin/next');
  const inv = nextStartInvocation(root, next, args.port ?? 80, args.host ?? '0.0.0.0');
  const child = spawn(process.execPath, inv.args, { cwd: inv.cwd, stdio: 'inherit', env: process.env });
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}
