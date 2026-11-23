#!/usr/bin/env node
// Ensaio LOCAL de um pacote gerado por package-web.mjs, antes de enviá-lo à Vertra: copia a PASTA do pacote para um diretório
// temporário (a pasta de releases não é tocada), instala as dependências, roda o build_command e o start_command do manifesto
// (só trocando porta e host), aplica as variáveis do manifesto e roda as sondas: saúde com o commit certo, Studio negando sem login,
// ausência de MOCK. Também prova que o guard falha fechado (LN_STUDIO_TEST_SESSION e PORTAL_SOURCE=mock impedem build/start).
// Não escreve na Vertra nem no GitHub. Apaga o diretório temporário e encerra o servidor ao final.
// Condição da Vertra reproduzida: lá o HOME fica DENTRO da pasta do app (/app/.cache/vertra/tmp/build/home) e o Next recusa /app como raiz do
// workspace ("ignored package.json ... would include your home directory"). O ensaio roda instalação, build e start com HOME/USERPROFILE
// dentro da pasta do pacote; `--home outside` roda com o HOME fora (é o paliativo `HOME=/tmp/...` no comando de build).
// Uso: node infra/scripts/ensaio-pacote.mjs --manifest <arquivo .manifest.json> [--port 3197] [--home inside|outside]
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, fail } from './lib/util.mjs';
import { VITRINE_BANNER, VITRINE_MARCADORES } from './lib/guards.mjs';

const SELF = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (!args.manifest || args.manifest === true) fail('use --manifest <arquivo>', 2);
const port = String(args.port ?? 3197);
const man = JSON.parse(readFileSync(resolve(String(args.manifest)), 'utf8'));
const ca = man.ferramentas.create_app;
const apiSrc = man.depois_do_create.set_env.some((e) => e.nome === 'PORTAL_SOURCE' && e.valor === 'api'); // staging completo e producao: dados reais pela API (decisao 12)
const producao = man.depois_do_create.set_env.some((e) => e.nome === 'APP_ENV' && e.valor === 'production');
const indexavel = man.indexavel === true; // DP-24: producao so e indexavel no go-live (--indexavel)
const vitrine = man.vitrine === true; // pacote de VITRINE (staging com fixtures rotuladas) ou pacote normal (fonte vazia)
const win = process.platform === 'win32';
const results = [];
const step = (nome, ok, detalhe) => { results.push({ nome, ok, ...(detalhe ? { detalhe } : {}) }); console.error(`[${ok ? 'ok' : 'FALHOU'}] ${nome}${detalhe ? ' — ' + detalhe : ''}`); return ok; };

const clean = { ...process.env };
for (const k of ['CI', 'LN_STUDIO_TEST_SESSION', 'PORTAL_SOURCE', 'PORTAL_MODE', 'LN_E2E_BUILD', 'DIAG_XFF']) delete clean[k];
const appEnv = Object.fromEntries(man.depois_do_create.set_env.map((e) => [e.nome, e.valor]));
appEnv.APP_URL = `http://127.0.0.1:${port}`; appEnv.BETTER_AUTH_URL = appEnv.APP_URL; // URL local só para o ensaio
appEnv.NEXT_PUBLIC_SITE_URL = man.siteUrl; // variável de EXECUÇÃO obrigatória no painel (páginas dinâmicas e revalidação leem no servidor)

