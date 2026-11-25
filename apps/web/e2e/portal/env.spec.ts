import { expect, test } from '@playwright/test';

/**
 * Política de indexação por ambiente (APP_ENV). Rode com PORTAL_APP_ENV=staging e com production (padrão).
 * Em modo MOCK a indexação fica bloqueada em qualquer ambiente.
 */
const appEnv = process.env.PORTAL_APP_ENV ?? 'production';
const mode = process.env.PORTAL_MODE ?? 'empty';
// DP-24: produção só é indexável com PORTAL_INDEXAVEL=1; PORTAL_INDEXAVEL_E2E=0 testa a produção SEM o interruptor.
const semInterruptor = process.env.PORTAL_INDEXAVEL_E2E === '0';
const blocked = appEnv !== 'production' || mode === 'mock' || semInterruptor;

const URLS = ['/', '/noticias', '/editoria/bancos', '/sobre', '/busca', '/robots.txt', '/sitemap.xml', '/feed.xml', '/api/health'];

test.describe(`indexação com APP_ENV=${appEnv}${semInterruptor ? ' sem PORTAL_INDEXAVEL' : ''} (${mode})`, () => {
  test('robots.txt', async ({ request }) => {
    const r = await request.get('/robots.txt');
    expect(r.status()).toBe(200);
    const body = await r.text();
    if (blocked) {
      expect(body).toBe('User-agent: *\nDisallow: /\n');
      expect(body).not.toContain('Sitemap');
    } else {
      expect(body).toContain('Allow: /');
      expect(body).toContain('Sitemap: https://portal.example.test/sitemap.xml');
    }
  });

  test('sitemap', async ({ request }) => {
    const r = await request.get('/sitemap.xml');
    const body = await r.text();
    // Etapa A do go-live (auditoria de 25/11): em produção o sitemap lista as URLs reais ANTES de o noindex cair.
    // Só staging, vitrine/MOCK continuam sem <loc>.
    if (appEnv !== 'production' || mode === 'mock') expect(body).not.toContain('<loc>');
    else {
      expect(body).toContain('<loc>https://portal.example.test/</loc>');
      expect(body).toContain('https://portal.example.test/editoria/bancos');
      // Nenhuma URL listada pode dar 404 (aceite da etapa A).
      const locs = [...body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => new URL(m[1]!).pathname);
      for (const p of locs.slice(0, 15)) expect((await request.get(p)).status(), p).toBe(200);
    }
  });

  test('X-Robots-Tag em todas as respostas', async ({ request }) => {
    test.setTimeout(90_000);
    for (const u of URLS) {
      const r = await request.get(u);
      const h = r.headers()['x-robots-tag'];
      if (blocked) expect(h, `${u}`).toBe('noindex, nofollow');
      else expect(h, `${u}`).toBeUndefined();
    }
    // 404 e redirecionamento também levam o cabeçalho quando bloqueado.
    const nf = await request.get('/pagina-que-nao-existe');
    expect(nf.status()).toBe(404);
    if (blocked) expect(nf.headers()['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('feed.xml: sem itens quando a indexação está bloqueada; com itens só em produção indexável (fonte api)', async ({ request }) => {
    const body = await (await request.get('/feed.xml')).text();
    expect(body).toContain('<rss');
    if (blocked) expect(body, 'feed bloqueado não publica itens').not.toContain('<item>');
    else if (mode === 'api' && !process.env.PORTAL_API_DOWN) expect(body).toContain('<item>');
  });

  test('meta robots e canonical na home', async ({ page }) => {
    await page.goto('/');
    const robots = page.locator('meta[name="robots"]');
    if (blocked) {
      await expect(robots).toHaveAttribute('content', /noindex/);
      await expect(robots).toHaveAttribute('content', /nofollow/);
    } else {
      // Indexável: o portal emite `index, follow` (e googlebot com prévia grande de imagem, para o Google Discover e Notícias); nunca noindex.
      await expect(robots).toHaveAttribute('content', 'index, follow');
      await expect(page.locator('meta[name="googlebot"]')).toHaveAttribute('content', /max-image-preview:large/);
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://portal.example.test');
  });
});
