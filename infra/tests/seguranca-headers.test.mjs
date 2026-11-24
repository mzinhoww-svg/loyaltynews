// Testes do verificar-seguranca-headers.mjs com um servidor falso (o servidor real é conferido com `next start` do build de produção).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { avaliarSeguranca, verificarSeguranca, HSTS } from '../scripts/verificar-seguranca-headers.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const S_DIR = S;
const BOM = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'content-security-policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  'content-security-policy-report-only': "default-src 'self'; script-src 'self' 'unsafe-inline'",
  'strict-transport-security': 'max-age=86400',
};

test('avaliarSeguranca: conjunto completo = nenhum problema; cada cabeçalho ausente ou errado é recusado (controles negativos)', () => {
  assert.deepEqual(avaliarSeguranca(BOM, 'staging'), []);
  assert.deepEqual(avaliarSeguranca({ ...BOM, 'strict-transport-security': 'max-age=31536000' }, 'production'), []);
  const casos = [
    [{ 'x-content-type-options': undefined }, /x-content-type-options/],
    [{ 'referrer-policy': 'no-referrer-when-downgrade' }, /referrer-policy/],
    [{ 'x-frame-options': 'ALLOWALL' }, /x-frame-options/],
    [{ 'permissions-policy': 'camera=()' }, /permissions-policy sem microphone/],
    [{ 'content-security-policy': "default-src 'self'" }, /content-security-policy sem frame-ancestors/],
    [{ 'content-security-policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; script-src 'unsafe-eval'" }, /unsafe-eval/],
    [{ 'content-security-policy-report-only': undefined }, /report-only/],
    [{ 'strict-transport-security': undefined }, /strict-transport-security ausente/],
    [{ 'strict-transport-security': 'max-age=63072000; includeSubDomains; preload' }, /esperado "max-age=86400"/],
  ];
  for (const [troca, esperado] of casos) assert.match(avaliarSeguranca({ ...BOM, ...troca }, 'staging').join('|'), esperado, JSON.stringify(troca));
  assert.match(avaliarSeguranca({ ...BOM, 'strict-transport-security': 'max-age=31536000; includeSubDomains' }, 'production').join('|'), /includeSubDomains nem preload/);
  assert.match(avaliarSeguranca(BOM, 'production').join('|'), /esperado "max-age=31536000" \(production\)/, 'HSTS de staging reprova em produção');
  assert.equal(HSTS.staging, 'max-age=86400');
});

function servidor({ semHsts = false } = {}) {
  const srv = http.createServer((req, res) => {
    const h = { ...BOM };
    if (semHsts) delete h['strict-transport-security'];
    for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
    res.setHeader('content-type', 'text/html');
    res.statusCode = req.url === '/noticia/materia-que-nao-existe-ensaio' ? 404 : 200;
    res.end(req.url === '/' ? '<link rel="stylesheet" href="/_next/static/chunks/a.css"/>' : 'x');
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}
const fecha = (s) => new Promise((r) => s.srv.close(r));

test('verificarSeguranca: confere rotas inclusive 404 e um estático; reprova quando uma rota perde o HSTS; CLI sai 0/1/2', async () => {
  const bom = await servidor();
  try {
    const r = await verificarSeguranca({ url: bom.url, ambiente: 'staging' });
    assert.equal(r.violacoes, 0, JSON.stringify(r.resultados.filter((x) => !x.ok)));
    assert.ok(r.resultados.some((x) => x.rota === '/noticia/materia-que-nao-existe-ensaio' && x.status === 404), 'o 404 também é conferido');
    assert.ok(r.resultados.some((x) => x.rota === '/_next/static/chunks/a.css'), 'o arquivo estático da home é conferido');
    const cli = (args) => new Promise((ok) => { const p = spawn(process.execPath, [join(S, 'verificar-seguranca-headers.mjs'), ...args], { stdio: 'ignore' }); p.on('close', ok); });
    assert.equal(await cli(['--url', bom.url, '--ambiente', 'staging']), 0);
    assert.equal(await cli(['--url', bom.url, '--ambiente', 'production']), 1, 'HSTS de staging reprova como produção');
    assert.equal(await cli(['--url', 'http://exemplo.com']), 2);
    assert.equal(await cli(['--url', bom.url, '--ambiente', 'homolog']), 2);
  } finally { await fecha(bom); }
  const ruim = await servidor({ semHsts: true });
  try {
    const r = await verificarSeguranca({ url: ruim.url, ambiente: 'staging' });
    assert.ok(r.violacoes > 0);
    assert.match(JSON.stringify(r.resultados), /strict-transport-security ausente/);
  } finally { await fecha(ruim); }
});

test('smoke-producao com seguranca=true confere o HSTS de produção (1 ano): passa com max-age=31536000 e reprova com o de staging', async () => {
  const { rodar } = await import('../scripts/smoke-producao.mjs');
  const srv = (hsts) => new Promise((ok) => {
    const s = http.createServer((req, res) => {
      for (const [k, v] of Object.entries({ ...BOM, 'strict-transport-security': hsts })) res.setHeader(k, v);
      res.end(req.url === '/' ? '<link rel="stylesheet" href="/_next/static/chunks/a.css"/>' : 'x');
    });
    s.listen(0, '127.0.0.1', () => ok({ srv: s, url: `http://127.0.0.1:${s.address().port}` }));
  });
  const a = await srv('max-age=31536000');
  const b = await srv('max-age=86400');
  try {
    const ok = await rodar({ url: a.url, seguranca: true, consecutivas: 1, intervaloMs: 1, timeout: 3000 });
    const reprovado = await rodar({ url: b.url, seguranca: true, consecutivas: 1, intervaloMs: 1, timeout: 3000 });
    const pega = (r) => r.checagens.find((c) => /^seguranca:/.test(c.nome));
    assert.equal(pega(ok)?.ok, true, JSON.stringify(pega(ok)));
    assert.equal(pega(reprovado)?.ok, false);
    assert.match(String(pega(reprovado)?.detalhe), /esperado "max-age=31536000" \(production\)/);
    assert.equal((await rodar({ url: a.url, consecutivas: 1, intervaloMs: 1, timeout: 3000 })).checagens.some((c) => /^seguranca:/.test(c.nome)), false, 'sem a opção, a checagem não existe');
  } finally { await fecha(a); await fecha(b); }
});

test('estáticos: avaliarSeguranca com { estatico: true } exige SÓ nosniff (CSP, XFO, Permissions-Policy e HSTS valem para documentos)', () => {
  assert.deepEqual(avaliarSeguranca({ 'x-content-type-options': 'nosniff' }, 'staging', { estatico: true }), []);
  assert.match(avaliarSeguranca({}, 'staging', { estatico: true }).join('|'), /x-content-type-options/);
  assert.equal(avaliarSeguranca({}, 'staging', { estatico: true }).length, 1);
  assert.ok(avaliarSeguranca({ 'x-content-type-options': 'nosniff' }, 'staging').length > 1, 'sem a opção, o conjunto completo continua exigido');
});

// borda: URLs SEM ln-seg vêm de uma cópia antiga (HIT, sem cabeçalhos); com ln-seg a origem responde com tudo (ou sem, no cenário "origem também falha")
function servidorBorda({ origemOk = true, estaticoSemNosniffMiss = false } = {}) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const estatico = u.pathname.startsWith('/_next/static/');
    const velha = (u.pathname === '/robots.txt' || estatico) && !u.searchParams.has('ln-seg');
    const completa = origemOk && !velha;
    if (velha) { res.setHeader('cf-cache-status', 'HIT'); res.setHeader('age', '117679'); } else res.setHeader('cf-cache-status', 'MISS');
    if (estaticoSemNosniffMiss && estatico) { res.setHeader('cf-cache-status', 'MISS'); res.end('x'); return; }
    if (completa) for (const [k, v] of Object.entries(BOM)) res.setHeader(k, v);
    else if (!velha && !origemOk) { /* origem sem cabeçalhos */ }
    res.end(u.pathname === '/' ? '<link rel="stylesheet" href="/_next/static/chunks/a.css"/><script src="/_next/static/chunks/b.js"></script><link rel="stylesheet" href="/_next/static/chunks/a.css"/>' : 'x');
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}` })));
}

test('borda: cópia antiga do Cloudflare (HIT, sem cabeçalhos) com a ORIGEM OK vira AVISO (não falha) e lista as URLs completas a purgar; estáticos distintos da home são todos sondados', async () => {
  const s = await servidorBorda();
  try {
    const r = await verificarSeguranca({ url: s.url, ambiente: 'staging' });
    assert.equal(r.violacoes, 0, JSON.stringify(r.resultados.filter((x) => !x.ok)));
    assert.equal(r.avisos, 3, 'robots.txt + 2 estáticos distintos (o CSS repetido na home conta uma vez)');
    assert.deepEqual([...r.purgar].sort(), [s.url + '/_next/static/chunks/a.css', s.url + '/_next/static/chunks/b.js', s.url + '/robots.txt'].sort());
    assert.ok(r.resultados.filter((x) => x.aviso).every((x) => /HIT, age=117679 s/.test(x.aviso) && /ORIGEM entrega tudo/.test(x.aviso)));
    const cli = await new Promise((ok) => { const p = spawn(process.execPath, [join(S_DIR, 'verificar-seguranca-headers.mjs'), '--url', s.url, '--ambiente', 'staging'], { stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (d) => { o += d; }); p.on('close', (status) => ok({ status, o })); });
    assert.equal(cli.status, 0, 'avisos não derrubam o código de saída');
    assert.ok(cli.o.includes('"purgar":[') && cli.o.includes('/robots.txt'), 'a linha com a lista de URLs a purgar sai na CLI');
    assert.ok(cli.o.includes(s.url + '/robots.txt'), 'a URL é COMPLETA (esquema, host e caminho)');
    assert.match(cli.o, /"avisos":3/);
  } finally { await fecha(s); }
});

test('borda: se a ORIGEM também falha (cache-buster sem cabeçalhos), é VIOLAÇÃO real com prefixo "origem:"; estático sem nosniff e sem HIT também reprova', async () => {
  const s = await servidorBorda({ origemOk: false });
  try {
    const r = await verificarSeguranca({ url: s.url, ambiente: 'staging' });
    assert.ok(r.violacoes >= 3);
    assert.equal(r.avisos, 0);
    assert.match(JSON.stringify(r.resultados), /origem: x-content-type-options/);
  } finally { await fecha(s); }
  const t = await servidorBorda({ estaticoSemNosniffMiss: true });
  try {
    const r = await verificarSeguranca({ url: t.url, ambiente: 'staging' });
    assert.ok(r.resultados.filter((x) => x.rota.startsWith('/_next/static/')).every((x) => !x.ok && /x-content-type-options/.test(x.problemas.join('|'))));
  } finally { await fecha(t); }
});
