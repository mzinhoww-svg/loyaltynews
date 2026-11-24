#!/usr/bin/env node
// Transforma um pacote do web (gerado por package-web.mjs) em pacote PRÉ-CONSTRUÍDO (opção B, 24/11/2026): o build_command fica VAZIO (a Vertra só instala as dependencies e sobe) e o
// pacote leva o `.next` construído num Linux, em prebuilt/web-next (o painel remove `.next` dos ZIPs; ver lib/prebuilt.mjs). Não escreve na Vertra nem no GitHub.
// O `.next` TEM de vir de um build Linux do MESMO commit, com as MESMAS variáveis de build (APP_ENV, NEXT_PUBLIC_SITE_URL, vitrine, indexação, flags) do pacote: por exemplo, o que a própria
// Vertra construiu num app (snapshot/download_app) ou um runner Linux construindo em /app. Um .next feito no Windows é RECUSADO aqui (caminhos absolutos do host: não roda na Vertra).
// Uso: node infra/scripts/package-prebuilt.mjs --pacote <pasta do package-web> --next <pasta .next de origem> --out <pasta> --origem "<de onde veio o .next>" [--force] [--sem-zip]
// Sobrepõe no pacote (e registra o SHA-256) infra/scripts/start-web.mjs e infra/scripts/lib/prebuilt.mjs DESTA árvore: são o que restaura o .next na subida.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, parseArgs, sha256File } from './lib/util.mjs';
import { PREBUILT_DIR, PREBUILT_MANIFEST, listarExternos } from './lib/prebuilt.mjs';

const SELF = dirname(fileURLToPath(import.meta.url));
const EXCLUIR = new Set(['cache', 'node_modules', 'trace', 'trace-build', 'diagnostics']);
const OVERLAY = ['start-web.mjs', join('lib', 'prebuilt.mjs')];

/** Caminhos do host de build dentro do .next que provam que ele não é portável (Windows ou pasta de usuário). Função pura. */
export function caminhosNaoPortaveis(texto) {
  const achados = new Set();
  for (const m of String(texto).matchAll(/[A-Za-z]:[\\/]{1,4}[^"'\s<>|]{3,60}|\/(?:Users|home|mnt\/[a-z])\/[^"'\s<>|]{3,60}/g)) achados.add(m[0].slice(0, 70));
  return [...achados];
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
  for (const f of ['required-server-files.json', 'routes-manifest.json', 'build-manifest.json']) {
    if (!existsSync(join(nextSrc, f))) fail(`.next sem ${f}`, 2);
    const ruins = caminhosNaoPortaveis(readFileSync(join(nextSrc, f), 'utf8'));
    if (ruins.length) fail(`.next/${f} tem caminho(s) do host de build (${ruins.slice(0, 3).join(' | ')}): construído fora de um Linux em /app, não roda na Vertra`, 2);
  }
  let nextVersion = null;
  try { nextVersion = JSON.parse(readFileSync(join(pacote, 'package-lock.json'), 'utf8')).packages?.['node_modules/next']?.version ?? null; } catch { /* sem lock */ }
  const externos = listarExternos(nextSrc);

  const nome = `${basename(pacote)}-prebuilt`;
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
    flagsLigadas: release.flagsLigadas ?? [], buildId, nextVersion, externos, origem: String(args.origem), geradoEm: new Date().toISOString(),
  };
  writeFileSync(join(folder, PREBUILT_MANIFEST), JSON.stringify(pb, null, 2) + '\n');
  writeFileSync(join(folder, 'release.json'), JSON.stringify({ ...release, prebuilt: true, buildCommandVazio: true }));
  const cfgPath = join(folder, 'vertracloud.config');
  writeFileSync(cfgPath, readFileSync(cfgPath, 'utf8').split(/\r?\n/).map((l) => (l.startsWith('BUILD=') ? 'BUILD=' : l)).join('\n'));

  // verificações: nada de .next/node_modules no caminho (o painel os remove), ci-checks do pacote, ZIP íntegro e dentro do limite
  const files = listar(folder).map((f) => relative(folder, f).split(sep).join('/'));
  // pastas que o painel e o deploy_app removem do upload (get_docs: node_modules, .local, venv, .venv, __pycache__, .next, vendor, .bundle, target, .gradle, .npm) não podem aparecer no caminho
  const ruins = files.filter((f) => /(^|\/)(\.next|node_modules|vendor|target|venv|\.venv|__pycache__|\.bundle|\.gradle|\.local|\.npm)\//.test(f) || /(^|\/)\.env(\.|$)/.test(f) || /\.(pem|key|crt|p12)$/i.test(f));
  if (ruins.length) fail(`arquivos proibidos no pacote: ${ruins.slice(0, 5).join(', ')}`);
  const ck = spawnSync(process.execPath, [join(SELF, 'ci-checks.mjs'), '--root', folder, '--deploy', ...(release.perfil === 'production' ? ['--producao'] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (ck.status !== 0) fail(`ci-checks reprovou o pacote pré-construído:\n${ck.stderr || ck.stdout}`);
  // --sem-zip (runner Ubuntu do GitHub Actions: o tar GNU não cria ZIP; o deploy_app envia a PASTA): só confere o tamanho total contra o limite de 100 MB do upload
  let bytes = 0;
  if (args['sem-zip']) {
    for (const f of files) bytes += statSync(join(folder, f)).size;
    if (bytes > 100 * 1024 * 1024) fail(`pasta de ${(bytes / 1048576).toFixed(1)} MB (descomprimida) passa do limite de 100 MB do upload; confira o ZIP real antes de enviar`);
  } else {
    const z = spawnSync('tar', ['-a', '-c', '-f', zip, '-C', folder, '.'], { encoding: 'utf8' });
    if (z.error || z.status !== 0) fail(`tar falhou ao criar o ZIP: ${z.stderr || z.error}`);
    const l = spawnSync('tar', ['-tf', zip], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const entradas = String(l.stdout).split(/\r?\n/).filter((x) => x && !x.endsWith('/'));
    if (entradas.length !== files.length) fail(`pasta (${files.length}) e ZIP (${entradas.length}) divergem`);
    bytes = statSync(zip).size;
    if (bytes > 100 * 1024 * 1024) fail(`ZIP de ${(bytes / 1048576).toFixed(1)} MB passa do limite de 100 MB da Vertra`);
  }

  const man = JSON.parse(readFileSync(manifestOrigem, 'utf8').replace(/^\uFEFF/, ''));
  const novo = { ...man, pasta: folder, zip: args['sem-zip'] ? null : zip, zipSha256: args['sem-zip'] ? null : await sha256File(zip), zipBytes: args['sem-zip'] ? null : bytes, bytesDescomprimidos: args['sem-zip'] ? bytes : null, arquivos: files.length, prebuilt: { ...pb, externos: externos.length, overlays, buildCommand: '(vazio)' } };
  writeFileSync(manifestPath, JSON.stringify(novo, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, pasta: folder, zip: novo.zip, zipSha256: novo.zipSha256, zipBytes: novo.zipBytes, bytesDescomprimidos: novo.bytesDescomprimidos, arquivos: files.length, commit: release.commit, buildId, externos, overlays, manifesto: manifestPath }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
