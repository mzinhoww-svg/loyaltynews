// Os dados do benchmark de scraping (packages/scraping-benchmark/data: títulos e trechos de páginas de terceiros) não vão para servidor nenhum
// (parecer 64 da Security, 28/11). Nada em execução os lê; quem lê são as ferramentas e o teste do próprio benchmark, que rodam no repositório.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arquivosDoZip } from '../scripts/lib/zip.mjs';

const S = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scripts');
const RAIZ = join(S, '..', '..');
const FORA = 'packages/scraping-benchmark/data/';

test('o commit empacotado tem dados do benchmark (o teste abaixo não passa por falta deles)', () => {
  const r = spawnSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', FORA], { cwd: RAIZ, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.split('\n').filter(Boolean).length > 0, 'sem arquivos em ' + FORA);
});

for (const [app, perfil] of [['web', 'production'], ['web', 'staging'], ['workers', 'production'], ['workers', 'staging']]) {
  test(`pacote ${app} (${perfil}): 0 arquivos de ${FORA} no ZIP e na pasta; o código do benchmark continua`, () => {
    const out = mkdtempSync(join(tmpdir(), 'ln-semdados-'));
    try {
      const extra = app === 'web' ? ['--subdomain', perfil === 'production' ? 'loyaltynews' : 'loyaltynews-stg'] : ['--app', 'workers'];
      const r = spawnSync(process.execPath, [join(S, 'package-web.mjs'), '--repo', '.', '--commit', 'HEAD', '--out', out, '--profile', perfil, ...extra], { encoding: 'utf8', cwd: RAIZ });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const j = JSON.parse(r.stdout);
      const entradas = arquivosDoZip(j.zip).map((e) => (typeof e === 'string' ? e : e.name));
      assert.ok(entradas.length > 100, `lista do ZIP curta: ${entradas.length}`);
      assert.deepEqual(entradas.filter((f) => f.startsWith(FORA)), []);
      assert.ok(!existsSync(join(j.pasta, 'packages', 'scraping-benchmark', 'data')), 'a pasta de dados existe no pacote');
      assert.ok(entradas.includes('packages/scraping-benchmark/src/index.ts'), 'o código do benchmark (importado pela Fábrica) continua no pacote');
      assert.match(readFileSync(j.manifesto, 'utf8'), /scraping-benchmark\/data/);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
}
