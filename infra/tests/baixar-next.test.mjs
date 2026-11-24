// Testes do baixar-next-vertra.mjs com um servidor falso da API de arquivos da Vertra (formatos plausíveis; o formato REAL é conferido pela --sonda antes do download).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { baixar, nomeSeguro, normalizarListagem, normalizarConteudo, desembrulhar, formaDe } from '../scripts/baixar-next-vertra.mjs';
import { listarExternos } from '../scripts/lib/prebuilt.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const CHAVE = 'vc_live_' + 'c0ffee'.repeat(8);
const RAIZ = 'apps/web/.next';
const FONTE = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01, 0xff, 0xfe, 0x00, 0x10]); // binário com byte nulo

// árvore remota: caminho -> { dir: [{name, dir, size}] } ou { file: Buffer }
const arvore = () => ({
  [RAIZ]: { dir: [{ name: 'BUILD_ID', dir: false, size: 13 }, { name: 'server', dir: true }, { name: 'static', dir: true }, { name: 'cache', dir: true }, { name: 'node_modules', dir: true }, { name: 'trace', dir: false, size: 3 }] },
  [`${RAIZ}/BUILD_ID`]: { file: Buffer.from('BUILD_abc123\n') },
  [`${RAIZ}/trace`]: { file: Buffer.from('xxx') },
  [`${RAIZ}/server`]: { dir: [{ name: 'app', dir: true }, { name: '..', dir: false, size: 1 }, { name: 'a/b', dir: false, size: 1 }] },
  [`${RAIZ}/server/app`]: { dir: [{ name: 'index.html', dir: false, size: 7 }] },
  [`${RAIZ}/server/app/index.html`]: { file: Buffer.from('<html/>') },
  [`${RAIZ}/static`]: { dir: [{ name: 'media', dir: true }] },
  [`${RAIZ}/static/media`]: { dir: [{ name: 'f.woff2', dir: false, size: FONTE.length }] },
  [`${RAIZ}/static/media/f.woff2`]: { file: FONTE },
  [`${RAIZ}/cache`]: { dir: [{ name: 'grande.bin', dir: false, size: 9 }] },
  [`${RAIZ}/node_modules`]: { dir: [{ name: 'pg-0123456789abcdef', dir: true }, { name: '@s', dir: true }] },
  [`${RAIZ}/node_modules/@s`]: { dir: [{ name: 'x-0123456789abcdef', dir: true }] },
});

function servidor({ envelope = 'lista', limitarUma = false } = {}) {
  const t = arvore();
  const visto = { pedidos: [], semChave: 0, limitado: false };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    visto.pedidos.push(u.pathname + '?' + u.searchParams.get('path'));
    if (req.headers.authorization !== `Bearer ${CHAVE}`) { visto.semChave += 1; res.statusCode = 401; res.end('{"code":"UNAUTHORIZED"}'); return; }
    if (limitarUma && !visto.limitado && u.pathname.endsWith('/files/content')) { visto.limitado = true; res.statusCode = 429; res.setHeader('retry-after', '1'); res.end('{"code":"RATE_LIMIT_EXCEEDED","details":{"retry_after":1}}'); return; }
    const e = t[u.searchParams.get('path')];
    res.setHeader('content-type', 'application/json');
    if (!e) { res.statusCode = 404; res.end('{"code":"FILE_NOT_FOUND"}'); return; }
    if (u.pathname.endsWith('/files/content')) {
      if (!e.file) { res.statusCode = 400; res.end('{"code":"NOT_A_FILE"}'); return; }
      const bin = e.file.includes(0);
      const corpo = bin ? { content: e.file.toString('base64'), encoding: 'base64' } : { content: e.file.toString('utf8'), encoding: 'utf-8' };
      res.end(JSON.stringify(envelope === 'response' ? { response: corpo } : corpo));
    } else {
      const itens = e.dir.map((x) => (envelope === 'files' ? { name: x.name, is_dir: x.dir, size: x.size } : { name: x.name, type: x.dir ? 'dir' : 'file', size: x.size }));
      res.end(JSON.stringify(envelope === 'lista' ? itens : envelope === 'response' ? { response: { path: u.searchParams.get('path'), entries: itens } } : { files: itens }));
    }
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, visto, api: `http://127.0.0.1:${srv.address().port}` })));
}
const fecha = (s) => new Promise((r) => s.srv.close(r));

