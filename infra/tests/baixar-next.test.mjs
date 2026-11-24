// Testes do baixar-next-vertra.mjs com um servidor falso da API de arquivos da Vertra (formatos plausíveis; o formato REAL é conferido pela --sonda antes do download).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { baixar, nomeSeguro, normalizarListagem, normalizarConteudo, desembrulhar, formaDe, tamanhoDe, decodificarLeitura, medir, estatistica, PADRAO_EXCLUIDO } from '../scripts/baixar-next-vertra.mjs';
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
      if (envelope === 'real') { res.end(JSON.stringify({ response: { type: 'base64', data: e.file.toString('base64'), size: e.file.length, last_modified: '2026-11-24T16:06:17Z' } })); return; } // forma medida pela sonda do PM (24/11): até texto vem em base64
      const corpo = bin ? { content: e.file.toString('base64'), encoding: 'base64' } : { content: e.file.toString('utf8'), encoding: 'utf-8' };
      res.end(JSON.stringify(envelope === 'response' ? { response: corpo } : corpo));
    } else {
      if (envelope === 'real') { res.end(JSON.stringify({ response: e.dir.map((x) => ({ name: x.name, path: `${u.searchParams.get('path')}/${x.name}`, type: x.dir ? 'directory' : 'file', last_modified: '2026-11-24T16:06:17Z', size: x.dir ? '' : String(x.size) })) })); return; }
      const itens = e.dir.map((x) => (envelope === 'files' ? { name: x.name, is_dir: x.dir, size: x.size } : { name: x.name, type: x.dir ? 'dir' : 'file', size: x.size }));
      res.end(JSON.stringify(envelope === 'lista' ? itens : envelope === 'response' ? { response: { path: u.searchParams.get('path'), entries: itens } } : { files: itens }));
    }
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, visto, api: `http://127.0.0.1:${srv.address().port}` })));
}
const fecha = (s) => new Promise((r) => s.srv.close(r));

