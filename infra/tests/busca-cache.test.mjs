// Sugestões da busca do cabeçalho (int/025): GET /busca/sugestoes?q=milhas = 200 em CACHE_60S; ?q=a = 400 em no-store; fonte indisponível = 200 em no-store (honesto, nunca fixar erro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { avaliarBusca, BUSCA, CACHE_60S, NO_STORE, verificar } from '../scripts/verificar-cache-headers.mjs';

const BOA = 'public, s-maxage=60, stale-while-revalidate=30';
const ok = (extra = {}) => ({ status: 200, cacheControl: BOA, setCookie: null, robots: 'noindex', corpo: JSON.stringify({ q: 'milhas', total: 0, estado: 'ok', itens: [] }), ...extra });

test('BUSCA: as duas sondas pedidas pelo UI/UX (q=milhas = 200 em 60 s; q=a = 400 em no-store)', () => {
  assert.deepEqual(BUSCA, [
    { rota: '/busca/sugestoes?q=milhas', regra: '60s', status: 200 },
    { rota: '/busca/sugestoes?q=a', regra: 'no-store', status: 400 },
  ]);
});

test('avaliarBusca: resposta boa passa; cada desvio é recusado; fonte indisponível em no-store NÃO é violação (nota), mas cacheada é', () => {
  assert.deepEqual(avaliarBusca(ok(), BUSCA[0]), { problemas: [] });
  const a400 = { status: 400, cacheControl: 'no-store', setCookie: null, robots: 'noindex', corpo: '{"erro":"q_invalido"}' };
  assert.deepEqual(avaliarBusca(a400, BUSCA[1]), { problemas: [] });
  // status errado
  assert.match(avaliarBusca(ok({ status: 500 }), BUSCA[0]).problemas.join('|'), /status 500, esperado 200/);
  assert.match(avaliarBusca({ ...a400, status: 200 }, BUSCA[1]).problemas.join('|'), /status 200, esperado 400/);
  // cache errado
  assert.match(avaliarBusca(ok({ cacheControl: 'no-store' }), BUSCA[0]).problemas.join('|'), /falta s-maxage=60/);
  assert.match(avaliarBusca(ok({ cacheControl: 'public, s-maxage=600, stale-while-revalidate=30' }), BUSCA[0]).problemas.join('|'), /falta s-maxage=60/);
  assert.match(avaliarBusca({ ...a400, cacheControl: BOA }, BUSCA[1]).problemas.join('|'), /esperado no-store/, 'um 400 NUNCA pode ir para cache');
  assert.match(avaliarBusca(ok({ setCookie: 'sid=1' }), BUSCA[0]).problemas.join('|'), /Set-Cookie/);
  // noindex
  assert.match(avaliarBusca(ok({ robots: undefined }), BUSCA[0]).problemas.join('|'), /x-robots-tag sem noindex/);
  assert.match(avaliarBusca(ok({ robots: 'all' }), BUSCA[0]).problemas.join('|'), /x-robots-tag sem noindex/);
  // corpo
  assert.match(avaliarBusca(ok({ corpo: 'não é json' }), BUSCA[0]).problemas.join('|'), /sem estado/);
  assert.match(avaliarBusca(ok({ corpo: '{"estado":"estranho"}' }), BUSCA[0]).problemas.join('|'), /sem estado/);
  // fonte indisponível: no-store é o certo
  const indisp = ok({ cacheControl: 'no-store', corpo: JSON.stringify({ q: 'milhas', estado: 'indisponivel', itens: [] }) });
  const r = avaliarBusca(indisp, BUSCA[0]);
  assert.deepEqual(r.problemas, []);
  assert.match(r.nota, /fonte de dados está indisponível/);
  assert.match(avaliarBusca({ ...indisp, cacheControl: BOA }, BUSCA[0]).problemas.join('|'), /esperado no-store/, 'indisponível em cache fixaria um erro: reprova');
});

function servidor(modo) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const ehCache = CACHE_60S.map((r) => r.replace('{editoria}', 'mercado')).includes(u.pathname);
    if (u.pathname === '/busca/sugestoes') {
      const q = (u.searchParams.get('q') ?? '').trim();
      const h = { 'content-type': 'application/json', 'x-robots-tag': 'noindex' };
      if (q.length < 2) { res.writeHead(modo === 'q-curto-em-cache' ? 400 : 400, { ...h, 'cache-control': modo === 'q-curto-em-cache' ? BOA : 'no-store' }); return res.end('{"erro":"q_invalido"}'); }
      if (modo === 'indisponivel') { res.writeHead(200, { ...h, 'cache-control': 'no-store' }); return res.end('{"estado":"indisponivel","itens":[]}'); }
      res.writeHead(200, { ...h, 'cache-control': modo === 'sem-cache' ? 'no-store' : BOA }); return res.end('{"estado":"ok","itens":[]}');
    }
    res.writeHead(200, { 'cache-control': ehCache ? BOA : 'no-store' });
    res.end('x');
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}
const fecha = (s) => new Promise((r) => s.srv.close(r));

test('verificar: 19 rotas da política + as 2 da busca = 21; tudo conforme passa; indisponível só avisa; q=milhas sem cache e q=a em cache reprovam', async () => {
  const s0 = await servidor('ok');
  try {
    const r = await verificar({ url: s0.url, valores: { editoria: 'mercado' } });
    assert.equal(r.total, CACHE_60S.length + NO_STORE.length + 2);
    assert.equal(r.violacoes, 0, JSON.stringify(r.resultados.filter((x) => !x.ok)));
    assert.deepEqual(r.resultados.filter((x) => x.rota.startsWith('/busca/')).map((x) => [x.rota, x.status, x.ok]), [['/busca/sugestoes?q=milhas', 200, true], ['/busca/sugestoes?q=a', 400, true]]);
  } finally { await fecha(s0); }
  const s1 = await servidor('indisponivel');
  try {
    const r = await verificar({ url: s1.url, valores: { editoria: 'mercado' } });
    assert.equal(r.violacoes, 0);
    assert.match(r.resultados.find((x) => x.rota === '/busca/sugestoes?q=milhas').nota, /indisponível/);
  } finally { await fecha(s1); }
  const s2 = await servidor('sem-cache');
  try {
    const r = await verificar({ url: s2.url, valores: { editoria: 'mercado' } });
    assert.equal(r.violacoes, 1);
    assert.equal(r.resultados.find((x) => !x.ok).rota, '/busca/sugestoes?q=milhas');
  } finally { await fecha(s2); }
  const s3 = await servidor('q-curto-em-cache');
  try {
    const r = await verificar({ url: s3.url, valores: { editoria: 'mercado' } });
    assert.equal(r.violacoes, 1);
    assert.equal(r.resultados.find((x) => !x.ok).rota, '/busca/sugestoes?q=a');
  } finally { await fecha(s3); }
});
