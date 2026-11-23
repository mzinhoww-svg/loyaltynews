#!/usr/bin/env node
// Gera o pacote de deploy do apps/web SEM GitHub, a partir de um COMMIT LOCAL conhecido (git archive).
// O pacote vem do commit, não da pasta de trabalho: arquivos não commitados, node_modules, .next, .env* e testes e2e ficam de fora.
// Saída (em --out): pasta  ln-web-<perfil>-<sha12>/  (para as ferramentas create_app/deploy_app, que recebem uma PASTA)
//                   ZIP    ln-web-<perfil>-<sha12>.zip (para o painel da Vertra; mesmo conteúdo)
//                   manifesto .manifest.json (commit, SHA-256 do ZIP, comandos, variáveis a definir, passos)
// Reprodutível: o mesmo commit gera o mesmo ZIP, byte a byte (git archive usa a data do commit).
// Não escreve na Vertra nem no GitHub; só lê o repositório local e escreve em --out.
// Uso: node infra/scripts/package-web.mjs --repo <clone/worktree> --commit <ref> --out <pasta> [--profile staging-min|staging|production]
//        [--expect-branch ft/integracao] [--vitrine] [--force]
// --vitrine (Security 23/11/2026): pacote de STAGING que liga a vitrine de demonstração do portal (fixtures MOCK rotuladas). Grava vitrine:true no
//   release.json, acrescenta PORTAL_VITRINE=1 às variáveis a definir e põe `-vitrine` no nome. RECUSA perfil production e qualquer APP_ENV ≠ staging.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, parseArgs, sha256File } from './lib/util.mjs';
import { typecheckReportProblem } from './lib/typecheck-report.mjs';

