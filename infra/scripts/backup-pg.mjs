#!/usr/bin/env node
// ADR-012: pg_dump cifrado (GnuPG, chave pública) para destino FORA da Vertra. RPO alvo 6 h (rodar a cada 6 h).
// Uso: node infra/scripts/backup-pg.mjs [--stats]     (rodar na raiz do repositório)
// Ambiente (nomes em infra/vertra/env-contract.json; valores NUNCA no repositório):
//   BACKUP_ENV=staging|production, BACKUP_DEST, BACKUP_GPG_PUBKEY_PEM (ou BACKUP_GPG_RECIPIENT já no chaveiro),
//   DATABASE_URL, DB_SSL_CA_PEM, DB_SSL_CERT_PEM, DB_SSL_KEY_PEM
// Vínculo (QA): o banco da DATABASE_URL tem de ser o registrado para BACKUP_ENV em infra/vertra/bindings.json; senão recusa.
// O manifesto grava a identidade do banco (host e nome, não secretos) para que migração e alerta confirmem que o backup é DESTE banco.
// Saída: <dest>/ln-<env>-<UTC>.dump.gpg, .manifest.json e latest-<env>.json. Código != 0 em qualquer falha.
import { mkdirSync, statSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, fail, requireEnv, sha256File, withTempDir, must, run } from './lib/util.mjs';
import { importPublicKey, encryptFile } from './lib/gpg.mjs';
import { putFile } from './lib/dest.mjs';
import { pgEnv, tableStats } from './lib/pg.mjs';
import { assertBound } from './lib/binding.mjs';

const args = parseArgs(process.argv.slice(2));
requireEnv(['BACKUP_ENV', 'BACKUP_DEST', 'DATABASE_URL']);
const envName = process.env.BACKUP_ENV;
if (!['staging', 'production'].includes(envName)) fail('BACKUP_ENV deve ser staging ou production');
if (!process.env.BACKUP_GPG_PUBKEY_PEM && !process.env.BACKUP_GPG_RECIPIENT) fail('defina BACKUP_GPG_PUBKEY_PEM (chave pública ASCII) ou BACKUP_GPG_RECIPIENT', 2);

const testFile = process.env.BACKUP_TEST_DUMP_FILE; // gancho SÓ de teste: nunca em produção
if (testFile && envName === 'production') fail('BACKUP_TEST_DUMP_FILE é proibido com BACKUP_ENV=production');
const pgDump = process.env.PG_DUMP_BIN || 'pg_dump';

let source;
try { source = assertBound({ env: envName, databaseUrl: process.env.DATABASE_URL, root: process.cwd() }); } catch (e) { fail(`vínculo ambiente/banco: ${e.message}`); }

try {
  await withTempDir('ln-backup-', async (tmp) => {
    const home = join(tmp, 'gnupg');
    mkdirSync(home, { mode: 0o700 });
    const recipient = process.env.BACKUP_GPG_PUBKEY_PEM
      ? importPublicKey(process.env.BACKUP_GPG_PUBKEY_PEM, home, tmp)
      : process.env.BACKUP_GPG_RECIPIENT;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const base = `ln-${envName}-${stamp}`;
    const dump = join(tmp, `${base}.dump`);
    let stats; let pgVersion = 'n/d';

    if (testFile) {
      copyFileSync(testFile, dump);
    } else {
      const pe = pgEnv({ urlVar: 'DATABASE_URL', pemPrefix: 'DB_SSL' }, tmp);
      pgVersion = String(run(pgDump, ['--version'], { capture: true }).stdout || '').trim();
      if (args.stats) stats = tableStats(pe); // fotografia pouco antes do dump: consistente só sem escrita concorrente (ensaio em staging)
      must(pgDump, ['-Fc', '--no-owner', '--no-privileges', '-f', dump], { env: pe });
    }

    const plainSha = await sha256File(dump);
    const plainBytes = statSync(dump).size;
    const enc = `${dump}.gpg`;
    encryptFile(dump, enc, { recipient, home });
    const encSha = await sha256File(enc);
    const manifest = {
      schema: 2, env: envName, source: { host: source.host, database: source.database },
      createdAt: new Date().toISOString(), file: `${base}.dump.gpg`,
      encryptedSha256: encSha, encryptedBytes: statSync(enc).size,
      plaintextSha256: plainSha, plaintextBytes: plainBytes, pgDumpVersion: pgVersion, gpgRecipient: recipient,
      ...(stats ? { stats } : {}),
    };
    const mPath = join(tmp, `${base}.manifest.json`);
    writeFileSync(mPath, JSON.stringify(manifest, null, 2));
    const latest = join(tmp, `latest-${envName}.json`);
    writeFileSync(latest, JSON.stringify({ createdAt: manifest.createdAt, file: manifest.file, manifest: `${base}.manifest.json`, encryptedSha256: encSha }, null, 2));

    // Ordem: dump e manifesto primeiro; `latest` por último (só aponta para algo que já existe no destino).
    putFile(process.env.BACKUP_DEST, enc, manifest.file);
    putFile(process.env.BACKUP_DEST, mPath, `${base}.manifest.json`);
    putFile(process.env.BACKUP_DEST, latest, `latest-${envName}.json`);
    console.log(JSON.stringify({ ok: true, env: envName, banco: `${source.host}/${source.database}`, file: manifest.file, encryptedBytes: manifest.encryptedBytes, encryptedSha256: encSha, stats: stats ? Object.keys(stats).length + ' tabelas' : 'sem stats' }));
  });
} catch (e) {
  fail(`backup falhou: ${e.message}`);
}
