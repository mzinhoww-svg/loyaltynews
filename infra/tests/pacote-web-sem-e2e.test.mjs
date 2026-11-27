// O pacote web deixa apps/web/e2e de fora. Nenhum arquivo que ENTRA no pacote pode importar de la: o typecheck do next build
// reprova com TS2307 (v16, 27/11: lib/e2e-ambiente-formularios.test.ts). Usa os mesmos pathspecs EXCLUDE do package-web.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('package-web: nada que entra no pacote importa apps/web/e2e', () => {
  const fonte = readFileSync(join(RAIZ, 'infra', 'scripts', 'package-web.mjs'), 'utf8');
  const linha = /^const EXCLUDE = \[(.*)\];$/m.exec(fonte);
  assert.ok(linha, 'linha EXCLUDE do package-web.mjs nao encontrada');
  const exclude = [...linha[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const dentro = execFileSync('git', ['-C', RAIZ, 'ls-files', '--', 'apps/web', ...exclude], { encoding: 'utf8' }).split('\n').filter((f) => /\.tsx?$/.test(f));
  assert.ok(dentro.length > 100, 'lista de arquivos do pacote vazia demais');
  const ruins = [];
  for (const f of dentro) {
    for (const m of readFileSync(join(RAIZ, f), 'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"\n]+)['"]/g)) {
      if (posix.join(posix.dirname(f), m[1]).startsWith('apps/web/e2e/')) ruins.push(`${f} -> ${m[1]}`);
    }
  }
  assert.deepEqual(ruins, []);
});