test('nomeSeguro: só nomes simples; recusa .., barras, dois-pontos, controle e vazio', () => {
  const barra = String.fromCharCode(92);
  for (const ok of ['BUILD_ID', 'pg-0123456789abcdef', 'index.html', '@s', '[doc].html']) assert.equal(nomeSeguro(ok), true, ok);
  for (const ruim of ['', '.', '..', 'a/b', `a${barra}b`, 'C:x', 'a..b', 'a\u0000b', 'a\nb']) assert.equal(nomeSeguro(ruim), false, JSON.stringify(ruim));
});

test('normalizarListagem: aceita array, { files }, { data: { items } } e is_dir/type; formato desconhecido lança só com NOMES de chaves', () => {
  assert.deepEqual(normalizarListagem([{ name: 'a', type: 'dir' }, { name: 'b', type: 'file', size: 3 }]), [{ nome: 'a', dir: true, tamanho: null }, { nome: 'b', dir: false, tamanho: 3 }]);
  assert.deepEqual(normalizarListagem({ files: [{ name: 'a', is_dir: true }] }), [{ nome: 'a', dir: true, tamanho: null }]);
  assert.deepEqual(normalizarListagem({ data: { items: [{ path: 'x/y/z.js', type: 'file', size: 1 }] } }), [{ nome: 'z.js', dir: false, tamanho: 1 }]);
  assert.throws(() => normalizarListagem({ segredo: 'valor-que-nao-deve-aparecer' }), (e) => /forma: {segredo:string}/.test(e.message) && !/valor-que-nao/.test(e.message));
});

test('normalizarConteudo: base64 vira bytes; utf-8 vira texto; corpo cru passa como veio', () => {
  assert.deepEqual(normalizarConteudo(Buffer.from(JSON.stringify({ content: FONTE.toString('base64'), encoding: 'base64' })), 'application/json'), FONTE);
  assert.equal(normalizarConteudo(Buffer.from(JSON.stringify({ content: 'olá', encoding: 'utf-8' })), 'application/json').toString('utf8'), 'olá');
  assert.equal(normalizarConteudo(Buffer.from('texto cru'), 'text/plain').toString(), 'texto cru');
});

for (const envelope of ['lista', 'files', 'response']) {
  test(`baixar (${envelope}): traz o .next sem cache/trace, binário íntegro, externos só como pastas vazias, recusa nome malicioso, retoma 429 e não vaza a chave`, async () => {
    const s = await servidor({ envelope, limitarUma: envelope === 'lista' });
    const dest = join(mkdtempSync(join(tmpdir(), 'ln-baixar-')), 'next');
    try {
      const rel = await baixar({ app: 'APP', destino: dest, raiz: RAIZ, api: s.api, rpm: 6000, concorrencia: 2, chave: CHAVE });
      assert.equal(readFileSync(join(dest, 'BUILD_ID'), 'utf8'), 'BUILD_abc123\n');
      assert.equal(readFileSync(join(dest, 'server/app/index.html'), 'utf8'), '<html/>');
      assert.deepEqual(readFileSync(join(dest, 'static/media/f.woff2')), FONTE, 'binário idêntico, byte a byte');
      assert.equal(existsSync(join(dest, 'cache')), false, 'cache fica de fora');
      assert.equal(existsSync(join(dest, 'trace')), false);
      assert.deepEqual(readdirSync(join(dest, 'node_modules')).sort(), ['@s', 'pg-0123456789abcdef']);
      assert.deepEqual(readdirSync(join(dest, 'node_modules/pg-0123456789abcdef')), [], 'externo = pasta vazia (a restauração recria o link)');
      assert.deepEqual(listarExternos(dest).map((x) => x.pacote).sort(), ['@s/x', 'pg']);
      assert.deepEqual(rel.externos.sort(), ['pg-0123456789abcdef', 'x-0123456789abcdef']);
      assert.equal(rel.binarios, 1);
      assert.equal(rel.arquivos, 3);
      assert.equal(rel.buildId, 'BUILD_abc123');
      assert.deepEqual(rel.ignorados.sort(), ['cache', 'trace']);
      assert.equal(rel.erros.filter((x) => /nome recusado/.test(x)).length, 2, 'os nomes ".." e "a/b" foram recusados');
      assert.equal(existsSync(join(dest, '..', 'evil')), false);
      assert.ok(!JSON.stringify(rel).includes(CHAVE), 'a chave não vai para o relatório');
      assert.ok(s.visto.pedidos.every((p) => !p.includes('cache')), 'nem listou a pasta de cache');
      if (envelope === 'lista') assert.equal(s.visto.limitado, true, 'passou por um 429 e repetiu');
    } finally { await fecha(s); rmSync(dirname(dest), { recursive: true, force: true }); }
  });
}

