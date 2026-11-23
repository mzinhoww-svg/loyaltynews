// Testes do pipeline de backup (ADR-012) e da vinculação ambiente<->banco, com chave GPG DESCARTÁVEL e dump simulado (sem PostgreSQL).
// Cobre: cifra com chave pública, manifesto com identidade do banco, dump ilegível sem a chave (teste negativo), decifra com a chave,
// alerta de backup velho/ausente/futuro/de outro banco/objeto corrompido, e a recusa de migrar/restaurar sem vínculo correto.
// NÃO cobre: pg_dump/pg_restore reais (não há PostgreSQL nesta máquina); isso fica para o ensaio em staging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
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
const HOST_STG = 'aaaa1111bbbb2222cccc3333dddd4444.db.usa1.vertraweb.app';
const HOST_PRD = 'eeee5555ffff6666aaaa7777bbbb8888.db.usa1.vertraweb.app';
const URL_STG = `postgres://u:p@${HOST_STG}:51000/vertracloud`;
const URL_PRD = `postgres://u:p@${HOST_PRD}:52000/vertracloud`;
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

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
  // "repositório" de teste com o vínculo ambiente -> banco (infra/vertra/bindings.json)
  const repo = join(root, 'repo'); mkdirSync(join(repo, 'infra/vertra'), { recursive: true });
  writeFileSync(join(repo, 'infra/vertra/bindings.json'), JSON.stringify({ schema: 1, ambientes: { staging: { dbHost: HOST_STG, dbName: 'vertracloud' }, production: { dbHost: HOST_PRD, dbName: 'vertracloud' } } }));
  return { root, home, pub, dump, dest, repo };
}
const cleanEnv = () => { const e = { ...process.env }; for (const k of ['LN_STUDIO_TEST_SESSION', 'PORTAL_SOURCE', 'PORTAL_MODE', 'APP_ENV', 'CI', 'DB_SSL_MODE']) delete e[k]; return e; };
const backup = (c, extra = {}) => spawnSync(process.execPath, [join(S, 'backup-pg.mjs')], {
  encoding: 'utf8', cwd: c.repo,
  env: { ...cleanEnv(), BACKUP_ENV: 'staging', BACKUP_DEST: c.dest, BACKUP_GPG_PUBKEY_PEM: c.pub, BACKUP_TEST_DUMP_FILE: c.dump, DATABASE_URL: URL_STG, ...extra },
});
const fresh = (c, env = 'staging', extra = [], envx = {}) => spawnSync(process.execPath, [join(S, 'backup-freshness.mjs'), '--env', env, ...extra], { encoding: 'utf8', cwd: c.repo, env: { ...cleanEnv(), BACKUP_DEST: c.dest, ...envx } });
const readLatest = (c) => JSON.parse(readFileSync(join(c.dest, 'latest-staging.json'), 'utf8'));
const readManifest = (c) => JSON.parse(readFileSync(join(c.dest, readLatest(c).manifest), 'utf8'));
const skip = !hasGpg && 'gpg ausente';

