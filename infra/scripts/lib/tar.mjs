// Caminho do `tar` para os scripts de pacote. No Windows, o `tar` do PATH pode ser o GNU do Git Bash (/usr/bin/tar), que lê `C:\...` como `host:caminho` remoto
// ("tar: Cannot connect to C: resolve failed") e não cria ZIP; o do sistema (bsdtar, %SystemRoot%\System32\tar.exe) entende `C:\` e `-a` (ZIP). Por isso, no win32, usa o do sistema
// POR CAMINHO ABSOLUTO (independe do shell de quem roda); nos demais sistemas fica `tar` do PATH.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Escolha pura: devolve o executável do tar para a plataforma e o ambiente dados. */
export function escolherTar({ plataforma = process.platform, env = process.env, existe = existsSync } = {}) {
  if (plataforma !== 'win32') return 'tar';
  const raiz = env.SystemRoot || env.SYSTEMROOT || env.windir || env.WINDIR;
  if (!raiz) return 'tar';
  const sistema = join(raiz, 'System32', 'tar.exe');
  return existe(sistema) ? sistema : 'tar';
}

export const TAR = escolherTar();
