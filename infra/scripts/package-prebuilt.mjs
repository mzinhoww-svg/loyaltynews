#!/usr/bin/env node
// Transforma um pacote do web (gerado por package-web.mjs) em pacote PRÉ-CONSTRUÍDO (opção B, 24/11/2026): o build_command fica VAZIO (a Vertra só instala as dependencies e sobe) e o
// pacote leva o `.next` construído num Linux, em prebuilt/web-next (o painel remove `.next` dos ZIPs; ver lib/prebuilt.mjs). Não escreve na Vertra nem no GitHub.
// O `.next` TEM de vir de um build Linux do MESMO commit, com as MESMAS variáveis de build (APP_ENV, NEXT_PUBLIC_SITE_URL, vitrine, indexação, flags) do pacote: por exemplo, o que a própria
// Vertra construiu num app (snapshot/download_app) ou um runner Linux construindo em /app. Um .next feito no Windows é RECUSADO aqui (caminhos absolutos do host: não roda na Vertra).
// Uso: node infra/scripts/package-prebuilt.mjs --pacote <pasta do package-web> --next <pasta .next de origem> --out <pasta> --origem "<de onde veio o .next>" [--force] [--sem-zip] [--tar]
// Sobrepõe no pacote (e registra o SHA-256) infra/scripts/start-web.mjs e infra/scripts/lib/prebuilt.mjs DESTA árvore: são o que restaura o .next na subida.
// Worker (QA 10): node infra/scripts/package-prebuilt.mjs --tipo workers --pacote <pasta do package-web --app workers> --dist <apps/workers/dist> --out <pasta> --origem "<de onde veio o dist>" [--force]
//   põe o dist em apps/workers/dist, zera o BUILD= do vertracloud.config (a Vertra não recompila), gera o ZIP final e reescreve o manifesto com o sha256/bytes/lista DESSE ZIP.
import { spawnSync } from 'node:child_process';
import { TAR } from './lib/tar.mjs';
import { arquivosDoZip } from './lib/zip.mjs';
import { ambienteDoPacote } from './lib/ambiente-pacote.mjs';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, parseArgs, sha256File } from './lib/util.mjs';
import { PREBUILT_DIR, PREBUILT_MANIFEST, PREBUILT_TAR, arquivosFaltando, listarExternos } from './lib/prebuilt.mjs';

const SELF = dirname(fileURLToPath(import.meta.url));
const EXCLUIR = new Set(['cache', 'node_modules', 'trace', 'trace-build', 'diagnostics']);
const OVERLAY = ['start-web.mjs', join('lib', 'prebuilt.mjs'), join('lib', 'tar.mjs')]; // tar.mjs: o lib/prebuilt.mjs importa ./tar.mjs (sem ele o start-web morre com ERR_MODULE_NOT_FOUND)

