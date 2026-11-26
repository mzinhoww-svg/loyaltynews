// Guarda do workflow .github/workflows/worker-prebuilt.yml (texto, sem rodar o Actions):
// gatilho unico, sem segredo, actions por SHA, ancestralidade e, o ponto do QA 10,
// o BUILD= do vertracloud.config zerado ANTES do ZIP e o manifesto do ZIP FINAL depois dele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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

test('workflow worker-prebuilt: as 3 actions fixadas por SHA de 40 caracteres e checkout sem credencial gravada', () => {
  const usos = linhas.filter((l) => /^\s*-?\s*uses:/.test(l));
  assert.equal(usos.length, 3);
  for (const u of usos) assert.match(u, /uses:\s+actions\/[a-z-]+@[0-9a-f]{40}\s+# v\d/, u);
  assert.match(bruto, /persist-credentials: false/);
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

test('workflow worker-prebuilt: zera o BUILD= do vertracloud.config ANTES do ZIP (QA 10)', () => {
  const iBuild = bruto.indexOf("startsWith('BUILD=')");
  const iZip = bruto.indexOf('zip -q -r -X');
  assert.ok(iBuild > 0, 'passo que zera o BUILD= ausente');
  assert.ok(iZip > iBuild, 'o BUILD= tem de ser zerado antes de criar o ZIP');
  assert.match(bruto, /vertracloud\.config/);
});

test('workflow worker-prebuilt: o codigo do passo zera BUILD= de verdade (falha se a linha voltar)', () => {
  const linha = linhas.find((l) => l.includes("startsWith('BUILD=')"));
  assert.ok(linha, 'linha que zera o BUILD= ausente');
  const m = linha.match(/node -e "(.*)"\s*$/);
  assert.ok(m, 'node -e do passo nao encontrado');
  const d = mkdtempSync(join(tmpdir(), 'ln-wf-worker-'));
  try {
    writeFileSync(join(d, 'vertracloud.config'), 'BUILD=node infra/scripts/guard-env.mjs && npm run build -w apps/workers\nOTHER=1\n');
    writeFileSync(join(d, 'release.json'), '{}\n');
    const r = spawnSync(process.execPath, ['-e', m[1]], { env: { ...process.env, PASTA: d }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const cfg = readFileSync(join(d, 'vertracloud.config'), 'utf8');
    assert.match(cfg, /^BUILD=$/m, 'BUILD= deveria sair vazio');
    assert.ok(!/^BUILD=node/m.test(cfg), 'BUILD= com comando (a Vertra reconstruiria)');
    assert.match(cfg, /^OTHER=1$/m);
    const rel = JSON.parse(readFileSync(join(d, 'release.json'), 'utf8'));
    assert.equal(rel.prebuilt, true);
    assert.equal(rel.buildCommandVazio, true);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('workflow worker-prebuilt: manifesto com zipSha256/lista do ZIP FINAL, depois do ZIP', () => {
  const iZip = bruto.indexOf('zip -q -r -X');
  const iSha = bruto.indexOf('zipSha256=');
  const iFiles = bruto.indexOf('zipFiles');
  assert.ok(iZip > 0, 'passo do ZIP ausente');
  assert.ok(iSha > iZip, 'zipSha256 tem de ser medido depois do ZIP final');
  assert.ok(iFiles > iZip, 'lista do ZIP final tem de ser gerada depois do ZIP');
  assert.match(bruto, /arquivosDoZip/);
  assert.match(bruto, /arquivos: files\.length/);
  assert.match(bruto, /zipBytes: statSync\(zip\)\.size/);
});

test('workflow worker-prebuilt: build nulo sem passo manual (sem API/deploy) e manifesto declara buildCommand vazio', () => {
  assert.ok(!/update_app_config|deploy_app|set_env|api\.vertracloud|vertracloud\.app/.test(bruto), 'passo manual/API na Vertra');
  assert.match(bruto, /man\.buildCommand = '\(vazio\)'/);
  assert.match(bruto, /man\.buildCommandVazio = true/);
});