const args = parseArgs(process.argv.slice(2));
for (const k of ['repo', 'commit', 'out']) if (!args[k] || args[k] === true) fail(`use --${k}`, 2);
const repo = resolve(String(args.repo));
const profile = String(args.profile || 'staging-min');
const vitrine = Boolean(args.vitrine);
// --flags nome1,nome2 (ADR-022, DP-38): flags de produto ligadas por variável LN_FLAGS_ON, SÓ no staging (web e worker). Grava flagsLigadas no release.json e a variável nos
//   passos set_env; o guard-env (build e start) recusa LN_FLAGS_ON diferente do release.json. Produção nunca: lá a flag liga por commit revisado (FLAG_RELEASES).
// --prova-png (só o worker): registra no log do BUILD e do START, no Linux da Vertra, se o sharp gera PNG (infra/scripts/prova-png.mjs). Nunca falha o build nem o start (|| true);
//   o resultado fica no release log do deploy e no get_logs do worker. Prova temporária: tire a flag quando o Linux estiver provado.
const provaPng = Boolean(args['prova-png']);
if (provaPng && args.app !== 'workers') fail('--prova-png só vale para o worker (--app workers)', 2);
// --intelligence-alertas (só o worker, só staging, exige --flags intelligencePessoas): liga o job de alertas das watchlists (Backend 2, af07005) com LN_INTELLIGENCE_ALERTS=on e
//   LN_INTELLIGENCE_PESSOAS=on. Grava jobsIntelligence no release.json; o guard-env exige que as três variáveis LN_INTELLIGENCE_* batam com ele (a releitura REREAD nunca é ligada por pacote).
// --intelligence-releitura (mesmas regras): LN_INTELLIGENCE_REREAD=on + LN_INTELLIGENCE_PESSOAS=on; LN_REREAD_SEED e BRIGHTDATA_API_KEY (opcional) o PM grava pelo cofre, sem valor no pacote.
const jobsIntelligence = [...(args['intelligence-alertas'] ? ['alertas'] : []), ...(args['intelligence-releitura'] ? ['releitura'] : [])];
if (jobsIntelligence.length && args.app !== 'workers') fail('--intelligence-alertas/--intelligence-releitura só valem para o worker (--app workers)', 2);
const flagsLigadas = args.flags === undefined ? [] : [...new Set(String(args.flags === true ? '' : args.flags).split(',').map((s) => s.trim()).filter(Boolean))].sort();
if (args.flags !== undefined && flagsLigadas.length === 0) fail('--flags exige nomes de flag separados por vírgula (ex.: --flags intelligencePessoas)', 2);
for (const n of flagsLigadas) if (!/^[A-Za-z][A-Za-z0-9]*$/.test(n)) fail(`--flags: nome inválido "${n}" (só letras e números, como em FLAG_DEFAULTS)`, 2);
// --indexavel (DP-24): so o web de PRODUCAO, no go-live. Sem ele a producao e NAO indexavel (noindex, robots Disallow: /, sem sitemap).
const indexavel = Boolean(args.indexavel);
// --sem-typecheck-no-build --typecheck-report <relatorio.json> (opcao e do PM): o build da Vertra pula o typecheck do Next (RAM do ambiente de build); so com o relatorio de
// integracao com typecheck VERDE do MESMO commit. Sem o relatorio recusa; o pacote registra isso no release.json (semTypecheckNoBuild).
const semTypecheck = Boolean(args['sem-typecheck-no-build']);
// --build-leve: o next build roda com 1 worker (CIRCLE_NODE_TOTAL=2 pelo build-web); so web. Para o app de 512 MB (ambiente de build de 1024 MB).
const buildLeve = Boolean(args['build-leve']);
if (buildLeve && args.app === 'workers') fail('--build-leve so vale para o web (o worker nao usa o Next)', 2);
if (semTypecheck && (args.app === 'workers')) fail('--sem-typecheck-no-build so vale para o web (o worker nao usa o Next)', 2);
if (semTypecheck && (!args['typecheck-report'] || args['typecheck-report'] === true)) fail('--sem-typecheck-no-build exige --typecheck-report <relatorio de integracao.mjs --verify>', 2);
if (indexavel && (profile !== 'production' || args.app === 'workers')) fail('--indexavel so vale para o web do perfil production (staging nunca e indexavel)', 2);
if (indexavel && vitrine) fail('--indexavel nao combina com --vitrine', 2);
// --app web (padrão) | workers: o worker é um app Vertra separado (tipo Bot, sem porta), do mesmo commit; sem subdomínio, sem build-web/start-web
const appKey = args.app === undefined ? 'web' : String(args.app);
if (!['web', 'workers'].includes(appKey)) fail('--app deve ser web ou workers', 2);
if (vitrine && appKey !== 'web') fail('--vitrine só vale para o web', 2);
const SELF = dirname(fileURLToPath(import.meta.url));
// Vitrine só no staging (Security R2/R3): recusa ANTES de tocar no repositório.
if (jobsIntelligence.length && (profile === 'production' || /^prod/i.test(profile))) fail('--intelligence-alertas/--intelligence-releitura recusado: os jobs de Intelligence por variável só existem no staging (ADR-022)', 2);
if (jobsIntelligence.length && !flagsLigadas.includes('intelligencePessoas')) fail('--intelligence-alertas/--intelligence-releitura exige --flags intelligencePessoas (o job também confere a flag da ADR-022)', 2);
if (flagsLigadas.length && (profile === 'production' || /^prod/i.test(profile))) fail('--flags recusado: flags de produto por variável só existem no staging (ADR-022); em produção a flag liga por commit revisado em FLAG_RELEASES', 2);
if (vitrine && (profile === 'production' || /^prod/i.test(profile))) fail('--vitrine recusado: a vitrine de demonstração do portal só existe no staging (perfil production nunca leva PORTAL_VITRINE)', 2);

