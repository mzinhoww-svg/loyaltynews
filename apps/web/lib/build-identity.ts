import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Identidade do build servido: BUILD_ID do `.next` e, quando houver, o commit da marca da restauração. */
export interface BuildIdentity {
  buildId: string | null;
  /** Commit gravado em `.next/.ln-prebuilt.json`; null em pacote comum ou sem marca. */
  commit: string | null;
  /** true quando o `.next` tem a marca da restauração de um pré-construído. */
  prebuilt: boolean;
}

/**
 * Lê a identidade do build do diretório de execução. Aceita `root` explícito nos testes; em produção o cwd é `apps/web`
 * (o start-web sobe de dentro dele), mas o repositório também é aceito para os testes/smoke locais.
 */
export function readBuildIdentity(root: string = process.cwd()): BuildIdentity {
  const bases = [join(root, '.next'), join(root, 'apps', 'web', '.next')];
  const dir = bases.find((d) => existsSync(join(d, 'BUILD_ID'))) ?? null;
  const buildId = dir ? readFileSync(join(dir, 'BUILD_ID'), 'utf8').trim() : null;
  let commit: string | null = null;
  let prebuilt = false;
  for (const d of dir ? [dir] : bases) {
    const marca = join(d, '.ln-prebuilt.json');
    if (!existsSync(marca)) continue;
    prebuilt = true;
    try {
      const m = JSON.parse(readFileSync(marca, 'utf8')) as { commit?: unknown };
      commit = typeof m.commit === 'string' && m.commit.trim() ? m.commit.trim() : null;
    } catch {
      commit = null;
    }
    break;
  }
  return { buildId, commit, prebuilt };
}
