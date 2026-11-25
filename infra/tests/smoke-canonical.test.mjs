// A-01 (revisão completa 25/11): no go-live o canonical e o og:image da home, as URLs do sitemap e a linha Sitemap do robots têm de apontar para a URL CANÔNICA (www), nunca para o host da
// Vertra. `smoke-producao --expect-canonical https://www.dominio` confere; o host sondado pode ser outro (antes do DNS do domínio próprio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rodar } from '../scripts/smoke-producao.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const SHA = 'a'.repeat(40);
const WWW = 'https://www.loyaltynews.com.br';

/** fetch em memória: só o que as checagens de canonical precisam; o resto responde 404 (as outras checagens falham e são ignoradas aqui). */
function comSite(origem, { semOg = false, sitemapFora = false } = {}) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url).replace('https://sonda.invalid', '');
    const resp = (corpo, status = 200, tipo = 'text/html') => new Response(corpo, { status, headers: { 'content-type': tipo } });
    if (u === '/') return resp(`<html><head><link rel="canonical" href="${origem}"/>${semOg ? '' : `<meta property="og:image" content="${origem}/og-padrao.png"/>`}</head><body>ok</body></html>`);
    if (u === '/robots.txt') return resp(`User-agent: *\nAllow: /\nSitemap: ${origem}/sitemap.xml\n`, 200, 'text/plain');
    if (u === '/sitemap.xml') return resp(`<urlset><url><loc>${origem}/</loc></url><url><loc>${sitemapFora ? 'https://loyaltynews.vertraweb.app/noticias' : `${origem}/noticias`}</loc></url></urlset>`, 200, 'application/xml');
    return resp('', 404);
  };
  return () => { globalThis.fetch = real; };
}
const rodarCom = async (origem, opts, canonical = WWW) => {
  const volta = comSite(origem, opts);
  try { return await rodar({ url: 'https://sonda.invalid', commit: SHA, indexavel: true, canonical, consecutivas: 1, intervaloMs: 1, timeout: 3000 }); } finally { volta(); }
};
const so = (r, prefixo) => r.checagens.filter((c) => c.nome.startsWith(prefixo));

test('canonical do go-live: www em tudo passa (home canonical, og:image, sitemap e robots)', async () => {
  const r = await rodarCom(WWW);
  for (const p of ['home: canonical aponta para', 'home: og:image aponta para', 'sitemap.xml: todas as URLs em', 'robots.txt: Sitemap em']) {
    const c = so(r, p);
    assert.equal(c.length, 1, p);
    assert.equal(c[0].ok, true, JSON.stringify(c[0]));
  }
});

test('A-01 reproduzido: canonical e og:image no host da Vertra (como a produção de 25/11) reprovam, com o valor encontrado no detalhe', async () => {
  const r = await rodarCom('https://loyaltynews.vertraweb.app');
  const can = so(r, 'home: canonical aponta para')[0];
  const og = so(r, 'home: og:image aponta para')[0];
  assert.equal(can.ok, false);
  assert.match(can.detalhe, /canonical=https:\/\/loyaltynews\.vertraweb\.app/);
  assert.equal(og.ok, false);
  assert.match(og.detalhe, /og:image=https:\/\/loyaltynews\.vertraweb\.app\/og-padrao\.png/);
  assert.equal(so(r, 'robots.txt: Sitemap em')[0].ok, false);
});

test('og:image ausente reprova; URL de sitemap fora do domínio reprova; prefixo parecido (www.loyaltynews.com.br.evil.com) não vale', async () => {
  assert.equal(so(await rodarCom(WWW, { semOg: true }), 'home: og:image aponta para')[0].ok, false);
  const fora = so(await rodarCom(WWW, { sitemapFora: true }), 'sitemap.xml: todas as URLs em')[0];
  assert.equal(fora.ok, false);
  assert.match(fora.detalhe, /1 fora do domínio/);
  const parecido = await rodarCom('https://www.loyaltynews.com.br.evil.com');
  assert.equal(so(parecido, 'home: canonical aponta para')[0].ok, false);
});

test('sem --expect-canonical nada disso é cobrado (comportamento anterior)', async () => {
  const r = await rodarCom('https://loyaltynews.vertraweb.app', {}, '');
  assert.equal(so(r, 'home: canonical').length, 0);
  assert.equal(so(r, 'sitemap.xml: todas as URLs').length, 0);
});

test('CLI: --expect-canonical exige URL https sem caminho (uso errado = exit 2)', () => {
  for (const ruim of ['http://www.x.com', 'www.x.com', 'https://www.x.com/caminho', 'true']) {
    const r = spawnSync(process.execPath, [join(S, 'smoke-producao.mjs'), '--url', 'http://127.0.0.1:1', '--expect-commit', SHA, '--expect-canonical', ruim], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${ruim}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--expect-canonical/);
  }
});
