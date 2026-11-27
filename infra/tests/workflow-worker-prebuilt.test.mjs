// Guarda do workflow .github/workflows/worker-prebuilt.yml (texto, sem rodar o Actions):
// gatilho unico, sem segredo, actions por SHA, ancestralidade e, o ponto do QA 10,
// o pacote feito pelo package-prebuilt.mjs --tipo workers do commit do workflow e conferido no runner (BUILD= vazio, manifesto = ZIP final).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bruto = readFileSync(join(RAIZ, '.github/workflows/worker-prebuilt.yml'), 'utf8');
const linhas = bruto.split('\n');

/** Linhas de comando (corpo dos blocos `run: |`), sem os comentarios de linha inteira. */
function linhasDeRun() {
  const out = [];
  let recuo = -1;
  for (const l of linhas) {
    const ind = l.length - l.trimStart().length;
    if (recuo >= 0) {
      if (l.trim() === '' || ind > recuo) { out.push(l); continue; }
      recuo = -1;
    }
    if (/^\s*run:\s*\|\s*$/.test(l)) recuo = ind;
  }
  return out;
}

test('workflow worker-prebuilt: sem CRLF, sem segredos, unico gatilho workflow_dispatch, permissao so de leitura', () => {
  assert.ok(!bruto.includes('\r'), 'CRLF no workflow');
  assert.ok(!/\$\{\{\s*secrets\./.test(bruto), 'secrets.* no workflow');
  assert.match(bruto, /^on:\n {2}workflow_dispatch:/m);
  assert.ok(!/^\s+(push|pull_request|pull_request_target|schedule|workflow_run):/m.test(bruto), 'gatilho alem de workflow_dispatch');
  assert.match(bruto, /^permissions:\n {2}contents: read\n/m);
  assert.ok(!/(contents|actions|id-token|packages|pull-requests): write/.test(bruto), 'permissao de escrita');
});

test('workflow worker-prebuilt: as 4 actions fixadas por SHA de 40 caracteres e checkouts sem credencial gravada', () => {
  const usos = linhas.filter((l) => /^\s*-?\s*uses:/.test(l));
  assert.equal(usos.length, 4);
  for (const u of usos) assert.match(u, /uses:\s+actions\/[a-z-]+@[0-9a-f]{40}\s+# v\d/, u);
  assert.equal((bruto.match(/persist-credentials: false/g) ?? []).length, 2, 'os dois checkouts sem credencial');
});

test('workflow worker-prebuilt: nada de ${{ }} dentro de run: (entradas so por env)', () => {
  for (const l of linhasDeRun()) assert.ok(!l.includes('${{'), `expressao em run: ${l.trim()}`);
});

test('workflow worker-prebuilt: producao exige commit ancestral da main ANTES do build', () => {
  assert.match(bruto, /fetch-depth: 0/);
  assert.match(bruto, /git fetch --no-tags origin main/);
  assert.match(bruto, /git merge-base --is-ancestor "\$LN_COMMIT" origin\/main/);
  assert.match(bruto, /RECUSADO: o commit .* nao e ancestral da main/);
  assert.ok(!/x-access-token|https:\/\/[^\s"']*@github\.com/.test(bruto), 'token na URL');
  const iAncestral = bruto.indexOf('merge-base --is-ancestor');
  const iNpm = bruto.indexOf('npm ci');
  const iBuild = bruto.indexOf('npm run build -w apps/workers');
  assert.ok(iAncestral > 0 && iAncestral < iNpm && iAncestral < iBuild, 'a conferencia vem antes do npm ci/build');
  assert.match(bruto, /if \[\[ "\$LN_PERFIL" == "production" \]\]; then/);
});

const iScript = bruto.indexOf('node ferramentas/infra/scripts/package-prebuilt.mjs --tipo workers');

test('workflow worker-prebuilt: o pacote sai do package-prebuilt.mjs --tipo workers do PROPRIO commit do workflow, depois do build', () => {
  assert.ok(iScript > 0, 'chamada ao package-prebuilt --tipo workers ausente');
  assert.match(bruto, /ref: \$\{\{ github\.sha \}\}\n {10}path: ferramentas\n/, 'ferramentas = checkout do commit do workflow');
  assert.ok(bruto.indexOf('path: ferramentas') < iScript, 'checkout das ferramentas antes da chamada');
  assert.ok(bruto.indexOf('npm run build -w apps/workers') < iScript, 'o dist tem de existir antes de empacotar');
  const linha = linhas.find((l) => l.includes('node ferramentas/infra/scripts/package-prebuilt.mjs'));
  for (const a of ['--pacote "$PASTA"', '--dist apps/workers/dist', '--out /tmp/prebuilt', '--origem "$LN_ORIGEM"']) assert.ok(linha.includes(a), `falta ${a}`);
  assert.ok(!bruto.includes("startsWith('BUILD=')"), 'sobrou o zeramento inline: a regra e do script (testada em prebuilt-workers.test.mjs)');
  assert.match(bruto, /path: \/tmp\/prebuilt\//, 'o artefato e o pacote pre-construido');
});

test('workflow worker-prebuilt: confere no runner BUILD= vazio e manifesto = sha256 do ZIP final (QA 10)', () => {
  const iGrep = bruto.indexOf("grep -qx 'BUILD='");
  const iSha = bruto.indexOf('sha256sum "$FINAL.zip"');
  const iCmp = bruto.indexOf('test "$SHA" = "$MAN"');
  assert.ok(iGrep > iScript && iSha > iScript && iCmp > iSha, 'conferencias depois do script, comparando manifesto e ZIP');
  assert.match(bruto, /zipSha256/);
  assert.match(bruto, /zip-sha256=\$SHA/);
});

test('workflow worker-prebuilt: build nulo sem passo manual (sem API/deploy)', () => {
  assert.ok(!/update_app_config|deploy_app|set_env|api\.vertracloud|vertracloud\.app/.test(bruto), 'passo manual/API na Vertra');
});
