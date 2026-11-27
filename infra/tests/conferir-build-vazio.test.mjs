// Passo 0 do go-live (item F do plano de 26/11): conferir-build-vazio.mjs recusa quando o build_command do app não é nulo ou o BUILD= do pacote não está vazio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { avaliar, buildCommandDe, buildVazio } from '../scripts/conferir-build-vazio.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'conferir-build-vazio.mjs');
const CMD = 'node infra/scripts/guard-env.mjs && npm run build -w apps/workers';
const APP = 'b5d0c8c8-7ba8-442c-bc8c-e3f2882aaf55';
const CHAVE = 'vc_live_teste_nao_vazar_123';

test('avaliar: nulo e vazio passam; comando preenchido e campo ausente recusam (falha fechada); envelope data aceito', () => {
  assert.equal(avaliar({ resposta: { build_command: null } }).ok, true);
  assert.equal(avaliar({ resposta: { build_command: '' } }).ok, true);
  assert.equal(avaliar({ resposta: { data: { build_command: null } } }).ok, true);
  assert.equal(avaliar({ resposta: { build_command: CMD } }).ok, false, 'controle negativo: comando preenchido');
  assert.equal(avaliar({ resposta: { nome: 'x' } }).ok, false, 'campo ausente não pode passar');
  assert.equal(buildCommandDe({ nome: 'x' }), undefined);
});

test('buildVazio: LF, CRLF, ausente e duplicado', () => {
  assert.ok(buildVazio('NAME=a\r\nBUILD=\r\nSTART=x\r\n'));
  assert.ok(!buildVazio('NAME=a'));
  assert.ok(!buildVazio('BUILD=\nBUILD='));
  assert.ok(!buildVazio(`BUILD=${CMD}`));
});

test('avaliar com --pacote: exige também BUILD= vazio no vertracloud.config', () => {
  assert.equal(avaliar({ resposta: { build_command: null }, config: 'NAME=a\nBUILD=\nSTART=x\n' }).ok, true);
  const r = avaliar({ resposta: { build_command: null }, config: `NAME=a\nBUILD=${CMD}\n` });
  assert.equal(r.ok, false);
  assert.deepEqual(r.provas.map((p) => p.ok), [true, false]);
});

const cli = (args, env) => new Promise((ok) => {
  const p = spawn(process.execPath, [SCRIPT, ...args], { env: { ...process.env, VERTRA_API_KEY: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '';
  p.stdout.on('data', (d) => { o += d; });
  p.stderr.on('data', (d) => { o += d; });
  p.on('close', (status) => ok({ status, saida: o }));
});

async function servidor(corpo, status = 200) {
  let auth = null;
  const s = createServer((req, res) => { auth = req.headers.authorization; res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(corpo)); });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { api: `http://127.0.0.1:${s.address().port}`, fechar: () => new Promise((r) => s.close(r)), auth: () => auth };
}

test('CLI: sem chave = 2; --api http externo recusado; nulo = 0; preenchido = 1; HTTP 401 = 1; a chave nunca aparece na saída', async () => {
  assert.equal((await cli(['--app', APP], {})).status, 2);
  assert.equal((await cli(['--app', APP, '--api', 'http://exemplo.com'], { VERTRA_API_KEY: CHAVE })).status, 2);
  const d = mkdtempSync(join(tmpdir(), 'ln-bv-'));
  try {
    const nulo = await servidor({ id: APP, build_command: null });
    try {
      const r = await cli(['--app', APP, '--api', nulo.api], { VERTRA_API_KEY: CHAVE });
      assert.equal(r.status, 0, r.saida);
      assert.equal(nulo.auth(), `Bearer ${CHAVE}`);
      assert.ok(!r.saida.includes(CHAVE));
      writeFileSync(join(d, 'vertracloud.config'), `NAME=a\nBUILD=${CMD}\n`);
      const p = await cli(['--app', APP, '--api', nulo.api, '--pacote', d], { VERTRA_API_KEY: CHAVE });
      assert.equal(p.status, 1, 'BUILD= preenchido no pacote recusa mesmo com o app nulo');
    } finally { await nulo.fechar(); }
    const cheio = await servidor({ data: { id: APP, build_command: CMD } });
    try {
      const r = await cli(['--app', APP, '--api', cheio.api], { VERTRA_API_KEY: CHAVE });
      assert.equal(r.status, 1);
      assert.match(r.saida, /"ok":false/);
      assert.ok(!r.saida.includes(CHAVE));
    } finally { await cheio.fechar(); }
    const negado = await servidor({ error: 'unauthorized' }, 401);
    try {
      const r = await cli(['--app', APP, '--api', negado.api], { VERTRA_API_KEY: CHAVE });
      assert.equal(r.status, 1);
      assert.match(r.saida, /HTTP 401/);
    } finally { await negado.fechar(); }
  } finally { rmSync(d, { recursive: true, force: true }); }
});