function git(a, { input } = {}) {
  const r = spawnSync('git', ['-C', repo, ...a], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, input });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${a[0]}: ${String(r.stderr).trim().slice(0, 300)}`);
  return r.stdout;
}
const gitText = (a) => git(a).toString('utf8').trim();

// 1. commit alvo
let sha;
try { sha = gitText(['rev-parse', '--verify', `${args.commit}^{commit}`]); } catch (e) { fail(`commit inválido: ${e.message}`); }
const sha12 = sha.slice(0, 12);
let typecheckRelatorio = null;
if (semTypecheck) {
  let rel;
  try { rel = JSON.parse(readFileSync(resolve(String(args['typecheck-report'])), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { fail(`--typecheck-report ilegivel: ${String(e.message).slice(0, 120)}`, 2); }
  const motivo = typecheckReportProblem(rel, sha);
  if (motivo) fail(`--sem-typecheck-no-build recusado: ${motivo}`, 2);
  typecheckRelatorio = basename(resolve(String(args['typecheck-report'])));
}
if (args['expect-branch']) {
  const ok = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', sha, String(args['expect-branch'])]).status === 0;
  if (!ok) fail(`o commit ${sha12} NÃO está contido em ${args['expect-branch']}: recusado`);
}

// 2. especificação do app (lida do próprio commit, não da pasta de trabalho)
let spec;
try { spec = JSON.parse(gitText(['show', `${sha}:infra/vertra/environments.json`])); } catch { fail('infra/vertra/environments.json ausente neste commit (integre ft/infra)'); }
const env = spec.ambientes?.[profile];
const web = env?.recursos?.[appKey];
if (!web) fail(`perfil "${profile}" sem recurso ${appKey} em environments.json`);
// `--subdomain` troca o subdomínio do pacote (a URL entra no build): usado quando o proprietário escolhe outro endereço no painel.
const sub = appKey === 'workers' ? null : (args.subdomain && args.subdomain !== true ? String(args.subdomain) : web.subdominio);
// NEXT_PUBLIC_SITE_URL é lida no BUILD (o portal embute no sitemap e no canonical; padrão localhost). A Vertra constrói na criação, antes de
// qualquer variável, e mudar variável depois não reconstrói: por isso a URL do ambiente entra no próprio build_command.
const siteUrl = sub ? `https://${sub}.vertraweb.app` : null;
// O portal também decide noindex NO BUILD (meta robots das páginas estáticas): o build precisa ver APP_ENV, não só o runtime.
const appEnvBuild = web.env?.APP_ENV ?? (profile === 'production' ? 'production' : 'staging');
// O build_command NÃO usa atribuição inline (na Vertra a URL não chegou ao next build): build-web.mjs lê siteUrl/appEnv do release.json,
// põe no ambiente do processo filho, verifica o HTML da home e falha se o canonical não for a URL do ambiente.
if (flagsLigadas.length && String(appEnvBuild).toLowerCase() !== 'staging') fail(`--flags recusado: APP_ENV do perfil é "${appEnvBuild}"; flags por variável só com APP_ENV=staging`, 2);
if (vitrine && String(appEnvBuild).toLowerCase() !== 'staging') fail(`--vitrine recusado: APP_ENV do perfil é "${appEnvBuild}"; a vitrine só vale com APP_ENV=staging`, 2);
if (vitrine && !siteUrl) fail('--vitrine exige --subdomain (o build_command com build-web.mjs/release.json é o que liga e confere a vitrine)', 2);
const buildBase = siteUrl ? 'node infra/scripts/guard-env.mjs && node infra/scripts/build-web.mjs' : web.build_command;
const buildCmd = provaPng ? `${buildBase} && (node infra/scripts/prova-png.mjs --etapa build || true)` : buildBase;
// O start_command também falha fechado: start-web.mjs confere APP_COMMIT (40 hex = release.json), NEXT_PUBLIC_SITE_URL e APP_ENV em EXECUÇÃO e só então inicia o Next.
const startBase = siteUrl ? 'node infra/scripts/guard-env.mjs && node infra/scripts/start-web.mjs' : web.start_command;
if (provaPng && !String(startBase).includes('node apps/workers/dist/index.js')) fail('--prova-png: o start do worker mudou; ajuste o package-web', 2);
const startCmd = provaPng ? String(startBase).replace('node apps/workers/dist/index.js', '(node infra/scripts/prova-png.mjs --etapa start || true) && node apps/workers/dist/index.js') : startBase;

// 3. o que entra no pacote (o mínimo para instalar, compilar e iniciar o apps/web)
const INCLUDE = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'apps', 'packages',
  'infra/scripts/guard-env.mjs', 'infra/scripts/build-web.mjs', 'infra/scripts/start-web.mjs', 'infra/scripts/lib/guards.mjs', 'infra/scripts/lib/util.mjs', 'infra/scripts/lib/typecheck-report.mjs'];
