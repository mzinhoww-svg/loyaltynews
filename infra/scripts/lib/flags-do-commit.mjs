// PRODUCTION_FLAGS_ON do contrato DO COMMIT publicado (objeto do git, nunca a pasta de trabalho). Só leitura, sem rede.
// A lista fica presa ao SHA: quem roda o smoke não informa flag à mão. Falha fechada: sem SHA, commit ausente no repositório ou
// contrato inválido lança erro. Contrato anterior à DP-57 (sem a lista): [] (o mesmo critério do package-web e da prova-flags-producao).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Raiz do checkout que contém este script. */
export const REPO_DO_SCRIPT = fileURLToPath(new URL('../../../', import.meta.url));

export async function flagsDoCommit({ repo = REPO_DO_SCRIPT, commit }) {
  if (!/^[0-9a-f]{40}$/.test(String(commit ?? ''))) throw new Error('sem o SHA de 40 caracteres do commit publicado (--expect-commit)');
  const r = spawnSync('git', ['--no-replace-objects', '-C', repo, 'show', `${commit}:packages/contracts/src/flags.ts`], { maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error('não li packages/contracts/src/flags.ts do commit neste repositório (faça git fetch ou aponte --repo)');
  const dir = mkdtempSync(join(tmpdir(), 'ln-smoke-flags-'));
  try {
    const arq = join(dir, 'flags.ts');
    writeFileSync(arq, r.stdout);
    let m;
    try { m = await import(pathToFileURL(arq).href); } catch (e) { throw new Error(`o flags.ts do commit não carrega (${String(e?.name ?? 'Erro')})`, { cause: e }); }
    if (!Array.isArray(m.PRODUCTION_FLAGS_ON)) return [];
    // a mesma validação do resolvedor: nome conhecido e decisão registrada para production
    if (typeof m.productionFlagsByCommit === 'function') m.productionFlagsByCommit(m.PRODUCTION_FLAGS_ON);
    return [...new Set(m.PRODUCTION_FLAGS_ON.map(String))].sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