test('nomeSeguro: aceita os segmentos REAIS do App Router (catch-all [...x], [[...x]], (grupo), @slot, _privado, rotas interceptadas (..)x); recusa .., só pontos, barras, dois-pontos, controle, ponto/espaço no fim e vazio', () => {
  const barra = String.fromCharCode(92);
  const reais = ['BUILD_ID', 'pg-0123456789abcdef', 'index.html', '@s', '[doc].html', '[...all]', '[...path]', '[[...slug]]', '[id]', '[slug]', '(portal)', '(protegido)', '(grupo)', '@modal', '_privado', '_components', '(.)foto', '(..)foto', '(...)foto', '(..)(..)foto', 'route.js', 'page_client-reference-manifest.js', 'a..b', '0abc.js', '$x'];
  for (const ok of reais) assert.equal(nomeSeguro(ok), true, ok);
  for (const ruim of ['', '.', '..', '...', '....', 'a/b', '../x', '..' + barra + 'x', 'a' + barra + 'b', 'C:x', 'a:b', 'x.', 'x ', 'a\u0000b', 'a\nb', 'a'.repeat(256)]) assert.equal(nomeSeguro(ruim), false, JSON.stringify(ruim));
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

for (const envelope of ['lista', 'files', 'response', 'real']) {
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

test('FORMA REAL medida pela sonda do PM em 24/11 (listagem { response: [{ name, path, type, last_modified, size: string }] } e leitura { response: { type: "base64", data, size: number, last_modified } }): lê tamanho em texto e decodifica o data', () => {
  const lista = { response: [{ name: 'BUILD_ID', path: 'apps/web/.next/BUILD_ID', type: 'file', last_modified: '2026-11-24T16:06:17Z', size: '21' }, { name: 'server', path: 'apps/web/.next/server', type: 'directory', last_modified: '2026-11-24T16:06:17Z', size: '' }, { name: 'x.js', path: 'apps/web/.next/x.js', type: 'file', last_modified: 'a', size: '1.2 KB' }] };
  assert.deepEqual(normalizarListagem(lista), [{ nome: 'BUILD_ID', dir: false, tamanho: 21 }, { nome: 'server', dir: true, tamanho: null }, { nome: 'x.js', dir: false, tamanho: null }]);
  const id = 'abcdefghijklmnopqrstu'; // 21 bytes
  const leitura = (data, size, type = 'base64') => Buffer.from(JSON.stringify({ response: { type, data, size, last_modified: '2026-11-24T16:06:17Z' } }));
  const bruto = normalizarConteudo(leitura(Buffer.from(id).toString('base64'), 21), 'application/json');
  assert.equal(bruto.toString('utf8'), id, 'BUILD_ID de 21 bytes (antes saía o envelope de 121 bytes)');
  assert.deepEqual(normalizarConteudo(leitura(FONTE.toString('base64'), FONTE.length), 'application/json'), FONTE, 'binário idêntico');
  assert.equal(normalizarConteudo(leitura('olá', 4, 'text'), 'application/json').toString('utf8'), 'olá', 'texto: o size conta bytes (4)');
  assert.equal(normalizarConteudo(leitura('olá', 3, 'text'), 'application/json').toString('utf8'), 'olá', 'texto: o size pode contar caracteres (3)');
});

test('decodificarLeitura/tamanhoDe: o size declarado é CONFERIDO (tamanho errado, tipo desconhecido sem size e base64 corrompido lançam, sem eco do conteúdo); tipo desconhecido só passa se o size resolver', () => {
  assert.equal(tamanhoDe(21), 21);
  assert.equal(tamanhoDe('21'), 21);
  assert.equal(tamanhoDe('21 B'), 21);
  for (const ruim of ['', '1.2 KB', '12 KB', 'x', null, undefined, -1, NaN, '1e3']) assert.equal(tamanhoDe(ruim), null, String(ruim));
  assert.throws(() => decodificarLeitura(FONTE.toString('base64'), 'base64', FONTE.length + 1), /tamanho diferente do declarado .type base64, size 11, veio 10./);
  assert.throws(() => decodificarLeitura('segredo-no-corpo', 'base64', 2), (e) => !/segredo-no-corpo/.test(e.message));
  assert.throws(() => decodificarLeitura('AAAA', 'misterio', undefined), /tipo de conteúdo desconhecido sem size/);
  assert.deepEqual(decodificarLeitura(FONTE.toString('base64'), 'misterio', FONTE.length), FONTE, 'tipo desconhecido resolvido pelo size (base64)');
  assert.equal(decodificarLeitura('abc', 'misterio', 3).toString(), 'abc', 'tipo desconhecido resolvido pelo size (texto de 3 bytes que não é base64 de 3 bytes)');
  assert.throws(() => decodificarLeitura('abc', 'misterio', 99), /não confere/);
  assert.throws(() => normalizarConteudo(Buffer.from(JSON.stringify({ response: { type: 'base64', data: 'QUJD', size: 99 } })), 'application/json'), /tamanho diferente do declarado/, 'um arquivo com tamanho errado vira ERRO do arquivo, nunca bytes errados');
});

test('baixar: pastas e arquivos andam EM PARALELO numa fila única (a API real demora ~segundos por pedido): com 16 em paralelo há >= 8 pedidos simultâneos, nada se perde e o arquivo de progresso é gravado', async () => {
  const PASTAS = 6, POR_PASTA = 25;
  let simultaneos = 0, maximo = 0;
  const srv = http.createServer((req, res) => {
    simultaneos += 1; maximo = Math.max(maximo, simultaneos);
    const u = new URL(req.url, 'http://x');
    const caminho = u.searchParams.get('path');
    setTimeout(() => {
      simultaneos -= 1;
      res.setHeader('content-type', 'application/json');
      if (u.pathname.endsWith('/files/content')) { const corpo = Buffer.from(`conteudo de ${caminho}`); res.end(JSON.stringify({ response: { type: 'base64', data: corpo.toString('base64'), size: corpo.length, last_modified: 'x' } })); return; }
      if (caminho === RAIZ) { res.end(JSON.stringify({ response: Array.from({ length: PASTAS }, (_, i) => ({ name: `p${i}`, path: `${RAIZ}/p${i}`, type: 'directory', last_modified: 'x', size: '' })) })); return; }
      res.end(JSON.stringify({ response: Array.from({ length: POR_PASTA }, (_, i) => { const t = `conteudo de ${caminho}/f${i}.js`.length; return { name: `f${i}.js`, path: `${caminho}/f${i}.js`, type: 'file', last_modified: 'x', size: String(t) }; }) }));
    }, 60);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = mkdtempSync(join(tmpdir(), 'ln-baixar-par-'));
  const dest = join(base, 'next');
  const progresso = join(base, 'progresso.json');
  try {
    const t0 = Date.now();
    const rel = await baixar({ app: 'APP', destino: dest, raiz: RAIZ, api: `http://127.0.0.1:${srv.address().port}`, rpm: 60000, concorrencia: 16, chave: CHAVE, progresso });
    const ms = Date.now() - t0;
    assert.deepEqual(rel.erros, []);
    assert.equal(rel.arquivos, PASTAS * POR_PASTA);
    assert.ok(maximo >= 8, `pedidos simultâneos: ${maximo}`);
    assert.ok(ms < 3000, `150 arquivos + 7 listagens em ${ms} ms com 60 ms por pedido (sequencial levaria > 9 s)`);
    assert.equal(readFileSync(join(dest, 'p3', 'f7.js'), 'utf8'), `conteudo de ${RAIZ}/p3/f7.js`);
    const p = JSON.parse(readFileSync(progresso, 'utf8'));
    assert.equal(p.baixados, PASTAS * POR_PASTA);
    assert.equal(p.erros, 0);
    assert.ok(!JSON.stringify(p).includes(CHAVE));
  } finally { await fecha({ srv }); rmSync(base, { recursive: true, force: true }); }
});

function servidorGenerico(arvoreFlat, { latenciaMs = 0 } = {}) {
  // arvoreFlat: { 'dir/relativo': ['arq', ...] ; '': ['nomeDeDir/'...] } montado pelo teste
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const caminho = u.searchParams.get('path');
    setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      if (u.pathname.endsWith('/files/content')) { const c = Buffer.from('c:' + caminho); res.end(JSON.stringify({ response: { type: 'base64', data: c.toString('base64'), size: c.length, last_modified: 'x' } })); return; }
      const itens = arvoreFlat[caminho];
      if (!itens) { res.statusCode = 404; res.end('{"code":"NOT_FOUND"}'); return; }
      res.end(JSON.stringify({ response: itens.map((n) => (n.endsWith('/') ? { name: n.slice(0, -1), path: caminho + '/' + n.slice(0, -1), type: 'directory', last_modified: 'x', size: '' } : { name: n, path: caminho + '/' + n, type: 'file', last_modified: 'x', size: String(('c:' + caminho + '/' + n).length) })) }));
    }, typeof latenciaMs === 'function' ? latenciaMs(caminho, u.pathname) : latenciaMs);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, api: 'http://127.0.0.1:' + srv.address().port })));
}