const cli = (args, env) => new Promise((ok) => { const p = spawn(process.execPath, [join(S, 'baixar-next-vertra.mjs'), ...args], { env: { ...process.env, VERTRA_API_KEY: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; }); p.on('close', (status) => ok({ status, saida: o })); });

test('CLI: sem VERTRA_API_KEY sai 2; --api sem https recusa; --sonda mostra só o formato e não vaza a chave; chave errada = erro sem eco', async () => {
  assert.equal((await cli(['--app', 'APP', '--dest', join(tmpdir(), 'x-nao-criar')], { VERTRA_API_KEY: '' })).status, 2);
  const http1 = await cli(['--app', 'APP', '--dest', join(tmpdir(), 'x-nao-criar'), '--api', 'http://exemplo.com'], { VERTRA_API_KEY: CHAVE });
  assert.equal(http1.status, 2);
  assert.match(http1.saida, /https/);
  const s = await servidor();
  try {
    const ok = await cli(['--app', 'APP', '--api', s.api, '--sonda'], { VERTRA_API_KEY: CHAVE });
    assert.equal(ok.status, 0, ok.saida);
    assert.match(ok.saida, /"sonda": true/);
    assert.match(ok.saida, /"texto":"BUILD_abc123"/);
    assert.ok(!ok.saida.includes(CHAVE), 'a chave nunca é impressa');
    const ruim = await cli(['--app', 'APP', '--api', s.api, '--sonda'], { VERTRA_API_KEY: 'vc_live_errada' });
    assert.notEqual(ruim.status, 0);
    assert.ok(!ruim.saida.includes('vc_live_errada'), 'nem a chave errada aparece');
    assert.match(ruim.saida, /HTTP 401/);
  } finally { await fecha(s); }
});

test('desembrulhar/normalizarListagem: o envelope { response } da API (caso real do PM em 24/11) em todas as formas plausíveis; a mensagem de erro mostra só a FORMA', () => {
  const itens = [{ name: 'a', type: 'dir' }, { name: 'b.js', type: 'file', size: 9 }];
  const esperado = [{ nome: 'a', dir: true, tamanho: null }, { nome: 'b.js', dir: false, tamanho: 9 }];
  for (const j of [
    { response: itens },
    { response: { entries: itens } },
    { response: { path: 'apps/web/.next', files: itens }, status: 'ok' },
    { response: { data: { items: itens } } },
    { response: JSON.stringify(itens) },
    { response: { response: itens } },
    { response: { diretorio: 'x', conteudo_da_pasta: itens } },
  ]) assert.deepEqual(normalizarListagem(j), esperado, formaDe(j));
  assert.deepEqual(normalizarListagem({ response: [] }), []);
  assert.deepEqual(normalizarListagem({ response: { files: [] } }), []);
  // não desembrulha quando há outra chave de dados ao lado; formas sem lista de entradas continuam erro, sem valores
  assert.deepEqual(desembrulhar({ response: 1, outra: 2 }), { response: 1, outra: 2 });
  assert.throws(() => normalizarListagem({ response: { quantidade: 3, nome: 'valor-secreto-123' } }), (e) => /forma: {response:{quantidade:number,nome:string}}/.test(e.message) && !/valor-secreto/.test(e.message));
  assert.equal(formaDe({ a: [{ b: 1 }], c: null }), '{a:[{b:number}],c:null}');
});

test('normalizarConteudo: desembrulha { response: { content, encoding } } e { response: "texto" }; arquivo JSON cru e texto cru passam intactos', () => {
  assert.deepEqual(normalizarConteudo(Buffer.from(JSON.stringify({ response: { content: FONTE.toString('base64'), encoding: 'base64' } })), 'application/json'), FONTE);
  assert.equal(normalizarConteudo(Buffer.from(JSON.stringify({ response: { content: 'olá', encoding: 'utf-8' }, status: 'ok' })), 'application/json').toString('utf8'), 'olá');
  assert.equal(normalizarConteudo(Buffer.from(JSON.stringify({ response: 'texto do arquivo' })), 'application/json').toString('utf8'), 'texto do arquivo');
  const json = Buffer.from('{"version":1,"routes":["a"]}');
  assert.deepEqual(normalizarConteudo(json, 'application/json'), json, 'um .json cru sem envelope não é reescrito');
  const jsonEmTexto = Buffer.from(JSON.stringify({ response: { content: '{"version":1}', encoding: 'utf-8' } }));
  assert.equal(normalizarConteudo(jsonEmTexto, 'application/json').toString('utf8'), '{"version":1}', 'o conteúdo de um .json NÃO é reaberto como envelope');
});
