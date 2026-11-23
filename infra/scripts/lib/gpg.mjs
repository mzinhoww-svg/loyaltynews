// Cifra e decifra dumps com GnuPG usando CHAVE PÚBLICA (ADR-012: a chave privada não fica no repositório
// nem no executor do backup; só quem restaura a possui).
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const GPG = process.env.GPG_BIN || (process.platform === 'win32' && existsSync('C:/Program Files/GnuPG/bin/gpg.exe') ? 'C:/Program Files/GnuPG/bin/gpg.exe' : 'gpg');

function gpg(args, home) {
  const env = { ...process.env };
  if (home) env.GNUPGHOME = home;
  const r = spawnSync(GPG, ['--batch', '--yes', '--no-tty', ...args], { env, encoding: 'utf8' });
  if (r.error) throw r.error;
  return r;
}

/** Importa uma chave pública ASCII-armored num chaveiro temporário e devolve a impressão digital. */
export function importPublicKey(armored, home, tmpDir) {
  const f = join(tmpDir, 'backup-public.asc');
  writeFileSync(f, armored, { mode: 0o600 });
  const r = gpg(['--import', f], home);
  if (r.status !== 0) throw new Error('falha ao importar a chave pública de backup');
  const l = gpg(['--with-colons', '--list-keys'], home);
  const fpr = (l.stdout.split('\n').find((x) => x.startsWith('fpr:')) || '').split(':')[9];
  if (!fpr) throw new Error('chave pública sem impressão digital');
  return fpr;
}

export function encryptFile(inPath, outPath, { recipient, home }) {
  const r = gpg(['--trust-model', 'always', '--recipient', recipient, '--output', outPath, '--encrypt', inPath], home);
  if (r.status !== 0) throw new Error('falha ao cifrar o dump');
}

export function decryptFile(inPath, outPath, { home }) {
  const r = gpg(['--output', outPath, '--decrypt', inPath], home);
  if (r.status !== 0) throw new Error('falha ao decifrar (chave privada ausente ou arquivo corrompido)');
}
