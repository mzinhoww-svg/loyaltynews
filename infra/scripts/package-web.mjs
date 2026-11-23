#!/usr/bin/env node
// Gera o pacote de deploy do apps/web SEM GitHub, a partir de um COMMIT LOCAL conhecido (git archive).
// O pacote vem do commit, não da pasta de trabalho: arquivos não commitados, node_modules, .next, .env* e testes e2e ficam de fora.
// Saída (em --out): pasta  ln-web-<perfil>-<sha12>/  (para as ferramentas create_app/deploy_app, que recebem uma PASTA)
//                   ZIP    ln-web-<perfil>-<sha12>.zip (para o painel da Vertra; mesmo conteúdo)
//                   manifesto .manifest.json (commit, SHA-256 do ZIP, comandos, variáveis a definir, passos)
// Reprodutível: o mesmo commit gera o mesmo ZIP, byte a byte (git archive usa a data do commit).
// Não escreve na Vertra nem no GitHub; só lê o repositório local e escreve em --out.
// Uso: node infra/scripts/package-web.mjs --repo <clone/worktree> --commit <ref> --out <pasta> [--profile staging-min|staging|production]
//        [--expect-branch ft/integracao] [--force]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, parseArgs, sha256File } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
for (const k of ['repo', 'commit', 'out']) if (!args[k] || args[k] === true) fail(`use --${k}`, 2);
const repo = resolve(String(args.repo));
const profile = String(args.profile || 'staging-min');
const SELF = dirname(fileURLToPath(import.meta.url));

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
if (args['expect-branch']) {
  const ok = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', sha, String(args['expect-branch'])]).status === 0;
  if (!ok) fail(`o commit ${sha12} NÃO está contido em ${args['expect-branch']}: recusado`);
}

// 2. especificação do app (lida do próprio commit, não da pasta de trabalho)
let spec;
try { spec = JSON.parse(gitText(['show', `${sha}:infra/vertra/environments.json`])); } catch { fail('infra/vertra/environments.json ausente neste commit (integre ft/infra)'); }
const env = spec.ambientes?.[profile];
const web = env?.recursos?.web;
if (!web) fail(`perfil "${profile}" sem recurso web em environments.json`);
// `--subdomain` troca o subdomínio do pacote (a URL entra no build): usado quando o proprietário escolhe outro endereço no painel.
const sub = args.subdomain && args.subdomain !== true ? String(args.subdomain) : web.subdominio;
// NEXT_PUBLIC_SITE_URL é lida no BUILD (o portal embute no sitemap e no canonical; padrão localhost). A Vertra constrói na criação, antes de
// qualquer variável, e mudar variável depois não reconstrói: por isso a URL do ambiente entra no próprio build_command.
const siteUrl = sub ? `https://${sub}.vertraweb.app` : null;
// O portal também decide noindex NO BUILD (meta robots das páginas estáticas): o build precisa ver APP_ENV, não só o runtime.
const appEnvBuild = web.env?.APP_ENV ?? (profile === 'production' ? 'production' : 'staging');
// O build_command NÃO usa atribuição inline (na Vertra a URL não chegou ao next build): build-web.mjs lê siteUrl/appEnv do release.json,
// põe no ambiente do processo filho, verifica o HTML da home e falha se o canonical não for a URL do ambiente.
const buildCmd = siteUrl ? 'node infra/scripts/guard-env.mjs && node infra/scripts/build-web.mjs' : web.build_command;

// 3. o que entra no pacote (o mínimo para instalar, compilar e iniciar o apps/web)
const INCLUDE = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.base.json', 'apps', 'packages',
  'infra/scripts/guard-env.mjs', 'infra/scripts/build-web.mjs', 'infra/scripts/lib/guards.mjs', 'infra/scripts/lib/util.mjs'];
const EXCLUDE = [':(exclude)apps/web/e2e', ':(exclude)apps/web/playwright.config.ts']; // a sessão simulada do Studio só existe em teste
const pathspec = [...INCLUDE, ...EXCLUDE];
const missing = INCLUDE.filter((p) => !gitText(['ls-tree', '--name-only', sha, '--', p]));
if (missing.length) fail(`faltam no commit: ${missing.join(', ')}`);

