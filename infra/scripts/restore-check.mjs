#!/usr/bin/env node
// ADR-012: ensaio de restauração. Restaura o dump cifrado numa instância NOVA e compara contagens e checksums por tabela,
// medindo o tempo contra o RTO alvo (4 h). NUNCA aponte para o banco de produção.
// Uso: node infra/scripts/restore-check.mjs --env staging --scratch [--file <nome.dump.gpg>] [--rto-min 240]
// Ambiente: BACKUP_DEST (+ AWS_* se s3://); RESTORE_DB_HOST/PORT/NAME/USER/PASSWORD/CA_PEM/CLIENT_CERT_PEM/CLIENT_KEY_PEM
//           (instância descartável e VAZIA); GNUPGHOME com a chave PRIVADA de backup (só quem restaura a tem).
import { join } from 'node:path';
import { parseArgs, fail, requireEnv, sha256File, withTempDir, must } from './lib/util.mjs';
import { decryptFile } from './lib/gpg.mjs';
import { getFile, readText } from './lib/dest.mjs';
import { pgEnv, tableStats, compareStats } from './lib/pg.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args.scratch) fail('exigido --scratch: confirme que o alvo é uma instância descartável e vazia', 2);
requireEnv(['BACKUP_DEST']);
const envName = args.env;
if (!['staging', 'production'].includes(envName)) fail('use --env staging|production', 2);
const rtoMin = Number(args['rto-min'] ?? 240);
const dbEnvNames = ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD', 'CA_PEM', 'CLIENT_CERT_PEM', 'CLIENT_KEY_PEM'].map((k) => `RESTORE_DB_${k}`);
requireEnv(dbEnvNames);
if (process.env.DB_HOST && process.env.DB_HOST === process.env.RESTORE_DB_HOST && process.env.DB_PORT === process.env.RESTORE_DB_PORT) {
  fail('RESTORE_DB aponta para o mesmo servidor/porta de DB: recusado (o ensaio exige instância nova)', 2);
}
const pgRestore = process.env.PG_RESTORE_BIN || 'pg_restore';
const psql = process.env.PSQL_BIN || 'psql';
const t0 = Date.now();

try {
  const report = await withTempDir('ln-restore-', async (tmp) => {
    const dest = process.env.BACKUP_DEST;
    const latest = JSON.parse(readText(dest, `latest-${envName}.json`, tmp));
    const name = args.file || latest.file;
    const mName = name.replace(/\.dump\.gpg$/, '.manifest.json');
    const manifest = JSON.parse(readText(dest, mName, tmp));
    const enc = join(tmp, name);
    getFile(dest, name, enc);
    const encSha = await sha256File(enc);
    if (encSha !== manifest.encryptedSha256) throw new Error('SHA-256 do arquivo cifrado difere do manifesto');
    const plain = join(tmp, name.replace(/\.gpg$/, ''));
    decryptFile(enc, plain, { home: process.env.GNUPGHOME });
    if ((await sha256File(plain)) !== manifest.plaintextSha256) throw new Error('SHA-256 do dump decifrado difere do manifesto');

    const pe = pgEnv('RESTORE_DB', tmp);
    const existing = must(psql, ['-X', '-At', '-c', "select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')"], { env: pe, capture: true }).stdout.trim();
    if (existing !== '0') throw new Error(`instância de destino não está vazia (${existing} tabelas): recusado`);
    must(pgRestore, ['--no-owner', '--no-privileges', '--exit-on-error', '-d', pe.PGDATABASE], { env: pe });

    let diffs = [];
    let statsChecked = false;
    if (manifest.stats) { statsChecked = true; diffs = compareStats(manifest.stats, tableStats(pe, psql)); }
    const minutes = (Date.now() - t0) / 60000;
    return { file: name, statsChecked, diffs, minutes: Math.round(minutes * 10) / 10, rtoMin, withinRto: minutes <= rtoMin };
  });
  const ok = report.diffs.length === 0 && report.statsChecked && report.withinRto;
  console.log(JSON.stringify({ ok, ...report, aviso: report.statsChecked ? undefined : 'dump sem stats: refaça o backup com --stats; sem comparação por tabela o ensaio NÃO vale' }, null, 2));
  process.exit(ok ? 0 : 1);
} catch (e) {
  fail(`ensaio de restauração falhou: ${e.message}`);
}
