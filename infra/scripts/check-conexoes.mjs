#!/usr/bin/env node
// Prova que as credenciais de um ambiente CONECTAM no PostgreSQL e no Redis da Vertra (TLS verify-full + certificado de cliente), sem imprimir segredo.
// Só lê: `select 1` no PostgreSQL (via psql) e PING no Redis (via ioredis do node_modules do repositório). Falha fechada: o banco da DATABASE_URL tem de ser
// o que o ambiente declara em infra/vertra/bindings.json (mesma barreira do migrate.mjs); o host do Redis nunca é impresso com usuário/senha.
// Ambiente (vindo do cofre, nunca de arquivo): PG: APP_ENV, DATABASE_URL, DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM · Redis: REDIS_URL (rediss://), REDIS_SSL_CA_PEM, REDIS_SSL_CERT_PEM, REDIS_SSL_KEY_PEM
// Uso (na raiz do checkout, com node_modules): node infra/scripts/check-conexoes.mjs --env staging|production [--pg] [--redis]   (sem --pg/--redis testa os dois)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs, fail, must } from './lib/util.mjs';
import { assertBound, canonEnv } from './lib/binding.mjs';
import { pgEnv } from './lib/pg.mjs';

/** Opções TLS do ioredis a partir das variáveis REDIS_SSL_*_PEM e do host da URL. Função pura (testada sem Redis). */
export function redisTlsFromEnv(env) {
  const faltam = ['REDIS_URL', 'REDIS_SSL_CA_PEM', 'REDIS_SSL_CERT_PEM', 'REDIS_SSL_KEY_PEM'].filter((k) => !env[k]);
  if (faltam.length) throw new Error(`variáveis ausentes: ${faltam.join(', ')}`);
  let u;
  try { u = new URL(env.REDIS_URL); } catch { throw new Error('REDIS_URL inválida'); }
  if (u.protocol !== 'rediss:') throw new Error('REDIS_URL precisa ser rediss:// (a Vertra exige TLS)');
  for (const k of ['REDIS_SSL_CA_PEM', 'REDIS_SSL_CERT_PEM', 'REDIS_SSL_KEY_PEM']) if (!String(env[k]).includes('-----BEGIN ')) throw new Error(`${k} não parece PEM`);
  return { host: u.hostname, tls: { ca: env.REDIS_SSL_CA_PEM, cert: env.REDIS_SSL_CERT_PEM, key: env.REDIS_SSL_KEY_PEM, servername: u.hostname, rejectUnauthorized: true } };
}

const direct = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (direct) {
  const args = parseArgs(process.argv.slice(2));
  const envName = canonEnv(args.env);
  if (!envName) fail('use --env staging|production', 2);
  const doPg = Boolean(args.pg) || !args.redis;
  const doRedis = Boolean(args.redis) || !args.pg;
  const out = [];
  let ok = true;
  if (doPg) {
    const tmp = mkdtempSync(join(tmpdir(), 'ln-conn-'));
    try {
      const alvo = assertBound({ env: envName, databaseUrl: process.env.DATABASE_URL ?? '', root: process.cwd() });
      const pe = pgEnv({ urlVar: 'DATABASE_URL', pemPrefix: 'DB_SSL' }, tmp);
      const r = must(process.env.PSQL_BIN || 'psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'select 1'], { env: pe, capture: true });
      out.push(`postgres ok (${alvo.host}/${alvo.database}): select 1 = ${String(r.stdout).trim()}`);
    } catch (e) { ok = false; out.push(`postgres FALHOU: ${String(e.message).slice(0, 300)}`); } finally { rmSync(tmp, { recursive: true, force: true }); }
  }
  if (doRedis) {
    let cli;
    try {
      const { host, tls } = redisTlsFromEnv(process.env);
      const IORedis = createRequire(join(process.cwd(), 'package.json'))('ioredis');
      cli = new IORedis(process.env.REDIS_URL, { tls, lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 8000, retryStrategy: () => null });
      cli.on('error', () => undefined);
      await cli.connect();
      out.push(`redis ok (${host}): PING = ${await cli.ping()}`);
    } catch (e) { ok = false; out.push(`redis FALHOU: ${String(e.message).replace(/rediss?:\/\/[^\s]+/g, '<url>').slice(0, 300)}`); } finally { try { cli?.disconnect(); } catch { /* já fechado */ } }
  }
  console.log(out.join('\n'));
  process.exit(ok ? 0 : 1);
}
