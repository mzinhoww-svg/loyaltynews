// Testes do pipeline de backup (ADR-012) com chave GPG DESCARTÁVEL e dump simulado (sem PostgreSQL).
// Cobre: cifra com chave pública, manifesto e hashes, dump ilegível sem a chave (teste negativo), decifra com a chave,
// alerta de backup velho/ausente e a proibição do gancho de teste em produção.
// NÃO cobre: pg_dump/pg_restore reais (não há PostgreSQL nesta máquina); isso fica para o ensaio em staging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sha256File } from '../scripts/lib/util.mjs';
import { decryptFile } from '../scripts/lib/gpg.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const GPG = process.env.GPG_BIN || (process.platform === 'win32' && existsSync('C:/Program Files/GnuPG/bin/gpg.exe') ? 'C:/Program Files/GnuPG/bin/gpg.exe' : 'gpg');
const hasGpg = !spawnSync(GPG, ['--version']).error;
const MARK = 'DADO-SIGILOSO-DO-DUMP-123';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ln-bk-'));
  const home = join(root, 'gnupg'); mkdirSync(home, { mode: 0o700 });
  const g = (a) => spawnSync(GPG, ['--batch', '--yes', '--no-tty', '--pinentry-mode', 'loopback', '--passphrase', '', ...a], { env: { ...process.env, GNUPGHOME: home }, encoding: 'utf8' });
  assert.equal(g(['--quick-generate-key', 'ln-teste <teste@example.invalid>', 'ed25519', 'cert', '1d']).status, 0);
  const fpr = g(['--with-colons', '--list-keys']).stdout.split('\n').find((l) => l.startsWith('fpr:')).split(':')[9];
  assert.equal(g(['--quick-add-key', fpr, 'cv25519', 'encr', '1d']).status, 0);
  const pub = g(['--armor', '--export', fpr]).stdout;
  const dump = join(root, 'fake.dump'); writeFileSync(dump, `PGDMP-simulado\n${MARK}\n` + 'x'.repeat(5000));
  const dest = join(root, 'dest');
  return { root, home, pub, dump, dest };
}
const backup = (c, extra = {}) => spawnSync(process.execPath, [join(S, 'backup-pg.mjs')], {
  encoding: 'utf8',
  env: { ...process.env, BACKUP_ENV: 'staging', BACKUP_DEST: c.dest, BACKUP_GPG_PUBKEY_PEM: c.pub, BACKUP_TEST_DUMP_FILE: c.dump, ...extra },
});
const fresh = (c, env = 'staging', max) => spawnSync(process.execPath, [join(S, 'backup-freshness.mjs'), '--env', env, ...(max !== undefined ? ['--max-age-min', String(max)] : [])], { encoding: 'utf8', env: { ...process.env, BACKUP_DEST: c.dest } });

test('backup cifrado: manifesto consistente, dump ilegível sem a chave e legível com ela', { skip: !hasGpg && 'gpg ausente' }, async () => {
  const c = setup();
  try {
    const r = backup(c);
    assert.equal(r.status, 0, r.stderr);
    const latest = JSON.parse(readFileSync(join(c.dest, 'latest-staging.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(join(c.dest, latest.manifest), 'utf8'));
    const enc = join(c.dest, manifest.file);
    assert.equal(await sha256File(enc), manifest.encryptedSha256);
    assert.equal(manifest.plaintextSha256, await sha256File(c.dump));
    assert.ok(!readFileSync(enc).includes(MARK), 'o dump cifrado não pode conter o texto em claro');
    // teste negativo (ADR-012): sem a chave privada o arquivo não abre
    const vazio = join(c.root, 'gnupg-vazio'); mkdirSync(vazio, { mode: 0o700 });
    assert.throws(() => decryptFile(enc, join(c.root, 'x.out'), { home: vazio }), /falha ao decifrar/);
    // com a chave (quem restaura) abre e confere
    const out = join(c.root, 'restaurado.dump');
    decryptFile(enc, out, { home: c.home });
    assert.equal(await sha256File(out), manifest.plaintextSha256);
    // nenhum texto em claro ficou no destino
    for (const f of [latest.manifest, 'latest-staging.json']) assert.ok(!readFileSync(join(c.dest, f), 'utf8').includes(MARK));
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('alerta de backup: fresco passa; velho, ausente e adulterado reprovam (falha forçada)', { skip: !hasGpg && 'gpg ausente' }, () => {
  const c = setup();
  try {
    assert.equal(fresh(c).status, 1, 'sem nenhum backup deve alertar');
    assert.equal(backup(c).status, 0);
    assert.equal(fresh(c).status, 0);
    assert.equal(fresh(c, 'staging', 0).status, 1, 'limite 0 min: qualquer idade reprova');
    const p = join(c.dest, 'latest-staging.json');
    const l = JSON.parse(readFileSync(p, 'utf8')); l.createdAt = new Date(Date.now() - 7 * 3600e3).toISOString();
    writeFileSync(p, JSON.stringify(l));
    const old = fresh(c);
    assert.equal(old.status, 1);
    assert.match(old.stdout, /"ok":false/);
    assert.equal(fresh(c, 'production').status, 1, 'produção não tem backup neste destino');
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('backup falha (código != 0) com destino inválido, sem chave e com gancho de teste em produção', { skip: !hasGpg && 'gpg ausente' }, () => {
  const c = setup();
  try {
    assert.notEqual(backup(c, { BACKUP_ENV: 'production' }).status, 0);
    assert.notEqual(backup(c, { BACKUP_GPG_PUBKEY_PEM: '', BACKUP_GPG_RECIPIENT: '' }).status, 0);
    assert.notEqual(backup(c, { BACKUP_DEST: join(c.dump, 'sub') }).status, 0); // destino dentro de um ARQUIVO: não dá para criar
    assert.notEqual(backup(c, { BACKUP_TEST_DUMP_FILE: join(c.root, 'nao-existe') }).status, 0);
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('restore-check recusa sem --scratch e quando o alvo é o mesmo servidor de origem', () => {
  const base = { ...process.env, BACKUP_DEST: tmpdir() };
  for (const k of ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD', 'CA_PEM', 'CLIENT_CERT_PEM', 'CLIENT_KEY_PEM']) base[`RESTORE_DB_${k}`] = 'x';
  const run = (args, env) => spawnSync(process.execPath, [join(S, 'restore-check.mjs'), ...args], { encoding: 'utf8', env });
  assert.equal(run(['--env', 'staging'], base).status, 2);
  const same = run(['--env', 'staging', '--scratch'], { ...base, DB_HOST: 'x', DB_PORT: 'x' });
  assert.equal(same.status, 2);
  assert.match(same.stderr, /mesmo servidor/);
});