test('backup cifrado: manifesto com identidade do banco, dump ilegível sem a chave e legível com ela', { skip }, async () => {
  const c = setup();
  try {
    const r = backup(c);
    assert.equal(r.status, 0, r.stderr);
    const manifest = readManifest(c);
    assert.deepEqual(manifest.source, { host: HOST_STG, database: 'vertracloud' });
    assert.ok(!JSON.stringify(manifest).includes(':p@'), 'o manifesto não pode ter credencial');
    const enc = join(c.dest, manifest.file);
    assert.equal(await sha256File(enc), manifest.encryptedSha256);
    assert.equal(manifest.plaintextSha256, await sha256File(c.dump));
    assert.ok(!readFileSync(enc).includes(MARK), 'o dump cifrado não pode conter o texto em claro');
    const vazio = join(c.root, 'gnupg-vazio'); mkdirSync(vazio, { mode: 0o700 });
    assert.throws(() => decryptFile(enc, join(c.root, 'x.out'), { home: vazio }), /falha ao decifrar/); // teste negativo da ADR-012
    const out = join(c.root, 'restaurado.dump');
    decryptFile(enc, out, { home: c.home });
    assert.equal(await sha256File(out), manifest.plaintextSha256);
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('backup recusa banco que não é o registrado para o ambiente, ambiente sem vínculo e gancho de teste em produção', { skip }, () => {
  const c = setup();
  try {
    const outroBanco = backup(c, { DATABASE_URL: URL_PRD }); // URL de produção com BACKUP_ENV=staging
    assert.notEqual(outroBanco.status, 0);
    assert.match(outroBanco.stderr, /NÃO corresponde ao banco registrado/);
    writeFileSync(join(c.repo, 'infra/vertra/bindings.json'), JSON.stringify({ schema: 1, ambientes: { staging: { dbHost: null, dbName: null }, production: { dbHost: null, dbName: null } } }));
    const semVinculo = backup(c);
    assert.notEqual(semVinculo.status, 0);
    assert.match(semVinculo.stderr, /sem vínculo/);
    assert.notEqual(backup(c, { BACKUP_ENV: 'production', DATABASE_URL: URL_PRD }).status, 0);
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('sonda de backup: fresco e íntegro passa; velho, ausente, futuro, de outro banco e objeto corrompido reprovam', { skip }, () => {
  const c = setup();
  try {
    assert.equal(fresh(c).status, 1, 'sem nenhum backup deve alertar');
    assert.equal(backup(c).status, 0);
    assert.equal(fresh(c).status, 0);
    assert.equal(fresh(c, 'staging', ['--verify-object']).status, 0, 'hash do objeto confere');
    assert.equal(fresh(c, 'staging', ['--max-age-min', '0']).status, 1, 'limite 0 min: qualquer idade reprova');
    assert.equal(fresh(c, 'production').status, 1, 'produção não tem backup neste destino');

    const lp = join(c.dest, 'latest-staging.json'); const mp = join(c.dest, readLatest(c).manifest);
    const orig = { l: readFileSync(lp, 'utf8'), m: readFileSync(mp, 'utf8') };
    const setBoth = (fn) => { const l = JSON.parse(orig.l); const m = JSON.parse(orig.m); fn(l, m); writeFileSync(lp, JSON.stringify(l)); writeFileSync(mp, JSON.stringify(m)); };
    const reset = () => { writeFileSync(lp, orig.l); writeFileSync(mp, orig.m); };

    setBoth((l, m) => { const t = new Date(Date.now() - 7 * 3600e3).toISOString(); l.createdAt = t; m.createdAt = t; });
    let r = fresh(c); assert.equal(r.status, 1); assert.match(r.stdout, /backup velho/); reset();

    setBoth((l, m) => { const t = new Date(Date.now() + 3 * 3600e3).toISOString(); l.createdAt = t; m.createdAt = t; });
    r = fresh(c); assert.equal(r.status, 1); assert.match(r.stdout, /no futuro/); reset();

    setBoth((l, m) => { m.source = { host: HOST_PRD, database: 'vertracloud' }; });
    r = fresh(c); assert.equal(r.status, 1); assert.match(r.stdout, /não é o registrado/); reset();

    setBoth((l) => { l.manifest = 'nao-existe.manifest.json'; });
    assert.equal(fresh(c).status, 1); reset();

    setBoth((l, m) => { m.createdAt = '2020-01-01T00:00:00.000Z'; }); // latest e manifesto divergem
    r = fresh(c); assert.equal(r.status, 1); assert.match(r.stdout, /divergem/); reset();

    // objeto corrompido com o MESMO tamanho: só --verify-object pega; objeto truncado: a checagem de tamanho pega
    const objPath = join(c.dest, readManifest(c).file);
    const orgObj = readFileSync(objPath);
    const flip = Buffer.from(orgObj); flip[flip.length - 1] ^= 0xff; writeFileSync(objPath, flip);
    assert.equal(fresh(c).status, 0, 'sem --verify-object o tamanho igual passa (por isso a migração usa --verify-object)');
    r = fresh(c, 'staging', ['--verify-object']); assert.equal(r.status, 1); assert.match(r.stdout, /SHA-256 do objeto/);
    writeFileSync(objPath, orgObj.subarray(0, orgObj.length - 10));
    r = fresh(c); assert.equal(r.status, 1); assert.match(r.stdout, /bytes/);
    writeFileSync(objPath, orgObj); assert.equal(fresh(c, 'staging', ['--verify-object']).status, 0);
    rmSync(objPath); assert.equal(fresh(c).status, 1, 'ponteiro recente sem dump reprova');
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('sonda de backup recusa ambiente sem vínculo em bindings.json', { skip }, () => {
  const c = setup();
  try {
    assert.equal(backup(c).status, 0);
    writeFileSync(join(c.repo, 'infra/vertra/bindings.json'), JSON.stringify({ schema: 1, ambientes: { staging: { dbHost: null, dbName: null } } }));
    const r = fresh(c); assert.equal(r.status, 1); assert.match(r.stdout, /sem vínculo/);
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('backup falha (código != 0) sem chave, com destino inválido e com arquivo de teste inexistente', { skip }, () => {
  const c = setup();
  try {
    assert.notEqual(backup(c, { BACKUP_GPG_PUBKEY_PEM: '', BACKUP_GPG_RECIPIENT: '' }).status, 0);
    assert.notEqual(backup(c, { BACKUP_DEST: join(c.dump, 'sub') }).status, 0); // destino dentro de um ARQUIVO: não dá para criar
    assert.notEqual(backup(c, { BACKUP_TEST_DUMP_FILE: join(c.root, 'nao-existe') }).status, 0);
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

const mig = (c, args, env = {}) => spawnSync(process.execPath, [join(S, 'migrate.mjs'), ...args], {
  encoding: 'utf8', cwd: c.repo,
  env: { ...cleanEnv(), APP_ENV: 'staging', DATABASE_URL: URL_STG, DB_SSL_CA_PEM: PEM, DB_SSL_CERT_PEM: PEM, DB_SSL_KEY_PEM: PEM, BACKUP_DEST: c.dest, ...env },
});

test('migrate: --env não decide sozinho; exige APP_ENV igual, banco vinculado e sem variáveis de CI/teste', () => {
  const c = setup();
  try {
    // ci-checks precisa existir no "repositório" de teste
    mkdirSync(join(c.repo, 'infra/scripts'), { recursive: true });
    for (const f of ['ci-checks.mjs', 'backup-freshness.mjs', 'verify-migrations.mjs']) writeFileSync(join(c.repo, 'infra/scripts', f), `import ${JSON.stringify('file:///' + join(S, f).replace(/\\/g, '/'))};`);
    writeFileSync(join(c.repo, 'package.json'), '{"name":"x"}');
    let r = mig(c, ['--env', 'staging', '--dry-run']); assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /migraria .*\/vertracloud/);
    r = mig(c, ['--env', 'production', '--dry-run']); assert.equal(r.status, 2); assert.match(r.stderr, /APP_ENV .* não corresponde/); // APP_ENV=staging com --env production
    r = mig(c, ['--env', 'production', '--dry-run'], { APP_ENV: 'production' }); // credenciais de STAGING com ambiente production
    assert.equal(r.status, 2); assert.match(r.stderr, /NÃO corresponde ao banco registrado para "production"/);
    r = mig(c, ['--env', 'staging', '--dry-run'], { DATABASE_URL: URL_PRD }); assert.equal(r.status, 2); assert.match(r.stderr, /NÃO corresponde/);
    r = mig(c, ['--env', 'staging', '--dry-run'], { APP_ENV: 'homologacao' }); assert.equal(r.status, 0, 'vocabulário do scaffold (homologacao) é aceito');
    r = mig(c, ['--env', 'staging', '--dry-run'], { DB_SSL_MODE: 'disable', CI: 'true' }); assert.equal(r.status, 1); assert.match(r.stderr, /DB_SSL_MODE=disable|CI=true/);
    r = mig(c, ['--env', 'staging', '--dry-run'], { LN_STUDIO_TEST_SESSION: '1' }); assert.equal(r.status, 1);
    r = mig(c, ['--env', 'staging', '--dry-run'], { DB_SSL_KEY_PEM: '' }); assert.equal(r.status, 2);
    writeFileSync(join(c.repo, 'infra/vertra/bindings.json'), JSON.stringify({ schema: 1, ambientes: { staging: { dbHost: null, dbName: null } } }));
    r = mig(c, ['--env', 'staging', '--dry-run']); assert.equal(r.status, 2); assert.match(r.stderr, /sem vínculo/);
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('migrate produção: exige confirmação e backup íntegro, fresco e do MESMO banco (hash conferido)', { skip }, () => {
  const c = setup();
  try {
    mkdirSync(join(c.repo, 'infra/scripts'), { recursive: true });
    for (const f of ['ci-checks.mjs', 'backup-freshness.mjs', 'verify-migrations.mjs']) writeFileSync(join(c.repo, 'infra/scripts', f), `import ${JSON.stringify('file:///' + join(S, f).replace(/\\/g, '/'))};`);
    writeFileSync(join(c.repo, 'package.json'), '{"name":"x"}');
    const prod = { APP_ENV: 'production', DATABASE_URL: URL_PRD };
    let r = mig(c, ['--env', 'production', '--dry-run'], prod); assert.equal(r.status, 2); assert.match(r.stderr, /--confirm-production/);
    r = mig(c, ['--env', 'production', '--confirm-production', '--dry-run'], prod); assert.equal(r.status, 1); assert.match(r.stderr, /backup de produção/); // sem backup
    // backup de PRODUÇÃO válido (gancho de teste é proibido em produção: gera-se um backup "staging" e re-rotula manualmente abaixo)
    assert.equal(backup(c).status, 0);
    const lp = join(c.dest, 'latest-staging.json'); const l = JSON.parse(readFileSync(lp, 'utf8'));
    const mp = join(c.dest, l.manifest); const m = JSON.parse(readFileSync(mp, 'utf8'));
    // um backup RECENTE do banco de STAGING não serve para produção
    writeFileSync(join(c.dest, 'latest-production.json'), JSON.stringify(l)); // aponta para manifesto de staging
    r = mig(c, ['--env', 'production', '--confirm-production', '--dry-run'], prod); assert.equal(r.status, 1, 'backup de outro banco/ambiente reprova');
    // backup de produção legítimo (como o job produziria): mesmo objeto, manifesto com env/source de produção
    const m2 = { ...m, env: 'production', source: { host: HOST_PRD, database: 'vertracloud' } };
    writeFileSync(join(c.dest, 'prod.manifest.json'), JSON.stringify(m2));
    writeFileSync(join(c.dest, 'latest-production.json'), JSON.stringify({ createdAt: m2.createdAt, file: m2.file, manifest: 'prod.manifest.json', encryptedSha256: m2.encryptedSha256 }));
    r = mig(c, ['--env', 'production', '--confirm-production', '--dry-run'], prod); assert.equal(r.status, 0, r.stderr + r.stdout);
    // objeto corrompido com mesmo tamanho: a migração (--verify-object) recusa
    const obj = join(c.dest, m2.file); const b = readFileSync(obj); const x = Buffer.from(b); x[x.length - 1] ^= 0xff; writeFileSync(obj, x);
    r = mig(c, ['--env', 'production', '--confirm-production', '--dry-run'], prod); assert.equal(r.status, 1); assert.match(r.stderr, /corrompido|backup de produção/);
    appendFileSync(join(c.root, 'sink'), '');
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});

test('restore-check recusa sem --scratch e alvo que seja o banco de qualquer ambiente registrado ou da origem', () => {
  const c = setup();
  const base = { ...cleanEnv(), BACKUP_DEST: tmpdir(), RESTORE_DB_SSL_CA_PEM: PEM, RESTORE_DB_SSL_CERT_PEM: PEM, RESTORE_DB_SSL_KEY_PEM: PEM };
  const run = (args, env) => spawnSync(process.execPath, [join(S, 'restore-check.mjs'), ...args], { encoding: 'utf8', cwd: c.repo, env });
  try {
    assert.equal(run(['--env', 'staging'], { ...base, RESTORE_DATABASE_URL: 'postgres://u:p@scratch.example/db' }).status, 2);
    let r = run(['--env', 'staging', '--scratch'], { ...base, RESTORE_DATABASE_URL: URL_PRD }); assert.equal(r.status, 2); assert.match(r.stderr, /banco de "production"/);
    r = run(['--env', 'staging', '--scratch'], { ...base, RESTORE_DATABASE_URL: URL_STG }); assert.equal(r.status, 2); assert.match(r.stderr, /banco de "staging"/);
    r = run(['--env', 'staging', '--scratch'], { ...base, RESTORE_DATABASE_URL: 'postgres://u:p@origem.example/db', DATABASE_URL: 'postgres://u:p@origem.example/db' }); assert.equal(r.status, 2); assert.match(r.stderr, /mesmo servidor/);
  } finally { rmSync(c.root, { recursive: true, force: true }); }
});