test('estatistica e PADRAO_EXCLUIDO: p50/p95 de uma lista de tempos; o padrão pega *.map e *.nft.json e nada além', () => {
  assert.deepEqual(estatistica([]), { n: 0, p50: null, p95: null, max: null, media: null });
  const e = estatistica([10, 20, 30, 40, 100]);
  assert.deepEqual({ n: e.n, p50: e.p50, max: e.max, media: e.media }, { n: 5, p50: 30, max: 100, media: 40 });
  for (const sim of ['a.js.map', 'x.nft.json', 'page.js.nft.json', 'chunk_1234.js.map', 'next-server.js.nft.json']) assert.equal(PADRAO_EXCLUIDO.test(sim), true, sim);
  for (const nao of ['a.js', 'routes-manifest.json', 'build-manifest.json', 'BUILD_ID', 'page.rsc', 'mapa.json', 'nft.json.js', 'index.html', 'app-path-routes-manifest.json', 'map']) assert.equal(PADRAO_EXCLUIDO.test(nao), false, nao);
});

test('baixar: *.map e *.nft.json ficam de fora por padrão (o next start não os usa; ~36% dos arquivos) e entram com incluirTudo; a contagem aparece no relatório', async () => {
  const flat = { [RAIZ]: ['BUILD_ID', 'server/', 'routes-manifest.json', 'next-server.js.nft.json'], [RAIZ + '/server']: ['a.js', 'a.js.map', 'b.js', 'b.js.map', 'page.js.nft.json', 'index.html'] };
  const s = await servidorGenerico(flat);
  const base = mkdtempSync(join(tmpdir(), 'ln-baixar-excl-'));
  try {
    const rel = await baixar({ app: 'APP', destino: join(base, 'a'), raiz: RAIZ, api: s.api, rpm: 60000, concorrencia: 4, chave: CHAVE });
    assert.deepEqual(rel.erros, []);
    assert.equal(rel.excluidosPorPadrao, 4, '2 .map + 2 .nft.json');
    assert.deepEqual(readdirSync(join(base, 'a', 'server')).sort(), ['a.js', 'b.js', 'index.html']);
    assert.ok(existsSync(join(base, 'a', 'routes-manifest.json')), 'json que não é nft continua');
    assert.equal(existsSync(join(base, 'a', 'next-server.js.nft.json')), false);
    assert.equal(rel.latenciaMs.n, rel.pedidos, 'a latência de cada pedido entra no relatório');
    const todos = await baixar({ app: 'APP', destino: join(base, 'b'), raiz: RAIZ, api: s.api, rpm: 60000, concorrencia: 4, chave: CHAVE, incluirTudo: true });
    assert.equal(todos.excluidosPorPadrao, 0);
    assert.deepEqual(readdirSync(join(base, 'b', 'server')).sort(), ['a.js', 'a.js.map', 'b.js', 'b.js.map', 'index.html', 'page.js.nft.json']);
  } finally { await fecha(s); rmSync(base, { recursive: true, force: true }); }
});

