import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { escolherTar } from '../scripts/lib/tar.mjs';

const RAIZ = 'C:/Windows'; // o join do próprio teste normaliza o separador na plataforma em que roda

test('escolherTar: fora do Windows usa o tar do PATH', () => {
  assert.equal(escolherTar({ plataforma: 'linux', env: { SystemRoot: RAIZ }, existe: () => true }), 'tar');
  assert.equal(escolherTar({ plataforma: 'darwin', env: {}, existe: () => true }), 'tar');
});

test('escolherTar: no Windows usa o tar.exe do sistema por caminho absoluto (não o GNU do Git Bash)', () => {
  const t = escolherTar({ plataforma: 'win32', env: { SystemRoot: RAIZ }, existe: () => true });
  assert.equal(t, join(RAIZ, 'System32', 'tar.exe'));
  assert.match(t, /System32[\\/]tar\.exe$/);
});

test('escolherTar: no Windows sem o tar.exe ou sem SystemRoot cai para o tar do PATH', () => {
  assert.equal(escolherTar({ plataforma: 'win32', env: { SystemRoot: RAIZ }, existe: () => false }), 'tar');
  assert.equal(escolherTar({ plataforma: 'win32', env: {}, existe: () => true }), 'tar');
});

test('escolherTar: usa o SystemRoot do ambiente, em qualquer caixa (windir como reserva)', () => {
  assert.equal(escolherTar({ plataforma: 'win32', env: { windir: RAIZ }, existe: () => true }), join(RAIZ, 'System32', 'tar.exe'));
});
