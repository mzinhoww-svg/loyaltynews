// Guarda do workflow .github/workflows/gate-marca.yml (texto, sem rodar o Actions): o que o UI/UX e o PM exigem
// fica fixo em teste. Espelha infra/tests/workflow-prebuilt.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bruto = readFileSync(join(RAIZ, '.github/workflows/gate-marca.yml'), 'utf8');
const linhas = bruto.split('\n');
const semComentariosDeLinha = linhas.filter((l) => !l.trim().startsWith('#')).join('\n');

test('gate-marca: sem CRLF, sem segredos, permissao so de leitura e concorrencia que cancela a rodada antiga', () => {
  assert.ok(!bruto.includes('\r'), 'CRLF no workflow');
  assert.ok(!/\$\{\{\s*secrets\./.test(bruto), 'secrets.* no workflow');
  assert.match(bruto, /^permissions:\n {2}contents: read\n/m);
  assert.ok(!/(contents|actions|id-token|packages|pull-requests): write/.test(bruto), 'permissao de escrita');
  assert.match(bruto, /^concurrency:\n {2}group: gate-marca-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true\n/m);
});

test('gate-marca: gatilhos PR + push na main + manual; nada de pull_request_target, schedule ou workflow_run', () => {
  assert.match(bruto, /^on:\n {2}workflow_dispatch:\n/m);
  assert.match(bruto, /^ {2}pull_request:\n {4}types: \[opened, synchronize, reopened\]$/m);
  assert.match(bruto, /^ {2}push:\n {4}branches: \[main\]$/m);
  assert.ok(!/pull_request_target|schedule:|workflow_run:/.test(semComentariosDeLinha), 'gatilho perigoso ou nao decidido');
});

test('gate-marca: as 3 actions fixadas por SHA de 40 caracteres, checkout sem credencial gravada', () => {
  const usos = linhas.filter((l) => /^\s*-?\s*uses:/.test(l));
  assert.equal(usos.length, 3);
  for (const u of usos) assert.match(u, /uses:\s+actions\/[a-z-]+@[0-9a-f]{40}\s+# v\d/, u);
  assert.match(bruto, /persist-credentials: false/);
});

test('gate-marca: Node lido da configuração da Vertra (nao fixado no YAML) e Chromium instalado com as dependencias de sistema', () => {
  assert.match(bruto, /require\('\.\/infra\/vertra\/environments\.json'\)\.runtime\.node/);
  assert.ok(!/node-version:\s*["']?v?\d+\.\d+\.\d+/.test(semComentariosDeLinha), 'versao de Node fixada no YAML');
  assert.match(bruto, /npx playwright install --with-deps chromium/);
});

test('gate-marca: roda o gate no script do repo, na porta combinada, e guarda o JSON como artefato mesmo em falha', () => {
  assert.match(bruto, /node apps\/web\/scripts\/gate-marca\.mjs --porta 3199/);
  assert.match(bruto, /path: \.test-results\/gate-marca\.json/);
  assert.match(bruto, /if: always\(\)/);
  assert.match(bruto, /retention-days: \d+/);
  assert.match(bruto, /runs-on: ubuntu-24\.04/);
  assert.match(bruto, /timeout-minutes: \d+/);
  // o caminho do artefato tem de ser o mesmo que o script escreve
  const script = readFileSync(join(RAIZ, 'apps/web/scripts/gate-marca.mjs'), 'utf8');
  assert.match(script, /join\(RAIZ, '\.test-results', 'gate-marca\.json'\)/);
});

test('gate-marca: nao atribui LN_FLAGS_ON nem PORTAL_SOURCE (o modo mock e do script, em runtime de teste)', () => {
  assert.ok(!/LN_FLAGS_ON\s*[:=]/.test(semComentariosDeLinha), 'LN_FLAGS_ON no workflow (ADR-022)');
  assert.ok(!/PORTAL_SOURCE\s*[:=]/.test(semComentariosDeLinha), 'PORTAL_SOURCE no workflow (variavel so de teste)');
  // o script e que liga o modo mock, no processo do servidor de vitrine
  const script = readFileSync(join(RAIZ, 'apps/web/scripts/gate-marca.mjs'), 'utf8');
  assert.match(script, /PORTAL_SOURCE: 'mock'/);
});
