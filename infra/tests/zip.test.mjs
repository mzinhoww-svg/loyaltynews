import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { arquivosDoZip, nomesDoZip } from '../scripts/lib/zip.mjs';

/** ZIP mínimo montado à mão: entradas (nome -> conteúdo sem compressão) + comentário opcional. Não depende de nenhuma ferramenta. */
function zipManual(entradas, comentario = '') {
  const locais = [];
  const centrais = [];
  let deslocamento = 0;
  for (const [nome, conteudo] of Object.entries(entradas)) {
    const n = Buffer.from(nome, 'utf8');
    const c = Buffer.from(conteudo);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(c.length, 18); local.writeUInt32LE(c.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(c.length, 20); central.writeUInt32LE(c.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(deslocamento, 42);
    locais.push(local, n, c);
    centrais.push(central, n);
    deslocamento += 30 + n.length + c.length;
  }
  const cen = Buffer.concat(centrais);
  const com = Buffer.from(comentario);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(entradas).length, 8); fim.writeUInt16LE(Object.keys(entradas).length, 10);
  fim.writeUInt32LE(cen.length, 12); fim.writeUInt32LE(deslocamento, 16); fim.writeUInt16LE(com.length, 20);
  return Buffer.concat([...locais, cen, fim, com]);
}

test('nomesDoZip: lê nomes (inclusive pastas e UTF-8) de um ZIP montado à mão', () => {
  const z = zipManual({ 'a/': '', 'a/b.txt': 'x', 'c.js': 'yy', 'ação.md': 'z' });
  assert.deepEqual(nomesDoZip(z), ['a/', 'a/b.txt', 'c.js', 'ação.md']);
});

test('nomesDoZip: acha o fim do arquivo mesmo com comentário de ZIP', () => {
  const z = zipManual({ 'um.txt': '1', 'dois.txt': '2' }, 'comentário qualquer do arquivo');
  assert.deepEqual(nomesDoZip(z), ['um.txt', 'dois.txt']);
});

test('nomesDoZip: ZIP vazio e entradas inválidas', () => {
  assert.deepEqual(nomesDoZip(zipManual({})), []);
  assert.throws(() => nomesDoZip(Buffer.from('isto não é um zip, só texto comprido o bastante')), /registro de fim/);
  assert.throws(() => nomesDoZip(Buffer.alloc(5)), /menor que/);
  const bom = zipManual({ 'a.txt': '1' });
  const quebrado = Buffer.from(bom);
  quebrado.writeUInt32LE(0xdeadbeef, quebrado.readUInt32LE(quebrado.length - 22 + 16)); // assinatura do diretório central estragada
  assert.throws(() => nomesDoZip(quebrado), /corrompida/);
  const zip64 = Buffer.from(bom);
  zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
  assert.throws(() => nomesDoZip(zip64), /ZIP64/);
});

test('arquivosDoZip: igual ao `git archive --format=zip` de um repositório de verdade (sem as pastas), sem usar tar', (t) => {
  const g = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (g.status !== 0) { t.skip('sem git'); return; }
  const d = mkdtempSync(join(tmpdir(), 'ln-zip-'));
  try {
    const git = (...a) => spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
    assert.equal(git('init', '-q').status, 0);
    mkdirSync(join(d, 'infra/scripts/lib'), { recursive: true });
    mkdirSync(join(d, 'apps/web/app/[...all]'), { recursive: true });
    const esperados = ['package.json', 'infra/scripts/lib/a.mjs', 'infra/scripts/b.mjs', 'apps/web/app/[...all]/route.ts'];
    for (const f of esperados) writeFileSync(join(d, f), `// ${f}\n`.repeat(50));
    assert.equal(git('add', '-A').status, 0);
    assert.equal(git('commit', '-q', '-m', 'x').status, 0);
    const zip = join(d, 'saida.zip');
    assert.equal(git('archive', '--format=zip', '-o', zip, 'HEAD').status, 0);
    const lidos = arquivosDoZip(zip);
    assert.deepEqual([...lidos].sort(), [...esperados].sort());
    assert.ok(nomesDoZip(readFileSync(zip)).some((n) => n.endsWith('/')), 'o git archive grava as pastas como entradas; arquivosDoZip as descarta');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