/** Caminhos do host de build dentro do .next que provam que ele não é portável (Windows ou pasta de usuário). Função pura. */
export function caminhosNaoPortaveis(texto) {
  const achados = new Set();
  const t = String(texto);
  // Caminho do host: letra de unidade seguida de \\ ou de UMA / (nunca "://", que é esquema de URL).
  for (const m of t.matchAll(/(?<![A-Za-z])[A-Za-z]:\\[^"'\s<>|]{3,60}/g)) achados.add(m[0].slice(0, 70));
  for (const m of t.matchAll(/(?<![A-Za-z])[A-Za-z]:\/(?!\/)[^"'\s<>|]{3,60}/g)) achados.add(m[0].slice(0, 70));
  for (const m of t.matchAll(/\/(?:Users|home|mnt\/[a-z])\/[^"'\s<>|]{3,60}/g)) achados.add(m[0].slice(0, 70));
  return [...achados];
}

/**
 * Origem do site dentro do .next: só isso é conferido aqui. URL de terceiro (GTM, GA, fontes) é ignorada.
 * Reprovam: origem local do build (localhost/127.0.0.1) e chave que carrega a URL do site com host diferente do siteUrl.
 */
export function origemDoSiteProblemas(texto, siteUrl) {
  const p = [];
  const t = String(texto);
  let host = null;
  try { host = new URL(String(siteUrl)).host; } catch { /* siteUrl inválida: não há o que comparar */ }
  const locais = [...t.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?=[/"'\s<>|]|$)/gi)].map((m) => m[0]);
  if (locais.length) p.push(`origem local do build no .next (${locais[0]}): o site tem de ser ${siteUrl}`);
  const chaves = [...t.matchAll(/"(?:appUrl|siteUrl|canonical|baseUrl|origin)"\s*:\s*"([^"]+)"/gi)].map((m) => m[1]);
  for (const v of chaves) {
    try {
      const u = new URL(v);
      if (host && u.host !== host) p.push(`origem do site no .next (${u.host}) difere do siteUrl (${host})`);
    } catch { /* valor não é URL absoluta: não é origem */ }
  }
  return [...new Set(p)];
}

/**
 * Build nulo na Vertra: toda linha `BUILD=<comando>` do vertracloud.config vira `BUILD=` (vazio); o resto fica igual. Função pura.
 * É a mesma regra para o web e para o worker: com o comando de build no config, a Vertra recompila no upload e o artefato testado se perde.
 */
export function zerarBuild(texto) {
  return String(texto).split(/\r?\n/).map((l) => (l.startsWith('BUILD=') ? 'BUILD=' : l)).join('\n');
}

/** Pura: verdadeiro só se o config tem exatamente uma linha `BUILD=` e ela está vazia. */
export function buildVazio(texto) {
  const linhas = String(texto).split(/\r?\n/).filter((l) => l.startsWith('BUILD='));
  return linhas.length === 1 && linhas[0] === 'BUILD=';
}

function listar(dir, fora = new Set()) {
  const out = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      if (d === dir && fora.has(n)) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p); else out.push(p);
    }
  })(dir);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.tipo === 'workers') return mainWorkers(args);
  if (args.tipo !== undefined && args.tipo !== 'web') fail('--tipo deve ser web (padrão) ou workers', 2);
  for (const k of ['pacote', 'next', 'out', 'origem']) if (!args[k] || args[k] === true) fail(`use --${k}`, 2);
  const pacote = resolve(String(args.pacote));
  const nextSrc = resolve(String(args.next));
  const out = resolve(String(args.out));
  if (!existsSync(join(pacote, 'release.json'))) fail('--pacote não tem release.json (use a pasta gerada por package-web.mjs)', 2);
  const release = JSON.parse(readFileSync(join(pacote, 'release.json'), 'utf8'));
  if (release.tipo !== 'web') fail(`só o pacote do web pode ser pré-construído (release.tipo=${release.tipo})`, 2);
  if (existsSync(join(pacote, PREBUILT_MANIFEST))) fail('o pacote já é pré-construído', 2);
  const manifestOrigem = join(dirname(pacote), `${basename(pacote)}.manifest.json`);
  if (!existsSync(manifestOrigem)) fail(`manifesto ${basename(manifestOrigem)} não está ao lado da pasta do pacote`, 2);

  // .next de origem: BUILD_ID, sem caminho de host Windows/usuário, sem pasta de cache
  if (!existsSync(join(nextSrc, 'BUILD_ID'))) fail('--next não parece um .next (sem BUILD_ID)', 2);
  const buildId = readFileSync(join(nextSrc, 'BUILD_ID'), 'utf8').trim();
  // Identidade do .next: a marca gravada pelo build-web.mjs amarra o build ao commit/ambiente do pacote.
  // Sem marca, ou com commit/ambiente/URL/BUILD_ID divergente, o pacote NÃO é montado (seria o verde falso do bloqueio A).
  const marcaBuild = join(nextSrc, '.ln-build.json');
  if (!existsSync(marcaBuild)) fail('.next sem .ln-build.json: não há prova de qual commit/ambiente gerou este build; gere com build-web.mjs do commit do pacote', 2);
  let marca;
  try { marca = JSON.parse(readFileSync(marcaBuild, 'utf8').replace(/^\uFEFF/, '')); } catch { fail('.next/.ln-build.json ilegível', 2); }
  if (String(marca.buildId ?? '') !== buildId) fail(`.next: BUILD_ID (${buildId}) difere da marca do build (${marca.buildId ?? '(vazio)'})`, 2);
  if (String(marca.commit ?? '') !== String(release.commit)) fail(`.next de outro commit: a marca diz ${String(marca.commit ?? '(vazio)').slice(0, 12)} e o pacote é do ${String(release.commit).slice(0, 12)}; gere o .next do commit do pacote`, 2);
  const semBarra = (u) => String(u ?? '').trim().replace(/\/+$/, '');
  if (semBarra(marca.siteUrl) !== semBarra(release.siteUrl)) fail(`.next de outra URL: a marca diz ${marca.siteUrl ?? '(vazio)'} e o pacote é de ${release.siteUrl}`, 2);
  if (String(marca.appEnv ?? '') !== String(release.appEnv ?? '')) fail(`.next de outro ambiente: a marca diz ${marca.appEnv ?? '(vazio)'} e o pacote é ${release.appEnv}`, 2);
  for (const f of ['required-server-files.json', 'routes-manifest.json', 'build-manifest.json']) {
    if (!existsSync(join(nextSrc, f))) fail(`.next sem ${f}`, 2);
    const txt = readFileSync(join(nextSrc, f), 'utf8');
    const ruins = caminhosNaoPortaveis(txt);
    if (ruins.length) fail(`.next/${f} tem caminho(s) do host de build (${ruins.slice(0, 3).join(' | ')}): construído fora de um Linux em /app, não roda na Vertra`, 2);
    const origem = origemDoSiteProblemas(txt, release.siteUrl);
    if (origem.length) fail(`.next/${f}: ${origem.slice(0, 3).join(' | ')}`, 2);
  }
  // completude pelos manifestos do próprio Next (rotas do App Router incluídas): um download que perdeu pastas NÃO vira pacote
  const faltam = arquivosFaltando(nextSrc);
  if (faltam.length) fail(`.next INCOMPLETO: faltam ${faltam.length} arquivo(s) que os manifestos do Next citam (${faltam.slice(0, 8).join(' | ')}${faltam.length > 8 ? ' | …' : ''}). Repita o download com --retomar (confira erros no relatório) e refaça o pacote`, 2);
  let nextVersion = null;
  try { nextVersion = JSON.parse(readFileSync(join(pacote, 'package-lock.json'), 'utf8')).packages?.['node_modules/next']?.version ?? null; } catch { /* sem lock */ }
  const externos = listarExternos(nextSrc);

  const tar = Boolean(args.tar); // reserva: .next num único web-next.tar (menos entradas no upload)
  const nome = `${basename(pacote)}-prebuilt${tar ? '-tar' : ''}`;
  const folder = join(out, nome);
  const zip = join(out, `${nome}.zip`);
  const manifestPath = join(out, `${nome}.manifest.json`);
  mkdirSync(out, { recursive: true });
  if ((existsSync(folder) || existsSync(zip)) && !args.force) fail(`já existe ${nome} em ${out} (use --force)`, 2);
  rmSync(folder, { recursive: true, force: true }); rmSync(zip, { force: true });

  cpSync(pacote, folder, { recursive: true });
  const overlays = {};
  for (const o of OVERLAY) {
    cpSync(join(SELF, o), join(folder, 'infra', 'scripts', o));
    overlays[`infra/scripts/${o.split(sep).join('/')}`] = await sha256File(join(folder, 'infra', 'scripts', o));
  }
  const destNext = join(folder, PREBUILT_DIR);
  mkdirSync(destNext, { recursive: true });
  for (const f of listar(nextSrc, EXCLUIR)) {
    const rel = relative(nextSrc, f);
    mkdirSync(dirname(join(destNext, rel)), { recursive: true });
    cpSync(f, join(destNext, rel));
  }
  const pb = {
    schema: 1, commit: release.commit, appEnv: release.appEnv, siteUrl: release.siteUrl, vitrine: Boolean(release.vitrine), indexavel: Boolean(release.indexavel),
    gaId: release.gaId ?? null, flagsLigadas: release.flagsLigadas ?? [], formato: tar ? 'tar' : 'pasta', buildId, nextVersion, externos, origem: String(args.origem), geradoEm: new Date().toISOString(),
  };
  writeFileSync(join(folder, PREBUILT_MANIFEST), JSON.stringify(pb, null, 2) + '\n');
  writeFileSync(join(folder, 'release.json'), JSON.stringify({ ...release, prebuilt: true, buildCommandVazio: true }));
  const cfgPath = join(folder, 'vertracloud.config');
  writeFileSync(cfgPath, zerarBuild(readFileSync(cfgPath, 'utf8')));

  // verificações: nada de .next/node_modules no caminho (o painel os remove), ci-checks do pacote, ZIP íntegro e dentro do limite
  let files = listar(folder).map((f) => relative(folder, f).split(sep).join('/'));
  // pastas que o painel e o deploy_app removem do upload (get_docs: node_modules, .local, venv, .venv, __pycache__, .next, vendor, .bundle, target, .gradle, .npm) não podem aparecer no caminho
  const ruins = files.filter((f) => /(^|\/)(\.next|node_modules|vendor|target|venv|\.venv|__pycache__|\.bundle|\.gradle|\.local|\.npm)\//.test(f) || /(^|\/)\.env(\.|$)/.test(f) || /\.(pem|key|crt|p12)$/i.test(f));
  if (ruins.length) fail(`arquivos proibidos no pacote: ${ruins.slice(0, 5).join(', ')}`);
  // ambiente SANEADO + o declarado do pacote (infra/vertra/environments.json do próprio pacote): o CI=true do runner não é variável do app (lib/ambiente-pacote.mjs)
  let declarado = {};
  try { declarado = JSON.parse(readFileSync(join(folder, 'infra/vertra/environments.json'), 'utf8').replace(/^\uFEFF/, '')).ambientes?.[release.perfil]?.recursos?.web?.env ?? {}; } catch { /* sem environments.json: só o APP_ENV do release */ }
  const ckEnv = ambienteDoPacote({ declarado, appEnv: release.appEnv });
  const ck = spawnSync(process.execPath, [join(SELF, 'ci-checks.mjs'), '--root', folder, '--deploy', ...(release.perfil === 'production' ? ['--producao'] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: ckEnv });
  if (ck.status !== 0) fail(`ci-checks reprovou o pacote pré-construído:\n${ck.stderr || ck.stdout}`);
  // --tar: DEPOIS da varredura de segredos (que lê os arquivos soltos), o .next vira um único web-next.tar e a pasta solta sai do pacote
  if (tar) {
    const arq = join(folder, PREBUILT_TAR);
    const t = spawnSync(TAR, ['-cf', arq, '-C', destNext, '.'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (t.error || t.status !== 0) fail(`tar falhou ao criar web-next.tar: ${t.stderr || t.error}`);
    rmSync(destNext, { recursive: true, force: true });
    files = listar(folder).map((f) => relative(folder, f).split(sep).join('/'));
  }
  // --sem-zip (runner Ubuntu do GitHub Actions: o tar GNU não cria ZIP; o deploy_app envia a PASTA): só confere o tamanho total contra o limite de 100 MB do upload
  let bytes = 0;
  if (args['sem-zip']) {
    for (const f of files) bytes += statSync(join(folder, f)).size;
    if (bytes > 100 * 1024 * 1024) fail(`pasta de ${(bytes / 1048576).toFixed(1)} MB (descomprimida) passa do limite de 100 MB do upload; confira o ZIP real antes de enviar`);
  } else {
    const z = spawnSync(TAR, ['-a', '-c', '-f', zip, '-C', folder, '.'], { encoding: 'utf8' });
    if (z.error || z.status !== 0) fail(`tar falhou ao criar o ZIP (o tar GNU do Linux não escreve ZIP: use --sem-zip e envie a PASTA, ou rode no Windows/macOS com bsdtar): ${z.stderr || z.error}`);
    let entradas;
    try { entradas = arquivosDoZip(zip); } catch (e) { fail(`não consegui ler o índice do ZIP: ${e.message}`); }
    if (entradas.length !== files.length) fail(`pasta (${files.length}) e ZIP (${entradas.length}) divergem`);
    bytes = statSync(zip).size;
    if (bytes > 100 * 1024 * 1024) fail(`ZIP de ${(bytes / 1048576).toFixed(1)} MB passa do limite de 100 MB da Vertra`);
  }

  const man = JSON.parse(readFileSync(manifestOrigem, 'utf8').replace(/^\uFEFF/, ''));
  const novo = { ...man, pasta: folder, zip: args['sem-zip'] ? null : zip, zipSha256: args['sem-zip'] ? null : await sha256File(zip), zipBytes: args['sem-zip'] ? null : bytes, bytesDescomprimidos: args['sem-zip'] ? bytes : null, arquivos: files.length, prebuilt: { ...pb, externos: externos.length, overlays, buildCommand: '(vazio)' } };
  writeFileSync(manifestPath, JSON.stringify(novo, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, pasta: folder, zip: novo.zip, zipSha256: novo.zipSha256, zipBytes: novo.zipBytes, bytesDescomprimidos: novo.bytesDescomprimidos, arquivos: files.length, commit: release.commit, buildId, externos, overlays, manifesto: manifestPath }, null, 2));
}

/** Pastas que o painel/deploy_app removem do upload e arquivos que nunca podem ir no pacote (mesma regra do web). */
const proibidos = (files) => files.filter((f) => /(^|\/)(\.next|node_modules|vendor|target|venv|\.venv|__pycache__|\.bundle|\.gradle|\.local|\.npm)\//.test(f) || /(^|\/)\.env(\.|$)/.test(f) || /\.(pem|key|crt|p12)$/i.test(f));

/** ZIP portátil: `zip` (runner Ubuntu e macOS) e, sem ele, o bsdtar (Windows/macOS). O tar GNU não escreve ZIP. */
function criarZip(folder, zip) {
  const temZip = spawnSync('zip', ['-v'], { encoding: 'utf8' });
  const r = !temZip.error && temZip.status === 0
    ? spawnSync('zip', ['-q', '-r', '-X', zip, '.'], { cwd: folder, encoding: 'utf8' })
    : spawnSync(TAR, ['-a', '-c', '-f', zip, '-C', folder, '.'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) fail(`não consegui criar o ZIP (instale \`zip\` ou use o bsdtar): ${r.stderr || r.error}`);
}

/** Pacote PRÉ-CONSTRUÍDO do worker: dist do mesmo commit + BUILD= vazio + manifesto do ZIP final. Não escreve na Vertra nem no GitHub. */
async function mainWorkers(args) {
  for (const k of ['pacote', 'dist', 'out', 'origem']) if (!args[k] || args[k] === true) fail(`use --${k}`, 2);
  const pacote = resolve(String(args.pacote));
  const distSrc = resolve(String(args.dist));
  const out = resolve(String(args.out));
  if (!existsSync(join(pacote, 'release.json'))) fail('--pacote não tem release.json (use a pasta gerada por package-web.mjs --app workers)', 2);
  const release = JSON.parse(readFileSync(join(pacote, 'release.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (release.tipo !== 'workers') fail(`--tipo workers exige o pacote do worker (release.tipo=${release.tipo})`, 2);
  if (release.prebuilt) fail('o pacote já é pré-construído', 2);
  if (!existsSync(join(pacote, 'vertracloud.config'))) fail('--pacote sem vertracloud.config', 2);
  const manifestOrigem = join(dirname(pacote), `${basename(pacote)}.manifest.json`);
  if (!existsSync(manifestOrigem)) fail(`manifesto ${basename(manifestOrigem)} não está ao lado da pasta do pacote`, 2);
  if (!existsSync(join(distSrc, 'index.js')) || statSync(join(distSrc, 'index.js')).size === 0) fail('--dist sem index.js (rode npm run build -w apps/workers do commit do pacote)', 2);

  const nome = `${basename(pacote)}-prebuilt`;
  const folder = join(out, nome);
  const zip = join(out, `${nome}.zip`);
  const manifestPath = join(out, `${nome}.manifest.json`);
  mkdirSync(out, { recursive: true });
  if ((existsSync(folder) || existsSync(zip)) && !args.force) fail(`já existe ${nome} em ${out} (use --force)`, 2);
  rmSync(folder, { recursive: true, force: true }); rmSync(zip, { force: true });

  cpSync(pacote, folder, { recursive: true });
  const destDist = join(folder, 'apps', 'workers', 'dist');
  rmSync(destDist, { recursive: true, force: true });
  cpSync(distSrc, destDist, { recursive: true });
  const distSha256 = await sha256File(join(destDist, 'index.js'));
  writeFileSync(join(folder, 'release.json'), JSON.stringify({ ...release, prebuilt: true, buildCommandVazio: true }, null, 2) + '\n');
  const cfgPath = join(folder, 'vertracloud.config');
  writeFileSync(cfgPath, zerarBuild(readFileSync(cfgPath, 'utf8')));
  if (!buildVazio(readFileSync(cfgPath, 'utf8'))) fail('vertracloud.config não ficou com exatamente uma linha BUILD= vazia');

  const files = listar(folder).map((f) => relative(folder, f).split(sep).join('/'));
  const ruins = proibidos(files);
  if (ruins.length) fail(`arquivos proibidos no pacote: ${ruins.slice(0, 5).join(', ')}`);
  criarZip(folder, zip);
  let entradas;
  try { entradas = arquivosDoZip(zip); } catch (e) { fail(`não consegui ler o índice do ZIP: ${e.message}`); }
  if (entradas.length !== files.length) fail(`pasta (${files.length}) e ZIP (${entradas.length}) divergem`);
  const bytes = statSync(zip).size;
  if (bytes > 100 * 1024 * 1024) fail(`ZIP de ${(bytes / 1048576).toFixed(1)} MB passa do limite de 100 MB da Vertra`);

  const man = JSON.parse(readFileSync(manifestOrigem, 'utf8').replace(/^\uFEFF/, ''));
  const novo = {
    ...man, pasta: folder, zip, zipSha256: await sha256File(zip), zipBytes: bytes, arquivos: entradas.length, zipFiles: entradas,
    buildCommand: '(vazio)', buildCommandVazio: true,
    prebuilt: { tipo: 'workers', commit: release.commit, appEnv: release.appEnv, distIndexSha256: distSha256, origem: String(args.origem), geradoEm: new Date().toISOString() },
  };
  writeFileSync(manifestPath, JSON.stringify(novo, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, tipo: 'workers', pasta: folder, zip, zipSha256: novo.zipSha256, zipBytes: bytes, arquivos: entradas.length, commit: release.commit, manifesto: manifestPath }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
