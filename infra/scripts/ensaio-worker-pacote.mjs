#!/usr/bin/env node
// Ensaio LOCAL de BUILD de um pacote de WORKER (inclui o app descartável do bench-graph): copia a pasta do pacote para um diretório temporário, instala as dependências do
// package-lock do próprio pacote (como a Vertra: `npm install`, com devDependencies porque há build_command), roda o build_command do manifesto com HOME DENTRO da pasta
// (como a Vertra) e confere que os bundles esperados existem e RODAM sem banco. Nunca toca na Vertra, no banco nem em segredo (as variáveis do ensaio são fictícias).
// Nasceu do incidente de 24/11/2026: o pacote do bench-graph não tinha infra/vertra/bindings.json e o esbuild falhou NA Vertra (o ensaio de web não cobre o worker).
// Uso: node infra/scripts/ensaio-worker-pacote.mjs --manifest <arquivo .manifest.json> [--espera apps/workers/dist/bench-graph.js] [--sem-instalar-de <node_modules já instalado: NÃO use; só para depuração>]
// Saída: JSON em stdout (ok + etapas), progresso em stderr. Código 0 = ok; 1 = alguma etapa falhou; 2 = uso errado.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, fail } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.manifest || args.manifest === true) fail('use --manifest <arquivo .manifest.json>', 2);
const man = JSON.parse(readFileSync(resolve(String(args.manifest)), 'utf8'));
if (man.tipo !== 'workers') fail('o manifesto não é de um pacote de worker (tipo=' + man.tipo + ')', 2);
const ca = man.ferramentas.create_app;
const benchGraph = /build:bench-graph/.test(String(ca.build)) || man.benchGraph === true;
const espera = args.espera && args.espera !== true ? String(args.espera) : benchGraph ? 'apps/workers/dist/bench-graph.js' : 'apps/workers/dist/index.js';

const etapas = [];
const step = (nome, ok, detalhe) => { etapas.push({ nome, ok, ...(detalhe ? { detalhe } : {}) }); console.error(`[${ok ? 'ok' : 'FALHOU'}] ${nome}${detalhe ? ' — ' + detalhe : ''}`); return ok; };
const sh = (cmd, { cwd, env, timeout = 25 * 60 * 1000 }) => spawnSync(cmd, { cwd, env, shell: true, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
const cauda = (r, n = 6) => `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split(/\r?\n/).filter(Boolean).slice(-n).join(' | ').slice(0, 500);

// Cadeia `a && b` com prefixo VAR=valor (sintaxe de sh da Vertra), também no Windows.
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

const dir = mkdtempSync(join(tmpdir(), 'ln-ensaio-worker-'));
const work = join(dir, 'pacote');
let ok = false;
try {
  if (!existsSync(ca.path)) fail(`pasta do pacote ausente: ${ca.path}`, 2);
  cpSync(ca.path, work, { recursive: true });
  step('cópia do pacote para pasta temporária', true, `commit ${String(man.commit).slice(0, 12)}`);
  // As variáveis do app (só nomes de ambiente fictícios para o build: APP_ENV, NODE_ENV, APP_COMMIT do manifesto) e a CONDIÇÃO da Vertra: HOME dentro da pasta do app.
  const home = join(work, '.cache', 'vertra', 'tmp', 'build', 'home'); mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, ...Object.fromEntries(man.depois_do_create.set_env.map((e) => [e.nome, e.valor])) };
  for (const k of ['CI', 'LN_STUDIO_TEST_SESSION', 'DATABASE_URL', 'REDIS_URL', 'DB_SSL_CA_PEM', 'DB_SSL_CERT_PEM', 'DB_SSL_KEY_PEM']) delete env[k];
  let r = sh('npm install --no-audit --no-fund', { cwd: work, env });
  if (!step('npm install a partir do pacote (package-lock do próprio pacote)', r.status === 0, r.status === 0 ? '' : cauda(r))) throw new Error('npm install falhou');
  r = runChain(ca.build, { cwd: work, env });
  if (!step('build com o build_command do manifesto', r.status === 0, r.status === 0 ? '' : cauda(r, 10))) throw new Error('build falhou');
  if (!step(`bundle esperado existe: ${espera}`, existsSync(join(work, espera)), existsSync(join(work, espera)) ? '' : 'o build terminou mas o bundle não foi gerado')) throw new Error('bundle ausente');
  if (benchGraph) {
    // O bundle tem de RODAR sem banco e recusar: sem confirmação (saída 2) e fora do staging (saída 2), sem abrir conexão e sem imprimir URL/segredo.
    const bin = join(work, espera);
    const semConfirm = spawnSync(process.execPath, [bin], { cwd: work, env: { ...env, APP_ENV: 'staging' }, encoding: 'utf8' });
    step('bench-graph sem --confirm-staging-bench: recusa (saída 2) sem abrir conexão', semConfirm.status === 2 && /confirm-staging-bench/.test(`${semConfirm.stdout}${semConfirm.stderr}`), `saída ${semConfirm.status}: ${cauda(semConfirm, 2)}`);
    const prod = spawnSync(process.execPath, [bin, '--confirm-staging-bench'], { cwd: work, env: { ...env, APP_ENV: 'production' }, encoding: 'utf8' });
    step('bench-graph com APP_ENV=production: recusa (saída 2)', prod.status === 2 && /APP_ENV|staging/.test(`${prod.stdout}${prod.stderr}`), `saída ${prod.status}: ${cauda(prod, 2)}`);
    const outroBanco = spawnSync(process.execPath, [bin, '--confirm-staging-bench'], { cwd: work, env: { ...env, APP_ENV: 'staging', DATABASE_URL: 'postgres://banco-que-nao-e-o-de-staging.example.invalid:5432/x' }, encoding: 'utf8' });
    step('bench-graph com DATABASE_URL de outro banco: recusa (saída 2), sem repetir a URL', outroBanco.status === 2 && !/banco-que-nao-e-o-de-staging/.test(`${outroBanco.stdout}${outroBanco.stderr}`), `saída ${outroBanco.status}`);
  } else {
    const rodou = spawnSync(process.execPath, ['--check', join(work, espera)], { encoding: 'utf8' });
    step('o bundle é um módulo Node válido', rodou.status === 0, rodou.status === 0 ? '' : cauda(rodou, 3));
  }
  ok = etapas.every((e) => e.ok);
} catch (e) {
  if (!etapas.some((x) => !x.ok)) step('ensaio interrompido', false, String(e?.message ?? e).slice(0, 200));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok, commit: man.commit, pacote: ca.path, espera, etapas }, null, 2));
process.exit(ok ? 0 : 1);
