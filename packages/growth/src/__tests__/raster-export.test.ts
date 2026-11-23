import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// O subcaminho `@ln/growth/raster` (rasterizador SVG→PNG do UI/UX, só Node, usa sharp) tem de estar no campo `exports` do pacote; sem ele quem importa
// recebe ERR_PACKAGE_PATH_NOT_EXPORTED (foi o que o QA 4 viu na branch do UI/UX isolada, que não tem este export). A entrada fica FORA do índice do
// pacote de propósito (o índice não importa sharp).
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('@ln/growth/raster está exportado pelo package.json', () => {
  test('exports tem ./raster apontando para o módulo do rasterizador (a forma de texto vale para import e para tipos: o TypeScript resolve o .ts)', () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG, 'package.json'), 'utf8')) as { exports: Record<string, string>; types?: string };
    assert.equal(pkg.exports['./raster'], './src/creative/raster.ts');
    assert.ok(Object.keys(pkg.exports).includes('.'), 'a raiz continua exportada');
  });

  test('o import pelo NOME DO PACOTE funciona (resolução do Node/Vite pelo campo exports) e traz a API do rasterizador', async () => {
    const m = await import('@ln/growth/raster');
    assert.equal(typeof m.rasterizeCreative, 'function');
    assert.equal(typeof m.rasterPixelSha256, 'function');
    assert.equal(typeof m.RasterRefusal, 'function');
    assert.equal(m.RASTER_MIME, 'image/png');
  });

  test('o índice do pacote NÃO reexporta o rasterizador (sharp só entra por este subcaminho)', async () => {
    const idx = (await import('@ln/growth')) as Record<string, unknown>;
    for (const name of ['rasterizeCreative', 'rasterPixelSha256', 'RasterRefusal']) assert.equal(name in idx, false, name);
  });

  test('resolução do PRÓPRIO Node (auto-referência do pacote, sem node_modules nem bundler): ./raster resolve; um subcaminho não exportado dá ERR_PACKAGE_PATH_NOT_EXPORTED', () => {
    const resolveIn = (spec: string) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', `try { console.log(import.meta.resolve(${JSON.stringify(spec)})); } catch (e) { console.log(e.code); }`], { cwd: PKG, encoding: 'utf8' }).stdout.trim();
    assert.match(resolveIn('@ln/growth/raster'), /^file:\/\/\/.*packages\/growth\/src\/creative\/raster\.ts$/);
    assert.equal(resolveIn('@ln/growth/src/creative/raster.ts'), 'ERR_PACKAGE_PATH_NOT_EXPORTED'); // o que o QA 4 viu quando o export faltava
    assert.equal(resolveIn('@ln/growth/mlabs/live-adapter.internal'), 'ERR_PACKAGE_PATH_NOT_EXPORTED'); // os módulos internos continuam fechados
  });
});
