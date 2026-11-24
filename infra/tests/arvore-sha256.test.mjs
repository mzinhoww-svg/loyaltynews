import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { listarArquivos, somaArvore } from '../scripts/arvore-sha256.mjs';

function pasta() {
  const d = mkdtempSync(join(tmpdir(), 'ln-arvore-'));
  mkdirSync(join(d, 'B', 'sub'), { recursive: true });
  mkdirSync(join(d, 'a-b'), { recursive: true });
  writeFileSync(join(d, 'z.txt'), 'z');
  writeFileSync(join(d, 'A.txt'), 'A');
  writeFileSync(join(d, 'a_b.txt'), 'ab');
  writeFileSync(join(d, 'B', 'sub', 'x.json'), '{}');
  writeFileSync(join(d, 'a-b', 'y.js'), 'y');
  return d;
}

test('arvore-sha256: ordem por bytes (maiúsculas antes das minúsculas, "-" antes de "_"), caminhos com ./', () => {
  const d = pasta();
  try {
    assert.deepEqual(listarArquivos(d), ['./A.txt', './B/sub/x.json', './a-b/y.js', './a_b.txt', './z.txt']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('arvore-sha256: é estável e muda com o conteúdo', () => {
  const d = pasta();
  try {
    const s1 = somaArvore(d);
    assert.match(s1, /^[0-9a-f]{64}$/);
    assert.equal(somaArvore(d), s1);
    writeFileSync(join(d, 'z.txt'), 'outro');
    assert.notEqual(somaArvore(d), s1);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('arvore-sha256: igual ao pipeline do workflow (find | LC_ALL=C sort -z | sha256sum), quando o ambiente tem esses comandos', (t) => {
  const tem = spawnSync('sh', ['-c', 'command -v sha256sum && command -v sort && command -v xargs'], { encoding: 'utf8' });
  if (tem.status !== 0) { t.skip('sem sh/sha256sum neste ambiente'); return; }
  const d = pasta();
  try {
    // o sha256sum do Git for Windows marca o modo binário com " *"; o do Linux (runner) usa dois espaços: normaliza
    const r2 = spawnSync('sh', ['-c', "cd \"$0\" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sed 's/ [*]/  /' | sha256sum", d], { encoding: 'utf8' });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stdout.split(/\s+/)[0], somaArvore(d));
  } finally { rmSync(d, { recursive: true, force: true }); }
});
