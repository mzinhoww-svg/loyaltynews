// O pacote que vai para a Vertra tem de ser AUTOSSUFICIENTE: todo import relativo dos scripts que a Vertra roda (guard-env, build-web, start-web) tem de resolver DENTRO da pasta do pacote.
// Origem (24/11/2026): o lib/prebuilt.mjs passou a importar ./tar.mjs (int/028) e o tar.mjs não estava no INCLUDE do package-web nem no OVERLAY do package-prebuilt: o start-web do pacote morria com
// ERR_MODULE_NOT_FOUND (achado pelo ensaio-pacote; nenhum teste olhava o pacote montado, só a árvore do repositório).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const RAIZ = join(S, '..', '..');
const ENTRADAS = ['infra/scripts/guard-env.mjs', 'infra/scripts/build-web.mjs', 'infra/scripts/start-web.mjs'];
const IMPORT_RELATIVO = /(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

/** Fecho dos imports relativos a partir das entradas, dentro de `pasta`. Devolve { visitados, faltando: [{de, import}] }. */
export function fechoDeImports(pasta, entradas) {
  const visitados = new Set();
  const faltando = [];
  const fila = [...entradas];
  while (fila.length) {
    const rel = fila.shift();
    if (visitados.has(rel)) continue;
    visitados.add(rel);
    const arq = join(pasta, rel);
    if (!existsSync(arq)) { faltando.push({ de: '(entrada)', import: rel }); continue; }
    const txt = readFileSync(arq, 'utf8');
    for (const m of txt.matchAll(IMPORT_RELATIVO)) {
      const alvo = (m[1] ?? m[2]).split('?')[0];
      const resolvido = resolve(dirname(arq), alvo);
      const relAlvo = resolvido.slice(resolve(pasta).length + 1).split('\\').join('/');
      if (!existsSync(resolvido)) faltando.push({ de: rel, import: relAlvo });
      else if (/\.[cm]?js$/.test(relAlvo)) fila.push(relAlvo);
    }
  }
  return { visitados: [...visitados], faltando };
}

test('fechoDeImports: acha import relativo que não existe no pacote', () => {
  const d = mkdtempSync(join(tmpdir(), 'ln-imp-'));
  try {
    cpSync(join(RAIZ, 'infra', 'scripts'), join(d, 'infra', 'scripts'), { recursive: true });
    assert.deepEqual(fechoDeImports(d, ENTRADAS).faltando, [], 'a árvore do repositório está completa');
    rmSync(join(d, 'infra', 'scripts', 'lib', 'tar.mjs'));
    const r = fechoDeImports(d, ENTRADAS);
    assert.ok(r.faltando.some((f) => f.import === 'infra/scripts/lib/tar.mjs' && f.de === 'infra/scripts/lib/prebuilt.mjs'), JSON.stringify(r.faltando));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('pacote do web (staging e produção, montado de verdade): todos os imports dos scripts de guard, build e start resolvem DENTRO do pacote', () => {
  const out = mkdtempSync(join(tmpdir(), 'ln-pkgimp-'));
  try {
    for (const [perfil, sub] of [['production', 'loyaltynews'], ['staging', 'loyaltynews-stg']]) {
      const r = spawnSync(process.execPath, [join(S, 'package-web.mjs'), '--repo', '.', '--commit', 'HEAD', '--out', join(out, perfil), '--profile', perfil, '--subdomain', sub], { encoding: 'utf8', cwd: RAIZ });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const pasta = JSON.parse(r.stdout).pasta;
      const { faltando, visitados } = fechoDeImports(pasta, ENTRADAS);
      assert.deepEqual(faltando, [], `${perfil}: ${JSON.stringify(faltando)}`);
      assert.ok(visitados.includes('infra/scripts/lib/tar.mjs'), `${perfil}: o fecho passa por lib/tar.mjs (via lib/prebuilt.mjs)`);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('pacote pré-construído: o OVERLAY do package-prebuilt cobre tudo que start-web.mjs e lib/prebuilt.mjs importam (o overlay sobrepõe esses arquivos no pacote)', () => {
  const src = readFileSync(join(S, 'package-prebuilt.mjs'), 'utf8');
  const m = src.match(/const OVERLAY = \[([^\]]+)\]/);
  assert.ok(m, 'OVERLAY não encontrado');
  const nomes = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((n) => n.endsWith('.mjs'));
  assert.ok(nomes.includes('start-web.mjs') && nomes.includes('prebuilt.mjs') && nomes.includes('tar.mjs'), `OVERLAY=${nomes.join(',')}`);
  // pacote simulado: só o que o package-web leva + o overlay copiado da árvore de ferramentas
  const out = mkdtempSync(join(tmpdir(), 'ln-ovl-'));
  try {
    const r = spawnSync(process.execPath, [join(S, 'package-web.mjs'), '--repo', '.', '--commit', 'HEAD', '--out', out, '--profile', 'production', '--subdomain', 'loyaltynews'], { encoding: 'utf8', cwd: RAIZ });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const pasta = JSON.parse(r.stdout).pasta;
    for (const n of nomes) cpSync(join(S, n === 'start-web.mjs' ? 'start-web.mjs' : join('lib', n)), join(pasta, 'infra', 'scripts', n === 'start-web.mjs' ? 'start-web.mjs' : join('lib', n)));
    assert.deepEqual(fechoDeImports(pasta, ENTRADAS).faltando, []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
