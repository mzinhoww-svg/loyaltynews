// Utilitários compartilhados dos scripts de infra. Sem dependências externas (Node >= 24).
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

export async function withTempDir(prefix, fn) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Executa um comando sem shell. Nunca passe segredo em argv: use `env`. */
export function run(cmd, args, { env, cwd, input, capture = false } = {}) {
  const r = spawnSync(cmd, args, {
    env: { ...process.env, ...(env || {}) },
    cwd,
    input,
    encoding: 'utf8',
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return r;
}

export function must(cmd, args, opts) {
  const r = run(cmd, args, opts);
  if (r.status !== 0) {
    // Só mostra o binário e o código; os argumentos podem conter caminhos, nunca segredos.
    throw new Error(`${cmd} terminou com código ${r.status}${r.stderr ? ': ' + String(r.stderr).trim().slice(0, 400) : ''}`);
  }
  return r;
}

/** npm no Windows é .cmd e exige shell; os argumentos aqui são fixos (sem entrada do usuário). */
export function npm(args, opts = {}) {
  const win = process.platform === 'win32';
  const r = spawnSync(win ? 'npm.cmd' : 'npm', args, {
    shell: win,
    stdio: 'inherit',
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export function fail(msg, code = 1) {
  console.error(`ERRO: ${msg}`);
  process.exit(code);
}

export function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) fail(`variáveis ausentes: ${missing.join(', ')} (valores nunca vão no repositório; ver infra/vertra/env-contract.json)`, 2);
}