test('medir: latência por pedido em sequência e vazão com 4/16/32 em paralelo; a vazão cresce com a concorrência numa API que só demora (e recomenda o nível); nada é gravado', async () => {
  const s = await servidorGenerico({}, { latenciaMs: 40 });
  try {
    const m = await medir({ app: 'APP', raiz: RAIZ, api: s.api, rpm: 100000, chave: CHAVE, niveis: [2, 8, 16], por: 3, sequenciais: 4 });
    assert.equal(m.sequencial.n, 4);
    assert.ok(m.sequencial.p50 >= 35, 'p50 ' + m.sequencial.p50);
    assert.deepEqual(m.niveis.map((x) => x.concorrencia), [2, 8, 16]);
    assert.ok(m.niveis[1].pedidosPorMin > m.niveis[0].pedidosPorMin * 1.5, JSON.stringify(m.niveis));
    assert.ok(m.recomendada >= 8, 'recomendada ' + m.recomendada);
    assert.ok(!JSON.stringify(m).includes(CHAVE));
  } finally { await fecha(s); }
});

test('padrão de concorrência = 4 (medido no staging real em 24/11: 4 em voo = 281/min, 16 = 24/min, 32 = 32/min): sem --concorrencia nunca há mais de 4 pedidos em voo', async () => {
  let simultaneos = 0, maximo = 0;
  const srv = http.createServer((req, res) => {
    simultaneos += 1; maximo = Math.max(maximo, simultaneos);
    const u = new URL(req.url, 'http://x');
    const caminho = u.searchParams.get('path');
    setTimeout(() => {
      simultaneos -= 1;
      res.setHeader('content-type', 'application/json');
      if (u.pathname.endsWith('/files/content')) { const c = Buffer.from('c'); res.end(JSON.stringify({ response: { type: 'base64', data: c.toString('base64'), size: 1, last_modified: 'x' } })); return; }
      if (caminho === RAIZ) { res.end(JSON.stringify({ response: Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.js`, path: `${RAIZ}/f${i}.js`, type: 'file', last_modified: 'x', size: '1' })) })); return; }
      res.statusCode = 404; res.end('{}');
    }, 20);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = mkdtempSync(join(tmpdir(), 'ln-baixar-pad-'));
  try {
    const rel = await baixar({ app: 'APP', destino: join(base, 'n'), raiz: RAIZ, api: `http://127.0.0.1:${srv.address().port}`, rpm: 60000, chave: CHAVE });
    assert.equal(rel.arquivos, 30);
    assert.ok(maximo <= 4, `pedidos em voo: ${maximo}`);
    assert.ok(maximo >= 2, 'e usa o paralelismo que tem');
  } finally { await fecha({ srv }); rmSync(base, { recursive: true, force: true }); }
});

test('medir: detecta o COLAPSO da API acima de ~4 em voo (como no staging real) e recomenda 4; sem colapso não há aviso', async () => {
  let emVoo = 0;
  const srv = http.createServer((req, res) => {
    emVoo += 1;
    const atraso = emVoo <= 4 ? 30 : 400; // acima de 4 em voo cada pedido demora muito mais: a vazão despenca
    setTimeout(() => { emVoo -= 1; res.setHeader('content-type', 'application/json'); const c = Buffer.from('21 bytes de teste!!'); res.end(JSON.stringify({ response: { type: 'base64', data: c.toString('base64'), size: c.length, last_modified: 'x' } })); }, atraso);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const m = await medir({ app: 'APP', raiz: RAIZ, api: `http://127.0.0.1:${srv.address().port}`, rpm: 100000, chave: CHAVE, niveis: [1, 2, 4, 16], por: 4, sequenciais: 3 });
    const por = Object.fromEntries(m.niveis.map((x) => [x.concorrencia, x.pedidosPorMin]));
    assert.ok(por[4] > por[1] * 2, JSON.stringify(m.niveis));
    assert.ok(por[16] < por[4] / 2, 'o nível 16 colapsa: ' + JSON.stringify(m.niveis));
    assert.equal(m.recomendada, 4);
    assert.equal(m.colapsoAPartirDe, 16);
    assert.match(m.avisoColapso, /COLAPSA com 16 pedidos em voo/);
    assert.match(m.avisoColapso, /use --concorrencia 4/);
  } finally { await fecha({ srv }); }
  const ok = await servidorGenerico({}, { latenciaMs: 30 });
  try {
    const m = await medir({ app: 'APP', raiz: RAIZ, api: ok.api, rpm: 100000, chave: CHAVE, niveis: [1, 4], por: 3, sequenciais: 2 });
    assert.equal(m.colapsoAPartirDe, undefined);
    assert.equal(m.avisoColapso, undefined);
  } finally { await fecha(ok); }
});

test('medirCargaReal: lista as pastas grandes (tempo e nº de entradas) e lê arquivos DISTINTOS com 1/2/4 em paralelo; uma listagem de 600 entradas lenta aparece no relatório', async () => {
  const grandes = Array.from({ length: 600 }, (_, i) => `c${i}.js`);
  const flat = { [RAIZ]: ['BUILD_ID', 'server/', 'static/'], [RAIZ + '/server']: ['chunks/', 'app/'], [RAIZ + '/server/chunks']: ['ssr/'], [RAIZ + '/server/chunks/ssr']: [...grandes, 'x.js.map'], [RAIZ + '/static']: ['a.css'] };
  const lido = [];
  const s = await servidorGenerico(flat, { latenciaMs: (caminho, rota) => { if (rota.endsWith('/files/content')) lido.push(caminho); return caminho.endsWith('/ssr') ? 250 : 15; } });
  try {
    const cli = (await import('../scripts/baixar-next-vertra.mjs'));
    const m = await cli.medir({ app: 'APP', raiz: RAIZ, api: s.api, rpm: 100000, chave: CHAVE, niveis: [1, 2], por: 2, sequenciais: 1 });
    const real = m.cargaReal;
    assert.ok(real, 'a medição inclui a carga real por padrão');
    const grande = real.listagens.find((l) => l.pasta === 'server/chunks/ssr');
    assert.equal(grande.entradas, 601);
    assert.ok(grande.ms >= 200, 'listagem grande lenta: ' + grande.ms);
    assert.deepEqual(real.niveis.map((x) => x.concorrencia), [1, 2, 4]);
    assert.ok(real.niveis.every((x) => x.pedidos === 12 && x.pedidosPorMin > 0 && x.bytes > 0), JSON.stringify(real.niveis));
    const distintos = lido.filter((p) => p.endsWith('.js') && !p.endsWith('BUILD_ID'));
    assert.equal(new Set(distintos).size, distintos.length, 'nunca lê o mesmo arquivo duas vezes na carga real');
    assert.ok(!lido.some((p) => p.endsWith('.map')), '*.map não entra na amostra');
    const semReal = await cli.medir({ app: 'APP', raiz: RAIZ, api: s.api, rpm: 100000, chave: CHAVE, niveis: [1], por: 1, sequenciais: 1, real: false });
    assert.equal(semReal.cargaReal, undefined);
  } finally { await fecha(s); }
});

test('timeout por pedido: um pedido que trava estoura o timeout configurado, é repetido e o diagnóstico conta 1 timeout e mostra o histograma; pedidos lentos aparecem em "lentos"', async () => {
  let travou = false;
  const presos = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const caminho = u.searchParams.get('path');
    if (!travou && caminho === RAIZ + '/trava.js') { travou = true; presos.push(res); return; } // 1º pedido nunca responde
    res.setHeader('content-type', 'application/json');
    if (u.pathname.endsWith('/files/content')) { const c = Buffer.from('ok'); res.end(JSON.stringify({ response: { type: 'base64', data: c.toString('base64'), size: 2, last_modified: 'x' } })); return; }
    res.end(JSON.stringify({ response: [{ name: 'trava.js', path: RAIZ + '/trava.js', type: 'file', last_modified: 'x', size: '2' }] }));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = mkdtempSync(join(tmpdir(), 'ln-baixar-to-'));
  try {
    const rel = await baixar({ app: 'APP', destino: join(base, 'n'), raiz: RAIZ, api: `http://127.0.0.1:${srv.address().port}`, rpm: 60000, concorrencia: 2, chave: CHAVE, timeoutPedidoMs: 300 });
    assert.deepEqual(rel.erros, []);
    assert.equal(rel.arquivos, 1, 'o arquivo veio na nova tentativa');
    assert.equal(rel.diagnostico.timeouts, 1);
    assert.equal(rel.diagnostico.http429, 0);
    assert.equal(Object.values(rel.diagnostico.faixas).reduce((a, b) => a + b, 0), rel.latenciaMs.n, 'o histograma soma os pedidos bem-sucedidos');
    assert.ok(Array.isArray(rel.diagnostico.lentos));
  } finally { for (const r of presos) r.destroy(); await new Promise((ok) => srv.close(ok)); rmSync(base, { recursive: true, force: true }); }
});

test('baixar: as pastas de rotas do App Router (catch-all, grupo, slot, privada, interceptada) VÃO para o disco; ".." e "..." continuam recusados e o erro mostra o nome; nada escapa do destino', async () => {
  const R = RAIZ + '/server/app';
  const flat = {
    [RAIZ]: ['BUILD_ID', 'server/'],
    [RAIZ + '/server']: ['app/'],
    [R]: ['api/', '(portal)/', '@modal/', '_privado/', '(..)foto/', '..', '...'],
    [R + '/api']: ['auth/', 'studio/'],
    [R + '/api/auth']: ['[...all]/'],
    [R + '/api/auth/[...all]']: ['route.js'],
    [R + '/api/studio']: ['[[...slug]]/'],
    [R + '/api/studio/[[...slug]]']: ['route.js'],
    [R + '/(portal)']: ['[doc]/'],
    [R + '/(portal)/[doc]']: ['page.js'],
    [R + '/@modal']: ['default.js'],
    [R + '/_privado']: ['x.js'],
    [R + '/(..)foto']: ['page.js'],
  };
  const s = await servidorGenerico(flat);
  const base = mkdtempSync(join(tmpdir(), 'ln-baixar-rotas-'));
  try {
    const rel = await baixar({ app: 'APP', destino: join(base, 'n'), raiz: RAIZ, api: s.api, rpm: 60000, concorrencia: 4, chave: CHAVE });
    for (const p of ['api/auth/[...all]/route.js', 'api/studio/[[...slug]]/route.js', '(portal)/[doc]/page.js', '@modal/default.js', '_privado/x.js', '(..)foto/page.js']) assert.ok(existsSync(join(base, 'n', 'server', 'app', ...p.split('/'))), p);
    assert.equal(rel.erros.length, 2, JSON.stringify(rel.erros));
    assert.ok(rel.erros.every((e) => /nome recusado em .*server\/app: "(\.\.|\.\.\.)"/.test(e)), 'o erro traz o nome recusado: ' + JSON.stringify(rel.erros));
    assert.equal(existsSync(join(base, 'server')), false, 'nada fora do destino');
    assert.equal(rel.arquivos, 7);
  } finally { await fecha(s); rmSync(base, { recursive: true, force: true }); }
});

test('baixar --somente: completa só as subpastas pedidas sem relistar o resto do .next (poucos pedidos), cria as pastas e recusa caminho inválido', async () => {
  const R = RAIZ + '/server/app/api';
  const flat = {
    [RAIZ]: ['BUILD_ID', 'server/', 'static/'],
    [RAIZ + '/server']: ['app/'],
    [RAIZ + '/server/app']: ['api/'],
    [R]: ['auth/', 'studio/', 'outra/'],
    [R + '/auth']: ['[...all]/'],
    [R + '/auth/[...all]']: ['route.js'],
    [R + '/studio']: ['social/', 'editorial/'],
    [R + '/studio/social']: ['[...path]/'],
    [R + '/studio/social/[...path]']: ['route.js'],
    [R + '/outra']: ['x.js'],
  };
  const pedidos = [];
  const s = await servidorGenerico(flat, { latenciaMs: (caminho, rota) => { pedidos.push(rota.split('/').pop() + ':' + caminho.replace(RAIZ, '')); return 1; } });
  const base = mkdtempSync(join(tmpdir(), 'ln-baixar-somente-'));
  try {
    const rel = await baixar({ app: 'APP', destino: join(base, 'n'), raiz: RAIZ, api: s.api, rpm: 60000, concorrencia: 2, chave: CHAVE, somente: ['server/app/api/auth', 'server/app/api/studio/social'] });
    assert.deepEqual(rel.erros, []);
    assert.equal(rel.arquivos, 2);
    assert.ok(existsSync(join(base, 'n', 'server', 'app', 'api', 'auth', '[...all]', 'route.js')));
    assert.ok(existsSync(join(base, 'n', 'server', 'app', 'api', 'studio', 'social', '[...path]', 'route.js')));
    assert.equal(existsSync(join(base, 'n', 'server', 'app', 'api', 'outra')), false, 'o resto não é baixado');
    assert.ok(!pedidos.some((p) => /outra|editorial|static|BUILD_ID/.test(p)), 'nem listado: ' + pedidos.join(' '));
    assert.equal(pedidos.length, 6, 'só as duas subárvores: ' + pedidos.join(' '));
    await assert.rejects(() => baixar({ app: 'APP', destino: join(base, 'n2'), raiz: RAIZ, api: s.api, rpm: 60000, chave: CHAVE, somente: ['server/../x'] }), /--somente com caminho inválido/);
  } finally { await fecha(s); rmSync(base, { recursive: true, force: true }); }
});
