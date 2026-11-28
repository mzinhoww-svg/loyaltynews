// Apoio dos testes do smoke-producao: repositório git temporário com um packages/contracts/src/flags.ts por commit.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function repoDeFlags(contratos) {
  const dir = mkdtempSync(join(tmpdir(), 'ln-repo-flags-'));
  const git = (...a) => {
    const r = spawnSync('git', ['-C', dir, '-c', 'user.name=teste', '-c', 'user.email=teste@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${a[0]}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '-q');
  mkdirSync(join(dir, 'packages', 'contracts', 'src'), { recursive: true });
  const commits = contratos.map((fonte, i) => {
    writeFileSync(join(dir, 'packages', 'contracts', 'src', 'flags.ts'), fonte);
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', `contrato ${i}`);
    return git('rev-parse', 'HEAD');
  });
  return { dir, commits, apagar: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Contrato mínimo com a lista dada. */
export const contratoCom = (lista) => `export const PRODUCTION_FLAGS_ON = ${JSON.stringify(lista)};\n`;