// 4. arquivos virtuais (iguais na pasta e no ZIP)
const releaseJson = JSON.stringify({ commit: sha, perfil: profile, app: web.nome, siteUrl, appEnv: appEnvBuild, node: spec.runtime?.node, origem: 'git archive de commit local (sem GitHub)', nota: 'APP_COMMIT deve ser definido com este commit' }, null, 2) + '\n';
const cfgLines = [`NAME=${web.nome}`, `MAIN=package.json`, `BUILD=${buildCmd}`, `START=${web.start_command}`, `VERSION=${spec.runtime?.node}`, `MEMORY=${web.ram_mb}`, `LANGUAGE=${spec.runtime?.linguagem || 'typescript'}`];
if (sub) cfgLines.push(`SUBDOMAIN=${sub}`);
const virtuals = { 'release.json': releaseJson, 'vertracloud.config': cfgLines.join('\n') + '\n' };
const vArgs = Object.entries(virtuals).map(([p, c]) => `--add-virtual-file=${p}:${c}`);

// 5. destino (nunca sobrescreve sem --force)
const out = resolve(String(args.out));
const name = `ln-web-${profile}-${sha12}${args.subdomain && args.subdomain !== true ? `-${sub}` : ''}`;
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
  const bad = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) || /\.(pem|key|crt|p12)$/i.test(f) || /(^|\/)(node_modules|\.next|\.git)\//.test(f) || /playwright\.config\./.test(f) || /(^|\/)e2e\//.test(f));
  if (bad.length) fail(`arquivos proibidos no pacote: ${bad.slice(0, 5).join(', ')}`);
  const l = spawnSync('tar', ['-tf', zip], { encoding: 'utf8' });
  const zipEntries = String(l.stdout).split(/\r?\n/).filter((x) => x && !x.endsWith('/'));
  if (zipEntries.length !== files.length) fail(`pasta (${files.length} arquivos) e ZIP (${zipEntries.length}) divergem`);
  const ck = spawnSync(process.execPath, [join(SELF, 'ci-checks.mjs'), '--root', folder, '--deploy'], { encoding: 'utf8' });
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
    { nome: 'APP_URL', valor: siteUrl ?? '(definir)' },
    { nome: 'BETTER_AUTH_URL', valor: siteUrl ?? '(definir)' },
  ];
  const manifest = {
    schema: 1, perfil: profile, app: web.nome, siteUrl, commit: sha, commitDate, pasta: folder, zip, zipSha256: zipSha, zipBytes: bytes, arquivos: files.length,
    ferramentas: { create_app: { name: web.nome, path: folder, main: 'package.json', memory: web.ram_mb, build: buildCmd, start: web.start_command, subdomain: sub, version: spec.runtime?.node } },
    depois_do_create: { update_app_config: { health_check_path: web.health_check_path, zero_downtime: web.deploy?.zero_downtime, auto_rollback: web.deploy?.auto_rollback }, set_env: envToSet, restart: true },
    segredos_pelo_cofre_nunca_em_arquivo: [
      { nome: 'BETTER_AUTH_SECRET', quando: 'staging COM banco (ft/backend); aleatório, ao menos 32 caracteres, distinto por ambiente; o proprietário define pelo painel para não passar pelo chat' },
      { nome: 'DATABASE_URL', quando: 'quando existir o banco do ambiente (host e nome devem coincidir com infra/vertra/bindings.json)' },
      { nome: 'DB_SSL_CA_PEM / DB_SSL_CERT_PEM / DB_SSL_KEY_PEM', quando: 'com o banco' },
    ],
    medir_apos_o_deploy: [
      { nome: 'TRUSTED_PROXY_HOPS', como: 'contar as entradas de X-Forwarded-For que o app recebe de uma requisição de teste com UMA entrada falsa injetada (TEST-NET 203.0.113.9); hops = total de entradas menos 1; exige o diagnóstico DIAG_XFF=1 do Backend (só contagem, nunca IPs); sem medição o limite por IP fica inativo e vale só o limite por conta (padrão seguro)' },
    ],
    sondas: ['node infra/scripts/healthcheck.mjs --url <URL> --expect-commit <commit> --denied /studio --no-mock /'],
    garantias: ['build_command = guard-env + build-web.mjs: APP_ENV e NEXT_PUBLIC_SITE_URL vêm do release.json e entram no ambiente do build (sem atribuição inline); o build falha se o canonical da home não for a URL do ambiente', 'pacote vem do commit (git archive), sem arquivos não commitados', 'sem .env*, chaves, node_modules, .next, e2e nem playwright.config', 'ci-checks --deploy aprovado sobre o conteúdo', 'ZIP reprodutível (mesmo commit = mesmo SHA-256)'],
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, commit: sha12, perfil: profile, pasta: folder, zip, zipSha256: zipSha, zipBytes: bytes, arquivos: files.length, manifesto: manifestPath }, null, 2));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
