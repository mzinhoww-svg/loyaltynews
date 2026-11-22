#!/usr/bin/env node
// Ensaio LOCAL de um pacote gerado por package-web.mjs, antes de enviá-lo à Vertra: copia a PASTA do pacote para um diretório
// temporário (a pasta de releases não é tocada), instala as dependências, roda o build_command e o start_command do manifesto
// (só trocando porta e host), aplica as variáveis do manifesto e roda as sondas: saúde com o commit certo, Studio negando sem login,
// ausência de MOCK. Também prova que o guard falha fechado (LN_STUDIO_TEST_SESSION e PORTAL_SOURCE=mock impedem build/start).
// Não escreve na Vertra nem no GitHub. Apaga o diretório temporário e encerra o servidor ao final.
// Uso: node infra/scripts/ensaio-pacote.mjs --manifest <arquivo .manifest.json> [--port 3197]
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, fail } from './lib/util.mjs';

const SELF = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
if (!args.manifest || args.manifest === true) fail('use --manifest <arquivo>', 2);
const port = String(args.port ?? 3197);
const man = JSON.parse(readFileSync(resolve(String(args.manifest)), 'utf8'));
const ca = man.ferramentas.create_app;
const win = process.platform === 'win32';
const results = [];
const step = (nome, ok, detalhe) => { results.push({ nome, ok, ...(detalhe ? { detalhe } : {}) }); console.error(`[${ok ? 'ok' : 'FALHOU'}] ${nome}${detalhe ? ' — ' + detalhe : ''}`); return ok; };

const clean = { ...process.env };
for (const k of ['CI', 'LN_STUDIO_TEST_SESSION', 'PORTAL_SOURCE', 'PORTAL_MODE', 'LN_E2E_BUILD', 'DIAG_XFF']) delete clean[k];
const appEnv = Object.fromEntries(man.depois_do_create.set_env.map((e) => [e.nome, e.valor]));
appEnv.APP_URL = `http://127.0.0.1:${port}`; appEnv.BETTER_AUTH_URL = appEnv.APP_URL; // URL local só para o ensaio

function sh(cmd, { cwd, env, timeout = 15 * 60 * 1000 }) {
  return spawnSync(cmd, { cwd, env, shell: true, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024 });
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

  let r = sh('npm install --no-audit --no-fund', { cwd: work, env: clean });
  if (!step('npm install a partir do pacote', r.status === 0)) throw new Error('install falhou');

  // guard falha fechado (no build e no start)
  r = sh(ca.build, { cwd: work, env: { ...clean, ...appEnv, LN_STUDIO_TEST_SESSION: '1' } });
  step('build RECUSADO com LN_STUDIO_TEST_SESSION definida', r.status !== 0 && /guard-env REPROVADO/.test(`${r.stdout}${r.stderr}`));
  r = sh(ca.start, { cwd: work, env: { ...clean, ...appEnv, PORTAL_SOURCE: 'mock' } });
  step('start RECUSADO com PORTAL_SOURCE=mock em staging', r.status !== 0 && /guard-env REPROVADO/.test(`${r.stdout}${r.stderr}`));

  r = sh(ca.build, { cwd: work, env: { ...clean, ...appEnv } });
  if (!step('build com o build_command do manifesto', r.status === 0)) throw new Error('build falhou');

  const start = ca.start.replace('-p 80 -H 0.0.0.0', `-p ${port} -H 127.0.0.1`);
  server = spawn(start, { cwd: work, env: { ...clean, ...appEnv }, shell: true, stdio: 'ignore', detached: !win });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) }); up = res.ok; } catch { await new Promise((s) => setTimeout(s, 700)); }
  }
  if (!step('servidor sobe com o start_command do manifesto', up)) throw new Error('servidor não subiu');

  r = spawnSync(process.execPath, [join(SELF, 'healthcheck.mjs'), '--url', `http://127.0.0.1:${port}`, '--expect-commit', man.commit, '--denied', '/studio', '--no-mock', '/'], { encoding: 'utf8' });
  step('sondas: saúde com o commit certo, Studio nega sem login, sem MOCK', r.status === 0, r.status === 0 ? JSON.parse(r.stdout).denied?.status + ' ' + (JSON.parse(r.stdout).denied?.location ?? '') : r.stdout.trim().slice(0, 300));

  for (const p of ['/', '/noticias', '/agenda', '/busca', '/studio/entrar']) {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    const body = await res.text();
    step(`portal ${p}`, res.status === 200 && !/\bMOCK\b/.test(body), `HTTP ${res.status}`);
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