// a sessão simulada do Studio só existe em teste; a rota de login de e2e (app/api/e2e) vem no código do Studio desde a int/003: em produção responde 404 e exige
// LN_STUDIO_TEST_SESSION=1 (que o guard proíbe), mas não há motivo para ela existir num app implantado, então fica fora do pacote
// --prova-png: o comando de build/start chama infra/scripts/prova-png.mjs, que precisa estar no pacote (ele só importa lib/util.mjs, que já entra)
if (provaPng) INCLUDE.push('infra/scripts/prova-png.mjs');
const EXCLUDE = [':(exclude)apps/web/e2e', ':(exclude)apps/web/playwright.config.ts', ':(exclude)apps/web/app/api/e2e'];
const pathspec = [...INCLUDE, ...EXCLUDE];
const missing = INCLUDE.filter((p) => !gitText(['ls-tree', '--name-only', sha, '--', p]));
if (missing.length) fail(`faltam no commit: ${missing.join(', ')}`);

// 4. arquivos virtuais (iguais na pasta e no ZIP)
const releaseJson = JSON.stringify({ commit: sha, perfil: profile, app: web.nome, siteUrl, appEnv: appEnvBuild, vitrine, indexavel, flagsLigadas, jobsIntelligence, provaPng, semTypecheckNoBuild: semTypecheck, typecheckRelatorio, buildLeve, tipo: appKey, node: spec.runtime?.node, origem: 'git archive de commit local (sem GitHub)', nota: 'APP_COMMIT deve ser definido com este commit' }, null, 2) + '\n';
const cfgLines = [`NAME=${web.nome}`, `MAIN=package.json`, `BUILD=${buildCmd}`, `START=${startCmd}`, `VERSION=${spec.runtime?.node}`, `MEMORY=${web.ram_mb}`, `LANGUAGE=${spec.runtime?.linguagem || 'typescript'}`];
if (sub) cfgLines.push(`SUBDOMAIN=${sub}`);
const virtuals = { 'release.json': releaseJson, 'vertracloud.config': cfgLines.join('\n') + '\n' };
const vArgs = Object.entries(virtuals).map(([p, c]) => `--add-virtual-file=${p}:${c}`);

// 5. destino (nunca sobrescreve sem --force)
const out = resolve(String(args.out));
const name = `ln-${appKey === 'workers' ? 'workers' : 'web'}-${profile}-${sha12}${appKey === 'web' && args.subdomain && args.subdomain !== true ? `-${sub}` : ''}${vitrine ? '-vitrine' : ''}${flagsLigadas.length ? '-flags' : ''}${jobsIntelligence.length ? `-${jobsIntelligence.join('-')}` : ''}${provaPng ? '-prova-png' : ''}`;
const folder = join(out, name);
const zip = join(out, `${name}.zip`);
const manifestPath = join(out, `${name}.manifest.json`);
mkdirSync(out, { recursive: true });
if ((existsSync(folder) || existsSync(zip)) && !args.force) fail(`já existe ${name} em ${out} (use --force para refazer)`);
rmSync(folder, { recursive: true, force: true }); rmSync(zip, { force: true });

