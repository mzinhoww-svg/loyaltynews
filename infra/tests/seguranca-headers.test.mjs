// Testes do verificar-seguranca-headers.mjs com um servidor falso (o servidor real é conferido com `next start` do build de produção).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { avaliarSeguranca, verificarSeguranca, HSTS } from '../scripts/verificar-seguranca-headers.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
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
