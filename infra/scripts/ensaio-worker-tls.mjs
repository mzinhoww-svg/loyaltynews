#!/usr/bin/env node
// Ensaio do worker COM TLS e destinos inacessíveis (decisão 17 da Security, incidente 23/11/2026: chave privada de cliente no log do worker).
// Sobe `apps/workers/dist/index.js` com PEM descartáveis (CA, certificado e chave de cliente gerados agora com o openssl, usados só aqui) apontando o PostgreSQL e o
// Redis para uma porta fechada de 127.0.0.1, deixa rodar alguns segundos, encerra, e confere que NADA do stdout/stderr contém material de chave: nem "PRIVATE KEY", nem
// qualquer trecho de 32 caracteres do corpo base64 da chave. Nunca imprime a saída do worker (só contagens): o ensaio não pode vazar o que procura.
// Uso: node infra/scripts/ensaio-worker-tls.mjs --root <checkout com node_modules e apps/workers/dist/index.js> [--segundos 20]
//   código 0 = sem vazamento; 1 = VAZAMENTO (a saída tem material de chave); 3 = ensaio inconclusivo (sem openssl, sem build do worker ou o worker não chegou a tentar conectar).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, fail } from './lib/util.mjs';

/** Procura material de chave em `texto`: marcador PRIVATE KEY ou qualquer janela de 32 caracteres do corpo base64 da chave. Função pura. */
export function vazamentoDeChave(texto, chavePem) {
  const t = String(texto);
  const achados = [];
  if (/PRIVATE KEY/.test(t)) achados.push('marcador PRIVATE KEY');
  const corpo = String(chavePem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const semQuebras = t.replace(/['"+\s\\n]/g, '');
  for (let i = 0; i + 32 <= corpo.length; i += 16) if (semQuebras.includes(corpo.slice(i, i + 32))) { achados.push('trecho do corpo da chave'); break; }
  return achados;
}

async function portaFechada() {
  return new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
const umaLinha = (pem) => pem.trim().replace(/\r?\n/g, '\\n');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root || args.root === true) fail('use --root <checkout com node_modules e apps/workers/dist/index.js>', 2);
  const root = resolve(String(args.root));
  const entrada = join(root, 'apps/workers/dist/index.js');
  if (!existsSync(entrada)) { console.log(JSON.stringify({ ok: null, inconclusivo: 'sem apps/workers/dist/index.js (rode: npm run build -w @ln/workers)' })); process.exit(3); }
  const segundos = Number(args.segundos ?? 20);
  const dir = mkdtempSync(join(tmpdir(), 'ln-ensaio-tls-'));
  try {
    const candidatos = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
    const opensslBin = candidatos.find((c) => { try { execFileSync(c, ['version'], { stdio: 'ignore' }); return true; } catch { return false; } });
    const ssl = (a) => execFileSync(opensslBin ?? 'openssl', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      ssl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=ensaio-ca', '-days', '2']);
      ssl(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'cli.key', '-out', 'cli.csr', '-subj', '/CN=ensaio-cliente']);
      ssl(['x509', '-req', '-in', 'cli.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'cli.crt', '-days', '2']);
    } catch (e) { console.log(JSON.stringify({ ok: null, inconclusivo: `openssl indisponível ou falhou (${String(e.code || e.message).slice(0, 80)})` })); process.exit(3); }
    const ca = readFileSync(join(dir, 'ca.crt'), 'utf8'), cert = readFileSync(join(dir, 'cli.crt'), 'utf8'), key = readFileSync(join(dir, 'cli.key'), 'utf8');
    const portaPg = await portaFechada(), portaRd = await portaFechada();
    const u = 'ensaio', s = 'ensaio-senha';
    const env = {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, HOME: dir, USERPROFILE: dir,
      APP_ENV: 'staging', NODE_ENV: 'production',
      DATABASE_URL: `postgres://${u}:${s}@localhost:${portaPg}/ensaio`, REDIS_URL: `rediss://${u}:${s}@localhost:${portaRd}`,
      DB_SSL_CA_PEM: umaLinha(ca), DB_SSL_CERT_PEM: umaLinha(cert), DB_SSL_KEY_PEM: umaLinha(key),
      REDIS_SSL_CA_PEM: umaLinha(ca), REDIS_SSL_CERT_PEM: umaLinha(cert), REDIS_SSL_KEY_PEM: umaLinha(key),
    };
    const saida = [];
    const filho = spawn(process.execPath, [entrada], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    filho.stdout.on('data', (d) => saida.push(String(d)));
    filho.stderr.on('data', (d) => saida.push(String(d)));
    const codigo = await new Promise((res) => {
      const t = setTimeout(() => { filho.kill('SIGTERM'); setTimeout(() => filho.kill('SIGKILL'), 3000); }, segundos * 1000);
      filho.on('exit', (c, sig) => { clearTimeout(t); res(c ?? sig); });
    });
    const texto = saida.join('');
    const tentou = /ECONNREFUSED|password authentication|connect|\[workers\]|ioredis/i.test(texto);
    const achados = vazamentoDeChave(texto, key);
    const r = { ok: achados.length === 0 && tentou ? true : achados.length ? false : null, vazou: achados, workerTentouConectar: tentou, saidaBytes: texto.length, linhas: texto.split('\n').length, encerrou: codigo, segundos };
    if (achados.length) console.log(JSON.stringify({ ...r, ok: false, nota: 'A SAÍDA DO WORKER CONTÉM MATERIAL DE CHAVE (não impressa aqui). Backend: C1–C5 da decisão 17.' }, null, 2));
    else if (!tentou) console.log(JSON.stringify({ ...r, ok: null, inconclusivo: 'o worker não chegou a tentar conectar (saída sem sinal de conexão)' }, null, 2));
    else console.log(JSON.stringify(r, null, 2));
    process.exit(achados.length ? 1 : tentou ? 0 : 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

import { pathToFileURL } from 'node:url';
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) await main();