function sh(cmd, { cwd, env, timeout = 15 * 60 * 1000 }) {
  return spawnSync(cmd, { cwd, env, shell: true, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
}

// Executa uma cadeia `a && VAR=valor b` (sintaxe de sh da Vertra) também no Windows: o prefixo VAR=valor vira variável de ambiente do segmento.
function runChain(cmd, { cwd, env }) {
  let last = { status: 0, stdout: '', stderr: '' };
  let out = ''; let err = '';
  for (const seg of cmd.split(/\s+&&\s+/)) {
    const e = { ...env }; let c = seg.trim();
    for (;;) { const m = c.match(/^([A-Za-z_][A-Za-z0-9_]*)=(\S*)\s+([\s\S]*)$/); if (!m) break; e[m[1]] = m[2]; c = m[3]; }
    last = sh(c, { cwd, env: e });
    out += last.stdout ?? ''; err += last.stderr ?? '';
    if (last.status !== 0) break;
  }
  return { status: last.status, stdout: out, stderr: err };
}

const dir = mkdtempSync(join(tmpdir(), 'ln-ensaio-'));
const work = join(dir, 'pacote');
let server;
const stopServer = () => {
  if (!server) return;
  if (win) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F']); else { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* já encerrado */ } }
  server = undefined;
};
let ok = false;
try {
  if (!existsSync(ca.path)) fail(`pasta do pacote ausente: ${ca.path}`);
  cpSync(ca.path, work, { recursive: true });
  step('cópia do pacote para pasta temporária', true, `${man.arquivos} arquivos, commit ${man.commit.slice(0, 12)}`);
  const homeFora = args.home === 'outside';
  const homeDir = homeFora ? join(dir, 'home-fora') : join(work, '.cache', 'vertra', 'tmp', 'build', 'home');
  mkdirSync(homeDir, { recursive: true });
  clean.HOME = homeDir; clean.USERPROFILE = homeDir; // os.homedir() usa USERPROFILE no Windows e HOME no Linux
  step(`condição da Vertra: HOME ${homeFora ? 'FORA' : 'DENTRO'} da pasta do app`, true, homeDir.replace(work, '<app>'));

  let r = sh('npm install --no-audit --no-fund', { cwd: work, env: clean });
  // Se a instalação falhar (ou estourar o tempo), mostra o PORQUE: código/sinal e a cauda de stderr/stdout (QA 2 viu a etapa parar sem mensagem).
  const motivoInstall = r.status === 0 ? '' : [
    r.error ? `erro: ${r.error.code || r.error.message}` : '',
    r.status === null ? `sem código de saída (sinal ${r.signal || 'desconhecido'}; possível timeout de 15 min)` : `código ${r.status}`,
    `${r.stderr ?? ''}\n${r.stdout ?? ''}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-6).join(' | '),
  ].filter(Boolean).join(' · ').slice(0, 600);
  if (!step('npm install a partir do pacote', r.status === 0, motivoInstall)) throw new Error('install falhou');

  // guard falha fechado (no build e no start)
  r = runChain(ca.build, { cwd: work, env: { ...clean, ...appEnv, LN_STUDIO_TEST_SESSION: '1' } });
  step('build RECUSADO com LN_STUDIO_TEST_SESSION definida', r.status !== 0 && /guard-env REPROVADO/.test(`${r.stdout}${r.stderr}`));
  r = runChain(ca.start, { cwd: work, env: { ...clean, ...appEnv, PORTAL_SOURCE: 'mock' } });
  step('start RECUSADO com PORTAL_SOURCE=mock em staging', r.status !== 0 && /guard-env REPROVADO/.test(`${r.stdout}${r.stderr}`));
  // Vitrine (Security 23/11/2026, testes 2, 3 e 4): production + PORTAL_VITRINE=1 recusa build E start; pacote production com vitrine é recusado; start diverge do release.vitrine
  r = runChain(ca.build, { cwd: work, env: { ...clean, ...appEnv, APP_ENV: 'production', PORTAL_VITRINE: '1' } });
  step('[vitrine 2] build RECUSADO com APP_ENV=production + PORTAL_VITRINE=1', r.status !== 0 && /guard-env REPROVADO/.test(`${r.stdout}${r.stderr}`) && /PORTAL_VITRINE/.test(`${r.stdout}${r.stderr}`));
  r = runChain(ca.start, { cwd: work, env: { ...clean, ...appEnv, APP_ENV: 'production', PORTAL_VITRINE: '1' } });
  step('[vitrine 2] start RECUSADO com APP_ENV=production + PORTAL_VITRINE=1', r.status !== 0 && /guard-env REPROVADO/.test(`${r.stdout}${r.stderr}`) && /PORTAL_VITRINE/.test(`${r.stdout}${r.stderr}`));
  r = runChain(ca.start, { cwd: work, env: { ...clean, ...appEnv, PORTAL_VITRINE: '0' } });
  step('[vitrine 1] start RECUSADO com PORTAL_VITRINE=0 (só o valor 1 vale)', r.status !== 0 && /guard-env REPROVADO/.test(`${r.stdout}${r.stderr}`));
  r = spawnSync(process.execPath, [join(SELF, 'package-web.mjs'), '--repo', work, '--commit', man.commit, '--out', join(dir, 'prod-vitrine'), '--profile', 'production', '--vitrine'], { encoding: 'utf8' });
  step('[vitrine 3] package-web --profile production --vitrine RECUSADO', r.status !== 0 && /vitrine recusado/i.test(`${r.stdout}${r.stderr}`) && !existsSync(join(dir, 'prod-vitrine')));
  if (apiSrc) {
    // Decisão 12 do Security (A2, A3, A4): a fonte de dados reais só aceita a grafia exata, não convive com a vitrine e só fala com o próprio servidor
    r = runChain(ca.build, { cwd: work, env: { ...clean, ...appEnv, PORTAL_SOURCE: 'API' } });
    step('[api A2] build RECUSADO com PORTAL_SOURCE=API (grafia diferente de api)', r.status !== 0 && /exatamente api/.test(`${r.stdout}${r.stderr}`));
    r = runChain(ca.start, { cwd: work, env: { ...clean, ...appEnv, PORTAL_VITRINE: '1' } });
    step('[api A3] start RECUSADO com PORTAL_VITRINE junto de PORTAL_SOURCE=api', r.status !== 0 && /uma fonte por pacote/.test(`${r.stdout}${r.stderr}`));
    r = runChain(ca.build, { cwd: work, env: { ...clean, ...appEnv, PORTAL_VITRINE: '1' } });
    step('[api A3] build RECUSADO com PORTAL_VITRINE no painel junto de PORTAL_SOURCE=api', r.status !== 0 && /uma fonte por pacote/.test(`${r.stdout}${r.stderr}`));
    r = runChain(ca.start, { cwd: work, env: { ...clean, ...appEnv, PORTAL_API_BASE_URL: 'https://exemplo.invalid' } });
    step('[api A4] start RECUSADO com PORTAL_API_BASE_URL fora do loopback', r.status !== 0 && /PORTAL_API_BASE_URL/.test(`${r.stdout}${r.stderr}`));
  }
  if (producao) {
    // DP-24: produção nasce NÃO indexável; PORTAL_INDEXAVEL só com o pacote indexável (go-live) e nunca em staging
    const e = { ...clean, ...appEnv }; delete e.PORTAL_INDEXAVEL;
    if (indexavel) {
      r = runChain(ca.start, { cwd: work, env: e });
      step('[DP-24] start RECUSADO sem PORTAL_INDEXAVEL em pacote indexável', r.status !== 0 && /PORTAL_INDEXAVEL ausente/.test(`${r.stdout}${r.stderr}`));
    } else {
      r = runChain(ca.start, { cwd: work, env: { ...e, PORTAL_INDEXAVEL: '1' } });
      step('[DP-24] start RECUSADO com PORTAL_INDEXAVEL=1 em pacote NÃO indexável', r.status !== 0 && /pacote NÃO é indexável/.test(`${r.stdout}${r.stderr}`));
    }
  }
  r = runChain(ca.start, { cwd: work, env: { ...clean, ...appEnv, APP_ENV: 'staging', PORTAL_INDEXAVEL: '1' } });
  step('[DP-24] start RECUSADO com PORTAL_INDEXAVEL=1 fora de produção', r.status !== 0 && /so a producao pode ser indexavel/.test(`${r.stdout}${r.stderr}`));
  if (vitrine) {
    const e = { ...clean, ...appEnv }; delete e.PORTAL_VITRINE;
    r = runChain(ca.start, { cwd: work, env: e });
    step('[vitrine 4] start RECUSADO sem PORTAL_VITRINE em pacote de vitrine (release.vitrine=true)', r.status !== 0 && /PORTAL_VITRINE ausente em execução/.test(`${r.stdout}${r.stderr}`));
  } else {
    r = runChain(ca.start, { cwd: work, env: { ...clean, ...appEnv, PORTAL_VITRINE: '1' } });
    // com PORTAL_SOURCE=api o guard recusa antes (A3: uma fonte por pacote); sem api quem recusa é o start-web (vitrine ≠ release.vitrine)
    step('[vitrine 4] start RECUSADO com PORTAL_VITRINE=1 em pacote SEM vitrine (release.vitrine=false)', r.status !== 0 && /pacote NÃO é de vitrine|uma fonte por pacote/.test(`${r.stdout}${r.stderr}`));
  }
  if (/start-web.mjs/.test(ca.start)) {
    // start-web.mjs: o ambiente de EXECUÇÃO errado impede o start (APP_COMMIT corrompido, URL ausente ou localhost, APP_ENV trocado)
    const recusa = (nome, over, re) => { const x = runChain(ca.start, { cwd: work, env: { ...clean, ...appEnv, ...over } }); step(nome, x.status !== 0 && re.test(`${x.stdout}${x.stderr}`)); };
    recusa('start RECUSADO com APP_COMMIT corrompido (valor novo colado no antigo)', { APP_COMMIT: `460e59662459303d${man.commit}3230dda8` }, /APP_COMMIT/);
    recusa('start RECUSADO com APP_COMMIT diferente do release.json', { APP_COMMIT: 'a'.repeat(40) }, /difere do release.json/);
    recusa('start RECUSADO sem NEXT_PUBLIC_SITE_URL em execução', { NEXT_PUBLIC_SITE_URL: '' }, /NEXT_PUBLIC_SITE_URL ausente/);
    recusa('start RECUSADO com NEXT_PUBLIC_SITE_URL=localhost', { NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' }, /NEXT_PUBLIC_SITE_URL/);
    recusa('start RECUSADO com APP_ENV diferente do release.json', { APP_ENV: 'production' }, /APP_ENV/);
  }

  // o "painel" aqui traz NEXT_PUBLIC_SITE_URL=localhost (pior caso, como na Vertra em 22/11): o build_command do pacote tem de sobrescrever
  const buildEnv = { ...clean, ...appEnv, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' };
  if (vitrine || apiSrc) delete buildEnv.PORTAL_VITRINE; else buildEnv.PORTAL_VITRINE = '1'; // a vitrine vem do release.json, nunca do painel (com api o painel hostil com vitrine é recusado, testado acima)
  r = runChain(ca.build, { cwd: work, env: buildEnv });
  const motivoBuild = r.status === 0 ? '' : `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter((l) => /ignored package\.json|home directory|Could not find the Next\.js package|Filesystem root|turbopack\.root/i.test(l)).map((l) => l.trim()).slice(0, 4).join(' | ');
  if (man.semTypecheckNoBuild === true) {
    const log = `${r.stdout}${r.stderr}`;
    step('[typecheck] build do pacote SEM checagem de tipos dentro do build (release.json.semTypecheckNoBuild)', r.status === 0 && /typecheck-no-build=dispensado/.test(log) && (/Skipping validation of types/i.test(log) || !/Running TypeScript/.test(log)), /Running TypeScript/.test(log) ? 'o Next AINDA rodou o TypeScript: falta a linha de apps/web/next.config.ts (int/006)' : '');
  }
  if (!step(`build com o build_command do manifesto (painel com NEXT_PUBLIC_SITE_URL=localhost e ${vitrine ? 'SEM PORTAL_VITRINE: vem do release.json' : apiSrc ? 'sem PORTAL_VITRINE' : 'PORTAL_VITRINE=1: ignorada'})`, r.status === 0, motivoBuild)) throw new Error('build falhou');

  const start = /start-web.mjs/.test(ca.start) ? `${ca.start} --port ${port} --host 127.0.0.1` : ca.start.replace('-p 80 -H 0.0.0.0', `-p ${port} -H 127.0.0.1`);
  server = spawn(start, { cwd: work, env: { ...clean, ...appEnv }, shell: true, stdio: 'ignore', detached: !win });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) }); up = res.ok; } catch { await new Promise((s) => setTimeout(s, 700)); }
  }
  if (!step('servidor sobe com o start_command do manifesto', up)) throw new Error('servidor não subiu');

  r = spawnSync(process.execPath, [join(SELF, 'healthcheck.mjs'), '--url', `http://127.0.0.1:${port}`, '--expect-commit', man.commit, '--denied', '/studio', ...(vitrine ? ['--vitrine', '/'] : ['--no-mock', '/'])], { encoding: 'utf8' });
  step(vitrine ? 'sondas: saúde com o commit certo, Studio nega sem login, home COM a faixa da vitrine' : 'sondas: saúde com o commit certo, Studio nega sem login, sem MOCK nem marcador da vitrine', r.status === 0, r.status === 0 ? JSON.parse(r.stdout).denied?.status + ' ' + (JSON.parse(r.stdout).denied?.location ?? '') : r.stdout.trim().slice(0, 300));

  r = spawnSync(process.execPath, [join(SELF, 'healthcheck.mjs'), '--url', `http://127.0.0.1:${port}`, '--noindex', '/', '--canonical', man.siteUrl], { encoding: 'utf8' });
  step('staging NÃO indexável (robots Disallow: /, sitemap vazio, noindex) e canonical certo na home e em /noticias', r.status === 0, r.status === 0 ? '' : (() => { try { return JSON.parse(r.stdout).failures.join(' | ').slice(0, 400); } catch { return r.stdout.trim().slice(0, 400); } })());
  {
    const home = await (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(8000) })).text();
    const canon = (home.match(/<link[^>]+rel="canonical"[^>]*href="([^"]+)"/i) || home.match(/<link[^>]+href="([^"]+)"[^>]*rel="canonical"/i) || [])[1];
    step('canonical da home usa a URL do staging (NEXT_PUBLIC_SITE_URL no build)', Boolean(canon) && canon.startsWith(man.siteUrl) && !/localhost/.test(canon), canon || 'sem canonical');
  }

  for (const p of ['/', '/noticias', '/agenda', '/busca', '/studio/entrar']) {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const body = await res.text();
    const portal = p !== '/studio/entrar';
    if (vitrine) step(`portal ${p}${portal ? ' (com a faixa da vitrine)' : ''}`, res.status === 200 && (!portal || body.includes(VITRINE_BANNER)), `HTTP ${res.status}`);
    else step(`portal ${p}`, res.status === 200 && !/\bMOCK\b/.test(body) && !VITRINE_MARCADORES.some((m) => body.includes(m)), `HTTP ${res.status}`);
  }
  if (apiSrc) {
    // Decisão 12, A6 (Security): API indisponível/com erro = estado vazio honesto, nunca 500, nunca fixture, e nada interno na resposta (URL base, stack).
    // Aqui a API própria do pacote responde 503 NOT_CONFIGURED (sem banco): as listagens têm de sair vazias e a matéria inexistente 404 ou 503.
    for (const p of ['/', '/noticias']) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      const body = await res.text();
      const vaza = /127\.0\.0\.1|localhost|\bat \w+\s*\(|ECONNREFUSED|api\/publico/i.test(body.replace(/https?:\/\/loyaltynews[a-z0-9.-]*\.vertraweb\.app/gi, ''));
      step(`[A6] ${p} com a API indisponível: 200 vazio, sem MOCK e sem URL interna`, res.status === 200 && !/\bMOCK\b/.test(body) && !vaza, `HTTP ${res.status}${vaza ? ' (vaza detalhe interno)' : ''}`);
    }
    const art = await fetch(`http://127.0.0.1:${port}/noticia/materia-que-nao-existe-ensaio`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    await art.text();
    step('[A6] matéria com a API indisponível: 404 ou 503 (nunca 500)', art.status === 404 || art.status === 503, `HTTP ${art.status}`);
  }
  // [vitrine 1/5] sitemap e feed: nunca itens da vitrine (R6) e, no staging, nem itens nem URLs; 404 também serve (rota inexistente não vaza nada)
  for (const p of ['/sitemap.xml', '/feed.xml']) {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const body = await res.text();
    const vaza = VITRINE_MARCADORES.some((m) => body.includes(m)) || /\bMOCK\b/.test(body) || /<(?:loc|item|entry)\b/i.test(body);
    step(`${vitrine ? '[vitrine 1]' : '[vitrine 5]'} ${p} sem itens nem marcadores de demonstração`, (res.status === 200 || res.status === 404) && !vaza, `HTTP ${res.status}`);
  }
  // [vitrine 7] teste unitário do Frontend para getSource/resolveSourceKind: APP_ENV=production + PORTAL_VITRINE=1 + PORTAL_SOURCE=mock => fonte vazia
  const unit = join(work, 'apps', 'web', 'lib', 'indexing.test.ts');
  if (existsSync(unit)) {
    r = sh('npx vitest run apps/web/lib/indexing.test.ts', { cwd: work, env: { ...clean, CI: '' } });
    step('[vitrine 7] teste unitário de resolveSourceKind/getSource (production nunca vê mock)', r.status === 0, r.status === 0 ? '' : `${r.stdout}\n${r.stderr}`.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ').slice(0, 300));
  } else {
    step('[vitrine 7] teste unitário de resolveSourceKind/getSource', !vitrine, vitrine ? 'AUSENTE no pacote de vitrine: o portal precisa do teste do Frontend (apps/web/lib/indexing.test.ts)' : 'n/a: este commit não tem o suporte de vitrine do portal (sem apps/web/lib/indexing.test.ts)');
  }
  ok = results.every((x) => x.ok);
} catch (e) {
  step('ensaio interrompido', false, e.message);
} finally {
  stopServer();
  await new Promise((s) => setTimeout(s, 800));
  rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok, commit: man.commit, pacote: man.pasta, etapas: results }, null, 2));
process.exit(ok ? 0 : 1);
