#!/usr/bin/env node
// Regressão do início pela RAIZ (linha 7 das tarefas de 24/11): sobe o build já feito com `next start apps/web` tendo a raiz do
// monorepo como diretório atual (como o pacote de deploy faz) e espera GET /api/health = 200.
//  - Porta livre escolhida pelo sistema (nunca porta fixa); tempo-limite explícito (--timeout, padrão 90 s).
//  - Sempre encerra a árvore de processos do next (Windows: taskkill /T /F; demais: grupo de processos).
//  - Saída: 0 = health 200; 1 = não ficou pronto no prazo ou o processo morreu antes; 2 = uso/pré-requisito (sem build).
//  - Imprime só o motivo e as últimas linhas do servidor (sem variáveis de ambiente).
// Uso: node apps/web/scripts/start-raiz.mjs [--root <raiz do monorepo>] [--timeout <s>]
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const out = { root: resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), timeout: 90 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') out.root = resolve(argv[++i]);
    else if (argv[i] === '--timeout') out.timeout = Number(argv[++i]);
  }
  if (!Number.isFinite(out.timeout) || out.timeout <= 0) throw new Error('--timeout precisa ser um número de segundos > 0');
  return out;
}

/** Porta livre: o sistema escolhe (listen 0) e ela é liberada em seguida. */
export function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

/** Sobe `next start apps/web` com cwd = root e espera /api/health 200. Resolve { ok, motivo, segundos, ultimas }. */
export async function startFromRoot({ root, timeout }) {
  if (!existsSync(join(root, 'apps', 'web', '.next', 'BUILD_ID'))) {
    return { ok: false, code: 2, motivo: 'sem build em apps/web/.next (rode: npm run build -w @ln/web)', segundos: 0, ultimas: [] };
  }
  const port = await freePort();
  const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  const env = { ...process.env, PORT: String(port), NODE_ENV: 'production' };
  const child = spawn(process.execPath, [nextBin, 'start', 'apps/web', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const linhas = [];
  const guarda = (b) => {
    for (const l of String(b).split(/\r?\n/)) if (l.trim()) linhas.push(l.slice(0, 300));
    if (linhas.length > 40) linhas.splice(0, linhas.length - 40);
  };
  child.stdout.on('data', guarda);
  child.stderr.on('data', guarda);
  let morreu = null;
  child.on('exit', (code, sig) => {
    morreu = { code, sig };
  });
  const t0 = Date.now();
  const prazo = t0 + timeout * 1000;
  try {
    while (Date.now() < prazo) {
      if (morreu) return { ok: false, code: 1, motivo: `o servidor saiu antes de responder (código ${morreu.code ?? morreu.sig})`, segundos: (Date.now() - t0) / 1000, ultimas: linhas.slice(-15) };
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 3000);
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctl.signal });
        clearTimeout(t);
        if (r.status === 200) return { ok: true, code: 0, motivo: 'health 200', segundos: (Date.now() - t0) / 1000, ultimas: linhas.slice(-5) };
      } catch {
        /* ainda subindo */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { ok: false, code: 1, motivo: `sem health 200 em ${timeout} s`, segundos: timeout, ultimas: linhas.slice(-15) };
  } finally {
    killTree(child);
  }
}

/**
 * Subida que TEM de ser recusada (achado do QA 8 em 26be6bb): `next start` com o `env` dado (ex.: produção + flag sem decisão), consultando
 * /api/health a cada 25 ms DESDE o spawn até o processo sair ou o prazo vencer. Resolve { exitCode, vistos, ms, ultimas }: `vistos` conta
 * cada status HTTP (e "recusada" para conexão recusada). Roda com cwd = apps/web (não depende do início pela raiz).
 */
export async function refusedStartProbe({ root, env, timeout }) {
  if (!existsSync(join(root, 'apps', 'web', '.next', 'BUILD_ID'))) return { exitCode: null, vistos: {}, ms: 0, ultimas: ['sem build'], semBuild: true };
  const port = await freePort();
  const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
  const t0 = Date.now();
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: join(root, 'apps', 'web'),
    env: { ...process.env, ...env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const linhas = [];
  const guarda = (b) => {
    for (const l of String(b).split(/\r?\n/)) if (l.trim()) linhas.push(`${Date.now() - t0}ms ${l.slice(0, 200)}`);
    if (linhas.length > 40) linhas.splice(0, linhas.length - 40);
  };
  child.stdout.on('data', guarda);
  child.stderr.on('data', guarda);
  let saiu = null;
  child.on('exit', (code) => {
    saiu = code;
  });
  const vistos = {};
  try {
    while (saiu === null && Date.now() - t0 < timeout * 1000) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
        vistos[r.status] = (vistos[r.status] ?? 0) + 1;
      } catch {
        vistos.recusada = (vistos.recusada ?? 0) + 1;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return { exitCode: saiu, vistos, ms: Date.now() - t0, ultimas: linhas.slice(-10) };
  } finally {
    killTree(child);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(2);
  }
  const r = await startFromRoot(args);
  console.log(JSON.stringify({ ok: r.ok, motivo: r.motivo, segundos: Math.round(r.segundos * 10) / 10 }));
  if (!r.ok && r.ultimas.length) console.log(`últimas linhas do servidor:\n${r.ultimas.join('\n')}`);
  process.exit(r.code);
}