const tmp = mkdtempSync(join(tmpdir(), 'ln-pack-'));
try {
  git(['archive', '--format=zip', ...vArgs, '-o', zip, sha, '--', ...pathspec]);
  const tarFile = join(tmp, 'p.tar');
  git(['archive', '--format=tar', '-o', tarFile, sha, '--', ...pathspec]);
  mkdirSync(folder, { recursive: true });
  const t = spawnSync('tar', ['-xf', tarFile, '-C', folder], { encoding: 'utf8' });
  if (t.error || t.status !== 0) fail('tar indisponível ou falhou ao extrair (Windows 10+, Linux e macOS trazem tar)');
  for (const [p, c] of Object.entries(virtuals)) writeFileSync(join(folder, p), c);

  // 6. verificações do pacote
  const files = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p); else files.push(relative(folder, p).split(sep).join('/'));
    }
  })(folder);
  if (provaPng && !files.includes('infra/scripts/prova-png.mjs')) fail('--prova-png: infra/scripts/prova-png.mjs não entrou no pacote (o build e o start do worker o chamam)');
  const bad = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) || /\.(pem|key|crt|p12)$/i.test(f) || /(^|\/)(node_modules|\.next|\.git)\//.test(f) || /playwright\.config\./.test(f) || /(^|\/)e2e\//.test(f));
  if (bad.length) fail(`arquivos proibidos no pacote: ${bad.slice(0, 5).join(', ')}`);
  const l = spawnSync('tar', ['-tf', zip], { encoding: 'utf8' });
  const zipEntries = String(l.stdout).split(/\r?\n/).filter((x) => x && !x.endsWith('/'));
  if (zipEntries.length !== files.length) fail(`pasta (${files.length} arquivos) e ZIP (${zipEntries.length}) divergem`);
  const ck = spawnSync(process.execPath, [join(SELF, 'ci-checks.mjs'), '--root', folder, '--deploy', ...(profile === 'production' ? ['--producao'] : [])], { encoding: 'utf8' });
  if (ck.status !== 0) fail(`ci-checks reprovou o pacote:\n${ck.stderr}`);
  const bytes = statSync(zip).size;
  if (bytes > 100 * 1024 * 1024) fail(`ZIP de ${(bytes / 1048576).toFixed(1)} MB passa do limite de 100 MB da Vertra`);

  const zipSha = await sha256File(zip);
  const commitDate = gitText(['show', '-s', '--format=%cI', sha]);
  const envToSet = [
    { nome: 'APP_ENV', valor: web.env?.APP_ENV ?? (profile === 'production' ? 'production' : 'staging') },
    { nome: 'NODE_ENV', valor: web.env?.NODE_ENV ?? 'production' },
    { nome: 'APP_COMMIT', valor: sha },
    ...(web.env?.APP_MODE ? [{ nome: 'APP_MODE', valor: web.env.APP_MODE }] : []),
    // Staging completo e produção (web): o portal lê dados reais pela API (indexing.ts); sem esta variável a fonte é VAZIA mesmo com banco.
    ...(appKey === 'web' && profile !== 'staging-min' ? [{ nome: 'PORTAL_SOURCE', valor: 'api' }] : []),
    // Obrigatória em EXECUÇÃO também: páginas dinâmicas e a revalidação da home leem a variável no servidor (experimento 22/11/2026: sem ela, localhost).
    ...(appKey === 'web' ? [
      { nome: 'NEXT_PUBLIC_SITE_URL', valor: siteUrl ?? '(definir)' },
      { nome: 'APP_URL', valor: siteUrl ?? '(definir)' },
      { nome: 'BETTER_AUTH_URL', valor: siteUrl ?? '(definir)' },
    ] : []),
    // Vitrine: também em EXECUÇÃO (start-web.mjs compara com release.json.vitrine e recusa se divergir). Sem vitrine, a variável NÃO deve existir.
    ...(vitrine ? [{ nome: 'PORTAL_VITRINE', valor: '1' }] : []),
    // Producao indexavel (go-live): tambem em EXECUCAO; start-web compara com release.json.indexavel. Sem --indexavel a variavel NAO deve existir.
    ...(indexavel ? [{ nome: 'PORTAL_INDEXAVEL', valor: '1' }] : []),
    // ADR-022: flags de produto ligadas por variável (só staging); também em EXECUÇÃO o guard-env compara com release.json.flagsLigadas. Sem --flags a variável NÃO deve existir.
    ...(flagsLigadas.length ? [{ nome: 'LN_FLAGS_ON', valor: flagsLigadas.join(',') }] : []),
    // Worker com o job de alertas das watchlists (só staging; o guard-env confere com release.json.jobsIntelligence). Sem --intelligence-alertas estas variáveis NÃO devem existir.
    ...(jobsIntelligence.length ? [{ nome: 'LN_INTELLIGENCE_PESSOAS', valor: 'on' }] : []),
    ...(jobsIntelligence.includes('alertas') ? [{ nome: 'LN_INTELLIGENCE_ALERTS', valor: 'on' }] : []),
    ...(jobsIntelligence.includes('releitura') ? [{ nome: 'LN_INTELLIGENCE_REREAD', valor: 'on' }] : []),
  ];
  const manifest = {
    schema: 1, perfil: profile, app: web.nome, tipo: appKey, siteUrl, vitrine, indexavel, flagsLigadas, jobsIntelligence, provaPng, semTypecheckNoBuild: semTypecheck, typecheckRelatorio, buildLeve, commit: sha, commitDate, pasta: folder, zip, zipSha256: zipSha, zipBytes: bytes, arquivos: files.length,
    ferramentas: { create_app: { name: web.nome, path: folder, main: 'package.json', memory: web.ram_mb, build: buildCmd, start: startCmd, subdomain: sub, version: spec.runtime?.node } },
    depois_do_create: { update_app_config: { health_check_path: web.health_check_path, zero_downtime: web.deploy?.zero_downtime, auto_rollback: web.deploy?.auto_rollback }, set_env: envToSet, restart: true },
    segredos_pelo_cofre_nunca_em_arquivo: [
      { nome: 'BETTER_AUTH_SECRET', quando: 'staging COM banco (ft/backend); aleatório, ao menos 32 caracteres, distinto por ambiente; o proprietário define pelo painel para não passar pelo chat' },
      ...(jobsIntelligence.includes('releitura') ? [{ nome: 'LN_REREAD_SEED', quando: 'releitura do Intelligence: conjunto de cargos a reler (valor do PM, não secreto, mas definido por ele)' }, { nome: 'BRIGHTDATA_API_KEY', quando: 'opcional, reserva por provedor (leitorViaProvedor); do cofre, só staging' }] : []),
      { nome: 'DATABASE_URL', quando: 'quando existir o banco do ambiente (host e nome devem coincidir com infra/vertra/bindings.json)' },
      { nome: 'DB_SSL_CA_PEM / DB_SSL_CERT_PEM / DB_SSL_KEY_PEM', quando: 'com o banco' },
    ],
    medir_apos_o_deploy: [
      { nome: 'TRUSTED_PROXY_HOPS', como: 'contar as entradas de X-Forwarded-For que o app recebe de uma requisição de teste com UMA entrada falsa injetada (TEST-NET 203.0.113.9); hops = total de entradas menos 1; exige o diagnóstico DIAG_XFF=1 do Backend (só contagem, nunca IPs); sem medição o limite por IP fica inativo e vale só o limite por conta (padrão seguro)' },
    ],
    sondas: appKey === 'workers'
      ? ['get_logs do app: [workers] no ar; filas com handler: N (sem porta nem health check HTTP)']
      : vitrine
        ? ['node infra/scripts/healthcheck.mjs --url <URL> --expect-commit <commit> --denied /studio --vitrine / --noindex / --canonical <URL>']
        : ['node infra/scripts/healthcheck.mjs --url <URL> --expect-commit <commit> --denied /studio --no-mock / --ready'],
    garantias: [...(vitrine ? ['VITRINE (staging): release.json.vitrine=true; o build liga a vitrine a partir do release.json (não do painel) e falha se a home sair sem a faixa de demonstração; o start recusa se PORTAL_VITRINE em execução ≠ release.vitrine; production + PORTAL_VITRINE reprova no guard-env (build e start); Security R1–R3'] : ['SEM vitrine: release.vitrine=false; o build ignora PORTAL_VITRINE do painel e falha se a home tiver marcador de demonstração; o start recusa se PORTAL_VITRINE existir']), 'build_command = guard-env + build-web.mjs: APP_ENV e NEXT_PUBLIC_SITE_URL vêm do release.json e entram no ambiente do build (sem atribuição inline); o build falha se o canonical da home não for a URL do ambiente', 'start_command = guard-env + start-web.mjs: o app NÃO sobe se APP_COMMIT não for o SHA de 40 hex do release.json, se NEXT_PUBLIC_SITE_URL faltar/divergir ou se APP_ENV divergir (com zero downtime e rollback automático a versão anterior deve continuar no ar; comportamento na Vertra ainda não testado)', 'pacote vem do commit (git archive), sem arquivos não commitados', 'sem .env*, chaves, node_modules, .next, e2e (inclui a rota app/api/e2e) nem playwright.config', 'ci-checks --deploy aprovado sobre o conteúdo', 'ZIP reprodutível (mesmo commit = mesmo SHA-256)'],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, commit: sha12, perfil: profile, pasta: folder, zip, zipSha256: zipSha, zipBytes: bytes, arquivos: files.length, manifesto: manifestPath }, null, 2));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
